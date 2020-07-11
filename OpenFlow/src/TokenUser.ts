// import { User } from "./User";
// import { Rolemember } from "./Role";
// import { WellknownIds } from "./base";
// import { Crypt } from "./Crypt";
// import { Config } from "./Config";

// export class TokenUser {
//     _type: string;
//     _id: string;
//     name: string;
//     username: string;
//     roles: Rolemember[] = [];
//     impostor: string;
//     constructor(user: User | TokenUser) {
//         if (user === null || user === undefined) { return; }
//         this._type = user._type;
//         this._id = user._id;
//         this.impostor = (user as TokenUser).impostor;
//         this.name = user.name;
//         this.username = user.username;
//         this.roles = user.roles;
//     }
//     static assign<T>(o: T): T {
//         var newo: TokenUser = TokenUser.From(null);
//         return Object.assign(newo, o);
//     }
//     static rootUser(): User {
//         var result: User = new User();
//         result._type = "user"; result.name = "root"; result.username = "root"; result._id = WellknownIds.root;
//         result.roles = []; result.roles.push(new Rolemember("admins", WellknownIds.admins));
//         return result;
//     }
//     static rootToken(): string {
//         return Crypt.createToken(TokenUser.rootUser(), Config.shorttoken_expires_in);
//     }
//     hasrolename(name: string): Boolean {
//         var hits: Rolemember[] = this.roles.filter(member => member.name === name);
//         return (hits.length === 1);
//     }
//     hasroleid(id: string): boolean {
//         var hits: Rolemember[] = this.roles.filter(member => member._id === id);
//         return (hits.length === 1);
//     }

// }