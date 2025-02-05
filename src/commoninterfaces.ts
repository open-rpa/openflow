import { Ace } from "@openiap/nodeapi";
import { Histogram, HrTime, Meter, Span } from "@opentelemetry/api";
import * as logsAPI from '@opentelemetry/api-logs';
import express from "express";
import { Wellknown } from "./Util.js";

export interface i_license_data {
    licenseVersion: number;
    email: string;
    expirationDate: Date;
    domain: string;
}
export interface i_license_file {
    template_v1: string;
    template_v2: string;
    license_public_key: string;
    validlicense: boolean;
    licenserror: string;
    data: i_license_data;
    ofid(force: boolean): any;
    validate(): Promise<void>;
    shutdown(): void;
    /**
     *  Generate license file
     *
     * @param options
    */
    generate2(options: any, remoteip: string, user: User, span: Span): Promise<any>;
    /**
     *  Generate license file
     *
     * @param options
     * @param options.data {object|string} - data to sign
     * @param options.template - custom license file template
     * @param [options.privateKeyPath] {string} - path to private key
     * @param [options.privateKey] {string} - private key content
     */
    generate(options: any): any;
    /**
     * Parse license file
     *
     * @param options
     * @param options.template - custom license file template
     * @param [options.publicKeyPath] {string} - path to public key
     * @param [options.publicKey] {string} - path to public key
     * @param [options.licenseFilePath] {string} - path to license file
     * @param [options.licenseFile] {string} - license file content
     */
    parse(options: any): {
        valid: boolean;
        serial: string;
        data: {};
    };
    /**
     *
     * @param options
     * @param options.data
     * @param options.privateKey
     * @private
     */
    _generateSerial(options: any): string;
    _render(template: any, data: any): any;
    _prepareDataObject(data: any): {};
}
export interface i_otel {
    default_boundaries: number[];
    meter: Meter;
    defaultlabels: any;
    logger: logsAPI.Logger;
    GetTraceSpanId(span: Span): [string, string]
    startSpan(name: string, traceId: string, spanId: string): Span;
    startSpanExpress(name: string, req: express.Request): Span;
    startSubSpan(name: string, parent: Span): Span;
    endSpan(span: Span): void;
    startTimer(): HrTime;
    endTimer(startTime: HrTime, recorder: Histogram, labels?: Object): number;
    setdefaultlabels(): void;
    shutdown(): Promise<void>;
    createheapdump(parent: Span): Promise<string>
}

export interface i_agent_driver {
    detect(): Promise<boolean>;
    NodeLabels(parent: Span): Promise<any>;
    EnsureInstance(user: User, jwt:string, agent: iAgent, parent: Span): Promise<void>;
    GetInstancePods(user: User, jwt:string, agent: iAgent, getstats:boolean, parent: Span): Promise<any[]>;
    RemoveInstance(user: User, jwt:string, agent: iAgent, removevolumes: boolean, parent: Span): Promise<void>;
    GetInstanceLog(user: User, jwt:string, agent: iAgent, podname: string, parent: Span): Promise<string>;
    RemoveInstancePod(user: User, jwt:string, agent: iAgent, podname: string, parent: Span): Promise<void>;
    InstanceCleanup(parent: Span): Promise<void>;
}

export interface iBase {
    _id: string;
    _type: string;
    _acl: Ace[];
    name: string;
    _name: string;
    _encrypt: string[];
    _createdbyid: string;
    _createdby: string;
    _created: Date;
    _modifiedbyid: string;
    _modifiedby: string;
    _modified: Date;
    _version: number;
}
export interface iAgentVolume {
    type: string;
    name: string;
    mountpath: string;
    storageclass: string;
    driver: string;
    size: string;
    subPath: string;
}
export interface iAgentPort {
    name: string;
    port: number;
    protocol: "TCP" | "UDP" | "H2C" | "HTTP";
    targetport: number;
    nodeport: number;
}
export interface iAgent extends iBase {
    slug: string;
    tz: string;
    image: string;
    port: number;
    volumes: iAgentVolume[];
    ports: iAgentPort[];
    agentid: string;
    webserver: boolean;
    sleep: boolean;
    stripeprice: string;
    _stripeprice: string;
    runas: string;
    runasname: string;
    environment: any;
    nodeselector: any;
    lastseen: Date;
    hostname: string;
    os: string;
    arch: string;
    username: string;
    version: string;
    maxpackages: number;
    package: string;
    languages: string[];
    chrome: boolean;
    chromium: boolean;
    docker: boolean;
    assistant: boolean;
    daemon: boolean;
    _resourceusageid: string;
    _productname: string;
    _workspaceid: string;
constructor();
}
export class Rights {
    static create = 1;
    static read = 2;
    static update = 3;
    static delete = 4;
    static invoke = 5;
    // tslint:disable-next-line: variable-name
    static full_control = -1;
}

export class Base implements iBase {
    _id: string;
    _type: string = 'unknown';
    _acl: Ace[] = [];
    name: string;
    _name: string;
    _encrypt: string[] = [];

    _createdbyid: string;
    _createdby: string;
    _created: Date;
    _modifiedbyid: string;
    _modifiedby: string;
    _modified: Date;
    _version: number = 0;
    constructor() {
        Base.addRight(this, Wellknown.admins._id, Wellknown.admins.name, [Rights.full_control]);
    }
    /**
     * Create new instance of object, using values from input object
     * @param  {T} o Base object
     * @returns T New object as Type
     */
    static assign<T>(source: T): T {
        return Object.assign(new Base(), source);
    }
    /**
     * Enumerate ACL for specefic ID
     * @param  {string} _id Id to search for
     * @param  {boolean=false} deny look for deny or allow permission
     * @returns Ace Ace if found, else null
     */
    static getRight(item: Base, _id: string, deny: boolean = false): Ace {
        let result: Ace = null;
        if (!item._acl) {
            item._acl = [];
        }
        item._acl.forEach((a, index) => {
            if (a._id === _id && (a.deny === deny || a.deny == null)) {
                result = item._acl[index];
            }
        });
        return result;
    }
    /**
     * Set right for specefic id, if exists
     * @param  {Ace} x
     * @returns void
     */
    static setRight(item: Base, x: Ace): void {
        if (!item._acl) {
            item._acl = [];
        }
        item._acl.forEach((a, index) => {
            if (a._id === x._id && (a.deny === x.deny || a.deny == null)) {
                item._acl[index] = x;
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
    static addRight(item: Base, _id: string, name: string, rights: number[], deny: boolean = false): void {
        let right: Ace = Base.getRight(item, _id, deny);
        if (!right) {
            right = new Ace();
            Ace.resetnone(right);
            item._acl.push(right);
        }
        if (deny == true) right.deny = deny;
        right._id = _id;
        if (name != null && name != "") right.name = name;
        if (rights[0] === -1) {
            Ace.resetfullcontrol(right)
            // for (let i: number = 0; i < 1000; i++) {
            //     Ace.setBit(right, i);
            // }
        } else {
            rights.forEach((bit) => {
                try {
                    Ace.setBit(right, bit);
                } catch (error) {
                    throw error;
                }
            });
        }
        Base.setRight(item, right);
    }
    /**
     * Remove a right from user/role
     * @param  {string} _id user/role id
     * @param  {number[]=null} rights Right to revoke
     * @param  {boolean=false} deny Deny right
     * @returns void
     */
    static removeRight(item: Base, _id: string, rights: number[] = null, deny: boolean = false): void {
        if (!item._acl) {
            item._acl = [];
        }
        const right: Ace = Base.getRight(item, _id, deny);
        if (!right) {
            return;
        }
        if (rights[0] === -1) {
            item._acl = item._acl.filter(x => x._id !== _id);
        } else {
            rights.forEach((bit) => {
                Ace.unsetBit(right, bit);
            });
        }
        Base.setRight(item, right);
    }
    static hasRight(item: Base, _id: string, bit: number, deny: boolean = false): boolean {
        const ace = Base.getRight(item, _id, deny);
        if (ace == null) return false;
        return Ace.isBitSet(ace, bit);
    }
}


export class FederationId {
    constructor(id: string, issuer: string) {
        this.id = id;
        this.issuer = issuer;
    }
    id: string;
    issuer: string;
}
export class Rolemember {
    constructor(name: string, _id: string) {
        this.name = name;
        this._id = _id;
    }
    name: string;
    _id: string;
}
export class TokenUser {
    _type: string;
    _id: string;
    name: string;
    username: string;
    roles: Rolemember[];
    role: string;
    email: string;
    impostor: string;
    disabled: boolean;
    validated: boolean;
    emailvalidated: boolean;
    formvalidated: boolean;
    customerid: string;
    selectedcustomerid: string;
    dblocked: boolean;
    static assign<T>(o: any): T {
        const res = Object.assign(new User(), o);
        return res;
    }
    static From(user: User | TokenUser): TokenUser {
        const res = new TokenUser();
        res._type = user._type;
        res._id = user._id;
        res.name = user.name;
        res.username = user.username;
        res.roles = user.roles;
        res.role = user.role;
        res.email = user.email;
        // @ts-ignore
        res.impostor = user.impersonating;
        res.disabled = user.disabled;
        res.validated = user.validated;
        res.emailvalidated = user.emailvalidated;
        res.formvalidated = user.formvalidated;
        res.customerid = user.customerid;
        res.selectedcustomerid = user.selectedcustomerid;
        res.dblocked = user.dblocked;
        return res;
    }
    HasRoleName(name: string): boolean {
        const hits: Rolemember[] = this.roles.filter(member => member.name === name);
        return (hits.length === 1);
    }
    HasRoleId(id: string): boolean {
        const hits: Rolemember[] = this.roles.filter(member => member._id === id);
        return (hits.length === 1);
    }
}
export class User extends Base {
    constructor() {
        super();
        this._type = "user";
    }
    noderedname: string;
    lastseen: Date;
    _heartbeat: Date;
    _rpaheartbeat: Date;
    _noderedheartbeat: Date;
    _powershellheartbeat: Date;
    _lastclientagent: string;
    _lastclientversion: string;
    _lastopenrpaclientversion: string;
    _lastnoderedclientversion: string;
    _lastpowershellclientversion: string;
    _hasbilling: boolean;
    username: string;
    passwordhash: string;
    sid: string;
    customerid: string;
    selectedcustomerid: string;
    firebasetoken: string;
    onesignalid: string;
    gpslocation: any;
    device: any;
    impersonating: string;
    federationids: FederationId[];
    roles: Rolemember[];
    role: string;
    email: string;
    company: string;
    disabled: boolean;
    validated: boolean;
    emailvalidated: boolean;
    formvalidated: boolean;
    dbusage: number;
    dblocked: boolean;
    static assign<T>(o: any): T {
        const res = Object.assign(new User(), o);
        return res;
    }
    HasRoleName(name: string): boolean {
        const hits: Rolemember[] = this.roles.filter(member => member.name === name);
        return (hits.length === 1);
    }
    HasRoleId(id: string): boolean {
        const hits: Rolemember[] = this.roles.filter(member => member._id === id);
        return (hits.length === 1);
    }
}
export class Role extends Base {
    constructor() {
        super();
        this._type = "role";
    }
    customerid: string;
    members: Rolemember[];
    static assign<T>(o: any): T {
        const res = Object.assign(new Role(), o);
        return res;
    }
    IsMember(_id: string): boolean {
        const hits: Rolemember[] = this.members.filter(member => member._id === _id);
        return (hits.length === 1);
    }
    AddMember(item: Base): void {
        if (!this.IsMember(item._id)) {
            this.members.push(new Rolemember(item.name, item._id));
        }
    }
    RemoveMember(_id: string): void {
        this.members.forEach((member, idx) => {
            if (member._id === _id) {
                this.members.splice(idx, 1);
            }
        });
    }
}
export class Member extends Base {
    constructor() {
        super();
        this._type = "member";
    }
    public email: string;
    public userid: string;
    public workspaceid: string;
    public workspacename: string;
    public status: "pending" | "accepted" | "rejected";
    public role: "member" | "admin";
    public invitedby: string;
    public invitedbyname: string;
    public invitedon: Date;
    public token: string;
    public expires: Date;
    public seen: boolean;
    public seenon: Date;
    public acceptedby: string;
    public acceptedbyname: string;
    public acceptedon: Date;
    public rejectedby: string;
    public rejectedbyname: string;
    public rejectedon: Date;
}
export class Workspace extends Base {
    public admins: string;
    public users: string;
    public _billingid: string;
    public _resourceusageid: string;
    public _productname: string;
}
export  class Customer extends Base {
    constructor() {
        super();
        this._type = "customer";
    }
    stripeid: string;
    userid: string;
    country: string;
    email: string;
    address: string;
    vattype: string;
    vatnumber: string;
    taxrate: string;
    tax: number;
    coupon: string;
    hascard: boolean;
    memory: string;
    openflowuserplan: string;
    supportplan: string;
    supporthourplan: string;
    subscriptionid: string;
    admins: string;
    users: string;
    customattr1: string;
    customattr2: string;
    customattr3: string;
    customattr4: string;
    customattr5: string;
    domains: string[];
    dbusage: number;
    dblocked: boolean;
    billingid: string; // TODO: allow this ?
}
export class Billing extends Base {
    constructor() {
        super();
        this._type = "customer";
    }
    public email: string;
    public billing: string;
    public admins: string;
    public stripeid: string;
    public subid: string;
    public currency: "" | "usd" | "eur" | "dkk";
    // userid: string;
    // email: string;
    // address: string;
    // vattype: string;
    // vatnumber: string;
    // taxrate: string;
    // tax: number;
    // coupon: string;
    // hascard: boolean;
    // memory: string;
    // openflowuserplan: string;
    // supportplan: string;
    // supporthourplan: string;
}
export enum ResourceVariantType {
    single = "singlevariant",
    multiple = "multiplevariants"
}
export enum ResourceAssignedType {
    single = "single",
    multiple = "multiple",
    metered = "metered",
}
export enum ResourceTargetType {
    customer = "customer",
    workspace = "workspace",
    user = "user",
    member = "member",
    agent = "agent",
}
export class Resource extends Base {
    constructor() {
        super();
        this._type = "resource";
    }
    target: ResourceTargetType;
    assign: ResourceVariantType;
    defaultmetadata: any;
    products: Product[];
    allowdirectassign: boolean;
    deprecated: boolean;
    order: number;
}
export class Product {
    name: string;
    stripeproduct: string;
    stripeprice: string;
    lookup_key: string;
    assign: ResourceAssignedType;
    added_stripeprice: string;
    added_resourceid: string;
    added_quantity_multiplier: number;
    metadata: any;
    allowdirectassign: boolean;
    deprecated: boolean;
    order: number;
}
export class ResourceUsage extends Base {
    constructor() {
        super();
        this._type = "resourceusage";
    }
    product: Product;
    resourceid: string;
    resource: string;
    userid: string | undefined;
    memberid: string | undefined;
    customerid: string;
    workspaceid: string | undefined;
    agentid: string;
    quantity: number;
    /** "subscription" */
    subid: string;
    /** "subscription_item" */
    siid: string;
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
    public success_wiqid: string;
    public failed_wiqid: string;
    public success_wiq: string;
    public failed_wiq: string;
}