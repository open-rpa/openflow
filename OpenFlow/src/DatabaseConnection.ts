import { MongoClient, ObjectId, Db, Binary, GridFSBucket, ChangeStream, MongoClientOptions, AggregateOptions, InsertOneOptions, InsertOneResult, UpdateOptions } from "mongodb";
import { Crypt } from "./Crypt";
import { Config, dbConfig } from "./Config";
import { TokenUser, Base, WellknownIds, Rights, NoderedUtil, mapFunc, finalizeFunc, reduceFunc, Ace, UpdateOneMessage, UpdateManyMessage, InsertOrUpdateOneMessage, Role, Rolemember, User, Customer, WatchEventMessage, Workitem, WorkitemQueue, QueryOptions, CountOptions } from "@openiap/openflow-api";
import { OAuthProvider } from "./OAuthProvider";
import { ObservableUpDownCounter, Histogram } from "@opentelemetry/api-metrics"
import { Span } from "@opentelemetry/api";
import { Logger } from "./Logger";
const { JSONPath } = require('jsonpath-plus');
import events = require("events");
import { amqpwrapper } from "./amqpwrapper";
import { WebSocketServer } from "./WebSocketServer";
import { clsstream } from "./WebSocketServerClient";
import { SocketMessage } from "./SocketMessage";
import { LoginProvider } from "./LoginProvider";
import { WebServer } from "./WebServer";

// tslint:disable-next-line: typedef
const safeObjectID = (s: string | number | ObjectId) => ObjectId.isValid(s) ? new ObjectId(s) : null;
const isoDatePattern = new RegExp(/\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z)/);
const jsondiffpatch = require('jsondiffpatch').create({
    objectHash: function (obj, index) {
        // try to find an id property, otherwise just use the index in the array
        return obj.name || obj.id || obj._id || '$$index:' + index;
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
    // public static ot_mongodb_query_count: Counter;
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

    // public static semaphore = Auth.Semaphore(1);

    public registerGlobalWatches: boolean = true;
    public queuemonitoringhandle: NodeJS.Timeout = null;
    public queuemonitoringpaused: boolean = false;
    public queuemonitoringlastrun: Date = new Date();
    constructor(mongodburl: string, dbname: string, registerGlobalWatches: boolean) {
        super();
        this._dbname = dbname;
        this.mongodburl = mongodburl;
        this.setMaxListeners(1500);
        if (!NoderedUtil.IsNullEmpty(registerGlobalWatches)) this.registerGlobalWatches = registerGlobalWatches;

        if (!NoderedUtil.IsNullUndefinded(Logger.otel) && !NoderedUtil.IsNullUndefinded(Logger.otel.meter)) {
            DatabaseConnection.mongodb_query = Logger.otel.meter.createHistogram('openflow_mongodb_query_seconds', {
                description: 'Duration for mongodb queries', valueType: 1, unit: 's'
            });
            DatabaseConnection.mongodb_count = Logger.otel.meter.createHistogram('openflow_mongodb_count_seconds', {
                description: 'Duration for mongodb counts', valueType: 1, unit: 's'
            });            
            // valueType: ValueType.DOUBLE
            DatabaseConnection.mongodb_aggregate = Logger.otel.meter.createHistogram('openflow_mongodb_aggregate_seconds', {
                description: 'Duration for mongodb aggregates', valueType: 1, unit: 's'
            });
            DatabaseConnection.mongodb_insert = Logger.otel.meter.createHistogram('openflow_mongodb_insert_seconds', {
                description: 'Duration for mongodb inserts', valueType: 1, unit: 's'
            });
            DatabaseConnection.mongodb_insertmany = Logger.otel.meter.createHistogram('openflow_mongodb_insertmany_seconds', {
                description: 'Duration for mongodb insert many', valueType: 1, unit: 's'
            });
            DatabaseConnection.mongodb_update = Logger.otel.meter.createHistogram('openflow_mongodb_update_seconds', {
                description: 'Duration for mongodb updates', valueType: 1, unit: 's'
            });
            DatabaseConnection.mongodb_updatemany = Logger.otel.meter.createHistogram('openflow_mongodb_updatemany_seconds', {
                description: 'Duration for mongodb update many', valueType: 1, unit: 's'
            });
            DatabaseConnection.mongodb_replace = Logger.otel.meter.createHistogram('openflow_mongodb_replace_seconds', {
                description: 'Duration for mongodb replaces', valueType: 1, unit: 's'
            });
            DatabaseConnection.mongodb_delete = Logger.otel.meter.createHistogram('openflow_mongodb_delete_seconds', {
                description: 'Duration for mongodb deletes', valueType: 1, unit: 's'
            });
            DatabaseConnection.mongodb_deletemany = Logger.otel.meter.createHistogram('openflow_mongodb_deletemany_seconds', {
                description: 'Duration for mongodb deletemanys', valueType: 1, unit: 's'
            });
            DatabaseConnection.mongodb_active_sessions = Logger.otel.meter.createObservableUpDownCounter('openflow_mongodb_active_sessions', {
                description: 'Number of active mongodb sessions'
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
            if (!NoderedUtil.IsNullUndefinded(this.queuemonitoringhandle)) {
                clearTimeout(this.queuemonitoringhandle);
            }
            if (this.cli) {
                this.cli.removeAllListeners();
                await this.cli.close(true);
            }
        } catch (error) {
            Logger.instanse.error("DatabaseConnection", "shutdown", error);
        }
    }
    public replicat: string = null;
    public streams: clsstream[] = [];
    /**
     * Connect to MongoDB
     * @returns Promise<void>
     */
    async connect(parent: Span = undefined): Promise<void> {
        if (this.cli !== null && this.cli !== undefined && this.isConnected) {
            return;
        }
        const span: Span = Logger.otel.startSubSpan("db.connect", parent);
        this.streams = [];
        span?.addEvent("connecting to mongodb");
        Logger.instanse.info("DatabaseConnection", "connect", "Connecting to mongodb");
        const options: MongoClientOptions = { minPoolSize: Config.mongodb_minpoolsize, maxPoolSize: Config.mongodb_maxpoolsize };
        this.cli = await MongoClient.connect(this.mongodburl, options);
        Logger.instanse.info("DatabaseConnection", "connect", "Connected to mongodb");
        span?.addEvent("Connected to mongodb");

        Logger.instanse.silly("DatabaseConnection", "connect", "Really connected to mongodb");
        const errEvent = (error) => {
            this.isConnected = false;
            Logger.instanse.error("DatabaseConnection", "connect", error);
            this.emit("disconnected");
        }
        const closeEvent = () => {
            this.isConnected = false;
            Logger.instanse.silly("DatabaseConnection", "connect", "Disconnected from mongodb");
            this.emit("disconnected");
        }
        this.cli
            .on('error', errEvent)
            .on('parseError', errEvent)
            .on('timeout', errEvent)
            .on('close', closeEvent);
        this.db = this.cli.db(this._dbname);
        try {
            var topology = (this.cli as any).topology;
            if (topology.s.description.type == "Single" || topology.s.description.type == "single") {
                Config.supports_watch = false;
            } else {
                Config.supports_watch = true;
            }
        } catch (error) {
            Logger.instanse.error("DatabaseConnection", "connect", error);
        }
        Logger.instanse.debug("DatabaseConnection", "connect", "supports_watch: " + Config.supports_watch);
        if (Config.supports_watch) {
            let collections = await DatabaseConnection.toArray(this.db.listCollections());
            collections = collections.filter(x => x.name.indexOf("system.") === -1);

            if (this.registerGlobalWatches) {
                for (var c = 0; c < collections.length; c++) {
                    if (collections[c].type != "collection") continue;
                    if (collections[c].name == "fs.files" || collections[c].name == "fs.chunks") continue;
                    this.registerGlobalWatch(collections[c].name, span);
                }
            }
        }
        if (this.queuemonitoringhandle == null && Config.workitem_queue_monitoring_enabled) {
            this.queuemonitoringpaused = false;
            this.queuemonitoringhandle = setTimeout(this.queuemonitoring.bind(this), Config.workitem_queue_monitoring_interval);
        }
        this.isConnected = true;
        Logger.otel.endSpan(span);
        this.emit("connected");
    }
    async queuemonitoring() {
        try {
            if (!this.isConnected == true) return;
            if (this.queuemonitoringpaused) return;
            const jwt = Crypt.rootToken();
            const collectionname = "workitems";
            let ot_end = Logger.otel.startTimer();

            var queues = await Logger.DBHelper.GetPushableQueues(null);

            for (var i = 0; i < queues.length; i++) {
                const wiq = queues[i];
                const count = await Logger.DBHelper.HasPendingWorkitemsCount(wiq._id, null);
                if (count < 1) continue;
                const query = { "wiqid": wiq._id, state: "new", "_type": "workitem", "nextrun": { "$lte": new Date(new Date().toISOString()) } };
                const payload = await this.GetOne({ jwt, collectionname, query }, null);
                if (payload == null) continue;
                if (wiq.robotqueue != null && wiq.workflowid != null) {
                    if (wiq.robotqueue.toLowerCase() != "(empty)" && wiq.workflowid.toLowerCase() != "(empty)") {
                        const robotpayload = {
                            command: "invoke",
                            workflowid: wiq.workflowid,
                            data: { "workitem": payload }
                        }

                        Logger.instanse.verbose("DatabaseConnection", "queuemonitoring", "[workitems] Send invoke message to robot queue " + wiq.workflowid);
                        let expiration = (Config.amqp_requeue_time / 2, 10) | 0;
                        if (expiration < 500) expiration = 500;
                        await amqpwrapper.Instance().send(null, wiq.robotqueue, robotpayload, expiration, null, null, 2);
                    }

                }
                if (wiq.amqpqueue != null) {
                    if (!NoderedUtil.IsNullEmpty(wiq.amqpqueue) && wiq.amqpqueue.toLowerCase() != "(empty)") {
                        Logger.instanse.verbose("DatabaseConnection", "queuemonitoring", "[workitems] Send invoke message to amqp queue " + wiq.amqpqueue);
                        let expiration = (Config.amqp_requeue_time / 2, 10) | 0;
                        if (expiration < 500) expiration = 500;
                        await amqpwrapper.Instance().send(null, wiq.amqpqueue, payload, expiration, null, null, 2);
                    }
                }
            }
            if (ot_end != null) Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_aggregate, DatabaseConnection.otel_label("mq", Crypt.rootUser(), "aggregate"));
        } catch (error) {
            Logger.instanse.error("DatabaseConnection", "queuemonitoring", error);
        }
        finally {
            this.queuemonitoringhandle = setTimeout(this.queuemonitoring.bind(this), Config.workitem_queue_monitoring_interval);
        }
    }
    async queuemonitoring_old() {
        try {
            if (!this.isConnected == true) return;
            if (this.queuemonitoringpaused) return;
            const jwt = Crypt.rootToken();
            var pipeline: any[] = [];
            pipeline.push({ "$match": { state: "new", "_type": "workitem", "nextrun": { "$lte": new Date(new Date().toISOString()) } } });
            pipeline.push({ "$group": { _id: "$wiq", "count": { "$sum": 1 } } });
            pipeline.push({ "$match": { "count": { $gte: 1 } } });
            pipeline.push({
                "$graphLookup":
                {
                    from: 'mq',
                    startWith: '$_id',
                    connectFromField: '_id',
                    connectToField: 'name',
                    as: 'queue',
                    maxDepth: 0,
                    restrictSearchWithMatch: {
                        "$or": [
                            { robotqueue: { "$exists": true, $ne: null } },
                            { amqpqueue: { "$exists": true, $ne: null } }
                        ]
                    }
                },
            });
            pipeline.push({ "$match": { "queue": { $size: 1 } } });

            var results: any[] = await this.aggregate(pipeline, "workitems", jwt, null, null);
            this.queuemonitoringlastrun = new Date();
            if (results.length > 0) Logger.instanse.verbose("DatabaseConnection", "queuemonitoring", "[workitems] found " + results.length + " queues with pending workitems");
            for (var i = 0; i < results.length; i++) {
                if (results[i].count > 0 && results[i].queue.length > 0) {
                    const wiq: WorkitemQueue = results[i].queue[0];
                    const payload = {
                        command: "invoke",
                        workflowid: wiq.workflowid,
                        data: { payload: {} }
                    }
                    if (!NoderedUtil.IsNullEmpty(wiq.robotqueue) && !NoderedUtil.IsNullEmpty(wiq.workflowid)) {
                        if (wiq.robotqueue.toLowerCase() != "(empty)" && wiq.workflowid.toLowerCase() != "(empty)") {
                            Logger.instanse.verbose("DatabaseConnection", "queuemonitoring", "[workitems] Send invoke message to robot queue " + wiq.workflowid);
                            let expiration = (Config.amqp_requeue_time / 2, 10) | 0;
                            if (expiration < 500) expiration = 500;
                            await amqpwrapper.Instance().send(null, wiq.robotqueue, payload, expiration, null, null, 2);
                        }
                    }
                    if (!NoderedUtil.IsNullEmpty(wiq.amqpqueue)) {
                        if (wiq.amqpqueue.toLowerCase() != "(empty)") {
                            Logger.instanse.verbose("DatabaseConnection", "queuemonitoring", "[workitems] Send invoke message to amqp queue " + wiq.amqpqueue);
                            let expiration = (Config.amqp_requeue_time / 2, 10) | 0;
                            if (expiration < 500) expiration = 500;
                            await amqpwrapper.Instance().send(null, wiq.amqpqueue, payload, expiration, null, null, 2);
                        }
                    }
                }
            }
        } catch (error) {
            Logger.instanse.error("DatabaseConnection", "queuemonitoring", error);
        }
        finally {
            this.queuemonitoringhandle = setTimeout(this.queuemonitoring.bind(this), Config.workitem_queue_monitoring_interval);
        }
    }
    registerGlobalWatch(collectionname: string, parent: Span) {
        if (!this.registerGlobalWatches) return;
        if (collectionname == "cvr") return;
        const span: Span = Logger.otel.startSubSpan("registerGlobalWatch", parent);
        try {
            span?.setAttribute("collectionname", collectionname);
            var exists = this.streams.filter(x => x.collectionname == collectionname);
            if (exists.length > 0) return;
            if (collectionname.endsWith("_hist")) return;
            // if (collectionname == "users") return;
            if (collectionname == "dbusage") return;
            if (collectionname == "audit") return;
            Logger.instanse.verbose("DatabaseConnection", "registerGlobalWatch", "register global watch for " + collectionname + " collection");
            var stream = new clsstream();
            stream.collectionname = collectionname;
            stream.stream = this.db.collection(collectionname).watch([], { fullDocument: 'updateLookup' });
            (stream.stream as any).on("error", err => {
                Logger.instanse.error("DatabaseConnection", "registerGlobalWatch", err);
            });
            (stream.stream as any).on("change", async (next) => {
                try {
                    var _id = next.documentKey._id;
                    if (next.operationType == 'update' && collectionname == "users") {
                        if (next.updateDescription.updatedFields.hasOwnProperty("_heartbeat")) return;
                        if (next.updateDescription.updatedFields.hasOwnProperty("lastseen")) return;
                        if (next.updateDescription.updatedFields.hasOwnProperty("_rpaheartbeat")) return;
                        if (next.updateDescription.updatedFields.hasOwnProperty("_webheartbeat")) return;
                        if (next.updateDescription.updatedFields.hasOwnProperty("_noderedheartbeat")) return;
                        if (next.updateDescription.updatedFields.hasOwnProperty("_powershellheartbeat")) return;
                    }
                    var item = next.fullDocument;
                    var _type = "";
                    if (collectionname == "config" && NoderedUtil.IsNullUndefinded(item)) {
                        item = await this.GetLatestDocumentVersion({ collectionname, id: _id, jwt: Crypt.rootToken() }, null);
                    }
                    // 
                    if (Config.cache_store_type != "redis" && Config.cache_store_type != "mongodb") {
                        if (next.operationType == 'delete' && collectionname == "users") {
                            item = await this.GetLatestDocumentVersion({ collectionname, id: _id, jwt: Crypt.rootToken() }, null);
                            if (!NoderedUtil.IsNullUndefinded(item)) {
                                await Logger.DBHelper.UserRoleUpdate(item, true);
                            }
                        }
                    }
                    if (!NoderedUtil.IsNullUndefinded(item)) {
                        _type = item._type;

                        if (collectionname == "mq") {
                            if (_type == "queue") await Logger.DBHelper.QueueUpdate(item._id, item.name, true);
                            if (_type == "exchange") await Logger.DBHelper.ExchangeUpdate(item._id, item.name, true);
                            if (_type == "workitemqueue") await Logger.DBHelper.WorkitemQueueUpdate(item._id, true);
                        }
                        if (collectionname == "workitems" && _type == "workitem") {
                            await Logger.DBHelper.WorkitemQueueUpdate(item.wiqid, true);
                        }
                        if (collectionname == "users" && (_type == "user" || _type == "role" || _type == "customer")) {
                            // Logger.DBHelper.clearCache("watch detected change in " + collectionname + " collection for a " + _type + " " + item.name);
                            await Logger.DBHelper.UserRoleUpdate(item, true);

                            if (_type == "user" && item.disabled == true) {
                                for (let i = 0; i < WebSocketServer._clients.length; i++) {
                                    var _cli = WebSocketServer._clients[i];
                                    if (_cli.user?._id == item._id) {
                                        Logger.instanse.warn("DatabaseConnection", "registerGlobalWatch", "Disconnecting [" + _cli.username + "/" + _cli.clientagent + "/" + _cli.id + "] who is now on disabled!");
                                        WebSocketServer._clients[i].Close();
                                    }
                                }
                            } else if (_type == "user" && item.dblocked == true) {
                                for (let i = 0; i < WebSocketServer._clients.length; i++) {
                                    var _cli = WebSocketServer._clients[i];
                                    if (_cli.user?._id == item._id && _cli.clientagent == "openrpa") {
                                        Logger.instanse.warn("DatabaseConnection", "registerGlobalWatch", "Disconnecting [" + _cli.username + "/" + _cli.clientagent + "/" + _cli.id + "] who is now on dblocked!");
                                        WebSocketServer._clients[i].Close();
                                    }
                                }
                            }                            
                        }
                        if (collectionname == "config" && (_type == "restriction" || _type == "resource")) {
                            Logger.DBHelper.clearCache("watch detected change in " + collectionname + " collection for a " + _type + " " + item.name);
                        }
                        if (collectionname == "config" && _type == "provider") {
                            await Logger.DBHelper.ClearProviders();
                            await LoginProvider.RegisterProviders(WebServer.app, Config.baseurl());
                        }
                        if (collectionname == "config" && _type == "ipblock") {
                            await Logger.DBHelper.ClearIPBlockList();
                            if (!NoderedUtil.IsNullUndefinded(item.ips) && item.ips.length > 0) {
                                for (let i = 0; i < WebSocketServer._clients.length; i++) {
                                    var _cli = WebSocketServer._clients[i];
                                    if (item.ips.indexOf(_cli.remoteip) > -1) {
                                        Logger.instanse.warn("DatabaseConnection", "registerGlobalWatch", "Disconnecting [" + _cli.username + "/" + _cli.clientagent + "/" + _cli.id + "] who is now on blocked list!");
                                        WebSocketServer._clients[i].Close();
                                    }
                                }
                            }
                        }
                        if (collectionname === "config" && _type === "oauthclient") {
                            setTimeout(() => OAuthProvider.LoadClients(), 1000);
                        }
                        if (collectionname === "config" && _type === "config") {
                            await dbConfig.Reload(Crypt.rootToken(), span);
                        }
                    }
                    let doContinue: boolean = false;
                    if (WebSocketServer._clients)
                        for (let i = 0; i < WebSocketServer._clients.length; i++) {
                            let client = WebSocketServer._clients[i];
                            if (NoderedUtil.IsNullUndefinded(client.user)) continue;
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

                    if (NoderedUtil.IsNullEmpty(item)) item = await this.GetLatestDocumentVersion({ collectionname, id: _id, jwt: Crypt.rootToken() }, null);
                    if (NoderedUtil.IsNullEmpty(item)) {
                        Logger.instanse.error("DatabaseConnection", "registerGlobalWatch", "Missing fullDocument and could not find historic version for " + _id + " in " + collectionname);
                        return;
                    } else {
                        Logger.instanse.verbose("DatabaseConnection", "registerGlobalWatch", "[" + collectionname + "][" + next.operationType + "] " + _id + " " + item.name);
                    }
                    try {
                        for (var i = 0; i < WebSocketServer._clients.length; i++) {
                            var client = WebSocketServer._clients[i];
                            if (NoderedUtil.IsNullUndefinded(client.user)) continue;
                            const tuser: TokenUser = TokenUser.From(client.user);
                            try {
                                if (DatabaseConnection.hasAuthorization(tuser, item, Rights.read)) {
                                    try {
                                        var ids = Object.keys(client.watches);
                                        for (var y = 0; y < ids.length; y++) {
                                            let notify: boolean = false;
                                            var stream = client.watches[ids[y]];
                                            if (stream.collectionname != collectionname) {
                                            } else if (NoderedUtil.IsNullUndefinded(stream.aggregates)) {
                                                notify = true;
                                            } else if (stream.aggregates.length == 0) {
                                                notify = true;
                                            } else if (typeof stream.aggregates[0] === 'object') {
                                                // This is fucking ugly, but need something to be backward compatible with older version of OpenRPA and Nodered Nodes
                                                var match = stream.aggregates[0]["$match"];
                                                if (NoderedUtil.IsNullUndefinded(match)) { continue; }
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
                                                if (Array.isArray(stream.aggregates)) {
                                                    for (let p = 0; p < stream.aggregates.length; p++) {
                                                        let path = stream.aggregates[p];
                                                        if (!NoderedUtil.IsNullEmpty(path)) {
                                                            try {
                                                                const result = JSONPath({ path, json: { a: item } });
                                                                if (result && result.length > 0) notify = true;
                                                            } catch (error) {
                                                                Logger.instanse.error("DatabaseConnection", "registerGlobalWatch", error);
                                                            }
                                                        }
                                                    }
                                                } else {
                                                    if (!NoderedUtil.IsNullEmpty(stream.aggregates)) {
                                                        try {
                                                            let path = stream.aggregates;
                                                            const result = JSONPath({ path, json: { a: item } });
                                                            if (result && result.length > 0) notify = true;
                                                        } catch (error) {
                                                            Logger.instanse.error("DatabaseConnection", "registerGlobalWatch", error);
                                                        }
                                                    }
                                                }
                                                // Watch all
                                                if (stream.aggregates.length == 0) {
                                                    notify = true;
                                                }
                                            }
                                            if (notify) {
                                                Logger.instanse.verbose("DatabaseConnection", "registerGlobalWatch", "Notify " + tuser.username + " of " + next.operationType + " " + item.name);
                                                // Logger.instanse.info("Watch: " + JSON.stringify(next.documentKey));
                                                const msg: SocketMessage = SocketMessage.fromcommand("watchevent");
                                                const q = new WatchEventMessage();
                                                q.id = ids[y];
                                                q.result = next;
                                                if (q.result && !q.result.fullDocument) q.result.fullDocument = item;
                                                if (q.result && q.result.fullDocument) {
                                                    q.result.fullDocument = Config.db.decryptentity(q.result.fullDocument);
                                                }
                                                msg.data = JSON.stringify(q);
                                                client._socketObject.send(msg.tojson(), (err) => {
                                                    if (err) Logger.instanse.error("DatabaseConnection", "registerGlobalWatch", err);
                                                });
                                            }
                                        }

                                    } catch (error) {
                                        Logger.instanse.error("DatabaseConnection", "registerGlobalWatch", error);
                                    }
                                }
                            } catch (error) {
                                Logger.instanse.error("DatabaseConnection", "registerGlobalWatch", error);
                            }
                        }
                    } catch (error) {
                        Logger.instanse.error("DatabaseConnection", "registerGlobalWatch", error);
                    }
                } catch (error) {
                    Logger.instanse.error("DatabaseConnection", "registerGlobalWatch", error);
                }
            });
            this.streams.push(stream);
        } catch (error) {
            span?.recordException(error);
            Logger.instanse.error("DatabaseConnection", "registerGlobalWatch", error);
            return false;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    async ListCollections(jwt: string): Promise<any[]> {
        let result = await DatabaseConnection.toArray(this.db.listCollections());
        result = result.filter(x => x.name.indexOf("system.") === -1);
        result.sort((a, b) => a.name.localeCompare(b.name, undefined, {sensitivity: 'base'}))
        await Crypt.verityToken(jwt);
        return result;
    }
    async DropCollection(collectionname: string, jwt: string, parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("db.DropCollection", parent);
        try {
            const user: TokenUser = await Crypt.verityToken(jwt);
            span?.setAttribute("collection", collectionname);
            span?.setAttribute("username", user.username);
            if (!user.HasRoleName("admins")) throw new Error("Access denied, droppping collection " + collectionname);
            if (["workflow", "entities", "config", "audit", "jslog", "openrpa", "nodered", "openrpa_instances", "forms", "workflow_instances", "users"].indexOf(collectionname) > -1) throw new Error("Access denied, dropping reserved collection " + collectionname);
            const mongodbspan: Span = Logger.otel.startSubSpan("mongodb.dropCollection", span);
            await this.db.dropCollection(collectionname);
            Logger.otel.endSpan(mongodbspan);
        } catch (error) {
            span?.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    WellknownIdsArray: string[] = [
        WellknownIds.root,
        WellknownIds.admins,
        WellknownIds.users,
        WellknownIds.robots,
        WellknownIds.nodered_users,
        WellknownIds.nodered_admins,
        WellknownIds.nodered_api_users,
        WellknownIds.filestore_users,
        WellknownIds.filestore_admins,
        WellknownIds.robot_users,
        WellknownIds.robot_admins,
        WellknownIds.personal_nodered_users,
        WellknownIds.robot_agent_users,
        WellknownIds.customer_admins,
        WellknownIds.resellers
    ]
    WellknownNamesArray: string[] = [
        "root",
        "admins",
        "users",
        "user",
        "admin",
        "nodered",
        "administrator",
        "robots",
        "robot",
        "nodered_users",
        "nodered_admins",
        "nodered_api_users",
        "filestore_users",
        "filestore_admins",
        "robot_users",
        "robot_admins",
        "personal_nodered_users",
        "robot_agent_users",
        "customer_admins",

        "nodered users",
        "nodered admins",
        "nodered api_users",
        "filestore users",
        "filestore admins",
        "robot users",
        "robot admins",
        "personal nodered users",
        "robot agent users",
        "customer admins",
        "reseller", "resellers"
    ]

    async CleanACL<T extends Base>(item: T, user: TokenUser, collection: string, parent: Span): Promise<T> {
        const span: Span = Logger.otel.startSubSpan("db.CleanACL", parent);
        try {
            if (item._acl.length > Config.max_ace_count) {
                // remove excesive acls
                const newacl = item._acl.slice(0, Config.max_ace_count);
                item._acl = newacl;
            }
            for (let i = item._acl.length - 1; i >= 0; i--) {
                {
                    const ace = item._acl[i];
                    if (typeof ace.rights === "string") {
                        const b = new Binary(Buffer.from(ace.rights, "base64"), 0);
                        (ace.rights as any) = b;
                    }
                    if (this.WellknownIdsArray.indexOf(ace._id) === -1) {
                        let _user = await Logger.DBHelper.FindById(ace._id, null, span);
                        if (NoderedUtil.IsNullUndefinded(_user)) {
                            const ot_end = Logger.otel.startTimer();
                            const mongodbspan: Span = Logger.otel.startSubSpan("mongodb.find", span);
                            mongodbspan?.setAttribute("collection", "users");
                            if (Config.otel_trace_include_query) mongodbspan?.setAttribute("query", JSON.stringify({ _id: ace._id }));
                            const arr = await this.db.collection("users").find({ _id: ace._id }).project({ name: 1 }).limit(1).toArray();
                            mongodbspan?.setAttribute("results", arr.length);
                            Logger.otel.endSpan(mongodbspan);
                            Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_query, DatabaseConnection.otel_label("users", user, "query"));
                        }
                        if (NoderedUtil.IsNullUndefinded(_user)) {
                            item._acl.splice(i, 1);
                        } else { ace.name = _user.name; }
                    }
                }
            }
            let addself: boolean = true;
            item._acl.forEach(ace => {
                if (ace._id === user._id) addself = false;
                if (addself) {
                    user.roles.forEach(role => {
                        if (ace._id === role._id) addself = false;
                    });
                }
            })
            if (addself) {
                Base.addRight(item, user._id, user.name, [Rights.full_control], false);
            }
            item = this.ensureResource(item, collection);
        } catch (error) {
            span?.recordException(error);
        }
        Logger.otel.endSpan(span);
        return item;
    }
    async Cleanmembers<T extends Role>(item: T, original: T): Promise<T> {
        const removed: Rolemember[] = [];
        if (NoderedUtil.IsNullUndefinded(item.members)) item.members = [];
        if (original != null && Config.update_acl_based_on_groups === true) {
            for (let i = original.members.length - 1; i >= 0; i--) {
                const ace = original.members[i];
                const exists = item.members.filter(x => x._id === ace._id);
                if (exists.length === 0) removed.push(ace);
            }
        }
        let doadd: boolean = true;
        if ((item as any).hidemembers == true) {
            doadd = false;
            for (let i = item.members.length - 1; i >= 0; i--) {
                const ace = item.members[i];
                removed.push(ace);
            }
        }
        const multi_tenant_skip: string[] = [WellknownIds.users, WellknownIds.filestore_users,
        WellknownIds.nodered_api_users, WellknownIds.nodered_users, WellknownIds.personal_nodered_users,
        WellknownIds.robot_users, WellknownIds.robots, WellknownIds.customer_admins, WellknownIds.resellers];
        if (item._id === WellknownIds.users && Config.multi_tenant) {
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
                        const arr = await this.db.collection("users").find({ _id: ace._id }).project({ name: 1, _acl: 1, _type: 1 }).limit(1).toArray();
                        Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_query, DatabaseConnection.otel_label("users", Crypt.rootUser(), "query"));
                        if (arr.length === 0) {
                            item.members.splice(i, 1);
                        }
                        else if (Config.update_acl_based_on_groups === true) {
                            ace.name = arr[0].name;
                            if (Config.multi_tenant && multi_tenant_skip.indexOf(item._id) > -1) {
                                // when multi tenant don't allow members of common user groups to see each other
                                Logger.instanse.silly("DatabaseConnection", "Cleanmembers", "Running in multi tenant mode, skip adding permissions for " + item.name);
                            } else if (arr[0]._type === "user") {
                                let u: User = User.assign(arr[0]);
                                if (!Base.hasRight(u, item._id, Rights.read)) {
                                    Logger.instanse.silly("DatabaseConnection", "Cleanmembers", "Assigning " + item.name + " read permission to " + u.name);
                                    Base.addRight(u, item._id, item.name, [Rights.read], false);
                                    u = this.ensureResource(u, "users");
                                    const _ot_end1 = Logger.otel.startTimer();
                                    await this.db.collection("users").updateOne({ _id: u._id }, { $set: { _acl: u._acl } });
                                    Logger.otel.endTimer(_ot_end1, DatabaseConnection.mongodb_update, DatabaseConnection.otel_label("users", Crypt.rootUser(), "update"));
                                } else if (u._id != item._id) {
                                    Logger.instanse.silly("DatabaseConnection", "Cleanmembers", item.name + " allready exists on " + u.name);
                                }
                            } else if (arr[0]._type === "role") {
                                let r: Role = Role.assign(arr[0]);
                                if (r._id !== WellknownIds.admins && r._id !== WellknownIds.users && !Base.hasRight(r, item._id, Rights.read)) {
                                    Logger.instanse.silly("DatabaseConnection", "Cleanmembers", "Assigning " + item.name + " read permission to " + r.name);
                                    Base.addRight(r, item._id, item.name, [Rights.read], false);
                                    r = this.ensureResource(r, "users");
                                    const _ot_end2 = Logger.otel.startTimer();
                                    await this.db.collection("users").updateOne({ _id: r._id }, { $set: { _acl: r._acl } });
                                    Logger.otel.endTimer(_ot_end2, DatabaseConnection.mongodb_update, DatabaseConnection.otel_label("users", Crypt.rootUser(), "update"));
                                } else if (r._id != item._id) {
                                    Logger.instanse.silly("DatabaseConnection", "Cleanmembers", item.name + " allready exists on " + r.name);
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
                if (NoderedUtil.IsNullUndefinded(ace)) continue;
                const ot_end = Logger.otel.startTimer();
                const arr = await this.db.collection("users").find({ _id: ace._id }).project({ name: 1, _acl: 1, _type: 1 }).limit(1).toArray();
                Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_query, DatabaseConnection.otel_label("users", Crypt.rootUser(), "query"));
                if (arr.length === 1 && item._id != WellknownIds.admins && item._id != WellknownIds.root) {
                    if (Config.multi_tenant && multi_tenant_skip.indexOf(item._id) > -1 && !((item as any).hidemembers == true)) {
                        // when multi tenant don't allow members of common user groups to see each other
                        Logger.instanse.verbose("DatabaseConnection", "Cleanmembers", "Running in multi tenant mode, skip removing permissions for " + item.name);
                    } else if (arr[0]._type === "user") {
                        let u: User = User.assign(arr[0]);
                        if (Base.hasRight(u, item._id, Rights.read)) {
                            Base.removeRight(u, item._id, [Rights.read]);

                            // was read the only right ? then remove it
                            const right = Base.getRight(u, item._id, false);
                            if (NoderedUtil.IsNullUndefinded(right) || (!Ace.isBitSet(right, 3) && !Ace.isBitSet(right, 4) && !Ace.isBitSet(right, 5))) {
                                Base.removeRight(u, item._id, [Rights.full_control]);
                                u = this.ensureResource(u, "users");
                                Logger.instanse.debug("DatabaseConnection", "Cleanmembers", "Removing " + item.name + " read permissions from " + u.name);
                                const _ot_end1 = Logger.otel.startTimer();
                                await this.db.collection("users").updateOne({ _id: u._id }, { $set: { _acl: u._acl } });
                                Logger.otel.endTimer(_ot_end1, DatabaseConnection.mongodb_update, DatabaseConnection.otel_label("users", Crypt.rootUser(), "update"));
                            }

                        } else {
                            Logger.instanse.debug("DatabaseConnection", "Cleanmembers", "No need to remove " + item.name + " read permissions from " + u.name);
                        }
                    } else if (arr[0]._type === "role") {
                        let r: Role = Role.assign(arr[0]);
                        if (Base.hasRight(r, item._id, Rights.read)) {
                            Base.removeRight(r, item._id, [Rights.read]);

                            // was read the only right ? then remove it
                            const right = Base.getRight(r, item._id, false);
                            if (NoderedUtil.IsNullUndefinded(right) || (!Ace.isBitSet(right, 3) && !Ace.isBitSet(right, 4) && !Ace.isBitSet(right, 5))) {
                                Base.removeRight(r, item._id, [Rights.full_control]);
                                r = this.ensureResource(r, "users");
                                Logger.instanse.debug("DatabaseConnection", "Cleanmembers", "Removing " + item.name + " read permissions from " + r.name);
                                const _ot_end2 = Logger.otel.startTimer();
                                await this.db.collection("users").updateOne({ _id: r._id }, { $set: { _acl: r._acl } });
                                Logger.otel.endTimer(_ot_end2, DatabaseConnection.mongodb_update, DatabaseConnection.otel_label("users", Crypt.rootUser(), "update"));
                            }

                        } else {
                            Logger.instanse.debug("DatabaseConnection", "Cleanmembers", "No need to remove " + item.name + " read permissions from " + r.name);
                        }
                    }

                }
            }
        }
        return item;
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
    // tslint:disable-next-line: max-line-length
    async query<T extends Base>(options: QueryOptions, parent: Span): Promise<T[]> {
        let { query, projection, top, skip, orderby, collectionname, jwt, queryas, hint, decrypt } = Object.assign({
            top: 100,
            skip: 0,
            decrypt: true
        }, options);
        const span: Span = Logger.otel.startSubSpan("db.query", parent);
        let _query: Object = {};
        try {
            await this.connect(span);
            let mysort: Object = {};
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
                        span?.recordException(error);
                        span?.setAttribute("failedorderby", orderby as string);
                        Logger.instanse.error("DatabaseConnection", "query", error);
                    }
                    if (NoderedUtil.IsNullUndefinded(neworderby)) mysort[(orderby as string)] = 1;
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
                        span?.recordException(error);
                        span?.setAttribute("failedhint", hint as string);
                        Logger.instanse.error("DatabaseConnection", "query", error);
                    }
                    if (NoderedUtil.IsNullUndefinded(newhint)) myhint[(hint as string)] = 1;
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
                if (typeof json !== 'string' && !(json instanceof String)) {
                    json = JSON.stringify(json, (key, value) => {
                        if (value instanceof RegExp)
                            return ("__REGEXP " + value.toString());
                        else
                            return value;
                    });
                }
                query = JSON.parse(json, (key, value) => {
                    if (typeof value === 'string' && value.match(isoDatePattern)) {
                        return new Date(value); // isostring, so cast to js date
                    } else if (value != null && value != undefined && value.toString().indexOf("__REGEXP ") === 0) {
                        const m = value.split("__REGEXP ")[1].match(/\/(.*)\/(.*)?/);
                        return new RegExp(m[1], m[2] || "");
                    } else
                        return value; // leave any other value as-is
                });
                if (Config.otel_trace_include_query) span?.setAttribute("query", JSON.stringify(query));
            }
            if (NoderedUtil.IsNullUndefinded(query)) {
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
            const user: TokenUser = await Crypt.verityToken(jwt);

            span?.addEvent("getbasequery");
            if (collectionname === "files") { collectionname = "fs.files"; }
            if (DatabaseConnection.usemetadata(collectionname)) {
                let impersonationquery;
                if (!NoderedUtil.IsNullEmpty(queryas)) impersonationquery = await this.getbasequeryuserid(user, queryas, "metadata._acl", [Rights.read], span);
                if (!NoderedUtil.IsNullEmpty(queryas) && !NoderedUtil.IsNullUndefinded(impersonationquery)) {
                    _query = { $and: [query, this.getbasequery(user, "metadata._acl", [Rights.read]), impersonationquery] };
                } else {
                    _query = { $and: [query, this.getbasequery(user, "metadata._acl", [Rights.read])] };
                }
                projection = null;
            } else {
                let impersonationquery: any;
                if (!NoderedUtil.IsNullEmpty(queryas)) impersonationquery = await this.getbasequeryuserid(user, queryas, "_acl", [Rights.read], span)
                if (!NoderedUtil.IsNullEmpty(queryas) && !NoderedUtil.IsNullUndefinded(impersonationquery)) {
                    _query = { $and: [query, this.getbasequery(user, "_acl", [Rights.read]), impersonationquery] };
                } else {
                    _query = { $and: [query, this.getbasequery(user, "_acl", [Rights.read])] };
                }
            }
            if (!top) { top = 500; }
            if (!skip) { skip = 0; }
            span?.setAttribute("collection", collectionname);
            span?.setAttribute("username", user.username);
            span?.setAttribute("top", top);
            span?.setAttribute("skip", skip);
            let arr: T[] = [];
            const ot_end = Logger.otel.startTimer();
            const mongodbspan: Span = Logger.otel.startSubSpan("mongodb.find", span);
            let _pipe = this.db.collection(collectionname).find(_query);
            if (projection != null) {
                _pipe = _pipe.project(projection);
            }
            _pipe = _pipe.sort(mysort as any).limit(top).skip(skip);
            if (hint) {
                _pipe = _pipe.hint(myhint);
            }
            // @ts-ignore
            arr = await _pipe.toArray();
            mongodbspan?.setAttribute("results", arr.length);
            Logger.otel.endSpan(mongodbspan);
            Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_query, DatabaseConnection.otel_label(collectionname, user, "query"));
            if (decrypt) for (let i: number = 0; i < arr.length; i++) { arr[i] = this.decryptentity(arr[i]); }
            DatabaseConnection.traversejsondecode(arr);
            Logger.instanse.debug("DatabaseConnection", "query", "[" + user.username + "][" + collectionname + "] query gave " + arr.length + " results ");
            return arr;
        } catch (error) {
            Logger.instanse.error("DatabaseConnection", "query", "[" + collectionname + "] query error " + (error.message ? error.message : error));
            span?.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }

    /**
     * Send a query to the database.
     * @param {any} query MongoDB Query
     * @param {string} collectionname What collection to query
     * @param {string} jwt JWT of user who is making the query, to limit results based on permissions
     * @returns Promise<T[]> Array of results
     */
    // tslint:disable-next-line: max-line-length
    async count(options: CountOptions, parent: Span): Promise<number> {
        let { query, collectionname, jwt, queryas } = Object.assign({
        }, options);
        const span: Span = Logger.otel.startSubSpan("db.count", parent);
        let _query: Object = {};
        try {
            await this.connect(span);
            if (query !== null && query !== undefined) {
                span?.addEvent("parse query");
                let json: any = query;
                if (typeof json !== 'string' && !(json instanceof String)) {
                    json = JSON.stringify(json, (key, value) => {
                        if (value instanceof RegExp)
                            return ("__REGEXP " + value.toString());
                        else
                            return value;
                    });
                }
                query = JSON.parse(json, (key, value) => {
                    if (typeof value === 'string' && value.match(isoDatePattern)) {
                        return new Date(value); // isostring, so cast to js date
                    } else if (value != null && value != undefined && value.toString().indexOf("__REGEXP ") === 0) {
                        const m = value.split("__REGEXP ")[1].match(/\/(.*)\/(.*)?/);
                        return new RegExp(m[1], m[2] || "");
                    } else
                        return value; // leave any other value as-is
                });
                if (Config.otel_trace_include_query) span?.setAttribute("query", JSON.stringify(query));
            }
            if (NoderedUtil.IsNullUndefinded(query)) {
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
            const user: TokenUser = await Crypt.verityToken(jwt);

            span?.addEvent("getbasequery");
            if (collectionname === "files") { collectionname = "fs.files"; }
            if (DatabaseConnection.usemetadata(collectionname)) {
                let impersonationquery;
                if (!NoderedUtil.IsNullEmpty(queryas)) impersonationquery = await this.getbasequeryuserid(user, queryas, "metadata._acl", [Rights.read], span);
                if (!NoderedUtil.IsNullEmpty(queryas) && !NoderedUtil.IsNullUndefinded(impersonationquery)) {
                    _query = { $and: [query, this.getbasequery(user, "metadata._acl", [Rights.read]), impersonationquery] };
                } else {
                    _query = { $and: [query, this.getbasequery(user, "metadata._acl", [Rights.read])] };
                }
            } else {
                let impersonationquery: any;
                if (!NoderedUtil.IsNullEmpty(queryas)) impersonationquery = await this.getbasequeryuserid(user, queryas, "_acl", [Rights.read], span)
                if (!NoderedUtil.IsNullEmpty(queryas) && !NoderedUtil.IsNullUndefinded(impersonationquery)) {
                    _query = { $and: [query, this.getbasequery(user, "_acl", [Rights.read]), impersonationquery] };
                } else {
                    _query = { $and: [query, this.getbasequery(user, "_acl", [Rights.read])] };
                }
            }
            span?.setAttribute("collection", collectionname);
            span?.setAttribute("username", user.username);
            const ot_end = Logger.otel.startTimer();
            const mongodbspan: Span = Logger.otel.startSubSpan("mongodb.find", span);
            // @ts-ignore
            let result = await this.db.collection(collectionname).countDocuments(_query);
            mongodbspan?.setAttribute("results", result);
            Logger.otel.endSpan(mongodbspan);
            Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_count, DatabaseConnection.otel_label(collectionname, user, "count"));
            Logger.instanse.debug("DatabaseConnection", "count", "[" + user.username + "][" + collectionname + "] count gave " + result + " results ");
            return result;
        } catch (error) {
            Logger.instanse.error("DatabaseConnection", "count", "[" + collectionname + "] count error " + (error.message ? error.message : error));
            span?.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    async GetLatestDocumentVersion<T extends Base>(options: GetLatestDocumentVersionOptions, parent: Span): Promise<T> {
        let { collectionname, id, jwt, decrypt } = Object.assign({
            decrypt: true
        }, options);
        let result: T = await this.getbyid<T>(id, collectionname, jwt, true, parent);
        if (result) return result;

        const basehist = await this.query<any>({ query: { id: id }, projection: { _version: 1 }, top: 1, orderby: { _version: -1 }, collectionname: collectionname + "_hist", jwt: Crypt.rootToken(), decrypt }, parent);
        if (basehist.length > 0) {
            let result: T = null;
            try {
                result = await this.GetDocumentVersion({ collectionname, id, version: basehist[0]._version, jwt: Crypt.rootToken(), decrypt }, parent)
                return result;
            } catch (error) {
            }
        }
        return null;
    }
    async GetDocumentVersion<T extends Base>(options: GetDocumentVersionOptions, parent: Span): Promise<T> {
        let { collectionname, id, version, jwt, decrypt } = Object.assign({
            decrypt: true
        }, options);

        const span: Span = Logger.otel.startSubSpan("db.GetDocumentVersion", parent);
        try {
            let result: T = await this.getbyid<T>(id, collectionname, jwt, false, span);
            if (NoderedUtil.IsNullUndefinded(result)) {
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
            if (decrypt && !NoderedUtil.IsNullUndefinded(result)) result = this.decryptentity(result);
            return result;
        } catch (error) {
            Logger.instanse.error("DatabaseConnection", "GetDocumentVersion", error);
            span?.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
        /**
     * Get a single item based on id
     * @param  {string} id Id to search for
     * @param  {string} collectionname Collection to search
     * @param  {string} jwt JWT of user who is making the query, to limit results based on permissions
     * @returns Promise<T>
     */
    async GetOne<T extends Base>(options: { query?: object, collectionname: string, orderby?: object, jwt?: string, decrypt?: boolean }, parent: Span): Promise<T> {
        const span: Span = Logger.otel.startSubSpan("db.GetOne", parent);
        if (NoderedUtil.IsNullUndefinded(options.jwt)) options.jwt = Crypt.rootToken();
        if (NoderedUtil.IsNullUndefinded(options.decrypt)) options.decrypt = true;
        if (NoderedUtil.IsNullUndefinded(options.query)) options.query = {};
        const { query, collectionname, orderby, jwt, decrypt } = options;
        try {
            const arr: T[] = await this.query<T>({ query, collectionname, orderby, jwt, decrypt }, span);
            if (arr === null || arr.length === 0) { return null; }
            return arr[0];
        } catch (error) {
            span?.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    /**
     * Get a single item based on id
     * @param  {string} id Id to search for
     * @param  {string} collectionname Collection to search
     * @param  {string} jwt JWT of user who is making the query, to limit results based on permissions
     * @returns Promise<T>
     */
    async getbyid<T extends Base>(id: string, collectionname: string, jwt: string, decrypt: boolean, parent: Span): Promise<T> {
        const span: Span = Logger.otel.startSubSpan("db.getbyid", parent);
        try {
            if (id === null || id === undefined || id === "") { throw Error("Id cannot be null"); }
            const query = { _id: id };
            return this.GetOne({ query, collectionname, jwt, decrypt }, span)
        } catch (error) {
            span?.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    /**
     * Get a single item based on username
     * @param  {string} username Username to search for
     * @param  {string} collectionname Collection to search
     * @param  {string} jwt JWT of user who is making the query, to limit results based on permissions
     * @returns Promise<T>
     */
    async getbyusername<T extends Base>(username: string, issuer: string, jwt: string, decrypt: boolean, parent: Span): Promise<T> {
        const span: Span = Logger.otel.startSubSpan("db.getbyid", parent);
        try {
            if (username === null || username === undefined || username === "") { throw Error("Name cannot be null"); }
            // const byuser = { username: new RegExp(["^", username, "$"].join(""), "i") };
            // const byid = { federationids: new RegExp(["^", username, "$"].join(""), "i") }
            const byemail = { email: username };
            const byuser = { username: username };
            const byid = { $or: [{ "federationids.id": username, "federationids.issuer": issuer }, { "federationids": username }] };
            let query: any = { $or: [byuser, byid, byemail] };
            if (NoderedUtil.IsNullEmpty(issuer)) {
                query = { $or: [byuser, byemail] };
            }
            query._type = "user";
            const arr: T[] = await this.query<T>({ query: query, top: 1, collectionname: "users", jwt, decrypt }, span);
            if (arr === null || arr.length === 0) { return null; }
            return arr[0];
        } catch (error) {
            span?.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    /**
     * Do MongoDB aggregation
     * @param  {any} aggregates
     * @param  {string} collectionname
     * @param  {string} jwt
     * @returns Promise
     */
    async aggregate<T extends Base>(aggregates: object[], collectionname: string, jwt: string, hint: Object | string, parent: Span): Promise<T[]> {
        const span: Span = Logger.otel.startSubSpan("db.Aggregate", parent);
        await this.connect(span);
        let json: any = aggregates;
        if (typeof json !== 'string' && !(json instanceof String)) {
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
                    Logger.instanse.error("DatabaseConnection", "aggregate", error);
                }
                if (NoderedUtil.IsNullUndefinded(newhint)) myhint[(hint as string)] = 1;
            } else {
                myhint = hint;
            }
            span?.setAttribute("hint", JSON.stringify(myhint));
        }
        aggregates = JSON.parse(json, (key, value) => {
            if (typeof value === 'string' && value.match(isoDatePattern)) {
                return new Date(value); // isostring, so cast to js date
            } else if (value != null && value != undefined && value.toString().indexOf("__REGEXP ") === 0) {
                const m = value.split("__REGEXP ")[1].match(/\/(.*)\/(.*)?/);
                return new RegExp(m[1], m[2] || "");
            } else
                return value; // leave any other value as-is
        });
        const user: TokenUser = await Crypt.verityToken(jwt);
        if (Config.otel_trace_include_query) span?.setAttribute("aggregates", JSON.stringify(aggregates));
        span?.setAttribute("collection", collectionname);
        span?.setAttribute("username", user.username);
        const aggregatesjson = JSON.stringify(aggregates, null, 2)
        span?.addEvent("getbasequery");
        let base: object;
        if (DatabaseConnection.usemetadata(collectionname)) {
            base = this.getbasequery(user, "metadata._acl", [Rights.read]);
        } else {
            base = this.getbasequery(user, "_acl", [Rights.read]);
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
        options.hint = myhint;
        try {
            const ot_end = Logger.otel.startTimer();
            const mongodbspan: Span = Logger.otel.startSubSpan("mongodb.aggregate", span);
            // @ts-ignore
            const items: T[] = await this.db.collection(collectionname).aggregate(aggregates, options).toArray();
            mongodbspan?.setAttribute("results", items.length);
            Logger.otel.endSpan(mongodbspan);

            Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_aggregate, DatabaseConnection.otel_label(collectionname, user, "aggregate"));

            DatabaseConnection.traversejsondecode(items);
            Logger.instanse.debug("DatabaseConnection", "aggregate", "[" + user.username + "][" + collectionname + "] aggregate gave " + items.length + " results ");
            Logger.instanse.silly("DatabaseConnection", "aggregate", aggregatesjson);
            return items;
        } catch (error) {
            Logger.instanse.error("DatabaseConnection", "aggregate", error);
            span?.recordException(error);
            throw error;
        }
        finally {
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

        let json: any = aggregates;
        if (typeof json !== 'string' && !(json instanceof String)) {
            json = JSON.stringify(json, (key, value) => {
                if (value instanceof RegExp)
                    return ("__REGEXP " + value.toString());
                else
                    return value;
            });
        }

        if (!NoderedUtil.IsNullEmpty(json)) {
            aggregates = JSON.parse(json, (key, value) => {
                if (typeof value === 'string' && value.match(isoDatePattern)) {
                    return new Date(value); // isostring, so cast to js date
                } else if (value != null && value != undefined && value.toString().indexOf("__REGEXP ") === 0) {
                    const m = value.split("__REGEXP ")[1].match(/\/(.*)\/(.*)?/);
                    return new RegExp(m[1], m[2] || "");
                } else
                    return value; // leave any other value as-is
            });
        } else { aggregates = null; }

        const user: TokenUser = await Crypt.verityToken(jwt);
        // TODO: Should we filter on rights other than read ? should a person with reade be allowed to know when it was updated ?
        // a person with read, would beablt to know anyway, so guess read should be enough for now ... 
        const base = this.getbasequery(user, "fullDocument._acl", [Rights.read]);
        if (Array.isArray(aggregates)) {
            aggregates.unshift({ $match: base });
        } else {
            if (NoderedUtil.IsNullUndefinded(aggregates)) {
                aggregates = [{ $match: base }];
            } else {
                aggregates = [{ $match: base }, aggregates];
            }
        }
        return await this.db.collection(collectionname).watch(aggregates, { fullDocument: 'updateLookup' });
    }
    /**
     * Do MongoDB map reduce
     * @param  {any} aggregates
     * @param  {string} collectionname
     * @param  {string} jwt
     * @returns Promise
     */
    async MapReduce<T>(map: mapFunc, reduce: reduceFunc, finalize: finalizeFunc, query: any, out: string | any, collectionname: string, scope: any, jwt: string): Promise<T[]> {
        await this.connect();
        throw new Error("MapReduce is no longer supported")

        // if (query !== null && query !== undefined) {
        //     let json: any = query;
        //     if (typeof json !== 'string' && !(json instanceof String)) {
        //         json = JSON.stringify(json, (key, value) => {
        //             if (value instanceof RegExp)
        //                 return ("__REGEXP " + value.toString());
        //             else
        //                 return value;
        //         });
        //     }
        //     query = JSON.parse(json, (key, value) => {
        //         if (typeof value === 'string' && value.match(isoDatePattern)) {
        //             return new Date(value); // isostring, so cast to js date
        //         } else if (value != null && value != undefined && value.toString().indexOf("__REGEXP ") === 0) {
        //             const m = value.split("__REGEXP ")[1].match(/\/(.*)\/(.*)?/);
        //             return new RegExp(m[1], m[2] || "");
        //         } else
        //             return value; // leave any other value as-is
        //     });
        // }
        // const user: TokenUser = await Crypt.verityToken(jwt);
        // let q: any;
        // if (query !== null && query !== undefined) {
        //     q = { $and: [query, this.getbasequery(user, "_acl", [Rights.read])] };
        // } else {
        //     q = this.getbasequery(user, "_acl", [Rights.read]);
        // }

        // if (finalize != null && finalize != undefined) {
        //     try {
        //         if (((finalize as any) as string).trim() === "") { (finalize as any) = null; }
        //     } catch (error) {
        //     }
        // }
        // let inline: boolean = false;
        // const opt: MapReduceOptions = { query: q, out: { replace: "map_temp_res" }, finalize: finalize };

        // let outcol: string = "map_temp_res";
        // if (out === null || out === undefined || out === "") {
        //     opt.out = { replace: outcol };
        // } else if (typeof out === 'string' || out instanceof String) {
        //     outcol = (out as string);
        //     opt.out = { replace: outcol };
        // } else {
        //     opt.out = out;
        //     if (out.hasOwnProperty("inline")) { inline = true; }
        // }
        // opt.scope = scope;
        // try {
        //     if (inline) {
        //         opt.out = { inline: 1 };
        //         return await this.db.collection(collectionname).mapReduce(map, reduce, opt);;
        //     } else {
        //         await this.db.collection(collectionname).mapReduce(map, reduce, opt);
        //         return [];
        //     }
        // } catch (error) {
        //     Logger.instanse.error("DatabaseConnection", "MapReduce", error);
        //     throw error;
        // }
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
            if (item === null || item === undefined) { throw Error("Cannot create null item"); }
            if (NoderedUtil.IsNullEmpty(jwt)) throw new Error("jwt is null");
            await this.connect(span);
            span?.addEvent("verityToken");
            const user: TokenUser = await Crypt.verityToken(jwt);
            if (user.dblocked && !user.HasRoleName("admins")) throw new Error("Access denied (db locked) could be due to hitting quota limit for " + user.username);
            span?.addEvent("ensureResource");
            item = this.ensureResource(item, collectionname);
            if (user._id != WellknownIds.root && !await this.CheckEntityRestriction(user, collectionname, item, span)) {
                throw Error("Create " + item._type + " access denied");
            }
            span?.addEvent("traversejsonencode");
            DatabaseConnection.traversejsonencode(item);
            let name = item.name;
            if (NoderedUtil.IsNullEmpty(name)) name = item._name;
            if (NoderedUtil.IsNullEmpty(name)) name = "Unknown";
            item._createdby = user.name;
            item._createdbyid = user._id;
            item._created = new Date(new Date().toISOString());
            item._modifiedby = user.name;
            item._modifiedbyid = user._id;
            item._modified = item._created;
            if (collectionname == "audit") {
                delete item._modifiedby;
                delete item._modifiedbyid;
                delete item._modified;
            }
            const hasUser: Ace = item._acl.find(e => e._id === user._id);
            if ((hasUser === null || hasUser === undefined)) {
                Base.addRight(item, user._id, user.name, [Rights.full_control]);
                item = this.ensureResource(item, collectionname);
            }
            Logger.instanse.silly("DatabaseConnection", "InsertOne", "[" + user.username + "][" + collectionname + "] Adding " + item._type + " " + name + " to database");
            if (!DatabaseConnection.hasAuthorization(user, item, Rights.create)) { throw new Error("Access denied, no authorization to InsertOne " + item._type + " " + name + " to database"); }

            span?.addEvent("encryptentity");
            item = this.encryptentity(item) as T;

            if (collectionname === "users" && item._type === "user" && item.hasOwnProperty("newpassword")) {
                (item as any).passwordhash = await Crypt.hash((item as any).newpassword);
                delete (item as any).newpassword;
            }
            if (collectionname == "mq") {
                if (item._type == "exchange") item.name = item.name.toLowerCase();
                if (item._type == "queue") item.name = item.name.toLowerCase();
            }
            // @ts-ignore
            if (collectionname == "workitems" && item._type == "workitem") await Logger.DBHelper.WorkitemQueueUpdate(item.wiqid);
            // @ts-ignore
            if (collectionname == "workitems" && NoderedUtil.IsNullEmpty(item.state)) item.state = "new";
            // @ts-ignore
            if (collectionname == "workitems" && ["failed", "successful", "retry", "processing"].indexOf(item.state) == -1) item.state = "failed";

            if (collectionname === "users" && !NoderedUtil.IsNullEmpty(item._type) && !NoderedUtil.IsNullEmpty(item.name)) {
                if ((item._type === "user" || item._type === "role") &&
                    (this.WellknownNamesArray.indexOf(item.name) > -1 || this.WellknownNamesArray.indexOf((item as any).username) > -1)) {
                    if (this.WellknownIdsArray.indexOf(item._id) == -1) {
                        if (item._type == "role" && item.name == "administrator") {
                            // temp, allow this
                        } else {
                            Logger.instanse.error("DatabaseConnection", "InsertOne", item.name + " or " + (item as any).username + " is reserved.");
                            throw new Error("Access denied");
                        }
                    }
                }
            }
            if (collectionname === "users" && (item._type === "user" || item._type === "role")) {
                let user2: User = item as any;
                if (item._type === "user" && !NoderedUtil.IsNullEmpty(user2.username)) {
                    user2.username = user2.username.toLowerCase();
                }
                if (item._type === "user" && NoderedUtil.IsNullEmpty(user2.username)) {
                    throw new Error("Username is mandatory for users")
                }

                if (NoderedUtil.IsNullEmpty(user2.customerid)) {
                    if (!NoderedUtil.IsNullEmpty(user.selectedcustomerid)) {
                        customer = await this.getbyid<Customer>(user.selectedcustomerid, "users", jwt, true, span)
                        if (customer != null) {
                            user2.customerid = user.selectedcustomerid;
                        }
                    }
                    if (NoderedUtil.IsNullEmpty(user2.customerid) && !NoderedUtil.IsNullEmpty(user.customerid)) {
                        user2.customerid = user.customerid;
                    }
                }
                if (this.WellknownIdsArray.indexOf(user2._id) > -1) {
                    delete user2.customerid;
                }

                if (!NoderedUtil.IsNullEmpty(user2.customerid)) {
                    customer = await this.getbyid<Customer>(user2.customerid, "users", jwt, true, span)
                    if (user2._type == "user") {
                        if (!user.HasRoleName("customer admins") && !user.HasRoleName("admins")) {
                            if (customer != null) {
                                var isadmin = user.roles.filter(x => x._id == customer.admins);
                                if (isadmin.length == 0) throw new Error("Access denied (not admin) to customer with id " + user2.customerid);
                            } else {
                                throw new Error("Access denied failed locating customerid  " + user2.customerid);
                            }
                        }
                    }

                    if (customer == null) throw new Error("Access denied to customer with id " + user2.customerid + " when updating " + user2._id);
                } else if (user.HasRoleName("customer admins") && !NoderedUtil.IsNullEmpty(user.customerid)) {
                    if (NoderedUtil.IsNullEmpty(user2.selectedcustomerid)) {
                        if (!NoderedUtil.IsNullEmpty(user.selectedcustomerid)) user2.customerid = user.selectedcustomerid;
                        if (NoderedUtil.IsNullEmpty(user2.customerid) && !NoderedUtil.IsNullEmpty(user.customerid)) user2.customerid = user.customerid;
                    }
                    if (NoderedUtil.IsNullEmpty(user2.customerid)) throw new Error("Access denied, no customerid on you, and no customer selected");
                    customer = await this.getbyid<Customer>(user2.customerid, "users", jwt, true, span);
                } else if (Config.multi_tenant && !user.HasRoleName("admins")) {
                    if (!NoderedUtil.IsNullEmpty(user.selectedcustomerid)) user2.customerid = user.selectedcustomerid;
                    if (!NoderedUtil.IsNullEmpty(user2.customerid)) {
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
            j = ((j as any) === 'true' || j === true);
            w = parseInt((w as any));
            item._version = 0;
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
            span?.addEvent("CleanACL");
            item = await this.CleanACL(item, user, collectionname, span);
            if (collectionname === "users" && item._type === "user" && !NoderedUtil.IsNullEmpty(item._id)) {
                Base.addRight(item, item._id, item.name, [Rights.full_control]);
                Base.removeRight(item, item._id, [Rights.delete]);
                span?.addEvent("ensureResource");
                item = this.ensureResource(item, collectionname);
            }
            if (item._type === "role" && collectionname === "users") {
                item = await this.Cleanmembers(item as any, null);
            }

            if (collectionname === "users" && item._type === "user") {
                const u: TokenUser = (item as any);
                if (NoderedUtil.IsNullEmpty(u.validated)) u.validated = false;
                if (NoderedUtil.IsNullEmpty(u.formvalidated)) u.formvalidated = false;
                if (NoderedUtil.IsNullEmpty(u.emailvalidated)) u.emailvalidated = false;
                if (NoderedUtil.IsNullEmpty(u.username)) { throw new Error("Username is mandatory"); }
                if (NoderedUtil.IsNullEmpty(u.name)) { throw new Error("Name is mandatory"); }
                span?.addEvent("FindByUsername");
                Logger.DBHelper.UserRoleUpdate(item, false);
                const exists = await Logger.DBHelper.FindByUsername(u.username, null, span);
                if (exists != null) { throw new Error("Access denied, user  '" + u.username + "' already exists"); }
            }
            if (collectionname === "users" && item._type === "role") {
                const r: Role = (item as any);
                if (NoderedUtil.IsNullEmpty(r.name)) { throw new Error("Name is mandatory"); }
                span?.addEvent("FindByUsername");
                Logger.DBHelper.UserRoleUpdate(item, false);
                const exists2 = await Logger.DBHelper.FindRoleByName(r.name, null, span);
                if (exists2 != null) { throw new Error("Access denied, role '" + r.name + "' already exists"); }
            }

            span?.setAttribute("collection", collectionname);
            span?.setAttribute("username", user.username);
            let options: InsertOneOptions = { writeConcern: { w, j } };
            (options as any).WriteConcern = { w, j };
            if (NoderedUtil.IsNullEmpty(this.replicat)) options = null;

            span?.addEvent("do insert");
            const ot_end = Logger.otel.startTimer();
            const mongodbspan: Span = Logger.otel.startSubSpan("mongodb.insertOne", span);
            // @ts-ignore
            const result: InsertOneResult<T> = await this.db.collection(collectionname).insertOne(item, options);
            Logger.otel.endSpan(mongodbspan);
            Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_insert, DatabaseConnection.otel_label(collectionname, user, "insert"));

            // @ts-ignore
            item._id = result.insertedId;
            if (collectionname === "users" && item._type === "user") {
                Base.addRight(item, item._id, item.name, [Rights.read, Rights.update, Rights.invoke]);

                await this.db.collection("users").updateOne(
                    { _id: WellknownIds.users },
                    { "$push": { members: new Rolemember(item.name, item._id) } }
                );
                //  fsc.updateOne(_query, { $set: { metadata: (q.item as any).metadata } });
                // span?.addEvent("FindRoleByName users");
                // const users: Role = await Logger.DBHelper.FindRoleByName("users", null, span);
                // users.AddMember(item);
                // span?.addEvent("Save Users");
                // await Logger.DBHelper.Save(users, Crypt.rootToken(), span);

                let user2: User = User.assign(item as any);
                // if (!NoderedUtil.IsNullEmpty(user2.customerid)) {
                //     // TODO: Check user has permission to this customer
                //     const custusers: Role = Role.assign(await this.getbyid<Role>(customer.users, "users", jwt, true, span));
                //     if (!NoderedUtil.IsNullUndefinded(custusers)) {
                //         custusers.AddMember(item);
                //         await Logger.DBHelper.Save(custusers, Crypt.rootToken(), span);
                //     } else {
                //         Logger.instanse.debug("DatabaseConnection", "InsertOne", "[" + user.username + "][" + collectionname + "] Failed finding customer users " + customer.users + " role while updating item " + item._id);
                //     }
                // }

                if (Config.validate_emails && user2.emailvalidated || !Config.validate_emails) {
                    let domain: string = user2.username;
                    if (!NoderedUtil.IsNullEmpty(user2.email)) domain = user2.email;
                    if (domain.indexOf("@") > -1) {
                        var userupdate: any = { "$set": {}, "$push": {} };
                        domain = domain.substring(domain.indexOf("@") + 1).toLowerCase();
                        var customers = await this.query<Customer>({ query: { _type: "customer", domains: { $in: [domain] } }, collectionname: "users", jwt: jwt }, span);
                        var doupdate: boolean = false;
                        for (var i = 0; i < customers.length; i++) {
                            if (NoderedUtil.IsNullEmpty(user2.customerid)) {
                                user2.customerid = customers[i]._id;
                                userupdate["$set"]["customerid"] = user2.customerid;
                                doupdate = true;
                            }
                            // @ts-ignore
                            if (NoderedUtil.IsNullEmpty(user2.company)) {
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
                                ace.rights = (new Binary(Buffer.from(ace.rights, "base64"), 0) as any);
                                if (!userupdate["$push"]["_acl"]) {
                                    userupdate["$push"]["_acl"] = { "$each": [] };
                                }
                                userupdate["$push"]["_acl"]["$each"].push(ace);
                                var ace: Ace = new Ace();
                                ace._id = customers[i].admins; ace.name = customers[i].name + " admins";
                                Ace.resetfullcontrol(ace);
                                ace.rights = (new Binary(Buffer.from(ace.rights, "base64"), 0) as any);
                                userupdate["$push"]["_acl"]["$each"].push(ace);
                                await this.db.collection("users").updateOne(
                                    { _id: customers[i].users },
                                    { "$push": { members: new Rolemember(item.name, item._id) } }
                                );
                                doupdate = true;
                            }
                            await Logger.DBHelper.DeleteKey("users" + customers[i].users);

                        }
                        if (doupdate) {
                            await this.db.collection("users").updateOne(
                                { _id: item._id },
                                userupdate
                            );
                            await Logger.DBHelper.DeleteKey("users" + user2._id);
                        }
                    }
                }

                if (!NoderedUtil.IsNullUndefinded(customer) && !NoderedUtil.IsNullEmpty(customer.users)) {
                    await this.db.collection("users").updateOne(
                        { _id: customer.users },
                        { "$push": { members: new Rolemember(item.name, item._id) } }
                    );
                    await Logger.DBHelper.DeleteKey("users" + customer.users);
                }
                await Logger.DBHelper.DeleteKey("users" + WellknownIds.users);
            }
            if (collectionname === "users" && item._type === "role") {
                Base.addRight(item, item._id, item.name, [Rights.read]);
                item = await this.CleanACL(item, user, collectionname, span);
                const ot_end = Logger.otel.startTimer();
                const mongodbspan: Span = Logger.otel.startSubSpan("mongodb.replaceOne", span);
                await this.db.collection(collectionname).replaceOne({ _id: item._id }, item);
                Logger.otel.endSpan(mongodbspan);
                Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_replace, DatabaseConnection.otel_label(collectionname, user, "replace"));
                // if (item._type === "role") {
                //     const r: Role = (item as any);
                //     if (r.members.length > 0) {
                //         if (Config.cache_store_type == "redis" || Config.cache_store_type == "mongodb") {
                //             // we clear all since we might have cached tons of userrole mappings
                //             Logger.DBHelper.clearCache("insertone in " + collectionname + " collection for a " + item._type + " object");
                //         } else if (Config.enable_openflow_amqp) {
                //             amqpwrapper.Instance().send("openflow", "", { "command": "clearcache" }, 20000, null, "", 1);
                //         } 
                //     }
                // }
            }
            if (collectionname === "users") {
                await Logger.DBHelper.UserRoleUpdate(item, false);
            }
            if (collectionname === "mq") {
                if (item._type == "queue") await Logger.DBHelper.QueueUpdate(item._id, item.name, false);
                if (item._type == "exchange") await Logger.DBHelper.ExchangeUpdate(item._id, item.name, false);
                if (item._type == "workitemqueue") await Logger.DBHelper.WorkitemQueueUpdate(item._id, false);
            }
            if (collectionname === "config" && item._type === "oauthclient") {
                if (user.HasRoleName("admins")) {
                    setTimeout(() => OAuthProvider.LoadClients(), 1000);
                }
            }
            if (collectionname === "config" && item._type === "restriction") {
                this.EntityRestrictions = null;
            }
            if (collectionname === "config" && item._type === "provider" && !Config.supports_watch) {
                await Logger.DBHelper.ClearProviders();
                await LoginProvider.RegisterProviders(WebServer.app, Config.baseurl());
            }
            span?.addEvent("traversejsondecode");
            DatabaseConnection.traversejsondecode(item);
            Logger.instanse.debug("DatabaseConnection", "InsertOne", "[" + user.username + "][" + collectionname + "] inserted " + item.name);
        } catch (error) {
            Logger.instanse.error("DatabaseConnection", "InsertOne", error);
            span?.recordException(error);
            throw error;
        }
        finally {
            Logger.otel.endSpan(span);
        }
        return item;
    }
    async InsertMany<T extends Base>(items: T[], collectionname: string, w: number, j: boolean, jwt: string, parent: Span): Promise<T[]> {
        const span: Span = Logger.otel.startSubSpan("db.InsertMany", parent);
        let result: T[] = [];
        try {
            if (NoderedUtil.IsNullUndefinded(items) || items.length == 0) { throw Error("Cannot create null item"); }
            if (NoderedUtil.IsNullEmpty(jwt)) {
                throw new Error("jwt is null");
            }
            await this.connect(span);
            const user = await Crypt.verityToken(jwt);
            if (user.dblocked && !user.HasRoleName("admins")) throw new Error("Access denied (db locked) could be due to hitting quota limit for " + user.username);
            span?.setAttribute("collection", collectionname);
            span?.setAttribute("username", user.username);
            let bulkInsert = this.db.collection(collectionname).initializeUnorderedBulkOp();
            let x = 1000
            let counter = 0
            let date = new Date()
            date.setMonth(date.getMonth() - 1);
            let tempresult: any[] = [];
            let hadWorkitemQueue = false;
            for (let i = 0; i < items.length; i++) {
                let item = this.ensureResource(items[i], collectionname);
                DatabaseConnection.traversejsonencode(item);

                if (!await this.CheckEntityRestriction(user, collectionname, item, span)) {
                    continue;
                }

                let name = item.name;
                if (NoderedUtil.IsNullEmpty(name)) name = item._name;
                if (NoderedUtil.IsNullEmpty(name)) name = "Unknown";
                item._createdby = user.name;
                item._createdbyid = user._id;
                item._created = new Date(new Date().toISOString());
                item._modifiedby = user.name;
                item._modifiedbyid = user._id;
                item._modified = item._created;
                const hasUser: Ace = item._acl.find(e => e._id === user._id);
                if ((hasUser === null || hasUser === undefined)) {
                    Base.addRight(item, user._id, user.name, [Rights.full_control]);
                    item = this.ensureResource(item, collectionname);
                }
                Logger.instanse.silly("DatabaseConnection", "InsertMany", "[" + user.username + "][" + collectionname + "] Adding " + item._type + " " + name + " to database");
                if (!DatabaseConnection.hasAuthorization(user, item, Rights.create)) { throw new Error("Access denied, no authorization to InsertOne " + item._type + " " + name + " to database"); }

                item = this.encryptentity(item) as T;
                var user2: User = item as any;

                if (collectionname === "users" && item._type === "user" && item.hasOwnProperty("newpassword")) {
                    user2.passwordhash = await Crypt.hash((item as any).newpassword);
                    delete (item as any).newpassword;
                }
                if (collectionname == "mq" && !NoderedUtil.IsNullEmpty(item.name)) {
                    if (item._type == "exchange") item.name = item.name.toLowerCase();
                    if (item._type == "queue") item.name = item.name.toLowerCase();
                    if (item._type == "workitemqueue") hadWorkitemQueue = true
                }
                // @ts-ignore
                if (collectionname == "workitems" && NoderedUtil.IsNullEmpty(item.state)) item.state = "new";
                // @ts-ignore
                if (collectionname == "workitems" && ["failed", "successful", "retry", "processing"].indexOf(item.state) == -1) item.state = "failed";
                if (collectionname === "users" && !NoderedUtil.IsNullEmpty(item._type) && !NoderedUtil.IsNullEmpty(item.name)) {
                    if ((item._type === "user" || item._type === "role") &&
                        (this.WellknownNamesArray.indexOf(item.name) > -1 || this.WellknownNamesArray.indexOf(user2.username) > -1)) {
                        if (this.WellknownIdsArray.indexOf(item._id) == -1) {
                            if (item._type == "role" && item.name == "administrator") {
                                // temp, allow this
                            } else {
                                Logger.instanse.error("DatabaseConnection", "InsertMany", item.name + " or " + (item as any).username + " is reserved.");
                                throw new Error("Access denied");
                            }
                        }
                    }
                    if (item._type === "user" && !NoderedUtil.IsNullEmpty(user2.username)) {
                        user2.username = user2.username.toLowerCase();
                    }
                    if (item._type === "user" && NoderedUtil.IsNullEmpty(user2.username)) {
                        throw new Error("Username is mandatory for users")
                    }
                    await Logger.DBHelper.UserRoleUpdate(item, false);
                    // if (item._type === "role") {
                    //     const r: Role = item as any;
                    //     if (r.members.length > 0) {
                    //         if (Config.cache_store_type == "redis" || Config.cache_store_type == "mongodb") {
                    //             // we clear all since we might have cached tons of userrole mappings
                    //             Logger.DBHelper.clearCache("insertmany in " + collectionname + " collection for a " + item._type + " object");
                    //         } else if (Config.enable_openflow_amqp) {
                    //             amqpwrapper.Instance().send("openflow", "", { "command": "clearcache" }, 20000, null, "", 1);
                    //         } 
                    //     }
                    // }
                }
                item._version = 0;
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
                item = await this.CleanACL(item, user, collectionname, span);
                if (item._type === "role" && collectionname === "users") {
                    item = await this.Cleanmembers(item as any, null);
                }

                if (collectionname === "users" && item._type === "user") {
                    const u: TokenUser = (item as any);
                    if (NoderedUtil.IsNullEmpty(u.validated)) u.validated = false;
                    if (NoderedUtil.IsNullEmpty(u.formvalidated)) u.formvalidated = false;
                    if (NoderedUtil.IsNullEmpty(u.emailvalidated)) u.emailvalidated = false;
                    if (NoderedUtil.IsNullEmpty(u.username)) { throw new Error("Username is mandatory"); }
                    if (NoderedUtil.IsNullEmpty(u.name)) { throw new Error("Name is mandatory"); }
                    span?.addEvent("FindByUsername");
                    const exists = await Logger.DBHelper.FindByUsername(u.username, null, span);
                    if (exists != null) { throw new Error("Access denied, user  '" + u.username + "' already exists"); }
                }
                if (collectionname === "users" && item._type === "role") {
                    const r: Role = (item as any);
                    if (NoderedUtil.IsNullEmpty(r.name)) { throw new Error("Name is mandatory"); }
                    span?.addEvent("FindByUsername");
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
                    const mongodbspan_inner: Span = Logger.otel.startSubSpan("mongodb.bulkexecute", span);
                    tempresult = tempresult.concat(bulkInsert.execute())
                    Logger.otel.endSpan(mongodbspan_inner);
                    Logger.otel.endTimer(ot_end_inner, DatabaseConnection.mongodb_insertmany, DatabaseConnection.otel_label(collectionname, user, "insertmany"));
                    bulkInsert = this.db.collection(collectionname).initializeUnorderedBulkOp()
                }
            }
            const ot_end = Logger.otel.startTimer();
            const mongodbspan: Span = Logger.otel.startSubSpan("mongodb.bulkexecute", span);
            tempresult = tempresult.concat(bulkInsert.execute())
            Logger.otel.endSpan(mongodbspan);
            Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_insertmany, DatabaseConnection.otel_label(collectionname, user, "insertmany"));

            for (let y = 0; y < items.length; y++) {
                let item = items[y];
                if (collectionname === "users" && item._type === "user") {
                    Base.addRight(item, item._id, item.name, [Rights.read, Rights.update, Rights.invoke]);
                    span?.addEvent("FindRoleByName");
                    // const users: Role = await Logger.DBHelper.FindRoleByName("users", null, span);
                    // users.AddMember(item);
                    span?.addEvent("CleanACL");
                    item = await this.CleanACL(item, user, collectionname, span);
                    // span?.addEvent("Save");
                    // await Logger.DBHelper.Save(users, Crypt.rootToken(), span);
                    await this.db.collection("users").updateOne(
                        { _id: WellknownIds.users },
                        { "$push": { members: new Rolemember(item.name, item._id) } }
                    );
                    await Logger.DBHelper.DeleteKey("users" + WellknownIds.users);

                    const user2: TokenUser = item as any;
                    await Logger.DBHelper.EnsureNoderedRoles(user2, Crypt.rootToken(), false, span);
                }
                if (collectionname === "users" && item._type === "role") {
                    Base.addRight(item, item._id, item.name, [Rights.read]);
                    item = await this.CleanACL(item, user, collectionname, span);
                    const ot_end_inner2 = Logger.otel.startTimer();
                    const mongodbspan_inner2: Span = Logger.otel.startSubSpan("mongodb.replaceOne", span);
                    await this.db.collection(collectionname).replaceOne({ _id: item._id }, item);
                    Logger.otel.endSpan(mongodbspan_inner2);
                    Logger.otel.endTimer(ot_end_inner2, DatabaseConnection.mongodb_replace, DatabaseConnection.otel_label(collectionname, user, "replace"));
                }
                if (collectionname === "config" && item._type === "oauthclient") {
                    if (user.HasRoleName("admins")) {
                        setTimeout(() => OAuthProvider.LoadClients(), 1000);
                    }
                }
                span?.addEvent("traversejsondecode");
                DatabaseConnection.traversejsondecode(item);
            }
            if (hadWorkitemQueue) await Logger.DBHelper.WorkitemQueueUpdate(null, false);
            result = items;
            Logger.instanse.verbose("DatabaseConnection", "InsertMany", "[" + user.username + "][" + collectionname + "] inserted " + counter + " items in database");
        } catch (error) {
            Logger.instanse.error("DatabaseConnection", "InsertMany", error);
            span?.recordException(error);
            throw error;
        }
        finally {
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
    async _UpdateOne<T extends Base>(query: any, item: T, collectionname: string, w: number, j: boolean, jwt: string, parent: Span): Promise<T> {
        let q = new UpdateOneMessage();
        q.query = query; q.item = item; q.collectionname = collectionname; q.w = w; q.j = j; q.jwt = jwt;
        if (q.w < 1) q.w = 1; // set minimu, to avoid "More than one item was updated !!!"
        q = await this.UpdateOne(q, parent);
        if (!NoderedUtil.IsNullUndefinded(q.opresult)) {
            if (q.opresult.modifiedCount === 0) {
                throw Error("item not found!");
            } else if (q.opresult.modifiedCount !== 1) {
                throw Error("More than one item was updated !!!");
            }
            if (!NoderedUtil.IsNullUndefinded(q.item) && NoderedUtil.IsNullUndefinded(query)) {
                return q.item as any;
            }
            return q.opresult;
        } else {
            throw Error("UpdateOne failed!!!");
        }
    }
    async UpdateOne<T extends Base>(q: UpdateOneMessage, parent: Span): Promise<UpdateOneMessage> {
        const span: Span = Logger.otel.startSubSpan("db.UpdateOne", parent);
        let customer: Customer = null;
        try {
            if (q.collectionname == "audit") {
                throw Error("Access denied");
            }
            let itemReplace: boolean = true;
            if (q === null || q === undefined) { throw Error("UpdateOneMessage cannot be null"); }
            if (q.item === null || q.item === undefined) { throw Error("Cannot update null item"); }
            await this.connect(span);
            const user: TokenUser = await Crypt.verityToken(q.jwt);
            if (user.dblocked && !user.HasRoleName("admins")) throw new Error("Access denied (db locked) could be due to hitting quota limit for " + user.username);
            if (q.query === null || q.query === undefined) {
                if (!DatabaseConnection.hasAuthorization(user, (q.item as Base), Rights.update)) {
                    throw new Error("Access denied, no authorization to UpdateOne with current ACL");
                }
            }
            if (q.collectionname === "files") { q.collectionname = "fs.files"; }

            let original: T = null;
            // assume empty query, means full document, else update document
            if (q.query === null || q.query === undefined) {
                // this will add an _acl so needs to be after we checked old item
                if (!q.item.hasOwnProperty("_id")) {
                    throw Error("Cannot update item without _id");
                }
                let name = q.item.name;
                if (NoderedUtil.IsNullEmpty(name)) name = (q.item as any)._name;
                if (NoderedUtil.IsNullEmpty(name)) name = "Unknown";
                if (NoderedUtil.IsNullUndefinded((q as any).original)) {
                    original = await this.getbyid<T>(q.item._id, q.collectionname, q.jwt, false, span);
                } else {
                    original = (q as any).original;
                }
                if (!original) {
                    throw Error("item not found or Access Denied");
                }
                if (!DatabaseConnection.hasAuthorization(user, original, Rights.update)) {
                    throw new Error("Access denied, no authorization to UpdateOne " + q.item._type + " " + name + " to database");
                }

                if(q.collectionname == "users") {
                    await Logger.DBHelper.UserRoleUpdate(original, false);
                }

                if (q.collectionname === "users" && !NoderedUtil.IsNullEmpty(q.item._type) && !NoderedUtil.IsNullEmpty(q.item.name)) {
                    if ((q.item._type === "user" || q.item._type === "role") &&
                        (this.WellknownNamesArray.indexOf(q.item.name) > -1 || this.WellknownNamesArray.indexOf((q.item as any).username) > -1)) {
                        if (this.WellknownIdsArray.indexOf(q.item._id) == -1) {
                            if (q.item._type == "role" && q.item.name == "administrator") {
                                // temp, allow this
                            } else {
                                Logger.instanse.error("DatabaseConnection", "UpdateOne", q.item.name + " or " + (q.item as any).username + " is reserved.");
                                throw new Error("Access denied");
                            }

                        }
                    }
                }
                if (q.collectionname === "users" && (q.item._type === "user" || q.item._type === "role")) {
                    let user2: User = q.item as any;
                    if (this.WellknownIdsArray.indexOf(q.item._id) > -1) {
                        delete user2.customerid;
                    }
                    if (user2._type === "user" && !NoderedUtil.IsNullEmpty(user2.username)) {
                        user2.username = user2.username.toLowerCase();
                    }
                    if (user2._type === "user" && NoderedUtil.IsNullEmpty(user2.username)) {
                        throw new Error("Username is mandatory for users")
                    }
                    if (user2._type === "user" && user._id == user2._id && user2.disabled) {
                        throw new Error("Cannot disable yourself")
                    }
                    if (!NoderedUtil.IsNullEmpty(user2.customerid)) {
                        // User can update, just not created ?
                        // if (!user.HasRoleName("customer admins") && !user.HasRoleName("admins")) throw new Error("Access denied (not admin) to customer with id " + user2.customerid);
                        customer = await this.getbyid<Customer>(user2.customerid, "users", q.jwt, true, span)
                        if (customer == null) throw new Error("Access denied to customer with id " + user2.customerid + " when updating " + user2._id);
                    } else if (user.HasRoleName("customer admins") && !NoderedUtil.IsNullEmpty(user.customerid)) {
                        customer = null;
                    } else if (Config.multi_tenant && !user.HasRoleName("admins")) {
                    }
                    if (customer != null && !NoderedUtil.IsNullEmpty(customer.admins)) {
                        const custadmins = await this.getbyid<Role>(customer.admins, "users", q.jwt, true, span);
                        if (!NoderedUtil.IsNullEmpty(custadmins)) {
                            Base.addRight(q.item, custadmins._id, custadmins.name, [Rights.full_control]);
                            if (q.item._id == customer.admins || q.item._id == customer.users) {
                                Base.removeRight(q.item, custadmins._id, [Rights.delete]);
                            }
                        } else {
                            Logger.instanse.warn("DatabaseConnection", "UpdateOne", "[" + user.username + "][" + q.collectionname + "] Failed locating customer admins role " + customer.admins + " while updating " + q.item._id + " in database");
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
                            if (!user.HasRoleName("admins")) {
                                q.item[key] = original[key];
                            }
                        }
                        if ((key == "dbusage" || key == "dblocked") && q.collectionname == "users") {
                            if (!user.HasRoleName("admins")) {
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
                    if (user._id != WellknownIds.root && original._type != q.item._type && !await this.CheckEntityRestriction(user, q.collectionname, q.item, span)) {
                        throw Error("Create " + q.item._type + " access denied");
                    }
                    const hasUser: Ace = q.item._acl.find(e => e._id === user._id);
                    if (NoderedUtil.IsNullUndefinded(hasUser) && q.item._acl.length === 0) {
                        Base.addRight(q.item, user._id, user.name, [Rights.full_control]);
                        q.item = this.ensureResource(q.item, q.collectionname);
                    }
                    if (q.collectionname === "users" && q.item._type === "user") {
                        let u: User = q.item as User;
                        if (NoderedUtil.IsNullEmpty(u.validated)) u.validated = false;
                        if (NoderedUtil.IsNullEmpty(u.formvalidated)) u.formvalidated = false;
                        if (NoderedUtil.IsNullEmpty(u.emailvalidated)) u.emailvalidated = false;
                        Base.addRight(q.item, q.item._id, q.item.name, [Rights.read, Rights.update, Rights.invoke]);
                        q.item = this.ensureResource(q.item, q.collectionname);
                    }

                    DatabaseConnection.traversejsonencode(q.item);
                    q.item = this.encryptentity(q.item);
                } else {
                    if (!DatabaseConnection.hasAuthorization(user, (q.item as any).metadata, Rights.update)) {
                        throw new Error("Access denied, no authorization to UpdateOne file " + (q.item as any).filename + " to database");
                    }
                    if (!DatabaseConnection.hasAuthorization(user, (original as any).metadata, Rights.update)) {
                        throw new Error("Access denied, no authorization to UpdateOne file " + (original as any).filename + " to database");
                    }
                    (q.item as any).metadata = Base.assign((q.item as any).metadata);
                    (q.item as any).metadata._modifiedby = user.name;
                    (q.item as any).metadata._modifiedbyid = user._id;
                    (q.item as any).metadata._modified = new Date(new Date().toISOString());
                    // now add all _ fields to the new object
                    const keys: string[] = Object.keys((original as any).metadata);
                    for (let i: number = 0; i < keys.length; i++) {
                        let key: string = keys[i];
                        if (key === "_created") {
                            (q.item as any).metadata[key] = new Date((original as any).metadata[key]);
                        } else if (key === "_type") {
                            (q.item as any).metadata[key] = (original as any).metadata[key];
                        } else if (key === "_createdby" || key === "_createdbyid") {
                            (q.item as any).metadata[key] = (original as any).metadata[key];
                        } else if (key === "_modifiedby" || key === "_modifiedbyid" || key === "_modified") {
                            // allready updated
                        } else if (key.indexOf("_") === 0) {
                            if (!(q.item as any).metadata.hasOwnProperty(key)) {
                                (q.item as any).metadata[key] = (original as any).metadata[key]; // add missing key
                            } else if ((q.item as any).metadata[key] === null) {
                                delete (q.item as any).metadata[key]; // remove key
                            } else {
                                // key allready exists, might been updated since last save
                            }
                        }
                    }
                    if ((q.item as any).metadata._acl === null || (q.item as any).metadata._acl === undefined || !Array.isArray((q.item as any).metadata._acl)) {
                        (q.item as any).metadata._acl = (original as any).metadata._acl;
                        (q.item as any).metadata._version = (original as any).metadata._version;
                        if (!DatabaseConnection.hasAuthorization(user, (q.item as any).metadata, Rights.update)) {
                            throw new Error("Access denied, no authorization to UpdateOne with current ACL");
                        }

                    }
                    (q.item as any).metadata = this.ensureResource((q.item as any).metadata, q.collectionname);
                    DatabaseConnection.traversejsonencode(q.item);
                    (q.item as any).metadata = this.encryptentity((q.item as any).metadata);
                    const hasUser: Ace = (q.item as any).metadata._acl.find(e => e._id === user._id);
                    if ((hasUser === null || hasUser === undefined) && (q.item as any).metadata._acl.length === 0) {
                        Base.addRight((q.item as any).metadata, user._id, user.name, [Rights.full_control]);
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
                    if (q.item._type === 'instance' && q.collectionname === 'workflows') {
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
                if (typeof json !== 'string') {
                    json = JSON.stringify(json);
                }
                q.item = JSON.parse(json, (key, value) => {
                    if (typeof value === 'string' && value.match(isoDatePattern)) {
                        return new Date(value); // isostring, so cast to js date
                    } else if (value != null && value != undefined && value.toString().indexOf("__REGEXP ") === 0) {
                        const m = value.split("__REGEXP ")[1].match(/\/(.*)\/(.*)?/);
                        return new RegExp(m[1], m[2] || "");
                    } else
                        return value; // leave any other value as-is
                });

                itemReplace = false;
                if (q.item["$set"] !== null && q.item["$set"] !== undefined) {
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
                (q.item as any).passwordhash = await Crypt.hash((q.item as any).newpassword);
                delete (q.item as any).newpassword;
            }
            if (q.collectionname === "config" && q.item._type === "oauthclient") {
                if (user.HasRoleName("admins")) {
                    setTimeout(() => OAuthProvider.LoadClients(), 1000);
                }
            }
            Logger.instanse.silly("DatabaseConnection", "UpdateOne", "[" + user.username + "][" + q.collectionname + "] Updating " + (q.item.name || q.item._name) + " in database");

            if (q.query === null || q.query === undefined) {
                const id: string = q.item._id;
                const safeid = safeObjectID(id);
                q.query = { _id: id };
                if (safeid != null) {
                    q.query = { $or: [{ _id: id }, { _id: safeid }] };
                }
            }
            let _query: Object = {};
            if (DatabaseConnection.usemetadata(q.collectionname)) {
                _query = { $and: [q.query, this.getbasequery(user, "metadata._acl", [Rights.update])] };
            } else {
                // todo: enforcer permissions when fetching _hist ?
                _query = { $and: [q.query, this.getbasequery(user, "_acl", [Rights.update])] };
            }
            if (Config.api_bypass_perm_check) { _query = q.query; }

            q.j = ((q.j as any) === 'true' || q.j === true);
            if ((q.w as any) !== "majority") q.w = parseInt((q.w as any));

            let options: UpdateOptions = { writeConcern: { w: q.w, j: q.j }, upsert: false };
            (options as any).WriteConcern = { w: q.w, j: q.j };
            if (NoderedUtil.IsNullEmpty(this.replicat)) options = null;

            q.opresult = null;
            try {
                if (itemReplace) {
                    if (!DatabaseConnection.usemetadata(q.collectionname)) {
                        q.item = await this.CleanACL(q.item, user, q.collectionname, span);
                    } else {
                        (q.item as any).metadata = await this.CleanACL((q.item as any).metadata, user, q.collectionname, span);
                    }
                    if (q.item._type === "role" && q.collectionname === "users") {
                        q.item = await this.Cleanmembers(q.item as any, original);
                        // DBHelper.cached_roles = [];
                    }
                    // if (q.item._type === "role" && q.collectionname === "users") {
                    //     if (Config.cache_store_type == "redis" || Config.cache_store_type == "mongodb") {
                    //         Logger.DBHelper.clearCache("updateone in " + q.collectionname + " collection for a " + q.item._type + " object");
                    //     } else if (Config.enable_openflow_amqp) {
                    //         amqpwrapper.Instance().send("openflow", "", { "command": "clearcache" }, 20000, null, "", 1);
                    //     } 
                    // }
                    if (q.collectionname === "mq") {
                        if (q.item._type == "workitemqueue") await Logger.DBHelper.WorkitemQueueUpdate(q.item._id, false);
                        if (!NoderedUtil.IsNullEmpty(q.item.name)) {
                            if (q.item._type == "exchange") q.item.name = q.item.name.toLowerCase();
                            if (q.item._type == "queue") q.item.name = q.item.name.toLowerCase();
                        }
                        if (q.item._type == "queue") await Logger.DBHelper.QueueUpdate(q.item._id, q.item.name, false);
                        if (q.item._type == "exchange") await Logger.DBHelper.ExchangeUpdate(q.item._id, q.item.name, false);
                    }
                    // @ts-ignore
                    if (q.collectionname == "workitems" && q.item._type == "workitem") await Logger.DBHelper.WorkitemQueueUpdate(q.item.wiqid);

                    if (!DatabaseConnection.usemetadata(q.collectionname)) {
                        try {
                            const ot_end = Logger.otel.startTimer();
                            const mongodbspan: Span = Logger.otel.startSubSpan("mongodb.replaceOne", span);
                            q.opresult = await this.db.collection(q.collectionname).replaceOne(_query, q.item, options);
                            Logger.otel.endSpan(mongodbspan);
                            Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_replace, DatabaseConnection.otel_label(q.collectionname, user, "replace"));
                            Logger.instanse.debug("DatabaseConnection", "UpdateOne", "[" + user.username + "][" + q.collectionname + "] updated " + q.item.name);
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
                            Logger.instanse.error("DatabaseConnection", "UpdateOne", "[" + user.username + "][" + q.collectionname + "] opresult is null !!");
                        }
                    } else {
                        const fsc = Config.db.db.collection(q.collectionname);
                        const ot_end = Logger.otel.startTimer();
                        const mongodbspan: Span = Logger.otel.startSubSpan("mongodb.replaceOne", span);
                        q.opresult = await fsc.updateOne(_query, { $set: { metadata: (q.item as any).metadata } });
                        Logger.otel.endSpan(mongodbspan);
                        Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_update, DatabaseConnection.otel_label(q.collectionname, user, "update"));
                        if ((q.opresult && q.opresult.matchedCount == 0) && (q.w != 0)) {
                            throw new Error("ReplaceOne failed, matched 0 documents with query {_id: '" + q.item._id + "'}");
                        }
                        if (q.opresult == null) {
                            Logger.instanse.error("DatabaseConnection", "UpdateOne", "[" + user.username + "][" + q.collectionname + "] opresult is null !!");
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
                        ['$inc', '$mul', '$set', '$unset'].forEach(t => {
                            if (q.item[t] !== undefined) {
                                delete q.item[t].username;
                                delete q.item[t].dbusage;
                                delete q.item[t].dblocked;
                            }
                        })
                    }
                    const ot_end = Logger.otel.startTimer();
                    const mongodbspan: Span = Logger.otel.startSubSpan("mongodb.updateOne", span);
                    q.opresult = await this.db.collection(q.collectionname).updateOne(_query, q.item, options);
                    Logger.instanse.debug("DatabaseConnection", "UpdateOne", "[" + user.username + "][" + q.collectionname + "] updated " + q.opresult.modifiedCount + " items");
                    Logger.otel.endSpan(mongodbspan);
                    Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_update, DatabaseConnection.otel_label(q.collectionname, user, "update"));
                }
                if (!DatabaseConnection.usemetadata(q.collectionname)) {
                    q.item = this.decryptentity(q.item);
                } else {
                    (q.item as any).metadata = this.decryptentity<T>((q.item as any).metadata);
                }
                if (q.collectionname === "config" && q.item._type === "restriction") {
                    this.EntityRestrictions = null;
                }
                if(q.collectionname == "users") {
                    await Logger.DBHelper.UserRoleUpdate(original, false);
                }
                if (q.collectionname === "config" && q.item._type === "provider" && !Config.supports_watch) {
                    await Logger.DBHelper.ClearProviders();
                    await LoginProvider.RegisterProviders(WebServer.app, Config.baseurl());
                }
                DatabaseConnection.traversejsondecode(q.item);
                if (q.collectionname === "users" && q.item._type === "user") {
                    let user2: User = User.assign(q.item as any);

                    if (Config.validate_emails && user2.emailvalidated || !Config.validate_emails) {
                        let domain: string = user2.username;
                        if (!NoderedUtil.IsNullEmpty(user2.email)) domain = user2.email;
                        if (domain.indexOf("@") > -1) {
                            var userupdate: any = { "$set": {}, "$push": {} };
                            domain = domain.substring(domain.indexOf("@") + 1).toLowerCase();
                            var customers = await this.query<Customer>({ query: { _type: "customer", domains: { $in: [domain] } }, collectionname: "users", jwt: q.jwt }, span);
                            var doupdate: boolean = false;
                            for (var i = 0; i < customers.length; i++) {
                                if (NoderedUtil.IsNullEmpty(user2.customerid)) {
                                    user2.customerid = customers[i]._id;
                                    userupdate["$set"]["customerid"] = user2.customerid;
                                    doupdate = true;
                                }
                                // @ts-ignore
                                if (NoderedUtil.IsNullEmpty(user2.company)) {
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
                                    ace.rights = (new Binary(Buffer.from(ace.rights, "base64"), 0) as any);
                                    if (!userupdate["$push"]["_acl"]) {
                                        userupdate["$push"]["_acl"] = { "$each": [] };
                                    }
                                    userupdate["$push"]["_acl"]["$each"].push(ace);
                                    var ace: Ace = new Ace();
                                    ace._id = customers[i].admins; ace.name = customers[i].name + " admins";
                                    Ace.resetfullcontrol(ace);
                                    ace.rights = (new Binary(Buffer.from(ace.rights, "base64"), 0) as any);
                                    userupdate["$push"]["_acl"]["$each"].push(ace);
                                    await this.db.collection("users").updateOne(
                                        { _id: customers[i].users },
                                        { "$push": { members: new Rolemember(q.item.name, q.item._id) } }
                                    );
                                    doupdate = true;
                                }
                                await Logger.DBHelper.DeleteKey("users" + customers[i].users);

                            }
                            if (doupdate) {
                                await this.db.collection("users").updateOne(
                                    { _id: q.item._id },
                                    userupdate
                                );
                                await Logger.DBHelper.DeleteKey("users" + user2._id);
                            }
                        }
                    }


                    if (customer != null && !NoderedUtil.IsNullEmpty(user2.customerid) && user2._id != customer.users && user2._id != customer.admins && user2._id != WellknownIds.root) {
                        // TODO: Check user has permission to this customer
                        let custusers: Role = await this.getbyid<Role>(customer.users, "users", q.jwt, true, span);
                        if (custusers != null) custusers = Role.assign(custusers);
                        if (custusers != null && !custusers.IsMember(q.item._id)) {
                            custusers = Role.assign(await this.getbyid<Role>(customer.users, "users", q.jwt, true, span));
                            custusers.AddMember(q.item);
                            await Logger.DBHelper.Save(custusers, Crypt.rootToken(), span);
                            await Logger.DBHelper.DeleteKey("users" + q.item._id);
                        }
                    } else {
                        await Logger.DBHelper.DeleteKey("users" + q.item._id);
                    }
                    await Logger.DBHelper.EnsureNoderedRoles(user2, Crypt.rootToken(), false, span);
                }

                q.result = q.item;
            } catch (error) {
                throw error;
            }
            return q;
        } catch (error) {
            Logger.instanse.error("DatabaseConnection", "UpdateOne", error);
            span?.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
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
    async UpdateDocument<T extends Base>(q: UpdateManyMessage, parent: Span): Promise<UpdateManyMessage> {
        const span: Span = Logger.otel.startSubSpan("db.UpdateMany", parent);
        try {
            if (q === null || q === undefined) { throw Error("UpdateManyMessage cannot be null"); }
            if (q.item === null || q.item === undefined) { throw Error("Cannot update null item"); }
            await this.connect();
            const user: TokenUser = await Crypt.verityToken(q.jwt);
            if (user.dblocked && !user.HasRoleName("admins")) throw new Error("Access denied (db locked) could be due to hitting quota limit for " + user.username);
            if (!DatabaseConnection.hasAuthorization(user, q.item, Rights.update)) { throw new Error("Access denied, no authorization to UpdateMany"); }

            if (q.collectionname === "users" && q.item._type === "user" && q.item.hasOwnProperty("newpassword")) {
                (q.item as any).passwordhash = await Crypt.hash((q.item as any).newpassword);
                delete (q.item as any).newpassword;
            }
            let json: string = q.item as any;
            if (typeof json !== 'string') {
                json = JSON.stringify(json);
            }
            q.item = JSON.parse(json, (key, value) => {
                if (key === "_acl") {
                    if (Array.isArray(value)) {
                        for (let i = 0; i < value.length; i++) {
                            const a = value[i];
                            if (typeof a.rights === "string") {
                                a.rights = (new Binary(Buffer.from(a.rights, "base64"), 0) as any);
                            }
                        }
                    }
                }
                if (typeof value === 'string' && value.match(isoDatePattern)) {
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
                    delete (q.query as any)._id;
                    (q.query as any).$or = [{ _id: id }, { _id: safeObjectID(id) }];
                }
            }
            let _query: Object = {};
            if (!NoderedUtil.IsNullEmpty(Config.stripe_api_secret) && q.collectionname === "users") {
                if (!user.HasRoleId(WellknownIds.admins)) throw new Error("Access denied, no authorization to UpdateMany");
            }
            if (q.collectionname === "files") { q.collectionname = "fs.files"; }
            if (DatabaseConnection.usemetadata(q.collectionname)) {
                _query = { $and: [q.query, this.getbasequery(user, "metadata._acl", [Rights.update])] };
            } else {
                // todo: enforcer permissions when fetching _hist ?
                _query = { $and: [q.query, this.getbasequery(user, "_acl", [Rights.update])] };
            }

            if ((q.item["$set"]) === undefined) { (q.item["$set"]) = {} };
            if (q.item["$set"]._type) delete q.item["$set"]._type;
            (q.item["$set"])._modifiedby = user.name;
            (q.item["$set"])._modifiedbyid = user._id;
            (q.item["$set"])._modified = new Date(new Date().toISOString());

            if (q.collectionname == "users") {
                ['$inc', '$mul', '$set', '$unset'].forEach(t => {
                    if (q.item[t] !== undefined) {
                        delete q.item[t].username;
                        delete q.item[t].dbusage;
                        delete q.item[t].dblocked;
                    }
                })
            }

            Logger.instanse.silly("DatabaseConnection", "UpdateOne", "[" + user.username + "][" + q.collectionname + "] UpdateMany " + (q.item.name || q.item._name) + " in database");

            q.j = ((q.j as any) === 'true' || q.j === true);
            if ((q.w as any) !== "majority") q.w = parseInt((q.w as any));
            let options: UpdateOptions = { writeConcern: { w: q.w, j: q.j } };
            (options as any).WriteConcern = { w: q.w, j: q.j };
            if (NoderedUtil.IsNullEmpty(this.replicat)) options = null;
            try {
                const mongodbspan: Span = Logger.otel.startSubSpan("mongodb.updateMany", span);
                q.opresult = await this.db.collection(q.collectionname).updateMany(_query, q.item, options);
                Logger.otel.endSpan(mongodbspan);
                if (q.opresult) Logger.instanse.debug("DatabaseConnection", "UpdateOne", "[" + user.username + "][" + q.collectionname + "] updated " + q.opresult.modifiedCount + " items");
                return q;
            } catch (error) {
                throw error;
            }
        } catch (error) {
            span?.recordException(error);
            throw error;
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
    async InsertOrUpdateOne<T extends Base>(q: InsertOrUpdateOneMessage, parent: Span): Promise<InsertOrUpdateOneMessage> {
        return this._InsertOrUpdateOne(q, parent);
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
        if (NoderedUtil.IsNullUndefinded(q)) return;
        const span: Span = Logger.otel.startSubSpan("db.InsertOrUpdateOne", parent);
        let user: TokenUser = (q as any).user;
        try {
            user = (q as any).user;
            if (NoderedUtil.IsNullUndefinded(user)) {
                user = await Crypt.verityToken(q.jwt);
            } else {
                delete (q as any).user;
            }
            Logger.instanse.verbose("DatabaseConnection", "InsertOrUpdateOne", "[" + user?.username + "][" + q.collectionname + "] begin");
            await DatabaseConnection.InsertOrUpdateOneSemaphore.down();
            let query: any = null;
            if (q.uniqeness !== null && q.uniqeness !== undefined && q.uniqeness !== "") {
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

            if (user.dblocked && !user.HasRoleName("admins")) throw new Error("Access denied (db locked) could be due to hitting quota limit for " + user.username);
            let exists: Base[] = [];
            if (query != null) {
                // exists = await this.query(query, { name: 1 }, 2, 0, null, q.collectionname, q.jwt);
                exists = await this.query({ query, top: 2, collectionname: q.collectionname, jwt: q.jwt }, span);
            }
            if (exists.length === 1) {
                q.item._id = exists[0]._id;
            }
            else if (exists.length > 1) {
                Logger.instanse.verbose("DatabaseConnection", "InsertOrUpdateOne", "[" + user.username + "][" + q.collectionname + "] query for existing");
                throw JSON.stringify(query) + " is not uniqe, more than 1 item in collection matches this";
            }
            if (!DatabaseConnection.hasAuthorization(user, q.item, Rights.update)) {
                Base.addRight(q.item, user._id, user.name, [Rights.full_control], false);
                this.ensureResource(q.item, q.collectionname);
            }
            // if (!this.hasAuthorization(user, q.item, Rights.update)) { throw new Error("Access denied, no authorization to InsertOrUpdateOne"); }


            if (exists.length === 1) {
                const uq = new UpdateOneMessage();
                // uq.query = query; 
                uq.item = q.item; uq.collectionname = q.collectionname; uq.w = q.w; uq.j = q.j; uq.jwt = q.jwt;
                (uq as any).original = exists[0];
                const keys = Object.keys(exists[0]);
                for (let i = 0; i < keys.length; i++) {
                    let key = keys[i];
                    if (key.startsWith("_")) {
                        if (NoderedUtil.IsNullUndefinded(uq.item[key])) uq.item[key] = exists[0][key];
                    }
                }
                Logger.instanse.debug("DatabaseConnection", "InsertOrUpdateOne", "[" + user.username + "][" + q.collectionname + "] update entity " + uq.item._id + " " + uq.item.name);
                const uqres = await this.UpdateOne(uq, span);
                q.opresult = uqres.opresult;
                q.result = uqres.result;
                if (NoderedUtil.IsNullUndefinded(uqres.result) && !NoderedUtil.IsNullUndefinded(uqres.item)) {
                    q.result = uqres.item;
                }
            } else {
                if (q.collectionname === "openrpa_instances" && q.item._type === "workflowinstance") {
                    // Normally we need to remove _id to avoid unique constrains, but in this case we WANT to preserve the id
                } else {
                    delete q.item._id;
                }
                Logger.instanse.debug("DatabaseConnection", "InsertOrUpdateOne", "[" + user.username + "][" + q.collectionname + "] insert new entity " + q.item.name);
                q.result = await this.InsertOne(q.item, q.collectionname, q.w, q.j, q.jwt, span);
            }
            if (q.collectionname === "users" && q.item._type === "role") {
                // DBHelper.cached_roles = [];
            }
            return q;
        } catch (error) {
            span?.recordException(error);
            throw error;
        } finally {
            DatabaseConnection.InsertOrUpdateOneSemaphore.up();
            Logger.instanse.verbose("DatabaseConnection", "InsertOrUpdateOne", "[" + user?.username + "][" + q.collectionname + "] completed");
            Logger.otel.endSpan(span);
        }
    }
    async InsertOrUpdateMany<T extends Base>(items: T[], collectionname: string, uniqeness: string, skipresults: boolean, w: number, j: boolean, jwt: string, parent: Span): Promise<T[]> {
        const span: Span = Logger.otel.startSubSpan("db.InsertOrUpdateMany", parent);
        let result: T[] = [];
        try {
            if (NoderedUtil.IsNullUndefinded(items) || items.length == 0) { throw Error("Cannot create null item"); }
            if (NoderedUtil.IsNullEmpty(jwt)) {
                throw new Error("jwt is null");
            }
            await this.connect(span);
            const user = await Crypt.verityToken(jwt);
            if (user.dblocked && !user.HasRoleName("admins")) throw new Error("Access denied (db locked) could be due to hitting quota limit for " + user.username);
            span?.setAttribute("collection", collectionname);
            span?.setAttribute("username", user.username);
            Logger.instanse.verbose("DatabaseConnection", "InsertOrUpdateMany", "[" + user.username + "][" + collectionname + "] received " + items.length + " items with uniqeness " + uniqeness);


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
                        Promises.push(this.UpdateOne(um, span));
                    } else {
                        insert.push(item);
                    }
                }

                if (Promises.length > 0) {
                    const tempresults = await Promise.all(Promises.map(p => p.catch(e => e)));
                    const errors = tempresults.filter(result => NoderedUtil.IsString(result) || (result instanceof Error));
                    if (errors.length > 0) throw errors[0];
                    update = update.concat(tempresults.map(x => x.result));
                    result = result.concat(tempresults.map(x => x.result));
                }
            } else {
                let ids = items.filter(x => !NoderedUtil.IsNullEmpty(x._id)).map(x => x._id);
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
                        Promises.push(this.UpdateOne(um, span));
                    }
                    const tempresults = await Promise.all(Promises.map(p => p.catch(e => e)));
                    const errors = tempresults.filter(result => NoderedUtil.IsString(result) || (result instanceof Error));
                    if (errors.length > 0) throw errors[0];
                    result = result.concat(tempresults.map(x => x.result));
                }
            }

            if (insert.length > 0) {
                let res = await this.InsertMany<T>(insert, collectionname, w, j, jwt, span);
                result = result.concat(res);
            }
            Logger.instanse.info("DatabaseConnection", "InsertOrUpdateMany", "[" + user.username + "][" + collectionname + "] inserted " + insert.length + " items and updated " + update.length + " items in database");
        } catch (error) {
            Logger.instanse.error("DatabaseConnection", "InsertOrUpdateMany", error);
            span?.recordException(error);
            throw error;
        }
        finally {
            Logger.otel.endSpan(span);
        }
        return result;
    }
    private async _DeleteFile(id: string): Promise<void> {
        return new Promise<void>(async (resolve, reject) => {
            try {
                const _id = new ObjectId(id);
                const bucket = new GridFSBucket(this.db);
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
    async DeleteOne(id: string | any, collectionname: string, recursive: boolean, jwt: string, parent: Span): Promise<void> {
        if (id === null || id === undefined || id === "") { throw Error("id cannot be null"); }
        const span: Span = Logger.otel.startSubSpan("db.DeleteOne", parent);
        try {

            await this.connect();
            const user: TokenUser = await Crypt.verityToken(jwt);
            let _query: any = {};
            if (typeof id === 'string' || id instanceof String) {
                _query = { $and: [{ _id: id }, this.getbasequery(user, "_acl", [Rights.delete])] };
            } else {
                _query = { $and: [{ id }, this.getbasequery(user, "_acl", [Rights.delete])] };
            }
            if (collectionname == "audit") {
                if (!user.HasRoleId(WellknownIds.admins)) {
                    throw Error("Access denied");
                }
            }

            if (collectionname === "files") { collectionname = "fs.files"; }
            if (DatabaseConnection.usemetadata(collectionname)) {
                _query = { $and: [{ _id: safeObjectID(id) }, this.getbasequery(user, "metadata._acl", [Rights.delete])] };
                const ot_end = Logger.otel.startTimer();
                const arr = await this.db.collection(collectionname).find(_query).toArray();
                Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_query, DatabaseConnection.otel_label(collectionname, user, "query"));
                if (arr.length === 1) {
                    const ot_end = Logger.otel.startTimer();
                    const mongodbspan: Span = Logger.otel.startSubSpan("mongodb.deleteOne", span);
                    await this._DeleteFile(id);
                    Logger.otel.endSpan(mongodbspan);
                    Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_delete, DatabaseConnection.otel_label(collectionname, user, "delete"));
                    return;
                } else {
                    throw Error("item not found, or Access Denied");
                }
            }
            Logger.instanse.verbose("DatabaseConnection", "DeleteOne", "[" + user.username + "][" + collectionname + "] Deleting " + id + " in database");
            const docs = await this.db.collection(collectionname).find(_query).toArray();
            for (let i = 0; i < docs.length; i++) {
                // @ts-ignore
                let doc: Customer = docs[i];
                if (collectionname == "users" && doc._type == "user") {
                    const usagedocs = await this.db.collection("config").find({ "userid": doc._id, "_type": "resourceusage", "quantity": { "$gt": 0 } }).toArray();
                    if (usagedocs.length > 0) throw new Error("Access Denied, cannot delete user with active resourceusage");
                }
                if (collectionname == "users" && doc._type == "customer") {
                    const usagedocs = await this.db.collection("config").find({ "customerid": doc._id, "_type": "resourceusage", "quantity": { "$gt": 0 } }).toArray();
                    if (usagedocs.length > 0) throw new Error("Access Denied, cannot delete customer with active resourceusage");
                    let userdocs = await this.db.collection("users").find({ "customerid": doc._id }).toArray();
                    if (doc.userid != user._id) {
                        if (userdocs.length > 0 && !Config.cleanup_on_delete_customer && !recursive) {
                            // @ts-ignore
                            let defaulttest = userdocs.filter(x => x._id != doc.users && x._id != doc.admins && x._id != doc.userid)
                            if (defaulttest.length > 0) {
                                throw new Error("Access Denied, cannot delete customer with active user or roles (" + defaulttest[0].name + "/" + defaulttest[0]._id + ")");
                            }
                        }
                        if (Config.cleanup_on_delete_customer || recursive) {
                            Logger.instanse.warn("DatabaseConnection", "DeleteOne", "[" + user.username + "] Cleaning up after up after company " + doc.name);
                            // let queries = [];
                            // for (var y = 0; y < userdocs.length; y++) {
                            //     if (userdocs[y]._type == "user") {
                            //         queries.push({ "_createdbyid": userdocs[y]._id });
                            //         // queries.push({ "_modifiedbyid": userdocs[y]._id });
                            //     }
                            // }
                            // let query = { "$or": queries };
                            // if (queries.length > 0) {
                            let collections = await DatabaseConnection.toArray(this.db.listCollections());
                            collections = collections.filter(x => x.name.indexOf("system.") === -1 && x.type == "collection"
                                && x.name != "fs.chunks" && x.name != "audit" && !x.name.endsWith("_hist")
                                && x.name != "mailhist" && x.name != "dbusage" && x.name != "domains" && x.name != "config"
                                && x.name != "oauthtokens" && x.name != "users");
                            for (let i = 0; i < collections.length; i++) {
                                let collection = collections[i];
                                // var res = await this.DeleteMany(query, null, collection.name, null, jwt, span);
                                var res = await this.DeleteMany({}, null, collection.name, doc._id, false, jwt, span);
                                Logger.instanse.info("DatabaseConnection", "DeleteOne", "[" + user.username + "][" + collection.name + "] Deleted " + res + " items from " + collection.name + " cleaning up after company " + doc.name);
                            }
                            // }
                        }
                        for (let i = 0; i < userdocs.length; i++) {
                            await this.DeleteOne(userdocs[i]._id, "users", recursive, jwt, span);
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
                if (skip_array.indexOf(collectionname) == -1) {
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
                    await this.db.collection(collectionname + '_hist').insertOne(fullhist);
                }
                const ot_end = Logger.otel.startTimer();
                const mongodbspan: Span = Logger.otel.startSubSpan("mongodb.deleteOne", span);
                await this.db.collection(collectionname).deleteOne({ _id: doc._id });
                Logger.otel.endSpan(mongodbspan);
                Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_delete, DatabaseConnection.otel_label(collectionname, user, "delete"));
                if (collectionname == "users" && doc._type == "user") {
                    const names: string[] = [];
                    names.push(doc.name + "noderedadmins"); names.push(doc.name + "noderedusers"); names.push(doc.name + "nodered api users")
                    const subdocs = await this.db.collection("users").find({ "name": { "$in": names }, "_type": "role" }).toArray();
                    for (var r of subdocs) {
                        this.DeleteOne(r._id, "users", false, jwt, span);
                    }
                    // if (Config.cache_store_type == "redis" || Config.cache_store_type == "mongodb") {
                    //     // @ts-ignore
                    //     if (!NoderedUtil.IsNullEmpty(doc.username)) {
                    //         // @ts-ignore
                    //         await Logger.DBHelper.memoryCache.del("username_" + doc.username);
                    //         // @ts-ignore
                    //         await Logger.DBHelper.memoryCache.del("federation_" + doc.username);
                    //     }
                    //     await Logger.DBHelper.memoryCache.del("users" + doc._id);
                    //     await Logger.DBHelper.memoryCache.del("userroles_" + doc._id);

                    // } else if (Config.enable_openflow_amqp) {
                    //     amqpwrapper.Instance().send("openflow", "", { "command": "clearcache" }, 20000, null, "", 1);
                    // } 

                    if (Config.cleanup_on_delete_user || recursive) {
                        let skip_collections = [];
                        if (!NoderedUtil.IsNullEmpty(Config.housekeeping_skip_collections)) skip_collections = Config.housekeeping_skip_collections.split(",")

                        let collections = await DatabaseConnection.toArray(this.db.listCollections());
                        collections = collections.filter(x => x.name.indexOf("system.") === -1 && x.type == "collection"
                            && x.name != "fs.chunks" && x.name != "audit" && !x.name.endsWith("_hist")
                            && x.name != "mailhist" && x.name != "dbusage" && x.name != "domains" && x.name != "config"
                            && x.name != "oauthtokens" && x.name != "users");
                        for (let i = 0; i < collections.length; i++) {
                            let collection = collections[i];
                            if (skip_collections.indexOf(collection.name) > -1) {
                                Logger.instanse.info("DatabaseConnection", "DeleteOne", "[" + user.username + "][" + collection.name + "] skipped " + collection.name + " due to housekeeping_skip_collections setting");
                                continue;
                            }
                            let startTime = new Date();
                            var res = await this.DeleteMany({ "$or": [{ "_createdbyid": doc._id }, { "_modifiedbyid": doc._id }] }, null, collection.name, doc._id, false, jwt, span);
                            // @ts-ignore
                            var timeDiff = ((new Date()) - startTime); //in ms
                            Logger.instanse.info("DatabaseConnection", "DeleteOne", "[" + user.username + "][" + collection.name + "] Deleted " + res + " items from " + collection.name + " cleaning up after user " + doc.name + " (" + timeDiff + "ms)");
                        }

                    }
                    // await this.db.collection("audit").deleteMany({ "userid": doc._id });
                    // await this.db.collection("openrpa_instances").deleteMany({ "_modifiedbyid": doc._id });
                    // await this.db.collection("workflow_instances").deleteMany({ "_modifiedbyid": doc._id });
                    // await this.db.collection("oauthtokens").deleteMany({ "userId": doc._id });
                    // this.db.collection("nodered").deleteMany({"_modifiedbyid": doc._id});
                    // this.db.collection("openrpa").deleteMany({"_modifiedbyid": doc._id});
                }
                if (collectionname == "users" && doc._type == "customer") {
                    const subdocs = await this.db.collection("config").find({ "customerid": doc._id }).toArray();
                    for (var r of subdocs) {
                        this.DeleteOne(r._id, "config", false, jwt, span);
                    }
                }
                if(collectionname == "users") {
                    await Logger.DBHelper.UserRoleUpdate(doc, false);
                }
                // if (collectionname == "users" && doc._type == "role") {
                //     if (Config.cache_store_type == "redis" || Config.cache_store_type == "mongodb") {
                //         // we clear all since we might have cached tons of userrole mappings
                //         Logger.DBHelper.clearCache("deleted role " + doc.name);
                //         // await Logger.DBHelper.memoryCache.del("users" + doc._id);
                //         // await Logger.DBHelper.memoryCache.del("rolename_" + doc.name);
                //         // await Logger.DBHelper.memoryCache.del("allroles");
                //     } else if (Config.enable_openflow_amqp) {
                //         amqpwrapper.Instance().send("openflow", "", { "command": "clearcache" }, 20000, null, "", 1);
                //     } 
                // }
                if (collectionname === "mq") {
                    if (doc._type == "workitemqueue") await Logger.DBHelper.WorkitemQueueUpdate(doc._id, false);
                    if (doc._type == "queue") await Logger.DBHelper.QueueUpdate(doc._id, doc.name, false);
                    if (doc._type == "exchange") await Logger.DBHelper.ExchangeUpdate(doc._id, doc.name, false);
                }
                // @ts-ignore
                if (collectionname == "workitems" && doc._type == "workitem") await Logger.DBHelper.WorkitemQueueUpdate(doc.wiqid);

                if (collectionname === "config" && doc._type === "provider" && !Config.supports_watch) {
                    await Logger.DBHelper.ClearProviders();
                    // await LoginProvider.RegisterProviders(WebServer.app, Config.baseurl());
                }
            }
        } catch (error) {
            span?.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }

    /**
     * @param  {string} id id of object to delete
     * @param  {string} collectionname collectionname Collection containing item
     * @param  {string} jwt JWT of user who is doing the delete, ensuring rights
     * @returns Promise<void>
     */
    async DeleteMany(query: string | any, ids: string[], collectionname: string, queryas: string, recursive: boolean, jwt: string, parent: Span): Promise<number> {
        if (NoderedUtil.IsNullUndefinded(ids) && NoderedUtil.IsNullUndefinded(query)) { throw Error("id cannot be null"); }
        const span: Span = Logger.otel.startSubSpan("db.DeleteMany", parent);
        try {
            await this.connect();
            const user: TokenUser = await Crypt.verityToken(jwt);


            let baseq: any = {};
            if (collectionname === "files") { collectionname = "fs.files"; }
            if (DatabaseConnection.usemetadata(collectionname)) {
                let impersonationquery;
                if (!NoderedUtil.IsNullEmpty(queryas)) impersonationquery = await this.getbasequeryuserid(user, queryas, "metadata._acl", [Rights.delete], span);
                if (!NoderedUtil.IsNullEmpty(queryas) && !NoderedUtil.IsNullUndefinded(impersonationquery)) {
                    baseq = impersonationquery;
                } else {
                    baseq = this.getbasequery(user, "metadata._acl", [Rights.delete]);
                }
            } else {
                let impersonationquery: any;
                if (!NoderedUtil.IsNullEmpty(queryas)) impersonationquery = await this.getbasequeryuserid(user, queryas, "_acl", [Rights.delete], span)
                if (!NoderedUtil.IsNullEmpty(queryas) && !NoderedUtil.IsNullUndefinded(impersonationquery)) {
                    baseq = impersonationquery;
                } else {
                    baseq = this.getbasequery(user, "_acl", [Rights.delete]);
                }
            }
            let _query: any = {};
            if (NoderedUtil.IsNullUndefinded(query) && !NoderedUtil.IsNullUndefinded(ids)) {
                let objectids = [];
                if (collectionname == "files" || collectionname == "fs.files") {
                    for (let i = 0; i < ids.length; i++) {
                        try {
                            objectids.push(safeObjectID(ids[i]))
                        } catch (error) {
                        }
                        if (objectids.length > 0) ids = ids.concat(objectids);
                    }
                }
                _query = { $and: [{ _id: { "$in": ids } }, baseq] };
            } else if (!NoderedUtil.IsNullUndefinded(query)) {
                if (query !== null && query !== undefined) {
                    let json: any = query;
                    if (typeof json !== 'string' && !(json instanceof String)) {
                        json = JSON.stringify(json, (key, value) => {
                            if (value instanceof RegExp)
                                return ("__REGEXP " + value.toString());
                            else
                                return value;
                        });
                    }
                    query = JSON.parse(json, (key, value) => {
                        if (typeof value === 'string' && value.match(isoDatePattern)) {
                            return new Date(value); // isostring, so cast to js date
                        } else if (value != null && value != undefined && value.toString().indexOf("__REGEXP ") === 0) {
                            const m = value.split("__REGEXP ")[1].match(/\/(.*)\/(.*)?/);
                            return new RegExp(m[1], m[2] || "");
                        } else
                            return value; // leave any other value as-is
                    });
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
                const mongodbspan: Span = Logger.otel.startSubSpan("mongodb.find", span);
                const cursor = await this.db.collection(collectionname).find(_query)

                let deletecounter = 0;
                Logger.otel.endSpan(mongodbspan);
                Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_query, DatabaseConnection.otel_label(collectionname, user, "query"));
                Logger.instanse.debug("DatabaseConnection", "DeleteMany", "[" + user.username + "][" + collectionname + "] Deleting multiple files in database");
                for await (const c of cursor) {
                    deletecounter++;
                    const ot_end = Logger.otel.startTimer();
                    const _mongodbspan: Span = Logger.otel.startSubSpan("mongodb.deletefile", span);
                    try {
                        await this._DeleteFile(c._id.toString());
                    } catch (error) {
                    }
                    Logger.otel.endSpan(_mongodbspan);
                    Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_deletemany, DatabaseConnection.otel_label(collectionname, user, "deletemany"));
                }
                Logger.instanse.verbose("DatabaseConnection", "DeleteMany", "[" + user.username + "][" + collectionname + "] deleted " + deletecounter + " files in database");
                return deletecounter;
            } else if (recursive && !NoderedUtil.IsNullUndefinded(ids) && ids.length > 0) {
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


                Logger.instanse.verbose("DatabaseConnection", "DeleteMany", "[" + user.username + "][" + collectionname + "] quering items to delete from " + collectionname);
                const qot_end = Logger.otel.startTimer();
                const qmongodbspan: Span = Logger.otel.startSubSpan("mongodb.find", span);
                const cursor = await this.db.collection(collectionname).find(_query);
                Logger.otel.endSpan(qmongodbspan);
                Logger.otel.endTimer(qot_end, DatabaseConnection.mongodb_query, DatabaseConnection.otel_label(collectionname, user, "query"));
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
                            Logger.instanse.verbose("DatabaseConnection", "DeleteMany", "[" + user.username + "][" + collectionname + "] Inserting " + bulkInsert.addToOperationsList.length + " items into " + collectionname + "_hist");
                            const ot_end = Logger.otel.startTimer();
                            bulkInsert.execute()
                            Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_insertmany, DatabaseConnection.otel_label(collectionname + "_hist", user, "insertmany"));
                            bulkInsert = this.db.collection(collectionname + "_hist").initializeUnorderedBulkOp()
                        }
                        if (removeCount > 0) {
                            Logger.instanse.verbose("DatabaseConnection", "DeleteMany", "[" + user.username + "][" + collectionname + "] Deleting " + bulkRemove.addToOperationsList.length + " items from " + collectionname);
                            const ot_end = Logger.otel.startTimer();
                            bulkRemove.execute()
                            Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_deletemany, DatabaseConnection.otel_label(collectionname, user, "deletemany"));
                            bulkRemove = this.db.collection(collectionname).initializeUnorderedBulkOp()
                        }
                    }
                }
                // @ts-ignore
                var insertCount = bulkInsert.length;
                // @ts-ignore
                var removeCount = bulkRemove.length;
                if (insertCount > 0 || removeCount > 0) {
                    if (insertCount > 0) {
                        Logger.instanse.verbose("DatabaseConnection", "DeleteMany", "[" + user.username + "][" + collectionname + "] Inserting " + bulkInsert.addToOperationsList.length + " items into " + collectionname + "_hist");
                        const ot_end = Logger.otel.startTimer();
                        bulkInsert.execute()
                        Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_insertmany, DatabaseConnection.otel_label(collectionname + "_hist", user, "insertmany"));
                    }
                    if (removeCount > 0) {
                        Logger.instanse.verbose("DatabaseConnection", "DeleteMany", "[" + user.username + "][" + collectionname + "] Deleting " + bulkRemove.addToOperationsList.length + " items from " + collectionname);
                        const ot_end = Logger.otel.startTimer();
                        bulkRemove.execute()
                        Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_deletemany, DatabaseConnection.otel_label(collectionname, user, "deletemany"));
                    }
                }

                Logger.instanse.verbose("DatabaseConnection", "DeleteMany", "[" + user.username + "][" + collectionname + "] deleted " + counter + " items in database");
                return counter;
            }
        } catch (error) {
            span?.recordException(error);
            throw error;
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
        // const isString: boolean = typeof value === "string";
        // return value && shouldEncryptThisKey && isString;
    }
    /**
     * Enumerate object, encrypting fields that needs to be encrypted
     * @param  {T} item Item to enumerate
     * @returns T Object with encrypted fields
     */
    public encryptentity(item: Base): Base {
        if (NoderedUtil.IsNullUndefinded(item) || NoderedUtil.IsNullUndefinded(item._encrypt) || NoderedUtil.IsNullUndefinded(item._encrypt)) { return item; }
        const me: DatabaseConnection = this;
        return (Object.keys(item).reduce((newObj, key) => {
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
                Logger.instanse.error("DatabaseConnection", "encryptentity", error);
                newObj[key] = value;
            }
            return newObj;
        }, item) as Base);
    }
    /**
     * Enumerate object, decrypting fields that needs to be decrypted
     * @param  {T} item Item to enumerate
     * @returns T Object with decrypted fields
     */
    public decryptentity<T extends Base>(item: T): T {
        if (NoderedUtil.IsNullUndefinded(item) || NoderedUtil.IsNullUndefinded(item._encrypt) || NoderedUtil.IsNullUndefinded(item._encrypt)) { return item; }
        const me: DatabaseConnection = this;
        return (Object.keys(item).reduce((newObj, key) => {
            const value: any = item[key];
            try {
                if (this._shouldEncryptValue(item._encrypt, key, value)) {
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
                Logger.instanse.error("DatabaseConnection", "decryptentity", error);
                newObj[key] = value;
            }
            return newObj;
        }, {}) as T);
    }
    /**
     * Create a MongoDB query filtering result based on permission of current user and requested permission
     * @param  {string} jwt JWT of the user creating the query
     * @param  {number[]} bits Permission wanted on objects
     * @returns Object MongoDB query
     */
    public getbasequery(user: TokenUser | User, field: string, bits: number[]): Object {
        if (Config.api_bypass_perm_check) {
            return { _id: { $ne: "bum" } };
        }
        if (user._id === WellknownIds.root) {
            return { _id: { $ne: "bum" } };
        }
        const isme: any[] = [];
        isme.push({ _id: user._id });
        for (let i: number = 0; i < bits.length; i++) {
            bits[i]--; // bitwize matching is from offset 0, when used on bindata
        }
        user.roles.forEach(role => {
            isme.push({ _id: role._id });
        });
        const finalor: any[] = [];
        const q = {};
        // todo: add check for deny's
        q[field] = {
            $elemMatch: {
                rights: { $bitsAllSet: bits },
                $or: isme
            }
        };
        // deny: false,
        finalor.push(q);
        // if (field === "_acl") {
        //     const q2 = {};
        //     q2["value._acl"] = {
        //         $elemMatch: {
        //             rights: { $bitsAllSet: bits },
        //             deny: false,
        //             $or: isme
        //         }
        //     };
        //     finalor.push(q2);
        // }
        return { $or: finalor.concat() };
    }
    private async getbasequeryuserid(calluser: TokenUser, userid: string, field: string, bits: number[], parent: Span): Promise<Object> {
        // const user = await DBHelper.FindByUsernameOrId(null, userid, parent);
        let user: User = await this.getbyid(userid, "users", Crypt.rootToken(), true, parent);
        if (NoderedUtil.IsNullUndefinded(user)) return null;
        if (user._type == "user" || user._type == "role") {
            user = await Logger.DBHelper.DecorateWithRoles(user as any, parent);
            // const jwt = Crypt.createToken(user as any, Config.shorttoken_expires_in);
            return this.getbasequery(user, field, bits);
        } else if (user._type == "customer") {
            user = await Logger.DBHelper.DecorateWithRoles(user as any, parent);
            user.roles.push(new Rolemember(user.name + " users", (user as any).users))
            user.roles.push(new Rolemember(user.name + " admins", (user as any).admins))
            if (user._id == calluser.customerid) user.roles.push(new Rolemember(calluser.name, calluser._id));

            if (!NoderedUtil.IsNullEmpty((user as any as Customer).userid)) {
                user.roles.push(new Rolemember((user as any as Customer).userid, (user as any as Customer).userid))
            }
            // const jwt = Crypt.createToken(user as any, Config.shorttoken_expires_in);
            return this.getbasequery(user, field, bits);
        }
        // throw new Error("Cannot create filter for an " + user._type)
    }
    /**
     * Ensure _type and _acs on object
     * @param  {T} item Object to validate
     * @returns T Validated object
     */
    ensureResource<T extends Base>(item: T, collection: string): T {
        if (!item.hasOwnProperty("_type") || item._type === null || item._type === undefined) {
            item._type = "unknown";
        }
        item._type = item._type.toLowerCase();
        if (!item._acl) { item._acl = []; }
        if (item._acl.length === 0) {
            Base.addRight(item, WellknownIds.admins, "admins", [Rights.full_control]);
        }
        if (Config.force_add_admins && item._id != WellknownIds.root) {
            Base.addRight(item, WellknownIds.admins, "admins", [Rights.full_control], false);
        }
        item._acl.forEach((a, index) => {
            if (typeof a.rights === "string") {
                item._acl[index].rights = (new Binary(Buffer.from(a.rights, "base64"), 0) as any);
            }
        });
        if (DatabaseConnection.collections_with_text_index.indexOf(collection) > -1) {
            var _searchnames = [];
            var _searchname = "";
            for (var i = 0; i < Config.text_index_name_fields.length; i++) {
                var field = Config.text_index_name_fields[i];
                if (Array.isArray(item[field])) {
                    for (var y = 0; y < item[field].length; y++) {
                        try {
                            if (!NoderedUtil.IsNullEmpty(item[field][y])) {
                                var name: string = item[field][y].toLowerCase();
                                name = name.replace(/[.*!#"'`|%$@+\-?^${}()|[\]\\]/g, " ").trim();
                                _searchnames = _searchnames.concat(name.split(" "));
                                _searchnames.push(name);
                                if (name != item[field][y].toLowerCase()) _searchnames.push(item[field][y].toLowerCase());
                            }
                        } catch (error) {
                            Logger.instanse.error("DatabaseConnection", "ensureResource", error);
                            if (item[field] && item[field][y]) {
                                console.log(field + "/" + y, item[field][y]);
                            } else {
                                console.log(field, item[field]);
                            }
                        }
                    }
                } else {
                    if (!NoderedUtil.IsNullEmpty(item[field])) {
                        try {
                            var name: string = item[field].toLowerCase();
                            name = name.replace(/[.*!#"'`|%$@+\-?^${}()|[\]\\]/g, " ").trim();
                            if (field == "name") _searchname = name.toLowerCase();
                            _searchnames = _searchnames.concat(name.split(" "));
                            _searchnames.push(name);
                            if (name != item[field].toLowerCase()) _searchnames.push(item[field].toLowerCase());
                        } catch (error) {
                            Logger.instanse.error("DatabaseConnection", "ensureResource", error);
                            console.log(field, item[field]);
                        }
                    }
                }
            }
            (item as any)._searchnames = _searchnames;
            (item as any)._searchname = _searchname;
        }
        return item;
    }
    public EntityRestrictions: EntityRestriction[] = null;
    async loadEntityRestrictions(parent: Span) {
        if (this.EntityRestrictions == null) {
            const rootjwt = Crypt.rootToken()
            this.EntityRestrictions = await this.query<EntityRestriction>({ query: { "_type": "restriction" }, top: 1000, collectionname: "config", jwt: rootjwt }, parent);
            let allowadmins = new EntityRestriction();
            allowadmins.copyperm = false; allowadmins.collection = ""; allowadmins.paths = ["$."];
            Base.addRight(allowadmins, WellknownIds.admins, "admins", [Rights.create]);
            this.EntityRestrictions.push(allowadmins);
            for (let i = 0; i < this.EntityRestrictions.length; i++) {
                this.EntityRestrictions[i] = EntityRestriction.assign(this.EntityRestrictions[i]);
            }
        }
    }
    async CheckEntityRestriction(user: TokenUser, collection: string, item: Base, parent: Span): Promise<boolean> {
        if (!Config.enable_entity_restriction) return true;
        await this.loadEntityRestrictions(parent);
        const defaultAllow: boolean = false;
        let result: boolean = false;
        const authorized = this.EntityRestrictions.filter(x => x.IsAuthorized(user) && (x.collection == collection || x.collection == ""));
        const matches = authorized.filter(x => x.IsMatch(item) && (x.collection == collection || x.collection == ""));
        const copyperm = matches.filter(x => x.copyperm && (x.collection == collection || x.collection == ""));
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
    static hasAuthorization(user: TokenUser, item: Base, action: number): boolean {
        if (Config.api_bypass_perm_check) { return true; }
        if (user._id === WellknownIds.root) { return true; }
        if (action === Rights.create || action === Rights.delete) {
            if (item._type === "role") {
                if (item.name.toLowerCase() === "users" || item.name.toLowerCase() === "admins" || item.name.toLowerCase() === "workflow") {
                    return false;
                }
            }
            if (item._type === "user") {
                if (item.name === "workflow") {
                    return false;
                }
            }
        }
        if (action === Rights.update && item._id === WellknownIds.admins && item.name.toLowerCase() !== "admins") {
            return false;
        }
        if (action === Rights.update && item._id === WellknownIds.users && item.name.toLowerCase() !== "users") {
            return false;
        }
        if (action === Rights.update && item._id === WellknownIds.root && item.name.toLowerCase() !== "root") {
            return false;
        }
        if ((item as any).userid === user.username || (item as any).userid === user._id || (item as any).user === user.username) {
            return true;
        } else if (item._id === user._id) {
            if (action === Rights.delete) { Logger.instanse.error("DatabaseConnection", "hasAuthorization", "[" + user.username + "] hasAuthorization, cannot delete self!"); return false; }
            return true;
        }

        if (item._acl != null && item._acl != undefined && Array.isArray(item._acl)) {
            if (typeof item._acl === 'string' || item._acl instanceof String) {
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
        //const target = this;
        // return target.replace(new RegExp(search, 'g'), replacement);
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

        const keys = Object.keys(o);
        for (let i = 0; i < keys.length; i++) {
            let key = keys[i];
            let value = o[key];
            if (typeof value === 'string') {
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
            if (key.indexOf('.') > -1) {
                try {
                    // const newkey = key.replace(new RegExp('.', 'g'), '____');
                    const newkey = this.replaceAll(key, ".", "____");
                    o[newkey] = o[key];
                    delete o[key];
                    key = newkey;
                } catch (error) {
                }
            }
            if (key.startsWith('$$')) {
                delete o[key];
            } else if (o[key]) {
                if (typeof o[key] === 'string') {
                    if (o[key].length === 24 && o[key].endsWith('Z')) {
                        o[key] = new Date(o[key]);
                    }
                }
                if (typeof (o[key]) === "object") {
                    this.traversejsonencode(o[key]);
                }
            }

        }

    }
    public static traversejsondecode(o) {
        const keys = Object.keys(o);
        for (let i = 0; i < keys.length; i++) {
            let key = keys[i];
            if (key.indexOf('____') > -1) {
                try {
                    // const newkey = key.replace(new RegExp('____', 'g'), '.');
                    const newkey = this.replaceAll(key, "____", ".");
                    o[newkey] = o[key];
                    delete o[key];
                    key = newkey;
                } catch (error) {
                }
            }
            if (key.startsWith('$$')) {
                delete o[key];
            } else if (o[key]) {
                if (typeof o[key] === 'string') {
                    if (o[key].length === 24 && o[key].endsWith('Z')) {
                        o[key] = new Date(o[key]);
                    }
                }
                if (typeof (o[key]) === "object") {
                    this.traversejsondecode(o[key]);
                }
            }

        }

    }

    async SaveUpdateDiff<T extends Base>(q: UpdateOneMessage, user: TokenUser, parent: Span) {
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
            this.db.collection(q.collectionname + '_hist').insertOne(updatehist).then(() => {
                Logger.otel.endSpan(mongodbspan);
                Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_insert, DatabaseConnection.otel_label(q.collectionname + "_hist", user, "insert"));
            }).catch(err => {
                mongodbspan?.recordException(err);
                Logger.otel.endSpan(mongodbspan);
                Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_insert, DatabaseConnection.otel_label(q.collectionname + "_hist", user, "insert"));
            });
        } catch (error) {
            span?.recordException(error);
            Logger.instanse.error("DatabaseConnection", "SaveUpdateDiff", error);
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
        // let decrypt: boolean = false;
        const span: Span = Logger.otel.startSubSpan("db.SaveDiff", parent);
        const roundDown = function (num, precision): number {
            num = parseFloat(num);
            if (!precision) return num;
            return (Math.floor(num / precision) * precision);
        };
        if (item._type === 'instance' && collectionname === 'workflows') return 0;

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
                this.db.collection(collectionname + '_hist').insertOne(fullhist).then(() => {
                    Logger.otel.endSpan(mongodbspan);
                    Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_insert, DatabaseConnection.otel_label(collectionname + "_hist", Crypt.rootUser(), "insert"));
                }).catch(err => {
                    mongodbspan?.recordException(err);
                    Logger.otel.endSpan(mongodbspan);
                    Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_insert, DatabaseConnection.otel_label(collectionname + "_hist", Crypt.rootUser(), "insert"));
                });
            }
            if (original != null && original._version >= 0) {
                delta = jsondiffpatch.diff(original, item);
                if (NoderedUtil.IsNullUndefinded(delta)) return 0;
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
                    this.db.collection(collectionname + '_hist').insertOne(deltahist).then(() => {
                        Logger.otel.endSpan(mongodbspan);
                        Logger.otel.endTimer(ot_end, DatabaseConnection.mongodb_insert, DatabaseConnection.otel_label(collectionname + "_hist", Crypt.rootUser(), "insert"));
                    }).catch(err => {
                        mongodbspan?.recordException(err);
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
            span?.recordException(error);
            Logger.instanse.error("DatabaseConnection", "SaveDiff", error);
        } finally {
            // try {
            //     if (original != null && decrypt == true) {
            //         original = this.decryptentity(original);
            //     }
            // } catch (error) {
            // }
            Logger.otel.endSpan(span);
        }
        return _version;
    }
    async createIndex(collectionname: string, name: string, keypath: any, options: any, parent: Span) {
        const span: Span = Logger.otel.startSubSpan("db.createIndex", parent);
        return new Promise((resolve, reject) => {
            try {
                Logger.instanse.info("DatabaseConnection", "createIndex", "Adding index " + name + " to " + collectionname);
                if (NoderedUtil.IsNullUndefinded(options)) options = {};
                options["name"] = name;
                this.db.collection(collectionname).createIndex(keypath, options, (err, name) => {
                    if (err) {
                        span?.recordException(err);
                        Logger.otel.endSpan(span);
                        reject(err);
                        return;
                    }
                    Logger.otel.endSpan(span);
                    resolve(name);
                })
            } catch (error) {
                span?.recordException(error);
                Logger.otel.endSpan(span);
                reject(error);
            }
        });
    }
    async deleteIndex(collectionname: string, name: string, parent: Span) {
        const span: Span = Logger.otel.startSubSpan("db.deleteIndex", parent);
        return new Promise((resolve, reject) => {
            try {
                Logger.instanse.info("DatabaseConnection", "deleteIndex", "Dropping index " + name + " in " + collectionname);
                this.db.collection(collectionname).dropIndex(name, (err, name) => {
                    if (err) {
                        span?.recordException(err);
                        Logger.otel.endSpan(span);
                        reject(err);
                        return;
                    }
                    Logger.otel.endSpan(span);
                    resolve(name);
                })
            } catch (error) {
                span?.recordException(error);
                Logger.otel.endSpan(span);
                reject(error);
            }
        });
    }
    public static collections_with_text_index: string[] = [];
    public static timeseries_collections: string[] = [];
    async ensureindexes(parent: Span) {
        const span: Span = Logger.otel.startSubSpan("db.ensureindexes", parent);
        try {
            if (!Config.ensure_indexes) return;
            Logger.instanse.info("DatabaseConnection", "ensureindexes", "Begin validating index, this might take a while");
            span?.addEvent("Get collections");
            let collections = await DatabaseConnection.toArray(this.db.listCollections());
            collections = collections.filter(x => x.name.indexOf("system.") === -1);

            DatabaseConnection.timeseries_collections = [];
            for (let i = 0; i < collections.length; i++) {
                var collection = collections[i];
                if (collection.type == "timeseries") {
                    DatabaseConnection.timeseries_collections = DatabaseConnection.timeseries_collections.filter(x => x != collection.name);
                    DatabaseConnection.timeseries_collections.push(collection.name);
                }
                if (collection.type != "collection" && collection.type != "timeseries") continue;
            }

            for (let i = 0; i < collections.length; i++) {
                try {
                    const collection = collections[i];
                    if (collection.type != "collection") continue;
                    if (collection.name == "uploads.files" || collection.name == "uploads.chunks" || collection.name == "fs.chunks") continue;
                    span?.addEvent("Get indexes for " + collection.name);
                    const indexes = await this.db.collection(collection.name).indexes();
                    const indexnames = indexes.map(x => x.name);
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
                            case "fs.files":
                                // if (indexnames.indexOf("metadata.workflow_1") === -1) {
                                //     await this.createIndex(collection.name, "metadata.workflow_1", { "metadata.workflow": 1 }, null, span)
                                // }
                                if (indexnames.indexOf("metadata._acl") === -1) {
                                    await this.createIndex(collection.name, "metadata._acl", { "metadata._acl._id": 1, "metadata._acl.rights": 1, "metadata._acl.deny": 1 }, null, span)
                                }
                                break;
                            case "fs.chunks":
                                break;
                            case "workflow":
                                // if (indexnames.indexOf("_created_1") === -1) {
                                //     await this.createIndex(collection.name, "_created_1", { "_created": 1 }, null, span)
                                // }
                                // if (indexnames.indexOf("_modified_1") === -1) {
                                //     await this.createIndex(collection.name, "_modified_1", { "_modified": 1 }, null, span)
                                // }
                                // if (indexnames.indexOf("queue_1") === -1) {
                                //     await this.createIndex(collection.name, "queue_1", { "queue": 1 }, null, span)
                                // }
                                // if (indexnames.indexOf("_acl") === -1) {
                                //     await this.createIndex(collection.name, "_acl", { "_acl._id": 1, "_acl.rights": 1, "_acl.deny": 1 }, null, span)
                                // }
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
                                // if (indexnames.indexOf("_createdbyid_1") === -1) {
                                //     await this.createIndex(collection.name, "_createdbyid_1", { "_createdbyid": 1 }, null, span)
                                // }
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
                                break;
                            case "users":
                                // if (indexnames.indexOf("name_1") === -1) {
                                //     await this.createIndex(collection.name, "name_1", { "name": 1 }, null, span)
                                // }
                                // if (indexnames.indexOf("_type_1") === -1) {
                                //     await this.createIndex(collection.name, "_type_1", { "_type": 1 }, null, span)
                                // }
                                // if (indexnames.indexOf("_created_1") === -1) {
                                //     await this.createIndex(collection.name, "_created_1", { "_created": 1 }, null, span)
                                // }
                                // if (indexnames.indexOf("_modified_1") === -1) {
                                //     await this.createIndex(collection.name, "_modified_1", { "_modified": 1 }, null, span)
                                // }
                                // if (indexnames.indexOf("unique_username_1") === -1) {
                                //     await this.createIndex(collection.name, "unique_username_1", { "username": 1 },
                                //         { "unique": true, "name": "unique_username_1", "partialFilterExpression": { "_type": "user" } }, span)
                                // }
                                // if (indexnames.indexOf("username_1") === -1) {
                                //     await this.createIndex(collection.name, "username_1", { "username": 1 }, null, span)
                                // }
                                if (indexnames.indexOf("members._id_1") === -1) {
                                    await this.createIndex(collection.name, "members._id_1", { "members._id": 1 },
                                        { "partialFilterExpression": { "_type": "role" } }, span)
                                }
                                // if (indexnames.indexOf("_acl") === -1) {
                                //     await this.createIndex(collection.name, "_acl", { "_acl._id": 1, "_acl.rights": 1, "_acl.deny": 1 }, null, span)
                                // }
                                break;
                            case "openrpa":
                                // if (indexnames.indexOf("_created_1") === -1) {
                                //     await this.createIndex(collection.name, "_created_1", { "_created": 1 }, null, span)
                                // }
                                // if (indexnames.indexOf("_modified_1") === -1) {
                                //     await this.createIndex(collection.name, "_modified_1", { "_modified": 1 }, null, span)
                                // }
                                if (indexnames.indexOf("_type_projectid_name_1") === -1) {
                                    await this.createIndex(collection.name, "_type_projectid_name_1", { _type: 1, "{projectid:-1,name:-1}": 1 }, null, span)
                                }
                                // if (indexnames.indexOf("_acl") === -1) {
                                //     await this.createIndex(collection.name, "_acl", { "_acl._id": 1, "_acl.rights": 1, "_acl.deny": 1 }, null, span)
                                // }
                                break;
                            case "dbusage":
                                // if (indexnames.indexOf("_created_1") === -1) {
                                //     await this.createIndex(collection.name, "_created_1", { "_created": 1 }, null, span)
                                // }
                                // if (indexnames.indexOf("_modified_1") === -1) {
                                //     await this.createIndex(collection.name, "_modified_1", { "_modified": 1 }, null, span)
                                // }
                                if (indexnames.indexOf("collection_1_timestamp_1_userid_1") === -1) {
                                    await this.createIndex(collection.name, "collection_1_timestamp_1_userid_1", { _type: 1, "{collection:1,timestamp:1,userid:1}": 1 }, null, span)
                                }
                                if (indexnames.indexOf("timestamp_1_userid_1") === -1) {
                                    await this.createIndex(collection.name, "timestamp_1_userid_1", { _type: 1, "{timestamp:1,userid:1}": 1 }, null, span)
                                }
                                if (indexnames.indexOf("timestamp_1") === -1) {
                                    await this.createIndex(collection.name, "timestamp_1", { _type: 1, "{timestamp:1}": 1 }, null, span)
                                }
                                // if (indexnames.indexOf("_acl") === -1) {
                                //     await this.createIndex(collection.name, "_acl", { "_acl._id": 1, "_acl.rights": 1, "_acl.deny": 1 }, null, span)
                                // }
                                break;
                            case "workitems":
                                if (indexnames.indexOf("_type_1_wiq_1") === -1) {
                                    await this.createIndex(collection.name, "_type_1_wiq_1", { "_type": 1, "wiq": 1 }, null, span)
                                }
                                if (indexnames.indexOf("_type_1_wiqid_1") === -1) {
                                    await this.createIndex(collection.name, "_type_1_wiqid_1", { "_type": 1, "wiqid": 1 }, null, span)
                                }
                                if (indexnames.indexOf("_type_1_state_1_wiqid_1_priority_1") === -1) {
                                    await this.createIndex(collection.name, "_type_1_state_1_wiqid_1_priority_1", { "_type": 1, "state": 1, "wiqid": 1, "priority": 1 }, null, span)
                                }
                                if (indexnames.indexOf("_type_1_state_1_wiq_1_lastrun_-1") === -1) {
                                    await this.createIndex(collection.name, "_type_1_state_1_wiq_1_lastrun_", { "_type": 1, "state": 1, "wiq": 1, "lastrun": -1 }, null, span)
                                }
                                if (indexnames.indexOf("_type_1__created_-1") === -1) {
                                    await this.createIndex(collection.name, "_type_1__created_-1", { "_type": 1, "_created": -1 }, null, span)
                                }
                                if (indexnames.indexOf("_type_1_state_1__created_-1") === -1) {
                                    await this.createIndex(collection.name, "_type_1_state_1__created_-1", { "_type": 1, "state": 1, "_created": -1 }, null, span)
                                }

                            default:
                                // if (indexnames.indexOf("_type_1") === -1) {
                                //     await this.createIndex(collection.name, "_type_1", { "_type": 1 }, null, span)
                                // }
                                // if (indexnames.indexOf("_created_1") === -1) {
                                //     await this.createIndex(collection.name, "_created_1", { "_created": 1 }, null, span)
                                // }
                                // if (indexnames.indexOf("_modified_1") === -1) {
                                //     await this.createIndex(collection.name, "_modified_1", { "_modified": 1 }, null, span)
                                // }
                                // if (DatabaseConnection.timeseries_collections.indexOf(collection.name) > -1) {
                                //     if (indexnames.indexOf("metadata._acl") === -1) {
                                //         await this.createIndex(collection.name, "metadata._acl", { "metadata._acl._id": 1, "metadata._acl.rights": 1, "metadata._acl.deny": 1 }, null, span)
                                //     }
                                // } else {
                                //     if (indexnames.indexOf("_acl") === -1) {
                                //         await this.createIndex(collection.name, "_acl", { "_acl._id": 1, "_acl.rights": 1, "_acl.deny": 1 }, null, span)
                                //     }
                                // }
                                break;
                        }
                    }
                } catch (error) {
                    span?.recordException(error);
                    Logger.instanse.error("DatabaseConnection", "ensureindexes", error);
                }
            }

            span?.addEvent("Get collections");
            collections = await DatabaseConnection.toArray(this.db.listCollections());
            collections = collections.filter(x => x.name.indexOf("system.") === -1);

            if (Config.supports_watch) {
                Logger.instanse.info("DatabaseConnection", "ensureindexes", "Register global watches for each collection");
                for (var c = 0; c < collections.length; c++) {
                    if (collections[c].type != "collection") continue;
                    if (collections[c].name == "fs.files" || collections[c].name == "fs.chunks") continue;
                    this.registerGlobalWatch(collections[c].name, span);
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
                span?.addEvent("Get indexes for " + collection.name);
                const indexes = await this.db.collection(collection.name).indexes();
                for (let y = 0; y < indexes.length; y++) {
                    var idx = indexes[y];
                    if (idx.textIndexVersion && idx.textIndexVersion > 1 && collection.name != "fs.files") {
                        DatabaseConnection.collections_with_text_index = DatabaseConnection.collections_with_text_index.filter(x => x != collection.name);
                        DatabaseConnection.collections_with_text_index.push(collection.name);
                    }
                }
            }
            Logger.instanse.info("DatabaseConnection", "ensureindexes", "completed");
        } catch (error) {
            span?.recordException(error);
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    static usemetadata(collectionname: string) {
        if (collectionname == "files" || collectionname == "fs.chunks" || collectionname == "fs.files") {
            return true;
        }
        if (DatabaseConnection.timeseries_collections.indexOf(collectionname) > -1) {
            return true;
        }
        return false;
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
}

export class EntityRestriction extends Base {
    public collection: string;
    public copyperm: boolean;
    public paths: string[];
    constructor(
    ) {
        super();
        this._type = "restriction";
    }
    static assign<EntityRestriction>(o: any): EntityRestriction {
        if (typeof o === 'string' || o instanceof String) {
            return Object.assign(new EntityRestriction(), JSON.parse(o.toString()));
        }
        return Object.assign(new EntityRestriction(), o);
    }
    public IsMatch(object: object): boolean {
        if (NoderedUtil.IsNullUndefinded(object)) {
            return false;
        }
        for (let path of this.paths) {
            if (!NoderedUtil.IsNullEmpty(path)) {
                var json = { a: object };
                Logger.instanse.verbose("DatabaseConnection", "IsMatch", path);
                Logger.instanse.silly("DatabaseConnection", "IsMatch", JSON.stringify(json, null, 2));
                try {
                    const result = JSONPath({ path, json });
                    if (result && result.length > 0) {
                        Logger.instanse.verbose("DatabaseConnection", "IsMatch", "true");
                        return true;
                    }
                } catch (error) {
                }
            }
        }
        Logger.instanse.verbose("DatabaseConnection", "IsMatch", "false");
        return false;
    }
    public IsAuthorized(user: TokenUser | User): boolean {
        return DatabaseConnection.hasAuthorization(user as TokenUser, this, Rights.create);
    }
    //     public IsAllowed(user: TokenUser | User, object: object, NoMatchValue: boolean) {
    //         if (!this.IsMatch(object)) return NoMatchValue;
    //         return this.IsAuthorized(user);
    //     }
}