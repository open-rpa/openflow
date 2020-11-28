import * as RED from "node-red";
import { Red } from "node-red";
import { Config } from "../../Config";
import { WebSocketClient, NoderedUtil, SigninMessage, Message, QueueMessage } from "openflow-api";
import { Logger } from "../../Logger";

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
            this.webcli._logger.info("amqp_config: connecting to " + this.host);
            this.webcli.events.on("onopen", async () => {
                try {
                    const q: SigninMessage = new SigninMessage();
                    q.clientagent = "remotenodered";
                    q.clientversion = Config.version;
                    q.username = this.username;
                    q.password = this.password;
                    const msg: Message = new Message(); msg.command = "signin"; msg.data = JSON.stringify(q);
                    this.webcli._logger.info("amqp_config: signing into " + this.host + " as " + this.username);
                    const result: SigninMessage = await this.webcli.Send<SigninMessage>(msg);
                    this.webcli._logger.info("signed in to " + this.host + " as " + result.user.name + " with id " + result.user._id);
                    this.webcli.user = result.user;
                    this.webcli.jwt = result.jwt;
                    this.webcli.events.emit("onsignedin", result.user);
                } catch (error) {
                    this.webcli._logger.error(error);
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
    private _onsignedin: any = null;
    private _onsocketclose: any = null;
    constructor(public config: Iamqp_consumer_node) {
        RED.nodes.createNode(this, config);
        try {
            this.node = this;
            this.node.status({});
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
            NoderedUtil.HandleError(this, error);
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
            Logger.instanse.info("track::amqp consumer node in::connect");

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
            const data: any = msg.data;
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
        this.websocket().events.removeListener("onsignedin", this._onsignedin);
        this.websocket().events.removeListener("onclose", this._onsocketclose);
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
    private _onsignedin: any = null;
    private _onsocketclose: any = null;
    constructor(public config: Iamqp_publisher_node) {
        RED.nodes.createNode(this, config);
        try {
            this.node = this;
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
            NoderedUtil.HandleError(this, error);
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
            Logger.instanse.info("track::amqp publiser node::connect");
            this.localqueue = this.config.localqueue;
            console.log(this.localqueue);
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
            const result: any = {};
            result.amqpacknowledgment = ack;
            const data = msg.data;
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
            const data: any = {};
            data.payload = msg.payload;
            data.jwt = msg.jwt;
            data._id = msg._id;
            const expiration: number = (typeof msg.expiration == 'number' ? msg.expiration : Config.amqp_message_ttl);
            const queue = this.config.queue;
            this.node.status({ fill: "blue", shape: "dot", text: "Sending message ..." });
            try {
                await NoderedUtil.QueueMessage(this.websocket(), queue, this.localqueue, data, null, expiration);
            } catch (error) {
                data.error = error;
                this.node.send([null, data]);
            }
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
        this.websocket().events.removeListener("onsignedin", this._onsignedin);
        this.websocket().events.removeListener("onclose", this._onsocketclose);

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
                const data: any = {};
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
