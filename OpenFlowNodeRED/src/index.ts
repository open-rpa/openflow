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
import { stringify } from "querystring";
import { NoderedUtil } from "./nodered/nodes/NoderedUtil";

const logger: winston.Logger = Logger.configure();

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
        var c = Config;
        var socket: WebSocketClient = new WebSocketClient(logger, Config.api_ws_url);
        socket.events.on("onopen", async () => {

            var c = Config;
            var q: SigninMessage = new SigninMessage();
            q.clientagent = "nodered";
            q.clientversion = Config.version;
            if (Config.jwt !== "") {
                q.jwt = Config.jwt;
            } else if (Crypt.encryption_key() !== "") {
                var user = new TokenUser();
                if (NoderedUtil.IsNullEmpty(Config.nodered_sa)) {
                    user.name = "nodered" + Config.nodered_id;
                } else {
                    user.name = Config.nodered_sa;
                }
                user.username = user.name;
                q.jwt = Crypt.createToken(user);
            } else {
                throw new Error("missing encryption_key and jwt, signin not possible!");
            }
            var msg: Message = new Message(); msg.command = "signin"; msg.data = JSON.stringify(q);
            var result: SigninMessage = await socket.Send<SigninMessage>(msg);
            logger.info("signed in as " + result.user.name + " with id " + result.user._id);

            const server: http.Server = await WebServer.configure(logger, socket);
            var baseurl = Config.saml_baseurl;
            if (NoderedUtil.IsNullEmpty(baseurl)) {
                baseurl = Config.baseurl();
            }
            logger.info("listening on " + baseurl);
        });
    } catch (error) {
        logger.error(error.message);
        console.error(error);
    }
})();

