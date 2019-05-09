import { Base } from "../base";

export class AggregateMessage<T extends Base> implements IReplyMessage {
    public error: string;
    public jwt: string;

    public aggregates:object[];
    public collectionname:string;
    public result:T[];
    static assign<T extends Base>(o:any):AggregateMessage<T> {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new AggregateMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new AggregateMessage(), o);
    }
}
