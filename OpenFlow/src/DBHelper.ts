import { Crypt } from "./Crypt";
import { User, Role, Rolemember, WellknownIds, Rights, NoderedUtil, Base, TokenUser } from "@openiap/openflow-api";
import { Config } from "./Config";
import { Span } from "@opentelemetry/api";
import { Logger } from "./Logger";

export class DBHelper {
    public static async FindByUsername(username: string, jwt: string, parent: Span): Promise<User> {
        const span: Span = Logger.otel.startSubSpan("dbhelper.FindByUsername", parent);
        try {
            const byuser = { username: new RegExp(["^", username, "$"].join(""), "i") };
            const byid = { federationids: new RegExp(["^", username, "$"].join(""), "i") }
            const q = { $or: [byuser, byid] };
            if (jwt === null || jwt == undefined || jwt == "") { jwt = Crypt.rootToken(); }
            const items: User[] = await Config.db.query<User>(q, null, 1, 0, null, "users", jwt, undefined, undefined, span);
            if (items === null || items === undefined || items.length === 0) { return null; }
            return await this.DecorateWithRoles(User.assign(items[0]), span);
        } catch (error) {
            span.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public static async FindById(_id: string, jwt: string, parent: Span): Promise<User> {
        const span: Span = Logger.otel.startSubSpan("dbhelper.FindById", parent);
        try {
            if (jwt === null || jwt == undefined || jwt == "") { jwt = Crypt.rootToken(); }
            const items: User[] = await Config.db.query<User>({ _id: _id }, null, 1, 0, null, "users", jwt, undefined, undefined, span);
            if (items === null || items === undefined || items.length === 0) { return null; }
            return await this.DecorateWithRoles(User.assign(items[0]), span);
        } catch (error) {
            span.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public static async FindByUsernameOrId(username: string, id: string, parent: Span): Promise<User> {
        const span: Span = Logger.otel.startSubSpan("dbhelper.FindByUsernameOrId", parent);
        try {
            const items: User[] = await Config.db.query<User>({ $or: [{ username: new RegExp(["^", username, "$"].join(""), "i") }, { _id: id }] },
                null, 1, 0, null, "users", Crypt.rootToken(), undefined, undefined, span);
            if (items === null || items === undefined || items.length === 0) { return null; }
            return await this.DecorateWithRoles(User.assign(items[0]), span);
        } catch (error) {
            span.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public static async FindByUsernameOrFederationid(username: string, parent: Span): Promise<User> {
        const span: Span = Logger.otel.startSubSpan("dbhelper.FindByUsernameOrFederationid", parent);
        try {
            const byuser = { username: new RegExp(["^", username, "$"].join(""), "i") };
            const byid = { federationids: new RegExp(["^", username, "$"].join(""), "i") }
            const q = { $or: [byuser, byid] };
            const items: User[] = await Config.db.query<User>(q, null, 1, 0, null, "users", Crypt.rootToken(), undefined, undefined, span);
            if (items === null || items === undefined || items.length === 0) { return null; }
            return await this.DecorateWithRoles(User.assign(items[0]), span);
        } catch (error) {
            span.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    // public static async GetRoles(_id: string, ident: number, parent: Span): Promise<Role[]> {
    //     const span: Span = Logger.otel.startSubSpan("dbhelper.GetRoles", parent);
    //     span.setAttribute("_id", _id);
    //     span.setAttribute("ident", ident);
    //     try {
    //         if (ident > Config.max_recursive_group_depth) return [];
    //         const result: Role[] = [];
    //         const query: any = { "members": { "$elemMatch": { _id: _id } } };
    //         const ids: string[] = [];
    //         const _roles: Role[] = await Config.db.query<Role>(query, null, Config.expected_max_roles, 0, null, "users", Crypt.rootToken(), undefined, undefined, span);
    //         for (let role of _roles) {
    //             if (ids.indexOf(role._id) == -1) {
    //                 ids.push(role._id);
    //                 result.push(role);
    //                 const _subroles: Role[] = await this.GetRoles(role._id, ident + 1, span);
    //                 for (let subrole of _subroles) {
    //                     if (ids.indexOf(subrole._id) == -1) {
    //                         ids.push(subrole._id);
    //                         result.push(subrole);
    //                     }
    //                 }
    //             }
    //         }
    //         return result;
    //     } catch (error) {
    //         span.recordException(error);
    //         throw error;
    //     } finally {
    //         Logger.otel.endSpan(span);
    //     }
    // }
    public static cached_roles: Role[] = [];
    public static cached_at: Date = new Date();
    public static async DecorateWithRoles(user: User, parent: Span): Promise<User> {
        const span: Span = Logger.otel.startSubSpan("dbhelper.DecorateWithRoles", parent);
        try {
            if (!Config.decorate_roles_fetching_all_roles) {
                // const roles: Role[] = await this.GetRoles(user._id, 0, span);
                // user.roles = [];
                // roles.forEach(role => {
                //     user.roles.push(new Rolemember(role.name, role._id));
                // });
                const pipe: any = [{ "$match": { "_id": user._id } },
                {
                    "$graphLookup": {
                        from: "users",
                        startWith: "$_id",
                        connectFromField: "_id",
                        connectToField: "members._id",
                        as: "roles",
                        maxDepth: Config.max_recursive_group_depth,
                        restrictSearchWithMatch: { "_type": "role" }
                    }
                }]
                const results = await Config.db.aggregate<User>(pipe, "users", Crypt.rootToken(), null, span);
                if (results.length > 0) {
                    // user = results[0];
                    user.roles = results[0].roles.map(x => ({ "_id": x._id, "name": x.name })) as any;
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
                this.cached_roles.forEach(role => {
                    let isMember: number = -1;
                    if (role.members !== undefined) { isMember = role.members.map(function (e: Rolemember): string { return e._id; }).indexOf(user._id); }
                    const beenAdded: number = user.roles.map(function (e: Rolemember): string { return e._id; }).indexOf(user._id);
                    if (isMember > -1 && beenAdded === -1) {
                        user.roles.push(new Rolemember(role.name, role._id));
                    }
                });
                let foundone: boolean = true;
                while (foundone) {
                    foundone = false;
                    user.roles.forEach(userrole => {
                        this.cached_roles.forEach(role => {
                            let isMember: number = -1;
                            if (role.members !== undefined) { isMember = role.members.map(function (e: Rolemember): string { return e._id; }).indexOf(userrole._id); }
                            const beenAdded: number = user.roles.map(function (e: Rolemember): string { return e._id; }).indexOf(role._id);
                            if (isMember > -1 && beenAdded === -1) {
                                user.roles.push(new Rolemember(role.name, role._id));
                                foundone = true;
                            }
                        });
                    });
                }
            }
        } catch (error) {
            span.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
        return user;
    }
    public static async FindRoleByName(name: string, parent: Span): Promise<Role> {
        const items: Role[] = await Config.db.query<Role>({ name: name }, null, 1, 0, null, "users", Crypt.rootToken(), undefined, undefined, parent);
        if (items === null || items === undefined || items.length === 0) { return null; }
        return Role.assign(items[0]);
    }
    public static async FindRoleByNameOrId(name: string, id: string, parent: Span): Promise<Role> {
        const jwt = Crypt.rootToken();
        const items: Role[] = await Config.db.query<Role>({ $or: [{ name: name }, { _id: id }] }, null, 1, 0, null, "users", jwt, undefined, undefined, parent);
        if (items === null || items === undefined || items.length === 0) { return null; }
        return Role.assign(items[0]);
    }
    public static async Save(item: User | Role, jwt: string, parent: Span): Promise<void> {
        await Config.db._UpdateOne(null, item, "users", 0, false, jwt, parent);
    }
    public static async EnsureRole(jwt: string, name: string, id: string, parent: Span): Promise<Role> {
        const span: Span = Logger.otel.startSubSpan("dbhelper.EnsureRole", parent);
        try {
            let role: Role = await this.FindRoleByNameOrId(name, id, span);
            if (role !== null && (role._id === id || id === null)) { return role; }
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
            span.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public static async ensureUser(jwt: string, name: string, username: string, id: string, password: string, parent: Span): Promise<User> {
        const span: Span = Logger.otel.startSubSpan("dbhelper.ensureUser", parent);
        try {
            let user: User = await this.FindByUsernameOrId(username, id, span);
            if (user !== null && (user._id === id || id === null)) { return user; }
            if (user !== null && id !== null) { await Config.db.DeleteOne(user._id, "users", jwt, span); }
            user = new User(); user._id = id; user.name = name; user.username = username;
            if (password !== null && password !== undefined && password !== "") {
                await Crypt.SetPassword(user, password, span);
            } else {
                await Crypt.SetPassword(user, Math.random().toString(36).substr(2, 9), span);
            }
            user = await Config.db.InsertOne(user, "users", 0, false, jwt, span);
            user = User.assign(user);
            Base.addRight(user, WellknownIds.admins, "admins", [Rights.full_control]);
            Base.addRight(user, user._id, user.name, [Rights.full_control]);
            Base.removeRight(user, user._id, [Rights.delete]);
            await this.Save(user, jwt, span);
            const users: Role = await this.FindRoleByName("users", span);
            users.AddMember(user);
            this.EnsureNoderedRoles(user, jwt, false, span);
            await this.Save(users, jwt, span)
            user = await this.DecorateWithRoles(user, span);
            return user;
        } catch (error) {
            span.recordException(error);
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