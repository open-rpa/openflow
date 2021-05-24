import * as winston from "winston";
import { Config } from "./Config";
import { LicenseFile, otel } from "./otelspec";
const path = require('path');
export class Logger {
    public static otel: otel;
    public static License: LicenseFile;
    static configure(): winston.Logger {
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
        return logger;
    }
    static instanse: winston.Logger = null;
}