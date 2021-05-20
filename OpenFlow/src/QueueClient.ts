import { NoderedUtil } from "@openiap/openflow-api";
import { Span } from "@opentelemetry/api";
import { amqpqueue, amqpwrapper, QueueMessageOptions } from "./amqpwrapper";
import { Config } from "./Config";
import { DatabaseConnection } from "./DatabaseConnection";
import { DBHelper } from "./DBHelper";
import { Logger } from "./Logger";
import { Message } from "./Messages/Message";

export class QueueClient {
    static async configure(): Promise<void> {
        await this.RegisterMyQueue();
        await this.RegisterOpenflowQueue();
    }
    private static queue: amqpqueue = null;
    private static queuename: string = "openflow";
    private static processingcount: number;
    public static async RegisterOpenflowQueue() {
        const AssertQueueOptions: any = Object.assign({}, (amqpwrapper.Instance().AssertQueueOptions));
        AssertQueueOptions.exclusive = false;
        this.processingcount = 0;
        await amqpwrapper.Instance().AddQueueConsumer(this.queuename, AssertQueueOptions, null, async (data: any, options: QueueMessageOptions, ack: any, done: any) => {
            const msg: Message = Message.fromjson(data);
            let span: Span = null;
            try {
                if (this.processingcount >= Config.openflow_amqp_processing_limit || !Config.db.isConnected) {
                    // setTimeout(() => {
                    //     ack(false);
                    //     Logger.instanse.warn("[queue][nack] I'm busy, return message")
                    // }, Config.amqp_requeue_time);
                    ack(false);
                    return;
                }
                if (!NoderedUtil.IsNullEmpty(options.replyTo)) {
                    span = Logger.otel.startSpan("QueueClient.QueueMessage");
                    this.processingcount++;
                    if (Config.log_openflow_amqp) Logger.instanse.debug("[queue] Process command: " + msg.command + " id: " + msg.id + " correlationId: " + options.correlationId);
                    await msg.QueueProcess(msg, span);
                    ack();
                    await amqpwrapper.Instance().send(options.exchange, options.replyTo, msg, Config.openflow_amqp_expiration, options.correlationId, options.routingkey);
                } else {
                    Logger.instanse.debug("[queue][ack] No replyto !!!!");
                    ack();
                }
            } catch (error) {
                setTimeout(() => {
                    ack(false);
                    // done(_data);
                    Logger.instanse.warn("[queue][nack] Process message failed command: " + msg.command + " queuename: " + this.queuename + " replyto: " + options.replyTo + " correlationId: " + options.correlationId + " error: " + (error.message ? error.message : error))
                }, Config.amqp_requeue_time);
            }
            finally {
                if (span != null) {
                    this.processingcount--;
                    Logger.otel.endSpan(span);
                }
            }
        }, null);
    }
    public static async RegisterMyQueue() {
        const AssertQueueOptions: any = Object.assign({}, (amqpwrapper.Instance().AssertQueueOptions));
        AssertQueueOptions.exclusive = false;
        this.queue = await amqpwrapper.Instance().AddQueueConsumer("", AssertQueueOptions, null, async (data: any, options: QueueMessageOptions, ack: any, done: any) => {
            const msg: Message = Message.fromjson(data);
            try {
                if (NoderedUtil.IsNullEmpty(options.replyTo)) {
                    const exists = this.messages.filter(x => x.correlationId == options.correlationId);
                    if (exists.length > 0) {
                        if (Config.log_openflow_amqp) Logger.instanse.silly("[queue][ack] Received response for command: " + msg.command + " queuename: " + this.queuename + " replyto: " + options.replyTo + " correlationId: " + options.correlationId)
                        this.messages = this.messages.filter(x => x.correlationId != options.correlationId);
                        exists[0].cb(msg);
                    } else {
                        // throw new Error("Failed locating receiving message");
                    }
                } else {
                    // throw new Error("Got message with no replyto");
                }
                ack();
            } catch (error) {
                setTimeout(() => {
                    ack(false);
                    // done(_data);
                    Logger.instanse.warn("[queue][nack] Received response failed for command: " + msg.command + " queuename: " + this.queuename + " replyto: " + options.replyTo + " correlationId: " + options.correlationId + " error: " + (error.message ? error.message : error))
                }, Config.amqp_requeue_time);
            }
        }, null);
    }
    private static messages: Message[] = [];
    public static async SendForProcessing(msg: Message) {
        return new Promise<Message>(async (resolve, reject) => {
            try {
                msg.correlationId = NoderedUtil.GetUniqueIdentifier();
                this.messages.push(msg);
                if (Config.log_openflow_amqp) Logger.instanse.debug("[queue] Submit command: " + msg.command + " id: " + msg.id + " correlationId: " + msg.correlationId);
                msg.cb = (result) => {
                    if (result.replyto != msg.id) {
                        Logger.instanse.warn("[queue] Received response failed for command: " + msg.command + " id: " + result.id + " replyto: " + result.replyto + " but expected reply to be " + msg.id + " correlationId: " + result.correlationId)
                        result.id = NoderedUtil.GetUniqueIdentifier();
                        result.replyto = msg.id;
                    }
                    result.correlationId = msg.correlationId;
                    if (Config.log_openflow_amqp) Logger.instanse.debug("[queue] Got reply command: " + msg.command + " id: " + result.id + " replyto: " + result.replyto + " correlationId: " + result.correlationId);
                    resolve(result);
                }
                if (Config.log_openflow_amqp) Logger.instanse.silly("[queue] Submit request for command: " + msg.command + " queuename: " + this.queuename + " replyto: " + this.queue.queue + " correlationId: " + msg.correlationId)
                await amqpwrapper.Instance().sendWithReplyTo("", this.queuename, this.queue.queue, JSON.stringify(msg), Config.openflow_amqp_expiration, msg.correlationId, "");
            } catch (error) {
                reject(error);
            }
        });
    }
}