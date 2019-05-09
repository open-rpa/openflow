import { Base } from "../base";

export class CloseQueueMessage<T extends Base> implements IReplyMessage {
    public error: string;
    public jwt:any;

    public queuename:string;
    static assign<T extends Base>(o:any):CloseQueueMessage<T> {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new CloseQueueMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new CloseQueueMessage(), o);
    }
}
