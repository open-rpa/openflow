import * as express from "express";
import { Config } from "./Config";
import { Logger } from "./Logger";
import { NoderedUtil, TokenUser, WebSocketClient } from "@openiap/openflow-api";

interface HashTable<T> {
    [key: string]: T;
}

export class CachedUser {
    public firstsignin: Date;
    constructor(
        public user: any,
        public jwt: string
    ) {
        this.firstsignin = new Date();
    }
}
export class noderedcontribmiddlewareauth {
    public static authorizationCache: HashTable<CachedUser> = {};

    private static getUser(authorization: string): CachedUser {
        const res: CachedUser = this.authorizationCache[authorization];
        if (res === null || res === undefined) return null;
        const begin: number = res.firstsignin.getTime();
        const end: number = new Date().getTime();
        const seconds = Math.round((end - begin) / 1000);
        if (seconds < Config.api_credential_cache_seconds) { return res; }
        delete this.authorizationCache[authorization];
        return null;
    }

    public static async process(socket: WebSocketClient, req: express.Request, res: express.Response, next: express.NextFunction): Promise<void> {
        if (Config.api_allow_anonymous) {
            return next();
        }
        const authorization: string = req.headers.authorization;
        let cacheduser: CachedUser = this.getUser(authorization);
        if (cacheduser != null) {
            req.user = cacheduser.user;
            (req.user as any).jwt = cacheduser.jwt;
            return next();
        }
        if (!NoderedUtil.IsNullEmpty(authorization) && authorization.indexOf(" ") > 1 &&
            (authorization.toLocaleLowerCase().startsWith("bearer") || authorization.toLocaleLowerCase().startsWith("jwt"))) {
            const token = authorization.split(" ")[1];
            try {
                let result = await NoderedUtil.SigninWithToken({ jwt: token, validate_only: true });
                if (result == null || result.user == null) result = await NoderedUtil.SigninWithToken({ rawAssertion: token, validate_only: true });
                if (result.user != null) {
                    const user: TokenUser = TokenUser.assign(result.user);
                    const allowed = user.roles.filter(x => x.name == "nodered api users" || x.name == Config.noderedadmins || x.name == Config.noderedapiusers);
                    if (allowed.length > 0 && !NoderedUtil.IsNullEmpty(allowed[0].name)) {
                        cacheduser = new CachedUser(result.user, result.jwt);
                        this.authorizationCache[authorization] = cacheduser;
                        Logger.instanse.info("noderedcontribmiddlewareauth: Authorized " + user.username + " for " + req.url);
                        req.user = cacheduser.user;
                        (req.user as any).jwt = cacheduser.jwt;
                        return next();
                    } else {
                        console.warn("noderedcontribmiddlewareauth: " + user.username + " is not member of 'nodered api users' for " + req.url);
                    }
                }
            } catch (error) {
                console.error(error);
                return;
            }
            res.statusCode = 401;
            res.end('Unauthorized');
            return;
        }

        // parse login and password from headers
        const b64auth = (authorization || '').split(' ')[1] || ''
        // const [login, password] = new Buffer(b64auth, 'base64').toString().split(':')
        const [login, password] = Buffer.from(b64auth, "base64").toString().split(':')
        if (login && password) {
            try {
                const result = await NoderedUtil.SigninWithUsername({ username: login, password, validate_only: true });
                if (result.user != null) {
                    const user: TokenUser = TokenUser.assign(result.user);
                    const allowed = user.roles.filter(x => x.name == "nodered api users" || x.name == Config.noderedadmins || x.name == Config.noderedapiusers);
                    if (allowed.length > 0 && !NoderedUtil.IsNullEmpty(allowed[0].name)) {
                        cacheduser = new CachedUser(result.user, result.jwt);
                        this.authorizationCache[authorization] = cacheduser;
                        Logger.instanse.info("noderedcontribmiddlewareauth: Authorized " + user.username + " for " + req.url);
                        req.user = cacheduser.user;
                        (req.user as any).jwt = cacheduser.jwt;
                        return next();
                    } else {
                        console.warn("noderedcontribmiddlewareauth: " + user.username + " is not member of 'nodered api users' for " + req.url);
                    }
                } else {
                    console.warn("noderedcontribmiddlewareauth: failed locating user for " + req.url);
                }
            } catch (error) {
                console.error(error);
            }
        } else {
            Logger.instanse.warn("noderedcontribmiddlewareauth: Unauthorized, no username/password for " + req.url);
        }
        res.statusCode = 401;
        res.setHeader('WWW-Authenticate', 'Basic realm="OpenFlow"');
        res.end('Unauthorized');
        // next();
    }
}