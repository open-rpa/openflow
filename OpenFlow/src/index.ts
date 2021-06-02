import * as http from "http";
import { Logger } from "./Logger";
import { WebServer } from "./WebServer";
import { WebSocketServer } from "./WebSocketServer";
import { DatabaseConnection } from "./DatabaseConnection";
import { Crypt } from "./Crypt";
import { Config } from "./Config";
import { amqpwrapper, QueueMessageOptions } from "./amqpwrapper";
import { WellknownIds, Role, Rights, User, Base, NoderedUtil } from "@openiap/openflow-api";
import { DBHelper } from "./DBHelper";
import { OAuthProvider } from "./OAuthProvider";
import { Span } from "@opentelemetry/api";
import { QueueClient } from "./QueueClient";
import { Message } from "./Messages/Message";

Logger.configure();

let _lic_require: any = null;
try {
    _lic_require = require("./license-file");
} catch (error) {
}
if (_lic_require != null) {
    Logger.License = new _lic_require.LicenseFile();
} else {
    Logger.License = {} as any;
    Logger.License.ofid = function () {
        if (!NoderedUtil.IsNullEmpty(this._ofid)) return this._ofid;
        var crypto = require('crypto');
        const openflow_uniqueid = Config.openflow_uniqueid || crypto.createHash('md5').update(Config.domain).digest("hex");
        Config.openflow_uniqueid = openflow_uniqueid;
        this._ofid = openflow_uniqueid;
        return openflow_uniqueid;
    };
}
let _otel_require: any = null;
try {
    _otel_require = require("./otel");
} catch (error) {

}
if (_otel_require != null) {
    Logger.otel = _otel_require.otel.configure();
} else {
    const fakespan = {
        context: () => undefined,
        setAttribute: () => undefined,
        setAttributes: () => undefined,
        addEvent: () => undefined,
        setStatus: () => undefined,
        updateName: () => undefined,
        end: () => undefined,
        isRecording: () => undefined,
        recordException: () => undefined,
    };
    Logger.otel =
        {
            startSpan: () => fakespan,
            startSubSpan: () => fakespan,
            endSpan: () => undefined,
            startTimer: () => undefined,
            endTimer: () => undefined,
            setdefaultlabels: () => undefined,
            meter: {
                createValueRecorder: () => undefined,
                createCounter: () => undefined,
                createUpDownSumObserver: () => undefined,
            }
        } as any;
}
Config.db = new DatabaseConnection(Config.mongodb_url, Config.mongodb_db);



async function adddlx() {
    if (NoderedUtil.IsNullEmpty(Config.amqp_dlx)) return;
    await amqp.AddExchangeConsumer(Config.amqp_dlx, "fanout", "", null, null, async (msg: any, options: QueueMessageOptions, ack: any, done: any) => {
        if (typeof msg === "string" || msg instanceof String) {
            try {
                msg = JSON.parse((msg as any));
            } catch (error) {
            }
        }
        try {
            msg.command = "timeout";
            // Resend message, this time to the reply queue for the correct node (replyTo)
            // this.SendMessage(JSON.stringify(data), msg.properties.replyTo, msg.properties.correlationId, false);
            Logger.instanse.info("[DLX][" + options.exchange + "] Send timeout to " + options.replyTo + " correlationId: " + options.correlationId);
            await amqpwrapper.Instance().sendWithReply("", options.replyTo, msg, 20000, options.correlationId, "");
        } catch (error) {
            console.error("Failed sending deadletter message to " + options.replyTo);
            console.error(error);
        }
        ack();
        done();
    }, undefined);
}
let amqp: amqpwrapper = null;
async function initamqp() {
    amqp = new amqpwrapper(Config.amqp_url);
    amqpwrapper.SetInstance(amqp);
    amqp.on("connected", adddlx);
    await amqp.connect();

    // Must also consume messages in the dead letter queue, to catch messages that have timed out

    // await amqp.AddExchangeConsumer("testexchange", "fanout", "", null, (msg: any, options: QueueMessageOptions, ack: any, done: any) => {
    //     console.info("testexchange: " + msg);
    //     ack();
    //     done(msg + " hi from testexchange");
    // });
    // await amqp.AddQueueConsumer("testqueue", null, (msg: any, options: QueueMessageOptions, ack: any, done: any) => {
    //     console.info("testqueue: " + msg);
    //     ack();
    //     done(msg + " hi from testqueue.1");
    // });
    // await amqp.AddQueueConsumer("testqueue", null, (msg: any, options: QueueMessageOptions, ack: any, done: any) => {
    //     console.info("tempqueue: " + msg);
    //     ack();
    //     done(msg + " hi from testqueue.2");
    // });
    // doitagain();
}
// let flipper: boolean = false;
// async function doitagain() {
//     try {
//         flipper = !flipper;
//         if (flipper) {
//             console.info(await amqpwrapper.Instance().sendWithReply("", "testqueue", "Hi mom", 20000, ""));
//         } else {
//             // console.info(await amqpwrapper.Instance().sendWithReply("", "testqueue2", "Hi mom", 2000));
//             console.info(await amqpwrapper.Instance().sendWithReply("testexchange", "", "Hi mom", 20000, ""));
//         }
//     } catch (error) {
//         console.error(error);
//     }
//     setTimeout(() => {
//         doitagain()
//     }, 5000);
// }


async function initDatabase(): Promise<boolean> {
    const span: Span = Logger.otel.startSpan("initDatabase");
    try {
        const jwt: string = Crypt.rootToken();


        const admins: Role = await DBHelper.EnsureRole(jwt, "admins", WellknownIds.admins, span);
        const users: Role = await DBHelper.EnsureRole(jwt, "users", WellknownIds.users, span);
        const root: User = await DBHelper.ensureUser(jwt, "root", "root", WellknownIds.root, null, span);

        Base.addRight(root, WellknownIds.admins, "admins", [Rights.full_control]);
        Base.removeRight(root, WellknownIds.admins, [Rights.delete]);
        Base.addRight(root, WellknownIds.root, "root", [Rights.full_control]);
        Base.removeRight(root, WellknownIds.root, [Rights.delete]);
        await DBHelper.Save(root, jwt, span);

        const robot_agent_users: Role = await DBHelper.EnsureRole(jwt, "robot agent users", WellknownIds.robot_agent_users, span);
        Base.addRight(robot_agent_users, WellknownIds.admins, "admins", [Rights.full_control]);
        Base.removeRight(robot_agent_users, WellknownIds.admins, [Rights.delete]);
        Base.addRight(robot_agent_users, WellknownIds.root, "root", [Rights.full_control]);
        if (Config.multi_tenant) {
            Logger.instanse.debug("[root][users] Running in multi tenant mode, remove " + robot_agent_users.name + " from self");
            Base.removeRight(robot_agent_users, robot_agent_users._id, [Rights.full_control]);
        } else if (Config.update_acl_based_on_groups) {
            Base.removeRight(robot_agent_users, robot_agent_users._id, [Rights.full_control]);
            Base.addRight(robot_agent_users, robot_agent_users._id, "robot agent users", [Rights.read]);
        }
        await DBHelper.Save(robot_agent_users, jwt, span);

        Base.addRight(admins, WellknownIds.admins, "admins", [Rights.full_control]);
        Base.removeRight(admins, WellknownIds.admins, [Rights.delete]);
        await DBHelper.Save(admins, jwt, span);

        Base.addRight(users, WellknownIds.admins, "admins", [Rights.full_control]);
        Base.removeRight(users, WellknownIds.admins, [Rights.delete]);
        users.AddMember(root);
        if (Config.multi_tenant) {
            Base.removeRight(users, users._id, [Rights.full_control]);
        } else {
            Base.removeRight(users, users._id, [Rights.full_control]);
            Base.addRight(users, users._id, "users", [Rights.read]);
        }
        await DBHelper.Save(users, jwt, span);


        const personal_nodered_users: Role = await DBHelper.EnsureRole(jwt, "personal nodered users", WellknownIds.personal_nodered_users, span);
        personal_nodered_users.AddMember(admins);
        Base.addRight(personal_nodered_users, WellknownIds.admins, "admins", [Rights.full_control]);
        Base.removeRight(personal_nodered_users, WellknownIds.admins, [Rights.delete]);
        if (Config.multi_tenant) {
            Logger.instanse.debug("[root][users] Running in multi tenant mode, remove " + personal_nodered_users.name + " from self");
            Base.removeRight(personal_nodered_users, personal_nodered_users._id, [Rights.full_control]);
        } else if (Config.update_acl_based_on_groups) {
            Base.removeRight(personal_nodered_users, personal_nodered_users._id, [Rights.full_control]);
            Base.addRight(personal_nodered_users, personal_nodered_users._id, "personal nodered users", [Rights.read]);
        }
        await DBHelper.Save(personal_nodered_users, jwt, span);
        const nodered_admins: Role = await DBHelper.EnsureRole(jwt, "nodered admins", WellknownIds.nodered_admins, span);
        nodered_admins.AddMember(admins);
        Base.addRight(nodered_admins, WellknownIds.admins, "admins", [Rights.full_control]);
        Base.removeRight(nodered_admins, WellknownIds.admins, [Rights.delete]);
        await DBHelper.Save(nodered_admins, jwt, span);
        const nodered_users: Role = await DBHelper.EnsureRole(jwt, "nodered users", WellknownIds.nodered_users, span);
        nodered_users.AddMember(admins);
        Base.addRight(nodered_users, WellknownIds.admins, "admins", [Rights.full_control]);
        Base.removeRight(nodered_users, WellknownIds.admins, [Rights.delete]);
        if (Config.multi_tenant) {
            Logger.instanse.debug("[root][users] Running in multi tenant mode, remove " + nodered_users.name + " from self");
            Base.removeRight(nodered_users, nodered_users._id, [Rights.full_control]);
        } else if (Config.update_acl_based_on_groups) {
            Base.removeRight(nodered_users, nodered_users._id, [Rights.full_control]);
            Base.addRight(nodered_users, nodered_users._id, "nodered users", [Rights.read]);
        }
        await DBHelper.Save(nodered_users, jwt, span);
        const nodered_api_users: Role = await DBHelper.EnsureRole(jwt, "nodered api users", WellknownIds.nodered_api_users, span);
        nodered_api_users.AddMember(admins);
        Base.addRight(nodered_api_users, WellknownIds.admins, "admins", [Rights.full_control]);
        Base.removeRight(nodered_api_users, WellknownIds.admins, [Rights.delete]);
        if (Config.multi_tenant) {
            Logger.instanse.debug("[root][users] Running in multi tenant mode, remove " + nodered_api_users.name + " from self");
            Base.removeRight(nodered_api_users, nodered_api_users._id, [Rights.full_control]);
        } else if (Config.update_acl_based_on_groups) {
            Base.removeRight(nodered_api_users, nodered_api_users._id, [Rights.full_control]);
            Base.addRight(nodered_api_users, nodered_api_users._id, "nodered api users", [Rights.read]);
        }
        await DBHelper.Save(nodered_api_users, jwt, span);

        if (Config.multi_tenant) {
            try {
                const resellers: Role = await DBHelper.EnsureRole(jwt, "resellers", WellknownIds.resellers, span);
                Base.addRight(resellers, WellknownIds.admins, "admins", [Rights.full_control]);
                Base.removeRight(resellers, WellknownIds.admins, [Rights.delete]);
                Base.removeRight(resellers, WellknownIds.resellers, [Rights.full_control]);
                resellers.AddMember(admins);
                await DBHelper.Save(resellers, jwt, span);

                const customer_admins: Role = await DBHelper.EnsureRole(jwt, "customer admins", WellknownIds.customer_admins, span);
                Base.addRight(customer_admins, WellknownIds.admins, "admins", [Rights.full_control]);
                Base.removeRight(customer_admins, WellknownIds.admins, [Rights.delete]);
                Base.removeRight(customer_admins, WellknownIds.customer_admins, [Rights.full_control]);
                await DBHelper.Save(customer_admins, jwt, span);
            } catch (error) {
                console.error(error);
            }
        }


        const robot_admins: Role = await DBHelper.EnsureRole(jwt, "robot admins", WellknownIds.robot_admins, span);
        robot_admins.AddMember(admins);
        Base.addRight(robot_admins, WellknownIds.admins, "admins", [Rights.full_control]);
        Base.removeRight(robot_admins, WellknownIds.admins, [Rights.delete]);
        await DBHelper.Save(robot_admins, jwt, span);
        const robot_users: Role = await DBHelper.EnsureRole(jwt, "robot users", WellknownIds.robot_users, span);
        robot_users.AddMember(admins);
        robot_users.AddMember(users);
        Base.addRight(robot_users, WellknownIds.admins, "admins", [Rights.full_control]);
        Base.removeRight(robot_users, WellknownIds.admins, [Rights.delete]);
        if (Config.multi_tenant) {
            Logger.instanse.debug("[root][users] Running in multi tenant mode, remove " + robot_users.name + " from self");
            Base.removeRight(robot_users, robot_users._id, [Rights.full_control]);
        } else if (Config.update_acl_based_on_groups) {
            Base.removeRight(robot_users, robot_users._id, [Rights.full_control]);
            Base.addRight(robot_users, robot_users._id, "robot users", [Rights.read]);
        }
        await DBHelper.Save(robot_users, jwt, span);

        if (!admins.IsMember(root._id)) {
            admins.AddMember(root);
            await DBHelper.Save(admins, jwt, span);
        }

        const filestore_admins: Role = await DBHelper.EnsureRole(jwt, "filestore admins", WellknownIds.filestore_admins, span);
        filestore_admins.AddMember(admins);
        Base.addRight(filestore_admins, WellknownIds.admins, "admins", [Rights.full_control]);
        Base.removeRight(filestore_admins, WellknownIds.admins, [Rights.delete]);
        if (Config.multi_tenant) {
            Logger.instanse.debug("[root][users] Running in multi tenant mode, remove " + filestore_admins.name + " from self");
            Base.removeRight(filestore_admins, filestore_admins._id, [Rights.full_control]);
        }
        await DBHelper.Save(filestore_admins, jwt, span);
        const filestore_users: Role = await DBHelper.EnsureRole(jwt, "filestore users", WellknownIds.filestore_users, span);
        filestore_users.AddMember(admins);
        if (!Config.multi_tenant) {
            filestore_users.AddMember(users);
        }
        Base.addRight(filestore_users, WellknownIds.admins, "admins", [Rights.full_control]);
        Base.removeRight(filestore_users, WellknownIds.admins, [Rights.delete]);
        if (Config.multi_tenant) {
            Logger.instanse.debug("[root][users] Running in multi tenant mode, remove " + filestore_users.name + " from self");
            Base.removeRight(filestore_users, filestore_users._id, [Rights.full_control]);
        } else if (Config.update_acl_based_on_groups) {
            Base.removeRight(filestore_users, filestore_users._id, [Rights.full_control]);
            Base.addRight(filestore_users, filestore_users._id, "filestore users", [Rights.read]);
        }
        await DBHelper.Save(filestore_users, jwt, span);

        await Config.db.ensureindexes(span);
        Logger.otel.endSpan(span);

        if (Config.auto_hourly_housekeeping) {
            housekeeping = setInterval(async () => {
                try {
                    var dt = new Date(new Date().toISOString());
                    var msg = new Message(); msg.jwt = Crypt.rootToken();
                    var updateUsage: boolean = !(dt.getHours() == 1 || dt.getHours() == 13);
                    await msg.Housekeeping(false, updateUsage, updateUsage, null);
                } catch (error) {
                }
            }, 3600000);
            setTimeout(async () => {
                var dt = new Date(new Date().toISOString());
                var msg = new Message(); msg.jwt = Crypt.rootToken();
                var updateUsage: boolean = !(dt.getHours() == 1 || dt.getHours() == 13);
                updateUsage = false;
                await msg.Housekeeping(false, updateUsage, updateUsage, null);
            }, 5000);
        }
        return true;
    } catch (error) {
        span.recordException(error);
        Logger.otel.endSpan(span);
        Logger.instanse.error(error);
        return false;
    }
}


process.on('beforeExit', (code) => {
    console.error('Process beforeExit event with code: ', code);
});
process.on('exit', (code) => {
    console.error('Process exit event with code: ', code);
});
process.on('multipleResolves', (type, promise, reason) => {
    // console.error(type, promise, reason);
    // setImmediate(() => process.exit(1));
});
const unhandledRejections = new Map();
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at: Promise', promise, 'reason:', reason);
    unhandledRejections.set(promise, reason);
});
process.on('rejectionHandled', (promise) => {
    unhandledRejections.delete(promise);
});
process.on('uncaughtException', (err, origin) => {
    console.error(`Caught exception: ${err}\n` +
        `Exception origin: ${origin}`
    );
});
process.on('uncaughtExceptionMonitor', (err, origin) => {
    console.error(`Caught exception Monitor: ${err}\n` +
        `Exception origin: ${origin}`
    );
});
process.on('warning', (warning) => {
    try {
        console.warn(warning.name + ": " + warning.message);
        console.warn(warning.stack);
    } catch (error) {
    }
});
// The signals we want to handle
// NOTE: although it is tempting, the SIGKILL signal (9) cannot be intercepted and handled
var signals = {
    'SIGHUP': 1,
    'SIGINT': 2,
    'SIGTERM': 15
};
var housekeeping = null;
function handle(signal, value) {
    console.trace(`process received a ${signal} signal with value ${value}`);
    try {
        if (housekeeping != null) {
            try {
                clearInterval(housekeeping);
            } catch (error) {
            }
        }
        setTimeout(() => {
            process.exit(128 + value);
        }, 1000);
        server.close((err) => {
            console.log(`server stopped by ${signal} with value ${value}`);
            console.error(err);
            process.exit(128 + value);
        })
    } catch (error) {
        console.error(error);
        console.log(`server stopped by ${signal} with value ${value}`);
        process.exit(128 + value);
    }
}
Object.keys(signals).forEach((signal) => process.on(signal, handle));

// process.on('SIGTERM', handle);
// process.on('SIGINT', handle);
// process.on('SIGUSR1', handle);
// process.on('SIGPIPE', handle);
// process.on('SIGHUP', handle);
// process.on('SIGBREAK', handle);
// process.on('SIGKILL', handle);
// process.on('SIGWINCH', handle);
// process.on('SIGSTOP', handle);
// process.on('SIGBUS', handle);
// process.on('SIGFPE', handle);
// process.on('SIGSEGV', handle);
// process.on('SIGILL', handle);


let GrafanaProxy: any = null;
try {
    GrafanaProxy = require("./grafana-proxy");
} catch (error) {

}
let Prometheus: any = null;
try {
    Prometheus = require("./Prometheus");
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

// write(buffer: Buffer | Uint8Array | string, cb?: (err?: Error | null) => void): boolean;
// write(str: string, encoding?: string, cb?: (err?: Error | null) => void): boolean;

// https://medium.com/kubernetes-tutorials/monitoring-your-kubernetes-deployments-with-prometheus-5665eda54045
var server: http.Server = null;
(async function (): Promise<void> {
    try {
        await initamqp();
        Logger.instanse.info("VERSION: " + Config.version);
        server = await WebServer.configure(Config.baseurl());
        if (GrafanaProxy != null) {
            const grafana = await GrafanaProxy.GrafanaProxy.configure(WebServer.app);
        }
        OAuthProvider.configure(WebServer.app);
        WebSocketServer.configure(server);
        await QueueClient.configure();
        Logger.instanse.info("listening on " + Config.baseurl());
        Logger.instanse.info("namespace: " + Config.namespace);
        if (!await initDatabase()) {
            process.exit(404);
        }
    } catch (error) {
        Logger.instanse.error(error);
        process.exit(404);
    }
})();
