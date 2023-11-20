function clog(message) {
    let dt = new Date();
    let dts: string = dt.getHours() + ":" + dt.getMinutes() + ":" + dt.getSeconds() + "." + dt.getMilliseconds();
    console.log(dts + " " + message);
}
clog("Starting @openiap/openflow");
import { Logger } from "./Logger";
import * as http from "http";
import { WebServer } from "./WebServer";
import { WebSocketServer } from "./WebSocketServer";
import { DatabaseConnection } from "./DatabaseConnection";
import { Crypt } from "./Crypt";
import { Config, dbConfig } from "./Config";
import { amqpwrapper } from "./amqpwrapper";
import { WellknownIds, Role, Rights, User, Base, NoderedUtil } from "@openiap/openflow-api";
import { OAuthProvider } from "./OAuthProvider";
import { Span } from "@opentelemetry/api";
import { QueueClient } from "./QueueClient";
import { Message } from "./Messages/Message";
clog("Done loading imports");
let amqp: amqpwrapper = null;
async function initamqp(parent: Span) {
    const span: Span = Logger.otel.startSubSpan("initamqp", parent);
    try {
        amqp = new amqpwrapper(Config.amqp_url);
        amqpwrapper.SetInstance(amqp);
        await amqp.connect(span);
    } catch (error) {
        Logger.instanse.error(error, span);
        return false;
    } finally {
        Logger.otel.endSpan(span);
    }
}
async function ValidateUserForm(parent: Span) {
    const span: Span = Logger.otel.startSubSpan("ValidateUserForm", parent);
    try {
        var forms = await Config.db.query<Base>({ query: { _id: Config.validate_user_form, _type: "form" }, top: 1, collectionname: "forms", jwt: Crypt.rootToken() }, null);
        if (forms.length == 0) {
            Logger.instanse.info("validate_user_form " + Config.validate_user_form + " does not exists!", span);
            Config.validate_user_form = "";
        }
    } catch (error) {
        Logger.instanse.error(error, span);
        return false;
    } finally {
        Logger.otel.endSpan(span);
    }
}
function doHouseKeeping(span: Span) {
    // Message.lastHouseKeeping = new Date();
    if (Message.lastHouseKeeping == null) {
        Message.lastHouseKeeping = new Date();
        Message.lastHouseKeeping.setDate(Message.lastHouseKeeping.getDate() - 1);
    }
    amqpwrapper.Instance().send("openflow", "", { "command": "housekeeping", "lastrun": (new Date()).toISOString() }, 20000, null, "", span, 1);
    var dt = new Date(Message.lastHouseKeeping.toISOString());
    var msg2 = new Message(); msg2.jwt = Crypt.rootToken();
    var h = dt.getHours();
    var skipUpdateUsage: boolean = !(dt.getHours() == 1 || dt.getHours() == 13);
    if (Config.NODE_ENV == "production") {
        msg2._Housekeeping(false, skipUpdateUsage, skipUpdateUsage, null).catch((error) => Logger.instanse.error(error, null));
    } else {
        // While debugging, always do all calculations
        msg2._Housekeeping(false, false, false, null).catch((error) => Logger.instanse.error(error, null));
        // msg2._Housekeeping(true, true, true, null).catch((error) => Logger.instanse.error("index", "doHouseKeeping", error));
    }
}
async function initDatabase(parent: Span): Promise<boolean> {
    const span: Span = Logger.otel.startSubSpan("initDatabase", parent);
    try {
        Logger.instanse.info("Begin validating builtin roles", span);
        const jwt: string = Crypt.rootToken();
        const rootuser = Crypt.rootUser();
        Config.dbConfig = await dbConfig.Load(jwt, span);
        try {
            var lic = Logger.License;
            await lic?.validate();
        } catch (error) {
            console.log(error);            
        }
        try {
            await Logger.configure(false, true);
        } catch (error) {
            console.error(error);
            process.exit(404);
        }
    


        const admins: Role = await Logger.DBHelper.EnsureRole(jwt, "admins", WellknownIds.admins, span);
        const users: Role = await Logger.DBHelper.EnsureRole(jwt, "users", WellknownIds.users, span);
        const root: User = await Logger.DBHelper.EnsureUser(jwt, "root", "root", WellknownIds.root, null, null, span);

        Base.addRight(root, WellknownIds.admins, "admins", [Rights.full_control]);
        Base.removeRight(root, WellknownIds.admins, [Rights.delete]);
        Base.addRight(root, WellknownIds.root, "root", [Rights.full_control]);
        Base.removeRight(root, WellknownIds.root, [Rights.delete]);
        await Logger.DBHelper.Save(root, jwt, span);

        const robot_agent_users: Role = await Logger.DBHelper.EnsureRole(jwt, "robot agent users", WellknownIds.robot_agent_users, span);
        Base.addRight(robot_agent_users, WellknownIds.admins, "admins", [Rights.full_control]);
        Base.removeRight(robot_agent_users, WellknownIds.admins, [Rights.delete]);
        Base.addRight(robot_agent_users, WellknownIds.root, "root", [Rights.full_control]);
        if (Config.multi_tenant) {
            Logger.instanse.silly("[root][users] Running in multi tenant mode, remove " + robot_agent_users.name + " from self", span);
            Base.removeRight(robot_agent_users, robot_agent_users._id, [Rights.full_control]);
        } else if (Config.update_acl_based_on_groups) {
            Base.removeRight(robot_agent_users, robot_agent_users._id, [Rights.full_control]);
            Base.addRight(robot_agent_users, robot_agent_users._id, "robot agent users", [Rights.read]);
        }
        await Logger.DBHelper.Save(robot_agent_users, jwt, span);

        Base.addRight(admins, WellknownIds.admins, "admins", [Rights.full_control]);
        Base.removeRight(admins, WellknownIds.admins, [Rights.delete]);
        await Logger.DBHelper.Save(admins, jwt, span);

        Base.addRight(users, WellknownIds.admins, "admins", [Rights.full_control]);
        Base.removeRight(users, WellknownIds.admins, [Rights.delete]);
        users.AddMember(root);
        if (Config.multi_tenant) {
            Base.removeRight(users, users._id, [Rights.full_control]);
        } else {
            Base.removeRight(users, users._id, [Rights.full_control]);
            Base.addRight(users, users._id, "users", [Rights.read]);
        }
        await Logger.DBHelper.Save(users, jwt, span);

        var config: Base = await Config.db.GetOne({ query: { "_type": "config" }, collectionname: "config", jwt }, span);
        if (config == null) {
            config = new Base();
            config._type = "config";
            config.name = "Config override";
        }

        if (Config.dbConfig.compare("1.4.25") == -1) {
            // Fix queue and exchange names from before 1.4.25 where names would be saved without converting to lowercase
            var cursor = await Config.db.db.collection("mq").find({ "$or": [{ "_type": "exchange" }, { "_type": "queue" }] });
            for await (const u of cursor) {
                if (u.name != u.name.toLowerCase()) {
                    await Config.db.db.collection("mq").updateOne({ "_id": u._id }, { "$set": { "name": u.name.toLowerCase() } });
                }
            }
            cursor.close();
        }


        if (Config.dbConfig.needsupdate) {
            await Config.dbConfig.Save(jwt, span);
        }


        const personal_nodered_users: Role = await Logger.DBHelper.EnsureRole(jwt, "personal nodered users", WellknownIds.personal_nodered_users, span);
        personal_nodered_users.AddMember(admins);
        Base.addRight(personal_nodered_users, WellknownIds.admins, "admins", [Rights.full_control]);
        Base.removeRight(personal_nodered_users, WellknownIds.admins, [Rights.delete]);
        if (Config.multi_tenant) {
            Logger.instanse.silly("[root][users] Running in multi tenant mode, remove " + personal_nodered_users.name + " from self", span);
            Base.removeRight(personal_nodered_users, personal_nodered_users._id, [Rights.full_control]);
        } else if (Config.update_acl_based_on_groups) {
            Base.removeRight(personal_nodered_users, personal_nodered_users._id, [Rights.full_control]);
            Base.addRight(personal_nodered_users, personal_nodered_users._id, "personal nodered users", [Rights.read]);
        }
        await Logger.DBHelper.Save(personal_nodered_users, jwt, span);
        const nodered_admins: Role = await Logger.DBHelper.EnsureRole(jwt, "nodered admins", WellknownIds.nodered_admins, span);
        nodered_admins.AddMember(admins);
        Base.addRight(nodered_admins, WellknownIds.admins, "admins", [Rights.full_control]);
        Base.removeRight(nodered_admins, WellknownIds.admins, [Rights.delete]);
        await Logger.DBHelper.Save(nodered_admins, jwt, span);
        const nodered_users: Role = await Logger.DBHelper.EnsureRole(jwt, "nodered users", WellknownIds.nodered_users, span);
        nodered_users.AddMember(admins);
        Base.addRight(nodered_users, WellknownIds.admins, "admins", [Rights.full_control]);
        Base.removeRight(nodered_users, WellknownIds.admins, [Rights.delete]);
        if (Config.multi_tenant) {
            Logger.instanse.silly("[root][users] Running in multi tenant mode, remove " + nodered_users.name + " from self", span);
            Base.removeRight(nodered_users, nodered_users._id, [Rights.full_control]);
        } else if (Config.update_acl_based_on_groups) {
            Base.removeRight(nodered_users, nodered_users._id, [Rights.full_control]);
            Base.addRight(nodered_users, nodered_users._id, "nodered users", [Rights.read]);
        }
        await Logger.DBHelper.Save(nodered_users, jwt, span);
        const nodered_api_users: Role = await Logger.DBHelper.EnsureRole(jwt, "nodered api users", WellknownIds.nodered_api_users, span);
        nodered_api_users.AddMember(admins);
        Base.addRight(nodered_api_users, WellknownIds.admins, "admins", [Rights.full_control]);
        Base.removeRight(nodered_api_users, WellknownIds.admins, [Rights.delete]);
        if (Config.multi_tenant) {
            Logger.instanse.silly("[root][users] Running in multi tenant mode, remove " + nodered_api_users.name + " from self", span);
            Base.removeRight(nodered_api_users, nodered_api_users._id, [Rights.full_control]);
        } else if (Config.update_acl_based_on_groups) {
            Base.removeRight(nodered_api_users, nodered_api_users._id, [Rights.full_control]);
            Base.addRight(nodered_api_users, nodered_api_users._id, "nodered api users", [Rights.read]);
        }
        await Logger.DBHelper.Save(nodered_api_users, jwt, span);

        if (Config.multi_tenant) {
            try {
                const resellers: Role = await Logger.DBHelper.EnsureRole(jwt, "resellers", WellknownIds.resellers, span);
                // @ts-ignore
                resellers.hidemembers = true;
                Base.addRight(resellers, WellknownIds.admins, "admins", [Rights.full_control]);
                Base.removeRight(resellers, WellknownIds.admins, [Rights.delete]);
                Base.removeRight(resellers, WellknownIds.resellers, [Rights.full_control]);
                resellers.AddMember(admins);
                await Logger.DBHelper.Save(resellers, jwt, span);

                const customer_admins: Role = await Logger.DBHelper.EnsureRole(jwt, "customer admins", WellknownIds.customer_admins, span);
                // @ts-ignore
                customer_admins.hidemembers = true;
                Base.addRight(customer_admins, WellknownIds.admins, "admins", [Rights.full_control]);
                Base.removeRight(customer_admins, WellknownIds.admins, [Rights.delete]);
                Base.removeRight(customer_admins, WellknownIds.customer_admins, [Rights.full_control]);
                await Logger.DBHelper.Save(customer_admins, jwt, span);
            } catch (error) {
                Logger.instanse.error(error, span);
            }
        }


        const robot_admins: Role = await Logger.DBHelper.EnsureRole(jwt, "robot admins", WellknownIds.robot_admins, span);
        robot_admins.AddMember(admins);
        Base.addRight(robot_admins, WellknownIds.admins, "admins", [Rights.full_control]);
        Base.removeRight(robot_admins, WellknownIds.admins, [Rights.delete]);
        await Logger.DBHelper.Save(robot_admins, jwt, span);
        const robot_users: Role = await Logger.DBHelper.EnsureRole(jwt, "robot users", WellknownIds.robot_users, span);
        robot_users.AddMember(admins);
        robot_users.AddMember(users);
        Base.addRight(robot_users, WellknownIds.admins, "admins", [Rights.full_control]);
        Base.removeRight(robot_users, WellknownIds.admins, [Rights.delete]);
        if (Config.multi_tenant) {
            Logger.instanse.silly("[root][users] Running in multi tenant mode, remove " + robot_users.name + " from self", span);
            Base.removeRight(robot_users, robot_users._id, [Rights.full_control]);
        } else if (Config.update_acl_based_on_groups) {
            Base.removeRight(robot_users, robot_users._id, [Rights.full_control]);
            Base.addRight(robot_users, robot_users._id, "robot users", [Rights.read, Rights.invoke, Rights.update]);
        }
        await Logger.DBHelper.Save(robot_users, jwt, span);

        if (!admins.IsMember(root._id)) {
            admins.AddMember(root);
            await Logger.DBHelper.Save(admins, jwt, span);
        }

        const filestore_admins: Role = await Logger.DBHelper.EnsureRole(jwt, "filestore admins", WellknownIds.filestore_admins, span);
        filestore_admins.AddMember(admins);
        Base.addRight(filestore_admins, WellknownIds.admins, "admins", [Rights.full_control]);
        Base.removeRight(filestore_admins, WellknownIds.admins, [Rights.delete]);
        if (Config.multi_tenant) {
            Logger.instanse.silly("[root][users] Running in multi tenant mode, remove " + filestore_admins.name + " from self", span);
            Base.removeRight(filestore_admins, filestore_admins._id, [Rights.full_control]);
        }
        await Logger.DBHelper.Save(filestore_admins, jwt, span);
        const filestore_users: Role = await Logger.DBHelper.EnsureRole(jwt, "filestore users", WellknownIds.filestore_users, span);
        filestore_users.AddMember(admins);
        if (!Config.multi_tenant) {
            filestore_users.AddMember(users);
        }
        Base.addRight(filestore_users, WellknownIds.admins, "admins", [Rights.full_control]);
        Base.removeRight(filestore_users, WellknownIds.admins, [Rights.delete]);
        if (Config.multi_tenant) {
            Logger.instanse.silly("[root][users] Running in multi tenant mode, remove " + filestore_users.name + " from self", span);
            Base.removeRight(filestore_users, filestore_users._id, [Rights.full_control]);
        } else if (Config.update_acl_based_on_groups) {
            Base.removeRight(filestore_users, filestore_users._id, [Rights.full_control]);
            Base.addRight(filestore_users, filestore_users._id, "filestore users", [Rights.read]);
        }
        await Logger.DBHelper.Save(filestore_users, jwt, span);



        const workitem_queue_admins: Role = await Logger.DBHelper.EnsureRole(jwt, "workitem queue admins", "625440c4231309af5f2052cd", span);
        workitem_queue_admins.AddMember(admins);
        Base.addRight(workitem_queue_admins, WellknownIds.admins, "admins", [Rights.full_control]);
        Base.removeRight(workitem_queue_admins, WellknownIds.admins, [Rights.delete]);
        if (Config.multi_tenant) {
            Base.removeRight(workitem_queue_admins, WellknownIds.admins, [Rights.full_control]);
        }
        await Logger.DBHelper.Save(workitem_queue_admins, jwt, span);

        const workitem_queue_users: Role = await Logger.DBHelper.EnsureRole(jwt, "workitem queue users", "62544134231309e2cd2052ce", span);
        Base.addRight(workitem_queue_users, WellknownIds.admins, "admins", [Rights.full_control]);
        Base.removeRight(workitem_queue_users, WellknownIds.admins, [Rights.delete]);
        if (Config.multi_tenant) {
            Base.removeRight(workitem_queue_users, WellknownIds.admins, [Rights.full_control]);
        }
        await Logger.DBHelper.Save(workitem_queue_users, jwt, span);

        if (Config.auto_hourly_housekeeping) {
            const crypto = require('crypto');
            const randomNum = crypto.randomInt(1, 100);
            // Every 15 minutes, give and take a few minutes, send out a message to do house keeping, if ready
            Logger.instanse.verbose("Housekeeping every 15 minutes plus " + randomNum + " seconds", span);
            housekeeping = setInterval(async () => {
                if (Config.enable_openflow_amqp) {
                    if (!Message.ReadyForHousekeeping()) {
                        return;
                    }
                    amqpwrapper.Instance().send("openflow", "", { "command": "housekeeping" }, 10000, null, "", span, 1);
                    await new Promise(resolve => { setTimeout(resolve, 10000) });
                    if (Message.ReadyForHousekeeping()) {
                        doHouseKeeping(span);
                    } else {
                        Logger.instanse.verbose("SKIP housekeeping", span);
                    }
                } else {
                    doHouseKeeping(span);
                }
            }, (15 * 60 * 1000) + (randomNum * 1000));
            // If I'm first and noone else has run it, lets trigger it now
            const randomNum2 = crypto.randomInt(1, 10);
            Logger.instanse.info("Trigger first Housekeeping in " + randomNum2 + " seconds", span);
            setTimeout(async () => {
                if (Config.enable_openflow_amqp) {
                    if (!Message.ReadyForHousekeeping()) {
                        return;
                    }
                    amqpwrapper.Instance().send("openflow", "", { "command": "housekeeping" }, 10000, null, "", span, 1);
                    await new Promise(resolve => { setTimeout(resolve, 10000) });
                    if (Message.ReadyForHousekeeping()) {
                        doHouseKeeping(span);
                    } else {
                        Logger.instanse.verbose("SKIP housekeeping", span);
                    }
                } else {
                    doHouseKeeping(span);
                }
            }, randomNum2 * 1000);
        }
        await Config.db.ParseTimeseries(span);
        return true;
    } catch (error) {
        Logger.instanse.error(error, span);
        return false;
    } finally {
        Logger.otel.endSpan(span);
    }
}

process.on('beforeExit', (code) => {
    Logger.instanse.error(code as any, null);
});
process.on('exit', (code) => {
    Logger.instanse.error(code as any, null);
});
const unhandledRejections = new Map();
process.on('unhandledRejection', (reason, promise) => {
    Logger.instanse.error(reason as any, null);
    // ('Unhandled Rejection at: Promise', promise, 'reason:', reason);
    unhandledRejections.set(promise, reason);
});
process.on('rejectionHandled', (promise) => {
    unhandledRejections.delete(promise);
});
process.on('uncaughtException', (err, origin) => {
    Logger.instanse.error(err, null);
    // (`Caught exception: ${err}\n` +
    //     `Exception origin: ${origin}`
    // );
});
function onerror(err, origin) {
    Logger.instanse.error(err, null);
    // (`Caught exception Monitor: ${err}\n` +
    //     `Exception origin: ${origin}`
    // );
}
process.on('uncaughtExceptionMonitor', onerror);
function onWarning(warning) {
    try {
        Logger.instanse.warn(warning.name + ": " + warning.message, null);
    } catch (error) {
    }
}
process.on('warning', onWarning);
// The signals we want to handle
// NOTE: although it is tempting, the SIGKILL signal (9) cannot be intercepted and handled
var signals = {
    'SIGHUP': 1,
    'SIGINT': 2,
    'SIGTERM': 15
};
var housekeeping = null;
async function handle(signal, value) {
    Logger.instanse.info(`process received a ${signal} signal with value ${value}`, null);
    try {
        if(Config.heapdump_onstop) {
            await Logger.otel.createheapdump(null);
        }
        Config.db.shutdown();
        Logger.otel.shutdown();
        Logger.License.shutdown()
        // Auth.shutdown();
        if (housekeeping != null) {
            try {
                clearInterval(housekeeping);
            } catch (error) {
            }
        }
        setTimeout(() => {
            process.exit(128 + value);
        }, 1000);
        if(server != null && server.close) {
            server.close((err) => {
                Logger.instanse.info(`server stopped by ${signal} with value ${value}`, null);
                Logger.instanse.error(err, null);
                process.exit(128 + value);
            })
        }
    } catch (error) {
        Logger.instanse.error(error, null);
        Logger.instanse.info(`server stopped by ${signal} with value ${value}`, null);
        process.exit(128 + value);
    }
}
Object.keys(signals).forEach((signal) => process.on(signal, handle));

let GrafanaProxy: any = null;
try {
    GrafanaProxy = require("./ee/grafana-proxy");
} catch (error) {

}
let OpenAIProxy: any = null;
try {
    OpenAIProxy = require("./ee/OpenAIProxy");
} catch (error) {

}


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
        console.error(error);
        process.exit(404);
    }
    Config.db = new DatabaseConnection(Config.mongodb_url, Config.mongodb_db, true);
    const span: Span = Logger.otel.startSpan("openflow.startup", null, null);
    try {
        await Config.db.connect(span);
        await initamqp(span);
        Logger.instanse.info("VERSION: " + Config.version, span);
        server = await WebServer.configure(Config.baseurl(), span);
        if (GrafanaProxy != null) {
            const grafana = await GrafanaProxy.GrafanaProxy.configure(WebServer.app, span);
        }
        if (OpenAIProxy != null) {
            const OpenAI = await OpenAIProxy.OpenAIProxy.configure(WebServer.app, span);
        }
        OAuthProvider.configure(WebServer.app, span);
        WebSocketServer.configure(server, span);
        if (!await initDatabase(span)) {
            process.exit(404);
        }
        await QueueClient.configure(span);
        await ValidateUserForm(span);
        WebServer.Listen();
        if (Config.workitem_queue_monitoring_enabled) {
            Config.db.ensureQueueMonitoring();
        }
    } catch (error) {
        Logger.instanse.error(error, span);
        process.exit(404);
    } finally {
        Logger.otel.endSpan(span);
    }
})();
