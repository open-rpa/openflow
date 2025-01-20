import { Span } from "@opentelemetry/api";
import { Config } from "../Config.js";
import { Crypt } from "../Crypt.js";
import { Logger } from "../Logger.js";
import { Rights } from "@openiap/nodeapi";
import { Member, Workspace, User, Customer, Billing, Resource, ResourceUsage, ResourceTargetType, ResourceVariantType, Product, Base, iAgent, ResourceAssignedType } from '../commoninterfaces.js';
import { Wellknown } from "../Util.js";

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
        deprecated: boolean,
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
            model.deprecated = deprecated;
            model._acl = [];
            Base.addRight(model, Wellknown.admins._id, Wellknown.admins.name, [Rights.full_control]);
            Base.addRight(model, Wellknown.users._id, Wellknown.users.name, [Rights.read]);
            return Config.db.InsertOrUpdateOne(model, "config", "_type,name", 1, true, jwt, parent);
    }
    public static CreateProduct(name: string,
        stripeproduct: string,
        stripeprice: string,
        userassign: ResourceAssignedType,
        memberassign: ResourceAssignedType,
        customerassign: ResourceAssignedType,
        workspaceassign: ResourceAssignedType,
        agentassign: ResourceAssignedType,
        metadata: any,
        allowdirectassign: boolean,
        deprecated: boolean,
        order: number): Product {
            const model: Product = new Product();
            model.name = name;
            model.stripeproduct = stripeproduct;
            model.stripeprice = stripeprice;
            model.userassign = userassign;
            model.memberassign = memberassign;
            model.customerassign = customerassign;
            model.workspaceassign = workspaceassign;
            model.agentassign = agentassign;
            model.metadata = metadata;
            model.allowdirectassign = allowdirectassign;
            model.order = order;
            model.deprecated = deprecated;
            return model;
    }
    public static async CreateCommonResources(parent: Span) {
        if (Config.stripe_api_key == "pk_test_DNS5WyEjThYBdjaTgwuyGeVV00KqiCvf99") {
            await Resources.CreateResource("Agent Instance", ResourceTargetType.agent, null, null, null, ResourceVariantType.multiple, 
                {
                    "resources": {
                      "requests": {
                        "cpu": "200m",
                        "memory": "152Mi"
                      }
                    },
                    "nodeSelector": {"cloud.google.com/gke-nodepool": "agent-pool" },
                    "runtime_hours": 4,
                    "agentcount": 1
                  },
                [
                    Resources.CreateProduct("Basic (256Mi ram)", "prod_HEC6rB2wRUwviG", "plan_HECATxbGlff4Pv", null, null, null, null, ResourceAssignedType.single, { "resources": { "requests": { "memory": "256Mi", "cpu": "500m" } }, "nodeSelector": { "cloud.google.com/gke-nodepool": "agent-pool" } }, true, true, 0),
                    Resources.CreateProduct("Plus (512Mi ram)", "prod_HEDSUIZLD7rfgh", "plan_HEDSUl6qdOE4ru", null, null, null, null, ResourceAssignedType.single, { "resources": { "requests": { "memory": "512Mi", "cpu": "500m" } }, "nodeSelector": { "cloud.google.com/gke-nodepool": "agent-pool" } }, true, false,1),
                    Resources.CreateProduct("Premium (1Gi ram)", "prod_HEDTI7YBbwEzVX", "plan_HEDTJQBGaVGnvl", null, null, null, null, ResourceAssignedType.single, { "resources": { "requests": { "memory": "1Gi", "cpu": "900m" } }, "nodeSelector": { "cloud.google.com/gke-nodepool": "agent-pool" } }, true, false,2),
                    Resources.CreateProduct("Premium+ (2Gi ram)", "prod_IERLqCwV7BV8zy", "price_1HdySLC2vUMc6gvh3H1pgG7A", null, null, null, null, ResourceAssignedType.single,  { "resources": { "requests": { "memory": "2Gi", "cpu": "900m" } }, "nodeSelector": { "cloud.google.com/gke-nodepool": "agent-pool" } }, true, false, 3),
                ], true, false, 0,  parent);
                await Resources.CreateResource("Database Usage", ResourceTargetType.customer, null, null, ResourceVariantType.single, null, { dbusage: (1048576 * 25) },
                [
                    Resources.CreateProduct("50Mb quota", "prod_JccNQXT636UNhG", "price_1IzQBRC2vUMc6gvh3Er9QaO8", null, null, ResourceAssignedType.multiple, null, null, { dbusage: (1048576 * 50) }, true, true, 1),
                    Resources.CreateProduct("Metered Monthly", "prod_JccNQXT636UNhG", "price_1IzNEZC2vUMc6gvhAWQbEBHm", null, null, ResourceAssignedType.metered, null, null, { dbusage: (1048576 * 50) }, true, true, 0),
                ], true, true, 1, parent);

                await Resources.CreateResource("Support Agreement", ResourceTargetType.customer, null, null, ResourceVariantType.single, null, {  },
                    [
                        Resources.CreateProduct("Basic Support", "prod_HEGjSQ9M6wiYiP", "plan_HEGjLCtwsVbIx8", null, null, ResourceAssignedType.single, null, null, { }, true, true, 0),
                    ], true, false, 1, parent);
    
                await Resources.CreateResource("Support Hours", ResourceTargetType.customer, null, null, ResourceVariantType.multiple, null, {  },
                [
                    Resources.CreateProduct("Premium Hours", "prod_HEZnir2GdKX5Jm", "plan_HEZp4Q4In2XcXe", null, null, ResourceAssignedType.metered, null, null, { "supportplan": true }, true, false, 1),
                    Resources.CreateProduct("Basic Hours", "prod_HEGjSQ9M6wiYiP", "plan_HEZAsA1DfkiQ6k", null, null, ResourceAssignedType.metered, null, null, { "supportplan": true }, true, true, 0),
                ], true, false, 1, parent);
                await Resources.CreateResource("OpenCore License", ResourceTargetType.customer, null, null, ResourceVariantType.single, null, {  },
                [
                    Resources.CreateProduct("Premium License", "prod_JcXS2AvXfwk1Lv", "price_1Qgw6DC2vUMc6gvhHuoezYIH", null, null, ResourceAssignedType.multiple, null, null, { }, true, false, 1),
                    Resources.CreateProduct("Premium License Legacy", "prod_JcXS2AvXfwk1Lv", "price_1IzISoC2vUMc6gvhMtqTq2Ef", null, null, ResourceAssignedType.multiple, null, null, { }, true, true, 1),
                ], true, false, 1, parent);
        } else if (Config.stripe_api_key == "pk_live_0XOJdv1fPLPnOnRn40CSdBsh009Ge1B2yI") {
            await Resources.CreateResource("Agent Instance", ResourceTargetType.agent, null, null, null, ResourceVariantType.multiple, 
                {
                    "resources": {
                        "requests": {
                        "cpu": "200m",
                        "memory": "152Mi"
                        }
                    },
                    "nodeSelector": {"cloud.google.com/gke-nodepool": "agent-pool" },
                    "runtime_hours": 4,
                    "agentcount": 1
                    },
                [
                    Resources.CreateProduct("Basic (256Mi ram)", "prod_RG5CJC2X3xuVil", "price_1QNZ1mC2vUMc6gvhWxYwPvsN", null, null, null, null, ResourceAssignedType.single, { "resources": { "requests": { "memory": "256Mi", "cpu": "500m" } }, "nodeSelector": { "cloud.google.com/gke-nodepool": "agent-pool" } }, true, false, 0),
                    Resources.CreateProduct("Basic (256Mi ram) - Legacy", "prod_Jfg1JU7byqHYs9", "price_1J2KglC2vUMc6gvh3JGredpM", null, null, null, null, ResourceAssignedType.single, { "resources": { "requests": { "memory": "256Mi", "cpu": "500m" } }, "nodeSelector": { "cloud.google.com/gke-nodepool": "agent-pool" } }, true, true, 4),
                    Resources.CreateProduct("Plus (512Mi ram)", "prod_Jfg1JU7byqHYs9", "price_1J2KhPC2vUMc6gvhIwTNUWAk", null, null, null, null, ResourceAssignedType.single, { "resources": { "requests": { "memory": "512Mi", "cpu": "500m" } }, "nodeSelector": { "cloud.google.com/gke-nodepool": "agent-pool" } }, true, false, 1),
                    Resources.CreateProduct("Premium (1Gi ram)", "prod_Jfg1JU7byqHYs9", "price_1J2KhuC2vUMc6gvhRcs1mdUr", null, null, null, null, ResourceAssignedType.single, { "resources": { "requests": { "memory": "1Gi", "cpu": "900m" } }, "nodeSelector": { "cloud.google.com/gke-nodepool": "agent-pool" } }, true, false, 2),
                    Resources.CreateProduct("Premium+ (2Gi ram)", "prod_Jfg1JU7byqHYs9", "price_1J2KiFC2vUMc6gvhGy0scDB5", null, null, null, null, ResourceAssignedType.single,  { "resources": { "requests": { "memory": "2Gi", "cpu": "900m" } }, "nodeSelector": { "cloud.google.com/gke-nodepool": "agent-pool" } }, true, false, 3),
                ], true, false, 0, parent);
                await Resources.CreateResource("Database Usage", ResourceTargetType.customer, null, null, ResourceVariantType.single, null, { dbusage: (1048576 * 25) },
                [
                    Resources.CreateProduct("50Mb quota", "prod_JffpwKLldz2QWN", "price_1J2KWFC2vUMc6gvheg4kFzjI", null, null, ResourceAssignedType.multiple, null, null, { dbusage: (1048576 * 50) }, true, true, 1),
                    Resources.CreateProduct("Metered Monthly", "prod_JffpwKLldz2QWN", "price_1Jkl6HC2vUMc6gvhXe4asJXW", null, null, ResourceAssignedType.metered, null, null, { dbusage: (1048576 * 50) }, true, true, 0),
                ], true, true, 1, parent);
                await Resources.CreateResource("Support Hours", ResourceTargetType.customer, null, null, ResourceVariantType.multiple, null, { },
                [
                    Resources.CreateProduct("Premium Hours", "prod_JccNQXT636UNhG", "plan_HFkbfsAs1Yvcly", null, null, ResourceAssignedType.metered, null, null, { "supportplan": true }, false, false, 1)
                ], false, false, 1, parent);
                await Resources.CreateResource("OpenCore License", ResourceTargetType.customer, null, null, ResourceVariantType.single, null, {  },
                    [
                        Resources.CreateProduct("Premium License", "prod_JccNQXT636UNhG", "to_be_created_premium_license", null, null, ResourceAssignedType.multiple, null, null, { }, true, false, 1),
                        Resources.CreateProduct("Premium License Legacy", "prod_HFkZ8lKn7GtFQU", "price_1J2KcMC2vUMc6gvhmmsAGo35", null, null, ResourceAssignedType.multiple, null, null, { }, true, false, 1),
                    ], true, false, 1, parent);
                } else {
            await Resources.CreateResource("Agent Instance", ResourceTargetType.agent, null, null, null, ResourceVariantType.multiple, { "runtime_hours": 8, "agentcount": 1, "resources": { "limits": { "memory": "225Mi" } } },
                [
                    Resources.CreateProduct("Basic (256Mi ram)", "prod_HEC6rB2wRUwviG", "plan_HECATxbGlff4Pv", null, null, null, null, ResourceAssignedType.single, { "resources": { "limits": { "memory": "256Mi" }, "requests": { "memory": "256Mi" } } }, true, false, 0),
                    Resources.CreateProduct("Plus (512Mi ram)", "prod_HEDSUIZLD7rfgh", "plan_HEDSUl6qdOE4ru", null, null, null, null, ResourceAssignedType.single, { "resources": { "limits": { "memory": "512Mi" }, "requests": { "memory": "512Mi" } } }, true, false, 1),
                    Resources.CreateProduct("Premium (1Gi ram)", "prod_HEDTI7YBbwEzVX", "plan_HEDTJQBGaVGnvl", null, null, null, null, ResourceAssignedType.single, { "resources": { "limits": { "memory": "1Gi" }, "requests": { "memory": "1Gi" } } }, true, false, 2),
                    Resources.CreateProduct("Premium+ (2Gi ram)", "prod_IERLqCwV7BV8zy", "price_1HdySLC2vUMc6gvh3H1pgG7A", null, null, null, null, ResourceAssignedType.single,  { "resources": { "limits": { "memory": "2Gi" }, "requests": { "memory": "2Gi" } } }, true, false, 3),
                ], true, false, 0, parent);
            await Resources.CreateResource("Database Usage", ResourceTargetType.customer, null, null, ResourceVariantType.single, null, { dbusage: (1048576 * 25) },
                [
                    Resources.CreateProduct("50Mb quota", "prod_JccNQXT636UNhG", "price_1IzQBRC2vUMc6gvh3Er9QaO8", null, null, ResourceAssignedType.multiple, null, null, { dbusage: (1048576 * 50) }, true, true, 1),
                    Resources.CreateProduct("Metered Monthly", "prod_JccNQXT636UNhG", "price_1IzNEZC2vUMc6gvhAWQbEBHm", null, null, ResourceAssignedType.metered, null, null, { dbusage: (1048576 * 50) }, true, true, 0),
                ], true, true, 1, parent);
        }

    }
    public static async CreateResourceUsage(tuser: User, jwt: string, 
        target: User | Customer | Member | Workspace | iAgent, 
        billingid: string,
        workspaceid: string | null,
        resourceid: string,
        productname: string,
        parent: Span): Promise<{ result: ResourceUsage[], link: string}> {
        if(target == null) throw new Error("Target is required");
        if(billingid == null || billingid == "") throw new Error(Logger.enricherror(tuser, target, "Billing is required"));
        let billing = await Config.db.GetOne<Billing>({ collectionname: "users", query: { _id: billingid, _type: "customer" }, jwt }, parent);
        if(billing == null) throw new Error(Logger.enricherror(tuser, billing, "Billing not found"));
        if(resourceid == null || resourceid == "") throw new Error(Logger.enricherror(tuser, target, "Resourceid is required"));
        let resource = await Config.db.GetOne<Resource>({ collectionname: "config", query: { _id: resourceid, _type: "resource" }, jwt }, parent);
        if(resource == null) throw new Error(Logger.enricherror(tuser, target, "Resource not found or access denied"));
        if(productname == null || productname == "") throw new Error(Logger.enricherror(tuser, target, "Product is required"));
        let product = resource.products.find(x => x.name == productname);
        if(product == null) throw new Error(Logger.enricherror(tuser, target, "Product is required"));
        if(product.stripeprice == null || product.stripeprice == "") throw new Error(Logger.enricherror(tuser, target, "Product stripeprice is required"));
        let result:ResourceUsage[] = [];
        const rootjwt = Crypt.rootToken();
        let model:ResourceUsage;
        if(tuser._id != Wellknown.root._id) {
            if(resource.allowdirectassign == false) throw new Error(Logger.enricherror(tuser, target, "Resource does not allow direct assign"));
            if(product.allowdirectassign == false) throw new Error(Logger.enricherror(tuser, target, "Product does not allow direct assign"));
        }
        if(resource.target != target._type) throw new Error(Logger.enricherror(tuser, target, "Resource is " + resource.target + " and cannot be assigned to a " + target._type));
        if(target._type == "user") {
            let resources = await Config.db.query<ResourceUsage>({ collectionname: "config", query: { userid: target._id, "customerid": billingid, "product.stripeprice": product.stripeprice, _type: "resourceusage" }, jwt }, parent);
            if(resources.length > 1) throw new Error(Logger.enricherror(tuser, target, "User has more than one version of this resource assigned"));
            if(resources.length == 1) model = resources[0];
            if(resource.userassign == "singlevariant") {
                let resources2 = await Config.db.query<ResourceUsage>({ collectionname: "config", query: { userid: target._id, "customerid": billingid, "resourceid": resource._id, _type: "resourceusage" }, jwt }, parent);
                if(resources2.length > 1) throw new Error(Logger.enricherror(tuser, target, "User has more than one version of this resource assigned"));
                if(resource != null && resources2.length == 1) {
                    if(resources2[0].product.stripeprice != product.stripeprice) throw new Error(Logger.enricherror(tuser, target, "User already has " + resources2[0].product.name + " assigned"));
                }
            }
            if(resource.deprecated == true) {
                if(resources.length == 0) throw new Error(Logger.enricherror(tuser, target, "User cannot have deprecated resource assigned"));
            }
        } else if(target._type == "member") {
            let resources = await Config.db.query<ResourceUsage>({ collectionname: "config", query: { memberid: target._id, "customerid": billingid, "product.stripeprice": product.stripeprice, _type: "resourceusage" }, jwt }, parent);
            if(resources.length > 1) throw new Error(Logger.enricherror(tuser, target, "Member has more than one version of this resource assigned"));
            if(resources.length == 1) model = resources[0];
            if(resource.memberassign == "singlevariant") {
                let resources2 = await Config.db.query<ResourceUsage>({ collectionname: "config", query: { memberid: target._id, "customerid": billingid, "resourceid": resource._id, _type: "resourceusage" }, jwt }, parent);
                if(resources2.length > 1) throw new Error(Logger.enricherror(tuser, target, "Member has more than one version of this resource assigned"));
                if(resource != null && resources2.length == 1) {
                    if(resources2[0].product.stripeprice != product.stripeprice) throw new Error(Logger.enricherror(tuser, target, "Member already has " + resources2[0].product.name + " assigned"));
                }
            }
            if(resource.deprecated == true) {
                if(resources.length == 0) throw new Error(Logger.enricherror(tuser, target, "Member cannot have deprecated resource assigned"));
            }
        } else if(target._type == "customer") {
            let resources = await Config.db.query<ResourceUsage>({ collectionname: "config", query: { customerid: target._id, "product.stripeprice": product.stripeprice, _type: "resourceusage" }, jwt }, parent);
            if(resources.length > 1) throw new Error(Logger.enricherror(tuser, target, "Customer has more than one version of this resource assigned"));
            if(resources.length == 1) model = resources[0];
            if(resource.customerassign == "singlevariant") {
                let resources2 = await Config.db.query<ResourceUsage>({ collectionname: "config", query: { customerid: target._id, "resourceid": resource._id, _type: "resourceusage" }, jwt }, parent);
                if(resources2.length > 1) throw new Error(Logger.enricherror(tuser, target, "Customer has more than one version of this resource assigned"));
                if(resource != null && resources2.length == 1) {
                    if(resources2[0].product.stripeprice != product.stripeprice) throw new Error(Logger.enricherror(tuser, target, "Customer already has " + resources2[0].product.name + " assigned"));
                }
            }
            if(resource.deprecated == true) {
                if(resources.length == 0) throw new Error(Logger.enricherror(tuser, target, "Customer cannot have deprecated resource assigned"));
            }
        } else if(target._type == "workspace") {
            let resources = await Config.db.query<ResourceUsage>({ collectionname: "config", query: { workspaceid: target._id, "product.stripeprice": product.stripeprice, _type: "resourceusage" }, jwt }, parent);
            if(resources.length > 1) throw new Error(Logger.enricherror(tuser, target, "Workspace has more than one version of this resource assigned"));
            if(resources.length == 1) model = resources[0];
            if(resource.workspaceassign == "singlevariant") {
                let resources2 = await Config.db.query<ResourceUsage>({ collectionname: "config", query: { workspaceid: target._id, "resourceid": resource._id, _type: "resourceusage" }, jwt }, parent);
                if(resources2.length > 1) throw new Error(Logger.enricherror(tuser, target, "Workspace has more than one version of this resource assigned"));
                if(resource != null && resources2.length == 1) {
                    if(resources2[0].product.stripeprice != product.stripeprice) throw new Error(Logger.enricherror(tuser, target, "Workspace already has " + resources2[0].product.name + " assigned"));
                }
            }
            if(resource.deprecated == true) {
                if(resources.length == 0) throw new Error(Logger.enricherror(tuser, target, "Workspace cannot have deprecated resource assigned"));
            }
        } else if(target._type == "agent") {
            let resources = await Config.db.query<ResourceUsage>({ collectionname: "config", query: { workspaceid: target._id, "product.stripeprice": product.stripeprice, _type: "resourceusage" }, jwt }, parent);
            if(resources.length > 1) throw new Error(Logger.enricherror(tuser, target, "Agent has more than one version of this resource assigned"));
            if(resources.length == 1) model = resources[0];
            if(resource.workspaceassign == "singlevariant") {
                let resources2 = await Config.db.query<ResourceUsage>({ collectionname: "config", query: { workspaceid: target._id, "resourceid": resource._id, _type: "resourceusage" }, jwt }, parent);
                if(resources2.length > 1) throw new Error(Logger.enricherror(tuser, target, "Agent has more than one version of this resource assigned"));
                if(resource != null && resources2.length == 1) {
                    if(resources2[0].product.stripeprice != product.stripeprice) throw new Error(Logger.enricherror(tuser, target, "Agent already has " + resources2[0].product.name + " assigned"));
                }
            }
            if(resource.deprecated == true) {
                if(resources.length == 0) throw new Error(Logger.enricherror(tuser, target, "Agent cannot have deprecated resource assigned"));
            }
        } else {
            throw new Error(Logger.enricherror(tuser, target, "Target " + target._type + " is not supported"));
        }
        if(model == null) {
            if(resource.deprecated == true) throw new Error(Logger.enricherror(tuser, target, "Resource is deprecated and cannot be assigned")); // should never happen ?
            if(product.deprecated == true) throw new Error(Logger.enricherror(tuser, target, "Product is deprecated and cannot be assigned")); // should never happen ?
            model = new ResourceUsage();
            model._type = "resourceusage";
            model.resource = resource.name;
            model.resourceid = resource._id;
            model.customerid = billing._id;
            model.product = product;
            model.quantity = 1;
            delete model.userid; // angularjs user userid to check target
            delete model.memberid;
            model.siid = ""; // angularjs user siid to check payment
            model.name = resource.name + "/" + product.name + " for " + target.name;
        } else {
            model.quantity++;
        }
        Base.addRight(model, billingid, billing.name + " billing admins", [Rights.read]);
        if(workspaceid != null && workspaceid != "") {
            let workspace = await Config.db.GetOne<Workspace>({ collectionname: "users", query: { _id: workspaceid, _type: "workspace" }, jwt }, parent);
            if(workspace == null) throw new Error(Logger.enricherror(tuser, target, "Workspace not found or access denied"));
            model.workspaceid = workspace._id;
            Base.addRight(model, workspace.admins, workspace.name + " admins", [Rights.read]);
        }

        if(target._type == "user") {
            Base.addRight(model, target._id, target.name, [Rights.read]);
            model.userid = target._id;
            if(product.userassign == "single" || product.userassign == "metered") {
                if(model.quantity > 1) throw new Error(Logger.enricherror(tuser, target, "User can only have product assigned once"));
            }
        } else if(target._type == "member") {
            model.memberid = target._id;
            model.userid = (target as Member).userid;
            Base.addRight(model, (target as Member).userid, target.name, [Rights.read]);
            Base.addRight(model, billingid, billing.name + " billing admins", [Rights.read]);
            if(product.memberassign == "single" || product.memberassign == "metered") {
                if(model.quantity > 1) throw new Error(Logger.enricherror(tuser, target, "Member can only have product assigned once"));
            }
        } else if(target._type == "customer") {
            model.customerid = target._id;
            Base.addRight(model, (target as Customer).admins, target.name + " admins", [Rights.read]);
            Base.addRight(model, (target as Customer).users, target.name + " users", [Rights.read]);
            if(product.customerassign == "single" || product.customerassign == "metered") {
                if(model.quantity > 1) throw new Error(Logger.enricherror(tuser, target, "Customer can only have product assigned once"));
            }
        } else if(target._type == "workspace") {
            model.workspaceid = target._id;
            Base.addRight(model, (target as Workspace).admins, target.name + " admins", [Rights.read]);
            Base.addRight(model, (target as Workspace).users, target.name + " users", [Rights.read]);
            if(product.workspaceassign == "single" || product.workspaceassign == "metered") {
                if(model.quantity > 1) throw new Error(Logger.enricherror(tuser, target, "Workspace can only have product assigned once"));
            }
        } else if(target._type == "agent") {
            model.agentid = target._id;
            if(product.agentassign == "single" || product.agentassign == "metered") {
                if(model.quantity > 1) throw new Error(Logger.enricherror(tuser, target, "Agent can only have product assigned once"));
            }
        }
        let resourceusage: ResourceUsage;
        if(model._id == null || model._id == "") {
            resourceusage = await Config.db.InsertOne(model, "config", 1, true, rootjwt, parent);
            result.push(resourceusage);
        } else {
            resourceusage = await Config.db.UpdateOne(model, "config", 1, true, rootjwt, parent)
            result.push(resourceusage);
        }
        if(target._type == "workspace") {
            (target as Workspace).billingid = billingid;
            (target as Workspace).resourceusageid = resourceusage._id;
            (target as Workspace).productname = product.name;
            await Config.db.UpdateOne(target, "users", 1, true, rootjwt, parent);
        } else if (target._type == "agent") {
            (target as iAgent).stripeprice = product.stripeprice;
            (target as iAgent).billingid = billingid;
            (target as iAgent).resourceusageid = resourceusage._id;
            (target as iAgent).productname = product.name;
            await Config.db.UpdateOne(target, "agents", 1, true, rootjwt, parent);
        }
        let link = "";
        if(Config.stripe_api_secret != null && Config.stripe_api_secret != "") {
        }
        return { result, link};
    }
    public static async RemoveResourceUsage(tuser: User, jwt: string, 
        target: User | Customer | Member | Workspace | iAgent, 
        resourceusageid: string, parent: Span): Promise<ResourceUsage> {
        if(resourceusageid == null || resourceusageid == "") throw new Error("ResourceUsageid is required");
        if(target == null) throw new Error("Target is required");
        const rootjwt = Crypt.rootToken();
        let resourceusage = await Config.db.GetOne<ResourceUsage>({ collectionname: "config", query: { _id: resourceusageid, _type: "resourceusage" }, jwt }, parent);
        if(resourceusage == null) throw new Error(Logger.enricherror(tuser, null, "ResourceUsage not found or access denied"));
        if(resourceusage.quantity > 0) resourceusage.quantity -= 1;
        let resource = await Config.db.GetOne<Resource>({ collectionname: "config", query: { _id: resourceusage.resourceid, _type: "resource" }, jwt }, parent);
        if(resource == null) throw new Error(Logger.enricherror(tuser, target, "Resource not found or access denied"));

        if(target._type == "user") {
            if(resource.target != target._type) throw new Error(Logger.enricherror(tuser, target, "Resource is " + resource.target + " and cannot be assigned to a " + target._type));
            if(resourceusage.userid != target._id) throw new Error(Logger.enricherror(tuser, target, "ResourceUsage is not assigned to this user"));
        } else if(target._type == "member") {
            if(resource.target != target._type) throw new Error(Logger.enricherror(tuser, target, "Resource is " + resource.target + " and cannot be assigned to a " + target._type));
            if(resourceusage.memberid != target._id) throw new Error(Logger.enricherror(tuser, target, "ResourceUsage is not assigned to this member"));
        } else if(target._type == "customer") {
            if(resource.target != target._type) throw new Error(Logger.enricherror(tuser, target, "Resource is " + resource.target + " and cannot be assigned to a " + target._type));
            if(resourceusage.customerid != target._id) throw new Error(Logger.enricherror(tuser, target, "ResourceUsage is not assigned to this customer"));
        } else if(target._type == "workspace") {
            if(resource.target != target._type) throw new Error(Logger.enricherror(tuser, target, "Resource is " + resource.target + " and cannot be assigned to a " + target._type));
            if(resourceusage.workspaceid != target._id) throw new Error(Logger.enricherror(tuser, target, "ResourceUsage is not assigned to this workspace"));
            (target as Workspace).resourceusageid = null;
            (target as Workspace).productname = "Free tier";
            await Config.db.UpdateOne(target, "users", 1, true, rootjwt, parent);
        } else if(target._type == "agent") {
            if(resource.target != target._type) throw new Error(Logger.enricherror(tuser, target, "Resource is " + resource.target + " and cannot be assigned to a " + target._type));
            if(resourceusage.agentid != target._id) throw new Error(Logger.enricherror(tuser, target, "ResourceUsage is not assigned to this agent"));
            (target as iAgent).stripeprice = undefined;
            (target as iAgent).billingid = undefined;
            (target as iAgent).resourceusageid = undefined;
            (target as iAgent).productname = "Free tier";
            await Config.db.UpdateOne(target, "agents", 1, true, rootjwt, parent);
            (target as iAgent).resourceusageid = null;
            (target as iAgent).productname = "Free tier";
            await Config.db.UpdateOne(target, "users", 1, true, rootjwt, parent);
        } else {
            throw new Error(Logger.enricherror(tuser, target, "Target " + target._type + " is not supported"));
        }

        if(resourceusage.quantity < 1) {
            await Config.db.DeleteOne(resourceusage._id, "config", false, rootjwt, parent);
        } else {
            resourceusage = await Config.db.UpdateOne(resourceusage, "config", 1, true, rootjwt, parent);
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