import * as winston from "winston";
import * as amqplib from "amqplib";


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
    queue: string;
    private _logger: winston.Logger;
    private _ok: amqplib.Replies.AssertQueue;
    private connectionstring: string;

    constructor(logger: winston.Logger, connectionstring: string, queue: string) {
        this._logger = logger;
        this.queue = queue;
        this.connectionstring = connectionstring;
    }
    async connect(): Promise<void> {
        this.conn = await amqplib.connect(this.connectionstring);
        this.channel = await this.conn.createChannel();
        this._ok = await this.channel.assertQueue(this.queue, { durable: false });
        this._logger.info("Connected to " + this.connectionstring);
    }
    SendMessage(msg: string): void {
        this._logger.info("SendMessage " + msg);
        this.channel.sendToQueue(this.queue, Buffer.from(msg));
    }
}

// tslint:disable-next-line: class-name
export class amqp_rpc_publisher  {
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
        var me:amqp_rpc_publisher = this;
        this.conn = await amqplib.connect(this.connectionstring);
        this.conn.on("error", () => null);
        this.channel = await this.conn.createChannel();
        this._ok = await this.channel.assertQueue("", { exclusive: true });
        await this.channel.consume(this._ok.queue, (msg)=> { this.OnMessage(me, msg); }, { noAck: true });
        this._logger.info("Connected to " + this.connectionstring);
    }
    async SendMessage(msg: string, queue: string): Promise<string> {
        var corr:string = this.generateUuid();
        this.activecalls[corr] = new Deferred();
        this._logger.info("SendMessage " + msg);
        this.channel.sendToQueue(queue, Buffer.from(msg), { correlationId: corr, replyTo: this._ok.queue });
        return this.activecalls[corr].promise;
    }

    OnMessage(sender: amqp_rpc_publisher, msg: amqplib.ConsumeMessage): void {
        sender._logger.info("OnMessage " + msg.content.toString());
        var corr: string = msg.properties.correlationId;
        if(this.activecalls[corr] !== null && this.activecalls[corr] !== undefined) {
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
