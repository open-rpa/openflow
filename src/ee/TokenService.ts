import { Base, Rights } from "@openiap/nodeapi";
import { Span } from "@opentelemetry/api";
import { Auth } from "../Auth.js";
import { User, UserToken, Workspace } from "../commoninterfaces.js";
import { Config } from "../Config.js";
import { Crypt } from "../Crypt.js";
import { DatabaseConnection } from "../DatabaseConnection.js";
import { Logger } from "../Logger.js";
import { Util, Wellknown } from "../Util.js";

export class TokenService {

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
}
