// import { Base } from "../base";

// export class Billing extends Base {
//     public stripeid: string;
//     public userid: string;
//     public name: string;
//     public email: string;
//     public address: string;
//     public vattype: string;
//     public vatnumber: string;
//     public taxrate: string;
//     public tax: number;
//     public hascard: boolean;
//     public coupon: string;
//     public memory: string;
//     public openflowuserplan: string;
//     public supportplan: string;
//     public supporthourplan: string;
//     constructor() {
//         super();
//         this._type = "billing";
//         this.hascard = false;
//     }
// }

// export class EnsureStripeCustomerMessage implements IReplyMessage {
//     public error: string;
//     public jwt: string;

//     public userid: string;
//     public billing: Billing;
//     public customer: stripe_customer;
//     static assign(o: any): EnsureStripeCustomerMessage {
//         if (typeof o === "string" || o instanceof String) {
//             return Object.assign(new EnsureStripeCustomerMessage(), JSON.parse(o.toString()));
//         }
//         return Object.assign(new EnsureStripeCustomerMessage(), o);
//     }
// }

// export class StripeCancelPlanMessage implements IReplyMessage {
//     public error: string;
//     public jwt: string;

//     public userid: string;
//     public planid: string;
//     public customer: stripe_customer;
//     static assign(o: any): StripeCancelPlanMessage {
//         if (typeof o === "string" || o instanceof String) {
//             return Object.assign(new StripeCancelPlanMessage(), JSON.parse(o.toString()));
//         }
//         return Object.assign(new StripeCancelPlanMessage(), o);
//     }
// }
// export class StripeAddPlanMessage implements IReplyMessage {
//     public error: string;
//     public jwt: string;

//     public userid: string;
//     public planid: string;
//     public subplanid: string;
//     public customer: stripe_customer;
//     public checkout: stripe_checkout_session;
//     static assign(o: any): StripeAddPlanMessage {
//         if (typeof o === "string" || o instanceof String) {
//             return Object.assign(new StripeAddPlanMessage(), JSON.parse(o.toString()));
//         }
//         return Object.assign(new StripeAddPlanMessage(), o);
//     }
// }

// export class stripe_base {
//     public id: string;
//     public object: string;
//     public created: number;
//     public livemode: boolean;
//     public metadata: { [key: string]: any };
// }
// export class StripeMessage implements IReplyMessage {
//     public error: string;
//     public jwt: any;
//     public method: string;
//     public object: string;
//     public id: string;
//     public customerid: string;
//     public url: string;
//     public payload: stripe_base;

//     static assign(o: any): StripeMessage {
//         if (typeof o === "string" || o instanceof String) {
//             return Object.assign(new StripeMessage(), JSON.parse(o.toString()));
//         }
//         return Object.assign(new StripeMessage(), o);
//     }
// }
// export class stripeplan {
//     public id: string;
//     public name: string;
//     public price: number;
//     public subtitle: string;
//     public text: string;
//     public subplan: stripeplan;
// }
// export class stripe_list<T> {
//     public object: string;
//     public has_more: boolean;
//     public total_count: number;
//     public url: string;
//     public data: T[];
// }
// export class tax_info {
//     public tax_id: string;
//     public type: string;
// }
// export class tax_info_verification {
//     public status: string;
//     public verified_name: string;
// }
// export class stripe_plan extends stripe_base {
//     public status: boolean;
//     public nickname: string;
//     public product: string;
//     public amount: number;
//     public usage_type: string;
// }
// export class stripe_subscription_data {
//     public items: stripe_subscription_item[];
// }
// export class stripe_checkout_session extends stripe_base {
//     public success_url: string;
//     public cancel_url: string;
//     public payment_method_types: string[] = ["card"];
//     public customer: string;
//     public mode: string = "subscription";
//     public subscription_data: stripe_subscription_data;
// }

// export class stripe_coupon extends stripe_base {
//     public duration: string;
//     public duration_in_months: number;
//     public name: string;
//     //public duration: string;
// }
// export class stripe_customer_discount extends stripe_base {
//     public subscription: string;
//     public start: number;
//     public customer: string;
//     public coupon: stripe_coupon;
// }
// export class stripe_customer extends stripe_base {
//     public description: string;
//     public name: string;
//     public email: string;
//     public tax_ids: stripe_list<stripe_tax_id>;
//     public subscriptions: stripe_list<stripe_subscription>;
//     public discount: stripe_customer_discount;
//     // deprecated tax_info and tax_info_verification 
//     // public tax_info: tax_info;
//     // public tax_info_verification: tax_info_verification;
// }
// export class stripe_tax_verification {
//     public status: string;
//     public verified_address: string;
//     public verified_name: string;
// }
// export class stripe_tax_id extends stripe_base {
//     public country: string;
//     public customer: string;
//     public type: string;
//     public value: string;
//     public verification: stripe_tax_verification;
// }
// export class stripe_subscription_item extends stripe_base {
//     public id: string;
//     public quantity: number;
//     public subscription: string;
//     public plan: stripe_plan;
//     public tax_rates: string;
// }
// export class stripe_subscription extends stripe_base {
//     // public plan: stripe_plan;
//     public plan: stripe_plan;
//     public address: string;
//     public balance: number;
//     public currency: string;
//     public subscriptions: stripe_list<stripe_subscription>;
//     public tax_ids: stripe_list<stripe_tax_id>;
//     public items: stripe_list<stripe_subscription_item>;
//     public default_tax_rates: string[];
// }