import * as RED from "node-red";
import { Red } from "node-red";
import { NoderedUtil } from "./NoderedUtil";
import { Logger } from "../../Logger";
import { amqp_consumer } from "../../amqp_consumer";
import { amqp_publisher } from "../../amqp_publisher";
import { Config } from "../../Config";

export interface Irpa_detector_node {
    queue: string;
    noack: boolean;
}
export class rpa_detector_node {
    public node: Red = null;
    public name: string = "";
    public con: amqp_consumer;
    public host: string = null;
    constructor(public config: Irpa_detector_node) {
        RED.nodes.createNode(this, config);
        try {
            this.node = this;
            this.node.status({});
            this.node.on("close", this.onclose);
            this.host = Config.amqp_url;
            this.connect();
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    async connect() {
        try {
            this.node.status({ fill: "blue", shape: "dot", text: "Connecting..." });
            this.con = new amqp_consumer(Logger.instanse, this.host, this.config.queue);
            this.con.OnMessage = this.OnMessage.bind(this);
            await this.con.connect(this.config.noack);
            this.node.status({ fill: "green", shape: "dot", text: "Connected" });
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    async OnMessage(msg: any, ack: any) {
        try {
            var result: any = {};
            result.amqpacknowledgment = ack;

            var data = JSON.parse(msg.content.toString());
            try {
                data.payload = JSON.parse(data.payload);
            } catch (error) {
            }
            result.payload = data.payload;
            result.jwt = data.jwt;
            this.node.send(result);
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    onclose() {
        if (!NoderedUtil.IsNullUndefinded(this.con)) {
            try {
                this.con.close().catch((error) => {
                    Logger.instanse.error(error);
                });
            } catch (error) {
                Logger.instanse.error(error);
            }
        }
    }
}



export interface Irpa_workflow_node {
    queue: string;
    workflow: string;
    localqueue: string;
}
export class rpa_workflow_node {
    public node: Red = null;
    public name: string = "";
    public con: amqp_publisher;
    public host: string = null;
    constructor(public config: Irpa_workflow_node) {
        RED.nodes.createNode(this, config);
        try {
            this.node = this;
            this.node.status({});
            this.node.on("input", this.oninput);
            this.node.on("close", this.onclose);
            this.host = Config.amqp_url;
            this.connect();
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    async connect() {
        try {
            this.node.status({ fill: "blue", shape: "dot", text: "Connecting..." });
            var localqueue = this.config.localqueue;
            if (localqueue !== null && localqueue !== undefined && localqueue !== "") { localqueue = Config.queue_prefix + localqueue; }
            this.con = new amqp_publisher(Logger.instanse, this.host, localqueue);
            this.con.OnMessage = this.OnMessage.bind(this);
            await this.con.connect();
            this.node.status({ fill: "green", shape: "dot", text: "Connected" });
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    async OnMessage(msg: any, ack: any) {
        try {
            var result: any = {};
            result.amqpacknowledgment = ack;
            var json: string = msg.content.toString();
            var data = JSON.parse(json);
            result.jwt = data.jwt;
            var correlationId = msg.properties.correlationId;
            if (correlationId != null && this.messages[correlationId] != null) {
                result = this.messages[correlationId];
                if (data.payload.command == "invokecompleted" || data.payload.command == "invokefailed" || data.payload.command == "invokeaborted" || data.payload.command == "error") {
                    delete this.messages[correlationId];
                }
            }

            if (data.payload.command == "invokecompleted") {
                result.payload = data.payload.data;
                if (result.payload == null || result.payload == undefined) { result.payload = {}; }
                this.node.status({ fill: "green", shape: "dot", text: data.payload.command });
                console.log("********************");
                console.log(result);
                console.log("********************");
                this.node.send(result);
            }
            else if (data.payload.command == "invokefailed" || data.payload.command == "invokeaborted" || data.payload.command == "error") {
                result.payload = data.payload;
                if (result.payload == null || result.payload == undefined) { result.payload = {}; }
                this.node.status({ fill: "red", shape: "dot", text: data.payload.command });
                this.node.send([null, null, result]);
            }
            else {
                result.payload = data.payload;
                if (result.payload == null || result.payload == undefined) { result.payload = {}; }
                this.node.send([null, result]);
            }
            // this.node.send(result);
        } catch (error) {
            this.node.status({});
            NoderedUtil.HandleError(this, error);
        }
    }
    messages: any[] = [];
    async oninput(msg: any) {
        try {
            this.node.status({});
            var correlationId = Math.random().toString(36).substr(2, 9);
            this.messages[correlationId] = msg;
            if (msg.payload == null || typeof msg.payload == "string" || typeof msg.payload == "number") {
                msg.payload = { "data": msg.payload };
            }
            var rpacommand = {
                command: "invoke",
                workflowid: this.config.workflow,
                data: msg.payload
            }
            var data = {
                jwt: msg.jwt,
                payload: rpacommand
            }
            this.node.status({ fill: "blue", shape: "dot", text: "Robot running..." });
            this.con.SendMessage(JSON.stringify(data), this.config.queue, correlationId);
            // var data: any = {};
            // data.payload = msg.payload;
            // data.jwt = msg.jwt;
            // this.con.SendMessage(JSON.stringify(data), this.config.queue);
        } catch (error) {
            NoderedUtil.HandleError(this, error);
            try {
                this.node.status({ fill: "red", shape: "dot", text: error });
            } catch (error) {
            }
        }
    }
    onclose() {
        if (!NoderedUtil.IsNullUndefinded(this.con)) {
            try {
                this.con.close().catch((error) => {
                    Logger.instanse.error(error);
                });
            } catch (error) {
                Logger.instanse.error(error);
            }
        }
    }
}

export async function get_rpa_detectors(req, res) {
    try {
        var rawAssertion = req.user.getAssertionXml();
        var token = await NoderedUtil.GetTokenFromSAML(rawAssertion);
        var result: any[] = await NoderedUtil.Query('openrpa', { _type: "detector" },
            { name: 1 }, { name: -1 }, 1000, 0, token.jwt)
        res.json(result);
    } catch (error) {
        res.status(500).json(error);
    }
}
export async function get_rpa_robots(req, res) {
    try {
        var rawAssertion = req.user.getAssertionXml();
        var token = await NoderedUtil.GetTokenFromSAML(rawAssertion);
        var result: any[] = await NoderedUtil.Query('users', { $or: [{ _type: "user" }, { _type: "role", rparole: true }] },
            { name: 1 }, { name: -1 }, 1000, 0, token.jwt)
        res.json(result);
    } catch (error) {
        res.status(500).json(error);
    }
}
export async function get_rpa_workflows(req, res) {
    try {
        var rawAssertion = req.user.getAssertionXml();
        var token = await NoderedUtil.GetTokenFromSAML(rawAssertion);
        var q: any = { _type: "workflow" };
        if (req.query.queue != null && req.query.queue != undefined && req.query.queue != "" && req.query.queue != "none") {
            // q = {
            //     _type: "workflow",
            //     $or: [
            //         { _createdbyid: req.query.queue },
            //         { _modifiedbyid: req.query.queue },
            //         {
            //             _acl: {
            //                 $elemMatch: {
            //                     rights: { $bitsAllSet: [2] },
            //                     deny: false,
            //                     _id: req.query.queue
            //                 }
            //             }
            //         }
            //     ]
            // };
        }
        var result: any[] = await NoderedUtil.Query('openrpa', q,
            { name: 1 }, { name: -1 }, 1000, 0, token.jwt, req.query.queue)
        res.json(result);
    } catch (error) {
        res.status(500).json(error);
    }
}
