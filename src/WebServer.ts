import { Span } from "@opentelemetry/api";
import compression from "compression";
import cookieParser from "cookie-parser";
import cookieSession from "cookie-session";
import express from "express";
import fs from "fs";
import http from "http";
import https from "https";
import * as ip from 'ip';
import mimetype from "mimetype";
import os from "os";
import path from "path";
import { RateLimiterMemory } from "rate-limiter-flexible";
import stream from "stream";
import webpush from "web-push";
import { Config } from "./Config.js";
import { Crypt } from "./Crypt.js";
import { Logger } from "./Logger.js";
import { LoginProvider } from "./LoginProvider.js";
import { SamlProvider } from "./SamlProvider.js";
import { WebSocketServerClient } from "./WebSocketServerClient.js";
import { BeginStream, config, DownloadResponse, EndStream, ErrorResponse, GetElementResponse, protowrap, RegisterExchangeRequest, Stream, UploadResponse, Workitem } from "@openiap/nodeapi";
import { Any } from "@openiap/nodeapi/lib/proto/google/protobuf/any.js";
import { Timestamp } from "@openiap/nodeapi/lib/proto/google/protobuf/timestamp.js";
import { GridFSBucket, ObjectId } from "mongodb";
import { dirname } from "path";
import { fileURLToPath } from "url";
import WebSocket from "ws";
import { Auth } from "./Auth.js";
import { Message } from "./Messages/Message.js";
import { flowclient } from "./proto/client.js";
import { WebSocketServer } from "./WebSocketServer.js";
import { Util, Wellknown } from "./Util.js";
import { Base, Rights, User } from "./commoninterfaces.js";
import { Payments } from "./ee/Payments.js";
const { info, warn, err } = config;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

var _hostname = "";
const safeObjectID = (s: string | number | ObjectId) => ObjectId.isValid(s) ? new ObjectId(s) : null;
const rateLimiter = async (req: express.Request, res: express.Response, next: express.NextFunction): Promise<void> => {
    if (req.originalUrl.indexOf("/oidc") > -1) {
        Logger.instanse.verbose("SKip validate for " + req.originalUrl, null, { cls: "WebServer", func: "rateLimiter" });
        return next();
    }
    try {
        if(isNaN(Config.api_rate_limit_points)) Config.api_rate_limit_points = 1000;
        if(isNaN(Config.api_rate_limit_duration)) Config.api_rate_limit_duration = 1;
        if (Config.api_rate_limit_duration != WebServer.BaseRateLimiter.duration || Config.api_rate_limit_points != WebServer.BaseRateLimiter.points) {
            Logger.instanse.info("Create new api rate limitter", span, { cls: "WebServer", func: "rateLimiter" });
            WebServer.BaseRateLimiter = new RateLimiterMemory({
                points: Config.api_rate_limit_points,
                duration: Config.api_rate_limit_duration,
            });
        }

        Logger.instanse.verbose("Validate for " + req.originalUrl, null, { cls: "WebServer", func: "rateLimiter" });
        var e = await WebServer.BaseRateLimiter.consume(WebServer.remoteip(req))
        Logger.instanse.verbose("consumedPoints: " + e.consumedPoints + " remainingPoints: " + e.remainingPoints, null, { cls: "WebServer", func: "rateLimiter" });
        next();
    } catch (error) {
        var span = Logger.otel.startSpanExpress("rateLimiter", req);
        Logger.instanse.warn("API_RATE_LIMIT consumedPoints: " + error.consumedPoints + " remainingPoints: " + error.remainingPoints + " msBeforeNext: " + error.msBeforeNext, span, { cls: "WebServer", func: "rateLimiter" });
        span.end();
        res.status(429).json({ response: "RATE_LIMIT" });
    } finally {
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
    public static wss: WebSocket.Server;
    public static async isIPBlocked(remoteip: string): Promise<boolean> {
        if (remoteip == null || remoteip == "") return false;
        remoteip = remoteip.toLowerCase();
        var blocks = await Logger.DBHelper.GetIPBlockList(null);
        if (blocks && blocks.length > 0) {
            for (var i = 0; i < blocks.length; i++) {
                var block: any = blocks[i];
                var blocklist = block.ips;
                if (blocklist && Array.isArray(blocklist)) {
                    for (var x = 0; x < blocklist.length; x++) {
                        var ipBlock = blocklist[x];
                        if (!Util.IsNullEmpty(ipBlock)) {
                            ipBlock = ipBlock.toLowerCase();
                            try {
                                if (ipBlock.indexOf("/") > -1) {
                                    if (ip.default.cidrSubnet(ipBlock).contains(remoteip)) {
                                        return true;
                                    }
                                } else {
                                    if (ip.default.isEqual(ipBlock, remoteip)) {
                                        return true;
                                    }
                                }
                            } catch (error) {
                                Logger.instanse.error(error, null, { cls: "WebServer", func: "isIPBlocked" });
                            }
                        }
                    }
                }
            }
        }
        return false;
    }

    public static async isBlocked(req: express.Request): Promise<boolean> {
        try {
            var remoteip = LoginProvider.remoteip(req);
            if (!Util.IsNullEmpty(remoteip)) {
                return this.isIPBlocked(remoteip);
            }
        } catch (error) {
            Logger.instanse.error(error, null, { cls: "WebServer", func: "isBlocked" });
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
            span?.addEvent("Create Express");
            this.app = express();
            this.app.disable("x-powered-by");
            this.app.use(async (req, res, next) => {
                if (await WebServer.isBlocked(req)) {
                    var remoteip = WebSocketServerClient.remoteip(req);
                    if (Config.log_blocked_ips) Logger.instanse.error(remoteip + " is blocked", null, { cls: "WebServer", func: "configure" });
                    try {
                        res.status(429).json({ "message": "ip blocked" });
                    } catch (error) {
                    }
                    return;
                }
                next();
            });
            var wsapiurl = "ws://localhost:" + Config.port + "/ws/v2"
            process.env.web_wsapiurl = wsapiurl;
            process.env.web_domain = Config.domain;
            process.env.web_client_id = "agent";
            process.env.web_protocol = Config.protocol;
            if (fs.existsSync(path.join(__dirname, "./public"))) {
                WebServer.webapp_file_path = path.join(__dirname, "./public");
            } else if (fs.existsSync(path.join(__dirname, "../public"))) {
                WebServer.webapp_file_path = path.join(__dirname, "../public");
            } else if (fs.existsSync(path.join(__dirname, "./public.template"))) {
                WebServer.webapp_file_path = path.join(__dirname, "./public.template");
            } else if (fs.existsSync(path.join(__dirname, "../public.template"))) {
                WebServer.webapp_file_path = path.join(__dirname, "../public.template");
            } else {
                Logger.instanse.error("Cannot find public folder", span, { cls: "WebServer", func: "configure" });
            }

            this.app.use(compression());
            this.app.use(express.urlencoded({ extended: true }));
            this.app.use(express.json({ limit: "150mb" }));

            this.app.use(cookieParser());
            this.app.set("trust proxy", 1)
            span?.addEvent("Add cookieSession");
            this.app.use(cookieSession({
                name: "session", secret: Config.cookie_secret, httpOnly: true
            }));

            if (Config.api_rate_limit) this.app.use(rateLimiter);

            this.app.get("/livenessprobe", WebServer.get_livenessprobe.bind(this));

            this.app.get("/ipblock", async (req: any, res: any, next: any): Promise<void> => {
                if (await WebServer.isBlocked(req)) {
                    var remoteip = LoginProvider.remoteip(req);
                    if (Config.log_blocked_ips) Logger.instanse.error(remoteip + " is blocked", null, { cls: "WebServer", func: "ipblock" });
                    res.statusCode = 401;
                    res.setHeader("WWW-Authenticate", `Basic realm="OpenFlow"`);
                    res.end("Unauthorized");
                    return;
                }
                return res.status(200).send({ message: "ok." });
            });

            this.app.use(function (req, res, next) {
                Logger.instanse.verbose("add for " + req.originalUrl, null, { cls: "WebServer", func: "configure" });
                // Website you wish to allow to connect
                res.setHeader("Access-Control-Allow-Origin", "*");

                // Request methods you wish to allow
                res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");

                // Request headers you wish to allow
                res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Access-Control-Allow-Headers, Authorization, x-jwt-token, openai-conversation-id, openai-ephemeral-user-id");

                // Set to true if you need the website to include cookies in the requests sent
                // to the API (e.g. in case you use sessions)
                res.setHeader("Access-Control-Allow-Credentials", "true");

                // Disable Caching
                res.header("Cache-Control", "private, no-cache, no-store, must-revalidate");
                res.header("Expires", "-1");
                res.header("Pragma", "no-cache");

                if (req.originalUrl == "/me") {
                    res.redirect("/oidc/me")
                    return next();
                }

                // Grafana hack
                if (req.originalUrl == "/oidc/me" && req.method == "OPTIONS") {
                    return res.send("ok");
                }
                if (req.originalUrl.indexOf("/oidc") > -1) return next();

                next();
            });

            //setting vapid keys details
            if (!Util.IsNullEmpty(Config.wapid_pub) && !Util.IsNullEmpty(Config.wapid_key)) {
                span?.addEvent("Setting openflow for WebPush");
                var mail = Config.wapid_mail;
                if (Util.IsNullEmpty(mail)) mail = "me@email.com"
                webpush.setVapidDetails("mailto:" + mail, Config.wapid_pub, Config.wapid_key);
                this.app.post("/webpushsubscribe", async (req, res) => {
                    var subspan = Logger.otel.startSpanExpress("webpushsubscribe", req);
                    try {
                        const subscription = req.body;
                        span?.setAttribute("subscription", JSON.stringify(subscription));
                        if (Util.IsNullUndefinded(subscription) && Util.IsNullEmpty(subscription.jwt)) {
                            Logger.instanse.error("Received invalid subscription request", null, { cls: "WebServer", func: "webpushsubscribe" });
                            return res.status(500).json({ "error": "no subscription" });
                        }
                        const jwt = subscription.jwt;
                        const tuser: User = await Auth.Token2User(jwt, span);
                        if (Util.IsNullUndefinded(tuser)) {
                            Logger.instanse.error("jwt is invalid", null, { cls: "WebServer", func: "webpushsubscribe" });
                            return res.status(500).json({ "error": "no subscription" });
                        }
                        delete subscription.jwt;
                        if (Util.IsNullEmpty(subscription._type)) subscription._type = "unknown";
                        subscription.userid = tuser._id;
                        subscription.name = tuser.name + " " + subscription._type + " " + subscription.host;
                        await Config.db.InsertOrUpdateOne(subscription, "webpushsubscriptions", "userid,_type,host,endpoint", 1, true, jwt, span);
                        Logger.instanse.info("Registered webpush subscription for " + tuser.name, span, { cls: "WebServer", func: "webpushsubscribe" });
                        res.status(201).json({})
                    } catch (error) {
                        Logger.instanse.error(error, subspan, { cls: "WebServer", func: "webpushsubscribe" });
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
            span?.addEvent("Configure FormioEP");

            try {
                let FormioEPProxy: any = await import("./ee/FormioEP.js");
                await FormioEPProxy.FormioEP.configure(this.app, baseurl);
            } catch (error) {
                Logger.instanse.error(error, span, { cls: "WebServer", func: "configure" });
            }
            span?.addEvent("Configure SamlProvider");
            await SamlProvider.configure(this.app, baseurl);
            WebServer.server = null;
            if (Config.tls_crt != "" && Config.tls_key != "") {
                let options: any = {
                    cert: Config.tls_crt,
                    key: Config.tls_key
                };
                if (Config.tls_crt.indexOf("---") == -1) {
                    options = {
                        cert: Buffer.from(Config.tls_crt, "base64").toString("ascii"),
                        key: Buffer.from(Config.tls_key, "base64").toString("ascii")
                    };
                }
                let ca: string = Config.tls_ca;
                if (ca !== "") {
                    if (ca.indexOf("---") === -1) {
                        ca = Buffer.from(Config.tls_ca, "base64").toString("ascii");
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

            WebServer.wss = new WebSocket.Server({ server: WebServer.server });
            await protowrap.init();

            config.doDumpMesssages = false;
            config.DoDumpToConsole = false;

            return WebServer.server;
        } catch (error) {
            Logger.instanse.error(error, span, { cls: "WebServer", func: "configure" });
            process.exit(404);
            return null;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    static webapp_file_path = "";
    static async addWebserverRoutes() {
        this.app.get("/", (req, res) => {
            res.status(402).redirect("/ui/")
        });
        if (fs.existsSync(path.join(WebServer.webapp_file_path, 'handler.js'))) {
            const handler = await import(path.join(WebServer.webapp_file_path, 'handler.js'));

            this.app.use((req, res, next) => {
                if (req.url != null && req.url.startsWith("/ui")) {
                    handler.handler(req, res, next)
                } else {
                    next();
                }
            });
        } else {
            this.app.use('/ui', express.static(WebServer.webapp_file_path));
            this.app.get('/ui/*', (req, res, next) => {
                // Only redirect to index.html if the request accepts HTML, this prevents redirection for missing assets like .js, .css, images, etc.
                if (req.accepts('html')) {
                    res.setHeader('Content-Type', 'text/html');
                    res.sendFile(path.join(WebServer.webapp_file_path, 'index.html'));
                } else {
                    // Optionally, send a 404 for unknown types if the file is not found
                    // res.status(404).send('Not Found');
                    return next();
                }
            });
        }
    }
    public static Listen() {
        WebServer.server.listen(Config.port).on("error", function (error) {
            Logger.instanse.error(error, null, { cls: "WebServer", func: "Listen" });
            if (Config.NODE_ENV == "production") {
                WebServer.server.close();
                process.exit(404);
            }
        });
        if (Config.grpc_keepalive_time_ms > -1) protowrap.grpc_server_options["grpc.keepalive_time_ms"] = Config.grpc_keepalive_time_ms;
        if (Config.grpc_keepalive_timeout_ms > -1) protowrap.grpc_server_options["grpc.keepalive_timeout_ms"] = Config.grpc_keepalive_timeout_ms;
        if (Config.grpc_http2_min_ping_interval_without_data_ms > -1) protowrap.grpc_server_options["grpc.http2.min_ping_interval_without_data_ms"] = Config.grpc_http2_min_ping_interval_without_data_ms;
        if (Config.grpc_max_connection_idle_ms > -1) protowrap.grpc_server_options["grpc.max_connection_idle_ms"] = Config.grpc_max_connection_idle_ms;
        if (Config.grpc_max_connection_age_ms > -1) protowrap.grpc_server_options["grpc.max_connection_age_ms"] = Config.grpc_max_connection_age_ms;
        if (Config.grpc_max_connection_age_grace_ms > -1) protowrap.grpc_server_options["grpc.max_connection_age_grace_ms"] = Config.grpc_max_connection_age_grace_ms;
        if (Config.grpc_http2_max_pings_without_data > -1) protowrap.grpc_server_options["grpc.http2.max_pings_without_data"] = Config.grpc_http2_max_pings_without_data;
        if (Config.grpc_keepalive_permit_without_calls > -1) protowrap.grpc_server_options["grpc.keepalive_permit_without_calls"] = Config.grpc_keepalive_permit_without_calls;
        if (Config.grpc_max_receive_message_length > -1) protowrap.grpc_server_options["grpc.max_receive_message_length"] = Config.grpc_max_receive_message_length;
        if (Config.grpc_max_send_message_length > -1) protowrap.grpc_server_options["grpc.max_send_message_length"] = Config.grpc_max_send_message_length;


        var servers = [];
        servers.push(protowrap.serve("pipe", this.onClientConnected, config.defaultsocketport, "testpipe", WebServer.wss, WebServer.app, WebServer.server, flowclient));
        servers.push(protowrap.serve("socket", this.onClientConnected, config.defaultsocketport, null, WebServer.wss, WebServer.app, WebServer.server, flowclient));
        servers.push(protowrap.serve("ws", this.onClientConnected, Config.port, "/ws/v2", WebServer.wss, WebServer.app, WebServer.server, flowclient));
        servers.push(protowrap.serve("grpc", this.onClientConnected, config.defaultgrpcport, null, WebServer.wss, WebServer.app, WebServer.server, flowclient));
        servers.push(protowrap.serve("rest", this.onClientConnected, Config.port, "/api/v2", WebServer.wss, WebServer.app, WebServer.server, flowclient));
        config.DoDumpToConsole = false;
        Logger.instanse.info("Listening on " + Config.baseurl(), null, { cls: "WebServer", func: "Listen" });
        Logger.instanse.info("grpc listening on grpc://" + Config.domain + ":" + config.defaultgrpcport, null, { cls: "WebServer", func: "Listen" });
        WebServer.addWebserverRoutes().catch((error) => {
            Logger.instanse.error(error, null, { cls: "WebServer", func: "Listen" });
        });
    }
    public static async ReceiveFileContent(client: flowclient, rid: string, msg: any) {
        return new Promise<string>((resolve, reject) => {
            const bucket = new GridFSBucket(Config.db.db);
            var metadata = new Base();
            metadata._acl = [];
            metadata._createdby = Wellknown.root.name;
            metadata._createdbyid = Wellknown.root._id;
            metadata._modifiedby = Wellknown.root.name;
            metadata._modifiedbyid = Wellknown.root._id;
            if (msg.metadata != null && msg.metadata != "") {
                try {
                    // is metadata a string ?
                    if (typeof msg.metadata == "string") {
                        metadata = Object.assign(metadata, JSON.parse(msg.metadata));
                    }
                } catch (error) {
                    Logger.instanse.error(error, null, { cls: "WebServer", func: "ReceiveFileContent" });
                }
            }
            if (metadata.name == null || metadata.name == "") metadata.name = msg.filename;
            if (client.user) {
                if (client.user._id == Wellknown.guest._id && Config.enable_guest_file_upload == false) {
                    reject(new Error("Guests are not allowed to upload files"));
                    return;
                }
                Base.addRight(metadata, client.user._id, client.user.name, [Rights.full_control]);
                metadata._createdby = client.user.name;
                metadata._createdbyid = client.user._id;
                metadata._modifiedby = client.user.name;
                metadata._modifiedbyid = client.user._id;
            }
            metadata._created = new Date(new Date().toISOString());
            metadata._modified = metadata._created;

            Base.addRight(metadata, Wellknown.filestore_admins._id, Wellknown.filestore_admins.name, [Rights.full_control]);
            if (!Config.multi_tenant) {
                Base.addRight(metadata, Wellknown.filestore_users._id, Wellknown.filestore_users.name, [Rights.read]);
            }


            const rs = new stream.Readable;
            rs._read = () => { };
            const s = protowrap.SetStream(client, rs, rid)
            if (Util.IsNullEmpty(msg.mimetype)) {
                msg.mimetype = mimetype.lookup(msg.filename);
            }

            let uploadStream = bucket.openUploadStream(msg.filename, { contentType: msg.mimetype, metadata: metadata });
            let id = uploadStream.id
            uploadStream.on("finish", () => {
                resolve(id.toString());
            })
            uploadStream.on("error", (err) => {
                reject(err);
            });
            rs.pipe(uploadStream);
        });
    }
    static sendFileContent(client: flowclient, rid, id, collectionname): Promise<void> {
        return new Promise<void>(async (resolve, reject) => {
            if (collectionname != null && collectionname != "") {
                if (collectionname.endsWith(".files")) {
                    collectionname = collectionname.substring(0, collectionname.length - 6);
                }
            } else {
                collectionname = "fs";
            }
            const bucket = new GridFSBucket(Config.db.db, { bucketName: collectionname });
            let downloadStream = bucket.openDownloadStream(safeObjectID(id));
            const data = Any.create({ type_url: "type.googleapis.com/openiap.BeginStream", value: BeginStream.encode(BeginStream.create()).finish() })
            protowrap.sendMesssag(client, { rid, command: "beginstream", data: data }, null, true);
            downloadStream.on("data", (chunk) => {
                const data = Any.create({ type_url: "type.googleapis.com/openiap.Stream", value: Stream.encode(Stream.create({ data: chunk })).finish() })
                protowrap.sendMesssag(client, {
                    rid, command: "stream",
                    data: data
                }, null, true);
            });
            downloadStream.on("end", () => {
                const data = Any.create({ type_url: "type.googleapis.com/openiap.EndStream", value: EndStream.encode(EndStream.create()).finish() })
                protowrap.sendMesssag(client, { rid, command: "endstream", data: data }, null, true);
                resolve();
            });
            downloadStream.on("error", (err) => {
                reject(err);
            });
        });
    }

    public static async ProcessMessage(req: any, tuser: User, jwt: string): Promise<any> {
        const client: any = { user: tuser, jwt: jwt };
        const msg = new Message();
        const urlPath = req.path;
        msg.command = urlPath.replace("/rest/v1/", "").toLowerCase();

        if (msg.command == "updatedocument") {
            msg.command = "updatemany"
        }
        if (msg.command == "unregisterqueue") {
            msg.command = "closequeue"
        }
        if (msg.command == "pushworkitem") {
            msg.command = "addworkitem"
        }
        if (msg.command == "pushworkitems") {
            msg.command = "addworkitems"
        }

        msg.id = Util.GetUniqueIdentifier();
        msg.jwt = jwt;
        msg.data = req.body;
        msg.tuser = tuser;
        msg.clientagent = req.headers["user-agent"];
        msg.clientversion = "0.0.1";
        var result = await msg.Process(client);
        return result
    }
    public static async onMessage(client: flowclient, message: any) {
        let command, msg, reply;
        try {
            [command, msg, reply] = protowrap.unpack(message);
            if (message.command == "") throw new Error("Invalid/empty command");
            if (command == "registerexchange") {
                msg = RegisterExchangeRequest.decode(message.data.value);
            }
        } catch (error) {
            err(error);
            message.command = "error";
            if (typeof error == "string") error = new Error(error);
            const data = Any.create({ type_url: "type.googleapis.com/openiap.ErrorResponse", value: ErrorResponse.encode(ErrorResponse.create(error)).finish() })
            message.data = data
            message.rid = message.id;
            return message;
        }
        try {
            if (command == "noop" || command == "pong") {
                reply.command = "noop";
            } else if (command == "queuemessagereply") {
                reply.command = "noop";
            } else if (command == "ping") {
                reply.command = "pong";
            } else if (command == "getelement") {
                if (Util.IsNullUndefinded(msg)) msg = { xpath: "" };
                msg.xpath = "Did you say " + msg?.xpath + " ?";
                reply.data = GetElementResponse.encode(GetElementResponse.create(msg)).finish()
            } else if (command == "send") {
                let len = msg.count;
                reply.command = "getelement"
                for (var i = 1; i < len; i++) {
                    const data = Any.create({ type_url: "type.googleapis.com/openiap.GetElementResponse", value: GetElementResponse.encode(GetElementResponse.create({ xpath: "test" + (i + 1) })).finish() })
                    var payload = {
                        ...reply,
                        data: data
                    };
                    protowrap.sendMesssag(client, payload, null, true);
                }
                const data = Any.create({ type_url: "type.googleapis.com/openiap.GetElementResponse", value: GetElementResponse.encode(GetElementResponse.create({ xpath: "test1" })).finish() })
                reply.data = data

            } else if (command == "upload") {
                var id = await WebServer.ReceiveFileContent(client, reply.rid, msg)
                reply.command = "uploadreply"
                const data = Any.create({ type_url: "type.googleapis.com/openiap.UploadResponse", value: UploadResponse.encode(UploadResponse.create({ id, filename: msg.filename })).finish() })
                reply.data = data
            } else if (command == "download") {
                if ((msg.id && msg.id != "") || (msg.filename != null && msg.filename != "")) {
                    reply.command = "downloadreply"
                    let rows = [];
                    if (msg.collectionname == null || msg.collectionname == "" || msg.collectionname == "fs" || msg.collectionname == "fs.files") {
                        msg.collectionname = "fs.files";
                    }
                    if (msg.id != null && msg.id != "") {
                        rows = await Config.db.query({ query: { _id: safeObjectID(msg.id) }, top: 1, collectionname: msg.collectionname, jwt: client.jwt }, null);
                    } else if (msg.filename != null && msg.filename != "") {
                        rows = await Config.db.query({ query: { filename: msg.filename }, top: 1, collectionname: msg.collectionname, jwt: client.jwt }, null);
                    }
                    if ((msg.collectionname == null || msg.collectionname == "" || msg.collectionname == "fs" || msg.collectionname == "fs.files") && (msg.id != null && msg.id != "")) {
                        if (rows.length == 0) {
                            const rows2 = await Config.db.query({ query: { fileid: msg.id, "_type": "package" }, top: 1, collectionname: "agents", jwt: client.jwt }, null);
                            if (rows2.length > 0) {
                                rows = await Config.db.query({ query: { _id: safeObjectID(msg.id) }, top: 1, collectionname: "files", jwt: Crypt.rootToken() }, null);
                            }
                        }
                    }
                    if (rows.length > 0) {
                        result = rows[0];
                        await WebServer.sendFileContent(client, reply.rid, result._id, msg.collectionname)
                        result = rows[0];
                        reply.data = Any.create({
                            type_url: "type.googleapis.com/openiap.DownloadResponse",
                            value: DownloadResponse.encode(DownloadResponse.create({
                                filename: result.filename,
                                mimetype: result.contentType,
                                id: result._id.toString()
                            })).finish()
                        })

                    } else {
                        throw new Error("Access denied, downloading " + msg.id)
                    }
                } else {
                    throw new Error("Access denied (No id)")
                }
            } else if (command == "clientconsole") {
                throw new Error("Access denied")
            } else if (command == "console") {
                throw new Error("Access denied")
            } else {
                if (message.command == "updatedocument") {
                    msg = JSON.parse(JSON.stringify(msg)) // un-wrap properties or we cannot JSON.stringify it later
                    msg.item = msg.document;
                    delete msg.document;
                    message.command = "updatemany"
                }
                if (message.command == "unregisterqueue") {
                    msg = JSON.parse(JSON.stringify(msg)) // un-wrap properties or we cannot JSON.stringify it later
                    message.command = "closequeue"
                }
                if (message.command == "pushworkitem") {
                    msg = JSON.parse(JSON.stringify(msg)) // un-wrap properties or we cannot JSON.stringify it later
                    if (typeof msg.payload == "string") msg.payload = JSON.parse(msg.payload); // new style to new 
                    message.command = "addworkitem"
                }
                if (message.command == "pushworkitems") {
                    msg = JSON.parse(JSON.stringify(msg)) // un-wrap properties or we cannot JSON.stringify it later
                    if (msg.items != null) {
                        msg.items.forEach(wi => {
                            if (typeof wi.payload == "string") wi.payload = JSON.parse(wi.payload); // new style to new 
                        });
                    }
                    message.command = "addworkitems"
                }
                if (message.command == "updateworkitem") {
                    if (msg.workitem && typeof msg.workitem.payload == "string") msg.workitem.payload = JSON.parse(msg.workitem.payload);
                    if (msg.workitem && msg.workitem.files && msg.workitem.files.length > 0) {
                        if (msg.files && msg.files.length > 0) {
                            msg.files.forEach(f => {
                                msg.workitem.files.push(f)
                            });
                        }
                        delete msg.files;
                    } else if (msg.workitem && msg.files && msg.files.length > 0) {
                        msg.files.forEach(f => {
                            msg.workitem.files.push(f)
                        });
                        delete msg.files;
                    }
                    if (msg.workitem) msg = Object.assign(msg.workitem, msg);
                    delete msg.workitem;
                    if (msg._id == null && msg._id == "" && msg.Id != null && msg.Id != "") msg._id = msg.Id;
                    delete msg.Id;
                }
                if (message.command == "signin") {
                    msg.clientagent = msg.agent;
                    msg.clientversion = msg.version;
                }
                var _msg = Message.fromjson({ ...message, data: msg });
                var result = await _msg.Process(client as any);
                if (message.rid != null && message.rid != "" && result.command == "error") {
                    return null;
                }
                reply.command = result.command + "reply"
                if (reply.command == "errorreply") reply.command = "error";
                if (reply.command == "updatemanyreply") reply.command = "updatedocumentreply";
                if (reply.command == "closequeuereply") reply.command = "unregisterqueuereply";
                if (reply.command == "addworkitemreply") {
                    reply.command = "pushworkitemreply";
                    reply.workitem = result.result;
                }
                if (reply.command == "addworkitemsreply") {
                    reply.command = "pushworkitemsreply";
                }
                let res = result.data;
                if (res == null || res == "") res = "{}"
                if (typeof res == "string") res = JSON.parse(res);
                delete res.password;
                if (reply.command == "addworkitemqueuereply") {
                    res.workitemqueue = res.result;
                    delete res.result;
                }
                if (reply.command == "updateworkitemqueuereply") {
                    res.workitemqueue = res.result;
                    delete res.result;
                }
                if (message.command == "signin") {
                    if (msg.ping != null) {
                        client.doping = msg.ping;
                    }
                    res.config = await LoginProvider.config();
                    if (res.config == null) res.config = {};
                    res.config.openflow_uniqueid = Config.openflow_uniqueid;
                    if (Config.otel_trace_interval > 0) res.config.otel_trace_interval = Config.otel_trace_interval;
                    if (Config.otel_metric_interval > 0) res.config.otel_metric_interval = Config.otel_metric_interval;
                    res.config.enable_analytics = Config.enable_analytics;
                    res.config.otel_trace_url = Config.otel_trace_url;
                    res.config.otel_metric_url = Config.otel_metric_url;
                    res.config.otel_log_url = Config.otel_log_url;
                    res.config.otel_trace_interval = Config.otel_trace_interval;
                    res.config.otel_metric_interval = Config.otel_metric_interval;
                    res.config = JSON.stringify(res.config);
                }
                if (result.command == "query" || result.command == "aggregate" || result.command == "listcollections") {
                    if (res.results == null && res.result != null) {
                        res.results = res.result;
                        delete res.result;
                    }
                }
                if (result.command == "addworkitem" || result.command == "pushworkitem" || result.command == "updateworkitem" || result.command == "popworkitem") {
                    res.workitem = res.result;
                    if (res.workitem && res.workitem.errormessage) {
                        if (typeof res.workitem.errormessage !== "string") {
                            res.workitem.errormessage = JSON.stringify(res.workitem.errormessage);
                        }

                    }
                    delete res.result;
                    if (res.workitem != null) {
                        const wi: Workitem = res.workitem;
                        if (wi.lastrun != null) {
                            const timeMS = new Date(wi.lastrun);
                            var dt = Timestamp.create();
                            // @ts-ignore
                            dt.seconds = timeMS / 1000;
                            // @ts-ignore
                            dt.nanos = (timeMS % 1000) * 1e6;
                            // @ts-ignore
                            wi.lastrun = dt;
                        }
                        if (wi.nextrun != null) {
                            const timeMS = new Date(wi.nextrun);
                            var dt = Timestamp.create();
                            // @ts-ignore
                            dt.seconds = timeMS / 1000;
                            // @ts-ignore
                            dt.nanos = (timeMS % 1000) * 1e6;
                            // @ts-ignore
                            wi.nextrun = dt;
                        }
                    }

                }
                if (reply.command == "pushworkitemsreply") {
                    res.workitems = res.items;
                    if (res.workitem && res.workitem.errormessage) {
                        if (typeof res.workitem.errormessage !== "string") {
                            res.workitem.errormessage = JSON.stringify(res.workitem.errormessage);
                        }

                    }
                    delete res.items;
                }
                if (result.command == "popworkitem") {
                    let includefiles = msg.includefiles || false;
                    // @ts-ignore
                    let compressed = msg.compressed || false;
                    if (res.workitem && includefiles == true) {
                        for (var i = 0; i < res.workitem.files.length; i++) {
                            var file = res.workitem.files[i];
                            var buf: Buffer = await _msg._GetFile(file._id, compressed);
                            // @ts-ignore
                            file.compressed = compressed;
                            // @ts-ignore
                            file.file = buf;
                            // @ts-ignore
                            res.workitem.file = buf;
                        }
                    }
                }
                if (res.result && result.command != "createindex") res.result = JSON.stringify(res.result);
                if (res.workitem && !Util.IsNullUndefinded(res.workitem.payload)) {
                    res.workitem.payload = JSON.stringify(res.workitem.payload);
                }
                if (res.workitems) {
                    for (let i = 0; i < res.workitems.length; i++) {
                        const wi = res.workitems[i];
                        if (!Util.IsNullUndefinded(wi.payload)) {
                            wi.payload = JSON.stringify(wi.payload);
                        }
                    }
                }
                if (res.results && reply.command != "distinctreply") res.results = JSON.stringify(res.results);
                if (reply.command == "queuemessagereply") res.data = JSON.stringify(res.data);
                reply.data = protowrap.pack(reply.command, res);
            }
        } catch (error) {
            err(error);
            reply.command = "error";
            if (typeof error == "string") error = new Error(error);
            const data = Any.create({ type_url: "type.googleapis.com/openiap.ErrorResponse", value: ErrorResponse.encode(ErrorResponse.create(error)).finish() })
            reply.data = data
        }
        return reply;
    }
    public static async onClientConnected(client: any) {
        client.onConnected = WebServer.onConnected;
        client.onDisconnected = WebServer.onDisconnected;
        client.onMessage = WebServer.onMessage;
        WebSocketServer._clients.push(client);
        if (client.ping != null) {
            client.ping(null);
        }
        info("Client connected, client count " + WebSocketServer._clients.length);
    }
    public static async onConnected(client: flowclient) {
    }
    public static async onDisconnected(client: flowclient, error: any) {
        client.Close();
        var index = WebSocketServer._clients.indexOf(client as any);
        if (index > -1) {
            WebSocketServer._clients.splice(index, 1);
        }
        if (error) {
            err("Disconnected client, client count " + WebSocketServer._clients.length + " " + (error.message || error) as any);
        } else {
            info("Disconnected client, client count " + WebSocketServer._clients.length);
        }
    }
    static async get_crashme(req: any, res: any, next: any): Promise<void> {
        const remoteip = LoginProvider.remoteip(req);
        if (remoteip != "127.0.0.1" && remoteip != "::ffff:127.0.0.1") {
            // Add security check at some point to only allow from localhost !!!
            res.statusCode = 500;
            return res.end(JSON.stringify({ "error": "Go away !!!", "remoteip": remoteip, "hostname": _hostname, dt: new Date() }));
        }
        let array = [];
        while (true) {
            array.push(new Array(10000000).join("x"));
            await new Promise(resolve => { setTimeout(resolve, 1000) });
        }
    }

    static async get_heapdump(req: any, res: any, next: any): Promise<void> {
        const remoteip = LoginProvider.remoteip(req);
        if (remoteip != "127.0.0.1" && remoteip != "::ffff:127.0.0.1") {
            // Add security check at some point to only allow from localhost !!!
            res.statusCode = 500;
            return res.end(JSON.stringify({ "error": "Go away !!!", "remoteip": remoteip, "hostname": _hostname, dt: new Date() }));
        }
        await Logger.otel.createheapdump(null);
        res.end(JSON.stringify({ "success": "true", "remoteip": remoteip, "hostname": _hostname, dt: new Date() }));
        res.end();
    }
    static get_livenessprobe(req: any, res: any, next: any): void {
        // let span = Logger.otel.startSpanExpress("get_livenessprobe", req)
        try {
            // const [traceId, spanId] = Logger.otel.GetTraceSpanId(span);
            if (Util.IsNullEmpty(_hostname)) _hostname = (process.env.HOSTNAME || os.hostname()) || "unknown";
            // res.end(JSON.stringify({ "success": "true", "hostname": _hostname, dt: new Date(), traceId, spanId }));
            res.end(JSON.stringify({ "success": "true", "hostname": _hostname, dt: new Date() }));
            res.end();
            // @ts-ignore
            // span.setStatus({ code: 200 });
        } catch (error) {
            Logger.instanse.error(error, null, { cls: "WebServer", func: "get_livenessprobe" });
            // Logger.instanse.error(error, span, { cls: "WebServer", func: "get_livenessprobe" });
            // span.setStatus({
            //     // @ts-ignore
            //     code: 500,
            //     message: error instanceof Error ? error.message : undefined,
            // });
        } finally {
            // span.end();
        }
    }
}