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
            this.con = new amqp_consumer(Logger.instanse, this.host, this.config.queue);
            this.con.OnMessage = this.OnMessage.bind(this);
            await this.con.connect(false);
            this.node.status({ fill: "green", shape: "dot", text: "Connected" });
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    async init() {
        var res = await NoderedUtil.Query("workflow", { "queue": this.config.queue }, null, null, 1, 0, null);
        if (res.length == 0) {
            this.workflow = await NoderedUtil.InsertOne("workflow", { _type: "workflow", "queue": this.config.queue, "name": this.config.name }, 0, false, null);
        } else {
            this.workflow = res[0];
        }
        this.workflow.rpa = this.config.rpa;
        this.workflow.web = this.config.web;
        this.workflow = await NoderedUtil._UpdateOne("workflow", null, this.workflow, 0, false, null);
    }
    nestedassign(target, source) {
        Object.keys(source).forEach(sourcekey => {
            if (Object.keys(source).find(targetkey => targetkey === sourcekey) !== undefined && typeof source[sourcekey] === "object") {
                target[sourcekey] = this.nestedassign(target[sourcekey], source[sourcekey]);
            } else {
                target[sourcekey] = source[sourcekey];
            }
        });
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

                // result = this.nestedassign(res[0], result);
                // result.payload = Object.assign(res[0].payload, result.payload);
                // result = Object.assign(res[0], result);
                // await NoderedUtil._UpdateOne("workflow_instances", null, result, 0, false, data.jwt);
                //result = result.payload;
            } else {
                var res2 = await NoderedUtil.InsertOne("workflow_instances",
                    { _type: "instance", "queue": this.config.queue, "name": this.workflow.name, payload: data.payload, workflow: this.workflow._id }, 1, true, data.jwt);
                //result = Object.assign(res2, result);
                result = this.nestedassign(res2, result);
            }
            result.jwt = data.jwt;


            this.node.send(result);
        } catch (error) {
            NoderedUtil.HandleError(this, error);
            try {
                msg.error = error;
                ack(JSON.stringify(msg));
            } catch (error) {

            }
        }
    }
    onclose() {
        if (!NoderedUtil.IsNullUndefinded(this.con)) {
            this.con.close();
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
                data.payload = msg.payload;
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
    var token = await NoderedUtil.GetToken(null, null);
    var result: any[] = await NoderedUtil.Query('forms', { _type: "form" },
        { name: 1 }, { name: -1 }, 1000, 0, token.jwt)
    res.json(result);
}
