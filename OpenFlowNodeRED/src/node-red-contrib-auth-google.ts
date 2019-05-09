import * as winston from "winston";
import * as GoogleStrategy from "passport-google-oauth20";
import { Config } from "./Config";

// tslint:disable-next-line: class-name
export class googleauthstrategyoptions {
    public clientID:string = Config.consumer_key;
    public clientSecret:string =  Config.consumer_secret;
    public callbackURL:string = "auth/strategy/callback/";
    public scope:string[] = ["profile", "email"];
    public verify:any;
}
// tslint:disable-next-line: class-name
export class googleauthstrategy {

    public name:string = "google";
    public label:string = "Sign in with GoogleID";
    public icon:string = "fa-google";
    public strategy:any = GoogleStrategy.Strategy;
    public options:googleauthstrategyoptions = new googleauthstrategyoptions();
}
interface IVerifyFunction { (error:any, profile:any): void; }
// tslint:disable-next-line: class-name
export class noderedcontribauthgoogle {

    private _logger: winston.Logger;
    public type:string = "strategy";
    public authenticate:any = null;
    public users:any = null;
    public strategy:googleauthstrategy = new googleauthstrategy();
    private _users: any = {};
    constructor(logger: winston.Logger, baseURL:string) {
        this._logger = logger;
        this.strategy.options.callbackURL = baseURL + "auth/strategy/callback/";
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
