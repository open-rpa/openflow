import * as RED from "node-red";
import { Red } from "node-red";
import { Logger } from "../../Logger";
import { NoderedUtil } from "@openiap/openflow-api";
import { Util } from "./Util";

export interface iworkitemqueue_config {
    name: string;
    wiq: string;
    wiqid: string;
}
export class workitemqueue_config {
    public node: Red = null;
    public name: string = "";
    public wiq: string = "";
    public wiqid: string = "";
    public credentials: iworkitemqueue_config;
    constructor(public config: iworkitemqueue_config) {
        RED.nodes.createNode(this, config);
        this.node = this;
        this.credentials = this.node.credentials;
        if (this.node.credentials && this.node.credentials.hasOwnProperty("wiq")) {
            this.wiq = this.node.credentials.wiq;
        }
        if (this.node.credentials && this.node.credentials.hasOwnProperty("wiqid")) {
            this.wiqid = this.node.credentials.wiqid;
        }
        this.name = (config.name || this.wiq) || this.wiqid;
    }
}

export interface iaddworkitem {
    name: string;
    config: any;
}
export class addworkitem {
    public node: Red = null;
    public name: string = "";
    private workitemqueue_config: workitemqueue_config;
    constructor(public config: iaddworkitem) {
        RED.nodes.createNode(this, config);
        try {
            this.node = this;
            this.name = config.name;
            this.workitemqueue_config = RED.nodes.getNode(this.config.config);
            this.node.on("close", this.onclose);
            this.node.on("input", this.oninput);
        } catch (error) {
            NoderedUtil.HandleError(this, error, null);
        }
    }
    async oninput(msg: any) {
        try {
            this.node.status({ fill: "blue", shape: "dot", text: "Processing" });
            const collection = await Util.EvaluateNodeProperty<string>(this, msg, "collection");
            let data: any = msg;
            data.payload = msg.data;
            delete data.data;
            this.node.send(data);
            // this.node.send(result);
            this.node.status({ fill: "green", shape: "dot", text: "Connected " });
        } catch (error) {
            NoderedUtil.HandleError(this, error, msg);
        }
    }
    async onclose(removed: boolean, done: any) {
        try {
        } catch (error) {
            Logger.instanse.error(error);
            NoderedUtil.HandleError(this, error, null);
        }
        if (done != null) done();
    }
}


