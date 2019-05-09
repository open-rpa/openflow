import * as winston from "winston";

export class Logger {
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
                level: "debug",
                handleExceptions: false,
                json: false,
                colorize: true
            },
        };
        const logger: winston.Logger = winston.createLogger({
            level: "debug",
            format: winston.format.json(),
            defaultMeta: { service: "openflow" },
            transports: [
                // new winston.transports.File(options.file),
                new winston.transports.Console(options.console)
            ]
        });
        return logger;
    }
}