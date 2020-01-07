import * as crypto from "crypto";
import * as url from "url";
import * as winston from "winston";
import * as express from "express";
import * as cookieSession from "cookie-session";
import * as bodyParser from "body-parser";
import * as path from "path";

import * as SAMLStrategy from "passport-saml";
import * as GoogleStrategy from "passport-google-oauth20";
import * as LocalStrategy from "passport-local";
// import * as wsfed from "wsfed";

import * as passport from "passport";
import { Config } from "./Config";
import { User } from "./User";
import { Base, Rights, WellknownIds } from "./base";

import { TokenUser } from "./TokenUser";
import { Crypt } from "./Crypt";
import { Role } from "./Role";
import { Audit } from "./Audit";

import * as saml from "saml20";
import { SamlProvider } from "./SamlProvider";
import { Util } from "./Util";
// import { multer } from "multer";
// import { GridFsStorage } from "multer-gridfs-storage";
var multer = require('multer');
var GridFsStorage = require('multer-gridfs-storage');
import { GridFSBucket, ObjectID, Db, Cursor } from "mongodb";
const safeObjectID = (s: string | number | ObjectID) => ObjectID.isValid(s) ? new ObjectID(s) : null;

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

    public audience: string = null;
    public signatureAlgorithm: string = "sha256";
    public callbackMethod: string = "POST";
    public verify: any;
}
export class LoginProvider {
    private static _logger: winston.Logger;
    public static _providers: any = {};
    public static login_providers: Provider[] = [];

    public static redirect(res: any, originalUrl: string) {
        res.write('<!DOCTYPE html>');
        res.write('<body>');
        res.write('<script>top.location = "' + originalUrl + '";</script>');
        // res.write('<a href="' + originalUrl + '">click here</a>');
        res.write('</body>');
        res.write('</html>');
        res.end();
        // res.redirect(originalUrl);
    }


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

    static async getProviders(): Promise<any[]> {
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
        return result;
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

        app.use(function (req, res, next) {
            res.header('Access-Control-Allow-Origin', (req.headers.origin as any));
            res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
            res.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
            res.header('Expires', '-1');
            res.header('Pragma', 'no-cache');
            next();
        });

        app.get("/Signout", (req: any, res: any, next: any): void => {
            // var providerid: string = req.cookies.provider;
            // var provider: passport.Strategy;
            // if (providerid != null && providerid != undefined && providerid != "") {
            //     provider = LoginProvider._providers[providerid];
            // }
            // if (provider != null && provider != undefined) {
            //     (provider as any).logout(req, function (err, requestUrl) {
            //         // LOCAL logout
            //         req.logout();
            //         // redirect to the IdP with the encrypted SAML logout request
            //         res.redirect(requestUrl);
            //     });
            //     return;
            // }
            req.logout();
            var originalUrl: any = req.cookies.originalUrl;
            if (!Util.IsNullEmpty(originalUrl)) {
                res.cookie("originalUrl", "", { expires: new Date(0) });
                LoginProvider.redirect(res, originalUrl);
            } else {
                res.redirect("/");
            }
        });
        app.get("/PassiveSignout", (req: any, res: any, next: any): void => {
            req.logout();
            var originalUrl: any = req.cookies.originalUrl;
            if (!Util.IsNullEmpty(originalUrl)) {
                res.cookie("originalUrl", "", { expires: new Date(0) });
                LoginProvider.redirect(res, originalUrl);
            } else {
                res.redirect("/Login");
            }
        });
        await LoginProvider.RegisterProviders(app, baseurl);
        app.get("/jwt", (req: any, res: any, next: any): void => {
            res.setHeader("Content-Type", "application/json");
            if (req.user) {
                var user: TokenUser = new TokenUser(req.user);
                res.end(JSON.stringify({ jwt: Crypt.createToken(user, "5m"), user: user }));
            } else {
                res.end(JSON.stringify({ jwt: "" }));
            }
            res.end();
        });
        app.get("/jwtlong", (req: any, res: any, next: any): void => {
            res.setHeader("Content-Type", "application/json");
            if (req.user) {
                var user: TokenUser = new TokenUser(req.user);
                res.end(JSON.stringify({ jwt: Crypt.createToken(user, "365d"), user: user }));
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
                res.end(JSON.stringify({ jwt: Crypt.createToken(tuser, "5m") }));
            } catch (error) {
                res.end(error);
                console.error(error);
            }
        });
        app.get("/config", (req: any, res: any, next: any): void => {
            var _url: string = "";
            if (url.parse(baseurl).protocol == "http:") {
                _url = "ws://" + url.parse(baseurl).host;
            } else {
                _url = "wss://" + url.parse(baseurl).host;
            }
            _url += "/";
            var res2 = {
                wshost: _url,
                domain: Config.domain,
                allow_user_registration: Config.allow_user_registration,
                allow_personal_nodered: Config.allow_personal_nodered,
                auto_create_personal_nodered_group: Config.auto_create_personal_nodered_group,
                namespace: Config.namespace,
                nodered_domain_schema: Config.nodered_domain_schema,
                websocket_package_size: Config.websocket_package_size,
                version: Config.version
            }
            res.end(JSON.stringify(res2));
        });
        app.get("/login", async (req: any, res: any, next: any): Promise<void> => {
            try {
                res.cookie("originalUrl", req.originalUrl, { maxAge: 900000, httpOnly: true });
                var file = path.join(__dirname, 'public', 'PassiveLogin.html');
                res.sendFile(file);
                // var result: any[] = await this.getProviders();
                // res.setHeader("Content-Type", "application/json");
                // res.end(JSON.stringify(result));
                // res.end();
            } catch (error) {
                res.end(error);
                console.error(error);
            }
            try {
                LoginProvider.RegisterProviders(app, baseurl);
            } catch (error) {
            }
        });
        app.get("/loginproviders", async (req: any, res: any, next: any): Promise<void> => {
            try {
                var result: any[] = await this.getProviders();
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify(result));
                res.end();
            } catch (error) {
                res.end(error);
                console.error(error);
            }
            try {
                LoginProvider.RegisterProviders(app, baseurl);
            } catch (error) {
            }
        });


        app.get("/download/:id", async (req, res) => {
            try {
                var user: TokenUser = null;
                var jwt: string = null;
                var authHeader = req.headers.authorization;
                if (authHeader) {
                    user = Crypt.verityToken(authHeader);
                    jwt = Crypt.createToken(user, "15m");
                }
                else if (req.user) {
                    user = new TokenUser(req.user as any);
                    jwt = Crypt.createToken(user, "15m");
                }
                if (user == null) {
                    return res.status(404).send({ message: 'Route ' + req.url + ' Not found.' });
                }

                var id = req.params.id;
                var rows = await Config.db.query({ _id: safeObjectID(id) }, null, 1, 0, null, "files", jwt);
                if (rows == null || rows.length != 1) { return res.status(404).send({ message: 'id ' + id + ' Not found.' }); }
                var file = rows[0] as any;

                var bucket = new GridFSBucket(Config.db.db);
                let downloadStream = bucket.openDownloadStream(safeObjectID(id));
                res.set('Content-Type', file.contentType);
                res.set('Content-Disposition', 'attachment; filename="' + file.filename + '"');
                res.set('Content-Length', file.length);
                downloadStream.on("error", function (err) {
                    res.end();
                });
                downloadStream.pipe(res);
            } catch (error) {
                return res.status(500).send({ message: error });
            }
        });
        try {

            var t = new Role();

            var storage = GridFsStorage({
                db: Config.db,
                file: (req, file) => {
                    return new Promise((resolve, reject) => {
                        crypto.randomBytes(16, (err, buf) => {
                            if (err) {
                                return reject(err);
                            }
                            // const filename = buf.toString('hex') + path.extname(file.originalname);
                            const filename = file.originalname;
                            const fileInfo = {
                                filename: filename,
                                metadata: new Base()
                            };
                            var user: TokenUser = null;
                            var jwt: string = null;
                            var authHeader = req.headers.authorization;
                            if (authHeader) {
                                user = Crypt.verityToken(authHeader);
                                jwt = Crypt.createToken(user, "15m");
                            }
                            else if (req.user) {
                                user = new TokenUser(req.user);
                                jwt = Crypt.createToken(user, "15m");
                            }

                            fileInfo.metadata.name = file.originalname;
                            (fileInfo.metadata as any).filename = file.originalname;
                            (fileInfo.metadata as any).path = "";
                            fileInfo.metadata._acl = [];
                            fileInfo.metadata._createdby = user.name;
                            fileInfo.metadata._createdbyid = user._id;
                            fileInfo.metadata._created = new Date(new Date().toISOString());
                            fileInfo.metadata._modifiedby = user.name;
                            fileInfo.metadata._modifiedbyid = user._id;
                            fileInfo.metadata._modified = fileInfo.metadata._created;
                            fileInfo.metadata.addRight(user._id, user.name, [Rights.full_control]);
                            fileInfo.metadata.addRight(WellknownIds.filestore_admins, "filestore admins", [Rights.full_control]);
                            fileInfo.metadata.addRight(WellknownIds.filestore_users, "filestore users", [Rights.read]);

                            resolve(fileInfo);
                        });
                    });
                },
            });
            var upload = multer({ //multer settings for single upload
                storage: storage
            }).any();

            app.post("/upload", async (req, res) => {
                var user: TokenUser = null;
                var jwt: string = null;
                var authHeader = req.headers.authorization;
                if (authHeader) {
                    user = Crypt.verityToken(authHeader);
                    jwt = Crypt.createToken(user, "15m");
                }
                else if (req.user) {
                    user = new TokenUser(req.user as any);
                    jwt = Crypt.createToken(user, "15m");
                }
                if (user == null) {
                    return res.status(404).send({ message: 'Route ' + req.url + ' Not found.' });
                }

                upload(req, res, function (err) {
                    if (err) {
                        res.json({ error_code: 1, err_desc: err });
                        return;
                    }
                    LoginProvider.redirect(res, req.headers.referer);
                    // res.json({ error_code: 0, err_desc: null });
                });
            });
        } catch (error) {
            console.error(error);
        }

    }
    static async RegisterProviders(app: express.Express, baseurl: string) {
        if (LoginProvider.login_providers.length === 0) {
            LoginProvider.login_providers = await Config.db.query<Provider>({ _type: "provider" }, null, 10, 0, null, "config", TokenUser.rootToken());
        }
        var hasLocal: boolean = false;
        if (LoginProvider.login_providers.length === 0) { hasLocal = true; }
        LoginProvider.login_providers.forEach(async (provider) => {
            try {
                if (Util.IsNullUndefinded(LoginProvider._providers[provider.id])) {
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
            if (Util.IsNullUndefinded(LoginProvider._providers.local)) {
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
                res.cookie("provider", key, { maxAge: 900000, httpOnly: true });
                if (!Util.IsNullEmpty(originalUrl)) {
                    res.cookie("originalUrl", "", { expires: new Date(0) });
                    LoginProvider.redirect(res, originalUrl);
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

        // app.get("/" + key + "/FederationMetadata/2007-06/FederationMetadata.xml",
        //     wsfed.metadata({
        //         cert: Buffer.from(Config.signing_crt, "base64").toString("ascii"),
        //         issuer: issuer
        //     }));
        var CertPEM = Buffer.from(Config.signing_crt, "base64").toString("ascii").replace(/(-----(BEGIN|END) CERTIFICATE-----|\n)/g, '');
        app.get("/" + key + "/FederationMetadata/2007-06/FederationMetadata.xml",
            (req: express.Request, res: express.Response, next: express.NextFunction) => {
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
            });
        app.use("/" + key,
            bodyParser.urlencoded({ extended: false }),
            passport.authenticate(key, { failureRedirect: "/" + key, failureFlash: true }),
            function (req: any, res: any): void {
                var originalUrl: any = req.cookies.originalUrl;
                res.cookie("provider", key, { maxAge: 900000, httpOnly: true });
                if (!Util.IsNullEmpty(originalUrl)) {
                    res.cookie("originalUrl", "", { expires: new Date(0) });
                    LoginProvider.redirect(res, originalUrl);
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
                            Audit.LoginFailed(username, "weblogin", "local", "", "browser", "unknown");
                            return done(null, false);
                        }
                    }
                    Audit.LoginSuccess(new TokenUser(user), "weblogin", "local", "", "browser", "unknown");
                    var provider: Provider = new Provider(); provider.provider = "local"; provider.name = "Local";
                    provider = await Config.db.InsertOne(provider, "config", 0, false, TokenUser.rootToken());
                    LoginProvider.login_providers.push(provider);
                    tuser = new TokenUser(user);
                    return done(null, tuser);
                }
                user = await User.FindByUsername(username);
                if (Util.IsNullUndefinded(user)) {
                    if (!Config.allow_user_registration) {
                        return done(null, false);
                    }
                    user = await User.ensureUser(TokenUser.rootToken(), username, username, null, password);
                } else {
                    if (!(await user.ValidatePassword(password))) {
                        Audit.LoginFailed(username, "weblogin", "local", "", "browser", "unknown");
                        return done(null, false);
                    }
                }
                tuser = new TokenUser(user);
                Audit.LoginSuccess(tuser, "weblogin", "local", "", "browser", "unknown");
                return done(null, tuser);
            } catch (error) {
                done(error);
                console.error(error);
            }
        });
        passport.use("local", strategy);
        // http://www.passportjs.org/docs/authenticate/#custom-callback
        // app.use("/local",
        //     bodyParser.urlencoded({ extended: false }),
        //     //passport.authenticate("local", { failureRedirect: "/login?failed=true", failureFlash: true }),
        //     passport.authenticate("local", { failureRedirect: "/" }),
        //     function (req: any, res: any): void {
        //         var originalUrl: any = req.cookies.originalUrl;
        //         if (!Util.IsNullEmpty(originalUrl)) {
        //             res.cookie("originalUrl", "", { expires: new Date(0) });
        //             LoginProvider.redirect(res, originalUrl);
        //         } else {
        //             res.redirect("/");
        //         }
        //     }
        // );
        app.use("/local",
            bodyParser.urlencoded({ extended: false }),
            function (req: any, res: any, next: any): void {
                passport.authenticate("local", function (err, user, info) {
                    var originalUrl: any = req.cookies.originalUrl;
                    if (!err && user) {
                        req.logIn(user, function (err: any) {
                            if (err) { }
                            // if (err) { return next(err); }
                            if (!Util.IsNullEmpty(originalUrl)) {
                                try {
                                    res.cookie("originalUrl", "", { expires: new Date(0) });
                                    LoginProvider.redirect(res, originalUrl);
                                } catch (error) {
                                    console.error(error);
                                }
                            } else {
                                res.redirect("/");
                            }
                        });
                    }
                    if (!Util.IsNullEmpty(originalUrl)) {
                        if (originalUrl.indexOf("?") == -1) {
                            originalUrl = originalUrl + "?error=1"
                        } else if (originalUrl.indexOf("error=1") == -1) {
                            originalUrl = originalUrl + "&error=1"
                        }
                        try {
                            res.cookie("originalUrl", "", { expires: new Date(0) });
                            LoginProvider.redirect(res, originalUrl);
                        } catch (error) {
                            console.error(error);
                        }
                    } else {
                        try {
                            res.redirect("/");
                        } catch (error) {
                            console.error(error);
                        }
                    }
                })(req, res, next);
            }
        );

        return strategy;
    }
    static async samlverify(profile: any, done: IVerifyFunction): Promise<void> {
        var username: string = (profile.nameID || profile.username);
        if (username !== null && username != undefined) { username = username.toLowerCase(); }
        this._logger.debug("verify: " + username);
        var _user: User = await User.FindByUsernameOrFederationid(username);

        if (Util.IsNullUndefinded(_user)) {
            var createUser: boolean = Config.auto_create_users;
            if (Config.auto_create_domains.map(x => username.endsWith(x)).length == -1) { createUser = false; }
            if (createUser) {
                _user = new User(); _user.name = profile.name;
                if (!Util.IsNullEmpty(profile["http://schemas.microsoft.com/identity/claims/displayname"])) {
                    _user.name = profile["http://schemas.microsoft.com/identity/claims/displayname"];
                }
                if (!Util.IsNullEmpty(profile["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"])) {
                    _user.name = profile["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"];
                }
                _user.username = username;
                if (!Util.IsNullEmpty(profile["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/mobile"])) {
                    (_user as any).mobile = profile["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/mobile"];
                }
                if (Util.IsNullEmpty(_user.name)) { done("Cannot add new user, name is empty, please add displayname to claims", null); return; }
                // _user = await Config.db.InsertOne(_user, "users", 0, false, TokenUser.rootToken());
                var jwt: string = TokenUser.rootToken();
                _user = await User.ensureUser(jwt, _user.name, _user.username, null, null);
            }
        } else {
            if (!Util.IsNullUndefinded(_user)) {
                if (!Util.IsNullEmpty(profile["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/mobile"])) {
                    (_user as any).mobile = profile["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/mobile"];
                }
                var jwt: string = TokenUser.rootToken();
                await _user.Save(jwt);
            }
        }

        if (!Util.IsNullUndefinded(_user)) {
            if (!Util.IsNullEmpty(profile["http://schemas.xmlsoap.org/claims/Group"])) {
                var jwt: string = TokenUser.rootToken();
                var strroles: string[] = profile["http://schemas.xmlsoap.org/claims/Group"];
                for (var i = 0; i < strroles.length; i++) {
                    var role: Role = await Role.FindByNameOrId(strroles[i], jwt);
                    if (!Util.IsNullUndefinded(role)) {
                        role.AddMember(_user);
                        await role.Save(jwt);
                    }
                }
                await _user.DecorateWithRoles();
            }
        }

        if (Util.IsNullUndefinded(_user)) {
            Audit.LoginFailed(username, "weblogin", "saml", "", "samlverify", "unknown");
            done("unknown user " + username, null); return;
        }

        var tuser: TokenUser = new TokenUser(_user);
        Audit.LoginSuccess(tuser, "weblogin", "saml", "", "samlverify", "unknown");
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
        if (Util.IsNullUndefinded(_user)) {
            var createUser: boolean = Config.auto_create_users;
            if (Config.auto_create_domains.map(x => username.endsWith(x)).length == -1) { createUser = false; }
            if (createUser) {
                var jwt: string = TokenUser.rootToken();
                _user = new User(); _user.name = profile.name;
                if (!Util.IsNullEmpty(profile.displayName)) { _user.name = profile.displayName; }
                _user.username = username;
                (_user as any).mobile = profile.mobile;
                if (Util.IsNullEmpty(_user.name)) { done("Cannot add new user, name is empty.", null); return; }
                var jwt: string = TokenUser.rootToken();
                _user = await User.ensureUser(jwt, _user.name, _user.username, null, null);
            }
        }
        if (Util.IsNullUndefinded(_user)) {
            Audit.LoginFailed(username, "weblogin", "google", "", "googleverify", "unknown");
            done("unknown user " + username, null); return;
        }
        var tuser: TokenUser = new TokenUser(_user);
        Audit.LoginSuccess(tuser, "weblogin", "google", "", "googleverify", "unknown");
        done(null, tuser);
    }


}