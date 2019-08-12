import { Base } from "../base";

export class SaveFileMessage implements IReplyMessage {
    public error: string;
    public jwt: any;
    public filename: string;
    public file: string;
    public mimeType: string;
    public metadata: Base;
    public id: string;

    static assign(o: any): SaveFileMessage {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new SaveFileMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new SaveFileMessage(), o);
    }
}
