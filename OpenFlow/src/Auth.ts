import { Crypt } from "./Crypt";
import { NoderedUtil, User } from "@openiap/openflow-api";
import { DBHelper } from "./DBHelper";
import { Span } from "@opentelemetry/api";
import { Logger } from "./Logger";
import { Config } from "./Config";
export class Auth {
    public static async ValidateByPassword(username: string, password: string, parent: Span): Promise<User> {
        const span: Span = Logger.otel.startSubSpan("Auth.ValidateByPassword", parent);
        try {
            if (username === null || username === undefined || username === "") { throw Error("Username cannot be null"); }
            span.setAttribute("username", username);
            if (password === null || password === undefined || password === "") { throw Error("Password cannot be null"); }
            const user: User = await DBHelper.FindByUsername(username, null, span);
            if (user === null || user === undefined) { return null; }
            if ((await Crypt.compare(password, user.passwordhash, span)) !== true) { return null; }
            return user;
        } catch (error) {
            span.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }

    public static authorizationCache: HashTable<CachedUser> = {};
    private static cacheTimer: NodeJS.Timeout;
    public static shutdown() {
        if (!NoderedUtil.IsNullUndefinded(this.cacheTimer)) {
            clearInterval(this.cacheTimer);
        }
    }
    public static getUser(key: string, type: string): User {
        if (NoderedUtil.IsNullUndefinded(this.cacheTimer)) this.cacheTimer = setInterval(this.cleanCache, 60000)
        var res: CachedUser = this.authorizationCache[key + type];
        if (res === null || res === undefined) return null;
        var begin: number = res.firstsignin.getTime();
        var end: number = new Date().getTime();
        var seconds = Math.round((end - begin) / 1000);
        let cache_seconds: number = Config.api_credential_cache_seconds;
        if (type == "grafana") cache_seconds = Config.grafana_credential_cache_seconds;
        if (type == "dashboard") cache_seconds = Config.dashboard_credential_cache_seconds;
        if (type == "cleanacl") cache_seconds = Config.cleanacl_credential_cache_seconds;
        if (type == "mq") cache_seconds = Config.mq_credential_cache_seconds;
        if (type == "mqe") cache_seconds = Config.mq_credential_cache_seconds;
        if (seconds < cache_seconds) {
            Logger.instanse.silly("Return user " + res.user.username + " from cache");
            return res.user;
        }
        this.RemoveUser(key, type);
        return null;
    }
    public static async clearCache() {
        if (this.authorizationCache == null) return;
        const keys: string[] = Object.keys(this.authorizationCache);
        for (let i = keys.length - 1; i >= 0; i--) {
            let key: string = keys[i];
            var res: CachedUser = this.authorizationCache[key];
            if (res === null || res === undefined) continue;
            this.RemoveUser(key, res.type);
        }
    }
    public static async cleanCache() {
        try {
            if (this.authorizationCache == null) return;
            const keys: string[] = Object.keys(this.authorizationCache);
            for (let i = keys.length - 1; i >= 0; i--) {
                let key: string = keys[i];
                var res: CachedUser = this.authorizationCache[key];
                if (res === null || res === undefined) continue;
                var begin: number = res.firstsignin.getTime();
                var end: number = new Date().getTime();
                var seconds = Math.round((end - begin) / 1000);
                let cache_seconds: number = Config.api_credential_cache_seconds;
                if (res.type == "grafana") cache_seconds = Config.grafana_credential_cache_seconds;
                if (res.type == "dashboard") cache_seconds = Config.dashboard_credential_cache_seconds;
                if (res.type == "cleanacl") cache_seconds = Config.cleanacl_credential_cache_seconds;
                if (res.type == "mq") cache_seconds = Config.mq_credential_cache_seconds;
                if (res.type == "mqe") cache_seconds = Config.mq_credential_cache_seconds;
                if (seconds >= cache_seconds) {
                    this.RemoveUser(key, res.type);
                }
            }
        } catch (error) {
            Logger.instanse.error(error)
        }
    }
    public static async RemoveUser(key: string, type: string): Promise<void> {
        await Auth.semaphore.down();
        if (!NoderedUtil.IsNullUndefinded(this.authorizationCache[key + type])) {
            Logger.instanse.silly("Delete user with key " + key + " from cache");
            delete this.authorizationCache[key + type];
        }
        Auth.semaphore.up();
    }
    public static async AddUser(user: User, key: string, type: string): Promise<void> {
        await Auth.semaphore.down();
        if (NoderedUtil.IsNullUndefinded(this.authorizationCache[key + type])) {
            Logger.instanse.silly("Adding user " + user.name + " to cache with key " + key);
            var cuser: CachedUser = new CachedUser(user, user._id, type);
            this.authorizationCache[key + type] = cuser;
        }
        Auth.semaphore.up();
    }
    public static Semaphore = (n) => ({
        n,
        async down() {
            while (this.n <= 0) await this.wait();
            this.n--;
        },
        up() {
            this.n++;
        },
        async wait() {
            if (this.n <= 0) return new Promise((res, req) => {
                setImmediate(async () => res(await this.wait()))
            });
        },
    });
    public static semaphore = Auth.Semaphore(1);
}
export class CachedUser {
    public firstsignin: Date;
    constructor(
        public user: User,
        public _id: string,
        public type: string
    ) {
        this.firstsignin = new Date();
    }
}
interface HashTable<T> {
    [key: string]: T;
}
