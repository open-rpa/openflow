import * as RED from "node-red";
import { Red } from "node-red";
import { TokenUser, SigninMessage, Message, QueryMessage, mapFunc, reduceFunc, finalizeFunc } from "../../Message";
import { Crypt } from "../../Crypt";
import { WebSocketClient } from "../../WebSocketClient";
import { NoderedUtil } from "./NoderedUtil";
import { Base } from "../../Base";



export interface Iapi_credentials {
}
export class api_credentials {
    public node:Red = null;
    public name:string = "";
    public username:string = "";
    public password:string = "";
    constructor(public config: Iapi_get_jwt) {
        RED.nodes.createNode(this,config);
        this.node = this;
        if (this.node.credentials && this.node.credentials.hasOwnProperty("username")) {
            this.username = this.node.credentials.username;
        }
        if (this.node.credentials && this.node.credentials.hasOwnProperty("password")) {
            this.password = this.node.credentials.password;
        }
    }
}
export interface Iapi_get_jwt {
    config:any;
}
export class api_get_jwt {
    public node:Red = null;
    public name:string = "";
    constructor(public config: Iapi_get_jwt) {
        RED.nodes.createNode(this,config);
        this.node = this;
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }
    async oninput(msg:any) {
        try {
            this.node.status({});

            let username:string = null;
            let password:string = null;
            var config:api_credentials = RED.nodes.getNode(this.config.config);
            if(!NoderedUtil.IsNullUndefinded(config) && !NoderedUtil.IsNullEmpty(config.username)) {
                username = config.username;
            }
            if(!NoderedUtil.IsNullUndefinded(config) && !NoderedUtil.IsNullEmpty(config.password)) {
                password = config.password;
            }
            if(!NoderedUtil.IsNullEmpty(msg.username)) { username = msg.username; }
            if(!NoderedUtil.IsNullEmpty(msg.password)) { username = msg.password; }
    
            var q:SigninMessage = new SigninMessage(); q.validate_only = true;
            if(!NoderedUtil.IsNullEmpty(username)  && !NoderedUtil.IsNullEmpty(password)) {
                q.username = username; q.password = password;
            } else {
                if(Crypt.encryption_key === "") { return NoderedUtil.HandleError(this, "root signin not allowed"); }
                var user = new TokenUser(); user.name = "root"; user.username = "root";
                q.jwt = Crypt.createToken(user);
            }
            this.node.status({fill:"blue",shape:"dot",text:"Requesting token"});
            var _msg:Message = new Message();
            _msg.command = "signin"; _msg.data = JSON.stringify(q);
            var result:SigninMessage = await WebSocketClient.instance.Send<SigninMessage>(_msg);
            msg.jwt = result.jwt;
            msg.user = result.user;
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
    resultfield:string;
    collection:string;
    query:any;
    projection:any;
    orderby:any;
    top:number;
    skip:number;
}
export class api_get {
    public node:Red = null;

    constructor(public config: Iapi_get) {
        RED.nodes.createNode(this,config);
        this.node = this;
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }
    async oninput(msg:any) {
        try {
            this.node.status({});
            if(NoderedUtil.IsNullEmpty(msg.jwt)) return NoderedUtil.HandleError(this, "Missing jwt token");
            if(!NoderedUtil.IsNullUndefinded(msg.query)) { this.config.query = msg.query; }
            if(!NoderedUtil.IsNullUndefinded(msg.projection)) { this.config.projection = msg.projection; }
            if(!NoderedUtil.IsNullUndefinded(msg.orderby)) { this.config.orderby = msg.orderby; }
            if(!NoderedUtil.IsNullEmpty(msg.top)) { this.config.top = parseInt(msg.top); }
            if(!NoderedUtil.IsNullEmpty(msg.skip)) { this.config.skip = parseInt(msg.skip); }

            if(NoderedUtil.IsNullEmpty(this.config.top)) { this.config.top = 500; }
            if(NoderedUtil.IsNullEmpty(this.config.skip)) { this.config.skip = 0; }
            if(!NoderedUtil.IsNullEmpty(this.config.orderby) && NoderedUtil.IsString(this.config.orderby)) { 
                var field:string = this.config.orderby;
                this.config.orderby = {};
                this.config.orderby[field] = -1;
            }
            if(NoderedUtil.IsNullEmpty(this.config.query)) { 
                this.config.query = {}; 
            } else if (NoderedUtil.IsString(this.config.query)) { 
                this.config.query = JSON.parse(this.config.query); 
            }
            if(NoderedUtil.IsNullEmpty(this.config.projection)) { 
                this.config.projection = {}; 
            } else if (NoderedUtil.IsString(this.config.projection)) { 
                this.config.projection = JSON.parse(this.config.projection); 
            }
            if(NoderedUtil.IsNullEmpty(this.config.projection)) { this.config.projection = null; }

            this.node.status({fill:"blue",shape:"dot",text:"Getting query"});
            var result:any[] = await NoderedUtil.Query(this.config.collection, this.config.query, 
                this.config.projection, this.config.orderby, parseInt(this.config.top as any), parseInt(this.config.skip as any), msg.jwt)
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
    entitytype:string;
    collection:string;
    inputfield:string;
    resultfield:string;
}
export class api_add {
    public node:Red = null;

    constructor(public config: Iapi_add) {
        RED.nodes.createNode(this,config);
        this.node = this;
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }
    async oninput(msg:any) {
        try {
            this.node.status({});
            if(NoderedUtil.IsNullEmpty(msg.jwt)) { return NoderedUtil.HandleError(this, "Missing jwt token"); }

            if(!NoderedUtil.IsNullEmpty(msg.entitytype)) { this.config.entitytype = msg.entitytype; }
            if(!NoderedUtil.IsNullEmpty(msg.collection)) { this.config.collection = msg.collection; }
            if(!NoderedUtil.IsNullEmpty(msg.inputfield)) { this.config.inputfield = msg.inputfield; }
            if(!NoderedUtil.IsNullEmpty(msg.resultfield)) { this.config.resultfield = msg.resultfield; }

            var data:any[] = [];
            var _data = NoderedUtil.FetchFromObject(msg, this.config.inputfield);
            if(NoderedUtil.IsNullUndefinded(_data)) { return NoderedUtil.HandleError(this, "Input data is null"); }
            if(!Array.isArray(_data)) { data.push(_data); } else { data = _data; }

            if(data.length === 0) { this.node.warn("input array is empty"); return; }

            this.node.status({fill:"blue",shape:"dot",text:"Inserting items"});
            var Promises:Promise<any>[] = [];
            for(var i:number=0; i < data.length; i++) {
                var element:any = data[i];
                Promises.push(NoderedUtil.InsertOne(this.config.collection, element, msg.jwt));
            }
            data = await Promise.all(Promises.map(p => p.catch(e => e)));

            var errors = data.filter(result => NoderedUtil.IsString(result) || (result instanceof Error));
            if(errors.length>0) {
                for(var i:number=0; i < errors.length; i++) {
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
    entitytype:string;
    collection:string;
    inputfield:string;
    resultfield:string;
}
export class api_update {
    public node:Red = null;

    constructor(public config: Iapi_update) {
        RED.nodes.createNode(this,config);
        this.node = this;
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }
    async oninput(msg:any) {
        try {
            this.node.status({});
            if(NoderedUtil.IsNullEmpty(msg.jwt)) { return NoderedUtil.HandleError(this, "Missing jwt token"); }

            if(!NoderedUtil.IsNullEmpty(msg.entitytype)) { this.config.entitytype = msg.entitytype; }
            if(!NoderedUtil.IsNullEmpty(msg.collection)) { this.config.collection = msg.collection; }
            if(!NoderedUtil.IsNullEmpty(msg.inputfield)) { this.config.inputfield = msg.inputfield; }
            if(!NoderedUtil.IsNullEmpty(msg.resultfield)) { this.config.resultfield = msg.resultfield; }

            var data:any[] = [];
            var _data = NoderedUtil.FetchFromObject(msg, this.config.inputfield);
            if(NoderedUtil.IsNullUndefinded(_data)) { return NoderedUtil.HandleError(this, "Input data is null"); }
            if(!Array.isArray(_data)) { data.push(_data); } else { data = _data; }

            if(data.length === 0) { this.node.warn("input array is empty"); return; }

            this.node.status({fill:"blue",shape:"dot",text:"Inserting items"});
            var Promises:Promise<any>[] = [];
            for(var i:number=0; i < data.length; i++) {
                var element:any = data[i];
                Promises.push(NoderedUtil.UpdateOne(this.config.collection, element, msg.jwt));
            }
            data = await Promise.all(Promises.map(p => p.catch(e => e)));

            var errors = data.filter(result => NoderedUtil.IsString(result) || (result instanceof Error));
            if(errors.length>0) {
                for(var i:number=0; i < errors.length; i++) {
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
    entitytype:string;
    collection:string;
    inputfield:string;
    resultfield:string;
    uniqeness:string;
}
export class api_addorupdate {
    public node:Red = null;

    constructor(public config: Iapi_addorupdate) {
        RED.nodes.createNode(this,config);
        this.node = this;
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }
    async oninput(msg:any) {
        try {
            this.node.status({});
            if(NoderedUtil.IsNullEmpty(msg.jwt)) { return NoderedUtil.HandleError(this, "Missing jwt token"); }

            if(!NoderedUtil.IsNullEmpty(msg.entitytype)) { this.config.entitytype = msg.entitytype; }
            if(!NoderedUtil.IsNullEmpty(msg.collection)) { this.config.collection = msg.collection; }
            if(!NoderedUtil.IsNullEmpty(msg.inputfield)) { this.config.inputfield = msg.inputfield; }
            if(!NoderedUtil.IsNullEmpty(msg.resultfield)) { this.config.resultfield = msg.resultfield; }
            if(!NoderedUtil.IsNullEmpty(msg.uniqeness)) { this.config.uniqeness = msg.uniqeness; }


            var data:any[] = [];
            var _data = NoderedUtil.FetchFromObject(msg, this.config.inputfield);
            if(NoderedUtil.IsNullUndefinded(_data)) { return NoderedUtil.HandleError(this, "Input data is null"); }
            if(!Array.isArray(_data)) { data.push(_data); } else { data = _data; }

            if(data.length === 0) { this.node.warn("input array is empty"); return; }

            this.node.status({fill:"blue",shape:"dot",text:"Inserting/updating items"});
            var Promises:Promise<any>[] = [];
            for(var i:number=0; i < data.length; i++) {
                var element:any = data[i];
                Promises.push(NoderedUtil.InsertOrUpdateOne(this.config.collection, element, this.config.uniqeness, msg.jwt));
            }
            data = await Promise.all(Promises.map(p => p.catch(e => e)));

            var errors = data.filter(result => NoderedUtil.IsString(result) || (result instanceof Error));
            if(errors.length>0) {
                for(var i:number=0; i < errors.length; i++) {
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
    collection:string;
    inputfield:string;
}
export class api_delete {
    public node:Red = null;

    constructor(public config: Iapi_delete) {
        RED.nodes.createNode(this,config);
        this.node = this;
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }
    async oninput(msg:any) {
        try {
            this.node.status({});
            if(NoderedUtil.IsNullEmpty(msg.jwt)) { return NoderedUtil.HandleError(this, "Missing jwt token"); }

            if(!NoderedUtil.IsNullEmpty(msg.collection)) { this.config.collection = msg.collection; }
            if(!NoderedUtil.IsNullEmpty(msg.inputfield)) { this.config.inputfield = msg.inputfield; }

            var data:any[] = [];
            var _data = NoderedUtil.FetchFromObject(msg, this.config.inputfield);
            if(NoderedUtil.IsNullUndefinded(_data)) { return NoderedUtil.HandleError(this, "Input data is null"); }
            if(!Array.isArray(_data)) { data.push(_data); } else { data = _data; }

            if(data.length === 0) { this.node.warn("input array is empty"); return; }

            this.node.status({fill:"blue",shape:"dot",text:"Deleting items"});
            var Promises:Promise<any>[] = [];
            for(var i:number=0; i < data.length; i++) {
                var element:any = data[i];
                var id:string = element;
                if(NoderedUtil.isObject(element)) { id = element._id; }
                Promises.push(NoderedUtil.DeleteOne(this.config.collection, id, msg.jwt));
            }
            data = await Promise.all(Promises.map(p => p.catch(e => e)));

            var errors = data.filter(result => NoderedUtil.IsString(result) || (result instanceof Error));
            if(errors.length>0) {
                for(var i:number=0; i < errors.length; i++) {
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
    collection:string;
    map:mapFunc;
    reduce:reduceFunc;
    finalize:finalizeFunc;
    scope:any;
    output:string;
    outcol:string;
    query:string;
}
export class api_map_reduce {
    public node:Red = null;

    constructor(public config: Iapi_map_reduce) {
        RED.nodes.createNode(this,config);
        this.node = this;
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }
    async oninput(msg:any) {
        try {
            this.node.status({});
            if(NoderedUtil.IsNullEmpty(msg.jwt)) { return NoderedUtil.HandleError(this, "Missing jwt token"); }

            if(!NoderedUtil.IsNullEmpty(msg.collection)) { this.config.collection = msg.collection; }
            if(!NoderedUtil.IsNullUndefinded(msg.map)) { this.config.map = msg.map; }
            if(!NoderedUtil.IsNullUndefinded(msg.reduce)) { this.config.reduce = msg.reduce; }
            if(!NoderedUtil.IsNullUndefinded(msg.finalize)) { this.config.finalize = msg.finalize; }
            if(!NoderedUtil.IsNullUndefinded(msg.scope)) { this.config.finalize = msg.scope; }
            if(!NoderedUtil.IsNullUndefinded(msg.query)) { this.config.query = msg.query; }

            var scope = NoderedUtil.FetchFromObject(msg, this.config.scope);
            var _output:any = {};
            _output[this.config.output] = this.config.outcol;

            if(!NoderedUtil.IsNullEmpty(this.config.query) && NoderedUtil.IsString(this.config.query)) { 
                this.config.query = JSON.parse(this.config.query);
            }

            this.node.status({fill:"blue",shape:"dot",text:"Running mapreduce"});
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

export async function get_api_roles(req,res) {
    var token = await NoderedUtil.GetToken(null, null);
    var result:any[] = await NoderedUtil.Query('users', {_type:"role"}, 
        {name:1}, {name:-1}, 1000, 0, token.jwt)
    res.json(result);
}



export interface Igrant_permission {
    targetid:string;
    entities:any;
    bits:any;
}
export class grant_permission {
    public node:Red = null;

    constructor(public config: Igrant_permission) {
        RED.nodes.createNode(this,config);
        this.node = this;
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }
    async oninput(msg:any) {
        try {
            this.node.status({});

            if(NoderedUtil.IsNullEmpty(msg.jwt)) { return NoderedUtil.HandleError(this, "Missing jwt token"); }
            if(!NoderedUtil.IsNullEmpty(msg.targetid)) { this.config.targetid = msg.targetid; }
            if(!NoderedUtil.IsNullUndefinded(msg.bits)) { this.config.bits = msg.bits; }
            

            if(!Array.isArray(this.config.bits)) {
                this.config.bits = this.config.bits.split(',');
            }
            for(var i=0;i<this.config.bits.length; i++) {
                this.config.bits[i] = parseInt(this.config.bits[i]);
            }

            var result:any[] = await NoderedUtil.Query('users', {_id:this.config.targetid}, {name:1}, {name:-1}, 1, 0, msg.jwt)
            if(result.length === 0) { return NoderedUtil.HandleError(this, "Target " + this.config.targetid + " not found "); }
            var found = result[0];
            
            var data:any[] = [];
            var _data = NoderedUtil.FetchFromObject(msg, this.config.entities);
            if(NoderedUtil.IsNullUndefinded(_data)) { return NoderedUtil.HandleError(this, "Input data is null"); }
            if(!Array.isArray(_data)) { data.push(_data); } else { data = _data; }
            if(data.length === 0) { this.node.warn("input array is empty"); return; }

            for(var i = 0; i < data.length; i++) {
                var entity:Base = Base.assign(data[i]);
                entity.addRight(this.config.targetid, found.name, this.config.bits);
                data[i] = entity;
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
    targetid:string;
    entities:any;
    bits:any;
}
export class revoke_permission {
    public node:Red = null;

    constructor(public config: Irevoke_permission) {
        RED.nodes.createNode(this,config);
        this.node = this;
        this.node.on("input", this.oninput);
        this.node.on("close", this.onclose);
    }
    async oninput(msg:any) {
        try {
            this.node.status({});

            if(NoderedUtil.IsNullEmpty(msg.jwt)) { return NoderedUtil.HandleError(this, "Missing jwt token"); }
            if(!NoderedUtil.IsNullEmpty(msg.targetid)) { this.config.targetid = msg.targetid; }
            if(!NoderedUtil.IsNullUndefinded(msg.bits)) { this.config.bits = msg.bits; }
            

            if(!Array.isArray(this.config.bits)) {
                this.config.bits = this.config.bits.split(',');
            }
            for(var i=0;i<this.config.bits.length; i++) {
                this.config.bits[i] = parseInt(this.config.bits[i]);
            }

            var data:any[] = [];
            var _data = NoderedUtil.FetchFromObject(msg, this.config.entities);
            if(NoderedUtil.IsNullUndefinded(_data)) { return NoderedUtil.HandleError(this, "Input data is null"); }
            if(!Array.isArray(_data)) { data.push(_data); } else { data = _data; }
            if(data.length === 0) { this.node.warn("input array is empty"); return; }

            for(var i = 0; i < data.length; i++) {
                var entity:Base = Base.assign(data[i]);
                if(this.config.bits.indexOf(-1)>-1) {
                    entity._acl = entity._acl.filter((m: any) => { return m._id!==this.config.targetid;});
                } else {
                    entity.removeRight(this.config.targetid, this.config.bits);
                }
                data[i] = entity;
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
