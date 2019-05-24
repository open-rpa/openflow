import * as crypto from "crypto";
import { SocketMessage } from "../SocketMessage";
import { WebSocketClient, QueuedMessage } from "../WebSocketClient";
import { QueryMessage } from "./QueryMessage";
import { Base } from "../base";
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
        if (command !== null && command !== undefined) { this.command = command; }
        this.replyto = this.id;
        this.id = crypto.randomBytes(16).toString("hex");
    }
    public Process(cli: WebSocketClient): void {
        try {
            var command: string = "";
            if (this.command !== null && this.command !== undefined) { command = this.command.toLowerCase(); }
            if (this.command !== "ping" && this.command !== "pong") {
                if (this.replyto !== null && this.replyto !== undefined) {
                    var qmsg: QueuedMessage = cli.messageQueue[this.replyto];
                    if (qmsg !== undefined && qmsg !== null) {
                        try {
                            qmsg.message = Object.assign(qmsg.message, JSON.parse(this.data));
                        } catch (error) {
                            // TODO: should we set message to data ?
                        }
                        if (qmsg.cb !== undefined && qmsg.cb !== null) { qmsg.cb(qmsg.message); }
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
                default:
                    this.UnknownCommand(cli);
                    break;
            }
        } catch (error) {
            console.error(error);
        }
    }
    async RegisterQueue(cli: WebSocketClient) {
        this.Reply();
        var msg: RegisterQueueMessage<Base> = RegisterQueueMessage.assign(this.data);
        try {
            var jwt = cli.jwt;
            if (msg.jwt != null && msg.jwt != undefined) { jwt = msg.jwt; }
            await cli.CreateConsumer(msg.queuename);
        } catch (error) {
            cli._logger.error(error);
            msg.error = error.toString();
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            msg.error = error.toString();
        }
        this.Send(cli);
    }
    async QueueMessage(cli: WebSocketClient) {
        this.Reply();
        console.log("#*********************************************#");
        var msg: QueueMessage = QueueMessage.assign(this.data);
        try {
            //
            if (msg.replyto === null || msg.replyto === undefined || msg.replyto === "") {
                console.log("# sendToQueue");
                await cli.sendToQueue(msg);
            } else {
                if (msg.queuename === msg.replyto) {
                    cli._logger.warn("Ignore reply to self queuename:" + msg.queuename + " correlationId:" + msg.correlationId);
                    return
                }
                this.replyto = msg.correlationId;
                console.log("# sendQueueReply");
                await cli.sendQueueReply(msg);
            }
        } catch (error) {
            cli._logger.error(error);
            msg.error = error.toString();
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            msg.error = error.toString();
        }
        console.log("# send reply");
        this.Send(cli);
        console.log("#*********************************************#");
        // if(this.replyto !== null && this.replyto !== undefined && this.replyto !== "") {  
        // }
    }
    async CloseQueue(cli: WebSocketClient) {
        this.Reply();
        var msg: CloseQueueMessage<Base> = CloseQueueMessage.assign(this.data);
        try {
            var jwt = cli.jwt;
            if (msg.jwt != null && msg.jwt != undefined) { jwt = msg.jwt; }
            await cli.CloseConsumer(msg.queuename);
        } catch (error) {
            cli._logger.error(error);
            msg.error = error.toString();
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            msg.error = error.toString();
        }
        this.Send(cli);
    }
    public Send(cli: WebSocketClient): void {
        cli.Send(this);
    }
    private UnknownCommand(cli: WebSocketClient): void {
        this.Reply("error");
        this.data = "Unknown command";
        cli._logger.error(this.data);
        this.Send(cli);
    }
    private Ping(cli: WebSocketClient): void {
        this.Reply("pong");
        this.Send(cli);
    }
    private async Query(cli: WebSocketClient): Promise<void> {
        this.Reply();
        var msg: QueryMessage<Base> = QueryMessage.assign(this.data);
        try {
            var jwt = cli.jwt;
            if (msg.jwt != null && msg.jwt != undefined) { jwt = msg.jwt; }
            msg.result = await Config.db.query(msg.query, msg.projection, msg.top, msg.skip, msg.orderby, msg.collectionname, jwt);
        } catch (error) {
            cli._logger.error(error);
            msg.error = error.toString();
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            msg.error = error.toString();
        }
        this.Send(cli);
    }
    private async Aggregate(cli: WebSocketClient): Promise<void> {
        this.Reply();
        var msg: AggregateMessage<Base> = AggregateMessage.assign(this.data);
        try {
            var jwt = cli.jwt;
            if (msg.jwt != null && msg.jwt != undefined) { jwt = msg.jwt; }
            msg.result = await Config.db.aggregate(msg.aggregates, msg.collectionname, jwt);
        } catch (error) {
            msg.error = error.toString();
            cli._logger.error(error);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            msg.error = error.toString();
        }
        this.Send(cli);
    }
    private async InsertOne(cli: WebSocketClient): Promise<void> {
        this.Reply();
        var msg: InsertOneMessage<Base> = InsertOneMessage.assign(this.data);
        try {
            var jwt = cli.jwt;
            if (msg.jwt != null && msg.jwt != undefined) { jwt = msg.jwt; }
            msg.result = await Config.db.InsertOne(msg.item, msg.collectionname, jwt);
        } catch (error) {
            msg.error = error.toString();
            cli._logger.error(error);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            msg.error = error.toString();
        }
        this.Send(cli);
    }
    private async UpdateOne(cli: WebSocketClient): Promise<void> {
        this.Reply();
        var msg: UpdateOneMessage<Base> = UpdateOneMessage.assign(this.data);
        try {
            var jwt = cli.jwt;
            if (msg.jwt != null && msg.jwt != undefined) { jwt = msg.jwt; }
            msg.result = await Config.db.UpdateOne(msg.item, msg.collectionname, jwt);
        } catch (error) {
            msg.error = error.toString();
            cli._logger.error(error);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            msg.error = error.toString();
        }
        this.Send(cli);
    }
    private async InsertOrUpdateOne(cli: WebSocketClient): Promise<void> {
        this.Reply();
        var msg: InsertOrUpdateOneMessage<Base> = InsertOrUpdateOneMessage.assign(this.data);
        try {
            var jwt = cli.jwt;
            if (msg.jwt != null && msg.jwt != undefined) { jwt = msg.jwt; }
            msg.result = await Config.db.InsertOrUpdateOne(msg.item, msg.collectionname, msg.uniqeness, jwt);
        } catch (error) {
            msg.error = error.toString();
            cli._logger.error(error);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            msg.error = error.toString();
        }
        this.Send(cli);
    }
    private async DeleteOne(cli: WebSocketClient): Promise<void> {
        this.Reply();
        var msg: DeleteOneMessage = DeleteOneMessage.assign(this.data);
        try {
            var jwt = cli.jwt;
            if (msg.jwt != null && msg.jwt != undefined) { jwt = msg.jwt; }
            await Config.db.DeleteOne(msg._id, msg.collectionname, jwt);
        } catch (error) {
            msg.error = error.toString();
            cli._logger.error(error);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            msg.error = error.toString();
        }
        this.Send(cli);
    }
    private async MapReduce(cli: WebSocketClient): Promise<void> {
        this.Reply();
        var msg: MapReduceMessage<any> = MapReduceMessage.assign(this.data);
        try {
            var jwt = cli.jwt;
            if (msg.jwt != null && msg.jwt != undefined) { jwt = msg.jwt; }
            msg.result = await Config.db.MapReduce(msg.map, msg.reduce, msg.finalize, msg.query, msg.out, msg.collectionname, msg.scope, jwt);
        } catch (error) {
            msg.error = error.toString();
            cli._logger.error(error);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            msg.error = error.toString();
        }
        this.Send(cli);
    }

    private async Signin(cli: WebSocketClient): Promise<void> {
        this.Reply();
        var msg: SigninMessage = SigninMessage.assign(this.data);
        try {
            var tuser: TokenUser = null;
            var user: User = null;
            var type: string = "local";
            if (msg.jwt !== null && msg.jwt !== undefined) {
                type = "jwtsignin";
                tuser = Crypt.verityToken(msg.jwt);
                user = await User.FindByUsername(tuser.username);
                if (user !== null && user !== undefined) {
                    // refresh, for roles and stuff
                    tuser = new TokenUser(user);
                } else if (tuser.username.startsWith("nodered")) {
                    user = new User(); user.name = tuser.name; user.username = tuser.username;
                    await user.Save(TokenUser.rootToken());
                    tuser = new TokenUser(user);
                } else {
                    msg.error = "Unknown username or password";
                }
            } else if (msg.rawAssertion !== null && msg.rawAssertion !== undefined) {
                type = "samltoken";
                user = await LoginProvider.validateToken(msg.rawAssertion);
                if (user !== null && user != undefined) { tuser = new TokenUser(user); }
                msg.rawAssertion = "";
            } else {
                user = await Auth.ValidateByPassword(msg.username, msg.password);
                tuser = new TokenUser(user);
            }
            if (user === null || user === undefined) {
                msg.error = "Unknown username or password";
                Audit.LoginFailed(tuser.username, type, "websocket", cli.remoteip);
                cli._logger.debug(tuser.username + " failed logging in using " + type);
            } else {
                if (msg.firebasetoken != null && msg.firebasetoken != undefined && msg.firebasetoken != "") {
                    user.firebasetoken = msg.firebasetoken;
                }
                if (msg.onesignalid != null && msg.onesignalid != undefined && msg.onesignalid != "") {
                    user.onesignalid = msg.onesignalid;
                }
                if ((msg.onesignalid != null && msg.onesignalid != undefined && msg.onesignalid != "") ||
                    (msg.onesignalid != null && msg.onesignalid != undefined && msg.onesignalid != "")) {
                    await user.Save(msg.jwt);
                }
                Audit.LoginSuccess(tuser, type, "websocket", cli.remoteip);
                msg.jwt = Crypt.createToken(user);
                msg.user = tuser;
                if (msg.validate_only !== true) {
                    cli._logger.debug(tuser.username + " signed in using " + type);
                    cli.jwt = msg.jwt;
                    cli.user = user;
                } else {
                    cli._logger.debug(tuser.username + " was validted in using " + type);
                }
            }
        } catch (error) {
            msg.error = error.toString();
            cli._logger.error(error);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            msg.error = error.toString();
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
            user = await User.ensureUser(msg.name, msg.username, msg.password, null);
            msg.user = new TokenUser(user);
        } catch (error) {
            msg.error = error.toString();
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            msg.error = error.toString();
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