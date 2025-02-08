import { Rights } from "@openiap/nodeapi";
import { stripe_customer, stripe_list, stripe_price, stripe_subscription } from "@openiap/openflow-api";
import { Span } from "@opentelemetry/api";
import { Base, Billing, Customer, iAgent, License, Member, Product, Resource, ResourceAssignedType, ResourceTargetType, ResourceUsage, ResourceVariantType, User, Workspace } from '../commoninterfaces.js';
import { Config } from "../Config.js";
import { Crypt } from "../Crypt.js";
import { Logger } from "../Logger.js";
import { Util, Wellknown } from "../Util.js";
import { Payments } from "./Payments.js";
import { Message } from "../Messages/Message.js";

export class Resources {
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
                    Resources.CreateProduct("Basic (256Mi ram)", false, "prod_ReVjqIUfPNOX0W", "price_1QlCiKC2vUMc6gvhz97QpaAD", "agent_basic_monthly", ResourceAssignedType.single, { "resources": { "requests": { "memory": "256Mi", "cpu": "500m" } }, "nodeSelector": { "cloud.google.com/gke-nodepool": "agent-pool" } }, true, false, 0),
                    Resources.CreateProduct("Basic (256Mi ram) old", false, "prod_HEC6rB2wRUwviG", "plan_HECATxbGlff4Pv", "", ResourceAssignedType.single, { "resources": { "requests": { "memory": "256Mi", "cpu": "500m" } }, "nodeSelector": { "cloud.google.com/gke-nodepool": "agent-pool" } }, true, true, 1),
                    Resources.CreateProduct("Plus (512Mi ram)", false, "prod_HEDSUIZLD7rfgh", "plan_HEDSUl6qdOE4ru", "agent_plus_monthly", ResourceAssignedType.single, { "resources": { "requests": { "memory": "512Mi", "cpu": "500m" } }, "nodeSelector": { "cloud.google.com/gke-nodepool": "agent-pool" } }, true, false, 2),
                    Resources.CreateProduct("Premium (1Gi ram)", false, "prod_HEDTI7YBbwEzVX", "plan_HEDTJQBGaVGnvl", "agent_premium_monthly", ResourceAssignedType.single, { "resources": { "requests": { "memory": "1Gi", "cpu": "900m" } }, "nodeSelector": { "cloud.google.com/gke-nodepool": "agent-pool" } }, true, false, 3),
                    Resources.CreateProduct("Advanced (2Gi ram)", false, "prod_IERLqCwV7BV8zy", "price_1HdySLC2vUMc6gvh3H1pgG7A", "agent_advanced_monthly", ResourceAssignedType.single, { "resources": { "requests": { "memory": "2Gi", "cpu": "900m" } }, "nodeSelector": { "cloud.google.com/gke-nodepool": "agent-pool" } }, true, false, 4),
                ], true, false, 0, parent);
            await Resources.CreateResource("Database Usage", ResourceTargetType.customer, ResourceVariantType.single, { dbusage: (1048576 * 25) },
                [
                    Resources.CreateProduct("50Mb quota", false, "prod_JccNQXT636UNhG", "price_1IzQBRC2vUMc6gvh3Er9QaO8", "", ResourceAssignedType.multiple, { dbusage: (1048576 * 50) }, true, true, 1),
                    Resources.CreateProduct("Metered Monthly", false, "prod_JccNQXT636UNhG", "price_1IzNEZC2vUMc6gvhAWQbEBHm", "", ResourceAssignedType.metered, { dbusage: (1048576 * 50) }, true, true, 0),
                ], true, true, 1, parent);

            await Resources.CreateResource("Support Agreement", ResourceTargetType.customer, ResourceVariantType.single, {},
                [
                    Resources.CreateProduct("Basic Support", false, "prod_HEGjSQ9M6wiYiP", "plan_HEGjLCtwsVbIx8", "", ResourceAssignedType.single, {}, true, true, 0),
                ], true, false, 2, parent);

            await Resources.CreateResource("Support Hours", ResourceTargetType.customer, ResourceVariantType.multiple, {},
                [
                    Resources.CreateProduct("Premium Hours", false, "prod_HEZnir2GdKX5Jm", "plan_HEZp4Q4In2XcXe", "supporthours_premium_monthly", ResourceAssignedType.metered, { "supportplan": true }, true, false, 1),
                    Resources.CreateProduct("Basic Hours", false, "prod_HEGjSQ9M6wiYiP", "plan_HEZAsA1DfkiQ6k", "supporthours_basic_monthly", ResourceAssignedType.metered, { "supportplan": true }, true, false, 2),
                    Resources.CreateProduct("Old Basic Hours", false, "prod_HEGjSQ9M6wiYiP", "plan_HEZAsA1DfkiQ6k", "", ResourceAssignedType.metered, { "supportplan": true }, true, true, 3),
                ], true, false, 3, parent);
            await Resources.CreateResource("OpenCore License", ResourceTargetType.license, ResourceVariantType.single, {connections: 1, workspaces: 1, gitrepos: 1},
                [
                    Resources.CreateProduct("Premium License", false, "prod_JcXS2AvXfwk1Lv", "price_1Qgw6DC2vUMc6gvhHuoezYIH", "", ResourceAssignedType.single, {connections: 5, workspaces: 5, gitrepos: 5}, true, false, 1),
                    Resources.CreateProduct("Premium License Legacy", false, "prod_JcXS2AvXfwk1Lv", "price_1IzISoC2vUMc6gvhMtqTq2Ef", "", ResourceAssignedType.single, {connections: 5, workspaces: 5, gitrepos: 5}, true, false, 1),
                    Resources.CreateProduct("Additional connections", true, "prod_RjJVZh1cT6szd8", "price_1QpqsWC2vUMc6gvhvO0GdT09", "opencore_connections_monthly", ResourceAssignedType.multiple, {connections: 1}, true, false, 1),
                    Resources.CreateProduct("Additional workspaces", true, "prod_RjJVZh1cT6szd8", "price_1QpqsWC2vUMc6gvhvO0GdT09", "opencore_workspaces_monthly", ResourceAssignedType.multiple, {workspaces: 1}, true, false, 1),
                    Resources.CreateProduct("Additional getrepos", true, "prod_Rjq7THiRHBkpL4", "price_1QqMRCC2vUMc6gvhByzBizDv", "opencore_gitrepos_monthly", ResourceAssignedType.multiple, {gitrepos: 1}, true, false, 1),
                ], true, false, 4, parent);
            await Resources.CreateResource("Workspaces", ResourceTargetType.workspace, ResourceVariantType.single, {members: 3},
                [
                    Resources.CreateProduct("Basic tier", false, "prod_ReVF12d55IgEfP", "price_1QlCFIC2vUMc6gvhGBxdjMxp", "workspace_basic_monthly", ResourceAssignedType.single, {members: 25}, true, false, 1),
                    Resources.CreateProduct("Enterprise tier", false, "prod_RfB0sjDxjN0yCo", "price_1QlqeJC2vUMc6gvhvBWhaQUA", "workspace_ee_monthly", ResourceAssignedType.single, {members: 5000}, true, false, 1),
                ], true, false, 5, parent);

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
                    Resources.CreateProduct("Basic (256Mi ram)", false, "prod_RG5CJC2X3xuVil", "price_1QNZ1mC2vUMc6gvhWxYwPvsN", "agent_basic_monthly", ResourceAssignedType.single, { "resources": { "requests": { "memory": "256Mi", "cpu": "500m" } }, "nodeSelector": { "cloud.google.com/gke-nodepool": "agent-pool" } }, true, false, 1),
                    Resources.CreateProduct("Basic (256Mi ram) - Legacy", false, "prod_Jfg1JU7byqHYs9", "price_1J2KglC2vUMc6gvh3JGredpM", "", ResourceAssignedType.single, { "resources": { "requests": { "memory": "256Mi", "cpu": "500m" } }, "nodeSelector": { "cloud.google.com/gke-nodepool": "agent-pool" } }, true, true, 2),
                    Resources.CreateProduct("Plus (512Mi ram)", false, "prod_Jfg1JU7byqHYs9", "price_1J2KhPC2vUMc6gvhIwTNUWAk", "agent_plus_monthly", ResourceAssignedType.single, { "resources": { "requests": { "memory": "512Mi", "cpu": "500m" } }, "nodeSelector": { "cloud.google.com/gke-nodepool": "agent-pool" } }, true, false, 3),
                    Resources.CreateProduct("Premium (1Gi ram)", false, "prod_Jfg1JU7byqHYs9", "price_1J2KhuC2vUMc6gvhRcs1mdUr", "agent_premium_monthly", ResourceAssignedType.single, { "resources": { "requests": { "memory": "1Gi", "cpu": "900m" } }, "nodeSelector": { "cloud.google.com/gke-nodepool": "agent-pool" } }, true, false, 4),
                    Resources.CreateProduct("Advanced (2Gi ram)", false, "prod_Jfg1JU7byqHYs9", "price_1J2KiFC2vUMc6gvhGy0scDB5", "agent_advanced_monthly", ResourceAssignedType.single, { "resources": { "requests": { "memory": "2Gi", "cpu": "900m" } }, "nodeSelector": { "cloud.google.com/gke-nodepool": "agent-pool" } }, true, false, 5),
                ], true, false, 0, parent);
            await Resources.CreateResource("Database Usage", ResourceTargetType.customer, ResourceVariantType.single, { dbusage: (1048576 * 25) },
                [
                    Resources.CreateProduct("50Mb quota", false, "prod_JffpwKLldz2QWN", "price_1J2KWFC2vUMc6gvheg4kFzjI", "", ResourceAssignedType.multiple, { dbusage: (1048576 * 50) }, true, true, 1),
                    Resources.CreateProduct("Metered Monthly", false, "prod_JffpwKLldz2QWN", "price_1Jkl6HC2vUMc6gvhXe4asJXW", "", ResourceAssignedType.metered, { dbusage: (1048576 * 50) }, true, true, 2),
                ], true, true, 1, parent);
            await Resources.CreateResource("Support Hours", ResourceTargetType.customer, ResourceVariantType.multiple, {},
                [
                    Resources.CreateProduct("Premium Hours", false, "prod_JccNQXT636UNhG", "plan_HFkbfsAs1Yvcly", "supporthours_premium_monthly", ResourceAssignedType.metered, { "supportplan": true }, false, false, 1),
                    Resources.CreateProduct("Basic Hours", false, "prod_HG1vTqU4c7EaV5", "plan_HG1wBF6yq1O15C", "supporthours_basic_monthly", ResourceAssignedType.metered, { "supportplan": true }, true, false, 2),
                ], false, false, 2, parent);
            await Resources.CreateResource("OpenCore License", ResourceTargetType.license, ResourceVariantType.single, {connections: 1, workspaces: 1, gitrepos: 1},
                [
                    Resources.CreateProduct("Premium License", false, "prod_JcXS2AvXfwk1Lv", "price_1Qgw6DC2vUMc6gvhHuoezYIH", "", ResourceAssignedType.single, {connections: 5, workspaces: 5, gitrepos: 5}, true, false, 1),
                    Resources.CreateProduct("Premium License Legacy", false, "prod_JcXS2AvXfwk1Lv", "price_1IzISoC2vUMc6gvhMtqTq2Ef", "", ResourceAssignedType.single, {connections: 5, workspaces: 5, gitrepos: 5}, true, false, 1),
                    Resources.CreateProduct("Additional connections", true, "prod_RjJVZh1cT6szd8", "price_1QpqsWC2vUMc6gvhvO0GdT09", "opencore_connections_monthly", ResourceAssignedType.multiple, {connections: 1}, true, false, 1),
                    Resources.CreateProduct("Additional workspaces", true, "prod_RjJVZh1cT6szd8", "price_1QpqsWC2vUMc6gvhvO0GdT09", "opencore_workspaces_monthly", ResourceAssignedType.multiple, {workspaces: 1}, true, false, 1),
                    Resources.CreateProduct("Additional getrepos", true, "prod_Rjq7THiRHBkpL4", "price_1QqMRCC2vUMc6gvhByzBizDv", "opencore_gitrepos_monthly", ResourceAssignedType.multiple, {gitrepos: 1}, true, false, 1),
                ], true, false, 3, parent);
            await Resources.CreateResource("Workspaces", ResourceTargetType.workspace, ResourceVariantType.single, {members: 3},
                [
                    Resources.CreateProduct("Basic tier", false, "prod_ReVF12d55IgEfP", "price_1QlCFIC2vUMc6gvhGBxdjMxp", "workspace_basic_monthly", ResourceAssignedType.single, {members: 25}, true, false, 1),
                    Resources.CreateProduct("Enterprise tier", false, "prod_RfB0sjDxjN0yCo", "price_1QlqeJC2vUMc6gvhvBWhaQUA", "workspace_ee_monthly", ResourceAssignedType.single, {members: 5000}, true, false, 2),
                ], true, false, 4, parent);

        } else {
            await Resources.CreateResource("Agent Instance", ResourceTargetType.agent, ResourceVariantType.single, { "runtime_hours": 8, "agentcount": 1, "resources": { "limits": { "memory": "225Mi" } } },
                [
                    Resources.CreateProduct("Basic (256Mi ram)", false, "prod_HEC6rB2wRUwviG", "plan_HECATxbGlff4Pv", "", ResourceAssignedType.single, { "resources": { "limits": { "memory": "256Mi" }, "requests": { "memory": "256Mi" } } }, true, false, 0),
                    Resources.CreateProduct("Plus (512Mi ram)", false, "prod_HEDSUIZLD7rfgh", "plan_HEDSUl6qdOE4ru", "", ResourceAssignedType.single, { "resources": { "limits": { "memory": "512Mi" }, "requests": { "memory": "512Mi" } } }, true, false, 1),
                    Resources.CreateProduct("Premium (1Gi ram)", false, "prod_HEDTI7YBbwEzVX", "plan_HEDTJQBGaVGnvl", "", ResourceAssignedType.single, { "resources": { "limits": { "memory": "1Gi" }, "requests": { "memory": "1Gi" } } }, true, false, 2),
                    Resources.CreateProduct("Premium+ (2Gi ram)", false, "prod_IERLqCwV7BV8zy", "price_1HdySLC2vUMc6gvh3H1pgG7A", "", ResourceAssignedType.single, { "resources": { "limits": { "memory": "2Gi" }, "requests": { "memory": "2Gi" } } }, true, false, 3),
                ], true, false, 0, parent);
            await Resources.CreateResource("Database Usage", ResourceTargetType.customer, ResourceVariantType.single, { dbusage: (1048576 * 25) },
                [
                    Resources.CreateProduct("50Mb quota", false, "prod_JccNQXT636UNhG", "price_1IzQBRC2vUMc6gvh3Er9QaO8", "", ResourceAssignedType.multiple, { dbusage: (1048576 * 50) }, true, true, 1),
                    Resources.CreateProduct("Metered Monthly", false, "prod_JccNQXT636UNhG", "price_1IzNEZC2vUMc6gvhAWQbEBHm", "", ResourceAssignedType.metered, { dbusage: (1048576 * 50) }, true, true, 0),
                ], true, true, 1, parent);
            await Resources.CreateResource("Workspaces", ResourceTargetType.workspace, ResourceVariantType.single, {members: 3},
                [
                    Resources.CreateProduct("Basic tier", false, "prod_ReVF12d55IgEfP", "price_1QlCFIC2vUMc6gvhGBxdjMxp", "workspace_basic_monthly", ResourceAssignedType.single, {members: 25}, true, false, 1),
                    Resources.CreateProduct("Enterprise tier", false, "prod_RfB0sjDxjN0yCo", "price_1QlqeJC2vUMc6gvhvBWhaQUA", "workspace_ee_monthly", ResourceAssignedType.single, {members: 5000}, true, false, 1),
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
        valueadd: boolean,
        stripeproduct: string,
        stripeprice: string,
        lookup_key: string,
        assign: ResourceAssignedType,
        metadata: any,
        allowdirectassign: boolean,
        deprecated: boolean,
        order: number): Product {
        const model: Product = new Product();
        model.valueadd = valueadd;
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
    public static async GetResourceTarget(tuser: User, jwt: string, resourceusage: ResourceUsage, parent: Span): Promise<User | Customer | Member | Workspace | iAgent | License> {
        let target: User | Customer | Member | Workspace | iAgent | License;
        if (!Util.IsNullEmpty(resourceusage.licenseid)) {
            target = await Config.db.GetOne<License>({ collectionname: "config", query: { _id: resourceusage.licenseid, _type: "license" }, jwt }, parent);
        } else if (!Util.IsNullEmpty(resourceusage.memberid)) {
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
        if (target == null) {
            const rootjwt = Crypt.rootToken();
            let _id = "unknown";
            if (!Util.IsNullEmpty(resourceusage.licenseid)) {
                target = await Config.db.GetOne<License>({ collectionname: "config", query: { _id: resourceusage.licenseid, _type: "license" }, jwt: rootjwt }, parent);
                _id = resourceusage.licenseid;
            } else if (!Util.IsNullEmpty(resourceusage.memberid)) {
                target = await Config.db.GetOne<Member>({ collectionname: "users", query: { _id: resourceusage.memberid, _type: "member" }, jwt: rootjwt }, parent);
                _id = resourceusage.memberid;
            } else if (!Util.IsNullEmpty(resourceusage.agentid)) {
                target = await Config.db.GetOne<iAgent>({ collectionname: "agents", query: { _id: resourceusage.agentid, _type: "agent" }, jwt: rootjwt }, parent);
                _id = resourceusage.agentid;
            } else if (!Util.IsNullEmpty(resourceusage.userid)) {
                target = await Config.db.GetOne<User>({ collectionname: "users", query: { _id: resourceusage.userid, _type: "user" }, jwt: rootjwt }, parent);
                _id = resourceusage.userid;
            } else if (!Util.IsNullEmpty(resourceusage.workspaceid)) {
                target = await Config.db.GetOne<Workspace>({ collectionname: "users", query: { _id: resourceusage.workspaceid, _type: "workspace" }, jwt: rootjwt }, parent);
                _id = resourceusage.workspaceid;
            } else if (!Util.IsNullEmpty(resourceusage.customerid)) {
                target = await Config.db.GetOne<iAgent>({ collectionname: "users", query: { _id: resourceusage.customerid, _type: "customer" }, jwt: rootjwt }, parent);
                _id = resourceusage.customerid;
            }
            if (target != null) throw new Error("Access denied to target");
            Logger.instanse.warn(resourceusage._id + " ResourceUsage exists, but target " + _id + " does not, so deleting it", parent, { resourceusageid: resourceusage._id, cls: "Resources", func: "GetResourceTarget" });
            await Config.db.DeleteOne(resourceusage._id, "config", false, rootjwt, parent);
            await Payments.PushBillingAccount(tuser, jwt, resourceusage.customerid, parent);
        }
        return target;
    }
    private static mergeObjects(base, addition) {
        for (const key in addition) {
          if (addition.hasOwnProperty(key)) {
            if (
              typeof addition[key] === "object" &&
              addition[key] !== null &&
              !Array.isArray(addition[key])
            ) {
              // If it's an object, merge recursively
              if (!base[key]) base[key] = {}; // Ensure the base object has the key
              Resources.mergeObjects(base[key], addition[key]);
            } else if (
              typeof addition[key] === "number" &&
              typeof base[key] === "number"
            ) {
              // Add numbers together
              base[key] += addition[key];
            } else {
              // Overwrite everything else
              base[key] = addition[key];
            }
          }
        }
        return base;
      }
    public static async CombineMetadata(tuser: User, jwt: string, resourceusage: ResourceUsage, parent: Span): Promise<any> {
        if(resourceusage == null) throw new Error("ResourceUsage is required");
        const resource = await Config.db.GetOne<Resource>({ collectionname: "config", query: { _id: resourceusage.resourceid, _type: "resource" }, jwt }, parent);
        let metadata = resource.defaultmetadata;
        const target = await Resources.GetResourceTarget(tuser, jwt, resourceusage, parent);
        let query = {};
        if (target._type == "license") {
            query = { licenseid: target._id, _type: "resourceusage", "product.valueadd": true };
        } else if (target._type == "workspace") {
            query = { workspaceid: target._id, _type: "resourceusage", "product.valueadd": true };
        } else if (target._type == "agent") {
            query = { agentid: target._id, _type: "resourceusage", "product.valueadd": true };
        } else if (target._type == "user") {
            query = { userid: target._id, _type: "resourceusage", "product.valueadd": true };
        } else if (target._type == "member") {
            query = { memberid: target._id, _type: "resourceusage", "product.valueadd": true };
        } else if (target._type == "customer") {
            query = { customerid: target._id, _type: "resourceusage", "product.valueadd": true };
        } else {
            throw new Error(Logger.enricherror(tuser, target, "Target type " + target._type + " not supported"));
        }
        const resources = await Config.db.query<ResourceUsage>({ collectionname: "config", query, jwt }, parent);
        for(let i = 0; i < resources.length; i++) {
            const res = resources[i];
            if(res._id == resourceusage._id) continue;
            if(res.quantity > 0) {
                for(let i = 0; i < res.quantity; i++) {
                    metadata = Resources.mergeObjects(metadata, res.product.metadata);
                }
            }                
        }
        return metadata;
    }
    public static async UpdateResourceTarget<T extends User | Customer | Member | Workspace | iAgent | License>(tuser: User, jwt: string, updatedresourceusage: ResourceUsage, target: T, removed: boolean, parent: Span): Promise<T> {
        if (target == null) throw new Error("Target is required");
        if (updatedresourceusage == null) throw new Error("ResourceUsage is required");
        const rootjwt = Crypt.rootToken();

        let resourceusage: ResourceUsage = updatedresourceusage;
        if(updatedresourceusage.product.valueadd == true) {
            removed = false;
            let _resourceusageid = (target as any)._resourceusageid;
            if(Util.IsNullEmpty(_resourceusageid)) throw new Error("Target (" + target._id + " / " + target._type + " ) has no _resourceusageid");
            resourceusage = await Config.db.GetOne<ResourceUsage>({ collectionname: "config", query: { _id: _resourceusageid, _type: "resourceusage" }, jwt: rootjwt }, parent);
            if(resourceusage == null) throw new Error("ResourceUsage (" + _resourceusageid + ") not found");
        } else {
            if (!Util.IsNullEmpty(Config.stripe_api_secret)) {
                if(updatedresourceusage.siid == null || updatedresourceusage.siid == "") {
                    removed = true;
                }
            }
        }

        if (removed === true) {
            if (target._type == "license") {
                const license = target as License;
                if(license._billingid != "" || license._resourceusageid != "" || license._productname != "Free tier") {
                    license._resourceusageid = "";
                    license._productname = "Free tier";
                    license._stripeprice = "";
                    await Config.db.UpdateOne(target, "config", 1, true, rootjwt, parent);
                }
            } else if (target._type == "workspace") {
                const workspace = target as Workspace;
                if(workspace._billingid != "" || workspace._resourceusageid != "" || workspace._productname != "Free tier") {
                    workspace._resourceusageid = "";
                    workspace._productname = "Free tier";
                    await Config.db.UpdateOne(target, "users", 1, true, rootjwt, parent);
                }
            } else if (target._type == "agent") {
                const agent = target as iAgent;
                if( agent._resourceusageid != "" || agent._productname != "Free tier") {
                    delete agent.stripeprice;
                    agent._stripeprice = "";
                    agent._resourceusageid = "";
                    agent._productname = "Free tier";
                    await Config.db.UpdateOne(target, "agents", 1, true, rootjwt, parent);
                }
            }
        } else {
            if (target._type == "license") {
                const license = target as License;
                const metadata = await Resources.CombineMetadata(tuser, jwt, resourceusage, parent);
                if(license._billingid != resourceusage.customerid || license._resourceusageid != resourceusage._id || license._productname != resourceusage.product.name ||
                    license.connections != metadata.connections || license.workspaces != metadata.workspaces || license.gitrepos != metadata.gitrepos) {
                    
                    license.connections = metadata.connections;
                    license.workspaces = metadata.workspaces;
                    license.gitrepos = metadata.gitrepos;
                    license._billingid = resourceusage.customerid;
                    license._resourceusageid = resourceusage._id;
                    license._productname = resourceusage.product.name;
                    license._stripeprice = resourceusage.product.stripeprice;
                    await Config.db.UpdateOne(target, "config", 1, true, rootjwt, parent);
                }
            } else if (target._type == "workspace") {
                const workspace = target as Workspace;
                if(workspace._billingid != resourceusage.customerid || workspace._resourceusageid != resourceusage._id || workspace._productname != resourceusage.product.name) {
                    workspace._billingid = resourceusage.customerid;
                    workspace._resourceusageid = resourceusage._id;
                    workspace._productname = resourceusage.product.name;
                    await Config.db.UpdateOne(target, "users", 1, true, rootjwt, parent);
                }
            } else if (target._type == "agent") {
                const agent = target as iAgent;
                if( agent._resourceusageid != resourceusage._id || agent._productname != resourceusage.product.name) {
                    delete agent.stripeprice;
                    agent._stripeprice = resourceusage.product.stripeprice;
                    agent._resourceusageid = resourceusage._id;
                    agent._productname = resourceusage.product.name;
                    await Config.db.UpdateOne(target, "agents", 1, true, rootjwt, parent);
                }
            }
        }
        return target;
    }
    public static async CreateResourceUsage(tuser: User, jwt: string,
        target: User | Customer | Member | Workspace | iAgent | License,
        billingid: string,
        workspaceid: string | null,
        resourceid: string,
        productname: string,
        quantity: number,
        allowreplace: boolean,
        parent: Span): Promise<{ result: ResourceUsage[], link: string }> {
        if(Util.IsNullEmpty(quantity)) quantity = 1;
        if(quantity < 1) throw new Error("Quantity must be greater than 0");
        if (allowreplace !== true) allowreplace = false;
        allowreplace = false;
        if (target == null) throw new Error("Target is required");
        if (billingid == null || billingid == "") throw new Error(Logger.enricherror(tuser, target, "Billingid is required"));
        let billing = await Config.db.GetOne<Billing>({ collectionname: "users", query: { _id: billingid, _type: "customer" }, jwt }, parent);
        if (billing == null) throw new Error(Logger.enricherror(tuser, billing, "Billing not found"));
        if (resourceid == null || resourceid == "") throw new Error(Logger.enricherror(tuser, target, "Resourceid is required"));
        let resource = await Config.db.GetOne<Resource>({ collectionname: "config", query: { _id: resourceid, _type: "resource" }, jwt }, parent);
        if (resource == null) throw new Error(Logger.enricherror(tuser, target, "Resource not found or access denied"));
        if (productname == null || productname == "") throw new Error(Logger.enricherror(tuser, target, "Product is required"));
        let product = resource.products.find(x => x.name == productname);
        if (product == null) throw new Error(Logger.enricherror(tuser, target, "Product is required"));
        if (product.stripeprice == null || product.stripeprice == "") throw new Error(Logger.enricherror(tuser, target, "Product stripeprice is required"));

        const billingadmins = await Logger.DBHelper.EnsureUniqueRole(billing.name + " billing admins", billing.admins, parent);
        if (billingadmins == null) throw new Error(Logger.enricherror(tuser, target, "Billing admins not found"));
        if (!tuser.HasRoleName("admins") && !billingadmins.IsMember(tuser._id)) throw new Error(Logger.enricherror(tuser, target, "User is not a billing admin"));

        let remove_usage: ResourceUsage = null;
        const stripecustomer: stripe_customer = await Payments.GetCustomer(tuser, billing.stripeid, parent);
        let stripeprice: stripe_price = null;
        const rootjwt = Crypt.rootToken();
        if (Config.stripe_api_secret != null && Config.stripe_api_secret != "") {
            await Payments.CleanupPendingBillingAcountUsage(billingid, parent);
            if (stripecustomer == null) throw new Error(Logger.enricherror(tuser, target, "Stripe customer associated with billing not found"));
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


        let query = {};
        if (target._type == "license") {
            query = { licenseid: target._id, _type: "resourceusage" };
        } else if (target._type == "workspace") {
            query = { workspaceid: target._id, _type: "resourceusage" };
        } else if (target._type == "agent") {
            query = { agentid: target._id, _type: "resourceusage" };
        } else if (target._type == "user") {
            query = { userid: target._id, _type: "resourceusage" };
        } else if (target._type == "member") {
            query = { memberid: target._id, _type: "resourceusage" };
        } else if (target._type == "customer") {
            query = { customerid: target._id, _type: "resourceusage" };
        } else {
            throw new Error(Logger.enricherror(tuser, target, "Target type " + target._type + " not supported"));
        }

        let resources: ResourceUsage[] = await Config.db.query<ResourceUsage>({ collectionname: "config", query: { ...query, "product.stripeprice": product.stripeprice }, jwt }, parent);
        if (resource.assign == "singlevariant") {
            if(product.valueadd == true) {
                resources = resources.filter(x => x.product.valueadd === true);
                if (resources.length > 1) throw new Error(Logger.enricherror(tuser, target, target._type + " has more than one version of this resource assigned"));
                if (resources.length == 1) model = resources[0];
                // let resources2 = await Config.db.query<ResourceUsage>({ collectionname: "config", query: { licenseid: target._id, "product.valueadd": true, "resourceid": resource._id, _type: "resourceusage" }, jwt }, parent);
                // if (resources2.length > 1) throw new Error(Logger.enricherror(tuser, target, "License has more than one version of this resource assigned"));
                // if (resource != null && resources2.length == 1) {
                //     if (resources2[0].product.stripeprice != product.stripeprice) throw new Error(Logger.enricherror(tuser, target, "License already has " + resources2[0].product.name + " assigned"));
                // }
            } else {
                resources = resources.filter(x => x.product.valueadd !== true);
                if (resources.length > 1) throw new Error(Logger.enricherror(tuser, target, target._type + " has more than one version of this resource assigned"));
                if (resources.length == 1) model = resources[0];
                let resources2 = await Config.db.query<ResourceUsage>({ collectionname: "config", query: { licenseid: target._id, "product.valueadd": {"$ne": true}, "resourceid": resource._id, _type: "resourceusage" }, jwt }, parent);
                if (resources2.length > 1) throw new Error(Logger.enricherror(tuser, target, target._type +  " has more than one version of this resource assigned"));
                if (resource != null && resources2.length == 1) {
                    if (resources2[0].product.stripeprice != product.stripeprice) throw new Error(Logger.enricherror(tuser, target, "License already has " + resources2[0].product.name + " assigned"));
                }
            }
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
            model.quantity = quantity;
            delete model.userid; // angularjs user userid to check target
            delete model.memberid;
            model.siid = ""; // angularjs user siid to check payment
            model.name = resource.name + "/" + product.name + " for " + target.name;
        } else {
            model.quantity = model.quantity + quantity;
        }
        if (product.assign == "single" || product.assign == "metered") {
            if (model.quantity > 1) throw new Error(Logger.enricherror(tuser, target, target._type + " can only have " + product.name + " assigned once"));
        }

        let stripesubscription: stripe_subscription = null;
        const stripesubscriptions = await Payments.GetSubscriptions(tuser, stripecustomer?.id, parent);
        // match price with subscription item, incase something was delete in our database and we are re-adding it
        for(let i = 0; i < stripesubscriptions.length; i++) {
            let sub = stripesubscriptions[i];
            for(let j = 0; j < sub.items.data.length; j++) {
                let item = sub.items.data[j];
                if(item.price.id == product.stripeprice) {
                    stripesubscription = sub;
                    model.siid = item.id;
                    break;
                }
            }
        }
        if(stripesubscription == null && stripesubscriptions.length > 0) {
            // if we have subscriptions, but none with a matching item, use the first active subscription ( by default there should never be more than one )
            stripesubscription = stripesubscriptions[0];
        }
        Base.addRight(model, billing._id, billing.name + " billing admins", [Rights.read]);
        if (workspaceid != null && workspaceid != "") {
            if(resource.target != "customer") {
                let workspace = await Config.db.GetOne<Workspace>({ collectionname: "users", query: { _id: workspaceid, _type: "workspace" }, jwt }, parent);
                if (workspace == null) throw new Error(Logger.enricherror(tuser, target, "Workspace not found or access denied"));
                model.workspaceid = workspace._id;
                Base.addRight(model, workspace.admins, workspace.name + " admins", [Rights.read]);
            }
        }
        if (target._type == "license") {
            model.licenseid = target._id;
        } else if (target._type == "user") {
            Base.addRight(model, target._id, target.name, [Rights.read]);
            model.userid = target._id;
        } else if (target._type == "member") {
            model.memberid = target._id;
            model.userid = (target as Member).userid;
            Base.addRight(model, (target as Member).userid, target.name, [Rights.read]);
            Base.addRight(model, billing._id, billing.name + " billing admins", [Rights.read]);
        } else if (target._type == "customer") {
            model.customerid = target._id;
            Base.addRight(model, (target as Customer).admins, target.name + " admins", [Rights.read]);
            Base.addRight(model, (target as Customer).users, target.name + " users", [Rights.read]);
        } else if (target._type == "workspace") {
            model.workspaceid = target._id;
            Base.addRight(model, (target as Workspace).admins, target.name + " admins", [Rights.read]);
            Base.addRight(model, (target as Workspace).users, target.name + " users", [Rights.read]);
        } else if (target._type == "agent") {
            model.agentid = target._id;
            // if (product.assign == "single" || product.assign == "metered") {
            //     // if (model.quantity > 1) throw new Error(Logger.enricherror(tuser, target, "Agent can only have " + product.name + " assigned once"));
            //     if (model.quantity > 1) {
            //         // assume something went wrong, and just re-assign it
            //         model.quantity = 1;
            //     }
            // }
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
            const methods = await Payments.GetPaymentMethods(tuser, stripecustomer.id, parent);
            let haspaymentmethod = false;
            if(methods.length > 0 || (stripecustomer as any)?.invoice_settings?.default_payment_method != null) {
                haspaymentmethod = true;
            }
            if (stripesubscription == null || haspaymentmethod == false) {
                if ((stripecustomer as any)?.invoice_settings?.default_payment_method == null) {
                    const checkout = await Payments.CreateCheckoutSession(tuser, billingid, stripecustomer.id, result, parent);
                    link = checkout.url;
                    return { result, link };
                } else {
                    await Payments.CreateSubscription(tuser, stripecustomer.id, result, parent);
                }
            } else {
                if (remove_usage != null) {
                    remove_usage.quantity--;
                    if (remove_usage.quantity == 0) {
                        await Config.db.DeleteOne(remove_usage._id, "config", false, rootjwt, parent);
                    } else {
                        await Config.db.UpdateOne(remove_usage, "config", 1, true, rootjwt, parent);
                    }
                }
                await Payments.PushBillingAccount(tuser, jwt, billingid, parent);
                if(resourceusage.product.valueadd) {
                    await Resources.UpdateResourceTarget(tuser, jwt, resourceusage, target, false, parent);
                }
                // resourceusage = await Config.db.GetOne<ResourceUsage>({ collectionname: "config", query: { _id: resourceusage._id, _type: "resourceusage" }, jwt }, parent);
                //await Resources.UpdateResourceTarget(tuser, jwt, resourceusage, target, false, parent);
            }
        } else {
            await Resources.UpdateResourceTarget(tuser, jwt, resourceusage, target, false, parent);
        }
        return { result, link };
    }
    public static async ReportResourceUsage(tuser: User, jwt: string,
        resourceusageid: string,
        quantity: number,
        parent: Span): Promise<void> {
        if (resourceusageid == null || resourceusageid == "") throw new Error("ResourceUsageid is required");
        if (quantity == 0) return;
        let resourceusage = await Config.db.GetOne<ResourceUsage>({ collectionname: "config", query: { _id: resourceusageid, _type: "resourceusage" }, jwt }, parent);
        if (resourceusage == null) throw new Error(Logger.enricherror(tuser, null, "ResourceUsage not found or access denied"));
        const billing = await Config.db.GetOne<Billing>({ collectionname: "users", query: { _id: resourceusage.customerid, _type: "customer" }, jwt }, parent);
        if (billing == null) throw new Error(Logger.enricherror(tuser, null, "Billing not found"));

        let target = await this.GetResourceTarget(tuser, jwt, resourceusage, parent);
        if(target == null) return;

        const billingadmins = await Logger.DBHelper.EnsureUniqueRole(billing.name + " billing admins", billing.admins, parent);
        if (billingadmins == null) throw new Error(Logger.enricherror(tuser, target, "Billing admins not found"));
        if (!tuser.HasRoleName("admins") && !billingadmins.IsMember(tuser._id)) throw new Error(Logger.enricherror(tuser, target, "User is not a billing admin"));

        await Payments.ReportMeterUsage(tuser, jwt, resourceusage, quantity, parent);        
        const timestamp = parseInt((new Date().getTime() / 1000).toFixed(0))
        const payload: any = { quantity, timestamp, resourceusageid, customerid: billing._id, resourcename: resourceusage.name, resourceid: resourceusage.resourceid, productname: resourceusage.product.name, stripeprice: resourceusage.product.stripeprice, target: target._id, targettype: target._type };
        await Config.db.InsertOne(payload, "resourceusage", 1, true, jwt, parent);
    }
    public static async GetMeteredResourceUsage(tuser: User, jwt: string,
        resourceusageid: string,
        parent: Span): Promise<any> {
        if (resourceusageid == null || resourceusageid == "") throw new Error("ResourceUsageid is required");
        let resourceusage = await Config.db.GetOne<ResourceUsage>({ collectionname: "config", query: { _id: resourceusageid, _type: "resourceusage" }, jwt }, parent);
        if (resourceusage == null) throw new Error(Logger.enricherror(tuser, null, "ResourceUsage not found or access denied"));
        if (Util.IsNullEmpty(Config.stripe_api_secret)) {
            const startofcurrentmonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
            const timestamp = parseInt((startofcurrentmonth.getTime() / 1000).toFixed(0));
            const result = await Config.db.query<any>({ collectionname: "resourceusage", query: { resourceusageid, timestamp: { "$gte": timestamp } }, jwt }, parent);
            let quantity = 0;
            for (let i = 0; i < result.length; i++) {
                quantity += result[i].quantity;
            }
            return { quantity, result };
        } else {
            const price = await Payments.GetPrice(tuser, resourceusage.product.lookup_key, resourceusage.product.stripeprice, parent);
            if (price == null) throw new Error(Logger.enricherror(tuser, null, "Price not found"));
            // @ts-ignore
            const meterid = price.recurring?.meter;
            if(!Util.IsNullEmpty(meterid)) {
                const customer = await Config.db.GetOne<Customer>({ collectionname: "users", query: { _id: resourceusage.customerid, _type: "customer" }, jwt }, parent);
                const subscription = await Payments.GetSubscription(tuser, customer.stripeid, resourceusage.subid, parent);
                let start_time = (subscription as any)?.current_period_start ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() / 1000;
                let end_time = (subscription as any)?.current_period_end ?? new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).getTime() / 1000;
                // now fix error start_time 1738494596 should be aligned with daily boundaries (expected 1738454400) because the `value_grouping_window` is day."
                start_time = Math.floor(start_time / 86400) * 86400;
                end_time = Math.floor(end_time / 86400) * 86400;
                const summary = await Message.Stripe<stripe_list<any>>("GET", `billing/meters/${meterid}/event_summaries?customer=` + customer.stripeid +
                    "&start_time=" + start_time + "&end_time=" + end_time + "&value_grouping_window=day", null, null, null);
                if(summary != null && summary.data.length > 0) {
                    let quantity = 0;
                    for(let i = 0; i < summary.data.length; i++) {
                        if(summary.data[i].aggregated_value != null) {
                            quantity += summary.data[i].aggregated_value;
                        }                        
                    }
                    return { quantity: quantity, result: summary.data} 
                }
                return { quantity: 0, result: null };
            } else {
                const summary = await Message.Stripe<stripe_list<any>>("GET", `subscription_items/${resourceusage.siid}/usage_record_summaries`, meterid, null, null);
                if(summary != null && summary.data.length > 0) {
                    return { quantity: summary.data[0].total_usage, result: summary.data} 
                }
                return { quantity: 0, result: [] };
            }
        }
    }
    public static async RemoveResourceUsage(tuser: User, jwt: string,
        resourceusageid: string, quantity: number, parent: Span): Promise<ResourceUsage> {
        if (resourceusageid == null || resourceusageid == "") throw new Error("ResourceUsageid is required");
        if(Util.IsNullEmpty(quantity)) quantity = 1;
        if(quantity < 1) throw new Error("Quantity must be greater than 0");
        const rootjwt = Crypt.rootToken();
        let resourceusage = await Config.db.GetOne<ResourceUsage>({ collectionname: "config", query: { _id: resourceusageid, _type: "resourceusage" }, jwt }, parent);
        if (resourceusage == null) throw new Error(Logger.enricherror(tuser, null, "ResourceUsage not found or access denied"));

        let target = await this.GetResourceTarget(tuser, jwt, resourceusage, parent);
        if(target == null) return resourceusage;

        if (resourceusage.quantity > 0) resourceusage.quantity = resourceusage.quantity - quantity;
        let resource = await Config.db.GetOne<Resource>({ collectionname: "config", query: { _id: resourceusage.resourceid, _type: "resource" }, jwt }, parent);
        if (resource == null) throw new Error(Logger.enricherror(tuser, target, "Resource not found or access denied"));

        if (target._type == "license") {
            if (resource.target != target._type) throw new Error(Logger.enricherror(tuser, target, "Resource is " + resource.target + " and cannot be assigned to a " + target._type));
            if (resourceusage.licenseid != target._id) throw new Error(Logger.enricherror(tuser, target, "ResourceUsage is not assigned to this license"));
        } else if (target._type == "user") {
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
        } else if (target._type == "agent") {
            if (resource.target != target._type) throw new Error(Logger.enricherror(tuser, target, "Resource is " + resource.target + " and cannot be assigned to a " + target._type));
            if (resourceusage.agentid != target._id) throw new Error(Logger.enricherror(tuser, target, "ResourceUsage is not assigned to this agent"));
        } else {
            throw new Error(Logger.enricherror(tuser, target, "Target " + target._type + " is not supported"));
        }        
        if (resourceusage.quantity < 1) {
            await Config.db.DeleteOne(resourceusage._id, "config", false, rootjwt, parent);
            await Resources.UpdateResourceTarget(tuser, jwt, resourceusage, target, true, parent);
        } else {
            resourceusage = await Config.db.UpdateOne(resourceusage, "config", 1, true, rootjwt, parent);
            await Resources.UpdateResourceTarget(tuser, jwt, resourceusage, target, true, parent);
        }
        if (!Util.IsNullEmpty(resourceusage.siid) || resourceusage.product.valueadd == true) {
            await Payments.PushBillingAccount(tuser, jwt, resourceusage.customerid, parent);
        }
        return resourceusage;
    }
    public static async GetLicenseResources(licenseid: string, parent: Span) {
        if (licenseid == null || licenseid == "") return [];
        await Payments.CleanupPendingLicenseUsage(licenseid, parent);
        const jwt = Crypt.rootToken();
        let query = { licenseid, _type: "resourceusage", quantity: { "$gt": 0 } };
        const result = Config.db.query<ResourceUsage>({ collectionname: "config", query, jwt }, parent);
        return result;
    }
    public static async GetLicenseResourcesCount(licenseid: string, parent: Span) {
        if (licenseid == null || licenseid == "") return 0;
        await Payments.CleanupPendingLicenseUsage(licenseid, parent);
        const jwt = Crypt.rootToken();
        let query = { licenseid, _type: "resourceusage", quantity: { "$gt": 0 } };
        const result = await Config.db.count({ collectionname: "config", query, jwt }, parent);
        return result;
    }
    public static async GetUserResources(userid: string, parent: Span) {
        if (userid == null || userid == "") return [];
        await Payments.CleanupPendingUserUsage(userid, parent);
        const jwt = Crypt.rootToken();
        const result = Config.db.query<ResourceUsage>({ collectionname: "config", query: { userid, _type: "resourceusage", quantity: { "$gt": 0 } }, jwt }, parent);
        return result;
    }
    public static async GetUserResourcesCount(userid: string, parent: Span) {
        if (userid == null || userid == "") return 0;
        await Payments.CleanupPendingUserUsage(userid, parent);
        const jwt = Crypt.rootToken();
        const result = await Config.db.count({ collectionname: "config", query: { userid, _type: "resourceusage", quantity: { "$gt": 0 } }, jwt }, parent);
        return result;
    }
    public static async GetCustomerResources(customerid: string, parent: Span) {
        if (customerid == null || customerid == "") throw new Error("Customerid is required");
        await Payments.CleanupPendingBillingAcountUsage(customerid, parent);
        const jwt = Crypt.rootToken();
        const result = Config.db.query<ResourceUsage>({ collectionname: "config", query: { customerid, _type: "resourceusage", quantity: { "$gt": 0 } }, jwt }, parent);
        return result;
    }
    public static async GetCustomerResourcesCount(customerid: string, parent: Span) {
        if (customerid == null || customerid == "") return 0;
        await Payments.CleanupPendingBillingAcountUsage(customerid, parent);
        const jwt = Crypt.rootToken();
        const result = await Config.db.count({ collectionname: "config", query: { customerid, _type: "resourceusage", quantity: { "$gt": 0 } }, jwt }, parent);
        return result;
    }
    public static async GetWorkspaceResources(workspaceid: string, parent: Span) {
        if (workspaceid == null || workspaceid == "") return [];
        await Payments.CleanupPendingWorkspaceUsage(workspaceid, parent);
        const jwt = Crypt.rootToken();
        let query = { workspaceid, _type: "resourceusage", quantity: { "$gt": 0 } };
        const result = Config.db.query<ResourceUsage>({ collectionname: "config", query, jwt }, parent);
        return result;
    }
    public static async GetWorkspaceResourcesCount(workspaceid: string, parent: Span) {
        if (workspaceid == null || workspaceid == "") return 0;
        await Payments.CleanupPendingWorkspaceUsage(workspaceid, parent);
        const jwt = Crypt.rootToken();
        let query = { workspaceid, _type: "resourceusage", quantity: { "$gt": 0 } };
        const result = await Config.db.count({ collectionname: "config", query, jwt }, parent);
        return result;
    }
    public static async GetAgentResourcesCount(agentid: string, parent: Span) {
        if (agentid == null || agentid == "") return 0;
        await Payments.CleanupPendingAgentUsage(agentid, parent);
        const jwt = Crypt.rootToken();
        const result = await Config.db.count({ collectionname: "config", query: { agentid, _type: "resourceusage", quantity: { "$gt": 0 } }, jwt }, parent);
        return result;
    }
    public static async GetAgentResources(agentid: string, parent: Span) {
        if (agentid == null || agentid == "") return [];
        await Payments.CleanupPendingAgentUsage(agentid, parent);
        const jwt = Crypt.rootToken();
        const result = await Config.db.query<ResourceUsage>({ collectionname: "config", query: { agentid, _type: "resourceusage", quantity: { "$gt": 0 } }, jwt }, parent);
        return result;
    }
    public static async GetMemberResources(memberid: string, parent: Span) {
        if (memberid == null || memberid == "") return [];
        await Payments.CleanupPendingMemberUsage(memberid, parent);
        const jwt = Crypt.rootToken();
        const result = Config.db.query<ResourceUsage>({ collectionname: "config", query: { memberid, _type: "resourceusage", quantity: { "$gt": 0 } }, jwt }, parent);
        return result;
    }
    public static async GetMemberResourcesCount(memberid: string, parent: Span) {
        if (memberid == null || memberid == "") return 0;
        await Payments.CleanupPendingMemberUsage(memberid, parent);
        const jwt = Crypt.rootToken();
        const result = await Config.db.count({ collectionname: "config", query: { memberid, _type: "resourceusage", quantity: { "$gt": 0 } }, jwt }, parent);
        return result;
    }
    public async GetResource(resourcename: string, parent: Span): Promise<Resource> {
        if (resourcename == null || resourcename == "") return null;
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