import { Base } from "../base";

export class DeleteNoderedInstanceMessage<T extends Base> implements IReplyMessage {
    public error: string;
    public jwt: any;

    static assign<T extends Base>(o: any): DeleteNoderedInstanceMessage<T> {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new DeleteNoderedInstanceMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new DeleteNoderedInstanceMessage(), o);
    }
}
