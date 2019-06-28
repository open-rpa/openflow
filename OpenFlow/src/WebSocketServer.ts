import * as winston from "winston";
import * as http from "http";
import * as WebSocket from "ws";
import { WebSocketClient } from "./WebSocketClient";
import { DatabaseConnection } from "./DatabaseConnection";
import { Crypt } from "./Crypt";
import { SigninMessage } from "./Messages/SigninMessage";
import { SocketMessage } from "./SocketMessage";
import { Message } from "./Messages/Message";

export class WebSocketServer {
    private static _logger: winston.Logger;
    private static _socketserver: WebSocket.Server;
    private static _server: http.Server;
    private static _clients: WebSocketClient[];
    private static _db: DatabaseConnection;

    static configure(logger: winston.Logger, server: http.Server): void {
        this._clients = [];
        this._logger = logger;
        this._server = server;
        this._socketserver = new WebSocket.Server({ server: server });
        this._socketserver.on("connection", (socketObject: WebSocket): void => {
            this._clients.push(new WebSocketClient(logger, socketObject));
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
    private static pingClients(): void {
        let count: number = WebSocketServer._clients.length;
        WebSocketServer._clients = WebSocketServer._clients.filter(function (cli: WebSocketClient): boolean {
            try {
                if (cli.jwt !== null && cli.jwt !== undefined) {
                    var tuser = Crypt.verityToken(cli.jwt);
                    var payload = Crypt.decryptToken(cli.jwt);
                    var clockTimestamp = Math.floor(Date.now() / 1000);
                    // WebSocketServer._logger.silly((payload.exp - clockTimestamp))
                    if ((payload.exp - clockTimestamp) < 60) {
                        WebSocketServer._logger.debug("Token for " + tuser.username + " expires in less than 1 minute, send new jwt to client");
                        var l: SigninMessage = new SigninMessage();
                        cli.jwt = Crypt.createToken(tuser, "5m");
                        l.jwt = cli.jwt;
                        l.user = tuser;
                        var m: Message = new Message(); m.command = "refreshtoken";
                        m.data = JSON.stringify(l);
                        cli.Send(m);
                    }
                }
            } catch (error) {
                console.error(error);
            }

            // if cli.jwt
            // SigninMessage
            return cli.ping();
        });
        if (count !== WebSocketServer._clients.length) {
            WebSocketServer._logger.info("new client count: " + WebSocketServer._clients.length);
        }
    }
}