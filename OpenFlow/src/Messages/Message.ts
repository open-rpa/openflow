import * as os from "os";
const Docker = require("dockerode");
import { lookup } from "mimetype";
import { SocketMessage } from "../SocketMessage";
import { Auth } from "../Auth";
import { Crypt } from "../Crypt";
import * as url from "url";
import { Config } from "../Config";
import { Audit, tokenType } from "../Audit";
import { LoginProvider } from "../LoginProvider";
import { KubeUtil } from "../KubeUtil";
import { Readable, Stream } from "stream";
import { GridFSBucket, ObjectID, Cursor } from "mongodb";
import * as path from "path";
import { DatabaseConnection } from "../DatabaseConnection";
import { StripeMessage, NoderedUtil, QueuedMessage, RegisterQueueMessage, QueueMessage, CloseQueueMessage, ListCollectionsMessage, DropCollectionMessage, QueryMessage, AggregateMessage, InsertOneMessage, UpdateOneMessage, Base, UpdateManyMessage, InsertOrUpdateOneMessage, DeleteOneMessage, MapReduceMessage, SigninMessage, TokenUser, User, Rights, EnsureNoderedInstanceMessage, DeleteNoderedInstanceMessage, DeleteNoderedPodMessage, RestartNoderedInstanceMessage, GetNoderedInstanceMessage, GetNoderedInstanceLogMessage, SaveFileMessage, WellknownIds, GetFileMessage, UpdateFileMessage, CreateWorkflowInstanceMessage, RegisterUserMessage, NoderedUser, WatchMessage, GetDocumentVersionMessage, DeleteManyMessage, InsertManyMessage, GetKubeNodeLabels, RegisterExchangeMessage, EnsureCustomerMessage, Customer, stripe_tax_id, Role, SelectCustomerMessage, Rolemember, ResourceUsage, Resource, ResourceVariant, stripe_subscription, GetNextInvoiceMessage, stripe_invoice, stripe_price, stripe_plan, stripe_invoice_line } from "@openiap/openflow-api";
import { stripe_customer, stripe_list, StripeAddPlanMessage, StripeCancelPlanMessage, stripe_subscription_item, stripe_coupon } from "@openiap/openflow-api";
import { V1ResourceRequirements, V1Deployment } from "@kubernetes/client-node";
import { amqpwrapper, QueueMessageOptions } from "../amqpwrapper";
import { WebSocketServerClient } from "../WebSocketServerClient";
import { DBHelper } from "../DBHelper";
import { WebSocketServer } from "../WebSocketServer";
import { OAuthProvider } from "../OAuthProvider";
import { Span } from "@opentelemetry/api";
import { Logger } from "../Logger";
import Dockerode = require("dockerode");
import { QueueClient } from "../QueueClient";
import { use } from "passport";
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
            if (Config.log_errors && Config.log_error_stack) {
                Logger.instanse.error(error);
            } else if (Config.log_errors) {
                Logger.instanse.error(error.message ? error.message : error);
            }
            return;
        }
        if (NoderedUtil.IsNullEmpty(_hostname)) _hostname = (Config.getEnv("HOSTNAME", undefined) || os.hostname()) || "unknown";
        errorcounter++;
        if (!NoderedUtil.IsNullUndefinded(WebSocketServer.websocket_errors)) WebSocketServer.websocket_errors.bind({ ...Logger.otel.defaultlabels }).update(errorcounter);
        if (Config.socket_rate_limit) await ErrorRateLimiter.consume(cli.id);
        if (Config.log_errors && Config.log_error_stack) {
            Logger.instanse.error(error);
        } else if (Config.log_errors) {
            Logger.instanse.error(error.message ? error.message : error);
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
    public options: QueueMessageOptions;
    public async QueueProcess(options: QueueMessageOptions, parent: Span): Promise<void> {
        let span: Span = undefined;
        try {
            this.options = options;
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
                case "housekeeping":
                    await this.Housekeeping(false, false, false, span);
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

    public EnsureJWT(cli: WebSocketServerClient): boolean {
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

            this.Reply("error");
            this.data = "{\"message\": \"Not signed in, and missing jwt\"}";
            cli.Send(this);
            return false;
        }
        return true;
    }
    public async Process(cli: WebSocketServerClient): Promise<void> {
        if (cli.devnull) return;
        let span: Span = undefined;
        try {
            let username: string = "Unknown";
            if (!NoderedUtil.IsNullUndefinded(cli.user)) { username = cli.user.username; }

            if (!NoderedUtil.IsNullEmpty(this.command)) { this.command = this.command.toLowerCase(); }
            let command: string = this.command;
            cli.lastheartbeat = new Date();
            cli.lastheartbeatstr = new Date().toISOString();
            const now = new Date();
            const seconds = (now.getTime() - cli.lastheartbeat.getTime()) / 1000;
            cli.lastheartbeatsec = seconds.toString();
            if (command == "ping" || command == "pong") {
                if (command == "ping") this.Ping(cli);
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
                    if (!this.EnsureJWT(cli)) break;
                    if (Config.enable_openflow_amqp) {
                        cli.Send(await QueueClient.SendForProcessing(this, this.priority));
                    } else {
                        await this.ListCollections(span);
                        cli.Send(this);
                    }
                    break;
                case "dropcollection":
                    if (!this.EnsureJWT(cli)) break;
                    if (Config.enable_openflow_amqp) {
                        cli.Send(await QueueClient.SendForProcessing(this, this.priority));
                    } else {
                        await this.DropCollection(span);
                        cli.Send(this);
                    }
                    break;
                case "query":
                    if (!this.EnsureJWT(cli)) break;
                    if (Config.enable_openflow_amqp) {
                        cli.Send(await QueueClient.SendForProcessing(this, this.priority));
                    } else {
                        await this.Query(span);
                        cli.Send(this);
                    }
                    break;
                case "getdocumentversion":
                    if (!this.EnsureJWT(cli)) break;
                    if (Config.enable_openflow_amqp) {
                        cli.Send(await QueueClient.SendForProcessing(this, this.priority));
                    } else {
                        await this.GetDocumentVersion(span);
                        cli.Send(this);
                    }
                    break;
                case "aggregate":
                    if (!this.EnsureJWT(cli)) break;
                    if (Config.enable_openflow_amqp) {
                        cli.Send(await QueueClient.SendForProcessing(this, this.priority));
                    } else {
                        await this.Aggregate(span);
                        cli.Send(this);
                    }
                    break;
                case "watch":
                    if (!this.EnsureJWT(cli)) break;
                    await this.Watch(cli);
                    break;
                case "unwatch":
                    if (!this.EnsureJWT(cli)) break;
                    await this.UnWatch(cli);
                    break;
                case "insertone":
                    if (!this.EnsureJWT(cli)) break;
                    if (Config.enable_openflow_amqp) {
                        cli.Send(await QueueClient.SendForProcessing(this, this.priority));
                    } else {
                        await this.InsertOne(span);
                        cli.Send(this);
                    }
                    break;
                case "insertmany":
                    if (!this.EnsureJWT(cli)) break;
                    if (Config.enable_openflow_amqp) {
                        cli.Send(await QueueClient.SendForProcessing(this, this.priority));
                    } else {
                        await this.InsertMany(span);
                        cli.Send(this);
                    }
                    break;
                case "updateone":
                    if (!this.EnsureJWT(cli)) break;
                    if (Config.enable_openflow_amqp) {
                        cli.Send(await QueueClient.SendForProcessing(this, this.priority));
                    } else {
                        await this.UpdateOne(span);
                        cli.Send(this);
                    }
                    break;
                case "updatemany":
                    if (!this.EnsureJWT(cli)) break;
                    if (Config.enable_openflow_amqp) {
                        cli.Send(await QueueClient.SendForProcessing(this, this.priority));
                    } else {
                        await this.UpdateMany(span);
                        cli.Send(this);
                    }
                    break;
                case "insertorupdateone":
                    if (!this.EnsureJWT(cli)) break;
                    if (Config.enable_openflow_amqp) {
                        cli.Send(await QueueClient.SendForProcessing(this, this.priority));
                    } else {
                        await this.InsertOrUpdateOne(span);
                        cli.Send(this);
                    }
                    break;
                case "deleteone":
                    if (!this.EnsureJWT(cli)) break;
                    if (Config.enable_openflow_amqp) {
                        cli.Send(await QueueClient.SendForProcessing(this, this.priority));
                    } else {
                        await this.DeleteOne(span);
                        cli.Send(this);
                    }
                    break;
                case "deletemany":
                    if (!this.EnsureJWT(cli)) break;
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
                    if (!this.EnsureJWT(cli)) break;
                    await this.MapReduce(cli);
                    break;
                case "refreshtoken":
                    break;
                case "error":
                    // this.Ping(cli);
                    break;
                case "registerqueue":
                    if (!this.EnsureJWT(cli)) break;
                    await this.RegisterQueue(cli, span);
                    break;
                case "registerexchange":
                    if (!this.EnsureJWT(cli)) break;
                    await this.RegisterExchange(cli, span);
                    break;
                case "queuemessage":
                    if (!this.EnsureJWT(cli)) break;
                    await this.QueueMessage(cli, span);
                    break;
                case "closequeue":
                    if (!this.EnsureJWT(cli)) break;
                    await this.CloseQueue(cli, span);
                    break;
                case "ensurenoderedinstance":
                    if (!this.EnsureJWT(cli)) break;
                    if (Config.enable_openflow_amqp) {
                        cli.Send(await QueueClient.SendForProcessing(this, this.priority));
                    } else {
                        await this.EnsureNoderedInstance(span);
                        cli.Send(this);
                    }
                    await this.ReloadUserToken(cli, span);
                    break;
                case "deletenoderedinstance":
                    if (!this.EnsureJWT(cli)) break;
                    if (Config.enable_openflow_amqp) {
                        cli.Send(await QueueClient.SendForProcessing(this, this.priority));
                    } else {
                        await this.DeleteNoderedInstance(span);
                        cli.Send(this);
                    }
                    break;
                case "restartnoderedinstance":
                    if (!this.EnsureJWT(cli)) break;
                    if (Config.enable_openflow_amqp) {
                        cli.Send(await QueueClient.SendForProcessing(this, this.priority));
                    } else {
                        await this.RestartNoderedInstance(span);
                        cli.Send(this);
                    }
                    break;
                case "getkubenodelabels":
                    if (!this.EnsureJWT(cli)) break;
                    await this.GetKubeNodeLabels(cli);
                    break;
                case "getnoderedinstance":
                    if (!this.EnsureJWT(cli)) break;
                    if (Config.enable_openflow_amqp) {
                        cli.Send(await QueueClient.SendForProcessing(this, this.priority));
                    } else {
                        await this.GetNoderedInstance(span);
                        cli.Send(this);
                    }
                    break;
                case "getnoderedinstancelog":
                    if (!this.EnsureJWT(cli)) break;
                    await this.GetNoderedInstanceLog(cli, span);
                    break;
                case "startnoderedinstance":
                    if (!this.EnsureJWT(cli)) break;
                    await this.StartNoderedInstance(cli, span);
                    break;
                case "stopnoderedinstance":
                    if (!this.EnsureJWT(cli)) break;
                    await this.StopNoderedInstance(cli, span);
                    break;
                case "deletenoderedpod":
                    if (!this.EnsureJWT(cli)) break;
                    if (Config.enable_openflow_amqp) {
                        cli.Send(await QueueClient.SendForProcessing(this, this.priority));
                    } else {
                        await this.DeleteNoderedPod(span);
                        cli.Send(this);
                    }
                    break;
                case "savefile":
                    if (!this.EnsureJWT(cli)) break;
                    await this.SaveFile(cli);
                    break;
                case "getfile":
                    if (!this.EnsureJWT(cli)) break;
                    await this.GetFile(cli, span);
                    break;
                case "updatefile":
                    if (!this.EnsureJWT(cli)) break;
                    await this.UpdateFile(cli);
                    break;
                case "createworkflowinstance":
                    if (!this.EnsureJWT(cli)) break;
                    await this.CreateWorkflowInstance(cli, span);
                    break;
                case "stripeaddplan":
                    if (!this.EnsureJWT(cli)) break;
                    await this.StripeAddPlan(cli, span);
                    break;
                case "getnextinvoice":
                    if (!this.EnsureJWT(cli)) break;
                    await this.GetNextInvoice(cli, span);
                    break;
                case "stripecancelplan":
                    if (!this.EnsureJWT(cli)) break;
                    await this.StripeCancelPlan(cli, span);
                    break;
                case "ensurestripecustomer":
                    if (!this.EnsureJWT(cli)) break;
                    this.Reply();
                    this.Send(cli);
                    break;
                case "stripemessage":
                    if (!this.EnsureJWT(cli)) break;
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
                    break;
                case "selectcustomer":
                    if (!this.EnsureJWT(cli)) break;
                    var user = await this.SelectCustomer(span);
                    if (user != null) cli.user.selectedcustomerid = user.selectedcustomerid;
                    this.ReloadUserToken(cli, span);
                    cli.Send(this);
                    break;
                case "housekeeping":
                    if (!this.EnsureJWT(cli)) break;
                    if (Config.enable_openflow_amqp) {
                        cli.Send(await QueueClient.SendForProcessing(this, this.priority));
                    } else {
                        await this.DeleteNoderedPod(span);
                        cli.Send(this);
                    }
                    break;
                default:
                    if (command != "error") {
                        span.recordException("Unknown command " + command);
                        this.UnknownCommand();
                        cli.Send(this);
                    } else {
                        var b = true;
                    }
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
            if (msg.striptoken) {
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
                msg.result = msg.result.filter(x => x.name.indexOf("system.") === -1);
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
            const _tuser = Crypt.verityToken(this.jwt);
            if (Config.enable_entity_restriction && !_tuser.HasRoleId("admins")) {
                await Config.db.loadEntityRestrictions(span);
                if (Config.db.EntityRestrictions.length > 1) {
                    const tuser = Crypt.verityToken(this.jwt);
                    const authorized = Config.db.EntityRestrictions.filter(x => x.IsAuthorized(tuser));
                    const allall = authorized.filter(x => x.collection == "");
                    if (allall.length == 0) {
                        const names = authorized.map(x => x.collection);
                        msg.result = msg.result.filter(x => names.indexOf(x.name) > -1);
                    }
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
            delete msg.query;
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
            delete msg.aggregates;
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
            delete msg.item;
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
            delete msg.items;
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
            delete msg.item;
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
            delete msg.item;
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
            delete msg.item;
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
            delete msg.ids;
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
            delete msg.map;
            delete msg.reduce;
            delete msg.finalize;
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
            let type: tokenType = "jwtsignin";
            if (!NoderedUtil.IsNullEmpty(rawAssertion)) {
                type = "samltoken";
                cli.user = await LoginProvider.validateToken(rawAssertion, span);
                if (!NoderedUtil.IsNullUndefinded(cli.user)) cli.username = cli.user.username;
                tuser = TokenUser.From(cli.user);
            } else if (!NoderedUtil.IsNullEmpty(cli.jwt)) {
                tuser = Crypt.verityToken(cli.jwt);
                const impostor: string = tuser.impostor;
                cli.user = await DBHelper.FindById(cli.user._id, undefined, span);
                if (!NoderedUtil.IsNullUndefinded(cli.user)) cli.username = cli.user.username;
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
    public async Signin(cli: WebSocketServerClient, parent: Span): Promise<void> {
        this.Reply();
        const span: Span = Logger.otel.startSubSpan("message.Signin", parent);
        try {
            const hrstart = process.hrtime()
            let hrend = process.hrtime(hrstart)
            let msg: SigninMessage
            let impostor: string = "";
            const UpdateDoc: any = { "$set": {} };
            let type: tokenType = "local";
            try {
                msg = SigninMessage.assign(this.data);
                let originialjwt = msg.jwt;
                let tuser: TokenUser = null;
                let user: User = null;
                if (!NoderedUtil.IsNullEmpty(msg.jwt)) {
                    type = "jwtsignin";
                    tuser = Crypt.verityToken(msg.jwt);
                    if (tuser.impostor !== null && tuser.impostor !== undefined && tuser.impostor !== "") {
                        impostor = tuser.impostor;
                    }
                    user = await DBHelper.FindByUsernameOrId(tuser.username, tuser._id, span);
                    if (user !== null && user !== undefined) {
                        // refresh, for roles and stuff
                        tuser = TokenUser.From(user);
                    } else { // Autocreate user .... safe ?? we use this for autocreating nodered service accounts
                        if (Config.auto_create_user_from_jwt) {
                            const jwt: string = Crypt.rootToken();
                            user = await DBHelper.EnsureUser(jwt, tuser.name, tuser.username, null, msg.password, span);
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
                        } else {
                            var c = OAuthProvider.instance.clients;
                            for (var i = 0; i < OAuthProvider.instance.clients.length; i++) {
                                try {
                                    var _cli = await OAuthProvider.instance.oidc.Client.find(OAuthProvider.instance.clients[i].clientId);;
                                    AccessToken = await OAuthProvider.instance.oidc.IdToken.validate(msg.rawAssertion, _cli);
                                    if (!NoderedUtil.IsNullEmpty(AccessToken)) {
                                        User = await OAuthProvider.instance.oidc.Account.findAccount(null, AccessToken.payload.sub);
                                        break;
                                    }
                                } catch (error) {

                                }
                            }
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
                    }
                    delete msg.rawAssertion;
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
                cli.clientagent = msg.clientagent as any;
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
                        originialjwt = msg.jwt;
                    } else {
                        msg.jwt = Crypt.createToken(tuser, Config.shorttoken_expires_in);
                        originialjwt = msg.jwt;
                    }
                    msg.user = tuser;
                    if (!NoderedUtil.IsNullEmpty(user.impersonating) && NoderedUtil.IsNullEmpty(msg.impersonate)) {
                        const items = await Config.db.query({ _id: user.impersonating }, null, 1, 0, null, "users", msg.jwt, undefined, undefined, span);
                        if (items.length == 0) {
                            msg.impersonate = null;
                        } else {
                            msg.impersonate = user.impersonating;
                            user.selectedcustomerid = null;
                            tuser.selectedcustomerid = null;
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
                        user.selectedcustomerid = null;
                        tuser.selectedcustomerid = null;
                        const tuserimpostor = tuser;
                        user = User.assign(items[0] as User);
                        user = await DBHelper.DecorateWithRoles(user, span);
                        // Check we have update rights
                        try {
                            await DBHelper.Save(user, originialjwt, span);
                            if (Config.persist_user_impersonation) {
                                await Config.db._UpdateOne({ _id: tuserimpostor._id }, { "$set": { "impersonating": user._id } } as any, "users", 1, false, originialjwt, span);
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
                        (user as any).impostor = userid;
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
                        Logger.instanse.info(tuser.username + " signed in using " + type + " " + cli.id + "/" + cli.clientagent);
                        cli.jwt = msg.jwt;
                        cli.user = user;
                        if (!NoderedUtil.IsNullUndefinded(cli.user)) cli.username = cli.user.username;
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
            user = await DBHelper.EnsureUser(Crypt.rootToken(), msg.name, msg.username, null, msg.password, span);
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


            if (NoderedUtil.IsNullEmpty(Config.stripe_api_secret) && !Config.multi_tenant) {
                if (user.nodered && user.nodered.resources) {
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
                }
            } else {
                let _resources: Resource[] = await Config.db.db.collection("config").find({ "_type": "resource", "name": "Nodered Instance" }).toArray();
                if (_resources.length > 0) {
                    let resource: Resource = _resources[0];

                    if (resource.defaultmetadata.resources) {
                        if (resource.defaultmetadata.resources.limits) {
                            if (resource.defaultmetadata.resources.limits.memory) resources.limits.memory = resource.defaultmetadata.resources.limits.memory;
                            if (resource.defaultmetadata.resources.limits.cpu) resources.limits.cpu = resource.defaultmetadata.resources.limits.cpu;
                        }
                        if (resource.defaultmetadata.resources.requests) {
                            if (resource.defaultmetadata.resources.requests.memory) resources.requests.memory = resource.defaultmetadata.resources.requests.memory;
                            if (resource.defaultmetadata.resources.requests.cpu) resources.requests.cpu = resource.defaultmetadata.resources.requests.cpu;
                        }
                    }
                    let assigned: ResourceUsage[] = await Config.db.db.collection("config").find({ "_type": "resourceusage", "userid": user._id, "resource": "Nodered Instance" }).toArray();
                    if (assigned.length > 0) {
                        let usage: ResourceUsage = assigned[0];
                        if (usage.quantity > 0 && !NoderedUtil.IsNullEmpty(usage.siid)) {
                            hasbilling = true;
                            if (usage.product.metadata.resources) {
                                if (usage.product.metadata.resources.limits) {
                                    if (usage.product.metadata.resources.limits.memory) resources.limits.memory = usage.product.metadata.resources.limits.memory;
                                    if (usage.product.metadata.resources.limits.cpu) resources.limits.cpu = usage.product.metadata.resources.limits.cpu;
                                }
                                if (usage.product.metadata.resources.requests) {
                                    if (usage.product.metadata.resources.requests.memory) resources.requests.memory = usage.product.metadata.resources.requests.memory;
                                    if (usage.product.metadata.resources.requests.cpu) resources.requests.cpu = usage.product.metadata.resources.requests.cpu;
                                }
                            }
                        }
                    }
                }
            }
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
        const span: Span = Logger.otel.startSubSpan("message.dockerDeleteNoderedPod", parent);
        try {
            const user = Crypt.verityToken(this.jwt);
            Logger.instanse.debug("[" + user.username + "] dockerDeleteNoderedPod");
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
            await this.dockerGetNoderedInstance(parent);
        } else {
            await this.KubeGetNoderedInstance(parent);
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
            msg.result = await Config.db.getbyid(msg.id, "fs.files", msg.jwt, null);
            if (NoderedUtil.IsNullUndefinded(msg.result)) {
                await this.sleep(1000);
                msg.result = await Config.db.getbyid(msg.id, "fs.files", msg.jwt, null);
            }
            if (NoderedUtil.IsNullUndefinded(msg.result)) {
                await this.sleep(1000);
                msg.result = await Config.db.getbyid(msg.id, "fs.files", msg.jwt, null);
            }
        } catch (error) {
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) msg.error = error.message ? error.message : error;
            await handleError(cli, error);
        }
        try {
            delete msg.file;
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
                let rows = await Config.db.query({ "metadata.uniquename": msg.filename }, null, 1, 0, { uploadDate: -1 }, "fs.files", msg.jwt, undefined, undefined, span);
                if (rows.length == 0) rows = await Config.db.query({ "filename": msg.filename }, null, 1, 0, { uploadDate: -1 }, "fs.files", msg.jwt, undefined, undefined, span);
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
            delete msg.metadata;

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
    async _StripeCancelPlan(resourceusageid: string, quantity: number, jwt: string, parent: Span) {
        const span: Span = Logger.otel.startSubSpan("message.StripeCancelPlan", parent);
        try {
            const usage: ResourceUsage = await Config.db.getbyid(resourceusageid, "config", jwt, span);
            if (usage == null) throw new Error("Unknown usage or Access Denied");
            const customer: Customer = await Config.db.getbyid(usage.customerid, "users", jwt, span);
            if (customer == null) throw new Error("Unknown usage or Access Denied (customer)");
            let user: TokenUser;
            if (!NoderedUtil.IsNullEmpty(usage.userid)) {
                user = await Config.db.getbyid(usage.userid, "users", jwt, span) as any;
                if (user == null) throw new Error("Unknown usage or Access Denied (user)");
            }
            const tuser = Crypt.verityToken(jwt);
            if (!tuser.HasRoleName(customer.name + " admins") && !tuser.HasRoleName("admins")) {
                throw new Error("Access denied, adding plan (admins)");
            }


            if (!NoderedUtil.IsNullEmpty(usage.product.added_resourceid) && !NoderedUtil.IsNullEmpty(usage.product.added_stripeprice)) {
                if (user != null) {
                    const subusage: ResourceUsage[] = await Config.db.query({ "_type": "resourceusage", "userid": usage.userid, "product.stripeprice": usage.product.added_stripeprice }, null, 2, 0, null, "config", jwt, null, null, span);
                    if (subusage.length == 1) {
                        await this._StripeCancelPlan(subusage[0]._id, usage.product.added_quantity_multiplier * subusage[0].quantity, jwt, span);
                    } else if (subusage.length > 1) {
                        throw new Error("Error found more than one resourceusage for userid " + usage.userid + " and stripeprice " + usage.product.added_stripeprice);
                    }
                } else {
                    const subusage: ResourceUsage[] = await Config.db.query({ "_type": "resourceusage", "customerid": usage.customerid, "product.stripeprice": usage.product.added_stripeprice }, null, 2, 0, null, "config", jwt, null, null, span);
                    if (subusage.length == 1) {
                        await this._StripeCancelPlan(subusage[0]._id, usage.product.added_quantity_multiplier * subusage[0].quantity, jwt, span);
                    } else if (subusage.length > 1) {
                        throw new Error("Error found more than one resourceusage for customerid " + usage.customerid + " and stripeprice " + usage.product.added_stripeprice);
                    }
                }
            }


            if (quantity < 1) quantity = 1;

            const total_usage = await Config.db.query<ResourceUsage>({ "_type": "resourceusage", "customerid": usage.customerid, "siid": usage.siid }, null, 1000, 0, null, "config", jwt, null, null, span);
            let _quantity: number = 0;
            total_usage.forEach(x => _quantity += x.quantity);

            _quantity -= quantity;

            const payload: any = { quantity: _quantity };
            if ((user != null && usage.product.userassign == "metered") ||
                (user == null && usage.product.customerassign == "metered")) {
                delete payload.quantity;
            }
            if (!NoderedUtil.IsNullEmpty(Config.stripe_api_secret)) {
                if (!NoderedUtil.IsNullEmpty(usage.siid)) {
                    if (payload.quantity == 0) {
                        var sub = await this.Stripe<stripe_subscription>("GET", "subscriptions", usage.subid, null, customer.stripeid);
                        if (sub.items.total_count < 2) {
                            const res = await this.Stripe("DELETE", "subscriptions", usage.subid, null, customer.stripeid);
                            if (customer.subscriptionid == usage.subid) {
                                const UpdateDoc: any = { "$set": {} };
                                UpdateDoc.$set["subscriptionid"] = null;
                                await Config.db.db.collection("users").updateMany({ "_id": customer._id }, UpdateDoc);
                            }
                        } else {
                            const res = await this.Stripe("DELETE", "subscription_items", usage.siid, payload, customer.stripeid);
                        }
                    } else {
                        const res = await this.Stripe("POST", "subscription_items", usage.siid, payload, customer.stripeid);
                    }
                }
            } else {
            }

            usage.quantity -= quantity;
            if (usage.quantity > 0) {
                await Config.db._UpdateOne(null, usage, "config", 1, false, Crypt.rootToken(), span);
            } else {
                await Config.db.DeleteOne(usage._id, "config", Crypt.rootToken(), span);
            }
        } catch (error) {
            span.recordException(error);
            throw error;
        }
        finally {
            Logger.otel.endSpan(span);
        }
    }
    async StripeCancelPlan(cli: WebSocketServerClient, parent: Span) {
        const span: Span = Logger.otel.startSubSpan("message.StripeCancelPlan", parent);
        this.Reply();
        let msg: StripeCancelPlanMessage;
        const rootjwt = Crypt.rootToken();
        try {
            msg = StripeCancelPlanMessage.assign(this.data);
            if (NoderedUtil.IsNullUndefinded(msg.jwt)) msg.jwt = cli.jwt;
            await this._StripeCancelPlan(msg.resourceusageid, msg.quantity, msg.jwt, span);

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

    async GetNextInvoice(cli: WebSocketServerClient, parent: Span) {
        const span: Span = Logger.otel.startSubSpan("message.GetNextInvoice", parent);
        this.Reply();
        let msg: GetNextInvoiceMessage;
        try {
            msg = GetNextInvoiceMessage.assign(this.data);
            if (NoderedUtil.IsNullUndefinded(msg.jwt)) msg.jwt = cli.jwt;

            let payload: any = {};
            const customer: Customer = await Config.db.getbyid(msg.customerid, "users", msg.jwt, span);
            if (NoderedUtil.IsNullUndefinded(customer)) throw new Error("Unknown customer or Access Denied");
            if (NoderedUtil.IsNullEmpty(customer.stripeid) && NoderedUtil.IsNullEmpty(Config.stripe_api_secret)) {
                this.Send(cli);
                return;
                // throw new Error("Customer has no billing information, please update with vattype and vatnumber");
            }
            if (NoderedUtil.IsNullEmpty(customer.stripeid)) throw new Error("Customer has no billing information, please update with vattype and vatnumber");


            const user = Crypt.verityToken(cli.jwt);
            if (!user.HasRoleName(customer.name + " admins") && !user.HasRoleName("admins")) {
                throw new Error("Access denied, getting invoice (admins)");
            }

            let subscription: stripe_subscription;
            if (!NoderedUtil.IsNullEmpty(customer.subscriptionid)) {
                subscription = await this.Stripe<stripe_subscription>("GET", "subscriptions", customer.subscriptionid, payload, customer.stripeid);
                if (subscription != null) {
                    payload.subscription = customer.subscriptionid;
                }



                if (msg.subscription_items && msg.subscription_items.length > 0 && msg.subscription_items[0].price && !msg.subscription_items[0].id) {
                    var price = msg.subscription_items[0].price;
                    msg.invoice = await this.Stripe<stripe_invoice>("GET", "invoices_upcoming", null, payload, customer.stripeid);

                    if (msg.invoice.lines.has_more) {
                        payload.limit = 100;
                        payload.starting_after = msg.invoice.lines.data[msg.invoice.lines.data.length - 1].id;
                        do {
                            var test = await this.Stripe<stripe_list<stripe_invoice_line>>("GET", "invoices_upcoming_lines", customer.subscriptionid, payload, customer.stripeid);
                            msg.invoice.lines.data = msg.invoice.lines.data.concat(test.data);
                            if (test.has_more) {
                                payload.starting_after = test.data[msg.invoice.lines.data.length - 1].id;
                            }
                        } while (test.has_more);

                        delete payload.starting_after;
                        delete payload.limit;
                    }

                    var exits = msg.invoice.lines.data.filter(x => (x.price.id == price || x.plan.id == price) && !x.proration);
                    if (exits.length == 1) {
                        msg.subscription_items[0].id = exits[0].id;
                        // msg.subscription_items[0].quantity += exits[0].quantity;
                    }
                }
            }
            if (!NoderedUtil.IsNullEmpty(msg.subscriptionid)) payload.subscription = msg.subscriptionid;
            if (!NoderedUtil.IsNullUndefinded(msg.subscription_items) && msg.subscription_items.length > 0) {
                if (!NoderedUtil.IsNullEmpty(customer.subscriptionid)) {
                    const proration_date = Math.floor(Date.now() / 1000);
                    payload.subscription_proration_date = proration_date;
                }
                if (msg.invoice != null) {
                    for (var i = msg.subscription_items.length - 1; i >= 0; i--) {
                        var item = msg.subscription_items[i];
                        let price: stripe_price = null;
                        let plan: stripe_plan = null;
                        let metered: boolean = false;
                        if (item.price && item.price.startsWith("price_")) {
                            price = await this.Stripe<stripe_price>("GET", "prices", item.price, payload, customer.stripeid);
                            metered = (price.recurring && price.recurring.usage_type == "metered");
                            if (!price.recurring) {
                                if (!payload.invoice_items) payload.invoice_items = [];
                                payload.invoice_items.push(item);
                                msg.subscription_items.splice(i, 1);
                            }
                        } else if (item.price && item.price.startsWith("plan_")) {
                            plan = await this.Stripe<stripe_plan>("GET", "plans", item.price, payload, customer.stripeid);
                            // metered = (plan.recurring.usage_type == "metered");
                        }

                        let quantity: number = item.quantity;
                        if (quantity < 1) quantity = 1;


                        var exists = msg.invoice.lines.data.filter(x => (x.price.id == item.price || x.plan.id == item.price) && !x.proration);
                        if (exists.length > 0) {
                            for (let i = 0; i < exists.length; i++) {
                                item.id = exists[i].subscription_item;
                                payload.subscription = (exists[i] as any).subscription;


                                const total_usage = await Config.db.query<ResourceUsage>({ "_type": "resourceusage", "customerid": customer._id, "siid": exists[i].subscription_item }, null, 1000, 0, null, "config", msg.jwt, null, null, span);
                                let _quantity: number = 0;
                                total_usage.forEach(x => _quantity += x.quantity);
                                _quantity += quantity;

                                var currentquantity = exists[i].quantity;
                                item.quantity = _quantity;

                                // item.quantity += exists[i].quantity;
                            }
                        }
                        if (metered) delete item.quantity;
                    }
                } else {
                    for (var i = msg.subscription_items.length - 1; i >= 0; i--) {
                        var item = msg.subscription_items[i];
                        var _price = await this.Stripe<stripe_price>("GET", "prices", item.price, payload, customer.stripeid);
                        var metered = (_price.recurring && _price.recurring.usage_type == "metered");
                        if (metered) delete item.quantity;
                    }
                }
                payload.subscription_items = msg.subscription_items;
            }
            if (!NoderedUtil.IsNullEmpty(customer.subscriptionid) && msg.subscription_items != null) {
                if (!NoderedUtil.IsNullEmpty(msg.proration_date) && msg.proration_date > 0) payload.subscription_proration_date = msg.proration_date;
                payload.subscription = customer.subscriptionid;
            } else if (NoderedUtil.IsNullEmpty(customer.subscriptionid)) {
                payload.customer = customer.stripeid;
            }


            if (msg.subscription_items) {
                let tax_rates = [];
                if (NoderedUtil.IsNullEmpty(customer.country)) customer.country = "";
                customer.country = customer.country.toUpperCase();
                if (NoderedUtil.IsNullEmpty(customer.vattype) || customer.country == "DK") {
                    const tax_ids = await this.Stripe<stripe_list<any>>("GET", "tax_rates", null, null, null);
                    if (tax_ids && tax_ids.data && tax_ids.data.length > 0) {
                        tax_rates = tax_ids.data.filter(x => x.active && x.country == customer.country).map(x => x.id);
                    }
                }
                if (tax_rates.length > 0) {
                    for (let i = 0; i < msg.subscription_items.length; i++) {
                        (msg.subscription_items[0] as any).tax_rates = tax_rates;
                    }
                }

            }

            msg.invoice = await this.Stripe<stripe_invoice>("GET", "invoices_upcoming", null, payload, customer.stripeid);

            if (msg.invoice.lines.has_more) {
                payload.limit = 100;
                payload.starting_after = msg.invoice.lines.data[msg.invoice.lines.data.length - 1].id;
                do {
                    var test = await this.Stripe<stripe_list<stripe_invoice_line>>("GET", "invoices_upcoming_lines", customer.subscriptionid, payload, customer.stripeid);
                    msg.invoice.lines.data = msg.invoice.lines.data.concat(test.data);
                    if (test.has_more) {
                        payload.starting_after = test.data[msg.invoice.lines.data.length - 1].id;
                    }
                } while (test.has_more);
            }
        } catch (error) {
            span.recordException(error);
            await handleError(null, error);
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) {
                msg.error = (error.message ? error.message : error);
                if (error.response && error.response.body) {
                    msg.error = error.response.body;
                    console.error(msg.error);
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
        try {
            msg = StripeAddPlanMessage.assign(this.data);
            if (NoderedUtil.IsNullUndefinded(msg.jwt)) msg.jwt = cli.jwt;
            if (NoderedUtil.IsNullUndefinded(msg.userid)) msg.userid = cli.user._id;
            const [customer, checkout] = await this._StripeAddPlan(msg.customerid, msg.userid, msg.resourceid, msg.stripeprice,
                msg.quantity, false, msg.jwt, span);
            msg.checkout = checkout;

        } catch (error) {
            span.recordException(error);
            await handleError(null, error);
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

    async _StripeAddPlan(customerid: string, userid: string, resourceid: string, stripeprice: string, quantity: number, skipSession: boolean, jwt: string, parent: Span) {
        const span: Span = Logger.otel.startSubSpan("message.StripeAddPlan", parent);
        const rootjwt = Crypt.rootToken();
        var checkout: any = null;
        try {



            const customer: Customer = await Config.db.getbyid(customerid, "users", jwt, span);
            if (customer == null) throw new Error("Unknown customer or Access Denied");
            if (Config.stripe_force_vat && (NoderedUtil.IsNullEmpty(customer.vattype) || NoderedUtil.IsNullEmpty(customer.vatnumber))) {
                throw new Error("Only business can buy, please fill out vattype and vatnumber");
            }

            const tuser = Crypt.verityToken(jwt);
            if (!tuser.HasRoleName(customer.name + " admins") && !tuser.HasRoleName("admins")) {
                throw new Error("Access denied, adding plan (admins)");
            }

            if (NoderedUtil.IsNullEmpty(customer.vattype)) customer.vattype = "";
            if (NoderedUtil.IsNullEmpty(customer.vatnumber)) customer.vatnumber = "";
            customer.vatnumber = customer.vatnumber.toUpperCase();
            customer.vattype = customer.vattype.toLocaleLowerCase();

            if (!NoderedUtil.IsNullEmpty(customer.vatnumber) && customer.vattype == "eu_vat" && customer.vatnumber.substring(0, 2) != customer.country) {
                throw new Error("Country and VAT number does not match (eu vat numbers must be prefixed with country code)");
            }
            const resource: Resource = await Config.db.getbyid(resourceid, "config", jwt, span);
            if (resource == null) throw new Error("Unknown resource or Access Denied");
            if (resource.products.filter(x => x.stripeprice == stripeprice).length != 1) throw new Error("Unknown resource product");
            const product: ResourceVariant = resource.products.filter(x => x.stripeprice == stripeprice)[0];

            if (resource.target == "user" && NoderedUtil.IsNullEmpty(userid)) throw new Error("Missing userid for user targeted resource");
            let user: TokenUser = null
            if (resource.target == "user") {
                user = await Config.db.getbyid(userid, "users", jwt, span) as any;
                if (user == null) throw new Error("Unknown user or Access Denied");
            }

            const total_usage = await Config.db.query<ResourceUsage>({ "_type": "resourceusage", "customerid": customerid }, null, 1000, 0, null, "config", jwt, null, null, span);

            // Ensure assign does not conflict with resource assign limit
            if (resource.target == "customer") {
                if (resource.customerassign == "singlevariant") {
                    const notsame = total_usage.filter(x => x.resourceid == resource._id && x.product.stripeprice != stripeprice && !NoderedUtil.IsNullEmpty(x.siid) && NoderedUtil.IsNullEmpty(x.userid));
                    if (notsame.length > 0 && notsame[0].quantity > 0) throw new Error("Cannot assign, customer already have " + notsame[0].product.name);
                }
            } else {
                if (resource.userassign == "singlevariant") {
                    const notsame = total_usage.filter(x => x.resourceid == resource._id && x.product.stripeprice != stripeprice && x.userid == user._id && !NoderedUtil.IsNullEmpty(x.siid));
                    if (notsame.length > 0 && notsame[0].quantity > 0) throw new Error("Cannot assign, user already have " + notsame[0].product.name);
                }
            }
            let usage: ResourceUsage = new ResourceUsage();
            usage.product = product;
            usage.resourceid = resource._id;
            usage.resource = resource.name;
            // Assume we don not have one
            usage.quantity = 0;

            let filter: ResourceUsage[] = [];
            // Ensure assign does not conflict with product assign limit
            if (resource.target == "customer" && product.customerassign == "single") {
                filter = total_usage.filter(x => x.product.stripeprice == stripeprice && !NoderedUtil.IsNullEmpty(x.siid) && NoderedUtil.IsNullEmpty(x.userid));
                if (filter.length == 1) {
                    usage = filter[0];
                    if (usage.quantity > 0) throw new Error("Cannot assign, customer already have 1 " + product.name);
                } else if (filter.length > 1) {
                    throw new Error("Cannot assign (error multiple found), customer already have 1 " + product.name);
                }
            } else if (resource.target == "user" && product.userassign == "single") {
                filter = total_usage.filter(x => x.product.stripeprice == stripeprice && x.userid == user._id && !NoderedUtil.IsNullEmpty(x.siid));
                if (filter.length == 1) {
                    usage = filter[0];
                    if (usage.quantity > 0) throw new Error("Cannot assign, user already have 1 " + product.name);
                } else if (filter.length > 1) {
                    throw new Error("Cannot assign (error multiple found), user already have 1 " + product.name);
                }
            }
            if (resource.target == "customer") {
                filter = total_usage.filter(x => x.product.stripeprice == stripeprice);
                if (filter.length > 0) usage = filter[0];
            } else {
                filter = total_usage.filter(x => x.product.stripeprice == stripeprice && x.userid == user._id);
                if (filter.length > 0) usage = filter[0];
            }
            if (total_usage.length > 0 && !NoderedUtil.IsNullEmpty(total_usage[0].subid)) {
                usage.subid = total_usage[0].subid;
            }
            if (!Config.stripe_force_checkout) {
                filter = total_usage.filter(x => x.product.stripeprice == stripeprice);
                if (filter.length > 0) {
                    usage.siid = filter[0].siid;
                    usage.subid = filter[0].subid;
                }
            }

            // Backward compatability and/or pick up after deleting customer object 
            if (NoderedUtil.IsNullEmpty(usage.siid) && !NoderedUtil.IsNullEmpty(Config.stripe_api_secret)) {
                const stripecustomer = await this.Stripe<stripe_customer>("GET", "customers", customer.stripeid, null, null);
                if (stripecustomer == null) throw new Error("Failed locating stripe customer " + customer.stripeid);
                for (let sub of stripecustomer.subscriptions.data) {
                    if (sub.id == customer.subscriptionid) {
                        for (let si of sub.items.data) {
                            if ((si.plan && si.plan.id == stripeprice) || (si.price && si.price.id == stripeprice)) {
                                usage.siid = si.id;
                                usage.subid = sub.id;
                            }
                        }
                    }
                }
            }

            let _quantity: number = 0;
            // Count what we have already bought
            total_usage.forEach(x => {
                if (x.product.stripeprice == stripeprice && !NoderedUtil.IsNullEmpty(x.siid)) _quantity += x.quantity;
            });
            // Add requested quantity, now we have our target count
            _quantity += quantity;

            if (NoderedUtil.IsNullEmpty(usage.subid)) {
                usage.quantity = quantity;
            } else {
                usage.quantity += quantity;
            }
            usage.customerid = customer._id;
            if (user != null) {
                usage.userid = user._id;
                usage.name = usage.resource + " / " + product.name + " for " + user.name;
            } else {
                usage.name = usage.resource + " / " + product.name + " for " + customer.name;
            }
            if (NoderedUtil.IsNullEmpty(usage._id) || NoderedUtil.IsNullEmpty(usage.subid) || Config.stripe_force_checkout) {
                let tax_rates = [];
                if (NoderedUtil.IsNullEmpty(customer.country)) customer.country = "";
                customer.country = customer.country.toUpperCase();
                if (NoderedUtil.IsNullEmpty(customer.vattype) || customer.country == "DK") {
                    if (!NoderedUtil.IsNullEmpty(Config.stripe_api_secret)) {
                        const tax_ids = await this.Stripe<stripe_list<any>>("GET", "tax_rates", null, null, null);
                        if (tax_ids && tax_ids.data && tax_ids.data.length > 0) {
                            tax_rates = tax_ids.data.filter(x => x.active && x.country == customer.country).map(x => x.id);
                        }
                    }
                }

                // https://stripe.com/docs/payments/checkout/taxes
                Base.addRight(usage, customer.admins, customer.name + " admin", [Rights.read]);
                if (NoderedUtil.IsNullEmpty(customer.subscriptionid) || Config.stripe_force_checkout) {
                    if (NoderedUtil.IsNullEmpty(Config.stripe_api_secret)) {
                        // Create fake subscription id
                        usage.siid = NoderedUtil.GetUniqueIdentifier();
                        usage.subid = NoderedUtil.GetUniqueIdentifier();
                    }

                    if (NoderedUtil.IsNullEmpty(usage._id)) {
                        const res = await Config.db.InsertOne(usage, "config", 1, false, rootjwt, span);
                        usage._id = res._id;
                    } else {
                        await Config.db._UpdateOne(null, usage, "config", 1, false, rootjwt, span);
                    }
                    if (!NoderedUtil.IsNullEmpty(product.added_resourceid) && !NoderedUtil.IsNullEmpty(product.added_stripeprice)) {
                        const [customer2, checkout2] = await this._StripeAddPlan(customerid, userid,
                            product.added_resourceid, product.added_stripeprice, product.added_quantity_multiplier * usage.quantity, true, jwt, span);
                    }
                    if (!skipSession) {
                        const baseurl = Config.baseurl() + "#/Customer/" + customer._id;
                        const payload: any = {
                            client_reference_id: usage._id,
                            success_url: baseurl + "/refresh", cancel_url: baseurl + "/refresh",
                            payment_method_types: ["card"], mode: "subscription",
                            customer: customer.stripeid,
                            line_items: []
                        };
                        let line_item: any = { price: product.stripeprice, tax_rates };
                        if ((resource.target == "user" && product.userassign != "metered") ||
                            (resource.target == "customer" && product.customerassign != "metered")) {
                            line_item.quantity = _quantity
                        }
                        payload.line_items.push(line_item);
                        if (!NoderedUtil.IsNullEmpty(product.added_resourceid) && !NoderedUtil.IsNullEmpty(product.added_stripeprice)) {
                            const addresource: Resource = await Config.db.getbyid(product.added_resourceid, "config", jwt, span);
                            const addproduct = addresource.products.filter(x => x.stripeprice == product.added_stripeprice)[0];
                            let line_item: any = { price: addproduct.stripeprice, tax_rates };
                            if ((resource.target == "user" && addproduct.userassign != "metered") ||
                                (resource.target == "customer" && addproduct.customerassign != "metered")) {
                                line_item.quantity = product.added_quantity_multiplier * _quantity
                            }
                            payload.line_items.push(line_item);
                        }
                        if (!NoderedUtil.IsNullEmpty(Config.stripe_api_secret)) {
                            checkout = await this.Stripe("POST", "checkout.sessions", null, payload, null);
                        } else {
                            // Create fake subscription id
                            usage.siid = NoderedUtil.GetUniqueIdentifier();
                        }

                    }
                } else {
                    const siid: string = usage.siid;
                    let line_item: any = { price: product.stripeprice, tax_rates };
                    if ((resource.target == "user" && product.userassign != "metered") ||
                        (resource.target == "customer" && product.customerassign != "metered")) {
                        line_item.quantity = _quantity
                    }
                    if (NoderedUtil.IsNullEmpty(usage.siid)) line_item["subscription"] = customer.subscriptionid;
                    // Add new if usage.siid is null / updates if we have usage.siid
                    const res = await this.Stripe<stripe_subscription_item>("POST", "subscription_items", usage.siid, line_item, customer.stripeid);
                    usage.siid = res.id;
                    usage.subid = customer.subscriptionid;
                    await Config.db.InsertOne(usage, "config", 1, false, rootjwt, span);
                    if (!NoderedUtil.IsNullEmpty(product.added_resourceid) && !NoderedUtil.IsNullEmpty(product.added_stripeprice)) {
                        const [customer2, checkout2] = await this._StripeAddPlan(customerid, userid,
                            product.added_resourceid, product.added_stripeprice, product.added_quantity_multiplier * usage.quantity, true, jwt, span);
                    }
                }
            } else {
                const payload: any = {};
                // Update quantity if not metered
                if ((resource.target == "user" && product.userassign != "metered") ||
                    (resource.target == "customer" && product.customerassign != "metered")) {
                    payload.quantity = _quantity
                    if (!NoderedUtil.IsNullEmpty(Config.stripe_api_secret)) {
                        const res = await this.Stripe("POST", "subscription_items", usage.siid, payload, customer.stripeid);
                    }
                }

                await Config.db._UpdateOne(null, usage, "config", 1, false, rootjwt, span);
                if (!NoderedUtil.IsNullEmpty(product.added_resourceid) && !NoderedUtil.IsNullEmpty(product.added_stripeprice)) {
                    const [customer2, checkout2] = await this._StripeAddPlan(customerid, userid,
                        product.added_resourceid, product.added_stripeprice, product.added_quantity_multiplier * usage.quantity, true, jwt, span);
                }
            }

            if (resource.name == "Database Usage") {
                const UpdateDoc: any = { "$set": {} };
                UpdateDoc.$set["dblocked"] = false;
                await Config.db.db.collection("users").updateMany({ "_type": "user", "customerid": customer._id }, UpdateDoc);
            }

            return [customer, checkout];
        } catch (error) {
            span.recordException(error);
            throw error;
        }
        finally {
            Logger.otel.endSpan(span);
        }
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
            if (payload != null && payload.subscription_items) {
                let index = 0;
                for (let item of payload.subscription_items) {
                    if (item.id) url += "&subscription_items[" + index + "][id]=" + item.id;
                    if (item.price) url += "&subscription_items[" + index + "][price]=" + item.price;
                    if (item.quantity) url += "&subscription_items[" + index + "][quantity]=" + item.quantity;

                    let taxindex = 0;
                    if ((item as any).tax_rates && (item as any).tax_rates.length > 0) {
                        for (let tax of (item as any).tax_rates) {
                            url += "&subscription_items[" + index + "][tax_rates[" + taxindex + "]]=" + tax;

                            taxindex++;
                        }
                    }
                    index++;
                }
            }
            if (payload != null && payload.invoice_items) {
                let index = 0;
                for (let item of payload.invoice_items) {
                    if (item.id) url += "&invoice_items[" + index + "][id]=" + item.id;
                    if (item.price) url += "&invoice_items[" + index + "][price]=" + item.price;
                    if (item.quantity) url += "&invoice_items[" + index + "][quantity]=" + item.quantity;

                    let taxindex = 0;
                    if ((item as any).tax_rates && (item as any).tax_rates.length > 0) {
                        for (let tax of (item as any).tax_rates) {
                            url += "&invoice_items[" + index + "][tax_rates[" + taxindex + "]]=" + tax;

                            taxindex++;
                        }
                    }
                    index++;
                }
            }
            if (payload != null && payload.subscription_proration_date) {
                url += "&subscription_proration_date=" + payload.subscription_proration_date;
            }
            if (payload != null && payload.subscription) {
                url += "&subscription=" + payload.subscription;
            }
        }
        if (object == "invoices_upcoming_lines") {
            url = "https://api.stripe.com/v1/invoices/upcoming/lines?customer=" + customerid;
            if (payload != null && payload.subscription) {
                url += "&subscription=" + payload.subscription;
            } else if (!NoderedUtil.IsNullEmpty(id)) {
                url += "&subscription=" + id;
            }
        }

        if (payload && payload.starting_after) {
            url += "&starting_after=" + payload.starting_after;
        }
        if (payload && payload.limit) {
            url += "&limit=" + payload.limit;
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
                if (msg.object == "billing_portal/sessions") {
                    const tuser = Crypt.verityToken(cli.jwt);
                    let customer: Customer;
                    if (!NoderedUtil.IsNullEmpty(tuser.selectedcustomerid)) customer = await Config.db.getbyid(tuser.selectedcustomerid, "users", cli.jwt, null);
                    if (!NoderedUtil.IsNullEmpty(tuser.selectedcustomerid) && customer == null) customer = await Config.db.getbyid(tuser.customerid, "users", cli.jwt, null);
                    if (customer == null) throw new Error("Access denied, or customer not found");
                    if (!tuser.HasRoleName(customer.name + " admins") && !tuser.HasRoleName("admins")) {
                        throw new Error("Access denied, adding plan (admins)");
                    }
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
            let user: User = cli.user;
            let customer: Customer = null;
            if (msg.customer != null && msg.customer._id != null) {
                const customers = await Config.db.query<Customer>({ _type: "customer", "_id": msg.customer._id }, null, 1, 0, null, "users", msg.jwt, undefined, undefined, span);
                if (customers.length > 0) {
                    customer = customers[0];
                }
            }
            if (customer == null) {
                if (!NoderedUtil.IsNullEmpty(user.customerid) && !user.HasRoleName("resellers")) {
                    throw new Error("Access denied creating customer");
                }
                if (msg.customer != null) msg.customer = Customer.assign(msg.customer);
                if (msg.customer == null) msg.customer = new Customer();
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
                customer = msg.customer;
            } else {
                if (!user.HasRoleName(customer.name + " admins") && !user.HasRoleName("admins")) {
                    throw new Error("You are not logged in as a customer admin, so you cannot update");
                }
                // msg.customer = customers[0];
                if (customer.name != msg.customer.name || customer.email != msg.customer.email || customer.vatnumber != msg.customer.vatnumber || customer.vattype != msg.customer.vattype || customer.coupon != msg.customer.coupon) {
                    customer.email = msg.customer.email;
                    customer.name = msg.customer.name;
                    customer.vatnumber = msg.customer.vatnumber;
                    customer.vattype = msg.customer.vattype;
                    customer.coupon = msg.customer.coupon;
                }
                customer.country = msg.customer.country;
                customer.customattr1 = msg.customer.customattr1;
                customer.customattr2 = msg.customer.customattr2;
                customer.customattr3 = msg.customer.customattr3;
                customer.customattr4 = msg.customer.customattr4;
                customer.customattr5 = msg.customer.customattr5;

                msg.customer = customer;
                if (!NoderedUtil.IsNullEmpty(customer.vatnumber)) msg.customer.vatnumber = msg.customer.vatnumber.toUpperCase();
            }
            msg.customer._type = "customer";
            let tax_exempt: string = "none";
            if (Config.stripe_force_vat && (NoderedUtil.IsNullEmpty(msg.customer.vattype) || NoderedUtil.IsNullEmpty(msg.customer.vatnumber))) {
                throw new Error("Only business can buy, please fill out vattype and vatnumber");
            }

            if (msg.customer.vatnumber) {
                if (!NoderedUtil.IsNullEmpty(msg.customer.vatnumber) && msg.customer.vattype == "eu_vat" && msg.customer.vatnumber.substring(0, 2) != msg.customer.country) {
                    throw new Error("Country and VAT number does not match (eu vat numbers must be prefixed with country code)");
                }
            }
            if ((!NoderedUtil.IsNullEmpty(msg.customer.vatnumber) && msg.customer.vatnumber.length > 2) || Config.stripe_force_vat) {

                if (NoderedUtil.IsNullUndefinded(msg.stripecustomer) && !NoderedUtil.IsNullEmpty(msg.customer.stripeid)) {
                    msg.stripecustomer = await this.Stripe<stripe_customer>("GET", "customers", msg.customer.stripeid, null, null);
                }
                if (NoderedUtil.IsNullUndefinded(msg.stripecustomer)) {
                    let payload: any = { name: msg.customer.name, email: msg.customer.email, metadata: { userid: user._id }, description: user.name, address: { country: msg.customer.country }, tax_exempt: tax_exempt };
                    msg.stripecustomer = await this.Stripe<stripe_customer>("POST", "customers", null, payload, null);
                    msg.customer.stripeid = msg.stripecustomer.id;
                }
                if (msg.stripecustomer.email != msg.customer.email || msg.stripecustomer.name != msg.customer.name || (msg.stripecustomer.address == null || msg.stripecustomer.address.country != msg.customer.country)) {
                    const payload: any = { email: msg.customer.email, name: msg.customer.name, address: { country: msg.customer.country }, tax_exempt: tax_exempt };
                    msg.stripecustomer = await this.Stripe<stripe_customer>("POST", "customers", msg.customer.stripeid, payload, null);
                }
                if (msg.stripecustomer.subscriptions.total_count > 0) {
                    let sub = msg.stripecustomer.subscriptions.data[0];
                    msg.customer.subscriptionid = sub.id;
                    const total_usage = await Config.db.query<ResourceUsage>({ "_type": "resourceusage", "customerid": msg.customer._id, "$or": [{ "siid": { "$exists": false } }, { "siid": "" }, { "siid": null }] }, null, 1000, 0, null, "config", msg.jwt, null, null, span);

                    for (let usage of total_usage) {
                        const items = sub.items.data.filter(x => ((x.price && x.price.id == usage.product.stripeprice) || (x.plan && x.plan.id == usage.product.stripeprice)));
                        if (items.length > 0) {
                            usage.siid = items[0].id;
                            usage.subid = sub.id;
                            await Config.db._UpdateOne(null, usage, "config", 1, false, rootjwt, span);
                        } else {
                            // Clean up old buy attempts
                            await Config.db.DeleteOne(usage._id, "config", rootjwt, span);
                        }
                    }
                } else {
                    msg.customer.subscriptionid = null;
                    const total_usage = await Config.db.query<ResourceUsage>({ "_type": "resourceusage", "customerid": msg.customer._id, "$or": [{ "siid": { "$exists": false } }, { "siid": "" }, { "siid": null }] }, null, 1000, 0, null, "config", msg.jwt, null, null, span);
                    for (let usage of total_usage) {
                        await Config.db.DeleteOne(usage._id, "config", rootjwt, span);
                    }
                }
                if (msg.customer.vatnumber) {
                    if (msg.stripecustomer.tax_ids.total_count == 0) {
                        const payload: any = { value: msg.customer.vatnumber, type: msg.customer.vattype };
                        await this.Stripe<stripe_customer>("POST", "tax_ids", null, payload, msg.customer.stripeid);
                    } else if (msg.stripecustomer.tax_ids.data[0].value != msg.customer.vatnumber) {
                        await this.Stripe<stripe_tax_id>("DELETE", "tax_ids", msg.stripecustomer.tax_ids.data[0].id, null, msg.customer.stripeid);
                        const payload: any = { value: msg.customer.vatnumber, type: msg.customer.vattype };
                        await this.Stripe<stripe_customer>("POST", "tax_ids", null, payload, msg.customer.stripeid);
                    }
                } else {
                    if (msg.stripecustomer.tax_ids.data.length > 0) {
                        await this.Stripe<stripe_tax_id>("DELETE", "tax_ids", msg.stripecustomer.tax_ids.data[0].id, null, msg.customer.stripeid);
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
            }  // if(!NoderedUtil.IsNullEmpty(msg.customer.vatnumber) || !Config.stripe_force_vat) {

            if (NoderedUtil.IsNullEmpty(msg.customer._id)) {
                msg.customer = await Config.db.InsertOne(msg.customer, "users", 3, true, rootjwt, span);
            } else {
                msg.customer = await Config.db._UpdateOne(null, msg.customer, "users", 3, true, rootjwt, span);
            }
            if (user.customerid != msg.customer._id) {
                const UpdateDoc: any = { "$set": {} };
                if (NoderedUtil.IsNullEmpty(user.customerid)) {
                    user.customerid = msg.customer._id;
                    UpdateDoc.$set["customerid"] = msg.customer._id;
                }
                user.selectedcustomerid = msg.customer._id;
                UpdateDoc.$set["selectedcustomerid"] = msg.customer._id;
                await Config.db._UpdateOne({ "_id": user._id }, UpdateDoc, "users", 1, false, rootjwt, span)
            } else if (cli.user.selectedcustomerid != msg.customer._id) {
                cli.user.selectedcustomerid = msg.customer._id;
                const UpdateDoc: any = { "$set": {} };
                UpdateDoc.$set["selectedcustomerid"] = msg.customer._id;
                await Config.db._UpdateOne({ "_id": cli.user._id }, UpdateDoc, "users", 1, false, rootjwt, span)
            }

            const customeradmins: Role = await DBHelper.EnsureRole(rootjwt, msg.customer.name + " admins", msg.customer.admins, span);
            customeradmins.name = msg.customer.name + " admins";
            Base.addRight(customeradmins, WellknownIds.admins, "admins", [Rights.full_control]);
            // Base.removeRight(customeradmins, WellknownIds.admins, [Rights.delete]);
            customeradmins.AddMember(user);
            if (!NoderedUtil.IsNullEmpty(user.customerid) && user.customerid != msg.customer._id) {
                const usercustomer = await Config.db.getbyid<Customer>(user.customerid, "users", msg.jwt, span);
                if (usercustomer != null) {
                    const usercustomeradmins = await Config.db.getbyid<Role>(usercustomer.admins, "users", msg.jwt, span);
                    if (usercustomeradmins != null) customeradmins.AddMember(usercustomeradmins);
                }
            }
            customeradmins.customerid = msg.customer._id;
            await DBHelper.Save(customeradmins, rootjwt, span);

            const customer_admins: Role = await DBHelper.EnsureRole(rootjwt, "customer admins", WellknownIds.customer_admins, span);
            customer_admins.AddMember(customeradmins);
            await DBHelper.Save(customer_admins, rootjwt, span);

            const customerusers: Role = await DBHelper.EnsureRole(rootjwt, msg.customer.name + " users", msg.customer.users, span);
            customerusers.name = msg.customer.name + " users";
            customerusers.customerid = msg.customer._id;
            Base.addRight(customerusers, customeradmins._id, customeradmins.name, [Rights.full_control]);
            Base.removeRight(customerusers, customeradmins._id, [Rights.delete]);
            customerusers.AddMember(customeradmins);
            if (NoderedUtil.IsNullEmpty(cli.user.customerid) || cli.user.customerid == msg.customer._id) {
                customerusers.AddMember(cli.user);
            }
            await DBHelper.Save(customerusers, rootjwt, span);

            if (msg.customer.admins != customeradmins._id || msg.customer.users != customerusers._id) {
                msg.customer.admins = customeradmins._id;
                msg.customer.users = customerusers._id;
            }
            Base.addRight(msg.customer, customerusers._id, customerusers.name, [Rights.read]);
            Base.addRight(msg.customer, customeradmins._id, customeradmins.name, [Rights.read]);
            await Config.db._UpdateOne(null, msg.customer, "users", 3, true, rootjwt, span);

            if (msg.customer._id == cli.user.customerid) {
                cli.user.selectedcustomerid = msg.customer._id;
                cli.user = await DBHelper.DecorateWithRoles(cli.user, span);
                if (!NoderedUtil.IsNullUndefinded(cli.user)) cli.username = cli.user.username;
                cli.user.roles.push(new Rolemember(customerusers.name, customerusers._id));
                cli.user.roles.push(new Rolemember(customeradmins.name, customeradmins._id));
                await this.ReloadUserToken(cli, span);
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
    }
    formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return '0 Bytes';

        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

        const i = Math.floor(Math.log(bytes) / Math.log(k));

        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }
    sleep(ms) {
        return new Promise(resolve => {
            setTimeout(resolve, ms)
        })
    }
    public async ReloadUserToken(cli: WebSocketServerClient, parent: Span) {
        await this.sleep(1000);
        const l: SigninMessage = new SigninMessage();
        Auth.RemoveUser(cli.user._id, "passport");
        cli.user = await DBHelper.DecorateWithRoles(cli.user, parent);
        cli.jwt = Crypt.createToken(cli.user, Config.shorttoken_expires_in);
        if (!NoderedUtil.IsNullUndefinded(cli.user)) cli.username = cli.user.username;
        l.jwt = cli.jwt;
        l.user = TokenUser.From(cli.user);
        const m: Message = new Message(); m.command = "refreshtoken";
        m.data = JSON.stringify(l);
        cli.Send(m);
    }
    public async Housekeeping(skipNodered: boolean, skipCalculateSize: boolean, skipUpdateUserSize: boolean, parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("message.QueueMessage", parent);
        try {
            if (!skipNodered) await this.GetNoderedInstance(span)
        } catch (error) {
        }
        try {
            await Config.db.ensureindexes(span);
        } catch (error) {
        }
        const timestamp = new Date(new Date().toISOString());
        timestamp.setUTCHours(0, 0, 0, 0);

        const yesterday = new Date(new Date().toISOString());;
        yesterday.setUTCHours(0, 0, 0, 0);
        yesterday.setDate(yesterday.getDate() - 1);

        try {
            if (!skipCalculateSize) {

                const user = Crypt.rootUser();
                const tuser = TokenUser.From(user);
                const jwt: string = Crypt.rootToken();
                let collections = await Config.db.ListCollections(jwt);
                collections = collections.filter(x => x.name.indexOf("system.") === -1);
                let totalusage = 0;
                let index = 0;
                for (let col of collections) {
                    if (col.name == "fs.chunks") continue;
                    index++;
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
                                "name": { "$first": "$_modifiedby" }
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
                                    "name": { "$first": "$_modifiedby" }
                                }
                            },
                            { $addFields: { "userid": "$_id" } },
                            { $unset: "_id" },
                            { $addFields: { "collection": col.name } },
                            { $addFields: { timestamp: timestamp.toISOString() } },
                        ]
                    }
                    if (col.name == "audit") {
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
                                    "name": { "$first": "$name" }
                                }
                            },
                            { $addFields: { "userid": "$_id" } },
                            { $unset: "_id" },
                            { $addFields: { "collection": col.name } },
                            { $addFields: { timestamp: timestamp.toISOString() } },
                        ]
                    }

                    const items: any[] = await Config.db.db.collection(col.name).aggregate(aggregates).toArray();
                    Config.db.db.collection("dbusage").deleteMany({ timestamp: timestamp, collection: col.name });
                    let usage = 0;
                    if (items.length > 0) {
                        let bulkInsert = Config.db.db.collection("dbusage").initializeUnorderedBulkOp();
                        for (var _item of items) {
                            let item = Config.db.ensureResource(_item);
                            item = await Config.db.CleanACL(item, tuser, span);
                            delete item._id;
                            item.username = item.name;
                            item.name = item.name + " / " + col.name + " / " + this.formatBytes(_item.size);
                            item._type = "metered";
                            item._createdby = "root";
                            item._createdbyid = WellknownIds.root;
                            item._created = new Date(new Date().toISOString());
                            item._modifiedby = "root";
                            item._modifiedbyid = WellknownIds.root;
                            item._modified = item._created;
                            usage += item.size;
                            DatabaseConnection.traversejsonencode(item);

                            bulkInsert.insert(item);
                        }

                        totalusage += usage;
                        try {
                            await bulkInsert.execute();
                            if (items.length > 0) Logger.instanse.debug("[housekeeping][" + col.name + "][" + index + "/" + collections.length + "] add " + items.length + " items with a usage of " + this.formatBytes(usage));

                        } catch (error) {
                            Logger.instanse.error(error);
                            span.recordException(error);
                        }
                    }
                }
                Logger.instanse.debug("[housekeeping] Add stats from " + collections.length + " collections with a total usage of " + this.formatBytes(totalusage));
            }

        } catch (error) {
            Logger.instanse.error(error);
            span.recordException(error);
        }
        try {
            if (!skipUpdateUserSize) {
                var dt = new Date();
                let index = 0;
                const usercount = await Config.db.db.collection("users").aggregate([{ "$match": { "_type": "user", lastseen: { "$gte": yesterday } } }, { $count: "userCount" }]).toArray();
                if (usercount.length > 0) {
                    Logger.instanse.debug("[housekeeping] Begin updating all users (" + usercount[0].userCount + ") dbusage field");
                }
                const cursor = Config.db.db.collection("users").find({ "_type": "user", lastseen: { "$gte": yesterday } })
                for await (const u of cursor) {
                    if (u.dbusage == null) u.dbusage = 0;
                    index++;
                    const pipe = [
                        { "$match": { "userid": u._id, timestamp: timestamp } },
                        {
                            "$group":
                            {
                                "_id": "$userid",
                                "size": { "$sum": "$size" },
                                "count": { "$sum": 1 }

                            }
                        }
                    ]// "items": { "$push": "$$ROOT" }
                    const items: any[] = await Config.db.db.collection("dbusage").aggregate(pipe).toArray();
                    if (items.length > 0) {
                        Logger.instanse.debug("[housekeeping][" + index + "/" + usercount[0].userCount + "] " + u.name + " " + this.formatBytes(items[0].size) + " from " + items[0].count + " collections");
                        await Config.db.db.collection("users").updateOne({ _id: u._id }, { $set: { "dbusage": items[0].size } });
                    }
                    if (index % 100 == 0) Logger.instanse.debug("[housekeeping][" + index + "/" + usercount[0].userCount + "] Processing");
                }
                Logger.instanse.debug("[housekeeping] Completed updating all users dbusage field");
            }
        } catch (error) {
            Logger.instanse.error(error);
            span.recordException(error);
        }
        if (Config.multi_tenant) {
            try {
                const usercount = await Config.db.db.collection("users").aggregate([{ "$match": { "_type": "customer" } }, { $count: "userCount" }]).toArray();
                if (usercount.length > 0) {
                    Logger.instanse.debug("[housekeeping] Begin updating all customers (" + usercount[0].userCount + ") dbusage field");
                }
                const pipe = [
                    { "$match": { "_type": "customer" } },
                    { "$project": { "name": 1, "dbusage": 1, "stripeid": 1, "dblocked": 1 } },
                    {
                        "$lookup": {
                            "from": "users",
                            "let": {
                                "id": "$_id"
                            },
                            "pipeline": [
                                {
                                    "$match": {
                                        "$expr": {
                                            "$and": [
                                                {
                                                    "$eq": [
                                                        "$customerid",
                                                        "$$id"
                                                    ]
                                                },
                                                {
                                                    "$eq": [
                                                        "$_type",
                                                        "user"
                                                    ]
                                                }
                                            ]
                                        }
                                    }
                                },
                                {
                                    $project:
                                    {
                                        "name": 1, "dbusage": 1, "_id": 0
                                    }
                                }
                            ],
                            "as": "users"
                        }

                    }
                ]
                const cursor = await Config.db.db.collection("users").aggregate(pipe)
                for await (const c of cursor) {
                    let dbusage: number = 0;
                    for (let u of c.users) dbusage += (u.dbusage ? u.dbusage : 0);
                    await Config.db.db.collection("users").updateOne({ _id: c._id }, { $set: { "dbusage": dbusage } });
                    Logger.instanse.debug("[housekeeping] " + c.name + " using " + this.formatBytes(dbusage));
                }
                var sleep = (ms) => {
                    return new Promise(resolve => {
                        setTimeout(resolve, ms)
                    })
                }
                await sleep(2000);

            } catch (error) {
                Logger.instanse.error(error);
                span.recordException(error);
            }
        }
        if (Config.multi_tenant) {
            try {
                let index = 0;
                const usercount = await Config.db.db.collection("users").aggregate([{ "$match": { "_type": "customer" } }, { $count: "userCount" }]).toArray();
                if (usercount.length > 0) {
                    Logger.instanse.debug("[housekeeping] Begin updating all customers (" + usercount[0].userCount + ") dbusage field");
                }

                const pipe = [
                    { "$match": { "_type": "customer" } },
                    { "$project": { "name": 1, "dbusage": 1, "stripeid": 1, "dblocked": 1 } },
                    {
                        "$lookup": {
                            "from": "config",
                            "let": {
                                "id": "$_id"
                            },
                            "pipeline": [
                                {
                                    "$match": {
                                        "$expr": {
                                            "$and": [
                                                {
                                                    "$eq": [
                                                        "$customerid",
                                                        "$$id"
                                                    ]
                                                },
                                                {
                                                    "$eq": [
                                                        "$_type",
                                                        "resourceusage"
                                                    ]
                                                },
                                                {
                                                    "$eq": [
                                                        "$resource",
                                                        "Database Usage"
                                                    ]
                                                }
                                            ]
                                        }
                                    }
                                },
                                {
                                    $project:
                                    {
                                        "name": 1, "quantity": 1, "siid": 1, "product": 1, "_id": 0
                                    }
                                }
                            ],
                            "as": "config"
                        }

                    }
                ]
                // ,
                // {
                //     "$match": { config: { $not: { $size: 0 } } }
                // }
                const cursor = await Config.db.db.collection("users").aggregate(pipe)
                let resources: Resource[] = await Config.db.db.collection("config").find({ "_type": "resource", "name": "Database Usage" }).toArray();
                if (resources.length > 0) {
                    let resource: Resource = resources[0];

                    for await (const c of cursor) {
                        if (c.dbusage == null) c.dbusage = 0;
                        const config: ResourceUsage = c.config[0];
                        index++;
                        if (config == null) {
                            if (c.dbusage > resource.defaultmetadata.dbusage) {
                                await Config.db.db.collection("users").updateOne({ "_id": c._id }, { $set: { "dblocked": true } });
                                if (!c.dblocked || c.dblocked) {
                                    Logger.instanse.debug("[housekeeping] dbblocking " + c.name + " using " + this.formatBytes(c.dbusage) + " allowed is " + this.formatBytes(resource.defaultmetadata.dbusage));
                                    await Config.db.db.collection("users").updateMany({ customerid: c._id }, { $set: { "dblocked": true } });
                                }
                            } else if (c.dbusage <= resource.defaultmetadata.dbusage) {
                                await Config.db.db.collection("users").updateOne({ "_id": c._id }, { $set: { "dblocked": false } });
                                if (c.dblocked || !c.dblocked) {
                                    Logger.instanse.debug("[housekeeping] unblocking " + c.name + " using " + this.formatBytes(c.dbusage) + " allowed is " + this.formatBytes(resource.defaultmetadata.dbusage));
                                    await Config.db.db.collection("users").updateMany({ customerid: c._id }, { $set: { "dblocked": false } });
                                }
                            }
                        } else if (config.product.customerassign == "single") {
                            let quota: number = resource.defaultmetadata.dbusage + (c.quantity * c.config.metadata.dbusage);
                            if (c.dbusage > quota) {
                                await Config.db.db.collection("users").updateOne({ "_id": c._id }, { $set: { "dblocked": true } });
                                if (!c.dblocked || c.dblocked) {
                                    Logger.instanse.debug("[housekeeping] dbblocking " + c.name + " using " + this.formatBytes(c.dbusage) + " allowed is " + this.formatBytes(quota));
                                    await Config.db.db.collection("users").updateMany({ customerid: c._id }, { $set: { "dblocked": true } });
                                }
                            } else if (c.dbusage <= quota) {
                                await Config.db.db.collection("users").updateOne({ "_id": c._id }, { $set: { "dblocked": false } });
                                if (c.dblocked || !c.dblocked) {
                                    Logger.instanse.debug("[housekeeping] unblocking " + c.name + " using " + this.formatBytes(c.dbusage) + " allowed is " + this.formatBytes(quota));
                                    await Config.db.db.collection("users").updateMany({ customerid: c._id }, { $set: { "dblocked": false } });
                                }
                            }
                        } else if (config.product.customerassign == "metered") {
                            let billabledbusage: number = c.dbusage - resource.defaultmetadata.dbusage;
                            if (billabledbusage > 0) {
                                const billablecount = Math.ceil(billabledbusage / config.product.metadata.dbusage);

                                Logger.instanse.debug("[housekeeping] Add usage_record for " + c.name + " using " + this.formatBytes(billabledbusage) + " equal to " + billablecount + " units of " + this.formatBytes(config.product.metadata.dbusage));
                                const dt = parseInt((new Date().getTime() / 1000).toFixed(0))
                                const payload: any = { "quantity": billablecount, "timestamp": dt };
                                if (!NoderedUtil.IsNullEmpty(config.siid) && !NoderedUtil.IsNullEmpty(c.stripeid)) {
                                    await this.Stripe("POST", "usage_records", config.siid, payload, c.stripeid);
                                }
                            }
                            if (c.dblocked || !c.dblocked) {
                                await Config.db.db.collection("users").updateOne({ "_id": c._id }, { $set: { "dblocked": false } });
                                await Config.db.db.collection("users").updateMany({ customerid: c._id }, { $set: { "dblocked": false } });
                            }
                        }
                        // await Config.db.db.collection("users").updateOne({ _id: c._id }, { $set: { "dbusage": c.dbusage } });
                        if (index % 100 == 0) Logger.instanse.debug("[housekeeping][" + index + "/" + usercount[0].userCount + "] Processing");
                    }
                    Logger.instanse.debug("[housekeeping] Completed updating all customers dbusage field");


                    const pipe2 = [
                        { "$match": { "_type": "user", "$or": [{ "customerid": { $exists: false } }, { "customerid": "" }] } },
                        { "$project": { "name": 1, "dbusage": 1, "dblocked": 1 } }];
                    const cursor2 = await Config.db.db.collection("users").aggregate(pipe2);
                    for await (const c of cursor2) {
                        if (Config.db.WellknownIdsArray.indexOf(c._id) > -1) continue;
                        if (c.dbusage == null) c.dbusage = 0;
                        if (c.dbusage > resource.defaultmetadata.dbusage) {
                            Logger.instanse.debug("[housekeeping] dbblocking " + c.name + " using " + this.formatBytes(c.dbusage) + " allowed is " + this.formatBytes(resource.defaultmetadata.dbusage));
                            await Config.db.db.collection("users").updateOne({ "_id": c._id }, { $set: { "dblocked": true } });
                        } else {
                            if (c.dblocked) {
                                await Config.db.db.collection("users").updateOne({ "_id": c._id }, { $set: { "dblocked": false } });
                                Logger.instanse.debug("[housekeeping] unblocking " + c.name + " using " + this.formatBytes(c.dbusage) + " allowed is " + this.formatBytes(resource.defaultmetadata.dbusage));
                            }

                        }
                    }
                    Logger.instanse.debug("[housekeeping] Completed updating all users without a customer dbusage field");
                }
            } catch (error) {
                if (error.response && error.response.body) {
                    Logger.instanse.error(error.response.body);
                    span.recordException(error.response.body);
                } else {
                    Logger.instanse.error(error);
                    span.recordException(error);
                }
            }
        }
        Logger.otel.endSpan(span);
    }
    async SelectCustomer(parent: Span): Promise<TokenUser> {
        let user: TokenUser = null;
        this.Reply();
        let msg: SelectCustomerMessage;
        try {
            msg = SelectCustomerMessage.assign(this.data);
            if (!NoderedUtil.IsNullEmpty(msg.customerid)) {
                var customer = await Config.db.getbyid<Customer>(msg.customerid, "users", this.jwt, parent)
                if (customer == null) msg.customerid = null;
            }
            user = User.assign(Crypt.verityToken(this.jwt));
            if (Config.db.WellknownIdsArray.indexOf(user._id) != -1) throw new Error("Builtin entities cannot select a company")

            if (NoderedUtil.IsNullEmpty(msg.customerid)) {
                {
                    if (!user.HasRoleName("resellers") && !user.HasRoleName("admins")) {
                        msg.customerid = user.customerid;
                    }
                }
            }

            const UpdateDoc: any = { "$set": {} };
            UpdateDoc.$set["selectedcustomerid"] = msg.customerid;
            await Config.db._UpdateOne({ "_id": user._id }, UpdateDoc, "users", 1, false, Crypt.rootToken(), parent);
            user.selectedcustomerid = msg.customerid;
        } catch (error) {
            await handleError(null, error);
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) {
                msg.error = (error.message ? error.message : error);
            }
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            await handleError(null, error);
        }
        return user;
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