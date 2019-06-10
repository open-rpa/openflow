import { Base } from "./base";
import { Config } from "./Config";
import { TokenUser } from "./TokenUser";

export class Audit {
    public static LoginSuccess(user: TokenUser, type: string, provider: string, remoteip: string) {
        var log: Singin = new Singin();
        log.remoteip = remoteip;
        log.success = true;
        log.type = type;
        log.provider = provider;
        log.userid = user._id;
        log.name = user.name;
        log.username = user.username;
        Config.db.InsertOne(log, "audit", 0, false, TokenUser.rootToken());
    }
    public static LoginFailed(username: string, type: string, provider: string, remoteip: string) {
        var log: Singin = new Singin();
        log.remoteip = remoteip;
        log.success = false;
        log.type = type;
        log.provider = provider;
        log.username = username;
        Config.db.InsertOne(log, "audit", 0, false, TokenUser.rootToken());
    }
}
export class Singin extends Base {
    public success: boolean;
    public type: string;
    public provider: string;
    public userid: string;
    public username: string;
    public remoteip: string;
    constructor() {
        super();
        this._type = "signin";
    }
}
