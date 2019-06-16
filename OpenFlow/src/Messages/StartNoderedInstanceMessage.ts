import { Base } from "../base";

export class StartNoderedInstanceMessage implements IReplyMessage {
    public error: string;
    public jwt: any;

    static assign(o: any): StartNoderedInstanceMessage {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new StartNoderedInstanceMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new StartNoderedInstanceMessage(), o);
    }
}
