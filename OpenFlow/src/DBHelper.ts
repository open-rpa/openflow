import { Crypt } from "./Crypt.js";
import { User, Role, Rolemember, WellknownIds, Rights, NoderedUtil, Base, TokenUser, WorkitemQueue, Resource, ResourceUsage } from "@openiap/openflow-api";
import { Config } from "./Config.js";
import { Span, Observable } from "@opentelemetry/api";
import { Logger } from "./Logger.js";
import { Auth } from "./Auth.js";
import { WebSocketServerClient } from "./WebSocketServerClient.js";
import { LoginProvider, Provider } from "./LoginProvider.js";
import { caching } from 'cache-manager';
import { TokenRequest } from "./TokenRequest.js";
import { amqpwrapper } from "./amqpwrapper.js";
import { EntityRestriction } from "./EntityRestriction.js";
import { iAgent } from "./commoninterfaces.js";
import { CollectionInfo } from "mongodb";
import { redisStore } from 'cache-manager-ioredis-yet'

export class DBHelper {

    public memoryCache: any;
    // public mongoCache: any;
    public async init() {
        if (!NoderedUtil.IsNullUndefinded(this.memoryCache)) return;

        const ttl = (Config.cache_store_ttl_seconds) * 1000;
        const max = Config.cache_store_max;

        // this.mongoCache = await caching(mongoStore, {
        //     uri: Config.mongodb_url,
        //     options: {
        //         collection: "_cache",
        //         compression: false,
        //         poolSize: 5
        //     }
        // });

        // if (Config.cache_store_type == "mongodb") {
        //     this.memoryCache = this.mongoCache;
        //     this.ensureotel();
        //     return;
        // } else 
        if (Config.cache_store_type == "redis") {

            this.memoryCache = await caching(redisStore, {
                host: Config.cache_store_redis_host,
                port: Config.cache_store_redis_port,
                password: Config.cache_store_redis_password,
                db: 0, ttl,
                isCacheable: (val: unknown) => {
                    return true
                }
            })
            // listen for redis connection error event
            // var redisClient = this.memoryCache.store.getClient();
            // redisClient.on('error', (error) => {
            //     Logger.instanse.error(error, null);
            // });
            this.ensureotel();
            return;
        }
        this.memoryCache = await caching('memory', { max, ttl,
            isCacheable: (val: unknown) => {
                return true
            }
            });
        this.ensureotel();
    }
    public async clearCache(reason: string, span: Span) {
        await this.init();
        var keys: string[];
        if (Config.cache_store_type == "redis") {
            if(this.memoryCache.keys) {
                keys = await this.memoryCache.keys('*');
            } else {
                keys = await this.memoryCache.store.keys('*');
            }
        } else {
            if(this.memoryCache.keys) {
                keys = await this.memoryCache.keys();
            } else {
                keys = await this.memoryCache.store.keys();
            }
        }
        for (var i = 0; i < keys.length; i++) {
            if (keys[i] && !keys[i].startsWith("requesttoken")) {
                this.memoryCache.del(keys[i]);
            }
        }
        Logger.instanse.debug("clearCache called with reason: " + reason, span);
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
                    if (Config.cache_store_type == "redis" && this.memoryCache && this.memoryCache.keys) {
                        keys = await this.memoryCache.keys('*');
                    } else if(this.memoryCache && this.memoryCache.keys) {
                        if(this.memoryCache.keys.get) {
                            keys = await this.memoryCache.keys.get();
                        } else {
                            keys = await this.memoryCache.keys();
                        }
                    } else if(this.memoryCache &&this.memoryCache.store && this.memoryCache.store.keys) {
                        if(this.memoryCache.store.keys.get) {
                            keys = await this.memoryCache.store.keys.get();
                        } else {
                            keys = await this.memoryCache.store.keys();
                        }
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
    public async CheckCache(collectionname: string, item: Base, watch: boolean, frombroadcast: boolean, span: Span): Promise<void> {
        await this.init();
        if (watch && collectionname == "users" && item._id == WellknownIds.root) return;
        if (collectionname == "config" && item._type == "resource") {
            this.ResourceUpdate(item, watch, frombroadcast, span);
        }
        if (collectionname == "users" && (item._type == "user" || item._type == "role" || item._type == "customer")) {
            this.UserRoleUpdate(item, watch, span);
        }
        if (collectionname == "mq") {
            if (item._type == "queue") await this.QueueUpdate(item._id, item.name, watch, span);
            if (item._type == "exchange") await this.ExchangeUpdate(item._id, item.name, watch, span);
            if (item._type == "workitemqueue") await this.WorkitemQueueUpdate(item._id, watch, span);
        }
        if (collectionname == "workitems" && item._type == "workitem") {
            // @ts-ignore
            await this.WorkitemQueueUpdate(item.wiqid, true, span);
        }
        if (collectionname == "config" && (item._type == "restriction" || item._type == "resource" || item._type == "resourceusage")) {
            this.clearCache("watch detected change in " + collectionname + " collection for a " + item._type + " " + item.name, span);
        }
        if (collectionname == "config" && item._type == "provider") {
            await this.ClearProviders();
        }
        if (collectionname == "config" && item._type == "ipblock") {
            await Logger.DBHelper.ClearIPBlockList();
        }
        if (collectionname === "config" && item._type === "restriction") {
            await Logger.DBHelper.ClearEntityRestrictions();
        }
        if( collectionname === "agents" && item._type === "agent") {
            await Logger.DBHelper.AgentUpdate(item._id, (item as any).slug, watch, span);
        }
    }

    async FindByIdWrap(_id, span: Span) {
        Logger.instanse.debug("Add user to cache : " + _id, span);
        return Config.db.getbyid<User>(_id, "users", Crypt.rootToken(), true, span);
    }
    public async FindById(_id: string, parent: Span): Promise<User> {
        await this.init();
        const span: Span = Logger.otel.startSubSpan("dbhelper.FindById", parent);
        try {
            if (NoderedUtil.IsNullEmpty(_id)) return null;
            var key = ("users_" + _id).toString().toLowerCase();
            let item = await this.memoryCache.wrap(key, () => { return this.FindByIdWrap(_id, span) });
            this.ensureotel();
            if (NoderedUtil.IsNullUndefinded(item)) {
                Logger.instanse.debug("No user matches " + _id, span);
                return null;
            }
            Logger.instanse.silly("Return user " + _id + " " + item.formvalidated, span);
            var res2 = await this.DecorateWithRoles(User.assign<User>(item), span);
            return res2;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    private async ResourceUpdate(item: Base, watch: boolean, frombroadcast: boolean, span: Span): Promise<void> {
        await this.init();
        if (item.hasOwnProperty("userid")) {
            // @ts-ignore
            var key = ("resourceusage_" + item.userid).toString().toLowerCase();
            this.DeleteKey(key, watch, frombroadcast, span);
        } else {
            this.DeleteKey("resource", watch, frombroadcast, span);
        }
    }
    public GetResourcesWrap(span: Span) {
        Logger.instanse.debug("Add resources user to cache", span);
        return Config.db.query<Resource>({ query: { "_type": "resource" }, collectionname: "config", jwt: Crypt.rootToken() }, span);
    }
    public async GetResources(parent: Span): Promise<Resource[]> {
        await this.init();
        const span: Span = Logger.otel.startSubSpan("dbhelper.GetResources", parent);
        try {
            let items = await this.memoryCache.wrap("resource", () => { return this.GetResourcesWrap(span) });
            Logger.instanse.silly("Return " + items.length + " resources", span);
            return items;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public GetResourceUsageByUserIDWrap(userid: string, span: Span) {
        Logger.instanse.debug("Add user resources to cache : " + userid, span);
        return Config.db.query<ResourceUsage>({ query: { "_type": "resourceusage", userid }, collectionname: "config", jwt: Crypt.rootToken() }, span);
    }
    public async GetResourceUsageByUserID(userid: string, parent: Span): Promise<ResourceUsage[]> {
        await this.init();
        const span: Span = Logger.otel.startSubSpan("dbhelper.GetResourceUsageByUserID", parent);
        try {
            var key = ("resourceusage_" + userid).toString().toLowerCase();
            let items = await this.memoryCache.wrap(key, () => { return this.GetResourceUsageByUserIDWrap(userid, span) });
            Logger.instanse.silly("Return resources for user " + userid, span);
            return items;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public GetResourceUsageByCustomerIDWrap(customerid: string, span: Span) {
        Logger.instanse.debug("Add Customer resources to cache : " + customerid, span);
        return Config.db.query<ResourceUsage>({ query: { "_type": "resourceusage", customerid }, collectionname: "config", jwt: Crypt.rootToken() }, span);
    }
    public async GetResourceUsageByCustomerID(customerid: string, parent: Span): Promise<ResourceUsage[]> {
        await this.init();
        const span: Span = Logger.otel.startSubSpan("dbhelper.GetResourceUsageByCustomerID", parent);
        try {
            var key = ("resourceusage_" + customerid).toString().toLowerCase();
            let items = await this.memoryCache.wrap(key, () => { return this.GetResourceUsageByCustomerIDWrap(customerid, span) });
            Logger.instanse.silly("Return resources for customer " + customerid, span);
            return items;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public GetProvidersWrap(span) {
        return Config.db.query<Provider>({ query: { _type: "provider" }, top: 10, collectionname: "config", jwt: Crypt.rootToken() }, span);
    }
    public async GetProviders(parent: Span): Promise<Provider[]> {
        await this.init();
        const span: Span = Logger.otel.startSubSpan("dbhelper.GetProviders", parent);
        try {
            let items = await this.memoryCache.wrap("providers", () => { return this.GetProvidersWrap(span) });
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
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    private async ClearProviders() {
        await this.memoryCache.del("providers");
    }
    public GetEntityRestrictionsWrap(span) {
        const rootjwt = Crypt.rootToken()
        return Config.db.query<EntityRestriction>({ query: { "_type": "restriction" }, top: 1000, collectionname: "config", jwt: rootjwt }, span);
    }
    public async GetEntityRestrictions(parent: Span): Promise<EntityRestriction[]> {
        await this.init();
        const span: Span = Logger.otel.startSubSpan("dbhelper.GetProviders", parent);
        try {
            let items = await this.memoryCache.wrap("entityrestrictions", () => { return this.GetEntityRestrictionsWrap(span) });
            let allowadmins = new EntityRestriction();
            allowadmins.copyperm = false; allowadmins.collection = ""; allowadmins.paths = ["$."];
            Base.addRight(allowadmins, WellknownIds.admins, "admins", [Rights.create]);
            items.push(allowadmins);
            for (let i = 0; i < items.length; i++) {
                items[i] = EntityRestriction.assign(items[i]);
            }
            return items;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public async ClearEntityRestrictions() {
        await this.memoryCache.del("entityrestrictions");
    }
    public async FindRequestTokenID(key: string, parent: Span): Promise<TokenRequest> {
        await this.init();
        const span: Span = Logger.otel.startSubSpan("dbhelper.FindRequestTokenID", parent);
        try {
            if (NoderedUtil.IsNullEmpty(key)) return null;
            return await this.memoryCache.get("requesttoken" + key);
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public async AddRequestTokenID(key: string, data: any, parent: Span): Promise<TokenRequest> {
        await this.init();
        const span: Span = Logger.otel.startSubSpan("dbhelper.AddRequestTokenID", parent);
        try {
            return await this.memoryCache.set("requesttoken" + key, data);
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public async RemoveRequestTokenID(key: string, parent: Span): Promise<TokenRequest> {
        await this.init();
        const span: Span = Logger.otel.startSubSpan("dbhelper.RemoveRequestTokenID", parent);
        try {
            return await this.memoryCache.del("requesttoken" + key);
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public FindByAuthorizationWrap(token, jwt, span) {
        if (jwt === null || jwt == undefined || jwt == "") { jwt = Crypt.rootToken(); }
        Logger.instanse.debug("Add authentication header to cache", span);
        return LoginProvider.validateToken(token, span);
    }
    public FindByAuthorizationWrap2(login, password, jwt, span) {
        if (jwt === null || jwt == undefined || jwt == "") { jwt = Crypt.rootToken(); }
        Logger.instanse.debug("Add basicauth header to cache", span);
        return Auth.ValidateByPassword(login, password, span);
    }
    public async FindByAuthorization(authorization: string, jwt: string, span: Span): Promise<User> {
        if (!NoderedUtil.IsNullEmpty(authorization) && authorization.indexOf(" ") > 1 &&
            (authorization.toLocaleLowerCase().startsWith("bearer") || authorization.toLocaleLowerCase().startsWith("jwt"))) {
            const token = authorization.split(" ")[1].toString();
            let item: User = await this.memoryCache.wrap(token, () => { return this.FindByAuthorizationWrap(token, jwt, span) });
            if (NoderedUtil.IsNullUndefinded(item)) return null;
            return this.DecorateWithRoles(User.assign(item), span);
        }
        const b64auth = (authorization || '').split(' ')[1].toString() || ''
        // const [login, password] = new Buffer(b64auth, 'base64').toString().split(':')
        const [login, password] = Buffer.from(b64auth, "base64").toString().split(':')
        if (!NoderedUtil.IsNullEmpty(login) && !NoderedUtil.IsNullEmpty(password)) {
            let item: User = await this.memoryCache.wrap(b64auth, () => { return this.FindByAuthorizationWrap2(login, password, jwt, span) });
            if (NoderedUtil.IsNullUndefinded(item)) return null;
            return this.DecorateWithRoles(User.assign(item), span);
        }
    }
    public FindAgentBySlugOrIdWrap(_id, jwt, span) {
        if (jwt === null || jwt == undefined || jwt == "") { jwt = Crypt.rootToken(); }
        var agentslug = _id;
        if(_id.endsWith("agent")) agentslug = _id.substring(0, _id.length - 5 );
        Logger.instanse.debug("Add queue to cache : " + _id, span);
        return Config.db.GetOne<iAgent>({ query: {"_type": "agent", "$or": [
            { _id },
            { slug: _id }, { slug: agentslug } ]} , collectionname: "agents", jwt }, span);

    }
    public async FindAgentBySlugOrId(_id: string, jwt: string, parent: Span): Promise<iAgent> {
        await this.init();
        const span: Span = Logger.otel.startSubSpan("dbhelper.FindById", parent);
        try {
            if (NoderedUtil.IsNullEmpty(_id)) return null;
            var key = ("agent_" + _id).toString().toLowerCase();
            let item = await this.memoryCache.wrap(key, () => { return this.FindAgentBySlugOrIdWrap(_id, jwt, span) });
            if (NoderedUtil.IsNullUndefinded(item)) return null;
            return item;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public FindQueueByIdWrap(_id, jwt, span) {
        if (jwt === null || jwt == undefined || jwt == "") { jwt = Crypt.rootToken(); }
        Logger.instanse.debug("Add queue to cache : " + _id, span);
        return Config.db.getbyid<User>(_id, "mq", jwt, true, span);
    }
    public async FindQueueById(_id: string, jwt: string, parent: Span): Promise<User> {
        await this.init();
        const span: Span = Logger.otel.startSubSpan("dbhelper.FindById", parent);
        try {
            if (NoderedUtil.IsNullEmpty(_id)) return null;
            var key = ("mq_" + _id).toString().toLowerCase();
            let item = await this.memoryCache.wrap(key, () => { return this.FindQueueByIdWrap(_id, jwt, span) });
            if (NoderedUtil.IsNullUndefinded(item)) return null;
            return this.DecorateWithRoles(User.assign(item), span);
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public FindQueueByNameWrap(name, jwt, span: Span) {
        if (jwt === null || jwt == undefined || jwt == "") { jwt = Crypt.rootToken(); }
        Logger.instanse.debug("Add queue to cache : " + name, span);
        return Config.db.GetOne<User>({ query: {"$or": [
            { name, "_type": "queue" },
            { name: new RegExp(["^", name, "$"].join(""), "i"), "_type": "workitemqueue" },
            { queue: name, "_type": "workitemqueue"}
        ]} , collectionname: "mq", jwt }, span);
        // return Config.db.GetOne<User>({ query: { name }, collectionname: "mq", jwt }, span);
    }
    public async FindQueueByName(name: string, jwt: string, parent: Span): Promise<User> {
        await this.init();
        const span: Span = Logger.otel.startSubSpan("dbhelper.FindById", parent);
        try {
            if (NoderedUtil.IsNullEmpty(name)) return null;
            var key = ("queuename_" + name).toString();
            let item = await this.memoryCache.wrap(key, () => { return this.FindQueueByNameWrap(name, jwt, span) });
            if (NoderedUtil.IsNullUndefinded(item)) return null;
            return this.DecorateWithRoles(User.assign(item), span);
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public FindExchangeByIdWrap(_id: string, jwt: string, span: Span) {
        if (jwt === null || jwt == undefined || jwt == "") { jwt = Crypt.rootToken(); }
        Logger.instanse.debug("Add exchange to cache : " + _id, span);
        return Config.db.getbyid<User>(_id, "mq", jwt, true, span);
    }
    public async FindExchangeById(_id: string, jwt: string, parent: Span): Promise<User> {
        await this.init();
        const span: Span = Logger.otel.startSubSpan("dbhelper.FindById", parent);
        try {
            if (NoderedUtil.IsNullEmpty(_id)) return null;
            var key = ("mq_" + _id).toString().toLowerCase();
            let item = await this.memoryCache.wrap(key, () => { return this.FindExchangeByIdWrap(_id, jwt, span) });
            if (NoderedUtil.IsNullUndefinded(item)) return null;
            return this.DecorateWithRoles(User.assign(item), span);
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public FindExchangeByNameWrap(name: string, jwt: string, span: Span) {
        if (jwt === null || jwt == undefined || jwt == "") { jwt = Crypt.rootToken(); }
        Logger.instanse.debug("Add exchange to cache : " + name, span);
        return Config.db.GetOne<User>({ query: { name }, collectionname: "mq", jwt }, span);
    }
    public async FindExchangeByName(name: string, jwt: string, parent: Span): Promise<User> {
        await this.init();
        const span: Span = Logger.otel.startSubSpan("dbhelper.FindById", parent);
        try {
            if (NoderedUtil.IsNullEmpty(name)) return null;
            var key = ("exchangename_" + name).toString();
            let item = await this.memoryCache.wrap(key, () => { return this.FindExchangeByNameWrap(name, jwt, span) });
            if (NoderedUtil.IsNullUndefinded(item)) return null;
            return this.DecorateWithRoles(User.assign(item), span);
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public FindRoleByIdWrap(_id: string, jwt: string, span: Span) {
        if (jwt === null || jwt == undefined || jwt == "") { jwt = Crypt.rootToken(); }
        Logger.instanse.debug("Add role to cache : " + _id, span);
        return Config.db.getbyid<User>(_id, "users", jwt, true, span);
    }
    public async FindRoleById(_id: string, jwt: string, parent: Span): Promise<Role> {
        await this.init();
        const span: Span = Logger.otel.startSubSpan("dbhelper.FindById", parent);
        try {
            if (NoderedUtil.IsNullEmpty(_id)) return null;
            var key = ("users_" + _id).toString().toLowerCase();
            let item = await this.memoryCache.wrap(key, () => { return this.FindRoleByIdWrap(_id, jwt, span) });
            if (NoderedUtil.IsNullUndefinded(item)) return null;
            return Role.assign(item);
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public FindByUsernameWrap(username: string, jwt: string, span: Span) {
        if (jwt === null || jwt == undefined || jwt == "") { jwt = Crypt.rootToken(); }
        Logger.instanse.debug("Add user to cache by username : " + username, span);
        return Config.db.getbyusername<User>(username, null, jwt, true, span);
    }
    public async FindByUsername(username: string, jwt: string, parent: Span): Promise<User> {
        await this.init();
        const span: Span = Logger.otel.startSubSpan("dbhelper.FindByUsername", parent);
        try {
            if (NoderedUtil.IsNullEmpty(username)) return null;
            var key = ("username_" + username).toString().toLowerCase();
            let item = await this.memoryCache.wrap(key, () => { return this.FindByUsernameWrap(username, jwt, span); });
            if (NoderedUtil.IsNullUndefinded(item)) return null;
            return this.DecorateWithRoles(User.assign(item), span);
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public GetDisposableDomainWrap(domain: string, span: Span) {
        const jwt = Crypt.rootToken();
        Logger.instanse.debug("Add to cache : " + domain, span);
        const query = { name: domain, "_type": "disposable" };
        return Config.db.GetOne<Base>({ query, collectionname: "domains", jwt }, span);
    }
    public async GetDisposableDomain(domain: string, parent: Span): Promise<Base> {
        await this.init();
        if (domain.indexOf("@") > -1) {
            domain = domain.substring(domain.indexOf("@") + 1);
        }
        const span: Span = Logger.otel.startSubSpan("dbhelper.FindByUsername", parent);
        try {
            if (NoderedUtil.IsNullEmpty(domain)) return null;
            var key = ("disposable_" + domain).toString().toLowerCase();
            let item = await this.memoryCache.wrap(key, () => { return this.GetDisposableDomainWrap(domain, span) });
            if (NoderedUtil.IsNullUndefinded(item)) return null;
            return item;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public FindByUsernameOrFederationidWrap(username: string, issuer: string, span: Span) {
        const jwt = Crypt.rootToken();
        Logger.instanse.debug("Add federationid to cache : " + username, span);
        return Config.db.getbyusername<User>(username, issuer, jwt, true, span);
    }
    public async FindByUsernameOrFederationid(username: string, issuer: string, parent: Span): Promise<User> {
        await this.init();
        const span: Span = Logger.otel.startSubSpan("dbhelper.FindByUsername", parent);
        try {
            if (NoderedUtil.IsNullEmpty(username)) return null;
            var key = ("federation_" + username).toString().toLowerCase();
            let item = await this.memoryCache.wrap(key, () => { return this.FindByUsernameOrFederationidWrap(username, issuer, span) });
            if (NoderedUtil.IsNullUndefinded(item)) return null;
            return this.DecorateWithRoles(User.assign(item), span);
        } finally {
            Logger.otel.endSpan(span);
        }

    }
    DecorateWithRolesWrap(user, span: Span) {
        Logger.instanse.debug("Add userroles to cache : " + user._id + " " + user.name, span);
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
        return Config.db.aggregate<User>(pipe, "users", Crypt.rootToken(), null, null, false, span);
    }
    public DecorateWithRolesAllRolesWrap(span: Span) {
        Logger.instanse.debug("Add all roles", span);
        return Config.db.query<Role>({ query: { _type: "role" }, projection: { "name": 1, "members": 1 }, top: Config.expected_max_roles, collectionname: "users", jwt: Crypt.rootToken() }, span);
    }
    public async DecorateWithRoles<T extends TokenUser | User>(user: T, parent: Span): Promise<T> {
        await this.init();
        const span: Span = Logger.otel.startSubSpan("dbhelper.DecorateWithRoles", parent);
        try {
            if (NoderedUtil.IsNullUndefinded(user)) return null;
            if (!Config.decorate_roles_fetching_all_roles) {
                if (!user.roles) user.roles = [];
                var key = ("userroles_" + user._id).toString().toLowerCase();
                const results = await this.memoryCache.wrap(key, () => { return this.DecorateWithRolesWrap(user, span) });
                var key = ("userroles_" + WellknownIds.users).toString().toLowerCase();
                const users_results = await this.memoryCache.wrap(key, () => { return this.DecorateWithRolesWrap({ "_id": WellknownIds.users, "name": "users" }, span) });

                if (results.length > 0) {
                    user.roles = [];
                    results[0].roles.forEach(r => {
                        const exists = user.roles.filter(x => x._id == r._id);
                        if (exists.length == 0) {
                            user.roles.push(r);
                            Logger.instanse.silly("adding (from roles) " + r.name + " " + r._id, span);
                        }
                    });
                    results[0].roles2.forEach(r => {
                        const exists = user.roles.filter(x => x._id == r._id);
                        if (exists.length == 0) {
                            user.roles.push(r);
                            Logger.instanse.silly("adding (from roles2) " + r.name + " " + r._id, span);
                        }
                    });
                    if (users_results.length > 0) {
                        users_results[0].roles.forEach(r => {
                            const exists = user.roles.filter(x => x._id == r._id);
                            if (exists.length == 0) {
                                user.roles.push(r);
                                Logger.instanse.silly("also adding (from users roles) " + r.name + " " + r._id, span);
                            }
                        });
                        users_results[0].roles2.forEach(r => {
                            const exists = user.roles.filter(x => x._id == r._id);
                            if (exists.length == 0) {
                                user.roles.push(r);
                                Logger.instanse.silly("also adding (from users roles2) " + r.name + " " + r._id, span);
                            }
                        });
                    }
                }
                let hasusers = user.roles.filter(x => x._id == WellknownIds.users);
                if (hasusers.length == 0) {
                    user.roles.push(new Rolemember("users", WellknownIds.users));
                    Logger.instanse.verbose("also adding user to users " + WellknownIds.users, span);
                    // Logger.instanse.debug(user.name + " missing from users, adding it", span);
                    // await Config.db.db.collection("users").updateOne(
                    //     { _id: WellknownIds.users },
                    //     { "$push": { members: new Rolemember(user.name, user._id) } }
                    // );
                }
                return user;
            }
            let cached_roles = await this.memoryCache.wrap("allroles", () => { return this.DecorateWithRolesAllRolesWrap(span) });
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
        } finally {
            Logger.otel.endSpan(span);
        }
        return user as any;
    }
    public FindRoleByNameWrap(name: string, jwt: string, span: Span) {
        if (jwt === null || jwt == undefined || jwt == "") { jwt = Crypt.rootToken(); }
        Logger.instanse.debug("Add role to cache : " + name, span);
        return Config.db.GetOne<Role>({ query: { name: name, "_type": "role" }, collectionname: "users", jwt }, span)
    }
    public async FindRoleByName(name: string, jwt: string, parent: Span): Promise<Role> {
        await this.init();
        const span: Span = Logger.otel.startSubSpan("dbhelper.FindByUsername", parent);
        try {
            var key = ("rolename_" + name).toString();
            let item = await this.memoryCache.wrap(key, async () => { return this.FindRoleByNameWrap(name, jwt, span) });
            if (NoderedUtil.IsNullUndefinded(item)) return null;
            return Role.assign(item);
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public async UserRoleUpdateId(id: string, watch: boolean, span: Span) {
        if (!NoderedUtil.IsNullEmpty(id)) return;
        var u = new Base(); u._id = id;
        return this.UserRoleUpdate(u, watch, span);
    }
    public async DeleteKey(key: string, watch: boolean, frombroadcast: boolean, span: Span): Promise<void> {
        if (!this._doClear(watch, span)) return;
        // might have more than one api node, but don't have shared cache, so broadcast to all
        if (Config.enable_openflow_amqp && Config.cache_store_type != "redis" && Config.cache_store_type != "mongodb") {
            if (!Config.unittesting && !frombroadcast) {
                Logger.instanse.debug("Send clearcache command for " + key, span);
                amqpwrapper.Instance().send("openflow", "", { "command": "clearcache", "key": key }, 20000, null, "", span, 1);
            }
            await Logger.DBHelper.memoryCache.del(key);
        } else if (!Config.enable_openflow_amqp) { // only one api node, since not using queue, so remove key
            await Logger.DBHelper.memoryCache.del(key);
        } else if (!watch) { // more than one api node, but using shared cache, so only need to clear once
            await Logger.DBHelper.memoryCache.del(key);
        }
    }
    private _doClear(watch: boolean, span: Span) {
        return true;
        // var doit: boolean = false;
        // if (watch) {
        //     doit = false;
        //     if (Config.cache_store_type != "redis" && Config.cache_store_type != "mongodb") {
        //         doit = true;
        //     }
        // } else {
        //     doit = true;
        // }
        // return doit;
    }
    private async UserRoleUpdate(userrole: Base | TokenUser, watch: boolean, span: Span) {
        if (NoderedUtil.IsNullUndefinded(userrole)) return;
        if (!this._doClear(watch, span)) return;
        if (userrole._type == "user") {
            Logger.instanse.debug("Remove user from cache : " + userrole._id, span);
            let u: User = userrole as any;
            if (!NoderedUtil.IsNullEmpty(u._id)) await this.DeleteKey(("users_" + u._id).toString(), watch, false, span);
            if (!NoderedUtil.IsNullEmpty(u.username)) await this.DeleteKey(("username_" + u.username).toString(), watch, false, span);
            if (!NoderedUtil.IsNullEmpty(u.email)) await this.DeleteKey(("username_" + u.email).toString(), watch, false, span);
            if (!NoderedUtil.IsNullEmpty(u._id)) await this.DeleteKey(("userroles_" + u._id).toString(), watch, false, span);
            if (u.federationids != null && Array.isArray(u.federationids)) {
                for (var i = 0; i < u.federationids.length; i++) {
                    var fed = u.federationids[i];
                    if (fed == null) continue;
                    // has self property with value id
                    if (fed.hasOwnProperty("id")) {
                        await this.DeleteKey(("federation_" + fed.id).toString(), watch, false, span);
                    } else {
                        await this.DeleteKey(("federation_" + fed).toString(), watch, false, span);
                    }
                }
            }
            await this.DeleteKey("allroles", watch, false, span);
        } else if (userrole._type == "role") {
            let r: Role = userrole as any;
            if (!NoderedUtil.IsNullEmpty(r._id)) await this.DeleteKey(("users_" + r._id).toString(), watch, false, span);
            if (!NoderedUtil.IsNullEmpty(r.name)) await this.DeleteKey(("rolename_" + r.name).toString(), watch, false, span);
            if (userrole._id != WellknownIds.users) {
                if (r.members != null && Array.isArray(r.members)) {
                    for (var i = 0; i < r.members.length; i++) {
                        var member = r.members[i];
                        this.UserRoleUpdate(member as any, watch, span);
                    }
                }
            }
            await this.DeleteKey("allroles", watch, false, span);
        } else if (userrole._type == "customer") {
            if (!NoderedUtil.IsNullEmpty(userrole._id)) await this.DeleteKey(("users_" + userrole._id).toString(), watch, false, span);
        }

    }
    private async AgentUpdate(_id: string, slug: string, watch: boolean, span: Span) {
        Logger.instanse.debug("Clear queue cache : " + slug + " " + _id, span);
        if (!NoderedUtil.IsNullEmpty(slug)) {
            await this.DeleteKey(("agent_" + slug).toString(), watch, false, span);
            await this.DeleteKey(("agent_" + slug + "agent").toString(), watch, false, span);
        }
        if (!NoderedUtil.IsNullEmpty(_id)) await this.DeleteKey(("agent_" + _id).toString(), watch, false, span);
    }
    private async QueueUpdate(_id: string, name: string, watch: boolean, span: Span) {
        Logger.instanse.debug("Clear queue cache : " + name + " " + _id, span);
        if (!NoderedUtil.IsNullEmpty(name)) await this.DeleteKey(("queuename_" + name).toString(), watch, false, span);
        if (!NoderedUtil.IsNullEmpty(_id)) await this.DeleteKey(("mq_" + _id).toString(), watch, false, span);
    }
    private async ExchangeUpdate(_id: string, name: string, watch: boolean, span: Span) {
        Logger.instanse.debug("Clear exchange cache : " + name + " " + _id, span);
        if (!NoderedUtil.IsNullEmpty(name)) await this.DeleteKey(("exchangename_" + name).toString(), watch, false, span);
        if (!NoderedUtil.IsNullEmpty(_id)) await this.DeleteKey(("mq_" + _id).toString(), watch, false, span);
    }
    public async WorkitemQueueUpdate(wiqid: string, watch: boolean, span: Span) {
        Logger.instanse.debug("Clear workitem queue cache : " + wiqid, span);
        await this.DeleteKey("pushablequeues", watch, false, span);
        if (!NoderedUtil.IsNullEmpty(wiqid)) await this.DeleteKey("pendingworkitems_" + wiqid, watch, false, span);
    }
    public GetPushableQueuesWrap(span: Span) {
        Logger.instanse.debug("Add pushable queues", span);
        return Config.db.query<WorkitemQueue>({
            query: {
                "$or": [
                    { robotqueue: { "$exists": true, $nin: [null, "", "(empty)"] }, workflowid: { "$exists": true, $nin: [null, "", "(empty)"] } },
                    { amqpqueue: { "$exists": true, $nin: [null, "", "(empty)"] } }]
            }, top:1000, collectionname: "mq", jwt: Crypt.rootToken()
        }, span);
    }
    public async GetPushableQueues(parent: Span): Promise<WorkitemQueue[]> {
        await this.init();
        const span: Span = Logger.otel.startSubSpan("dbhelper.GetPushableQueues", parent);
        try {
            if (!Config.cache_workitem_queues) return await this.GetPushableQueuesWrap(span);
            let items = await this.memoryCache.wrap("pushablequeues", () => { return this.GetPushableQueuesWrap(span) }); // , { ttl: Config.workitem_queue_monitoring_interval / 1000 }
            return items;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public GetPendingWorkitemsCountWrap(wiqid: string, span: Span) {
        // Logger.instanse.debug("Saving pending workitems count for wiqid " + wiqid, span);
        // TODO: skip nextrun ? or accept neextrun will always be based of cache TTL or substract the TTL ?
        const query = { "wiqid": wiqid, state: "new", "_type": "workitem", "nextrun": { "$lte": new Date(new Date().toISOString()) } };
        return Config.db.count({
            query, collectionname: "workitems", jwt: Crypt.rootToken()
        }, span);
    }
    public async GetPendingWorkitemsCount(wiqid: string, parent: Span): Promise<number> {
        await this.init();
        const span: Span = Logger.otel.startSubSpan("dbhelper.GetPendingWorkitemsCount", parent);
        try {
            //if (!Config.cache_workitem_queues) return await this.GetPendingWorkitemsCountWrap(wiqid, span);
            return await this.GetPendingWorkitemsCountWrap(wiqid, span);
            var key = ("pendingworkitems_" + wiqid).toString().toLowerCase();
            let count = await this.memoryCache.wrap(key, () => { return this.GetPendingWorkitemsCountWrap(wiqid, span); }); // , { ttl: Config.workitem_queue_monitoring_interval / 1000 }
            return count;
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
            Logger.instanse.verbose(`FindRoleByName ${name}`, span);
            let role: Role = await this.FindRoleByName(name, jwt, span);
            if (role == null) {
                Logger.instanse.verbose(`EnsureRole FindRoleById ${name}`, span);
                role = await this.FindRoleById(id, null, span);
            }
            if (role !== null && (role._id === id || NoderedUtil.IsNullEmpty(id))) { return role; }
            if (role !== null && !NoderedUtil.IsNullEmpty(role._id)) {
                Logger.instanse.warn(`Deleting ${name} with ${role._id} not matcing expected id ${id}`, span);
                await Config.db.DeleteOne(role._id, "users", false, jwt, span);
            }
            role = new Role(); role.name = name; role._id = id;
            Logger.instanse.verbose(`Adding new role ${name}`, span);
            role = await Config.db.InsertOne(role, "users", 0, false, jwt, span);
            role = Role.assign(role);
            if (Config.force_add_admins) Base.addRight(role, WellknownIds.admins, "admins", [Rights.full_control]);
            Base.addRight(role, role._id, role.name, [Rights.full_control]);
            if (Config.force_add_admins) Base.removeRight(role, role._id, [Rights.delete]);
            Logger.instanse.verbose(`Updating ACL for new role ${name}`, span);
            await this.Save(role, jwt, span);
            return Role.assign(role);
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public async EnsureUser(jwt: string, name: string, username: string, id: string, password: string, extraoptions: any, parent: Span): Promise<User> {
        const span: Span = Logger.otel.startSubSpan("dbhelper.ensureUser", parent);
        try {
            span?.addEvent("FindByUsernameOrId");
            Logger.instanse.verbose(`FindById ${name} ${id}`, span);
            let user = await this.FindById(id, span);
            if (user == null) {
                Logger.instanse.verbose(`FindByUsername ${username}`, span);
                user = await this.FindByUsername(username, null, span);
            }
            if (user !== null && (user._id === id || id === null)) { return user; }
            if (user !== null && id !== null) {
                span?.addEvent("Deleting");
                Logger.instanse.warn(`Deleting ${name} with ${user._id} not matcing expected id ${id}`, span);
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
            Logger.instanse.verbose(`Adding new user ${name}`, span);
            user = await Config.db.InsertOne(user, "users", 0, false, jwt, span);
            user = User.assign(user);
            span?.addEvent("DecorateWithRoles");
            Logger.instanse.verbose(`Decorating new user ${name} with roles`, span);
            user = await this.DecorateWithRoles(user, span);
            span?.addEvent("return user");
            return user;
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
    public UpdateHeartbeat(cli: WebSocketServerClient): any {
        if (NoderedUtil.IsNullUndefinded(cli) || NoderedUtil.IsNullUndefinded(cli.user)) return null;
        const dt = new Date(new Date().toISOString());
        const updatedoc = { _heartbeat: dt, lastseen: dt, clientagent: cli.clientagent, clientversion: cli.clientversion, remoteip: cli.remoteip };
        cli.user._heartbeat = dt;
        cli.user.lastseen = dt;
        if (cli.clientagent == "openrpa") {
            cli.user._rpaheartbeat = dt;
            return { $set: { ...updatedoc, _rpaheartbeat: new Date(new Date().toISOString()), _lastopenrpaclientversion: cli.clientversion } };
        }
        if (cli.clientagent == "nodered") {
            cli.user._noderedheartbeat = dt;
            return { $set: { ...updatedoc, _noderedheartbeat: new Date(new Date().toISOString()), _lastnoderedclientversion: cli.clientversion } };
        }
        if (cli.clientagent == "browser") {
            (cli.user as any)._webheartbeat = dt;
            return { $set: { ...updatedoc, _webheartbeat: new Date(new Date().toISOString()), _lastwebappclientversion: cli.clientversion } };
        }
        if (cli.clientagent == "powershell") {
            cli.user._powershellheartbeat = dt;
            return { $set: { ...updatedoc, _powershellheartbeat: new Date(new Date().toISOString()), _lastpowershellclientversion: cli.clientversion } };
        }
        // if (cli.clientagent ==  "mobileapp" || cli.clientagent == "aiotmobileapp") {
        //     (cli.user as any)._webheartbeat = dt;
        //     (cli.user as any)._mobilheartbeat = dt;
        //     return {
        //         $set: {
        //             ...updatedoc, _webheartbeat: new Date(new Date().toISOString()), _lastwebappclientversion: cli.clientversion
        //             , _mobilheartbeat: new Date(new Date().toISOString()), _lastmobilclientversion: cli.clientversion
        //         }
        //     };
        // }
        else {
            return { $set: updatedoc };
        }
    }
    public GetIPBlockListWrap(span) {
        return Config.db.query<Base>({ query: { _type: "ipblock" }, projection: { "ips": 1 }, top: 1, collectionname: "config", jwt: Crypt.rootToken() }, span);;
    }
    public async GetIPBlockList(parent: Span): Promise<Base[]> {
        await this.init();
        const span: Span = Logger.otel.startSubSpan("dbhelper.GetIPBlockList", parent);
        try {
            let items = await this.memoryCache.wrap("ipblock", () => { return this.GetIPBlockListWrap(span) });
            if (NoderedUtil.IsNullUndefinded(items)) items = [];
            return items;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    private async ClearIPBlockList() {
        await this.memoryCache.del("ipblock");
    }

    public GetCollectionsWrap(span) {
        return DBHelper.toArray(Config.db.db.listCollections());
    }
    public async GetCollections(parent: Span): Promise<CollectionInfo[]> {
        await this.init();
        const span: Span = Logger.otel.startSubSpan("dbhelper.GetCollections", parent);
        try {
            let items = await this.memoryCache.wrap("collections", () => { return this.GetCollectionsWrap(span) });
            if (NoderedUtil.IsNullUndefinded(items)) items = [];
            return items;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public async ClearGetCollections() {
        await this.memoryCache.del("collections");
    }
    public async FindJWT(key: string, parent: Span): Promise<User> {
        await this.init();
        const span: Span = Logger.otel.startSubSpan("dbhelper.FindJWT", parent);
        try {
            if (NoderedUtil.IsNullEmpty(key)) return null;
            return await this.memoryCache.get("jwt_" + key);
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public async AddJWT(key: string, data: any, parent: Span): Promise<void> {
        await this.init();
        const span: Span = Logger.otel.startSubSpan("dbhelper.AddJWT", parent);
        try {
            return await this.memoryCache.set("jwt_" + key, data);
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public async RemoveJWT(key: string, parent: Span): Promise<void> {
        await this.init();
        const span: Span = Logger.otel.startSubSpan("dbhelper.RemoveJWT", parent);
        try {
            return await this.memoryCache.del("jwt_" + key);
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    static toArray(iterator): Promise<any[]> {
        return new Promise((resolve, reject) => {
            iterator.toArray((err, res) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(res);
                }
            });
        });
    }

}
