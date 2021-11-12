import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { nodered_settings } from "./nodered_settings";
import { Config } from "./Config";
import { WebSocketClient, NoderedUtil, Base } from "@openiap/openflow-api";
import * as nodered from "node-red";
import { FileSystemCache } from "@openiap/openflow-api";
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
    private socket: WebSocketClient = null;
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
        this.socket = socket;
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
    getGlobalModulesDir() {
        return new Promise<string>((resolve, reject) => {
            try {
                var npm = require("global-npm")
                // work around for https://github.com/npm/cli/issues/2137
                npm.load(function (err) {
                    if (err) return reject(err)
                    resolve(npm.globalPrefix);
                })
            } catch (error) {
                return reject(error)
            }
        });
    }
    async GetMissingModules(settings: any) {
        const globaldir = await this.getGlobalModulesDir();
        let currentmodules = this.scanDirForNodesModules(path.resolve('.'));
        currentmodules = currentmodules.concat(this.scanDirForNodesModules(globaldir));
        const keys = Object.keys(settings.nodes);
        let modules = "";
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (key == "node-red" || key == "node-red-node-rbe" || key == "node-red-node-tail") continue;
            const val = settings.nodes[key];
            const version = (val.pending_version ? val.pending_version : val.version)
            const pcks = currentmodules.filter(x => x.name == key && x.version == version);
            if (pcks.length != 1) {
                modules += (" " + key + "@" + version);
            }
        }
        return modules.trim();
    }
    // key + "@" + version
    installNPMPackage(pck: string) {
        try {
            Logger.instanse.info("Installing " + pck);
            child_process.execSync("npm install " + pck, { stdio: [0, 1, 2], cwd: this.settings.userDir });
        } catch (error) {
            Logger.instanse.error("npm install error");
            if (error.status) Logger.instanse.error("npm install status: " + error.status);
            if (error.message) Logger.instanse.error("npm install message: " + error.message);
            if (error.stderr) Logger.instanse.error("npm install stderr: " + error.stderr);
            if (error.stdout) Logger.instanse.error("npm install stdout: " + error.stdout);
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
            Logger.instanse.error(error);
        }
        if (!WebSocketClient.instance.supports_watch) {
            setTimeout(this.CheckUpdates.bind(this), Config.flow_refresh_interval);
        }


    }
    public async init(settings: any): Promise<boolean> {
        Logger.instanse.silly("noderedcontribopenflowstorage::init");
        this.settings = settings;
        const packageFile: string = path.join(this.settings.userDir, "package.json");
        try {
            if (!fs.existsSync(this.settings.userDir)) {
                fs.mkdirSync(this.settings.userDir);
            }
            fs.statSync(packageFile);
            process.chdir(this.settings.userDir);
            Logger.instanse.debug(packageFile + " exists.");
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
            Logger.instanse.debug("creating new packageFile " + packageFile);
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
            Logger.instanse.silly("noderedcontribopenflowstorage::_getnpmrc");
            if (WebSocketClient.instance != null && WebSocketClient.instance.isConnected()) {
                const array = await NoderedUtil.Query("nodered", { _type: "npmrc", nodered_id: Config.nodered_id }, null, null, 1, 0, null, null, null, 1);
                if (array.length === 0) { return null; }
                try {
                    this.npmrc = array[0];
                } catch (error) {
                    Logger.instanse.error(error);
                    this.npmrc = null;
                }
            }
        } catch (error) {
            Logger.instanse.error(error);
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
            Logger.instanse.error(error);
            this.npmrc = null;
        }
        return null;
    }
    public async _setnpmrc(npmrc: noderednpmrc): Promise<void> {
        try {
            this.npmrc = npmrc;
            Logger.instanse.silly("noderedcontribopenflowstorage::_setnpmrc");
            // const filename: string = Config.nodered_id + "_npmrc.txt";
            // await backupStore.set(filename, JSON.stringify(npmrc));
            if (WebSocketClient.instance.isConnected()) {
                const result = await NoderedUtil.Query("nodered", { _type: "npmrc", nodered_id: Config.nodered_id }, null, null, 1, 0, null, null, null, 1);
                if (result.length === 0) {
                    npmrc.name = "npmrc for " + Config.nodered_id;
                    npmrc.nodered_id = Config.nodered_id;
                    npmrc._type = "npmrc";
                    await NoderedUtil.InsertOne("nodered", npmrc, 1, true, null, 1);
                } else {
                    npmrc._id = result[0]._id;
                    await NoderedUtil.UpdateOne("nodered", null, npmrc, 1, true, null, 1);
                }
            }
        } catch (error) {
            Logger.instanse.error(error);
        }
    }
    public async _getFlows(): Promise<any[]> {
        let result: any[] = [];
        try {
            Logger.instanse.silly("noderedcontribopenflowstorage::_getFlows");
            if (WebSocketClient.instance.isConnected()) {
                const array = await NoderedUtil.Query("nodered", { _type: "flow", nodered_id: Config.nodered_id }, null, null, 1, 0, null, null, null, 1);
                if (array.length === 0) { return []; }
                try {
                    this._flows = JSON.parse(array[0].flows);
                    result = this._flows;
                } catch (error) {
                    Logger.instanse.error(error);
                    result = [];
                }
            }
        } catch (error) {
            Logger.instanse.error(error);
            result = [];
        }
        const filename: string = Config.nodered_id + "_flows.json";
        if (result.length == 0) {
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
            Logger.instanse.silly("noderedcontribopenflowstorage::_saveFlows");
            const filename: string = Config.nodered_id + "_flows.json";
            await this.backupStore.set(filename, JSON.stringify(flows));
            if (WebSocketClient.instance.isConnected()) {
                this.last_reload = new Date();
                const result = await NoderedUtil.Query("nodered", { _type: "flow", nodered_id: Config.nodered_id }, null, null, 1, 0, null, null, null, 1);
                this.last_reload = new Date();
                if (result.length === 0) {
                    const item: any = {
                        name: "flows for " + Config.nodered_id,
                        flows: JSON.stringify(flows), _type: "flow", nodered_id: Config.nodered_id
                    };
                    await NoderedUtil.InsertOne("nodered", item, 1, true, null, 1);
                } else {
                    result[0].flows = JSON.stringify(flows);
                    await NoderedUtil.UpdateOne("nodered", null, result[0], 1, true, null, 1);
                }
                this._flows = flows;
            } else {
                this.RED.log.warn("Flow only saved locally, not connected to openflow!");
            }
        } catch (error) {
            Logger.instanse.error(error);
        }
    }
    public async _getCredentials(): Promise<any> {
        let cred: any = [];
        try {
            Logger.instanse.silly("noderedcontribopenflowstorage::_getCredentials");
            if (WebSocketClient.instance.isConnected()) {
                const result = await NoderedUtil.Query("nodered", { _type: "credential", nodered_id: Config.nodered_id }, null, null, 1, 0, null, null, null, 1);
                if (result.length === 0) { return []; }
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
            Logger.instanse.error(error);
            cred = [];
        }
        const filename: string = Config.nodered_id + "_credentials";
        if (cred.length == 0) {
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
            Logger.instanse.silly("noderedcontribopenflowstorage::_saveCredentials");
            const filename: string = Config.nodered_id + "_credentials";
            const credentialsarray = [];
            await this.backupStore.set(filename, noderedcontribopenflowstorage.encrypt(JSON.stringify(credentials)));
            let result: any[] = [];
            if (WebSocketClient.instance.isConnected()) {
                this.last_reload = new Date();
                result = await NoderedUtil.Query("nodered", { _type: "credential", nodered_id: Config.nodered_id }, null, null, 1, 0, null, null, null, 1);
                this.last_reload = new Date();
                const orgkeys = Object.keys(credentials);
                for (let i = 0; i < orgkeys.length; i++) {
                    const key = orgkeys[i];
                    const value = credentials[key];
                    const obj = { key: key, value: value };
                    credentialsarray.push(obj);
                }
            }
            if (credentials) {
                if (result.length === 0) {
                    const item: any = {
                        name: "credentials for " + Config.nodered_id,
                        credentials: credentials, credentialsarray: credentialsarray, _type: "credential", nodered_id: Config.nodered_id,
                        _encrypt: ["credentials", "credentialsarray"]
                    };
                    const subresult = await NoderedUtil.InsertOne("nodered", item, 1, true, null, 1);
                } else {
                    const item: any = result[0];
                    item.credentials = credentials;
                    item.credentialsarray = credentialsarray;
                    item._encrypt = ["credentials", "credentialsarray"];
                    const subresult = await NoderedUtil.UpdateOne("nodered", null, item, 1, true, null, 1);
                }
                this._credentials = credentials;
            }
        } catch (error) {
            Logger.instanse.error(error);
        }
    }
    private firstrun: boolean = true;
    public async _getSettings(): Promise<any> {
        let settings: any = null;
        try {
            Logger.instanse.silly("noderedcontribopenflowstorage::_getSettings");
            if (WebSocketClient.instance.isConnected()) {
                const result = await NoderedUtil.Query("nodered", { _type: "setting", nodered_id: Config.nodered_id }, null, null, 1, 0, null, null, null, 1);
                if (result.length === 0) { return {}; }
                settings = JSON.parse(result[0].settings);
            }
        } catch (error) {
            Logger.instanse.error(error);
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
            Logger.instanse.error(error);
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
                    Logger.instanse.error(error);
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
                                this.last_reload = new Date();
                                await this.CheckUpdates();
                                this.last_reload = new Date();
                            } catch (error) {
                                Logger.instanse.error(error);
                            }
                            await NoderedUtil.Watch("nodered", [{ "$match": { "fullDocument.nodered_id": Config.nodered_id } }], WebSocketClient.instance.jwt, this.onupdate.bind(this));
                        } else {
                            setTimeout(this.CheckUpdates.bind(this), Config.flow_refresh_initial_interval);
                        }
                    } catch (error) {
                        Logger.instanse.error(error);
                    }
                });
            }
        } catch (error) {
            Logger.instanse.error(error);
        }
        return settings;
    }
    public last_reload: Date = new Date();
    public bussy: boolean = false;
    public async onupdate(msg: any) {
        try {
            // let events = this.RED.runtime.events;
            // events.emit("runtime-event", { id: "runtime-deploy", payload: { revision: "1" }, retain: true });
            // events.emit("runtime-event", { id: NoderedUtil.GetUniqueIdentifier(), payload: { type: "warning", text: "Hi mom1" }, retain: false });
            // events.emit("runtime-event", { id: NoderedUtil.GetUniqueIdentifier(), payload: { type: "warning", text: "Hi mom2" }, retain: true });
            // events.emit("runtime-event", { id: NoderedUtil.GetUniqueIdentifier(), payload: { text: "Hi mom3" }, retain: true });
            // events.emit("runtime-event", { id: NoderedUtil.GetUniqueIdentifier(), payload: { text: "Hi mom4" }, retain: false });
            // events.emit("runtime-event", { id: "runtime-state", payload: { type: "warning", text: "Hi mom" }, retain: true });
            // events.emit("runtime-event", { id: "runtime-state", payload: { type: "warning", text: "Hi mom" }, retain: false });
            // events.emit("runtime-event", { id: "node/added", retain: false, payload: "Hi mom" });
            // events.emit("runtime-event", { id: "runtime-state", retain: true });
            // events.emit("runtime-event", { id: "node/enabled", retain: false, payload: "Hi mom" });
            // try {
            // events.emit("runtime-event", { id: NoderedUtil.GetUniqueIdentifier(), payload: { text: "Hi mom" }, retain: false });
            // events.emit("runtime-event", { id: NoderedUtil.GetUniqueIdentifier(), payload: { type: "info", text: "Hi mom" }, retain: false });
            // events.emit("runtime-event", { id: NoderedUtil.GetUniqueIdentifier(), payload: { text: "Hi mom" } });
            // } catch (error) {
            //     console.error(error);
            // }
            const begin: number = this.last_reload.getTime();
            const end: number = new Date().getTime();
            const seconds = Math.round((end - begin) / 1000);
            var r = this.RED.runtime;
            if (seconds < 2 || this.bussy) {
                return;
            }
            let update: boolean = false;
            let entity: Base = msg.fullDocument;
            Logger.instanse.info("noderedcontribopenflowstorage::onupdate " + entity._type + " - " + new Date().toLocaleTimeString());
            if (entity._type != "setting" && entity._type != "flow" && entity._type != "credential") {
                Logger.instanse.info("noderedcontribopenflowstorage::onupdate " + entity._type + " - skipped " + new Date().toLocaleTimeString());
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
                Logger.instanse.info("noderedcontribopenflowstorage::onupdate setting init " + new Date().toLocaleTimeString());
                let oldsettings: any = null;
                let exitprocess: boolean = false;
                if (this._settings != null) {
                    this.bussy = true;
                    try {
                        Logger.instanse.info("noderedcontribopenflowstorage::onupdate parse settings " + new Date().toLocaleTimeString());
                        oldsettings = JSON.parse(JSON.stringify(this._settings));
                        let newsettings = (entity as any).settings;
                        newsettings = JSON.parse(newsettings);

                        Logger.instanse.info("noderedcontribopenflowstorage::onupdate parse oldsettings " + new Date().toLocaleTimeString());
                        let keys = Object.keys(oldsettings.nodes);
                        for (let i = 0; i < keys.length; i++) {
                            const key = keys[i];
                            Logger.instanse.info("noderedcontribopenflowstorage::onupdate key " + key + " " + new Date().toLocaleTimeString());
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
                                        // Logger.instanse.info("**************************************************");
                                        Logger.instanse.info("Remove module " + key + "@" + version);
                                        this.RED.log.warn("Remove module " + key + "@" + version);
                                        await this.RED.runtime.nodes.removeModule({ user: "admin", module: key, version: version });
                                        // HACK
                                        // exitprocess = true;
                                    } else if (version != oldversion) {
                                        // Logger.instanse.info("**************************************************");
                                        Logger.instanse.info("Install module " + key + "@" + version + " up from " + oldversion);
                                        this.RED.log.warn("Install module " + key + "@" + version + " up from " + oldversion);
                                        let result = await this.RED.runtime.nodes.addModule({ user: "admin", module: key, version: version });
                                        if (result != null && result.pending_version != null && result.pending_version != result.version) {
                                            Logger.instanse.info(key + " now has pending_version " + result.pending_version + " request process exit");
                                            this.RED.log.warn(key + " now has pending_version " + result.pending_version + " request process exit");
                                            exitprocess = true;
                                        }
                                        // HACK
                                        // exitprocess = true;
                                    }
                                } catch (error) {
                                    var message = (error.message ? error.message : error);
                                    Logger.instanse.error(error);
                                    if (message == "Uninstall failed") {
                                        Logger.instanse.info("Uninstall failed, request process exit");
                                        this.RED.log.error("Uninstall failed, request process exit");
                                        exitprocess = true;
                                    }
                                    if (message == "Install failed") {
                                        Logger.instanse.info("Install failed, request process exit");
                                        this.RED.log.error("Install failed, request process exit");
                                        exitprocess = true;
                                    }
                                    if (message == "Module already loaded") {
                                        // Logger.instanse.info("Install failed, Module already loaded");
                                    }
                                }
                            }
                        }
                        Logger.instanse.info("noderedcontribopenflowstorage::onupdate parse newsettings " + new Date().toLocaleTimeString());
                        keys = Object.keys(newsettings.nodes);
                        for (let i = 0; i < keys.length; i++) {
                            const key = keys[i];
                            if (key != "node-red") {
                                const val = newsettings.nodes[key];
                                if (val == null) {
                                    Logger.instanse.info("val == null at " + key + " ???");
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
                                        Logger.instanse.info("Install new module " + key + "@" + version);
                                        this.RED.log.warn("Install new module " + key + "@" + version);
                                        let result = await this.RED.runtime.nodes.addModule({ user: "admin", module: key, version: version });
                                        if (result != null && result.pending_version != null && result.pending_version != result.version) {
                                            Logger.instanse.info(key + " now has pending_version " + result.pending_version + " request process exit");
                                            this.RED.log.warn(key + " now has pending_version " + result.pending_version + " request process exit");
                                            exitprocess = true;
                                        }
                                    } else if (version != oldversion) {
                                        Logger.instanse.info("Install module " + key + "@" + version + " up from " + oldversion);
                                        this.RED.log.warn("Install module " + key + "@" + version + " up from " + oldversion);
                                        let result = await this.RED.runtime.nodes.addModule({ user: "admin", module: key, version: version });
                                        if (result != null && result.pending_version != null && result.pending_version != result.version) {
                                            Logger.instanse.info(key + " now has pending_version " + result.pending_version + " request process exit");
                                            this.RED.log.warn(key + " now has pending_version " + result.pending_version + " request process exit");
                                            exitprocess = true;
                                        }
                                    }
                                } catch (error) {
                                    var message = (error.message ? error.message : error);
                                    Logger.instanse.error(error);
                                    if (message == "Uninstall failed") {
                                        Logger.instanse.info("Uninstall failed, request process exit");
                                        this.RED.log.error("Uninstall failed, request process exit");
                                        exitprocess = true;
                                    }
                                    if (message == "Install failed") {
                                        Logger.instanse.info("Install failed, request process exit");
                                        this.RED.log.error("Install failed, request process exit");
                                        exitprocess = true;
                                    }
                                    if (message == "Module already loaded") {
                                        // Logger.instanse.info("Install failed, Module already loaded");
                                    }
                                }
                            }
                        }
                        Logger.instanse.info("noderedcontribopenflowstorage::onupdate DiffObjects " + new Date().toLocaleTimeString());
                        if (this.DiffObjects(newsettings, oldsettings)) {
                            update = true;
                            // Logger.instanse.info("**************************************************");
                        }
                        this._settings = newsettings;
                    } catch (error) {
                        Logger.instanse.error(error);
                        // update = true;
                    }
                    this.bussy = false;
                }

                Logger.instanse.info("noderedcontribopenflowstorage::onupdate check for exit exitprocess: " + exitprocess + " update: " + update + " " + new Date().toLocaleTimeString());

                if (exitprocess && Config.auto_restart_when_needed) {
                    if (NoderedUtil.isDocker()) {
                        Logger.instanse.info("noderedcontribopenflowstorage::onupdate: Running as docker, just quit process, kubernetes will start a new version");
                        this.RED.log.warn("noderedcontribopenflowstorage::onupdate: Running as docker, just quit process, kubernetes will start a new version");
                        process.exit(1);
                    } else {
                        if (servicename != "service-name-not-set") {
                            var _servicename = path.basename(servicename)
                            Logger.instanse.info("noderedcontribopenflowstorage::onupdate: Restarting service " + _servicename);
                            this.RED.log.warn("noderedcontribopenflowstorage::onupdate: Restarting service " + _servicename);
                            await pm2restart(_servicename);
                        } else {
                            this.RED.log.error("noderedcontribopenflowstorage::onupdate: Not running in docker, nor started as a service, please restart Node-Red manually");
                            Logger.instanse.info("noderedcontribopenflowstorage::onupdate: Not running in docker, nor started as a service, please restart Node-Red manually");
                        }
                    }
                } else if (exitprocess) {
                    Logger.instanse.info("noderedcontribopenflowstorage::onupdate: Restart is needed, auto_restart_when_needed is false");
                    this.RED.log.warn("noderedcontribopenflowstorage::onupdate: Restart is needed, auto_restart_when_needed is false");
                } else if (!exitprocess) {
                    Logger.instanse.info("noderedcontribopenflowstorage::onupdate: Restart not needed");
                    this.RED.log.warn("noderedcontribopenflowstorage::onupdate: Restart not needed");
                }

            }
            if (update) {
                this.last_reload = new Date();
                Logger.instanse.info("**************************************************");
                Logger.instanse.info("* " + entity._type + " was updated, reloading NodeRED flows");
                Logger.instanse.info("* loadFlows last updated " + seconds + " seconds ago");
                Logger.instanse.info("**************************************************");
                this.RED.log.warn("Reloading flows");
                await this.RED.nodes.loadFlows(true);
            } else {
                Logger.instanse.info("noderedcontribopenflowstorage::onupdate " + entity._type + " - COMPLETE !! " + new Date().toLocaleTimeString());
            }
        } catch (error) {
            Logger.instanse.error("**************************************************");
            Logger.instanse.error("* ERROR");
            Logger.instanse.error(error);
            Logger.instanse.error("**************************************************");
        }
    }
    public async _saveSettings(settings: any): Promise<void> {
        try {
            Logger.instanse.silly("noderedcontribopenflowstorage::_saveSettings");
            Logger.instanse.info(" _saveSettings - " + new Date().toLocaleTimeString());
            const filename: string = Config.nodered_id + "_settings";
            await this.backupStore.set(filename, JSON.stringify(settings));
            if (WebSocketClient.instance.isConnected()) {
                this.last_reload = new Date();
                const result = await NoderedUtil.Query("nodered", { _type: "setting", nodered_id: Config.nodered_id }, null, null, 1, 0, null, null, null, 1);
                this.last_reload = new Date();
                if (result.length === 0) {
                    const item: any = {
                        name: "settings for " + Config.nodered_id,
                        settings: JSON.stringify(settings), _type: "setting", nodered_id: Config.nodered_id
                    };
                    await NoderedUtil.InsertOne("nodered", item, 1, true, null, 1);
                } else {
                    result[0].settings = JSON.stringify(settings);
                    await NoderedUtil.UpdateOne("nodered", null, result[0], 1, true, null, 1);
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
                        Logger.instanse.info("noderedcontribopenflowstorage::_saveSettings:: key " + key + " is null?");
                        continue;
                    } else if (val.pending_version) {
                        Logger.instanse.info("noderedcontribopenflowstorage::_saveSettings:: key " + key + " has a pending_version " + val.pending_version);
                        exitprocess = true;
                    }
                }
            }
            if (exitprocess && Config.auto_restart_when_needed) {
                if (NoderedUtil.isDocker()) {
                    Logger.instanse.info("noderedcontribopenflowstorage::onupdate: Running as docker, just quit process, kubernetes will start a new version");
                    process.exit(1);
                } else {
                    if (servicename != "service-name-not-set") {
                        var _servicename = path.basename(servicename)
                        Logger.instanse.info("noderedcontribopenflowstorage::onupdate: Restarting service " + _servicename);
                        await pm2restart(_servicename);
                    } else {
                        Logger.instanse.info("noderedcontribopenflowstorage::onupdate: Not running in docker, nor started as a service, please restart Node-Red manually");
                    }
                }
            } else if (exitprocess) {
                Logger.instanse.info("noderedcontribopenflowstorage::onupdate: Restart is needed, auto_restart_when_needed is false");
            } else if (!exitprocess) {
                Logger.instanse.info("noderedcontribopenflowstorage::onupdate: Restart not needed");
            }
        } catch (error) {
            Logger.instanse.error(error);
        }
        Logger.instanse.info(" _saveSettings - COMPLETE!!! " + new Date().toLocaleTimeString());
    }
    public async _getSessions(): Promise<any[]> {
        let item: any[] = [];
        try {
            Logger.instanse.silly("noderedcontribopenflowstorage::_getSessions");
            if (WebSocketClient.instance.isConnected()) {
                const result = await NoderedUtil.Query("nodered", { _type: "session", nodered_id: Config.nodered_id }, null, null, 1, 0, null, null, null, 1);
                if (result.length === 0) { return []; }
                item = JSON.parse(result[0].sessions);
            }
        } catch (error) {
            Logger.instanse.error(error);
            item = [];
        }
        const filename: string = Config.nodered_id + "_sessions";
        if (item == null || item.length == 0) {
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
                this.last_reload = new Date();
                const result = await NoderedUtil.Query("nodered", { _type: "session", nodered_id: Config.nodered_id }, null, null, 1, 0, null, null, null, 1);
                this.last_reload = new Date();
                if (result.length === 0) {
                    const item: any = {
                        name: "sessions for " + Config.nodered_id,
                        sessions: JSON.stringify(sessions), _type: "session", nodered_id: Config.nodered_id
                    };
                    await NoderedUtil.InsertOne("nodered", item, 1, true, null, 1);
                } else {
                    result[0].sessions = JSON.stringify(sessions);
                    await NoderedUtil.UpdateOne("nodered", null, result[0], 1, true, null, 1);
                }
            }
        } catch (error) {
            Logger.instanse.error(error);
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
                this.last_reload = new Date();
                // const result = await NoderedUtil.Query("nodered", { _type: "library", nodered_id: Config.nodered_id }, null, null, 1, 0, null);
                const result = await NoderedUtil.InsertOrUpdateOne("nodered", item, "_type,nodered_id,type,path", 1, true, null, 1);
                this.last_reload = new Date();
            }
        } catch (error) {
            Logger.instanse.error(error);
        }
    }
    public async _getLibraryEntry(type, path): Promise<any> {
        try {
            Logger.instanse.silly("noderedcontribopenflowstorage::_getSessions");
            if (WebSocketClient.instance.isConnected()) {
                const result = await NoderedUtil.Query("nodered", { _type: "library", nodered_id: Config.nodered_id, type, path }, null, null, 1, 0, null, null, null, 1);
                if (result.length === 0) { return null; }
                var item = JSON.parse(result[0].sessions);
                return item.body;
            }
        } catch (error) {
            Logger.instanse.error(error);
        }
        return null;
    }

}
