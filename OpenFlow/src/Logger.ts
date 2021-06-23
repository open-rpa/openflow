import { NoderedUtil } from "@openiap/openflow-api";
import * as winston from "winston";
import { Config } from "./Config";
import { LicenseFile, otel } from "./otelspec";
const path = require('path');
export class Logger {
    public static otel: otel;
    public static License: LicenseFile;
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
        const myFormat = winston.format.printf(info => {
            if (info instanceof Error || info.stack) {
                return `${info.timestamp} [${info.level}] ${info.message} \n ${info.stack}`;
            }
            return `${info.timestamp} [${info.level}] ${info.message}`;
        });
        options.console.format = winston.format.combine(
            winston.format.errors({ stack: true }),
            winston.format.timestamp({ format: 'HH:mm:ss.sss' }),
            winston.format.colorize(),
            winston.format.json(),
            myFormat
        );
        const logger: winston.Logger = winston.createLogger({
            level: "debug",
            //format: winston.format.json(),
            format: winston.format.combine(
                winston.format.errors({ stack: true }),
                winston.format.timestamp({ format: 'HH:mm:ss.sss' }),
                winston.format.json(),
                myFormat
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
                    }
                } as any;
        }


        return logger;
    }
    static instanse: winston.Logger = null;
}