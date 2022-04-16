import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import { WebSocketClient, NoderedUtil, TokenUser } from "@openiap/openflow-api";
import { Logger } from "./Logger";
import { WebServer } from "./WebServer";
import { Config } from "./Config";
import { Crypt } from "./nodeclient/Crypt";
import { FileSystemCache } from "@openiap/openflow-api";
Logger.configure();
Logger.instanse.info("starting openflow nodered");

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
    // console.error(`Caught exception: ${err}\n` +
    //     `Exception origin: ${origin}`
    // );
});
process.on('uncaughtExceptionMonitor', (err: Error, origin) => {
    if (err.message && err.stack) {
        console.error(`Caught exception: ${err.message}\n` +
            `Exception origin: ${origin}\n` + err.stack
        );
    } else {
        console.error(`Caught exception: ${err}\n` +
            `Exception origin: ${origin}`
        );

    }
});
process.on('warning', (warning) => {
    console.warn(warning.name);    // Print the warning name
    console.warn(warning.message); // Print the warning message
    console.warn(warning.stack);   // Print the stack trace
});

// The signals we want to handle
// NOTE: although it is tempting, the SIGKILL signal (9) cannot be intercepted and handled
var signals = {
    'SIGHUP': 1,
    'SIGINT': 2,
    'SIGTERM': 15
};
function handle(signal, value) {
    console.trace(`process received a ${signal} signal with value ${value}`);
    try {
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


let server: http.Server = null;
(async function (): Promise<void> {
    try {
        const backupStore = new FileSystemCache(path.join(Config.logpath, '.cache-' + Config.nodered_id));
        const flow_filename: string = Config.nodered_id + "_flows.json";
        const nodereduser_filename: string = Config.nodered_id + "_user.json";
        const flowjson = await backupStore.get<string>(flow_filename, null);
        const userjson = await backupStore.get<string>(nodereduser_filename, null);
        const socket: WebSocketClient = new WebSocketClient(Logger.instanse, Config.api_ws_url);
        if (!NoderedUtil.IsNullEmpty(flowjson) && Config.allow_start_from_cache) {
            server = await WebServer.configure(socket);
            const baseurl = (!NoderedUtil.IsNullEmpty(Config.saml_baseurl) ? Config.saml_baseurl : Config.baseurl());
            Logger.instanse.info("listening on " + baseurl);
            if (!NoderedUtil.IsNullUndefinded(userjson)) {
                const nodered = JSON.parse(userjson);
                if (!NoderedUtil.IsNullEmpty(nodered.function_external_modules)) { Config.function_external_modules = nodered.function_external_modules; }
                if (!NoderedUtil.IsNullEmpty(nodered.api_allow_anonymous)) { Config.api_allow_anonymous = nodered.api_allow_anonymous; }
                if (!NoderedUtil.IsNullEmpty(nodered.codeeditor_lib)) { Config.codeeditor_lib = nodered.codeeditor_lib; }
                if (!NoderedUtil.IsNullEmpty(nodered.monaco) && Config.parseBoolean(nodered.monaco)) { Config.codeeditor_lib = "monaco"; }
                if (!NoderedUtil.IsNullEmpty(nodered.tours)) { Config.tours = nodered.tours; }
                if (!NoderedUtil.IsNullUndefinded(nodered.catalogues)) {
                    if (Array.isArray(nodered.catalogues)) {
                        Config.noderedcatalogues = nodered.catalogues;
                    } else if (!NoderedUtil.IsNullEmpty(nodered.catalogues)) {
                        if (nodered.catalogues.indexOf(";") > -1) {
                            Config.noderedcatalogues = nodered.catalogues.split(";");
                        } else {
                            Config.noderedcatalogues = nodered.catalogues.split(",");
                        }
                    }

                }
            }
        }
        socket.setCacheFolder(Config.logpath);
        socket.agent = "nodered";
        socket.version = Config.version;
        Logger.instanse.info("VERSION: " + Config.version);
        socket.update_message_queue_count = WebServer.update_message_queue_count;
        socket.max_message_queue_time_seconds = Config.max_message_queue_time_seconds;
        socket.events.on("onerror", async () => {
        });
        socket.events.on("onclose", async () => {
        });
        socket.events.on("onopen", async () => {
            try {
                let jwt: string = "";
                if (Config.jwt !== "") {
                    jwt = Config.jwt;
                } else if (Crypt.encryption_key() !== "") {
                    const user = new TokenUser();
                    if (NoderedUtil.IsNullEmpty(Config.nodered_sa)) {
                        user.name = "nodered" + Config.nodered_id;
                    } else {
                        user.name = Config.nodered_sa;
                    }
                    user.username = user.name;
                    jwt = Crypt.createToken(user);
                } else {
                    throw new Error("missing encryption_key and jwt, signin not possible!");
                }
                const result = await NoderedUtil.SigninWithToken({ jwt });
                Logger.instanse.info("signed in as " + result.user.name + " with id " + result.user._id);
                WebSocketClient.instance.user = result.user;
                WebSocketClient.instance.jwt = result.jwt;
                if (!NoderedUtil.IsNullEmpty(result.openflow_uniqueid)) {
                    Config.openflow_uniqueid = result.openflow_uniqueid;
                    Logger.otel.setdefaultlabels();
                }
                if (!NoderedUtil.IsNullEmpty(result.otel_trace_url)) Config.otel_trace_url = result.otel_trace_url;
                if (!NoderedUtil.IsNullEmpty(result.otel_metric_url)) Config.otel_metric_url = result.otel_metric_url;
                if (result.otel_trace_interval > 0) Config.otel_trace_interval = result.otel_trace_interval;
                if (result.otel_metric_interval > 0) Config.otel_metric_interval = result.otel_metric_interval;
                if (!NoderedUtil.IsNullEmpty(result.openflow_uniqueid) || !NoderedUtil.IsNullEmpty(result.otel_metric_url)) {
                    if (!NoderedUtil.IsNullUndefinded(_otel_require)) {
                        Config.enable_analytics = result.enable_analytics;
                        Logger.instanse.info("reconfigure otel");
                        Logger.otel = _otel_require.otel.configure();
                    }
                }
                if (server == null) {

                    const user = await NoderedUtil.Query({ collectionname: "users", query: { _id: result.user._id }, projection: { "nodered": 1 }, top: 1, jwt: result.jwt });
                    if (user.length > 0) {
                        const nodered = user[0].nodered;
                        if (!NoderedUtil.IsNullUndefinded(nodered)) {
                            if (!NoderedUtil.IsNullEmpty(nodered.function_external_modules)) { Config.function_external_modules = nodered.function_external_modules; }
                            if (!NoderedUtil.IsNullEmpty(nodered.api_allow_anonymous)) { Config.api_allow_anonymous = nodered.api_allow_anonymous; }
                            if (!NoderedUtil.IsNullEmpty(nodered.codeeditor_lib)) { Config.codeeditor_lib = nodered.codeeditor_lib; }
                            if (!NoderedUtil.IsNullEmpty(nodered.monaco) && Config.parseBoolean(nodered.monaco)) { Config.codeeditor_lib = "monaco"; }
                            if (!NoderedUtil.IsNullEmpty(nodered.tours)) { Config.tours = nodered.tours; }
                            await backupStore.set(nodereduser_filename, JSON.stringify(nodered));
                        } else {
                            await backupStore.remove(nodereduser_filename);
                        }
                    }
                    server = await WebServer.configure(socket);
                    const baseurl = (!NoderedUtil.IsNullEmpty(Config.saml_baseurl) ? Config.saml_baseurl : Config.baseurl());
                    Logger.instanse.info("listening on " + baseurl);
                }
                socket.events.emit("onsignedin", result.user);
            } catch (error) {
                let closemsg: any = (error.message ? error.message : error);
                Logger.instanse.error(closemsg);
                socket.close(1000, closemsg);
                socket.connect().catch(reason => {
                    Logger.instanse.error(reason);
                    process.exit(404);
                })
            }
        });
    } catch (error) {
        Logger.instanse.error(error.message ? error.message : error);
    }
})();

