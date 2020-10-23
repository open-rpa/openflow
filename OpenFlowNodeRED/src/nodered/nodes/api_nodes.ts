import * as RED from "node-red";
import { Red } from "node-red";
import { Crypt } from "../../nodeclient/Crypt";
import { Config } from "../../Config";
import { Logger } from "../../Logger";
import { NoderedUtil, SigninMessage, TokenUser, Message, WebSocketClient, Base, mapFunc, reduceFunc, finalizeFunc, UpdateOneMessage } from "openflow-api";
import * as path from "path";
import { FileSystemCache } from "openflow-api";

export interface Iapi_credentials {
}
export class api_credentials {
    public node: Red = null;
    public name: string = "";
    public username: string = "";
    public password: string = "";
    constructor(public config: Iapi_get_jwt) {
        RED.nodes.createNode(this, config);
        this.node = this;
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
}
export class api_get_jwt {
    public node: Red = null;
    public name: string = "";
    constructor(public config: Iapi_get_jwt) {
        RED.nodes.createNode(this, config);
        this.node = this;
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
            var config: api_credentials = RED.nodes.getNode(this.config.config);
            if (!NoderedUtil.IsNullUndefinded(config) && !NoderedUtil.IsNullEmpty(config.username)) {
                username = config.username;
            }
            if (!NoderedUtil.IsNullUndefinded(config) && !NoderedUtil.IsNullEmpty(config.password)) {
                password = config.password;
            }
            if (!NoderedUtil.IsNullEmpty(msg.username)) { username = msg.username; }
            if (!NoderedUtil.IsNullEmpty(msg.password)) { username = msg.password; }

            var q: SigninMessage = new SigninMessage(); q.validate_only = true;
            q.clientagent = "nodered";
            q.clientversion = Config.version;
            if (!NoderedUtil.IsNullEmpty(username) && !NoderedUtil.IsNullEmpty(password)) {
                q.username = username; q.password = password;
            } else {
                if (Config.jwt !== "") {
                    q.jwt = Config.jwt;
                } else if (Crypt.encryption_key() !== "") {
                    var user = new TokenUser();
                    if (NoderedUtil.IsNullEmpty(Config.nodered_sa)) {
                        user.name = "nodered" + Config.nodered_id;
                    } else {
                        user.name = Config.nodered_sa;
                    }
                    user.username = user.name;
                    q.jwt = Crypt.createToken(user);
                } else {
                    return NoderedUtil.HandleError(this, "root signin not allowed");
                }
            }
            this.node.status({ fill: "blue", shape: "dot", text: "Requesting token" });
            var _msg: Message = new Message();
            _msg.command = "signin"; _msg.data = JSON.stringify(q);
            var result: SigninMessage = await WebSocketClient.instance.Send<SigninMessage>(_msg);
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
            NoderedUtil.HandleError(this, error);
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
}
export class api_get {
    public node: Red = null;

    constructor(public config: Iapi_get) {
        RED.nodes.createNode(this, config);
        this.node = this;
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
            // if (NoderedUtil.IsNullEmpty(msg.jwt)) return NoderedUtil.HandleError(this, "Missing jwt token");
            if (!NoderedUtil.IsNullUndefinded(msg.query)) { this.config.query = msg.query; }
            if (!NoderedUtil.IsNullUndefinded(msg.projection)) { this.config.projection = msg.projection; }
            if (!NoderedUtil.IsNullUndefinded(msg.orderby)) { this.config.orderby = msg.orderby; }
            if (!NoderedUtil.IsNullEmpty(msg.top)) { this.config.top = parseInt(msg.top); }
            if (!NoderedUtil.IsNullEmpty(msg.skip)) { this.config.skip = parseInt(msg.skip); }
            // if (NoderedUtil.IsNullEmpty(msg.jwt) && !NoderedUtil.IsNullEmpty(Config.jwt)) {
            //     msg.jwt = Config.jwt;
            // }

            if (NoderedUtil.IsNullEmpty(this.config.top)) { this.config.top = 500; }
            if (NoderedUtil.IsNullEmpty(this.config.skip)) { this.config.skip = 0; }
            if (!NoderedUtil.IsNullEmpty(this.config.orderby) && NoderedUtil.IsString(this.config.orderby)) {
                if (this.config.orderby.indexOf("{") > -1) {
                    try {
                        this.config.orderby = JSON.parse(this.config.orderby);
                    } catch (error) {
                        (this as Red).error("Error parsing orderby", error);
                        // this.node.er
                        // NoderedUtil.HandleError(this, error);
                        return;
                    }
                }
            }
            if (!NoderedUtil.IsNullEmpty(this.config.orderby) && NoderedUtil.IsString(this.config.orderby)) {
                var field: string = this.config.orderby;
                this.config.orderby = {};
                this.config.orderby[field] = -1;
            }
            if (NoderedUtil.IsNullEmpty(this.config.query)) {
                this.config.query = {};
            } else if (NoderedUtil.IsString(this.config.query)) {
                this.config.query = JSON.parse(this.config.query);
            }
            if (NoderedUtil.IsNullEmpty(this.config.projection)) {
                this.config.projection = {};
            } else if (NoderedUtil.IsString(this.config.projection)) {
                try {
                    this.config.projection = JSON.parse(this.config.projection);
                } catch (error) {
                    (this as Red).error("Error parsing projection", error);
                    // this.node.er
                    // NoderedUtil.HandleError(this, error);
                    return;
                }
            }
            if (NoderedUtil.IsNullEmpty(this.config.projection)) { this.config.projection = null; }

            this.node.status({ fill: "blue", shape: "dot", text: "Getting query" });
            var result: any[] = [], subresult: any[] = [];
            var top: number = parseInt(this.config.top as any), take: number = top;
            var skip: number = parseInt(this.config.skip as any);
            var pageby: number = 250;
            if (top > pageby) take = pageby;
            do {
                this.node.status({ fill: "blue", shape: "dot", text: "Getting " + skip + " " + (skip + pageby) });
                if ((result.length + take) > top) {
                    take = top - result.length;
                }
                subresult = await NoderedUtil.Query(this.config.collection, this.config.query, this.config.projection, this.config.orderby, take, skip, msg.jwt);
                skip += take;
                result = result.concat(subresult);
                if (result.length > top) {
                    result = result.splice(0, top);
                }
            } while (subresult.length == pageby && result.length < top);

            // var result: any[] = await NoderedUtil.Query(this.config.collection, this.config.query,
            //     this.config.projection, this.config.orderby, parseInt(this.config.top as any), parseInt(this.config.skip as any), msg.jwt)
            NoderedUtil.saveToObject(msg, this.config.resultfield, result);
            this.node.send(msg);
            this.node.status({});
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    onclose() {
    }
}

export interface Iapi_add {
    entitytype: string;
    collection: string;
    inputfield: string;
    resultfield: string;
    writeconcern: number;
    journal: boolean;
}
export class api_add {
    public node: Red = null;

    constructor(public config: Iapi_add) {
        RED.nodes.createNode(this, config);
        this.node = this;
        this.node.status({});
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }
    async oninput(msg: any) {
        try {
            this.node.status({});
            // if (NoderedUtil.IsNullEmpty(msg.jwt)) { return NoderedUtil.HandleError(this, "Missing jwt token"); }

            if (!NoderedUtil.IsNullEmpty(msg.entitytype)) { this.config.entitytype = msg.entitytype; }
            if (!NoderedUtil.IsNullEmpty(msg.collection)) { this.config.collection = msg.collection; }
            if (!NoderedUtil.IsNullEmpty(msg.inputfield)) { this.config.inputfield = msg.inputfield; }
            if (!NoderedUtil.IsNullEmpty(msg.resultfield)) { this.config.resultfield = msg.resultfield; }
            if (!NoderedUtil.IsNullEmpty(msg.writeconcern)) { this.config.writeconcern = msg.writeconcern; }
            if (!NoderedUtil.IsNullEmpty(msg.journal)) { this.config.journal = msg.journal; }
            // if (NoderedUtil.IsNullEmpty(msg.jwt) && !NoderedUtil.IsNullEmpty(Config.jwt)) {
            //     msg.jwt = Config.jwt;
            // }


            if ((this.config.writeconcern as any) === undefined || (this.config.writeconcern as any) === null) this.config.writeconcern = 0;
            if ((this.config.journal as any) === undefined || (this.config.journal as any) === null) this.config.journal = false;

            var data: any[] = [];
            var _data = NoderedUtil.FetchFromObject(msg, this.config.inputfield);
            if (NoderedUtil.IsNullUndefinded(_data)) { return NoderedUtil.HandleError(this, "Input data is null"); }
            if (!Array.isArray(_data)) { data.push(_data); } else { data = _data; }

            if (data.length === 0) { this.node.warn("input array is empty"); return; }

            this.node.status({ fill: "blue", shape: "dot", text: "Inserting items" });
            var Promises: Promise<any>[] = [];
            for (var i: number = 0; i < data.length; i++) {
                var element: any = data[i];
                if (!NoderedUtil.IsNullEmpty(this.config.entitytype)) {
                    element._type = this.config.entitytype;
                }
                Promises.push(NoderedUtil.InsertOne(this.config.collection, element, this.config.writeconcern, this.config.journal, msg.jwt));
            }
            data = await Promise.all(Promises.map(p => p.catch(e => e)));

            var errors = data.filter(result => NoderedUtil.IsString(result) || (result instanceof Error));
            if (errors.length > 0) {
                for (var i: number = 0; i < errors.length; i++) {
                    NoderedUtil.HandleError(this, errors[i]);
                }
            }
            data = data.filter(result => !NoderedUtil.IsString(result) && !(result instanceof Error));
            NoderedUtil.saveToObject(msg, this.config.resultfield, data);
            this.node.send(msg);
            this.node.status({});
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    onclose() {
    }
}




export interface Iapi_update {
    entitytype: string;
    collection: string;
    inputfield: string;
    resultfield: string;
    writeconcern: number;
    journal: boolean;
}
export class api_update {
    public node: Red = null;

    constructor(public config: Iapi_update) {
        RED.nodes.createNode(this, config);
        this.node = this;
        this.node.status({});
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }
    async oninput(msg: any) {
        try {
            this.node.status({});
            // if (NoderedUtil.IsNullEmpty(msg.jwt)) { return NoderedUtil.HandleError(this, "Missing jwt token"); }

            if (!NoderedUtil.IsNullEmpty(msg.entitytype)) { this.config.entitytype = msg.entitytype; }
            if (!NoderedUtil.IsNullEmpty(msg.collection)) { this.config.collection = msg.collection; }
            if (!NoderedUtil.IsNullEmpty(msg.inputfield)) { this.config.inputfield = msg.inputfield; }
            if (!NoderedUtil.IsNullEmpty(msg.resultfield)) { this.config.resultfield = msg.resultfield; }
            if (!NoderedUtil.IsNullEmpty(msg.writeconcern)) { this.config.writeconcern = msg.writeconcern; }
            if (!NoderedUtil.IsNullEmpty(msg.journal)) { this.config.journal = msg.journal; }
            // if (NoderedUtil.IsNullEmpty(msg.jwt) && !NoderedUtil.IsNullEmpty(Config.jwt)) {
            //     msg.jwt = Config.jwt;
            // }

            if ((this.config.writeconcern as any) === undefined || (this.config.writeconcern as any) === null) this.config.writeconcern = 0;
            if ((this.config.journal as any) === undefined || (this.config.journal as any) === null) this.config.journal = false;

            var data: any[] = [];
            var _data = NoderedUtil.FetchFromObject(msg, this.config.inputfield);
            if (NoderedUtil.IsNullUndefinded(_data)) { return NoderedUtil.HandleError(this, "Input data is null"); }
            if (!Array.isArray(_data)) { data.push(_data); } else { data = _data; }

            if (data.length === 0) { this.node.warn("input array is empty"); return; }

            this.node.status({ fill: "blue", shape: "dot", text: "Inserting items" });
            var Promises: Promise<any>[] = [];
            for (var i: number = 0; i < data.length; i++) {
                var element: any = data[i];
                if (!NoderedUtil.IsNullEmpty(this.config.entitytype)) {
                    element._type = this.config.entitytype;
                }
                Promises.push(NoderedUtil.UpdateOne(this.config.collection, null, element, this.config.writeconcern, this.config.journal, msg.jwt));
            }
            data = await Promise.all(Promises.map(p => p.catch(e => e)));

            var errors = data.filter(result => NoderedUtil.IsString(result) || (result instanceof Error));
            if (errors.length > 0) {
                for (var i: number = 0; i < errors.length; i++) {
                    NoderedUtil.HandleError(this, errors[i]);
                }
            }
            data = data.filter(result => !NoderedUtil.IsString(result) && !(result instanceof Error));
            NoderedUtil.saveToObject(msg, this.config.resultfield, data);
            this.node.send(msg);
            this.node.status({});
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    onclose() {
    }
}



export interface Iapi_addorupdate {
    entitytype: string;
    collection: string;
    inputfield: string;
    resultfield: string;
    uniqeness: string;
    writeconcern: number;
    journal: boolean;
}
export class api_addorupdate {
    public node: Red = null;

    constructor(public config: Iapi_addorupdate) {
        RED.nodes.createNode(this, config);
        this.node = this;
        this.node.status({});
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }
    async oninput(msg: any) {
        try {
            this.node.status({});
            // if (NoderedUtil.IsNullEmpty(msg.jwt)) { return NoderedUtil.HandleError(this, "Missing jwt token"); }

            if (!NoderedUtil.IsNullEmpty(msg.entitytype)) { this.config.entitytype = msg.entitytype; }
            if (!NoderedUtil.IsNullEmpty(msg.collection)) { this.config.collection = msg.collection; }
            if (!NoderedUtil.IsNullEmpty(msg.inputfield)) { this.config.inputfield = msg.inputfield; }
            if (!NoderedUtil.IsNullEmpty(msg.resultfield)) { this.config.resultfield = msg.resultfield; }
            if (!NoderedUtil.IsNullEmpty(msg.uniqeness)) { this.config.uniqeness = msg.uniqeness; }
            if (!NoderedUtil.IsNullEmpty(msg.writeconcern)) { this.config.writeconcern = msg.writeconcern; }
            if (!NoderedUtil.IsNullEmpty(msg.journal)) { this.config.journal = msg.journal; }
            // if (NoderedUtil.IsNullEmpty(msg.jwt) && !NoderedUtil.IsNullEmpty(Config.jwt)) {
            //     msg.jwt = Config.jwt;
            // }

            if ((this.config.writeconcern as any) === undefined || (this.config.writeconcern as any) === null) this.config.writeconcern = 0;
            if ((this.config.journal as any) === undefined || (this.config.journal as any) === null) this.config.journal = false;


            var data: any[] = [];
            var _data = NoderedUtil.FetchFromObject(msg, this.config.inputfield);
            if (NoderedUtil.IsNullUndefinded(_data)) { return NoderedUtil.HandleError(this, "Input data is null"); }
            if (!Array.isArray(_data)) { data.push(_data); } else { data = _data; }

            if (data.length === 0) { this.node.warn("input array is empty"); return; }

            // this.node.status({ fill: "blue", shape: "dot", text: "Inserting/updating items" });
            // var Promises: Promise<any>[] = [];
            // for (var i: number = 0; i < data.length; i++) {
            //     var element: any = data[i];
            //     if (!NoderedUtil.IsNullEmpty(this.config.entitytype)) {
            //         element._type = this.config.entitytype;
            //     }
            //     Promises.push(NoderedUtil.InsertOrUpdateOne(this.config.collection, element, this.config.uniqeness, this.config.writeconcern, this.config.journal, msg.jwt));
            // }
            // data = await Promise.all(Promises.map(p => p.catch(e => e)));
            this.node.status({ fill: "blue", shape: "dot", text: "processing ..." });
            var Promises: Promise<any>[] = [];
            var results: any[] = [];
            for (var y: number = 0; y < data.length; y += 50) {
                for (var i: number = y; i < (y + 50) && i < data.length; i++) {
                    var element: any = data[i];
                    if (!NoderedUtil.IsNullEmpty(this.config.entitytype)) {
                        element._type = this.config.entitytype;
                    }
                    Promises.push(NoderedUtil.InsertOrUpdateOne(this.config.collection, element, this.config.uniqeness, this.config.writeconcern, this.config.journal, msg.jwt));
                }
                this.node.status({ fill: "blue", shape: "dot", text: "processing " + y + " to " + (y + 49) });
                var tempresults = await Promise.all(Promises.map(p => p.catch(e => e)));
                results = results.concat(tempresults);
            }
            data = results;

            var errors = data.filter(result => NoderedUtil.IsString(result) || (result instanceof Error));
            if (errors.length > 0) {
                for (var i: number = 0; i < errors.length; i++) {
                    NoderedUtil.HandleError(this, errors[i]);
                }
            }
            data = data.filter(result => !NoderedUtil.IsString(result) && !(result instanceof Error));
            NoderedUtil.saveToObject(msg, this.config.resultfield, data);
            this.node.send(msg);
            this.node.status({});
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    onclose() {
    }
}





export interface Iapi_delete {
    collection: string;
    inputfield: string;
}
export class api_delete {
    public node: Red = null;

    constructor(public config: Iapi_delete) {
        RED.nodes.createNode(this, config);
        this.node = this;
        this.node.status({});
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }
    async oninput(msg: any) {
        try {
            this.node.status({});
            // if (NoderedUtil.IsNullEmpty(msg.jwt)) { return NoderedUtil.HandleError(this, "Missing jwt token"); }

            if (!NoderedUtil.IsNullEmpty(msg.collection)) { this.config.collection = msg.collection; }
            if (!NoderedUtil.IsNullEmpty(msg.inputfield)) { this.config.inputfield = msg.inputfield; }
            // if (NoderedUtil.IsNullEmpty(msg.jwt) && !NoderedUtil.IsNullEmpty(Config.jwt)) {
            //     msg.jwt = Config.jwt;
            // }

            var data: any[] = [];
            var _data = NoderedUtil.FetchFromObject(msg, this.config.inputfield);
            if (NoderedUtil.IsNullUndefinded(_data)) { return NoderedUtil.HandleError(this, "Input data is null"); }
            if (!Array.isArray(_data)) { data.push(_data); } else { data = _data; }

            if (data.length === 0) { this.node.warn("input array is empty"); return; }

            this.node.status({ fill: "blue", shape: "dot", text: "Deleting items" });
            var Promises: Promise<any>[] = [];
            for (var i: number = 0; i < data.length; i++) {
                var element: any = data[i];
                var id: string = element;
                if (NoderedUtil.isObject(element)) { id = element._id; }
                Promises.push(NoderedUtil.DeleteOne(this.config.collection, id, msg.jwt));
            }
            data = await Promise.all(Promises.map(p => p.catch(e => e)));

            var errors = data.filter(result => NoderedUtil.IsString(result) || (result instanceof Error));
            if (errors.length > 0) {
                for (var i: number = 0; i < errors.length; i++) {
                    NoderedUtil.HandleError(this, errors[i]);
                }
            }
            this.node.send(msg);
            this.node.status({});
        } catch (error) {
            NoderedUtil.HandleError(this, error);
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
}
export class api_map_reduce {
    public node: Red = null;

    constructor(public config: Iapi_map_reduce) {
        RED.nodes.createNode(this, config);
        this.node = this;
        this.node.status({});
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }
    async oninput(msg: any) {
        try {
            this.node.status({});
            // if (NoderedUtil.IsNullEmpty(msg.jwt)) { return NoderedUtil.HandleError(this, "Missing jwt token"); }

            if (!NoderedUtil.IsNullEmpty(msg.collection)) { this.config.collection = msg.collection; }
            if (!NoderedUtil.IsNullUndefinded(msg.map)) { this.config.map = msg.map; }
            if (!NoderedUtil.IsNullUndefinded(msg.reduce)) { this.config.reduce = msg.reduce; }
            if (!NoderedUtil.IsNullUndefinded(msg.finalize)) { this.config.finalize = msg.finalize; }
            if (!NoderedUtil.IsNullUndefinded(msg.scope)) { this.config.finalize = msg.scope; }
            if (!NoderedUtil.IsNullUndefinded(msg.query)) { this.config.query = msg.query; }
            // if (NoderedUtil.IsNullEmpty(msg.jwt) && !NoderedUtil.IsNullEmpty(Config.jwt)) {
            //     msg.jwt = Config.jwt;
            // }

            var scope = NoderedUtil.FetchFromObject(msg, this.config.scope);
            var _output: any = {};
            _output[this.config.output] = this.config.outcol;

            if (!NoderedUtil.IsNullEmpty(this.config.query) && NoderedUtil.IsString(this.config.query)) {
                this.config.query = JSON.parse(this.config.query);
            }

            this.node.status({ fill: "blue", shape: "dot", text: "Running mapreduce" });
            var result = await NoderedUtil.MapReduce(this.config.collection, this.config.map, this.config.reduce, this.config.finalize, this.config.query, _output, scope, msg.jwt);
            msg.payload = result;
            this.node.send(msg);
            this.node.status({});
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    onclose() {
    }
}

export async function get_api_roles(req, res) {
    try {
        var rawAssertion = req.user.getAssertionXml();
        var token = await NoderedUtil.GetTokenFromSAML(rawAssertion);
        var q: any = { _type: "role" };
        if (!NoderedUtil.IsNullEmpty(req.query.name)) {
            q = { _type: "role", name: { $regex: ".*" + req.query.name + ".*" } };
        }
        var result: any[] = await NoderedUtil.Query('users', q, { name: 1 }, { name: -1 }, 1000, 0, token.jwt);

        res.json(result);
    } catch (error) {
        res.status(500).json(error);
    }
}


export async function get_api_userroles(req, res) {
    try {
        var rawAssertion = req.user.getAssertionXml();
        var token = await NoderedUtil.GetTokenFromSAML(rawAssertion);
        var q: any = { $or: [{ _type: "role" }, { _type: "user" }] };
        var ors = [];
        if (!NoderedUtil.IsNullEmpty(req.query.name)) {
            ors.push({ name: { $regex: ".*" + req.query.name + ".*" } });
        } else { ors.push({}); }
        if (!NoderedUtil.IsNullEmpty(req.query.id)) {
            ors.push({ _id: req.query.id });
        }
        if (ors.length > 0) {
            q = {
                $and: [
                    { $or: [{ _type: "role" }, { _type: "user" }] },
                    { $or: ors }
                ]
            };
        }

        var result: any[] = await NoderedUtil.Query('users', q, { name: 1 }, { name: -1 }, 100, 0, token.jwt);
        if (!NoderedUtil.IsNullEmpty(req.query.id)) {
            var exists = result.filter(x => x._id == req.query.id);
            if (exists.length == 0) {
                var result2: any[] = await NoderedUtil.Query('users', { _id: req.query.id }, { name: 1 }, { name: -1 }, 1, 0, token.jwt);
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
        var rawAssertion = req.user.getAssertionXml();
        var token = await NoderedUtil.GetTokenFromSAML(rawAssertion);
        var q: any = { _type: "user" };
        var ors = [];
        if (!NoderedUtil.IsNullEmpty(req.query.name)) {
            ors.push({ name: { $regex: ".*" + req.query.name + ".*" } });
        } else { ors.push({}); }
        if (!NoderedUtil.IsNullEmpty(req.query.id)) {
            ors.push({ _id: req.query.id });
        }
        if (ors.length > 0) {
            q = {
                $and: [
                    { _type: "user" },
                    { $or: ors }
                ]
            };
        }

        var result: any[] = await NoderedUtil.Query('users', q, { name: 1 }, { name: -1 }, 100, 0, token.jwt);
        if (!NoderedUtil.IsNullEmpty(req.query.id)) {
            var exists = result.filter(x => x._id == req.query.id);
            if (exists.length == 0) {
                var result2: any[] = await NoderedUtil.Query('users', { _id: req.query.id }, { name: 1 }, { name: -1 }, 1, 0, token.jwt);
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

    constructor(public config: Iapi_updatedocument) {
        RED.nodes.createNode(this, config);
        this.node = this;
        this.node.status({});
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }
    async oninput(msg: any) {
        try {
            this.node.status({});

            var action = this.config.action;
            var query = this.config.query;
            var updatedocument = this.config.updatedocument;
            var collection = this.config.collection;
            var writeconcern = this.config.writeconcern;
            var journal = this.config.journal;
            var jwt = msg.jwt;

            if (!NoderedUtil.IsNullEmpty(msg.action)) { action = msg.action; }
            if (!NoderedUtil.IsNullUndefinded(msg.query)) { query = msg.query; }
            if (!NoderedUtil.IsNullUndefinded(msg.updatedocument)) { updatedocument = msg.updatedocument; }
            if (!NoderedUtil.IsNullEmpty(msg.collection)) { collection = msg.collection; }
            if (!NoderedUtil.IsNullEmpty(msg.writeconcern)) { writeconcern = msg.writeconcern; }
            if (!NoderedUtil.IsNullEmpty(msg.journal)) { journal = msg.journal; }
            // if (NoderedUtil.IsNullEmpty(jwt) && !NoderedUtil.IsNullEmpty(Config.jwt)) {
            //     jwt = Config.jwt;
            // }

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
                var q: UpdateOneMessage = new UpdateOneMessage(); q.collectionname = collection;
                q.item = (updatedocument as any); q.jwt = jwt;
                q.w = writeconcern; q.j = journal; q.query = (query as any);
                q = await NoderedUtil._UpdateOne(q);
                msg.payload = q.result;
                msg.opresult = q.opresult;
            } else {
                // var result = await NoderedUtil.UpdateMany(collection, query, updatedocument, writeconcern, journal, jwt);
                // msg.payload = result;
                var q: UpdateOneMessage = new UpdateOneMessage(); q.collectionname = collection;
                q.item = (updatedocument as any); q.jwt = jwt;
                q.w = writeconcern; q.j = journal; q.query = (query as any);
                q = await NoderedUtil.UpdateMany(q);
                msg.payload = q.result;
                msg.opresult = q.opresult;
            }
            this.node.send(msg);
            this.node.status({});
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    onclose() {
    }
}







export interface Igrant_permission {
    targetid: string;
    entities: any;
    bits: any;
}
export class grant_permission {
    public node: Red = null;

    constructor(public config: Igrant_permission) {
        RED.nodes.createNode(this, config);
        this.node = this;
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }
    async oninput(msg: any) {
        try {
            this.node.status({});

            // if (NoderedUtil.IsNullEmpty(msg.jwt)) { return NoderedUtil.HandleError(this, "Missing jwt token"); }
            if (!NoderedUtil.IsNullEmpty(msg.targetid)) { this.config.targetid = msg.targetid; }
            if (!NoderedUtil.IsNullUndefinded(msg.bits)) { this.config.bits = msg.bits; }


            if (!Array.isArray(this.config.bits)) {
                this.config.bits = this.config.bits.split(',');
            }
            for (var i = 0; i < this.config.bits.length; i++) {
                this.config.bits[i] = parseInt(this.config.bits[i]);
            }

            var result: any[] = await NoderedUtil.Query('users', { _id: this.config.targetid }, { name: 1 }, { name: -1 }, 1, 0, msg.jwt)
            if (result.length === 0) { return NoderedUtil.HandleError(this, "Target " + this.config.targetid + " not found "); }
            var found = result[0];

            var data: any[] = [];
            var _data = NoderedUtil.FetchFromObject(msg, this.config.entities);
            if (NoderedUtil.IsNullUndefinded(_data)) { return NoderedUtil.HandleError(this, "Input data is null"); }
            if (!Array.isArray(_data)) { data.push(_data); } else { data = _data; }
            if (data.length === 0) { this.node.warn("input array is empty"); return; }

            for (var i = 0; i < data.length; i++) {
                if (NoderedUtil.IsNullEmpty(data[i]._type) && !NoderedUtil.IsNullUndefinded(data[i].metadata)) {
                    var metadata: Base = Base.assign(data[i].metadata);
                    metadata.addRight(this.config.targetid, found.name, this.config.bits);
                    data[i].metadata = metadata;
                } else {
                    var entity: Base = Base.assign(data[i]);
                    entity.addRight(this.config.targetid, found.name, this.config.bits);
                    data[i] = entity;
                }
            }
            NoderedUtil.saveToObject(msg, this.config.entities, data);
            this.node.send(msg);
            this.node.status({});
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    onclose() {
    }
}




export interface Irevoke_permission {
    targetid: string;
    entities: any;
    bits: any;
}
export class revoke_permission {
    public node: Red = null;

    constructor(public config: Irevoke_permission) {
        RED.nodes.createNode(this, config);
        this.node = this;
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }
    async oninput(msg: any) {
        try {
            this.node.status({});

            // if (NoderedUtil.IsNullEmpty(msg.jwt)) { return NoderedUtil.HandleError(this, "Missing jwt token"); }
            if (!NoderedUtil.IsNullEmpty(msg.targetid)) { this.config.targetid = msg.targetid; }
            if (!NoderedUtil.IsNullUndefinded(msg.bits)) { this.config.bits = msg.bits; }


            if (!Array.isArray(this.config.bits)) {
                this.config.bits = this.config.bits.split(',');
            }
            for (var i = 0; i < this.config.bits.length; i++) {
                this.config.bits[i] = parseInt(this.config.bits[i]);
            }

            var data: any[] = [];
            var _data = NoderedUtil.FetchFromObject(msg, this.config.entities);
            if (NoderedUtil.IsNullUndefinded(_data)) { return NoderedUtil.HandleError(this, "Input data is null"); }
            if (!Array.isArray(_data)) { data.push(_data); } else { data = _data; }
            if (data.length === 0) { this.node.warn("input array is empty"); return; }

            for (var i = 0; i < data.length; i++) {

                if (NoderedUtil.IsNullEmpty(data[i]._type) && !NoderedUtil.IsNullUndefinded(data[i].metadata)) {
                    var metadata: Base = Base.assign(data[i].metadata);
                    if (this.config.bits.indexOf(-1) > -1) {
                        metadata._acl = metadata._acl.filter((m: any) => { return m._id !== this.config.targetid; });
                    } else {
                        metadata.removeRight(this.config.targetid, this.config.bits);
                    }
                    data[i].metadata = metadata;
                } else {
                    var entity: Base = Base.assign(data[i]);
                    if (this.config.bits.indexOf(-1) > -1) {
                        entity._acl = entity._acl.filter((m: any) => { return m._id !== this.config.targetid; });
                    } else {
                        entity.removeRight(this.config.targetid, this.config.bits);
                    }
                    data[i] = entity;
                }
            }
            NoderedUtil.saveToObject(msg, this.config.entities, data);
            this.node.send(msg);
            this.node.status({});
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    onclose() {
    }
}



export interface Idownload_file {
    fileid: string;
    filename: string;
    name: string;
}
export class download_file {
    public node: Red = null;

    constructor(public config: Idownload_file) {
        RED.nodes.createNode(this, config);
        this.node = this;
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }
    async oninput(msg: any) {
        try {
            this.node.status({});

            var fileid = this.config.fileid;
            var filename = this.config.filename;
            var jwt = msg.jwt;
            if (!NoderedUtil.IsNullEmpty(msg.fileid)) { fileid = msg.fileid; }
            if (!NoderedUtil.IsNullEmpty(msg.filename)) { filename = msg.filename; }
            if (!NoderedUtil.IsNullEmpty(msg.fileid)) { fileid = msg.fileid; }

            if (!NoderedUtil.IsNullEmpty(msg.fileid)) { this.config.fileid = msg.fileid; }
            if (!NoderedUtil.IsNullEmpty(msg.filename)) { this.config.filename = msg.filename; }
            // if (NoderedUtil.IsNullEmpty(jwt) && !NoderedUtil.IsNullEmpty(Config.jwt)) {
            //     jwt = Config.jwt;
            // }

            this.node.status({ fill: "blue", shape: "dot", text: "Getting file" });
            var file = await NoderedUtil.GetFile(filename, fileid, jwt);
            msg.payload = file.file;
            msg.error = file.error;
            msg.filename = file.filename;
            msg.id = file.id;
            msg.mimeType = file.mimeType;
            msg.metadata = file.metadata;
            msg.filename = file.metadata.filename;

            this.node.send(msg);
            this.node.status({});
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    onclose() {
    }
}


export interface Iuploadload_file {
    filename: string;
    mimeType: string;
}
export class upload_file {
    public node: Red = null;

    constructor(public config: Iuploadload_file) {
        RED.nodes.createNode(this, config);
        this.node = this;
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }
    async oninput(msg: any) {
        try {
            this.node.status({});

            var jwt = msg.jwt;
            var filename = this.config.filename;
            var mimeType = this.config.mimeType;
            if (!NoderedUtil.IsNullEmpty(msg.filename)) { filename = msg.filename; }
            if (!NoderedUtil.IsNullEmpty(msg.mimeType)) { mimeType = msg.mimeType; }
            // if (NoderedUtil.IsNullEmpty(jwt) && !NoderedUtil.IsNullEmpty(Config.jwt)) {
            //     jwt = Config.jwt;
            // }


            this.node.status({ fill: "blue", shape: "dot", text: "Saving file" });
            var file = await NoderedUtil.SaveFile(filename, mimeType, msg.metadata, msg.payload, jwt);
            if (!NoderedUtil.IsNullEmpty(file.error)) { throw new Error(file.error); }
            msg.filename = file.filename;
            msg.id = file.id;
            msg.mimeType = file.mimeType;
            msg.metadata = file.metadata;

            this.node.send(msg);
            this.node.status({});
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    onclose() {
    }
}






export interface Iapi_aggregate {
    collection: string;
    aggregates: object[];
}
export class api_aggregate {
    public node: Red = null;

    constructor(public config: Iapi_aggregate) {
        RED.nodes.createNode(this, config);
        this.node = this;
        this.node.status({});
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }
    async oninput(msg: any) {
        try {
            this.node.status({});
            // if (NoderedUtil.IsNullEmpty(msg.jwt)) { return NoderedUtil.HandleError(this, "Missing jwt token"); }

            var collection = this.config.collection;
            var aggregates = this.config.aggregates;

            if (!NoderedUtil.IsNullEmpty(msg.collection)) { collection = msg.collection; }
            if (!NoderedUtil.IsNullEmpty(msg.aggregates)) { aggregates = msg.aggregates; }

            this.node.status({ fill: "blue", shape: "dot", text: "Running aggregate" });
            var result = await NoderedUtil.Aggregate(collection, aggregates, msg.jwt);
            msg.payload = result;
            this.node.send(msg);
            this.node.status({});
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    onclose() {
    }
}


export interface Iapi_watch {
    collection: string;
    aggregates: object[];
}
export class api_watch {
    public node: Red = null;
    public watchid: string = "";
    private _onsignedin: any = null;
    private _onsocketclose: any = null;
    constructor(public config: Iapi_watch) {
        RED.nodes.createNode(this, config);
        this.node = this;
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
        this.node.status({ fill: "red", shape: "dot", text: "Disconnected " + message });
        // this.onclose(false, null);
    }
    async connect() {
        this.node.status({ fill: "blue", shape: "dot", text: "Setting up watch" });
        this.watchid = await NoderedUtil.Watch(this.config.collection, this.config.aggregates, null, this.onevent.bind(this))
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

            var collection = this.config.collection;
            var aggregates = this.config.aggregates;

            if (!NoderedUtil.IsNullEmpty(msg.collection)) { collection = msg.collection; }
            if (!NoderedUtil.IsNullEmpty(msg.aggregates)) { aggregates = msg.aggregates; }

            this.node.status({ fill: "blue", shape: "dot", text: "Running aggregate" });
            var result = await NoderedUtil.Aggregate(collection, aggregates, msg.jwt);
            msg.payload = result;
            this.node.send(msg);
            this.node.status({});
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
    }
    async onclose(removed: boolean, done: any) {
        try {
            this.node.status({ text: "Closing . . ." });
            if (!NoderedUtil.IsNullEmpty(this.watchid)) {
                await NoderedUtil.UnWatch(this.watchid, null);
            }
        } catch (error) {
            NoderedUtil.HandleError(this, error);
        }
        this.watchid = null;
        this.node.status({ text: "Not watching" });
        WebSocketClient.instance.events.removeListener("onsignedin", this._onsignedin);
        WebSocketClient.instance.events.removeListener("onclose", this._onsocketclose);
        if (done != null) done();
    }
}