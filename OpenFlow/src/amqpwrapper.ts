import * as amqplib from "amqplib";
import { Config } from "./Config";
import { Crypt } from "./Crypt";
import { NoderedUtil } from "@openiap/openflow-api";
import { WebSocketServer } from "./WebSocketServer";
import { Span } from "@opentelemetry/api";
import { Logger } from "./Logger";
import events = require("events");
import { Auth } from "./Auth";
import { Message } from "./Messages/Message";
type QueueOnMessage = (msg: string, options: QueueMessageOptions, ack: any, done: any) => void;
interface IHashTable<T> {
    [key: string]: T;
}
export type exchangealgorithm = "direct" | "fanout" | "topic" | "header";
export type QueueMessageOptions = {
    correlationId: string,
    replyTo: string,
    consumerTag: string,
    routingKey: string,
    exchange: string,
    priority: number
}
export type AssertQueue = {
    consumerCount: number;
    messageCount: number;
    queue: string;
}
export class Deferred<T> {
    promise: Promise<T>;
    reject: any;
    resolve: any;
    constructor() {
        const me: Deferred<T> = this;
        this.promise = new Promise<T>((resolve, reject) => {
            me.reject = reject;
            me.resolve = resolve;
        });
    }
}
export class amqpqueue {
    public queue: string;
    public queuename: string;
    public callback: QueueOnMessage;
    public ok: AssertQueue;
    public QueueOptions: any;
    public consumerTag: string;
}
export class amqpexchange {
    public exchange: string;
    public algorithm: string;
    public routingkey: string;
    public queue: amqpqueue;
    public callback: QueueOnMessage;
    public ok: amqplib.Replies.AssertExchange;
    public ExchangeOptions: any;
}
export declare interface amqpwrapper {
    on(event: 'connected', listener: () => void): this;
    on(event: 'disconnected', listener: () => void): this;
    on(event: string, listener: Function): this;
}
// tslint:disable-next-line: class-name
export class amqpwrapper extends events.EventEmitter {
    static waitFor(condition, callback) {
        if (!condition()) {
            setTimeout(amqpwrapper.waitFor.bind(null, condition, callback), 100); /* this checks the flag every 100 milliseconds*/
        } else {
            callback();
        }
    }
    // async version of static waitFor
    static async asyncWaitFor(condition) {
        return new Promise((resolve) => {
            this.waitFor(condition, resolve);
        });
    }
    public connected: boolean = false;
    private conn: amqplib.Connection;
    private channel: amqplib.ConfirmChannel;
    private connectionstring: string;
    public AssertExchangeOptions: any = { durable: false, confirm: true };
    public AssertQueueOptions: amqplib.any = { durable: true };
    private activecalls: IHashTable<Deferred<string>> = {};
    private queues: amqpqueue[] = [];
    private exchanges: amqpexchange[] = [];
    private replyqueue: amqpqueue;
    private static _instance: amqpwrapper = null;
    public static Instance(): amqpwrapper {
        return this._instance;
    }
    public static SetInstance(instance: amqpwrapper): void {
        this._instance = instance;
    }
    constructor(connectionstring: string) {
        super();
        this.connectionstring = connectionstring;
        if (!NoderedUtil.IsNullEmpty(Config.amqp_dlx)) {
            this.AssertQueueOptions.arguments = {};
            this.AssertQueueOptions.arguments['x-dead-letter-exchange'] = Config.amqp_dlx;
        }
    }
    private timeout: NodeJS.Timeout = null;
    public queuemessagecounter: object = {};
    public incqueuemessagecounter(queuename: string): number {
        let result: number = 0;
        if (!NoderedUtil.IsNullUndefinded(this.queuemessagecounter[queuename])) result = this.queuemessagecounter[queuename];
        result++;
        this.queuemessagecounter[queuename] = result;
        return result;
    }
    async connect(parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("amqpwrapper.connect", parent);
        try {
            if (this.timeout != null) {
                clearTimeout(this.timeout);
                this.timeout = null;
            }
            if (this.conn == null) {
                span?.addEvent("connect");
                this.conn = await amqplib.connect(this.connectionstring);
                this.conn.on('error', (error) => {
                    if (error.code != 404) {
                        Logger.instanse.error(error);
                    }
                });
                this.conn.on("close", () => {
                    if (Config.log_amqp) Logger.instanse.info("[AMQP] reconnecting");
                    this.conn = null;
                    if (this.timeout != null) {
                        clearTimeout(this.timeout);
                        this.timeout = null;
                    }
                    this.timeout = setTimeout(this.connect.bind(this), 1000);
                    this.emit("disconnected");
                });
            }
            try {
                span?.addEvent("AddReplyQueue");
                await this.AddReplyQueue(span);
            } catch (error) {
                Logger.instanse.error(error);
                if (Config.NODE_ENV == "production") {
                    Logger.instanse.error("Exit, when we cannot create reply queue");
                    process.exit(405);
                }
            }
            this.channel.on('error', (error) => {
                if (error.code != 404) {
                    Logger.instanse.error(error);
                }
            });
            try {
                await this.Adddlx(span);
                await this.AddOFExchange(span);
            } catch (error) {
                Logger.instanse.error(error);
                if (Config.NODE_ENV == "production") {
                    Logger.instanse.error("Exit, when we cannot create dead letter exchange and/or Openflow exchange");
                    process.exit(406);
                }
            }
            span?.addEvent("emit connected");
            this.emit("connected");
            this.connected = true;
        } catch (error) {
            span?.recordException(error);
            Logger.instanse.error(error);
            if (this.timeout != null) {
                clearTimeout(this.timeout);
                this.timeout = null;
            }
            if (error.message.startsWith("Expected amqp: or amqps:")) {
                throw error;
            }
            console.error(error);
            this.timeout = setTimeout(this.connect.bind(this), 1000);
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    shutdown() {
        this.connected = false;
        try {
            if (this.channel != null) {
                this.channel.removeAllListeners();
            }
        } catch (error) {
        }
        try {
            if (this.conn != null) {
                this.conn.removeAllListeners();
                this.conn.close();
            }
        } catch (error) {
        }
        this.channel = null;
        if (this.timeout != null) {
            clearTimeout(this.timeout);
            this.timeout = null;
        }
    }
    async AddReplyQueue(parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("AddReplyQueue", parent);
        try {
            this.channel = await this.conn.createConfirmChannel();
            this.channel.prefetch(Config.amqp_prefetch);
            this.replyqueue = await this.AddQueueConsumer("", null, null, (msg: any, options: QueueMessageOptions, ack: any, done: any) => {
                try {
                    if (this.replyqueue) {
                        if (!NoderedUtil.IsNullUndefinded(WebSocketServer.websocket_queue_message_count)) WebSocketServer.websocket_queue_message_count.
                            bind({ ...Logger.otel.defaultlabels, queuename: this.replyqueue.queue }).update(this.incqueuemessagecounter(this.replyqueue.queue));
                        if (!NoderedUtil.IsNullUndefinded(this.activecalls[options.correlationId])) {
                            this.activecalls[options.correlationId].resolve(msg);
                            delete this.activecalls[options.correlationId];
                        }
                    }
                } catch (error) {
                    console.error(error);
                }
                ack();
                done();
            }, undefined);
            // We don't want to recreate this
            this.queues = this.queues.filter(q => q.consumerTag != this.replyqueue.consumerTag);
            this.channel.on('return', async (e1) => {
                try {
                    let msg = e1.content.toString();
                    let exchange: string = "";
                    let routingKey: string = "";
                    let replyTo: string = "";
                    let correlationId: string = "";
                    let errormsg: string = "Send timeout";
                    if (e1.fields && e1.fields.replyText) errormsg = e1.fields.replyText;
                    if (e1.fields && e1.fields.exchange) exchange = e1.fields.exchange;
                    if (e1.fields && e1.fields.routingKey) routingKey = e1.fields.routingKey;
                    if (e1.properties && e1.properties.replyTo) replyTo = e1.properties.replyTo;
                    if (e1.properties && e1.properties.correlationId) correlationId = e1.properties.correlationId;

                    if (typeof msg === "string" || msg instanceof String) {
                        try {
                            msg = JSON.parse((msg as any));
                        } catch (error) {
                        }
                    }
                    if (!NoderedUtil.IsNullEmpty(replyTo)) {
                        if (typeof msg === "string" || msg instanceof String) {
                            msg = "timeout"
                        } else {
                            msg.command = "timeout";
                        }
                        if (Config.log_amqp) Logger.instanse.info("[AMQP][" + routingKey + "] notify " + replyTo + " " + errormsg + " to " + routingKey)
                        await amqpwrapper.Instance().send("", replyTo, msg, 20000, correlationId, "");
                    }
                } catch (error) {
                }
            })
            this.channel.on('close', () => {
                this.connected = false;
                try {
                    if (this.conn != null) this.conn.close();
                } catch (error) {
                }
                this.channel = null;
                if (this.timeout != null) {
                    clearTimeout(this.timeout);
                    this.timeout = null;
                }
                this.timeout = setTimeout(this.connect.bind(this), 1000);
            });
        } catch (error) {
            span?.recordException(error);
            Logger.instanse.error(error);
            return;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    async RemoveQueueConsumer(queue: amqpqueue, parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("amqpwrapper.RemoveQueueConsumer", parent);
        try {
            if (NoderedUtil.IsNullUndefinded(queue)) throw new Error("queue is mandatory");
            if (queue != null) {
                if (Config.log_amqp) Logger.instanse.info("[AMQP] Remove queue consumer " + queue.queue + "/" + queue.consumerTag);
                var exc = this.exchanges.filter(x => x.queue.consumerTag == queue.consumerTag);
                if (exc.length > 0) {
                    try {
                        this.channel.unbindQueue(exc[0].queue.queue, exc[0].exchange, exc[0].routingkey);
                    } catch (error) {
                        Logger.instanse.error(error);
                    }
                    if (this.channel != null) await this.channel.cancel(exc[0].queue.consumerTag);
                    this.exchanges = this.exchanges.filter(q => q.queue.consumerTag != queue.consumerTag);
                }
                var q = this.queues.filter(x => x.consumerTag == queue.consumerTag);
                if (q.length > 0) {
                    if (this.channel != null) await this.channel.cancel(queue.consumerTag);
                    this.queues = this.queues.filter(q => q.consumerTag != queue.consumerTag);
                }
            }
        } catch (error) {
            span?.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    async AddQueueConsumer(queuename: string, QueueOptions: any, jwt: string, callback: QueueOnMessage, parent: Span): Promise<amqpqueue> {
        const span: Span = Logger.otel.startSubSpan("amqpwrapper.AddQueueConsumer", parent);
        try {
            if (this.channel == null || this.conn == null) throw new Error("Cannot Add new Queue Consumer, not connected to rabbitmq");
            let queue: string = (NoderedUtil.IsNullEmpty(queuename) ? "" : queuename);
            const q: amqpqueue = new amqpqueue();
            q.callback = callback;
            q.QueueOptions = Object.assign({}, (QueueOptions != null ? QueueOptions : this.AssertQueueOptions));
            if (NoderedUtil.IsNullEmpty(queue)) queue = "";
            if (queue.startsWith("amq.")) queue = "";
            // if (NoderedUtil.IsNullEmpty(queue)) q.QueueOptions.exclusive = true;
            if (NoderedUtil.IsNullEmpty(queue)) q.QueueOptions.autoDelete = true;
            q.ok = await this.channel.assertQueue(queue, q.QueueOptions);
            if (q && q.ok) {
                this.queues.push(q);
                q.queue = q.ok.queue;
                q.queuename = queuename;
                const consumeresult = await this.channel.consume(q.ok.queue, (msg) => {
                    this.OnMessage(q, msg, q.callback);
                }, { noAck: false });
                q.consumerTag = consumeresult.consumerTag;
                if (Config.log_amqp) Logger.instanse.info("[AMQP] Added queue consumer " + q.queue + "/" + q.consumerTag);
            } else {
                throw new Error("Failed asserting Queue " + queue);
            }
            return q;
        } catch (error) {
            span?.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    async AddExchangeConsumer(exchange: string, algorithm: exchangealgorithm, routingkey: string, ExchangeOptions: any, jwt: string, callback: QueueOnMessage, parent: Span): Promise<amqpexchange> {
        const span: Span = Logger.otel.startSubSpan("amqpwrapper.AddExchangeConsumer", parent);
        try {
            if (NoderedUtil.IsNullEmpty(exchange)) throw new Error("exchange name cannot be empty");
            if (this.channel == null || this.conn == null) throw new Error("Cannot Add new Exchange Consumer, not connected to rabbitmq");
            const q: amqpexchange = new amqpexchange();
            if (!NoderedUtil.IsNullEmpty(q.queue)) {
                this.RemoveQueueConsumer(q.queue, span);
            }
            // q.ExchangeOptions = new Object((ExchangeOptions != null ? ExchangeOptions : this.AssertExchangeOptions));
            q.ExchangeOptions = Object.assign({}, (ExchangeOptions != null ? ExchangeOptions : this.AssertExchangeOptions));
            if (exchange != Config.amqp_dlx) q.ExchangeOptions.autoDelete = true;
            q.exchange = exchange; q.algorithm = algorithm; q.routingkey = routingkey; q.callback = callback;
            const _ok = await this.channel.assertExchange(q.exchange, q.algorithm, q.ExchangeOptions);
            let AssertQueueOptions = null;
            if (!NoderedUtil.IsNullEmpty(Config.amqp_dlx) && exchange == Config.amqp_dlx) {
                AssertQueueOptions = Object.create(this.AssertQueueOptions);
                delete AssertQueueOptions.arguments;
            }
            q.queue = await this.AddQueueConsumer("", AssertQueueOptions, jwt, q.callback, span);
            if (q.queue) {
                this.channel.bindQueue(q.queue.queue, q.exchange, q.routingkey);
                if (Config.log_amqp) Logger.instanse.info("[AMQP] Added exchange consumer " + q.exchange + ' to queue ' + q.queue.queue);
            }
            this.exchanges.push(q);
            return q;
        } catch (error) {
            span?.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    OnMessage(sender: amqpqueue, msg: amqplib.ConsumeMessage, callback: QueueOnMessage): void {
        try {
            const now = new Date();
            if (msg == null) {
                return;
            }

            const correlationId: string = msg.properties.correlationId;
            const replyTo: string = msg.properties.replyTo;
            const consumerTag: string = msg.fields.consumerTag;
            const routingKey: string = msg.fields.routingKey;
            const priority: number = (msg.properties.priority ? msg.properties.priority : 0);
            const exchange: string = msg.fields.exchange;
            const options: QueueMessageOptions = {
                correlationId,
                replyTo,
                consumerTag,
                routingKey,
                exchange,
                priority
            }
            const data: string = msg.content.toString();
            callback(data, options, (nack: boolean) => {
                try {
                    if (nack == false) {
                        this.channel.nack(msg);
                        // this.channel.nack(msg, false, true);
                        msg = null;
                        return;
                    }
                    this.channel.ack(msg);
                } catch (error) {
                    console.error(error);
                }
            }, (result) => {
            });
        } catch (error) {
            console.error(error);
        }
    }
    async sendWithReply(exchange: string, queue: string, data: any, expiration: number, correlationId: string, routingkey: string): Promise<string> {
        if (NoderedUtil.IsNullEmpty(correlationId)) correlationId = NoderedUtil.GetUniqueIdentifier();
        var promise = new Deferred<string>();
        this.activecalls[correlationId] = promise;
        if (this.replyqueue) {
            await this.sendWithReplyTo(exchange, queue, this.replyqueue.queue, data, expiration, correlationId, routingkey);
        }
        return promise.promise;
    }
    async sendWithReplyTo(exchange: string, queue: string, replyTo: string, data: any, expiration: number, correlationId: string, routingkey: string, priority: number = 1): Promise<void> {
        await amqpwrapper.asyncWaitFor(() => this.connected);
        if (this.channel == null || this.conn == null) {
            throw new Error("Cannot send message, when not connected");
        }
        if (typeof data !== 'string' && !(data instanceof String)) {
            data = JSON.stringify(data);
        }
        if (Config.log_amqp) Logger.instanse.silly("send to queue: " + queue + " exchange: " + exchange + " with reply to " + replyTo + " correlationId: " + correlationId);
        const options: any = { mandatory: true };
        options.replyTo = replyTo;
        if (NoderedUtil.IsNullEmpty(correlationId)) correlationId = NoderedUtil.GetUniqueIdentifier();
        if (!NoderedUtil.IsNullEmpty(correlationId)) options.correlationId = correlationId;
        if (expiration < 1) expiration = Config.amqp_default_expiration;
        options.expiration = expiration.toString();
        options.mandatory = true;
        // options.confirm = true;
        // options.persistent = true;
        // options.durable = true;
        // options.mandatory = true;
        // options.immediate = true;
        options.priority = priority;
        if (NoderedUtil.IsNullEmpty(exchange)) {
            this.channel.publish("", queue, Buffer.from(data), options);
            await this.channel.waitForConfirms();
            if (!NoderedUtil.IsNullUndefinded(WebSocketServer.websocket_queue_message_count)) WebSocketServer.websocket_queue_message_count.
                bind({ ...Logger.otel.defaultlabels, queuename: queue }).update(this.incqueuemessagecounter(queue));
        } else {
            if (NoderedUtil.IsNullEmpty(routingkey)) routingkey = "";
            this.channel.publish(exchange, routingkey, Buffer.from(data), options);
        }
    }
    async send(exchange: string, queue: string, data: any, expiration: number, correlationId: string, routingkey: string, priority: number = 1): Promise<void> {
        await amqpwrapper.asyncWaitFor(() => this.connected);
        if (this.channel == null || this.conn == null) {
            throw new Error("Cannot send message, when not connected");
        }
        if (typeof data !== 'string' && !(data instanceof String)) {
            data = JSON.stringify(data);
        }
        if (NoderedUtil.IsNullEmpty(correlationId)) correlationId = NoderedUtil.GetUniqueIdentifier();
        if (Config.log_amqp) Logger.instanse.silly("send to queue: " + queue + " exchange: " + exchange);
        const options: any = { mandatory: true };
        if (!NoderedUtil.IsNullEmpty(correlationId)) options.correlationId = correlationId;
        if (expiration < 1) expiration = Config.amqp_default_expiration;
        options.expiration = expiration.toString();
        options.mandatory = true;
        options.priority = priority;
        // options.confirm = true;
        // options.persistent = true;
        // options.durable = true;
        // options.mandatory = true;
        // options.immediate = true;
        if (NoderedUtil.IsNullEmpty(exchange)) {
            this.channel.publish("", queue, Buffer.from(data), options);
            await this.channel.waitForConfirms();
            if (!NoderedUtil.IsNullUndefinded(WebSocketServer.websocket_queue_message_count)) WebSocketServer.websocket_queue_message_count.
                bind({ ...Logger.otel.defaultlabels, queuename: queue }).update(this.incqueuemessagecounter(queue));
        } else {
            this.channel.publish(exchange, routingkey, Buffer.from(data), options);
        }
    }
    async Adddlx(parent: Span) {
        if (NoderedUtil.IsNullEmpty(Config.amqp_dlx)) return;
        await this.AddExchangeConsumer(Config.amqp_dlx, "fanout", "", null, null, async (msg: any, options: QueueMessageOptions, ack: any, done: any) => {
            if (typeof msg === "string" || msg instanceof String) {
                try {
                    msg = JSON.parse((msg as any));
                } catch (error) {
                }
            }
            try {
                if (typeof msg === "string" || msg instanceof String) {
                    msg = "timeout"
                } else {
                    msg.command = "timeout";
                }
                // Resend message, this time to the reply queue for the correct node (replyTo)
                if (Config.log_amqp) Logger.instanse.info("[DLX][" + options.exchange + "] Send timeout to " + options.replyTo + " correlationId: " + options.correlationId);
                // await amqpwrapper.Instance().sendWithReply("", options.replyTo, msg, 20000, options.correlationId, "");
                await amqpwrapper.Instance().send("", options.replyTo, msg, 20000, options.correlationId, "");
            } catch (error) {
                console.error("Failed sending deadletter message to " + options.replyTo);
                console.error(error);
            }
            ack();
            done();
        }, parent);
    }
    IsMyconsumerTag(consumerTag: string) {
        var q = this.queues.filter(q => q.consumerTag == consumerTag);
        return q.length != 0;
    }
    async AddOFExchange(parent: Span) {
        if (!Config.enable_openflow_amqp) return;
        await this.AddExchangeConsumer("openflow", "fanout", "", null, null, async (msg: any, options: QueueMessageOptions, ack: any, done: any) => {
            if (typeof msg === "string" || msg instanceof String) {
                try {
                    msg = JSON.parse((msg as any));
                } catch (error) {
                }
            }
            if (typeof msg !== "string") {
                if (Config.log_amqp) Logger.instanse.info("[OF][" + options.exchange + "] Received command " + msg.command);
                switch (msg.command) {
                    case "clearcache":
                        Auth.clearCache("amqp broadcast");
                        break;
                    case "housekeeping":
                        // if (this.IsMyconsumerTag(options.consumerTag)) break;
                        if (msg.lastrun) {
                            console.log("set lastHouseKeeping too " + msg.lastrun)
                            Message.lastHouseKeeping = new Date(msg.lastrun);
                        } else {
                            if (Message.lastHouseKeeping != null) {
                                amqpwrapper.Instance().send("openflow", "", { "command": "housekeeping", "lastrun": Message.lastHouseKeeping.toISOString() }, 20000, null, "", 1);
                            }
                        }
                        break;
                    case "shutdown":
                        try {
                            await Config.db.shutdown();
                            await Logger.otel.shutdown();
                            await Logger.License.shutdown()
                            await Auth.shutdown();
                        } catch (error) {
                            console.error(error);
                        }
                        process.exit(404);
                        // process.kill(process.pid, "SIGINT");
                        break;
                    default:
                        console.error("[OF] Received unknown command: " + msg.command);
                        break;
                }
            } else {
                if (Config.log_amqp) Logger.instanse.verbose("[OF] Received string message: " + JSON.stringify(msg));
            }
            ack();
            done();
        }, parent);
    }
}