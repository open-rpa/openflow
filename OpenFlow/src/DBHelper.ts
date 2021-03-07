import { Crypt } from "./Crypt";
import { User, Role, Rolemember, WellknownIds, Rights, NoderedUtil, Base, TokenUser } from "@openiap/openflow-api";
import { Config } from "./Config";
import { otel } from "./otel";
import { Span } from "@opentelemetry/api";

export class DBHelper {
    public static async FindByUsername(username: string, jwt: string = null, parent: Span): Promise<User> {
        const span: Span = otel.startSubSpan("dbhelper.EnsureRole", parent);
        const byuser = { username: new RegExp(["^", username, "$"].join(""), "i") };
        const byid = { federationids: new RegExp(["^", username, "$"].join(""), "i") }
        const q = { $or: [byuser, byid] };
        if (jwt === null || jwt == undefined || jwt == "") { jwt = Crypt.rootToken(); }
        const items: User[] = await Config.db.query<User>(q, null, 1, 0, null, "users", jwt);
        if (items === null || items === undefined || items.length === 0) { return null; }
        const result: User = User.assign(items[0]);
        await this.DecorateWithRoles(result);
        return result;
    }
    public static async FindById(_id: string, jwt: string = null): Promise<User> {
        if (jwt === null || jwt == undefined || jwt == "") { jwt = Crypt.rootToken(); }
        const items: User[] = await Config.db.query<User>({ _id: _id }, null, 1, 0, null, "users", jwt);
        if (items === null || items === undefined || items.length === 0) { return null; }
        const result: User = User.assign(items[0]);
        await this.DecorateWithRoles(result);
        return result;
    }
    public static async FindByUsernameOrId(username: string, id: string): Promise<User> {
        const items: User[] = await Config.db.query<User>({ $or: [{ username: new RegExp(["^", username, "$"].join(""), "i") }, { _id: id }] },
            null, 1, 0, null, "users", Crypt.rootToken());
        if (items === null || items === undefined || items.length === 0) { return null; }
        const result: User = User.assign(items[0]);
        await this.DecorateWithRoles(result);
        return result;
    }
    public static async FindByUsernameOrFederationid(username: string): Promise<User> {
        const byuser = { username: new RegExp(["^", username, "$"].join(""), "i") };
        const byid = { federationids: new RegExp(["^", username, "$"].join(""), "i") }
        const q = { $or: [byuser, byid] };
        const items: User[] = await Config.db.query<User>(q, null, 1, 0, null, "users", Crypt.rootToken());
        if (items === null || items === undefined || items.length === 0) { return null; }
        const result: User = User.assign(items[0]);
        await this.DecorateWithRoles(result);
        return result;
    }
    public static async GetRoles(_id: string, ident: number): Promise<Role[]> {
        if (ident > Config.max_recursive_group_depth) return [];
        const result: Role[] = [];
        const query: any = { "members": { "$elemMatch": { _id: _id } } };
        const ids: string[] = [];
        const _roles: Role[] = await Config.db.query<Role>(query, null, Config.expected_max_roles, 0, null, "users", Crypt.rootToken());
        for (let i = 0; i < _roles.length; i++) {
            const role = _roles[i];
            if (ids.indexOf(role._id) == -1) {
                ids.push(role._id);
                result.push(role);
                const _subroles: Role[] = await this.GetRoles(role._id, ident + 1);
                for (let y = 0; y < _subroles.length; y++) {
                    const subrole = _subroles[y];
                    if (ids.indexOf(subrole._id) == -1) {
                        ids.push(subrole._id);
                        result.push(subrole);
                    }
                }
            }
        }
        return result;
    }
    public static cached_roles: Role[] = [];
    public static cached_at: Date = new Date();
    public static async DecorateWithRoles(user: User): Promise<void> {
        if (!Config.decorate_roles_fetching_all_roles) {
            const roles: Role[] = await this.GetRoles(user._id, 0);
            user.roles = [];
            roles.forEach(role => {
                user.roles.push(new Rolemember(role.name, role._id));
            });
        } else {
            var end: number = new Date().getTime();
            var seconds = Math.round((end - this.cached_at.getTime()) / 1000);
            if (seconds > Config.roles_cached_in_seconds || Config.roles_cached_in_seconds <= 0) {
                this.cached_roles = [];
            }
            if (this.cached_roles.length == 0) {
                let query: any = { _type: "role" };
                this.cached_roles = await Config.db.query<Role>(query, { "name": 1, "members": 1 }, Config.expected_max_roles, 0, null, "users", Crypt.rootToken());
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
    }
    public static async FindRoleByName(name: string): Promise<Role> {
        const items: Role[] = await Config.db.query<Role>({ name: name }, null, 1, 0, null, "users", Crypt.rootToken());
        if (items === null || items === undefined || items.length === 0) { return null; }
        const result: Role = Role.assign(items[0]);
        return result;
    }
    public static async FindRoleByNameOrId(name: string, id: string): Promise<Role> {
        const jwt = Crypt.rootToken();
        const items: Role[] = await Config.db.query<Role>({ $or: [{ name: name }, { _id: id }] }, null, 1, 0, null, "users", jwt);
        if (items === null || items === undefined || items.length === 0) { return null; }
        const result: Role = Role.assign(items[0]);
        return result;
    }
    public static async Save(item: User | Role, jwt: string, parent: Span): Promise<void> {
        await Config.db._UpdateOne(null, item, "users", 0, false, jwt, parent);
    }





    public static async EnsureRole(jwt: string, name: string, id: string, parent: Span = undefined): Promise<Role> {
        const span: Span = otel.startSubSpan("dbhelper.EnsureRole", parent);
        try {
            let role: Role = await this.FindRoleByNameOrId(name, id);
            if (role !== null && (role._id === id || id === null)) { return role; }
            if (role !== null && !NoderedUtil.IsNullEmpty(role._id)) { await Config.db.DeleteOne(role._id, "users", jwt); }
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
        } finally {
            otel.endSpan(span);
        }
    }
    public static async ensureUser(jwt: string, name: string, username: string, id: string, password: string, parent: Span = undefined): Promise<User> {
        const span: Span = otel.startSubSpan("dbhelper.ensureUser", parent);
        try {
            let user: User = await this.FindByUsernameOrId(username, id);
            if (user !== null && (user._id === id || id === null)) { return user; }
            if (user !== null && id !== null) { await Config.db.DeleteOne(user._id, "users", jwt); }
            user = new User(); user._id = id; user.name = name; user.username = username;
            if (password !== null && password !== undefined && password !== "") {
                await Crypt.SetPassword(user, password);
            } else {
                await Crypt.SetPassword(user, Math.random().toString(36).substr(2, 9));
            }
            user = await Config.db.InsertOne(user, "users", 0, false, jwt, span);
            user = User.assign(user);
            Base.addRight(user, WellknownIds.admins, "admins", [Rights.full_control]);
            Base.addRight(user, user._id, user.name, [Rights.full_control]);
            Base.removeRight(user, user._id, [Rights.delete]);
            await this.Save(user, jwt, span);
            const users: Role = await this.FindRoleByName("users");
            users.AddMember(user);

            if (Config.auto_create_personal_nodered_group) {
                let name = user.username;
                name = name.split("@").join("").split(".").join("");
                name = name.toLowerCase();

                const noderedadmins = await this.EnsureRole(jwt, name + "noderedadmins", null);
                Base.addRight(noderedadmins, user._id, user.username, [Rights.full_control]);
                Base.removeRight(noderedadmins, user._id, [Rights.delete]);
                noderedadmins.AddMember(user);
                await this.Save(noderedadmins, jwt, span);
            }

            await this.Save(users, jwt, span)
            await this.DecorateWithRoles(user);
            return user;
        } catch (error) {
            span.recordException(error);
        } finally {
            otel.endSpan(span);
        }
    }

}