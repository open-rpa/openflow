import * as RED from "node-red";
import { Red } from "node-red";
import { Logger } from "../../Logger";
import { AddWorkitem, MessageWorkitemFile, NoderedUtil, Workitem } from "@openiap/openflow-api";
import { Util } from "./Util";

export interface iworkitemqueue_config {
    name: string;
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
    payload: any;
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
            var conf = RED.nodes.getNode(this.config.config);
            if (conf != null) this.workitemqueue_config = conf.config;
            this.node.on("close", this.onclose);
            this.node.on("input", this.oninput);
        } catch (error) {
            NoderedUtil.HandleError(this, error, null);
        }
    }
    async oninput(msg: any) {
        try {
            this.node.status({ fill: "blue", shape: "dot", text: "Processing" });
            const payload = await Util.EvaluateNodeProperty<any>(this, msg, "payload");
            const files = await Util.EvaluateNodeProperty<MessageWorkitemFile[]>(this, msg, "files");
            const topic = await Util.EvaluateNodeProperty<string>(this, msg, "topic");
            const nextrun = await Util.EvaluateNodeProperty<Date>(this, msg, "nextrun");
            const priority = await Util.EvaluateNodeProperty<number>(this, msg, "priority");
            const { wiq, wiqid } = this.workitemqueue_config;

            const result = await NoderedUtil.AddWorkitem({ payload, files, wiqid, wiq, name: topic, nextrun, priority })
            if (!NoderedUtil.IsNullEmpty(this.config.payload)) {
                Util.SetMessageProperty(msg, this.config.payload, result);
            }
            this.node.send(msg);
            this.node.status({});
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


export interface iaddworkitems {
    name: string;
    config: any;
    payload: any;
}
export class addworkitems {
    public node: Red = null;
    public name: string = "";
    private workitemqueue_config: workitemqueue_config;
    constructor(public config: iaddworkitems) {
        RED.nodes.createNode(this, config);
        try {
            this.node = this;
            this.name = config.name;
            var conf = RED.nodes.getNode(this.config.config);
            if (conf != null) this.workitemqueue_config = conf.config;
            this.node.on("close", this.onclose);
            this.node.on("input", this.oninput);
        } catch (error) {
            NoderedUtil.HandleError(this, error, null);
        }
    }
    async oninput(msg: any) {
        try {
            this.node.status({ fill: "blue", shape: "dot", text: "Processing" });
            const items = await Util.EvaluateNodeProperty<AddWorkitem[]>(this, msg, "workitems");
            const nextrun = await Util.EvaluateNodeProperty<Date>(this, msg, "nextrun");
            const priority = await Util.EvaluateNodeProperty<number>(this, msg, "priority");
            const { wiq, wiqid } = this.workitemqueue_config;
            if (!Array.isArray(items)) throw new Error("workitems must be an array of Workitems")
            items.forEach(item => {
                if (!NoderedUtil.IsNullEmpty(nextrun)) item.nextrun = nextrun;
                if (!NoderedUtil.IsNullEmpty(priority)) item.priority = priority;
            });
            await NoderedUtil.AddWorkitems({ items, wiqid, wiq })
            this.node.send(msg);
            this.node.status({});
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



export interface iupdateworkitem {
    name: string;
    config: any;
    workitem: string;
}
export class updateworkitem {
    public node: Red = null;
    public name: string = "";
    private workitemqueue_config: workitemqueue_config;
    constructor(public config: iupdateworkitem) {
        RED.nodes.createNode(this, config);
        try {
            this.node = this;
            this.name = config.name;
            var conf = RED.nodes.getNode(this.config.config);
            if (conf != null) this.workitemqueue_config = conf.config;
            this.node.on("close", this.onclose);
            this.node.on("input", this.oninput);
        } catch (error) {
            NoderedUtil.HandleError(this, error, null);
        }
    }
    async oninput(msg: any) {
        try {
            this.node.status({ fill: "blue", shape: "dot", text: "Processing" });
            const workitem = await Util.EvaluateNodeProperty<Workitem>(this, msg, "workitem");
            const files = await Util.EvaluateNodeProperty<MessageWorkitemFile[]>(this, msg, "files");
            const state = await Util.EvaluateNodeProperty<string>(this, msg, "state");
            const errormessage = await Util.EvaluateNodeProperty<string>(this, msg, "errormessage");
            const ignoremaxretries = await Util.EvaluateNodeProperty<boolean>(this, msg, "ignoremaxretries");
            var errorsource: string = "";
            const { _id, name, payload } = workitem;
            const result = await NoderedUtil.UpdateWorkitem({ _id, name, files, state, payload, ignoremaxretries, errormessage, errorsource })
            if (!NoderedUtil.IsNullEmpty(this.config.workitem)) {
                Util.SetMessageProperty(msg, this.config.workitem, result);
            }
            this.node.send(msg);
            this.node.status({});
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




export interface ipopworkitem {
    name: string;
    workitem: string;
    config: any;
}
export class popworkitem {
    public node: Red = null;
    public name: string = "";
    private workitemqueue_config: workitemqueue_config;
    constructor(public config: ipopworkitem) {
        RED.nodes.createNode(this, config);
        try {
            this.node = this;
            this.name = config.name;
            var conf = RED.nodes.getNode(this.config.config);
            if (conf != null) this.workitemqueue_config = conf.config;
            this.node.on("close", this.onclose);
            this.node.on("input", this.oninput);
        } catch (error) {
            NoderedUtil.HandleError(this, error, null);
        }
    }
    async oninput(msg: any) {
        try {
            this.node.status({ fill: "blue", shape: "dot", text: "Processing" });
            const { wiq, wiqid } = this.workitemqueue_config;

            const result = await NoderedUtil.PopWorkitem({ wiqid, wiq })
            if (result != null) {
                if (!NoderedUtil.IsNullEmpty(this.config.workitem)) {
                    Util.SetMessageProperty(msg, this.config.workitem, result);
                }
                this.node.send(msg);
                this.node.status({ fill: "green", shape: "dot", text: "successfully popped a Workitem" });
            } else {
                this.node.send([null, msg]);
                this.node.status({ fill: "green", shape: "dot", text: "No more workitems" });
            }
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
