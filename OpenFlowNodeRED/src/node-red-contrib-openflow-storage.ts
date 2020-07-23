import * as fs from "fs";
import * as path from "path";
import winston = require("winston");
import { nodered_settings } from "./nodered_settings";
import { Config } from "./Config";
import { WebSocketClient, NoderedUtil } from "openflow-api";
import * as nodered from "node-red";
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
    public RED: nodered.Red = null;
    constructor(logger: winston.Logger, socket: WebSocketClient) {
        this.RED = nodered;
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
        setTimeout(this.CheckUpdates.bind(this), Config.flow_refresh_interval);
    }

    // compare contents of two objects and return a list of differences
    // returns an array where each element is also an array in the form:
    // [accessor, diffType, leftValue, rightValue ]
    //
    // diffType is one of the following:
    //   value: when primitive values at that index are different
    //   undefined: when values in that index exist in one object but don't in 
    //              another; one of the values is always undefined
    //   null: when a value in that index is null or undefined; values are
    //         expressed as boolean values, indicated wheter they were nulls
    //   type: when values in that index are of different types; values are 
    //         expressed as types
    //   length: when arrays in that index are of different length; values are
    //           the lengths of the arrays
    //

    DiffObjects(o1, o2) {
        // choose a map() impl.
        // you may use $.map from jQuery if you wish
        var map = Array.prototype.map ?
            function (a) { return Array.prototype.map.apply(a, Array.prototype.slice.call(arguments, 1)); } :
            function (a, f) {
                var ret = new Array(a.length), value;
                for (var i = 0, length = a.length; i < length; i++)
                    ret[i] = f(a[i], i);
                return ret.concat();
            };

        // shorthand for push impl.
        var push = Array.prototype.push;

        // check for null/undefined values
        if ((o1 == null) || (o2 == null)) {
            if (o1 != o2)
                return [["", "null", o1 != null, o2 != null]];

            return undefined; // both null
        }
        // compare types
        if ((o1.constructor != o2.constructor) ||
            (typeof o1 != typeof o2)) {
            return [["", "type", Object.prototype.toString.call(o1), Object.prototype.toString.call(o2)]]; // different type

        }

        // compare arrays
        if (Object.prototype.toString.call(o1) == "[object Array]") {
            if (o1.length != o2.length) {
                return [["", "length", o1.length, o2.length]]; // different length
            }
            var diff = [];
            for (var i = 0; i < o1.length; i++) {
                // per element nested diff
                var innerDiff = this.DiffObjects(o1[i], o2[i]);
                if (innerDiff) { // o1[i] != o2[i]
                    // merge diff array into parent's while including parent object name ([i])
                    push.apply(diff, map(innerDiff, function (o, j) { o[0] = "[" + i + "]" + o[0]; return o; }));
                }
            }
            // if any differences were found, return them
            if (diff.length)
                return diff;
            // return nothing if arrays equal
            return undefined;
        }

        // compare object trees
        if (Object.prototype.toString.call(o1) == "[object Object]") {
            var diff = [];
            // check all props in o1
            for (var prop in o1) {
                // the double check in o1 is because in V8 objects remember keys set to undefined 
                if ((typeof o2[prop] == "undefined") && (typeof o1[prop] != "undefined")) {
                    // prop exists in o1 but not in o2
                    diff.push(["[" + prop + "]", "undefined", o1[prop], undefined]); // prop exists in o1 but not in o2

                }
                else {
                    // per element nested diff
                    var innerDiff = this.DiffObjects(o1[prop], o2[prop]);
                    if (innerDiff) { // o1[prop] != o2[prop]
                        // merge diff array into parent's while including parent object name ([prop])
                        push.apply(diff, map(innerDiff, function (o, j) { o[0] = "[" + prop + "]" + o[0]; return o; }));
                    }

                }
            }
            for (var prop in o2) {
                // the double check in o2 is because in V8 objects remember keys set to undefined 
                if ((typeof o1[prop] == "undefined") && (typeof o2[prop] != "undefined")) {
                    // prop exists in o2 but not in o1
                    diff.push(["[" + prop + "]", "undefined", undefined, o2[prop]]); // prop exists in o2 but not in o1

                }
            }
            // if any differences were found, return them
            if (diff.length)
                return diff;
            // return nothing if objects equal
            return undefined;
        }
        // if same type and not null or objects or arrays
        // perform primitive value comparison
        if (o1 != o2)
            return [["", "value", o1, o2]];

        // return nothing if values are equal
        return undefined;
    }

    private _flows: any[] = null;
    public async CheckUpdates() {
        try {
            let flows: any[] = await this._getFlows();
            if (this._flows != null) {
                let update: boolean = false;
                if (flows.length != this._flows.length) {
                    update = true;
                } else {
                    for (let i = 0; i < flows.length; i++) {
                        if (this.DiffObjects(flows[i], this._flows[i])) {
                            update = true;
                            break;
                        }
                    }
                }
                if (update) {
                    this._flows = flows;
                    await this.RED.nodes.loadFlows(true);
                }
            } else {
                this._flows = flows;
            }
        } catch (error) {
            this._logger.error(error);
        }
        setTimeout(this.CheckUpdates.bind(this), Config.flow_refresh_interval);
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
        }
        // Lets overwrite each time!
        var defaultPackage: any = {
            "name": "openflow-project",
            "license": "MPL-2.0",
            "description": "A OpenFlow Node-RED Project",
            "version": "0.0.1",
            "repository": {
                "type": "git",
                "url": "git+https://github.com/open-rpa/openflow.git"
            },
        };
        this._logger.debug("creating new packageFile " + packageFile);
        fs.writeFileSync(packageFile, JSON.stringify(defaultPackage, null, 4));

        // var dbsettings = await this._getSettings();
        // spawn gettings, so it starts installing
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
                if (error.message) { this._logger.error(error.message); }
                else { this._logger.error(error); }
                return [];
            }
        } catch (error) {
            if (error.message) { this._logger.error(error.message); }
            else { this._logger.error(error); }
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
                await NoderedUtil.UpdateOne("nodered", null, result[0], 1, true, null);
            }
            this._flows = flows;
        } catch (error) {
            if (error.message) { this._logger.error(error.message); }
            else { this._logger.error(error); }
        }
    }
    public async _getCredentials(): Promise<any> {
        try {
            this._logger.silly("noderedcontribopenflowstorage::_getCredentials");
            var result = await NoderedUtil.Query("nodered", { _type: "credential", nodered_id: Config.nodered_id }, null, null, 1, 0, null);
            if (result.length === 0) { return []; }
            var cred: any = result[0].credentials;
            var arr: any = result[0].credentialsarray;
            if (arr !== null && arr !== undefined) {
                cred = {};
                for (var i = 0; i < arr.length; i++) {
                    var key = arr[i].key;
                    var value = arr[i].value;
                    cred[key] = value;
                }
            }
            return cred;
        } catch (error) {
            if (error.message) { this._logger.error(error.message); }
            else { this._logger.error(error); }
            return [];
        }
    }
    public async _saveCredentials(credentials: any): Promise<void> {
        try {
            this._logger.silly("noderedcontribopenflowstorage::_saveCredentials");
            var result = await NoderedUtil.Query("nodered", { _type: "credential", nodered_id: Config.nodered_id }, null, null, 1, 0, null);

            var credentialsarray = [];
            var orgkeys = Object.keys(credentials);
            for (var i = 0; i < orgkeys.length; i++) {
                var key = orgkeys[i];
                var value = credentials[key];
                var obj = { key: key, value: value };
                credentialsarray.push(obj);
            }
            if (credentials)
                if (result.length === 0) {
                    var item: any = {
                        name: "credentials for " + Config.nodered_id,
                        credentials: credentials, credentialsarray: credentialsarray, _type: "credential", nodered_id: Config.nodered_id,
                        _encrypt: ["credentials"]
                    };
                    var subresult = await NoderedUtil.InsertOne("nodered", item, 1, true, null);
                } else {
                    var item: any = result[0];
                    item.credentials = credentials;
                    item.credentialsarray = credentialsarray;
                    var subresult = await NoderedUtil.UpdateOne("nodered", null, item, 1, true, null);
                }
        } catch (error) {
            if (error.message) { this._logger.error(error.message); }
            else { this._logger.error(error); }
        }
    }
    // private firstrun: boolean = true;
    public async _getSettings(): Promise<any> {
        try {
            this._logger.silly("noderedcontribopenflowstorage::_getSettings");
            var result = await NoderedUtil.Query("nodered", { _type: "setting", nodered_id: Config.nodered_id }, null, null, 1, 0, null);
            if (result.length === 0) { return {}; }

            var settings = JSON.parse(result[0].settings);
            //if (this.firstrun) {
            var child_process = require("child_process");
            var keys = Object.keys(settings.nodes);
            var modules = "";
            for (var i = 0; i < keys.length; i++) {
                var key = keys[i];
                var val = settings.nodes[key];
                if (["node-red", "node-red-node-email", "node-red-node-feedparser", "node-red-node-rbe",
                    "node-red-node-sentiment", "node-red-node-tail", "node-red-node-twitter"].indexOf(key) === -1) {
                    var pname: string = val.name + "@" + val.version;
                    if (val.pending_version) {
                        pname = val.name + "@" + val.pending_version;
                    }
                    // this._logger.info("Installing " + pname);
                    // child_process.execSync("npm install " + pname, { stdio: [0, 1, 2], cwd: this.settings.userDir });
                    modules += (" " + pname);
                }
            }
            this._logger.info("Installing " + modules);
            var errorcounter = 0;
            while (errorcounter < 5) {
                try {
                    child_process.execSync("npm install " + modules, { stdio: [0, 1, 2], cwd: this.settings.userDir });
                    errorcounter = 10;
                } catch (error) {
                    errorcounter++;
                    this._logger.error("npm install error");
                    if (error.status) this._logger.error("npm install status: " + error.status);
                    if (error.message) this._logger.error("npm install message: " + error.message);
                    if (error.stderr) this._logger.error("npm install stderr: " + error.stderr);
                    if (error.stdout) this._logger.error("npm install stdout: " + error.stdout);
                }
            }
            this._logger.silly("noderedcontribopenflowstorage::_getSettings: return result");
            return settings;
        } catch (error) {
            if (error.message) { this._logger.error(error.message); }
            else { this._logger.error(error); }
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
                await NoderedUtil.UpdateOne("nodered", null, result[0], 1, true, null);
            }
        } catch (error) {
            if (error.message) { this._logger.error(error.message); }
            else { this._logger.error(error); }
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
            return [];
        }
    }
    public async _saveSessions(sessions: any[]): Promise<void> {
        try {
            var result = await NoderedUtil.Query("nodered", { _type: "session", nodered_id: Config.nodered_id }, null, null, 1, 0, null);
            if (result.length === 0) {
                var item: any = {
                    name: "sessions for " + Config.nodered_id,
                    sessions: JSON.stringify(sessions), _type: "session", nodered_id: Config.nodered_id
                };
                await NoderedUtil.InsertOne("nodered", item, 1, true, null);
            } else {
                result[0].sessions = JSON.stringify(sessions);
                await NoderedUtil.UpdateOne("nodered", null, result[0], 1, true, null);
            }
        } catch (error) {
            if (error.message) { this._logger.error(error.message); }
            else { this._logger.error(error); }
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
