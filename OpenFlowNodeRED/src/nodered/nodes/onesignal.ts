import { Red } from "node-red";
import * as onesignal from "./onesignal_nodes";

export = function (RED: Red) {
    RED.nodes.registerType("onesignal-credentials", onesignal.onesignal_credentials, {
        credentials: {
            restKey: { type: "text" },
            appID: { type: "text" }
        }
    });
    RED.nodes.registerType("onesignal create notification", onesignal.create_notification);
}
