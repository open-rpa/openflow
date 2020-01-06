import { User } from "../User";
import { TokenUser } from "../TokenUser";

export class SigninMessage implements IReplyMessage {
    public error: string;

    public impersonate: string;
    public realm: string;
    public firebasetoken: string;
    public onesignalid: string;
    public gpslocation: any;
    public device: any;
    public websocket_package_size: number;
    public clientagent: string;
    public clientversion: string;

    public validate_only: boolean = false;
    public username: string;
    public password: string;
    public user: TokenUser;
    public jwt: string;
    public rawAssertion: string;
    static assign(o: any): SigninMessage {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new SigninMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new SigninMessage(), o);
    }
}
