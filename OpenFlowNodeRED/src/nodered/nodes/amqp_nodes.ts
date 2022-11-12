import * as RED from "node-red";
import { Red } from "node-red";
import { Config } from "../../Config";
import { WebSocketClient, NoderedUtil, SigninMessage, Message, QueueMessage } from "@openiap/openflow-api";
import { Util } from "./Util";
import { Logger } from "../../Logger";
import { log_message, WebServer } from "../../WebServer";

export interface Iamqp_connection {
    name: string;
    username: string;
    password: string;
    host: string;
}
export class amqp_connection {
    public node: Red = null;
    public name: string = "";
    public username: string = "";
    public password: string = "";
    public host: string = "";
    public credentials: Iamqp_connection;
    public webcli: WebSocketClient;
    constructor(public config: Iamqp_connection) {
        RED.nodes.createNode(this, config);
        this.node = this;
        this.node.status({});
        this.node.on("close", this.onclose);
        this.credentials = this.node.credentials;
        if (this.node.credentials && this.node.credentials.hasOwnProperty("username")) {
            this.username = this.node.credentials.username;
        }
        if (this.node.credentials && this.node.credentials.hasOwnProperty("password")) {
            this.password = this.node.credentials.password;
        }
        this.host = this.config.host;
        this.name = config.name || this.host;
        if (!NoderedUtil.IsNullUndefinded(this.host)) {
            this.webcli = new WebSocketClient(null, this.host);
            this.webcli.agent = "remotenodered";
            this.webcli.version = Config.version;
            Logger.instanse.info("amqp_nodes", "config", "connecting to " + this.host);
            this.webcli.events.on("onopen", async () => {
                try {
                    const q: SigninMessage = new SigninMessage();
                    q.clientagent = "remotenodered";
                    q.clientversion = Config.version;
                    q.username = this.username;
                    q.password = this.password;
                    const msg: Message = new Message(); msg.command = "signin"; msg.data = JSON.stringify(q);
                    Logger.instanse.info("amqp_nodes", "config", "signing into " + this.host + " as " + this.username);
                    const result: SigninMessage = await this.webcli.Send<SigninMessage>(msg, 1);
                    Logger.instanse.info("amqp_nodes", "config", "signed in to " + this.host + " as " + result.user.name + " with id " + result.user._id);
                    this.webcli.user = result.user;
                    this.webcli.jwt = result.jwt;
                    this.webcli.events.emit("onsignedin", result.user);
                } catch (error) {
                    Logger.instanse.error("amqp_nodes", "config", error);
                    this.webcli.events.emit("onclose", (error.message ? error.message : error));
                    NoderedUtil.HandleError(this.node, error, null);
                }
            });
            this.webcli.events.on("onsignedin", async (user) => {
                Logger.instanse.info("amqp_nodes", "config", "signed in to " + this.host + " as " + user.name + " with id " + user._id);
            });
        }
    }
    websocket(): WebSocketClient {
        if (!NoderedUtil.IsNullUndefinded(this.host)) {
            return this.webcli;
        }
        return WebSocketClient.instance;
    }
    async onclose(removed: boolean, done: any) {
        if (!NoderedUtil.IsNullUndefinded(this.host)) {
            this.webcli.close(1000, "node-red closed");
            this.webcli.events.removeAllListeners();
            this.webcli = null;
        }
        if (done != null) done();
    }
}

export interface Iamqp_consumer_node {
    config: any;
    queue: string;
    autoack: boolean;
    name: string;
}
export class amqp_consumer_node {
    public node: Red = null;
    public name: string = "";
    public host: string = null;
    public localqueue: string = "";
    private connection: amqp_connection;
    private _onsignedin: any = null;
    private _onsocketclose: any = null;
    constructor(public config: Iamqp_consumer_node) {
        RED.nodes.createNode(this, config);
        try {
            this.node = this;
            this.name = config.name;
            // this.node.status({});
            this.node.status({ fill: "blue", shape: "dot", text: "Offline" });
            this.node.on("close", this.onclose);
            this.connection = RED.nodes.getNode(this.config.config);
            this._onsignedin = this.onsignedin.bind(this);
            this._onsocketclose = this.onsocketclose.bind(this);
            this.websocket().events.on("onsignedin", this._onsignedin);
            this.websocket().events.on("onclose", this._onsocketclose);
            if (this.websocket().isConnected && this.websocket().user != null) {
                this.connect();
            } else {
                this.node.status({ fill: "blue", shape: "dot", text: "Waiting on conn" });
            }
        } catch (error) {
            NoderedUtil.HandleError(this, error, null);
        }
    }
    onsocketclose(message) {
        if (message == null) message = "";
        if (this != null && this.node != null) this.node.status({ fill: "red", shape: "dot", text: "Disconnected " + message });
    }
    onsignedin() {
        this.connect();
    }
    websocket(): WebSocketClient {
        if (this.connection != null) {
            return this.connection.websocket();
        }
        return WebSocketClient.instance;
    }
    async connect() {
        try {
            this.node.status({ fill: "blue", shape: "dot", text: "Connecting..." });
            Logger.instanse.info("amqp_nodes", "connect", "consumer node in::connect");

            this.localqueue = await NoderedUtil.RegisterQueue({
                websocket: this.websocket(), queuename: this.config.queue, callback: (msg: QueueMessage, ack: any) => {
                this.OnMessage(msg, ack);
                }, closedcallback: (msg) => {
                if (this != null && this.node != null) this.node.status({ fill: "red", shape: "dot", text: "Disconnected" });
                setTimeout(this.connect.bind(this), (Math.floor(Math.random() * 6) + 1) * 500);
                }
            });
            Logger.instanse.info("amqp_nodes", "connect", "registed amqp consumer as " + this.localqueue);
            this.node.status({ fill: "green", shape: "dot", text: "Connected " + this.localqueue });
        } catch (error) {
            NoderedUtil.HandleError(this, error, null);
            setTimeout(this.connect.bind(this), (Math.floor(Math.random() * 6) + 1) * 2000);
        }
    }
    async OnMessage(msg: any, ack: any) {
        const data: any = msg.data;
        var span = Logger.otel.startSpan("Consumer Node Received", data.traceId, data.spanId);
        try {
            if (this.config.autoack) {
                const data: any = Object.assign({}, msg.data);
                delete data.jwt;
                delete data.__jwt;
                delete data.__user;
                ack(true, data, data.traceId, data.spanId);
            } else {
                data.amqpacknowledgment = ack;
            }
            if (!NoderedUtil.IsNullUndefinded(data.__user)) {
                data.user = data.__user;
                delete data.__user;
            }
            if (!NoderedUtil.IsNullUndefinded(data.__jwt)) {
                data.jwt = data.__jwt;
                delete data.__jwt;
            }
            this.node.send(data);
            if (!this.config.autoack) ack();
        } catch (error) {
            NoderedUtil.HandleError(this, error, msg);
        } finally {
            span?.end();
        }
    }
    async onclose(removed: boolean, done: any) {
        if (!NoderedUtil.IsNullEmpty(this.localqueue) && removed) {
            NoderedUtil.CloseQueue({ websocket: this.websocket(), queuename: this.localqueue });
            this.localqueue = "";
        }
        this.websocket().events.removeListener("onsignedin", this._onsignedin);
        this.websocket().events.removeListener("onclose", this._onsocketclose);
        if (done != null) done();
    }
}





export interface Iamqp_publisher_node {
    config: any;
    queue: string;
    exchange: string;
    routingkey: string;
    localqueue: string;
    striptoken: boolean;
    name: string;
}
export class amqp_publisher_node {
    public node: Red = null;
    public name: string = "";
    public host: string = null;
    public localqueue: string = "";
    private connection: amqp_connection;
    private _onsignedin: any = null;
    private _onsocketclose: any = null;
    static payloads: any = {};
    constructor(public config: Iamqp_publisher_node) {
        RED.nodes.createNode(this, config);
        try {
            this.node = this;
            this.name = config.name;
            this.node.status({});
            this.node.on("input", this.oninput);
            this.node.on("close", this.onclose);
            this.connection = RED.nodes.getNode(this.config.config);
            this._onsignedin = this.onsignedin.bind(this);
            this._onsocketclose = this.onsocketclose.bind(this);
            this.websocket().events.on("onsignedin", this._onsignedin);
            this.websocket().events.on("onclose", this._onsocketclose);

            if (this.websocket().isConnected && this.websocket().user != null) {
                this.connect();
            }
        } catch (error) {
            NoderedUtil.HandleError(this, error, null);
        }
    }
    onsignedin() {
        this.connect();
    }
    onsocketclose(message) {
        if (message == null) message = "";
        if (this != null && this.node != null) this.node.status({ fill: "red", shape: "dot", text: "Disconnected " + message });
    }
    websocket(): WebSocketClient {
        if (this.connection != null) {
            return this.connection.websocket();
        }
        return WebSocketClient.instance;
    }
    async connect() {
        try {
            this.node.status({ fill: "blue", shape: "dot", text: "Connecting..." });
            Logger.instanse.info("amqp_nodes", "connect", "track::amqp publiser node::connect");
            this.localqueue = this.config.localqueue;
            this.localqueue = await NoderedUtil.RegisterQueue({
                websocket: this.websocket(), queuename: this.localqueue, callback: (msg: QueueMessage, ack: any) => {
                this.OnMessage(msg, ack);
                }, closedcallback: (msg) => {
                this.localqueue = "";
                if (this != null && this.node != null) this.node.status({ fill: "red", shape: "dot", text: "Disconnected" });
                setTimeout(this.connect.bind(this), (Math.floor(Math.random() * 6) + 1) * 500);
                }
            });
            if (!NoderedUtil.IsNullEmpty(this.localqueue)) {
                Logger.instanse.info("amqp_nodes", "connect", "registed amqp published return queue as " + this.localqueue);
                this.node.status({ fill: "green", shape: "dot", text: "Connected " + this.localqueue });
            } else {
                if (this != null && this.node != null) this.node.status({ fill: "red", shape: "dot", text: "Disconnected" });
                setTimeout(this.connect.bind(this), (Math.floor(Math.random() * 6) + 1) * 500);
            }
        } catch (error) {
            this.localqueue = "";
            NoderedUtil.HandleError(this, error, null);
            setTimeout(this.connect.bind(this), (Math.floor(Math.random() * 6) + 1) * 2000);
        }
    }
    async OnMessage(msg: any, ack: any) {
        let data = msg.data;
        var span = Logger.otel.startSpan("Publish Node Receive", data.traceId, data.spanId);
        try {
            let result: any = {};
            if (!NoderedUtil.IsNullEmpty(data._msgid)) {
                if (amqp_publisher_node.payloads && amqp_publisher_node.payloads[data._msgid]) {
                    result = Object.assign(amqp_publisher_node.payloads[data._msgid], data);
                    delete amqp_publisher_node.payloads[data._msgid];
                }
            }
            result.payload = data.payload;
            result.jwt = data.jwt;
            if (data.command == "timeout") {
                result.error = "Message timed out, message was not picked up in a timely fashion";
                this.node.send([null, result]);
            } else {
                this.node.send(result);
            }
            ack();
        } catch (error) {
            NoderedUtil.HandleError(this, error, msg);
        } finally {
            span?.end();
        }
    }
    async oninput(msg: any) {
        let traceId: string; let spanId: string
        let logmsg = WebServer.log_messages[msg._msgid];
        if (logmsg != null) {
            traceId = logmsg.traceId;
            spanId = logmsg.spanId;
        }
        let span = Logger.otel.startSpan("Publish Node Send", traceId, spanId);
        try {
            this.node.status({});
            if (this.websocket() == null || !this.websocket().isConnected()) {
                throw new Error("Not connected to openflow");
            }
            if (NoderedUtil.IsNullEmpty(this.localqueue)) {
                throw new Error("Queue not registered yet");
            }
            const queuename = await Util.EvaluateNodeProperty<string>(this, msg, "queue");
            const exchangename = await Util.EvaluateNodeProperty<string>(this, msg, "exchange");
            const routingkey = await Util.EvaluateNodeProperty<string>(this, msg, "routingkey");

            let striptoken = this.config.striptoken;
            let priority: number = 1;
            if (!NoderedUtil.IsNullEmpty(msg.priority)) { priority = msg.priority; }
            if (!NoderedUtil.IsNullEmpty(msg.striptoken)) { striptoken = msg.striptoken; }

            const data: any = {};
            const [traceId, spanId] = Logger.otel.GetTraceSpanId(span);
            data.payload = msg.payload;
            data.jwt = msg.jwt;
            data._id = msg._id;
            data._msgid = msg._msgid;
            const expiration: number = (typeof msg.expiration == 'number' ? msg.expiration : Config.amqp_message_ttl);
            this.node.status({ fill: "blue", shape: "dot", text: "Sending message ..." });
            try {
                await NoderedUtil.Queue({ websocket: this.websocket(), exchangename, routingkey, queuename, replyto: this.localqueue, data, expiration, striptoken, priority, traceId, spanId });
                amqp_publisher_node.payloads[msg._msgid] = msg;
            } catch (error) {
                data.error = error;
                this.node.send([null, data]);
            }
            this.node.status({ fill: "green", shape: "dot", text: "Connected " + this.localqueue });
        } catch (error) {
            NoderedUtil.HandleError(this, error, msg);
        } finally {
            span?.end();
            if (logmsg != null) {
                log_message.nodeend(msg._msgid, this.node.id);
            }
        }
    }
    async onclose(removed: boolean, done: any) {
        // if (!NoderedUtil.IsNullEmpty(this.localqueue) && removed) {
        NoderedUtil.CloseQueue({ websocket: this.websocket(), queuename: this.localqueue });
        this.localqueue = "";
        // }
        this.websocket().events.removeListener("onsignedin", this._onsignedin);
        this.websocket().events.removeListener("onclose", this._onsocketclose);

        if (done != null) done();
    }
}


export interface Iamqp_acknowledgment_node {
    name: string;
}
export class amqp_acknowledgment_node {
    public node: Red = null;
    public name: string = "";
    constructor(public config: Iamqp_acknowledgment_node) {
        RED.nodes.createNode(this, config);
        this.node = this;
        this.name = config.name;
        this.node.status({});
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }
    async oninput(msg: any) {
        let traceId: string; let spanId: string
        let logmsg = WebServer.log_messages[msg._msgid];
        if (logmsg != null) {
            traceId = logmsg.traceId;
            spanId = logmsg.spanId;
        }
        let span = Logger.otel.startSpan("cknowledgment node", traceId, spanId);
        try {
            this.node.status({});
            if (msg.amqpacknowledgment) {
                const data: any = {};
                data.payload = msg.payload;
                data.jwt = msg.jwt;
                data._msgid = msg._msgid;
                msg.amqpacknowledgment(true, data, traceId, spanId);
            }
            this.node.send(msg);
            this.node.status({});
        } catch (error) {
            NoderedUtil.HandleError(this, error, msg);
        } finally {
            span?.end();
            if (logmsg != null) {
                log_message.nodeend(msg._msgid, this.node.id);
            }
        }
    }
    onclose() {
    }
}





export interface Iamqp_exchange_node {
    config: any;
    exchange: string;
    routingkey: string;
    algorithm: "direct" | "fanout" | "topic" | "header";
    autoack: boolean;
    name: string;
}
export class amqp_exchange_node {
    public node: Red = null;
    public name: string = "";
    public host: string = null;
    public localqueue: string = "";
    private connection: amqp_connection;
    private _onsignedin: any = null;
    private _onsocketclose: any = null;
    constructor(public config: Iamqp_exchange_node) {
        RED.nodes.createNode(this, config);
        try {
            this.node = this;
            this.name = config.name;
            // this.node.status({});
            this.node.status({ fill: "blue", shape: "dot", text: "Offline" });
            this.node.on("close", this.onclose);
            this.connection = RED.nodes.getNode(this.config.config);
            this._onsignedin = this.onsignedin.bind(this);
            this._onsocketclose = this.onsocketclose.bind(this);
            this.websocket().events.on("onsignedin", this._onsignedin);
            this.websocket().events.on("onclose", this._onsocketclose);
            if (this.websocket().isConnected && this.websocket().user != null) {
                this.connect();
            } else {
                this.node.status({ fill: "blue", shape: "dot", text: "Waiting on conn" });
            }
        } catch (error) {
            NoderedUtil.HandleError(this, error, null);
        }
    }
    onsocketclose(message) {
        if (message == null) message = "";
        if (this != null && this.node != null) this.node.status({ fill: "red", shape: "dot", text: "Disconnected " + message });
    }
    onsignedin() {
        this.connect();
    }
    websocket(): WebSocketClient {
        if (this.connection != null) {
            return this.connection.websocket();
        }
        return WebSocketClient.instance;
    }
    async connect() {
        try {
            this.node.status({ fill: "blue", shape: "dot", text: "Connecting..." });
            Logger.instanse.info("amqp_nodes", "connect", "track::amqp exchange node in::connect");
            const result = await NoderedUtil.RegisterExchange({
                websocket: this.websocket(), exchangename: this.config.exchange, algorithm: this.config.algorithm,
                routingkey: this.config.routingkey, callback: (msg: QueueMessage, ack: any) => {
                    this.OnMessage(msg, ack);
                }, closedcallback: (msg) => {
                    if (this != null && this.node != null) this.node.status({ fill: "red", shape: "dot", text: "Disconnected" });
                    setTimeout(this.connect.bind(this), (Math.floor(Math.random() * 6) + 1) * 500);
                }
            });
            this.localqueue = result.queuename;
            Logger.instanse.info("amqp_nodes", "connect", "registed amqp exchange as " + result.exchangename);
            this.node.status({ fill: "green", shape: "dot", text: "Connected " + result.exchangename });
        } catch (error) {
            NoderedUtil.HandleError(this, error, null);
            setTimeout(this.connect.bind(this), (Math.floor(Math.random() * 6) + 1) * 2000);
        }
    }
    async OnMessage(msg: any, ack: any) {
        try {
            const data: any = msg.data;
            if (this.config.autoack) {
                const data: any = Object.assign({}, msg.data);
                delete data.jwt;
                delete data.__jwt;
                delete data.__user;
                ack(true, data);
            } else {
                data.amqpacknowledgment = ack;
            }            
            if (!NoderedUtil.IsNullUndefinded(data.__user)) {
                data.user = data.__user;
                delete data.__user;
            }
            if (!NoderedUtil.IsNullUndefinded(data.__jwt)) {
                data.jwt = data.__jwt;
                delete data.__jwt;
            }
            this.node.send(data);
            if (!this.config.autoack) ack();
        } catch (error) {
            NoderedUtil.HandleError(this, error, msg);
        }
    }
    async onclose(removed: boolean, done: any) {
        if (!NoderedUtil.IsNullEmpty(this.localqueue)) { // && removed
            NoderedUtil.CloseQueue({ websocket: this.websocket(), queuename: this.localqueue });
            this.localqueue = "";
        }
        this.websocket().events.removeListener("onsignedin", this._onsignedin);
        this.websocket().events.removeListener("onclose", this._onsocketclose);
        if (done != null) done();
    }
}