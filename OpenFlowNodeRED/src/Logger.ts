import * as winston from "winston";

export class Logger {
    static instanse:winston.Logger = null;
    static configure(): winston.Logger {
        var options: any = {
            // file: {
            //     level: "info",
            //     filename: `${__dirname}/logs/app.log`,
            //     handleExceptions: false,
            //     json: true,
            //     maxsize: 5242880, // 5MB
            //     maxFiles: 5,
            //     colorize: false,
            // },
            console: {
                level: "silly",
                handleExceptions: false,
                json: false,
                colorize: true
            },
        };
        const logger: winston.Logger = winston.createLogger({
            format: winston.format.json(),
            defaultMeta: { service: "openflownodered" },
            transports: [
                // new winston.transports.File(options.file),
                new winston.transports.Console(options.console)
            ]
        });
        Logger.instanse = logger;
        return logger;
    }
}