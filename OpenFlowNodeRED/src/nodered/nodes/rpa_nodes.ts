import * as RED from "node-red";
import { Red } from "node-red";
import { Config } from "../../Config";
import { WebSocketClient, NoderedUtil, QueueMessage } from "@openiap/openflow-api";
import { Logger } from "../../Logger";

export interface Irpa_detector_node {
    queue: string;
    name: string;
}
export class rpa_detector_node {
    public node: Red = null;
    public name: string = "";
    public host: string = null;
    public localqueue: string = "";
    private _onsignedin: any = null;
    private _onsocketclose: any = null;
    constructor(public config: Irpa_detector_node) {
        RED.nodes.createNode(this, config);
        try {
            this.node = this;
            this.name = config.name;
            this.node.status({});
            this.node.on("close", this.onclose);
            this.host = Config.amqp_url;
            this._onsignedin = this.onsignedin.bind(this);
            this._onsocketclose = this.onsocketclose.bind(this);
            WebSocketClient.instance.events.on("onsignedin", this._onsignedin);
            WebSocketClient.instance.events.on("onclose", this._onsocketclose);
            if (WebSocketClient.instance.isConnected && WebSocketClient.instance.user != null) {
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
    async connect() {
        try {
            this.node.status({ fill: "blue", shape: "dot", text: "Connecting..." });
            Logger.instanse.info("track::rpa detector node in::connect");

            this.localqueue = await NoderedUtil.RegisterQueue(WebSocketClient.instance, this.config.queue, (msg: QueueMessage, ack: any) => {
                this.OnMessage(msg, ack);
            });
            this.node.status({ fill: "green", shape: "dot", text: "Connected" });
        } catch (error) {
            NoderedUtil.HandleError(this, error, null);
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
            NoderedUtil.HandleError(this, error, msg);
        }
    }
    async onclose(removed: boolean, done: any) {
        if (!NoderedUtil.IsNullEmpty(this.localqueue) && removed) {
            NoderedUtil.CloseQueue(WebSocketClient.instance, this.localqueue);
            this.localqueue = "";
        }
        WebSocketClient.instance.events.removeListener("onsignedin", this._onsignedin);
        WebSocketClient.instance.events.removeListener("onclose", this._onsocketclose);
        if (done != null) done();
    }
}



export interface Irpa_workflow_node {
    queue: string;
    workflow: string;
    localqueue: string;
    name: string;
}
export class rpa_workflow_node {
    public node: Red = null;
    public name: string = "";
    public host: string = null;
    private localqueue: string = "";
    private _onsignedin: any = null;
    private _onsocketclose: any = null;
    private originallocalqueue: string = "";
    constructor(public config: Irpa_workflow_node) {
        RED.nodes.createNode(this, config);
        try {
            this.node = this;
            this.node.status({});
            this.name = config.name;
            this.node.on("input", this.oninput);
            this.node.on("close", this.onclose);
            this.host = Config.amqp_url;
            this._onsignedin = this.onsignedin.bind(this);
            this._onsocketclose = this.onsocketclose.bind(this);
            if (NoderedUtil.IsNullEmpty(this.config.localqueue)) this.config.localqueue = Math.random().toString(36).substr(2, 9);

            WebSocketClient.instance.events.on("onsignedin", this._onsignedin);
            WebSocketClient.instance.events.on("onclose", this._onsocketclose);
            if (!NoderedUtil.IsNullEmpty(this.originallocalqueue) || this.originallocalqueue != this.config.localqueue) {
                this.connect();
            } else if (WebSocketClient.instance.isConnected && WebSocketClient.instance.user != null) {
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
    async connect() {
        try {
            this.node.status({ fill: "blue", shape: "dot", text: "Connecting..." });
            this.localqueue = this.config.localqueue;
            this.localqueue = await NoderedUtil.RegisterQueue(WebSocketClient.instance, this.localqueue, (msg: QueueMessage, ack: any) => {
                this.OnMessage(msg, ack);
            });
            this.node.status({ fill: "green", shape: "dot", text: "Connected " + this.localqueue });

        } catch (error) {
            NoderedUtil.HandleError(this, error, null);
        }
    }
    async OnMessage(msg: any, ack: any) {
        try {
            let result: any = {};

            const correlationId = msg.correlationId;
            if (msg.data && !msg.payload) {
                msg.payload = msg.data;
                delete msg.data;
            }
            if (msg.payload.data) {
                msg = msg.payload;
                msg.payload = msg.data;
                delete msg.data;
            }
            const data = msg;
            let command = data.command;
            if (command == undefined && data.data != null && data.data.command != null) { command = data.data.command; }
            if (correlationId != null && this.messages[correlationId] != null) {
                result = Object.assign({}, this.messages[correlationId]);
                if (command == "invokecompleted" || command == "invokefailed" || command == "invokeaborted" || command == "error" || command == "timeout") {
                    delete this.messages[correlationId];
                }
            } else {
                result.jwt = data.jwt;
            }
            if (command == "invokecompleted") {
                result.payload = data.payload;
                if (data.user != null) result.user = data.user;
                if (result.payload == null || result.payload == undefined) { result.payload = {}; }
                this.node.status({ fill: "green", shape: "dot", text: command + "  " + this.localqueue });
                result.id = correlationId;
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
                if (data.user != null) result.user = data.user;
                if (result.payload == null || result.payload == undefined) { result.payload = {}; }
                this.node.status({ fill: "red", shape: "dot", text: command + "  " + this.localqueue });
                result.id = correlationId;
                this.node.send([null, null, result]);
            }
            else {
                result.payload = data.payload;
                if (data.user != null) result.user = data.user;
                if (result.payload == null || result.payload == undefined) { result.payload = {}; }
                result.id = correlationId;
                this.node.send([null, result]);
            }
            ack();
        } catch (error) {
            this.node.status({});
            NoderedUtil.HandleError(this, error, msg);
        }
    }
    messages: any[] = [];
    async oninput(msg: any) {
        try {
            this.node.status({});
            let targetid = NoderedUtil.IsNullEmpty(this.config.queue) || this.config.queue === 'none' ? msg.targetid : this.config.queue;
            let workflowid = NoderedUtil.IsNullEmpty(this.config.workflow) ? msg.workflowid : this.config.workflow;
            const correlationId = msg.id || Math.random().toString(36).substr(2, 9);
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
            const rpacommand = {
                command: "invoke",
                workflowid: workflowid,
                jwt: msg.jwt,
                // Adding expiry to the rpacommand as a timestamp for when the RPA message is expected to timeout from the message queue
                // Currently set to 20 seconds into the future
                expiry: Math.floor((new Date().getTime()) / 1000) + Config.amqp_message_ttl,
                data: { payload: msg.payload }
            }
            const expiration: number = (typeof msg.expiration == 'number' ? msg.expiration : Config.amqp_workflow_out_expiration);
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
        if ((!NoderedUtil.IsNullEmpty(this.localqueue) && removed) || this.originallocalqueue != this.config.localqueue) {
            NoderedUtil.CloseQueue(WebSocketClient.instance, this.localqueue);
            this.localqueue = "";
        }
        WebSocketClient.instance.events.removeListener("onsignedin", this._onsignedin);
        WebSocketClient.instance.events.removeListener("onclose", this._onsocketclose);
        if (done != null) done();
    }
}

export async function get_rpa_detectors(req, res) {
    try {
        const rawAssertion = req.user.getAssertionXml();
        const token = await NoderedUtil.GetTokenFromSAML(rawAssertion);
        const result: any[] = await NoderedUtil.Query('openrpa', { _type: "detector" },
            { name: 1 }, { name: -1 }, 1000, 0, token.jwt)
        res.json(result);
    } catch (error) {
        res.status(500).json(error);
    }
}
export async function get_rpa_robots(req, res) {
    try {
        const rawAssertion = req.user.getAssertionXml();
        const token = await NoderedUtil.GetTokenFromSAML(rawAssertion);
        const result: any[] = await NoderedUtil.Query('users', { $or: [{ _type: "user" }, { _type: "role", rparole: true }] },
            { name: 1 }, { name: -1 }, 1000, 0, token.jwt)
        res.json(result);
    } catch (error) {
        res.status(500).json(error);
    }
}
export async function get_rpa_workflows(req, res) {
    try {
        const rawAssertion = req.user.getAssertionXml();
        const token = await NoderedUtil.GetTokenFromSAML(rawAssertion);
        const q: any = { _type: "workflow" };
        const result: any[] = await NoderedUtil.Query('openrpa', q,
            { name: 1, projectandname: 1 }, { projectid: -1, name: -1 }, 1000, 0, token.jwt, req.query.queue)
        res.json(result);
    } catch (error) {
        res.status(500).json(error);
    }
}
