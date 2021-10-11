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
export function loadenv() {
    logger.info("NodeJS version " + process.version + " Config " + envfilepathname);
    let parsedFile = envfile.parse(fs.readFileSync(envfilepathname));
    for (const k in parsedFile) {
        process.env[k] = parsedFile[k];
    }
    Config.reload();
}