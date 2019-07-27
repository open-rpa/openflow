export class DropCollectionMessage implements IReplyMessage {
    public error: string;
    public jwt: string;
    public collectionname: string;

    static assign(o: any): DropCollectionMessage {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new DropCollectionMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new DropCollectionMessage(), o);
    }
}
