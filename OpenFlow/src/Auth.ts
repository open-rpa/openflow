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
    public static getUser(key: string): User {
        var res: CachedUser = this.authorizationCache[key];
        if (res === null || res === undefined) return null;
        var begin: number = res.firstsignin.getTime();
        var end: number = new Date().getTime();
        var seconds = Math.round((end - begin) / 1000);
        if (seconds < Config.api_credential_cache_seconds) {
            // Logger.instanse.info("Return user " + res.user.username + " from cache");
            return res.user;
        }
        this.RemoveUser(key);
        return null;
    }
    public static async RemoveUser(key: string): Promise<void> {
        await semaphore.down();
        if (!NoderedUtil.IsNullUndefinded(this.authorizationCache[key])) {
            Logger.instanse.info("Delete user with key " + key + " from cache");
            delete this.authorizationCache[key];
        }
        semaphore.up();
    }
    public static async AddUser(user: User, key: string): Promise<void> {
        await semaphore.down();
        if (NoderedUtil.IsNullUndefinded(this.authorizationCache[key])) {
            Logger.instanse.info("Adding user " + user.username + " to cache with key " + key);
            var cuser: CachedUser = new CachedUser(user, user._id);
            this.authorizationCache[key] = cuser;
        }
        semaphore.up();
    }
}
export class CachedUser {
    public firstsignin: Date;
    constructor(
        public user: User,
        public _id: string
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