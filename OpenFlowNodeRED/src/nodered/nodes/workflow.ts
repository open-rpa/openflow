import { Red } from "node-red";
import * as workflow from "./workflow_nodes";


export = function (RED: Red) {
    RED.nodes.registerType("workflow in", workflow.workflow_in_node);
    RED.nodes.registerType("workflow out", workflow.workflow_out_node);
}
