import { NoderedUtil } from "@openiap/openflow-api";
import { Message } from "./Messages/Message.js";

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
    public priority: number = 1;
    public clientagent: string;
    public clientversion: string;
    public static fromjson(json: string): SocketMessage {
        let result: SocketMessage = new SocketMessage();
        let obj: any = JSON.parse(json);
        result.command = obj.command;
        result.id = obj.id;
        result.replyto = obj.replyto;
        result.count = 1;
        result.index = 0;
        result.clientagent = obj.clientagent;
        result.clientversion = obj.clientversion;
        if (!NoderedUtil.IsNullEmpty(obj.priority)) result.priority = obj.priority;
        result.data = obj.data;
        if (isNumber(obj.count)) { result.count = obj.count; }
        if (isNumber(obj.index)) { result.index = obj.index; }
        if (result.id === null || result.id === undefined || result.id === "") {
            result.id = NoderedUtil.GetUniqueIdentifier();
        }
        return result;
    }
    public static fromcommand(command: string): SocketMessage {
        const result: SocketMessage = new SocketMessage();
        result.command = command;
        result.count = 1;
        result.index = 0;
        result.id = NoderedUtil.GetUniqueIdentifier();
        return result;
    }
    public static frommessage(msg: Message, data: string, count: number, index: number): SocketMessage {
        const result: SocketMessage = new SocketMessage();
        result.id = msg.id;
        result.replyto = msg.replyto;
        result.command = msg.command;
        result.count = count;
        result.index = index;
        result.data = data;
        return result;
    }
    public tojson(): string {
        return JSON.stringify(this);
    }
}