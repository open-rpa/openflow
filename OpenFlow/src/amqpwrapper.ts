import * as winston from "winston";
import * as amqplib from "amqplib";
import { Util } from "./Util";
import { Config } from "./Config";

type QueueOnMessage = (msg: string, options: QueueMessageOptions, ack: any, done: any) => void;
interface IHashTable<T> {
    [key: string]: T;
}
export type QueueMessageOptions = {
    correlationId: string,
    replyTo: string,
    consumerTag: string,
    routingkey: string,
    exchange: string
}
type AssertQueue = {
    consumerCount: number;
    messageCount: number;
    queue: string;
}
export class Deferred<T> {
    promise: Promise<T>;
    reject: any;
    resolve: any;
    constructor() {
        var me: Deferred<T> = this;
        this.promise = new Promise<T>((resolve, reject) => {
            me.reject = reject;
            me.resolve = resolve;
        });
    }
}
export class amqpqueue {
    public queue: string;
    public callback: QueueOnMessage;
    public ok: AssertQueue;
    public QueueOptions: any;
    public consumerTag: string;
}
export class amqpexchange {
    public exchange: string;
    public algorithm: string;
    public routingkey: string;
    public queue: string;
    public callback: QueueOnMessage;
    public ok: amqplib.Replies.AssertExchange;
    public ExchangeOptions: any;
}

// tslint:disable-next-line: class-name
export class amqpwrapper {
    private conn: amqplib.Connection;
    private channel: amqplib.Channel; // channel: amqplib.ConfirmChannel;
    private _logger: winston.Logger;
    private connectionstring: string;
    public AssertExchangeOptions: any = { durable: false, confirm: true };
    public AssertQueueOptions: any = {};
    private activecalls: IHashTable<Deferred<string>> = {};
    private queues: IHashTable<amqpqueue> = {};
    private exchanges: IHashTable<amqpexchange> = {};
    private replyqueue: string;

    private static _instance: amqpwrapper = null;
    public static Instance(): amqpwrapper {
        return this._instance;
    }
    public static SetInstance(instance: amqpwrapper): void {
        this._instance = instance;
    }
    private static _testinstance: amqpwrapper = null;
    public static TestInstance(): amqpwrapper {
        return this._testinstance;
    }
    public static SetTestInstance(instance: amqpwrapper): void {
        this._testinstance = instance;
    }

    // private callback: QueueOnMessage;
    // private algorithm: string;
    // private routingkey: string;
    // public exchange: string;
    // public queue: string;
    // private _ok: amqplib.Replies.AssertExchange;
    private _ok: AssertQueue;

    constructor(logger: winston.Logger, connectionstring: string) {
        this._logger = logger;
        this.connectionstring = connectionstring;

        //if (!Util.IsNullEmpty(Config.deadLetterExchange) && exchange != Config.deadLetterExchange) {
        // this.AssertExchangeOptions.arguments = {};
        // this.AssertExchangeOptions.arguments['x-message-ttl'] = Config.dlxmessagettl;
        // this.AssertQueueOptions.arguments = {};
        // this.AssertQueueOptions.arguments['x-dead-letter-exchange'] = Config.deadLetterExchange;
        // this.AssertQueueOptions.arguments['x-message-ttl'] = Config.dlxmessagettl;

        // this.AssertExchangeOptions.arguments['x-dead-letter-exchange'] = Config.deadLetterExchange;
        // if (!Util.IsNullEmpty(routingkey)) this.AssertExchangeOptions.arguments['x-dead-letter-routing-key'] = routingkey;
        // this.AssertExchangeOptions.arguments['x-expires'] = Config.dlxmessageexpires;
        // if (!Util.IsNullEmpty(routingkey)) this.AssertQueueOptions.arguments['x-dead-letter-routing-key'] = routingkey;
        // this.AssertQueueOptions.arguments['x-expires'] = Config.dlxmessageexpires;

        // Bad idear ... 
        // this.AssertExchangeOptions.arguments['alternate-exchange'] = Config.deadLetterExchange;
        //}
    }
    private timeout: NodeJS.Timeout = null;
    async connect(): Promise<void> {
        if (this.timeout != null) {
            this.timeout = null;
        }
        var me: amqpwrapper = this;
        if (this.conn == null) {
            this.conn = await amqplib.connect(this.connectionstring);
            this.conn.on('error', (error) => {
                if (error.code != 404) {
                    this._logger.error(JSON.stringify(error));
                    console.log(error);
                }
            });
            this.conn.on("close", () => {
                this._logger.info("[AMQP] reconnecting");
                this.conn = null;
                if (this.timeout == null) {
                    this.timeout = setTimeout(this.connect.bind(this), 1000);
                }
            });
        }
        this.channel = await this.conn.createChannel();
        if (!Util.IsNullEmpty(this.replyqueue)) {
            delete this.queues[this.replyqueue];
        }
        this.replyqueue = await this.AddQueueConsumer("", null, (msg: any, options: QueueMessageOptions, ack: any, done: any) => {
            if (!Util.IsNullUndefinded(this.activecalls[options.correlationId])) {
                this.activecalls[options.correlationId].resolve(msg);
                this.activecalls[options.correlationId] = null;
                delete this.activecalls[options.correlationId];
            }
            ack();
            done();
        });

        // this.channel.on('ack', (e) => {
        // });
        // this.channel.on('cancel', (e) => {
        // });
        this.channel.on('close', (e) => {
            try {
                if (this.conn != null) this.conn.close();
            } catch (error) {
            }
            this.conn = null;
            this.channel = null;
            if (this.timeout == null) {
                this.timeout = setTimeout(this.connect.bind(this), 1000);
            }
        });
        //this.channel.on('delivery', (e) => {
        //});
        // this.channel.on('nack', (e) => {
        // });
        var keys = Object.keys(this.exchanges);
        for (var i = 0; i < keys.length; i++) {
            var q1: amqpexchange = this.exchanges[keys[i]];
            this.AddExchangeConsumer(q1.exchange, q1.algorithm, q1.routingkey, q1.ExchangeOptions, q1.callback);
        }
        var keys = Object.keys(this.queues);
        for (var i = 0; i < keys.length; i++) {
            if (keys[i] != this.replyqueue) {
                var q2: amqpqueue = this.queues[keys[i]];
                this.AddQueueConsumer(q2.queue, q2.QueueOptions, q2.callback);
            }
        }
    }
    async RemoveQueueConsumer(queue: string): Promise<string> {
        var q: amqpqueue = null;
        if (this.queues[queue] != null) {
            q = this.queues[queue];
        } else {
            return;
        }
        await this.channel.cancel(q.consumerTag);
        delete this.queues[q.queue];
    }
    async AddQueueConsumer(queue: string, QueueOptions: any, callback: QueueOnMessage): Promise<string> {
        var q: amqpqueue = null;
        if (this.exchanges[queue] != null) {
            q = this.queues[queue];
        } else {
            q = new amqpqueue();
        }
        if (!Util.IsNullEmpty(q.queue)) {
            if (q.queue.startsWith("amq.")) {
                delete this.queues[q.queue];
            }
            q.queue = "";
        }
        q.callback = callback;
        q.QueueOptions = new Object((QueueOptions != null ? QueueOptions : this.AssertQueueOptions));
        if (Util.IsNullEmpty(queue)) queue = "";
        if (queue.startsWith("amq.")) queue = "";
        if (Util.IsNullEmpty(queue)) q.QueueOptions.autoDelete = true;
        q.ok = await this.channel.assertQueue(queue, q.QueueOptions);
        q.queue = q.ok.queue;
        this._logger.info("[AMQP] Added queue consumer " + q.queue);
        var consumeresult = await this.channel.consume(q.ok.queue, (msg) => {
            this.OnMessage(this, msg, q.callback);
        }, { noAck: false });
        q.consumerTag = consumeresult.consumerTag;
        this.queues[q.queue] = q;
        return q.queue;
    }
    async AddExchangeConsumer(exchange: string, algorithm: string, routingkey: string, ExchangeOptions: any, callback: QueueOnMessage): Promise<void> {
        var q: amqpexchange = null;
        if (this.exchanges[exchange] != null) {
            q = this.exchanges[exchange];
        } else {
            q = new amqpexchange();
        }
        if (!Util.IsNullEmpty(q.queue)) {
            delete this.queues[q.queue];
        }
        q.ExchangeOptions = new Object((ExchangeOptions != null ? ExchangeOptions : this.AssertExchangeOptions));
        q.exchange = exchange; q.algorithm = algorithm; q.routingkey = routingkey; q.callback = callback;
        this._ok = await this.channel.assertExchange(q.exchange, q.algorithm, q.ExchangeOptions);
        q.queue = await this.AddQueueConsumer("", null, q.callback);
        this.channel.bindQueue(q.queue, q.exchange, q.routingkey);
        this._logger.info("[AMQP] Added exchange consumer " + q.exchange);
        this.exchanges[exchange] = q;
    }
    OnMessage(sender: amqpwrapper, msg: amqplib.ConsumeMessage, callback: QueueOnMessage): void {
        // sender._logger.info("OnMessage " + msg.content.toString());
        var correlationId: string = msg.properties.correlationId;
        var replyTo: string = msg.properties.replyTo;
        var consumerTag: string = msg.fields.consumerTag;
        var routingkey: string = msg.fields.routingkey;
        var exchange: string = msg.fields.exchange;
        var options: QueueMessageOptions = {
            correlationId: correlationId,
            replyTo: replyTo,
            consumerTag: consumerTag,
            routingkey: routingkey,
            exchange: exchange
        }
        var data: string = msg.content.toString();
        callback(data, options, (nack: boolean) => {
            if (nack == false) {
                console.log("nack message");
                this.channel.nack(msg);
                // this.channel.nack(msg, false, true);
                msg = null;
                return;
            }
            this.channel.ack(msg);
        }, (result) => {
            if (msg != null && !Util.IsNullEmpty(replyTo)) {
                try {
                    this.channel.sendToQueue(replyTo, Buffer.from(result), { correlationId: msg.properties.correlationId });
                } catch (error) {
                    console.error("Error sending response to " + replyTo + " " + JSON.stringify(error))
                }
            }
        });
    }
    async sendWithReply(exchange: string, queue: string, data: any, expiration: number, correlationId: string): Promise<string> {
        if (Util.IsNullEmpty(correlationId)) correlationId = this.generateUuid();
        this.activecalls[correlationId] = new Deferred();
        await this.sendWithReplyTo(exchange, queue, this.replyqueue, data, expiration, correlationId);
        return this.activecalls[correlationId].promise;
    }
    async sendWithReplyTo(exchange: string, queue: string, replyTo: string, data: any, expiration: number, correlationId: string): Promise<void> {
        if (this.channel == null || this.conn == null) {
            throw new Error("Cannot send message, when not connected");
        }
        if (typeof data !== 'string' && !(data instanceof String)) {
            data = JSON.stringify(data);
        }

        this._logger.info("send to queue: " + queue + " exchange: " + exchange + " with reply to " + replyTo);
        var options: any = { mandatory: true };
        options.replyTo = replyTo;
        if (!Util.IsNullEmpty(correlationId)) options.correlationId = correlationId;
        if (!Util.IsNullEmpty(expiration)) {
            if (expiration > 0) options.expiration = expiration.toString();
        }
        if (Util.IsNullEmpty(exchange)) {
            if (!await amqpwrapper.TestInstance().checkQueue(queue)) {
                throw new Error("No consumer listening at " + queue);
            }
            this.channel.sendToQueue(queue, Buffer.from(data), options);
        } else {
            this.channel.publish(exchange, "", Buffer.from(data), options);
        }
    }
    async checkQueue(queue: string): Promise<boolean> {
        if (Config.amqp_check_for_consumer) {
            var test: AssertQueue = null;
            try {
                // var test: AssertQueue = await this.channel.assertQueue(this.queue, this.AssertQueueOptions);
                test = await this.channel.checkQueue(queue);
            } catch (error) {
                test = null;
            }
            if (test == null || test.consumerCount == 0) {
                return false;
            }
        }
        return true;
    }
    async send(exchange: string, queue: string, data: any, expiration: number, correlationId: string): Promise<void> {
        if (this.channel == null || this.conn == null) {
            throw new Error("Cannot send message, when not connected");
        }
        if (typeof data !== 'string' && !(data instanceof String)) {
            data = JSON.stringify(data);
        }
        if (!Util.IsNullEmpty(correlationId)) correlationId = this.generateUuid();

        this._logger.info("send to queue: " + queue + " exchange: " + exchange);
        var options: any = { mandatory: true };
        if (!Util.IsNullEmpty(correlationId)) options.correlationId = correlationId;
        if (!Util.IsNullEmpty(expiration)) {
            if (expiration > 0) options.expiration = expiration.toString();
        }
        if (Util.IsNullEmpty(exchange)) {
            if (!await amqpwrapper.TestInstance().checkQueue(queue)) {
                throw new Error("No consumer listening at " + queue);
            }
            this.channel.sendToQueue(queue, Buffer.from(data), options);
        } else {
            this.channel.publish(exchange, "", Buffer.from(data), options);
        }
    }
    generateUuid(): string {
        return Math.random().toString() +
            Math.random().toString() +
            Math.random().toString();
    }

}