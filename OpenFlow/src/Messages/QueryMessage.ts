import { Base } from "../base";

export class QueryMessage<T extends Base> implements IReplyMessage {
    public error: string;
    public jwt: any;

    public query: any;
    public projection: Object;
    public top: number;
    public skip: number;
    public orderby: Object | string;
    public collectionname: string;
    public result: T[];
    public queryas: string;
    static assign<T extends Base>(o: any): QueryMessage<T> {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new QueryMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new QueryMessage(), o);
    }
}
