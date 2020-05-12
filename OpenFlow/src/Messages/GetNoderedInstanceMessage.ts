import { Base } from "../base";

export class GetNoderedInstanceMessage implements IReplyMessage {
    public error: string;
    public jwt: any;
    public name: string;
    // public instancename: string;
    public _id: string;
    public result: any;
    public results: any;

    static assign(o: any): GetNoderedInstanceMessage {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new GetNoderedInstanceMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new GetNoderedInstanceMessage(), o);
    }
}
