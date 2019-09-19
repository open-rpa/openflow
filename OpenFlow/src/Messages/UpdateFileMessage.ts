import { Base } from "../base";

export class UpdateFileMessage implements IReplyMessage {
    public error: string;
    public jwt: any;
    public metadata: Base;
    public id: string;

    static assign(o: any): UpdateFileMessage {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new UpdateFileMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new UpdateFileMessage(), o);
    }
}
