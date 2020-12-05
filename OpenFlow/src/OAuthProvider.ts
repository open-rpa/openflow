import * as OAuthServer from "oauth2-server";
import * as winston from "winston";
import * as express from "express";
import { TokenUser, Base, NoderedUtil } from "openflow-api";
import { Config } from "./Config";
import { Crypt } from "./Crypt";
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
                allowExtendedTokenAttributes: true
            });
            Config.db.query<Base>({ _type: "oauthclient" }, null, 10, 0, null, "config", Crypt.rootToken()).then(result => {
                instance.clients = result;
            }).catch(error => {
                instance._logger.error(error);
            });
            (app as any).oauth = instance.oauthServer;
            app.all('/oauth/token', instance.obtainToken.bind(instance));
            app.get('/oauth/login', async (req, res) => {
                if (NoderedUtil.IsNullUndefinded(instance.clients)) {
                    instance.clients = await Config.db.query<Base>({ _type: "oauthclient" }, null, 10, 0, null, "config", Crypt.rootToken());
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
                    instance.clients = await Config.db.query<Base>({ _type: "oauthclient" }, null, 10, 0, null, "config", Crypt.rootToken());
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
        console.log(request.headers);
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
        this._logger.info("[OAuth] getAccessToken " + accessToken);
        let token = await OAuthProvider.getCachedAccessToken(accessToken);
        if (token != null) return token;
        const tokens = await Config.db.query<Base>({ _type: "token", "accessToken": accessToken }, null, 10, 0, null, "oauthtokens", Crypt.rootToken());
        token = tokens.length ? tokens[0] as any : null;
        await OAuthProvider.addToken(token);
        if (token == null) return false;
        return token;
    }
    public async getRefreshToken(refreshToken) {
        this._logger.info("[OAuth] getRefreshToken " + refreshToken);
        let token = await OAuthProvider.getCachedAccessToken(refreshToken);
        if (token != null) return token;
        const tokens = await Config.db.query<Base>({ _type: "token", "refreshToken": refreshToken }, null, 10, 0, null, "oauthtokens", Crypt.rootToken());
        token = tokens.length ? tokens[0] as any : null;
        await OAuthProvider.addToken(token);
        if (token == null) return false;
        return token;
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
        await Config.db.InsertOne(result, "oauthtokens", 0, false, Crypt.rootToken());
        return result;
    }
    public async saveAuthorizationCode(code: string, client: any, user: any, redirect_uri: string) {
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
        await Config.db.InsertOne(codeobject, "oauthtokens", 1, false, Crypt.rootToken());
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
        return codeobject;
    }
    sleep(ms) {
        return new Promise(resolve => {
            setTimeout(resolve, ms)
        })
    }

    public async getAuthorizationCode(code) {
        this._logger.info("[OAuth] getAuthorizationCode " + code);
        let user: any = this.codes[code];
        if (user == null) {
            let users = await Config.db.query<Base>({ _type: "code", "code": code }, null, 10, 0, null, "oauthtokens", Crypt.rootToken());
            user = users.length ? users[0] as any : null;
            if (user == null) {
                await this.sleep(1000);
                users = await Config.db.query<Base>({ _type: "code", "code": code }, null, 10, 0, null, "oauthtokens", Crypt.rootToken());
                user = users.length ? users[0] as any : null;
            }
            if (user == null) {
                await this.sleep(1000);
                users = await Config.db.query<Base>({ _type: "code", "code": code }, null, 10, 0, null, "oauthtokens", Crypt.rootToken());
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
        return result;
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
                // console.log("Return token from cache, using accessToken " + accessToken);
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
                // console.log("Return token from cache, using refreshToken " + refreshToken);
                semaphore.up();
                return res.token;
            }
        }
        semaphore.up();
        return null;
    }
    private static async addToken(token: any) {
        await semaphore.down();
        // console.log("Adding token to cache");
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