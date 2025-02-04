import { stripe_customer, stripe_list, stripe_price, stripe_subscription, stripe_subscription_item } from "@openiap/openflow-api";
import { Span } from "@opentelemetry/api";
import { Billing, Customer, iAgent, Member, ResourceUsage, User, Workspace } from '../commoninterfaces.js';
import { Config } from "../Config.js";
import { Crypt } from "../Crypt.js";
import { Logger } from "../Logger.js";
import { Message } from "../Messages/Message.js";
import { Util } from "../Util.js";
import express from "express";
import { Resources } from "./Resources.js";
export class Payments {
    allowedEvents = [ // Stripe.Event.Type[] = [
        "checkout.session.completed",
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
        "customer.subscription.paused",
        "customer.subscription.resumed",
        "customer.subscription.pending_update_applied",
        "customer.subscription.pending_update_expired",
        "customer.subscription.trial_will_end",
        "invoice.paid",
        "invoice.payment_failed",
        "invoice.payment_action_required",
        "invoice.upcoming",
        "invoice.marked_uncollectible",
        "invoice.payment_succeeded",
        "payment_intent.succeeded",
        "payment_intent.payment_failed",
        "payment_intent.canceled",
    ];
    static async configure(app: express.Express, parent: Span): Promise<void> {
        app.post("/stripeevent/v1", async (req, res, next) => {
            if (Util.IsNullEmpty(Config.stripe_api_secret)) return null;
            let type = "unknown";
            let stripeid = "unknown";
            let name = "unknown";
            try {
                // TODO: I don't care about signing right now, but we must implement that at somepoint
                // const sig = req.headers['stripe-signature'];
                type = req.body?.type;
                const object = req.body?.data?.object;
                if (object == null) throw new Error("No object in stripe event");
                stripeid = object.customer;
                if (!Util.IsNullEmpty(object.description)) name = object.description;
                if (!Util.IsNullEmpty(object.nickname)) name = object.nickname;
                if (!Util.IsNullEmpty(object.name)) name = object.name;
                if (!Util.IsNullEmpty(object.account_name)) name = object.account_name;
                if (type == "payment_method.attached") name = object.customer;
                if (type == "customer.subscription.created") name = object.customer;
                if (type == "price.created") name = object.id;
                if (name == "unknown" && !Util.IsNullEmpty(object.amount)) name = object.amount + " " + object.currency + " for " + object.customer;
                if (name == "unknown" && !Util.IsNullEmpty(object.amount_total)) name = object.amount_total + " " + object.currency + " for " + object.customer;
                if (name == "unknown") {
                    var b = true;
                    name = "for " + object.customer;
                }
                if (Config.stripe_log_eventhook) {
                    await Config.db.InsertOne({ ...req.body, name: type + " " + name, _type: "stripeevent", stripeid }, "stripeevent", 1, false, Crypt.rootToken(), parent);
                }
                Logger.instanse.debug(JSON.stringify({ ...req.body, name: type + " " + name, _type: "stripeevent", stripeid }), parent, { cls: "Payments", func: "stripeevent", stripeid, type });
                if (stripeid != null) {
                    let billing = await Config.db.GetOne<Billing>({ collectionname: "users", query: { stripeid, _type: "customer" }, jwt: Crypt.rootToken() }, parent);
                    if (billing == null && Config.stripe_api_key.indexOf("_test") > -1) {
                        billing = await Config.db.GetOne<Billing>({ collectionname: "users", query: { _id: "679f732f6a6ac0523dac2874", _type: "customer" }, jwt: Crypt.rootToken() }, parent);
                        if (billing != null) {
                            billing.stripeid = stripeid;
                            await Config.db.UpdateOne(billing, "users", 1, true, Crypt.rootToken(), parent);
                        }
                    }
                    if (billing == null) throw new Error("Billing account not found");
                    // await Payments.SyncBillingAccount(Crypt.rootUser(), Crypt.rootToken(), billing._id, parent);
                    await Payments.PullBillingAccount(Crypt.rootUser(), Crypt.rootToken(), billing._id, parent);
                }
                res.status(200).send("OK");
            } catch (error) {
                Logger.instanse.error(error, parent, { cls: "Payments", func: "stripeevent", stripeid, type });
                res.status(500).send(error.message);
            }
            console.log(req.body);
        });
    }
    public static async ReportMeterUsage(tuser: User, jwt: string, usage: ResourceUsage, quantity: number, parent: Span): Promise<void> {
        if (Util.IsNullEmpty(Config.stripe_api_secret)) return null;
        if (usage == null) throw new Error("Usage is required");
        try {
            const customer = await Config.db.GetOne<Customer>({ collectionname: "users", query: { _id: usage.customerid, _type: "customer" }, jwt }, parent);
            if (customer == null) throw new Error("Customer not found");
            const price = await Payments.GetPrice(tuser, usage.product.lookup_key, usage.product.stripeprice, parent);
            if (price == null) throw new Error("Price not found");
            // @ts-ignore
            const meterid = price.recurring?.meter;
            const timestamp = parseInt((new Date().getTime() / 1000).toFixed(0))
            if (!Util.IsNullEmpty(meterid)) {
                const meter = await Message.Stripe<any>("GET", "billing/meters", meterid, null, null);
                if (meter == null) throw new Error("Meter " + meterid + " not found");
                const payload = {
                    timestamp,
                    event_name: meter.event_name,
                    payload: {
                        stripe_customer_id: customer.stripeid,
                        value: quantity,
                    }
                }
                await Message.Stripe<any>("POST", "billing/meter_events", null, payload, null);
                return;
            }
            const payload = { quantity, timestamp };
            await Message.Stripe<any>("POST", "usage_records", usage.siid, payload, null);
            Logger.instanse.debug("Reported " + quantity + " for metered subscription line " + usage.siid, parent, { quantity, siid: usage.siid, cls: "Payments", func: "ReportMeterUsage" });
            return;
        } catch (error) {
            Logger.instanse.error(error, parent, { cls: "Payments", func: "ReportMeterUsage" });
            throw new Error(Logger.enricherror(tuser, null, error.message));
        }

    }
    public static async EnsureCustomer(tuser: User, jwt: string, billing: Billing, parent: Span): Promise<stripe_customer> {
        if (Util.IsNullEmpty(Config.stripe_api_secret)) return null;
        if (Util.IsNullEmpty(billing.name)) return null;
        if (Util.IsNullEmpty(billing.email)) return null;
        const payload: any = { name: billing.name, email: billing.email };
        // if (!Util.IsNullEmpty(currency)) {
        //     payload.currency = currency;
        // }
        try {
            if (!Util.IsNullEmpty(billing.stripeid)) {
                const stripecustomer = await Message.Stripe<stripe_customer>("POST", "customers", billing.stripeid, payload, null);
                await Payments.PullBillingAccount(tuser, jwt, billing._id, parent);
                return stripecustomer;
            } else {
                const stripecustomer = await Message.Stripe<stripe_customer>("POST", "customers", null, payload, null);
                // HACK: add a product with a currency, to force customer to have a currency
                // stripeid = stripecustomer.id;
                // if (!Util.IsNullEmpty(currency)) {
                //     const price = await Payments.GetPrice(tuser, "supporthours_basic_monthly", null, parent);
                //     if (price == null) {
                //         Logger.instanse.warn("Failed locating supporthours_basic_monthly, so cannot add temp subscription for new customer " + stripeid, parent, { cls: "Payments", func: "EnsureCustomer" });
                //         return stripecustomer;
                //     }
                //     const subpayload = { customer: stripeid, items: [{ price: price.id }], currency };
                //     const sub = await Message.Stripe<stripe_subscription>("POST", "subscriptions", null, subpayload, stripeid);
                // }
                await Payments.PullBillingAccount(tuser, jwt, billing._id, parent);
                return stripecustomer;
            }
        } catch (error) {
            Logger.instanse.error(error, parent, { cls: "Payments", func: "EnsureCustomer" });
            throw new Error(Logger.enricherror(tuser, null, "Failed ensure stripe customer (" + error.message + ")"));
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
            throw new Error(Logger.enricherror(tuser, null, "Failed create stripe billing portal session (" + error.message + ")"));
        }
    }
    public static async GetPaymentMethods(tuser: User, stripeid: string, parent: Span): Promise<any> {
        if (Util.IsNullEmpty(Config.stripe_api_secret)) return null;
        if (Util.IsNullEmpty(stripeid)) return null;
        try {
            const paymentmethods = await Message.Stripe<any>("GET", "payment_methods", null, { customer: stripeid }, null);
            if (paymentmethods != null && paymentmethods.data != null) return paymentmethods.data;
            return paymentmethods;
        } catch (error) {
            Logger.instanse.error(error, parent, { cls: "Payments", func: "GetPaymentMethods", stripeid });
            throw new Error(Logger.enricherror(tuser, null, "Failed get stripe payment methods (" + error.message + ")"));
        }
    }
    public static async GetSubscriptions(tuser: User, stripeid: string, parent: Span): Promise<stripe_subscription[]> {
        if (Util.IsNullEmpty(Config.stripe_api_secret)) return [];
        if (Util.IsNullEmpty(stripeid)) return [];
        try {
            const result: stripe_subscription[] = [];
            const stripesubscription = await Message.Stripe<stripe_list<stripe_subscription>>("GET", "subscriptions", null, { customer: stripeid }, stripeid);
            if (stripesubscription.total_count == 0) return null;
            for (let i = 0; i < stripesubscription.data.length; i++) {
                const sub: any = stripesubscription.data[i];
                if (sub.customer == stripeid) {
                    if (sub.status == "active") result.push(sub);
                }
            }
            return result;
        } catch (error) {
            Logger.instanse.error(error, parent, { cls: "Payments", func: "GetSubscriptions", stripeid });
            throw new Error(Logger.enricherror(tuser, null, "Stripe customer " + stripeid + " not found (" + error.message + ")"));
        }
    }
    public static async GetSubscription(tuser: User, stripeid: string, subscriptionid: string, parent: Span): Promise<stripe_subscription> {
        if (Util.IsNullEmpty(Config.stripe_api_secret)) return null;
        if (Util.IsNullEmpty(stripeid)) return null;
        try {
            if (!Util.IsNullEmpty(subscriptionid)) {
                const stripesubscription = await Message.Stripe<stripe_subscription>("GET", "subscriptions", subscriptionid, null, stripeid);
                return stripesubscription;
            } else {
                const stripesubscriptions = await this.GetSubscriptions(tuser, stripeid, parent);
                if (stripesubscriptions.length > 0) return stripesubscriptions[0];
                return null;
            }
        } catch (error) {
            Logger.instanse.error(error, parent, { cls: "Payments", func: "GetSubscription", subscriptionid, stripeid });
            throw new Error(Logger.enricherror(tuser, null, "Stripe subscription " + subscriptionid + " not found"));
        }
    }
    public static async GetPrice(tuser: User, lookup_key: string, stripeprice: string, parent: Span): Promise<stripe_price> {
        if (Util.IsNullEmpty(Config.stripe_api_secret)) return null;
        if (Util.IsNullEmpty(lookup_key) && Util.IsNullEmpty(stripeprice)) return null;
        try {
            if (!Util.IsNullEmpty(lookup_key)) {
                const prices = await Message.Stripe<stripe_list<stripe_price>>("GET", "prices", null, { lookup_keys: [lookup_key] }, null);
                if (prices.total_count == 0) return null;
                const price = prices.data[0];
                return price;
            } else {
                const price = await Message.Stripe<stripe_price>("GET", "prices", stripeprice, null, null);
                return price;
            }
        } catch (error) {
            Logger.instanse.error(error, parent, { cls: "Payments", func: "GetPrice", lookup_key, stripeprice });
            if (!Util.IsNullEmpty(lookup_key)) {
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
            if (line_items.total_count == 0) return null;
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
            for (let i = 0; i < lines.length; i++) {
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
            for (let i = 0; i < lines.length; i++) {
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
    public static async CleanupPendingUserUsage(userid: string, parent: Span): Promise<void> {
        if (Util.IsNullEmpty(userid)) return;
        if (Config.stripe_api_secret == null || Config.stripe_api_secret == "") return;
        const rootjwt = Crypt.rootToken();
        const count = await Config.db.DeleteMany({ "userid": userid, "$or": [{ "siid": { "$exists": false } }, { "siid": "" }, { "siid": null }], _type: "resourceusage" }, null, "config", null, false, rootjwt, parent);
        if (count > 0) {
            Logger.instanse.info("Removed " + count + " pending resource usage records, before creating new one", parent, { userid: userid, cls: "Payments", func: "CleanupPendingUserUsage" });
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
    public static async CleanupPendingBillingAcountUsage(billingid: string, parent: Span): Promise<void> {
        if (Util.IsNullEmpty(billingid)) return;
        if (Config.stripe_api_secret == null || Config.stripe_api_secret == "") return;
        const rootjwt = Crypt.rootToken();
        const count = await Config.db.DeleteMany({ "customerid": billingid, "$or": [{ "siid": { "$exists": false } }, { "siid": "" }, { "siid": null }], _type: "resourceusage" }, null, "config", null, false, rootjwt, parent);
        if (count > 0) {
            Logger.instanse.info("Removed " + count + " pending resource usage records, before creating new one", parent, { billingid: billingid, cls: "Payments", func: "CleanupPendingBillingAcountUsage" });
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
    public static async CleanupPendingWorkspaceUsage(workspaceid: string, parent: Span): Promise<void> {
        if (Util.IsNullEmpty(workspaceid)) return;
        if (Config.stripe_api_secret == null || Config.stripe_api_secret == "") return;
        const rootjwt = Crypt.rootToken();
        const count = await Config.db.DeleteMany({ "workspaceid": workspaceid, "$or": [{ "siid": { "$exists": false } }, { "siid": "" }, { "siid": null }], _type: "resourceusage" }, null, "config", null, false, rootjwt, parent);
        if (count > 0) {
            Logger.instanse.info("Removed " + count + " pending resource usage records, before creating new one", parent, { workspaceid: workspaceid, cls: "Payments", func: "CleanupPendingWorkspaceUsage" });
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
    public static async CleanupPendingAgentUsage(agentid: string, parent: Span): Promise<void> {
        if (Util.IsNullEmpty(agentid)) return;
        if (Config.stripe_api_secret == null || Config.stripe_api_secret == "") return;
        const rootjwt = Crypt.rootToken();
        const count = await Config.db.DeleteMany({ "agentid": agentid, "$or": [{ "siid": { "$exists": false } }, { "siid": "" }, { "siid": null }], _type: "resourceusage" }, null, "config", null, false, rootjwt, parent);
        if (count > 0) {
            Logger.instanse.info("Removed " + count + " pending resource usage records, before creating new one", parent, { agentid: agentid, cls: "Payments", func: "CleanupPendingAgentUsage" });
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
    public static async CleanupPendingMemberUsage(memberid: string, parent: Span): Promise<void> {
        if (Util.IsNullEmpty(memberid)) return;
        if (Config.stripe_api_secret == null || Config.stripe_api_secret == "") return;
        const rootjwt = Crypt.rootToken();
        const count = await Config.db.DeleteMany({ "memberid": memberid, "$or": [{ "siid": { "$exists": false } }, { "siid": "" }, { "siid": null }], _type: "resourceusage" }, null, "config", null, false, rootjwt, parent);
        if (count > 0) {
            Logger.instanse.info("Removed " + count + " pending resource usage records, before creating new one", parent, { memberid: memberid, cls: "Payments", func: "CleanupPendingMemberUsage" });
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
    public static async PullBillingAccount(tuser: User, jwt: string, billingid: string, parent: Span): Promise<void> {
        if (Util.IsNullEmpty(Config.stripe_api_secret)) return null;
        if(Util.IsNullEmpty(billingid)) return null;
        try {
            const rootjwt = Crypt.rootToken();
            const billingaccount = await Config.db.GetOne<Billing>({ collectionname: "users", query: { _id: billingid, _type: "customer" }, jwt }, parent);
            if (billingaccount == null) throw new Error(Logger.enricherror(tuser, null, "Billing account not found, or access denied"));
            if (Util.IsNullEmpty(billingaccount.stripeid)) {
                const usage = await Config.db.query<ResourceUsage>({ collectionname: "config", query: { customerid: billingid, _type: "resourceusage" }, jwt: rootjwt }, parent);
                for(let i = 0; i < 0; i++) {
                    await Resources.RemoveResourceUsage(tuser, jwt, usage[i]._id, parent);
                }
                // const count = await Config.db.DeleteMany({ "customerid": billingid, _type: "resourceusage" }, null, "config", null, false, rootjwt, parent);
                // if (count > 0) {
                //     Logger.instanse.info("Removed " + count + " resource usage records for Billing acount with no stripeid", parent, { billingid, cls: "Payments", func: "PullBillingAccount" });
                // }
                return;
            }
            const stripeid = billingaccount.stripeid;
            const stripe_customer = await this.GetCustomer(tuser, stripeid, parent);
            if (stripe_customer == null) {
                const usage = await Config.db.query<ResourceUsage>({ collectionname: "config", query: { customerid: billingid, _type: "resourceusage" }, jwt: rootjwt }, parent);
                for(let i = 0; i < 0; i++) {
                    await Resources.RemoveResourceUsage(tuser, jwt, usage[i]._id, parent);
                }
                // const count = await Config.db.DeleteMany({ "customerid": billingid, _type: "resourceusage" }, null, "config", null, false, rootjwt, parent);
                // if (count > 0) {
                //     Logger.instanse.info("Removed " + count + " resource usage records for Billing acount, since " + stripeid + " no longer exists", parent, { billingid, cls: "Payments", func: "PullBillingAccount" });
                // }
                return;
            }
            const stripe_subscriptions = await this.GetSubscriptions(tuser, stripeid, parent);
            if (stripe_subscriptions.length == 0) {
                const usage = await Config.db.query<ResourceUsage>({ collectionname: "config", query: { customerid: billingid, _type: "resourceusage" }, jwt: rootjwt }, parent);
                for(let i = 0; i < 0; i++) {
                    await Resources.RemoveResourceUsage(tuser, jwt, usage[i]._id, parent);
                }
                // const count = await Config.db.DeleteMany({ "customerid": billingid, _type: "resourceusage" }, null, "config", null, false, rootjwt, parent);
                // if (count > 0) {
                //     Logger.instanse.info("Removed " + count + " resource usage records for Billing acount, since " + stripeid + " has no subscription", parent, { billingid, cls: "Payments", func: "PullBillingAccount" });
                // }
                return;
            }
            for (let i = 0; i < stripe_subscriptions.length; i++) {
                const sub = stripe_subscriptions[i];
                // @ts-ignore
                const status = sub.status;
                if (status == "active") continue;
                const usage = await Config.db.query<ResourceUsage>({ collectionname: "config", query: { "subid": sub.id, _type: "resourceusage"  }, jwt: rootjwt }, parent);
                for(let i = 0; i < 0; i++) {
                    await Resources.RemoveResourceUsage(tuser, jwt, usage[i]._id, parent);
                }
                // const count = await Config.db.DeleteMany({ "subid": sub.id, _type: "resourceusage" }, null, "config", null, false, rootjwt, parent);
                // if (count > 0) {
                //     Logger.instanse.info("Removed " + count + " resource usage records for Billing acount, since " + sub.id + " is no longer active (" + status + ")", parent, { billingid, cls: "Payments", func: "PullBillingAccount" });
                // }
            }

            // Add missing siid ( user just bough it )
            const usage = await Config.db.query<ResourceUsage>({ collectionname: "config", query: { customerid: billingid, _type: "resourceusage" }, jwt: rootjwt }, parent);
            for (let y = 0; y < stripe_subscriptions.length; y++) {
                const stripe_subscription = stripe_subscriptions[y];
                for (let i = 0; i < stripe_subscription.items.data.length; i++) {
                    const line_item = stripe_subscription.items.data[i];
                    const u = usage.find(x => x.siid == line_item.id);
                    if(u == null) {
                        const u = usage.find(x => x.product.stripeprice == line_item.price.id);
                        if(u != null && Util.IsNullEmpty(u.siid)) {
                            u.siid = line_item.id;
                            const target = await Resources.GetResourceTarget(tuser, jwt, u, parent);
                            if (target != null) {
                                await Resources.UpdateResourceTarget(tuser, jwt, u, target, false, parent);
                            }
                            await Config.db.UpdateOne(u, "config", 1, true, rootjwt, parent);

                        }
                    }
                }
            }
            // Remove products no longer in stripe
            for(let i = 0; i < usage.length; i++) {
                const u = usage[i];
                let line_item:stripe_subscription_item = null;
                for(let i = 0; i < stripe_subscriptions.length; i++) {
                    const sub = stripe_subscriptions[i];
                    line_item = sub.items.data.find(x => x.id == u.siid);
                    if(line_item != null) break;
                }
                if(line_item == null) {
                    await Config.db.DeleteOne(u._id, "config", false, rootjwt, parent);
                    let target = await Resources.GetResourceTarget(tuser, jwt, u, parent);
                    if (target != null) {
                        await Resources.UpdateResourceTarget(tuser, jwt, u, target, true, parent);
                    }
                }
            }


        } catch (error) {
            Logger.instanse.error(error, parent, { cls: "Payments", func: "PullBillingAccount" });
            throw new Error(Logger.enricherror(tuser, null, "Pull stripe billing account failed (" + error.message + ")"));
        }
    }
    public static async PushBillingAccount(tuser: User, jwt: string, billingid: string, parent: Span): Promise<void> {
        if (Util.IsNullEmpty(Config.stripe_api_secret)) return null;
        if(Util.IsNullEmpty(billingid)) return null;
        try {
            const rootjwt = Crypt.rootToken();
            const billingaccount = await Config.db.GetOne<Billing>({ collectionname: "users", query: { _id: billingid, _type: "customer" }, jwt }, parent);
            if (billingaccount == null) throw new Error(Logger.enricherror(tuser, null, "Billing account not found, or access denied"));
            if (Util.IsNullEmpty(billingaccount.stripeid)) {
                await this.CleanupPendingBillingAcountUsage(billingid, parent);
                throw new Error(Logger.enricherror(tuser, null, "Billing Account has no stripeid"));
            }
            const stripe_subscriptions = await this.GetSubscriptions(tuser, billingaccount.stripeid, parent);
            if (stripe_subscriptions.length == 0) {
                await this.CleanupPendingBillingAcountUsage(billingid, parent);
                throw new Error(Logger.enricherror(tuser, null, "Stripe customer " + billingaccount.stripeid + " has no stripe subscription"));
            }
            const usage = await Config.db.query<ResourceUsage>({ collectionname: "config", query: { customerid: billingid, _type: "resourceusage" }, jwt: rootjwt }, parent);
            const products = {};
            for (let i = 0; i < usage.length; i++) {
                const u = usage[i];
                const p = products[u.product.stripeprice];
                if (u.product.stripeprice == "price_1IzISoC2vUMc6gvhMtqTq2Ef") {
                    var b = true;
                }
                if (!Util.IsNullEmpty(u.subid)) {
                    const exists = stripe_subscriptions.find(x => x.id == u.subid);
                    if (exists == null) u.subid = null;
                }
                if (!Util.IsNullEmpty(u.siid)) {
                    const exists = stripe_subscriptions.find(x => x.items.data.find(d => d.id == u.siid));
                    if (exists == null) u.siid = null;
                    if (exists != null) {
                        u.subid = exists.id;
                        const target = await Resources.GetResourceTarget(tuser, jwt, u, parent);
                        if (target != null) {
                            await Resources.UpdateResourceTarget(tuser, jwt, u, target, false, parent);
                            await Config.db.UpdateOne(u, "config", 1, true, rootjwt, parent);
                        }                        
                    }
                }
                if (p == null) {
                    products[u.product.stripeprice] = { quantity: u.quantity, siid: u.siid, subid: u.subid };
                    if (u.product.assign == "metered") {
                        delete products[u.product.stripeprice].quantity;
                    }
                } else {
                    if (!Util.IsNullEmpty(p.quantity) && !Util.IsNullEmpty(u.quantity)) {
                        p.quantity += u.quantity;
                    }
                    if (!Util.IsNullEmpty(u.siid)) {
                        p.siid = u.siid;
                    }
                }
            }
            const default_sub = stripe_subscriptions.find(x => x.id == billingaccount.subid) ?? stripe_subscriptions[0];
            const prices = Object.keys(products);
            for (let i = 0; i < prices.length; i++) {
                const stripe_price = prices[i];
                const price = products[stripe_price];
                const subscription = stripe_subscriptions.find(x => x.id == price.subid) ?? default_sub;
                const line_item = subscription?.items.data.find(x => x.id == stripe_price || x.price.id == stripe_price);

                let payload: any = { proration_behavior: "always_invoice", price: stripe_price };
                if (!Util.IsNullEmpty(price.quantity)) {
                    payload.quantity = price.quantity;
                }
                let result: stripe_subscription_item = null;
                if (line_item == null) {
                    result = await Message.Stripe<stripe_subscription_item>("POST", "subscription_items", null, { ...payload, subscription: subscription.id }, billingaccount.stripeid);
                } else if (line_item.quantity != price.quantity) {
                    result = await Message.Stripe<stripe_subscription_item>("POST", "subscription_items", line_item.id, payload, billingaccount.stripeid);
                }
                if (result != null) {
                    for (let i = 0; i < usage.length; i++) {
                        const u = usage[i];
                        if (u.product.stripeprice == stripe_price && Util.IsNullEmpty(u.siid)) {
                            u.siid = result.id;
                            u.subid = subscription.id;
                            await Config.db.UpdateOne(u, "config", 1, true, rootjwt, parent);
                        }
                    }
                }
            }
            for (let y = 0; y < stripe_subscriptions.length; y++) {
                const stripe_subscription = stripe_subscriptions[y];
                for (let i = 0; i < stripe_subscription.items.data.length; i++) {
                    const line_item = stripe_subscription.items.data[i];
                    const exists = usage.find(x => x.product.stripeprice == line_item.price.id);
                    if (exists != null) continue;
                    if (stripe_subscription.items.total_count == 1) {
                        // keep the subscription alive by keeping at least one item in it
                        await Message.Stripe("POST", "subscription_items", line_item.id, { quantity: 0 }, billingaccount.stripeid);
                    } else {
                        let payload = null;
                        if (line_item?.price?.recurring?.usage_type == "metered") {
                            payload = { clear_usage: true };
                        }
                        try {
                            await Message.Stripe("DELETE", "subscription_items", line_item.id, payload, billingaccount.stripeid);
                        } catch (error) {
                            Logger.instanse.error(error, parent, { cls: "Payments", func: "PushBillingAccount", billingid });
                            await Message.Stripe("POST", "subscription_items", line_item.id, { quantity: 0 }, billingaccount.stripeid);
                        }
                    }
                }
            }
        } catch (error) {
            Logger.instanse.error(error, parent, { cls: "Payments", func: "UpdateSubscriptionLines" });
            throw new Error(Logger.enricherror(tuser, null, "Update stripe subscription lines failed (" + error.message + ")"));
        }
    }
 
}