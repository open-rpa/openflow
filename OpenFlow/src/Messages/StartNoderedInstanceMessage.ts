import { Base } from "../base";

export class StartNoderedInstanceMessage<T extends Base> implements IReplyMessage {
    public error: string;
    public jwt: any;

    static assign<T extends Base>(o: any): StartNoderedInstanceMessage<T> {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new StartNoderedInstanceMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new StartNoderedInstanceMessage(), o);
    }
}
