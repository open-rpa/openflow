import * as RED from "node-red";
import { Red } from "node-red";
import { Crypt } from "../../nodeclient/Crypt";
import { Config } from "../../Config";
import { Logger } from "../../Logger";
import { NoderedUtil, SigninMessage, TokenUser, Message, WebSocketClient, Base, mapFunc, reduceFunc, finalizeFunc, UpdateOneMessage } from "@openiap/openflow-api";
import { Util } from "./Util";
const pako = require('pako');

export interface Iapi_credentials {
    name: string;
}
export class api_credentials {
    public node: Red = null;
    public name: string = "";
    public username: string = "";
    public password: string = "";
    constructor(public config: Iapi_credentials) {
        RED.nodes.createNode(this, config);
        this.node = this;
        this.name = config.name;
        this.node.status({});
        if (this.node.credentials && this.node.credentials.hasOwnProperty("username")) {
            this.username = this.node.credentials.username;
        }
        if (this.node.credentials && this.node.credentials.hasOwnProperty("password")) {
            this.password = this.node.credentials.password;
        }
    }
}
export interface Iapi_get_jwt {
    config: any;
    name: string;
    longtoken: boolean;
    refresh: boolean;
}
export class api_get_jwt {
    public node: Red = null;
    public name: string = "";
    constructor(public config: Iapi_get_jwt) {
        RED.nodes.createNode(this, config);
        this.node = this;
        this.name = config.name;
        this.node.status({});
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }
    isNumeric(num) {
        return !isNaN(num)
    }
    async oninput(msg: any) {
        try {
            this.node.status({});

            let username: string = null;
            let password: string = null;
            let priority: number = 1;
            if (!NoderedUtil.IsNullEmpty(msg.priority)) { priority = msg.priority; }
            const config: api_credentials = RED.nodes.getNode(this.config.config);
            if (!NoderedUtil.IsNullUndefinded(config) && !NoderedUtil.IsNullEmpty(config.username)) {
                username = config.username;
            }
            if (!NoderedUtil.IsNullUndefinded(config) && !NoderedUtil.IsNullEmpty(config.password)) {
                password = config.password;
            }
            if (!NoderedUtil.IsNullEmpty(msg.username)) { username = msg.username; }
            if (!NoderedUtil.IsNullEmpty(msg.password)) { password = msg.password; }

            const q: SigninMessage = new SigninMessage(); q.validate_only = true;
            q.clientagent = "nodered";
            q.clientversion = Config.version;
            if (!NoderedUtil.IsNullEmpty(username) && !NoderedUtil.IsNullEmpty(password)) {
                q.username = username; q.password = password;
            } else {
                if (this.config.refresh && !NoderedUtil.IsNullEmpty(msg.jwt)) {
                    q.jwt = msg.jwt;
                } else if (!NoderedUtil.IsNullUndefinded(WebSocketClient.instance) && !NoderedUtil.IsNullEmpty(WebSocketClient.instance.jwt)) {
                    q.jwt = WebSocketClient.instance.jwt;
                } else if (Crypt.encryption_key() !== "") {
                    const user = new TokenUser();
                    if (NoderedUtil.IsNullEmpty(Config.nodered_sa)) {
                        user.name = "nodered" + Config.nodered_id;
                    } else {
                        user.name = Config.nodered_sa;
                    }
                    user.username = user.name;
                    q.jwt = Crypt.createToken(user);
                } else {
                    return NoderedUtil.HandleError(this, "root signin not allowed", msg);
                }
            }
            if (this.config.longtoken) {
                q.longtoken = true;
            }
            this.node.status({ fill: "blue", shape: "dot", text: "Requesting token" });
            const _msg: Message = new Message();
            _msg.command = "signin"; _msg.data = JSON.stringify(q);
            const result: SigninMessage = await WebSocketClient.instance.Send<SigninMessage>(_msg, priority);
            msg.jwt = result.jwt;
            msg.user = result.user;
            if (result !== null && result !== undefined && result.user !== null && result.user !== undefined) {
                Logger.instanse.debug("api_get_jwt: Created token as " + result.user.username);
            } else {
                Logger.instanse.debug("api_get_jwt: Created token failed ?");
            }
            this.node.send(msg);
            this.node.status({});
        } catch (error) {
            let message = error.message ? error.message : error;
            // this.node.error(new Error(message), msg);
            NoderedUtil.HandleError(this, message, msg);
            this.node.status({ fill: 'red', shape: 'dot', text: message.toString().substr(0, 32) });
        }
    }
    onclose() {
    }
}
export interface Iapi_get {
    resultfield: string;
    collection: string;
    query: any;
    projection: any;
    orderby: any;
    top: number;
    skip: number;
    name: string;
}
export class api_get {
    public node: Red = null;
    public name: string;

    constructor(public config: Iapi_get) {
        RED.nodes.createNode(this, config);
        this.node = this;
        this.name = config.name;
        this.node.status({});
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }
    async oninput(msg: any) {
        try {
            if (!WebSocketClient.instance.isConnected) {
                await new Promise(r => setTimeout(r, 2000));
            }
            if (!WebSocketClient.instance.isConnected) {
                throw new Error("Not connected");
            }
            this.node.status({});
            const collectionname = await Util.EvaluateNodeProperty<string>(this, msg, "collection");
            let query = await Util.EvaluateNodeProperty<string>(this, msg, "query");
            let projection = await Util.EvaluateNodeProperty<string>(this, msg, "projection");
            let orderby = await Util.EvaluateNodeProperty<any>(this, msg, "orderby");
            let top = await Util.EvaluateNodeProperty<number>(this, msg, "top");
            let skip = await Util.EvaluateNodeProperty<number>(this, msg, "skip");
            let priority: number = 1;
            if (!NoderedUtil.IsNullEmpty(msg.priority)) { priority = msg.priority; }
            top = parseInt(top as any);
            skip = parseInt(skip as any);

            if (!NoderedUtil.IsNullEmpty(orderby) && NoderedUtil.IsString(orderby)) {
                if (orderby.indexOf("{") > -1) {
                    try {
                        orderby = JSON.parse(orderby);
                    } catch (error) {
                        NoderedUtil.HandleError(this, "Error parsing orderby", msg);
                        return;
                    }
                }
            }
            if (!NoderedUtil.IsNullEmpty(orderby) && NoderedUtil.IsString(orderby)) {
                const field: string = orderby;
                orderby = {};
                orderby[field] = -1;
            }
            if (NoderedUtil.IsNullEmpty(query)) {
                query = {} as any;
            } else if (NoderedUtil.IsString(query)) {
                query = JSON.parse(query);
            }
            if (NoderedUtil.IsNullEmpty(projection)) {
                projection = {} as any;
            } else if (NoderedUtil.IsString(projection)) {
                try {
                    projection = JSON.parse(projection);
                } catch (error) {
                    NoderedUtil.HandleError(this, "Error parsing projection", msg);
                    return;
                }
            }
            if (NoderedUtil.IsNullEmpty(projection)) { projection = null; }

            this.node.status({ fill: "blue", shape: "dot", text: "Getting query" });
            let result: any[] = [];
            const pageby: number = 250;
            let subresult: any[] = [];
            let take: number = (top > pageby ? pageby : top);
            do {
                if (subresult.length == pageby && result.length < top) {
                    this.node.status({ fill: "blue", shape: "dot", text: "Getting " + skip + " " + (skip + pageby) });
                    await NoderedUtil.Delay(50);
                }
                if ((result.length + take) > top) {
                    take = top - result.length;
                }
                subresult = await NoderedUtil.Query({ collectionname, query, projection, orderby, top: take, skip, jwt: msg.jwt, priority });
                skip += take;
                result = result.concat(subresult);
                if (result.length > top) {
                    result = result.splice(0, top);
                }
            } while (subresult.length == pageby && result.length < top);

            if (!NoderedUtil.IsNullEmpty(this.config.resultfield)) {
                Util.SetMessageProperty(msg, this.config.resultfield, result);
            }
            this.node.send(msg);
            this.node.status({});
        } catch (error) {
            NoderedUtil.HandleError(this, error, msg);
        }
    }
    onclose() {
    }
}

export interface Iapi_add {
    entitytype: string;
    collection: string;
    entities: string;
    writeconcern: number;
    journal: boolean;
    name: string;
    // backward compatibility
    inputfield: string;
    resultfield: string;
}
export class api_add {
    public node: Red = null;
    public name: string;

    constructor(public config: Iapi_add) {
        RED.nodes.createNode(this, config);
        this.node = this;
        this.name = config.name;
        this.node.status({});
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }
    async oninput(msg: any) {
        try {
            this.node.status({});
            // if (NoderedUtil.IsNullEmpty(msg.jwt)) { return NoderedUtil.HandleError(this, "Missing jwt token"); }

            const collectionname = await Util.EvaluateNodeProperty<string>(this, msg, "collection");
            const entitytype = await Util.EvaluateNodeProperty<string>(this, msg, "entitytype");

            let writeconcern = this.config.writeconcern;
            let journal = this.config.journal;
            let priority: number = 1;
            if (!NoderedUtil.IsNullEmpty(msg.priority)) { priority = msg.priority; }
            if (!NoderedUtil.IsNullEmpty(msg.writeconcern)) { writeconcern = msg.writeconcern; }
            if (!NoderedUtil.IsNullEmpty(msg.journal)) { journal = msg.journal; }
            if ((writeconcern as any) === undefined || (writeconcern as any) === null) writeconcern = 0;
            if ((journal as any) === undefined || (journal as any) === null) journal = false;

            let data: any[] = [];

            let _data: Base[];
            if (this.config.entities == null && _data == null && this.config.inputfield != null) {
                _data = msg[this.config.inputfield];
            } else {
                _data = await Util.EvaluateNodeProperty<Base[]>(this, msg, "entities");
            }

            if (!NoderedUtil.IsNullUndefinded(_data)) {
                if (!Array.isArray(_data)) { data.push(_data); } else { data = _data; }
                if (data.length === 0) {
                    this.node.status({ fill: "yellow", shape: "dot", text: "input array is empty" });
                }
            } else { this.node.warn("Input data is null"); }

            this.node.status({ fill: "blue", shape: "dot", text: "processing " + data.length + " items" });
            let Promises: Promise<any>[] = [];
            let results: any[] = [];
            for (let y: number = 0; y < data.length; y += 50) {
                for (let i: number = y; i < (y + 50) && i < data.length; i++) {
                    const element: any = data[i];
                    if (!NoderedUtil.IsNullEmpty(entitytype)) {
                        element._type = entitytype;
                    }
                    Promises.push(NoderedUtil.InsertOne({ collectionname, item: element, w: writeconcern, j: journal, jwt: msg.jwt, priority }));
                }
                this.node.status({ fill: "blue", shape: "dot", text: (y + 1) + " to " + (y + 50) + " of " + data.length });
                const tempresults = await Promise.all(Promises.map(p => p.catch(e => e)));
                results = results.concat(tempresults);
                Promises = [];
            }
            data = results;

            const errors = data.filter(result => NoderedUtil.IsString(result) || (result instanceof Error));
            if (errors.length > 0) {
                for (let i: number = 0; i < errors.length; i++) {
                    NoderedUtil.HandleError(this, errors[i], msg);
                }
            }
            data = data.filter(result => !NoderedUtil.IsString(result) && !(result instanceof Error));

            if (this.config.entities == null && this.config.resultfield != null) {
                Util.SetMessageProperty(msg, this.config.resultfield, data);
            } else {
                Util.SetMessageProperty(msg, this.config.entities, data);
            }
            this.node.send(msg);
            this.node.status({});
        } catch (error) {
            NoderedUtil.HandleError(this, error, msg);
        }
    }
    onclose() {
    }
}


export interface Iapi_addmany {
    collection: string;
    entitytype: string;
    entities: string;
    writeconcern: number;
    skipresults: boolean;
    journal: boolean;
    name: string;
    // backward compatibility
    resultfield: string;
    inputfield: string;
}
export class api_addmany {
    public node: Red = null;
    public name: string;

    constructor(public config: Iapi_addmany) {
        RED.nodes.createNode(this, config);
        this.node = this;
        this.name = config.name;
        this.node.status({});
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }
    async oninput(msg: any) {
        try {
            this.node.status({});
            // if (NoderedUtil.IsNullEmpty(msg.jwt)) { return NoderedUtil.HandleError(this, "Missing jwt token"); }

            let writeconcern = this.config.writeconcern;
            let journal = this.config.journal;
            let skipresults = this.config.skipresults;
            let priority: number = 1;
            if (!NoderedUtil.IsNullEmpty(msg.priority)) { priority = msg.priority; }
            if (!NoderedUtil.IsNullEmpty(msg.writeconcern)) { writeconcern = msg.writeconcern; }
            if (!NoderedUtil.IsNullEmpty(msg.journal)) { journal = msg.journal; }
            if (!NoderedUtil.IsNullEmpty(msg.skipresults)) { skipresults = msg.skipresults; }
            if ((writeconcern as any) === undefined || (writeconcern as any) === null) writeconcern = 0;
            if ((journal as any) === undefined || (journal as any) === null) journal = false;
            const collectionname = await Util.EvaluateNodeProperty<string>(this, msg, "collection");
            const entitytype = await Util.EvaluateNodeProperty<string>(this, msg, "entitytype");

            let _data: Base[];
            if (this.config.entities == null && _data == null && this.config.inputfield != null) {
                _data = msg[this.config.inputfield];
            } else {
                _data = await Util.EvaluateNodeProperty<Base[]>(this, msg, "entities");
            }


            // let entities: Base[] = await Util.EvaluateNodeProperty<Base[]>(this, msg, "entities");
            // if (this.config.entities == null && entities == null && this.config.inputfield != null) {
            //     entities = msg[this.config.inputfield];
            // }

            let data: any[] = [];
            if (!NoderedUtil.IsNullUndefinded(_data)) {
                if (!Array.isArray(_data)) { data.push(_data); } else { data = _data; }
                if (data.length === 0) {
                    this.node.status({ fill: "yellow", shape: "dot", text: "input array is empty" });
                }
            } else { this.node.warn("Input data is null"); }

            if (data.length > 0) {
                this.node.status({ fill: "blue", shape: "dot", text: "processing " + data.length + " items" });
                let results: any[] = [];
                for (let y: number = 0; y < data.length; y += 50) {
                    let subitems: any[] = [];
                    for (let i: number = y; i < (y + 50) && i < data.length; i++) {
                        const element: any = data[i];
                        if (!NoderedUtil.IsNullEmpty(entitytype)) {
                            element._type = entitytype;
                        }
                        subitems.push(element);
                    }
                    this.node.status({ fill: "blue", shape: "dot", text: (y + 1) + " to " + (y + 50) + " of " + data.length });
                    results = results.concat(await NoderedUtil.InsertMany({ collectionname, items: subitems, w: writeconcern, j: journal, skipresults, jwt: msg.jwt, priority }));
                }
                data = results;
            }
            if (this.config.entities == null && this.config.resultfield != null) {
                Util.SetMessageProperty(msg, this.config.resultfield, data);
            } else {
                Util.SetMessageProperty(msg, this.config.entities, data);
            }

            this.node.send(msg);
            this.node.status({});
        } catch (error) {
            NoderedUtil.HandleError(this, error, msg);
        }
    }
    onclose() {
    }
}



export interface Iapi_update {
    entitytype: string;
    collection: string;
    entities: string;
    writeconcern: number;
    journal: boolean;
    name: string;
    // backward compatibility
    inputfield: string;
    resultfield: string;
}
export class api_update {
    public node: Red = null;
    public name: string;

    constructor(public config: Iapi_update) {
        RED.nodes.createNode(this, config);
        this.node = this;
        this.name = config.name;
        this.node.status({});
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }
    async oninput(msg: any) {
        try {
            this.node.status({});

            const entitytype = await Util.EvaluateNodeProperty<string>(this, msg, "entitytype");
            const collectionname = await Util.EvaluateNodeProperty<string>(this, msg, "collection");

            let _data: Base[];
            if (this.config.entities == null && _data == null && this.config.inputfield != null) {
                _data = msg[this.config.inputfield];
            } else {
                _data = await Util.EvaluateNodeProperty<Base[]>(this, msg, "entities");
            }

            let writeconcern = this.config.writeconcern;
            let journal = this.config.journal;
            let priority: number = 1;
            if (!NoderedUtil.IsNullEmpty(msg.priority)) { priority = msg.priority; }
            if (!NoderedUtil.IsNullEmpty(msg.writeconcern)) { writeconcern = msg.writeconcern; }
            if (!NoderedUtil.IsNullEmpty(msg.journal)) { journal = msg.journal; }
            if ((writeconcern as any) === undefined || (writeconcern as any) === null) writeconcern = 0;
            if ((journal as any) === undefined || (journal as any) === null) journal = false;

            let data: any[] = [];
            if (!NoderedUtil.IsNullUndefinded(_data)) {
                if (!Array.isArray(_data)) { data.push(_data); } else { data = _data; }
                if (data.length === 0) {
                    this.node.status({ fill: "yellow", shape: "dot", text: "input array is empty" });
                }
            } else { this.node.warn("Input data is null"); }

            this.node.status({ fill: "blue", shape: "dot", text: "processing ..." });
            let Promises: Promise<any>[] = [];
            let results: any[] = [];
            for (let y: number = 0; y < data.length; y += 50) {
                for (let i: number = y; i < (y + 50) && i < data.length; i++) {
                    const element: any = data[i];
                    if (!NoderedUtil.IsNullEmpty(entitytype)) {
                        element._type = entitytype;
                    }
                    Promises.push(NoderedUtil.UpdateOne({ collectionname, item: element, w: writeconcern, j: journal, jwt: msg.jwt, priority }));
                }
                this.node.status({ fill: "blue", shape: "dot", text: (y + 1) + " to " + (y + 50) + " of " + data.length });
                const tempresults = await Promise.all(Promises.map(p => p.catch(e => e)));
                results = results.concat(tempresults);
                Promises = [];
            }
            data = results;


            const errors = data.filter(result => NoderedUtil.IsString(result) || (result instanceof Error));
            if (errors.length > 0) {
                for (let i: number = 0; i < errors.length; i++) {
                    NoderedUtil.HandleError(this, errors[i], msg);
                }
                return;
            }
            data = data.filter(result => !NoderedUtil.IsString(result) && !(result instanceof Error));
            if (this.config.entities == null && this.config.resultfield != null) {
                Util.SetMessageProperty(msg, this.config.resultfield, data);
            } else {
                Util.SetMessageProperty(msg, this.config.entities, data);
            }
            this.node.send(msg);
            this.node.status({});
        } catch (error) {
            NoderedUtil.HandleError(this, error, msg);
        }
    }
    onclose() {
    }
}



export interface Iapi_addorupdate {
    entitytype: string;
    collection: string;
    entities: string;
    entitiestype: string;
    uniqeness: string;
    writeconcern: number;
    journal: boolean;
    name: string;
    // backward compatibility
    inputfield: string;
    // resultfield: string;
}
export class api_addorupdate {
    public node: Red = null;
    public name: string;

    constructor(public config: Iapi_addorupdate) {
        RED.nodes.createNode(this, config);
        this.node = this;
        this.name = config.name;
        this.node.status({});
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }
    async oninput(msg: any) {
        try {
            this.node.status({});
            const collectionname = await Util.EvaluateNodeProperty<string>(this, msg, "collection");
            const entitytype = await Util.EvaluateNodeProperty<string>(this, msg, "entitytype");
            const uniqeness = await Util.EvaluateNodeProperty<string>(this, msg, "uniqeness");
            let _data: Base[];
            if (this.config.entities == null && _data == null && this.config.inputfield != null) {
                _data = msg[this.config.inputfield];
            } else {
                _data = await Util.EvaluateNodeProperty<Base[]>(this, msg, "entities");
            }

            let writeconcern = this.config.writeconcern;
            let journal = this.config.journal;
            let priority: number = 1;
            if (!NoderedUtil.IsNullEmpty(msg.priority)) { priority = msg.priority; }
            if (!NoderedUtil.IsNullEmpty(msg.writeconcern)) { writeconcern = msg.writeconcern; }
            if (!NoderedUtil.IsNullEmpty(msg.journal)) { journal = msg.journal; }
            if ((writeconcern as any) === undefined || (writeconcern as any) === null) writeconcern = 0;
            if ((journal as any) === undefined || (journal as any) === null) journal = false;

            let data: any[] = [];
            if (!NoderedUtil.IsNullUndefinded(_data)) {
                if (!Array.isArray(_data)) { data.push(_data); } else { data = _data; }
                if (data.length === 0) {
                    this.node.status({ fill: "yellow", shape: "dot", text: "input array is empty" });
                }
            } else { this.node.warn("Input data is null"); }

            this.node.status({ fill: "blue", shape: "dot", text: "processing ..." });
            let Promises: Promise<any>[] = [];
            let results: any[] = [];
            // for (let y: number = 0; y < data.length; y += 50) {
            //     for (let i: number = y; i < (y + 50) && i < data.length; i++) {
            //         const element: any = data[i];
            //         if (!NoderedUtil.IsNullEmpty(entitytype)) {
            //             element._type = entitytype;
            //         }
            //         Promises.push(NoderedUtil.InsertOrUpdateOne({ collectionname, item: element, uniqeness, w: writeconcern, j: journal, jwt: msg.jwt, priority }));
            //     }
            //     this.node.status({ fill: "blue", shape: "dot", text: (y + 1) + " to " + (y + 50) + " of " + data.length });
            //     const tempresults = await Promise.all(Promises.map(p => p.catch(e => e)));
            //     results = results.concat(tempresults);
            //     Promises = [];
            // }
            // data = results;
            let skipresults: boolean = false;
            if (NoderedUtil.IsNullEmpty(this.config.entities) && this.config.entitiestype == "msg") {
                skipresults = true;
            }

            for (let y: number = 0; y < data.length; y += 50) {
                let items = [];
                for (let i: number = y; i < (y + 50) && i < data.length; i++) {
                    const element: any = data[i];
                    if (!NoderedUtil.IsNullEmpty(entitytype)) {
                        element._type = entitytype;
                    }
                    items.push(element);
                }
                this.node.status({ fill: "blue", shape: "dot", text: (y + 1) + " to " + (y + 50) + " of " + data.length });
                var tempresults = await NoderedUtil.InsertOrUpdateMany({ collectionname, uniqeness, items, skipresults, j: journal, w: writeconcern, jwt: msg.jwt, priority })
                results = results.concat(tempresults);
            }
            if (!skipresults) {
                Util.SetMessageProperty(msg, this.config.entities, results);
            }

            // const errors = data.filter(result => NoderedUtil.IsString(result) || (result instanceof Error));
            // if (errors.length > 0) {
            //     for (let i: number = 0; i < errors.length; i++) {
            //         NoderedUtil.HandleError(this, errors[i], msg);
            //     }
            // }
            // data = data.filter(result => !NoderedUtil.IsString(result) && !(result instanceof Error));
            // if (this.config.entities == null && this.config.resultfield != null) {
            //     Util.SetMessageProperty(msg, this.config.resultfield, data);
            // } else {
            //     Util.SetMessageProperty(msg, this.config.entities, data);
            // }
            this.node.send(msg);
            this.node.status({});
        } catch (error) {
            NoderedUtil.HandleError(this, error, msg);
        }
    }
    onclose() {
    }
}





export interface Iapi_delete {
    collection: string;
    inputfield: string;
    entities: string;
    name: string;
}
export class api_delete {
    public node: Red = null;
    public name: string;

    constructor(public config: Iapi_delete) {
        RED.nodes.createNode(this, config);
        this.node = this;
        this.name = config.name;
        this.node.status({});
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }
    async oninput(msg: any) {
        try {
            this.node.status({});
            const collectionname = await Util.EvaluateNodeProperty<string>(this, msg, "collection");
            let _data: Base[];
            if (this.config.entities == null && _data == null && this.config.inputfield != null) {
                _data = msg[this.config.inputfield];
            } else {
                _data = await Util.EvaluateNodeProperty<Base[]>(this, msg, "entities");
            }

            let priority: number = 1;
            if (!NoderedUtil.IsNullEmpty(msg.priority)) { priority = msg.priority; }

            let data: any[] = [];
            if (!NoderedUtil.IsNullUndefinded(_data)) {
                if (!Array.isArray(_data)) { data.push(_data); } else { data = _data; }
                if (data.length === 0) {
                    this.node.status({ fill: "yellow", shape: "dot", text: "input array is empty" });
                }
            } else { this.node.warn("Input data is null"); }

            this.node.status({ fill: "blue", shape: "dot", text: "processing ..." });
            let Promises: Promise<any>[] = [];
            let results: any[] = [];
            for (let y: number = 0; y < data.length; y += 50) {
                for (let i: number = y; i < (y + 50) && i < data.length; i++) {
                    const element: any = data[i];
                    let id: string = element;
                    if (NoderedUtil.isObject(element)) { id = element._id; }
                    Promises.push(NoderedUtil.DeleteOne({ collectionname, id, jwt: msg.jwt, priority }));
                }
                this.node.status({ fill: "blue", shape: "dot", text: (y + 1) + " to " + (y + 50) + " of " + data.length });
                const tempresults = await Promise.all(Promises.map(p => p.catch(e => e)));
                results = results.concat(tempresults);
                Promises = [];
            }
            data = results;

            const errors = data.filter(result => NoderedUtil.IsString(result) || (result instanceof Error));
            if (errors.length > 0) {
                for (let i: number = 0; i < errors.length; i++) {
                    NoderedUtil.HandleError(this, errors[i], msg);
                }
            }
            this.node.send(msg);
            this.node.status({});
        } catch (error) {
            NoderedUtil.HandleError(this, error, msg);
        }
    }
    onclose() {
    }
}



export interface Iapi_deletemany {
    inputfield: string;
    query: string;
    querytype: string;
    collection: string;
    collectiontype: string;
    name: string;
}
export class api_deletemany {
    public node: Red = null;
    public name: string;
    constructor(public config: Iapi_deletemany) {
        RED.nodes.createNode(this, config);
        this.node = this;
        this.name = config.name;
        this.node.status({});
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }
    async oninput(msg: any) {
        try {
            this.node.status({});
            let priority: number = 1;
            if (!NoderedUtil.IsNullEmpty(msg.priority)) { priority = msg.priority; }

            const collectionname = await Util.EvaluateNodeProperty<string>(this, msg, "collection");
            let query = await Util.EvaluateNodeProperty<string | any[]>(this, msg, "query");


            let ids: string[] = null;
            if (Array.isArray(query)) {
                var _data: any[] = query;
                ids = [];
                for (let i: number = 0; i < _data.length; i++) {
                    let id: string = _data[i];
                    if (NoderedUtil.isObject(_data[i])) { id = _data[i]._id; }
                    ids.push(id);
                }
                query = null;
            }
            this.node.status({ fill: "blue", shape: "dot", text: "processing ..." });
            const affectedrows = await NoderedUtil.DeleteMany({ collectionname, query, ids, jwt: msg.jwt, priority });
            this.node.send(msg);
            this.node.status({ fill: "green", shape: "dot", text: "deleted " + affectedrows + " rows" });
        } catch (error) {
            NoderedUtil.HandleError(this, error, msg);
        }
    }
    onclose() {
    }
}





export interface Iapi_map_reduce {
    collection: string;
    map: mapFunc;
    reduce: reduceFunc;
    finalize: finalizeFunc;
    scope: any;
    output: string;
    outcol: string;
    query: string;
    name: string;
}
export class api_map_reduce {
    public node: Red = null;
    public name: string;

    constructor(public config: Iapi_map_reduce) {
        RED.nodes.createNode(this, config);
        this.node = this;
        this.name = config.name;
        this.node.status({});
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }
    async oninput(msg: any) {
        try {
            this.node.status({});
            let collection = this.config.collection;
            let map = this.config.map;
            let reduce = this.config.reduce;
            let finalize = this.config.finalize;
            let _scope = this.config.scope;
            let query = this.config.query;
            let output = this.config.output;
            let outcol = this.config.outcol;
            let priority: number = 1;
            if (!NoderedUtil.IsNullEmpty(msg.priority)) { priority = msg.priority; }
            if (!NoderedUtil.IsNullEmpty(msg.collection)) { collection = msg.collection; }
            if (!NoderedUtil.IsNullUndefinded(msg.map)) { map = msg.map; }
            if (!NoderedUtil.IsNullUndefinded(msg.reduce)) { reduce = msg.reduce; }
            if (!NoderedUtil.IsNullUndefinded(msg.finalize)) { finalize = msg.finalize; }
            if (!NoderedUtil.IsNullUndefinded(msg.scope)) { _scope = msg.scope; }
            if (!NoderedUtil.IsNullUndefinded(msg.query)) { query = msg.query; }
            if (!NoderedUtil.IsNullUndefinded(msg.output)) { output = msg.output; }
            if (!NoderedUtil.IsNullUndefinded(msg.outcol)) { outcol = msg.outcol; }

            const scope = NoderedUtil.FetchFromObject(msg, _scope);
            const _output: any = {};
            _output[output] = outcol;

            if (!NoderedUtil.IsNullEmpty(query) && NoderedUtil.IsString(query)) {
                query = JSON.parse(query);
            }

            this.node.status({ fill: "blue", shape: "dot", text: "Running mapreduce" });
            const result = await NoderedUtil.MapReduce(collection, map, reduce, finalize, query, _output, scope, msg.jwt, priority);
            msg.payload = result;
            this.node.send(msg);
            this.node.status({});
        } catch (error) {
            NoderedUtil.HandleError(this, error, msg);
        }
    }
    onclose() {
    }
}

export async function get_api_roles(req, res) {
    try {
        let query: any = { _type: "role" };
        if (!NoderedUtil.IsNullEmpty(req.query.name)) {
            query = { _type: "role", name: { $regex: ".*" + req.query.name + ".*" } };
        }
        const result: any[] = await NoderedUtil.Query({ collectionname: 'users', query, projection: { name: 1 }, orderby: { name: -1 }, top: 1000 });

        res.json(result);
    } catch (error) {
        res.status(500).json(error);
    }
}


export async function get_api_userroles(req, res) {
    try {
        let query: any = { $or: [{ _type: "role" }, { _type: "user" }] };
        const ors = [];
        if (!NoderedUtil.IsNullEmpty(req.query.name)) {
            ors.push({ name: { $regex: ".*" + req.query.name + ".*" } });
        } else { ors.push({}); }
        if (!NoderedUtil.IsNullEmpty(req.query.id)) {
            ors.push({ _id: req.query.id });
        }
        if (ors.length > 0) {
            query = {
                $and: [
                    { $or: [{ _type: "role" }, { _type: "user" }] },
                    { $or: ors }
                ]
            };
        }

        const result: any[] = await NoderedUtil.Query({ collectionname: 'users', query, projection: { name: 1 }, orderby: { name: -1 } });
        if (!NoderedUtil.IsNullEmpty(req.query.id)) {
            const exists = result.filter(x => x._id == req.query.id);
            if (exists.length == 0) {
                const result2: any[] = await NoderedUtil.Query({ collectionname: 'users', query: { _id: req.query.id }, projection: { name: 1 }, orderby: { name: -1 }, top: 1 });
                if (result2.length == 1) {
                    result.push(result2[0]);
                }
            }
        }

        res.json(result);
    } catch (error) {
        res.status(500).json(error);
    }
}

export async function get_api_users(req, res) {
    try {
        let query: any = { _type: "user" };
        const ors = [];
        if (!NoderedUtil.IsNullEmpty(req.query.name)) {
            ors.push({ name: { $regex: ".*" + req.query.name + ".*" } });
        } else { ors.push({}); }
        if (!NoderedUtil.IsNullEmpty(req.query.id)) {
            ors.push({ _id: req.query.id });
        }
        if (ors.length > 0) {
            query = {
                $and: [
                    { _type: "user" },
                    { $or: ors }
                ]
            };
        }

        const result: any[] = await NoderedUtil.Query({ collectionname: 'users', query, projection: { name: 1 }, orderby: { name: -1 } });
        if (!NoderedUtil.IsNullEmpty(req.query.id)) {
            const exists = result.filter(x => x._id == req.query.id);
            if (exists.length == 0) {
                const result2: any[] = await NoderedUtil.Query({ collectionname: 'users', query: { _id: req.query.id }, projection: { name: 1 }, orderby: { name: -1 }, top: 1 });
                if (result2.length == 1) {
                    result.push(result2[0]);
                }
            }
        }

        res.json(result);
    } catch (error) {
        res.status(500).json(error);
    }
}






export interface Iapi_updatedocument {
    name: string;
    writeconcern: number;
    journal: boolean;
    action: string;
    query: string;
    updatedocument: string;
    collection: string;
}
export class api_updatedocument {
    public node: Red = null;
    public name: string;
    constructor(public config: Iapi_updatedocument) {
        RED.nodes.createNode(this, config);
        this.node = this;
        this.name = config.name;
        this.node.status({});
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }
    async oninput(msg: any) {
        try {
            this.node.status({});

            const collectionname = await Util.EvaluateNodeProperty<string>(this, msg, "collection");
            let query = await Util.EvaluateNodeProperty<string>(this, msg, "query");
            let updatedocument = await Util.EvaluateNodeProperty<string>(this, msg, "updatedocument");

            let action = this.config.action;
            let writeconcern = this.config.writeconcern;
            let journal = this.config.journal;
            const jwt = msg.jwt;
            let priority: number = 1;
            if (!NoderedUtil.IsNullEmpty(msg.priority)) { priority = msg.priority; }
            if (!NoderedUtil.IsNullEmpty(msg.action)) { action = msg.action; }
            if (!NoderedUtil.IsNullEmpty(msg.writeconcern)) { writeconcern = msg.writeconcern; }
            if (!NoderedUtil.IsNullEmpty(msg.journal)) { journal = msg.journal; }

            if ((writeconcern as any) === undefined || (writeconcern as any) === null) writeconcern = 0;
            if ((journal as any) === undefined || (journal as any) === null) journal = false;

            if (!NoderedUtil.IsNullEmpty(query) && NoderedUtil.IsString(query)) {
                query = JSON.parse(query);
            }
            if (!NoderedUtil.IsNullEmpty(updatedocument) && NoderedUtil.IsString(updatedocument)) {
                updatedocument = JSON.parse(updatedocument);
            }

            this.node.status({ fill: "blue", shape: "dot", text: "Running Update Document" });
            if (action === "updateOne") {
                const q: UpdateOneMessage = new UpdateOneMessage(); q.collectionname = collectionname;
                q.item = (updatedocument as any); q.jwt = jwt;
                q.w = writeconcern; q.j = journal; q.query = (query as any);
                const q2 = await NoderedUtil._UpdateOne(q, priority);
                msg.payload = q2.result;
                msg.opresult = q2.opresult;
            } else {
                const q2 = await NoderedUtil.UpdateMany({ collectionname, query, item: updatedocument, w: writeconcern, j: journal, priority });
                msg.payload = q2.result;
                msg.opresult = q2.opresult;
            }
            this.node.send(msg);
            this.node.status({});
        } catch (error) {
            NoderedUtil.HandleError(this, error, msg);
        }
    }
    onclose() {
    }
}







export interface Igrant_permission {
    targetid: string;
    entities: any;
    bits: any;
    name: string;
}
export class grant_permission {
    public node: Red = null;
    public name: string;
    constructor(public config: Igrant_permission) {
        RED.nodes.createNode(this, config);
        this.node = this;
        this.name = config.name;
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }
    async oninput(msg: any) {
        try {
            this.node.status({});

            // if (NoderedUtil.IsNullEmpty(msg.jwt)) { return NoderedUtil.HandleError(this, "Missing jwt token"); }
            let priority: number = 1;
            if (!NoderedUtil.IsNullEmpty(msg.priority)) { priority = msg.priority; }

            let targetid: string = "";
            if (this.config.targetid == "from msg.targetid" || NoderedUtil.IsNullEmpty(this.config.targetid)) {
                targetid = msg.targetid;
            } else {
                targetid = this.config.targetid;
            }
            if (NoderedUtil.IsNullEmpty(targetid)) {
                throw new Error("targetid is null or empty");
            }
            let bits = this.config.bits;
            if (!NoderedUtil.IsNullUndefinded(msg.bits)) { bits = msg.bits; }
            if (NoderedUtil.IsNullUndefinded(bits)) {
                throw new Error("bits is null or empty");
            }


            if (!Array.isArray(this.config.bits)) {
                this.config.bits = this.config.bits.split(',');
            }
            for (let i = 0; i < this.config.bits.length; i++) {
                this.config.bits[i] = parseInt(this.config.bits[i]);
            }

            const result: any[] = await NoderedUtil.Query({ collectionname: 'users', query: { _id: targetid }, projection: { name: 1 }, orderby: { name: -1 }, top: 1, jwt: msg.jwt, priority })
            if (result.length === 0) { return NoderedUtil.HandleError(this, "Target " + targetid + " not found ", msg); }
            const found = result[0];

            let data: any[] = [];
            const _data = NoderedUtil.FetchFromObject(msg, this.config.entities);
            if (!NoderedUtil.IsNullUndefinded(_data)) {
                if (!Array.isArray(_data)) { data.push(_data); } else { data = _data; }
                if (data.length === 0) {
                    this.node.status({ fill: "yellow", shape: "dot", text: "input array is empty" });
                }
            } else { this.node.warn("Input data is null"); }

            this.node.status({ fill: "blue", shape: "dot", text: "processing ..." });
            for (let i = 0; i < data.length; i++) {
                if (NoderedUtil.IsNullEmpty(data[i]._type) && !NoderedUtil.IsNullUndefinded(data[i].metadata)) {
                    const metadata: Base = (data[i].metadata as any);
                    Base.addRight(metadata, targetid, found.name, this.config.bits);
                    data[i].metadata = metadata;
                } else {
                    const entity: Base = data[i];
                    Base.addRight(entity, targetid, found.name, this.config.bits);
                    data[i] = entity;
                }
                if ((i % 50) == 0 && i > 0) {
                    this.node.status({ fill: "blue", shape: "dot", text: "processed " + i + " of " + data.length });
                    await NoderedUtil.Delay(50);
                }
            }
            NoderedUtil.saveToObject(msg, this.config.entities, data);
            this.node.send(msg);
            this.node.status({});
        } catch (error) {
            NoderedUtil.HandleError(this, error, msg);
        }
    }
    onclose() {
    }
}




export interface Irevoke_permission {
    targetid: string;
    entities: any;
    bits: any;
    name: string;
}
export class revoke_permission {
    public node: Red = null;
    public name: string;
    constructor(public config: Irevoke_permission) {
        RED.nodes.createNode(this, config);
        this.node = this;
        this.name = config.name;
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }
    async oninput(msg: any) {
        try {
            this.node.status({});

            let targetid: string = "";
            if (this.config.targetid == "from msg.targetid" || NoderedUtil.IsNullEmpty(this.config.targetid)) {
                targetid = msg.targetid;
            } else {
                targetid = this.config.targetid;
            }
            if (NoderedUtil.IsNullEmpty(targetid)) {
                throw new Error("targetid is null or empty");
            }
            let bits = this.config.bits;
            if (!NoderedUtil.IsNullUndefinded(msg.bits)) { bits = msg.bits; }
            if (NoderedUtil.IsNullUndefinded(bits)) {
                throw new Error("bits is null or empty");
            }



            if (!Array.isArray(bits)) {
                bits = bits.split(',');
            }
            for (let i = 0; i < bits.length; i++) {
                bits[i] = parseInt(bits[i]);
            }

            let data: any[] = [];
            const _data = NoderedUtil.FetchFromObject(msg, this.config.entities);
            if (!NoderedUtil.IsNullUndefinded(_data)) {
                if (!Array.isArray(_data)) { data.push(_data); } else { data = _data; }
                if (data.length === 0) {
                    this.node.status({ fill: "yellow", shape: "dot", text: "input array is empty" });
                }
            } else { this.node.warn("Input data is null"); }

            for (let i = 0; i < data.length; i++) {

                if (NoderedUtil.IsNullEmpty(data[i]._type) && !NoderedUtil.IsNullUndefinded(data[i].metadata)) {
                    const metadata: Base = data[i].metadata;
                    if (bits.indexOf(-1) > -1) {
                        metadata._acl = metadata._acl.filter((m: any) => { return m._id !== targetid; });
                    } else {
                        Base.removeRight(metadata, targetid, bits);
                    }
                    data[i].metadata = metadata;
                } else {
                    const entity: Base = data[i];
                    if (bits.indexOf(-1) > -1) {
                        entity._acl = entity._acl.filter((m: any) => { return m._id !== targetid; });
                    } else {
                        Base.removeRight(entity, targetid, bits);
                    }
                    data[i] = entity;
                }
            }
            NoderedUtil.saveToObject(msg, this.config.entities, data);
            this.node.send(msg);
            this.node.status({});
        } catch (error) {
            NoderedUtil.HandleError(this, error, msg);
        }
    }
    onclose() {
    }
}



export interface Idownload_file {
    fileid: string;
    filename: string;
    name: string;
    asbuffer: boolean;
    result: string;
}
export class download_file {
    public node: Red = null;
    public name: string;
    constructor(public config: Idownload_file) {
        RED.nodes.createNode(this, config);
        this.node = this;
        this.name = config.name;
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }
    async oninput(msg: any) {
        try {
            this.node.status({});

            const fileid = await Util.EvaluateNodeProperty<string>(this, msg, "fileid");
            const filename = await Util.EvaluateNodeProperty<string>(this, msg, "filename", true);
            let asbuffer: boolean = this.config.asbuffer;
            if (NoderedUtil.IsNullEmpty(asbuffer)) asbuffer = false;
            asbuffer = Boolean(asbuffer);;
            const jwt = msg.jwt;
            let priority: number = 1;
            if (!NoderedUtil.IsNullEmpty(msg.priority)) { priority = msg.priority; }

            this.node.status({ fill: "blue", shape: "dot", text: "Getting file" });
            const file = await NoderedUtil.GetFile({ filename, id: fileid, jwt, priority, compress: asbuffer });
            var result = null;
            if (asbuffer) {
                var data = Buffer.from(file.file, 'base64');
                result = pako.inflate(data);
                result = Buffer.from(result);
            } else {
                result = file.file;
            }
            Util.SetMessageProperty(msg, this.config.result, result);
            Util.SetMessageProperty(msg, this.config.filename, file.metadata.filename);
            msg.error = file.error;
            msg.id = file.id;
            msg.mimeType = file.mimeType;
            msg.metadata = file.metadata;

            this.node.send(msg);
            this.node.status({});
        } catch (error) {
            NoderedUtil.HandleError(this, error, msg);
        }
    }
    onclose() {
    }
}


export interface Iuploadload_file {
    filename: string;
    mimeType: string;
    name: string;
    content: string;
    entity: string;
}
export class upload_file {
    public node: Red = null;
    public name: string;
    constructor(public config: Iuploadload_file) {
        RED.nodes.createNode(this, config);
        this.node = this;
        this.name = config.name;
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }
    async oninput(msg: any) {
        try {
            this.node.status({});

            const jwt = msg.jwt;
            const filename = await Util.EvaluateNodeProperty<string>(this, msg, "filename");
            const mimeType = await Util.EvaluateNodeProperty<string>(this, msg, "mimeType");
            const filecontent = await Util.EvaluateNodeProperty<string>(this, msg, "content");
            let priority: number = 1;
            if (!NoderedUtil.IsNullEmpty(msg.priority)) { priority = msg.priority; }

            this.node.status({ fill: "blue", shape: "dot", text: "Saving file" });
            const file = await NoderedUtil.SaveFile({ filename, mimeType, metadata: msg.metadata, file: filecontent, jwt, priority });
            if (!NoderedUtil.IsNullEmpty(file.error)) { throw new Error(file.error); }

            Util.SetMessageProperty(msg, this.config.entity, file.result);

            this.node.send(msg);
            this.node.status({});
        } catch (error) {
            NoderedUtil.HandleError(this, error, msg);
        }
    }
    onclose() {
    }
}






export interface Iapi_aggregate {
    collection: string;
    collectiontype: string;
    aggregates: object[];
    aggregatestype: string;
    name: string;
}
export class api_aggregate {
    public node: Red = null;
    public name: string;
    constructor(public config: Iapi_aggregate) {
        RED.nodes.createNode(this, config);
        this.node = this;
        this.name = config.name;
        this.node.status({});
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }
    async oninput(msg: any) {
        try {
            this.node.status({});
            // if (NoderedUtil.IsNullEmpty(msg.jwt)) { return NoderedUtil.HandleError(this, "Missing jwt token"); }

            const collectionname = await Util.EvaluateNodeProperty<string>(this, msg, "collection");
            const aggregates = await Util.EvaluateNodeProperty<object[]>(this, msg, "aggregates");

            let priority: number = 1;
            if (!NoderedUtil.IsNullEmpty(msg.priority)) { priority = msg.priority; }

            this.node.status({ fill: "blue", shape: "dot", text: "Running aggregate" });
            const result = await NoderedUtil.Aggregate({ collectionname, aggregates, jwt: msg.jwt, priority });
            msg.payload = result;
            this.node.send(msg);
            this.node.status({});
        } catch (error) {
            NoderedUtil.HandleError(this, error, msg);
        }
    }
    onclose() {
    }
}


export interface Iapi_watch {
    collection: string;
    aggregates: object[];
    name: string;
}
export class api_watch {
    public node: Red = null;
    public name: string;
    public watchid: string = "";
    private _onsignedin: any = null;
    private _onsocketclose: any = null;
    constructor(public config: Iapi_watch) {
        RED.nodes.createNode(this, config);
        this.node = this;
        this.name = config.name;
        this.node.status({});
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);

        this._onsignedin = this.onsignedin.bind(this);
        this._onsocketclose = this.onsocketclose.bind(this);
        WebSocketClient.instance.events.on("onsignedin", this._onsignedin);
        WebSocketClient.instance.events.on("onclose", this._onsocketclose);
        if (WebSocketClient.instance.isConnected && WebSocketClient.instance.user != null) {
            this.connect();
        }
    }
    onsignedin() {
        this.connect();
    }
    onsocketclose(message) {
        if (message == null) message = "";
        if (this != null && this.node != null) this.node.status({ fill: "red", shape: "dot", text: "Disconnected " + message });
    }
    async connect() {
        this.node.status({ fill: "blue", shape: "dot", text: "Setting up watch" });
        this.watchid = await NoderedUtil.Watch({ collectionname: this.config.collection, aggregates: this.config.aggregates, callback: this.onevent.bind(this) })
        this.node.status({ fill: "green", shape: "dot", text: "watchid " + this.watchid });
    }
    onevent(event: any) {
        event.payload = event.fullDocument;
        delete event.fullDocument;
        this.node.send(event);
    }
    async oninput(msg: any) {
        try {
            this.node.status({});
            // if (NoderedUtil.IsNullEmpty(msg.jwt)) { return NoderedUtil.HandleError(this, "Missing jwt token"); }

            let collectionname = this.config.collection;
            let aggregates = this.config.aggregates;
            let priority: number = 1;
            if (!NoderedUtil.IsNullEmpty(msg.priority)) { priority = msg.priority; }
            if (!NoderedUtil.IsNullEmpty(msg.collection)) { collectionname = msg.collection; }
            if (!NoderedUtil.IsNullEmpty(msg.aggregates)) { aggregates = msg.aggregates; }

            this.node.status({ fill: "blue", shape: "dot", text: "Running aggregate" });
            const result = await NoderedUtil.Aggregate({ collectionname, aggregates, jwt: msg.jwt, priority });
            msg.payload = result;
            this.node.send(msg);
            this.node.status({});
        } catch (error) {
            NoderedUtil.HandleError(this, error, msg);
        }
    }
    async onclose(removed: boolean, done: any) {
        try {
            this.node.status({ text: "Closing . . ." });
            if (!NoderedUtil.IsNullEmpty(this.watchid)) {
                await NoderedUtil.UnWatch({ id: this.watchid });
            }
        } catch (error) {
            NoderedUtil.HandleError(this, error, null);
        }
        this.watchid = null;
        this.node.status({ text: "Not watching" });
        WebSocketClient.instance.events.removeListener("onsignedin", this._onsignedin);
        WebSocketClient.instance.events.removeListener("onclose", this._onsocketclose);
        if (done != null) done();
    }
}



export interface Ilist_collections {
    name: string;
    results: string;
}
export class list_collections {
    public node: Red = null;
    public name: string;
    constructor(public config: Ilist_collections) {
        RED.nodes.createNode(this, config);
        this.node = this;
        this.name = config.name;
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }
    async oninput(msg: any) {
        try {
            this.node.status({});

            // if (NoderedUtil.IsNullEmpty(msg.jwt)) { return NoderedUtil.HandleError(this, "Missing jwt token"); }
            let priority: number = 1;
            if (!NoderedUtil.IsNullEmpty(msg.priority)) { priority = msg.priority; }

            const collections = await NoderedUtil.ListCollections(null);
            if (!NoderedUtil.IsNullEmpty(this.config.results)) {
                NoderedUtil.saveToObject(msg, this.config.results, collections);
            }
            this.node.send(msg);
            this.node.status({});
        } catch (error) {
            NoderedUtil.HandleError(this, error, msg);
        }
    }
    onclose() {
    }
}




export interface Idrop_collection {
    name: string;
    collectioname: string;
}
export class drop_collection {
    public node: Red = null;
    public name: string;
    constructor(public config: Idrop_collection) {
        RED.nodes.createNode(this, config);
        this.node = this;
        this.name = config.name;
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }
    async oninput(msg: any) {
        try {
            this.node.status({});
            let priority: number = 1;
            if (!NoderedUtil.IsNullEmpty(msg.priority)) { priority = msg.priority; }
            const collectionname: any = await Util.EvaluateNodeProperty<string>(this, msg, "collectioname");
            await NoderedUtil.DropCollection({ collectionname, priority });
            this.node.send(msg);
            this.node.status({});
        } catch (error) {
            NoderedUtil.HandleError(this, error, msg);
        }
    }
    onclose() {
    }
}


export interface Ihousekeeping {
    name: string;
    skipnodered: boolean
    skipcalculatesize: boolean;
    skipupdateusersize: boolean;
}
export class housekeeping {
    public node: Red = null;
    public name: string;
    constructor(public config: Ihousekeeping) {
        RED.nodes.createNode(this, config);
        this.node = this;
        this.name = config.name;
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }
    async oninput(msg: any) {
        try {
            let priority: number = 1;
            if (!NoderedUtil.IsNullEmpty(msg.priority)) { priority = msg.priority; }

            const { skipnodered, skipcalculatesize, skipupdateusersize } = this.config;

            this.node.status({ fill: "blue", shape: "dot", text: "Running house keeping" });
            await NoderedUtil.HouseKeeping({ skipnodered, skipcalculatesize, skipupdateusersize, jwt: msg.jwt, priority });
            this.node.send(msg);
            this.node.status({ fill: "green", shape: "dot", text: "Complete" });
        } catch (error) {
            NoderedUtil.HandleError(this, error, msg);
        }
    }
    onclose() {
    }
}
