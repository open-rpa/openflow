import mimetype from "mimetype";
import webpush from "web-push";
import { SocketMessage } from "../SocketMessage.js";
import { Auth } from "../Auth.js";
import { Crypt } from "../Crypt.js";
import { Config } from "../Config.js";
import { Audit, tokenType, clientType } from "../Audit.js";
import { LoginProvider } from "../LoginProvider.js";
import { Readable, Stream } from "stream";
import { GridFSBucket, ObjectId, Binary, FindCursor, GridFSFile, Filter } from "mongodb";
import path from "path";
import { DatabaseConnection } from "../DatabaseConnection.js";
import { StripeMessage, NoderedUtil, QueuedMessage, RegisterQueueMessage, QueueMessage, CloseQueueMessage, ListCollectionsMessage, DropCollectionMessage, QueryMessage, AggregateMessage, InsertOneMessage, UpdateOneMessage, Base, UpdateManyMessage, InsertOrUpdateOneMessage, DeleteOneMessage, MapReduceMessage, SigninMessage, TokenUser, User, Rights, SaveFileMessage, WellknownIds, GetFileMessage, UpdateFileMessage, NoderedUser, WatchMessage, GetDocumentVersionMessage, DeleteManyMessage, InsertManyMessage, RegisterExchangeMessage, EnsureCustomerMessage, Customer, stripe_tax_id, Role, SelectCustomerMessage, Rolemember, ResourceUsage, Resource, ResourceVariant, stripe_subscription, GetNextInvoiceMessage, stripe_invoice, stripe_price, stripe_plan, stripe_invoice_line, GetKubeNodeLabelsMessage, CreateWorkflowInstanceMessage, WorkitemFile, InsertOrUpdateManyMessage, Ace, stripe_base, CountMessage, CreateCollectionMessage } from "@openiap/openflow-api";
import { stripe_customer, stripe_list, StripeAddPlanMessage, StripeCancelPlanMessage, stripe_subscription_item, stripe_coupon } from "@openiap/openflow-api";
import { amqpwrapper, QueueMessageOptions } from "../amqpwrapper.js";
import { WebSocketServerClient } from "../WebSocketServerClient.js";
import { WebSocketServer } from "../WebSocketServer.js";
import { OAuthProvider } from "../OAuthProvider.js";
import { Span } from "@opentelemetry/api";
import { Logger } from "../Logger.js";
import { QueueClient } from "../QueueClient.js";
import { AddWorkitemMessage, AddWorkitemQueueMessage, AddWorkitemsMessage, CustomCommandMessage, DeleteWorkitemMessage, DeleteWorkitemQueueMessage, GetWorkitemQueueMessage, PopWorkitemMessage, UpdateWorkitemMessage, UpdateWorkitemQueueMessage, Workitem, WorkitemQueue } from "@openiap/openflow-api";
import { WebServer } from "../WebServer.js";
import { iAgent } from "../commoninterfaces.js";
import { RateLimiterMemory } from "rate-limiter-flexible";
import got from "got";
import pako from "pako";
import { HouseKeeping } from "../HouseKeeping.js";
import { GitProxy } from "../ee/GitProxy.js";

async function handleError(cli: WebSocketServerClient, error: Error, span: Span) {
    try {
        if (cli == null) {
            Logger.instanse.error(error, span);
            return;
        }
        if (!NoderedUtil.IsNullUndefinded(WebSocketServer.websocket_errors))
            WebSocketServer.websocket_errors.add(1, { ...Logger.otel.defaultlabels });
        if (Config.socket_rate_limit) await WebSocketServer.ErrorRateLimiter.consume(cli.id);
        Logger.instanse.error(error, span, Logger.parsecli(cli));
    } catch (error) {
        if (error.consumedPoints) {
            Logger.instanse.warn("SOCKET_ERROR_RATE_LIMIT: Disconnecing client ! consumedPoints: " + error.consumedPoints + " remainingPoints: " +
                error.remainingPoints + " msBeforeNext: " + error.msBeforeNext, span, Logger.parsecli(cli));
            cli.devnull = true;
            cli.Close(span);
        }
    }

}

const safeObjectID = (s: string | number | ObjectId) => ObjectId.isValid(s) ? new ObjectId(s) : null;
export class Message {
    public id: string;
    public replyto: string;
    public command: string;
    public data: string;
    public jwt: string;
    public correlationId: string;
    public traceId: string;
    public spanId: string;
    public cb: any;
    public priority: number = 1;
    public options: QueueMessageOptions;
    public tuser: User;
    public clientagent: string;
    public clientversion: string;
    public async QueueProcess(options: QueueMessageOptions, parent: Span): Promise<void> {
        let span: Span = undefined;
        try {
            this.options = options;
            const ot_end = Logger.otel.startTimer();
            span = Logger.otel.startSubSpan("QueueProcessMessage " + this.command, parent);
            span?.setAttribute("command", this.command);
            span?.setAttribute("id", this.id);
            if (await this.EnsureJWT(null, true)) {
                switch (this.command) {
                    case "listcollections":
                        await this.ListCollections(span);
                        break;
                    case "dropcollection":
                        await this.DropCollection(span);
                        break;
                    case "createcollection":
                        await this.CreateCollection(span);
                        break;
                    case "query":
                        await this.Query(span);
                        break;
                    case "count":
                        await this.Count(span);
                        break;
                    case "distinct":
                        await this.Distinct(span);
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
                    case "insertorupdatemany":
                        await this.InsertOrUpdateMany(span);
                        break;
                    case "deleteone":
                        await this.DeleteOne(span);
                        break;
                    case "deletemany":
                        await this.DeleteMany(span);
                        break;
                    case "housekeeping":
                        await this.Housekeeping(span);
                        break;
                    case "updateworkitemqueue":
                        await this.UpdateWorkitemQueue(span);
                        break;
                    case "deleteworkitemqueue":
                        await this.DeleteWorkitemQueue(span);
                        break;
                    default:
                        this.UnknownCommand();
                        break;
                }
            } else {
                Logger.instanse.debug("Discard " + this.command + " due to missing jwt", span);
            }
            if (!NoderedUtil.IsNullUndefinded(WebSocketServer.websocket_messages)) Logger.otel.endTimer(ot_end, WebSocketServer.websocket_messages, { command: this.command });
        } catch (error) {
            Logger.instanse.error(error, span);
            this.command = "error";
            this.data = JSON.stringify(error, Object.getOwnPropertyNames(error))
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
        result.clientagent = msg.clientagent;
        result.clientversion = msg.clientversion;
        result.data = data;
        // if data is object
        if (data && typeof data === "object") {
            result.traceId = (data as any).traceId;
            result.spanId = (data as any).spanId;
        }
        // if data is string
        if (data && typeof data === "string") {
            try {
                var obj = JSON.parse(data);
                result.traceId = obj.traceId;
                result.spanId = obj.spanId;
            } catch (error) {

            }
        }
        return result;
    }
    public static fromjson(json: string): Message {
        const result: Message = new Message();
        let data: any = json;
        if (typeof data == "string") data = JSON.parse(json);
        result.id = data.id;
        result.replyto = data.replyto;
        result.command = data.command;
        result.clientagent = data.clientagent;
        result.clientversion = data.clientversion;
        result.data = data.data;
        result.jwt = data.jwt;
        result.traceId = data.traceId;
        result.spanId = data.spanId;
        return result;
    }
    public Reply(command: string = null): void {
        if (!NoderedUtil.IsNullEmpty(command)) { this.command = command; }
        this.replyto = this.id;
        this.id = NoderedUtil.GetUniqueIdentifier();
    }
    public async EnsureJWT(cli: WebSocketServerClient, jwtrequired: boolean): Promise<boolean> {
        if (!NoderedUtil.IsNullUndefinded(this.data)) {
            var obj: any = this.data;
            if (typeof obj == "string") obj = JSON.parse(obj);
            if (!NoderedUtil.IsNullEmpty(obj.jwt)) {
                this.jwt = obj.jwt;
                if (jwtrequired) delete obj.jwt;
                this.data = JSON.stringify(obj);
            }
        }
        if (!NoderedUtil.IsNullUndefinded(cli) && NoderedUtil.IsNullEmpty(this.jwt)) {
            this.jwt = cli.jwt;
        }
        if (NoderedUtil.IsNullEmpty(this.jwt) && jwtrequired) {
            if (Config.enable_guest == true) {
                this.tuser = await Crypt.guestUser();
                this.jwt = Crypt.createToken(this.tuser, Config.shorttoken_expires_in);
            } else {
                throw new Error("Not signed in, and missing jwt");
            }
            // this.Reply("error");
            // this.data = "{\"message\": \"Not signed in, and missing jwt\", \"error\": \"Not signed in, and missing jwt\"}";
            // cli?.Send(this);
            // return false;
        } else if (!NoderedUtil.IsNullEmpty(this.jwt)) {
            try {
                this.tuser = await Auth.Token2User(this.jwt, null);
                if(this.tuser == null) {
                    // Invalid or expired token
                    return false;
                }
            } catch (error) {
                if (Config.log_blocked_ips) Logger.instanse.error((error.message ? error.message : error), null, Logger.parsecli(cli));
                if (this.command == "signin") {
                    try {
                        var msg = SigninMessage.assign(this.data);
                        if (cli != null) {
                            if (NoderedUtil.IsNullEmpty(cli.clientagent) && !NoderedUtil.IsNullEmpty(msg.clientagent)) {
                                if(msg.clientagent == "pyclient") msg.clientagent = "python"
                                cli.clientagent = msg.clientagent as any;
                                // @ts-ignore
                                cli.agent = msg.clientagent as any;
                            }
                            if (NoderedUtil.IsNullEmpty(cli.clientversion) && !NoderedUtil.IsNullEmpty(msg.clientversion)) {
                                cli.clientversion = msg.clientversion;
                                // @ts-ignore
                                cli.version = msg.clientversion;
                            }
                        }
                    } catch (error) {
                    }
                }
                this.Reply("error");
                this.data = JSON.stringify({ "error": (error.message ? error.message : error) });
                throw error;
                // setTimeout(() => {
                //     cli?.Send(this);    
                // }, 1000);                
                return false;
            }
        }
        return true;
    }
    public async Process(cli: WebSocketServerClient): Promise<any> {
        return new Promise<any>(async (resolve, reject) => {
            if (cli.devnull) return resolve(null);
            let span: Span = undefined;
            try {
                let username: string = "Unknown";
                if (!NoderedUtil.IsNullUndefinded(cli.user)) { username = cli.user.username; }

                if (!NoderedUtil.IsNullEmpty(this.command)) { this.command = this.command.toLowerCase(); }
                let command: string = this.command;
                try {
                    if(Config.socket_rate_limit_duration != WebSocketServer.BaseRateLimiter.duration || Config.socket_rate_limit_points != WebSocketServer.BaseRateLimiter.points) {
                        Logger.instanse.info("Create new socket rate limitter", span, Logger.parsecli(cli));
                        WebSocketServer.BaseRateLimiter = new RateLimiterMemory({
                            points: Config.socket_rate_limit_points,
                            duration: Config.socket_rate_limit_duration,
                        });            
                    }
    
                    if (Config.socket_rate_limit) await WebSocketServer.BaseRateLimiter.consume(cli.id);
                } catch (error) {
                    // if (error.consumedPoints) {
                    //     if (!NoderedUtil.IsNullUndefinded(WebSocketServer.websocket_rate_limit))
                    //         WebSocketServer.websocket_rate_limit.add(1, { ...Logger.otel.defaultlabels, command: command });
                    //     if ((error.consumedPoints % 10) == 1 || error.consumedPoints > 0) {
                    //         // Logger.instanse.warn("[" + username + "/" + cli.clientagent + "/" + cli.id + "] SOCKET_RATE_LIMIT consumedPoints: " + error.consumedPoints + " remainingPoints: " + error.remainingPoints + " msBeforeNext: " + error.msBeforeNext, span);
                    //     }
                         if (error.consumedPoints >= Config.socket_rate_limit_points_disconnect) {
                    //         Logger.instanse.warn("[" + username + "/" + cli.clientagent + "/" + cli.id + "] SOCKET_RATE_LIMIT: Disconnecing client ! consumedPoints: " + error.consumedPoints + " remainingPoints: " + error.remainingPoints + " msBeforeNext: " + error.msBeforeNext, span);
                    //         cli.devnull = true;
                    //         cli.Close(span);
                    //         return;
                         }
                    //     setTimeout(() => { this.Process(cli); }, 250);
                    // }
                    // return;
                    var e = new Error("Rate limit exceeded consumedPoints: " + error.consumedPoints);
                    return reject(e);
                }

                if (!NoderedUtil.IsNullEmpty(this.replyto)) {
                    const qmsg: QueuedMessage = cli.messageQueue[this.replyto];
                    if (!NoderedUtil.IsNullUndefinded(qmsg)) {
                        span = Logger.otel.startSpan("ProcessMessageReply " + command, this.traceId, this.spanId);
                        span?.setAttribute("clientid", cli.id);
                        span?.setAttribute("command", command);
                        span?.setAttribute("id", this.id);
                        span?.setAttribute("replyto", this.replyto);
                        if (!NoderedUtil.IsNullEmpty(cli.clientversion)) span?.setAttribute("clientversion", cli.clientversion);
                        if (!NoderedUtil.IsNullEmpty(cli.clientagent)) span?.setAttribute("clientagent", cli.clientagent);
                        if (!NoderedUtil.IsNullEmpty(cli.remoteip)) span?.setAttribute("remoteip", cli.remoteip);
                        if (!NoderedUtil.IsNullUndefinded(cli.user) && !NoderedUtil.IsNullEmpty(cli.user.username)) span?.setAttribute("username", cli.user.username);
                        const ot_end = Logger.otel.startTimer();
                        try {
                            qmsg.message = Object.assign(qmsg.message, JSON.parse(this.data));
                        } catch (error) {
                            // TODO: should we set message to data ?
                        }
                        if (!NoderedUtil.IsNullUndefinded(qmsg.cb)) { qmsg.cb(this); }
                        delete cli.messageQueue[this.replyto];
                        if (!NoderedUtil.IsNullUndefinded(WebSocketServer.websocket_messages)) Logger.otel.endTimer(ot_end, WebSocketServer.websocket_messages, { command: command });
                    }
                    return resolve(null);
                }
                const ot_end = Logger.otel.startTimer();
                span = Logger.otel.startSpan("ProcessMessage " + command, this.traceId, this.spanId);
                span?.setAttribute("clientid", cli.id);
                if (!NoderedUtil.IsNullEmpty(cli.clientversion)) span?.setAttribute("clientversion", cli.clientversion);
                if (!NoderedUtil.IsNullEmpty(cli.clientagent)) span?.setAttribute("clientagent", cli.clientagent);
                if (!NoderedUtil.IsNullEmpty(cli.remoteip)) span?.setAttribute("remoteip", cli.remoteip);
                if (!NoderedUtil.IsNullUndefinded(cli.user) && !NoderedUtil.IsNullEmpty(cli.user.username)) span?.setAttribute("username", cli.user.username);
                span?.setAttribute("command", command);
                span?.setAttribute("id", this.id);
                let process: boolean = true;
                if (command != "signin" && command != "refreshtoken" && command != "error") {
                    if (!await this.EnsureJWT(cli, true)) {
                        Logger.instanse.debug("Discard " + command + " due to missing jwt, and respond with error, for client at " + cli.remoteip + " " + cli.clientagent + " " + cli.clientversion, span, Logger.parsecli(cli));
                        process = false;
                        if (Config.client_disconnect_signin_error) setTimeout(() => { cli.Close(span); }, 500);

                        if(this.replyto == null || this.replyto == "") {
                            this.Reply("error");
                        } else {
                            this.command = "error";                    
                        }
                        const error = new Error("Discard " + command + " due to missing jwt, and respond with error, for client at " + cli.remoteip + " " + cli.clientagent + " " + cli.clientversion);
                        this.data = JSON.stringify({"message": error.message});
                        delete this.jwt;
                        delete this.tuser;
                        return resolve(this);

                    }
                } else if (command == "signin") {
                    if (!await this.EnsureJWT(cli, false)) {
                        this.parseSignAgent(cli, span);
                        if (Config.client_disconnect_signin_error) setTimeout(() => { cli.Close(span); }, 500);
                        Logger.instanse.debug("Discard " + command + " due to missing jwt, and respond with error, for client at " + cli.remoteip + " " + cli.clientagent + " " + cli.clientversion, span, Logger.parsecli(cli));
                        process = false;

                        if(this.replyto == null || this.replyto == "") {
                            this.Reply("error");
                        } else {
                            this.command = "error";                    
                        }
                        const error = new Error("Discard " + command + " due to invalid or expired jwt for client at " + cli.remoteip + " " + cli.clientagent + " " + cli.clientversion);
                        this.data = JSON.stringify({"message": error.message});
                        delete this.jwt;
                        delete this.tuser;
                        return resolve(this);

                        // throw new Error("Discard " + command + " due to invalid or expired jwt for client at " + cli.remoteip + " " + cli.clientagent + " " + cli.clientversion);
                    }
                }
                if (process) {
                    switch (command) {
                        case "listcollections":
                            if (Config.enable_openflow_amqp) {
                                return resolve(await QueueClient.SendForProcessing(this, this.priority, span));
                            } else {
                                await this.ListCollections(span);
                            }
                            break;
                        case "dropcollection":
                            if (Config.enable_openflow_amqp) {
                                return resolve(await QueueClient.SendForProcessing(this, this.priority, span));
                            } else {
                                await this.DropCollection(span);
                            }
                            break;
                        case "createcollection":
                            if (Config.enable_openflow_amqp) {
                                return resolve(await QueueClient.SendForProcessing(this, this.priority, span));
                            } else {
                                await this.CreateCollection(span);
                            }
                            break;
                        case "query":
                            this.clientagent = cli.clientagent;
                            this.clientversion = cli.clientversion;
                            if (Config.enable_openflow_amqp) {
                                return resolve(await QueueClient.SendForProcessing(this, this.priority, span));
                            } else {
                                await this.Query(span);
                            }
                            break;
                        case "count":
                            if (Config.enable_openflow_amqp) {
                                return resolve(await QueueClient.SendForProcessing(this, this.priority, span));
                            } else {
                                await this.Count(span);
                            }
                            break;
                        case "distinct":
                            if (Config.enable_openflow_amqp) {
                                return resolve(await QueueClient.SendForProcessing(this, this.priority, span));
                            } else {
                                await this.Distinct(span);
                            }
                            break;
                        case "getdocumentversion":
                            this.clientagent = cli.clientagent;
                            this.clientversion = cli.clientversion;
                            if (Config.enable_openflow_amqp) {
                                return resolve(await QueueClient.SendForProcessing(this, this.priority, span));
                            } else {
                                await this.GetDocumentVersion(span);
                            }
                            break;
                        case "aggregate":
                            this.clientagent = cli.clientagent;
                            this.clientversion = cli.clientversion;
                            if (Config.enable_openflow_amqp) {
                                return resolve(await QueueClient.SendForProcessing(this, this.priority, span));
                            } else {
                                await this.Aggregate(span);
                            }
                            break;
                        case "watch":
                            await this.Watch(cli);
                            break;
                        case "unwatch":
                            await this.UnWatch(cli);
                            break;
                        case "insertone":
                            this.clientagent = cli.clientagent;
                            this.clientversion = cli.clientversion;
                            if (Config.enable_openflow_amqp) {
                                return resolve(await QueueClient.SendForProcessing(this, this.priority, span));
                            } else {
                                await this.InsertOne(span);
                            }
                            break;
                        case "insertmany":
                            this.clientagent = cli.clientagent;
                            this.clientversion = cli.clientversion;
                            if (Config.enable_openflow_amqp) {
                                return resolve(await QueueClient.SendForProcessing(this, this.priority, span));
                            } else {
                                await this.InsertMany(span);
                            }
                            break;
                        case "updateone":
                            this.clientagent = cli.clientagent;
                            this.clientversion = cli.clientversion;
                            if (Config.enable_openflow_amqp) {
                                return resolve(await QueueClient.SendForProcessing(this, this.priority, span));
                            } else {
                                await this.UpdateOne(span);
                            }
                            break;
                        case "updatemany":
                            this.clientagent = cli.clientagent;
                            this.clientversion = cli.clientversion;
                            if (Config.enable_openflow_amqp) {
                                return resolve(await QueueClient.SendForProcessing(this, this.priority, span));
                            } else {
                                await this.UpdateMany(span);
                            }
                            break;
                        case "insertorupdateone":
                            this.clientagent = cli.clientagent;
                            this.clientversion = cli.clientversion;
                            if (Config.enable_openflow_amqp) {
                                return resolve(await QueueClient.SendForProcessing(this, this.priority, span));
                            } else {
                                await this.InsertOrUpdateOne(span);
                            }
                            break;
                        case "insertorupdatemany":
                            this.clientagent = cli.clientagent;
                            this.clientversion = cli.clientversion;
                            if (Config.enable_openflow_amqp) {
                                return resolve(await QueueClient.SendForProcessing(this, this.priority, span));
                            } else {
                                await this.InsertOrUpdateMany(span);
                            }
                            break;
                        case "deleteone":
                            if (Config.enable_openflow_amqp) {
                                return resolve(await QueueClient.SendForProcessing(this, this.priority, span));
                            } else {
                                await this.DeleteOne(span);
                            }
                            break;
                        case "deletemany":
                            if (Config.enable_openflow_amqp) {
                                return resolve(await QueueClient.SendForProcessing(this, this.priority, span));
                            } else {
                                await this.DeleteMany(span);
                            }
                            break;
                        case "signin":
                            await this.Signin(cli, span);
                            break;
                        case "refreshtoken":
                            break;
                        case "error":
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
                        case "getkubenodelabels":
                            await this.GetKubeNodeLabels(cli, span);
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
                        case "getnextinvoice":
                            await this.GetNextInvoice(cli, span);
                            break;
                        case "stripecancelplan":
                            await this.StripeCancelPlan(cli, span);
                            break;
                        case "ensurestripecustomer":
                            this.Reply();
                            break;
                        case "stripemessage":
                            await this.StripeMessage(cli);
                            break;
                        case "ensurecustomer":
                            await this.EnsureCustomer(cli, span);
                            break;
                        case "selectcustomer":
                            var user = await this.SelectCustomer(span);
                            if (user != null) cli.user.selectedcustomerid = user.selectedcustomerid;
                            this.ReloadUserToken(cli, span);
                            break;
                        case "housekeeping":
                            if (Config.enable_openflow_amqp) {
                                return resolve(await QueueClient.SendForProcessing(this, this.priority, span));
                            } else {
                                await this.Housekeeping(span);
                            }
                            break;
                        case "addworkitemqueue":
                            await this.AddWorkitemQueue(cli, span);
                            break;
                        case "getworkitemqueue":
                            await this.GetWorkitemQueue(span);
                            break;
                        case "updateworkitemqueue":
                            if (Config.enable_openflow_amqp) {
                                return resolve(await QueueClient.SendForProcessing(this, this.priority, span));
                            } else {
                                await this.UpdateWorkitemQueue(span);
                            }
                            break;
                        case "deleteworkitemqueue":
                            if (Config.enable_openflow_amqp) {
                                return resolve(await QueueClient.SendForProcessing(this, this.priority, span));
                            } else {
                                await this.DeleteWorkitemQueue(span);
                            }
                            break;
                        case "addworkitem":
                            await this.AddWorkitem(span);
                            break;
                        case "addworkitems":
                            await this.AddWorkitems(span);
                            break;
                        case "popworkitem":
                            await this.PopWorkitem(span);
                            break;
                        case "updateworkitem":
                            await this.UpdateWorkitem(span);
                            break;
                        case "deleteworkitem":
                            await this.DeleteWorkitem(span);
                            break;
                        case "startagent":
                            await this.ControlAgent(span);
                            break;
                        case "stopagent":
                            await this.ControlAgent(span);
                            break;
                        case "deleteagentpod":
                            await this.ControlAgent(span);
                            break;
                        case "getagentlog":
                            await this.ControlAgent(span);
                            break;
                        case "getagentpods":
                            await this.ControlAgent(span);
                            break;
                        case "deleteagent":
                            await this.ControlAgent(span);
                            break;
                        case "createindex":
                            await this.CreateIndex(span);
                            break;
                        case "dropindex":
                            await this.DropIndex(span);
                            break;                            
                        case "getindexes":
                            await this.GetIndexes(span);
                            break;                        
                        case "deletepackage":
                            await this.DeletePackage(span);
                            break;
                        case "issuelicense":
                            await this.IssueLicense(cli, span);
                            break;
                        case "invokeopenra":
                            await this.InvokeOpenRPA(cli, span);
                            break;
                        case "customcommand":
                            await this.CustomCommand(cli, span);
                            break;
                        default:
                            if (command != "error") {
                                this.UnknownCommand();
                            } else {
                                var b = true;
                            }
                            break;
                    }
                }
                if (!NoderedUtil.IsNullUndefinded(WebSocketServer.websocket_messages)) Logger.otel.endTimer(ot_end, WebSocketServer.websocket_messages, { command: command });
                resolve(this);
            } catch (error) {
                // reject(error);
                // Logger.instanse.error(error, span, Logger.parsecli(cli));

                if(this.replyto == null || this.replyto == "") {
                    this.Reply("error");
                } else {
                    this.command = "error";                    
                }
                this.data = JSON.stringify({"message": error.message});
                if(error.message.indexOf("Not signed in, and missing jwt") > -1) {
                    Logger.instanse.error(error.message, span, Logger.parsecli(cli));
                } else {
                    Logger.instanse.error(error, span, Logger.parsecli(cli));
                }
                delete this.jwt;
                delete this.tuser;
                resolve(this);
                
            } finally {
                Logger.otel.endSpan(span);
            }
        });
    }
    async ControlAgent(parent: Span) {
        this.Reply();
        let msg: any = this.data 
        if( typeof this.data == "string") {
            msg = JSON.stringify(this.data)
        }
        msg =JSON.parse(JSON.stringify(msg));
        try {
            console.log(this.data);
            if (Logger.agentdriver == null) throw new Error("No agentdriver is loaded")
            var agent = null;
            if((msg.agentid == null || msg.agentid == "")) {
                if(this.command != "getagentpods") throw new Error("No agentid is specified");
            } else {
                agent = await Config.db.GetOne<iAgent>({ query: { _id: msg.agentid }, collectionname: "agents", jwt:this.jwt }, parent);
                if(agent == null) throw new Error("Access denied");
                if (!DatabaseConnection.hasAuthorization(this.tuser, agent, Rights.invoke)) {
                    throw new Error(`[${this.tuser.name}] Access denied, missing invoke permission on ${agent.name}`);
                }
                if(agent.image == null || agent.image == "") return;
            }
    
            
            if(this.command == "startagent") {
                await Logger.agentdriver.EnsureInstance(this.tuser, this.jwt, agent, parent);
            } else if(this.command == "stopagent") {
                await Logger.agentdriver.RemoveInstance(this.tuser, this.jwt, agent, false, parent);
            } else if(this.command == "getagentlog") {
                msg.result = await Logger.agentdriver.GetInstanceLog(this.tuser, this.jwt, agent, msg.podname, parent);
            } else if(this.command == "getagentpods") {
                var getstats = false;
                if(!NoderedUtil.IsNullEmpty(msg.stats)) getstats = msg.stats;
                msg.results = await Logger.agentdriver.GetInstancePods(this.tuser, this.jwt, agent, msg.podname, parent);
                // msg.results = JSON.stringify(await Logger.agentdriver.GetInstancePods(this.tuser, this.jwt, agent, msg.podname, parent));
                var b = true;
            } else if(this.command == "deleteagentpod") {
                await Logger.agentdriver.RemoveInstancePod(this.tuser, this.jwt, agent, msg.podname, parent);
            } else if(this.command == "deleteagent") {
                if (!DatabaseConnection.hasAuthorization(this.tuser, agent, Rights.delete)) {
                    throw new Error(`[${this.tuser.name}] Access denied, missing delete permission on ${agent.name}`);
                }    
                await Logger.agentdriver.RemoveInstance(this.tuser, this.jwt, agent, true, parent);
                Config.db.DeleteOne(agent._id, "agents", false, this.jwt, parent);
            }            
        } finally {
            this.data = JSON.stringify(msg);
        }
    }
    async CreateIndex(parent: Span) {
        this.Reply();
        let msg: any = this.data 
        if( typeof this.data == "string") {
            msg = JSON.stringify(this.data)
        }
        msg = JSON.parse(JSON.stringify(msg));
        try {
            if (!this.tuser.HasRoleId(WellknownIds.admins)) throw new Error("Access denied");
            msg.result = await Config.db.createIndex(msg.collectionname, msg.name, msg.index, msg.options, parent);
        } finally {
            this.data = JSON.stringify(msg);
        }
    }
    async GetIndexes(parent: Span) {
        this.Reply();
        let msg: any = this.data 
        if( typeof this.data == "string") {
            msg = JSON.stringify(this.data)
        }
        msg = JSON.parse(JSON.stringify(msg));
        try {
            if (!this.tuser.HasRoleId(WellknownIds.admins)) throw new Error("Access denied");
            const indexes = await Config.db.db.collection(msg.collectionname).indexes();
            msg.results = indexes;
        } finally {
            this.data = JSON.stringify(msg);
        }
    }
    async DropIndex(parent: Span) {
        this.Reply();
        let msg: any = this.data 
        if( typeof this.data == "string") {
            msg = JSON.stringify(this.data)
        }
        msg = JSON.parse(JSON.stringify(msg));
        try {
            if (!this.tuser.HasRoleId(WellknownIds.admins)) throw new Error("Access denied");
            msg.result = await Config.db.deleteIndex(msg.collectionname, msg.name, parent);
        } finally {
            this.data = JSON.stringify(msg);
        }
    }
    async DeletePackage(parent: Span) {
        this.Reply();
        let msg: any = this.data 
        if( typeof this.data == "string") {
            msg = JSON.stringify(this.data)
        }
        try {
            var pack = await Config.db.GetOne<any>({ query: { _id: msg.id, "_type": "package" }, collectionname: "agents", jwt: this.jwt }, parent);
            if(pack == null) throw new Error("Access denied or package not found");
            if (!DatabaseConnection.hasAuthorization(this.tuser, pack, Rights.delete)) {
                throw new Error(`[${this.tuser.name}] Access denied, missing delete permission on ${pack.name}`);
            }
            if(pack.fileid != null && pack.fileid != "") {
                const rootjwt = Crypt.rootToken();
                let query = { _id: pack.fileid };
                const item = await Config.db.GetOne<any>({ query, collectionname: "fs.files", jwt: rootjwt }, parent);
                if(item != null) {
                    await Config.db.DeleteOne(pack.fileid, "files", false, this.jwt, parent);
                }
            }
            await Config.db.DeleteOne(pack._id, "agents", false, this.jwt, parent);
        } finally {
            this.data = JSON.stringify(msg);
        }
    }
    async IssueLicense(cli: WebSocketServerClient, parent: Span) {
        this.Reply();
        let msg: any = this.data 
        if( typeof this.data == "string") {
            msg = JSON.stringify(this.data)
        }
        try {
            try {
                // @ts-ignore
                let _lic_require: any = await import("../ee/license-file.js");
                Logger.License = new _lic_require.LicenseFile();
            } catch (error) {
                console.error(error.message);
            }
            // @ts-ignore
            var data = msg.data;
            try {
                data = JSON.parse(data);
            } catch (error) {                    
            }
            if(data == null || data == "") throw new Error("No data found");
            var domain = data.domain;
            if (!this.tuser.HasRoleId(WellknownIds.admins)) {
                delete data.months;
            }
            var exists = await Config.db.GetOne<any>({ query: { domains: domain, "_type": "resourceusage"}, collectionname: "config", jwt:this.jwt }, parent);
            if (!this.tuser.HasRoleId(WellknownIds.admins)) {
                if(exists == null) throw new Error("Access denied");
            }
            if(data.months == null || data.months == "") {
                if(exists != null && exists.issuemonths != null) data.months = parseInt(exists.issuemonths);
            }
            //  throw new Error("Access denied");
            msg.result = await Logger.License.generate2(data, cli?.remoteip, this.tuser, parent);
        } finally {
            this.data = JSON.stringify(msg);
        }
    }
    async InvokeOpenRPA(cli: WebSocketServerClient, parent: Span) {
        this.Reply();
        let msg: any = this.data 
        if( typeof this.data == "string") {
            msg = JSON.stringify(this.data)
        }
        try {
            throw new Error("Not implemented, only available using OpenAPI");
        } finally {
            this.data = JSON.stringify(msg);
        }
    }    
    async RegisterExchange(cli: WebSocketServerClient, parent: Span) {
        this.Reply();
        let msg: RegisterExchangeMessage;
        msg = RegisterExchangeMessage.assign(this.data);
        if (NoderedUtil.IsNullEmpty(msg.exchangename) || msg.exchangename.toLowerCase() == "openflow") {
            throw new Error("Access denied");
        }
        const jwt: string = this.jwt;
        const rootjwt = Crypt.rootToken();
        const tuser = this.tuser;
        if (Config.amqp_force_exchange_prefix && !NoderedUtil.IsNullEmpty(msg.exchangename)) {
            let name = tuser.username.split("@").join("").split(".").join("");
            name = name.toLowerCase();
            msg.exchangename = name + msg.exchangename;
            if (msg.exchangename.length == 24) { msg.exchangename += "1"; }
        }

        if ((Config.amqp_force_sender_has_read || Config.amqp_force_sender_has_invoke) && !NoderedUtil.IsNullEmpty(msg.exchangename)) {
            let mq = await Logger.DBHelper.FindExchangeByName(msg.exchangename, rootjwt, parent);
            if (mq != null) {
                if (Config.amqp_force_consumer_has_update) {
                    if (!DatabaseConnection.hasAuthorization(tuser, mq, Rights.update)) {
                        throw new Error(`[${tuser.name}] Unknown queue ${msg.exchangename} or access denied, missing update permission on exchange object`);
                    }
                } else if (Config.amqp_force_sender_has_invoke) {
                    if (!DatabaseConnection.hasAuthorization(tuser, mq, Rights.invoke)) {
                        throw new Error(`[${tuser.name}] Unknown queue ${msg.exchangename} or access denied, missing invoke permission on exchange object`);
                    }
                } else {
                    if (!DatabaseConnection.hasAuthorization(tuser, mq, Rights.read)) {
                        throw new Error(`[${tuser.name}] Unknown queue ${msg.exchangename} or access denied, missing read permission on exchange object`);
                    }
                }
            } else {
                const q = new Base(); q._type = "exchange";
                q.name = msg.exchangename;
                const res = await Config.db.InsertOne(q, "mq", 1, true, jwt, parent);
                await Logger.DBHelper.CheckCache("mq", res, false, false, parent);
            }

        }
        if (NoderedUtil.IsNullUndefinded(msg.algorithm)) throw new Error("algorithm is mandatory, as either direct, fanout, topic or header");
        if (msg.algorithm != "direct" && msg.algorithm != "fanout" && msg.algorithm != "topic" && msg.algorithm != "header") {
            throw new Error("invalid algorithm must be either direct, fanout, topic or header");
        }
        if (NoderedUtil.IsNullUndefinded(msg.routingkey)) msg.routingkey = "";
        var addqueue: boolean = (msg.addqueue as any);
        if (NoderedUtil.IsNullEmpty(addqueue)) addqueue = true;
        addqueue = Config.parseBoolean(addqueue);
        var res = await cli.RegisterExchange(tuser, msg.exchangename, msg.algorithm, msg.routingkey, addqueue, parent);
        msg.queuename = res.queuename;
        msg.exchangename = res.exchangename;
        if(msg.queuename == null) msg.queuename = "";
        delete msg.jwt;
        this.data = JSON.stringify(msg);
    }
    async RegisterQueue(cli: WebSocketServerClient, span: Span) {
        this.Reply();
        let msg: RegisterQueueMessage;
        msg = RegisterQueueMessage.assign(this.data);
        const jwt: string = this.jwt;
        const rootjwt = Crypt.rootToken();
        if (!NoderedUtil.IsNullEmpty(msg.queuename)) msg.queuename = msg.queuename.toLowerCase();
        if (!NoderedUtil.IsNullEmpty(msg.queuename) && msg.queuename.toLowerCase() == "openflow") {
            throw new Error("Access denied");
        }

        const tuser = this.tuser;
        if (Config.amqp_force_queue_prefix && !NoderedUtil.IsNullEmpty(msg.queuename)) {
            // assume queue names if 24 letters is an mongodb is, should proberly do a real test here
            if (msg.queuename.length == 24) {
                let name = tuser.username.split("@").join("").split(".").join("");
                name = name.toLowerCase();
                let skip: boolean = false;
                if (tuser._id == msg.queuename) {
                    // Queue is for me
                    skip = false;
                } else if (tuser.roles != null) {
                    // Queue is for a group i am a member of.
                    const isrole = tuser.roles.filter(x => x._id == msg.queuename);
                    if (isrole.length > 0) skip = false;
                }
                if (skip) {
                    // Do i have permission to listen on a queue with this id ?
                    const arr = await Config.db.query({ query: { _id: msg.queuename }, projection: { name: 1 }, top: 1, collectionname: "users", jwt }, span);
                    if (arr.length == 0) skip = true;
                    if (!skip) {
                        msg.queuename = name + msg.queuename;
                        if (msg.queuename.length == 24) { msg.queuename += "1"; }
                    } else {
                        Logger.instanse.debug("skipped force prefix for " + msg.queuename, span);
                    }
                } else {
                    Logger.instanse.debug("[SKIP] skipped force prefix for " + msg.queuename, span);
                }
            } else {
                let name = tuser.username.split("@").join("").split(".").join("");
                name = name.toLowerCase();
                msg.queuename = name + msg.queuename;
                if (msg.queuename.length == 24) { msg.queuename += "1"; }
            }
        }
        if ((Config.amqp_force_sender_has_read || Config.amqp_force_sender_has_invoke) && !NoderedUtil.IsNullEmpty(msg.queuename)) {
            let allowed: boolean = false;
            if (tuser._id == msg.queuename) {
                // Queue is mine
                allowed = true;
            } else if (tuser.roles != null && !Config.amqp_force_consumer_has_update && !Config.amqp_force_sender_has_invoke) {
                // Queue is for a role i am a member of.
                const isrole = tuser.roles.filter(x => x._id == msg.queuename);
                if (isrole.length > 0) {
                    allowed = true;
                }
            }
            if (!allowed && msg.queuename.length == 24) {
                let mq = await Logger.DBHelper.FindById(msg.queuename, span);
                if (mq != null) {
                    if (Config.amqp_force_consumer_has_update) {
                        if (!DatabaseConnection.hasAuthorization(tuser, mq, Rights.update)) {
                            throw new Error(`[${tuser.name}] Unknown queue ${mq.name} or access denied, missing update permission on users object {mq._id}`);
                        }
                    } else if (Config.amqp_force_sender_has_invoke) {
                        if (!DatabaseConnection.hasAuthorization(tuser, mq, Rights.invoke)) {
                            throw new Error(`[${tuser.name}] Unknown queue ${mq.name} or access denied, missing invoke permission on users object {mq._id}`);
                        }
                    } else {
                        if (!DatabaseConnection.hasAuthorization(tuser, mq, Rights.read)) {
                            throw new Error(`[${tuser.name}] Unknown queue ${mq.name} or access denied, missing invoke permission on users object {mq._id}`);
                        }
                    }
                    allowed = true;
                }
            }
            if (!allowed) {
                let mq = await Logger.DBHelper.FindQueueByName(msg.queuename, rootjwt, span);
                if (mq == null) {
                    mq = await Logger.DBHelper.FindAgentBySlugOrId(msg.queuename, rootjwt, span) as any;
                }
                if (mq != null) {
                    if (Config.amqp_force_consumer_has_update) {
                        if (!DatabaseConnection.hasAuthorization(tuser, mq, Rights.update)) {
                            throw new Error(`[${tuser.name}] Unknown queue ${msg.queuename} or access denied, missing update permission on queue object`);
                        }
                    } else if (Config.amqp_force_sender_has_invoke) {
                        if (!DatabaseConnection.hasAuthorization(tuser, mq, Rights.invoke)) {
                            throw new Error(`[${tuser.name}] Unknown queue ${msg.queuename} or access denied, missing invoke permission on queue object`);
                        }
                    } else {
                        if (!DatabaseConnection.hasAuthorization(tuser, mq, Rights.read)) {
                            throw new Error(`[${tuser.name}] Unknown queue ${msg.queuename} or access denied, missing read permission on queue object`);
                        }
                    }
                    allowed = true;
                }
            }
            if (!allowed) {
                const q = new Base(); q._type = "queue";
                q.name = msg.queuename;
                const res = await Config.db.InsertOne(q, "mq", 1, true, jwt, span);
            }
        }
        msg.queuename = await cli.CreateConsumer(msg.queuename, span);
        delete msg.jwt;
        this.data = JSON.stringify(msg);
    }
    async QueueMessage(cli: WebSocketServerClient, parent: Span) {
        const span: Span = Logger.otel.startSubSpan("message.QueueMessage", parent);
        this.Reply();
        let msg: QueueMessage
        try {
            msg = QueueMessage.assign(this.data);
            // Backward compatibility
            // @ts-ignore
            if (!NoderedUtil.IsNullEmpty(msg.exchange) && NoderedUtil.IsNullEmpty(msg.exchangename)) {
                // @ts-ignore
                msg.exchangename = msg.exchange
            }
            const jwt: string = this.jwt;
            const rootjwt = Crypt.rootToken();
            if (!NoderedUtil.IsNullUndefinded(msg.data)) {
                if (typeof msg.data == "string") {
                    try {
                        const obj = JSON.parse(msg.data);
                    } catch (error) {
                    }
                } else {
                    msg.data.jwt = jwt;
                }
            }
            if (!NoderedUtil.IsNullEmpty(msg.exchangename) && !Config.amqp_enabled_exchange) {
                throw new Error("AMQP exchange is not enabled on this OpenFlow");
            }
            const expiration: number = (typeof msg.expiration == "number" ? msg.expiration : Config.amqp_default_expiration);
            if (typeof msg.data === "string" || msg.data instanceof String) {
                try {
                    msg.data = JSON.parse((msg.data as any));
                } catch (error) {
                }
            }
            if (Config.amqp_allow_replyto_empty_queuename) {
                if (!NoderedUtil.IsNullEmpty(msg.replyto) && NoderedUtil.IsNullEmpty(msg.queuename)) {
                    msg.queuename = msg.replyto;
                    msg.replyto = "";
                }
            }
            if (!NoderedUtil.IsNullEmpty(msg.queuename)) msg.queuename = msg.queuename.toLowerCase();
            if (!NoderedUtil.IsNullEmpty(msg.exchangename)) msg.exchangename = msg.exchangename.toLowerCase();
            if (!NoderedUtil.IsNullEmpty(msg.replyto)) msg.replyto = msg.replyto.toLowerCase();
            if (!NoderedUtil.IsNullEmpty(msg.queuename) && msg.queuename == "openflow") {
                throw new Error("Access denied");
            } else if (!NoderedUtil.IsNullEmpty(msg.exchangename) && msg.exchangename == "openflow") {
                throw new Error("Access denied");
            } else if (!NoderedUtil.IsNullEmpty(msg.replyto) && msg.replyto == "openflow") {
                throw new Error("Access denied");
            } else if (NoderedUtil.IsNullEmpty(msg.queuename) && NoderedUtil.IsNullEmpty(msg.exchangename)) {
                throw new Error("queuename or exchange must be given");
            }
            if ((Config.amqp_force_sender_has_read || Config.amqp_force_sender_has_invoke) && !NoderedUtil.IsNullEmpty(msg.queuename)) {
                const tuser = this.tuser;
                let allowed: boolean = false;
                if (tuser._id == msg.queuename) {
                    // Queue is for me
                    allowed = true;
                } else if (tuser.roles != null) {
                    // Queue is for a role i am a member of.
                    const isrole = tuser.roles.filter(x => x._id == msg.queuename);
                    if (isrole.length > 0) allowed = true;
                }
                if (!allowed && msg.queuename.length == 24) {
                    let mq = await Logger.DBHelper.FindById(msg.queuename, parent);
                    if (mq != null) {
                        if (Config.amqp_force_sender_has_invoke) {
                            if (!DatabaseConnection.hasAuthorization(tuser, mq, Rights.invoke)) {
                                throw new Error(`[${tuser.name}] Unknown queue ${mq.name} or access denied, missing invoke permission on users object ${mq._id}`);
                            }
                        } else {
                            if (!DatabaseConnection.hasAuthorization(tuser, mq, Rights.read)) {
                                throw new Error(`[${tuser.name}] Unknown queue ${mq.name} or access denied, missing read permission on users object ${mq._id}`);
                            }
                        }
                        allowed = true;
                    }
                }
                if (!allowed) {
                    let mq = await Logger.DBHelper.FindQueueByName(msg.queuename, rootjwt, parent);
                    if (mq == null) {
                        mq = await Logger.DBHelper.FindAgentBySlugOrId(msg.queuename, rootjwt, span) as any;
                    }
                    if (mq != null) {
                        if (Config.amqp_force_sender_has_invoke) {
                            if (!DatabaseConnection.hasAuthorization(tuser, mq, Rights.invoke)) {
                                throw new Error(`[${tuser.name}] Unknown queue ${msg.queuename} or access denied, missing invoke permission on queue object`);
                            }
                        } else {
                            if (!DatabaseConnection.hasAuthorization(tuser, mq, Rights.read)) {
                                throw new Error(`[${tuser.name}] Unknown queue ${msg.queuename} or access denied, missing read permission on queue object`);
                            }

                        }
                        allowed = true;
                    }
                }
            }
            if ((Config.amqp_force_sender_has_read || Config.amqp_force_sender_has_invoke) && !NoderedUtil.IsNullEmpty(msg.exchangename)) {
                const tuser = this.tuser;
                let allowed: boolean = false;
                if (tuser._id == msg.exchangename) {
                    // Queue is for me
                    allowed = true;
                } else if (tuser.roles != null) {
                    // Queue is for a role i am a member of.
                    const isrole = tuser.roles.filter(x => x._id == msg.exchangename);
                    if (isrole.length > 0) allowed = true;
                }
                if (!allowed) {
                    let mq = await Logger.DBHelper.FindExchangeByName(msg.exchangename, rootjwt, parent);
                    if (mq != null) {
                        if (Config.amqp_force_sender_has_invoke) {
                            if (!DatabaseConnection.hasAuthorization(tuser, mq, Rights.invoke)) {
                                throw new Error(`[${tuser.name}] Unknown exchange ${msg.exchangename} or access denied, missing invoke permission on exchange object`);
                            }
                        } else {
                            if (!DatabaseConnection.hasAuthorization(tuser, mq, Rights.read)) {
                                throw new Error(`[${tuser.name}] Unknown exchange ${msg.exchangename} or access denied, missing read permission on exchange object`);
                            }

                        }
                        allowed = true;
                    }
                }
            }
            const sendthis: any = msg.data;
            if (NoderedUtil.IsNullEmpty(msg.jwt) && !NoderedUtil.IsNullEmpty(msg.data.jwt)) {
                msg.jwt = msg.data.jwt;
            }
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = this.jwt; }
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            if (!NoderedUtil.IsNullEmpty(msg.jwt)) {
                const tuser = await Auth.Token2User(msg.jwt, span);
                if(tuser == null) throw new Error("Access denied");
                msg.user = TokenUser.From(tuser);
            }
            if (typeof sendthis === "object") {
                sendthis.__jwt = msg.jwt;
                sendthis.__user = msg.user;
                delete msg.jwt;
                delete msg.user;;
                delete msg.data.jwt;
            }
            if (msg.striptoken) {
                delete sendthis.__jwt;
                delete sendthis.__user;
            }
            if (NoderedUtil.IsNullEmpty(msg.replyto)) {
                const sendthis = msg.data;
                if(msg.queuename != null && msg.queuename != "" && amqpwrapper.bad_queues.indexOf(msg.queuename) > -1) {
                    throw new Error("bad queue: " + msg.queuename + " correlationId: " + msg.correlationId);
                } 
                await amqpwrapper.Instance().send(msg.exchangename, msg.queuename, sendthis, expiration, msg.correlationId, msg.routingkey, span);
            } else {
                // if (msg.queuename === msg.replyto) {
                //     throw new Error("Cannot send reply to self queuename: " + msg.queuename + " correlationId: " + msg.correlationId);
                // }
                if(msg.queuename != null && msg.queuename != "" && amqpwrapper.bad_queues.indexOf(msg.queuename) > -1) {
                    throw new Error("bad queue: " + msg.queuename + " correlationId: " + msg.correlationId);
                } 
                const sendthis = msg.data;
                await amqpwrapper.Instance().sendWithReplyTo(msg.exchangename, msg.queuename, msg.replyto, sendthis, expiration, msg.correlationId, msg.routingkey, span);
            }
            delete msg.jwt;
            this.data = JSON.stringify(msg);
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    async CloseQueue(cli: WebSocketServerClient, parent: Span) {
        this.Reply();
        let msg: CloseQueueMessage
        msg = CloseQueueMessage.assign(this.data);
        const jwt: string = this.jwt;
        const tuser = this.tuser;
        await cli.CloseConsumer(tuser, msg.queuename, parent);
        delete msg.jwt;
        this.data = JSON.stringify(msg);
    }
    private UnknownCommand(): void {
        if (NoderedUtil.IsNullEmpty(this.command)) {
            Logger.instanse.error(new Error("Received message with no command"), null);
            return;
        }
        this.data = "{\"message\": \"Unknown command " + this.command + "\"}";
        Logger.instanse.error(`UnknownCommand ${this.command}`, null);
        this.Reply("error");
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
                span?.addEvent("Get from cache");
                span?.setAttribute("cache size", keys.length);
                msg.result = Message.collectionCache[msg.jwt];
            } else {
                span?.addEvent("ListCollections");
                msg.result = await Config.db.ListCollections(this.tuser.HasRoleId(WellknownIds.admins), msg.jwt);
                span?.addEvent("Filter collections");
                if (msg.includehist !== true) {
                    msg.result = msg.result.filter(x => !x.name.endsWith("_hist"));
                }
                msg.result = msg.result.filter(x => !x.name.endsWith(".chunks"));
                const result = [];
                // filter out collections that are empty, or we don't have access too
                for (let i = 0; i < msg.result.length; i++) {
                    const collectioname = msg.result[i].name;
                    result.push(msg.result[i]);
                }
                if (result.filter(x => x.name == "entities").length == 0) {
                    result.push({ name: "entities", type: "collection" });
                }
                if (result.filter(x => x.name == "audit").length == 0) {
                    result.push({ name: "audit", type: "collection" });
                }
                span?.addEvent("Add result to cache");
                Message.collectionCache[msg.jwt] = result;
                span?.setAttribute("cache size", keys.length + 1);
                msg.result = result;
            }
            const _tuser = this.tuser;
            if (Config.enable_entity_restriction && !_tuser.HasRoleId(WellknownIds.admins)) {
                var EntityRestrictions = await Logger.DBHelper.GetEntityRestrictions(span);
                if (EntityRestrictions.length > 1) {
                    const tuser = this.tuser;
                    const authorized = EntityRestrictions.filter(x => x.IsAuthorized(tuser));
                    const allall = authorized.filter(x => x.collection == "");
                    if (allall.length == 0) {
                        const names = authorized.map(x => x.collection);
                        msg.result = msg.result.filter(x => names.indexOf(x.name) > -1 || x.name == "entities" || x.name == "audit");
                    }
                }
            } else {
                var b = true;
            }
            delete msg.jwt;
            this.data = JSON.stringify(msg);
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    private async DropCollection(parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("message.DropCollection", parent);
        this.Reply();
        let msg: DropCollectionMessage
        try {
            msg = DropCollectionMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = this.jwt; }
            await Config.db.DropCollection(msg.collectionname, msg.jwt, span);
            delete msg.jwt;
            this.data = JSON.stringify(msg);
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    private async CreateCollection(parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("message.CreateCollection", parent);
        this.Reply();
        let msg: CreateCollectionMessage
        try {
            msg = CreateCollectionMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = this.jwt; }
            await Config.db.CreateCollection(msg.collectionname, msg, msg.jwt, span);
            delete msg.jwt;
            this.data = JSON.stringify(msg);
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    private async Query(parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("message.Query", parent);
        this.Reply();
        let msg: QueryMessage
        try {
            msg = QueryMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = this.jwt; }
            if (NoderedUtil.IsNullEmpty(msg.jwt)) {
                await handleError(null, new Error("Access denied, not signed in"), span);
                msg.error = "Access denied, not signed in";
            } else {
                const { query, projection, top, skip, orderby, collectionname, jwt, queryas, hint, explain } = msg as any;
                // @ts-ignore
                msg.result = await Config.db.query({ query, projection, top, skip, orderby, collectionname, jwt, queryas, hint, explain }, span);
                if (this.clientagent == "openrpa") Config.db.parseResults(msg.result, this.clientagent, this.clientversion);
            }
            delete msg.query;
            delete msg.jwt;
            this.data = JSON.stringify(msg);
        } finally {
            Logger.otel.endSpan(span);
        }
        
    }
    private async Distinct(parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("message.Distinct", parent);
        this.Reply();
        let msg: DistinctMessage = this.data as any;
        try {
            // @ts-ignore
            if (typeof this.data === "string" || this.data instanceof String) {
                // @ts-ignore
                msg = JSON.stringify(this.data);
            }
            
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = this.jwt; }
            if (NoderedUtil.IsNullEmpty(msg.jwt)) {
                await handleError(null, new Error("Access denied, not signed in"), span);
                msg.error = "Access denied, not signed in";
            } else {
                const { query, field, collectionname, jwt, queryas } = msg;
                msg = JSON.parse(JSON.stringify(msg));
                msg.results = await Config.db.distinct({ query, field, collectionname, jwt, queryas }, span);
            }
            delete msg.query;
            delete msg.jwt;
            this.data = JSON.stringify(msg);
        } finally {
            Logger.otel.endSpan(span);
        }
    }     
    private async Count(parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("message.Count", parent);
        this.Reply();
        let msg: CountMessage
        try {
            msg = CountMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = this.jwt; }
            if (NoderedUtil.IsNullEmpty(msg.jwt)) {
                await handleError(null, new Error("Access denied, not signed in"), span);
                msg.error = "Access denied, not signed in";
            } else {
                const { query, collectionname, jwt, queryas } = msg;
                msg.result = await Config.db.count({ query, collectionname, jwt, queryas }, span);
            }
            delete msg.query;
            delete msg.jwt;
            this.data = JSON.stringify(msg);
        } finally {
            Logger.otel.endSpan(span);
        }
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
                msg.result = await Config.db.GetDocumentVersion({ collectionname: msg.collectionname, id: msg.id, version: msg.version, jwt: msg.jwt }, span);
                if (this.clientagent == "openrpa") Config.db.parseResult(msg.result, this.clientagent, this.clientversion);
            }
            delete msg.jwt;
            this.data = JSON.stringify(msg);
        } finally {
            Logger.otel.endSpan(span);
        }
    }

    private async Aggregate(parent: Span): Promise<void> {
        const span: Span = Logger.otel.startSubSpan("message.Aggregate", parent);
        this.Reply();
        let msg: AggregateMessage
        msg = AggregateMessage.assign(this.data);
        if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = this.jwt; }
        // @ts-ignore
        var queryas = msg.queryas;
        // @ts-ignore
        msg.result = await Config.db.aggregate(msg.aggregates, msg.collectionname, msg.jwt, msg.hint, queryas, msg.explain, span);
        if (this.clientagent == "openrpa") Config.db.parseResults(msg.result, this.clientagent, this.clientversion);
        delete msg.aggregates;
        delete msg.jwt;
        this.data = JSON.stringify(msg);
        Logger.otel.endSpan(span);
    }
    private async UnWatch(cli: WebSocketServerClient): Promise<void> {
        this.Reply();
        let msg: WatchMessage
        msg = WatchMessage.assign(this.data);
        if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = this.jwt; }
        if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
        //if (Config.supports_watch) {
            await cli.UnWatch(msg.id, msg.jwt);
        // } else {
        //     msg.error = "Watch is not supported by this openflow";
        // }
        msg.result = null;
        delete msg.jwt;
        this.data = JSON.stringify(msg);
    }
    private async Watch(cli: WebSocketServerClient): Promise<void> {
        this.Reply();
        let msg: WatchMessage
        msg = WatchMessage.assign(this.data);
        if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = this.jwt; }
        if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
        msg.id = null;
        // if (Config.supports_watch) {
            msg.id = await cli.Watch(msg.aggregates, msg.collectionname, msg.jwt);
        // } else {
        //     msg.error = "Watch is not supported by this openflow";
        // }
        msg.result = msg.id;
        delete msg.jwt;
        this.data = JSON.stringify(msg);
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
            if(typeof msg.item === "string") { msg.item = JSON.parse(msg.item); }
            msg.result = await Config.db.InsertOne(msg.item, msg.collectionname, msg.w, msg.j, msg.jwt, span);
            if (this.clientagent == "openrpa") Config.db.parseResult(msg.result, this.clientagent, this.clientversion);
            delete msg.item;
            delete msg.jwt;
            this.data = JSON.stringify(msg);
        } finally {
            Logger.otel.endSpan(span);
        }        
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
            if(typeof msg.items == "string") { msg.items = JSON.parse(msg.items); }
            msg.results = await Config.db.InsertMany(msg.items, msg.collectionname, msg.w, msg.j, msg.jwt, span);
            if (this.clientagent == "openrpa") Config.db.parseResults(msg.results, this.clientagent, this.clientversion);
            if (msg.skipresults) msg.results = [];
            delete msg.items;
            delete msg.jwt;
            this.data = JSON.stringify(msg);
        } finally {
            Logger.otel.endSpan(span);
        }        
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
            if (this.clientagent == "openrpa") Config.db.parseResult(msg.result, this.clientagent, this.clientversion);
            if (msg != null) {
                delete msg.query;
                delete msg.jwt;
            }
            this.data = JSON.stringify(msg);
        } finally {
            Logger.otel.endSpan(span);
        }        
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
            msg = await Config.db.UpdateDocument(msg, span);
            if (this.clientagent == "openrpa") Config.db.parseResults(msg.result, this.clientagent, this.clientversion);
            delete msg.item;
            if (msg != null) {
                delete msg.query;
                delete msg.jwt;
            }
            this.data = JSON.stringify(msg);
        } finally {
            Logger.otel.endSpan(span);
        }        
    }
    private async InsertOrUpdateOne(parent: Span): Promise<void> {
        this.Reply();
        let msg: InsertOrUpdateOneMessage
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
        if(msg.item && typeof msg.item === "string") msg.item = JSON.parse(msg.item);
        msg = await Config.db.InsertOrUpdateOne(msg, parent);
        if (this.clientagent == "openrpa") Config.db.parseResult(msg.result, this.clientagent, this.clientversion);
        delete msg.item;
        if (msg != null) {
            delete msg.jwt;
        }
        this.data = JSON.stringify(msg);
    }
    private async InsertOrUpdateMany(parent: Span): Promise<void> {
        this.Reply();
        const span: Span = Logger.otel.startSubSpan("message.InsertOrUpdateMany", parent);
        let msg: InsertOrUpdateManyMessage
        try {
            msg = InsertOrUpdateManyMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = this.jwt; }
            if (NoderedUtil.IsNullEmpty(msg.w as any)) { msg.w = 0; }
            if (NoderedUtil.IsNullEmpty(msg.j as any)) { msg.j = false; }
            if (NoderedUtil.IsNullEmpty(msg.jwt)) {
                throw new Error("jwt is null and client is not authenticated");
            }
            if(msg.items && typeof msg.items === "string") msg.items = JSON.parse(msg.items);
            msg.results = await Config.db.InsertOrUpdateMany(msg.items, msg.collectionname, msg.uniqeness, msg.skipresults, msg.w, msg.j, msg.jwt, span);
            if (msg.skipresults) msg.results = [];
            delete msg.items;
            if (this.clientagent == "openrpa") Config.db.parseResults(msg.items, this.clientagent, this.clientversion);
            delete msg.jwt;
            this.data = JSON.stringify(msg);
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    private async DeleteOne(parent: Span): Promise<void> {
        this.Reply();
        let msg: DeleteOneMessage
        const span: Span = Logger.otel.startSubSpan("message.DeleteOne", parent);
        try {
            msg = DeleteOneMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = this.jwt; }
            if (!NoderedUtil.IsNullEmpty((msg as any)._id) && NoderedUtil.IsNullEmpty(msg.id)) {
                msg.id = (msg as any)._id
            }
            if (msg.collectionname == "mq") {
                if (NoderedUtil.IsNullEmpty(msg.id)) throw new Error("id is mandatory");
                var doc = await Config.db.getbyid(msg.id, msg.collectionname, msg.jwt, false, span);
                if (doc == null) throw new Error("item not found, or Access Denied");
                if (doc._type == "workitemqueue") {
                    throw new Error("Access Denied, you must call DeleteWorkItemQueue to delete");
                }
            }
            if (msg.collectionname == "agents") {
                if (NoderedUtil.IsNullEmpty(msg.id)) throw new Error("id is mandatory");
                var doc = await Config.db.getbyid(msg.id, msg.collectionname, msg.jwt, false, span);
                if (doc._type == "agent" || doc._type == "package") {
                    throw new Error("Access denied, use packages page or api to delete package");
                }                
            }
            // @ts-ignore
            msg.affectedrows = await Config.db.DeleteOne(msg.id, msg.collectionname, msg.recursive, msg.jwt, span);
            delete msg.id;
            this.data = JSON.stringify(msg);
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    private async DeleteMany(parent: Span): Promise<void> {
        this.Reply();
        let msg: DeleteManyMessage
        const span: Span = Logger.otel.startSubSpan("message.DeleteMany", parent);
        try {
            msg = DeleteManyMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = this.jwt; }
            if (msg.collectionname == "agents") {
                throw new Error("Access denied, use agents page or api to delete agents");
            }
            msg.affectedrows = await Config.db.DeleteMany(msg.query, msg.ids, msg.collectionname, null, msg.recursive, msg.jwt, span);
            delete msg.ids;
            delete msg.query;
            delete msg.jwt;
            this.data = JSON.stringify(msg);
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public static async DoSignin(cli: WebSocketServerClient, rawAssertion: string, parent: Span): Promise<User> {
        const span: Span = Logger.otel.startSubSpan("message.DoSignin", parent);
        let tuser: User;
        let type: tokenType = "jwtsignin";
        if (!NoderedUtil.IsNullEmpty(rawAssertion)) {
            type = "samltoken";
            cli.user = await LoginProvider.validateToken(rawAssertion, span);
            if (!NoderedUtil.IsNullUndefinded(cli.user)) cli.username = cli.user.username;
            tuser = cli.user;
        } else if (!NoderedUtil.IsNullEmpty(cli.jwt)) {
            tuser = await Auth.Token2User(cli.jwt, span);
            if(tuser == null) throw new Error("Access denied");
            const impostor: string = (tuser as any).impostor;
            cli.user = await Logger.DBHelper.FindById(cli.user._id, span);
            if (!NoderedUtil.IsNullUndefinded(cli.user)) cli.username = cli.user.username;
            tuser = cli.user;
            (tuser as any).impostor = impostor;
        }
        span?.setAttribute("type", type);
        span?.setAttribute("clientid", cli.id);
        if (!NoderedUtil.IsNullUndefinded(cli.user)) {
            var validated = true;
            if (Config.validate_user_form != "") {
                if (!cli.user.formvalidated) validated = false;
            }
            if (Config.validate_emails) {
                if (!cli.user.emailvalidated) validated = false;
            }
            if (!validated) {
                if (cli.clientagent != "nodered" && NoderedUtil.IsNullEmpty((tuser as any).impostor)) {
                    Logger.instanse.error(new Error(tuser.username + " failed logging in, not validated"), span, Logger.parsecli(cli));
                    await Audit.LoginFailed(tuser.username, type, "websocket", cli.remoteip, cli.clientagent, cli.clientversion, span);
                    tuser = null;
                }
            }
        }
        if (tuser != null && cli.user != null && cli.user.disabled) {
            Logger.instanse.error(new Error(tuser.username + " failed logging in, user is disabled"), span, Logger.parsecli(cli));
            await Audit.LoginFailed(tuser.username, type, "websocket", cli.remoteip, cli.clientagent, cli.clientversion, span);
            tuser = null;
            if (Config.client_disconnect_signin_error) cli.Close(span);
        } else if (cli.user?.dblocked == true) {
            Logger.instanse.warn(tuser.username + " successfully signed in, but user is locked", span);
        } else if (tuser != null) {
            Logger.instanse.debug(tuser.username + " successfully signed in", span);
        }
        return tuser;
    }
    private parseSignAgent(cli: WebSocketServerClient, parent: Span) {
        try {
            const msg = SigninMessage.assign(this.data);
            // @ts-ignore
            if(msg.validateonly != null) msg.validate_only = msg.validateonly;
            if (cli != null) {
                if (NoderedUtil.IsNullEmpty(cli.clientagent) && !NoderedUtil.IsNullEmpty(msg.clientagent)) cli.clientagent = msg.clientagent as any;
                if (NoderedUtil.IsNullEmpty(cli.clientversion) && !NoderedUtil.IsNullEmpty(msg.clientversion)) cli.clientversion = msg.clientversion;
                // @ts-ignore
                if (NoderedUtil.IsNullEmpty(cli.clientagent) && !NoderedUtil.IsNullEmpty(msg.agent)) cli.clientagent = msg.agent as any;
                // @ts-ignore
                if (NoderedUtil.IsNullEmpty(cli.clientversion) && !NoderedUtil.IsNullEmpty(msg.version)) cli.clientversion = msg.version;
                if (NoderedUtil.IsNullEmpty(cli.clientagent)) cli.clientagent = "unknown"
                // @ts-ignore
                if (cli.clientagent == "assistent") cli.clientagent = "assistant"
                // @ts-ignore
                if (cli.clientagent == "webapp" || cli.clientagent == "aiotwebapp") {
                    cli.clientagent = "browser"
                }
                if (cli.clientagent != null && cli.clientagent.toLocaleLowerCase() == "rdservice") {
                    cli.clientagent = "rdservice"
                }
            }
        } catch (error) {
            console.error(error);
        }
    }
    public async Signin(cli: WebSocketServerClient, parent: Span): Promise<void> {
        this.Reply();
        const span: Span = Logger.otel.startSubSpan("message.Signin", parent);
        let msg: SigninMessage
        try {
            // const hrstart = process.hrtime()
            // let hrend = process.hrtime(hrstart)
            let impostor: string = "";
            const UpdateDoc: any = { "$set": {} };
            let tokentype: tokenType = "local";
            let protocol:clientType = "websocket";
            // @ts-ignore
            if(cli && cli.protocol) {
                // @ts-ignore
                protocol = cli.protocol;
            }
            msg = SigninMessage.assign(this.data);
            // @ts-ignore
            if(msg.validateonly != null) msg.validate_only = msg.validateonly;
            this.parseSignAgent(cli, span);

            let originialjwt = msg.jwt;
            let tuser: User = null;
            let user: User = null;
            if(NoderedUtil.IsNullEmpty(msg.jwt) && NoderedUtil.IsNullEmpty(msg.username) && NoderedUtil.IsNullEmpty(msg.password) && msg.validate_only == true) {
                msg.jwt = cli.jwt;
            }
            if (!NoderedUtil.IsNullEmpty(msg.jwt)) {
                // if (msg.validate_only) { this.command = "validatereply"; }
                span?.addEvent("using jwt, verify token");
                tokentype = "jwtsignin";
                try {
                    tuser = await Auth.Token2User(msg.jwt, span);
                    if(tuser == null) {
                        tuser = User.assign(await Crypt.verityToken(msg.jwt, cli, true));
                        Logger.instanse.warn("[" + tuser.username + "] validated with expired token!", span);
                    }
                } catch (error) {
                    if (Config.client_disconnect_signin_error) cli.Close(span);
                    throw error;
                }
                let _id = tuser?._id;
                if (tuser != null) {
                    if (NoderedUtil.IsNullEmpty(tuser._id)) {
                        span?.addEvent("token valid, lookup username " + tuser.username);
                        _id = tuser.username;
                        user = await Logger.DBHelper.FindByUsername(tuser.username, null, span);
                    } else {
                        span?.addEvent("token valid, lookup id " + tuser._id);
                        user = await Logger.DBHelper.FindById(tuser._id, span);
                    }
                } else {
                    span?.addEvent("Failed resolving token");
                }
                if (tuser == null || user == null) {
                    if (!Config.auto_create_user_from_jwt) {
                        // Nodered will spam this, so to not strain the system to much force an 1 second delay
                        await new Promise(resolve => { setTimeout(resolve, 1000) });
                        throw new Error("Failed resolving token, could not find user by " + _id);
                    }
                }

                if (cli?.clientagent == "openrpa" && user.dblocked == true) {
                    // await Audit.LoginFailed(msg.user.username, type, provider, cli?.remoteip, cli?.clientagent, cli?.clientversion, span);
                    span?.addEvent("User dblocked, decline login");
                    // Dillema ....
                    // If we send an error or empy yser, the robot will spam new tabs 
                    // If we just close the connection the user will not know what is wrong ...
                    if (Config.client_disconnect_signin_error) cli.Close(span);
                    throw new Error("User " + user.username + " is dblocked, please login to openflow and buy more storage and try again");
                }

                if ((tuser as any).impostor !== null && (tuser as any).impostor !== undefined && (tuser as any).impostor !== "") {
                    impostor = (tuser as any).impostor;
                }

                if (user !== null && user !== undefined) {
                    // refresh, for roles and stuff
                    tuser = user;
                } else { // Autocreate user .... safe ?? we use this for autocreating nodered service accounts
                    if (Config.auto_create_user_from_jwt) {
                        const jwt: string = Crypt.rootToken();
                        let extraoptions = {
                            federationids: [],
                            emailvalidated: true,
                            formvalidated: true,
                            validated: true
                        }
                        user = await Logger.DBHelper.EnsureUser(jwt, tuser.name, tuser.username, null, msg.password, extraoptions, span);
                        if (user != null) tuser = user;
                        if (user == null) {
                            tuser = new User();
                            tuser.username = msg.username;
                        }
                    } else {
                        if (msg !== null && msg !== undefined) msg.error = "Unknown username or password";
                    }
                }
                if (impostor !== "") {
                    (tuser as any).impostor = impostor;
                }
            } else if (!NoderedUtil.IsNullEmpty(msg.rawAssertion)) {
                span?.addEvent("using rawAssertion, verify token");
                let AccessToken = null;
                let User = null;
                span?.addEvent("AccessToken.find");
                AccessToken = await OAuthProvider.instance.oidc.AccessToken.find(msg.rawAssertion);
                if (!NoderedUtil.IsNullUndefinded(AccessToken)) {
                    span?.addEvent("Account.findAccount");
                    User = await OAuthProvider.instance.oidc.Account.findAccount(null, AccessToken.accountId);
                } else {
                    var c = OAuthProvider.instance.clients;
                    for (var i = 0; i < OAuthProvider.instance.clients.length; i++) {
                        try {
                            span?.addEvent("Client.find");
                            var _cli = await OAuthProvider.instance.oidc.Client.find(OAuthProvider.instance.clients[i].clientId);;
                            span?.addEvent("IdToken.validate");
                            AccessToken = await OAuthProvider.instance.oidc.IdToken.validate(msg.rawAssertion, _cli);
                            if (!NoderedUtil.IsNullEmpty(AccessToken)) {
                                span?.addEvent("Account.findAccount");
                                User = await OAuthProvider.instance.oidc.Account.findAccount(null, AccessToken.payload.sub);
                                break;
                            }
                        } catch (error) {

                        }
                    }
                }
                if (!NoderedUtil.IsNullUndefinded(AccessToken)) {
                    user = User.user;
                    if (user !== null && user != undefined) { tuser = user; }
                } else {
                    tokentype = "samltoken";
                    span?.addEvent("LoginProvider.validateToken");
                    user = await LoginProvider.validateToken(msg.rawAssertion, span);
                    // refresh, for roles and stuff
                    if (user !== null && user != undefined) { tuser = user; }
                }
                delete msg.rawAssertion;
            } else {
                span?.addEvent("using username/password, validate credentials");
                user = await Auth.ValidateByPassword(msg.username, msg.password, span);
                tuser = null;
                // refresh, for roles and stuff
                if (user != null) tuser = user;
                if (user == null) {
                    span?.addEvent("using username/password, failed, check for exceptions");
                    tuser = new User();
                    tuser.username = msg.username;
                }
            }
            if (msg.validate_only !== true && cli) {
                if(NoderedUtil.IsNullEmpty(cli.clientagent) && !NoderedUtil.IsNullEmpty(msg.clientagent)) {
                    if (cli) cli.clientagent = msg.clientagent as any;
                }
                if(NoderedUtil.IsNullEmpty(cli.clientversion) && !NoderedUtil.IsNullEmpty(msg.clientversion)) {
                    if (cli) cli.clientversion = msg.clientversion;
                }                
            }
            if (user === null || user === undefined || tuser === null || tuser === undefined) {
                if (msg !== null && msg !== undefined) msg.error = "Unknown username or password";
                await Audit.LoginFailed(tuser.username, tokentype,  protocol, cli?.remoteip, cli?.clientagent, cli?.clientversion, span);
                throw new Error(tuser.username + " failed logging in using " + tokentype);
            } else if (user.disabled && (msg.impersonate != "-1" && msg.impersonate != "false")) {
                if (msg !== null && msg !== undefined) msg.error = "Disabled users cannot signin";
                await Audit.LoginFailed(tuser.username, tokentype, protocol, cli?.remoteip, cli?.clientagent, cli?.clientversion, span);
                if (Config.client_disconnect_signin_error) cli.Close(span);
                throw new Error("Disabled user " + tuser.username + " failed logging in using " + tokentype);
            } else {
                if (msg.impersonate == "-1" || msg.impersonate == "false") {
                    span?.addEvent("looking up impersonated user " + impostor);
                    user = await Logger.DBHelper.FindById(impostor, span);
                    if (Config.persist_user_impersonation) UpdateDoc.$unset = { "impersonating": "" };
                    user.impersonating = undefined;
                    if (!NoderedUtil.IsNullEmpty((tuser as any).impostor)) {
                        tuser = user;
                        tuser.validated = true;
                    } else {
                        tuser = user;
                    }
                    msg.impersonate = undefined;
                    impostor = undefined;
                }
                Logger.instanse.debug(tuser.username + " successfully signed in", span);
                span?.setAttribute("name", tuser.name);
                span?.setAttribute("username", tuser.username);
                if (cli?.clientagent == "openrpa" && user?.dblocked == true) {
                    // await Audit.LoginFailed(tuser.username, type, provider, cli?.remoteip, cli?.clientagent, cli?.clientversion, span);
                } else {
                    await Audit.LoginSuccess(tuser, tokentype, protocol, cli?.remoteip, cli?.clientagent, cli?.clientversion, span);
                }
                const userid: string = user._id;
                span?.setAttribute("name", tuser.name);
                span?.setAttribute("username", tuser.username);
                if (msg.longtoken) {
                    span?.addEvent("createToken for longtoken");
                    msg.jwt = await Auth.User2Token(tuser, Config.longtoken_expires_in, span);
                    originialjwt = msg.jwt;
                } else {
                    span?.addEvent("createToken for shorttoken");
                    msg.jwt = await Auth.User2Token(tuser, Config.shorttoken_expires_in, span);
                    originialjwt = msg.jwt;
                }
                msg.user = TokenUser.From(tuser);
                if (!NoderedUtil.IsNullEmpty(user.impersonating) && NoderedUtil.IsNullEmpty(msg.impersonate)) {
                    span?.addEvent("Lookup impersonating user " + user.impersonating);
                    const items = await Config.db.query({ query: { _id: user.impersonating }, top: 1, collectionname: "users", jwt: msg.jwt }, span);
                    if (items.length == 0) {
                        span?.addEvent("Failed Lookup");
                        msg.impersonate = null;
                    } else {
                        span?.addEvent("Lookup succeeded");
                        msg.impersonate = user.impersonating;
                        user.selectedcustomerid = null;
                        tuser.selectedcustomerid = null;
                    }
                }
                if (msg.impersonate !== undefined && msg.impersonate !== null && msg.impersonate !== "" && tuser._id != msg.impersonate) {
                    span?.addEvent("Lookup impersonate user " + user.impersonating);
                    const items = await Config.db.query({ query: { _id: msg.impersonate }, top: 1, collectionname: "users", jwt: msg.jwt }, span);
                    if (items.length == 0) {
                        span?.addEvent("Lookup failed, lookup as root");
                        const impostors = await Config.db.query<User>({ query: { _id: msg.impersonate }, top: 1, collectionname: "users", jwt: Crypt.rootToken() }, span);
                        const impb: User = new User(); impb.name = "unknown"; impb._id = msg.impersonate;
                        let imp: User = impb;
                        if (impostors.length == 1) {
                            imp = impostors[0];
                        }
                        await Audit.ImpersonateFailed(imp, tuser, cli?.clientagent, cli?.clientversion, span);
                        throw new Error("Permission denied, " + tuser.name + "/" + tuser._id + " view and impersonating " + msg.impersonate);
                    }
                    user.selectedcustomerid = null;
                    tuser.selectedcustomerid = null;
                    const tuserimpostor = tuser;
                    user = User.assign(items[0] as User);
                    user = await Logger.DBHelper.DecorateWithRoles(user, span);
                    // Check we have update rights
                    try {
                        await Logger.DBHelper.Save(user, originialjwt, span);
                        if (Config.persist_user_impersonation) {
                            await Config.db._UpdateOne({ _id: tuserimpostor._id }, { "$set": { "impersonating": user._id } } as any, "users", 1, false, originialjwt, span);
                        }
                    } catch (error) {
                        const impostors = await Config.db.query<User>({ query: { _id: msg.impersonate }, top: 1, collectionname: "users", jwt: Crypt.rootToken() }, span);
                        const impb: User = new User(); impb.name = "unknown"; impb._id = msg.impersonate;
                        let imp: User = impb;
                        if (impostors.length == 1) {
                            imp = impostors[0];
                        }

                        await Audit.ImpersonateFailed(imp, tuser, cli?.clientagent, cli?.clientversion, span);
                        throw new Error("Permission denied, " + tuser.name + "/" + tuser._id + " updating and impersonating " + msg.impersonate);
                    }
                    (tuser as any).impostor = tuserimpostor._id;

                    tuser = user;
                    (tuser as any).impostor = userid;
                    (user as any).impostor = userid;
                    span?.setAttribute("impostername", tuserimpostor.name);
                    span?.setAttribute("imposterusername", tuserimpostor.username);
                    span?.setAttribute("name", tuser.name);
                    span?.setAttribute("username", tuser.username);
                    if (msg.longtoken) {
                        span?.addEvent("createToken for longtoken");
                        msg.jwt = await Auth.User2Token(tuser, Config.longtoken_expires_in, span);
                    } else {
                        span?.addEvent("createToken for shorttoken");
                        msg.jwt = await Auth.User2Token(tuser, Config.shorttoken_expires_in, span);
                    }
                    msg.user = TokenUser.From(tuser);
                    Logger.instanse.debug(tuser.username + " successfully impersonated", span);
                    await Audit.ImpersonateSuccess(tuser, tuserimpostor, cli?.clientagent, cli?.clientversion, span);
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
                    // @ts-ignore
                    if (msg.ping == false || msg.ping == true) {
                        // @ts-ignore
                        cli.doping = msg.ping;
                    }
                    Logger.instanse.debug(tuser.username + " signed in using " + tokentype + " " + cli?.id + "/" + cli?.clientagent, span);
                    if (cli) cli.jwt = msg.jwt;
                    if (cli) cli.user = user;
                    if (!NoderedUtil.IsNullUndefinded(cli) && !NoderedUtil.IsNullUndefinded(cli.user)) cli.username = cli.user.username;
                } else {
                    Logger.instanse.debug(tuser.username + " was validated in using " + tokentype, span);
                }
                msg.supports_watch = true;
                var keys = Object.keys(UpdateDoc.$set);
                if (keys.length > 0 || UpdateDoc.$unset || NoderedUtil.IsNullEmpty(user.lastseen)) {
                    // ping will handle this, if no new information needs to be added
                    span?.addEvent("Update user using update document");
                    var newdoc = { ...UpdateDoc, ...Logger.DBHelper.UpdateHeartbeat(cli) }
                    await Config.db._UpdateOne({ "_id": user._id }, newdoc, "users", 1, false, Crypt.rootToken(), span)
                }
                span?.addEvent("memoryCache.delete users" + user._id);
                await Logger.DBHelper.CheckCache("users", user, false, false, span);
                if (!NoderedUtil.IsNullEmpty((tuser as any).impostor) && (tuser as any).impostor != user._id) {
                    await Logger.DBHelper.CheckCache("users", tuser as any, false, false, span);
                    span?.addEvent("memoryCache.delete users" + (tuser as any).impostor);
                }
            }
            if (!NoderedUtil.IsNullUndefinded(msg.user) && !NoderedUtil.IsNullEmpty(msg.jwt)) {
                var validated = true;
                if (Config.validate_user_form != "") {
                    if (!msg.user.formvalidated) validated = false;
                }
                if (Config.validate_emails) {
                    if (!msg.user.emailvalidated) validated = false;
                }
                if (!validated) {
                    if (cli?.clientagent != "nodered" && NoderedUtil.IsNullEmpty(msg.user.impostor)) {
                        span?.addEvent("User not validet, decline login");
                        await Audit.LoginFailed(msg.user.username, tokentype, protocol, cli?.remoteip, cli?.clientagent, cli?.clientversion, span);
                        msg.error = "User not validated, please login again";
                        msg.jwt = undefined;
                        if (Config.client_disconnect_signin_error) cli.Close(span);
                        throw new Error(msg.user.username + " not validated");
                    }
                } else if (cli?.clientagent == "openrpa" && msg.user.dblocked == true) {
                    span?.addEvent("User dblocked, decline login");
                    // await Audit.LoginFailed(msg.user.username, type, "websocket", cli?.remoteip, cli?.clientagent, cli?.clientversion, span);
                    // Dillema ....
                    // If we send an error or empy yser, the robot will spam new tabs 
                    // If we just close the connection the user will not know what is wrong ...
                    if (Config.client_disconnect_signin_error) cli.Close(span);
                    throw new Error("User  " + msg.user.username + " is dblocked, please login to openflow and buy more storage and try again");
                }
            }
            // openrpa settings
            msg.websocket_package_size = Config.websocket_package_size;
            msg.openflow_uniqueid = Config.openflow_uniqueid;
            if (!NoderedUtil.IsNullEmpty(Config.otel_trace_url)) msg.otel_trace_url = Config.otel_trace_url;
            if (!NoderedUtil.IsNullEmpty(Config.otel_metric_url)) msg.otel_metric_url = Config.otel_metric_url;
            if (Config.otel_trace_interval > 0) msg.otel_trace_interval = Config.otel_trace_interval;
            if (Config.otel_metric_interval > 0) msg.otel_metric_interval = Config.otel_metric_interval;
            msg.enable_analytics = Config.enable_analytics;
            if(msg.user != null) {
                if(msg.user.email == null || msg.user.email == "") {
                    msg.user.email = "";
                }
            }
            this.data = JSON.stringify(msg);
            // hrend = process.hrtime(hrstart)
        } finally {
            span?.addEvent("Signin complete");
            Logger.otel.endSpan(span);
            // cli?.Send(this);
        }
    }
    private async GetInstanceName(_id: string, myid: string, myusername: string, jwt: string, parent: Span): Promise<string> {
        const span: Span = Logger.otel.startSubSpan("message.GetInstanceName", parent);
        let name: string = "";
        if (_id !== null && _id !== undefined && _id !== "" && _id != myid) {
            const user: User = await Auth.Token2User(jwt, span);
            if(user == null) throw new Error("Access denied");
            var qs: any[] = [{ _id: _id }];
            qs.push(Config.db.getbasequery(user, [Rights.update], "users"))
            const res = await Config.db.query<User>({ query: { "$and": qs }, top: 1, collectionname: "users", jwt }, span);
            if (res.length == 0) {
                throw new Error("Unknown userid " + _id + " or permission denied");
            }
            name = res[0].username;
        } else {
            name = myusername;
        }
        if (NoderedUtil.IsNullEmpty(name)) throw new Error("Instance name cannot be empty");
        // name = name.split("@").join("").split(".").join("");
        name = name.toLowerCase();
        name = name.replace(/([^a-z0-9]+){1,63}/gi, "");
        span?.setAttribute("instancename", name)
        Logger.otel.endSpan(span);
        return name;
    }
    private async GetKubeNodeLabels(cli: WebSocketServerClient, parent: Span): Promise<void> {
        this.Reply();
        const span: Span = Logger.otel.startSubSpan("message.GetKubeNodeLabels", parent);
        let msg: GetKubeNodeLabelsMessage;
        try {
            if (Logger.agentdriver == null) throw new Error("No agentdriver is loaded")
            msg = GetKubeNodeLabelsMessage.assign(this.data);
            msg.result = await Logger.agentdriver.NodeLabels(span);
            delete msg.jwt;
            this.data = JSON.stringify(msg);
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    private async _SaveFile(stream: Stream, filename: string, contentType: string, metadata: Base): Promise<string> {
        return new Promise<string>(async (resolve, reject) => {
            try {
                const bucket = new GridFSBucket(Config.db.db);
                let uploadStream = bucket.openUploadStream(filename, { contentType: contentType, metadata: metadata });
                let id = uploadStream.id;
                stream.pipe(uploadStream);
                uploadStream.on("error", function (error) {
                    reject(error);
                }).
                    on("finish", function () {
                        resolve(id.toString());
                    });
            } catch (err) {
                reject(err);
            }
        });
    }

    public async _addFile(file: string | Buffer | Stream, filename: string, mimeType: string, metadata: Base, compressed: boolean, jwt: string): Promise<string> {
        if (NoderedUtil.IsNullEmpty(filename)) throw new Error("Filename is mandatory");
        if (NoderedUtil.IsNullEmpty(file)) throw new Error("file is mandatory");
        if (process.platform === "win32") {
            filename = filename.replace(/\//g, "\\");
        }
        else {
            filename = filename.replace(/\\/g, "/");
        }

        if (NoderedUtil.IsNullEmpty(mimeType)) {
            mimeType = mimetype.lookup(filename);
        }

        if (metadata === null || metadata === undefined) { metadata = new Base(); }
        metadata.name = path.basename(filename);
        (metadata as any).filename = filename;
        (metadata as any).path = path.dirname(filename);
        if ((metadata as any).path == ".") (metadata as any).path = "";

        let readable = new Readable();
        // if file is stream, save to mongodb gridfs
        if (file instanceof Stream) {
            readable = (file as any);
        } else if (file instanceof Buffer) {
            readable._read = () => { };
            readable.push(file);
            readable.push(null);
        } else if (file && (!compressed)) {
            const buf: Buffer = Buffer.from(file as string, "base64");
            readable._read = () => { }; // _read is required but you can noop it
            readable.push(buf);
            readable.push(null);
        } else {
            let result: Buffer;
            try {
                var data = Buffer.from(file as string, "base64")
                result = pako.inflate(data);
            } catch (error) {
                Logger.instanse.error(error, null);
            }
            readable._read = () => { }; // _read is required but you can noop it
            readable.push(result);
            readable.push(null);
        }

        file = null;
        if (metadata == null) { metadata = new Base(); }
        metadata = Base.assign(metadata);
        const user: User = await Auth.Token2User(jwt, null);
        if(user == null) throw new Error("Access denied");
        if (NoderedUtil.IsNullUndefinded(metadata._acl)) {
            metadata._acl = [];
            Base.addRight(metadata, WellknownIds.filestore_admins, "filestore admins", [Rights.full_control]);
            if(!Config.multi_tenant) {
                Base.addRight(metadata, WellknownIds.filestore_users, "filestore users", [Rights.read]);
            }
            Base.addRight(metadata, user._id, user.name, [Rights.full_control]);            
        }
        metadata._createdby = user.name;
        metadata._createdbyid = user._id;
        metadata._created = new Date(new Date().toISOString());
        metadata._modifiedby = user.name;
        metadata._modifiedbyid = user._id;
        metadata._modified = metadata._created;
        if (NoderedUtil.IsNullEmpty((metadata as any).uniquename)) {
            (metadata as any).uniquename = NoderedUtil.GetUniqueIdentifier() + "-" + path.basename(filename);
        }
        if (NoderedUtil.IsNullEmpty(metadata.name)) {
            metadata.name = filename;
        }
        let hasUser: any = metadata._acl.find(e => e._id === user._id);
        if ((hasUser === null || hasUser === undefined)) {
            Base.addRight(metadata, user._id, user.name, [Rights.full_control]);
        }
        hasUser = metadata._acl.find(e => e._id === WellknownIds.filestore_admins);
        if ((hasUser === null || hasUser === undefined)) {
            Base.addRight(metadata, WellknownIds.filestore_admins, "filestore admins", [Rights.full_control]);
        }
        metadata = Config.db.ensureResource(metadata, "fs.files");
        if (!DatabaseConnection.hasAuthorization(user, metadata, Rights.create)) { throw new Error("Access denied, no authorization to save file"); }
        var id = await this._SaveFile(readable, filename, mimeType, metadata);
        return id;
    }
    public async SaveFile(cli: WebSocketServerClient): Promise<void> {
        this.Reply();
        let msg: SaveFileMessage
        msg = SaveFileMessage.assign(this.data);
        if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = this.jwt; }
        if (NoderedUtil.IsNullEmpty(msg.jwt) && cli) { msg.jwt = cli.jwt; }
        if (NoderedUtil.IsNullEmpty(msg.filename)) throw new Error("Filename is mandatory");
        if (NoderedUtil.IsNullEmpty(msg.file)) throw new Error("file is mandatory");

        msg.id = await this._addFile(msg.file, msg.filename, msg.mimeType, msg.metadata, msg.compressed, msg.jwt);
        msg.result = await Config.db.getbyid(msg.id, "fs.files", msg.jwt, true, null);
        if (NoderedUtil.IsNullUndefinded(msg.result)) {
            await this.sleep(1000);
            msg.result = await Config.db.getbyid(msg.id, "fs.files", msg.jwt, true, null);
        }
        if (NoderedUtil.IsNullUndefinded(msg.result)) {
            await this.sleep(1000);
            msg.result = await Config.db.getbyid(msg.id, "fs.files", msg.jwt, true, null);
        }
        delete msg.file;
        delete msg.jwt;
        this.data = JSON.stringify(msg);
    }
    public async _GetFile(id: string, compressed: boolean): Promise<Buffer> {
        return new Promise<Buffer>(async (resolve, reject) => {
            try {
                const bucket = new GridFSBucket(Config.db.db);
                let downloadStream = bucket.openDownloadStream(safeObjectID(id));
                const bufs = [];
                downloadStream.on("data", (chunk) => {
                    bufs.push(chunk);
                });
                downloadStream.on("error", (error) => {
                    reject(error);
                });
                downloadStream.on("end", () => {
                    try {
                        const buffer = Buffer.concat(bufs);
                        let result: Buffer;
                        if (compressed) {
                            result = Buffer.from(pako.deflate(buffer));
                        } else {
                            result = buffer;
                        }
                        resolve(result);
                    } catch (error) {
                        reject(error);
                    }
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
            msg = GetFileMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = this.jwt; }
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            if (!NoderedUtil.IsNullEmpty(msg.id)) {
                const rows = await Config.db.query({ query: { _id: safeObjectID(msg.id) }, top: 1, collectionname: "files", jwt: msg.jwt }, span);
                if (rows.length == 0) { throw new Error("File " + msg.id + " not found"); }
                msg.metadata = (rows[0] as any).metadata
                msg.mimeType = (rows[0] as any).contentType;
            } else if (!NoderedUtil.IsNullEmpty(msg.filename)) {
                let rows = await Config.db.query({ query: { "metadata.uniquename": msg.filename }, top: 1, orderby: { uploadDate: -1 }, collectionname: "fs.files", jwt: msg.jwt }, span);
                if (rows.length == 0) rows = await Config.db.query({ query: { "filename": msg.filename }, top: 1, orderby: { uploadDate: -1 }, collectionname: "fs.files", jwt: msg.jwt }, span);
                if (rows.length == 0) { throw new Error("File " + msg.filename + " not found"); }
                msg.id = rows[0]._id;
                msg.metadata = (rows[0] as any).metadata
                msg.mimeType = (rows[0] as any).contentType;
            } else {
                throw new Error("id or filename is mandatory");
            }
            msg.file = (await this._GetFile(msg.id, msg.compress)).toString("base64");
            delete msg.jwt;
            this.data = JSON.stringify(msg);
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    private async filescount(files: FindCursor<GridFSFile>): Promise<number> {
        return new Promise<number>(async (resolve, reject) => {
            files.count((error, result) => {
                if (error) return reject(error);
                resolve(result);
            });
        });
    }
    private async filesnext(files: FindCursor<GridFSFile>): Promise<GridFSFile> {
        return new Promise<GridFSFile>(async (resolve, reject) => {
            files.next((error, result) => {
                if (error) return reject(error);
                resolve(result);
            });
        });
    }
    private async UpdateFile(cli: WebSocketServerClient): Promise<void> {
        this.Reply();
        let msg: UpdateFileMessage
        msg = UpdateFileMessage.assign(this.data);
        if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = this.jwt; }
        if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }

        const bucket = new GridFSBucket(Config.db.db);
        const q: Filter<GridFSFile> = {};
        q._id = safeObjectID(msg.id);
        const files = bucket.find(q);
        const count = await this.filescount(files);
        if (count == 0) { throw new Error("Cannot update file with id " + msg.id); }
        const file = await this.filesnext(files);
        files.close();
        msg.metadata._createdby = file.metadata._createdby;
        msg.metadata._createdbyid = file.metadata._createdbyid;
        msg.metadata._created = file.metadata._created;
        msg.metadata.name = file.metadata.name;
        (msg.metadata as any).filename = file.metadata.filename;
        (msg.metadata as any).path = file.metadata.path;

        const user: User = this.tuser;
        msg.metadata._modifiedby = user.name;
        msg.metadata._modifiedbyid = user._id;
        msg.metadata._modified = new Date(new Date().toISOString());;

        msg.metadata = Base.assign(msg.metadata);

        const hasUser: any = msg.metadata._acl.find(e => e._id === user._id);
        if ((hasUser === null || hasUser === undefined)) {
            Base.addRight(msg.metadata, user._id, user.name, [Rights.full_control]);
        }
        Base.addRight(msg.metadata, WellknownIds.filestore_admins, "filestore admins", [Rights.full_control]);
        if (!DatabaseConnection.hasAuthorization(user, msg.metadata, Rights.update)) { throw new Error("Access denied, no authorization to update file"); }

        msg.metadata = Config.db.ensureResource(msg.metadata, "fs.files");
        const fsc = Config.db.db.collection("fs.files");
        DatabaseConnection.traversejsonencode(msg.metadata);
        const res = await fsc.updateOne(q, { $set: { metadata: msg.metadata } });
        delete msg.metadata;

        delete msg.jwt;
        this.data = JSON.stringify(msg);
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
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = this.jwt; }
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = cli.jwt; }
            const tuser = this.tuser;
            msg.jwt = await Auth.User2Token(tuser, Config.longtoken_expires_in, span);
            let workflow: any = null;
            if (NoderedUtil.IsNullEmpty(msg.queue)) {
                const res = await Config.db.query({ query: { "_id": msg.workflowid }, top: 1, collectionname: "workflow", jwt: msg.jwt }, span);
                if (res.length != 1) throw new Error("Unknown workflow id " + msg.workflowid);
                workflow = res[0];
                msg.queue = workflow.queue;
                if (NoderedUtil.IsNullEmpty(msg.name)) { msg.name = workflow.name; }
            }
            if (NoderedUtil.IsNullEmpty(msg.name)) throw new Error("name is mandatory when workflowid not set")

            if (msg.queue === msg.resultqueue) {
                throw new Error("Cannot reply to self queuename: " + msg.queue + " correlationId: " + msg.resultqueue);
            }

            const res = await Config.db.query({ query: { "_id": msg.targetid }, top: 1, collectionname: "users", jwt: msg.jwt }, span);
            if (res.length != 1) throw new Error("Unknown target id " + msg.targetid);
            workflow = res[0];
            (msg as any).workflow = msg.workflowid;

            if (NoderedUtil.IsNullEmpty(msg.correlationId)) {
                msg.correlationId = NoderedUtil.GetUniqueIdentifier();
            }

            (msg as any).payload = msg.data;
            delete msg.data;

            const _data = Base.assign<Base>(msg as any);
            Base.addRight(_data, msg.targetid, "targetid", [-1]);
            Base.addRight(_data, cli.user._id, cli.user.name, [-1]);
            Base.addRight(_data, tuser._id, tuser.name, [-1]);
            _data._type = "instance";
            _data.name = msg.name;
            (_data as any).state = "new";
            if (!msg.initialrun) {
                (_data as any).form = "unknown";
            }
            if ((_data as any).payload._parentid) {
                (_data as any)._parentid = (_data as any).payload._parentid;
                delete (_data as any).payload._parentid;
            }

            const res2 = await Config.db.InsertOne(_data, "workflow_instances", 1, true, msg.jwt, span);
            msg.newinstanceid = res2._id;

            if (msg.initialrun) {
                const message = { _id: res2._id, __jwt: msg.jwt, __user: tuser };
                amqpwrapper.Instance().sendWithReplyTo("", msg.queue, msg.resultqueue, message, Config.amqp_default_expiration, msg.correlationId, "", span);
            }
            this.data = JSON.stringify(msg);
        } finally {
            Logger.otel.endSpan(span);
        }
    }

    static isObject(obj) {
        const type = typeof obj;
        return (type === "function" || type === "object") && !!obj;
    }
    static flattenAndStringify(data) {
        const result = {};

        const step = (obj, prevKey) => {
            Object.keys(obj).forEach((key) => {
                const value = obj[key];

                const newKey = prevKey ? `${prevKey}[${key}]` : key;

                if (this.isObject(value)) {
                    if (!Buffer.isBuffer(value) && !value.hasOwnProperty("data")) {
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
            const usage: ResourceUsage = await Config.db.getbyid(resourceusageid, "config", jwt, true, span);
            if (usage == null) throw new Error("Unknown usage or Access Denied");
            const customer: Customer = await Config.db.getbyid(usage.customerid, "users", jwt, true, span);
            if (customer == null) throw new Error("Unknown usage or Access Denied (customer)");
            // @ts-ignore
            if(usage.mode == "one_time") throw new Error("Cannot cancel a one time purchase");
            let user: User;
            if (!NoderedUtil.IsNullEmpty(usage.userid)) {
                user = await Config.db.getbyid(usage.userid, "users", jwt, true, span) as any;
                if (user == null) throw new Error("Unknown usage or Access Denied (user)");
            }
            const tuser = await Auth.Token2User(jwt, span);
            if(tuser == null) throw new Error("Access denied");
            if (!tuser.HasRoleName(customer.name + " admins") && !tuser.HasRoleName("admins")) {
                throw new Error(`Access denied, adding plan (not in "${customer.name} admins")`);
            }


            if (!NoderedUtil.IsNullEmpty(usage.product.added_resourceid) && !NoderedUtil.IsNullEmpty(usage.product.added_stripeprice)) {
                if (user != null) {
                    const subusage: ResourceUsage[] = await Config.db.query({ query: { "_type": "resourceusage", "userid": usage.userid, "product.stripeprice": usage.product.added_stripeprice }, top: 2, collectionname: "config", jwt }, span);
                    if (subusage.length == 1) {
                        await this._StripeCancelPlan(subusage[0]._id, usage.product.added_quantity_multiplier * subusage[0].quantity, jwt, span);
                    } else if (subusage.length > 1) {
                        throw new Error("Error found more than one resourceusage for userid " + usage.userid + " and stripeprice " + usage.product.added_stripeprice);
                    }
                } else {
                    const subusage: ResourceUsage[] = await Config.db.query({ query: { "_type": "resourceusage", "customerid": usage.customerid, "product.stripeprice": usage.product.added_stripeprice }, top: 2, collectionname: "config", jwt }, span);
                    if (subusage.length == 1) {
                        await this._StripeCancelPlan(subusage[0]._id, usage.product.added_quantity_multiplier * subusage[0].quantity, jwt, span);
                    } else if (subusage.length > 1) {
                        throw new Error("Error found more than one resourceusage for customerid " + usage.customerid + " and stripeprice " + usage.product.added_stripeprice);
                    }
                }
            }


            if (quantity < 1) quantity = 1;

            const total_usage = await Config.db.query<ResourceUsage>({ query: { "_type": "resourceusage", "customerid": usage.customerid, "siid": usage.siid }, top: 1000, collectionname: "config", jwt }, span);
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
                        var sub = await Message.Stripe<stripe_subscription>("GET", "subscriptions", usage.subid, null, customer.stripeid);
                        if (sub.items.total_count < 2) {
                            const res = await Message.Stripe("DELETE", "subscriptions", usage.subid, null, customer.stripeid);
                            if (customer.subscriptionid == usage.subid) {
                                const UpdateDoc: any = { "$set": {} };
                                UpdateDoc.$set["subscriptionid"] = null;
                                await Config.db.db.collection("users").updateMany({ "_id": customer._id }, UpdateDoc);
                            }
                        } else {
                            const res = await Message.Stripe("DELETE", "subscription_items", usage.siid, payload, customer.stripeid);
                        }
                    } else {
                        const res = await Message.Stripe("POST", "subscription_items", usage.siid, payload, customer.stripeid);
                    }
                }
            } else {
            }

            usage.quantity -= quantity;
            if (usage.quantity > 0) {
                await Config.db._UpdateOne(null, usage, "config", 1, false, Crypt.rootToken(), span);
            } else {
                await Config.db.DeleteOne(usage._id, "config", false, Crypt.rootToken(), span);
            }
        } finally {
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
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = this.jwt; }
            if (NoderedUtil.IsNullUndefinded(msg.jwt)) { msg.jwt = cli.jwt; }
            await this._StripeCancelPlan(msg.resourceusageid, msg.quantity, msg.jwt, span);
            delete msg.jwt;
            this.data = JSON.stringify(msg);
        } catch (error) {
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) {
                msg.error = (error.message ? error.message : error);
                if (error.response && error.response.body) {
                    msg.error = error.response.body;
                    error = new Error(msg.error)
                }
                try {
                    var e = JSON.parse(msg.error);
                    if(e.message) {
                        msg.error = e.message;
                        error = new Error(msg.error)
                    } else if(e.error && e.error.message) {
                        msg.error = e.error.message;
                        error = new Error(msg.error)
                    }
                    
                } catch (error) {

                }

            }
            throw error
        } finally {
            Logger.otel.endSpan(span);
        }
        // cli?.Send(this);
    }
    async GetNextInvoice(cli: WebSocketServerClient, parent: Span) {
        const span: Span = Logger.otel.startSubSpan("message.GetNextInvoice", parent);
        this.Reply();
        let msg: GetNextInvoiceMessage;
        try {
            msg = GetNextInvoiceMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = this.jwt; }
            if (NoderedUtil.IsNullUndefinded(msg.jwt)) { msg.jwt = cli.jwt; }

            let payload: any = {};
            const customer: Customer = await Config.db.getbyid(msg.customerid, "users", msg.jwt, true, span);
            if (NoderedUtil.IsNullUndefinded(customer)) throw new Error("Unknown customer or Access Denied");
            if (NoderedUtil.IsNullEmpty(customer.stripeid) && NoderedUtil.IsNullEmpty(Config.stripe_api_secret)) {
                // cli?.Send(this);
                return;
                // throw new Error("Customer has no billing information, please update with vattype and vatnumber");
            }
            if (Config.stripe_force_vat) {
                if (NoderedUtil.IsNullEmpty(customer.stripeid)) throw new Error("Customer " + customer.name + " has no billing information, please update with vattype and vatnumber");
            }


            const user = await Auth.Token2User(msg.jwt, span);
            if(user == null) throw new Error("Access denied");
            if (!user.HasRoleName(customer.name + " admins") && !user.HasRoleName("admins")) {
                throw new Error(`Access denied, getting invoice (not in "${customer.name} admins")`);
            }

            let subscription: stripe_subscription;
            if (!NoderedUtil.IsNullEmpty(customer.subscriptionid)) {
                subscription = await Message.Stripe<stripe_subscription>("GET", "subscriptions", customer.subscriptionid, payload, customer.stripeid);
                if (subscription != null) {
                    payload.subscription = customer.subscriptionid;
                }



                if (msg.subscription_items && msg.subscription_items.length > 0 && msg.subscription_items[0].price && !msg.subscription_items[0].id) {
                    var price = msg.subscription_items[0].price;
                    msg.invoice = await Message.Stripe<stripe_invoice>("GET", "invoices_upcoming", null, payload, customer.stripeid);

                    if (msg.invoice.lines.has_more) {
                        payload.limit = 100;
                        payload.starting_after = msg.invoice.lines.data[msg.invoice.lines.data.length - 1].id;
                        do {
                            var test = await Message.Stripe<stripe_list<stripe_invoice_line>>("GET", "invoices_upcoming_lines", customer.subscriptionid, payload, customer.stripeid);
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
                            price = await Message.Stripe<stripe_price>("GET", "prices", item.price, payload, customer.stripeid);
                            metered = (price.recurring && price.recurring.usage_type == "metered");
                            if (!price.recurring) {
                                if (!payload.invoice_items) payload.invoice_items = [];
                                payload.invoice_items.push(item);
                                msg.subscription_items.splice(i, 1);
                            }
                        } else if (item.price && item.price.startsWith("plan_")) {
                            plan = await Message.Stripe<stripe_plan>("GET", "plans", item.price, payload, customer.stripeid);
                            // metered = (plan.recurring.usage_type == "metered");
                        }

                        let quantity: number = item.quantity;
                        if (quantity < 1) quantity = 1;


                        var exists = msg.invoice.lines.data.filter(x => (x.price.id == item.price || x.plan.id == item.price) && !x.proration);
                        if (exists.length > 0) {
                            for (let i = 0; i < exists.length; i++) {
                                item.id = exists[i].subscription_item;
                                payload.subscription = (exists[i] as any).subscription;


                                const total_usage = await Config.db.query<ResourceUsage>({ query: { "_type": "resourceusage", "customerid": customer._id, "siid": exists[i].subscription_item }, top: 1000, collectionname: "config", jwt: msg.jwt }, span);
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
                        var _price = await Message.Stripe<stripe_price>("GET", "prices", item.price, payload, customer.stripeid);
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
                    const tax_ids = await Message.Stripe<stripe_list<any>>("GET", "tax_rates", null, null, null);
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

            try {
                msg.invoice = await Message.Stripe<stripe_invoice>("GET", "invoices_upcoming", null, payload, customer.stripeid);
            } catch (error) {
                if(error.message.indexOf("code 404") > -1) {
                    throw new Error("No pending invoice found");
                }
                throw new Error("Error getting invoice: " + error.message+ "\nIf error persist contact billing support");
            }

            if (msg.invoice.lines.has_more) {
                payload.limit = 100;
                payload.starting_after = msg.invoice.lines.data[msg.invoice.lines.data.length - 1].id;
                do {
                    var test = await Message.Stripe<stripe_list<stripe_invoice_line>>("GET", "invoices_upcoming_lines", customer.subscriptionid, payload, customer.stripeid);
                    msg.invoice.lines.data = msg.invoice.lines.data.concat(test.data);
                    if (test.has_more) {
                        payload.starting_after = test.data[msg.invoice.lines.data.length - 1].id;
                    }
                } while (test.has_more);
            }
            delete msg.jwt;
            this.data = JSON.stringify(msg);
        } catch (_error) {
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            const errormessage = (_error.message ? _error.message : _error);
            let error = new Error("Unknown error");
            try {
                msg.error = errormessage as any;
                if (_error.response && _error.response.body) {
                    if(_error.response.body.indexOf("{") == -1) {
                        msg.error = _error.response.body;
                        msg.error.replace(/[^a-zA-Z0-9 ]/g, "")
                    }
                }
                error = new Error(msg.error);
            } catch (error) {
            }
            console.error(error);
            throw error
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    async StripeAddPlan(cli: WebSocketServerClient, parent: Span) {
        const span: Span = Logger.otel.startSubSpan("message.StripeAddPlan", parent);
        this.Reply();
        let msg: StripeAddPlanMessage;
        try {
            msg = StripeAddPlanMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = this.jwt; }
            if (NoderedUtil.IsNullUndefinded(msg.jwt)) { msg.jwt = cli.jwt; }
            if (NoderedUtil.IsNullUndefinded(msg.userid)) msg.userid = cli.user._id;
            const [customer, checkout] = await this._StripeAddPlan(msg.customerid, msg.userid, msg.resourceid, msg.stripeprice,
                msg.quantity, false, msg.jwt, span);
            msg.checkout = checkout;
            delete msg.jwt;
            this.data = JSON.stringify(msg);
        } catch (error) {
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) {
                msg.error = (error.message ? error.message : error);
                if (error.response && error.response.body) {
                    msg.error = error.response.body;
                    try {
                        var e = JSON.parse(msg.error);
                        if(e.message) {
                            msg.error = e.message;
                        } else if(e.error && e.error.message) {
                            msg.error = e.error.message;
                        }
                        
                    } catch (error) {

                    }
                    error = new Error(msg.error)
                }
            }
            throw error
        } finally {
            Logger.otel.endSpan(span);
        }
    }

    async _StripeAddPlan(customerid: string, userid: string, resourceid: string, stripeprice: string, quantity: number, skipSession: boolean, jwt: string, parent: Span) {
        const span: Span = Logger.otel.startSubSpan("message.StripeAddPlan", parent);
        const rootjwt = Crypt.rootToken();
        var checkout: any = null;
        try {



            const customer: Customer = await Config.db.getbyid(customerid, "users", jwt, true, span);
            if (customer == null) throw new Error("Unknown customer or Access Denied");
            if (Config.stripe_force_vat && (NoderedUtil.IsNullEmpty(customer.vattype) || NoderedUtil.IsNullEmpty(customer.vatnumber))) {
                throw new Error("Only business can buy, please fill out vattype and vatnumber");
            }

            const tuser = await Auth.Token2User(jwt, span);
            if(tuser == null) throw new Error("Access denied");
            if (!tuser.HasRoleName(customer.name + " admins") && !tuser.HasRoleName("admins")) {
                throw new Error(`Access denied, adding plan (not in ${customer.name} admins")`);
            }

            if (NoderedUtil.IsNullEmpty(customer.vattype)) customer.vattype = "";
            if (NoderedUtil.IsNullEmpty(customer.vatnumber)) customer.vatnumber = "";
            customer.vatnumber = customer.vatnumber.toUpperCase();
            customer.vattype = customer.vattype.toLocaleLowerCase();

            if (!NoderedUtil.IsNullEmpty(customer.vatnumber) && customer.vattype == "eu_vat" && customer.vatnumber.substring(0, 2) != customer.country) {
                customer.country = customer.vatnumber.substring(0, 2).toUpperCase();
            }
            // if (!NoderedUtil.IsNullEmpty(customer.country) && !NoderedUtil.IsNullEmpty(customer.vatnumber) && customer.vattype == "eu_vat" && customer.vatnumber.substring(0, 2) != customer.country) {
            //     throw new Error("Country and VAT number does not match (eu vat numbers must be prefixed with country code)");
            // }
            const resource: Resource = await Config.db.getbyid(resourceid, "config", jwt, true, span);
            if (resource == null) throw new Error("Unknown resource or Access Denied");
            console.log("stripeprice", stripeprice);
            console.log("resource", resource.products.map(x=>x.stripeprice));
            console.log("count", resource.products.filter(x => x.stripeprice == stripeprice).length);
            if (resource.products.filter(x => x.stripeprice == stripeprice).length != 1) throw new Error("Unknown resource product");
            const product: ResourceVariant = resource.products.filter(x => x.stripeprice == stripeprice)[0];

            if (resource.target == "user" && NoderedUtil.IsNullEmpty(userid)) throw new Error("Missing userid for user targeted resource");
            let user: User = null
            if (resource.target == "user") {
                user = await Config.db.getbyid(userid, "users", jwt, true, span) as any;
                if (user == null) throw new Error("Unknown user or Access Denied");
            }

            const total_usage = await Config.db.query<ResourceUsage>({ query: { "_type": "resourceusage", "customerid": customerid }, top: 1000, collectionname: "config", jwt }, span);

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
                const stripecustomer = await Message.Stripe<stripe_customer>("GET", "customers", customer.stripeid, null, null);
                if (!NoderedUtil.IsNullUndefinded(stripecustomer) && !NoderedUtil.IsNullUndefinded(stripecustomer.subscriptions)) {
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
            }

            let _quantity: number = 0;
            // Count what we have already bought
            total_usage.forEach(x => {
                if (x.product.stripeprice == stripeprice && !NoderedUtil.IsNullEmpty(x.siid)) _quantity += x.quantity;
            });
            // Add requested quantity, now we have our target count
            _quantity += quantity;

            if(!NoderedUtil.IsNullEmpty(product.stripeproduct) && !NoderedUtil.IsNullEmpty(Config.stripe_api_secret)) {
                const stripe_product = await Message.Stripe<stripe_price>("GET", "products", product.stripeproduct, null, null);
                if(stripe_product==null) throw new Error("Unknown product");
                if(stripe_product.active == false) throw new Error("Product is not active");
            }
            let stripe_price: stripe_price = {type: "payment"} as any;

            if(!NoderedUtil.IsNullEmpty(product.stripeprice) && !NoderedUtil.IsNullEmpty(Config.stripe_api_secret)) {
                stripe_price = await Message.Stripe<stripe_price>("GET", "prices", product.stripeprice, null, null);
                if(stripe_price==null) throw new Error("Unknown price " + product.stripeprice + " for product " + product.name);
                if(stripe_price.active == false) throw new Error("Price " + product.stripeprice + " for product " + product.name + " is not active");
            }


            if((stripe_price as any).type != "one_time"){
                if (NoderedUtil.IsNullEmpty(usage.subid)) {
                    usage.quantity = quantity;
                } else {
                    usage.quantity += quantity;
                }
            }

            usage.customerid = customer._id;
            if (user != null) {
                usage.userid = user._id;
                usage.name = usage.resource + " / " + product.name + " for " + user.name;
            } else {
                usage.name = usage.resource + " / " + product.name + " for " + customer.name;
            }


            var s = usage.siid;
            // @ts-ignore
            usage.mode = (stripe_price as any).type

            if (NoderedUtil.IsNullEmpty(usage._id) || NoderedUtil.IsNullEmpty(usage.subid) || Config.stripe_force_checkout || (stripe_price as any).type == "one_time") {
                let tax_rates = [];
                // if (NoderedUtil.IsNullEmpty(customer.country)) customer.country = "";
                // customer.country = customer.country.toUpperCase();
                // if (NoderedUtil.IsNullEmpty(customer.vattype) || customer.country == "DK") {
                //     if (!NoderedUtil.IsNullEmpty(Config.stripe_api_secret)) {
                //         const tax_ids = await Message.Stripe<stripe_list<any>>("GET", "tax_rates", null, null, null);
                //         if (tax_ids && tax_ids.data && tax_ids.data.length > 0) {
                //             tax_rates = tax_ids.data.filter(x => x.active && x.country == customer.country).map(x => x.id);
                //         }
                //     }
                // }
                // tax_rates = undefined;

                // https://stripe.com/docs/payments/checkout/taxes
                Base.addRight(usage, customer.admins, customer.name + " admin", [Rights.read]);

                if (NoderedUtil.IsNullEmpty(customer.subscriptionid) || Config.stripe_force_checkout || (stripe_price as any).type == "one_time") {
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

                        var mode = "subscription";
                        if((stripe_price as any).type == "one_time") mode = "payment";
                        const payload: any = {
                            client_reference_id: usage._id,
                            success_url: baseurl + "/refresh", cancel_url: baseurl + "/refresh",
                            payment_method_types: ["card"], mode,
                            tax_id_collection: { enabled: true }, // Allow customer to addd tax id
                            automatic_tax: { enabled: true },     // Let stripe add the correct tax
                            line_items: []
                        };
                        if (Config.stripe_allow_promotion_codes) {
                            payload.allow_promotion_codes = true;
                        }
                        if (!NoderedUtil.IsNullEmpty(customer.stripeid)) {
                            payload.customer = customer.stripeid;
                            // payload.billing_address_collection = "auto"; "country": "auto",
                            payload.customer_update = { "address": "auto", "name": "auto" };
                        } else {
                            payload.billing_address_collection = "auto";
                            // payload.billing_address_collection = true; "country": "auto",
                            // payload.customer_update = { "address": "auto", "name": "auto" };
                        }

                        let line_item: any = { price: product.stripeprice, tax_rates };
                        if((stripe_price as any).type == "one_time") {
                            line_item.quantity = 1
                        } else if ((resource.target == "user" && product.userassign != "metered") ||
                            (resource.target == "customer" && product.customerassign != "metered")) {
                            line_item.quantity = _quantity
                        }
                        payload.line_items.push(line_item);
                        if (!NoderedUtil.IsNullEmpty(product.added_resourceid) && !NoderedUtil.IsNullEmpty(product.added_stripeprice)) {
                            const addresource: Resource = await Config.db.getbyid(product.added_resourceid, "config", jwt, true, span);
                            const addproduct = addresource.products.filter(x => x.stripeprice == product.added_stripeprice)[0];
                            let line_item: any = { price: addproduct.stripeprice, tax_rates };
                            if ((resource.target == "user" && addproduct.userassign != "metered") ||
                                (resource.target == "customer" && addproduct.customerassign != "metered")) {
                                line_item.quantity = product.added_quantity_multiplier * _quantity
                            }
                            payload.line_items.push(line_item);
                        }
                        console.log(JSON.stringify(payload, null, 2));
                        if (!NoderedUtil.IsNullEmpty(Config.stripe_api_secret)) {
                            checkout = await Message.Stripe("POST", "checkout.sessions", null, payload, null);
                            // @ts-ignore
                            customer.sessionid = checkout.id;
                            // @ts-ignore
                            usage.sessionid = checkout.id;

                            await Config.db._UpdateOne(null, customer, "users", 3, true, rootjwt, span);
                            await Config.db._UpdateOne(null, usage, "config", 1, false, rootjwt, span);
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
                    const res = await Message.Stripe<stripe_subscription_item>("POST", "subscription_items", usage.siid, line_item, customer.stripeid);
                    usage.siid = res.id;
                    usage.subid = customer.subscriptionid;
                    await Config.db.InsertOne(usage, "config", 1, false, rootjwt, span);
                    if (!NoderedUtil.IsNullEmpty(product.added_resourceid) && !NoderedUtil.IsNullEmpty(product.added_stripeprice)) {
                        const [customer2, checkout2] = await this._StripeAddPlan(customerid, userid,
                            product.added_resourceid, product.added_stripeprice, product.added_quantity_multiplier * usage.quantity, true, jwt, span);
                    }
                }
            } else {
                // (stripe_price as any).type == "one_time"
                const payload: any = {};
                // Update quantity if not metered
                if ((resource.target == "user" && product.userassign != "metered") ||
                    (resource.target == "customer" && product.customerassign != "metered")) {
                    payload.quantity = _quantity
                    if (!NoderedUtil.IsNullEmpty(Config.stripe_api_secret)) {
                        const res = await Message.Stripe("POST", "subscription_items", usage.siid, payload, customer.stripeid);
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
        } finally {
            Logger.otel.endSpan(span);
        }
    }

    static async Stripe<T>(method: string, object: string, id: string, payload: any, customerid: string): Promise<T> {
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
        var stripe_api_secret = Config.stripe_api_secret;
        if(stripe_api_secret == null || stripe_api_secret == "") throw new Error("Missing stripe_api_secret");
        const auth = "Basic " + Buffer.from(stripe_api_secret + ":").toString("base64");

        const options = {
            headers: {
                "Content-type": "application/x-www-form-urlencoded",
                "authorization": auth
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
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = this.jwt; }
            if (NoderedUtil.IsNullUndefinded(msg.jwt)) { msg.jwt = cli.jwt; }
            if (NoderedUtil.IsNullEmpty(msg.object)) throw new Error("object is mandatory");
            if (!cli.user.HasRoleName("admins")) {
                if (!NoderedUtil.IsNullEmpty(msg.url)) throw new Error("Custom url not allowed");
                if (msg.object != "plans" && msg.object != "subscription_items" && msg.object != "invoices_upcoming" && msg.object != "billing_portal/sessions") {
                    throw new Error("Access to " + msg.object + " is not allowed");
                }
                if (msg.object == "billing_portal/sessions") {
                    const tuser = await Auth.Token2User(msg.jwt, null);
                    if(tuser == null) throw new Error("Access denied");
                    let customer: Customer;
                    if (!NoderedUtil.IsNullEmpty(tuser.selectedcustomerid)) customer = await Config.db.getbyid(tuser.selectedcustomerid, "users", cli.jwt, true, null);
                    if (!NoderedUtil.IsNullEmpty(tuser.selectedcustomerid) && customer == null) customer = await Config.db.getbyid(tuser.customerid, "users", cli.jwt, true, null);
                    if (customer == null) throw new Error("Access denied, or customer not found");
                    if (!tuser.HasRoleName(customer.name + " admins") && !tuser.HasRoleName("admins")) {
                        throw new Error(`Access denied, (not in "${customer.name} admins")`);
                    }
                }
                if (msg.object == "subscription_items" && msg.method != "POST") throw new Error("Access to " + msg.object + " is not allowed");
                if (msg.object == "plans" && msg.method != "GET") throw new Error("Access to " + msg.object + " is not allowed");
                if (msg.object == "invoices_upcoming" && msg.method != "GET") throw new Error("Access to " + msg.object + " is not allowed");
            }
            msg.payload = await Message.Stripe(msg.method, msg.object, msg.id, msg.payload, msg.customerid);
            delete msg.jwt;
            this.data = JSON.stringify(msg);
        } catch (error) {
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) {
                msg.error = (error.message ? error.message : error);
                if (error.response && error.response.body) {
                    msg.error = error.response.body;
                    error = new Error(msg.error)
                }
            }
            throw error
        }
    }
    // https://dominik.sumer.dev/blog/stripe-checkout-eu-vat
    async EnsureCustomer(cli: WebSocketServerClient, parent: Span) {
        this.Reply();
        const span: Span = Logger.otel.startSubSpan("message.EnsureCustomer", parent);
        let msg: EnsureCustomerMessage;
        const rootjwt = Crypt.rootToken();
        try {
            msg = EnsureCustomerMessage.assign(this.data);
            if (NoderedUtil.IsNullEmpty(msg.jwt)) { msg.jwt = this.jwt; }
            if (NoderedUtil.IsNullUndefinded(msg.jwt)) { msg.jwt = cli.jwt; }
            let user: User = await Auth.Token2User(msg.jwt, span);
            if(user == null) throw new Error("Access denied");
            // @ts-ignore
            var ensureas = msg.ensureas;
            if(!NoderedUtil.IsNullEmpty(ensureas)) {
                var targetuser = await Config.db.getbyid(ensureas, "users", msg.jwt, true, span);
                if(targetuser == null) {
                    throw new Error("Access denied creating customer on behalf of " + ensureas);
                } else if (!DatabaseConnection.hasAuthorization(user, targetuser, Rights.update)) {
                    throw new Error("Access denied creating customer on behalf of " + targetuser.name);
                }
                user = User.assign(targetuser);
            }

            let customer: Customer = null;
            if (msg.customer != null && msg.customer._id != null) {
                const customers = await Config.db.query<Customer>({ query: { _type: "customer", "_id": msg.customer._id }, top: 1, collectionname: "users", jwt: msg.jwt }, span);
                if (customers.length > 0) {
                    customer = customers[0];
                }
            }
            if (!user.HasRoleId(WellknownIds.admins)) {
                delete msg.customer.domains;
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
                if (!NoderedUtil.IsNullUndefinded(msg.customer.domains)) {
                    customer.domains = msg.customer.domains;
                }

                msg.customer = customer;
                if (!NoderedUtil.IsNullEmpty(customer.vatnumber)) msg.customer.vatnumber = msg.customer.vatnumber.toUpperCase();
            }
            msg.customer._type = "customer";
            let tax_exempt: string = "none";
            if (Config.stripe_force_vat && (NoderedUtil.IsNullEmpty(msg.customer.vattype) || NoderedUtil.IsNullEmpty(msg.customer.vatnumber))) {
                throw new Error("Only business can buy, please fill out vattype and vatnumber");
            }
            if (!NoderedUtil.IsNullUndefinded(customer.domains)) {
                for (var i = 0; i < customer.domains.length; i++) {
                    customer.domains[i] = customer.domains[i].toLowerCase();
                }
            }

            // @ts-ignore
            let sessionid = customer.sessionid
            if (!NoderedUtil.IsNullEmpty(sessionid)) {
                var session = await Message.Stripe<stripe_base>("GET", "checkout.sessions", sessionid, null, null);

                var onetime = await Config.db.query<ResourceUsage>({ query: { "_type": "resourceusage", "mode": "one_time", "sessionid": sessionid }, top: 1, collectionname: "config", jwt: msg.jwt }, span);
                if (onetime.length > 0) {
                    const usage = onetime[0];
                    if((session as any).payment_status == "paid") {
                        if(usage.quantity == null) usage.quantity = 0;
                        usage.quantity ++;
                        // add fake siid, since this is a onetime purche and does not have a subscription item
                        usage.siid = NoderedUtil.GetUniqueIdentifier();
                        // @ts-ignore
                        delete usage.sessionid;
                        await Config.db._UpdateOne(null, usage, "config", 1, false, rootjwt, span);
                    }
                }
                // @ts-ignore
                if (session != null && !NoderedUtil.IsNullEmpty(session.customer)) {
                    // @ts-ignore
                    msg.customer.stripeid = session.customer
                    // @ts-ignore
                    delete customer.sessionid;
                }

            }
            if (!NoderedUtil.IsNullEmpty(msg.customer.stripeid) || Config.stripe_force_vat) {

                if (NoderedUtil.IsNullUndefinded(msg.stripecustomer) && !NoderedUtil.IsNullEmpty(msg.customer.stripeid)) {
                    msg.stripecustomer = await Message.Stripe<stripe_customer>("GET", "customers", msg.customer.stripeid, null, null);
                    if (msg.stripecustomer == null) {
                        msg.customer.stripeid = "";
                    }
                }
                if (NoderedUtil.IsNullUndefinded(msg.stripecustomer)) {
                    msg.customer.subscriptionid = null;
                    if(!NoderedUtil.IsNullEmpty(msg.customer.stripeid)) {
                        const total_usage = await Config.db.query<ResourceUsage>({ query: { "_type": "resourceusage", "customerid": msg.customer._id }, top: 1000, collectionname: "config", jwt: msg.jwt }, span);
                        Logger.instanse.warn("[" + user.username + "][" + msg.customer.name + "] has no stripe customer, deleting all " + total_usage.length + " assigned plans.", span);
                        for (let usage of total_usage) {
                            // @ts-ignore
                            if(usage.mode != "one_time") {// null = recurring. recurring or one_time
                                await Config.db.DeleteOne(usage._id, "config", false, rootjwt, span);
                            }
                        }
                    }

                } else {
                    if (NoderedUtil.IsNullEmpty(msg.customer.email)) {
                        msg.customer.email = msg.stripecustomer.email;
                    }
                    if (msg.stripecustomer.name != msg.customer.name) {
                        const payload: any = { name: msg.customer.name };
                        msg.stripecustomer = await Message.Stripe<stripe_customer>("POST", "customers", msg.customer.stripeid, payload, null);
                    }
                    if (!NoderedUtil.IsNullEmpty(msg.stripecustomer?.address?.country)) {
                        msg.customer.country = msg.stripecustomer.address.country;
                    }
                    var test = msg.stripecustomer;
                    if (msg.stripecustomer && msg.stripecustomer.tax_ids && msg.stripecustomer.tax_ids.total_count > 0) {
                        msg.customer.vattype = msg.stripecustomer.tax_ids.data[0].type;
                        msg.customer.vatnumber = msg.stripecustomer.tax_ids.data[0].value;
                    }
                    if (msg.stripecustomer.subscriptions.total_count > 0) {
                        let sub = msg.stripecustomer.subscriptions.data[0];
                        msg.customer.subscriptionid = sub.id;
                        const total_usage = await Config.db.query<ResourceUsage>({ query: { "_type": "resourceusage", "customerid": msg.customer._id, "$or": [{ "siid": { "$exists": false } }, { "siid": "" }, { "siid": null }] }, top: 1000, collectionname: "config", jwt: msg.jwt }, span);
                        Logger.instanse.warn("[" + user.username + "][" + msg.customer.name + "] Updating all " + total_usage.length + " unmapped purchases to an assigned plan.", span);

                        for (let usage of total_usage) {
                            const items = sub.items.data.filter(x => ((x.price && x.price.id == usage.product.stripeprice) || (x.plan && x.plan.id == usage.product.stripeprice)));
                            if (items.length > 0) {
                                usage.siid = items[0].id;
                                usage.subid = sub.id;
                                await Config.db._UpdateOne(null, usage, "config", 1, false, rootjwt, span);
                            } else {
                                // @ts-ignore
                                if(usage.mode != "one_time") {// null = recurring. recurring or one_time
                                    // Clean up old buy attempts
                                    await Config.db.DeleteOne(usage._id, "config", false, rootjwt, span);
                                }
                            }
                        }
                    } else {
                        if(!NoderedUtil.IsNullEmpty(msg.customer.stripeid)) {
                            msg.customer.subscriptionid = null;
                            const total_usage = await Config.db.query<ResourceUsage>({ query: { "_type": "resourceusage", "customerid": msg.customer._id }, top: 1000, collectionname: "config", jwt: msg.jwt }, span);
                            Logger.instanse.warn("[" + user.username + "][" + msg.customer.name + "] has no subscriptions, deleting all " + total_usage.length + " assigned plans.", span);
                            for (let usage of total_usage) {
                                // @ts-ignore
                                if(usage.mode != "one_time") {// null = recurring. recurring or one_time
                                    await Config.db.DeleteOne(usage._id, "config", false, rootjwt, span);
                                }
                                
                            }
                        }
                    }
                }
            } else {
                if(!NoderedUtil.IsNullEmpty(msg.customer.stripeid)) {
                    msg.customer.subscriptionid = null;
                    const total_usage = await Config.db.query<ResourceUsage>({ query: { "_type": "resourceusage", "customerid": msg.customer._id }, top: 1000, collectionname: "config", jwt: msg.jwt }, span);
                    Logger.instanse.warn("[" + user.username + "][" + msg.customer.name + "] has stripe customer, but no active subscription deleting all " + total_usage.length + " assigned plans.", span);
                    for (let usage of total_usage) {
                        // @ts-ignore
                        if(usage.mode != "one_time") {// null = recurring. recurring or one_time
                            await Config.db.DeleteOne(usage._id, "config", false, rootjwt, span);
                        }
                    }
                }
            }

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

            const global_customer_admins: Role = await Logger.DBHelper.EnsureRole(rootjwt, "customer admins", WellknownIds.customer_admins, span);

            const customeradmins: Role = await Logger.DBHelper.EnsureRole(rootjwt, msg.customer.name + " admins", msg.customer.admins, span);
            customeradmins.name = msg.customer.name + " admins";
            Base.addRight(customeradmins, WellknownIds.admins, "admins", [Rights.full_control]);
            Base.addRight(customeradmins, global_customer_admins._id, global_customer_admins.name, [Rights.full_control]);
            if (!user.HasRoleId(WellknownIds.admins)) {
                customeradmins.AddMember(user as any);
            }

            customeradmins.AddMember(global_customer_admins);
            if (!NoderedUtil.IsNullEmpty(user.customerid) && user.customerid != msg.customer._id) {
                const usercustomer = await Config.db.getbyid<Customer>(user.customerid, "users", msg.jwt, true, span);
                if (usercustomer != null && !user.HasRoleId(WellknownIds.admins)) {
                    const usercustomeradmins = await Config.db.getbyid<Role>(usercustomer.admins, "users", msg.jwt, true, span);
                    if (usercustomeradmins != null) customeradmins.AddMember(usercustomeradmins);
                }
            }
            customeradmins.customerid = msg.customer._id;
            await Logger.DBHelper.Save(customeradmins, rootjwt, span);

            const customerusers: Role = await Logger.DBHelper.EnsureRole(rootjwt, msg.customer.name + " users", msg.customer.users, span);
            customerusers.name = msg.customer.name + " users";
            customerusers.customerid = msg.customer._id;
            Base.addRight(customerusers, customeradmins._id, customeradmins.name, [Rights.full_control]);
            Base.removeRight(customerusers, customeradmins._id, [Rights.delete]);
            customerusers.AddMember(customeradmins);
            if (NoderedUtil.IsNullEmpty(cli.user.customerid) || cli.user.customerid == msg.customer._id) {
                if (!user.HasRoleId(WellknownIds.admins)) customerusers.AddMember(cli.user);
            }
            await Logger.DBHelper.Save(customerusers, rootjwt, span);

            if (msg.customer.admins != customeradmins._id || msg.customer.users != customerusers._id) {
                msg.customer.admins = customeradmins._id;
                msg.customer.users = customerusers._id;
            }
            Base.addRight(msg.customer, customerusers._id, customerusers.name, [Rights.read]);
            Base.addRight(msg.customer, customeradmins._id, customeradmins.name, [Rights.read]);
            await Config.db._UpdateOne(null, msg.customer, "users", 3, true, rootjwt, span);

            if (msg.customer._id == cli.user.customerid) {
                cli.user.selectedcustomerid = msg.customer._id;
                cli.user = await Logger.DBHelper.DecorateWithRoles(cli.user, span);
                if (!NoderedUtil.IsNullUndefinded(cli.user)) cli.username = cli.user.username;
                cli.user.roles.push(new Rolemember(customerusers.name, customerusers._id));
                cli.user.roles.push(new Rolemember(customeradmins.name, customeradmins._id));
                await this.ReloadUserToken(cli, span);
            }
            delete msg.jwt;
            this.data = JSON.stringify(msg);
        } catch (error) {
            if (NoderedUtil.IsNullUndefinded(msg)) { (msg as any) = {}; }
            if (msg !== null && msg !== undefined) {
                msg.error = (error.message ? error.message : error);
                if (error.response && error.response.body) {
                    msg.error = error.response.body;
                    error = new Error(msg.error)
                }
            }
            throw error
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return "0 Bytes";

        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

        const i = Math.floor(Math.log(bytes) / Math.log(k));

        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
    }
    sleep(ms) {
        return new Promise(resolve => { setTimeout(resolve, ms) })
    }
    public async ReloadUserToken(cli: WebSocketServerClient, parent: Span) {
        if (NoderedUtil.IsNullUndefinded(cli)) return;
        await this.sleep(1000);
        const l: SigninMessage = new SigninMessage();
        await Logger.DBHelper.CheckCache("users", cli.user, false, false, parent);
        cli.user = await Logger.DBHelper.DecorateWithRoles(cli.user, parent);
        cli.jwt = await Auth.User2Token(cli.user, Config.shorttoken_expires_in, parent);
        if (!NoderedUtil.IsNullUndefinded(cli.user)) cli.username = cli.user.username;
        l.jwt = cli.jwt;
        l.user = TokenUser.From(cli.user);
        const m: Message = new Message(); m.command = "refreshtoken";
        m.data = JSON.stringify(l);
        // cli?.Send(m);
    }
    private async Housekeeping(parent: Span): Promise<void> {
        this.Reply();
        const span: Span = Logger.otel.startSubSpan("message.GetNoderedInstance", parent);
        let msg: any;
        try {
            msg = JSON.parse(this.data);
            HouseKeeping.lastHouseKeeping = null;
            if (NoderedUtil.IsNullEmpty(msg.skipnodered)) msg.skipnodered = false;
            if (NoderedUtil.IsNullEmpty(msg.skipcalculatesize)) msg.skipcalculatesize = false;
            if (NoderedUtil.IsNullEmpty(msg.skipupdateusersize)) msg.skipupdateusersize = false;
            await HouseKeeping.DoHouseKeeping(msg.skipnodered, msg.skipcalculatesize, msg.skipupdateusersize, span);
            delete msg.jwt;
            this.data = JSON.stringify(msg);
        } finally {
            Logger.otel.endSpan(span);
        }        
    }


    async SelectCustomer(parent: Span): Promise<User> {
        let user: User = null;
        this.Reply();
        let msg: SelectCustomerMessage;
        msg = SelectCustomerMessage.assign(this.data);
        if (!NoderedUtil.IsNullEmpty(msg.customerid)) {
            var customer = await Config.db.getbyid<Customer>(msg.customerid, "users", this.jwt, true, parent)
            if (customer == null) msg.customerid = null;
        } else {
            // do we really need to force this ? 
            // var customers = await Config.db.query<Customer>({ query: {"_type" : "customer"}, collectionname:"users", jwt: this.jwt, top:2}, parent)
            // if(customers.length == 1) msg.customerid = user.customerid;
        }
        user = this.tuser;
        if (Config.db.WellknownIdsArray.indexOf(user._id) != -1) throw new Error("Builtin entities cannot select a company")

        const UpdateDoc: any = { "$set": {} };
        UpdateDoc.$set["selectedcustomerid"] = msg.customerid;
        await Config.db._UpdateOne({ "_id": user._id }, UpdateDoc, "users", 1, false, Crypt.rootToken(), parent);
        user.selectedcustomerid = msg.customerid;
        delete msg.jwt;
        this.data = JSON.stringify(msg);
        return user;
    }


    async AddWorkitem(parent: Span): Promise<void> {
        this.Reply();
        let msg: AddWorkitemMessage;
        const rootjwt = Crypt.rootToken();
        const jwt = this.jwt;
        const user: User = this.tuser;

        msg = AddWorkitemMessage.assign(this.data);
        if (NoderedUtil.IsNullEmpty(msg.wiqid) && NoderedUtil.IsNullEmpty(msg.wiq)) throw new Error("wiq or wiqid is mandatory")

        var wiq: WorkitemQueue = null;
        if (!NoderedUtil.IsNullEmpty(msg.wiqid)) {
            var queues = await Config.db.query<WorkitemQueue>({ query: { _id: msg.wiqid }, collectionname: "mq", jwt }, parent);
            if (queues.length > 0) wiq = queues[0];
        }
        if (wiq == null && !NoderedUtil.IsNullEmpty(msg.wiq)) {
            var queues = await Config.db.query<WorkitemQueue>({ query: { name: msg.wiq, "_type": "workitemqueue" }, collectionname: "mq", jwt }, parent);
            if (queues.length > 0) wiq = queues[0];
        }
        if (wiq == null) throw new Error("Work item queue not found " + msg.wiq + " (" + msg.wiqid + ") not found.");


        var wi: Workitem = new Workitem(); wi._type = "workitem";
        wi._id = new ObjectId().toHexString();
        wi._acl = wiq._acl;
        if (!DatabaseConnection.hasAuthorization(user, wi, Rights.invoke)) {
            throw new Error("Unknown work item queue or " + this.tuser.username + " is missing invoke rights");
        }
        wi.wiq = wiq.name;
        wi.wiqid = wiq._id;
        wi.name = msg.name ? msg.name : "New work item";
        wi.payload = msg.payload ? msg.payload : {};
        if (typeof wi.payload !== "object") wi.payload = { "value": wi.payload };
        wi.priority = msg.priority;
        wi.nextrun = msg.nextrun;
        // @ts-ignore
        if(wi.nextrun?.seconds && wi.nextrun?.nanos) {
            // @ts-ignore
            const milliseconds = parseInt(wi.nextrun.seconds) * 1000 + Math.floor(wi.nextrun.nanos / 1000000);
            const date = new Date(milliseconds);
            wi.nextrun = date;
        }
        if (!NoderedUtil.IsNullEmpty(msg.wipriority)) wi.priority = msg.wipriority;
        if (NoderedUtil.IsNullEmpty(wi.priority)) wi.priority = 2;
        wi.failed_wiq = msg.failed_wiq;
        wi.failed_wiqid = msg.failed_wiqid;
        wi.success_wiq = msg.success_wiq;
        wi.success_wiqid = msg.success_wiqid;

        wi.state = "new"
        wi.retries = 0;
        wi.files = [];
        wi.lastrun = null;
        
        if (!wi.nextrun) {
            wi.nextrun = new Date(new Date().toISOString());
            wi.nextrun.setSeconds(wi.nextrun.getSeconds() + wiq.initialdelay);
        }


        if (msg.files) {
            for (var i = 0; i < msg.files.length; i++) {
                var file = msg.files[i];
                try {
                    if (NoderedUtil.IsNullUndefinded(file.file)) continue;
                    const readable = new Readable();
                    readable._read = () => { }; // _read is required but you can noop it
                    if (file.file && (!file.compressed)) {
                        const buf: Buffer = Buffer.from(file.file, "base64");
                        readable.push(buf);
                        readable.push(null);
                    } else {
                        let result: Buffer;
                        try {
                            var data = Buffer.from(file.file, "base64")
                            result = pako.inflate(data);
                        } catch (error) {
                            Logger.instanse.error(msg.error, parent);
                        }
                        readable.push(result);
                        readable.push(null);
                    }
                    const mimeType = mimetype.lookup(file.filename);
                    const metadata = new Base();
                    metadata._createdby = user.name;
                    metadata._createdbyid = user._id;
                    metadata._created = new Date(new Date().toISOString());
                    metadata._modifiedby = user.name;
                    metadata._modifiedbyid = user._id;
                    metadata._modified = metadata._created;
                    (metadata as any).wi = wi._id;
                    (metadata as any).wiq = wiq.name;
                    (metadata as any).wiqid = wiq._id;
                    (metadata as any).uniquename = NoderedUtil.GetUniqueIdentifier() + "-" + path.basename(file.filename);

                    metadata._acl = wiq._acl;
                    metadata.name = path.basename(file.filename);
                    (metadata as any).filename = file.filename;
                    (metadata as any).path = path.dirname(file.filename);
                    if ((metadata as any).path == ".") (metadata as any).path = "";


                    const fileid = await this._SaveFile(readable, file.filename, mimeType, metadata);
                    wi.files.push({ "name": file.filename, "filename": path.basename(file.filename), _id: fileid });

                } catch (err) {
                    Logger.instanse.error(msg.error, parent);
                }
            }
        }
        delete msg.files;

        wi = await Config.db.InsertOne(wi, "workitems", 1, true, jwt, parent);
        msg.result = wi;
        const end: number = new Date().getTime();
        const seconds = Math.round((end - Config.db.queuemonitoringlastrun.getTime()) / 1000);
        const nextrun_seconds = Math.round((end - wi.nextrun.getTime()) / 1000);
        if (seconds > 5 && nextrun_seconds >= 0) {
            Config.db.queuemonitoringlastrun = new Date();
            // Config.db.queuemonitoring()
        }
        delete msg.jwt;
        this.data = JSON.stringify(msg);
    }
    async DuplicateWorkitem(originalwi: Workitem, wiq: string, wiqid: string, jwt: string, parent: Span): Promise<void> {
        var wi: Workitem = null;
        wi = Object.assign({}, originalwi);
        delete wi.success_wiqid;
        delete wi.success_wiq;
        delete wi.failed_wiqid;
        delete wi.failed_wiq;
        delete wi._id;
        delete wi.errormessage;
        delete wi.errorsource;
        delete wi.errortype;
        delete wi.lastrun;
        wi.retries = 0;
        delete wi.userid;
        delete wi.username;
        wi.state = "new";
        var _wiq: WorkitemQueue = null;
        if (!NoderedUtil.IsNullEmpty(wiqid)) {
            var queues = await Config.db.query<WorkitemQueue>({ query: { _id: wiqid }, collectionname: "mq", jwt }, parent);
            if (queues.length > 0) _wiq = queues[0];
        }
        if (_wiq == null && !NoderedUtil.IsNullEmpty(wiq)) {
            var queues = await Config.db.query<WorkitemQueue>({ query: { name: wiq, "_type": "workitemqueue" }, collectionname: "mq", jwt }, parent);
            if (queues.length > 0) _wiq = queues[0];
        }
        if (_wiq == null) throw new Error("Work item queue not found " + wiq + " (" + wiqid + ") not found.");
        wi.wiq = _wiq.name;
        wi.wiqid = _wiq._id;
        wi.nextrun = new Date(new Date().toISOString());
        try {
            wi.nextrun.setSeconds(wi.nextrun.getSeconds() + _wiq.initialdelay);
        } catch (error) {
            wi.nextrun = new Date(new Date().toISOString());
        }
        for (let i = _wiq._acl.length - 1; i >= 0; i--) {
            const ace = _wiq._acl[i];
            let bits = [];
            if (ace.rights == Ace.full_control || ace.rights == "//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8=") {
                bits = [-1];
            } else {
                for (let y = 0; y < Ace.ace_right_bits; y++) {
                    if (Ace.isBitSet(ace, y)) bits.push(y);
                }
            }
            Base.addRight(wi, ace._id, ace.name, bits);
        }
        for (var i = 0; i < wi.files.length; i++) {
            var _f = wi.files[i];
            var file:string = (await this._GetFile(_f._id, false)).toString("base64");
            const metadata = new Base();
            (metadata as any).wi = wi._id;
            (metadata as any).wiq = _wiq.name;
            (metadata as any).wiqid = _wiq._id;
            metadata._acl = wi._acl;
            metadata.name = path.basename(_f.filename);
            (metadata as any).filename = _f.filename;
            (metadata as any).path = path.dirname(_f.filename);
            if ((metadata as any).path == ".") (metadata as any).path = "";
            _f._id = await this._addFile(file, _f.filename, null, metadata, false, jwt);
        }
        wi = await Config.db.InsertOne(wi, "workitems", 1, true, jwt, parent);
    }
    async AddWorkitems(parent: Span): Promise<void> {
        this.Reply();
        let msg: AddWorkitemsMessage;
        const rootjwt = Crypt.rootToken();
        const jwt = this.jwt;
        const user: User = this.tuser;
        let isRelevant: boolean = false;

        let end: number = new Date().getTime();

        msg = AddWorkitemsMessage.assign(this.data);
        if (NoderedUtil.IsNullEmpty(msg.wiqid) && NoderedUtil.IsNullEmpty(msg.wiq)) throw new Error("wiq or wiqid is mandatory")

        var wiq: WorkitemQueue = null;
        if (!NoderedUtil.IsNullEmpty(msg.wiqid)) {
            var queues = await Config.db.query<WorkitemQueue>({ query: { _id: msg.wiqid }, collectionname: "mq", jwt }, parent);
            if (queues.length > 0) wiq = queues[0];
        }
        if (wiq == null && !NoderedUtil.IsNullEmpty(msg.wiq)) {
            var queues = await Config.db.query<WorkitemQueue>({ query: { name: msg.wiq, "_type": "workitemqueue" }, collectionname: "mq", jwt }, parent);
            if (queues.length > 0) wiq = queues[0];
        }
        if (wiq == null) throw new Error("Work item queue not found " + msg.wiq + " (" + msg.wiqid + ") not found.");

        var additems = [];

        // isRelevant = (msg.items.length > 0);
        for (let i = 0; i < msg.items.length; i++) {
            let item = msg.items[i];
            let wi: Workitem = new Workitem(); wi._type = "workitem";
            wi._id = new ObjectId().toHexString();
            wi._acl = wiq._acl;
            if (!DatabaseConnection.hasAuthorization(user, wi, Rights.invoke)) {
                throw new Error("Unknown work item queue or " + this.tuser.username + " is missing invoke rights");
            }
            wi.wiq = wiq.name;
            wi.wiqid = wiq._id;
            wi.name = item.name ? item.name : "New work item";
            wi.payload = item.payload ? item.payload : {};
            if (typeof wi.payload !== "object") wi.payload = { "value": wi.payload };
            wi.priority = item.priority;
            if (!NoderedUtil.IsNullEmpty(msg.wipriority)) wi.priority = msg.wipriority;
            if (NoderedUtil.IsNullEmpty(wi.priority)) wi.priority = 2;
            wi.nextrun = item.nextrun;
            // @ts-ignore
            if(wi.nextrun?.seconds && wi.nextrun?.nanos) {
                // @ts-ignore
                const milliseconds = parseInt(wi.nextrun.seconds) * 1000 + Math.floor(wi.nextrun.nanos / 1000000);
                const date = new Date(milliseconds);
                wi.nextrun = date;
            }

            wi.state = "new"
            wi.retries = 0;
            wi.files = [];
            if (NoderedUtil.IsNullEmpty(wi.priority)) wi.priority = 2;
            if (!NoderedUtil.IsNullEmpty(msg.failed_wiq)) wi.failed_wiq = msg.failed_wiq;
            if (!NoderedUtil.IsNullEmpty(msg.failed_wiqid)) wi.failed_wiqid = msg.failed_wiqid;
            if (!NoderedUtil.IsNullEmpty(msg.success_wiq)) wi.success_wiq = msg.success_wiq;
            if (!NoderedUtil.IsNullEmpty(msg.success_wiqid)) wi.success_wiqid = msg.success_wiqid;

            wi.lastrun = null;
            if (!wi.nextrun) {
                wi.nextrun = new Date(new Date().toISOString());
                wi.nextrun.setSeconds(wi.nextrun.getSeconds() + wiq.initialdelay);
            } else {
                wi.nextrun = new Date(wi.nextrun);
            }

            const nextrun_seconds = Math.round((end - wi.nextrun.getTime()) / 1000);
            if (nextrun_seconds >= 0) isRelevant = true;


            if (item.files) {
                for (let i = 0; i < item.files.length; i++) {
                    let file = item.files[i];
                    try {
                        if (NoderedUtil.IsNullUndefinded(file.file)) continue;
                        const readable = new Readable();
                        readable._read = () => { }; // _read is required but you can noop it
                        if (file.file && (!file.compressed)) {
                            const buf: Buffer = Buffer.from(file.file, "base64");
                            readable.push(buf);
                            readable.push(null);
                        } else {
                            let result: Buffer;
                            try {
                                var data = Buffer.from(file.file, "base64")
                                result = pako.inflate(data);
                            } catch (error) {
                                Logger.instanse.error(msg.error, parent);
                            }
                            readable.push(result);
                            readable.push(null);
                        }
                        const mimeType = mimetype.lookup(file.filename);
                        const metadata = new Base();
                        metadata._createdby = user.name;
                        metadata._createdbyid = user._id;
                        metadata._created = new Date(new Date().toISOString());
                        metadata._modifiedby = user.name;
                        metadata._modifiedbyid = user._id;
                        metadata._modified = metadata._created;
                        (metadata as any).wi = wi._id;
                        (metadata as any).wiq = wiq.name;
                        (metadata as any).wiqid = wiq._id;
                        (metadata as any).uniquename = NoderedUtil.GetUniqueIdentifier() + "-" + path.basename(file.filename);

                        metadata._acl = wiq._acl;
                        metadata.name = path.basename(file.filename);
                        (metadata as any).filename = file.filename;
                        (metadata as any).path = path.dirname(file.filename);
                        if ((metadata as any).path == ".") (metadata as any).path = "";


                        const fileid = await this._SaveFile(readable, file.filename, mimeType, metadata);
                        wi.files.push({ "name": file.filename, "filename": path.basename(file.filename), _id: fileid });

                    } catch (err) {
                        Logger.instanse.error(msg.error, parent);
                    }
                }
            }
            delete item.files;
            // wi = await Config.db.InsertOne(wi, "workitems", 1, true, jwt, parent);
            additems.push(wi);
        }
        var items = await Config.db.InsertMany(additems, "workitems", 1, true, jwt, parent);

        msg.items = items;


        end = new Date().getTime();
        const seconds = Math.round((end - Config.db.queuemonitoringlastrun.getTime()) / 1000);
        if (seconds > 5 && isRelevant) {
            Config.db.queuemonitoringlastrun = new Date();
            // Config.db.queuemonitoring()
        }
        delete msg.jwt;
        this.data = JSON.stringify(msg);
    }





    async UpdateWorkitem(parent: Span): Promise<void> {
        this.Reply();
        let msg: UpdateWorkitemMessage;
        const rootjwt = Crypt.rootToken();
        const jwt = this.jwt;
        const user: User = this.tuser;

        let retry: boolean = false;

        msg = UpdateWorkitemMessage.assign(this.data);
        if (NoderedUtil.IsNullEmpty(msg._id)) throw new Error("_id is mandatory")

        var wis = await Config.db.query<Workitem>({ query: { "_id": msg._id, "_type": "workitem" }, collectionname: "workitems", jwt }, parent);
        if (wis.length == 0) throw new Error("Work item  with _id " + msg._id + " not found.");
        var wi: Workitem = wis[0];

        var wiq: WorkitemQueue = null;
        if (!NoderedUtil.IsNullEmpty(wi.wiqid)) {
            var queues = await Config.db.query<WorkitemQueue>({ query: { _id: wi.wiqid }, collectionname: "mq", jwt }, parent);
            if (queues.length > 0) wiq = queues[0];
        }
        if (wiq == null && !NoderedUtil.IsNullEmpty(wi.wiq)) {
            var queues = await Config.db.query<WorkitemQueue>({ query: { name: wi.wiq, "_type": "workitemqueue" }, collectionname: "mq", jwt }, parent);
            if (queues.length > 0) wiq = queues[0];
        }
        if (wiq == null) throw new Error("Work item queue not found " + wi.wiq + " (" + wi.wiqid + ") not found.");


        if (!NoderedUtil.IsNullEmpty(msg.failed_wiq) || msg.failed_wiq == "") wi.failed_wiq = msg.failed_wiq;
        if (!NoderedUtil.IsNullEmpty(msg.failed_wiqid) || msg.failed_wiqid == "") wi.failed_wiqid = msg.failed_wiqid;
        if (!NoderedUtil.IsNullEmpty(msg.success_wiq) || msg.success_wiq == "") wi.success_wiq = msg.success_wiq;
        if (!NoderedUtil.IsNullEmpty(msg.success_wiqid) || msg.success_wiqid == "") wi.success_wiqid = msg.success_wiqid;

        wi._acl = wiq._acl;
        if (!DatabaseConnection.hasAuthorization(user, wi, Rights.invoke)) {
            throw new Error("Unknown work item or  " + this.tuser.username + " is missing invoke rights");
        }
        wi.wiq = wiq.name;
        wi.wiqid = wiq._id;
        if (!NoderedUtil.IsNullEmpty(msg.name)) wi.name = msg.name;
        if (!NoderedUtil.IsNullUndefinded(msg.payload)) wi.payload = msg.payload;
        if (typeof wi.payload !== "object") wi.payload = { "value": wi.payload };
        if (!NoderedUtil.IsNullUndefinded(msg.errormessage)) {
            wi.errormessage = msg.errormessage;
            if (!NoderedUtil.IsNullEmpty(msg.errortype)) wi.errortype = msg.errortype;
            if (NoderedUtil.IsNullEmpty(msg.errortype)) wi.errortype = "application";
        }
        if (!NoderedUtil.IsNullUndefinded(msg.errorsource)) wi.errorsource = msg.errorsource;
        if (!NoderedUtil.IsNullEmpty(msg.wipriority)) wi.priority = msg.wipriority; // old api
        // @ts-ignore
        if (!NoderedUtil.IsNullEmpty(msg.priority)) wi.priority = msg.priority; // new api
        if (NoderedUtil.IsNullEmpty(wi.priority)) wi.priority = 2;

        var oldstate = wi.state;
        if (!NoderedUtil.IsNullEmpty(msg.state)) {
            msg.state = msg.state.toLowerCase() as any;
            // if (["failed", "successful", "abandoned", "retry", "processing"].indexOf(msg.state) == -1) {
            //     throw new Error("Illegal state " + msg.state + " on Workitem, must be failed, successful, abandoned, processing or retry");
            // }
            if (msg.state == "new" && wi.state == "new") {
            } else if (["failed", "successful", "retry", "processing"].indexOf(msg.state) == -1) {
                throw new Error("Illegal state " + msg.state + " on Workitem, must be failed, successful, processing or retry");
            }
            if (msg.errortype == "business" && msg.state == "retry" && msg.ignoremaxretries != true) msg.state = "failed";
            // if (msg.errortype == "business" && msg.ignoremaxretries == false) msg.state = "failed";
            if (msg.state == "retry") {
                if (NoderedUtil.IsNullEmpty(wi.retries)) wi.retries = 0;
                if ((wi.retries + 1) < wiq.maxretries || msg.ignoremaxretries) {
                    wi.retries += 1;
                    retry = true;
                    wi.state = "new";
                    wi.userid = null;
                    wi.username = null;
                    wi.nextrun = new Date(new Date().toISOString());
                    wi.nextrun.setSeconds(wi.nextrun.getSeconds() + wiq.retrydelay);
                    if (!NoderedUtil.IsNullEmpty(msg.nextrun)) {
                        // @ts-ignore
                        if(msg.nextrun.seconds && msg.nextrun.nanos) {
                            // @ts-ignore
                            const milliseconds = parseInt(msg.nextrun.seconds) * 1000 + Math.floor(msg.nextrun.nanos / 1000000);
                            const date = new Date(milliseconds);
                            wi.nextrun = date;
                        } else {
                            wi.nextrun = new Date(msg.nextrun);
                        }                        
                    }
                } else {
                    wi.state = "failed";
                }
            } else {
                wi.state = msg.state
            }
            if (oldstate != "processing" && msg.state == "processing") {
                wi.lastrun = new Date(new Date().toISOString());
            }
        }
        if (msg.files) {
            for (var i = 0; i < msg.files.length; i++) {
                var file = msg.files[i];
                if (NoderedUtil.IsNullUndefinded(file.file)) continue;
                var exists = wi.files.filter(x => x.name == file.filename);
                if (exists.length > 0) {
                    try {
                        await Config.db.DeleteOne(exists[0]._id, "fs.files", false, rootjwt, parent);
                    } catch (error) {
                        Logger.instanse.error(msg.error, parent);
                    }
                    wi.files = wi.files.filter(x => x.name != file.filename);
                }
                try {
                    const readable = new Readable();
                    readable._read = () => { }; // _read is required but you can noop it
                    if (file.file && (!file.compressed)) {
                        const buf: Buffer = Buffer.from(file.file, "base64");
                        readable.push(buf);
                        readable.push(null);
                    } else {
                        let result: Buffer;
                        try {
                            var data = Buffer.from(file.file, "base64")
                            result = pako.inflate(data);
                        } catch (error) {
                            Logger.instanse.error(msg.error, parent);
                        }
                        readable.push(result);
                        readable.push(null);
                    }
                    const mimeType = mimetype.lookup(file.filename);
                    const metadata = new Base();
                    metadata._createdby = user.name;
                    metadata._createdbyid = user._id;
                    metadata._created = new Date(new Date().toISOString());
                    metadata._modifiedby = user.name;
                    metadata._modifiedbyid = user._id;
                    metadata._modified = metadata._created;
                    (metadata as any).wi = wi._id;
                    (metadata as any).wiq = wiq.name;
                    (metadata as any).wiqid = wiq._id;
                    (metadata as any).uniquename = NoderedUtil.GetUniqueIdentifier() + "-" + path.basename(file.filename);

                    metadata._acl = wiq._acl;
                    metadata.name = path.basename(file.filename);
                    (metadata as any).filename = file.filename;
                    (metadata as any).path = path.dirname(file.filename);
                    if ((metadata as any).path == ".") (metadata as any).path = "";

                    const fileid = await this._SaveFile(readable, file.filename, mimeType, metadata);
                    wi.files.push({ "name": file.filename, "filename": path.basename(file.filename), _id: fileid });

                } catch (err) {
                    Logger.instanse.error(msg.error, parent);
                }
            }
        }
        delete msg.files;

        if (wi.state != "new") {
            delete wi.nextrun;
        }

        if (retry) {
            try {
                const end: number = new Date().getTime();
                const seconds = Math.round((end - Config.db.queuemonitoringlastrun.getTime()) / 1000);
                try {
                    wi.nextrun = new Date(wi.nextrun)
                } catch (error) {
                    wi.nextrun = new Date(new Date().toISOString());
                }
                const nextrun_seconds = Math.round((end - wi.nextrun.getTime()) / 1000);
                if (seconds > 5 && nextrun_seconds >= 0) {
                    Config.db.queuemonitoringlastrun = new Date();
                    // Config.db.queuemonitoring()
                }
            } catch (error) {
                console.log("Trick queuemonitoringlastrun error " + error.message)
            }
        }
        wi = await Config.db._UpdateOne(null, wi, "workitems", 1, true, rootjwt, parent);
        msg.result = wi;
        if (oldstate != wi.state && (wi.state == "successful" || wi.state == "failed")) {
            var success_wiq = wi.success_wiq || wiq.success_wiq;
            var success_wiqid = wi.success_wiqid || wiq.success_wiqid;
            if (!NoderedUtil.IsNullEmpty(wi.success_wiq)) success_wiqid = wi.success_wiqid;
            if (!NoderedUtil.IsNullEmpty(wi.success_wiqid)) success_wiq = wi.success_wiq;
            var failed_wiq = wi.failed_wiq || wiq.failed_wiq;
            var failed_wiqid = wi.failed_wiqid || wiq.failed_wiqid;
            if (!NoderedUtil.IsNullEmpty(wi.failed_wiq)) failed_wiqid = wi.failed_wiqid;
            if (!NoderedUtil.IsNullEmpty(wi.failed_wiqid)) failed_wiq = wi.failed_wiq;
            if (wi.state == "successful" && (!NoderedUtil.IsNullEmpty(success_wiq) || !NoderedUtil.IsNullEmpty(success_wiqid))) {
                await this.DuplicateWorkitem(wi, success_wiq, success_wiqid, this.jwt, parent);
            }
            if (wi.state == "failed" && (!NoderedUtil.IsNullEmpty(failed_wiq) || !NoderedUtil.IsNullEmpty(failed_wiqid))) {
                await this.DuplicateWorkitem(wi, failed_wiq, failed_wiqid, this.jwt, parent);
            }
        }
        if(msg.result != null) {
            if(msg.result.nextrun == null) delete msg.result.nextrun;
            if(msg.result.lastrun == null) delete msg.result.lastrun;
        }
        delete msg.jwt;
        this.data = JSON.stringify(msg);
    }



    async PopWorkitem(parent: Span): Promise<void> {
        this.Reply();
        let msg: PopWorkitemMessage;
        const rootjwt = Crypt.rootToken();
        const jwt = this.jwt;
        const user: User = this.tuser;

        msg = PopWorkitemMessage.assign(this.data);
        if (NoderedUtil.IsNullEmpty(msg.wiqid) && NoderedUtil.IsNullEmpty(msg.wiq)) throw new Error("wiq or wiqid is mandatory")

        var wiq: Base = null;
        if (!NoderedUtil.IsNullEmpty(msg.wiqid)) {
            var queues = await Config.db.query({ query: { _id: msg.wiqid }, collectionname: "mq", jwt }, parent);
            if (queues.length > 0) wiq = queues[0];
        }
        if (wiq == null && !NoderedUtil.IsNullEmpty(msg.wiq)) {
            var queues = await Config.db.query({ query: { name: msg.wiq, "_type": "workitemqueue" }, collectionname: "mq", jwt }, parent);
            if (queues.length > 0) wiq = queues[0];
        }
        if (wiq == null) throw new Error("Work item queue not found " + msg.wiq + " (" + msg.wiqid + ") not found.");

        let workitems: Workitem[] = null;
        do {
            workitems = await Config.db.query<Workitem>({
                query: { wiqid: wiq._id, "_type": "workitem", state: "new", "nextrun": { "$lte": new Date(new Date().toISOString()) } },
                orderby: { "priority": 1 },
                collectionname: "workitems", jwt, top: 1
            }, parent);
            if (workitems.length > 0) {
                const UpdateDoc: any = { "$set": {}, "$unset": {} };
                let _wi = workitems[0];
                if (!DatabaseConnection.hasAuthorization(this.tuser, _wi, Rights.invoke)) {
                    throw new Error("Access denied popping workitem " + _wi._id + " " + this.tuser.username + " is missing invoke rights)");
                }
                _wi.lastrun = new Date(new Date().toISOString());

                if (NoderedUtil.IsNullEmpty(workitems[0].retries)) UpdateDoc["$set"]["retries"] = 0;
                if (typeof workitems[0].payload !== "object") UpdateDoc["$set"]["payload"] = { "value": workitems[0].payload };
                UpdateDoc["$set"]["state"] = "processing";
                UpdateDoc["$set"]["userid"] = user._id;
                UpdateDoc["$set"]["username"] = user.name;
                UpdateDoc["$set"]["lastrun"] = _wi.lastrun;
                UpdateDoc["$unset"]["nextrun"] = "";
                if (NoderedUtil.IsNullEmpty(workitems[0].priority)) UpdateDoc["$set"]["priority"] = 2;

                var result: any = null;
                try {
                    result = await Config.db._UpdateOne({
                        "_id": workitems[0]._id,
                        "state": workitems[0].state,
                        "userid": workitems[0].userid,
                        "username": workitems[0].username,
                    }, UpdateDoc, "workitems", 1, true, rootjwt, null)

                    if (NoderedUtil.IsNullEmpty(_wi.retries)) _wi.retries = 0;
                    if (typeof _wi.payload !== "object") _wi.payload = { "value": _wi.payload };
                    _wi.state = "processing";
                    _wi.userid = user._id;
                    _wi.username = user.name;
                    _wi.nextrun = null;
                    if (NoderedUtil.IsNullEmpty(_wi.priority)) _wi.priority = 2;

                    msg.result = _wi;
                } catch (error) {
                    Logger.instanse.warn((error.message ? error.message : error), parent);
                }
            }
        } while (workitems.length > 0 && msg.result == null);
        delete msg.jwt;
        if(msg.result != null) {
            if(msg.result.nextrun == null) delete msg.result.nextrun;
            if(msg.result.lastrun == null) delete msg.result.lastrun;
        }
        this.data = JSON.stringify(msg);
    }

    async DeleteWorkitem(parent: Span): Promise<void> {
        this.Reply();
        let msg: DeleteWorkitemMessage;
        const rootjwt = Crypt.rootToken();
        const jwt = this.jwt;
        const user: User = this.tuser;

        msg = DeleteWorkitemMessage.assign(this.data);

        if (NoderedUtil.IsNullEmpty(msg._id)) throw new Error("_id is mandatory")

        var wis = await Config.db.query<Workitem>({ query: { "_id": msg._id, "_type": "workitem" }, collectionname: "workitems", jwt }, parent);
        if (wis.length == 0) throw new Error("Work item  with _id " + msg._id + " not found.");
        var wi: Workitem = wis[0];

        if (!DatabaseConnection.hasAuthorization(user, wi, Rights.invoke)) {
            throw new Error("Unknown work item or  " + this.tuser.username + " is missing invoke rights");
        }
        if (!DatabaseConnection.hasAuthorization(user, wi, Rights.delete)) {
            throw new Error("Unknown work item or access denied");
        }

        var files = await Config.db.query({ query: { "wi": wi._id }, collectionname: "fs.files", jwt:rootjwt }, parent);
        for (var i = 0; i < files.length; i++) {
            await Config.db.DeleteOne(files[i]._id, "fs.files", false, rootjwt, parent);
        }
        var files = await Config.db.query({ query: { "metadata.wi": wi._id }, collectionname: "fs.files", jwt:rootjwt }, parent);
        for (var i = 0; i < files.length; i++) {
            await Config.db.DeleteOne(files[i]._id, "fs.files", false, rootjwt, parent);
        }

        await Config.db.DeleteOne(wi._id, "workitems", false, rootjwt, parent);
        delete msg.jwt;
        this.data = JSON.stringify(msg);
    }

    async AddWorkitemQueue(cli: WebSocketServerClient, parent: Span): Promise<void> {
        let user: User = null;
        this.Reply();
        let msg: AddWorkitemQueueMessage;
        const rootjwt = Crypt.rootToken();
        const jwt = this.jwt;
        msg = AddWorkitemQueueMessage.assign(this.data);


        var skiprole = msg.skiprole;
        // @ts-ignore
        if(this.data.skiprole != null) {
            // @ts-ignore
            skiprole = this.data.skiprole;
        }
        // @ts-ignore
        if(this.data.workitemqueue != null) msg = this.data.workitemqueue;
        if (NoderedUtil.IsNullEmpty(msg.name)) throw new Error("Name is mandatory")
        if (NoderedUtil.IsNullEmpty(msg.maxretries)) throw new Error("maxretries is mandatory")
        if (NoderedUtil.IsNullEmpty(msg.retrydelay)) throw new Error("retrydelay is mandatory")
        if (NoderedUtil.IsNullEmpty(msg.initialdelay)) throw new Error("initialdelay is mandatory")

        var queues = await Config.db.query({ query: { name: msg.name, "_type": "workitemqueue" }, collectionname: "mq", jwt: rootjwt }, parent);
        if (queues.length > 0) {
            throw new Error("Work item queue with name " + msg.name + " already exists");
        }
        user = this.tuser;

        var wiq = new WorkitemQueue(); wiq._type = "workitemqueue";
        const workitem_queue_admins: Role = await Logger.DBHelper.EnsureRole(jwt, "workitem queue admins", "625440c4231309af5f2052cd", parent);
        if (!skiprole) {
            const wiqusers: Role = await Logger.DBHelper.EnsureRole(jwt, msg.name + " users", null, parent);
            Base.addRight(wiqusers, WellknownIds.admins, "admins", [Rights.full_control]);
            Base.addRight(wiqusers, user._id, user.name, [Rights.full_control]);
            // Base.removeRight(wiqusers, user._id, [Rights.delete]);
            wiqusers.AddMember(user as any);
            wiqusers.AddMember(workitem_queue_admins);
            await Logger.DBHelper.Save(wiqusers, rootjwt, parent);
            Base.addRight(wiq, wiqusers._id, wiqusers.name, [Rights.full_control]);
            wiq.usersrole = wiqusers._id;
        } else {
            Base.addRight(wiq, workitem_queue_admins._id, workitem_queue_admins.name, [Rights.full_control]);
        }

        if (NoderedUtil.IsNullEmpty(msg.workflowid)) msg.workflowid = undefined;
        wiq.name = msg.name;
        wiq.workflowid = msg.workflowid;
        wiq.robotqueue = msg.robotqueue;
        wiq.projectid = msg.projectid;
        wiq.amqpqueue = msg.amqpqueue;
        wiq.maxretries = msg.maxretries;
        if(msg._acl != null) {
            // @ts-ignore
            wiq._acl = JSON.parse(JSON.stringify(msg._acl));
        }        
        if(wiq.maxretries < 1) wiq.maxretries = 3;
        wiq.retrydelay = msg.retrydelay;
        wiq.initialdelay = msg.initialdelay;
        wiq.failed_wiq = msg.failed_wiq;
        wiq.failed_wiqid = msg.failed_wiqid;
        wiq.success_wiq = msg.success_wiq;
        wiq.success_wiqid = msg.success_wiqid;
        // @ts-ignore
        wiq.packageid = msg.packageid;
        msg = JSON.parse(JSON.stringify(msg));
        msg.result = await Config.db.InsertOne(wiq, "mq", 1, true, jwt, parent);

        if (!NoderedUtil.IsNullUndefinded(cli)) await this.ReloadUserToken(cli, parent);
        delete msg.jwt;
        this.data = JSON.stringify(msg);
    }
    async GetWorkitemQueue(parent: Span): Promise<void> {
        this.Reply();
        let msg: GetWorkitemQueueMessage;
        const rootjwt = Crypt.rootToken();
        const jwt = this.jwt;
        msg = GetWorkitemQueueMessage.assign(this.data);
        if (NoderedUtil.IsNullEmpty(msg.name) && NoderedUtil.IsNullEmpty(msg._id)) throw new Error("Name or _id is mandatory")

        var wiq: WorkitemQueue = null;
        if (!NoderedUtil.IsNullEmpty(msg._id)) {
            var queues = await Config.db.query<WorkitemQueue>({ query: { _id: msg._id }, collectionname: "mq", jwt }, parent);
            if (queues.length > 0) wiq = queues[0];
        } else {
            var queues = await Config.db.query<WorkitemQueue>({ query: { name: msg.name, "_type": "workitemqueue" }, collectionname: "mq", jwt }, parent);
            if (queues.length > 0) wiq = queues[0];
        }
        msg.result = wiq;
        delete msg.jwt;
        this.data = JSON.stringify(msg);
    }

    async UpdateWorkitemQueue(parent: Span): Promise<void> {
        let user: User = null;
        this.Reply();
        let msg: UpdateWorkitemQueueMessage;
        const jwt = this.jwt;
        msg = UpdateWorkitemQueueMessage.assign(this.data);
        // @ts-ignore
        if(this.data.workitemqueue != null) {
            // @ts-ignore
            msg = this.data.workitemqueue;
            // @ts-ignore
            msg.purge = this.data.purge;
        }

        if (NoderedUtil.IsNullEmpty(msg.name) && NoderedUtil.IsNullEmpty(msg._id)) throw new Error("Name or _id is mandatory")

        var wiq = new WorkitemQueue();
        if (!NoderedUtil.IsNullEmpty(msg._id)) {
            var queues = await Config.db.query<WorkitemQueue>({ query: { _id: msg._id }, collectionname: "mq", jwt }, parent);
            if (queues.length == 0) throw new Error("Work item queue with _id " + msg._id + " not found.");
            wiq = queues[0];
        } else {
            var queues = await Config.db.query<WorkitemQueue>({ query: { name: msg.name, "_type": "workitemqueue" }, collectionname: "mq", jwt }, parent);
            if (queues.length == 0) throw new Error("Work item queue with name " + msg.name + " not found.");
            wiq = queues[0];
        }
        user = this.tuser;

        if (NoderedUtil.IsNullEmpty(msg.workflowid)) msg.workflowid = undefined;
        wiq.name = msg.name;
        wiq.workflowid = msg.workflowid;
        wiq.robotqueue = msg.robotqueue;
        wiq.projectid = msg.projectid;
        wiq.amqpqueue = msg.amqpqueue;
        if (!NoderedUtil.IsNullEmpty(msg.maxretries)) wiq.maxretries = msg.maxretries;
        if (!NoderedUtil.IsNullEmpty(msg.retrydelay)) wiq.retrydelay = msg.retrydelay;
        if (!NoderedUtil.IsNullEmpty(msg.initialdelay)) wiq.initialdelay = msg.initialdelay;
        if (!NoderedUtil.IsNullEmpty(msg.failed_wiq) || msg.failed_wiq == "") wiq.failed_wiq = msg.failed_wiq;
        if (msg.failed_wiq === null) { delete wiq.failed_wiq; delete wiq.failed_wiqid; }
        if (!NoderedUtil.IsNullEmpty(msg.failed_wiqid) || msg.failed_wiqid == "") wiq.failed_wiqid = msg.failed_wiqid;
        if (!NoderedUtil.IsNullEmpty(msg.success_wiq) || msg.success_wiq == "") wiq.success_wiq = msg.success_wiq;
        if (!NoderedUtil.IsNullEmpty(msg.success_wiqid) || msg.success_wiqid == "") wiq.success_wiqid = msg.success_wiqid;
        if (msg.success_wiq === null) { delete wiq.success_wiq; delete wiq.success_wiqid; }
        // @ts-ignore
        if (!NoderedUtil.IsNullEmpty(msg.packageid) || msg.packageid == "") wiq.packageid = msg.packageid;


        if (msg._acl) wiq._acl = msg._acl;
        msg = JSON.parse(JSON.stringify(msg));

        msg.result = await Config.db._UpdateOne(null, wiq as any, "mq", 1, true, jwt, parent);

        if (msg.purge) {
            await Audit.AuditWorkitemPurge(this.tuser, wiq, parent);
            await Config.db.DeleteMany({ "_type": "workitem", "wiqid": wiq._id }, null, "workitems", null, false, jwt, parent);
            var items = await Config.db.query<WorkitemQueue>({ query: { "_type": "workitem", "wiqid": wiq._id }, collectionname: "workitems", top: 1, jwt }, parent);
            if (items.length > 0) {
            }
            items = await Config.db.query<WorkitemQueue>({ query: { "_type": "workitem", "wiqid": wiq._id }, collectionname: "workitems", top: 1, jwt }, parent);
            if (items.length > 0) {
                throw new Error("Failed purging workitemqueue " + wiq.name);
            }
            await Config.db.DeleteMany({ "metadata.wiqid": wiq._id }, null, "fs.files", null, false, jwt, parent);
        }
        delete msg.jwt;
        this.data = JSON.stringify(msg);
    }
    async DeleteWorkitemQueue(parent: Span): Promise<void> {
        let user: User = null;
        this.Reply();
        let msg: DeleteWorkitemQueueMessage;
        const jwt = this.jwt;
        msg = DeleteWorkitemQueueMessage.assign(this.data);
        // @ts-ignore
        if (!NoderedUtil.IsNullEmpty(msg.wiq)) msg.name = msg.wiq;
        // @ts-ignore
        if (!NoderedUtil.IsNullEmpty(msg.wiqid)) msg._id = msg.wiqid;
        if (NoderedUtil.IsNullEmpty(msg.name) && NoderedUtil.IsNullEmpty(msg._id)) throw new Error("Name or _id is mandatory")

        var wiq = new WorkitemQueue();
        if (!NoderedUtil.IsNullEmpty(msg._id)) {
            var queues = await Config.db.query<WorkitemQueue>({ query: { _id: msg._id }, collectionname: "mq", jwt }, parent);
            if (queues.length == 0) throw new Error("Work item queue with _id " + msg._id + " not found.");
            wiq = queues[0];
        } else {
            var queues = await Config.db.query<WorkitemQueue>({ query: { name: msg.name, "_type": "workitemqueue" }, collectionname: "mq", jwt }, parent);
            if (queues.length == 0) throw new Error("Work item queue with name " + msg.name + " not found.");
            wiq = queues[0];
        }
        user = this.tuser;

        if (msg.purge) {
            await Audit.AuditWorkitemPurge(this.tuser, wiq, parent);
            await Config.db.DeleteMany({ "_type": "workitem", "wiqid": wiq._id }, null, "workitems", null, false, jwt, parent);
            var items = await Config.db.query<WorkitemQueue>({ query: { "_type": "workitem", "wiqid": wiq._id }, collectionname: "workitems", top: 1, jwt }, parent);
            if (items.length > 0) {
                items = await Config.db.query<WorkitemQueue>({ query: { "_type": "workitem", "wiqid": wiq._id }, collectionname: "workitems", top: 1, jwt }, parent);
            }
            if (items.length > 0) {
                throw new Error("Failed purging workitemqueue " + wiq.name);
            }
            await Config.db.DeleteMany({ "metadata.wiqid": wiq._id }, null, "fs.files", null, false, jwt, parent);
        } else {
            var items = await Config.db.query<WorkitemQueue>({ query: { "_type": "workitem", "wiqid": wiq._id }, collectionname: "workitems", top: 1, jwt }, parent);
            if (items.length > 0) {
                throw new Error("Work item queue " + wiq.name + " is not empty, enable purge to delete");
            }
        }

        await Config.db.DeleteOne(wiq._id, "mq", false, jwt, parent);
        if (wiq.usersrole) {
            await Config.db.DeleteOne(wiq.usersrole, "users", false, jwt, parent);
        }
        delete msg.jwt;
        this.data = JSON.stringify(msg);
    }
    async CustomCommand(cli: WebSocketServerClient, parent: Span): Promise<void> {
        this.Reply();
        let msg: CustomCommandMessage;
        const rootjwt = Crypt.rootToken();
        const jwt = this.jwt;

        msg = CustomCommandMessage.assign(this.data);
        switch (msg.command) {
            case "getclients":
                msg.result = WebSocketServer.getclients(this.tuser);
                break;
            case "dumpwebsocketclients":
                if (!this.tuser.HasRoleId(WellknownIds.admins)) throw new Error("Access denied");
                await Config.db.DeleteMany({ "_type": "websocketclient" }, null, "websocketclients", null, false, jwt, parent);
                if (Config.enable_openflow_amqp) {
                    amqpwrapper.Instance().send("openflow", "", { "command": "dumpwebsocketclients" }, 10000, null, "", parent, 1);
                } else {
                    WebSocketServer.DumpClients(parent);
                }
                break;
            case "killwebsocketclient":
                if (!this.tuser.HasRoleId(WellknownIds.admins)) throw new Error("Access denied");
                if (Config.enable_openflow_amqp) {
                    amqpwrapper.Instance().send("openflow", "", { "command": "killwebsocketclient", "id": msg.id }, 10000, null, "", parent, 1);
                } else {
                    for (let i = WebSocketServer._clients.length - 1; i >= 0; i--) {
                        const cli: WebSocketServerClient = WebSocketServer._clients[i];
                        if (cli.id == msg.id) {
                            Logger.instanse.warn("Killing websocket client " + msg.id, parent);
                            cli.Close(parent);
                        }
                    }
                }
                break;
            case "clearcache":
                if (!this.tuser.HasRoleId(WellknownIds.admins)) throw new Error("Access denied");
                Logger.DBHelper.clearCache("user requested clear cache", parent);
                break;
            case "heapdump":
                if (!this.tuser.HasRoleId(WellknownIds.admins)) throw new Error("Access denied");
                if (Config.enable_openflow_amqp) {
                    amqpwrapper.Instance().send("openflow", "", { "command": "heapdump" }, 10000, null, "", parent, 1);
                } else {
                    Logger.otel.createheapdump(parent);
                }
                break;
            case "shutdown":
                if (!this.tuser.HasRoleId(WellknownIds.admins)) throw new Error("Access denied");
                if (Config.enable_openflow_amqp) {
                    amqpwrapper.Instance().send("openflow", "", { "command": "shutdown" }, 10000, null, "", parent, 1);
                } else {
                    // Force exit after 5 seconds
                    setTimeout(() => {
                        process.exit(0);
                    }, 5000);
                    // clean shutdown
                    await Config.db.shutdown();
                    await Logger.otel.shutdown();
                    await Logger.License.shutdown()
                    process.exit(0);
                }
                break;
            case "webpushmessage":
                // @ts-ignore
                var data = msg.data;
                var host = data.host;
                var _type = data._type;
                var wpuser = await Config.db.GetOne<User>({ query: { _id: msg.id }, collectionname: "users", jwt }, parent);
                if (wpuser == null) break;
                var query: any = { userid: msg.id }
                if (!NoderedUtil.IsNullEmpty(host)) query.host = host;
                if (!NoderedUtil.IsNullEmpty(_type)) query._type = _type;
                // var subscription = await Config.db.GetOne<User>({ query, collectionname: "webpushsubscriptions", jwt: rootjwt }, parent);
                var subscriptions = await Config.db.query<User>({ query, collectionname: "webpushsubscriptions", jwt: rootjwt }, parent);
                if (subscriptions == null || subscriptions.length == 0) break;
                const payload = JSON.stringify(data);
                for (var i = 0; i < subscriptions.length; i++) {
                    var subscription = subscriptions[i];
                    webpush.sendNotification(subscription, payload)
                        .then(() => Logger.instanse.info("send wep push message to " + wpuser.name + " with payload " + payload, parent))
                        .catch(err => Logger.instanse.error(err, parent));
                }
                break;
            case "startagent":
                if (Logger.agentdriver == null) throw new Error("No agentdriver is loaded")
                var agent = await Config.db.GetOne<iAgent>({ query: { _id: msg.id }, collectionname: "agents", jwt }, parent);
                if(agent == null) throw new Error("Access denied");

                if (!DatabaseConnection.hasAuthorization(this.tuser, agent, Rights.invoke)) {
                    throw new Error(`[${this.tuser.name}] Access denied, missing invoke permission on ${agent.name}`);
                }
                if(agent.image == null || agent.image == "") break;
                await Logger.agentdriver.EnsureInstance(this.tuser, this.jwt, agent, parent);
                break;
            case "stopagent":
                if (Logger.agentdriver == null) throw new Error("No agentdriver is loaded")
                var agent = await Config.db.GetOne<iAgent>({ query: { _id: msg.id }, collectionname: "agents", jwt }, parent);
                if(agent == null) throw new Error("Access denied");
                if (!DatabaseConnection.hasAuthorization(this.tuser, agent, Rights.invoke)) {
                    throw new Error(`[${this.tuser.name}] Access denied, missing invoke permission on ${agent.name}`);
                }
                await Logger.agentdriver.RemoveInstance(this.tuser, this.jwt, agent, false, parent);
                break;
            case "deleteagentpod":
                if (Logger.agentdriver == null) throw new Error("No agentdriver is loaded")
                var agent = await Config.db.GetOne<iAgent>({ query: { _id: msg.id }, collectionname: "agents", jwt }, parent);
                if(agent == null) throw new Error("Access denied");
                if (!DatabaseConnection.hasAuthorization(this.tuser, agent, Rights.invoke)) {
                    throw new Error(`[${this.tuser.name}] Access denied, missing invoke permission on ${agent.name}`);
                }
                await Logger.agentdriver.RemoveInstancePod(this.tuser, this.jwt, agent, msg.name, parent);
                break;
            case "getagentlog":
                if (Logger.agentdriver == null) throw new Error("No agentdriver is loaded")
                var agent = await Config.db.GetOne<iAgent>({ query: { _id: msg.id }, collectionname: "agents", jwt }, parent);
                if(agent == null) throw new Error("Access denied");
                if (!DatabaseConnection.hasAuthorization(this.tuser, agent, Rights.invoke)) {
                    throw new Error(`[${this.tuser.name}] Access denied, missing invoke permission on ${agent.name}`);
                }
                msg.result = await Logger.agentdriver.GetInstanceLog(this.tuser, this.jwt, agent, msg.name, parent);
                break;
            case "getagentpods":
                if (Logger.agentdriver == null) throw new Error("No agentdriver is loaded")
                var agent: iAgent = null;
                if(!NoderedUtil.IsNullEmpty(msg.id)) {
                    var agent = await Config.db.GetOne<iAgent>({ query: { _id: msg.id }, collectionname: "agents", jwt }, parent);
                    if(agent == null) throw new Error("Access denied");
                }
                var getstats = false;
                if(!NoderedUtil.IsNullEmpty(msg.name)) getstats = true;                
                msg.result = await Logger.agentdriver.GetInstancePods(this.tuser, this.jwt, agent, getstats, parent);
                break;
            case "deleteagent":
                if (Logger.agentdriver == null) throw new Error("No agentdriver is loaded")
                var agent = await Config.db.GetOne<iAgent>({ query: { _id: msg.id }, collectionname: "agents", jwt }, parent);
                if(agent == null) throw new Error("Access denied");
                if (!DatabaseConnection.hasAuthorization(this.tuser, agent, Rights.delete)) {
                    throw new Error(`[${this.tuser.name}] Access denied, missing delete permission on ${agent.name}`);
                }
                await Logger.agentdriver.RemoveInstance(this.tuser, this.jwt, agent, true, parent);
                Config.db.DeleteOne(agent._id, "agents", false, jwt, parent);
                break;
            case "registeragent":
                // @ts-ignore
                var data = msg.data
                if(data == null || data == "") throw new Error("No data found");
                try {
                    data = JSON.parse(data);
                } catch (error) {
                    
                }
                var agent:iAgent = data as any;
                if(msg.id != null && msg.id != "") agent._id =  msg.id;
                if(agent.slug == null || agent.slug == "") agent.slug = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
                agent._type = "agent";
                agent.lastseen = new Date(new Date().toISOString());
                if(agent._id == null || agent._id == "") {
                    var _agent = await Config.db.GetOne<iAgent>({ query: { hostname: agent.hostname, username: agent.username }, collectionname: "agents", jwt }, parent);
                    if(_agent != null) {
                        agent._id = _agent._id;
                        agent.name = _agent.name;
                    }
                }
                if(agent._id != null && agent._id != "") {
                    var _agent = await Config.db.GetOne<iAgent>({ query: { _id: agent._id }, collectionname: "agents", jwt }, parent);
                    if(_agent == null) {
                        if(agent.name == null || agent.name == "") agent.name = agent.hostname + " / " + agent.username;

                        _agent = await Config.db.GetOne<iAgent>({ query: { hostname: agent.hostname, username: agent.username }, collectionname: "agents", jwt }, parent);
                        if(_agent == null) {
                            _agent = await Config.db.InsertOne<iAgent>(agent, "agents", 1, true, jwt, parent);
                        }
                    }
                    _agent.lastseen = new Date(new Date().toISOString());
                    if(agent.hostname != null && agent.hostname != "") _agent.hostname = agent.hostname;
                    if(agent.os != null && agent.os != "") _agent.os = agent.os;
                    if(agent.arch != null && agent.arch != "") _agent.arch = agent.arch;
                    if(agent.username != null && agent.username != "") _agent.username = agent.username;
                    if(agent.version != null && agent.version != "") _agent.version = agent.version;
                    if(!NoderedUtil.IsNullEmpty(agent.chrome)) _agent.chrome = agent.chrome;
                    if(!NoderedUtil.IsNullEmpty(agent.chromium)) _agent.chromium = agent.chromium;
                    if(!NoderedUtil.IsNullEmpty(agent.docker)) _agent.docker = agent.docker;
                    if(!NoderedUtil.IsNullEmpty(agent.assistant)) _agent.assistant = agent.assistant;
                    if(!NoderedUtil.IsNullEmpty(agent.daemon)) _agent.daemon = agent.daemon;
                    if(!NoderedUtil.IsNullEmpty(agent.languages) && Array.isArray(agent.languages)) _agent.languages = agent.languages;

                    var agentuser = this.tuser;
                    if (_agent.runas != null && _agent.runas != "" && this.tuser._id != _agent.runas) {
                        agentuser = await Config.db.GetOne<any>({ query: { _id: _agent.runas }, collectionname: "users", jwt }, parent);
                        if(agentuser == null) throw new Error(`[${this.tuser.name}] Access denied to runas user ${_agent.runas}`);
                    }
                    if (agentuser != null && agentuser._id != null && this.tuser._id != agentuser._id) {
                        if (!DatabaseConnection.hasAuthorization(this.tuser, agentuser as any, Rights.invoke)) {
                            throw new Error(`[${this.tuser.name}] Access denied, missing invoke permission on ${agentuser.name}`);
                        }
                    }
                    // @ts-ignore
                    delete _agent.jwt;

                    if(_agent.name == null || _agent.name == "") _agent.name = _agent.hostname + " / " + _agent.username;
                    _agent.runas = agentuser._id
                    _agent.runasname = agentuser.name

                    // if(this.clientagent == "assistant") {
                    //     _agent.assistant = true;
                    // }
                    // if(this.clientagent == "nodeagent") {
                    //     _agent.daemon = true;
                    // }

                    agent = await Config.db._UpdateOne(null, _agent, "agents", 1, true, jwt, parent);
                } else {
                    if(agent.name == null || agent.name == "") agent.name = agent.hostname + " / " + agent.username;

                    var agentuser = this.tuser;
                    if (agent.runas != null && agent.runas != "" && this.tuser._id != agent.runas) {
                        agentuser = await Config.db.GetOne<any>({ query: { _id: agent.runas }, collectionname: "users", jwt }, parent);
                        if(agentuser == null) throw new Error(`[${this.tuser.name}] Access denied to runas user ${agent.runas}`);
                    }
                    if (agentuser != null && agentuser._id != null && this.tuser._id != agentuser._id) {
                        if (!DatabaseConnection.hasAuthorization(this.tuser, agentuser as any, Rights.invoke)) {
                            throw new Error(`[${this.tuser.name}] Access denied, missing invoke permission on ${agentuser.name}`);
                        }
                    }
                    // @ts-ignore
                    delete agent.jwt;

                    agent.runas = agentuser._id
                    agent.runasname = agentuser.name
                    agent = await Config.db.InsertOne<iAgent>(agent, "agents", 1, true, jwt, parent);
                }
                if (agentuser != null && agentuser._id != null && this.tuser._id != agentuser._id) {
                    // @ts-ignore
                    agent.jwt = await Auth.User2Token(agentuser, Config.personalnoderedtoken_expires_in);;
                }

                msg.result = agent
                break;
            case "deletepackage":
                var pack = await Config.db.GetOne<any>({ query: { _id: msg.id, "_type": "package" }, collectionname: "agents", jwt }, parent);
                if(pack == null) throw new Error("Access denied or package not found");
                if (!DatabaseConnection.hasAuthorization(this.tuser, pack, Rights.delete)) {
                    throw new Error(`[${this.tuser.name}] Access denied, missing delete permission on ${pack.name}`);
                }
                if(pack.fileid != null && pack.fileid != "") {
                    const rootjwt = Crypt.rootToken();
                    let query = { _id: pack.fileid };
                    const item = await Config.db.GetOne<any>({ query, collectionname: "fs.files", jwt: rootjwt }, parent);
                    if(item != null) {
                        await Config.db.DeleteOne(pack.fileid, "files", false, jwt, parent);
                    }
                }
                await Config.db.DeleteOne(pack._id, "agents", false, jwt, parent);
                break;
            case "createindex":
                if (!this.tuser.HasRoleId(WellknownIds.admins)) throw new Error("Access denied");
                // @ts-ignore
                var data = JSON.parse(msg.data);
                var name = msg.name || data.name;
                msg.result = await Config.db.createIndex(data.collection || data.collectionname, name, data.index, data.options, parent);
                break;
            case "issuelicense":
                let _lic_require: any = null;
                try {
                    // @ts-ignore
                    _lic_require = await import("../ee/license-file.js");
                    Logger.License = new _lic_require.LicenseFile();
                } catch (error) {
                }
                if (_lic_require == null) {
                    throw new Error("License module not found");
                }
                Logger.License = new _lic_require.LicenseFile();
                // @ts-ignore
                var data = msg.data;
                try {
                    data = JSON.parse(data);
                } catch (error) {                    
                }
                if(data == null || data == "") throw new Error("No data found");
                var domain = data.domain;
                if (!this.tuser.HasRoleId(WellknownIds.admins)) {
                    delete data.months;
                }
                var exists = await Config.db.GetOne<any>({ query: { domains: domain, "_type": "resourceusage"}, collectionname: "config", jwt }, parent);
                if (!this.tuser.HasRoleId(WellknownIds.admins)) {
                    if(exists == null) throw new Error("Access denied");
                }
                if(data.months == null || data.months == "") {
                    if(exists != null && exists.issuemonths != null) data.months = parseInt(exists.issuemonths);
                }
                //  throw new Error("Access denied");
                msg.result = await Logger.License.generate2(data, cli?.remoteip, this.tuser, parent);
                break;
            case "snapshotcreate":
                // @ts-ignore
                var data = JSON.parse(msg.data);
                var repo = await GitProxy.GetRepo(data.repo);
                if(repo == null) throw new Error("Repo not found");
                var branches = await repo.getRefs();
                var branchref = "";
                for(var i = 0; i < branches.length; i++) {
                    if(branches[i].ref == data.branch || branches[i].ref == "refs/heads/" + data.branch || branches[i].ref == "refs/tags/" + data.branch) {
                        branchref = branches[i].ref;
                    }
                }
                if(branchref == "") branchref = await repo.getHeadRef();
                // var arr = await repo.repocollection.find({ repo: repo.repoName, ref: branchref, _type: "hash" }).toArray()
                var arr = await repo.repocollection.find({ repo: repo.repoName, ref: "HEAD", _type: "hash" }).toArray() // for now, lets just check HEAD
                if (arr != null && arr.length > 0) {
                  const main = arr[0];
                  if (!DatabaseConnection.hasAuthorization(this.tuser, main as any, Rights.update)) {
                    Logger.instanse.debug(`"Access denied to ${repo.repoName} (for ${this.tuser.name})`, parent, { cls: "GitProxy" });
                    branchref = ""
                    throw new Error(`"Access denied to ${repo.repoName} (for ${this.tuser.name})`);
                  }
                } else {
                    branchref = ""
                }
                if(branchref == "" || branchref == null) throw new Error("Branch not found");
                msg.result = await GitProxy.snapshot(repo, this.tuser, branchref, this.jwt, parent);
                break;
            case "snapshotrestore":
                // @ts-ignore
                var data = JSON.parse(msg.data);
                var repo = await GitProxy.GetRepo(data.repo);
                if(repo == null) throw new Error("Repo not found");
                let tree = "";
                if(data.tree != null && data.tree != "") {
                    tree = data.tree;
                }
                if(data.commit != null && data.commit != "") {
                    tree = data.commit;
                }
                if(tree == "") {
                    var branches = await repo.getRefs();
                    var branchref = "";
                    for(var i = 0; i < branches.length; i++) {
                        if(branches[i].ref == data.branch || branches[i].ref == "refs/heads/" + data.branch || branches[i].ref == "refs/tags/" + data.branch) {
                            branchref = branches[i].ref;
                        }
                    }
                    if(branchref == "") branchref = await repo.getHeadRef();
                    // var arr = await repo.repocollection.find({ repo: repo.repoName, ref: branchref, _type: "hash" }).toArray()
                    var arr = await repo.repocollection.find({ repo: repo.repoName, ref: "HEAD", _type: "hash" }).toArray() // for now, lets just check HEAD
                    if (arr != null && arr.length > 0) {
                      const main = arr[0];
                      if (!DatabaseConnection.hasAuthorization(this.tuser, main as any, Rights.read)) {
                        Logger.instanse.debug(`"Access denied to ${repo.repoName} (for ${this.tuser.name})`, parent, { cls: "GitProxy" });
                        branchref = ""
                        throw new Error(`"Access denied to ${repo.repoName} (for ${this.tuser.name})`);
                      }
                    } else {
                        branchref = ""
                    }
                    if(branchref == "" || branchref == null) throw new Error("Branch not found");
                    const b = branches.find(x => x.ref == branchref);
                    tree = b.sha;
                }
                msg.result = await GitProxy.restoresnapshot(repo, this.tuser, tree, this.jwt);
                break;
            default:
                msg.error = "Unknown custom command";
        }
        delete msg.jwt;
        this.data = JSON.stringify(msg);
    }
}

export class JSONfn {
    public static stringify(obj) {
        return JSON.stringify(obj, function (key, value) {
            return (typeof value === "function") ? value.toString() : value;
        });
    }
}
export declare class DistinctMessage {
    error: string;
    jwt: string;
    query: any;
    field: string;
    collectionname: string;
    results: any[];
    queryas: string;
}
