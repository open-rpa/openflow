import * as RED from "node-red";
import { Red } from "node-red";
import { Config } from "../../Config";
import { WebSocketClient, NoderedUtil, SigninMessage, Message, QueueMessage } from "openflow-api";

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
        this.credentials = this.node.credentials;
        if (this.node.credentials && this.node.credentials.hasOwnProperty("username")) {
            this.username = this.node.credentials.username;
        }
        if (this.node.credentials && this.node.credentials.hasOwnProperty("password")) {
            this.password = this.node.credentials.password;
        }
        this.host = this.config.host;
        if (!NoderedUtil.IsNullUndefinded(this.host)) {
            this.webcli = new WebSocketClient(WebSocketClient.instance._logger, this.host);
            this.webcli.agent = "remotenodered";
            this.webcli.version = Config.version;
            this.webcli._logger.info("amqp_condig: connecting to " + this.host);
            this.webcli.events.on("onopen", async () => {
                try {
                    var q: SigninMessage = new SigninMessage();
                    q.clientagent = "remotenodered";
                    q.clientversion = Config.version;
                    q.username = this.username;
                    q.password = this.password;
                    var msg: Message = new Message(); msg.command = "signin"; msg.data = JSON.stringify(q);
                    this.webcli._logger.info("amqp_condig: signing into " + this.host + " as " + this.username);
                    var result: SigninMessage = await this.webcli.Send<SigninMessage>(msg);
                    this.webcli._logger.info("signed in to " + this.host + " as " + result.user.name + " with id " + result.user._id);
                    this.webcli.user = result.user;
                    this.webcli.jwt = result.jwt;
                    this.webcli.events.emit("onsignedin", result.user);
                } catch (error) {
                    if (error.message) { this.webcli._logger.error(error.message); }
                    else { this.webcli._logger.error(error); }
                }
            });
            this.webcli.events.on("onsignedin", async (user) => {
                this.webcli._logger.info("signed in to " + this.host + " as " + user.name + " with id " + user._id);
            });
        }
    }
    websocket(): WebSocketClient {
        if (!NoderedUtil.IsNullUndefinded(this.host)) {
            return this.webcli;
        }
        return WebSocketClient.instance;
    }
}

export interface Iamqp_consumer_node {
    config: any;
    queue: string;
}
export class amqp_consumer_node {
    public node: Red = null;
    public name: string = "";
    public host: string = null;
    public localqueue: string = "";
    private connection: amqp_connection;
    constructor(public config: Iamqp_consumer_node) {
        RED.nodes.createNode(this, config);
        try {
            this.node = this;
            this.node.status({});
            this.node.on("close", this.onclose);
            this.connection = RED.nodes.getNode(this.config.config);
            this.websocket().events.on("onsignedin", this.onsignedin.bind(this));
            this.websocket().events.on("onclose", this.onsocketclose.bind(this));
            this.connect();
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    onsocketclose(message) {
        if (message == null) message = "";
        this.node.status({ fill: "red", shape: "dot", text: "Disconnected " + message });
        this.onclose(false, null);
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

            this.localqueue = await NoderedUtil.RegisterQueue(this.websocket(), this.config.queue, (msg: QueueMessage, ack: any) => {
                this.OnMessage(msg, ack);
            });
            this.websocket()._logger.info("registed amqp consumer as " + this.localqueue);
            this.node.status({ fill: "green", shape: "dot", text: "Connected " + this.localqueue });
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    async OnMessage(msg: any, ack: any) {
        try {
            var data: any = msg.data;
            data.amqpacknowledgment = ack;
            if (!NoderedUtil.IsNullUndefinded(data.__user)) {
                data.user = data.__user;
                delete data.__user;
            }
            if (!NoderedUtil.IsNullUndefinded(data.__jwt)) {
                data.jwt = data.__jwt;
                delete data.__jwt;
            }
            this.node.send(data);
            ack();
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    async onclose(removed: boolean, done: any) {
        if (!NoderedUtil.IsNullEmpty(this.localqueue) && removed) {
            NoderedUtil.CloseQueue(this.websocket(), this.localqueue);
            this.localqueue = "";
        }
        if (done != null) done();
    }
}





export interface Iamqp_publisher_node {
    config: any;
    queue: string;
    localqueue: string;
}
export class amqp_publisher_node {
    public node: Red = null;
    public name: string = "";
    public host: string = null;
    public localqueue: string = "";
    private connection: amqp_connection;
    constructor(public config: Iamqp_publisher_node) {
        RED.nodes.createNode(this, config);
        try {
            this.node = this;
            this.node.status({});
            this.node.on("input", this.oninput);
            this.node.on("close", this.onclose);

            this.connection = RED.nodes.getNode(this.config.config);
            this.websocket().events.on("onsignedin", this.onsignedin.bind(this));
            this.websocket().events.on("onclose", this.onsocketclose.bind(this));
            this.connect();
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    onsignedin() {
        this.connect();
    }
    onsocketclose(message) {
        if (message == null) message = "";
        this.node.status({ fill: "red", shape: "dot", text: "Disconnected " + message });
        this.onclose(false, null);
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
            this.localqueue = this.config.localqueue;
            console.log(this.localqueue);
            // if (this.localqueue !== null && this.localqueue !== undefined && this.localqueue !== "") { this.localqueue = Config.queue_prefix + this.localqueue; }
            this.localqueue = await NoderedUtil.RegisterQueue(this.websocket(), this.localqueue, (msg: QueueMessage, ack: any) => {
                this.OnMessage(msg, ack);
            });
            console.log(this.localqueue);
            this.websocket()._logger.info("registed amqp published return queue as " + this.localqueue);
            this.node.status({ fill: "green", shape: "dot", text: "Connected " + this.localqueue });

        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    async OnMessage(msg: any, ack: any) {
        try {
            var result: any = {};
            result.amqpacknowledgment = ack;
            // var json: string = msg.content.toString();
            // var data = JSON.parse(json);
            var data = msg.data;
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
            NoderedUtil.HandleError(this, error);
        }
    }
    async oninput(msg: any) {
        try {
            this.node.status({});
            var data: any = {};
            data.payload = msg.payload;
            data.jwt = msg.jwt;
            data._id = msg._id;
            var expiration: number = Config.amqp_message_ttl; // 1 min
            if (typeof msg.expiration == 'number') {
                expiration = msg.expiration;
            }
            var queue = this.config.queue;
            //this.localqueue = this.config.queue;
            // if (this.localqueue !== null && this.localqueue !== undefined && this.localqueue !== "") { this.localqueue = Config.queue_prefix + this.localqueue; }
            var expiration: number = Config.amqp_workflow_out_expiration;
            if (!NoderedUtil.IsNullEmpty(msg.expiration)) expiration = msg.expiration;
            this.node.status({ fill: "blue", shape: "dot", text: "Sending message ..." });
            await NoderedUtil.QueueMessage(this.websocket(), queue, this.localqueue, data, null, expiration);
            // this.con.SendMessage(JSON.stringify(data), this.config.queue, null, true);
            this.node.status({ fill: "green", shape: "dot", text: "Connected " + this.localqueue });
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    async onclose(removed: boolean, done: any) {
        if (!NoderedUtil.IsNullEmpty(this.localqueue) && removed) {
            NoderedUtil.CloseQueue(this.websocket(), this.localqueue);
            this.localqueue = "";
        }
        if (done != null) done();
    }
}


export interface Iamqp_acknowledgment_node {
}
export class amqp_acknowledgment_node {
    public node: Red = null;
    public name: string = "";
    constructor(public config: Iamqp_acknowledgment_node) {
        RED.nodes.createNode(this, config);
        this.node = this;
        this.node.status({});
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }
    async oninput(msg: any) {
        try {
            this.node.status({});
            if (msg.amqpacknowledgment) {
                var data: any = {};
                data.payload = msg.payload;
                data.jwt = msg.jwt;
                msg.amqpacknowledgment(true, data);
            }
            this.node.send(msg);
            this.node.status({});
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    onclose() {
    }
}
