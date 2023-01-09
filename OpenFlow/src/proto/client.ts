import express = require("express");
import * as  net from "net";
import * as  grpc from "@grpc/grpc-js";
import * as  WebSocket from "ws";
import { protowrap } from "./protowrap"
import { err, warn, info, DoPing } from "./config";
export type clientType = "socket" | "pipe" | "ws" | "grpc" | "rest";
export type clientAgent = "node" | "browser" | "nodered" | "openrpa";
export class client {
  public id: string = "";
  public seq: number = 0;
  public remoteip: string = "unknown";
  public agent: clientAgent;
  public protocol: clientType;
  public version: string;
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
  public port: number = 0;
  public ws: WebSocket;
  public stream: net.Socket;
  public grpc: any;
  public call: any;
  public SendStreamCall: grpc.ClientDuplexStream<any, any>;
  public ReceiveStreamCall: grpc.ClientDuplexStream<any, any>;
  public replies: any;
  public streams: any;

  async Initialize(ws: WebSocket, stream: net.Socket, call, req: express.Request): Promise<boolean> {
    try {
      this.replies = {};
      this.streams = {};
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
    const [command, msg, reply] = protowrap.unpack(message);
    if (command == "ping") {
      reply.command = "pong";
    }
    return reply;
  }
  ping(span: any) {
    if(DoPing)  {
      protowrap.sendMesssag(this, {"command": "ping"}, null, true);
    } else {
      this.lastheartbeat = new Date();
      this.lastheartbeatstr = this.lastheartbeat.toISOString();
      this.lastheartbeatsec = (this.lastheartbeat.getTime() / 1000).toString();
      }
  }
  queuecount() {
    return this.queues.length;
  }
  Close() {
    if (this.ws != null) this.ws.close();
    if (this.stream != null) this.stream.destroy();
    if (this.call != null) this.call.cancel();
    if (this.SendStreamCall != null) this.SendStreamCall.cancel();
    if (this.ReceiveStreamCall != null) this.ReceiveStreamCall.cancel();
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
