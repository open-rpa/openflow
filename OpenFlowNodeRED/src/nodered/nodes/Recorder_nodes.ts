import * as RED from "node-red";
import { Red } from "node-red";
import { NoderedUtil } from "@openiap/openflow-api";
import { Util } from "./Util";
const pako = require('pako');
const fs = require('fs');
const path = require("path");

export interface irecorder {
    name: string;
    config: any;
    payload: any;
}
export class recorder {
    public node: Red = null;
    public name: string = "";
    public type: string = "recorder";
    constructor() {
    }
    onadd() {
        var routeAuthHandler = RED.auth.needsPermission("flow-recorder.write");
    }
    async oninput(msg: any) {
        try {
            this.node.status({ fill: "blue", shape: "dot", text: "Processing" });
            const payload = await Util.EvaluateNodeProperty<any>(this, msg, "payload");
            this.node.send(msg);
            this.node.status({});
        } catch (error) {
            NoderedUtil.HandleError(this, error, msg);
        }
    }
    async onclose(removed: boolean, done: any) {
        try {
        } catch (error) {
            NoderedUtil.HandleError(this, error, null);
        }
        if (done != null) done();
    }
}

