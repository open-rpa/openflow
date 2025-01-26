import { Rights } from "@openiap/nodeapi";
import { stripe_customer } from "@openiap/openflow-api";
import { Span } from "@opentelemetry/api";
import { Base, Billing, Resource, User } from '../commoninterfaces.js';
import { Config } from "../Config.js";
import { Crypt } from "../Crypt.js";
import { Logger } from "../Logger.js";
import { Message } from "../Messages/Message.js";
import { Wellknown } from "../Util.js";
import { Resources } from "./Resources.js";

export class Billings {
    public static async EnsureBilling(tuser: User, jwt: string, billing: Billing, parent: Span): Promise<Billing> {
        let result: Billing = new Billing();
        if (billing == null) throw new Error("Billing is required");
        if (billing._id != null && billing._id != "") {
            result = await Config.db.GetOne({ collectionname: "users", query: { _id: tuser._id, _type: "customer" }, jwt }, parent);
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
        if (Config.stripe_api_secret != null && Config.stripe_api_secret != "") {
            const payload: any = { name: result.name, email: result.email };
            if (result.stripeid != null && result.stripeid != "") {
                const stripecustomer = await Message.Stripe<stripe_customer>("PUT", "customers", result.stripeid, payload, null);
                result.stripeid = stripecustomer.id;
            } else {
                const stripecustomer = await Message.Stripe<stripe_customer>("POST", "customers", result.stripeid, payload, null);
                result.stripeid = stripecustomer.id;
            }
        }
        result = await Config.db.InsertOrUpdateOne(result, "users", "_id", 1, true, rootjwt, parent);
        return result;
    }
    public static async RemoveBilling(tuser: User, jwt: string, billingid: string, parent: Span): Promise<void> {
        let billing: Billing = new Billing();
        billing = await Config.db.GetOne({ collectionname: "users", query: { _id: billingid, _type: "customer" }, jwt }, parent);
        if (billing == null) throw new Error(Logger.enricherror(tuser, billing, "Billing object not found"));
        const billingadmins = await Logger.DBHelper.EnsureUniqueRole(billing.name + " billing admins", billing.admins, parent);
        if (!tuser.HasRoleName(Wellknown.admins.name)) {
            if (!billingadmins.IsMember(tuser._id)) throw new Error(Logger.enricherror(tuser, billing, "User is not a member of the billing admins"));
        }
        const rootjwt = Crypt.rootToken();
        const count = await Resources.GetCustomerResourcesCount(billingid, parent);
        if(count > 0) throw new Error(Logger.enricherror(tuser, billing, "There are resources using this Billing account"));
        await Config.db.DeleteOne(billingadmins._id, "users", false, rootjwt, parent);
        await Config.db.DeleteOne(billingid, "users", false, rootjwt, parent);
    }

}