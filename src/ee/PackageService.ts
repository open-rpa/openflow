import { Base, Rights } from "@openiap/nodeapi";
import { Span } from "@opentelemetry/api";
import { Audit } from "../Audit.js";
import { Package, User, Workspace } from "../commoninterfaces.js";
import { Config } from "../Config.js";
import { Crypt } from "../Crypt.js";
import { DatabaseConnection } from "../DatabaseConnection.js";
import { Logger } from "../Logger.js";
import { Util, Wellknown } from "../Util.js";
import { ObjectId } from "mongodb";

const safeObjectID = (s: string | number | ObjectId) => ObjectId.isValid(s) ? new ObjectId(s) : null;

export class PackageService {

    public static async EnsurePackage(tuser: User, jwt: string, packageData: Package, parent: Span): Promise<any> {
        if (tuser == null) throw new Error("User is mandatory");
        if (tuser._id == Wellknown.guest._id) throw new Error(Logger.enricherror(tuser, null, "Guest is not allowed to create a package"));
        if (packageData == null) throw new Error(Logger.enricherror(tuser, null, "Package data is mandatory"));
        if (jwt == null || jwt == "") throw new Error(Logger.enricherror(tuser, null, "JWT is mandatory"));
        if (Util.IsNullEmpty(packageData.name)) {
            throw new Error(Logger.enricherror(tuser, null, "Package name is required to ensure a package"));
        }
        try {
            packageData._type = "package";
            if (packageData._id == null || packageData._id == "") {
                packageData._createdby = tuser.name;
                packageData._createdbyid = tuser._id;
                packageData._modifiedby = tuser.name;
                packageData._modifiedbyid = tuser._id;
                if (!Util.IsNullEmpty(packageData?._workspaceid)) {
                    const workspace = await Config.db.GetOne<Workspace>({ query: { _id: packageData?._workspaceid, "_type": "workspace" }, collectionname: "users", jwt }, parent);
                    if (workspace == null) throw new Error(Logger.enricherror(tuser, null, "Workspace not found or access denied"));

                    Base.addRight(packageData, workspace.admins, workspace.name + " admins", [Rights.full_control]);
                    Base.addRight(packageData, workspace.users, workspace.name + " users", [Rights.full_control]);

                } else {
                    Base.addRight(packageData, tuser._id, tuser.name, [Rights.full_control]);
                }
            } else {
                const _packageData = await Config.db.GetOne<Package>({ query: { _id: packageData._id, "_type": "package" }, collectionname: "agents", jwt }, parent);
                if (_packageData == null) throw new Error(Logger.enricherror(tuser, null, "Package not found or access denied"));

                if (!Util.IsNullEmpty(packageData?._workspaceid)) {
                    const workspace = await Config.db.GetOne<Workspace>({ query: { _id: packageData?._workspaceid, "_type": "workspace" }, collectionname: "users", jwt }, parent);
                    if (workspace == null) throw new Error(Logger.enricherror(tuser, null, "Workspace not found or access denied"));

                    if (packageData._workspaceid != _packageData._workspaceid && (_packageData._workspaceid != null && _packageData._workspaceid != "")) {
                        let _workspace = await Config.db.GetOne<Workspace>({ query: { _id: _packageData._workspaceid, "_type": "workspace" }, collectionname: "users", jwt }, parent);
                        if (_workspace == null) throw new Error(Logger.enricherror(tuser, null, "Workspace not found or access denied"));

                        Base.removeRight(packageData, _workspace.admins, [Rights.full_control]);
                        Base.removeRight(packageData, _workspace.users, [Rights.full_control]);

                        Base.addRight(packageData, workspace.admins, workspace.name + " admins", [Rights.full_control]);
                        Base.addRight(packageData, workspace.users, workspace.name + " users", [Rights.full_control]);
                    }
                } else {
                    Base.addRight(packageData, tuser._id, tuser.name, [Rights.full_control]);
                }
            }
            Base.addRight(packageData, Wellknown.admins._id, Wellknown.admins.name, [Rights.full_control]);

            if (!Util.IsNullEmpty(packageData.fileid)) {
                Config.db.db.collection("fs.files").updateOne({ _id: safeObjectID(packageData.fileid) }, { $set: { "metadata._acl": packageData._acl } });
            }

            const result = await Config.db.InsertOrUpdateOne(packageData, "agents", "_id", 1, true, jwt, parent);
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

            const _package = await Config.db.GetOne<Package>({ query: { _id: id, "_type": "package" }, collectionname: "agents", jwt }, parent);
            if (_package == null) throw new Error(Logger.enricherror(tuser, null, "Package not found or access denied"));

            if (!DatabaseConnection.hasAuthorization(tuser, _package, Rights.delete)) {
                throw new Error(`[${tuser.name}] Access denied, missing delete permission on ${_package.name}`);
            }

            var agent = await Config.db.GetOne<any>({ query: { "schedules.packageid": id, "_type": "agent" }, collectionname: "agents", jwt: Crypt.rootToken() }, parent);
            if (agent != null) {
                throw new Error("Cannot delete package, it is in use by agent " + agent.name + " id: " + agent._id);
            }

            if (!Util.IsNullEmpty(_package.fileid)) {
                let query = { _id: _package.fileid };
                const item = await Config.db.GetOne<any>({ query, collectionname: "fs.files", jwt: jwt }, parent);
                if (item != null) {
                    await Config.db.DeleteOne(_package.fileid, "files", true, jwt, parent);
                }
            }

            await Config.db.DeleteOne(id, "agents", false, jwt, parent);
            await Audit.AuditPackageAction(tuser, "remove", _package, true, parent);

        } catch (error) {
            if (_package != null) {
                await Audit.AuditPackageAction(tuser, "remove", _package, false, parent);
            }
            throw error;
        }
    }
}
