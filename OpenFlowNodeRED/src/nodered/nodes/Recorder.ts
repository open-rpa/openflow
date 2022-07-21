import { Red } from "node-red";
import * as recorder from "./Recorder_nodes";


export = function (RED: Red) {
    try {
        var rec = new recorder.recorder();
        // @ts-ignore
        // debugger;
        // var module = registry.getModule(moduleId);
        // RED.plugins.registerPlugin("node-red-contrib-recorder", rec);
    } catch (error) {
        // debugger;
        console.error(error)
    }
}
