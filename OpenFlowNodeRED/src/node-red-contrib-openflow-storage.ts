import * as fs  from "fs";
import * as path  from "path";
import { WebSocketClient } from "./WebSocketClient";
import winston = require("winston");
import { nodered_settings } from "./nodered_settings";
import { QueryMessage, Message, DeleteOneMessage, InsertOneMessage } from "./Message";
import { Config } from "./Config";
import { json } from "body-parser";
// tslint:disable-next-line: class-name
export class noderedcontribopenflowstorage {

    private socket:WebSocketClient = null;
    private _logger: winston.Logger;
    private settings:nodered_settings = null;
    public getFlows:any;
    public saveFlows:any;
    public getCredentials:any;
    public saveCredentials:any;
    public getSettings:any;
    public saveSettings:any;
    public getSessions:any;
    public saveSessions:any;
    public getLibraryEntry:any;
    public saveLibraryEntry:any;
    constructor(logger: winston.Logger, socket:WebSocketClient) {
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
    public async init(settings:any):Promise<boolean> {
        this._logger.silly("noderedcontribopenflowstorage::init");
        this.settings = settings;
        var packageFile:string = path.join(this.settings.userDir,"package.json");
        try {
            if (!fs.existsSync(this.settings.userDir)){
                fs.mkdirSync(this.settings.userDir);
            }
            fs.statSync(packageFile);
            this._logger.debug(packageFile + " exists.");
        } catch(err) {
            var defaultPackage:any = {
                "name": "node-red-project",
                "description": "A Node-RED Project",
                "version": "0.0.1"
            };
            this._logger.debug("creating new packageFile " + packageFile);
            fs.writeFileSync(packageFile, JSON.stringify(defaultPackage,null,4));
        }
        var dbsettings = await this._getSettings();
        return true;
    }
    public async _getFlows():Promise<any[]> {
        try {
            this._logger.silly("noderedcontribopenflowstorage::_getFlows");
            var q:QueryMessage = new QueryMessage();
            q.collectionname = "nodered"; q.query = {_type: "flow", nodered_id: Config.nodered_id};
            var msg:Message  = new Message(); msg.command = "query"; msg.data = JSON.stringify(q);
            q = await this.socket.Send<QueryMessage>(msg);
            if(q.result.length===0) { return []; }
            if(q.result.length>1) {
                try {
                    return JSON.parse(q.result[0].flows);
                } catch (error) {
                }
                return q.result;
            }
            this._logger.silly("noderedcontribopenflowstorage::_getFlows: parse result");
            return JSON.parse(q.result[0].flows);
        } catch(error) {
            if(error.message) { this._logger.error(error.message); } 
            else { this._logger.error(error); }
            console.error(error);
            return [];
        }
    }
    public async _saveFlows(flows:any[]):Promise<void> {
        try {
            this._logger.silly("noderedcontribopenflowstorage::_saveFlows");
            var q:QueryMessage = new QueryMessage();
            q.collectionname = "nodered"; q.query = {_type: "flow", nodered_id: Config.nodered_id};
            var msg:Message  = new Message(); msg.command = "query"; msg.data = JSON.stringify(q);
            q = await this.socket.Send<QueryMessage>(msg);

            this._logger.silly("noderedcontribopenflowstorage::_saveFlows::delete " + q.result.length + " flows");
            var Promises:Promise<DeleteOneMessage>[] = [];
            q.result.forEach(flow => {
                var d:DeleteOneMessage = new DeleteOneMessage();
                d.collectionname = "nodered"; d._id = flow._id;
                msg = new Message(); msg.command = "deleteone"; msg.data = JSON.stringify(d);
                Promises.push(this.socket.Send(msg));
            });
            const results:any = await Promise.all(Promises.map(p => p.catch(e => e)));

            this._logger.silly("noderedcontribopenflowstorage::_saveFlows::save new flows");
            var cred:any = { name: "flows for " + Config.nodered_id,
                flows: JSON.stringify(flows), _type: "flow", nodered_id: Config.nodered_id };
            // flows._type = "flow"; flows.nodered_id = Config.nodered_id;
            var i: InsertOneMessage = new InsertOneMessage();
            i.collectionname = "nodered"; i.item = cred;
            var msg2:Message  = new Message(); msg2.command = "insertone"; msg2.data = JSON.stringify(i);
            await this.socket.Send<InsertOneMessage>(msg2);
        } catch(error) {
            if(error.message) { this._logger.error(error.message); } 
            else { this._logger.error(error); }
            console.error(error);
        }
    }
    public async _getCredentials():Promise<any> {
        try {
            this._logger.silly("noderedcontribopenflowstorage::_getCredentials");
            var q:QueryMessage = new QueryMessage();
            q.collectionname = "nodered"; q.query = {_type: "credential", nodered_id: Config.nodered_id};
            var msg:Message  = new Message(); msg.command = "query"; msg.data = JSON.stringify(q);
            q = await this.socket.Send<QueryMessage>(msg);
            if(q.result.length===0) { return {}; }
            this._logger.silly("noderedcontribopenflowstorage::_getCredentials: parse result");
            var cred:any = q.result[0].credentials;
            this._logger.silly(JSON.stringify(cred));
            return cred;
        } catch(error) {
            if(error.message) { this._logger.error(error.message); } 
            else { this._logger.error(error); }
            console.error(error);
            return [];
        }
    }
    public async _saveCredentials(credentials:any):Promise<void> {
        try {
            var q:QueryMessage = new QueryMessage();
            q.collectionname = "nodered"; q.query = {_type: "credential", nodered_id: Config.nodered_id};
            var msg:Message  = new Message(); msg.command = "query"; msg.data = JSON.stringify(q);
            q = await this.socket.Send<QueryMessage>(msg);

            this._logger.silly("noderedcontribopenflowstorage::_saveCredentials::delete " + q.result.length + " credentials");
            var Promises:Promise<DeleteOneMessage>[] = [];
            q.result.forEach(credential => {
                var d:DeleteOneMessage = new DeleteOneMessage();
                d.collectionname = "nodered"; d._id = credential._id;
                msg = new Message(); msg.command = "deleteone"; msg.data = JSON.stringify(d);
                Promises.push(this.socket.Send(msg));
            });
            this._logger.silly("noderedcontribopenflowstorage::_saveCredentials::save new credentials");

            this._logger.silly(JSON.stringify(credentials));
            var cred:any = { name: "credentials for " + Config.nodered_id,
                credentials: credentials, _type: "credential", nodered_id: Config.nodered_id,
                _encrypt: ["credentials"] };

            // credentials._type = "credential"; credentials.nodered_id = Config.nodered_id;
            var i: InsertOneMessage = new InsertOneMessage();
            i.collectionname = "nodered"; i.item = cred;
            var msg2:Message  = new Message(); msg2.command = "insertone"; msg2.data = JSON.stringify(i);
            var res = await this.socket.Send<InsertOneMessage>(msg2);
        } catch(error) {
            if(error.message) { this._logger.error(error.message); } 
            else { this._logger.error(error); }
            console.error(error);
        }
    }
    public async _getSettings():Promise<any> {
        try {
            this._logger.silly("noderedcontribopenflowstorage::_getSettings");
            var q:QueryMessage = new QueryMessage();
            q.collectionname = "nodered"; q.query = {_type: "setting", nodered_id: Config.nodered_id};
            var msg:Message  = new Message(); msg.command = "query"; msg.data = JSON.stringify(q);
            q = await this.socket.Send<QueryMessage>(msg);
            if(q.result.length===0) { return {}; }

            var settings = JSON.parse(q.result[0].settings);
            var child_process = require("child_process");
            Object.keys(settings.nodes).forEach((key) => {
                var val = settings.nodes[key];
                if(["node-red","node-red-node-email","node-red-node-feedparser","node-red-node-rbe",
                    "node-red-node-sentiment","node-red-node-tail","node-red-node-twitter"].indexOf(key) === -1 )
                {
                    var pname = val.name + "@" + val.version;
                    this._logger.info("Installing " + pname);
                    child_process.execSync("npm install " + pname,{stdio:[0,1,2], cwd: this.settings.userDir});
                }
            });
            // var wait = ms => new Promise((r, j)=>setTimeout(r, ms));
            // await wait(10000);
            this._logger.silly("noderedcontribopenflowstorage::_getSettings: return result");
            return settings;
        } catch(error) {
            if(error.message) { this._logger.error(error.message); } 
            else { this._logger.error(error); }
            console.error(error);
            return {};
        }
    }
    public async _saveSettings(settings:any):Promise<void> {
        try {
            var q:QueryMessage = new QueryMessage();
            q.collectionname = "nodered"; q.query = {_type: "setting", nodered_id: Config.nodered_id};
            var msg:Message  = new Message(); msg.command = "query"; msg.data = JSON.stringify(q);
            q = await this.socket.Send<QueryMessage>(msg);

            var Promises:Promise<DeleteOneMessage>[] = [];
            q.result.forEach(setting => {
                var d:DeleteOneMessage = new DeleteOneMessage();
                d.collectionname = "nodered"; d._id = setting._id;
                msg = new Message(); msg.command = "deleteone"; msg.data = JSON.stringify(d);
                Promises.push(this.socket.Send(msg));
            });
            const results:any = await Promise.all(Promises.map(p => p.catch(e => e)));

            var cred:any = { name: "settings for " + Config.nodered_id,
                settings: JSON.stringify(settings), _type: "setting", nodered_id: Config.nodered_id };
            // settings._type = "setting"; settings.nodered_id = Config.nodered_id;
            var i: InsertOneMessage = new InsertOneMessage();
            i.collectionname = "nodered"; i.item = cred;
            var msg2:Message  = new Message(); msg2.command = "insertone"; msg2.data = JSON.stringify(i);
            await this.socket.Send<InsertOneMessage>(msg2);
        } catch(error) {
            if(error.message) { this._logger.error(error.message); } 
            else { this._logger.error(error); }
            console.error(error);
        }
    }



    public async _getSessions():Promise<any[]> {
        try {
            var q:QueryMessage = new QueryMessage();
            q.collectionname = "nodered"; q.query = {_type: "session", nodered_id: Config.nodered_id};
            var msg:Message  = new Message(); msg.command = "query"; msg.data = JSON.stringify(q);
            q = await this.socket.Send<QueryMessage>(msg);
            if(q.result.length===0) { return []; }
            return JSON.parse(q.result[0].sessions);
        } catch(error) {
            if(error.message) { this._logger.error(error.message); } 
            else { this._logger.error(error); }
            console.error(error);
            return [];
        }
    }
    public async _saveSessions(sessions:any[]):Promise<void> {
        try {
            var q:QueryMessage = new QueryMessage();
            q.collectionname = "nodered"; q.query = {_type: "session", nodered_id: Config.nodered_id};
            var msg:Message  = new Message(); msg.command = "query"; msg.data = JSON.stringify(q);
            q = await this.socket.Send<QueryMessage>(msg);

            var Promises:Promise<DeleteOneMessage>[] = [];
            q.result.forEach(session => {
                var d:DeleteOneMessage = new DeleteOneMessage();
                d.collectionname = "nodered"; d._id = session._id;
                msg = new Message(); msg.command = "deleteone"; msg.data = JSON.stringify(d);
                Promises.push(this.socket.Send(msg));
            });
            const results:any = await Promise.all(Promises.map(p => p.catch(e => e)));

            var cred:any = { name: "sessions for " + Config.nodered_id,
                sessions: JSON.stringify(sessions), _type: "session", nodered_id: Config.nodered_id };
            // sessions._type = "session"; sessions.nodered_id = Config.nodered_id;
            var i: InsertOneMessage = new InsertOneMessage();
            i.collectionname = "nodered"; i.item = cred;
            var msg2:Message  = new Message(); msg2.command = "insertone"; msg2.data = JSON.stringify(i);
            await this.socket.Send<InsertOneMessage>(msg2);
        } catch(error) {
            if(error.message) { this._logger.error(error.message); } 
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
