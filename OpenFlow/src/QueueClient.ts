import { NoderedUtil } from "@openiap/openflow-api";
import { Span } from "@opentelemetry/api";
import { amqpqueue, amqpwrapper, QueueMessageOptions } from "./amqpwrapper";
import { Config } from "./Config";
import { Crypt } from "./Crypt";
import { Logger } from "./Logger";
import { Message } from "./Messages/Message";
export class QueueClient {
    static async configure(parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("QueueClient.configure", parent);
        try {
            await QueueClient.connect();
            var instance = amqpwrapper.Instance();
            instance.on("connected", () => {
                QueueClient.connect();
            });
        } catch (error) {
            span?.recordException(error);
            Logger.instanse.error("QueueClient", "configure", error);
            return;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    private static async connect() {
        await this.RegisterMyQueue();
        await this.RegisterOpenflowQueue();
    }
    private static queue: amqpqueue = null;
    private static queuename: string = "openflow";
    public static async RegisterOpenflowQueue() {
        const AssertQueueOptions: any = Object.assign({}, (amqpwrapper.Instance().AssertQueueOptions));
        AssertQueueOptions.exclusive = false;
        AssertQueueOptions["x-max-priority"] = 5;
        AssertQueueOptions.maxPriority = 5;
        await amqpwrapper.Instance().AddQueueConsumer(Crypt.rootUser(), this.queuename, AssertQueueOptions, null, async (data: any, options: QueueMessageOptions, ack: any, done: any) => {
            const msg: Message = Message.fromjson(data);
            let span: Span = null;
            if (!Config.db.isConnected) {
                ack(false);
                return;
            }
            try {
                msg.priority = options.priority;
                if (!NoderedUtil.IsNullEmpty(options.replyTo)) {
                    span = Logger.otel.startSpan("QueueClient.QueueMessage");
                    Logger.instanse.debug("QueueClient", "AddQueueConsumer", "Process command: " + msg.command + " id: " + msg.id + " correlationId: " + options.correlationId);
                    await msg.QueueProcess(options, span);
                    ack();
                    await amqpwrapper.Instance().send(options.exchangename, options.replyTo, msg, Config.openflow_amqp_expiration, options.correlationId, options.routingKey);
                } else {
                    ack(false);
                    Logger.instanse.debug("QueueClient", "AddQueueConsumer", "[queue][ack] No replyto !!!!");
                }
            } catch (error) {
                try {
                    ack(false);
                } catch (error) {
                }
            } finally {
                Logger.otel.endSpan(span);
            }
        }, null);
    }
    public static async RegisterMyQueue() {
        const AssertQueueOptions: any = Object.assign({}, (amqpwrapper.Instance().AssertQueueOptions));
        AssertQueueOptions.exclusive = false;
        this.queue = await amqpwrapper.Instance().AddQueueConsumer(Crypt.rootUser(), "", AssertQueueOptions, null, async (data: any, options: QueueMessageOptions, ack: any, done: any) => {
            const msg: Message = Message.fromjson(data);
            try {
                if (NoderedUtil.IsNullEmpty(options.replyTo)) {
                    ack();
                    const exists = this.messages.filter(x => x.correlationId == options.correlationId);
                    if (exists.length > 0) {
                        Logger.instanse.silly("QueueClient", "RegisterMyQueue", "[queue][ack] Received response for command: " + msg.command + " queuename: " + this.queuename + " replyto: " + options.replyTo + " correlationId: " + options.correlationId)
                        this.messages = this.messages.filter(x => x.correlationId != options.correlationId);
                        exists[0].cb(msg);
                    } else {
                        // throw new Error("Failed locating receiving message");
                    }
                } else {
                    ack(false);
                }
            } catch (error) {
                ack(false);
            }
        }, null);
    }
    private static messages: Message[] = [];
    public static async SendForProcessing(msg: Message, priority: number) {
        return new Promise<Message>(async (resolve, reject) => {
            try {
                msg.correlationId = NoderedUtil.GetUniqueIdentifier();
                this.messages.push(msg);
                Logger.instanse.debug("QueueClient", "SendForProcessing", "Submit command: " + msg.command + " id: " + msg.id + " correlationId: " + msg.correlationId);
                msg.cb = (result) => {
                    if (result.replyto != msg.id) {
                        Logger.instanse.warn("QueueClient", "SendForProcessing", "Received response failed for command: " + msg.command + " id: " + result.id + " replyto: " + result.replyto + " but expected reply to be " + msg.id + " correlationId: " + result.correlationId)
                        result.id = NoderedUtil.GetUniqueIdentifier();
                        result.replyto = msg.id;
                    }
                    result.correlationId = msg.correlationId;
                    Logger.instanse.debug("QueueClient", "SendForProcessing", "Got reply command: " + msg.command + " id: " + result.id + " replyto: " + result.replyto + " correlationId: " + result.correlationId);
                    resolve(result);
                }
                Logger.instanse.silly("QueueClient", "SendForProcessing", "Submit request for command: " + msg.command + " queuename: " + this.queuename + " replyto: " + this.queue.queue + " correlationId: " + msg.correlationId)
                await amqpwrapper.Instance().sendWithReplyTo("", this.queuename, this.queue.queue, JSON.stringify(msg), Config.openflow_amqp_expiration, msg.correlationId, "", priority);
            } catch (error) {
                if (NoderedUtil.IsNullUndefinded(this.queue)) {
                    Logger.instanse.warn("QueueClient", "SendForProcessing", "SendForProcessing queue is null, shutdown amqp connection");
                    process.exit(406);
                    // amqpwrapper.Instance().shutdown();
                    // amqpwrapper.Instance().connect(null);
                } else {
                    Logger.instanse.error("QueueClient", "SendForProcessing", error);
                }
                reject(error);
            }
        });
    }
}