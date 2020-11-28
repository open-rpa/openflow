#!/usr/bin/env node
// npm link --force
// npm i npm install --global --production windows-build-tools
import * as fs from "fs";
import { Config } from "./Config";
import { logger, StopService, StartService, RemoveService, InstallService, RunService, loadenv, envfilename, envfilepathname, servicename, isOpenFlow } from "./nodeclient/cliutil";
import { WebSocketClient, NoderedUtil } from "openflow-api";
const optionDefinitions = [
    { name: 'verbose', alias: 'v', type: Boolean },
    { name: 'authenticate', alias: 'a', type: Boolean },
    { name: 'init', type: Boolean },
    { name: 'install', alias: 'i', type: Boolean },
    { name: 'uninstall', alias: 'u', type: Boolean },
    { name: 'start', type: Boolean },
    { name: 'restart', type: Boolean },
    { name: 'stop', type: Boolean },
    { name: 'run', type: Boolean },
    { name: 'name', type: String, defaultOption: true },
    { name: 'config', type: String },
    { name: 'inspect', type: String }
]
const commandLineArgs = require('command-line-args');
const path = require('path');
const readlineSync = require('readline-sync');
const envfile = require('envfile')
let options = null;
try {
    options = commandLineArgs(optionDefinitions);
    if (!options.init) {
        if (options.name == null || options.name == "") throw new Error("Name is mandatory");
        if (options.name.endsWith(".env")) options.name = options.name.substring(0, options.name.length - 4);
        (servicename as any) = options.name;
        (envfilename as any) = options.name + ".env";
        (envfilepathname as any) = path.join(process.cwd(), envfilename);
        if (options.config != null && options.config != "") (envfilepathname as any) = options.config;
    }
} catch (error) {
    logger.info(error.message ? error.message : error);
    printusage();
    process.exit();
}
function getToken(): Promise<string> {
    return new Promise<string>(async (resolve, reject) => {
        logger.info("wsurl " + Config.api_ws_url);
        let socket: WebSocketClient = new WebSocketClient(logger, Config.api_ws_url);
        socket.agent = "openflow-cli";
        socket.version = Config.version;
        socket.events.on("onopen", async () => {
            try {
                const username: string = readlineSync.question('username? ');
                const password: string = readlineSync.question('password? ', { hideEchoBack: true });
                const result = await NoderedUtil.SigninWithUsername(username, password, null, true);
                logger.info("signed in as " + result.user.name + " with id " + result.user._id);
                WebSocketClient.instance.user = result.user;
                WebSocketClient.instance.jwt = result.jwt;
                socket.close(1000, "Closed by user");
                resolve(result.jwt);
                socket = null;
            } catch (error) {
                const closemsg: any = (error.message ? error.message : error);
                this._logger.error(error);
                socket.close(1000, closemsg);
                reject(closemsg);
                socket = null;
            }
        });
    });
}
async function doit() {
    if (options.init) {
        const files = fs.readdirSync(path.join(__dirname, ".."))
        for (let i = 0; i < files.length; i++) {
            let filename = files[i];
            if (path.extname(filename) == '.env') {
                const target = path.join(process.cwd(), filename);
                if (!fs.existsSync(target)) {
                    console.log("Creating " + filename);
                    filename = path.join(__dirname, "..", filename);
                    fs.copyFileSync(filename, target);

                    let parsedFile = envfile.parse(fs.readFileSync(target));
                    parsedFile.logpath = process.cwd();
                    fs.writeFileSync(target, envfile.stringify(parsedFile));

                } else {
                    console.log("Skipping " + filename + " already exists.");
                }
            }
        }
    } else if (options.authenticate == true) {
        StopService(servicename);
        RemoveService(servicename);
        try {
            logger.info("isOpenFlow: " + isOpenFlow());
            if (!isOpenFlow()) {
                loadenv();
                let jwt = await getToken();
                let parsedFile = envfile.parse(fs.readFileSync(envfilepathname));
                parsedFile.jwt = jwt;
                fs.writeFileSync(envfilepathname, envfile.stringify(parsedFile));
            }
            loadenv();
            InstallService(servicename, envfilepathname);
            logger.info("Quit");
        } catch (error) {
            logger.error(error);
        }
    } else if (options.install == true) {
        loadenv();
        InstallService(servicename, envfilepathname);
    } else if (options.uninstall == true) {
        StopService(servicename);
        RemoveService(servicename);
    } else if (options.start == true) {
        loadenv();
        StartService(servicename);
    } else if (options.stop == true) {
        StopService(servicename);
    } else if (options.restart == true) {
        StopService(servicename);
        loadenv();
        StartService(servicename);
    } else if (options.run == true) {
        loadenv();
        logger.info("Starting as service " + servicename);
        RunService(null);
        let index = path.join(__dirname, "/index.js");
        if (!fs.existsSync(index)) {
            index = path.join(__dirname, "dist", "/index.js");
        }
        logger.info("run: " + index);
        require(index);
    } else {
        printusage();
    }

}
function printusage() {
    if (!isOpenFlow()) {
        console.log("openflow-nodered-cli [--init][--install][--uninstall][--config][--start][--stop] name");
        console.log("   --init - Create sample environment files for running nodered");
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
    console.log("openflow-cli [--init][--install][--uninstall][--start][--stop] name");
    console.log("   --init - Create a sample environment file for running openflow");
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
    logger.error(error);
});
rejectionEmitter.on("rejectionHandled", (error, promise) => {
    logger.error('Rejection handled at: Promise', promise, 'reason:', error);
    logger.error(error);
})
doit();