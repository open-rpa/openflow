import { Base, Rights, WellknownIds } from "./base";
import { DatabaseConnection } from "./DatabaseConnection";
import { TokenUser } from "./TokenUser";
import { Config } from "./Config";

export class Rolemember {
    constructor(name: string, _id: string) {
        this.name = name;
        this._id = _id;
    }
    name: string;
    _id: string;
}
export class Role extends Base {
    constructor() {
        super();
        this._type = "role";
    }
    static assign<T>(o: T): T {
        var newo: Role = new Role();
        return Object.assign(newo, o);
    }
    members: Rolemember[] = [];
    IsMember(_id: string): boolean {
        var hits: Rolemember[] = this.members.filter(member => member._id === _id);
        return (hits.length === 1);
    }
    AddMember(item: Base): void {
        if (!this.IsMember(item._id)) {
            this.members.push(new Rolemember(item.name, item._id));
        }
    }
    RemoveMember(_id: string): void {
        this.members.forEach((member, idx) => {
            if (member._id === _id) {
                this.members.splice(idx, 1);
            }
        });
    }
    public static async FindByName(name: string): Promise<Role> {
        var items: Role[] = await Config.db.query<Role>({ name: name }, null, 1, 0, null, "users", TokenUser.rootToken());
        if (items === null || items === undefined || items.length === 0) { return null; }
        var result: Role = Role.assign(items[0]);
        return result;
    }
    public static async FindByNameOrId(name: string, id: string): Promise<Role> {
        var jwt = TokenUser.rootToken();
        var items: Role[] = await Config.db.query<Role>({ $or: [{ name: name }, { _id: id }] }, null, 1, 0, null, "users", jwt);
        if (items === null || items === undefined || items.length === 0) { return null; }
        var result: Role = Role.assign(items[0]);
        result = Role.assign(result);
        // Temp hack to update all existing users and roles
        if (result._type == "user") {
            result.addRight(result._id, result.name, [Rights.full_control]);
            result.removeRight(result._id, [Rights.delete]);
        } else {
            result.removeRight(result._id, [Rights.full_control]);
            if (result.name != "users") {
                result.addRight(result._id, result.name, [Rights.read]);
            }
        }
        result.addRight(WellknownIds.admins, "admins", [Rights.full_control]);
        await result.Save(jwt);
        return result;
    }
    public async Save(jwt: string): Promise<void> {
        await Config.db._UpdateOne(null, this, "users", 0, false, jwt);
    }
}