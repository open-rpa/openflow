import {
    ObjectID, Db, Binary, InsertOneWriteOpResult, DeleteWriteOpResultObject, ObjectId, MapReduceOptions, CollectionInsertOneOptions, UpdateWriteOpResult, WriteOpResult, GridFSBucket, ReadPreference, ChangeStream, CollectionAggregationOptions
} from "mongodb";
import { MongoClient } from "mongodb";
import winston = require("winston");
import { Crypt } from "./Crypt";
import { Config } from "./Config";
import { TokenUser, Base, WellknownIds, Rights, NoderedUtil, mapFunc, finalizeFunc, reduceFunc, Ace, UpdateOneMessage, UpdateManyMessage, InsertOrUpdateOneMessage, Role, Rolemember, User } from "openflow-api";
import { DBHelper } from "./DBHelper";
// tslint:disable-next-line: typedef
const safeObjectID = (s: string | number | ObjectID) => ObjectID.isValid(s) ? new ObjectID(s) : null;
const isoDatePattern = new RegExp(/\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z)/);
const jsondiffpatch = require('jsondiffpatch').create({
    objectHash: function (obj, index) {
        // try to find an id property, otherwise just use the index in the array
        return obj.name || obj.id || obj._id || '$$index:' + index;
    }
});


Object.defineProperty(Promise, 'retry', {
    configurable: true,
    writable: true,
    value: function retry(retries, executor) {
        console.log(`${retries} retries left!`)

        if (typeof retries !== 'number') {
            throw new TypeError('retries is not a number')
        }

        return new Promise(executor).catch(error => retries > 0
            ? (Promise as any).retry(retries - 1, executor)
            : Promise.reject(error)
        )
    }
})

export class DatabaseConnection {
    private mongodburl: string;
    private cli: MongoClient;
    public db: Db;
    private _logger: winston.Logger;
    private _dbname: string;
    constructor(logger: winston.Logger, mongodburl: string, dbname: string) {
        this._logger = logger;
        this._dbname = dbname;
        this.mongodburl = mongodburl;
    }
    static toArray(iterator): Promise<any[]> {
        return new Promise((resolve, reject) => {
            iterator.toArray((err, res) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(res);
                }
            });
        });
    }
    public isConnected: boolean = false;
    /**
     * Connect to MongoDB
     * @returns Promise<void>
     */
    async connect(): Promise<void> {
        //if (this.cli !== null && this.cli !== undefined && this.cli.isConnected) {
        if (this.cli !== null && this.cli !== undefined && this.isConnected) {
            return;
        }
        this.cli = await (Promise as any).retry(100, (resolve, reject) => {
            MongoClient.connect(this.mongodburl, { autoReconnect: false, useNewUrlParser: true, useUnifiedTopology: true }).then((cli) => {
                resolve(cli);
            }).catch((reason) => {
                console.error(reason);
                reject(reason);
            });
        });
        this._logger.info(`Really connected to mongodb`);
        // this.cli = await MongoClient.connect(this.mongodburl, { autoReconnect: false, useNewUrlParser: true });
        this.cli.on("error", (error) => {
            this.isConnected = false;
            this._logger.error(error);
        });
        this.db = this.cli.db(this._dbname);
        this.isConnected = true;
    }
    async ListCollections(jwt: string): Promise<any[]> {
        const result = await DatabaseConnection.toArray(this.db.listCollections());
        Crypt.verityToken(jwt);
        return result;
    }
    async DropCollection(collectionname: string, jwt: string): Promise<void> {
        const user: TokenUser = Crypt.verityToken(jwt);
        if (!user.HasRoleName("admins")) throw new Error("Access denied, droppping collection " + collectionname);
        if (["workflow", "entities", "config", "audit", "jslog", "openrpa", "nodered", "openrpa_instances", "forms", "workflow_instances", "users"].indexOf(collectionname) > -1) throw new Error("Access denied, dropping reserved collection " + collectionname);
        await this.db.dropCollection(collectionname);
    }

    async CleanACL<T extends Base>(item: T, user: TokenUser): Promise<T> {
        for (let i = item._acl.length - 1; i >= 0; i--) {
            {
                const ace = item._acl[i];
                if (typeof ace.rights === "string") {
                    const b = new Binary(Buffer.from(ace.rights, "base64"), 0);
                    (ace.rights as any) = b;
                }
                const arr = await this.db.collection("users").find({ _id: ace._id }).project({ name: 1 }).limit(1).toArray();
                if (arr.length == 0) {
                    item._acl.splice(i, 1);
                } else { ace.name = arr[0].name; }
            }
        }
        if (Config.force_add_admins) {
            Base.addRight(item, WellknownIds.admins, "admins", [Rights.full_control], false);
            this.ensureResource(item);
        }
        var addself: boolean = true;
        item._acl.forEach(ace => {
            if (ace._id == user._id) addself = false;
            if (addself) {
                user.roles.forEach(role => {
                    if (ace._id == role._id) addself = false;
                });
            }
        })
        if (addself) {
            Base.addRight(item, user._id, user.name, [Rights.full_control], false);
            this.ensureResource(item);
        }
        return item;
    }
    async Cleanmembers<T extends Role>(item: T, original: T): Promise<T> {
        const removed: Rolemember[] = [];
        if (item.members == null) item.members = [];
        if (original != null && Config.update_acl_based_on_groups == true) {
            for (let i = original.members.length - 1; i >= 0; i--) {
                const ace = original.members[i];
                const exists = item.members.filter(x => x._id == ace._id);
                if (exists.length == 0) {
                    removed.push(ace);
                }
            }
        }
        let doadd: boolean = true;
        const multi_tenant_skip: string[] = [WellknownIds.users, WellknownIds.filestore_users,
        WellknownIds.nodered_api_users, WellknownIds.nodered_users, WellknownIds.personal_nodered_users,
        WellknownIds.robot_users, , WellknownIds.robots];
        if (item._id == WellknownIds.users && Config.multi_tenant) {
            doadd = false;
        }
        if (doadd) {
            for (let i = item.members.length - 1; i >= 0; i--) {
                {
                    const ace = item.members[i];
                    if (Config.update_acl_based_on_groups == true) {
                        if (multi_tenant_skip.indexOf(item._id) > -1) {
                            if (ace._id != WellknownIds.admins && ace._id != WellknownIds.root) {
                                // item.removeRight(ace._id, [Rights.read]);
                            }
                        } else {
                            // item.addRight(ace._id, ace.name, [Rights.read]);
                        }
                    }
                    const exists = item.members.filter(x => x._id == ace._id);
                    if (exists.length > 1) {
                        item.members.splice(i, 1);
                    } else {
                        const arr = await this.db.collection("users").find({ _id: ace._id }).project({ name: 1, _acl: 1, _type: 1 }).limit(1).toArray();
                        if (arr.length == 0) {
                            item.members.splice(i, 1);
                        }
                        else if (Config.update_acl_based_on_groups == true) {
                            ace.name = arr[0].name;
                            if (Config.multi_tenant && multi_tenant_skip.indexOf(item._id) > -1) {
                                // when multi tenant don't allow members of common user groups to see each other
                                this._logger.info("Running in multi tenant mode, skip adding permissions for " + item.name);
                            } else if (arr[0]._type == "user") {
                                const u: User = User.assign(arr[0]);
                                if (!Base.hasRight(u, item._id, Rights.read)) {
                                    this._logger.debug("Assigning " + item.name + " read permission to " + u.name);
                                    Base.addRight(u, item._id, item.name, [Rights.read], false);

                                    await this.db.collection("users").updateOne({ _id: u._id }, { $set: { _acl: u._acl } });
                                    // await this.db.collection("users").save(u);
                                } else if (u._id != item._id) {
                                    this._logger.debug(item.name + " allready exists on " + u.name);
                                }
                            } else if (arr[0]._type == "role") {
                                const r: Role = Role.assign(arr[0]);
                                if (r._id == WellknownIds.admins || r._id == WellknownIds.users) {
                                } else if (!Base.hasRight(r, item._id, Rights.read)) {
                                    if (r.name == "admins") {
                                        const b = true;
                                    }
                                    this._logger.debug("Assigning " + item.name + " read permission to " + r.name);
                                    Base.addRight(r, item._id, item.name, [Rights.read], false);
                                    await this.db.collection("users").updateOne({ _id: r._id }, { $set: { _acl: r._acl } });
                                    // await this.db.collection("users").save(r);
                                } else if (r._id != item._id) {
                                    this._logger.debug(item.name + " allready exists on " + r.name);
                                }

                            }
                        }
                    }
                }
            }
        }

        if (Config.update_acl_based_on_groups) {
            for (let i = removed.length - 1; i >= 0; i--) {
                const ace = removed[i];
                const arr = await this.db.collection("users").find({ _id: ace._id }).project({ name: 1, _acl: 1, _type: 1 }).limit(1).toArray();
                if (arr.length == 1 && item._id != WellknownIds.admins && item._id != WellknownIds.root) {
                    if (Config.multi_tenant && multi_tenant_skip.indexOf(item._id) > -1) {
                        // when multi tenant don't allow members of common user groups to see each other
                        this._logger.info("Running in multi tenant mode, skip removing permissions for " + item.name);
                    } else if (arr[0]._type == "user") {
                        const u: User = User.assign(arr[0]);
                        if (Base.hasRight(u, item._id, Rights.read)) {
                            Base.removeRight(u, item._id, [Rights.read]);

                            // was read the only right ? then remove it
                            const right = Base.getRight(u, item._id, false);
                            if (right == null) {
                                this._logger.debug("Removing " + item.name + " read permissions from " + u.name);
                                // await this.db.collection("users").save(u);
                                await this.db.collection("users").updateOne({ _id: u._id }, { $set: { _acl: u._acl } });

                            }

                        } else {
                            this._logger.debug("No need to remove " + item.name + " read permissions from " + u.name);
                        }
                    } else if (arr[0]._type == "role") {
                        const r: Role = Role.assign(arr[0]);
                        if (Base.hasRight(r, item._id, Rights.read)) {
                            Base.removeRight(r, item._id, [Rights.read]);

                            // was read the only right ? then remove it
                            const right = Base.getRight(r, item._id, false);
                            if (right == null) {
                                this._logger.debug("Removing " + item.name + " read permissions from " + r.name);
                                // await this.db.collection("users").save(r);
                                await this.db.collection("users").updateOne({ _id: r._id }, { $set: { _acl: r._acl } });
                            }

                        } else {
                            this._logger.debug("No need to remove " + item.name + " read permissions from " + r.name);
                        }
                    }

                }
            }
        }
        return item;
    }

    /**
     * Send a query to the database.
     * @param {any} query MongoDB Query
     * @param {Object} projection MongoDB projection
     * @param {number} top Limit result to X number of results
     * @param {number} skip Skip a number of records (Paging)
     * @param {Object|string} orderby MongoDB orderby, or string with name of a single field to orderby
     * @param {string} collectionname What collection to query
     * @param {string} jwt JWT of user who is making the query, to limit results based on permissions
     * @returns Promise<T[]> Array of results
     */
    // tslint:disable-next-line: max-line-length
    async query<T extends Base>(query: any, projection: Object, top: number, skip: number, orderby: Object | string, collectionname: string, jwt: string, queryas: string = null, hint: Object | string = null): Promise<T[]> {
        await this.connect();
        let mysort: Object = {};
        if (orderby) {
            if (typeof orderby === "string" || orderby instanceof String) {
                let neworderby = null;
                try {
                    if (orderby.indexOf("{") > -1) {
                        neworderby = JSON.parse((orderby as string));
                        mysort = neworderby;
                    }
                } catch (error) {
                    console.log(error, orderby);
                }
                if (neworderby == null) mysort[(orderby as string)] = 1;
            } else {
                mysort = orderby;
            }
        }
        let myhint: Object = {};
        if (hint) {
            if (typeof hint === "string" || hint instanceof String) {
                let newhint = null;
                try {
                    if (hint.indexOf("{") > -1) {
                        newhint = JSON.parse((hint as string));
                        myhint = newhint;
                    }
                } catch (error) {
                    console.log(error, hint);
                }
                if (newhint == null) myhint[(hint as string)] = 1;
            } else {
                myhint = hint;
            }
        }
        // orderby: Object | string
        if (projection) {
            if (typeof projection === "string" || projection instanceof String) {
                projection = JSON.parse((projection as string));
            }
        }
        // for (let key in query) {
        if (query !== null && query !== undefined) {
            let json: any = query;
            if (typeof json !== 'string' && !(json instanceof String)) {
                json = JSON.stringify(json, (key, value) => {
                    if (value instanceof RegExp)
                        return ("__REGEXP " + value.toString());
                    else
                        return value;
                });
            }
            query = JSON.parse(json, (key, value) => {
                if (typeof value === 'string' && value.match(isoDatePattern)) {
                    return new Date(value); // isostring, so cast to js date
                } else if (value != null && value != undefined && value.toString().indexOf("__REGEXP ") == 0) {
                    const m = value.split("__REGEXP ")[1].match(/\/(.*)\/(.*)?/);
                    return new RegExp(m[1], m[2] || "");
                } else
                    return value; // leave any other value as-is
            });
        }
        const keys: string[] = Object.keys(query);
        for (let i: number = 0; i < keys.length; i++) {
            let key: string = keys[i];
            if (key === "_id") {
                const id: string = query._id;
                const safeid = safeObjectID(id);
                if (safeid !== null && safeid !== undefined) {
                    delete query._id;
                    query.$or = [{ _id: id }, { _id: safeObjectID(id) }];
                }
            }
        }
        const user: TokenUser = Crypt.verityToken(jwt);
        let _query: Object = {};
        if (collectionname === "files") { collectionname = "fs.files"; }
        if (collectionname === "fs.files") {
            if (!NoderedUtil.IsNullEmpty(queryas)) {
                _query = { $and: [query, this.getbasequery(jwt, "metadata._acl", [Rights.read]), await this.getbasequeryuserid(queryas, "metadata._acl", [Rights.read])] };
            } else {
                _query = { $and: [query, this.getbasequery(jwt, "metadata._acl", [Rights.read])] };
            }
            projection = null;
        } else {
            // if (!collectionname.endsWith("_hist")) {
            //     _query = { $and: [query, this.getbasequery(jwt, "_acl", [Rights.read])] };
            // } else {
            //     // todo: enforcer permissions when fetching _hist ?
            //     _query = { $and: [query, this.getbasequery(jwt, "_acl", [Rights.read])] };
            // }
            if (!NoderedUtil.IsNullEmpty(queryas)) {
                _query = { $and: [query, this.getbasequery(jwt, "_acl", [Rights.read]), await this.getbasequeryuserid(queryas, "_acl", [Rights.read])] };
            } else {
                _query = { $and: [query, this.getbasequery(jwt, "_acl", [Rights.read])] };
            }
        }
        if (!top) { top = 500; }
        if (!skip) { skip = 0; }
        // if (collectionname == "openrpa") {
        //     const user: TokenUser = Crypt.verityToken(jwt);
        //     arr = await this.db.collection(collectionname).find(query).limit(top).skip(skip).toArray();
        //     _query = { $and: [query, this.getbasequery(jwt, "_acl", [Rights.read])] };
        // }
        let arr: T[] = [];

        let _pipe = this.db.collection(collectionname).find(_query);
        if (projection != null) {
            _pipe = _pipe.project(projection);
        }
        _pipe = _pipe.sort(mysort as any).limit(top).skip(skip);
        if (hint) {
            _pipe = _pipe.hint(myhint);
        }
        arr = await _pipe.toArray();
        // if (projection != null) {
        //     arr = await this.db.collection(collectionname).find(_query).project(projection).sort(mysort as any).limit(top).skip(skip).toArray();
        // } else {
        //     arr = await this.db.collection(collectionname).find(_query).sort(mysort as any).limit(top).skip(skip).toArray();
        // }
        for (let i: number = 0; i < arr.length; i++) { arr[i] = this.decryptentity(arr[i]); }
        DatabaseConnection.traversejsondecode(arr);
        if (Config.log_queries) this._logger.debug("[" + user.username + "][" + collectionname + "] query gave " + arr.length + " results ");
        return arr;
    }
    async GetDocumentVersion<T extends Base>(collectionname: string, id: string, version: number, jwt: string): Promise<T> {
        const roundDown = function (num, precision): number {
            num = parseFloat(num);
            if (!precision) return num;
            return (Math.floor(num / precision) * precision);
        };

        let result: T = await this.getbyid<T>(id, collectionname, jwt);
        if (result == null) return result;
        if (result._version > version) {
            const rootjwt = Crypt.rootToken()
            // const baseversion = roundDown(version, Config.history_delta_count);
            const basehist = await this.query<any>({ id: id, item: { $exists: true, $ne: null }, "_version": { $lte: version } }, null, 1, 0, { _version: -1 }, collectionname + "_hist", rootjwt);
            result = basehist[0].item;
            const baseversion = basehist[0]._version;

            const history = await this.query<T>({ id: id, "_version": { $gt: baseversion, $lte: version } }, null, Config.history_delta_count, 0, { _version: 1 }, collectionname + "_hist", rootjwt);

            for (let i = 0; i < history.length; i++) {
                const delta = (history[i] as any).delta;
                if (delta != null) {
                    result = jsondiffpatch.patch(result, delta);
                }
            }
        }
        return result;
    }

    /**
     * Get a single item based on id
     * @param  {string} id Id to search for
     * @param  {string} collectionname Collection to search
     * @param  {string} jwt JWT of user who is making the query, to limit results based on permissions
     * @returns Promise<T>
     */
    async getbyid<T extends Base>(id: string, collectionname: string, jwt: string): Promise<T> {
        if (id === null || id === undefined) { throw Error("Id cannot be null"); }
        const arr: T[] = await this.query<T>({ _id: id }, null, 1, 0, null, collectionname, jwt);
        if (arr === null || arr.length === 0) { return null; }
        return arr[0];
    }
    /**
     * Do MongoDB aggregation
     * @param  {any} aggregates
     * @param  {string} collectionname
     * @param  {string} jwt
     * @returns Promise
     */
    async aggregate<T extends Base>(aggregates: object[], collectionname: string, jwt: string, hint: Object | string = null): Promise<T[]> {
        await this.connect();

        let json: any = aggregates;
        if (typeof json !== 'string' && !(json instanceof String)) {
            json = JSON.stringify(json, (key, value) => {
                if (value instanceof RegExp)
                    return ("__REGEXP " + value.toString());
                else
                    return value;
            });
        }
        let myhint: Object = {};
        if (hint) {
            if (typeof hint === "string" || hint instanceof String) {
                let newhint = null;
                try {
                    if (hint.indexOf("{") > -1) {
                        newhint = JSON.parse((hint as string));
                        myhint = newhint;
                    }
                } catch (error) {
                    console.log(error, hint);
                }
                if (newhint == null) myhint[(hint as string)] = 1;
            } else {
                myhint = hint;
            }
        }
        aggregates = JSON.parse(json, (key, value) => {
            if (typeof value === 'string' && value.match(isoDatePattern)) {
                return new Date(value); // isostring, so cast to js date
            } else if (value != null && value != undefined && value.toString().indexOf("__REGEXP ") == 0) {
                const m = value.split("__REGEXP ")[1].match(/\/(.*)\/(.*)?/);
                return new RegExp(m[1], m[2] || "");
            } else
                return value; // leave any other value as-is
        });

        const base = this.getbasequery(jwt, "_acl", [Rights.read]);
        if (Array.isArray(aggregates)) {
            aggregates.unshift({ $match: base });
        } else {
            aggregates = [{ $match: base }, aggregates];
        }
        // const items: T[] = await this.db.collection(collectionname).aggregate(aggregates).toArray();
        const options: CollectionAggregationOptions = {};
        options.hint = myhint;
        const items: T[] = await this.db.collection(collectionname).aggregate(aggregates, options).toArray();
        DatabaseConnection.traversejsondecode(items);
        return items;
    }
    /**
     * Do MongoDB watch
     * @param  {any} aggregates
     * @param  {string} collectionname
     * @param  {string} jwt
     * @returns Promise
     */
    async watch<T extends Base>(aggregates: object[], collectionname: string, jwt: string): Promise<ChangeStream> {
        await this.connect();

        let json: any = aggregates;
        if (typeof json !== 'string' && !(json instanceof String)) {
            json = JSON.stringify(json, (key, value) => {
                if (value instanceof RegExp)
                    return ("__REGEXP " + value.toString());
                else
                    return value;
            });
        }

        if (!NoderedUtil.IsNullEmpty(json)) {
            aggregates = JSON.parse(json, (key, value) => {
                if (typeof value === 'string' && value.match(isoDatePattern)) {
                    return new Date(value); // isostring, so cast to js date
                } else if (value != null && value != undefined && value.toString().indexOf("__REGEXP ") == 0) {
                    const m = value.split("__REGEXP ")[1].match(/\/(.*)\/(.*)?/);
                    return new RegExp(m[1], m[2] || "");
                } else
                    return value; // leave any other value as-is
            });
        } else { aggregates = null; }

        // TODO: Should we filter on rights other than read ? should a person with reade be allowed to know when it was updated ?
        // a person with read, would beablt to know anyway, so guess read should be enough for now ... 
        const base = this.getbasequery(jwt, "fullDocument._acl", [Rights.read]);
        if (Array.isArray(aggregates)) {
            aggregates.unshift({ $match: base });
        } else {
            if (NoderedUtil.IsNullUndefinded(aggregates)) {
                aggregates = [{ $match: base }];
            } else {
                aggregates = [{ $match: base }, aggregates];
            }
        }
        return await this.db.collection(collectionname).watch(aggregates);
    }
    /**
     * Do MongoDB map reduce
     * @param  {any} aggregates
     * @param  {string} collectionname
     * @param  {string} jwt
     * @returns Promise
     */
    async MapReduce<T>(map: mapFunc, reduce: reduceFunc, finalize: finalizeFunc, query: any, out: string | any, collectionname: string, scope: any, jwt: string): Promise<T[]> {
        await this.connect();

        if (query !== null && query !== undefined) {
            let json: any = query;
            if (typeof json !== 'string' && !(json instanceof String)) {
                json = JSON.stringify(json, (key, value) => {
                    if (value instanceof RegExp)
                        return ("__REGEXP " + value.toString());
                    else
                        return value;
                });
            }
            query = JSON.parse(json, (key, value) => {
                if (typeof value === 'string' && value.match(isoDatePattern)) {
                    return new Date(value); // isostring, so cast to js date
                } else if (value != null && value != undefined && value.toString().indexOf("__REGEXP ") == 0) {
                    const m = value.split("__REGEXP ")[1].match(/\/(.*)\/(.*)?/);
                    return new RegExp(m[1], m[2] || "");
                } else
                    return value; // leave any other value as-is
            });
        }
        let q: any = query;
        if (query !== null && query !== undefined) {
            q = { $and: [query, this.getbasequery(jwt, "_acl", [Rights.read])] };
        } else {
            q = this.getbasequery(jwt, "_acl", [Rights.read]);
        }

        if (finalize != null && finalize != undefined) {
            try {
                if (((finalize as any) as string).trim() == "") { (finalize as any) = null; }
            } catch (error) {
            }
        }
        let inline: boolean = false;
        const opt: MapReduceOptions = { query: q, out: { replace: "map_temp_res" }, finalize: finalize };

        // (opt as any).w = 0;

        let outcol: string = "map_temp_res";
        if (out === null || out === undefined || out === "") {
            opt.out = { replace: outcol };
        } else if (typeof out === 'string' || out instanceof String) {
            outcol = (out as string);
            opt.out = { replace: outcol };
        } else {
            opt.out = out;
            if (out.hasOwnProperty("replace")) { outcol = out.replace; }
            if (out.hasOwnProperty("merge")) { outcol = out.merge; }
            if (out.hasOwnProperty("reduce")) { outcol = out.reduce; }
            if (out.hasOwnProperty("inline")) { inline = true; }
        }
        opt.scope = scope;
        // opt.readPreference = ReadPreference.PRIMARY_PREFERRED;

        // const result:T[] = await this.db.collection(collectionname).mapReduce(map, reduce, {query: q, out : {inline : 1}});
        try {
            if (inline) {
                opt.out = { inline: 1 };
                const result: T[] = await this.db.collection(collectionname).mapReduce(map, reduce, opt);
                return result;
            } else {
                await this.db.collection(collectionname).mapReduce(map, reduce, opt);
                return [];
            }
        } catch (error) {
            throw error;
        }
    }
    /**
     * Create a new document in the database
     * @param  {T} item Item to create
     * @param  {string} collectionname The collection to create item in
     * @param  {number} w Write Concern ( 0:no acknowledgment, 1:Requests acknowledgment, 2: Requests acknowledgment from 2, 3:Requests acknowledgment from 3)
     * @param  {boolean} j Ensure is written to the on-disk journal.
     * @param  {string} jwt JWT of the user, creating the item, to ensure rights and permission
     * @returns Promise<T> Returns the new item added
     */
    async InsertOne<T extends Base>(item: T, collectionname: string, w: number, j: boolean, jwt: string): Promise<T> {
        if (item === null || item === undefined) { throw Error("Cannot create null item"); }
        await this.connect();
        item = this.ensureResource(item);
        DatabaseConnection.traversejsonencode(item);
        if (NoderedUtil.IsNullEmpty(jwt)) {
            throw new Error("jwt is null");
        }
        let name = item.name;
        if (NoderedUtil.IsNullEmpty(name)) name = item._name;
        if (NoderedUtil.IsNullEmpty(name)) name = "Unknown";
        const user: TokenUser = Crypt.verityToken(jwt);
        item._createdby = user.name;
        item._createdbyid = user._id;
        item._created = new Date(new Date().toISOString());
        item._modifiedby = user.name;
        item._modifiedbyid = user._id;
        item._modified = item._created;
        const hasUser: Ace = item._acl.find(e => e._id === user._id);
        if ((hasUser === null || hasUser === undefined)) {
            Base.addRight(item, user._id, user.name, [Rights.full_control]);
        }
        if (collectionname != "audit") { this._logger.silly("[" + user.username + "][" + collectionname + "] Adding " + item._type + " " + name + " to database"); }
        if (!this.hasAuthorization(user, item, Rights.create)) { throw new Error("Access denied, no authorization to InsertOne " + item._type + " " + name + " to database"); }

        item = this.encryptentity(item) as T;
        if (!item._id) { item._id = new ObjectID().toHexString(); }

        if (collectionname === "users" && item._type === "user" && item.hasOwnProperty("newpassword")) {
            (item as any).passwordhash = await Crypt.hash((item as any).newpassword);
            delete (item as any).newpassword;
        }
        j = ((j as any) === 'true' || j === true);
        w = parseInt((w as any));

        if (item.hasOwnProperty("_skiphistory")) {
            delete (item as any)._skiphistory;
            if (!Config.allow_skiphistory) {
                item._version = await this.SaveDiff(collectionname, null, item);
            }
        } else {
            item._version = await this.SaveDiff(collectionname, null, item);
        }

        item = await this.CleanACL(item, user);
        if (item._type === "role" && collectionname === "users") {
            item = await this.Cleanmembers(item as any, null);
        }

        if (collectionname === "users" && item._type === "user") {
            const u: TokenUser = (item as any);
            if (u.username == null || u.username == "") { throw new Error("Username is mandatory"); }
            if (u.name == null || u.name == "") { throw new Error("Name is mandatory"); }
            const exists = await DBHelper.FindByUsername(u.username, Crypt.rootToken());
            if (exists != null) { throw new Error("Access denied, user  '" + u.username + "' already exists"); }
        }
        if (collectionname === "users" && item._type === "role") {
            const r: Role = (item as any);
            if (r.name == null || r.name == "") { throw new Error("Name is mandatory"); }
            const exists2 = await DBHelper.FindRoleByName(r.name);
            if (exists2 != null) { throw new Error("Access denied, role '" + r.name + "' already exists"); }
        }

        // const options:CollectionInsertOneOptions = { writeConcern: { w: parseInt((w as any)), j: j } };
        const options: CollectionInsertOneOptions = { w: w, j: j };
        //const options: CollectionInsertOneOptions = { w: "majority" };
        const result: InsertOneWriteOpResult<T> = await this.db.collection(collectionname).insertOne(item, options);
        item = result.ops[0];
        if (collectionname === "users" && item._type === "user") {
            Base.addRight(item, item._id, item.name, [Rights.read, Rights.update, Rights.invoke]);
            const users: Role = await DBHelper.FindRoleByNameOrId("users", jwt);
            users.AddMember(item);
            item = await this.CleanACL(item, user);
            await DBHelper.Save(users, Crypt.rootToken());
            const user2: TokenUser = item as any;
            if (Config.auto_create_personal_nodered_group) {
                let name = user2.username;
                name = name.split("@").join("").split(".").join("");
                name = name.toLowerCase();

                const noderedadmins = await DBHelper.EnsureRole(jwt, name + "noderedadmins", null);
                Base.addRight(noderedadmins, user2._id, user2.username, [Rights.full_control]);
                Base.removeRight(noderedadmins, user2._id, [Rights.delete]);
                noderedadmins.AddMember(item);
                await DBHelper.Save(noderedadmins, Crypt.rootToken());
            }

        }
        if (collectionname === "users" && item._type === "role") {
            Base.addRight(item, item._id, item.name, [Rights.read]);
            item = await this.CleanACL(item, user);
            await this.db.collection(collectionname).replaceOne({ _id: item._id }, item);
        }
        DatabaseConnection.traversejsondecode(item);
        return item;
    }
    /**
     * Update entity in database
     * @param  {T} item Item to update
     * @param  {string} collectionname Collection containing item
     * @param  {number} w Write Concern ( 0:no acknowledgment, 1:Requests acknowledgment, 2: Requests acknowledgment from 2, 3:Requests acknowledgment from 3)
     * @param  {boolean} j Ensure is written to the on-disk journal.
     * @param  {string} jwt JWT of user who is doing the update, ensuring rights
     * @returns Promise<T>
     */
    async _UpdateOne<T extends Base>(query: any, item: T, collectionname: string, w: number, j: boolean, jwt: string): Promise<T> {
        let q = new UpdateOneMessage();
        q.query = query; q.item = item; q.collectionname = collectionname; q.w = w; q.j; q.jwt = jwt;
        q = await this.UpdateOne(q);
        if (q.opresult.result.ok == 1) {
            if (q.opresult.modifiedCount == 0) {
                throw Error("item not found!");
            } else if (q.opresult.modifiedCount == 1 || q.opresult.modifiedCount == undefined) {
                q.item = q.item;
            } else {
                throw Error("More than one item was updated !!!");
            }
        } else {
            throw Error("UpdateOne failed!!!");
        }
        return q.result;
    }
    async UpdateOne<T extends Base>(q: UpdateOneMessage): Promise<UpdateOneMessage> {
        let itemReplace: boolean = true;
        if (q === null || q === undefined) { throw Error("UpdateOneMessage cannot be null"); }
        if (q.item === null || q.item === undefined) { throw Error("Cannot update null item"); }
        await this.connect();
        const user: TokenUser = Crypt.verityToken(q.jwt);
        if (!this.hasAuthorization(user, (q.item as Base), Rights.update)) {
            const again = this.hasAuthorization(user, (q.item as Base), Rights.update);
            throw new Error("Access denied, no authorization to UpdateOne");
        }
        if (q.collectionname === "files") { q.collectionname = "fs.files"; }

        let original: T = null;
        // assume empty query, means full document, else update document
        if (q.query === null || q.query === undefined) {
            // this will add an _acl so needs to be after we checked old item
            if (!q.item.hasOwnProperty("_id")) {
                throw Error("Cannot update item without _id");
            }
            let name = q.item.name;
            if (NoderedUtil.IsNullEmpty(name)) name = (q.item as any)._name;
            if (NoderedUtil.IsNullEmpty(name)) name = "Unknown";

            original = await this.getbyid<T>(q.item._id, q.collectionname, q.jwt);
            if (!original) { throw Error("item not found!"); }
            if (!this.hasAuthorization(user, original, Rights.update)) {
                const again = this.hasAuthorization(user, original, Rights.update);
                throw new Error("Access denied, no authorization to UpdateOne " + q.item._type + " " + name + " to database");
            }
            if (q.collectionname != "fs.files") {
                q.item._modifiedby = user.name;
                q.item._modifiedbyid = user._id;
                q.item._modified = new Date(new Date().toISOString());
                // now add all _ fields to the new object
                const keys: string[] = Object.keys(original);
                for (let i: number = 0; i < keys.length; i++) {
                    let key: string = keys[i];
                    if (key === "_created") {
                        q.item[key] = new Date(original[key]);
                    } else if (key === "_createdby" || key === "_createdbyid") {
                        q.item[key] = original[key];
                    } else if (key === "_modifiedby" || key === "_modifiedbyid" || key === "_modified") {
                        // allready updated
                    } else if (key.indexOf("_") === 0) {
                        if (!q.item.hasOwnProperty(key)) {
                            q.item[key] = original[key]; // add missing key
                        } else if (q.item[key] === null) {
                            delete q.item[key]; // remove key
                        } else {
                            // key allready exists, might been updated since last save
                        }
                    }
                }
                if (q.item._acl === null || q.item._acl === undefined) {
                    q.item._acl = original._acl;
                    q.item._version = original._version;
                }
                q.item = this.ensureResource(q.item);
                DatabaseConnection.traversejsonencode(q.item);
                q.item = this.encryptentity(q.item);
                const hasUser: Ace = q.item._acl.find(e => e._id === user._id);
                if ((hasUser === null || hasUser === undefined) && q.item._acl.length == 0) {
                    Base.addRight(q.item, user._id, user.name, [Rights.full_control]);
                }
                if (q.collectionname === "users" && q.item._type === "user") {
                    Base.addRight(q.item, q.item._id, q.item.name, [Rights.read, Rights.update, Rights.invoke]);
                }
            } else {
                (q.item as any).metadata = Base.assign((q.item as any).metadata);
                (q.item as any).metadata._modifiedby = user.name;
                (q.item as any).metadata._modifiedbyid = user._id;
                (q.item as any).metadata._modified = new Date(new Date().toISOString());
                // now add all _ fields to the new object
                const keys: string[] = Object.keys((original as any).metadata);
                for (let i: number = 0; i < keys.length; i++) {
                    let key: string = keys[i];
                    if (key === "_created") {
                        (q.item as any).metadata[key] = new Date((original as any).metadata[key]);
                    } else if (key === "_createdby" || key === "_createdbyid") {
                        (q.item as any).metadata[key] = (original as any).metadata[key];
                    } else if (key === "_modifiedby" || key === "_modifiedbyid" || key === "_modified") {
                        // allready updated
                    } else if (key.indexOf("_") === 0) {
                        if (!(q.item as any).metadata.hasOwnProperty(key)) {
                            (q.item as any).metadata[key] = (original as any).metadata[key]; // add missing key
                        } else if ((q.item as any).metadata[key] === null) {
                            delete (q.item as any).metadata[key]; // remove key
                        } else {
                            // key allready exists, might been updated since last save
                        }
                    }
                }
                if ((q.item as any).metadata._acl === null || (q.item as any).metadata._acl === undefined) {
                    (q.item as any).metadata._acl = (original as any).metadata._acl;
                    (q.item as any).metadata._version = (original as any).metadata._version;
                }
                (q.item as any).metadata = this.ensureResource((q.item as any).metadata);
                DatabaseConnection.traversejsonencode(q.item);
                (q.item as any).metadata = this.encryptentity((q.item as any).metadata);
                const hasUser: Ace = (q.item as any).metadata._acl.find(e => e._id === user._id);
                if ((hasUser === null || hasUser === undefined) && (q.item as any).metadata._acl.length == 0) {
                    Base.addRight((q.item as any).metadata, user._id, user.name, [Rights.full_control]);
                }
            }

            if (q.item.hasOwnProperty("_skiphistory")) {
                delete (q.item as any)._skiphistory;
                if (!Config.allow_skiphistory) {
                    q.item._version = await this.SaveDiff(q.collectionname, original, q.item);
                }
            } else {
                q.item._version = await this.SaveDiff(q.collectionname, original, q.item);
            }
        } else {
            let json: string = q.item as any;
            if (typeof json !== 'string') {
                json = JSON.stringify(json);
            }
            q.item = JSON.parse(json, (key, value) => {
                if (typeof value === 'string' && value.match(isoDatePattern)) {
                    return new Date(value); // isostring, so cast to js date
                } else if (value != null && value != undefined && value.toString().indexOf("__REGEXP ") == 0) {
                    const m = value.split("__REGEXP ")[1].match(/\/(.*)\/(.*)?/);
                    return new RegExp(m[1], m[2] || "");
                } else
                    return value; // leave any other value as-is
            });

            itemReplace = false;
            if (q.item["$set"] !== null && q.item["$set"] !== undefined) {
                if (q.item["$set"].hasOwnProperty("_skiphistory")) {
                    delete q.item["$set"]._skiphistory;
                    if (!Config.allow_skiphistory) this.SaveUpdateDiff(q, user);
                }
            } else {
                this.SaveUpdateDiff(q, user);
            }

            // const _version = await this.SaveUpdateDiff(q, user);
            // if ((q.item["$set"]) === undefined) { (q.item["$set"]) = {} };
            // (q.item["$set"])._version = _version;
        }

        if (q.collectionname === "users" && q.item._type === "user" && q.item.hasOwnProperty("newpassword")) {
            (q.item as any).passwordhash = await Crypt.hash((q.item as any).newpassword);
            delete (q.item as any).newpassword;
        }
        this._logger.silly("[" + user.username + "][" + q.collectionname + "] Updating " + (q.item.name || q.item._name) + " in database");
        // await this.db.collection(collectionname).replaceOne({ _id: item._id }, item, options);

        if (q.query === null || q.query === undefined) {
            const id: string = q.item._id;
            const safeid = safeObjectID(id);
            q.query = { $or: [{ _id: id }, { _id: safeObjectID(id) }] };
        }
        let _query: Object = {};
        if (q.collectionname === "fs.files") {
            _query = { $and: [q.query, this.getbasequery(q.jwt, "metadata._acl", [Rights.update])] };
        } else {
            if (!q.collectionname.endsWith("_hist")) {
                _query = { $and: [q.query, this.getbasequery(q.jwt, "_acl", [Rights.update])] };
            } else {
                // todo: enforcer permissions when fetching _hist ?
                _query = { $and: [q.query, this.getbasequery(q.jwt, "_acl", [Rights.update])] };
            }
        }

        q.j = ((q.j as any) === 'true' || q.j === true);
        if ((q.w as any) !== "majority") q.w = parseInt((q.w as any));

        const options: CollectionInsertOneOptions = { w: q.w, j: q.j };
        q.opresult = null;
        try {
            if (itemReplace) {
                if (q.collectionname != "fs.files") {
                    q.item = await this.CleanACL(q.item, user);
                } else {
                    (q.item as any).metadata = await this.CleanACL((q.item as any).metadata, user);
                }
                if (q.item._type === "role" && q.collectionname === "users") {
                    q.item = await this.Cleanmembers(q.item as any, original);
                }

                if (q.collectionname != "fs.files") {
                    q.opresult = await this.db.collection(q.collectionname).replaceOne(_query, q.item, options);
                } else {
                    const fsc = Config.db.db.collection("fs.files");
                    q.opresult = await fsc.updateOne(_query, { $set: { metadata: (q.item as any).metadata } });
                }
            } else {
                if ((q.item["$set"]) === undefined) { (q.item["$set"]) = {} };
                (q.item["$set"])._modifiedby = user.name;
                (q.item["$set"])._modifiedbyid = user._id;
                (q.item["$set"])._modified = new Date(new Date().toISOString());
                if ((q.item["$inc"]) === undefined) { (q.item["$inc"]) = {} };
                (q.item["$inc"])._version = 1;
                q.opresult = await this.db.collection(q.collectionname).updateOne(_query, q.item, options);
            }
            if (q.collectionname != "fs.files") {
                q.item = this.decryptentity(q.item);
            } else {
                (q.item as any).metadata = this.decryptentity<T>((q.item as any).metadata);
            }
            DatabaseConnection.traversejsondecode(q.item);
            q.result = q.item;
        } catch (error) {
            throw error;
        }
        return q;
    }
    /**
    * Update multiple documents in database based on update document
    * @param {any} query MongoDB Query
    * @param  {T} item Update document
    * @param  {string} collectionname Collection containing item
    * @param  {number} w Write Concern ( 0:no acknowledgment, 1:Requests acknowledgment, 2: Requests acknowledgment from 2, 3:Requests acknowledgment from 3)
    * @param  {boolean} j Ensure is written to the on-disk journal.
    * @param  {string} jwt JWT of user who is doing the update, ensuring rights
    * @returns Promise<T>
    */
    async UpdateMany<T extends Base>(q: UpdateManyMessage): Promise<UpdateManyMessage> {
        if (q === null || q === undefined) { throw Error("UpdateManyMessage cannot be null"); }
        if (q.item === null || q.item === undefined) { throw Error("Cannot update null item"); }
        await this.connect();
        const user: TokenUser = Crypt.verityToken(q.jwt);
        if (!this.hasAuthorization(user, q.item, Rights.update)) { throw new Error("Access denied, no authorization to UpdateMany"); }

        if (q.collectionname === "users" && q.item._type === "user" && q.item.hasOwnProperty("newpassword")) {
            (q.item as any).passwordhash = await Crypt.hash((q.item as any).newpassword);
            delete (q.item as any).newpassword;
        }
        let json: string = q.item as any;
        if (typeof json !== 'string') {
            json = JSON.stringify(json);
        }
        q.item = JSON.parse(json, (key, value) => {
            if (typeof value === 'string' && value.match(isoDatePattern)) {
                return new Date(value); // isostring, so cast to js date
            } else if (value != null && value != undefined && value.toString().indexOf("__REGEXP ") == 0) {
                const m = value.split("__REGEXP ")[1].match(/\/(.*)\/(.*)?/);
                return new RegExp(m[1], m[2] || "");
            } else
                return value; // leave any other value as-is
        });
        for (let key in q.query) {
            if (key === "_id") {
                const id: string = (q.query as any)._id;
                delete (q.query as any)._id;
                (q.query as any).$or = [{ _id: id }, { _id: safeObjectID(id) }];
            }
        }
        let _query: Object = {};
        if (!NoderedUtil.IsNullEmpty(Config.stripe_api_secret) && q.collectionname === "users") {
            if (!user.HasRoleId("admins")) throw new Error("Access denied, no authorization to UpdateMany");
        }
        if (q.collectionname === "files") { q.collectionname = "fs.files"; }
        if (q.collectionname === "fs.files") {
            _query = { $and: [q.query, this.getbasequery(q.jwt, "metadata._acl", [Rights.update])] };
        } else {
            if (!q.collectionname.endsWith("_hist")) {
                _query = { $and: [q.query, this.getbasequery(q.jwt, "_acl", [Rights.update])] };
            } else {
                // todo: enforcer permissions when fetching _hist ?
                _query = { $and: [q.query, this.getbasequery(q.jwt, "_acl", [Rights.update])] };
            }
        }

        if ((q.item["$set"]) === undefined) { (q.item["$set"]) = {} };
        (q.item["$set"])._modifiedby = user.name;
        (q.item["$set"])._modifiedbyid = user._id;
        (q.item["$set"])._modified = new Date(new Date().toISOString());


        this._logger.silly("[" + user.username + "][" + q.collectionname + "] UpdateMany " + (q.item.name || q.item._name) + " in database");

        q.j = ((q.j as any) === 'true' || q.j === true);
        if ((q.w as any) !== "majority") q.w = parseInt((q.w as any));
        const options: CollectionInsertOneOptions = { w: q.w, j: q.j };
        try {
            q.opresult = await this.db.collection(q.collectionname).updateMany(_query, q.item, options);
            // if (res.modifiedCount == 0) {
            //     throw Error("item not found!");
            // }
            // if (res.result.ok == 1) {
            //     if (res.modifiedCount == 0) {
            //         throw Error("item not found!");
            //     } else if (res.modifiedCount == 1 || res.modifiedCount == undefined) {
            //         q.item = q.item;
            //     }
            // } else {
            //     throw Error("UpdateOne failed!!!");
            // }
            return q;
        } catch (error) {
            throw error;
        }
        // this.traversejsondecode(item);
        // return item;
    }
    /**
    * Insert or Update depending on document allready exists.
    * @param  {T} item Item to insert or update
    * @param  {string} collectionname Collection containing item
    * @param  {string} uniqeness List of fields to combine for uniqeness
    * @param  {number} w Write Concern ( 0:no acknowledgment, 1:Requests acknowledgment, 2: Requests acknowledgment from 2, 3:Requests acknowledgment from 3)
    * @param  {boolean} j Ensure is written to the on-disk journal.
    * @param  {string} jwt JWT of user who is doing the update, ensuring rights
    * @returns Promise<T>
    */
    async InsertOrUpdateOne<T extends Base>(q: InsertOrUpdateOneMessage): Promise<InsertOrUpdateOneMessage> {
        let query: any = null;
        if (q.uniqeness !== null && q.uniqeness !== undefined && q.uniqeness !== "") {
            query = {};
            const arr = q.uniqeness.split(",");
            arr.forEach(field => {
                if (field.trim() !== "") {
                    query[field] = q.item[field];
                }
            });
        } else {
            // has no id, and no uniqeness defined, so we assume its a new item we should insert
            if (q.item._id != null) {
                query = { _id: q.item._id };
            }
        }
        const user: TokenUser = Crypt.verityToken(q.jwt);
        let exists: Base[] = [];
        if (query != null) {
            exists = await this.query(query, { name: 1 }, 2, 0, null, q.collectionname, q.jwt);
        }
        if (exists.length == 1) {
            q.item._id = exists[0]._id;
        }
        else if (exists.length > 1) {
            throw JSON.stringify(query) + " is not uniqe, more than 1 item in collection matches this";
        }
        if (!this.hasAuthorization(user, q.item, Rights.update)) { throw new Error("Access denied, no authorization to InsertOrUpdateOne"); }
        // if (q.item._id !== null && q.item._id !== undefined && q.item._id !== "") {
        if (exists.length == 1) {
            this._logger.silly("[" + user.username + "][" + q.collectionname + "] InsertOrUpdateOne, Updating found one in database");
            const uq = new UpdateOneMessage();
            // uq.query = query; 
            uq.item = q.item; uq.collectionname = q.collectionname; uq.w = q.w; uq.j; uq.jwt = q.jwt;
            const uqres = await this.UpdateOne(uq);
            q.opresult = uqres.opresult;
            q.result = uqres.result;
        } else {
            this._logger.silly("[" + user.username + "][" + q.collectionname + "] InsertOrUpdateOne, Inserting as new in database");
            q.result = await this.InsertOne(q.item, q.collectionname, q.w, q.j, q.jwt);
        }
        return q;
    }
    private async _DeleteFile(id: string): Promise<string> {
        return new Promise<string>(async (resolve, reject) => {
            try {
                const _id = new ObjectID(id);
                const bucket = new GridFSBucket(this.db);
                bucket.delete(_id, (error) => {
                    if (error) return reject(error);
                    resolve();
                })
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * @param  {string} id id of object to delete
     * @param  {string} collectionname collectionname Collection containing item
     * @param  {string} jwt JWT of user who is doing the delete, ensuring rights
     * @returns Promise<void>
     */
    async DeleteOne(id: string | any, collectionname: string, jwt: string): Promise<void> {
        if (id === null || id === undefined || id === "") { throw Error("id cannot be null"); }
        await this.connect();
        const user: TokenUser = Crypt.verityToken(jwt);
        let _query: any = {};
        if (typeof id === 'string' || id instanceof String) {
            _query = { $and: [{ _id: id }, this.getbasequery(jwt, "_acl", [Rights.delete])] };
        } else {
            _query = { $and: [{ id }, this.getbasequery(jwt, "_acl", [Rights.delete])] };
        }

        if (collectionname === "files") { collectionname = "fs.files"; }
        if (collectionname === "fs.files") {
            _query = { $and: [{ _id: safeObjectID(id) }, this.getbasequery(jwt, "metadata._acl", [Rights.delete])] };
            const arr = await this.db.collection(collectionname).find(_query).toArray();
            if (arr.length == 1) {
                await this._DeleteFile(id);
                return;
            } else {
                throw Error("item not found!");
            }
        }
        this._logger.silly("[" + user.username + "][" + collectionname + "] Deleting " + id + " in database");
        const res: DeleteWriteOpResultObject = await this.db.collection(collectionname).deleteOne(_query);
    }

    /**
     * @param  {string} id id of object to delete
     * @param  {string} collectionname collectionname Collection containing item
     * @param  {string} jwt JWT of user who is doing the delete, ensuring rights
     * @returns Promise<void>
     */
    async DeleteMany(query: string | any, ids: string[], collectionname: string, jwt: string): Promise<number> {
        if (NoderedUtil.IsNullUndefinded(ids) && NoderedUtil.IsNullUndefinded(query)) { throw Error("id cannot be null"); }
        await this.connect();
        const user: TokenUser = Crypt.verityToken(jwt);
        let _query: any = {};
        let aclfield = "_acl";
        if (collectionname === "files") { collectionname = "fs.files"; }
        if (collectionname === "fs.files") {
            aclfield = "metadata._acl"
        }
        const baseq = this.getbasequery(jwt, aclfield, [Rights.delete]);
        if (NoderedUtil.IsNullUndefinded(query) && !NoderedUtil.IsNullUndefinded(ids)) {
            _query = { $and: [{ _id: { "$in": ids } }, baseq] };
        } else if (!NoderedUtil.IsNullUndefinded(query)) {
            if (query !== null && query !== undefined) {
                let json: any = query;
                if (typeof json !== 'string' && !(json instanceof String)) {
                    json = JSON.stringify(json, (key, value) => {
                        if (value instanceof RegExp)
                            return ("__REGEXP " + value.toString());
                        else
                            return value;
                    });
                }
                query = JSON.parse(json, (key, value) => {
                    if (typeof value === 'string' && value.match(isoDatePattern)) {
                        return new Date(value); // isostring, so cast to js date
                    } else if (value != null && value != undefined && value.toString().indexOf("__REGEXP ") == 0) {
                        const m = value.split("__REGEXP ")[1].match(/\/(.*)\/(.*)?/);
                        return new RegExp(m[1], m[2] || "");
                    } else
                        return value; // leave any other value as-is
                });
            }
            _query = { $and: [query, baseq] };
        } else {
            throw new Error("DeleteMany needs either a list of ids or a query");
        }

        if (collectionname === "files") { collectionname = "fs.files"; }
        if (collectionname === "fs.files") {
            const arr = await this.db.collection(collectionname).find(_query).toArray();
            this._logger.debug("[" + user.username + "][" + collectionname + "] Deleting " + arr.length + " files in database");
            for (let i = 0; i < arr.length; i++) {
                await this._DeleteFile(arr[i]._id);
            }
            return arr.length;
        } else {
            const res: DeleteWriteOpResultObject = await this.db.collection(collectionname).deleteMany(_query);
            this._logger.debug("[" + user.username + "][" + collectionname + "] Deleted " + res.deletedCount + " items in database");
            return res.deletedCount;
        }
    }
    /**
     * Helper function used to check if field needs to be encrypted
     * @param  {string[]} keys List of fields that needs to be encrypted
     * @param  {string} key Current field
     * @param  {object=null} value value of field, ensuring we can actully encrypt the field
     * @returns boolean
     */
    private _shouldEncryptValue(keys: string[], key: string, value: object = null): boolean {
        const shouldEncryptThisKey: boolean = keys.includes(key);
        return value && shouldEncryptThisKey;
        // const isString: boolean = typeof value === "string";
        // return value && shouldEncryptThisKey && isString;
    }
    /**
     * Enumerate object, encrypting fields that needs to be encrypted
     * @param  {T} item Item to enumerate
     * @returns T Object with encrypted fields
     */
    public encryptentity(item: Base): Base {
        if (item == null || item._encrypt === undefined || item._encrypt === null) { return item; }
        const me: DatabaseConnection = this;
        return (Object.keys(item).reduce((newObj, key) => {
            const value: any = item[key];
            try {
                if (this._shouldEncryptValue(item._encrypt, key, (value as any))) {
                    if (typeof value === "string") {
                        newObj[key] = Crypt.encrypt(value);
                    } else {
                        const tempvalue: any = JSON.stringify(value);
                        newObj[key] = Crypt.encrypt(tempvalue);
                    }
                } else {
                    newObj[key] = value;
                }
            } catch (err) {
                me._logger.error("encryptentity " + err.message);
                newObj[key] = value;
            }
            return newObj;
        }, item) as Base);
    }
    /**
     * Enumerate object, decrypting fields that needs to be decrypted
     * @param  {T} item Item to enumerate
     * @returns T Object with decrypted fields
     */
    public decryptentity<T extends Base>(item: T): T {
        if (item == null || item._encrypt === undefined || item._encrypt === null) { return item; }
        const me: DatabaseConnection = this;
        return (Object.keys(item).reduce((newObj, key) => {
            const value: any = item[key];
            try {
                if (this._shouldEncryptValue(item._encrypt, key, value)) {
                    let newvalue = Crypt.decrypt(value);
                    if (newvalue.indexOf("{") === 0 || newvalue.indexOf("[") === 0) {
                        try {
                            newvalue = JSON.parse(newvalue);
                        } catch (error) {
                        }
                    }
                    newObj[key] = newvalue;
                } else {
                    newObj[key] = value;
                }
            } catch (err) {
                me._logger.error("decryptentity " + err.message);
                newObj[key] = value;
            }
            return newObj;
        }, {}) as T);
    }
    /**
     * Create a MongoDB query filtering result based on permission of current user and requested permission
     * @param  {string} jwt JWT of the user creating the query
     * @param  {number[]} bits Permission wanted on objects
     * @returns Object MongoDB query
     */
    public getbasequery(jwt: string, field: string, bits: number[]): Object {
        if (Config.api_bypass_perm_check) {
            return { _id: { $ne: "bum" } };
        }
        const user: TokenUser = Crypt.verityToken(jwt);
        if (user._id === WellknownIds.root) {
            return { _id: { $ne: "bum" } };
        }
        const isme: any[] = [];
        isme.push({ _id: user._id });
        for (let i: number = 0; i < bits.length; i++) {
            bits[i]--; // bitwize matching is from offset 0, when used on bindata
        }
        user.roles.forEach(role => {
            isme.push({ _id: role._id });
        });
        const finalor: any[] = [];
        const q = {};
        // todo: add check for deny's
        q[field] = {
            $elemMatch: {
                rights: { $bitsAllSet: bits },
                deny: false,
                $or: isme
            }
        };
        finalor.push(q);
        if (field === "_acl") {
            const q2 = {};
            q2["value._acl"] = {
                $elemMatch: {
                    rights: { $bitsAllSet: bits },
                    deny: false,
                    $or: isme
                }
            };
            finalor.push(q2);
        }
        return { $or: finalor.concat() };
    }
    private async getbasequeryuserid(userid: string, field: string, bits: number[]): Promise<Object> {
        const user = await DBHelper.FindByUsernameOrId(null, userid);
        const jwt = Crypt.createToken(user, Config.shorttoken_expires_in);
        return this.getbasequery(jwt, field, bits);
    }
    /**
     * Ensure _type and _acs on object
     * @param  {T} item Object to validate
     * @returns T Validated object
     */
    ensureResource<T extends Base>(item: T): T {
        if (!item.hasOwnProperty("_type") || item._type === null || item._type === undefined) {
            item._type = "unknown";
        }
        item._type = item._type.toLowerCase();
        if (!item._acl) { item._acl = []; }
        item._acl.forEach((a, index) => {
            if (typeof a.rights === "string") {
                item._acl[index].rights = (new Binary(Buffer.from(a.rights, "base64"), 0) as any);
            }
        });
        if (item._acl.length === 0) {
            item = item;
            Base.addRight(item, WellknownIds.admins, "admins", [Rights.full_control]);
        }
        return item;
    }
    /**
     * Validated user has rights to perform the requested action ( create is missing! )
     * @param  {TokenUser} user User requesting permission
     * @param  {any} item Item permission is needed on
     * @param  {Rights} action Permission wanted (create, update, delete)
     * @returns boolean Is allowed
     */
    hasAuthorization(user: TokenUser, item: Base, action: number): boolean {
        if (Config.api_bypass_perm_check) { return true; }
        if (user._id === WellknownIds.root) { return true; }
        if (action === Rights.create || action === Rights.delete) {
            if (item._type === "role") {
                if (item.name.toLowerCase() === "users" || item.name.toLowerCase() === "admins" || item.name.toLowerCase() === "workflow") {
                    return false;
                }
            }
            if (item._type === "user") {
                if (item.name === "workflow") {
                    return false;
                }
            }
        }
        if (action === Rights.update && item._id === WellknownIds.admins && item.name.toLowerCase() !== "admins") {
            return false;
        }
        if (action === Rights.update && item._id === WellknownIds.users && item.name.toLowerCase() !== "users") {
            return false;
        }
        if (action === Rights.update && item._id === WellknownIds.root && item.name.toLowerCase() !== "root") {
            return false;
        }
        if ((item as any).userid === user.username || (item as any).userid === user._id || (item as any).user === user.username) {
            return true;
        } else if (item._id === user._id) {
            if (action === Rights.delete) { this._logger.error("[" + user.username + "] hasAuthorization, cannot delete self!"); return false; }
            return true;
        }

        if (item._acl != null && item._acl != undefined) {
            if (typeof item._acl === 'string' || item._acl instanceof String) {
                item._acl = JSON.parse((item._acl as any));
            }

            const a = item._acl.filter(x => x._id == user._id);
            if (a.length > 0) {
                if (Ace.isBitSet(a[0], action)) return true;
            }
            for (let i = 0; i < user.roles.length; i++) {
                const b = item._acl.filter(x => x._id == user.roles[i]._id);
                if (b.length > 0) {
                    if (Ace.isBitSet(b[0], action)) return true;
                }
            }
            return false;
        }
        return true;
    }
    public static replaceAll(target, search, replacement) {
        //const target = this;
        // return target.replace(new RegExp(search, 'g'), replacement);
        return target.split(search).join(replacement);
    };
    /**
     * Helper function to clean item before saving in MongoDB ( normalize ACE rights and remove illegal key $$ )
     * @param  {object} o Item to clean
     * @returns void Clean object
     */
    public static traversejsonencode(o) {
        const reISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}(?:\.\d*))(?:Z|(\+|-)([\d|:]*))?$/;
        const reMsAjax = /^\/Date\((d|-|.*)\)[\/|\\]$/;

        const keys = Object.keys(o);
        for (let i = 0; i < keys.length; i++) {
            let key = keys[i];
            let value = o[key];
            if (typeof value === 'string') {
                const a = reISO.exec(value);
                if (a) {
                    o[key] = new Date(value);
                } else {
                    const c = reMsAjax.exec(value);
                    if (c) {
                        const b = c[1].split(/[-+,.]/);
                        o[key] = new Date(b[0] ? +b[0] : 0 - +b[1]);
                    }
                }
            }
            if (key.indexOf('.') > -1) {
                try {
                    // const newkey = key.replace(new RegExp('.', 'g'), '____');
                    const newkey = this.replaceAll(key, ".", "____");
                    o[newkey] = o[key];
                    delete o[key];
                    key = newkey;
                } catch (error) {
                }
            }
            if (key.startsWith('$$')) {
                delete o[key];
            } else if (o[key]) {
                if (typeof o[key] == 'string') {
                    if (o[key].length == 24 && o[key].endsWith('Z')) {
                        o[key] = new Date(o[key]);
                    }
                }
                if (typeof (o[key]) == "object") {
                    this.traversejsonencode(o[key]);
                }
            }

        }

    }
    public static traversejsondecode(o) {
        const keys = Object.keys(o);
        for (let i = 0; i < keys.length; i++) {
            let key = keys[i];
            if (key.indexOf('____') > -1) {
                try {
                    // const newkey = key.replace(new RegExp('____', 'g'), '.');
                    const newkey = this.replaceAll(key, "____", ".");
                    o[newkey] = o[key];
                    delete o[key];
                    key = newkey;
                } catch (error) {
                }
            }
            if (key.startsWith('$$')) {
                delete o[key];
            } else if (o[key]) {
                if (typeof o[key] == 'string') {
                    if (o[key].length == 24 && o[key].endsWith('Z')) {
                        o[key] = new Date(o[key]);
                    }
                }
                if (typeof (o[key]) == "object") {
                    this.traversejsondecode(o[key]);
                }
            }

        }

    }

    async SaveUpdateDiff<T extends Base>(q: UpdateOneMessage, user: TokenUser) {
        try {
            const _skip_array: string[] = Config.skip_history_collections.split(",");
            const skip_array: string[] = [];
            _skip_array.forEach(x => skip_array.push(x.trim()));
            if (skip_array.indexOf(q.collectionname) > -1) { return 0; }
            const res = await this.query<T>(q.query, null, 1, 0, null, q.collectionname, q.jwt);
            let name: string = "unknown";
            let _id: string = "";
            let _version = 1;
            if (res.length > 0) {
                const original = res[0];
                name = original.name;
                _id = original._id;
                delete original._modifiedby;
                delete original._modifiedbyid;
                delete original._modified;
                if (original._version != undefined && original._version != null) {
                    _version = original._version + 1;
                }
            }
            const updatehist = {
                _modified: new Date(new Date().toISOString()),
                _modifiedby: user.name,
                _modifiedbyid: user._id,
                _created: new Date(new Date().toISOString()),
                _createdby: user.name,
                _createdbyid: user._id,
                name: name,
                id: _id,
                update: JSON.stringify(q.item),
                _version: _version,
                reason: ""
            }
            await this.db.collection(q.collectionname + '_hist').insertOne(updatehist);
        } catch (error) {
            this._logger.error(error);
        }
    }
    visit(obj: any, func: any) {
        for (const k in obj) {
            func(obj, k);
            if (typeof obj[k] === "object") {
                this.visit(obj[k], func);
            }
        }
    }
    async SaveDiff(collectionname: string, original: any, item: any) {
        const roundDown = function (num, precision): number {
            num = parseFloat(num);
            if (!precision) return num;
            return (Math.floor(num / precision) * precision);
        };
        if (item._type == 'instance' && collectionname == 'workflows') return 0;
        if (item._type == 'instance' && collectionname == 'workflows') return 0;
        delete item._skiphistory;
        const _modified = item._modified;
        const _modifiedby = item._modifiedby;
        const _modifiedbyid = item._modifiedbyid;
        let _version = 0;
        const _acl = item._acl;
        const _type = item._type;
        const reason = item._updatereason;
        const lastseen = item.lastseen;
        try {
            const _skip_array: string[] = Config.skip_history_collections.split(",");
            const skip_array: string[] = [];
            _skip_array.forEach(x => skip_array.push(x.trim()));
            if (skip_array.indexOf(collectionname) > -1) { return 0; }

            if (original != null) {
                delete original._modifiedby;
                delete original._modifiedbyid;
                delete original._modified;
                delete original.lastseen;
                if (original._version != undefined && original._version != null) {
                    _version = original._version + 1;
                }
            }
            let delta: any = null;
            // for backward comp, we cannot assume all objects have an history
            // we create diff from version 0
            // const delta_collections = Config.history_delta_collections.split(',');
            // const full_collections = Config.history_full_collections.split(',');
            // if (delta_collections.indexOf(collectionname) == -1 && full_collections.indexOf(collectionname) == -1) return 0;

            item._version = _version;
            delete item._modifiedby;
            delete item._modifiedbyid;
            delete item._modified;
            delete item._updatereason;
            delete item.lastseen;

            // if (original != null && _version > 0 && delta_collections.indexOf(collectionname) > -1) {
            if (original != null && _version > 0) {
                this.visit(item, (obj, k) => {
                    if (typeof obj[k] === "function") {
                        delete obj[k];
                    }
                });
                delta = jsondiffpatch.diff(original, item);
                if (delta == undefined || delta == null) return 0;
                const keys = Object.keys(delta);
                if (keys.length > 1) {
                    const deltahist = {
                        _acl: _acl,
                        _type: _type,
                        _modified: _modified,
                        _modifiedby: _modifiedby,
                        _modifiedbyid: _modifiedbyid,
                        _created: _modified,
                        _createdby: _modifiedby,
                        _createdbyid: _modifiedbyid,
                        name: item.name,
                        id: item._id,
                        item: undefined,
                        delta: delta,
                        _version: _version,
                        reason: reason
                    }
                    const baseversion = roundDown(_version, Config.history_delta_count);
                    if (baseversion == _version) {
                        deltahist.item = original;
                    }
                    await this.db.collection(collectionname + '_hist').insertOne(deltahist);
                }
            } else {
                const fullhist = {
                    _acl: _acl,
                    _type: _type,
                    _modified: _modified,
                    _modifiedby: _modifiedby,
                    _modifiedbyid: _modifiedbyid,
                    _created: _modified,
                    _createdby: _modifiedby,
                    _createdbyid: _modifiedbyid,
                    name: item.name,
                    id: item._id,
                    item: item,
                    _version: _version,
                    reason: reason
                }
                await this.db.collection(collectionname + '_hist').insertOne(fullhist);
            }
            item._modifiedby = _modifiedby;
            item._modifiedbyid = _modifiedbyid;
            item._modified = _modified;
            if (lastseen !== null && lastseen !== undefined) {
                item.lastseen = lastseen;
            }
        } catch (error) {
            this._logger.error(error);
        }
        return _version;
    }


}