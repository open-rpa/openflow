import { Base } from "../base";

export class DeleteOneMessage implements IReplyMessage {
    public error: string;
    public jwt: string;

    public _id:string;
    public collectionname:string;
    static assign<T extends Base>(o:any):DeleteOneMessage {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new DeleteOneMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new DeleteOneMessage(), o);
    }
}
