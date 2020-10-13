import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import winston = require("winston");
import { nodered_settings } from "./nodered_settings";
import { Config } from "./Config";
import { WebSocketClient, NoderedUtil, Base } from "openflow-api";
import * as nodered from "node-red";
const fileCache = require('file-system-cache').default;
const backupStore = fileCache({ basePath: path.join(Config.logpath, '.cache') });
export class noderednpmrc {
    public _id: string;
    public _type: string = "npmrc";
    public name: string;
    public nodered_id: string;
    public content: string;
    public catalogues: string[] = [];
}
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
    private static iv_length: number = 16; // for AES, this is always 16
    private static encryption_key: string = ("smurfkicks-to-anyone-hating-on-nodejs").substr(0, 32);
    static encrypt(text: string): string {
        try {
            let iv: Buffer = crypto.randomBytes(this.iv_length);
            let cipher: crypto.Cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(this.encryption_key), iv);
            let encrypted: Buffer = cipher.update((text as any));
            encrypted = Buffer.concat([encrypted, cipher.final()]);
            return iv.toString("hex") + ":" + encrypted.toString("hex");
        } catch (error) {
            console.error(error);
        }
        return text;
    }
    static decrypt(text: string): string {
        try {
            let textParts: string[] = text.split(":");
            let iv: Buffer = Buffer.from(textParts.shift(), "hex");
            let encryptedText: Buffer = Buffer.from(textParts.join(":"), "hex");
            let decipher: crypto.Decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(this.encryption_key), iv);
            let decrypted: Buffer = decipher.update(encryptedText);
            decrypted = Buffer.concat([decrypted, decipher.final()]);
            return decrypted.toString();
        } catch (error) {
            console.error(error);
        }
        return text;
    }
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
    private _credentials: any[] = null;
    private _settings: any = null;
    public async CheckUpdates() {
        try {
            let oldsettings: any[] = null;
            if (this._settings != null) oldsettings = JSON.parse(JSON.stringify(this._settings));

            let oldflows: any[] = null;
            if (this._flows != null) oldflows = JSON.parse(JSON.stringify(this._flows));

            let oldcredentials: any[] = null;
            if (this._credentials != null) oldcredentials = JSON.parse(JSON.stringify(this._credentials));

            let update: boolean = false;
            let donpm: boolean = false;

            let flows: any[] = await this._getFlows();
            if (oldflows != null) {
                if (flows.length != this._flows.length) {
                    update = true;
                } else {
                    if (this.DiffObjects(flows, oldflows)) {
                        update = true;
                    }
                }
            } else {
                this._flows = flows;
            }

            let credentials: any[] = await this._getCredentials();
            if (oldcredentials != null) {
                if (credentials.length != this._credentials.length) {
                    update = true;
                } else {
                    if (this.DiffObjects(credentials, oldcredentials)) {
                        update = true;
                    }
                }
            } else {
                this._credentials = credentials;
            }

            let settings: any[] = await this.getSettings();
            if (oldsettings != null) {
                if (this.DiffObjects(settings, oldsettings)) {
                    update = true;
                    donpm = true;
                }
            } else {
                this._settings = settings;
            }
            if (donpm) {
                this._settings = null;
                this._settings = await this.getSettings();
            }
            if (update) {
                this._flows = flows;
                this._settings = settings;
                await this.RED.nodes.loadFlows(true);
            }
        } catch (error) {
            this._logger.error(error);
        }
        if (!WebSocketClient.instance.supports_watch) {
            setTimeout(this.CheckUpdates.bind(this), Config.flow_refresh_interval);
        }


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
    public npmrc: noderednpmrc = null;
    public async _getnpmrc(): Promise<noderednpmrc> {
        // var result: noderednpmrc = null;
        try {
            this._logger.silly("noderedcontribopenflowstorage::_getnpmrc");
            if (WebSocketClient.instance != null && WebSocketClient.instance.isConnected()) {
                var array = await NoderedUtil.Query("nodered", { _type: "npmrc", nodered_id: Config.nodered_id }, null, null, 1, 0, null);
                if (array.length === 0) { return null; }
                try {
                    this.npmrc = array[0];
                } catch (error) {
                    if (error.message) { this._logger.error(error.message); }
                    else { this._logger.error(error); }
                    this.npmrc = null;
                }
            }
        } catch (error) {
            if (error.message) { this._logger.error(error.message); }
            else { this._logger.error(error); }
            this.npmrc = null;
        }
        try {
            const filename: string = Config.nodered_id + "_npmrc.txt";
            if (this.npmrc == null) {
                const json = await backupStore.get(filename);
                if (!NoderedUtil.IsNullEmpty(json)) {
                    this.npmrc = JSON.parse(json);
                }
            } else {
                await backupStore.set(filename, JSON.stringify(this.npmrc));
            }
            return this.npmrc;
        } catch (error) {
            if (error.message) { this._logger.error(error.message); }
            else { this._logger.error(error); }
            this.npmrc = null;
        }
        return null;
    }
    public async _setnpmrc(npmrc: noderednpmrc): Promise<void> {
        try {
            this.npmrc = npmrc;
            this._logger.silly("noderedcontribopenflowstorage::_setnpmrc");
            const filename: string = Config.nodered_id + "_npmrc.txt";
            await backupStore.set(filename, JSON.stringify(npmrc));
            if (WebSocketClient.instance.isConnected()) {
                var result = await NoderedUtil.Query("nodered", { _type: "npmrc", nodered_id: Config.nodered_id }, null, null, 1, 0, null);
                if (result.length === 0) {
                    npmrc.name = "npmrc for " + Config.nodered_id;
                    npmrc.nodered_id = Config.nodered_id;
                    npmrc._type = "npmrc";
                    await NoderedUtil.InsertOne("nodered", npmrc, 1, true, null);
                } else {
                    npmrc._id = result[0]._id;
                    await NoderedUtil.UpdateOne("nodered", null, npmrc, 1, true, null);
                }
            }
        } catch (error) {
            if (error.message) { this._logger.error(error.message); }
            else { this._logger.error(error); }
        }
    }
    public async _getFlows(): Promise<any[]> {
        var result: any[] = [];
        try {
            this._logger.silly("noderedcontribopenflowstorage::_getFlows");
            if (WebSocketClient.instance.isConnected()) {
                var array = await NoderedUtil.Query("nodered", { _type: "flow", nodered_id: Config.nodered_id }, null, null, 1, 0, null);
                if (array.length === 0) { return []; }
                try {
                    this._flows = JSON.parse(array[0].flows);
                    result = this._flows;
                } catch (error) {
                    if (error.message) { this._logger.error(error.message); }
                    else { this._logger.error(error); }
                    result = [];
                }
            }
        } catch (error) {
            if (error.message) { this._logger.error(error.message); }
            else { this._logger.error(error); }
            result = [];
        }
        const filename: string = Config.nodered_id + "_flows.json";
        if (result.length == 0) {
            const json = await backupStore.get(filename);
            if (!NoderedUtil.IsNullEmpty(json)) {
                this._flows = JSON.parse(json);
                result = this._flows;
            }
        } else {
            await backupStore.set(filename, JSON.stringify(result));
        }
        return result;
    }
    public async _saveFlows(flows: any[]): Promise<void> {
        try {
            this._logger.silly("noderedcontribopenflowstorage::_saveFlows");
            const filename: string = Config.nodered_id + "_flows.json";
            await backupStore.set(filename, JSON.stringify(flows));
            if (WebSocketClient.instance.isConnected()) {
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
            }
        } catch (error) {
            if (error.message) { this._logger.error(error.message); }
            else { this._logger.error(error); }
        }
    }
    public async _getCredentials(): Promise<any> {
        var cred: any = [];
        try {
            this._logger.silly("noderedcontribopenflowstorage::_getCredentials");
            if (WebSocketClient.instance.isConnected()) {
                var result = await NoderedUtil.Query("nodered", { _type: "credential", nodered_id: Config.nodered_id }, null, null, 1, 0, null);
                if (result.length === 0) { return []; }
                cred = result[0].credentials;
                var arr: any = result[0].credentialsarray;
                if (arr !== null && arr !== undefined) {
                    cred = {};
                    for (var i = 0; i < arr.length; i++) {
                        var key = arr[i].key;
                        var value = arr[i].value;
                        cred[key] = value;
                    }
                }
                this._credentials = cred;
            }
        } catch (error) {
            if (error.message) { this._logger.error(error.message); }
            else { this._logger.error(error); }
            cred = [];
        }
        const filename: string = Config.nodered_id + "_credentials";
        if (cred.length == 0) {
            let json = await backupStore.get(filename);
            if (!NoderedUtil.IsNullEmpty(json)) {
                json = noderedcontribopenflowstorage.decrypt(json);
                this._credentials = JSON.parse(json);
                cred = this._credentials;
            }
        } else {
            await backupStore.set(filename, noderedcontribopenflowstorage.encrypt(JSON.stringify(cred)));
        }
        return cred;
    }
    public async _saveCredentials(credentials: any): Promise<void> {
        try {
            this._logger.silly("noderedcontribopenflowstorage::_saveCredentials");
            const filename: string = Config.nodered_id + "_credentials";
            await backupStore.set(filename, noderedcontribopenflowstorage.encrypt(JSON.stringify(credentials)));
            if (WebSocketClient.instance.isConnected()) {
                var result = await NoderedUtil.Query("nodered", { _type: "credential", nodered_id: Config.nodered_id }, null, null, 1, 0, null);
                var credentialsarray = [];
                var orgkeys = Object.keys(credentials);
                for (var i = 0; i < orgkeys.length; i++) {
                    var key = orgkeys[i];
                    var value = credentials[key];
                    var obj = { key: key, value: value };
                    credentialsarray.push(obj);
                }
            }
            if (credentials) {
                if (result.length === 0) {
                    var item: any = {
                        name: "credentials for " + Config.nodered_id,
                        credentials: credentials, credentialsarray: credentialsarray, _type: "credential", nodered_id: Config.nodered_id,
                        _encrypt: ["credentials", "credentialsarray"]
                    };
                    var subresult = await NoderedUtil.InsertOne("nodered", item, 1, true, null);
                } else {
                    var item: any = result[0];
                    item.credentials = credentials;
                    item.credentialsarray = credentialsarray;
                    item._encrypt = ["credentials", "credentialsarray"];
                    var subresult = await NoderedUtil.UpdateOne("nodered", null, item, 1, true, null);
                }
                this._credentials = credentials;
            }
        } catch (error) {
            if (error.message) { this._logger.error(error.message); }
            else { this._logger.error(error); }
        }
    }
    private firstrun: boolean = true;
    public async _getSettings(): Promise<any> {
        var settings: any = null;
        try {
            this._logger.silly("noderedcontribopenflowstorage::_getSettings");
            if (WebSocketClient.instance.isConnected()) {
                var result = await NoderedUtil.Query("nodered", { _type: "setting", nodered_id: Config.nodered_id }, null, null, 1, 0, null);
                if (result.length === 0) { return {}; }
                settings = JSON.parse(result[0].settings);
            }
        } catch (error) {
            if (error.message) { this._logger.error(error.message); }
            else { this._logger.error(error); }
        }
        const filename: string = Config.nodered_id + "_settings";
        try {
            //if (this.firstrun) {
            var npmrc = await this._getnpmrc();
            var npmrcFile: string = path.join(this.settings.userDir, ".npmrc");
            if (!NoderedUtil.IsNullUndefinded(npmrc) && !NoderedUtil.IsNullUndefinded(npmrc.content)) {
                fs.writeFileSync(npmrcFile, npmrc.content);
                // } else if (fs.existsSync(npmrcFile)) {
                //     npmrc = new noderednpmrc();
                //     npmrc.content = fs.readFileSync(npmrcFile, "utf8");
                //     await this._setnpmrc(npmrc);
            }
            //}
        } catch (error) {
            if (error.message) { this._logger.error(error.message); }
            else { this._logger.error(error); }
        }
        if (settings == null) {
            settings = {};
            const json = await backupStore.get(filename);
            if (!NoderedUtil.IsNullEmpty(json)) {
                this._settings = JSON.parse(json);
                settings = this._settings;
            }
        } else {
            if (this._settings == null) {
                this._settings = settings;
                try {

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
                } catch (error) {
                    if (error.message) { this._logger.error(error.message); }
                    else { this._logger.error(error); }
                    settings = {};
                }
            }
            this._settings = settings;
            await backupStore.set(filename, JSON.stringify(settings));
        }
        try {
            if (this.firstrun) {
                if (WebSocketClient.instance.user != null) {
                    if (WebSocketClient.instance.supports_watch) {
                        await NoderedUtil.Watch("nodered", [{ "$match": { "fullDocument.nodered_id": Config.nodered_id } }], WebSocketClient.instance.jwt, this.onupdate.bind(this));
                    } else {
                        setTimeout(this.CheckUpdates.bind(this), Config.flow_refresh_initial_interval);
                    }
                    this.firstrun = false;
                }
                WebSocketClient.instance.events.on("onsignedin", async () => {
                    try {
                        this.firstrun = false;
                        if (WebSocketClient.instance.supports_watch) {
                            try {
                                await this.CheckUpdates();
                            } catch (error) {
                                console.error(error);
                            }
                            await NoderedUtil.Watch("nodered", [{ "$match": { "fullDocument.nodered_id": Config.nodered_id } }], WebSocketClient.instance.jwt, this.onupdate.bind(this));
                        } else {
                            setTimeout(this.CheckUpdates.bind(this), Config.flow_refresh_initial_interval);
                        }
                    } catch (error) {
                        console.error(error);
                    }
                });
            }
        } catch (error) {
            console.error(error);
        }
        return settings;
    }
    public last_reload: Date = new Date();
    public async onupdate(msg: any) {
        let update: boolean = false;
        let entity: Base = msg.fullDocument;

        var begin: number = this.last_reload.getTime();
        var end: number = new Date().getTime();
        var seconds = Math.round((end - begin) / 1000);
        if (seconds < 2) {
            console.log("**************************************************");
            console.log("* " + entity._type);
            console.log("* Skip, less than 2 seconds since last update " + seconds);
            console.log("**************************************************");
            return;
        }
        if (entity._type == "flow") {
            let oldflows: any[] = null;
            if (this._flows != null) {
                oldflows = JSON.parse(JSON.stringify(this._flows));
                if (this.DiffObjects(entity, oldflows)) {
                    update = true;
                    this._flows = (entity as any).flows;
                }
            } else {
                update = true;
                this._flows = (entity as any).flows;
            }
        } else if (entity._type == "credential") {
            let oldcredentials: any[] = null;
            if (this._credentials != null) {
                oldcredentials = JSON.parse(JSON.stringify(this._credentials));
                if (this.DiffObjects(entity, oldcredentials)) {
                    update = true;
                }
            } else {
                update = true;
            }
        } else if (entity._type == "setting") {
            try {
                await this.RED.nodes.loadFlows(true);
            } catch (error) {
            }
            let oldsettings: any = null;
            if (this._settings != null) {
                oldsettings = JSON.parse(JSON.stringify(this._settings));
                let newsettings = (entity as any).settings;
                newsettings = JSON.parse(newsettings);

                var keys = Object.keys(oldsettings.nodes);
                var modules = {};
                for (var i = 0; i < keys.length; i++) {
                    var key = keys[i];
                    if (key != "node-red") {
                        var val = oldsettings.nodes[key];
                        try {
                            if (newsettings.nodes[key] == null) {
                                console.log("Remove module " + key + "@" + val.version);
                                await this.RED.runtime.nodes.removeModule({ user: "admin", module: key, version: val.version });
                            } else if (newsettings.nodes[key].version != oldsettings.nodes[key].version) {
                                console.log("Install module " + key + "@" + newsettings.nodes[key].version + " up from " + oldsettings.nodes[key].version);
                                await this.RED.runtime.nodes.addModule({ user: "admin", module: key, version: newsettings.nodes[key].version });
                            }
                        } catch (error) {
                            console.error((error.message ? error.message : error));
                        }
                    }
                }
                var keys = Object.keys(newsettings.nodes);
                for (var i = 0; i < keys.length; i++) {
                    var key = keys[i];
                    if (key != "node-red") {
                        var val = newsettings.nodes[key];
                        try {
                            if (oldsettings.nodes[key] == null) {
                                console.log("Install new module " + key + "@" + val.version);
                                await this.RED.runtime.nodes.addModule({ user: "admin", module: key, version: val.version });
                            } else if (newsettings.nodes[key].version != oldsettings.nodes[key].version) {
                                console.log("Install module " + key + "@" + newsettings.nodes[key].version + " up from " + oldsettings.nodes[key].version);
                                await this.RED.runtime.nodes.addModule({ user: "admin", module: key, version: val.version });
                            }
                        } catch (error) {
                            console.error((error.message ? error.message : error));
                        }
                    }
                }

                if (this.DiffObjects(newsettings, oldsettings)) {
                    update = true;
                }
            } else {
                update = true;
            }
        } else {
            console.log("**************************************************");
            console.log("* Unknown type " + entity._type + " last updated " + seconds + " seconds ago");
            console.log("**************************************************");

        }
        // if (donpm) {
        //     this._settings = null;
        //     this._settings = await this.getSettings();
        // }
        if (update) {
            // this.RED.nodes.startFlows();
            // this.RED.nodes.stopFlows();
            // this.RED.runtime.addModule("")

            // try {
            //     await this.RED.nodes.addModule("test-module");
            // } catch (error) {
            //     console.error(error);
            // }
            // try {
            //     var opts = {
            //         user: "admin",
            //         module: "node-red-contrib-rate",
            //         version: "1.4.0"
            //     }
            //     await this.RED.runtime.nodes.addModule(opts);
            // } catch (error) {
            //     console.error(error);
            // }
            // try {
            //     await this.RED.nodes.load();
            // } catch (error) {
            //     console.error(error);
            // }



            this.last_reload = new Date();
            console.log("**************************************************");
            console.log("* " + entity._type);
            console.log("* loadFlows last updated " + seconds + " seconds ago");
            console.log("**************************************************");
            await this.RED.nodes.loadFlows(true);
        }
    }
    public async _saveSettings(settings: any): Promise<void> {
        try {
            this._logger.silly("noderedcontribopenflowstorage::_saveSettings");
            const filename: string = Config.nodered_id + "_settings";
            await backupStore.set(filename, JSON.stringify(settings));
            if (WebSocketClient.instance.isConnected()) {
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
            }
            this._settings = settings;
        } catch (error) {
            if (error.message) { this._logger.error(error.message); }
            else { this._logger.error(error); }
        }
    }

    public async _getSessions(): Promise<any[]> {
        var item: any[] = [];
        try {
            this._logger.silly("noderedcontribopenflowstorage::_getSessions");
            if (WebSocketClient.instance.isConnected()) {
                var result = await NoderedUtil.Query("nodered", { _type: "session", nodered_id: Config.nodered_id }, null, null, 1, 0, null);
                if (result.length === 0) { return []; }
                item = JSON.parse(result[0].sessions);
            }
        } catch (error) {
            if (error.message) { this._logger.error(error.message); }
            else { this._logger.error(error); }
            item = [];
        }
        const filename: string = Config.nodered_id + "_sessions";
        if (item == null || item.length == 0) {
            const json = await backupStore.get(filename);
            if (!NoderedUtil.IsNullEmpty(json)) {
                item = JSON.parse(json);
            }
        } else {
            await backupStore.set(filename, JSON.stringify(item));
        }
        return item;
    }
    public async _saveSessions(sessions: any[]): Promise<void> {
        try {
            const filename: string = Config.nodered_id + "_sessions";
            await backupStore.set(filename, JSON.stringify(sessions));
            if (WebSocketClient.instance.isConnected()) {
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
