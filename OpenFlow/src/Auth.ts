import { User } from "./User";
import { DatabaseConnection } from "./DatabaseConnection";
import { TokenUser } from "./TokenUser";
import { Crypt } from "./Crypt";

export class Auth {

    public static async ValidateByPassword(username:string, password:string): Promise<User> {
        if(username===null||username===undefined||username==="") { throw Error("Username cannot be null"); }
        if(password===null||password===undefined||password==="") { throw Error("Password cannot be null"); }
        var user: User = await User.FindByUsername(username);
        if(user===null || user===undefined) { return null; }
        if((await Crypt.compare(password, user.passwordhash)) !== true) { return null; }
        return user;
    }
}