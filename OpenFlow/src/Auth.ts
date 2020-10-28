import { Crypt } from "./Crypt";
import { User } from "openflow-api";
import { DBHelper } from "./DBHelper";
export class Auth {
    public static async ValidateByPassword(username: string, password: string): Promise<User> {
        if (username === null || username === undefined || username === "") { throw Error("Username cannot be null"); }
        if (password === null || password === undefined || password === "") { throw Error("Password cannot be null"); }
        const user: User = await DBHelper.FindByUsername(username);
        if (user === null || user === undefined) { return null; }
        if ((await Crypt.compare(password, user.passwordhash)) !== true) { return null; }
        return user;
    }
}