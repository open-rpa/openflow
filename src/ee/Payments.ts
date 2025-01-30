import { Span } from "@opentelemetry/api";
import { Config } from "../Config.js";
import { Crypt } from "../Crypt.js";
import { Logger } from "../Logger.js";
import { Rights } from "@openiap/nodeapi";
import { Member, Workspace, User, Customer, Billing, Resource, ResourceUsage, ResourceTargetType, ResourceVariantType, Product, Base, iAgent, ResourceAssignedType } from '../commoninterfaces.js';
import { Util, Wellknown } from "../Util.js";
import { Message } from "../Messages/Message.js";
import { stripe_customer, stripe_list, stripe_price, stripe_subscription, stripe_subscription_item } from "@openiap/openflow-api";

export class Payments {
    public static async EnsureCustomer(tuser: User, stripeid: string, name: string, email: string, parent: Span): Promise<string> {
        if (Util.IsNullEmpty(Config.stripe_api_secret)) return stripeid;
        if (Util.IsNullEmpty(name)) return stripeid;
        if (Util.IsNullEmpty(email)) return stripeid;
        const payload: any = { name, email };
        try {
            if (!Util.IsNullEmpty(stripeid)) {
                const stripecustomer = await Message.Stripe<stripe_customer>("POST", "customers", stripeid, payload, null);
                return stripecustomer.id;
            } else {
                const stripecustomer = await Message.Stripe<stripe_customer>("POST", "customers", null, payload, null);
                return stripecustomer.id;
            }
        } catch (error) {
            Logger.instanse.error(error, parent, { cls: "Payments", func: "EnsureCustomer" });
            throw new Error(Logger.enricherror(tuser, null, "Failed ensure stripe customer"));
        }
    }
    public static async GetCustomer(tuser: User, stripeid: string, parent: Span): Promise<stripe_customer> {
        if (Util.IsNullEmpty(Config.stripe_api_secret)) return null;
        if (Util.IsNullEmpty(stripeid)) return null;
        try {
            const stripecustomer = await Message.Stripe<stripe_customer>("GET", "customers", stripeid, null, null);
            return stripecustomer;
        } catch (error) {
            Logger.instanse.error(error, parent, { cls: "Payments", func: "GetCustomer" });
            throw new Error(Logger.enricherror(tuser, null, "Stripe customer " + stripeid + " not found"));
        }
    }
    public static async CreateBillingPortalSession(tuser: User, stripeid: string, parent: Span): Promise<any> {
        try {
            if (Util.IsNullEmpty(Config.stripe_api_secret)) return null;
            if (Util.IsNullEmpty(stripeid)) return null;
            const session = await Message.Stripe<any>("POST", "billing_portal/sessions", null, { customer: stripeid }, null);
            return session;
        } catch (error) {
            Logger.instanse.error(error, parent, { cls: "Payments", func: "CreateBillingPortalSession", stripeid });
            throw new Error(Logger.enricherror(tuser, null, "Failed create stripe billing portal session"));
        }
    }
    public static async GetPaymentMethods(tuser: User, stripeid: string, parent: Span): Promise<any> {
        if (Util.IsNullEmpty(Config.stripe_api_secret)) return null;
        if (Util.IsNullEmpty(stripeid)) return null;
        try {
            const paymentmethods = await Message.Stripe<any>("GET", "payment_methods", null, { customer: stripeid }, null);
            if(paymentmethods != null && paymentmethods.data != null) return paymentmethods.data;
            return paymentmethods;
        } catch (error) {
            Logger.instanse.error(error, parent, { cls: "Payments", func: "GetPaymentMethods", stripeid });
            throw new Error(Logger.enricherror(tuser, null, "Failed get stripe payment methods"));
        }
    }
    public static async GetSubscription(tuser: User, stripeid: string, subscriptionid: string, parent: Span): Promise<stripe_subscription> {
        if (Util.IsNullEmpty(Config.stripe_api_secret)) return null;
        // if (Util.IsNullEmpty(subscriptionid)) return null;
        if (Util.IsNullEmpty(stripeid)) return null;
        try {
            if(!Util.IsNullEmpty(subscriptionid)) {
                const stripesubscription = await Message.Stripe<stripe_subscription>("GET", "subscriptions", subscriptionid, null, stripeid);
                return stripesubscription;
            } else {
                const stripesubscription = await Message.Stripe<stripe_list<stripe_subscription>>("GET", "subscriptions", null, {customer: stripeid}, stripeid);
                if(stripesubscription.total_count == 0) return null;
                for(let i = 0; i < stripesubscription.data.length; i++) {
                    const sub:any = stripesubscription.data[i];
                    if(sub.customer == stripeid) {
                        if(sub.status == "active") return sub;
                    }
                }
                return null;
            }
        } catch (error) {
            Logger.instanse.error(error, parent, { cls: "Payments", func: "GetSubscription", stripe_subscription: subscriptionid, stripe_customer: stripeid });
            throw new Error(Logger.enricherror(tuser, null, "Stripe subscription " + subscriptionid + " not found"));
        }
    }
    public static async GetPrice(tuser: User, lookup_key: string, stripeprice: string, parent: Span): Promise<stripe_price> {
        if (Util.IsNullEmpty(Config.stripe_api_secret)) return null;
        if (Util.IsNullEmpty(lookup_key) && Util.IsNullEmpty(stripeprice)) return null;
        try {
            if(!Util.IsNullEmpty(lookup_key)) {
                const prices = await Message.Stripe<stripe_list<stripe_price>>("GET", "prices", null, {lookup_keys: [lookup_key] }, null);
                if(prices.total_count == 0) return null;
                const price = prices.data[0];
                return price;
            } else {
                const price = await Message.Stripe<stripe_price>("GET", "prices", stripeprice, null, null);
                return price;
            }
        } catch (error) {
            Logger.instanse.error(error, parent, { cls: "Payments", func: "GetPrice", lookup_key, stripeprice });
            if(!Util.IsNullEmpty(lookup_key)) {
                throw new Error(Logger.enricherror(tuser, null, "Stripe price " + lookup_key + " not found"));
            } else {
                throw new Error(Logger.enricherror(tuser, null, "Stripe price " + stripeprice + " not found"));
            }
        }
    }
    public static async GetSubscriptionLineItem(tuser: User, siid: string, stripeid: string, parent: Span): Promise<stripe_subscription_item> {
        if (Util.IsNullEmpty(Config.stripe_api_secret)) return null;
        if (Util.IsNullEmpty(stripeid)) return null;
        if (Util.IsNullEmpty(siid)) return null;
        try {
            const line_items = await Message.Stripe<stripe_list<stripe_subscription_item>>("GET", "subscription_items", siid, null, stripeid);
            if(line_items.total_count == 0) return null;
            const line_item = line_items.data[0];
            return line_item;
        } catch (error) {
            Logger.instanse.error(error, parent, { cls: "Payments", func: "GetSubscriptionLineItem", siid, stripeid });
            throw new Error(Logger.enricherror(tuser, null, "Stripe subscription line " + siid + " item not found"));
        }
    }
    public static async CreateCheckoutSession(tuser: User, billingid: string, stripeid: string, lines: ResourceUsage[], parent: Span): Promise<any> {
        if (Util.IsNullEmpty(Config.stripe_api_secret)) return null;
        if (Util.IsNullEmpty(billingid)) return null;
        if (Util.IsNullEmpty(stripeid)) return null;
        if (Util.IsNullEmpty(lines) || lines.length == 0) return null;
        const baseurl = Config.baseurl();
        try {
            var mode = "subscription";
            // if ((stripeprice as any).type == "one_time") mode = "payment";
            const payload: any = {
                client_reference_id: billingid,
                success_url: baseurl + "striperefresh/" + billingid, cancel_url: baseurl + "striperefresh/" + billingid,
                // payment_method_types: ["card"], 
                // currency: "usd",
                // currency: "hkd",
                mode,
                tax_id_collection: { enabled: true }, // Allow customer to addd tax id
                automatic_tax: { enabled: true },     // Let stripe add the correct tax
                line_items: []
            };
            if (Config.stripe_allow_promotion_codes) {
                payload.allow_promotion_codes = true;
            }
            if (!Util.IsNullEmpty(stripeid)) {
                payload.customer = stripeid;
                payload.customer_update = { "address": "auto", "name": "auto" };
                // payload.customer_email = "test+location_FR@example.com";
                // payload.customer_email = "test+location_US@example.com";
                // payload.customer_email = "test+location_NL@example.com";
                // payload.customer_email = "test+location_DE@example.com";
            } else {
                payload.billing_address_collection = "auto";
            }
            for(let i = 0; i < lines.length; i++) {
                const usage = lines[i];
                let line_item: any = { price: usage.product.stripeprice, tax_rates: [] };
                // if ((stripeprice as any).type == "one_time") {
                    // line_item.quantity = 1
                if (
                    (usage.product.assign != "metered") 
                ) {
                    line_item.quantity = usage.quantity;
                }
                payload.line_items.push(line_item);
            }
            const checkout = await Message.Stripe<any>("POST", "checkout.sessions", null, payload, null);
            return checkout;
        } catch (error) {
            Logger.instanse.error(error, parent, { cls: "Payments", func: "CreateCheckoutSession", billingid, stripeid });
            throw new Error(Logger.enricherror(tuser, null, "Create stripe checkout session failed"));
        }
    }
    public static async CreateSubscription(tuser: User, stripeid: string, lines: ResourceUsage[], parent: Span): Promise<stripe_subscription> {
        if (Util.IsNullEmpty(Config.stripe_api_secret)) return null;
        if (Util.IsNullEmpty(stripeid)) return null;
        if (Util.IsNullEmpty(lines) || lines.length == 0) return null;
        try {
            const payload: any = { items: [] };
            for(let i = 0; i < lines.length; i++) {
                const usage = lines[i];
                let line_item: any = { price: usage.product.stripeprice, tax_rates: [] };
                if (
                    (usage.product.assign != "metered") 
                ) {
                    line_item.quantity = usage.quantity;
                }
                payload.items.push(line_item);
            }
            payload["customer"] = stripeid;
            const subscription = await Message.Stripe<stripe_subscription>("POST", "subscriptions", null, payload, stripeid);
            return subscription;
        } catch (error) {
            Logger.instanse.error(error, parent, { cls: "Payments", func: "CreateSubscription", stripeid });
            throw new Error(Logger.enricherror(tuser, null, "Create stripe subscription failed"));
        }
    }
    public static async CleanupPendingUsage(billingid: string, parent: Span): Promise<void> {
        if(Util.IsNullEmpty(billingid)) return;
        if (Config.stripe_api_secret == null || Config.stripe_api_secret == "") return;
        const rootjwt = Crypt.rootToken();
        const count = await Config.db.DeleteMany({ "customerid": billingid, "$or": [{"siid": {"$exists": false}}, {"siid": ""}, {"siid": null}], _type: "resourceusage" }, null, "config", null, false, rootjwt, parent);
        if(count > 0) {
            Logger.instanse.info("Removed " + count + " pending resource usage records, before creating new one", parent, { billingid: billingid, cls: "Payments", func: "CleanupPendingUsage" });
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
    public static async SyncBillingAccount(tuser: User, jwt: string, billingid: string, parent: Span): Promise<void> {
        if (Util.IsNullEmpty(Config.stripe_api_secret)) return null;
        try {
            const rootjwt = Crypt.rootToken();
            const billingaccount = await Config.db.GetOne<Billing>({ collectionname: "users", query: { _id: billingid, _type: "customer" }, jwt }, parent);
            if(billingaccount == null) throw new Error(Logger.enricherror(tuser, null, "Billing account not found, or access denied"));
            if(Util.IsNullEmpty(billingaccount.stripeid)) {
                await this.CleanupPendingUsage(billingid, parent);
                throw new Error(Logger.enricherror(tuser, null, "Billing Account has no stripeid"));
            }
            const stripe_subscription = await this.GetSubscription(tuser, billingaccount.stripeid, billingaccount.subid, parent);
            if(stripe_subscription == null) {
                await this.CleanupPendingUsage(billingid, parent);
                throw new Error(Logger.enricherror(tuser, null, "Stripe subscription " + billingaccount.stripeid + " not found"));
            }
            const usage = await Config.db.query<ResourceUsage>({ collectionname: "config", query: { subid: stripe_subscription.id, _type: "resourceusage" }, jwt: rootjwt }, parent);
            const products = {};
            for(let i = 0; i < usage.length; i++) {
                const u = usage[i];
                const p = products[u.product.stripeprice];
                if(p == null) {
                    products[u.product.stripeprice] = { quantity: u.quantity, siid: u.siid };
                } else {
                    if(!Util.IsNullEmpty(p.quantity) && !Util.IsNullEmpty(u.quantity)) {
                        p.quantity += u.quantity;
                    }
                    if(!Util.IsNullEmpty(u.siid)) {
                        p.siid = u.siid;
                    }
                    
                }
            }
            const prices = Object.keys(products);
            for(let i = 0; i < prices.length; i++) {
                const stripe_price = prices[i];
                const price = products[stripe_price];
                const line_item = stripe_subscription.items.data.find(x => x.price.id == stripe_price);
                if(line_item == null) {
                    await Message.Stripe("POST", "subscription_items", null, { proration_behavior: "always_invoice", price: stripe_price, quantity: price.quantity, subscription: stripe_subscription.id }, billingaccount.stripeid);
                } else if (line_item.quantity != price.quantity) {
                    await Message.Stripe("POST", "subscription_items", line_item.id, { proration_behavior: "always_invoice", quantity: price.quantity }, billingaccount.stripeid);
                }
            }
            for(let i = 0; i < stripe_subscription.items.data.length; i++) {
                const line_item = stripe_subscription.items.data[i];
                const exists = usage.find(x => x.product.stripeprice == line_item.price.id);
                if(exists != null) continue;
                if(stripe_subscription.items.total_count == 1) {
                    // keep the subscription alive by keeping at least one item in it
                    await Message.Stripe("POST", "subscription_items", line_item.id, { quantity: 0 }, billingaccount.stripeid);
                } else {
                    // 
                    try {
                        await Message.Stripe("DELETE", "subscription_items", line_item.id, null, billingaccount.stripeid);
                    } catch (error) {
                        Logger.instanse.error(error, parent, { cls: "Payments", func: "SyncBillingAccount", billingid });
                        await Message.Stripe("POST", "subscription_items", line_item.id, { quantity: 0 }, billingaccount.stripeid);
                    }
                }
            }

        } catch (error) {
            Logger.instanse.error(error, parent, { cls: "Payments", func: "UpdateSubscriptionLines" });
            throw new Error(Logger.enricherror(tuser, null, "Update stripe subscription lines failed"));
        }
    }
    // public static async UpdateSubscriptionLine(tuser: User, stripeid: string, subid: string, siid:string | null, stripeprice:string, quantity:number | null, metered: boolean, parent: Span): Promise<string> {
    //     if (Util.IsNullEmpty(Config.stripe_api_secret)) return null;
    //     if (Util.IsNullEmpty(subid)) return null;
    //     if (Util.IsNullEmpty(stripeid)) return null;
    //     if (Util.IsNullEmpty(stripeprice)) return null;
    //     try {
    //         const rootjwt = Crypt.rootToken();
    //         let line_item: any = { price: stripeprice, tax_rates: [] };
    //         if (!metered) {             
    //             line_item.quantity = quantity;
    //         }
    //         // line_item["proration_behavior"] = "create_prorations"; // or none ?
    //         // line_item["payment_behavior"] = "default_incomplete"; // or error_if_incomplete the old default ?
    //         if(Util.IsNullEmpty(siid)) {
    //             line_item["subscription"] = subid;
    //         }
    //         const res = await Message.Stripe<stripe_subscription_item>("POST", "subscription_items", siid, line_item, stripeid);
    //         return res.id;
    //     } catch (error) {
    //         Logger.instanse.error(error, parent, { cls: "Payments", func: "UpdateSubscriptionLines", subid, stripeid });
    //         throw new Error(Logger.enricherror(tuser, null, "Update stripe subscription lines failed"));
    //     }
    // }
    // public static async UpdateSubscriptionLines(tuser: User, stripeid: string, subid: string, lines: ResourceUsage[], parent: Span): Promise<void> {
    //     if (Util.IsNullEmpty(Config.stripe_api_secret)) return null;
    //     if (Util.IsNullEmpty(subid)) return null;
    //     if (Util.IsNullEmpty(stripeid)) return null;
    //     if (Util.IsNullEmpty(lines) || lines.length == 0) return null;
    //     try {
    //         const rootjwt = Crypt.rootToken();
    //         for(let i = 0; i < lines.length; i++) {
    //             const usage = lines[i];
    //             usage.siid = await this.UpdateSubscriptionLine(tuser, stripeid, subid, usage.siid, usage.product.stripeprice, usage.quantity, usage.product.assign == "metered", parent);
    //             usage.subid = subid;
    //             await Config.db.UpdateOne(usage, "config", 1, true, rootjwt, parent);
    //         }            
    //     } catch (error) {
    //         Logger.instanse.error(error, parent, { cls: "Payments", func: "UpdateSubscriptionLines", subid, stripeid });
    //         throw new Error(Logger.enricherror(tuser, null, "Update stripe subscription lines failed"));
    //     }
    // }
    // public static async RemoveSubscriptionLine(tuser: User, stripeid: string, subid: string, siid: string, parent: Span): Promise<void> {
    //     if (Util.IsNullEmpty(Config.stripe_api_secret)) return null;
    //     if (Util.IsNullEmpty(stripeid)) return null;
    //     if (Util.IsNullEmpty(subid)) return null;
    //     if (Util.IsNullEmpty(siid)) return null;
    //     try {
    //         const sub = await this.GetSubscription(tuser, stripeid, subid, parent);
    //         if(sub == null) return;
    //         if((sub as any).status != "active") return;
    //         if(sub.items.total_count == 1) {
    //             await Message.Stripe("DELETE", "subscriptions", subid, null, stripeid);
    //         } else {
    //             await Message.Stripe("DELETE", "subscription_items", siid, null, stripeid);
    //         }
    //     } catch (error) {
    //         Logger.instanse.error(error, parent, { cls: "Payments", func: "RemoveSubscriptionLine", siid, stripeid });
    //         throw new Error(Logger.enricherror(tuser, null, "Remove stripe subscription line failed"));
    //     }
    // }
    public static async RefreshStripeCustomer(tuser: User, billingid: string, parent: Span): Promise<void> {
        // https://home.openiap.io/striperefresh/67939c225440b08b3d13c8af
        if (Util.IsNullEmpty(Config.stripe_api_secret)) return;
        if (Util.IsNullEmpty(billingid)) return;
        try {
            const rootjwt = Crypt.rootToken();
            const billing = await Config.db.GetOne<Billing>({ collectionname: "users", query: { _id: billingid, _type: "customer" }, jwt: rootjwt }, parent);
            if (billing == null) throw new Error(Logger.enricherror(tuser, null, "Billing object not found"));
            if(Util.isObject(billing.stripeid)) throw new Error(Logger.enricherror(tuser, null, "Billing Account has no stripeid"));
            const pending = await Config.db.query<ResourceUsage>({ collectionname: "config", query: { siid: "", _type: "resourceusage", customerid: billingid }, jwt: rootjwt }, parent);
            if(pending.length == 0) return;
            const subscription = await this.GetSubscription(tuser, billing.stripeid, null, parent);
            if(subscription == null) return;
            for(let i = 0; i < pending.length; i++) {
                const resourceusage = pending[i];
                const line_item = subscription.items.data.find(x => x.price.id == resourceusage.product.stripeprice || x.price.lookup_key == resourceusage.product.lookup_key);
                if(line_item == null) {
                    await Config.db.DeleteOne(resourceusage._id, "config", false, rootjwt, parent);
                    continue;
                }
                resourceusage.siid = line_item.id;
                resourceusage.subid = subscription.id;
                resourceusage.product.stripeprice = line_item.price.id;
                resourceusage.product.lookup_key = line_item.price.lookup_key;
                await Config.db.UpdateOne(resourceusage, "config", 1, true, rootjwt, parent);
                
                let target: User | Customer | Member | Workspace | iAgent;
                if (!Util.IsNullEmpty(resourceusage.memberid)) {
                    target = await Config.db.GetOne<Member>({ collectionname: "users", query: { _id: resourceusage.memberid, _type: "member" }, jwt: rootjwt }, parent);
                } else if (!Util.IsNullEmpty(resourceusage.agentid)) {
                    target = await Config.db.GetOne<iAgent>({ collectionname: "agents", query: { _id: resourceusage.agentid, _type: "agent" }, jwt: rootjwt }, parent);
                } else if (!Util.IsNullEmpty(resourceusage.userid)) {
                    target = await Config.db.GetOne<User>({ collectionname: "users", query: { _id: resourceusage.userid, _type: "user" }, jwt: rootjwt }, parent);
                } else if (!Util.IsNullEmpty(resourceusage.workspaceid)) {
                    target = await Config.db.GetOne<Workspace>({ collectionname: "users", query: { _id: resourceusage.workspaceid, _type: "workspace" }, jwt: rootjwt }, parent);
                } else if (!Util.IsNullEmpty(resourceusage.customerid)) {
                    target = await Config.db.GetOne<iAgent>({ collectionname: "users", query: { _id: resourceusage.customerid, _type: "customer" }, jwt: rootjwt }, parent);
                }
                if (target == null) throw new Error("Target is required");
        
                if (target._type == "workspace") {
                    (target as Workspace)._billingid = billing._id;
                    (target as Workspace)._resourceusageid = resourceusage._id;
                    (target as Workspace)._productname = resourceusage.product.name;
                    await Config.db.UpdateOne(target, "users", 1, true, rootjwt, parent);
                } else if (target._type == "agent") {
                    (target as iAgent).stripeprice = resourceusage.product.stripeprice;
                    (target as iAgent)._billingid = billing._id;
                    (target as iAgent)._resourceusageid = resourceusage._id;
                    (target as iAgent)._productname = resourceusage.product.name;
                    await Config.db.UpdateOne(target, "agents", 1, true, rootjwt, parent);
                }
        
            }

        } catch (error) {
            Logger.instanse.error(error, parent, { cls: "Payments", func: "RefreshStripeCustomer", billingid });
            throw new Error(Logger.enricherror(tuser, null, "Refresh stripe customer failed"));
        }

    }
}