import { Span } from "@opentelemetry/api";
import os from "os";
import { Config } from "./Config.js";
import { Crypt } from "./Crypt.js";
import { Logger } from "./Logger.js";
import { LoginProvider } from "./LoginProvider.js";
import { OAuthProvider } from "./OAuthProvider.js";
import { Wellknown } from "./Util.js";
import { FederationId, TokenUser, User } from "./commoninterfaces.js";
export class Auth {
    public static async ValidateByPassword(username: string, password: string, parent: Span): Promise<User> {
        const span: Span = Logger.otel.startSubSpan("Auth.ValidateByPassword", parent);
        try {
            if (username === null || username === undefined || username === "") { throw new Error("Username cannot be null"); }
            span?.setAttribute("username", username);
            if (Config.enable_guest && username == "guest") {
                return await Crypt.guestUser();
            }
            if (password === null || password === undefined || password === "") { throw new Error("Password cannot be null"); }
            const user: User = await Logger.DBHelper.FindByUsername(username, null, span);
            if (user === null || user === undefined) { return null; }
            if ((await Crypt.compare(password, user.passwordhash, span)) !== true) { return null; }
            return user;
        } finally {
            Logger.otel.endSpan(span);
        }
    }
    public static async RefreshUser(user: User, impostor: string, parent: Span) {
        let result = await Logger.DBHelper.FindById(user._id, parent)
        if (result == null) {
            throw new Error("User " + user._id + " not found");
        }
        // Assign to ensure overload functions are available
        result = User.assign(result);
        if (impostor != null && impostor != "") {
            (user as any).impostor = impostor;
        }
        return result;
    }
    public static async Token2User(jwt: string, parent: Span) {
        let tuser: TokenUser = null;
        let user: User = null;
        let impostor: string = undefined;
        if (jwt == null || jwt.trim() == "") {
            if (Config.enable_guest == true) {
                // Assign to ensure overload functions are available
                user = User.assign(await Crypt.guestUser());
                return user;
            }
            throw new Error("Empty token is not valid");
        }
        if (jwt.indexOf(" ") > 1 && (jwt.toLowerCase().startsWith("bearer") || jwt.toLowerCase().startsWith("jwt"))) {
            const token = jwt.split(" ")[1].toString();
            jwt = token;
        } else if (jwt.indexOf(" ") > 1 && jwt.toLowerCase().startsWith("basic")) {
            jwt = jwt.split(" ")[1].toString() || "";
            user = await Logger.DBHelper.FindJWT(jwt, parent);
            if (user == null) {
                const [login, password] = Buffer.from(jwt, "base64").toString().split(":")
                if (login != null && login != "" && password != null && password != "") {
                    user = await Auth.ValidateByPassword(login, password, parent);
                }
            }
        }
        // Valid JWT token ?
        if (tuser == null && user == null) {
            try {
                tuser = await Crypt.verityToken(jwt);
                if (tuser != null) {
                    impostor = tuser.impostor;
                }
            } catch (error) {
            }
        }
        // cached ?
        if (user == null) {
            user = await Logger.DBHelper.FindJWT(jwt, parent)
            if (user != null) {
                user = User.assign(user);
                (user as any).impostor = impostor;
                return Auth.RefreshUser(user, impostor, parent);
            }
        }
        // if root, pass through to avoid circular calls
        if (tuser != null && tuser._id == Wellknown.root._id) {
            // Assign to ensure overload functions are available
            user = User.assign(Crypt.rootUser());
            return user;
        }
        // if guest, pass through to avoid circular calls
        if (tuser != null && tuser._id == Wellknown.guest._id) {
            if (Config.enable_guest == true) {
                // Assign to ensure overload functions are available
                user = User.assign(await Crypt.guestUser());
                return user;
            } else {
                throw new Error("Guest user is not enabled");
            }
        }
        // Valid SAML token ?
        if (tuser == null && user == null) {
            try {
                if (jwt.indexOf("saml") > 0) { // <saml2:Assertion
                    user = await LoginProvider.validateToken(jwt, parent);
                }
            } catch (error) {
            }
        }
        // Valid Provider OIDC token ?
        if (tuser == null && user == null) {
            var AccessToken = await OAuthProvider.instance.oidc.AccessToken.find(jwt);
            if (AccessToken != null) {
                let _user = await OAuthProvider.instance.oidc.Account.findAccount(null, AccessToken.accountId) as any;
                if (_user != null) {
                    tuser = _user;
                    if (_user.user != null) {
                        tuser = _user.user;
                    }
                }
            }
        }
        // Valid client OIDC token ?
        if (tuser == null && user == null) {
            for (var i = 0; i < OAuthProvider.instance.clients.length; i++) {
                try {
                    var _cli = await OAuthProvider.instance.oidc.Client.find(OAuthProvider.instance.clients[i].clientId);
                    var AccessToken2 = await OAuthProvider.instance.oidc.IdToken.validate(jwt, _cli);
                    if (AccessToken2 != null) {
                        let _user = await OAuthProvider.instance.oidc.Account.findAccount(null, AccessToken2.payload.sub);
                        if (_user != null) {
                            tuser = _user as any;
                            if (_user.user != null) {
                                tuser = _user.user;
                            }
                        }
                        break;
                    }
                } catch (error) {
                }
            }
        }
        if (tuser == null && user == null) {
            const providers = await Logger.DBHelper.GetProviders(parent);
            for (let i = 0; i < providers.length; i++) {
                const provider = providers[i];
                if (provider.enabled === false) continue;
                const introspection_endpoint = provider.introspection_endpoint
                const client_id = provider.introspection_client_id || provider.consumerKey
                const client_secret = provider.introspection_client_secret || provider.consumerSecret
                if (introspection_endpoint != null && introspection_endpoint != "") {
                    try {
                        var json: string = await Config.post_x_www_form_data_urlencoded(introspection_endpoint, {
                            client_id,
                            client_secret,
                            token: jwt
                        }, []);
                        const valid = JSON.parse(json)
                        if (valid.active == true && valid.sub != null && valid.email != null && valid.email != "") {
                            let _user = await Logger.DBHelper.FindByUsernameOrFederationid(valid.sub, valid.iss, parent);
                            if (_user == null) {
                                _user = await Logger.DBHelper.FindByUsernameOrFederationid(valid.email, valid.client_id, parent);
                            }
                            let createUser: boolean = Config.auto_create_users;
                            if (Config.auto_create_domains.map(x => valid.email.endsWith(x)).length > 0) { createUser = true; }
                            if (createUser == true && _user == null) {
                                _user = new User();
                                _user.name = valid.name;
                                _user.email = valid.email.toLowerCase();
                                _user.username = valid.email.toLowerCase();
                                let extraoptions = {
                                    federationids: [new FederationId(valid.sub, valid.iss)],
                                    emailvalidated: true,
                                    formvalidated: true, // TODO: Is this an security issue?
                                    validated: true
                                }
                                _user = await Logger.DBHelper.EnsureUser(Crypt.rootToken(), _user.name, _user.username, null, null, extraoptions, parent);
                            }
                            if (_user != null) {

                                if (os.hostname().toLowerCase() != "nixos") {
                                    Logger.DBHelper.AddJWT(jwt, _user, parent);
                                }
                                return Auth.RefreshUser(_user, impostor, parent);
                            }

                        }
                    } catch (error) {
                        Logger.instanse.error("Auth.Token2User", error)
                    }
                }
            }
            return null;
        }
        // Look up user
        if (user == null) user = await Logger.DBHelper.FindById(tuser._id, parent)
        if (user == null) {
            throw new Error("User " + tuser._id + " not found");
        }
        await Logger.DBHelper.AddJWT(jwt, user, parent);
        if (user._id == Wellknown.guest._id && Config.enable_guest == false) {
            throw new Error("Guest user is not enabled");
        }
        user = await Auth.RefreshUser(user, impostor, parent);
        return user;
    }
    public static async Id2Token(id: string, impostor: string, expiresIn: string, parent: Span) {
        if (id == Wellknown.guest._id && Config.enable_guest == false) {
            throw new Error("Guest user is not enabled");
        }
        const jwt = await Crypt.createSlimToken(id, impostor, expiresIn)
        return jwt;
    }
    public static async User2Token(item: User | TokenUser, expiresIn: string, parent: Span) {
        if (item._id == Wellknown.guest._id && Config.enable_guest == false) {
            throw new Error("Guest user is not enabled");
        }
        if (item instanceof TokenUser) {
            return Crypt.createSlimToken(item._id, item.impostor, expiresIn)
        } else {
            return Crypt.createSlimToken(item._id, (item as any).impostor, expiresIn)
        }
    }
}
