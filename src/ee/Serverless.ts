import { Base, Rights } from "@openiap/nodeapi";
import { Span } from "@opentelemetry/api";
import { Audit } from "../Audit.js";
import { Auth } from "../Auth.js";
import { Distro, Package, SFunc, User, UserToken, Volume, Workspace } from "../commoninterfaces.js";
import { Config } from "../Config.js";
import { Crypt } from "../Crypt.js";
import { DatabaseConnection } from "../DatabaseConnection.js";
import { Logger } from "../Logger.js";
import { Util, Wellknown } from "../Util.js";

export class Serverless {
    public static async EnsureFunc(tuser: User, jwt: string, func: SFunc, parent: Span): Promise<any> {
        try {
            if (Config.workspace_enabled == false) throw new Error("Workspaces are not enabled");
            if (!Logger.License.validlicense) await Logger.License.validate();
            if (Util.IsNullEmpty(tuser)) throw new Error("User is mandatory");
            if (tuser._id == Wellknown.guest._id) throw new Error(Logger.enricherror(tuser, null, "Guest is not allowed to create func"));
            if (Util.IsNullUndefinded(func)) throw new Error(Logger.enricherror(tuser, null, "Data is mandatory"));
            if (Util.IsNullEmpty(jwt)) throw new Error(Logger.enricherror(tuser, null, "JWT is mandatory"));
            if (Util.IsNullEmpty(func._workspaceid)) {
                throw new Error(Logger.enricherror(tuser, null, "Workspace ID is required to ensure a func"));
            }
            if (Util.IsNullEmpty(func.repo)) throw new Error(Logger.enricherror(tuser, null, "Repo is required to ensure a func"));
            if (Util.IsNullEmpty(func.tag)) {
                func.tag = "latest";
            }
            delete func._acl;

            const workspace = await Config.db.GetOne<Workspace>({ query: { _id: func._workspaceid, "_type": "workspace" }, collectionname: "users", jwt }, parent);
            if (workspace == null) throw new Error(Logger.enricherror(tuser, null, "Workspace not found or access denied"));

            const rootjwt = Crypt.rootToken();

            // Does user has rights to ANY repo using that repo name?
            let repoexists = await Config.db.GetOne<SFunc>({ query: { repo: func.repo, "_type": "app" }, collectionname: "sf", jwt }, parent);
            if (repoexists == null) {
                // if not, does repo already exists, if so, deny creation
                repoexists = await Config.db.GetOne<SFunc>({ query: { repo: func.repo, "_type": "app" }, collectionname: "sf", jwt: rootjwt }, parent);
                if (repoexists != null) {
                    if (!DatabaseConnection.hasAuthorization(tuser, repoexists, Rights.full_control)) {
                        throw new Error(Logger.enricherror(tuser, null, "Function with the same repo already exists"));
                    }
                }
            }
            // Does user has rights to the object if _id is provided?
            if (!Util.IsNullEmpty(func._id)) {
                repoexists = await Config.db.GetOne<SFunc>({ query: { _id: func._id, "_type": "app" }, collectionname: "sf", jwt }, parent);
                if (repoexists == null) {
                    delete func._id;
                }
            } else {
                repoexists = null;
            }
            // if not, does repo+tag already exists, if so, deny creation
            if (repoexists == null) {
                repoexists = await Config.db.GetOne<SFunc>({ query: { repo: func.repo, tag: func.tag, "_type": "app" }, collectionname: "sf", jwt }, parent);
                if (repoexists == null) {
                    repoexists = await Config.db.GetOne<SFunc>({ query: { repo: func.repo, tag: func.tag, "_type": "app" }, collectionname: "sf", jwt: rootjwt }, parent);
                    if (repoexists != null) {
                        throw new Error(Logger.enricherror(tuser, null, "Function with the same repo and tag already exists"));
                    }
                } else {
                    func._id = repoexists._id;
                }
            }


            if (Util.IsNullEmpty(func._id)) {
                func._type = "app";
                func._workspaceid = func._workspaceid;
                Base.addRight(func, workspace.admins, workspace.name + " admins", [Rights.read]);
                Base.addRight(func, workspace.admins, workspace.name + " users", [Rights.read]);
            } else {
                const _func = await Config.db.GetOne<SFunc>({ query: { _id: func._id, "_type": "app" }, collectionname: "sf", jwt }, parent);
                if (_func == null) throw new Error(Logger.enricherror(tuser, null, "Func not found or access denied"));

                if (func._workspaceid != _func._workspaceid && (_func._workspaceid != null && _func._workspaceid != "")) {
                    let _workspace = await Config.db.GetOne<Workspace>({ query: { _id: _func._workspaceid, "_type": "workspace" }, collectionname: "users", jwt }, parent);
                    if (_workspace == null) throw new Error(Logger.enricherror(tuser, null, "Workspace not found or access denied"));

                    Base.removeRight(func, _workspace.admins, [Rights.full_control]);
                    Base.removeRight(func, _workspace.users, [Rights.full_control]);

                    Base.addRight(func, workspace.admins, workspace.name + " admins", [Rights.read]);
                    Base.addRight(func, workspace.admins, workspace.name + " users", [Rights.read]);
                } else {
                    Base.addRight(func, workspace.users, workspace.name + " users", [Rights.read]);
                    Base.addRight(func, workspace.admins, workspace.name + " admins", [Rights.read]);
                }
            }
            if (func.anonymous == true) {
                Base.addRight(func, Wellknown.sf_anonymous_user._id, Wellknown.sf_anonymous_user.name, [Rights.read]);
            } else {
                Base.removeRight(func, Wellknown.sf_anonymous_user._id, [Rights.full_control]);
            }

            const result = await Config.db.InsertOrUpdateOne(func, "sf", "_id", 1, true, rootjwt, parent);
            await Audit.AuditFuncAction(tuser, "ensure", result, true, parent);
            return result

        } catch (error) {
            await Audit.AuditFuncAction(tuser, "ensure", func, false, parent);
            throw error;
        }
    }
    public static async DeleteFunc(tuser: User, jwt: string, id: string, parent: Span): Promise<any> {
        let _func: SFunc = null;
        try {
            if (Config.workspace_enabled == false) throw new Error("Workspaces are not enabled");
            if (!Logger.License.validlicense) await Logger.License.validate();
            if (tuser == null) throw new Error("User is mandatory");
            if (tuser._id == Wellknown.guest._id) throw new Error(Logger.enricherror(tuser, null, "Guest is not allowed to delete functions"));
            if (id == null) throw new Error(Logger.enricherror(tuser, null, "Id is mandatory"));
            if (jwt == null || jwt == "") throw new Error(Logger.enricherror(tuser, null, "JWT is mandatory"));

            const rootjwt = Crypt.rootToken();
            const _func = await Config.db.GetOne<SFunc>({ query: { _id: id, "_type": "app" }, collectionname: "sf", jwt }, parent);
            if (_func == null) throw new Error(Logger.enricherror(tuser, null, "Func not found or access denied"));

            await Config.db.DeleteOne(id, "sf", false, rootjwt, parent);
            await Audit.AuditFuncAction(tuser, "remove", _func, true, parent);

        } catch (error) {
            if (_func != null) {
                await Audit.AuditFuncAction(tuser, "remove", _func, false, parent);
            }
            throw error;
        }
    }
    public static async EnsureVolume(tuser: User, jwt: string, volume: Volume, parent: Span): Promise<any> {
        try {
            if (Config.workspace_enabled == false) throw new Error("Workspaces are not enabled");
            if (!Logger.License.validlicense) await Logger.License.validate();
            if (tuser == null) throw new Error("User is mandatory");
            if (tuser._id == Wellknown.guest._id) throw new Error(Logger.enricherror(tuser, null, "Guest is not allowed to create volumes"));
            if (volume == null) throw new Error(Logger.enricherror(tuser, null, "Data is mandatory"));
            if (jwt == null || jwt == "") throw new Error(Logger.enricherror(tuser, null, "JWT is mandatory"));
            if (volume._workspaceid == null || volume._workspaceid == "") {
                throw new Error(Logger.enricherror(tuser, null, "Workspace ID is required to ensure a volume"));
            }
            volume._encrypt = [
                "password",
                "access_key",
                "secret_key"
            ];
            delete volume._acl;

            const workspace = await Config.db.GetOne<Workspace>({ query: { _id: volume._workspaceid, "_type": "workspace" }, collectionname: "users", jwt }, parent);
            if (workspace == null) throw new Error(Logger.enricherror(tuser, null, "Workspace not found or access denied"));

            const rootjwt = Crypt.rootToken();
            if (volume._id == null || volume._id == "") {
                volume._type = "volume";
                volume._createdby = tuser._id;
                volume._created = new Date();
                volume._modifiedby = tuser._id;
                volume._modified = new Date();
                volume._workspaceid = volume._workspaceid;
                Base.addRight(volume, workspace.admins, workspace.name + " admins", [Rights.read]);
                Base.addRight(volume, workspace.admins, workspace.name + " users", [Rights.read]);
            } else {
                const _volume = await Config.db.GetOne<Volume>({ query: { _id: volume._id, "_type": "volume" }, collectionname: "sf", jwt }, parent);
                if (_volume == null) throw new Error(Logger.enricherror(tuser, null, "Volume not found or access denied"));
                if (volume._workspaceid != _volume._workspaceid && (_volume._workspaceid != null && _volume._workspaceid != "")) {
                    let _workspace = await Config.db.GetOne<Workspace>({ query: { _id: _volume._workspaceid, "_type": "workspace" }, collectionname: "users", jwt }, parent);
                    if (_workspace == null) throw new Error(Logger.enricherror(tuser, null, "Workspace not found or access denied"));

                    Base.removeRight(volume, _workspace.admins, [Rights.full_control]);
                    Base.removeRight(volume, _workspace.users, [Rights.full_control]);

                    Base.addRight(volume, workspace.admins, workspace.name + " admins", [Rights.read]);
                    Base.addRight(volume, workspace.admins, workspace.name + " users", [Rights.read]);
                }
            }


            const result = await Config.db.InsertOrUpdateOne(volume, "sf", "_id", 1, true, rootjwt, parent);
            await Audit.AuditVolumeAction(tuser, "ensure", result, true, parent);
            return result

        } catch (error) {
            await Audit.AuditVolumeAction(tuser, "ensure", volume, false, parent);
            throw error;
        }
    }
    public static async DeleteVolume(tuser: User, jwt: string, id: string, parent: Span): Promise<any> {
        let _volume: Volume = null;
        try {
            if (Config.workspace_enabled == false) throw new Error("Workspaces are not enabled");
            if (!Logger.License.validlicense) await Logger.License.validate();
            if (tuser == null) throw new Error("User is mandatory");
            if (tuser._id == Wellknown.guest._id) throw new Error(Logger.enricherror(tuser, null, "Guest is not allowed to delete volumes"));
            if (id == null) throw new Error(Logger.enricherror(tuser, null, "Id is mandatory"));
            if (jwt == null || jwt == "") throw new Error(Logger.enricherror(tuser, null, "JWT is mandatory"));

            const rootjwt = Crypt.rootToken();
            const _volume = await Config.db.GetOne<Volume>({ query: { _id: id, "_type": "volume" }, collectionname: "sf", jwt }, parent);
            if (_volume == null) throw new Error(Logger.enricherror(tuser, null, "Volume not found or access denied"));

            await Config.db.DeleteOne(id, "sf", false, rootjwt, parent);
            await Audit.AuditVolumeAction(tuser, "remove", _volume, true, parent);

        } catch (error) {
            if (_volume != null) {
                await Audit.AuditVolumeAction(tuser, "remove", _volume, false, parent);
            }
            throw error;
        }
    }
    public static async EnsureDistro(tuser: User, jwt: string, distro: Distro, parent: Span): Promise<any> {
        try {
            if (!Logger.License.validlicense) await Logger.License.validate();
            if (tuser == null) throw new Error("User is mandatory");
            if (tuser._id == Wellknown.guest._id) throw new Error(Logger.enricherror(tuser, null, "Guest is not allowed to create distro"));
            if (distro == null) throw new Error(Logger.enricherror(tuser, null, "Data is mandatory"));
            if (jwt == null || jwt == "") throw new Error(Logger.enricherror(tuser, null, "JWT is mandatory"));
            delete distro._acl;

            const rootjwt = Crypt.rootToken();
            if (distro._id == null || distro._id == "") {
                distro._type = "distro";
                distro._createdby = tuser._id;
                distro._created = new Date();
                distro._modifiedby = tuser._id;
                distro._modified = new Date();
            } else {
                const _distro = await Config.db.GetOne<Distro>({ query: { _id: distro._id, "_type": "distro" }, collectionname: "sf", jwt }, parent);
                if (_distro == null) throw new Error(Logger.enricherror(tuser, null, "Distro not found or access denied"));
            }

            const result = await Config.db.InsertOrUpdateOne(distro, "sf", "_id", 1, true, rootjwt, parent);
            await Audit.AuditDistroAction(tuser, "ensure", result, true, parent);
            return result

        } catch (error) {
            await Audit.AuditDistroAction(tuser, "ensure", distro, false, parent);
            throw error;
        }
    }
    public static async DeleteDistro(tuser: User, jwt: string, id: string, parent: Span): Promise<any> {
        let _distro: Distro = null;
        try {
            // if (Config.workspace_enabled == false) throw new Error("Workspaces are not enabled");
            if (!Logger.License.validlicense) await Logger.License.validate();
            if (tuser == null) throw new Error("User is mandatory");
            if (tuser._id == Wellknown.guest._id) throw new Error(Logger.enricherror(tuser, null, "Guest is not allowed to delete distro"));
            if (id == null) throw new Error(Logger.enricherror(tuser, null, "Id is mandatory"));
            if (jwt == null || jwt == "") throw new Error(Logger.enricherror(tuser, null, "JWT is mandatory"));

            const rootjwt = Crypt.rootToken();
            const _distro = await Config.db.GetOne<Distro>({ query: { _id: id, "_type": "distro" }, collectionname: "sf", jwt }, parent);
            if (_distro == null) throw new Error(Logger.enricherror(tuser, null, "Distro not found or access denied"));

            await Config.db.DeleteOne(id, "sf", false, rootjwt, parent);
            await Audit.AuditDistroAction(tuser, "remove", _distro, true, parent);

        } catch (error) {
            if (_distro != null) {
                await Audit.AuditDistroAction(tuser, "remove", _distro, false, parent);
            }
            throw error;
        }
    }

    public static async EnsurePackage(tuser: User, jwt: string, packageData: Package, parent: Span): Promise<any> {
        if (tuser == null) throw new Error("User is mandatory");
        if (tuser._id == Wellknown.guest._id) throw new Error(Logger.enricherror(tuser, null, "Guest is not allowed to create a package"));
        if (packageData == null) throw new Error(Logger.enricherror(tuser, null, "Package data is mandatory"));
        if (jwt == null || jwt == "") throw new Error(Logger.enricherror(tuser, null, "JWT is mandatory"));

        try {


            if (packageData._id == null || packageData._id == "") {
                packageData._type = "package";
                packageData._createdby = tuser._id;
                packageData._created = new Date();
                packageData._modifiedby = tuser._id;
                packageData._modified = new Date();
                const slug = GenerateSlug();
                console.log("Generated slug: " + slug);
                packageData.slug = slug;

                if (!Util.IsNullEmpty(packageData?._workspaceid)) {
                    packageData._workspaceid = packageData._workspaceid;
                }
            } else {
                const _packageData = await Config.db.GetOne<Package>({ query: { _id: packageData._id, "_type": "package" }, collectionname: "agents", jwt }, parent);
                if (_packageData == null) throw new Error(Logger.enricherror(tuser, null, "Package not found or access denied"));

                // let workspaceid: string = packageData?._workspaceid;
                if (!Util.IsNullEmpty(packageData?._workspaceid)) {
                    const workspace = await Config.db.GetOne<Workspace>({ query: { _id: packageData?._workspaceid, "_type": "workspace" }, collectionname: "users", jwt }, parent);
                    if (workspace == null) throw new Error(Logger.enricherror(tuser, null, "Workspace not found or access denied"));

                    if (packageData._workspaceid != _packageData._workspaceid && (_packageData._workspaceid != null && _packageData._workspaceid != "")) {
                        let _workspace = await Config.db.GetOne<Workspace>({ query: { _id: _packageData._workspaceid, "_type": "workspace" }, collectionname: "users", jwt }, parent);
                        if (_workspace == null) throw new Error(Logger.enricherror(tuser, null, "Workspace not found or access denied"));

                        Base.removeRight(packageData, _workspace.admins, [Rights.full_control]);
                        Base.removeRight(packageData, _workspace.users, [Rights.full_control]);

                        Base.addRight(packageData, workspace.admins, workspace.name + " admins", [Rights.read]);
                        Base.addRight(packageData, workspace.admins, workspace.name + " users", [Rights.read]);
                    }
                    // packageData._workspaceid = workspace._id;
                }
            }

            const rootjwt = Crypt.rootToken();
            const result = await Config.db.InsertOrUpdateOne(packageData, "agents", "_id", 1, true, rootjwt, parent);
            await Audit.AuditPackageAction(tuser, "ensure", result, true, parent);

            return result

        } catch (error) {
            await Audit.AuditPackageAction(tuser, "ensure", packageData, false, parent);
            throw error;
        }
    }

    public static async DeletePackage(tuser: User, jwt: string, id: string, parent: Span): Promise<any> {
        let _package: Package = null;
        try {
            if (tuser == null) throw new Error("User is mandatory");
            if (tuser._id == Wellknown.guest._id) throw new Error(Logger.enricherror(tuser, null, "Guest is not allowed to delete packages"));
            if (id == null) throw new Error(Logger.enricherror(tuser, null, "Id is mandatory"));
            if (jwt == null || jwt == "") throw new Error(Logger.enricherror(tuser, null, "JWT is mandatory"));

            const _package = await Config.db.GetOne<Package>({ query: { _id: id, "_type": "package" }, collectionname: "agent", jwt }, parent);
            if (_package == null) throw new Error(Logger.enricherror(tuser, null, "Package not found or access denied"));

            const rootjwt = Crypt.rootToken();
            await Config.db.DeleteOne(id, "agent", false, rootjwt, parent);
            await Audit.AuditPackageAction(tuser, "remove", _package, true, parent);

        } catch (error) {
            if (_package != null) {
                await Audit.AuditPackageAction(tuser, "remove", _package, false, parent);
            }
            throw error;
        }
    }

    public static async IssueUserToken(tuser: User, jwt: string, userid: string, exp: string, name: string, app: string, workspaceid: string, parent: Span) {
        if (exp == null || exp == "") throw new Error(Logger.enricherror(tuser, null, "Expiration date is mandatory"));
        if (tuser == null) throw new Error("User is mandatory");
        if (tuser._id == Wellknown.guest._id) throw new Error(Logger.enricherror(tuser, null, "Guest is not allowed to issue tokens"));
        if (jwt == null || jwt == "") throw new Error(Logger.enricherror(tuser, null, "JWT is mandatory"));

        let workspace: Workspace = null;
        if (!Util.IsNullEmpty(workspaceid)) {
            workspace = await Config.db.GetOne<Workspace>({ query: { _id: workspaceid, "_type": "workspace" }, collectionname: "users", jwt }, parent);
            if (workspace == null) throw new Error(Logger.enricherror(tuser, null, "Workspace not found or access denied"));

        } else {
            workspaceid = undefined;
        }

        let tokenuser = tuser;

        if (tuser._id != userid && Util.IsNullEmpty(userid) == false) {
            const _user = await Config.db.GetOne<User>({ query: { _id: userid }, collectionname: "users", jwt }, parent);
            if (_user == null) throw new Error(Logger.enricherror(tuser, null, "User not found or access denied"));
            if (!DatabaseConnection.hasAuthorization(tuser, _user, Rights.update)) throw new Error(Logger.enricherror(tuser, null, "Permission denied to issue token for user " + _user.name));
            tokenuser = _user;
        }
        let exists = await Config.db.GetOne<UserToken>({
            query: { _userid: tokenuser._id, "_type": "usertoken", "_workspaceid": workspaceid, name, app, revoked: false }, collectionname: "usertokens", jwt
        }, parent);
        if (exists != null) {
            return {
                access_token: exists.access_token,
                id: exists._id,
            }
        }
        let item: UserToken = new UserToken();
        item.name = name;
        item._type = "usertoken";
        item.access_token = "";
        item._encrypt = [
            "access_token"
        ];
        item.app = app;
        item.revoked = false;
        item._workspaceid = workspaceid;
        item._workspacename = workspace ? workspace.name : undefined;
        item._userid = tokenuser ? tokenuser._id : undefined;
        item._username = tokenuser ? tokenuser.username : undefined;
        item._userdisplayname = tokenuser ? tokenuser.name : undefined;
        if (tuser._id != userid) {
            Base.addRight(item, tuser._id, tuser.name, [Rights.read]);
        }
        if (workspace != null) {
            Base.addRight(item, workspace.admins, workspace.name + " admins", [Rights.read]);
        }
        Base.addRight(item, tokenuser._id, "User " + tokenuser.name, [Rights.read]);
        const rootjwt = Crypt.rootToken();
        item = await Config.db.InsertOne<UserToken>(item, "usertokens", 1, true, rootjwt, parent);
        tokenuser.tokenid = item._id;
        let _jwt = await Auth.User2Token(tokenuser, exp, parent);
        let _exp = await Crypt.getTokenExp(_jwt);
        item.access_token = _jwt;
        item.exp = _exp;
        Config.db.UpdateOne<UserToken>(item, "usertokens", 1, true, rootjwt, parent);

        return {
            access_token: _jwt,
            id: item._id,
        }
    }
    // when we dont know who the user is
    public static async AddUserToken(key: string, parent: Span): Promise<any> {
        if (key == null || key == "") {
            key = Util.GetUniqueIdentifier(32);
        }
        // check the 
    }
    public static async GetUserToken(key: string, parent: Span): Promise<any> {

    }
    public static async RevokeUserToken(tuser: User, jwt: string, id: string, parent: Span): Promise<void> {
        if (tuser == null) throw new Error("User is mandatory");
        if (tuser._id == Wellknown.guest._id) throw new Error(Logger.enricherror(tuser, null, "Guest is not allowed to issue tokens"));
        if (jwt == null || jwt == "") throw new Error(Logger.enricherror(tuser, null, "JWT is mandatory"));
        if (id == null || id == "") throw new Error(Logger.enricherror(tuser, null, "Id is mandatory"));

        const item = await Config.db.GetOne<UserToken>({ query: { _id: id, "_type": "usertoken" }, collectionname: "usertokens", jwt }, parent);
        if (item == null) throw new Error(Logger.enricherror(tuser, null, "User token not found or access denied"));

        const rootjwt = Crypt.rootToken();
        item.revoked = true;
        Config.db.UpdateOne<UserToken>(item, "usertokens", 1, true, rootjwt, parent);
    }

    // Checks for all functions
    // vscode extension should call custom function for upload file
    // env
    // ragnet
}

const Adjectives = [
    "aged",
    "ancient",
    "autumn",
    "billowing",
    "bitter",
    "black",
    "blue",
    "bold",
    "broad",
    "broken",
    "calm",
    "cold",
    "cool",
    "crimson",
    "curly",
    "damp",
    "dark",
    "dawn",
    "delicate",
    "divine",
    "dry",
    "empty",
    "falling",
    "fancy",
    "flat",
    "floral",
    "fragrant",
    "frosty",
    "gentle",
    "green",
    "hidden",
    "holy",
    "icy",
    "jolly",
    "late",
    "lingering",
    "little",
    "lively",
    "long",
    "lucky",
    "misty",
    "morning",
    "muddy",
    "mute",
    "nameless",
    "noisy",
    "odd",
    "old",
    "orange",
    "patient",
    "plain",
    "polished",
    "proud",
    "purple",
    "quiet",
    "rapid",
    "raspy",
    "red",
    "restless",
    "rough",
    "round",
    "royal",
    "shiny",
    "shrill",
    "shy",
    "silent",
    "small",
    "snowy",
    "soft",
    "solitary",
    "sparkling",
    "spring",
    "square",
    "steep",
    "still",
    "summer",
    "super",
    "sweet",
    "throbbing",
    "tight",
    "tiny",
    "twilight",
    "wandering",
    "weathered",
    "white",
    "wild",
    "winter",
    "wispy",
    "withered",
    "yellow",
    "young",
];

const Nouns = [
    "art",
    "band",
    "bar",
    "base",
    "bird",
    "block",
    "boat",
    "bonus",
    "bread",
    "breeze",
    "brook",
    "bush",
    "butterfly",
    "cake",
    "cell",
    "cherry",
    "cloud",
    "credit",
    "darkness",
    "dawn",
    "dew",
    "disk",
    "dream",
    "dust",
    "feather",
    "field",
    "fire",
    "firefly",
    "flower",
    "fog",
    "forest",
    "frog",
    "frost",
    "glade",
    "glitter",
    "grass",
    "hall",
    "hat",
    "haze",
    "heart",
    "hill",
    "king",
    "lab",
    "lake",
    "leaf",
    "limit",
    "math",
    "meadow",
    "mode",
    "moon",
    "morning",
    "mountain",
    "mouse",
    "mud",
    "night",
    "paper",
    "pine",
    "poetry",
    "pond",
    "queen",
    "rain",
    "recipe",
    "resonance",
    "rice",
    "river",
    "salad",
    "scene",
    "sea",
    "shadow",
    "shape",
    "silence",
    "sky",
    "smoke",
    "snow",
    "snowflake",
    "sound",
    "star",
    "sun",
    "sun",
    "sunset",
    "surf",
    "term",
    "thunder",
    "tooth",
    "tree",
    "truth",
    "union",
    "unit",
    "violet",
    "voice",
    "water",
    "waterfall",
    "wave",
    "wildflower",
    "wind",
    "wood",
];

const tokenChars = "0123456789abcdef";
function random(min: any, max: any) {
    return Math.floor(Math.random() * (max - min + 1) + min);
}
function GenerateSlug() {
    let token = "";
    for (let i = 0; i < 4; i++) {
        token += tokenChars[random(0, tokenChars.length - 1)];
    }
    return (
        Adjectives[random(0, Adjectives.length - 1)] +
        "-" +
        Nouns[random(0, Nouns.length - 1)] +
        "-" +
        token
    );
}