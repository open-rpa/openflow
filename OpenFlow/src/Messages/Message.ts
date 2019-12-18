import * as crypto from "crypto";
import { lookup } from "mimetype";
import { SocketMessage } from "../SocketMessage";
import { WebSocketClient, QueuedMessage } from "../WebSocketClient";
import { QueryMessage } from "./QueryMessage";
import { Base, Rights, WellknownIds } from "../base";
import { SigninMessage } from "./SigninMessage";
import { User } from "../User";
import { Auth } from "../Auth";
import { Crypt } from "../Crypt";
import { TokenUser } from "../TokenUser";
import { AggregateMessage } from "./AggregateMessage";
import { InsertOneMessage } from "./InsertOneMessage";
import { UpdateOneMessage } from "./UpdateOneMessage";
import { DeleteOneMessage } from "./DeleteOneMessage";
import { Config } from "../Config";
import { Audit } from "../Audit";
import { InsertOrUpdateOneMessage } from "./InsertOrUpdateOneMessage";
import { LoginProvider } from "../LoginProvider";
import { MapReduceMessage } from "./MapReduceMessage";
import { CloseQueueMessage } from "./CloseQueueMessage";
import { RegisterQueueMessage } from "./RegisterQueueMessage";
import { QueueMessage } from "./QueueMessage";
import { RegisterUserMessage } from "./RegisterUserMessage";
import { UpdateManyMessage } from "./UpdateManyMessage";
import { EnsureNoderedInstanceMessage } from "./EnsureNoderedInstanceMessage";
import { KubeUtil } from "../KubeUtil";
import { Role } from "../Role";
import { RestartNoderedInstanceMessage } from "./RestartNoderedInstanceMessage";
import { DeleteNoderedInstanceMessage } from "./DeleteNoderedInstanceMessage";
import { GetNoderedInstanceMessage } from "./GetNoderedInstanceMessage";
import { GetNoderedInstanceLogMessage } from "./GetNoderedInstanceLogMessage";
import { Util } from "../Util";
import { SaveFileMessage } from "./SaveFileMessage";
import { Readable, Stream } from "stream";
import { GridFSBucket, ObjectID, Db, Cursor } from "mongodb";
import { GetFileMessage } from "./GetFileMessage";
import { ListCollectionsMessage } from "./ListCollectionsMessage";
import { DropCollectionMessage } from "./DropCollectionMessage";
import * as path from "path";
import { UpdateFileMessage } from "./UpdateFileMessage";
import { DatabaseConnection } from "../DatabaseConnection";

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
        if (!Util.IsNullEmpty(command)) { this.command = command; }
        this.replyto = this.id;
        this.id = crypto.randomBytes(16).toString("hex");
    }
    public Process(cli: WebSocketClient): void {
        try {
            if (!Util.IsNullEmpty(this.command)) { this.command = this.command.toLowerCase(); }
            var command: string = this.command;
            if (this.command !== "ping" && this.command !== "pong") {

                if (!Util.IsNullEmpty(this.replyto)) {
                    var qmsg: QueuedMessage = cli.messageQueue[this.replyto];
                    if (!Util.IsNullUndefinded(qmsg)) {
                        try {
                            qmsg.message = Object.assign(qmsg.message, JSON.parse(this.data));
                        } catch (error) {
                            // TODO: should we set message to data ?
                        }
                        if (!Util.IsNullUndefinded(qmsg.cb)) { qmsg.cb(this); }
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
                case "savefile":
                    this.SaveFile(cli);
                    break;
                case "getfile":
                    this.GetFile(cli);
                    break;
                case "updatefile":
                    this.UpdateFile(cli);
                    break;
                default:
                    this.UnknownCommand(cli);
                    break;
            }
        } catch (error) {
            cli._logger.error(error);
        }
    }
    async RegisterQueue(cli: WebSocketClient) {
        this.Reply();
        var msg: RegisterQueueMessage<Base>
        try {
            msg = RegisterQueueMessage.assign(this.data);
            await cli.CreateConsumer(msg.queuename);
        } catch (error) {
            cli._logger.error(error);
            if (Util.IsNullUndefinded(msg)) { (msg as any) = {}; }
            msg.error = error.toString();
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
    async QueueMessage(cli: WebSocketClient) {
        this.Reply();
        var msg: QueueMessage
        try {
            msg = QueueMessage.assign(this.data);
            if (Util.IsNullEmpty(msg.replyto)) {
                await cli.sendToQueue(msg);
            } else {
                if (msg.queuename === msg.replyto) {
                    cli._logger.warn("Ignore reply to self queuename:" + msg.queuename + " correlationId:" + msg.correlationId);
                    return
                }
                this.replyto = msg.correlationId;
                await cli.sendQueueReply(msg);
            }
        } catch (error) {
            cli._logger.error(error);
            if (Util.IsNullUndefinded(msg)) { (msg as any) = {}; }
            msg.error = error.toString();
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
    async CloseQueue(cli: WebSocketClient) {
        this.Reply();
        var msg: CloseQueueMessage<Base>
        try {
            msg = CloseQueueMessage.assign(this.data);
            await cli.CloseConsumer(msg.queuename);
        } catch (error) {
            cli._logger.error(error);
            if (Util.IsNullUndefinded(msg)) { (msg as any) = {}; }
            msg.error = error.toString();
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
    public Send(cli: WebSocketClient): void {
        cli.Send(this);
    }
    private UnknownCommand(cli: WebSocketClient): void {
        this.Reply("error");
        this.data = "Unknown command " + this.command;
        cli._logger.error(this.data);
        this.Send(cli);
    }
    private Ping(cli: WebSocketClient): void {
        this.Reply("pong");
        this.Send(cli);
    }
    private static collectionCache: any = {};
    private static collectionCachetime: Date = new Date();
    private async ListCollections(cli: WebSocketClient): Promise<void> {
        this.Reply();
        var msg: ListCollectionsMessage
        try {
            msg = ListCollectionsMessage.assign(this.data);
            if (Util.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
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
            if (Util.IsNullUndefinded(msg)) { (msg as any) = {}; }
            msg.error = error.toString();
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
    private async DropCollection(cli: WebSocketClient): Promise<void> {
        this.Reply();
        var msg: DropCollectionMessage
        try {
            msg = DropCollectionMessage.assign(this.data);
            if (Util.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            await Config.db.DropCollection(msg.collectionname, msg.jwt);
        } catch (error) {
            cli._logger.error(error);
            if (Util.IsNullUndefinded(msg)) { (msg as any) = {}; }
            msg.error = error.toString();
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

    private async Query(cli: WebSocketClient): Promise<void> {
        this.Reply();
        var msg: QueryMessage<Base>
        try {
            msg = QueryMessage.assign(this.data);
            if (Util.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            msg.result = await Config.db.query(msg.query, msg.projection, msg.top, msg.skip, msg.orderby, msg.collectionname, msg.jwt);
        } catch (error) {
            cli._logger.error(error);
            if (Util.IsNullUndefinded(msg)) { (msg as any) = {}; }
            msg.error = error.toString();
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
    private async Aggregate(cli: WebSocketClient): Promise<void> {
        this.Reply();
        var msg: AggregateMessage<Base>
        try {
            msg = AggregateMessage.assign(this.data);
            if (Util.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            msg.result = await Config.db.aggregate(msg.aggregates, msg.collectionname, msg.jwt);
        } catch (error) {
            if (Util.IsNullUndefinded(msg)) { (msg as any) = {}; }
            msg.error = error.toString();
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
    private async InsertOne(cli: WebSocketClient): Promise<void> {
        this.Reply();
        var msg: InsertOneMessage<Base>
        try {
            msg = InsertOneMessage.assign(this.data);
            if (Util.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            if (Util.IsNullEmpty(msg.w as any)) { msg.w = 0; }
            if (Util.IsNullEmpty(msg.j as any)) { msg.j = false; }
            if (Util.IsNullEmpty(msg.jwt) && msg.collectionname === "jslog") {
                msg.jwt = TokenUser.rootToken();
            }
            if (Util.IsNullEmpty(msg.jwt)) {
                throw new Error("jwt is null and client is not authenticated");
            }
            msg.result = await Config.db.InsertOne(msg.item, msg.collectionname, msg.w, msg.j, msg.jwt);
        } catch (error) {
            if (Util.IsNullUndefinded(msg)) { (msg as any) = {}; }
            msg.error = error.toString();
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
    private async UpdateOne(cli: WebSocketClient): Promise<void> {
        this.Reply();
        var msg: UpdateOneMessage<Base>
        try {
            msg = UpdateOneMessage.assign(this.data);
            if (Util.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            if (Util.IsNullEmpty(msg.w as any)) { msg.w = 0; }
            if (Util.IsNullEmpty(msg.j as any)) { msg.j = false; }
            msg = await Config.db.UpdateOne(msg);
        } catch (error) {
            if (Util.IsNullUndefinded(msg)) { (msg as any) = {}; }
            msg.error = error.toString();
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
    private async UpdateMany(cli: WebSocketClient): Promise<void> {
        this.Reply();
        var msg: UpdateManyMessage<Base>;
        try {
            msg = UpdateManyMessage.assign(this.data);
            if (Util.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            if (Util.IsNullEmpty(msg.w as any)) { msg.w = 0; }
            if (Util.IsNullEmpty(msg.j as any)) { msg.j = false; }
            msg = await Config.db.UpdateMany(msg);
        } catch (error) {
            if (Util.IsNullUndefinded(msg)) { (msg as any) = {}; }
            msg.error = error.toString();
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

    private async InsertOrUpdateOne(cli: WebSocketClient): Promise<void> {
        this.Reply();
        var msg: InsertOrUpdateOneMessage<Base>
        try {
            msg = InsertOrUpdateOneMessage.assign(this.data);
            if (Util.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            if (Util.IsNullEmpty(msg.w as any)) { msg.w = 0; }
            if (Util.IsNullEmpty(msg.j as any)) { msg.j = false; }
            msg = await Config.db.InsertOrUpdateOne(msg);
        } catch (error) {
            if (Util.IsNullUndefinded(msg)) { (msg as any) = {}; }
            msg.error = error.toString();
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
    private async DeleteOne(cli: WebSocketClient): Promise<void> {
        this.Reply();
        var msg: DeleteOneMessage
        try {
            msg = DeleteOneMessage.assign(this.data);
            if (Util.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            await Config.db.DeleteOne(msg._id, msg.collectionname, msg.jwt);
        } catch (error) {
            if (Util.IsNullUndefinded(msg)) { (msg as any) = {}; }
            msg.error = error.toString();
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
    private async MapReduce(cli: WebSocketClient): Promise<void> {
        this.Reply();
        var msg: MapReduceMessage<any>
        try {
            msg = MapReduceMessage.assign(this.data);
            if (Util.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            msg.result = await Config.db.MapReduce(msg.map, msg.reduce, msg.finalize, msg.query, msg.out, msg.collectionname, msg.scope, msg.jwt);
        } catch (error) {
            if (Util.IsNullUndefinded(msg)) { (msg as any) = {}; }
            msg.error = error.toString();
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

    private async Signin(cli: WebSocketClient): Promise<void> {
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
                user = await User.FindByUsername(tuser.username);
                if (user !== null && user !== undefined) {
                    // refresh, for roles and stuff
                    tuser = new TokenUser(user);
                } else { // Autocreate user .... safe ?? we use this for autocreating nodered service accounts
                    if (Config.auto_create_users == true) {
                        var jwt: string = TokenUser.rootToken();
                        user = await User.ensureUser(jwt, tuser.name, tuser.username, null, msg.password);
                        tuser = new TokenUser(user);
                    } else {
                        msg.error = "Unknown username or password";
                    }
                }
                if (impostor !== "") {
                    tuser.impostor = msg.impersonate;
                }
                // } else if (tuser.username.startsWith("nodered")) {
                //     user = new User(); user.name = tuser.name; user.username = tuser.username;
                //     await user.Save(TokenUser.rootToken());
                //     tuser = new TokenUser(user);
                // } else {
                //     msg.error = "Unknown username or password";
                // }
            } else if (msg.rawAssertion !== null && msg.rawAssertion !== undefined) {
                type = "samltoken";
                user = await LoginProvider.validateToken(msg.rawAssertion);
                if (user !== null && user != undefined) { tuser = new TokenUser(user); }
                msg.rawAssertion = "";
            } else {
                user = await Auth.ValidateByPassword(msg.username, msg.password);
                tuser = new TokenUser(user);
            }
            if (user === null || user === undefined || tuser === null || tuser === undefined) {
                msg.error = "Unknown username or password";
                Audit.LoginFailed(tuser.username, type, "websocket", cli.remoteip);
                cli._logger.debug(tuser.username + " failed logging in using " + type);
            } else {
                Audit.LoginSuccess(tuser, type, "websocket", cli.remoteip);
                var userid: string = user._id;
                msg.jwt = Crypt.createToken(tuser, "5m");
                msg.user = tuser;
                if (msg.impersonate !== undefined && msg.impersonate !== null && msg.impersonate !== "") {
                    var items = await Config.db.query({ _id: msg.impersonate }, null, 1, 0, null, "users", msg.jwt);
                    if (items.length == 0) {
                        Audit.ImpersonateFailed(tuser, msg.impersonate);
                        throw new Error("Permission denied, impersonating " + msg.impersonate);
                    }
                    var tuserimpostor = tuser;
                    user = User.assign(items[0] as User);
                    await user.DecorateWithRoles();
                    // Check we have update rights
                    await user.Save(msg.jwt);
                    tuser = new TokenUser(user);
                    tuser.impostor = userid;
                    msg.jwt = Crypt.createToken(tuser, "5m");
                    msg.user = tuser;
                    Audit.ImpersonateSuccess(tuser, tuserimpostor);
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
                    // cli.jwt = Crypt.createToken(cli.user, "5m");
                }
                if (msg.impersonate === undefined || msg.impersonate === null && msg.impersonate === "") {
                    user.lastseen = new Date(new Date().toISOString());
                }
                await user.Save(TokenUser.rootToken());
            }
        } catch (error) {
            if (Util.IsNullUndefinded(msg)) { (msg as any) = {}; }
            msg.error = error.toString();
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
    private async RegisterUser(cli: WebSocketClient): Promise<void> {
        this.Reply();
        var msg: RegisterUserMessage;
        var user: User;
        try {
            msg = RegisterUserMessage.assign(this.data);
            if (msg.name == null || msg.name == undefined || msg.name == "") { throw new Error("Name cannot be null"); }
            if (msg.username == null || msg.username == undefined || msg.username == "") { throw new Error("Username cannot be null"); }
            if (msg.password == null || msg.password == undefined || msg.password == "") { throw new Error("Password cannot be null"); }
            user = await User.FindByUsername(msg.username);
            if (user !== null && user !== undefined) { throw new Error("Illegal username"); }
            var jwt: string = TokenUser.rootToken();
            user = await User.ensureUser(jwt, msg.name, msg.username, null, msg.password);
            msg.user = new TokenUser(user);

            jwt = Crypt.createToken(msg.user, "5m");
            var name = user.username;
            name = name.split("@").join("").split(".").join("");
            name = name.toLowerCase();

            cli._logger.debug("[" + user.username + "] ensure nodered role " + name + "noderedadmins");
            var noderedadmins = await User.ensureRole(jwt, name + "noderedadmins", null);
            noderedadmins.addRight(user._id, user.username, [Rights.full_control]);
            noderedadmins.removeRight(user._id, [Rights.delete]);
            noderedadmins.AddMember(user);
            cli._logger.debug("[" + user.username + "] update nodered role " + name + "noderedadmins");
            await noderedadmins.Save(jwt);

        } catch (error) {
            if (Util.IsNullUndefinded(msg)) { (msg as any) = {}; }
            msg.error = error.toString();
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

    private async EnsureNoderedInstance(cli: WebSocketClient): Promise<void> {
        this.Reply();
        var msg: EnsureNoderedInstanceMessage;
        var user: User;
        try {
            cli._logger.debug("[" + cli.user.username + "] EnsureNoderedInstance");
            msg = EnsureNoderedInstanceMessage.assign(this.data);
            var name = cli.user.username;
            if (msg.name !== null && msg.name !== undefined && msg.name !== "" && msg.name != cli.user.username) {
                var exists = User.FindByUsername(msg.name, cli.jwt);
                if (exists == null) { throw new Error("Unknown name " + msg.name) }
                name = msg.name;
            }
            name = name.split("@").join("").split(".").join("");
            name = name.toLowerCase();
            var namespace = Config.namespace;
            var hostname = Config.nodered_domain_schema.replace("$nodered_id$", name);
            var queue_prefix: string = "";
            if (Config.force_queue_prefix) {
                queue_prefix = cli.user.username;
            }

            var tuser: TokenUser = new TokenUser(cli.user);
            var nodered_jwt: string = Crypt.createToken(tuser, "365d");

            // var noderedusers = await User.ensureRole(cli.jwt, name + "noderedusers", null);
            // noderedusers.addRight(cli.user._id, cli.user.username, [Rights.full_control]);
            // noderedusers.removeRight(cli.user._id, [Rights.delete]);
            // noderedusers.AddMember(cli.user);
            // var nodereduser: User = await User.ensureUser(cli.jwt, "nodered" + name, "nodered" + name, null);
            // nodereduser.addRight(cli.user._id, cli.user.username, [Rights.full_control]);
            // nodereduser.removeRight(cli.user._id, [Rights.delete]);
            // await nodereduser.Save(cli.jwt);

            cli._logger.debug("[" + cli.user.username + "] ensure nodered role " + name + "noderedadmins");
            var noderedadmins = await User.ensureRole(cli.jwt, name + "noderedadmins", null);
            noderedadmins.addRight(cli.user._id, cli.user.username, [Rights.full_control]);
            noderedadmins.removeRight(cli.user._id, [Rights.delete]);
            noderedadmins.AddMember(cli.user);
            // noderedadmins.addRight(nodereduser._id, nodereduser.username, [Rights.full_control]);
            // noderedadmins.removeRight(nodereduser._id, [Rights.delete]);
            // noderedadmins.AddMember(nodereduser);
            cli._logger.debug("[" + cli.user.username + "] update nodered role " + name + "noderedadmins");
            await noderedadmins.Save(cli.jwt);

            cli._logger.debug("[" + cli.user.username + "] GetDeployments");
            var deployment = await KubeUtil.instance().GetDeployment(namespace, name);
            if (deployment == null) {
                cli._logger.debug("[" + cli.user.username + "] Deployment " + name + " not found in " + namespace + " so creating it");
                var _deployment = {
                    metadata: { name: name, namespace: namespace, app: name },
                    spec: {
                        replicas: 1,
                        template: {
                            metadata: { labels: { name: name, app: name } },
                            spec: {
                                containers: [
                                    {
                                        name: 'nodered',
                                        image: Config.nodered_image,
                                        imagePullPolicy: "Always",
                                        ports: [{ containerPort: 80 }, { containerPort: 5858 }],
                                        env: [
                                            { name: "saml_federation_metadata", value: Config.saml_federation_metadata },
                                            { name: "saml_issuer", value: Config.saml_issuer },
                                            { name: "saml_baseurl", value: Config.protocol + "://" + hostname + "/" },
                                            { name: "nodered_id", value: name },
                                            { name: "nodered_sa", value: cli.user.username },
                                            { name: "jwt", value: nodered_jwt },
                                            { name: "queue_prefix", value: queue_prefix },
                                            { name: "api_ws_url", value: Config.api_ws_url },
                                            { name: "amqp_url", value: Config.amqp_url },
                                            { name: "nodered_domain_schema", value: hostname },
                                            { name: "domain", value: hostname },
                                            { name: "protocol", value: Config.protocol },
                                            { name: "port", value: Config.port.toString() },
                                            { name: "noderedusers", value: (name + "noderedusers") },
                                            { name: "noderedadmins", value: (name + "noderedadmins") },
                                        ],
                                        livenessProbe: {
                                            httpGet: {
                                                path: "/",
                                                port: 80,
                                                scheme: "HTTP"
                                            },
                                            initialDelaySeconds: 30,
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
                await KubeUtil.instance().ExtensionsV1beta1Api.createNamespacedDeployment(namespace, (_deployment as any));
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
                msg.error = "failed locating useringress";
            }
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
            //msg.error = JSON.stringify(error, null, 2);
            msg.error = "Request failed!"
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }
    private async DeleteNoderedInstance(cli: WebSocketClient): Promise<void> {
        this.Reply();
        var msg: DeleteNoderedInstanceMessage;
        var user: User;
        try {
            cli._logger.debug("[" + cli.user.username + "] DeleteNoderedInstance");
            msg = DeleteNoderedInstanceMessage.assign(this.data);
            var name = cli.user.username;
            if (msg.name !== null && msg.name !== undefined && msg.name !== "" && msg.name != cli.user.username) {
                var exists = User.FindByUsername(msg.name, cli.jwt);
                if (exists == null) { throw new Error("Unknown name " + msg.name) }
                name = msg.name;
            }
            name = name.split("@").join("").split(".").join("");
            name = name.toLowerCase();
            var namespace = Config.namespace;
            var hostname = Config.nodered_domain_schema.replace("$nodered_id$", name);

            // for now, lets not delete role
            // var role: Role = await Role.FindByNameOrId(name + "noderedadmins", null);
            // if (role !== null) {
            //     var jwt: string = TokenUser.rootToken();
            //     await Config.db.DeleteOne(role._id, "users", jwt);
            // }
            var deployment = await KubeUtil.instance().GetDeployment(namespace, name);
            if (deployment != null) {
                await KubeUtil.instance().ExtensionsV1beta1Api.deleteNamespacedDeployment(name, namespace);
            }
            var service = await KubeUtil.instance().GetService(namespace, name);
            if (service != null) {
                await KubeUtil.instance().CoreV1Api.deleteNamespacedService(name, namespace);
            }
            var replicaset = await KubeUtil.instance().GetReplicaset(namespace, "app", name);
            if (replicaset !== null) {
                KubeUtil.instance().AppsV1Api.deleteNamespacedReplicaSet(replicaset.metadata.name, namespace);
            }
            // var list = await KubeUtil.instance().CoreV1Api.listNamespacedPod(namespace);
            // for (var i = 0; i < list.body.items.length; i++) {
            //     var item = list.body.items[i];
            //     // if (item.metadata.labels.app === name || item.metadata.labels.name === name) {
            //     if (item.metadata.labels.app === name) {
            //         await KubeUtil.instance().CoreV1Api.deleteNamespacedPod(item.metadata.name, namespace);
            //     }
            // }
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
                cli._logger.error("[" + cli.user.username + "] failed locating useringress");
                msg.error = "failed locating useringress";
            }
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
            //msg.error = JSON.stringify(error, null, 2);
            msg.error = "Request failed!"
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }
    private async RestartNoderedInstance(cli: WebSocketClient): Promise<void> {
        this.Reply();
        var msg: RestartNoderedInstanceMessage;
        try {
            cli._logger.debug("[" + cli.user.username + "] RestartNoderedInstance");
            msg = RestartNoderedInstanceMessage.assign(this.data);
            var name = cli.user.username;
            if (msg.name !== null && msg.name !== undefined && msg.name !== "" && msg.name != cli.user.username) {
                var exists = User.FindByUsername(msg.name, cli.jwt);
                if (exists == null) { throw new Error("Unknown name " + msg.name) }
                name = msg.name;
            }
            name = name.split("@").join("").split(".").join("");
            name = name.toLowerCase();
            var namespace = Config.namespace;
            // var hostname = Config.nodered_domain_schema.replace("$nodered_id$", name);

            var list = await KubeUtil.instance().CoreV1Api.listNamespacedPod(namespace);
            for (var i = 0; i < list.body.items.length; i++) {
                var item = list.body.items[i];
                // if (item.metadata.labels.app === name || item.metadata.labels.name === name) {
                if (item.metadata.labels.app === name) {
                    await KubeUtil.instance().CoreV1Api.deleteNamespacedPod(item.metadata.name, namespace);
                }
            }
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
            //msg.error = JSON.stringify(error, null, 2);
            msg.error = "Request failed!"
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }
    private async GetNoderedInstance(cli: WebSocketClient): Promise<void> {
        this.Reply();
        var msg: GetNoderedInstanceMessage;
        try {
            cli._logger.debug("[" + cli.user.username + "] GetNoderedInstance");
            msg = GetNoderedInstanceMessage.assign(this.data);
            var name = cli.user.username;
            if (msg.name !== null && msg.name !== undefined && msg.name !== "" && msg.name != cli.user.username) {
                var exists = User.FindByUsername(msg.name, cli.jwt);
                if (exists == null) { throw new Error("Unknown name " + msg.name) }
                name = msg.name;
            }
            name = name.split("@").join("").split(".").join("");
            name = name.toLowerCase();
            var namespace = Config.namespace;
            // var hostname = Config.nodered_domain_schema.replace("$nodered_id$", name);

            var list = await KubeUtil.instance().CoreV1Api.listNamespacedPod(namespace);

            var found: any = null;
            msg.result = null;
            if (list.body.items.length > 0) {
                for (var i = 0; i < list.body.items.length; i++) {
                    var item = list.body.items[i];
                    if (item.metadata.labels.app === name) {
                        found = item;
                        if (item.status.phase != "Failed") {
                            msg.result = item;
                            cli._logger.debug("[" + cli.user.username + "] GetNoderedInstance:" + name + " found one");
                        }
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
            msg.error = "Request failed!"
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }
    private async GetNoderedInstanceLog(cli: WebSocketClient): Promise<void> {
        this.Reply();
        var msg: GetNoderedInstanceLogMessage;
        try {
            cli._logger.debug("[" + cli.user.username + "] GetNoderedInstance");
            msg = GetNoderedInstanceLogMessage.assign(this.data);
            var name = cli.user.username;
            if (msg.name !== null && msg.name !== undefined && msg.name !== "" && msg.name != cli.user.username) {
                var exists = User.FindByUsername(msg.name, cli.jwt);
                if (exists == null) { throw new Error("Unknown name " + msg.name) }
                name = msg.name;
            }
            name = name.split("@").join("").split(".").join("");
            name = name.toLowerCase();
            var namespace = Config.namespace;


            var list = await KubeUtil.instance().CoreV1Api.listNamespacedPod(namespace);

            if (list.body.items.length > 0) {
                for (var i = 0; i < list.body.items.length; i++) {
                    var item = list.body.items[i];
                    if (item.metadata.labels.app === name) {
                        cli._logger.debug("[" + cli.user.username + "] GetNoderedInstance:" + name + " found one as " + item.metadata.name);
                        var obj = await await KubeUtil.instance().CoreV1Api.readNamespacedPodLog(item.metadata.name, namespace, "", false);
                        msg.result = obj.body;
                    }
                }
            }



        } catch (error) {
            this.data = "";
            cli._logger.error(error);
            //msg.error = JSON.stringify(error, null, 2);
            msg.error = "Request failed!"
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            cli._logger.error(error);
        }
        this.Send(cli);
    }
    private async StartNoderedInstance(cli: WebSocketClient): Promise<void> {
        this.Reply();
        this.Send(cli);
    }
    private async StopNoderedInstance(cli: WebSocketClient): Promise<void> {
        this.Reply();
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
    private async SaveFile(cli: WebSocketClient): Promise<void> {
        this.Reply();
        var msg: SaveFileMessage
        try {
            msg = SaveFileMessage.assign(this.data);
            if (Util.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            if (Util.IsNullEmpty(msg.filename)) throw new Error("Filename is mandatory");
            // if (Util.IsNullEmpty(msg.mimeType)) throw new Error("mimeTypes is mandatory");
            if (Util.IsNullEmpty(msg.file)) throw new Error("file is mandatory");
            if (process.platform === "win32") {
                msg.filename = msg.filename.replace(/\//g, "\\");
            }
            else {
                msg.filename = msg.filename.replace(/\\/g, "/");
            }

            if (Util.IsNullEmpty(msg.mimeType)) {
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
            if (Util.IsNullUndefinded(msg.metadata._acl)) {
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
            if (Util.IsNullEmpty(msg.metadata.name)) {
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
            if (!Config.db.hasAuthorization(user, msg.metadata, Rights.create)) { throw new Error("Access denied"); }
            msg.id = await this._SaveFile(readable, msg.filename, msg.mimeType, msg.metadata);
        } catch (error) {
            if (Util.IsNullUndefinded(msg)) { (msg as any) = {}; }
            msg.error = error.toString();
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
    private async GetFile(cli: WebSocketClient): Promise<void> {
        this.Reply();
        var msg: GetFileMessage
        try {
            msg = SaveFileMessage.assign(this.data);
            if (Util.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            if (!Util.IsNullEmpty(msg.id)) {
                var rows = await Config.db.query({ _id: safeObjectID(msg.id) }, null, 1, 0, null, "files", msg.jwt);
                if (rows.length == 0) { throw new Error("Not found"); }
                msg.metadata = (rows[0] as any).metadata
                msg.mimeType = (rows[0] as any).contentType;
            } else if (!Util.IsNullEmpty(msg.filename)) {
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
            if (Util.IsNullUndefinded(msg)) { (msg as any) = {}; }
            msg.error = error.toString();
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
    private async UpdateFile(cli: WebSocketClient): Promise<void> {
        this.Reply();
        var msg: UpdateFileMessage
        try {
            msg = UpdateFileMessage.assign(this.data);
            if (Util.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }

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
            if (!Config.db.hasAuthorization(user, msg.metadata, Rights.update)) { throw new Error("Access denied"); }

            msg.metadata = Config.db.ensureResource(msg.metadata);
            var fsc = Config.db.db.collection("fs.files");
            DatabaseConnection.traversejsonencode(msg.metadata);
            var res = await fsc.updateOne(q, { $set: { metadata: msg.metadata } });

        } catch (error) {
            if (Util.IsNullUndefinded(msg)) { (msg as any) = {}; }
            msg.error = error.toString();
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