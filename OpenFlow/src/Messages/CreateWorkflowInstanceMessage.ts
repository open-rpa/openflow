import { Base } from "../base";

export class CreateWorkflowInstanceMessage<T extends Base> implements IReplyMessage {
    public error: string;
    public jwt: any;

    public correlationId: string;
    public newinstanceid: string;
    public state: string;
    public queue: string;
    public workflowid: string;
    public resultqueue: string;
    public targetid: string;
    public parentid: string;
    public name: string;
    public initialrun: boolean;

    public payload: any;

    static assign<T extends Base>(o: any): CreateWorkflowInstanceMessage<T> {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new CreateWorkflowInstanceMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new CreateWorkflowInstanceMessage(), o);
    }
}
