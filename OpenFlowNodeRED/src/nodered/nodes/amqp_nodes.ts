import * as RED from "node-red";
import { Red } from "node-red";
import { NoderedUtil } from "./NoderedUtil";
import { Logger } from "../../Logger";
//import { amqp_consumer } from "../../amqp_consumer";
//import { amqp_publisher } from "../../amqp_publisher";
import { Config } from "../../Config";
import { WebSocketClient } from "../../WebSocketClient";
import { QueueMessage } from "../../Message";

export interface Iamqp_connection {
    host: string;
}
export class amqp_connection {
    public node: Red = null;
    public name: string = "";
    public username: string = "";
    public password: string = "";
    public host: string = "";
    constructor(public config: Iamqp_connection) {
        RED.nodes.createNode(this, config);
        this.node = this;
        this.node.status({});
        if (this.node.credentials && this.node.credentials.hasOwnProperty("username")) {
            this.username = this.node.credentials.username;
        }
        if (this.node.credentials && this.node.credentials.hasOwnProperty("password")) {
            this.password = this.node.credentials.password;
        }
        this.host = this.config.host;
    }
}

export interface Iamqp_consumer_node {
    config: any;
    queue: string;
    noack: boolean;
}
export class amqp_consumer_node {
    public node: Red = null;
    public name: string = "";
    public host: string = null;
    public localqueue: string = "";
    constructor(public config: Iamqp_consumer_node) {
        RED.nodes.createNode(this, config);
        try {
            this.node = this;
            this.node.status({});
            this.node.on("close", this.onclose);
            var _config: amqp_connection = RED.nodes.getNode(this.config.config);
            let username: string = null;
            let password: string = null;
            if (!NoderedUtil.IsNullUndefinded(_config) && !NoderedUtil.IsNullEmpty(_config.username)) {
                username = _config.username;
            }
            if (!NoderedUtil.IsNullUndefinded(_config) && !NoderedUtil.IsNullEmpty(_config.password)) {
                password = _config.password;
            }
            if (!NoderedUtil.IsNullUndefinded(_config) && !NoderedUtil.IsNullEmpty(_config.host)) {
                this.host = _config.host;
            }
            WebSocketClient.instance.events.on("onsignedin", () => {
                this.connect();
            });
            WebSocketClient.instance.events.on("onclose", (message) => {
                if (message == null) message = "";
                this.node.status({ fill: "red", shape: "dot", text: "Disconnected " + message });
                this.onclose();
            });
            this.connect();
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    async connect() {
        try {
            this.node.status({ fill: "blue", shape: "dot", text: "Connecting..." });

            this.localqueue = await NoderedUtil.RegisterQueue(this.config.queue, (msg: QueueMessage, ack: any) => {
                this.OnMessage(msg, ack);
            });
            this.node.status({ fill: "green", shape: "dot", text: "Connected" });
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    async OnMessage(msg: any, ack: any) {
        try {
            var result: any = {};
            result.amqpacknowledgment = ack;
            var data: any = null;
            try {
                // data = JSON.parse(msg.content.toString());
                data = msg.data;
            } catch (error) {

            }
            try {
                data.payload = JSON.parse(data.payload);
            } catch (error) {
            }
            result.payload = data.payload;
            result.jwt = data.jwt;
            this.node.send(result);
            ack();
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    onclose() {
        if (!NoderedUtil.IsNullEmpty(this.localqueue)) {
            NoderedUtil.CloseQueue(this.localqueue);
            this.localqueue = "";
        }
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
    constructor(public config: Iamqp_publisher_node) {
        RED.nodes.createNode(this, config);
        try {
            this.node = this;
            this.node.status({});
            this.node.on("input", this.oninput);
            this.node.on("close", this.onclose);

            let username: string = null;
            let password: string = null;
            var _config: amqp_connection = RED.nodes.getNode(this.config.config);
            if (NoderedUtil.IsNullEmpty(this.config.localqueue)) { this.config.localqueue = ""; }

            if (!NoderedUtil.IsNullUndefinded(_config) && !NoderedUtil.IsNullEmpty(_config.username)) {
                username = _config.username;
            }
            if (!NoderedUtil.IsNullUndefinded(_config) && !NoderedUtil.IsNullEmpty(_config.password)) {
                password = _config.password;
            }
            if (!NoderedUtil.IsNullUndefinded(_config) && !NoderedUtil.IsNullEmpty(_config.host)) {
                this.host = _config.host;
            }
            if (!NoderedUtil.IsNullEmpty(username) && !NoderedUtil.IsNullEmpty(password)) {
                this.host = "amqp://" + username + ":" + password + "@" + this.host;
            } else {
                // this.host = "amqp://" + this.host;
                this.host = Config.amqp_url;
            }
            WebSocketClient.instance.events.on("onsignedin", () => {
                this.connect();
            });
            WebSocketClient.instance.events.on("onclose", (message) => {
                if (message == null) message = "";
                this.node.status({ fill: "red", shape: "dot", text: "Disconnected " + message });
                this.onclose();
            });
            this.connect();
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    async connect() {
        try {
            this.node.status({ fill: "blue", shape: "dot", text: "Connecting..." });
            this.localqueue = this.config.localqueue;
            // if (this.localqueue !== null && this.localqueue !== undefined && this.localqueue !== "") { this.localqueue = Config.queue_prefix + this.localqueue; }
            this.localqueue = await NoderedUtil.RegisterQueue(this.localqueue, (msg: QueueMessage, ack: any) => {
                this.OnMessage(msg, ack);
            });
            this.node.status({ fill: "green", shape: "dot", text: "Connected" });

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
            this.node.send(result);
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
            var expiration: number = (60 * 1000); // 1 min
            if (typeof msg.expiration == 'number') {
                expiration = msg.expiration;
            }
            var queue = this.config.queue;
            //this.localqueue = this.config.queue;
            // if (this.localqueue !== null && this.localqueue !== undefined && this.localqueue !== "") { this.localqueue = Config.queue_prefix + this.localqueue; }
            var expiration: number = Config.amqp_workflow_out_expiration;
            if (!NoderedUtil.IsNullEmpty(msg.expiration)) expiration = msg.expiration;
            await NoderedUtil.QueueMessage(queue, this.localqueue, data, null, expiration);
            // this.con.SendMessage(JSON.stringify(data), this.config.queue, null, true);
            this.node.status({});
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    onclose() {
        if (!NoderedUtil.IsNullEmpty(this.localqueue)) {
            NoderedUtil.CloseQueue(this.localqueue);
            this.localqueue = "";
        }
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
