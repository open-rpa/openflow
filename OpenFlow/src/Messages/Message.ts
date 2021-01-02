import * as crypto from "crypto";
import { lookup } from "mimetype";
import { SocketMessage } from "../SocketMessage";
import { Auth } from "../Auth";
import { Crypt } from "../Crypt";
import * as url from "url";
import { Config } from "../Config";
import { Audit } from "../Audit";
import { LoginProvider } from "../LoginProvider";
import { KubeUtil } from "../KubeUtil";
import { Readable, Stream } from "stream";
import { GridFSBucket, ObjectID, Db, Cursor, MongoNetworkError } from "mongodb";
import * as path from "path";
import { DatabaseConnection } from "../DatabaseConnection";
import { StripeMessage, EnsureStripeCustomerMessage, NoderedUtil, QueuedMessage, RegisterQueueMessage, QueueMessage, CloseQueueMessage, ListCollectionsMessage, DropCollectionMessage, QueryMessage, AggregateMessage, InsertOneMessage, UpdateOneMessage, Base, UpdateManyMessage, InsertOrUpdateOneMessage, DeleteOneMessage, MapReduceMessage, SigninMessage, TokenUser, User, Rights, EnsureNoderedInstanceMessage, DeleteNoderedInstanceMessage, DeleteNoderedPodMessage, RestartNoderedInstanceMessage, GetNoderedInstanceMessage, GetNoderedInstanceLogMessage, SaveFileMessage, WellknownIds, GetFileMessage, UpdateFileMessage, CreateWorkflowInstanceMessage, RegisterUserMessage, NoderedUser, WatchMessage, GetDocumentVersionMessage, DeleteManyMessage, InsertManyMessage, GetKubeNodeLabels } from "openflow-api";
import { Billing, stripe_customer, stripe_base, stripe_list, StripeAddPlanMessage, StripeCancelPlanMessage, stripe_subscription, stripe_subscription_item, stripe_plan, stripe_coupon } from "openflow-api";
import { V1ResourceRequirements, V1Deployment } from "@kubernetes/client-node";
import { amqpwrapper } from "../amqpwrapper";
import { WebSocketServerClient } from "../WebSocketServerClient";
import { DBHelper } from "../DBHelper";
import { WebSocketServer } from "../WebSocketServer";
const request = require("request");
const got = require("got");
const { RateLimiterMemory } = require('rate-limiter-flexible')
const BaseRateLimiter = new RateLimiterMemory({
    points: Config.socket_rate_limit_points,
    duration: Config.socket_rate_limit_duration,
});


const safeObjectID = (s: string | number | ObjectID) => ObjectID.isValid(s) ? new ObjectID(s) : null;
export class Message {
    public id: string;
    public replyto: string;
    public command: string;
    public data: string;
    public static fromcommand(command: string): Message {
        const result: Message = new Message();
        result.command = command;
        result.id = crypto.randomBytes(16).toString("hex");
        return result;
    }
    public static frommessage(msg: SocketMessage, data: string): Message {
        const result: Message = new Message();
        result.id = msg.id;
        result.replyto = msg.replyto;
        result.command = msg.command;
        result.data = data;
        return result;
    }
    public Reply(command: string = null): void {
        if (!NoderedUtil.IsNullEmpty(command)) { this.command = command; }
        this.replyto = this.id;
        this.id = crypto.randomBytes(16).toString("hex");
    }
    public async Process(cli: WebSocketServerClient): Promise<void> {
        try {
            let username: string = "Unknown";
            if (!NoderedUtil.IsNullUndefinded(cli.user)) { username = cli.user.username; }

            if (!NoderedUtil.IsNullEmpty(this.command)) { this.command = this.command.toLowerCase(); }
            let command: string = this.command;
            if (command == "ping" || command == "pong") {
                if (command == "ping") this.Ping(cli);
                cli.lastheartbeat = new Date();
                return;
            }
            try {
                if (Config.socket_rate_limit) await BaseRateLimiter.consume(cli.id);
            } catch (error) {
                if (error.consumedPoints) {
                    WebSocketServer.websocket_rate_limit.inc();
                    WebSocketServer.websocket_rate_limit.labels(command).inc();
                    if ((error.consumedPoints % 100) == 0) cli._logger.debug("[" + username + "/" + cli.clientagent + "/" + cli.id + "] SOCKET_RATE_LIMIT consumedPoints: " + error.consumedPoints + " remainingPoints: " + error.remainingPoints + " msBeforeNext: " + error.msBeforeNext);
                    setTimeout(() => { this.Process(cli); }, 250);
                }
                return;
            }

            if (!NoderedUtil.IsNullEmpty(this.replyto)) {
                const end = WebSocketServer.websocket_messages.startTimer();
                const qmsg: QueuedMessage = cli.messageQueue[this.replyto];
                if (!NoderedUtil.IsNullUndefinded(qmsg)) {
                    try {
                        qmsg.message = Object.assign(qmsg.message, JSON.parse(this.data));
                    } catch (error) {
                        // TODO: should we set message to data ?
                    }
                    if (!NoderedUtil.IsNullUndefinded(qmsg.cb)) { qmsg.cb(this); }
                    delete cli.messageQueue[this.replyto];
                    WebSocketServer.update_message_queue_count(cli);
                }
                end({ command: command });
                return;
            }
            const end = WebSocketServer.websocket_messages.startTimer();
            switch (command) {
                case "listcollections":
                    this.ListCollections(cli);
                    break;
                case "dropcollection":
                    this.DropCollection(cli);
                    break;
                case "query":
                    this.Query(cli);
                    break;
                case "getdocumentversion":
                    this.GetDocumentVersion(cli);
                    break;
                case "aggregate":
                    this.Aggregate(cli);
                    break;
                case "watch":
                    this.Watch(cli);
                    break;
                case "unwatch":
                    this.UnWatch(cli);
                    break;
                case "insertone":
                    this.InsertOne(cli);
                    break;
                case "insertmany":
                    this.InsertMany(cli);
                    break;
                case "updateone":
                    this.UpdateOne(cli);
                    break;
                case "updatemany":
                    this.UpdateMany(cli);
                    break;
                case "insertorupdateone":
                    this.InsertOrUpdateOne(cli);
                    break;
                case "deleteone":
                    this.DeleteOne(cli);
                    break;
                case "deletemany":
                    this.DeleteMany(cli);
                    break;
                case "signin":
                    this.Signin(cli);
                    break;
                case "registeruser":
                    this.RegisterUser(cli);
                    break;
                case "mapreduce":
                    this.MapReduce(cli);
                    break;
                case "refreshtoken":
                    break;
                case "error":
                    // this.Ping(cli);
                    break;
                case "registerqueue":
                    this.RegisterQueue(cli);
                    break;
                case "queuemessage":
                    this.QueueMessage(cli);
                    break;
                case "closequeue":
                    this.CloseQueue(cli);
                    break;
                case "ensurenoderedinstance":
                    this.EnsureNoderedInstance(cli);
                    break;
                case "deletenoderedinstance":
                    this.DeleteNoderedInstance(cli);
                    break;
                case "restartnoderedinstance":
                    this.RestartNoderedInstance(cli);
                    break;
                case "getkubenodelabels":
                    this.GetKubeNodeLabels(cli);
                    break;
                case "getnoderedinstance":
                    this.GetNoderedInstance(cli);
                    break;
                case "getnoderedinstancelog":
                    this.GetNoderedInstanceLog(cli);
                    break;
                case "startnoderedinstance":
                    this.StartNoderedInstance(cli);
                    break;
                case "stopnoderedinstance":
                    this.StopNoderedInstance(cli);
                    break;
                case "deletenoderedpod":
                    this.DeleteNoderedPod(cli);
                    break;
                case "savefile":
                    this.SaveFile(cli);
                    break;
                case "getfile":
                    this.GetFile(cli);
                    break;
                case "updatefile":
                    this.UpdateFile(cli);
                    break;
                case "createworkflowinstance":
                    this.CreateWorkflowInstance(cli);
                    break;
                case "stripeaddplan":
                    this.StripeAddPlan(cli);
                    break;
                case "stripecancelplan":
                    this.StripeCancelPlan(cli);
                    break;
                case "ensurestripecustomer":
                    this.EnsureStripeCustomer(cli);
                    break;
                case "stripemessage":
                    this.StripeMessage(cli);
                    break;
                case "dumpclients":
                    this.DumpClients(cli);
                    break;
                case "dumprabbitmq":
                    this.DumpRabbitmq(cli);
                    break;
                case "getrabbitmqqueue":
                    this.GetRabbitmqQueue(cli);
                    break;
                case "deleterabbitmqqueue":
                    this.DeleterabbitmqQueue(cli);
                    break;
                default:
                    this.UnknownCommand(cli);
                    break;
            }
            end({ command: command });
        } catch (error) {
            cli._logger.error(error);
        }
    }
    async RegisterQueue(cli: WebSocketServerClient) {
        this.Reply();
        let msg: RegisterQueueMessage;
        try {
            msg = RegisterQueueMessage.assign(this.data);
            msg.queuename = await cli.CreateConsumer(msg.queuename);
        } catch (error) {
            cli._logger.error(error);
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }
    async QueueMessage(cli: WebSocketServerClient) {
        this.Reply();
        let msg: QueueMessage
        try {
            msg = QueueMessage.assign(this.data);
            if (NoderedUtil.IsNullUndefinded(msg.jwt)) msg.jwt = cli.jwt;
            if (!NoderedUtil.IsNullUndefinded(msg.data)) {
                if (typeof msg.data == 'string') {
                    try {
                        const obj = JSON.parse(msg.data);
                    } catch (error) {
                    }
                } else {
                    msg.data.jwt = msg.jwt;
                }
            }
            const expiration: number = (typeof msg.expiration == 'number' ? msg.expiration : Config.amqp_default_expiration);
            if (typeof msg.data === 'string' || msg.data instanceof String) {
                try {
                    msg.data = JSON.parse((msg.data as any));
                } catch (error) {
                }
            }
            const sendthis: any = msg.data;
            try {
                if (NoderedUtil.IsNullEmpty(msg.jwt) && !NoderedUtil.IsNullEmpty(msg.data.jwt)) {
                    msg.jwt = msg.data.jwt;
                }
                if (NoderedUtil.IsNullEmpty(msg.jwt)) {
                    msg.jwt = cli.jwt;
                }
                if (!NoderedUtil.IsNullEmpty(msg.jwt)) {
                    const tuser = Crypt.verityToken(msg.jwt);
                    msg.user = tuser;
                }
                if (typeof sendthis === "object") {
                    sendthis.__jwt = msg.jwt;
                    sendthis.__user = msg.user;
                }
            } catch (error) {
                cli._logger.error(error);
            }
            if (NoderedUtil.IsNullEmpty(msg.replyto)) {
                const sendthis = msg.data;
                await amqpwrapper.Instance().send("", msg.queuename, sendthis, expiration, msg.correlationId);
            } else {
                if (msg.queuename === msg.replyto) {
                    throw new Error("Cannot send reply to self queuename:" + msg.queuename + " correlationId:" + msg.correlationId);
                }
                const sendthis = msg.data;
                const result = await amqpwrapper.Instance().sendWithReplyTo("", msg.queuename, msg.replyto, sendthis, expiration, msg.correlationId);
            }
        } catch (error) {
            cli._logger.error(error);
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }
    async CloseQueue(cli: WebSocketServerClient) {
        this.Reply();
        let msg: CloseQueueMessage
        try {
            msg = CloseQueueMessage.assign(this.data);
            await cli.CloseConsumer(msg.queuename);
        } catch (error) {
            cli._logger.error(error);
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }
    public Send(cli: WebSocketServerClient): void {
        cli.Send(this);
    }
    private UnknownCommand(cli: WebSocketServerClient): void {
        this.Reply("error");
        this.data = "Unknown command " + this.command;
        cli._logger.error(new Error(this.data));
        this.Send(cli);
    }
    private Ping(cli: WebSocketServerClient): void {
        this.Reply("pong");
        this.Send(cli);
    }
    private static collectionCache: any = {};
    private static collectionCachetime: Date = new Date();
    private async ListCollections(cli: WebSocketServerClient): Promise<void> {
        this.Reply();
        let msg: ListCollectionsMessage
        try {
            msg = ListCollectionsMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            const d = new Date(Message.collectionCachetime.getTime() + 1000 * 60);
            if (d < new Date()) {
                Message.collectionCache = {};
                Message.collectionCachetime = new Date();
            }
            if (Message.collectionCache[msg.jwt] != null) {
                msg.result = Message.collectionCache[msg.jwt];
            } else {
                msg.result = await Config.db.ListCollections(msg.jwt);
                if (msg.includehist !== true) {
                    msg.result = msg.result.filter(x => !x.name.endsWith("_hist"));
                }
                msg.result = msg.result.filter(x => x.name != "fs.chunks");
                msg.result = msg.result.filter(x => x.name != "fs.files");
                msg.result = msg.result.filter(x => x.name != "uploads.files");
                msg.result = msg.result.filter(x => x.name != "uploads.chunks");
                const result = [];
                // filter out collections that are empty, or we don't have access too
                for (let i = 0; i < msg.result.length; i++) {
                    const collectioname = msg.result[i].name;
                    result.push(msg.result[i]);
                }
                if (result.filter(x => x.name == "entities").length == 0) {
                    result.push({ name: "entities", type: "collection" });
                }
                Message.collectionCache[msg.jwt] = result;
                msg.result = result;
            }
        } catch (error) {
            cli._logger.error(error);
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }
    private async DropCollection(cli: WebSocketServerClient): Promise<void> {
        this.Reply();
        let msg: DropCollectionMessage
        try {
            msg = DropCollectionMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            await Config.db.DropCollection(msg.collectionname, msg.jwt);
        } catch (error) {
            cli._logger.error(error);
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }
    private async Query(cli: WebSocketServerClient): Promise<void> {
        this.Reply();
        let msg: QueryMessage
        try {
            msg = QueryMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            if (NoderedUtil.IsNullEmpty(msg.jwt)) {
                msg.error = "Access denied, not signed in";
            } else {
                msg.result = await Config.db.query(msg.query, msg.projection, msg.top, msg.skip, msg.orderby, msg.collectionname, msg.jwt, msg.queryas, msg.hint);
            }
        } catch (error) {
            cli._logger.error(error);
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }
    private async GetDocumentVersion(cli: WebSocketServerClient): Promise<void> {
        this.Reply();
        let msg: GetDocumentVersionMessage
        try {
            msg = GetDocumentVersionMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            if (NoderedUtil.IsNullEmpty(msg.jwt)) {
                msg.error = "Access denied, not signed in";
            } else {
                msg.result = await Config.db.GetDocumentVersion(msg.collectionname, msg._id, msg.version, msg.jwt);
            }
        } catch (error) {
            cli._logger.error(error);
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }

    private async Aggregate(cli: WebSocketServerClient): Promise<void> {
        this.Reply();
        let msg: AggregateMessage
        try {
            msg = AggregateMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            msg.result = await Config.db.aggregate(msg.aggregates, msg.collectionname, msg.jwt, msg.hint);
        } catch (error) {
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
            cli._logger.error(error);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }
    private async UnWatch(cli: WebSocketServerClient): Promise<void> {
        this.Reply();
        let msg: WatchMessage
        try {
            msg = WatchMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            if (Config.supports_watch) {
                await cli.UnWatch(msg.id, msg.jwt);
            } else {
                msg.error = "Watch is not supported by this openflow";
            }

            msg.result = null;
        } catch (error) {
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
            cli._logger.error(error);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }
    private async Watch(cli: WebSocketServerClient): Promise<void> {
        this.Reply();
        let msg: WatchMessage
        try {
            msg = WatchMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            if (Config.supports_watch) {
                msg.id = await cli.Watch(msg.aggregates, msg.collectionname, msg.jwt);
            } else {
                msg.error = "Watch is not supported by this openflow";
            }
            msg.result = null;
        } catch (error) {
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
            cli._logger.error(error);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }
    private async InsertOne(cli: WebSocketServerClient): Promise<void> {
        this.Reply();
        let msg: InsertOneMessage
        try {
            msg = InsertOneMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            if (NoderedUtil.IsNullEmpty(msg.w as any)) { msg.w = 0; }
            if (NoderedUtil.IsNullEmpty(msg.j as any)) { msg.j = false; }
            if (NoderedUtil.IsNullEmpty(msg.jwt)) {
                throw new Error("jwt is null and client is not authenticated");
            }
            msg.result = await Config.db.InsertOne(msg.item, msg.collectionname, msg.w, msg.j, msg.jwt);
        } catch (error) {
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
            cli._logger.error(error);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }
    private async InsertMany(cli: WebSocketServerClient): Promise<void> {
        this.Reply();
        let msg: InsertManyMessage
        try {
            msg = InsertManyMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            if (NoderedUtil.IsNullEmpty(msg.w as any)) { msg.w = 0; }
            if (NoderedUtil.IsNullEmpty(msg.j as any)) { msg.j = false; }
            if (NoderedUtil.IsNullEmpty(msg.jwt)) {
                throw new Error("jwt is null and client is not authenticated");
            }
            const Promises: Promise<any>[] = [];
            for (let i: number = 0; i < msg.items.length; i++) {
                Promises.push(Config.db.InsertOne(msg.items[i], msg.collectionname, msg.w, msg.j, msg.jwt));
            }
            msg.results = await Promise.all(Promises.map(p => p.catch(e => e)));
            if (msg.skipresults) msg.results = [];
        } catch (error) {
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
            cli._logger.error(error);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }
    private async UpdateOne(cli: WebSocketServerClient): Promise<void> {
        this.Reply();
        let msg: UpdateOneMessage
        try {
            msg = UpdateOneMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            if (NoderedUtil.IsNullEmpty(msg.w as any)) { msg.w = 0; }
            if (NoderedUtil.IsNullEmpty(msg.j as any)) { msg.j = false; }
            msg = await Config.db.UpdateOne(msg);
        } catch (error) {
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
            cli._logger.error(error);
        }
        try {
            delete msg.query;
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }
    private async UpdateMany(cli: WebSocketServerClient): Promise<void> {
        this.Reply();
        let msg: UpdateManyMessage
        try {
            msg = UpdateManyMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            if (NoderedUtil.IsNullEmpty(msg.w as any)) { msg.w = 0; }
            if (NoderedUtil.IsNullEmpty(msg.j as any)) { msg.j = false; }
            msg = await Config.db.UpdateMany(msg);
        } catch (error) {
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
            cli._logger.error(error);
        }
        try {
            delete msg.query;
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }

    private async InsertOrUpdateOne(cli: WebSocketServerClient): Promise<void> {
        this.Reply();
        let msg: InsertOrUpdateOneMessage
        try {
            msg = InsertOrUpdateOneMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            if (NoderedUtil.IsNullEmpty(msg.w as any)) { msg.w = 0; }
            if (NoderedUtil.IsNullEmpty(msg.j as any)) { msg.j = false; }
            msg = await Config.db.InsertOrUpdateOne(msg);
        } catch (error) {
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
            cli._logger.error(error);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }
    private async DeleteOne(cli: WebSocketServerClient): Promise<void> {
        this.Reply();
        let msg: DeleteOneMessage
        try {
            msg = DeleteOneMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            await Config.db.DeleteOne(msg._id, msg.collectionname, msg.jwt);
        } catch (error) {
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
            cli._logger.error(error);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }
    private async DeleteMany(cli: WebSocketServerClient): Promise<void> {
        this.Reply();
        let msg: DeleteManyMessage
        try {
            msg = DeleteManyMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            msg.affectedrows = await Config.db.DeleteMany(msg.query, msg.ids, msg.collectionname, msg.jwt);
        } catch (error) {
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
            cli._logger.error(error);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }
    private async MapReduce(cli: WebSocketServerClient): Promise<void> {
        this.Reply();
        let msg: MapReduceMessage
        try {
            msg = MapReduceMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            msg.result = await Config.db.MapReduce(msg.map, msg.reduce, msg.finalize, msg.query, msg.out, msg.collectionname, msg.scope, msg.jwt);
        } catch (error) {
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
            cli._logger.error(error);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }
    public static async DoSignin(cli: WebSocketServerClient, rawAssertion: string): Promise<TokenUser> {
        let tuser: TokenUser;
        let user: User;
        let type: string = "jwtsignin";
        if (!NoderedUtil.IsNullEmpty(rawAssertion)) {
            type = "samltoken";
            user = await LoginProvider.validateToken(rawAssertion);
            tuser = TokenUser.From(user);
        } else if (!NoderedUtil.IsNullEmpty(cli.jwt)) {
            tuser = Crypt.verityToken(cli.jwt);
            user = await DBHelper.FindByUsername(tuser.username);
            tuser = TokenUser.From(user);
        }
        if (user.disabled) {
            Audit.LoginFailed(tuser.username, type, "websocket", cli.remoteip, cli.clientagent, cli.clientversion);
            tuser = null;
        } else {
            Audit.LoginSuccess(tuser, type, "websocket", cli.remoteip, cli.clientagent, cli.clientversion);
        }
        return tuser;
    }
    private async Signin2(cli: WebSocketServerClient): Promise<void> {
        this.Reply();
        let msg: SigninMessage
        let impostor: string = "";
        try {
        } catch (error) {
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
            cli._logger.error(error);
        }
        try {
            msg.websocket_package_size = Config.websocket_package_size;
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }
    private async Signin(cli: WebSocketServerClient): Promise<void> {
        this.Reply();
        const hrstart = process.hrtime()
        let hrend = process.hrtime(hrstart)
        let msg: SigninMessage
        let impostor: string = "";
        const UpdateDoc: any = { "$set": {} };
        try {
            msg = SigninMessage.assign(this.data);
            let tuser: TokenUser = null;
            let user: User = null;
            let type: string = "local";
            if (msg.jwt !== null && msg.jwt !== undefined) {
                type = "jwtsignin";
                tuser = Crypt.verityToken(msg.jwt);
                if (tuser.impostor !== null && tuser.impostor !== undefined && tuser.impostor !== "") {
                    impostor = tuser.impostor;
                }
                user = await DBHelper.FindByUsername(tuser.username);
                if (user !== null && user !== undefined) {
                    // refresh, for roles and stuff
                    tuser = TokenUser.From(user);
                } else { // Autocreate user .... safe ?? we use this for autocreating nodered service accounts
                    if (Config.auto_create_users == true) {
                        const jwt: string = Crypt.rootToken();
                        user = await DBHelper.ensureUser(jwt, tuser.name, tuser.username, null, msg.password);
                        if (user != null) tuser = TokenUser.From(user);
                        if (user == null) {
                            tuser = new TokenUser();
                            tuser.username = msg.username;
                        }
                    } else {
                        if (msg !== null && msg !== undefined) msg.error = "Unknown username or password";
                    }
                }
                if (impostor !== "") {
                    tuser.impostor = impostor;
                }
            } else if (msg.rawAssertion !== null && msg.rawAssertion !== undefined) {
                type = "samltoken";
                user = await LoginProvider.validateToken(msg.rawAssertion);
                // refresh, for roles and stuff
                if (user !== null && user != undefined) { tuser = TokenUser.From(user); }
                msg.rawAssertion = "";
            } else {
                user = await Auth.ValidateByPassword(msg.username, msg.password);
                tuser = null;
                // refresh, for roles and stuff
                if (user != null) tuser = TokenUser.From(user);
                if (user == null) {
                    tuser = new TokenUser();
                    tuser.username = msg.username;
                }
            }
            cli.clientagent = msg.clientagent;
            cli.clientversion = msg.clientversion;
            if (user === null || user === undefined || tuser === null || tuser === undefined) {
                if (msg !== null && msg !== undefined) msg.error = "Unknown username or password";
                Audit.LoginFailed(tuser.username, type, "websocket", cli.remoteip, cli.clientagent, cli.clientversion);
                cli._logger.debug(tuser.username + " failed logging in using " + type);
            } else if (user.disabled) {
                if (msg !== null && msg !== undefined) msg.error = "Disabled users cannot signin";
                Audit.LoginFailed(tuser.username, type, "websocket", cli.remoteip, cli.clientagent, cli.clientversion);
                cli._logger.debug("Disabled user " + tuser.username + " failed logging in using " + type);
            } else {
                if (msg.impersonate == "-1" || msg.impersonate == "false") {
                    user = await DBHelper.FindById(impostor, Crypt.rootToken());
                    UpdateDoc.$set["impersonating"] = undefined;
                    user.impersonating = undefined;
                    tuser = TokenUser.From(user);
                    msg.impersonate = undefined;
                    impostor = undefined;
                }
                Audit.LoginSuccess(tuser, type, "websocket", cli.remoteip, cli.clientagent, cli.clientversion);
                const userid: string = user._id;
                if (msg.longtoken) {
                    msg.jwt = Crypt.createToken(tuser, Config.longtoken_expires_in);
                } else {
                    msg.jwt = Crypt.createToken(tuser, Config.shorttoken_expires_in);
                }
                msg.user = tuser;
                if (!NoderedUtil.IsNullEmpty(user.impersonating) && NoderedUtil.IsNullEmpty(msg.impersonate)) {
                    const items = await Config.db.query({ _id: user.impersonating }, null, 1, 0, null, "users", msg.jwt);
                    if (items.length == 0) {
                        msg.impersonate = null;
                    } else {
                        msg.impersonate = user.impersonating;
                    }
                }
                if (msg.impersonate !== undefined && msg.impersonate !== null && msg.impersonate !== "" && tuser._id != msg.impersonate) {
                    const items = await Config.db.query({ _id: msg.impersonate }, null, 1, 0, null, "users", msg.jwt);
                    if (items.length == 0) {
                        const impostors = await Config.db.query<User>({ _id: msg.impersonate }, null, 1, 0, null, "users", Crypt.rootToken());
                        const impb: User = new User(); impb.name = "unknown"; impb._id = msg.impersonate;
                        let imp: TokenUser = TokenUser.From(impb);
                        if (impostors.length == 1) {
                            imp = TokenUser.From(impostors[0]);
                        }
                        Audit.ImpersonateFailed(imp, tuser, cli.clientagent, cli.clientversion);
                        throw new Error("Permission denied, " + tuser.name + "/" + tuser._id + " view and impersonating " + msg.impersonate);
                    }
                    const tuserimpostor = tuser;
                    user = User.assign(items[0] as User);
                    await DBHelper.DecorateWithRoles(user);
                    // Check we have update rights
                    try {
                        await DBHelper.Save(user, msg.jwt);
                        await Config.db._UpdateOne({ _id: tuserimpostor._id }, { "$set": { "impersonating": user._id } } as any, "users", 1, false, msg.jwt);
                    } catch (error) {
                        const impostors = await Config.db.query<User>({ _id: msg.impersonate }, null, 1, 0, null, "users", Crypt.rootToken());
                        const impb: User = new User(); impb.name = "unknown"; impb._id = msg.impersonate;
                        let imp: TokenUser = TokenUser.From(impb);
                        if (impostors.length == 1) {
                            imp = TokenUser.From(impostors[0]);
                        }

                        Audit.ImpersonateFailed(imp, tuser, cli.clientagent, cli.clientversion);
                        throw new Error("Permission denied, " + tuser.name + "/" + tuser._id + " updating and impersonating " + msg.impersonate);
                    }

                    tuser = TokenUser.From(user);
                    tuser.impostor = userid;
                    if (msg.longtoken) {
                        msg.jwt = Crypt.createToken(tuser, Config.longtoken_expires_in);
                    } else {
                        msg.jwt = Crypt.createToken(tuser, Config.shorttoken_expires_in);
                    }
                    msg.user = tuser;
                    Audit.ImpersonateSuccess(tuser, tuserimpostor, cli.clientagent, cli.clientversion);
                }
                if (msg.firebasetoken != null && msg.firebasetoken != undefined && msg.firebasetoken != "") {
                    UpdateDoc.$set["firebasetoken"] = msg.firebasetoken;
                    user.firebasetoken = msg.firebasetoken;
                }
                if (msg.onesignalid != null && msg.onesignalid != undefined && msg.onesignalid != "") {
                    UpdateDoc.$set["onesignalid"] = msg.onesignalid;
                    user.onesignalid = msg.onesignalid;
                }
                if (msg.gpslocation != null && msg.gpslocation != undefined && msg.gpslocation != "") {
                    UpdateDoc.$set["gpslocation"] = msg.gpslocation;
                    user.gpslocation = msg.gpslocation;
                }
                if (msg.device != null && msg.device != undefined && msg.device != "") {
                    UpdateDoc.$set["device"] = msg.device;
                    user.device = msg.device;
                }
                if (msg.validate_only !== true) {
                    cli._logger.debug(tuser.username + " signed in using " + type + " " + cli.id + "/" + cli.clientagent);
                    cli.jwt = msg.jwt;
                    cli.user = user;
                } else {
                    cli._logger.debug(tuser.username + " was validated in using " + type);
                }
                if (msg.impersonate === undefined || msg.impersonate === null || msg.impersonate === "") {
                    user.lastseen = new Date(new Date().toISOString());
                    UpdateDoc.$set["lastseen"] = user.lastseen;
                }
                msg.supports_watch = Config.supports_watch;
                user._lastclientagent = cli.clientagent;
                UpdateDoc.$set["clientagent"] = cli.clientagent;
                user._lastclientversion = cli.clientversion;
                UpdateDoc.$set["clientversion"] = cli.clientversion;
                if (cli.clientagent == "openrpa") {
                    user._lastopenrpaclientversion = cli.clientversion;
                    UpdateDoc.$set["_lastopenrpaclientversion"] = cli.clientversion;
                }
                if (cli.clientagent == "nodered") {
                    user._lastnoderedclientversion = cli.clientversion;
                    UpdateDoc.$set["_lastnoderedclientversion"] = cli.clientversion;
                }
                if (cli.clientagent == "powershell") {
                    user._lastpowershellclientversion = cli.clientversion;
                    UpdateDoc.$set["_lastpowershellclientversion"] = cli.clientversion;
                }
                // await DBHelper.Save(user, Crypt.rootToken());
                await Config.db._UpdateOne({ "_id": user._id }, UpdateDoc, "users", 1, false, Crypt.rootToken())
            }
        } catch (error) {
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
            cli._logger.error(error);
        }
        try {
            msg.websocket_package_size = Config.websocket_package_size;
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        hrend = process.hrtime(hrstart)
        console.log(`[Signin Completed] Execution time:${(hrend[0] * 1000000000 + hrend[1]) / 1000000} ms`)
        this.Send(cli);
    }
    private async RegisterUser(cli: WebSocketServerClient): Promise<void> {
        this.Reply();
        let msg: RegisterUserMessage;
        let user: User;
        try {
            msg = RegisterUserMessage.assign(this.data);
            if (msg.name == null || msg.name == undefined || msg.name == "") { throw new Error("Name cannot be null"); }
            if (msg.username == null || msg.username == undefined || msg.username == "") { throw new Error("Username cannot be null"); }
            if (msg.password == null || msg.password == undefined || msg.password == "") { throw new Error("Password cannot be null"); }
            user = await DBHelper.FindByUsername(msg.username);
            if (user !== null && user !== undefined) { throw new Error("Illegal username"); }
            user = await DBHelper.ensureUser(Crypt.rootToken(), msg.name, msg.username, null, msg.password);
            msg.user = TokenUser.From(user);

            const jwt: string = Crypt.createToken(msg.user, Config.shorttoken_expires_in);
            let name = user.username;
            name = name.split("@").join("").split(".").join("");
            name = name.toLowerCase();

            cli._logger.debug("[" + user.username + "] ensure nodered role " + name + "noderedadmins");
            const noderedadmins = await DBHelper.EnsureRole(jwt, name + "noderedadmins", null);
            Base.addRight(noderedadmins, user._id, user.username, [Rights.full_control]);
            Base.removeRight(noderedadmins, user._id, [Rights.delete]);
            noderedadmins.AddMember(user);
            cli._logger.debug("[" + user.username + "] update nodered role " + name + "noderedadmins");
            await DBHelper.Save(noderedadmins, jwt);

        } catch (error) {
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
            cli._logger.error(error);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }
    private async GetInstanceName(_id: string, myid: string, myusername: string, jwt: string): Promise<string> {
        let name: string = "";
        if (_id !== null && _id !== undefined && _id !== "" && _id != myid) {
            var qs: any[] = [{ _id: _id }];
            qs.push(Config.db.getbasequery(jwt, "_acl", [Rights.update]))
            const res = await Config.db.query<User>({ "$and": qs }, null, 1, 0, null, "users", jwt);
            if (res.length == 0) {
                throw new Error("Unknown userid " + _id + " or permission denied");
            }
            name = res[0].username;
        } else {
            name = myusername;
        }
        name = name.split("@").join("").split(".").join("");
        name = name.toLowerCase();
        return name;
    }
    private async EnsureNoderedInstance(cli: WebSocketServerClient): Promise<void> {
        this.Reply();
        let msg: EnsureNoderedInstanceMessage;
        try {
            msg = EnsureNoderedInstanceMessage.assign(this.data);
            await this._EnsureNoderedInstance(cli, msg._id, false);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
            //msg.error = JSON.stringify(error, null, 2);
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }
    private async _EnsureNoderedInstance(cli: WebSocketServerClient, _id: string, skipcreate: boolean): Promise<void> {
        let user: NoderedUser;
        cli._logger.debug("[" + cli.user.username + "] EnsureNoderedInstance");
        if (_id === null || _id === undefined || _id === "") _id = cli.user._id;
        const name = await this.GetInstanceName(_id, cli.user._id, cli.user.username, cli.jwt);

        const users = await Config.db.query<NoderedUser>({ _id: _id }, null, 1, 0, null, "users", cli.jwt);
        if (users.length == 0) {
            throw new Error("Unknown userid " + _id);
        }
        user = NoderedUser.assign(users[0]);
        const rootjwt = Crypt.rootToken();

        const namespace = Config.namespace;
        const hostname = Config.nodered_domain_schema.replace("$nodered_id$", name);

        const nodereduser = await DBHelper.FindById(_id, cli.jwt);
        const tuser: TokenUser = TokenUser.From(nodereduser);
        const nodered_jwt: string = Crypt.createToken(tuser, Config.personalnoderedtoken_expires_in);

        cli._logger.debug("[" + cli.user.username + "] ensure nodered role " + name + "noderedadmins");
        const noderedadmins = await DBHelper.EnsureRole(cli.jwt, name + "noderedadmins", null);
        Base.addRight(noderedadmins, nodereduser._id, nodereduser.username, [Rights.full_control]);
        Base.removeRight(noderedadmins, nodereduser._id, [Rights.delete]);
        Base.addRight(noderedadmins, cli.user._id, cli.user.username, [Rights.full_control]);
        Base.removeRight(noderedadmins, cli.user._id, [Rights.delete]);
        noderedadmins.AddMember(nodereduser);
        cli._logger.debug("[" + cli.user.username + "] update nodered role " + name + "noderedadmins");
        await DBHelper.Save(noderedadmins, cli.jwt);

        const resources = new V1ResourceRequirements();
        let hasbilling: boolean = false;
        resources.limits = {};
        resources.requests = {};
        if (!NoderedUtil.IsNullEmpty(Config.nodered_requests_memory)) resources.requests.memory = Config.nodered_requests_memory;
        if (!NoderedUtil.IsNullEmpty(Config.nodered_requests_cpu)) resources.requests.cpu = Config.nodered_requests_cpu;
        if (!NoderedUtil.IsNullEmpty(Config.nodered_limits_memory)) resources.limits.memory = Config.nodered_limits_memory;
        if (!NoderedUtil.IsNullEmpty(Config.nodered_limits_cpu)) resources.limits.cpu = Config.nodered_limits_cpu;



        if (user.nodered) {
            try {
                if (user.nodered.api_allow_anonymous == null) user.nodered.api_allow_anonymous = false;
            } catch (error) {
                user.nodered = { api_allow_anonymous: false } as any;
            }
        }
        if (user.nodered && user.nodered.resources) {
            if (NoderedUtil.IsNullEmpty(Config.stripe_api_secret)) {
                if (user.nodered.resources.limits) {
                    resources.limits.memory = user.nodered.resources.limits.memory;
                    resources.limits.cpu = user.nodered.resources.limits.cpu;
                    resources.requests.memory = user.nodered.resources.limits.memory;
                    resources.requests.cpu = user.nodered.resources.limits.cpu;
                }
                if (user.nodered.resources.requests) {
                    resources.requests.memory = user.nodered.resources.requests.memory;
                    resources.requests.cpu = user.nodered.resources.requests.cpu;
                }
            } else {
                const billings = await Config.db.query<Billing>({ userid: _id, _type: "billing" }, null, 1, 0, null, "users", rootjwt);
                if (billings.length > 0) {
                    const billing: Billing = billings[0];
                    if (!NoderedUtil.IsNullEmpty(billing.memory)) resources.limits.memory = billing.memory;
                    if (!NoderedUtil.IsNullEmpty((billing as any).cpu)) resources.limits.memory = (billing as any).cpu;
                    if (!NoderedUtil.IsNullEmpty(billing.memory)) resources.requests.memory = billing.memory;
                    if (!NoderedUtil.IsNullEmpty((billing as any).cpu)) resources.limits.memory = (billing as any).cpu;

                    if (!NoderedUtil.IsNullEmpty(billing.openflowuserplan)) {
                        hasbilling = true;
                    }
                }

            }
        } else {
            if (!NoderedUtil.IsNullEmpty(Config.stripe_api_secret)) {
                const billings = await Config.db.query<Billing>({ userid: _id, _type: "billing" }, null, 1, 0, null, "users", rootjwt);
                if (billings.length > 0) {
                    const billing: Billing = billings[0];
                    if (!NoderedUtil.IsNullEmpty(billing.memory)) resources.limits.memory = billing.memory;
                    if (!NoderedUtil.IsNullEmpty((billing as any).cpu)) resources.limits.memory = (billing as any).cpu;
                    if (!NoderedUtil.IsNullEmpty(billing.memory)) resources.requests.memory = billing.memory;
                    if (!NoderedUtil.IsNullEmpty((billing as any).cpu)) resources.limits.memory = (billing as any).cpu;
                    if (!NoderedUtil.IsNullEmpty(billing.openflowuserplan)) {
                        hasbilling = true;
                    }
                }
            }
        }
        let livenessProbe: any = {
            httpGet: {
                path: "/livenessprobe",
                port: 80,
                scheme: "HTTP"
            },
            initialDelaySeconds: Config.nodered_initial_liveness_delay,
            periodSeconds: 5,
            failureThreshold: 5,
            timeoutSeconds: 5
        }
        if (user.nodered && (user.nodered as any).livenessProbe) {
            livenessProbe = (user.nodered as any).livenessProbe;
        }

        cli._logger.debug("[" + cli.user.username + "] GetDeployments");
        const deployment: V1Deployment = await KubeUtil.instance().GetDeployment(namespace, name);
        if (deployment == null) {
            if (skipcreate) return;
            cli._logger.debug("[" + cli.user.username + "] Deployment " + name + " not found in " + namespace + " so creating it");

            let api_ws_url = Config.basewsurl();
            if (!NoderedUtil.IsNullEmpty(Config.api_ws_url)) api_ws_url = Config.api_ws_url;
            if (!NoderedUtil.IsNullEmpty(Config.nodered_ws_url)) api_ws_url = Config.nodered_ws_url;
            if (!api_ws_url.endsWith("/")) api_ws_url += "/";



            let saml_baseurl = Config.protocol + "://" + hostname + "/";

            let _samlparsed = url.parse(Config.saml_federation_metadata);
            if (_samlparsed.protocol == "http:" || _samlparsed.protocol == "ws:") {
                saml_baseurl = "http://" + hostname
                if (_samlparsed.port && _samlparsed.port != "80") {
                    saml_baseurl += ":" + _samlparsed.port;
                }
            } else {
                saml_baseurl = "https://" + hostname
                if (_samlparsed.port && _samlparsed.port != "443") {
                    saml_baseurl += ":" + _samlparsed.port;
                }
            }
            saml_baseurl += "/";

            // _url = "ws://" + url.parse(baseurl).host;

            // const api_ws_url = Config.api_ws_url;
            // const api_ws_url = Config.baseurl();
            // const api_ws_url = "ws://api/";
            // const api_ws_url = "https://demo.openiap.io/"
            // const api_ws_url = "https://demo.openiap.io/"
            const _deployment = {
                metadata: { name: name, namespace: namespace, labels: { billed: hasbilling.toString(), userid: _id, app: name } },
                spec: {
                    replicas: 1,
                    selector: { matchLabels: { app: name } },
                    template: {
                        metadata: { labels: { name: name, app: name, billed: hasbilling.toString(), userid: _id } },
                        spec: {
                            containers: [
                                {
                                    name: 'nodered',
                                    image: Config.nodered_image,
                                    imagePullPolicy: "Always",
                                    ports: [{ containerPort: 80 }, { containerPort: 5859 }],
                                    resources: resources,
                                    env: [
                                        { name: "saml_federation_metadata", value: Config.saml_federation_metadata },
                                        { name: "saml_issuer", value: Config.saml_issuer },
                                        { name: "saml_baseurl", value: saml_baseurl },
                                        { name: "nodered_id", value: name },
                                        { name: "nodered_sa", value: nodereduser.username },
                                        { name: "jwt", value: nodered_jwt },
                                        { name: "queue_prefix", value: user.nodered.queue_prefix },
                                        { name: "api_ws_url", value: api_ws_url },
                                        { name: "amqp_url", value: Config.amqp_url },
                                        { name: "nodered_domain_schema", value: hostname },
                                        { name: "domain", value: hostname },
                                        { name: "protocol", value: Config.protocol },
                                        { name: "port", value: Config.port.toString() },
                                        { name: "noderedusers", value: (name + "noderedusers") },
                                        { name: "noderedadmins", value: (name + "noderedadmins") },
                                        { name: "api_allow_anonymous", value: user.nodered.api_allow_anonymous.toString() },
                                        { name: "prometheus_measure_nodeid", value: Config.prometheus_measure_nodeid.toString() },
                                        { name: "prometheus_measure_queued_messages", value: Config.prometheus_measure_queued_messages.toString() },
                                        { name: "NODE_ENV", value: Config.NODE_ENV },
                                    ],
                                    livenessProbe: livenessProbe,
                                }
                            ]
                        }
                    }
                }
            }
            // if (_deployment && labels && Config.nodered_allow_nodeselector) {
            //     if (typeof labels === "string") {
            //         let item = JSON.parse(labels);
            //         let spec: any = _deployment.spec.template.spec;
            //         const keys = Object.keys(item);
            //         if (spec.nodeSelector == null) spec.nodeSelector = {};
            //         keys.forEach(key => {
            //             spec.nodeSelector[key] = item[key];
            //         })
            //     }
            // }
            if (user.nodered && user.nodered && (user.nodered as any).nodeselector && Config.nodered_allow_nodeselector) {
                var spec: any = _deployment.spec.template.spec;
                const keys = Object.keys((user.nodered as any).nodeselector);
                if (spec.nodeSelector == null) spec.nodeSelector = {};
                keys.forEach(key => {
                    spec.nodeSelector[key] = (user.nodered as any).nodeselector[key];
                })
            }
            try {
                await KubeUtil.instance().AppsV1Api.createNamespacedDeployment(namespace, (_deployment as any));
                Audit.NoderedAction(TokenUser.From(cli.user), true, name, "createdeployment", Config.nodered_image, null);
            } catch (error) {
                if (error.response && error.response.body && error.response.body.message) {
                    cli._logger.error(new Error(error.response.body.message));
                    throw new Error(error.response.body.message);
                }
                cli._logger.error(error);
                Audit.NoderedAction(TokenUser.From(cli.user), false, name, "createdeployment", Config.nodered_image, null);
                throw error;
            }
        } else {
            deployment.spec.template.spec.containers[0].resources = resources;
            const f = deployment.spec.template.spec.containers[0].env.filter(x => x.name == "api_allow_anonymous");
            if (f.length > 0) {
                f[0].value = user.nodered.api_allow_anonymous.toString();
            }
            deployment.metadata.labels.billed = hasbilling.toString();
            deployment.spec.template.metadata.labels.billed = hasbilling.toString();
            deployment.metadata.labels.userid = _id;
            deployment.spec.template.metadata.labels.userid = _id;
            let image: string = "unknown";
            try {
                image = deployment.spec.template.spec.containers[0].image;
            } catch (error) {

            }
            try {
                await KubeUtil.instance().AppsV1Api.replaceNamespacedDeployment(name, namespace, (deployment as any));
                Audit.NoderedAction(TokenUser.From(cli.user), true, name, "replacedeployment", image, null);
            } catch (error) {
                cli._logger.error("[" + cli.user.username + "] failed updating noeredinstance");
                cli._logger.error("[" + cli.user.username + "] " + JSON.stringify(error));
                if (error.response && error.response.body && !NoderedUtil.IsNullEmpty(error.response.body.message)) {
                    cli._logger.error(new Error(error.response.body.message));
                    throw new Error(error.response.body.message);
                }
                Audit.NoderedAction(TokenUser.From(cli.user), false, name, "replacedeployment", image, null);
                throw new Error("failed updating noeredinstance");
            }
        }

        cli._logger.debug("[" + cli.user.username + "] GetService");
        const service = await KubeUtil.instance().GetService(namespace, name);
        if (service == null) {
            cli._logger.debug("[" + cli.user.username + "] Service " + name + " not found in " + namespace + " creating it");
            const _service = {
                metadata: { name: name, namespace: namespace },
                spec: {
                    type: "NodePort",
                    sessionAffinity: "ClientIP",
                    selector: { app: name },
                    ports: [
                        { port: 80, name: "www" }
                    ]
                }
            }
            await KubeUtil.instance().CoreV1Api.createNamespacedService(namespace, _service);
        }
        cli._logger.debug("[" + cli.user.username + "] GetIngress useringress");
        const ingress = await KubeUtil.instance().GetIngress(namespace, "useringress");
        if (ingress !== null) {
            let rule = null;
            for (let i = 0; i < ingress.spec.rules.length; i++) {
                if (ingress.spec.rules[i].host == hostname) {
                    rule = ingress.spec.rules[i];
                }
            }
            if (rule == null) {
                cli._logger.debug("[" + cli.user.username + "] ingress " + hostname + " not found in useringress creating it");
                rule = {
                    host: hostname,
                    http: {
                        paths: [{
                            path: "/",
                            backend: {
                                serviceName: name,
                                servicePort: "www"
                            }
                        }]
                    }
                }
                delete ingress.metadata.creationTimestamp;
                delete ingress.status;
                ingress.spec.rules.push(rule);
                cli._logger.debug("[" + cli.user.username + "] replaceNamespacedIngress");
                await KubeUtil.instance().ExtensionsV1beta1Api.replaceNamespacedIngress("useringress", namespace, ingress);
            }
        } else {
            cli._logger.error("[" + cli.user.username + "] failed locating useringress");
            throw new Error("failed locating useringress");
        }
    }
    private async _DeleteNoderedInstance(_id: string, myuserid: string, myusername: string, jwt: string): Promise<void> {
        const name = await this.GetInstanceName(_id, myuserid, myusername, jwt);
        const user = Crypt.verityToken(jwt);
        const namespace = Config.namespace;
        const hostname = Config.nodered_domain_schema.replace("$nodered_id$", name);

        const deployment = await KubeUtil.instance().GetDeployment(namespace, name);
        if (deployment != null) {
            let image: string = "unknown";
            try {
                image = deployment.spec.template.spec.containers[0].image;
            } catch (error) {

            }
            try {
                await KubeUtil.instance().AppsV1Api.deleteNamespacedDeployment(name, namespace);
                Audit.NoderedAction(user, true, name, "deletedeployment", image, null);
            } catch (error) {
                Audit.NoderedAction(user, false, name, "deletedeployment", image, null);
                throw error;
            }
        }
        const service = await KubeUtil.instance().GetService(namespace, name);
        if (service != null) {
            await KubeUtil.instance().CoreV1Api.deleteNamespacedService(name, namespace);
        }
        const replicaset = await KubeUtil.instance().GetReplicaset(namespace, "app", name);
        if (replicaset !== null) {
            KubeUtil.instance().AppsV1Api.deleteNamespacedReplicaSet(replicaset.metadata.name, namespace);
        }
        const ingress = await KubeUtil.instance().GetIngress(namespace, "useringress");
        if (ingress !== null) {
            let updated = false;
            for (let i = ingress.spec.rules.length - 1; i >= 0; i--) {
                if (ingress.spec.rules[i].host == hostname) {
                    ingress.spec.rules.splice(i, 1);
                    updated = true;
                }
            }
            if (updated) {
                delete ingress.metadata.creationTimestamp;
                await KubeUtil.instance().ExtensionsV1beta1Api.replaceNamespacedIngress("useringress", namespace, ingress);
            }
        } else {
            throw new Error("failed locating useringress");
        }
    }
    private async DeleteNoderedInstance(cli: WebSocketServerClient): Promise<void> {
        this.Reply();
        let msg: DeleteNoderedInstanceMessage;
        let user: User;
        try {
            msg = DeleteNoderedInstanceMessage.assign(this.data);
            cli._logger.debug("[" + cli.user.username + "] DeleteNoderedInstance");
            await this._DeleteNoderedInstance(msg._id, cli.user._id, cli.user.username, cli.jwt);

        } catch (error) {
            cli._logger.error("[" + cli.user.username + "] failed locating useringress");
            this.data = "";
            cli._logger.error(error);
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }
    private async DeleteNoderedPod(cli: WebSocketServerClient): Promise<void> {
        this.Reply();
        let msg: DeleteNoderedPodMessage;
        let user: User;
        try {
            cli._logger.debug("[" + cli.user.username + "] DeleteNoderedInstance");
            msg = DeleteNoderedPodMessage.assign(this.data);
            const namespace = Config.namespace;
            const list = await KubeUtil.instance().CoreV1Api.listNamespacedPod(namespace);
            let image: string = "unknown";
            if (list.body.items.length > 0) {
                for (let i = 0; i < list.body.items.length; i++) {
                    const item = list.body.items[i];
                    if (item.metadata.name == msg.name) {
                        try {
                            image = item.spec.containers[0].image;
                        } catch (error) {

                        }
                        let name: string = "unknown";
                        try {
                            name = item.metadata.labels.name;
                        } catch (error) {

                        }
                        try {
                            await KubeUtil.instance().CoreV1Api.deleteNamespacedPod(item.metadata.name, namespace);
                            Audit.NoderedAction(TokenUser.From(cli.user), true, name, "deletepod", image, msg.name);
                        } catch (error) {
                            Audit.NoderedAction(TokenUser.From(cli.user), false, name, "deletepod", image, msg.name);
                            throw error;
                        }
                    }
                }
            } else {
                cli._logger.warn("[" + cli.user.username + "] DeleteNoderedPod: found NO Namespaced Pods ???");
                Audit.NoderedAction(TokenUser.From(cli.user), false, null, "deletepod", image, msg.name);
            }
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }
    private async RestartNoderedInstance(cli: WebSocketServerClient): Promise<void> {
        this.Reply();
        let msg: RestartNoderedInstanceMessage;
        try {
            cli._logger.debug("[" + cli.user.username + "] RestartNoderedInstance");
            msg = RestartNoderedInstanceMessage.assign(this.data);
            const name = await this.GetInstanceName(msg._id, cli.user._id, cli.user.username, cli.jwt);
            const namespace = Config.namespace;

            const list = await KubeUtil.instance().CoreV1Api.listNamespacedPod(namespace);
            for (let i = 0; i < list.body.items.length; i++) {
                const item = list.body.items[i];
                if (item.metadata.labels.app === name) {
                    let image: string = "unknown";
                    try {
                        image = item.spec.containers[0].image;
                    } catch (error) {

                    }
                    try {
                        await KubeUtil.instance().CoreV1Api.deleteNamespacedPod(item.metadata.name, namespace);
                        Audit.NoderedAction(TokenUser.From(cli.user), true, name, "restartdeployment", image, item.metadata.name);
                    } catch (error) {
                        Audit.NoderedAction(TokenUser.From(cli.user), false, name, "restartdeployment", image, item.metadata.name);
                    }
                }
            }
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }
    private async GetKubeNodeLabels(cli: WebSocketServerClient): Promise<void> {
        this.Reply();
        let msg: GetKubeNodeLabels;
        try {
            cli._logger.debug("[" + cli.user.username + "] GetKubeNodeLabels");
            msg = GetKubeNodeLabels.assign(this.data);
            if (Config.nodered_allow_nodeselector) {
                const list = await KubeUtil.instance().CoreV1Api.listNode();
                const result: any = {};
                if (list != null) {
                    list.body.items.forEach(node => {
                        if (node.metadata && node.metadata.labels) {
                            const keys = Object.keys(node.metadata.labels);
                            keys.forEach(key => {
                                let value = node.metadata.labels[key];
                                if (result[key] == null) result[key] = [];
                                if (result[key].indexOf(value) == -1) result[key].push(value);
                            });
                        }
                    });
                }
                msg.result = result;
            } else {
                msg.result = null;
            }
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }
    private async GetNoderedInstance(cli: WebSocketServerClient): Promise<void> {
        this.Reply();
        let msg: GetNoderedInstanceMessage;
        try {
            cli._logger.debug("[" + cli.user.username + "] GetNoderedInstance");
            msg = GetNoderedInstanceMessage.assign(this.data);
            const name = await this.GetInstanceName(msg._id, cli.user._id, cli.user.username, cli.jwt);
            const namespace = Config.namespace;
            const list = await KubeUtil.instance().CoreV1Api.listNamespacedPod(namespace);
            msg.result = null;
            msg.results = [];
            const rootjwt = Crypt.rootToken();
            if (list.body.items.length > 0) {
                let found: any = null;
                for (let i = 0; i < list.body.items.length; i++) {
                    const item = list.body.items[i];

                    if (!NoderedUtil.IsNullEmpty(Config.stripe_api_secret)) {
                        const itemname = item.metadata.name;
                        const create = item.metadata.creationTimestamp;
                        const billed = item.metadata.labels.billed;
                        const image = item.spec.containers[0].image
                        const userid = item.metadata.labels.userid;
                        const date = new Date();
                        const a: number = (date as any) - (create as any);
                        // const diffminutes = a / (1000 * 60);
                        const diffhours = a / (1000 * 60 * 60);
                        if (image.indexOf("openflownodered") > 0 && !NoderedUtil.IsNullEmpty(userid)) {
                            try {
                                if (billed != "true" && diffhours > 24) {
                                    cli._logger.debug("[" + cli.user.username + "] Remove un billed nodered instance " + itemname + " that has been running for " + diffhours + " hours");
                                    await this._DeleteNoderedInstance(userid, cli.user._id, cli.user.username, rootjwt);
                                }
                            } catch (error) {
                            }
                        } else if (image.indexOf("openflownodered") > 0) {
                            if (billed != "true" && diffhours > 24) {
                                console.debug("unbilled " + itemname + " with no userid, should be removed, it has been running for " + diffhours + " hours");
                            } else {
                                console.debug("unbilled " + itemname + " with no userid, has been running for " + diffhours + " hours");
                            }
                        }
                    }
                    if (!NoderedUtil.IsNullEmpty(msg.name) && item.metadata.name == msg.name && cli.user.HasRoleName("admins")) {
                        found = item;
                        var metrics: any = null;
                        try {
                            metrics = await KubeUtil.instance().GetPodMetrics(namespace, item.metadata.name);
                            (item as any).metrics = metrics;
                        } catch (error) {
                        }
                        msg.results.push(item);
                    } else if (item.metadata.labels.app === name) {
                        found = item;
                        if (item.status.phase != "Failed") {
                            msg.result = item;
                            cli._logger.debug("[" + cli.user.username + "] GetNoderedInstance:" + name + " found one");
                        }
                        var metrics: any = null;
                        try {
                            metrics = await KubeUtil.instance().GetPodMetrics(namespace, item.metadata.name);
                            (item as any).metrics = metrics;
                        } catch (error) {
                        }
                        msg.results.push(item);
                    }
                }
                if (msg.result == null) msg.result = found;
            } else {
                cli._logger.warn("[" + cli.user.username + "] GetNoderedInstance: found NO Namespaced Pods ???");
            }
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }
    private async GetNoderedInstanceLog(cli: WebSocketServerClient): Promise<void> {
        this.Reply();
        let msg: GetNoderedInstanceLogMessage;
        try {
            cli._logger.debug("[" + cli.user.username + "] GetNoderedInstanceLog");
            msg = GetNoderedInstanceLogMessage.assign(this.data);
            const name = await this.GetInstanceName(msg._id, cli.user._id, cli.user.username, cli.jwt);
            const namespace = Config.namespace;

            const list = await KubeUtil.instance().CoreV1Api.listNamespacedPod(namespace);

            let image: string = "unknown";
            if (list.body.items.length > 0) {
                for (let i = 0; i < list.body.items.length; i++) {
                    const item = list.body.items[i];
                    try {
                        image = item.spec.containers[0].image;
                    } catch (error) {

                    }
                    if (!NoderedUtil.IsNullEmpty(msg.name) && item.metadata.name == msg.name && cli.user.HasRoleName("admins")) {
                        cli._logger.debug("[" + cli.user.username + "] GetNoderedInstanceLog:" + name + " found one as " + item.metadata.name);
                        const obj = await await KubeUtil.instance().CoreV1Api.readNamespacedPodLog(item.metadata.name, namespace, "", false);
                        msg.result = obj.body;
                        Audit.NoderedAction(TokenUser.From(cli.user), true, name, "readpodlog", image, item.metadata.name);
                    } else if (item.metadata.labels.app === name) {
                        cli._logger.debug("[" + cli.user.username + "] GetNoderedInstanceLog:" + name + " found one as " + item.metadata.name);
                        const obj = await await KubeUtil.instance().CoreV1Api.readNamespacedPodLog(item.metadata.name, namespace, "", false);
                        msg.result = obj.body;
                        Audit.NoderedAction(TokenUser.From(cli.user), true, name, "readpodlog", image, item.metadata.name);
                    }
                }
            }
            if (NoderedUtil.IsNullUndefinded(msg.result)) {
                Audit.NoderedAction(TokenUser.From(cli.user), false, name, "readpodlog", image, null);
            }
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error
            if (error.response && error.response.body && !NoderedUtil.IsNullEmpty(error.response.body.message)) {
                msg.error = error.response.body.message;
                if (msg !== null && msg !== undefined) msg.error = error.response.body.message
            }
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }
    private async StartNoderedInstance(cli: WebSocketServerClient): Promise<void> {
        this.Reply();
        Audit.NoderedAction(TokenUser.From(cli.user), true, null, "startdeployment", null, null);
        this.Send(cli);
    }
    private async StopNoderedInstance(cli: WebSocketServerClient): Promise<void> {
        this.Reply();
        Audit.NoderedAction(TokenUser.From(cli.user), true, null, "stopdeployment", null, null);
        this.Send(cli);
    }
    private async _SaveFile(stream: Stream, filename: string, contentType: string, metadata: Base): Promise<string> {
        return new Promise<string>(async (resolve, reject) => {
            try {
                const bucket = new GridFSBucket(Config.db.db);
                let uploadStream = bucket.openUploadStream(filename, { contentType: contentType, metadata: metadata });
                let id = uploadStream.id;
                stream.pipe(uploadStream);
                uploadStream.on('error', function (error) {
                    reject(error);
                }).
                    on('finish', function () {
                        resolve(id.toString());
                    });
            } catch (err) {
                reject(err);
            }
        });
    }
    private async SaveFile(cli: WebSocketServerClient): Promise<void> {
        this.Reply();
        let msg: SaveFileMessage
        try {
            msg = SaveFileMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            if (NoderedUtil.IsNullEmpty(msg.filename)) throw new Error("Filename is mandatory");
            if (NoderedUtil.IsNullEmpty(msg.file)) throw new Error("file is mandatory");
            if (process.platform === "win32") {
                msg.filename = msg.filename.replace(/\//g, "\\");
            }
            else {
                msg.filename = msg.filename.replace(/\\/g, "/");
            }

            if (NoderedUtil.IsNullEmpty(msg.mimeType)) {
                msg.mimeType = lookup(msg.filename);
            }

            if (msg.metadata === null || msg.metadata === undefined) { msg.metadata = new Base(); }
            msg.metadata.name = path.basename(msg.filename);
            (msg.metadata as any).filename = msg.filename;
            (msg.metadata as any).path = path.dirname(msg.filename);
            if ((msg.metadata as any).path == ".") (msg.metadata as any).path = "";

            const buf = Buffer.from(msg.file, 'base64');
            const readable = new Readable();
            readable._read = () => { }; // _read is required but you can noop it
            readable.push(buf);
            readable.push(null);
            msg.file = null;
            if (msg.metadata == null) { msg.metadata = new Base(); }
            msg.metadata = Base.assign(msg.metadata);
            if (NoderedUtil.IsNullUndefinded(msg.metadata._acl)) {
                msg.metadata._acl = [];
                Base.addRight(msg.metadata, WellknownIds.filestore_users, "filestore users", [Rights.read]);
            }
            const user: TokenUser = Crypt.verityToken(msg.jwt);
            msg.metadata._createdby = user.name;
            msg.metadata._createdbyid = user._id;
            msg.metadata._created = new Date(new Date().toISOString());
            msg.metadata._modifiedby = user.name;
            msg.metadata._modifiedbyid = user._id;
            msg.metadata._modified = msg.metadata._created;
            if (NoderedUtil.IsNullEmpty(msg.metadata.name)) {
                msg.metadata.name = msg.filename;
            }
            let hasUser: any = msg.metadata._acl.find(e => e._id === user._id);
            if ((hasUser === null || hasUser === undefined)) {
                Base.addRight(msg.metadata, user._id, user.name, [Rights.full_control]);
            }
            hasUser = msg.metadata._acl.find(e => e._id === WellknownIds.filestore_admins);
            if ((hasUser === null || hasUser === undefined)) {
                Base.addRight(msg.metadata, WellknownIds.filestore_admins, "filestore admins", [Rights.full_control]);
            }
            msg.metadata = Config.db.ensureResource(msg.metadata);
            if (!Config.db.hasAuthorization(user, msg.metadata, Rights.create)) { throw new Error("Access denied, no authorization to save file"); }
            msg.id = await this._SaveFile(readable, msg.filename, msg.mimeType, msg.metadata);
        } catch (error) {
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
            cli._logger.error(error);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }
    private async _GetFile(id: string): Promise<string> {
        return new Promise<string>(async (resolve, reject) => {
            try {
                const bucket = new GridFSBucket(Config.db.db);
                let downloadStream = bucket.openDownloadStream(safeObjectID(id));
                const bufs = [];
                downloadStream.on('data', (chunk) => {
                    bufs.push(chunk);
                });
                downloadStream.on('error', (error) => {
                    reject(error);
                });
                downloadStream.on('end', () => {
                    const buffer = Buffer.concat(bufs);
                    const result = buffer.toString('base64');
                    resolve(result);
                });
            } catch (err) {
                reject(err);
            }
        });
    }
    private async GetFile(cli: WebSocketServerClient): Promise<void> {
        this.Reply();
        let msg: GetFileMessage
        try {
            msg = SaveFileMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            if (!NoderedUtil.IsNullEmpty(msg.id)) {
                const rows = await Config.db.query({ _id: safeObjectID(msg.id) }, null, 1, 0, null, "files", msg.jwt);
                if (rows.length == 0) { throw new Error("Not found"); }
                msg.metadata = (rows[0] as any).metadata
                msg.mimeType = (rows[0] as any).contentType;
            } else if (!NoderedUtil.IsNullEmpty(msg.filename)) {
                const rows = await Config.db.query({ "filename": msg.filename }, null, 1, 0, { uploadDate: -1 }, "fs.files", msg.jwt);
                if (rows.length == 0) { throw new Error("Not found"); }
                msg.id = rows[0]._id;
                msg.metadata = (rows[0] as any).metadata
                msg.mimeType = (rows[0] as any).contentType;
            } else {
                throw new Error("id or filename is mandatory");
            }
            msg.file = await this._GetFile(msg.id);
        } catch (error) {
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
            cli._logger.error(error);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }
    private async filescount(files: Cursor<any>): Promise<number> {
        return new Promise<number>(async (resolve, reject) => {
            files.count((error, result) => {
                if (error) return reject(error);
                resolve(result);
            });
        });
    }
    private async filesnext(files: Cursor<any>): Promise<any> {
        return new Promise<number>(async (resolve, reject) => {
            files.next((error, result) => {
                if (error) return reject(error);
                resolve(result);
            });
        });
    }
    private async UpdateFile(cli: WebSocketServerClient): Promise<void> {
        this.Reply();
        let msg: UpdateFileMessage
        try {
            msg = UpdateFileMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }

            const bucket = new GridFSBucket(Config.db.db);
            const q = { $or: [{ _id: msg.id }, { _id: safeObjectID(msg.id) }] };
            const files = bucket.find(q);
            const count = await this.filescount(files);
            if (count == 0) { throw new Error("Not found"); }
            const file = await this.filesnext(files);
            msg.metadata._createdby = file.metadata._createdby;
            msg.metadata._createdbyid = file.metadata._createdbyid;
            msg.metadata._created = file.metadata._created;
            msg.metadata.name = file.metadata.name;
            (msg.metadata as any).filename = file.metadata.filename;
            (msg.metadata as any).path = file.metadata.path;

            const user: TokenUser = Crypt.verityToken(msg.jwt);
            msg.metadata._modifiedby = user.name;
            msg.metadata._modifiedbyid = user._id;
            msg.metadata._modified = new Date(new Date().toISOString());;

            msg.metadata = Base.assign(msg.metadata);

            const hasUser: any = msg.metadata._acl.find(e => e._id === user._id);
            if ((hasUser === null || hasUser === undefined)) {
                Base.addRight(msg.metadata, user._id, user.name, [Rights.full_control]);
            }
            Base.addRight(msg.metadata, WellknownIds.filestore_admins, "filestore admins", [Rights.full_control]);
            if (!Config.db.hasAuthorization(user, msg.metadata, Rights.update)) { throw new Error("Access denied, no authorization to update file"); }

            msg.metadata = Config.db.ensureResource(msg.metadata);
            const fsc = Config.db.db.collection("fs.files");
            DatabaseConnection.traversejsonencode(msg.metadata);
            const res = await fsc.updateOne(q, { $set: { metadata: msg.metadata } });

        } catch (error) {
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
            cli._logger.error(error);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }

    async CreateWorkflowInstance(cli: WebSocketServerClient) {
        this.Reply();
        let msg: CreateWorkflowInstanceMessage
        try {
            msg = CreateWorkflowInstanceMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.workflowid) && NoderedUtil.IsNullEmpty(msg.queue)) throw new Error("workflowid or queue is mandatory");
            if (NoderedUtil.IsNullEmpty(msg.resultqueue)) throw new Error("replyqueuename is mandatory");
            if (NoderedUtil.IsNullEmpty(msg.targetid)) throw new Error("targetid is mandatory");
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            const tuser = Crypt.verityToken(msg.jwt);
            msg.jwt = Crypt.createToken(tuser, Config.longtoken_expires_in);
            let workflow: any = null;
            if (NoderedUtil.IsNullEmpty(msg.queue)) {
                const user: any = null;
                const res = await Config.db.query({ "_id": msg.workflowid }, null, 1, 0, null, "workflow", msg.jwt);
                if (res.length != 1) throw new Error("Unknown workflow id " + msg.workflowid);
                workflow = res[0];
                msg.queue = workflow.queue;
                if (NoderedUtil.IsNullEmpty(msg.name)) { msg.name = workflow.name; }
            }
            if (NoderedUtil.IsNullEmpty(msg.name)) throw new Error("name is mandatory when workflowid not set")

            if (msg.queue === msg.resultqueue) {
                throw new Error("Cannot reply to self queuename:" + msg.queue + " correlationId:" + msg.resultqueue);
            }

            const res = await Config.db.query({ "_id": msg.targetid }, null, 1, 0, null, "users", msg.jwt);
            if (res.length != 1) throw new Error("Unknown target id " + msg.targetid);
            workflow = res[0];
            msg.state = "new";
            msg.form = "unknown";
            (msg as any).workflow = msg.workflowid;

            if (NoderedUtil.IsNullEmpty(msg.correlationId)) {
                msg.correlationId = Math.random().toString(36).substr(2, 9);
            }

            const _data = Base.assign<Base>(msg as any);
            Base.addRight(_data, msg.targetid, "targetid", [-1]);
            Base.addRight(_data, cli.user._id, cli.user.name, [-1]);
            Base.addRight(_data, tuser._id, tuser.name, [-1]);
            _data._type = "instance";
            _data.name = msg.name;

            const res2 = await Config.db.InsertOne(_data, "workflow_instances", 1, true, msg.jwt);
            msg.newinstanceid = res2._id;

            if (msg.initialrun) {
                const message = { _id: res2._id, __jwt: msg.jwt, __user: tuser };
                amqpwrapper.Instance().sendWithReplyTo("", msg.queue, msg.resultqueue, message, Config.amqp_default_expiration, msg.correlationId);
            }
        } catch (error) {
            cli._logger.error(error);
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
            cli._logger.error(error);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }

    async async_request(options: any) {
        return new Promise<any>(async (resolve, reject) => {
            try {
                request(options, (error, response, body) => {
                    if (error) return reject(error);
                    if (response.statusCode != 200) {
                        if (body != null) return reject(body);
                        return reject(response.statusText);
                    }
                    resolve(body);
                });
            } catch (error) {
                reject(error);
            }
        });
    }
    isObject(obj) {
        const type = typeof obj;
        return (type === 'function' || type === 'object') && !!obj;
    }
    flattenAndStringify(data) {
        const result = {};

        const step = (obj, prevKey) => {
            Object.keys(obj).forEach((key) => {
                const value = obj[key];

                const newKey = prevKey ? `${prevKey}[${key}]` : key;

                if (this.isObject(value)) {
                    if (!Buffer.isBuffer(value) && !value.hasOwnProperty('data')) {
                        // Non-buffer non-file Objects are recursively flattened
                        return step(value, newKey);
                    } else {
                        // Buffers and file objects are stored without modification
                        result[newKey] = value;
                    }
                } else {
                    // Primitives are converted to strings
                    result[newKey] = String(value);
                }
            });
        };
        step(data, undefined);
        return result;
    }
    async StripeCancelPlan(cli: WebSocketServerClient) {
        this.Reply();
        let msg: StripeCancelPlanMessage;
        const rootjwt = Crypt.rootToken();
        try {
            msg = StripeAddPlanMessage.assign(this.data);
            if (NoderedUtil.IsNullUndefinded(msg.jwt)) msg.jwt = cli.jwt;
            if (NoderedUtil.IsNullUndefinded(msg.userid)) msg.userid = cli.user._id;

            const billings = await Config.db.query<Billing>({ userid: msg.userid, _type: "billing" }, null, 1, 0, null, "users", rootjwt);
            if (billings.length == 0) throw new Error("Need billing info and a stripe customer in order to cancel plan");
            const billing: Billing = billings[0];
            if (NoderedUtil.IsNullEmpty(billing.stripeid)) throw new Error("Need a stripe customer in order to cancel plan");
            const customer: stripe_customer = await this.Stripe<stripe_customer>("GET", "customers", billing.stripeid, null, null);
            if (customer == null) throw new Error("Failed locating stripe customer at stribe");


            let subscription: stripe_subscription = null;
            let subscriptionitem: stripe_base = null; // stripe_subscription_item
            let hasit = customer.subscriptions.data.filter(s => {
                const arr = s.items.data.filter(y => y.plan.id == msg.planid);
                if (arr.length > 0) {
                    subscription = s;
                    subscriptionitem = arr[0];
                }
                return arr.length > 0;
            });


            hasit = customer.subscriptions.data.filter(s => {
                const arr = s.items.data.filter(y => y.plan.id == msg.planid);
                return arr.length > 0;
            });
            if (hasit.length == 0) throw new Error("Customer does not have this plan");
            const payload: any = { quantity: 0 };
            const res = await this.Stripe("POST", "subscription_items", subscriptionitem.id, payload, customer.id);
            msg.customer = customer;
        } catch (error) {
            if (error == null) new Error("Unknown error");
            cli._logger.error(error);
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) {
                msg.error = (error.message ? error.message : error);
                if (error.response && error.response.body) {
                    msg.error = error.response.body;
                }
            }
            cli._logger.error(error);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }
    async StripeAddPlan(cli: WebSocketServerClient) {
        this.Reply();
        let msg: StripeAddPlanMessage;
        const rootjwt = Crypt.rootToken();
        try {
            msg = StripeAddPlanMessage.assign(this.data);
            if (NoderedUtil.IsNullUndefinded(msg.jwt)) msg.jwt = cli.jwt;
            if (NoderedUtil.IsNullUndefinded(msg.userid)) msg.userid = cli.user._id;

            const billings = await Config.db.query<Billing>({ userid: msg.userid, _type: "billing" }, null, 1, 0, null, "users", rootjwt);
            if (billings.length == 0) throw new Error("Need billing info and a stripe customer in order to add plan");
            const billing: Billing = billings[0];
            if (NoderedUtil.IsNullEmpty(billing.stripeid)) throw new Error("Need a stripe customer in order to add plan");
            const customer: stripe_customer = await this.Stripe<stripe_customer>("GET", "customers", billing.stripeid, null, null);
            if (customer == null) throw new Error("Failed locating stripe customer at stribe");

            let subscription: stripe_subscription = null;
            let subscription_item: stripe_subscription_item = null;

            const hasPlan = customer.subscriptions.data.filter(s => {
                const arr = s.items.data.filter(y => y.plan.id == msg.planid);
                if (arr.length == 1) {
                    subscription = s;
                    subscription_item = arr[0];
                    if (arr[0].quantity > 0) {
                        return true;
                    }
                } else if (subscription == null) { subscription = s; }
                return false;
            });

            if (subscription != null && subscription.default_tax_rates.length == 0 && !NoderedUtil.IsNullEmpty(billing.taxrate)) {
                const payload: any = { default_tax_rates: [billing.taxrate] };
                await this.Stripe("POST", "subscriptions", subscription.id, payload, customer.id);
            } else if (subscription != null && subscription.default_tax_rates.length != 0 && NoderedUtil.IsNullEmpty(billing.taxrate)) {
                const payload: any = { default_tax_rates: [] };
                await this.Stripe("POST", "subscriptions", subscription.id, payload, customer.id);
            }

            if (hasPlan.length > 0) throw new Error("Customer already has this plan");

            const plan = await this.Stripe<stripe_plan>("GET", "plans", msg.planid, null, null);


            if (subscription == null) {
                const baseurl = Config.baseurl() + "/#/Payment";
                const payload: any = {
                    success_url: baseurl + "/success", cancel_url: baseurl + "/cancel",
                    payment_method_types: ["card"], customer: customer.id, mode: "subscription",
                    subscription_data: {
                        items: [],
                    }
                };

                if (!NoderedUtil.IsNullEmpty(billing.taxrate)) {
                    payload.subscription_data.default_tax_rates = [billing.taxrate]
                    //payload.subscription_data.items.push({ plan: msg.planid });
                } else {
                    //payload.subscription_data.items.push({ plan: msg.planid, tax_rates: [billing.taxrate] });
                }
                payload.subscription_data.items.push({ plan: msg.planid });
                msg.checkout = await this.Stripe("POST", "checkout.sessions", null, payload, null);
            } else {
                if (subscription_item != null) {
                    const payload: any = { quantity: 1 };
                    if (plan.usage_type != "metered") {
                        const res = await this.Stripe("POST", "subscription_items", subscription_item.id, payload, customer.id);
                    }
                } else {
                    const payload: any = { subscription: subscription.id, plan: msg.planid };
                    if (plan.usage_type != "metered") {
                        payload.quantity = 1;
                    }
                    const res = await this.Stripe("POST", "subscription_items", null, payload, customer.id);
                }

            }
            msg.customer = customer;
        } catch (error) {
            if (error == null) new Error("Unknown error");
            cli._logger.error(error);
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) {
                msg.error = (error.message ? error.message : error);
                if (error.response && error.response.body) {
                    msg.error = error.response.body;
                }
            }
            cli._logger.error(error);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }
    async EnsureStripeCustomer(cli: WebSocketServerClient) {
        this.Reply();
        let msg: EnsureStripeCustomerMessage;
        const rootjwt = Crypt.rootToken();
        try {
            msg = EnsureStripeCustomerMessage.assign(this.data);
            if (NoderedUtil.IsNullUndefinded(msg.jwt)) msg.jwt = cli.jwt;
            if (NoderedUtil.IsNullUndefinded(msg.userid)) msg.userid = cli.user._id;
            const users = await Config.db.query({ _id: msg.userid, _type: "user" }, null, 1, 0, null, "users", msg.jwt);
            if (users.length == 0) throw new Error("Unknown userid");
            const user: User = users[0] as any;
            let dirty: boolean = false;
            let hasbilling: boolean = false;

            const billings = await Config.db.query<Billing>({ userid: msg.userid, _type: "billing" }, null, 1, 0, null, "users", rootjwt);
            let billing: Billing;
            if (billings.length == 0) {
                const tax_rates = await this.Stripe<stripe_list<stripe_base>>("GET", "tax_rates", null, null, null);
                if (tax_rates == null || tax_rates.data.length == 0) throw new Error("Failed getting tax_rates from stripe");

                billing = Billing.assign(msg.billing);
                billing.taxrate = tax_rates.data[0].id;
                billing.tax = 1 + ((tax_rates.data[0] as any).percentage / 100);
                if (NoderedUtil.IsNullEmpty(billing.name)) throw new Error("Name is mandatory");
                if (NoderedUtil.IsNullEmpty(billing.email)) throw new Error("Email is mandatory");
                Base.addRight(billing, user._id, user.name, [Rights.read]);
                Base.addRight(billing, WellknownIds.admins, "admins", [Rights.full_control]);
                billing = await Config.db.InsertOne(billing, "users", 3, true, rootjwt);
            } else {
                billing = billings[0];
                if (billing.email != msg.billing.email || billing.vatnumber != msg.billing.vatnumber || billing.vattype != msg.billing.vattype || billing.coupon != msg.billing.coupon) {
                    billing.email = msg.billing.email;
                    billing.vatnumber = msg.billing.vatnumber;
                    billing.vattype = msg.billing.vattype;
                    billing.coupon = msg.billing.coupon;
                    billing = await Config.db._UpdateOne(null, billing, "users", 3, true, rootjwt);
                }
            }
            let customer: stripe_customer;
            if (!NoderedUtil.IsNullEmpty(billing.stripeid)) {
                customer = await this.Stripe<stripe_customer>("GET", "customers", billing.stripeid, null, null);
            }
            const payload: any = { name: billing.name, email: billing.email, metadata: { userid: msg.userid }, description: user.name };
            if (customer == null) {
                customer = await this.Stripe<stripe_customer>("POST", "customers", null, payload, null);
                billing.stripeid = customer.id;
                billing = await Config.db._UpdateOne(null, billing, "users", 3, true, rootjwt);
            }
            if (customer != null && !NoderedUtil.IsNullEmpty(billing.vattype) && !NoderedUtil.IsNullEmpty(billing.vatnumber)) {
                if (customer.tax_ids.total_count == 0) {
                    (payload as any) = { value: billing.vatnumber, type: billing.vattype };
                    await this.Stripe<stripe_customer>("POST", "tax_ids", null, payload, customer.id);
                    dirty = true;
                }
            }

            if ((billing.tax != 1 || billing.taxrate != "") && customer.tax_ids.total_count > 0) {
                if (customer.tax_ids.data[0].verification.status == 'verified' || customer.tax_ids.data[0].verification.status == 'unavailable') {
                    if (customer.tax_ids.data[0].verification.status == 'verified') {
                        if (billing.name != customer.tax_ids.data[0].verification.verified_name ||
                            billing.address != customer.tax_ids.data[0].verification.verified_address) {
                            billing.name = customer.tax_ids.data[0].verification.verified_name;
                            billing.address = customer.tax_ids.data[0].verification.verified_address;
                            dirty = true;
                        }
                    }
                    if ((billing.tax != 1 || billing.taxrate != "") && customer.tax_ids.data[0].country != "DK") {
                        billing.tax = 1;
                        billing.taxrate = "";
                        dirty = true;
                    }
                    if (dirty == true) {
                        billing = await Config.db._UpdateOne(null, billing, "users", 3, true, rootjwt);
                    }
                }
            } else if (billing.tax == 1 && customer.tax_ids.total_count == 0) {
                const tax_rates = await this.Stripe<stripe_list<stripe_base>>("GET", "tax_rates", null, null, null);
                if (tax_rates == null || tax_rates.total_count == 0) throw new Error("Failed getting tax_rates from stripe");
                billing.taxrate = tax_rates.data[0].id;
                billing.tax = 1 + ((tax_rates.data[0] as any).percentage / 100);
                billing = await Config.db._UpdateOne(null, billing, "users", 3, true, rootjwt);
            } else if (customer.tax_ids.total_count > 0 && (customer.tax_ids.data[0].verification.status != 'verified' &&
                customer.tax_ids.data[0].verification.status != 'unavailable') && billing.tax == 1) {
                const tax_rates = await this.Stripe<stripe_list<stripe_base>>("GET", "tax_rates", null, null, null);
                if (tax_rates == null || tax_rates.total_count == 0) throw new Error("Failed getting tax_rates from stripe");
                billing.taxrate = tax_rates.data[0].id;
                billing.tax = 1 + ((tax_rates.data[0] as any).percentage / 100);
                billing = await Config.db._UpdateOne(null, billing, "users", 3, true, rootjwt);
            }
            if (dirty) {
                if (!NoderedUtil.IsNullEmpty(billing.stripeid)) {
                    customer = await this.Stripe<stripe_customer>("GET", "customers", null, null, billing.stripeid);
                }
            }
            if (customer != null && NoderedUtil.IsNullEmpty(billing.coupon) && customer.discount != null) {
                const payload: any = { coupon: "" };
                customer = await this.Stripe<stripe_customer>("POST", "customers", billing.stripeid, payload, null);
            }
            let newmemory: string = "";
            if (customer != null && billing != null && customer.subscriptions != null && customer.subscriptions.total_count > 0) {
                if (customer.subscriptions != null && customer.subscriptions.data != null)
                    for (let i = 0; i < customer.subscriptions.data.length; i++) {
                        const sub = customer.subscriptions.data[i];
                        for (let y = 0; y < sub.items.data.length; y++) {
                            const subitem = sub.items.data[y];
                            if (subitem.plan != null && subitem.plan.metadata != null && subitem.plan.metadata.memory != null) {
                                newmemory = subitem.plan.metadata.memory;
                            }

                        }
                    }
            }
            if (billing.memory != newmemory) {
                billing.memory = newmemory;
                billing = await Config.db._UpdateOne(null, billing, "users", 3, true, rootjwt);
                this._EnsureNoderedInstance(cli, msg.userid, true);
            }
            if (customer != null && !NoderedUtil.IsNullEmpty(billing.coupon) && customer.discount != null) {
                if (billing.coupon != customer.discount.coupon.name) {
                    const payload: any = { coupon: "" };
                    customer = await this.Stripe<stripe_customer>("POST", "customers", billing.stripeid, payload, null);

                    const coupons: stripe_list<stripe_coupon> = await this.Stripe<stripe_list<stripe_coupon>>("GET", "coupons", null, null, null);
                    const isvalid = coupons.data.filter(c => c.name == billing.coupon);
                    if (isvalid.length == 0) throw new Error("Unknown coupons '" + billing.coupon + "'");

                    const payload2: any = { coupon: coupons.data[0].id };
                    customer = await this.Stripe<stripe_customer>("POST", "customers", billing.stripeid, payload2, null);

                }
            }
            if (customer != null && !NoderedUtil.IsNullEmpty(billing.coupon) && customer.discount == null) {
                const coupons: stripe_list<stripe_coupon> = await this.Stripe<stripe_list<stripe_coupon>>("GET", "coupons", null, null, null);
                const isvalid = coupons.data.filter(c => c.name == billing.coupon);
                if (isvalid.length == 0) throw new Error("Unknown coupons '" + billing.coupon + "'");

                const payload: any = { coupon: coupons.data[0].id };
                customer = await this.Stripe<stripe_customer>("POST", "customers", billing.stripeid, payload, null);
            }
            if (customer != null) {
                const sources = await this.Stripe<stripe_list<stripe_base>>("GET", "sources", null, null, billing.stripeid);
                if ((sources.data.length > 0) != billing.hascard) {
                    billing.hascard = (sources.data.length > 0);
                    billing = await Config.db._UpdateOne(null, billing, "users", 3, true, rootjwt);
                }
            }
            if (customer != null && billing != null) {
                let openflowuserplan: string = "";
                let supportplan: string = "";
                let supporthourplan: string = "";
                if (customer.subscriptions != null && customer.subscriptions.data != null)
                    customer.subscriptions.data.filter(s => {
                        s.items.data.filter(y => {
                            if (y.plan.metadata.supporthourplan == "true") {
                                supporthourplan = y.id;
                            }
                            if (y.plan.metadata.supportplan == "true") {
                                supportplan = y.id;
                            }
                            if (y.plan.metadata.openflowuser == "true") {
                                openflowuserplan = y.id;
                            }
                        });
                        return false;
                    });
                if (billing.openflowuserplan != openflowuserplan || billing.supportplan != supportplan || billing.supporthourplan != supporthourplan) {
                    billing.openflowuserplan = openflowuserplan;
                    billing.supportplan = supportplan;
                    billing.supporthourplan = supporthourplan;
                    billing = await Config.db._UpdateOne(null, billing, "users", 3, true, rootjwt);
                }
            }

            hasbilling = (customer != null);
            if (user._hasbilling != hasbilling) {
                user._hasbilling = hasbilling;
                await Config.db._UpdateOne(null, user, "users", 3, true, rootjwt);
            }
            msg.customer = customer;

        } catch (error) {
            if (error == null) new Error("Unknown error");
            cli._logger.error(error);
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) {
                msg.error = (error.message ? error.message : error);
                if (error.response && error.response.body) {
                    msg.error = error.response.body;
                }
            }
            cli._logger.error(error);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }
    async Stripe<T>(method: string, object: string, id: string, payload: any, customerid: string): Promise<T> {
        let url = "https://api.stripe.com/v1/" + object;
        if (!NoderedUtil.IsNullEmpty(id)) url = url + "/" + id;
        if (object == "tax_ids") {
            if (NoderedUtil.IsNullEmpty(customerid)) throw new Error("Need customer to work with tax_id");
            url = "https://api.stripe.com/v1/customers/" + customerid + "/tax_ids";
            if (method == "DELETE" || method == "PUT") {
                if (NoderedUtil.IsNullEmpty(id)) throw new Error("Need id");
            }
            if (!NoderedUtil.IsNullEmpty(id)) {
                url = "https://api.stripe.com/v1/customers/" + customerid + "/tax_ids/" + id;
            }
        }
        if (object == "checkout.sessions") {
            url = "https://api.stripe.com/v1/checkout/sessions";
            if (!NoderedUtil.IsNullEmpty(id)) {
                url = "https://api.stripe.com/v1/checkout/sessions/" + id;
            }
        }
        if (object == "usage_records") {
            url = "https://api.stripe.com/v1/subscription_items/" + id + "/usage_records";
        }
        if (object == "sources") {
            if (NoderedUtil.IsNullEmpty(customerid)) throw new Error("Need customer to work with sources");
            url = "https://api.stripe.com/v1/customers/" + customerid + "/sources";
            if (!NoderedUtil.IsNullEmpty(id)) {
                url = "https://api.stripe.com/v1/customers/" + customerid + "/sources/" + id;
            }

        }
        if (object == "invoices_upcoming") {
            if (NoderedUtil.IsNullEmpty(customerid)) throw new Error("Need customer to work with invoices_upcoming");
            url = "https://api.stripe.com/v1/invoices/upcoming?customer=" + customerid;
        }

        const auth = "Basic " + Buffer.from(Config.stripe_api_secret + ":").toString("base64");

        const options = {
            headers: {
                'Content-type': 'application/x-www-form-urlencoded',
                'Authorization': auth
            }
        };
        if (payload != null && method != "GET" && method != "DELETE") {
            const flattenedData = this.flattenAndStringify(payload);
            (options as any).form = flattenedData;
        }
        if (method == "POST") {
            const response = await got.post(url, options);
            payload = JSON.parse(response.body);
        }
        if (method == "GET") {
            const response = await got.get(url, options);
            payload = JSON.parse(response.body);
        }
        if (method == "PUT") {
            const response = await got.put(url, options);
            payload = JSON.parse(response.body);
        }
        if (method == "DELETE") {
            const response = await got.delete(url, options);
            payload = JSON.parse(response.body);
        }
        if (payload != null) {
            if (payload.deleted) {
                payload = null;
            }
        }
        return payload;
    }
    async StripeMessage(cli: WebSocketServerClient) {
        this.Reply();
        let msg: StripeMessage;
        try {
            msg = StripeMessage.assign(this.data);
            if (NoderedUtil.IsNullUndefinded(msg.jwt)) msg.jwt = cli.jwt;
            if (NoderedUtil.IsNullEmpty(msg.object)) throw new Error("object is mandatory");
            if (!cli.user.HasRoleName("admins")) {
                if (!NoderedUtil.IsNullEmpty(msg.url)) throw new Error("Custom url not allowed");
                if (msg.object != "plans" && msg.object != "subscription_items" && msg.object != "invoices_upcoming") throw new Error("Access to " + msg.object + " is not allowed");

                if (msg.object == "subscription_items" && msg.method != "POST") throw new Error("Access to " + msg.object + " is not allowed");
                if (msg.object == "plans" && msg.method != "GET") throw new Error("Access to " + msg.object + " is not allowed");
                if (msg.object == "invoices_upcoming" && msg.method != "GET") throw new Error("Access to " + msg.object + " is not allowed");
            }
            msg.payload = await this.Stripe(msg.method, msg.object, msg.id, msg.payload, msg.customerid);
        } catch (error) {
            if (error == null) new Error("Unknown error");
            cli._logger.error(error);
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) {
                msg.error = (error.message ? error.message : error);
                if (error.response && error.response.body) {
                    msg.error = error.response.body;
                }
            }
            cli._logger.error(error);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }
    async DumpClients(cli: WebSocketServerClient) {
        this.Reply();
        try {
            const jwt = Crypt.rootToken();
            const known = await Config.db.query({ _type: "socketclient" }, null, 5000, 0, null, "configclients", jwt);
            for (let i = 0; i < WebSocketServer._clients.length; i++) {
                let client = WebSocketServer._clients[i];
                let id = client.id;
                let exists = known.filter((x: any) => x.id == id);
                let item: any = {
                    id: client.id, user: client.user, clientagent: client.clientagent, clientversion: client.clientversion
                    , lastheartbeat: client.lastheartbeat, _type: "socketclient", name: client.id, remoteip: client.remoteip,
                    queues: client._queues
                };
                if (client.user != null) {
                    let name = client.user.username.split("@").join("").split(".").join("");
                    name = name.toLowerCase();
                    item.name = name + "/" + client.clientagent + "/" + client.id;
                }
                if (exists.length == 0) {
                    await Config.db.InsertOne(item, "configclients", 1, false, jwt);
                } else {
                    item._id = exists[0]._id;
                    await Config.db._UpdateOne(null, item, "configclients", 1, false, jwt);
                }
            }
            for (let i = 0; i < known.length; i++) {
                let client: any = known[i];
                let id = client.id;
                let exists = WebSocketServer._clients.filter((x: any) => x.id == id);
                if (exists.length == 0) {
                    await Config.db.DeleteOne(client._id, "configclients", jwt);
                }
            }
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }
    async DumpRabbitmq(cli: WebSocketServerClient) {
        this.Reply();
        try {
            const kickstartapi = amqpwrapper.getvhosts(Config.amqp_url);
            const jwt = Crypt.rootToken();
            const known = await Config.db.query({ _type: "queue" }, null, 5000, 0, null, "configclients", jwt);
            const queues = await amqpwrapper.getqueues(Config.amqp_url);
            for (let i = 0; i < queues.length; i++) {
                let queue = queues[i];
                let exists = known.filter((x: any) => (x && x.queuename == queue.name));
                let item: any = {
                    name: queue.id, consumers: queue.consumers, consumer_details: queue.consumer_details, _type: "queue"
                };
                let consumers: number = 0;
                if (queue.consumers > 0) { consumers = queue.consumers; }
                if (consumers == 0) {
                    if (queue.consumer_details != null && queue.consumer_details.length > 0) {
                        consumers = queue.consumer_details.length;
                    }
                }
                item.queuename = queue.name;
                item.consumers = consumers;
                item.name = queue.name + "(" + consumers + ")";
                if (exists.length == 0) {
                    try {
                        await Config.db.InsertOne(item, "configclients", 1, false, jwt);
                    } catch (error) {
                        cli._logger.error(error);
                    }
                } else {
                    item._id = exists[0]._id;
                    try {
                        await Config.db._UpdateOne(null, item, "configclients", 1, false, jwt);
                    } catch (error) {
                        cli._logger.error(error);
                    }
                }
            }
            for (let i = 0; i < known.length; i++) {
                let queue: any = known[i];
                let id = queue.id;
                let exists = queues.filter((x: any) => x.name == queue.queuename);
                if (exists.length == 0) {
                    try {
                        await Config.db.DeleteOne(queue._id, "configclients", jwt);
                    } catch (error) {
                        cli._logger.error(error);
                    }
                }
            }
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }
    async GetRabbitmqQueue(cli: WebSocketServerClient) {
        this.Reply();
        try {
            let msg: any = JSON.parse(this.data);
            const kickstartapi = amqpwrapper.getvhosts(Config.amqp_url);
            try {
                msg.data = await amqpwrapper.getqueue(Config.amqp_url, '/', msg.name);
                this.data = JSON.stringify(msg);
            } catch (error) {
                cli._logger.error(error);
            }
        } catch (error) {
            this.command = "error";
            this.data = JSON.stringify(error);
            cli._logger.error(error);

        }
        this.Send(cli);
    }
    async DeleterabbitmqQueue(cli: WebSocketServerClient) {
        this.Reply();
        try {
            let msg: any = JSON.parse(this.data);
            const kickstartapi = amqpwrapper.getvhosts(Config.amqp_url);
            try {
                msg.data = await amqpwrapper.deletequeue(Config.amqp_url, '/', msg.name);
                this.data = JSON.stringify(msg);
            } catch (error) {
                cli._logger.error(error);
            }
        } catch (error) {
            this.command = "error";
            this.data = JSON.stringify(error);
            cli._logger.error(error);

        }
        this.Send(cli);
    }

}

export class JSONfn {
    public static stringify(obj) {
        return JSON.stringify(obj, function (key, value) {
            return (typeof value === 'function') ? value.toString() : value;
        });
    }
    public static parse(str) {
        return JSON.parse(str, function (key, value) {
            if (typeof value != 'string') return value;
            return (value.substring(0, 8) == 'function') ? eval('(' + value + ')') : value;
        });
    }
}