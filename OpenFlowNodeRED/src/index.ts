import * as fs from "fs";
import * as path from "path";
import * as winston from "winston";
import * as http from "http";
import { WebSocketClient, NoderedUtil, TokenUser } from "openflow-api";
import { Logger } from "./Logger";
import { WebServer } from "./WebServer";
import { Config } from "./Config";
import { Crypt } from "./nodeclient/Crypt";
const fileCache = require('file-system-cache').default;
const backupStore = fileCache({ basePath: path.join(Config.logpath, '.cache') });
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
});
let server: http.Server = null;
(async function (): Promise<void> {
    try {
        const filename: string = Config.nodered_id + "_flows.json";
        const json = await backupStore.get(filename);
        if (!NoderedUtil.IsNullEmpty(json)) {
            server = await WebServer.configure(logger, socket);
            var baseurl = Config.saml_baseurl;
            if (NoderedUtil.IsNullEmpty(baseurl)) {
                baseurl = Config.baseurl();
            }
            logger.info("listening on " + baseurl);
        }
        var c = Config;
        var socket: WebSocketClient = new WebSocketClient(logger, Config.api_ws_url);
        socket.agent = "nodered";
        socket.version = Config.version;
        logger.info("VERSION: " + Config.version);
        socket.events.on("onerror", async () => {
        });
        socket.events.on("onclose", async () => {
        });
        socket.events.on("onopen", async () => {
            try {
                // q.clientagent = "nodered";
                // q.clientversion = Config.version;
                var jwt: string = "";
                if (Config.jwt !== "") {
                    jwt = Config.jwt;
                } else if (Crypt.encryption_key() !== "") {
                    var user = new TokenUser();
                    if (NoderedUtil.IsNullEmpty(Config.nodered_sa)) {
                        user.name = "nodered" + Config.nodered_id;
                    } else {
                        user.name = Config.nodered_sa;
                    }
                    user.username = user.name;
                    jwt = Crypt.createToken(user);
                } else {
                    throw new Error("missing encryption_key and jwt, signin not possible!");
                }
                var result = await NoderedUtil.SigninWithToken(jwt, null, null);
                logger.info("signed in as " + result.user.name + " with id " + result.user._id);
                WebSocketClient.instance.user = result.user;
                WebSocketClient.instance.jwt = result.jwt;

                if (server == null) {
                    server = await WebServer.configure(logger, socket);
                    var baseurl = Config.saml_baseurl;
                    if (NoderedUtil.IsNullEmpty(baseurl)) {
                        baseurl = Config.baseurl();
                    }
                    logger.info("listening on " + baseurl);
                }
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

