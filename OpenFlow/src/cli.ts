#!/usr/bin/env node
// npm link --force
// npm i npm install --global --production windows-build-tools
require('cache-require-paths');
import * as fs from "fs";
import { Logger } from './Logger';
import { Config } from "./Config";
import { loadenv, envfilename, envfilepathname, servicename, isOpenFlow } from "./nodeclient/cliutil";
import { WebSocketClient, NoderedUtil } from "@openiap/openflow-api";
import { pm2stop, pm2delete, pm2start, pm2restart, pm2disconnect, pm2dump, pm2startup, pm2exists } from "./nodeclient/pm2util";

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





function getToken(): Promise<string> {
    return new Promise<string>(async (resolve, reject) => {
        Logger.instanse.info("wsurl " + Config.api_ws_url, null);
        let socket: WebSocketClient = new WebSocketClient(Logger.instanse, Config.api_ws_url);
        socket.agent = "nodered-cli";
        socket.version = Config.version;
        socket.events.on("onopen", async () => {
            try {
                const username: string = readlineSync.question('username? ');
                const password: string = readlineSync.question('password? ', { hideEchoBack: true });

                const result = await NoderedUtil.SigninWithUsername({ username, password, longtoken: true });
                Logger.instanse.info("signed in as " + result.user.name + " with id " + result.user._id, null);
                WebSocketClient.instance.user = result.user;
                WebSocketClient.instance.jwt = result.jwt;
                socket.close(1000, "Close by user");
                resolve(result.jwt);
                socket = null;
            } catch (error) {
                let closemsg: any = error;
                Logger.instanse.error(error, null);
                if (socket != null) socket.close(1000, closemsg);
                reject(closemsg);
                socket = null;
            }
        });
    });
}


async function doit() {
    try {
        const logger = Logger.configure(true, true);

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
                                Logger.instanse.info(name + " " + net.address, null);
                            }
                        }
                    }
                    process.exit();
                }
                if (options.name == null || options.name == "") { Logger.instanse.error("Name is mandatory", null); process.exit(); }
                if (options.name.endsWith(".env")) options.name = options.name.substring(0, options.name.length - 4);
                (servicename as any) = options.name;
                (envfilename as any) = options.name + ".env";
                (envfilepathname as any) = path.join(process.cwd(), envfilename);
                if (options.config != null && options.config != "") (envfilepathname as any) = options.config;

                if (!isOpenFlow()) {
                    let parsedFile = envfile.parse(fs.readFileSync(envfilepathname));
                    if (parsedFile.jwt == null || parsedFile.jwt == "") {
                        if (options.authenticate != true) Logger.instanse.warn(envfilename + " is missing a jwt, switching to --authenticate", null)
                        options.authenticate = true;
                    }
                }
            }
        } catch (error) {
            Logger.instanse.error(error, null);
            printusage();
            process.exit();
        }

        if (options.init) {
            Logger.instanse.info("init", null);
            const files = fs.readdirSync(path.join(__dirname, ".."))
            for (let i = 0; i < files.length; i++) {
                let filename = files[i];
                if (path.extname(filename) == '.env') {
                    const target = path.join(process.cwd(), filename);
                    if (!fs.existsSync(target)) {
                        Logger.instanse.info("Creating " + filename, null);
                        filename = path.join(__dirname, "..", filename);
                        fs.copyFileSync(filename, target);

                        let parsedFile = envfile.parse(fs.readFileSync(target));
                        parsedFile.logpath = process.cwd();
                        fs.writeFileSync(target, envfile.stringify(parsedFile));

                    } else {
                        Logger.instanse.info("Skipping " + filename + " already exists.", null);
                    }
                }
            }
        } else if (options.authenticate == true) {
            Logger.instanse.info("authenticate", null);
            if (await pm2exists(servicename)) {
                await pm2stop(servicename);
                await pm2delete(servicename);
            }
            try {
                Logger.instanse.info("isOpenFlow: " + isOpenFlow(), null);
                if (!isOpenFlow()) {
                    loadenv();
                    let jwt = await getToken();
                    let parsedFile = envfile.parse(fs.readFileSync(envfilepathname));
                    parsedFile.jwt = jwt;
                    fs.writeFileSync(envfilepathname, envfile.stringify(parsedFile));
                    WebSocketClient.instance?.close(1000, "done");
                }
                loadenv();
                await pm2start({
                    name: servicename,
                    script: __filename,
                    args: [servicename, "--run", "--config", envfilepathname]
                });
                Logger.instanse.info("Quit", null);
                pm2disconnect();
            } catch (error) {
                Logger.instanse.error(error, null);
            }
        } else if (options.install == true) {
            Logger.instanse.info("install", null);
            loadenv();
            if (!await pm2exists(servicename)) {
                await pm2start({
                    name: servicename,
                    script: __filename,
                    args: [servicename, "--run", "--config", envfilepathname]
                });
                if (process.platform == "linux") {
                    try {
                        await pm2startup("systemd");
                    } catch (error) {
                        Logger.instanse.error(error, null);
                    }
                }
                else if (process.platform != "win32") {
                    try {
                        await pm2startup(process.platform as any);
                    } catch (error) {
                        Logger.instanse.error(error, null);
                    }
                }
                await pm2dump();
            } else {
                await pm2restart(servicename);
            }
            pm2disconnect();
        } else if (options.uninstall == true) {
            Logger.instanse.info("uninstall", null);
            if (await pm2exists(servicename)) {
                await pm2stop(servicename);
                await pm2delete(servicename);
                await pm2dump();
            } else {
                Logger.instanse.error(servicename + " not found", null);
            }
            pm2disconnect();
        } else if (options.start == true) {
            Logger.instanse.info("start", null);
            loadenv();
            await pm2restart(servicename);
            pm2disconnect();
        } else if (options.stop == true) {
            Logger.instanse.info("stop", null);
            await pm2stop(servicename);
            pm2disconnect();
        } else if (options.restart == true) {
            Logger.instanse.info("restart", null);
            await pm2restart(servicename);
            pm2disconnect();
        } else if (options.run == true) {
            pm2disconnect();
            Logger.instanse.info("run", null);
            loadenv();
            Logger.instanse.info("Starting as service " + servicename, null);
            let index = path.join(__dirname, "/index.js");
            if (!fs.existsSync(index)) {
                index = path.join(__dirname, "dist", "/index.js");
            }
            Logger.instanse.info("run: " + index, null);
            require(index);
        } else {
            Logger.instanse.info("unknown, print usage", null);
            printusage();
        }

    } catch (error) {
        Logger.instanse.error(error, null);
        process.exit();
    }
}


function printusage() {
    if (!isOpenFlow()) {
        Logger.instanse.info("openflow-nodered-cli [--init][--install][--uninstall][--config][--start][--stop] name", null);
        Logger.instanse.info("   --init - Create sample environment files for running nodered", null);
        Logger.instanse.info("   --install - Install openflow as an service that runs at boot", null);
        Logger.instanse.info("   --uninstall - Uninstalls service, if openflow has been installed as an service", null);
        Logger.instanse.info("   --config - Prompt for credentials and create config", null);
        Logger.instanse.info("   --start - Will start the service with the given name", null);
        Logger.instanse.info("   --stop - Will stop the service with the given name", null);
        Logger.instanse.info("   name - Service and instance name", null);
        Logger.instanse.info("Will look for an environment file called name.env and copy that to the", null);
        Logger.instanse.info("source directory", null);
        return;
    }
    Logger.instanse.info("openflow-cli [--init][--install][--uninstall][--start][--stop] name", null);
    Logger.instanse.info("   --init - Create a sample environment file for running openflow", null);
    Logger.instanse.info("   --install - Install openflow as an service that runs at boot", null);
    Logger.instanse.info("   --uninstall - Uninstalls service, if openflow has been installed as an service", null);
    Logger.instanse.info("   --start - Will start the service with the given name", null);
    Logger.instanse.info("   --stop - Will stop the service with the given name", null);
    Logger.instanse.info("   name - Service and instance name", null);
    Logger.instanse.info("Will look for an environment file called name.env and copy that to the", null);
    Logger.instanse.info("source directory", null);
}

doit();

// node C:\code\openflow\dist\cli.js