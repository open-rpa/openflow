import { NoderedUtil } from "@openiap/openflow-api";
import * as winston from "winston";
import { Config } from "./Config";
import { LicenseFile, otel } from "./otelspec";
const path = require('path');
export class Logger {
    public static otel: otel;
    public static License: LicenseFile;
    static myFormat = winston.format.printf(info => {
        if (info instanceof Error || info.stack) {
            return `${info.timestamp} [${info.level}] ${info.message} \n ${info.stack}`;
        }
        if (Config.NODE_ENV == "development") {
            return `${info.timestamp} [${Logger.getLabel()}][${info.level}] ${info.message}`;
        }
        return `${info.timestamp} [${info.level}] ${info.message}`;
    });
    static getLabel = function () {
        let e = new Error();
        let frame = "";
        let lineNumber = "";
        let functionName = "";
        let filename = "";
        let arr = [];
        try {
            arr = e.stack.split("\n");
            frame = arr[0];
            arr = arr.filter(x => x.indexOf("node_modules") === -1)
            arr = arr.filter(x => x.indexOf("dist") !== -1)
            arr = arr.filter(x => x.indexOf("Logger.js") === -1)
            arr = arr.filter(x => x.indexOf("otel.js") === -1)
            if (arr.length > 0) frame = arr[0];
            lineNumber = frame.split(":").reverse()[1];
            functionName = frame.split(" ")[5];
            filename = frame.substr(frame.indexOf("("));
            filename = filename.replace("(", "").replace(")", "");
            filename = path.basename(filename)
            return functionName + " " + filename;
        } catch (error) {
            return "n/a";
        }
    };
    static configure(skipotel: boolean, skiplic: boolean): winston.Logger {
        const filename = path.join(Config.logpath, "openflow.log");
        const options: any = {
            file: {
                level: "debug",
                filename: filename,
                handleExceptions: false,
                json: true,
                maxsize: 5242880, // 5MB
                maxFiles: 5,
                colorize: false,
            },
            console: {
                level: "debug",
                handleExceptions: false,
                json: false,
                colorize: true
            },
        };
        options.console.format = winston.format.combine(
            winston.format.errors({ stack: true }),
            winston.format.timestamp({ format: 'HH:mm:ss.sss' }),
            winston.format.colorize(),
            winston.format.json(),
            Logger.myFormat
        );
        const logger: winston.Logger = winston.createLogger({
            level: "debug",
            //format: winston.format.json(),
            format: winston.format.combine(
                winston.format.errors({ stack: true }),
                winston.format.timestamp({ format: 'HH:mm:ss.sss' }),
                winston.format.json(),
                Logger.myFormat
            ),
            transports: [
                new winston.transports.File(options.file),
                new winston.transports.Console(options.console)
            ]
        });
        Logger.instanse = logger;



        let _lic_require: any = null;
        try {
            if (!skiplic) _lic_require = require("./license-file");
        } catch (error) {
        }
        if (_lic_require != null) {
            Logger.License = new _lic_require.LicenseFile();
        } else {
            Logger.License = {} as any;
            Logger.License.ofid = Logger.ofid;
            Logger.License.shutdown = () => undefined;
        }




        let _otel_require: any = null;
        try {
            if (!skipotel) _otel_require = require("./otel");
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
                        createValueRecorder: () => undefined,
                        createCounter: () => undefined,
                        createUpDownSumObserver: () => undefined,
                        createValueObserver: () => undefined,
                    }
                } as any;
        }


        return logger;
    }
    static instanse: winston.Logger = null;
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