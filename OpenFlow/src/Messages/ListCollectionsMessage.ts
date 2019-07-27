export class ListCollectionsMessage implements IReplyMessage {
    public error: string;
    public jwt: string;
    public includehist: boolean;

    public result: any[];
    static assign(o: any): ListCollectionsMessage {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new ListCollectionsMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new ListCollectionsMessage(), o);
    }
}
