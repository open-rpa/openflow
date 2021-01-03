import { Base } from "@openiap/openflow-api";
export class Provider extends Base {
    constructor(name: string, public id: string, public provider: string, public issuer: string, public saml_federation_metadata: string) {
        super();
        this.name = name;
        this._type = "provider";
    }
}
export class RPAWorkflowParameter {
    public name: string;
    public type: string;
    public direction: string;
}
export class RPAWorkflow extends Base {
    constructor() {
        super();
        this._type = "workflow";
    }
    public Parameters: RPAWorkflowParameter[];
    public Serializable: boolean;
    public Filename: string;
    public projectid: string;
}
export class Form extends Base {
    constructor() {
        super();
        this._type = "form";
        this.dataType = "json";
    }
    public fbeditor: boolean;
    public wizard: boolean;
    public schema: any;
    public formData: any;
    public dataType: string;
}
export class Workflow extends Base {
    constructor() {
        super();
        this._type = "workflow";
    }
    public rpa: boolean;
    public web: boolean;
    public queue: string;
}
export class WorkflowInstance extends Base {
    constructor() {
        super();
        this._type = "instance";
    }
    public queue: string;
    public payload: any;
    public values: any;
    public jwt: string;
    public state: string;
    public form: string;
    public workflow: string;
    public userData: string;
    public submission: any;

}
export class unattendedclient extends Base {
    constructor() {
        super();
        this._type = "unattendedclient";
    }
    public windowsusername: string;
    public windowspassword: string;
    public computername: string;
    public computerfqdn: string;
    public openrpapath: string;
    public autorestart: string;
    public rdpretry: string;
    public enabled: boolean;
}
export class unattendedserver extends Base {
    constructor() {
        super();
        this._type = "unattendedserver";
    }
    public computername: string;
    public computerfqdn: string;
    public enabled: boolean;
}
