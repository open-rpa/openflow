import * as os from "os";
const Docker = require("dockerode");
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
import { GridFSBucket, ObjectID, Cursor } from "mongodb";
import * as path from "path";
import { DatabaseConnection } from "../DatabaseConnection";
import { StripeMessage, EnsureStripeCustomerMessage, NoderedUtil, QueuedMessage, RegisterQueueMessage, QueueMessage, CloseQueueMessage, ListCollectionsMessage, DropCollectionMessage, QueryMessage, AggregateMessage, InsertOneMessage, UpdateOneMessage, Base, UpdateManyMessage, InsertOrUpdateOneMessage, DeleteOneMessage, MapReduceMessage, SigninMessage, TokenUser, User, Rights, EnsureNoderedInstanceMessage, DeleteNoderedInstanceMessage, DeleteNoderedPodMessage, RestartNoderedInstanceMessage, GetNoderedInstanceMessage, GetNoderedInstanceLogMessage, SaveFileMessage, WellknownIds, GetFileMessage, UpdateFileMessage, CreateWorkflowInstanceMessage, RegisterUserMessage, NoderedUser, WatchMessage, GetDocumentVersionMessage, DeleteManyMessage, InsertManyMessage, GetKubeNodeLabels, RegisterExchangeMessage, EnsureCustomerMessage, Customer, stripe_tax_id } from "@openiap/openflow-api";
import { Billing, stripe_customer, stripe_base, stripe_list, StripeAddPlanMessage, StripeCancelPlanMessage, stripe_subscription, stripe_subscription_item, stripe_plan, stripe_coupon } from "@openiap/openflow-api";
import { V1ResourceRequirements, V1Deployment } from "@kubernetes/client-node";
import { amqpwrapper } from "../amqpwrapper";
import { WebSocketServerClient } from "../WebSocketServerClient";
import { DBHelper } from "../DBHelper";
import { WebSocketServer } from "../WebSocketServer";
import { OAuthProvider } from "../OAuthProvider";
import { Span } from "@opentelemetry/api";
import { Logger } from "../Logger";
import Dockerode = require("dockerode");
import { QueueClient } from "../QueueClient";
const request = require("request");
const got = require("got");
const { RateLimiterMemory } = require('rate-limiter-flexible')
const BaseRateLimiter = new RateLimiterMemory({
    points: Config.socket_rate_limit_points,
    duration: Config.socket_rate_limit_duration,
});
const ErrorRateLimiter = new RateLimiterMemory({
    points: Config.socket_error_rate_limit_points,
    duration: Config.socket_error_rate_limit_duration,
});

let errorcounter: number = 0;
var _hostname = "";
async function handleError(cli: WebSocketServerClient, error: Error) {
    try {
        if (cli == null) {
            if (_hostname == "DESKTOP-HRNQ2GL" && false) {
                Logger.instanse.error(error.message ? error.message : error);
            } else {
                Logger.instanse.error(error);
            }
            return;
        }
        if (NoderedUtil.IsNullEmpty(_hostname)) _hostname = (Config.getEnv("HOSTNAME", undefined) || os.hostname()) || "unknown";
        errorcounter++;
        if (!NoderedUtil.IsNullUndefinded(WebSocketServer.websocket_errors)) WebSocketServer.websocket_errors.bind({ ...Logger.otel.defaultlabels }).update(errorcounter);
        if (Config.socket_rate_limit) await ErrorRateLimiter.consume(cli.id);
        if (_hostname == "DESKTOP-HRNQ2GL" && false) {
            Logger.instanse.error(error.message ? error.message : error);
        } else {
            Logger.instanse.error(error);
        }
    } catch (error) {
        if (error.consumedPoints) {
            let username: string = "Unknown";
            if (!NoderedUtil.IsNullUndefinded(cli.user)) { username = cli.user.username; }
            Logger.instanse.debug("[" + username + "/" + cli.clientagent + "/" + cli.id + "] SOCKET_ERROR_RATE_LIMIT: Disconnecing client ! consumedPoints: " + error.consumedPoints + " remainingPoints: " + error.remainingPoints + " msBeforeNext: " + error.msBeforeNext);
            cli.devnull = true;
            cli.Close();
        }
    }

}

const safeObjectID = (s: string | number | ObjectID) => ObjectID.isValid(s) ? new ObjectID(s) : null;
export class Message {
    public id: string;
    public replyto: string;
    public command: string;
    public data: string;
    public jwt: string;
    public correlationId: string;
    public cb: any;
    public priority: number = 1;
    public async QueueProcess(cli: QueueClient, parent: Span): Promise<void> {
        let span: Span = undefined;
        try {
            const ot_end = Logger.otel.startTimer();
            span = Logger.otel.startSubSpan("QueueProcessMessage " + this.command, parent);
            span.setAttribute("command", this.command);
            span.setAttribute("id", this.id);
            switch (this.command) {
                case "listcollections":
                    await this.ListCollections(span);
                    break;
                case "dropcollection":
                    await this.DropCollection(span);
                    break;
                case "query":
                    await this.Query(span);
                    break;
                case "getdocumentversion":
                    await this.GetDocumentVersion(span);
                    break;
                case "aggregate":
                    await this.Aggregate(span);
                    break;
                case "insertone":
                    await this.InsertOne(span);
                    break;
                case "insertmany":
                    await this.InsertMany(span);
                    break;
                case "updateone":
                    await this.UpdateOne(span);
                    break;
                case "updatemany":
                    await this.UpdateMany(span);
                    break;
                case "insertorupdateone":
                    await this.InsertOrUpdateOne(span);
                    break;
                case "deleteone":
                    await this.DeleteOne(span);
                    break;
                case "deletemany":
                    await this.DeleteMany(span);
                    break;
                case "ensurenoderedinstance":
                    await this.EnsureNoderedInstance(span);
                    break;
                case "deletenoderedinstance":
                    await this.DeleteNoderedInstance(span);
                    break;
                case "restartnoderedinstance":
                    await this.RestartNoderedInstance(span);
                    break;
                case "deletenoderedpod":
                    await this.DeleteNoderedPod(span);
                    break;
                case "getnoderedinstance":
                    await this.GetNoderedInstance(span);
                    break;
                default:
                    span.recordException("Unknown command " + this.command);
                    this.UnknownCommand();
                    break;
            }
            if (!NoderedUtil.IsNullUndefinded(WebSocketServer.websocket_messages)) Logger.otel.endTimer(ot_end, WebSocketServer.websocket_messages, { command: this.command });
        } catch (error) {
            Logger.instanse.error(error);
            span.recordException(error);
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public static fromcommand(command: string): Message {
        const result: Message = new Message();
        result.command = command;
        result.id = NoderedUtil.GetUniqueIdentifier();
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
    public static fromjson(json: string): Message {
        const result: Message = new Message();
        let data: any = json;
        if (typeof data == 'string') data = JSON.parse(json);
        result.id = data.id;
        result.replyto = data.replyto;
        result.command = data.command;
        result.data = data.data;
        result.jwt = data.jwt;
        return result;
    }
    public Reply(command: string = null): void {
        if (!NoderedUtil.IsNullEmpty(command)) { this.command = command; }
        this.replyto = this.id;
        this.id = NoderedUtil.GetUniqueIdentifier();
    }

    public EnsureJWT(cli: WebSocketServerClient) {
        if (!NoderedUtil.IsNullUndefinded(this.data)) {
            var obj: any = this.data;
            if (typeof obj == "string") obj = JSON.parse(obj);
            if (!NoderedUtil.IsNullEmpty(obj.jwt)) {
                this.jwt = obj.jwt; delete obj.jwt;
                this.data = JSON.stringify(obj);
            }
        }
        if (NoderedUtil.IsNullEmpty(this.jwt)) this.jwt = cli.jwt;
        if (NoderedUtil.IsNullEmpty(this.jwt)) {
            console.warn("no jwt");
        }
    }
    public async Process(cli: WebSocketServerClient): Promise<void> {
        if (cli.devnull) return;
        let span: Span = undefined;
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
                    if (!NoderedUtil.IsNullUndefinded(WebSocketServer.websocket_rate_limit)) WebSocketServer.websocket_rate_limit.bind({ ...Logger.otel.defaultlabels, command: command }).update(cli.inccommandcounter(command));
                    if ((error.consumedPoints % 100) == 0) Logger.instanse.debug("[" + username + "/" + cli.clientagent + "/" + cli.id + "] SOCKET_RATE_LIMIT consumedPoints: " + error.consumedPoints + " remainingPoints: " + error.remainingPoints + " msBeforeNext: " + error.msBeforeNext);
                    if (error.consumedPoints >= Config.socket_rate_limit_points_disconnect) {
                        Logger.instanse.debug("[" + username + "/" + cli.clientagent + "/" + cli.id + "] SOCKET_RATE_LIMIT: Disconnecing client ! consumedPoints: " + error.consumedPoints + " remainingPoints: " + error.remainingPoints + " msBeforeNext: " + error.msBeforeNext);
                        cli.devnull = true;
                        cli.Close();
                    }
                    setTimeout(() => { this.Process(cli); }, 250);
                }
                return;
            }

            if (!NoderedUtil.IsNullEmpty(this.replyto)) {
                span = Logger.otel.startSpan("ProcessMessageReply " + command);
                span.setAttribute("clientid", cli.id);
                span.setAttribute("command", command);
                span.setAttribute("id", this.id);
                span.setAttribute("replyto", this.replyto);
                if (!NoderedUtil.IsNullEmpty(cli.clientversion)) span.setAttribute("clientversion", cli.clientversion);
                if (!NoderedUtil.IsNullEmpty(cli.clientagent)) span.setAttribute("clientagent", cli.clientagent);
                if (!NoderedUtil.IsNullEmpty(cli.remoteip)) span.setAttribute("remoteip", cli.remoteip);
                if (!NoderedUtil.IsNullUndefinded(cli.user) && !NoderedUtil.IsNullEmpty(cli.user.username)) span.setAttribute("username", cli.user.username);
                const ot_end = Logger.otel.startTimer();
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
                if (!NoderedUtil.IsNullUndefinded(WebSocketServer.websocket_messages)) Logger.otel.endTimer(ot_end, WebSocketServer.websocket_messages, { command: command });
                // Logger.otel.endSpan(span);
                return;
            }
            const ot_end = Logger.otel.startTimer();
            span = Logger.otel.startSpan("ProcessMessage " + command);
            span.setAttribute("clientid", cli.id);
            if (!NoderedUtil.IsNullEmpty(cli.clientversion)) span.setAttribute("clientversion", cli.clientversion);
            if (!NoderedUtil.IsNullEmpty(cli.clientagent)) span.setAttribute("clientagent", cli.clientagent);
            if (!NoderedUtil.IsNullEmpty(cli.remoteip)) span.setAttribute("remoteip", cli.remoteip);
            if (!NoderedUtil.IsNullUndefinded(cli.user) && !NoderedUtil.IsNullEmpty(cli.user.username)) span.setAttribute("username", cli.user.username);
            span.setAttribute("command", command);
            span.setAttribute("id", this.id);
            switch (command) {
                case "listcollections":
                    this.EnsureJWT(cli);
                    if (Config.enable_openflow_amqp) {
                        cli.Send(await QueueClient.SendForProcessing(this, this.priority));
                    } else {
                        await this.ListCollections(span);
                        cli.Send(this);
                    }
                    break;
                case "dropcollection":
                    this.EnsureJWT(cli);
                    if (Config.enable_openflow_amqp) {
                        cli.Send(await QueueClient.SendForProcessing(this, this.priority));
                    } else {
                        await this.DropCollection(span);
                        cli.Send(this);
                    }
                    break;
                case "query":
                    this.EnsureJWT(cli);
                    if (Config.enable_openflow_amqp) {
                        cli.Send(await QueueClient.SendForProcessing(this, this.priority));
                    } else {
                        await this.Query(span);
                        cli.Send(this);
                    }
                    break;
                case "getdocumentversion":
                    this.EnsureJWT(cli);
                    if (Config.enable_openflow_amqp) {
                        cli.Send(await QueueClient.SendForProcessing(this, this.priority));
                    } else {
                        await this.GetDocumentVersion(span);
                        cli.Send(this);
                    }
                    break;
                case "aggregate":
                    this.EnsureJWT(cli);
                    if (Config.enable_openflow_amqp) {
                        cli.Send(await QueueClient.SendForProcessing(this, this.priority));
                    } else {
                        await this.Aggregate(span);
                        cli.Send(this);
                    }
                    break;
                case "watch":
                    await this.Watch(cli);
                    break;
                case "unwatch":
                    await this.UnWatch(cli);
                    break;
                case "insertone":
                    this.EnsureJWT(cli);
                    if (Config.enable_openflow_amqp) {
                        cli.Send(await QueueClient.SendForProcessing(this, this.priority));
                    } else {
                        await this.InsertOne(span);
                        cli.Send(this);
                    }
                    break;
                case "insertmany":
                    this.EnsureJWT(cli);
                    if (Config.enable_openflow_amqp) {
                        cli.Send(await QueueClient.SendForProcessing(this, this.priority));
                    } else {
                        await this.InsertMany(span);
                        cli.Send(this);
                    }
                    break;
                case "updateone":
                    this.EnsureJWT(cli);
                    if (Config.enable_openflow_amqp) {
                        cli.Send(await QueueClient.SendForProcessing(this, this.priority));
                    } else {
                        await this.UpdateOne(span);
                        cli.Send(this);
                    }
                    break;
                case "updatemany":
                    this.EnsureJWT(cli);
                    if (Config.enable_openflow_amqp) {
                        cli.Send(await QueueClient.SendForProcessing(this, this.priority));
                    } else {
                        await this.UpdateMany(span);
                        cli.Send(this);
                    }
                    break;
                case "insertorupdateone":
                    this.EnsureJWT(cli);
                    if (Config.enable_openflow_amqp) {
                        cli.Send(await QueueClient.SendForProcessing(this, this.priority));
                    } else {
                        await this.InsertOrUpdateOne(span);
                        cli.Send(this);
                    }
                    break;
                case "deleteone":
                    this.EnsureJWT(cli);
                    if (Config.enable_openflow_amqp) {
                        cli.Send(await QueueClient.SendForProcessing(this, this.priority));
                    } else {
                        await this.DeleteOne(span);
                        cli.Send(this);
                    }
                    break;
                case "deletemany":
                    this.EnsureJWT(cli);
                    if (Config.enable_openflow_amqp) {
                        cli.Send(await QueueClient.SendForProcessing(this, this.priority));
                    } else {
                        await this.DeleteMany(span);
                        cli.Send(this);
                    }
                    break;
                case "signin":
                    await this.Signin(cli, span);
                    break;
                case "registeruser":
                    await this.RegisterUser(cli, span);
                    break;
                case "mapreduce":
                    await this.MapReduce(cli);
                    break;
                case "refreshtoken":
                    break;
                case "error":
                    // this.Ping(cli);
                    break;
                case "registerqueue":
                    await this.RegisterQueue(cli, span);
                    break;
                case "registerexchange":
                    await this.RegisterExchange(cli, span);
                    break;
                case "queuemessage":
                    await this.QueueMessage(cli, span);
                    break;
                case "closequeue":
                    await this.CloseQueue(cli, span);
                    break;
                case "ensurenoderedinstance":
                    this.EnsureJWT(cli);
                    if (Config.enable_openflow_amqp) {
                        cli.Send(await QueueClient.SendForProcessing(this, this.priority));
                    } else {
                        await this.EnsureNoderedInstance(span);
                        cli.Send(this);
                    }
                    break;
                case "deletenoderedinstance":
                    this.EnsureJWT(cli);
                    if (Config.enable_openflow_amqp) {
                        cli.Send(await QueueClient.SendForProcessing(this, this.priority));
                    } else {
                        await this.DeleteNoderedInstance(span);
                        cli.Send(this);
                    }
                    break;
                case "restartnoderedinstance":
                    this.EnsureJWT(cli);
                    if (Config.enable_openflow_amqp) {
                        cli.Send(await QueueClient.SendForProcessing(this, this.priority));
                    } else {
                        await this.RestartNoderedInstance(span);
                        cli.Send(this);
                    }
                    break;
                case "getkubenodelabels":
                    await this.GetKubeNodeLabels(cli);
                    break;
                case "getnoderedinstance":
                    this.EnsureJWT(cli);
                    if (Config.enable_openflow_amqp) {
                        cli.Send(await QueueClient.SendForProcessing(this, this.priority));
                    } else {
                        await this.RestartNoderedInstance(span);
                        cli.Send(this);
                    }
                    break;
                case "getnoderedinstancelog":
                    await this.GetNoderedInstanceLog(cli, span);
                    break;
                case "startnoderedinstance":
                    await this.StartNoderedInstance(cli, span);
                    break;
                case "stopnoderedinstance":
                    await this.StopNoderedInstance(cli, span);
                    break;
                case "deletenoderedpod":
                    this.EnsureJWT(cli);
                    if (Config.enable_openflow_amqp) {
                        cli.Send(await QueueClient.SendForProcessing(this, this.priority));
                    } else {
                        await this.DeleteNoderedPod(span);
                        cli.Send(this);
                    }
                    break;
                case "savefile":
                    await this.SaveFile(cli);
                    break;
                case "getfile":
                    await this.GetFile(cli, span);
                    break;
                case "updatefile":
                    await this.UpdateFile(cli);
                    break;
                case "createworkflowinstance":
                    await this.CreateWorkflowInstance(cli, span);
                    break;
                case "stripeaddplan":
                    await this.StripeAddPlan(cli, span);
                    break;
                case "stripecancelplan":
                    await this.StripeCancelPlan(cli, span);
                    break;
                case "ensurestripecustomer":
                    await this.EnsureStripeCustomer(cli, span);
                    break;
                case "stripemessage":
                    await this.StripeMessage(cli);
                    break;
                case "dumpclients":
                    break;
                case "dumprabbitmq":
                    break;
                case "getrabbitmqqueue":
                    break;
                case "deleterabbitmqqueue":
                    break;
                case "pushmetrics":
                    break;
                case "ensurecustomer":
                    await this.EnsureCustomer(cli, span);
                case "housekeeping":
                    await this.Housekeeping(span);
                    break;
                default:
                    span.recordException("Unknown command " + command);
                    this.UnknownCommand();
                    cli.Send(this);
                    break;
            }
            if (!NoderedUtil.IsNullUndefinded(WebSocketServer.websocket_messages)) Logger.otel.endTimer(ot_end, WebSocketServer.websocket_messages, { command: command });
        } catch (error) {
            Logger.instanse.error(error);
            span.recordException(error);
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    async RegisterExchange(cli: WebSocketServerClient, parent: Span) {
        this.Reply();
        let msg: RegisterExchangeMessage;
        try {
            msg = RegisterExchangeMessage.assign(this.data);
            var res = await cli.RegisterExchange(msg.exchangename, msg.algorithm, msg.routingkey, parent);
            msg.queuename = res.queuename;
            msg.exchangename = res.exchangename;
        } catch (error) {
            await handleError(cli, error);
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            await handleError(cli, error);
        }
        this.Send(cli);
    }
    async RegisterQueue(cli: WebSocketServerClient, parent: Span) {
        this.Reply();
        let msg: RegisterQueueMessage;
        try {
            msg = RegisterQueueMessage.assign(this.data);
            if (!NoderedUtil.IsNullEmpty(msg.queuename) && msg.queuename.toLowerCase() == "openflow") {
                throw new Error("Access denied");
            }
            msg.queuename = await cli.CreateConsumer(msg.queuename, parent);
        } catch (error) {
            await handleError(cli, error);
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            await handleError(cli, error);
        }
        this.Send(cli);
    }
    async QueueMessage(cli: WebSocketServerClient, parent: Span) {
        const span: Span = Logger.otel.startSubSpan("message.QueueMessage", parent);
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
            if (!NoderedUtil.IsNullEmpty(msg.exchange) && !Config.amqp_enabled_exchange) {
                throw new Error("AMQP exchange is not enabled on this OpenFlow");
            }
            const expiration: number = (typeof msg.expiration == 'number' ? msg.expiration : Config.amqp_default_expiration);
            if (typeof msg.data === 'string' || msg.data instanceof String) {
                try {
                    msg.data = JSON.parse((msg.data as any));
                } catch (error) {
                }
            }
            if (!NoderedUtil.IsNullEmpty(msg.queuename) && msg.queuename.toLowerCase() == "openflow") {
                throw new Error("Access denied");
            } else if (NoderedUtil.IsNullEmpty(msg.queuename) && NoderedUtil.IsNullEmpty(msg.exchange)) {
                throw new Error("queuename or exchange must be given");
            }


            if (msg.queuename.length == 24 && Config.amqp_force_sender_has_read) {
                const tuser = Crypt.verityToken(msg.jwt);
                let allowed: boolean = false;
                if (tuser._id == msg.queuename) {
                    // Queue is for me
                    allowed = true;
                } else if (tuser.roles != null) {
                    // Queue is for a group i am a member of.
                    const isrole = tuser.roles.filter(x => x._id == msg.queuename);
                    if (isrole.length > 0) allowed = true;
                }
                if (!allowed) {
                    // Do i have permission to send to a queue with this id ?
                    const arr = await Config.db.query({ _id: msg.queuename }, { name: 1 }, 1, 0, null, "users", msg.jwt, undefined, undefined, span);
                    if (arr.length > 0) allowed = true;
                    if (!allowed) {
                        const arr1 = await Config.db.query({ _id: msg.queuename }, { name: 1 }, 1, 0, null, "openrpa", msg.jwt, undefined, undefined, span);
                        if (arr1.length > 0) allowed = true;
                    }
                    if (!allowed) {
                        const arr2 = await Config.db.query({ _id: msg.queuename }, { name: 1 }, 1, 0, null, "workflow", msg.jwt, undefined, undefined, span);
                        if (arr2.length > 0) allowed = true;
                    }
                }
                if (!allowed) {
                    throw new Error("Unknown queue or access denied");
                }
            }

            const sendthis: any = msg.data;
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
            if (msg.striptoken && !NoderedUtil.IsNullEmpty(msg.exchange)) {
                delete msg.jwt;
                delete msg.data.jwt;
                delete sendthis.__jwt;
            }
            if (NoderedUtil.IsNullEmpty(msg.replyto)) {
                const sendthis = msg.data;
                await amqpwrapper.Instance().send(msg.exchange, msg.queuename, sendthis, expiration, msg.correlationId, msg.routingkey);
            } else {
                if (msg.queuename === msg.replyto) {
                    throw new Error("Cannot send reply to self queuename: " + msg.queuename + " correlationId: " + msg.correlationId);
                }
                const sendthis = msg.data;
                await amqpwrapper.Instance().sendWithReplyTo(msg.exchange, msg.queuename, msg.replyto, sendthis, expiration, msg.correlationId, msg.routingkey);
            }
        } catch (error) {
            await handleError(cli, error);
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            await handleError(cli, error);
        }
        Logger.otel.endSpan(span);
        this.Send(cli);
    }
    async CloseQueue(cli: WebSocketServerClient, parent: Span) {
        this.Reply();
        let msg: CloseQueueMessage
        try {
            msg = CloseQueueMessage.assign(this.data);
            await cli.CloseConsumer(msg.queuename, parent);
        } catch (error) {
            await handleError(cli, error);
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            await handleError(cli, error);
        }
        this.Send(cli);
    }
    public Send(cli: WebSocketServerClient): void {
        cli.Send(this);
    }
    private UnknownCommand(): void {
        if (NoderedUtil.IsNullEmpty(this.command)) {
            Logger.instanse.error(new Error("Received message with no command"));
            return;
        }
        this.Reply("error");
        this.data = "{\"message\": \"Unknown command " + this.command + "\"}";
        Logger.instanse.error(new Error(this.data));
    }
    private Ping(cli: WebSocketServerClient): void {
        this.Reply("pong");
        this.Send(cli);
    }
    private static collectionCache: any = {};
    private static collectionCachetime: Date = new Date();
    private async ListCollections(parent: Span): Promise<void> {
        this.Reply();
        const span: Span = Logger.otel.startSubSpan("message.ListCollections", parent);
        let msg: ListCollectionsMessage
        try {
            msg = ListCollectionsMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = this.jwt; }
            const d = new Date(Message.collectionCachetime.getTime() + 1000 * 60);
            if (d < new Date()) {
                Message.collectionCache = {};
                Message.collectionCachetime = new Date();
            }
            const keys = Object.keys(Message.collectionCache);
            if (Message.collectionCache[msg.jwt] != null) {
                span.addEvent("Get from cache");
                span.setAttribute("cache size", keys.length);
                msg.result = Message.collectionCache[msg.jwt];
            } else {
                span.addEvent("ListCollections");
                msg.result = await Config.db.ListCollections(msg.jwt);
                span.addEvent("Filter collections");
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
                span.addEvent("Add result to cache");
                Message.collectionCache[msg.jwt] = result;
                span.setAttribute("cache size", keys.length + 1);
                msg.result = result;
            }
            if (Config.enable_entity_restriction) {
                await Config.db.loadEntityRestrictions(span);
                const tuser = Crypt.verityToken(this.jwt);
                const authorized = Config.db.EntityRestrictions.filter(x => x.IsAuthorized(tuser));
                const allall = authorized.filter(x => x.collection == "");
                if (allall.length == 0) {
                    const names = authorized.map(x => x.collection);
                    msg.result = msg.result.filter(x => names.indexOf(x.name) > -1);
                }
            } else {
                var b = true;
            }
        } catch (error) {
            span.recordException(error);
            await handleError(null, error);
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            span.recordException(error);
            this.data = "";
            await handleError(null, error);
        }
        Logger.otel.endSpan(span);
    }
    private async DropCollection(parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("message.DropCollection", parent);
        this.Reply();
        let msg: DropCollectionMessage
        try {
            msg = DropCollectionMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = this.jwt; }
            await Config.db.DropCollection(msg.collectionname, msg.jwt, span);
        } catch (error) {
            span.recordException(error);
            await handleError(null, error);
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            span.recordException(error);
            this.data = "";
            await handleError(null, error);
        }
        Logger.otel.endSpan(span);
    }
    private async Query(parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("message.Query", parent);
        this.Reply();
        let msg: QueryMessage
        try {
            msg = QueryMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = this.jwt; }
            if (NoderedUtil.IsNullEmpty(msg.jwt)) {
                span.recordException("Access denied, not signed in")
                msg.error = "Access denied, not signed in";
            } else {
                msg.result = await Config.db.query(msg.query, msg.projection, msg.top, msg.skip, msg.orderby, msg.collectionname, msg.jwt, msg.queryas, msg.hint, span);
            }
        } catch (error) {
            await handleError(null, error);
            span.recordException(error)
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            span.recordException(error)
            await handleError(null, error);
        }
        Logger.otel.endSpan(span);
    }
    private async GetDocumentVersion(parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("message.GetDocumentVersion", parent);
        this.Reply();
        let msg: GetDocumentVersionMessage
        try {
            msg = GetDocumentVersionMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = this.jwt; }
            if (NoderedUtil.IsNullEmpty(msg.jwt)) {
                msg.error = "Access denied, not signed in";
            } else {
                msg.result = await Config.db.GetDocumentVersion(msg.collectionname, msg._id, msg.version, msg.jwt, span);
            }
        } catch (error) {
            await handleError(null, error);
            span.recordException(error)
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            span.recordException(error)
            await handleError(null, error);
        }
        Logger.otel.endSpan(span);
    }

    private async Aggregate(parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("message.Aggregate", parent);
        this.Reply();
        let msg: AggregateMessage
        try {
            msg = AggregateMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = this.jwt; }
            msg.result = await Config.db.aggregate(msg.aggregates, msg.collectionname, msg.jwt, msg.hint, span);
        } catch (error) {
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
            await handleError(null, error);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            await handleError(null, error);
        }
        Logger.otel.endSpan(span);
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
            await handleError(cli, error);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            await handleError(cli, error);
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
            await handleError(cli, error);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            await handleError(cli, error);
        }
        this.Send(cli);
    }
    private async InsertOne(parent: Span): Promise<void> {
        this.Reply();
        const span: Span = Logger.otel.startSubSpan("message.InsertOne", parent);
        let msg: InsertOneMessage
        try {
            msg = InsertOneMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = this.jwt; }
            if (NoderedUtil.IsNullEmpty(msg.w as any)) { msg.w = 0; }
            if (NoderedUtil.IsNullEmpty(msg.j as any)) { msg.j = false; }
            if (NoderedUtil.IsNullEmpty(msg.jwt)) {
                throw new Error("jwt is null and client is not authenticated");
            }
            msg.result = await Config.db.InsertOne(msg.item, msg.collectionname, msg.w, msg.j, msg.jwt, span);
        } catch (error) {
            span.recordException(error);
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
            await handleError(null, error);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            span.recordException(error);
            await handleError(null, error);
        }
        Logger.otel.endSpan(span);
    }
    private async InsertMany(parent: Span): Promise<void> {
        this.Reply();
        const span: Span = Logger.otel.startSubSpan("message.InsertMany", parent);
        let msg: InsertManyMessage
        try {
            msg = InsertManyMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = this.jwt; }
            if (NoderedUtil.IsNullEmpty(msg.w as any)) { msg.w = 0; }
            if (NoderedUtil.IsNullEmpty(msg.j as any)) { msg.j = false; }
            if (NoderedUtil.IsNullEmpty(msg.jwt)) {
                throw new Error("jwt is null and client is not authenticated");
            }
            msg.results = await Config.db.InsertMany(msg.items, msg.collectionname, msg.w, msg.j, msg.jwt, span);
            if (msg.skipresults) msg.results = [];
        } catch (error) {
            span.recordException(error);
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
            await handleError(null, error);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            span.recordException(error);
            this.data = "";
            await handleError(null, error);
        }
        Logger.otel.endSpan(span);
    }
    private async UpdateOne(parent: Span): Promise<void> {
        this.Reply();
        const span: Span = Logger.otel.startSubSpan("message.UpdateOne", parent);
        let msg: UpdateOneMessage
        try {
            msg = UpdateOneMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = this.jwt; }
            if (NoderedUtil.IsNullEmpty(msg.w as any)) { msg.w = 0; }
            if (NoderedUtil.IsNullEmpty(msg.j as any)) { msg.j = false; }
            var tempres = await Config.db.UpdateOne(msg, span);
            msg = tempres;
        } catch (error) {
            span.recordException(error);
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
            await handleError(null, error);
        }
        try {
            if (msg != null) delete msg.query;
            this.data = JSON.stringify(msg);
        } catch (error) {
            span.recordException(error);
            this.data = "";
            await handleError(null, error);
        }
        Logger.otel.endSpan(span);
    }
    private async UpdateMany(parent: Span): Promise<void> {
        this.Reply();
        let msg: UpdateManyMessage
        const span: Span = Logger.otel.startSubSpan("message.UpdateOne", parent);
        try {
            msg = UpdateManyMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = this.jwt; }
            if (NoderedUtil.IsNullEmpty(msg.w as any)) { msg.w = 0; }
            if (NoderedUtil.IsNullEmpty(msg.j as any)) { msg.j = false; }
            msg = await Config.db.UpdateMany(msg, span);
        } catch (error) {
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
            await handleError(null, error);
        }
        try {
            delete msg.query;
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            await handleError(null, error);
        }
        Logger.otel.endSpan(span);
    }
    private async InsertOrUpdateOne(parent: Span): Promise<void> {
        this.Reply();
        let msg: InsertOrUpdateOneMessage
        try {
            msg = InsertOrUpdateOneMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = this.jwt; }
            if (NoderedUtil.IsNullEmpty(msg.w as any)) { msg.w = 0; }
            if (NoderedUtil.IsNullEmpty(msg.j as any)) { msg.j = false; }
            if (msg.collectionname == "openrpa_instances" && msg.item._type == "workflowinstance") {
                let state: string = (msg.item as any).state;
                // Force removing completed states, for old versions of openrpa
                if (msg.item && ["aborted", "failed", "completed"].indexOf(state) > -1) {
                    delete (msg.item as any).xml;
                }
            }
            msg = await Config.db.InsertOrUpdateOne(msg, parent);
        } catch (error) {
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (error) if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
            if (!error) msg.error = "Unknown error";
            await handleError(null, error);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            await handleError(null, error);
        }
    }
    private async DeleteOne(parent: Span): Promise<void> {
        this.Reply();
        let msg: DeleteOneMessage
        const span: Span = Logger.otel.startSubSpan("message.DeleteOne", parent);
        try {
            msg = DeleteOneMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = this.jwt; }
            await Config.db.DeleteOne(msg._id, msg.collectionname, msg.jwt, span);
        } catch (error) {
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
            await handleError(null, error);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            await handleError(null, error);
        }
        Logger.otel.endSpan(span);
    }
    private async DeleteMany(parent: Span): Promise<void> {
        this.Reply();
        let msg: DeleteManyMessage
        const span: Span = Logger.otel.startSubSpan("message.DeleteMany", parent);
        try {
            msg = DeleteManyMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = this.jwt; }
            msg.affectedrows = await Config.db.DeleteMany(msg.query, msg.ids, msg.collectionname, msg.jwt, span);
        } catch (error) {
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
            await handleError(null, error);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            await handleError(null, error);
        }
        Logger.otel.endSpan(span);
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
            await handleError(cli, error);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            await handleError(cli, error);
        }
        this.Send(cli);
    }
    public static async DoSignin(cli: WebSocketServerClient, rawAssertion: string): Promise<TokenUser> {
        const span: Span = Logger.otel.startSpan("message.DoSignin");
        let tuser: TokenUser;
        try {
            let type: string = "jwtsignin";
            if (!NoderedUtil.IsNullEmpty(rawAssertion)) {
                type = "samltoken";
                cli.user = await LoginProvider.validateToken(rawAssertion, span);
                tuser = TokenUser.From(cli.user);
            } else if (!NoderedUtil.IsNullEmpty(cli.jwt)) {
                tuser = Crypt.verityToken(cli.jwt);
                const impostor: string = tuser.impostor;
                cli.user = await DBHelper.FindById(cli.user._id, undefined, span);
                tuser = TokenUser.From(cli.user);
                tuser.impostor = impostor;
            }
            span.setAttribute("type", type);
            span.setAttribute("clientid", cli.id);
            if (!NoderedUtil.IsNullUndefinded(cli.user)) {
                if (!(cli.user.validated == true) && Config.validate_user_form != "") {
                    if (cli.clientagent != "nodered" && NoderedUtil.IsNullEmpty(tuser.impostor)) {
                        Logger.instanse.error(tuser.username + " failed logging in, not validated");
                        Audit.LoginFailed(tuser.username, type, "websocket", cli.remoteip, cli.clientagent, cli.clientversion, span);
                        tuser = null;
                    }
                }
            }
            if (tuser != null && cli.user != null && cli.user.disabled) {
                Logger.instanse.error(tuser.username + " failed logging in, user is disabled");
                Audit.LoginFailed(tuser.username, type, "websocket", cli.remoteip, cli.clientagent, cli.clientversion, span);
                tuser = null;
            } else if (tuser != null) {
                Logger.instanse.info(tuser.username + " successfully signed in");
                Audit.LoginSuccess(tuser, type, "websocket", cli.remoteip, cli.clientagent, cli.clientversion, span);
            }
        } catch (error) {
            Logger.instanse.error(error);
            span.recordException(error);
        }
        return tuser;
    }
    private async Signin(cli: WebSocketServerClient, parent: Span): Promise<void> {
        this.Reply();
        const span: Span = Logger.otel.startSubSpan("message.Signin", parent);
        try {
            const hrstart = process.hrtime()
            let hrend = process.hrtime(hrstart)
            let msg: SigninMessage
            let impostor: string = "";
            const UpdateDoc: any = { "$set": {} };
            let type: string = "local";
            try {
                msg = SigninMessage.assign(this.data);
                let tuser: TokenUser = null;
                let user: User = null;
                if (!NoderedUtil.IsNullEmpty(msg.jwt)) {
                    type = "jwtsignin";
                    tuser = Crypt.verityToken(msg.jwt);
                    if (tuser.impostor !== null && tuser.impostor !== undefined && tuser.impostor !== "") {
                        impostor = tuser.impostor;
                    }
                    user = await DBHelper.FindByUsername(tuser.username, null, span);
                    if (user !== null && user !== undefined) {
                        // refresh, for roles and stuff
                        tuser = TokenUser.From(user);
                    } else { // Autocreate user .... safe ?? we use this for autocreating nodered service accounts
                        if (Config.auto_create_users == true) {
                            const jwt: string = Crypt.rootToken();
                            user = await DBHelper.ensureUser(jwt, tuser.name, tuser.username, null, msg.password, span);
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
                } else if (!NoderedUtil.IsNullEmpty(msg.rawAssertion)) {
                    let AccessToken = null;
                    let User = null;
                    try {
                        AccessToken = await OAuthProvider.instance.oidc.AccessToken.find(msg.rawAssertion);
                        if (!NoderedUtil.IsNullUndefinded(AccessToken)) {
                            User = await OAuthProvider.instance.oidc.Account.findAccount(null, AccessToken.accountId);
                        }
                    } catch (error) {
                        console.error(error);
                    }
                    if (!NoderedUtil.IsNullUndefinded(AccessToken)) {
                        user = User.user;
                        if (user !== null && user != undefined) { tuser = TokenUser.From(user); }
                    } else {
                        type = "samltoken";
                        user = await LoginProvider.validateToken(msg.rawAssertion, span);
                        // refresh, for roles and stuff
                        if (user !== null && user != undefined) { tuser = TokenUser.From(user); }
                        msg.rawAssertion = "";
                    }
                } else {
                    user = await Auth.ValidateByPassword(msg.username, msg.password, span);
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
                    Audit.LoginFailed(tuser.username, type, "websocket", cli.remoteip, cli.clientagent, cli.clientversion, span);
                    Logger.instanse.error(tuser.username + " failed logging in using " + type);
                } else if (user.disabled && (msg.impersonate != "-1" && msg.impersonate != "false")) {
                    if (msg !== null && msg !== undefined) msg.error = "Disabled users cannot signin";
                    Audit.LoginFailed(tuser.username, type, "websocket", cli.remoteip, cli.clientagent, cli.clientversion, span);
                    Logger.instanse.error("Disabled user " + tuser.username + " failed logging in using " + type);
                } else {
                    if (msg.impersonate == "-1" || msg.impersonate == "false") {
                        user = await DBHelper.FindById(impostor, Crypt.rootToken(), span);
                        if (Config.persist_user_impersonation) UpdateDoc.$unset = { "impersonating": "" };
                        user.impersonating = undefined;
                        if (!NoderedUtil.IsNullEmpty(tuser.impostor)) {
                            tuser = TokenUser.From(user);
                            tuser.validated = true;
                        } else {
                            tuser = TokenUser.From(user);
                        }
                        msg.impersonate = undefined;
                        impostor = undefined;
                    }
                    Logger.instanse.info(tuser.username + " successfully signed in");
                    Audit.LoginSuccess(tuser, type, "websocket", cli.remoteip, cli.clientagent, cli.clientversion, span);
                    const userid: string = user._id;
                    if (msg.longtoken) {
                        msg.jwt = Crypt.createToken(tuser, Config.longtoken_expires_in);
                    } else {
                        msg.jwt = Crypt.createToken(tuser, Config.shorttoken_expires_in);
                    }
                    msg.user = tuser;
                    if (!NoderedUtil.IsNullEmpty(user.impersonating) && NoderedUtil.IsNullEmpty(msg.impersonate)) {
                        const items = await Config.db.query({ _id: user.impersonating }, null, 1, 0, null, "users", msg.jwt, undefined, undefined, span);
                        if (items.length == 0) {
                            msg.impersonate = null;
                        } else {
                            msg.impersonate = user.impersonating;
                        }
                    }
                    if (msg.impersonate !== undefined && msg.impersonate !== null && msg.impersonate !== "" && tuser._id != msg.impersonate) {
                        const items = await Config.db.query({ _id: msg.impersonate }, null, 1, 0, null, "users", msg.jwt, undefined, undefined, span);
                        if (items.length == 0) {
                            const impostors = await Config.db.query<User>({ _id: msg.impersonate }, null, 1, 0, null, "users", Crypt.rootToken(), undefined, undefined, span);
                            const impb: User = new User(); impb.name = "unknown"; impb._id = msg.impersonate;
                            let imp: TokenUser = TokenUser.From(impb);
                            if (impostors.length == 1) {
                                imp = TokenUser.From(impostors[0]);
                            }
                            Logger.instanse.error(tuser.name + " failed to impersonate " + msg.impersonate);
                            Audit.ImpersonateFailed(imp, tuser, cli.clientagent, cli.clientversion, span);
                            throw new Error("Permission denied, " + tuser.name + "/" + tuser._id + " view and impersonating " + msg.impersonate);
                        }
                        const tuserimpostor = tuser;
                        user = User.assign(items[0] as User);
                        user = await DBHelper.DecorateWithRoles(user, span);
                        // Check we have update rights
                        try {
                            await DBHelper.Save(user, msg.jwt, span);
                            if (Config.persist_user_impersonation) {
                                await Config.db._UpdateOne({ _id: tuserimpostor._id }, { "$set": { "impersonating": user._id } } as any, "users", 1, false, msg.jwt, span);
                            }
                        } catch (error) {
                            const impostors = await Config.db.query<User>({ _id: msg.impersonate }, null, 1, 0, null, "users", Crypt.rootToken(), undefined, undefined, span);
                            const impb: User = new User(); impb.name = "unknown"; impb._id = msg.impersonate;
                            let imp: TokenUser = TokenUser.From(impb);
                            if (impostors.length == 1) {
                                imp = TokenUser.From(impostors[0]);
                            }

                            Audit.ImpersonateFailed(imp, tuser, cli.clientagent, cli.clientversion, span);
                            Logger.instanse.error(tuser.name + " failed to impersonate " + msg.impersonate);
                            throw new Error("Permission denied, " + tuser.name + "/" + tuser._id + " updating and impersonating " + msg.impersonate);
                        }
                        tuser.impostor = tuserimpostor._id;

                        tuser = TokenUser.From(user);
                        tuser.impostor = userid;
                        if (msg.longtoken) {
                            msg.jwt = Crypt.createToken(tuser, Config.longtoken_expires_in);
                        } else {
                            msg.jwt = Crypt.createToken(tuser, Config.shorttoken_expires_in);
                        }
                        msg.user = tuser;
                        Logger.instanse.info(tuser.username + " successfully impersonated");
                        Audit.ImpersonateSuccess(tuser, tuserimpostor, cli.clientagent, cli.clientversion, span);
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
                        Logger.instanse.debug(tuser.username + " signed in using " + type + " " + cli.id + "/" + cli.clientagent);
                        cli.jwt = msg.jwt;
                        cli.user = user;
                    } else {
                        Logger.instanse.debug(tuser.username + " was validated in using " + type);
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
                    if (cli.clientagent == "webapp") {
                        user._lastopenrpaclientversion = cli.clientversion;
                        UpdateDoc.$set["_lastwebappclientversion"] = cli.clientversion;
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
                    await Config.db._UpdateOne({ "_id": user._id }, UpdateDoc, "users", 1, false, Crypt.rootToken(), span)
                }
            } catch (error) {
                if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
                if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
                await handleError(cli, error);
            }
            if (!NoderedUtil.IsNullUndefinded(msg.user) && !NoderedUtil.IsNullEmpty(msg.jwt)) {
                if (!(msg.user.validated == true) && Config.validate_user_form != "") {
                    if (cli.clientagent != "nodered" && NoderedUtil.IsNullEmpty(msg.user.impostor)) {
                        Audit.LoginFailed(msg.user.username, type, "websocket", cli.remoteip, cli.clientagent, cli.clientversion, span);
                        Logger.instanse.error(msg.user.username + " not validated");
                        msg.error = "User not validated, please login again";
                        msg.jwt = undefined;
                    }
                }
            }
            try {
                msg.websocket_package_size = Config.websocket_package_size;
                msg.openflow_uniqueid = Config.openflow_uniqueid;
                if (!NoderedUtil.IsNullEmpty(Config.otel_trace_url)) msg.otel_trace_url = Config.otel_trace_url;
                if (!NoderedUtil.IsNullEmpty(Config.otel_metric_url)) msg.otel_metric_url = Config.otel_metric_url;
                if (Config.otel_trace_interval > 0) msg.otel_trace_interval = Config.otel_trace_interval;
                if (Config.otel_metric_interval > 0) msg.otel_metric_interval = Config.otel_metric_interval;
                msg.enable_analytics = Config.enable_analytics;
                this.data = JSON.stringify(msg);
            } catch (error) {
                this.data = "";
                await handleError(cli, error);
            }
            hrend = process.hrtime(hrstart)
        } catch (error) {
            span.recordException(error);
        }
        Logger.otel.endSpan(span);
        this.Send(cli);
    }
    private async RegisterUser(cli: WebSocketServerClient, parent: Span): Promise<void> {
        this.Reply();
        const span: Span = Logger.otel.startSubSpan("message.RegisterUser", parent);
        let msg: RegisterUserMessage;
        let user: User;
        try {
            if (!Config.auto_create_users) {
                throw new Error("User registration not enabled for this openflow")
            }
            msg = RegisterUserMessage.assign(this.data);
            if (msg.name == null || msg.name == undefined || msg.name == "") { throw new Error("Name cannot be null"); }
            if (msg.username == null || msg.username == undefined || msg.username == "") { throw new Error("Username cannot be null"); }
            if (msg.password == null || msg.password == undefined || msg.password == "") { throw new Error("Password cannot be null"); }
            user = await DBHelper.FindByUsername(msg.username, null, span);
            if (user !== null && user !== undefined) { throw new Error("Illegal username"); }
            user = await DBHelper.ensureUser(Crypt.rootToken(), msg.name, msg.username, null, msg.password, span);
            msg.user = TokenUser.From(user);

            const jwt: string = Crypt.createToken(msg.user, Config.shorttoken_expires_in);
            DBHelper.EnsureNoderedRoles(user, jwt, false, span);
        } catch (error) {
            span.recordException(error);
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
            await handleError(cli, error);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            span.recordException(error);
            this.data = "";
            await handleError(cli, error);
        }
        Logger.otel.endSpan(span);
        this.Send(cli);
    }
    private async GetInstanceName(_id: string, myid: string, myusername: string, jwt: string, parent: Span): Promise<string> {
        const span: Span = Logger.otel.startSubSpan("message.GetInstanceName", parent);
        let name: string = "";
        if (_id !== null && _id !== undefined && _id !== "" && _id != myid) {
            var qs: any[] = [{ _id: _id }];
            qs.push(Config.db.getbasequery(jwt, "_acl", [Rights.update]))
            const res = await Config.db.query<User>({ "$and": qs }, null, 1, 0, null, "users", jwt, undefined, undefined, span);
            if (res.length == 0) {
                throw new Error("Unknown userid " + _id + " or permission denied");
            }
            name = res[0].username;
        } else {
            name = myusername;
        }
        name = name.split("@").join("").split(".").join("");
        name = name.toLowerCase();
        span.setAttribute("instancename", name)
        Logger.otel.endSpan(span);
        return name;
    }
    private async DetectDocker() {
        if (Message.detectdocker) {
            if (!NoderedUtil.isKubernetes() && NoderedUtil.isDocker()) {
                if (NoderedUtil.IsNullEmpty(process.env["KUBERNETES_SERVICE_HOST"])) {
                    try {
                        const docker = new Docker();
                        await docker.listContainers();
                        Message.usedocker = true;
                    } catch (error) {
                        console.log(error);
                        Message.usedocker = false;
                    }

                }
            }
            Message.detectdocker = false;
        }
    }
    private async EnsureNoderedInstance(parent: Span): Promise<void> {
        await this.DetectDocker();
        if (Message.usedocker) {
            this.DockerEnsureNoderedInstance(parent);
        } else {
            this.KubeEnsureNoderedInstance(parent);
        }
    }
    _pullImage(docker: Dockerode, imagename: string) {
        return new Promise<void>((resolve, reject) => {
            docker.pull(imagename, function (err, stream) {
                if (err)
                    return reject(err);

                docker.modem.followProgress(stream, onFinished, onProgress);

                function onFinished(err2, output) {
                    console.log(output);
                    if (err2) return reject(err2);

                    return resolve();
                }
                function onProgress(event) {
                    console.log(event);
                }
            });
        })
    }
    private async DockerEnsureNoderedInstance(parent: Span): Promise<void> {
        this.Reply();
        const span: Span = Logger.otel.startSubSpan("message.EnsureNoderedInstance", parent);
        let msg: EnsureNoderedInstanceMessage;
        try {
            msg = EnsureNoderedInstanceMessage.assign(this.data);
            let _id = msg._id;

            const tuser = Crypt.verityToken(this.jwt);

            Logger.instanse.debug("[" + tuser.username + "] EnsureNoderedInstance");
            if (_id === null || _id === undefined || _id === "") _id = tuser._id;
            const name = await this.GetInstanceName(_id, tuser._id, tuser.username, this.jwt, span);

            const users = await Config.db.query<NoderedUser>({ _id: _id }, null, 1, 0, null, "users", this.jwt, undefined, undefined, span);
            if (users.length == 0) {
                throw new Error("Unknown userid " + _id);
            }
            const user: NoderedUser = NoderedUser.assign(users[0]);

            const docker: Dockerode = new Docker();
            const myhostname = require('os').hostname();
            let me = null;
            let list = await docker.listContainers({ all: 1 });
            let instance: any = null;
            for (let item of list) {
                var Created = new Date(item.Created * 1000);
                (item as any).metadata = { creationTimestamp: Created, name: item.Labels["com.docker.compose.service"] };
                (item as any).status = { phase: item.State }
                if (item.Names[0] == "/" + name) {
                    instance = item;
                }
                if (item.Names[0] == "/" + myhostname || item.Id.startsWith(myhostname)) {
                    me = item;
                }
                if (me == null && item.Labels["com.docker.compose.project"] == Config.namespace) {
                    me = item;
                }
            }

            if (NoderedUtil.IsNullUndefinded(instance)) {

                let nodered_domain_schema = Config.nodered_domain_schema;
                if (NoderedUtil.IsNullEmpty(nodered_domain_schema)) {
                    nodered_domain_schema = "$nodered_id$." + Config.domain;
                }
                const hostname = nodered_domain_schema.replace("$nodered_id$", name);


                let nodered_image_name = Config.nodered_images[0].name;
                if (user.nodered) {
                    try {
                        if (user.nodered.api_allow_anonymous == null) user.nodered.api_allow_anonymous = false;
                        if (user.nodered.function_external_modules == null) user.nodered.function_external_modules = false;
                        if (user.nodered.nodered_image_name == null) user.nodered.nodered_image_name = nodered_image_name;
                    } catch (error) {
                        user.nodered = { api_allow_anonymous: false, function_external_modules: false, nodered_image_name } as any;
                    }
                } else {
                    user.nodered = { api_allow_anonymous: false, function_external_modules: false, nodered_image_name } as any;
                }
                const _nodered_image = Config.nodered_images.filter(x => x.name == user.nodered.nodered_image_name);
                let nodered_image = Config.nodered_images[0].image;
                if (_nodered_image.length == 1) { nodered_image = _nodered_image[0].image; }

                const Labels = {
                    "com.docker.compose.project": Config.namespace,
                    "com.docker.compose.service": Config.namespace
                };
                let NetworkingConfig: Dockerode.EndpointsConfig = undefined;
                let HostConfig: Dockerode.HostConfig = undefined;
                HostConfig = {};
                if (me != null) {
                    if (me.Labels["com.docker.compose.config-hash"]) Labels["com.docker.compose.config-hash"] = me.Labels["com.docker.compose.config-hash"];
                    if (me.Labels["com.docker.compose.project"]) Labels["com.docker.compose.project"] = me.Labels["com.docker.compose.project"];
                    if (me.Labels["com.docker.compose.project.config_files"]) Labels["com.docker.compose.project.config_files"] = me.Labels["com.docker.compose.project.config_files"];
                    if (me.Labels["com.docker.compose.project.working_dir"]) Labels["com.docker.compose.project.working_dir"] = me.Labels["com.docker.compose.project.working_dir"];
                    if (me.Labels["com.docker.compose.service"]) Labels["com.docker.compose.service"] = me.Labels["com.docker.compose.service"];
                    if (me.Labels["com.docker.compose.version"]) Labels["com.docker.compose.version"] = me.Labels["com.docker.compose.version"];
                    if (me.NetworkSettings && me.NetworkSettings.Networks) {
                        const keys = Object.keys(me.NetworkSettings.Networks);
                        HostConfig.NetworkMode = keys[0];
                    }
                }
                // docker-compose -f docker-compose-traefik.yml -p demo up -d
                Labels["traefik.enable"] = "true";
                Labels["traefik.http.routers." + name + ".entrypoints"] = Config.nodered_docker_entrypoints;
                Labels["traefik.http.routers." + name + ".rule"] = "Host(`" + hostname + "`)";
                Labels["traefik.http.services." + name + ".loadbalancer.server.port"] = Config.port.toString();
                if (!NoderedUtil.IsNullEmpty(Config.nodered_docker_certresolver)) {
                    Labels["traefik.http.routers." + name + ".tls.certresolver"] = Config.nodered_docker_certresolver;
                }
                // HostConfig.PortBindings = { "5859/tcp": [{ HostPort: '5859' }] }

                let api_ws_url = Config.basewsurl();
                if (!NoderedUtil.IsNullEmpty(Config.api_ws_url)) api_ws_url = Config.api_ws_url;
                if (!NoderedUtil.IsNullEmpty(Config.nodered_ws_url)) api_ws_url = Config.nodered_ws_url;
                if (!api_ws_url.endsWith("/")) api_ws_url += "/";

                const nodereduser = await DBHelper.FindById(_id, this.jwt, span);
                const tuser: TokenUser = TokenUser.From(nodereduser);
                const nodered_jwt: string = Crypt.createToken(tuser, Config.personalnoderedtoken_expires_in);

                DBHelper.EnsureNoderedRoles(tuser, this.jwt, true, span);
                let saml_baseurl = Config.protocol + "://" + hostname + "/";
                let _samlparsed = url.parse(Config.saml_federation_metadata);
                if (_samlparsed.protocol == "http:" || _samlparsed.protocol == "ws:") {
                    saml_baseurl = "http://" + hostname
                    if (_samlparsed.port && _samlparsed.port != "80" && _samlparsed.port != "3000") {
                        saml_baseurl += ":" + _samlparsed.port;
                    }
                } else {
                    saml_baseurl = "https://" + hostname
                    if (_samlparsed.port && _samlparsed.port != "443" && _samlparsed.port != "3000") {
                        saml_baseurl += ":" + _samlparsed.port;
                    }
                }
                saml_baseurl += "/";
                // "saml_baseurl=" + saml_baseurl,
                const Env = [
                    "saml_federation_metadata=" + Config.saml_federation_metadata,
                    "saml_issuer=" + Config.saml_issuer,
                    "saml_entrypoint=" + Config.baseurl() + 'issue',
                    "nodered_id=" + name,
                    "nodered_sa=" + nodereduser.username,
                    "jwt=" + nodered_jwt,
                    "queue_prefix=" + user.nodered.queue_prefix,
                    "api_ws_url=" + api_ws_url,
                    "domain=" + hostname,
                    "protocol=" + Config.protocol,
                    "port=" + Config.port.toString(),
                    "noderedusers=" + (name + "noderedusers"),
                    "noderedadmins=" + (name + "noderedadmins"),
                    "noderedapiusers=" + (name + "nodered api users"),
                    "api_allow_anonymous=" + user.nodered.api_allow_anonymous.toString(),
                    "function_external_modules=" + user.nodered.function_external_modules.toString(),
                    "prometheus_measure_nodeid=" + Config.prometheus_measure_nodeid.toString(),
                    "prometheus_measure_queued_messages=" + Config.prometheus_measure_queued_messages.toString(),
                    "NODE_ENV=" + Config.NODE_ENV,
                    "prometheus_expose_metric=" + "false",
                    "enable_analytics=" + Config.enable_analytics.toString(),
                    "otel_trace_url=" + Config.otel_trace_url,
                    "otel_metric_url=" + Config.otel_metric_url,
                    "otel_trace_interval=" + Config.otel_trace_interval.toString(),
                    "otel_metric_interval=" + Config.otel_metric_interval.toString(),
                    "amqp_enabled_exchange=" + Config.amqp_enabled_exchange.toString()
                ]
                // const image = await docker.pull(nodered_image, { serveraddress: "https://index.docker.io/v1" });
                await this._pullImage(docker, nodered_image);
                instance = await docker.createContainer({
                    Image: nodered_image, name, Labels, Env, NetworkingConfig, HostConfig
                })
                await instance.start();
            } else {
                const container = docker.getContainer(instance.Id);
                if (instance.State != "running") {
                    container.start();
                }

            }
        } catch (error) {
            span.recordException(error);
            this.data = "";
            await handleError(null, error);
            //msg.error = JSON.stringify(error, null, 2);
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            span.recordException(error);
            this.data = "";
            await handleError(null, error);
        }
        Logger.otel.endSpan(span);
    }
    private async KubeEnsureNoderedInstance(parent: Span): Promise<void> {
        this.Reply();
        const span: Span = Logger.otel.startSubSpan("message.EnsureNoderedInstance", parent);
        let msg: EnsureNoderedInstanceMessage;
        try {
            msg = EnsureNoderedInstanceMessage.assign(this.data);
            await this._EnsureNoderedInstance(msg._id, false, span);
        } catch (error) {
            span.recordException(error);
            this.data = "";
            await handleError(null, error);
            //msg.error = JSON.stringify(error, null, 2);
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            span.recordException(error);
            this.data = "";
            await handleError(null, error);
        }
        Logger.otel.endSpan(span);
    }
    private async _EnsureNoderedInstance(_id: string, skipcreate: boolean, parent: Span): Promise<void> {
        let user: NoderedUser;
        const span: Span = Logger.otel.startSubSpan("message._EnsureNoderedInstance", parent);
        try {

            const _tuser = Crypt.verityToken(this.jwt);

            // Logger.instanse.debug("[" + tuser.username + "] EnsureNoderedInstance");
            if (_id === null || _id === undefined || _id === "") _id = _tuser._id;
            const name = await this.GetInstanceName(_id, _tuser._id, _tuser.username, this.jwt, span);

            Logger.instanse.debug("[" + _tuser.username + "] EnsureNoderedInstance for " + name + " in namespace " + Config.namespace);

            const users = await Config.db.query<NoderedUser>({ _id: _id }, null, 1, 0, null, "users", this.jwt, undefined, undefined, span);
            if (users.length == 0) {
                throw new Error("Unknown userid " + _id);
            }
            user = NoderedUser.assign(users[0]);
            const rootjwt = Crypt.rootToken();

            const namespace = Config.namespace;
            let nodered_domain_schema = Config.nodered_domain_schema;
            if (NoderedUtil.IsNullEmpty(nodered_domain_schema)) {
                nodered_domain_schema = "$nodered_id$." + Config.domain;
            }
            const hostname = nodered_domain_schema.replace("$nodered_id$", name);

            const nodereduser = await DBHelper.FindById(_id, this.jwt, span);
            const tuser: TokenUser = TokenUser.From(nodereduser);
            const nodered_jwt: string = Crypt.createToken(tuser, Config.personalnoderedtoken_expires_in);

            DBHelper.EnsureNoderedRoles(tuser, this.jwt, true, span);

            const resources = new V1ResourceRequirements();
            let hasbilling: boolean = false;
            resources.limits = {};
            resources.requests = {};
            if (!NoderedUtil.IsNullEmpty(Config.nodered_requests_memory)) resources.requests.memory = Config.nodered_requests_memory;
            if (!NoderedUtil.IsNullEmpty(Config.nodered_requests_cpu)) resources.requests.cpu = Config.nodered_requests_cpu;
            if (!NoderedUtil.IsNullEmpty(Config.nodered_limits_memory)) resources.limits.memory = Config.nodered_limits_memory;
            if (!NoderedUtil.IsNullEmpty(Config.nodered_limits_cpu)) resources.limits.cpu = Config.nodered_limits_cpu;



            let nodered_image_name = Config.nodered_images[0].name;
            if (user.nodered) {
                try {
                    if (user.nodered.api_allow_anonymous == null) user.nodered.api_allow_anonymous = false;
                    if (user.nodered.function_external_modules == null) user.nodered.function_external_modules = false;
                    if (user.nodered.nodered_image_name == null) user.nodered.nodered_image_name = nodered_image_name;
                } catch (error) {
                    user.nodered = { api_allow_anonymous: false, function_external_modules: false, nodered_image_name } as any;
                }
            } else {
                user.nodered = { api_allow_anonymous: false, function_external_modules: false, nodered_image_name } as any;
            }
            const _nodered_image = Config.nodered_images.filter(x => x.name == user.nodered.nodered_image_name);
            let nodered_image = Config.nodered_images[0].image;
            if (_nodered_image.length == 1) { nodered_image = _nodered_image[0].image; }

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
                    const billings = await Config.db.query<Billing>({ userid: _id, _type: "billing" }, null, 1, 0, null, "users", rootjwt, undefined, undefined, span);
                    if (billings.length > 0) {
                        const billing: Billing = billings[0];
                        if (!NoderedUtil.IsNullEmpty(billing.memory)) resources.limits.memory = billing.memory;
                        if (!NoderedUtil.IsNullEmpty((billing as any).cpu)) resources.limits.cpu = (billing as any).cpu;
                        if (!NoderedUtil.IsNullEmpty(billing.memory)) resources.requests.memory = billing.memory;
                        if (!NoderedUtil.IsNullEmpty((billing as any).cpu)) resources.limits.cpu = (billing as any).cpu;

                        if (!NoderedUtil.IsNullEmpty(billing.openflowuserplan)) {
                            hasbilling = true;
                        }
                    }

                }
            } else {
                if (!NoderedUtil.IsNullEmpty(Config.stripe_api_secret)) {
                    const billings = await Config.db.query<Billing>({ userid: _id, _type: "billing" }, null, 1, 0, null, "users", rootjwt, undefined, undefined, span);
                    if (billings.length > 0) {
                        const billing: Billing = billings[0];
                        if (!NoderedUtil.IsNullEmpty(billing.memory)) resources.limits.memory = billing.memory;
                        if (!NoderedUtil.IsNullEmpty((billing as any).cpu)) resources.limits.cpu = (billing as any).cpu;
                        if (!NoderedUtil.IsNullEmpty(billing.memory)) resources.requests.memory = billing.memory;
                        if (!NoderedUtil.IsNullEmpty((billing as any).cpu)) resources.limits.cpu = (billing as any).cpu;
                        if (!NoderedUtil.IsNullEmpty(billing.openflowuserplan)) {
                            hasbilling = true;
                        }
                    }
                }
            }
            // 
            let livenessProbe: any = {
                httpGet: {
                    path: "/livenessprobe",
                    port: Config.port,
                    scheme: "HTTP"
                },
                initialDelaySeconds: Config.nodered_initial_liveness_delay,
                periodSeconds: 5,
                failureThreshold: Config.nodered_liveness_failurethreshold,
                timeoutSeconds: Config.nodered_liveness_timeoutseconds
            }
            if (user.nodered && (user.nodered as any).livenessProbe) {
                livenessProbe = (user.nodered as any).livenessProbe;
            }

            Logger.instanse.debug("[" + tuser.username + "] GetDeployments");
            const deployment: V1Deployment = await KubeUtil.instance().GetDeployment(namespace, name);
            if (deployment == null) {
                if (skipcreate) return;
                Logger.instanse.debug("[" + tuser.username + "] Deployment " + name + " not found in " + namespace + " so creating it");

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

                if (!NoderedUtil.IsNullUndefinded(resources.limits) && NoderedUtil.IsNullEmpty(resources.limits.memory)) delete resources.limits.memory;
                if (!NoderedUtil.IsNullUndefinded(resources.limits) && NoderedUtil.IsNullEmpty(resources.limits.cpu)) delete resources.limits.cpu;
                if (!NoderedUtil.IsNullUndefinded(resources.requests) && NoderedUtil.IsNullEmpty(resources.requests.memory)) delete resources.requests.memory;
                if (!NoderedUtil.IsNullUndefinded(resources.requests) && NoderedUtil.IsNullEmpty(resources.requests.memory)) delete resources.requests.memory;

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
                                        image: nodered_image,
                                        imagePullPolicy: "Always",
                                        ports: [{ containerPort: Config.port }, { containerPort: 5859 }],
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
                                            { name: "domain", value: hostname },
                                            { name: "protocol", value: Config.protocol },
                                            { name: "port", value: Config.port.toString() },
                                            { name: "noderedusers", value: (name + "noderedusers") },
                                            { name: "noderedadmins", value: (name + "noderedadmins") },
                                            { name: "noderedapiusers", value: (name + "nodered api users") },
                                            { name: "api_allow_anonymous", value: user.nodered.api_allow_anonymous.toString() },
                                            { name: "function_external_modules", value: user.nodered.function_external_modules.toString() },
                                            { name: "prometheus_measure_nodeid", value: Config.prometheus_measure_nodeid.toString() },
                                            { name: "prometheus_measure_queued_messages", value: Config.prometheus_measure_queued_messages.toString() },
                                            { name: "NODE_ENV", value: Config.NODE_ENV },
                                            { name: "prometheus_expose_metric", value: "false" },
                                            { name: "enable_analytics", value: Config.enable_analytics.toString() },
                                            { name: "otel_trace_url", value: Config.otel_trace_url },
                                            { name: "otel_metric_url", value: Config.otel_metric_url },
                                            { name: "otel_trace_interval", value: Config.otel_trace_interval.toString() },
                                            { name: "otel_metric_interval", value: Config.otel_metric_interval.toString() },
                                            { name: "amqp_enabled_exchange", value: Config.amqp_enabled_exchange.toString() },
                                        ],
                                        livenessProbe: livenessProbe,
                                    }
                                ]
                            }
                        }
                    }
                }
                if (user.nodered && (user.nodered as any).nodeselector && Config.nodered_allow_nodeselector) {
                    var spec: any = _deployment.spec.template.spec;
                    const keys = Object.keys((user.nodered as any).nodeselector);
                    if (spec.nodeSelector == null) spec.nodeSelector = {};
                    keys.forEach(key => {
                        spec.nodeSelector[key] = (user.nodered as any).nodeselector[key];
                    })
                }
                try {
                    await KubeUtil.instance().AppsV1Api.createNamespacedDeployment(namespace, (_deployment as any));
                    Audit.NoderedAction(TokenUser.From(tuser), true, name, "createdeployment", nodered_image, null, span);
                } catch (error) {
                    if (error.response && error.response.body && error.response.body.message) {
                        Logger.instanse.error(new Error(error.response.body.message));
                        throw new Error(error.response.body.message);
                    }
                    await handleError(null, error);
                    Audit.NoderedAction(TokenUser.From(tuser), false, name, "createdeployment", nodered_image, null, span);
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
                    Audit.NoderedAction(TokenUser.From(tuser), true, name, "replacedeployment", image, null, span);
                } catch (error) {
                    Logger.instanse.error("[" + _tuser.username + "] failed updating noeredinstance");
                    Logger.instanse.error("[" + _tuser.username + "] " + JSON.stringify(error));
                    if (error.response && error.response.body && !NoderedUtil.IsNullEmpty(error.response.body.message)) {
                        Logger.instanse.error(new Error(error.response.body.message));
                        throw new Error(error.response.body.message);
                    }
                    Audit.NoderedAction(TokenUser.From(tuser), false, name, "replacedeployment", image, null, span);
                    throw new Error("failed updating noeredinstance");
                }
            }

            Logger.instanse.debug("[" + tuser.username + "] GetService");
            const service = await KubeUtil.instance().GetService(namespace, name);
            if (service == null) {
                Logger.instanse.debug("[" + _tuser.username + "] Service " + name + " not found in " + namespace + " creating it");
                const _service = {
                    metadata: { name: name, namespace: namespace },
                    spec: {
                        type: "NodePort",
                        sessionAffinity: "ClientIP",
                        selector: { app: name },
                        ports: [
                            { port: Config.port, name: "www" }
                        ]
                    }
                }
                await KubeUtil.instance().CoreV1Api.createNamespacedService(namespace, _service);
            }
            Logger.instanse.debug("[" + _tuser.username + "] GetIngress useringress");
            const ingress = await KubeUtil.instance().GetIngressV1beta1(namespace, "useringress");
            if (ingress !== null) {
                let rule = null;
                for (let i = 0; i < ingress.spec.rules.length; i++) {
                    if (ingress.spec.rules[i].host == hostname) {
                        rule = ingress.spec.rules[i];
                    }
                }
                if (rule == null) {
                    Logger.instanse.debug("[" + _tuser.username + "] ingress " + hostname + " not found in useringress creating it");
                    if (Config.use_ingress_beta1_syntax) {
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
                        ingress.spec.rules.push(rule);
                    } else {
                        rule = {
                            host: hostname,
                            http: {
                                paths: [{
                                    path: "/",
                                    pathType: "Prefix",
                                    backend: {
                                        service: {
                                            name: name,
                                            port: {
                                                number: Config.port
                                            }
                                        }
                                    }
                                }]
                            }
                        }
                        ingress.spec.rules.push(rule);
                    }
                    delete ingress.metadata.creationTimestamp;
                    delete ingress.status;
                    Logger.instanse.debug("[" + _tuser.username + "] replaceNamespacedIngress");
                    await KubeUtil.instance().ExtensionsV1beta1Api.replaceNamespacedIngress("useringress", namespace, ingress);
                }
            } else {
                Logger.instanse.error("[" + _tuser.username + "] failed locating useringress");
                throw new Error("failed locating useringress");
            }
        } catch (error) {
            span.recordException(error);
            Logger.otel.endSpan(span);
            throw error;
        }
        Logger.otel.endSpan(span);
    }
    private async _DeleteNoderedInstance(_id: string, jwt: string, parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("message._DeleteNoderedInstance", parent);
        try {
            const user = Crypt.verityToken(jwt);
            if (_id === null || _id === undefined || _id === "") _id = user._id;
            const name = await this.GetInstanceName(_id, user._id, user.username, jwt, span);

            const namespace = Config.namespace;
            let nodered_domain_schema = Config.nodered_domain_schema;
            if (NoderedUtil.IsNullEmpty(nodered_domain_schema)) {
                nodered_domain_schema = "$nodered_id$." + Config.domain;
            }
            const hostname = nodered_domain_schema.replace("$nodered_id$", name);

            const deployment = await KubeUtil.instance().GetDeployment(namespace, name);
            if (deployment != null) {
                let image: string = "unknown";
                try {
                    image = deployment.spec.template.spec.containers[0].image;
                } catch (error) {

                }
                try {
                    await KubeUtil.instance().AppsV1Api.deleteNamespacedDeployment(name, namespace);
                    Audit.NoderedAction(user, true, name, "deletedeployment", image, null, span);
                } catch (error) {
                    Audit.NoderedAction(user, false, name, "deletedeployment", image, null, span);
                    throw error;
                }
            } else {
                Logger.instanse.warn("_DeleteNoderedInstance: Did not find deployment for " + name + " in namespace " + namespace);
            }
            const service = await KubeUtil.instance().GetService(namespace, name);
            if (service != null) {
                await KubeUtil.instance().CoreV1Api.deleteNamespacedService(name, namespace);
            } else {
                Logger.instanse.warn("_DeleteNoderedInstance: Did not find service for " + name + " in namespace " + namespace);
            }
            const replicaset = await KubeUtil.instance().GetReplicaset(namespace, "app", name);
            if (replicaset !== null) {
                KubeUtil.instance().AppsV1Api.deleteNamespacedReplicaSet(replicaset.metadata.name, namespace);
            } else {
                Logger.instanse.warn("_DeleteNoderedInstance: Did not find replicaset for " + name + " in namespace " + namespace);
            }
            const ingress = await KubeUtil.instance().GetIngressV1beta1(namespace, "useringress");
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
                } else {
                    Logger.instanse.warn("_DeleteNoderedInstance: Did not find ingress entry for " + name + " in namespace " + namespace);
                }
            } else {
                throw new Error("failed locating useringress");
            }
        } catch (error) {
            span.recordException(error);
            Logger.otel.endSpan(span);
            throw error;
        }
        Logger.otel.endSpan(span);
    }
    private async DeleteNoderedInstance(parent: Span): Promise<void> {
        await this.DetectDocker();
        if (Message.usedocker) {
            this.dockerDeleteNoderedInstance(parent);
        } else {
            this.KubeDeleteNoderedInstance(parent);
        }
    }
    private async dockerDeleteNoderedInstance(parent: Span): Promise<void> {
        this.dockerDeleteNoderedPod(parent);
    }
    private async KubeDeleteNoderedInstance(parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("message.DeleteNoderedInstance", parent);
        try {
            this.Reply();
            let msg: DeleteNoderedInstanceMessage;
            let user: User;
            try {
                msg = DeleteNoderedInstanceMessage.assign(this.data);
                await this._DeleteNoderedInstance(msg._id, this.jwt, span);

            } catch (error) {
                this.data = "";
                await handleError(null, error);
                if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
            }
            try {
                this.data = JSON.stringify(msg);
            } catch (error) {
                this.data = "";
                await handleError(null, error);
            }
        } catch (error) {
            span.recordException(error);
            Logger.otel.endSpan(span);
            throw error;
        }
        Logger.otel.endSpan(span);
    }
    private async DeleteNoderedPod(parent: Span): Promise<void> {
        await this.DetectDocker();
        if (Message.usedocker) {
            this.dockerDeleteNoderedPod(parent);
        } else {
            this.KubeDeleteNoderedPod(parent);
        }

    }
    private async dockerDeleteNoderedPod(parent: Span): Promise<void> {
        this.Reply();
        let msg: DeleteNoderedPodMessage;
        const span: Span = Logger.otel.startSubSpan("message.GetNoderedInstance", parent);
        try {
            const user = Crypt.verityToken(this.jwt);
            Logger.instanse.debug("[" + user.username + "] GetNoderedInstance");
            msg = DeleteNoderedPodMessage.assign(this.data);
            const name = await this.GetInstanceName(msg._id, user._id, user.username, this.jwt, span);
            if (NoderedUtil.IsNullEmpty(msg.name)) msg.name = name;

            span.addEvent("init Docker()");
            const docker: Dockerode = new Docker();
            span.addEvent("listContainers()");
            var list = await docker.listContainers({ all: 1 });
            for (let i = 0; i < list.length; i++) {
                const item = list[i];
                if (item.Names[0] == "/" + msg.name) {
                    span.addEvent("getContainer(" + item.Id + ")");
                    const container = docker.getContainer(item.Id);
                    if (item.State == "running") await container.stop();
                    span.addEvent("remove()");
                    await container.remove();
                }
            }
        } catch (error) {
            span.recordException(error);
            this.data = "";
            await handleError(null, error);
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            span.recordException(error);
            this.data = "";
            await handleError(null, error);
        }
        Logger.otel.endSpan(span);
    }
    private async KubeDeleteNoderedPod(parent: Span): Promise<void> {
        this.Reply();
        const span: Span = Logger.otel.startSubSpan("message.DeleteNoderedPod", parent);
        let msg: DeleteNoderedPodMessage;
        let user: User;
        try {
            const user = Crypt.verityToken(this.jwt);
            Logger.instanse.debug("[" + user.username + "] DeleteNoderedInstance");
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
                            Audit.NoderedAction(TokenUser.From(user), true, name, "deletepod", image, msg.name, span);
                        } catch (error) {
                            Audit.NoderedAction(TokenUser.From(user), false, name, "deletepod", image, msg.name, span);
                            throw error;
                        }
                    }
                }
            } else {
                Logger.instanse.warn("[" + user.username + "] DeleteNoderedPod: found NO Namespaced Pods ???");
                Audit.NoderedAction(TokenUser.From(user), false, null, "deletepod", image, msg.name, span);
            }
        } catch (error) {
            span.recordException(error);
            this.data = "";
            await handleError(null, error);
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            span.recordException(error);
            this.data = "";
            await handleError(null, error);
        }
        Logger.otel.endSpan(span);
    }
    private async RestartNoderedInstance(parent: Span): Promise<void> {
        await this.DetectDocker();
        if (Message.usedocker) {
            this.DockerRestartNoderedInstance(parent);
        } else {
            this.KubeRestartNoderedInstance(parent);
        }
    }
    private async DockerRestartNoderedInstance(parent: Span): Promise<void> {
        this.Reply();
        let msg: RestartNoderedInstanceMessage;
        const span: Span = Logger.otel.startSubSpan("message.DockerRestartNoderedInstance", parent);
        try {
            const user = Crypt.verityToken(this.jwt);
            Logger.instanse.debug("[" + user.username + "] DockerRestartNoderedInstance");
            msg = RestartNoderedInstanceMessage.assign(this.data);
            const name = await this.GetInstanceName(msg._id, user._id, user.username, this.jwt, span);

            span.addEvent("init Docker()");
            const docker: Dockerode = new Docker();
            span.addEvent("listContainers()");
            var list = await docker.listContainers({ all: 1 });
            var instance = null;
            for (let i = 0; i < list.length; i++) {
                const item = list[i];
                if (item.Names[0] == "/" + name) {
                    instance = item;
                }
            }
            if (instance != null) {
                span.addEvent("getContainer(" + instance.Id + ")");
                const container = docker.getContainer(instance.Id);
                if (instance.State == "running") await container.stop();
                await container.restart();
            }
        } catch (error) {
            span.recordException(error);
            this.data = "";
            await handleError(null, error);
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            span.recordException(error);
            this.data = "";
            await handleError(null, error);
        }
        Logger.otel.endSpan(span);
    }
    private async KubeRestartNoderedInstance(parent: Span): Promise<void> {
        this.Reply();
        const span: Span = Logger.otel.startSubSpan("message.KubeRestartNoderedInstance", parent);
        let msg: RestartNoderedInstanceMessage;
        try {
            const user = Crypt.verityToken(this.jwt);
            Logger.instanse.debug("[" + user.username + "] KubeRestartNoderedInstance");
            msg = RestartNoderedInstanceMessage.assign(this.data);
            const name = await this.GetInstanceName(msg._id, user._id, user.username, this.jwt, span);
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
                        Audit.NoderedAction(TokenUser.From(user), true, name, "restartdeployment", image, item.metadata.name, span);
                    } catch (error) {
                        Audit.NoderedAction(TokenUser.From(user), false, name, "restartdeployment", image, item.metadata.name, span);
                    }
                }
            }
        } catch (error) {
            span.recordException(error);
            this.data = "";
            await handleError(null, error);
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            span.recordException(error);
            this.data = "";
            await handleError(null, error);
        }
        Logger.otel.endSpan(span);
    }
    private async GetKubeNodeLabels(cli: WebSocketServerClient): Promise<void> {
        this.Reply();
        let msg: GetKubeNodeLabels;
        try {
            Logger.instanse.debug("[" + cli.user.username + "] GetKubeNodeLabels");
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
            await handleError(cli, error);
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            await handleError(cli, error);
        }
        this.Send(cli);
    }
    private static detectdocker: boolean = true;
    private static usedocker: boolean = false;
    private async GetNoderedInstance(parent: Span): Promise<void> {
        await this.DetectDocker();
        if (Message.usedocker) {
            this.dockerGetNoderedInstance(parent);
        } else {
            this.KubeGetNoderedInstance(parent);
        }
    }
    private async dockerGetNoderedInstance(parent: Span): Promise<void> {
        this.Reply();
        let msg: GetNoderedInstanceMessage;
        const span: Span = Logger.otel.startSubSpan("message.GetNoderedInstance", parent);
        try {
            const _tuser = Crypt.verityToken(this.jwt);

            Logger.instanse.debug("[" + _tuser.username + "] GetNoderedInstance");
            msg = GetNoderedInstanceMessage.assign(this.data);
            const name = await this.GetInstanceName(msg._id, _tuser._id, _tuser.username, this.jwt, span);

            span.addEvent("init Docker()");
            const docker = new Docker();
            span.addEvent("listContainers()");
            var list = await docker.listContainers({ all: 1 });
            var result = [];
            for (let i = 0; i < list.length; i++) {
                const item = list[i];
                var Created = new Date(item.Created * 1000);
                item.metadata = { creationTimestamp: Created, name: (item.Names[0] as string).substr(1) };
                item.status = { phase: item.State }
                if (item.Names[0] == "/" + name) {
                    span.addEvent("getContainer(" + item.Id + ")");
                    const container = docker.getContainer(item.Id);
                    span.addEvent("stats()");
                    var stats = await container.stats({ stream: false });
                    let cpu_usage: 0;
                    let memory: 0;
                    let memorylimit: 0;
                    if (stats && stats.cpu_stats && stats.cpu_stats.cpu_usage && stats.cpu_stats.cpu_usage.usage_in_usermode) cpu_usage = stats.cpu_stats.cpu_usage.usage_in_usermode;
                    if (stats && stats.memory_stats && stats.memory_stats.usage) memory = stats.memory_stats.usage;
                    if (stats && stats.memory_stats && stats.memory_stats.limit) memorylimit = stats.memory_stats.limit;
                    item.metrics = {
                        cpu: parseFloat((cpu_usage / 1024 / 1024).toString()).toFixed(2) + "n",
                        memory: parseFloat((memory / 1024 / 1024).toString()).toFixed(2) + "Mi",
                        memorylimit: parseFloat((memorylimit / 1024 / 1024).toString()).toFixed(2) + "Mi"
                    };
                    result.push(item);
                }
            }
            msg.results = result;
            if (result.length > 0) msg.result = result[0];
        } catch (error) {
            span.recordException(error);
            this.data = "";
            await handleError(null, error);
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            span.recordException(error);
            this.data = "";
            await handleError(null, error);
        }
        Logger.otel.endSpan(span);
    }
    private async KubeGetNoderedInstance(parent: Span): Promise<void> {
        this.Reply();
        let msg: GetNoderedInstanceMessage;
        const span: Span = Logger.otel.startSubSpan("message.GetNoderedInstance", parent);
        try {
            const _tuser = Crypt.verityToken(this.jwt);
            Logger.instanse.debug("[" + _tuser.username + "] GetNoderedInstance");
            msg = GetNoderedInstanceMessage.assign(this.data);
            const name = await this.GetInstanceName(msg._id, _tuser._id, _tuser.username, this.jwt, span);
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
                        if ((image.indexOf("openflownodered") > -1 || image.indexOf("openiap/nodered") > -1) && !NoderedUtil.IsNullEmpty(userid)) {
                            try {
                                if (billed != "true" && diffhours > 24) {
                                    Logger.instanse.debug("[" + _tuser.username + "] Remove un billed nodered instance " + itemname + " that has been running for " + diffhours + " hours");
                                    await this._DeleteNoderedInstance(userid, rootjwt, span);
                                }
                            } catch (error) {
                            }
                        } else if (image.indexOf("openflownodered") > -1 || image.indexOf("openiap/nodered") > -1) {
                            if (billed != "true" && diffhours > 24) {
                                console.debug("unbilled " + itemname + " with no userid, should be removed, it has been running for " + diffhours + " hours");
                            } else {
                                console.debug("unbilled " + itemname + " with no userid, has been running for " + diffhours + " hours");
                            }
                        }
                    }
                    if (!NoderedUtil.IsNullEmpty(msg.name) && item.metadata.name == msg.name && _tuser.HasRoleName("admins")) {
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
                            Logger.instanse.debug("[" + _tuser.username + "] GetNoderedInstance: " + name + " found one");
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
                Logger.instanse.warn("[" + _tuser.username + "] GetNoderedInstance: found NO Namespaced Pods ???");
            }
        } catch (error) {
            span.recordException(error);
            this.data = "";
            await handleError(null, error);
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            span.recordException(error);
            this.data = "";
            await handleError(null, error);
        }
        Logger.otel.endSpan(span);
    }
    private async GetNoderedInstanceLog(cli: WebSocketServerClient, parent: Span): Promise<void> {
        await this.DetectDocker();
        if (Message.usedocker) {
            this.DockerGetNoderedInstanceLog(cli, parent);
        } else {
            this.KubeGetNoderedInstanceLog(cli, parent);
        }
    }
    streamToString(stream) {
        const chunks = [];
        return new Promise<string>((resolve, reject) => {
            stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
            stream.on('error', (err) => reject(err));
            stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        })
    }
    private async DockerGetNoderedInstanceLog(cli: WebSocketServerClient, parent: Span): Promise<void> {
        this.Reply();
        let msg: GetNoderedInstanceLogMessage;
        const span: Span = Logger.otel.startSubSpan("message.GetNoderedInstanceLog", parent);
        try {
            Logger.instanse.debug("[" + cli.user.username + "] GetNoderedInstanceLog");
            msg = GetNoderedInstanceLogMessage.assign(this.data);
            var name = await this.GetInstanceName(msg._id, cli.user._id, cli.user.username, cli.jwt, span);
            const namespace = Config.namespace;
            // if (!msg.instancename.startsWith(name + "-")) msg.instancename = "";

            const docker: Dockerode = new Docker();
            let me = null;
            let list = await docker.listContainers({ all: 1 });
            let instance: Dockerode.ContainerInfo = null;
            for (let i = 0; i < list.length; i++) {
                const item = list[i];
                var Created = new Date(item.Created * 1000);
                (item as any).metadata = { creationTimestamp: Created, name: item.Labels["com.docker.compose.service"] };
                (item as any).status = { phase: item.State }
                if (item.Names[0] == "/" + msg.instancename) {
                    instance = item;
                }
            }
            if (instance != null) {
                var logOpts = {
                    stdout: 1,
                    stderr: 1,
                    tail: 50,
                    follow: 0
                };
                const container = docker.getContainer(instance.Id);
                // msg.result = await this.streamToString(await container.logs(logOpts as any));
                var s = await container.logs((logOpts as any) as Dockerode.ContainerLogsOptions);
                // msg.result = await this.streamToString(s);
                msg.result = s.toString();
                if (msg.result == null) msg.result = "";
                console.log(msg.result);
            }
        } catch (error) {
            span.recordException(error);
            this.data = "";
            await handleError(cli, error);
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error
            if (error.response && error.response.body && !NoderedUtil.IsNullEmpty(error.response.body.message)) {
                msg.error = error.response.body.message;
                if (msg !== null && msg !== undefined) msg.error = error.response.body.message
            }
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            span.recordException(error);
            this.data = "";
            await handleError(cli, error);
        }
        Logger.otel.endSpan(span);
        this.Send(cli);
    }
    private async KubeGetNoderedInstanceLog(cli: WebSocketServerClient, parent: Span): Promise<void> {
        this.Reply();
        let msg: GetNoderedInstanceLogMessage;
        const span: Span = Logger.otel.startSubSpan("message.GetNoderedInstanceLog", parent);
        try {
            Logger.instanse.debug("[" + cli.user.username + "] GetNoderedInstanceLog");
            msg = GetNoderedInstanceLogMessage.assign(this.data);
            var name = await this.GetInstanceName(msg._id, cli.user._id, cli.user.username, cli.jwt, span);
            const namespace = Config.namespace;
            if (!msg.instancename.startsWith(name + "-")) msg.instancename = "";

            const list = await KubeUtil.instance().CoreV1Api.listNamespacedPod(namespace);

            let image: string = "unknown";
            if (!NoderedUtil.IsNullEmpty(msg.instancename)) {
                if (list.body.items.length > 0) {
                    for (let i = 0; i < list.body.items.length; i++) {
                        const item = list.body.items[i];
                        if (msg.instancename == item.metadata.name) {
                            if (cli.user.HasRoleName("admins") || item.metadata.labels.app === name) {

                                Logger.instanse.debug("[" + cli.user.username + "] GetNoderedInstanceLog: " + name + " found one as " + item.metadata.name);
                                const obj = await await KubeUtil.instance().CoreV1Api.readNamespacedPodLog(item.metadata.name, namespace, "", false);
                                msg.result = obj.body;
                                Audit.NoderedAction(TokenUser.From(cli.user), true, name, "readpodlog", image, item.metadata.name, span);

                            }
                        }
                    }
                }
            }
            if (NoderedUtil.IsNullEmpty(msg.result)) {
                if (list.body.items.length > 0) {
                    for (let i = 0; i < list.body.items.length; i++) {
                        const item = list.body.items[i];
                        try {
                            image = item.spec.containers[0].image;
                        } catch (error) {

                        }
                        if (!NoderedUtil.IsNullEmpty(msg.name) && item.metadata.name == msg.name && cli.user.HasRoleName("admins")) {
                            Logger.instanse.debug("[" + cli.user.username + "] GetNoderedInstanceLog: " + name + " found one as " + item.metadata.name);
                            const obj = await await KubeUtil.instance().CoreV1Api.readNamespacedPodLog(item.metadata.name, namespace, "", false);
                            msg.result = obj.body;
                            Audit.NoderedAction(TokenUser.From(cli.user), true, name, "readpodlog", image, item.metadata.name, span);
                        } else if (item.metadata.labels.app === name) {
                            Logger.instanse.debug("[" + cli.user.username + "] GetNoderedInstanceLog: " + name + " found one as " + item.metadata.name);
                            const obj = await await KubeUtil.instance().CoreV1Api.readNamespacedPodLog(item.metadata.name, namespace, "", false);
                            msg.result = obj.body;
                            Audit.NoderedAction(TokenUser.From(cli.user), true, name, "readpodlog", image, item.metadata.name, span);
                        }
                    }
                }

            }
            if (NoderedUtil.IsNullUndefinded(msg.result)) {
                Audit.NoderedAction(TokenUser.From(cli.user), false, name, "readpodlog", image, null, span);
            }
        } catch (error) {
            span.recordException(error);
            this.data = "";
            await handleError(cli, error);
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error
            if (error.response && error.response.body && !NoderedUtil.IsNullEmpty(error.response.body.message)) {
                msg.error = error.response.body.message;
                if (msg !== null && msg !== undefined) msg.error = error.response.body.message
            }
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            span.recordException(error);
            this.data = "";
            await handleError(cli, error);
        }
        Logger.otel.endSpan(span);
        this.Send(cli);
    }
    private async StartNoderedInstance(cli: WebSocketServerClient, parent: Span): Promise<void> {
        this.Reply();
        const span: Span = Logger.otel.startSubSpan("message.StartNoderedInstance", parent);
        Audit.NoderedAction(TokenUser.From(cli.user), true, null, "startdeployment", null, null, span);
        Logger.otel.endSpan(span);
        this.Send(cli);
    }
    private async StopNoderedInstance(cli: WebSocketServerClient, parent: Span): Promise<void> {
        this.Reply();
        const span: Span = Logger.otel.startSubSpan("message.StopNoderedInstance", parent);
        Audit.NoderedAction(TokenUser.From(cli.user), true, null, "stopdeployment", null, null, span);
        Logger.otel.endSpan(span);
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
            if (!NoderedUtil.hasAuthorization(user, msg.metadata, Rights.create)) { throw new Error("Access denied, no authorization to save file"); }
            msg.id = await this._SaveFile(readable, msg.filename, msg.mimeType, msg.metadata);
        } catch (error) {
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
            await handleError(cli, error);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            await handleError(cli, error);
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
    private async GetFile(cli: WebSocketServerClient, parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("message.GetFile", parent);
        this.Reply();
        let msg: GetFileMessage
        try {
            msg = SaveFileMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            if (!NoderedUtil.IsNullEmpty(msg.id)) {
                const rows = await Config.db.query({ _id: safeObjectID(msg.id) }, null, 1, 0, null, "files", msg.jwt, undefined, undefined, span);
                if (rows.length == 0) { throw new Error("Not found"); }
                msg.metadata = (rows[0] as any).metadata
                msg.mimeType = (rows[0] as any).contentType;
            } else if (!NoderedUtil.IsNullEmpty(msg.filename)) {
                const rows = await Config.db.query({ "filename": msg.filename }, null, 1, 0, { uploadDate: -1 }, "fs.files", msg.jwt, undefined, undefined, span);
                if (rows.length == 0) { throw new Error("Not found"); }
                msg.id = rows[0]._id;
                msg.metadata = (rows[0] as any).metadata
                msg.mimeType = (rows[0] as any).contentType;
            } else {
                throw new Error("id or filename is mandatory");
            }
            msg.file = await this._GetFile(msg.id);
        } catch (error) {
            span.recordException(error);
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
            await handleError(cli, error);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            span.recordException(error);
            this.data = "";
            await handleError(cli, error);
        }
        Logger.otel.endSpan(span);
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
            if (!NoderedUtil.hasAuthorization(user, msg.metadata, Rights.update)) { throw new Error("Access denied, no authorization to update file"); }

            msg.metadata = Config.db.ensureResource(msg.metadata);
            const fsc = Config.db.db.collection("fs.files");
            DatabaseConnection.traversejsonencode(msg.metadata);
            const res = await fsc.updateOne(q, { $set: { metadata: msg.metadata } });

        } catch (error) {
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
            await handleError(cli, error);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            await handleError(cli, error);
        }
        this.Send(cli);
    }

    async CreateWorkflowInstance(cli: WebSocketServerClient, parent: Span) {
        this.Reply();
        const span: Span = Logger.otel.startSubSpan("message.CreateWorkflowInstance", parent);
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
                const res = await Config.db.query({ "_id": msg.workflowid }, null, 1, 0, null, "workflow", msg.jwt, undefined, undefined, span);
                if (res.length != 1) throw new Error("Unknown workflow id " + msg.workflowid);
                workflow = res[0];
                msg.queue = workflow.queue;
                if (NoderedUtil.IsNullEmpty(msg.name)) { msg.name = workflow.name; }
            }
            if (NoderedUtil.IsNullEmpty(msg.name)) throw new Error("name is mandatory when workflowid not set")

            if (msg.queue === msg.resultqueue) {
                throw new Error("Cannot reply to self queuename: " + msg.queue + " correlationId: " + msg.resultqueue);
            }

            const res = await Config.db.query({ "_id": msg.targetid }, null, 1, 0, null, "users", msg.jwt, undefined, undefined, span);
            if (res.length != 1) throw new Error("Unknown target id " + msg.targetid);
            workflow = res[0];
            msg.state = "new";
            msg.form = "unknown";
            (msg as any).workflow = msg.workflowid;

            if (NoderedUtil.IsNullEmpty(msg.correlationId)) {
                msg.correlationId = NoderedUtil.GetUniqueIdentifier();
            }

            const _data = Base.assign<Base>(msg as any);
            Base.addRight(_data, msg.targetid, "targetid", [-1]);
            Base.addRight(_data, cli.user._id, cli.user.name, [-1]);
            Base.addRight(_data, tuser._id, tuser.name, [-1]);
            _data._type = "instance";
            _data.name = msg.name;

            const res2 = await Config.db.InsertOne(_data, "workflow_instances", 1, true, msg.jwt, span);
            msg.newinstanceid = res2._id;

            if (msg.initialrun) {
                const message = { _id: res2._id, __jwt: msg.jwt, __user: tuser };
                amqpwrapper.Instance().sendWithReplyTo("", msg.queue, msg.resultqueue, message, Config.amqp_default_expiration, msg.correlationId, "");
            }
        } catch (error) {
            span.recordException(error);
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
            await handleError(cli, error);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            span.recordException(error);
            this.data = "";
            await handleError(cli, error);
        }
        Logger.otel.endSpan(span);
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
    async StripeCancelPlan(cli: WebSocketServerClient, parent: Span) {
        const span: Span = Logger.otel.startSubSpan("message.StripeCancelPlan", parent);
        this.Reply();
        let msg: StripeCancelPlanMessage;
        const rootjwt = Crypt.rootToken();
        try {
            msg = StripeAddPlanMessage.assign(this.data);
            if (NoderedUtil.IsNullUndefinded(msg.jwt)) msg.jwt = cli.jwt;
            if (NoderedUtil.IsNullUndefinded(msg.userid)) msg.userid = cli.user._id;

            const billings = await Config.db.query<Billing>({ userid: msg.userid, _type: "billing" }, null, 1, 0, null, "users", rootjwt, undefined, undefined, span);
            if (billings.length == 0) throw new Error("Need billing info and a stripe customer in order to cancel plan");
            const billing: Billing = billings[0];
            if (NoderedUtil.IsNullEmpty(billing.stripeid)) throw new Error("Need a stripe customer in order to cancel plan");
            const customer: stripe_customer = await this.Stripe<stripe_customer>("GET", "customers", billing.stripeid, null, null);
            if (customer == null) throw new Error("Failed locating stripe customer at stripe");


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
            span.recordException(error);
            await handleError(cli, error);
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) {
                msg.error = (error.message ? error.message : error);
                if (error.response && error.response.body) {
                    msg.error = error.response.body;
                }
            }
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            span.recordException(error);
            this.data = "";
            await handleError(cli, error);
        }
        Logger.otel.endSpan(span);
        this.Send(cli);
    }
    async StripeAddPlan(cli: WebSocketServerClient, parent: Span) {
        const span: Span = Logger.otel.startSubSpan("message.StripeAddPlan", parent);
        this.Reply();
        let msg: StripeAddPlanMessage;
        const rootjwt = Crypt.rootToken();
        try {
            msg = StripeAddPlanMessage.assign(this.data);
            if (NoderedUtil.IsNullUndefinded(msg.jwt)) msg.jwt = cli.jwt;
            if (NoderedUtil.IsNullUndefinded(msg.userid)) msg.userid = cli.user._id;

            const users = await Config.db.query({ _id: msg.userid, _type: "user" }, null, 1, 0, null, "users", msg.jwt, undefined, undefined, span);
            if (users.length == 0) throw new Error("Unknown userid");
            const user: User = users[0] as any;

            const billings = await Config.db.query<Billing>({ userid: msg.userid, _type: "billing" }, null, 1, 0, null, "users", rootjwt, undefined, undefined, span);
            let billing: Billing = null;
            if (billings.length == 1) billing = billings[0];
            if (billing == null) {
                billing = Billing.assign({ userid: msg.userid } as any);
                billing.name = user.name;
                billing.email = user.username;
                if (!NoderedUtil.IsNullEmpty(user.email)) billing.email = user.email
                Base.addRight(billing, user._id, user.name, [Rights.read]);
                Base.addRight(billing, WellknownIds.admins, "admins", [Rights.full_control]);
                billing = await Config.db.InsertOne(billing, "users", 3, true, rootjwt, span);
            }

            let customer: stripe_customer = null;
            if (billing != null && !NoderedUtil.IsNullEmpty(billing.stripeid)) {
                customer = await this.Stripe<stripe_customer>("GET", "customers", billing.stripeid, null, null);
            } else {
                var sessions: any = await this.Stripe("GET", "checkout.sessions", null, null, null);
                for (var cust of sessions.data) {
                    if (cust.client_reference_id == msg.userid) {
                    }
                }
                var customers: any = await this.Stripe("GET", "customers", null, null, null);
                for (var cust of customers.data) {
                    console.log(cust);
                }


            }
            let subscription: stripe_subscription = null;
            let subscription_item: stripe_subscription_item = null;

            if (customer != null) {
                const hasPlan = customer.subscriptions.data.filter(s => {
                    const arr = s.items.data.filter(y => y.plan.id == msg.planid);
                    if (arr.length == 1) {
                        subscription = s;
                        subscription_item = arr[0];
                        if (arr[0].quantity > 0) {
                            if ((subscription as any).cancel_at_period_end) {
                                (subscription as any).cancel_at_period_end = false;
                            } else {
                                var test = arr[0];
                                console.log(test);
                                return true;
                            }
                        }
                    } else if (subscription == null) { subscription = s; }
                    return false;
                });
                // if (hasPlan.length > 0) {
                //     throw new Error("Customer already has this plan");
                // }
            }

            if (subscription != null) {
                await this.Stripe("POST", "subscriptions", subscription.id, { cancel_at_period_end: false }, customer.id);
            }
            // if (subscription != null && subscription.default_tax_rates.length == 0 && !NoderedUtil.IsNullEmpty(billing.taxrate)) {
            //     const payload: any = { default_tax_rates: [billing.taxrate] };
            //     await this.Stripe("POST", "subscriptions", subscription.id, payload, customer.id);
            // } else if (subscription != null && subscription.default_tax_rates.length != 0 && NoderedUtil.IsNullEmpty(billing.taxrate)) {
            //     const payload: any = { default_tax_rates: [] };
            //     await this.Stripe("POST", "subscriptions", subscription.id, payload, customer.id);
            // }

            const plan = await this.Stripe<stripe_plan>("GET", "plans", msg.planid, null, null);
            if (subscription == null) {
                const baseurl = Config.baseurl() + "/#/Payment";
                const payload: any = {
                    client_reference_id: cli.user._id,
                    success_url: baseurl + "/" + cli.user._id, cancel_url: baseurl + "/" + cli.user._id,
                    payment_method_types: ["card"], mode: "subscription",
                    subscription_data: {
                        items: [],
                    }
                };
                if (customer != null && NoderedUtil.IsNullEmpty(customer.id)) {
                    payload.customer = customer.id;
                }
                payload.subscription_data.items.push({ plan: msg.planid });
                msg.checkout = await this.Stripe("POST", "checkout.sessions", null, payload, null);
            } else {
                if (plan.usage_type != "metered" && subscription_item != null) {
                    for (var item of subscription.items.data) {
                        const payload: any = { quantity: 0 };
                        if (item.plan.id == msg.planid) {
                            payload.quantity = 1;
                        }
                        if (item.plan.usage_type != "metered") {
                            if (payload.quantity == 0) {
                                const res = await this.Stripe("DELETE", "subscription_items", item.id, payload, customer.id);
                            } else {
                                const res = await this.Stripe("POST", "subscription_items", item.id, payload, customer.id);
                            }
                        } else {
                            const hours: any = await this.Stripe("GET", "usage_record_summaries", item.id, null, null);
                            let deleteit: boolean = true;
                            if (hours.data.length > 0) {
                                if (hours.data[0].total_usage > 0 && hours.data[0].invoice == null) {
                                    deleteit = false;
                                }
                            }
                            if (deleteit) {
                                const res = await this.Stripe("DELETE", "subscription_items", item.id, payload, customer.id);
                            }
                        }

                    }
                    // }
                    // if (subscription_item != null) {
                    //     const payload: any = { quantity: 1 };
                    //     if (plan.usage_type != "metered") {
                    //         const res = await this.Stripe("POST", "subscription_items", subscription_item.id, payload, customer.id);
                    //     }
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
            span.recordException(error);
            await handleError(cli, error);
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) {
                msg.error = (error.message ? error.message : error);
                if (error.response && error.response.body) {
                    msg.error = error.response.body;
                }
            }
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            span.recordException(error);
            this.data = "";
            await handleError(cli, error);
        }
        Logger.otel.endSpan(span);
        this.Send(cli);
    }
    async StripeAddPlanOld(cli: WebSocketServerClient, parent: Span) {
        const span: Span = Logger.otel.startSubSpan("message.StripeAddPlan", parent);
        this.Reply();
        let msg: StripeAddPlanMessage;
        const rootjwt = Crypt.rootToken();
        try {
            msg = StripeAddPlanMessage.assign(this.data);
            if (NoderedUtil.IsNullUndefinded(msg.jwt)) msg.jwt = cli.jwt;
            if (NoderedUtil.IsNullUndefinded(msg.userid)) msg.userid = cli.user._id;

            const billings = await Config.db.query<Billing>({ userid: msg.userid, _type: "billing" }, null, 1, 0, null, "users", rootjwt, undefined, undefined, span);
            if (billings.length == 0) throw new Error("Need billing info and a stripe customer in order to add plan");
            const billing: Billing = billings[0];
            if (NoderedUtil.IsNullEmpty(billing.stripeid)) throw new Error("Need a stripe customer in order to add plan");
            const customer: stripe_customer = await this.Stripe<stripe_customer>("GET", "customers", billing.stripeid, null, null);
            if (customer == null) throw new Error("Failed locating stripe customer at stripe");

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
            span.recordException(error);
            await handleError(cli, error);
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) {
                msg.error = (error.message ? error.message : error);
                if (error.response && error.response.body) {
                    msg.error = error.response.body;
                }
            }
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            span.recordException(error);
            this.data = "";
            await handleError(cli, error);
        }
        Logger.otel.endSpan(span);
        this.Send(cli);
    }
    async EnsureStripeCustomer(cli: WebSocketServerClient, parent: Span) {
        this.Reply();
        const span: Span = Logger.otel.startSubSpan("message.EnsureStripeCustomer", parent);
        let msg: EnsureStripeCustomerMessage;
        const rootjwt = Crypt.rootToken();
        try {
            msg = EnsureStripeCustomerMessage.assign(this.data);
            if (NoderedUtil.IsNullUndefinded(msg.jwt)) msg.jwt = cli.jwt;
            if (NoderedUtil.IsNullUndefinded(msg.userid)) msg.userid = cli.user._id;
            const users = await Config.db.query({ _id: msg.userid, _type: "user" }, null, 1, 0, null, "users", msg.jwt, undefined, undefined, span);
            if (users.length == 0) throw new Error("Unknown userid");
            const user: User = users[0] as any;
            let dirty: boolean = false;
            let hasbilling: boolean = false;

            const billings = await Config.db.query<Billing>({ userid: msg.userid, _type: "billing" }, null, 1, 0, null, "users", rootjwt, undefined, undefined, span);
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
                billing = await Config.db.InsertOne(billing, "users", 3, true, rootjwt, span);
            } else {
                billing = billings[0];
                if (billing.email != msg.billing.email || billing.vatnumber != msg.billing.vatnumber || billing.vattype != msg.billing.vattype || billing.coupon != msg.billing.coupon) {
                    billing.email = msg.billing.email;
                    billing.vatnumber = msg.billing.vatnumber;
                    billing.vattype = msg.billing.vattype;
                    billing.coupon = msg.billing.coupon;
                    billing = await Config.db._UpdateOne(null, billing, "users", 3, true, rootjwt, span);
                }
            }
            let customer: stripe_customer;
            if (!NoderedUtil.IsNullEmpty(billing.stripeid)) {
                customer = await this.Stripe<stripe_customer>("GET", "customers", billing.stripeid, null, null);
            }
            let payload: any = { name: billing.name, email: billing.email, metadata: { userid: msg.userid }, description: user.name };
            if (customer == null) {
                customer = await this.Stripe<stripe_customer>("POST", "customers", null, payload, null);
                billing.stripeid = customer.id;
                billing = await Config.db._UpdateOne(null, billing, "users", 3, true, rootjwt, span);
            }
            if (customer != null && !NoderedUtil.IsNullEmpty(billing.vattype) && !NoderedUtil.IsNullEmpty(billing.vatnumber)) {
                // if (customer.tax_ids.total_count == 0) {
                //     (payload as any) = { value: billing.vatnumber, type: billing.vattype };
                //     await this.Stripe<stripe_customer>("POST", "tax_ids", null, payload, customer.id);
                //     dirty = true;
                // }
            }

            // if ((billing.tax != 1 || billing.taxrate != "") && customer.tax_ids.total_count > 0) {
            //     if (customer.tax_ids.data[0].verification.status == 'verified' || customer.tax_ids.data[0].verification.status == 'unavailable') {
            //         if (customer.tax_ids.data[0].verification.status == 'verified') {
            //             if (billing.name != customer.tax_ids.data[0].verification.verified_name ||
            //                 billing.address != customer.tax_ids.data[0].verification.verified_address) {
            //                 billing.name = customer.tax_ids.data[0].verification.verified_name;
            //                 billing.address = customer.tax_ids.data[0].verification.verified_address;
            //                 dirty = true;
            //             }
            //         }
            //         if ((billing.tax != 1 || billing.taxrate != "") && customer.tax_ids.data[0].country != "DK") {
            //             billing.tax = 1;
            //             billing.taxrate = "";
            //             dirty = true;
            //         }
            //         if (dirty == true) {
            //             billing = await Config.db._UpdateOne(null, billing, "users", 3, true, rootjwt, span);
            //         }
            //     }
            // } else if (billing.tax == 1 && customer.tax_ids.total_count == 0) {
            //     const tax_rates = await this.Stripe<stripe_list<stripe_base>>("GET", "tax_rates", null, null, null);
            //     if (tax_rates == null || tax_rates.total_count == 0) throw new Error("Failed getting tax_rates from stripe");
            //     billing.taxrate = tax_rates.data[0].id;
            //     billing.tax = 1 + ((tax_rates.data[0] as any).percentage / 100);
            //     billing = await Config.db._UpdateOne(null, billing, "users", 3, true, rootjwt, span);
            // } else if (customer.tax_ids.total_count > 0 && (customer.tax_ids.data[0].verification.status != 'verified' &&
            //     customer.tax_ids.data[0].verification.status != 'unavailable') && billing.tax == 1) {
            //     const tax_rates = await this.Stripe<stripe_list<stripe_base>>("GET", "tax_rates", null, null, null);
            //     if (tax_rates == null || tax_rates.total_count == 0) throw new Error("Failed getting tax_rates from stripe");
            //     billing.taxrate = tax_rates.data[0].id;
            //     billing.tax = 1 + ((tax_rates.data[0] as any).percentage / 100);
            //     billing = await Config.db._UpdateOne(null, billing, "users", 3, true, rootjwt, span);
            // }
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
                billing = await Config.db._UpdateOne(null, billing, "users", 3, true, rootjwt, span);
                this._EnsureNoderedInstance(msg.userid, true, span);
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
                    billing = await Config.db._UpdateOne(null, billing, "users", 3, true, rootjwt, span);
                }
            }
            if (customer != null && billing != null) {
                let openflowuserplan: string = "";
                let supportplan: string = "";
                let supporthourplan: string = "";
                if (customer.subscriptions != null && customer.subscriptions.data != null) {
                    const outarr = customer.subscriptions.data.filter(s => {
                        const inarr = s.items.data.filter(y => {
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
                }
                if (billing.openflowuserplan != openflowuserplan || billing.supportplan != supportplan || billing.supporthourplan != supporthourplan) {
                    billing.openflowuserplan = openflowuserplan;
                    billing.supportplan = supportplan;
                    billing.supporthourplan = supporthourplan;
                    billing = await Config.db._UpdateOne(null, billing, "users", 3, true, rootjwt, span);
                }
            }

            hasbilling = (customer != null);
            if (user._hasbilling != hasbilling) {
                user._hasbilling = hasbilling;
                await Config.db._UpdateOne(null, user, "users", 3, true, rootjwt, span);
            }
            msg.customer = customer;

        } catch (error) {
            span.recordException(error);
            await handleError(cli, error);
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) {
                msg.error = (error.message ? error.message : error);
                if (error.response && error.response.body) {
                    msg.error = error.response.body;
                }
            }
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            span.recordException(error);
            this.data = "";
            await handleError(cli, error);
        }
        Logger.otel.endSpan(span);
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
        if (object == "usage_record_summaries") {
            url = "https://api.stripe.com/v1/subscription_items/" + id + "/usage_record_summaries";
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
                if (msg.object != "plans" && msg.object != "subscription_items" && msg.object != "invoices_upcoming" && msg.object != "billing_portal/sessions") {
                    throw new Error("Access to " + msg.object + " is not allowed");
                }

                if (msg.object == "subscription_items" && msg.method != "POST") throw new Error("Access to " + msg.object + " is not allowed");
                if (msg.object == "plans" && msg.method != "GET") throw new Error("Access to " + msg.object + " is not allowed");
                if (msg.object == "invoices_upcoming" && msg.method != "GET") throw new Error("Access to " + msg.object + " is not allowed");
            }
            msg.payload = await this.Stripe(msg.method, msg.object, msg.id, msg.payload, msg.customerid);
        } catch (error) {
            await handleError(cli, error);
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) {
                msg.error = (error.message ? error.message : error);
                if (error.response && error.response.body) {
                    msg.error = error.response.body;
                }
            }
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            await handleError(cli, error);
        }
        this.Send(cli);
    }


    // https://dominik.sumer.dev/blog/stripe-checkout-eu-vat
    async EnsureCustomer(cli: WebSocketServerClient, parent: Span) {
        this.Reply();
        const span: Span = Logger.otel.startSubSpan("message.EnsureCustomer", parent);
        let msg: EnsureCustomerMessage;
        const rootjwt = Crypt.rootToken();
        try {
            msg = EnsureCustomerMessage.assign(this.data);
            if (NoderedUtil.IsNullUndefinded(msg.jwt)) msg.jwt = cli.jwt;
            if (NoderedUtil.IsNullUndefinded(msg.userid)) msg.userid = cli.user._id;
            let user: User;
            if (msg.userid != cli.user._id) {
                const users = await Config.db.query({ _id: msg.userid, _type: "user" }, null, 1, 0, null, "users", msg.jwt, undefined, undefined, span);
                if (users.length == 0) throw new Error("Unknown userid");
                user = users[0] as any;
            } else {
                user = cli.user;
            }

            const customers = await Config.db.query<Customer>({ userid: msg.userid, _type: "customer" }, null, 1, 0, null, "users", rootjwt, undefined, undefined, span);
            if (customers.length == 0) {
                if (msg.customer != null) msg.customer = Customer.assign(msg.customer);
                if (msg.customer == null) msg.customer = new Customer(user._id);
                msg.customer.userid = user._id;
                if (NoderedUtil.IsNullEmpty(msg.customer.name)) {
                    if (!NoderedUtil.IsNullEmpty((user as any).customer)) {
                        msg.customer.name = (user as any).customer;
                    } else {
                        msg.customer.name = user.name;
                    }
                }
                if (NoderedUtil.IsNullEmpty(msg.customer.email)) {
                    if (!NoderedUtil.IsNullEmpty((user as any).email)) {
                        msg.customer.email = (user as any).email;
                    } else {
                        msg.customer.email = user.username;
                    }
                }
                Base.addRight(msg.customer, user._id, user.name, [Rights.read]);
                Base.addRight(msg.customer, WellknownIds.admins, "admins", [Rights.full_control]);
            } else {
                let customer: Customer = customers[0];
                // msg.customer = customers[0];
                if (customer.name != msg.customer.name || customer.email != msg.customer.email || customer.vatnumber != msg.customer.vatnumber || customer.vattype != msg.customer.vattype || customer.coupon != msg.customer.coupon) {
                    customer.email = msg.customer.email;
                    customer.name = msg.customer.name;
                    customer.vatnumber = msg.customer.vatnumber;
                    customer.vattype = msg.customer.vattype;
                    customer.coupon = msg.customer.coupon;
                }
                msg.customer = customer;
            }
            if (!NoderedUtil.IsNullEmpty(msg.customer.stripeid)) {
                msg.stripecustomer = await this.Stripe<stripe_customer>("GET", "customers", msg.customer.stripeid, null, null);
            } else {
                let payload: any = { name: msg.customer.name, email: msg.customer.email, metadata: { userid: msg.userid }, description: user.name };
                msg.stripecustomer = await this.Stripe<stripe_customer>("POST", "customers", null, payload, null);
                msg.customer.stripeid = msg.stripecustomer.id;
            }
            if (msg.stripecustomer.email != msg.customer.email || msg.stripecustomer.name != msg.customer.name) {
                const payload: any = { email: msg.customer.email, name: msg.customer.name };
                msg.stripecustomer = await this.Stripe<stripe_customer>("POST", "customers", msg.customer.stripeid, payload, null);
            }
            if (msg.customer.vatnumber) {
                if (msg.stripecustomer.tax_ids.total_count == 0) {
                    const payload: any = { value: msg.customer.vatnumber, type: msg.customer.vattype };
                    await this.Stripe<stripe_customer>("POST", "tax_ids", null, payload, msg.customer.stripeid);
                } else if (msg.stripecustomer.tax_ids.data[0].value != msg.customer.vatnumber) {
                    const payload: any = { value: msg.customer.vatnumber, type: msg.customer.vattype };
                    await this.Stripe<stripe_tax_id>("PUT", "tax_ids", msg.stripecustomer.tax_ids.data[0].id, payload, msg.customer.stripeid);
                }
            }

            if (!NoderedUtil.IsNullUndefinded(msg.stripecustomer.discount) && !NoderedUtil.IsNullEmpty(msg.stripecustomer.discount.coupon.name)) {
                if (msg.customer.coupon != msg.stripecustomer.discount.coupon.name) {
                    const payload: any = { coupon: "" };
                    msg.stripecustomer = await this.Stripe<stripe_customer>("POST", "customers", msg.customer.stripeid, payload, null);

                    if (!NoderedUtil.IsNullEmpty(msg.customer.coupon)) {
                        const coupons: stripe_list<stripe_coupon> = await this.Stripe<stripe_list<stripe_coupon>>("GET", "coupons", null, null, null);
                        const isvalid = coupons.data.filter(c => c.name == msg.customer.coupon);
                        if (isvalid.length == 0) throw new Error("Unknown coupons '" + msg.customer.coupon + "'");

                        const payload2: any = { coupon: coupons.data[0].id };
                        msg.stripecustomer = await this.Stripe<stripe_customer>("POST", "customers", msg.customer.stripeid, payload2, null);
                    }
                }
            } else if (!NoderedUtil.IsNullEmpty(msg.customer.coupon)) {
                const coupons: stripe_list<stripe_coupon> = await this.Stripe<stripe_list<stripe_coupon>>("GET", "coupons", null, null, null);
                const isvalid = coupons.data.filter(c => c.name == msg.customer.coupon);
                if (isvalid.length == 0) throw new Error("Unknown coupons '" + msg.customer.coupon + "'");

                const payload2: any = { coupon: coupons.data[0].id };
                msg.stripecustomer = await this.Stripe<stripe_customer>("POST", "customers", msg.customer.stripeid, payload2, null);
            }
            if (NoderedUtil.IsNullEmpty(msg.customer._id)) {
                await Config.db.InsertOne(msg.customer, "users", 3, true, rootjwt, span);
            } else {
                await Config.db._UpdateOne(null, msg.customer, "users", 3, true, rootjwt, span);
            }
            if (user._hasbilling != true || user.customerid != msg.customer._id) {
                user._hasbilling = true;
                user.customerid = msg.customer._id;
                user.selectedcustomerid = msg.customer._id;

                const UpdateDoc: any = { "$set": {} };
                UpdateDoc.$set["customerid"] = msg.customer._id;
                UpdateDoc.$set["selectedcustomerid"] = msg.customer._id;
                UpdateDoc.$set["_hasbilling"] = true;
                await Config.db._UpdateOne({ "_id": user._id }, UpdateDoc, "users", 1, false, Crypt.rootToken(), span)
            }
            if (cli.user.selectedcustomerid != msg.customer._id && cli.user._id != msg.userid) {
                cli.user.selectedcustomerid = msg.customer._id;
                const UpdateDoc: any = { "$set": {} };
                UpdateDoc.$set["selectedcustomerid"] = msg.customer._id;
                await Config.db._UpdateOne({ "_id": cli.user._id }, UpdateDoc, "users", 1, false, Crypt.rootToken(), span)
            }
        } catch (error) {
            span.recordException(error);
            await handleError(cli, error);
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) {
                msg.error = (error.message ? error.message : error);
                if (error.response && error.response.body) {
                    msg.error = error.response.body;
                }
            }
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            span.recordException(error);
            this.data = "";
            await handleError(cli, error);
        }
        Logger.otel.endSpan(span);
        this.Send(cli);
    private async Housekeeping(parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("message.QueueMessage", parent);
        try {
            await this.GetNoderedInstance(span)
        } catch (error) {
        }
        try {
            await Config.db.ensureindexes(span);
        } catch (error) {
        }
        try {
            const jwt: string = Crypt.rootToken();
            const timestamp = new Date(new Date().toISOString());
            timestamp.setUTCHours(0, 0, 0, 0);
            const collections = await Config.db.ListCollections(jwt);
            for (let col of collections) {
                Config.db.db.collection("dbusage").deleteMany({ timestamp: timestamp, collection: col.name });
                let aggregates: any = [
                    {
                        "$project": {
                            "_modifiedbyid": 1,
                            "_modifiedby": 1,
                            "object_size": { "$bsonSize": "$$ROOT" }
                        }
                    },
                    {
                        "$group": {
                            "_id": "$_modifiedbyid",
                            "size": { "$sum": "$object_size" },
                            "name": { "$max": "$_modifiedby" }
                        }
                    },
                    { $addFields: { "userid": "$_id" } },
                    { $unset: "_id" },
                    { $addFields: { "collection": col.name } },
                    { $addFields: { timestamp: timestamp.toISOString() } },
                ];
                if (col.name == "fs.files") {
                    aggregates = [
                        {
                            "$project": {
                                "_modifiedbyid": "$metadata._modifiedbyid",
                                "_modifiedby": "$metadata._modifiedby",
                                "object_size": "$length"
                            }
                        },
                        {
                            "$group": {
                                "_id": "$_modifiedbyid",
                                "size": { "$sum": "$object_size" },
                                "name": { "$max": "$_modifiedby" }
                            }
                        },
                        { $addFields: { "userid": "$_id" } },
                        { $unset: "_id" },
                        { $addFields: { "collection": col.name } },
                        { $addFields: { timestamp: timestamp.toISOString() } },
                    ]
                }
                if (col.name == "fs.files") {
                    aggregates = [
                        {
                            "$project": {
                                "userid": 1,
                                "name": 1,
                                "object_size": { "$bsonSize": "$$ROOT" }
                            }
                        },
                        {
                            "$group": {
                                "_id": "$userid",
                                "size": { "$sum": "$object_size" },
                                "name": { "$max": "$name" }
                            }
                        },
                        { $addFields: { "userid": "$_id" } },
                        { $unset: "_id" },
                        { $addFields: { "collection": col.name } },
                        { $addFields: { timestamp: timestamp.toISOString() } },
                    ]
                }

                const items: any[] = await Config.db.db.collection(col.name).aggregate(aggregates).toArray();
                let bulkInsert = Config.db.db.collection("dbusage").initializeUnorderedBulkOp();
                items.forEach(item => bulkInsert.insert(item));
                bulkInsert.execute();
            }
        } catch (error) {

        }
        Logger.otel.endSpan(span);
    }
}

export class JSONfn {
    public static stringify(obj) {
        return JSON.stringify(obj, function (key, value) {
            return (typeof value === 'function') ? value.toString() : value;
        });
    }
    // insecure and unused, keep for reference
    // public static parse(str) {
    //     return JSON.parse(str, function (key, value) {
    //         if (typeof value != 'string') return value;
    //         return (value.substring(0, 8) == 'function') ? eval('(' + value + ')') : value;
    //     });
    // }
}