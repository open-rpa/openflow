import { Base } from "../base";
import { TokenUser } from "../TokenUser";

export class RegisterUserMessage implements IReplyMessage {
    public error: string;
    public jwt:any;

    public user:TokenUser;
    public name:string;
    public username:string;
    public password:string;
    static assign(o:any):RegisterUserMessage {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new RegisterUserMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new RegisterUserMessage(), o);
    }
}
