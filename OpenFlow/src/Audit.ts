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
        Config.db.InsertOne(log, "audit", 0, false, TokenUser.rootToken())
            .catch((error) => console.error("failed InsertOne in LoginSuccess: " + error));
    }
    public static ImpersonateSuccess(user: TokenUser, impostor: TokenUser) {
        var log: Singin = new Singin();
        log.success = true;
        log.type = "impersonate";
        log.userid = user._id;
        log.name = user.name;
        log.username = user.username;
        log.impostoruserid = impostor._id;
        log.impostorname = impostor.name;
        log.impostorusername = impostor.username;
        Config.db.InsertOne(log, "audit", 0, false, TokenUser.rootToken())
            .catch((error) => console.error("failed InsertOne in ImpersonateSuccess: " + error));
    }
    public static ImpersonateFailed(user: TokenUser, impostor_id: string) {
        var log: Singin = new Singin();
        log.success = false;
        log.type = "impersonate";
        log.userid = user._id;
        log.name = user.name;
        log.username = user.username;
        log.impostoruserid = impostor_id;
        Config.db.InsertOne(log, "audit", 0, false, TokenUser.rootToken())
            .catch((error) => console.error("failed InsertOne in ImpersonateFailed: " + error));
    }
    public static LoginFailed(username: string, type: string, provider: string, remoteip: string) {
        var log: Singin = new Singin();
        log.remoteip = remoteip;
        log.success = false;
        log.type = type;
        log.provider = provider;
        log.username = username;
        Config.db.InsertOne(log, "audit", 0, false, TokenUser.rootToken())
            .catch((error) => console.error("failed InsertOne in LoginFailed: " + error));
    }
}
export class Singin extends Base {
    public success: boolean;
    public type: string;
    public provider: string;
    public userid: string;
    public username: string;
    public remoteip: string;
    public impostoruserid: string;
    public impostorname: string;
    public impostorusername: string;
    constructor() {
        super();
        this._type = "signin";
    }
}
