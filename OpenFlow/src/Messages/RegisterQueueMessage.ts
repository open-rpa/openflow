import { Base } from "../base";

export class RegisterQueueMessage<T extends Base> implements IReplyMessage {
    public error: string;
    public jwt:any;

    public queuename:string;
    static assign<T extends Base>(o:any):RegisterQueueMessage<T> {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new RegisterQueueMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new RegisterQueueMessage(), o);
    }
}
