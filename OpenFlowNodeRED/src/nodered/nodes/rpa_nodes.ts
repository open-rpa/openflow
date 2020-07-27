import * as RED from "node-red";
import { Red } from "node-red";
import { Config } from "../../Config";
import { WebSocketClient, NoderedUtil, QueueMessage } from "openflow-api";

export interface Irpa_detector_node {
    queue: string;
}
export class rpa_detector_node {
    public node: Red = null;
    public name: string = "";
    public host: string = null;
    public localqueue: string = "";
    constructor(public config: Irpa_detector_node) {
        RED.nodes.createNode(this, config);
        try {
            this.node = this;
            this.node.status({});
            this.node.on("close", this.onclose);
            this.host = Config.amqp_url;
            WebSocketClient.instance.events.on("onsignedin", () => {
                this.connect();
            });
            WebSocketClient.instance.events.on("onclose", (message) => {
                if (message == null) message = "";
                this.node.status({ fill: "red", shape: "dot", text: "Disconnected " + message });
                this.onclose(false, null);
            });
            this.connect();
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    async connect() {
        try {
            this.node.status({ fill: "blue", shape: "dot", text: "Connecting..." });

            this.localqueue = await NoderedUtil.RegisterQueue(WebSocketClient.instance, this.config.queue, (msg: QueueMessage, ack: any) => {
                this.OnMessage(msg, ack);
            });
            this.node.status({ fill: "green", shape: "dot", text: "Connected" });
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    async OnMessage(msg: any, ack: any) {
        try {
            if (msg.data && !msg.payload) {
                msg.payload = msg.data;
                delete msg.data;
            }
            if (msg.payload.data) {
                msg = msg.payload;
                msg.payload = msg.data;
                delete msg.data;
            }
            try {
                if (typeof msg.payload == "string") {
                    msg.payload = JSON.parse(msg.payload);
                }
            } catch (error) {
            }
            this.node.send(msg);
            ack();
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    async onclose(removed: boolean, done: any) {
        if (!NoderedUtil.IsNullEmpty(this.localqueue) && removed) {
            NoderedUtil.CloseQueue(WebSocketClient.instance, this.localqueue);
            this.localqueue = "";
        }
        if (done != null) done();
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
    public host: string = null;
    private localqueue: string = "";
    constructor(public config: Irpa_workflow_node) {
        RED.nodes.createNode(this, config);
        try {
            this.node = this;
            this.node.status({});
            this.node.on("input", this.oninput);
            this.node.on("close", this.onclose);
            this.host = Config.amqp_url;
            WebSocketClient.instance.events.on("onsignedin", () => {
                this.connect();
            });
            WebSocketClient.instance.events.on("onclose", (message) => {
                if (message == null) message = "";
                this.node.status({ fill: "red", shape: "dot", text: "Disconnected " + message });
                this.onclose(false, null);
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
            this.localqueue = await NoderedUtil.RegisterQueue(WebSocketClient.instance, this.localqueue, (msg: QueueMessage, ack: any) => {
                this.OnMessage(msg, ack);
            });
            this.node.status({ fill: "green", shape: "dot", text: "Connected " + this.localqueue });

        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    async OnMessage(msg: any, ack: any) {
        try {
            var result: any = {};

            var correlationId = msg.correlationId;
            if (msg.data && !msg.payload) {
                msg.payload = msg.data;
                delete msg.data;
            }
            if (msg.payload.data) {
                msg = msg.payload;
                msg.payload = msg.data;
                delete msg.data;
            }
            var data = msg;
            var command = data.command;
            if (command == undefined && data.data != null && data.data.command != null) { command = data.data.command; }
            // result.jwt = data.jwt;


            if (correlationId != null && this.messages[correlationId] != null) {
                // result = new Object(this.messages[correlationId]);
                result = Object.assign({}, this.messages[correlationId]);
                if (command == "invokecompleted" || command == "invokefailed" || command == "invokeaborted" || command == "error" || command == "timeout") {
                    delete this.messages[correlationId];
                }
            } else {
                result.jwt = data.jwt;
            }
            if (command == "invokecompleted") {
                result.payload = data.payload;
                // if (!NoderedUtil.IsNullEmpty(data.jwt)) { result.jwt = data.jwt; }
                if (data.user != null) result.user = data.user;
                if (result.payload == null || result.payload == undefined) { result.payload = {}; }
                this.node.status({ fill: "green", shape: "dot", text: command + "  " + this.localqueue });
                this.node.send(result);
            }
            else if (command == "invokefailed" || command == "invokeaborted" || command == "error" || command == "timeout") {
                result.payload = data.payload;
                result.error = data.payload;
                if (command == "timeout") {
                    result.error = "request timed out, no robot picked up the message in a timely fashion";
                }
                if (result.error != null && result.error.Message != null && result.error.Message != "") {
                    result.error = result.error.Message;
                }
                // if (!NoderedUtil.IsNullEmpty(data.jwt)) { result.jwt = data.jwt; }
                if (data.user != null) result.user = data.user;
                if (result.payload == null || result.payload == undefined) { result.payload = {}; }
                this.node.status({ fill: "red", shape: "dot", text: command + "  " + this.localqueue });
                this.node.send([null, null, result]);
            }
            else {
                result.payload = data.payload;
                // if (!NoderedUtil.IsNullEmpty(data.jwt)) { result.jwt = data.jwt; }
                if (data.user != null) result.user = data.user;
                if (result.payload == null || result.payload == undefined) { result.payload = {}; }
                this.node.send([null, result]);
            }
            ack();
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
            let targetid = NoderedUtil.IsNullEmpty(this.config.queue) || this.config.queue === 'none' ? msg.targetid : this.config.queue;
            let workflowid = NoderedUtil.IsNullEmpty(this.config.workflow) ? msg.workflowid : this.config.workflow;
            var correlationId = Math.random().toString(36).substr(2, 9);
            this.messages[correlationId] = msg;
            if (msg.payload == null || typeof msg.payload == "string" || typeof msg.payload == "number") {
                msg.payload = { "data": msg.payload };
            }
            if (NoderedUtil.IsNullEmpty(targetid)) {
                this.node.status({ fill: "red", shape: "dot", text: "robot is mandatory" });
                return;
            }
            if (NoderedUtil.IsNullEmpty(workflowid)) {
                this.node.status({ fill: "red", shape: "dot", text: "workflow is mandatory" });
                return;
            }
            var rpacommand = {
                command: "invoke",
                workflowid: workflowid,
                jwt: msg.jwt,
                // Adding expiry to the rpacommand as a timestamp for when the RPA message is expected to timeout from the message queue
                // Currently set to 20 seconds into the future
                expiry: Math.floor((new Date().getTime()) / 1000) + Config.amqp_message_ttl,
                data: { payload: msg.payload }
            }
            var expiration: number = Config.amqp_workflow_out_expiration;
            if (!NoderedUtil.IsNullEmpty(msg.expiration)) {
                expiration = msg.expiration;
            }
            // this.con.SendMessage(JSON.stringify(rpacommand), targetid, correlationId, true);
            await NoderedUtil.QueueMessage(WebSocketClient.instance, targetid, this.localqueue, rpacommand, correlationId, expiration);
            this.node.status({ fill: "blue", shape: "dot", text: "Robot running " + this.localqueue });
        } catch (error) {
            // NoderedUtil.HandleError(this, error);
            try {
                this.node.status({ fill: "red", shape: "dot", text: error });
                msg.error = error;
                this.node.send([null, null, msg]);
            } catch (error) {
            }
        }
    }
    async onclose(removed: boolean, done: any) {
        if (!NoderedUtil.IsNullEmpty(this.localqueue) && removed) {
            NoderedUtil.CloseQueue(WebSocketClient.instance, this.localqueue);
            this.localqueue = "";
        }
        if (done != null) done();
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
        var result: any[] = await NoderedUtil.Query('openrpa', q,
            { name: 1, projectandname: 1 }, { projectid: -1, name: -1 }, 1000, 0, token.jwt, req.query.queue)
        res.json(result);
    } catch (error) {
        res.status(500).json(error);
    }
}
