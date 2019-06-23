import * as fs from "fs";
import * as path from "path";
import { WebSocketClient } from "./WebSocketClient";
import winston = require("winston");
import { nodered_settings } from "./nodered_settings";
import { QueryMessage, Message, DeleteOneMessage, InsertOneMessage } from "./Message";
import { Config } from "./Config";
import { json } from "body-parser";
import { NoderedUtil } from "./nodered/nodes/NoderedUtil";
// tslint:disable-next-line: class-name
export class noderedcontribopenflowstorage {

    private socket: WebSocketClient = null;
    private _logger: winston.Logger;
    private settings: nodered_settings = null;
    public getFlows: any;
    public saveFlows: any;
    public getCredentials: any;
    public saveCredentials: any;
    public getSettings: any;
    public saveSettings: any;
    public getSessions: any;
    public saveSessions: any;
    public getLibraryEntry: any;
    public saveLibraryEntry: any;
    constructor(logger: winston.Logger, socket: WebSocketClient) {
        this._logger = logger;
        this.socket = socket;
        this.getFlows = (this._getFlows.bind(this));
        this.saveFlows = (this._saveFlows.bind(this));
        this.getCredentials = (this._getCredentials.bind(this));
        this.saveCredentials = (this._saveCredentials.bind(this));
        this.getSettings = (this._getSettings.bind(this));
        this.saveSettings = (this._saveSettings.bind(this));
        this.getSessions = (this._getSessions.bind(this));
        this.saveSessions = (this._saveSessions.bind(this));
        // this.getLibraryEntry = (this._getLibraryEntry.bind(this));
        // this.saveLibraryEntry = (this._saveLibraryEntry.bind(this));
    }
    public async init(settings: any): Promise<boolean> {
        this._logger.silly("noderedcontribopenflowstorage::init");
        this.settings = settings;
        var packageFile: string = path.join(this.settings.userDir, "package.json");
        try {
            if (!fs.existsSync(this.settings.userDir)) {
                fs.mkdirSync(this.settings.userDir);
            }
            fs.statSync(packageFile);
            this._logger.debug(packageFile + " exists.");
        } catch (err) {
            var defaultPackage: any = {
                "name": "node-red-project",
                "description": "A Node-RED Project",
                "version": "0.0.1"
            };
            this._logger.debug("creating new packageFile " + packageFile);
            fs.writeFileSync(packageFile, JSON.stringify(defaultPackage, null, 4));
        }
        var dbsettings = await this._getSettings();
        return true;
    }
    public async _getFlows(): Promise<any[]> {
        try {
            this._logger.silly("noderedcontribopenflowstorage::_getFlows");
            var result = await NoderedUtil.Query("nodered", { _type: "flow", nodered_id: Config.nodered_id }, null, null, 1, 0, null);
            if (result.length === 0) { return []; }
            try {
                return JSON.parse(result[0].flows);
            } catch (error) {
                console.error(error);
                return [];
            }
        } catch (error) {
            if (error.message) { this._logger.error(error.message); }
            else { this._logger.error(error); }
            console.error(error);
            return [];
        }
    }
    public async _saveFlows(flows: any[]): Promise<void> {
        try {
            this._logger.silly("noderedcontribopenflowstorage::_saveFlows");
            var result = await NoderedUtil.Query("nodered", { _type: "flow", nodered_id: Config.nodered_id }, null, null, 1, 0, null);
            if (result.length === 0) {
                var item: any = {
                    name: "flows for " + Config.nodered_id,
                    flows: JSON.stringify(flows), _type: "flow", nodered_id: Config.nodered_id
                };
                await NoderedUtil.InsertOne("nodered", item, 1, true, null);
            } else {
                result[0].flows = JSON.stringify(flows);
                await NoderedUtil._UpdateOne("nodered", null, result[0], 1, true, null);
            }
        } catch (error) {
            if (error.message) { this._logger.error(error.message); }
            else { this._logger.error(error); }
            console.error(error);
        }
    }
    public async _getCredentials(): Promise<any> {
        try {
            this._logger.silly("noderedcontribopenflowstorage::_getCredentials");
            var result = await NoderedUtil.Query("nodered", { _type: "credential", nodered_id: Config.nodered_id }, null, null, 1, 0, null);
            if (result.length === 0) { return []; }
            var cred: any = result[0].credentials;
            return cred;
        } catch (error) {
            if (error.message) { this._logger.error(error.message); }
            else { this._logger.error(error); }
            console.error(error);
            return [];
        }
    }
    public async _saveCredentials(credentials: any): Promise<void> {
        try {
            this._logger.silly("noderedcontribopenflowstorage::_saveCredentials");
            var result = await NoderedUtil.Query("nodered", { _type: "credential", nodered_id: Config.nodered_id }, null, null, 1, 0, null);
            if (result.length === 0) {
                var item: any = {
                    name: "credentials for " + Config.nodered_id,
                    credentials: credentials, _type: "credential", nodered_id: Config.nodered_id,
                    _encrypt: ["credentials"]
                };
                await NoderedUtil.InsertOne("nodered", item, 1, true, null);
            } else {
                result[0].credentials = credentials;
                await NoderedUtil._UpdateOne("nodered", null, result[0], 1, true, null);
            }
        } catch (error) {
            if (error.message) { this._logger.error(error.message); }
            else { this._logger.error(error); }
            console.error(error);
        }
    }
    private firstrun: boolean = true;
    public async _getSettings(): Promise<any> {
        try {
            this._logger.silly("noderedcontribopenflowstorage::_getSettings");
            var result = await NoderedUtil.Query("nodered", { _type: "setting", nodered_id: Config.nodered_id }, null, null, 1, 0, null);
            if (result.length === 0) { return {}; }

            var settings = JSON.parse(result[0].settings);
            if (this.firstrun) {
                var child_process = require("child_process");
                var keys = Object.keys(settings.nodes);
                var modules = "";
                for (var i = 0; i < keys.length; i++) {
                    var key = keys[i];
                    var val = settings.nodes[key];
                    if (["node-red", "node-red-node-email", "node-red-node-feedparser", "node-red-node-rbe",
                        "node-red-node-sentiment", "node-red-node-tail", "node-red-node-twitter"].indexOf(key) === -1) {
                        var pname = val.name + "@" + val.version;
                        // this._logger.info("Installing " + pname);
                        // child_process.execSync("npm install " + pname, { stdio: [0, 1, 2], cwd: this.settings.userDir });
                        modules += (" " + pname);
                    }
                }
                this._logger.info("Installing " + modules);
                child_process.execSync("npm install " + modules, { stdio: [0, 1, 2], cwd: this.settings.userDir });
                this.firstrun = false;
            }
            this._logger.silly("noderedcontribopenflowstorage::_getSettings: return result");
            return settings;
        } catch (error) {
            if (error.message) { this._logger.error(error.message); }
            else { this._logger.error(error); }
            console.error(error);
            return {};
        }
    }
    public async _saveSettings(settings: any): Promise<void> {
        try {
            this._logger.silly("noderedcontribopenflowstorage::_saveSettings");
            var result = await NoderedUtil.Query("nodered", { _type: "setting", nodered_id: Config.nodered_id }, null, null, 1, 0, null);
            if (result.length === 0) {
                var item: any = {
                    name: "settings for " + Config.nodered_id,
                    settings: JSON.stringify(settings), _type: "setting", nodered_id: Config.nodered_id
                };
                await NoderedUtil.InsertOne("nodered", item, 1, true, null);
            } else {
                result[0].settings = JSON.stringify(settings);
                await NoderedUtil._UpdateOne("nodered", null, result[0], 1, true, null);
            }
        } catch (error) {
            if (error.message) { this._logger.error(error.message); }
            else { this._logger.error(error); }
            console.error(error);
        }
    }

    public async _getSessions(): Promise<any[]> {
        try {
            this._logger.silly("noderedcontribopenflowstorage::_getSessions");
            var result = await NoderedUtil.Query("nodered", { _type: "session", nodered_id: Config.nodered_id }, null, null, 1, 0, null);
            if (result.length === 0) { return []; }
            var item: any = JSON.parse(result[0].sessions);
            return item;
        } catch (error) {
            if (error.message) { this._logger.error(error.message); }
            else { this._logger.error(error); }
            console.error(error);
            return [];
        }
    }
    public async _saveSessions(sessions: any[]): Promise<void> {
        try {
            var q: QueryMessage = new QueryMessage();

            var result = await NoderedUtil.Query("nodered", { _type: "session", nodered_id: Config.nodered_id }, null, null, 1, 0, null);
            if (result.length === 0) {
                var item: any = {
                    name: "sessions for " + Config.nodered_id,
                    sessions: JSON.stringify(sessions), _type: "session", nodered_id: Config.nodered_id
                };
                await NoderedUtil.InsertOne("nodered", item, 1, true, null);
            } else {
                result[0].sessions = JSON.stringify(sessions);
                await NoderedUtil._UpdateOne("nodered", null, result[0], 1, true, null);
            }
        } catch (error) {
            if (error.message) { this._logger.error(error.message); }
            else { this._logger.error(error); }
            console.error(error);
        }
    }

    // public async _getLibraryEntry(type:string, path:string) {
    //     var query = {
    //         $and: [
    //             { _type: "library" },
    //             { type: type },
    //             { path: new RegExp("^" + path)}
    //         ]
    //     }
    //             var items = await this.collection.find(query).toArray();
    //             var LibraryEntry = [];
    //             items.forEach((item) => {
    //                 if(path==item.path) {
    //                     var body = item.body;
    //                     if(item.type=="flows") {
    //                         body = JSON.parse(body);
    //                         body.fn = item.path;
    //                     }
    //                     resolve(body);
    //                     return;
    //                 } else {
    //                     var meta = item.meta;
    //                     meta.type = item.type;
    //                     meta.fn = item.path;
    //                     LibraryEntry.push(meta);
    //                 }
    // }
    // public async _saveLibraryEntry(type:string, path:string, meta:any, body:any) {
    //     if(path.indexOf("/")!=0) { path = "/" + path; }
    //     var query = {
    //         $and: [
    //             { _type: "library" },
    //             { type: type },
    //             { path: path }
    //         ]
    //     }
    //     var LibraryEntry = { _type: "library", type: type, path: path, meta: meta, body: body }
    //     await this.collection.updateOne(query, LibraryEntry, { upsert: true });
    // }

}
