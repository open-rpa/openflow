import * as winston from "winston";
import * as WebSocket from "ws";
import { SocketMessage } from "./SocketMessage";
import { Message, JSONfn } from "./Messages/Message";
import { Config } from "./Config";
import { amqpwrapper, QueueMessageOptions, amqpqueue } from "./amqpwrapper";
import { NoderedUtil, Base, InsertOneMessage, QueueMessage, MapReduceMessage, QueryMessage, UpdateOneMessage, UpdateManyMessage, DeleteOneMessage, User, mapFunc, reduceFunc, finalizeFunc, QueuedMessage, QueuedMessageCallback } from "openflow-api";
// import { Mutex } from "./Mutex";

interface IHashTable<T> {
    [key: string]: T;
}
// type QueuedMessageCallback = (msg: any) => any;
// export class QueuedMessage {
//     constructor(message: any, cb: QueuedMessageCallback) {
//         this.id = message.id;
//         this.message = message;
//         this.cb = cb;
//     }
//     public cb: QueuedMessageCallback;
//     public id: string;
//     public message: any;
// }
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


export class WebSocketServerClient {
    public jwt: string;
    public _logger: winston.Logger;
    private _socketObject: WebSocket;
    private _receiveQueue: SocketMessage[];
    private _sendQueue: SocketMessage[];
    public messageQueue: IHashTable<QueuedMessage> = {};
    public remoteip: string;
    public clientagent: string;
    public clientversion: string;
    public lastheartbeat: Date = new Date();
    public id: string = "";

    user: User;
    // public consumers: amqp_consumer[] = [];
    // public queues: IHashTable<amqpqueue> = {};
    public _queues: amqpqueue[] = [];
    // public queuesMutex = new Mutex();






    constructor(logger: winston.Logger, socketObject: WebSocket, req: any) {
        this._logger = logger;
        this.id = Math.random().toString(36).substr(2, 9);
        this._socketObject = socketObject;
        this._receiveQueue = [];
        this._sendQueue = [];
        const sock: any = ((socketObject as any)._socket);
        if (sock != undefined) {
            this.remoteip = sock.remoteAddress;
        }
        //if (NoderedUtil.IsNullEmpty(this.remoteip) && !NoderedUtil.IsNullUndefinded(req) && !NoderedUtil.IsNullUndefinded(req.headers)) {
        if (!NoderedUtil.IsNullUndefinded(req)) {
            if (!NoderedUtil.IsNullUndefinded(req.connection) && !NoderedUtil.IsNullEmpty(req.connection.remoteAddress)) this.remoteip = req.connection.remoteAddress;
            if (!NoderedUtil.IsNullUndefinded(req.headers)) {
                if (req.headers["X-Forwarded-For"] != null) this.remoteip = req.headers["X-Forwarded-For"];
                if (req.headers["X-real-IP"] != null) this.remoteip = req.headers["X-real-IP"];
                if (req.headers["x-forwarded-for"] != null) this.remoteip = req.headers["x-forwarded-for"];
                if (req.headers["x-real-ip"] != null) this.remoteip = req.headers["x-real-ip"];
            }
        }
        logger.info("new client " + this.id);;
        socketObject.on("open", (e: Event): void => this.open(e));
        socketObject.on("message", (e: string): void => this.message(e)); // e: MessageEvent
        socketObject.on("error", (e: Event): void => this.error(e));
        socketObject.on("close", (e: CloseEvent): void => this.close(e));
    }
    private open(e: Event): void {
        this._logger.info("WebSocket connection opened " + e);
    }
    private close(e: CloseEvent): void {
        this._logger.info("WebSocket connection closed " + e);
    }
    private error(e: Event): void {
        this._logger.error("WebSocket error encountered " + e);
    }
    public queuecount(): number {
        if (this._queues == null) return 0;
        // var keys = Object.keys(this.queues);
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
    public ping(): void {
        try {
            let msg: SocketMessage = SocketMessage.fromcommand("ping");
            if (this._socketObject == null) {
                if (this.queuecount() > 0) {
                    this.CloseConsumers();
                }
                return;
            }
            if (this._socketObject.readyState === this._socketObject.CLOSED || this._socketObject.readyState === this._socketObject.CLOSING) {
                if (this.queuecount() > 0) {
                    this.CloseConsumers();
                }
                return;
            }
            this._socketObject.send(msg.tojson());
        } catch (error) {
            this._logger.error("WebSocketclient::WebSocket error encountered " + error);
            this._receiveQueue = [];
            this._sendQueue = [];
            try {
                if (this._socketObject != null) {
                    this.Close();
                }
            } catch (error) {
            }
        }
    }
    private message(message: string): void { // e: MessageEvent
        try {
            //this._logger.silly("WebSocket message received " + message);
            let msg: SocketMessage = SocketMessage.fromjson(message);
            this._logger.silly("WebSocket message received id: " + msg.id + " index: " + msg.index + " count: " + msg.count);
            this._receiveQueue.push(msg);
            this.ProcessQueue();
        } catch (error) {
            this._logger.error("WebSocket error encountered " + error.message);
            var errormessage: Message = new Message(); errormessage.command = "error"; errormessage.data = error.message;
            this._socketObject.send(JSON.stringify(errormessage));
        }
    }
    public async CloseConsumers(): Promise<void> {
        await semaphore.down();
        for (let i = this._queues.length - 1; i >= 0; i--) {
            try {
                // await this.CloseConsumer(this._queues[i]);
                await amqpwrapper.Instance().RemoveQueueConsumer(this._queues[i]);
                this._queues.splice(i, 1);
            } catch (error) {
                this._logger.error("WebSocketclient::closeconsumers " + error);
            }
        }
        semaphore.up();
        // return await this.queuesMutex.dispatch(async () => {
        // });
    }
    public async Close(): Promise<void> {
        await this.CloseConsumers();
        if (this._socketObject != null) {
            try {
                this._socketObject.removeListener("open", (e: Event): void => this.open(e));
                this._socketObject.removeListener("message", (e: string): void => this.message(e)); // e: MessageEvent
                this._socketObject.removeListener("error", (e: Event): void => this.error(e));
                this._socketObject.removeListener("close", (e: CloseEvent): void => this.close(e));
            } catch (error) {
                this._logger.error("WebSocketclient::Close::removeListener " + error);
            }
            try {
                this._socketObject.close();
            } catch (error) {
                this._logger.error("WebSocketclient::Close " + error);
            }
        }
    }
    public async CloseConsumer(queuename: string): Promise<void> {
        for (var i = this._queues.length - 1; i >= 0; i--) {
            var q = this._queues[i];
            if (q.queue == queuename || q.queuename == queuename) {
                try {
                    await amqpwrapper.Instance().RemoveQueueConsumer(this._queues[i]);
                    this._queues.splice(i, 1);
                } catch (error) {
                    this._logger.error("WebSocketclient::CloseConsumer " + error);
                }
            }
        }
        // if (this.queues[queuename] != null) {
        //     try {
        //         await amqpwrapper.Instance().RemoveQueueConsumer(this.queues[queuename]);
        //         delete this.queues[queuename];
        //     } catch (error) {
        //         this._logger.error("WebSocketclient::CloseConsumer " + error);
        //     }
        // }
    }
    public async CreateConsumer(queuename: string): Promise<string> {
        var autoDelete: boolean = false; // Should we keep the queue around ? for robots and roles
        var qname = queuename;
        if (NoderedUtil.IsNullEmpty(qname)) {
            if (this.clientagent == "nodered") {
                qname = "nodered." + Math.random().toString(36).substr(2, 9); autoDelete = true;
            } else if (this.clientagent == "webapp") {
                qname = "webapp." + Math.random().toString(36).substr(2, 9); autoDelete = true;
            } else if (this.clientagent == "web") {
                qname = "web." + Math.random().toString(36).substr(2, 9); autoDelete = true;
            } else if (this.clientagent == "openrpa") {
                qname = "openrpa." + Math.random().toString(36).substr(2, 9); autoDelete = true;
            } else if (this.clientagent == "powershell") {
                qname = "powershell." + Math.random().toString(36).substr(2, 9); autoDelete = true;
            } else {
                qname = "unknown." + Math.random().toString(36).substr(2, 9); autoDelete = true;
            }
        }
        await semaphore.down();
        this.CloseConsumer(qname);
        try {
            // if (this.queues[qname] != null) {
            //     await amqpwrapper.Instance().RemoveQueueConsumer(this.queues[qname]);
            //     delete this.queues[qname];
            // }
            // var AssertQueueOptions: any = new Object(amqpwrapper.Instance().AssertQueueOptions);
            var AssertQueueOptions: any = Object.assign({}, (amqpwrapper.Instance().AssertQueueOptions));
            AssertQueueOptions.autoDelete = autoDelete;
            var queue = await amqpwrapper.Instance().AddQueueConsumer(qname, AssertQueueOptions, this.jwt, async (msg: any, options: QueueMessageOptions, ack: any, done: any) => {
                var _data = msg;
                try {
                    _data = await this.Queue(msg, qname, options);
                    ack();
                    done(_data);
                } catch (error) {
                    setTimeout(() => {
                        ack(false);
                        // ack(); // just eat the error 
                        done(_data);
                        if (error.message != null && error.message != "") {
                            console.log(qname + " failed message queue message, nack and re queue message: ", error.message);
                        } else {
                            console.log(qname + " failed message queue message, nack and re queue message: ", error);
                        }
                    }, Config.amqp_requeue_time);
                }
            });
            qname = queue.queue;
            // if (this.queues[qname] != null) {
            //     await amqpwrapper.Instance().RemoveQueueConsumer(this.queues[qname]);
            // }
            //this.queues[qname] = queue;
            this._queues.push(queue);
            console.log('_queues.length: ' + this._queues.length);
        } catch (error) {
            this._logger.error("WebSocketclient::CreateConsumer " + error);
        }
        semaphore.up();
        return queue.queue;
    }
    sleep(ms) {
        return new Promise(resolve => {
            setTimeout(resolve, ms)
        })
    }
    private ProcessQueue(): void {
        let username: string = "Unknown";
        if (!NoderedUtil.IsNullUndefinded(this.user)) { username = this.user.username; }
        let ids: string[] = [];
        this._receiveQueue.forEach(msg => {
            if (ids.indexOf(msg.id) === -1) { ids.push(msg.id); }
        });
        ids.forEach(id => {
            var msgs: SocketMessage[] = this._receiveQueue.filter(function (msg: SocketMessage): boolean { return msg.id === id; });
            if (this._receiveQueue.length > Config.websocket_max_package_count) {
                this._logger.error("_receiveQueue containers more than " + Config.websocket_max_package_count + " messages for id '" + id + "' so discarding all !!!!!!!");
                this._receiveQueue = this._receiveQueue.filter(function (msg: SocketMessage): boolean { return msg.id !== id; });
            }
            var first: SocketMessage = msgs[0];
            if (first.count === msgs.length) {
                msgs.sort((a, b) => a.index - b.index);
                if (msgs.length === 1) {
                    this._receiveQueue = this._receiveQueue.filter(function (msg: SocketMessage): boolean { return msg.id !== id; });
                    var singleresult: Message = Message.frommessage(first, first.data);
                    singleresult.Process(this);
                } else {
                    var buffer: string = "";
                    msgs.forEach(msg => {
                        if (!NoderedUtil.IsNullUndefinded(msg.data)) { buffer += msg.data; }
                    });
                    this._receiveQueue = this._receiveQueue.filter(function (msg: SocketMessage): boolean { return msg.id !== id; });
                    var result: Message = Message.frommessage(first, buffer);
                    result.Process(this);
                }
            } else {
                // this._logger.debug("[" + username + "] WebSocketclient::ProcessQueue receiveQueue: Cannot process i have " + msgs.length + " out of " + first.count + " for message " + first.id);
            }
        });
        this._sendQueue.forEach(msg => {
            let id: string = msg.id;
            try {
                this._socketObject.send(JSON.stringify(msg));
            } catch (error) {
                this._logger.error("WebSocket error encountered " + error);
            }
            this._sendQueue = this._sendQueue.filter(function (msg: SocketMessage): boolean { return msg.id !== id; });
        });
        // if (this._receiveQueue.length > 25 || this._sendQueue.length > 25) {
        //     this._logger.debug("[" + username + "] WebSocketclient::ProcessQueue receiveQueue: " + this._receiveQueue.length + " sendQueue: " + this._sendQueue.length);
        // }
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
        var messages: string[] = this.chunkString(message.data, 500);
        if (NoderedUtil.IsNullUndefinded(messages) || messages.length === 0) {
            var singlemessage: SocketMessage = SocketMessage.frommessage(message, "", 1, 0);
            if (NoderedUtil.IsNullEmpty(message.replyto)) {
                this.messageQueue[singlemessage.id] = new QueuedMessage(singlemessage, cb);
            }
            this._sendQueue.push(singlemessage);
            return;
        }
        if (NoderedUtil.IsNullEmpty(message.id)) { message.id = Math.random().toString(36).substr(2, 9); }
        for (let i: number = 0; i < messages.length; i++) {
            var _message: SocketMessage = SocketMessage.frommessage(message, messages[i], messages.length, i);
            this._sendQueue.push(_message);
        }
        if (NoderedUtil.IsNullEmpty(message.replyto)) {
            this.messageQueue[message.id] = new QueuedMessage(message, cb);
        }
        // setTimeout(() => {
        //     this.ProcessQueue();
        // }, 500);
        this.ProcessQueue();
    }
    public chunkString(str: string, length: number): string[] {
        if (NoderedUtil.IsNullEmpty(str)) { return null; }
        // tslint:disable-next-line: quotemark
        return str.match(new RegExp('.{1,' + length + '}', 'g'));
    }
    async Queue(data: string, queuename: string, options: QueueMessageOptions): Promise<any[]> {
        var d: any = JSON.parse(data);
        var q: QueueMessage = new QueueMessage();
        if (this.clientversion == "1.0.80.0" || this.clientversion == "1.0.81.0" || this.clientversion == "1.0.82.0" || this.clientversion == "1.0.83.0" || this.clientversion == "1.0.84.0" || this.clientversion == "1.0.85.0") {
            q.data = d.payload;
        } else {
            q.data = d;
        }
        // q.data = d.payload; 
        q.replyto = options.replyTo;
        q.error = d.error;
        q.correlationId = options.correlationId; q.queuename = queuename;
        q.consumerTag = options.consumerTag;
        q.routingkey = options.routingkey;
        q.exchange = options.exchange;

        let m: Message = Message.fromcommand("queuemessage");
        if (NoderedUtil.IsNullEmpty(q.correlationId)) { q.correlationId = m.id; }
        m.data = JSON.stringify(q);
        q = await this.Send<QueueMessage>(m);
        if ((q as any).command == "error") throw new Error(q.data);
        return q.data;
    }

    async Query<T extends Base>(collection: string, query: any, projection: any = null, orderby: any = { _created: -1 }, top: number = 500, skip: number = 0): Promise<any[]> {
        var q: QueryMessage = new QueryMessage();
        q.collectionname = collection; q.query = query;
        q.projection = projection; q.orderby = orderby; q.top = top; q.skip = skip;
        var msg: Message = new Message(); msg.command = "query"; msg.data = JSON.stringify(q);
        q = await this.Send<QueryMessage>(msg);
        return q.result as T[];
    }
    async MapReduce(collection: string, map: mapFunc, reduce: reduceFunc, finalize: finalizeFunc, query: any, out: string | any, scope: any): Promise<any> {
        var q: MapReduceMessage = new MapReduceMessage(map, reduce, finalize, query, out);
        q.collectionname = collection; q.scope = scope;
        var msg: Message = new Message(); msg.command = "mapreduce"; q.out = out;
        msg.data = JSONfn.stringify(q);
        q = await this.Send<MapReduceMessage>(msg);
        return q.result;
    }
    async Insert<T extends Base>(collection: string, model: any): Promise<any> {
        var q: InsertOneMessage = new InsertOneMessage();
        q.collectionname = collection; q.item = model;
        var msg: Message = new Message(); msg.command = "insertone"; msg.data = JSONfn.stringify(q);
        q = await this.Send<InsertOneMessage>(msg);
        return q.result as T[];
    }
    async Update<T extends Base>(collection: string, model: any): Promise<any> {
        var q: UpdateOneMessage = new UpdateOneMessage();
        q.collectionname = collection; q.item = model;
        var msg: Message = new Message(); msg.command = "updateone"; msg.data = JSONfn.stringify(q);
        q = await this.Send<UpdateOneMessage>(msg);
        return q.result as T[];
    }
    async UpdateMany<T extends Base>(collection: string, query: any, document: any): Promise<any> {
        var q: UpdateManyMessage = new UpdateManyMessage();
        q.collectionname = collection; q.item = document; q.query = query;
        var msg: Message = new Message(); msg.command = "updateone"; msg.data = JSONfn.stringify(q);
        q = await this.Send<UpdateManyMessage>(msg);
        return q.result as T[];
    }
    async Delete(collection: string, id: any): Promise<void> {
        var q: DeleteOneMessage = new DeleteOneMessage();
        q.collectionname = collection; q._id = id;
        var msg: Message = new Message(); msg.command = "deleteone"; msg.data = JSON.stringify(q);
        q = await this.Send<DeleteOneMessage>(msg);
    }


}