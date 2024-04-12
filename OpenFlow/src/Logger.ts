import os from "os";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { NoderedUtil } from "@openiap/openflow-api";
import { i_license_file, i_agent_driver, i_otel } from "./commoninterfaces.js";
import { Config } from "./Config.js";
import { dockerdriver } from "./dockerdriver.js";
import { DBHelper } from './DBHelper.js';
import { amqpwrapper } from "./amqpwrapper.js";
import { WebSocketServerClient } from "./WebSocketServerClient.js";
import { Span } from "@opentelemetry/api";
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MAX_RETRIES_DEFAULT = 5
export async function promiseRetry<T>(
    fn: () => Promise<T>,
    retries = MAX_RETRIES_DEFAULT,
    retryIntervalMillis: number,
    previousError?: Error
): Promise<T> {
    return !retries
        ? Promise.reject(previousError)
        : fn().catch(async (error) => {
            await new Promise((resolve) => setTimeout(resolve, retryIntervalMillis))
            return promiseRetry(fn, retries - 1, retryIntervalMillis, error)
        })
}
export enum level {
    Error = 1,
    Warning = 2,
    Information = 3,
    Debug = 4,
    Verbose = 5,
    Silly = 6
}

export class Logger {

    public static otel: i_otel;
    public static License: i_license_file;
    public static agentdriver: i_agent_driver;
    public static DBHelper: DBHelper;
    public static log_with_trace: boolean = false;
    public static enabled: any = {}
    public static usecolors: boolean = true;
    private static _hostname: string = "";

    public static parsecli(cli: WebSocketServerClient) {
        if (NoderedUtil.IsNullUndefinded(cli)) return {};
        return { user: cli.username, agent: cli.clientagent, version: cli.clientversion, cid: cli.id, ip: cli.remoteip }
    }
    public prefix(lvl: level, cls: string, func: string, message: string | unknown, collection: string, user: string, ms: number): string {
        let White = Console.Reset + Console.Bright + Console.FgWhite;
        let Grey = Console.Reset + Console.Dim + Console.FgWhite;
        let Red = Console.Reset + Console.Bright + Console.FgRed;
        let Yellow = Console.Reset + Console.Bright + Console.FgYellow;
        let darkYellow = Console.Reset + Console.Dim + Console.FgYellow;
        let Blue = Console.Reset + Console.Bright + Console.FgBlue;
        let Cyan = Console.Reset + Console.Bright + Console.FgCyan;
        let Green = Console.Reset + Console.Bright + Console.FgGreen;
        let dt = new Date();
        if (cls == "cli" || cls == "cli-lic" || cls == "cliutil") cls = "";
        if (NoderedUtil.IsNullEmpty(cls)) cls = "";
        if (typeof cls !== 'string') { try { cls = (cls as object).toString(); } catch { cls = "unknown"; } }
        let prefix = "";
        let color = Cyan;
        if (lvl == level.Debug) color = Blue;
        if (lvl == level.Verbose || lvl == level.Silly) color = Grey;
        if (lvl == level.Error) color = Red;
        if (lvl == level.Warning) color = darkYellow;
        if (cls != "") {
            let dts: string = dt.getHours() + ":" + dt.getMinutes() + ":" + dt.getSeconds() + "." + dt.getMilliseconds();
            if (Logger.usecolors) {
                prefix = (dts.padEnd(13, " ") + "[" + cls.padEnd(21) + "][" + func + "]");
                if (!NoderedUtil.IsNullEmpty(collection)) prefix += ("[" + collection + "]");
                if (!NoderedUtil.IsNullEmpty(user)) prefix += ("[" + user + "]");
                if (!NoderedUtil.IsNullEmpty(ms)) prefix += ("[" + ms + "ms]");
                prefix += (" ");
                let spaces = 0;
                if (prefix.length < 60) spaces = 60 - prefix.length;
                prefix = Green +
                    dts.padEnd(13, " ") + White + "[" + darkYellow + cls.padEnd(21) + White + "][" + darkYellow + func + White + "] ";
                if (spaces > 0) prefix += "".padEnd(spaces, " ");
            } else {
                prefix = dts.padEnd(13, " ") + "[" + cls.padEnd(21) + "][" + func + "]";
                if (!NoderedUtil.IsNullEmpty(collection)) prefix += ("[" + collection + "]");
                if (!NoderedUtil.IsNullEmpty(user)) prefix += ("[" + user + "]");
                if (!NoderedUtil.IsNullEmpty(ms)) prefix += ("[" + ms + "ms]");
                prefix += (" ");
                prefix = prefix.padEnd(60, " ");
            }
        }
        if (Logger.usecolors) {
            return prefix + color + message + Console.Reset;
        }
        return prefix + message;
    }
    public json(obj, span: Span) {
        if (Config.unittesting) return;
        if(obj.func == "_Housekeeping") {
            obj.cls = "Housekeeping";
        }

        const { cls, func, message, lvl } = obj;
        if (!NoderedUtil.IsNullEmpty(func) && span != null && span.isRecording()) {
            var stringifyError = function (err, filter, space) {
                var plainObject = {};
                Object.getOwnPropertyNames(err).forEach(function (key) {
                    plainObject[key] = err[key];
                });
                return JSON.stringify(plainObject, filter, space);
            };
            if (typeof obj.message == "object") obj.message = JSON.parse(stringifyError(obj.message, null, 2));
            if (lvl == level.Error) {
                span.setStatus({ code: 2, message: obj.message });
                span.recordException(message)
            }
            span.addEvent(obj.message, obj)
        }
        if(Config.log_all_watches && obj.cls == "DatabaseConnection" && obj.func == "onchange") {

        } else if(Config.log_database_queries && obj.requestId != null) {
        } else if (obj.ms != null && obj.ms != "" && obj.func != "query" && Config.log_database_queries) {
            if (obj.ms < Config.log_database_queries_ms) return;
        } else if (Logger.enabled[cls]) {
            if (Logger.enabled[cls] < lvl) return;
        } else {
            if (Config.log_silly) {
                if (lvl > level.Silly) return;
            }
            else if (Config.log_debug) {
                if (lvl > level.Debug) return;
            }
            else if (Config.log_verbose) {
                if (lvl > level.Verbose) return;
            } else if (lvl > level.Information) {
                return;
            }
        }
        if (message instanceof Error) {
            console.error(message);
        } else if (lvl == level.Error) {
            console.error(this.prefix(lvl, cls, func, message, obj.collection, obj.user, obj.ms));
        } else if (lvl == level.Warning) {
            console.warn(this.prefix(lvl, cls, func, message, obj.collection, obj.user, obj.ms));
        } else if (lvl == level.Verbose || lvl == level.Silly) {
            console.debug(this.prefix(lvl, cls, func, message, obj.collection, obj.user, obj.ms));
        } else {
            console.log(this.prefix(lvl, cls, func, message, obj.collection, obj.user, obj.ms));
        }
        var stringifyError = function (err, filter, space) {
            var plainObject = {};
            Object.getOwnPropertyNames(err).forEach(function (key) {
                plainObject[key] = err[key];
            });
            return JSON.stringify(plainObject, filter, space);
        };
        if (Config.log_to_exchange && !Config.unittesting) {
            if (NoderedUtil.IsNullEmpty(Logger._hostname)) Logger._hostname = (process.env.HOSTNAME || os.hostname()) || "unknown";
            if (amqpwrapper.Instance() && amqpwrapper.Instance().connected && amqpwrapper.Instance().of_logger_ready) {
                if (typeof obj.message == "object") obj.message = JSON.parse(stringifyError(obj.message, null, 2));
                amqpwrapper.Instance().send("openflow_logs", "", { ...obj, host: Logger._hostname }, 500, null, "", span, 1);
            }
        }
    }
    public error(message: string | Error | unknown, span: Span, options?: any) {
        var s = Logger.getStackInfo(0);
        if (s.method == "") s = Logger.getStackInfo(1);
        if (s.method == "") s = Logger.getStackInfo(2);
        var obj = { cls: "", func: "", message, lvl: level.Error };
        if (options != null) obj = { ...obj, ...options };
        if (s.method.indexOf(".") > 1 && s.method.indexOf("<anonymous>") == -1) {
            obj.func = s.method.substring(s.method.indexOf(".") + 1);
            obj.cls = s.method.substring(0, s.method.indexOf("."));
        } else {
            obj.func = s.method;
            obj.cls = "";
            if (s.file != '') obj.cls = s.file.replace(".js", "");
        }
        if(obj.func.indexOf("anonymous") > -1 || obj.func.indexOf("<") > -1 || obj.func.indexOf("[") > -1) {
            obj.func = "anonymous";
        }
        if(options?.cls != null && options?.cls != "") {
            obj.cls = options.cls;
        }
        if(options?.func != null && options?.func != "") {
            obj.func = options.func;
        }
        this.json(obj, span);
    }
    public info(message: string, span: Span, options?: any) {
        var s = Logger.getStackInfo(0);
        if (s.method == "") s = Logger.getStackInfo(1);
        if (s.method == "") s = Logger.getStackInfo(2);
        var obj = { cls: "", func: "", message, lvl: level.Information };
        if (options != null) obj = { ...obj, ...options };
        if (s.method.indexOf(".") > 1) {
            obj.func = s.method.substring(s.method.indexOf(".") + 1);
            obj.cls = s.method.substring(0, s.method.indexOf("."));
            if (s.file != '') obj.cls = s.file.replace(".js", "");
        } else {
            obj.func = s.method;
            obj.cls = "";
            if (s.file != '') obj.cls = s.file.replace(".js", "");
        }
        if(obj.func.indexOf("anonymous") > -1 || obj.func.indexOf("<") > -1 || obj.func.indexOf("[") > -1) {
            obj.func = "anonymous";
        }
        if(options?.cls != null && options?.cls != "") {
            obj.cls = options.cls;
        }
        if(options?.func != null && options?.func != "") {
            obj.func = options.func;
        }
        this.json(obj, span);
    }
    public warn(message: string, span: Span, options?: any) {
        var s = Logger.getStackInfo(0);
        if (s.method == "") s = Logger.getStackInfo(1);
        if (s.method == "") s = Logger.getStackInfo(2);
        var obj = { cls: "", func: "", message, lvl: level.Warning };
        if (options != null) obj = { ...obj, ...options };
        if (s.method.indexOf(".") > 1) {
            obj.func = s.method.substring(s.method.indexOf(".") + 1);
            obj.cls = s.method.substring(0, s.method.indexOf("."));
        } else {
            obj.func = s.method;
            obj.cls = "";
            if (s.file != '') obj.cls = s.file.replace(".js", "");
        }
        if(obj.func.indexOf("anonymous") > -1 || obj.func.indexOf("<") > -1 || obj.func.indexOf("[") > -1) {
            obj.func = "anonymous";
        }
        if(options?.cls != null && options?.cls != "") {
            obj.cls = options.cls;
        }
        if(options?.func != null && options?.func != "") {
            obj.func = options.func;
        }
        this.json(obj, span);
    }
    public debug(message: string, span: Span, options?: any) {
        var s = Logger.getStackInfo(0);
        if (s.method == "") s = Logger.getStackInfo(1);
        if (s.method == "") s = Logger.getStackInfo(2);
        var obj = { cls: "", func: "", message, lvl: level.Debug };
        if (options != null) obj = { ...obj, ...options };
        if (s.method.indexOf(".") > 1) {
            obj.func = s.method.substring(s.method.indexOf(".") + 1);
            obj.cls = s.method.substring(0, s.method.indexOf("."));
        } else {
            obj.func = s.method;
            obj.cls = "";
            if (s.file != '') obj.cls = s.file.replace(".js", "");
        }
        if(obj.func.indexOf("anonymous") > -1 || obj.func.indexOf("<") > -1 || obj.func.indexOf("[") > -1) {
            obj.func = "anonymous";
        }
        if(options?.cls != null && options?.cls != "") {
            obj.cls = options.cls;
        }
        if(options?.func != null && options?.func != "") {
            obj.func = options.func;
        }
        this.json(obj, span);
    }
    public verbose(message: string, span: Span, options?: any) {
        if(!Config.log_verbose) return;
        var s = Logger.getStackInfo(0);
        if (s.method == "") s = Logger.getStackInfo(1);
        if (s.method == "") s = Logger.getStackInfo(2);
        var obj = { cls: "", func: "", message, lvl: level.Verbose };
        if (options != null) obj = { ...obj, ...options };
        if (s.method.indexOf(".") > 1) {
            obj.func = s.method.substring(s.method.indexOf(".") + 1);
            obj.cls = s.method.substring(0, s.method.indexOf("."));
        } else {
            obj.func = s.method;
            obj.cls = "";
            if (s.file != '') obj.cls = s.file.replace(".js", "");
        }
        if(obj.func.indexOf("anonymous") > -1 || obj.func.indexOf("<") > -1 || obj.func.indexOf("[") > -1) {
            obj.func = "anonymous";
        }
        if(options?.cls != null && options?.cls != "") {
            obj.cls = options.cls;
        }
        if(options?.func != null && options?.func != "") {
            obj.func = options.func;
        }
        this.json(obj, span);
    }
    public silly(message: string, span: Span, options?: any) {
        if(!Config.log_silly) return;
        var s = Logger.getStackInfo(0);
        if (s.method == "") s = Logger.getStackInfo(1);
        if (s.method == "") s = Logger.getStackInfo(2);
        var obj = { cls: "", func: "", message, lvl: level.Silly };
        if (options != null) obj = { ...obj, ...options };
        if (s.method.indexOf(".") > 1) {
            obj.func = s.method.substring(s.method.indexOf(".") + 1);
            obj.cls = s.method.substring(0, s.method.indexOf("."));
        } else {
            obj.func = s.method;
            obj.cls = "";
            if (s.file != '') obj.cls = s.file.replace(".js", "");
        }
        if(obj.func.indexOf("anonymous") > -1 || obj.func.indexOf("<") > -1 || obj.func.indexOf("[") > -1) {
            obj.func = "anonymous";
        }
        if(options?.cls != null && options?.cls != "") {
            obj.cls = options.cls;
        }
        if(options?.func != null && options?.func != "") {
            obj.func = options.func;
        }
        this.json(obj, span);
    }

    public static async shutdown() {
        Logger.License.shutdown();
        if (Config.db != null) await Config.db.shutdown();
        await Logger.otel.shutdown();
    }
    public static async reload() {
        Logger.log_with_trace = Config.log_with_trace;
        Logger.usecolors = Config.log_with_colors;
        // if (Config.NODE_ENV == "development") Logger.log_with_trace = true;
        Logger.enabled = {};
        if (Config.log_cache) Logger.enabled["DBHelper"] = level.Verbose;
        if (Config.log_amqp) Logger.enabled["amqpwrapper"] = level.Verbose;
        if (Config.log_openapi) Logger.enabled["OpenAIProxy"] = level.Verbose;
        if (Config.log_openapi) Logger.enabled["OpenAPIProxy"] = level.Verbose;
        
        if (Config.log_login_provider) Logger.enabled["LoginProvider"] = level.Verbose;
        if (Config.log_websocket) Logger.enabled["WebSocketServer"] = level.Verbose;
        if (Config.log_websocket) Logger.enabled["WebSocketServerClient"] = level.Verbose;
        if (Config.log_oauth) Logger.enabled["OAuthProvider"] = level.Verbose;
        if (Config.log_webserver) Logger.enabled["WebServer"] = level.Verbose;
        if (Config.log_database) Logger.enabled["DatabaseConnection"] = level.Verbose;
        if (Config.log_grafana) Logger.enabled["grafana-proxy"] = level.Verbose;
        if (Config.log_git) Logger.enabled["GitProxy"] = level.Verbose;
        if (Config.log_housekeeping) Logger.enabled["Housekeeping"] = level.Verbose;
        if (Config.log_otel) Logger.enabled["otel"] = level.Verbose;
        if (Config.otel_debug_log) Logger.enabled["WebSocketServerClient"] = level.Verbose;
        if (Config.otel_warn_log) Logger.enabled["WebSocketServerClient"] = level.Warning;
        if (Config.otel_err_log) Logger.enabled["WebSocketServerClient"] = level.Error;
        if (Config.log_database_queries) Logger.enabled["log_database_queries"] = level.Verbose;

        try {
            await Logger.License?.validate();
        } catch (error) {
            
        }
    }
    static hasDockerEnv(): boolean {
        try {
            fs.statSync('/.dockerenv');
            return true;
        } catch (_) {
            return false;
        }
    }
    static hasDockerCGroup() {
        try {
            if (fs.readFileSync('/proc/self/cgroup', 'utf8').includes('docker')) return true;
            return fs.readFileSync('/proc/self/cgroup', 'utf8').includes('/kubepods');
        } catch (_) {
            return false;
        }
    }
    private static _isDocker: boolean = null;
    public static isDocker(): boolean {
        if (Logger._isDocker != null) return Logger._isDocker;
        Logger._isDocker = Logger.hasDockerEnv() || Logger.hasDockerCGroup();
        return false;
    }
    private static _isKubernetes: boolean = null;
    public static isKubernetes(): boolean {
        if (Logger._isKubernetes != null) return Logger._isKubernetes;
        if (!Logger.isDocker()) { Logger._isKubernetes = false; return false; }
        if (NoderedUtil.IsNullEmpty(process.env["KUBERNETES_SERVICE_HOST"])) { Logger._isKubernetes = false; return false; }
        Logger._isKubernetes = true;
        return true;
    }
    static async relaodotel() {
        
    }
    static _otel_require: any = null;
    static async configure(skipotel: boolean, skiplic: boolean): Promise<void> {
        Logger.DBHelper = new DBHelper();
        await Logger.reload()
        if(Logger.instanse == null) Logger.instanse = new Logger();
        if(Logger.License == null) {
            let _lic_require: any = null;
            try {
                // @ts-ignore
                if (!skiplic && _lic_require == null) _lic_require = await import("./ee/license-file.js");
                Logger.License = new _lic_require.LicenseFile();
            } catch (error) {
                console.error(error.message);
            }
            if (_lic_require != null) {
                Logger.License = new _lic_require.LicenseFile();
            } else {
                Logger.License = {} as any;
                Logger.License.ofid = Logger.ofid;
                Logger.License.shutdown = () => undefined;
            }
        }

        if(Logger.otel == null) {
            try {
                if (!skipotel && Logger._otel_require == null) Logger._otel_require = await import("./ee/otel.js");
            } catch (error) {
                console.error(error.message);
            }
            if (Logger._otel_require != null) {
                Logger.otel = await Logger._otel_require.otel.configure();
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
                        startSpanExpress: () => fakespan,
                        GetTraceSpanId(span: Span): [string, string] { return ["", ""]; },
                        endSpan: () => undefined,
                        startTimer: () => undefined,
                        endTimer: () => undefined,
                        setdefaultlabels: () => undefined,
                        shutdown: () => undefined,
                        meter: {
                            createHistogram: () => undefined,
                            createCounter: () => undefined,
                            createObservableUpDownCounter: () => undefined,
                            createUpDownCounter: () => undefined,
                            createValueObserver: () => undefined,
                            createObservableGauge: () => undefined,
                        }
                    } as any;
            }
        } else {
            if (Logger._otel_require != null) {
                Logger.otel = await Logger._otel_require.otel.configure();
            }
        }


        if(this.agentdriver == null) {
            this.agentdriver = null; // with npm -omit=optional we need to install npm i openid-client

            if (NoderedUtil.IsNullEmpty(process.env["USE_KUBERNETES"])) {
                try {
                    this.agentdriver = new dockerdriver();
                    if (!(await this.agentdriver.detect())) {
                        this.agentdriver = null;
                    }
                } catch (error) {
                    this.agentdriver = null;
                }
            }
            if (this.agentdriver == null && (!NoderedUtil.IsNullEmpty(process.env["KUBERNETES_SERVICE_HOST"]) || !NoderedUtil.IsNullEmpty(process.env["USE_KUBERNETES"]))) {
                try {
                    let _driver: any = await import("./ee/kubedriver.js");
                    this.agentdriver = new _driver.kubedriver();
                } catch (error) {
                    console.error(error.message);
                }
            }
            if (this.agentdriver == null) {
                try {
                    this.agentdriver = new dockerdriver();
                    if (!(await this.agentdriver.detect())) {
                        this.agentdriver = null;
                    }
                } catch (error) {
                    this.agentdriver = null;
                    Logger.instanse.error(error, null);
                }
            }
        }
    }
    static instanse: Logger = null;
    private static _ofid = null;
    static ofid() {
        if (!NoderedUtil.IsNullEmpty(Logger._ofid)) return Logger._ofid;
        const openflow_uniqueid = Config.openflow_uniqueid || crypto.createHash('md5').update(Config.domain).digest("hex");
        Config.openflow_uniqueid = openflow_uniqueid;
        Logger._ofid = openflow_uniqueid;
        return openflow_uniqueid;
    }
    static getStackInfo(stackIndex) {
        // get call stack, and analyze it
        // get all file, method, and line numbers
        var stacklist = (new Error()).stack.split('\n').slice(3)

        // stack trace format:
        // http://code.google.com/p/v8/wiki/JavaScriptStackTraceApi
        // do not remove the regex expresses to outside of this method (due to a BUG in node.js)
        var stackReg = /at\s+(.*)\s+\((.*):(\d*):(\d*)\)/gi
        var stackReg2 = /at\s+()(.*):(\d*):(\d*)/gi

        var s = stacklist[stackIndex] || stacklist[0]
        var sp = stackReg.exec(s) || stackReg2.exec(s)

        if (sp && sp.length === 5) {
            return {
                method: sp[1] || "",
                relativePath: path.relative(__dirname, sp[2]),
                line: sp[3],
                pos: sp[4],
                file: path.basename(sp[2]),
                stack: stacklist.join('\n')
            }
        } else {
            return {
                method: "",
                relativePath: "",
                line: "",
                pos: "",
                file: "",
                stack: stacklist.join('\n')
            }
        }
    }

}
export enum Console {
    Reset = "\x1b[0m",
    Bright = "\x1b[1m",
    Dim = "\x1b[2m",
    Underscore = "\x1b[4m",
    Blink = "\x1b[5m",
    Reverse = "\x1b[7m",
    Hidden = "\x1b[8m",

    FgBlack = "\x1b[30m",
    FgRed = "\x1b[31m",
    FgGreen = "\x1b[32m",
    FgYellow = "\x1b[33m",
    FgBlue = "\x1b[34m",
    FgMagenta = "\x1b[35m",
    FgCyan = "\x1b[36m",
    FgWhite = "\x1b[37m",

    BgBlack = "\x1b[40m",
    BgRed = "\x1b[41m",
    BgGreen = "\x1b[42m",
    BgYellow = "\x1b[43m",
    BgBlue = "\x1b[44m",
    BgMagenta = "\x1b[45m",
    BgCyan = "\x1b[46m",
    BgWhite = "\x1b[47m",
}