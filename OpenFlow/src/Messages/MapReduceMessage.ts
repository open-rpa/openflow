import { Base } from "../base";
import { mapFunc, reduceFunc, finalizeFunc } from "../DatabaseConnection";

export class MapReduceMessage<T> implements IReplyMessage {
    public error: string;
    public jwt: string;

    public scope: any;
    public collectionname: string;
    public result: T[];
    public opresult: any;

    constructor(public map: mapFunc, public reduce: reduceFunc, public finalize: finalizeFunc, public query: any, public out: string) {
    }
    static assign<T>(o: any): MapReduceMessage<T> {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new MapReduceMessage(null, null, null, null, null), JSON.parse(o.toString()));
        }
        return Object.assign(new MapReduceMessage(null, null, null, null, null), o);
    }
}
