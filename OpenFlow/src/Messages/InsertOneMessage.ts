import { Base } from "../base";

export class InsertOneMessage<T extends Base> implements IReplyMessage {
    public error: string;
    public jwt: string;

    // w: 1 - Requests acknowledgment that the write operation has propagated
    // w: 0 - Requests no acknowledgment of the write operation
    // w: 2 would require acknowledgment from the primary and one of the secondaries
    // w: 3 would require acknowledgment from the primary and both secondaries
    public w: number;
    // true, requests acknowledgment that the mongod instances have written to the on-disk journal
    public j: boolean;
    public item: T;
    public collectionname: string;
    public result: T;
    public opresult: any;
    static assign<T extends Base>(o: any): InsertOneMessage<T> {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new InsertOneMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new InsertOneMessage(), o);
    }
}
