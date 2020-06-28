import { SocketMessage, TokenUser, Message } from "./Message";
import * as events from "events";
import * as WebSocket from "ws";
import winston = require("winston");
import { NoderedUtil } from "./nodered/nodes/NoderedUtil";

interface IHashTable<T> {
    [key: string]: T;
}
type QueuedMessageCallback = (msg: any) => any;
export class QueuedMessage {
    constructor(message: any, cb: QueuedMessageCallback) {
        this.id = message.id;
        this.message = message;
        this.cb = cb;
    }
    public cb: QueuedMessageCallback;
    public id: string;
    public message: any;
}
export class WebSocketClient {
    public _logger: winston.Logger;
    private _url: string;
    private _socketObject: WebSocket = null;
    public static instance: WebSocketClient = null;
    private _receiveQueue: SocketMessage[] = [];
    private _sendQueue: SocketMessage[] = [];
    public user: TokenUser;
    public jwt: string;
    public messageQueue: IHashTable<QueuedMessage> = {};
    public events: events.EventEmitter = null;
    constructor(logger: winston.Logger, url: string) {
        this._logger = logger;
        this._url = url;
        this._logger.info("connecting to " + url);
        this.events = new events.EventEmitter();
        this.events.setMaxListeners(200);

        this.connect();
        if (WebSocketClient.instance === null) {
            WebSocketClient.instance = this;
        }

        setInterval(this.pingServer, 10000);
    }
    public connect(): void {
        try {
            if (this._socketObject !== null &&
                this._socketObject.readyState !== this._socketObject.OPEN &&
                this._socketObject.readyState !== this._socketObject.CONNECTING) {
                this._socketObject.onopen = null;
                this._socketObject.onmessage = null;
                this._socketObject.onclose = null;
                this._socketObject.onerror = null;
                this._socketObject = null;
            }
            if (this._socketObject === null) {
                var options: any = {
                    rejectUnauthorized: false,
                    strictSSL: false
                };
                this._socketObject = new WebSocket(this._url, options);
                this._socketObject.onopen = (this.onopen).bind(this);
                this._socketObject.onmessage = (this.onmessage).bind(this);
                this._socketObject.onclose = (this.onclose).bind(this);
                this._socketObject.onerror = (this.onerror).bind(this);
            }
        } catch (error) {
            this._logger.debug(error.message);
        }
        // _ CLOSED:3
        // _ CLOSING:2
        // _ OPEN:1
        // _ CONNECTING:0
    }
    public isConnected(): boolean {
        if (this._socketObject === null || this._socketObject.readyState !== this._socketObject.OPEN) {
            return false;
        }
        return true;
    }
    private pingServer(): void {
        var me: WebSocketClient = WebSocketClient.instance;
        try {
            if (me._socketObject !== null && me._socketObject.readyState === me._socketObject.OPEN) {
                let msg: SocketMessage = SocketMessage.fromcommand("ping");
                me._socketObject.send(JSON.stringify(msg));
            }
            if (me._socketObject === null ||
                me._socketObject.readyState !== me._socketObject.CONNECTING || me._socketObject.readyState !== me._socketObject.OPEN) {
                me.connect();
            }
        } catch (error) {
            me._logger.error(error.message);
            console.error(error);
            me.connect();
        }
    }
    private async onopen(evt: Event): Promise<void> {
        this.events.emit("onopen");
    }
    private onclose(evt: CloseEvent): void {
        this.events.emit("onclose");
    }
    private onerror(evt: ErrorEvent): void {
        this.events.emit("onclose", evt.message);
    }
    private onmessage(evt: MessageEvent): void {
        let msg: SocketMessage = SocketMessage.fromjson(evt.data);
        this._receiveQueue.push(msg);
        this.ProcessQueue.bind(this)();
    }
    public async Send<T>(message: Message): Promise<T> {
        if (NoderedUtil.IsNullEmpty(message.id)) message.id = Math.random().toString(36).substr(2, 9);
        if (message.command != "pong") {
            var reply = message.replyto;
            if (NoderedUtil.IsNullEmpty(reply)) reply = "";
            // console.log("[SEND][" + message.command + "][" + message.id + "][" + reply + "]");
        }
        return new Promise<T>(async (resolve, reject) => {
            this._Send(message, ((msg) => {
                if (msg.error !== null && msg.error !== undefined) {
                    return reject(msg.error);
                }
                resolve(msg);
            }).bind(this));
        });
    }
    private _Send(message: Message, cb: QueuedMessageCallback): void {
        var messages: string[] = this.chunkString(message.data, 500);
        if (messages === null || messages === undefined || messages.length === 0) {
            var singlemessage: SocketMessage = SocketMessage.frommessage(message, "", 1, 0);
            if (message.replyto === null || message.replyto === undefined) {
                this.messageQueue[singlemessage.id] = new QueuedMessage(singlemessage, cb);
            }
            this._sendQueue.push(singlemessage);
            return;
        }
        if (message.id === null || message.id === undefined) { message.id = Math.random().toString(36).substr(2, 9); }
        for (let i: number = 0; i < messages.length; i++) {
            var _message: SocketMessage = SocketMessage.frommessage(message, messages[i], messages.length, i);
            this._sendQueue.push(_message);
        }
        if (message.replyto === null || message.replyto === undefined) {
            this.messageQueue[message.id] = new QueuedMessage(message, cb);
        }
        setTimeout(() => {
            this.ProcessQueue();
        }, 500);
    }
    public chunkString(str: string, length: number): string[] {
        if (str === null || str === undefined) {
            return [];
        }
        // tslint:disable-next-line: quotemark
        return str.match(new RegExp('.{1,' + length + '}', 'g'));
    }
    private ProcessQueue(): void {
        try {
            let ids: string[] = [];
            this._receiveQueue.forEach(msg => {
                if (ids.indexOf(msg.id) === -1) { ids.push(msg.id); }
            });
            ids.forEach(id => {
                try {
                    var msgs: SocketMessage[] = this._receiveQueue.filter(function (msg: SocketMessage): boolean { return msg.id === id; });
                    msgs.sort((a, b) => a.index - b.index);
                    var first: SocketMessage = msgs[0];
                    if (first.count === msgs.length) {
                        if (msgs.length === 1) {
                            var singleresult: Message = Message.frommessage(first, first.data);
                            singleresult.Process(this);
                        } else {
                            var buffer: string = "";
                            msgs.forEach(msg => {
                                if (msg.data !== null && msg.data !== undefined) { buffer += msg.data; }
                            });
                            var result: Message = Message.frommessage(first, buffer);
                            result.Process(this);
                        }
                        this._receiveQueue = this._receiveQueue.filter(function (msg: SocketMessage): boolean { return msg.id !== id; });
                    }
                } catch (error) {
                    this._logger.error(error.message);
                    console.error(error);
                }
            });
        } catch (error) {
            this._logger.error(error.message);
            console.error(error);
        }
        if (this._socketObject === null || this._socketObject.readyState !== this._socketObject.OPEN) {
            this._logger.info("Cannot send, not connected");
            return;
        }
        this._sendQueue.forEach(msg => {
            try {
                let id: string = msg.id;
                this._socketObject.send(JSON.stringify(msg));
                this._sendQueue = this._sendQueue.filter(function (msg: SocketMessage): boolean { return msg.id !== id; });
            } catch (error) {
                this._logger.error(error.message);
                console.error(error);
                return;
            }
        });
    }
}
