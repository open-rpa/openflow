import { WebSocketClient, QueuedMessage } from "./WebSocketClient";

function isNumber(value: string | number): boolean {
    return ((value != null) && !isNaN(Number(value.toString())));
}
export class SocketMessage {
    public id: string;
    public replyto: string;
    public command: string;
    public data: string;
    public count: number;
    public index: number;
    public static fromjson(json: string): SocketMessage {
        let result: SocketMessage = new SocketMessage();
        let obj: any = JSON.parse(json);
        result.command = obj.command;
        result.id = obj.id;
        result.replyto = obj.replyto;
        result.count = 1;
        result.index = 0;
        result.data = obj.data;
        if (isNumber(obj.count)) { result.count = obj.count; }
        if (isNumber(obj.index)) { result.index = obj.index; }
        if (result.id === null || result.id === undefined || result.id === "") {
            // result.id = crypto.randomBytes(16).toString("hex");
            result.id = Math.random().toString(36).substr(2, 9);
        }
        return result;
    }
    public static frommessage(msg: Message, data: string, count: number, index: number): SocketMessage {
        var result: SocketMessage = new SocketMessage();
        result.id = msg.id;
        result.replyto = msg.replyto;
        result.command = msg.command;
        result.count = count;
        result.index = index;
        result.data = data;
        return result;
    }
    public static fromcommand(command: string): SocketMessage {
        var result: SocketMessage = new SocketMessage();
        result.command = command;
        result.count = 1;
        result.index = 0;
        result.id = Math.random().toString(36).substr(2, 9);
        return result;
    }

}
export class SigninMessage {
    public error: string;

    public username: string;
    public password: string;
    public validate_only: boolean = false;
    public clientagent: string;
    public clientversion: string;
    public user: TokenUser;
    public jwt: string;
    public rawAssertion: string;
    static assign(o: any): SigninMessage {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new SigninMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new SigninMessage(), o);
    }
}
export class TokenUser {
    _type: string;
    _id: string;
    name: string;
    username: string;
    roles: Rolemember[] = [];
    static assign<T>(o: T): T {
        var newo: TokenUser = new TokenUser();
        return Object.assign(newo, o);
    }
}
export class Rolemember {
    constructor(name: string, _id: string) {
        this.name = name;
        this._id = _id;
    }
    name: string;
    _id: string;
}
export class QueryMessage {
    public error: string;
    public jwt: string;

    public query: any;
    public projection: Object;
    public top: number;
    public skip: number;
    public orderby: Object | string;
    public collectionname: string;
    public result: any[];
    public queryas: string;
    static assign(o: any): QueryMessage {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new QueryMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new QueryMessage(), o);
    }
}
export class AggregateMessage {
    public error: string;
    public jwt: string;

    public aggregates: object[];
    public collectionname: string;
    public result: any[];
    static assign(o: any): AggregateMessage {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new AggregateMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new AggregateMessage(), o);
    }
}
export class InsertOneMessage {
    public error: string;
    public jwt: string;

    // w: 1 - Requests acknowledgment that the write operation has propagated
    // w: 0 - Requests no acknowledgment of the write operation
    // w: 2 would require acknowledgment from the primary and one of the secondaries
    // w: 3 would require acknowledgment from the primary and both secondaries
    public w: number;
    // true, requests acknowledgment that the mongod instances have written to the on-disk journal
    public j: boolean;
    public item: any;
    public collectionname: string;
    public result: any;
    static assign(o: any): InsertOneMessage {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new InsertOneMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new InsertOneMessage(), o);
    }
}
export class UpdateOneMessage {
    public error: string;
    public jwt: string;

    // w: 1 - Requests acknowledgment that the write operation has propagated
    // w: 0 - Requests no acknowledgment of the write operation
    // w: 2 would require acknowledgment from the primary and one of the secondaries
    // w: 3 would require acknowledgment from the primary and both secondaries
    public w: number;
    // true, requests acknowledgment that the mongod instances have written to the on-disk journal
    public j: boolean;
    public item: object;
    public collectionname: string;
    public query: object;
    public result: any;
    public opresult: any;
    static assign(o: any): UpdateOneMessage {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new UpdateOneMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new UpdateOneMessage(), o);
    }
}
export class UpdateManyMessage {
    public error: string;
    public jwt: string;

    // w: 1 - Requests acknowledgment that the write operation has propagated
    // w: 0 - Requests no acknowledgment of the write operation
    // w: 2 would require acknowledgment from the primary and one of the secondaries
    // w: 3 would require acknowledgment from the primary and both secondaries
    public w: number;
    // true, requests acknowledgment that the mongod instances have written to the on-disk journal
    public j: boolean;
    public query: object;
    public item: object;
    public collectionname: string;
    public result: any[];
    static assign(o: any): UpdateManyMessage {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new UpdateManyMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new UpdateManyMessage(), o);
    }
}

export class InsertOrUpdateOneMessage {
    public error: string;
    public jwt: string;

    // w: 1 - Requests acknowledgment that the write operation has propagated
    // w: 0 - Requests no acknowledgment of the write operation
    // w: 2 would require acknowledgment from the primary and one of the secondaries
    // w: 3 would require acknowledgment from the primary and both secondaries
    public w: number;
    // true, requests acknowledgment that the mongod instances have written to the on-disk journal
    public j: boolean;
    public item: object;
    public collectionname: string;
    public uniqeness: string
    public result: any;
    static assign(o: any): InsertOrUpdateOneMessage {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new InsertOrUpdateOneMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new InsertOrUpdateOneMessage(), o);
    }
}

export class DeleteOneMessage {
    public error: string;
    public jwt: string;

    public _id: string;
    public collectionname: string;
    static assign(o: any): DeleteOneMessage {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new DeleteOneMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new DeleteOneMessage(), o);
    }
}



export class GetFileMessage {
    public error: string;
    public jwt: string;

    public filename: string;
    public mimeType: string;
    public id: string;
    public metadata: any;
    public file: string;
    static assign(o: any): GetFileMessage {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new GetFileMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new GetFileMessage(), o);
    }
}
export class SaveFileMessage {
    public error: string;
    public jwt: string;

    public filename: string;
    public mimeType: string;
    public id: string;
    public metadata: any;
    public file: string;
    static assign(o: any): SaveFileMessage {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new SaveFileMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new SaveFileMessage(), o);
    }
}
export declare function emit(k, v);
export type mapFunc = () => void;
export type reduceFunc = (key: string, values: any[]) => any;
export type finalizeFunc = (key: string, value: any) => any;

export class MapReduceMessage<T> {
    public error: string;
    public jwt: string;

    public collectionname: string;
    public result: T[];
    public scope: any;

    constructor(public map: mapFunc, public reduce: reduceFunc, public finalize: finalizeFunc, public query: any, public out: string | any) {
    }
    static assign<T>(o: any): MapReduceMessage<T> {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new MapReduceMessage(null, null, null, null, null), JSON.parse(o.toString()));
        }
        return Object.assign(new MapReduceMessage(null, null, null, null, null), o);
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

export class Message {
    public id: string;
    public replyto: string;
    public command: string;
    public data: string;
    public static frommessage(msg: SocketMessage, data: string): Message {
        var result: Message = new Message();
        result.id = msg.id;
        result.replyto = msg.replyto;
        result.command = msg.command;
        result.data = data;
        return result;
    }

    public Process(cli: WebSocketClient): void {
        try {
            var command: string = "";
            if (this.command !== null && this.command !== undefined) { command = this.command.toLowerCase(); }
            if (this.command !== "ping" && this.command !== "pong") {
                if (this.replyto !== null && this.replyto !== undefined) {
                    var qmsg: QueuedMessage = cli.messageQueue[this.replyto];
                    if (qmsg !== undefined && qmsg !== null) {
                        qmsg.message = Object.assign(qmsg.message, JSON.parse(this.data));
                        if (qmsg.cb !== undefined && qmsg.cb !== null) { qmsg.cb(qmsg.message); }
                        delete cli.messageQueue[this.id];
                    }
                    return;
                }
            }
            switch (command) {
                case "ping":
                    this.Ping(cli);
                    break;
                case "pong":
                    break;
                case "signin":
                    this.Signin(cli);
                    break;
                case "refreshtoken":
                    this.RefreshToken(cli);
                    break;
                default:
                    console.error("Unknown command " + command);
                    this.UnknownCommand(cli);
                    break;
            }
        } catch (error) {
            console.error(error);
        }
    }
    public async Send(cli: WebSocketClient): Promise<void> {
        await cli.Send(this);
    }
    private async UnknownCommand(cli: WebSocketClient): Promise<void> {
        this.Reply("error");
        this.data = "Unknown command";
        await this.Send(cli);
    }
    private async Ping(cli: WebSocketClient): Promise<void> {
        this.Reply("pong");
        await this.Send(cli);
    }
    public Reply(command: string): void {
        this.command = command;
        this.replyto = this.id;
        this.id = Math.random().toString(36).substr(2, 9);
    }
    private Signin(cli: WebSocketClient): void {
        var msg: SigninMessage = SigninMessage.assign(this.data);
        cli.jwt = msg.jwt;
        cli.user = msg.user;
        var qmsg: QueuedMessage = cli.messageQueue[this.replyto];
        if (qmsg !== undefined && qmsg !== null) {
            if (qmsg.cb !== undefined && qmsg.cb !== null) { qmsg.cb(msg); }
            delete cli.messageQueue[this.id];
        }
    }
    private RefreshToken(cli: WebSocketClient): void {
        var msg: SigninMessage = SigninMessage.assign(this.data);
        cli.jwt = msg.jwt;
        cli.user = msg.user;
    }
    private Query(cli: WebSocketClient): void {
        var msg: QueryMessage = QueryMessage.assign(this.data);
        var qmsg: QueuedMessage = cli.messageQueue[this.replyto];
        if (qmsg !== undefined && qmsg !== null) {
            if (qmsg.cb !== undefined && qmsg.cb !== null) { qmsg.cb(msg); }
            delete cli.messageQueue[this.id];
        }

    }
}
