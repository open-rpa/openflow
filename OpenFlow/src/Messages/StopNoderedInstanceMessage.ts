import { Base } from "../base";

export class StopNoderedInstanceMessage implements IReplyMessage {
    public error: string;
    public jwt: any;

    static assign(o: any): StopNoderedInstanceMessage {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new StopNoderedInstanceMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new StopNoderedInstanceMessage(), o);
    }
}
