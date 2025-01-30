import { Span } from "@opentelemetry/api";
import { Config } from "../Config.js";
import { Crypt } from "../Crypt.js";
import { Logger } from "../Logger.js";
import { Rights } from "@openiap/nodeapi";
import { Member, Workspace, User, Customer, Billing, Resource, ResourceUsage, ResourceTargetType, ResourceVariantType, Product, Base, iAgent, ResourceAssignedType } from '../commoninterfaces.js';
import { Util, Wellknown } from "../Util.js";
import { Message } from "../Messages/Message.js";
import { stripe_customer, stripe_list, stripe_price, stripe_subscription, stripe_subscription_item } from "@openiap/openflow-api";
import { Payments } from "./Payments.js";

export class Resources {
    public static async CreateResource(name: string,
        target: ResourceTargetType,
        assign: ResourceVariantType,
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
        model.assign = assign;
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
        lookup_key: string,
        assign: ResourceAssignedType,
        metadata: any,
        allowdirectassign: boolean,
        deprecated: boolean,
        order: number): Product {
        const model: Product = new Product();
        model.name = name;
        model.stripeproduct = stripeproduct;
        model.stripeprice = stripeprice;
        model.lookup_key = lookup_key;
        model.assign = assign;
        model.metadata = metadata;
        model.allowdirectassign = allowdirectassign;
        model.order = order;
        model.deprecated = deprecated;
        return model;
    }
    public static async CreateCommonResources(parent: Span) {
        if (Config.stripe_api_key == "pk_test_DNS5WyEjThYBdjaTgwuyGeVV00KqiCvf99") {
            await Resources.CreateResource("Agent Instance", ResourceTargetType.agent, ResourceVariantType.single,
                {
                    "resources": {
                        "requests": {
                            "cpu": "200m",
                            "memory": "152Mi"
                        }
                    },
                    "nodeSelector": { "cloud.google.com/gke-nodepool": "agent-pool" },
                    "runtime_hours": 4,
                    "agentcount": 1
                },
                [
                    Resources.CreateProduct("Basic (256Mi ram)", "prod_ReVjqIUfPNOX0W", "price_1QlCiKC2vUMc6gvhz97QpaAD", "agent_basic_monthly", ResourceAssignedType.single, { "resources": { "requests": { "memory": "256Mi", "cpu": "500m" } }, "nodeSelector": { "cloud.google.com/gke-nodepool": "agent-pool" } }, true, false, 0),
                    Resources.CreateProduct("Basic (256Mi ram) old", "prod_HEC6rB2wRUwviG", "plan_HECATxbGlff4Pv", "", ResourceAssignedType.single, { "resources": { "requests": { "memory": "256Mi", "cpu": "500m" } }, "nodeSelector": { "cloud.google.com/gke-nodepool": "agent-pool" } }, true, true, 0),
                    Resources.CreateProduct("Plus (512Mi ram)", "prod_HEDSUIZLD7rfgh", "plan_HEDSUl6qdOE4ru", "agent_plus_monthly", ResourceAssignedType.single, { "resources": { "requests": { "memory": "512Mi", "cpu": "500m" } }, "nodeSelector": { "cloud.google.com/gke-nodepool": "agent-pool" } }, true, false, 1),
                    Resources.CreateProduct("Premium (1Gi ram)", "prod_HEDTI7YBbwEzVX", "plan_HEDTJQBGaVGnvl", "agent_premium_monthly", ResourceAssignedType.single, { "resources": { "requests": { "memory": "1Gi", "cpu": "900m" } }, "nodeSelector": { "cloud.google.com/gke-nodepool": "agent-pool" } }, true, false, 2),
                    Resources.CreateProduct("Advanced (2Gi ram)", "prod_IERLqCwV7BV8zy", "price_1HdySLC2vUMc6gvh3H1pgG7A", "agent_advanced_monthly", ResourceAssignedType.single, { "resources": { "requests": { "memory": "2Gi", "cpu": "900m" } }, "nodeSelector": { "cloud.google.com/gke-nodepool": "agent-pool" } }, true, false, 3),
                ], true, false, 0, parent);
            await Resources.CreateResource("Database Usage", ResourceTargetType.customer, ResourceVariantType.single, { dbusage: (1048576 * 25) },
                [
                    Resources.CreateProduct("50Mb quota", "prod_JccNQXT636UNhG", "price_1IzQBRC2vUMc6gvh3Er9QaO8", "", ResourceAssignedType.multiple, { dbusage: (1048576 * 50) }, true, true, 1),
                    Resources.CreateProduct("Metered Monthly", "prod_JccNQXT636UNhG", "price_1IzNEZC2vUMc6gvhAWQbEBHm", "", ResourceAssignedType.metered, { dbusage: (1048576 * 50) }, true, true, 0),
                ], true, true, 1, parent);

            await Resources.CreateResource("Support Agreement", ResourceTargetType.customer, ResourceVariantType.single, {},
                [
                    Resources.CreateProduct("Basic Support", "prod_HEGjSQ9M6wiYiP", "plan_HEGjLCtwsVbIx8", "", ResourceAssignedType.single, {}, true, true, 0),
                ], true, false, 1, parent);

            await Resources.CreateResource("Support Hours", ResourceTargetType.customer, ResourceVariantType.multiple, {},
                [
                    Resources.CreateProduct("Premium Hours", "prod_HEZnir2GdKX5Jm", "plan_HEZp4Q4In2XcXe", "", ResourceAssignedType.metered, { "supportplan": true }, true, false, 1),
                    Resources.CreateProduct("Basic Hours", "prod_HEGjSQ9M6wiYiP", "plan_HEZAsA1DfkiQ6k", "", ResourceAssignedType.metered, { "supportplan": true }, true, true, 0),
                ], true, false, 1, parent);
            await Resources.CreateResource("OpenCore License", ResourceTargetType.customer, ResourceVariantType.single, {},
                [
                    Resources.CreateProduct("Premium License", "prod_JcXS2AvXfwk1Lv", "price_1Qgw6DC2vUMc6gvhHuoezYIH", "", ResourceAssignedType.multiple, {}, true, false, 1),
                    Resources.CreateProduct("Premium License Legacy", "prod_JcXS2AvXfwk1Lv", "price_1IzISoC2vUMc6gvhMtqTq2Ef", "", ResourceAssignedType.multiple, {}, true, true, 1),
                ], true, false, 1, parent);
            await Resources.CreateResource("Workspaces", ResourceTargetType.workspace, ResourceVariantType.single, {},
                [
                    Resources.CreateProduct("Basic tier", "prod_ReVF12d55IgEfP", "price_1QlCFIC2vUMc6gvhGBxdjMxp", "workspace_basic_monthly", ResourceAssignedType.single, {}, true, false, 1),
                    Resources.CreateProduct("Enterprise tier", "prod_RfB0sjDxjN0yCo", "price_1QlqeJC2vUMc6gvhvBWhaQUA", "workspace_ee_monthly", ResourceAssignedType.single, {}, true, true, 1),
                ], true, false, 1, parent);

        } else if (Config.stripe_api_key == "pk_live_0XOJdv1fPLPnOnRn40CSdBsh009Ge1B2yI") {
            await Resources.CreateResource("Agent Instance", ResourceTargetType.agent, ResourceVariantType.single,
                {
                    "resources": {
                        "requests": {
                            "cpu": "200m",
                            "memory": "152Mi"
                        }
                    },
                    "nodeSelector": { "cloud.google.com/gke-nodepool": "agent-pool" },
                    "runtime_hours": 4,
                    "agentcount": 1
                },
                [
                    Resources.CreateProduct("Basic (256Mi ram)", "prod_RG5CJC2X3xuVil", "price_1QNZ1mC2vUMc6gvhWxYwPvsN", "agent_basic_monthly", ResourceAssignedType.single, { "resources": { "requests": { "memory": "256Mi", "cpu": "500m" } }, "nodeSelector": { "cloud.google.com/gke-nodepool": "agent-pool" } }, true, false, 0),
                    Resources.CreateProduct("Basic (256Mi ram) - Legacy", "prod_Jfg1JU7byqHYs9", "price_1J2KglC2vUMc6gvh3JGredpM", "", ResourceAssignedType.single, { "resources": { "requests": { "memory": "256Mi", "cpu": "500m" } }, "nodeSelector": { "cloud.google.com/gke-nodepool": "agent-pool" } }, true, true, 4),
                    Resources.CreateProduct("Plus (512Mi ram)", "prod_Jfg1JU7byqHYs9", "price_1J2KhPC2vUMc6gvhIwTNUWAk", "agent_plus_monthly", ResourceAssignedType.single, { "resources": { "requests": { "memory": "512Mi", "cpu": "500m" } }, "nodeSelector": { "cloud.google.com/gke-nodepool": "agent-pool" } }, true, false, 1),
                    Resources.CreateProduct("Premium (1Gi ram)", "prod_Jfg1JU7byqHYs9", "price_1J2KhuC2vUMc6gvhRcs1mdUr", "agent_premium_monthly", ResourceAssignedType.single, { "resources": { "requests": { "memory": "1Gi", "cpu": "900m" } }, "nodeSelector": { "cloud.google.com/gke-nodepool": "agent-pool" } }, true, false, 2),
                    Resources.CreateProduct("Advanced (2Gi ram)", "prod_Jfg1JU7byqHYs9", "price_1J2KiFC2vUMc6gvhGy0scDB5", "agent_advanced_monthly", ResourceAssignedType.single, { "resources": { "requests": { "memory": "2Gi", "cpu": "900m" } }, "nodeSelector": { "cloud.google.com/gke-nodepool": "agent-pool" } }, true, false, 3),
                ], true, false, 0, parent);
            await Resources.CreateResource("Database Usage", ResourceTargetType.customer, ResourceVariantType.single, { dbusage: (1048576 * 25) },
                [
                    Resources.CreateProduct("50Mb quota", "prod_JffpwKLldz2QWN", "price_1J2KWFC2vUMc6gvheg4kFzjI", "", ResourceAssignedType.multiple, { dbusage: (1048576 * 50) }, true, true, 1),
                    Resources.CreateProduct("Metered Monthly", "prod_JffpwKLldz2QWN", "price_1Jkl6HC2vUMc6gvhXe4asJXW", "", ResourceAssignedType.metered, { dbusage: (1048576 * 50) }, true, true, 0),
                ], true, true, 1, parent);
            await Resources.CreateResource("Support Hours", ResourceTargetType.customer, ResourceVariantType.multiple, {},
                [
                    Resources.CreateProduct("Premium Hours", "prod_JccNQXT636UNhG", "plan_HFkbfsAs1Yvcly", "", ResourceAssignedType.metered, { "supportplan": true }, false, false, 1)
                ], false, false, 1, parent);
            await Resources.CreateResource("OpenCore License", ResourceTargetType.customer, ResourceVariantType.single, {},
                [
                    Resources.CreateProduct("Premium License", "prod_JccNQXT636UNhG", "to_be_created_premium_license", "", ResourceAssignedType.multiple, {}, true, false, 1),
                    Resources.CreateProduct("Premium License Legacy", "prod_HFkZ8lKn7GtFQU", "price_1J2KcMC2vUMc6gvhmmsAGo35", "", ResourceAssignedType.multiple, {}, true, false, 1),
                ], true, false, 1, parent);
            await Resources.CreateResource("Workspaces", ResourceTargetType.workspace, ResourceVariantType.single, {},
                [
                    Resources.CreateProduct("Basic tier", "prod_ReVF12d55IgEfP", "price_1QlCFIC2vUMc6gvhGBxdjMxp", "workspace_basic_monthly", ResourceAssignedType.single, {}, true, false, 1),
                    Resources.CreateProduct("Enterprise tier", "prod_RfB0sjDxjN0yCo", "price_1QlqeJC2vUMc6gvhvBWhaQUA", "workspace_ee_monthly", ResourceAssignedType.single, {}, true, true, 1),
                ], true, false, 1, parent);

        } else {
            await Resources.CreateResource("Agent Instance", ResourceTargetType.agent, ResourceVariantType.single, { "runtime_hours": 8, "agentcount": 1, "resources": { "limits": { "memory": "225Mi" } } },
                [
                    Resources.CreateProduct("Basic (256Mi ram)", "prod_HEC6rB2wRUwviG", "plan_HECATxbGlff4Pv", "", ResourceAssignedType.single, { "resources": { "limits": { "memory": "256Mi" }, "requests": { "memory": "256Mi" } } }, true, false, 0),
                    Resources.CreateProduct("Plus (512Mi ram)", "prod_HEDSUIZLD7rfgh", "plan_HEDSUl6qdOE4ru", "", ResourceAssignedType.single, { "resources": { "limits": { "memory": "512Mi" }, "requests": { "memory": "512Mi" } } }, true, false, 1),
                    Resources.CreateProduct("Premium (1Gi ram)", "prod_HEDTI7YBbwEzVX", "plan_HEDTJQBGaVGnvl", "", ResourceAssignedType.single, { "resources": { "limits": { "memory": "1Gi" }, "requests": { "memory": "1Gi" } } }, true, false, 2),
                    Resources.CreateProduct("Premium+ (2Gi ram)", "prod_IERLqCwV7BV8zy", "price_1HdySLC2vUMc6gvh3H1pgG7A", "", ResourceAssignedType.single, { "resources": { "limits": { "memory": "2Gi" }, "requests": { "memory": "2Gi" } } }, true, false, 3),
                ], true, false, 0, parent);
            await Resources.CreateResource("Database Usage", ResourceTargetType.customer, ResourceVariantType.single, { dbusage: (1048576 * 25) },
                [
                    Resources.CreateProduct("50Mb quota", "prod_JccNQXT636UNhG", "price_1IzQBRC2vUMc6gvh3Er9QaO8", "", ResourceAssignedType.multiple, { dbusage: (1048576 * 50) }, true, true, 1),
                    Resources.CreateProduct("Metered Monthly", "prod_JccNQXT636UNhG", "price_1IzNEZC2vUMc6gvhAWQbEBHm", "", ResourceAssignedType.metered, { dbusage: (1048576 * 50) }, true, true, 0),
                ], true, true, 1, parent);
            await Resources.CreateResource("Workspaces", ResourceTargetType.workspace, ResourceVariantType.single, {},
                [
                    Resources.CreateProduct("Basic tier", "prod_ReVF12d55IgEfP", "price_1QlCFIC2vUMc6gvhGBxdjMxp", "workspace_basic_monthly", ResourceAssignedType.single, {}, true, false, 1),
                    Resources.CreateProduct("Enterprise tier", "prod_RfB0sjDxjN0yCo", "price_1QlqeJC2vUMc6gvhvBWhaQUA", "workspace_ee_monthly", ResourceAssignedType.single, {}, true, true, 1),
                ], true, false, 1, parent);
        }
        const usages = await Config.db.query<ResourceUsage>({ collectionname: "config", query: { _type: "resourceusage" }, jwt: Crypt.rootToken() }, parent);
        for (let i = 0; i < usages.length; i++) {
            const usage = usages[i];
            if (usage.product != null && usage.product.assign == null) {
                const p: any = usage.product;
                if (p.agentassign != null) {
                    p.assign = p.agentassign;
                } else if (p.workspaceassign != null) {
                    p.assign = p.workspaceassign;
                } else if (p.memberassign != null) {
                    p.assign = p.memberassign;
                } else if (p.userassign != null) {
                    p.assign = p.userassign;
                } else if (p.customerassign != null) {
                    p.assign = p.customerassign;
                }
                delete p.agentassign;
                delete p.workspaceassign;
                delete p.memberassign;
                delete p.userassign;
                delete p.customerassign;
                await Config.db.InsertOrUpdateOne(usage, "config", "_id", 1, true, Crypt.rootToken(), parent);
            }
        }
    }
    public static async CreateResourceUsage(tuser: User, jwt: string,
        target: User | Customer | Member | Workspace | iAgent,
        billingid: string,
        workspaceid: string | null,
        resourceid: string,
        productname: string,
        allowreplace: boolean,
        parent: Span): Promise<{ result: ResourceUsage[], link: string }> {
        if (allowreplace !== true) allowreplace = false;
        if (target == null) throw new Error("Target is required");
        if (billingid == null || billingid == "") throw new Error(Logger.enricherror(tuser, target, "Billing is required"));
        let billing = await Config.db.GetOne<Billing>({ collectionname: "users", query: { _id: billingid, _type: "customer" }, jwt }, parent);
        if (billing == null) throw new Error(Logger.enricherror(tuser, billing, "Billing not found"));
        if (resourceid == null || resourceid == "") throw new Error(Logger.enricherror(tuser, target, "Resourceid is required"));
        let resource = await Config.db.GetOne<Resource>({ collectionname: "config", query: { _id: resourceid, _type: "resource" }, jwt }, parent);
        if (resource == null) throw new Error(Logger.enricherror(tuser, target, "Resource not found or access denied"));
        if (productname == null || productname == "") throw new Error(Logger.enricherror(tuser, target, "Product is required"));
        let product = resource.products.find(x => x.name == productname);
        if (product == null) throw new Error(Logger.enricherror(tuser, target, "Product is required"));
        if (product.stripeprice == null || product.stripeprice == "") throw new Error(Logger.enricherror(tuser, target, "Product stripeprice is required"));



        let remove_usage: ResourceUsage = null;
        const stripecustomer: stripe_customer = await Payments.GetCustomer(tuser, billing.stripeid, parent);
        const stripesubscription: stripe_subscription = await Payments.GetSubscription(tuser, stripecustomer?.id, billing.subid, parent);
        let stripeprice: stripe_price = null;
        const rootjwt = Crypt.rootToken();
        if (Config.stripe_api_secret != null && Config.stripe_api_secret != "") {
            if (stripecustomer == null) throw new Error(Logger.enricherror(tuser, target, "Stripe customer associated with billing not found"));
            await Payments.CleanupPendingUsage(billingid, parent);
            if (stripesubscription != null && (stripesubscription as any).status != "active") {
                throw new Error(Logger.enricherror(tuser, target, "Stripe subscription " + billing.subid + " is not active"));
            }
            stripeprice = await Payments.GetPrice(tuser, product.lookup_key, product.stripeprice, parent);
            if (stripeprice == null) throw new Error(Logger.enricherror(tuser, target, "Stripe price " + product.stripeprice + " not found"));
            if (stripeprice.active == false) throw new Error(Logger.enricherror(tuser, target, "Stripe price " + product.stripeprice + " is not active"));
            product.stripeproduct = stripeprice.product; // save product id, when using lookup_key
            product.stripeprice = stripeprice.id; // save price id, when using lookup_key
        }
        let result: ResourceUsage[] = [];
        let model: ResourceUsage;
        if (tuser._id != Wellknown.root._id) {
            if (resource.allowdirectassign == false) throw new Error(Logger.enricherror(tuser, target, "Resource does not allow direct assign"));
            if (product.allowdirectassign == false) throw new Error(Logger.enricherror(tuser, target, "Product does not allow direct assign"));
        }
        if (resource.target != target._type) throw new Error(Logger.enricherror(tuser, target, "Resource is " + resource.target + " and cannot be assigned to a " + target._type));
        if (target._type == "user") {
            let resources = await Config.db.query<ResourceUsage>({ collectionname: "config", query: { userid: target._id, "customerid": billing._id, "product.stripeprice": product.stripeprice, _type: "resourceusage" }, jwt }, parent);
            if (resources.length > 1) throw new Error(Logger.enricherror(tuser, target, "User has more than one version of this resource assigned"));
            if (resources.length == 1) model = resources[0];
            if (resource.assign == "singlevariant") {
                let resources2 = await Config.db.query<ResourceUsage>({ collectionname: "config", query: { userid: target._id, "customerid": billing._id, "resourceid": resource._id, _type: "resourceusage" }, jwt }, parent);
                if (resources2.length > 1) throw new Error(Logger.enricherror(tuser, target, "User has more than one version of this resource assigned"));
                if (resource != null && resources2.length == 1) {
                    if (resources2[0].product.stripeprice != product.stripeprice) throw new Error(Logger.enricherror(tuser, target, "User already has " + resources2[0].product.name + " assigned"));
                }
            }
            if (resource.deprecated == true) {
                if (resources.length == 0) throw new Error(Logger.enricherror(tuser, target, "User cannot have deprecated resource assigned"));
            }
        } else if (target._type == "member") {
            let resources = await Config.db.query<ResourceUsage>({ collectionname: "config", query: { memberid: target._id, "customerid": billing._id, "product.stripeprice": product.stripeprice, _type: "resourceusage" }, jwt }, parent);
            if (resources.length > 1) throw new Error(Logger.enricherror(tuser, target, "Member has more than one version of this resource assigned"));
            if (resources.length == 1) model = resources[0];
            if (resource.assign == "singlevariant") {
                let resources2 = await Config.db.query<ResourceUsage>({ collectionname: "config", query: { memberid: target._id, "customerid": billing._id, "resourceid": resource._id, _type: "resourceusage" }, jwt }, parent);
                if (resources2.length > 1) throw new Error(Logger.enricherror(tuser, target, "Member has more than one version of this resource assigned"));
                if (resource != null && resources2.length == 1) {
                    if (resources2[0].product.stripeprice != product.stripeprice) throw new Error(Logger.enricherror(tuser, target, "Member already has " + resources2[0].product.name + " assigned"));
                }
            }
            if (resource.deprecated == true) {
                if (resources.length == 0) throw new Error(Logger.enricherror(tuser, target, "Member cannot have deprecated resource assigned"));
            }
        } else if (target._type == "customer") {
            let resources = await Config.db.query<ResourceUsage>({ collectionname: "config", query: { customerid: target._id, "product.stripeprice": product.stripeprice, _type: "resourceusage" }, jwt }, parent);
            if (resources.length > 1) throw new Error(Logger.enricherror(tuser, target, "Customer has more than one version of this resource assigned"));
            if (resources.length == 1) model = resources[0];
            if (resource.assign == "singlevariant") {
                let resources2 = await Config.db.query<ResourceUsage>({ collectionname: "config", query: { customerid: target._id, "resourceid": resource._id, _type: "resourceusage" }, jwt }, parent);
                if (resources2.length > 1) throw new Error(Logger.enricherror(tuser, target, "Customer has more than one version of this resource assigned"));
                if (resource != null && resources2.length == 1) {
                    if (resources2[0].product.stripeprice != product.stripeprice) throw new Error(Logger.enricherror(tuser, target, "Customer already has " + resources2[0].product.name + " assigned"));
                }
            }
            if (resource.deprecated == true) {
                if (resources.length == 0) throw new Error(Logger.enricherror(tuser, target, "Customer cannot have deprecated resource assigned"));
            }
        } else if (target._type == "workspace") {
            let resources = await Config.db.query<ResourceUsage>({ collectionname: "config", query: { workspaceid: target._id, "product.stripeprice": product.stripeprice, _type: "resourceusage" }, jwt }, parent);
            if (resources.length > 1) throw new Error(Logger.enricherror(tuser, target, "Workspace has more than one version of this resource assigned"));
            if (resources.length == 1) model = resources[0];
            if (resource.assign == "singlevariant") {
                let resources2 = await Config.db.query<ResourceUsage>({ collectionname: "config", query: { workspaceid: target._id, "resourceid": resource._id, _type: "resourceusage" }, jwt }, parent);
                if (resources2.length > 1) throw new Error(Logger.enricherror(tuser, target, "Workspace has more than one version of this resource assigned"));
                if (resource != null && resources2.length == 1) {
                    if (resources2[0].product.stripeprice != product.stripeprice) throw new Error(Logger.enricherror(tuser, target, "Workspace already has " + resources2[0].product.name + " assigned"));
                }
            }
            if (resource.deprecated == true) {
                if (resources.length == 0) throw new Error(Logger.enricherror(tuser, target, "Workspace cannot have deprecated resource assigned"));
            }
        } else if (target._type == "agent") {
            let resources = await Config.db.query<ResourceUsage>({ collectionname: "config", query: { agentid: target._id, "product.stripeprice": product.stripeprice, _type: "resourceusage" }, jwt }, parent);
            if (resources.length > 1) throw new Error(Logger.enricherror(tuser, target, "Agent has more than one version of this resource assigned"));
            if (resources.length == 1) model = resources[0];
            if (resource.assign == "singlevariant") {
                let resources2 = await Config.db.query<ResourceUsage>({ collectionname: "config", query: { agentid: target._id, "resourceid": resource._id, _type: "resourceusage" }, jwt }, parent);
                if (resources2.length > 1) throw new Error(Logger.enricherror(tuser, target, "Agent has more than one version of this resource assigned"));
                if (resource != null && resources2.length == 1) {
                    if (resources2[0].product.stripeprice != product.stripeprice) {
                        if (allowreplace === false) throw new Error(Logger.enricherror(tuser, target, "Agent already has " + resources2[0].product.name + " assigned"));
                        remove_usage = resources2[0];
                    }
                }
            }
            if (resource.deprecated == true) {
                if (resources.length == 0) throw new Error(Logger.enricherror(tuser, target, "Agent cannot have deprecated resource assigned"));
            }
        } else {
            throw new Error(Logger.enricherror(tuser, target, "Target " + target._type + " is not supported"));
        }
        if (model == null) {
            if (resource.deprecated == true) throw new Error(Logger.enricherror(tuser, target, "Resource is deprecated and cannot be assigned")); // should never happen ?
            if (product.deprecated == true) throw new Error(Logger.enricherror(tuser, target, "Product is deprecated and cannot be assigned")); // should never happen ?
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
        // match price with subscription item, incase something was delete in our database and we are re-adding it
        if (stripesubscription != null) {
            model.subid = stripesubscription.id;
            for (let i = 0; i < stripesubscription.items.data.length; i++) {
                let item = stripesubscription.items.data[i];
                if (item.price.id == product.stripeprice) {
                    model.siid = item.id;
                    break;
                }
            }
        }
        Base.addRight(model, billing._id, billing.name + " billing admins", [Rights.read]);
        if (workspaceid != null && workspaceid != "") {
            let workspace = await Config.db.GetOne<Workspace>({ collectionname: "users", query: { _id: workspaceid, _type: "workspace" }, jwt }, parent);
            if (workspace == null) throw new Error(Logger.enricherror(tuser, target, "Workspace not found or access denied"));
            model.workspaceid = workspace._id;
            Base.addRight(model, workspace.admins, workspace.name + " admins", [Rights.read]);
        }

        if (target._type == "user") {
            Base.addRight(model, target._id, target.name, [Rights.read]);
            model.userid = target._id;
            if (product.assign == "single" || product.assign == "metered") {
                if (model.quantity > 1) throw new Error(Logger.enricherror(tuser, target, "User can only have " + product.name + " assigned once"));
            }
        } else if (target._type == "member") {
            model.memberid = target._id;
            model.userid = (target as Member).userid;
            Base.addRight(model, (target as Member).userid, target.name, [Rights.read]);
            Base.addRight(model, billing._id, billing.name + " billing admins", [Rights.read]);
            if (product.assign == "single" || product.assign == "metered") {
                if (model.quantity > 1) throw new Error(Logger.enricherror(tuser, target, "Member can only have " + product.name + " assigned once"));
            }
        } else if (target._type == "customer") {
            model.customerid = target._id;
            Base.addRight(model, (target as Customer).admins, target.name + " admins", [Rights.read]);
            Base.addRight(model, (target as Customer).users, target.name + " users", [Rights.read]);
            if (product.assign == "single" || product.assign == "metered") {
                if (model.quantity > 1) throw new Error(Logger.enricherror(tuser, target, "Customer can only have " + product.name + " assigned once"));
            }
        } else if (target._type == "workspace") {
            model.workspaceid = target._id;
            Base.addRight(model, (target as Workspace).admins, target.name + " admins", [Rights.read]);
            Base.addRight(model, (target as Workspace).users, target.name + " users", [Rights.read]);
            if (product.assign == "single" || product.assign == "metered") {
                if (model.quantity > 1) throw new Error(Logger.enricherror(tuser, target, "Workspace can only have " + product.name + " assigned once"));
            }
        } else if (target._type == "agent") {
            model.agentid = target._id;
            if (product.assign == "single" || product.assign == "metered") {
                // if (model.quantity > 1) throw new Error(Logger.enricherror(tuser, target, "Agent can only have " + product.name + " assigned once"));
                if (model.quantity > 1) {
                    // assume something went wrong, and just re-assign it
                    model.quantity = 1;
                }
            }
        }
        let resourceusage: ResourceUsage;
        if (model._id == null || model._id == "") {
            resourceusage = await Config.db.InsertOne(model, "config", 1, true, rootjwt, parent);
            result.push(resourceusage);
        } else {
            resourceusage = await Config.db.UpdateOne(model, "config", 1, true, rootjwt, parent)
            result.push(resourceusage);
        }
        let link = "";
        if (Config.stripe_api_secret != null && Config.stripe_api_secret != "") {
            if (stripesubscription == null) {
                // const paymentmethods = await Payments.GetPaymentMethods(tuser, stripecustomer.id, parent);
                // if(paymentmethods == null || paymentmethods.length == 0) {               
                //     const checkout = await Payments.CreateCheckoutSession(tuser, billingid, stripecustomer.id, result, parent);
                //     link = checkout.url;
                //     return { result, link };
                // } else {
                //     await Payments.CreateSubscription(tuser, stripecustomer.id, result, parent);
                // }
                if ((stripecustomer as any)?.invoice_settings?.default_payment_method == null) {
                    const checkout = await Payments.CreateCheckoutSession(tuser, billingid, stripecustomer.id, result, parent);
                    link = checkout.url;
                    return { result, link };
                } else {
                    await Payments.CreateSubscription(tuser, stripecustomer.id, result, parent);
                }
            } else {
                // await Payments.UpdateSubscriptionLines(tuser, stripecustomer.id, stripesubscription.id, result, parent);
                // if (remove_usage != null) {
                //     await Payments.RemoveSubscriptionLine(tuser, stripecustomer.id, stripesubscription.id, remove_usage.siid, parent);
                //     await Config.db.DeleteOne(remove_usage._id, "config", false, rootjwt, parent);
                // }
                if (remove_usage != null) {
                    remove_usage.quantity--;
                    if (remove_usage.quantity == 0) {
                        await Config.db.DeleteOne(remove_usage._id, "config", false, rootjwt, parent);
                    } else {
                        await Config.db.UpdateOne(remove_usage, "config", 1, true, rootjwt, parent);
                    }
                }
                await Payments.SyncBillingAccount(tuser, jwt, billingid, parent);
            }
        }
        if (target._type == "workspace") {
            (target as Workspace)._billingid = billing._id;
            (target as Workspace)._resourceusageid = resourceusage._id;
            (target as Workspace)._productname = product.name;
            await Config.db.UpdateOne(target, "users", 1, true, rootjwt, parent);
        } else if (target._type == "agent") {
            (target as iAgent).stripeprice = product.stripeprice;
            (target as iAgent)._billingid = billing._id;
            (target as iAgent)._resourceusageid = resourceusage._id;
            (target as iAgent)._productname = product.name;
            await Config.db.UpdateOne(target, "agents", 1, true, rootjwt, parent);
        }
        return { result, link };
    }
    public static async RemoveResourceUsage(tuser: User, jwt: string,
        resourceusageid: string, parent: Span): Promise<ResourceUsage> {
        if (resourceusageid == null || resourceusageid == "") throw new Error("ResourceUsageid is required");
        const rootjwt = Crypt.rootToken();
        let resourceusage = await Config.db.GetOne<ResourceUsage>({ collectionname: "config", query: { _id: resourceusageid, _type: "resourceusage" }, jwt }, parent);
        if (resourceusage == null) throw new Error(Logger.enricherror(tuser, null, "ResourceUsage not found or access denied"));

        let target: User | Customer | Member | Workspace | iAgent;
        if (!Util.IsNullEmpty(resourceusage.memberid)) {
            target = await Config.db.GetOne<Member>({ collectionname: "users", query: { _id: resourceusage.memberid, _type: "member" }, jwt }, parent);
        } else if (!Util.IsNullEmpty(resourceusage.agentid)) {
            target = await Config.db.GetOne<iAgent>({ collectionname: "agents", query: { _id: resourceusage.agentid, _type: "agent" }, jwt }, parent);
        } else if (!Util.IsNullEmpty(resourceusage.userid)) {
            target = await Config.db.GetOne<User>({ collectionname: "users", query: { _id: resourceusage.userid, _type: "user" }, jwt }, parent);
        } else if (!Util.IsNullEmpty(resourceusage.workspaceid)) {
            target = await Config.db.GetOne<Workspace>({ collectionname: "users", query: { _id: resourceusage.workspaceid, _type: "workspace" }, jwt }, parent);
        } else if (!Util.IsNullEmpty(resourceusage.customerid)) {
            target = await Config.db.GetOne<iAgent>({ collectionname: "users", query: { _id: resourceusage.customerid, _type: "customer" }, jwt }, parent);
        }
        if (target == null) throw new Error("Target is required");

        if (resourceusage.quantity > 0) resourceusage.quantity -= 1;
        let resource = await Config.db.GetOne<Resource>({ collectionname: "config", query: { _id: resourceusage.resourceid, _type: "resource" }, jwt }, parent);
        if (resource == null) throw new Error(Logger.enricherror(tuser, target, "Resource not found or access denied"));

        if (target._type == "user") {
            if (resource.target != target._type) throw new Error(Logger.enricherror(tuser, target, "Resource is " + resource.target + " and cannot be assigned to a " + target._type));
            if (resourceusage.userid != target._id) throw new Error(Logger.enricherror(tuser, target, "ResourceUsage is not assigned to this user"));
        } else if (target._type == "member") {
            if (resource.target != target._type) throw new Error(Logger.enricherror(tuser, target, "Resource is " + resource.target + " and cannot be assigned to a " + target._type));
            if (resourceusage.memberid != target._id) throw new Error(Logger.enricherror(tuser, target, "ResourceUsage is not assigned to this member"));
        } else if (target._type == "customer") {
            if (resource.target != target._type) throw new Error(Logger.enricherror(tuser, target, "Resource is " + resource.target + " and cannot be assigned to a " + target._type));
            if (resourceusage.customerid != target._id) throw new Error(Logger.enricherror(tuser, target, "ResourceUsage is not assigned to this customer"));
        } else if (target._type == "workspace") {
            if (resource.target != target._type) throw new Error(Logger.enricherror(tuser, target, "Resource is " + resource.target + " and cannot be assigned to a " + target._type));
            if (resourceusage.workspaceid != target._id) throw new Error(Logger.enricherror(tuser, target, "ResourceUsage is not assigned to this workspace"));
            (target as Workspace)._resourceusageid = null;
            (target as Workspace)._productname = "Free tier";
            await Config.db.UpdateOne(target, "users", 1, true, rootjwt, parent);
        } else if (target._type == "agent") {
            if (resource.target != target._type) throw new Error(Logger.enricherror(tuser, target, "Resource is " + resource.target + " and cannot be assigned to a " + target._type));
            if (resourceusage.agentid != target._id) throw new Error(Logger.enricherror(tuser, target, "ResourceUsage is not assigned to this agent"));
            (target as iAgent).stripeprice = undefined;
            (target as iAgent)._billingid = undefined;
            (target as iAgent)._resourceusageid = undefined;
            (target as iAgent)._productname = "Free tier";
            await Config.db.UpdateOne(target, "agents", 1, true, rootjwt, parent);
        } else {
            throw new Error(Logger.enricherror(tuser, target, "Target " + target._type + " is not supported"));
        }

        // if (!Util.IsNullEmpty(resourceusage.siid)) {
        //     const billing = await Config.db.GetOne<Billing>({ collectionname: "users", query: { _id: resourceusage.customerid, _type: "customer" }, jwt }, parent);
        //     await Payments.RemoveSubscriptionLine(tuser, billing.stripeid, resourceusage.subid, resourceusage.siid, parent);
        // }
        if (resourceusage.quantity < 1) {
            await Config.db.DeleteOne(resourceusage._id, "config", false, rootjwt, parent);
        } else {
            resourceusage = await Config.db.UpdateOne(resourceusage, "config", 1, true, rootjwt, parent);
        }
        if (!Util.IsNullEmpty(resourceusage.siid)) {
            await Payments.SyncBillingAccount(tuser, jwt, resourceusage.customerid, parent);
        }
        return resourceusage;
    }
    public static async GetUserResources(userid: string, parent: Span) {
        const jwt = Crypt.rootToken();
        const result = Config.db.query<ResourceUsage>({ collectionname: "config", query: { userid, _type: "resourceusage", quantity: { "$gt": 0 } }, jwt }, parent);
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
        await Payments.CleanupPendingUsage(customerid, parent);
        const jwt = Crypt.rootToken();
        const result = Config.db.query<ResourceUsage>({ collectionname: "config", query: { customerid, _type: "resourceusage", quantity: { "$gt": 0 } }, jwt }, parent);
        return result;
    }
    public static async GetCustomerResourcesCount(customerid: string, parent: Span) {
        await Payments.CleanupPendingUsage(customerid, parent);
        const jwt = Crypt.rootToken();
        const result = await Config.db.count({ collectionname: "config", query: { customerid, _type: "resourceusage", quantity: { "$gt": 0 } }, jwt }, parent);
        return result;
    }
    public static async GetWorkspaceResources(workspaceid: string, parent: Span) {
        const workspace = await Config.db.GetOne<Workspace>({ collectionname: "users", query: { _id: workspaceid, _type: "workspace" }, jwt: Crypt.rootToken() }, parent);
        if (workspace == null) return [];
        return this.GetWorkspaceResources2(workspace._billingid, workspaceid, parent);
    }
    public static async GetWorkspaceResources2(billingid: string, workspaceid: string, parent: Span) {
        await Payments.CleanupPendingUsage(billingid, parent);
        const jwt = Crypt.rootToken();
        let query = { workspaceid, _type: "resourceusage", quantity: { "$gt": 0 } };
        const result = Config.db.query<ResourceUsage>({ collectionname: "config", query, jwt }, parent);
        return result;
    }
    public static async GetWorkspaceResourcesCount(workspaceid: string, parent: Span) {
        const workspace = await Config.db.GetOne<Workspace>({ collectionname: "users", query: { _id: workspaceid, _type: "workspace" }, jwt: Crypt.rootToken() }, parent);
        if (workspace == null) return 0;
        return this.GetWorkspaceResourcesCount2(workspace._billingid, workspaceid, parent);
    }
    public static async GetWorkspaceResourcesCount2(billingid: string, workspaceid: string, parent: Span) {
        await Payments.CleanupPendingUsage(billingid, parent);
        const jwt = Crypt.rootToken();
        let query = { workspaceid, _type: "resourceusage", quantity: { "$gt": 0 } };
        const result = await Config.db.count({ collectionname: "config", query, jwt }, parent);
        return result;
    }
    public static async GetAgentResourcesCount(agentid: string, parent: Span) {
        const jwt = Crypt.rootToken();
        const result = await Config.db.count({ collectionname: "config", query: { agentid, _type: "resourceusage", quantity: { "$gt": 0 } }, jwt }, parent);
        return result;
    }
    public static async GetAgentResources(agentid: string, parent: Span) {
        const jwt = Crypt.rootToken();
        const result = await Config.db.query<ResourceUsage>({ collectionname: "config", query: { agentid, _type: "resourceusage", quantity: { "$gt": 0 } }, jwt }, parent);
        return result;
    }
    public static async RemoveCustomerResources(customerid: string, parent: Span) {
        const jwt = Crypt.rootToken();
        const result = await Config.db.DeleteMany({ customerid, _type: "resourceusage" }, null, "config", null, false, jwt, parent);
        return result;
    }
    public static async GetMemberResources(memberid: string, parent: Span) {
        const jwt = Crypt.rootToken();
        const result = Config.db.query<ResourceUsage>({ collectionname: "config", query: { memberid, _type: "resourceusage", quantity: { "$gt": 0 } }, jwt }, parent);
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

    public async GetResource(resourcename: string, parent: Span): Promise<Resource> {
        let _resources: Resource[] = await Logger.DBHelper.GetResources(parent);
        _resources = _resources.filter(x => x.name == resourcename);
        if (_resources.length == 0) return null;
        return _resources[0]
    }
    public async GetResourceUserUsage(resourcename: string, userid: string, parent: Span): Promise<ResourceUsage> {
        let assigned: ResourceUsage[] = await Logger.DBHelper.GetResourceUsageByUserID(userid, parent);
        assigned = assigned.filter(x => x.resource == resourcename);
        if (assigned.length == 0) return null; // No found
        if (assigned[0].siid == null || assigned[0].siid == "") return null;  // Not completed payment
        if (assigned[0].quantity == 0) return null; // No longer assigned
        return assigned[0]
    }
    public async GetResourceCustomerUsage(resourcename: string, customerid: string, parent: Span): Promise<ResourceUsage[]> {
        let assigned: ResourceUsage[] = await Logger.DBHelper.GetResourceUsageByCustomerID(customerid, parent);
        assigned = assigned.filter(x => x.resource == resourcename);
        if (Config.stripe_api_secret != null && Config.stripe_api_secret != "") {
            assigned = assigned.filter(x => x.siid != null && x.siid != ""); // Not completed payment
        }
        assigned = assigned.filter(x => x.quantity > 0);
        if (assigned.length == 0) return null; // No found
        return assigned;
    }
    public async GetProductResourceCustomerUsage(resourcename: string, stripeprice: string, customerid: string, parent: Span): Promise<ResourceUsage> {
        let assigned: ResourceUsage[] = await Logger.DBHelper.GetResourceUsageByCustomerID(customerid, parent);
        assigned = assigned.filter(x => x.resource == resourcename && x.product.stripeprice == stripeprice);
        if (assigned.length == 0) return null; // No found
        if (assigned[0].siid == null || assigned[0].siid == "") return null;  // Not completed payment
        if (assigned[0].quantity == 0) return null; // No longer assigned
        return assigned[0]
    }
}