import * as crypto from "crypto";
import { lookup } from "mimetype";
import { SocketMessage } from "../SocketMessage";
import { Auth } from "../Auth";
import { Crypt } from "../Crypt";
import { Config } from "../Config";
import { Audit } from "../Audit";
import { LoginProvider } from "../LoginProvider";
import { KubeUtil } from "../KubeUtil";
import { Readable, Stream } from "stream";
import { GridFSBucket, ObjectID, Db, Cursor, MongoNetworkError } from "mongodb";
import * as path from "path";
import { DatabaseConnection } from "../DatabaseConnection";
import { StripeMessage, EnsureStripeCustomerMessage, NoderedUtil, QueuedMessage, RegisterQueueMessage, QueueMessage, CloseQueueMessage, ListCollectionsMessage, DropCollectionMessage, QueryMessage, AggregateMessage, InsertOneMessage, UpdateOneMessage, Base, UpdateManyMessage, InsertOrUpdateOneMessage, DeleteOneMessage, MapReduceMessage, SigninMessage, TokenUser, User, Rights, EnsureNoderedInstanceMessage, DeleteNoderedInstanceMessage, DeleteNoderedPodMessage, RestartNoderedInstanceMessage, GetNoderedInstanceMessage, GetNoderedInstanceLogMessage, SaveFileMessage, WellknownIds, GetFileMessage, UpdateFileMessage, CreateWorkflowInstanceMessage, RegisterUserMessage, NoderedUser } from "openflow-api";
import { Billing, stripe_customer, stripe_base, stripe_list, StripeAddPlanMessage, StripeCancelPlanMessage, stripe_subscription, stripe_subscription_item, stripe_plan, stripe_coupon } from "openflow-api";
import { V1ResourceRequirements, V1Deployment } from "@kubernetes/client-node";
import { amqpwrapper } from "../amqpwrapper";
import { WebSocketServerClient } from "../WebSocketServerClient";
import { DBHelper } from "../DBHelper";
var request = require("request");
var got = require("got");


const safeObjectID = (s: string | number | ObjectID) => ObjectID.isValid(s) ? new ObjectID(s) : null;
export class Message {
    public id: string;
    public replyto: string;
    public command: string;
    public data: string;
    public static fromcommand(command: string): Message {
        var result: Message = new Message();
        result.command = command;
        result.id = crypto.randomBytes(16).toString("hex");
        return result;
    }
    public static frommessage(msg: SocketMessage, data: string): Message {
        var result: Message = new Message();
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
    public Process(cli: WebSocketServerClient): void {
        try {
            if (!NoderedUtil.IsNullEmpty(this.command)) { this.command = this.command.toLowerCase(); }
            var command: string = this.command;
            if (this.command !== "ping" && this.command !== "pong") {

                if (!NoderedUtil.IsNullEmpty(this.replyto)) {
                    var qmsg: QueuedMessage = cli.messageQueue[this.replyto];
                    if (!NoderedUtil.IsNullUndefinded(qmsg)) {
                        try {
                            qmsg.message = Object.assign(qmsg.message, JSON.parse(this.data));
                        } catch (error) {
                            // TODO: should we set message to data ?
                        }
                        if (!NoderedUtil.IsNullUndefinded(qmsg.cb)) { qmsg.cb(this); }
                        delete cli.messageQueue[this.id];
                    }
                    return;
                }
            }

            if (command !== "ping" && command !== "pong") {
                command = command;
            }
            switch (command) {
                case "ping":
                    this.Ping(cli);
                    break;
                case "pong":
                    cli.lastheartbeat = new Date();
                    break;
                case "listcollections":
                    this.ListCollections(cli);
                    break;
                case "dropcollection":
                    this.DropCollection(cli);
                    break;
                case "query":
                    this.Query(cli);
                    break;
                case "aggregate":
                    this.Aggregate(cli);
                    break;
                case "insertone":
                    this.InsertOne(cli);
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
                default:
                    this.UnknownCommand(cli);
                    break;
            }
        } catch (error) {
            cli._logger.error(error);
        }
    }
    async RegisterQueue(cli: WebSocketServerClient) {
        this.Reply();
        var msg: RegisterQueueMessage
        try {
            msg = RegisterQueueMessage.assign(this.data);
            msg.queuename = await cli.CreateConsumer(msg.queuename);
        } catch (error) {
            cli._logger.error(error);
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.toString();
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
    async QueueMessage(cli: WebSocketServerClient) {
        this.Reply();
        var msg: QueueMessage
        try {
            msg = QueueMessage.assign(this.data);
            if (NoderedUtil.IsNullUndefinded(msg.jwt)) msg.jwt = cli.jwt;
            if (!NoderedUtil.IsNullUndefinded(msg.data)) {
                if (typeof msg.data == 'string') {
                    try {
                        var obj = JSON.parse(msg.data);
                        // if (NoderedUtil.IsNullUndefinded(obj.jwt)) {
                        //     obj.jwt = msg.jwt;
                        //     msg.data = JSON.stringify(obj);
                        // }
                    } catch (error) {
                    }
                } else {
                    msg.data.jwt = msg.jwt;
                }
            }
            var expiration: number = Config.amqp_default_expiration;
            if (typeof msg.expiration == 'number') expiration = msg.expiration;
            if (typeof msg.data === 'string' || msg.data instanceof String) {
                try {
                    msg.data = JSON.parse((msg.data as any));
                } catch (error) {
                }
            }
            var sendthis: any = msg.data;
            try {
                if (NoderedUtil.IsNullEmpty(msg.jwt) && !NoderedUtil.IsNullEmpty(msg.data.jwt)) {
                    msg.jwt = msg.data.jwt;
                }
                if (NoderedUtil.IsNullEmpty(msg.jwt)) {
                    msg.jwt = cli.jwt;
                }
                if (!NoderedUtil.IsNullEmpty(msg.jwt)) {
                    var tuser = Crypt.verityToken(msg.jwt);
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
                // var sendthis = { data: msg.data, jwt: cli.jwt, user: cli.user };
                var sendthis = msg.data;
                await amqpwrapper.Instance().send("", msg.queuename, sendthis, expiration, msg.correlationId);
            } else {
                if (msg.queuename === msg.replyto) {
                    throw new Error("Cannot send reply to self queuename:" + msg.queuename + " correlationId:" + msg.correlationId);
                    // cli._logger.warn("Ignore reply to self queuename:" + msg.queuename + " correlationId:" + msg.correlationId);
                    // return
                }
                //var sendthis = { data: msg.data, jwt: cli.jwt, user: cli.user };
                var sendthis = msg.data;
                var result = await amqpwrapper.Instance().sendWithReplyTo("", msg.queuename, msg.replyto, sendthis, expiration, msg.correlationId);
                // var result = await amqpwrapper.Instance().sendWithReply("", msg.queuename, sendthis, expiration, msg.correlationId);

                // this.replyto = msg.correlationId;
                // await cli.sendQueueReply(msg, expiration);
            }
        } catch (error) {
            cli._logger.error(error);
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.toString();
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
    async CloseQueue(cli: WebSocketServerClient) {
        this.Reply();
        var msg: CloseQueueMessage
        try {
            msg = CloseQueueMessage.assign(this.data);
            await cli.CloseConsumer(msg.queuename);
        } catch (error) {
            cli._logger.error(error);
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.toString();
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
    public Send(cli: WebSocketServerClient): void {
        cli.Send(this);
    }
    private UnknownCommand(cli: WebSocketServerClient): void {
        this.Reply("error");
        this.data = "Unknown command " + this.command;
        cli._logger.error(this.data);
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
        var msg: ListCollectionsMessage
        try {
            msg = ListCollectionsMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            var d = new Date(Message.collectionCachetime.getTime() + 1000 * 60);
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
                var result = [];
                // filter out collections that are empty, or we don't have access too
                for (var i = 0; i < msg.result.length; i++) {
                    var q = await Config.db.query({}, null, 1, 0, null, msg.result[i].name, msg.jwt);
                    if (q.length > 0) result.push(msg.result[i]);
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
            if (msg !== null && msg !== undefined) msg.error = error.toString();
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
    private async DropCollection(cli: WebSocketServerClient): Promise<void> {
        this.Reply();
        var msg: DropCollectionMessage
        try {
            msg = DropCollectionMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            await Config.db.DropCollection(msg.collectionname, msg.jwt);
        } catch (error) {
            cli._logger.error(error);
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.toString();
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

    private async Query(cli: WebSocketServerClient): Promise<void> {
        this.Reply();
        var msg: QueryMessage
        try {
            msg = QueryMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            msg.result = await Config.db.query(msg.query, msg.projection, msg.top, msg.skip, msg.orderby, msg.collectionname, msg.jwt, msg.queryas);
        } catch (error) {
            cli._logger.error(error);
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.toString();
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
    private async Aggregate(cli: WebSocketServerClient): Promise<void> {
        this.Reply();
        var msg: AggregateMessage
        try {
            msg = AggregateMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            msg.result = await Config.db.aggregate(msg.aggregates, msg.collectionname, msg.jwt);
        } catch (error) {
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.toString();
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
        var msg: InsertOneMessage
        try {
            msg = InsertOneMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            if (NoderedUtil.IsNullEmpty(msg.w as any)) { msg.w = 0; }
            if (NoderedUtil.IsNullEmpty(msg.j as any)) { msg.j = false; }
            if (NoderedUtil.IsNullEmpty(msg.jwt) && msg.collectionname === "jslog") {
                msg.jwt = Crypt.rootToken();
            }
            if (NoderedUtil.IsNullEmpty(msg.jwt)) {
                throw new Error("jwt is null and client is not authenticated");
            }
            msg.result = await Config.db.InsertOne(msg.item, msg.collectionname, msg.w, msg.j, msg.jwt);
        } catch (error) {
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.toString();
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
        var msg: UpdateOneMessage
        try {
            msg = UpdateOneMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            if (NoderedUtil.IsNullEmpty(msg.w as any)) { msg.w = 0; }
            if (NoderedUtil.IsNullEmpty(msg.j as any)) { msg.j = false; }
            msg = await Config.db.UpdateOne(msg);
        } catch (error) {
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.toString();
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
        var msg: UpdateManyMessage
        try {
            msg = UpdateManyMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            if (NoderedUtil.IsNullEmpty(msg.w as any)) { msg.w = 0; }
            if (NoderedUtil.IsNullEmpty(msg.j as any)) { msg.j = false; }
            msg = await Config.db.UpdateMany(msg);
        } catch (error) {
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.toString();
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
        var msg: InsertOrUpdateOneMessage
        try {
            msg = InsertOrUpdateOneMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            if (NoderedUtil.IsNullEmpty(msg.w as any)) { msg.w = 0; }
            if (NoderedUtil.IsNullEmpty(msg.j as any)) { msg.j = false; }
            msg = await Config.db.InsertOrUpdateOne(msg);
        } catch (error) {
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.toString();
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
        var msg: DeleteOneMessage
        try {
            msg = DeleteOneMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            await Config.db.DeleteOne(msg._id, msg.collectionname, msg.jwt);
        } catch (error) {
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.toString();
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
        var msg: MapReduceMessage
        try {
            msg = MapReduceMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            msg.result = await Config.db.MapReduce(msg.map, msg.reduce, msg.finalize, msg.query, msg.out, msg.collectionname, msg.scope, msg.jwt);
        } catch (error) {
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.toString();
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

    private async Signin(cli: WebSocketServerClient): Promise<void> {
        this.Reply();
        var msg: SigninMessage
        var impostor: string = "";
        try {
            msg = SigninMessage.assign(this.data);
            var tuser: TokenUser = null;
            var user: User = null;
            var type: string = "local";
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
                        var jwt: string = Crypt.rootToken();
                        user = await DBHelper.ensureUser(jwt, tuser.name, tuser.username, null, msg.password);
                        tuser = TokenUser.From(user);
                    } else {
                        if (msg !== null && msg !== undefined) msg.error = "Unknown username or password";
                    }
                }
                if (impostor !== "") {
                    tuser.impostor = msg.impersonate;
                }
                // } else if (tuser.username.startsWith("nodered")) {
                //     user = new User(); user.name = tuser.name; user.username = tuser.username;
                //     await user.Save(Crypt.rootToken());
                //     tuser = TokenUser.From(user);
                // } else {
                //     msg.error = "Unknown username or password";
                // }
            } else if (msg.rawAssertion !== null && msg.rawAssertion !== undefined) {
                type = "samltoken";
                user = await LoginProvider.validateToken(msg.rawAssertion);
                if (user !== null && user != undefined) { tuser = TokenUser.From(user); }
                msg.rawAssertion = "";
            } else {
                user = await Auth.ValidateByPassword(msg.username, msg.password);
                tuser = TokenUser.From(user);
            }
            cli.clientagent = msg.clientagent;
            cli.clientversion = msg.clientversion;
            if (user === null || user === undefined || tuser === null || tuser === undefined) {
                if (msg !== null && msg !== undefined) msg.error = "Unknown username or password";
                Audit.LoginFailed(tuser.username, type, "websocket", cli.remoteip, cli.clientagent, cli.clientversion);
                cli._logger.debug(tuser.username + " failed logging in using " + type);
            } else {
                Audit.LoginSuccess(tuser, type, "websocket", cli.remoteip, cli.clientagent, cli.clientversion);
                var userid: string = user._id;
                if (msg.longtoken) {
                    msg.jwt = Crypt.createToken(tuser, Config.longtoken_expires_in);
                } else {
                    msg.jwt = Crypt.createToken(tuser, Config.shorttoken_expires_in);
                }

                msg.user = tuser;
                if (msg.impersonate !== undefined && msg.impersonate !== null && msg.impersonate !== "" && tuser._id != msg.impersonate) {
                    var items = await Config.db.query({ _id: msg.impersonate }, null, 1, 0, null, "users", msg.jwt);
                    if (items.length == 0) {
                        var impostors = await Config.db.query<User>({ _id: msg.impersonate }, null, 1, 0, null, "users", Crypt.rootToken());
                        var impb: User = new User(); impb.name = "unknown"; impb._id = msg.impersonate;
                        var imp: TokenUser = TokenUser.From(impb);
                        if (impostors.length == 1) {
                            imp = TokenUser.From(impostors[0]);
                        }
                        Audit.ImpersonateFailed(imp, tuser, cli.clientagent, cli.clientversion);
                        throw new Error("Permission denied, " + tuser.name + "/" + tuser._id + " view and impersonating " + msg.impersonate);
                    }
                    var tuserimpostor = tuser;
                    user = User.assign(items[0] as User);
                    await DBHelper.DecorateWithRoles(user);
                    // Check we have update rights
                    try {
                        await DBHelper.Save(user, msg.jwt);
                    } catch (error) {
                        var impostors = await Config.db.query<User>({ _id: msg.impersonate }, null, 1, 0, null, "users", Crypt.rootToken());
                        var impb: User = new User(); impb.name = "unknown"; impb._id = msg.impersonate;
                        var imp: TokenUser = TokenUser.From(impb);
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
                    user.firebasetoken = msg.firebasetoken;
                }
                if (msg.onesignalid != null && msg.onesignalid != undefined && msg.onesignalid != "") {
                    user.onesignalid = msg.onesignalid;
                }
                if ((msg.onesignalid != null && msg.onesignalid != undefined && msg.onesignalid != "") ||
                    (msg.onesignalid != null && msg.onesignalid != undefined && msg.onesignalid != "")) {
                }
                if (msg.gpslocation != null && msg.gpslocation != undefined && msg.gpslocation != "") {
                    user.gpslocation = msg.gpslocation;
                }
                if (msg.device != null && msg.device != undefined && msg.device != "") {
                    user.device = msg.device;
                }
                if (msg.validate_only !== true) {
                    cli._logger.debug(tuser.username + " signed in using " + type);
                    cli.jwt = msg.jwt;
                    cli.user = user;
                } else {
                    cli._logger.debug(tuser.username + " was validated in using " + type);
                }
                if (msg.impersonate === undefined || msg.impersonate === null || msg.impersonate === "") {
                    user.lastseen = new Date(new Date().toISOString());
                }
                user._lastclientagent = cli.clientagent;
                user._lastclientversion = cli.clientversion;
                if (cli.clientagent == "openrpa") {
                    user._lastopenrpaclientversion = cli.clientversion;
                }
                if (cli.clientagent == "nodered") {
                    user._lastnoderedclientversion = cli.clientversion;
                }
                await DBHelper.Save(user, Crypt.rootToken());
            }
        } catch (error) {
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.toString();
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
    private async RegisterUser(cli: WebSocketServerClient): Promise<void> {
        this.Reply();
        var msg: RegisterUserMessage;
        var user: User;
        try {
            msg = RegisterUserMessage.assign(this.data);
            if (msg.name == null || msg.name == undefined || msg.name == "") { throw new Error("Name cannot be null"); }
            if (msg.username == null || msg.username == undefined || msg.username == "") { throw new Error("Username cannot be null"); }
            if (msg.password == null || msg.password == undefined || msg.password == "") { throw new Error("Password cannot be null"); }
            user = await DBHelper.FindByUsername(msg.username);
            if (user !== null && user !== undefined) { throw new Error("Illegal username"); }
            var jwt: string = Crypt.rootToken();
            user = await DBHelper.ensureUser(jwt, msg.name, msg.username, null, msg.password);
            msg.user = TokenUser.From(user);

            jwt = Crypt.createToken(msg.user, Config.shorttoken_expires_in);
            var name = user.username;
            name = name.split("@").join("").split(".").join("");
            name = name.toLowerCase();

            cli._logger.debug("[" + user.username + "] ensure nodered role " + name + "noderedadmins");
            var noderedadmins = await DBHelper.EnsureRole(jwt, name + "noderedadmins", null);
            noderedadmins.addRight(user._id, user.username, [Rights.full_control]);
            noderedadmins.removeRight(user._id, [Rights.delete]);
            noderedadmins.AddMember(user);
            cli._logger.debug("[" + user.username + "] update nodered role " + name + "noderedadmins");
            await DBHelper.Save(noderedadmins, jwt);

        } catch (error) {
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.toString();
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
        var name: string = "";
        if (_id !== null && _id !== undefined && _id !== "" && _id != myid) {
            var res = await Config.db.query<User>({ _id: _id }, null, 1, 0, null, "users", jwt);
            if (res.length == 0) {
                throw new Error("Unknown userid " + _id);
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
        var msg: EnsureNoderedInstanceMessage;
        try {
            msg = EnsureNoderedInstanceMessage.assign(this.data);
            await this._EnsureNoderedInstance(cli, msg._id, false);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
            //msg.error = JSON.stringify(error, null, 2);
            if (msg !== null && msg !== undefined) msg.error = "Request failed!"
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
        var user: NoderedUser;
        cli._logger.debug("[" + cli.user.username + "] EnsureNoderedInstance");
        if (_id === null || _id === undefined || _id === "") _id = cli.user._id;
        var name = await this.GetInstanceName(_id, cli.user._id, cli.user.username, cli.jwt);

        var users = await Config.db.query<NoderedUser>({ _id: _id }, null, 1, 0, null, "users", cli.jwt);
        if (users.length == 0) {
            throw new Error("Unknown userid " + _id);
        }
        user = NoderedUser.assign(users[0]);
        var rootjwt = Crypt.rootToken();

        var namespace = Config.namespace;
        var hostname = Config.nodered_domain_schema.replace("$nodered_id$", name);

        var nodereduser = await DBHelper.FindById(_id, cli.jwt);
        var tuser: TokenUser = TokenUser.From(nodereduser);
        var nodered_jwt: string = Crypt.createToken(tuser, Config.personalnoderedtoken_expires_in);

        // if (Config.force_queue_prefix) {
        //     user.nodered.queue_prefix = nodereduser.username;
        // }

        cli._logger.debug("[" + cli.user.username + "] ensure nodered role " + name + "noderedadmins");
        var noderedadmins = await DBHelper.EnsureRole(cli.jwt, name + "noderedadmins", null);
        noderedadmins.addRight(nodereduser._id, nodereduser.username, [Rights.full_control]);
        noderedadmins.removeRight(nodereduser._id, [Rights.delete]);
        noderedadmins.addRight(cli.user._id, cli.user.username, [Rights.full_control]);
        noderedadmins.removeRight(cli.user._id, [Rights.delete]);
        noderedadmins.AddMember(nodereduser);
        cli._logger.debug("[" + cli.user.username + "] update nodered role " + name + "noderedadmins");
        await DBHelper.Save(noderedadmins, cli.jwt);

        var resources = new V1ResourceRequirements();
        var hasbilling: boolean = false;
        resources.limits = {};
        resources.requests = {};
        resources.requests.memory = "70Mi";
        resources.limits.memory = "256Mi";

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
                }
                if (user.nodered.resources.requests) {
                    resources.requests.memory = user.nodered.resources.requests.memory;
                    resources.requests.cpu = user.nodered.resources.requests.cpu;
                }
            } else {
                var billings = await Config.db.query<Billing>({ userid: _id, _type: "billing" }, null, 1, 0, null, "users", rootjwt);
                if (billings.length > 0) {
                    var billing: Billing = billings[0];
                    resources.limits.memory = billing.memory;
                    if (!NoderedUtil.IsNullEmpty(billing.openflowuserplan)) {
                        hasbilling = true;
                    }
                }

            }
        } else {
            if (!NoderedUtil.IsNullEmpty(Config.stripe_api_secret)) {
                var billings = await Config.db.query<Billing>({ userid: _id, _type: "billing" }, null, 1, 0, null, "users", rootjwt);
                if (billings.length > 0) {
                    var billing: Billing = billings[0];
                    if (!NoderedUtil.IsNullEmpty(billing.memory)) resources.limits.memory = billing.memory;
                    if (!NoderedUtil.IsNullEmpty(billing.openflowuserplan)) {
                        hasbilling = true;
                    }
                }
            }
        }

        cli._logger.debug("[" + cli.user.username + "] GetDeployments");
        var deployment: V1Deployment = await KubeUtil.instance().GetDeployment(namespace, name);
        if (deployment == null) {
            if (skipcreate) return;
            cli._logger.debug("[" + cli.user.username + "] Deployment " + name + " not found in " + namespace + " so creating it");
            // metadata: { name: name, namespace: namespace, app: name, labels: { billed: hasbilling.toString(), userid: _id } },
            // metadata: { labels: { name: name, app: name, billed: hasbilling.toString(), userid: _id } },

            var _deployment = {
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
                                        { name: "saml_baseurl", value: Config.protocol + "://" + hostname + "/" },
                                        { name: "nodered_id", value: name },
                                        { name: "nodered_sa", value: nodereduser.username },
                                        { name: "jwt", value: nodered_jwt },
                                        { name: "queue_prefix", value: user.nodered.queue_prefix },
                                        { name: "api_ws_url", value: Config.api_ws_url },
                                        { name: "amqp_url", value: Config.amqp_url },
                                        { name: "nodered_domain_schema", value: hostname },
                                        { name: "domain", value: hostname },
                                        { name: "protocol", value: Config.protocol },
                                        { name: "port", value: Config.port.toString() },
                                        { name: "noderedusers", value: (name + "noderedusers") },
                                        { name: "noderedadmins", value: (name + "noderedadmins") },
                                        { name: "api_allow_anonymous", value: user.nodered.api_allow_anonymous.toString() },
                                        { name: "NODE_ENV", value: Config.NODE_ENV },
                                    ],
                                    livenessProbe: {
                                        httpGet: {
                                            path: "/",
                                            port: 80,
                                            scheme: "HTTP"
                                        },
                                        initialDelaySeconds: Config.nodered_initial_liveness_delay,
                                        periodSeconds: 5,
                                        failureThreshold: 5,
                                        timeoutSeconds: 5
                                    },
                                }
                            ]
                        }
                    }
                }
            }
            // await KubeUtil.instance().ExtensionsV1beta1Api.createNamespacedDeployment(namespace, (_deployment as any));
            try {
                await KubeUtil.instance().AppsV1Api.createNamespacedDeployment(namespace, (_deployment as any));
                Audit.NoderedAction(TokenUser.From(cli.user), true, name, "createdeployment", Config.nodered_image, null);
            } catch (error) {
                if (error.response && error.response.body && error.response.body.message) {
                    cli._logger.error(error);
                    throw new Error(error.response.body.message);
                }
                cli._logger.error(error);
                Audit.NoderedAction(TokenUser.From(cli.user), false, name, "createdeployment", Config.nodered_image, null);
                throw error;
            }
        } else {
            deployment.spec.template.spec.containers[0].resources = resources;
            var f = deployment.spec.template.spec.containers[0].env.filter(x => x.name == "api_allow_anonymous");
            if (f.length > 0) {
                f[0].value = user.nodered.api_allow_anonymous.toString();
            }
            deployment.metadata.labels.billed = hasbilling.toString();
            deployment.spec.template.metadata.labels.billed = hasbilling.toString();
            deployment.metadata.labels.userid = _id;
            deployment.spec.template.metadata.labels.userid = _id;
            var image: string = "unknown";
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
                    throw new Error(error.response.body.message);
                }
                Audit.NoderedAction(TokenUser.From(cli.user), false, name, "replacedeployment", image, null);
                throw new Error("failed updating noeredinstance");
            }
        }

        cli._logger.debug("[" + cli.user.username + "] GetService");
        var service = await KubeUtil.instance().GetService(namespace, name);
        if (service == null) {
            cli._logger.debug("[" + cli.user.username + "] Service " + name + " not found in " + namespace + " creating it");
            var _service = {
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
        var ingress = await KubeUtil.instance().GetIngress(namespace, "useringress");
        if (ingress !== null) {
            var rule = null;
            for (var i = 0; i < ingress.spec.rules.length; i++) {
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
        var name = await this.GetInstanceName(_id, myuserid, myusername, jwt);
        var user = Crypt.verityToken(jwt);
        var namespace = Config.namespace;
        var hostname = Config.nodered_domain_schema.replace("$nodered_id$", name);

        var deployment = await KubeUtil.instance().GetDeployment(namespace, name);
        if (deployment != null) {
            var image: string = "unknown";
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
        var service = await KubeUtil.instance().GetService(namespace, name);
        if (service != null) {
            await KubeUtil.instance().CoreV1Api.deleteNamespacedService(name, namespace);
        }
        var replicaset = await KubeUtil.instance().GetReplicaset(namespace, "app", name);
        if (replicaset !== null) {
            KubeUtil.instance().AppsV1Api.deleteNamespacedReplicaSet(replicaset.metadata.name, namespace);
        }
        var ingress = await KubeUtil.instance().GetIngress(namespace, "useringress");
        if (ingress !== null) {
            var updated = false;
            for (var i = ingress.spec.rules.length - 1; i >= 0; i--) {
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
        var msg: DeleteNoderedInstanceMessage;
        var user: User;
        try {
            msg = DeleteNoderedInstanceMessage.assign(this.data);
            cli._logger.debug("[" + cli.user.username + "] DeleteNoderedInstance");
            await this._DeleteNoderedInstance(msg._id, cli.user._id, cli.user.username, cli.jwt);

        } catch (error) {
            cli._logger.error("[" + cli.user.username + "] failed locating useringress");
            this.data = "";
            cli._logger.error(error);
            //msg.error = JSON.stringify(error, null, 2);
            if (msg !== null && msg !== undefined) msg.error = "Request failed!"
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
        var msg: DeleteNoderedPodMessage;
        var user: User;
        try {
            cli._logger.debug("[" + cli.user.username + "] DeleteNoderedInstance");
            msg = DeleteNoderedPodMessage.assign(this.data);
            var namespace = Config.namespace;
            var list = await KubeUtil.instance().CoreV1Api.listNamespacedPod(namespace);
            if (list.body.items.length > 0) {
                for (var i = 0; i < list.body.items.length; i++) {
                    var item = list.body.items[i];
                    if (item.metadata.name == msg.name) {
                        var image: string = "unknown";
                        try {
                            image = item.spec.containers[0].image;
                        } catch (error) {

                        }
                        var name: string = "unknown";
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
                cli._logger.warn("[" + cli.user.username + "] GetNoderedInstance: found NO Namespaced Pods ???");
                Audit.NoderedAction(TokenUser.From(cli.user), false, null, "deletepod", image, msg.name);
            }
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
            //msg.error = JSON.stringify(error, null, 2);
            if (msg !== null && msg !== undefined) msg.error = "Request failed!"
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
        var msg: RestartNoderedInstanceMessage;
        try {
            cli._logger.debug("[" + cli.user.username + "] RestartNoderedInstance");
            msg = RestartNoderedInstanceMessage.assign(this.data);
            var name = await this.GetInstanceName(msg._id, cli.user._id, cli.user.username, cli.jwt);
            var namespace = Config.namespace;
            // var hostname = Config.nodered_domain_schema.replace("$nodered_id$", name);

            var list = await KubeUtil.instance().CoreV1Api.listNamespacedPod(namespace);
            for (var i = 0; i < list.body.items.length; i++) {
                var item = list.body.items[i];
                // if (item.metadata.labels.app === name || item.metadata.labels.name === name) {
                if (item.metadata.labels.app === name) {
                    var image: string = "unknown";
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
            //msg.error = JSON.stringify(error, null, 2);
            if (msg !== null && msg !== undefined) msg.error = "Request failed!"
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
        var msg: GetNoderedInstanceMessage;
        try {
            cli._logger.debug("[" + cli.user.username + "] GetNoderedInstance");
            msg = GetNoderedInstanceMessage.assign(this.data);
            var name = await this.GetInstanceName(msg._id, cli.user._id, cli.user.username, cli.jwt);
            var namespace = Config.namespace;
            // var hostname = Config.nodered_domain_schema.replace("$nodered_id$", name);

            var list = await KubeUtil.instance().CoreV1Api.listNamespacedPod(namespace);

            var found: any = null;
            msg.result = null;
            msg.results = [];
            var rootjwt = Crypt.rootToken();
            if (list.body.items.length > 0) {
                for (var i = 0; i < list.body.items.length; i++) {
                    var item = list.body.items[i];
                    if (!NoderedUtil.IsNullEmpty(Config.stripe_api_secret)) {
                        var itemname = item.metadata.name;
                        var create = item.metadata.creationTimestamp;
                        var billed = item.metadata.labels.billed;
                        var image = item.spec.containers[0].image
                        var userid = item.metadata.labels.userid;
                        var date = new Date();
                        var a: number = (date as any) - (create as any);
                        // var diffminutes = a / (1000 * 60);
                        var diffhours = a / (1000 * 60 * 60);
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
                        msg.results.push(item);
                    } else if (item.metadata.labels.app === name) {
                        found = item;
                        if (item.status.phase != "Failed") {
                            msg.result = item;
                            cli._logger.debug("[" + cli.user.username + "] GetNoderedInstance:" + name + " found one");
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
            //msg.error = JSON.stringify(error, null, 2);
            if (msg !== null && msg !== undefined) msg.error = "Request failed!"
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
        var msg: GetNoderedInstanceLogMessage;
        try {
            cli._logger.debug("[" + cli.user.username + "] GetNoderedInstance");
            msg = GetNoderedInstanceLogMessage.assign(this.data);
            var name = await this.GetInstanceName(msg._id, cli.user._id, cli.user.username, cli.jwt);
            var namespace = Config.namespace;

            var list = await KubeUtil.instance().CoreV1Api.listNamespacedPod(namespace);

            if (list.body.items.length > 0) {
                for (var i = 0; i < list.body.items.length; i++) {
                    var item = list.body.items[i];
                    var image: string = "unknown";
                    try {
                        image = item.spec.containers[0].image;
                    } catch (error) {

                    }
                    if (!NoderedUtil.IsNullEmpty(msg.name) && item.metadata.name == msg.name && cli.user.HasRoleName("admins")) {
                        cli._logger.debug("[" + cli.user.username + "] GetNoderedInstance:" + name + " found one as " + item.metadata.name);
                        var obj = await await KubeUtil.instance().CoreV1Api.readNamespacedPodLog(item.metadata.name, namespace, "", false);
                        msg.result = obj.body;
                        Audit.NoderedAction(TokenUser.From(cli.user), true, name, "readpodlog", image, item.metadata.name);
                    } else if (item.metadata.labels.app === name) {
                        cli._logger.debug("[" + cli.user.username + "] GetNoderedInstance:" + name + " found one as " + item.metadata.name);
                        var obj = await await KubeUtil.instance().CoreV1Api.readNamespacedPodLog(item.metadata.name, namespace, "", false);
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
            //msg.error = JSON.stringify(error, null, 2);
            if (msg !== null && msg !== undefined) msg.error = "Request failed!"
            if (error.response && error.response.body && !NoderedUtil.IsNullEmpty(error.response.body.message)) {
                msg.error = error.response.body.message;
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
                var bucket = new GridFSBucket(Config.db.db);
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
        var msg: SaveFileMessage
        try {
            msg = SaveFileMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            if (NoderedUtil.IsNullEmpty(msg.filename)) throw new Error("Filename is mandatory");
            // if (NoderedUtil.IsNullEmpty(msg.mimeType)) throw new Error("mimeTypes is mandatory");
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

            var buf = Buffer.from(msg.file, 'base64');
            var readable = new Readable();
            readable._read = () => { }; // _read is required but you can noop it
            readable.push(buf);
            readable.push(null);
            msg.file = null;
            if (msg.metadata == null) { msg.metadata = new Base(); }
            msg.metadata = Base.assign(msg.metadata);
            if (NoderedUtil.IsNullUndefinded(msg.metadata._acl)) {
                msg.metadata._acl = [];
                msg.metadata.addRight(WellknownIds.filestore_users, "filestore users", [Rights.read]);
            }
            var user: TokenUser = Crypt.verityToken(msg.jwt);
            msg.metadata._createdby = user.name;
            msg.metadata._createdbyid = user._id;
            msg.metadata._created = new Date(new Date().toISOString());
            msg.metadata._modifiedby = user.name;
            msg.metadata._modifiedbyid = user._id;
            msg.metadata._modified = msg.metadata._created;
            if (NoderedUtil.IsNullEmpty(msg.metadata.name)) {
                msg.metadata.name = msg.filename;
            }
            var hasUser: any = msg.metadata._acl.find(e => e._id === user._id);
            if ((hasUser === null || hasUser === undefined)) {
                msg.metadata.addRight(user._id, user.name, [Rights.full_control]);
            }
            hasUser = msg.metadata._acl.find(e => e._id === WellknownIds.filestore_admins);
            if ((hasUser === null || hasUser === undefined)) {
                msg.metadata.addRight(WellknownIds.filestore_admins, "filestore admins", [Rights.full_control]);
            }
            // hasUser = msg.metadata._acl.find(e => e._id === WellknownIds.filestore_users);
            // if ((hasUser === null || hasUser === undefined)) {
            //     msg.metadata.addRight(WellknownIds.filestore_users, "filestore users", [Rights.read]);
            // }
            msg.metadata = Config.db.ensureResource(msg.metadata);
            if (!Config.db.hasAuthorization(user, msg.metadata, Rights.create)) { throw new Error("Access denied, no authorization to save file"); }
            msg.id = await this._SaveFile(readable, msg.filename, msg.mimeType, msg.metadata);
        } catch (error) {
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.toString();
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
                var bucket = new GridFSBucket(Config.db.db);
                let downloadStream = bucket.openDownloadStream(safeObjectID(id));
                var bufs = [];
                downloadStream.on('data', (chunk) => {
                    bufs.push(chunk);
                });
                downloadStream.on('error', (error) => {
                    reject(error);
                });
                downloadStream.on('end', () => {

                    // var contentLength = bufs.reduce(function(sum, buf){
                    //     return sum + buf.length;
                    //   }, 0);
                    var buffer = Buffer.concat(bufs);
                    //writeFileSync('/home/allan/Documents/data.png', result.body);
                    //result.body = Buffer.from(result.body).toString('base64');
                    var result = buffer.toString('base64');
                    resolve(result);
                });
            } catch (err) {
                reject(err);
            }
        });
    }
    private async GetFile(cli: WebSocketServerClient): Promise<void> {
        this.Reply();
        var msg: GetFileMessage
        try {
            msg = SaveFileMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            if (!NoderedUtil.IsNullEmpty(msg.id)) {
                var rows = await Config.db.query({ _id: safeObjectID(msg.id) }, null, 1, 0, null, "files", msg.jwt);
                if (rows.length == 0) { throw new Error("Not found"); }
                msg.metadata = (rows[0] as any).metadata
                msg.mimeType = (rows[0] as any).contentType;
            } else if (!NoderedUtil.IsNullEmpty(msg.filename)) {
                var rows = await Config.db.query({ "filename": msg.filename }, null, 1, 0, { uploadDate: -1 }, "fs.files", msg.jwt);
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
            if (msg !== null && msg !== undefined) msg.error = error.toString();
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
        var msg: UpdateFileMessage
        try {
            msg = UpdateFileMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }

            var bucket = new GridFSBucket(Config.db.db);
            var q = { $or: [{ _id: msg.id }, { _id: safeObjectID(msg.id) }] };
            var files = bucket.find(q);
            var count = await this.filescount(files);
            if (count == 0) { throw new Error("Not found"); }
            var file = await this.filesnext(files);
            msg.metadata._createdby = file.metadata._createdby;
            msg.metadata._createdbyid = file.metadata._createdbyid;
            msg.metadata._created = file.metadata._created;
            msg.metadata.name = file.metadata.name;
            (msg.metadata as any).filename = file.metadata.filename;
            (msg.metadata as any).path = file.metadata.path;

            var user: TokenUser = Crypt.verityToken(msg.jwt);
            msg.metadata._modifiedby = user.name;
            msg.metadata._modifiedbyid = user._id;
            msg.metadata._modified = new Date(new Date().toISOString());;

            msg.metadata = Base.assign(msg.metadata);

            var hasUser: any = msg.metadata._acl.find(e => e._id === user._id);
            if ((hasUser === null || hasUser === undefined)) {
                msg.metadata.addRight(user._id, user.name, [Rights.full_control]);
            }
            msg.metadata.addRight(WellknownIds.filestore_admins, "filestore admins", [Rights.full_control]);
            if (!Config.db.hasAuthorization(user, msg.metadata, Rights.update)) { throw new Error("Access denied, no authorization to update file"); }

            msg.metadata = Config.db.ensureResource(msg.metadata);
            var fsc = Config.db.db.collection("fs.files");
            DatabaseConnection.traversejsonencode(msg.metadata);
            var res = await fsc.updateOne(q, { $set: { metadata: msg.metadata } });

        } catch (error) {
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.toString();
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
        var msg: CreateWorkflowInstanceMessage
        try {
            msg = CreateWorkflowInstanceMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.workflowid) && NoderedUtil.IsNullEmpty(msg.queue)) throw new Error("workflowid or queue is mandatory");
            if (NoderedUtil.IsNullEmpty(msg.resultqueue)) throw new Error("replyqueuename is mandatory");
            if (NoderedUtil.IsNullEmpty(msg.targetid)) throw new Error("targetid is mandatory");
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }

            var tuser = Crypt.verityToken(msg.jwt);
            msg.jwt = Crypt.createToken(tuser, Config.longtoken_expires_in);

            // if (cli.consumers.length == 0) {
            //     await cli.CreateConsumer("nodered." + Math.random().toString(36).substr(2, 9));
            //     // throw new Error("Client not connected to any message queues");
            // }
            if (NoderedUtil.IsNullEmpty(msg.queue)) {
                var workflow: any = null;
                var user: any = null;
                var res = await Config.db.query({ "_id": msg.workflowid }, null, 1, 0, null, "workflow", msg.jwt);
                if (res.length != 1) throw new Error("Unknown workflow id " + msg.workflowid);
                workflow = res[0];
                msg.queue = workflow.queue;
                if (NoderedUtil.IsNullEmpty(msg.name)) { msg.name = workflow.name; }
            }
            if (NoderedUtil.IsNullEmpty(msg.name)) throw new Error("name is mandatory when workflowid not set")

            if (msg.queue === msg.resultqueue) {
                throw new Error("Cannot reply to self queuename:" + msg.queue + " correlationId:" + msg.resultqueue);
            }

            res = await Config.db.query({ "_id": msg.targetid }, null, 1, 0, null, "users", msg.jwt);
            if (res.length != 1) throw new Error("Unknown target id " + msg.targetid);
            workflow = res[0];
            msg.state = "new";
            msg.form = "unknown";
            (msg as any).workflow = msg.workflowid;

            if (NoderedUtil.IsNullEmpty(msg.correlationId)) {
                msg.correlationId = Math.random().toString(36).substr(2, 9);
            }

            var _data = Base.assign<Base>(msg as any);
            _data.addRight(msg.targetid, "targetid", [-1]);
            _data.addRight(cli.user._id, cli.user.name, [-1]);
            _data.addRight(tuser._id, tuser.name, [-1]);
            _data._type = "instance";
            _data.name = msg.name;

            var res2 = await Config.db.InsertOne(_data, "workflow_instances", 1, true, msg.jwt);
            msg.newinstanceid = res2._id;

            if (msg.initialrun) {
                var message = { _id: res2._id, __jwt: msg.jwt, __user: tuser };
                amqpwrapper.Instance().sendWithReplyTo("", msg.queue, msg.resultqueue, message, Config.amqp_default_expiration, msg.correlationId);
                // cli.consumers[0].sendToQueueWithReply(msg.queue, msg.resultqueue, msg.correlationId, message, (60 * (60 * 1000))); // 1 hour
            }
        } catch (error) {
            cli._logger.error(error);
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.toString();
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
        var msg: StripeCancelPlanMessage;
        var rootjwt = Crypt.rootToken();
        try {
            msg = StripeAddPlanMessage.assign(this.data);
            if (NoderedUtil.IsNullUndefinded(msg.jwt)) msg.jwt = cli.jwt;
            if (NoderedUtil.IsNullUndefinded(msg.userid)) msg.userid = cli.user._id;

            var billings = await Config.db.query<Billing>({ userid: msg.userid, _type: "billing" }, null, 1, 0, null, "users", rootjwt);
            if (billings.length == 0) throw new Error("Need billing info and a stripe customer in order to cancel plan");
            var billing: Billing = billings[0];
            if (NoderedUtil.IsNullEmpty(billing.stripeid)) throw new Error("Need a stripe customer in order to cancel plan");
            var customer: stripe_customer = await this.Stripe<stripe_customer>("GET", "customers", billing.stripeid, null, null);
            if (customer == null) throw new Error("Failed locating stripe customer at stribe");


            var subscription: stripe_subscription = null;
            var subscriptionitem: stripe_base = null; // stripe_subscription_item
            var hasit = customer.subscriptions.data.filter(s => {
                var arr = s.items.data.filter(y => y.plan.id == msg.planid);
                if (arr.length > 0) {
                    subscription = s;
                    subscriptionitem = arr[0];
                }
                return arr.length > 0;
            });


            var hasit = customer.subscriptions.data.filter(s => {
                var arr = s.items.data.filter(y => y.plan.id == msg.planid);
                return arr.length > 0;
            });
            if (hasit.length == 0) throw new Error("Customer does not have this plan");

            // if (hasit[0].items.total_count == 1 || hasit[0].items.total_count == 2) {
            //     var payload: any = null;
            //     if (hasit[0].items.total_count == 2) { // support agrement, so bill used  hours right away
            //         // payload = { invoice_now: true };
            //         // payload = { prorate: true }
            //     }
            //     var res = await this.Stripe("DELETE", "subscriptions", subscription.id, payload, customer.id);
            // } else {
            //     var res = await this.Stripe("DELETE", "subscription_items", subscriptionitem.id, null, customer.id);
            // }
            var payload: any = { quantity: 0 };
            var res = await this.Stripe("POST", "subscription_items", subscriptionitem.id, payload, customer.id);


            msg.customer = customer;
        } catch (error) {
            if (error == null) new Error("Unknown error");
            cli._logger.error(error);
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) {
                msg.error = error;
                if (error.message) msg.error = error.message;
                // if (error.stack) msg.error = error.stack;
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
        var msg: StripeAddPlanMessage;
        var rootjwt = Crypt.rootToken();
        try {
            msg = StripeAddPlanMessage.assign(this.data);
            if (NoderedUtil.IsNullUndefinded(msg.jwt)) msg.jwt = cli.jwt;
            if (NoderedUtil.IsNullUndefinded(msg.userid)) msg.userid = cli.user._id;

            var billings = await Config.db.query<Billing>({ userid: msg.userid, _type: "billing" }, null, 1, 0, null, "users", rootjwt);
            if (billings.length == 0) throw new Error("Need billing info and a stripe customer in order to add plan");
            var billing: Billing = billings[0];
            if (NoderedUtil.IsNullEmpty(billing.stripeid)) throw new Error("Need a stripe customer in order to add plan");
            var customer: stripe_customer = await this.Stripe<stripe_customer>("GET", "customers", billing.stripeid, null, null);
            if (customer == null) throw new Error("Failed locating stripe customer at stribe");

            var subscription: stripe_subscription = null;
            var subscription_item: stripe_subscription_item = null;

            var hasPlan = customer.subscriptions.data.filter(s => {
                var arr = s.items.data.filter(y => y.plan.id == msg.planid);
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
                var payload: any = { default_tax_rates: [billing.taxrate] };
                await this.Stripe("POST", "subscriptions", subscription.id, payload, customer.id);
            } else if (subscription != null && subscription.default_tax_rates.length != 0 && NoderedUtil.IsNullEmpty(billing.taxrate)) {
                var payload: any = { default_tax_rates: [] };
                await this.Stripe("POST", "subscriptions", subscription.id, payload, customer.id);
            }

            if (hasPlan.length > 0) throw new Error("Customer already has this plan");

            var plan = await this.Stripe<stripe_plan>("GET", "plans", msg.planid, null, null);


            if (subscription == null) {
                var baseurl = Config.baseurl() + "/#/Payment";
                var payload: any = {
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
                    var payload: any = { quantity: 1 };
                    if (plan.usage_type != "metered") {
                        var res = await this.Stripe("POST", "subscription_items", subscription_item.id, payload, customer.id);
                    }
                } else {
                    var payload: any = { subscription: subscription.id, plan: msg.planid };
                    if (plan.usage_type != "metered") {
                        payload.quantity = 1;
                    }
                    var res = await this.Stripe("POST", "subscription_items", null, payload, customer.id);
                }

            }
            msg.customer = customer;
        } catch (error) {
            if (error == null) new Error("Unknown error");
            cli._logger.error(error);
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) {
                msg.error = error;
                if (error.message) msg.error = error.message;
                // if (error.stack) msg.error = error.stack;
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
        var msg: EnsureStripeCustomerMessage;
        var rootjwt = Crypt.rootToken();
        try {
            msg = EnsureStripeCustomerMessage.assign(this.data);
            if (NoderedUtil.IsNullUndefinded(msg.jwt)) msg.jwt = cli.jwt;
            if (NoderedUtil.IsNullUndefinded(msg.userid)) msg.userid = cli.user._id;
            var users = await Config.db.query({ _id: msg.userid, _type: "user" }, null, 1, 0, null, "users", msg.jwt);
            if (users.length == 0) throw new Error("Unknown userid");
            var user: User = users[0] as any;
            var dirty: boolean = false;
            var hasbilling: boolean = false;

            var billings = await Config.db.query<Billing>({ userid: msg.userid, _type: "billing" }, null, 1, 0, null, "users", rootjwt);
            var billing: Billing;
            if (billings.length == 0) {
                var tax_rates = await this.Stripe<stripe_list<stripe_base>>("GET", "tax_rates", null, null, null);
                if (tax_rates == null || tax_rates.data.length == 0) throw new Error("Failed getting tax_rates from stripe");

                billing = Billing.assign(msg.billing);
                billing.taxrate = tax_rates.data[0].id;
                billing.tax = 1 + ((tax_rates.data[0] as any).percentage / 100);
                if (NoderedUtil.IsNullEmpty(billing.name)) throw new Error("Name is mandatory");
                if (NoderedUtil.IsNullEmpty(billing.email)) throw new Error("Email is mandatory");
                billing.addRight(user._id, user.name, [Rights.read]);
                billing.addRight(WellknownIds.admins, "admins", [Rights.full_control]);
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
            var customer: stripe_customer;
            if (!NoderedUtil.IsNullEmpty(billing.stripeid)) {
                customer = await this.Stripe<stripe_customer>("GET", "customers", billing.stripeid, null, null);
            }
            if (customer == null) {
                var payload: any = { name: billing.name, email: billing.email, metadata: { userid: msg.userid }, description: user.name };
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
                var tax_rates = await this.Stripe<stripe_list<stripe_base>>("GET", "tax_rates", null, null, null);
                if (tax_rates == null || tax_rates.total_count == 0) throw new Error("Failed getting tax_rates from stripe");
                billing.taxrate = tax_rates.data[0].id;
                billing.tax = 1 + ((tax_rates.data[0] as any).percentage / 100);
                billing = await Config.db._UpdateOne(null, billing, "users", 3, true, rootjwt);
            } else if (customer.tax_ids.total_count > 0 && (customer.tax_ids.data[0].verification.status != 'verified' &&
                customer.tax_ids.data[0].verification.status != 'unavailable') && billing.tax == 1) {
                var tax_rates = await this.Stripe<stripe_list<stripe_base>>("GET", "tax_rates", null, null, null);
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
                var payload: any = { coupon: "" };
                customer = await this.Stripe<stripe_customer>("POST", "customers", billing.stripeid, payload, null);
            }
            var newmemory: string = "";
            if (customer != null && billing != null && customer.subscriptions != null && customer.subscriptions.total_count > 0) {
                for (var i = 0; i < customer.subscriptions.data.length; i++) {
                    var sub = customer.subscriptions.data[i];
                    for (var y = 0; y < sub.items.data.length; y++) {
                        var subitem = sub.items.data[y];
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
                    var payload: any = { coupon: "" };
                    customer = await this.Stripe<stripe_customer>("POST", "customers", billing.stripeid, payload, null);

                    var coupons: stripe_list<stripe_coupon> = await this.Stripe<stripe_list<stripe_coupon>>("GET", "coupons", null, null, null);
                    var isvalid = coupons.data.filter(c => c.name == billing.coupon);
                    if (isvalid.length == 0) throw new Error("Unknown coupons '" + billing.coupon + "'");

                    var payload: any = { coupon: coupons.data[0].id };
                    customer = await this.Stripe<stripe_customer>("POST", "customers", billing.stripeid, payload, null);

                }
            }
            if (customer != null && !NoderedUtil.IsNullEmpty(billing.coupon) && customer.discount == null) {
                var coupons: stripe_list<stripe_coupon> = await this.Stripe<stripe_list<stripe_coupon>>("GET", "coupons", null, null, null);
                var isvalid = coupons.data.filter(c => c.name == billing.coupon);
                if (isvalid.length == 0) throw new Error("Unknown coupons '" + billing.coupon + "'");

                var payload: any = { coupon: coupons.data[0].id };
                customer = await this.Stripe<stripe_customer>("POST", "customers", billing.stripeid, payload, null);
            }
            if (customer != null) {
                var sources = await this.Stripe<stripe_list<stripe_base>>("GET", "sources", null, null, billing.stripeid);
                if ((sources.data.length > 0) != billing.hascard) {
                    billing.hascard = (sources.data.length > 0);
                    billing = await Config.db._UpdateOne(null, billing, "users", 3, true, rootjwt);
                }
            }
            if (customer != null && billing != null) {
                var openflowuserplan: string = "";
                var supportplan: string = "";
                var supporthourplan: string = "";

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
                msg.error = error;
                if (error.message) msg.error = error.message;
                // if (error.stack) msg.error = error.stack;
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
        var url = "https://api.stripe.com/v1/" + object;
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

        var auth = "Basic " + new Buffer(Config.stripe_api_secret + ":").toString("base64");

        var options = {
            headers: {
                'Content-type': 'application/x-www-form-urlencoded',
                'Authorization': auth
            }
        };
        if (payload != null && method != "GET" && method != "DELETE") {
            var flattenedData = this.flattenAndStringify(payload);
            (options as any).form = flattenedData;
        }
        if (method == "POST") {
            var response = await got.post(url, options);
            payload = JSON.parse(response.body);
        }
        if (method == "GET") {
            var response = await got.get(url, options);
            payload = JSON.parse(response.body);
        }
        if (method == "PUT") {
            var response = await got.put(url, options);
            payload = JSON.parse(response.body);
        }
        if (method == "DELETE") {
            var response = await got.delete(url, options);
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
        var msg: StripeMessage;
        try {
            msg = StripeMessage.assign(this.data);
            if (NoderedUtil.IsNullUndefinded(msg.jwt)) msg.jwt = cli.jwt;
            if (NoderedUtil.IsNullEmpty(msg.object)) throw new Error("object is mandatory");
            if (!cli.user.HasRoleName("admins")) {
                if (!NoderedUtil.IsNullEmpty(msg.url)) throw new Error("Custom url not allowed");
                // if (msg.object != "customers" && msg.object != "tax_ids"
                //     && msg.object != "products" && msg.object != "plans" &&
                //     msg.object != "checkout.sessions" && msg.object != "tax_rates"
                //     && msg.object != "subscriptions" && msg.object != "subscription_items"
                //     && msg.object != "usage_records") throw new Error("Access to " + msg.object + " is not allowed");
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
                msg.error = error;
                if (error.message) msg.error = error.message;
                // if (error.stack) msg.error = error.stack;
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