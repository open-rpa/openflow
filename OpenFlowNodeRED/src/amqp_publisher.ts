import * as winston from "winston";
import * as amqplib from "amqplib";
import { NoderedUtil } from "./nodered/nodes/NoderedUtil";


interface IHashTable<T> {
    [key: string]: T;
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

// tslint:disable-next-line: class-name
export class amqp_publisher {
    conn: amqplib.Connection;
    channel: amqplib.Channel; // channel: amqplib.ConfirmChannel;
    private _ok: amqplib.Replies.AssertQueue;
    public OnMessage: any;

    constructor(public _logger: winston.Logger, private connectionstring: string, public localqueuename: string) {
    }
    async connect(): Promise<void> {
        this.conn = await amqplib.connect(this.connectionstring);
        this.conn.on("error", () => null);
        this.channel = await this.conn.createChannel();
        if (NoderedUtil.IsNullEmpty(this.localqueuename)) {
            this._ok = await this.channel.assertQueue(this.localqueuename, { exclusive: true });
        } else {
            this._ok = await this.channel.assertQueue(this.localqueuename, { durable: false });

        }
        await this.channel.consume(this._ok.queue, (msg) => { this._OnMessage(this, msg); }, { noAck: true });

        this._logger.info("Connected to " + new URL(this.connectionstring).hostname);
    }
    async close(): Promise<void> {
        if (this.channel != null && this.channel != undefined) { await this.channel.close(); this.channel = null; }
        if (this.conn != null && this.conn != undefined) { await this.conn.close(); this.conn = null; }
    }
    SendMessage(msg: string, queue: string, correlationId: string): void {
        if (correlationId == null || correlationId == "") { correlationId = this.generateUuid(); }
        this._logger.info("SendMessage " + msg);
        this.channel.sendToQueue(queue, Buffer.from(msg), { correlationId: correlationId, replyTo: this._ok.queue });
    }
    private _OnMessage(sender: amqp_publisher, msg: amqplib.ConsumeMessage): void {
        try {
            sender._logger.info("OnMessage " + msg.content.toString());
            if (this.OnMessage !== null && this.OnMessage !== undefined) {
                this.OnMessage(msg, null);
            }
        } catch (error) {
            this._logger.error(error);
        }
    }

    generateUuid(): string {
        return Math.random().toString() +
            Math.random().toString() +
            Math.random().toString();
    }
}

// tslint:disable-next-line: class-name
export class amqp_rpc_publisher {
    conn: amqplib.Connection;
    channel: amqplib.Channel; // channel: amqplib.ConfirmChannel;
    private _logger: winston.Logger;
    private _ok: amqplib.Replies.AssertQueue;
    private connectionstring: string;

    activecalls: IHashTable<Deferred<string>>;

    constructor(logger: winston.Logger, connectionstring: string) {
        this.activecalls = {};
        this._logger = logger;
        this.connectionstring = connectionstring;
    }
    async connect(): Promise<void> {
        var me: amqp_rpc_publisher = this;
        this.conn = await amqplib.connect(this.connectionstring);
        this.channel = await this.conn.createChannel();
        this._ok = await this.channel.assertQueue("", { exclusive: true });
        await this.channel.consume(this._ok.queue, (msg) => { this.OnMessage(me, msg); }, { noAck: true });
        this._logger.info("Connected to " + new URL(this.connectionstring).hostname);
    }
    async close(): Promise<void> {
        if (this.channel != null && this.channel != undefined) { await this.channel.close(); this.channel = null; }
        if (this.conn != null && this.conn != undefined) { await this.conn.close(); this.conn = null; }
    }
    async SendMessage(msg: string, queue: string): Promise<string> {
        var corr: string = this.generateUuid();
        this.activecalls[corr] = new Deferred();
        this._logger.info("SendMessage " + msg);
        this.channel.sendToQueue(queue, Buffer.from(msg), { correlationId: corr, replyTo: this._ok.queue });
        return this.activecalls[corr].promise;
    }

    OnMessage(sender: amqp_rpc_publisher, msg: amqplib.ConsumeMessage): void {
        sender._logger.info("OnMessage " + msg.content.toString());
        var corr: string = msg.properties.correlationId;
        if (this.activecalls[corr] !== null && this.activecalls[corr] !== undefined) {
            this.activecalls[corr].resolve(msg.content.toString());
            this.activecalls[corr] = null;
        } else {
            this._logger.error("OnMessage unknown correlationId: " + corr);
        }
    }
    generateUuid(): string {
        return Math.random().toString() +
            Math.random().toString() +
            Math.random().toString();
    }
}
