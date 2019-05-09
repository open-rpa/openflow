import * as winston from "winston";
import * as amqplib from "amqplib";

// tslint:disable-next-line: class-name
export class amqp_exchange_publisher  {
    conn: amqplib.Connection;
    channel: amqplib.Channel; // channel: amqplib.ConfirmChannel;
    exchange: string;
    private _logger: winston.Logger;
    private _ok: amqplib.Replies.AssertExchange;
    private connectionstring: string;

    constructor(logger: winston.Logger, connectionstring: string, exchange: string) {
        this._logger = logger;
        this.exchange = exchange;
        this.connectionstring = connectionstring;
    }
    async connect(): Promise<void> {
        this.conn = await amqplib.connect(this.connectionstring);
        this.channel = await this.conn.createChannel();
        this._ok = await this.channel.assertExchange(this.exchange, "fanout", {durable: false});
    }
    SendMessage(msg: string): void {
        this._logger.info("SendMessage " + msg);
        this.channel.publish(this.exchange, "", Buffer.from(msg));
    }

}