import * as winston from "winston";
import * as http from "http";

import { Logger } from "./Logger";
import { WebServer } from "./WebServer";
import { amqp_consumer, amqp_rpc_consumer } from "./amqp_consumer";
import { amqp_publisher, amqp_rpc_publisher } from "./amqp_publisher";
import { amqp_exchange_consumer } from "./amqp_exchange_consumer";
import { amqp_exchange_publisher } from "./amqp_exchange_publisher";
import { WebSocketClient } from "./WebSocketClient";
import { SigninMessage, Message, TokenUser } from "./Message";
import { Config } from "./Config";
import { Crypt } from "./Crypt";

const logger: winston.Logger = Logger.configure();

Config.DumpConfig();


var con: amqp_consumer = new amqp_consumer(logger, Config.amqp_url, "hello1");
var pub: amqp_publisher = new amqp_publisher(logger, Config.amqp_url, "");
var excon1: amqp_exchange_consumer = new amqp_exchange_consumer(logger, Config.amqp_url, "hello2");
var excon2: amqp_exchange_consumer = new amqp_exchange_consumer(logger, Config.amqp_url, "hello2");
var expub: amqp_exchange_publisher = new amqp_exchange_publisher(logger, Config.amqp_url, "hello2");

var rpccon: amqp_rpc_consumer = new amqp_rpc_consumer(logger, Config.amqp_url, "rpchello", (msg: string): string => {
    return "server response! " + msg;
});
var rpcpub: amqp_rpc_publisher = new amqp_rpc_publisher(logger, Config.amqp_url);

process.on('unhandledRejection', up => {
    console.error(up);
    throw up
});
// function isNumeric(n) {
//     return !isNaN(parseFloat(n)) && isFinite(n);
// }
function isNumeric(num) {
    return !isNaN(num)
}
(async function (): Promise<void> {
    try {
        var socket: WebSocketClient = new WebSocketClient(logger, Config.api_ws_url);
        socket.events.on("onopen", async () => {

            var q: SigninMessage = new SigninMessage();
            var user = new TokenUser();
            if (isNumeric(Config.nodered_id)) {
                user.name = "nodered" + Config.nodered_id;
            } else {
                user.name = Config.nodered_id;
            }
            user.username = user.name;
            q.jwt = Crypt.createToken(user);
            var msg: Message = new Message(); msg.command = "signin"; msg.data = JSON.stringify(q);
            var result: SigninMessage = await socket.Send<SigninMessage>(msg);
            logger.info("signed in as " + result.user.name + " with id " + result.user._id);

            const server: http.Server = await WebServer.configure(logger, socket);
            logger.info("listening on " + Config.baseurl());
        });

        // console.log("************************");
        // await con.connect();
        // await pub.connect();
        // pub.SendMessage("pub/sub hi mom");
        // console.log("************************");
        // await excon1.connect();
        // await excon2.connect();
        // await expub.connect();
        // expub.SendMessage("exchange/hi mom");
        // console.log("************************");
        // await rpccon.connect();
        // await rpcpub.connect();
        // console.log("************************");
        // var rpcresult:string  = await rpcpub.SendMessage("Client says hi!", "rpchello");
        // console.log("rpcresult: " + rpcresult);
        // console.log("************************");
    } catch (error) {
        logger.error(error.message);
        console.error(error);
    }

})();

