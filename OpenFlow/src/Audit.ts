import { Config } from "./Config";
import { TokenUser, Base, Rights, NoderedUtil } from "@openiap/openflow-api";
import { Crypt } from "./Crypt";
import { Span } from "@opentelemetry/api";
import { Logger } from "./Logger";
import { DatabaseConnection } from "./DatabaseConnection";
import { UpDownCounter } from "@opentelemetry/api-metrics";

export type tokenType = "local" | "jwtsignin" | "samltoken" | "tokenissued" | "weblogin";
export type loginProvider = "saml" | "google" | "openid" | "local" | "websocket";
export type clientType = "browser" | "openrpa" | "nodered" | "webapp" | "openflow" | "powershell" | "mobileapp" | "samlverify" | "googleverify" | "aiotmobileapp" | "aiotwebapp";
export class Audit {
    public static openflow_logins: UpDownCounter = null;
    public static ensure_openflow_logins() {
        if (!NoderedUtil.IsNullUndefinded(Audit.openflow_logins)) return;
        if (!NoderedUtil.IsNullUndefinded(Logger.otel) && !NoderedUtil.IsNullUndefinded(Logger.otel.meter)) {
            Audit.openflow_logins = Logger.otel.meter.createUpDownCounter('openflow_logins', {
                description: 'Number of login attempts'
            });
        }
    }
    public static async LoginSuccess(user: TokenUser, type: tokenType, provider: loginProvider, remoteip: string, clientagent: clientType, clientversion: string, parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("Audit.LoginSuccess", parent);
        try {
            Audit.ensure_openflow_logins();
            Audit.openflow_logins?.add(1, { ...Logger.otel.defaultlabels, result: "success", clientagent });
            const log: Singin = new Singin();
            Base.addRight(log, user._id, user.name, [Rights.read, Rights.update, Rights.invoke]);
            log.remoteip = remoteip;
            log.ip = Audit.dot2num(log.remoteip);
            log.success = true;
            log.type = type;
            log.provider = provider;
            log.userid = user._id;
            log.name = user.name;
            log.username = user.username;
            log.clientagent = clientagent;
            log.clientversion = clientversion;
            await Config.db.InsertOne(log, "audit", 0, false, Crypt.rootToken(), span);
        } catch (error) {
            Logger.instanse.error(error, span);
        }
        finally {
            Logger.otel.endSpan(span);
        }
    }
    public static async ImpersonateSuccess(user: TokenUser, impostor: TokenUser, clientagent: clientType, clientversion: string, parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("Audit.ImpersonateSuccess", parent);
        try {
            Audit.ensure_openflow_logins();
            Audit.openflow_logins?.add(1, { ...Logger.otel.defaultlabels, result: "impersonate", clientagent });
            const log: Singin = new Singin();
            Base.addRight(log, user._id, user.name, [Rights.read]);
            Base.addRight(log, impostor._id, impostor.name, [Rights.read]);
            log.success = true;
            log._type = "impersonate";
            log.type = "impersonate";
            log.userid = user._id;
            log.name = user.name;
            log.username = user.username;
            log.impostoruserid = impostor._id;
            log.impostorname = impostor.name;
            log.impostorusername = impostor.username;
            log.clientagent = clientagent;
            log.clientversion = clientversion;
            Config.db.InsertOne(log, "audit", 0, false, Crypt.rootToken(), span);
        } catch (error) {
            Logger.instanse.error(error, span);
        }
        finally {
            Logger.otel.endSpan(span);
        }
    }
    public static async ImpersonateFailed(user: TokenUser, impostor: TokenUser, clientagent: clientType, clientversion: string, parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("Audit.ImpersonateFailed", parent);
        try {
            Audit.ensure_openflow_logins();
            Audit.openflow_logins?.add(1, { ...Logger.otel.defaultlabels, result: "impersonatefailed", clientagent });
            const log: Singin = new Singin();
            Base.addRight(log, user._id, user.name, [Rights.read]);
            Base.addRight(log, impostor._id, impostor.name, [Rights.read]);
            log.success = false;
            log._type = "impersonate";
            log.type = "impersonate";
            log.userid = user._id;
            log.name = impostor.name + " -> " + user.name;
            log.username = user.username;
            log.impostoruserid = impostor._id;
            log.impostorname = impostor.name;
            log.clientagent = clientagent;
            log.clientversion = clientversion;
            Config.db.InsertOne(log, "audit", 0, false, Crypt.rootToken(), span);
        } catch (error) {
            Logger.instanse.error(error, span);
        }
        finally {
            Logger.otel.endSpan(span);
        }
    }
    public static async LoginFailed(username: string, type: tokenType, provider: loginProvider, remoteip: string, clientagent: clientType, clientversion: string, parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("Audit.LoginFailed", parent);
        try {
            Audit.ensure_openflow_logins();
            Audit.openflow_logins?.add(1, { ...Logger.otel.defaultlabels, result: "failed", clientagent });
            const log: Singin = new Singin();
            log.remoteip = remoteip;
            log.ip = Audit.dot2num(log.remoteip);
            log.success = false;
            log.type = type;
            log.name = "[failed]" + username;
            log.provider = provider;
            log.username = username;
            log.clientagent = clientagent;
            log.clientversion = clientversion;
            Config.db.InsertOne(log, "audit", 0, false, Crypt.rootToken(), span);
        } catch (error) {
            Logger.instanse.error(error, span);
        }
        finally {
            Logger.otel.endSpan(span);
        }
    }
    public static async NoderedAction(user: TokenUser, success: boolean, name: string, type: string, image: string, instancename: string, parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("Audit.NoderedAction", parent);
        try {
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
            await Config.db.InsertOne(log, "audit", 0, false, Crypt.rootToken(), span);
        } catch (error) {
            Logger.instanse.error(error, span);
        }
        finally {
            Logger.otel.endSpan(span);
        }
    }
    static dot2num(dot: string): number {
        if (NoderedUtil.IsNullEmpty(dot)) return 0;
        if (dot.indexOf(".") == -1) return 0;
        var d = dot.split('.');
        return ((((((+d[0]) * 256) + (+d[1])) * 256) + (+d[2])) * 256) + (+d[3]);
    }
    static num2dot(num: number): string {
        if (NoderedUtil.IsNullEmpty(num)) return "";
        if (num < 1) return "";
        var d: string = (num % 256).toString();
        for (var i = 3; i > 0; i--) {
            num = Math.floor(num / 256);
            d = num % 256 + '.' + d;
        }
        return d;
    }

}
export class Singin extends Base {
    public success: boolean;
    public type: string;
    public provider: string;
    public userid: string;
    public username: string;
    public remoteip: string;
    public ip: number;
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
