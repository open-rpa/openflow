import { Base } from "../base";

export class DeleteNoderedInstanceMessage implements IReplyMessage {
    public error: string;
    public jwt: any;
    public name: string;
    public _id: string;

    static assign(o: any): DeleteNoderedInstanceMessage {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new DeleteNoderedInstanceMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new DeleteNoderedInstanceMessage(), o);
    }
}
