import * as winston from "winston";
import * as http from "http";
import * as WebSocket from "ws";
import { WebSocketServerClient } from "./WebSocketServerClient";
import { DatabaseConnection } from "./DatabaseConnection";
import { Crypt } from "./Crypt";
import { Message } from "./Messages/Message";
import { Config } from "./Config";
import { SigninMessage, NoderedUtil, TokenUser } from "@openiap/openflow-api";
import * as client from "prom-client";

export class WebSocketServer {
    private static _logger: winston.Logger;
    private static _socketserver: WebSocket.Server;
    private static _server: http.Server;
    public static _clients: WebSocketServerClient[];
    private static _db: DatabaseConnection;

    private static p_all = new client.Gauge({
        name: 'openflow_websocket_online_clients',
        help: 'Total number of online websocket clients',
        labelNames: ["agent", "version"]
    })

    public static websocket_incomming_stats = new client.Counter({
        name: 'openflow_websocket_incomming_packages',
        help: 'Total number of websocket packages',
        labelNames: ["command"]
    })
    public static websocket_queue_count = new client.Gauge({
        name: 'openflow_websocket_queue_count',
        help: 'Total number of registered queues',
        labelNames: ["clientid"]
    })
    public static websocket_queue_message_count = new client.Counter({
        name: 'openflow_websocket_queue_message_count',
        help: 'Total number of queues messages',
        labelNames: ["queuename"]
    })
    public static websocket_rate_limit = new client.Counter({
        name: 'openflow_websocket_rate_limit_count',
        help: 'Total number of rate limited messages',
        labelNames: ["command"]
    })
    public static websocket_messages = new client.Histogram({
        name: 'openflow_websocket_messages_duration_seconds',
        help: 'Duration for handling websocket requests in microseconds',
        labelNames: ['command'],
        buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10]
    })
    public static message_queue_count = new client.Gauge({
        name: 'openflow_message_queue_count',
        help: 'Total number messages waiting on reply from client',
        labelNames: ["clientid"]
    })
    public static mongodb_watch_count = new client.Gauge({
        name: 'mongodb_watch_count',
        help: 'Total number af steams  watching for changes',
        labelNames: ["agent", "clientid"]
    })
    public static update_message_queue_count(cli: WebSocketServerClient) {
        if (!Config.prometheus_measure_queued_messages) return;
        // const result: any = {};
        const keys = Object.keys(cli.messageQueue);
        // keys.forEach(key => {
        //     try {
        //         const qmsg = cli.messageQueue[key];
        //         var o = qmsg.message;
        //         if (typeof o === "string") o = JSON.parse(o);
        //         const msg: Message = o;
        //         if (result[msg.command] == null) result[msg.command] = 0;
        //         result[msg.command]++;
        //     } catch (error) {
        //         WebSocketServer._logger.error(error);
        //     }
        // });
        // const keys2 = Object.keys(result);
        WebSocketServer.message_queue_count.reset();
        WebSocketServer.message_queue_count.labels(cli.id).set(keys.length);
        // keys2.forEach(key => {
        //     WebSocketServer.message_queue_count.labels(cli.id, key).set(result[key]);
        // });
    }
    public static update_mongodb_watch_count(cli: WebSocketServerClient) {
        if (!Config.prometheus_measure__mongodb_watch) return;
        const result: any = {};
        let total: number = 0;
        WebSocketServer.mongodb_watch_count.reset();
        for (let i = WebSocketServer._clients.length - 1; i >= 0; i--) {
            const cli: WebSocketServerClient = WebSocketServer._clients[i];
            WebSocketServer.mongodb_watch_count.labels(cli.clientagent, cli.id).set(cli.streamcount());
        }
    }
    static configure(logger: winston.Logger, server: http.Server, register: client.Registry): void {
        this._clients = [];
        this._logger = logger;
        this._server = server;
        this._socketserver = new WebSocket.Server({ server: server });
        this._socketserver.on("connection", (socketObject: WebSocket, req: any): void => {
            this._clients.push(new WebSocketServerClient(logger, socketObject, req));
        });
        this._socketserver.on("error", (error: Error): void => {
            this._logger.error(error);
        });
        if (!NoderedUtil.IsNullUndefinded(register)) register.registerMetric(WebSocketServer.p_all);
        if (!NoderedUtil.IsNullUndefinded(register)) register.registerMetric(WebSocketServer.websocket_incomming_stats);
        if (!NoderedUtil.IsNullUndefinded(register)) register.registerMetric(WebSocketServer.websocket_queue_count);
        if (!NoderedUtil.IsNullUndefinded(register)) register.registerMetric(WebSocketServer.websocket_queue_message_count);
        if (!NoderedUtil.IsNullUndefinded(register)) register.registerMetric(WebSocketServer.websocket_rate_limit);
        if (!NoderedUtil.IsNullUndefinded(register)) register.registerMetric(WebSocketServer.websocket_messages);
        if (!NoderedUtil.IsNullUndefinded(register)) register.registerMetric(WebSocketServer.message_queue_count);
        if (!NoderedUtil.IsNullUndefinded(register)) register.registerMetric(WebSocketServer.mongodb_watch_count);
        if (!NoderedUtil.IsNullUndefinded(register)) register.registerMetric(DatabaseConnection.mongodb_query);
        if (!NoderedUtil.IsNullUndefinded(register)) register.registerMetric(DatabaseConnection.mongodb_query_count);
        if (!NoderedUtil.IsNullUndefinded(register)) register.registerMetric(DatabaseConnection.mongodb_aggregate);
        if (!NoderedUtil.IsNullUndefinded(register)) register.registerMetric(DatabaseConnection.mongodb_aggregate_count);
        if (!NoderedUtil.IsNullUndefinded(register)) register.registerMetric(DatabaseConnection.mongodb_insert);
        if (!NoderedUtil.IsNullUndefinded(register)) register.registerMetric(DatabaseConnection.mongodb_insert_count);
        if (!NoderedUtil.IsNullUndefinded(register)) register.registerMetric(DatabaseConnection.mongodb_update);
        if (!NoderedUtil.IsNullUndefinded(register)) register.registerMetric(DatabaseConnection.mongodb_update_count);
        if (!NoderedUtil.IsNullUndefinded(register)) register.registerMetric(DatabaseConnection.mongodb_replace);
        if (!NoderedUtil.IsNullUndefinded(register)) register.registerMetric(DatabaseConnection.mongodb_replace_count);
        if (!NoderedUtil.IsNullUndefinded(register)) register.registerMetric(DatabaseConnection.mongodb_delete);
        if (!NoderedUtil.IsNullUndefinded(register)) register.registerMetric(DatabaseConnection.mongodb_delete_count);
        if (!NoderedUtil.IsNullUndefinded(register)) register.registerMetric(DatabaseConnection.mongodb_deletemany);
        if (!NoderedUtil.IsNullUndefinded(register)) register.registerMetric(DatabaseConnection.mongodb_deletemany_count);


        setInterval(this.pingClients, 10000);
    }
    private static async pingClients(): Promise<void> {
        let count: number = WebSocketServer._clients.length;
        WebSocketServer.p_all.reset();
        for (let i = WebSocketServer._clients.length - 1; i >= 0; i--) {
            const cli: WebSocketServerClient = WebSocketServer._clients[i];
            try {
                if (!NoderedUtil.IsNullEmpty(cli.jwt)) {
                    const payload = Crypt.decryptToken(cli.jwt);
                    const clockTimestamp = Math.floor(Date.now() / 1000);
                    if ((payload.exp - clockTimestamp) < 60) {
                        WebSocketServer._logger.debug("Token for " + cli.id + "/" + cli.user.name + "/" + cli.clientagent + " expires in less than 1 minute, send new jwt to client");
                        const tuser: TokenUser = await Message.DoSignin(cli, null);
                        if (tuser != null) {
                            const l: SigninMessage = new SigninMessage();
                            cli.jwt = Crypt.createToken(tuser, Config.shorttoken_expires_in);
                            l.jwt = cli.jwt;
                            l.user = tuser;
                            const m: Message = new Message(); m.command = "refreshtoken";
                            m.data = JSON.stringify(l);
                            cli.Send(m);
                        } else {
                            cli.Close();
                        }
                    }
                }
            } catch (error) {
                console.error(error);
                cli.Close();
            }
            const now = new Date();
            const seconds = (now.getTime() - cli.lastheartbeat.getTime()) / 1000;
            if (seconds >= Config.client_heartbeat_timeout) {
                if (cli.user != null) {
                    WebSocketServer._logger.info("client " + cli.id + "/" + cli.user.name + "/" + cli.clientagent + " timeout, close down");
                } else {
                    WebSocketServer._logger.info("client not signed/" + cli.id + "/" + cli.clientagent + " timeout, close down");
                }
                cli.Close();
            }
            cli.ping();
            if (!cli.connected() && cli.queuecount() == 0 && cli.streamcount() == 0) {
                if (cli.user != null) {
                    WebSocketServer._logger.info("removing disconnected client " + cli.id + "/" + cli.user.name + "/" + cli.clientagent);
                } else {
                    WebSocketServer._logger.info("removing disconnected client " + cli.id + "/" + cli.clientagent + " timeout, close down");
                }
                WebSocketServer._clients.splice(i, 1);
            }
        }
        if (count !== WebSocketServer._clients.length) {
            WebSocketServer._logger.info("new client count: " + WebSocketServer._clients.length);
        }
        // let openrpa: number = 0;
        // this.p_online_clients.labels("openrpa").set(count);
        for (let i = 0; i < WebSocketServer._clients.length; i++) {
            try {
                const cli = WebSocketServer._clients[i];
                if (cli.user != null) {
                    if (!NoderedUtil.IsNullEmpty(cli.clientagent)) {
                        WebSocketServer.p_all.labels(cli.clientagent, cli.clientversion).inc();
                    }
                    // Lets assume only robots register queues ( not true )
                    if (cli.clientagent == "openrpa") {
                        DatabaseConnection.mongodb_update_count.labels("users").inc();
                        const end = DatabaseConnection.mongodb_update.startTimer();
                        Config.db.db.collection("users").updateOne({ _id: cli.user._id },
                            { $set: { _rpaheartbeat: new Date(new Date().toISOString()), _heartbeat: new Date(new Date().toISOString()) } }).catch((err) => {
                                console.error(err);
                            });
                        end({ collection: "users" });
                    }
                    if (cli.clientagent == "nodered") {
                        DatabaseConnection.mongodb_update_count.labels("users").inc();
                        const end = DatabaseConnection.mongodb_update.startTimer();
                        Config.db.db.collection("users").updateOne({ _id: cli.user._id },
                            { $set: { _noderedheartbeat: new Date(new Date().toISOString()), _heartbeat: new Date(new Date().toISOString()) } }).catch((err) => {
                                console.error(err);
                            });
                        end({ collection: "users" });
                    }
                    if (cli.clientagent == "webapp" || cli.clientagent == "aiotwebapp") {
                        Config.db.db.collection("users").updateOne({ _id: cli.user._id },
                            { $set: { _webheartbeat: new Date(new Date().toISOString()), _heartbeat: new Date(new Date().toISOString()) } }).catch((err) => {
                                console.error(err);
                            });
                    }
                    if (cli.clientagent == "powershell") {
                        DatabaseConnection.mongodb_update_count.labels("users").inc();
                        const end = DatabaseConnection.mongodb_update.startTimer();
                        Config.db.db.collection("users").updateOne({ _id: cli.user._id },
                            { $set: { _powershellheartbeat: new Date(new Date().toISOString()), _heartbeat: new Date(new Date().toISOString()) } }).catch((err) => {
                                console.error(err);
                            });
                        end({ collection: "users" });
                    }
                    if (cli.clientagent == "mobileapp" || cli.clientagent == "aiotmobileapp") {
                        DatabaseConnection.mongodb_update_count.labels("users").inc();
                        const end = DatabaseConnection.mongodb_update.startTimer();
                        Config.db.db.collection("users").updateOne({ _id: cli.user._id },
                            { $set: { _webheartbeat: new Date(new Date().toISOString()), _mobilheartbeat: new Date(new Date().toISOString()), _heartbeat: new Date(new Date().toISOString()) } }).catch((err) => {
                                console.error(err);
                            });
                        end({ collection: "users" });
                    }
                    else {
                        // Should proberly turn this a little down, so we dont update all online users every 10th second
                        DatabaseConnection.mongodb_update_count.labels("users").inc();
                        const end = DatabaseConnection.mongodb_update.startTimer();
                        Config.db.db.collection("users").updateOne({ _id: cli.user._id }, { $set: { _heartbeat: new Date(new Date().toISOString()) } }).catch((err) => {
                            console.error(err);
                        });
                        end({ collection: "users" });
                    }
                }
            } catch (error) {
                console.error(error);
            }
        }
    }
}