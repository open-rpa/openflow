import { Red } from "node-red";
import * as amqp from "./amqp_nodes";


// declare function fn(RED: Red): void;
// export = fn;
export = function (RED: Red) {
    RED.nodes.registerType("amqp-connection", amqp.amqp_connection, {
        credentials: {
            username: { type: "text" },
            password: { type: "password" }
        }
    });
    RED.nodes.registerType("amqp consumer", amqp.amqp_consumer_node);
    RED.nodes.registerType("amqp publisher", amqp.amqp_publisher_node);
    RED.nodes.registerType("amqp acknowledgment", amqp.amqp_acknowledgment_node);
    RED.nodes.registerType("amqp exchange", amqp.amqp_exchange_node);
}
