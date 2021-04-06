import * as OAuthServer from "oauth2-server";
import * as winston from "winston";
import * as express from "express";
import { TokenUser, Base, NoderedUtil, User } from "@openiap/openflow-api";
import { Config } from "./Config";
import { Crypt } from "./Crypt";
const fs = require("fs");
import { Provider, KoaContextWithOIDC } from "oidc-provider";
import { MongoAdapter } from "./MongoAdapter";
import { DBHelper } from "./DBHelper";
import { Span } from "@opentelemetry/api";
import { Logger } from "./Logger";
// import * as Provider from "oidc-provider";
const Request = OAuthServer.Request;
const Response = OAuthServer.Response;
export class OAuthProvider {
    private _logger: winston.Logger;
    private app: express.Express;
    public static instance: OAuthProvider = null;
    private clients = [];
    private codes = {};
    public oauthServer: any = null;
    private authorizationCodeStore: any = {};
    public oidc: Provider;
    static async interactionsUrl(ctx: KoaContextWithOIDC, interaction): Promise<any> {
        return "/oidclogin";
        // return `/interaction/${ctx.oidc.uid}`;
    }
    static async logoutSource(ctx, form) {
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
            const jwksresults = await Config.db.query<Base>({ _type: "jwks" }, null, 10, 0, null, "config", Crypt.rootToken(), undefined, undefined, span);
            let jwks = null;
            if (jwksresults.length == 0) {
                jwks = await this.generatekeys();
                jwks._type = "jwks";
                Config.db.InsertOne(jwks, "config", 1, true, Crypt.rootToken(), span);
            } else {
                jwks = jwksresults[0];
            }
            const result = await Config.db.query<Base>({ _type: "oauthclient" }, null, 10, 0, null, "config", Crypt.rootToken(), undefined, undefined, span);
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


                // cli.grant_types = cli.grants;
                // if (cli.grant_types == null) cli.grant_types = ['authorization_code'];
                if (cli.grant_types == null) cli.grant_types = ['implicit', 'authorization_code'];
                // cli.redirect_uris.push("https://localhost.openiap.io/")
            });
            const provider = new Provider(Config.baseurl() + "oidc", {
                clients: instance.clients,
                adapter: MongoAdapter,
                formats: {
                    AccessToken: 'jwt',
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
                        logoutSource: this.logoutSource
                    }
                    // sessionManagement: { enabled: true },
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
                // logoutSource: this.logoutSource,
                // findAccount: this.FindAccount,
                // findAccount: this.findAccount,
                findAccount: Account.findAccount,
                // cookies: {
                //     long: { signed: false, maxAge: 0, path: '/' },
                //     keys: ["Y6SPiXCxDhAJbN7cbydMw5eX1wIrdy8PiWApqEcguss="], // node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
                //     short: {
                //         signed: false,
                //         path: '/',
                //     },
                // },
                cookies: {
                    short: {
                        path: '/',
                    },
                    keys: [Config.oidc_cookie_key], // node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
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
                // const client = await provider.Client.find(this.clientId);
                if (this.postLogoutRedirectUris == null || this.postLogoutRedirectUris.length == 0) return true;
                return orgpostLogoutRedirectUriAllowed(value);
            };
            const orgredirectUriAllowed = provider.Client.prototype.redirectUriAllowed;
            provider.Client.prototype.redirectUriAllowed = function (value) {
                // const client = await provider.Client.find(this.clientId);
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
                    // if (req.user) {
                    //     res.send('["' + (req.user as any).username + '"]');
                    // } else {
                    //     res.send('[]');
                    // }
                    res.send('[]');
                    return;
                }
                if (req.originalUrl.startsWith("/oidc/auth")) {
                    const _session = req.cookies["_session"];
                    const session = req.cookies["session"];
                    var session1 = await this.instance.oidc.Session.find(_session)
                    var session2 = await this.instance.oidc.Session.find(session)
                    if (session1 != null) {
                        const referer: string = req.headers.referer;
                        if (NoderedUtil.IsNullEmpty(referer)) {
                            res.redirect("/oidc/session/end");
                        } else {
                            await session1.destroy();
                            res.redirect(referer);
                        }
                        return;
                    }
                    if (session2 != null) { session2.resetIdentifier(); session2.destroy(); }

                    req.logout();
                }
                instance.oidc.callback(req, res);
            });

            instance.app.use('/oidclogin', async (req, res, next) => {
                if (req && (req as any).user) {
                    // const _session = req.cookies["_session"];
                    // var session1 = await this.instance.oidc.Session.find(_session)
                    // if (session1 != null) {
                    // }
                    res.cookie("originalUrl", "/oidccb", { maxAge: 900000, httpOnly: true });
                    res.redirect("/oidccb");
                } else {
                    res.cookie("originalUrl", "/oidclogin", { maxAge: 900000, httpOnly: true });
                    res.redirect("/login");
                }
            });
            instance.app.use('/oidccb', async (req, res, next) => {
                try {

                    var test = await this.instance.oidc.interactionDetails(req, res);
                    const {
                        uid, prompt, params, session,
                    } = await this.instance.oidc.interactionDetails(req, res);
                    var r = req;
                    var u = req.user;
                    const isAuthenticated: boolean = req.isAuthenticated();
                    if (isAuthenticated) {
                        // if(!NoderedUtil.IsNullEmpty(test.returnTo) ) {
                        //     res.redirect(test.returnTo);
                        //     return;                            
                        // }
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
                    span.recordException(error);
                    if (error.name == "SessionNotFound") {
                        res.redirect(`/`);
                        res.end();
                        return;
                    }
                    res.json(error)

                }
            });
        } catch (error) {
            span.recordException(error);
            instance._logger.error(error);
        }
        Logger.otel.endSpan(span);
    }
    static configure(logger: winston.Logger, app: express.Express): OAuthProvider {
        const instance = new OAuthProvider();
        try {


            OAuthProvider.instance = instance;
            instance._logger = logger;
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
                        instance.clients = await Config.db.query<Base>({ _type: "oauthclient" }, null, 10, 0, null, "config", Crypt.rootToken(), undefined, undefined, span);
                        if (instance.clients == null || instance.clients.length == 0) return res.status(500).json({ message: 'OAuth not configured' });
                    }
                    let state = (req.params.state ? req.params.state : req.params["amp;state"]);
                    if (state == null) state = encodeURIComponent((req.query.state ? req.query.state : req.query["amp;state"]) as any);
                    const access_type = (req.query.access_type ? req.query.access_type : req.query["amp;access_type"]);
                    const client_id = (req.query.client_id ? req.query.client_id : req.query["amp;client_id"]);
                    const redirect_uri = (req.query.redirect_uri ? req.query.redirect_uri : req.query["amp;redirect_uri"]) as string;
                    const response_type = (req.query.response_type ? req.query.response_type : req.query["amp;response_type"]);
                    const scope = (req.query.scope ? req.query.scope : req.query["amp;scope"]);
                    let client = instance.getClientById(client_id);
                    if (NoderedUtil.IsNullUndefinded(client)) {
                        instance.clients = await Config.db.query<Base>({ _type: "oauthclient" }, null, 10, 0, null, "config", Crypt.rootToken(), undefined, undefined, span);
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
                        const code = Math.random().toString(36).substr(2, 9);

                        instance._logger.info("[OAuth][" + (req.user as any).username + "] /oauth/login " + state);
                        instance.saveAuthorizationCode(code, client, req.user, redirect_uri);
                        res.redirect(`${redirect_uri}?state=${state}&code=${code}`);
                    } else {
                        instance._logger.info("[OAuth][anon] /oauth/login " + state);
                        res.cookie("originalUrl", req.originalUrl, { maxAge: 900000, httpOnly: true });
                        res.redirect("/login");
                    }
                } catch (error) {
                    span.recordException(error);
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
    }
    authorize(req, res) {
        this._logger.info("[OAuth] authorize");
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
        this._logger.info("[OAuth] obtainToken");
        const request = new Request(req);
        const response = new Response(res);
        return this.oauthServer.token(request, response)
            .then((token) => {
                this._logger.info("[OAuth] obtainToken::success: token:");
                res.json(token);
            }).catch((err) => {
                this._logger.info("[OAuth] obtainToken::failed: token:");
                console.error(err);
                res.status(err.code || 500).json(err);
            });
    }
    public async getAccessToken(accessToken) {
        const span: Span = Logger.otel.startSpan("OAuthProvider.getAccessToken");
        try {
            this._logger.info("[OAuth] getAccessToken " + accessToken);
            let token = await OAuthProvider.getCachedAccessToken(accessToken);
            if (token != null) return token;
            const tokens = await Config.db.query<Base>({ _type: "token", "accessToken": accessToken }, null, 10, 0, null, "oauthtokens", Crypt.rootToken(), undefined, undefined, span);
            token = tokens.length ? tokens[0] as any : null;
            await OAuthProvider.addToken(token);
            if (token == null) return false;
            return token;
        } catch (error) {
            span.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public async getRefreshToken(refreshToken) {
        const span: Span = Logger.otel.startSpan("OAuthProvider.getRefreshToken");
        try {
            this._logger.info("[OAuth] getRefreshToken " + refreshToken);
            let token = await OAuthProvider.getCachedAccessToken(refreshToken);
            if (token != null) return token;
            const tokens = await Config.db.query<Base>({ _type: "token", "refreshToken": refreshToken }, null, 10, 0, null, "oauthtokens", Crypt.rootToken(), undefined, undefined, span);
            token = tokens.length ? tokens[0] as any : null;
            await OAuthProvider.addToken(token);
            if (token == null) return false;
            return token;
        } catch (error) {
            span.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public getClient(clientId, clientSecret) {
        this._logger.info("[OAuth] getClient " + clientId);
        const clients = this.clients.filter((client) => {
            return client.clientId === clientId && client.clientSecret === clientSecret;
        });
        return clients.length ? clients[0] : false;
    }
    public getClientById(clientId) {
        this._logger.info("[OAuth] getClientById " + clientId);
        const clients = this.clients.filter((client) => {
            return client.clientId === clientId;
        });
        return clients.length ? clients[0] : null;
    }

    public async saveToken(token, client, user) {
        const span = Logger.otel.startSpan("OAuthProvider.saveToken");
        this._logger.info("[OAuth] saveToken for " + user.name + " in " + client.clientId);
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
        this._logger.info("[OAuth] saveAuthorizationCode " + code);
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
        this._logger.info("[OAuth] saveAuthorizationCode " + code + " saved");
        // instance.codes[code].client_id = client_id;


        // await Config.db.InsertOne(result, "oauthtokens", 0, false, Crypt.rootToken());

        // // const codeToSave: any = this.codes[code];
        // const codeToSave: any = {
        //     'authorizationCode': code.authorizationCode,
        //     'expiresAt': code.expiresAt,
        //     'redirectUri': code.redirectUri,
        //     'scope': code.scope,
        //     'client': client.id,
        //     'user': user.username
        // };
        // this.codes[code] = codeToSave;
        // this.revokeAuthorizationCode(code);
        // code = Object.assign({}, code, {
        //     'client': client.id,
        //     'user': user.username
        // });
        Logger.otel.endSpan(span);
        return codeobject;
    }
    sleep(ms) {
        return new Promise(resolve => {
            setTimeout(resolve, ms)
        })
    }

    public async getAuthorizationCode(code) {
        const span: Span = Logger.otel.startSpan("OAuthProvider.validateToken");
        try {
            this._logger.info("[OAuth] getAuthorizationCode " + code);
            let user: any = this.codes[code];
            if (user == null) {
                let users = await Config.db.query<Base>({ _type: "code", "code": code }, null, 10, 0, null, "oauthtokens", Crypt.rootToken(), undefined, undefined, span);
                user = users.length ? users[0] as any : null;
                if (user == null) {
                    await this.sleep(1000);
                    users = await Config.db.query<Base>({ _type: "code", "code": code }, null, 10, 0, null, "oauthtokens", Crypt.rootToken(), undefined, undefined, span);
                    user = users.length ? users[0] as any : null;
                }
                if (user == null) {
                    await this.sleep(1000);
                    users = await Config.db.query<Base>({ _type: "code", "code": code }, null, 10, 0, null, "oauthtokens", Crypt.rootToken(), undefined, undefined, span);
                    user = users.length ? users[0] as any : null;
                }
                if (user == null) {
                    this._logger.error("[OAuth] getAuthorizationCode, unkown code '" + code + "'");
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
            span.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public async revokeAuthorizationCode(code) {
        if (typeof code !== "string") { code = code.code; }
        this._logger.info("[OAuth] revokeAuthorizationCode " + code);
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
        }, null, "oauthtokens", Crypt.rootToken());
        // await Config.db.DeleteMany({ "_type": "code", "code": code }, null, "oauthtokens", Crypt.rootToken());
        await Config.db.DeleteMany({ "_type": "code", "_created": { "$lte": codeExpiresAt } }, null, "oauthtokens", Crypt.rootToken());
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




const accountStorage = new Map();
export class Account {
    constructor(public accountId: string, public user: TokenUser) {
        accountStorage.set(`Account:${this.accountId}`, this);
        if (user == null) throw new Error("Cannot create Account from null user for id ${this.accountId}");
        user = Object.assign(user, { accountId: accountId, sub: accountId });
        // var roles = [];
        // user.roles.forEach(role => {
        //     roles.push(role.name);
        // });
        // user.roles = roles;

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
    static get storage() {
        return accountStorage;
    }
    claims() {
        return this.user;
    }
    static async findAccount(ctx: KoaContextWithOIDC, id) {
        let acc = accountStorage.get(`Account:${id}`);
        if (!acc) {
            const user = await DBHelper.FindById(id, undefined, undefined);
            acc = new Account(id, TokenUser.From(user));
        }
        return acc;
    }
    static AddAccount(tuser: TokenUser, client: any) {
        try {
            let acc = accountStorage.get(`Account:${tuser._id}`);
            if (!acc) {
                let role = client.defaultrole;
                const keys: string[] = Object.keys(client.rolemappings);
                for (let i = 0; i < keys.length; i++) {
                    if (tuser.HasRoleName(keys[i])) role = client.rolemappings[keys[i]];
                }
                (tuser as any).role = role;
                acc = new Account(tuser._id, tuser);
            }
            return acc;
        } catch (error) {
            console.error(error);
        }
        return undefined;
    }
}