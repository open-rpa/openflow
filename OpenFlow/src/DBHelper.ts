import { Crypt } from "./Crypt";
import { User, Role, Rolemember, WellknownIds, Rights, NoderedUtil } from "openflow-api";
import { Config } from "./Config";

export class DBHelper {

    public static async FindByUsername(username: string, jwt: string = null): Promise<User> {
        var byuser = { username: new RegExp(["^", username, "$"].join(""), "i") };
        //var byid = { federationids: { $elemMatch: new RegExp(["^", username, "$"].join(""), "i") } }
        var byid = { federationids: new RegExp(["^", username, "$"].join(""), "i") }
        var q = { $or: [byuser, byid] };
        if (jwt === null || jwt == undefined || jwt == "") { jwt = Crypt.rootToken(); }
        var items: User[] = await Config.db.query<User>(q, null, 1, 0, null, "users", jwt);
        if (items === null || items === undefined || items.length === 0) { return null; }
        var result: User = User.assign(items[0]);
        await this.DecorateWithRoles(result);
        return result;
    }
    public static async FindById(_id: string, jwt: string = null): Promise<User> {
        if (jwt === null || jwt == undefined || jwt == "") { jwt = Crypt.rootToken(); }
        var items: User[] = await Config.db.query<User>({ _id: _id }, null, 1, 0, null, "users", jwt);
        if (items === null || items === undefined || items.length === 0) { return null; }
        var result: User = User.assign(items[0]);
        await this.DecorateWithRoles(result);
        return result;
    }
    public static async FindByUsernameOrId(username: string, id: string): Promise<User> {
        var items: User[] = await Config.db.query<User>({ $or: [{ username: new RegExp(["^", username, "$"].join(""), "i") }, { _id: id }] },
            null, 1, 0, null, "users", Crypt.rootToken());
        if (items === null || items === undefined || items.length === 0) { return null; }
        var result: User = User.assign(items[0]);
        await this.DecorateWithRoles(result);
        return result;
    }
    public static async FindByUsernameOrFederationid(username: string): Promise<User> {
        var byuser = { username: new RegExp(["^", username, "$"].join(""), "i") };
        //var byid = { federationids: { $elemMatch: new RegExp(["^", username, "$"].join(""), "i") } }
        var byid = { federationids: new RegExp(["^", username, "$"].join(""), "i") }
        var q = { $or: [byuser, byid] };
        var items: User[] = await Config.db.query<User>(q, null, 1, 0, null, "users", Crypt.rootToken());
        // var items: User[] = await Config.db.query<User>({
        //     $or:
        //         [
        //             { username: new RegExp(["^", username, "$"].join(""), "i") },
        //             { federationids: { $elemMatch: { id: new RegExp(["^", username, "$"].join(""), "i") } } }
        //         ]
        // }, null, 1, 0, null, "users", Crypt.rootToken());
        if (items === null || items === undefined || items.length === 0) { return null; }
        var result: User = User.assign(items[0]);
        await this.DecorateWithRoles(result);
        return result;
    }
    public static async DecorateWithRoles(user: User): Promise<void> {
        let query: any = { _type: "role" };
        var _roles: Role[] = await Config.db.query<Role>(query, null, Config.expected_max_roles, 0, null, "users", Crypt.rootToken());
        if (_roles.length === 0 && user.username !== "root") {
            throw new Error("System has no roles !!!!!!");
        }
        user.roles = [];
        _roles.forEach(role => {
            var isMember: number = -1;
            if (role.members !== undefined) { isMember = role.members.map(function (e: Rolemember): string { return e._id; }).indexOf(user._id); }
            var beenAdded: number = user.roles.map(function (e: Rolemember): string { return e._id; }).indexOf(user._id);
            if (isMember > -1 && beenAdded === -1) {
                user.roles.push(new Rolemember(role.name, role._id));
            }
        });
        let foundone: boolean = true;
        while (foundone) {
            foundone = false;
            user.roles.forEach(userrole => {
                _roles.forEach(role => {
                    var isMember: number = -1;
                    if (role.members !== undefined) { isMember = role.members.map(function (e: Rolemember): string { return e._id; }).indexOf(userrole._id); }
                    var beenAdded: number = user.roles.map(function (e: Rolemember): string { return e._id; }).indexOf(role._id);
                    if (isMember > -1 && beenAdded === -1) {
                        user.roles.push(new Rolemember(role.name, role._id));
                        foundone = true;
                    }
                });
            });
        }
    }
    public static async FindRoleByName(name: string): Promise<Role> {
        var items: Role[] = await Config.db.query<Role>({ name: name }, null, 1, 0, null, "users", Crypt.rootToken());
        if (items === null || items === undefined || items.length === 0) { return null; }
        var result: Role = Role.assign(items[0]);
        return result;
    }
    public static async FindRoleByNameOrId(name: string, id: string): Promise<Role> {
        var jwt = Crypt.rootToken();
        var items: Role[] = await Config.db.query<Role>({ $or: [{ name: name }, { _id: id }] }, null, 1, 0, null, "users", jwt);
        if (items === null || items === undefined || items.length === 0) { return null; }
        var result: Role = Role.assign(items[0]);
        result = Role.assign(result);
        return result;
    }
    public static async Save(item: User | Role, jwt: string): Promise<void> {
        await Config.db._UpdateOne(null, item, "users", 0, false, jwt);
    }





    public static async EnsureRole(jwt: string, name: string, id: string): Promise<Role> {
        var role: Role = await this.FindRoleByNameOrId(name, id);
        if (role !== null && (role._id === id || id === null)) { return role; }
        if (role !== null && !NoderedUtil.IsNullEmpty(role._id)) { await Config.db.DeleteOne(role._id, "users", jwt); }
        role = new Role(); role.name = name; role._id = id;
        role = await Config.db.InsertOne(role, "users", 0, false, jwt);
        role = Role.assign(role);
        role.addRight(WellknownIds.admins, "admins", [Rights.full_control]);
        role.addRight(role._id, role.name, [Rights.full_control]);
        role.removeRight(role._id, [Rights.delete]);
        await this.Save(role, jwt);
        return Role.assign(role);
    }
    public static async ensureUser(jwt: string, name: string, username: string, id: string, password: string): Promise<User> {
        var user: User = await this.FindByUsernameOrId(username, id);
        if (user !== null && (user._id === id || id === null)) { return user; }
        if (user !== null && id !== null) { await Config.db.DeleteOne(user._id, "users", jwt); }
        user = new User(); user._id = id; user.name = name; user.username = username;
        if (password !== null && password !== undefined && password !== "") {
            await Crypt.SetPassword(user, password);
        } else {
            await Crypt.SetPassword(user, Math.random().toString(36).substr(2, 9));
        }
        user = await Config.db.InsertOne(user, "users", 0, false, jwt);
        user = User.assign(user);
        user.addRight(WellknownIds.admins, "admins", [Rights.full_control]);
        user.addRight(user._id, user.name, [Rights.full_control]);
        user.removeRight(user._id, [Rights.delete]);
        await this.Save(user, jwt);
        var users: Role = await this.FindRoleByName("users");
        users.AddMember(user);

        if (Config.auto_create_personal_nodered_group) {
            var name = user.username;
            name = name.split("@").join("").split(".").join("");
            name = name.toLowerCase();

            var noderedadmins = await this.EnsureRole(jwt, name + "noderedadmins", null);
            noderedadmins.addRight(user._id, user.username, [Rights.full_control]);
            noderedadmins.removeRight(user._id, [Rights.delete]);
            noderedadmins.AddMember(user);
            await this.Save(noderedadmins, jwt);
        }

        await this.Save(users, jwt)
        await this.DecorateWithRoles(user);
        return user;
    }

}