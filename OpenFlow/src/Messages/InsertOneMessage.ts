import { Base } from "../base";

export class InsertOneMessage<T extends Base> implements IReplyMessage {
    public error: string;
    public jwt: string;

    public item:T;
    public collectionname:string;
    public result:T;
    static assign<T extends Base>(o:any):InsertOneMessage<T> {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new InsertOneMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new InsertOneMessage(), o);
    }
}
