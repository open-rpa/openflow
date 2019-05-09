import { Base } from "../base";

export class InsertOrUpdateOneMessage<T extends Base> implements IReplyMessage {
    public error: string;
    public jwt: string;

    public uniqeness:string;
    public item:T;
    public collectionname:string;
    public result:T;
    static assign<T extends Base>(o:any):InsertOrUpdateOneMessage<T> {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new InsertOrUpdateOneMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new InsertOrUpdateOneMessage(), o);
    }
}
