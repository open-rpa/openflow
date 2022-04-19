import { Crypt } from "./Crypt";
import { NoderedUtil, TokenUser, User } from "@openiap/openflow-api";
import { DBHelper } from "./DBHelper";
import { Span } from "@opentelemetry/api";
import { Logger } from "./Logger";
import { Config } from "./Config";
import { BaseObserver } from "@opentelemetry/api-metrics"
export class Auth {
    public static async ValidateByPassword(username: string, password: string, parent: Span): Promise<User> {
        const span: Span = Logger.otel.startSubSpan("Auth.ValidateByPassword", parent);
        try {
            if (username === null || username === undefined || username === "") { throw Error("Username cannot be null"); }
            span?.setAttribute("username", username);
            if (password === null || password === undefined || password === "") { throw Error("Password cannot be null"); }
            const user: User = await DBHelper.FindByUsername(username, null, span);
            if (user === null || user === undefined) { return null; }
            if ((await Crypt.compare(password, user.passwordhash, span)) !== true) { return null; }
            return user;
        } catch (error) {
            span?.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }

    // public static item_cache: BaseObserver = null;

    // public static authorizationCache: HashTable<CachedUser> = {};
    // private static cacheTimer: NodeJS.Timeout;
    // public static shutdown() {
    //     if (!NoderedUtil.IsNullUndefinded(this.cacheTimer)) {
    //         clearInterval(this.cacheTimer);
    //     }
    // }
    // public static ensureotel() {
    //     if (!NoderedUtil.IsNullUndefinded(Logger.otel) && NoderedUtil.IsNullUndefinded(Auth.item_cache)) {
    //         Auth.item_cache = Logger.otel.meter.createValueObserver("openflow_item_cache_count", {
    //             description: 'Total number of cached items'
    //         }, res => {
    //             let keys: string[] = Object.keys(this.authorizationCache);
    //             let types = {};
    //             for (let i = keys.length - 1; i >= 0; i--) {
    //                 if (!types[this.authorizationCache[keys[i]].type]) types[this.authorizationCache[keys[i]].type] = 0;
    //                 types[this.authorizationCache[keys[i]].type]++;
    //             }
    //             keys = Object.keys(types);
    //             for (let i = keys.length - 1; i >= 0; i--) {
    //                 res.observe(types[keys[i]], { ...Logger.otel.defaultlabels, type: keys[i] })
    //             }
    //         });
    //     }
    // }
    // public static getUser(key: string, type: string): User {
    //     if (NoderedUtil.IsNullUndefinded(this.cacheTimer)) this.cacheTimer = setInterval(this.cleanCache, 60000)
    //     var res: CachedUser = this.authorizationCache[key + type];
    //     if (res === null || res === undefined) {
    //         if (Config.log_cache) Logger.instanse.debug("[" + type + "][" + key + "] not found in cache");
    //         return null;
    //     }
    //     var begin: number = res.firstsignin.getTime();
    //     var end: number = new Date().getTime();
    //     var seconds = Math.round((end - begin) / 1000);
    //     let cache_seconds: number = Config.api_credential_cache_seconds;
    //     if (type == "grafana") cache_seconds = Config.grafana_credential_cache_seconds;
    //     if (type == "dashboard") cache_seconds = Config.dashboard_credential_cache_seconds;
    //     if (type == "cleanacl") cache_seconds = Config.cleanacl_credential_cache_seconds;
    //     if (type == "userroles") cache_seconds = Config.cleanacl_credential_cache_seconds;
    //     if (type == "mq") cache_seconds = Config.mq_credential_cache_seconds;
    //     if (type == "mqe") cache_seconds = Config.mq_credential_cache_seconds;
    //     if (type == "password") cache_seconds = Config.cleanacl_credential_cache_seconds;
    //     if (seconds < cache_seconds) {
    //         Logger.instanse.silly("Return user " + res.user.username + " from cache");
    //         return res.user as User;
    //     }
    //     this.RemoveUser(key, type);
    //     return null;
    // }
    // public static async clearCache(reason: string) {
    //     // DBHelper.cached_roles = [];
    //     if (this.authorizationCache == null || this.authorizationCache == {}) {
    //         if (Config.log_cache) Logger.instanse.debug("clearCache called, but cache was empty, reason: " + reason);
    //         return;
    //     }
    //     Auth.ensureotel();
    //     let keys: string[] = Object.keys(this.authorizationCache);
    //     await Auth.semaphore.down();
    //     this.authorizationCache = {}
    //     Auth.semaphore.up();
    //     if (Config.log_cache) Logger.instanse.debug("clearCache called with " + keys.length + " keys in cache, reason: " + reason);
    // }
    // public static async cleanCache() {
    //     try {
    //         if (this.authorizationCache == null) return;
    //         const keys: string[] = Object.keys(this.authorizationCache);
    //         for (let i = keys.length - 1; i >= 0; i--) {
    //             let key: string = keys[i];
    //             var res: CachedUser = this.authorizationCache[key];
    //             if (res === null || res === undefined) continue;
    //             var begin: number = res.firstsignin.getTime();
    //             var end: number = new Date().getTime();
    //             var seconds = Math.round((end - begin) / 1000);
    //             let cache_seconds: number = Config.api_credential_cache_seconds;
    //             if (res.type == "grafana") cache_seconds = Config.grafana_credential_cache_seconds;
    //             if (res.type == "dashboard") cache_seconds = Config.dashboard_credential_cache_seconds;
    //             if (res.type == "cleanacl") cache_seconds = Config.cleanacl_credential_cache_seconds;
    //             if (res.type == "userroles") cache_seconds = Config.cleanacl_credential_cache_seconds;
    //             if (res.type == "mq") cache_seconds = Config.mq_credential_cache_seconds;
    //             if (res.type == "mqe") cache_seconds = Config.mq_credential_cache_seconds;
    //             if (res.type == "password") cache_seconds = Config.cleanacl_credential_cache_seconds;
    //             if (seconds >= cache_seconds) {
    //                 this.RemoveUser(key, res.type);
    //             }
    //         }
    //         const keys2: string[] = Object.keys(this.authorizationCache);
    //         if (Config.log_cache) Logger.instanse.debug("cleanCache called with " + keys.length + " keys in cache, and " + keys2.length + " after enumeration");
    //     } catch (error) {
    //         Logger.instanse.error(error)
    //     }
    // }
    // public static async RemoveUser(key: string, type: string): Promise<void> {
    //     Auth.ensureotel();
    //     await Auth.semaphore.down();
    //     if (!NoderedUtil.IsNullUndefinded(this.authorizationCache[key + type])) {
    //         if (Config.log_cache) Logger.instanse.debug("Delete user with key " + key + " from cache");
    //         delete this.authorizationCache[key + type];
    //     } else {
    //         if (Config.log_cache) Logger.instanse.debug("RemoveUser user called with " + key + " but was not found in cache");
    //     }
    //     Auth.semaphore.up();
    // }
    // public static async AddUser(user: User | TokenUser, key: string, type: string): Promise<void> {
    //     Auth.ensureotel();
    //     await Auth.semaphore.down();
    //     if (NoderedUtil.IsNullUndefinded(this.authorizationCache[key + type])) {
    //         if (Config.log_cache) Logger.instanse.debug("Adding user " + user.name + " to cache with key " + key);
    //     } else {
    //         if (Config.log_cache) Logger.instanse.debug("Updating user " + user.name + " to cache with key " + key);
    //     }
    //     var cuser: CachedUser = new CachedUser(user, user._id, type);
    //     this.authorizationCache[key + type] = cuser;
    //     Auth.semaphore.up();
    // }
    // public static Semaphore = (n) => ({
    //     n,
    //     async down() {
    //         while (this.n <= 0) await this.wait();
    //         this.n--;
    //     },
    //     up() {
    //         this.n++;
    //     },
    //     async wait() {
    //         if (this.n <= 0) return new Promise((res, req) => {
    //             setImmediate(async () => res(await this.wait()))
    //         });
    //     },
    // });
    // public static semaphore = Auth.Semaphore(1);
}
// export class CachedUser {
//     public firstsignin: Date;
//     constructor(
//         public user: User | TokenUser,
//         public _id: string,
//         public type: string
//     ) {
//         this.firstsignin = new Date();
//     }
// }
// interface HashTable<T> {
//     [key: string]: T;
// }
