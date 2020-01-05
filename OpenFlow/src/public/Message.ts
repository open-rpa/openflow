function isNumber(value: string | number): boolean {
    return ((value != null) && !isNaN(Number(value.toString())));
}
module openflow {
    "use strict";
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

    }
    export class SigninMessage {
        public error: string;

        public clientagent: string;
        public clientversion: string;
        public impersonate: string;
        public realm: string;
        public firebasetoken: string;
        public onesignalid: string;
        public device: any;
        public gpslocation: any;
        public username: string;
        public password: string;
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
    export class ListCollectionsMessage {
        public error: string;
        public jwt: string;
        public result: any;
    }
    export class DropCollectionMessage {
        public error: string;
        public jwt: string;
        public collectionname: string;
    }
    export class QueryMessage {
        public error: string;

        public query: any;
        public projection: Object;
        public top: number;
        public skip: number;
        public orderby: Object | string;
        public collectionname: string;
        public queryas: string;
        public result: any[];
        static assign(o: any): QueryMessage {
            if (typeof o === "string" || o instanceof String) {
                return Object.assign(new QueryMessage(), JSON.parse(o.toString()));
            }
            return Object.assign(new QueryMessage(), o);
        }
    }
    export class MapReduceMessage implements IReplyMessage {
        public error: string;
        public jwt: string;

        public scope: any;
        public collectionname: string;
        public result: any[];

        constructor(public map: mapFunc, public reduce: reduceFunc, public finalize: finalizeFunc, public query: any, public out: string) {
        }
        static assign<T>(o: any): MapReduceMessage {
            if (typeof o === "string" || o instanceof String) {
                return Object.assign(new MapReduceMessage(null, null, null, null, null), JSON.parse(o.toString()));
            }
            return Object.assign(new MapReduceMessage(null, null, null, null, null), o);
        }
    }

    export class AggregateMessage {
        public error: string;
        public jwt: any;

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
        public jwt: any;

        public item: object;
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
        public jwt: any;

        public item: object;
        public collectionname: string;
        public result: any;
        static assign(o: any): UpdateOneMessage {
            if (typeof o === "string" || o instanceof String) {
                return Object.assign(new UpdateOneMessage(), JSON.parse(o.toString()));
            }
            return Object.assign(new UpdateOneMessage(), o);
        }
    }
    export class DeleteOneMessage {
        public error: string;
        public jwt: any;

        public _id: string;
        public collectionname: string;
        static assign(o: any): DeleteOneMessage {
            if (typeof o === "string" || o instanceof String) {
                return Object.assign(new DeleteOneMessage(), JSON.parse(o.toString()));
            }
            return Object.assign(new DeleteOneMessage(), o);
        }
    }


    export class RegisterQueueMessage {
        public error: string;
        public jwt: any;

        public queuename: string;
        static assign(o: any): RegisterQueueMessage {
            if (typeof o === "string" || o instanceof String) {
                return Object.assign(new RegisterQueueMessage(), JSON.parse(o.toString()));
            }
            return Object.assign(new RegisterQueueMessage(), o);
        }
    }
    export class QueueMessage {
        public error: string;
        public jwt: any;

        public correlationId: string;
        public replyto: string;
        public queuename: string;
        public data: any;
        static assign(o: any): QueueMessage {
            if (typeof o === "string" || o instanceof String) {
                return Object.assign(new QueueMessage(), JSON.parse(o.toString()));
            }
            return Object.assign(new QueueMessage(), o);
        }
    }
    export class GetNoderedInstanceMessage {
        public error: string;
        public jwt: any;
        public name: string;
        public result: any;
        static assign(o: any): GetNoderedInstanceMessage {
            if (typeof o === "string" || o instanceof String) {
                return Object.assign(new GetNoderedInstanceMessage(), JSON.parse(o.toString()));
            }
            return Object.assign(new GetNoderedInstanceMessage(), o);
        }
    }
    export class GetNoderedInstanceLogMessage {
        public error: string;
        public jwt: any;
        public name: string;
        public result: string;
        static assign(o: any): GetNoderedInstanceMessage {
            if (typeof o === "string" || o instanceof String) {
                return Object.assign(new GetNoderedInstanceMessage(), JSON.parse(o.toString()));
            }
            return Object.assign(new GetNoderedInstanceMessage(), o);
        }
    }
    export class EnsureNoderedInstanceMessage {
        public error: string;
        public jwt: any;
        public name: string;
        static assign(o: any): EnsureNoderedInstanceMessage {
            if (typeof o === "string" || o instanceof String) {
                return Object.assign(new EnsureNoderedInstanceMessage(), JSON.parse(o.toString()));
            }
            return Object.assign(new EnsureNoderedInstanceMessage(), o);
        }
    }
    export class DeleteNoderedInstanceMessage {
        public error: string;
        public jwt: any;
        public name: string;
        static assign(o: any): DeleteNoderedInstanceMessage {
            if (typeof o === "string" || o instanceof String) {
                return Object.assign(new DeleteNoderedInstanceMessage(), JSON.parse(o.toString()));
            }
            return Object.assign(new DeleteNoderedInstanceMessage(), o);
        }
    }
    export class RestartNoderedInstanceMessage {
        public error: string;
        public jwt: any;
        public name: string;
        static assign(o: any): RestartNoderedInstanceMessage {
            if (typeof o === "string" || o instanceof String) {
                return Object.assign(new RestartNoderedInstanceMessage(), JSON.parse(o.toString()));
            }
            return Object.assign(new RestartNoderedInstanceMessage(), o);
        }
    }
    export class StartNoderedInstanceMessage {
        public error: string;
        public jwt: any;
        public name: string;
        static assign(o: any): StartNoderedInstanceMessage {
            if (typeof o === "string" || o instanceof String) {
                return Object.assign(new StartNoderedInstanceMessage(), JSON.parse(o.toString()));
            }
            return Object.assign(new StartNoderedInstanceMessage(), o);
        }
    }
    export class StopNoderedInstanceMessage {
        public error: string;
        public jwt: any;
        public name: string;
        static assign(o: any): StopNoderedInstanceMessage {
            if (typeof o === "string" || o instanceof String) {
                return Object.assign(new StopNoderedInstanceMessage(), JSON.parse(o.toString()));
            }
            return Object.assign(new StopNoderedInstanceMessage(), o);
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
    export class UpdateFileMessage {
        public error: string;
        public jwt: string;

        public id: string;
        public metadata: any;
        static assign(o: any): UpdateFileMessage {
            if (typeof o === "string" || o instanceof String) {
                return Object.assign(new UpdateFileMessage(), JSON.parse(o.toString()));
            }
            return Object.assign(new UpdateFileMessage(), o);
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
                    case "refreshtoken":
                        this.RefreshToken(cli);
                        break;
                    case "queuemessage":
                        this.QueueMessage(cli);
                        break;
                    // case "signin":
                    //     this.Signin(cli);
                    //     break;
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
        private RefreshToken(cli: WebSocketClient): void {
            var msg: SigninMessage = SigninMessage.assign(this.data);
            cli.jwt = msg.jwt;
            cli.user = msg.user;
            console.debug("Message::RefreshToken: Updated jwt");
        }
        private QueueMessage(cli: WebSocketClient): void {
            var msg: QueueMessage = QueueMessage.assign(this.data);
            msg.replyto = msg.correlationId;
            cli.$rootScope.$broadcast("queuemessage", msg);
            this.Reply("queuemessage");
            this.Send(cli);
        }

    }

}
