import * as crypto from "crypto";
import * as url from "url";
import * as express from "express";
import * as path from "path";

// import * as SAMLStrategy from "passport-saml";
import * as GoogleStrategy from "passport-google-oauth20";
import * as LocalStrategy from "passport-local";


import * as passport from "passport";
import { Config } from "./Config";

import { Crypt } from "./Crypt";
import { Audit } from "./Audit";

import * as saml from "saml20";
const multer = require('multer');
const GridFsStorage = require('multer-gridfs-storage');
import { GridFSBucket, ObjectID, Db, Cursor, Binary } from "mongodb";
import { Base, User, NoderedUtil, TokenUser, WellknownIds, Rights, Role } from "@openiap/openflow-api";
import { DBHelper } from "./DBHelper";
import { Span } from "@opentelemetry/api";
import { Logger } from "./Logger";
import { Auth } from "./Auth";
import { WebServer } from "./WebServer";
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
    public signatureAlgorithm: 'sha1' | 'sha256' | 'sha512' = "sha256";
    public callbackMethod: string = "POST";
    public verify: any;
}
export class LoginProvider {
    public static _providers: any = {};
    public static login_providers: Provider[] = [];

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
        // res.write('<script>top.location = "' + encodeURI(originalUrl) + '";</script>');
        res.write('<script>top.location = "' + LoginProvider.escape(originalUrl) + '";</script>');
        // res.write('<a href="' + originalUrl + '">click here</a>');
        res.write('</body>');
        res.write('</html>');
        res.end();
        // res.redirect(originalUrl);
    }


    static async validateToken(rawAssertion: string, parent: Span): Promise<User> {
        const span: Span = Logger.otel.startSubSpan("LoginProvider.validateToken", parent);
        return new Promise<User>((resolve, reject) => {
            try {
                const options = {
                    publicKey: Buffer.from(Config.signing_crt, "base64").toString("ascii")
                }
                saml.validate(rawAssertion, options, async (err, profile) => {
                    try {
                        if (err) { span.recordException(err); return reject(err); }
                        const claims = profile.claims; // Array of user attributes;
                        const username = claims["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier"] ||
                            claims["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"] ||
                            claims["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"];

                        const user = await DBHelper.FindByUsername(username, null, span);
                        if (user) {
                            resolve(user);
                        } else {
                            span.recordException("Unknown user");
                            reject("Unknown user");
                        }
                    } catch (error) {
                        span.recordException(error);
                        reject(error);
                    } finally {
                        Logger.otel.endSpan(span);
                    }

                });
            } catch (error) {
                span.recordException(error);
            } finally {
                Logger.otel.endSpan(span);
            }
        });
    }

    static async getProviders(parent: Span): Promise<any[]> {
        const span: Span = Logger.otel.startSubSpan("LoginProvider.getProviders", parent);
        try {
            LoginProvider.login_providers = await Config.db.query<Provider>({ _type: "provider" }, null, 10, 0, null, "config", Crypt.rootToken(), undefined, undefined, span);
            const result: any[] = [];
            LoginProvider.login_providers.forEach(provider => {
                const item: any = { name: provider.name, id: provider.id, provider: provider.provider, logo: "fa-question-circle" };
                if (provider.provider === "google") { item.logo = "fa-google"; }
                if (provider.provider === "saml") { item.logo = "fa-windows"; }
                result.push(item);
            });
            if (result.length === 0) {
                const item: any = { name: "Local", id: "local", provider: "local", logo: "fa-question-circle" };
                result.push(item);
            }
            return result;
        } catch (error) {
            span.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    static async configure(app: express.Express, baseurl: string): Promise<void> {
        app.use(passport.initialize());
        app.use(passport.session());
        passport.serializeUser(async function (user: any, done: any): Promise<void> {
            done(null, user);
        });
        passport.deserializeUser(function (user: any, done: any): void {
            done(null, user);
        });

        app.use(function (req, res, next) {
            const origin: string = (req.headers.origin as any);
            if (NoderedUtil.IsNullEmpty(origin)) {
                res.header('Access-Control-Allow-Origin', '*');
            } else {
                res.header('Access-Control-Allow-Origin', origin);
            }
            res.header("Access-Control-Allow-Methods", "DELETE, POST, PUT, GET, OPTIONS");
            res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Access-Control-Allow-Headers, Authorization");
            res.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
            res.header('Expires', '-1');
            res.header('Pragma', 'no-cache');
            if (req.originalUrl == "/oidc/me" && req.method == "OPTIONS") {
                res.send("ok");
            } else {
                next();
            }
        });
        app.get("/dashboardauth", async (req: any, res: any, next: any) => {
            const span: Span = Logger.otel.startSpan("LoginProvider.user");
            try {
                span.setAttribute("remoteip", WebServer.remoteip(req));
                if (req.user) {
                    const user: TokenUser = TokenUser.From(req.user);
                    span.setAttribute("username", user.username);
                    if (user != null) {
                        const allowed = user.roles.filter(x => x.name == "dashboardusers" || x.name == "admins");
                        if (allowed.length > 0) {
                            Logger.instanse.info("dashboardauth: Authorized " + user.username + " for " + req.url);
                            return res.send({
                                status: "success",
                                display_status: "Success",
                                message: "Connection OK"
                            });
                        } else {
                            console.warn("dashboardauth: " + user.username + " is not member of 'dashboardusers' for " + req.url);
                        }
                    }
                }
                const authorization: string = req.headers.authorization;
                if (!NoderedUtil.IsNullEmpty(authorization) && authorization.indexOf(" ") > 1 &&
                    (authorization.toLocaleLowerCase().startsWith("bearer") || authorization.toLocaleLowerCase().startsWith("jwt"))) {
                    const token = authorization.split(" ")[1];
                    let user: User = Auth.getUser(token, "dashboard");
                    let tuser: TokenUser;
                    if (user == null) {
                        try {
                            user = await LoginProvider.validateToken(token, span);
                            tuser = TokenUser.From(user);
                        } catch (error) {
                        }
                    }
                    if (user == null) {
                        try {
                            tuser = Crypt.verityToken(token);
                            user = await DBHelper.FindById(user._id, undefined, span);
                        } catch (error) {
                        }
                    }
                    if (user != null) {
                        const allowed = user.roles.filter(x => x.name == "dashboardusers" || x.name == "admins");
                        if (allowed.length > 0) {
                            await Auth.AddUser(user, token, "dashboard");
                            // Logger.instanse.info("dashboardauth: Authorized " + user.username + " for " + req.url);
                            return res.send({
                                status: "success",
                                display_status: "Success",
                                message: "Connection OK"
                            });
                        } else {
                            console.warn("dashboardauth: " + user.username + " is not member of 'dashboardusers' for " + req.url);
                        }
                    }
                    res.statusCode = 401;
                    res.end('Unauthorized');
                    return;
                }

                // parse login and password from headers
                const b64auth = (authorization || '').split(' ')[1] || ''
                // const [login, password] = new Buffer(b64auth, 'base64').toString().split(':')
                const [login, password] = Buffer.from(b64auth, "base64").toString().split(':')
                if (login && password) {
                    span.setAttribute("username", login);
                    let user: User = Auth.getUser(login + ":" + password, "dashboard");
                    if (user == null) user = await Auth.ValidateByPassword(login, password, span);
                    if (user != null) {
                        const allowed = user.roles.filter(x => x.name == "dashboardusers" || x.name == "admins");
                        if (allowed.length > 0) {
                            // Logger.instanse.info("dashboardauth: Authorized " + user.username + " for " + req.url);
                            Auth.AddUser(user, login + ":" + password, "dashboard");
                            return res.send({
                                status: "success",
                                display_status: "Success",
                                message: "Connection OK"
                            });
                        } else {
                            console.warn("dashboardauth: " + user.username + " is not member of 'dashboardusers' for " + req.url);
                        }
                    }
                } else {
                    Logger.instanse.warn("dashboardauth: Unauthorized, no username/password for " + req.url);
                }
                res.statusCode = 401;
                res.setHeader('WWW-Authenticate', 'Basic realm="OpenFlow"');
                res.end('Unauthorized');
            } catch (error) {
                span.recordException(error);
                throw error;
            } finally {
                Logger.otel.endSpan(span);
            }
        });
        app.get("/Signout", (req: any, res: any, next: any): void => {
            // const providerid: string = req.cookies.provider;
            // const provider: passport.Strategy;
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
            const originalUrl: any = req.cookies.originalUrl;
            if (!NoderedUtil.IsNullEmpty(originalUrl)) {
                res.cookie("originalUrl", "", { expires: new Date(0) });
                LoginProvider.redirect(res, originalUrl);
            } else {
                res.redirect("/");
            }
        });
        app.get("/PassiveSignout", (req: any, res: any, next: any): void => {
            req.logout();
            const originalUrl: any = req.cookies.originalUrl;
            if (!NoderedUtil.IsNullEmpty(originalUrl)) {
                res.cookie("originalUrl", "", { expires: new Date(0) });
                LoginProvider.redirect(res, originalUrl);
            } else {
                res.redirect("/Login");
            }
        });
        await LoginProvider.RegisterProviders(app, baseurl);
        app.get("/user", async (req: any, res: any, next: any): Promise<void> => {
            const span: Span = Logger.otel.startSpan("LoginProvider.user");
            try {
                span.setAttribute("remoteip", WebServer.remoteip(req));
                res.setHeader("Content-Type", "application/json");
                if (req.user) {
                    const user: User = await DBHelper.FindById(req.user._id, undefined, span);
                    res.end(JSON.stringify(user));
                } else {
                    res.end(JSON.stringify({}));
                }
                res.end();
            } catch (error) {
                span.recordException(error);
                throw error;
            } finally {
                Logger.otel.endSpan(span);
            }
        });
        app.get("/jwt", (req: any, res: any, next: any): void => {
            const span: Span = Logger.otel.startSpan("LoginProvider.jwt");
            try {
                span.setAttribute("remoteip", WebServer.remoteip(req));
                res.setHeader("Content-Type", "application/json");
                if (req.user) {
                    const user: TokenUser = TokenUser.From(req.user);
                    span.setAttribute("username", user.username);
                    res.end(JSON.stringify({ jwt: Crypt.createToken(user, Config.shorttoken_expires_in), user: user }));
                } else {
                    res.end(JSON.stringify({ jwt: "" }));
                }
                res.end();
            } catch (error) {
                span.recordException(error);
                console.error(error.message ? error.message : error);
                return res.status(500).send({ message: error.message ? error.message : error });
            } finally {
                Logger.otel.endSpan(span);
            }
        });
        app.get("/jwtlong", (req: any, res: any, next: any): void => {
            const span: Span = Logger.otel.startSpan("LoginProvider.jwtlong");
            try {
                span.setAttribute("remoteip", WebServer.remoteip(req));
                res.setHeader("Content-Type", "application/json");
                if (req.user) {
                    const user: TokenUser = TokenUser.From(req.user);
                    span.setAttribute("username", user.username);
                    if (!(user.validated == true) && Config.validate_user_form != "") {
                        res.end(JSON.stringify({ jwt: "" }));
                    } else {
                        res.end(JSON.stringify({ jwt: Crypt.createToken(user, Config.longtoken_expires_in), user: user }));
                    }
                } else {
                    res.end(JSON.stringify({ jwt: "" }));
                }
                res.end();
            } catch (error) {
                span.recordException(error);
                console.error(error.message ? error.message : error);
                return res.status(500).send({ message: error.message ? error.message : error });
            } finally {
                Logger.otel.endSpan(span);
            }
        });
        app.post("/jwt", async (req: any, res: any, next: any): Promise<void> => {
            const span: Span = Logger.otel.startSpan("LoginProvider.jwt");
            // logger.debug("/jwt " + !(req.user == null));
            try {
                span.setAttribute("remoteip", WebServer.remoteip(req));
                const rawAssertion = req.body.token;
                const user: User = await LoginProvider.validateToken(rawAssertion, span);
                const tuser: TokenUser = TokenUser.From(user);
                span.setAttribute("username", user.username);
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ jwt: Crypt.createToken(tuser, Config.shorttoken_expires_in) }));
            } catch (error) {
                span.recordException(error);
                console.error(error.message ? error.message : error);
                return res.status(500).send({ message: error.message ? error.message : error });
            } finally {
                Logger.otel.endSpan(span);
            }
        });
        app.get("/config", (req: any, res: any, next: any): void => {
            const span: Span = Logger.otel.startSpan("LoginProvider.config");
            try {
                span.setAttribute("remoteip", WebServer.remoteip(req));
                let _url = Config.basewsurl();
                if (!NoderedUtil.IsNullEmpty(Config.api_ws_url)) _url = Config.api_ws_url;
                if (!_url.endsWith("/")) _url += "/";
                if (req.user) {
                    const user: TokenUser = TokenUser.From(req.user);
                    span.setAttribute("username", user.username);
                }
                const res2 = {
                    wshost: _url,
                    wsurl: _url,
                    domain: Config.domain,
                    allow_user_registration: Config.allow_user_registration,
                    allow_personal_nodered: Config.allow_personal_nodered,
                    auto_create_personal_nodered_group: Config.auto_create_personal_nodered_group,
                    namespace: Config.namespace,
                    nodered_domain_schema: Config.nodered_domain_schema,
                    websocket_package_size: Config.websocket_package_size,
                    version: Config.version,
                    stripe_api_key: Config.stripe_api_key,
                    getting_started_url: Config.getting_started_url,
                    validate_user_form: Config.validate_user_form,
                    supports_watch: Config.supports_watch
                }
                res.end(JSON.stringify(res2));
            } catch (error) {
                span.recordException(error);
                return res.status(500).send({ message: error.message ? error.message : error });
            } finally {
                Logger.otel.endSpan(span);
            }
        });
        app.get("/login", async (req: any, res: any, next: any): Promise<void> => {
            const span: Span = Logger.otel.startSpan("LoginProvider.login");
            try {
                span.setAttribute("remoteip", WebServer.remoteip(req));
                const originalUrl: any = req.cookies.originalUrl;
                const validateurl: any = req.cookies.validateurl;
                if (NoderedUtil.IsNullEmpty(originalUrl) && !req.originalUrl.startsWith("/login")) {
                    res.cookie("originalUrl", req.originalUrl, { maxAge: 900000, httpOnly: true });
                }
                if (!NoderedUtil.IsNullEmpty(validateurl)) {
                    // logger.debug("validateurl: " + validateurl);
                    if (req.user) {
                        const user: User = await DBHelper.FindById(req.user._id, undefined, span);
                        const tuser: TokenUser = TokenUser.From(user);
                        req.session.passport.user.validated = tuser.validated;
                        if (!(tuser.validated == true) && Config.validate_user_form != "") {
                        } else {
                            res.cookie("validateurl", "", { expires: new Date(0) });
                            res.cookie("originalUrl", "", { expires: new Date(0) });
                            this.redirect(res, "/#" + validateurl);
                            return;
                        }
                    }
                }
                const file = path.join(__dirname, 'public', 'PassiveLogin.html');
                res.sendFile(file);
                // const result: any[] = await this.getProviders();
                // res.setHeader("Content-Type", "application/json");
                // res.end(JSON.stringify(result));
                // res.end();
            } catch (error) {
                span.recordException(error);
                console.error(error.message ? error.message : error);
                return res.status(500).send({ message: error.message ? error.message : error });
            }
            try {
                span.addEvent("RegisterProviders");
                LoginProvider.RegisterProviders(app, baseurl);
            } catch (error) {
                span.recordException(error);
            }
            Logger.otel.endSpan(span);
        });
        app.get("/validateuserform", async (req: any, res: any, next: any): Promise<void> => {
            const span: Span = Logger.otel.startSpan("LoginProvider.validateuserform");
            try {
                span.setAttribute("remoteip", WebServer.remoteip(req));
                res.setHeader("Content-Type", "application/json");
                if (NoderedUtil.IsNullEmpty(Config.validate_user_form)) {
                    res.end(JSON.stringify({}));
                    res.end();
                    Logger.otel.endSpan(span);
                    return;
                }
                var forms = await Config.db.query<Base>({ _id: Config.validate_user_form, _type: "form" }, null, 1, 0, null, "forms", Crypt.rootToken(), undefined, undefined, span);
                if (forms.length == 1) {
                    res.end(JSON.stringify(forms[0]));
                    res.end();
                    Logger.otel.endSpan(span);
                    return;
                }
                Logger.instanse.error("validate_user_form " + Config.validate_user_form + " does not exists!");
                Config.validate_user_form = "";
                res.end(JSON.stringify({}));
                res.end();
            } catch (error) {
                span.recordException(error);
                return res.status(500).send({ message: error.message ? error.message : error });
            } finally {
                Logger.otel.endSpan(span);
            }
            return;
        });
        app.post("/validateuserform", async (req: any, res) => {
            const span: Span = Logger.otel.startSpan("LoginProvider.postvalidateuserform");
            // logger.debug("/validateuserform " + !(req.user == null));
            res.setHeader("Content-Type", "application/json");
            try {
                span.setAttribute("remoteip", WebServer.remoteip(req));
                if (req.user) {
                    if (req.body && req.body.data) {
                        const tuser: TokenUser = TokenUser.From(req.user);
                        delete req.body.data._id;
                        delete req.body.data.username;
                        delete req.body.data.disabled;
                        delete req.body.data.type;
                        delete req.body.data.roles;
                        delete req.body.data.submit;
                        req.body.data.validated = true;
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
                        var res2 = await Config.db._UpdateOne({ "_id": tuser._id }, UpdateDoc, "users", 1, false, Crypt.rootToken(), span);
                        const user: TokenUser = Object.assign(tuser, req.body.data);
                        req.session.passport.user.validated = true;


                        if (!(user.validated == true) && Config.validate_user_form != "") {
                            res.end(JSON.stringify({ jwt: "" }));
                        } else {
                            res.end(JSON.stringify({ jwt: Crypt.createToken(user, Config.longtoken_expires_in), user: user }));
                        }
                    }
                } else {
                    res.end(JSON.stringify({ jwt: "" }));
                }
            } catch (error) {
                span.recordException(error);
                console.error(error);
                return res.status(500).send({ message: error.message ? error.message : error });
            }
            Logger.otel.endSpan(span);
            res.end();
        });

        app.get("/loginproviders", async (req: any, res: any, next: any): Promise<void> => {
            const span: Span = Logger.otel.startSpan("LoginProvider.loginproviders");
            try {
                span.setAttribute("remoteip", WebServer.remoteip(req));
                const result: any[] = await this.getProviders(span);
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify(result));
                res.end();
            } catch (error) {
                span.recordException(error);
                console.error(error.message ? error.message : error);
                Logger.otel.endSpan(span);
                return res.status(500).send({ message: error.message ? error.message : error });
            }
            try {
                LoginProvider.RegisterProviders(app, baseurl);
            } catch (error) {
                span.recordException(error);
                return res.status(500).send({ message: error.message ? error.message : error });
            } finally {
                Logger.otel.endSpan(span);
            }

        });
        app.get("/download/:id", async (req, res) => {
            const span: Span = Logger.otel.startSpan("LoginProvider.download");
            try {
                span.setAttribute("remoteip", WebServer.remoteip(req));
                let user: TokenUser = null;
                let jwt: string = null;
                const authHeader = req.headers.authorization;
                if (authHeader) {
                    user = Crypt.verityToken(authHeader);
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
                const rows = await Config.db.query({ _id: safeObjectID(id) }, null, 1, 0, null, "files", jwt, undefined, undefined, span);
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
                span.recordException(error);
                return res.status(500).send({ message: error.message ? error.message : error });
            } finally {
                Logger.otel.endSpan(span);
            }
        });
        try {
            const storage = GridFsStorage({
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
                            let user: TokenUser = null;
                            let jwt: string = null;
                            const authHeader = req.headers.authorization;
                            if (authHeader) {
                                user = Crypt.verityToken(authHeader);
                                jwt = Crypt.createToken(user, Config.downloadtoken_expires_in);
                            }
                            else if (req.user) {
                                user = TokenUser.From(req.user);
                                jwt = Crypt.createToken(user, Config.downloadtoken_expires_in);
                            }
                            const { query, headers } = req;

                            fileInfo.metadata.name = filename;
                            (fileInfo.metadata as any).filename = filename;
                            (fileInfo.metadata as any).path = "";
                            (fileInfo.metadata as any).uniquename = query.uniquename;
                            (fileInfo.metadata as any).form = query.form;
                            (fileInfo.metadata as any).project = query.project;
                            (fileInfo.metadata as any).baseurl = query.baseUrl;
                            fileInfo.metadata._acl = [];
                            fileInfo.metadata._createdby = user.name;
                            fileInfo.metadata._createdbyid = user._id;
                            fileInfo.metadata._created = new Date(new Date().toISOString());
                            fileInfo.metadata._modifiedby = user.name;
                            fileInfo.metadata._modifiedbyid = user._id;
                            fileInfo.metadata._modified = fileInfo.metadata._created;

                            const keys = Object.keys(query);
                            for (let i = 0; i < keys.length; i++) {
                                fileInfo.metadata[keys[i]] = query[keys[i]];
                            }
                            Base.addRight(fileInfo.metadata, user._id, user.name, [Rights.full_control]);
                            Base.addRight(fileInfo.metadata, WellknownIds.filestore_admins, "filestore admins", [Rights.full_control]);
                            Base.addRight(fileInfo.metadata, WellknownIds.filestore_users, "filestore users", [Rights.read]);
                            // Fix acl
                            fileInfo.metadata._acl.forEach((a, index) => {
                                if (typeof a.rights === "string") {
                                    fileInfo.metadata._acl[index].rights = (new Binary(Buffer.from(a.rights, "base64"), 0) as any);
                                }
                            });
                            resolve(fileInfo);
                        });
                    });
                },
            });
            const upload = multer({ //multer settings for single upload
                storage: storage
            }).any();

            // app.get("/upload", async (req: any, res: any, next: any): Promise<void> => {
            //     const query = req.query;
            // });
            app.delete("/upload", async (req: any, res: any, next: any): Promise<void> => {
                const span: Span = Logger.otel.startSpan("LoginProvider.upload");
                try {
                    span.setAttribute("remoteip", WebServer.remoteip(req));
                    let user: TokenUser = null;
                    let jwt: string = null;
                    const authHeader = req.headers.authorization;
                    if (authHeader) {
                        user = Crypt.verityToken(authHeader);
                        jwt = Crypt.createToken(user, Config.downloadtoken_expires_in);
                    }
                    else if (req.user) {
                        user = TokenUser.From(req.user as any);
                        jwt = Crypt.createToken(user, Config.downloadtoken_expires_in);
                    }
                    if (user == null) {
                        return res.status(404).send({ message: 'Route ' + req.url + ' Not found.' });
                    }
                    const query = req.query;
                    console.log("baseUrl: " + query.baseUrl);
                    console.log("form: " + query.form);
                    console.log("project: " + query.project);
                    console.log("uniquename: " + query.uniquename);
                    let uniquename: string = query.uniquename;
                    if (uniquename.indexOf('/') > -1) uniquename = uniquename.substr(0, uniquename.indexOf('/'));
                    let q: any = {};
                    if (!NoderedUtil.IsNullEmpty(uniquename)) {
                        q = { "metadata.uniquename": uniquename };
                    }

                    const arr = await Config.db.query(q, undefined, 1, 0, { "uploadDate": -1 }, "files", jwt, undefined, undefined, span);
                    if (arr.length > 0) {
                        await Config.db.DeleteOne(arr[0]._id, "files", jwt);
                    }
                    res.send({
                        status: "success",
                        display_status: "Success",
                        message: uniquename + " deleted"
                    });
                } catch (error) {
                    span.recordException(error);
                    console.error(error);
                    return res.status(500).send({ message: error.message ? error.message : error });
                } finally {
                    Logger.otel.endSpan(span);
                }

            });
            // app.get("/upload/:fileId", async (req: any, res: any, next: any): Promise<void> => {
            app.get("/upload", async (req: any, res: any, next: any): Promise<void> => {
                const span: Span = Logger.otel.startSpan("LoginProvider.upload");
                try {
                    span.setAttribute("remoteip", WebServer.remoteip(req));
                    let user: TokenUser = null;
                    let jwt: string = null;
                    const authHeader = req.headers.authorization;
                    if (authHeader) {
                        user = Crypt.verityToken(authHeader);
                        jwt = Crypt.createToken(user, Config.downloadtoken_expires_in);
                    }
                    else if (req.user) {
                        user = TokenUser.From(req.user as any);
                        jwt = Crypt.createToken(user, Config.downloadtoken_expires_in);
                    }
                    if (user == null) {
                        return res.status(404).send({ message: 'Route ' + req.url + ' Not found.' });
                    }
                    const query = req.query;
                    console.log("baseUrl: " + query.baseUrl);
                    console.log("form: " + query.form);
                    console.log("project: " + query.project);
                    console.log("uniquename: " + query.uniquename);
                    let uniquename: string = query.uniquename;
                    if (uniquename.indexOf('/') > -1) uniquename = uniquename.substr(0, uniquename.indexOf('/'));
                    let q: any = {};
                    if (!NoderedUtil.IsNullEmpty(uniquename)) {
                        q = { "metadata.uniquename": uniquename };
                    }

                    const arr = await Config.db.query(q, undefined, 1, 0, { "uploadDate": -1 }, "files", jwt, undefined, undefined, span);

                    const id = arr[0]._id;
                    const rows = await Config.db.query({ _id: safeObjectID(id) }, null, 1, 0, null, "files", jwt, undefined, undefined, span);
                    if (rows == null || rows.length != 1) { return res.status(404).send({ message: 'id ' + id + ' Not found.' }); }
                    const file = rows[0] as any;

                    console.log("id: " + id);

                    const bucket = new GridFSBucket(Config.db.db);
                    let downloadStream = bucket.openDownloadStream(safeObjectID(id));
                    res.set('Content-Type', file.contentType);
                    res.set('Content-Disposition', 'attachment; filename="' + file.filename + '"');
                    res.set('Content-Length', file.length);
                    downloadStream.on("error", function (err) {
                        res.end();
                    });
                    downloadStream.pipe(res);
                    return;
                } catch (error) {
                    span.recordException(error);
                    return res.status(500).send({ message: error.message ? error.message : error });
                } finally {
                    Logger.otel.endSpan(span);
                }
            });
            app.post("/upload", async (req, res) => {
                let user: TokenUser = null;
                let jwt: string = null;
                const authHeader = req.headers.authorization;
                if (authHeader) {
                    user = Crypt.verityToken(authHeader);
                    jwt = Crypt.createToken(user, Config.downloadtoken_expires_in);
                }
                else if (req.user) {
                    user = TokenUser.From(req.user as any);
                    jwt = Crypt.createToken(user, Config.downloadtoken_expires_in);
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
            console.error(error.message ? error.message : error);
        }

    }
    static async RegisterProviders(app: express.Express, baseurl: string) {
        const span: Span = Logger.otel.startSpan("LoginProvider.RegisterProviders");
        try {
            if (LoginProvider.login_providers.length === 0) {
                const _jwt = Crypt.rootToken();
                LoginProvider.login_providers = await Config.db.query<Provider>({ _type: "provider" }, null, 10, 0, null, "config", _jwt, undefined, undefined, span);
            }
            let hasLocal: boolean = false;
            if (LoginProvider.login_providers.length === 0) { hasLocal = true; }
            LoginProvider.login_providers.forEach(async (provider) => {
                try {
                    if (NoderedUtil.IsNullUndefinded(LoginProvider._providers[provider.id])) {
                        if (provider.provider === "saml") {
                            const metadata: any = await Config.parse_federation_metadata(provider.saml_federation_metadata);
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
                    console.error(error.message ? error.message : error);
                }
            });
            if (hasLocal === true) {
                if (NoderedUtil.IsNullUndefinded(LoginProvider._providers.local)) {
                    LoginProvider._providers.local = LoginProvider.CreateLocalStrategy(app, baseurl);
                }
            }
        } catch (error) {
            span.recordException(error);
            throw error;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    static CreateGoogleStrategy(app: express.Express, key: string, consumerKey: string, consumerSecret: string, baseurl: string): any {
        const options: googleauthstrategyoptions = new googleauthstrategyoptions();
        options.clientID = consumerKey;
        options.clientSecret = consumerSecret;
        options.callbackURL = url.parse(baseurl).protocol + "//" + url.parse(baseurl).host + "/" + key + "/";
        options.verify = (LoginProvider.googleverify).bind(this);
        const strategy: passport.Strategy = new GoogleStrategy.Strategy(options, options.verify);
        passport.use(key, strategy);
        strategy.name = key;
        Logger.instanse.info(options.callbackURL);
        app.use("/" + key,
            express.urlencoded({ extended: false }),
            passport.authenticate(key, { failureRedirect: "/" + key, failureFlash: true }),
            function (req: any, res: any): void {
                const originalUrl: any = req.cookies.originalUrl;
                res.cookie("provider", key, { maxAge: 900000, httpOnly: true });
                if (!NoderedUtil.IsNullEmpty(originalUrl)) {
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
        const options: samlauthstrategyoptions = new samlauthstrategyoptions();
        options.entryPoint = singin_url;
        options.cert = cert;
        options.issuer = issuer;
        options.callbackUrl = url.parse(baseurl).protocol + "//" + url.parse(baseurl).host + "/" + key + "/";
        options.verify = (LoginProvider.samlverify).bind(this);
        const SamlStrategy = require('passport-saml').Strategy
        const strategy: passport.Strategy = new SamlStrategy(options, options.verify);
        passport.use(key, strategy);
        strategy.name = key;
        Logger.instanse.info(options.callbackUrl);

        // app.get("/" + key + "/FederationMetadata/2007-06/FederationMetadata.xml",
        //     wsfed.metadata({
        //         cert: Buffer.from(Config.signing_crt, "base64").toString("ascii"),
        //         issuer: issuer
        //     }));
        const CertPEM = Buffer.from(Config.signing_crt, "base64").toString("ascii").replace(/(-----(BEGIN|END) CERTIFICATE-----|\n)/g, '');
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
            express.urlencoded({ extended: false }),
            passport.authenticate(key, { failureRedirect: "/" + key, failureFlash: true }),
            function (req: any, res: any): void {
                const originalUrl: any = req.cookies.originalUrl;
                res.cookie("provider", key, { maxAge: 900000, httpOnly: true });
                if (!NoderedUtil.IsNullEmpty(originalUrl)) {
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
        const strategy: passport.Strategy = new LocalStrategy(async (username: string, password: string, done: any): Promise<void> => {
            const span: Span = Logger.otel.startSpan("LoginProvider.CreateLocalStrategy");
            try {
                if (username !== null && username != undefined) { username = username.toLowerCase(); }
                let user: User = null;
                if (LoginProvider.login_providers.length === 0) {
                    user = await DBHelper.FindByUsername(username, null, span);
                    if (user == null) {
                        user = new User(); user.name = username; user.username = username;
                        await Crypt.SetPassword(user, password, span);
                        user = await Config.db.InsertOne(user, "users", 0, false, Crypt.rootToken(), span);
                        const admins: Role = await DBHelper.FindRoleByName("admins", span);
                        admins.AddMember(user);
                        await DBHelper.Save(admins, Crypt.rootToken(), span)
                    } else {
                        if (user.disabled) {
                            Audit.LoginFailed(username, "weblogin", "local", "", "browser", "unknown", span);
                            done("Disabled user " + username, null);
                            return;
                        }
                        if (!(await Crypt.ValidatePassword(user, password, span))) {
                            Audit.LoginFailed(username, "weblogin", "local", "", "browser", "unknown", span);
                            return done(null, false);
                        }
                    }
                    Audit.LoginSuccess(TokenUser.From(user), "weblogin", "local", "", "browser", "unknown", span);
                    const provider: Provider = new Provider(); provider.provider = "local"; provider.name = "Local";
                    const result = await Config.db.InsertOne(provider, "config", 0, false, Crypt.rootToken(), span);
                    LoginProvider.login_providers.push(result);
                    const tuser: TokenUser = TokenUser.From(user);
                    return done(null, tuser);
                }
                user = await DBHelper.FindByUsername(username, null, span);
                if (NoderedUtil.IsNullUndefinded(user)) {
                    if (!Config.allow_user_registration) {
                        return done(null, false);
                    }
                    user = await DBHelper.ensureUser(Crypt.rootToken(), username, username, null, password, span);
                } else {
                    if (user.disabled) {
                        Audit.LoginFailed(username, "weblogin", "local", "", "browser", "unknown", span);
                        done("Disabled user " + username, null);
                        return;
                    }
                    if (!(await Crypt.ValidatePassword(user, password, span))) {
                        Audit.LoginFailed(username, "weblogin", "local", "", "browser", "unknown", span);
                        return done(null, false);
                    }
                }
                const tuser: TokenUser = TokenUser.From(user);
                Audit.LoginSuccess(tuser, "weblogin", "local", "", "browser", "unknown", span);
                Logger.otel.endSpan(span);
                return done(null, tuser);
            } catch (error) {
                span.recordException(error);
                Logger.otel.endSpan(span);
                console.error(error.message ? error.message : error);
                done(error.message ? error.message : error);
            }
        });
        passport.use("local", strategy);
        app.use("/local",
            express.urlencoded({ extended: false }),
            function (req: any, res: any, next: any): void {
                Logger.instanse.debug("passport.authenticate local");
                passport.authenticate("local", function (err, user, info) {
                    let originalUrl: any = req.cookies.originalUrl;
                    Logger.instanse.debug("originalUrl: " + originalUrl);
                    if (err) {
                        Logger.instanse.error(err);
                    }
                    if (!err && user) {
                        Logger.instanse.info(user);
                        req.logIn(user, function (err: any) {
                            if (err) {
                                Logger.instanse.info("req.logIn failed");
                                Logger.instanse.error(err);
                                return next(err);
                            }
                            Logger.instanse.info("req.logIn success");
                            if (!NoderedUtil.IsNullEmpty(originalUrl)) {
                                try {
                                    res.cookie("originalUrl", "", { expires: new Date(0) });
                                    LoginProvider.redirect(res, originalUrl);
                                    Logger.instanse.debug("redirect: " + originalUrl);
                                    return;
                                } catch (error) {
                                    console.error(error.message ? error.message : error);
                                }
                            } else {
                                Logger.instanse.debug("redirect: to /");
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
                            Logger.instanse.debug("remove originalUrl");
                            res.cookie("originalUrl", "", { expires: new Date(0) });
                            Logger.instanse.debug("redirect: " + originalUrl);
                            LoginProvider.redirect(res, originalUrl);
                        } catch (error) {
                            console.error(error.message ? error.message : error);
                        }
                    } else {
                        try {
                            Logger.instanse.debug("redirect: to /");
                            res.redirect("/");
                            return next();
                        } catch (error) {
                            console.error(error.message ? error.message : error);
                        }
                    }
                })(req, res, next);
            }
        );

        return strategy;
    }
    static async samlverify(profile: any, done: IVerifyFunction): Promise<void> {
        const span: Span = Logger.otel.startSpan("LoginProvider.samlverify");
        try {
            let username: string = profile.username;
            if (NoderedUtil.IsNullEmpty(username)) username = profile.nameID;
            if (!NoderedUtil.IsNullEmpty(username)) { username = username.toLowerCase(); }
            Logger.instanse.debug("verify: " + username);
            let _user: User = await DBHelper.FindByUsernameOrFederationid(username, span);

            if (NoderedUtil.IsNullUndefinded(_user)) {
                let createUser: boolean = Config.auto_create_users;
                if (Config.auto_create_domains.map(x => username.endsWith(x)).length == -1) { createUser = false; }
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
                    // _user = await Config.db.InsertOne(_user, "users", 0, false, Crypt.rootToken());
                    const jwt: string = Crypt.rootToken();
                    _user = await DBHelper.ensureUser(jwt, _user.name, _user.username, null, null, span);
                }
            } else {
                if (!NoderedUtil.IsNullUndefinded(_user)) {
                    if (!NoderedUtil.IsNullEmpty(profile["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/mobile"])) {
                        (_user as any).mobile = profile["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/mobile"];
                    }
                    const jwt: string = Crypt.rootToken();
                    await DBHelper.Save(_user, jwt, span);
                }
            }

            if (!NoderedUtil.IsNullUndefinded(_user)) {
                if (!NoderedUtil.IsNullEmpty(profile["http://schemas.xmlsoap.org/claims/Group"])) {
                    const jwt: string = Crypt.rootToken();
                    const strroles: string[] = profile["http://schemas.xmlsoap.org/claims/Group"];
                    for (let i = 0; i < strroles.length; i++) {
                        const role: Role = await DBHelper.FindRoleByName(strroles[i], span);
                        if (!NoderedUtil.IsNullUndefinded(role)) {
                            role.AddMember(_user);
                            await DBHelper.Save(role, jwt, span);
                        }
                    }
                    await DBHelper.DecorateWithRoles(_user, span);
                }
            }

            if (NoderedUtil.IsNullUndefinded(_user)) {
                Audit.LoginFailed(username, "weblogin", "saml", "", "samlverify", "unknown", span);
                done("unknown user " + username, null);
                return;
            }
            if (_user.disabled) {
                Audit.LoginFailed(username, "weblogin", "saml", "", "samlverify", "unknown", span);
                done("Disabled user " + username, null);
                return;
            }

            const tuser: TokenUser = TokenUser.From(_user);
            Audit.LoginSuccess(tuser, "weblogin", "saml", "", "samlverify", "unknown", span);
            Logger.otel.endSpan(span);
            done(null, tuser);
        } catch (error) {
            span.recordException(error);
        }
        Logger.otel.endSpan(span);
    }
    static async googleverify(token: string, tokenSecret: string, profile: any, done: IVerifyFunction): Promise<void> {
        const span: Span = Logger.otel.startSpan("LoginProvider.googleverify");
        try {
            if (profile.emails) {
                const email: any = profile.emails[0];
                profile.username = email.value;
            }
            let username: string = profile.username;
            if (NoderedUtil.IsNullEmpty(username)) username = profile.nameID;
            if (!NoderedUtil.IsNullEmpty(username)) { username = username.toLowerCase(); }
            Logger.instanse.debug("verify: " + username);
            let _user: User = await DBHelper.FindByUsernameOrFederationid(username, span);
            if (NoderedUtil.IsNullUndefinded(_user)) {
                let createUser: boolean = Config.auto_create_users;
                if (Config.auto_create_domains.map(x => username.endsWith(x)).length == -1) { createUser = false; }
                if (createUser) {
                    const jwt: string = Crypt.rootToken();
                    _user = new User(); _user.name = profile.name;
                    if (!NoderedUtil.IsNullEmpty(profile.displayName)) { _user.name = profile.displayName; }
                    _user.username = username;
                    (_user as any).mobile = profile.mobile;
                    if (NoderedUtil.IsNullEmpty(_user.name)) { done("Cannot add new user, name is empty.", null); return; }
                    _user = await DBHelper.ensureUser(jwt, _user.name, _user.username, null, null, span);
                }
            }
            if (NoderedUtil.IsNullUndefinded(_user)) {
                Audit.LoginFailed(username, "weblogin", "google", "", "googleverify", "unknown", span);
                done("unknown user " + username, null); return;
            }
            if (_user.disabled) {
                Audit.LoginFailed(username, "weblogin", "google", "", "googleverify", "unknown", span);
                done("Disabled user " + username, null);
                return;
            }
            const tuser: TokenUser = TokenUser.From(_user);
            Audit.LoginSuccess(tuser, "weblogin", "google", "", "googleverify", "unknown", span);
            done(null, tuser);
        } catch (error) {
            span.recordException(error);
        }
        Logger.otel.endSpan(span);
    }


}