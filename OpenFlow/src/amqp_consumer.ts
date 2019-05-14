import * as winston from "winston";
import * as amqplib from "amqplib";

// tslint:disable-next-line: class-name
export class amqp_consumer  {
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
    async connect(autoack:boolean, autoDelete:boolean): Promise<void> {
        var me:amqp_consumer = this;
        this.conn = await amqplib.connect(this.connectionstring);
        this.conn.on("error", () => null);
        this.channel = await this.conn.createChannel();
        this._ok = await this.channel.assertQueue(this.queue, { durable: false, autoDelete: autoDelete });
        await this.channel.consume(this.queue, (msg)=> { this.OnMessage(me, msg); }, { noAck: autoack });
        this._logger.info("Connected to " + this.connectionstring);
    }
    async close():Promise<void> {
        if(this.channel != null && this.channel != undefined) { await this.channel.close(); this.channel = null; }
        if(this.conn != null && this.conn != undefined) { await this.conn.close(); this.conn = null; }
    }
    OnMessage(sender: amqp_consumer, msg: amqplib.ConsumeMessage): void {
        sender._logger.info("OnMessage " + msg.content.toString());
    }
    sendToQueue(replyto: string, correlationId:string, data: any) {
        if (typeof data !== 'string' && !(data instanceof String)) {
            data = JSON.stringify(data);
        }
        this._logger.info("SendMessage " + data);
        //this.channel.publish( this.exchange, "", Buffer.from(msg));
        this.channel.sendToQueue(replyto, Buffer.from(data), { correlationId: correlationId, replyTo: this._ok.queue });
    }

}

type RPCCallback = (msg:string) => string;


// tslint:disable-next-line: class-name
export class amqp_rpc_consumer  {
    conn: amqplib.Connection;
    channel: amqplib.Channel; // channel: amqplib.ConfirmChannel;
    queue: string;
    callback: RPCCallback;
    private _logger: winston.Logger;
    private _ok: amqplib.Replies.AssertQueue;
    private connectionstring: string;

    constructor(logger: winston.Logger, connectionstring: string, queue: string, callback: RPCCallback) {
        this._logger = logger;
        this.queue = queue;
        this.callback = callback;
        this.connectionstring = connectionstring;
    }
    async connect(): Promise<void> {
        var me:amqp_rpc_consumer = this;
        this.conn = await amqplib.connect(this.connectionstring);
        this.channel = await this.conn.createChannel();
        this._ok = await this.channel.assertQueue(this.queue, { durable: false });
        await this.channel.consume(this.queue, (msg)=> { this.OnMessage(me, msg); }, { noAck: false });
        this._logger.info("Connected to " + this.connectionstring);
    }
    OnMessage(sender: amqp_rpc_consumer, msg: amqplib.ConsumeMessage): void {
        sender._logger.info("OnMessage " + msg.content.toString());
        var result: string = this.callback(msg.content.toString());
        this.channel.sendToQueue(msg.properties.replyTo, Buffer.from(result), {correlationId: msg.properties.correlationId});
        this.channel.ack(msg);
    }

}