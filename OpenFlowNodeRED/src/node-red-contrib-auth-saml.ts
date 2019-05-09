import * as winston from "winston";
import * as SAMLStrategy from "passport-saml";
import { Config } from "./Config";

// tslint:disable-next-line: class-name
export class samlauthstrategyoptions {
    public callbackUrl:string = "auth/strategy/callback/";
    public entryPoint:string = Config.saml_entrypoint;
    public issuer:string = Config.saml_issuer;
    public audience:string = null;
    public cert:string = Config.saml_crt;
    public signatureAlgorithm:string = "sha256";
    public callbackMethod:string = "POST";
    public verify:any;
}
// tslint:disable-next-line: class-name
export class samlauthstrategy {

    public name:string = "saml";
    public label:string = "Sign in with SAML";
    public icon:string = "fa-microsoft";
    public strategy:any = SAMLStrategy.Strategy;
    public options:samlauthstrategyoptions = new samlauthstrategyoptions();
}
interface IVerifyFunction { (error:any, profile:any): void; }
// tslint:disable-next-line: class-name
export class noderedcontribauthsaml {

    private _logger: winston.Logger;
    public type:string = "strategy";
    public authenticate:any = null;
    public users:any = null;
    public strategy:samlauthstrategy = new samlauthstrategy();
    private _users: any = {};
    public static async configure(logger: winston.Logger, baseURL:string):Promise<noderedcontribauthsaml> {
        var result:noderedcontribauthsaml = new noderedcontribauthsaml(logger, baseURL);
        if(Config.saml_federation_metadata !== null && Config.saml_federation_metadata !== undefined) {
            var metadata:any = await Config.parse_federation_metadata(Config.saml_federation_metadata);
            Config.saml_entrypoint = metadata.identityProviderUrl;
            Config.saml_crt = metadata.cert;
            result.strategy.options.entryPoint = metadata.identityProviderUrl;
            result.strategy.options.cert = metadata.cert;
        }
        return result;
    }
    constructor(logger: winston.Logger, baseURL:string) {
        this._logger = logger;
        this.strategy.options.callbackUrl = baseURL + "auth/strategy/callback/";
        // this.strategy.options.audience = baseURL;
        this.strategy.options.verify = (this.verify).bind(this);
        this.authenticate = (this._authenticate).bind(this);
        this.users = (this.fn_users).bind(this);
    }
    verify(profile:any, done:IVerifyFunction):void {
        this._logger.debug("verify: " + profile.nameID);
        var roles:string[] = profile["http://schemas.xmlsoap.org/claims/Group"];
        if(roles!==undefined) {
            if(roles.indexOf("nodered_users")!==-1 || roles.indexOf("nodered users")!==-1) { profile.permissions = "read"; }
            if(roles.indexOf("nodered_admins")!==-1 || roles.indexOf("nodered admins")!==-1) { profile.permissions = "*"; }
        }
        if(profile.permissions === undefined || profile.permissions === null) {
            return done("Permission denied",null);
        }
        profile.username = profile.nameID;
        this._users[profile.nameID] = profile;
        done(null,profile);
    }
    async _authenticate(profile:string | any, arg2:any):Promise<any> {
        var username:string = profile;
        if (profile.nameID) {
            username = profile.nameID;
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
