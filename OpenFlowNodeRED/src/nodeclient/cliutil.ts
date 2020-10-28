import { Logger } from "../Logger";
import { Config } from "../Config";
import * as fs from "fs";
export const logger = Logger.configure();
const cp = require('child_process');
const path = require('path');
const envfile = require('envfile')
export const envfilename = ".env";
export const envfilepathname = "";
export var servicename = "service-name-not-set";
const service = require("os-service");

export function isWin() {
    return process.platform === "win32";
}
export function isMac() {
    return process.platform === "darwin";
}
export function isOpenFlow() {
    const check1 = path.join(__dirname, "..", "DatabaseConnection.ts");
    const check2 = path.join(__dirname, "..", "DatabaseConnection.js");
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
export function RestartService(servicename: string) {
    try {
        if (isWin()) {
            cp.execSync(`net stop "${servicename}" & net start "${servicename}"`);
        } else if (isMac()) {
            // https://medium.com/craftsmenltd/building-a-cross-platform-background-service-in-node-js-791cfcd3be60
            // cp.execSync(`sudo launchctl unload ${LAUNCHD_PLIST_PATH}`);
        } else {
            cp.execSync(`service ${servicename} restart`);
        }
    } catch (error) {
        logger.info(error.message);
    }
}
export function RemoveService(servicename: string) {
    StopService(servicename);
    logger.info("Uninstalling service" + servicename);
    service.remove(servicename, function (error) {
        if (error) { logger.info(error.message); return }
        logger.info("Service" + servicename + " uninstalled");
    });
}
export function InstallService(servicename: string, configfile: string) {
    logger.info("Installing service" + servicename);
    service.add(servicename, { programArgs: [servicename, "--run", "--config", configfile] }, function (error) {
        if (error) { logger.info(error.message); return }
        logger.info("Service" + servicename + " installed");
        StartService(servicename);
    });
}
export function RunService(callback: any) {
    service.run(function () {
        logger.info("Service" + servicename + " stopping");
        if (callback != null) callback();
        service.stop(0);
    });
}
// use and copy current env file, unless we have a /config folder in root
export function getlocaldir(): string {
    let local = __dirname;
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
    const localenv = path.join(getlocaldir(), envfilename);
    return fs.existsSync(localenv);
}
// set source to location of source files, unless we have a /config folder in root
export function getsourcedir(): string {
    let source = __dirname;
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
    const sourceenv = path.join(getsourcedir(), envfilename);
    return fs.existsSync(sourceenv);
}

// export function copyenv() {
//     const source = getsourcedir();
//     const local = getlocaldir();


//     const localenv = path.join(local, envfilename);
//     const sourceenv = path.join(source, envfilename);
//     if (localenv != sourceenv && fs.existsSync(localenv)) {
//         logger.info("localenv : " + localenv);
//         logger.info("sourceenv: " + sourceenv);
//         logger.info("copy local " + envfilename + " file to " + source);
//         fs.copyFileSync(localenv, sourceenv);
//     }
//     loadenv();
// }
export function loadenv() {
    logger.info("NodeJS version " + process.version + " Config " + envfilepathname);
    let parsedFile = envfile.parse(fs.readFileSync(envfilepathname));
    for (const k in parsedFile) {
        process.env[k] = parsedFile[k];
        // logger.verbose(k + " = " + parsedFile[k]);
    }
    Config.reload();
}