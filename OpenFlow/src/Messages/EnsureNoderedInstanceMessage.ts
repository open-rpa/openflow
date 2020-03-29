import { Base } from "../base";

export class EnsureNoderedInstanceMessage implements IReplyMessage {
    public error: string;
    public jwt: any;
    public name: string;
    public _id: string;

    static assign(o: any): EnsureNoderedInstanceMessage {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new EnsureNoderedInstanceMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new EnsureNoderedInstanceMessage(), o);
    }
}
