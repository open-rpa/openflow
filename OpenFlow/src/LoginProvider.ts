import * as url from "url";
import * as winston from "winston";
import * as express from "express";
import * as cookieSession from "cookie-session";
import * as bodyParser from "body-parser";

import * as SAMLStrategy from "passport-saml";
import * as GoogleStrategy from "passport-google-oauth20";
import * as LocalStrategy from "passport-local";

import * as passport from "passport";
import { Config } from "./Config";
import { User } from "./User";
import { Base } from "./base";
import { TokenUser } from "./TokenUser";
import { Crypt } from "./Crypt";
import { Role } from "./Role";
import { Audit } from "./Audit";

import * as saml from "saml20";
import { SamlProvider } from "./SamlProvider";

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

    public audience: string = null;
    public signatureAlgorithm: string = "sha256";
    public callbackMethod: string = "POST";
    public verify: any;
}
export class LoginProvider {
    private static _logger: winston.Logger;
    private static _providers: any = {};
    private static login_providers: Provider[] = [];

    static async validateToken(rawAssertion: string): Promise<User> {
        return new Promise<User>((resolve, reject) => {
            var options = {
                publicKey: Buffer.from(Config.signing_crt, "base64").toString("ascii")
            }
            saml.validate(rawAssertion, options, async (err, profile) => {
                try {
                    if (err) { return reject(err); }
                    var claims = profile.claims;

                    var claims = profile.claims; // Array of user attributes;
                    var issuer = profile.issuer; // String Issuer name.
                    var username = claims["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier"] ||
                        claims["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"] ||
                        claims["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"];

                    var user = await User.FindByUsername(username);
                    if (user) {
                        resolve(user);
                    } else {
                        reject("Unknown user");
                    }
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    static async configure(logger: winston.Logger, app: express.Express, baseurl: string): Promise<void> {
        this._logger = logger;
        app.use(cookieSession({
            name: "session",
            keys: ["key1", "key2"]
        }));

        app.use(passport.initialize());
        app.use(passport.session());
        passport.serializeUser(async function (user: any, done: any): Promise<void> {
            done(null, user);
        });
        passport.deserializeUser(function (user: any, done: any): void {
            done(null, user);
            // Audit.LoginSuccess(new TokenUser(user), "weblogin", "cookie", "");
        });

        app.get("/Signout", (req: any, res: any, next: any): void => {
            req.logout();
            res.redirect("/");
        });
        await LoginProvider.RegisterProviders(app, baseurl);
        app.get("/jwt", (req: any, res: any, next: any): void => {
            res.setHeader("Content-Type", "application/json");
            if (req.user) {
                var user: TokenUser = new TokenUser(req.user);
                res.end(JSON.stringify({ jwt: Crypt.createToken(user) }));
            } else {
                res.end(JSON.stringify({ jwt: "" }));
            }
            res.end();
        });
        app.post("/jwt", async (req: any, res: any, next: any): Promise<void> => {
            try {
                var rawAssertion = req.body.token;
                var user: User = await LoginProvider.validateToken(rawAssertion);
                var tuser: TokenUser = new TokenUser(user);
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ jwt: Crypt.createToken(tuser) }));
            } catch (error) {
                res.end(error);
            }
        });
        app.get("/config", (req: any, res: any, next: any): void => {
            var _url: string = "";
            if (url.parse(baseurl).protocol == "http:") {
                _url = "ws://" + url.parse(baseurl).host + "/ws";
            } else {
                _url = "wss://" + url.parse(baseurl).host + "/ws";
            }
            _url += "/";
            var res2 = {
                wshost: _url
            }
            res.end(JSON.stringify(res2));
        });
        app.get("/loginproviders", async (req: any, res: any, next: any): Promise<void> => {
            LoginProvider.login_providers = await Config.db.query<Provider>({ _type: "provider" }, null, 10, 0, null, "config", TokenUser.rootToken());
            var result: any[] = [];
            LoginProvider.login_providers.forEach(provider => {
                var item: any = { name: provider.name, id: provider.id, provider: provider.provider, logo: "fa-question-circle" };
                if (provider.provider === "google") { item.logo = "fa-google"; }
                if (provider.provider === "saml") { item.logo = "fa-windows"; }
                result.push(item);
            });
            if (result.length === 0) {
                var item: any = { name: "Local", id: "local", provider: "local", logo: "fa-question-circle" };
                result.push(item);
            }
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(result));
            res.end();
            LoginProvider.RegisterProviders(app, baseurl);
        });
    }
    static async RegisterProviders(app: express.Express, baseurl: string) {
        if (LoginProvider.login_providers.length === 0) {
            LoginProvider.login_providers = await Config.db.query<Provider>({ _type: "provider" }, null, 10, 0, null, "config", TokenUser.rootToken());
        }
        var hasLocal: boolean = false;
        if (LoginProvider.login_providers.length === 0) { hasLocal = true; }
        LoginProvider.login_providers.forEach(async (provider) => {
            try {
                if (LoginProvider._providers[provider.id] === undefined) {
                    if (provider.provider === "saml") {
                        var metadata: any = await Config.parse_federation_metadata(provider.saml_federation_metadata);
                        LoginProvider._providers[provider.id] =
                            LoginProvider.CreateSAMLStrategy(app, provider.id, metadata.cert,
                                metadata.identityProviderUrl, provider.issuer, baseurl);
                    }
                    if (provider.provider === "google") {
                        LoginProvider._providers[provider.id] =
                            LoginProvider.CreateGoogleStrategy(app, provider.id, provider.consumerKey, provider.consumerSecret, baseurl);
                    }
                }
                if (provider.provider === "local") { hasLocal = true; }
            } catch (error) {
                console.error(error);
            }
        });
        if (hasLocal === true) {
            if (LoginProvider._providers.local === undefined) {
                LoginProvider._providers.local = LoginProvider.CreateLocalStrategy(app, baseurl);
            }
        }
    }
    static CreateGoogleStrategy(app: express.Express, key: string, consumerKey: string, consumerSecret: string, baseurl: string): any {
        var strategy: passport.Strategy = null;
        var options: googleauthstrategyoptions = new googleauthstrategyoptions();
        options.clientID = consumerKey;
        options.clientSecret = consumerSecret;
        options.callbackURL = url.parse(baseurl).protocol + "//" + url.parse(baseurl).host + "/" + key + "/";
        options.verify = (LoginProvider.googleverify).bind(this);
        strategy = new GoogleStrategy.Strategy(options, options.verify);
        passport.use(key, strategy);
        strategy.name = key;
        this._logger.info(options.callbackURL);
        app.use("/" + key,
            bodyParser.urlencoded({ extended: false }),
            passport.authenticate(key, { failureRedirect: "/" + key, failureFlash: true }),
            function (req: any, res: any): void {
                var originalUrl: any = req.cookies.originalUrl;
                if (originalUrl !== undefined && originalUrl !== null) {
                    res.cookie("originalUrl", "", { expires: new Date() });
                    res.redirect(originalUrl);
                } else {
                    res.redirect("/");
                }
            }
        );
        return strategy;
    }

    // tslint:disable-next-line: max-line-length
    static CreateSAMLStrategy(app: express.Express, key: string, cert: string, singin_url: string, issuer: string, baseurl: string): passport.Strategy {
        var strategy: passport.Strategy = null;
        var options: samlauthstrategyoptions = new samlauthstrategyoptions();
        options.entryPoint = singin_url;
        options.cert = cert;
        options.issuer = issuer;
        options.callbackUrl = url.parse(baseurl).protocol + "//" + url.parse(baseurl).host + "/" + key + "/";
        options.verify = (LoginProvider.samlverify).bind(this);
        strategy = new SAMLStrategy.Strategy(options, options.verify);
        passport.use(key, strategy);
        strategy.name = key;
        this._logger.info(options.callbackUrl);

        app.use("/" + key,
            bodyParser.urlencoded({ extended: false }),
            passport.authenticate(key, { failureRedirect: "/" + key, failureFlash: true }),
            function (req: any, res: any): void {
                var originalUrl: any = req.cookies.originalUrl;
                if (originalUrl !== undefined && originalUrl !== null) {
                    res.cookie("originalUrl", "", { expires: new Date() });
                    res.redirect(originalUrl);
                } else {
                    res.redirect("/");
                }
            }
        );
        return strategy;
    }

    static CreateLocalStrategy(app: express.Express, baseurl: string): passport.Strategy {
        var strategy: passport.Strategy = new LocalStrategy(async (username: string, password: string, done: any): Promise<void> => {
            try {
                if (username !== null && username != undefined) { username = username.toLowerCase(); }
                var user: User = null;
                var tuser: TokenUser = null;
                if (LoginProvider.login_providers.length === 0) {
                    user = await User.FindByUsername(username);
                    if (user == null) {
                        user = new User(); user.name = username; user.username = username;
                        await user.SetPassword(password);
                        user = await Config.db.InsertOne(user, "users", 0, false, TokenUser.rootToken());
                        var admins: Role = await Role.FindByNameOrId("admins", TokenUser.rootToken());
                        admins.AddMember(user);
                        await admins.Save(TokenUser.rootToken())
                    } else {
                        if (!(await user.ValidatePassword(password))) {
                            Audit.LoginFailed(username, "weblogin", "local", "");
                            return done(null, false);
                        }
                    }
                    Audit.LoginSuccess(new TokenUser(user), "weblogin", "local", "");
                    var provider: Provider = new Provider(); provider.provider = "local"; provider.name = "Local";
                    provider = await Config.db.InsertOne(provider, "config", 0, false, TokenUser.rootToken());
                    LoginProvider.login_providers.push(provider);
                    tuser = new TokenUser(user);
                    return done(null, tuser);
                }
                user = await User.FindByUsername(username);
                if (user === undefined || user === null) { return done(null, false); }
                if (!(await user.ValidatePassword(password))) {
                    Audit.LoginFailed(username, "weblogin", "local", "");
                    return done(null, false);
                }
                tuser = new TokenUser(user);
                Audit.LoginSuccess(tuser, "weblogin", "local", "");
                return done(null, tuser);
            } catch (error) {
                done(error);
            }
        });
        passport.use("local", strategy);
        app.use("/local",
            bodyParser.urlencoded({ extended: false }),
            //passport.authenticate("local", { failureRedirect: "/login?failed=true", failureFlash: true }),
            passport.authenticate("local", { failureRedirect: "/" }),
            function (req: any, res: any): void {
                var originalUrl: any = req.cookies.originalUrl;
                if (originalUrl !== undefined && originalUrl !== null) {
                    res.cookie("originalUrl", "", { expires: new Date() });
                    res.redirect(originalUrl);
                } else {
                    res.redirect("/");
                }
            }
        );
        return strategy;
    }
    static async samlverify(profile: any, done: IVerifyFunction): Promise<void> {
        var username: string = (profile.nameID || profile.username);
        if (username !== null && username != undefined) { username = username.toLowerCase(); }
        this._logger.debug("verify: " + username);
        var _user: User = await User.FindByUsernameOrFederationid(username);
        if (_user === undefined || _user === null) {
            var createUser: boolean = Config.auto_create_users;
            if (Config.auto_create_domains.map(x => username.endsWith(x)).length == -1) { createUser = false; }
            if (createUser) {
                _user = new User(); _user.name = profile.name;
                if (profile["http://schemas.microsoft.com/identity/claims/displayname"] !== undefined) {
                    _user.name = profile["http://schemas.microsoft.com/identity/claims/displayname"];
                }
                _user.username = username;
                _user = await Config.db.InsertOne(_user, "users", 0, false, TokenUser.rootToken());
            }
        }

        if (_user === undefined || _user === null) {
            Audit.LoginFailed(username, "weblogin", "saml", "");
            done("unknown user " + username, null); return;
        }

        var tuser: TokenUser = new TokenUser(_user);
        Audit.LoginSuccess(tuser, "weblogin", "saml", "");
        done(null, tuser);
    }
    static async googleverify(token: string, tokenSecret: string, profile: any, done: IVerifyFunction): Promise<void> {
        if (profile.emails) {
            var email: any = profile.emails[0];
            profile.username = email.value;
        }
        var username: string = (profile.username || profile.id);
        if (username !== null && username != undefined) { username = username.toLowerCase(); }
        this._logger.debug("verify: " + username);
        var _user: User = await User.FindByUsernameOrFederationid(username);
        if (_user === undefined || _user === null) {
            var createUser: boolean = Config.auto_create_users;
            if (Config.auto_create_domains.map(x => username.endsWith(x)).length == -1) { createUser = false; }
            if (createUser) {
                var jwt: string = TokenUser.rootToken();
                _user = new User(); _user.name = profile.name;
                if (profile.displayName !== undefined) { _user.name = profile.displayName; }
                _user.username = username;
                _user = await Config.db.InsertOne(_user, "users", 0, false, jwt);
                var users: Role = await Role.FindByNameOrId("users", jwt);
                users.AddMember(_user);
                await users.Save(jwt)
            }
        }
        if (_user === undefined || _user === null) {
            Audit.LoginFailed(username, "weblogin", "google", "");
            done("unknown user " + username, null); return;
        }
        var tuser: TokenUser = new TokenUser(_user);
        Audit.LoginSuccess(tuser, "weblogin", "google", "");
        done(null, tuser);
    }


}