import * as winston from "winston";
import { Config } from "./Config";
const path = require('path');

export class Logger {
    static configure(): winston.Logger {
        const filename = path.join(Config.logpath, "nodered" + Config.nodered_id + ".log");
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
        const enumerateErrorFormat = winston.format(info => {
            if ((info.message as any) instanceof Error) {
                const e = (info.message as any) as Error;
                info.message = Object.assign({
                    message: e.message,
                    stack: e.stack
                }, info.message);
            }

            if (info instanceof Error) {
                return Object.assign({
                    message: info.message,
                    stack: info.stack
                }, info);
            }

            return info;
        });
        const logger: winston.Logger = winston.createLogger({
            level: "debug",
            //format: winston.format.json(),
            format: winston.format.combine(
                enumerateErrorFormat(),
                winston.format.timestamp({ format: 'HH:mm:ss' }),
                // winston.format.json()
                winston.format.printf(info => `${info.timestamp} ${info.level}: ${info.message}` + (info.splat !== undefined ? `${info.splat}` : " "))
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