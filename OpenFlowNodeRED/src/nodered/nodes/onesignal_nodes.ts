import * as RED from "node-red";
import { Red } from "node-red";
import * as request from "request";
import { NoderedUtil } from "@openiap/openflow-api";

export interface Ionesignal_credentials {
    name: string;
}
export class onesignal_credentials {
    public node: Red = null;
    public name: string = "";
    public restKey: string = "";
    public appID: string = "";
    constructor(public config: Ionesignal_credentials) {
        RED.nodes.createNode(this, config);
        this.node = this;
        this.name = config.name;
        this.node.status({});
        if (this.node.credentials && this.node.credentials.hasOwnProperty("restKey")) {
            this.restKey = this.node.credentials.restKey;
        }
        if (this.node.credentials && this.node.credentials.hasOwnProperty("appID")) {
            this.appID = this.node.credentials.appID;
        }
    }
}

export interface Icreate_notification {
    config: any;
    contents: string;
    url: string;
    customurl: string;
    included_segments: string | string[];
    excluded_segments: string | string[];
    include_player_ids: string | string[];
    name: string;
}
export class create_notification {
    public node: Red = null;
    public name: string = "";
    public restKey: string;
    public appID: string;
    constructor(public config: Icreate_notification) {
        RED.nodes.createNode(this, config);
        try {
            this.node = this;
            this.name = config.name;
            this.node.status({});
            const _config: onesignal_credentials = RED.nodes.getNode(this.config.config);
            if (!NoderedUtil.IsNullUndefinded(_config) && !NoderedUtil.IsNullEmpty(_config.restKey)) {
                this.restKey = _config.restKey;
            }
            if (!NoderedUtil.IsNullUndefinded(_config) && !NoderedUtil.IsNullEmpty(_config.appID)) {
                this.appID = _config.appID;
            }
            this.node.on("input", this.oninput);
            this.node.on("close", this.onclose);
        } catch (error) {
            NoderedUtil.HandleError(this, error, null);
        }
    }
    async oninput(msg: any) {
        try {
            this.node.status({});

            if (!NoderedUtil.IsNullEmpty(msg.payload)) { this.config.contents = msg.payload; }
            if (!NoderedUtil.IsNullEmpty(msg.url)) { this.config.url = msg.url; }
            if (!NoderedUtil.IsNullEmpty(msg.customurl)) { this.config.customurl = msg.customurl; }

            if (!NoderedUtil.IsNullEmpty(msg.included_segments)) { this.config.included_segments = msg.included_segments; }
            if (!NoderedUtil.IsNullEmpty(msg.excluded_segments)) { this.config.excluded_segments = msg.excluded_segments; }
            if (!NoderedUtil.IsNullEmpty(msg.include_player_ids)) { this.config.include_player_ids = msg.include_player_ids; }

            if (this.config.included_segments.indexOf(",") > -1) { this.config.included_segments = (this.config.included_segments as string).split(","); }
            if (this.config.excluded_segments.indexOf(",") > -1) { this.config.excluded_segments = (this.config.excluded_segments as string).split(","); }
            if (this.config.include_player_ids.indexOf(",") > -1) { this.config.include_player_ids = (this.config.include_player_ids as string).split(","); }
            const body = {
                'app_id': this.appID,
                'contents': this.config.contents,
                'included_segments': Array.isArray(this.config.included_segments) ? this.config.included_segments : [this.config.included_segments],
                'excluded_segments': Array.isArray(this.config.excluded_segments) ? this.config.excluded_segments : [this.config.excluded_segments],
                'include_player_ids': Array.isArray(this.config.include_player_ids) ? this.config.include_player_ids : [this.config.include_player_ids],
                'data': { 'customurl': this.config.customurl },
                'url': this.config.url
            };

            this.node.status({ fill: "blue", shape: "dot", text: "Creating notifications" });
            request(
                {
                    method: 'POST',
                    uri: 'https://onesignal.com/api/v1/notifications',
                    headers: {
                        "authorization": "Basic " + this.restKey,
                        "content-type": "application/json"
                    },
                    json: true,
                    body: body
                },
                (error, response, body) => {
                    if (!body.errors) {
                        msg.payload = body;
                        this.node.status({});
                        this.node.send(msg);
                    } else {
                        NoderedUtil.HandleError(this, body.errors, msg);
                    }
                }
            );
        } catch (error) {
            NoderedUtil.HandleError(this, error, msg);
        }
    }
    onclose() {
    }
}
