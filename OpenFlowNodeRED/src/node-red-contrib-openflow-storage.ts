import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { nodered_settings } from "./nodered_settings";
import { Config } from "./Config";
import { WebSocketClient, NoderedUtil, Base } from "@openiap/openflow-api";
import * as nodered from "node-red";
import { FileSystemCache } from "./file-system-cache";
import { servicename } from "./nodeclient/cliutil";
import { pm2restart } from "./nodeclient/pm2util";
import { Logger } from "./Logger";
const child_process = require("child_process");
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

    private backupStore: FileSystemCache = null;
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
    constructor(socket: WebSocketClient) {
        this.RED = nodered;
        this.backupStore = new FileSystemCache(path.join(Config.logpath, '.cache-' + Config.nodered_id));
        this.getFlows = (this._getFlows.bind(this));
        this.saveFlows = (this._saveFlows.bind(this));
        this.getCredentials = (this._getCredentials.bind(this));
        this.saveCredentials = (this._saveCredentials.bind(this));
        this.getSettings = (this._getSettings.bind(this));
        this.saveSettings = (this._saveSettings.bind(this));
        this.getSessions = (this._getSessions.bind(this));
        this.saveSessions = (this._saveSessions.bind(this));
        this.getLibraryEntry = (this._getLibraryEntry.bind(this));
        this.saveLibraryEntry = (this._saveLibraryEntry.bind(this));
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
        let iv: Buffer = crypto.randomBytes(this.iv_length);
        let cipher: crypto.CipherGCM = crypto.createCipheriv('aes-256-gcm', Buffer.from(this.encryption_key), iv);
        let encrypted: Buffer = cipher.update((text as any));
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        const authTag = cipher.getAuthTag()
        return iv.toString("hex") + ":" + encrypted.toString("hex") + ":" + authTag.toString("hex");
    }
    static decrypt(text: string): string {
        let textParts: string[] = text.split(":");
        let iv: Buffer = Buffer.from(textParts.shift(), "hex");
        let encryptedText: Buffer = Buffer.from(textParts.shift(), "hex");
        let authTag: Buffer = null;
        if (textParts.length > 0) authTag = Buffer.from(textParts.shift(), "hex");
        let decrypted: Buffer
        if (authTag != null) {
            let decipher: crypto.DecipherGCM = crypto.createDecipheriv('aes-256-gcm', Buffer.from(this.encryption_key), iv);
            decipher.setAuthTag(authTag);
            decrypted = decipher.update(encryptedText);
            decrypted = Buffer.concat([decrypted, decipher.final()]);
        } else {
            let decipher2: crypto.Decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(this.encryption_key), iv);
            decrypted = decipher2.update(encryptedText);
            decrypted = Buffer.concat([decrypted, decipher2.final()]);
        }
        return decrypted.toString();
    }




    scanDirForNodesModules(dir) {
        let files = fs.readdirSync(dir, { encoding: 'utf8', withFileTypes: true });
        let results = [];
        files.sort();
        files.forEach((fn) => {
            var stats = fs.statSync(path.join(dir, fn.name));
            if (stats.isFile()) {
            } else if (stats.isDirectory()) {
                if (fn.name == "node_modules") {
                    results = results.concat(this.scanDirForNodesModules(path.join(dir, fn.name)));
                } else {
                    const pkgfn = path.join(dir, fn.name, "package.json");
                    if (fs.existsSync(pkgfn)) {
                        var pkg = require(pkgfn);
                        // var moduleDir = path.join(dir, fn);
                        // results.push({ dir: moduleDir, package: pkg });
                        results.push(pkg);
                    }
                }
            }
        });
        return results;
    }
    async GetMissingModules(settings: any) {
        // let currentmodules = this.scanDirForNodesModules(path.resolve('.'));
        let currentmodules = this.scanDirForNodesModules(this.settings.userDir);
        let globaldir: string = "";
        try {
            globaldir = child_process.execSync('npm root -g').toString();
            if (globaldir.indexOf('\n')) {
                if (globaldir.endsWith('\n')) globaldir = globaldir.substr(0, globaldir.length - 1);
                globaldir = globaldir.substr(globaldir.lastIndexOf('\n') + 1);
            }
            if (globaldir != null && globaldir != "") currentmodules = currentmodules.concat(this.scanDirForNodesModules(globaldir));
        } catch (error) {
            console.error(error);
        }
        let keys: string[];
        let modules = "";
        if (NoderedUtil.IsNullUndefinded(settings)) return modules;
        if (!NoderedUtil.IsNullUndefinded(settings.nodes)) {
            keys = Object.keys(settings.nodes);
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];
                if (key == "node-red" || key == "node-red-node-rbe" || key == "node-red-node-tail") continue;
                const val = settings.nodes[key];
                const version = (val.pending_version ? val.pending_version : val.version)
                const pcks = currentmodules.filter(x => x.name == key && x.version == version);
                if (pcks.length != 1) {
                    modules += (" " + key + "@" + version);
                } else {
                    Logger.instanse.debug("storage", "GetMissingModules", "Skipping " + key + "@" + version + " found locally or " + globaldir);
                }
            }
        }
        if (!NoderedUtil.IsNullUndefinded(settings.modules)) {
            keys = Object.keys(settings.modules);
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];
                const val = settings.modules[key];
                if (val.builtin || val.known) continue;
                const pcks = currentmodules.filter(x => x.name == key);
                if (pcks.length != 1) {
                    modules += (" " + key);
                } else {
                    Logger.instanse.debug("storage", "GetMissingModules", "Skipping " + key + " found locally or " + globaldir);
                }
            }
        }
        return modules.trim();
    }
    // key + "@" + version
    installNPMPackage(pck: string) {
        try {
            Logger.instanse.info("storage", "installNPMPackage", "Installing " + pck);
            child_process.execSync("npm install " + pck, { stdio: [0, 1, 2], cwd: this.settings.userDir });
        } catch (error) {
            Logger.instanse.error("storage", "installNPMPackage", "npm install error");
            if (error.status) Logger.instanse.error("storage", "installNPMPackage", "npm install status: " + error.status);
            if (error.message) Logger.instanse.error("storage", "installNPMPackage", "npm install message: " + error.message);
            if (error.stderr) Logger.instanse.error("storage", "installNPMPackage", "npm install stderr: " + error.stderr);
            if (error.stdout) Logger.instanse.error("storage", "installNPMPackage", "npm install stdout: " + error.stdout);
        }

    }
    DiffObjects(o1, o2) {
        // choose a map() impl.
        const map = Array.prototype.map ?
            function (a) { return Array.prototype.map.apply(a, Array.prototype.slice.call(arguments, 1)); } :
            function (a, f) {
                const ret = new Array(a.length);
                for (let i = 0, length = a.length; i < length; i++)
                    ret[i] = f(a[i], i);
                return ret.concat();
            };

        // shorthand for push impl.
        const push = Array.prototype.push;

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
            const diff = [];
            for (let i = 0; i < o1.length; i++) {
                // per element nested diff
                const innerDiff = this.DiffObjects(o1[i], o2[i]);
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
            const diff = [];
            // check all props in o1
            for (let prop in o1) {
                // the double check in o1 is because in V8 objects remember keys set to undefined 
                if ((typeof o2[prop] == "undefined") && (typeof o1[prop] != "undefined")) {
                    // prop exists in o1 but not in o2
                    diff.push(["[" + prop + "]", "undefined", o1[prop], undefined]); // prop exists in o1 but not in o2

                }
                else {
                    // per element nested diff
                    const innerDiff = this.DiffObjects(o1[prop], o2[prop]);
                    if (innerDiff) { // o1[prop] != o2[prop]
                        // merge diff array into parent's while including parent object name ([prop])
                        push.apply(diff, map(innerDiff, function (o, j) { o[0] = "[" + prop + "]" + o[0]; return o; }));
                    }

                }
            }
            for (let prop in o2) {
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
            Logger.instanse.error("storage", "CheckUpdates", error);
        }
        if (!WebSocketClient.instance.supports_watch) {
            setTimeout(this.CheckUpdates.bind(this), Config.flow_refresh_interval);
        }


    }
    public async init(settings: any): Promise<boolean> {
        Logger.instanse.silly("storage", "init", "init");
        this.settings = settings;
        const packageFile: string = path.join(this.settings.userDir, "package.json");
        try {
            if (!fs.existsSync(this.settings.userDir)) {
                fs.mkdirSync(this.settings.userDir);
            }
            fs.statSync(packageFile);
            process.chdir(this.settings.userDir);
            Logger.instanse.debug("storage", "init", packageFile + " exists.");
        } catch (err) {
        }
        // Lets overwrite each time!
        const defaultPackage: any = {
            "name": "openflow-project",
            "license": "MPL-2.0",
            "description": "A OpenFlow Node-RED Project",
            "version": "0.0.1",
            "dependencies": {},
            "repository": {
                "type": "git",
                "url": "git+https://github.com/open-rpa/openflow.git"
            },
        };
        // Let's not !
        if (!fs.existsSync(packageFile)) {
            Logger.instanse.debug("storage", "init", "creating new packageFile " + packageFile);
            fs.writeFileSync(packageFile, JSON.stringify(defaultPackage, null, 4));
        }
        // const dbsettings = await this._getSettings();
        // spawn gettings, so it starts installing
        return true;
    }
    public npmrc: noderednpmrc = null;
    public async _getnpmrc(): Promise<noderednpmrc> {
        // const result: noderednpmrc = null;
        try {
            Logger.instanse.silly("storage", "init", "_getnpmrc");
            if (WebSocketClient.instance != null && WebSocketClient.instance.isConnected()) {
                const array = await NoderedUtil.Query({ collectionname: "nodered", query: { _type: "npmrc", nodered_id: Config.nodered_id }, top: 1 });
                if (NoderedUtil.IsNullUndefinded(array) || array.length === 0) { return null; }
                try {
                    this.npmrc = array[0];
                } catch (error) {
                    Logger.instanse.error("storage", "init", error);
                    this.npmrc = null;
                }
            }
        } catch (error) {
            Logger.instanse.error("storage", "init", error);
            this.npmrc = null;
        }
        try {
            // const filename: string = Config.nodered_id + "_npmrc.txt";
            // if (this.npmrc == null) {
            //     const json = await backupStore.get<string>(filename, null);
            //     if (!NoderedUtil.IsNullEmpty(json)) {
            //         this.npmrc = JSON.parse(json);
            //     }
            // } else {
            //     await backupStore.set(filename, JSON.stringify(this.npmrc));
            // }
            return this.npmrc;
        } catch (error) {
            Logger.instanse.error("storage", "init", error);
            this.npmrc = null;
        }
        return null;
    }
    public async _setnpmrc(npmrc: noderednpmrc): Promise<void> {
        try {
            this.npmrc = npmrc;
            Logger.instanse.silly("storage", "setnpmrc", "begin");
            // const filename: string = Config.nodered_id + "_npmrc.txt";
            // await backupStore.set(filename, JSON.stringify(npmrc));
            if (WebSocketClient.instance.isConnected()) {
                const result = await NoderedUtil.Query({ collectionname: "nodered", query: { _type: "npmrc", nodered_id: Config.nodered_id }, top: 1 });
                if (NoderedUtil.IsNullUndefinded(result) || result.length === 0) {
                    npmrc.name = "npmrc for " + Config.nodered_id;
                    npmrc.nodered_id = Config.nodered_id;
                    npmrc._type = "npmrc";
                    await NoderedUtil.InsertOne({ collectionname: "nodered", item: npmrc });
                } else {
                    npmrc._id = result[0]._id;
                    await NoderedUtil.UpdateOne({ collectionname: "nodered", item: npmrc });
                }
            }
        } catch (error) {
            Logger.instanse.error("storage", "setnpmrc", error);
        }
    }
    public async _getFlows(): Promise<any[]> {
        let result: any[] = [];
        try {
            Logger.instanse.silly("storage", "getFlows", "getFlows");
            if (WebSocketClient.instance.isConnected()) {
                const array = await NoderedUtil.Query({ collectionname: "nodered", query: { _type: "flow", "$or": [{ nodered_id: Config.nodered_id }, { shared: true }] }, top: 5 });
                if (NoderedUtil.IsNullUndefinded(array) || array.length === 0) { return []; }
                console.log("******************************");
                try {
                    var flows = [];
                    for (var i = 0; i < array.length; i++) {
                        this.versions[array[i]._id] = array[i]._version;
                        if (array[i].shared == true) {
                            var arr = JSON.parse(array[i].flows);
                            if (!arr[0].env) arr[0].env = [];
                            arr[0].env = arr[0].env.filter(x => x.name != "_id");
                            arr[0].env.push({ name: '_id', type: 'str', value: array[i]._id })
                            console.log("* subflow id: " + array[i]._id + " version: " + array[i]._version);
                            flows = flows.concat(arr);
                        } else {
                            console.log("* mainflow id: " + array[i]._id + " version: " + array[i]._version);
                            flows = flows.concat(JSON.parse(array[i].flows));
                        }
                    }
                    this._flows = flows;
                    result = this._flows;
                } catch (error) {
                    Logger.instanse.error("storage", "getFlows", error);
                    result = [];
                }
                console.log("******************************");
            }
        } catch (error) {
            Logger.instanse.error("storage", "getFlows", error);
            result = [];
        }
        const filename: string = Config.nodered_id + "_flows.json";
        if (NoderedUtil.IsNullUndefinded(result) || result.length == 0) {
            const json = await this.backupStore.get<string>(filename, null);
            if (!NoderedUtil.IsNullEmpty(json)) {
                this._flows = JSON.parse(json);
                result = this._flows;
            }
        } else {
            await this.backupStore.set(filename, JSON.stringify(result));
        }
        return result;
    }
    public async _saveFlows(flows: any[]): Promise<void> {
        try {
            Logger.instanse.info("storage", "saveFlows", "begin");
            const filename: string = Config.nodered_id + "_flows.json";
            await this.backupStore.set(filename, JSON.stringify(flows));

            if (WebSocketClient.instance.isConnected()) {
                const mainflow = [];
                let sharedflows: any = {};
                const ids = [];
                for (var i = 0; i < flows.length; i++) {
                    var node = flows[i];
                    if (node.type == "tab" || node.type == "subflow") {
                        var _id = null;
                        if (node.env) _id = node.env.filter(x => x.name == "_id");
                        if (node.label && (node.label as string).startsWith("__")) {
                            ids.push(node.id);
                            if (!sharedflows[node.id]) sharedflows[node.id] = [];
                        } else if (_id && _id.length > 0) {
                            ids.push(node.id);
                            if (!sharedflows[node.id]) sharedflows[node.id] = [];
                        }
                    }
                }
                for (var i = 0; i < flows.length; i++) {
                    var node = flows[i];
                    if (ids.indexOf(node.id) > -1) {
                        sharedflows[node.id].push(node);
                    } else if (node.z && ids.indexOf(node.z) > -1) {
                        sharedflows[node.z].push(node);
                    } else {
                        mainflow.push(node);
                    }
                }
                const result = await NoderedUtil.Query({ collectionname: "nodered", query: { _type: "flow", nodered_id: Config.nodered_id }, top: 1 });
                if (NoderedUtil.IsNullUndefinded(result) || result.length === 0) {
                    const item: any = {
                        name: "flows for " + Config.nodered_id,
                        flows: JSON.stringify(mainflow), _type: "flow", nodered_id: Config.nodered_id
                    };
                    var iresult = await NoderedUtil.InsertOne({ collectionname: "nodered", item });
                    if (!NoderedUtil.IsNullUndefinded(iresult)) this.versions[iresult._id] = iresult._version;
                } else {
                    result[0].flows = JSON.stringify(mainflow);
                    this.versions[result[0]._id] = result[0]._version + 1;
                    var uresult = await NoderedUtil.UpdateOne({ collectionname: "nodered", item: result[0] });
                    if (!NoderedUtil.IsNullUndefinded(uresult)) this.versions[uresult._id] = uresult._version;
                }
                let update: boolean = false;
                let keys = Object.keys(sharedflows);
                if (keys.length > 0) {
                    console.log("******************************");
                    for (let i = 0; i < keys.length; i++) {
                        let key = keys[i];
                        let arr = sharedflows[key];
                        let node = arr[0];
                        let result2 = [];
                        var _id = null;
                        if (node.env) _id = node.env.filter(x => x.name == "_id");

                        if (_id && _id.length > 0) {
                            console.log("* query id: " + _id[0].value);
                            result2 = await NoderedUtil.Query({ collectionname: "nodered", query: { _type: "flow", _id: _id[0].value }, top: 1 });
                        }
                        if (NoderedUtil.IsNullUndefinded(result2) || result2.length === 0) {
                            update = true;
                            const item: any = {
                                name: "shared flows: " + node.label,
                                flows: JSON.stringify(arr), _type: "flow", shared: true
                            };
                            var iresult = await NoderedUtil.InsertOne({ collectionname: "nodered", item });
                            if (!NoderedUtil.IsNullUndefinded(iresult)) {
                                this.versions[iresult._id] = iresult._version;
                                console.log("* updated id: " + _id[0].value + " version: " + iresult._version);
                            } else {
                                this.RED.log.error("Failed updating flow!");
                            }
                        } else {
                            result2[0].flows = JSON.stringify(arr);
                            result2[0].name = "shared flows: " + node.label;
                            this.versions[_id[0].value] = result2[0]._version + 1; // bump version before saving, some times the change stream is faster than UpdateOne
                            var uresult = await NoderedUtil.UpdateOne({ collectionname: "nodered", item: result2[0] });
                            if (!NoderedUtil.IsNullUndefinded(uresult)) {
                                this.versions[uresult._id] = uresult._version;
                                console.log("* new id: " + uresult._id + " version: " + uresult._version);
                            } else {
                                this.RED.log.error("Failed adding new flow!");
                            }
                        }
                    }
                    console.log("******************************");
                }
                if (update == true) {
                    // reload flows to add the _id
                    await this.RED.nodes.loadFlows(true);
                }
                this._flows = flows;
            } else {
                this.RED.log.warn("Flow only saved locally, not connected to openflow!");
            }
        } catch (error) {
            Logger.instanse.error("storage", "saveFlows", error);
        } finally {
            Logger.instanse.silly("storage", "saveFlows", "end");
        }
    }
    public async _getCredentials(): Promise<any> {
        let cred: any = [];
        try {
            Logger.instanse.silly("storage", "getCredentials", "begin");
            if (WebSocketClient.instance.isConnected()) {
                const result = await NoderedUtil.Query({ collectionname: "nodered", query: { _type: "credential", nodered_id: Config.nodered_id }, top: 1 });
                if (NoderedUtil.IsNullUndefinded(result) || result.length === 0) { return []; }
                cred = result[0].credentials;
                const arr: any = result[0].credentialsarray;
                if (arr !== null && arr !== undefined) {
                    cred = {};
                    for (let i = 0; i < arr.length; i++) {
                        const key = arr[i].key;
                        const value = arr[i].value;
                        cred[key] = value;
                    }
                }
                this._credentials = cred;
            }
        } catch (error) {
            Logger.instanse.error("storage", "getCredentials", error);
            cred = [];
        }
        const filename: string = Config.nodered_id + "_credentials";
        if (NoderedUtil.IsNullUndefinded(cred) || cred.length == 0) {
            let json = await this.backupStore.get<string>(filename, null);
            if (!NoderedUtil.IsNullEmpty(json)) {
                json = noderedcontribopenflowstorage.decrypt(json);
                this._credentials = JSON.parse(json);
                cred = this._credentials;
            }
        } else {
            await this.backupStore.set(filename, noderedcontribopenflowstorage.encrypt(JSON.stringify(cred)));
        }
        return cred;
    }
    public async _saveCredentials(credentials: any): Promise<void> {
        try {
            Logger.instanse.silly("storage", "saveCredentials", "begin");
            const filename: string = Config.nodered_id + "_credentials";
            const credentialsarray = [];
            await this.backupStore.set(filename, noderedcontribopenflowstorage.encrypt(JSON.stringify(credentials)));
            let result: any[] = [];
            if (WebSocketClient.instance.isConnected()) {
                result = await NoderedUtil.Query({ collectionname: "nodered", query: { _type: "credential", nodered_id: Config.nodered_id }, top: 1 });
                const orgkeys = Object.keys(credentials);
                for (let i = 0; i < orgkeys.length; i++) {
                    const key = orgkeys[i];
                    const value = credentials[key];
                    const obj = { key: key, value: value };
                    credentialsarray.push(obj);
                }
            }
            if (credentials) {
                if (NoderedUtil.IsNullUndefinded(result) || result.length === 0) {
                    const item: any = {
                        name: "credentials for " + Config.nodered_id,
                        credentials: credentials, credentialsarray: credentialsarray, _type: "credential", nodered_id: Config.nodered_id,
                        _encrypt: ["credentials", "credentialsarray"]
                    };
                    const subresult = await NoderedUtil.InsertOne({ collectionname: "nodered", item });
                } else {
                    const item: any = result[0];
                    item.credentials = credentials;
                    item.credentialsarray = credentialsarray;
                    item._encrypt = ["credentials", "credentialsarray"];
                    const subresult = await NoderedUtil.UpdateOne({ collectionname: "nodered", item });
                }
                this._credentials = credentials;
            }
        } catch (error) {
            Logger.instanse.error("storage", "saveCredentials", error);
        }
    }
    private firstrun: boolean = true;
    public async _getSettings(): Promise<any> {
        let settings: any = null;
        try {
            Logger.instanse.silly("storage", "getSettings", "begin");
            if (WebSocketClient.instance.isConnected()) {
                const result = await NoderedUtil.Query({ collectionname: "nodered", query: { _type: "setting", nodered_id: Config.nodered_id }, top: 1 });
                if (NoderedUtil.IsNullUndefinded(result) || result.length === 0) { return {}; }
                this.versions[result[0]._id] = result[0]._version;
                settings = JSON.parse(result[0].settings);
            }
        } catch (error) {
            Logger.instanse.error("storage", "getSettings", error);
        }
        const filename: string = Config.nodered_id + "_settings";
        try {
            //if (this.firstrun) {
            const npmrc = await this._getnpmrc();
            const npmrcFile: string = path.join(this.settings.userDir, ".npmrc");
            if (!NoderedUtil.IsNullUndefinded(npmrc) && !NoderedUtil.IsNullUndefinded(npmrc.content)) {
                fs.writeFileSync(npmrcFile, npmrc.content);
                // } else if (fs.existsSync(npmrcFile)) {
                //     npmrc = new noderednpmrc();
                //     npmrc.content = fs.readFileSync(npmrcFile, "utf8");
                //     await this._setnpmrc(npmrc);
            } else if (!NoderedUtil.IsNullEmpty(Config.HTTP_PROXY) || !NoderedUtil.IsNullEmpty(Config.HTTPS_PROXY)) {
                // According to https://docs.npmjs.com/cli/v7/using-npm/config it should be picked up by envoriment variables, 
                // HTTP_PROXY, HTTPS_PROXY and NO_PROXY 
                const npmrc = new noderednpmrc();
                npmrc.content = "proxy=" + Config.HTTP_PROXY + "\n" + "https-proxy=" + Config.HTTPS_PROXY;
                if (!NoderedUtil.IsNullEmpty(Config.NO_PROXY)) {
                    npmrc.content += "\n" + "noproxy=" + Config.NO_PROXY;
                }
                npmrc.content += "\n" + "registry=http://registry.npmjs.org/";
                fs.writeFileSync(npmrcFile, npmrc.content);
            } else {
                if (fs.existsSync(npmrcFile)) {
                    fs.unlinkSync(npmrcFile);
                }
            }
            //}
        } catch (error) {
            Logger.instanse.error("storage", "getSettings", error);
        }
        if (settings == null) {
            settings = {};
            const json = await this.backupStore.get<string>(filename, null);
            if (!NoderedUtil.IsNullEmpty(json)) {
                this._settings = JSON.parse(json);
                settings = this._settings;
            }
        } else {
            if (this._settings == null) {
                this._settings = settings;
                // const packageFile: string = path.join(this.settings.userDir, "package.json");
                try {
                    let modules = await this.GetMissingModules(settings);
                    if (!NoderedUtil.IsNullEmpty(modules)) {
                        let hadErrors: boolean = false;
                        try {
                            this.installNPMPackage(modules);
                            hadErrors = false;
                        } catch (error) {
                            hadErrors = true;
                        }
                        if (hadErrors) {
                            modules = await this.GetMissingModules(settings);
                            var arr = modules.split(" ");
                            arr.forEach(pck => {
                                try {
                                    this.installNPMPackage(pck);
                                } catch (error) {
                                }
                            });
                        }
                    }
                } catch (error) {
                    Logger.instanse.error("storage", "getSettings", error);
                    settings = {};
                }
            }
            this._settings = settings;
            await this.backupStore.set(filename, JSON.stringify(settings));
        }
        try {
            if (this.firstrun) {
                if (WebSocketClient.instance.user != null) {
                    if (WebSocketClient.instance.supports_watch) {
                        await NoderedUtil.Watch({ collectionname: "nodered", aggregates: ["$."] as any, callback: this.onupdate.bind(this) });
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
                                Logger.instanse.error("storage", "onsignedin", error);
                            }
                            await NoderedUtil.Watch({ collectionname: "nodered", aggregates: [{ "$match": { "fullDocument.nodered_id": Config.nodered_id } }], callback: this.onupdate.bind(this) });
                        } else {
                            setTimeout(this.CheckUpdates.bind(this), Config.flow_refresh_initial_interval);
                        }
                    } catch (error) {
                        Logger.instanse.error("storage", "onsignedin", error);
                    }
                });
            }
        } catch (error) {
            Logger.instanse.error("storage", "getSettings", error);
        }
        return settings;
    }
    public bussy: boolean = false;
    public versions: any = {};
    public async onupdate(msg: any) {
        try {
            if (this.bussy) {
                return;
            }
            let update: boolean = false;
            let entity: Base = msg.fullDocument;
            console.log(msg.operationType);
            Logger.instanse.info("storage", "onupdate", entity._type + " - " + new Date().toLocaleTimeString());
            if (entity._type != "setting" && entity._type != "flow" && entity._type != "credential") {
                Logger.instanse.info("storage", "onupdate", entity._type + " - skipped " + new Date().toLocaleTimeString());
                return;
            }
            if (entity._type == "flow") {
                if (!(entity as any).shared && (entity as any).nodered_id != Config.nodered_id) return;
                if (this.versions[entity._id] && this.versions[entity._id] == entity._version && msg.operationType != "delete") {
                    Logger.instanse.info("storage", "onupdate", entity._type + ", skip " + entity._id + " is same version " + entity._version);
                    return;
                } else {
                    Logger.instanse.info("storage", "onupdate", entity._type + ", " + entity._id + " got " + entity._version + " up from " + this.versions[entity._id]);
                }
                update = true;
            } else if (entity._type == "credential") {
                if (!(entity as any).shared && (entity as any).nodered_id != Config.nodered_id) return;
                if (this.versions[entity._id] && this.versions[entity._id] == entity._version && msg.operationType != "delete") {
                    Logger.instanse.info("storage", "onupdate", entity._type + ", skip " + entity._id + " is same version " + entity._version);
                    return;
                } else {
                    Logger.instanse.info("storage", "onupdate", entity._type + ", " + entity._id + " got " + entity._version + " up from " + this.versions[entity._id]);
                }
                update = true;
            } else if (entity._type == "setting") {
                if (!(entity as any).shared && (entity as any).nodered_id != Config.nodered_id) return;
                if (this.versions[entity._id] && this.versions[entity._id] == entity._version && msg.operationType != "delete") {
                    Logger.instanse.info("storage", "onupdate", entity._type + ", skip " + entity._id + " is same version " + entity._version);
                    return;
                } else {
                    Logger.instanse.info("storage", "onupdate", entity._type + ", " + entity._id + " got " + entity._version + " up from " + this.versions[entity._id]);
                }
                let oldsettings: any = null;
                let exitprocess: boolean = false;
                if (this._settings != null) {
                    this.bussy = true;
                    try {
                        Logger.instanse.info("storage", "onupdate", "parse settings " + new Date().toLocaleTimeString());
                        oldsettings = JSON.parse(JSON.stringify(this._settings));
                        let newsettings = (entity as any).settings;
                        newsettings = JSON.parse(newsettings);

                        Logger.instanse.info("storage", "onupdate", "parse oldsettings " + new Date().toLocaleTimeString());
                        let keys = Object.keys(oldsettings.nodes);
                        for (let i = 0; i < keys.length; i++) {
                            const key = keys[i];
                            Logger.instanse.info("storage", "onupdate", "key " + key + " " + new Date().toLocaleTimeString());
                            if (key != "node-red") {
                                const val = oldsettings.nodes[key];
                                try {
                                    let version = val.version;
                                    if (val != null && val.pending_version) {
                                        version = val.pending_version;
                                    }
                                    let oldversion = null;
                                    if (oldsettings != null && oldsettings.nodes[key] != null) {
                                        oldversion = oldsettings.nodes[key].version;
                                        if (oldsettings.nodes[key].pending_version) {
                                            oldversion = oldsettings.nodes[key].pending_version;
                                        }
                                    }
                                    if (newsettings.nodes[key] == null) {
                                        Logger.instanse.info("storage", "onupdate", "Remove module " + key + "@" + version);
                                        this.RED.log.warn("Remove module " + key + "@" + version);
                                        await this.RED.runtime.nodes.removeModule({ user: "admin", module: key, version: version });
                                        // HACK
                                        // exitprocess = true;
                                    } else if (version != oldversion) {
                                        Logger.instanse.info("storage", "onupdate", "Install module " + key + "@" + version + " up from " + oldversion);
                                        this.RED.log.warn("Install module " + key + "@" + version + " up from " + oldversion);
                                        let result = await this.RED.runtime.nodes.addModule({ user: "admin", module: key, version: version });
                                        if (result != null && result.pending_version != null && result.pending_version != result.version) {
                                            Logger.instanse.info("storage", "onupdate", key + " now has pending_version " + result.pending_version + " request process exit");
                                            this.RED.log.warn(key + " now has pending_version " + result.pending_version + " request process exit");
                                            exitprocess = true;
                                        }
                                        // HACK
                                        // exitprocess = true;
                                    }
                                } catch (error) {
                                    var message = (error.message ? error.message : error);
                                    Logger.instanse.error("storage", "onupdate", error);
                                    if (message == "Uninstall failed") {
                                        Logger.instanse.info("storage", "onupdate", "Uninstall failed, request process exit");
                                        this.RED.log.error("Uninstall failed, request process exit");
                                        exitprocess = true;
                                    }
                                    if (message == "Install failed") {
                                        Logger.instanse.info("storage", "onupdate", "Install failed, request process exit");
                                        this.RED.log.error("Install failed, request process exit");
                                        exitprocess = true;
                                    }
                                    if (message == "Module already loaded") {
                                        // Logger.instanse.info("Install failed, Module already loaded");
                                    }
                                }
                            }
                        }
                        Logger.instanse.info("storage", "onupdate", "parse newsettings " + new Date().toLocaleTimeString());
                        keys = Object.keys(newsettings.nodes);
                        for (let i = 0; i < keys.length; i++) {
                            const key = keys[i];
                            if (key != "node-red") {
                                const val = newsettings.nodes[key];
                                if (val == null) {
                                    Logger.instanse.info("storage", "onupdate", "val == null at " + key + " ???");
                                    continue;
                                }
                                let version = val.version;
                                if (val.pending_version) {
                                    version = val.pending_version;
                                }
                                let oldversion = null;
                                if (oldsettings != null && oldsettings.nodes[key] != null) {
                                    oldversion = oldsettings.nodes[key].version;
                                    if (oldsettings.nodes[key].pending_version) {
                                        oldversion = oldsettings.nodes[key].pending_version;
                                    }
                                }
                                try {
                                    if (oldsettings.nodes[key] == null) {
                                        Logger.instanse.info("storage", "onupdate", "Install new module " + key + "@" + version);
                                        this.RED.log.warn("Install new module " + key + "@" + version);
                                        let result = await this.RED.runtime.nodes.addModule({ user: "admin", module: key, version: version });
                                        if (result != null && result.pending_version != null && result.pending_version != result.version) {
                                            Logger.instanse.info("storage", "onupdate", key + " now has pending_version " + result.pending_version + " request process exit");
                                            this.RED.log.warn(key + " now has pending_version " + result.pending_version + " request process exit");
                                            exitprocess = true;
                                        }
                                    } else if (version != oldversion) {
                                        Logger.instanse.info("storage", "onupdate", "Install module " + key + "@" + version + " up from " + oldversion);
                                        this.RED.log.warn("Install module " + key + "@" + version + " up from " + oldversion);
                                        let result = await this.RED.runtime.nodes.addModule({ user: "admin", module: key, version: version });
                                        if (result != null && result.pending_version != null && result.pending_version != result.version) {
                                            Logger.instanse.info("storage", "onupdate", key + " now has pending_version " + result.pending_version + " request process exit");
                                            this.RED.log.warn(key + " now has pending_version " + result.pending_version + " request process exit");
                                            exitprocess = true;
                                        }
                                    }
                                } catch (error) {
                                    var message = (error.message ? error.message : error);
                                    Logger.instanse.error("storage", "onupdate", error);
                                    if (message == "Uninstall failed") {
                                        Logger.instanse.info("storage", "onupdate", "Uninstall failed, request process exit");
                                        this.RED.log.error("Uninstall failed, request process exit");
                                        exitprocess = true;
                                    }
                                    if (message == "Install failed") {
                                        Logger.instanse.info("storage", "onupdate", "Install failed, request process exit");
                                        this.RED.log.error("Install failed, request process exit");
                                        exitprocess = true;
                                    }
                                    if (message == "Module already loaded") {
                                        // Logger.instanse.info("Install failed, Module already loaded");
                                    }
                                }
                            }
                        }
                        Logger.instanse.info("storage", "onupdate", "noderedcontribopenflowstorage::onupdate DiffObjects " + new Date().toLocaleTimeString());
                        if (this.DiffObjects(newsettings, oldsettings)) {
                            update = true;
                        }
                        this._settings = newsettings;
                    } catch (error) {
                        Logger.instanse.error("storage", "onupdate", error);
                        // update = true;
                    }
                    this.bussy = false;
                }

                Logger.instanse.info("storage", "onupdate", "check for exit exitprocess: " + exitprocess + " update: " + update + " " + new Date().toLocaleTimeString());

                if (exitprocess && Config.auto_restart_when_needed) {
                    if (noderedcontribopenflowstorage.isDocker()) {
                        Logger.instanse.info("storage", "onupdate", "Running as docker, just quit process, kubernetes will start a new version");
                        this.RED.log.warn("noderedcontribopenflowstorage::onupdate: Running as docker, just quit process, kubernetes will start a new version");
                        process.exit(1);
                    } else {
                        if (servicename != "service-name-not-set") {
                            var _servicename = path.basename(servicename)
                            Logger.instanse.info("storage", "onupdate", "Restarting service " + _servicename);
                            this.RED.log.warn("noderedcontribopenflowstorage::onupdate: Restarting service " + _servicename);
                            await pm2restart(_servicename);
                        } else {
                            this.RED.log.error("noderedcontribopenflowstorage::onupdate: Not running in docker, nor started as a service, please restart Node-Red manually");
                            Logger.instanse.info("storage", "onupdate", "Not running in docker, nor started as a service, please restart Node-Red manually");
                        }
                    }
                } else if (exitprocess) {
                    Logger.instanse.info("storage", "onupdate", "Restart is needed, auto_restart_when_needed is false");
                    this.RED.log.warn("noderedcontribopenflowstorage::onupdate: Restart is needed, auto_restart_when_needed is false");
                } else if (!exitprocess) {
                    Logger.instanse.info("storage", "onupdate", "Restart not needed");
                    this.RED.log.warn("noderedcontribopenflowstorage::onupdate: Restart not needed");
                }

            }
            if (update) {
                Logger.instanse.info("storage", "onupdate", "**************************************************");
                Logger.instanse.info("storage", "onupdate", "* " + entity._type + " was updated, reloading NodeRED flows");
                Logger.instanse.info("storage", "onupdate", "**************************************************");
                this.RED.log.warn("Reloading flows");
                await this.RED.nodes.loadFlows(true);
            } else {
                Logger.instanse.info("storage", "onupdate", entity._type + " - COMPLETE !! " + new Date().toLocaleTimeString());
            }
        } catch (error) {
            Logger.instanse.error("storage", "onupdate", "**************************************************");
            Logger.instanse.error("storage", "onupdate", "* ERROR");
            Logger.instanse.error("storage", "onupdate", error);
            Logger.instanse.error("storage", "onupdate", "**************************************************");
        }
    }
    public async _saveSettings(settings: any): Promise<void> {
        try {
            Logger.instanse.silly("storage", "saveSettings", "begin");
            Logger.instanse.info("storage", "saveSettings", new Date().toLocaleTimeString());
            const filename: string = Config.nodered_id + "_settings";
            await this.backupStore.set(filename, JSON.stringify(settings));
            if (WebSocketClient.instance.isConnected()) {
                const result = await NoderedUtil.Query({ collectionname: "nodered", query: { _type: "setting", nodered_id: Config.nodered_id }, top: 1 });
                if (NoderedUtil.IsNullUndefinded(result) || result.length === 0) {
                    const item: any = {
                        name: "settings for " + Config.nodered_id,
                        settings: JSON.stringify(settings), _type: "setting", nodered_id: Config.nodered_id
                    };
                    var iresult = await NoderedUtil.InsertOne({ collectionname: "nodered", item });
                    if (!NoderedUtil.IsNullUndefinded(iresult)) this.versions[iresult._id] = iresult._version;
                } else {
                    result[0].settings = JSON.stringify(settings);
                    var uresult = await NoderedUtil.UpdateOne({ collectionname: "nodered", item: result[0] });
                    if (!NoderedUtil.IsNullUndefinded(uresult)) this.versions[uresult._id] = uresult._version;
                }
            }
            this._settings = settings;
            let exitprocess: boolean = false;
            let keys = Object.keys(settings.nodes);
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];
                if (key != "node-red") {
                    const val = settings.nodes[key];
                    if (val == null) {
                        Logger.instanse.info("storage", "saveSettings", "key " + key + " is null ? ");
                        continue;
                    } else if (val.pending_version) {
                        Logger.instanse.info("storage", "saveSettings", "key " + key + " has a pending_version " + val.pending_version);
                        exitprocess = true;
                    }
                }
            }
            if (exitprocess && Config.auto_restart_when_needed) {
                if (noderedcontribopenflowstorage.isDocker()) {
                    Logger.instanse.info("storage", "saveSettings", "Running as docker, just quit process, kubernetes will start a new version");
                    process.exit(1);
                } else {
                    if (servicename != "service-name-not-set") {
                        var _servicename = path.basename(servicename)
                        Logger.instanse.info("storage", "saveSettings", "Restarting service " + _servicename);
                        await pm2restart(_servicename);
                    } else {
                        Logger.instanse.info("storage", "saveSettings", "Not running in docker, nor started as a service, please restart Node-Red manually");
                    }
                }
            } else if (exitprocess) {
                Logger.instanse.info("storage", "saveSettings", "Restart is needed, auto_restart_when_needed is false");
            } else if (!exitprocess) {
                Logger.instanse.info("storage", "saveSettings", "Restart not needed");
            }
        } catch (error) {
            Logger.instanse.error("storage", "saveSettings", error);
        } finally {
            Logger.instanse.silly("storage", "saveSettings", "complete");
        }
    }
    public async _getSessions(): Promise<any[]> {
        let item: any[] = [];
        try {
            Logger.instanse.silly("storage", "saveSettings", "begin");
            if (WebSocketClient.instance.isConnected()) {
                const result = await NoderedUtil.Query({ collectionname: "nodered", query: { _type: "session", nodered_id: Config.nodered_id }, top: 1 });
                if (NoderedUtil.IsNullUndefinded(result) || result.length === 0) { return []; }
                item = JSON.parse(result[0].sessions);
            }
        } catch (error) {
            Logger.instanse.error("storage", "saveSettings", error);
            item = [];
        }
        const filename: string = Config.nodered_id + "_sessions";
        if (NoderedUtil.IsNullUndefinded(item) || item.length == 0) {
            const json = await this.backupStore.get<string>(filename, null);
            if (!NoderedUtil.IsNullEmpty(json)) {
                item = JSON.parse(json);
            }
        } else {
            await this.backupStore.set(filename, JSON.stringify(item));
        }
        return item;
    }
    public async _saveSessions(sessions: any[]): Promise<void> {
        try {
            const filename: string = Config.nodered_id + "_sessions";
            await this.backupStore.set(filename, JSON.stringify(sessions));
            if (WebSocketClient.instance.isConnected()) {
                const result = await NoderedUtil.Query({ collectionname: "nodered", query: { _type: "session", nodered_id: Config.nodered_id }, top: 1 });
                if (NoderedUtil.IsNullUndefinded(result) || result.length === 0) {
                    const item: any = {
                        name: "sessions for " + Config.nodered_id,
                        sessions: JSON.stringify(sessions), _type: "session", nodered_id: Config.nodered_id
                    };
                    await NoderedUtil.InsertOne({ collectionname: "nodered", item });
                } else {
                    result[0].sessions = JSON.stringify(sessions);
                    await NoderedUtil.UpdateOne({ collectionname: "nodered", item: result[0] });
                }
            }
        } catch (error) {
            Logger.instanse.error("storage", "saveSessions", error);
        }
    }
    public async _saveLibraryEntry(type, path, meta, body): Promise<void> {
        try {
            // if (type === "flows" && !path.endsWith(".json")) {
            //     path += ".json";
            // }
            // const filename: string = Config.nodered_id + "_sessions";
            const item = { type, path, meta, body, _type: "library", nodered_id: Config.nodered_id };
            // await this.backupStore.set(filename, JSON.stringify(sessions));
            if (WebSocketClient.instance.isConnected()) {
                // const result = await NoderedUtil.Query("nodered", { _type: "library", nodered_id: Config.nodered_id }, null, null, 1, 0, null);
                const result = await NoderedUtil.InsertOrUpdateOne({ collectionname: "nodered", item, uniqeness: "_type,nodered_id,type,path" });
            }
        } catch (error) {
            Logger.instanse.error("storage", "saveLibraryEntry", error);
        }
    }
    public async _getLibraryEntry(type, path): Promise<any> {
        try {
            Logger.instanse.silly("storage", "getLibraryEntry", "begin");
            if (WebSocketClient.instance.isConnected()) {
                const result = await NoderedUtil.Query({ collectionname: "nodered", query: { _type: "library", nodered_id: Config.nodered_id, type, path }, top: 1 });
                if (NoderedUtil.IsNullUndefinded(result) || result.length === 0) { return null; }
                var item = JSON.parse(result[0].sessions);
                return item.body;
            }
        } catch (error) {
            Logger.instanse.error("storage", "getLibraryEntry", error);
        }
        return null;
    }
    static hasDockerEnv(): boolean {
        try {
            const fs = require('fs');
            fs.statSync('/.dockerenv');
            return true;
        } catch (_) {
            return false;
        }
    }
    static hasDockerCGroup() {
        try {
            const fs = require('fs');
            if (fs.readFileSync('/proc/self/cgroup', 'utf8').includes('docker')) return true;
            return fs.readFileSync('/proc/self/cgroup', 'utf8').includes('/kubepods');
        } catch (_) {
            return false;
        }
    }
    private static _isDocker: boolean = null;
    public static isDocker(): boolean {
        if (noderedcontribopenflowstorage._isDocker != null) return noderedcontribopenflowstorage._isDocker;
        noderedcontribopenflowstorage._isDocker = noderedcontribopenflowstorage.hasDockerEnv() || noderedcontribopenflowstorage.hasDockerCGroup();
        return false;
    }

}
