import * as winston from "winston";
import * as http from "http";
import * as WebSocket from "ws";
import { WebSocketServerClient } from "./WebSocketServerClient";
import { DatabaseConnection } from "./DatabaseConnection";
import { Crypt } from "./Crypt";
import { Message } from "./Messages/Message";
import { Config } from "./Config";
import { SigninMessage, NoderedUtil, TokenUser } from "openflow-api";

export class WebSocketServer {
    private static _logger: winston.Logger;
    private static _socketserver: WebSocket.Server;
    private static _server: http.Server;
    public static _clients: WebSocketServerClient[];
    private static _db: DatabaseConnection;

    static configure(logger: winston.Logger, server: http.Server): void {
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
        // this._socketserver.on("listening", (cb: () => void):void => {
        //     this._logger.debug("WebSocketServer is listening");
        // });
        // this._socketserver.on("headers", (headers: string[], request: http.IncomingMessage):void => {
        //     this._logger.debug("headers" + headers.join(","));
        // });
        setInterval(this.pingClients, 10000);
    }
    private static async pingClients(): Promise<void> {
        let count: number = WebSocketServer._clients.length;
        for (var i = WebSocketServer._clients.length - 1; i >= 0; i--) {
            var cli: WebSocketServerClient = WebSocketServer._clients[i];
            try {
                if (!NoderedUtil.IsNullEmpty(cli.jwt)) {
                    var payload = Crypt.decryptToken(cli.jwt);
                    var clockTimestamp = Math.floor(Date.now() / 1000);
                    if ((payload.exp - clockTimestamp) < 60) {
                        WebSocketServer._logger.debug("Token for " + cli.id + "/" + cli.user.name + "/" + cli.clientagent + " expires in less than 1 minute, send new jwt to client");
                        var tuser: TokenUser = await Message.DoSignin(cli, null);
                        if (tuser != null) {
                            var l: SigninMessage = new SigninMessage();
                            cli.jwt = Crypt.createToken(tuser, Config.shorttoken_expires_in);
                            l.jwt = cli.jwt;
                            l.user = tuser;
                            var m: Message = new Message(); m.command = "refreshtoken";
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
            var now = new Date();
            var seconds = (now.getTime() - cli.lastheartbeat.getTime()) / 1000;
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
        for (var i = 0; i < WebSocketServer._clients.length; i++) {
            try {
                var cli = WebSocketServer._clients[i];
                if (cli.user != null) {
                    // Lets assume only robots register queues ( not true )
                    if (cli.clientagent == "openrpa") {
                        Config.db.db.collection("users").updateOne({ _id: cli.user._id },
                            { $set: { _rpaheartbeat: new Date(new Date().toISOString()), _heartbeat: new Date(new Date().toISOString()) } }).catch((err) => {
                                console.error(err);
                            });
                    }
                    if (cli.clientagent == "nodered") {
                        Config.db.db.collection("users").updateOne({ _id: cli.user._id },
                            { $set: { _noderedheartbeat: new Date(new Date().toISOString()), _heartbeat: new Date(new Date().toISOString()) } }).catch((err) => {
                                console.error(err);
                            });
                    }
                    if (cli.clientagent == "webapp" || cli.clientagent == "aiotwebapp") {
                        Config.db.db.collection("users").updateOne({ _id: cli.user._id },
                            { $set: { _webheartbeat: new Date(new Date().toISOString()), _heartbeat: new Date(new Date().toISOString()) } }).catch((err) => {
                                console.error(err);
                            });
                    }
                    if (cli.clientagent == "powershell") {
                        Config.db.db.collection("users").updateOne({ _id: cli.user._id },
                            { $set: { _powershellheartbeat: new Date(new Date().toISOString()), _heartbeat: new Date(new Date().toISOString()) } }).catch((err) => {
                                console.error(err);
                            });
                    }
                    if (cli.clientagent == "mobileapp" || cli.clientagent == "aiotmobileapp") {
                        Config.db.db.collection("users").updateOne({ _id: cli.user._id },
                            { $set: { _webheartbeat: new Date(new Date().toISOString()), _mobilheartbeat: new Date(new Date().toISOString()), _heartbeat: new Date(new Date().toISOString()) } }).catch((err) => {
                                console.error(err);
                            });
                    }
                    else {
                        // Should proberly turn this a little down, so we dont update all online users every 10th second
                        Config.db.db.collection("users").updateOne({ _id: cli.user._id }, { $set: { _heartbeat: new Date(new Date().toISOString()) } }).catch((err) => {
                            console.error(err);
                        });
                    }
                }
            } catch (error) {
                console.error(error);
            }
        }
    }
}