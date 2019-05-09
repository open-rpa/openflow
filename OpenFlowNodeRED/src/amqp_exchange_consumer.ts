import * as winston from "winston";
import * as amqplib from "amqplib";

// tslint:disable-next-line: class-name
export class amqp_exchange_consumer  {
    conn: amqplib.Connection;
    channel: amqplib.Channel; // channel: amqplib.ConfirmChannel;
    exchange: string;
    private _logger: winston.Logger;
    private _ok: amqplib.Replies.AssertExchange;
    private _ok2: amqplib.Replies.AssertQueue;
    private connectionstring: string;

    constructor(logger: winston.Logger, connectionstring: string, exchange: string) {
        this._logger = logger;
        this.exchange = exchange;
        this.connectionstring = connectionstring;
    }
    async connect(): Promise<void> {
        var me:amqp_exchange_consumer = this;
        this.conn = await amqplib.connect(this.connectionstring);
        this.channel = await this.conn.createChannel();
        this._ok = await this.channel.assertExchange(this.exchange, "fanout", {durable: false});
        this._ok2 = await this.channel.assertQueue("", { exclusive: true });
        this.channel.bindQueue(this._ok2.queue, this.exchange, "");
        await this.channel.consume(this._ok2.queue, (msg)=> { this.OnMessage(me, msg); }, { noAck: true });
    }
    async close():Promise<void> {
        if(this.channel != null && this.channel != undefined) { await this.channel.close(); this.channel = null; }
        if(this.conn != null && this.conn != undefined) { await this.conn.close(); this.conn = null; }
    }
    OnMessage(sender: amqp_exchange_consumer, msg: amqplib.ConsumeMessage): void {
        sender._logger.info("OnMessage " + msg.content.toString());
    }

}