import * as retry from "async-retry";
import * as winston from "winston";
import * as amqplib from "amqplib";
import { Config } from "./Config";
import { Crypt } from "./Crypt";
import * as url from "url";
import { NoderedUtil } from "@openiap/openflow-api";
import { WebSocketServer } from "./WebSocketServer";
const got = require("got");
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
// tslint:disable-next-line: class-name
export class amqpwrapper {
    private conn: amqplib.Connection;
    private channel: amqplib.ConfirmChannel; // amqplib.Channel  channel: amqplib.ConfirmChannel;
    // private confirmchannel: amqplib.ConfirmChannel; // channel: amqplib.ConfirmChannel;
    private _logger: winston.Logger;
    private connectionstring: string;
    public AssertExchangeOptions: any = { durable: false, confirm: true };
    public AssertQueueOptions: amqplib.any = { durable: true };
    private activecalls: IHashTable<Deferred<string>> = {};
    // public queues: IHashTable<amqpqueue> = {};
    // private exchanges: IHashTable<amqpexchange> = {};
    // public queues: amqpqueue[] = [];
    private exchanges: amqpexchange[] = [];
    private replyqueue: amqpqueue;
    private static _instance: amqpwrapper = null;
    public static Instance(): amqpwrapper {
        return this._instance;
    }
    public static SetInstance(instance: amqpwrapper): void {
        this._instance = instance;
    }
    constructor(logger: winston.Logger, connectionstring: string) {
        this._logger = logger;
        this.connectionstring = connectionstring;
        if (!NoderedUtil.IsNullEmpty(Config.amqp_dlx)) {
            this.AssertQueueOptions.arguments = {};
            this.AssertQueueOptions.arguments['x-dead-letter-exchange'] = Config.amqp_dlx;
        }
    }
    private timeout: NodeJS.Timeout = null;
    async connect(): Promise<void> {
        try {
            if (this.timeout != null) {
                this.timeout = null;
            }
            if (this.conn == null) {
                this.conn = await amqplib.connect(this.connectionstring);
                this.conn.on('error', (error) => {
                    if (error.code != 404) {
                        this._logger.error(error);
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

            this.channel = await this.conn.createConfirmChannel();
            this.replyqueue = await this.AddQueueConsumer("", null, null, (msg: any, options: QueueMessageOptions, ack: any, done: any) => {
                if (this.replyqueue) {
                    WebSocketServer.websocket_queue_message_count.labels(this.replyqueue.queue).inc();
                    if (!NoderedUtil.IsNullUndefinded(this.activecalls[options.correlationId])) {
                        this.activecalls[options.correlationId].resolve(msg);
                        this.activecalls[options.correlationId] = null;
                        delete this.activecalls[options.correlationId];
                    }
                }
                ack();
                done();
            });
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
            this.channel.on('error', (error) => {
                if (error.code != 404) {
                    this._logger.error(error);
                }
            });
        } catch (error) {
            console.error(error);
            this.timeout = setTimeout(this.connect.bind(this), 1000);
        }
    }
    async RemoveQueueConsumer(queue: amqpqueue): Promise<void> {
        if (queue != null) {
            this._logger.info("[AMQP] Remove queue consumer " + queue.queue + "/" + queue.consumerTag);
            if (this.channel != null) await this.channel.cancel(queue.consumerTag);
        }
    }
    async AddQueueConsumer(queuename: string, QueueOptions: any, jwt: string, callback: QueueOnMessage): Promise<amqpqueue> {
        if (this.channel == null || this.conn == null) throw new Error("Cannot Add new Queue Consumer, not connected to rabbitmq");
        let queue: string = (NoderedUtil.IsNullEmpty(queuename) ? "" : queuename);
        if (Config.amqp_force_queue_prefix && !NoderedUtil.IsNullEmpty(jwt) && !NoderedUtil.IsNullEmpty(queue)) {
            // assume queue names if 24 letters is an mongodb is, should proberly do a real test here
            if (queue.length == 24) {
                const tuser = Crypt.verityToken(jwt);
                let name = tuser.username.split("@").join("").split(".").join("");
                name = name.toLowerCase();
                let skip: boolean = false;
                if (tuser._id == queue) {
                    // Queue is for me
                    skip = false;
                } else if (tuser.roles != null) {
                    // Queue ss for a group i am a member of.
                    const isrole = tuser.roles.filter(x => x._id == queue);
                    if (isrole.length > 0) skip = false;
                }
                if (skip) {
                    // Do i have permission to listen on a queue with this id ?
                    const arr = await Config.db.query({ _id: queue }, { name: 1 }, 1, 0, null, "users", jwt);
                    if (arr.length == 0) skip = true;
                    if (!skip) {
                        const arr = await Config.db.query({ _id: queue }, { name: 1 }, 1, 0, null, "openrpa", jwt);
                        if (arr.length == 0) skip = true;
                    }
                    if (!skip) {
                        const arr = await Config.db.query({ _id: queue }, { name: 1 }, 1, 0, null, "workflow", jwt);
                        if (arr.length == 0) skip = true;
                    }
                    if (!skip) {
                        queue = name + queue;
                    } else {
                        this._logger.info("[SKIP] skipped force prefix for " + queue);
                    }
                } else {
                    this._logger.info("[SKIP] skipped force prefix for " + queue);
                }
            } else {
                const tuser = Crypt.verityToken(jwt);
                let name = tuser.username.split("@").join("").split(".").join("");
                name = name.toLowerCase();
                queue = name + queue;
            }
        } else if (queue.length == 24) {
            if (NoderedUtil.IsNullEmpty(jwt)) {
                const tuser = Crypt.verityToken(jwt);

                const isrole = tuser.roles.filter(x => x._id == queue);
                if (isrole.length == 0 && tuser._id != queue) {
                    let skip: boolean = false;
                    const arr = await Config.db.query({ _id: queue }, { name: 1 }, 1, 0, null, "users", jwt);
                    if (arr.length == 0) skip = true;
                    if (!skip) {
                        const arr = await Config.db.query({ _id: queue }, { name: 1 }, 1, 0, null, "openrpa", jwt);
                        if (arr.length == 0) skip = true;
                    }
                    if (!skip) {
                        const arr = await Config.db.query({ _id: queue }, { name: 1 }, 1, 0, null, "workflow", jwt);
                        if (arr.length == 0) skip = true;
                    }
                    if (!skip) {
                        throw new Error("Access denied creating consumer for " + queue);
                    }
                }

            }
        }
        const q: amqpqueue = new amqpqueue();
        q.callback = callback;
        q.QueueOptions = Object.assign({}, (QueueOptions != null ? QueueOptions : this.AssertQueueOptions));
        if (NoderedUtil.IsNullEmpty(queue)) queue = "";
        if (queue.startsWith("amq.")) queue = "";
        if (NoderedUtil.IsNullEmpty(queue)) q.QueueOptions.autoDelete = true;
        q.ok = await this.channel.assertQueue(queue, q.QueueOptions);
        if (q && q.ok) {
            q.queue = q.ok.queue;
            q.queuename = queuename;
            const consumeresult = await this.channel.consume(q.ok.queue, (msg) => {
                this.OnMessage(q, msg, q.callback);
            }, { noAck: false });
            q.consumerTag = consumeresult.consumerTag;
            this._logger.info("[AMQP] Added queue consumer " + q.queue + "/" + q.consumerTag);
        }
        return q;
    }
    async AddExchangeConsumer(exchange: string, algorithm: string, routingkey: string, ExchangeOptions: any, jwt: string, callback: QueueOnMessage): Promise<amqpexchange> {
        if (this.channel == null || this.conn == null) throw new Error("Cannot Add new Exchange Consumer, not connected to rabbitmq");
        if (Config.amqp_force_exchange_prefix && !NoderedUtil.IsNullEmpty(jwt)) {
            const tuser = Crypt.verityToken(jwt);
            let name = tuser.username.split("@").join("").split(".").join("");
            name = name.toLowerCase();
            exchange = name + exchange;
        }
        const q: amqpexchange = new amqpexchange();
        if (!NoderedUtil.IsNullEmpty(q.queue)) {
            this.RemoveQueueConsumer(q.queue);
        }
        // q.ExchangeOptions = new Object((ExchangeOptions != null ? ExchangeOptions : this.AssertExchangeOptions));
        q.ExchangeOptions = Object.assign({}, (ExchangeOptions != null ? ExchangeOptions : this.AssertExchangeOptions));
        q.exchange = exchange; q.algorithm = algorithm; q.routingkey = routingkey; q.callback = callback;
        const _ok = await this.channel.assertExchange(q.exchange, q.algorithm, q.ExchangeOptions);
        let AssertQueueOptions = null;
        if (!NoderedUtil.IsNullEmpty(Config.amqp_dlx) && exchange == Config.amqp_dlx) {
            AssertQueueOptions = Object.create(this.AssertQueueOptions);
            delete AssertQueueOptions.arguments;
        }
        q.queue = await this.AddQueueConsumer("", AssertQueueOptions, jwt, q.callback);
        if (q.queue) {
            this.channel.bindQueue(q.queue.queue, q.exchange, q.routingkey);
            this._logger.info("[AMQP] Added exchange consumer " + q.exchange + ' to queue ' + q.queue.queue);
        }
        this.exchanges.push(q);
        return q;
    }
    OnMessage(sender: amqpqueue, msg: amqplib.ConsumeMessage, callback: QueueOnMessage): void {
        // sender._logger.info("OnMessage " + msg.content.toString());
        try {
            const now = new Date();
            // const seconds = (now.getTime() - sender.cli.lastheartbeat.getTime()) / 1000;
            // if (seconds >= Config.client_heartbeat_timeout) {
            //     try {
            //         sender.cli._logger.info("amqpwrapper.OnMessage: receive message for inactive client, nack message and try and close");
            //         this.channel.nack(msg);
            //         sender.cli.Close();
            //     } catch (error) {
            //         console.error(error);
            //     }
            //     return;
            // }
            if (msg == null) {
                return;
            }

            const correlationId: string = msg.properties.correlationId;
            const replyTo: string = msg.properties.replyTo;
            const consumerTag: string = msg.fields.consumerTag;
            const routingkey: string = msg.fields.routingkey;
            const exchange: string = msg.fields.exchange;
            const options: QueueMessageOptions = {
                correlationId: correlationId,
                replyTo: replyTo,
                consumerTag: consumerTag,
                routingkey: routingkey,
                exchange: exchange
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
                // ROLLBACK
                // if (msg != null && !NoderedUtil.IsNullEmpty(replyTo)) {
                //     try {
                //         this.channel.sendToQueue(replyTo, Buffer.from(result), { correlationId: msg.properties.correlationId });
                //     } catch (error) {
                //         console.error("Error sending response to " + replyTo + " " + JSON.stringify(error))
                //     }
                // }
            });
        } catch (error) {
            console.error(error);
        }
    }
    async sendWithReply(exchange: string, queue: string, data: any, expiration: number, correlationId: string): Promise<string> {
        if (NoderedUtil.IsNullEmpty(correlationId)) correlationId = this.generateUuid();
        this.activecalls[correlationId] = new Deferred();
        if (this.replyqueue) {
            await this.sendWithReplyTo(exchange, queue, this.replyqueue.queue, data, expiration, correlationId);
        }
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
        const options: any = { mandatory: true };
        options.replyTo = replyTo;
        if (NoderedUtil.IsNullEmpty(correlationId)) correlationId = this.generateUuid();
        if (!NoderedUtil.IsNullEmpty(correlationId)) options.correlationId = correlationId;
        if (expiration < 1) expiration = Config.amqp_default_expiration;
        options.expiration = expiration.toString();
        if (NoderedUtil.IsNullEmpty(exchange)) {
            if (!await this.checkQueue(queue)) {
                throw new Error("No consumer listening at " + queue);
            }
            if (!this.channel.sendToQueue(queue, Buffer.from(data), options, (err, ok) => {
            })) {
                throw new Error("No consumer listening at " + queue);
            }
            WebSocketServer.websocket_queue_message_count.labels(queue).inc();
        } else {
            this.channel.publish(exchange, "", Buffer.from(data), options);
        }
    }
    async send(exchange: string, queue: string, data: any, expiration: number, correlationId: string): Promise<void> {
        if (this.channel == null || this.conn == null) {
            throw new Error("Cannot send message, when not connected");
        }
        if (typeof data !== 'string' && !(data instanceof String)) {
            data = JSON.stringify(data);
        }
        if (NoderedUtil.IsNullEmpty(correlationId)) correlationId = this.generateUuid();

        this._logger.info("send to queue: " + queue + " exchange: " + exchange);
        const options: any = { mandatory: true };
        if (!NoderedUtil.IsNullEmpty(correlationId)) options.correlationId = correlationId;
        if (expiration < 1) expiration = Config.amqp_default_expiration;
        options.expiration = expiration.toString();
        if (NoderedUtil.IsNullEmpty(exchange)) {
            if (!await this.checkQueue(queue)) {
                throw new Error("No consumer listening at " + queue);
            }
            if (!this.channel.sendToQueue(queue, Buffer.from(data), options, (err, ok) => {
            })) {
                throw new Error("No consumer listening at " + queue);
            }
            WebSocketServer.websocket_queue_message_count.labels(queue).inc();
        } else {
            this.channel.publish(exchange, "", Buffer.from(data), options);
        }
    }
    generateUuid(): string {
        return Math.random().toString() +
            Math.random().toString() +
            Math.random().toString();
    }
    static parseurl(amqp_url): url.UrlWithParsedQuery {
        const q = url.parse(amqp_url, true);
        (q as any).username = "guest";
        (q as any).password = "guest";
        if (q.port == null || q.port == "") { q.port = "15672"; }
        if (q.auth != null && q.auth != "") {
            const arr = q.auth.split(':');
            (q as any).username = arr[0];
            (q as any).password = arr[1];
        }
        q.protocol = 'http://';
        return q;
    }

    // This will crash the channel, that does not seem scalable
    async checkQueue(queuename: string): Promise<boolean> {
        if (Config.amqp_check_for_consumer) {
            let test: AssertQueue = null;
            try {
                if (Config.amqp_check_for_consumer_count) {
                    return this.checkQueueConsumerCount(queuename);
                }
                test = await amqpwrapper.getqueue(Config.amqp_url, '/', queuename);
                if (test == null) {
                    return false;
                }
            } catch (error) {
                test = null;
            }
            if (test == null || test.consumerCount == 0) {
                return false;
            }
        }
        return true;
    }
    async checkQueueConsumerCount(queuename: string): Promise<boolean> {
        let result: boolean = false;
        try {
            result = await retry(async bail => {
                const queue = await amqpwrapper.getqueue(Config.amqp_url, '/', queuename);
                // const queue = await amqpwrapper.getqueue(queuename);
                let hasConsumers: boolean = false;
                if (queue.consumers > 0) {
                    hasConsumers = true;
                }
                if (!hasConsumers) {
                    if (queue.consumer_details != null && queue.consumer_details.length > 0) {
                        hasConsumers = true;
                    } else {
                        hasConsumers = false;
                    }
                }
                if (hasConsumers == false) {
                    hasConsumers = false;
                    throw new Error("No consumer listening at " + queuename);
                    // return bail();
                }
                return hasConsumers;
            }, {
                retries: 10,
                minTimeout: 500,
                maxTimeout: 500,
                onRetry: function (error: Error, count: number): void {
                    result = false;
                    console.warn("retry " + count + " error " + error.message + " getting " + url);
                }
            });
        } catch (error) {
            this._logger.debug(error.message ? error.message : error);
        }
        if (result == true) {
            return result;
        }
        return false;
    }
    static async getvhosts(amqp_url) {
        const q = this.parseurl(amqp_url);
        const options = {
            headers: {
                'Content-type': 'application/x-www-form-urlencoded'
            },
            username: (q as any).username,
            password: (q as any).password
        };
        const _url = 'http://' + q.host + ':' + q.port + '/api/vhosts';
        const response = await got.get(_url, options);
        const payload = JSON.parse(response.body);
        return payload;
    }
    static async getqueues(amqp_url: string, vhost: string = null) {
        const q = this.parseurl(amqp_url);
        const options = {
            headers: {
                'Content-type': 'application/x-www-form-urlencoded'
            },
            username: (q as any).username,
            password: (q as any).password
        };
        let _url = 'http://' + q.host + ':' + q.port + '/api/queues';
        if (!NoderedUtil.IsNullEmpty(vhost)) _url += '/' + encodeURIComponent(vhost);
        const response = await got.get(_url, options);
        const payload = JSON.parse(response.body);
        return payload;
    }
    static async getqueue(amqp_url: string, vhost: string, queuename) {
        // const queues = await amqpwrapper.getqueues(Config.amqp_url);
        // for (let i = 0; i < queues.length; i++) {
        //     let queue = queues[i];
        //     if (queue.name == queuename) {
        //         return queue;
        //     }
        // }
        const q = this.parseurl(amqp_url);
        const options = {
            headers: {
                'Content-type': 'application/x-www-form-urlencoded'
            },
            username: (q as any).username,
            password: (q as any).password,
            timeout: 500, retry: 1
        };
        const _url = 'http://' + q.host + ':' + q.port + '/api/queues/' + encodeURIComponent(vhost) + '/' + encodeURIComponent(queuename);
        const response = await got.get(_url, options);
        const payload = JSON.parse(response.body);
        return payload;
    }
    static async deletequeue(amqp_url: string, vhost: string, queuename) {
        const q = this.parseurl(amqp_url);
        const options = {
            headers: {
                'Content-type': 'application/x-www-form-urlencoded'
            },
            username: (q as any).username,
            password: (q as any).password,
            timeout: 500, retry: 1
        };
        const _url = 'http://' + q.host + ':' + q.port + '/api/queues/' + encodeURIComponent(vhost) + '/' + encodeURIComponent(queuename);
        const response = await got.delete(_url, options);
        const payload = JSON.parse(response.body);
        return payload;
    }
}