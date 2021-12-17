import * as http from "http";
import * as WebSocket from "ws";
import { WebSocketServerClient } from "./WebSocketServerClient";
import { Crypt } from "./Crypt";
import { Message } from "./Messages/Message";
import { Config } from "./Config";
import { SigninMessage, NoderedUtil, TokenUser } from "@openiap/openflow-api";
import { Span } from "@opentelemetry/api";
import { ValueRecorder, Counter, BaseObserver } from "@opentelemetry/api-metrics"
import { Logger } from "./Logger";

export class WebSocketServer {
    private static _socketserver: WebSocket.Server;
    public static _clients: WebSocketServerClient[];
    public static p_all: BaseObserver;
    public static websocket_queue_count: BaseObserver;
    public static websocket_queue_message_count: BaseObserver;
    public static websocket_rate_limit: BaseObserver;
    public static websocket_errors: BaseObserver;
    public static websocket_messages: ValueRecorder;
    public static message_queue_count: BaseObserver;
    public static mongodb_watch_count: BaseObserver;
    public static update_message_queue_count(cli: WebSocketServerClient) {
        if (!Config.prometheus_measure_queued_messages) return;
        if (NoderedUtil.IsNullUndefinded(WebSocketServer.message_queue_count)) return;
        // const result: any = {};
        const keys = Object.keys(cli.messageQueue);
        WebSocketServer.message_queue_count.bind({ ...Logger.otel.defaultlabels, clientid: cli.id }).update(keys.length);
    }
    public static update_mongodb_watch_count(cli: WebSocketServerClient) {
        if (!Config.prometheus_measure__mongodb_watch) return;
        if (NoderedUtil.IsNullUndefinded(WebSocketServer.mongodb_watch_count)) return;
        const result: any = {};
        let total: number = 0;
        WebSocketServer.mongodb_watch_count.clear();
        for (let i = WebSocketServer._clients.length - 1; i >= 0; i--) {
            const cli: WebSocketServerClient = WebSocketServer._clients[i];
            WebSocketServer.mongodb_watch_count.bind({ ...Logger.otel.defaultlabels, clientid: cli.id, agent: cli.clientagent }).update(cli.streamcount());
        }
    }
    static configure(server: http.Server): void {
        this._clients = [];
        this._socketserver = new WebSocket.Server({ server: server });
        this._socketserver.on("connection", (socketObject: WebSocket, req: any): void => {
            this._clients.push(new WebSocketServerClient(socketObject, req));
        });
        this._socketserver.on("error", (error: Error): void => {
            Logger.instanse.error(error);
        });
        if (!NoderedUtil.IsNullUndefinded(Logger.otel)) {
            WebSocketServer.p_all = Logger.otel.meter.createUpDownSumObserver("openflow_websocket_online_clients", {
                description: 'Total number of online websocket clients'
            }) // "agent", "version"
            WebSocketServer.websocket_queue_count = Logger.otel.meter.createUpDownSumObserver("openflow_websocket_queue", {
                description: 'Total number of registered queues'
            }) // "clientid"
            WebSocketServer.websocket_queue_message_count = Logger.otel.meter.createUpDownSumObserver("openflow_websocket_queue_message", {
                description: 'Total number of queues messages'
            }) // "queuename"
            WebSocketServer.websocket_rate_limit = Logger.otel.meter.createUpDownSumObserver("openflow_websocket_rate_limit", {
                description: 'Total number of rate limited messages'
            }) // "command"
            WebSocketServer.websocket_errors = Logger.otel.meter.createUpDownSumObserver("openflow_websocket_errors", {
                description: 'Total number of websocket errors'
            }) // 
            WebSocketServer.websocket_messages = Logger.otel.meter.createValueRecorder('openflow_websocket_messages_duration_seconds', {
                description: 'Duration for handling websocket requests',
                boundaries: Logger.otel.default_boundaries
            }); // "command"
            WebSocketServer.message_queue_count = Logger.otel.meter.createUpDownSumObserver("openflow_message_queue", {
                description: 'Total number messages waiting on reply from client'
            }) // "clientid"
            WebSocketServer.mongodb_watch_count = Logger.otel.meter.createUpDownSumObserver("mongodb_watch", {
                description: 'Total number af steams  watching for changes'
            }) // "agent", "clientid"
        }
        setInterval(this.pingClients, 10000);
    }
    private static async pingClients(): Promise<void> {
        const span: Span = (Config.otel_trace_pingclients ? Logger.otel.startSpan("WebSocketServer.pingClients") : null);
        try {
            let count: number = WebSocketServer._clients.length;
            for (let i = WebSocketServer._clients.length - 1; i >= 0; i--) {
                const cli: WebSocketServerClient = WebSocketServer._clients[i];
                try {
                    if (!NoderedUtil.IsNullEmpty(cli.jwt)) {
                        const payload = Crypt.decryptToken(cli.jwt);
                        const clockTimestamp = Math.floor(Date.now() / 1000);
                        if ((payload.exp - clockTimestamp) < 60) {
                            Logger.instanse.debug("Token for " + cli.id + "/" + cli.user.name + "/" + cli.clientagent + " expires in less than 1 minute, send new jwt to client");
                            const tuser: TokenUser = await Message.DoSignin(cli, null);
                            if (tuser != null) {
                                span?.addEvent("Token for " + cli.id + "/" + cli.user.name + "/" + cli.clientagent + " expires in less than 1 minute, send new jwt to client");
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
                    span?.recordException(error);
                    console.error(error);
                    cli.Close();
                }
                const now = new Date();
                const seconds = (now.getTime() - cli.lastheartbeat.getTime()) / 1000;
                cli.lastheartbeatsec = seconds.toString();
                if (seconds >= Config.client_heartbeat_timeout) {
                    if (cli.user != null) {
                        span?.addEvent("client " + cli.id + "/" + cli.user.name + "/" + cli.clientagent + " timeout, close down");
                        Logger.instanse.info("client " + cli.id + "/" + cli.user.name + "/" + cli.clientagent + " timeout, close down");
                    } else {
                        span?.addEvent("client not signed/" + cli.id + "/" + cli.clientagent + " timeout, close down");
                        Logger.instanse.info("client not signed/" + cli.id + "/" + cli.clientagent + " timeout, close down");
                    }
                    cli.Close();
                }
                cli.ping(span);
                if (!cli.connected() && cli.queuecount() == 0 && cli.streamcount() == 0) {
                    if (cli.user != null) {
                        Logger.instanse.info("removing disconnected client " + cli.id + "/" + cli.user.name + "/" + cli.clientagent);
                        span?.addEvent("removing disconnected client " + cli.id + "/" + cli.user.name + "/" + cli.clientagent);
                    } else {
                        Logger.instanse.info("removing disconnected client " + cli.id + "/" + cli.clientagent);
                        span?.addEvent("removing disconnected client " + cli.id + "/" + cli.clientagent);
                    }
                    try {
                        cli.CloseConsumers(span);
                        WebSocketServer._clients.splice(i, 1);
                    } catch (error) {
                        span?.recordException(error);
                        console.error(error);
                    }
                }
            }
            if (count !== WebSocketServer._clients.length) {
                Logger.instanse.info("new client count: " + WebSocketServer._clients.length);
                span?.setAttribute("clientcount", WebSocketServer._clients.length)
            }
            const p_all = {};
            for (let i = 0; i < WebSocketServer._clients.length; i++) {
                try {
                    const cli = WebSocketServer._clients[i];
                    if (cli.user != null) {
                        if (!NoderedUtil.IsNullEmpty(cli.clientagent)) {
                            if (!NoderedUtil.IsNullUndefinded(WebSocketServer.p_all)) {
                                if (NoderedUtil.IsNullUndefinded(p_all[cli.clientagent])) p_all[cli.clientagent] = 0;
                                p_all[cli.clientagent] += 1;
                            }
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
                    span?.recordException(error);
                    console.error(error);
                }
            }

            if (!NoderedUtil.IsNullUndefinded(WebSocketServer.p_all)) {
                WebSocketServer.p_all.clear();
                const keys = Object.keys(p_all);
                keys.forEach(key => {
                    WebSocketServer.p_all.bind({ ...Logger.otel.defaultlabels, agent: key }).update(p_all[key]);
                });
            }
        } catch (error) {
            span?.recordException(error);
            Logger.instanse.error(error);
        } finally {
            Logger.otel.endSpan(span);
        }
    }
}