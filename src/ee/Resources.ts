import { Span } from "@opentelemetry/api";
import { Config } from "../Config.js";
import { Crypt } from "../Crypt.js";
import { Base } from "@openiap/openflow-api";
import { Logger } from "../Logger.js";
import { Rights, WellknownIds } from "@openiap/nodeapi";
import { Member, Workspace, User, Customer, Billing, Resource, ResourceUsage, ResourceTargetType, ResourceVariantType, Product } from '../commoninterfaces.js';

export class Resources {
    public static async CreateResource(name: string,
        target: ResourceTargetType,
        userassign: ResourceVariantType,
        memberassign: ResourceVariantType,
        customerassign: ResourceVariantType,
        workspaceassign: ResourceVariantType,
        defaultmetadata: any,
        products: Product[], 
        allowdirectassign: boolean, 
        order: number, 
        parent: Span): Promise<Resource> {
            const jwt = Crypt.rootToken();
            const model: Resource = new Resource();
            model._type = "resource";
            model.name = name;
            model.target = target;
            model.customerassign = customerassign;
            model.workspaceassign = workspaceassign;
            model.userassign = userassign;
            model.memberassign = memberassign;
            model.defaultmetadata = defaultmetadata;
            model.products = products;
            model.allowdirectassign = allowdirectassign;
            model.order = order;
            model._acl = [];
            Base.addRight(model, WellknownIds.admins, "admins", [Rights.full_control]);
            Base.addRight(model, WellknownIds.users, "users", [Rights.read]);
            return Config.db.InsertOrUpdateOne(model, "config", "_type,name", 1, true, jwt, parent);
    }
    public static async CreateResourceUsage(tuser: User, jwt: string, 
        target: User | Customer | Member | Workspace, 
        billingid: string,
        workspaceid: string | null,
        resourceid: string,
        productname: string,
        parent: Span): Promise<{ result: ResourceUsage[], link: string}> {
        if(target == null) throw new Error("Target is required");
        if(billingid == null || billingid == "") throw new Error("Billing is required");
        let billing = await Config.db.GetOne<Billing>({ collectionname: "users", query: { _id: billingid, _type: "customer" }, jwt }, parent);
        if(billing == null) throw new Error("Billing not found");
        if(resourceid == null || resourceid == "") throw new Error("Resource is required");
        let resource = await Config.db.GetOne<Resource>({ collectionname: "config", query: { _id: resourceid, _type: "resource" }, jwt }, parent);
        if(resource == null) throw new Error("Resource not found");
        if(productname == null || productname == "") throw new Error("Product is required");
        let product = resource.products.find(x => x.name == productname);
        if(product == null) throw new Error("Product is required");
        if(product.stripeprice == null || product.stripeprice == "") throw new Error("Product stripeprice is required");
        let result:ResourceUsage[] = [];
        const rootjwt = Crypt.rootToken();
        let model:ResourceUsage;
        if(target._type == "user") {
            let resources = await Config.db.query<ResourceUsage>({ collectionname: "config", query: { userid: target._id, "customerid": billingid, "product.stripeprice": product.stripeprice, _type: "resourceusage" }, jwt }, parent);
            if(resources.length > 1) throw new Error("User has more than one version of this resource assigned");
            if(resources.length == 0) {
                model = new ResourceUsage();
                model._type = "resourceusage";
                model.userid = target._id;
                model.resource = resource.name;
                model.resourceid = resource._id;
                model.product = product;
                model.quantity = 1;
            } else {
                model = resources[0];
                model.quantity++;
            }
            model.name = resource.name + "/" + product.name + " for " + target.name;
            if(workspaceid != null && workspaceid != "") {
                let workspace = await Config.db.GetOne<Workspace>({ collectionname: "users", query: { _id: workspaceid, _type: "workspace" }, jwt }, parent);
                if(workspace == null) throw new Error("Workspace not found");
                model.workspaceid = workspace._id;
                Base.addRight(model, workspace.admins, workspace.name + " admins", [Rights.read]);
            }
            model.customerid = billingid;
            Base.addRight(model, target._id, "user", [Rights.read]);
            Base.addRight(model, billingid, billing.name + " billing admins", [Rights.read]);
            result.push(await Config.db.InsertOrUpdateOne(model, "config", "_type,userid,resourceid", 1, true, rootjwt, parent));
        }
        if(target._type == "member") {
            let resources = await Config.db.query<ResourceUsage>({ collectionname: "config", query: { memberid: target._id, "customerid": billingid, "product.stripeprice": product.stripeprice, _type: "resourceusage" }, jwt }, parent);
            if(resources.length > 1) throw new Error("Member has more than one version of this resource assigned");
            if(resources.length == 0) {
                model = new ResourceUsage();
                model._type = "resourceusage";
                model.memberid = target._id;
                model.resource = resource.name;
                model.resourceid = resource._id;
                model.product = product;
                model.quantity = 1;
            } else {
                model = resources[0];
                model.quantity++;
            }
            model.name = resource.name + "/" + product.name + " for " + target.name;
            if(workspaceid != null && workspaceid != "") {
                let workspace = await Config.db.GetOne<Workspace>({ collectionname: "users", query: { _id: workspaceid, _type: "workspace" }, jwt }, parent);
                if(workspace == null) throw new Error("Workspace not found");
                model.workspaceid = workspace._id;
                Base.addRight(model, workspace.admins, workspace.name + " admins", [Rights.read]);
            }
            model.customerid = billingid;
            Base.addRight(model, target._id, "member", [Rights.read]);
            Base.addRight(model, billingid, billing.name + " billing admins", [Rights.read]);
            result.push(await Config.db.InsertOrUpdateOne(model, "config", "_type,memberid,resourceid", 1, true, rootjwt, parent));
        }
        if(target._type == "customer") {
            let resources = await Config.db.query<ResourceUsage>({ collectionname: "config", query: { customerid: target._id, "product.stripeprice": product.stripeprice, _type: "resourceusage" }, jwt }, parent);
            if(resources.length > 1) throw new Error("Customer has more than one version of this resource assigned");
            if(resources.length == 0) {
                model = new ResourceUsage();
                model._type = "resourceusage";
                model.customerid = target._id;
                model.resource = resource.name;
                model.resourceid = resource._id;
                model.product = product;
                model.quantity = 1;
            } else {
                model = resources[0];
                model.quantity++;
            }
            model.name = resource.name + "/" + product.name + " for " + target.name;
            if(workspaceid != null && workspaceid != "") {
                let workspace = await Config.db.GetOne<Workspace>({ collectionname: "users", query: { _id: workspaceid, _type: "workspace" }, jwt }, parent);
                if(workspace == null) throw new Error("Workspace not found");
                model.workspaceid = workspace._id;
                Base.addRight(model, workspace.admins, workspace.name + " admins", [Rights.read]);
            }
            Base.addRight(model, (target as Customer).admins, target.name + " admins", [Rights.read]);
            result.push(await Config.db.InsertOrUpdateOne(model, "config", "_type,customerid,resourceid", 1, true, rootjwt, parent));
            (target as Customer).billingid = billingid;
            await Config.db.UpdateOne(target, "users", 1, true, rootjwt, parent);
        }
        if(target._type == "workspace") {
            let resources = await Config.db.query<ResourceUsage>({ collectionname: "config", query: { workspaceid: target._id, "product.stripeprice": product.stripeprice, _type: "resourceusage" }, jwt }, parent);
            if(resources.length > 1) throw new Error("Workspace has more than one version of this resource assigned");
            if(resources.length == 0) {
                model = new ResourceUsage();
                model._type = "resourceusage";
                model.workspaceid = target._id;
                model.resource = resource.name;
                model.resourceid = resource._id;
                model.product = product;
                model.quantity = 1;
            } else {
                model = resources[0];
                model.quantity++;
            }
            model.name = resource.name + "/" + product.name + " for " + target.name;
            Base.addRight(model, (target as Workspace).admins, target.name + " admins", [Rights.read]); 
            let resourceusage = await Config.db.InsertOrUpdateOne(model, "config", "_type,workspaceid,resourceid", 1, true, rootjwt, parent);
            result.push(resourceusage);
            (target as Workspace).billingid = billingid;
            (target as Workspace).resourceusageid = resourceusage._id;
            (target as Workspace).productname = product.name;
            await Config.db.UpdateOne(target, "users", 1, true, rootjwt, parent);
        }
        let link = "";
        if(Config.stripe_api_secret != null && Config.stripe_api_secret != "") {
        }
        return { result, link};
    }
    public static async RemoveResourceUsage(tuser: User, jwt: string, 
        target: User | Customer | Member | Workspace, 
        resourceusageid: string, parent: Span): Promise<ResourceUsage> {
        if(resourceusageid == null || resourceusageid == "") throw new Error("ResourceUsage is required");
        if(target == null) throw new Error("Target is required");
        const rootjwt = Crypt.rootToken();
        let resourceusage = await Config.db.GetOne<ResourceUsage>({ collectionname: "config", query: { _id: resourceusageid, _type: "resourceusage" }, jwt }, parent);
        if(resourceusage == null) throw new Error("ResourceUsage not found");
        if(resourceusage.quantity == 0) throw new Error("ResourceUsage is already removed");
        resourceusage.quantity -= 1;
        if(resourceusage.quantity == 0) {
            await Config.db.DeleteOne(resourceusage._id, "config", false, rootjwt, parent);
        } else {
            resourceusage = await Config.db.UpdateOne(resourceusage, "config", 1, true, rootjwt, parent);
        }
        if(target._type == "workspace") {
            (target as Workspace).resourceusageid = null;
            (target as Workspace).productname = "Free tier";
            await Config.db.UpdateOne(target, "users", 1, true, rootjwt, parent);
        }
        return resourceusage;
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