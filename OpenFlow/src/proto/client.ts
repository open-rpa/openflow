import express = require("express");
import * as  net from "net";
import * as  grpc from "@grpc/grpc-js";
import * as  WebSocket from "ws";
import { amqpexchange, amqpqueue, amqpwrapper, exchangealgorithm, QueueMessageOptions } from "../amqpwrapper";
import { Logger } from "../Logger";
import { Span } from "@opentelemetry/api";
import { NoderedUtil, TokenUser, User } from "@openiap/openflow-api";
import { Config } from "../Config";
import { RegisterExchangeResponse } from "../WebSocketServerClient";
import { client, DoPing, err, info, openiap, protowrap, QueueEvent, WatchEvent } from "@openiap/nodeapi";
import { clientAgent } from "@openiap/nodeapi/lib/client";
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
export type clientType = "socket" | "pipe" | "ws" | "grpc" | "rest";
export class flowclient extends client {
  public id: string = "";
  public seq: number = 0;
  public remoteip: string = "unknown";
  public agent: clientAgent;
  public protocol: clientType;
  public version: string;
  public doping: boolean;
  public created: Date = new Date();
  public lastheartbeat: Date = new Date();
  public lastheartbeatstr: string = new Date().toISOString();
  public lastheartbeatsec: string = "0";
  public user: any; // User
  public jwt: string;
  public signedin: boolean = false;
  public connected: boolean = false;
  public connecting: boolean = false;
  public queues: any[] = []; // amqpqueue[]
  public exchanges: any[] = []; // amqpexchange[]
  public watches: changestream[] = [];
  public url: string;
  public ws: WebSocket;
  public stream: net.Socket;
  public grpc: any;
  public call: any;
  public grpcStream: grpc.ClientDuplexStream<any, any>;
  public replies: any;
  public streams: any;

  public _queues: amqpqueue[] = [];
  public _queuescounter: number = 0;
  public _queuescurrent: number = 0;
  public _queuescounterstr: string = "0";
  public _queuescurrentstr: string = "0";
  public _exchanges: amqpexchange[] = [];

  async Initialize(ws: WebSocket, stream: net.Socket, call, req: express.Request): Promise<boolean> {
    try {
      this.replies = {};
      this.streams = {};
      this.doping = DoPing;
      if (ws != null) this.ws = ws;
      if (stream != null) this.stream = stream;
      if (call != null) this.call = call;
      if (req != null) this.remoteip = remoteip(req);
    } catch (error) {
      err(error);
    }
    return true;;
  }
  onConnected(client: client): void {
  }
  onDisconnected(client: client, error: Error): void {
    info("close " + this.id + " " + this.protocol + " " + this.remoteip + " " + this.agent);
  }
  async onMessage(client: client, message: any): Promise<any> {
    // const [command, msg, reply] = protowrap.unpack(message);
    // if (command == "ping") {
    //   reply.command = "pong";
    // }
    // return reply;
    message.command = "noop";
    return message;
  }
  ping(span: any) {
    if(this.connected == false) return;
    if(this.doping)  {
      protowrap.sendMesssag(this, {"command": "ping"}, null, true);
    } else {
      this.lastheartbeat = new Date();
      this.lastheartbeatstr = this.lastheartbeat.toISOString();
      this.lastheartbeatsec = (this.lastheartbeat.getTime() / 1000).toString();
      }
  }
  async Watch(aggregates: object[], collectionname: string, jwt: string): Promise<string> {
    if (typeof aggregates === "string") {
      try {
        aggregates = JSON.parse(aggregates);
      } catch (error) {
      }
    }
    // const stream: clsstream = new clsstream();
    const id = Math.random().toString(36).substring(2, 11);
    const stream: any = {id, collectionname, aggregates};
    this.watches[id] = stream;
    return id;
  }
  async UnWatch(id: string, jwt: string): Promise<void> {
    if (this.watches[id]) {
        delete this.watches[id];
    }
  }
  SendWatch(watch: any, next: any, span: any) {
    try {
        info("Notify " + this.user.username + " of " + next.operationType + " " + next.fullDocument.name);
        var paylad = {"command": "watchevent",
          "data": WatchEvent.encode(WatchEvent.create({"id": watch.id, "operation": next.operationType, "document": JSON.stringify(next.fullDocument)})).finish()}
        
        protowrap.sendMesssag(this, paylad, null, true);
    } catch (error) {
        console.error(error);
    } finally {
    }
  }
  public queuecount(): number {
    if (this._queues == null) return 0;
    return this._queues.length;
}
  public async CreateConsumer(queuename: string, parent: Span): Promise<string> {
    const span: Span = Logger.otel.startSubSpan("WebSocketServerClient.CreateConsumer", parent);
    try {
        let exclusive: boolean = false; // Should we keep the queue around ? for robots and roles
        let qname = queuename;
        if (NoderedUtil.IsNullEmpty(qname)) {
            if (this.agent == "nodered") {
                qname = "nodered." + NoderedUtil.GetUniqueIdentifier(); exclusive = true;
            } else if (this.agent == "browser") {
                qname = "webapp." + NoderedUtil.GetUniqueIdentifier(); exclusive = true;
            } else if (this.agent == "openrpa") {
                qname = "openrpa." + NoderedUtil.GetUniqueIdentifier(); exclusive = true;
            } else if (this.agent == "powershell") {
                qname = "powershell." + NoderedUtil.GetUniqueIdentifier(); exclusive = true;
            } else {
                qname = "unknown." + NoderedUtil.GetUniqueIdentifier(); exclusive = true;
            }
        }
        await this.CloseConsumer(this.user, qname, span);
        let queue: amqpqueue = null;
        try {
            const AssertQueueOptions: any = Object.assign({}, (amqpwrapper.Instance().AssertQueueOptions));
            AssertQueueOptions.exclusive = exclusive;
            if (NoderedUtil.IsNullEmpty(queuename)) {
                AssertQueueOptions.autoDelete = true;
            }
            var exists = this._queues.filter(x => x.queuename == qname || x.queue == qname);
            if (exists.length > 0) {
                Logger.instanse.warn(qname + " already exists, removing before re-creating", span);
                for (let i = 0; i < exists.length; i++) {
                    await amqpwrapper.Instance().RemoveQueueConsumer(this.user, exists[i], span);
                }
            }
            queue = await amqpwrapper.Instance().AddQueueConsumer(this.user, qname, AssertQueueOptions, this.jwt, async (msg: any, options: QueueMessageOptions, ack: any, done: any) => {
                // const _data = msg;
                let span: Span = null;
                var _data = msg;
                try {
                    var o = msg;
                    if (typeof o === 'string') o = JSON.parse(o);
                    span = Logger.otel.startSpan("OpenFlow Queue Process Message", o.traceId, o.spanId);
                    Logger.instanse.verbose("[preack] queuename: " + queuename + " qname: " + qname + " replyto: " + options.replyTo + " correlationId: " + options.correlationId, span)
                    _data = await this.Queue(msg, qname, options, span);;
                    ack();
                    // const result = await this.Queue(msg, qname, options);
                    // done(result);
                    Logger.instanse.debug("[ack] queuename: " + queuename + " qname: " + qname + " replyto: " + options.replyTo + " correlationId: " + options.correlationId, span)
                } catch (error) {
                    setTimeout(() => {
                        ack(false);
                        Logger.instanse.warn("[nack] queuename: " + queuename + " qname: " + qname + " replyto: " + options.replyTo + " correlationId: " + options.correlationId + " error: " + (error.message ? error.message : error), span)
                    }, Config.amqp_requeue_time);
                } finally {
                    Logger.otel.endSpan(span);
                    try {
                        done(_data);
                    } catch (error) {
                    }
                }
            }, span);
            if (queue) {
                await semaphore.down();
                qname = queue.queue;
                this._queuescounter++;
                this._queuescurrent++;
                this._queuescounterstr = this._queuescounter.toString();
                this._queuescurrentstr = this._queuescurrent.toString();
                this._queues.push(queue);
                console.log(this.id + " has " + this._queues.length + " queues")
            }
        } finally {
            if (queue) semaphore.up();
        }
        if (queue != null) {
            return queue.queue;
        }
        return null;
    } finally {
        Logger.otel.endSpan(span);
    }
  }
  public async RegisterExchange(user: TokenUser | User, exchangename: string, algorithm: exchangealgorithm, routingkey: string = "", addqueue: boolean, parent: Span): Promise<RegisterExchangeResponse> {
    const span: Span = Logger.otel.startSubSpan("WebSocketServerClient.RegisterExchange", parent);
    try {
        let exclusive: boolean = false; // Should we keep the queue around ? for robots and roles
        let exchange = exchangename;
        if (NoderedUtil.IsNullEmpty(exchange)) {
            if (this.agent == "nodered") {
                exchange = "nodered." + NoderedUtil.GetUniqueIdentifier(); exclusive = true;
            } else if (this.agent == "browser") {
                exchange = "webapp." + NoderedUtil.GetUniqueIdentifier(); exclusive = true;
            } else if (this.agent == "openrpa") {
                exchange = "openrpa." + NoderedUtil.GetUniqueIdentifier(); exclusive = true;
            } else if (this.agent == "powershell") {
                exchange = "powershell." + NoderedUtil.GetUniqueIdentifier(); exclusive = true;
            } else {
                exchange = "unknown." + NoderedUtil.GetUniqueIdentifier(); exclusive = true;
            }
        }
        let exchangequeue: amqpexchange = null;
        try {
            const AssertExchangeOptions: any = Object.assign({}, (amqpwrapper.Instance().AssertExchangeOptions));
            AssertExchangeOptions.exclusive = exclusive;
            exchangequeue = await amqpwrapper.Instance().AddExchangeConsumer(user, exchange, algorithm, routingkey, AssertExchangeOptions, this.jwt, addqueue, async (msg: any, options: QueueMessageOptions, ack: any, done: any) => {
                let span: Span
                const _data = msg;
                try {
                    span = Logger.otel.startSpan("WebSocketServerClient.RegisterExchange", msg.traceId, msg.spanId);
                    const result = await this.Queue(msg, exchange, options, span);
                    done(result);
                    ack();
                } catch (error) {
                    setTimeout(() => {
                        ack(false);
                        Logger.instanse.error(exchange + " failed message queue message, nack and re queue message: ", span, Logger.parsecli(this as any));
                        Logger.instanse.error(error, span, Logger.parsecli(this as any));
                    }, Config.amqp_requeue_time);
                } finally {
                    span?.end()
                }
            }, span);
            if (exchangequeue) {
                await semaphore.down();
                if (exchangequeue.queue) exchange = exchangequeue.queue.queue;
                this._exchanges.push(exchangequeue);
                if (exchangequeue.queue) {
                    this._queues.push(exchangequeue.queue);
                    this._queuescounter++;
                    this._queuescurrent++;
                }
                this._queuescounterstr = this._queuescounter.toString();
                this._queuescurrentstr = this._queuescurrent.toString();
            }
        } catch (error) {
            Logger.instanse.error(error, span, Logger.parsecli(this as any));
        }
        if (exchangequeue) semaphore.up();
        if (exchangequeue != null) return { exchangename: exchangequeue.exchange, queuename: exchangequeue.queue?.queue };
        return null;
    } finally {
        Logger.otel.endSpan(span);
    }
  }
  public async CloseConsumer(user: TokenUser | User, queuename: string, parent: Span): Promise<void> {
    const span: Span = Logger.otel.startSubSpan("WebSocketServerClient.CloseConsumer", parent);
    await semaphore.down();
    try {
        for (let i = this._queues.length - 1; i >= 0; i--) {
            const q = this._queues[i];
            if (q && (q.queue == queuename || q.queuename == queuename)) {
                try {
                    amqpwrapper.Instance().RemoveQueueConsumer(user, this._queues[i], span).catch((err) => {
                        Logger.instanse.error(err, span, Logger.parsecli(this as any));
                    });
                    this._queues.splice(i, 1);
                    this._queuescurrent--;
                    this._queuescurrentstr = this._queuescurrent.toString();
                } catch (error) {
                    Logger.instanse.error(error, span, Logger.parsecli(this as any));
                }
            }
        }
        for (let i = this._exchanges.length - 1; i >= 0; i--) {
            const e = this._exchanges[i];
            if (e && (e.queue != null && e.queue.queue == queuename || e.queue.queuename == queuename)) {
                try {
                    amqpwrapper.Instance().RemoveQueueConsumer(user, this._exchanges[i].queue, span).catch((err) => {
                        Logger.instanse.error(err, span, Logger.parsecli(this as any));
                    });
                    this._exchanges.splice(i, 1);
                } catch (error) {
                    Logger.instanse.error(error, span, Logger.parsecli(this as any));
                }
            }
        }
    } finally {
        semaphore.up();
        Logger.otel.endSpan(span);
        console.log(this.id + " has " + this._queues.length + " queues")
    }
  }
  public async CloseConsumers(parent: Span): Promise<void> {
    await semaphore.down();
    for (let i = this._queues.length - 1; i >= 0; i--) {
        try {
            // await this.CloseConsumer(this._queues[i]);
            await amqpwrapper.Instance().RemoveQueueConsumer(this.user, this._queues[i], parent);
            this._queues.splice(i, 1);
            this._queuescurrent--;
            this._queuescurrentstr = this._queuescurrent.toString();
        } catch (error) {
            Logger.instanse.error(error, parent, Logger.parsecli(this as any));
        }
    }
    for (let i = this._exchanges.length - 1; i >= 0; i--) {
        const e = this._exchanges[i];
        if (e && e.queue != null) {
            try {
                await amqpwrapper.Instance().RemoveQueueConsumer(this.user, this._exchanges[i].queue, parent);
                this._exchanges.splice(i, 1);
            } catch (error) {
                Logger.instanse.error(error, parent, Logger.parsecli(this as any));
            }
        }
    }
    semaphore.up();
  }
  async Queue(data: string, queuename: string, options: QueueMessageOptions, span: Span): Promise<void> {
    try {
      var q: any= {};
      q.data = data;
      if(typeof data !== "string") q.data = JSON.stringify(data);
      if (NoderedUtil.IsNullEmpty(q.correlationId)) { q.correlationId = NoderedUtil.GetUniqueIdentifier(); }
      q.replyto = options.replyTo;
      q.correlationId = options.correlationId; q.queuename = queuename;
      q.consumerTag = options.consumerTag;
      q.routingkey = options.routingKey;
      q.exchangename = options.exchangename;
  
      var paylad = {"command": "queueevent",
      "data": QueueEvent.encode(QueueEvent.create(q)).finish()}
      // var result = await protowrap.RPC(this, paylad);
      protowrap._RPC(this, paylad);
    } catch (error) {
      err(error);      
    }
  }
  Close() {
    if (this.queuecount() > 0) {
      this.CloseConsumers(undefined);
    }
    if (this.ws != null) this.ws.close();
    if (this.stream != null) this.stream.destroy();
    if (this.call != null) {
        // this.call.cancel();
        // this.call.write(null)
        this.call.push(null)
    }
    if (this.grpcStream != null) {
        // this.grpcStream.cancel();
        this.call.push(null)
    }
    info("close " + this.id + " " + this.protocol + " " + this.remoteip + " " + this.agent);
    this.connected = false;
    this.connecting = false;
    // this.onDisconnected(this, null);
  }
}
export class changestream {
  // public stream: ChangeStream;
  public stream: any;
  public id: string;
  public callback: any;
  aggregates: object[];
  collectionname: string;
}
export function remoteip(req: express.Request) {
  if (req == null) return "unknown";
  let remoteip: string = req.socket.remoteAddress;
  if (req.headers["X-Forwarded-For"] != null) remoteip = req.headers["X-Forwarded-For"] as string;
  if (req.headers["X-real-IP"] != null) remoteip = req.headers["X-real-IP"] as string;
  if (req.headers["x-forwarded-for"] != null) remoteip = req.headers["x-forwarded-for"] as string;
  if (req.headers["x-real-ip"] != null) remoteip = req.headers["x-real-ip"] as string;
  return remoteip;
}
