import * as RED from "node-red";
import { Red } from "node-red";
import { NoderedUtil } from "./NoderedUtil";


export interface Iget_pods {
    name: string;
    targetid: string;
}
export class get_pods {
    public node: Red = null;

    constructor(public config: Iget_pods) {
        RED.nodes.createNode(this, config);
        this.node = this;
        this.node.status({});
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }
    async oninput(msg: any) {
        try {
            this.node.status({});
            var targetid = this.config.targetid;
            if (!NoderedUtil.IsNullUndefinded(msg.targetid)) { targetid = msg.targetid; }

            this.node.status({ fill: "blue", shape: "dot", text: "Getting pods" });

            var result = await NoderedUtil.GetNoderedInstance(msg.targetid, null, msg.jwt);
            msg.payload = result;
            this.node.send(msg);
            this.node.status({});
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    onclose() {
    }
}
