import * as winston from "winston";
import * as openidStrategy from "passport-openid-connect";
import { Config } from "./Config";

// tslint:disable-next-line: class-name
export class openidauthstrategyoptions {
    public issuerHost:string = Config.baseurl();
    public client_id:string = Config.consumer_key;
    public client_secret:string = Config.consumer_secret;
    public redirect_uri:string = "auth/strategy/callback/";
    public scope:string = "groups openid userid email profile";
    public verify:any;
}
// tslint:disable-next-line: class-name
export class openidauthstrategy {
    public name:string = "passport-openid-connect";
    public label:string = "Sign in with openID";
    public icon:string = "fa-openid";
    public strategy:any = openidStrategy.Strategy;
    public options:openidauthstrategyoptions = new openidauthstrategyoptions();
}
interface IVerifyFunction { (error:any, profile:any): void; }
// tslint:disable-next-line: class-name
export class noderedcontribauthopenid {
    private _logger: winston.Logger;
    public type:string = "strategy";
    public authenticate:any = null;
    public users:any = null;
    public strategy:openidauthstrategy = new openidauthstrategy();
    private _users: any = {};
    constructor(logger: winston.Logger, baseURL:string) {
        this._logger = logger;
        this.strategy.options.redirect_uri = baseURL + "auth/strategy/callback/";

        this.strategy.options.verify = (this.verify).bind(this);
        this.authenticate = (this._authenticate).bind(this);
        this.users = (this.fn_users).bind(this);
    }
    verify(token:string, tokenSecret:string, profile:any, done:IVerifyFunction):void {
        if(profile.emails) {
            var email:any = profile.emails[0];
            profile.username = email.value;
        }
        this._logger.debug("verify: " + profile.username);
        this._users[profile.username] = profile;
        done(null,profile);
    }
    async _authenticate(profile:string | any, arg2:any):Promise<any> {
        var username:string = profile;
        if(profile.emails) {
            var email:any = profile.emails[0];
            profile.username = email.value;
        }
        if (profile.username) {
            username = profile.username;
        }
        this._logger.debug("authenticate: " + username);
        return this.users(username);
    }
    async fn_users(username:string):Promise<any> {
        var user:any = this._users[username];
        // this._logger.silly("users: looking up " + username);
        return user;
    }
}
