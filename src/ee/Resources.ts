import { Span } from "@opentelemetry/api";
import { Config } from "../Config.js";
import { Crypt } from "../Crypt.js";
import { Base } from "@openiap/openflow-api";
import { Logger } from "../Logger.js";
import { Rights, WellknownIds } from "@openiap/nodeapi";

export declare class Resource extends Base {
    constructor();
    target: "customer" | "user";
    customerassign: "singlevariant" | "multiplevariants";
    userassign: "singlevariant" | "multiplevariants";
    defaultmetadata: any;
    products: ResourceVariant[];
    allowdirectassign: boolean;
    order: number;
}
export declare class ResourceVariant {
    name: string;
    stripeproduct: string;
    stripeprice: string;
    customerassign: "single" | "multiple" | "metered";
    userassign: "single" | "multiple" | "metered";
    added_stripeprice: string;
    added_resourceid: string;
    added_quantity_multiplier: number;
    metadata: any;
    allowdirectassign: boolean;
    order: number;
}
export declare class ResourceUsage extends Base {
    constructor();
    product: ResourceVariant;
    resourceid: string;
    resource: string;
    userid: string;
    customerid: string;
    quantity: number;
    /** "subscription" */
    subid: string;
    "subscription": any;
    /** "subscription_item" */
    siid: string;
}
export class Resources {
    public static async CreateResource(name: string,
        target: "customer" | "user",
        customerassign: "singlevariant" | "multiplevariants",
        userassign: "singlevariant" | "multiplevariants",
        defaultmetadata: any,
        products: ResourceVariant[], allowdirectassign: boolean, customeradmins: boolean, order: number, parent: Span): Promise<Resource> {
            const jwt = Crypt.rootToken();
            var results = await Config.db.GetOne<Resource>({ collectionname: "config", query: { "name": name } }, parent);
            const model: Resource = (results ? results : new Resource());
            model.name = name;
            model.target = target;
            model.customerassign = customerassign;
            model.userassign = userassign;
            model.defaultmetadata = defaultmetadata;
            model.products = products;
            model.allowdirectassign = allowdirectassign;
            (model as any).order = order;
            model._acl = [];
            Base.addRight(model, WellknownIds.admins, "admins", [Rights.full_control]);
            Base.addRight(model, WellknownIds.users, "users", [Rights.read]);
            if (model._id) {
                return await Config.db.UpdateOne(model, "config", 1, true, jwt, parent);
            } else {
                return await Config.db.InsertOne(model, "config", 1, true, jwt, parent);
            }
    }
    public static async GetUserResources(userid: string, parent: Span) {
        const jwt = Crypt.rootToken();
        const result = Config.db.query({ collectionname: "config", query: { userid, _type: "resourceusage", quantity: { "$gt": 0 } }, jwt }, parent);
        return result;
    }
    public static async GetUserResourcesCount(userid: string, parent: Span) {
        const jwt = Crypt.rootToken();
        const result = await Config.db.count({ collectionname: "config", query: { userid, _type: "resourceusage", quantity: { "$gt": 0 } }, jwt }, parent);
        return result;
    }
    public static async RemoveUserResources(userid: string, parent: Span) {
        const jwt = Crypt.rootToken();
        const result = await Config.db.DeleteMany({ userid, _type: "resourceusage" }, null, "config", null, false, jwt, parent);
        return result;
    }
    public static async GetCustomerResources(customerid: string, parent: Span) {
        const jwt = Crypt.rootToken();
        const result = Config.db.query({ collectionname: "config", query: { customerid, _type: "resourceusage", quantity: { "$gt": 0 } }, jwt }, parent);
        return result;
    }
    public static async GetCustomerResourcesCount(customerid: string, parent: Span) {
        const jwt = Crypt.rootToken();
        const result = await Config.db.count({ collectionname: "config", query: { customerid, _type: "resourceusage", quantity: { "$gt": 0 } }, jwt }, parent);
        return result;
    }
    public static async RemoveCustomerResources(customerid: string, parent: Span) {
        const jwt = Crypt.rootToken();
        const result = await Config.db.DeleteMany({ customerid, _type: "resourceusage" }, null, "config", null, false, jwt, parent);
        return result;
    }
    public static async GetMemberResources(memberid: string, parent: Span) {
        const jwt = Crypt.rootToken();
        const result = Config.db.query({ collectionname: "config", query: { memberid, _type: "resourceusage", quantity: { "$gt": 0 } }, jwt }, parent);
        return result;
    }
    public static async GetMemberResourcesCount(memberid: string, parent: Span) {
        const jwt = Crypt.rootToken();
        const result = await Config.db.count({ collectionname: "config", query: { memberid, _type: "resourceusage", quantity: { "$gt": 0 } }, jwt }, parent);
        return result;
    }
    public static async RemoveMemberResources(memberid: string, parent: Span) {
        const jwt = Crypt.rootToken();
        const result = await Config.db.DeleteMany({ memberid, _type: "resourceusage" }, null, "config", null, false, jwt, parent);
        return result;
    }

    public async GetResource(resourcename:string, parent: Span): Promise<Resource> {
        let _resources: Resource[] = await Logger.DBHelper.GetResources(parent);
        _resources = _resources.filter(x => x.name == resourcename);
        if(_resources.length == 0) return null;
        return _resources[0]
    }
    public async GetResourceUserUsage(resourcename:string, userid: string, parent: Span): Promise<ResourceUsage> {
        let assigned: ResourceUsage[] = await Logger.DBHelper.GetResourceUsageByUserID(userid, parent);
        assigned = assigned.filter(x => x.resource == resourcename);
        if(assigned.length == 0) return null; // No found
        if (assigned[0].siid == null || assigned[0].siid == "") return null;  // Not completed payment
        if (assigned[0].quantity == 0) return null; // No longer assigned
        return assigned[0]
    }
    public async GetResourceCustomerUsage(resourcename:string, customerid: string, parent: Span): Promise<ResourceUsage[]> {
        let assigned: ResourceUsage[] = await Logger.DBHelper.GetResourceUsageByCustomerID(customerid, parent);
        assigned = assigned.filter(x => x.resource == resourcename);
        if(Config.stripe_api_secret != null && Config.stripe_api_secret != "") {
            assigned = assigned.filter(x => x.siid != null && x.siid != ""); // Not completed payment
        }
        assigned = assigned.filter(x => x.quantity > 0);
        if(assigned.length == 0) return null; // No found
        return assigned;
    }
    public async GetProductResourceCustomerUsage(resourcename:string, stripeprice: string,  customerid: string, parent: Span): Promise<ResourceUsage> {
        let assigned: ResourceUsage[] = await Logger.DBHelper.GetResourceUsageByCustomerID(customerid, parent);
        assigned = assigned.filter(x => x.resource == resourcename && x.product.stripeprice == stripeprice);
        if(assigned.length == 0) return null; // No found
        if (assigned[0].siid == null || assigned[0].siid == "") return null;  // Not completed payment
        if (assigned[0].quantity == 0) return null; // No longer assigned
        return assigned[0]
    }
}