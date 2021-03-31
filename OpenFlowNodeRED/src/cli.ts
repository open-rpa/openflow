#!/usr/bin/env node
// npm link --force
// npm i npm install --global --production windows-build-tools
import * as fs from "fs";
import { Config } from "./Config";
import { logger, loadenv, envfilename, envfilepathname, servicename, isOpenFlow } from "./nodeclient/cliutil";
import { WebSocketClient, SigninMessage, Message, NoderedUtil } from "@openiap/openflow-api";
import { pm2stop, pm2delete, pm2start, pm2restart, pm2list, pm2disconnect, pm2dump, pm2startup, pm2exists } from "./nodeclient/pm2util";
import { platform } from "node:os";

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
    { name: 'inspect', type: String },
    { name: 'networks', type: Boolean }
]
const commandLineArgs = require('command-line-args');

const path = require('path');
const readlineSync = require('readline-sync');
const envfile = require('envfile')
const { networkInterfaces } = require('os');



let options = null;
try {
    options = commandLineArgs(optionDefinitions);
    if (!options.init) {
        if (options.networks) {
            const nets = networkInterfaces();
            for (const name of Object.keys(nets)) {
                for (const net of nets[name]) {
                    // skip over non-ipv4 and internal (i.e. 127.0.0.1) addresses
                    if (net.family === 'IPv4' && !net.internal) {
                        //console.log(name, net);
                        console.log(name, net.address);
                    }
                }
            }
            process.exit();
        }
        if (options.name == null || options.name == "") throw new Error("Name is mandatory");
        if (options.name.endsWith(".env")) options.name = options.name.substring(0, options.name.length - 4);
        (servicename as any) = options.name;
        (envfilename as any) = options.name + ".env";
        (envfilepathname as any) = path.join(process.cwd(), envfilename);
        if (options.config != null && options.config != "") (envfilepathname as any) = options.config;

        if (!isOpenFlow()) {
            let parsedFile = envfile.parse(fs.readFileSync(envfilepathname));
            if (parsedFile.jwt == null || parsedFile.jwt == "") {
                if (options.authenticate != true) logger.warn(envfilename + " is missing a jwt, switching to --authenticate")
                options.authenticate = true;
            }
        }
    }
} catch (error) {
    console.error(error.message ? error.message : error);
    printusage();
    process.exit();
}

function getToken(): Promise<string> {
    return new Promise<string>(async (resolve, reject) => {
        logger.info("wsurl " + Config.api_ws_url);
        let socket: WebSocketClient = new WebSocketClient(logger, Config.api_ws_url);
        socket.agent = "nodered-cli";
        socket.version = Config.version;
        socket.events.on("onopen", async () => {
            try {
                const username: string = readlineSync.question('username? ');
                const password: string = readlineSync.question('password? ', { hideEchoBack: true });

                const result = await NoderedUtil.SigninWithUsername(username, password, null, true);
                logger.info("signed in as " + result.user.name + " with id " + result.user._id);
                WebSocketClient.instance.user = result.user;
                WebSocketClient.instance.jwt = result.jwt;
                socket.close(1000, "Close by user");
                resolve(result.jwt);
                socket = null;
            } catch (error) {
                let closemsg: any = (error.message ? error.message : error);
                logger.error(error);
                socket.close(1000, closemsg);
                reject(closemsg);
                socket = null;
            }
        });
    });
}


async function doit() {
    try {
        console.log("--- BEGIN!!!!");
        if (options.init) {
            console.log("init");
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
            console.log("authenticate");
            if (await pm2exists(servicename)) {
                await pm2stop(servicename);
                await pm2delete(servicename);
            }
            try {
                logger.info("isOpenFlow: " + isOpenFlow());
                if (!isOpenFlow()) {
                    loadenv();
                    let jwt = await getToken();
                    let parsedFile = envfile.parse(fs.readFileSync(envfilepathname));
                    parsedFile.jwt = jwt;
                    fs.writeFileSync(envfilepathname, envfile.stringify(parsedFile));
                    WebSocketClient.instance.close(1000, "done");
                }
                loadenv();
                await pm2start({
                    name: servicename,
                    script: __filename,
                    args: [servicename, "--run", "--config", envfilepathname]
                });
                logger.info("Quit");
                pm2disconnect();
            } catch (error) {
                logger.error(error);
            }
        } else if (options.install == true) {
            console.log("install");
            loadenv();
            if (!await pm2exists(servicename)) {
                await pm2start({
                    name: servicename,
                    script: __filename,
                    args: [servicename, "--run", "--config", envfilepathname]
                });
                if (process.platform != "win32") {
                    await pm2startup(process.platform as any);
                }
                await pm2dump();
            } else {
                await pm2restart(servicename);
            }
            pm2disconnect();
        } else if (options.uninstall == true) {
            console.log("uninstall");
            if (await pm2exists(servicename)) {
                await pm2stop(servicename);
                await pm2delete(servicename);
            } else {
                console.error(servicename + " not found")
            }
            pm2disconnect();
        } else if (options.start == true) {
            console.log("start");
            loadenv();
            await pm2restart(servicename);
            pm2disconnect();
        } else if (options.stop == true) {
            console.log("stop");
            await pm2stop(servicename);
            pm2disconnect();
        } else if (options.restart == true) {
            console.log("restart");
            await pm2restart(servicename);
            pm2disconnect();
        } else if (options.run == true) {
            pm2disconnect();
            console.log("run");
            loadenv();
            logger.info("Starting as service " + servicename);
            let index = path.join(__dirname, "/index.js");
            if (!fs.existsSync(index)) {
                index = path.join(__dirname, "dist", "/index.js");
            }
            logger.info("run: " + index);
            require(index);
        } else {
            console.log("unknown, print usage");
            printusage();
        }

    } catch (error) {
        console.error(error.message ? error.message : error);
        process.exit();
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

doit();

// node C:\code\openflow\OpenFlowNodeRED\dist\cli.js --install noderedlocal