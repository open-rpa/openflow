import WebSocket from "ws";
import { SocketMessage } from "./SocketMessage.js";
import { Message, JSONfn } from "./Messages/Message.js";
import { Config } from "./Config.js";
import { amqpwrapper, QueueMessageOptions, amqpqueue, amqpexchange, exchangealgorithm } from "./amqpwrapper.js";
import { NoderedUtil, QueueMessage, User, QueuedMessage, QueuedMessageCallback, WatchEventMessage, QueueClosedMessage, ExchangeClosedMessage, TokenUser, SigninMessage } from "@openiap/openflow-api";
import { ChangeStream } from "mongodb";
import { Span } from "@opentelemetry/api";
import { Logger } from "./Logger.js";
import { clientAgent } from "./Audit.js";
import express from "express";
import { WebSocketServer } from "./WebSocketServer.js";
import { WebServer } from "./WebServer.js";
import { Auth } from "./Auth.js";
interface IHashTable<T> {
    [key: string]: T;
}
const Semaphore = (n) => ({
    n,
    async down() {
        while (this.n <= 0) await this.wait();
        this.n--;
    },
    up() {
        this.n++;
    },
    async wait() {
        if (this.n <= 0) return await new Promise((res, req) => {
            setImmediate(async () => res(await this.wait()))
        });
        return;
    },
});
const semaphore = Semaphore(1);

export declare class RegisterExchangeResponse {
    exchangename: string;
    queuename: string;
}
export class clsstream {
    public stream: ChangeStream;
    public id: string;
    public callback: any;
    aggregates: object[];
    collectionname: string;
}
export class WebSocketServerClient {
    public jwt: string;
    public _socketObject: WebSocket;
    private _receiveQueue: SocketMessage[] = [];
    private _sendQueue: SocketMessage[] = [];
    public messageQueue: IHashTable<QueuedMessage> = {};
    public remoteip: string = "unknown";
    public clientagent: clientAgent;
    public clientversion: string;
    public created: Date = new Date();
    public lastheartbeat: Date = new Date();
    public lastheartbeatstr: string = new Date().toISOString();
    public lastheartbeatsec: string = "0";
    public metrics: string = "";
    public id: string = "";
    public user: User;
    public username: string;
    public _queues: amqpqueue[] = [];
    public _queuescounter: number = 0;
    public _queuescurrent: number = 0;
    public _queuescounterstr: string = "0";
    public _queuescurrentstr: string = "0";
    public _exchanges: amqpexchange[] = [];
    public devnull: boolean = false;
    private _message: any = null;
    private _error: any = null;
    private _close: any = null;
    private _amqpdisconnected: any = null;
    private _dbdisconnected: any = null;
    private _dbconnected: any = null;
    private init_complete: boolean = false;
    public static remoteip(req: express.Request) {
        if (req == null) return "unknown";
        let remoteip: string = req.socket.remoteAddress;
        if (req.headers["X-Forwarded-For"] != null) remoteip = req.headers["X-Forwarded-For"] as string;
        if (req.headers["X-real-IP"] != null) remoteip = req.headers["X-real-IP"] as string;
        if (req.headers["x-forwarded-for"] != null) remoteip = req.headers["x-forwarded-for"] as string;
        if (req.headers["x-real-ip"] != null) remoteip = req.headers["x-real-ip"] as string;
        return remoteip;
    }
    async Initialize(socketObject: WebSocket, req: express.Request): Promise<boolean> {
        const span: Span = Logger.otel.startSpanExpress("WebSocketServerClient.Initialize", req);
        try {
            this._socketObject = socketObject;

            this._message = this.message.bind(this);
            this._error = this.error.bind(this);
            this._close = this.close.bind(this);
            this._socketObject.on("message", this._message);
            this._socketObject.on("error", this._error);
            this._socketObject.on("close", this._close);
            this._dbdisconnected = this.dbdisconnected.bind(this);
            this._dbconnected = this.dbconnected.bind(this);
            this._amqpdisconnected = this.amqpdisconnected.bind(this);
            this.id = NoderedUtil.GetUniqueIdentifier();
            if (!NoderedUtil.IsNullUndefinded(req)) {
                this.remoteip = WebSocketServerClient.remoteip(req);
            }
            let _remoteip = "unknown";
            if (Config.otel_trace_connection_ips) {
                _remoteip = _remoteip.split(":").join("-");
            }
            if (!WebSocketServer.total_connections_count[_remoteip]) WebSocketServer.total_connections_count[_remoteip] = 0;
            WebSocketServer.total_connections_count[_remoteip]++;

            if (await WebServer.isBlocked(req)) {
                if (Config.log_blocked_ips) Logger.instanse.error(this.remoteip + " is blocked", null);
                try {
                    if (Config.client_disconnect_signin_error) {
                        this._socketObject.close()
                        return false;
                    }
                } catch (error) {
                    Logger.instanse.error(error, null);
                }
                return true;
            } else {
                if (Config.socket_rate_limit) {
                    try {
                        await WebSocketServer.BaseRateLimiter.consume(this.remoteip);
                    } catch (error) {
                        Logger.instanse.error(error, null);
                        this._socketObject.close()
                        return false;
                    }
                }
            }
            Logger.instanse.debug("new client " + this.id + " from " + this.remoteip, span, Logger.parsecli(this));
            Config.db.on("disconnected", this._dbdisconnected);
            Config.db.on("connected", this._dbconnected);
            amqpwrapper.Instance().on("disconnected", this._amqpdisconnected);
            this.init_complete = true;
            this.ProcessQueue(null);
        } catch (error) {
            Logger.instanse.error(error, span);
        } finally {
            Logger.otel.endSpan(span);
        }
        return true;
    }
    private async dbdisconnected(e: Event): Promise<void> {
        var keys = Object.keys(this.watches);
        for (var i = 0; i < keys.length; i++) {
            let id = keys[i];
            let w = this.watches[id];
            await this.Watch(w.aggregates, w.collectionname, this.jwt, id);
        }
    }
    private dbconnected(e: Event): void {
    }
    private amqpdisconnected(e: Event): void {
        for (var i = 0; i < this._queues.length; i++) {
            let msg: SocketMessage = SocketMessage.fromcommand("queueclosed");
            let q: QueueClosedMessage = new QueueClosedMessage();
            q.queuename = this._queues[i].queue;
            msg.data = JSON.stringify(q);
            this._socketObject.send(msg.tojson());
            Logger.instanse.debug("Send queue closed message to " + this.id + " for queue " + q.queuename, null, Logger.parsecli(this));
        }
        for (var i = 0; i < this._exchanges.length; i++) {
            let msg: SocketMessage = SocketMessage.fromcommand("exchangeclosed");
            let q: ExchangeClosedMessage = new ExchangeClosedMessage();
            q.queuename = this._exchanges[i].queue.queue; q.exchangename = this._exchanges[i].exchange;
            msg.data = JSON.stringify(q);
            this._socketObject.send(msg.tojson());
            Logger.instanse.debug("Send queue closed message to " + this.id + " for exchange " + q.exchangename, null, Logger.parsecli(this));
        }
        this._exchanges = [];
        this.CloseConsumers(null);
    }
    private close(e: CloseEvent): void {
        Logger.instanse.debug("Connection closed " + e + " " + this.id + "/" + this.clientagent, null, Logger.parsecli(this));
        this.init_complete = false;
        // this.Close(null);
    }
    private error(e: Event): void {
        Logger.instanse.error(e, null, Logger.parsecli(this));
    }
    public queuecount(): number {
        if (this._queues == null) return 0;
        return this._queues.length;
    }
    public connected(): boolean {
        if (this._socketObject == null) return false;
        if (this._socketObject.readyState === this._socketObject.OPEN || this._socketObject.readyState === this._socketObject.CONNECTING) {
            return true;
        }
        return false;
    }
    public ping(parent: Span): void {
        const span: Span = (Config.otel_trace_pingclients && parent != null ? Logger.otel.startSubSpan("WebSocketServerClient.ping", parent) : null);
        try {
            let msg: SocketMessage = SocketMessage.fromcommand("ping");
            if (this._socketObject == null) {
                if (this.queuecount() > 0) {
                    this.CloseConsumers(span);
                }
                return;
            }
            if (this._socketObject.readyState === this._socketObject.CLOSED || this._socketObject.readyState === this._socketObject.CLOSING) {
                if (this.queuecount() > 0 || this._exchanges.length > 0) {
                    this.CloseConsumers(span);
                }
                return;
            }
        } catch (error) {
            Logger.instanse.error(error, span, Logger.parsecli(this));
            this._receiveQueue = [];
            this._sendQueue = [];
            if (this._socketObject != null) {
                this.Close(span).catch((err) => {
                    Logger.instanse.error(error, span, Logger.parsecli(this));
                });
            }
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public async RefreshToken(parent: Span): Promise<boolean> {
        const tuser: User = await Message.DoSignin(this, null, parent);
        if(tuser == null) return false;
        const l: SigninMessage = new SigninMessage();
        this.jwt = await Auth.User2Token(tuser, Config.shorttoken_expires_in, parent);
        l.jwt = this.jwt;
        l.user = TokenUser.From(tuser);
        const m: Message = new Message(); m.command = "refreshtoken";
        m.data = JSON.stringify(l);
        this.Send(m);
        return true;
    }
    private message(message: string): void {
        try {
            Logger.instanse.silly("WebSocket message received " + message, null, Logger.parsecli(this));
            let msg: SocketMessage = SocketMessage.fromjson(message);
            Logger.instanse.silly("WebSocket message received id: " + msg.id + " index: " + msg.index + " count: " + msg.count, null, Logger.parsecli(this));
            this.lastheartbeat = new Date();
            this.lastheartbeatstr = new Date().toISOString();
            const now = new Date();
            const seconds = (now.getTime() - this.lastheartbeat.getTime()) / 1000;
            this.lastheartbeatsec = seconds.toString();

            this._receiveQueue.push(msg);
            if ((msg.index + 1) >= msg.count) this.ProcessQueue(null);
        } catch (error) {
            Logger.instanse.error(error, null, Logger.parsecli(this));
            try {
                const errormessage: Message = new Message(); errormessage.command = "error"; errormessage.data = (error.message ? error.message : error);
                this._socketObject.send(JSON.stringify(errormessage));
            } catch (error) {
            }
        }
    }
    public async CloseConsumers(parent: Span): Promise<void> {
        await semaphore.down();
        for (let i = this._queues.length - 1; i >= 0; i--) {
            try {
                // await this.CloseConsumer(this._queues[i]);
                await amqpwrapper.Instance().RemoveQueueConsumer(this.user, this._queues[i], parent);
                this._queues.splice(i, 1);
                this._queuescurrent--;
                this._queuescurrentstr = this._queuescurrent.toString();
            } catch (error) {
                Logger.instanse.error(error, parent, Logger.parsecli(this));
            }
        }
        for (let i = this._exchanges.length - 1; i >= 0; i--) {
            const e = this._exchanges[i];
            if (e && e.queue != null) {
                try {
                    await amqpwrapper.Instance().RemoveQueueConsumer(this.user, this._exchanges[i].queue, parent);
                    this._exchanges.splice(i, 1);
                } catch (error) {
                    Logger.instanse.error(error, parent, Logger.parsecli(this));
                }
            }
        }
        semaphore.up();
    }
    public async Close(parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("WebSocketServerClient.Close", parent);
        try {
            this.init_complete = false;
            if (this._dbdisconnected != null) Config.db.removeListener("disconnected", this._dbdisconnected);
            if (this._dbconnected != null) Config.db.removeListener("connected", this._dbconnected);

            if (this._message != null) Config.db.removeListener("disconnected", this._message);
            if (this._error != null) Config.db.removeListener("disconnected", this._error);
            if (this._close != null) Config.db.removeListener("disconnected", this._close);
            try {
                if (this._amqpdisconnected != null) amqpwrapper.Instance().removeListener("disconnected", this._amqpdisconnected);
            } catch (error) {
                Logger.instanse.error(error, span, Logger.parsecli(this));
            }

            await this.CloseConsumers(span);
            if (!NoderedUtil.IsNullUndefinded(this._socketObject)) {
                try {
                    this._socketObject.close();
                } catch (error) {
                    Logger.instanse.error(error, span, Logger.parsecli(this));
                }
            }
            var keys = Object.keys(this.watches);
            for (var i = 0; i < keys.length; i++) {
                await this.UnWatch(keys[i], this.jwt);
            }
            var keys = Object.keys(this.messageQueue);
            for (var i = 0; i < keys.length; i++) {
                delete this.messageQueue[keys[i]].cb;
                delete this.messageQueue[keys[i]];
            }
            this._exchanges = [];
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public async CloseConsumer(user: User, queuename: string, parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("WebSocketServerClient.CloseConsumer", parent);
        await semaphore.down();
        try {
            for (let i = this._queues.length - 1; i >= 0; i--) {
                const q = this._queues[i];
                if (q && (q.queue == queuename || q.queuename == queuename)) {
                    try {
                        amqpwrapper.Instance().RemoveQueueConsumer(user, this._queues[i], span).catch((err) => {
                            Logger.instanse.error(err, span, Logger.parsecli(this));
                        });
                        this._queues.splice(i, 1);
                        this._queuescurrent--;
                        this._queuescurrentstr = this._queuescurrent.toString();
                    } catch (error) {
                        Logger.instanse.error(error, span, Logger.parsecli(this));
                    }
                }
            }
            for (let i = this._exchanges.length - 1; i >= 0; i--) {
                const e = this._exchanges[i];
                if (e && (e.queue != null && e.queue.queue == queuename || e.queue.queuename == queuename)) {
                    try {
                        amqpwrapper.Instance().RemoveQueueConsumer(user, this._exchanges[i].queue, span).catch((err) => {
                            Logger.instanse.error(err, span, Logger.parsecli(this));
                        });
                        this._exchanges.splice(i, 1);
                    } catch (error) {
                        Logger.instanse.error(error, span, Logger.parsecli(this));
                    }
                }
            }
        } finally {
            semaphore.up();
            Logger.otel.endSpan(span);
        }
    }
    public async RegisterExchange(user: User, exchangename: string, algorithm: exchangealgorithm, routingkey: string = "", addqueue: boolean, parent: Span): Promise<RegisterExchangeResponse> {
        const span: Span = Logger.otel.startSubSpan("WebSocketServerClient.RegisterExchange", parent);
        try {
            let exclusive: boolean = false; // Should we keep the queue around ? for robots and roles
            let exchange = exchangename;
            if (NoderedUtil.IsNullEmpty(exchange)) {
                // @ts-ignore
                if(this.clientagent == "") this.clientagent = "unknown"
                exchange = this.clientagent + "." + NoderedUtil.GetUniqueIdentifier(); exclusive = true;
            }
            let exchangequeue: amqpexchange = null;
            try {
                const AssertExchangeOptions: any = Object.assign({}, (amqpwrapper.Instance().AssertExchangeOptions));
                AssertExchangeOptions.exclusive = exclusive;
                exchangequeue = await amqpwrapper.Instance().AddExchangeConsumer(user, exchange, algorithm, routingkey, AssertExchangeOptions, this.jwt, addqueue, async (msg: any, options: QueueMessageOptions, ack: any, done: any) => {
                    let span: Span
                    const _data = msg;
                    try {
                        span = Logger.otel.startSpan("WebSocketServerClient.RegisterExchange", msg.traceId, msg.spanId);
                        const result = await this.Queue(msg, exchange, options, span);
                        done(result);
                        ack();
                    } catch (error) {
                        setTimeout(() => {
                            ack(false);
                            Logger.instanse.error(exchange + " failed message queue message, nack and re queue message: ", span, Logger.parsecli(this));
                            Logger.instanse.error(error, span, Logger.parsecli(this));
                        }, Config.amqp_requeue_time);
                    } finally {
                        span?.end()
                    }
                }, span);
                if (exchangequeue) {
                    await semaphore.down();
                    if (exchangequeue.queue) exchange = exchangequeue.queue.queue;
                    this._exchanges.push(exchangequeue);
                    if (exchangequeue.queue) {
                        this._queues.push(exchangequeue.queue);
                        this._queuescounter++;
                        this._queuescurrent++;
                    }
                    this._queuescounterstr = this._queuescounter.toString();
                    this._queuescurrentstr = this._queuescurrent.toString();
                }
            } catch (error) {
                Logger.instanse.error(error, span, Logger.parsecli(this));
            }
            if (exchangequeue) semaphore.up();
            if (exchangequeue != null) return { exchangename: exchangequeue.exchange, queuename: exchangequeue.queue?.queue };
            return null;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public async CreateConsumer(queuename: string, parent: Span): Promise<string> {
        const span: Span = Logger.otel.startSubSpan("WebSocketServerClient.CreateConsumer", parent);
        try {
            let exclusive: boolean = false; // Should we keep the queue around ? for robots and roles
            let qname = queuename;
            if (NoderedUtil.IsNullEmpty(qname)) {
                // @ts-ignore
                if(this.clientagent == "") this.clientagent = "unknown"
                qname = this.clientagent + "." + NoderedUtil.GetUniqueIdentifier(); exclusive = true;
            }
            await this.CloseConsumer(this.user, qname, span);
            let queue: amqpqueue = null;
            try {
                const AssertQueueOptions: any = Object.assign({}, (amqpwrapper.Instance().AssertQueueOptions));
                AssertQueueOptions.exclusive = exclusive;
                if (NoderedUtil.IsNullEmpty(queuename)) {
                    AssertQueueOptions.autoDelete = true;
                }
                var exists = this._queues.filter(x => x.queuename == qname || x.queue == qname);
                if (exists.length > 0) {
                    Logger.instanse.warn(qname + " already exists, removing before re-creating", span);
                    for (let i = 0; i < exists.length; i++) {
                        await amqpwrapper.Instance().RemoveQueueConsumer(this.user, exists[i], span);
                    }
                }
                queue = await amqpwrapper.Instance().AddQueueConsumer(this.user, qname, AssertQueueOptions, this.jwt, async (msg: any, options: QueueMessageOptions, ack: any, done: any) => {
                    // const _data = msg;
                    let span: Span = null;
                    var _data = msg;
                    try {
                        var o = msg;
                        if (typeof o === 'string') o = JSON.parse(o);
                        span = Logger.otel.startSpan("OpenFlow Queue Process Message", o.traceId, o.spanId);
                        Logger.instanse.verbose("[preack] queuename: " + queuename + " qname: " + qname + " replyto: " + options.replyTo + " correlationId: " + options.correlationId, span)
                        _data = await this.Queue(msg, qname, options, span);;
                        ack();
                        // const result = await this.Queue(msg, qname, options);
                        // done(result);
                        Logger.instanse.debug("[ack] queuename: " + queuename + " qname: " + qname + " replyto: " + options.replyTo + " correlationId: " + options.correlationId, span)
                    } catch (error) {
                        setTimeout(() => {
                            ack(false);
                            Logger.instanse.warn("[nack] queuename: " + queuename + " qname: " + qname + " replyto: " + options.replyTo + " correlationId: " + options.correlationId + " error: " + (error.message ? error.message : error), span)
                        }, Config.amqp_requeue_time);
                    } finally {
                        Logger.otel.endSpan(span);
                        try {
                            done(_data);
                        } catch (error) {
                        }
                    }
                }, span);
                if (queue) {
                    await semaphore.down();
                    qname = queue.queue;
                    this._queuescounter++;
                    this._queuescurrent++;
                    this._queuescounterstr = this._queuescounter.toString();
                    this._queuescurrentstr = this._queuescurrent.toString();
                    this._queues.push(queue);
                }
            } finally {
                if (queue) semaphore.up();
            }
            if (queue != null) {
                return queue.queue;
            }
            return null;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    sleep(ms) {
        return new Promise(resolve => {
            setTimeout(resolve, ms)
        })
    }
    private ProcessQueue(parent: Span): void {
        if (this.devnull) {
            this._receiveQueue = [];
            this._sendQueue = [];
            return;
        }
        if (!this.init_complete) {
            return;
        }
        const span: Span = Logger.otel.startSubSpan("WebSocketServerClient.ProcessQueue", parent);
        try {
            let username: string = "Unknown";
            if (!NoderedUtil.IsNullUndefinded(this.user)) { username = this.user.username; }
            let ids: string[] = [];
            this._receiveQueue.forEach(msg => {
                if (ids.indexOf(msg.id) === -1) { ids.push(msg.id); }
            });
            ids.forEach(id => {
                const msgs: SocketMessage[] = this._receiveQueue.filter(function (msg: SocketMessage): boolean { return msg.id === id; });
                if (this._receiveQueue.length > Config.websocket_max_package_count) {
                    if (Config.websocket_disconnect_out_of_sync) {
                        Logger.instanse.error("_receiveQueue containers more than " + Config.websocket_max_package_count + " messages for id '" + id + "', disconnecting", span, Logger.parsecli(this));
                        this.Close(span);
                    } else {
                        Logger.instanse.error("_receiveQueue containers more than " + Config.websocket_max_package_count + " messages for id '" + id + "' so discarding all !!!!!!!", span, Logger.parsecli(this));
                        this._receiveQueue = this._receiveQueue.filter(function (msg: SocketMessage): boolean { return msg.id !== id; });
                    }
                }
                const first: SocketMessage = msgs[0];
                if (first.count === msgs.length) {
                    msgs.sort((a, b) => a.index - b.index);
                    if (msgs.length === 1) {
                        this._receiveQueue = this._receiveQueue.filter(function (msg: SocketMessage): boolean { return msg.id !== id; });
                        const singleresult: Message = Message.frommessage(first, first.data);
                        singleresult.priority = first.priority;
                        if (singleresult.command != "ping" && singleresult.command != "pong") {
                            singleresult.Process(this).then(msg=> {
                                if(msg==null) return;
                                if(msg.command == "error" && !msg.error && msg.data) {
                                    msg.data = JSON.parse(msg.data.replace(/\n/g, "\\n"));
                                    msg.data.error = msg.data.message;
                                    msg.data = JSON.stringify(msg.data);
                                    // msg.error =  msg.data; // backward compaility
                                }
                                this.Send(msg);
                            }) .catch((error) => {
                                singleresult.command = "error";
                                singleresult.data = JSON.stringify({"error": error.message});
                                this.Send(singleresult);
                                Logger.instanse.error(error, span, Logger.parsecli(this));
                            });
                        }
                    } else {
                        let chunk: string = "";
                        msgs.forEach(msg => {
                            if (!NoderedUtil.IsNullUndefinded(msg.data)) { chunk += msg.data; }
                        });
                        this._receiveQueue = this._receiveQueue.filter(function (msg: SocketMessage): boolean { return msg.id !== id; });
                        const result: Message = Message.frommessage(first, chunk);
                        result.priority = first.priority;
                        if (result.command != "ping" && result.command != "pong") {
                            result.Process(this).then(msg=> {
                                if(msg != null) this.Send(msg);
                            }) .catch((error) => {
                                Logger.instanse.error(error, span, Logger.parsecli(this));
                            });
                        }

                    }
                }
            });
            this._sendQueue.forEach(msg => {
                let id: string = msg.id;
                try {
                    if (this._socketObject != null) this._socketObject.send(JSON.stringify(msg));
                } catch (error) {
                    Logger.instanse.error(error, span, Logger.parsecli(this));
                }
                this._sendQueue = this._sendQueue.filter(function (msg: SocketMessage): boolean { return msg.id !== id; });
            });
        } catch (error) {
            Logger.instanse.error(error, span);
        } finally {
            span?.end();
        }

    }
    public async Send<T>(message: Message, parent: Span = null): Promise<T> {
        return new Promise<T>(async (resolve, reject) => {
            if(message == null) return reject("message is null");
            this._Send(message, ((msg) => {
                if (!NoderedUtil.IsNullUndefinded(msg.error)) { return reject(msg.error); }
                resolve(msg);
            }).bind(this), parent);
        });
    }
    private _Send(message: Message, cb: QueuedMessageCallback, parent: Span): void {
        const messages: string[] = this.chunkString(message.data, Config.websocket_package_size);
        if (NoderedUtil.IsNullUndefinded(messages) || messages.length === 0) {
            const singlemessage: SocketMessage = SocketMessage.frommessage(message, "", 1, 0);
            if (NoderedUtil.IsNullEmpty(message.replyto) && message.command != "refreshtoken") {
                this.messageQueue[singlemessage.id] = new QueuedMessage(singlemessage, cb);
            } else {
                try {
                    if (cb != null) cb(message);
                } catch (error) {
                }
            }
            this._sendQueue.push(singlemessage);
            this._cleanupMessageQueue();
            return;
        }
        if (NoderedUtil.IsNullEmpty(message.id)) { message.id = NoderedUtil.GetUniqueIdentifier(); }
        for (let i: number = 0; i < messages.length; i++) {
            const _message: SocketMessage = SocketMessage.frommessage(message, messages[i], messages.length, i);
            this._sendQueue.push(_message);
        }
        if (NoderedUtil.IsNullEmpty(message.replyto) && message.command != "refreshtoken") {
            this.messageQueue[message.id] = new QueuedMessage(message, cb);
        } else {
            try {
                if (cb != null) cb(message);
            } catch (error) {
            }
        }
        this._cleanupMessageQueue();
        this.ProcessQueue(parent);
    }
    // cleanup old messageQueue messages
    private _cleanupMessageQueue(): void {
        const keys: string[] = Object.keys(this.messageQueue);
        keys.forEach(key => {
            const msg: QueuedMessage = this.messageQueue[key];
            if (msg != null) {
                const now = new Date();
                const seconds = (now.getTime() - msg.timestamp.getTime()) / 1000;
                if (seconds > Config.websocket_message_callback_timeout) {
                    delete this.messageQueue[key];
                }
            }
        });
    }    
    public chunkString(str: string, length: number): string[] | null {
        if (NoderedUtil.IsNullEmpty(str)) { return null; }
        // tslint:disable-next-line: quotemark
        return str.match(new RegExp('.{1,' + length + '}', 'g'));
    }
    async Queue(data: string, queuename: string, options: QueueMessageOptions, span: Span): Promise<any[]> {
        const d: any = JSON.parse(data);
        const q: QueueMessage = new QueueMessage();
        if (this.clientversion == "1.0.80.0" || this.clientversion == "1.0.81.0" || this.clientversion == "1.0.82.0" || this.clientversion == "1.0.83.0" || this.clientversion == "1.0.84.0" || this.clientversion == "1.0.85.0") {
            q.data = d.payload;
        } else {
            q.data = d;
        }
        q.replyto = options.replyTo;
        q.error = d.error;
        q.correlationId = options.correlationId; q.queuename = queuename;
        q.consumerTag = options.consumerTag;
        q.routingkey = options.routingKey;
        q.exchangename = options.exchangename;
        let m: Message = Message.fromcommand("queuemessage");
        if (NoderedUtil.IsNullEmpty(q.correlationId)) { q.correlationId = m.id; }
        m.data = JSON.stringify(q);
        const q2 = await this.Send<QueueMessage>(m, span);
        if ((q2 as any).command == "error") throw new Error(q2.data);
        return q2.data;
    }
    async UnWatch(id: string, jwt: string): Promise<void> {
        if (this.watches[id]) {
            delete this.watches[id];
        }
    }
    public watches: IHashTable<ClientWatch> = {};
    async Watch(aggregates: object[], collectionname: string, jwt: string, id: string = null): Promise<string> {
        if (typeof aggregates === "string") {
            try {
                aggregates = JSON.parse(aggregates);
            } catch (error) {
            }
        }
        // if (Array.isArray(aggregates)) {
        //     for (let p = 0; p < aggregates.length; p++) {
        //         let path = aggregates[p];
        //         if (typeof path === "string") {
        //             try {
        //                 path = JSON.parse(path);
        //             } catch (error) {
        //             }
        //         }
        //     }
        // }
        const stream: clsstream = new clsstream();
        stream.id = NoderedUtil.GetUniqueIdentifier();
        stream.collectionname = collectionname;
        stream.aggregates = aggregates;
        if (id == null) id = NoderedUtil.GetUniqueIdentifier();
        this.watches[id] = {
            aggregates, collectionname, id //, streamid: stream.id
        } as ClientWatch;
        return id;
    }
    SendWatch(watch: ClientWatch, next: any, span: Span) {
        var _type = next.fullDocument._type;
        let subspan: Span = Logger.otel.startSpan("Watch " + watch.collectionname + " " + next.operationType + " " + _type, null, null);
        try {
            Logger.instanse.verbose("Notify " + this.user.username + " of " + next.operationType + " " + next.fullDocument.name, span, { collection: watch.collectionname });
            const msg: SocketMessage = SocketMessage.fromcommand("watchevent");
            const q = new WatchEventMessage();
            const [traceId, spanId] = Logger.otel.GetTraceSpanId(subspan);
            q.traceId = traceId;
            q.spanId = spanId;

            q.id = watch.id;
            q.result = next;
            msg.data = JSON.stringify(q);
            this._socketObject.send(msg.tojson(), (err) => {
                if (err) {
                    var message: string = (err.message ? err.message : err as any);
                    Logger.instanse.warn(message, subspan, { collection: watch.collectionname });
                }
            });
        } catch (error) {
            Logger.instanse.error(error, span);
        } finally {
            subspan?.end();
        }
    }
}
export class ClientWatch {
    public id: string;
    public streamid: string;
    public aggregates: object[];
    public paths: string[];
    public collectionname: string;
}