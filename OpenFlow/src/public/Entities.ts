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
        public _acl: Ace[];
        public _encrypt: string[];

        /**
 * Enumerate ACL for specefic ID
 * @param  {string} _id Id to search for
 * @param  {boolean=false} deny look for deny or allow permission
 * @returns Ace Ace if found, else null
 */
        getRight(_id: string, deny: boolean = false): Ace {
            var result: Ace = null;
            if (!this._acl) { this._acl = []; }
            this._acl.forEach((a, index) => {
                if (a._id === _id && a.deny === deny) {
                    this._acl[index] = Ace.assign(a);
                    result = this._acl[index];
                }
            });
            if (result) {
                result = Ace.assign(result);
            }
            return result;
        }
        /**
         * Set right for specefic id, if exists
         * @param  {Ace} x
         * @returns void
         */
        setRight(x: Ace): void {
            if (!this._acl) { this._acl = []; }
            this._acl.forEach((a, index) => {
                if (a._id === x._id && a.deny === x.deny) {
                    this._acl[index] = x;
                }
            });
        }
        /**
         * Add/update right for user/role
         * @param  {string} _id user/role id
         * @param  {string} name Displayname for user/role
         * @param  {number[]} rights Right to set
         * @param  {boolean=false} deny Deny the right
         * @returns void
         */
        addRight(_id: string, name: string, rights: number[], deny: boolean = false): void {
            var right: Ace = this.getRight(_id, deny);
            if (!right) { right = new Ace(); this._acl.push(right); }
            right.deny = deny; right._id = _id; right.name = name;
            rights.forEach(bit => {
                right.setBit(bit);
            });
            this.setRight(right);
        }
        /**
         * Remove a right from user/role
         * @param  {string} _id user/role id
         * @param  {number[]=null} rights Right to revoke
         * @param  {boolean=false} deny Deny right
         * @returns void
         */
        removeRight(_id: string, rights: number[] = null, deny: boolean = false): void {
            if (!this._acl) { this._acl = []; }
            var right: Ace = this.getRight(_id, deny);
            if (!right) { return; }
            rights.forEach(bit => {
                right.unsetBit(bit);
            });
            this.setRight(right);
        }
    }
    export class Ace {
        public deny: boolean;
        public _id: string;
        public name: string;
        public rights: string = "//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8=";
        static assign(o: any): Ace {
            return Object.assign(new Base(), o);
        }
        _base64ToArrayBuffer(string_base64): ArrayBuffer {
            var binary_string = window.atob(string_base64);
            var len = binary_string.length;
            var bytes = new Uint8Array(len);
            for (var i = 0; i < len; i++) {
                //var ascii = string_base64.charCodeAt(i);
                var ascii = binary_string.charCodeAt(i);
                bytes[i] = ascii;
            }
            return bytes.buffer;
        }
        _arrayBufferToBase64(array_buffer): string {
            var binary = '';
            var bytes = new Uint8Array(array_buffer);
            var len = bytes.byteLength;
            for (var i = 0; i < len; i++) {
                binary += String.fromCharCode(bytes[i])
            }
            return window.btoa(binary);
        }
        isBitSet(bit: number): boolean {
            bit--;
            var buf = this._base64ToArrayBuffer(this.rights);
            var view = new Uint8Array(buf);
            var octet = Math.floor(bit / 8);
            var currentValue = view[octet];
            var _bit = (bit % 8);
            var mask = Math.pow(2, _bit);
            return (currentValue & mask) != 0;
        }
        setBit(bit: number) {
            bit--;
            var buf = this._base64ToArrayBuffer(this.rights);
            var view = new Uint8Array(buf);
            var octet = Math.floor(bit / 8);
            var currentValue = view[octet];
            var _bit = (bit % 8);
            var mask = Math.pow(2, _bit);
            var newValue = currentValue | mask;
            view[octet] = newValue;
            return this._arrayBufferToBase64(view);
        }
        unsetBit(bit: number) {
            bit--;
            var buf = this._base64ToArrayBuffer(this.rights);
            var view = new Uint8Array(buf);
            var octet = Math.floor(bit / 8);
            var currentValue = view[octet];
            var _bit = (bit % 8);
            var mask = Math.pow(2, _bit);
            var newValue = currentValue &= ~mask;
            view[octet] = newValue;
            return this._arrayBufferToBase64(view);
        }
        toogleBit(bit: number) {
            if (this.isBitSet(bit)) {
                this.unsetBit(bit);
            } else {
                this.setBit(bit);
            }
        }
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
        public rparole: boolean;
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
}