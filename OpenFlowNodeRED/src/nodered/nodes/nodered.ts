import { Red } from "node-red";
import * as nodered from "./nodered_nodes";


// declare function fn(RED: Red): void;
// export = fn;
export = function (RED: Red) {
    RED.nodes.registerType("nodered get pods", nodered.get_pods);

}
