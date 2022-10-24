import * as os from "os";
import * as path from "path";
import * as http from "http";
import * as https from "https";
import * as express from "express";
import * as compression from "compression";
import * as cookieParser from "cookie-parser";
import * as cookieSession from "cookie-session";
import * as flash from "flash";
import { SamlProvider } from "./SamlProvider";
import { LoginProvider } from "./LoginProvider";
import { Config } from "./Config";
import { InsertOrUpdateOneMessage, NoderedUtil, TokenUser } from "@openiap/openflow-api";
const { RateLimiterMemory } = require('rate-limiter-flexible')
import * as url from "url";
import { Span } from "@opentelemetry/api";
import { Logger } from "./Logger";
import { WebSocketServerClient } from "./WebSocketServerClient";
import { Crypt } from "./Crypt";
var _hostname = "";
import { context, TraceFlags, trace, ROOT_CONTEXT, SpanContext } from '@opentelemetry/api';
import { setSpan, getSpan } from "@opentelemetry/api/build/src/trace/context-utils";
import opentelemetry = require('@opentelemetry/sdk-node');

const rateLimiter = async (req: express.Request, res: express.Response, next: express.NextFunction): Promise<void> => {
    if (req.originalUrl.indexOf('/oidc') > -1) return next();
    // var span = Logger.otel.startSpanExpress("rateLimiter", req);
    try {
        Logger.instanse.verbose("Validate for " + req.originalUrl);
        var e = await WebServer.BaseRateLimiter.consume(WebServer.remoteip(req))
        Logger.instanse.verbose("consumedPoints: " + e.consumedPoints + " remainingPoints: " + e.remainingPoints);
        next();
    } catch (error) {
        // const route = url.parse(req.url).pathname;
        // if (!NoderedUtil.IsNullUndefinded(websocket_rate_limit)) websocket_rate_limit.bind({ ...Logger.otel.defaultlabels, route: route }).update(e.consumedPoints);
        var span = Logger.otel.startSpanExpress("rateLimiter", req);
        Logger.instanse.warn("API_RATE_LIMIT consumedPoints: " + error.consumedPoints + " remainingPoints: " + error.remainingPoints + " msBeforeNext: " + error.msBeforeNext, span);
        span.end();
        res.status(429).json({ response: 'RATE_LIMIT' });
    } finally {
        // span.end();
    }
};

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
    public static webpush = require('web-push');
    public static async isBlocked(req: express.Request): Promise<boolean> {
        try {
            var remoteip = LoginProvider.remoteip(req);
            if (!NoderedUtil.IsNullEmpty(remoteip)) {
                remoteip = remoteip.toLowerCase();
                var blocks = await Logger.DBHelper.GetIPBlockList(null);
                if (blocks && blocks.length > 0) {
                    for (var i = 0; i < blocks.length; i++) {
                        var block: any = blocks[i];
                        var blocklist = block.ips;
                        if (blocklist && Array.isArray(blocklist)) {
                            for (var x = 0; x < blocklist.length; x++) {
                                var ip = blocklist[x];
                                if (!NoderedUtil.IsNullEmpty(ip)) {
                                    ip = ip.toLowerCase();
                                    if (ip == remoteip) {
                                        return true;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } catch (error) {
            Logger.instanse.error(error, null);
        }
        return false;
    }
    static async configure(baseurl: string, parent: Span): Promise<http.Server> {
        const span: Span = Logger.otel.startSubSpan("WebServer.configure", parent);
        span?.addEvent("create RateLimiterMemory");
        WebServer.BaseRateLimiter = new RateLimiterMemory({
            points: Config.api_rate_limit_points,
            duration: Config.api_rate_limit_duration,
        });

        try {
            if (!NoderedUtil.IsNullUndefinded(Logger.otel)) {
                // websocket_rate_limit = Logger.otel.meter.createObservableUpDownCounter("openflow_webserver_rate_limit_count", {
                //     description: 'Total number of rate limited web request'
                // }) // "route"
            }
            span?.addEvent("Create Express");
            this.app = express();
            this.app.disable("x-powered-by");
            this.app.use(async (req, res, next) => {
                if (await WebServer.isBlocked(req)) {
                    var remoteip = WebSocketServerClient.remoteip(req);
                    if (Config.log_blocked_ips) Logger.instanse.error(remoteip + " is blocked", null);
                    try {
                        res.status(429).json({ "message": "ip blocked" });
                    } catch (error) {
                    }
                    return;
                }
                next();
            });
            this.app.use("/", express.static(path.join(__dirname, "/public")));
            this.app.use(compression());
            this.app.use(express.urlencoded({ extended: true }));
            this.app.use(express.json());
            this.app.use(cookieParser());
            this.app.set('trust proxy', 1)
            span?.addEvent("Add cookieSession");
            this.app.use(cookieSession({
                name: "session", secret: Config.cookie_secret, httpOnly: true
            }));
            this.app.use(flash());
            if (Config.api_rate_limit) this.app.use(rateLimiter);

            this.app.get("/livenessprobe", WebServer.get_livenessprobe.bind(this));

            // https://scaleup.us/2020/06/21/how-to-block-ips-in-your-traefik-proxy-server/
            this.app.get("/ipblock", async (req: any, res: any, next: any): Promise<void> => {
                if (await WebServer.isBlocked(req)) {
                    var remoteip = LoginProvider.remoteip(req);
                    if (Config.log_blocked_ips) Logger.instanse.error(remoteip + " is blocked", null);
                    res.statusCode = 401;
                    res.setHeader('WWW-Authenticate', 'Basic realm="OpenFlow"');
                    res.end('Unauthorized');
                    return;
                }
                return res.status(200).send({ message: 'ok.' });
            });

            // Add headers
            this.app.use(function (req, res, next) {
                Logger.instanse.verbose("add for " + req.originalUrl);
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

                if (req.originalUrl == "/me") {
                    res.redirect('/oidc/me')
                    return next();
                }

                // Grafana hack
                if (req.originalUrl == "/oidc/me" && req.method == "OPTIONS") {
                    return res.send("ok");
                }
                if (req.originalUrl.indexOf('/oidc') > -1) return next();


                // Pass to next layer of middleware
                next();
            });

            // https://www.section.io/engineering-education/push-notification-in-nodejs-using-service-worker/
            // https://github.com/mercymeave/code-space/tree/main/push-notifications/client

            // https://swina.github.io/2019/02/vue-service-worker-for-webpush-notifications/


            //setting vapid keys details
            if (!NoderedUtil.IsNullEmpty(Config.wapid_pub) && !NoderedUtil.IsNullEmpty(Config.wapid_key)) {
                span?.addEvent("Setting openflow for WebPush");
                var mail = Config.wapid_mail;
                if (NoderedUtil.IsNullEmpty(mail)) mail = "me@email.com"
                this.webpush.setVapidDetails('mailto:' + mail, Config.wapid_pub, Config.wapid_key);
                this.app.post('/webpushsubscribe', async (req, res) => {
                    var subspan = Logger.otel.startSpanExpress("webpushsubscribe", req);
                    try {
                        const subscription = req.body;
                        span?.setAttribute("subscription", JSON.stringify(subscription));
                        if (NoderedUtil.IsNullUndefinded(subscription) && NoderedUtil.IsNullEmpty(subscription.jwt)) {
                            Logger.instanse.error("Received invalid subscription request", null);
                            return res.status(500).json({ "error": "no subscription" });
                        }
                        const jwt = subscription.jwt;
                        const tuser: TokenUser = await Crypt.verityToken(jwt);
                        if (NoderedUtil.IsNullUndefinded(tuser)) {
                            Logger.instanse.error("jwt is invalid", null);
                            return res.status(500).json({ "error": "no subscription" });
                        }
                        delete subscription.jwt;
                        if (NoderedUtil.IsNullEmpty(subscription._type)) subscription._type = "unknown";
                        subscription.userid = tuser._id;
                        subscription.name = tuser.name + " " + subscription._type + " " + subscription.host;
                        var msg: InsertOrUpdateOneMessage = new InsertOrUpdateOneMessage();
                        msg.collectionname = "webpushsubscriptions"; msg.jwt = jwt;
                        msg.item = subscription;
                        msg.uniqeness = "userid,_type,host,endpoint";

                        await Config.db._InsertOrUpdateOne(msg, null);
                        Logger.instanse.info("Registered webpush subscription for " + tuser.name, span);
                        res.status(201).json({})
                    } catch (error) {
                        Logger.instanse.error(error, subspan);
                        try {
                            return res.status(500).json({ "error": error.message ? error.message : error });
                        } catch (error) {
                        }
                    } finally {
                        subspan?.end();
                    }
                })
            }

            span?.addEvent("Configure LoginProvider");
            await LoginProvider.configure(this.app, baseurl, span);
            try {
                span?.addEvent("Configure FormioEP");

                let FormioEPProxy: any = null;
                try {
                    FormioEPProxy = require("./ee/FormioEP");
                } catch (error) {
                }
                if (!NoderedUtil.IsNullUndefinded(FormioEPProxy)) {
                    await FormioEPProxy.FormioEP.configure(this.app, baseurl);
                }
            } catch (error) {
            }
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
            Logger.instanse.error(error, span);
            return null;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public static Listen() {
        WebServer.server.listen(Config.port).on('error', function (error) {
            Logger.instanse.error(error, null);
            if (Config.NODE_ENV == "production") {
                WebServer.server.close();
                process.exit(404);
            }
        });
        Logger.instanse.info("Listening on " + Config.baseurl(), null);
    }
    static get_livenessprobe(req: any, res: any, next: any): void {
        let span = Logger.otel.startSpanExpress("get_livenessprobe", req)
        try {
            const [traceId, spanId] = Logger.otel.GetTraceSpanId(span);
            if (NoderedUtil.IsNullEmpty(_hostname)) _hostname = (Config.getEnv("HOSTNAME", undefined) || os.hostname()) || "unknown";
            res.end(JSON.stringify({ "success": "true", "hostname": _hostname, dt: new Date(), traceId, spanId }));
            res.end();
            span.setStatus({ code: 200 });
        } catch (error) {
            console.error(error);
            span.setStatus({
                code: 500,
                message: error instanceof Error ? error.message : undefined,
            });
        } finally {
            span.end();
        }
        // https://lightrun.com/answers/googleapis-nodejs-pubsub-opentelemetry-integration-misses-the-point-we-need-to-propagate-the-spancontext
        // https://github.com/open-telemetry/opentelemetry-js/tree/main/packages/opentelemetry-propagator-jaeger
        // https://github.com/open-telemetry/opentelemetry-js/blob/main/packages/opentelemetry-propagator-jaeger/test/JaegerPropagator.test.ts
        // tracer.startActiveSpan('findme22', {}, context, (span) => {
        //     try {
        //         if (NoderedUtil.IsNullEmpty(_hostname)) _hostname = (Config.getEnv("HOSTNAME", undefined) || os.hostname()) || "unknown";
        //         // @ts-ignore
        //         const [ traceId, spanId ] = Logger.otel.GetTraceSpanId(span);
        //         res.end(JSON.stringify({ "success": "true", "hostname": _hostname, traceId, spanId, traceFlags }));
        //         res.end();
        //         span.setStatus({ code: 200 });
        //     } catch (error) {
        //         console.error(error);
        //         span.setStatus({
        //             code: 500,
        //             message: error instanceof Error ? error.message : undefined,
        //         });
        //     } finally {
        //         span.end();
        //     }
        // });
    }
}