import { Base } from "../base";

export class GetFileMessage implements IReplyMessage {
    public error: string;
    public jwt: any;
    public filename: string;
    public file: string;
    public mimeType: string;
    public metadata: Base;
    public id: string;

    static assign(o: any): GetFileMessage {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new GetFileMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new GetFileMessage(), o);
    }
}
