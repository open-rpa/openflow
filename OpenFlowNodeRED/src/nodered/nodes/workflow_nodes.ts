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
import { Rolemember, Role } from "../../Message";

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
            var noderedadmins = await NoderedUtil.GetRole(null, Config.noderedadmins);
            var wf: Base = new Base();
            wf._type = "workflow";
            wf.name = this.config.name;
            (wf as any).queue = queue;
            if (noderedadmins != null) {
                wf.addRight(noderedadmins._id, noderedadmins.name, [-1]);
            }
            this.workflow = await NoderedUtil.InsertOne("workflow", { _type: "workflow", "queue": queue, "name": this.config.name }, 0, false, null);
        } else {
            this.workflow = res[0];
            var hasnoderedadmins = this.workflow._acl.filter(x => x.name == Config.noderedadmins);
            if (hasnoderedadmins.length == 0) {
                var noderedadmins = await NoderedUtil.GetRole(null, Config.noderedadmins);
                if (noderedadmins != null) {
                    var wf: Base = Base.assign(this.workflow);
                    wf.addRight(noderedadmins._id, noderedadmins.name, [-1]);
                    this.workflow = wf;
                }
            }

        }

        var res = await NoderedUtil.Query("users", { "_type": "role", "$or": [{ "workflowid": this.workflow._id }, { "name": queue + "users" }] }, null, null, 1, 0, null);
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
        this.workflow.queue = queue;
        this.workflow.name = this.config.name;
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
                if (data.payload !== null && data.payload !== undefined) {
                    if (data.payload._id !== null && data.payload._id !== undefined && data.payload._id !== "") _id = data.payload._id;
                }
            }
            this.node.status({ fill: "blue", shape: "dot", text: "Processing " + _id });
            console.log(data);
            if (_id !== null && _id !== undefined && _id !== "") {

                var jwt = data.jwt;
                delete data.jwt;

                var res = await NoderedUtil.Query("workflow_instances", { "_id": _id }, null, null, 1, 0, jwt);
                if (res.length == 0) {
                    NoderedUtil.HandleError(this, "Unknown workflow_instances id " + _id);
                    if (ack !== null && ack !== undefined) ack();
                    return;
                }
                if (res[0].payload === null || res[0].payload === undefined) {
                    res[0].payload = data;
                    data = res[0];
                } else {
                    res[0].payload = Object.assign(res[0].payload, data);
                    data = res[0];
                }
                data.jwt = jwt;
                // console.log(data.payload);
                // data = Object.assign(res[0], { payload: data });
                // Logger.instanse.info("workflow in activated id " + data._id);
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

                var who = WebSocketClient.instance.user;

                var jwt = data.jwt;
                delete data.jwt;
                var who = WebSocketClient.instance.user;
                var item: Base = ({ _type: "instance", "queue": queue, "name": this.workflow.name, payload: data, workflow: this.workflow._id, targetid: who._id }) as any;
                item = Base.assign(item);
                item.addRight(who._id, who.name, [-1]);
                var res2 = await NoderedUtil.InsertOne("workflow_instances", item, 1, true, jwt);

                // Logger.instanse.info("workflow in activated creating a new workflow instance with id " + res2._id);
                // OpenFlow Controller.ts needs the id, when creating a new intance !
                data._id = res2._id;
                if (data.payload !== null && data.payload != undefined) {
                    try {
                        data.payload._id = res2._id;
                    } catch (error) {
                        Logger.instanse.warn(error);
                    }
                }
                // result = this.nestedassign(res2, result);
                data = Object.assign(res2, data);
                data.jwt = jwt;
            }
            // var result: any = {};
            // result.amqpacknowledgment = ack;
            // result.payload = data.payload;
            // result.values = data.values;
            // result.jwt = data.jwt;
            data.amqpacknowledgment = ack;
            data._replyTo = msg.properties.replyTo;
            data._correlationId = msg.properties.correlationId;

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
            if (msg._id !== null && msg._id !== undefined && msg._id !== "") {
                // Logger.instanse.info("Updating workflow instance with id " + msg._id + " (" + msg.name + " with state " + msg.state);
                var res2 = await NoderedUtil._UpdateOne("workflow_instances", null, msg, 1, false, msg.jwt);
            }
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
        try {
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

                this.con.SendMessage(JSON.stringify(data), msg.resultqueue, msg.correlationId, false);
            }
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
        try {
            if (!NoderedUtil.IsNullEmpty(msg._replyTo)) {
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
                this.con.SendMessage(JSON.stringify(data), msg._replyTo, msg._correlationId, false);
            }
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
        try {
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
        } catch (error) {
            NoderedUtil.HandleError(this, error);
            return;
        }
        this.node.send(msg);
        this.node.status({});
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





export interface Iassign_workflow_node {
    name: string;
    queue: string;
    targetid: string;
    workflowid: string;
    initialrun: boolean;
}
export class assign_workflow_node {
    public node: Red = null;
    public name: string = "";
    public host: string;
    public con: amqp_consumer;
    constructor(public config: Iassign_workflow_node) {
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


            if (!NoderedUtil.IsNullUndefinded(this.config.targetid) && !NoderedUtil.IsNullUndefinded(this.config.workflowid)) {
                var res = await NoderedUtil.Query("users", { "_type": "role", "workflowid": this.config.workflowid }, null, null, 1, 0, null);
                var role: Role = null;
                if (res.length == 1) {
                    role = res[0];
                    var exists = role.members.filter(x => x._id == this.config.targetid);
                    if (exists.length == 0) {
                        role.members.push(new Rolemember("target", this.config.targetid));
                        await NoderedUtil._UpdateOne("users", null, role, 1, true, null);
                    }
                }
            }
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
            if (data.state == "idle") return;
            // delete data.jwt;
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
                var state = res[0].state;
                var _parentid = res[0].parentid;
                if (_parentid !== null && _parentid !== undefined && _parentid !== "") {
                    res = await NoderedUtil.Query("workflow_instances", { "_id": _parentid }, null, null, 1, 0, null);
                    if (res.length == 0) {
                        NoderedUtil.HandleError(this, "Unknown workflow_instances parentid " + _id);
                        if (ack !== null && ack !== undefined) ack();
                        return;
                    }

                    res[0].state = state;
                    result = res[0].msg;
                    result.payload = data.payload;
                    this.node.send([null, result]);
                    if (ack !== null && ack !== undefined) ack();
                    await NoderedUtil._UpdateOne("workflow_instances", null, res[0], 1, false, null);
                    return;
                }
            }
            result.payload = data.payload;
            // result.jwt = data.jwt;
            this.node.send([null, result]);
            if (ack !== null && ack !== undefined) ack();
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    async oninput(msg: any) {
        try {
            this.node.status({ fill: "blue", shape: "dot", text: "Processing" });
            var resultqueue: string = this.config.queue;
            if (!NoderedUtil.IsNullUndefinded(Config.queue_prefix)) {
                resultqueue = Config.queue_prefix + this.config.queue;
            }
            var jwt = msg.jwt;
            var workflowid = this.config.workflowid;
            if (NoderedUtil.IsNullEmpty(workflowid)) workflowid = msg.workflowid;

            var name = this.config.name;
            if (NoderedUtil.IsNullEmpty(name)) name = msg.name;
            if (NoderedUtil.IsNullEmpty(name)) name = this.config.queue;
            var targetid = this.config.targetid;
            if (NoderedUtil.IsNullEmpty(targetid)) targetid = msg.targetid;

            if (NoderedUtil.IsNullEmpty(targetid)) {
                this.node.status({ fill: "red", shape: "dot", text: "targetid is mandatory" });
                return;
            }
            if (NoderedUtil.IsNullEmpty(workflowid)) {
                this.node.status({ fill: "red", shape: "dot", text: "workflowid is mandatory" });
                return;
            }
            if (NoderedUtil.IsNullEmpty(jwt)) {
                var i: WebSocketClient = WebSocketClient.instance;
                jwt = i.jwt;
            }
            var initialrun = this.config.initialrun;
            if (!NoderedUtil.IsNullEmpty(msg.initialrun)) {
                initialrun = msg.initialrun;
            }


            msg.jwt = (await NoderedUtil.RenewToken(jwt, true)).jwt;
            // Logger.instanse.info("run workflow called with id " + msg._id + " (" + msg.name + ")");
            var runnerinstance = new Base();
            runnerinstance._type = "instance";
            runnerinstance.name = "runner: " + name;
            (runnerinstance as any).queue = resultqueue;
            (runnerinstance as any).state = "idle";
            (runnerinstance as any).msg = msg;
            (runnerinstance as any).jwt = msg.jwt;
            // Logger.instanse.info("**************************************");
            var res3 = await NoderedUtil.InsertOne("workflow_instances", runnerinstance, 1, true, jwt);
            // Logger.instanse.info("created runner instance with id " + res3._id + " (" + res3.name + ")");
            msg._parentid = res3._id;

            msg.newinstanceid = await NoderedUtil.CreateWorkflowInstance(targetid, workflowid, null, resultqueue, res3._id, msg.payload, initialrun, jwt);;

            this.node.send(msg);
            this.node.status({ fill: "green", shape: "dot", text: "Connected" });
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