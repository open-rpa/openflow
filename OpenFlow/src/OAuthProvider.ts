// import * as OAuthServer from "oauth2-server";
import * as express from "express";
import { TokenUser, Base, NoderedUtil, User, InsertOrUpdateOneMessage } from "@openiap/openflow-api";
import { Config } from "./Config";
import { Crypt } from "./Crypt";
import { Provider, KoaContextWithOIDC } from "oidc-provider";
import { MongoAdapter } from "./MongoAdapter";
import { Span } from "@opentelemetry/api";
import { Logger } from "./Logger";

// const Request = OAuthServer.Request;
// const Response = OAuthServer.Response;
export class OAuthProvider {
    private app: express.Express;
    public static instance: OAuthProvider = null;
    public clients = [];
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
                    if (cli.signin_url) {
                        ctx.res.cookie("oidcrefere", cli.signin_url, { maxAge: 900000, httpOnly: true });
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
        var oidcrefere = "";
        if (!NoderedUtil.IsNullEmpty(ctx.req.cookies.oidcrefere)) {
            oidcrefere = ctx.req.cookies.oidcrefere;
        }
        ctx.body = `<!DOCTYPE html>
      <head>
      <title>Logout Request</title>
      <style>/* css and html classes omitted for brevity, see lib/helpers/defaults.js */</style>
      </head>
      <body onload="logout()">
      <div>
        <h1>You have successfully signed out from ${ctx.host}</h1>`;
        if (!NoderedUtil.IsNullEmpty(oidcrefere)) {
            ctx.body += `<a href="${ctx.req.cookies.oidcrefere}">Return to ${ctx.req.cookies.oidcrefere}</a> ?`;
        }
        ctx.body += `</div>
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
                    AccessToken: (Config.oidc_access_token_ttl * 60),
                    AuthorizationCode: (Config.oidc_authorization_code_ttl * 60),
                    ClientCredentials: (Config.oidc_client_credentials_ttl * 60),
                    RefreshToken: (Config.oidc_refresh_token_ttl * 60),
                    Session: (Config.oidc_session_ttl * 60)
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
                        'sub', 'name', 'email', 'email_verified', 'role', 'roles'
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
                this.LoadClients();
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
}



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
        if (!NoderedUtil.IsNullUndefinded(user.roles) && Array.isArray(user.roles) && user.roles.length > 0) {
            if (!NoderedUtil.IsNullEmpty(user.roles[0].name)) {
                user.roles = user.roles.map(x => x.name) as any;
            }

        } else {
            user.roles = ["users"] as any;
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
