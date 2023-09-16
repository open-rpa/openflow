var mimetype = require('mimetype');
import * as  stream from "stream";
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
import { Base, InsertOrUpdateOneMessage, NoderedUtil, Rights, TokenUser, WellknownIds } from "@openiap/openflow-api";
const { RateLimiterMemory } = require('rate-limiter-flexible')
import { Span } from "@opentelemetry/api";
import { Logger } from "./Logger";
import { WebSocketServerClient } from "./WebSocketServerClient";
import { Crypt } from "./Crypt";

import * as WebSocket from "ws";
import { flowclient } from "./proto/client";
import { WebSocketServer } from "./WebSocketServer";
import { Message } from "./Messages/Message";
import { GridFSBucket, ObjectId } from "mongodb";
import { config, protowrap, GetElementResponse, UploadResponse, DownloadResponse, BeginStream, EndStream, Stream, ErrorResponse, openiap, apiinstrumentation, Workitem } from "@openiap/nodeapi";
const { info, warn, err } = config;
import { Any } from "@openiap/nodeapi/lib/proto/google/protobuf/any";
import { Timestamp } from "@openiap/nodeapi/lib/proto/google/protobuf/timestamp";
import { trace, context } from '@opentelemetry/api';


var _hostname = "";
const safeObjectID = (s: string | number | ObjectId) => ObjectId.isValid(s) ? new ObjectId(s) : null;
const rateLimiter = async (req: express.Request, res: express.Response, next: express.NextFunction): Promise<void> => {
    if (req.originalUrl.indexOf('/oidc') > -1) {
        Logger.instanse.verbose("SKip validate for " + req.originalUrl, null);
        // Logger.instanse.info("Ignore for " + req.originalUrl, null);
        return next();
    }
    try {
        Logger.instanse.verbose("Validate for " + req.originalUrl, null);
        var e = await WebServer.BaseRateLimiter.consume(WebServer.remoteip(req))
        Logger.instanse.verbose("consumedPoints: " + e.consumedPoints + " remainingPoints: " + e.remainingPoints, null);
        next();
    } catch (error) {
        var span = Logger.otel.startSpanExpress("rateLimiter", req);
        Logger.instanse.warn("API_RATE_LIMIT consumedPoints: " + error.consumedPoints + " remainingPoints: " + error.remainingPoints + " msBeforeNext: " + error.msBeforeNext, span);
        span.end();
        res.status(429).json({ response: 'RATE_LIMIT' });
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
    public static webpush = require('web-push');
    public static wss: WebSocket.Server;
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
            // this.app.use(express.urlencoded({ extended: true }));
            // this.app.use(express.json());
            // this.app.use(express.urlencoded({ extended: true, limit: '50mb', parameterLimit:50000 }));
            // this.app.use(express.json({limit: '50mb'}));
            this.app.use(express.urlencoded({ extended: true }));
            this.app.use(express.json({limit: '150mb'}));

            this.app.use(cookieParser());
            this.app.set('trust proxy', 1)
            span?.addEvent("Add cookieSession");
            this.app.use(cookieSession({
                name: "session", secret: Config.cookie_secret, httpOnly: true
            }));
            this.app.use(flash());
            if (Config.api_rate_limit) this.app.use(rateLimiter);

            this.app.get("/livenessprobe", WebServer.get_livenessprobe.bind(this));

            // this.app.get("/heapdump", WebServer.get_heapdump.bind(this))
            // this.app.get("/crashme", WebServer.get_crashme.bind(this))

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

            this.app.use(function (req, res, next) {
                Logger.instanse.verbose("add for " + req.originalUrl, null);
                // Website you wish to allow to connect
                res.setHeader('Access-Control-Allow-Origin', '*');

                // Request methods you wish to allow
                res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');

                // Request headers you wish to allow
                res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Access-Control-Allow-Headers, Authorization, x-jwt-token, openai-conversation-id, openai-ephemeral-user-id");

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

                next();
            });

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

            WebServer.wss = new WebSocket.Server({ server: WebServer.server });
            await protowrap.init();

            config.doDumpMesssages = false;
            config.DoDumpToConsole = false;
            return WebServer.server;
        } catch (error) {
            Logger.instanse.error(error, span);
            // WebServer.server.close();
            process.exit(404);
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
        if(Config.grpc_keepalive_time_ms > -1) protowrap.grpc_server_options['grpc.keepalive_time_ms'] = Config.grpc_keepalive_time_ms;
        if(Config.grpc_keepalive_timeout_ms > -1) protowrap.grpc_server_options['grpc.keepalive_timeout_ms'] = Config.grpc_keepalive_timeout_ms;
        if(Config.grpc_http2_min_ping_interval_without_data_ms > -1) protowrap.grpc_server_options['grpc.http2.min_ping_interval_without_data_ms'] = Config.grpc_http2_min_ping_interval_without_data_ms;
        if(Config.grpc_max_connection_idle_ms > -1) protowrap.grpc_server_options['grpc.max_connection_idle_ms'] = Config.grpc_max_connection_idle_ms;
        if(Config.grpc_max_connection_age_ms > -1) protowrap.grpc_server_options['grpc.max_connection_age_ms'] = Config.grpc_max_connection_age_ms;
        if(Config.grpc_max_connection_age_grace_ms > -1) protowrap.grpc_server_options['grpc.max_connection_age_grace_ms'] = Config.grpc_max_connection_age_grace_ms;
        if(Config.grpc_http2_max_pings_without_data > -1) protowrap.grpc_server_options['grpc.http2.max_pings_without_data'] = Config.grpc_http2_max_pings_without_data;
        if(Config.grpc_keepalive_permit_without_calls > -1) protowrap.grpc_server_options['grpc.keepalive_permit_without_calls'] = Config.grpc_keepalive_permit_without_calls;
        if(Config.grpc_max_receive_message_length > -1) protowrap.grpc_server_options['grpc.max_receive_message_length'] = Config.grpc_max_receive_message_length;
        if(Config.grpc_max_send_message_length > -1) protowrap.grpc_server_options['grpc.max_send_message_length'] = Config.grpc_max_send_message_length;

      
        var servers = [];
        servers.push(protowrap.serve("pipe", this.onClientConnected, config.defaultsocketport, "testpipe", WebServer.wss, WebServer.app, WebServer.server, flowclient));
        servers.push(protowrap.serve("socket", this.onClientConnected, config.defaultsocketport, null, WebServer.wss, WebServer.app, WebServer.server, flowclient));
        servers.push(protowrap.serve("ws", this.onClientConnected, Config.port, "/ws/v2", WebServer.wss, WebServer.app, WebServer.server, flowclient));
        servers.push(protowrap.serve("grpc", this.onClientConnected, config.defaultgrpcport, null, WebServer.wss, WebServer.app, WebServer.server, flowclient));
        servers.push(protowrap.serve("rest", this.onClientConnected, Config.port, "/api/v2", WebServer.wss, WebServer.app, WebServer.server, flowclient));
        config.DoDumpToConsole = false;
        Logger.instanse.info("Listening on " + Config.baseurl(), null);
        Logger.instanse.info("grpc listening on grpc://" + Config.domain + ":" + config.defaultgrpcport, null);
    }
    public static async ReceiveFileContent(client: flowclient, rid:string, msg: any) {
        return new Promise<string>((resolve, reject) => {
            const bucket = new GridFSBucket(Config.db.db);
            var metadata = new Base();
            metadata.name = msg.filename;
            metadata._acl = [];
            metadata._createdby = "root";
            metadata._createdbyid = WellknownIds.root;
            metadata._modifiedby = "root";
            metadata._modifiedbyid = WellknownIds.root;
            if(client.user)
            {
                Base.addRight(metadata, client.user._id , client.user.name, [Rights.full_control]);
                metadata._createdby = client.user.name;
                metadata._createdbyid = client.user._id;
                metadata._modifiedby = client.user.name;
                metadata._modifiedbyid = client.user._id;
            }
            metadata._created = new Date(new Date().toISOString());
            metadata._modified = metadata._created;
    
            Base.addRight(metadata, WellknownIds.filestore_users, "filestore users", [Rights.read]);
    
            const rs = new stream.Readable;
            rs._read = () => { };
            const s = protowrap.SetStream(client, rs, rid)
            if (NoderedUtil.IsNullEmpty(msg.mimetype)) {
                msg.mimetype = mimetype.lookup(msg.filename);
            }
   
            let uploadStream = bucket.openUploadStream(msg.filename, { contentType: msg.mimetype, metadata: metadata });
            let id = uploadStream.id
            uploadStream.on('finish', ()=> {
                resolve(id.toString());
            })
            uploadStream.on('error', (err)=> {
                reject(err);
            });
            rs.pipe(uploadStream);
        });
    }
    static sendFileContent(client:flowclient, rid, id):Promise<void> {
        return new Promise<void>(async (resolve, reject) => {
            const bucket = new GridFSBucket(Config.db.db);
            let downloadStream = bucket.openDownloadStream(safeObjectID(id));
            const data = Any.create({type_url: "type.googleapis.com/openiap.BeginStream", value: BeginStream.encode(BeginStream.create()).finish() })
            protowrap.sendMesssag(client, { rid, command: "beginstream", data: data }, null, true);
            downloadStream.on('data', (chunk) => {
                const data = Any.create({type_url: "type.googleapis.com/openiap.Stream", value: Stream.encode(Stream.create({data: chunk})).finish() })
                protowrap.sendMesssag(client, { rid, command: "stream", 
                data: data }, null, true);
            });
            downloadStream.on('end', ()=> {
                const data = Any.create({type_url: "type.googleapis.com/openiap.EndStream", value: EndStream.encode(EndStream.create()).finish() })
                protowrap.sendMesssag(client, { rid, command: "endstream", data: data }, null, true);
                resolve();
            });
            downloadStream.on('error', (err) => {
                reject(err);
            });
        });
      }
    public static async onMessage(client: flowclient, message: any) {
        let command, msg, reply;
        try {
            [command, msg, reply] = protowrap.unpack(message);
            if(message.command == "") throw new Error("Invalid/empty command");
        } catch (error) {
            err(error);
            message.command = "error";
            if (typeof error == "string") error = new Error(error);
            const data = Any.create({type_url: "type.googleapis.com/openiap.ErrorResponse", value: ErrorResponse.encode(ErrorResponse.create(error)).finish() })
            message.data = data
            message.rid = message.id;
            return message;
        }
        try {
            if (command == "noop" || command == "pong") {
                reply.command = "noop";
            } else if ( command == "queuemessagereply") {
                reply.command = "noop";
            } else if (command == "ping") {
                reply.command = "pong";
            } else if (command == "getelement") {
                if(NoderedUtil.IsNullUndefinded(msg)) msg = {xpath: ""};
                msg.xpath = "Did you say " + msg?.xpath + " ?";
                reply.data = GetElementResponse.encode(GetElementResponse.create(msg)).finish()
            } else if (command == "send") {
                let len = msg.count;
                reply.command = "getelement"
                for (var i = 1; i < len; i++) {
                    const data = Any.create({type_url: "type.googleapis.com/openiap.GetElementResponse", value: GetElementResponse.encode(GetElementResponse.create({ xpath: "test" + (i + 1) })).finish() })
                    var payload = { ...reply, 
                        data: data };
                    protowrap.sendMesssag(client, payload, null, true);
                }
                const data = Any.create({type_url: "type.googleapis.com/openiap.GetElementResponse", value: GetElementResponse.encode(GetElementResponse.create({ xpath: "test1" })).finish() })
                reply.data = data

            } else if (command == "upload") {
                var id = await WebServer.ReceiveFileContent(client, reply.rid, msg)
                reply.command = "uploadreply"
                const data = Any.create({type_url: "type.googleapis.com/openiap.UploadResponse", value: UploadResponse.encode(UploadResponse.create({ id, filename: msg.filename })).finish() })
                reply.data = data
                // var filename = msg.filename;
                // let name = path.basename(filename);
                // name = "upload.png";
                // const result = await protowrap.ReceiveFileContent(client, reply.rid, name, SendFileHighWaterMark);
                // reply.data = protowrap.pack("upload", result);
                // // @ts-ignore
                // info(`recived ${name} (${(result.mb).toFixed(2)} Mb) in ${(result.elapsedTime / 1000).toFixed(2)}  seconds in ${result.chunks} chunks`);
            } else if (command == "download") {
                if(msg.id && msg.id != "") {
                    reply.command = "downloadreply"
                    let rows = await Config.db.query({ query: { _id: safeObjectID(msg.id) }, top: 1, collectionname: "files", jwt: client.jwt }, null);
                    if(rows.length == 0) {
                        const rows2 = await Config.db.query({ query: { fileid: msg.id, "_type": "package"}, top:1, collectionname: "agents", jwt: client.jwt }, null);
                        if(rows2.length > 0) {
                            rows = await Config.db.query({ query: { _id: safeObjectID(msg.id) }, top: 1, collectionname: "files", jwt: Crypt.rootToken() }, null);
                        }
                    }                    
                    if(rows.length > 0) {
                        let result = rows[0] as any;
                        await WebServer.sendFileContent(client, reply.rid, msg.id)
                        result = rows[0];
                        reply.data =  Any.create({type_url: "type.googleapis.com/openiap.DownloadResponse",
                            value: DownloadResponse.encode(DownloadResponse.create({
                            filename: result.filename,
                            mimetype: result.contentType,
                            id: result._id.toString()})).finish()})

                    } else {
                        throw new Error("Access denied, downloading " + msg.id)
                    }
                } else {
                    throw new Error("Access denied (No id)")
                    // var filename = msg.filename;
                    // await protowrap.sendFileContent(client, reply.rid, filename, SendFileHighWaterMark);
                    // msg.filename = path.basename(filename);
                    // reply.data = protowrap.pack(command, msg);
                }
            } else if (command == "clientconsole") {
                throw new Error("Access denied")
                // var Readable = require('stream').Readable;
                // var rs = new Readable;
                // rs._read = function () { };
                // protowrap.SetStream(client, rs, reply.rid);
                // protowrap.sendMesssag(client, reply, null, true);
                // rs.pipe(process.stdout); // pipe the read stream to stdout
            } else if (command == "console") {
                throw new Error("Access denied")
                // var old = process.stdout.write;
                // const rid = reply.rid;
                // // @ts-ignore
                // process.stdout.write = (function (write) {
                //     return function (string, encoding, fd) {
                //         try {
                //             write.apply(process.stdout, arguments);
                //             protowrap.sendMesssag(client, { rid, command: "stream", data: protowrap.pack("stream", { data: Buffer.from(string) }) }, null, false);
                //         } catch (error) {
                //             process.stdout.write = old;
                //             err(error);
                //         }
                //     }
                // })(process.stdout.write);
            } else {
                if(message.command == "updatedocument") {
                    msg = JSON.parse(JSON.stringify(msg)) // un-wrap properties or we cannot JSON.stringify it later
                    msg.item = msg.document; // new style to new 
                    delete msg.document;
                    message.command = "updatemany" // new command to new
                }
                if(message.command == "unregisterqueue") {
                    msg = JSON.parse(JSON.stringify(msg)) // un-wrap properties or we cannot JSON.stringify it later
                    message.command = "closequeue" // new command to new
                }
                if(message.command == "pushworkitem") {
                    msg = JSON.parse(JSON.stringify(msg)) // un-wrap properties or we cannot JSON.stringify it later
                    if(typeof msg.payload == "string") msg.payload = JSON.parse(msg.payload); // new style to new 
                    message.command = "addworkitem" // new command to new
                }
                if(message.command == "pushworkitems") {
                    msg = JSON.parse(JSON.stringify(msg)) // un-wrap properties or we cannot JSON.stringify it later
                    if(msg.items != null ) {
                        msg.items.forEach(wi => {
                            if(typeof wi.payload == "string") wi.payload = JSON.parse(wi.payload); // new style to new 
                        });
                    }
                    message.command = "addworkitems" // new command to new
                }
                if(message.command == "updateworkitem") {
                    if(msg.workitem && typeof msg.workitem.payload == "string") msg.workitem.payload = JSON.parse(msg.workitem.payload); 
                    // if(msg.workitem) {
                    //     msg.workitem = JSON.parse(JSON.stringify(msg.workitem))
                    // }
                    // msg = JSON.parse(JSON.stringify(msg)) // un-wrap properties or we cannot JSON.stringify it later
                    // if(typeof msg.payload == "string") msg.payload = JSON.parse(msg.payload); // new style to new 
                    if(msg.workitem && msg.workitem.files && msg.workitem.files.length > 0) {
                        if(msg.files && msg.files.length > 0) {
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
                    if(msg.workitem) msg = Object.assign(msg.workitem, msg);
                    delete msg.workitem;
                    if(msg._id == null && msg._id == "" && msg.Id != null && msg.Id != "") msg._id = msg.Id;
                    delete msg.Id;                    
                }
                if(message.command == "signin") {
                    msg.clientagent = msg.agent;
                    msg.clientversion = msg.version;
                }
                var _msg = Message.fromjson({ ...message, data: msg });
                let result:any = await apiinstrumentation.With<Message>("process", message.traceid, message.spanid, undefined, async (span)=> {
                    if(message.traceid != null && message.traceid != "") {
                        _msg.traceId = message.traceid;
                        _msg.spanId = message.spanid;
                    }
                    return _msg.Process(client as any);
                });
                if(message.rid != null && message.rid != "" && result.command == "error") {
                    return null;
                }
                if(message.command == "signin") {
                    if(msg.ping != null) {
                        client.doping = msg.ping;
                    }
                }
                reply.command = result.command + "reply"
                if(reply.command == "errorreply") reply.command = "error";
                if(reply.command == "updatemanyreply") reply.command = "updatedocumentreply";
                if(reply.command == "closequeuereply") reply.command = "unregisterqueuereply";
                if(reply.command == "addworkitemreply") {
                    reply.command = "pushworkitemreply";
                    reply.workitem = result.result;
                }
                if(reply.command == "addworkitemsreply") {
                    reply.command = "pushworkitemsreply";
                }
                var res = result.data;
                if(typeof res == "string") var res = JSON.parse(res);
                delete res.password;
                if(result.command == "query" || result.command == "aggregate" || result.command == "listcollections") {
                    if(res.results == null && res.result != null) {
                        res.results = res.result;
                        delete res.result;
                    }
                }
                if(result.command == "addworkitem" || result.command == "pushworkitem" || result.command == "updateworkitem" || result.command == "popworkitem") {
                    res.workitem = res.result;
                    if(res.workitem && res.workitem.errormessage) {
                        if(typeof res.workitem.errormessage !== "string") {
                            res.workitem.errormessage = JSON.stringify(res.workitem.errormessage);
                        }
                    }
                    if(res.workitem != null) {
                        const wi: Workitem = res.workitem;
                        if(wi.lastrun != null) {
                            const timeMS = new Date(wi.lastrun);
                            var dt = Timestamp.create();
                            // @ts-ignore
                            dt.seconds = timeMS / 1000;
                            // @ts-ignore
                            dt.nanos = (timeMS % 1000) * 1e6;
                            // @ts-ignore
                            wi.lastrun = dt;
                        }
                        if(wi.nextrun != null) {
                            const timeMS = new Date(wi.nextrun);
                            var dt = Timestamp.create();
                            // @ts-ignore
                            dt.seconds = timeMS / 1000;
                            // @ts-ignore
                            dt.nanos = (timeMS % 1000) * 1e6;
                            // @ts-ignore
                            wi.nextrun = dt;
                        }
                        var b = true;    
                    }
                delete res.result;
                }
                if(reply.command == "pushworkitemsreply") {
                    res.workitems = res.items;
                    if(res.workitem && res.workitem.errormessage) {
                        if(typeof res.workitem.errormessage !== "string") {
                            res.workitem.errormessage = JSON.stringify(res.workitem.errormessage);
                        }
                        
                    }
                    delete res.items;
                }
                if(result.command == "popworkitem") {
                    let includefiles = msg.includefiles || false;
                    // @ts-ignore
                    let compressed = msg.compressed || false;
                    if(res.workitem && includefiles == true) {
                        for(var i = 0; i < res.workitem.files.length; i++) {
                            var file = res.workitem.files[i];
                            var buf: Buffer = await _msg._GetFile(file._id, compressed);
                            // @ts-ignore
                            // b = new Uint8Array(b);
                            // b = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
                            // @ts-ignore
                            file.compressed = compressed;
                            // @ts-ignore
                            file.file = buf;
                            // @ts-ignore
                            res.workitem.file = buf;
                            // Slice (copy) its segment of the underlying ArrayBuffer
                            // @ts-ignore
                            // file.file = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);                            
                        }
                    }
                }
                // if(res.result) res.result = Buffer.from(JSON.stringify(res.result));
                // if(res.results) res.results = Buffer.from(JSON.stringify(res.results));
                if(res.result) res.result = JSON.stringify(res.result);
                if(res.workitem && !NoderedUtil.IsNullUndefinded(res.workitem.payload) ) {
                    res.workitem.payload = JSON.stringify(res.workitem.payload);
                }
                if(res.workitems) {
                    for(let i = 0; i < res.workitems.length; i++) {
                        const wi = res.workitems[i];
                        if(!NoderedUtil.IsNullUndefinded(wi.payload)) {
                            wi.payload = JSON.stringify(wi.payload);
                        }
                    }
                }
                if(res.results && reply.command != "distinctreply") res.results = JSON.stringify(res.results);
                if(reply.command == "queuemessagereply") res.data = JSON.stringify(res.data);
                // reply.data = QueueMessageResponse.encode(QueueMessageResponse.create(res)).finish()
                reply.data = protowrap.pack(reply.command, res);
            }
        } catch (error) {
            err(error);
            reply.command = "error";
            if (typeof error == "string") error = new Error(error);
            const data = Any.create({type_url: "type.googleapis.com/openiap.ErrorResponse", value: ErrorResponse.encode(ErrorResponse.create(error)).finish() })
            reply.data = data
        }
        return reply;
    }
    public static async onClientConnected(client: any) {
        client.onConnected = WebServer.onConnected;
        client.onDisconnected = WebServer.onDisconnected;
        client.onMessage = WebServer.onMessage;
        WebSocketServer._clients.push(client);
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
        if(remoteip != "127.0.0.1" && remoteip != "::ffff:127.0.0.1") {
            // Add security check at some point to only allow from localhost !!!
            res.statusCode = 500;
            return res.end(JSON.stringify({ "error": "Go away !!!", "remoteip": remoteip,"hostname": _hostname, dt: new Date() }));
        }
        let array = [];
        while (true) {
            array.push(new Array(10000000).join('x'));
            await new Promise(resolve => { setTimeout(resolve, 1000) });
        }
        // let buffer = [];
        // const MB = (bytes) => Math.round(bytes/1024/1024) + 'MB'
        // const memoryUsage = () => {
        //         const mem = process.memoryUsage();
        //         return MB(mem.rss) + '\t' + MB(mem.heapTotal) + '\t' + MB(mem.external);
        // }
        // setInterval(()=>{
        //     buffer.push(Buffer.alloc(1024 * 1024* 1024)); // Eat 1GB of RAM every second
        //     console.log(buffer.length + '\t' + memoryUsage());
        // }, 1000);
        res.end(JSON.stringify({ "success": "true", "message": "Ok here we go, crash incomming!!!!", "remoteip": remoteip, "hostname": _hostname, dt: new Date() }));
        res.end();
    }
        
    static async get_heapdump(req: any, res: any, next: any): Promise<void> {
        const remoteip = LoginProvider.remoteip(req);
        if(remoteip != "127.0.0.1" && remoteip != "::ffff:127.0.0.1") {
            // Add security check at some point to only allow from localhost !!!
            res.statusCode = 500;
            return res.end(JSON.stringify({ "error": "Go away !!!", "remoteip": remoteip,"hostname": _hostname, dt: new Date() }));
        }
        await Logger.otel.createheapdump(null);
        res.end(JSON.stringify({ "success": "true", "remoteip": remoteip, "hostname": _hostname, dt: new Date() }));
        res.end();
    }
    static get_livenessprobe(req: any, res: any, next: any): void {
        let span = Logger.otel.startSpanExpress("get_livenessprobe", req)
        try {
            const [traceId, spanId] = Logger.otel.GetTraceSpanId(span);
            if (NoderedUtil.IsNullEmpty(_hostname)) _hostname = (Config.getEnv("HOSTNAME", undefined) || os.hostname()) || "unknown";
            res.end(JSON.stringify({ "success": "true", "hostname": _hostname, dt: new Date(), traceId, spanId }));
            res.end();
            // @ts-ignore
            span.setStatus({ code: 200 });
        } catch (error) {
            console.error(error);
            // @ts-ignore
            span.setStatus({code: 500, message: error instanceof Error ? error.message : undefined,
            });
        } finally {
            span.end();
        }
    }
}