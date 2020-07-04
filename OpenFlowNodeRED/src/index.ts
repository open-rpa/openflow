#!/usr/bin/env node
import * as winston from "winston";
import * as http from "http";


import { Logger } from "./Logger";
import { WebServer } from "./WebServer";
import { WebSocketClient } from "./nodeclient/WebSocketClient";
import { SigninMessage, Message, TokenUser } from "./nodeclient/Message";
import { Config } from "./Config";
import { Crypt } from "./nodeclient/Crypt";
import { NoderedUtil } from "./nodeclient/NoderedUtil";

const service = require("os-service");


const logger: winston.Logger = Logger.configure();
logger.info("starting openflow nodered");

const unhandledRejection = require("unhandled-rejection");
let rejectionEmitter = unhandledRejection({
    timeout: 20
});

rejectionEmitter.on("unhandledRejection", (error, promise) => {
    console.log('Unhandled Rejection at: Promise', promise, 'reason:', error);
    console.dir(error.stack);
});

rejectionEmitter.on("rejectionHandled", (error, promise) => {
    console.log('Rejection handled at: Promise', promise, 'reason:', error);
    console.dir(error.stack);
})

// process.on('unhandledRejection', (reason: any, p) => {
//     // console.error(up);
//     console.log('Unhandled Rejection at: Promise', p, 'reason:', reason);
//     console.dir(reason.stack);
//     p.then((value) => {
//         console.error(value);
//     }).catch((error) => {
//         console.error(error);
//     }).finally(() => {
//         console.error("What the fuck????");
//     })
//     //throw up
// });
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
            try {
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
                WebSocketClient.instance.user = result.user;
                WebSocketClient.instance.jwt = result.jwt;

                const server: http.Server = await WebServer.configure(logger, socket);
                var baseurl = Config.saml_baseurl;
                if (NoderedUtil.IsNullEmpty(baseurl)) {
                    baseurl = Config.baseurl();
                }
                logger.info("listening on " + baseurl);
                socket.events.emit("onsignedin", result.user);
            } catch (error) {
                var closemsg: any = error;
                if (error.message) { logger.error(error.message); closemsg = error.message; }
                else { logger.error(error); }
                socket.close(1000, closemsg);
            }
        });
    } catch (error) {
        if (error.message) { logger.error(error.message); }
        else { logger.error(error); }
    }
})();

