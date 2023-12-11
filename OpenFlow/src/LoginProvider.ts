import * as url from "url";
import * as express from "express";
import * as path from "path";
import * as OpenIDConnectStrategy from "passport-openidconnect";
import * as GoogleStrategy from "passport-google-oauth20";
import * as LocalStrategy from "passport-local";
import * as passport from "passport";
import { Config } from "./Config";
import { Crypt } from "./Crypt";
import { Audit } from "./Audit";
import * as saml from "saml20";
import { GridFSBucket, ObjectId } from "mongodb";
import { Base, User, NoderedUtil, TokenUser, Role, FederationId } from "@openiap/openflow-api";
import { Span } from "@opentelemetry/api";
import { Logger } from "./Logger";
import { DatabaseConnection } from "./DatabaseConnection";
import { TokenRequest } from "./TokenRequest";
import { WebServer } from "./WebServer";
var nodemailer = require('nodemailer');
var dns = require('dns');
const got = require("got");
const safeObjectID = (s: string | number | ObjectId) => ObjectId.isValid(s) ? new ObjectId(s) : null;

interface IVerifyFunction { (error: any, profile: any): void; }
export class Provider extends Base {
    constructor() {
        super();
        this._type = "provider";
    }
    public provider: string = "";
    public id: string = "";
    public name: string = "";
    public issuer: string = "";
    public saml_federation_metadata: string = "";
    public consumerKey: string;
    public consumerSecret: string;
    public saml_signout_url: string;
}
// tslint:disable-next-line: class-name
export class googleauthstrategyoptions {
    public clientID: string = "";
    public clientSecret: string = "";
    public callbackURL: string = "auth/strategy/callback/";
    public scope: string[] = ["profile", "email"];
    public verify: any;
}
// tslint:disable-next-line: class-name
export class samlauthstrategyoptions {
    public callbackUrl: string = "auth/strategy/callback/";
    public entryPoint: string = "";
    public issuer: string = "";
    public cert: string = null;
    public disableRequestedAuthnContext: boolean = false;

    public audience: any = false;
    public signatureAlgorithm: 'sha1' | 'sha256' | 'sha512' = "sha256";
    public callbackMethod: string = "POST";
    public verify: any;
    public wantAuthnResponseSigned: boolean = false;
}
export class LoginProvider {
    public static _providers: any = {};
    // public static login_providers: Provider[] = [];

    public static remoteip(req: express.Request) {
        let remoteip: string = req.socket.remoteAddress;
        if (req.headers["X-Forwarded-For"] != null) remoteip = req.headers["X-Forwarded-For"] as string;
        if (req.headers["X-real-IP"] != null) remoteip = req.headers["X-real-IP"] as string;
        if (req.headers["x-forwarded-for"] != null) remoteip = req.headers["x-forwarded-for"] as string;
        if (req.headers["x-real-ip"] != null) remoteip = req.headers["x-real-ip"] as string;
        return remoteip;
    }
    public static escape(s: string): string {
        let lookup: any = {
            '&': "&amp;",
            '"': "&quot;",
            '<': "&lt;",
            '>': "&gt;"
        };
        return s.replace(/[&"<>]/g, (c) => lookup[c]);
    }
    public static redirect(res: any, originalUrl: string) {
        res.write('<!DOCTYPE html>');
        res.write('<body>');
        res.write('<script>top.location = "' + LoginProvider.escape(originalUrl) + '";</script>');
        res.write('</body>');
        res.write('</html>');
        res.end();
    }
    static async validateToken(rawAssertion: string, parent: Span): Promise<User> {
        const span: Span = Logger.otel.startSubSpan("LoginProvider.validateToken", parent);
        return new Promise<User>((resolve, reject) => {
            try {
                const options = {
                    publicKey: Buffer.from(Config.signing_crt, "base64").toString("ascii")
                }
                Logger.instanse.verbose("saml.validate", span, {cls: "LoginProvider", func: "validateToken"});
                saml.validate(rawAssertion, options, async (err, profile) => {
                    const span: Span = Logger.otel.startSpan("saml.validate", null, null);
                    try {
                        if (err) {
                            Logger.instanse.error(err, span, {cls: "LoginProvider", func: "validateToken"});
                            return reject(err);
                        }
                        const claims = profile.claims; // Array of user attributes;
                        const username = claims["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier"] ||
                            claims["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"] ||
                            claims["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"];

                        Logger.instanse.verbose("lookup " + username, span, {cls: "LoginProvider", func: "validateToken"});
                        const user = await Logger.DBHelper.FindByUsername(username, null, span);
                        if (user) {
                            Logger.instanse.debug("succesfull", span, {cls: "LoginProvider", func: "validateToken"});
                            resolve(user);
                        } else {
                            Logger.instanse.error(new Error("Unknown user"), span, {cls: "LoginProvider", func: "validateToken"});
                            reject("Unknown user");
                        }
                    } catch (error) {
                        Logger.instanse.error(error, span, {cls: "LoginProvider", func: "validateToken"});
                        reject(error);
                    } finally {
                        Logger.otel.endSpan(span);
                    }

                });
            } catch (error) {
                Logger.instanse.error(error, span, {cls: "LoginProvider", func: "validateToken"});
            } finally {
                Logger.otel.endSpan(span);
            }
        });
    }
    static async configure(app: express.Express, baseurl: string, parent: Span): Promise<void> {
        app.use(passport.initialize());
        app.use(passport.session());
        passport.serializeUser(async function (user: any, done: any): Promise<void> {
            const tuser: TokenUser = TokenUser.From(user);
            // await Auth.AddUser(tuser as any, tuser._id, "passport");
            done(null, user._id);
        });
        passport.deserializeUser(async function (userid: string, done: any): Promise<void> {
            Logger.instanse.silly("userid " + userid, null, {cls: "LoginProvider", func: "deserializeUser"});
            if (NoderedUtil.IsNullEmpty(userid)) return done('missing userid', null);
            if (typeof userid !== 'string') userid = (userid as any)._id
            if (NoderedUtil.IsNullEmpty(userid)) return done('missing userid', null);
            const _user = await Logger.DBHelper.FindById(userid, null);
            if (_user == null) {
                Logger.instanse.error("Failed locating user " + userid, null, {cls: "LoginProvider", func: "deserializeUser"});
                done(null, null);
            } else {
                Logger.instanse.verbose("found user " + userid + " " + _user.name, null, {cls: "LoginProvider", func: "deserializeUser"});
                done(null, _user);
            }
            // const _user = await Auth.getUser(userid, "passport");
            // if (_user == null) {
            //     const user = await DBHelper.FindById(userid, null, null);
            //     if (user != null) {
            //         const tuser = TokenUser.From(user);
            //         await Auth.AddUser(tuser as any, tuser._id, "passport");
            //         done(null, tuser);
            //     } else {
            //         done(null, null);
            //     }

            // } else {
            //     done(null, _user);
            // }
        });
        app.get("/dashboardauth", LoginProvider.get_dashboardauth.bind(this));
        app.get("/Signout", LoginProvider.get_Signout.bind(this));
        app.get("/PassiveSignout", LoginProvider.get_PassiveSignout.bind(this));
        await LoginProvider.RegisterProviders(app, baseurl, parent);
        app.get("/user", LoginProvider.get_user.bind(this));
        app.get("/jwt", LoginProvider.get_jwt.bind(this));
        app.get("/jwtlong", LoginProvider.get_jwtlong.bind(this));
        app.post("/jwt", LoginProvider.post_jwt.bind(this));
        app.get("/config", LoginProvider.get_config.bind(this));
        app.post("/AddTokenRequest", LoginProvider.post_AddTokenRequest.bind(this));
        app.get("/GetTokenRequest", LoginProvider.get_GetTokenRequest.bind(this));
        app.get("/login", LoginProvider.get_login.bind(this));
        app.get("/validateuserform", LoginProvider.get_validateuserform.bind(this));
        app.get("/read/:id", LoginProvider.get_read.bind(this));
        app.post("/validateuserform", LoginProvider.post_validateuserform.bind(this));
        app.post("/forgotpassword", LoginProvider.post_forgotpassword.bind(this));
        app.get("/loginproviders", LoginProvider.get_loginproviders.bind(this));
        app.get("/download/:id", LoginProvider.get_download.bind(this));
    }
    static async RegisterProviders(app: express.Express, baseurl: string, parent: Span) {
        const span: Span = Logger.otel.startSubSpan("LoginProvider.RegisterProviders", parent);
        try {
            let hasLocal: boolean = false;
            var providers = await Logger.DBHelper.GetProviders(span);
            if (providers.length === 0) { hasLocal = true; }
            providers.forEach(async (provider) => {
                try {
                    if (NoderedUtil.IsNullUndefinded(LoginProvider._providers[provider.id])) {
                        if (provider.provider === "saml") {
                            const metadata: any = await Config.parse_federation_metadata(Config.tls_ca, provider.saml_federation_metadata);
                            LoginProvider._providers[provider.id] =
                                LoginProvider.CreateSAMLStrategy(app, provider.id, metadata.cert,
                                    metadata.identityProviderUrl, provider.issuer, baseurl, span);
                        }
                        if (provider.provider === "google") {
                            LoginProvider._providers[provider.id] =
                                LoginProvider.CreateGoogleStrategy(app, provider.id, provider.consumerKey, provider.consumerSecret, baseurl, span);
                        }
                        if (provider.provider === "oidc") {
                            await LoginProvider.CreateOpenIDStrategy(app, provider.saml_federation_metadata, provider.id,
                                provider.consumerKey, provider.consumerSecret, baseurl, span);
                        }

                    }
                    if (provider.provider === "local") { hasLocal = true; }
                } catch (error) {
                    Logger.instanse.error(error, span, {cls: "LoginProvider", func: "RegisterProviders"});
                }
            });
            if (hasLocal === true) {
                if (NoderedUtil.IsNullUndefinded(LoginProvider._providers.local)) {
                    LoginProvider._providers.local = LoginProvider.CreateLocalStrategy(app, baseurl);
                }
            }
            const keys = Object.keys(LoginProvider._providers);
            for (var i = 0; i < keys.length; i++) {
                let key = keys[i];
                var exists = providers.filter(x => x.id == key || (key == 'local' && x.provider == 'local'));
                if (exists.length == 0) {
                    Logger.instanse.debug("[loginprovider] Removing passport strategy " + key, span, {cls: "LoginProvider", func: "RegisterProviders"});
                    passport.unuse(key);
                }
            }
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    // https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration
    // https://login.microsoftonline.com/aa8306d8-5417-43cc-b8e8-7e77b918682c/v2.0/.well-known/openid-configuration

    // https://docs.microsoft.com/en-us/azure/active-directory/develop/v2-protocols-oidc
    // common - Users with both a personal Microsoft account and a work or school account from Azure AD can sign in to the application.
    // organizations - Only users with work or school accounts from Azure AD can sign in to the application
    // consumers - Only users with a personal Microsoft account can sign in to the application
    // aa8306d8-5417-43cc-b8e8-7e77b918682c - Only users from a specific Azure AD tenant
    // 9188040d-6c67-4c5b-b112-36a304b66dad = consumers tenant

    // https://login.microsoftonline.com/consumers/v2.0/.well-known/openid-configuration


    static async CreateOpenIDStrategy(app: express.Express, discoveryurl: string, key: string, clientID: string, clientSecret: string, baseurl: string, span: Span): Promise<any> {
        Logger.instanse.debug("Adding new google strategy " + key, span, {cls: "LoginProvider", func: "CreateOpenIDStrategy"});
        const response = await got.get(discoveryurl, options);
        const document = JSON.parse(response.body);
        var options = {
            issuer: document.issuer,
            authorizationURL: document.authorization_endpoint,
            tokenURL: document.token_endpoint,
            userInfoURL: document.userinfo_endpoint,
            clientID: clientID,
            clientSecret: clientSecret,
            callbackURL: url.parse(baseurl).protocol + "//" + url.parse(baseurl).host + "/" + key + "/",
            verify: (LoginProvider.openidverify).bind(this),
            scope: "email profile"
        }
        // Microsoft Graph: openid, email, profile, and offline_access. The address and phone. OpenID Connect scopes aren't supported
        // https://docs.microsoft.com/en-us/azure/active-directory/develop/v2-permissions-and-consent
        const strategy: passport.Strategy = new OpenIDConnectStrategy.Strategy(options, options.verify);
        passport.use(key, strategy);
        strategy.name = key;
        app.use("/" + key,
            express.urlencoded({ extended: false }),
            passport.authenticate(key, { failureRedirect: "/" + key, failureFlash: true }),
            function (req: any, res: any, next: any): void {
                const span: Span = Logger.otel.startSpanExpress("OpenIDStrategy", req);
                try {
                    if(req.user != null) {
                        // @ts-ignore
                        if (!NoderedUtil.IsNullEmpty(Config.validate_user_form) && req.user.validated == false) {
                            res.redirect("/login");
                            return next();
                        }
                    }
                    const originalUrl: any = req.cookies.originalUrl;
                    try {
                        res.cookie("provider", key, { maxAge: 900000, httpOnly: true });    
                    } catch (error) {                        
                    }
                    
                    if (!NoderedUtil.IsNullEmpty(originalUrl)) {
                        try {
                            res.cookie("originalUrl", "", { expires: new Date(0) });    
                        } catch (error) {                            
                        }                        
                        LoginProvider.redirect(res, originalUrl);
                    } else {
                        res.redirect("/");
                    }
                } catch (error) {
                    Logger.instanse.error(error, span, {cls: "LoginProvider", func: "CreateOpenIDStrategy"});
                    return res.status(500).send({ message: error.message ? error.message : error });
                } finally {
                    Logger.otel.endSpan(span);
                }
            }
        );
        return strategy;
    }
    static CreateGoogleStrategy(app: express.Express, key: string, consumerKey: string, consumerSecret: string, baseurl: string, span: Span): any {
        Logger.instanse.debug("Adding new google strategy " + key, span, {cls: "LoginProvider", func: "CreateGoogleStrategy"});
        const options: googleauthstrategyoptions = new googleauthstrategyoptions();
        options.clientID = consumerKey;
        options.clientSecret = consumerSecret;
        options.callbackURL = url.parse(baseurl).protocol + "//" + url.parse(baseurl).host + "/" + key + "/";
        (options as any).passReqToCallback = true;
        options.verify = (LoginProvider.googleverify).bind(this);
        const strategy: passport.Strategy = new GoogleStrategy.Strategy(options, options.verify);
        passport.use(key, strategy);
        strategy.name = key;
        app.use("/" + key,
            express.urlencoded({ extended: false }),
            passport.authenticate(key, { failureRedirect: "/" + key, failureFlash: true }),
            function (req: any, res: any, next: any): void {
                const span: Span = Logger.otel.startSpanExpress("GoogleStrategy", req);
                try {
                    if(req.user != null) {
                        // @ts-ignore
                        if (!NoderedUtil.IsNullEmpty(Config.validate_user_form) && req.user.validated == false) {
                            res.redirect("/login");
                            return next();
                        }
                    }
                    const originalUrl: any = req.cookies.originalUrl;
                    try {
                        res.cookie("provider", key, { maxAge: 900000, httpOnly: true });    
                    } catch (error) {                        
                    }
                    
                    if (!NoderedUtil.IsNullEmpty(originalUrl)) {
                        try {
                            res.cookie("originalUrl", "", { expires: new Date(0) });    
                        } catch (error) {                            
                        }                        
                        LoginProvider.redirect(res, originalUrl);
                    } else {
                        res.redirect("/");
                    }
                } catch (error) {
                    Logger.instanse.error(error, span, {cls: "LoginProvider", func: "CreateGoogleStrategy"});
                    return res.status(500).send({ message: error.message ? error.message : error });
                } finally {
                    Logger.otel.endSpan(span);
                }
            }
        );
        return strategy;
    }

    // tslint:disable-next-line: max-line-length
    static CreateSAMLStrategy(app: express.Express, key: string, cert: string, singin_url: string, issuer: string, baseurl: string, span: Span): passport.Strategy {
        Logger.instanse.debug("Adding new SAML strategy " + key, span, {cls: "LoginProvider", func: "CreateSAMLStrategy"});
        const options: samlauthstrategyoptions = new samlauthstrategyoptions();
        (options as any).passReqToCallback = true;
        options.entryPoint = singin_url;
        options.cert = cert;
        options.issuer = issuer;
        options.disableRequestedAuthnContext = true;
        options.callbackUrl = url.parse(baseurl).protocol + "//" + url.parse(baseurl).host + "/" + key + "/";
        options.verify = (LoginProvider.samlverify).bind(this);
        options.wantAuthnResponseSigned = false;
        const SamlStrategy = require('@node-saml/passport-saml').Strategy
        const strategy: passport.Strategy = new SamlStrategy(options, options.verify);
        passport.use(key, strategy);
        strategy.name = key;

        // app.get("/" + key + "/FederationMetadata/2007-06/FederationMetadata.xml",
        //     wsfed.metadata({
        //         cert: Buffer.from(Config.signing_crt, "base64").toString("ascii"),
        //         issuer: issuer
        //     }));
        const CertPEM = Buffer.from(Config.signing_crt, "base64").toString("ascii").replace(/(-----(BEGIN|END) CERTIFICATE-----|\n)/g, '');
        app.get("/" + key + "/FederationMetadata/2007-06/FederationMetadata.xml",
            (req: express.Request, res: express.Response, next: express.NextFunction) => {
                const span: Span = Logger.otel.startSpanExpress("FederationMetadata", req);
                try {
                    res.set("Content-Type", "text/xml");
                    res.send(`
                        <EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="` + issuer + `">
                        <RoleDescriptor xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:fed="http://docs.oasis-open.org/wsfed/federation/200706" xsi:type="fed:SecurityTokenServiceType" protocolSupportEnumeration="http://docs.oasis-open.org/wsfed/federation/200706" 
                        ServiceDisplayName="` + issuer + `">
                        <KeyDescriptor use="signing">
                        <KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#">
                        <X509Data>
                        <X509Certificate>` + CertPEM + `</X509Certificate>
                        </X509Data>
                        </KeyInfo>
                        </KeyDescriptor>
                        <fed:TokenTypesOffered>
                        <fed:TokenType Uri="urn:oasis:names:tc:SAML:2.0:assertion"/>
                        <fed:TokenType Uri="urn:oasis:names:tc:SAML:1.0:assertion"/>
                        </fed:TokenTypesOffered>
                        <fed:ClaimTypesOffered>
                        <auth:ClaimType xmlns:auth="http://docs.oasis-open.org/wsfed/authorization/200706" Uri="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress" Optional="true">
                        <auth:DisplayName>E-Mail Address</auth:DisplayName>
                        <auth:Description>The e-mail address of the user</auth:Description>
                        </auth:ClaimType>
                        <auth:ClaimType xmlns:auth="http://docs.oasis-open.org/wsfed/authorization/200706" Uri="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname" Optional="true">
                        <auth:DisplayName>Given Name</auth:DisplayName>
                        <auth:Description>The given name of the user</auth:Description>
                        </auth:ClaimType>
                        <auth:ClaimType xmlns:auth="http://docs.oasis-open.org/wsfed/authorization/200706" Uri="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name" Optional="true">
                        <auth:DisplayName>Name</auth:DisplayName>
                        <auth:Description>The unique name of the user</auth:Description>
                        </auth:ClaimType>
                        <auth:ClaimType xmlns:auth="http://docs.oasis-open.org/wsfed/authorization/200706" Uri="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname" Optional="true">
                        <auth:DisplayName>Surname</auth:DisplayName>
                        <auth:Description>The surname of the user</auth:Description>
                        </auth:ClaimType>
                        <auth:ClaimType xmlns:auth="http://docs.oasis-open.org/wsfed/authorization/200706" Uri="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier" Optional="true">
                        <auth:DisplayName>Name ID</auth:DisplayName>
                        <auth:Description>The SAML name identifier of the user</auth:Description>
                        </auth:ClaimType>
                        </fed:ClaimTypesOffered>originalUrl
                        <fed:PassiveRequestorEndpoint>
                        <EndpointReference xmlns="http://www.w3.org/2005/08/addressing">
                        <Address>` + options.callbackUrl + `</Address>
                        </EndpointReference>
                        </fed:PassiveRequestorEndpoint>
                        </RoleDescriptor>
                        </EntityDescriptor>
                        `);

                } catch (error) {
                    Logger.instanse.error(error, span, {cls: "LoginProvider", func: "CreateSAMLStrategy"});
                    return res.status(500).send({ message: error.message ? error.message : error });
                } finally {
                    Logger.otel.endSpan(span);
                }
            });
        app.use("/" + key,
            express.urlencoded({ extended: false }),
            passport.authenticate(key, { failureRedirect: "/" + key, failureFlash: true }),
            function (req: express.Request, res: express.Response, next: express.NextFunction): void {
                const span: Span = Logger.otel.startSpanExpress("SAML" + key, req);
                try {
                    if(req.user != null) {
                        // @ts-ignore
                        if (!NoderedUtil.IsNullEmpty(Config.validate_user_form) && req.user.validated == false) {
                            res.redirect("/login");
                            return next();
                        }
                    }
                    const originalUrl: any = req.cookies.originalUrl;
                    try {
                        res.cookie("provider", key, { maxAge: 900000, httpOnly: true });    
                    } catch (error) {                        
                    }
                    
                    if (!NoderedUtil.IsNullEmpty(originalUrl)) {
                        try {
                            res.cookie("originalUrl", "", { expires: new Date(0) });    
                        } catch (error) {                            
                        }                        
                        LoginProvider.redirect(res, originalUrl);
                    } else {
                        res.redirect("/");
                    }
                } catch (error) {
                    Logger.instanse.error(error, span, {cls: "LoginProvider", func: "CreateSAMLStrategy"});
                    // @ts-ignore
                    return res.status(500).send({ message: error.message ? error.message : error });
                } finally {
                    Logger.otel.endSpan(span);
                }
            }
        );

        return strategy;
    }

    static CreateLocalStrategy(app: express.Express, baseurl: string): passport.Strategy {
        const strategy: passport.Strategy = new LocalStrategy({ passReqToCallback: true }, async (req: any, username: string, password: string, done: any): Promise<void> => {
            const span: Span = Logger.otel.startSpanExpress("LoginProvider.LocalLogin", req);
            Logger.instanse.debug("Adding new local strategy", span, {cls: "LoginProvider", func: "CreateLocalStrategy"});
            try {
                let remoteip: string = "";
                if (!NoderedUtil.IsNullUndefinded(req)) {
                    remoteip = LoginProvider.remoteip(req);
                }
                span?.setAttribute("remoteip", remoteip);
                if (username !== null && username != undefined) { username = username.toLowerCase(); }
                let user: User = null;
                var providers = await Logger.DBHelper.GetProviders(span);
                if (providers.length === 0 || NoderedUtil.IsNullEmpty(providers[0]._id)) {
                    user = await Logger.DBHelper.FindByUsername(username, null, span);
                    if (user == null) {
                        Logger.instanse.info("No login providers, creating " + username + " as admin", span, {cls: "LoginProvider", func: "CreateLocalStrategy"});
                        user = new User(); user.name = username; user.username = username;
                        await Crypt.SetPassword(user, password, span);
                        const jwt: string = Crypt.rootToken();
                        user = await Logger.DBHelper.EnsureUser(jwt, user.name, user.username, null, password, null, span);

                        const admins: Role = await Logger.DBHelper.FindRoleByName("admins", null, span);
                        if (admins == null) throw new Error("Failed locating admins role!")
                        admins.AddMember(user);
                        await Logger.DBHelper.Save(admins, Crypt.rootToken(), span)
                    } else {
                        if (!(await Crypt.ValidatePassword(user, password, span))) {
                            Logger.instanse.error("No login providers, login for " + username + " failed", span, {cls: "LoginProvider", func: "CreateLocalStrategy"});
                            await Audit.LoginFailed(username, "weblogin", "local", remoteip, "browser", "unknown", span);
                            return done(null, false);
                        }
                        Logger.instanse.info("No login providers, updating " + username + " as admin", span, {cls: "LoginProvider", func: "CreateLocalStrategy"});
                        const admins: Role = await Logger.DBHelper.FindRoleByName("admins", null, span);
                        if (admins == null) throw new Error("Failed locating admins role!")
                        admins.AddMember(user);
                        await Logger.DBHelper.Save(admins, Crypt.rootToken(), span)

                    }
                    Logger.instanse.info("Clear cache", span, {cls: "LoginProvider", func: "CreateLocalStrategy"});
                    await Logger.DBHelper.clearCache("Initialized", span);
                    await Audit.LoginSuccess(TokenUser.From(user), "weblogin", "local", remoteip, "browser", "unknown", span);
                    const provider: Provider = new Provider(); provider.provider = "local"; provider.name = "Local";
                    Logger.instanse.info("Saving local provider", span, {cls: "LoginProvider", func: "CreateLocalStrategy"});
                    const result = await Config.db.InsertOne(provider, "config", 0, false, Crypt.rootToken(), span);
                    Logger.instanse.info("local provider created as " + result._id, span, {cls: "LoginProvider", func: "CreateLocalStrategy"});
                    await Logger.DBHelper.CheckCache("config", result, false, false, span);
                    const tuser: TokenUser = TokenUser.From(user);
                    done(null, tuser);
                    if (Logger.License.validlicense) {
                        var model = new Base();
                        model._type = "oauthclient";
                        model.name = "grafana";
                        model._encrypt = ["clientSecret"];
                        (model as any).clientId = "application";
                        (model as any).clientSecret = 'secret';
                        (model as any).grants = ['password', 'refresh_token', 'authorization_code'];
                        (model as any).redirectUris = [];
                        (model as any).defaultrole = "Viewer";
                        (model as any).rolemappings = { "admins": "Admin", "grafana editors": "Editor", "grafana admins": "Admin" };

                        // (model as any).token_endpoint_auth_method = "none";
                        (model as any).token_endpoint_auth_method = "client_secret_post";
                        (model as any).response_types = ['code', 'id_token', 'code id_token'];
                        (model as any).grant_types = ['implicit', 'authorization_code'];
                        (model as any).post_logout_redirect_uris = [];
                        await Config.db.InsertOne(model, "config", 0, false, Crypt.rootToken(), span);
                    }

                    return
                }
                user = await Logger.DBHelper.FindByUsername(username, null, span);
                if (NoderedUtil.IsNullUndefinded(user)) {
                    let createUser: boolean = Config.auto_create_users;
                    if (!createUser) {
                        return done(null, false);
                    }
                    user = await Logger.DBHelper.EnsureUser(Crypt.rootToken(), username, username, null, password, null, span);
                } else {
                    if (user.disabled) {
                        await Audit.LoginFailed(username, "weblogin", "local", remoteip, "browser", "unknown", span);
                        done("Disabled user " + username, null);
                        return;
                    }
                    if (!(await Crypt.ValidatePassword(user, password, span))) {
                        await Audit.LoginFailed(username, "weblogin", "local", remoteip, "browser", "unknown", span);
                        return done(null, false);
                    }
                }
                const tuser: TokenUser = TokenUser.From(user);
                await Audit.LoginSuccess(tuser, "weblogin", "local", remoteip, "browser", "unknown", span);
                // tuser.roles.splice(40, tuser.roles.length)
                Logger.otel.endSpan(span);
                return done(null, tuser);
            } catch (error) {
                Logger.instanse.error(error, span, {cls: "LoginProvider", func: "CreateLocalStrategy"});
                Logger.otel.endSpan(span);
                done(error.message ? error.message : error);
            }
        });
        passport.use("local", strategy);
        app.use("/local",
            express.urlencoded({ extended: false }),
            async (req: any, res: any, next: any) => {
                const username = req.body?.username;
                if (!NoderedUtil.IsNullEmpty(username) && username.indexOf("@") > -1) {
                    const domain = username.substr(username.indexOf("@") + 1)

                    var providers = await Logger.DBHelper.GetProviders(null);
                    for (let i = 0; i < providers.length; i++) {
                        var provider: any = providers[i];
                        if (provider.forceddomains && Array.isArray(provider.forceddomains)) {
                            for (let d = 0; d < provider.forceddomains.length; d++) {
                                let forceddomain = new RegExp(provider.forceddomains[d], "i");
                                if (forceddomain.test(domain)) {
                                    res.redirect("/" + providers[i].id);
                                    return next();
                                }
                            }
                        }
                    }
                }
                passport.authenticate("local", function (err, user, info) {
                    let originalUrl: any = req.cookies.originalUrl;
                    if (err) {
                        Logger.instanse.error(err, null, {cls: "LoginProvider", func: "Localauthenticate"});
                    }
                    if (!err && user) {
                        req.logIn(user, function (err: any) {
                            if (err) {
                                Logger.instanse.debug("req.logIn failed", null, {cls: "LoginProvider", func: "Localauthenticate"});
                                Logger.instanse.error(err, null, {cls: "LoginProvider", func: "Localauthenticate"});
                                return next(err);
                            }
                            if (!NoderedUtil.IsNullEmpty(Config.validate_user_form) && req.user.validated == false) {
                                res.redirect("/login");
                                return next();
                            } else if (!NoderedUtil.IsNullEmpty(originalUrl)) {
                                try {
                                    try {
                                        res.cookie("originalUrl", "", { expires: new Date(0) });    
                                    } catch (error) {                                        
                                    }                                    
                                    LoginProvider.redirect(res, originalUrl);
                                    Logger.instanse.debug("redirect: " + originalUrl, null, {cls: "LoginProvider", func: "Localauthenticate"});
                                    return;
                                } catch (error) {
                                    Logger.instanse.error(error, null, {cls: "LoginProvider", func: "Localauthenticate"});
                                }
                            } else {
                                res.redirect("/");
                                return next();
                            }
                        });
                        return;
                    }
                    if (!NoderedUtil.IsNullEmpty(originalUrl)) {
                        if (originalUrl.indexOf("?") == -1) {
                            originalUrl = originalUrl + "?error=1"
                        } else if (originalUrl.indexOf("error=1") == -1) {
                            originalUrl = originalUrl + "&error=1"
                        }
                        try {
                            res.cookie("originalUrl", "", { expires: new Date(0) });
                            Logger.instanse.debug("redirect: " + originalUrl, null, {cls: "LoginProvider", func: "Localauthenticate"});
                            LoginProvider.redirect(res, originalUrl);
                        } catch (error) {
                            Logger.instanse.error(error, null, {cls: "LoginProvider", func: "Localauthenticate"});
                        }
                    } else {
                        try {
                            res.redirect("/");
                            return next();
                        } catch (error) {
                            Logger.instanse.error(error, null, {cls: "LoginProvider", func: "Localauthenticate"});
                        }
                    }
                })(req, res, next);
            }
        );

        return strategy;
    }
    static async samlverify(req: any, profile: any, done: IVerifyFunction): Promise<void> {
        const span: Span = Logger.otel.startSpanExpress("LoginProvider.samlverify", req);
        try {
            const issuer = req.baseUrl.replace("/", "");
            let username: string = profile.username;
            if (NoderedUtil.IsNullEmpty(username)) username = profile.nameID;
            if (!NoderedUtil.IsNullEmpty(username)) { username = username.toLowerCase(); }
            Logger.instanse.debug(username, span, {cls: "LoginProvider", func: "samlverify"});
            let _user: User = await Logger.DBHelper.FindByUsernameOrFederationid(username, issuer, span);
            let remoteip: string = "";
            if (!NoderedUtil.IsNullUndefinded(req)) {
                remoteip = LoginProvider.remoteip(req);
            }
            span?.setAttribute("remoteip", remoteip);

            if (NoderedUtil.IsNullUndefinded(_user)) {
                let createUser: boolean = Config.auto_create_users;
                if (Config.auto_create_domains.map(x => username.endsWith(x)).length > 0) { createUser = true; }
                if (createUser) {
                    _user = new User(); _user.name = profile.name;
                    if (!NoderedUtil.IsNullEmpty(profile["http://schemas.microsoft.com/identity/claims/displayname"])) {
                        _user.name = profile["http://schemas.microsoft.com/identity/claims/displayname"];
                    }
                    if (!NoderedUtil.IsNullEmpty(profile["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"])) {
                        _user.name = profile["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"];
                    }
                    _user.username = username;
                    if (!NoderedUtil.IsNullEmpty(profile["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/mobile"])) {
                        (_user as any).mobile = profile["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/mobile"];
                    }
                    if (NoderedUtil.IsNullEmpty(_user.name)) { done("Cannot add new user, name is empty, please add displayname to claims", null); return; }
                    const jwt: string = Crypt.rootToken();
                    let extraoptions = {
                        federationids: [new FederationId(username, issuer)],
                        emailvalidated: true
                    }
                    _user = await Logger.DBHelper.EnsureUser(jwt, _user.name, _user.username, null, null, extraoptions, span);
                }
            } else {
                if (!NoderedUtil.IsNullEmpty(profile["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/mobile"])) {
                    (_user as any).mobile = profile["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/mobile"];
                }
                if(_user.federationids == null) _user.federationids = [];
                var exists = _user.federationids.filter(x => x.id == username && x.issuer == issuer);
                if (exists.length == 0) {
                    _user.federationids = _user.federationids.filter(x => x.issuer != issuer);
                    _user.federationids.push(new FederationId(username, issuer));
                }
                _user.emailvalidated = true;
                if (_user.formvalidated) _user.validated = true;
                const jwt: string = Crypt.rootToken();
                await Logger.DBHelper.Save(_user, jwt, span);
                await Logger.DBHelper.CheckCache("users", _user, false, false, span);
            }

            if (!NoderedUtil.IsNullUndefinded(_user)) {
                if (!NoderedUtil.IsNullEmpty(profile["http://schemas.xmlsoap.org/claims/Group"])) {
                    const jwt: string = Crypt.rootToken();
                    const strroles: string[] = profile["http://schemas.xmlsoap.org/claims/Group"];
                    for (let i = 0; i < strroles.length; i++) {
                        const role: Role = await Logger.DBHelper.FindRoleByName(strroles[i], jwt, span);
                        if (!NoderedUtil.IsNullUndefinded(role)) {
                            role.AddMember(_user);
                            await Logger.DBHelper.Save(role, jwt, span);
                        }
                    }
                    _user = await Logger.DBHelper.DecorateWithRoles(_user, span);
                }
            }

            if (NoderedUtil.IsNullUndefinded(_user)) {
                await Audit.LoginFailed(username, "weblogin", "saml", remoteip, "unknown", "unknown", span);
                done("unknown user " + username, null);
                return;
            }
            if (_user.disabled) {
                await Audit.LoginFailed(username, "weblogin", "saml", remoteip, "unknown", "unknown", span);
                done("Disabled user " + username, null);
                return;
            }

            const tuser: TokenUser = TokenUser.From(_user);
            await Audit.LoginSuccess(tuser, "weblogin", "saml", remoteip, "unknown", "unknown", span);
            Logger.otel.endSpan(span);
            done(null, tuser);
        } catch (error) {
            Logger.instanse.error(error, span, {cls: "LoginProvider", func: "samlverify"});
        }
        Logger.otel.endSpan(span);
    }

    static async openidverify(issuer: string, profile: any, done: any): Promise<void> {
        const span: Span = Logger.otel.startSpan("LoginProvider.openidverify", null, null);
        const remoteip: string = "unknown";
        try {
            if (profile.id && !profile.username) profile.username = profile.id;
            if (profile.emails) {
                const email: any = profile.emails[0];
                profile.username = email.value;
            }
            let username: string = profile.username;
            if (NoderedUtil.IsNullEmpty(username)) username = profile.nameID;
            if (!NoderedUtil.IsNullEmpty(username)) { username = username.toLowerCase(); }
            Logger.instanse.debug(profile.id, span, {cls: "LoginProvider", func: "openidverify"});
            let _user: User = await Logger.DBHelper.FindByUsernameOrFederationid(profile.id, issuer, span);
            if (NoderedUtil.IsNullUndefinded(_user)) {
                _user = await Logger.DBHelper.FindByUsernameOrFederationid(profile.username, issuer, span);
            }
            if (NoderedUtil.IsNullUndefinded(_user)) {
                let createUser: boolean = Config.auto_create_users;
                if (Config.auto_create_domains.map(x => username.endsWith(x)).length > 0) { createUser = true; }
                if (createUser) {
                    const jwt: string = Crypt.rootToken();
                    _user = new User(); _user.name = profile.name;
                    if (!NoderedUtil.IsNullEmpty(profile.displayName)) { _user.name = profile.displayName; }
                    _user.username = username;
                    (_user as any).mobile = profile.mobile;
                    // if (NoderedUtil.IsNullEmpty(_user.name)) { done("Cannot add new user, name is empty.", null); return; }
                    if (NoderedUtil.IsNullEmpty(_user.name)) _user.name = username
                    let extraoptions = {
                        federationids: [new FederationId(profile.id, issuer)],
                        emailvalidated: true
                    }
                    // ,emailvalidated: true
                    _user = await Logger.DBHelper.EnsureUser(jwt, _user.name, _user.username, null, null, extraoptions, span);
                }
            } else {
                if(_user.federationids == null) _user.federationids = [];
                var exists = _user.federationids.filter(x => x.id == profile.id && x.issuer == issuer);
                if (exists.length == 0 || _user.emailvalidated == false) {
                    _user.federationids = _user.federationids.filter(x => x.issuer != issuer);
                    _user.federationids.push(new FederationId(profile.id, issuer));
                    _user.emailvalidated = true;
                    if (_user.formvalidated) _user.validated = true;
                    const jwt: string = Crypt.rootToken();
                    await Logger.DBHelper.Save(_user, jwt, span);
                    await Logger.DBHelper.CheckCache("users", _user, false, false, span);
                }
            }
            if (NoderedUtil.IsNullUndefinded(_user)) {
                await Audit.LoginFailed(username, "weblogin", "openid", remoteip, "openidverify" as any, "unknown", span);
                done("unknown user " + username, null); return;
            }
            if (_user.disabled) {
                await Audit.LoginFailed(username, "weblogin", "openid", remoteip, "openidverify" as any, "unknown", span);
                done("Disabled user " + username, null);
                return;
            }
            const tuser: TokenUser = TokenUser.From(_user);
            await Audit.LoginSuccess(tuser, "weblogin", "openid", remoteip, "openidverify" as any, "unknown", span);
            done(null, tuser);
        } catch (error) {
            Logger.instanse.error(error, span, {cls: "LoginProvider", func: "openidverify"});
        }
        Logger.otel.endSpan(span);
    }
    static async googleverify(req: any, token: string, tokenSecret: string, profile: any, done: IVerifyFunction): Promise<void> {
        const span: Span = Logger.otel.startSpanExpress("LoginProvider.googleverify", req);
        try {
            if (profile.emails) {
                const email: any = profile.emails[0];
                profile.username = email.value;
            }
            let remoteip: string = "";
            if (!NoderedUtil.IsNullUndefinded(req)) {
                remoteip = LoginProvider.remoteip(req);
            }
            span?.setAttribute("remoteip", remoteip);
            const issuer = req.baseUrl.replace("/", "");
            let username: string = profile.username;
            if (NoderedUtil.IsNullEmpty(username)) username = profile.nameID;
            if (!NoderedUtil.IsNullEmpty(username)) { username = username.toLowerCase(); }
            Logger.instanse.debug(username, span, {cls: "LoginProvider", func: "googleverify"});
            let _user: User = await Logger.DBHelper.FindByUsernameOrFederationid(username, issuer, span);
            if (NoderedUtil.IsNullUndefinded(_user)) {
                let createUser: boolean = Config.auto_create_users;
                if (Config.auto_create_domains.map(x => username.endsWith(x)).length > 0) { createUser = true; }
                if (createUser) {
                    const jwt: string = Crypt.rootToken();
                    _user = new User(); _user.name = profile.name;
                    if (!NoderedUtil.IsNullEmpty(profile.displayName)) { _user.name = profile.displayName; }
                    _user.username = username;
                    (_user as any).mobile = profile.mobile;
                    if (NoderedUtil.IsNullEmpty(_user.name)) { done("Cannot add new user, name is empty.", null); return; }
                    let extraoptions = {
                        federationids: [new FederationId(username, issuer)],
                        emailvalidated: true
                    }
                    _user = await Logger.DBHelper.EnsureUser(jwt, _user.name, _user.username, null, null, extraoptions, span);
                }
            } else {
                if(_user.federationids == null) _user.federationids = [];
                var exists = _user.federationids.filter(x => x.id == username && x.issuer == issuer);
                if (exists.length == 0 || _user.emailvalidated == false) {
                    _user.federationids = _user.federationids.filter(x => x.issuer != issuer);
                    _user.federationids.push(new FederationId(username, issuer));
                    _user.emailvalidated = true;
                    if (_user.formvalidated) _user.validated = true;
                    const jwt: string = Crypt.rootToken();
                    await Logger.DBHelper.Save(_user, jwt, span);
                    await Logger.DBHelper.CheckCache("users", _user, false, false, span);
                }
            }
            if (NoderedUtil.IsNullUndefinded(_user)) {
                await Audit.LoginFailed(username, "weblogin", "google", remoteip, "unknown", "unknown", span);
                done("unknown user " + username, null); return;
            }
            if (_user.disabled) {
                await Audit.LoginFailed(username, "weblogin", "google", remoteip, "unknown", "unknown", span);
                done("Disabled user " + username, null);
                return;
            }
            const tuser: TokenUser = TokenUser.From(_user);
            await Audit.LoginSuccess(tuser, "weblogin", "google", remoteip, "unknown", "unknown", span);
            done(null, tuser);
        } catch (error) {
            Logger.instanse.error(error, span, {cls: "LoginProvider", func: "googleverify"});
        }
        Logger.otel.endSpan(span);
    }
    static reverseLookup(ip) {
        return new Promise<string>((resolve, reject) => {
            dns.reverse(ip, function (err, domains) {
                if (err != null) return reject(err);
                domains.forEach(function (domain) {
                    dns.lookup(domain, function (err, address, family) {
                        if (err != null) return reject(err);
                        resolve(domain);
                    });
                });
            });
        });
    }

    static sendEmail(type: string, userid: string, to: string, subject: string, text: string, span: Span): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            var transporter = null;
            if (!NoderedUtil.IsNullEmpty(Config.smtp_url)) {
                transporter = nodemailer.createTransport(Config.smtp_url);
            } else {
                transporter = nodemailer.createTransport({
                    service: Config.smtp_service,
                    auth: {
                        user: Config.smtp_user,
                        pass: Config.smtp_pass
                    }
                });
            }
            let id = NoderedUtil.GetUniqueIdentifier();
            let imgurl = Config.baseurl() + "read/" + id;
            text = text.split('\n').join('<br/>\n');
            let html = text + `<img src="${imgurl}" alt="isread" border="0" width="1" height="1">`
            let from = Config.smtp_from;

            if (Config.NODE_ENV != "production") {
                Logger.instanse.warn("Skip sending email to " + to, span, {cls: "LoginProvider", func: "sendEmail"});
                Logger.instanse.info(text, span, {cls: "LoginProvider", func: "sendEmail"});
                resolve("email not sent");
            } else {
                transporter.sendMail({
                    from,
                    to,
                    subject,
                    html
                }, function (error, info) {
                    if (error) {
                        Logger.instanse.error(error, span, {cls: "LoginProvider", func: "sendEmail"});
                        reject(error);
                    } else {
                        Logger.instanse.info("Email sent to " + to + " " + info.response, span, {cls: "LoginProvider", func: "sendEmail"});
                        var item: any = new Base();
                        item.readcount = 0;
                        item._type = type;
                        item.id = id;
                        item.from = from;
                        item.to = to;
                        item.text = text;
                        item.name = to + " " + subject;
                        item.userid = userid;
                        item.opened = [];
                        item.response = info.response;
                        item.read = false;
                        Config.db.InsertOne(item, "mailhist", 1, true, Crypt.rootToken(), span);
                        resolve(info.response);
                    }
                });
            }
        });
    }
    static async get_dashboardauth(req: any, res: any, next: any) {
        const span: Span = (Config.otel_trace_dashboardauth ? Logger.otel.startSpanExpress("LoginProvider.dashboardauth", req) : null);
        try {
            span?.setAttribute("remoteip", LoginProvider.remoteip(req));
            if (req.user) {
                Logger.instanse.verbose("User is signed in", span, {cls: "LoginProvider", func: "dashboardauth"});
                const user: TokenUser = TokenUser.From(req.user);
                span?.setAttribute("username", user.username);
                if (user != null) {
                    const allowed = user.roles.filter(x => x.name == "dashboardusers" || x.name == "admins");
                    if (allowed.length > 0) {
                        Logger.instanse.verbose("Authorized " + user.username + " for " + req.url, span, {cls: "LoginProvider", func: "dashboardauth"});
                        return res.send({
                            status: "success",
                            display_status: "Success",
                            message: "Connection OK"
                        });
                    } else {
                        Logger.instanse.warn((user.username + " is not member of 'dashboardusers' for " + req.url), span, {cls: "LoginProvider", func: "dashboardauth"});
                    }
                } else {
                    Logger.instanse.error("Failed casting user", span, {cls: "LoginProvider", func: "dashboardauth"});
                }
            }
            const authorization: string = req.headers.authorization;

            if (NoderedUtil.IsNullEmpty(authorization)) {
                res.statusCode = 401;
                res.setHeader('WWW-Authenticate', 'Basic realm="OpenFlow"');
                res.end('Unauthorized');
                return;
            }

            Logger.instanse.verbose("Lookup user by authentication header", span, {cls: "LoginProvider", func: "dashboardauth"});
            var user: User = await Logger.DBHelper.FindByAuthorization(authorization, null, span);
            if (user != null) {
                const allowed = user.roles.filter(x => x.name == "dashboardusers" || x.name == "admins");
                if (allowed.length > 0) {
                    Logger.instanse.debug("User is authorized to see dashboard", span, {cls: "LoginProvider", func: "dashboardauth"});
                    return res.send({
                        status: "success",
                        display_status: "Success",
                        message: "Connection OK"
                    });
                } else {
                    Logger.instanse.warn(user.username + " is not member of 'dashboardusers' for " + req.url, span, {cls: "LoginProvider", func: "dashboardauth"});
                }
            }
            res.statusCode = 401;
            res.setHeader('WWW-Authenticate', 'Basic realm="OpenFlow"');
            res.end('Unauthorized');
            return;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    static get_Signout(req: any, res: any, next: any): void {
        const span: Span = Logger.otel.startSpanExpress("LoginProvider.get_Signout", req);
        try {
            req.logout();
            res.cookie("_session.legacy.sig", "", { expires: new Date(0) });
            res.cookie("_session.legacy", "", { expires: new Date(0) });
            res.cookie("session", "", { expires: new Date(0) });
            res.cookie("_session.sig", "", { expires: new Date(0) });
            res.cookie("_interaction.sig", "", { expires: new Date(0) });
            res.cookie("_interaction", "", { expires: new Date(0) });
            res.cookie("_session", "", { expires: new Date(0) });
            const originalUrl: any = req.cookies.originalUrl;
            if (!NoderedUtil.IsNullEmpty(originalUrl)) {
                Logger.instanse.debug("Redirect user to " + originalUrl, span, {cls: "LoginProvider", func: "Signout"});
                res.cookie("originalUrl", "", { expires: new Date(0) });
                LoginProvider.redirect(res, originalUrl);
            } else {
                Logger.instanse.debug("Redirect user to /", span, {cls: "LoginProvider", func: "Signout"});
                res.redirect("/");
            }
        } catch (error) {
            Logger.instanse.error(error, span, {cls: "LoginProvider", func: "Signout"});
            return res.status(500).send({ message: error.message ? error.message : error });
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    static get_PassiveSignout(req: any, res: any, next: any): void {
        const span: Span = Logger.otel.startSpanExpress("LoginProvider.get_Signout", req);
        try {
            req.logout();
            const originalUrl: any = req.cookies.originalUrl;
            if (!NoderedUtil.IsNullEmpty(originalUrl)) {
                Logger.instanse.debug("Redirect user to " + originalUrl, span, {cls: "LoginProvider", func: "PassiveSignout"});
                res.cookie("originalUrl", "", { expires: new Date(0) });
                LoginProvider.redirect(res, originalUrl);
            } else {
                Logger.instanse.debug("Redirect user to /", span, {cls: "LoginProvider", func: "PassiveSignout"});
                res.redirect("/Login");
            }
        } catch (error) {
            Logger.instanse.error(error, span, {cls: "LoginProvider", func: "PassiveSignout"});
            return res.status(500).send({ message: error.message ? error.message : error });
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    static async get_user(req: any, res: any, next: any): Promise<void> {
        const span: Span = Logger.otel.startSpanExpress("LoginProvider.user", req);
        try {
            span?.setAttribute("remoteip", LoginProvider.remoteip(req));
            res.setHeader("Content-Type", "application/json");
            if (req.user) {
                Logger.instanse.debug("return user " + req.user._id, span, {cls: "LoginProvider", func: "getuser"});
                await Logger.DBHelper.UserRoleUpdateId(req.user._id, false, span);
                const user: User = await Logger.DBHelper.FindById(req.user._id, span);
                user.validated = true;
                if (Config.validate_user_form != "") {
                    if (!user.formvalidated) user.validated = false;
                }
                if (Config.validate_emails) {
                    if (!user.emailvalidated) user.validated = false;
                }
                res.end(JSON.stringify(user));
            } else {
                Logger.instanse.debug("return nothing, not signed in", span, {cls: "LoginProvider", func: "getuser"});
                res.end(JSON.stringify({}));
            }
            res.end();
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    static get_jwt(req: any, res: any, next: any): void {
        const span: Span = Logger.otel.startSpanExpress("LoginProvider.jwt", req);
        try {
            span?.setAttribute("remoteip", LoginProvider.remoteip(req));
            res.setHeader("Content-Type", "application/json");
            if (req.user) {
                const user: TokenUser = TokenUser.From(req.user);
                span?.setAttribute("username", user.username);
                Logger.instanse.debug("return token for user " + req.user._id + " " + user.name, span, {cls: "LoginProvider", func: "getjwt"});
                res.end(JSON.stringify({ jwt: Crypt.createToken(user, Config.shorttoken_expires_in), user: user }));
            } else {
                Logger.instanse.verbose("return nothing, not signed in", span, {cls: "LoginProvider", func: "getjwt"});
                res.end(JSON.stringify({ jwt: "" }));
            }
            res.end();
        } catch (error) {
            Logger.instanse.error(error, span, {cls: "LoginProvider", func: "getjwt"});
            return res.status(500).send({ message: error.message ? error.message : error });
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    static get_jwtlong(req: any, res: any, next: any): void {
        const span: Span = Logger.otel.startSpanExpress("LoginProvider.jwtlong", req);
        try {
            span?.setAttribute("remoteip", LoginProvider.remoteip(req));
            res.setHeader("Content-Type", "application/json");
            if (req.user) {
                const user: TokenUser = TokenUser.From(req.user);
                span?.setAttribute("username", user.username);

                if (!(user.validated == true) && Config.validate_user_form != "") {
                    Logger.instanse.error("return nothing, user is not validated yet", span, {cls: "LoginProvider", func: "getjwtlong"});
                    res.end(JSON.stringify({ jwt: "" }));
                } else {
                    Logger.instanse.debug("return token for user " + req.user._id + " " + user.name, span, {cls: "LoginProvider", func: "getjwtlong"});
                    res.end(JSON.stringify({ jwt: Crypt.createToken(user, Config.longtoken_expires_in), user: user }));
                }
            } else {
                Logger.instanse.error("return nothing, not signed in", span, {cls: "LoginProvider", func: "getjwtlong"});
                res.end(JSON.stringify({ jwt: "" }));
            }
            res.end();
        } catch (error) {
            Logger.instanse.error(error, span, {cls: "LoginProvider", func: "getjwtlong"});
            return res.status(500).send({ message: error.message ? error.message : error });
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    static async post_jwt(req: any, res: any, next: any): Promise<void> {
        const span: Span = Logger.otel.startSpanExpress("LoginProvider.jwt", req);
        // logger.debug("/jwt " + !(req.user == null));
        try {
            span?.setAttribute("remoteip", LoginProvider.remoteip(req));
            const rawAssertion = req.body.token;
            const user: User = await LoginProvider.validateToken(rawAssertion, span);
            const tuser: TokenUser = TokenUser.From(user);
            span?.setAttribute("username", user.username);
            res.setHeader("Content-Type", "application/json");
            Logger.instanse.debug("Recreating jwt token", span, {cls: "LoginProvider", func: "postjwt"});
            res.end(JSON.stringify({ jwt: Crypt.createToken(tuser, Config.shorttoken_expires_in) }));
        } catch (error) {
            Logger.instanse.error(error, span, {cls: "LoginProvider", func: "postjwt"});
            return res.status(500).send({ message: error.message ? error.message : error });
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    static async config(): Promise<any> {
        let _url = Config.basewsurl();
        if (!NoderedUtil.IsNullEmpty(Config.api_ws_url)) _url = Config.api_ws_url;
        if (!_url.endsWith("/")) _url += "/";
        let agent_domain_schema = Config.agent_domain_schema;
        if (NoderedUtil.IsNullEmpty(agent_domain_schema)) {
            agent_domain_schema = "$slug$." + Config.domain;
        }
        
        let forceddomains = [];
        var providers = await Logger.DBHelper.GetProviders(null);
        for (let i = 0; i < providers.length; i++) {
            var provider: any = providers[i];
            if (provider.forceddomains && Array.isArray(provider.forceddomains)) {
                forceddomains = forceddomains.concat(provider.forceddomains);
            }
        }
        const res2 = {
            wshost: _url,
            wsurl: _url,
            domain: Config.domain,
            auto_create_users: Config.auto_create_users,
            auto_create_personal_nodered_group: Config.auto_create_personal_nodered_group,
            auto_create_personal_noderedapi_group: Config.auto_create_personal_noderedapi_group,
            namespace: Config.namespace,
            agent_domain_schema: agent_domain_schema,
            websocket_package_size: Config.websocket_package_size,
            version: Config.version,
            stripe_api_key: Config.stripe_api_key,
            getting_started_url: Config.getting_started_url,
            validate_user_form: Config.validate_user_form,
            validate_emails: Config.validate_emails,
            forgot_pass_emails: Config.forgot_pass_emails,
            supports_watch: true,
            agent_images: Config.agent_images,
            amqp_enabled_exchange: Config.amqp_enabled_exchange,
            multi_tenant: Config.multi_tenant,
            enable_entity_restriction: Config.enable_entity_restriction,
            enable_web_tours: Config.enable_web_tours,
            enable_nodered_tours: Config.enable_nodered_tours,
            collections_with_text_index: DatabaseConnection.collections_with_text_index,
            timeseries_collections: DatabaseConnection.timeseries_collections,
            ping_clients_interval: Config.ping_clients_interval,
            validlicense: Logger.License.validlicense,
            forceddomains: forceddomains,
            grafana_url: Config.grafana_url,
            llmchat_queue: Config.llmchat_queue
        }
        return res2;
    }
    static async get_config(req: any, res: any, next: any): Promise<void> {
        const span: Span = Logger.otel.startSpanExpress("LoginProvider.config", req);
        try {
            span?.setAttribute("remoteip", LoginProvider.remoteip(req));
            if (req.user) {
                const user: TokenUser = TokenUser.From(req.user);
                span?.setAttribute("username", user.username);
            }
            const res2 = await LoginProvider.config();
            Logger.instanse.debug("Return configuration settings", span, {cls: "LoginProvider", func: "getconfig"});
            res.end(JSON.stringify(res2));
        } catch (error) {
            Logger.instanse.error(error, span, {cls: "LoginProvider", func: "getconfig"});
            return res.status(500).send({ message: error.message ? error.message : error });
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    static async post_AddTokenRequest(req: any, res: any, next: any): Promise<void> {
        const span: Span = Logger.otel.startSpanExpress("LoginProvider.login", req);
        try {
            const remoteip = LoginProvider.remoteip(req);
            span?.setAttribute("remoteip", remoteip);
            const key = req.body.key;
            let exists: TokenRequest = await Logger.DBHelper.FindRequestTokenID(key, span);
            if (!NoderedUtil.IsNullUndefinded(exists)) {
                Logger.instanse.error("Key has already been used! " + key, span, {cls: "LoginProvider", func: "AddTokenRequest"});
                return res.status(500).send({ message: "Illegal key" });
            }
            await Logger.DBHelper.AddRequestTokenID(key, {}, span);
            Logger.instanse.info("Added token request " + key + " from " + remoteip, span, {cls: "LoginProvider", func: "AddTokenRequest"});
            res.status(200).send({ message: "ok" });
        } catch (error) {
            Logger.instanse.error(error, span, {cls: "LoginProvider", func: "AddTokenRequest"});
            return res.status(500).send({ message: error.message ? error.message : error });
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    static async get_GetTokenRequest(req: any, res: any, next: any): Promise<void> {
        const span: Span = Logger.otel.startSpanExpress("LoginProvider.login", req);
        try {
            const remoteip = LoginProvider.remoteip(req);
            span?.setAttribute("remoteip", remoteip);
            const key = req.query.key;
            let exists: TokenRequest = null;
            exists = await Logger.DBHelper.FindRequestTokenID(key, span);
            if (NoderedUtil.IsNullUndefinded(exists)) {
                Logger.instanse.error("Unknown key " + key + " from " + remoteip, span, {remoteip, cls: "LoginProvider", func: "GetTokenRequest"});
                res.status(200).send({ message: "Illegal key" });
                return;
            }

            if (!NoderedUtil.IsNullEmpty(exists.jwt)) {
                Logger.instanse.info("Token " + key + " has been forfilled from " + remoteip, span, {remoteip, cls: "LoginProvider", func: "GetTokenRequest"});
                if (Config.validate_user_form != "") {
                    try {
                        var tuser = await await Crypt.verityToken(exists.jwt);
                        var user = await Logger.DBHelper.FindById(tuser._id, span);
                        if (user.validated == true) {
                            await Logger.DBHelper.RemoveRequestTokenID(key, span);
                            Logger.instanse.debug("return jwt for " + key, span, {remoteip, cls: "LoginProvider", func: "GetTokenRequest"});
                            res.status(200).send(Object.assign(exists, { message: "ok" }));
                        } else {
                            Logger.instanse.debug("User not validated yet, for key " + key + " user " + user.name + " " + user._id, span, {remoteip, cls: "LoginProvider", func: "GetTokenRequest"});
                            res.status(200).send({ message: "ok" });
                        }
                    } catch (error) {
                        Logger.instanse.error(error, span, {remoteip, cls: "LoginProvider", func: "GetTokenRequest"});
                    }
                } else {
                    Logger.instanse.debug("return jwt for " + key, span, {remoteip, cls: "LoginProvider", func: "GetTokenRequest"});
                    res.status(200).send(Object.assign(exists, { message: "ok" }));
                    await Logger.DBHelper.RemoveRequestTokenID(key, span);
                }
            } else {
                Logger.instanse.debug("No jwt for " + key, span, {remoteip, cls: "LoginProvider", func: "GetTokenRequest"});
                res.status(200).send(Object.assign(exists, { message: "ok" }));
            }
        } catch (error) {
            Logger.instanse.error(error, span, {cls: "LoginProvider", func: "GetTokenRequest"});
            try {
                res.status(500).send({ message: error.message ? error.message : error });
            } catch (error) {
            }
        } finally {
            try {
                res.end();
            } catch (error) {
            }
            Logger.otel.endSpan(span);
        }
    }
    static async get_login(req: any, res: any, next: any): Promise<void> {
        const span: Span = Logger.otel.startSpanExpress("LoginProvider.login", req);
        try {
            span?.setAttribute("remoteip", LoginProvider.remoteip(req));
            let key = req.query.key;
            if (NoderedUtil.IsNullEmpty(key) && !NoderedUtil.IsNullEmpty(req.cookies.requesttoken)) key = req.cookies.requesttoken;

            if (!NoderedUtil.IsNullEmpty(key)) {
                if (req.user) {
                    const user: User = await Logger.DBHelper.FindById(req.user._id, span);
                    var exists: TokenRequest = await Logger.DBHelper.FindRequestTokenID(key, span);
                    if (!NoderedUtil.IsNullUndefinded(exists)) {
                        Logger.instanse.debug("adding jwt for request token " + key, span, {cls: "LoginProvider", func: "getlogin"});
                        await Logger.DBHelper.AddRequestTokenID(key, { jwt: Crypt.createToken(user, Config.longtoken_expires_in) }, span);
                        try {
                            res.cookie("requesttoken", "", { expires: new Date(0) });    
                        } catch (error) {                            
                        }                        
                    }
                } else {
                    try {
                        res.cookie("requesttoken", key, { maxAge: 36000, httpOnly: true });    
                    } catch (error) {                        
                    }                    
                }
            }
            if (!NoderedUtil.IsNullEmpty(req.query.key)) {
                if (req.user) {
                    res.cookie("originalUrl", "", { expires: new Date(0) });
                    Logger.instanse.debug("User signed in, with key " + key, span, {cls: "LoginProvider", func: "getlogin"});
                    this.redirect(res, "/");
                } else {
                    try {
                        res.cookie("originalUrl", req.originalUrl, { maxAge: 900000, httpOnly: true });
                    } catch (error) {
                    }
                    Logger.instanse.debug("User not signed in, redirect to /login", span, {cls: "LoginProvider", func: "getlogin"});
                    this.redirect(res, "/login");
                }
            }
            let user: User;
            let tuser: TokenUser;
            if (req.user) {
                await Logger.DBHelper.CheckCache("users", req.user, false, false, span);
                user = await Logger.DBHelper.FindById(req.user._id, span);
                user.validated = true;
                if (Config.validate_user_form != "") {
                    if (!user.formvalidated) user.validated = false;
                }
                if (Config.validate_emails) {
                    if (!user.emailvalidated) user.validated = false;
                }
                tuser = TokenUser.From(user);
            }
            const originalUrl: any = req.cookies.originalUrl;
            const validateurl: any = req.cookies.validateurl;
            if (NoderedUtil.IsNullEmpty(originalUrl) && !req.originalUrl.startsWith("/login")) {
                Logger.instanse.debug("Save originalUrl as " + originalUrl, span, {cls: "LoginProvider", func: "getlogin"});
                try {
                    res.cookie("originalUrl", req.originalUrl, { maxAge: 900000, httpOnly: true });
                } catch (error) {
                }                
            }
            if (!NoderedUtil.IsNullEmpty(validateurl)) {
                if (tuser != null) {
                    if (tuser.validated) {
                        await Logger.DBHelper.CheckCache("users", tuser as any, false, false, span);
                    }
                    if (!(tuser.validated == true) && Config.validate_user_form != "") {
                    } else {
                        res.cookie("validateurl", "", { expires: new Date(0) });
                        res.cookie("originalUrl", "", { expires: new Date(0) });
                        Logger.instanse.debug("redirect to validateurl /#" + validateurl, span, {cls: "LoginProvider", func: "getlogin"});
                        this.redirect(res, "/#" + validateurl);
                        return;
                    }
                }
            }
            if (req.user != null && !NoderedUtil.IsNullEmpty(originalUrl) && tuser.validated) {
                if (!NoderedUtil.IsNullEmpty(Config.validate_user_form) && req.user.validated == true) {
                    if(originalUrl != "/login" && originalUrl != "/Login") {
                        Logger.instanse.debug("user validated, redirect to " + originalUrl, span, {cls: "LoginProvider", func: "getlogin"});
                        this.redirect(res, originalUrl);
                    } else {
                        Logger.instanse.debug("user signed in, redirect to /", span, {cls: "LoginProvider", func: "getlogin"});
                        this.redirect(res, "/");
                    }
                    return;
                } else if (NoderedUtil.IsNullEmpty(Config.validate_user_form)) {
                    if(originalUrl != "/login" && originalUrl != "/Login") {
                        Logger.instanse.debug("user signed in, redirect to " + originalUrl, span, {cls: "LoginProvider", func: "getlogin"});
                        this.redirect(res, originalUrl);
                    } else {
                        Logger.instanse.debug("user signed in, redirect to /", span, {cls: "LoginProvider", func: "getlogin"});
                        this.redirect(res, "/");
                    }
                    return;
                    
                    this.redirect(res, originalUrl);
                    return;
                }
            }
            if (tuser != null && tuser.validated) {
                Logger.instanse.debug("redirect to /", span, {cls: "LoginProvider", func: "getlogin"});
                this.redirect(res, "/");
            } else {
                Logger.instanse.debug("return PassiveLogin.html", span, {cls: "LoginProvider", func: "getlogin"});
                const file = path.join(__dirname, 'public', 'PassiveLogin.html');
                res.sendFile(file);
            }
        } catch (error) {
            Logger.instanse.error(error, span, {cls: "LoginProvider", func: "getlogin"});
            try {
                return res.status(500).send({ message: error.message ? error.message : error });
            } catch (error) {
            }
        }
        Logger.otel.endSpan(span);
    }
    static async get_validateuserform(req: any, res: any, next: any): Promise<void> {
        const span: Span = Logger.otel.startSpanExpress("LoginProvider.validateuserform", req);
        try {
            span?.setAttribute("remoteip", LoginProvider.remoteip(req));
            res.setHeader("Content-Type", "application/json");
            if (NoderedUtil.IsNullEmpty(Config.validate_user_form)) {
                Logger.instanse.debug("No validate user form set, return nothing", span, {cls: "LoginProvider", func: "validateuserform"});
                res.end(JSON.stringify({}));
                res.end();
                Logger.otel.endSpan(span);
                return;
            }
            var forms = await Config.db.query<Base>({ query: { _id: Config.validate_user_form, _type: "form" }, top: 1, collectionname: "forms", jwt: Crypt.rootToken() }, span);
            if (forms.length == 1) {
                Logger.instanse.debug("Return form " + Config.validate_user_form, span, {cls: "LoginProvider", func: "validateuserform"});
                res.end(JSON.stringify(forms[0]));
                res.end();
                Logger.otel.endSpan(span);
                return;
            }
            Logger.instanse.error("validate_user_form " + Config.validate_user_form + " does not exists!", span, {cls: "LoginProvider", func: "validateuserform"});
            Config.validate_user_form = "";
            res.end(JSON.stringify({}));
            res.end();
        } catch (error) {
            Logger.instanse.error(error, span, {cls: "LoginProvider", func: "validateuserform"});
            return res.status(500).send({ message: error.message ? error.message : error });
        } finally {
            Logger.otel.endSpan(span);
        }
        return;
    }
    static async get_read(req: any, res) {
        if (NoderedUtil.IsNullEmpty(req.params.id)) return res.end(JSON.stringify({ "message": "notok" }));
        const buffer = Buffer.alloc(43)
        buffer.write('R0lGODlhAQABAIAAAAAAAAAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=', 'base64')
        res.writeHead(200, { 'Content-Type': 'image/gif' })
        res.end(buffer, 'binary')
        try {
            const id = req.params.id;
            const dt = new Date(new Date().toISOString());
            const ip = LoginProvider.remoteip(req);
            let domain = "";
            try {
                domain = await LoginProvider.reverseLookup(ip);
            } catch (error) {
            }
            const agent = req.headers['user-agent'];
            const UpdateDoc: any = { "$set": { "_modified": dt, "read": true }, "$push": { "opened": { dt, ip, domain, agent } }, "$inc": { "readcount": 1 } };
            var res2 = await Config.db._UpdateOne({ id }, UpdateDoc, "mailhist", 1, true, Crypt.rootToken(), null);
        } catch (error) {
            Logger.instanse.error(error, null, {cls: "LoginProvider", func: "read"});
        }
    }
    static async post_validateuserform(req: any, res) {
        const span: Span = Logger.otel.startSpanExpress("LoginProvider.postvalidateuserform", req);
        res.setHeader("Content-Type", "application/json");
        try {
            span?.setAttribute("remoteip", LoginProvider.remoteip(req));
            if (req.user) {
                var u: User = req.user;
                if (!NoderedUtil.IsNullEmpty(u._id)) u = await Logger.DBHelper.FindById(u._id, span);
                var tuser: TokenUser = TokenUser.From(u);
                if (req.body && req.body.data) {
                    if (!tuser.formvalidated || tuser.formvalidated) {
                        delete req.body.data._id;
                        delete req.body.data.username;
                        delete req.body.data.disabled;
                        delete req.body.data.type;
                        delete req.body.data.roles;
                        delete req.body.data.submit;
                        delete req.body.data.federationids;
                        delete req.body.data.nodered;
                        delete req.body.data.billing;
                        delete req.body.data.clientagent;
                        delete req.body.data.clientversion;
                        const UpdateDoc: any = { "$set": {} };
                        const keys = Object.keys(req.body.data);
                        keys.forEach(key => {
                            if (key.startsWith("_")) {
                            } else if (key.indexOf("$") > -1) {
                            } else {
                                UpdateDoc.$set[key] = req.body.data[key];
                            }
                        });
                        UpdateDoc.$set["formvalidated"] = true;

                        if (Config.validate_emails) {
                            if (Config.smtp_service == "gmail") {
                                if (NoderedUtil.IsNullEmpty(Config.smtp_user) || NoderedUtil.IsNullEmpty(Config.smtp_pass)) {
                                    Logger.instanse.error("Disabling email validation, missing login information fot gmail", span, {cls: "LoginProvider", func: "validateuserform"});
                                    Config.validate_emails = false;
                                }
                            } else if (NoderedUtil.IsNullEmpty(Config.smtp_url)) {
                                Logger.instanse.error("Disabling email validation, missing smtp_url", span, {cls: "LoginProvider", func: "validateuserform"});
                                Config.validate_emails = false;
                            } else if (NoderedUtil.IsNullEmpty(Config.smtp_from)) {
                                Logger.instanse.error("Disabling email validation, missing smtp_from", span, {cls: "LoginProvider", func: "validateuserform"});
                                Config.validate_emails = false;
                            }
                        }

                        if (Config.validate_emails) {
                            let email: string = tuser.username;
                            if (tuser.email && tuser.email.indexOf("@") > -1) email = tuser.email;
                            if (req.body.data.email) email = req.body.data.email;

                            if (email.indexOf("@") > -1) {
                                if (Config.debounce_lookup) {
                                    const response = await got.get("https://disposable.debounce.io/?email=" + email);
                                    const body = JSON.parse(response.body);
                                    if (body.disposable == true) {
                                        throw new Error("Please use a valid and non temporary email address");
                                    }
                                }
                                if (Config.validate_emails_disposable) {
                                    var domain = await Logger.DBHelper.GetDisposableDomain(email, span);
                                    if (domain != null) {
                                        throw new Error("Please use a valid and non temporary email address");
                                    }
                                }
                            }

                            if (email.indexOf("@") > -1) {

                                // https://disposable.debounce.io/?email=info@example.com
                                email = email.toLowerCase();
                                var exists = await Config.db.query<User>({ query: { "_id": { "$ne": tuser._id }, "$or": [{ "username": email }, { "email": email }], "_type": "user" }, collectionname: "users", jwt: Crypt.rootToken() }, span);
                                if (exists.length > 0) {
                                    Logger.instanse.error(tuser.name + " trying to register email " + email + " already used by " + exists[0].name + " (" + exists[0]._id + ")", span, {cls: "LoginProvider", func: "validateuserform"})
                                    email = "";
                                    delete UpdateDoc.$set["email"];
                                    UpdateDoc.$set["formvalidated"] = false;
                                    throw new Error("email already in use by another user");
                                }
                            }
                            if (email.indexOf("@") > -1 || Config.NODE_ENV != "production") {
                                if (tuser.emailvalidated == true) {
                                    UpdateDoc.$set["validated"] = true;
                                    tuser.validated = true;
                                } else {
                                    const code = NoderedUtil.GetUniqueIdentifier();
                                    UpdateDoc.$set["_mailcode"] = code;
                                    this.sendEmail("validate", tuser._id, email, 'Validate email in OpenIAP flow',
                                        `Hi ${tuser.name}\nPlease use the below code to validate your email\n${code}`, span);
                                }
                            } else {
                                Logger.instanse.error(tuser.name + " email is mandatory)", span, {cls: "LoginProvider", func: "validateuserform"});
                                throw new Error("email is mandatory.");
                            }
                        } else {
                            UpdateDoc.$set["validated"] = true;
                            tuser.validated = true;
                        }


                        Logger.instanse.debug("Update user " + tuser.name + " information", span, {cls: "LoginProvider", func: "validateuserform"});
                        var res2 = await Config.db._UpdateOne({ "_id": tuser._id }, UpdateDoc, "users", 1, true, Crypt.rootToken(), span);
                        await Logger.DBHelper.CheckCache("users", tuser as any, false, false, span);
                    }
                    if (!(tuser.validated == true) && Config.validate_user_form != "") {
                        Logger.instanse.debug("User not validated, return no token for user " + tuser.name, span, {cls: "LoginProvider", func: "validateuserform"});
                        res.end(JSON.stringify({ jwt: "" }));
                    } else {
                        Logger.instanse.debug("Return new jwt for user " + tuser.name, span, {cls: "LoginProvider", func: "validateuserform"});
                        res.end(JSON.stringify({ jwt: Crypt.createToken(tuser, Config.longtoken_expires_in), user: tuser }));
                    }
                } else if (req.body) {
                    if (req.body.resend) {
                        var exists = await Config.db.query<User>({ query: { "_id": tuser._id, "_type": "user" }, collectionname: "users", jwt: Crypt.rootToken() }, span);
                        if (exists.length > 0) {
                            var u: User = exists[0];
                            let email: string = u.username;
                            if (u.email.indexOf("@") > -1) email = u.email;
                            (u as any)._mailcode = NoderedUtil.GetUniqueIdentifier();
                            this.sendEmail("validate", u._id, email, 'Validate email in OpenIAP flow',
                                `Hi ${u.name}\nPlease use the below code to validate your email\n${(u as any)._mailcode}`, span);


                            const UpdateDoc: any = { "$set": {} };
                            UpdateDoc.$set["_mailcode"] = (u as any)._mailcode;
                            var res2 = await Config.db._UpdateOne({ "_id": tuser._id }, UpdateDoc, "users", 1, true, Crypt.rootToken(), span);
                            await Logger.DBHelper.CheckCache("users", tuser as any, false, false, span);
                            res.end(JSON.stringify({ jwt: "" }));
                        } else {
                            res.end(JSON.stringify({ jwt: "" }));
                        }
                    } else if (req.body.code) {
                        var exists = await Config.db.query<User>({ query: { "_id": tuser._id, "_type": "user" }, collectionname: "users", jwt: Crypt.rootToken() }, span);
                        if (exists.length > 0) {
                            var u: User = exists[0];
                            if ((u as any)._mailcode == req.body.code) {
                                // @ts-ignore
                                delete u._mailcode;
                                u.validated = true;
                                u.emailvalidated = true;
                                await Logger.DBHelper.Save(u, Crypt.rootToken(), span);

                                // const UpdateDoc: any = { "$set": {}, "$unset": {} };
                                // UpdateDoc.$unset["_mailcode"] = "";
                                // UpdateDoc.$set["validated"] = true;
                                // UpdateDoc.$set["emailvalidated"] = true;
                                // var res2 = await Config.db._UpdateOne({ "_id": tuser._id }, UpdateDoc, "users", 1, true, Crypt.rootToken(), span);
                                await Logger.DBHelper.CheckCache("users", tuser as any, false, false, span);
                                res.end(JSON.stringify({ jwt: Crypt.createToken(tuser, Config.longtoken_expires_in), user: tuser }));
                                return;
                            } else {
                                throw new Error("Wrong validation code for " + tuser.name)
                            }
                        }
                        res.end(JSON.stringify({ jwt: "" }));
                    } else {
                        res.end(JSON.stringify({ jwt: "" }));
                    }

                }
            } else {
                Logger.instanse.error("User no longer signed in", span, {cls: "LoginProvider", func: "validateuserform"});
                res.end(JSON.stringify({ jwt: "" }));
            }
        } catch (error) {
            Logger.instanse.error(error, span, {cls: "LoginProvider", func: "validateuserform"});
            return res.status(500).send({ message: error.message ? error.message : error });
        }
        Logger.otel.endSpan(span);
        res.end();
    }
    static async post_forgotpassword(req: any, res) {
        const span: Span = Logger.otel.startSpanExpress("LoginProvider.postvalidateuserform", req);
        res.setHeader("Content-Type", "application/json");
        try {
            if (req.body && req.body.email) {
                const id = NoderedUtil.GetUniqueIdentifier();
                const email: string = req.body.email;
                let user = await Config.db.getbyusername(req.body.email, null, Crypt.rootToken(), true, span);
                if (user == null) {
                    Logger.instanse.error("Received unknown email " + email, span, {cls: "LoginProvider", func: "forgotpassword"});
                    return res.end(JSON.stringify({ id }));
                }
                const code = NoderedUtil.GetUniqueIdentifier();
                var key = ("forgotpass_" + id).toString();
                let item = await Logger.DBHelper.memoryCache.wrap(key, () => {
                    Logger.instanse.info(`Add forgotpass if ${id} with code ${code} for ${email}`, span, {cls: "LoginProvider", func: "forgotpassword"});
                    return { id, email, code };
                });
                if (item.id != id || item.email != email || item.code != code) {
                    Logger.instanse.error("Recevied wrong mail for id " + id, span, {cls: "LoginProvider", func: "forgotpassword"});
                    return res.end(JSON.stringify({ id }));
                }
                this.sendEmail("pwreset", user._id, email, 'Reset password request',
                    `Hi ${user.name}\nYour password for ${Config.domain} can be reset by using the below validation code\n\n${code}\n\nIf you did not request a new password, please ignore this email.`, span);
                await Logger.DBHelper.CheckCache("users", user, false, false, span);
                return res.end(JSON.stringify({ id }));
            }
            else if (req.body && req.body.code && req.body.id && !req.body.password) {
                const code: string = req.body.code.trim();
                const id: string = req.body.id;

                var key = ("forgotpass_" + id).toString();
                let item = await Logger.DBHelper.memoryCache.wrap(key, () => {
                    return null;
                });
                if (item == null || item.id != id || item.code != code) {
                    if (item == null) {
                        Logger.instanse.error("Recevied unknown id " + id, span, {cls: "LoginProvider", func: "forgotpassword"});
                    } else {
                        Logger.instanse.error("Recevied wrong code for id " + id, span, {cls: "LoginProvider", func: "forgotpassword"});
                    }
                    throw new Error("Recevied wrong code for id " + id);
                }
                return res.end(JSON.stringify({ id }));
            }
            else if (req.body && req.body.code && req.body.id && req.body.password) {
                const code: string = req.body.code.trim();
                const id: string = req.body.id;
                const password: string = req.body.password;

                var key = ("forgotpass_" + id).toString();
                let item = await Logger.DBHelper.memoryCache.wrap(key, () => {
                    Logger.instanse.debug("Add forgotpass : " + id, span, {cls: "LoginProvider", func: "forgotpassword"});
                    return null;
                });
                if (item == null || item.id != id || item.code != code) {
                    Logger.instanse.error("Recevied wrong code for id " + id, span, {cls: "LoginProvider", func: "forgotpassword"});
                    throw new Error("Recevied wrong code for id " + id);
                }
                let user = await Config.db.getbyusername<User>(item.email, null, Crypt.rootToken(), true, span);
                (user as any).newpassword = password;
                user.emailvalidated = true;
                user.validated = true;
                if (Config.validate_user_form != "") {
                    if (!user.formvalidated) user.validated = false;
                }
                if (Config.validate_emails) {
                    if (!user.emailvalidated) user.validated = false;
                }
                await Logger.DBHelper.Save(user, Crypt.rootToken(), span);
                await Logger.DBHelper.CheckCache("users", user as any, false, false, span);
                return res.end(JSON.stringify({ id }));
            }
            res.end(JSON.stringify({}));
        } catch (error) {
            Logger.instanse.error(error, span, {cls: "LoginProvider", func: "forgotpassword"});
            return res.status(500).send({ message: error.message ? error.message : error });
        }
        Logger.otel.endSpan(span);
        res.end();
    }
    static async get_loginproviders(req: any, res: any, next: any): Promise<void> {
        const span: Span = Logger.otel.startSpanExpress("LoginProvider.loginproviders", req);
        try {
            span?.setAttribute("remoteip", LoginProvider.remoteip(req));
            const result: Provider[] = await Logger.DBHelper.GetProviders(span);
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(result));
            res.end();
        } catch (error) {
            Logger.instanse.error(error, span, {cls: "LoginProvider", func: "loginproviders"});
            Logger.otel.endSpan(span);
            return res.status(500).send({ message: error.message ? error.message : error });
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    static async get_download(req, res) {
        const span: Span = Logger.otel.startSpanExpress("LoginProvider.download", req);
        try {
            span?.setAttribute("remoteip", LoginProvider.remoteip(req));
            let user: TokenUser = null;
            let jwt: string = null;
            const authHeader = req.headers.authorization;
            if (authHeader) {
                user = await Crypt.verityToken(authHeader);
                jwt = Crypt.createToken(user, Config.downloadtoken_expires_in);
            }
            else if (req.user) {
                user = TokenUser.From(req.user as any);
                jwt = Crypt.createToken(user, Config.downloadtoken_expires_in);
            }
            if (user == null) {
                return res.status(404).send({ message: 'Route ' + req.url + ' Not found.' });
            }

            const id = req.params.id;
            const rows = await Config.db.query({ query: { _id: safeObjectID(id) }, top: 1, collectionname: "files", jwt }, span);
            if (rows == null || rows.length != 1) { return res.status(404).send({ message: 'id ' + id + ' Not found.' }); }
            const file = rows[0] as any;

            const bucket = new GridFSBucket(Config.db.db);
            let downloadStream = bucket.openDownloadStream(safeObjectID(id));
            res.set('Content-Type', file.contentType);
            res.set('Content-Disposition', 'attachment; filename="' + file.filename + '"');
            res.set('Content-Length', file.length);
            downloadStream.on("error", function (err) {
                res.end();
            });
            downloadStream.pipe(res);
        } catch (error) {
            Logger.instanse.error(error, span, {cls: "LoginProvider", func: "download"});
            return res.status(500).send({ message: error.message ? error.message : error });
        } finally {
            Logger.otel.endSpan(span);
        }
    }
}