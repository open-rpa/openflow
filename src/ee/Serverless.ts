import { Base, Rights } from "@openiap/nodeapi";
import { Span } from "@opentelemetry/api";
import { Audit } from "../Audit.js";
import { Distro, SFunc, User, Volume, Workspace } from "../commoninterfaces.js";
import { Config } from "../Config.js";
import { Crypt } from "../Crypt.js";
import { Logger } from "../Logger.js";
import { Util, Wellknown } from "../Util.js";
import { DatabaseConnection } from "../DatabaseConnection.js";
import { Auth } from "../Auth.js";

export class Serverless {
    public static async EnsureFunc(tuser: User, jwt: string, func: SFunc, parent: Span): Promise<any> {
        try {
            if (Config.workspace_enabled == false) throw new Error("Workspaces are not enabled");
            if (!Logger.License.validlicense) await Logger.License.validate();
            if (tuser == null) throw new Error("User is mandatory");
            if (tuser._id == Wellknown.guest._id) throw new Error("Guest is not allowed to create func");
            if (func == null) throw new Error("Data is mandatory");
            if (jwt == null || jwt == "") throw new Error("JWT is mandatory");
            if (func._workspaceid == null || func._workspaceid == "") {
                throw new Error("Workspace ID is required to ensure a func");
            }
            delete func._acl;

            const workspace = await Config.db.GetOne<Workspace>({ query: { _id: func._workspaceid, "_type": "workspace" }, collectionname: "users", jwt }, parent);
            if (workspace == null) throw new Error(Logger.enricherror(tuser, null, "Workspace not found or access denied"));

            const rootjwt = Crypt.rootToken();

            if (func._id == null || func._id == "") {
                func._type = "app";
                func._createdby = tuser._id;
                func._created = new Date();
                func._modifiedby = tuser._id;
                func._modified = new Date();
                func._workspaceid = func._workspaceid;
                Base.addRight(func, workspace.admins, workspace.name + " admins", [Rights.read]);
                Base.addRight(func, workspace.admins, workspace.name + " users", [Rights.read]);
            }
            else {
                const _func = await Config.db.GetOne<SFunc>({ query: { _id: func._id, "_type": "app" }, collectionname: "fc", jwt }, parent);
                if (_func == null) throw new Error(Logger.enricherror(tuser, null, "Func not found or access denied"));

                if (func._workspaceid != _func._workspaceid) {
                    let _workspace = await Config.db.GetOne<Workspace>({ query: { _id: _func._workspaceid, "_type": "workspace" }, collectionname: "users", jwt }, parent);
                    if (_workspace == null) throw new Error(Logger.enricherror(tuser, null, "Workspace not found or access denied"));

                    Base.removeRight(func, _workspace.admins, [Rights.full_control]);
                    Base.removeRight(func, _workspace.users, [Rights.full_control]);

                    Base.addRight(func, workspace.admins, workspace.name + " admins", [Rights.read]);
                    Base.addRight(func, workspace.admins, workspace.name + " users", [Rights.read]);
                }
            }

            const result = await Config.db.InsertOrUpdateOne(func, "fc", "_id", 1, true, rootjwt, parent);
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
            if (tuser._id == Wellknown.guest._id) throw new Error("Guest is not allowed to create functions");
            if (id == null) throw new Error("Id is mandatory");
            if (jwt == null || jwt == "") throw new Error("JWT is mandatory");

            const rootjwt = Crypt.rootToken();
            const _func = await Config.db.GetOne<SFunc>({ query: { _id: id, "_type": "app" }, collectionname: "fc", jwt }, parent);
            if (_func == null) throw new Error(Logger.enricherror(tuser, null, "Func not found or access denied"));

            await Config.db.DeleteOne(id, "fc", false, rootjwt, parent);
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
            if (tuser._id == Wellknown.guest._id) throw new Error("Guest is not allowed to create volumes");
            if (volume == null) throw new Error("Data is mandatory");
            if (jwt == null || jwt == "") throw new Error("JWT is mandatory");
            if (volume._workspaceid == null || volume._workspaceid == "") {
                throw new Error("Workspace ID is required to ensure a volume");
            }
            volume._encrypt = [
                "password",
                "access_key",
                "secret_key"
            ];

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
                const _volume = await Config.db.GetOne<Volume>({ query: { _id: volume._id, "_type": "volume" }, collectionname: "fc", jwt }, parent);
                if (_volume == null) throw new Error(Logger.enricherror(tuser, null, "Volume not found or access denied"));
                if (volume._workspaceid != _volume._workspaceid) {
                    let _workspace = await Config.db.GetOne<Workspace>({ query: { _id: _volume._workspaceid, "_type": "workspace" }, collectionname: "users", jwt }, parent);
                    if (_workspace == null) throw new Error(Logger.enricherror(tuser, null, "Workspace not found or access denied"));

                    Base.removeRight(volume, _workspace.admins, [Rights.full_control]);
                    Base.removeRight(volume, _workspace.users, [Rights.full_control]);

                    Base.addRight(volume, workspace.admins, workspace.name + " admins", [Rights.read]);
                    Base.addRight(volume, workspace.admins, workspace.name + " users", [Rights.read]);
                }
            }


            const result = await Config.db.InsertOrUpdateOne(volume, "fc", "_id", 1, true, rootjwt, parent);
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
            if (tuser._id == Wellknown.guest._id) throw new Error("Guest is not allowed to create volumes");
            if (id == null) throw new Error("Id is mandatory");
            if (jwt == null || jwt == "") throw new Error("JWT is mandatory");

            const rootjwt = Crypt.rootToken();
            const _volume = await Config.db.GetOne<Volume>({ query: { _id: id, "_type": "volume" }, collectionname: "fc", jwt }, parent);
            if (_volume == null) throw new Error(Logger.enricherror(tuser, null, "Volume not found or access denied"));

            await Config.db.DeleteOne(id, "fc", false, rootjwt, parent);
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
            if (Config.workspace_enabled == false) throw new Error("Workspaces are not enabled");
            if (!Logger.License.validlicense) await Logger.License.validate();
            if (tuser == null) throw new Error("User is mandatory");
            if (tuser._id == Wellknown.guest._id) throw new Error("Guest is not allowed to create volumes");
            if (distro == null) throw new Error("Data is mandatory");
            if (jwt == null || jwt == "") throw new Error("JWT is mandatory");
            if (distro._workspaceid == null || distro._workspaceid == "") {
                throw new Error("Workspace ID is required to ensure a volume");
            }

            const workspace = await Config.db.GetOne<Workspace>({ query: { _id: distro._workspaceid, "_type": "workspace" }, collectionname: "users", jwt }, parent);
            if (workspace == null) throw new Error(Logger.enricherror(tuser, null, "Workspace not found or access denied"));

            const rootjwt = Crypt.rootToken();
            if (distro._id == null || distro._id == "") {
                distro._type = "distro";
                distro._createdby = tuser._id;
                distro._created = new Date();
                distro._modifiedby = tuser._id;
                distro._modified = new Date();
                distro._workspaceid = distro._workspaceid;
                Base.addRight(distro, workspace.admins, workspace.name + " admins", [Rights.read]);
                Base.addRight(distro, workspace.admins, workspace.name + " users", [Rights.read]);
            } else {
                const _distro = await Config.db.GetOne<Distro>({ query: { _id: distro._id, "_type": "distro" }, collectionname: "fc", jwt }, parent);
                if (_distro == null) throw new Error(Logger.enricherror(tuser, null, "Distro not found or access denied"));
                if (distro._workspaceid != _distro._workspaceid) {
                    let _workspace = await Config.db.GetOne<Workspace>({ query: { _id: _distro._workspaceid, "_type": "workspace" }, collectionname: "users", jwt }, parent);
                    if (_workspace == null) throw new Error(Logger.enricherror(tuser, null, "Workspace not found or access denied"));

                    Base.removeRight(distro, _workspace.admins, [Rights.full_control]);
                    Base.removeRight(distro, _workspace.users, [Rights.full_control]);

                    Base.addRight(distro, workspace.admins, workspace.name + " admins", [Rights.read]);
                    Base.addRight(distro, workspace.admins, workspace.name + " users", [Rights.read]);
                }
            }


            const result = await Config.db.InsertOrUpdateOne(distro, "fc", "_id", 1, true, rootjwt, parent);
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
            if (Config.workspace_enabled == false) throw new Error("Workspaces are not enabled");
            if (!Logger.License.validlicense) await Logger.License.validate();
            if (tuser == null) throw new Error("User is mandatory");
            if (tuser._id == Wellknown.guest._id) throw new Error("Guest is not allowed to create volumes");
            if (id == null) throw new Error("Id is mandatory");
            if (jwt == null || jwt == "") throw new Error("JWT is mandatory");

            const rootjwt = Crypt.rootToken();
            const _distro = await Config.db.GetOne<Distro>({ query: { _id: id, "_type": "distro" }, collectionname: "fc", jwt }, parent);
            if (_distro == null) throw new Error(Logger.enricherror(tuser, null, "Distro not found or access denied"));

            await Config.db.DeleteOne(id, "fc", false, rootjwt, parent);
            await Audit.AuditDistroAction(tuser, "remove", _distro, true, parent);

        } catch (error) {
            if (_distro != null) {
                await Audit.AuditDistroAction(tuser, "remove", _distro, false, parent);
            }
            throw error;
        }
    }

    public static async EnsurePackage(tuser: User, jwt: string, id: string, parent: Span): Promise<any> {
        // 
    }
    public static async DeletePackage(tuser: User, jwt: string, id: string, parent: Span): Promise<any> { }

    public static async IssueUserToken(tuser: User, jwt: string, id: string, exp: string, name: string, workspaceid: string, parent: Span): Promise<any> {
        if (exp == null || exp == "") throw new Error("Expiration date is mandatory");
        if (tuser == null) throw new Error("User is mandatory");
        if (tuser._id == Wellknown.guest._id) throw new Error("Guest is not allowed to issue tokens");
        if (jwt == null || jwt == "") throw new Error("JWT is mandatory");
        
        let workspace: Workspace = null;
        if (!Util.IsNullEmpty(workspaceid)) {
            workspace = await Config.db.GetOne<Workspace>({ query: { _id: workspaceid, "_type": "workspace" }, collectionname: "users", jwt }, parent);
            if (workspace == null) throw new Error(Logger.enricherror(tuser, null, "Workspace not found or access denied"));
            
        } else{
            workspaceid = undefined;
        }

        let tokenuser = tuser;

        if (tuser._id != id && Util.IsNullEmpty(id) == false) {
            const _user = await Config.db.GetOne<User>({ query: { _id: id }, collectionname: "users", jwt }, parent);
            if (_user == null) throw new Error(Logger.enricherror(tuser, null, "User not found or access denied"));
            if (!DatabaseConnection.hasAuthorization(tuser, _user, Rights.update)) throw new Error(Logger.enricherror(tuser, null, "Permission denied to issue token for user " + _user.name));
            tokenuser = _user;
        }
        let item: any = {
            name: name,
            _type: "usertoken",
            access_token: "",
            _encrypt: [
                "access_token"
            ],
            revoked: false,
            _workspaceid: workspaceid,
            _workspacename: workspace ? workspace.name : undefined, 
        }
        if(workspace != null) {
            Base.addRight(item, workspace.admins, workspace.name + " admins", [Rights.read]);
        }
        Base.addRight(item, tokenuser._id, "User " + tokenuser.name, [Rights.read]);
        const rootjwt = Crypt.rootToken();
        item = await Config.db.InsertOne<any>(item, "usertokens", 1, true, rootjwt, parent);
        tokenuser.tokenid = item._id;
        let _jwt = await Auth.User2Token(tokenuser, exp, parent);
        item.access_token = _jwt;
        Config.db.UpdateOne<any>(item, "usertokens", 1, true, rootjwt, parent);

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
        if (tuser._id == Wellknown.guest._id) throw new Error("Guest is not allowed to issue tokens");
        if (jwt == null || jwt == "") throw new Error("JWT is mandatory");
        if (id == null || id == "") throw new Error("Id is mandatory");

        const item = await Config.db.GetOne<any>({ query: { _id: id, "_type": "usertoken" }, collectionname: "usertokens", jwt }, parent);
        if (item == null) throw new Error(Logger.enricherror(tuser, null, "User token not found or access denied"));

        const rootjwt = Crypt.rootToken();
        item.revoked = true;
        Config.db.UpdateOne<any>(item, "usertokens", 1, true, rootjwt, parent);
    }

    // Checks for all functions
    // vscode extension should call custom function for upload file
    // env
    // ragnet
}
