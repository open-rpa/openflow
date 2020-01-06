import { Red } from "node-red";
import { QueryMessage, Message, InsertOneMessage, UpdateOneMessage, DeleteOneMessage, InsertOrUpdateOneMessage, SigninMessage, TokenUser, mapFunc, reduceFunc, finalizeFunc, MapReduceMessage, JSONfn, UpdateManyMessage, GetFileMessage, SaveFileMessage, AggregateMessage } from "../../Message";
import { WebSocketClient } from "../../WebSocketClient";
import { Crypt } from "../../Crypt";
import { Config } from "../../Config";
import { Logger } from "../../Logger";

export class NoderedUtil {
    public static IsNullUndefinded(obj: any) {
        if (obj === null || obj === undefined) { return true; }
        return false;
    }
    public static IsNullEmpty(obj: any) {
        if (obj === null || obj === undefined || obj === "") { return true; }
        return false;
    }
    public static IsString(obj: any) {
        if (typeof obj === 'string' || obj instanceof String) { return true; }
        return false;
    }
    public static isObject(obj: any): boolean {
        return obj === Object(obj);
    }
    public static FetchFromObject(obj: any, prop: string): any {
        if (typeof obj === 'undefined') {
            return false;
        }
        var _index = prop.indexOf('.')
        if (_index > -1) {
            return NoderedUtil.FetchFromObject(obj[prop.substring(0, _index)], prop.substr(_index + 1));
        }
        return obj[prop];
    }
    public static saveToObject(obj: any, path: string, value: any): any {
        const pList = path.split('.');
        const key = pList.pop();
        const pointer = pList.reduce((accumulator, currentValue) => {
            if (accumulator[currentValue] === undefined) accumulator[currentValue] = {};
            return accumulator[currentValue];
        }, obj);
        if (NoderedUtil.isObject(pointer)) {
            pointer[key] = value;
        } else {
            throw new Error(path + ' is not an object!')
        }
        return obj;
    }
    public static HandleError(node: Red, error: any): void {
        console.error(error);
        var message: string = error;
        if (typeof error === "string" || error instanceof String) {
            error = new Error((error as string));
        }
        try {
            if (error.message) {
                message = error.message;
                //node.error(error, message);
                node.error(message, error);
            } else {
                //node.error(error, message);
                node.error(message, error);
            }
        } catch (error) {
            console.error(error);
        }
        try {
            if (NoderedUtil.IsNullUndefinded(message)) { message = ""; }
            node.status({ fill: "red", shape: "dot", text: message.toString().substr(0, 32) });
        } catch (error) {
            console.error(error);
        }
    }




    public static async Query(collection: string, query: any, projection: any, orderby: any, top: number, skip: number, jwt: string, queryas: string = null): Promise<any[]> {
        var q: QueryMessage = new QueryMessage(); q.collectionname = collection;
        q.orderby = orderby; q.projection = projection; q.queryas = queryas;
        //q.query = query;
        q.query = JSON.stringify(query, (key, value) => {
            var t = typeof value;
            if (value instanceof RegExp)
                return ("__REGEXP " + value.toString());
            else if (t == "object") {
                if (value.constructor != null && value.constructor.name === "RegExp") {
                    return ("__REGEXP " + value.toString());
                }
                return value;
            }
            else
                return value;

        });
        q.skip = skip; q.top = top; q.jwt = jwt;
        var _msg: Message = new Message();
        _msg.command = "query"; _msg.data = JSON.stringify(q);
        var result: QueryMessage = await WebSocketClient.instance.Send<QueryMessage>(_msg);
        return result.result;
    }
    public static async InsertOne(collection: string, item: any, w: number, j: boolean, jwt: string): Promise<any> {
        var q: InsertOneMessage = new InsertOneMessage(); q.collectionname = collection;
        q.item = item; q.jwt = jwt;
        q.w = w; q.j = j;
        var _msg: Message = new Message();
        _msg.command = "insertone"; _msg.data = JSON.stringify(q);
        var result: QueryMessage = await WebSocketClient.instance.Send<QueryMessage>(_msg);
        return result.result;
    }
    public static async _UpdateOne(collection: string, query: any, item: any, w: number, j: boolean, jwt: string): Promise<any> {
        var q: UpdateOneMessage = new UpdateOneMessage(); q.collectionname = collection;
        q.item = item; q.jwt = jwt;
        q.w = w; q.j = j; q.query = query;
        q = await this.UpdateOne(q);
        return q.result;
    }
    public static async UpdateOne(q: UpdateOneMessage): Promise<UpdateOneMessage> {
        var _msg: Message = new Message();
        _msg.command = "updateone"; _msg.data = JSON.stringify(q);
        var result: UpdateOneMessage = await WebSocketClient.instance.Send<UpdateOneMessage>(_msg);
        return result;
    }
    //public static async UpdateMany(collection: string, query: any, item: any, w: number, j: boolean, jwt: string): Promise<any> {
    public static async UpdateMany(q: UpdateManyMessage): Promise<any> {
        var _msg: Message = new Message();
        _msg.command = "updatemany"; _msg.data = JSON.stringify(q);
        var result: UpdateOneMessage = await WebSocketClient.instance.Send<UpdateOneMessage>(_msg);
        return result;
    }
    public static async InsertOrUpdateOne(collection: string, item: any, uniqeness: string, w: number, j: boolean, jwt: string): Promise<any> {
        var q: InsertOrUpdateOneMessage = new InsertOrUpdateOneMessage(); q.collectionname = collection;
        q.item = item; q.jwt = jwt; q.uniqeness = uniqeness;
        q.w = w; q.j = j;
        var _msg: Message = new Message();
        _msg.command = "insertorupdateone"; _msg.data = JSON.stringify(q);
        var result: QueryMessage = await WebSocketClient.instance.Send<QueryMessage>(_msg);
        return result.result;
    }

    public static async DeleteOne(collection: string, id: string, jwt: string): Promise<any> {
        var q: DeleteOneMessage = new DeleteOneMessage(); q.collectionname = collection;
        q._id = id; q.jwt = jwt;
        var _msg: Message = new Message();
        _msg.command = "deleteone"; _msg.data = JSON.stringify(q);
        var result: QueryMessage = await WebSocketClient.instance.Send<QueryMessage>(_msg);
        return result.result;
    }

    public static async MapReduce(collection: string, map: mapFunc, reduce: reduceFunc, finalize: finalizeFunc, query: any, out: string | any, scope: any, jwt: string): Promise<any> {
        var q: MapReduceMessage<any> = new MapReduceMessage(map, reduce, finalize, query, out);
        q.collectionname = collection; q.scope = scope; q.jwt = jwt;
        var msg: Message = new Message(); msg.command = "mapreduce"; q.out = out;
        msg.data = JSONfn.stringify(q);
        var result: QueryMessage = await WebSocketClient.instance.Send<QueryMessage>(msg);
        return result.result;
    }

    public static async Aggregate(collection: string, aggregates: object[], jwt: string): Promise<any> {
        var q: AggregateMessage = new AggregateMessage();
        q.collectionname = collection; q.aggregates = aggregates; q.jwt = jwt;
        var msg: Message = new Message(); msg.command = "aggregate";
        msg.data = JSONfn.stringify(q);
        var result: QueryMessage = await WebSocketClient.instance.Send<QueryMessage>(msg);
        return result.result;
    }

    public static async GetFile(filename: string, id: string, jwt: string): Promise<GetFileMessage> {
        var q: GetFileMessage = new GetFileMessage(); q.filename = filename;
        q.id = id; q.jwt = jwt;
        var msg: Message = new Message(); msg.command = "getfile";
        msg.data = JSONfn.stringify(q);
        var result: GetFileMessage = await WebSocketClient.instance.Send<GetFileMessage>(msg);
        return result;
    }

    public static async SaveFile(filename: string, mimeType: string, metadata: any, file: string, jwt: string): Promise<SaveFileMessage> {
        var q: SaveFileMessage = new SaveFileMessage();
        q.filename = filename;
        q.mimeType = mimeType; q.file = file; q.jwt = jwt;
        q.metadata = metadata;
        var msg: Message = new Message(); msg.command = "savefile";
        msg.data = JSONfn.stringify(q);
        var result: SaveFileMessage = await WebSocketClient.instance.Send<SaveFileMessage>(msg);
        return result;
    }

    static isNumeric(num) {
        return !isNaN(num)
    }
    public static async GetToken(username: string, password: string): Promise<SigninMessage> {
        var q: SigninMessage = new SigninMessage(); q.validate_only = true;
        q.clientagent = "nodered";
        q.clientversion = Config.version;
        if (!NoderedUtil.IsNullEmpty(username) && !NoderedUtil.IsNullEmpty(password)) {
            q.username = username; q.password = password;
        } else {
            var user = new TokenUser();
            Logger.instanse.debug("GetToken::nodered_id: " + Config.nodered_id);
            Logger.instanse.debug("GetToken::isNumeric: " + this.isNumeric(Config.nodered_id));
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
                throw new Error("root signin not allowed");
            }
        }
        var _msg: Message = new Message();
        _msg.command = "signin"; _msg.data = JSON.stringify(q);
        var result: SigninMessage = await WebSocketClient.instance.Send<SigninMessage>(_msg);
        Logger.instanse.debug("Created token as " + result.user.username);
        return result;
    }
    public static async GetTokenFromSAML(rawAssertion: string): Promise<SigninMessage> {
        var q: SigninMessage = new SigninMessage(); q.validate_only = true;
        q.clientagent = "nodered";
        q.clientversion = Config.version;
        q.rawAssertion = rawAssertion;
        var _msg: Message = new Message();
        _msg.command = "signin"; _msg.data = JSON.stringify(q);
        var result: SigninMessage = await WebSocketClient.instance.Send<SigninMessage>(_msg);
        Logger.instanse.debug("Created token as " + result.user.username);
        return result;
    }
}