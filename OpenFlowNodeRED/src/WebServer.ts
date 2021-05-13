import * as os from "os";
import * as path from "path";
import * as http from "http";
import * as https from "https";
import * as express from "express";
import * as compression from "compression";
import * as cookieParser from "cookie-parser";
import * as nodered from "node-red";
import * as morgan from "morgan";

// import * as samlauth from "./node-red-contrib-auth-saml";
import * as cookieSession from "cookie-session";

import { nodered_settings } from "./nodered_settings";
import { Config } from "./Config";
import { noderedcontribopenflowstorage, noderednpmrc } from "./node-red-contrib-openflow-storage";
import { noderedcontribmiddlewareauth } from "./node-red-contrib-middleware-auth";

import * as passport from "passport";
import { noderedcontribauthsaml } from "./node-red-contrib-auth-saml";
import { WebSocketClient, NoderedUtil, Message } from "@openiap/openflow-api";
import { ValueRecorder, Counter, BaseObserver } from "@opentelemetry/api-metrics"
import { HrTime, Span } from "@opentelemetry/api";
import { hrTime } from "@opentelemetry/core";
import * as RED from "node-red";
import { Red } from "node-red";
import { Logger } from "./Logger";
var _hostname = "";

export class log_message_node {
    public span: Span;
    public end: HrTime;
    public nodetype: string;
    public node: Red;
    public name: string;
    constructor(public nodeid: string) {
        this.node = RED.nodes.getNode(nodeid);
        if (this.node != null) {
            this.nodetype = this.node.type;
            this.name = this.node.name || this.node.type;
        }
    }
    startspan(parentspan: Span, msgid) {
        this.span = Logger.otel.startSubSpan(this.name, parentspan);
        this.span.setAttributes(Logger.otel.defaultlabels);
        this.span.setAttribute("msgid", msgid);
        this.span.setAttribute("nodeid", this.nodeid);
        this.span.setAttribute("nodetype", this.nodetype)
        this.span.setAttribute("name", this.name)
        // nodemessage.span = otel.startSpan2(msg.event, msg.msgid);
        this.end = Logger.otel.startTimer();
    }
}
export class log_message {
    public timestamp: Date;
    public hrtimestamp: HrTime;
    public span: Span;
    public nodes: { [key: string]: log_message_node; } = {};
    public node: Red;
    public name: string;
    // public nodes: object = {}
    constructor(public msgid: string, public nodeid: string) {
        this.node = RED.nodes.getNode(nodeid);
        this.timestamp = new Date();
        this.name = this.node.name || this.node.type;
        this.hrtimestamp = hrTime();
        this.nodes = {};
        this.span = Logger.otel.startSpan(this.name);
        this.span.setAttribute("msgid", msgid);
        this.span.setAttribute("nodeid", this.nodeid);
        this.span.setAttribute("nodetype", this.node.type)
        this.span.setAttribute("name", this.name)
    }
}
export class WebServer {
    private static app: express.Express = null;

    // public static openflow_nodered_node_activations: Counter;
    public static openflow_nodered_node_duration: ValueRecorder;
    public static message_queue_count: BaseObserver;

    // public static openflow_nodered_nodeid_duration = new client.Histogram({
    //     name: 'openflow_nodered_nodeid_duration',
    //     help: 'Duration of each node call',
    //     labelNames: ["nodetype", "nodeid"]
    // })

    public static log_messages: { [key: string]: log_message; } = {};
    // public static log_messages: Record<string, log_message> = {};
    // public static spans: any = {};
    private static settings: nodered_settings = null;
    static async configure(socket: WebSocketClient): Promise<http.Server> {
        const options: any = null;
        const RED: nodered.Red = nodered;

        if (this.app !== null) { return; }

        if (!NoderedUtil.IsNullUndefinded(Logger.otel)) {
            // this.openflow_nodered_node_activations = _otel.meter.createCounter("openflow_nodered_node_activations", {
            //     description: 'Total number of node type activations calls'
            // }) // "nodetype"

            this.openflow_nodered_node_duration = Logger.otel.meter.createValueRecorder('openflow_nodered_node_duration', {
                description: 'Duration of each node type call',
                boundaries: Logger.otel.default_boundaries
            }); // "nodetype"
            this.message_queue_count = Logger.otel.meter.createUpDownSumObserver("openflow_message_queue_count", {
                description: 'Total number messages waiting on reply from client'
            }) // "command"

        }

        try {
            Logger.instanse.debug("WebServer.configure::begin");
            let server: http.Server = null;
            if (this.app === null) {
                this.app = express();

                const hostname = Config.getEnv("HOSTNAME", null);
                const defaultLabels: any = {};
                if (!NoderedUtil.IsNullEmpty(hostname)) defaultLabels["hostname"] = hostname;
                const name = Config.getEnv("nodered_id", null);
                if (!NoderedUtil.IsNullEmpty(name)) defaultLabels["name"] = name;
                if (NoderedUtil.IsNullEmpty(name)) defaultLabels["name"] = hostname;
                Logger.instanse.debug("WebServer.configure::configure register");
                const loggerstream = {
                    write: function (message, encoding) {
                        Logger.instanse.silly(message);
                    }
                };
                Logger.instanse.debug("WebServer.configure::setup express middleware");
                this.app.use(morgan('combined', { stream: loggerstream }));
                this.app.use(compression());
                this.app.use(express.urlencoded({ limit: '10mb', extended: true }))
                this.app.use(express.json({ limit: '10mb' }))
                this.app.use(cookieParser());
                this.app.use("/", express.static(path.join(__dirname, "/public")));

                this.app.use(passport.initialize());
                this.app.use(passport.session());
                passport.serializeUser(async function (user: any, done: any): Promise<void> {
                    done(null, user);
                });
                passport.deserializeUser(function (user: any, done: any): void {
                    done(null, user);
                });
                if (Config.tls_crt != '' && Config.tls_key != '') {
                    Logger.instanse.debug("WebServer.configure::configure ssl");
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
                            ca = Buffer.from(ca, 'base64').toString('ascii');
                        }
                        if (ca.indexOf("---") > -1) {
                            options.ca = ca;
                        }
                        // options.cert += "\n" + ca;
                    }
                    if (Config.tls_passphrase !== "") {
                        options.passphrase = Config.tls_passphrase;
                    }
                    Logger.instanse.debug("WebServer.configure::create https server");
                    server = https.createServer(options, this.app);

                    const redirapp = express();
                    // const _http = http.createServer(redirapp);
                    redirapp.get('*', function (req, res) {
                        // res.redirect('https://' + req.headers.host + req.url);
                        res.status(200).json({ status: "ok" });
                    })
                    // _http.listen(80);
                } else {
                    Logger.instanse.debug("WebServer.configure::create http server");
                    server = http.createServer(this.app);
                }
                server.on("error", (error) => {
                    Logger.instanse.error(error);
                });

                Logger.instanse.debug("WebServer.configure::configure nodered settings");
                this.settings = new nodered_settings();
                this.settings.functionExternalModules = Config.function_external_modules;
                const c = Config;
                if (Config.nodered_port > 0) {
                    this.settings.uiPort = Config.nodered_port;
                }
                else {
                    this.settings.uiPort = Config.port;
                }
                setInterval(() => {
                    const keys = Object.keys(WebServer.log_messages);
                    keys.forEach(key => {
                        const msg = WebServer.log_messages[key];
                        var from = new Date(msg.timestamp);
                        const now = new Date();
                        const seconds = (now.getTime() - from.getTime()) / 1000;
                        if (seconds > Config.otel_trace_max_node_time_seconds) {
                            const keys = Object.keys(msg.nodes);
                            for (let i = 0; i < keys.length; i++) {
                                const nodemessage = msg.nodes[keys[i]];
                                if (nodemessage.span) Logger.otel.endSpan(nodemessage.span, msg.hrtimestamp);
                                if (nodemessage.end) Logger.otel.endTimer(nodemessage.end, WebServer.openflow_nodered_node_duration, { nodetype: nodemessage.nodetype });
                            }
                            if (msg.span) {
                                Logger.otel.endSpan(msg.span, msg.hrtimestamp);
                                delete msg.span;
                            }
                            delete WebServer.log_messages[key];
                            // console.log("Ending " + key)
                        }
                    });
                }, 1000)
                this.settings.logging.customLogger = {
                    level: 'debug',
                    metrics: true,
                    handler: function (settings) {
                        return function (msg) {
                            try {
                                if (!NoderedUtil.IsNullEmpty(msg.msgid) && msg.event.startsWith("node.")) {
                                    msg.event = msg.event.substring(5);
                                    if (msg.event.endsWith(".receive")) {
                                        // if (!NoderedUtil.IsNullUndefinded(WebServer.openflow_nodered_node_activations))
                                        //     WebServer.openflow_nodered_node_activations.bind({ ...Logger.otel.defaultlabels, nodetype: msg.event }).add(1);

                                        if (WebServer.log_messages[msg.msgid] == undefined) WebServer.log_messages[msg.msgid] = new log_message(msg.msgid, msg.nodeid);
                                        const logmessage = WebServer.log_messages[msg.msgid];
                                        if (!logmessage.nodes[msg.nodeid]) logmessage.nodes[msg.nodeid] = new log_message_node(msg.nodeid);
                                        logmessage.timestamp = new Date();
                                        logmessage.hrtimestamp = hrTime();

                                        const nodemessage = logmessage.nodes[msg.nodeid];
                                        nodemessage.startspan(logmessage.span, msg.msgid);
                                        nodemessage.end = Logger.otel.startTimer();
                                    }
                                    if (msg.event.endsWith(".send")) {
                                        msg.event = msg.event.substring(0, msg.event.length - 5);
                                        if (WebServer.log_messages[msg.msgid] == undefined) WebServer.log_messages[msg.msgid] = new log_message(msg.msgid, msg.nodeid);
                                        const logmessage = WebServer.log_messages[msg.msgid];
                                        if (!logmessage.nodes[msg.nodeid]) logmessage.nodes[msg.nodeid] = new log_message_node(msg.nodeid);
                                        logmessage.timestamp = new Date();
                                        logmessage.hrtimestamp = hrTime();

                                        const nodemessage = logmessage.nodes[msg.nodeid];

                                        if (nodemessage.span) {
                                            Logger.otel.endSpan(nodemessage.span, null); delete nodemessage.span;
                                        } else {
                                            nodemessage.startspan(logmessage.span, msg.msgid);
                                            // Need to end it, since not all nodes trigger a "done" message :-/
                                            Logger.otel.endSpan(nodemessage.span, null);
                                            delete nodemessage.span;
                                            // nodemessage.span = Logger.otel.startSpan2(msg.event, msg.msgid);
                                        }
                                        if (nodemessage.end) {
                                            Logger.otel.endTimer(nodemessage.end, WebServer.openflow_nodered_node_duration, { nodetype: nodemessage.nodetype });
                                            delete nodemessage.end;
                                        } else {
                                            nodemessage.end = Logger.otel.startTimer();
                                            // Need to end it, since not all nodes trigger a "done" message :-/
                                            Logger.otel.endTimer(nodemessage.end, WebServer.openflow_nodered_node_duration, { nodetype: nodemessage.nodetype });
                                            delete nodemessage.end;
                                        }
                                    }
                                    if (msg.event.endsWith(".done")) {
                                        if (WebServer.log_messages[msg.msgid] == undefined) return;
                                        const logmessage = WebServer.log_messages[msg.msgid];
                                        if (!logmessage.nodes[msg.nodeid]) return;
                                        logmessage.timestamp = new Date();
                                        logmessage.hrtimestamp = hrTime();

                                        const nodemessage = logmessage.nodes[msg.nodeid];
                                        if (nodemessage.span) { Logger.otel.endSpan(nodemessage.span, null); delete nodemessage.span; }
                                        if (nodemessage.end) { Logger.otel.endTimer(nodemessage.end, WebServer.openflow_nodered_node_duration, { nodetype: nodemessage.nodetype }); delete nodemessage.end; }
                                    }
                                }
                            } catch (error) {
                                console.trace(error);
                                console.error(error);
                                Logger.instanse.error(error);
                            }

                        }
                    }
                }



                this.settings.userDir = path.join(Config.logpath, '.nodered-' + Config.nodered_id)
                this.settings.nodesDir = path.join(__dirname, "./nodered");

                const baseurl = (!NoderedUtil.IsNullEmpty(Config.saml_baseurl) ? Config.saml_baseurl : Config.baseurl());
                this.settings.adminAuth = await noderedcontribauthsaml.configure(baseurl, Config.saml_federation_metadata, Config.saml_issuer,
                    (profile: string | any, done: any) => {
                        const roles: string[] = profile["http://schemas.xmlsoap.org/claims/Group"];
                        if (roles !== undefined) {
                            if (Config.noderedusers !== "") {
                                if (roles.indexOf(Config.noderedusers) !== -1 || roles.indexOf(Config.noderedusers) !== -1) { profile.permissions = "read"; }
                            }
                            if (Config.noderedadmins !== "") {
                                if (roles.indexOf(Config.noderedadmins) !== -1 || roles.indexOf(Config.noderedadmins) !== -1) { profile.permissions = "*"; }
                            }
                        }
                        // profile.permissions = "*";
                        done(profile);
                    }, "", Config.saml_entrypoint, null);
                this.settings.httpNodeMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
                    noderedcontribmiddlewareauth.process(socket, req, res, next);
                };

                Logger.instanse.debug("WebServer.configure::configure nodered storageModule");
                this.settings.storageModule = new noderedcontribopenflowstorage(socket);
                const n: noderednpmrc = await this.settings.storageModule._getnpmrc();
                if (!NoderedUtil.IsNullUndefinded(n) && !NoderedUtil.IsNullUndefinded(n.catalogues)) {
                    this.settings.editorTheme.palette.catalogues = n.catalogues;
                } else {
                    this.settings.editorTheme.palette.catalogues = ['https://catalogue.nodered.org/catalogue.json'];
                }

                this.settings.ui.path = "ui";
                // this.settings.ui.middleware = new dashboardAuth();
                this.settings.ui.middleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
                    noderedcontribmiddlewareauth.process(socket, req, res, next);
                };

                this.app.set('trust proxy', 1)
                this.app.use(cookieSession({
                    name: 'session', secret: Config.cookie_secret, httpOnly: true
                }))

                Logger.instanse.debug("WebServer.configure::init nodered");
                // initialise the runtime with a server and settings
                await (RED as any).init(server, this.settings);

                // serve the editor UI from /red
                this.app.use(this.settings.httpAdminRoot, RED.httpAdmin);

                // serve the http nodes UI from /api
                this.app.use(this.settings.httpNodeRoot, RED.httpNode);

                this.app.get("/livenessprobe", (req: any, res: any, next: any): void => {
                    if (NoderedUtil.IsNullEmpty(_hostname)) _hostname = (Config.getEnv("HOSTNAME", undefined) || os.hostname()) || "unknown";
                    res.end(JSON.stringify({ "success": "true", "hostname": _hostname }));
                    res.end();
                });

                if (Config.nodered_port > 0) {
                    Logger.instanse.debug("WebServer.configure::server.listen on port " + Config.nodered_port);
                    server.listen(Config.nodered_port).on('error', function (error) {
                        Logger.instanse.error(error);
                        process.exit(404);
                    });
                }
                else {
                    Logger.instanse.debug("WebServer.configure::server.listen on port " + Config.port);
                    server.listen(Config.port).on('error', function (error) {
                        Logger.instanse.error(error);
                        process.exit(404);
                    });
                }

            } else {
                await RED.stop();
                // initialise the runtime with a server and settings
                await (RED as any).init(server, this.settings);

                // serve the editor UI from /red
                this.app.use(this.settings.httpAdminRoot, RED.httpAdmin);

                // serve the http nodes UI from /api
                this.app.use(this.settings.httpNodeRoot, RED.httpNode);
            }

            let hasErrors: boolean = true, errorCounter: number = 0, err: any;
            while (hasErrors) {
                try {
                    Logger.instanse.debug("WebServer.configure::restarting nodered ...");
                    RED.start();
                    hasErrors = false;
                } catch (error) {
                    err = error;
                    errorCounter++;
                    hasErrors = true;
                    Logger.instanse.error(error);
                }
                if (errorCounter == 10) {
                    throw err;
                } else if (hasErrors) {
                    const wait = ms => new Promise((r, j) => setTimeout(r, ms));
                    await wait(2000);
                }
            }
            return server;
        } catch (error) {
            Logger.instanse.error(error);
            Logger.instanse.error("WEBSERVER ERROR");
            // process.exit(404);
        }
        return null;
    }
    public static update_message_queue_count(cli: WebSocketClient) {
        if (!Config.prometheus_measure_queued_messages) return;
        if (!WebServer.message_queue_count) return;
        const result: any = {};
        const keys = Object.keys(cli.messageQueue);
        keys.forEach(key => {
            try {
                const qmsg = cli.messageQueue[key];
                var o = qmsg.message;
                if (typeof o === "string") o = JSON.parse(o);
                const msg: Message = o;
                if (result[msg.command] == null) result[msg.command] = 0;
                result[msg.command]++;
            } catch (error) {
                Logger.instanse.error(error);
            }
        });
        const keys2 = Object.keys(result);
        WebServer.message_queue_count.clear();
        keys2.forEach(key => {
            WebServer.message_queue_count.bind({ ...Logger.otel.defaultlabels, command: key }).update(result[key]);
        });
    }
}