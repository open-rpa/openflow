#!/usr/bin/env node
// npm link --force
// npm i npm install --global --production windows-build-tools
import * as fs from "fs";
import { WebSocketClient } from "./nodeclient/WebSocketClient";
import { SigninMessage, Message } from "./nodeclient/Message";
import { Config } from "./Config";
import { logger, StopService, StartService, loadenv, copyenv, envfilename, servicename, isOpenFlow, getlocaldir } from "./nodeclient/cliutil";

const optionDefinitions = [
    { name: 'verbose', alias: 'v', type: Boolean },
    { name: 'config', alias: 'c', type: Boolean },
    { name: 'install', alias: 'i', type: Boolean },
    { name: 'uninstall', alias: 'u', type: Boolean },
    { name: 'start', type: Boolean },
    { name: 'stop', type: Boolean },
    { name: 'run', type: Boolean },
    { name: 'name', type: String, defaultOption: true }
]
const commandLineArgs = require('command-line-args');
const service = require("os-service");
const path = require('path');
const readlineSync = require('readline-sync');
const envfile = require('envfile')



var options = null;
try {
    options = commandLineArgs(optionDefinitions);
    if (options.name == null || options.name == "") throw new Error("Name is mandatory");
    (servicename as any) = options.name;
    (envfilename as any) = options.name + ".env";
} catch (error) {
    logger.info(error.message);
    printusage();
    process.exit();
}

function getToken(): Promise<string> {
    return new Promise<string>(async (resolve, reject) => {
        logger.info("wsurl " + Config.api_ws_url);
        var socket: WebSocketClient = new WebSocketClient(logger, Config.api_ws_url);
        socket.events.on("onopen", async () => {
            try {
                var q: SigninMessage = new SigninMessage();
                q.clientagent = "nodered-cli";
                q.clientversion = Config.version;
                q.username = readlineSync.question('username? ');
                q.password = readlineSync.question('password? ', { hideEchoBack: true });
                q.longtoken = true;
                var msg: Message = new Message(); msg.command = "signin"; msg.data = JSON.stringify(q);
                var result: SigninMessage = await socket.Send<SigninMessage>(msg);
                logger.info("signed in as " + result.user.name + " with id " + result.user._id);
                WebSocketClient.instance.user = result.user;
                WebSocketClient.instance.jwt = result.jwt;
                socket.close(1000, closemsg);
                resolve(result.jwt);
                socket = null;
            } catch (error) {
                var closemsg: any = error;
                if (error.message) { logger.error(error.message); closemsg = error.message; }
                else { logger.error(error); }
                socket.close(1000, closemsg);
                reject(closemsg);
                socket = null;
            }
        });
    });
}


async function doit() {
    if (options.config == true) {
        StopService(servicename);
        service.remove(servicename, function (error) {
        });

        try {
            var dir = __dirname.toLowerCase();
            logger.error(__dirname);
            // Request a token, to add into the config
            logger.info("isOpenFlow: " + isOpenFlow());
            if (!isOpenFlow()) {
                copyenv();
                let jwt = await getToken();
                logger.info("Received token, update " + envfilename + " file");
                let localenv = path.join(getlocaldir(), envfilename);
                let parsedFile = envfile.parse(fs.readFileSync(localenv));
                parsedFile.jwt = jwt;
                fs.writeFileSync(localenv, envfile.stringify(parsedFile));
            }
            copyenv();
            logger.info("Install service " + servicename);
            service.add(servicename, { programArgs: ["--run", options.name] }, function (error) {
                if (error) logger.info(error.message);
                StartService(servicename);
            });
            logger.info("Quit");
        } catch (error) {
            logger.error(error);
        }
    } else if (options.install == true) {
        loadenv();
        service.add(servicename, { programArgs: ["--run", options.name] }, function (error) {
            if (error) logger.info(error.message);
            StartService(servicename);
        });
    } else if (options.uninstall == true) {
        StopService(servicename);
        service.remove(servicename, function (error) {
            if (error) logger.info(error.message);
        });
    } else if (options.start == true) {
        loadenv();
        StartService(servicename);
    } else if (options.stop == true) {
        StopService(servicename);
    } else if (options.run == true) {
        loadenv();
        logger.info("Starting as service " + servicename);
        service.run(function () {
            logger.info("Service" + servicename + " stopping");
            service.stop(0);
        });
        logger.info("Run " + servicename);
        var index = index = path.join(__dirname, "/index.js");
        if (!fs.existsSync(index)) {
            index = path.join(__dirname, "dist", "/index.js");
        }
        logger.info("run: " + index)
        require(index);
    } else {
        printusage();
    }

}


function printusage() {
    if (!isOpenFlow()) {
        console.log("openflow-nodered-cli [--install][--uninstall][--config][--start][--stop] name");
        console.log("   --install - Install openflow as an service that runs at boot");
        console.log("   --uninstall - Uninstalls service, if openflow has been installed as an service");
        console.log("   --config - Prompt for credentials and create config");
        console.log("   --start - Will start the service with the given name");
        console.log("   --stop - Will stop the service with the given name");
        console.log("   name - Service and instance name");
        console.log("Will look for an envoriment file called name.env and copy that to the");
        console.log("source directory");
        return;
    }
    console.log("openflow-cli [--install][--uninstall][--start][--stop] name");
    console.log("   --install - Install openflow as an service that runs at boot");
    console.log("   --uninstall - Uninstalls service, if openflow has been installed as an service");
    console.log("   --start - Will start the service with the given name");
    console.log("   --stop - Will stop the service with the given name");
    console.log("   name - Service and instance name");
    console.log("Will look for an envoriment file called name.env and copy that to the");
    console.log("source directory");
}

const unhandledRejection = require("unhandled-rejection");
let rejectionEmitter = unhandledRejection({
    timeout: 20
});

rejectionEmitter.on("unhandledRejection", (error, promise) => {
    logger.error('Unhandled Rejection at: Promise', promise, 'reason:', error);
    logger.error(error.stack);
});

rejectionEmitter.on("rejectionHandled", (error, promise) => {
    logger.error('Rejection handled at: Promise', promise, 'reason:', error);
    logger.error(error.stack);
})

doit();