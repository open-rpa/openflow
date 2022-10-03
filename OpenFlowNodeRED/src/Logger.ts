import { NoderedUtil } from "@openiap/openflow-api";
import { i_otel } from "./commoninterfaces";
import { Config } from "./Config";
const path = require('path');

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
    public static log_with_trace: boolean = false;
    public static enabled: any = {}
    public static usecolors: boolean = true;

    public prefix(lvl: level, cls: string, func: string, message: string | unknown): string {
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
            // DatabaseConnection
            // WebSocketServerClient
            let dts: string = dt.getHours() + ":" + dt.getMinutes() + ":" + dt.getSeconds() + "." + dt.getMilliseconds();
            if (Logger.usecolors) {
                prefix = (dts.padEnd(13, " ") + "[" + cls.padEnd(21) + "][" + func + "] ");
                let spaces = 0;
                if (prefix.length < 60) spaces = 60 - prefix.length;
                prefix = Green +
                    dts.padEnd(13, " ") + White + "[" + darkYellow + cls.padEnd(21) + White + "][" + darkYellow + func + White + "] ";
                if (spaces > 0) prefix += "".padEnd(spaces, " ");

            } else {
                prefix = (dts.padEnd(13, " ") + "[" + cls.padEnd(21) + "][" + func + "] ").padEnd(60, " ");
            }
        }
        if (Logger.usecolors) {
            return prefix + color + message + Console.Reset;
        }
        return prefix + message;
    }
    public error(cls: string, func: string, message: string | Error | unknown) {
        if (Config.unittesting) return;
        if (Logger.enabled[cls]) {
            if (Logger.enabled[cls] < level.Error) return;
        }
        if (message instanceof Error) {
            console.error(message);
            return;
        }
        if (Logger.log_with_trace) return console.trace(this.prefix(level.Error, cls, func, message));
        console.error(this.prefix(level.Error, cls, func, message));
    }
    public info(cls: string, func: string, message: string) {
        if (Config.unittesting) return;
        if (!Config.log_information) {
            if (!Logger.enabled[cls]) return;
            if (Logger.enabled[cls] < level.Information) return;
        }
        if (Logger.log_with_trace) return console.trace(this.prefix(level.Information, cls, func, message));
        console.info(this.prefix(level.Information, cls, func, message));
    }
    public warn(cls: string, func: string, message: string) {
        if (Config.unittesting) return;
        // if (!Logger.enabled[cls]) return;
        // if (Logger.enabled[cls] < level.Warning) return;
        // if (Logger.log_with_trace) return console.trace(this.prefix(cls, func, message));
        console.warn(this.prefix(level.Warning, cls, func, message));
    }
    public debug(cls: string, func: string, message: string) {
        if (Config.unittesting) return;
        if (!Config.log_debug) {
            if (!Logger.enabled[cls]) return;
            if (Logger.enabled[cls] < level.Debug) return;
        }
        if (Logger.log_with_trace) return console.trace(this.prefix(level.Debug, cls, func, message));
        console.debug(this.prefix(level.Debug, cls, func, message));
    }
    public verbose(cls: string, func: string, message: string) {
        if (Config.unittesting) return;
        if (!Config.log_verbose) {
            if (!Logger.enabled[cls]) return;
            if (Logger.enabled[cls] < level.Verbose) return;
        }
        if (Logger.log_with_trace) return console.trace(this.prefix(level.Verbose, cls, func, message));
        console.debug(this.prefix(level.Verbose, cls, func, message));
    }
    public silly(cls: string, func: string, message: string) {
        if (Config.unittesting) return;
        if (!Config.log_silly) {
            if (!Logger.enabled[cls]) return;
            if (Logger.enabled[cls] < level.Silly) return;
        }
        if (Logger.log_with_trace) return console.trace(this.prefix(level.Silly, cls, func, message));
        console.debug(this.prefix(level.Silly, cls, func, message));
    }


    public static async shutdown() {
        await Logger.otel.shutdown();
    }
    static configure(skipotel: boolean): void {
        Logger.log_with_trace = Config.log_with_trace;
        Logger.usecolors = Config.log_with_colors;
        // if (Config.NODE_ENV == "development") Logger.log_with_trace = true;
        if (Config.log_webserver) Logger.enabled["WebServer"] = level.Verbose;
        if (Config.log_storage) Logger.enabled["Storage"] = level.Verbose;
        if (Config.log_otel) Logger.enabled["otel"] = level.Verbose;




        if (Config.otel_debug_log) Logger.enabled["WebSocketServerClient"] = level.Verbose;
        if (Config.otel_warn_log) Logger.enabled["WebSocketServerClient"] = level.Warning;
        if (Config.otel_err_log) Logger.enabled["WebSocketServerClient"] = level.Error;

        Logger.instanse = new Logger();
        let _otel_require: any = null;
        try {
            if (!skipotel) _otel_require = require("./ee/otel");
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
                    shutdown: () => undefined,
                    meter: {
                        createHistogram: () => undefined,
                        createCounter: () => undefined,
                        createObservableUpDownCounter: () => undefined,
                        createValueObserver: () => undefined,
                        createObservableGauge: () => undefined,
                    }
                } as any;
        }
    }
    static instanse: Logger = null;
    private static _ofid = null;
    static ofid() {
        if (!NoderedUtil.IsNullEmpty(Logger._ofid)) return Logger._ofid;
        var crypto = require('crypto');
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
                method: sp[1],
                relativePath: path.relative(__dirname, sp[2]),
                line: sp[3],
                pos: sp[4],
                file: path.basename(sp[2]),
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