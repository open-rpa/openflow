module openflow {
    export class Base {
        public _id: string;
        public _type: string = "unknown";
        public name: string;
        public _createdbyid: string;
        public _createdby: string;
        public _created: Date;
        public _modifiedbyid: string;
        public _modifiedby: string;
        public _modified: Date;
        public _acl: ace[];
    }
    export class ace {
        public deny: boolean;
        public _id: string;
        public name: string;
        public rights: string = "//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8=";
    }

    export class Provider extends Base {
        constructor(name: string, public id: string, public provider: string, public issuer: string, public saml_federation_metadata: string) {
            super();
            this.name = name;
            this._type = "provider";
        }
    }
    export class Role extends Base {
        public members: Rolemember[] = [];
        constructor(name: string) {
            super();
            this.name = name;
            this._type = "role";
        }
    }
    export class TokenUser extends Base {
        public roles: Rolemember[] = [];
        public newpassword: string;
        public sid: string;
        public federationids: string[];
        impostor: string;
        constructor(name: string, public username: string) {
            super();
            this.name = name;
            this._type = "user";
        }
    }
    export class Rolemember {
        constructor(name: string, _id: string) {
            this.name = name;
            this._id = _id;
        }
        name: string;
        _id: string;
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

    }

}