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
import { Span } from "@opentelemetry/api";
import { Logger } from "./Logger";
var _hostname = "";


const rateLimiter = (req: express.Request, res: express.Response, next: express.NextFunction): void => {
    if (req.originalUrl.indexOf('/oidc') > -1) return next();
    Logger.instanse.verbose('WebServer', 'rateLimiter', "Validate for " + req.originalUrl);
    WebServer.BaseRateLimiter
        .consume(WebServer.remoteip(req))
        .then((e) => {
            Logger.instanse.verbose("WebServer", "rateLimiter", "consumedPoints: " + e.consumedPoints + " remainingPoints: " + e.remainingPoints);
            next();
        })
        .catch((e) => {
            const route = url.parse(req.url).pathname;
            // if (!NoderedUtil.IsNullUndefinded(websocket_rate_limit)) websocket_rate_limit.bind({ ...Logger.otel.defaultlabels, route: route }).update(e.consumedPoints);
            Logger.instanse.warn("WebServer", "rateLimiter", "API_RATE_LIMIT consumedPoints: " + e.consumedPoints + " remainingPoints: " + e.remainingPoints + " msBeforeNext: " + e.msBeforeNext);
            res.status(429).json({ response: 'RATE_LIMIT' });
        });
};

// let websocket_rate_limit: BaseObserver = null;
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
    public static BaseRateLimiter: any;
    public static server: http.Server = null;
    static async configure(baseurl: string, parent: Span): Promise<http.Server> {
        const span: Span = Logger.otel.startSubSpan("WebServer.configure", parent);
        WebServer.BaseRateLimiter = new RateLimiterMemory({
            points: Config.api_rate_limit_points,
            duration: Config.api_rate_limit_duration,
        });

        try {
            if (!NoderedUtil.IsNullUndefinded(Logger.otel)) {
                // websocket_rate_limit = Logger.otel.meter.createUpDownSumObserver("openflow_webserver_rate_limit_count", {
                //     description: 'Total number of rate limited web request'
                // }) // "route"
            }
            this.app = express();
            this.app.disable("x-powered-by");
            const loggerstream = {
                write: function (message, encoding) {
                    Logger.instanse.silly("WebServer", "configure", message);
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
                // Grafana hack
                if (req.originalUrl == "/oidc/me" && req.method == "OPTIONS") {
                    return res.send("ok");
                }
                if (req.originalUrl.indexOf('/oidc') > -1) return next();
                Logger.instanse.verbose('WebServer', 'AllowOrigin', "add for " + req.originalUrl);
                // const origin: string = (req.headers.origin as any);
                // if (NoderedUtil.IsNullEmpty(origin)) {
                //     res.header('Access-Control-Allow-Origin', '*');
                // } else {
                //     res.header('Access-Control-Allow-Origin', origin);
                // }
                // Website you wish to allow to connect
                res.setHeader('Access-Control-Allow-Origin', '*');

                // Request methods you wish to allow
                res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');

                // Request headers you wish to allow
                res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Access-Control-Allow-Headers, Authorization");

                // Set to true if you need the website to include cookies in the requests sent
                // to the API (e.g. in case you use sessions)
                res.setHeader('Access-Control-Allow-Credentials', "true");

                // Disable Caching
                res.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
                res.header('Expires', '-1');
                res.header('Pragma', 'no-cache');

                // Pass to next layer of middleware
                next();
            });
            span?.addEvent("Configure LoginProvider");
            await LoginProvider.configure(this.app, baseurl);
            span?.addEvent("Configure SamlProvider");
            await SamlProvider.configure(this.app, baseurl);
            WebServer.server = null;
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
                WebServer.server = https.createServer(options, this.app);
            } else {
                WebServer.server = http.createServer(this.app);
            }
            await Config.db.connect(span);
            return WebServer.server;
        } catch (error) {
            span?.recordException(error);
            Logger.instanse.error("WebServer", "configure", error);
            return null;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public static Listen() {
        WebServer.server.listen(Config.port).on('error', function (error) {
            Logger.instanse.error("WebServer", "Listen", error);
            if (Config.NODE_ENV == "production") {
                WebServer.server.close();
                process.exit(404);
            }
        });
        Logger.instanse.info("WebServer", "Listen", "on " + Config.baseurl());
    }
}