import * as WebSocket from "ws";
import { SocketMessage } from "./SocketMessage";
import { Message, JSONfn } from "./Messages/Message";
import { Config } from "./Config";
import { amqpwrapper, QueueMessageOptions, amqpqueue, amqpexchange, exchangealgorithm } from "./amqpwrapper";
import { NoderedUtil, Base, InsertOneMessage, QueueMessage, MapReduceMessage, QueryMessage, UpdateOneMessage, UpdateManyMessage, DeleteOneMessage, User, mapFunc, reduceFunc, finalizeFunc, QueuedMessage, QueuedMessageCallback, WatchEventMessage, QueueClosedMessage, ExchangeClosedMessage } from "@openiap/openflow-api";
import { ChangeStream } from "mongodb";
import { WebSocketServer } from "./WebSocketServer";
import { Span } from "@opentelemetry/api";
import { Logger } from "./Logger";
import { WebServer } from "./WebServer";
import { clientType } from "./Audit";
interface IHashTable<T> {
    [key: string]: T;
}
const Semaphore = (n) => ({
    n,
    async down() {
        while (this.n <= 0) await this.wait();
        this.n--;
    },
    up() {
        this.n++;
    },
    async wait() {
        if (this.n <= 0) return await new Promise((res, req) => {
            setImmediate(async () => res(await this.wait()))
        });
        return;
    },
});
const semaphore = Semaphore(1);

export declare class RegisterExchangeResponse {
    exchangename: string;
    queuename: string;
}
export class clsstream {
    public stream: ChangeStream;
    public id: string;
    public callback: any;
}
export class WebSocketServerClient {
    public jwt: string;
    private _socketObject: WebSocket;
    private _receiveQueue: SocketMessage[];
    private _sendQueue: SocketMessage[];
    public messageQueue: IHashTable<QueuedMessage> = {};
    public remoteip: string;
    public clientagent: clientType;
    public clientversion: string;
    public lastheartbeat: Date = new Date();
    public metrics: string = "";
    public id: string = "";
    user: User;
    public _queues: amqpqueue[] = [];
    public _exchanges: amqpexchange[] = [];
    public devnull: boolean = false;
    public commandcounter: object = {};
    public inccommandcounter(command: string): number {
        let result: number = 0;
        if (!NoderedUtil.IsNullUndefinded(this.commandcounter[command])) result = this.commandcounter[command];
        result++;
        this.commandcounter[command] = result;
        return result;
    }
    constructor(socketObject: WebSocket, req: any) {
        this.id = NoderedUtil.GetUniqueIdentifier();
        this._socketObject = socketObject;
        this._receiveQueue = [];
        this._sendQueue = [];
        const sock: any = ((socketObject as any)._socket);
        if (sock != undefined) {
            this.remoteip = sock.remoteAddress;
        }
        //if (NoderedUtil.IsNullEmpty(this.remoteip) && !NoderedUtil.IsNullUndefinded(req) && !NoderedUtil.IsNullUndefinded(req.headers)) {
        if (!NoderedUtil.IsNullUndefinded(req)) {
            this.remoteip = WebServer.remoteip(req);
        }
        Logger.instanse.info("new client " + this.id + " from " + this.remoteip);
        socketObject.on("open", (e: Event): void => this.open(e));
        socketObject.on("message", (e: string): void => (this.message(e) as any)); // e: MessageEvent
        socketObject.on("error", (e: Event): void => this.error(e));
        socketObject.on("close", (e: CloseEvent): void => this.close(e));

        amqpwrapper.Instance().on("disconnected", (e: Event): void => this.amqpdisconnected(e));
    }
    private amqpdisconnected(e: Event): void {
        for (var i = 0; i < this._queues.length; i++) {
            let msg: SocketMessage = SocketMessage.fromcommand("queueclosed");
            let q: QueueClosedMessage = new QueueClosedMessage();
            q.queuename = this._queues[i].queue;
            msg.data = JSON.stringify(q);
            this._socketObject.send(msg.tojson());
            Logger.instanse.info("Send queue closed message to " + this.id + " for queue " + q.queuename);
        }
        for (var i = 0; i < this._exchanges.length; i++) {
            let msg: SocketMessage = SocketMessage.fromcommand("exchangeclosed");
            let q: ExchangeClosedMessage = new ExchangeClosedMessage();
            q.queuename = this._exchanges[i].queue.queue; q.exchangename = this._exchanges[i].exchange;
            msg.data = JSON.stringify(q);
            this._socketObject.send(msg.tojson());
            Logger.instanse.info("Send queue closed message to " + this.id + " for exchange " + q.exchangename);
        }
        this._exchanges = [];
        this.CloseConsumers(null);
    }
    private open(e: Event): void {
        Logger.instanse.info("WebSocket connection opened " + e + " " + this.id);
    }
    private close(e: CloseEvent): void {
        Logger.instanse.info("WebSocket connection closed " + e + " " + this.id + "/" + this.clientagent);
        this.Close();
    }
    private error(e: Event): void {
        Logger.instanse.error("WebSocket error encountered " + e + " " + this.id + "/" + this.clientagent);
    }
    public queuecount(): number {
        if (this._queues == null) return 0;
        return this._queues.length;
    }
    public connected(): boolean {
        if (this._socketObject == null) return false;
        if (this._socketObject.readyState === this._socketObject.OPEN || this._socketObject.readyState === this._socketObject.CONNECTING) {
            return true;
        }
        if (this._socketObject.readyState === this._socketObject.CLOSED) {
            delete this._socketObject;
        }
        return false;
    }
    public ping(parent: Span): void {
        const span: Span = Logger.otel.startSubSpan("WebSocketServerClient.ping", parent);
        try {
            let msg: SocketMessage = SocketMessage.fromcommand("ping");
            if (this._socketObject == null) {
                if (this.queuecount() > 0) {
                    this.CloseConsumers(span);
                }
                if (this.streamcount() > 0) {
                    this.CloseConsumers(span);
                }
                return;
            }
            if (this._socketObject.readyState === this._socketObject.CLOSED || this._socketObject.readyState === this._socketObject.CLOSING) {
                if (this.queuecount() > 0) {
                    this.CloseConsumers(span);
                }
                return;
            }
        } catch (error) {
            Logger.instanse.error(error);
            span.recordException(error);
            this._receiveQueue = [];
            this._sendQueue = [];
            if (this._socketObject != null) {
                this.Close().catch((err) => {
                    console.error(err);
                });
            }
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    private _message(message: string): void {
        Logger.instanse.silly("WebSocket message received " + message);
        let msg: SocketMessage = SocketMessage.fromjson(message);
        Logger.instanse.silly("WebSocket message received id: " + msg.id + " index: " + msg.index + " count: " + msg.count);
        this._receiveQueue.push(msg);
        if ((msg.index + 1) >= msg.count) this.ProcessQueue();
    }
    private async message(message: string): Promise<void> {
        let username: string = "Unknown";
        try {
            if (!NoderedUtil.IsNullUndefinded(this.user)) { username = this.user.username; }
            this._message(message);
        } catch (error) {
            Logger.instanse.error("[" + username + "/" + this.clientagent + "/" + this.id + "] WebSocket error encountered " + (error.message ? error.message : error));
            const errormessage: Message = new Message(); errormessage.command = "error"; errormessage.data = (error.message ? error.message : error);
            this._socketObject.send(JSON.stringify(errormessage));
        }
    }
    public async CloseConsumers(parent: Span): Promise<void> {
        await semaphore.down();
        for (let i = this._queues.length - 1; i >= 0; i--) {
            try {
                // await this.CloseConsumer(this._queues[i]);
                await amqpwrapper.Instance().RemoveQueueConsumer(this._queues[i], undefined);
                this._queues.splice(i, 1);
            } catch (error) {
                Logger.instanse.error("WebSocketclient::closeconsumers " + error);
            }
        }
        if (!NoderedUtil.IsNullUndefinded(WebSocketServer.websocket_queue_count)) WebSocketServer.websocket_queue_count.bind({ ...Logger.otel.defaultlabels, clientid: this.id }).update(this._queues.length);
        semaphore.up();
    }
    public async Close(): Promise<void> {
        const span: Span = Logger.otel.startSpan("WebSocketServerClient.Close");
        try {
            await this.CloseConsumers(span);
            await this.CloseStreams();
            if (this._socketObject != null) {
                try {
                    this._socketObject.removeListener("open", (e: Event): void => this.open(e));
                    this._socketObject.removeListener("message", (e: string): void => (this.message(e) as any)); // e: MessageEvent
                    this._socketObject.removeListener("error", (e: Event): void => this.error(e));
                    this._socketObject.removeListener("close", (e: CloseEvent): void => this.close(e));
                } catch (error) {
                    Logger.instanse.error("WebSocketclient::Close::removeListener " + error);
                }
                try {
                    this._socketObject.close();
                } catch (error) {
                    Logger.instanse.error("WebSocketclient::Close " + error);
                }
            }
        } catch (error) {
            span.recordException(error);
            throw error;
        } finally {
            WebSocketServer.update_mongodb_watch_count(this);
            Logger.otel.endSpan(span);
        }
    }
    public async CloseConsumer(queuename: string, parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("WebSocketServerClient.CloseConsumer", parent);
        try {
            var old = this._queues.length;
            for (let i = this._queues.length - 1; i >= 0; i--) {
                const q = this._queues[i];
                if (q && (q.queue == queuename || q.queuename == queuename)) {
                    try {
                        await amqpwrapper.Instance().RemoveQueueConsumer(this._queues[i], span);
                        this._queues.splice(i, 1);
                        if (!NoderedUtil.IsNullUndefinded(WebSocketServer.websocket_queue_count)) WebSocketServer.websocket_queue_count.bind({ ...Logger.otel.defaultlabels, clientid: this.id }).update(this._queues.length);
                    } catch (error) {
                        Logger.instanse.error("WebSocketclient::CloseConsumer " + error);
                    }
                }
            }
        } catch (error) {
            span.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public async RegisterExchange(exchangename: string, algorithm: exchangealgorithm, routingkey: string = "", parent: Span): Promise<RegisterExchangeResponse> {
        const span: Span = Logger.otel.startSubSpan("WebSocketServerClient.CreateConsumer", parent);
        try {
            let exclusive: boolean = false; // Should we keep the queue around ? for robots and roles
            let exchange = exchangename;
            if (NoderedUtil.IsNullEmpty(exchange)) {
                if (this.clientagent == "nodered") {
                    exchange = "nodered." + NoderedUtil.GetUniqueIdentifier(); exclusive = true;
                } else if (this.clientagent == "webapp") {
                    exchange = "webapp." + NoderedUtil.GetUniqueIdentifier(); exclusive = true;
                } else if (this.clientagent == "openrpa") {
                    exchange = "openrpa." + NoderedUtil.GetUniqueIdentifier(); exclusive = true;
                } else if (this.clientagent == "powershell") {
                    exchange = "powershell." + NoderedUtil.GetUniqueIdentifier(); exclusive = true;
                } else {
                    exchange = "unknown." + NoderedUtil.GetUniqueIdentifier(); exclusive = true;
                }
            }
            await semaphore.down();
            let exchangequeue: amqpexchange = null;
            try {
                const AssertExchangeOptions: any = Object.assign({}, (amqpwrapper.Instance().AssertExchangeOptions));
                AssertExchangeOptions.exclusive = exclusive;
                exchangequeue = await amqpwrapper.Instance().AddExchangeConsumer(exchange, algorithm, routingkey, AssertExchangeOptions, this.jwt, async (msg: any, options: QueueMessageOptions, ack: any, done: any) => {
                    const _data = msg;
                    try {
                        const result = await this.Queue(msg, exchange, options);
                        ack();
                        done(result);
                    } catch (error) {
                        setTimeout(() => {
                            ack(false);
                            done(_data);
                            console.error(exchange + " failed message queue message, nack and re queue message: ", (error.message ? error.message : error));
                        }, Config.amqp_requeue_time);
                    }
                }, span);
                if (exchangequeue) {
                    exchange = exchangequeue.queue.queue;
                    this._exchanges.push(exchangequeue);
                    this._queues.push(exchangequeue.queue);
                }
            } catch (error) {
                Logger.instanse.error("WebSocketclient::CreateConsumer " + error);
            }
            semaphore.up();
            if (exchangequeue != null) return { exchangename: exchangequeue.exchange, queuename: exchangequeue.queue.queue };
            return null;
        } catch (error) {
            span.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public async CreateConsumer(queuename: string, parent: Span): Promise<string> {
        const span: Span = Logger.otel.startSubSpan("WebSocketServerClient.CreateConsumer", parent);
        try {
            let exclusive: boolean = false; // Should we keep the queue around ? for robots and roles
            let qname = queuename;
            if (NoderedUtil.IsNullEmpty(qname)) {
                if (this.clientagent == "nodered") {
                    qname = "nodered." + NoderedUtil.GetUniqueIdentifier(); exclusive = true;
                } else if (this.clientagent == "webapp") {
                    qname = "webapp." + NoderedUtil.GetUniqueIdentifier(); exclusive = true;
                } else if (this.clientagent == "openrpa") {
                    qname = "openrpa." + NoderedUtil.GetUniqueIdentifier(); exclusive = true;
                } else if (this.clientagent == "powershell") {
                    qname = "powershell." + NoderedUtil.GetUniqueIdentifier(); exclusive = true;
                } else {
                    qname = "unknown." + NoderedUtil.GetUniqueIdentifier(); exclusive = true;
                }
            }
            await semaphore.down();
            this.CloseConsumer(qname, span);
            let queue: amqpqueue = null;
            try {
                const AssertQueueOptions: any = Object.assign({}, (amqpwrapper.Instance().AssertQueueOptions));
                AssertQueueOptions.exclusive = exclusive;
                if (NoderedUtil.IsNullEmpty(queuename)) {
                    AssertQueueOptions.autoDelete = true;
                }
                queue = await amqpwrapper.Instance().AddQueueConsumer(qname, AssertQueueOptions, this.jwt, async (msg: any, options: QueueMessageOptions, ack: any, done: any) => {
                    const _data = msg;
                    try {
                        Logger.instanse.verbose("[preack] queuename: " + queuename + " qname: " + qname + " replyto: " + options.replyTo + " correlationId: " + options.correlationId)
                        const result = await this.Queue(msg, qname, options);
                        ack();
                        done(result);
                        Logger.instanse.debug("[ack] queuename: " + queuename + " qname: " + qname + " replyto: " + options.replyTo + " correlationId: " + options.correlationId)
                    } catch (error) {
                        setTimeout(() => {
                            ack(false);
                            done(_data);
                            Logger.instanse.warn("[nack] queuename: " + queuename + " qname: " + qname + " replyto: " + options.replyTo + " correlationId: " + options.correlationId + " error: " + (error.message ? error.message : error))
                        }, Config.amqp_requeue_time);
                    }
                }, span);
                if (queue) {
                    qname = queue.queue;
                    this._queues.push(queue);
                }
                if (!NoderedUtil.IsNullUndefinded(WebSocketServer.websocket_queue_count)) WebSocketServer.websocket_queue_count.bind({ ...Logger.otel.defaultlabels, clientid: this.id }).update(this._queues.length);
            } catch (error) {
                throw error
            }
            finally {
                semaphore.up();
            }
            if (queue != null) {
                return queue.queue;
            }
            return null;
        } catch (error) {
            span.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    sleep(ms) {
        return new Promise(resolve => {
            setTimeout(resolve, ms)
        })
    }
    private ProcessQueue(): void {
        if (this.devnull) {
            this._receiveQueue = [];
            this._sendQueue = [];
            return;
        }
        let username: string = "Unknown";
        if (!NoderedUtil.IsNullUndefinded(this.user)) { username = this.user.username; }
        let ids: string[] = [];
        this._receiveQueue.forEach(msg => {
            if (ids.indexOf(msg.id) === -1) { ids.push(msg.id); }
        });
        ids.forEach(id => {
            const msgs: SocketMessage[] = this._receiveQueue.filter(function (msg: SocketMessage): boolean { return msg.id === id; });
            if (this._receiveQueue.length > Config.websocket_max_package_count) {
                if (Config.websocket_disconnect_out_of_sync) {
                    Logger.instanse.error("[" + username + "/" + this.clientagent + "/" + this.id + "] _receiveQueue containers more than " + Config.websocket_max_package_count + " messages for id '" + id + "', disconnecting");
                    this.Close();
                } else {
                    Logger.instanse.error("[" + username + "/" + this.clientagent + "/" + this.id + "] _receiveQueue containers more than " + Config.websocket_max_package_count + " messages for id '" + id + "' so discarding all !!!!!!!");
                    this._receiveQueue = this._receiveQueue.filter(function (msg: SocketMessage): boolean { return msg.id !== id; });
                }
            }
            const first: SocketMessage = msgs[0];
            if (first.count === msgs.length) {
                msgs.sort((a, b) => a.index - b.index);
                if (msgs.length === 1) {
                    this._receiveQueue = this._receiveQueue.filter(function (msg: SocketMessage): boolean { return msg.id !== id; });
                    const singleresult: Message = Message.frommessage(first, first.data);
                    singleresult.priority = first.priority;
                    singleresult.Process(this);
                } else {
                    let buffer: string = "";
                    msgs.forEach(msg => {
                        if (!NoderedUtil.IsNullUndefinded(msg.data)) { buffer += msg.data; }
                    });
                    this._receiveQueue = this._receiveQueue.filter(function (msg: SocketMessage): boolean { return msg.id !== id; });
                    const result: Message = Message.frommessage(first, buffer);
                    result.priority = first.priority;
                    result.Process(this);
                }
            }
        });
        this._sendQueue.forEach(msg => {
            let id: string = msg.id;
            try {
                if (this._socketObject != null) this._socketObject.send(JSON.stringify(msg));
            } catch (error) {
                Logger.instanse.error("WebSocket error encountered " + error);
            }
            this._sendQueue = this._sendQueue.filter(function (msg: SocketMessage): boolean { return msg.id !== id; });
        });
    }
    public async Send<T>(message: Message): Promise<T> {
        return new Promise<T>(async (resolve, reject) => {
            this._Send(message, ((msg) => {
                if (!NoderedUtil.IsNullUndefinded(msg.error)) { return reject(msg.error); }
                resolve(msg);
            }).bind(this));
        });
    }
    private _Send(message: Message, cb: QueuedMessageCallback): void {
        const messages: string[] = this.chunkString(message.data, Config.websocket_package_size);
        if (NoderedUtil.IsNullUndefinded(messages) || messages.length === 0) {
            const singlemessage: SocketMessage = SocketMessage.frommessage(message, "", 1, 0);
            if (NoderedUtil.IsNullEmpty(message.replyto)) {
                this.messageQueue[singlemessage.id] = new QueuedMessage(singlemessage, cb);
                WebSocketServer.update_message_queue_count(this);
            }
            this._sendQueue.push(singlemessage);
            return;
        }
        if (NoderedUtil.IsNullEmpty(message.id)) { message.id = NoderedUtil.GetUniqueIdentifier(); }
        for (let i: number = 0; i < messages.length; i++) {
            const _message: SocketMessage = SocketMessage.frommessage(message, messages[i], messages.length, i);
            this._sendQueue.push(_message);
        }
        if (NoderedUtil.IsNullEmpty(message.replyto)) {
            this.messageQueue[message.id] = new QueuedMessage(message, cb);
            WebSocketServer.update_message_queue_count(this);
        }
        this.ProcessQueue();
    }
    public chunkString(str: string, length: number): string[] {
        if (NoderedUtil.IsNullEmpty(str)) { return null; }
        // tslint:disable-next-line: quotemark
        return str.match(new RegExp('.{1,' + length + '}', 'g'));
    }
    async Queue(data: string, queuename: string, options: QueueMessageOptions): Promise<any[]> {
        const d: any = JSON.parse(data);
        const q: QueueMessage = new QueueMessage();
        if (this.clientversion == "1.0.80.0" || this.clientversion == "1.0.81.0" || this.clientversion == "1.0.82.0" || this.clientversion == "1.0.83.0" || this.clientversion == "1.0.84.0" || this.clientversion == "1.0.85.0") {
            q.data = d.payload;
        } else {
            q.data = d;
        }
        q.replyto = options.replyTo;
        q.error = d.error;
        q.correlationId = options.correlationId; q.queuename = queuename;
        q.consumerTag = options.consumerTag;
        q.routingkey = options.routingKey;
        q.exchange = options.exchange;
        let m: Message = Message.fromcommand("queuemessage");
        if (NoderedUtil.IsNullEmpty(q.correlationId)) { q.correlationId = m.id; }
        m.data = JSON.stringify(q);
        const q2 = await this.Send<QueueMessage>(m);
        if ((q2 as any).command == "error") throw new Error(q2.data);
        return q2.data;
    }
    async Query<T extends Base>(collection: string, query: any, projection: any = null, orderby: any = { _created: -1 }, top: number = 500, skip: number = 0): Promise<any[]> {
        const q: QueryMessage = new QueryMessage();
        q.collectionname = collection; q.query = query;
        q.projection = projection; q.orderby = orderby; q.top = top; q.skip = skip;
        const msg: Message = new Message(); msg.command = "query"; msg.data = JSON.stringify(q);
        const q2 = await this.Send<QueryMessage>(msg);
        return q2.result as T[];
    }
    async MapReduce(collection: string, map: mapFunc, reduce: reduceFunc, finalize: finalizeFunc, query: any, out: string | any, scope: any): Promise<any> {
        const q: MapReduceMessage = new MapReduceMessage(map, reduce, finalize, query, out);
        q.collectionname = collection; q.scope = scope;
        const msg: Message = new Message(); msg.command = "mapreduce"; q.out = out;
        msg.data = JSONfn.stringify(q);
        const q2 = await this.Send<MapReduceMessage>(msg);
        return q2.result;
    }
    async Insert<T extends Base>(collection: string, model: any): Promise<any> {
        const q: InsertOneMessage = new InsertOneMessage();
        q.collectionname = collection; q.item = model;
        const msg: Message = new Message(); msg.command = "insertone"; msg.data = JSONfn.stringify(q);
        const q2 = await this.Send<InsertOneMessage>(msg);
        return q2.result as T[];
    }
    async Update<T extends Base>(collection: string, model: any): Promise<any> {
        const q: UpdateOneMessage = new UpdateOneMessage();
        q.collectionname = collection; q.item = model;
        const msg: Message = new Message(); msg.command = "updateone"; msg.data = JSONfn.stringify(q);
        const q2 = await this.Send<UpdateOneMessage>(msg);
        return q2.result as T[];
    }
    async UpdateMany<T extends Base>(collection: string, query: any, document: any): Promise<any> {
        const q: UpdateManyMessage = new UpdateManyMessage();
        q.collectionname = collection; q.item = document; q.query = query;
        const msg: Message = new Message(); msg.command = "updateone"; msg.data = JSONfn.stringify(q);
        const q2 = await this.Send<UpdateManyMessage>(msg);
        return q2.result as T[];
    }
    async Delete(collection: string, id: any): Promise<void> {
        const q: DeleteOneMessage = new DeleteOneMessage();
        q.collectionname = collection; q._id = id;
        const msg: Message = new Message(); msg.command = "deleteone"; msg.data = JSON.stringify(q);
        await this.Send<DeleteOneMessage>(msg);
    }
    streams: clsstream[] = [];
    public streamcount(): number {
        if (this.streams == null) return 0;
        return this.streams.length;
    }
    async CloseStreams(): Promise<void> {
        if (this.streams != null && this.streams.length > 0) {
            for (let i = this.streams.length - 1; i >= 0; i--) {
                try {
                    if (this.streams[i] != null && this.streams[i].stream != null && !this.streams[i].stream.isClosed()) {
                        await this.streams[i].stream.close();
                    }
                    this.streams.splice(i, 1);
                } catch (error) {
                    Logger.instanse.error("WebSocketclient::CloseStreams " + error + " " + this.id + "/" + this.clientagent);
                }
            }
        }
    }
    async CloseStream(id: string): Promise<void> {
        if (this.streams != null && this.streams.length > 0) {
            for (let i = this.streams.length - 1; i >= 0; i--) {
                try {
                    if (this.streams[i] != null && this.streams[i].id == id) {
                        if (!this.streams[i].stream.isClosed()) await this.streams[i].stream.close();
                        this.streams.splice(i, 1);
                    }
                } catch (error) {
                    Logger.instanse.error("WebSocketclient::CloseStream " + error + " " + this.id + "/" + this.clientagent);
                }
            }
        }
        WebSocketServer.update_mongodb_watch_count(this);
    }
    async UnWatch(id: string, jwt: string): Promise<void> {
        this.CloseStream(id);
    }
    async Watch(aggregates: object[], collectionname: string, jwt: string): Promise<string> {
        const stream: clsstream = new clsstream();
        stream.id = NoderedUtil.GetUniqueIdentifier();
        stream.stream = await Config.db.watch(aggregates, collectionname, jwt);
        this.streams.push(stream);

        const options = { fullDocument: "updateLookup" };
        const me = this;
        try {
            (stream.stream as any).on("error", err => {
                console.error(err);
            });
            (stream.stream as any).on("change", next => {
                try {
                    Logger.instanse.info("Watch: " + JSON.stringify(next.documentKey));
                    const msg: SocketMessage = SocketMessage.fromcommand("watchevent");
                    const q = new WatchEventMessage();
                    q.id = stream.id;
                    q.result = next;
                    if (q.result && q.result.fullDocument) {
                        q.result.fullDocument = Config.db.decryptentity(q.result.fullDocument);
                    }
                    msg.data = JSON.stringify(q);
                    me._socketObject.send(msg.tojson());
                } catch (error) {
                    Logger.instanse.error("WebSocketclient::Watch::changeListener " + error + " " + this.id + "/" + this.clientagent);
                }
            }, options);
            WebSocketServer.update_mongodb_watch_count(this);
            return stream.id;
        } catch (error) {
            Logger.instanse.error("WebSocketclient::Watch " + error + " " + this.id + "/" + this.clientagent);
            throw error;
        }
    }

}