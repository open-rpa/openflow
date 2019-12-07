import { Red } from "node-red";
import * as rpa from "./rpa_nodes";

export = function (RED: Red) {
    RED.nodes.registerType("rpa detector", rpa.rpa_detector_node);
    RED.nodes.registerType("rpa workflow", rpa.rpa_workflow_node);
    RED.httpAdmin.get("/rpa_detectors", RED.auth.needsPermission('serial.read'), rpa.get_rpa_detectors);
    RED.httpAdmin.get("/rpa_robots", RED.auth.needsPermission('serial.read'), rpa.get_rpa_robots);
    RED.httpAdmin.get("/rpa_workflows", RED.auth.needsPermission('serial.read'), rpa.get_rpa_workflows);
}
