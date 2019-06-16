import { Base } from "../base";

export class StopNoderedInstanceMessage<T extends Base> implements IReplyMessage {
    public error: string;
    public jwt: any;

    static assign<T extends Base>(o: any): StopNoderedInstanceMessage<T> {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new StopNoderedInstanceMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new StopNoderedInstanceMessage(), o);
    }
}
