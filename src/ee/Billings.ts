import { Rights } from "@openiap/nodeapi";
import { Span } from "@opentelemetry/api";
import { Base, Billing, Customer, Role, User, Workspace } from '../commoninterfaces.js';
import { Config } from "../Config.js";
import { Crypt } from "../Crypt.js";
import { Logger } from "../Logger.js";
import { Util, Wellknown } from "../Util.js";
import { Payments } from "./Payments.js";
import { Resources } from "./Resources.js";
import { Workspaces } from "./Workspaces.js";

export class Billings {
    public static async EnsureBilling(tuser: User, jwt: string, billing: Billing, parent: Span): Promise<Billing> {
        let result: Billing = new Billing();
        if (billing == null) throw new Error("Billing is required");
        if (billing._id != null && billing._id != "") {
            result = await Config.db.GetOne({ collectionname: "users", query: { _id: billing._id, _type: "customer" }, jwt }, parent);
            if (result == null) throw new Error(Logger.enricherror(tuser, billing, "Billing object not found"));
        }
        const billingadmins = await Logger.DBHelper.EnsureUniqueRole(billing.name + " billing admins", result.admins, parent);
        if (billing._id != null && billing._id != "") {
            if (!tuser.HasRoleName(Wellknown.admins.name)) {
                if (!billingadmins.IsMember(tuser._id)) throw new Error(Logger.enricherror(tuser, billing, "User is not a member of the billing admins"));
            }
        } else {
            Base.addRight(billingadmins, billingadmins._id, billingadmins.name, [Rights.read]);
            billingadmins.AddMember(tuser);
        }
        const rootjwt = Crypt.rootToken();
        Base.removeRight(billingadmins, billingadmins._id, [Rights.full_control]);
        Base.addRight(billingadmins, billingadmins._id, billingadmins.name, [Rights.read]);
        await Logger.DBHelper.Save(billingadmins, rootjwt, parent);
        Base.removeRight(result, billingadmins._id, [Rights.full_control]);
        Base.addRight(result, billingadmins._id, billingadmins.name, [Rights.read]);

        result.name = billing.name;
        result.admins = billingadmins._id;
        if (billing.email != null && billing.email != "") result.email = billing.email;
        if (result.email == null || result.email == "") result.email = tuser.email;
        if (result.email == null || result.email == "") result.email = tuser.username;
        const stripe_customer = await Payments.EnsureCustomer(tuser, jwt, result, parent);
        if (stripe_customer != null) {
            result.stripeid = stripe_customer.id;
            if (!Util.IsNullEmpty((stripe_customer as any).currency))
                result.currency = (stripe_customer as any).currency;
        }

        result = await Config.db.InsertOrUpdateOne(result, "users", "_id", 1, true, rootjwt, parent);
        return result;
    }
    public static async RemoveBilling(tuser: User, jwt: string, billingid: string, parent: Span): Promise<void> {
        if (Util.IsNullEmpty(billingid)) throw new Error("Billing id is required");
        let billing: Billing = new Billing();
        billing = await Config.db.GetOne({ collectionname: "users", query: { _id: billingid, _type: "customer" }, jwt }, parent);
        if (billing == null) throw new Error(Logger.enricherror(tuser, billing, "Billing object not found"));
        const billingadmins = await Logger.DBHelper.EnsureUniqueRole(billing.name + " billing admins", billing.admins, parent);
        if (!tuser.HasRoleName(Wellknown.admins.name)) {
            if (!billingadmins.IsMember(tuser._id)) throw new Error(Logger.enricherror(tuser, billing, "User is not a member of the billing admins"));
        }
        const rootjwt = Crypt.rootToken();
        const count = await Resources.GetCustomerResourcesCount(billingid, parent);
        if (count > 0) throw new Error(Logger.enricherror(tuser, billing, "There are resources using this Billing account"));
        await Config.db.DeleteOne(billingadmins._id, "users", false, rootjwt, parent);
        await Config.db.DeleteOne(billingid, "users", false, rootjwt, parent);
    }
    public static async GetBillingPortalLink(tuser: User, jwt: string, billingid: string, parent: Span): Promise<string> {
        if (Util.IsNullEmpty(billingid)) throw new Error("Billing id is required");
        const billing = await Config.db.GetOne<Billing>({ collectionname: "users", query: { _id: billingid, _type: "customer" }, jwt }, parent);
        if (billing == null) throw new Error(Logger.enricherror(tuser, billing, "Billing object not found"));
        const session = await Payments.CreateBillingPortalSession(tuser, billing.stripeid, parent);
        if (session == null) throw new Error(Logger.enricherror(tuser, billing, "Error creating billing portal session"));
        return session.url;
    }
    public static async UpgradeBillingAccount(tuser: User, jwt: string, billingid: string, parent: Span): Promise<Billing> {
        if (!tuser.HasRoleId(Wellknown.admins._id)) throw new Error("Access denied");
        if (Util.IsNullEmpty(billingid)) throw new Error("Billing id is required");
        const ucustomer = await Config.db.GetOne<Customer>({ query: { _id: billingid, "_type": "customer" }, collectionname: "users", jwt }, parent);
        if (ucustomer == null) throw new Error("Customer not found, or access denied");
        let uworkspace = await Config.db.GetOne<Workspace>({ query: { name: ucustomer.name, "_type": "workspace", _billingid: ucustomer._id }, collectionname: "users", jwt }, parent);
        if(ucustomer.users == null || ucustomer.users == "") {
            return ucustomer as any;
        }
        let u2: User = null;
        let uusers = await Config.db.GetOne<Role>({ query: { name: ucustomer.users, "_type": "role" }, collectionname: "users", jwt }, parent);
        let uadmins = await Config.db.GetOne<Role>({ query: { name: ucustomer.admins, "_type": "role" }, collectionname: "users", jwt }, parent);
        if(ucustomer.userid != null && ucustomer.userid != "") {
            u2 = await Config.db.GetOne<User>({ query: { _id: ucustomer.userid, "_type": "user" }, collectionname: "users", jwt }, parent);
        }
        if(uusers == null && uadmins == null && u2 == null) {
            console.warn("Deleting customer " + ucustomer.name + " (" + ucustomer._id + ") with no users attached");
            await Config.db.DeleteOne(ucustomer._id, "users", false, jwt, parent);
            return ucustomer as any;
        }
        if(uworkspace == null) {
            uworkspace = await Workspaces.EnsureWorkspace(tuser, jwt, {"name": ucustomer.name, _billingid: ucustomer._id } as any, parent);
        }
        if(uusers != null) {
            for(let i = 0; i < uusers.members.length; i++) {
                const member = uusers.members[i];
                let u = await Config.db.GetOne<User>({ query: { _id: member._id, "_type": "user" }, collectionname: "users", jwt }, parent);
                await Workspaces.AddUserToWorkspace(tuser, jwt, u.email, uworkspace._id, "member", parent);
            }
        }
        if(uadmins != null) {
            for(let i = 0; i < uadmins.members.length; i++) {
                const member = uadmins.members[i];
                let u = await Config.db.GetOne<User>({ query: { _id: member._id, "_type": "user" }, collectionname: "users", jwt }, parent);
                await Workspaces.AddUserToWorkspace(tuser, jwt, u.email, uworkspace._id, "admin", parent);
            }
        }
        if(u2 != null) {
            await Workspaces.AddUserToWorkspace(tuser, jwt, u2.email, uworkspace._id, "admin", parent);
        }
        delete ucustomer.users;
        delete ucustomer.userid;
        await Config.db.UpdateOne<Customer>(ucustomer, "users", 1, true, Crypt.rootToken(), parent);
        return ucustomer as any;
    }
}