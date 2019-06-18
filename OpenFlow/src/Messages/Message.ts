import * as crypto from "crypto";
import { SocketMessage } from "../SocketMessage";
import { WebSocketClient, QueuedMessage } from "../WebSocketClient";
import { QueryMessage } from "./QueryMessage";
import { Base, Rights } from "../base";
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
                        //if (qmsg.cb !== undefined && qmsg.cb !== null) { qmsg.cb(qmsg.message); }
                        if (qmsg.cb !== undefined && qmsg.cb !== null) { qmsg.cb(this); }
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
                case "startnoderedinstance":
                    this.StartNoderedInstance(cli);
                    break;
                case "stopnoderedinstance":
                    this.StopNoderedInstance(cli);
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
        var msg: QueueMessage = QueueMessage.assign(this.data);
        try {
            //
            if (msg.replyto === null || msg.replyto === undefined || msg.replyto === "") {
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
            msg.error = error.toString();
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            msg.error = error.toString();
        }
        this.Send(cli);
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
            var w: number = 0;
            var j: boolean = false;
            if ((msg.w as any) !== undefined && (msg.w as any) !== null) w = msg.w;
            if ((msg.j as any) !== undefined && (msg.j as any) !== null) j = msg.j;

            if (msg.jwt != null && msg.jwt != undefined) { jwt = msg.jwt; }
            msg.result = await Config.db.InsertOne(msg.item, msg.collectionname, w, j, jwt);
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
            if (msg.jwt === null || msg.jwt === undefined) { msg.jwt = cli.jwt; }
            if ((msg.w as any) === undefined || (msg.w as any) === null) msg.w = 0;
            if ((msg.j as any) === undefined || (msg.j as any) === null) msg.j = false;
            msg = await Config.db.UpdateOne(msg);
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
    private async UpdateMany(cli: WebSocketClient): Promise<void> {
        this.Reply();
        var msg: UpdateManyMessage<Base> = UpdateManyMessage.assign(this.data);
        try {
            if (msg.jwt === null || msg.jwt === undefined) { msg.jwt = cli.jwt; }
            if ((msg.w as any) === undefined || (msg.w as any) === null) msg.w = 0;
            if ((msg.j as any) === undefined || (msg.j as any) === null) msg.j = false;
            msg = await Config.db.UpdateMany(msg);
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
            if (msg.jwt === null || msg.jwt === undefined) { msg.jwt = cli.jwt; }
            if ((msg.w as any) === undefined || (msg.w as any) === null) msg.w = 0;
            if ((msg.j as any) === undefined || (msg.j as any) === null) msg.j = false;
            msg = await Config.db.InsertOrUpdateOne(msg);
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
            //cli._logger.error(JSON.stringify(error));
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
                } else { // Autocreate user .... safe ?? we use this for autocreating nodered service accounts
                    user = new User(); user.name = tuser.name; user.username = tuser.username;
                    await user.Save(TokenUser.rootToken());
                    tuser = new TokenUser(user);
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
                Audit.LoginSuccess(tuser, type, "websocket", cli.remoteip);
                msg.jwt = Crypt.createToken(user);
                msg.user = tuser;
                if (msg.validate_only !== true) {
                    cli._logger.debug(tuser.username + " signed in using " + type);
                    cli.jwt = msg.jwt;
                    cli.user = user;
                } else {
                    cli._logger.debug(tuser.username + " was validated in using " + type);
                }
                user.lastseen = new Date(new Date().toISOString());
                await user.Save(TokenUser.rootToken());
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

    private async EnsureNoderedInstance(cli: WebSocketClient): Promise<void> {
        this.Reply();
        var msg: EnsureNoderedInstanceMessage;
        var user: User;
        try {
            msg = EnsureNoderedInstanceMessage.assign(this.data);
            var name = cli.user.username;
            if (msg.name !== null && msg.name !== undefined && msg.name !== "" && msg.name != cli.user.username) {
                var exists = User.FindByUsername(msg.name, cli.jwt);
                if (exists == null) { throw new Error("Unknown name " + msg.name) }
                name = msg.name;
            }
            name = name.replace(new RegExp("@", 'g'), "_").replace(new RegExp(".", 'g'), "_");
            var namespace = Config.namespace;
            var hostname = Config.nodered_domain_schema.replace("$nodered_id$", name);

            // var noderedusers = await User.ensureRole(cli.jwt, name + "noderedusers", null);
            // noderedusers.addRight(cli.user._id, cli.user.username, [Rights.full_control]);
            // noderedusers.removeRight(cli.user._id, [Rights.delete]);
            // noderedusers.AddMember(cli.user);
            // var nodereduser: User = await User.ensureUser(cli.jwt, "nodered" + name, "nodered" + name, null);
            // nodereduser.addRight(cli.user._id, cli.user.username, [Rights.full_control]);
            // nodereduser.removeRight(cli.user._id, [Rights.delete]);
            // await nodereduser.Save(cli.jwt);

            var noderedadmins = await User.ensureRole(cli.jwt, name + "noderedadmins", null);
            noderedadmins.addRight(cli.user._id, cli.user.username, [Rights.full_control]);
            noderedadmins.removeRight(cli.user._id, [Rights.delete]);
            noderedadmins.AddMember(cli.user);
            // noderedadmins.addRight(nodereduser._id, nodereduser.username, [Rights.full_control]);
            // noderedadmins.removeRight(nodereduser._id, [Rights.delete]);
            // noderedadmins.AddMember(nodereduser);
            await noderedadmins.Save(cli.jwt);

            var deployment = await KubeUtil.instance().GetDeployment(namespace, name);
            if (deployment == null) {
                console.log("Deployment " + name + " not found in " + namespace);
                var _deployment = {
                    metadata: { name: name, namespace: namespace, app: (name + "nodered") },
                    spec: {
                        replicas: 1,
                        template: {
                            metadata: { labels: { name: name, app: (name + "nodered") } },
                            spec: {
                                containers: [
                                    {
                                        name: 'nodered',
                                        image: 'cloudhack/openflownodered:0.0.218',
                                        imagePullPolicy: "Always",
                                        env: [
                                            { name: "saml_federation_metadata", value: Config.saml_federation_metadata },
                                            { name: "saml_issuer", value: Config.saml_issuer },
                                            { name: "nodered_id", value: name },
                                            { name: "nodered_sa", value: name },
                                            { name: "api_ws_url", value: Config.api_ws_url },
                                            { name: "amqp_url", value: Config.amqp_url },
                                            { name: "nodered_domain_schema", value: hostname },
                                            { name: "protocol", value: Config.protocol },
                                            { name: "port", value: Config.port.toString() },
                                            { name: "aes_secret", value: Config.aes_secret },
                                            { name: "noderedusers", value: (name + "noderedusers") },
                                            { name: "noderedadmins", value: (name + "noderedadmins") },
                                        ]
                                    }
                                ]
                            }
                        }
                    }
                }
                await KubeUtil.instance().ExtensionsV1beta1Api.createNamespacedDeployment(namespace, _deployment);
            }
            var service = await KubeUtil.instance().GetService(namespace, name);
            if (service == null) {
                console.log("Service " + name + " not found in " + namespace);
                var _service = {
                    metadata: { name: name, namespace: namespace },
                    spec: {
                        type: "NodePort",
                        sessionAffinity: "ClientIP",
                        selector: { app: (name + "nodered") },
                        ports: [
                            { port: 80, name: "www" }
                        ]
                    }
                }
                await KubeUtil.instance().CoreV1Api.createNamespacedService(namespace, _service);
            }
            var ingress = await KubeUtil.instance().GetIngress(namespace, "useringress");
            // console.log(ingress);
            var rule = null;
            for (var i = 0; i < ingress.spec.rules.length; i++) {
                if (ingress.spec.rules[i].host == hostname) {
                    rule = ingress.spec.rules[i];
                }
            }
            if (rule == null) {
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
                await KubeUtil.instance().ExtensionsV1beta1Api.replaceNamespacedIngress("useringress", namespace, ingress);
            }
        } catch (error) {
            msg.error = JSON.stringify(error, null, 2);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            msg.error = JSON.stringify(error, null, 2);
        }
        this.Send(cli);
    }
    private async DeleteNoderedInstance(cli: WebSocketClient): Promise<void> {
        this.Reply();
        var msg: DeleteNoderedInstanceMessage;
        var user: User;
        try {
            msg = DeleteNoderedInstanceMessage.assign(this.data);
            var name = cli.user.username;
            if (msg.name !== null && msg.name !== undefined && msg.name !== "" && msg.name != cli.user.username) {
                var exists = User.FindByUsername(msg.name, cli.jwt);
                if (exists == null) { throw new Error("Unknown name " + msg.name) }
                name = msg.name;
            }
            name = name.replace(new RegExp("@", 'g'), "_").replace(new RegExp(".", 'g'), "_");
            var namespace = Config.namespace;
            var hostname = Config.nodered_domain_schema.replace("$nodered_id$", name);

            var role: Role = await Role.FindByNameOrId(name + "noderedadmins", null);
            if (role !== null) {
                var jwt: string = TokenUser.rootToken();
                await Config.db.DeleteOne(role._id, "users", jwt);
            }
            var deployment = await KubeUtil.instance().GetDeployment(namespace, name);
            if (deployment != null) {
                await KubeUtil.instance().ExtensionsV1beta1Api.deleteNamespacedDeployment(name, namespace);
            }
            var service = await KubeUtil.instance().GetService(namespace, name);
            if (service != null) {
                await KubeUtil.instance().CoreV1Api.deleteNamespacedService(name, namespace);
            }
            var replicaset = await KubeUtil.instance().GetReplicaset(namespace, "app", (name + "nodered"));
            if (replicaset !== null) {
                KubeUtil.instance().AppsV1Api.deleteNamespacedReplicaSet(replicaset.metadata.name, namespace);
            }
            // var list = await KubeUtil.instance().CoreV1Api.listNamespacedPod(namespace);
            // for (var i = 0; i < list.body.items.length; i++) {
            //     var item = list.body.items[i];
            //     // if (item.metadata.labels.app === (name + "nodered") || item.metadata.labels.name === name) {
            //     if (item.metadata.labels.app === (name + "nodered")) {
            //         await KubeUtil.instance().CoreV1Api.deleteNamespacedPod(item.metadata.name, namespace);
            //     }
            // }
            var ingress = await KubeUtil.instance().GetIngress(namespace, "useringress");
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
        } catch (error) {
            msg.error = JSON.stringify(error, null, 2);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            msg.error = JSON.stringify(error, null, 2);
        }
        this.Send(cli);
    }
    private async RestartNoderedInstance(cli: WebSocketClient): Promise<void> {
        this.Reply();
        var msg: RestartNoderedInstanceMessage;
        try {
            msg = RestartNoderedInstanceMessage.assign(this.data);
            var name = cli.user.username;
            if (msg.name !== null && msg.name !== undefined && msg.name !== "" && msg.name != cli.user.username) {
                var exists = User.FindByUsername(msg.name, cli.jwt);
                if (exists == null) { throw new Error("Unknown name " + msg.name) }
                name = msg.name;
            }
            name = name.replace(new RegExp("@", 'g'), "_").replace(new RegExp(".", 'g'), "_");
            var namespace = Config.namespace;
            // var hostname = Config.nodered_domain_schema.replace("$nodered_id$", name);

            var list = await KubeUtil.instance().CoreV1Api.listNamespacedPod(namespace);
            for (var i = 0; i < list.body.items.length; i++) {
                var item = list.body.items[i];
                // if (item.metadata.labels.app === (name + "nodered") || item.metadata.labels.name === name) {
                if (item.metadata.labels.app === (name + "nodered")) {
                    await KubeUtil.instance().CoreV1Api.deleteNamespacedPod(item.metadata.name, namespace);
                }
            }
        } catch (error) {
            this.data = "";
            msg.error = JSON.stringify(error, null, 2);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            msg.error = error.toString();
        }
        this.Send(cli);
    }
    private async GetNoderedInstance(cli: WebSocketClient): Promise<void> {
        this.Reply();
        var msg: GetNoderedInstanceMessage;
        try {
            msg = GetNoderedInstanceMessage.assign(this.data);
            var name = cli.user.username;
            if (msg.name !== null && msg.name !== undefined && msg.name !== "" && msg.name != cli.user.username) {
                var exists = User.FindByUsername(msg.name, cli.jwt);
                if (exists == null) { throw new Error("Unknown name " + msg.name) }
                name = msg.name;
            }
            name = name.replace(new RegExp("@", 'g'), "_").replace(new RegExp(".", 'g'), "_");
            var namespace = Config.namespace;
            // var hostname = Config.nodered_domain_schema.replace("$nodered_id$", name);

            var list = await KubeUtil.instance().CoreV1Api.listNamespacedPod(namespace);

            if (list.body.items.length > 0) {
                for (var i = 0; i < list.body.items.length; i++) {
                    var item = list.body.items[i];
                    if (item.metadata.labels.app === (name + "nodered")) {
                        msg.result = item;
                        cli._logger.debug("GetNoderedInstance:" + name + " found one");
                    }
                }
            } else {
                cli._logger.warn("GetNoderedInstance: found NO Namespaced Pods ???");
            }
        } catch (error) {
            this.data = "";
            msg.error = JSON.stringify(error, null, 2);
        }
        try {
            this.data = JSON.stringify(msg);
        } catch (error) {
            this.data = "";
            msg.error = error.toString();
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