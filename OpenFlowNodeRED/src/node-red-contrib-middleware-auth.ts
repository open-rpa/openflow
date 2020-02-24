import * as express from "express";
import { SigninMessage, Message, TokenUser } from "./Message";
import { WebSocketClient } from "./WebSocketClient";
import { Config } from "./Config";
import { Logger } from "./Logger";

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
        var res: CachedUser = this.authorizationCache[authorization];
        if (res === null || res === undefined) return null;
        var begin: number = res.firstsignin.getTime();
        var end: number = new Date().getTime();
        var seconds = Math.round((end - begin) / 1000);
        if (seconds < Config.api_credential_cache_seconds) { return res; }
        delete this.authorizationCache[authorization];
        return null;
    }

    public static async process(socket: WebSocketClient, req: express.Request, res: express.Response, next: express.NextFunction): Promise<void> {
        if (Config.api_allow_anonymous) {
            return next();
        }
        var cacheduser: CachedUser = this.getUser(req.headers.authorization);
        if (cacheduser != null) {
            req.user = cacheduser.user;
            (req.user as any).jwt = cacheduser.jwt;
            return next();
        }
        // parse login and password from headers
        const b64auth = (req.headers.authorization || '').split(' ')[1] || ''
        // const [login, password] = new Buffer(b64auth, 'base64').toString().split(':')
        const [login, password] = Buffer.from(b64auth, "base64").toString().split(':')
        if (login && password) {
            try {
                var q: SigninMessage = new SigninMessage();
                q.username = login; q.password = password; q.validate_only = true;
                q.clientagent = "nodered";
                q.clientversion = Config.version;
                var msg: Message = new Message(); msg.command = "signin"; msg.data = JSON.stringify(q);
                var result: SigninMessage = await socket.Send<SigninMessage>(msg);
                if (result.user != null) {
                    var user: TokenUser = TokenUser.assign(result.user);
                    var allowed = user.roles.filter(x => x.name == "nodered api users" || x.name == Config.noderedadmins);
                    if (allowed.length === 1) {
                        cacheduser = new CachedUser(result.user, result.jwt);
                        this.authorizationCache[req.headers.authorization] = cacheduser;
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