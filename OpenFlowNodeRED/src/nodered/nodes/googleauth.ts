import { Red } from "node-red";
import * as googleauth from "./googleauth_nodes";

export = function (RED: Red) {
    RED.nodes.registerType("googleauth credentials", googleauth.googleauth_credentials, {
        credentials: {
            clientid: { type: "text" },
            clientsecret: { type: "password" },
            scopes: { type: "text" },
            redirecturi: { type: "text" },
            code: { type: "password" },
            tokens: { type: "password" },
            serviceaccount: { type: "password" }
        }
    });

    // RED.nodes.registerType("googleauth workflow", googleauth.googleauth_workflow_node);
    // RED.httpAdmin.get("/googleauth_workflows", RED.auth.needsPermission('serial.read'), googleauth.get_googleauth_workflows);
    RED.nodes.registerType("googleauth request", googleauth.googleauth_request);
}
