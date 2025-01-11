import { Span } from "@opentelemetry/api";
import crypto from "crypto";
import express from "express";
import { Binary, GridFSBucket, ObjectId } from "mongodb";
import multer from "multer";
import { GridFsStorage } from "multer-gridfs-storage";
import { Auth } from "../Auth.js";
import { Config } from "../Config.js";
import { Logger } from "../Logger.js";
import { LoginProvider } from "../LoginProvider.js";
import { Util, Wellknown } from "../Util.js";
import { Base, Rights, TokenUser, User } from "../commoninterfaces.js";

const safeObjectID = (s: string | number | ObjectId) => ObjectId.isValid(s) ? new ObjectId(s) : null;

export class FormioEP {
    static async configure(app: express.Express, baseurl: string): Promise<void> {
        try {
            // Some times db is not connect yet, at this point, so wait til it is
            await Config.db.connect();
            const storage = new GridFsStorage({
                db: Config.db.db,
                file: (req, file) => {
                    return new Promise((resolve, reject) => {
                        crypto.randomBytes(16, async (err, buf) => {
                            if (err) {
                                return reject(err);
                            }
                            const filename = file.originalname;
                            const fileInfo = {
                                filename: filename,
                                metadata: new Base()
                            };
                            let user: User | TokenUser | undefined;
                            let jwt: string;
                            const authHeader = req.headers.authorization;
                            if (authHeader) {
                                user = await Auth.Token2User(authHeader, null);
                                if (user == null) throw new Error("Access denied");
                                jwt = await Auth.User2Token(user, Config.downloadtoken_expires_in, null);
                            }
                            else if (req.user) {
                                user = TokenUser.From(req.user as any);
                                jwt = await Auth.User2Token(user, Config.downloadtoken_expires_in, null);
                            }
                            const { query, headers } = req;
                            if (user === undefined) throw new Error("Access denied, unknown user");

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
                            Base.addRight(fileInfo.metadata, Wellknown.filestore_admins._id, Wellknown.filestore_admins.name, [Rights.full_control]);
                            if (!Config.multi_tenant) {
                                Base.addRight(fileInfo.metadata, Wellknown.filestore_users._id, Wellknown.filestore_users.name, [Rights.read]);
                            }
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
                storage: storage,
                limits: {
                    fileSize: (1000000 * Config.upload_max_filesize_mb) // 25MB
                }
            }).any();
            app.delete("/upload", async (req: any, res: any, next: any): Promise<void> => {
                const span: Span = Logger.otel.startSpanExpress("LoginProvider.upload", req);
                try {
                    span?.setAttribute("remoteip", LoginProvider.remoteip(req));
                    let user: TokenUser | User = null;
                    let jwt: string = null;
                    const authHeader = req.headers.authorization;
                    if (authHeader) {
                        user = await Auth.Token2User(authHeader, span);
                        if (user == null) throw new Error("Access denied");
                        jwt = await Auth.User2Token(user, Config.downloadtoken_expires_in, span);
                    }
                    else if (req.user) {
                        user = TokenUser.From(req.user as any);
                        jwt = await Auth.User2Token(user, Config.downloadtoken_expires_in, span);
                    }
                    if (user == null) {
                        return res.status(404).send({ message: "Route " + req.url + " Not found." });
                    }
                    const _query = req.query;
                    let uniquename: string = _query.uniquename;
                    let query: any = {};
                    if (!Util.IsNullEmpty(uniquename)) {
                        if (Array.isArray(uniquename)) uniquename = uniquename.join("_");
                        if (uniquename.indexOf("/") > -1) uniquename = uniquename.substr(0, uniquename.indexOf("/"));
                        query = { "metadata.uniquename": uniquename };
                    }

                    const arr = await Config.db.query({ query, top: 1, orderby: { "uploadDate": -1 }, collectionname: "files", jwt }, span);
                    if (arr.length > 0) {
                        await Config.db.DeleteOne(arr[0]._id, "files", false, jwt, span);
                    }
                    res.send({
                        status: "success",
                        display_status: "Success",
                        message: uniquename + " deleted"
                    });
                } catch (error) {
                    span?.recordException(error);
                    Logger.instanse.error(error, span);
                    return res.status(500).send({ message: error.message ? error.message : error });
                } finally {
                    Logger.otel.endSpan(span);
                }

            });
            app.get("/upload", async (req: any, res: any, next: any): Promise<void> => {
                const span: Span = Logger.otel.startSpanExpress("LoginProvider.upload", req);
                try {
                    span?.setAttribute("remoteip", LoginProvider.remoteip(req));
                    let user: TokenUser | User = null;
                    let jwt: string = null;
                    const authHeader = req.headers.authorization;
                    if (authHeader) {
                        user = await Auth.Token2User(authHeader, span);
                        if (user == null) throw new Error("Access denied");
                        jwt = await Auth.User2Token(user, Config.downloadtoken_expires_in, span);
                    }
                    else if (req.user) {
                        user = TokenUser.From(req.user as any);
                        jwt = await Auth.User2Token(user, Config.downloadtoken_expires_in, span);
                    }
                    if (user == null) {
                        return res.status(404).send({ message: "Route " + req.url + " Not found." });
                    }
                    const _query = req.query;
                    let uniquename: string = _query.uniquename;
                    let _id: string = _query.id || _query._id;
                    let query: any = {};
                    if (!Util.IsNullEmpty(uniquename)) {
                        if (Array.isArray(uniquename)) uniquename = uniquename.join("_");
                        if (uniquename.indexOf("/") > -1) uniquename = uniquename.substr(0, uniquename.indexOf("/"));
                        query = { "metadata.uniquename": uniquename };
                    } else if (!Util.IsNullEmpty(_id)) {
                        query = { _id };
                    } else {
                        return res.status(404).send({ message: "nothing unique. Not found." });
                    }

                    const arr = await Config.db.query({ query, top: 1, orderby: { "uploadDate": -1 }, collectionname: "files", jwt }, span);
                    if (arr.length == 0) {
                        if (!Util.IsNullEmpty(uniquename)) {
                            return res.status(404).send({ message: "uniquename " + uniquename + " Not found." });
                        }
                        return res.status(404).send({ message: "id " + _id + " Not found." });
                    }
                    const id = arr[0]._id;
                    const rows = await Config.db.query({ query: { _id: safeObjectID(id) }, top: 1, collectionname: "files", jwt }, span);
                    if (rows == null || rows.length != 1) { return res.status(404).send({ message: "id " + id + " Not found." }); }
                    const file = rows[0] as any;

                    const bucket = new GridFSBucket(Config.db.db);
                    let downloadStream = bucket.openDownloadStream(safeObjectID(id));
                    res.set("Content-Type", file.contentType);
                    res.set("Content-Disposition", `attachment; filename="${file.filename}"`);
                    res.set("Content-Length", file.length);
                    downloadStream.on("error", function (err) {
                        res.end();
                    });
                    downloadStream.pipe(res);
                    return;
                } catch (error) {
                    Logger.instanse.error(error, span);
                    return res.status(500).send({ message: error.message ? error.message : error });
                } finally {
                    Logger.otel.endSpan(span);
                }
            });
            app.post("/upload", async (req, res) => {
                const span: Span = Logger.otel.startSpanExpress("LoginProvider.upload", req);
                try {
                    let user: TokenUser | User = null;
                    let jwt: string = null;
                    const authHeader = req.headers.authorization;
                    if (authHeader) {
                        user = await Auth.Token2User(authHeader, span);
                        if (user == null) throw new Error("Access denied");
                        jwt = await Auth.User2Token(user, Config.downloadtoken_expires_in, span);
                    }
                    else if (req.user) {
                        user = TokenUser.From(req.user as any);
                        jwt = await Auth.User2Token(user, Config.downloadtoken_expires_in, span);
                    }
                    if (user == null) {
                        return res.status(404).send({ message: "Route " + req.url + " Not found." });
                    }

                    upload(req, res, function (err) {
                        if (err) {
                            res.json({ error_code: 1, err_desc: err });
                            return;
                        }
                        LoginProvider.redirect(res, req.headers.referer);
                    });
                } catch (error) {
                    Logger.instanse.error(error, span);
                    return res.status(500).send({ message: error.message ? error.message : error });
                } finally {
                    Logger.otel.endSpan(span);
                }
            });
            app.get("/form", async (req: any, res: any, next: any) => {
                if (!Logger.License.validlicense) await Logger.License.validate()
                const span: Span = Logger.otel.startSpanExpress("LoginProvider.form", req);
                try {
                    const authHeader = req.headers.authorization;
                    let user: TokenUser | User = null;
                    let jwt: string = null;
                    if (authHeader) {
                        user = await Auth.Token2User(authHeader, span);
                        if (user == null) throw new Error("Access denied");
                        jwt = await Auth.User2Token(user, Config.downloadtoken_expires_in, span);
                    }
                    else if (req.user) {
                        user = TokenUser.From(req.user as any);
                        jwt = await Auth.User2Token(user, Config.downloadtoken_expires_in, span);
                    }
                    if (user == null) {
                        return res.status(404).send({ message: "Route " + req.url + " Not found." });
                    }

                    try {
                        // /form?type=resource&limit=4294967295&select=_id,title&limit=100&skip=0
                        if (req.query.type == "resource") {
                            var results = await Config.db.query<Base>({ query: { _type: "resource" }, collectionname: "forms", jwt }, span);
                            results.forEach(result => {
                                // @ts-ignore
                                if (Util.IsNullEmpty(result.title)) result.title = result.name;
                            });
                            return res.send(results);

                        }
                    } catch (error) {
                        Logger.instanse.error(error, span);
                    }
                    res.status(404).send({ message: "unknown url" });
                } catch (error) {
                    Logger.instanse.error(error, span);
                    return res.status(500).send({ message: error.message ? error.message : error });
                } finally {
                    Logger.otel.endSpan(span);
                }
            });
            app.get("/form/:resource", async (req: any, res: any, next: any) => {
                if (!Logger.License.validlicense) await Logger.License.validate()
                const span: Span = Logger.otel.startSpanExpress("LoginProvider.form", req);
                try {
                    const authHeader = req.headers.authorization;
                    let user: TokenUser | User = null;
                    let jwt: string = null;
                    const resourceid = req.params.resource;
                    const limit = req.query.limit;
                    const skip = req.query.skip;
                    if (authHeader) {
                        user = await Auth.Token2User(authHeader, span);
                        if (user == null) throw new Error("Access denied");
                        jwt = await Auth.User2Token(user, Config.downloadtoken_expires_in, span);
                    }
                    else if (req.user) {
                        user = TokenUser.From(req.user as any);
                        jwt = await Auth.User2Token(user, Config.downloadtoken_expires_in, span);
                    }
                    if (user == null) {
                        return res.status(404).send({ message: "Route " + req.url + " Not found." });
                    }
                    if (Util.IsNullEmpty(resourceid)) {
                        return res.status(404).send({ message: "Route " + req.url + " Not found." });
                    }

                    // /form/1/submission?limit=100&skip=0
                    // /form/1?limit=100&skip=0
                    const resource: any = await Config.db.getbyid<Base>(resourceid, "forms", jwt, true, null);
                    // @ts-ignore
                    if (Util.IsNullEmpty(resource.label)) resource.label = resource.name;



                    this.expandobject(resource.aggregates);
                    resource.aggregates.push({ "$limit": 1 });
                    var dbresults = await Config.db.aggregate<Base>(resource.aggregates, resource.collection, jwt, null, null, false, null);
                    if (dbresults.length > 0) {
                        const keys = Object.keys(dbresults[0]);
                        let components = [];
                        keys.forEach(key => {
                            components.push({ "label": key, "key": key, "input": true, "inputType": "email", "hidden": false })
                        });
                        resource.components = components;
                    }
                    return res.send(resource);
                } catch (error) {
                    Logger.instanse.error(error, span);
                    return res.status(500).send({ message: error.message ? error.message : error });
                } finally {
                    Logger.otel.endSpan(span);
                }
            });
            app.get("/form/:resourceid/submission", async (req: any, res: any, next: any) => {
                if (!Logger.License.validlicense) await Logger.License.validate()
                const span: Span = Logger.otel.startSpanExpress("LoginProvider.form", req);
                try {
                    const authHeader = req.headers.authorization || req.headers["x-jwt-token"];
                    let user: TokenUser | User = null;
                    let jwt: string = null;
                    const resourceid = req.params.resourceid;
                    const query = req.query.query || req.query.q;
                    const limit = req.query.limit;
                    const skip = req.query.skip;
                    const sort = req.query.sort;
                    if (authHeader) {
                        user = await Auth.Token2User(authHeader, span);
                        if (user == null) throw new Error("Access denied");
                        jwt = await Auth.User2Token(user, Config.downloadtoken_expires_in, span);
                    }
                    else if (req.user) {
                        user = TokenUser.From(req.user as any);
                        jwt = await Auth.User2Token(user, Config.downloadtoken_expires_in, span);
                    }
                    if (user == null) {
                        return res.status(404).send({ message: "Route " + req.url + " Not found." });
                    }
                    if (Util.IsNullEmpty(resourceid)) {
                        return res.status(404).send({ message: "Route " + req.url + " Not found." });
                    }

                    let resource: any = await Config.db.getbyid(resourceid, "forms", jwt, true, span);
                    if (Util.IsNullUndefinded(resource)) {
                        return res.status(404).send({ message: "Route " + resourceid + " Not found." });
                    }

                    this.expandobject(resource.aggregates);

                    var keys = Object.keys(req.query);
                    var queryfields = keys.filter(x => x.startsWith("data.") && x.endsWith("__regex"))
                    if (queryfields.length > 0) {
                        let ors = [];
                        let logfields = [];
                        queryfields.forEach(f => {
                            let field = f.substring(5, f.length - 7);
                            logfields.push(field)
                            let value = req.query[f];
                            let m = {};
                            m[field] = { $regex: ".*" + value + ".*", $options: "si" }
                            ors.push(m);
                        });
                        resource.aggregates.unshift({ "$match": { "$or": ors } });
                        Logger.instanse.debug("searching using " + logfields.join(", ") + " fields", span);
                    }

                    if (!Util.IsNullEmpty(query)) {
                        resource.aggregates.unshift({ "$match": { name: { $regex: ".*" + query + ".*", $options: "si" } } });
                    }
                    if (!Util.IsNullEmpty(sort)) {
                        var sorts = sort.split(",");
                        var orderby = {};
                        sorts.forEach(s => {
                            orderby[s] = 1;
                        });
                        resource.aggregates.push({ "$sort": orderby });
                        Logger.instanse.debug("sort using " + sorts.join(", ") + " fields", span);
                    }
                    if (!Util.IsNullEmpty(skip) && !isNaN(skip) && skip > 0) {
                        resource.aggregates.push({ "$skip": +skip });
                    }
                    if (!Util.IsNullEmpty(limit) && !isNaN(limit) && limit > 0) {
                        resource.aggregates.push({ "$limit": +limit });
                    }
                    var dbresults = await Config.db.aggregate<Base>(resource.aggregates, resource.collection, jwt, null, null, false, span);
                    var results = [];
                    dbresults.forEach(result => {
                        results.push({ "data": result, label: result.name, id: result._id });
                    });
                    Logger.instanse.info("Return " + dbresults.length + " items based of resource " + resource.name, span);
                    return res.send(results);
                } catch (error) {
                    Logger.instanse.error(error, span);
                    return res.status(500).send({ message: error.message ? error.message : error });
                } finally {
                    Logger.otel.endSpan(span);
                }
            });
        } catch (error) {
            Logger.instanse.error(error, null);
        }
    }
    static expandobject(o) {
        const keys = Object.keys(o);
        for (let i = 0; i < keys.length; i++) {
            let key = keys[i];
            if (key.startsWith("___")) {
                let newkey = "$" + key.substr(3);
                o[newkey] = o[key];
                delete o[key];
                key = newkey;
            }
            if (typeof (o[key]) === "object") {
                this.expandobject(o[key]);
            }
        }
    }

}