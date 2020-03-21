import { Base } from "../base";

export class QueueMessage implements IReplyMessage {
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
