import amqplib from "amqplib";
import { Config } from "./Config.js";
import { Crypt } from "./Crypt.js";
import { NoderedUtil, User } from "@openiap/openflow-api";
import { WebSocketServer } from "./WebSocketServer.js";
import { Span } from "@opentelemetry/api";
import { Logger } from "./Logger.js";
import events from "events";
import { Message } from "./Messages/Message.js";
import { WebSocketServerClient } from "./WebSocketServerClient.js";
import { HouseKeeping } from "./HouseKeeping.js";
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
    exchangename: string,
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
    on(event: "connected", listener: () => void): this;
    on(event: "disconnected", listener: () => void): this;
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
    public AssertQueueOptions: amqplib.Options.AssertQueue = { durable: true };
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
            this.AssertQueueOptions.arguments["x-dead-letter-exchange"] = Config.amqp_dlx;
        }
        this.setMaxListeners(1500);
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
    conn_error(error) {
        if (error.code != 404) {
            Logger.instanse.error(error, null);
        }
    }
    conn_close() {
        this.of_logger_ready = false;
        Logger.instanse.info("Connection closed", null);
        this.conn = null;
        if (this.timeout != null) {
            clearTimeout(this.timeout);
            this.timeout = null;
        }
        this.timeout = setTimeout(this.connect.bind(this), 1000);
        this.emit("disconnected");
    }
    channel_error(error) {
        if (error.code != 404) {
            Logger.instanse.error(error, null);
        }
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
                Logger.instanse.info("Connecting to rabbitmq", span);
                this.conn = await amqplib.connect(this.connectionstring);
                Logger.instanse.info("Connected to rabbitmq", span);
                this.conn.on("error", this.conn_error);
                this.conn.on("close", this.conn_close);
            }
            try {
                span?.addEvent("AddReplyQueue");
                await this.AddReplyQueue(span);
                this.channel.on("error", this.channel_error);
            } catch (error) {
                Logger.instanse.error(error, span);
                if (Config.NODE_ENV == "production") {
                    Logger.instanse.error("Exit, when we cannot create reply queue", span);
                    process.exit(405);
                }
            }
            try {
                await this.Adddlx(span);
                await this.AddOFExchange(span);
                await this.AddOFLogExchange(span);
            } catch (error) {
                this.of_logger_ready = false;
                Logger.instanse.error(error, span);
                if (Config.NODE_ENV == "production") {
                    Logger.instanse.error("Exit, when we cannot create dead letter exchange and/or Openflow exchange", span);
                    process.exit(406);
                }
            }
            span?.addEvent("emit connected");
            this.emit("connected");
            this.connected = true;
        } catch (error) {
            this.of_logger_ready = false;
            Logger.instanse.error(error, span);
            if (this.timeout != null) {
                clearTimeout(this.timeout);
                this.timeout = null;
            }
            if (error.message.startsWith("Expected amqp: or amqps:")) {
                throw error;
            }
            Logger.instanse.error(error, span);
            this.timeout = setTimeout(this.connect.bind(this), 1000);
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    shutdown() {
        this.connected = false;
        this.of_logger_ready = false;
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
    reply_queue_message(msg: any, options: QueueMessageOptions, ack: any, done: any) {
        ack();
        try {
            if (this.replyqueue) {
                if (!NoderedUtil.IsNullUndefinded(WebSocketServer.websocket_queue_message_count))
                    WebSocketServer.websocket_queue_message_count.add(1, { ...Logger.otel.defaultlabels, queuename: this.replyqueue.queue });
                if (!NoderedUtil.IsNullUndefinded(this.activecalls[options.correlationId])) {
                    this.activecalls[options.correlationId].resolve(msg);
                    delete this.activecalls[options.correlationId];
                }
            }
        } catch (error) {
            Logger.instanse.error(error, null);
        }
        done();
    }
    static bad_queues: string[] = [];
    async reply_queue_return(e1) {
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
            if(routingKey != null && routingKey != "") {
                if(amqpwrapper.bad_queues.length > 100) {
                    amqpwrapper.bad_queues.shift();
                }
                if(amqpwrapper.bad_queues.indexOf(routingKey) == -1) {
                    amqpwrapper.bad_queues.push(routingKey);
                }
            }
            if (!NoderedUtil.IsNullEmpty(replyTo)) {
                if (typeof msg === "string" || msg instanceof String) {
                    msg = "timeout"
                } else {
                    msg.command = "timeout";
                }
                Logger.instanse.debug("[" + routingKey + "] notify " + replyTo + " " + errormsg + " to " + routingKey, null)
                await amqpwrapper.Instance().send("", replyTo, msg, 20000, correlationId, "", null);
            }
        } catch (error) {
        }
    }
    async reply_queue_close(msg) {
        this.of_logger_ready = false;
        Logger.instanse.error("Exit, reply channel was closed " + msg, null);
        process.exit(406);
    }
    async AddReplyQueue(parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("AddReplyQueue", parent);
        try {
            this.channel = await this.conn.createConfirmChannel();
            this.channel.prefetch(Config.amqp_prefetch);
            this.replyqueue = await this.AddQueueConsumer(Crypt.rootUser(), "", null, null, this.reply_queue_message.bind(this), undefined);
            // We don't want to recreate this
            this.queues = this.queues.filter(q => q.consumerTag != this.replyqueue.consumerTag);
            this.channel.on("return", this.reply_queue_return.bind(this))
            this.channel.on("close", this.reply_queue_close.bind(this));
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    async RemoveQueueConsumer(user: User, queue: amqpqueue, parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("amqpwrapper.RemoveQueueConsumer", parent);
        try {
            if (NoderedUtil.IsNullUndefinded(queue)) throw new Error("queue is mandatory");
            if (queue != null) {
                Logger.instanse.debug("[" + user?.username + "] Remove queue consumer " + queue.queue + "/" + queue.consumerTag, span);
                var exc = this.exchanges.filter(x => x.queue?.consumerTag == queue.consumerTag);
                if (exc.length > 0) {
                    try {
                        await this.channel.unbindQueue(exc[0].queue.queue, exc[0].exchange, exc[0].routingkey);
                    } catch (error) {
                        Logger.instanse.error(error, span);
                    }
                    if (this.channel != null) {
                        if (exc[0].queue) await this.channel.cancel(exc[0].queue.consumerTag);
                    }
                    this.exchanges = this.exchanges.filter(q => q.queue?.consumerTag != queue.consumerTag);
                }
                var q = this.queues.filter(x => x.consumerTag == queue.consumerTag);
                if (q.length > 0) {
                    if (this.channel != null) await this.channel.cancel(queue.consumerTag);
                    this.queues = this.queues.filter(q => q.consumerTag != queue.consumerTag);
                }
            }
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    async AddQueueConsumer(user: User, queuename: string, QueueOptions: any, jwt: string, callback: QueueOnMessage, parent: Span): Promise<amqpqueue> {
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
                if(amqpwrapper.bad_queues.indexOf(q.queue) != -1) {
                    amqpwrapper.bad_queues.splice(amqpwrapper.bad_queues.indexOf(q.queue), 1);
                }
                const consumeresult = await this.channel.consume(q.ok.queue, (msg) => {
                    this.OnMessage(q, msg, q.callback);
                }, { noAck: false });
                q.consumerTag = consumeresult.consumerTag;
                Logger.instanse.debug("[" + user?.username + "] Added queue consumer " + q.queue + "/" + q.consumerTag, span);
            } else {
                throw new Error("Failed asserting Queue " + queue);
            }
            return q;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    async checkAndDeleteExchange(exchangeName) {
        let conn = await amqplib.connect(this.connectionstring);
        try {
            const channel = await conn.createChannel();
            try {
                // Try to check if exchange exists by declaring it passively
                await channel.checkExchange(exchangeName);
    
                // If no error is thrown, exchange exists, so delete it
                await channel.deleteExchange(exchangeName);
                // console.log(`Exchange '${exchangeName}' deleted.`);
            } catch (err) {
                // Error means exchange does not exist
                console.log(`Exchange '${exchangeName}' does not exist or there was an error checking it.`);
            }
        } catch (error) {
            console.error("Error connecting to RabbitMQ:", error);
        } finally {
            conn.close();
      }
    }
    async PreAssertExchange(exchangeName: string, algorithm: string, ExchangeOptions: any): Promise<boolean> {
        let conn = await amqplib.connect(this.connectionstring);
        try {
            const channel = await conn.createChannel();
            try {
                const _ok = await channel.assertExchange(exchangeName, algorithm, ExchangeOptions);
                // console.log(`Exchange '${exchangeName}' exists.`);
                return true;
            } catch (err) {
                // Error means exchange does not exist
                console.log(`Exchange '${exchangeName}' has wrong config`);
                return false;
            }
        } catch (error) {
            console.error("Error connecting to RabbitMQ:", error);
        } finally {
            conn.close();
      }
        
    }
    async PreRegisterExchange(exchange: any, parent: Span) {
        if(exchange.name == "openflow") {
            return
        }
        var exchangename = exchange;
        if(exchange.name != null) exchangename = exchange.name;
        // @ts-ignore
        let { algorithm, routingkey, exclusive } = exchange;
        if(algorithm == null || algorithm == "") algorithm = "fanout"
        if(routingkey == null || routingkey == "") routingkey = ""
        if(exclusive == null || exclusive == "") exclusive = true
        const AssertExchangeOptions: any = Object.assign({}, (amqpwrapper.Instance().AssertExchangeOptions));
        AssertExchangeOptions.exclusive = exclusive;
        // if (exchangename != Config.amqp_dlx && exchangename != "openflow" && exchangename != "openflow_logs") AssertExchangeOptions.autoDelete = true;
        AssertExchangeOptions.autoDelete = false;

        // // try and create exchange
        // if(! await this.PreAssertExchange(exchangename, algorithm, AssertExchangeOptions)) {
        //     // config differs, so delete and recreate
        //     await this.checkAndDeleteExchange(exchangename);
        //     await this.PreAssertExchange(exchangename, algorithm, AssertExchangeOptions);
        // }
        // await amqpwrapper.Instance().AddExchangeConsumer(
        //     Crypt.rootUser(), exchange.name, algorithm, routingkey, AssertExchangeOptions, Crypt.rootToken(), false, null, parent);
    }
    async AddExchangeConsumer(user: User, exchange: string, algorithm: exchangealgorithm, routingkey: string, ExchangeOptions: any, jwt: string, addqueue: boolean, callback: QueueOnMessage, parent: Span): Promise<amqpexchange> {
        const span: Span = Logger.otel.startSubSpan("amqpwrapper.AddExchangeConsumer", parent);
        try {
            if (NoderedUtil.IsNullEmpty(exchange)) throw new Error("exchange name cannot be empty");
            if (this.channel == null || this.conn == null) throw new Error("Cannot Add new Exchange Consumer, not connected to rabbitmq");
            const q: amqpexchange = new amqpexchange();
            q.ExchangeOptions = Object.assign({}, (ExchangeOptions != null ? ExchangeOptions : this.AssertExchangeOptions));
            // if (exchange != Config.amqp_dlx && exchange != "openflow" && exchange != "openflow_logs") q.ExchangeOptions.autoDelete = true;
            q.ExchangeOptions.autoDelete = false;
            q.exchange = exchange; q.algorithm = algorithm; q.routingkey = routingkey; q.callback = callback;
            // await this.PreRegisterExchange(exchange, span)
            const _ok = await this.channel.assertExchange(q.exchange, q.algorithm, q.ExchangeOptions);
            if (addqueue) {
                let AssertQueueOptions = null;
                if (!NoderedUtil.IsNullEmpty(Config.amqp_dlx) && exchange == Config.amqp_dlx) {
                    AssertQueueOptions = Object.create(this.AssertQueueOptions);
                    delete AssertQueueOptions.arguments;
                }
                q.queue = await this.AddQueueConsumer(user, "", AssertQueueOptions, jwt, q.callback, span);
                if (q.queue) {
                    this.channel.bindQueue(q.queue.queue, q.exchange, q.routingkey);
                    if(amqpwrapper.bad_queues.indexOf(q.queue.queue) != -1) {
                        amqpwrapper.bad_queues.splice(amqpwrapper.bad_queues.indexOf(q.queue.queue), 1);
                    }
                    Logger.instanse.debug("[" + user?.username + "] Added exchange consumer " + q.exchange + " to queue " + q.queue.queue, span);
                }
            }
            this.exchanges.push(q);
            return q;
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
            const exchangename: string = msg.fields.exchange;
            const options: QueueMessageOptions = {
                correlationId,
                replyTo,
                consumerTag,
                routingKey,
                exchangename,
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
                    Logger.instanse.error(error, null);
                }
            }, (result) => {
            });
        } catch (error) {
            Logger.instanse.error(error, null);
        }
    }
    async sendWithReply(exchange: string, queue: string, data: any, expiration: number, correlationId: string, routingkey: string, span: Span): Promise<string> {
        if (NoderedUtil.IsNullEmpty(correlationId)) correlationId = NoderedUtil.GetUniqueIdentifier();
        var promise = new Deferred<string>();
        this.activecalls[correlationId] = promise;
        if (this.replyqueue) {
            await this.sendWithReplyTo(exchange, queue, this.replyqueue.queue, data, expiration, correlationId, routingkey, span);
        }
        return promise.promise;
    }
    async sendWithReplyTo(exchange: string, queue: string, replyTo: string, data: any, expiration: number, correlationId: string, routingkey: string, span: Span, priority: number = 1): Promise<void> {
        await amqpwrapper.asyncWaitFor(() => this.connected);
        if(data)
        if (this.channel == null || this.conn == null) {
            throw new Error("Cannot send message, when not connected");
        }
        try {
            if (typeof data === "string" || ((data as any) instanceof String)) {
                data = JSON.parse(data);
            }
            const [traceId, spanId] = Logger.otel.GetTraceSpanId(span);
            if (!NoderedUtil.IsNullEmpty(traceId)) {
                data.traceId = traceId;
                data.spanId = spanId;
            }
        } catch (error) {
        }
        if (typeof data !== "string" && !(data instanceof String)) {
            data = JSON.stringify(data);
        }
        // PRECONDITION_FAILED - message size 155339741 is larger than configured max size 134217728
        if(data.length > 130000000 ) {
            Logger.instanse.error("send to queue: " + queue + " exchange: " + exchange + " PRECONDITION_FAILED - message size " + data.length + " is larger than configured max size 130000000", span);
            throw new Error("PRECONDITION_FAILED - message size " + data.length + " is larger than configured max size 130000000")
        }
        Logger.instanse.silly("send to queue: " + queue + " exchange: " + exchange + " with reply to " + replyTo + " correlationId: " + correlationId, span);
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
            if (!NoderedUtil.IsNullUndefinded(WebSocketServer.websocket_queue_message_count))
                WebSocketServer.websocket_queue_message_count.add(1, { ...Logger.otel.defaultlabels, queuename: queue });
        } else {
            if (NoderedUtil.IsNullEmpty(routingkey)) routingkey = "";
            if(exchange != "openflow" && exchange != "openflow_logs") {
                // console.log("publishing to exchange: " + exchange + " routingkey: " + routingkey + " correlationId: " + correlationId);
            }
            await this.PreRegisterExchange(exchange, span)
            this.channel.publish(exchange, routingkey, Buffer.from(data), options);
        }
    }
    async send(exchange: string, queue: string, data: any, expiration: number, correlationId: string, routingkey: string, span: Span, priority: number = 1): Promise<void> {
        if (exchange == "openflow" && !Config.enable_openflow_amqp) return;
        await amqpwrapper.asyncWaitFor(() => this.connected);
        if (this.channel == null || this.conn == null) {
            throw new Error("Cannot send message, when not connected");
        }
        try {
            if (typeof data === "string" || ((data as any) instanceof String)) {
                data = JSON.parse(data);
            }
            const [traceId, spanId] = Logger.otel.GetTraceSpanId(span);
            if (!NoderedUtil.IsNullEmpty(traceId)) {
                data.traceId = traceId;
                data.spanId = spanId;
            }
        } catch (error) {
        }
        if (typeof data !== "string" && !(data instanceof String)) {
            data = JSON.stringify(data);
        }
        if(data.length > 130000000 ) {
            Logger.instanse.error("send to queue: " + queue + " exchange: " + exchange + " PRECONDITION_FAILED - message size " + data.length + " is larger than configured max size 130000000", span);
            throw new Error("PRECONDITION_FAILED - message size " + data.length + " is larger than configured max size 130000000")
        }
        if (NoderedUtil.IsNullEmpty(correlationId)) correlationId = NoderedUtil.GetUniqueIdentifier();
        if (exchange != "openflow_logs") Logger.instanse.silly("send to queue: " + queue + " exchange: " + exchange, span);
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

            if (!NoderedUtil.IsNullUndefinded(WebSocketServer.websocket_queue_message_count))
                WebSocketServer.websocket_queue_message_count.add(1, { ...Logger.otel.defaultlabels, queuename: queue });
        } else {
            if(exchange != "openflow" && exchange != "openflow_logs") {
                // console.log("publishing to exchange: " + exchange + " routingkey: " + routingkey + " correlationId: " + correlationId);
            }
            await this.PreRegisterExchange(exchange, span)
            this.channel.publish(exchange, routingkey, Buffer.from(data), options);
        }
    }
    async Adddlx(span: Span) {
        if (NoderedUtil.IsNullEmpty(Config.amqp_dlx)) return;
        await this.AddExchangeConsumer(Crypt.rootUser(), Config.amqp_dlx, "fanout", "", null, null, true, async (msg: any, options: QueueMessageOptions, ack: any, done: any) => {
            ack();
            if (typeof msg === "string" || msg instanceof String) {
                try {
                    msg = JSON.parse((msg as any));
                } catch (error) {
                }
            }
            try {
                var ismine = this.IsMyQueue(options.replyTo);
                if (typeof msg === "string" || msg instanceof String) {
                    msg = "timeout"
                } else {
                    msg.command = "timeout";
                }
                if (ismine) {
                    // Resend message, this time to the reply queue for the correct node (replyTo)
                    Logger.instanse.warn("[" + options.exchangename + "] Send timeout to " + options.replyTo + " correlationId: " + options.correlationId, span);
                    // await amqpwrapper.Instance().sendWithReply("", options.replyTo, msg, 20000, options.correlationId, "");
                    await amqpwrapper.Instance().send("", options.replyTo, msg, 20000, options.correlationId, "", span);
                } else {
                    if (!msg.hasOwnProperty("cls")) {
                        Logger.instanse.debug("[" + options.exchangename + "] Received timeout, (not handled by me) to " + options.replyTo + " correlationId: " + options.correlationId, span);
                    }
                }
            } catch (error) {
                Logger.instanse.error("Failed sending deadletter message to " + options.replyTo, span);
                Logger.instanse.error(error, span);
            }
            done();
        }, span);
    }
    IsMyconsumerTag(consumerTag: string) {
        var q = this.queues.filter(q => q.consumerTag == consumerTag);
        return q.length != 0;
    }
    IsMyQueue(queuename: string) {
        var q = this.queues.filter(q => q.queuename == queuename || q.queue == queuename);
        return q.length != 0;
    }
    public of_logger_ready: boolean = false;
    async AddOFLogExchange(parent: Span) {
        // if (!Config.enable_openflow_amqp) return; // Listen no matter what, but we don't use it unless enable_openflow_amqp is true
        await amqpwrapper.Instance().AddExchangeConsumer(Crypt.rootUser(), "openflow_logs", "fanout", "",
            null, null, true, async (msg: any, options: any, ack: any, done: any) => {
                ack();
                done();
            }, parent)
        this.of_logger_ready = true;
    }
    async AddOFExchange(parent: Span) {
        // if (!Config.enable_openflow_amqp) return; // Listen no matter what, but we don't use it unless enable_openflow_amqp is true
        await this.AddExchangeConsumer(Crypt.rootUser(), "openflow", "fanout", "",
            null, null, true, async (msg: any, options: QueueMessageOptions, ack: any, done: any) => {
            ack();
                let span: Span;
            try {
                if (typeof msg === "string" || msg instanceof String) {
                    try {
                        msg = JSON.parse((msg as any));
                    } catch (error) {
                    }
                }
                span = Logger.otel.startSpan("Openflow Exchange " + msg.command, msg.traceId, msg.spanId);

                if (typeof msg !== "string") {
                    Logger.instanse.debug("[" + options.exchangename + "] Received command " + msg.command, span);
                    switch (msg.command) {
                        case "clearcache":
                            if (NoderedUtil.IsNullEmpty(msg.key)) {
                                Logger.DBHelper.clearCache("amqp broadcast", span);
                            } else {
                                Logger.DBHelper.DeleteKey(msg.key, false, true, span);
                            }
                            break;
                        case "housekeeping":
                            // if (this.IsMyconsumerTag(options.consumerTag)) break;
                            if (msg.lastrun) {
                                Logger.instanse.debug("[" + options.exchangename + "] " + msg.lastrun, span)
                                HouseKeeping.lastHouseKeeping = new Date(msg.lastrun);
                            } else {
                                if (HouseKeeping.lastHouseKeeping != null) {
                                    amqpwrapper.Instance().send("openflow", "", { "command": "housekeeping", "lastrun": HouseKeeping.lastHouseKeeping.toISOString() }, 20000, null, "", span, 1);
                                }
                            }
                            break;
                        case "heapdump":
                            Logger.otel.createheapdump(span);
                            break;
                        case "shutdown":
                            try {
                                // Force exit after 5 seconds
                                setTimeout(() => {
                                    process.exit(0);
                                }, 5000);
                                // clean shutdown
                                await Config.db.shutdown();
                                await Logger.otel.shutdown();
                                await Logger.License.shutdown()
                                process.exit(0);
                            } catch (error) {
                                Logger.instanse.error(error, span);
                            }
                            process.exit(404);
                            // process.kill(process.pid, "SIGINT");
                            break;
                        case "dumpwebsocketclients":
                            WebSocketServer.DumpClients(span);
                            break;
                        case "notifywebsocketclients":                            
                            WebSocketServer.NotifyClients(msg, span);
                            break;
                        case "killwebsocketclient":
                            for (let i = WebSocketServer._clients.length - 1; i >= 0; i--) {
                                const cli: WebSocketServerClient = WebSocketServer._clients[i];
                                if (cli.id == msg.id) {
                                    Logger.instanse.warn("Killing websocket client " + msg.id, span);
                                    cli.Close(span);
                                }
                            }
                            break;
                        default:
                            Logger.instanse.error(new Error("[OF] Received unknown command: " + msg.command), span);
                            break;
                    }
                } else {
                    Logger.instanse.verbose("Received string message: " + JSON.stringify(msg), span);
                }
            } catch (error) {
                Logger.instanse.error(error, span);
            } finally {
                span?.end();
            }
            done();
        }, parent);
    }
}