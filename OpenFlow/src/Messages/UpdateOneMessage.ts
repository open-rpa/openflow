import { Base } from "../base";

export class UpdateOneMessage<T extends Base> implements IReplyMessage {
    public error: string;
    public jwt: string;

    public item:T;
    public collectionname:string;
    public result:T;
    static assign<T extends Base>(o:any):UpdateOneMessage<T> {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new UpdateOneMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new UpdateOneMessage(), o);
    }
}
