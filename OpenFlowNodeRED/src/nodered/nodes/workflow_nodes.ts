import * as RED from "node-red";
import { Red } from "node-red";
import { NoderedUtil } from "./NoderedUtil";
import { Logger } from "../../Logger";
import { amqp_consumer } from "../../amqp_consumer";
import { amqp_publisher } from "../../amqp_publisher";
import { Config } from "../../Config";
import { inherits } from "util";

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
        var res = await NoderedUtil.Query("workflow", { "queue": queue }, null, null, 1, 0, null);
        if (res.length == 0) {
            this.workflow = await NoderedUtil.InsertOne("workflow", { _type: "workflow", "queue": queue, "name": this.config.name }, 0, false, null);
        } else {
            this.workflow = res[0];
        }
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
                    target[sourcekey] = this.nestedassign(target[sourcekey], source[sourcekey]);
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
        // Object.keys(source).forEach(sourcekey => {
        //     if (Object.keys(source).find(targetkey => targetkey === sourcekey) !== undefined && typeof source[sourcekey] === "object") {
        //         target[sourcekey] = this.nestedassign(target[sourcekey], source[sourcekey]);
        //     } else {
        //         target[sourcekey] = source[sourcekey];
        //     }
        // });
        return target;
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
            result.values = data.values;
            if (data.payload._id !== null && data.payload._id !== undefined && data.payload._id !== "") {
                var res = await NoderedUtil.Query("workflow_instances", { "_id": data.payload._id }, null, null, 1, 0, data.jwt);
                if (res.length == 0) {
                    NoderedUtil.HandleError(this, "Unknown workflow_instances id " + data.payload._id);
                    return;
                }
                result.name = res[0].name;
                result._id = res[0]._id;
                result._created = res[0]._created;
                result._createdby = res[0]._createdby;
                result._createdbyid = res[0]._createdbyid;
                result._modified = res[0]._modified;
                result._modifiedby = res[0]._modifiedby;
                result._modifiedbyid = res[0]._modifiedbyid;
                result.payload = this.nestedassign(res[0].payload, result.payload.payload);
                result.workflow = this.workflow._id;

                // result = this.nestedassign(res[0], result);
                // result.payload = Object.assign(res[0].payload, result.payload);
                // result = Object.assign(res[0], result);
                // await NoderedUtil._UpdateOne("workflow_instances", null, result, 0, false, data.jwt);
                //result = result.payload;
            } else {
                var queue: string = this.config.queue;
                if (!NoderedUtil.IsNullUndefinded(Config.queue_prefix)) {
                    queue = Config.queue_prefix + this.config.queue;
                }

                var res2 = await NoderedUtil.InsertOne("workflow_instances",
                    { _type: "instance", "queue": queue, "name": this.workflow.name, payload: data.payload, workflow: this.workflow._id }, 1, true, data.jwt);
                //result = Object.assign(res2, result);
                result = this.nestedassign(res2, result);
            }
            result.jwt = data.jwt;


            this.node.send(result);
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
                data.payload._id = msg._id;
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
    public con: amqp_publisher;
    constructor(public config: Iworkflow_out_node) {
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
                msg.state = this.config.state;
                msg.form = this.config.form;
                if (msg.payload === null || msg.payload === undefined) { msg.payload == {}; }
                if (typeof msg.payload === 'string' || msg.payload instanceof String) {
                    msg.payload = { data: msg.payload };
                }

                if (msg._id !== null && msg._id !== undefined && msg._id !== "") {
                    var res = await NoderedUtil._UpdateOne("workflow_instances", null, msg, 1, false, msg.jwt);
                }
                var data: any = {};
                data.state = msg.state;
                if (msg.error) {
                    data.error = "error";
                    if (msg.error.message) {
                        data.error = msg.error.message;
                    }
                }
                //data.error = msg.error;
                data.payload = msg.payload;
                data.values = msg.values;
                data.jwt = msg.jwt;
                data.payload._id = msg._id;
                msg.amqpacknowledgment(JSON.stringify(data));
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
