import * as winston from "winston";
import * as WebSocket from "ws";
import * as amqplib from "amqplib";
import { SocketMessage } from "./SocketMessage";
import { Message, JSONfn } from "./Messages/Message";
import { User } from "./User";
import { DatabaseConnection, mapFunc, reduceFunc, finalizeFunc } from "./DatabaseConnection";
import { Config } from "./Config";
import { amqp_consumer } from "./amqp_consumer";
import { QueueMessage } from "./Messages/QueueMessage";
import { QueryMessage } from "./Messages/QueryMessage";
import { MapReduceMessage } from "./Messages/MapReduceMessage";
import { InsertOneMessage } from "./Messages/InsertOneMessage";
import { UpdateOneMessage } from "./Messages/UpdateOneMessage";
import { DeleteOneMessage } from "./Messages/DeleteOneMessage";
import { Base } from "./base";

interface IHashTable<T> {
    [key: string]: T;
}
type QueuedMessageCallback = (msg: any) => any;
export class QueuedMessage {
    constructor(message:any, cb: QueuedMessageCallback) {
        this.id = message.id;
        this.message = message;
        this.cb = cb;
    }
    public cb: QueuedMessageCallback;
    public id:string;
    public message:any;
}
export class WebSocketClient {
    public jwt: string;
    public  _logger: winston.Logger;
    private  _socketObject: WebSocket;
    private _receiveQueue: SocketMessage[];
    private _sendQueue: SocketMessage[];
    public messageQueue: IHashTable<QueuedMessage> = {};

    user: User;
    private consumers:amqp_consumer[] = [];
    constructor(logger: winston.Logger, socketObject: WebSocket) {
        this._logger = logger;
        this._socketObject = socketObject;
        this._receiveQueue = [];
        this._sendQueue = [];
        logger.info("new client ");;
        socketObject.on("open", (e: Event):void => this.open(e));
        socketObject.on("message", (e: string):void => this.message(e)); // e: MessageEvent
        socketObject.on("error", (e: Event):void => this.error(e));
        socketObject.on("close", (e: CloseEvent):void => this.close(e));
    }
    private open(e: Event):void {
        this._logger.info("WebSocket connection opened " + e);
    }
    private close(e: CloseEvent):void {
        this._logger.info("WebSocket connection closed " + e);
    }
    private error(e: Event):void {
        this._logger.error("WebSocket error encountered " + e);
    }
    private message(message: string):void { // e: MessageEvent
        try {
            this._logger.silly("WebSocket message received " + message);
            let msg: SocketMessage = SocketMessage.fromjson(message);
            this._receiveQueue.push(msg);
            this.ProcessQueue();
        } catch (error) {
            this._logger.error("WebSocket error encountered " + error.message);
            var errormessage:Message = new Message(); errormessage.command = "error"; errormessage.data = error.message;
            this._socketObject.send(JSON.stringify(errormessage));
        }
    }
    public async CloseConsumers():Promise<void> {
        for(let i=0; i < this.consumers.length;i++) {
            try {
                this.consumers[i].OnMessage = null;
                await this.consumers[i].close();
            } catch (error) {
                this._logger.error("WebSocketclient::closeconsumers " + error);        
            }
        }
        this.consumers = [];
    }
    public async CreateConsumer(queuename:string):Promise<void> {
        var consumer = new amqp_consumer(this._logger, Config.amqp_url, queuename);
        consumer.OnMessage = this.OnMessage.bind(this);
        this.consumers.push(consumer);
        await consumer.connect(false);
    }
    public async CloseConsumer(queuename:string):Promise<void> {
        var index = -1;
        for(let i=0; i < this.consumers.length;i++) {
            if(this.consumers[i].queue == queuename) index = i;
        }
        if(index==-1) return;
        var consumer:amqp_consumer = this.consumers[index];
        this.consumers = this.consumers.splice(index, 1);
        consumer.OnMessage = null;
        await consumer.close();
    }
    public async sendQueueReply(msg:QueueMessage) {
        try {
            var index = -1;
            for(let i=0; i < this.consumers.length;i++) {
                if(this.consumers[i].queue == msg.queuename) index = i;
            }
            if(index==-1) return;
            this.consumers[index].sendToQueue(msg.replyto, msg.correlationId, msg.data);
        } catch (error) {
            this._logger.error("WebSocketclient::WebSocket error encountered " + error);
        }
    }
    public async sendToQueue(msg:QueueMessage) {
        if(this.consumers.length === 0) { throw new Error("No consumers for client available to send message through") }
        this.consumers[0].sendToQueue(msg.queuename, msg.correlationId, msg.data);
    }
    async OnMessage(sender: amqp_consumer, msg: amqplib.ConsumeMessage ) {
        try {
            var data = await this.Queue(msg.content.toString(), msg.properties.replyTo, msg.properties.correlationId, sender.queue);
            this._logger.debug("WebSocketclient::WebSocket ack message in queue " + sender.queue);
            sender.channel.ack(msg);
        } catch (error) {
            this._logger.error("WebSocketclient::WebSocket error in queue " + sender.queue + " / " + error);
            sender.channel.nack(msg);
        }
        
    }
    public ping():boolean {
        try {
            let msg: SocketMessage = SocketMessage.fromcommand("ping");
            if(this._socketObject.readyState===this._socketObject.CLOSED
                || this._socketObject.readyState===this._socketObject.CLOSING) { 
                    this.CloseConsumers();
                    return false; 
                }
            this._socketObject.send(msg.tojson());
            return true;
        } catch (error) {
            this._logger.error("WebSocketclient::WebSocket error encountered " + error);
            this.CloseConsumers();
            return false;
        }
    }
    private ProcessQueue():void {
        let ids: string[] = [];
        this._receiveQueue.forEach(msg => {
            if(ids.indexOf(msg.id) === -1) { ids.push(msg.id); }
        });
        ids.forEach(id => {
            var msgs: SocketMessage[] = this._receiveQueue.filter(function (msg:SocketMessage):boolean { return msg.id===id; });
            msgs.sort((a, b) => a.index - b.index);
            var first: SocketMessage = msgs[0];
            if(first.count === msgs.length) {
                if(msgs.length === 1) {
                    var singleresult: Message = Message.frommessage(first, first.data);
                    singleresult.Process(this);
                } else {
                    var buffer: string = "";
                    msgs.forEach(msg => {
                        if(msg.data!==null && msg.data !== undefined) { buffer += msg.data; }
                    });
                    var result: Message = Message.frommessage(first, buffer);
                    result.Process(this);
                }
                this._receiveQueue = this._receiveQueue.filter(function (msg: SocketMessage):boolean { return msg.id!==id;});
            }
        });
        this._sendQueue.forEach(msg => {
            if(msg.command!=="pong") {
                var b = msg.command;
            }
            let id: string = msg.id;
            try {
                this._socketObject.send(JSON.stringify(msg));
            } catch (error) {
                this._logger.error("WebSocket error encountered " + error);
            }
            this._sendQueue = this._sendQueue.filter(function (msg: SocketMessage):boolean { return msg.id!==id;});
        });
    }
    public async Send<T>(message: Message):Promise<T> {
        return new Promise<T>(async (resolve, reject) => {
            this._Send(message, ((msg)=> {
                if(msg.error!==null && msg.error !== undefined) { return reject(msg.error); }
                resolve(msg);
            }).bind(this));
        });
    }
    private _Send(message: Message, cb: QueuedMessageCallback):void {
        // console.log("SEND:::" + message.command);
        var messages: string[] = this.chunkString(message.data, 500);
        if(messages===null || messages===undefined || messages.length === 0) {
            var singlemessage: SocketMessage = SocketMessage.frommessage(message, "", 1, 0);
            if(message.replyto === null || message.replyto === undefined) {
                this.messageQueue[singlemessage.id] = new QueuedMessage(singlemessage, cb);
            }
            this._sendQueue.push(singlemessage);
            return;
        }
        if(message.id === null || message.id === undefined) { message.id = Math.random().toString(36).substr(2, 9); }
        for(let i: number = 0; i < messages.length; i++) {
            var _message: SocketMessage = SocketMessage.frommessage(message, messages[i], messages.length, i);
            this._sendQueue.push(_message);
        }
        if(message.replyto === null || message.replyto === undefined) {
            this.messageQueue[message.id] = new QueuedMessage(message, cb);
        }
        // setTimeout(() => {
        //     this.ProcessQueue();
        // }, 500);
        this.ProcessQueue();
    }
    public chunkString(str: string, length: number): string[] {
        if(str===null || str === undefined) { return null; }
        // tslint:disable-next-line: quotemark
        return str.match(new RegExp('.{1,' + length + '}', 'g'));
    }




    async Queue(data:string, replyTo: string, correlationId:string, queuename:string):Promise<any[]> {
        var q: QueueMessage = new QueueMessage();
        q.data = data; q.replyto = replyTo;
        q.correlationId = correlationId; q.queuename = queuename;
        let m: Message = Message.fromcommand("queuemessage");
        q.correlationId = m.id;
        m.data = JSON.stringify(q);
        q = await this.Send<QueueMessage>(m);
        return q.data;
    }






    async Query<T extends Base>(collection:string, query: any, projection:any = null, orderby:any = {_created: -1}, top:number = 500, skip:number = 0):Promise<any[]> {
        var q: QueryMessage<T> = new QueryMessage<T>();
        q.collectionname = collection; q.query = query;
        q.projection = projection; q.orderby = orderby; q.top = top; q.skip = skip;
        var msg:Message  = new Message(); msg.command = "query"; msg.data = JSON.stringify(q);
        q = await this.Send<QueryMessage<T>>(msg);
        return q.result;
    }
    async MapReduce(collection:string, map: mapFunc, reduce: reduceFunc, finalize: finalizeFunc, query: any, out:string | any, scope:any):Promise<any> {
        var q: MapReduceMessage<any> = new MapReduceMessage(map, reduce, finalize, query, out);
        q.collectionname = collection; q.scope = scope;
        var msg:Message  = new Message(); msg.command = "mapreduce"; q.out = out;
        
        // msg.data = JSON.stringify(q);
        msg.data = JSONfn.stringify(q);
        q = await this.Send<MapReduceMessage<any>>(msg);
        return q.result;
    }
    async Insert<T extends Base>(collection:string, model: any):Promise<any> {
        var q: InsertOneMessage<T> = new InsertOneMessage();
        // model.name = "Find me " + Math.random().toString(36).substr(2, 9);
        q.collectionname = collection; q.item = model;
        var msg:Message  = new Message(); msg.command = "insertone"; msg.data = JSONfn.stringify(q);
        q = await this.Send<InsertOneMessage<T>>(msg);
        return q.result;
    }
    async Update<T extends Base>(collection:string, model: any):Promise<any> {
        var q: UpdateOneMessage<T> = new UpdateOneMessage();
        // model.name = "Find me " + Math.random().toString(36).substr(2, 9);
        q.collectionname = collection; q.item = model;
        var msg:Message  = new Message(); msg.command = "updateone"; msg.data = JSONfn.stringify(q);
        q = await this.Send<UpdateOneMessage<T>>(msg);
        return q.result;
    }
    async Delete(collection:string, id: any):Promise<void> {
        var q: DeleteOneMessage = new DeleteOneMessage();
        q.collectionname = collection; q._id = id;
        var msg:Message  = new Message(); msg.command = "deleteone"; msg.data = JSON.stringify(q);
        q = await this.Send<DeleteOneMessage>(msg);
        // this.models = this.models.filter(function (m: any):boolean { return m._id!==model._id;});
        // if (!this.$scope.$$phase) { this.$scope.$apply(); }
    }

    
}