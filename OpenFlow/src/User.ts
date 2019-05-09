import { Base } from "./base";
import { Rolemember, Role } from "./Role";
import { DatabaseConnection } from "./DatabaseConnection";
import { TokenUser } from "./TokenUser";
import { Crypt } from "./Crypt";
import { Config } from "./Config";

export class FederationId {
    constructor(id:string, issuer:string) {
        this.id = id; this.issuer = issuer;
    }
    public id:string;
    public issuer:string;
}
export class User extends Base {
    constructor() {
        super();
        this._type = "user";
    }
    static assign<T>(o:T):T {
        var newo:User = new User();
        return Object.assign(newo, o);
    }
    username:string;
    passwordhash:string;
    sid:string;
    firebasetoken: string;
    onesignalid: string;
    federationids:FederationId[] = [];
    roles:Rolemember[] = [];
    HasRoleName(name:string):Boolean {
        var hits:Rolemember[] = this.roles.filter(member=>member.name===name);
        return (hits.length===1);
    }
    HasRoleId(id:string):boolean {
        var hits:Rolemember[] = this.roles.filter(member=>member._id===id);
        return (hits.length===1);
    }
    public async Save(jwt:string):Promise<void> {
        if(this._id === null || this._id === undefined) {
            var temp:User = await Config.db.InsertOne(this, "users", jwt);
            this._id = temp._id;
        } else  {
            await Config.db.UpdateOne(this, "users", jwt);
        }
    }

    public static async FindByUsernameOrId(username:string, id:string):Promise<User> {
        console.log({$or: [ {username:username}, {_id:id}]});
        var items:User[] = await Config.db.query<User>({$or: [ {username:new RegExp(["^", username, "$"].join(""), "i")}, {_id:id}]},
            null, 1, 0, null, "users", TokenUser.rootToken());
        if(items === null || items === undefined || items.length === 0) { return null; }
        var result:User = User.assign(items[0]);
        await result.DecorateWithRoles();
        return result;
    }
    public static async FindByUsername(username:string):Promise<User> {
        var items:User[] = await Config.db.query<User>({ username:new RegExp(["^", username, "$"].join(""), "i") }, null, 1, 0, null, "users", TokenUser.rootToken());
        if(items === null || items === undefined || items.length === 0) { return null; }
        var result:User = User.assign(items[0]);
        await result.DecorateWithRoles();
        return result;
    }
    public static async FindByUsernameOrFederationid(username:string):Promise<User> {
        var items:User[] = await Config.db.query<User>({$or:
            [
                { username:new RegExp(["^", username, "$"].join(""), "i") },
                { federationids: {$elemMatch: {id:new RegExp(["^", username, "$"].join(""), "i") } } }
            ]}, null, 1, 0, null, "users", TokenUser.rootToken());
        if(items === null || items === undefined || items.length === 0) { return null; }
        var result:User = User.assign(items[0]);
        await result.DecorateWithRoles();
        return result;
    }
    public async SetPassword(password:string):Promise<void> {
        this.passwordhash = await Crypt.hash(password);
        if(! ( this.ValidatePassword(password))) { throw new Error("Failed validating password after hasing"); }
        console.log(password + " / " + this.passwordhash);
    }
    public async ValidatePassword(password:string):Promise<boolean> {
        console.log(password + " / " + this.passwordhash);
        return await Crypt.compare(password, this.passwordhash);
    }
    public async DecorateWithRoles():Promise<void> {
        let query:any = {_type:"role"};
        var _roles:Role[] = await Config.db.query<Role>(query,null,500,0,null, "users", TokenUser.rootToken());
        if(_roles.length===0 && this.username!=="root") {
            throw new Error("System has no roles !!!!!!");
        }
        this.roles = [];
        _roles.forEach(role => {
            var isMember:number = -1;
            if(role.members !== undefined) { isMember = role.members.map(function(e:Rolemember):string { return e._id; }).indexOf(this._id); }
            var beenAdded:number = this.roles.map(function(e:Rolemember):string { return e._id; }).indexOf(this._id);
            if(isMember>-1 && beenAdded === -1) {
                this.roles.push(new Rolemember(role.name, role._id));
            }
        });
        let foundone:boolean = true;
        while(foundone) {
            foundone = false;
            this.roles.forEach(userrole => {
                _roles.forEach(role => {
                    var isMember:number = -1;
                    if(role.members !== undefined) { isMember = role.members.map(function(e:Rolemember):string { return e._id; }).indexOf(userrole._id); }
                    var beenAdded:number = this.roles.map(function(e:Rolemember):string { return e._id; }).indexOf(role._id);
                    if(isMember>-1 && beenAdded === -1) {
                        this.roles.push(new Rolemember(role.name, role._id));
                        foundone = true;
                    }
                });
            });
        }
    }
}

