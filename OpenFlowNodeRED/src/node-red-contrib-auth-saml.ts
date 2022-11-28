var xml2js = require('xml2js');
import * as fs from "fs";
import * as path from "path";
// import * as SAMLStrategy from "passport-saml";
import * as SAMLStrategy from "@node-saml/passport-saml";
import * as https from "https";
import { Logger, promiseRetry } from "./Logger";
import { Config } from "./Config";
import { FileSystemCache } from "./file-system-cache";
import { NoderedUtil } from "@openiap/openflow-api";

// tslint:disable-next-line: class-name
export class samlauthstrategyoptions {
    public callbackUrl: string = "auth/strategy/callback/";
    public entryPoint: string = "";
    public issuer: string = "";
    public audience: any = false;
    public cert: string = "";
    public signatureAlgorithm: string = "sha256";
    public callbackMethod: string = "POST";
    public verify: any;
    public acceptedClockSkewMs: number;
    public wantAuthnResponseSigned: boolean = false;
}
// tslint:disable-next-line: class-name
export class samlauthstrategy {

    public name: string = "saml";
    public label: string = "Sign in with SAML";
    public icon: string = "fa-microsoft";
    public strategy: any = SAMLStrategy.Strategy;
    public options: samlauthstrategyoptions = new samlauthstrategyoptions();
}
interface IVerifyFunction { (error: any, profile: any): void; }
// tslint:disable-next-line: class-name
export class noderedcontribauthsaml {
    public type: string = "strategy";
    public authenticate: any = null;
    public users: any = null;
    public strategy: samlauthstrategy = new samlauthstrategy();
    private _users: any = {};
    private customverify: any;
    public static async configure(baseURL: string, saml_federation_metadata: string, issuer: string, customverify: any, saml_ca: string,
        identityProviderUrl: string, saml_cert: string): Promise<noderedcontribauthsaml> {
        const result: noderedcontribauthsaml = new noderedcontribauthsaml(baseURL);
        result.strategy.options.wantAuthnResponseSigned = false;
        if (!NoderedUtil.IsNullEmpty(saml_cert) && !NoderedUtil.IsNullEmpty(identityProviderUrl)) {
            result.strategy.options.entryPoint = identityProviderUrl;
            result.strategy.options.cert = saml_cert;
            result.strategy.options.issuer = issuer;

        } else {
            if (NoderedUtil.IsNullEmpty(saml_federation_metadata)) {
                saml_federation_metadata = "http://localhost/issue/FederationMetadata/2007-06/FederationMetadata.xml";
            }

            const metadata: any = await Config.parse_federation_metadata(saml_ca, saml_federation_metadata);
            result.strategy.options.entryPoint = metadata.identityProviderUrl;
            result.strategy.options.cert = metadata.cert;
            result.strategy.options.issuer = issuer;
        }
        if (identityProviderUrl != null && identityProviderUrl != undefined && identityProviderUrl != "") {
            result.strategy.options.entryPoint = identityProviderUrl;
        }
        // result.strategy.options.acceptedClockSkewMs = -1;
        result.strategy.options.acceptedClockSkewMs = (1000 * 60) * 15; // 15 minutes, overkill ?
        result.customverify = customverify;
        return result;
    }
    constructor(baseURL: string) {
        this.strategy.options.callbackUrl = baseURL + "auth/strategy/callback/";
        // this.strategy.options.audience = baseURL;
        this.strategy.options.verify = (this.verify).bind(this);
        this.authenticate = (this._authenticate).bind(this);
        this.users = (this.fn_users).bind(this);
    }
    verify(profile: any, done: IVerifyFunction): void {
        const roles: string[] = profile["http://schemas.xmlsoap.org/claims/Group"];
        if (roles !== undefined) {
            if (roles.indexOf("nodered_users") !== -1 || roles.indexOf("nodered users") !== -1) { profile.permissions = "read"; }
            if (roles.indexOf("nodered_admins") !== -1 || roles.indexOf("nodered admins") !== -1) { profile.permissions = "*"; }
        } else {
            Logger.instanse.debug("auth", "verify", "User has no roles");
        }
        profile.username = profile.nameID;
        if (this.customverify !== null && this.customverify !== undefined) {
            this.customverify(profile, (newprofile) => {
                this._users[newprofile.nameID] = newprofile;
                if (profile.permissions === undefined || profile.permissions === null) {
                    Logger.instanse.error("auth", "verify", "Permission denied after doing custom verify");
                    return done("Permission denied", null);
                }
                done(null, newprofile);
            });
        } else {
            this._users[profile.nameID] = profile;
            if (profile.permissions === undefined || profile.permissions === null) {
                Logger.instanse.error("auth", "verify", "Permission denied (no custom verify)");
                return done("Permission denied", null);
            }
            done(null, profile);
        }
    }
    async _authenticate(profile: string | any, arg2: any): Promise<any> {
        let username: string = profile;
        if (profile.nameID) {
            username = profile.nameID;
        }
        return this.users(username);
    }
    async fn_users(username: string): Promise<any> {
        const user: any = this._users[username];
        return user;
    }
}
