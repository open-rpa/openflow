import { Base, Rights } from "@openiap/nodeapi";
import { Span } from "@opentelemetry/api";
import { Audit } from "../Audit.js";
import { SFunc, User, Volume, Workspace } from "../commoninterfaces.js";
import { Config } from "../Config.js";
import { Crypt } from "../Crypt.js";
import { Logger } from "../Logger.js";
import { Wellknown } from "../Util.js";

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
                func._type = "package";
                func._createdby = tuser._id;
                func._created = new Date();
                func._modifiedby = tuser._id;
                func._modified = new Date();
                func._workspaceid = func._workspaceid;
                Base.addRight(func, workspace.admins, workspace.name + " admins", [Rights.read]);
                Base.addRight(func, workspace.admins, workspace.name + " users", [Rights.read]);
            }
            else {
                const _func = await Config.db.GetOne<SFunc>({ query: { _id: func._id, "_type": "func" }, collectionname: "fc", jwt }, parent);
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
            const _func = await Config.db.GetOne<SFunc>({ query: { _id: id, "_type": "package" }, collectionname: "fc", jwt }, parent);
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
}
