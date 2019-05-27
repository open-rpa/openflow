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
            this.node.status({ fill: "blue", shape: "dot", text: "Connecting..." });
            this.con = new amqp_consumer(Logger.instanse, this.host, this.config.queue);
            this.con.OnMessage = this.OnMessage.bind(this);
            await this.con.connect(false);
            this.node.status({ fill: "green", shape: "dot", text: "Connected" });
            this.init();
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    async init() {
        var res = await NoderedUtil.Query("workflow", { "queue": this.config.queue }, null, null, 1, 0, null);
        if (res.length == 0) {
            this.workflow = await NoderedUtil.InsertOne("workflow", { _type: "workflow", "queue": this.config.queue, "name": this.config.name }, 0, false, null);
        } else { this.workflow = res[0]; }
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
            if (data._id !== null && data._id !== undefined && data._id !== "") {
                var res = await NoderedUtil.Query("workflow_instances", { "_id": data._id }, null, null, 1, 0, data.jwt);
                if (res.length == 0) {
                    NoderedUtil.HandleError(this, "Unknown workflow_instances id " + data._id);
                    return;
                }
                result = this.nestedassign(res[0], result);
                // result.payload = Object.assign(res[0].payload, result.payload);
                // result = Object.assign(res[0], result);
                await NoderedUtil.UpdateOne("workflow_instances", result, 0, false, data.jwt);
            } else {
                var res2 = this.workflow = await NoderedUtil.InsertOne("workflow_instances",
                    { _type: "instance", "queue": this.config.queue, "name": this.config.name, payload: data.payload }, 0, false, data.jwt);
                //result = Object.assign(res2, result);
                result = this.nestedassign(res2, result);
            }
            result.jwt = data.jwt;


            this.node.send(result);
        } catch (error) {
            NoderedUtil.HandleError(this, error);
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
}
export class workflow_out_node {
    public node: Red = null;
    public name: string = "";
    public con: amqp_publisher;
    constructor(public config: Iworkflow_out_node) {
        RED.nodes.createNode(this, config);
        this.node = this;
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);

    }
    async oninput(msg: any) {
        try {
            this.node.status({});
            if (msg.amqpacknowledgment) {
                msg.state = this.config.state;
                if (msg._id !== null && msg._id !== undefined && msg._id !== "") {
                    var res = await NoderedUtil.UpdateOne("workflow_instances", msg, 0, false, msg.jwt);
                }
                var data: any = {};
                data.payload = msg.payload;
                data.jwt = msg.jwt;
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
