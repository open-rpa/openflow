import { Crypt } from "./Crypt";
import { User, Role, Rolemember, WellknownIds, Rights, NoderedUtil, Base, TokenUser } from "@openiap/openflow-api";
import { Config } from "./Config";
import { Span } from "@opentelemetry/api";
import { Observable } from '@opentelemetry/api-metrics';
import { Logger } from "./Logger";
import { Auth } from "./Auth";
import { WebSocketServerClient } from "./WebSocketServerClient";
import { LoginProvider, Provider } from "./LoginProvider";
import * as cacheManager from "cache-manager";
import { TokenRequest } from "./TokenRequest";
// var cacheManager = require('cache-manager');
var redisStore = require('cache-manager-ioredis');
var mongoStore = require('@skadefro/cache-manager-mongodb');

export class DBHelper {

    public memoryCache: any;
    public mongoCache: any;
    public async init() {
        if (!NoderedUtil.IsNullUndefinded(this.memoryCache)) return;

        this.mongoCache = cacheManager.caching({
            store: mongoStore,
            uri: Config.mongodb_url,
            options: {
                collection: "_cache",
                compression: false,
                poolSize: 5
            }
        });

        if (Config.cache_store_type == "mongodb") {
            this.memoryCache = this.mongoCache;
            this.ensureotel();
            return;
        } else if (Config.cache_store_type == "redis") {
            this.memoryCache = cacheManager.caching({
                store: redisStore,
                host: Config.cache_store_redis_host,
                port: Config.cache_store_redis_port,
                password: Config.cache_store_redis_password,
                ignoreCacheErrors: true,
                db: 0,
                ttl: Config.cache_store_ttl_seconds,
                max: Config.cache_store_max
            })
            // listen for redis connection error event
            var redisClient = this.memoryCache.store.getClient();
            redisClient.on('error', (error) => {
                Logger.instanse.error("DBHelper", "init", error);
            });

            this.ensureotel();
            return;
        }
        this.memoryCache = cacheManager.caching({
            store: 'memory',
            ignoreCacheErrors: true,
            max: Config.cache_store_max,
            ttl: Config.cache_store_ttl_seconds
        });
        this.ensureotel();
    }
    public async clearCache(reason: string) {
        await this.init();
        var keys: string[];
        if (Config.cache_store_type == "redis") {
            keys = await this.memoryCache.keys('*');
        } else {
            keys = await this.memoryCache.keys();
        }
        for (var i = 0; i < keys.length; i++) {
            if (keys[i] && !keys[i].startsWith("requesttoken")) {
                this.memoryCache.del(keys[i]);
            }
        }
        Logger.instanse.debug("DBHelper", "clearCache", "clearCache called with reason: " + reason);
    }
    public async DeleteKey(key) {
        await this.init();
        Logger.instanse.debug("DBHelper", "DeleteKey", "Remove from cache : " + key);
        await this.memoryCache.del(key);
    }
    public item_cache: Observable = null;
    public ensureotel() {
        if (!NoderedUtil.IsNullUndefinded(Logger.otel) && !NoderedUtil.IsNullUndefinded(Logger.otel.meter) && NoderedUtil.IsNullUndefinded(this.item_cache)) {
            this.item_cache = Logger.otel.meter.createObservableGauge("openflow_item_cache_count", {
                description: 'Total number of cached items'
            });
            this.item_cache?.addCallback(async (res) => {
                var keys: any = null;
                try {
                    if (Config.cache_store_type == "redis") {
                        keys = await this.memoryCache.keys('*');
                    } else {
                        keys = await this.memoryCache.keys();
                    }
                } catch (error) {

                }
                if (keys != null) {
                    res.observe(keys.length, { ...Logger.otel.defaultlabels, type: Config.cache_store_type })
                } else {
                    res.observe(0, { ...Logger.otel.defaultlabels, type: Config.cache_store_type })
                }
            })
        }
    }
    public async FindById(_id: string, jwt: string, parent: Span): Promise<User> {
        await this.init();
        const span: Span = Logger.otel.startSubSpan("dbhelper.FindById", parent);
        try {
            if (NoderedUtil.IsNullEmpty(_id)) return null;
            let item = await this.memoryCache.wrap("users" + _id, () => {
                Logger.instanse.debug("DBHelper", "FindById", "Add user to cache : " + _id);
                return Config.db.getbyid<User>(_id, "users", Crypt.rootToken(), true, span);
            });
            this.ensureotel();
            if (NoderedUtil.IsNullUndefinded(item)) return null;
            var res2 = await this.DecorateWithRoles(User.assign<User>(item), span);
            return res2;
        } catch (error) {
            span?.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public async GetProviders(parent: Span): Promise<Provider[]> {
        await this.init();
        const span: Span = Logger.otel.startSubSpan("dbhelper.GetProviders", parent);
        try {
            let items = await this.memoryCache.wrap("providers", () => {
                return Config.db.query<Provider>({ query: { _type: "provider" }, top: 10, collectionname: "config", jwt: Crypt.rootToken() }, span);;
            });
            // const result: Provider[] = [];
            // https://www.w3schools.com/icons/fontawesome5_icons_brands.asp
            items.forEach(provider => {
                // const item: any = { name: provider.name, id: provider.id, provider: provider.provider, logo: "fa-question-circle" };
                provider.logo = "fa-microsoft";
                if (provider.provider === "oidc") { provider.logo = "fa-openid"; }
                if (provider.provider === "google") { provider.logo = "fa-google"; }
                if (provider.provider === "saml") { provider.logo = "fa-windows"; }
                //result.push(item);
            });
            if (items.length === 0) {
                const item: any = { name: "Local", id: "local", provider: "local", logo: "fa-question-circle" };
                items.push(item);
            }
            return items;
        } catch (error) {
            span?.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public async ClearProviders() {
        await this.memoryCache.del("providers");
    }
    public async FindRequestTokenID(key: string, parent: Span): Promise<TokenRequest> {
        await this.init();
        const span: Span = Logger.otel.startSubSpan("dbhelper.FindRequestTokenID", parent);
        try {
            if (NoderedUtil.IsNullEmpty(key)) return null;
            if (Config.cache_store_type == "redis") {
                return await this.memoryCache.get("requesttoken" + key);
            } else {
                return await this.mongoCache.get("requesttoken" + key);
            }
        } catch (error) {
            span?.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public async AdddRequestTokenID(key: string, data: any, parent: Span): Promise<TokenRequest> {
        await this.init();
        const span: Span = Logger.otel.startSubSpan("dbhelper.FindRequestTokenID", parent);
        try {
            if (Config.cache_store_type == "redis") {
                return await this.memoryCache.set("requesttoken" + key, data);
            } else {
                return await this.mongoCache.set("requesttoken" + key, data);
            }
        } catch (error) {
            span?.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public async RemoveRequestTokenID(key: string, parent: Span): Promise<TokenRequest> {
        await this.init();
        const span: Span = Logger.otel.startSubSpan("dbhelper.FindRequestTokenID", parent);
        try {
            if (Config.cache_store_type == "redis") {
                return await this.memoryCache.del("requesttoken" + key);
            } else {
                return await this.mongoCache.del("requesttoken" + key);
            }
        } catch (error) {
            span?.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public async FindByAuthorization(authorization: string, jwt: string, parent: Span): Promise<User> {
        if (!NoderedUtil.IsNullEmpty(authorization) && authorization.indexOf(" ") > 1 &&
            (authorization.toLocaleLowerCase().startsWith("bearer") || authorization.toLocaleLowerCase().startsWith("jwt"))) {
            const token = authorization.split(" ")[1];
            let item: User = await this.memoryCache.wrap(token, () => {
                if (jwt === null || jwt == undefined || jwt == "") { jwt = Crypt.rootToken(); }
                Logger.instanse.debug("DBHelper", "FindByAuthorization", "Add authentication header to cache");
                return LoginProvider.validateToken(token, parent);
            });
            if (NoderedUtil.IsNullUndefinded(item)) return null;
            return this.DecorateWithRoles(User.assign(item), parent);
        }
        const b64auth = (authorization || '').split(' ')[1] || ''
        // const [login, password] = new Buffer(b64auth, 'base64').toString().split(':')
        const [login, password] = Buffer.from(b64auth, "base64").toString().split(':')
        if (!NoderedUtil.IsNullEmpty(login) && !NoderedUtil.IsNullEmpty(password)) {
            let item: User = await this.memoryCache.wrap(b64auth, () => {
                if (jwt === null || jwt == undefined || jwt == "") { jwt = Crypt.rootToken(); }
                Logger.instanse.debug("DBHelper", "FindByAuthorization", "Add basicauth header to cache");
                return Auth.ValidateByPassword(login, password, parent);
            });
            if (NoderedUtil.IsNullUndefinded(item)) return null;
            return this.DecorateWithRoles(User.assign(item), parent);
        }
    }
    public async FindQueueById(_id: string, jwt: string, parent: Span): Promise<User> {
        await this.init();
        const span: Span = Logger.otel.startSubSpan("dbhelper.FindById", parent);
        try {
            if (NoderedUtil.IsNullEmpty(_id)) return null;
            let item = await this.memoryCache.wrap("mq" + _id, () => {
                if (jwt === null || jwt == undefined || jwt == "") { jwt = Crypt.rootToken(); }
                Logger.instanse.debug("DBHelper", "FindQueueById", "Add queue to cache : " + _id);
                return Config.db.getbyid<User>(_id, "mq", jwt, true, span);
            });
            if (NoderedUtil.IsNullUndefinded(item)) return null;
            return this.DecorateWithRoles(User.assign(item), span);
        } catch (error) {
            span?.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public async FindQueueByName(name: string, jwt: string, parent: Span): Promise<User> {
        await this.init();
        const span: Span = Logger.otel.startSubSpan("dbhelper.FindById", parent);
        try {
            if (NoderedUtil.IsNullEmpty(name)) return null;
            let item = await this.memoryCache.wrap("queuename_" + name, () => {
                if (jwt === null || jwt == undefined || jwt == "") { jwt = Crypt.rootToken(); }
                Logger.instanse.debug("DBHelper", "FindQueueByName", "Add queue to cache : " + name);
                return Config.db.GetOne<User>({ query: { name }, collectionname: "mq", jwt }, span);
            });
            if (NoderedUtil.IsNullUndefinded(item)) return null;
            return this.DecorateWithRoles(User.assign(item), span);
        } catch (error) {
            span?.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public async FindExchangeById(_id: string, jwt: string, parent: Span): Promise<User> {
        await this.init();
        const span: Span = Logger.otel.startSubSpan("dbhelper.FindById", parent);
        try {
            if (NoderedUtil.IsNullEmpty(_id)) return null;
            let item = await this.memoryCache.wrap("mq" + _id, () => {
                if (jwt === null || jwt == undefined || jwt == "") { jwt = Crypt.rootToken(); }
                Logger.instanse.debug("DBHelper", "FindExchangeById", "Add exchange to cache : " + _id);
                return Config.db.getbyid<User>(_id, "mq", jwt, true, span);
            });
            if (NoderedUtil.IsNullUndefinded(item)) return null;
            return this.DecorateWithRoles(User.assign(item), span);
        } catch (error) {
            span?.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public async FindExchangeByName(name: string, jwt: string, parent: Span): Promise<User> {
        await this.init();
        const span: Span = Logger.otel.startSubSpan("dbhelper.FindById", parent);
        try {
            if (NoderedUtil.IsNullEmpty(name)) return null;
            let item = await this.memoryCache.wrap("exchangename_" + name, () => {
                if (jwt === null || jwt == undefined || jwt == "") { jwt = Crypt.rootToken(); }
                Logger.instanse.debug("DBHelper", "FindExchangeByName", "Add exchange to cache : " + name);
                return Config.db.GetOne<User>({ query: { name }, collectionname: "mq", jwt }, span);
            });
            if (NoderedUtil.IsNullUndefinded(item)) return null;
            return this.DecorateWithRoles(User.assign(item), span);
        } catch (error) {
            span?.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public async FindRoleById(_id: string, jwt: string, parent: Span): Promise<Role> {
        await this.init();
        const span: Span = Logger.otel.startSubSpan("dbhelper.FindById", parent);
        try {
            if (NoderedUtil.IsNullEmpty(_id)) return null;
            let item = await this.memoryCache.wrap("users" + _id, () => {
                if (jwt === null || jwt == undefined || jwt == "") { jwt = Crypt.rootToken(); }
                Logger.instanse.debug("DBHelper", "FindRoleById", "Add role to cache : " + _id);
                return Config.db.getbyid<User>(_id, "users", jwt, true, span);
            });
            if (NoderedUtil.IsNullUndefinded(item)) return null;
            return Role.assign(item);
        } catch (error) {
            span?.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public async FindByUsername(username: string, jwt: string, parent: Span): Promise<User> {
        await this.init();
        const span: Span = Logger.otel.startSubSpan("dbhelper.FindByUsername", parent);
        try {
            if (NoderedUtil.IsNullEmpty(username)) return null;
            let item = await this.memoryCache.wrap("username_" + username, () => {
                if (jwt === null || jwt == undefined || jwt == "") { jwt = Crypt.rootToken(); }
                Logger.instanse.debug("DBHelper", "FindByUsername", "Add user to cache : " + username);
                return Config.db.getbyusername<User>(username, null, jwt, true, span);
            });
            if (NoderedUtil.IsNullUndefinded(item)) return null;
            return this.DecorateWithRoles(User.assign(item), span);
        } catch (error) {
            span?.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public async GetDisposableDomain(domain: string, parent: Span): Promise<Base> {
        await this.init();
        if (domain.indexOf("@") > -1) {
            domain = domain.substring(domain.indexOf("@") + 1);
        }
        const span: Span = Logger.otel.startSubSpan("dbhelper.FindByUsername", parent);
        try {
            if (NoderedUtil.IsNullEmpty(domain)) return null;
            let item = await this.memoryCache.wrap("disposable_" + domain, () => {
                const jwt = Crypt.rootToken();
                Logger.instanse.debug("DBHelper", "IsDisposableDomain", "Add to cache : " + domain);
                const query = { name: domain, "_type": "disposable" };
                return Config.db.GetOne<Base>({ query, collectionname: "domains", jwt }, span);
            });
            if (NoderedUtil.IsNullUndefinded(item)) return null;
            return item;
        } catch (error) {
            span?.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public async FindByUsernameOrFederationid(username: string, issuer: string, parent: Span): Promise<User> {
        await this.init();
        const span: Span = Logger.otel.startSubSpan("dbhelper.FindByUsername", parent);
        try {
            if (NoderedUtil.IsNullEmpty(username)) return null;
            let item = await this.memoryCache.wrap("federation_" + username, () => {
                const jwt = Crypt.rootToken();
                Logger.instanse.debug("DBHelper", "FindByUsername", "Add user to cache : " + username);
                return Config.db.getbyusername<User>(username, issuer, jwt, true, span);
            });
            if (NoderedUtil.IsNullUndefinded(item)) return null;
            return this.DecorateWithRoles(User.assign(item), span);
        } catch (error) {
            span?.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }

    }
    public async DecorateWithRoles<T extends TokenUser | User>(user: T, parent: Span): Promise<T> {
        await this.init();
        const span: Span = Logger.otel.startSubSpan("dbhelper.DecorateWithRoles", parent);
        try {
            if (NoderedUtil.IsNullUndefinded(user)) return null;
            if (!Config.decorate_roles_fetching_all_roles) {
                if (!user.roles) user.roles = [];
                const results = await this.memoryCache.wrap("userroles_" + user._id, () => {
                    Logger.instanse.debug("DBHelper", "DecorateWithRoles", "Add userroles to cache : " + user.name);
                    const pipe: any = [{ "$match": { "_id": user._id } },
                    {
                        "$graphLookup": {
                            from: "users",
                            startWith: "$_id",
                            connectFromField: "_id",
                            connectToField: "members._id",
                            as: "roles",
                            maxDepth: Config.max_recursive_group_depth,
                            depthField: "depth"
                            , restrictSearchWithMatch: { "_type": "role" }
                            // , "_id": { $nin: Config.db.WellknownIdsArray }, "members._id": { $nin: Config.db.WellknownIdsArray }
                        }
                    }, {
                        "$graphLookup": {
                            from: "users",
                            startWith: "$_id",
                            connectFromField: "members._id",
                            connectToField: "members._id",
                            as: "roles2",
                            maxDepth: 0,
                            depthField: "depth",
                            restrictSearchWithMatch: { "_type": "role" }
                        }
                    },
                    {
                        "$project": {
                            _id: 1,
                            name: 1,
                            username: 1,
                            roles: {
                                $map: {
                                    input: "$roles",
                                    as: "roles",
                                    in: {
                                        "name": "$$roles.name",
                                        "_id": "$$roles._id"
                                    }
                                }
                            },
                            roles2: {
                                $map: {
                                    input: "$roles2",
                                    as: "roles2",
                                    in: {
                                        "name": "$$roles2.name",
                                        "_id": "$$roles2._id"
                                    }
                                }
                            }

                        }
                    }
                    ]
                    return Config.db.aggregate<User>(pipe, "users", Crypt.rootToken(), null, span);
                });

                if (results.length > 0) {
                    user.roles = [];
                    results[0].roles.forEach(r => {
                        const exists = user.roles.filter(x => x._id == r._id);
                        if (exists.length == 0) user.roles.push(r);
                    });
                    results[0].roles2.forEach(r => {
                        const exists = user.roles.filter(x => x._id == r._id);
                        if (exists.length == 0) user.roles.push(r);
                    });
                }
                let hasusers = user.roles.filter(x => x._id == WellknownIds.users);
                if (hasusers.length == 0) {
                    user.roles.push(new Rolemember("users", WellknownIds.users));
                }
                return user;
            }
            let cached_roles = await this.memoryCache.wrap("allroles", () => {
                Logger.instanse.debug("DBHelper", "DecorateWithRoles", "Add all roles");
                return Config.db.query<Role>({ query: { _type: "role" }, projection: { "name": 1, "members": 1 }, top: Config.expected_max_roles, collectionname: "users", jwt: Crypt.rootToken() }, span);
            });
            if (cached_roles.length === 0 && user.username !== "root") {
                throw new Error("System has no roles !!!!!!");
            }
            user.roles = [];
            for (let role of cached_roles) {
                let isMember: number = -1;
                if (role.members !== undefined) { isMember = role.members.map(function (e: Rolemember): string { return e._id; }).indexOf(user._id); }
                if (isMember > -1) {
                    user.roles.push(new Rolemember(role.name, role._id));
                }
            }
            let hasusers = user.roles.filter(x => x._id == WellknownIds.users);
            if (hasusers.length == 0) {
                user.roles.push(new Rolemember("users", WellknownIds.users));
            }
            let updated: boolean = false;
            do {
                updated = false;
                for (let userrole of user.roles) {
                    for (let role of cached_roles) {
                        let isMember: number = -1;
                        if (role.members !== undefined) { isMember = role.members.map(function (e: Rolemember): string { return e._id; }).indexOf(userrole._id); }
                        if (isMember > -1) {
                            const beenAdded: number = user.roles.map(function (e: Rolemember): string { return e._id; }).indexOf(role._id);
                            if (beenAdded === -1) {
                                user.roles.push(new Rolemember(role.name, role._id));
                                updated = true;
                            }
                        }
                    }
                }
            } while (updated)
            user.roles.sort((a, b) => a.name.localeCompare(b.name));
        } catch (error) {
            span?.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
        return user as any;
    }
    public async FindRoleByName(name: string, jwt: string, parent: Span): Promise<Role> {
        await this.init();
        const span: Span = Logger.otel.startSubSpan("dbhelper.FindByUsername", parent);
        try {
            let item = await this.memoryCache.wrap("rolename_" + name, async () => {
                if (jwt === null || jwt == undefined || jwt == "") { jwt = Crypt.rootToken(); }
                Logger.instanse.debug("DBHelper", "FindRoleByName", "Add role to cache : " + name);
                return Config.db.GetOne<Role>({ query: { name: name, "_type": "role" }, collectionname: "users", jwt }, parent)
            });
            if (NoderedUtil.IsNullUndefinded(item)) return null;
            return Role.assign(item);
        } catch (error) {
            span?.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public async Save(item: User | Role, jwt: string, parent: Span): Promise<void> {
        await Config.db._UpdateOne(null, item, "users", 2, false, jwt, parent);
    }
    public async EnsureRole(jwt: string, name: string, id: string, parent: Span): Promise<Role> {
        const span: Span = Logger.otel.startSubSpan("dbhelper.EnsureRole", parent);
        try {
            Logger.instanse.verbose("DBHelper", "EnsureRole", `FindRoleByName ${name}`);
            let role: Role = await this.FindRoleByName(name, jwt, span);
            if (role == null) {
                Logger.instanse.verbose("DBHelper", "EnsureRole", `EnsureRole FindRoleById ${name}`);
                role = await this.FindRoleById(id, null, span);
            }
            if (role !== null && (role._id === id || NoderedUtil.IsNullEmpty(id))) { return role; }
            if (role !== null && !NoderedUtil.IsNullEmpty(role._id)) {
                Logger.instanse.warn("DBHelper", "EnsureRole", `Deleting ${name} with ${role._id} not matcing expected id ${id}`);
                await Config.db.DeleteOne(role._id, "users", false, jwt, span);
            }
            role = new Role(); role.name = name; role._id = id;
            Logger.instanse.verbose("DBHelper", "EnsureRole", `Adding new role ${name}`);
            role = await Config.db.InsertOne(role, "users", 0, false, jwt, span);
            role = Role.assign(role);
            Base.addRight(role, WellknownIds.admins, "admins", [Rights.full_control]);
            Base.addRight(role, role._id, role.name, [Rights.full_control]);
            Base.removeRight(role, role._id, [Rights.delete]);
            Logger.instanse.verbose("DBHelper", "EnsureRole", `Updating ACL for new role ${name}`);
            await this.Save(role, jwt, span);
            return Role.assign(role);
        } catch (error) {
            span?.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public async EnsureUser(jwt: string, name: string, username: string, id: string, password: string, extraoptions: any, parent: Span): Promise<User> {
        const span: Span = Logger.otel.startSubSpan("dbhelper.ensureUser", parent);
        try {
            span?.addEvent("FindByUsernameOrId");
            Logger.instanse.verbose("DBHelper", "EnsureUser", `FindById ${name} ${id}`);
            let user = await this.FindById(id, null, span);
            if (user == null) {
                Logger.instanse.verbose("DBHelper", "EnsureUser", `FindByUsername ${username}`);
                user = await this.FindByUsername(username, null, span);
            }
            if (user !== null && (user._id === id || id === null)) { return user; }
            if (user !== null && id !== null) {
                span?.addEvent("Deleting");
                Logger.instanse.warn("DBHelper", "EnsureUser", `Deleting ${name} with ${user._id} not matcing expected id ${id}`);
                await Config.db.DeleteOne(user._id, "users", false, jwt, span);
            }
            user = new User();
            if (!NoderedUtil.IsNullUndefinded(extraoptions)) user = Object.assign(user, extraoptions);
            user._id = id; user.name = name; user.username = username;
            if (password !== null && password !== undefined && password !== "") {
                span?.addEvent("SetPassword");
                await Crypt.SetPassword(user, password, span);
            } else {
                span?.addEvent("SetPassword");
                await Crypt.SetPassword(user, Math.random().toString(36).substr(2, 9), span);
            }
            span?.addEvent("Insert user");
            Logger.instanse.verbose("DBHelper", "EnsureUser", `Adding new user ${name}`);
            user = await Config.db.InsertOne(user, "users", 0, false, jwt, span);
            user = User.assign(user);
            span?.addEvent("DecorateWithRoles");
            Logger.instanse.verbose("DBHelper", "EnsureRole", `Decorating new user ${name} with roles`);
            user = await this.DecorateWithRoles(user, span);
            span?.addEvent("return user");
            return user;
        } catch (error) {
            span?.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public async EnsureNoderedRoles(user: TokenUser | User, jwt: string, force: boolean, parent: Span): Promise<void> {
        if (Config.auto_create_personal_nodered_group || force) {
            let name = user.username;
            // name = name.split("@").join("").split(".").join("");
            // name = name.toLowerCase();
            name = name.toLowerCase();
            name = name.replace(/([^a-z0-9]+){1,63}/gi, "");


            let noderedadmins = await this.FindRoleByName(name + "noderedadmins", jwt, parent);
            if (noderedadmins == null) {
                noderedadmins = await this.EnsureRole(jwt, name + "noderedadmins", null, parent);
                Base.addRight(noderedadmins, user._id, user.username, [Rights.full_control]);
                Base.removeRight(noderedadmins, user._id, [Rights.delete]);
                noderedadmins.AddMember(user as User);
                await this.Save(noderedadmins, jwt, parent);
            }
        }
        if (Config.auto_create_personal_noderedapi_group || force) {
            let name = user.username;
            // name = name.split("@").join("").split(".").join("");
            // name = name.toLowerCase();
            name = name.toLowerCase();
            name = name.replace(/([^a-z0-9]+){1,63}/gi, "");

            let noderedadmins = await this.FindRoleByName(name + "nodered api users", jwt, parent);
            if (noderedadmins == null) {
                noderedadmins = await this.EnsureRole(jwt, name + "nodered api users", null, parent);
                Base.addRight(noderedadmins, user._id, user.username, [Rights.full_control]);
                Base.removeRight(noderedadmins, user._id, [Rights.delete]);
                noderedadmins.AddMember(user as User);
                await this.Save(noderedadmins, jwt, parent);
            }
        }
    }
    public async UpdateHeartbeat(cli: WebSocketServerClient): Promise<any> {
        if (NoderedUtil.IsNullUndefinded(cli) || NoderedUtil.IsNullUndefinded(cli.user)) return null;
        const dt = new Date(new Date().toISOString());
        const updatedoc = { _heartbeat: dt, lastseen: dt, clientagent: cli.clientagent, clientversion: cli.clientversion, remoteip: cli.remoteip };
        cli.user._heartbeat = dt; cli.user.lastseen = dt;
        if (cli.clientagent == "openrpa") {
            cli.user._rpaheartbeat = dt;
            return { $set: { ...updatedoc, _rpaheartbeat: new Date(new Date().toISOString()), _lastopenrpaclientversion: cli.clientversion } };
        }
        if (cli.clientagent == "nodered") {
            cli.user._noderedheartbeat = dt;
            return { $set: { ...updatedoc, _noderedheartbeat: new Date(new Date().toISOString()), _lastnoderedclientversion: cli.clientversion } };
        }
        if (cli.clientagent == "webapp" || cli.clientagent == "aiotwebapp") {
            (cli.user as any)._webheartbeat = dt;
            return { $set: { ...updatedoc, _webheartbeat: new Date(new Date().toISOString()), _lastwebappclientversion: cli.clientversion } };
        }
        if (cli.clientagent == "powershell") {
            cli.user._powershellheartbeat = dt;
            return { $set: { ...updatedoc, _powershellheartbeat: new Date(new Date().toISOString()), _lastpowershellclientversion: cli.clientversion } };
        }
        if (cli.clientagent == "mobileapp" || cli.clientagent == "aiotmobileapp") {
            (cli.user as any)._webheartbeat = dt;
            (cli.user as any)._mobilheartbeat = dt;
            return {
                $set: {
                    ...updatedoc, _webheartbeat: new Date(new Date().toISOString()), _lastwebappclientversion: cli.clientversion
                    , _mobilheartbeat: new Date(new Date().toISOString()), _lastmobilclientversion: cli.clientversion
                }
            };
        }
        else {
            return { $set: updatedoc };
        }
    }
    public async GetIPBlockList(parent: Span): Promise<Base[]> {
        await this.init();
        const span: Span = Logger.otel.startSubSpan("dbhelper.GetIPBlockList", parent);
        try {
            let items = await this.memoryCache.wrap("ipblock", () => {
                return Config.db.query<Base>({ query: { _type: "ipblock" }, projection: { "ips": 1 }, top: 10, collectionname: "config", jwt: Crypt.rootToken() }, span);;
            });
            if (NoderedUtil.IsNullUndefinded(items)) items = [];
            return items;
        } catch (error) {
            span?.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public async ClearIPBlockList() {
        await this.memoryCache.del("ipblock");
    }
}
