import { CountOptions, InsertOrUpdateOneMessage, QueryOptions, UpdateManyMessage, UpdateOneMessage, Workitem } from "@openiap/openflow-api";
import { Histogram, ObservableUpDownCounter, Span } from "@opentelemetry/api";
import events from "events";
import _jsondiffpatch from "jsondiffpatch";
import { JSONPath } from "jsonpath-plus";
import { AggregateOptions, ChangeStream, Db, FindOptions, GridFSBucket, InsertOneOptions, InsertOneResult, MongoClient, MongoClientOptions, ObjectId, UpdateOptions } from "mongodb";
import os from "os";
import v8 from "v8";
import { amqpwrapper } from "./amqpwrapper.js";
import { Audit } from "./Audit.js";
import { Auth } from "./Auth.js";
import { Base, Customer, iAgent, Rights, Role, Rolemember, TokenUser, User, Workspace } from "./commoninterfaces.js";
import { Config, dbConfig } from "./Config.js";
import { Crypt } from "./Crypt.js";
import { Resources } from "./ee/Resources.js";
import { Resource, ResourceUsage } from "./commoninterfaces.js";
import { Logger } from "./Logger.js";
import { LoginProvider } from "./LoginProvider.js";
import { OAuthProvider } from "./OAuthProvider.js";
import { WebServer } from "./WebServer.js";
import { WebSocketServer } from "./WebSocketServer.js";
import { clsstream } from "./WebSocketServerClient.js";
import { Util, Wellknown } from "./Util.js";
import { Ace } from "@openiap/nodeapi";

function getObjectSize(obj) {
    const objectSerialized = v8.serialize(obj);
    return objectSerialized.length;
}
const formatBytes = (bytes, decimals = 2) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
    if (bytes < 0) {
        bytes = bytes * -1;
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return "-" + parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
    } else {
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
    }
}

const safeObjectID = (s: string | number | ObjectId) => ObjectId.isValid(s) ? new ObjectId(s) : null;
const isoDatePattern = new RegExp(/\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z)/);
const jsondiffpatch = _jsondiffpatch.create({
    objectHash: function (obj, index) {
        // try to find an id property, otherwise just use the index in the array
        return obj.name || obj.id || obj._id || "$$index:" + index;
    }
});

export type GetDocumentVersionOptions = {
    collectionname: string,
    id: string,
    version: number,
    jwt?: string,
    decrypt?: boolean,
}
export type GetLatestDocumentVersionOptions = {
    collectionname: string,
    id: string,
    jwt?: string,
    decrypt?: boolean,
}
export class DatabaseConnection extends events.EventEmitter {
    private mongodburl: string;
    private cli: MongoClient;
    public db: Db;
    private _dbname: string;
    public static mongodb_query: Histogram;
    public static mongodb_count: Histogram;
    public static mongodb_aggregate: Histogram;
    public static mongodb_insert: Histogram;
    public static mongodb_insertmany: Histogram;
    public static mongodb_update: Histogram;
    public static mongodb_updatemany: Histogram;
    public static mongodb_replace: Histogram;
    public static mongodb_delete: Histogram;
    public static mongodb_deletemany: Histogram;
    public static mongodb_active_sessions: ObservableUpDownCounter;

    public queuemonitoringhandle: NodeJS.Timeout = null;
    public queuemonitoringlastrun: Date = new Date();
    constructor(mongodburl: string, dbname: string) {
        super();
        this._dbname = dbname;
        this.mongodburl = mongodburl;
        this.setMaxListeners(1500);

        if (!Util.IsNullUndefinded(Logger.otel) && !Util.IsNullUndefinded(Logger.otel.meter)) {
            DatabaseConnection.mongodb_query = Logger.otel.meter.createHistogram("openflow_mongodb_query_seconds", {
                description: "Duration for mongodb queries", valueType: 1, unit: "s"
            });
            DatabaseConnection.mongodb_count = Logger.otel.meter.createHistogram("openflow_mongodb_count_seconds", {
                description: "Duration for mongodb counts", valueType: 1, unit: "s"
            });
            DatabaseConnection.mongodb_aggregate = Logger.otel.meter.createHistogram("openflow_mongodb_aggregate_seconds", {
                description: "Duration for mongodb aggregates", valueType: 1, unit: "s"
            });
            DatabaseConnection.mongodb_insert = Logger.otel.meter.createHistogram("openflow_mongodb_insert_seconds", {
                description: "Duration for mongodb inserts", valueType: 1, unit: "s"
            });
            DatabaseConnection.mongodb_insertmany = Logger.otel.meter.createHistogram("openflow_mongodb_insertmany_seconds", {
                description: "Duration for mongodb insert many", valueType: 1, unit: "s"
            });
            DatabaseConnection.mongodb_update = Logger.otel.meter.createHistogram("openflow_mongodb_update_seconds", {
                description: "Duration for mongodb updates", valueType: 1, unit: "s"
            });
            DatabaseConnection.mongodb_updatemany = Logger.otel.meter.createHistogram("openflow_mongodb_updatemany_seconds", {
                description: "Duration for mongodb update many", valueType: 1, unit: "s"
            });
            DatabaseConnection.mongodb_replace = Logger.otel.meter.createHistogram("openflow_mongodb_replace_seconds", {
                description: "Duration for mongodb replaces", valueType: 1, unit: "s"
            });
            DatabaseConnection.mongodb_delete = Logger.otel.meter.createHistogram("openflow_mongodb_delete_seconds", {
                description: "Duration for mongodb deletes", valueType: 1, unit: "s"
            });
            DatabaseConnection.mongodb_deletemany = Logger.otel.meter.createHistogram("openflow_mongodb_deletemany_seconds", {
                description: "Duration for mongodb deletemanys", valueType: 1, unit: "s"
            });
            DatabaseConnection.mongodb_active_sessions = Logger.otel.meter.createObservableUpDownCounter("openflow_mongodb_active_sessions", {
                description: "Number of active mongodb sessions"
            });
            DatabaseConnection.mongodb_active_sessions?.addCallback((res) => {
                // @ts-ignore
                var value = this.cli?.s?.activeSessions?.size;
                if (!value) value = 0;
                res.observe(value, { ...Logger.otel.defaultlabels });
            });

        }
    }

    static toArray(iterator): Promise<any[]> {
        return new Promise((resolve, reject) => {
            iterator.toArray((err, res) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(res);
                }
            });
        });
    }
    public isConnected: boolean = false;
    async shutdown() {
        try {
            if (!Util.IsNullUndefinded(this.queuemonitoringhandle)) {
                clearTimeout(this.queuemonitoringhandle);
            }
            if (this.cli) {
                this.cli.removeAllListeners();
                await this.cli.close(true);
            }
        } catch (error) {
            Logger.instanse.error(error, null, { cls: "DatabaseConnection", func: "shutdown" });
        }
    }
    public hadWatchFault: boolean = false;
    public lastWatchFault: Date = new Date();
    public watchFaultHandler: any = null;
    public replicat: string = null;
    private stream: clsstream;
    public requests: any = {};
    public host: string = "";
    /**
     * Connect to MongoDB
     * @returns Promise<void>
     */
    async connect(parent: Span = undefined): Promise<void> {
        if (this.cli !== null && this.cli !== undefined && this.isConnected) {
            return;
        }
        if (this.host == "") {
            this.host = os.hostname();
        }
        const span: Span = Logger.otel.startSubSpan("db.connect", parent);
        span?.addEvent("connecting to mongodb");
        Logger.instanse.info("Connecting to mongodb", span, { cls: "DatabaseConnection", func: "connect" });
        const options: MongoClientOptions = { minPoolSize: Config.mongodb_minpoolsize, maxPoolSize: Config.mongodb_maxpoolsize };
        this.cli = await MongoClient.connect(this.mongodburl, options);
        Logger.instanse.info("Connected to mongodb", span, { cls: "DatabaseConnection", func: "connect" });
        span?.addEvent("Connected to mongodb");

        Logger.instanse.silly("Really connected to mongodb", span, { cls: "DatabaseConnection", func: "connect" });
        const errEvent = (error) => {
            this.isConnected = false;
            Logger.instanse.info("mongodb.error", span, { cls: "DatabaseConnection", func: "connect" });
            Logger.instanse.error(error, span, { cls: "DatabaseConnection", func: "connect" });
            this.emit("disconnected");
        }
        const parseErrEvent = (error) => {
            this.isConnected = false;
            Logger.instanse.info("mongodb.parseError", span, { cls: "DatabaseConnection", func: "connect" });
            Logger.instanse.error(error, span, { cls: "DatabaseConnection", func: "connect" });
            this.emit("disconnected");
        }
        const closeEvent = () => {
            this.isConnected = false;
            Logger.instanse.info("mongodb.close", span, { cls: "DatabaseConnection", func: "connect" });
            Logger.instanse.silly("Disconnected from mongodb", span, { cls: "DatabaseConnection", func: "connect" });
            this.emit("disconnected");
        }
        this.cli
            .on("connectionReady", () => {
            })
            .on("error", errEvent)
            .on("parseError", parseErrEvent)
            .on("timeout", errEvent)
            .on("close", closeEvent)
        this.db = this.cli.db(this._dbname);
        await Config.db.UpdateIndexTypes(span);
        this.doRegisterGlobalWatch(span);
        this.isConnected = true;
        Logger.otel.endSpan(span);
        this.emit("connected");
    }
    public ensureQueueMonitoring() {
        if (Config.workitem_queue_monitoring_enabled) {
            if (this.queuemonitoringhandle == null) {
                this.queuemonitoringhandle = setTimeout(this.queuemonitoring.bind(this), Config.workitem_queue_monitoring_interval);
            }
        } else if (this.queuemonitoringhandle != null) {
            Logger.instanse.warn("queue monitoring stopeed, clearing enabled: " +
                Config.workitem_queue_monitoring_enabled + " handle: " + this.queuemonitoringhandle, null, { cls: "DatabaseConnection", func: "ensureQueueMonitoring" });
            try {
                clearTimeout(this.queuemonitoringhandle);
            } catch (error) {
            }
            this.queuemonitoringhandle = null;
        } else {
            Logger.instanse.warn("queue monitoring not started enabled: " +
                Config.workitem_queue_monitoring_enabled + " handle: " + this.queuemonitoringhandle, null, { cls: "DatabaseConnection", func: "ensureQueueMonitoring" });
        }
    }
    async queuemonitoring() {
        try {
            if (!this.isConnected == true) {
                return;
            }
            const jwt = Crypt.rootToken();
            const collectionname = "workitems";
            var queues = await Logger.DBHelper.GetPushableQueues(null);
            var test = queues.find(x => x._id == "63b6a9b41e86860136c2cc8b");
            for (let i = 0; i < queues.length; i++) {
                const wiq = queues[i];
                const count = await Logger.DBHelper.GetPendingWorkitemsCount(wiq._id, null);
                if (count < 1) continue;
                var payload = null;
                let queueids = [];
                if (!Util.IsNullEmpty(wiq.robotqueue) && !Util.IsNullEmpty(wiq.workflowid)) {
                    if (wiq.robotqueue.toLowerCase() != "(empty)" && wiq.workflowid.toLowerCase() != "(empty)") {
                        let queueid = wiq.robotqueue.toLowerCase();
                        queueids.push(queueid);
                    }
                }
                if (!Util.IsNullEmpty(wiq.amqpqueue)) {
                    let queueid = wiq.amqpqueue.toLowerCase();
                    if (queueids.indexOf(queueid) == -1) {
                        queueids.push(queueid);
                    }
                }
                if (queueids.length == 0) { continue; }
                for (var _cid = 0; _cid < WebSocketServer._clients.length; _cid++) {
                    const client = WebSocketServer._clients[_cid];
                    if (Util.IsNullUndefinded(client.user)) continue;

                    var sendit = false;
                    for (var q = 0; client._queues.length > q; q++) {
                        var queue = client._queues[q];
                        if (queueids.indexOf(queue.queuename?.toLocaleLowerCase()) > -1) {
                            sendit = true;
                            break;
                        }
                    }
                    if (sendit) {
                        payload = {
                            "wiq": wiq.name,
                            "wiqid": wiq._id,
                            "packageid": (wiq as any).packageid,
                        }
                        var sendthis = payload;
                        if (client.clientagent == "openrpa") {
                            sendthis = {
                                command: "invoke",
                                workflowid: wiq.workflowid,
                                data: {},
                                "wiq": wiq.name, "wiqid": wiq._id, "packageid": (wiq as any).packageid,
                            }
                        }
                        if (payload != null) {
                            Logger.instanse.debug("Send workitem payload '" + payload.name + "' to client " + (client.username + "/" + client.clientagent + "/" + client.id).trim(), null,
                                { workflowid: wiq.workflowid, wi: payload._id, name: payload.name, cls: "DatabaseConnection", func: "queuemonitoring" });
                            try {
                                for (let _y = 0; _y < queueids.length; _y++) {
                                    client.Queue(JSON.stringify(sendthis), queueids[_y], {} as any, null).catch(e => {
                                        Logger.instanse.error(e, null, { cls: "DatabaseConnection", func: "queuemonitoring" });
                                    });
                                }
                                await new Promise(resolve => setTimeout(resolve, 1000));
                            } catch (error) {
                            }
                        } else {
                            await Logger.DBHelper.CheckCache("mq", wiq, false, false, null);
                        }
                    }
                }
            }
        } catch (error) {
            Logger.instanse.error(error, null, { cls: "DatabaseConnection", func: "queuemonitoring" });
        }
        finally {
            this.queuemonitoringhandle = null;
            this.ensureQueueMonitoring();
        }
    }
    async GlobalWatchCallback(collectionname: string, next: any) {
        let span: Span = Logger.otel.startSpan("db.GlobalWatchCallback", null, null);
        let discardspan: boolean = true;
        try {
            if (next.documentKey == null) {
                return;
            }
            var _id = next.documentKey._id;
            if (next.operationType == "update" && collectionname == "users") {
                if (next.updateDescription != null && next.updateDescription.updatedFields != null) {
                    if (next.updateDescription.updatedFields.hasOwnProperty("_heartbeat")) return;
                    if (next.updateDescription.updatedFields.hasOwnProperty("lastseen")) return;
                    if (next.updateDescription.updatedFields.hasOwnProperty("_rpaheartbeat")) return;
                    if (next.updateDescription.updatedFields.hasOwnProperty("_webheartbeat")) return;
                    if (next.updateDescription.updatedFields.hasOwnProperty("_noderedheartbeat")) return;
                    if (next.updateDescription.updatedFields.hasOwnProperty("_powershellheartbeat")) return;
                    if (next.updateDescription.updatedFields.hasOwnProperty("remoteip") &&
                        next.updateDescription.updatedFields.hasOwnProperty("clientversion")) return;
                    if (next.updateDescription.updatedFields.hasOwnProperty("clientagent")) return;

                }
            }
            var item = next.fullDocument;
            var _type = "";
            if (collectionname == "config" && Util.IsNullUndefinded(item)) {
                item = await this.GetLatestDocumentVersion({ collectionname, id: _id, jwt: Crypt.rootToken() }, span);
            }
            if (Config.cache_store_type != "redis" && Config.cache_store_type != "mongodb") {
                if (next.operationType == "delete" && collectionname == "users") {
                    item = await this.GetLatestDocumentVersion({ collectionname, id: _id, jwt: Crypt.rootToken() }, span);
                    if (!Util.IsNullUndefinded(item)) {
                        await Logger.DBHelper.CheckCache(collectionname, item, true, false, span);
                    }
                }
            }

            if (!Util.IsNullUndefinded(item)) {
                if (Config.log_all_watches == true) {
                    Logger.instanse.debug(collectionname + " watch " + next?.fullDocument?._type + " " + next?.operationType + " " + next?.fullDocument?.name, span, { cls: "DatabaseConnection", func: "onchange", collection: collectionname });
                }
            }

            if (!Util.IsNullUndefinded(item)) {
                _type = item._type;
                await Logger.DBHelper.CheckCache(collectionname, item, true, false, span);
                if (collectionname == "mq") {
                    discardspan = false;
                }
                if (collectionname == "workitems" && _type == "workitem") {
                    discardspan = false;
                }
                if (collectionname == "users" && (_type == "user" || _type == "role" || _type == "customer")) {
                    discardspan = false;
                    if (_type == "user" && item.disabled == true) {
                        for (let i = 0; i < WebSocketServer._clients.length; i++) {
                            let _cli = WebSocketServer._clients[i];
                            if (_cli.user?._id == item._id) {
                                Logger.instanse.warn("Disconnecting [" + _cli.username + "/" + _cli.clientagent + "/" + _cli.id + "] who is now on disabled!", span, { collection: collectionname, user: _cli.username, cls: "DatabaseConnection", func: "GlobalWatchCallback" });
                                WebSocketServer._clients[i].Close(span);
                            }
                        }
                    } else if (_type == "user" && item.dblocked == true) {
                        for (let i = 0; i < WebSocketServer._clients.length; i++) {
                            let _cli = WebSocketServer._clients[i];
                            if (_cli.user?._id == item._id && _cli.clientagent == "openrpa") {
                                Logger.instanse.warn("Disconnecting [" + _cli.username + "/" + _cli.clientagent + "/" + _cli.id + "] who is now on dblocked!", span, { collection: collectionname, user: _cli.username, cls: "DatabaseConnection", func: "GlobalWatchCallback" });
                                WebSocketServer._clients[i].Close(span);
                            }
                        }
                    }
                }
                if (collectionname == "config" && (_type == "restriction" || _type == "resource" || _type == "resourceusage")) {
                    discardspan = false;
                }
                if (collectionname == "config" && _type == "provider") {
                    discardspan = false;
                    await LoginProvider.RegisterProviders(WebServer.app, Config.baseurl(), span);
                }
                if (collectionname == "config" && _type == "ipblock") {
                    discardspan = false;
                    if (!Util.IsNullUndefinded(item.ips) && item.ips.length > 0) {
                        for (let i = 0; i < WebSocketServer._clients.length; i++) {
                            let _cli = WebSocketServer._clients[i];
                            if ((await WebServer.isIPBlocked(_cli.remoteip)) == true) {
                                Logger.instanse.warn("Disconnecting [" + _cli.username + "/" + _cli.clientagent + "/" + _cli.id + "] who is now on blocked list! " + _cli.remoteip, span, { collection: collectionname, user: _cli.username, cls: "DatabaseConnection", func: "GlobalWatchCallback" });
                                WebSocketServer._clients[i].Close(span);
                            }
                        }
                    }
                }
                if (collectionname === "config" && _type === "oauthclient") {
                    discardspan = false;
                    setTimeout(() => OAuthProvider.LoadClients(span), 1000);
                }
                if (collectionname === "config" && _type === "config") {
                    discardspan = false;
                    await dbConfig.Reload(Crypt.rootToken(), true, span);
                    try {
                        amqpwrapper.Instance().setPrefetch(Config.amqp_prefetch, span);
                        await Logger.configure(false, false);
                    } catch (error) {
                        Logger.instanse.error(error, span, { cls: "DatabaseConnection", func: "GlobalWatchCallback" });
                    }
                }
            }
            span.updateName("Watch " + collectionname + " " + next.operationType + " " + _type);
            let doContinue: boolean = false;
            if (WebSocketServer._clients)
                for (let i = 0; i < WebSocketServer._clients.length; i++) {
                    let client = WebSocketServer._clients[i];
                    if (Util.IsNullUndefinded(client.user)) continue;
                    let ids = Object.keys(client.watches);
                    for (let y = 0; y < ids.length; y++) {
                        var stream = client.watches[ids[y]];
                        if (stream.collectionname != collectionname) continue;
                        doContinue = true;
                        break;
                    }
                    if (doContinue == true) break;
                }
            if (!doContinue) return;

            if (Util.IsNullEmpty(item)) item = await this.GetLatestDocumentVersion({ collectionname, id: _id, jwt: Crypt.rootToken() }, null);
            if (Util.IsNullEmpty(item)) {
                Logger.instanse.error("Missing fullDocument and could not find historic version for " + _id + " in " + collectionname, span, { collection: collectionname, cls: "DatabaseConnection", func: "GlobalWatchCallback" }); return;
            } else {
                Logger.instanse.verbose("[" + next.operationType + "] " + _id + " " + item.name, span, { collectionname, cls: "DatabaseConnection", func: "GlobalWatchCallback" });
            }
            try {
                for (var i = 0; i < WebSocketServer._clients.length; i++) {
                    var client = WebSocketServer._clients[i];
                    if (Util.IsNullUndefinded(client.user)) continue;
                    const tuser: TokenUser = TokenUser.From(client.user);
                    try {
                        if (DatabaseConnection.hasAuthorization(tuser, item, Rights.read)) {
                            try {
                                var ids = Object.keys(client.watches);
                                for (var y = 0; y < ids.length; y++) {
                                    let notify: boolean = false;
                                    var stream = client.watches[ids[y]];
                                    if (stream.collectionname != collectionname) {
                                    } else if (Util.IsNullUndefinded(stream.aggregates)) {
                                        notify = true;
                                    } else if (stream.aggregates.length == 0) {
                                        notify = true;
                                    } else if (typeof stream.aggregates[0] === "object") {
                                        // This is fucking ugly, but need something to be backward compatible with older version of OpenRPA and Nodered Nodes
                                        var match = stream.aggregates[0]["$match"];
                                        if (Util.IsNullUndefinded(match)) { continue; }
                                        var keys = Object.keys(match);
                                        var ismatch = true;
                                        keys.forEach(key => {
                                            var targetkey = key.replace("fullDocument.", "");
                                            var value = match[key];
                                            if (value = "{'$exists': true}") {
                                                if (!item.hasOwnProperty(targetkey)) ismatch = false;
                                            } else {
                                                if (item[targetkey] != value) ismatch = false;
                                            }

                                        });
                                        if (ismatch) notify = true;
                                    } else {
                                        var paths = stream.paths;
                                        if (paths == null || paths.length == 0) paths = stream.aggregates as any; // Backward compatibility
                                        if (Array.isArray(paths)) {
                                            for (let p = 0; p < paths.length; p++) {
                                                let path = paths[p];
                                                if (!Util.IsNullEmpty(path)) {
                                                    try {
                                                        const result = JSONPath({ path, json: { a: item } });
                                                        if (result && result.length > 0) notify = true;
                                                    } catch (error) {
                                                        Logger.instanse.error(error, span, { collection: collectionname, cls: "DatabaseConnection", func: "GlobalWatchCallback" });
                                                    }
                                                }
                                            }
                                        } else {
                                            if (!Util.IsNullEmpty(paths)) {
                                                try {
                                                    let path = paths;
                                                    const result = JSONPath({ path, json: { a: item } });
                                                    if (result && result.length > 0) notify = true;
                                                } catch (error) {
                                                    Logger.instanse.error(error, span, { collection: collectionname, cls: "DatabaseConnection", func: "GlobalWatchCallback" });
                                                }
                                            }
                                        }
                                        // Watch all
                                        if (stream.aggregates.length == 0) {
                                            notify = true;
                                        } else if (stream.aggregates.length == 1 && stream.aggregates[0] == "") {
                                            notify = true;
                                        }
                                    }
                                    if (notify) {
                                        discardspan = false;
                                        if (!next.fullDocument) next.fullDocument = item;
                                        if (next.fullDocument) {
                                            next.fullDocument = Config.db.decryptentity(next.fullDocument);
                                            DatabaseConnection.traversejsondecode(next.fullDocument);
                                            this.parseResult(next.fullDocument, client.clientagent, client.clientversion)
                                            client.SendWatch(stream, next, span);
                                        }

                                    }
                                }

                            } catch (error) {
                                discardspan = false;
                                Logger.instanse.error(error, span, { collection: collectionname, cls: "DatabaseConnection", func: "GlobalWatchCallback" });
                            }
                        }
                    } catch (error) {
                        discardspan = false;
                        Logger.instanse.error(error, span, { collection: collectionname, cls: "DatabaseConnection", func: "GlobalWatchCallback" });
                    }
                }
            } catch (error) {
                discardspan = false;
                Logger.instanse.error(error, span, { collection: collectionname, cls: "DatabaseConnection", func: "GlobalWatchCallback" });
            }
        } catch (error) {
            discardspan = false;
            Logger.instanse.error(error, span, { collection: collectionname, cls: "DatabaseConnection", func: "GlobalWatchCallback" });
        } finally {
            if (!discardspan) span?.end();
        }
    }
    async doRegisterGlobalWatch(span: Span) {
        span?.addEvent("registerGlobalWatch");
        try {
            Logger.instanse.verbose("register global watch", span, { cls: "DatabaseConnection", func: "doRegisterGlobalWatch" });
            this.stream = new clsstream();
            this.stream.stream = this.db.watch([], { fullDocument: "updateLookup" });
            this.stream.stream.on("error", err => {
                Logger.instanse.error(err, span, { cls: "DatabaseConnection", func: "doRegisterGlobalWatch" });
                try {
                    this.stream.stream.close();
                } catch (error) {
                }
                this.hadWatchFault = true;
                this.lastWatchFault = new Date();
                this.stream.stream = null;
                if (this.watchFaultHandler == null) {
                    this.watchFaultHandler = setTimeout(() => {
                        try {
                            this.doRegisterGlobalWatch(null);
                        } catch (error) {
                            Logger.instanse.error(error, span, { cls: "DatabaseConnection", func: "doRegisterGlobalWatch" });
                        }
                    }, 5000);
                }
            });
            this.stream.stream.on("change", async (next: any) => {
                const collectionname = next.ns.coll;
                this.GlobalWatchCallback(collectionname, next)
            });
        } catch (error) {
            Logger.instanse.error(error, span, { cls: "DatabaseConnection", func: "doRegisterGlobalWatch" });
            return false;
        }
    }
    async ListCollections(includesystem: boolean, jwt: string): Promise<any[]> {
        let result = await Logger.DBHelper.GetCollections(null);
        if (includesystem == false) {
            result = result.filter(x => x.name.indexOf("system.") === -1);
        } else {
            // remove all that starts with system. except system.profile
            result = result.filter(x => x.name != null && (x.name.indexOf("system.") === -1 || x.name == "system.profile"));
        }
        result.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
        const user = await Auth.Token2User(jwt, null);
        if (user == null) throw new Error("Access denied");
        if (user._id == Wellknown.guest._id) {
            result = result.filter(x => x.name != "audit");
        }
        return result;
    }
    static reserved_collection_names = ["git", "workflow", "entities", "config", "audit", "jslog", "openrpa", "nodered", "openrpa_instances", "forms", "workflow_instances", "users"];
    async DropCollection(collectionname: string, jwt: string, parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("db.DropCollection", parent);
        let user: User = null;
        try {
            if (collectionname == null || collectionname == "") throw new Error("collectionname is mandatory");
            user = await Auth.Token2User(jwt, span);
            if (user == null) throw new Error("Access denied");
            span?.setAttribute("collection", collectionname);
            span?.setAttribute("username", user.username);
            if (!user.HasRoleName(Wellknown.admins.name)) throw new Error("Access denied, droppping collection " + collectionname);
            if (DatabaseConnection.reserved_collection_names.indexOf(collectionname.toLocaleLowerCase()) > -1) throw new Error("Access denied, dropping reserved collection " + collectionname);
            await this.db.dropCollection(collectionname);
            Audit.AuditCollectionAction(user, "drop", collectionname, true, span);
            if (collectionname.endsWith(".files")) {
                await this.db.dropCollection(collectionname.replace(".files", ".chunks"));
                Audit.AuditCollectionAction(user, "drop", collectionname.replace(".files", ".chunks"), true, span);
            }
            try {
                if (!collectionname.endsWith("_hist")) {
                    await this.db.dropCollection(collectionname + "_hist");
                    Audit.AuditCollectionAction(user, "drop", collectionname + "_hist", true, span);
                }
            } catch (error) {
            }
            await Logger.DBHelper.ClearGetCollections();
        } finally {
            Audit.AuditCollectionAction(user, "drop", collectionname, false, span);
            Logger.otel.endSpan(span);
        }
    }
    async CreateCollection(collectionname: string, options: any, jwt: string, parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("db.CreateCollection", parent);
        let user: User = null;
        try {
            if (collectionname == null || collectionname == "") throw new Error("collectionname is mandatory");
            user = await Auth.Token2User(jwt, span);
            if (user == null) throw new Error("Access denied");
            span?.setAttribute("collection", collectionname);
            span?.setAttribute("username", user.username);
            if (!user.HasRoleName(Wellknown.admins.name)) throw new Error("Access denied, creating collection " + collectionname);
            if (DatabaseConnection.reserved_collection_names.indexOf(collectionname.toLocaleLowerCase()) > -1) throw new Error("Access denied, creating reserved collection " + collectionname);
            delete options.jwt;
            delete options.priority;
            delete options.collectionname;
            var _options = JSON.parse(JSON.stringify(options))
            if (_options.expireAfterSeconds != null && _options.expireAfterSeconds > 0) {
                if (_options.metadata == null) {
                    delete _options.expireAfterSeconds;
                }
            }
            await this.db.createCollection(collectionname, _options);
            Audit.AuditCollectionAction(user, "create", collectionname, true, span);
            if (options.expireAfterSeconds != null && options.expireAfterSeconds > 0) {
                if (options.metadata == null) {
                    await this.createIndex(collectionname, null, { "_created": 1 }, { expireAfterSeconds: options.expireAfterSeconds }, span);
                }
            }
            await Logger.DBHelper.ClearGetCollections();
            setTimeout(async () => {
                await Logger.DBHelper.ClearGetCollections();
                await this.UpdateIndexTypes(span);
            }, 500);
        } catch (error) {
            Audit.AuditCollectionAction(user, "create", collectionname, false, span);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public static WellknownIdsArray: string[] = [
        Wellknown.root._id,
        Wellknown.admins._id,
        Wellknown.users._id,
        Wellknown.robots._id,
        Wellknown.nodered_users._id,
        Wellknown.nodered_admins._id,
        Wellknown.nodered_api_users._id,
        Wellknown.filestore_users._id,
        Wellknown.filestore_admins._id,
        Wellknown.robot_users._id,
        Wellknown.robot_admins._id,
        Wellknown.personal_nodered_users._id,
        Wellknown.robot_agent_users._id,
        Wellknown.customer_admins._id,
        Wellknown.resellers._id,
        Wellknown.guest._id,
        Wellknown.workitem_queue_admins._id,
        Wellknown.workitem_queue_users._id,
    ]
    public static WellknownNamesArray: string[] = [
        Wellknown.root.name,
        Wellknown.admins.name,
        Wellknown.users.name,
        Wellknown.robots.name,
        Wellknown.nodered_users.name,
        Wellknown.nodered_admins.name,
        Wellknown.nodered_api_users.name,
        Wellknown.filestore_users.name,
        Wellknown.filestore_admins.name,
        Wellknown.robot_users.name,
        Wellknown.robot_admins.name,
        Wellknown.personal_nodered_users.name,
        Wellknown.robot_agent_users.name,
        Wellknown.customer_admins.name,
        Wellknown.resellers.name,
        Wellknown.guest.name,
        Wellknown.workitem_queue_admins.name,
        Wellknown.workitem_queue_users.name,
        "reseller",
        "user",
        "admin",
        "nodered",
        "administrator",
        "workflow",
        "robot",
    ]

    async CleanACL<T extends Base>(item: T, user: TokenUser | User, collectionname: string, parent: Span, skipNameLookup: boolean = false): Promise<T> {
        const span: Span = Logger.otel.startSubSpan("db.CleanACL", parent);
        try {
            if (item == null) throw new Error("item is mandatory");
            if (user == null) throw new Error("user is mandatory");
            if (collectionname == null || collectionname == "") throw new Error("collectionname is mandatory");
            if (item._acl.length > Config.max_ace_count) {
                // remove excesive acls
                const newacl = item._acl.slice(0, Config.max_ace_count);
                item._acl = newacl;
            }
            let precount: number = item._acl.length;
            // remove duplicate acls
            item._acl = item._acl.filter((thing, index, self) =>
                index === self.findIndex((t) => (
                    t._id === thing._id && t.rights === thing.rights
                ))
            )
            if (item._acl.length != precount) {
                let diff = precount - item._acl.length;
                Logger.instanse.warn("Removed " + diff + " doublicate aces from " + item.name, span, { count: diff, cls: "DatabaseConnection", func: "CleanACL" });
            }
            precount = item._acl.length;
            if (Config.allow_merge_acl) {
                // merge acls by combining  bits for all aces with same id 
                item._acl = item._acl.reduce((acc, cur) => {
                    const found = acc.find(x => x._id == cur._id);
                    if (found) {
                        for (let index = 0; index < Ace.ace_right_bits; index++) {
                            if (Ace.isBitSet(cur, index)) Ace.setBit(found, index)
                        }
                    } else {
                        acc.push(cur);
                    }
                    return acc;
                }, [] as Ace[]);
                if (item._acl.length != precount) {
                    let diff = precount - item._acl.length;
                    Logger.instanse.warn("Merged " + diff + " aces from " + item.name, span, { count: diff, cls: "DatabaseConnection", func: "CleanACL" });
                }
            }


            for (let i = item._acl.length - 1; i >= 0; i--) {
                {
                    let ace = item._acl[i];
                    if (ace.rights == 0) {
                        item._acl.splice(i, 1);
                        continue;
                    }
                    // force updating ace to number
                    if (typeof ace.rights === "string" || typeof ace.rights === "object") {
                        const newace = new Ace();
                        Ace.resetnone(newace);
                        newace._id = ace._id; newace.deny = ace.deny;
                        for (var y = 0; y < Ace.ace_right_bits; y++) {
                            if (Ace.isBitSet(ace, y)) Ace.setBit(newace, y);
                        }
                        item._acl[i] = newace;
                        ace = newace;
                    }
                    if (ace.deny == false) delete ace.deny;
                    if (!skipNameLookup) {
                        let _user = await Logger.DBHelper.FindById(ace._id, span);
                        if (Util.IsNullUndefinded(_user)) {
                            item._acl.splice(i, 1);
                        } else {
                            ace.name = _user.name;
                            //delete ace.name;
                        }
                    }
                }
            }
            if (!DatabaseConnection.hasAuthorization(user, item, Rights.read)) {
                Base.addRight(item, user._id, user.name, [Rights.full_control]);
            } else if (!DatabaseConnection.hasAuthorization(user, item, Rights.update)) {
                Base.addRight(item, user._id, user.name, [Rights.full_control]);
            }
            item = this.ensureResource(item, collectionname);
        } catch (error) {
            Logger.instanse.error(error, span, { collection: collectionname, cls: "DatabaseConnection", func: "CleanACL" });
        }
        Logger.otel.endSpan(span);
        return item;
    }
    async Cleanmembers<T extends Role>(item: T, original: T, force: boolean, span: Span): Promise<T> {
        const removed: Rolemember[] = [];
        if (force == false && DatabaseConnection.WellknownIdsArray.indexOf(item._id) >= 0) return item;
        if (Util.IsNullUndefinded(item.members)) item.members = [];
        if (original != null && Config.update_acl_based_on_groups === true) {
            for (let i = original.members.length - 1; i >= 0; i--) {
                const ace = original.members[i];
                const exists = item.members.filter(x => x._id === ace._id);
                if (exists.length === 0) removed.push(ace);
            }
        }
        let precount: number = item.members.length;
        // remove doublicate members
        item.members = item.members.filter((thing, index, self) =>
            index === self.findIndex((t) => (
                t._id === thing._id
            ))
        )
        if (item.members.length != precount) {
            let diff = precount - item.members.length;
            Logger.instanse.warn("Removed " + diff + " doublicate members from " + item.name, span, { count: diff, cls: "DatabaseConnection", func: "Cleanmembers" });
        }

        let doadd: boolean = true;
        if ((item as any).hidemembers == true) {
            doadd = false;
            for (let i = item.members.length - 1; i >= 0; i--) {
                const ace = item.members[i];
                removed.push(ace);
            }
        }
        const multi_tenant_skip: string[] = [Wellknown.users._id, Wellknown.filestore_users._id,
        Wellknown.nodered_api_users._id, Wellknown.nodered_users._id, Wellknown.personal_nodered_users._id,
        Wellknown.robot_users._id, Wellknown.robots._id, Wellknown.customer_admins._id, Wellknown.resellers._id];
        if (item._id === Wellknown.users._id && Config.multi_tenant) {
            doadd = false;
        }
        if (doadd) {
            for (let i = item.members.length - 1; i >= 0; i--) {
                {
                    const ace = item.members[i];
                    const exists = item.members.filter(x => x._id === ace._id);
                    if (exists.length > 1) {
                        item.members.splice(i, 1);
                    } else {
                        const ot_end = Logger.otel.startTimer();
                        const cursor = this.db.collection("users").find({ _id: ace._id }).project({ name: 1, _acl: 1, _type: 1 }).limit(1);
                        const arr = await cursor.toArray();
                        cursor.close();
                        let ms = Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_query, DatabaseConnection.otel_label("users", Crypt.rootUser(), "query"));
                        if (Config.log_database_queries && ms >= Config.log_database_queries_ms)
                            Logger.instanse.debug("Query: " + JSON.stringify({ _id: ace._id }), span, { ms, count: arr.length, collection: "users", cls: "DatabaseConnection", func: "Cleanmembers" });
                        if (arr.length === 0) {
                            item.members.splice(i, 1);
                        }
                        else if (Config.update_acl_based_on_groups === true) {
                            ace.name = arr[0].name;
                            if (Config.multi_tenant && multi_tenant_skip.indexOf(item._id) > -1) {
                                // when multi tenant don't allow members of common user groups to see each other
                                Logger.instanse.silly("Running in multi tenant mode, skip adding permissions for " + item.name, span, { cls: "DatabaseConnection", func: "Cleanmembers" });
                            } else if (arr[0]._type === "user") {
                                let u: User = User.assign(arr[0]);
                                if (!Base.hasRight(u, item._id, Rights.read)) {
                                    Logger.instanse.silly("Assigning " + item.name + " read permission to " + u.name, span, { cls: "DatabaseConnection", func: "Cleanmembers" });
                                    Base.addRight(u, item._id, item.name, [Rights.read], false);
                                    u = this.ensureResource(u, "users");
                                    const _ot_end1 = Logger.otel.startTimer();
                                    await this.db.collection("users").updateOne({ _id: u._id }, { $set: { _acl: u._acl } });
                                    Logger.otel.endTimer(_ot_end1, DatabaseConnection.mongodb_update, DatabaseConnection.otel_label("users", Crypt.rootUser(), "update"));
                                } else if (u._id != item._id) {
                                    Logger.instanse.silly(item.name + " allready exists on " + u.name, span, { cls: "DatabaseConnection", func: "Cleanmembers" });
                                }
                            } else if (arr[0]._type === "role") {
                                let r: Role = Role.assign(arr[0]);
                                if (r._id !== Wellknown.admins._id && r._id !== Wellknown.users._id && !Base.hasRight(r, item._id, Rights.read)) {
                                    Logger.instanse.silly("Assigning " + item.name + " read permission to " + r.name, span, { cls: "DatabaseConnection", func: "Cleanmembers" });
                                    Base.addRight(r, item._id, item.name, [Rights.read], false);
                                    r = this.ensureResource(r, "users");
                                    const _ot_end2 = Logger.otel.startTimer();
                                    await this.db.collection("users").updateOne({ _id: r._id }, { $set: { _acl: r._acl } });
                                    Logger.otel.endTimer(_ot_end2, DatabaseConnection.mongodb_update, DatabaseConnection.otel_label("users", Crypt.rootUser(), "update"));
                                } else if (r._id != item._id) {
                                    Logger.instanse.silly(item.name + " allready exists on " + r.name, span, { cls: "DatabaseConnection", func: "Cleanmembers" });
                                }

                            }
                        }
                    }
                }
            }
        }

        if (Config.update_acl_based_on_groups) {
            for (let i = removed.length - 1; i >= 0; i--) {
                const ace = removed[i];
                if (Util.IsNullUndefinded(ace)) continue;
                const ot_end = Logger.otel.startTimer();
                const cursor = this.db.collection("users").find({ _id: ace._id }).project({ name: 1, _acl: 1, _type: 1 }).limit(1);
                const arr = await cursor.toArray();
                cursor.close();
                let ms = Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_query, DatabaseConnection.otel_label("users", Crypt.rootUser(), "query"));
                if (Config.log_database_queries && ms >= Config.log_database_queries_ms) Logger.instanse.debug("Query: " + JSON.stringify({ _id: ace._id }), span, { ms: ms, count: arr.length, collection: "users", cls: "DatabaseConnection", func: "Cleanmembers" });
                if (arr.length === 1 && item._id != Wellknown.admins._id && item._id != Wellknown.root._id) {
                    if (Config.multi_tenant && multi_tenant_skip.indexOf(item._id) > -1 && !((item as any).hidemembers == true)) {
                        // when multi tenant don't allow members of common user groups to see each other
                        Logger.instanse.verbose("Running in multi tenant mode, skip removing permissions for " + item.name, span, { cls: "DatabaseConnection", func: "Cleanmembers" });
                    } else if (arr[0]._type === "user") {
                        let u: User = User.assign(arr[0]);
                        if (Base.hasRight(u, item._id, Rights.read)) {
                            Base.removeRight(u, item._id, [Rights.read]);

                            // was read the only right ? then remove it
                            const right = Base.getRight(u, item._id, false);
                            if (Util.IsNullUndefinded(right) || (!Ace.isBitSet(right, 3) && !Ace.isBitSet(right, 4) && !Ace.isBitSet(right, 5))) {
                                Base.removeRight(u, item._id, [Rights.full_control]);
                                u = this.ensureResource(u, "users");
                                Logger.instanse.debug("Removing " + item.name + " read permissions from " + u.name, span, { cls: "DatabaseConnection", func: "Cleanmembers" });
                                const _ot_end1 = Logger.otel.startTimer();
                                await this.db.collection("users").updateOne({ _id: u._id }, { $set: { _acl: u._acl } });
                                Logger.otel.endTimer(_ot_end1, DatabaseConnection.mongodb_update, DatabaseConnection.otel_label("users", Crypt.rootUser(), "update"));
                            }

                        } else {
                            Logger.instanse.debug("No need to remove " + item.name + " read permissions from " + u.name, span, { cls: "DatabaseConnection", func: "Cleanmembers" });
                        }
                    } else if (arr[0]._type === "role") {
                        let r: Role = Role.assign(arr[0]);
                        if (Base.hasRight(r, item._id, Rights.read)) {
                            Base.removeRight(r, item._id, [Rights.read]);

                            // was read the only right ? then remove it
                            const right = Base.getRight(r, item._id, false);
                            if (Util.IsNullUndefinded(right) || (!Ace.isBitSet(right, 3) && !Ace.isBitSet(right, 4) && !Ace.isBitSet(right, 5))) {
                                Base.removeRight(r, item._id, [Rights.full_control]);
                                r = this.ensureResource(r, "users");
                                Logger.instanse.debug("Removing " + item.name + " read permissions from " + r.name, span, { cls: "DatabaseConnection", func: "Cleanmembers" });
                                const _ot_end2 = Logger.otel.startTimer();
                                await this.db.collection("users").updateOne({ _id: r._id }, { $set: { _acl: r._acl } });
                                Logger.otel.endTimer(_ot_end2, DatabaseConnection.mongodb_update, DatabaseConnection.otel_label("users", Crypt.rootUser(), "update"));
                            }

                        } else {
                            Logger.instanse.debug("No need to remove " + item.name + " read permissions from " + r.name, span, { cls: "DatabaseConnection", func: "Cleanmembers" });
                        }
                    }

                }
            }
        }
        return item;
    }
    public parseResult(item: Base, agent: string, version: string): void {
        if (agent != "openrpa") return;
        if (this.compare(version, "1.4.44") == 1) return; // skip if version is higher than 1.4.44
        if (item._acl != null) {
            for (var a = 0; a < item._acl.length; a++) {
                const ace = item._acl[a];
                if (typeof ace.rights == "number") {
                    var newace = new Ace();
                    newace._id = ace._id;
                    newace.name = ace.name;
                    newace.deny = ace.deny;
                    if (newace.deny == null) newace.deny = false;
                    newace.rights = "";
                    Ace.resetnone(newace);
                    for (var y = 0; y < Ace.ace_right_bits; y++) {
                        if (Ace.isBitSet(ace, y)) Ace.setBit(newace, y);
                    }
                    item._acl[a] = newace;
                }
            }
        }
    }
    public compare(cur: string, version: string): number {
        return cur.localeCompare(version, undefined, { numeric: true, sensitivity: "base" });
    }
    public parseResults(arr: any[], agent: string, version: string): void {
        if (arr == null || arr.length == 0) return;
        if (agent != "openrpa") return;
        if (this.compare(version, "1.4.44") == 1) return;// skip if version is higher than 1.4.44
        for (var i = 0; i < arr.length; i++) {
            const item = arr[i];
            this.parseResult(item, agent, version);
        }
    }
    /**
     * Send a query to the database.
     * @param {any} query MongoDB Query
     * @param {Object} projection MongoDB projection
     * @param {number} top Limit result to X number of results
     * @param {number} skip Skip a number of records (Paging)
     * @param {Object|string} orderby MongoDB orderby, or string with name of a single field to orderby
     * @param {string} collectionname What collection to query
     * @param {string} jwt JWT of user who is making the query, to limit results based on permissions
     * @param {boolean} decrypt Decrypt encrypted data, default: true
     * @returns Promise<T[]> Array of results
     */
    async query<T extends Base>(options: QueryOptions, span: Span): Promise<T[]> {
        let { query, projection, top, skip, orderby, collectionname, jwt, queryas, hint, decrypt } = Object.assign({
            top: 100,
            skip: 0,
            decrypt: true
        }, options);
        let _query: Object = {};
        await this.connect(span);
        let mysort: Object = {};
        if (collectionname == null || collectionname == "") throw new Error("collectionname is mandatory");
        if (orderby) {
            span?.addEvent("parse orderby");
            if (typeof orderby === "string" || orderby instanceof String) {
                let neworderby = null;
                try {
                    if (orderby.indexOf("{") > -1) {
                        neworderby = JSON.parse((orderby as string));
                        mysort = neworderby;
                    }
                } catch (error) {
                    span?.addEvent("Parsing order by failed");
                    span?.setAttribute("failedorderby", orderby as string);
                    Logger.instanse.error(error, span, { collection: collectionname, cls: "DatabaseConnection", func: "query" });
                }
                if (Util.IsNullUndefinded(neworderby)) mysort[(orderby as string)] = 1;
            } else {
                mysort = orderby;
            }
            span?.setAttribute("orderby", JSON.stringify(mysort));
        }
        let myhint: Object = {};
        if (hint) {
            span?.addEvent("parse hint");
            if (typeof hint === "string" || hint instanceof String) {
                let newhint = null;
                try {
                    if (hint.indexOf("{") > -1) {
                        newhint = JSON.parse((hint as string));
                        myhint = newhint;
                    }
                } catch (error) {
                    span?.addEvent("Parsing hint by failed");
                    span?.setAttribute("failedhint", hint as string);
                    Logger.instanse.error(error, span, { collectionname, cls: "DatabaseConnection", func: "query" });
                }
                if (Util.IsNullUndefinded(newhint)) myhint[(hint as string)] = 1;
            } else {
                myhint = hint;
            }
            span?.setAttribute("hint", JSON.stringify(myhint));
        }
        if (projection) {
            span?.addEvent("parse projection");
            if (typeof projection === "string" || projection instanceof String) {
                projection = JSON.parse((projection as string));
            }
            span?.setAttribute("projection", JSON.stringify(projection));
        }
        if (query !== null && query !== undefined) {
            span?.addEvent("parse query");
            let json: any = query;
            if (typeof json !== "string" && !(json instanceof String)) {
                json = JSON.stringify(json, (key, value) => {
                    if (value instanceof RegExp)
                        return ("__REGEXP " + value.toString());
                    else
                        return value;
                });
            }
            query = JSON.parse(json, (key, value) => {
                if (typeof value === "string" && value.match(isoDatePattern)) {
                    return new Date(value); // isostring, so cast to js date
                } else if (value != null && value != undefined && value.toString().indexOf("__REGEXP ") === 0) {
                    const m = value.split("__REGEXP ")[1].match(/\/(.*)\/(.*)?/);
                    return new RegExp(m[1], m[2] || "");
                } else
                    return value; // leave any other value as-is
            });
            if (Config.otel_trace_include_query) span?.setAttribute("query", JSON.stringify(query));
        }
        if (Util.IsNullUndefinded(query)) {
            throw new Error("Query is mandatory");
        }
        const keys: string[] = Object.keys(query);
        for (let key of keys) {
            if (key === "_id") {
                const id: string = query._id;
                if (id.length == 12 || id.length == 24) {
                    const safeid = safeObjectID(id);
                    if (safeid !== null && safeid !== undefined) {
                        delete query._id;
                        query.$or = [{ _id: id }, { _id: safeObjectID(id) }];
                    }
                } else {
                    delete query._id;
                    query.$or = [{ _id: id }];
                }
            }
        }
        span?.addEvent("verityToken");
        const user: User = await Auth.Token2User(jwt, span);
        if (user == null) throw new Error("Access denied");
        if (user._id == Wellknown.guest._id && collectionname == "audit") {
            return [];
        }

        span?.addEvent("getbasequery");
        if (collectionname === "files") { collectionname = "fs.files"; }
        if (DatabaseConnection.usemetadata(collectionname)) {
            let impersonationquery;
            if (!Util.IsNullEmpty(queryas)) impersonationquery = await this.getbasequeryuserid(user, queryas, [Rights.read], collectionname, span);
            if (!Util.IsNullEmpty(queryas) && !Util.IsNullUndefinded(impersonationquery)) {
                _query = { $and: [query, this.getbasequery(user, [Rights.read], collectionname), impersonationquery] };
            } else {
                _query = { $and: [query, this.getbasequery(user, [Rights.read], collectionname)] };
            }
            projection = null;
        } else {
            let impersonationquery: any;
            if (!Util.IsNullEmpty(queryas)) impersonationquery = await this.getbasequeryuserid(user, queryas, [Rights.read], collectionname, span)
            if (!Util.IsNullEmpty(queryas) && !Util.IsNullUndefinded(impersonationquery)) {
                _query = { $and: [query, this.getbasequery(user, [Rights.read], collectionname), impersonationquery] };
            } else {
                _query = { $and: [query, this.getbasequery(user, [Rights.read], collectionname)] };
            }
        }
        if (!top) { top = 500; }
        if (!skip) { skip = 0; }
        span?.setAttribute("collection", collectionname);
        span?.setAttribute("username", user.username);
        span?.setAttribute("top", top);
        span?.setAttribute("skip", skip);
        let arr: T[] = [];
        let findoptions: FindOptions = {};
        // @ts-ignore
        if (options.explain === true) {
            // @ts-ignore
            findoptions.explain = options.explain;
        }
        const ot_end = Logger.otel.startTimer();
        let _pipe = this.db.collection(collectionname).find(_query, findoptions);
        if (projection != null) {
            _pipe = _pipe.project(projection);
        }
        _pipe = _pipe.sort(mysort as any).limit(top).skip(skip);
        if (hint) {
            _pipe = _pipe.hint(myhint);
        }
        let ms = 0;
        try {
            let size = 0;
            for await (const c of _pipe) {
                size += getObjectSize(c);
                if (Config.max_memory_query_mb > 0 && size > (Config.max_memory_query_mb * 1024 * 1024)) {
                    Logger.instanse.error("Query size exceeded " + Config.max_memory_query_mb + " mb (" + formatBytes(size) + " with " + arr.length + " items)", span, { collection: collectionname, user: user?.username, count: arr.length, cls: "DatabaseConnection", func: "query" });
                    throw new Error("Query size exceeded " + Config.max_memory_query_mb + " mb (" + formatBytes(size) + " with " + arr.length + " items)");
                }
                arr.push(c as any);
            }
            if (size > 0) {
                Logger.instanse.debug("Query gave " + arr.length + " results using " + formatBytes(size) + " memory", span, { collection: collectionname, user: user?.username, count: arr.length, cls: "DatabaseConnection", func: "query" });
            }
        } finally {
            _pipe.close();
            ms = Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_query, DatabaseConnection.otel_label(collectionname, user, "query"));
        }
        if (collectionname === "users") {
            var clients = WebSocketServer.getclients(user)
            for (var i = 0; i < arr.length; i++) {
                if (arr[i]._type == "user") {
                    var client = clients.find(c => c.user?._id == arr[i]._id);
                    if (client != null) {
                        // @ts-ignore
                        arr[i].lastseen = client.lastheartbeat;
                    }
                }
            }
        }
        span?.setAttribute("results", arr.length);
        if (decrypt) for (let i: number = 0; i < arr.length; i++) { arr[i] = this.decryptentity(arr[i]); }
        DatabaseConnection.traversejsondecode(arr);
        if (Config.log_database_queries && ms >= Config.log_database_queries_ms) {
            Logger.instanse.debug(JSON.stringify(query), span, { collection: collectionname, user: user?.username, ms, count: arr.length, cls: "DatabaseConnection", func: "query" });
        } else {
            if (arr.length > 0) {
                Logger.instanse.verbose("query gave " + arr.length + " results ", span, { collection: collectionname, user: user?.username, ms, count: arr.length, cls: "DatabaseConnection", func: "query" });
            } else {
                Logger.instanse.silly("query gave " + arr.length + " results ", span, { collection: collectionname, user: user?.username, ms, count: arr.length, cls: "DatabaseConnection", func: "query" });
            }
        }
        return arr;
    }

    /**
     * Send a query to the database.
     * @param {any} query MongoDB Query
     * @param {string} collectionname What collection to query
     * @param {string} jwt JWT of user who is making the query, to limit results based on permissions
     * @returns Promise<T[]> Array of results
     */
    async count(options: CountOptions, span: Span): Promise<number> {
        let { query, collectionname, jwt, queryas } = Object.assign({
        }, options);
        let _query: Object = {};
        if (collectionname == null || collectionname == "") throw new Error("collectionname is mandatory");
        await this.connect(span);
        if (query !== null && query !== undefined) {
            span?.addEvent("parse query");
            let json: any = query;
            if (typeof json !== "string" && !(json instanceof String)) {
                json = JSON.stringify(json, (key, value) => {
                    if (value instanceof RegExp)
                        return ("__REGEXP " + value.toString());
                    else
                        return value;
                });
            }
            query = JSON.parse(json, (key, value) => {
                if (typeof value === "string" && value.match(isoDatePattern)) {
                    return new Date(value); // isostring, so cast to js date
                } else if (value != null && value != undefined && value.toString().indexOf("__REGEXP ") === 0) {
                    const m = value.split("__REGEXP ")[1].match(/\/(.*)\/(.*)?/);
                    return new RegExp(m[1], m[2] || "");
                } else
                    return value; // leave any other value as-is
            });
            if (Config.otel_trace_include_query) span?.setAttribute("query", JSON.stringify(query));
        }
        if (Util.IsNullUndefinded(query)) {
            throw new Error("Query is mandatory");
        }
        const keys: string[] = Object.keys(query);
        for (let key of keys) {
            if (key === "_id") {
                const id: string = query._id;
                const safeid = safeObjectID(id);
                if (safeid !== null && safeid !== undefined) {
                    const safeid = safeObjectID(id);
                    if (safeid !== null && safeid !== undefined) {
                        delete query._id;
                        query.$or = [{ _id: id }, { _id: safeObjectID(id) }];
                    }
                }
            }
        }
        span?.addEvent("verityToken");
        const user: User = await Auth.Token2User(jwt, span);
        if (user == null) throw new Error("Access denied");
        if (user._id == Wellknown.guest._id && collectionname == "audit") {
            return 0;
        }

        span?.addEvent("getbasequery");
        if (collectionname === "files") { collectionname = "fs.files"; }
        if (DatabaseConnection.usemetadata(collectionname)) {
            let impersonationquery;
            if (!Util.IsNullEmpty(queryas)) impersonationquery = await this.getbasequeryuserid(user, queryas, [Rights.read], collectionname, span);
            if (!Util.IsNullEmpty(queryas) && !Util.IsNullUndefinded(impersonationquery)) {
                _query = { $and: [query, this.getbasequery(user, [Rights.read], collectionname), impersonationquery] };
            } else {
                _query = { $and: [query, this.getbasequery(user, [Rights.read], collectionname)] };
            }
        } else {
            let impersonationquery: any;
            if (!Util.IsNullEmpty(queryas)) impersonationquery = await this.getbasequeryuserid(user, queryas, [Rights.read], collectionname, span)
            if (!Util.IsNullEmpty(queryas) && !Util.IsNullUndefinded(impersonationquery)) {
                _query = { $and: [query, this.getbasequery(user, [Rights.read], collectionname), impersonationquery] };
            } else {
                _query = { $and: [query, this.getbasequery(user, [Rights.read], collectionname)] };
            }
        }
        span?.setAttribute("collection", collectionname);
        span?.setAttribute("username", user.username);
        const ot_end = Logger.otel.startTimer();
        // @ts-ignore
        let result = await this.db.collection(collectionname).countDocuments(_query);
        span?.setAttribute("results", result);
        let ms = Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_count, DatabaseConnection.otel_label(collectionname, user, "count"));
        if (Config.log_database_queries && ms >= Config.log_database_queries_ms) {
            Logger.instanse.debug("Count: " + JSON.stringify(_query), span, { collection: collectionname, user: user?.username, ms, count: result, cls: "DatabaseConnection", func: "count" });
        } else {
            if (result > 0) {
                Logger.instanse.verbose("count gave " + result + " results ", span, { collection: collectionname, user: user?.username, ms, count: result, cls: "DatabaseConnection", func: "count" });
            } else {
                Logger.instanse.silly("count gave " + result + " results ", span, { collection: collectionname, user: user?.username, ms, count: result, cls: "DatabaseConnection", func: "count" });
            }
        }
        return result;
    }
    async distinct(options: DistinctOptions, span: Span): Promise<string[]> {
        let { query, collectionname, field, jwt, queryas } = Object.assign({
        }, options);
        let _query: Object = {};
        if (collectionname == null || collectionname == "") throw new Error("collectionname is mandatory");
        await this.connect(span);
        if (query !== null && query !== undefined) {
            span?.addEvent("parse query");
            let json: any = query;
            if (typeof json !== "string" && !(json instanceof String)) {
                json = JSON.stringify(json, (key, value) => {
                    if (value instanceof RegExp)
                        return ("__REGEXP " + value.toString());
                    else
                        return value;
                });
            }
            query = JSON.parse(json, (key, value) => {
                if (typeof value === "string" && value.match(isoDatePattern)) {
                    return new Date(value); // isostring, so cast to js date
                } else if (value != null && value != undefined && value.toString().indexOf("__REGEXP ") === 0) {
                    const m = value.split("__REGEXP ")[1].match(/\/(.*)\/(.*)?/);
                    return new RegExp(m[1], m[2] || "");
                } else
                    return value; // leave any other value as-is
            });
            if (Config.otel_trace_include_query) span?.setAttribute("query", JSON.stringify(query));
        }
        if (Util.IsNullUndefinded(query)) {
            throw new Error("Query is mandatory");
        }
        const keys: string[] = Object.keys(query);
        for (let key of keys) {
            if (key === "_id") {
                const id: string = query._id;
                const safeid = safeObjectID(id);
                if (safeid !== null && safeid !== undefined) {
                    delete query._id;
                    query.$or = [{ _id: id }, { _id: safeObjectID(id) }];
                }
            }
        }
        span?.addEvent("verityToken");
        const user: User = await Auth.Token2User(jwt, span);
        if (user == null) throw new Error("Access denied");
        if (user._id == Wellknown.guest._id && collectionname == "audit") {
            return [];
        }

        span?.addEvent("getbasequery");
        if (collectionname === "files") { collectionname = "fs.files"; }
        if (DatabaseConnection.usemetadata(collectionname)) {
            let impersonationquery;
            if (!Util.IsNullEmpty(queryas)) impersonationquery = await this.getbasequeryuserid(user, queryas, [Rights.read], collectionname, span);
            if (!Util.IsNullEmpty(queryas) && !Util.IsNullUndefinded(impersonationquery)) {
                _query = { $and: [query, this.getbasequery(user, [Rights.read], collectionname), impersonationquery] };
            } else {
                _query = { $and: [query, this.getbasequery(user, [Rights.read], collectionname)] };
            }
        } else {
            let impersonationquery: any;
            if (!Util.IsNullEmpty(queryas)) impersonationquery = await this.getbasequeryuserid(user, queryas, [Rights.read], collectionname, span)
            if (!Util.IsNullEmpty(queryas) && !Util.IsNullUndefinded(impersonationquery)) {
                _query = { $and: [query, this.getbasequery(user, [Rights.read], collectionname), impersonationquery] };
            } else {
                _query = { $and: [query, this.getbasequery(user, [Rights.read], collectionname)] };
            }
        }
        span?.setAttribute("collection", collectionname);
        span?.setAttribute("username", user.username);
        const ot_end = Logger.otel.startTimer();
        // @ts-ignore
        let result = await this.db.collection(collectionname).distinct(field, _query);
        span?.setAttribute("results", result);
        let ms = Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_count, DatabaseConnection.otel_label(collectionname, user, "count"));
        if (Config.log_database_queries && ms >= Config.log_database_queries_ms) {
            Logger.instanse.debug("distinct gave " + result.length + " results for query " + JSON.stringify(_query), span, { collection: collectionname, user: user?.username, ms, count: result, cls: "DatabaseConnection", func: "distinct" });
        } else {
            if (result.length > 0) {
                Logger.instanse.verbose("distinct gave " + result + " results ", span, { collection: collectionname, user: user?.username, ms, count: result, cls: "DatabaseConnection", func: "distinct" });
            } else {
                Logger.instanse.silly("distinct gave " + result + " results ", span, { collection: collectionname, user: user?.username, ms, count: result, cls: "DatabaseConnection", func: "distinct" });
            }
        }
        return result;
    }
    async GetLatestDocumentVersion<T extends Base>(options: GetLatestDocumentVersionOptions, span: Span): Promise<T> {
        let { collectionname, id, jwt, decrypt } = Object.assign({
            decrypt: true
        }, options);
        if (collectionname == null || collectionname == "") throw new Error("collectionname is mandatory");
        let result: T = await this.getbyid<T>(id, collectionname, jwt, true, span);
        if (result) return result;

        const basehist = await this.query<any>({ query: { id: id }, projection: { _version: 1 }, top: 1, orderby: { _version: -1 }, collectionname: collectionname + "_hist", jwt: Crypt.rootToken(), decrypt }, span);
        if (basehist.length > 0) {
            let result: T = null;
            try {
                result = await this.GetDocumentVersion({ collectionname, id, version: basehist[0]._version, jwt: Crypt.rootToken(), decrypt }, span)
                return result;
            } catch (error) {
            }
        }
        return null;
    }
    async GetDocumentVersion<T extends Base>(options: GetDocumentVersionOptions, span: Span): Promise<T> {
        let { collectionname, id, version, jwt, decrypt } = Object.assign({
            decrypt: true
        }, options);
        if (collectionname == null || collectionname == "") throw new Error("collectionname is mandatory");
        let result: T = await this.getbyid<T>(id, collectionname, jwt, false, span);
        if (Util.IsNullUndefinded(result)) {
            const subbasehist = await this.query<any>({ query: { id: id, item: { $exists: true, $ne: null } }, top: 1, orderby: { _version: -1 }, collectionname: collectionname + "_hist", decrypt: false, jwt }, span);
            if (subbasehist.length === 0) return null;
            result = subbasehist[0];
            result._version = version + 1;
        }
        if (result._version > version) {
            const rootjwt = Crypt.rootToken()
            const basehist = await this.query<any>(
                {
                    query: { id: id, item: { $exists: true, $ne: null }, "_version": { $lte: version } },
                    top: null, orderby: { _version: -1 }, collectionname: collectionname + "_hist", jwt: rootjwt,
                    decrypt: false
                }, span);
            result = basehist[0].item;
            const baseversion = basehist[0]._version;
            const history = await this.query<T>({
                query: { id: id, "_version": { $gt: baseversion, $lte: version } },
                top: Config.history_delta_count, orderby: { _version: 1 }, collectionname: collectionname + "_hist", jwt: rootjwt,
                decrypt: false
            }, span);
            for (let delta of history) {
                if (delta != null && (delta as any).delta != null) {
                    result = jsondiffpatch.patch(result, (delta as any).delta);
                }
            }
        }
        if (decrypt && !Util.IsNullUndefinded(result)) result = this.decryptentity(result);
        return result;
    }
    /**
    * Get a single item based on id
    * @param  {string} id Id to search for
    * @param  {string} collectionname Collection to search
    * @param  {string} jwt JWT of user who is making the query, to limit results based on permissions
    * @returns Promise<T>
    */
    async GetOne<T extends Base>(options: { query?: object, collectionname: string, orderby?: object, jwt?: string, decrypt?: boolean }, span: Span): Promise<T> {
        if (Util.IsNullUndefinded(options.jwt)) options.jwt = Crypt.rootToken();
        if (Util.IsNullUndefinded(options.decrypt)) options.decrypt = true;
        if (Util.IsNullUndefinded(options.query)) options.query = {};
        const { query, collectionname, orderby, jwt, decrypt } = options;
        if (collectionname == null || collectionname == "") throw new Error("collectionname is mandatory");
        const arr: T[] = await this.query<T>({ query, collectionname, orderby, jwt, decrypt }, span);
        if (arr === null || arr.length === 0) { return null; }
        return arr[0];
    }
    /**
     * Get a single item based on id
     * @param  {string} id Id to search for
     * @param  {string} collectionname Collection to search
     * @param  {string} jwt JWT of user who is making the query, to limit results based on permissions
     * @returns Promise<T>
     */
    async getbyid<T extends Base>(id: string, collectionname: string, jwt: string, decrypt: boolean, span: Span): Promise<T> {
        if (id === null || id === undefined || id === "") { throw new Error("Id cannot be null"); }
        if (collectionname == null || collectionname == "") throw new Error("collectionname is mandatory");
        const query = { _id: id };
        return this.GetOne({ query, collectionname, jwt, decrypt }, span)
    }
    /**
     * Get a single item based on username
     * @param  {string} username Username to search for
     * @param  {string} collectionname Collection to search
     * @param  {string} jwt JWT of user who is making the query, to limit results based on permissions
     * @returns Promise<T>
     */
    async getbyusername<T extends Base>(username: string, issuer: string, jwt: string, decrypt: boolean, span: Span): Promise<T> {
        if (username === null || username === undefined || username === "") { throw new Error("Name cannot be null"); }
        const byemail = { email: username };
        const byuser = { username: username };
        const byid = { $or: [{ "federationids.id": username, "federationids.issuer": issuer }, { "federationids": username }] };
        let query: any = { $or: [byuser, byid, byemail] };
        if (Util.IsNullEmpty(issuer)) {
            query = { $or: [byuser, byemail] };
        }
        query._type = "user";
        const arr: T[] = await this.query<T>({ query: query, top: 1, collectionname: "users", jwt, decrypt }, span);
        if (arr === null || arr.length === 0) { return null; }
        return arr[0];
    }
    /**
     * Do MongoDB aggregation
     * @param  {any} aggregates
     * @param  {string} collectionname
     * @param  {string} jwt
     * @returns Promise
     */
    async aggregate<T extends Base>(aggregates: object[], collectionname: string, jwt: string, hint: Object | string, queryas: string, explain: boolean, parent: Span): Promise<T[]> {
        if (collectionname == null || collectionname == "") throw new Error("collectionname is mandatory");
        const span: Span = Logger.otel.startSubSpan("db.Aggregate", parent);
        await this.connect(span);
        let json: any = aggregates;
        if (typeof json !== "string" && !(json instanceof String)) {
            json = JSON.stringify(json, (key, value) => {
                if (value instanceof RegExp)
                    return ("__REGEXP " + value.toString());
                else
                    return value;
            });
        }
        if (collectionname == "files") collectionname = "fs.files";
        let myhint: Object = {};
        if (hint) {
            if (typeof hint === "string" || hint instanceof String) {
                let newhint = null;
                try {
                    if (hint.indexOf("{") > -1) {
                        newhint = JSON.parse((hint as string));
                        myhint = newhint;
                    }
                } catch (error) {
                    Logger.instanse.error(error, span, { collection: collectionname, cls: "DatabaseConnection", func: "aggregate" });
                }
                if (Util.IsNullUndefinded(newhint)) myhint[(hint as string)] = 1;
            } else {
                myhint = hint;
            }
            span?.setAttribute("hint", JSON.stringify(myhint));
        }
        aggregates = JSON.parse(json, (key, value) => {
            if (typeof value === "string" && value.match(isoDatePattern)) {
                return new Date(value); // isostring, so cast to js date
            } else if (value != null && value != undefined && value.toString().indexOf("__REGEXP ") === 0) {
                const m = value.split("__REGEXP ")[1].match(/\/(.*)\/(.*)?/);
                return new RegExp(m[1], m[2] || "");
            } else
                return value; // leave any other value as-is
        });
        const user: User = await Auth.Token2User(jwt, span);
        if (user == null) throw new Error("Access denied");
        if (user._id == Wellknown.guest._id && collectionname == "audit") {
            return [];
        }
        if (Config.otel_trace_include_query) span?.setAttribute("aggregates", JSON.stringify(aggregates));
        span?.setAttribute("collection", collectionname);
        span?.setAttribute("username", user.username);
        const aggregatesjson = JSON.stringify(aggregates)
        span?.addEvent("getbasequery");
        let base: object;

        if (DatabaseConnection.usemetadata(collectionname)) {
            let impersonationquery;
            if (!Util.IsNullEmpty(queryas)) impersonationquery = await this.getbasequeryuserid(user, queryas, [Rights.read], collectionname, span);
            if (!Util.IsNullEmpty(queryas) && !Util.IsNullUndefinded(impersonationquery)) {
                base = { $and: [this.getbasequery(user, [Rights.read], collectionname), impersonationquery] };
            } else {
                base = this.getbasequery(user, [Rights.read], collectionname);
            }
        } else {
            let impersonationquery: any;
            if (!Util.IsNullEmpty(queryas)) impersonationquery = await this.getbasequeryuserid(user, queryas, [Rights.read], collectionname, span)
            if (!Util.IsNullEmpty(queryas) && !Util.IsNullUndefinded(impersonationquery)) {
                base = { $and: [this.getbasequery(user, [Rights.read], collectionname), impersonationquery] };
            } else {
                base = this.getbasequery(user, [Rights.read], collectionname);
            }
        }
        if (Array.isArray(aggregates)) {
            aggregates.unshift({ $match: base });
        } else {
            aggregates = [{ $match: base }, aggregates];
        }
        if (json.toLowerCase().indexOf("$limit") == -1) {
            aggregates.push({ "$limit": 500 });
        }
        const options: AggregateOptions = {};
        if (explain === true) {
            // @ts-ignore
            options.explain = explain;
        }
        options.hint = myhint;
        try {
            const ot_end = Logger.otel.startTimer();
            const cursor = this.db.collection(collectionname).aggregate(aggregates, options);

            let items: T[] = [];
            let ms = 0;
            try {
                let size = 0;
                for await (const c of cursor) {
                    size += getObjectSize(c);
                    if (Config.max_memory_aggregate_mb > 0 && size > (Config.max_memory_aggregate_mb * 1024 * 1024)) {
                        Logger.instanse.error("Aggregate size exceeded " + Config.max_memory_aggregate_mb + " mb (" + formatBytes(size) + " with " + items.length + " items)", span, { collection: collectionname, user: user?.username, count: items.length, cls: "DatabaseConnection", func: "aggregate" });
                        throw new Error("Aggregate size exceeded " + Config.max_memory_aggregate_mb + " mb (" + formatBytes(size) + " with " + items.length + " items)");
                    }
                    items.push(c as any);
                }
                if (size > 0) {
                    Logger.instanse.debug("Aggregate gave " + items.length + " results using " + formatBytes(size) + " memory", span, { collection: collectionname, user: user?.username, count: items.length, cls: "DatabaseConnection", func: "aggregate" });
                }
            } finally {
                ms = Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_aggregate, DatabaseConnection.otel_label(collectionname, user, "aggregate"));
                cursor.close();
            }

            span?.setAttribute("results", items.length);
            DatabaseConnection.traversejsondecode(items);
            if (Config.log_database_queries && ms >= Config.log_database_queries_ms) {
                Logger.instanse.debug(aggregatesjson, span, { collection: collectionname, user: user?.username, ms, count: items.length, cls: "DatabaseConnection", func: "aggregate" });
            } else {
                if (items.length > 0) {
                    Logger.instanse.verbose(items.length + " results ", span, { collection: collectionname, user: user?.username, ms, count: items.length, cls: "DatabaseConnection", func: "aggregate" });
                } else {
                    Logger.instanse.silly(items.length + " results ", span, { collection: collectionname, user: user?.username, ms, count: items.length, cls: "DatabaseConnection", func: "aggregate" });
                }
            }
            return items;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    /**
     * Do MongoDB watch
     * @param  {any} aggregates
     * @param  {string} collectionname
     * @param  {string} jwt
     * @returns Promise
     */
    async watch<T extends Base>(aggregates: object[], collectionname: string, jwt: string): Promise<ChangeStream> {
        await this.connect();
        if (collectionname == null || collectionname == "") throw new Error("collectionname is mandatory");

        let json: any = aggregates;
        if (typeof json !== "string" && !(json instanceof String)) {
            json = JSON.stringify(json, (key, value) => {
                if (value instanceof RegExp)
                    return ("__REGEXP " + value.toString());
                else
                    return value;
            });
        }

        if (!Util.IsNullEmpty(json)) {
            aggregates = JSON.parse(json, (key, value) => {
                if (typeof value === "string" && value.match(isoDatePattern)) {
                    return new Date(value); // isostring, so cast to js date
                } else if (value != null && value != undefined && value.toString().indexOf("__REGEXP ") === 0) {
                    const m = value.split("__REGEXP ")[1].match(/\/(.*)\/(.*)?/);
                    return new RegExp(m[1], m[2] || "");
                } else
                    return value; // leave any other value as-is
            });
        } else { aggregates = null; }

        const user: User = await Auth.Token2User(jwt, null);
        if (user == null) throw new Error("Access denied");
        // TODO: Should we filter on rights other than read ? should a person with reade be allowed to know when it was updated ?
        // a person with read, would beablt to know anyway, so guess read should be enough for now ... 
        const base = this.getbasequery(user, [Rights.read], "fullDocument._acl");
        if (Array.isArray(aggregates)) {
            aggregates.unshift({ $match: base });
        } else {
            if (Util.IsNullUndefinded(aggregates)) {
                aggregates = [{ $match: base }];
            } else {
                aggregates = [{ $match: base }, aggregates];
            }
        }
        return await this.db.collection(collectionname).watch(aggregates, { fullDocument: "updateLookup" });
    }
    /**
     * Create a new document in the database
     * @param  {T} item Item to create
     * @param  {string} collectionname The collection to create item in
     * @param  {number} w Write Concern ( 0:no acknowledgment, 1:Requests acknowledgment, 2: Requests acknowledgment from 2, 3:Requests acknowledgment from 3)
     * @param  {boolean} j Ensure is written to the on-disk journal.
     * @param  {string} jwt JWT of the user, creating the item, to ensure rights and permission
     * @returns Promise<T> Returns the new item added
     */
    async InsertOne<T extends Base>(item: T, collectionname: string, w: number, j: boolean, jwt: string, parent: Span): Promise<T> {
        const span: Span = Logger.otel.startSubSpan("db.InsertOne", parent);
        let customer: Customer = null;
        try {
            if (item === null || item === undefined) { throw new Error("Cannot create null item"); }
            if (collectionname == null || collectionname == "") throw new Error("collectionname is mandatory");
            if (Util.IsNullEmpty(jwt)) throw new Error("jwt is null");
            await this.connect(span);
            span?.addEvent("verityToken");
            const user: User = await Auth.Token2User(jwt, span);
            if (user == null) throw new Error("Access denied");
            if (user.dblocked && !user.HasRoleName(Wellknown.admins.name)) throw new Error("Access denied (db locked) could be due to hitting quota limit for " + user.username);
            span?.addEvent("traversejsonencode");
            DatabaseConnection.traversejsonencode(item);
            let name = item.name;
            if (Util.IsNullEmpty(name)) name = item._name;
            if (Util.IsNullEmpty(name)) name = "Unknown";
            if (!DatabaseConnection.usemetadata(collectionname) && !DatabaseConnection.istimeseries(collectionname)) {
                item._version = 0;
                item._createdby = user.name;
                item._createdbyid = user._id;
                item._created = new Date(new Date().toISOString());
                item._modifiedby = user.name;
                item._modifiedbyid = user._id;
                item._modified = item._created;
                if (item._id == "") delete item._id;
                if (collectionname == "audit") {
                    delete item._modifiedby;
                    delete item._modifiedbyid;
                    delete item._modified;
                }
                span?.addEvent("ensureResource");
                item = this.ensureResource(item, collectionname);
                if (user._id != Wellknown.root._id && !await this.CheckEntityRestriction(user, collectionname, item, span)) {
                    throw new Error("Create " + item._type + " access denied");
                }
                if (!DatabaseConnection.hasAuthorization(user, item, Rights.full_control)) {
                    Base.addRight(item, user._id, user.name, [Rights.full_control]);
                    item = this.ensureResource(item, collectionname);
                }
            } else if (DatabaseConnection.istimeseries(collectionname) && !DatabaseConnection.usemetadata(collectionname)) {
                if (Util.IsNullEmpty(item[DatabaseConnection.timefield(collectionname)])) {
                    item[DatabaseConnection.timefield(collectionname)] = new Date(new Date().toISOString());
                }
                if (collectionname == "audit") {
                    item._createdby = user.name;
                    item._createdbyid = user._id;
                }
                span?.addEvent("ensureResource");
                // @ts-ignore
                item = this.ensureResource(item, collectionname);
                if (user._id != Wellknown.root._id && !await this.CheckEntityRestriction(user, collectionname, item, span)) {
                    // @ts-ignore
                    throw new Error("Create " + item._type + " access denied");
                }
                if (!DatabaseConnection.hasAuthorization(user, item, Rights.full_control)) {
                    Base.addRight(item, user._id, user.name, [Rights.full_control]);
                    item = this.ensureResource(item, collectionname);
                }
            } else {
                if (Util.IsNullEmpty(item[DatabaseConnection.timefield(collectionname)])) {
                    item[DatabaseConnection.timefield(collectionname)] = new Date(new Date().toISOString());
                }
                let metadata = DatabaseConnection.metadataname(collectionname);
                if (Util.IsNullUndefinded(item[metadata])) item[metadata] = {};
                span?.addEvent("ensureResource");
                item[metadata] = this.ensureResource(item[metadata], collectionname);
                if (item.hasOwnProperty("name")) {
                    // @ts-ignore
                    item[metadata].name = item.name;
                }
                if (item.hasOwnProperty("_type")) {
                    // @ts-ignore
                    item[metadata]._type = item._type;
                }
                if (item.hasOwnProperty("_acl")) {
                    // @ts-ignore
                    item[metadata]._acl = item._acl;
                    delete item._acl;
                }
                if (collectionname == "audit") {
                    // @ts-ignore
                    item[metadata].userid = item.userid;
                    // @ts-ignore
                    item[metadata].username = item.username;
                    // @ts-ignore
                    delete item.userid;
                    // @ts-ignore
                    delete item.username;
                }
                if (item._id == "") delete item._id;
                if (user._id != Wellknown.root._id && !await this.CheckEntityRestriction(user, collectionname, item[metadata], span)) {
                    // @ts-ignore
                    throw new Error("Create " + item[metadata]._type + " access denied");
                }
                item[metadata]._version = 0;
                item[metadata]._createdby = user.name;
                item[metadata]._createdbyid = user._id;
                if (!DatabaseConnection.hasAuthorization(user, item[metadata], Rights.create)) {
                    Base.addRight(item[metadata], user._id, user.name, [Rights.full_control]);
                    item[metadata] = this.ensureResource(item[metadata], collectionname);
                }

            }
            Logger.instanse.silly("Adding " + item._type + " " + name + " to database", span, { collection: collectionname, user: user.username, cls: "DatabaseConnection", func: "InsertOne" });
            if (!DatabaseConnection.hasAuthorization(user, item, Rights.create)) { throw new Error("Access denied, no authorization to InsertOne " + item._type + " " + name + " to database"); }

            span?.addEvent("encryptentity");
            item = this.encryptentity(item) as T;

            if (collectionname === "users" && item._type === "user" && item.hasOwnProperty("newpassword")) {
                if ((item as any).newpassword != "") {
                    (item as any).passwordhash = await Crypt.hash((item as any).newpassword);
                }
                delete (item as any).newpassword;
            }
            if (collectionname == "mq") {
                if (item._type == "exchange") item.name = item.name.toLowerCase();
                if (item._type == "queue") item.name = item.name.toLowerCase();
            }
            var wi: Workitem = item as any;
            // @ts-ignore
            if (collectionname == "workitems" && item._type == "workitem") await Logger.DBHelper.WorkitemQueueUpdate(item.wiqid, false, span);
            // @ts-ignore
            if (collectionname == "workitems" && Util.IsNullEmpty(item.state)) item.state = "new";
            if (collectionname == "workitems" && item._type == "workitem") {
                wi.state = "new";
                if (Util.IsNullEmpty(wi.wiq) && Util.IsNullEmpty(wi.wiqid)) {
                    throw new Error("Workitemqueue (wiq or wiqid) is required");
                }
                if (Util.IsNullEmpty(wi.wiq)) {
                    var wiq = await this.GetOne({ collectionname: "mq", query: { _id: wi.wiqid, _type: "workitemqueue" }, jwt }, span);
                    if (Util.IsNullEmpty(wiq)) {
                        throw new Error("Workitemqueue " + wi.wiqid + " not found");
                    }
                    wi.wiq = wiq.name;
                    wi._acl = wiq._acl;
                } else {
                    var wiq = await this.GetOne({ collectionname: "mq", query: { name: wi.wiq, _type: "workitemqueue" }, jwt }, span);
                    if (Util.IsNullEmpty(wiq)) {
                        throw new Error("Workitemqueue " + wi.wiq + " not found");
                    }
                    wi.wiqid = wiq._id;
                    wi._acl = wiq._acl;
                }
                if (Util.IsNullEmpty(wi.nextrun)) {
                    wi.nextrun = new Date(new Date().toISOString());
                }
            }
            if (collectionname === "agents") {
                // @ts-ignore
                var runas = item.runas;
                // @ts-ignore
                var runasname = item.runasname;
                if (!Util.IsNullEmpty(runas) && runas != user._id) {
                    if (!user.HasRoleName(Wellknown.customer_admins.name) && !user.HasRoleName(Wellknown.admins.name)) {
                        throw new Error("Access denied");
                    }
                }
                if (!Util.IsNullEmpty(runas)) {
                    let runasuser = await this.getbyid<User>(runas, "users", jwt, true, span);
                    runasuser = await Logger.DBHelper.DecorateWithRoles(runasuser as any, parent);

                    if (!DatabaseConnection.hasAuthorization(runasuser as any, item, Rights.update)) {
                        if (Util.IsNullEmpty(runasuser.customerid)) {
                            Base.addRight(item, runas, runasname, [Rights.read, Rights.update, Rights.invoke]);
                        } else {
                            customer = await this.getbyid<Customer>(runasuser.customerid, "users", jwt, true, span);
                            if (customer != null) {
                                Base.addRight(item, customer.users, customer.name + " users", [Rights.read, Rights.update, Rights.invoke]);
                                Base.addRight(item, customer.admins, customer.name + " admins", [Rights.full_control]);
                            } else {
                                Base.addRight(item, runas, runasname, [Rights.read, Rights.update, Rights.invoke]);
                            }
                        }

                    }
                }

                // @ts-ignore
                var fileid = item.fileid;
                if (item._type == "package" && fileid != "" && fileid != null) {
                    var f = await this.getbyid<any>(fileid, "fs.files", jwt, true, span);
                    if (f == null) throw new Error("File " + fileid + " not found");
                }
                if (item._type == "agent") {
                    // @ts-ignore
                    if (item.autostart == true && Util.IsNullEmpty(item.stripeprice)) {
                        if (!user.HasRoleName(Wellknown.admins.name)) {
                            throw new Error("Access denied");
                        }
                    }
                    if (Util.IsNullEmpty((item as any).customerid)) {
                        if (!Util.IsNullEmpty(user.selectedcustomerid)) {
                            customer = await this.getbyid<Customer>(user.selectedcustomerid, "users", jwt, true, span)
                            if (customer != null) {
                                (item as any).customerid = user.selectedcustomerid;
                            }
                        }
                        if (Util.IsNullEmpty((item as any).customerid)) {
                            (item as any).customerid = user.customerid;
                        }
                    }
                    var agent: iAgent = (item as any);
                    if (Util.IsNullEmpty(agent.slug)) {
                        throw new Error("Slug is required for agents");
                    }
                    agent.slug = agent.slug.toLowerCase();
                    if (Util.IsNullEmpty(agent.runas)) {
                        agent.runas = user._id
                    }
                }
            }
            if (collectionname === "users" && (item._type === "user" || item._type === "role")) {
                let user2: User = item as any;
                if (item._type === "user" && !Util.IsNullEmpty(user2.username)) {
                    user2.username = user2.username.toLowerCase();
                }
                if (item._type === "user" && Util.IsNullEmpty(user2.username)) {
                    throw new Error("Username is mandatory for users")
                }

                if (Util.IsNullEmpty(user2.customerid)) {
                    if (!Util.IsNullEmpty(user.selectedcustomerid)) {
                        customer = await this.getbyid<Customer>(user.selectedcustomerid, "users", jwt, true, span)
                        if (customer != null) {
                            user2.customerid = user.selectedcustomerid;
                        }
                    }
                    if (Util.IsNullEmpty(user2.customerid) && !Util.IsNullEmpty(user.customerid)) {
                        user2.customerid = user.customerid;
                    }
                }
                if (DatabaseConnection.WellknownIdsArray.indexOf(user2._id) > -1) {
                    delete user2.customerid;
                }

                if (!Util.IsNullEmpty(user2.customerid)) {
                    customer = await this.getbyid<Customer>(user2.customerid, "users", jwt, true, span)
                    if (user2._type == "user") {
                        if (!user.HasRoleName(Wellknown.customer_admins.name) && !user.HasRoleName(Wellknown.admins.name)) {
                            if (customer != null) {
                                var isadmin = user.roles.filter(x => x._id == customer.admins);
                                if (isadmin.length == 0) throw new Error("Access denied (not admin) to customer with id " + user2.customerid);
                            } else {
                                throw new Error("Access denied failed locating customerid  " + user2.customerid);
                            }
                        }
                    }

                    if (customer == null) throw new Error("Access denied to customer with id " + user2.customerid + " when updating " + user2._id);
                } else if (user.HasRoleName(Wellknown.customer_admins.name) && !Util.IsNullEmpty(user.customerid)) {
                    if (Util.IsNullEmpty(user2.selectedcustomerid)) {
                        if (!Util.IsNullEmpty(user.selectedcustomerid)) user2.customerid = user.selectedcustomerid;
                        if (Util.IsNullEmpty(user2.customerid) && !Util.IsNullEmpty(user.customerid)) user2.customerid = user.customerid;
                    }
                    if (Util.IsNullEmpty(user2.customerid)) throw new Error("Access denied, no customerid on you, and no customer selected");
                    customer = await this.getbyid<Customer>(user2.customerid, "users", jwt, true, span);
                } else if (Config.multi_tenant && !user.HasRoleName(Wellknown.admins.name)) {
                    if (!Util.IsNullEmpty(user.selectedcustomerid)) user2.customerid = user.selectedcustomerid;
                    if (!Util.IsNullEmpty(user2.customerid)) {
                        customer = await this.getbyid<Customer>(user2.customerid, "users", jwt, true, span);
                    }
                    // User needs access to create roles for workflow node and more ... What to do ?
                    // throw new Error("Access denied (not admin or customer admin)");
                }
                if (customer != null) {
                    // When restoring deleted items, we need to handle that admins might not exists
                    const custadmins = await this.getbyid<Role>(customer.admins, "users", jwt, true, span);
                    if (custadmins != null) {
                        Base.addRight(item, custadmins._id, custadmins.name, [Rights.full_control]);
                    } else {
                        Base.addRight(item, customer.admins, customer.name + " admins", [Rights.full_control]);
                    }
                    if (item._id == customer.admins || item._id == customer.users) {
                        Base.removeRight(item, customer.admins, [Rights.delete]);
                    }
                    (item as any).company = customer.name;
                    item = this.ensureResource(item, collectionname);
                }
            }
            j = ((j as any) === "true" || j === true);
            w = parseInt((w as any));
            if (item._id != null) {
                const basehist = await this.query<any>({ query: { id: item._id }, projection: { _version: 1 }, top: 1, orderby: { _version: -1 }, collectionname: collectionname + "_hist", jwt: Crypt.rootToken() }, span);
                if (basehist.length > 0) {
                    item._version = basehist[0]._version;
                }
                if (basehist.length > 0) {
                    let org: any = null;
                    try {
                        org = await this.GetDocumentVersion({ collectionname, id: item._id, version: item._version, jwt: Crypt.rootToken() }, span)
                    } catch (error) {

                    }
                    if (org != null) {
                        item._createdby = org._createdby;
                        item._createdbyid = org._createdbyid;
                        item._created = org._created;
                        item._modifiedby = org._modifiedby;
                        item._modifiedbyid = org._modifiedbyid;
                        item._modified = org._modified;
                        if (!item._created) item._created = new Date(new Date().toISOString());
                        if (!item._createdby) item._createdby = user.name;
                        if (!item._createdbyid) item._createdbyid = user._id;
                        if (!item._modified) item._modified = new Date(new Date().toISOString());
                        if (!item._modifiedby) item._modifiedby = user.name;
                        if (!item._modifiedbyid) item._modifiedbyid = user._id;
                        if (!item._version) item._version = 0;
                        if (collectionname == "audit") {
                            delete item._modifiedby;
                            delete item._modifiedbyid;
                            delete item._modified;
                        }
                    } else {
                        item._version++;
                    }
                }
            } else {
                item._id = new ObjectId().toHexString();
            }
            if (!DatabaseConnection.usemetadata(collectionname)) {
                span?.addEvent("CleanACL");
                item = await this.CleanACL(item, user, collectionname, span);
            } else {
                span?.addEvent("CleanACL");
                let metadata = DatabaseConnection.metadataname(collectionname);
                item[metadata] = await this.CleanACL(item[metadata], user, collectionname, span);
            }
            if (collectionname === "users" && item._type === "user" && !Util.IsNullEmpty(item._id)) {
                Base.addRight(item, item._id, item.name, [Rights.full_control]);
                Base.removeRight(item, item._id, [Rights.delete]);
                span?.addEvent("ensureResource");
                item = this.ensureResource(item, collectionname);
            }
            if (item._type === "role" && collectionname === "users") {
                item = await this.Cleanmembers(item as any, null, false, span);
            }

            if (collectionname === "users" && item._type === "user") {
                const u: TokenUser = (item as any);
                if (Util.IsNullEmpty(u.validated)) u.validated = false;
                if (Util.IsNullEmpty(u.formvalidated)) u.formvalidated = false;
                if (Util.IsNullEmpty(u.emailvalidated)) u.emailvalidated = false;
                if (Util.IsNullEmpty(u.username)) { throw new Error("Username is mandatory"); }
                if (Util.IsNullEmpty(u.name)) { throw new Error("Name is mandatory"); }
                span?.addEvent("FindByUsername");
                await Logger.DBHelper.CheckCache(collectionname, item, false, false, span);
                const exists = await Logger.DBHelper.FindByUsername(u.username, null, span);
                if (exists != null) { throw new Error("Access denied, user '" + u.username + "' already exists"); }
            }
            if (collectionname === "users" && item._type === "role") {
                const r: Role = (item as any);
                if (Util.IsNullEmpty(r.name)) { throw new Error("Name is mandatory"); }
                span?.addEvent("FindRoleByName");
                await Logger.DBHelper.CheckCache(collectionname, item, false, false, span);
                const exists2 = await Logger.DBHelper.FindRoleByName(r.name, null, span);
                if (exists2 != null) { throw new Error("Access denied, role '" + r.name + "' already exists"); }
            }
            span?.setAttribute("collection", collectionname);
            span?.setAttribute("username", user.username);
            let options: InsertOneOptions = { writeConcern: { w, j } };
            (options as any).WriteConcern = { w, j };
            if (Util.IsNullEmpty(this.replicat)) options = null;

            span?.addEvent("do insert");
            const ot_end = Logger.otel.startTimer();
            // @ts-ignore
            const result: InsertOneResult<T> = await this.db.collection(collectionname).insertOne(item, options);
            let timestr = Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_insert, DatabaseConnection.otel_label(collectionname, user, "insert"));

            // @ts-ignore
            item._id = result.insertedId;
            if (collectionname === "mq" && item._type === "exchange") {
                await amqpwrapper.Instance().PreRegisterExchange(item, span);
            }
            if (collectionname === "users" && item._type === "user") {
                Base.addRight(item, item._id, item.name, [Rights.read, Rights.update, Rights.invoke]);
                let user2: User = User.assign(item as any);
                if (Config.validate_emails && user2.emailvalidated || !Config.validate_emails) {
                    let domain: string = user2.username;
                    if (!Util.IsNullEmpty(user2.email)) domain = user2.email;
                    if (domain.indexOf("@") > -1) {
                        var userupdate: any = { "$set": {}, "$push": {} };
                        domain = domain.substring(domain.indexOf("@") + 1).toLowerCase();
                        var customers = await this.query<Customer>({ query: { _type: "customer", domains: { $in: [domain] } }, collectionname: "users", jwt: jwt }, span);
                        var doupdate: boolean = false;
                        for (var i = 0; i < customers.length; i++) {
                            if (Util.IsNullEmpty(user2.customerid)) {
                                user2.customerid = customers[i]._id;
                                userupdate["$set"]["customerid"] = user2.customerid;
                                doupdate = true;
                            }
                            // @ts-ignore
                            if (Util.IsNullEmpty(user2.company)) {
                                // @ts-ignore
                                user2.company = customers[i].name;
                                userupdate["$set"]["company"] = customers[i].name;
                                doupdate = true;
                            }
                            if (!user2.HasRoleId(customers[i].users)) {
                                user2.roles.push(new Rolemember(customers[i].name + " users", customers[i].users));
                                var ace: Ace = new Ace();
                                ace._id = customers[i].users; ace.name = customers[i].name + " users";
                                Ace.resetnone(ace); Ace.setBit(ace, Rights.read);
                                if (!userupdate["$push"]["_acl"]) {
                                    userupdate["$push"]["_acl"] = { "$each": [] };
                                }
                                userupdate["$push"]["_acl"]["$each"].push(ace);
                                var ace: Ace = new Ace();
                                ace._id = customers[i].admins; ace.name = customers[i].name + " admins";
                                Ace.resetfullcontrol(ace);
                                userupdate["$push"]["_acl"]["$each"].push(ace);
                                await this.db.collection("users").updateOne(
                                    { _id: customers[i].users },
                                    { "$push": { members: new Rolemember(item.name, item._id) } }
                                );
                                doupdate = true;
                            }
                            await Logger.DBHelper.CheckCache("users", customers[i], false, false, span);
                        }
                        if (doupdate) {
                            await this.db.collection("users").updateOne(
                                { _id: item._id },
                                userupdate
                            );
                            await Logger.DBHelper.CheckCache("users", user2, false, false, span);
                        }
                    }
                }

                if (!Util.IsNullUndefinded(customer) && !Util.IsNullEmpty(customer.users)) {
                    await this.db.collection("users").updateOne(
                        { _id: customer.users },
                        { "$push": { members: new Rolemember(item.name, item._id) } }
                    );
                    await Logger.DBHelper.UserRoleUpdateId(customer.users, false, span);
                }
                await Logger.DBHelper.UserRoleUpdateId(Wellknown.users._id, false, span);
            }
            if (collectionname === "users" && item._type === "role") {
                Base.addRight(item, item._id, item.name, [Rights.read]);
                item = await this.CleanACL(item, user, collectionname, span);
                const ot_end = Logger.otel.startTimer();
                await this.db.collection(collectionname).replaceOne({ _id: item._id }, item);
                Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_replace, DatabaseConnection.otel_label(collectionname, user, "replace"));
            }
            await Logger.DBHelper.CheckCache(collectionname, item, false, false, span);
            if (collectionname === "config" && item._type === "oauthclient") {
                if (user.HasRoleName(Wellknown.admins.name)) {
                    setTimeout(() => OAuthProvider.LoadClients(span), 1000);
                }
            }
            if (collectionname === "config" && item._type === "provider") {
                await LoginProvider.RegisterProviders(WebServer.app, Config.baseurl(), span);
            }
            span?.addEvent("traversejsondecode");
            DatabaseConnection.traversejsondecode(item);
            Logger.instanse.debug("inserted " + item.name, span, { collection: collectionname, user: user.username, cls: "DatabaseConnection", func: "InsertOne" });
            let collections = await Logger.DBHelper.GetCollections(span);
            if (collections.find(x => x.name == collectionname) == null) {
                await Logger.DBHelper.ClearGetCollections()
            }
        } finally {
            Logger.otel.endSpan(span);
        }
        return item;
    }
    async InsertMany<T extends Base>(items: T[], collectionname: string, w: number, j: boolean, jwt: string, parent: Span): Promise<T[]> {
        const span: Span = Logger.otel.startSubSpan("db.InsertMany", parent);
        let result: T[] = [];
        try {
            if (collectionname == null || collectionname == "") throw new Error("collectionname is mandatory");
            if (Util.IsNullUndefinded(items) || items.length == 0) { throw new Error("Cannot create null item"); }
            if (Util.IsNullEmpty(jwt)) {
                throw new Error("jwt is null");
            }
            await this.connect(span);
            const user = await Auth.Token2User(jwt, span);
            if (user == null) throw new Error("Access denied");
            if (user.dblocked && !user.HasRoleName(Wellknown.admins.name)) throw new Error("Access denied (db locked) could be due to hitting quota limit for " + user.username);
            span?.setAttribute("collection", collectionname);
            span?.setAttribute("username", user.username);
            let bulkInsert = this.db.collection(collectionname).initializeUnorderedBulkOp();
            let x = 1000
            let counter = 0
            let date = new Date()
            date.setMonth(date.getMonth() - 1);
            let tempresult: any[] = [];
            let hadWorkitemQueue = false;
            let wiqids = [];
            for (let i = 0; i < items.length; i++) {
                let item = items[i];
                DatabaseConnection.traversejsonencode(item);

                if (!await this.CheckEntityRestriction(user, collectionname, item, span)) {
                    throw new Error("Access denied addig " + item._type + " into " + collectionname);
                    continue;
                }
                let name = item.name;
                if (Util.IsNullEmpty(name)) name = item._name;
                if (Util.IsNullEmpty(name)) name = "Unknown";
                if (!DatabaseConnection.usemetadata(collectionname) && !DatabaseConnection.istimeseries(collectionname)) {
                    item._version = 0;
                    item._createdby = user.name;
                    item._createdbyid = user._id;
                    item._created = new Date(new Date().toISOString());
                    item._modifiedby = user.name;
                    item._modifiedbyid = user._id;
                    item._modified = item._created;
                    if (!DatabaseConnection.hasAuthorization(user, item, Rights.full_control)) {
                        Base.addRight(item, user._id, user.name, [Rights.full_control]);
                    }
                    item = this.ensureResource(item, collectionname);
                } else if (DatabaseConnection.istimeseries(collectionname)) {
                    if (Util.IsNullEmpty(item[DatabaseConnection.timefield(collectionname)])) {
                        item[DatabaseConnection.timefield(collectionname)] = new Date(new Date().toISOString());
                    }
                    if (DatabaseConnection.usemetadata(collectionname)) {
                        if (!DatabaseConnection.hasAuthorization(user, item, Rights.full_control)) {
                            Base.addRight(item, user._id, user.name, [Rights.full_control]);
                            item = this.ensureResource(item, collectionname);
                        }
                    }
                } else { // fs.files ?
                    if (Util.IsNullEmpty(item[DatabaseConnection.timefield(collectionname)])) {
                        item[DatabaseConnection.timefield(collectionname)] = new Date(new Date().toISOString());
                    }
                    let metadata = DatabaseConnection.metadataname(collectionname);
                    if (Util.IsNullUndefinded(item[metadata])) item[metadata] = {};
                    span?.addEvent("ensureResource");
                    item[metadata] = this.ensureResource(item[metadata], collectionname);
                    item[metadata]._version = 0;
                    item[metadata]._createdby = user.name;
                    item[metadata]._createdbyid = user._id;
                    if (!DatabaseConnection.hasAuthorization(user, item[metadata], Rights.create)) {
                        Base.addRight(item[metadata], user._id, user.name, [Rights.full_control]);
                        item[metadata] = this.ensureResource(item[metadata], collectionname);
                    }
                }

                if (item._id == "") delete item._id;
                item = this.encryptentity(item) as T;
                var user2: User = item as any;

                if (collectionname === "agents") {
                    // @ts-ignore
                    if (!Util.IsNullEmpty(item.runas) && item.runas != user._id) {
                        if (!user.HasRoleName(Wellknown.customer_admins.name) && !user.HasRoleName(Wellknown.admins.name)) {
                            throw new Error("Access denied");
                        }
                    }

                    // @ts-ignore
                    var fileid = item.fileid;
                    if (item._type == "package" && fileid != "" && fileid != null) {
                        var f = await this.getbyid<any>(fileid, "fs.files", jwt, true, span);
                        if (f == null) throw new Error("File " + fileid + " not found");
                    }

                    if (item._type == "agent") {
                        // @ts-ignore
                        var runas = item.runas;
                        // @ts-ignore
                        var runasname = item.runasname;
                        if (!Util.IsNullEmpty(runas)) {
                            let runasuser = await this.getbyid<User>(runas, "users", jwt, true, span);
                            runasuser = await Logger.DBHelper.DecorateWithRoles(runasuser as any, parent);
                            if (!DatabaseConnection.hasAuthorization(runasuser as any, item, Rights.update)) {
                                if (Util.IsNullEmpty(runasuser.customerid)) {
                                    Base.addRight(item, runas, runasname, [Rights.read, Rights.update, Rights.invoke]);
                                } else {
                                    customer = await this.getbyid<Customer>(runasuser.customerid, "users", jwt, true, span);
                                    if (customer != null) {
                                        Base.addRight(item, customer.users, customer.name + " users", [Rights.read, Rights.update, Rights.invoke]);
                                        Base.addRight(item, customer.admins, customer.name + " admins", [Rights.full_control]);
                                    } else {
                                        Base.addRight(item, runas, runasname, [Rights.read, Rights.update, Rights.invoke]);
                                    }
                                }

                            }
                        }

                        // @ts-ignore
                        if (item.autostart == true && Util.IsNullEmpty(item.stripeprice)) {
                            if (!user.HasRoleName(Wellknown.admins.name)) {
                                throw new Error("Access denied");
                            }
                        }
                        // @ts-ignore
                        if (Util.IsNullEmpty(item.slug)) {
                            throw new Error("Slug is required for agents");
                        }
                        // @ts-ignore
                        item.slug = item.slug.toLowerCase();
                        if (Util.IsNullEmpty((item as any).customerid)) {
                            if (!Util.IsNullEmpty(user.selectedcustomerid)) {
                                var customer = await this.getbyid<Customer>(user.selectedcustomerid, "users", jwt, true, span)
                                if (customer != null) {
                                    (item as any).customerid = user.selectedcustomerid;
                                }
                            }
                            if (Util.IsNullEmpty((item as any).customerid)) {
                                (item as any).customerid = user.customerid;
                            }
                        }

                        var agent: iAgent = (item as any);
                        if (Util.IsNullEmpty(agent.runas)) {
                            agent.runas = user._id
                        }
                    }
                    await Logger.DBHelper.CheckCache(collectionname, item, false, false, span);
                }
                if (collectionname === "users" && item._type === "user" && item.hasOwnProperty("newpassword")) {
                    if ((item as any).newpassword != "") {
                        user2.passwordhash = await Crypt.hash((item as any).newpassword);
                    }
                    delete (item as any).newpassword;
                }
                if (collectionname === "users" && item._type === "role") {
                    const r: Role = (item as any);
                    if (Util.IsNullEmpty(r.name)) { throw new Error("Name is mandatory"); }
                    span?.addEvent("FindRoleByName");
                    const exists2 = await Logger.DBHelper.FindRoleByName(r.name, null, span);
                    if (exists2 != null) { throw new Error("Access denied, role '" + r.name + "' already exists"); }
                }

                if (collectionname == "mq" && !Util.IsNullEmpty(item.name)) {
                    if (item._type == "exchange") item.name = item.name.toLowerCase();
                    if (item._type == "queue") item.name = item.name.toLowerCase();
                    if (item._type == "workitemqueue") { hadWorkitemQueue = true; wiqids.push(item._id); }
                    if (item._type === "exchange") {
                        await amqpwrapper.Instance().PreRegisterExchange(item, span);
                    }
                }
                if (collectionname == "workitems" && item._type == "workitem") {
                    // @ts-ignore
                    if (Util.IsNullEmpty(item.state)) item.state = "new";
                    hadWorkitemQueue = true;
                    // @ts-ignore
                    if (item.hasOwnProperty("wiqid")) wiqids.push(item.wiqid);
                    // @ts-ignore
                    if (Util.IsNullEmpty(item.nextrun)) item.nextrun = new Date(new Date().toISOString());
                }
                // @ts-ignore
                if (collectionname == "workitems" && item._type == "workitem") item.state = "new";

                if (collectionname === "users" && !Util.IsNullEmpty(item._type) && !Util.IsNullEmpty(item.name)) {
                    if (item._type === "user" && !Util.IsNullEmpty(user2.username)) {
                        user2.username = user2.username.toLowerCase();
                    }
                    if (item._type === "user" && Util.IsNullEmpty(user2.username)) {
                        throw new Error("Username is mandatory for users")
                    }
                    await Logger.DBHelper.CheckCache(collectionname, item, false, false, span);
                }

                if (item._id != null) {
                    const basehist = await this.query<any>({ query: { id: item._id }, projection: { _version: 1 }, top: 1, orderby: { _version: -1 }, collectionname: collectionname + "_hist", jwt: Crypt.rootToken() }, span);
                    if (basehist.length > 0) {
                        item._version = basehist[0]._version;
                    }
                    if (basehist.length > 0) {
                        const org = await this.GetDocumentVersion({ collectionname, id: item._id, version: item._version, jwt: Crypt.rootToken() }, span)
                        if (org != null) {
                            item._createdby = org._createdby;
                            item._createdbyid = org._createdbyid;
                            item._created = org._created;
                            item._modifiedby = org._modifiedby;
                            item._modifiedbyid = org._modifiedbyid;
                            item._modified = org._modified;
                            if (!item._created) item._created = new Date(new Date().toISOString());
                            if (!item._createdby) item._createdby = user.name;
                            if (!item._createdbyid) item._createdbyid = user._id;
                            if (!item._modified) item._modified = new Date(new Date().toISOString());
                            if (!item._modifiedby) item._modifiedby = user.name;
                            if (!item._modifiedbyid) item._modifiedbyid = user._id;
                            if (!item._version) item._version = 0;
                        } else {
                            item._version++;
                        }
                    }
                } else {
                    item._id = new ObjectId().toHexString();
                }
                span?.addEvent("CleanACL");
                if (!DatabaseConnection.usemetadata(collectionname) && !DatabaseConnection.istimeseries(collectionname)) {
                    item = await this.CleanACL(item, user, collectionname, span);
                    if (item._type === "role" && collectionname === "users") {
                        item = await this.Cleanmembers(item as any, null, false, span);
                    }
                } else if (DatabaseConnection.istimeseries(collectionname) && !DatabaseConnection.usemetadata(collectionname)) {
                } else {
                    // skip clean acl, to expensive
                }


                if (collectionname === "users" && item._type === "user") {
                    const u: TokenUser = (item as any);
                    if (Util.IsNullEmpty(u.validated)) u.validated = false;
                    if (Util.IsNullEmpty(u.formvalidated)) u.formvalidated = false;
                    if (Util.IsNullEmpty(u.emailvalidated)) u.emailvalidated = false;
                    if (Util.IsNullEmpty(u.username)) { throw new Error("Username is mandatory"); }
                    if (Util.IsNullEmpty(u.name)) { throw new Error("Name is mandatory"); }
                    span?.addEvent("FindByUsername");
                    const exists = await Logger.DBHelper.FindByUsername(u.username, null, span);
                    if (exists != null) { throw new Error("Access denied, user '" + u.username + "' already exists"); }
                }
                if (collectionname === "users" && item._type === "role") {
                    const r: Role = (item as any);
                    if (Util.IsNullEmpty(r.name)) { throw new Error("Name is mandatory"); }
                    span?.addEvent("FindRoleByName");
                    const exists2 = await Logger.DBHelper.FindRoleByName(r.name, null, span);
                    if (exists2 != null) { throw new Error("Access denied, role '" + r.name + "' already exists"); }
                }
                if (collectionname == "audit") {
                    delete item._modifiedby;
                    delete item._modifiedbyid;
                    delete item._modified;
                }
                bulkInsert.insert(item);
                counter++
                if (counter % x === 0) {
                    const ot_end_inner = Logger.otel.startTimer();
                    tempresult = tempresult.concat(bulkInsert.execute())
                    Logger.otel.endTimer(ot_end_inner, DatabaseConnection.mongodb_insertmany, DatabaseConnection.otel_label(collectionname, user, "insertmany"));
                    bulkInsert = this.db.collection(collectionname).initializeUnorderedBulkOp()
                }
            }
            const ot_end = Logger.otel.startTimer();
            tempresult = tempresult.concat(bulkInsert.execute())
            Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_insertmany, DatabaseConnection.otel_label(collectionname, user, "insertmany"));

            for (let y = 0; y < items.length; y++) {
                let item = items[y];
                if (collectionname === "users" && item._type === "user") {
                    Base.addRight(item, item._id, item.name, [Rights.read, Rights.update, Rights.invoke]);
                    span?.addEvent("CleanACL");
                    item = await this.CleanACL(item, user, collectionname, span);
                    await Logger.DBHelper.UserRoleUpdateId(Wellknown.users._id, false, span);

                    const user2: TokenUser = item as any;
                    await Logger.DBHelper.EnsureNoderedRoles(user2, Crypt.rootToken(), false, span);
                }
                if (collectionname === "users" && item._type === "role") {
                    Base.addRight(item, item._id, item.name, [Rights.read]);
                    item = await this.CleanACL(item, user, collectionname, span);
                    const ot_end_inner2 = Logger.otel.startTimer();
                    await this.db.collection(collectionname).replaceOne({ _id: item._id }, item);
                    Logger.otel.endTimer(ot_end_inner2, DatabaseConnection.mongodb_replace, DatabaseConnection.otel_label(collectionname, user, "replace"));
                }
                if (collectionname === "config" && item._type === "oauthclient") {
                    if (user.HasRoleName(Wellknown.admins.name)) {
                        setTimeout(() => OAuthProvider.LoadClients(span), 1000);
                    }
                }
                span?.addEvent("traversejsondecode");
                DatabaseConnection.traversejsondecode(item);
            }
            if (hadWorkitemQueue) {
                if (wiqids.length == 0) await Logger.DBHelper.WorkitemQueueUpdate(null, false, span);
                for (var i = 0; i < wiqids.length; i++) {
                    await Logger.DBHelper.CheckCache(collectionname, wiqids[i], false, false, span);
                }

            }
            result = items;
            Logger.instanse.verbose("inserted " + counter + " items in database", span, { collection: collectionname, user: user.username, count: counter, cls: "DatabaseConnection", func: "InsertMany" });
            let collections = await Logger.DBHelper.GetCollections(span);
            if (collections.find(x => x.name == collectionname) == null) {
                await Logger.DBHelper.ClearGetCollections()
            }
        } finally {
            Logger.otel.endSpan(span);
        }
        return result;
    }
    /**
     * Update entity in database
     * @param  {T} item Item to update
     * @param  {string} collectionname Collection containing item
     * @param  {number} w Write Concern ( 0:no acknowledgment, 1:Requests acknowledgment, 2: Requests acknowledgment from 2, 3:Requests acknowledgment from 3)
     * @param  {boolean} j Ensure is written to the on-disk journal.
     * @param  {string} jwt JWT of user who is doing the update, ensuring rights
     * @returns Promise<T>
     */
    async UpdateOne<T extends Base>(item: T, collectionname: string, w: number, j: boolean, jwt: string, parent: Span): Promise<T> {
        let q = new UpdateOneMessage();
        q.query = null; q.item = item; q.collectionname = collectionname; q.w = w; q.j = j; q.jwt = jwt;
        if (q.w < 1) q.w = 1; // set minimu, to avoid "More than one item was updated !!!"
        if (q.collectionname == null || q.collectionname == "") throw new Error("collectionname is mandatory");
        q = await this._UpdateOne(q, parent);
        if (!Util.IsNullUndefinded(q.opresult)) {
            if (q.opresult.modifiedCount === 0) {
                throw new Error("item not found!");
            } else if (q.opresult.modifiedCount !== 1) {
                throw new Error("More than one item was updated !!!");
            }
            return q.item as any;
        } else {
            throw new Error("UpdateOne failed!!!");
        }
    }
    async _UpdateOne<T extends Base>(q: UpdateOneMessage, parent: Span): Promise<UpdateOneMessage> {
        const span: Span = Logger.otel.startSubSpan("db.UpdateOne", parent);
        let customer: Customer = null;
        try {
            if (q.collectionname == "audit") {
                throw new Error("Access denied");
            }
            if (q.collectionname == null || q.collectionname == "") throw new Error("collectionname is mandatory");
            let itemReplace: boolean = true;
            if (q === null || q === undefined) { throw new Error("UpdateOneMessage cannot be null"); }
            if (q.item === null || q.item === undefined) { throw new Error("Cannot update null item"); }
            if (typeof q.item === "string") q.item = JSON.parse(q.item);
            await this.connect(span);
            const user: User = await Auth.Token2User(q.jwt, span);
            if (user == null) throw new Error("Access denied");
            if (user.dblocked && !user.HasRoleName(Wellknown.admins.name)) throw new Error("Access denied (db locked) could be due to hitting quota limit for " + user.username);
            if (q.query === null || q.query === undefined) {
                if (!DatabaseConnection.usemetadata(q.collectionname)) {
                    if (!DatabaseConnection.hasAuthorization(user, q.item, Rights.update)) {
                        throw new Error("Access denied, no authorization to UpdateOne with current ACL");
                    }
                } else {
                    let metadata = DatabaseConnection.metadataname(q.collectionname);
                    if (!DatabaseConnection.hasAuthorization(user, q.item[metadata], Rights.update)) {
                        throw new Error("Access denied, no authorization to UpdateOne with current ACL");
                    }
                }
            }
            if (q.collectionname === "files") { q.collectionname = "fs.files"; }

            let original: T = null;
            // assume empty query, means full document, else update document
            if (q.query === null || q.query === undefined) {
                // this will add an _acl so needs to be after we checked old item
                if (!q.item.hasOwnProperty("_id")) {
                    throw new Error("Cannot update item without _id");
                }
                let name = q.item.name;
                if (Util.IsNullEmpty(name)) name = (q.item as any)._name;
                if (Util.IsNullEmpty(name)) name = "Unknown";
                if (Util.IsNullUndefinded((q as any).original)) {
                    original = await this.getbyid<T>(q.item._id, q.collectionname, q.jwt, false, span);
                    if (original == null) {
                        throw new Error("item " + q.item._id + " not found in " + q.collectionname + " or Access Denied");
                    }
                    if (q.item._id !== original._id) {
                        q.item._id = original._id;
                    }
                } else {
                    original = (q as any).original;
                }
                if (!original) {
                    throw new Error("item not found or Access Denied");
                }
                if (!DatabaseConnection.hasAuthorization(user, original, Rights.update)) {
                    throw new Error("Access denied, no authorization to UpdateOne " + q.item._type + " " + name + " to database");
                }
                if (q.collectionname === "config" && q.item._type === "config") {
                    if (!user.HasRoleId(Wellknown.admins._id)) throw new Error("Access denied, no authorization to update config");
                    dbConfig.cleanAndApply(q.item as any, span);
                }

                await Logger.DBHelper.CheckCache(q.collectionname, q.item, false, false, span);

                if (q.collectionname === "agents") {
                    // @ts-ignore;
                    var runas = q.item.runas;
                    // @ts-ignore;
                    var runasname = q.item.runasname;
                    // @ts-ignore
                    if (original.runas != runas && runas != user._id) {
                        if (!user.HasRoleName(Wellknown.customer_admins.name) && !user.HasRoleName(Wellknown.admins.name)) {
                            throw new Error("Access denied");
                        }
                    }
                    if (!Util.IsNullEmpty(runas)) {
                        let runasuser = await this.getbyid<User>(runas, "users", q.jwt, true, span);
                        runasuser = await Logger.DBHelper.DecorateWithRoles(runasuser as any, parent);
                        if (!DatabaseConnection.hasAuthorization(runasuser as any, q.item, Rights.update)) {
                            if (Util.IsNullEmpty(runasuser.customerid)) {
                                Base.addRight(q.item, runas, runasname, [Rights.read, Rights.update, Rights.invoke]);
                            } else {
                                customer = await this.getbyid<Customer>(runasuser.customerid, "users", q.jwt, true, span);
                                if (customer != null) {
                                    Base.addRight(q.item, customer.users, customer.name + " users", [Rights.read, Rights.update, Rights.invoke]);
                                    Base.addRight(q.item, customer.admins, customer.name + " admins", [Rights.full_control]);
                                } else {
                                    Base.addRight(q.item, runas, runasname, [Rights.read, Rights.update, Rights.invoke]);
                                }
                            }

                        }
                    }
                    // @ts-ignore
                    var fileid = q.item.fileid;
                    if (q.item._type == "package" && fileid != "" && fileid != null) {
                        var f = await this.getbyid<any>(fileid, "fs.files", q.jwt, true, span);
                        if (f != null) {
                            // is f.metadata._acl different from q.item._acl ?
                            f.metadata._acl = q.item._acl;
                            await this.UpdateOne(f, "fs.files", 1, false, q.jwt, span);
                            if (original != null) {
                                // @ts-ignore
                                var oldfileid = original.fileid;
                                if (oldfileid != fileid && oldfileid != null && oldfileid != "") {
                                    try {
                                        await this.DeleteOne(oldfileid, "fs.files", false, q.jwt, span);
                                    } catch (error) {
                                    }
                                }
                            }
                        }

                    }
                    if (q.item._type == "agent") {
                        // @ts-ignore
                        if (original.autostart != q.item.autostart && q.item.autostart == true && Util.IsNullEmpty(q.item.stripeprice)) {
                            if (!user.HasRoleName(Wellknown.admins.name)) {
                                throw new Error("Access denied");
                            }
                        }
                        if (Util.IsNullEmpty((q.item as any).customerid)) {
                            if (!Util.IsNullEmpty(user.selectedcustomerid)) {
                                var _customer = await this.getbyid<Customer>(user.selectedcustomerid, "users", q.jwt, true, span)
                                if (_customer != null) {
                                    (q.item as any).customerid = user.selectedcustomerid;
                                }
                            }
                            if (Util.IsNullEmpty((q.item as any).customerid)) {
                                (q.item as any).customerid = user.customerid;
                            }
                        }

                        var agent: iAgent = (q.item as any);
                        if (Util.IsNullEmpty(agent.runas)) {
                            agent.runas = user._id
                        }
                        if (Util.IsNullEmpty(agent.slug)) {
                            throw new Error("Agent slug cannot be empty");
                        }
                        agent.slug = agent.slug.toLowerCase();
                        // @ts-ignore
                        if (!user.HasRoleName(Wellknown.admins.name) && agent.slug != original.slug) {
                            throw new Error("Access denied, changing slug");
                        }
                    }
                }

                if (q.collectionname === "users" && (q.item._type === "user" || q.item._type === "role")) {
                    let user2: User = q.item as any;
                    if (DatabaseConnection.WellknownIdsArray.indexOf(q.item._id) > -1) {
                        delete user2.customerid;
                    }
                    if (user2._type === "user" && !Util.IsNullEmpty(user2.username)) {
                        user2.username = user2.username.toLowerCase();
                    }
                    if (user2._type === "user" && Util.IsNullEmpty(user2.username)) {
                        throw new Error("Username is mandatory for users")
                    }
                    if (user2._type === "user" && user._id == user2._id && user2.disabled) {
                        throw new Error("Cannot disable yourself")
                    }
                    if (q.collectionname === "users" && q.item._type === "role") {
                        const r: Role = (q.item as any);
                        if (Util.IsNullEmpty(r.name)) { throw new Error("Name is mandatory"); }
                        span?.addEvent("FindByUsername");
                        const exists2 = await Logger.DBHelper.FindRoleByName(r.name, null, span);
                        if (exists2 != null && exists2._id != q.item._id) { throw new Error("Access denied, role '" + r.name + "' already exists"); }
                    }

                    if (!Util.IsNullEmpty(user2.customerid)) {
                        // User can update, just not created ?
                        // if (!user.HasRoleName(Wellknown.customer_admins.name) && !user.HasRoleName(Wellknown.admins.name)) throw new Error("Access denied (not admin) to customer with id " + user2.customerid);
                        customer = await this.getbyid<Customer>(user2.customerid, "users", q.jwt, true, span)
                        if (customer == null) throw new Error("Access denied to customer with id " + user2.customerid + " when updating " + user2._id);
                    } else if (user.HasRoleName(Wellknown.customer_admins.name) && !Util.IsNullEmpty(user.customerid)) {
                        customer = null;
                    } else if (Config.multi_tenant && !user.HasRoleName(Wellknown.admins.name)) {
                    }
                    if (customer != null && !Util.IsNullEmpty(customer.admins)) {
                        const custadmins = await this.getbyid<Role>(customer.admins, "users", q.jwt, true, span);
                        if (!Util.IsNullEmpty(custadmins)) {
                            Base.addRight(q.item, custadmins._id, custadmins.name, [Rights.full_control]);
                            if (q.item._id == customer.admins || q.item._id == customer.users) {
                                Base.removeRight(q.item, custadmins._id, [Rights.delete]);
                            }
                        } else {
                            Logger.instanse.warn("Failed locating customer admins role " + customer.admins + " while updating " + q.item._id + " in database", span, { collection: q.collectionname, user: user.username, cls: "DatabaseConnection", func: "UpdateOne" });
                        }
                        (q.item as any).company = customer.name;
                        q.item = this.ensureResource(q.item, q.collectionname);
                    }
                }

                if (!DatabaseConnection.usemetadata(q.collectionname)) {
                    q.item._modifiedby = user.name;
                    q.item._modifiedbyid = user._id;
                    q.item._modified = new Date(new Date().toISOString());
                    if (original["_type"] == "user" || original["_type"] == "role") {
                        q.item._type = original["_type"];
                    }
                    // now add all _ fields to the new object
                    const keys: string[] = Object.keys(original);
                    for (let i: number = 0; i < keys.length; i++) {
                        let key: string = keys[i];
                        if (key == "username" && q.collectionname == "users" && q.item._type == "user") {
                            if (!user.HasRoleName(Wellknown.admins.name)) {
                                q.item[key] = original[key];
                            }
                        }
                        if ((key == "dbusage" || key == "dblocked") && q.collectionname == "users") {
                            if (!user.HasRoleName(Wellknown.admins.name)) {
                                q.item[key] = original[key];
                            }
                        }

                        if (key === "_created") {
                            q.item[key] = new Date(original[key]);
                        } else if (key === "_createdby" || key === "_createdbyid") {
                            q.item[key] = original[key];
                        } else if (key === "_modifiedby" || key === "_modifiedbyid" || key === "_modified") {
                            // allready updated
                        } else if (key.indexOf("_") === 0) {
                            if (!q.item.hasOwnProperty(key)) {
                                q.item[key] = original[key]; // add missing key
                            } else if (q.item[key] === null) {
                                delete q.item[key]; // remove key
                            } else {
                                // key allready exists, might been updated since last save
                            }
                        }
                    }
                    if (q.item._acl === null || q.item._acl === undefined || !Array.isArray(q.item._acl)) {
                        q.item._acl = original._acl;
                        q.item._version = original._version;
                        if (!DatabaseConnection.hasAuthorization(user, (q.item as Base), Rights.update)) {
                            throw new Error("Access denied, no authorization to UpdateOne with current ACL");
                        }
                    }
                    q.item = this.ensureResource(q.item, q.collectionname);
                    if (user._id != Wellknown.root._id && original._type != q.item._type && !await this.CheckEntityRestriction(user, q.collectionname, q.item, span)) {
                        throw new Error("Create " + q.item._type + " access denied");
                    }
                    // force cleaning members, to clean up mess with auto added members
                    if (q.item._type === "role" && q.collectionname === "users") {
                        q.item = await this.Cleanmembers(q.item as any, original, false, span);
                    }

                    const hasUser: Ace = q.item._acl.find(e => e._id === user._id);
                    if (Util.IsNullUndefinded(hasUser) && q.item._acl.length === 0) {
                        Base.addRight(q.item, user._id, user.name, [Rights.full_control]);
                        q.item = this.ensureResource(q.item, q.collectionname);
                    }
                    if (q.collectionname === "users" && q.item._type === "user") {
                        let u: User = q.item as User;
                        if (Util.IsNullEmpty(u.validated)) u.validated = false;
                        if (Util.IsNullEmpty(u.formvalidated)) u.formvalidated = false;
                        if (Util.IsNullEmpty(u.emailvalidated)) u.emailvalidated = false;
                    }

                    DatabaseConnection.traversejsonencode(q.item);
                    q.item = this.encryptentity(q.item);
                } else {
                    let metadata = DatabaseConnection.metadataname(q.collectionname);

                    if (!DatabaseConnection.hasAuthorization(user, q.item[metadata], Rights.update)) {
                        throw new Error("Access denied, no authorization to UpdateOne file " + (q.item as any).filename + " to database");
                    }
                    if (!user.HasRoleId(Wellknown.admins._id)) {
                        if (!DatabaseConnection.hasAuthorization(user, original[metadata], Rights.update)) {
                            throw new Error("Access denied, no authorization to UpdateOne file " + (original as any).filename + " to database");
                        }
                    }
                    q.item[metadata] = Base.assign(q.item[metadata]);
                    q.item[metadata]._modifiedby = user.name;
                    q.item[metadata]._modifiedbyid = user._id;
                    q.item[metadata]._modified = new Date(new Date().toISOString());
                    // now add all _ fields to the new object
                    const keys: string[] = Object.keys(original[metadata]);
                    for (let i: number = 0; i < keys.length; i++) {
                        let key: string = keys[i];
                        if (key === "_created") {
                            q.item[metadata][key] = new Date(original[metadata][key]);
                        } else if (key === "_type") {
                            q.item[metadata][key] = original[metadata][key];
                        } else if (key === "_createdby" || key === "_createdbyid") {
                            q.item[metadata][key] = original[metadata][key];
                        } else if (key === "_modifiedby" || key === "_modifiedbyid" || key === "_modified") {
                            // allready updated
                        } else if (key.indexOf("_") === 0) {
                            if (!q.item[metadata].hasOwnProperty(key)) {
                                q.item[metadata][key] = original[metadata][key]; // add missing key
                            } else if (q.item[metadata][key] === null) {
                                delete q.item[metadata][key]; // remove key
                            } else {
                                // key allready exists, might been updated since last save
                            }
                        }
                    }
                    if (q.item[metadata]._acl === null || q.item[metadata]._acl === undefined || !Array.isArray(q.item[metadata]._acl)) {
                        q.item[metadata]._acl = original[metadata]._acl;
                        q.item[metadata]._version = original[metadata]._version;
                        if (!DatabaseConnection.hasAuthorization(user, q.item[metadata], Rights.update)) {
                            throw new Error("Access denied, no authorization to UpdateOne with current ACL");
                        }

                    }
                    q.item[metadata] = this.ensureResource(q.item[metadata], q.collectionname);
                    DatabaseConnection.traversejsonencode(q.item);
                    q.item[metadata] = this.encryptentity(q.item[metadata]);
                    const hasUser: Ace = q.item[metadata]._acl.find(e => e._id === user._id);
                    if ((hasUser === null || hasUser === undefined) && q.item[metadata]._acl.length === 0) {
                        Base.addRight(q.item[metadata], user._id, user.name, [Rights.full_control]);
                        q.item = this.ensureResource(q.item, q.collectionname);
                    }
                }
                var _oldversion = 0;
                var _skiphistory = false;
                if (original != null) _oldversion = original._version;
                if (q.item.hasOwnProperty("_skiphistory")) {
                    delete (q.item as any)._skiphistory;
                    if (!Config.allow_skiphistory) {
                        q.item._version = await this.SaveDiff(q.collectionname, original, q.item, span);
                    } else {
                        _skiphistory = true;
                    }
                } else {
                    q.item._version = await this.SaveDiff(q.collectionname, original, q.item, span);
                }
                if (_oldversion == q.item._version && _skiphistory == false) {
                    if (q.item._type === "instance" && q.collectionname === "workflows") {
                    } else {
                        const _skip_array: string[] = Config.skip_history_collections.split(",");
                        const skip_array: string[] = [];
                        _skip_array.forEach(x => skip_array.push(x.trim()));
                        if (skip_array.indexOf(q.collectionname) > -1) {
                        } else {
                            q.result = q.item;
                            q.opresult = { modifiedCount: 1, result: { ok: 1 } };
                            return q;
                        }
                    }
                }
            } else {
                let json: string = q.item as any;
                if (typeof json !== "string") {
                    json = JSON.stringify(json);
                }
                q.item = JSON.parse(json, (key, value) => {
                    if (typeof value === "string" && value.match(isoDatePattern)) {
                        return new Date(value); // isostring, so cast to js date
                    } else if (value != null && value != undefined && value.toString().indexOf("__REGEXP ") === 0) {
                        const m = value.split("__REGEXP ")[1].match(/\/(.*)\/(.*)?/);
                        return new RegExp(m[1], m[2] || "");
                    } else
                        return value; // leave any other value as-is
                });

                itemReplace = false;
                if (q.item["$set"] !== null && q.item["$set"] !== undefined) {
                    if (q.collectionname === "agents" && q.item["$set"].hasOwnProperty("runas")) {
                        if (!user.HasRoleName(Wellknown.customer_admins.name) && !user.HasRoleName(Wellknown.admins.name)) {
                            throw new Error("Access denied");
                        }
                    }
                    if (q.item["$set"].hasOwnProperty("_skiphistory")) {
                        delete q.item["$set"]._skiphistory;
                        if (!Config.allow_skiphistory) this.SaveUpdateDiff(q, user, span);
                    } else {
                        this.SaveUpdateDiff(q, user, span);
                    }
                } else {
                    this.SaveUpdateDiff(q, user, span);
                }
            }
            if (q.collectionname === "users" && q.item._type === "user" && q.item.hasOwnProperty("newpassword")) {
                if ((q.item as any).newpassword != "") {
                    (q.item as any).passwordhash = await Crypt.hash((q.item as any).newpassword);
                }
                delete (q.item as any).newpassword;
            }
            if (q.collectionname === "config" && q.item._type === "oauthclient") {
                if (user.HasRoleName(Wellknown.admins.name)) {
                    setTimeout(() => OAuthProvider.LoadClients(span), 1000);
                }
            }
            Logger.instanse.silly("Updating " + (q.item.name || q.item._name) + " in database", span, { collection: q.collectionname, user: user.username, cls: "DatabaseConnection", func: "UpdateOne" });

            if (q.query === null || q.query === undefined) {
                const id: string = q.item._id;
                if (id.length == 12 || id.length == 24) {
                    const safeid = safeObjectID(id);
                    q.query = { _id: id };
                    if (safeid != null) {
                        q.query = { $or: [{ _id: id }, { _id: safeid }] };
                    }
                } else {
                    q.query = { _id: id };
                }
            }
            let _query: Object = {};
            if (DatabaseConnection.usemetadata(q.collectionname)) {
                _query = { $and: [q.query, this.getbasequery(user, [Rights.update], q.collectionname)] };
            } else {
                // todo: enforcer permissions when fetching _hist ?
                _query = { $and: [q.query, this.getbasequery(user, [Rights.update], q.collectionname)] };
            }
            if (Config.api_bypass_perm_check) { _query = q.query; }

            q.j = ((q.j as any) === "true" || q.j === true);
            if ((q.w as any) !== "majority") q.w = parseInt((q.w as any));

            let options: UpdateOptions = { writeConcern: { w: q.w, j: q.j }, upsert: false };
            (options as any).WriteConcern = { w: q.w, j: q.j };
            if (Util.IsNullEmpty(this.replicat)) options = null;

            q.opresult = null;
            if (itemReplace) {
                if (q.item._id != Wellknown.users._id) {
                    if (!DatabaseConnection.usemetadata(q.collectionname)) {
                        q.item = await this.CleanACL(q.item, user, q.collectionname, span);
                    } else {
                        let metadata = DatabaseConnection.metadataname(q.collectionname);
                        q.item[metadata] = await this.CleanACL(q.item[metadata], user, q.collectionname, span);
                    }
                }
                if (q.item._type === "role" && q.collectionname === "users") {
                    q.item = await this.Cleanmembers(q.item as any, original, false, span);
                }
                if (q.collectionname === "mq") {
                    if (!Util.IsNullEmpty(q.item.name)) {
                        if (q.item._type == "exchange") q.item.name = q.item.name.toLowerCase();
                        if (q.item._type == "queue") q.item.name = q.item.name.toLowerCase();
                        if (q.item._type === "exchange") {
                            await amqpwrapper.Instance().PreRegisterExchange(q.item, span);
                        }
                    }
                }
                if (!DatabaseConnection.usemetadata(q.collectionname)) {
                    try {
                        const ot_end = Logger.otel.startTimer();
                        q.opresult = await this.db.collection(q.collectionname).replaceOne(_query, q.item, options);
                        let ms = Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_replace, DatabaseConnection.otel_label(q.collectionname, user, "replace"));
                        Logger.instanse.debug("updated " + q.item.name, span, { collection: q.collectionname, user: user.username, ms, cls: "DatabaseConnection", func: "UpdateOne" });
                    } catch (error) {
                        var msg: string = error.message;
                        if (msg.startsWith("After applying the update, the (immutable) field '_id' was found")) {
                            const safeid = safeObjectID(q.item._id);
                            // @ts-ignore
                            q.opresult = await this.db.collection(q.collectionname).insertOne(q.item);
                            q.opresult.matchedCount = q.opresult.insertedCount;
                            await this.db.collection(q.collectionname).deleteOne({ _id: safeid });
                        }
                    }
                    if (q.opresult && q.opresult.matchedCount == 0 && (q.w != 0)) {
                        throw new Error("ReplaceOne failed, matched 0 documents with query {_id: '" + q.item._id + "'}");
                    }
                    if (q.opresult == null) {
                        Logger.instanse.error("opresult is null !!", span, { collection: q.collectionname, user: user.username, cls: "DatabaseConnection", func: "UpdateOne" });
                    }
                } else {
                    const fsc = Config.db.db.collection(q.collectionname);
                    const ot_end = Logger.otel.startTimer();
                    let metadata = DatabaseConnection.metadataname(q.collectionname);
                    q.opresult = await fsc.updateOne(_query, { $set: { metadata: q.item[metadata] } });
                    Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_update, DatabaseConnection.otel_label(q.collectionname, user, "update"));
                    if ((q.opresult && q.opresult.matchedCount == 0) && (q.w != 0)) {
                        throw new Error("ReplaceOne failed, matched 0 documents with query {_id: '" + q.item._id + "'}");
                    }
                    if (q.opresult == null) {
                        Logger.instanse.error("opresult is null !!", span, { collection: q.collectionname, user: user.username, cls: "DatabaseConnection", func: "UpdateOne" });
                    }
                }
            } else {
                if ((q.item["$set"]) === undefined) { (q.item["$set"]) = {} };
                (q.item["$set"])._modifiedby = user.name;
                (q.item["$set"])._modifiedbyid = user._id;
                (q.item["$set"])._modified = new Date(new Date().toISOString());
                if ((q.item["$inc"]) === undefined) { (q.item["$inc"]) = {} };
                (q.item["$inc"])._version = 1;
                if (q.collectionname == "users") {
                    ["$inc", "$mul", "$set", "$unset"].forEach(t => {
                        if (q.item[t] !== undefined) {
                            delete q.item[t].username;
                            delete q.item[t].dbusage;
                            delete q.item[t].dblocked;
                        }
                    })
                }
                const ot_end = Logger.otel.startTimer();
                q.opresult = await this.db.collection(q.collectionname).updateOne(_query, q.item, options);
                let ms = Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_update, DatabaseConnection.otel_label(q.collectionname, user, "update"));
                Logger.instanse.debug("updated " + q.opresult.modifiedCount + " items", span, { collection: q.collectionname, user: user.username, ms, cls: "DatabaseConnection", func: "UpdateOne" });
            }
            if (!DatabaseConnection.usemetadata(q.collectionname)) {
                q.item = this.decryptentity(q.item);
            } else {
                let metadata = DatabaseConnection.metadataname(q.collectionname);
                q.item[metadata] = this.decryptentity<T>(q.item[metadata]);
            }
            if (original != null) {
                await Logger.DBHelper.CheckCache(q.collectionname, original, false, false, span);
            }
            if (q.collectionname === "config" && q.item._type === "provider") {
                await LoginProvider.RegisterProviders(WebServer.app, Config.baseurl(), span);
            }
            DatabaseConnection.traversejsondecode(q.item);
            if (q.collectionname === "users" && q.item._type === "user") {
                let user2: User = User.assign(q.item as any);

                if (Config.validate_emails && user2.emailvalidated || !Config.validate_emails) {
                    let domain: string = user2.username;
                    if (!Util.IsNullEmpty(user2.email)) domain = user2.email;
                    if (domain.indexOf("@") > -1) {
                        var userupdate: any = { "$set": {}, "$push": {} };
                        domain = domain.substring(domain.indexOf("@") + 1).toLowerCase();
                        var customers = await this.query<Customer>({ query: { _type: "customer", domains: { $in: [domain] } }, collectionname: "users", jwt: q.jwt }, span);
                        var doupdate: boolean = false;
                        for (var i = 0; i < customers.length; i++) {
                            if (Util.IsNullEmpty(user2.customerid)) {
                                user2.customerid = customers[i]._id;
                                userupdate["$set"]["customerid"] = user2.customerid;
                                doupdate = true;
                            }
                            // @ts-ignore
                            if (Util.IsNullEmpty(user2.company)) {
                                // @ts-ignore
                                user2.company = customers[i].name;
                                userupdate["$set"]["company"] = customers[i].name;
                                doupdate = true;
                            }
                            if (!user2.HasRoleId(customers[i].users)) {
                                user2.roles.push(new Rolemember(customers[i].name + " users", customers[i].users));
                                var ace: Ace = new Ace();
                                ace._id = customers[i].users; ace.name = customers[i].name + " users";
                                Ace.resetnone(ace); Ace.setBit(ace, Rights.read);
                                if (!userupdate["$push"]["_acl"]) {
                                    userupdate["$push"]["_acl"] = { "$each": [] };
                                }
                                userupdate["$push"]["_acl"]["$each"].push(ace);
                                var ace: Ace = new Ace();
                                ace._id = customers[i].admins; ace.name = customers[i].name + " admins";
                                Ace.resetfullcontrol(ace);
                                userupdate["$push"]["_acl"]["$each"].push(ace);
                                await this.db.collection("users").updateOne(
                                    { _id: customers[i].users },
                                    { "$push": { members: new Rolemember(q.item.name, q.item._id) } }
                                );
                                doupdate = true;
                            }
                            await Logger.DBHelper.UserRoleUpdateId(customers[i].users, false, span);

                        }
                        if (doupdate) {
                            await this.db.collection("users").updateOne(
                                { _id: q.item._id },
                                userupdate
                            );
                            await Logger.DBHelper.CheckCache("users", user2, false, false, span);
                        }
                    }
                }


                if (customer != null && !Util.IsNullEmpty(user2.customerid) && user2._id != customer.users && user2._id != customer.admins && user2._id != Wellknown.root._id) {
                    // TODO: Check user has permission to this customer
                    let custusers: Role = await this.getbyid<Role>(customer.users, "users", q.jwt, true, span);
                    if (custusers != null) {
                        custusers = Role.assign(custusers);
                    }
                    if (custusers != null && !custusers.IsMember(q.item._id)) {
                        custusers = Role.assign(await this.getbyid<Role>(customer.users, "users", q.jwt, true, span));
                        custusers.AddMember(q.item);
                        await Logger.DBHelper.Save(custusers, Crypt.rootToken(), span);
                        await Logger.DBHelper.CheckCache(q.collectionname, q.item, false, false, span);
                    }
                } else {
                    // await Logger.DBHelper.UserRoleUpdate(q.item, false, span);
                }
                await Logger.DBHelper.EnsureNoderedRoles(user2, Crypt.rootToken(), false, span);
            }
            q.result = q.item;
            return q;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    async UpdateDocument(query: any, doc: any, collectionname: string, w: number, j: boolean, jwt: string, parent: Span): Promise<opresult> {
        const q: UpdateOneMessage = { query: query, item: doc, collectionname: collectionname, w: w, j: j, jwt: jwt, error: null, result: null, opresult: null };
        const result: UpdateOneMessage = await this._UpdateDocument(q, parent);
        return result.opresult;
    }
    /**
    * Update multiple documents in database based on update document
    * @param {any} query MongoDB Query
    * @param  {T} item Update document
    * @param  {string} collectionname Collection containing item
    * @param  {number} w Write Concern ( 0:no acknowledgment, 1:Requests acknowledgment, 2: Requests acknowledgment from 2, 3:Requests acknowledgment from 3)
    * @param  {boolean} j Ensure is written to the on-disk journal.
    * @param  {string} jwt JWT of user who is doing the update, ensuring rights
    * @returns Promise<T>
    */
    async _UpdateDocument<T extends Base>(q: UpdateManyMessage, parent: Span): Promise<UpdateManyMessage> {
        const span: Span = Logger.otel.startSubSpan("db.UpdateMany", parent);
        try {
            if (q === null || q === undefined) { throw new Error("UpdateManyMessage cannot be null"); }
            // @ts-ignore
            if (q.item === null || q.item === undefined) { throw new Error("Cannot update null item"); }
            if (q.collectionname == null || q.collectionname == "") throw new Error("collectionname is mandatory");
            await this.connect();
            const user: User = await Auth.Token2User(q.jwt, span);
            if (user == null) throw new Error("Access denied");
            if (user.dblocked && !user.HasRoleName(Wellknown.admins.name)) throw new Error("Access denied (db locked) could be due to hitting quota limit for " + user.username);

            if (q.collectionname === "users" && q.item._type === "user" && q.item.hasOwnProperty("newpassword")) {
                if ((q.item as any).newpassword != "") {
                    (q.item as any).passwordhash = await Crypt.hash((q.item as any).newpassword);
                }
                delete (q.item as any).newpassword;
            }
            let json: string = q.item as any;
            if (typeof json !== "string") {
                json = JSON.stringify(json);
            }
            if (typeof q.query === "string") {
                q.query = JSON.parse(q.query);
            }
            q.item = JSON.parse(json, (key, value) => {
                if (typeof value === "string" && value.match(isoDatePattern)) {
                    return new Date(value); // isostring, so cast to js date
                } else if (value != null && value != undefined && value.toString().indexOf("__REGEXP ") === 0) {
                    const m = value.split("__REGEXP ")[1].match(/\/(.*)\/(.*)?/);
                    return new RegExp(m[1], m[2] || "");
                } else
                    return value; // leave any other value as-is
            });
            for (let key in q.query) {
                if (key === "_id") {
                    const id: string = (q.query as any)._id;
                    if (id.length == 12 || id.length == 24) {
                        const safeid = safeObjectID(id);
                        if (safeid != null) {
                            delete (q.query as any)._id;
                            (q.query as any).$or = [{ _id: id }, { _id: safeObjectID(id) }];
                        }
                    }
                }
            }
            let _query: Object = {};
            if (!Util.IsNullEmpty(Config.stripe_api_secret) && q.collectionname === "users") {
                if (!user.HasRoleId(Wellknown.admins._id)) throw new Error("Access denied, no authorization to UpdateMany");
            }
            if (q.collectionname === "files") { q.collectionname = "fs.files"; }
            if (DatabaseConnection.usemetadata(q.collectionname)) {
                _query = { $and: [q.query, this.getbasequery(user, [Rights.update], q.collectionname)] };
            } else {
                // todo: enforcer permissions when fetching _hist ?
                _query = { $and: [q.query, this.getbasequery(user, [Rights.update], q.collectionname)] };
            }

            if ((q.item["$set"]) === undefined) { (q.item["$set"]) = {} };
            if (q.item["$set"]._type) delete q.item["$set"]._type;
            (q.item["$set"])._modifiedby = user.name;
            (q.item["$set"])._modifiedbyid = user._id;
            (q.item["$set"])._modified = new Date(new Date().toISOString());
            if ((q.item["$inc"]) === undefined) { (q.item["$inc"]) = {} };
            (q.item["$inc"])._version = 1;

            if (q.collectionname === "agents" && q.item["$set"].hasOwnProperty("runas")) {
                if (!user.HasRoleName(Wellknown.customer_admins.name) && !user.HasRoleName(Wellknown.admins.name)) {
                    throw new Error("Access denied");
                }
            }


            if (q.collectionname == "users") {
                ["$inc", "$mul", "$set", "$unset"].forEach(t => {
                    if (q.item[t] !== undefined) {
                        delete q.item[t].username;
                        delete q.item[t].dbusage;
                        delete q.item[t].dblocked;
                    }
                })
            }

            Logger.instanse.silly("UpdateMany " + (q.item.name || q.item._name) + " in database", span, { collection: q.collectionname, user: user.username, cls: "DatabaseConnection", func: "UpdateMany" });

            q.j = ((q.j as any) === "true" || q.j === true);
            if ((q.w as any) !== "majority") q.w = parseInt((q.w as any));
            let options: UpdateOptions = { writeConcern: { w: q.w, j: q.j } };
            (options as any).WriteConcern = { w: q.w, j: q.j };
            if (Util.IsNullEmpty(this.replicat)) options = null;
            q.opresult = await this.db.collection(q.collectionname).updateMany(_query, q.item, options);
            if (q.opresult) Logger.instanse.debug("updated " + q.opresult.modifiedCount + " items", span, { collection: q.collectionname, user: user.username, count: q.opresult.modifiedCount, cls: "DatabaseConnection", func: "UpdateMany" });
            return q;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public static Semaphore = (n) => ({
        n,
        async down() {
            while (this.n <= 0) await this.wait();
            this.n--;
        },
        up() {
            this.n++;
        },
        async wait() {
            if (this.n <= 0) return new Promise((res, req) => {
                setImmediate(async () => res(await this.wait()))
            });
        },
    });
    async InsertOrUpdateOne<T extends Base>(item: T, collectionname: string, uniqeness: string = "_id", w: number = 1, j: boolean = true, jwt: string, parent: Span): Promise<T> {
        const q: InsertOrUpdateOneMessage = new InsertOrUpdateOneMessage();
        q.collectionname = collectionname;
        q.item = item;
        q.jwt = jwt;
        q.w = w;
        q.j = j;
        q.uniqeness = uniqeness;
        const result = await this._InsertOrUpdateOne(q, parent);
        return result.item as T;
    }
    private static InsertOrUpdateOneSemaphore = DatabaseConnection.Semaphore(1);
    /**
    * Insert or Update depending on document allready exists.
    * @param  {T} item Item to insert or update
    * @param  {string} collectionname Collection containing item
    * @param  {string} uniqeness List of fields to combine for uniqeness
    * @param  {number} w Write Concern ( 0:no acknowledgment, 1:Requests acknowledgment, 2: Requests acknowledgment from 2, 3:Requests acknowledgment from 3)
    * @param  {boolean} j Ensure is written to the on-disk journal.
    * @param  {string} jwt JWT of user who is doing the update, ensuring rights
    * @returns Promise<T>
    */
    async _InsertOrUpdateOne<T extends Base>(q: InsertOrUpdateOneMessage, parent: Span): Promise<InsertOrUpdateOneMessage> {
        if (Util.IsNullUndefinded(q)) return;
        const span: Span = Logger.otel.startSubSpan("db.InsertOrUpdateOne", parent);
        let user: TokenUser | User = (q as any).user;
        try {
            if (q.collectionname == null || q.collectionname == "") throw new Error("collectionname is mandatory");
            user = (q as any).user;
            if (Util.IsNullUndefinded(user)) {
                user = await Auth.Token2User(q.jwt, span);
                if (user == null) throw new Error("Access denied");
            } else {
                delete (q as any).user;
            }
            Logger.instanse.verbose("begin", span, { collection: q.collectionname, user: user?.username, cls: "DatabaseConnection", func: "InsertOrUpdateOne" });
            await DatabaseConnection.InsertOrUpdateOneSemaphore.down();
            let query: any = null;
            if (q.uniqeness !== null && q.uniqeness !== undefined && q.uniqeness !== "" && q.uniqeness !== "_id") {
                query = {};
                const arr = q.uniqeness.split(",");
                arr.forEach(field => {
                    if (field.trim() !== "") {
                        query[field.trim()] = q.item[field.trim()];
                    }
                });
            } else {
                // has no id, and no uniqeness defined, so we assume its a new item we should insert
                if (q.item._id != null) {
                    query = { _id: q.item._id };
                }
            }

            if (user.dblocked && !user.HasRoleName(Wellknown.admins.name)) throw new Error("Access denied (db locked) could be due to hitting quota limit for " + user.username);
            let exists: Base[] = [];
            if (query != null) {
                exists = await this.query({ query, top: 2, collectionname: q.collectionname, jwt: q.jwt }, span);
            }
            if (exists.length === 1) {
                q.item._id = exists[0]._id;
            }
            else if (exists.length > 1) {
                Logger.instanse.verbose("query for existing", span, { collection: q.collectionname, user: user.username, cls: "DatabaseConnection", func: "InsertOrUpdateOne" });
                throw new Error(JSON.stringify(query) + " is not uniqe, more than 1 item in collection matches this");
            }
            if (!DatabaseConnection.hasAuthorization(user, q.item, Rights.update)) {
                Base.addRight(q.item, user._id, user.name, [Rights.full_control], false);
                this.ensureResource(q.item, q.collectionname);
            }

            if (exists.length === 1) {
                const uq = new UpdateOneMessage();
                uq.item = q.item; uq.collectionname = q.collectionname; uq.w = q.w; uq.j = q.j; uq.jwt = q.jwt;
                (uq as any).original = exists[0];
                const keys = Object.keys(exists[0]);
                for (let i = 0; i < keys.length; i++) {
                    let key = keys[i];
                    if (key.startsWith("_")) {
                        if (Util.IsNullUndefinded(uq.item[key])) uq.item[key] = exists[0][key];
                    }
                }
                Logger.instanse.debug("update entity " + uq.item._id + " " + uq.item.name, span, { collection: q.collectionname, user: user.username, cls: "DatabaseConnection", func: "InsertOrUpdateOne" });
                const uqres = await this._UpdateOne(uq, span);
                q.opresult = uqres.opresult;
                q.result = uqres.result;
                if (Util.IsNullUndefinded(uqres.result) && !Util.IsNullUndefinded(uqres.item)) {
                    q.result = uqres.item;
                }
            } else {
                if (q.collectionname === "openrpa_instances" && q.item._type === "workflowinstance") {
                    // Normally we need to remove _id to avoid unique constrains, but in this case we WANT to preserve the id
                } else {
                    delete q.item._id;
                }
                Logger.instanse.debug("insert new entity " + q.item.name, span, { collection: q.collectionname, user: user.username, cls: "DatabaseConnection", func: "InsertOrUpdateOne" });
                q.result = await this.InsertOne(q.item, q.collectionname, q.w, q.j, q.jwt, span);
            }
            return q;
        } finally {
            DatabaseConnection.InsertOrUpdateOneSemaphore.up();
            Logger.instanse.verbose("completed", span, { collection: q.collectionname, user: user?.username, cls: "DatabaseConnection", func: "InsertOrUpdateOne" });
            Logger.otel.endSpan(span);
        }
    }
    async InsertOrUpdateMany<T extends Base>(items: T[], collectionname: string, uniqeness: string, skipresults: boolean, w: number, j: boolean, jwt: string, parent: Span): Promise<T[]> {
        const span: Span = Logger.otel.startSubSpan("db.InsertOrUpdateMany", parent);
        let result: T[] = [];
        let errors: any[] = [];
        try {
            if (Util.IsNullUndefinded(items) || items.length == 0) { throw new Error("Cannot create null item"); }
            if (Util.IsNullEmpty(jwt)) {
                throw new Error("jwt is null");
            }
            if (collectionname == null || collectionname == "") throw new Error("collectionname is mandatory");
            await this.connect(span);
            const user = await Auth.Token2User(jwt, span);
            if (user == null) throw new Error("Access denied");
            if (user.dblocked && !user.HasRoleName(Wellknown.admins.name)) throw new Error("Access denied (db locked) could be due to hitting quota limit for " + user.username);
            span?.setAttribute("collection", collectionname);
            span?.setAttribute("username", user.username);
            Logger.instanse.verbose("received " + items.length + " items with uniqeness " + uniqeness, span, { collection: collectionname, user: user?.username, count: items.length, cls: "DatabaseConnection", func: "InsertOrUpdateMany" });


            let insert: T[] = [];
            let update: T[] = [];
            if (uniqeness !== null && uniqeness !== undefined && uniqeness !== "") {
                const arr = uniqeness.split(",");
                var ors = [];
                for (var i = 0; i < items.length; i++) {
                    const item = items[i];
                    let _query: any = null;
                    _query = {};
                    arr.forEach(field => {
                        if (field.trim() !== "") {
                            _query[field.trim()] = item[field.trim()];
                        }
                    });
                    ors.push(_query);
                }
                let query = { "$or": ors }
                let exists = await this.query({ query, collectionname, top: ors.length, jwt }, span);
                let Promises: Promise<any>[] = [];
                for (var i = 0; i < items.length; i++) {
                    let item: any = items[i];
                    let original: any = null;
                    for (var x = 0; x < exists.length; x++) {
                        let comp: any = exists[x];
                        let match: boolean = true;
                        for (let y = 0; y < arr.length; y++) {
                            const field = arr[y];
                            if (item[field] != comp[field]) { match = false; break; }
                        }
                        if (match) {
                            original = comp;
                            break;
                        }
                    }

                    if (original != null) {
                        var um = new UpdateOneMessage();
                        um.collectionname = collectionname;
                        um.jwt = jwt; um.j = j; um.w = w; um.item = item;
                        um.item._id = original._id;
                        (um as any).user = user;
                        (um as any).original = original;
                        Promises.push(this._UpdateOne(um, span));
                    } else {
                        insert.push(item);
                    }
                }

                if (Promises.length > 0) {
                    const tempresults = await Promise.all(Promises.map(p => p.catch(e => e)));
                    errors = errors.concat(tempresults.filter(result => Util.IsString(result) || (result instanceof Error)))
                    update = update.concat(tempresults.map(x => x.result));
                    result = result.concat(tempresults.map(x => x.result));
                }
            } else {
                let ids = items.filter(x => !Util.IsNullEmpty(x._id)).map(x => x._id);
                if (ids.length > 0) {
                    let query: any = { "_id": { "$in": ids } };
                    let exists = await this.query({ query, collectionname, top: ids.length, projection: { "_id": 1 }, jwt }, span);
                    ids = exists.map(x => x._id);
                    insert = insert.concat(items.filter(x => ids.indexOf(x._id) == -1));
                    update = update.concat(items.filter(x => ids.indexOf(x._id) > -1) as any);
                } else {
                    insert = insert.concat(items);
                }
                if (update.length > 0) {
                    let Promises: Promise<any>[] = [];
                    for (let i = 0; i < update.length; i++) {
                        var um = new UpdateOneMessage();
                        um.collectionname = collectionname;
                        um.jwt = jwt; um.j = j; um.w = w; um.item = update[i];
                        (um as any).user = user;
                        Promises.push(this._UpdateOne(um, span));
                    }
                    const tempresults = await Promise.all(Promises.map(p => p.catch(e => e)));
                    errors = errors.concat(tempresults.filter(result => Util.IsString(result) || (result instanceof Error)))
                    result = result.concat(tempresults.map(x => x.result));
                }
            }

            if (insert.length > 0) {
                let res = await this.InsertMany<T>(insert, collectionname, w, j, jwt, span);
                result = result.concat(res);
            }
            if (errors.length > 0) {
                throw errors[0];
            }
            Logger.instanse.debug("[" + user.username + "][" + collectionname + "] inserted " + insert.length + " items and updated " + update.length + " items in database", span, { collection: collectionname, user: user?.username, count: insert.length + update.length, cls: "DatabaseConnection", func: "InsertOrUpdateMany" });
        } finally {
            Logger.otel.endSpan(span);
        }
        return result;
    }
    private async _DeleteFile(id: string, collectionname: string): Promise<void> {
        return new Promise<void>(async (resolve, reject) => {
            try {
                const _id = new ObjectId(id);
                let bucketName = collectionname.substring(0, collectionname.indexOf(".files"));
                const bucket = new GridFSBucket(this.db, { bucketName });
                bucket.delete(_id, (error) => {
                    if (error) return reject(error);
                    resolve();
                })
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * @param  {string} id id of object to delete
     * @param  {string} collectionname collectionname Collection containing item
     * @param  {string} jwt JWT of user who is doing the delete, ensuring rights
     * @returns Promise<void>
     */
    async DeleteOne(id: string, collectionname: string, recursive: boolean, jwt: string, parent: Span): Promise<number> {
        if (id === null || id === undefined || id === "") { throw new Error("id cannot be null"); }
        const span: Span = Logger.otel.startSubSpan("db.DeleteOne", parent);
        try {
            if (collectionname == null || collectionname == "") throw new Error("collectionname is mandatory");
            await this.connect();
            const user: User = await Auth.Token2User(jwt, span);
            if (user == null) throw new Error("Access denied");
            let _query: any = {};
            // if (typeof id === "string" || id instanceof String) {
            //     _query = { $and: [{ _id: id }, this.getbasequery(user, [Rights.delete], collectionname)] };
            // } else {
            //     _query = { $and: [{ id }, this.getbasequery(user, [Rights.delete], collectionname)] };
            // }
            _query = { $and: [{ _id: id }, this.getbasequery(user, [Rights.delete], collectionname)] };
            if (collectionname == "audit") {
                if (!user.HasRoleId(Wellknown.admins._id)) {
                    throw new Error("Access denied");
                }
            }

            if (collectionname === "files") { collectionname = "fs.files"; }
            if (DatabaseConnection.usemetadata(collectionname)) {
                if (id.length == 12 || id.length == 24) {
                    const safeid = safeObjectID(id);
                    if (safeid != null) {
                        _query = { $and: [{ _id: safeObjectID(id) }, this.getbasequery(user, [Rights.delete], collectionname)] };
                    } else {
                        _query = { $and: [{ _id: id }, this.getbasequery(user, [Rights.delete], collectionname)] };
                    }
                } else {
                    _query = { $and: [{ _id: id }, this.getbasequery(user, [Rights.delete], collectionname)] };
                }
                const ot_end = Logger.otel.startTimer();
                const cursor = this.db.collection(collectionname).find(_query);
                const arr = await cursor.toArray();
                cursor.close();
                let ms = Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_query, DatabaseConnection.otel_label(collectionname, user, "query"));
                if (Config.log_database_queries && ms >= Config.log_database_queries_ms) {
                    Logger.instanse.debug("Query: " + JSON.stringify(_query), span, { collection: collectionname, user: user?.username, ms, count: arr.length, cls: "DatabaseConnection", func: "DeleteOne" });
                }
                if (arr.length === 1) {
                    // since admins by default can do everything using getbasequery, we need to check if the user really has delete
                    if (arr[0].metadata != null) {
                        if (!DatabaseConnection.hasAuthorization(user, arr[0].metadata, Rights.delete)) {
                            throw new Error(`[${user.name}] Access denied, missing delete permission`);
                        }
                    } else {
                        if (!DatabaseConnection.hasAuthorization(user, arr[0] as any, Rights.delete)) {
                            throw new Error(`[${user.name}] Access denied, missing delete permission`);
                        }
                    }
                    let cursor = this.db.collection("agents").find({ "fileid": id });
                    let locked = await cursor.hasNext();
                    if (locked) {
                        let item = await cursor.next();
                        throw new Error("Cannot delete file, it is in use by an agent " + item._id + " " + item.name);
                    }
                    cursor = this.db.collection("workitems").find({ "files._id": id });
                    locked = await cursor.hasNext();
                    if (locked) {
                        let item = await cursor.next();
                        throw new Error("Cannot delete file, it is in use by a workitem " + item._id + " " + item.name);
                    }

                    const ot_end = Logger.otel.startTimer();
                    await this._DeleteFile(id, collectionname);
                    Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_delete, DatabaseConnection.otel_label(collectionname, user, "delete"));
                    return 1;
                } else {
                    throw new Error("item not found, or Access Denied");
                }
            }
            Logger.instanse.verbose("[" + user.username + "][" + collectionname + "] Deleting " + id + " in database", span, { collection: collectionname, user: user?.username, cls: "DatabaseConnection", func: "DeleteOne" });
            const cursor = this.db.collection(collectionname).find(_query);
            const docs = await cursor.toArray();
            cursor.close();
            for (let i = 0; i < docs.length; i++) {
                if (!DatabaseConnection.hasAuthorization(user, docs[0] as any, Rights.delete)) {
                    throw new Error(`[${user.name}] Access denied, missing delete permission`);
                }
                // @ts-ignore
                let doc: Customer = docs[i];
                if (collectionname == "users" && doc._type == "user") {
                    const count = await Resources.GetUserResourcesCount(doc._id, span);
                    if (count > 0) throw new Error("Access Denied, cannot delete user with active resourceusage");
                }
                if (collectionname == "users" && doc._type == "customer") {
                    const count = await Resources.GetCustomerResourcesCount(doc._id, span);
                    if (count > 0) throw new Error("Access Denied, cannot delete customer with active resourceusage");
                    const subsubcursor = this.db.collection("users").find({ "customerid": doc._id });
                    let userdocs = await subsubcursor.toArray();
                    subsubcursor.close();
                    if (doc.userid != user._id) {
                        if (userdocs.length > 0 && !Config.cleanup_on_delete_customer && !recursive) {
                            // @ts-ignore
                            let defaulttest = userdocs.filter(x => x._id != doc.users && x._id != doc.admins && x._id != doc.userid)
                            if (defaulttest.length > 0) {
                                throw new Error("Access Denied, cannot delete customer with active user or roles (" + defaulttest[0].name + "/" + defaulttest[0]._id + ")");
                            }
                        }
                        if (Config.cleanup_on_delete_customer || recursive) {
                            Logger.instanse.warn("Cleaning up after up after company " + doc.name, span, { collection: collectionname, user: user?.username, cls: "DatabaseConnection", func: "DeleteOne" });
                            let collections = await Logger.DBHelper.GetCollections(span);
                            collections = collections.filter(x => x.name.indexOf("system.") === -1 && x.type == "collection"
                                && !x.name.endsWith(".chunks") && x.name != "audit" && !x.name.endsWith("_hist")
                                && x.name != "mailhist" && x.name != "dbusage" && x.name != "domains" && x.name != "config"
                                && x.name != "oauthtokens" && x.name != "users");
                            for (let i = 0; i < collections.length; i++) {
                                let collection = collections[i];
                                var res = await this.DeleteMany({}, null, collection.name, doc._id, false, jwt, span);
                                Logger.instanse.info("Deleted " + res + " items from " + collection.name + " cleaning up after company " + doc.name, span, { collection: collectionname, user: user?.username, count: res, cls: "DatabaseConnection", func: "DeleteOne" });
                            }
                        }
                        for (let i = 0; i < userdocs.length; i++) {
                            await this.DeleteOne(userdocs[i]._id.toString(), "users", recursive, jwt, span);
                        }
                    } else {
                        if (userdocs.length > 0) {
                            throw new Error("Access Denied, cannot delete customer with active user or roles (" + userdocs[0].name + "/" + userdocs[0]._id + ")");
                        }
                    }
                }

                const _skip_array: string[] = Config.skip_history_collections.split(",");
                const skip_array: string[] = [];
                _skip_array.forEach(x => skip_array.push(x.trim()));
                if (skip_array.indexOf(collectionname) == -1 && !DatabaseConnection.usemetadata(collectionname)) {
                    (doc as any)._deleted = new Date(new Date().toISOString());
                    (doc as any)._deletedby = user.name;
                    (doc as any)._deletedbyid = user._id;
                    const fullhist = {
                        _acl: doc._acl,
                        _type: doc._type,
                        _modified: doc._modified,
                        _modifiedby: doc._modifiedby,
                        _modifiedbyid: doc._modifiedbyid,
                        _created: doc._modified,
                        _createdby: doc._modifiedby,
                        _createdbyid: doc._modifiedbyid,
                        _deleted: (doc as any)._deleted,
                        _deletedby: (doc as any)._deletedby,
                        _deletedbyid: (doc as any)._deletedbyid,
                        name: doc.name,
                        id: doc._id,
                        item: doc,
                        _version: doc._version,
                        reason: (doc as any).reason
                    }
                    await this.db.collection(collectionname + "_hist").insertOne(fullhist);
                }
                const ot_end = Logger.otel.startTimer();
                await this.db.collection(collectionname).deleteOne({ _id: doc._id });
                Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_delete, DatabaseConnection.otel_label(collectionname, user, "delete"));
                if (collectionname == "users" && doc._type == "user") {
                    const names: string[] = [];
                    names.push(doc.name + "noderedadmins"); names.push(doc.name + "noderedusers"); names.push(doc.name + "nodered api users")
                    const cursor = this.db.collection("users").find({ "name": { "$in": names }, "_type": "role" });
                    const subdocs = await cursor.toArray();
                    cursor.close();
                    for (var r of subdocs) {
                        this.DeleteOne(r._id.toString(), "users", false, jwt, span);
                    }
                    if (Config.cleanup_on_delete_user || recursive) {
                        let skip_collections = [];
                        if (!Util.IsNullEmpty(Config.housekeeping_skip_collections)) skip_collections = Config.housekeeping_skip_collections.split(",")

                        let collections = await Logger.DBHelper.GetCollections(span);
                        collections = collections.filter(x => x.name.indexOf("system.") === -1 && x.type == "collection"
                            && !x.name.endsWith(".chunks") && x.name != "audit" && !x.name.endsWith("_hist")
                            && x.name != "mailhist" && x.name != "dbusage" && x.name != "domains" && x.name != "config"
                            && x.name != "oauthtokens" && x.name != "users");
                        for (let i = 0; i < collections.length; i++) {
                            let collection = collections[i];
                            if (skip_collections.indexOf(collection.name) > -1) {
                                Logger.instanse.info("skipped " + collection.name + " due to housekeeping_skip_collections setting", span, { collection: collectionname, user: user?.username, cls: "DatabaseConnection", func: "DeleteOne" });
                                continue;
                            }
                            let startTime = new Date();
                            var res = await this.DeleteMany({ "$or": [{ "_createdbyid": doc._id }, { "_modifiedbyid": doc._id }] }, null, collection.name, doc._id, false, jwt, span);
                            // @ts-ignore
                            var timeDiff = ((new Date()) - startTime); //in ms
                            Logger.instanse.info("Deleted " + res + " items from " + collection.name + " cleaning up after user " + doc.name + " (" + timeDiff + "ms)", span, { collection: collectionname, user: user?.username, count: res, cls: "DatabaseConnection", func: "DeleteOne" });
                        }

                    }
                }
                if (collectionname == "users" && doc._type == "customer") {
                    const cursor = this.db.collection("config").find({ "customerid": doc._id });
                    const subdocs = await cursor.toArray();
                    cursor.close();
                    for (var r of subdocs) {
                        this.DeleteOne(r._id.toString(), "config", false, jwt, span);
                    }
                }
                await Logger.DBHelper.CheckCache(collectionname, doc, false, false, span);
            }
        } finally {
            Logger.otel.endSpan(span);
        }
        return 1;
    }

    /**
     * @param  {string} id id of object to delete
     * @param  {string} collectionname collectionname Collection containing item
     * @param  {string} jwt JWT of user who is doing the delete, ensuring rights
     * @returns Promise<void>
     */
    async DeleteMany(query: string | any, ids: string[], collectionname: string, queryas: string, recursive: boolean, jwt: string, parent: Span): Promise<number> {
        if (Util.IsNullUndefinded(ids) && Util.IsNullUndefinded(query)) { throw new Error("id cannot be null"); }
        const span: Span = Logger.otel.startSubSpan("db.DeleteMany", parent);
        try {
            if (collectionname == null || collectionname == "") throw new Error("collectionname is mandatory");
            await this.connect();
            const user: User = await Auth.Token2User(jwt, span);
            if (user == null) throw new Error("Access denied");

            let baseq: any = {};
            if (collectionname === "files") { collectionname = "fs.files"; }
            if (DatabaseConnection.usemetadata(collectionname)) {
                let impersonationquery;
                if (!Util.IsNullEmpty(queryas)) impersonationquery = await this.getbasequeryuserid(user, queryas, [Rights.delete], collectionname, span);
                if (!Util.IsNullEmpty(queryas) && !Util.IsNullUndefinded(impersonationquery)) {
                    baseq = impersonationquery;
                } else {
                    baseq = this.getbasequery(user, [Rights.delete], collectionname);
                }
            } else {
                let impersonationquery: any;
                if (!Util.IsNullEmpty(queryas)) impersonationquery = await this.getbasequeryuserid(user, queryas, [Rights.delete], collectionname, span)
                if (!Util.IsNullEmpty(queryas) && !Util.IsNullUndefinded(impersonationquery)) {
                    baseq = impersonationquery;
                } else {
                    baseq = this.getbasequery(user, [Rights.delete], collectionname);
                }
            }
            let _query: any = {};
            if (Util.IsNullUndefinded(query) && !Util.IsNullUndefinded(ids)) {
                let objectids = [];
                if (collectionname == "files" || collectionname == "fs.files") {
                    for (let i = 0; i < ids.length; i++) {
                        try {
                            if (ids[i] != null && ids[i].trim() != "") objectids.push(safeObjectID(ids[i]))
                        } catch (error) {
                            Logger.instanse.error(error, span, { cls: "DatabaseConnection", func: "DeleteMany" });
                        }
                    }
                } else {
                    for (let i = 0; i < ids.length; i++) {
                        try {
                            if (ids[i] != null && ids[i].trim() != "") objectids.push(ids[i])
                        } catch (error) {
                            Logger.instanse.error(error, span, { cls: "DatabaseConnection", func: "DeleteMany" });
                        }
                    }
                }
                _query = { $and: [{ _id: { "$in": objectids } }, baseq] };
            } else if (!Util.IsNullUndefinded(query)) {
                if (query !== null && query !== undefined) {
                    let json: any = query;
                    if (typeof json !== "string" && !(json instanceof String)) {
                        json = JSON.stringify(json, (key, value) => {
                            if (value instanceof RegExp)
                                return ("__REGEXP " + value.toString());
                            else
                                return value;
                        });
                    }
                    query = JSON.parse(json, (key, value) => {
                        if (typeof value === "string" && value.match(isoDatePattern)) {
                            return new Date(value); // isostring, so cast to js date
                        } else if (value != null && value != undefined && value.toString().indexOf("__REGEXP ") === 0) {
                            const m = value.split("__REGEXP ")[1].match(/\/(.*)\/(.*)?/);
                            return new RegExp(m[1], m[2] || "");
                        } else
                            return value; // leave any other value as-is
                    });
                    const keys: string[] = Object.keys(query);
                    for (let key of keys) {
                        if (key === "_id") {
                            const id: string = query._id;
                            if (id.length == 12 || id.length == 24) {
                                const safeid = safeObjectID(id);
                                if (safeid !== null && safeid !== undefined) {
                                    delete query._id;
                                    query.$or = [{ _id: id }, { _id: safeObjectID(id) }];
                                }
                            }
                        }
                    }
                }
                _query = { $and: [query, baseq] };
            } else {
                throw new Error("DeleteMany needs either a list of ids or a query");
            }

            const _skip_array: string[] = Config.skip_history_collections.split(",");
            const skip_array: string[] = [];
            _skip_array.forEach(x => skip_array.push(x.trim()));

            if (collectionname === "files") { collectionname = "fs.files"; }
            if (DatabaseConnection.usemetadata(collectionname)) {
                const ot_end = Logger.otel.startTimer();
                let ms = Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_query, DatabaseConnection.otel_label(collectionname, user, "query"));
                let deletecounter = 0;
                if (collectionname.endsWith(".files") || collectionname == "files") {
                    const cursor = await this.db.collection(collectionname).find(_query)
                    if (Config.log_database_queries && ms >= Config.log_database_queries_ms) {
                        Logger.instanse.debug("Query: " + JSON.stringify(_query), span, { collection: collectionname, user: user?.username, ms, cls: "DatabaseConnection", func: "DeleteMany" });
                    } else {
                        Logger.instanse.debug("Deleting multiple files in database", span, { collection: collectionname, user: user?.username, ms, cls: "DatabaseConnection", func: "DeleteMany" });
                    }
                    for await (const c of cursor) {
                        deletecounter++;
                        const ot_end = Logger.otel.startTimer();
                        try {
                            await this._DeleteFile(c._id.toString(), collectionname);
                        } catch (error) {
                        }
                        Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_deletemany, DatabaseConnection.otel_label(collectionname, user, "deletemany"));
                    }
                    cursor.close();
                } else {
                    if (Config.log_database_queries && ms >= Config.log_database_queries_ms) {
                        Logger.instanse.debug("Query: " + JSON.stringify(_query), span, { collection: collectionname, user: user?.username, ms, cls: "DatabaseConnection", func: "DeleteMany" });
                    } else {
                        Logger.instanse.debug("Deleting multiple files in database", span, { collection: collectionname, user: user?.username, ms, cls: "DatabaseConnection", func: "DeleteMany" });
                    }
                    _query = { $and: [query, this.getbasequery(user, [Rights.delete], collectionname)] };
                    var result = await this.db.collection(collectionname).deleteMany(_query);
                    deletecounter = result.deletedCount;
                }
                Logger.instanse.verbose("deleted " + deletecounter + " files in database", span, { collection: collectionname, user: user?.username, ms, count: deletecounter, cls: "DatabaseConnection", func: "DeleteMany" });
                return deletecounter;
            } else if (recursive && !Util.IsNullUndefinded(ids) && ids.length > 0) {
                for (let i = 0; i < ids.length; i++) {
                    await this.DeleteOne(ids[i], collectionname, recursive, jwt, span);
                }
                return ids.length;
            } else {
                let bulkInsert = this.db.collection(collectionname + "_hist").initializeUnorderedBulkOp();
                let bulkRemove = this.db.collection(collectionname).initializeUnorderedBulkOp()
                const x = 1000
                let counter = 0
                const date = new Date()
                date.setMonth(date.getMonth() - 1)

                var addToHist = false;
                if (skip_array.indexOf(collectionname) == -1) {
                    if (!collectionname.endsWith("_hist")) addToHist = true;
                }
                if (DatabaseConnection.istimeseries(collectionname)) {
                    addToHist = false;
                }


                Logger.instanse.verbose("quering items to delete from " + collectionname, span, { collection: collectionname, user: user?.username, cls: "DatabaseConnection", func: "DeleteMany" });
                const qot_end = Logger.otel.startTimer();
                const cursor = await this.db.collection(collectionname).find(_query);
                let ms = Logger.otel.endTimer(qot_end, DatabaseConnection.mongodb_query, DatabaseConnection.otel_label(collectionname, user, "query"));
                if (Config.log_database_queries && ms >= Config.log_database_queries_ms) {
                    Logger.instanse.debug("Query: " + JSON.stringify(_query), span, { collection: collectionname, user: user?.username, ms, cls: "DatabaseConnection", func: "DeleteMany" });
                }
                for await (const c of cursor) {
                    const doc = c;
                    const fullhist = {
                        _acl: doc._acl,
                        _type: doc._type,
                        _modified: doc._modified,
                        _modifiedby: doc._modifiedby,
                        _modifiedbyid: doc._modifiedbyid,
                        _created: doc._modified,
                        _createdby: doc._modifiedby,
                        _createdbyid: doc._modifiedbyid,
                        _deleted: new Date(new Date().toISOString()),
                        _deletedby: user.name,
                        _deletedbyid: user._id,
                        name: doc.name,
                        id: doc._id,
                        item: doc,
                        _version: doc._version,
                        reason: doc.reason
                    }
                    if (addToHist) bulkInsert.insert(fullhist);
                    bulkRemove.find({ _id: doc._id }).deleteOne();
                    counter++
                    // @ts-ignore
                    var insertCount = bulkInsert.length;
                    // @ts-ignore
                    var removeCount = bulkRemove.length;
                    if (counter % x === 0) {
                        if (insertCount > 0) {
                            Logger.instanse.verbose("Inserting " + bulkInsert.addToOperationsList.length + " items into " + collectionname + "_hist", span, { collection: collectionname, user: user?.username, count: insertCount, cls: "DatabaseConnection", func: "DeleteMany" });
                            const ot_end = Logger.otel.startTimer();
                            bulkInsert.execute()
                            Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_insertmany, DatabaseConnection.otel_label(collectionname + "_hist", user, "insertmany"));
                            bulkInsert = this.db.collection(collectionname + "_hist").initializeUnorderedBulkOp()
                        }
                        if (removeCount > 0) {
                            Logger.instanse.verbose("Deleting " + bulkRemove.addToOperationsList.length + " items from " + collectionname, span, { collection: collectionname, user: user?.username, count: removeCount, cls: "DatabaseConnection", func: "DeleteMany" });
                            const ot_end = Logger.otel.startTimer();
                            bulkRemove.execute()
                            Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_deletemany, DatabaseConnection.otel_label(collectionname, user, "deletemany"));
                            bulkRemove = this.db.collection(collectionname).initializeUnorderedBulkOp()
                        }
                    }
                }
                cursor.close();
                // @ts-ignore
                var insertCount = bulkInsert.length;
                // @ts-ignore
                var removeCount = bulkRemove.length;
                if (insertCount > 0 || removeCount > 0) {
                    if (insertCount > 0) {
                        Logger.instanse.verbose("Inserting " + bulkInsert.addToOperationsList.length + " items into " + collectionname + "_hist", span, { collection: collectionname, user: user?.username, count: insertCount, cls: "DatabaseConnection", func: "DeleteMany" });
                        const ot_end = Logger.otel.startTimer();
                        bulkInsert.execute()
                        Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_insertmany, DatabaseConnection.otel_label(collectionname + "_hist", user, "insertmany"));
                    }
                    if (removeCount > 0) {
                        Logger.instanse.verbose("Deleting " + bulkRemove.addToOperationsList.length + " items from " + collectionname, span, { collection: collectionname, user: user?.username, count: removeCount, cls: "DatabaseConnection", func: "DeleteMany" });
                        const ot_end = Logger.otel.startTimer();
                        bulkRemove.execute()
                        Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_deletemany, DatabaseConnection.otel_label(collectionname, user, "deletemany"));
                    }
                }

                Logger.instanse.verbose("deleted " + counter + " items in database", span, { collection: collectionname, user: user?.username, cls: "DatabaseConnection", func: "DeleteMany" });
                return counter;
            }
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    /**
     * Helper function used to check if field needs to be encrypted
     * @param  {string[]} keys List of fields that needs to be encrypted
     * @param  {string} key Current field
     * @param  {object=null} value value of field, ensuring we can actully encrypt the field
     * @returns boolean
     */
    private _shouldEncryptValue(keys: string[], key: string, value: object = null): boolean {
        const shouldEncryptThisKey: boolean = keys.includes(key);
        return value && shouldEncryptThisKey;
    }
    _encryptentity(item, newObj, key) {
        let value: any = item[key];
        try {
            if (this._shouldEncryptValue(item._encrypt, key, (value as any))) {
                if (typeof value === "string") {
                    newObj[key] = Crypt.encrypt(value);
                } else {
                    const tempvalue: any = JSON.stringify(value);
                    newObj[key] = Crypt.encrypt(tempvalue);
                }
            } else {
                newObj[key] = value;
            }
        } catch (error) {
            var errormessage = error.message ? error.message : error;
            Logger.instanse.debug(errormessage, null, { cls: "DatabaseConnection", func: "_encryptentity" });
            newObj[key] = value;
        }
        return newObj;
    }
    /**
     * Enumerate object, encrypting fields that needs to be encrypted
     * @param  {T} item Item to enumerate
     * @returns T Object with encrypted fields
     */
    public encryptentity(item: Base): Base {
        if (Util.IsNullUndefinded(item) || Util.IsNullUndefinded(item._encrypt) || Util.IsNullUndefinded(item._encrypt)) { return item; }
        const me: DatabaseConnection = this;
        return (Object.keys(item).reduce((newObj, key) => { return this._encryptentity(item, newObj, key) }, item) as Base);
    }
    _decryptentity(item, newObj, key) {
        const value: any = item[key];
        try {
            if (this._shouldEncryptValue(item._encrypt, key, value) && value != null && value != "") {
                let newvalue = Crypt.decrypt(value);
                if (newvalue.indexOf("{") === 0 || newvalue.indexOf("[") === 0) {
                    try {
                        newvalue = JSON.parse(newvalue);
                    } catch (error) {
                    }
                }
                newObj[key] = newvalue;
            } else {
                newObj[key] = value;
            }
        } catch (error) {
            var errormessage = error.message ? error.message : error;
            Logger.instanse.debug(errormessage, null, { cls: "DatabaseConnection", func: "_decryptentity" });
            newObj[key] = value;
        }
        return newObj;
    }
    /**
     * Enumerate object, decrypting fields that needs to be decrypted
     * @param  {T} item Item to enumerate
     * @returns T Object with decrypted fields
     */
    public decryptentity<T extends Base>(item: T): T {
        if (Util.IsNullUndefinded(item) || Util.IsNullUndefinded(item._encrypt) || Util.IsNullUndefinded(item._encrypt)) { return item; }
        const me: DatabaseConnection = this;
        return (Object.keys(item).reduce((newObj, key) => { return this._decryptentity(item, newObj, key); }, {}) as T);
    }
    /**
     * Create a MongoDB query filtering result based on permission of current user and requested permission
     * @param  {string} jwt JWT of the user creating the query
     * @param  {number[]} bits Permission wanted on objects
     * @returns Object MongoDB query
     */
    public getbasequery(user: TokenUser | User, bits: number[], collectionname: string): Object {
        let field = "_acl";
        var bypassquery: any = {}
        if (collectionname == null || collectionname == "") throw new Error("collectionname is mandatory");
        if (user == null) throw new Error("user is mandatory");
        if (bits == null || bits.length == 0) throw new Error("bits is mandatory");
        if (DatabaseConnection.usemetadata(collectionname)) {
            field = DatabaseConnection.metadataname(collectionname) + "._acl";
        }
        if (Config.api_bypass_perm_check) {
            return bypassquery;
        }
        if (user._id === Wellknown.root._id) {
            return bypassquery;
        }
        const isme: any[] = [];
        const q = {};
        for (let i: number = 0; i < bits.length; i++) {
            bits[i]--; // bitwize matching is from offset 0, when used on bindata
        }
        var hasadmin = user.roles.find(x => x._id == Wellknown.admins._id);
        if (hasadmin != null) return bypassquery;
        if (field.indexOf("metadata") > -1) { // do always ?
            // timeseries does not support $elemMatch on "metadata" fields
            q[field + "._id"] = user._id
            q[field + ".rights"] = { $bitsAllSet: bits }
            isme.push(q);
            user.roles.forEach(role => {
                var subq = {}
                subq[field + "._id"] = role._id
                subq[field + ".rights"] = { $bitsAllSet: bits }
                isme.push(subq);
            });
            return { $or: isme };
        }
        isme.push({ _id: user._id });
        user.roles.forEach(role => {
            isme.push({ _id: role._id });
        });
        const finalor: any[] = [];
        // todo: add check for deny's
        q[field] = {
            $elemMatch: {
                rights: { $bitsAllSet: bits },
                $or: isme
            }
        };
        finalor.push(q);
        return { $or: finalor.concat() };
    }
    private async getbasequeryuserid(calluser: TokenUser | User, userid: string, bits: number[], collectionname: string, parent: Span): Promise<Object> {
        let user: User = await this.getbyid(userid, "users", Crypt.rootToken(), true, parent);
        if (Util.IsNullUndefinded(user)) return null;
        if (collectionname == null || collectionname == "") throw new Error("collectionname is mandatory");
        if (user._type == "user" || user._type == "role") {
            user = await Logger.DBHelper.DecorateWithRoles(user as any, parent);
            return this.getbasequery(user, bits, collectionname);
        } else if (user._type == "customer") {
            let customer = user as any as Customer;
            if (user.roles == null) user.roles = [];
            user.roles.push(new Rolemember(user.name + " users", customer.users))
            user.roles.push(new Rolemember(user.name + " admins", customer.admins))
            let users = await Logger.DBHelper.FindRoleById(customer.users, Crypt.rootToken(), parent);
            let admins = await Logger.DBHelper.FindRoleById(customer.admins, Crypt.rootToken(), parent);
            for (let i = 0; i < users.members.length; i++) {
                const exists = user.roles.filter(x => x._id == users.members[i]._id);
                if (exists.length == 0) {
                    user.roles.push(new Rolemember(users.members[i].name, users.members[i]._id))
                }
            }
            for (let i = 0; i < admins.members.length; i++) {
                const exists = user.roles.filter(x => x._id == admins.members[i]._id);
                if (exists.length == 0 && admins.members[i]._id != Wellknown.customer_admins._id) {
                    user.roles.push(new Rolemember(admins.members[i].name, admins.members[i]._id))
                }
            }
            return this.getbasequery(user, bits, collectionname);

        } else if (user._type == "workspace") {
            let workspace = user as any as Workspace;
            if (user.roles == null) user.roles = [];
            user.roles.push(new Rolemember(user.name + " users", workspace.users))
            user.roles.push(new Rolemember(user.name + " admins", workspace.admins))
            let users = await Logger.DBHelper.FindRoleById(workspace.users, Crypt.rootToken(), parent);
            let admins = await Logger.DBHelper.FindRoleById(workspace.admins, Crypt.rootToken(), parent);
            for (let i = 0; i < users.members.length; i++) {
                const exists = user.roles.filter(x => x._id == users.members[i]._id);
                if (exists.length == 0) {
                    user.roles.push(new Rolemember(users.members[i].name, users.members[i]._id))
                }
            }
            for (let i = 0; i < admins.members.length; i++) {
                const exists = user.roles.filter(x => x._id == admins.members[i]._id);
                if (exists.length == 0 && admins.members[i]._id != Wellknown.workspace_admins._id) {
                    user.roles.push(new Rolemember(admins.members[i].name, admins.members[i]._id))
                }

            }
            return this.getbasequery(user, bits, collectionname);
        }
    }
    /**
     * Ensure _type and _acs on object
     * @param  {T} item Object to validate
     * @returns T Validated object
     */
    ensureResource<T extends Base>(item: T, collectionname: string): T {
        if (collectionname == null || collectionname == "") throw new Error("collectionname is mandatory");
        if (item == null) throw new Error("item is mandatory");
        if (!DatabaseConnection.istimeseries(collectionname)) {
            if (!item.hasOwnProperty("_type") || item._type == null || item._type == "") {
                item._type = "unknown";
            }
            item._type = item._type.toLowerCase();
        }
        if (!item._acl) { item._acl = []; }
        if (item._acl.length === 0) {
            Base.addRight(item, Wellknown.admins._id, Wellknown.admins.name, [Rights.full_control]);
        }
        if (Config.force_add_admins && item._id != Wellknown.root._id) {
            Base.addRight(item, Wellknown.admins._id, Wellknown.admins.name, [Rights.full_control], false);
        }
        if (DatabaseConnection.collections_with_text_index.indexOf(collectionname) > -1) {
            var _searchnames = [];
            var _searchname = "";
            for (var i = 0; i < Config.text_index_name_fields.length; i++) {
                var field = Config.text_index_name_fields[i];
                if (Array.isArray(item[field])) {
                    for (var y = 0; y < item[field].length; y++) {
                        try {
                            if (!Util.IsNullEmpty(item[field][y])) {
                                var name: string = item[field][y].toLowerCase();
                                name = name.replace(/[.*!#"'`|%$@+\-?^${}()|[\]\\]/g, " ").trim();
                                _searchnames = _searchnames.concat(name.split(" "));
                                _searchnames.push(name);
                                if (name != item[field][y].toLowerCase()) _searchnames.push(item[field][y].toLowerCase());
                            }
                        } catch (error) {
                            Logger.instanse.error(error, null, { cls: "DatabaseConnection", func: "ensureResource" });
                        }
                    }
                } else {
                    if (!Util.IsNullEmpty(item[field])) {
                        try {
                            var name: string = item[field].toLowerCase();
                            name = name.replace(/[.*!#"'`|%$@+\-?^${}()|[\]\\]/g, " ").trim();
                            if (field == "name") _searchname = name.toLowerCase();
                            _searchnames = _searchnames.concat(name.split(" "));
                            _searchnames.push(name);
                            if (name != item[field].toLowerCase()) _searchnames.push(item[field].toLowerCase());
                        } catch (error) {
                            Logger.instanse.error(error, null, { cls: "DatabaseConnection", func: "ensureResource" });
                        }
                    }
                }
            }
            (item as any)._searchnames = _searchnames;
            (item as any)._searchname = _searchname;
        }
        return item;
    }
    async CheckEntityRestriction(user: TokenUser | User, collectionname: string, item: Base, parent: Span): Promise<boolean> {
        if (!Config.enable_entity_restriction) return true;
        if (collectionname == null || collectionname == "") throw new Error("collectionname is mandatory");
        if (item == null) throw new Error("item is mandatory");
        if (user == null) throw new Error("user is mandatory");
        var EntityRestrictions = await Logger.DBHelper.GetEntityRestrictions(parent);
        const defaultAllow: boolean = false;
        let result: boolean = false;
        const authorized = EntityRestrictions.filter(x => x.IsAuthorized(user) && (x.collection == collectionname || x.collection == ""));
        const matches = authorized.filter(x => x.IsMatch(item) && (x.collection == collectionname || x.collection == ""));
        const copyperm = matches.filter(x => x.copyperm && (x.collection == collectionname || x.collection == ""));
        if (!defaultAllow && matches.length == 0) return false; // no hits, if not allowed return false
        if (matches.length > 0) result = true;

        for (let cr of copyperm) {
            for (let a of cr._acl) {
                let bits = [];
                for (let i = 0; i < 10; i++) {
                    if (Ace.isBitSet(a, i)) bits.push(i);

                }
                Base.addRight(item, a._id, a.name, bits, false);
            }
        }
        return result;
    }
    /**
     * Validated user has rights to perform the requested action ( create is missing! )
     * @param  {TokenUser} user User requesting permission
     * @param  {any} item Item permission is needed on
     * @param  {Rights} action Permission wanted (create, update, delete)
     * @returns boolean Is allowed
     */
    static hasAuthorization(user: TokenUser | User, item: Base, action: number): boolean {
        if (Config.api_bypass_perm_check) { return true; }
        if (user == null) throw new Error("user is mandatory");
        if (item == null) throw new Error("item is mandatory");
        if (action == null) throw new Error("action is mandatory");
        if (user._id === Wellknown.root._id) { return true; }
        if (action === Rights.update && item._id === Wellknown.admins._id && item.name.toLowerCase() !== Wellknown.admins.name) {
            return false;
        }
        if (action === Rights.update && item._id === Wellknown.users._id && item.name.toLowerCase() !== Wellknown.users.name) {
            return false;
        }
        if (action === Rights.update && item._id === Wellknown.root._id && item.name.toLowerCase() !== Wellknown.root.name) {
            return false;
        }
        if (item._type == "user" || item._type == "role") {
            if (item.name.toLowerCase() == Wellknown.root.name && item._id != Wellknown.root._id) return false;
            if (item.name.toLowerCase() == Wellknown.admins.name && item._id != Wellknown.admins._id) return false;
            if (item.name.toLowerCase() == Wellknown.users.name && item._id != Wellknown.users._id) return false;
            if (item.name.toLowerCase() == Wellknown.nodered_users.name && item._id != Wellknown.nodered_users._id) return false;
            if (item.name.toLowerCase() == Wellknown.nodered_admins.name && item._id != Wellknown.nodered_admins._id) return false;
            if (item.name.toLowerCase() == Wellknown.nodered_api_users.name && item._id != Wellknown.nodered_api_users._id) return false;
            if (item.name.toLowerCase() == Wellknown.filestore_users.name && item._id != Wellknown.filestore_users._id) return false;
            if (item.name.toLowerCase() == Wellknown.filestore_admins.name && item._id != Wellknown.filestore_admins._id) return false;
            if (item.name.toLowerCase() == Wellknown.robot_users.name && item._id != Wellknown.robot_users._id) return false;
            if (item.name.toLowerCase() == Wellknown.robot_admins.name && item._id != Wellknown.robot_admins._id) return false;
            if (item.name.toLowerCase() == Wellknown.personal_nodered_users.name && item._id != Wellknown.personal_nodered_users._id) return false;
            if (item.name.toLowerCase() == Wellknown.robot_agent_users.name && item._id != Wellknown.robot_agent_users._id) return false;
            if (item.name.toLowerCase() == Wellknown.customer_admins.name && item._id != Wellknown.customer_admins._id) return false;
            if (item.name.toLowerCase() == Wellknown.resellers.name && item._id != Wellknown.resellers._id) return false;
            if (item.name.toLowerCase() == Wellknown.guest.name && item._id != Wellknown.guest._id) return false;
            if (item.name.toLowerCase() == Wellknown.workitem_queue_users.name && item._id != Wellknown.workitem_queue_users._id) return false;
            if (item.name.toLowerCase() == Wellknown.workitem_queue_admins.name && item._id != Wellknown.workitem_queue_admins._id) return false;
            if (item.name.toLowerCase() != Wellknown.root.name && item._id == Wellknown.root._id) return false;
            if (item.name.toLowerCase() != Wellknown.admins.name && item._id == Wellknown.admins._id) return false;
            if (item.name.toLowerCase() != Wellknown.users.name && item._id == Wellknown.users._id) return false;
            if (item.name.toLowerCase() != Wellknown.nodered_users.name && item._id == Wellknown.nodered_users._id) return false;
            if (item.name.toLowerCase() != Wellknown.nodered_admins.name && item._id == Wellknown.nodered_admins._id) return false;
            if (item.name.toLowerCase() != Wellknown.nodered_api_users.name && item._id == Wellknown.nodered_api_users._id) return false;
            if (item.name.toLowerCase() != Wellknown.filestore_users.name && item._id == Wellknown.filestore_users._id) return false;
            if (item.name.toLowerCase() != Wellknown.filestore_admins.name && item._id == Wellknown.filestore_admins._id) return false;
            if (item.name.toLowerCase() != Wellknown.robot_users.name && item._id == Wellknown.robot_users._id) return false;
            if (item.name.toLowerCase() != Wellknown.robot_admins.name && item._id == Wellknown.robot_admins._id) return false;
            if (item.name.toLowerCase() != Wellknown.personal_nodered_users.name && item._id == Wellknown.personal_nodered_users._id) return false;
            if (item.name.toLowerCase() != Wellknown.robot_agent_users.name && item._id == Wellknown.robot_agent_users._id) return false;
            if (item.name.toLowerCase() != Wellknown.customer_admins.name && item._id == Wellknown.customer_admins._id) return false;
            if (item.name.toLowerCase() != Wellknown.resellers.name && item._id == Wellknown.resellers._id) return false;
            if (item.name.toLowerCase() != Wellknown.guest.name && item._id == Wellknown.guest._id) return false;
            if (item.name.toLowerCase() != Wellknown.workitem_queue_users.name && item._id == Wellknown.workitem_queue_users._id) return false;
            if (item.name.toLowerCase() != Wellknown.workitem_queue_admins.name && item._id == Wellknown.workitem_queue_admins._id) return false;
            if (DatabaseConnection.WellknownNamesArray.indexOf(item.name.toLowerCase()) > -1) {
                if (DatabaseConnection.WellknownIdsArray.indexOf(item._id) == -1) return false;
            }
        }
        if (item._id === user._id) {
            if (action === Rights.delete) {
                Logger.instanse.error("hasAuthorization, cannot delete self!", null, {
                    user: user?.username,
                    cls: "DatabaseConnection", func: "hasAuthorization"
                }); return false;
            };
            return true;
        }

        if (item._acl != null && item._acl != undefined && Array.isArray(item._acl)) {
            if (typeof item._acl === "string" || item._acl instanceof String) {
                item._acl = JSON.parse((item._acl as any));
            }

            const a = item._acl.filter(x => x._id === user._id);
            if (a.length > 0) {
                if (Ace.isBitSet(a[0], action)) return true;
            }
            for (let i = 0; i < user.roles.length; i++) {
                const b = item._acl.filter(x => x._id === user.roles[i]._id);
                if (b.length > 0) {
                    if (Ace.isBitSet(b[0], action)) return true;
                }
            }
            return false;
        }
        return true;
    }
    public static replaceAll(target, search, replacement) {
        return target.split(search).join(replacement);
    };
    /**
     * Helper function to clean item before saving in MongoDB ( normalize ACE rights and remove illegal key $$ )
     * @param  {object} o Item to clean
     * @returns void Clean object
     */
    public static traversejsonencode(o) {
        const reISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}(?:\.\d*))(?:Z|(\+|-)([\d|:]*))?$/;
        const reMsAjax = /^\/Date\((d|-|.*)\)[\/|\\]$/;
        if (o == null) return;
        const keys = Object.keys(o);
        for (let i = 0; i < keys.length; i++) {
            let key = keys[i];
            let value = o[key];
            if (typeof value === "string") {
                const a = reISO.exec(value);
                if (a) {
                    o[key] = new Date(value);
                } else {
                    const c = reMsAjax.exec(value);
                    if (c) {
                        const b = c[1].split(/[-+,.]/);
                        o[key] = new Date(b[0] ? +b[0] : 0 - +b[1]);
                    }
                }
            }
            if (key.indexOf(".") > -1) {
                try {
                    const newkey = this.replaceAll(key, ".", "____");
                    o[newkey] = o[key];
                    delete o[key];
                    key = newkey;
                } catch (error) {
                }
            }
            if (key.startsWith("$$")) {
                delete o[key];
            } else if (o[key]) {
                if (typeof o[key] === "string") {
                    if (o[key].length === 24 && o[key].endsWith("Z")) {
                        try {
                            o[key] = new Date(o[key]);
                        } catch (error) {

                        }
                    }
                }
                if (typeof (o[key]) === "object") {
                    this.traversejsonencode(o[key]);
                }
            }

        }

    }
    public static traversejsondecode(o) {
        if (o == null) return;
        const keys = Object.keys(o);
        for (let i = 0; i < keys.length; i++) {
            let key = keys[i];
            if (key.indexOf("____") > -1) {
                try {
                    const newkey = this.replaceAll(key, "____", ".");
                    o[newkey] = o[key];
                    delete o[key];
                    key = newkey;
                } catch (error) {
                }
            }
            if (key.startsWith("$$")) {
                delete o[key];
            } else if (o[key]) {
                if (typeof o[key] === "string") {
                    if (o[key].length === 24 && o[key].endsWith("Z")) {
                        try {
                            o[key] = new Date(o[key]);
                        } catch (error) {

                        }
                    }
                }
                if (typeof (o[key]) === "object") {
                    this.traversejsondecode(o[key]);
                }
            }

        }

    }
    async SaveUpdateDiff<T extends Base>(q: UpdateOneMessage, user: TokenUser | User, parent: Span) {
        const span: Span = Logger.otel.startSubSpan("db.SaveUpdateDiff", parent);
        try {
            const _skip_array: string[] = Config.skip_history_collections.split(",");
            const skip_array: string[] = [];
            _skip_array.forEach(x => skip_array.push(x.trim()));
            if (skip_array.indexOf(q.collectionname) > -1) { return 0; }
            const res = await this.query<T>({ query: q.query, top: 1, collectionname: q.collectionname, jwt: q.jwt }, span);
            let name: string = "unknown";
            let _id: string = "";
            let _version = 1;
            if (res.length > 0) {
                const original = res[0];
                name = original.name;
                _id = original._id;
                delete original._modifiedby;
                delete original._modifiedbyid;
                delete original._modified;
                if (original._version != undefined && original._version != null) {
                    _version = original._version + 1;
                }
            }
            const updatehist = {
                _modified: new Date(new Date().toISOString()),
                _modifiedby: user.name,
                _modifiedbyid: user._id,
                _created: new Date(new Date().toISOString()),
                _createdby: user.name,
                _createdbyid: user._id,
                name: name,
                id: _id,
                update: JSON.stringify(q.item),
                _version: _version,
                reason: ""
            }
            const ot_end = Logger.otel.startTimer();
            const mongodbspan: Span = Logger.otel.startSubSpan("mongodb.insertOne", span);
            mongodbspan.setAttribute("collection", q.collectionname + "_hist");
            this.db.collection(q.collectionname + "_hist").insertOne(updatehist).then(() => {
                Logger.otel.endSpan(mongodbspan);
                Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_insert, DatabaseConnection.otel_label(q.collectionname + "_hist", user, "insert"));
            }).catch(err => {
                Logger.instanse.error(err, mongodbspan, { cls: "DatabaseConnection", func: "SaveUpdateDiff" });
                Logger.otel.endSpan(mongodbspan);
                Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_insert, DatabaseConnection.otel_label(q.collectionname + "_hist", user, "insert"));
            });
        } catch (error) {
            Logger.instanse.error(error, span, { collection: q.collectionname, user: user?.username, cls: "DatabaseConnection", func: "SaveUpdateDiff" });
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    visit(obj: any, func: any) {
        for (const k in obj) {
            func(obj, k);
            if (typeof obj[k] === "object") {
                this.visit(obj[k], func);
            }
        }
    }
    async SaveDiff(collectionname: string, original: any, item: any, parent: Span) {
        const span: Span = Logger.otel.startSubSpan("db.SaveDiff", parent);
        const roundDown = function (num, precision): number {
            num = parseFloat(num);
            if (!precision) return num;
            return (Math.floor(num / precision) * precision);
        };
        if (item._type === "instance" && collectionname === "workflows") return 0;

        let roughObjSize1 = -1;
        let roughObjSize2 = -1;
        if (original != null) roughObjSize1 = JSON.stringify(original).length;
        if (item != null) roughObjSize2 = JSON.stringify(item).length;
        try {
            if (roughObjSize1 > Config.history_obj_max_kb_size * 1024) {
                Logger.instanse.error("SaveDiff1: object too large, skipping diff for " + collectionname + " " + item._id + " " + roughObjSize1, span, { cls: "DatabaseConnection", func: "SaveDiff" });
                return item._version;
            }
            if (roughObjSize2 > Config.history_obj_max_kb_size * 1024) {
                Logger.instanse.error("SaveDiff2: object too large, skipping diff for " + collectionname + " " + item._id + " " + roughObjSize2, span, { cls: "DatabaseConnection", func: "SaveDiff" });
                return item._version;
            }
        } catch (error) {
            return 0;
        }


        if (!original && item._id) {
            const rootjwt = Crypt.rootToken()
            const current = await this.getbyid(item._id, collectionname, rootjwt, true, span);
            if (current && current._version > 0) {
                original = await this.GetDocumentVersion({ collectionname, id: item._id, version: current._version - 1, jwt: rootjwt }, span);
            }
        }

        delete item._skiphistory;
        const _modified = item._modified;
        const _modifiedby = item._modifiedby;
        const _modifiedbyid = item._modifiedbyid;
        let _version = 0;
        const _acl = item._acl;
        const _type = item._type;
        const reason = item._updatereason;
        const lastseen = item.lastseen;
        try {
            const _skip_array: string[] = Config.skip_history_collections.split(",");
            const skip_array: string[] = [];
            _skip_array.forEach(x => skip_array.push(x.trim()));
            if (skip_array.indexOf(collectionname) > -1) { return 0; }

            if (original != null) {
                delete original._modifiedby;
                delete original._modifiedbyid;
                delete original._modified;
                delete original.lastseen;
                if (original._version != undefined && original._version != null) {
                    _version = original._version + 1;
                }
            }
            let delta: any = null;

            item._version = _version;
            delete item._modifiedby;
            delete item._modifiedbyid;
            delete item._modified;
            delete item._updatereason;
            delete item.lastseen;
            this.visit(item, (obj, k) => {
                if (typeof obj[k] === "function") {
                    delete obj[k];
                }
            });
            if (original != null && original._version === 0) {
                const fullhist = {
                    _acl: _acl,
                    _type: _type,
                    _modified: _modified,
                    _modifiedby: _modifiedby,
                    _modifiedbyid: _modifiedbyid,
                    _created: _modified,
                    _createdby: _modifiedby,
                    _createdbyid: _modifiedbyid,
                    name: original.name,
                    id: original._id,
                    item: original,
                    _version: 0,
                    reason: reason
                }
                const ot_end = Logger.otel.startTimer();
                const mongodbspan: Span = Logger.otel.startSubSpan("mongodb.insertOne", span);
                mongodbspan.setAttribute("collection", collectionname + "_hist");
                this.db.collection(collectionname + "_hist").insertOne(fullhist).then(() => {
                    Logger.otel.endSpan(mongodbspan);
                    Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_insert, DatabaseConnection.otel_label(collectionname + "_hist", Crypt.rootUser(), "insert"));
                }).catch(err => {
                    Logger.instanse.error(err, mongodbspan, { cls: "DatabaseConnection", func: "SaveDiff" });
                    Logger.otel.endSpan(mongodbspan);
                    Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_insert, DatabaseConnection.otel_label(collectionname + "_hist", Crypt.rootUser(), "insert"));
                });
            }
            if (original != null && original._version >= 0) {
                delta = jsondiffpatch.diff(original, item);
                if (Util.IsNullUndefinded(delta)) return 0;
                const keys = Object.keys(delta);
                if (keys.length > 1) {
                    const deltahist = {
                        _acl: _acl,
                        _type: _type,
                        _modified: _modified,
                        _modifiedby: _modifiedby,
                        _modifiedbyid: _modifiedbyid,
                        _created: _modified,
                        _createdby: _modifiedby,
                        _createdbyid: _modifiedbyid,
                        name: item.name,
                        id: item._id,
                        item: undefined,
                        delta: delta,
                        _version: _version,
                        reason: reason
                    }
                    const baseversion = roundDown(_version, Config.history_delta_count);
                    if (baseversion === _version) {
                        deltahist.item = original;
                    }
                    const ot_end = Logger.otel.startTimer();
                    const mongodbspan: Span = Logger.otel.startSubSpan("mongodb.insertOne", span);
                    mongodbspan.setAttribute("collection", collectionname + "_hist");
                    this.db.collection(collectionname + "_hist").insertOne(deltahist).then(() => {
                        Logger.otel.endSpan(mongodbspan);
                        Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_insert, DatabaseConnection.otel_label(collectionname + "_hist", Crypt.rootUser(), "insert"));
                    }).catch(err => {
                        Logger.instanse.error(err, mongodbspan, { cls: "DatabaseConnection", func: "SaveDiff" });
                        Logger.otel.endSpan(mongodbspan);
                        Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_insert, DatabaseConnection.otel_label(collectionname + "_hist", Crypt.rootUser(), "insert"));
                    });
                } else {
                    _version--;
                    if (_version < 0) _version = 0;
                    item._version = _version;
                }
            }

            item._modifiedby = _modifiedby;
            item._modifiedbyid = _modifiedbyid;
            item._modified = _modified;
            if (lastseen !== null && lastseen !== undefined) {
                item.lastseen = lastseen;
            }
        } catch (error) {
            Logger.instanse.error(error, span, { collection: collectionname, user: item?._modifiedby, cls: "DatabaseConnection", func: "SaveDiff" });
        } finally {
            Logger.otel.endSpan(span);
        }
        return _version;
    }
    async createIndex(collectionname: string, name: string, keypath: any, options: any, parent: Span) {
        const span: Span = Logger.otel.startSubSpan("db.createIndex", parent);
        return new Promise<string>((resolve, reject) => {
            try {
                Logger.instanse.info("Adding index " + name + " to " + collectionname, span, { collection: collectionname, cls: "DatabaseConnection", func: "createIndex" });
                if (typeof keypath === "string") keypath = JSON.parse(keypath);
                if (Util.IsNullEmpty(options)) options = {};
                if (typeof options === "string") options = JSON.parse(options);
                if (!Util.IsNullEmpty(name)) options["name"] = name;
                this.db.collection(collectionname).createIndex(keypath, options, (err, name) => {
                    if (err) {
                        Logger.instanse.error(err, span, { collection: collectionname, cls: "DatabaseConnection", func: "createIndex" });
                        Logger.otel.endSpan(span);
                        reject(err);
                        return;
                    }
                    Logger.otel.endSpan(span);
                    resolve(name);
                })
            } catch (error) {
                Logger.instanse.error(error, span, { collection: collectionname, cls: "DatabaseConnection", func: "createIndex" });
                Logger.otel.endSpan(span);
                reject(error);
            }
        });
    }
    async deleteIndex(collectionname: string, name: string, parent: Span) {
        const span: Span = Logger.otel.startSubSpan("db.deleteIndex", parent);
        return new Promise((resolve, reject) => {
            try {
                Logger.instanse.info("Dropping index " + name + " in " + collectionname, span, { collection: collectionname, cls: "DatabaseConnection", func: "deleteIndex" });
                this.db.collection(collectionname).dropIndex(name, (err, name) => {
                    if (err) {
                        Logger.instanse.error(err, span, { collection: collectionname, cls: "DatabaseConnection", func: "deleteIndex" });
                        Logger.otel.endSpan(span);
                        reject(err);
                        return;
                    }
                    Logger.otel.endSpan(span);
                    resolve(name);
                })
            } catch (error) {
                Logger.instanse.error(error, span, { collection: collectionname, cls: "DatabaseConnection", func: "deleteIndex" });
                Logger.otel.endSpan(span);
                reject(error);
            }
        });
    }
    private async ParseTimeseries(span: Span) {
        Logger.instanse.debug("Parse timeseries collections", span, { cls: "DatabaseConnection", func: "ParseTimeseries" });
        span?.addEvent("Get collections");
        let collections = await Logger.DBHelper.GetCollections(span);
        collections = collections.filter(x => x.name.indexOf("system.") === -1);
        collections = collections.filter(x => x.type == "timeseries");

        DatabaseConnection.timeseries_collections = [];
        DatabaseConnection.timeseries_collections_metadata = {};
        for (let i = 0; i < collections.length; i++) {
            var collection = collections[i];
            DatabaseConnection.timeseries_collections = DatabaseConnection.timeseries_collections.filter(x => x != collection.name);
            DatabaseConnection.timeseries_collections.push(collection.name);
            if (collection.options && collection.options.timeseries) {
                DatabaseConnection.timeseries_collections_metadata[collection.name] = collection.options.timeseries.metaField;
                DatabaseConnection.timeseries_collections_time[collection.name] = collection.options.timeseries.timeField;
            }
        }
    }
    static istimeseries(collectionname: string) {
        if (DatabaseConnection.timeseries_collections.indexOf(collectionname) > -1) {
            return true;
        }
        return false;
    }
    static usemetadata(collectionname: string) {
        if (collectionname == "files" || collectionname.endsWith(".files") || collectionname.endsWith(".chunks")) {
            return true;
        }
        if (collectionname == "fullDocument._acl") return true;
        const metadataname = DatabaseConnection.timeseries_collections_metadata[collectionname];
        if (metadataname == "metadata") return true;
        return false;
    }
    static metadataname(collectionname: string) {
        if (collectionname == "files" || collectionname.endsWith(".files") || collectionname.endsWith(".chunks")) {
            return "metadata";
        }
        if (collectionname == "fullDocument._acl") return "fullDocument._acl";
        const metadataname = DatabaseConnection.timeseries_collections_metadata[collectionname];
        return metadataname;
    }
    static timefield(collectionname: string) {
        if (collectionname == "files" || collectionname.endsWith(".files") || collectionname.endsWith(".chunks")) {
            return "_created";
        }
        if (collectionname == "fullDocument._acl") return "fullDocument._created";
        const timefield = DatabaseConnection.timeseries_collections_time[collectionname];
        return timefield;
    }
    public static collections_with_text_index: string[] = [];
    public static timeseries_collections: string[] = [];
    public static timeseries_collections_metadata: any = {};
    public static timeseries_collections_time: any = {};
    private async UpdateIndexTypes(parent: Span) {
        try {
            let collections = await DatabaseConnection.toArray(this.db.listCollections());
            collections = collections.filter(x => x.name.indexOf("system.") === -1);

            DatabaseConnection.timeseries_collections = [];
            for (let i = 0; i < collections.length; i++) {
                var collection = collections[i];
                if (collection.type == "timeseries") {
                    DatabaseConnection.timeseries_collections = DatabaseConnection.timeseries_collections.filter(x => x != collection.name);
                    DatabaseConnection.timeseries_collections.push(collection.name);
                }
            }
            DatabaseConnection.timeseries_collections = [];
            DatabaseConnection.collections_with_text_index = [];
            for (let i = 0; i < collections.length; i++) {
                var collection = collections[i];
                if (collection.type == "timeseries") {
                    DatabaseConnection.timeseries_collections = DatabaseConnection.timeseries_collections.filter(x => x != collection.name);
                    DatabaseConnection.timeseries_collections.push(collection.name);
                }
                if (collection.type != "collection" && collection.type != "timeseries") continue;
                parent?.addEvent("Get indexes for " + collection.name);
                const indexes = await this.db.collection(collection.name).indexes();
                for (let y = 0; y < indexes.length; y++) {
                    var idx = indexes[y];
                    if (idx.textIndexVersion && idx.textIndexVersion > 1 && !collection.name.endsWith(".files")) {
                        DatabaseConnection.collections_with_text_index = DatabaseConnection.collections_with_text_index.filter(x => x != collection.name);
                        DatabaseConnection.collections_with_text_index.push(collection.name);
                    }
                }
            }
            await this.ParseTimeseries(parent);
        } catch (error) {
        }
    }
    async ensureindexes(parent: Span) {
        const span: Span = Logger.otel.startSubSpan("db.ensureindexes", parent);
        try {
            span?.addEvent("Get collections");
            if (!Config.ensure_indexes) {
                await this.UpdateIndexTypes(span);
                return;
            }
            Logger.instanse.info("Begin validating indexes, this might take a while", span, { cls: "DatabaseConnection", func: "ensureindexes" });
            let collections = await DatabaseConnection.toArray(this.db.listCollections());
            collections = collections.filter(x => x.name.indexOf("system.") === -1);

            for (let i = 0; i < collections.length; i++) {
                try {
                    const collection = collections[i];
                    if (collection.type != "collection") continue;
                    if (collection.name.endsWith(".chunks") || collection.name.endsWith(".files")) continue;
                    span?.addEvent("Get indexes for " + collection.name);
                    const indexes = await this.db.collection(collection.name).indexes();
                    const indexnames = indexes.map(x => x.name);
                    if (DatabaseConnection.collections_with_text_index.indexOf(collection.name) > -1) {
                        if (DatabaseConnection.usemetadata(collection.name)) {
                            if (indexnames.indexOf("metadata_searchnames_1") === -1) {
                                await this.createIndex(collection.name, "metadata_searchnames_1", { "metadata._searchnames": 1 }, null, span)
                            }
                            if (indexnames.indexOf("metadata_searchname_1") === -1) {
                                await this.createIndex(collection.name, "metadata_searchname_1", { "metadata._searchname": 1 }, null, span)
                            }
                            //
                        } else {
                            if (indexnames.indexOf("_searchnames_1") === -1) {
                                await this.createIndex(collection.name, "_searchnames_1", { "_searchnames": 1 }, null, span)
                            }
                            if (indexnames.indexOf("_searchname_1") === -1) {
                                await this.createIndex(collection.name, "_searchname_1", { "_searchname": 1 }, null, span)
                            }
                        }
                    }
                    if (collection.name.endsWith("_hist")) {
                        if (indexnames.indexOf("id_1__version_-1") === -1) {
                            await this.createIndex(collection.name, "id_1__version_-1", { "id": 1, "_version": -1 }, null, span)
                        }
                        if (indexnames.indexOf("_deleted") === -1) {
                            await this.createIndex(collection.name, "_deleted", { "_deleted": 1 }, null, span)
                        }
                        if (indexnames.indexOf("_acl") === -1) {
                            await this.createIndex(collection.name, "_acl", { "_acl._id": 1, "_acl.rights": 1, "_acl.deny": 1 }, null, span)
                        }
                    } else {
                        switch (collection.name) {
                            case "workflow":
                                break;
                            case "openrpa_instances":
                                if (indexnames.indexOf("_created_1") === -1) {
                                    await this.createIndex(collection.name, "_created_1", { "_created": 1 }, null, span)
                                }
                                if (indexnames.indexOf("_modified_1") === -1) {
                                    await this.createIndex(collection.name, "_modified_1", { "_modified": 1 }, null, span)
                                }
                                if (indexnames.indexOf("InstanceId_1_WorkflowId_1") === -1) {
                                    await this.createIndex(collection.name, "InstanceId_1_WorkflowId_1", { "WorkflowId": 1, "InstanceId": 1, "_acl.deny": 1 }, null, span)
                                }
                                if (indexnames.indexOf("state_1") === -1) {
                                    await this.createIndex(collection.name, "state_1", { "state": 1 }, null, span)
                                }
                                if (indexnames.indexOf("fqdn_1") === -1) {
                                    await this.createIndex(collection.name, "fqdn_1", { "fqdn": 1 }, null, span)
                                }
                                if (indexnames.indexOf("_acl") === -1) {
                                    await this.createIndex(collection.name, "_acl", { "_acl._id": 1, "_acl.rights": 1, "_acl.deny": 1 }, null, span)
                                }
                                break;
                            case "workflow_instances":
                                if (indexnames.indexOf("_created_1") === -1) {
                                    await this.createIndex(collection.name, "_created_1", { "_created": 1 }, null, span)
                                }
                                if (indexnames.indexOf("_acl") === -1) {
                                    await this.createIndex(collection.name, "_acl", { "_acl._id": 1, "_acl.rights": 1, "_acl.deny": 1 }, null, span)
                                }
                                break;
                            case "audit":
                                if (!DatabaseConnection.usemetadata("audit")) {
                                    if (indexnames.indexOf("_type_1") === -1) {
                                        await this.createIndex(collection.name, "_type_1", { "_type": 1 }, null, span)
                                    }
                                    if (indexnames.indexOf("_created_1") === -1) {
                                        await this.createIndex(collection.name, "_created_1", { "_created": 1 }, null, span)
                                    }
                                    if (indexnames.indexOf("_acl") === -1) {
                                        await this.createIndex(collection.name, "_acl", { "_acl._id": 1, "_acl.rights": 1, "_acl.deny": 1 }, null, span)
                                    }
                                    if (indexnames.indexOf("userid_1") === -1) {
                                        await this.createIndex(collection.name, "userid_1", { "userid": 1 }, null, span)
                                    }
                                }
                                break;
                            case "users":
                                if (indexnames.indexOf("_created_1") === -1) {
                                    await this.createIndex(collection.name, "_created_1", { "_created": 1 }, null, span)
                                }
                                // if (indexnames.indexOf("unique_username_1") === -1) {
                                //     await this.createIndex(collection.name, "unique_username_1", { "username": 1 },
                                //         { "unique": true, "name": "unique_username_1", "partialFilterExpression": { "_type": "user" } }, span)
                                // }
                                if (indexnames.indexOf("members._id_1") === -1) {
                                    await this.createIndex(collection.name, "members._id_1", { "members._id": 1 },
                                        { "partialFilterExpression": { "_type": "role" } }, span)
                                }
                                break;
                            case "openrpa":
                                if (indexnames.indexOf("_type_projectid_name_1") === -1) {
                                    await this.createIndex(collection.name, "_type_projectid_name_1", { _type: 1, "{projectid:-1,name:-1}": 1 }, null, span)
                                }
                                break;
                            case "dbusage":
                                if (!DatabaseConnection.usemetadata("audit")) {
                                    if (indexnames.indexOf("collection_1_timestamp_1_userid_1") === -1) {
                                        await this.createIndex(collection.name, "collection_1_timestamp_1_userid_1", { _type: 1, "{collection:1,timestamp:1,userid:1}": 1 }, null, span)
                                    }
                                    if (indexnames.indexOf("timestamp_1_userid_1") === -1) {
                                        await this.createIndex(collection.name, "timestamp_1_userid_1", { _type: 1, "{timestamp:1,userid:1}": 1 }, null, span)
                                    }
                                    if (indexnames.indexOf("timestamp_1") === -1) {
                                        await this.createIndex(collection.name, "timestamp_1", { _type: 1, "{timestamp:1}": 1 }, null, span)
                                    }
                                }
                                break;
                            case "workitems":
                                if (indexnames.indexOf("_acl") === -1) {
                                    await this.createIndex(collection.name, "_acl", { "_acl._id": 1, "_acl.rights": 1, "_acl.deny": 1 }, null, span)
                                }
                                if (indexnames.indexOf("_type_1_wiq_1") === -1) {
                                    await this.createIndex(collection.name, "_type_1_wiq_1", { "_type": 1, "wiq": 1 }, null, span)
                                }
                                if (indexnames.indexOf("_type_1_wiqid_1") === -1) {
                                    await this.createIndex(collection.name, "_type_1_wiqid_1", { "_type": 1, "wiqid": 1 }, null, span)
                                }
                                if (indexnames.indexOf("_type_1_state_1_wiqid_1_priority_1") === -1) {
                                    await this.createIndex(collection.name, "_type_1_state_1_wiqid_1_priority_1", { "_type": 1, "state": 1, "wiqid": 1, "priority": 1 }, null, span)
                                }
                                if (indexnames.indexOf("_type_1_state_1_wiq_1_lastrun_") > -1) {
                                    await this.deleteIndex(collection.name, "_type_1_state_1_wiq_1_lastrun_", span);
                                }
                                if (indexnames.indexOf("_type_1_state_1_wiq_1_lastrun_-1") === -1) {
                                    await this.createIndex(collection.name, "_type_1_state_1_wiq_1_lastrun_-1", { "_type": 1, "state": 1, "wiq": 1, "lastrun": -1 }, null, span)
                                }
                                if (indexnames.indexOf("_type_1__created_-1") === -1) {
                                    await this.createIndex(collection.name, "_type_1__created_-1", { "_type": 1, "_created": -1 }, null, span)
                                }
                                if (indexnames.indexOf("_type_1_state_1__created_-1") === -1) {
                                    await this.createIndex(collection.name, "_type_1_state_1__created_-1", { "_type": 1, "state": 1, "_created": -1 }, null, span)
                                }
                                if (indexnames.indexOf("unique_slug_1") > -1) {
                                    await this.deleteIndex(collection.name, "unique_slug_1", span);
                                }
                                break;
                            case "agents":
                                if (indexnames.indexOf("unique_slug_1") === -1) {
                                    await this.createIndex(collection.name, "unique_slug_1", { "slug": 1 },
                                        { "unique": true, "name": "unique_slug_1", "partialFilterExpression": { "_type": "agent" } }, span)
                                }
                            default:
                                break;
                        }
                    }
                } catch (error) {
                    Logger.instanse.error(error, span, { cls: "DatabaseConnection", func: "ensureindexes" });
                }
            }

            span?.addEvent("Get collections");
            collections = await DatabaseConnection.toArray(this.db.listCollections());
            collections = collections.filter(x => x.name.indexOf("system.") === -1);

            await this.UpdateIndexTypes(span);
            Logger.instanse.info("completed", span, { cls: "DatabaseConnection", func: "ensureindexes" });
        } catch (error) {
            Logger.instanse.error(error, span, { cls: "DatabaseConnection", func: "ensureindexes" });
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    static otel_label(collectionname: string, user: TokenUser | User, action: "query" | "count" | "aggregate" | "insert" | "insertmany" | "update" | "updatemany" | "replace" | "delete" | "deletemany") {
        if (Config.otel_trace_mongodb_per_users) {
            return { collection: collectionname, username: user.username };
        } else if (Config.otel_trace_mongodb_query_per_users && action == "query") {
            return { collection: collectionname, username: user.username };
        } else if (Config.otel_trace_mongodb_count_per_users && action == "count") {
            return { collection: collectionname, username: user.username };
        } else if (Config.otel_trace_mongodb_aggregate_per_users && action == "aggregate") {
            return { collection: collectionname, username: user.username };
        } else if (Config.otel_trace_mongodb_insert_per_users && (action == "insert" || action == "insertmany")) {
            return { collection: collectionname, username: user.username };
        } else if (Config.otel_trace_mongodb_update_per_users && (action == "replace" || action == "update" || action == "updatemany")) {
            return { collection: collectionname, username: user.username };
        } else if (Config.otel_trace_mongodb_delete_per_users && (action == "delete" || action == "deletemany")) {
            return { collection: collectionname, username: user.username };
        } else {
            return { collection: collectionname };
        }
    }
    public async GetResource(resourcename: string, parent: Span): Promise<Resource> {
        let _resources: Resource[] = await Logger.DBHelper.GetResources(parent);
        _resources = _resources.filter(x => x.name == resourcename);
        if (_resources.length == 0) return null;
        return _resources[0]
    }
    public async GetProductResourceCustomerUsage(resourcename: string, stripeprice: string, customerid: string, parent: Span): Promise<ResourceUsage> {
        let assigned: ResourceUsage[] = await Logger.DBHelper.GetResourceUsageByCustomerID(customerid, parent);
        assigned = assigned.filter(x => x.resource == resourcename && x.product.stripeprice == stripeprice);
        if (assigned.length == 0) return null; // No found
        if (assigned[0].siid == null || assigned[0].siid == "") return null;  // Not completed payment
        if (assigned[0].quantity == 0) return null; // No longer assigned
        return assigned[0]
    }
}

export declare type DistinctOptions = {
    jwt: string;
    query: any;
    field: string;
    collectionname: string;
    queryas?: string;
};
export declare type opresult = {
    ok: number;
    n: number;
    nModified: number;
    modifiedCount: number;
    matchedCount: number;
    insertedCount: number;
    upsertedCount: number;
}