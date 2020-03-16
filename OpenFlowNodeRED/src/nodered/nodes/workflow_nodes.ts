import * as RED from "node-red";
import { Red } from "node-red";
import { NoderedUtil } from "./NoderedUtil";
import { Logger } from "../../Logger";
import { amqp_consumer } from "../../amqp_consumer";
import { amqp_publisher } from "../../amqp_publisher";
import { Config } from "../../Config";
import { inherits } from "util";
import { Base } from "../../Base";
import { WebSocketClient } from "../../WebSocketClient";

export interface Iworkflow_in_node {
    queue: string;
    name: string;
    rpa: boolean;
    web: boolean;
}
export class workflow_in_node {
    public node: Red = null;
    public name: string = "";
    public con: amqp_consumer;
    public host: string = null;
    public workflow: any;
    constructor(public config: Iworkflow_in_node) {
        RED.nodes.createNode(this, config);
        try {
            this.node = this;
            this.node.on("close", this.onclose);
            this.host = Config.amqp_url;
            this.connect();
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    async connect() {
        try {
            if (this.config.queue == null || this.config.queue == "") {
                this.node.status({ fill: "red", shape: "dot", text: "Missing queue name" });
                return;
            }
            await this.init();
            this.node.status({ fill: "blue", shape: "dot", text: "Connecting..." });


            var queue: string = this.config.queue;
            if (!NoderedUtil.IsNullUndefinded(Config.queue_prefix)) {
                queue = Config.queue_prefix + this.config.queue;
            }
            this.con = new amqp_consumer(Logger.instanse, this.host, queue);
            this.con.OnMessage = this.OnMessage.bind(this);
            await this.con.connect(false);
            this.node.status({ fill: "green", shape: "dot", text: "Connected" });
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    async init() {
        var queue: string = this.config.queue;
        if (!NoderedUtil.IsNullUndefinded(Config.queue_prefix)) {
            queue = Config.queue_prefix + this.config.queue;
        }
        if (!NoderedUtil.IsNullUndefinded(this.config.name)) {
            this.config.name = this.config.queue;
        }

        var res = await NoderedUtil.Query("workflow", { "queue": queue }, null, null, 1, 0, null);
        if (res.length == 0) {
            var wf: Base = new Base();
            wf._type = "workflow";
            wf.name = this.config.name;
            (wf as any).queue = queue;
            this.workflow = await NoderedUtil.InsertOne("workflow", { _type: "workflow", "queue": queue, "name": this.config.name }, 0, false, null);
        } else {
            this.workflow = res[0];
        }

        var res = await NoderedUtil.Query("users", { "_type": "role", "workflowid": this.workflow._id }, null, null, 1, 0, null);
        var role: Base = null;
        if (res.length == 0) {
            var who = WebSocketClient.instance.user;
            (role as any) = { _type: "role", "name": queue + "users", members: [{ "_id": who._id, "name": who.name }], "workflowid": this.workflow._id };
            role = await NoderedUtil.InsertOne("users", role, 0, false, null);
        } else {
            role = res[0];
        }
        var wf: Base = Base.assign(this.workflow);
        wf.addRight(role._id, role.name, [-1]);
        this.workflow = wf;

        this.workflow.rpa = this.config.rpa;
        this.workflow.web = this.config.web;
        this.workflow = await NoderedUtil._UpdateOne("workflow", null, this.workflow, 0, false, null);
    }
    nestedassign(target, source) {
        if (source === null || source === undefined) return null;
        var keys = Object.keys(source);
        var sourcekey: string = "";
        for (var i = 0; i < keys.length; i++) {
            try {
                sourcekey = keys[i];
                if (Object.keys(source).find(targetkey => targetkey === sourcekey) !== undefined &&
                    Object.keys(source).find(targetkey => targetkey === sourcekey) !== null
                    && typeof source === "object" && typeof source[sourcekey] === "object") {
                    if (target[sourcekey] === undefined || target[sourcekey] === null) {
                        // target[sourcekey] = {};
                    } else {
                        target[sourcekey] = this.nestedassign(target[sourcekey], source[sourcekey]);
                    }
                } else {
                    target[sourcekey] = source[sourcekey];
                }
            } catch (error) {
                if (target != null && target != undefined) Logger.instanse.info(JSON.stringify(target));
                if (source != null && source != undefined) Logger.instanse.info(JSON.stringify(source));
                Logger.instanse.info(sourcekey);
                Logger.instanse.error(error);
            }
        }
        return target;
    }
    async OnMessage(msg: any, ack: any) {
        try {
            this.node.status({ fill: "blue", shape: "dot", text: "Processing" });

            var data = JSON.parse(msg.content.toString());
            try {
                data.payload = JSON.parse(data.payload);
            } catch (error) {
            }

            var _id = data._id;
            if (_id === null || _id === undefined || _id === "") {
                if (data.payload !== null || data.payload !== undefined) {
                    if (data.payload._id !== null && data.payload._id !== undefined && data.payload._id !== "") _id = data.payload._id;
                }
            }
            this.node.status({ fill: "blue", shape: "dot", text: "Processing " + _id });
            if (_id !== null && _id !== undefined && _id !== "") {
                var res = await NoderedUtil.Query("workflow_instances", { "_id": _id }, null, null, 1, 0, data.jwt);
                if (res.length == 0) {
                    NoderedUtil.HandleError(this, "Unknown workflow_instances id " + _id);
                    if (ack !== null && ack !== undefined) ack();
                    return;
                }
                data = Object.assign(res[0], data);
                // result.name = res[0].name;
                // result._id = res[0]._id;
                // result._created = res[0]._created;
                // result._createdby = res[0]._createdby;
                // result._createdbyid = res[0]._createdbyid;
                // result._modified = res[0]._modified;
                // result._modifiedby = res[0]._modifiedby;
                // result._modifiedbyid = res[0]._modifiedbyid;
                // if (data.payload === null || data.payload === undefined) {
                //     result.payload = res[0].payload;
                // } else {
                //     result.payload = Object.assign(res[0].payload, data.payload);
                // }
                // result.workflow = this.workflow._id;
            } else {
                var queue: string = this.config.queue;
                if (!NoderedUtil.IsNullUndefinded(Config.queue_prefix)) {
                    queue = Config.queue_prefix + this.config.queue;
                }

                var res2 = await NoderedUtil.InsertOne("workflow_instances",
                    { _type: "instance", "queue": queue, "name": this.workflow.name, payload: data.payload, workflow: this.workflow._id }, 1, true, data.jwt);

                // OpenFlow Controller.ts needs the id, when creating a new intance !
                data.payload._id = res2._id;
                // result = this.nestedassign(res2, result);
                data = Object.assign(res2, data);
            }
            // var result: any = {};
            // result.amqpacknowledgment = ack;
            // result.payload = data.payload;
            // result.values = data.values;
            // result.jwt = data.jwt;
            data.amqpacknowledgment = ack;

            this.node.send(data);
            // this.node.send(result);
            this.node.status({ fill: "green", shape: "dot", text: "Connected" });
        } catch (error) {
            NoderedUtil.HandleError(this, error);
            try {

                var data: any = {};
                data.error = error;
                data.payload = msg.payload;
                data.jwt = msg.jwt;
                if (data.payload === null || data.payload === undefined) {
                    data.payload = {};
                }
                ack(JSON.stringify(data));
            } catch (error) {
                Logger.instanse.error(error);
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



export interface Iworkflow_out_node {
    state: string;
    form: string;
}
export class workflow_out_node {
    public node: Red = null;
    public name: string = "";
    public host: string = "";
    public con: amqp_publisher;
    constructor(public config: Iworkflow_out_node) {
        RED.nodes.createNode(this, config);
        this.node = this;
        this.host = Config.amqp_url;
        this.node.status({});
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
        this.connect();
    }
    generateUuid(): string {
        return Math.random().toString() +
            Math.random().toString() +
            Math.random().toString();
    }
    async connect() {
        try {
            this.node.status({ fill: "blue", shape: "dot", text: "Connecting..." });
            this.con = new amqp_publisher(Logger.instanse, this.host, this.generateUuid());
            await this.con.connect();
            this.node.status({ fill: "green", shape: "dot", text: "Connected" });
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }

    async oninput(msg: any) {
        try {
            this.node.status({});
            msg.state = this.config.state;
            msg.form = this.config.form;
            //var resultqueue = null
            if (msg._id !== null && msg._id !== undefined && msg._id !== "") {
                // var res = await NoderedUtil.Query("workflow_instances", { "_id": msg._id }, null, null, 1, 0, msg.jwt);
                // if (res.length == 0) {
                //     NoderedUtil.HandleError(this, "Unknown workflow_instances id " + msg._id);
                //     if (msg.amqpacknowledgment) msg.amqpacknowledgment();
                //     return;
                // }
                // resultqueue = res[0].resultqueue;

                // res[0].state = msg.state;
                // res[0].form = msg.form;
                // res[0].payload = msg.payload = msg.payload;
                // var res2 = await NoderedUtil._UpdateOne("workflow_instances", null, res[0], 1, false, msg.jwt);
                var res2 = await NoderedUtil._UpdateOne("workflow_instances", null, msg, 1, false, msg.jwt);

            }
            if (msg.amqpacknowledgment) {
                if (msg.payload === null || msg.payload === undefined) { msg.payload == {}; }
                var data: any = {};
                data.state = msg.state;
                if (msg.error) {
                    data.error = "error";
                    if (msg.error.message) {
                        data.error = msg.error.message;
                    }
                }
                data._id = msg._id;
                data.payload = msg.payload;
                data.values = msg.values;
                data.jwt = msg.jwt;
                msg.amqpacknowledgment(JSON.stringify(data));
            }
            if (!NoderedUtil.IsNullEmpty(msg.resultqueue) && (msg.state == "completed" || msg.state == "failed")) {
                var data: any = {};
                data.state = msg.state;
                if (msg.error) {
                    data.error = "error";
                    if (msg.error.message) {
                        data.error = msg.error.message;
                    }
                }
                data._id = msg._id;
                data.payload = msg.payload;
                data.values = msg.values;
                data.jwt = msg.jwt;

                this.con.SendMessage(JSON.stringify(data), msg.resultqueue, null, false);
            }
            this.node.send(msg);
            this.node.status({});

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

export async function get_workflow_forms(req, res) {
    try {
        var rawAssertion = req.user.getAssertionXml();
        var token = await NoderedUtil.GetTokenFromSAML(rawAssertion);
        var result: any[] = await NoderedUtil.Query('forms', { _type: "form" },
            { name: 1 }, { name: -1 }, 1000, 0, token.jwt)
        res.json(result);
    } catch (error) {
        res.status(500).json(error);
    }
}


export async function get_workflows(req, res) {
    try {
        var rawAssertion = req.user.getAssertionXml();
        var token = await NoderedUtil.GetTokenFromSAML(rawAssertion);
        var q: any = { "_type": "workflow" };
        var ors = [];
        if (!NoderedUtil.IsNullEmpty(req.query.name)) {
            ors.push({ name: { $regex: ".*" + req.query.name + ".*" } });
        } else { ors.push({}); }
        if (!NoderedUtil.IsNullEmpty(req.query.id)) {
            ors.push({ _id: req.query.id });
        }
        if (ors.length > 0) {
            q = {
                $and: [
                    q,
                    { $or: ors }
                ]
            };
        }
        var result: any[] = await NoderedUtil.Query('workflow', q, { name: 1 }, { name: -1 }, 100, 0, token.jwt)
        res.json(result);
    } catch (error) {
        res.status(500).json(error);
    }
}





export interface Irun_workflow_node {
    name: string;
    queue: string;
    state: string;
    targetid: string;
    workflowid: string;
}
export class run_workflow_node {
    public node: Red = null;
    public name: string = "";
    public host: string;
    public con: amqp_consumer;
    constructor(public config: Irun_workflow_node) {
        RED.nodes.createNode(this, config);
        this.node = this;
        this.node.status({});
        if (this.config.queue == null || this.config.queue == "") {
            this.node.status({ fill: "red", shape: "dot", text: "Missing queue name" });
            return;
        }
        this.host = Config.amqp_url;
        this.connect();
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }

    async connect() {
        try {
            this.node.status({ fill: "blue", shape: "dot", text: "Connecting..." });
            var queue: string = this.config.queue;
            if (!NoderedUtil.IsNullUndefinded(Config.queue_prefix)) {
                queue = Config.queue_prefix + this.config.queue;
            }

            this.con = new amqp_consumer(Logger.instanse, this.host, queue);
            this.con.OnMessage = this.OnMessage.bind(this);
            await this.con.connect(true);
            this.node.status({ fill: "green", shape: "dot", text: "Connected" });
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    async OnMessage(msg: any, ack: any) {
        try {
            var result: any = {};
            var data: any = null;
            try {
                data = JSON.parse(msg.content.toString());
            } catch (error) {

            }
            try {
                data.payload = JSON.parse(data.payload);
            } catch (error) {
            }
            delete data.jwt;
            var _id = data._id;
            if (_id === null || _id === undefined || _id === "") {
                if (data.payload !== null || data.payload !== undefined) {
                    if (data.payload._id !== null && data.payload._id !== undefined && data.payload._id !== "") _id = data.payload._id;
                }
            }
            if (_id !== null && _id !== undefined && _id !== "") {
                var res = await NoderedUtil.Query("workflow_instances", { "_id": _id }, { parentid: 1 }, null, 1, 0, data.jwt);
                if (res.length == 0) {
                    NoderedUtil.HandleError(this, "Unknown workflow_instances id " + _id);
                    if (ack !== null && ack !== undefined) ack();
                    return;
                }
                var _parentid = res[0].parentid;
                if (_parentid !== null && _parentid !== undefined && _parentid !== "") {
                    res = await NoderedUtil.Query("workflow_instances", { "_id": _parentid }, null, null, 1, 0, data.jwt);
                    if (res.length == 0) {
                        NoderedUtil.HandleError(this, "Unknown workflow_instances parentid " + _id);
                        if (ack !== null && ack !== undefined) ack();
                        return;
                    }

                    result = res[0];
                    result.payload = data.payload;

                    this.node.send([null, result]); // ???? why does this not work ?????
                    // this.node.send([null, null, result]);
                    if (ack !== null && ack !== undefined) ack();
                    return;
                }
            }

            result.payload = data.payload;
            // result.jwt = data.jwt;
            this.node.send([null, result]); // ???? why does this not work ?????
            // this.node.send([null, null, result]);
            if (ack !== null && ack !== undefined) ack();
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    async oninput(msg: any) {
        try {
            var resultqueue: string = this.config.queue;
            if (!NoderedUtil.IsNullUndefinded(Config.queue_prefix)) {
                resultqueue = Config.queue_prefix + this.config.queue;
            }
            var jwt = msg.jwt;
            var workflowid = msg.workflowid;
            if (NoderedUtil.IsNullEmpty(workflowid)) workflowid = this.config.workflowid;
            var state = msg.state;
            if (NoderedUtil.IsNullEmpty(state)) state = this.config.state;

            var name = msg.name;
            if (NoderedUtil.IsNullEmpty(name)) name = this.config.name;
            if (NoderedUtil.IsNullEmpty(name)) name = this.config.queue;
            var targetid = msg.targetid;
            if (NoderedUtil.IsNullEmpty(targetid)) targetid = this.config.targetid;

            if (NoderedUtil.IsNullEmpty(targetid)) {
                this.node.status({ fill: "red", shape: "dot", text: "targetid is mandatory" });
                return;
            }
            if (NoderedUtil.IsNullEmpty(workflowid)) {
                this.node.status({ fill: "red", shape: "dot", text: "workflowid is mandatory" });
                return;
            }

            var workflow: any = null;
            var res = await NoderedUtil.Query("workflow", { "_id": workflowid }, null, null, 1, 0, null);
            if (res.length == 1) {
                workflow = res[0];
            }
            if (workflow == null) {
                this.node.status({ fill: "red", shape: "dot", text: "Unknown workflow " + workflowid });
                return;
            }
            var _id = msg._id;
            var queue: string = workflow.queue;
            delete msg._id;
            msg._type = "instance";
            msg.queue = resultqueue;
            msg.name = "runner: " + name;
            msg.state = "pending";
            var res3 = await NoderedUtil.InsertOne("workflow_instances", msg, 1, true, jwt);
            msg._parentid = res3._id;

            name = name + " => " + workflow.name;
            var _res2data = new Base();
            _res2data.addRight(targetid, "targetid", [-1]);
            _res2data._type = "instance";
            _res2data.name = name;
            (_res2data as any).queue = queue;
            (_res2data as any).resultqueue = resultqueue;
            (_res2data as any).parentid = res3._id;
            (_res2data as any).payload = msg.payload;
            (_res2data as any).workflow = workflowid;
            (_res2data as any).state = "new";

            var res2 = await NoderedUtil.InsertOne("workflow_instances", _res2data, 1, true, jwt);
            msg.newinstanceid = res2._id;
            var message = { _id: res2._id };

            this.con.SendMessage(JSON.stringify(message), queue, null, false);

            msg._id = _id;

            this.node.send(msg);
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