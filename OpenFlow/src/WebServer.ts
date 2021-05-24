import * as os from "os";
import * as path from "path";
import * as http from "http";
import * as https from "https";
import * as express from "express";
import * as compression from "compression";
import * as cookieParser from "cookie-parser";
import * as cookieSession from "cookie-session";
import * as flash from "flash";
import * as morgan from "morgan";
import { SamlProvider } from "./SamlProvider";
import { LoginProvider } from "./LoginProvider";
import { Config } from "./Config";
import { NoderedUtil } from "@openiap/openflow-api";
const { RateLimiterMemory } = require('rate-limiter-flexible')
import * as url from "url";
import { WebSocketServer } from "./WebSocketServer";
import { WebSocketServerClient } from "./WebSocketServerClient";
import { Counter } from "@opentelemetry/api-metrics"
import { Logger } from "./Logger";
var _hostname = "";

const BaseRateLimiter = new RateLimiterMemory({
    points: Config.api_rate_limit_points,
    duration: Config.api_rate_limit_duration,
});

const rateLimiter = (req: express.Request, res: express.Response, next: express.NextFunction): void => {
    BaseRateLimiter
        .consume(WebServer.remoteip(req))
        .then((e) => {
            // console.info("API_O_RATE_LIMIT consumedPoints: " + e.consumedPoints + " remainingPoints: " + e.remainingPoints);
            next();
        })
        .catch((e) => {
            const route = url.parse(req.url).pathname;
            if (!NoderedUtil.IsNullUndefinded(websocket_rate_limit)) websocket_rate_limit.bind({ ...Logger.otel.defaultlabels, route: route }).add(1);
            console.warn("API_RATE_LIMIT consumedPoints: " + e.consumedPoints + " remainingPoints: " + e.remainingPoints + " msBeforeNext: " + e.msBeforeNext);
            res.status(429).json({ response: 'RATE_LIMIT' });
        });
};

let websocket_rate_limit: Counter = null;
export class WebServer {
    public static remoteip(req: express.Request) {
        let remoteip: string = req.socket.remoteAddress;
        if (req.headers["X-Forwarded-For"] != null) remoteip = req.headers["X-Forwarded-For"] as string;
        if (req.headers["X-real-IP"] != null) remoteip = req.headers["X-real-IP"] as string;
        if (req.headers["x-forwarded-for"] != null) remoteip = req.headers["x-forwarded-for"] as string;
        if (req.headers["x-real-ip"] != null) remoteip = req.headers["x-real-ip"] as string;
        return remoteip;
    }
    public static app: express.Express;
    static async configure(baseurl: string): Promise<http.Server> {
        if (!NoderedUtil.IsNullUndefinded(Logger.otel)) {
            websocket_rate_limit = Logger.otel.meter.createCounter("openflow_webserver_rate_limit_count", {
                description: 'Total number of rate limited web request'
            }) // "route"
        }
        this.app = express();
        this.app.disable("x-powered-by");
        this.app.get("/metrics", async (req: any, res: any, next: any): Promise<void> => {
            let result: string = ""
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
                Logger.instanse.silly(message);
            }
        };
        this.app.use("/", express.static(path.join(__dirname, "/public")));
        this.app.use(morgan('combined', { stream: loggerstream }));
        this.app.use(compression());
        this.app.use(express.urlencoded({ extended: true }));
        this.app.use(express.json());
        this.app.use(cookieParser());
        this.app.set('trust proxy', 1)
        this.app.use(cookieSession({
            name: "session", secret: Config.cookie_secret, httpOnly: true
        }));
        this.app.use(flash());
        if (Config.api_rate_limit) this.app.use(rateLimiter);

        this.app.get("/livenessprobe", (req: any, res: any, next: any): void => {
            if (NoderedUtil.IsNullEmpty(_hostname)) _hostname = (Config.getEnv("HOSTNAME", undefined) || os.hostname()) || "unknown";
            res.end(JSON.stringify({ "success": "true", "hostname": _hostname }));
            res.end();
        });

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
        await LoginProvider.configure(this.app, baseurl);
        await SamlProvider.configure(this.app, baseurl);
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
            }
            if (Config.tls_passphrase !== "") {
                options.passphrase = Config.tls_passphrase;
            }
            server = https.createServer(options, this.app);
        } else {
            server = http.createServer(this.app);
        }

        await Config.db.connect();
        const port = Config.port;
        server.listen(port).on('error', function (error) {
            Logger.instanse.error(error);
            server.close();
            process.exit(404);
        });
        return server;
    }
}