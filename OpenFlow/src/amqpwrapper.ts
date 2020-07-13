import * as retry from "async-retry";
import * as winston from "winston";
import * as amqplib from "amqplib";
import { Config } from "./Config";
import { Crypt } from "./Crypt";
import * as url from "url";
import { NoderedUtil } from "openflow-api";
var got = require("got");
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
    public queue: amqpqueue;
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
    // public queues: IHashTable<amqpqueue> = {};
    // private exchanges: IHashTable<amqpexchange> = {};
    public queues: amqpqueue[] = [];
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
            if (!NoderedUtil.IsNullEmpty(this.replyqueue)) {
                this.queues = this.queues.filter(x => x.consumerTag != this.replyqueue.consumerTag);
            }
            this.replyqueue = await this.AddQueueConsumer("", null, null, (msg: any, options: QueueMessageOptions, ack: any, done: any) => {
                if (!NoderedUtil.IsNullUndefinded(this.activecalls[options.correlationId])) {
                    this.activecalls[options.correlationId].resolve(msg);
                    this.activecalls[options.correlationId] = null;
                    delete this.activecalls[options.correlationId];
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
            // ROLLBACK
            // var keys = Object.keys(this.exchanges);
            // for (var i = 0; i < keys.length; i++) {
            //     var q1: amqpexchange = this.exchanges[keys[i]];
            //     this.AddExchangeConsumer(q1.exchange, q1.algorithm, q1.routingkey, q1.ExchangeOptions, null, q1.callback);
            // }
            // var keys = Object.keys(this.queues);
            // for (var i = 0; i < keys.length; i++) {
            //     if (keys[i] != this.replyqueue.queue) {
            //         var q2: amqpqueue = this.queues[keys[i]];
            //         this.AddQueueConsumer(q2.queue, q2.QueueOptions, null, q2.callback);
            //     }
            // }
        } catch (error) {
            console.error(error);
            this.timeout = setTimeout(this.connect.bind(this), 1000);
        }
    }
    async RemoveQueueConsumer(queue: amqpqueue): Promise<void> {
        if (queue != null) {
            this._logger.info("[AMQP] Remove queue consumer " + queue.queue);
            if (this.channel != null) await this.channel.cancel(queue.consumerTag);
        }
    }
    async AddQueueConsumer(queue: string, QueueOptions: any, jwt: string, callback: QueueOnMessage): Promise<amqpqueue> {
        if (this.channel == null || this.conn == null) throw new Error("Cannot Add new Queue Consumer, not connected to rabbitmq");
        if (queue == null) queue = "";
        var q: amqpqueue = null;
        if (Config.amqp_force_queue_prefix && !NoderedUtil.IsNullEmpty(jwt) && !NoderedUtil.IsNullEmpty(queue)) {
            if (queue.length == 24) {
                var tuser = Crypt.verityToken(jwt);
                var name = tuser.username.split("@").join("").split(".").join("");
                name = name.toLowerCase();
                var isrole = tuser.roles.filter(x => x._id == queue);
                if (isrole.length == 0 && tuser._id != queue) {
                    var skip: boolean = false;
                    var arr = await Config.db.query({ _id: queue }, { name: 1 }, 1, 0, null, "users", jwt);
                    if (arr.length == 0) skip = true;
                    if (!skip) {
                        var arr = await Config.db.query({ _id: queue }, { name: 1 }, 1, 0, null, "openrpa", jwt);
                        if (arr.length == 0) skip = true;
                    }
                    if (!skip) {
                        var arr = await Config.db.query({ _id: queue }, { name: 1 }, 1, 0, null, "workflow", jwt);
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
                var tuser = Crypt.verityToken(jwt);
                var name = tuser.username.split("@").join("").split(".").join("");
                name = name.toLowerCase();
                queue = name + queue;
            }
        } else if (queue.length == 24) {
            var isrole = tuser.roles.filter(x => x._id == queue);
            if (isrole.length == 0 && tuser._id != queue) {
                var skip: boolean = false;
                var arr = await Config.db.query({ _id: queue }, { name: 1 }, 1, 0, null, "users", jwt);
                if (arr.length == 0) skip = true;
                if (!skip) {
                    var arr = await Config.db.query({ _id: queue }, { name: 1 }, 1, 0, null, "openrpa", jwt);
                    if (arr.length == 0) skip = true;
                }
                if (!skip) {
                    var arr = await Config.db.query({ _id: queue }, { name: 1 }, 1, 0, null, "workflow", jwt);
                    if (arr.length == 0) skip = true;
                }
                if (!skip) {
                    throw new Error("Access denied creating consumer for " + queue);
                }
            }
        }
        // if (!await amqpwrapper.TestInstance().checkQueue(queue)) {
        //     if (amqpwrapper.TestInstance().conn == null || amqpwrapper.TestInstance().channel == null) {
        //         throw new Error("checkQueue failed for " + queue);
        //     }
        // }
        q = new amqpqueue();
        q.callback = callback;
        // q.QueueOptions = new Object((QueueOptions != null ? QueueOptions : this.AssertQueueOptions));
        q.QueueOptions = Object.assign({}, (QueueOptions != null ? QueueOptions : this.AssertQueueOptions));
        if (NoderedUtil.IsNullEmpty(queue)) queue = "";
        if (queue.startsWith("amq.")) queue = "";
        if (NoderedUtil.IsNullEmpty(queue)) q.QueueOptions.autoDelete = true;
        q.ok = await this.channel.assertQueue(queue, q.QueueOptions);
        q.queue = q.ok.queue;
        this._logger.info("[AMQP] Added queue consumer " + q.queue);
        var consumeresult = await this.channel.consume(q.ok.queue, (msg) => {
            this.OnMessage(q, msg, q.callback);
        }, { noAck: false });
        q.consumerTag = consumeresult.consumerTag;
        // this.queues[q.queue] = q;
        this.queues.push(q);
        return q;
    }
    async AddExchangeConsumer(exchange: string, algorithm: string, routingkey: string, ExchangeOptions: any, jwt: string, callback: QueueOnMessage): Promise<amqpexchange> {
        if (this.channel == null || this.conn == null) throw new Error("Cannot Add new Exchange Consumer, not connected to rabbitmq");
        var q: amqpexchange = null;
        if (Config.amqp_force_exchange_prefix && !NoderedUtil.IsNullEmpty(jwt)) {
            var tuser = Crypt.verityToken(jwt);
            var name = tuser.username.split("@").join("").split(".").join("");
            name = name.toLowerCase();
            exchange = name + exchange;
        }
        q = new amqpexchange();
        // if (this.exchanges[exchange] != null) {
        //     q = this.exchanges[exchange];
        // } else {
        //     q = new amqpexchange();
        // }
        if (!NoderedUtil.IsNullEmpty(q.queue)) {
            this.RemoveQueueConsumer(q.queue);
        }
        // q.ExchangeOptions = new Object((ExchangeOptions != null ? ExchangeOptions : this.AssertExchangeOptions));
        q.ExchangeOptions = Object.assign({}, (ExchangeOptions != null ? ExchangeOptions : this.AssertExchangeOptions));
        q.exchange = exchange; q.algorithm = algorithm; q.routingkey = routingkey; q.callback = callback;
        var _ok = await this.channel.assertExchange(q.exchange, q.algorithm, q.ExchangeOptions);
        var AssertQueueOptions = null;
        if (!NoderedUtil.IsNullEmpty(Config.amqp_dlx) && exchange == Config.amqp_dlx) {
            AssertQueueOptions = Object.create(this.AssertQueueOptions);
            delete AssertQueueOptions.arguments;
        }
        q.queue = await this.AddQueueConsumer("", AssertQueueOptions, jwt, q.callback);
        this.channel.bindQueue(q.queue.queue, q.exchange, q.routingkey);
        this._logger.info("[AMQP] Added exchange consumer " + q.exchange + ' to queue ' + q.queue.queue);
        // this.exchanges[exchange] = q;
        this.exchanges.push(q);
        return q;
    }
    OnMessage(sender: amqpqueue, msg: amqplib.ConsumeMessage, callback: QueueOnMessage): void {
        // sender._logger.info("OnMessage " + msg.content.toString());
        try {
            var now = new Date();
            // var seconds = (now.getTime() - sender.cli.lastheartbeat.getTime()) / 1000;
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
                try {
                    if (nack == false) {
                        console.log("nack message");
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
        await this.sendWithReplyTo(exchange, queue, this.replyqueue.queue, data, expiration, correlationId);
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
        if (NoderedUtil.IsNullEmpty(correlationId)) correlationId = this.generateUuid();
        if (!NoderedUtil.IsNullEmpty(correlationId)) options.correlationId = correlationId;
        if (expiration < 1) expiration = Config.amqp_default_expiration;
        options.expiration = expiration.toString();
        if (NoderedUtil.IsNullEmpty(exchange)) {
            if (!await this.checkQueue(queue)) {
                throw new Error("No consumer listening at " + queue);
            }
            this.channel.sendToQueue(queue, Buffer.from(data), options);
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
        var options: any = { mandatory: true };
        if (!NoderedUtil.IsNullEmpty(correlationId)) options.correlationId = correlationId;
        if (expiration < 1) expiration = Config.amqp_default_expiration;
        options.expiration = expiration.toString();
        if (NoderedUtil.IsNullEmpty(exchange)) {
            if (!await this.checkQueue(queue)) {
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
    parseurl(amqp_url): url.UrlWithParsedQuery {
        var q = url.parse(amqp_url, true);
        (q as any).username = "guest";
        (q as any).password = "guest";
        if (q.port == null || q.port == "") { q.port = "15672"; }
        if (q.auth != null && q.auth != "") {
            var arr = q.auth.split(':');
            (q as any).username = arr[0];
            (q as any).password = arr[1];
        }
        q.protocol = 'http://';
        return q;
    }
    async checkQueue(queuename: string): Promise<boolean> {
        var result: boolean = false;
        try {
            result = await retry(async bail => {
                var queue = await this.getqueue(Config.amqp_url, '/', queuename);
                let hasConsumers: boolean = false;
                if (queue.consumers > 0) {
                    hasConsumers = true;
                }
                if (!hasConsumers) {
                    if (queue.consumer_details != null && queue.consumer_details.length > 0) {
                        // console.log(queue.consumer_details[0]);
                        hasConsumers = true;
                    }
                }
                if (hasConsumers == false) {
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
                    console.log("retry " + count + " error " + error.message + " getting " + url);
                }
            });
        } catch (error) {
            if (!NoderedUtil.IsNullEmpty(error.message)) this._logger.debug(error.message);
            if (NoderedUtil.IsNullEmpty(error.message)) this._logger.debug(error);
        }
        if (result == true) {
            return result;
        }
        return false;
    }
    async getvhosts(amqp_url) {
        var q = this.parseurl(amqp_url);
        var options = {
            headers: {
                'Content-type': 'application/x-www-form-urlencoded'
            },
            username: (q as any).username,
            password: (q as any).password
        };
        var _url = 'http://' + q.host + ':' + q.port + '/api/vhosts';
        var response = await got.get(_url, options);
        var payload = JSON.parse(response.body);
        return payload;
    }
    async getqueues(amqp_url, vhost) {
        var q = this.parseurl(amqp_url);
        var options = {
            headers: {
                'Content-type': 'application/x-www-form-urlencoded'
            },
            username: (q as any).username,
            password: (q as any).password
        };
        var _url = 'http://' + q.host + ':' + q.port + '/api/queues/' + encodeURIComponent(vhost);
        var response = await got.get(_url, options);
        var payload = JSON.parse(response.body);
        return payload;
    }
    async getqueue(amqp_url, vhost, queuename) {
        var q = this.parseurl(amqp_url);
        var options = {
            headers: {
                'Content-type': 'application/x-www-form-urlencoded'
            },
            username: (q as any).username,
            password: (q as any).password,
            timeout: 500, retry: 1
        };
        var _url = 'http://' + q.host + ':' + q.port + '/api/queues/' + encodeURIComponent(vhost) + '/' + queuename;
        var response = await got.get(_url, options);
        var payload = JSON.parse(response.body);
        return payload;
    }

    // async checkQueue(queue: string): Promise<boolean> {
    //     if (Config.amqp_check_for_consumer) {
    //         var q: amqpqueue = this.queues[queue];

    //         var test: AssertQueue = null;
    //         try {
    //             // var test: AssertQueue = await this.channel.assertQueue(this.queue, this.AssertQueueOptions);
    //             test = await this.channel.checkQueue(queue);
    //             if (q != null) {
    //                 q.ok = test;
    //             }
    //         } catch (error) {
    //             test = null;
    //         }
    //         if (test == null || test.consumerCount == 0) {
    //             return false;
    //         }
    //     }
    //     return true;
    // }
}