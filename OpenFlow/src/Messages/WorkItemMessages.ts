import { Ace, Base } from "@openiap/openflow-api";

export class AddWorkItemMessage {
    public error: string;
    public jwt: string;

    public wiqid: string;
    public wiq: string;
    public name: string;
    public payload: any;
    public nextrun: Date;
    public priority: number;
    public files: MessageWorkitemFile[];
    public result: Workitem;
    static assign(o: any): AddWorkItemMessage {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new AddWorkItemMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new AddWorkItemMessage(), o);
    }
}
export class AddWorkitem {
    public name: string;
    public payload: any;
    public nextrun: Date;
    public priority: number;
    public files: MessageWorkitemFile[];
}
export class AddWorkItemsMessage {
    public error: string;
    public jwt: string;

    public wiqid: string;
    public wiq: string;
    public items: AddWorkitem[];
    static assign(o: any): AddWorkItemsMessage {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new AddWorkItemsMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new AddWorkItemsMessage(), o);
    }
}
export class UpdateWorkItemMessage {
    public error: string;
    public jwt: string;

    public _id: string;
    public name: string;
    public state: string;
    public payload: any;
    public ignoremaxretries: boolean;
    public errormessage: string;
    public errorsource: string;
    public files: MessageWorkitemFile[];
    public result: Workitem;
    static assign(o: any): UpdateWorkItemMessage {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new UpdateWorkItemMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new UpdateWorkItemMessage(), o);
    }
}
export class PopWorkItemMessage {
    public error: string;
    public jwt: string;

    public wiqid: string;
    public wiq: string;
    public result: Workitem;
    static assign(o: any): PopWorkItemMessage {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new PopWorkItemMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new PopWorkItemMessage(), o);
    }
}
export class DeleteWorkItemMessage {
    public error: string;
    public jwt: string;

    public _id: string;
    static assign(o: any): DeleteWorkItemMessage {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new DeleteWorkItemMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new DeleteWorkItemMessage(), o);
    }
}
export class AddWorkItemQueueMessage {
    public error: string;
    public jwt: string;

    public name: string;
    public workflowid: string;
    public robotqueue: string;
    public amqpqueue: string;
    public projectid: string;
    public skiprole: boolean;
    public maxretries: number;
    public retrydelay: number;
    public initialdelay: number;
    public _acl: Ace[];
    public result: WorkitemQueue;
    static assign(o: any): AddWorkItemQueueMessage {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new AddWorkItemQueueMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new AddWorkItemQueueMessage(), o);
    }
}
export class GetWorkItemQueueMessage {
    public error: string;
    public jwt: string;

    public _id: string;
    public name: string;
    public result: WorkitemQueue;
    static assign(o: any): GetWorkItemQueueMessage {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new GetWorkItemQueueMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new GetWorkItemQueueMessage(), o);
    }
}
export class UpdateWorkItemQueueMessage {
    public error: string;
    public jwt: string;

    public _id: string;
    public name: string;
    public _acl: Ace[];
    public workflowid: string;
    public robotqueue: string;
    public amqpqueue: string;
    public projectid: string;
    public purge: boolean;
    public maxretries: number;
    public retrydelay: number;
    public initialdelay: number;
    public result: WorkitemQueue;
    static assign(o: any): UpdateWorkItemQueueMessage {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new UpdateWorkItemQueueMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new UpdateWorkItemQueueMessage(), o);
    }
}
export class DeleteWorkItemQueueMessage {
    public error: string;
    public jwt: string;

    public _id: string;
    public name: string;
    public purge: boolean;
    static assign(o: any): DeleteWorkItemQueueMessage {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new DeleteWorkItemQueueMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new DeleteWorkItemQueueMessage(), o);
    }
}

export class WorkitemQueue extends Base {
    constructor() {
        super();
    }
    public workflowid: string;
    public robotqueue: string;
    public amqpqueue: string;
    public projectid: string;
    public usersrole: string;
    public maxretries: number;
    public retrydelay: number;
    public initialdelay: number;
}

export class Workitem extends Base {
    constructor() {
        super();
    }
    public wiqid: string;
    public wiq: string;
    public state: string;
    public payload: any;
    public retries: number;
    public priority: number;
    public files: WorkitemFile[];
    public userid: string;
    public username: string;
    public lastrun: Date;
    public nextrun: Date;
    public errormessage: string;
    public errorsource: string;
}
export class MessageWorkitemFile {
    public file: string;
    public filename: string;
    public compressed: boolean;
}
export class WorkitemFile {
    public filename: string;
    public name: string;
    public _id: string;
}