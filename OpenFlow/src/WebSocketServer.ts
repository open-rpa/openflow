import * as winston from "winston";
import * as http from "http";
import * as WebSocket from "ws";
import { WebSocketServerClient } from "./WebSocketServerClient";
import { DatabaseConnection } from "./DatabaseConnection";
import { Crypt } from "./Crypt";
import { Message } from "./Messages/Message";
import { Config } from "./Config";
import { SigninMessage, NoderedUtil, TokenUser } from "@openiap/openflow-api";
import { otel } from "./otel";
import { ValueRecorder, UpDownCounter, Counter, BaseObserver } from "@opentelemetry/api-metrics"

export class WebSocketServer {
    private static _logger: winston.Logger;
    private static _socketserver: WebSocket.Server;
    private static _server: http.Server;
    public static _clients: WebSocketServerClient[];
    private static _db: DatabaseConnection;

    public static p_all: UpDownCounter;
    public static websocket_queue_count: BaseObserver;
    public static websocket_queue_message_count: Counter;
    public static websocket_rate_limit: Counter;
    public static websocket_messages: ValueRecorder;
    public static message_queue_count: BaseObserver;
    public static mongodb_watch_count: UpDownCounter;
    public static update_message_queue_count(cli: WebSocketServerClient) {
        if (!Config.prometheus_measure_queued_messages) return;
        if (NoderedUtil.IsNullUndefinded(WebSocketServer.message_queue_count)) return;
        // const result: any = {};
        const keys = Object.keys(cli.messageQueue);
        WebSocketServer.message_queue_count.bind({ ...otel.defaultlabels, clientid: cli.id }).update(keys.length);
    }
    public static update_mongodb_watch_count(cli: WebSocketServerClient) {
        if (!Config.prometheus_measure__mongodb_watch) return;
        if (NoderedUtil.IsNullUndefinded(WebSocketServer.mongodb_watch_count)) return;
        const result: any = {};
        let total: number = 0;
        WebSocketServer.mongodb_watch_count.clear();
        for (let i = WebSocketServer._clients.length - 1; i >= 0; i--) {
            const cli: WebSocketServerClient = WebSocketServer._clients[i];
            WebSocketServer.mongodb_watch_count.bind({ ...otel.defaultlabels, clientid: cli.id, agent: cli.clientagent }).add(cli.streamcount());
        }
    }
    static configure(logger: winston.Logger, server: http.Server, _otel: otel): void {
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
        if (!NoderedUtil.IsNullUndefinded(_otel)) {
            WebSocketServer.p_all = _otel.meter.createUpDownCounter("openflow_websocket_online_clients", {
                description: 'Total number of online websocket clients'
            }) // "agent", "version"
            WebSocketServer.websocket_queue_count = _otel.meter.createUpDownSumObserver("openflow_websocket_queue_count", {
                description: 'Total number of registered queues'
            }) // "clientid"
            WebSocketServer.websocket_queue_message_count = _otel.meter.createCounter("openflow_websocket_queue_message_count", {
                description: 'Total number of queues messages'
            }) // "queuename"
            WebSocketServer.websocket_rate_limit = _otel.meter.createCounter("openflow_websocket_rate_limit_count", {
                description: 'Total number of rate limited messages'
            }) // "command"
            WebSocketServer.websocket_messages = _otel.meter.createValueRecorder('openflow_websocket_messages_duration_seconds', {
                description: 'Duration for handling websocket requests',
                boundaries: otel.default_boundaries
            }); // "command"
            WebSocketServer.message_queue_count = _otel.meter.createUpDownSumObserver("openflow_message_queue_count", {
                description: 'Total number messages waiting on reply from client'
            }) // "clientid"
            WebSocketServer.mongodb_watch_count = _otel.meter.createUpDownCounter("mongodb_watch_count", {
                description: 'Total number af steams  watching for changes'
            }) // "agent", "clientid"
        }
        setInterval(this.pingClients, 10000);
    }
    private static async pingClients(): Promise<void> {
        let count: number = WebSocketServer._clients.length;
        if (!NoderedUtil.IsNullUndefinded(WebSocketServer.p_all)) WebSocketServer.p_all.clear();
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
                        if (!NoderedUtil.IsNullUndefinded(WebSocketServer.p_all)) WebSocketServer.p_all.bind({ ...otel.defaultlabels, version: cli.clientversion, agent: cli.clientagent }).add(1);
                    }
                    // Lets assume only robots register queues ( not true )
                    if (cli.clientagent == "openrpa") {
                        Config.db.synRawUpdateOne("users", { _id: cli.user._id },
                            { $set: { _rpaheartbeat: new Date(new Date().toISOString()), _heartbeat: new Date(new Date().toISOString()) } },
                            Config.prometheus_measure_onlineuser, null);
                    }
                    if (cli.clientagent == "nodered") {
                        Config.db.synRawUpdateOne("users", { _id: cli.user._id },
                            { $set: { _noderedheartbeat: new Date(new Date().toISOString()), _heartbeat: new Date(new Date().toISOString()) } },
                            Config.prometheus_measure_onlineuser, null);
                    }
                    if (cli.clientagent == "webapp" || cli.clientagent == "aiotwebapp") {
                        Config.db.synRawUpdateOne("users", { _id: cli.user._id },
                            { $set: { _webheartbeat: new Date(new Date().toISOString()), _heartbeat: new Date(new Date().toISOString()) } },
                            Config.prometheus_measure_onlineuser, null);
                    }
                    if (cli.clientagent == "powershell") {
                        Config.db.synRawUpdateOne("users", { _id: cli.user._id },
                            { $set: { _powershellheartbeat: new Date(new Date().toISOString()), _heartbeat: new Date(new Date().toISOString()) } },
                            Config.prometheus_measure_onlineuser, null);
                    }
                    if (cli.clientagent == "mobileapp" || cli.clientagent == "aiotmobileapp") {
                        Config.db.synRawUpdateOne("users", { _id: cli.user._id },
                            { $set: { _webheartbeat: new Date(new Date().toISOString()), _mobilheartbeat: new Date(new Date().toISOString()), _heartbeat: new Date(new Date().toISOString()) } },
                            Config.prometheus_measure_onlineuser, null);
                    }
                    else {
                        // Should proberly turn this a little down, so we dont update all online users every 10th second
                        Config.db.synRawUpdateOne("users", { _id: cli.user._id },
                            { $set: { _heartbeat: new Date(new Date().toISOString()) } },
                            Config.prometheus_measure_onlineuser, null);
                    }
                }
            } catch (error) {
                console.error(error);
            }
        }
    }
}