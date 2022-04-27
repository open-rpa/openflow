import * as winston from "winston";
import { Config } from "./Config";
const path = require('path');
import { format } from 'winston';
import { i_otel } from "./commoninterfaces";

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

// Object.defineProperty(Promise, 'retry', {
//     configurable: true,
//     writable: true,
//     value: function retry(retries, executor) {
//         // console.warn(`${retries} retries left!`)
//         if (typeof retries !== 'number') {
//             throw new TypeError('retries is not a number')
//         }
//         return new Promise(executor).catch(error => {
//             retries > 0 ? (Promise as any).retry(retries - 1, executor) : Promise.reject(error);
//         }
//         )
//     }
// })
export class Logger {
    public static otel: i_otel;
    static configure(): winston.Logger {
        const filename = path.join(Config.logpath, "nodered" + Config.nodered_id + ".log");
        const options: any = {
            file: {
                level: "debug",
                filename: filename,
                handleExceptions: false,
                json: false,
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
        options.console.format = format.combine(
            winston.format.errors({ stack: true }),
            winston.format.timestamp({ format: 'HH:mm:ss' }),
            winston.format.colorize(),
            winston.format.json(),
            myFormat
        );
        const logger: winston.Logger = winston.createLogger({
            level: "debug",
            //format: winston.format.json(),
            format: winston.format.combine(
                winston.format.errors({ stack: true }),
                winston.format.timestamp({ format: 'HH:mm:ss' }),
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