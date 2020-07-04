import { Logger } from "../Logger";
import { Config } from "../Config";
import * as fs from "fs";
export const logger = Logger.configure();
const cp = require('child_process');
const path = require('path');
const envfile = require('envfile')
export var envfilename = ".env";
export var servicename = "openflow-nodered";

export function isWin() {
    return process.platform === "win32";
}
export function isMac() {
    return process.platform === "darwin";
}
export function isOpenFlow() {
    var check1 = path.join(__dirname, "..", "DatabaseConnection.ts");
    var check2 = path.join(__dirname, "..", "DatabaseConnection.js");
    if (fs.existsSync(check1) || fs.existsSync(check2)) return true;
    return false;
}
export function StartService(servicename: string) {
    try {
        if (isWin()) {
            cp.execSync(`net start ${servicename}`);
        } else if (isMac()) {
            // https://medium.com/craftsmenltd/building-a-cross-platform-background-service-in-node-js-791cfcd3be60
            // cp.execSync(`sudo launchctl load ${LAUNCHD_PLIST_PATH}`);
        } else {
            cp.execSync(`service ${servicename} start`);
        }
    } catch (error) {
        logger.info(error.message);
    }
}
export function StopService(servicename: string) {
    try {
        if (isWin()) {
            cp.execSync(`net stop ${servicename}`);
        } else if (isMac()) {
            // https://medium.com/craftsmenltd/building-a-cross-platform-background-service-in-node-js-791cfcd3be60
            // cp.execSync(`sudo launchctl unload ${LAUNCHD_PLIST_PATH}`);
        } else {
            cp.execSync(`service ${servicename} stop`);
        }
    } catch (error) {
        logger.info(error.message);
    }
}
// use and copy current env file, unless we have a /config folder in root
export function getlocaldir(): string {
    var local = __dirname;
    if (fs.existsSync(path.join(local, "..", "config"))) {
        local = path.join(local, "..", "config");
    } else if (fs.existsSync(path.join(local, "..", "..", "config"))) {
        local = path.join(local, "..", "..", "config");
    } else if (fs.existsSync(path.join(local, "..", "..", "..", "config"))) {
        local = path.join(local, "..", "..", "..", "config");
    } else {
        local = process.cwd();
    }
    return local;
}
export function haslocalenv(): boolean {
    var localenv = path.join(getlocaldir(), envfilename);
    return fs.existsSync(localenv);
}
// set source to location of source files, unless we have a /config folder in root
export function getsourcedir(): string {
    var source = __dirname;
    if (fs.existsSync(path.join(source, "..", "config"))) {
        source = path.join(source, "..", "config");
    } else if (fs.existsSync(path.join(source, "..", "..", "config"))) {
        source = path.join(source, "..", "..", "config");
    } else if (fs.existsSync(path.join(source, "..", "..", "..", "config"))) {
        source = path.join(source, "..", "..", "..", "config");
    }
    return source;
}
export function hassourceenv(): boolean {
    var sourceenv = path.join(getsourcedir(), envfilename);
    return fs.existsSync(sourceenv);
}

export function copyenv() {
    var source = getsourcedir();
    var local = getlocaldir();


    var localenv = path.join(local, envfilename);
    var sourceenv = path.join(source, envfilename);
    if (localenv != sourceenv && fs.existsSync(localenv)) {
        logger.info("localenv : " + localenv);
        logger.info("sourceenv: " + sourceenv);
        logger.info("copy local " + envfilename + " file to " + source);
        fs.copyFileSync(localenv, sourceenv);
    }
    loadenv();
}
export function loadenv() {
    var source = getsourcedir();
    var sourceenv = path.join(source, envfilename);
    let parsedFile = envfile.parse(fs.readFileSync(sourceenv));
    logger.info("Loading config " + sourceenv);
    for (const k in parsedFile) {
        process.env[k] = parsedFile[k];
        logger.verbose(k + " = " + parsedFile[k]);
    }
    Config.reload();
}