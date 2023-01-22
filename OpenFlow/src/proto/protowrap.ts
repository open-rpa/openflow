import * as config from "./config";
const { err, warn, info, dumpmessage, dumpdata } = config;

import { messageParser } from "./message-parser";
// import { messageParser } from "./message-parser.buffer.concat";

import * as  stream from "stream";
import * as  express from "express";
import * as  protobuf from "protobufjs";
import * as  https from "https";
import * as  http from "http";
import * as  grpc from "@grpc/grpc-js";
import * as  protoLoader from "@grpc/proto-loader";
import * as  net from "net";
import * as  fs from "fs";
import * as  path from "path";
import * as  WebSocket from "ws";
import * as  crypto from "crypto";
import { Throttler } from "./Throttler";
import { client, clientType } from "./client";
// const PROTO_PATH = "awesome.proto"

export class protowrap {
  static defaultprotocol: clientType = "pipe" // pipe, socket, ws, grpc, rest
  static packageDefinition: protoLoader.PackageDefinition;
  static openiap_proto: grpc.GrpcObject | grpc.ServiceClientConstructor | grpc.ProtobufTypeDefinition;
  static Envelope: any; // = new protobuf.Type("envelope");
  static protoRoot: any;
  static async init() {
    var paths = [];
    paths.push(path.join(__dirname, "messages/base.proto"));
    paths.push(path.join(__dirname, "messages/ace.proto"));
    paths.push(path.join(__dirname, "messages/querys.proto"));
    paths.push(path.join(__dirname, "messages/queues.proto"));
    paths.push(path.join(__dirname, "messages/watch.proto"));
    paths.push(path.join(__dirname, "messages/workitems.proto"));

    this.packageDefinition = await protoLoader.load(
      paths,
      {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true
      });
    this.openiap_proto = grpc.loadPackageDefinition(this.packageDefinition).openiap;
    this.protoRoot = await protobuf.load(paths);
    this.Envelope = this.protoRoot.lookupType("openiap.envelope");
  }
  static RPC(client: client, payload:any) {
    const [id, promise] = this._RPC(client, payload);
    return promise;
  }
  static _RPC(client:client, payload:any): [string, Promise<any>] {
    const id = Math.random().toString(36).substring(2, 11);
    // const id = client.seq.toString();
    const promise = new Promise<any>((resolve, reject) => {
      const dt = new Date();
      const command = payload.command;
      var _payload = { ...payload };
      delete _payload.id;
      client.replies[id] = { resolve, reject, dt, command };
      this.sendMesssag(client, { id, ..._payload }, id, true);
    });
    return [id, promise];
  }
  static SetStream(client: client, stream, rid:string) {
    client.streams[rid] = { stream, chunks: 0, bytes: 0 };
    return client.streams[rid];
  }
  static CreateStream(client:client, stream, payload) {
    // const id = Math.random().toString(36).substring(2, 11);
    const id = client.seq.toString();
    return new Promise((resolve, reject) => {
      const dt = new Date();
      const command = payload.command;
      var _payload = { ...payload };
      _payload.id = id;
      client.streams[id] = { stream, chunks: 0, bytes: 0 };
      client.replies[id] = { resolve, reject, dt, command };
      this.sendMesssag(client, _payload, id, true);
    });
  }
  static DownloadFile(client:client, filename, destination, highWaterMark) {
    return new Promise<any>(async (resolve, reject) => {
      var name = destination;
      if (!name || name == "") name = path.basename(filename);
      if (fs.existsSync(name)) fs.unlinkSync(name);
  
      const ws = fs.createWriteStream(name, { highWaterMark });
      const startTime = new Date().getTime();
      const [rid, promise] = this._RPC(client, { command: "download", data: this.pack("download", {filename})  });
      promise.catch((err) => {
        reject(err);
      });
      const s = this.SetStream(client, ws, rid);
      // if(config.ThrottlerMS > 0) {
      //   rs.pipe(new Throttler(config.ThrottlerMS)).pipe(ws);
      // } else {
      //   rs.pipe(ws);
      // }
      ws.on("finish", async () => {
        ws.end();
        if (s.checksum) {
          const checksum = await this.getFileChecksum(name);
          if (checksum != s.checksum) {
            return reject(new Error("File checksum mismatch"));
          }
        } else if (config.ChecksumCheckFiles) {
          warn("No checksum for file available");
        }
        var test = await promise;
        s.bytes = ws.bytesWritten;
        s.bytesWritten = ws.bytesWritten;
        s.mb = ws.bytesWritten / (1024 * 1024);
        s.elapsedTime = new Date().getTime() - startTime;
        s.mbps = s.mb / (s.elapsedTime / 1000)
        resolve(s);
      });
      ws.on("error", (err) => {
        reject(err);
      });
      // rs.on("error", (err) => {
      //   reject(err);
      // });
    });
  }
  static sendFileContent(client:client, rid, filename, highWaterMark) {
    return new Promise(async (resolve, reject) => {
      var chunks = 0;
      var bytes = 0;
      var name = path.basename(filename);
      var stat = fs.statSync(filename);
      var checksum: string = "";
      if (config.ChecksumCheckFiles) {
        checksum = await this.getFileChecksum(filename);
      }
      var readStream = fs.createReadStream(filename, { highWaterMark })
      this.sendMesssag(client, { rid, command: "beginstream", data: this.pack("beginstream", {checksum, stat}) }, null, true);
      await new Promise((resolve) => setTimeout(resolve, config.BeginstreamDelay));
      readStream.on("open", () => {
      });
      readStream.on("end", () => {
        setTimeout(() => {
          try {
            this.sendMesssag(client, { rid, command: "endstream", data: undefined }, null, true);
            var mb = bytes / (1024 * 1024);
            resolve({ rid, chunks, bytes, mb });
          } catch (error) {
            try {
              reject(error);
            } catch (error) {
              err(error);
            }
  
          }
        }, config.EndstreamDelay);
      });
      readStream.on("error", (error) => {
        reject(error);
      });
      if (config.ThrottlerMS > 0) {
        readStream.pipe(new Throttler(config.ThrottlerMS)).on("data", (chunk) => {
          chunks++;
          bytes += chunk.length;
          this.sendMesssag(client, { rid, command: "stream", data: this.pack("stream", {data: chunk}) }, null, true);
        });
      } else {
        readStream.on("data", (chunk) => {
          if (client.connected) {
            chunks++;
            bytes += chunk.length;
            this.sendMesssag(client, { rid, command: "stream", data: this.pack("stream", {data: chunk}) }, null, true);
          }
        });
      }
    });
  }
  static UploadFile(client:client, filename:string) {
    // Send upload command, server will respond, once upload is complete
    const [rid, promise] = this._RPC(client, { command: "upload", data: this.pack("upload", {filename}) });
    // send file content using the ID used for upload command
    var promise2 = this.sendFileContent(client, rid, filename, config.SendFileHighWaterMark);
    // catch errors doing streaming file content
    promise2.catch((e) => {
      // doing checksum error, we get disconnected, but we still get the error on the main promise
      if (e && e.message && e.message == "client is not connected") {
      } else {
        err(e);
      }
      // promise.reject(err);
    });
    // return main promise
    return promise;
  }
  static ReceiveFileContent(client: client, rid:string, filename:string, highWaterMark: number) {
    return new Promise(async (resolve, reject) => {
      const startTime = new Date().getTime();
      const rs = new stream.Readable;
      rs._read = () => { };
      var ws = fs.createWriteStream(filename, { highWaterMark });
      const s = this.SetStream(client, rs, rid)
      ws.on("finish", async () => {
        var mb = ws.bytesWritten / (1024 * 1024);
        var bytes = ws.bytesWritten;
        var chunks = s.chunks;
        const elapsedTime = new Date().getTime() - startTime;
        const mbps = mb / (elapsedTime / 1000)
        if (s.checksum) {
          const checksum = await this.getFileChecksum(filename);
          if (checksum != s.checksum) {
            return reject(new Error("File checksum mismatch"));
          }
        } else if (config.ChecksumCheckFiles) {
          warn("No checksum for file available");
        }
        resolve({ rid, chunks, bytes, mb, elapsedTime, mbps });
      });
      ws.on("error", (err) => {
        reject(err);
      });
      rs.on("error", (err) => {
        reject(err);
      });
      rs.pipe(ws);
    });
  }
  static IsPendingReply(client: client, payload: any) {
    try {
      const [ command, msg, reply ] = this.unpack(payload);
      const rid = payload.rid;
      dumpmessage("RCV", payload);
      if (rid == null || rid == "") return false;
      if (client.replies[rid] && command != "beginstream" && command != "stream" && command != "endstream") {
        const { resolve, reject, dt } = client.replies[rid];
        if (resolve) {
          try {
            if (command == "error") {
              var er = new Error(msg.message);
              var error = new ServerError(msg.message, msg.stack);
              reject(error);
            } else {
              resolve(payload);
            }
          } catch (error) {
            err(error);
            return reject(error);
          }
        }
        delete client.replies[rid];
      } else if (client.streams[rid]) {
        const { command } = payload;
        if (command == "error") {
          const s = client.streams[rid].stream;
          s.emit("error", new Error(payload.data.toString()));
        } else if (command == "stream") {
          const s = client.streams[rid].stream;
          if (s.push) {
            s.push(msg.data)
          } else {
            s.write(msg.data)
          }
          client.streams[rid].chunks++;
          s.bytes += payload.data.length;
        } else if (command == "beginstream") {
          client.streams[rid].stat  =  {}
          if(msg.stat) client.streams[rid].stat = msg.stat;
          if(msg.checksum) client.streams[rid].checksum = msg.checksum;
        } else if (command == "endstream") {
          const s = client.streams[rid].stream;
          if (s.push) {
            client.streams[rid].stream.push(null);
          } else {
            client.streams[rid].stream.end();
          }
          // streams[rid].stream.emit("finish");
          // streams[rid].stream.end();
          // streams[rid].stream.emit("end");
          // streams[rid].stream.destroy();
          // info("Stream ended for rid: " + rid + " chunks: " + streams[rid].chunks + " bytes: " + streams[rid].bytes);
          delete client.streams[rid];
        }
      } else {
        return false;
      }
      return true;
    } catch (error) {
      return false;
    }
  }
  static get(url) {
    return new Promise((resolve, reject) => {
      var provider = http;
      if (url.startsWith("https")) {
        // @ts-ignore
        provider = https;
      }
      provider.get(url, (resp) => {
        let data = "";
        resp.on("data", (chunk) => {
          data += chunk;
        });
        resp.on("end", () => {
          resolve(data);
        });
      }).on("error", (err) => {
        reject(err);
      });
    })
  }
  static post(jwt, agent, url, body) {
    return new Promise((resolve, reject) => {
      try {
        var provider = http;
        var u = new URL(url);
        var options = {
          rejectUnauthorized: false,
          agent: agent,
          hostname: u.hostname,
          port: u.port,
          path: u.pathname,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body)
          }
        };
        if(jwt != null && jwt != "") {
          options.headers["Authorization"] = "Bearer " + jwt;
        }
        if (url.startsWith("https")) {
          delete options.agent;
          // @ts-ignore
          provider = https;
        }
        var req = provider.request(url, options, (res) => {
          res.setEncoding("utf8");
          if(res.statusCode != 200) {
            return reject(new Error("HTTP Error: " + res.statusCode + " " + res.statusMessage));
          }
          var body = "";
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("end", () => {
            var r = res;
            resolve(body);
          });
        }
        );
        req.write(body);
        req.end();
    
      } catch (error) {
        reject(error);
      }
    })
  }
  static sendMesssag(client:client, payload: any, id: string, dumpmsg:boolean): number {
    var errMsg = this.Envelope.verify(payload);
    if (errMsg) throw new Error(errMsg);
    payload.seq = client.seq;
    if(id != null && id != "") {
      payload.id = id;
    } else {
      if(client.seq != null) {
        // payload.id = client.seq.toString();
        payload.id = Math.random().toString(36).substring(2, 11);
      } else {
        payload.id = Math.random().toString(36).substring(2, 11);
      }
    }
    if(client.seq != null) { client.seq++; }
    // messages.push(payload);
    // if (!payload.id || payload.id == "") payload.id = Math.random().toString(36).substring(2, 11);
    if (payload.data && config.ChecksumCheckPackages) payload.hash = this.getChecksum(payload.data);
    if (dumpmsg) {
      dumpmessage("SND", payload);
    }
  
    if (client.protocol == "grpc") {
      if (client.grpcStream) {
          client.grpcStream.write(payload);
      } else {
        throw new Error("client is not a grpc client");
      }
      return payload.seq;
    }
    if (client.protocol == "rest") {
      if (config.role() == "client") {
        this.post(client.jwt, client.agent, client.url, JSON.stringify(payload)).then((data:any) => {
          var payload = JSON.parse(data);
          if (payload && payload.data && payload.data.type && payload.data.type.toLowerCase() == "buffer") {
            payload.data = Buffer.from(payload.data.data);
          }
          this.IsPendingReply(client, payload);
        }).catch((error) => {
          err(error);
        });
      } else {
        // how to handle this ?
      }
      return payload.seq;
    }
    var message = this.Envelope.create(payload);
    var buffer = this.Envelope.encode(message).finish();
    var lengthbuffer = Buffer.alloc(4);
    lengthbuffer.writeUInt32LE(buffer.length, 0); // writeUInt32LE writeUInt32BE
    if (client.protocol == "ws") {
      if (!client.ws) throw new Error("client is not a websocket client");
      client.ws.send(lengthbuffer);
      client.ws.send(buffer);
      return payload.seq;
    }
    var r = config.role();
    if (config.role() == "server") {
      dumpdata(buffer);
    }
    if (client.protocol == "socket" || client.protocol == "pipe") {
      if (!client.connected) {
        throw new Error("client is not connected");
      } else if (!client.stream) {
        throw new Error("client is not a " + client.protocol + " client");
      }
      client.stream.write(lengthbuffer);
      client.stream.write(buffer);
      return payload.seq;
    }
    throw new Error("Unknown protocol");
  }
  static ClientCleanup(client:client, onClientDisconnected:any, error: Error | string) {
    // @ts-ignore
    if(client.cleanup == true) return;
    // @ts-ignore
    client.cleanup = true;
    try {
      var keys = Object.keys(client.replies);
      // if (!error) error = new Error("Client " + client.id + "disconnected");
      for (let i = 0; i < keys.length; i++) {
        var key = keys[i];
        var reply = client.replies[key];
        reply.reject(new Error("Client " + client.id + "disconnected"));
      }
      var keys = Object.keys(client.streams);
      // Errors should be handled by the stream itself using callback
      // for (let i = 0; i < keys.length; i++) {
      //   var key = keys[i];
      //   var stream = client.streams[key];
      //   if (error) {
      //     stream.stream.emit("error", error);
      //     stream.stream.destroy(error);
      //   }
      // }
      if (client.connected == true || client.connecting == true) {
        client.connected = false;
        client.connecting = false;
        // if(!error) error = "Client disconnected" 
        onClientDisconnected(client, error);
      }
    } catch (e) {
      err(e);
    }
    finally
    {
    }
  }
  static connect(apiurl:string) {
    config.setrole("client");
    const result:client = new client();
    const url = new URL(apiurl);
    result.protocol = "ws";
    result.url = apiurl;
    if(url.protocol == "http:" || url.protocol == "https:") {
      result.protocol = "rest";
    } else if(url.protocol == "grpc:" ) {
      result.protocol = "grpc";
    } else if(url.protocol == "socket:") {
      result.protocol = "socket";
    } else if(url.protocol == "pipe:") {
      result.protocol = "socket";
    }    
    result.connected = false; result.connecting = true; result.signedin = false;
    result.Initialize(null, null, null, null).catch((e) => { err(e); });
  
    // { protocol, port, connected: false, connecting: true, agent: null, id: "", host, onMessage, onClientConnected, onClientDisconnected, cleanup: false,
    //   SendStreamCall: null, ReceiveStreamCall: null, app: null, ws: null, client: {}, stream: null, counter: 0};
    result.id = Math.random().toString(36).substring(2, 11);
    if (url.protocol == "http:" || url.protocol == "https:") {
      // @ts-ignore
      result.agent = new http.Agent({
        keepAlive: true,
        maxSockets: 1
      });
      this.post(result.jwt, result.agent, apiurl, JSON.stringify({ "command": "noop" })).then((data: any) => {
        result.connected = true;
        result.connecting = false;
        result.onConnected(result);
        var payload = JSON.parse(data);
        if (payload && payload.data && payload.data.type && payload.data.type.toLowerCase() == "buffer") {
          payload.data = Buffer.from(payload.data.data);
        }
        // this.IsPendingReply(payload);
      }).catch((e) => {
        this.ClientCleanup(result, result.onDisconnected, e);
      });
      return result;
    } else if (url.protocol == "grpc:") {
      if(url.host.indexOf(":") == -1 && url.port) {
        // @ts-ignore
        result.grpc = new this.openiap_proto.grpcService(url.host + ":" + url.port, grpc.credentials.createInsecure());
      } else {
        // @ts-ignore
        result.grpc = new this.openiap_proto.grpcService(url.host, grpc.credentials.createInsecure());
      }

      result.grpcStream = result.grpc.SetupStream((error, response) => {
        info("ReceiveStreamCall, end ?");
      });
      result.grpcStream.on("status", (status) => {
        info(url.protocol + " client " + status.code + " " + status.details);
      });
      result.grpcStream.on("data", async (message) => {
        try {
          if (message != null) {
            if (!this.IsPendingReply(result, message)) {
              var _payload = await result.onMessage(result, message);
              if (_payload && _payload.command != "noop") this.sendMesssag(result, _payload, null, true);
            }
          }
        } catch (error) {
          err(error);
        }
      });

      result.grpcStream.on("end", () => {
        this.ClientCleanup(result, result.onDisconnected, undefined);
      });
      // @ts-ignore
      result.grpcStream.on("error", (e) => {
        this.ClientCleanup(result, result.onDisconnected, e);
      });
      setTimeout(()=> {
        result.connected = true;
        result.connecting = false;
        result.onConnected(result);
      },100)
      return result;
    } else if (url.protocol == "pipe:" || url.protocol == "socket:") {
      const netconnection = () => {
        result.connecting = false;
        result.connected = true;
        result.onConnected(result);
        // @ts-ignore
        result.stream.pipe(parser).on("data", async (message) => {
          try {
            if (message != null) {
              if (!this.IsPendingReply(result, message)) {
                var _payload = await result.onMessage(result, message);
                if (_payload && _payload.command != "noop") this.sendMesssag(result, _payload, null, true);
              }
            }
          } catch (error) {
            err(error);
          }
        });
      };
      var PIPE_PATH = "\\\\" + url.host + "\\pipe\\" + url.pathname.substring(1);
      // is running on linux
      if(process.platform == "linux") {
        PIPE_PATH = "/tmp/CoreFxPipe_" + url.pathname.substring(1);
      }      
      if (url.protocol == "socket:") {
        PIPE_PATH = url.host + ":" + url.port;
        if(url.port && url.host) {
          result.stream = net.createConnection(url.port as any,url.host, netconnection);
        } if(url.port || url.host) {
          result.stream = net.createConnection(url.port || url.host, netconnection);
        }
      } else {
        result.stream = net.createConnection(PIPE_PATH, netconnection);
      }
      var parser = new messageParser();
      parser.Envelope = this.Envelope;
      parser.on("error", (e) => {
        this.ClientCleanup(result, result.onDisconnected, e);
        result.stream.end();
      });
      result.stream.on("error", (e) => {
        this.ClientCleanup(result, result.onDisconnected, e);
        result.stream.end();
      });
      result.stream.on("end", () => {
        this.ClientCleanup(result, result.onDisconnected, undefined);
      });
      return result;
    } else if (url.protocol == "ws:" || url.protocol == "wss:") {
      result.ws = new WebSocket(apiurl,{rejectUnauthorized:false});
      result.ws.on("open", () => {
        result.connecting = false;
        result.connected = true;
        result.onConnected(result);
      }
      );
      var parser = new messageParser();
      parser.Envelope = this.Envelope;
      // @ts-ignore
      result.ws.on("message", (message) => {
        parser.write(message);
      });
      parser.on("data", async (message) => {
        try {
          if (message != null) {
            if (!this.IsPendingReply(result, message)) {
              var _payload = await result.onMessage(result, message);
              if (_payload && _payload.command != "noop") this.sendMesssag(result, _payload, null, true);
            }
          }
        } catch (error) {
          err(error);
        }
      });
      parser.on("error", (e) => {
        this.ClientCleanup(result, result.onDisconnected, e);
        result.ws.close();
      });
      result.ws.on("error", (e) => {
        this.ClientCleanup(result, result.onDisconnected, e);
      });
      result.ws.on("close", () => {
        this.ClientCleanup(result, result.onDisconnected, undefined);
        // @ts-ignore
        result.ws.close();
      }
      );
      return result;
    } else {
      throw new Error("protocol not supported " + url.protocol);
    }
  }
  static serve(protocol: clientType, onClientConnected, port, path, wss, app, http) {
    config.setrole("server");
    var result = { protocol, port, id: "", connected: false, connecting: false, client: null, ws: null, pending: {}, app, http, wss };
    result.id = Math.random().toString(36).substring(2, 11);
    if (protocol == "rest") {
      var listen = false;
      if (!app) {
        app = express();
        app.use(express.json())
        listen = true;
      }
      app.post(path, async (req, res, next) => {
        const id = Math.random().toString(36).substring(2, 11);
        var clientresult: client = new client();
        clientresult.id = id; clientresult.protocol = protocol;
        clientresult.connected = true; clientresult.connecting = false; clientresult.signedin = false;
        await clientresult.Initialize(null, null, null, req);
        onClientConnected(clientresult);
        // extract Bearer token from authorization header
        var token = req.headers.authorization;
        if (token && token.startsWith("Bearer ")) {
          token = token.slice(7, token.length);
          clientresult.jwt = token;
        }

        var payload = req.body;
        if (payload && payload.data && payload.data.type && payload.data.type.toLowerCase() == "buffer") {
          payload.data = Buffer.from(payload.data.data);
        }
        try {
          if (!this.IsPendingReply(clientresult, payload)) {
            var payload = await clientresult.onMessage(clientresult, payload);
            if (!payload.id || payload.id == "") payload.id = Math.random().toString(36).substring(2, 11);
            res.send(payload);
          } else {
            res.send("IsPendingReply took your payload");
          }
        } catch (error) {
          res.send(error);
          err(error);
        } finally {
          this.ClientCleanup(clientresult, clientresult.onDisconnected, undefined);
        }
        next();
      });
      if (listen) {
        if (http) {
          http.createServer(app);
        } else {
          app.listen(port,  () => {
            port = port || 80;
            result.port = port;
          });
        }
      }
      result.app = app;
      return result;
    } else if (protocol == "ws") {
      if(wss != null) {
        result.wss = wss;
      } else {
        var server = http;
        var p = port || 80;
        if (server) {
          p = undefined;
        } else {
          result.port = p;
        }
        result.wss = new WebSocket.WebSocketServer({ server, port: p });
      }
      result.wss.on("connection", async (ws, req) => {
        const url = require("url");
        const location = url.parse(req.url, true);
        if(location.pathname != path) return;
  
        const id = Math.random().toString(36).substring(2, 11);
        var clientresult: client = new client();
        clientresult.id = id; clientresult.protocol = protocol;
        clientresult.ws = ws; clientresult.connected = true; clientresult.connecting = false; clientresult.signedin = false;
        await clientresult.Initialize(ws, null, null, req);
        onClientConnected(clientresult);
        var parser = new messageParser();
        parser.Envelope = this.Envelope;
        ws.on("message", (message) => {
          parser.write(message);
        });
        parser.on("data", async (message) => {
          try {
            if (message != null) {
              if (!this.IsPendingReply(clientresult, message)) {
                var payload = await clientresult.onMessage(clientresult, message);
                if (payload && payload.command != "noop") this.sendMesssag(clientresult, payload, null, true);
              }
            }
          } catch (error) {
            err(error);
          }
        });
        parser.on("error", (e) => {
          this.ClientCleanup(clientresult, clientresult.onDisconnected, e);
          clientresult.ws.close();
        });
        ws.on("error",  (e) => {
          this.ClientCleanup(clientresult, clientresult.onDisconnected, e);
          clientresult.ws.close();
        });
        ws.on("close", () => {
          this.ClientCleanup(clientresult, clientresult.onDisconnected, undefined);
        });
      });
      return result;
    } else if (protocol == "grpc") {
      const SetupStream = async (call, respond, e3) => {
        info("New streaming grpc client connected");
        var clientresult: client = new client();
        clientresult.id = Math.random().toString(36).substring(2, 11);
        clientresult.protocol = protocol; clientresult.connected = true; 
        clientresult.connecting = false; clientresult.signedin = false;
        clientresult.grpcStream = call;
        await clientresult.Initialize(null, null, call, null);
        onClientConnected(clientresult);
        const pingtimer = setInterval(()=> {
          var c = call;
          var that = this;
          if(c.cancelled) {
            clearInterval(pingtimer);
            this.ClientCleanup(clientresult, clientresult.onDisconnected, undefined);
          }
        }, 1000);
        call.on("data", async (payload) => {
          try {
            if (!this.IsPendingReply(clientresult, payload)) {
              var _payload = await clientresult.onMessage(clientresult, payload)
              if (_payload && _payload.command != "noop") this.sendMesssag(clientresult, _payload, null, true);
            }
          } catch (error) {
            try {
              this.sendMesssag(clientresult, error, null, true);
            } catch (error) {

            }
            err(error);
          }
        });
        call.on("end", () => {
          var c = call;
          var that = this;
          console.log("end");
          if(c.cancelled) {
            clearInterval(pingtimer);
            this.ClientCleanup(clientresult, clientresult.onDisconnected, undefined);
          }
          // 
        });
        call.on("error", (e) => {
          this.ClientCleanup(clientresult, clientresult.onDisconnected, e);
        });
        call.on("status", (status) => {
          info(protocol + " client " + status.code + " " + status.details);
        });

        return call;
      };
      const Signin = async (call, callback) => {
        try {
          var payload = {"jwt": "JWTsecretTOKEN",
          user: { name: call.request.username, username: call.request.username, _id: "1", email:"wefew", roles: [] }}
          callback(null, payload);
        } catch (error) {
          err(error);
          callback(error, null);
        }
      }

      // @ts-ignore
      result.server = new grpc.Server();
      // @ts-ignore
      // result.server.addService(this.openiap_proto.grpcService.service, { RPC, ReceiveStream, SendStream });
      result.server.addService(this.openiap_proto.grpcService.service, { SetupStream, Signin });
      // @ts-ignore
      result.server.bindAsync("0.0.0.0:" + port, grpc.ServerCredentials.createInsecure(), () => {
        // @ts-ignore
        result.server.start();
      });
      return result;
    } else if (protocol == "pipe" || protocol == "socket") {
      var PIPE_PATH = "\\\\.\\pipe\\" + path;
      // if not runnong on windows
      if(process.platform != "win32") {
        PIPE_PATH = "/tmp/CoreFxPipe_" + path;
      }
      if (protocol == "socket") {
        PIPE_PATH = port || 80;
        result.port = PIPE_PATH;
      }
  
      try {
        if (fs.existsSync(PIPE_PATH)) {
          info("unlinking existing pipe " + PIPE_PATH);
          fs.unlinkSync(PIPE_PATH);
        }
      } catch (error) {
        err(error);
      }
      // @ts-ignore
      result.server = net.createServer(async (stream) => {
        const id = Math.random().toString(36).substring(2, 11);
        var clientresult: client = new client();
        clientresult.id = id; clientresult.protocol = protocol;
        clientresult.connected = true; clientresult.connecting = false; clientresult.signedin = false;
        await clientresult.Initialize(null, stream, null, null);
        onClientConnected(clientresult);
        var parser = new messageParser();
        parser.Envelope = this.Envelope;
        stream.pipe(parser).on("data", async (message) => {
          if (!clientresult.connected) return;
          if (!this.IsPendingReply(clientresult, message)) {
            try {
              var payload = await clientresult.onMessage(clientresult, message)
              if (payload && payload.command != "noop") this.sendMesssag(clientresult, payload, null, true);
            } catch (error) {
              err(error);
            }
          }
        });
        stream.on("error",  (e)=> {
          this.ClientCleanup(clientresult, clientresult.onDisconnected, e);
          clientresult.stream.end();
        });
        parser.on("error", (e) => {
          this.ClientCleanup(clientresult, clientresult.onDisconnected, e);
          clientresult.stream.end();
        });
        stream.on("end", () => {
          this.ClientCleanup(clientresult, clientresult.onDisconnected, undefined);
        });
      });
      // @ts-ignore
      result.server.on("error", (e) => {
        // ClientCleanup(clientresult, onClientDisconnected, e);
        // clientresult.stream.end();
      });
      // @ts-ignore
      result.server.listen(PIPE_PATH,  () => {
      })
      return result;
    } else {
      throw new Error("Not supported protocol " + protocol);
    }
  }
  static getFileChecksum(filePath) {
    return new Promise<string>((resolve, reject) => {
      const hash = crypto.createHash("sha256"); // sha256, md5
      const stream = fs.createReadStream(filePath);
      stream.on("data", data => {
        hash.update(data);
      });
      stream.on("end", () => {
        const checksum = hash.digest("hex");
        resolve(checksum);
      });
      stream.on("error", error => {
        reject(error);
      });
    });
  }
  static getChecksum(buffer) {
    const hash = crypto.createHash("sha256");
    hash.update(buffer);
    const checksum = hash.digest("hex");
    return checksum;
  }
  static pack(command:string, message: any) {
    const protomsg = this.protoRoot.lookupType("openiap." + command);
    return {"type_url": "openiap." + command, "value": protomsg.encode(message).finish() }
  }
  static unpack(message: any) {
    const { command, data } = message;
    const rid = message.id;
    let msg = data;
    if(command != null) {
      const protomsg = this.protoRoot.lookupType("openiap." + command);
      if(typeof data == "string") {
        msg = JSON.parse(data);
      } else if ( data != null) {
        try {
          if(data.type_url != null) {
            msg = protomsg.decode(data.value)
          } else {
            msg = protomsg.decode(data)
          }
          
        } catch (error) {
          msg = data.toString();
          if(msg.startsWith("{")) msg = JSON.parse(msg);
        }    
      }
    }
    const reply = { command, rid, data: null };
    return [command, msg, reply];
  }
}
export class ServerError extends Error {
  constructor(message, stack) {
    super(message);
    this.message = message;
    this.name = "ServerError";
    this.stack = stack;
  }
}
