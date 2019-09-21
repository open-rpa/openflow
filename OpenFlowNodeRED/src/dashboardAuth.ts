import * as express from "express";
import * as passport from "passport";
import * as SAMLStrategy from "passport-saml";
import * as url from "url";
import * as winston from "winston";
import * as bodyParser from "body-parser";
import { Config } from "./Config";

interface IVerifyFunction { (error: any, profile: any): void; }
export class Provider {
    public provider: string = "";
    public id: string = "";
    public name: string = "";
    public issuer: string = "";
    public saml_federation_metadata: string = "";
    public consumerKey: string;
    public consumerSecret: string;
}

// tslint:disable-next-line: class-name
export class samlauthstrategyoptions {
    public callbackUrl: string = "auth/strategy/callback/";
    public logoutUrl: string = "";
    public entryPoint: string = "";
    public issuer: string = "";
    public cert: string = null;

    public audience: string = null;
    public signatureAlgorithm: string = "sha256";
    public callbackMethod: string = "POST";
    public verify: any;
}

export class dashboardAuth {
    private static _logger: winston.Logger;
    private static samlStrategy: any;

    static async samlverify(profile: any, done: IVerifyFunction): Promise<void> {
        if (profile !== null && profile !== undefined) {
            profile.token2 = profile.getAssertionXml();
        }
        done(null, profile);
    }

    static async RegisterProvider(app: express.Express, baseurl: string) {
        var metadata: any = await Config.parse_federation_metadata(Config.saml_federation_metadata);
        this.samlStrategy = dashboardAuth.CreateSAMLStrategy(app, "uisaml", metadata.cert,
            metadata.identityProviderUrl, Config.saml_issuer, baseurl);
    }

    static async CreateSAMLStrategy(app: express.Express, key: string, cert: string, singin_url: string, issuer: string, baseurl: string): Promise<passport.Strategy> {
        var strategy: passport.Strategy = null;
        var options: samlauthstrategyoptions = new samlauthstrategyoptions();
        options.entryPoint = singin_url;
        options.cert = cert;
        options.issuer = issuer;
        (options as any).acceptedClockSkewMs = 5000;
        options.callbackUrl = url.parse(baseurl).protocol + "//" + url.parse(baseurl).host + "/uisaml/";
        options.logoutUrl = url.parse(singin_url).protocol + "//" + url.parse(singin_url).host + "/logout/";
        options.verify = (dashboardAuth.samlverify).bind(this);
        strategy = new SAMLStrategy.Strategy(options, options.verify);
        passport.use(key, strategy);
        strategy.name = key;
        // this._logger.info(options.callbackUrl);

        app.post("/uisaml/", passport.authenticate(key, {
            successRedirect: '/ui/',
            failureRedirect: '/uisaml/',
            failureFlash: false
        }));
        app.use("/uisaml/", passport.authenticate(key, {
            successRedirect: '/ui/',
            failureRedirect: '/uisaml/',
            failureFlash: false
        }));
        return strategy;
    }
}