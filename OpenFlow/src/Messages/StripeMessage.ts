export class stripe_base {
    public id: string;
    public object: string;
    public created: number;
    public livemode: boolean;
    public deleted: boolean;
}
export class StripeMessage implements IReplyMessage {
    public error: string;
    public jwt: any;
    public method: string;
    public object: string;
    public id: string;
    public customerid: string;
    public url: string;
    public payload: stripe_base;

    static assign(o: any): StripeMessage {
        if (typeof o === "string" || o instanceof String) {
            return Object.assign(new StripeMessage(), JSON.parse(o.toString()));
        }
        return Object.assign(new StripeMessage(), o);
    }
}
export class stripe_list<T> {
    public object: string;
    public has_more: boolean;
    public url: string;
    public data: T[];
}
export class stripe_customer extends stripe_base {
}
export class stripe_tax_id extends stripe_base {
}
export class stripe_subscription extends stripe_base {
    public address: string;
    public balance: number;
    public currency: string;
    public subscriptions: stripe_list<stripe_subscription>;
    public tax_ids: stripe_list<stripe_tax_id>;
}