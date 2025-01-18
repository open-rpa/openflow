function clog(message) {
    let dt = new Date();
    let dts: string = dt.getHours() + ":" + dt.getMinutes() + ":" + dt.getSeconds() + "." + dt.getMilliseconds();
    console.log(dts + " " + message);
}
function cerror(error) {
    let dt = new Date();
    let dts: string = dt.getHours() + ":" + dt.getMinutes() + ":" + dt.getSeconds() + "." + dt.getMilliseconds();
    console.error(dts, error.message ? error.message : error);
}
clog("Starting @openiap/core");
import { Span } from "@opentelemetry/api";
import crypto from "crypto";
import http from "http";
import { Config, dbConfig } from "./Config.js";
import { Crypt } from "./Crypt.js";
import { DatabaseConnection } from "./DatabaseConnection.js";
import { HouseKeeping } from "./HouseKeeping.js";
import { Logger } from "./Logger.js";
import { OAuthProvider } from "./OAuthProvider.js";
import { QueueClient } from "./QueueClient.js";
import { WebServer } from "./WebServer.js";
import { WebSocketServer } from "./WebSocketServer.js";
import { amqpwrapper } from "./amqpwrapper.js";
import { Base, User } from "./commoninterfaces.js";
clog("Done loading imports");
let amqp: amqpwrapper = null;
async function initamqp(parent: Span) {
    const span: Span = Logger.otel.startSubSpan("initamqp", parent);
    try {
        amqp = new amqpwrapper(Config.amqp_url);
        amqpwrapper.SetInstance(amqp);
        await amqp.connect(span);
    } catch (error) {
        Logger.instanse.error(error, span, { cls: "index", func: "initamqp" });
        return false;
    } finally {
        Logger.otel.endSpan(span);
    }
}
async function ValidateUserForm(parent: Span) {
    if (Config.validate_user_form != null && Config.validate_user_form != "") {
        const span: Span = Logger.otel.startSubSpan("ValidateUserForm", parent);
        try {
            var forms = await Config.db.query<Base>({ query: { _id: Config.validate_user_form, _type: "form" }, top: 1, collectionname: "forms", jwt: Crypt.rootToken() }, null);
            if (forms.length == 0) {
                Logger.instanse.info("validate_user_form " + Config.validate_user_form + " does not exists!", span, { cls: "index", func: "ValidateUserForm" });
                Config.validate_user_form = "";
            }
        } catch (error) {
            Logger.instanse.error(error, span, { cls: "index", func: "ValidateUserForm" });
            return false;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
}
function doHouseKeeping(span: Span) {
    if (HouseKeeping.lastHouseKeeping == null) {
        HouseKeeping.lastHouseKeeping = new Date();
        HouseKeeping.lastHouseKeeping.setDate(HouseKeeping.lastHouseKeeping.getDate() - 1);
    }
    amqpwrapper.Instance().send("openflow", "", { "command": "housekeeping", "lastrun": (new Date()).toISOString() }, 20000, null, "", span, 1);
    var dt = new Date(HouseKeeping.lastHouseKeeping.toISOString());
    var housekeeping_skip_calculate_size: boolean = !(dt.getHours() == 1 || dt.getHours() == 13);
    var housekeeping_skip_update_user_size: boolean = !(dt.getHours() == 1 || dt.getHours() == 13);
    if (Config.housekeeping_skip_calculate_size) housekeeping_skip_calculate_size = true;
    if (Config.housekeeping_skip_update_user_size) housekeeping_skip_update_user_size = true;
    if (Config.NODE_ENV == "production") {
        HouseKeeping.DoHouseKeeping(false, housekeeping_skip_calculate_size, housekeeping_skip_update_user_size, null).catch((error) => Logger.instanse.error(error, null, { cls: "index", func: "doHouseKeeping" }));
    } else {
        // While debugging, always do all calculations
        HouseKeeping.DoHouseKeeping(false, false, false, null).catch((error) => Logger.instanse.error(error, null, { cls: "index", func: "doHouseKeeping" }));
    }
}
function initHouseKeeping(span: Span) {
    const randomNum = crypto.randomInt(1, 100);
    // Every 15 minutes, give and take a few minutes, send out a message to do house keeping, if ready
    Logger.instanse.verbose("Housekeeping every 15 minutes plus " + randomNum + " seconds", span, { cls: "index", func: "initHouseKeeping" });
    housekeeping = setInterval(async () => {
        if (Config.enable_openflow_amqp) {
            if (!HouseKeeping.ReadyForHousekeeping()) {
                return;
            }
            amqpwrapper.Instance().send("openflow", "", { "command": "housekeeping" }, 10000, null, "", span, 1);
            await new Promise(resolve => { setTimeout(resolve, 10000) });
            if (HouseKeeping.ReadyForHousekeeping()) {
                doHouseKeeping(span);
            } else {
                Logger.instanse.verbose("SKIP housekeeping", span, { cls: "index", func: "initHouseKeeping" });
            }
        } else {
            doHouseKeeping(span);
        }
    }, (15 * 60 * 1000) + (randomNum * 1000));
    // If I'm first and noone else has run it, lets trigger it now
    const randomNum2 = crypto.randomInt(1, 10);
    Logger.instanse.info("Trigger first Housekeeping in " + randomNum2 + " seconds", span, { cls: "index", func: "initHouseKeeping" });
    setTimeout(async () => {
        if (Config.enable_openflow_amqp) {
            if (!HouseKeeping.ReadyForHousekeeping()) {
                return;
            }
            amqpwrapper.Instance().send("openflow", "", { "command": "housekeeping" }, 10000, null, "", span, 1);
            await new Promise(resolve => { setTimeout(resolve, 10000) });
            if (HouseKeeping.ReadyForHousekeeping()) {
                doHouseKeeping(span);
            } else {
                Logger.instanse.verbose("SKIP housekeeping", span, { cls: "index", func: "initHouseKeeping" });
            }
        } else {
            doHouseKeeping(span);
        }
    }, randomNum2 * 1000);
}
async function initDatabase(parent: Span): Promise<boolean> {
    const span: Span = Logger.otel.startSubSpan("initDatabase", parent);
    try {
        const jwt: string = Crypt.rootToken();
        Config.dbConfig = await dbConfig.Load(jwt, false, span);
        try {
            if (Config.license_key != null && Config.license_key != "") {
                var lic = Logger.License;
                await lic?.validate();
            }
        } catch (error) {
        }
        try {
            await Logger.configure(false, true);
        } catch (error) {
            cerror(error);
            process.exit(404);
        }
        const users = await Config.db.query<User>({ query: { _type: "role" }, top: 4, collectionname: "users", projection: { "name": 1 }, jwt: jwt }, span);
        if (users.length != 4) {
            await HouseKeeping.ensureBuiltInUsersAndRoles(span);
        }
        return true;
    } catch (error) {
        Logger.instanse.error(error, span, { cls: "index", func: "initDatabase" });
        return false;
    } finally {
        Logger.otel.endSpan(span);
    }
}
async function PreRegisterExchanges(span: Span) {
    var exchanges = await Config.db.query<Base>({ query: { _type: "exchange" }, collectionname: "mq", jwt: Crypt.rootToken() }, span);
    for (let i = 0; i < exchanges.length; i++) {
        const exchange = exchanges[i];
        await amqpwrapper.Instance().PreRegisterExchange(exchange, span);
    }
}
process.on("beforeExit", (code) => {
    Logger.instanse.error(code as any, null, { cls: "index", func: "beforeExit" });
});
process.on("exit", (code) => {
    Logger.instanse.error(code as any, null, { cls: "index", func: "exit" });
});
const unhandledRejections = new Map();
process.on("unhandledRejection", (reason, promise) => {
    Logger.instanse.error(reason as any, null, { cls: "index", func: "unhandledRejection" });
    unhandledRejections.set(promise, reason);
});
process.on("rejectionHandled", (promise) => {
    unhandledRejections.delete(promise);
});
process.on("uncaughtException", (err, origin) => {
    Logger.instanse.error(err, null, { cls: "index", func: "uncaughtException" });
});
function onerror(err, origin) {
    Logger.instanse.error(err, null, { cls: "index", func: "onerror" });
}
process.on("uncaughtExceptionMonitor", onerror);
function onWarning(warning) {
    try {
        Logger.instanse.warn(warning.name + ": " + warning.message, null, { cls: "index", func: "onWarning" });
    } catch (error) {
    }
}
process.on("warning", onWarning);
// The signals we want to handle
// NOTE: although it is tempting, the SIGKILL signal (9) cannot be intercepted and handled
var signals = {
    "SIGHUP": 1,
    "SIGINT": 2,
    "SIGTERM": 15
};
var housekeeping = null;
async function handle(signal, value) {
    Logger.instanse.info(`process received a ${signal} signal with value ${value}`, null, { cls: "index", func: "handle" });
    try {
        if (Config.heapdump_onstop) {
            await Logger.otel.createheapdump(null);
        }
        Config.db.shutdown();
        Logger.otel.shutdown();
        Logger.License.shutdown()
        if (housekeeping != null) {
            try {
                clearInterval(housekeeping);
            } catch (error) {
            }
        }
        setTimeout(() => {
            process.exit(128 + value);
        }, 1000);
        if (server != null && server.close) {
            server.close((err) => {
                Logger.instanse.info(`server stopped by ${signal} with value ${value}`, null, { cls: "index", func: "handle" });
                Logger.instanse.error(err, null, { cls: "index", func: "handle" });
                process.exit(128 + value);
            })
        }
    } catch (error) {
        Logger.instanse.error(error, null, { cls: "index", func: "handle" });
        Logger.instanse.info(`server stopped by ${signal} with value ${value}`, null, { cls: "index", func: "handle" });
        process.exit(128 + value);
    }
}
Object.keys(signals).forEach((signal) => process.on(signal, handle));

const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalStderrWrite = process.stderr.write.bind(process.stderr);
(process.stdout.write as any) = (chunk: string, encoding?: string, callback?: (err?: Error | null) => void): boolean => {
    return originalStdoutWrite(chunk, encoding, callback);
};
(process.stderr.write as any) = (chunk: string, encoding?: string, callback?: (err?: Error | null) => void): boolean => {
    return originalStderrWrite(chunk, encoding, callback);
};

var server: http.Server = null;
(async function (): Promise<void> {
    try {
        await Logger.configure(false, false);
    } catch (error) {
        cerror(error);
        process.exit(404);
    }
    Config.db = new DatabaseConnection(Config.mongodb_url, Config.mongodb_db);
    const span: Span = Logger.otel.startSpan("openflow.startup", null, null);
    try {
        await Config.db.connect(span);
        await initamqp(span);
        await PreRegisterExchanges(span);
        Logger.instanse.info("VERSION: " + Config.version, span, { cls: "index", func: "init" });
        Logger.instanse.debug("Configure Webserver", span, { cls: "index", func: "init" });
        server = await WebServer.configure(Config.baseurl(), span);
        try {
            // @ts-ignore
            let GrafanaProxy: any = await import("./ee/grafana-proxy.js");
            Logger.instanse.debug("Configure grafana", span, { cls: "index", func: "init" });
            const grafana = await GrafanaProxy.GrafanaProxy.configure(WebServer.app, span);
        } catch (error) {
            cerror(error.message);
        }
        try {
            let OpenAPIProxy: any = await import("./ee/OpenAPIProxy.js");
            Logger.instanse.debug("Configure open api", span, { cls: "index", func: "init" });
            const OpenAI = await OpenAPIProxy.OpenAPIProxy.configure(WebServer.app, span);
        } catch (error) {
            cerror(error.message);
        }
        try {
            let GitProxy: any = await import("./ee/GitProxy.js");
            Logger.instanse.debug("Configure git server", span, { cls: "index", func: "init" });
            const Git = await GitProxy.GitProxy.configure(WebServer.app, span);
        } catch (error) {
            cerror(error.message);
        }
        Logger.instanse.debug("Configure oauth provider", span, { cls: "index", func: "init" });
        OAuthProvider.configure(WebServer.app, span);
        Logger.instanse.debug("Configure websocket server", span, { cls: "index", func: "init" });
        WebSocketServer.configure(server, span);
        Logger.instanse.debug("init database", span, { cls: "index", func: "init" });
        if (!await initDatabase(span)) {
            process.exit(404);
        }
        Logger.instanse.debug("init house keeping", span, { cls: "index", func: "init" });
        initHouseKeeping(span);
        Logger.instanse.debug("Init queue handler (openflow amqp)", span, { cls: "index", func: "init" });
        await QueueClient.configure(span);
        Logger.instanse.debug("Validate user validation form exists, if needed", span, { cls: "index", func: "init" });
        await ValidateUserForm(span);
        Logger.instanse.debug("Begin listening on ports", span, { cls: "index", func: "init" });
        WebServer.Listen();
        if (Config.workitem_queue_monitoring_enabled) {
            Logger.instanse.verbose("Start workitem queue monitor", span, { cls: "index", func: "init" });
            Config.db.ensureQueueMonitoring();
        }
    } catch (error) {
        Logger.instanse.error(error, span, { cls: "index", func: "init" });
        process.exit(404);
    } finally {
        Logger.otel.endSpan(span);
    }
})();

