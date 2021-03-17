import * as path from "path";
import * as winston from "winston";
import * as http from "http";
import * as https from "https";
import * as express from "express";
import * as compression from "compression";
import * as bodyParser from "body-parser";
import * as cookieParser from "cookie-parser";
import * as cookieSession from "cookie-session";
import * as crypto from "crypto";
import * as flash from "flash";
import * as morgan from "morgan";

import * as samlp from "samlp";
import { SamlProvider } from "./SamlProvider";
import { LoginProvider } from "./LoginProvider";
import { DatabaseConnection } from "./DatabaseConnection";
import { Config } from "./Config";

import { NoderedUtil } from "@openiap/openflow-api";
const { RateLimiterMemory } = require('rate-limiter-flexible')
import * as url from "url";
import { WebSocketServer } from "./WebSocketServer";
import { WebSocketServerClient } from "./WebSocketServerClient";
import { Counter } from "@opentelemetry/api-metrics"
import { otel } from "./otel";

const BaseRateLimiter = new RateLimiterMemory({
    points: Config.api_rate_limit_points,
    duration: Config.api_rate_limit_duration,
});

const rateLimiter = (req: express.Request, res: express.Response, next: express.NextFunction): void => {
    BaseRateLimiter
        .consume(req.ip)
        .then((e) => {
            // console.info("API_O_RATE_LIMIT consumedPoints: " + e.consumedPoints + " remainingPoints: " + e.remainingPoints);
            next();
        })
        .catch((e) => {
            const route = url.parse(req.url).pathname;
            if (!NoderedUtil.IsNullUndefinded(websocket_rate_limit)) websocket_rate_limit.bind({ ...otel.defaultlabels, route: route }).add(1);
            console.warn("API_RATE_LIMIT consumedPoints: " + e.consumedPoints + " remainingPoints: " + e.remainingPoints + " msBeforeNext: " + e.msBeforeNext);
            res.status(429).json({ response: 'RATE_LIMIT' });
        });
};

let websocket_rate_limit: Counter = null;
export class WebServer {
    private static _logger: winston.Logger;
    public static app: express.Express;


    static async configure(logger: winston.Logger, baseurl: string, _otel: otel): Promise<http.Server> {
        this._logger = logger;
        if (!NoderedUtil.IsNullUndefinded(_otel)) {
            websocket_rate_limit = _otel.meter.createCounter("openflow_webserver_rate_limit_count", {
                description: 'Total number of rate limited web request'
            }) // "route"
        }
        this.app = express();
        // if (!NoderedUtil.IsNullUndefinded(register)) {
        //     const metricsMiddleware = promBundle({ includeMethod: true, includePath: true, promRegistry: register, autoregister: true });
        //     this.app.use(metricsMiddleware);
        //     if (!NoderedUtil.IsNullUndefinded(register)) register.registerMetric(webserver_rate_limit);
        // }

        // this.app.get("/form", async (req: any, res: any, next: any): Promise<void> => {
        //     res.send({
        //         status: "success",
        //         display_status: "Success",
        //         message: "All system are go"
        //     });
        //     return;
        // });
        // this.app.get("/formio", async (req: any, res: any, next: any): Promise<void> => {
        //     res.send({
        //         status: "success",
        //         display_status: "Success",
        //         message: "All system are go"
        //     });
        //     return;
        // });

        this.app.get("/metrics", async (req: any, res: any, next: any): Promise<void> => {
            let result: string = ""
            // if (!NoderedUtil.IsNullUndefinded(register)) {
            //     result += await register.metrics() + '\n';
            // }

            for (let i = WebSocketServer._clients.length - 1; i >= 0; i--) {
                const cli: WebSocketServerClient = WebSocketServer._clients[i];
                try {
                    if (!NoderedUtil.IsNullEmpty(cli.metrics) && cli.user != null) {
                        const arr: string[] = cli.metrics.split('\n');
                        const replacer = (match: any, offset: any, string: any) => {
                            return '{' + offset + ',username="' + cli.user.username + '"}';
                        }
                        for (let y = 0; y < arr.length; y++) {
                            let line = arr[y];
                            if (!line.startsWith("#")) {
                                if (line.indexOf("}") > -1) {
                                    line = line.replace(/{(.*)}/gi, replacer);
                                    arr[y] = line
                                } else if (!NoderedUtil.IsNullEmpty(line) && line.indexOf(' ') > -1) {
                                    const _arr = line.split(' ');
                                    _arr[0] += '{username="' + cli.user.username + '"}';
                                    line = _arr.join(' ');
                                    arr[y] = line
                                }
                            }

                        }

                        result += arr.join('\n') + '\n';
                    }
                } catch (error) {
                    console.error(error);
                }
            }
            res.set({ 'Content-Type': 'text/plain' });
            res.send(result);
        });

        const loggerstream = {
            write: function (message, encoding) {
                logger.silly(message);
            }
        };
        this.app.use("/", express.static(path.join(__dirname, "/public")));
        this.app.use(morgan('combined', { stream: loggerstream }));
        this.app.use(compression());
        this.app.use(bodyParser.urlencoded({ extended: true }));
        this.app.use(bodyParser.json());
        this.app.use(cookieParser());
        this.app.use(cookieSession({
            name: "session", secret: Config.cookie_secret
        }));
        this.app.use(flash());
        if (Config.api_rate_limit) this.app.use(rateLimiter);


        // Add headers
        this.app.use(function (req, res, next) {

            // Website you wish to allow to connect
            res.setHeader('Access-Control-Allow-Origin', '*');

            // Request methods you wish to allow
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');

            // Request headers you wish to allow
            res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');

            // Set to true if you need the website to include cookies in the requests sent
            // to the API (e.g. in case you use sessions)
            res.setHeader('Access-Control-Allow-Credentials', "true");

            // Pass to next layer of middleware
            next();
        });
        await LoginProvider.configure(this._logger, this.app, baseurl);
        await SamlProvider.configure(this._logger, this.app, baseurl);
        let server: http.Server = null;
        if (Config.tls_crt != '' && Config.tls_key != '') {
            let options: any = {
                cert: Config.tls_crt,
                key: Config.tls_key
            };
            if (Config.tls_crt.indexOf("---") == -1) {
                options = {
                    cert: Buffer.from(Config.tls_crt, 'base64').toString('ascii'),
                    key: Buffer.from(Config.tls_key, 'base64').toString('ascii')
                };
            }
            let ca: string = Config.tls_ca;
            if (ca !== "") {
                if (ca.indexOf("---") === -1) {
                    ca = Buffer.from(Config.tls_ca, 'base64').toString('ascii');
                }
                options.ca = ca;
                // options.cert += "\n" + ca;
            }
            if (Config.tls_passphrase !== "") {
                options.passphrase = Config.tls_passphrase;
            }
            server = https.createServer(options, this.app);
        } else {
            server = http.createServer(this.app);
        }

        const port = Config.port;
        server.listen(port).on('error', function (error) {
            WebServer._logger.error(error);
        });
        return server;
    }
}