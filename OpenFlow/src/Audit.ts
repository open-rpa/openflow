import { Config } from "./Config";
import { TokenUser, Base, Rights, NoderedUtil } from "@openiap/openflow-api";
import { Crypt } from "./Crypt";
import { Span } from "@opentelemetry/api";

export class Audit {
    public static LoginSuccess(user: TokenUser, type: string, provider: string, remoteip: string, clientagent: string, clientversion: string, parent: Span) {
        const log: Singin = new Singin();
        Base.addRight(log, user._id, user.name, [Rights.read]);
        log.remoteip = remoteip;
        log.success = true;
        log.type = type;
        log.provider = provider;
        log.userid = user._id;
        log.name = user.name;
        log.username = user.username;
        log.clientagent = clientagent;
        log.clientversion = clientversion;
        Config.db.InsertOne(log, "audit", 0, false, Crypt.rootToken(), parent)
            .catch((error) => console.error("failed InsertOne in LoginSuccess: " + error));
    }
    public static ImpersonateSuccess(user: TokenUser, impostor: TokenUser, clientagent: string, clientversion: string, parent: Span) {
        const log: Singin = new Singin();
        Base.addRight(log, user._id, user.name, [Rights.read]);
        Base.addRight(log, impostor._id, impostor.name, [Rights.read]);
        log.success = true;
        log.type = "impersonate";
        log.userid = user._id;
        log.name = user.name;
        log.username = user.username;
        log.impostoruserid = impostor._id;
        log.impostorname = impostor.name;
        log.impostorusername = impostor.username;
        log.clientagent = clientagent;
        log.clientversion = clientversion;
        Config.db.InsertOne(log, "audit", 0, false, Crypt.rootToken(), parent)
            .catch((error) => console.error("failed InsertOne in ImpersonateSuccess: " + error));
    }
    public static ImpersonateFailed(user: TokenUser, impostor: TokenUser, clientagent: string, clientversion: string, parent: Span) {
        const log: Singin = new Singin();
        Base.addRight(log, user._id, user.name, [Rights.read]);
        Base.addRight(log, impostor._id, impostor.name, [Rights.read]);
        log.success = false;
        log.type = "impersonate";
        log.userid = user._id;
        log.name = user.name;
        log.username = user.username;
        log.impostoruserid = impostor._id;
        log.impostorname = impostor.name;
        log.clientagent = clientagent;
        log.clientversion = clientversion;
        Config.db.InsertOne(log, "audit", 0, false, Crypt.rootToken(), parent)
            .catch((error) => console.error("failed InsertOne in ImpersonateFailed: " + error));
    }
    public static LoginFailed(username: string, type: string, provider: string, remoteip: string, clientagent: string, clientversion: string, parent: Span) {
        const log: Singin = new Singin();
        log.remoteip = remoteip;
        log.success = false;
        log.type = type;
        log.provider = provider;
        log.username = username;
        log.clientagent = clientagent;
        log.clientversion = clientversion;
        Config.db.InsertOne(log, "audit", 0, false, Crypt.rootToken(), parent)
            .catch((error) => console.error("failed InsertOne in LoginFailed: " + error));
    }
    public static NoderedAction(user: TokenUser, success: boolean, name: string, type: string, image: string, instancename: string, parent: Span) {
        const log: Nodered = new Nodered();
        Base.addRight(log, user._id, user.name, [Rights.read]);
        log.success = success;
        log.type = type;
        log.userid = user._id;
        log.name = name;
        log.username = user.username;
        log.instancename = instancename;
        log.image = image;
        if (!NoderedUtil.IsNullEmpty(image) && image.indexOf(':') > -1) {
            log.imagename = image.split(':')[0];
            log.imageversion = image.split(':')[1];
        } else {
            log.imagename = image;

        }
        if (!NoderedUtil.IsNullEmpty(instancename)) log.name = instancename;
        Config.db.InsertOne(log, "audit", 0, false, Crypt.rootToken(), parent)
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
    public clientagent: string;
    public clientversion: string;
    constructor() {
        super();
        this._type = "signin";
    }
}
export class Nodered extends Base {
    public success: boolean;
    public type: string;
    public userid: string;
    public username: string;
    public image: string;
    public imagename: string;
    public imageversion: string;
    public instancename: string;
    constructor() {
        super();
        this._type = "nodered";
    }
}
