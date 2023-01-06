const config = require('./config');
const { err, warn, info, dumpmessage, dumpdata } = config;

const messageParser = require('./message-parser');
// const messageParser = require('./message-parser.buffer.concat');

const stream = require('stream');
const express = require('express');
const protobuf = require("protobufjs");
const https = require('https');
const http = require('http');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const net = require('net');
import * as fs from "fs";
import { WebSocketServer } from "../WebSocketServer";
import { WebSocketServerClient } from "../WebSocketServerClient";
const path = require('path');
const WebSocket = require("ws");
// const WebSocketServer = WebSocket.WebSocketServer;
const crypto = require('crypto');
const Throttler = require('./Throttler');
// const PROTO_PATH = "awesome.proto"
const PROTO_PATH = "/home/allan/code/openflow/OpenFlow/src/Messages/base.proto"

var packageDefinition = protoLoader.loadSync(
  PROTO_PATH,
  {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
  });
// var hello_proto = grpc.loadPackageDefinition(packageDefinition).awesomepackage;
var hello_proto = grpc.loadPackageDefinition(packageDefinition).openiap;


// // const Root = protobuf.Root;
// const Type = protobuf.Type;
// const Field = protobuf.Field;
// // number, Long, number, boolean, string, bytes, enum, message
// var Envelope = new Type("Envelope")
//   .add(new Field("command", 1, "string"))
//   .add(new Field("seq", 2, "int32"))
//   .add(new Field("hash", 3, "string"))
//   .add(new Field("id", 4, "string"))
//   .add(new Field("rid", 5, "string"))
//   .add(new Field("data", 6, "bytes"))
var Envelope; // = new protobuf.Type("Envelope");
var protoRoot;
async function init() {
  // var root = new Root().define("openiap").add(Envelope);
  protoRoot = await protobuf.load(PROTO_PATH)
  Envelope = protoRoot.lookupType("openiap.Envelope");
}
function getProtoRoot() {
  return protoRoot;
}

const replies = {};
function RPC(client, payload) {
  const [id, promise] = _RPC(client, payload);
  return promise;
}
function _RPC(client, payload) {
  // const id = Math.random().toString(36).substring(2, 11);
  if (!client.counter && client.counter != 0) {
    client.counter = 0;
  }
  const id = client.counter.toString();
  const promise = new Promise((resolve, reject) => {
    const dt = new Date();
    const command = payload.command;
    var _payload = { ...payload };
    delete _payload.id;
    replies[id] = { resolve, reject, dt, command };
    sendMesssag(client, { id, ..._payload });
  });
  return [id, promise];
}

function SetStream(stream, rid) {
  streams[rid] = { stream, chunks: 0, bytes: 0 };
  return streams[rid];
}
function CreateStream(stream, client, payload) {
  // const id = Math.random().toString(36).substring(2, 11);
  if (!client.counter && client.counter != 0) {
    client.counter = 0;
  }
  const id = client.counter.toString();
  return new Promise((resolve, reject) => {
    const dt = new Date();
    const command = payload.command;
    var _payload = { ...payload };
    _payload.id = id;
    streams[id] = { stream, chunks: 0, bytes: 0 };
    replies[id] = { resolve, reject, dt, command };
    sendMesssag(client, _payload);
  });
}
// https://stackoverflow.com/questions/18932488/how-to-use-drain-event-of-stream-writable-in-node-js
function DownloadFile(client, filename, destination, highWaterMark) {
  return new Promise(async (resolve, reject) => {
    var name = destination;
    if (!name || name == "") name = path.basename(filename);
    if (fs.existsSync(name)) fs.unlinkSync(name);

    const ws = fs.createWriteStream(name, { highWaterMark });
    const startTime = new Date().getTime();
    const [rid, promise] = _RPC(client, { command: "Download", data: pack("Download", {filename})  });
    promise.catch((err) => {
      reject(err);
    });
    SetStream(ws, rid);
    const s = streams[rid]
    // if(config.ThrottlerMS > 0) {
    //   rs.pipe(new Throttler(config.ThrottlerMS)).pipe(ws);
    // } else {
    //   rs.pipe(ws);
    // }
    ws.on('finish', async () => {
      ws.end();
      if (s.checksum) {
        const checksum = await getFileChecksum(name);
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
    ws.on('error', (err) => {
      reject(err);
    });
    // rs.on('error', (err) => {
    //   reject(err);
    // });
  });
}
function sendFileContent(client, rid, filename, highWaterMark) {
  return new Promise(async (resolve, reject) => {
    var chunks = 0;
    var bytes = 0;
    var name = path.basename(filename);
    var stat = fs.statSync(filename);
    var checksum = undefined;
    if (config.ChecksumCheckFiles) {
      checksum = await getFileChecksum(filename);
    }
    var readStream = fs.createReadStream(filename, { highWaterMark })
    sendMesssag(client, { rid, command: "beginstream", data: pack("beginstream", {checksum, stat}) });
    await new Promise((resolve) => setTimeout(resolve, config.BeginstreamDelay));
    readStream.on('open', function () {
    });
    readStream.on('end', function () {
      setTimeout(() => {
        try {
          sendMesssag(client, { rid, command: "endstream", data: undefined });
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
    readStream.on('error', function (error) {
      reject(error);
    });
    if (config.ThrottlerMS > 0) {
      readStream.pipe(new Throttler(config.ThrottlerMS)).on('data', function (chunk) {
        chunks++;
        bytes += chunk.length;
        sendMesssag(client, { rid, command: "stream", data: pack("stream", {data: chunk}) });
      });
    } else {
      readStream.on('data', function (chunk) {
        if (client.connected) {
          chunks++;
          bytes += chunk.length;
          sendMesssag(client, { rid, command: "stream", data: pack("stream", {data: chunk}) });
        }
      });
    }
  });
}
async function UploadFile(client, filename) {
  // Send upload command, server will respond, once upload is complete
  const [rid, promise] = _RPC(client, { command: "Upload", data: pack("Upload", {filename}) });
  // send file content using the ID used for upload command
  var promise2 = sendFileContent(client, rid, filename, config.SendFileHighWaterMark);
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
function ReceiveFileContent(rid, filename, highWaterMark) {
  return new Promise(async (resolve, reject) => {
    const startTime = new Date().getTime();
    const rs = new stream.Readable;
    rs._read = function () { };
    var ws = fs.createWriteStream(filename, { highWaterMark });
    const s = SetStream(rs, rid)
    ws.on('finish', async function () {
      var mb = ws.bytesWritten / (1024 * 1024);
      var bytes = ws.bytesWritten;
      var chunks = s.chunks;
      const elapsedTime = new Date().getTime() - startTime;
      const mbps = mb / (elapsedTime / 1000)
      if (s.checksum) {
        const checksum = await getFileChecksum(filename);
        if (checksum != s.checksum) {
          return reject(new Error("File checksum mismatch"));
        }
      } else if (config.ChecksumCheckFiles) {
        warn("No checksum for file available");
      }
      resolve({ rid, chunks, bytes, mb, elapsedTime, mbps });
    });
    ws.on('error', (err) => {
      reject(err);
    });
    rs.on('error', (err) => {
      reject(err);
    });
    rs.pipe(ws);
  });
}
var streams = {};
class ServerError extends Error {
  constructor(message, stack) {
    super(message);
    this.message = message;
    this.name = 'ServerError';
    this.stack = stack;
  }
}

function IsPendingReply(payload) {
  const [ command, msg, reply ] = unpack(payload);
  const rid = payload.rid;
  dumpmessage('RCV', payload);
  if (rid == null || rid == "") return false;
  if (replies[rid] && command != "beginstream" && command != "stream" && command != "endstream") {
    const { resolve, reject, dt } = replies[rid];
    if (resolve) {
      try {
        if (command == "Error") {
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
    delete replies[rid];
  } else if (streams[rid]) {
    const { command } = payload;
    if (command == "Error") {
      const s = streams[rid].stream;
      s.emit('error', new Error(payload.data.toString()));
    } else if (command == "stream") {
      const s = streams[rid].stream;
      if (s.push) {
        s.push(msg.data)
      } else {
        s.write(msg.data)
      }
      streams[rid].chunks++;
      s.bytes += payload.data.length;
    } else if (command == "beginstream") {
      streams[rid].stat  =  {}
      if(msg.stat) streams[rid].stat = msg.stat;
      if(msg.checksum) streams[rid].checksum = msg.checksum;
    } else if (command == "endstream") {
      const s = streams[rid].stream;
      if (s.push) {
        streams[rid].stream.push(null);
      } else {
        streams[rid].stream.end();
      }
      // streams[rid].stream.emit("finish");
      // streams[rid].stream.end();
      // streams[rid].stream.emit("end");
      // streams[rid].stream.destroy();
      // info("Stream ended for rid: " + rid + " chunks: " + streams[rid].chunks + " bytes: " + streams[rid].bytes);
      delete streams[rid];
    }
  } else {
    return false;
  }
  return true;
}
function get(url) {
  return new Promise((resolve, reject) => {
    var provider = http;
    if (url.startsWith('https')) {
      provider = https;
    }
    provider.get(url, (resp) => {
      let data = '';
      resp.on('data', (chunk) => {
        data += chunk;
      });
      resp.on('end', () => {
        resolve(data);
      });
    }).on("error", (err) => {
      reject(err);
    });
  })
}
function post(agent, url, body) {
  return new Promise((resolve, reject) => {
    var provider = http;
    if (url.startsWith('https')) {
      provider = https;
    }
    var u = new URL(url);
    var options = {
      agent: agent,
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    var req = provider.request(url, options, (res) => {
      res.setEncoding('utf8');
      var body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve(body);
      });
    }
    );
    req.write(body);
    req.end();
  })
}

var messages = [];
function sendMesssag(client, payload, dumpmsg = true) {
  var errMsg = Envelope.verify(payload);
  if (errMsg) throw new Error(errMsg);
  if (!client.counter && client.counter != 0) {
    client.counter = 0;
  }
  payload.seq = client.counter;
  if (!payload.id || payload.id == "") payload.id = client.counter.toString();
  client.counter++;
  messages.push(payload);
  // if (!payload.id || payload.id == "") payload.id = Math.random().toString(36).substring(2, 11);
  if (payload.data && config.ChecksumCheckPackages) payload.hash = getChecksum(payload.data);
  if (dumpmsg) {
    dumpmessage('SND', payload);
  }

  if (client.protocol == "grpc") {
    if (client && client.SendStreamCall) {
      client.SendStreamCall.write(payload);
    } else if (client && client.ReceiveStreamCall) {
      client.ReceiveStreamCall.write(payload);
    } else {
      throw new Error("client is not a grpc client");
    }
    return payload.seq;
  }
  if (client.protocol == "rest") {
    if (client.app) {
      // server, how to handle this?
    } else {
      var d = payload.toString();
      post(client.agent, "http://localhost:" + client.port + "/v2/", JSON.stringify(payload)).then((data) => {
        // @ts-ignore
        var payload = JSON.parse(data);
        if (payload && payload.data && payload.data.type && payload.data.type.toLowerCase() == "buffer") {
          payload.data = Buffer.from(payload.data.data);
        }
        IsPendingReply(payload);
      });
    }
    return payload.seq;
  }
  var message = Envelope.create(payload);
  var buffer = Envelope.encode(message).finish();
  var lengthbuffer = Buffer.alloc(4);
  lengthbuffer.writeUInt32LE(buffer.length, 0); // writeUInt32LE writeUInt32BE
  if (client.protocol == "websocket" || client.protocol == "ws") {
    if (!client || !client.ws) throw new Error("client is not a websocket client");
    client.ws.send(lengthbuffer);
    client.ws.send(buffer);
    return payload.seq;
  }
  var r = config.role();
  if (config.role() == "server") {
    dumpdata(buffer);
  }

  if (client.protocol == "socket") {
    if (client.client) {
      client.client.write(lengthbuffer);
      client.client.write(buffer);
    } else if (client.stream) {
      client.stream.write(lengthbuffer);
      client.stream.write(buffer);
    } else {
      throw new Error("client is not a socket client");
    }
    return payload.seq;
  }
  if (client.protocol == "pipe") {
    try {
      if (!client.connected) {
        throw new Error("client is not connected");
      } if (client.client) {
        client.client.write(lengthbuffer);
        client.client.write(buffer);
      } else if (client.stream) {
        client.stream.write(lengthbuffer);
        client.stream.write(buffer);
      } else {
        throw new Error("client is not a socket client");
      }
    } catch (error) {
      throw error;
    }
    return payload.seq;
  }
  throw new Error("Unknown protocol");
}
function ClientCleanup(client, onClientDisconnected, error) {
  if(client.cleanup == true) return;
  client.cleanup = true;
  try {
    var keys = Object.keys(replies);
    if (!error) error = new Error("Client "  + client.id + " disconnected");
    for (let i = 0; i < keys.length; i++) {
      var key = keys[i];
      var reply = replies[key];
      reply.reject(error);
    }
    var keys = Object.keys(streams);
    for (let i = 0; i < keys.length; i++) {
      var key = keys[i];
      var stream = streams[key];
      if (error) {
        // stream.stream.emit('error', error);
        // stream.stream.destroy(error);
      }
    }
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

function connect(protocol, port, onMessage, onClientConnected, onClientDisconnected) {
  config.setrole("client");
  const result = { protocol, port, connected: false, connecting: true, id: "", client: null, agent: null, cleanup: false, ws: null, stream: null, app: null, SendStreamCall: null, ReceiveStreamCall: null, counter: 0 };
  result.id = Math.random().toString(36).substring(2, 11);
  if (protocol == "rest") {
    result.agent = new http.Agent({
      keepAlive: true,
      maxSockets: 1
    });
    post(result.agent, "http://localhost:" + result.port + "/v2/", JSON.stringify({ "command": "Noop" })).then((data) => {
      result.connected = true;
      result.connecting = false;
      onClientConnected(result);
      // @ts-ignore
      var payload = JSON.parse(data);
      if (payload && payload.data && payload.data.type && payload.data.type.toLowerCase() == "buffer") {
        payload.data = Buffer.from(payload.data.data);
      }
      IsPendingReply(payload);
    }).catch((e) => {
      ClientCleanup(result, onClientDisconnected, e);
    });
    return result;
  } else if (protocol == "grpc") {
    result.client = new hello_proto.grpcService('localhost:50051', grpc.credentials.createInsecure());
    result.client.RPC("Noop", { "command": "hello" }, function (error, response) {
      result.connecting = false;
      if (error) {
        ClientCleanup(result, onClientDisconnected, error);
        return;
      }
      result.connected = true;
      result.ReceiveStreamCall = result.client.ReceiveStream({ "command": "Noop" });
      result.SendStreamCall = result.client.SendStream(function (error, response) {
      });
      result.ReceiveStreamCall.on('data', async (message) => {
        try {
          if (message != null) {
            if (!IsPendingReply(message)) await onMessage(result, message);
          }
        } catch (error) {
          err(error);
        }
      });
      result.ReceiveStreamCall.on('end', () => {
        ClientCleanup(result, onClientDisconnected, undefined);
      });
      result.ReceiveStreamCall.on('error', (e) => {
        ClientCleanup(result, onClientDisconnected, e);
      });
      result.ReceiveStreamCall.on('status', (status) => {
        info(protocol + ' client ' + status.code + ' ' + status.details);
      });
      onClientConnected(result);
    });
    return result;
  } else if (protocol == "pipe" || protocol == "socket") {
    var PIPE_NAME = "testpipe";
    var PIPE_PATH = "\\\\.\\pipe\\" + PIPE_NAME;
    PIPE_PATH = "/tmp/CoreFxPipe_testpipe";
    if (protocol == "socket") {
      PIPE_PATH = port;
    }
    var parser = new messageParser();
    parser.Envelope = Envelope;
    result.client = net.createConnection(PIPE_PATH, async () => {
      result.connecting = false;
      result.connected = true;
      onClientConnected(result);
      result.client.pipe(parser).on('data', async (message) => {
        try {
          if (message != null) {
            if (!IsPendingReply(message)) await onMessage(result, message);
          }
        } catch (error) {
          err(error);
        }
      });
    });
    parser.on('error', (e) => {
      ClientCleanup(result, onClientDisconnected, e);
      result.client.end();
    });
    result.client.on('error', (e) => {
      ClientCleanup(result, onClientDisconnected, e);
      result.client.end();
    });
    result.client.on('end', function () {
      ClientCleanup(result, onClientDisconnected, undefined);
    });
    return result;
  } else if (protocol == "websocket" || protocol == "ws") {
    result.ws = new WebSocket('ws://localhost:' + port + '/ws/v2');
    result.ws.on('open', function open() {
      result.connecting = false;
      result.connected = true;
      onClientConnected(result);
    }
    );
    var parser = new messageParser();
    parser.Envelope = Envelope;
    result.ws.on('message', (message) => {
      parser.write(message);
    });
    parser.on('data', async (message) => {
      try {
        if (message != null) {
          if (!IsPendingReply(message)) await onMessage(result, message);
        }
      } catch (error) {
        err(error);
      }
    });
    parser.on('error', (e) => {
      ClientCleanup(result, onClientDisconnected, e);
      result.ws.close();
    });
    result.ws.on('error', function error(e) {
      ClientCleanup(result, onClientDisconnected, e);
    });
    result.ws.on('close', function close() {
      ClientCleanup(result, onClientDisconnected, undefined);
      result.ws.close();
    }
    );
    return result;
  } else {
    throw Error("protocol not supported " + protocol);
  }
}
function serve(protocol, onClientConnected, onMessage, onClientDisconnected, port, app, http) {
  config.setrole("server");
  var result = { protocol, port, id: null, connected: false, connecting: false, client: null, ws: null, SendStreamCall: null, ReceiveStreamCall: null, pending: {}, app: null, wss: null, server: null, http: null, onClientConnected, onMessage, onClientDisconnected };
  result.id = Math.random().toString(36).substring(2, 11);
  if (protocol == "rest") {
    var listen = false;
    if (!app) {
      app = express();
      app.use(express.json())
      listen = true;
    }
    app.post('/v2/', async function (req, res, next) {
      var payload = req.body;
      if (payload && payload.data && payload.data.type && payload.data.type.toLowerCase() == "buffer") {
        payload.data = Buffer.from(payload.data.data);
      }
      try {
        if (!IsPendingReply(payload)) {
          var payload = await onMessage(result, payload);
          if (!payload.id || payload.id == "") payload.id = Math.random().toString(36).substring(2, 11);
          res.send(payload);
        } else {
          res.send("IsPendingReply took your payload");
        }
      } catch (error) {
        res.send(error);
        err(error);
      }
      next();
    });
    if (listen) {
      if (http) {
        http.createServer(app);
      } else {
        app.listen(port, function () {
          port = port || 80;
        });
      }
    }
    result.app = app;
    return result;
  } else if (protocol == "websocket" || protocol == "ws") {
    var server = http;
    var p = port || 80;
    if (server) {
      p = undefined;
    } else {
      result.port = p;
    }
    result.wss = new WebSocket.WebSocketServer({ server, port: p });
    result.wss.on('connection', async function connection(ws: any, req: any) {
      const url = require('url');
      const location = url.parse(req.url, true);
      if(location.pathname == "/" || location.pathname == "/ws"|| location.pathname == "/ws/v1") {
        var sock = new WebSocketServerClient();
        WebSocketServer._clients.push(sock);
        await sock.Initialize(ws, req);
        return;
      }
      const id = Math.random().toString(36).substring(2, 11);
      var clientresult = { id, protocol, ws, connected: true, connecting: false, signedin: false };
      onClientConnected(clientresult);
      var parser = new messageParser();
      parser.Envelope = Envelope;
      ws.on('message', (message) => {
        parser.write(message);
      });
      parser.on('data', async (message) => {
        try {
          if (message != null) {
            if (!IsPendingReply(message)) {
              var payload = await onMessage(clientresult, message);
              if (payload && payload.command != "noop") sendMesssag(clientresult, payload);
            }
          }
        } catch (error) {
          err(error);
        }
      });
      parser.on('error', (e) => {
        ClientCleanup(clientresult, onClientDisconnected, e);
        clientresult.ws.close();
      });
      ws.on('error', function error(e) {
        ClientCleanup(clientresult, onClientDisconnected, e);
        clientresult.ws.close();
      });
      ws.on('close', function close() {
        ClientCleanup(clientresult, onClientDisconnected, undefined);
      });
    });
    return result;
  } else if (protocol == "grpc") {
    var clients = [];

    async function RPC(call, callback) {
      try {
        const id = Math.random().toString(36).substring(2, 11);
        var clientresult = { protocol, call, id, connected: true, connecting: false, signedin: false };
        clients.push(clientresult);
        var payload = call.request;
        if (!IsPendingReply(payload)) {
          var paylad = await onMessage(clientresult, payload)
          if (payload && payload.command != "noop") callback(null, paylad);
        }
      } catch (error) {
        err(error);
        callback(error, null);
      }
    }
    function ReceiveStream(call) {
      var clientresult = clients.find(x => x.call && x.call.id == call.id);
      if (clientresult) {
        clientresult.ReceiveStreamCall = call;
        call.on('end', function () {
          clientresult.ReceiveStreamCall = null;
        });
      }
    }
    function SendStream(call) {
      var clientresult = clients.find(x => x.call && x.call.id == call.id);
      if (!clientresult) clientresult = { protocol, call };
      onClientConnected(clientresult);
      call.on('data', async function (payload) {
        try {
          if (!IsPendingReply(payload)) {
            var payload = await onMessage(clientresult, payload)
            if (payload && payload.command != "noop") sendMesssag(clientresult, payload);
          }
        } catch (error) {
          sendMesssag(clientresult, error);
          err(error);
        }
      });
      call.on('end', function () {
        ClientCleanup(clientresult, onClientDisconnected, undefined);
      });
      call.on('error', function (e) {
        ClientCleanup(clientresult, onClientDisconnected, e);
      });
      return call;
    }
    result.server = new grpc.Server();
    result.server.addService(hello_proto.grpcService.service, { RPC, ReceiveStream, SendStream });
    result.server.bindAsync('0.0.0.0:50051', grpc.ServerCredentials.createInsecure(), () => {
      result.server.start();
    });
    return result;
  } else if (protocol == "pipe" || protocol == "socket") {
    var PIPE_NAME = "testpipe";
    var PIPE_PATH = "\\\\.\\pipe\\" + PIPE_NAME;
    PIPE_PATH = "/tmp/CoreFxPipe_testpipe"
    if (protocol == "socket") {
      PIPE_PATH = port || 80;
      result.port = PIPE_PATH;
    }

    try {
      if (fs.existsSync(PIPE_PATH)) {
        info('unlinking existing pipe ' + PIPE_PATH);
        fs.unlinkSync(PIPE_PATH);
      }
    } catch (error) {
      err(error);
    }

    result.server = net.createServer((stream) => {
      const id = Math.random().toString(36).substring(2, 11);
      var clientresult = { id, protocol, stream, connected: true, connecting: false, signedin: false };
      onClientConnected(clientresult);
      var parser = new messageParser();
      parser.Envelope = Envelope;
      stream.pipe(parser).on('data', async (message) => {
        if (!clientresult.connected) return;
        if (!IsPendingReply(message)) {
          try {
            var payload = await onMessage(clientresult, message)
            if (payload && payload.command != "noop") sendMesssag(clientresult, payload);
          } catch (error) {
            err(error);
          }
        }
      });
      stream.on('error', function (e) {
        ClientCleanup(clientresult, onClientDisconnected, e);
        clientresult.stream.end();
      });
      parser.on('error', (e) => {
        ClientCleanup(clientresult, onClientDisconnected, e);
        clientresult.stream.end();
      });
      stream.on('end', function () {
        ClientCleanup(clientresult, onClientDisconnected, undefined);
      });
    });
    result.server.on('error', (e) => {
      err(e);
      // ClientCleanup(clientresult, onClientDisconnected, e);
      // clientresult.stream.end();
    });
    result.server.listen(PIPE_PATH, function () {
    })
    return result;
  } else {
    throw Error("Not supported protocol " + protocol);
  }
}
function getFileChecksum(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256'); // sha256, md5
    const stream = fs.createReadStream(filePath);
    stream.on('data', data => {
      hash.update(data);
    });
    stream.on('end', () => {
      const checksum = hash.digest('hex');
      resolve(checksum);
    });
    stream.on('error', error => {
      reject(error);
    });
  });
}
function getChecksum(buffer) {
  const hash = crypto.createHash('sha256');
  hash.update(buffer);
  const checksum = hash.digest('hex');
  return checksum;
}
function pack(command, message) {
  const protomsg = protoRoot.lookupType("openiap." + command);
  return protomsg.encode(message).finish()
}
function unpack(message) {
  const { command, data } = message;
  const rid = message.id;
  const protomsg = protoRoot.lookupType("openiap." + command);
  let msg;
  if(typeof data == "string") {
    msg = JSON.parse(data);
  } else if ( data != null) {
    try {
      msg = protomsg.decode(data)
    } catch (error) {
      msg = data.toString();
      if(msg.startsWith("{")) msg = JSON.parse(msg);
    }    
  }
  const reply = { command, rid, data: null };
  return [command, msg, reply];
}
exports.defaultprotocol = "pipe"; // pipe, socket, ws, grpc, rest
exports.dumpmessage = dumpmessage;
exports.sendMesssag = sendMesssag;
exports.serve = serve;
exports.connect = connect;
exports.RPC = RPC;
exports.CreateStream = CreateStream;
exports.UploadFile = UploadFile;
exports.DownloadFile = DownloadFile;
exports.ReceiveFileContent = ReceiveFileContent;
exports.sendFileContent = sendFileContent;
exports.SetStream = SetStream;
exports.getFileChecksum = getFileChecksum;
exports.getChecksum = getChecksum;
exports.init = init;
exports.protoRoot = getProtoRoot;
exports.pack = pack;
exports.unpack = unpack;