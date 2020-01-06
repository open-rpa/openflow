import { Base, WellknownIds, Rights } from "./base";
import { Rolemember, Role } from "./Role";
import { DatabaseConnection } from "./DatabaseConnection";
import { TokenUser } from "./TokenUser";
import { Crypt } from "./Crypt";
import { Config } from "./Config";

export class FederationId {
    constructor(id: string, issuer: string) {
        this.id = id; this.issuer = issuer;
    }
    public id: string;
    public issuer: string;
}
export class User extends Base {
    constructor() {
        super();
        this._type = "user";
    }
    static assign<T>(o: T): T {
        var newo: User = new User();
        return Object.assign(newo, o);
    }
    noderedname: string;
    lastseen: Date;
    _heartbeat: Date;
    _rpaheartbeat: Date;
    _noderedheartbeat: Date;
    _lastclientagent: string;
    _lastclientversion: string;
    _lastopenrpaclientversion: string;
    _lastnoderedclientversion: string;
    username: string;
    passwordhash: string;
    sid: string;
    firebasetoken: string;
    onesignalid: string;
    gpslocation: any;
    device: any;
    impersonating: string;
    federationids: FederationId[] = [];
    roles: Rolemember[] = [];
    public static async ensureUser(jwt: string, name: string, username: string, id: string, password: string): Promise<User> {
        var user: User = await User.FindByUsernameOrId(username, id);
        if (user !== null && (user._id === id || id === null)) { return user; }
        if (user !== null && id !== null) { await Config.db.DeleteOne(user._id, "users", jwt); }
        user = new User(); user._id = id; user.name = name; user.username = username;
        if (password !== null && password !== undefined && password !== "") {
            await user.SetPassword(password);
        } else {
            await user.SetPassword(Math.random().toString(36).substr(2, 9));
        }
        user = await Config.db.InsertOne(user, "users", 0, false, jwt);
        user = User.assign(user);
        user.addRight(WellknownIds.admins, "admins", [Rights.full_control]);
        user.addRight(user._id, user.name, [Rights.full_control]);
        user.removeRight(user._id, [Rights.delete]);
        await user.Save(jwt);
        var users: Role = await Role.FindByNameOrId("users", jwt);
        users.AddMember(user);

        if (Config.auto_create_personal_nodered_group) {
            var name = user.username;
            name = name.split("@").join("").split(".").join("");
            name = name.toLowerCase();

            var noderedadmins = await User.ensureRole(jwt, name + "noderedadmins", null);
            noderedadmins.addRight(user._id, user.username, [Rights.full_control]);
            noderedadmins.removeRight(user._id, [Rights.delete]);
            noderedadmins.AddMember(user);
            await noderedadmins.Save(jwt);
        }

        await users.Save(jwt)
        await user.DecorateWithRoles();
        return user;
    }
    public static async ensureRole(jwt: string, name: string, id: string): Promise<Role> {
        var role: Role = await Role.FindByNameOrId(name, id);
        if (role !== null && (role._id === id || id === null)) { return role; }
        if (role !== null && id !== null) { await Config.db.DeleteOne(role._id, "users", jwt); }
        role = new Role(); role._id = id; role.name = name;
        role = await Config.db.InsertOne(role, "users", 0, false, jwt);
        role = Role.assign(role);
        role.addRight(WellknownIds.admins, "admins", [Rights.full_control]);
        role.addRight(role._id, role.name, [Rights.full_control]);
        role.removeRight(role._id, [Rights.delete]);
        await role.Save(jwt);
        return role;
    }
    HasRoleName(name: string): Boolean {
        var hits: Rolemember[] = this.roles.filter(member => member.name === name);
        return (hits.length === 1);
    }
    HasRoleId(id: string): boolean {
        var hits: Rolemember[] = this.roles.filter(member => member._id === id);
        return (hits.length === 1);
    }
    public async Save(jwt: string): Promise<void> {
        if (this._id === null || this._id === undefined) {
            var temp: User = await Config.db.InsertOne(this, "users", 0, false, jwt);
            this._id = temp._id;
        } else {
            await Config.db._UpdateOne(null, this, "users", 0, false, jwt);
        }
    }

    public static async FindByUsernameOrId(username: string, id: string): Promise<User> {
        var items: User[] = await Config.db.query<User>({ $or: [{ username: new RegExp(["^", username, "$"].join(""), "i") }, { _id: id }] },
            null, 1, 0, null, "users", TokenUser.rootToken());
        if (items === null || items === undefined || items.length === 0) { return null; }
        var result: User = User.assign(items[0]);
        await result.DecorateWithRoles();
        return result;
    }
    public static async FindByUsername(username: string, jwt: string = null): Promise<User> {
        var byuser = { username: new RegExp(["^", username, "$"].join(""), "i") };
        //var byid = { federationids: { $elemMatch: new RegExp(["^", username, "$"].join(""), "i") } }
        var byid = { federationids: new RegExp(["^", username, "$"].join(""), "i") }
        var q = { $or: [byuser, byid] };
        if (jwt === null || jwt == undefined || jwt == "") { jwt = TokenUser.rootToken(); }
        var items: User[] = await Config.db.query<User>(q, null, 1, 0, null, "users", jwt);
        if (items === null || items === undefined || items.length === 0) { return null; }
        var result: User = User.assign(items[0]);
        await result.DecorateWithRoles();
        return result;
    }
    public static async FindByUsernameOrFederationid(username: string): Promise<User> {
        var byuser = { username: new RegExp(["^", username, "$"].join(""), "i") };
        //var byid = { federationids: { $elemMatch: new RegExp(["^", username, "$"].join(""), "i") } }
        var byid = { federationids: new RegExp(["^", username, "$"].join(""), "i") }
        var q = { $or: [byuser, byid] };
        var items: User[] = await Config.db.query<User>(q, null, 1, 0, null, "users", TokenUser.rootToken());
        // var items: User[] = await Config.db.query<User>({
        //     $or:
        //         [
        //             { username: new RegExp(["^", username, "$"].join(""), "i") },
        //             { federationids: { $elemMatch: { id: new RegExp(["^", username, "$"].join(""), "i") } } }
        //         ]
        // }, null, 1, 0, null, "users", TokenUser.rootToken());
        if (items === null || items === undefined || items.length === 0) { return null; }
        var result: User = User.assign(items[0]);
        await result.DecorateWithRoles();
        return result;
    }
    public async SetPassword(password: string): Promise<void> {
        this.passwordhash = await Crypt.hash(password);
        if (!(this.ValidatePassword(password))) { throw new Error("Failed validating password after hasing"); }
    }
    public async ValidatePassword(password: string): Promise<boolean> {
        return await Crypt.compare(password, this.passwordhash);
    }
    public async DecorateWithRoles(): Promise<void> {
        let query: any = { _type: "role" };
        var _roles: Role[] = await Config.db.query<Role>(query, null, 1000, 0, null, "users", TokenUser.rootToken());
        if (_roles.length === 0 && this.username !== "root") {
            throw new Error("System has no roles !!!!!!");
        }
        this.roles = [];
        _roles.forEach(role => {
            var isMember: number = -1;
            if (role.members !== undefined) { isMember = role.members.map(function (e: Rolemember): string { return e._id; }).indexOf(this._id); }
            var beenAdded: number = this.roles.map(function (e: Rolemember): string { return e._id; }).indexOf(this._id);
            if (isMember > -1 && beenAdded === -1) {
                this.roles.push(new Rolemember(role.name, role._id));
            }
        });
        let foundone: boolean = true;
        while (foundone) {
            foundone = false;
            this.roles.forEach(userrole => {
                _roles.forEach(role => {
                    var isMember: number = -1;
                    if (role.members !== undefined) { isMember = role.members.map(function (e: Rolemember): string { return e._id; }).indexOf(userrole._id); }
                    var beenAdded: number = this.roles.map(function (e: Rolemember): string { return e._id; }).indexOf(role._id);
                    if (isMember > -1 && beenAdded === -1) {
                        this.roles.push(new Rolemember(role.name, role._id));
                        foundone = true;
                    }
                });
            });
        }
    }

    // public static async ensureUser(name: string, username: string, password: string, id: string): Promise<User> {
    //     var user: User = await User.FindByUsernameOrId(username, id);
    //     if (user !== null && (user._id === id || id === null)) { return user; }
    //     if (user !== null && id !== null) { await Config.db.DeleteOne(user._id, "users", TokenUser.rootToken()); }
    //     user = new User(); user._id = id; user.name = name; user.username = username;
    //     if (password === null || password === undefined || password === "") { password = Math.random().toString(36).substr(2, 9); }
    //     await user.SetPassword(password);
    //     user = await Config.db.InsertOne(user, "users", 0, false, TokenUser.rootToken());
    //     user = User.assign(user);
    //     return user;
    // }

}

