import * as OAuthServer from "oauth2-server";
import * as express from "express";
import { TokenUser, Base, NoderedUtil, User, InsertOrUpdateOneMessage } from "@openiap/openflow-api";
import { Config } from "./Config";
import { Crypt } from "./Crypt";
import { Provider, KoaContextWithOIDC } from "oidc-provider";
import { MongoAdapter } from "./MongoAdapter";
import { Span } from "@opentelemetry/api";
import { Logger } from "./Logger";

const Request = OAuthServer.Request;
const Response = OAuthServer.Response;
export class OAuthProvider {
    private app: express.Express;
    public static instance: OAuthProvider = null;
    public clients = [];
    private codes = {};
    public oauthServer: any = null;
    private authorizationCodeStore: any = {};
    public oidc: Provider;
    static async interactionsUrl(ctx: KoaContextWithOIDC, interaction): Promise<any> {
        return "/oidclogin";
    }
    static async logoutSource(ctx, form) {


        if (ctx && ctx.oidc && ctx.oidc.session && ctx.oidc.session.authorizations) {
            for (var i = 0; i < this.instance.clients.length; i++) {
                var cli = this.instance.clients[i];
                var auth = ctx.oidc.session.authorizations[cli.id];
                if (auth) {
                    // console.log(auth);
                    if (cli.openflowsignout && cli.openflowsignout == true) {
                        ctx.req.logout();
                    }
                }
            }
        }
        ctx.body = `<!DOCTYPE html>
      <head>
      <title>Logout Request</title>
      <style>/* css and html classes omitted for brevity, see lib/helpers/defaults.js */</style>
      </head>
      <body onload="logout()">
      <div>
        <h1>Do you want to sign-out from ${ctx.host}?</h1>
        <script>
          function logout() {
            var form = document.getElementById('op.logoutForm');
            var input = document.createElement('input');
            input.type = 'hidden';
            input.name = 'logout';
            input.value = 'yes';
            form.appendChild(input);
            form.submit();
          }
          function rpLogoutOnly() {
            var form = document.getElementById('op.logoutForm');
            form.submit();
          }
          
        </script>
        ${form}
        <button onclick="logout()">Yes, sign me out</button>
        <button onclick="rpLogoutOnly()">No, stay signed in</button>
      </div>
      </body>
      </html>`;
    }
    static async postLogoutSuccessSource(ctx) {
        // @param ctx - koa request context
        // @param form - form source (id="op.logoutForm") to be embedded in the page and submitted by
        //   the End-User
        ctx.body = `<!DOCTYPE html>
      <head>
      <title>Logout Request</title>
      <style>/* css and html classes omitted for brevity, see lib/helpers/defaults.js */</style>
      </head>
      <body onload="logout()">
      <div>
        <h1>You have successfully signed out from ${ctx.host}</h1>
        <a href="${ctx.req.cookies.oidcrefere}">Return to ${ctx.req.cookies.oidcrefere}</a> ?
      </div>
      </body>
      </html>`;
        if (!NoderedUtil.IsNullEmpty(ctx.req.cookies.oidcrefere)) {
            // ctx.res.cookie("oidcrefere", "", { expires: new Date(0) });
            // LoginProvider.redirect(ctx.res, ctx.req.cookies.oidcrefere);
        }
    }
    static store = new Map();
    public static generatekeys() {
        return new Promise((resolve, reject) => {
            const jose = require('jose');
            const keystore = new jose.JWKS.KeyStore();
            Promise.all([
                keystore.generate('RSA', 2048, { use: 'sig' }),
                keystore.generate('RSA', 2048, { use: 'enc' }),
                keystore.generate('EC', 'P-256', { use: 'sig' }),
                keystore.generate('EC', 'P-256', { use: 'enc' }),
                keystore.generate('OKP', 'Ed25519', { use: 'sig' }),
            ]).then(() => {
                resolve(keystore.toJWKS(true));
            }).catch((err) => {
                reject(err);
            });
        });
    }
    public static async LoadClients() {
        const instance = OAuthProvider.instance;

        const span = Logger.otel.startSpan("OAuthProvider.LoadClients");
        try {
            const jwksresults = await Config.db.query<Base>({ query: { _type: "jwks" }, top: 10, collectionname: "config", jwt: Crypt.rootToken() }, span);
            let jwks = null;
            if (jwksresults.length == 0) {
                jwks = await this.generatekeys();
                jwks._type = "jwks";
                await Config.db.InsertOne(jwks, "config", 1, true, Crypt.rootToken(), span);
            } else {
                jwks = jwksresults[0];
            }
            const result = await Config.db.query<Base>({ query: { _type: "oauthclient" }, top: 10, collectionname: "config", jwt: Crypt.rootToken() }, span);
            instance.clients = result;
            instance.clients.forEach(cli => {
                cli.client_id = cli.clientId;
                cli.client_secret = cli.clientSecret;
                cli.redirect_uris = cli.redirectUris;
                // token_endpoint_auth_method can only be none, client_secret_post, client_secret_basic, private_key_jwt or tls_client_auth
                if (NoderedUtil.IsNullEmpty(cli.token_endpoint_auth_method)) cli.token_endpoint_auth_method = "none";
                // response_types can only contain 'code id_token', 'code', 'id_token', or 'none' 
                // id_token token
                if (NoderedUtil.IsNullEmpty(cli.response_types)) cli.response_types = ['code', 'id_token', 'code id_token'];
                // https://github.com/panva/node-oidc-provider/blob/64edda69a84e556531f45ac814788c8c92ab6212/test/claim_types/claim_types.test.js
                if (cli.grant_types == null) cli.grant_types = ['implicit', 'authorization_code'];
            });
            const provider = new Provider(Config.baseurl() + "oidc", {
                clients: instance.clients,
                adapter: MongoAdapter,
                formats: {
                    AccessToken: 'jwt',
                },
                ttl: {
                    AccessToken: Config.oidc_access_token_ttl,
                    AuthorizationCode: Config.oidc_authorization_code_ttl,
                    ClientCredentials: Config.oidc_client_credentials_ttl,
                    RefreshToken: Config.oidc_refresh_token_ttl,
                    Session: Config.oidc_session_ttl
                },
                jwks: jwks,
                features: {
                    encryption: { enabled: true },
                    introspection: { enabled: true },
                    revocation: { enabled: true },
                    devInteractions: { enabled: false },
                    clientCredentials: { enabled: true },
                    userinfo: { enabled: true },
                    jwtUserinfo: { enabled: true },
                    claimsParameter: { enabled: false },
                    rpInitiatedLogout: {
                        enabled: true,
                        logoutSource: this.logoutSource.bind(this),
                        postLogoutSuccessSource: this.postLogoutSuccessSource.bind(this)
                    }
                },
                claims: {
                    acr: null,
                    auth_time: null,
                    iss: null,
                    openid: [
                        'sub', 'name', 'email', 'email_verified', 'role'
                    ],
                    sid: null
                },
                conformIdTokenClaims: false,
                interactions: {
                    url: this.interactionsUrl
                },
                findAccount: Account.findAccount,
                cookies: {
                    short: {
                        path: '/',
                    },
                    keys: [Config.oidc_cookie_key],
                },
            });
            provider.proxy = true;
            const { invalidate: orig } = (provider.Client as any).Schema.prototype;
            (provider.Client as any).Schema.prototype.invalidate = function invalidate(message, code) {
                if (code === 'implicit-force-https' || code === 'implicit-forbid-localhost') {
                    return;
                }
                if (message === 'redirect_uris must contain members') {
                    return;
                }
                orig.call(this, message);
            };
            const orgpostLogoutRedirectUriAllowed = provider.Client.prototype.postLogoutRedirectUriAllowed;
            provider.Client.prototype.postLogoutRedirectUriAllowed = function (value) {
                if (this.postLogoutRedirectUris == null || this.postLogoutRedirectUris.length == 0) return true;
                return orgpostLogoutRedirectUriAllowed(value);
            };
            const orgredirectUriAllowed = provider.Client.prototype.redirectUriAllowed;
            provider.Client.prototype.redirectUriAllowed = function (value) {
                if (this.redirectUris == null || this.redirectUris.length == 0) return true;
                return orgredirectUriAllowed(value);
            };
            if (instance.oidc != null) {
                instance.oidc = provider;
                return;
            }
            instance.oidc = provider;
            instance.app.use('/oidc', async (req, res, next) => {
                if (req.originalUrl == "/oidc/me/emails") { // Grafana old school hack
                    res.send('[]');
                    return;
                }
                if (req.originalUrl.startsWith("/oidc/session/end")) {
                    if (!NoderedUtil.IsNullEmpty(req.headers.referer)) {
                        if (req.headers.referer.indexOf("oidc/session") == -1) {
                            res.cookie("oidcrefere", req.headers.referer, { maxAge: 900000, httpOnly: true });
                        }
                    }
                }
                instance.oidc.callback(req, res);
            });

            instance.app.use('/oidclogin', async (req, res, next) => {
                if (req && (req as any).user) {
                    res.cookie("originalUrl", "/oidccb", { maxAge: 900000, httpOnly: true });
                    res.redirect("/oidccb");
                } else {
                    res.cookie("originalUrl", "/oidclogin", { maxAge: 900000, httpOnly: true });
                    res.redirect("/login");
                }
            });
            instance.app.use('/oidccb', async (req, res, next) => {
                try {
                    const {
                        uid, prompt, params, session,
                    } = await this.instance.oidc.interactionDetails(req, res);
                    var r = req;
                    var u = req.user;
                    const isAuthenticated: boolean = req.isAuthenticated();
                    if (isAuthenticated) {
                    } else {
                        res.cookie("originalUrl", "/oidccb", { maxAge: 900000, httpOnly: true });
                        res.redirect('/login');
                        return;
                    }

                    if (req.user) {
                        const client = await this.instance.clients.filter(x => x.clientId == params.client_id)[0];
                        const tuser: TokenUser = TokenUser.From(req.user as any);
                        Account.AddAccount(tuser, client);
                        await this.instance.oidc.interactionFinished(req, res,

                            // result should be an object with some or all the following properties
                            {
                                // authentication/login prompt got resolved, omit if no authentication happened, i.e. the user
                                // cancelled
                                login: {
                                    account: tuser._id, // logged-in account id
                                    acr: "acr", // acr value for the authentication
                                    remember: false, // true if provider should use a persistent cookie rather than a session one, defaults to true
                                    // ts: number, // unix timestamp of the authentication, defaults to now()
                                },

                                // consent was given by the user to the client for this session
                                consent: {
                                    rejectedScopes: [], // array of strings, scope names the end-user has not granted
                                    rejectedClaims: [], // array of strings, claim names the end-user has not granted
                                },

                                // meta is a free object you may store alongside an authorization. It can be useful
                                // during the interaction check to verify information on the ongoing session.
                                meta: {
                                    // object structure up-to-you
                                    "openflow": "true"
                                },

                                ['custom prompt name resolved']: {},
                            }
                        );
                    }
                } catch (error) {
                    if (error.name == "SessionNotFound") {
                        res.redirect(`/`);
                        res.end();
                        return;
                    }
                    res.json(error)

                }
            });
        } catch (error) {
            span?.recordException(error);
            Logger.instanse.error(error);
        }
        finally {
            Logger.otel.endSpan(span);
        }

    }
    static configure(app: express.Express, parent: Span): OAuthProvider {
        const span: Span = Logger.otel.startSubSpan("OAuthProvider.configure", parent);
        try {
            const instance = new OAuthProvider();

            try {
                OAuthProvider.instance = instance;
                instance.app = app;
                instance.oauthServer = new OAuthServer({
                    model: instance,
                    grants: ['authorization_code', 'refresh_token'],
                    accessTokenLifetime: (60 * 60 * 24) * 7, // 7 days * 24 hours, or 1 day
                    refreshTokenLifetime: (60 * 60 * 24) * 7, // 7 days * 24 hours, or 1 day
                    allowEmptyState: true,
                    allowExtendedTokenAttributes: true,
                    allowBearerTokensInQueryString: true
                });
                this.LoadClients();
                (app as any).oauth = instance.oauthServer;
                app.all('/oauth/token', instance.obtainToken.bind(instance));
                app.get('/oauth/login', async (req, res) => {
                    const span = Logger.otel.startSpan("OAuthProvider.oauth.login");
                    try {
                        if (NoderedUtil.IsNullUndefinded(instance.clients)) {
                            instance.clients = await Config.db.query<Base>({ query: { _type: "oauthclient" }, top: 10, collectionname: "config", jwt: Crypt.rootToken() }, span);
                            if (instance.clients == null || instance.clients.length == 0) return res.status(500).json({ message: 'OAuth not configured' });
                        }
                        let state = ((req.params as any).state ? (req.params as any).state : req.params["amp;state"]);
                        if (state == null) state = encodeURIComponent((req.query.state ? req.query.state : req.query["amp;state"]) as any);
                        const access_type = (req.query.access_type ? req.query.access_type : req.query["amp;access_type"]);
                        const client_id = (req.query.client_id ? req.query.client_id : req.query["amp;client_id"]);
                        const redirect_uri = (req.query.redirect_uri ? req.query.redirect_uri : req.query["amp;redirect_uri"]) as string;
                        const response_type = (req.query.response_type ? req.query.response_type : req.query["amp;response_type"]);
                        const scope = (req.query.scope ? req.query.scope : req.query["amp;scope"]);
                        let client = instance.getClientById(client_id);
                        if (NoderedUtil.IsNullUndefinded(client)) {
                            instance.clients = await Config.db.query<Base>({ query: { _type: "oauthclient" }, top: 10, collectionname: "config", jwt: Crypt.rootToken() }, span);
                            if (instance.clients == null || instance.clients.length == 0) return res.status(500).json({ message: 'OAuth not configured' });
                        }
                        if (req.user) {
                            if (!NoderedUtil.IsNullUndefinded(client) && !Array.isArray(client.redirectUris)) {
                                client.redirectUris = [];
                            }
                            if (!NoderedUtil.IsNullUndefinded(client) && client.redirectUris.length > 0) {
                                if (client.redirectUris.indexOf(redirect_uri) == -1) {
                                    return res.status(500).json({ message: 'illegal redirect_uri ' + redirect_uri });
                                    // client.redirectUris.push(redirect_uri);
                                }
                            }
                            const code = NoderedUtil.GetUniqueIdentifier();

                            Logger.instanse.info("[OAuth][" + (req.user as any).username + "] /oauth/login " + state);
                            instance.saveAuthorizationCode(code, client, req.user, redirect_uri);
                            res.redirect(`${redirect_uri}?state=${state}&code=${code}`);
                        } else {
                            Logger.instanse.info("[OAuth][anon] /oauth/login " + state);
                            res.cookie("originalUrl", req.originalUrl, { maxAge: 900000, httpOnly: true });
                            res.redirect("/login");
                        }
                    } catch (error) {
                        span?.recordException(error);
                        throw error;
                    } finally {
                        Logger.otel.endSpan(span);
                    }
                });
                // app.get('/oauth/authorize', instance.authorize.bind(instance));
                app.all('/oauth/authorize', (req, res) => {
                    const request = new Request(req);
                    const response = new Response(res);
                    return instance.oauthServer.authenticate(request, response)
                        .then((token) => {
                            res.json(token.user);
                        }).catch((err) => {
                            console.error(err);
                            res.status(err.code || 500).json(err);
                        });
                });
                // app.all('/oauth/authorize', instance.oauthServer.authenticate.bind(instance));
                // app.all('/oauth/authorize/emails', instance.oauthServer.authenticate.bind(instance));
            } catch (error) {
                console.error(error);
                const json = JSON.stringify(error, null, 3);
                console.error(json);
                throw error;
            }
            return instance;
        } catch (error) {
            span?.recordException(error);
            Logger.instanse.error(error);
            return OAuthProvider.instance;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    authorize(req, res) {
        Logger.instanse.info("[OAuth] authorize");
        const request = new Request(req);
        const response = new Response(res);
        return this.oauthServer.authorize(request, response)
            .then((token) => {
                res.json(token);
            }).catch((err) => {
                console.error(err);
                res.status(err.code || 500).json(err);
            });

    }
    authenticateHandler() {
        return {
            handle: (request, response) => {
                //in this example, we store the logged-in user as the 'loginUser' attribute in session
                if (request.session.loginUser) {
                    return { username: request.session.loginUser.username };
                }

                return null;
            }
        };
    }
    obtainToken(req, res) {
        Logger.instanse.info("[OAuth] obtainToken");
        const request = new Request(req);
        const response = new Response(res);
        return this.oauthServer.token(request, response)
            .then((token) => {
                Logger.instanse.info("[OAuth] obtainToken::success: token:");
                res.json(token);
            }).catch((err) => {
                Logger.instanse.info("[OAuth] obtainToken::failed: token:");
                console.error(err);
                res.status(err.code || 500).json(err);
            });
    }
    public async getAccessToken(accessToken) {
        const span: Span = Logger.otel.startSpan("OAuthProvider.getAccessToken");
        try {
            Logger.instanse.info("[OAuth] getAccessToken " + accessToken);
            let token = await OAuthProvider.getCachedAccessToken(accessToken);
            if (token != null) return token;
            const tokens = await Config.db.query<Base>({ query: { _type: "token", "accessToken": accessToken }, top: 10, collectionname: "oauthtokens", jwt: Crypt.rootToken() }, span);
            token = tokens.length ? tokens[0] as any : null;
            await OAuthProvider.addToken(token);
            if (token == null) return false;
            return token;
        } catch (error) {
            span?.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public async getRefreshToken(refreshToken) {
        const span: Span = Logger.otel.startSpan("OAuthProvider.getRefreshToken");
        try {
            Logger.instanse.info("[OAuth] getRefreshToken " + refreshToken);
            let token = await OAuthProvider.getCachedAccessToken(refreshToken);
            if (token != null) return token;
            const tokens = await Config.db.query<Base>({ query: { _type: "token", "refreshToken": refreshToken }, top: 10, collectionname: "oauthtokens", jwt: Crypt.rootToken() }, span);
            token = tokens.length ? tokens[0] as any : null;
            await OAuthProvider.addToken(token);
            if (token == null) return false;
            return token;
        } catch (error) {
            span?.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public getClient(clientId, clientSecret) {
        Logger.instanse.info("[OAuth] getClient " + clientId);
        const clients = this.clients.filter((client) => {
            return client.clientId === clientId && client.clientSecret === clientSecret;
        });
        return clients.length ? clients[0] : false;
    }
    public getClientById(clientId) {
        Logger.instanse.info("[OAuth] getClientById " + clientId);
        const clients = this.clients.filter((client) => {
            return client.clientId === clientId;
        });
        return clients.length ? clients[0] : null;
    }

    public async saveToken(token, client, user) {
        const span = Logger.otel.startSpan("OAuthProvider.saveToken");
        Logger.instanse.info("[OAuth] saveToken for " + user.name + " in " + client.clientId);
        const result: any = {
            name: "Token for " + user.name,
            accessToken: token.accessToken,
            access_token: token.accessToken,
            accessTokenExpiresAt: token.accessTokenExpiresAt,
            clientId: client.clientId,
            refreshToken: token.refreshToken,
            refresh_token: token.refreshToken,
            refreshTokenExpiresAt: token.refreshTokenExpiresAt,
            userId: user.id,
            user: user,
            client: client,
            _type: "token"
        };
        await OAuthProvider.addToken(result);
        await Config.db.InsertOne(result, "oauthtokens", 0, false, Crypt.rootToken(), span);
        Logger.otel.endSpan(span)
        return result;
    }
    public async saveAuthorizationCode(code: string, client: any, user: any, redirect_uri: string) {
        const span = Logger.otel.startSpan("OAuthProvider.saveAuthorizationCode");
        Logger.instanse.info("[OAuth] saveAuthorizationCode " + code);
        const codeobject = Object.assign({}, user);
        delete codeobject._id;
        codeobject._type = 'code';
        codeobject.code = code;
        codeobject.id = user._id;
        codeobject.username = user.username;
        codeobject.email = user.email;
        if (NoderedUtil.IsNullEmpty(codeobject.email)) codeobject.email = user.username;
        codeobject.fullname = user.name;
        codeobject.redirect_uri = redirect_uri;
        codeobject.client_id = client.clientId
        codeobject.name = "Code " + code + " for " + user.name
        this.codes[code] = codeobject;
        await Config.db.InsertOne(codeobject, "oauthtokens", 1, false, Crypt.rootToken(), span);
        Logger.instanse.info("[OAuth] saveAuthorizationCode " + code + " saved");
        Logger.otel.endSpan(span);
        return codeobject;
    }
    sleep(ms) {
        return new Promise(resolve => { setTimeout(resolve, ms) })
    }

    public async getAuthorizationCode(code) {
        const span: Span = Logger.otel.startSpan("OAuthProvider.validateToken");
        try {
            Logger.instanse.info("[OAuth] getAuthorizationCode " + code);
            let user: any = this.codes[code];
            if (user == null) {
                let users = await Config.db.query<Base>({ query: { _type: "code", "code": code }, top: 10, collectionname: "oauthtokens", jwt: Crypt.rootToken() }, span);
                user = users.length ? users[0] as any : null;
                if (user == null) {
                    await this.sleep(1000);
                    users = await Config.db.query<Base>({ query: { _type: "code", "code": code }, top: 10, collectionname: "oauthtokens", jwt: Crypt.rootToken() }, span);
                    user = users.length ? users[0] as any : null;
                }
                if (user == null) {
                    await this.sleep(1000);
                    users = await Config.db.query<Base>({ query: { _type: "code", "code": code }, top: 10, collectionname: "oauthtokens", jwt: Crypt.rootToken() }, span);
                    user = users.length ? users[0] as any : null;
                }
                if (user == null) {
                    Logger.instanse.error("[OAuth] getAuthorizationCode, unkown code '" + code + "'");
                    return null;
                }
                if (user != null) { this.codes[code] = user; }
            }
            const client_id: string = this.codes[code].client_id;
            if (user == null) return null;
            this.revokeAuthorizationCode(code);
            const redirect_uri = (user as any).redirect_uri;
            const expiresAt = new Date((new Date).getTime() + (1000 * Config.oauth_access_token_lifetime));
            var tuser = TokenUser.From(user);
            let client = this.getClientById(client_id);
            if (NoderedUtil.IsNullUndefinded(client)) return null;

            let role = client.defaultrole;
            const keys: string[] = Object.keys(client.rolemappings);
            for (let i = 0; i < keys.length; i++) {
                if (tuser.HasRoleName(keys[i])) role = client.rolemappings[keys[i]];
            }
            const result = {
                code: code,
                client: this.clients[0],
                user: {
                    id: user.id,
                    _id: user.id,
                    name: user.fullname,
                    username: user.username,
                    email: user.username,
                    role: role
                },
                expiresAt: expiresAt,
                redirectUri: redirect_uri
            }
            // node-bb username hack
            if (result.user.name == result.user.email && result.user.email.indexOf("@") > -1) {
                result.user.name = result.user.email.substr(0, result.user.email.indexOf("@") - 1);
            }
            if (result.user.name == result.user.email && result.user.email.indexOf("@") == -1) {
                result.user.email = result.user.email + "@unknown.local"
            }
            if (result.user.name == result.user.email) {
                result.user.name = "user " + result.user.email;
            }
            return result;
        } catch (error) {
            span?.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public async revokeAuthorizationCode(code) {
        if (typeof code !== "string") { code = code.code; }
        Logger.instanse.info("[OAuth] revokeAuthorizationCode " + code);
        delete this.codes[code];
        const refreshTokenExpiresAt = new Date((new Date).getTime() - (1000 * Config.oauth_refresh_token_lifetime)).toISOString();
        const accessTokenExpiresAt = new Date((new Date).getTime() - (1000 * Config.oauth_access_token_lifetime)).toISOString();
        const codeExpiresAt = new Date((new Date).getTime() - (1000 * 120)).toISOString();
        await Config.db.DeleteMany({
            "$or":
                [
                    { "_type": "code", "_created": { "$lte": codeExpiresAt } },
                    { "_type": "token", "refreshTokenExpiresAt": { "$lte": refreshTokenExpiresAt } },
                    { "_type": "token", "accessTokenExpiresAt": { "$lte": accessTokenExpiresAt } }
                ]
        }, null, "oauthtokens", Crypt.rootToken(), null);
        // await Config.db.DeleteMany({ "_type": "code", "code": code }, null, "oauthtokens", Crypt.rootToken());
        await Config.db.DeleteMany({ "_type": "code", "_created": { "$lte": codeExpiresAt } }, null, "oauthtokens", Crypt.rootToken(), null);
        return true;
        // const user: TokenUser = this.codes[code];
        // if (user != null) delete this.codes[code];
        // return code;
    }
    public static tokenCache: CachedToken[] = [];
    private static async getCachedAccessToken(accessToken: string): Promise<any> {
        await semaphore.down();
        for (let i = this.tokenCache.length - 1; i >= 0; i--) {
            var res: CachedToken = this.tokenCache[i];
            var begin: number = res.firstsignin.getTime();
            var end: number = new Date().getTime();
            var seconds = Math.round((end - begin) / 1000);
            if (seconds > Config.oauth_token_cache_seconds) {
                this.tokenCache.splice(i, 1);
            } else if (res.token.accessToken == accessToken) {
                semaphore.up();
                return res.token;
            }
        }
        semaphore.up();
        return null;
    }
    private static async getCachedRefreshToken(refreshToken: string): Promise<any> {
        await semaphore.down();
        for (let i = this.tokenCache.length - 1; i >= 0; i--) {
            var res: CachedToken = this.tokenCache[i];
            var begin: number = res.firstsignin.getTime();
            var end: number = new Date().getTime();
            var seconds = Math.round((end - begin) / 1000);
            if (seconds > Config.oauth_token_cache_seconds) {
                this.tokenCache.splice(i, 1);
            } else if (res.token.refreshToken == refreshToken) {
                semaphore.up();
                return res.token;
            }
        }
        semaphore.up();
        return null;
    }
    private static async addToken(token: any) {
        await semaphore.down();
        var cuser: CachedToken = new CachedToken(token);
        this.tokenCache.push(cuser);
        semaphore.up();

    }
}
export class CachedToken {
    public firstsignin: Date;
    constructor(
        public token: any
    ) {
        this.firstsignin = new Date();
    }
}
interface HashTable<T> {
    [key: string]: T;
}
const Semaphore = (n) => ({
    n,
    async down() {
        while (this.n <= 0) await this.wait();
        this.n--;
    },
    up() {
        this.n++;
    },
    async wait() {
        if (this.n <= 0) return await new Promise((res, req) => {
            setImmediate(async () => res(await this.wait()))
        });
        return;
    },
});
const semaphore = Semaphore(1);




export class Account {
    constructor(public accountId: string, public user: TokenUser) {
        Logger.DBHelper.DeleteKey("user" + accountId);
        if (user == null) throw new Error("Cannot create Account from null user for id ${this.accountId}");
        user = Object.assign(user, { accountId: accountId, sub: accountId });
        // node-bb username hack
        if (NoderedUtil.IsNullEmpty(user.email)) user.email = user.username;
        if (user.name == user.email && user.email.indexOf("@") > -1) {
            user.name = user.email.substr(0, user.email.indexOf("@") - 1);
        }
        if (user.name == user.email && user.email.indexOf("@") == -1) {
            user.email = user.email + "@unknown.local"
        }
        if (user.name == user.email) {
            user.name = "user " + user.email;
        }
    }
    claims() {
        return this.user;
    }
    static async findAccount(ctx: KoaContextWithOIDC, id, test): Promise<any> {
        let acc = await Logger.DBHelper.memoryCache.get("oidc" + id);
        if (acc == null) {
            acc = await Logger.DBHelper.FindById(id, undefined, undefined);
        }
        var res = new Account(id, TokenUser.From(acc))
        return res;
    }
    static AddAccount(tuser: TokenUser, client: any) {
        try {
            let role = client.defaultrole;
            const keys: string[] = Object.keys(client.rolemappings);
            Logger.instanse.info("[OAuth][" + tuser.username + "] Lookup roles for " + tuser.username);
            for (let i = 0; i < keys.length; i++) {
                if (tuser.HasRoleName(keys[i])) {
                    Logger.instanse.info("[OAuth][" + tuser.username + "] User has role " + keys[i] + " set role " + client.rolemappings[keys[i]]);
                    role = client.rolemappings[keys[i]];
                }
            }
            (tuser as any).role = role;
            Logger.DBHelper.memoryCache.set("oidc" + tuser._id, tuser);
            // DBHelper.DeleteKey("user" + tuser._id);
            var res = new Account(tuser._id, tuser);
            return res;
        } catch (error) {
            console.error(error);
        }
        return undefined;
    }
    static async GetTokenRequest(code: string, parent: Span) {
        let tokens = await Config.db.query<Base>({ query: { _type: "tokenrequest", "code": code }, top: 1, collectionname: "oauthtokens", jwt: Crypt.rootToken() }, parent);
        if (tokens.length == 0) return null;
        return tokens[0];
    }
    static async AddTokenRequest(code: string, item: Base, parent: Span) {
        var q: InsertOrUpdateOneMessage = new InsertOrUpdateOneMessage();
        q.item = item; q.uniqeness = "_type,code"; q.collectionname = "oauthtokens", q.jwt = Crypt.rootToken();
        q.w = 1; q.j = true;
        let token = await Config.db.InsertOrUpdateOne<Base>(q, parent);
        return token.item;
    }
    static async RemoveTokenRequest(code: string, parent: Span) {
        let tokens = await Config.db.DeleteMany({ _type: "tokenrequest", "code": code }, null, "oauthtokens", Crypt.rootToken(), parent);
        return tokens[0];
    }
}
