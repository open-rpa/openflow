import { Crypt } from "./Crypt";
import { User, Role, Rolemember, WellknownIds, Rights, NoderedUtil, Base, TokenUser } from "@openiap/openflow-api";
import { Config } from "./Config";
import { Span } from "@opentelemetry/api";
import { Logger } from "./Logger";
import { Auth } from "./Auth";

export class DBHelper {
    public static async FindByUsername(username: string, jwt: string, parent: Span): Promise<User> {
        const span: Span = Logger.otel.startSubSpan("dbhelper.FindByUsername", parent);
        try {
            if (NoderedUtil.IsNullEmpty(username)) throw new Error("Username is mandatory")
            const byuser = { username: new RegExp(["^", username, "$"].join(""), "i") };
            const byid = { federationids: new RegExp(["^", username, "$"].join(""), "i") }
            const q = { $or: [byuser, byid] };
            if (jwt === null || jwt == undefined || jwt == "") { jwt = Crypt.rootToken(); }
            const items: User[] = await Config.db.query<User>(q, null, 1, 0, null, "users", jwt, undefined, undefined, span);
            if (items === null || items === undefined || items.length === 0) { return null; }
            return await this.DecorateWithRoles(User.assign(items[0]), span);
        } catch (error) {
            span?.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public static async FindById(_id: string, jwt: string, parent: Span): Promise<User> {
        const span: Span = Logger.otel.startSubSpan("dbhelper.FindById", parent);
        try {
            if (NoderedUtil.IsNullEmpty(_id)) throw new Error("_id cannot be null");
            if (jwt === null || jwt == undefined || jwt == "") { jwt = Crypt.rootToken(); }
            const items: User[] = await Config.db.query<User>({ _id }, null, 1, 0, null, "users", jwt, undefined, undefined, span);
            if (items === null || items === undefined || items.length === 0) { return null; }
            return await this.DecorateWithRoles(User.assign(items[0]), span);
        } catch (error) {
            span?.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public static async FindByUsernameOrId(username: string, id: string, parent: Span): Promise<User> {
        const span: Span = Logger.otel.startSubSpan("dbhelper.FindByUsernameOrId", parent);
        try {
            var _id = id;
            if (NoderedUtil.IsNullEmpty(_id)) _id = null;
            if (NoderedUtil.IsNullEmpty(username) && NoderedUtil.IsNullEmpty(_id)) throw new Error("Either username or id is mandatory");
            const items: User[] = await Config.db.query<User>({ $or: [{ username: new RegExp(["^", username, "$"].join(""), "i") }, { _id }] },
                null, 1, 0, null, "users", Crypt.rootToken(), undefined, undefined, span);
            if (items === null || items === undefined || items.length === 0) { return null; }
            return await this.DecorateWithRoles(User.assign(items[0]), span);
        } catch (error) {
            span?.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public static async FindByUsernameOrFederationid(username: string, parent: Span): Promise<User> {
        const span: Span = Logger.otel.startSubSpan("dbhelper.FindByUsernameOrFederationid", parent);
        try {
            if (NoderedUtil.IsNullEmpty(username)) throw new Error("username cannot be null");
            const byuser = { username: new RegExp(["^", username, "$"].join(""), "i") };
            const byid = { federationids: new RegExp(["^", username, "$"].join(""), "i") }
            const q = { $or: [byuser, byid] };
            const items: User[] = await Config.db.query<User>(q, null, 1, 0, null, "users", Crypt.rootToken(), undefined, undefined, span);
            if (items === null || items === undefined || items.length === 0) { return null; }
            return await this.DecorateWithRoles(User.assign(items[0]), span);
        } catch (error) {
            span?.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public static cached_roles: Role[] = [];
    public static cached_at: Date = new Date();
    public static async DecorateWithRoles<T extends TokenUser | User>(user: T, parent: Span): Promise<T> {
        const span: Span = Logger.otel.startSubSpan("dbhelper.DecorateWithRoles", parent);
        try {
            if (NoderedUtil.IsNullUndefinded(user)) throw new Error("User is mandatory");
            if (!Config.decorate_roles_fetching_all_roles) {
                if (!user.roles) user.roles = [];
                const _roles = await Auth.getUser(user._id, "userroles");
                if (_roles != null) {
                    user.roles = _roles as any;
                } else {
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
                    }
                    ]
                    const results = await Config.db.aggregate<User>(pipe, "users", Crypt.rootToken(), null, span);
                    if (results.length > 0) {
                        let res = { roles: results[0].roles, roles2: (results[0] as any).roles2 }
                        res.roles = res.roles.map(x => ({ "_id": x._id, "name": x.name, "d": (x as any).depth }));
                        res.roles2 = res.roles2.map(x => ({ "_id": x._id, "name": x.name, "d": (x as any).depth }));
                        user.roles = res.roles;
                        res.roles2.forEach(r => {
                            const exists = user.roles.filter(x => x._id == r._id);
                            if (exists.length == 0) user.roles.push(r);
                        });
                    }
                    let hasusers = user.roles.filter(x => x._id == WellknownIds.users);
                    if (hasusers.length == 0) {
                        user.roles.push(new Rolemember("users", WellknownIds.users));
                    }
                    await Auth.AddUser(user.roles as any, user._id, "userroles");
                }

            } else {
                var end: number = new Date().getTime();
                var seconds = Math.round((end - this.cached_at.getTime()) / 1000);
                if (seconds > Config.roles_cached_in_seconds || Config.roles_cached_in_seconds <= 0) {
                    this.cached_roles = [];
                }
                if (this.cached_roles.length == 0) {
                    let query: any = { _type: "role" };
                    this.cached_roles = await Config.db.query<Role>(query, { "name": 1, "members": 1 }, Config.expected_max_roles, 0, null, "users", Crypt.rootToken(),
                        undefined, undefined, span);
                    this.cached_at = new Date();
                }
                if (this.cached_roles.length === 0 && user.username !== "root") {
                    throw new Error("System has no roles !!!!!!");
                }
                user.roles = [];
                for (let role of this.cached_roles) {
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
                        for (let role of this.cached_roles) {
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
            }
        } catch (error) {
            span?.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
        return user as any;
    }
    public static async FindRoleByName(name: string, parent: Span): Promise<Role> {
        const items: Role[] = await Config.db.query<Role>({ name: name, "_type": "role" }, null, 1, 0, null, "users", Crypt.rootToken(), undefined, undefined, parent);
        if (items === null || items === undefined || items.length === 0) { return null; }
        return Role.assign(items[0]);
    }
    public static async FindRoleByNameOrId(name: string, id: string, parent: Span): Promise<Role> {
        var _id = id;
        if (NoderedUtil.IsNullEmpty(_id)) _id = null; // undefined is bad here
        if (NoderedUtil.IsNullEmpty(name) && NoderedUtil.IsNullEmpty(_id)) throw new Error("Either username or id is mandatory");
        const jwt = Crypt.rootToken();
        const items: Role[] = await Config.db.query<Role>({ $or: [{ name }, { _id }], "_type": "role" }, null, 5, 0, null, "users", jwt, undefined, undefined, parent);
        if (items === null || items === undefined || items.length === 0) { return null; }
        return Role.assign(items[0]);
    }
    public static async Save(item: User | Role, jwt: string, parent: Span): Promise<void> {
        await Config.db._UpdateOne(null, item, "users", 2, false, jwt, parent);
    }
    public static async EnsureRole(jwt: string, name: string, id: string, parent: Span): Promise<Role> {
        const span: Span = Logger.otel.startSubSpan("dbhelper.EnsureRole", parent);
        try {
            let role: Role = await this.FindRoleByNameOrId(name, id, span);
            if (role !== null && (role._id === id || NoderedUtil.IsNullEmpty(id))) { return role; }
            if (role !== null && !NoderedUtil.IsNullEmpty(role._id)) { await Config.db.DeleteOne(role._id, "users", jwt, span); }
            role = new Role(); role.name = name; role._id = id;
            role = await Config.db.InsertOne(role, "users", 0, false, jwt, span);
            role = Role.assign(role);
            Base.addRight(role, WellknownIds.admins, "admins", [Rights.full_control]);
            Base.addRight(role, role._id, role.name, [Rights.full_control]);
            Base.removeRight(role, role._id, [Rights.delete]);
            await this.Save(role, jwt, span);
            return Role.assign(role);
        } catch (error) {
            span?.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public static async EnsureUser(jwt: string, name: string, username: string, id: string, password: string, parent: Span): Promise<User> {
        const span: Span = Logger.otel.startSubSpan("dbhelper.ensureUser", parent);
        try {
            span?.addEvent("FindByUsernameOrId");
            let user: User = await this.FindByUsernameOrId(username, id, span);
            if (user !== null && (user._id === id || id === null)) { return user; }
            if (user !== null && id !== null) {
                span?.addEvent("FindByUsernameOrId");
                await Config.db.DeleteOne(user._id, "users", jwt, span);
            }
            user = new User(); user._id = id; user.name = name; user.username = username;
            if (password !== null && password !== undefined && password !== "") {
                span?.addEvent("SetPassword");
                await Crypt.SetPassword(user, password, span);
            } else {
                span?.addEvent("SetPassword");
                await Crypt.SetPassword(user, Math.random().toString(36).substr(2, 9), span);
            }
            span?.addEvent("Insert user");
            user = await Config.db.InsertOne(user, "users", 0, false, jwt, span);
            user = User.assign(user);
            span?.addEvent("DecorateWithRoles");
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
    public static async EnsureNoderedRoles(user: TokenUser | User, jwt: string, force: boolean, parent: Span): Promise<void> {
        if (Config.auto_create_personal_nodered_group || force) {
            let name = user.username;
            name = name.split("@").join("").split(".").join("");
            name = name.toLowerCase();

            const noderedadmins = await this.EnsureRole(jwt, name + "noderedadmins", null, parent);
            Base.addRight(noderedadmins, user._id, user.username, [Rights.full_control]);
            Base.removeRight(noderedadmins, user._id, [Rights.delete]);
            noderedadmins.AddMember(user as User);
            await this.Save(noderedadmins, jwt, parent);
        }
        if (Config.auto_create_personal_noderedapi_group || force) {
            let name = user.username;
            name = name.split("@").join("").split(".").join("");
            name = name.toLowerCase();

            const noderedadmins = await this.EnsureRole(jwt, name + "nodered api users", null, parent);
            Base.addRight(noderedadmins, user._id, user.username, [Rights.full_control]);
            Base.removeRight(noderedadmins, user._id, [Rights.delete]);
            noderedadmins.AddMember(user as User);
            await this.Save(noderedadmins, jwt, parent);
        }
    }
}