import {
    ObjectID, Db, Binary, InsertOneWriteOpResult, DeleteWriteOpResultObject, ObjectId, MapReduceOptions, CollectionInsertOneOptions, UpdateWriteOpResult, WriteOpResult, GridFSBucket, ReadPreference
} from "mongodb";
import { MongoClient } from "mongodb";
import { Base, Rights, WellknownIds } from "./base";
import winston = require("winston");
import { Crypt } from "./Crypt";
import { Config } from "./Config";
import { TokenUser } from "./TokenUser";
import { Ace } from "./Ace";
import { Role, Rolemember } from "./Role";
import { UpdateOneMessage } from "./Messages/UpdateOneMessage";
import { UpdateManyMessage } from "./Messages/UpdateManyMessage";
import { InsertOrUpdateOneMessage } from "./Messages/InsertOrUpdateOneMessage";
import { User } from "./User";
import { Util } from "./Util";
// tslint:disable-next-line: typedef
const safeObjectID = (s: string | number | ObjectID) => ObjectID.isValid(s) ? new ObjectID(s) : null;
export declare function emit(k, v);
export type mapFunc = () => void;
export type reduceFunc = (key: string, values: any[]) => any;
export type finalizeFunc = (key: string, value: any) => any;
const isoDatePattern = new RegExp(/\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z)/);
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
    /**
     * Connect to MongoDB
     * @returns Promise<void>
     */
    async connect(): Promise<void> {
        if (this.cli !== null && this.cli !== undefined && this.cli.isConnected) {
            return;
        }
        this.cli = await MongoClient.connect(this.mongodburl, { autoReconnect: false, useNewUrlParser: true });
        this.cli.on("error", (error) => {
            this._logger.error(error);
        });
        this.db = this.cli.db(this._dbname);
    }
    async ListCollections(jwt: string): Promise<any[]> {
        var result = await DatabaseConnection.toArray(this.db.listCollections());
        Crypt.verityToken(jwt);
        return result;
    }
    async DropCollection(collectionname: string, jwt: string): Promise<void> {
        var user: TokenUser = Crypt.verityToken(jwt);
        if (!user.hasrolename("admins")) throw new Error("Access denied");
        if (["workflow", "entities", "config", "audit", "jslog", "openrpa", "nodered", "openrpa_instances", "forms", "workflow_instances", "users"].indexOf(collectionname) > -1) throw new Error("Access denied");
        await this.db.dropCollection(collectionname);
    }

    async CleanACL<T extends Base>(item: T): Promise<T> {
        for (var i = item._acl.length - 1; i >= 0; i--) {
            {
                var ace = item._acl[i];
                var arr = await this.db.collection("users").find({ _id: ace._id }).project({ name: 1 }).limit(1).toArray();
                if (arr.length == 0) {
                    item._acl.splice(i, 1);
                } else { ace.name = arr[0].name; }
            }
        }
        return item;
    }
    async Cleanmembers<T extends Role>(item: T, original: T): Promise<T> {
        var removed: Rolemember[] = [];
        if (original != null && Config.update_acl_based_on_groups == true) {
            for (var i = original.members.length - 1; i >= 0; i--) {
                var ace = original.members[i];
                var exists = item.members.filter(x => x._id == ace._id);
                if (exists.length == 0) {
                    removed.push(ace);
                }
            }
        }
        var doadd: boolean = true;
        var multi_tenant_skip: string[] = [WellknownIds.users, WellknownIds.filestore_users,
        WellknownIds.nodered_api_users, WellknownIds.nodered_users, WellknownIds.personal_nodered_users,
        WellknownIds.robot_users, , WellknownIds.robots];
        if (item._id == WellknownIds.users && Config.multi_tenant) {
            doadd = false;
        }
        if (doadd) {
            for (var i = item.members.length - 1; i >= 0; i--) {
                {
                    var ace = item.members[i];
                    if (Config.update_acl_based_on_groups == true) {
                        if (multi_tenant_skip.indexOf(item._id) > -1) {
                            if (ace._id != WellknownIds.admins && ace._id != WellknownIds.root) {
                                // item.removeRight(ace._id, [Rights.read]);
                            }
                        } else {
                            // item.addRight(ace._id, ace.name, [Rights.read]);
                        }
                    }
                    var exists = item.members.filter(x => x._id == ace._id);
                    if (exists.length > 1) {
                        item.members.splice(i, 1);
                    } else {
                        var arr = await this.db.collection("users").find({ _id: ace._id }).project({ name: 1, _acl: 1, _type: 1 }).limit(1).toArray();
                        if (arr.length == 0) {
                            item.members.splice(i, 1);
                        }
                        else if (Config.update_acl_based_on_groups == true) {
                            ace.name = arr[0].name;
                            if (Config.multi_tenant && multi_tenant_skip.indexOf(item._id) > -1) {
                                // when multi tenant don't allow members of common user groups to see each other
                                this._logger.info("Running in multi tenant mode, skip adding permissions for " + item.name);
                            } else if (arr[0]._type == "user") {
                                var u: User = User.assign(arr[0]);
                                if (!u.hasRight(item._id, Rights.read)) {
                                    this._logger.debug("Assigning " + item.name + " read permission to " + u.name);
                                    u.addRight(item._id, item.name, [Rights.read], false);

                                    await this.db.collection("users").updateOne({ _id: u._id }, { $set: { _acl: u._acl } });
                                    // await this.db.collection("users").save(u);
                                } else if (u._id != item._id) {
                                    this._logger.debug(item.name + " allready exists on " + u.name);
                                }
                            } else if (arr[0]._type == "role") {
                                var r: Role = Role.assign(arr[0]);
                                if (r._id == WellknownIds.admins || r._id == WellknownIds.users) {
                                }
                                if (!r.hasRight(item._id, Rights.read)) {
                                    this._logger.debug("Assigning " + item.name + " read permission to " + r.name);
                                    r.addRight(item._id, item.name, [Rights.read], false);
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
            for (var i = removed.length - 1; i >= 0; i--) {
                var ace = removed[i];

                if (ace._id != WellknownIds.admins && ace._id != WellknownIds.root) {
                    // if (item.hasRight(ace._id, Rights.read)) {
                    //     item.removeRight(ace._id, [Rights.read]);
                    //     var right = item.getRight(ace._id, false);
                    //     // read was not the only right ? then re add
                    //     if (right != null) {
                    //         item.addRight(ace._id, ace.name, [Rights.read]);
                    //     }
                    // }

                }

                var arr = await this.db.collection("users").find({ _id: ace._id }).project({ name: 1, _acl: 1, _type: 1 }).limit(1).toArray();
                if (arr.length == 1 && item._id != WellknownIds.admins && item._id != WellknownIds.root) {
                    if (Config.multi_tenant && multi_tenant_skip.indexOf(item._id) > -1) {
                        // when multi tenant don't allow members of common user groups to see each other
                        this._logger.info("Running in multi tenant mode, skip removing permissions for " + item.name);
                    } else if (arr[0]._type == "user") {
                        var u: User = User.assign(arr[0]);
                        if (u.hasRight(item._id, Rights.read)) {
                            u.removeRight(item._id, [Rights.read]);

                            // was read the only right ? then remove it
                            var right = u.getRight(item._id, false);
                            if (right == null) {
                                this._logger.debug("Removing " + item.name + " read permissions from " + u.name);
                                // await this.db.collection("users").save(u);
                                await this.db.collection("users").updateOne({ _id: u._id }, { $set: { _acl: u._acl } });

                            }

                        } else {
                            this._logger.debug("No need to remove " + item.name + " read permissions from " + u.name);
                        }
                    } else if (arr[0]._type == "role") {
                        var r: Role = Role.assign(arr[0]);
                        if (r.hasRight(item._id, Rights.read)) {
                            r.removeRight(item._id, [Rights.read]);

                            // was read the only right ? then remove it
                            var right = r.getRight(item._id, false);
                            if (right == null) {
                                this._logger.debug("Removing " + item.name + " read permissions from " + r.name);
                                // await this.db.collection("users").save(r);
                                await this.db.collection("users").updateOne({ _id: r._id }, { $set: { _acl: r._acl } });
                            }

                        } else {
                            this._logger.debug("No need to remove " + item.name + " read permissions from " + u.name);
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
    async query<T extends Base>(query: any, projection: Object, top: number, skip: number, orderby: Object | string, collectionname: string, jwt: string, queryas: string = null): Promise<T[]> {
        var arr: T[] = [];
        await this.connect();
        var mysort: Object = {};
        if (orderby) {
            if (typeof orderby === "string" || orderby instanceof String) {
                mysort[(orderby as string)] = 1;
            } else {
                mysort = orderby;
            }
        }
        // for (let key in query) {
        if (query !== null && query !== undefined) {
            var json: any = query;
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
                    var m = value.split("__REGEXP ")[1].match(/\/(.*)\/(.*)?/);
                    return new RegExp(m[1], m[2] || "");
                } else
                    return value; // leave any other value as-is
            });
        }
        var keys: string[] = Object.keys(query);
        for (let i: number = 0; i < keys.length; i++) {
            let key: string = keys[i];
            if (key === "_id") {
                var id: string = query._id;
                var safeid = safeObjectID(id);
                if (safeid !== null && safeid !== undefined) {
                    delete query._id;
                    query.$or = [{ _id: id }, { _id: safeObjectID(id) }];
                }
            }
        }
        var user: TokenUser = Crypt.verityToken(jwt);
        var _query: Object = {};
        if (collectionname === "files") { collectionname = "fs.files"; }
        if (collectionname === "fs.files") {
            if (!Util.IsNullEmpty(queryas)) {
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
            if (!Util.IsNullEmpty(queryas)) {
                _query = { $and: [query, this.getbasequery(jwt, "_acl", [Rights.read]), await this.getbasequeryuserid(queryas, "_acl", [Rights.read])] };
            } else {
                _query = { $and: [query, this.getbasequery(jwt, "_acl", [Rights.read])] };
            }
        }
        if (!top) { top = 500; }
        if (!skip) { skip = 0; }
        // if (collectionname == "openrpa") {
        //     var user: TokenUser = Crypt.verityToken(jwt);
        //     arr = await this.db.collection(collectionname).find(query).limit(top).skip(skip).toArray();
        //     _query = { $and: [query, this.getbasequery(jwt, "_acl", [Rights.read])] };
        // }
        if (projection != null) {
            arr = await this.db.collection(collectionname).find(_query).project(projection).sort(mysort).limit(top).skip(skip).toArray();
        } else {
            arr = await this.db.collection(collectionname).find(_query).sort(mysort).limit(top).skip(skip).toArray();
        }
        for (var i: number = 0; i < arr.length; i++) { arr[i] = this.decryptentity(arr[i]); }
        DatabaseConnection.traversejsondecode(arr);
        this._logger.debug("[" + user.username + "][" + collectionname + "] query gave " + arr.length + " results " + JSON.stringify(query));
        return arr;
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
        var arr: T[] = await this.query<T>({ _id: id }, null, 1, 0, null, collectionname, jwt);
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
    async aggregate<T extends Base>(aggregates: object[], collectionname: string, jwt: string): Promise<T[]> {
        await this.connect();

        if (typeof aggregates === "string" || aggregates instanceof String) {
            aggregates = JSON.parse((aggregates as any));
        }
        var base = this.getbasequery(jwt, "_acl", [Rights.read]);
        if (Array.isArray(aggregates)) {
            aggregates.unshift({ $match: base });
        } else {
            aggregates = [{ $match: base }, aggregates];
        }
        // todo: add permissions check on aggregates
        // aggregates.unshift(this.getbasequery(jwt, [Rights.read]));
        var items: T[] = await this.db.collection(collectionname).aggregate(aggregates).toArray();
        DatabaseConnection.traversejsondecode(items);
        return items;
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
            var json: any = query;
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
                    var m = value.split("__REGEXP ")[1].match(/\/(.*)\/(.*)?/);
                    return new RegExp(m[1], m[2] || "");
                } else
                    return value; // leave any other value as-is
            });
        }
        var q: any = query;
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
        var inline: boolean = false;
        var opt: MapReduceOptions = { query: q, out: { replace: "map_temp_res" }, finalize: finalize };

        // (opt as any).w = 0;

        var outcol: string = "map_temp_res";
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

        // var result:T[] = await this.db.collection(collectionname).mapReduce(map, reduce, {query: q, out : {inline : 1}});
        try {
            if (inline) {
                opt.out = { inline: 1 };
                var result: T[] = await this.db.collection(collectionname).mapReduce(map, reduce, opt);
                return result;
            } else {
                await this.db.collection(collectionname).mapReduce(map, reduce, opt);
                return [];
            }
        } catch (error) {
            throw error;
        }
        // var result:T[] = await this.db.collection(outcol).find({}).toArray(); // .limit(top)
        // // this.db.collection("map_temp_res").deleteMany({});
        // return result;
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
        if (Util.IsNullEmpty(jwt)) {
            throw new Error("jwt is null");
        }
        var user: TokenUser = Crypt.verityToken(jwt);
        item._createdby = user.name;
        item._createdbyid = user._id;
        item._created = new Date(new Date().toISOString());
        item._modifiedby = user.name;
        item._modifiedbyid = user._id;
        item._modified = item._created;
        var hasUser: Ace = item._acl.find(e => e._id === user._id);
        if ((hasUser === null || hasUser === undefined)) {
            item.addRight(user._id, user.name, [Rights.full_control]);
        }
        if (collectionname != "audit") { this._logger.debug("[" + user.username + "][" + collectionname + "] Adding " + item._type + " " + (item.name || item._name) + " to database"); }
        if (!this.hasAuthorization(user, item, Rights.create)) { throw new Error("Access denied"); }

        item = this.encryptentity<T>(item);
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


        item = await this.CleanACL(item);
        if (item._type === "role" && collectionname === "users") {
            item = await this.Cleanmembers(item as any, null);
        }

        if (collectionname === "users" && item._type === "user") {
            var u: TokenUser = (item as any);
            if (u.username == null || u.username == "") { throw new Error("Username is mandatory"); }
            if (u.name == null || u.name == "") { throw new Error("Name is mandatory"); }
            var exists = await User.FindByUsername(u.username, TokenUser.rootToken());
            if (exists != null) { throw new Error("Access denied"); }
        }
        if (collectionname === "users" && item._type === "role") {
            var r: Role = (item as any);
            if (r.name == null || r.name == "") { throw new Error("Name is mandatory"); }
            var exists2 = await Role.FindByName(r.name);
            if (exists2 != null) { throw new Error("Access denied, adding new user"); }
        }

        // var options:CollectionInsertOneOptions = { writeConcern: { w: parseInt((w as any)), j: j } };
        var options: CollectionInsertOneOptions = { w: w, j: j };
        //var options: CollectionInsertOneOptions = { w: "majority" };
        var result: InsertOneWriteOpResult<T> = await this.db.collection(collectionname).insertOne(item, options);
        item = result.ops[0];
        if (collectionname === "users" && item._type === "user") {
            var users: Role = await Role.FindByNameOrId("users", jwt);
            users.AddMember(item);
            await users.Save(TokenUser.rootToken());
        }
        if (collectionname === "users" && item._type === "role") {
            item.addRight(item._id, item.name, [Rights.read]);
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
        var q = new UpdateOneMessage<T>();
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
    async UpdateOne<T extends Base>(q: UpdateOneMessage<T>): Promise<UpdateOneMessage<T>> {
        var itemReplace: boolean = true;
        if (q === null || q === undefined) { throw Error("UpdateOneMessage cannot be null"); }
        if (q.item === null || q.item === undefined) { throw Error("Cannot update null item"); }
        await this.connect();
        var user: TokenUser = Crypt.verityToken(q.jwt);
        if (!this.hasAuthorization(user, q.item, Rights.update)) { throw new Error("Access denied"); }
        if (q.collectionname === "files") { q.collectionname = "fs.files"; }

        var original: T = null;
        // assume empty query, means full document, else update document
        if (q.query === null || q.query === undefined) {
            // this will add an _acl so needs to be after we checked old item
            if (!q.item.hasOwnProperty("_id")) {
                throw Error("Cannot update item without _id");
            }
            original = await this.getbyid<T>(q.item._id, q.collectionname, q.jwt);
            if (!original) { throw Error("item not found!"); }
            if (!this.hasAuthorization(user, original, Rights.update)) { throw new Error("Access denied"); }
            if (q.collectionname != "fs.files") {
                q.item._modifiedby = user.name;
                q.item._modifiedbyid = user._id;
                q.item._modified = new Date(new Date().toISOString());
                // now add all _ fields to the new object
                var keys: string[] = Object.keys(original);
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
                q.item = this.encryptentity<T>(q.item);
                var hasUser: Ace = q.item._acl.find(e => e._id === user._id);
                if ((hasUser === null || hasUser === undefined) && q.item._acl.length == 0) {
                    q.item.addRight(user._id, user.name, [Rights.full_control]);
                }
            } else {
                (q.item as any).metadata = Base.assign((q.item as any).metadata);
                (q.item as any).metadata._modifiedby = user.name;
                (q.item as any).metadata._modifiedbyid = user._id;
                (q.item as any).metadata._modified = new Date(new Date().toISOString());
                // now add all _ fields to the new object
                var keys: string[] = Object.keys((original as any).metadata);
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
                (q.item as any).metadata = this.encryptentity<T>((q.item as any).metadata);
                var hasUser: Ace = (q.item as any).metadata._acl.find(e => e._id === user._id);
                if ((hasUser === null || hasUser === undefined) && (q.item as any).metadata._acl.length == 0) {
                    (q.item as any).metadata.addRight(user._id, user.name, [Rights.full_control]);
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
            itemReplace = false;
            if (q.item["$set"] !== null && q.item["$set"] !== undefined) {
                if (q.item["$set"].hasOwnProperty("_skiphistory")) {
                    delete q.item["$set"]._skiphistory;
                    if (!Config.allow_skiphistory) this.SaveUpdateDiff(q, user);
                }
            } else {
                this.SaveUpdateDiff(q, user);
            }
            // var _version = await this.SaveUpdateDiff(q, user);
            // if ((q.item["$set"]) === undefined) { (q.item["$set"]) = {} };
            // (q.item["$set"])._version = _version;
        }

        if (q.collectionname === "users" && q.item._type === "user" && q.item.hasOwnProperty("newpassword")) {
            (q.item as any).passwordhash = await Crypt.hash((q.item as any).newpassword);
            delete (q.item as any).newpassword;
        }
        this._logger.debug("[" + user.username + "][" + q.collectionname + "] Updating " + (q.item.name || q.item._name) + " in database");
        // await this.db.collection(collectionname).replaceOne({ _id: item._id }, item, options);

        if (q.query === null || q.query === undefined) {
            var id: string = q.item._id;
            var safeid = safeObjectID(id);
            q.query = { $or: [{ _id: id }, { _id: safeObjectID(id) }] };
        }
        var _query: Object = {};
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

        var options: CollectionInsertOneOptions = { w: q.w, j: q.j };
        q.opresult = null;
        try {
            if (itemReplace) {
                if (q.collectionname != "fs.files") {
                    q.item = await this.CleanACL(q.item);
                } else {
                    (q.item as any).metadata = await this.CleanACL((q.item as any).metadata);
                }
                if (q.item._type === "role" && q.collectionname === "users") {
                    q.item = await this.Cleanmembers(q.item as any, original);
                }

                if (q.collectionname != "fs.files") {
                    q.opresult = await this.db.collection(q.collectionname).replaceOne(_query, q.item, options);
                } else {
                    var fsc = Config.db.db.collection("fs.files");
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
                q.item = this.decryptentity<T>(q.item);
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
    async UpdateMany<T extends Base>(q: UpdateManyMessage<T>): Promise<UpdateManyMessage<T>> {
        if (q === null || q === undefined) { throw Error("UpdateManyMessage cannot be null"); }
        if (q.item === null || q.item === undefined) { throw Error("Cannot update null item"); }
        await this.connect();
        var user: TokenUser = Crypt.verityToken(q.jwt);
        if (!this.hasAuthorization(user, q.item, Rights.update)) { throw new Error("Access denied"); }

        if (q.collectionname === "users" && q.item._type === "user" && q.item.hasOwnProperty("newpassword")) {
            (q.item as any).passwordhash = await Crypt.hash((q.item as any).newpassword);
            delete (q.item as any).newpassword;
        }
        for (let key in q.query) {
            if (key === "_id") {
                var id: string = q.query._id;
                delete q.query._id;
                q.query.$or = [{ _id: id }, { _id: safeObjectID(id) }];
            }
        }
        var _query: Object = {};
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


        this._logger.debug("[" + user.username + "][" + q.collectionname + "] UpdateMany " + (q.item.name || q.item._name) + " in database");

        q.j = ((q.j as any) === 'true' || q.j === true);
        if ((q.w as any) !== "majority") q.w = parseInt((q.w as any));
        var options: CollectionInsertOneOptions = { w: q.w, j: q.j };
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
    async InsertOrUpdateOne<T extends Base>(q: InsertOrUpdateOneMessage<T>): Promise<InsertOrUpdateOneMessage<T>> {
        var query: any = null;
        if (q.uniqeness !== null && q.uniqeness !== undefined && q.uniqeness !== "") {
            query = {};
            var arr = q.uniqeness.split(",");
            arr.forEach(field => {
                if (field.trim() !== "") {
                    query[field] = q.item[field];
                }
            });
        } else {
            query = { _id: q.item._id };
        }
        var user: TokenUser = Crypt.verityToken(q.jwt);
        var exists = await this.query(query, { name: 1 }, 2, 0, null, q.collectionname, q.jwt);
        if (exists.length == 1) {
            q.item._id = exists[0]._id;
        }
        else if (exists.length > 1) {
            throw JSON.stringify(query) + " is not uniqe, more than 1 item in collection matches this";
        }
        if (!this.hasAuthorization(user, q.item, Rights.update)) { throw new Error("Access denied"); }
        // if (q.item._id !== null && q.item._id !== undefined && q.item._id !== "") {
        if (exists.length == 1) {
            this._logger.debug("[" + user.username + "][" + q.collectionname + "] InsertOrUpdateOne, Updating found one in database");
            var uq = new UpdateOneMessage<T>();
            // uq.query = query; 
            uq.item = q.item; uq.collectionname = q.collectionname; uq.w = q.w; uq.j; uq.jwt = q.jwt;
            uq = await this.UpdateOne(uq);
            q.opresult = uq.opresult;
            q.result = uq.result;
        } else {
            this._logger.debug("[" + user.username + "][" + q.collectionname + "] InsertOrUpdateOne, Inserting as new in database");
            q.result = await this.InsertOne(q.item, q.collectionname, q.w, q.j, q.jwt);
        }
        return q;
    }
    private async _DeleteFile(id: string): Promise<string> {
        return new Promise<string>(async (resolve, reject) => {
            try {
                var _id = new ObjectID(id);
                var bucket = new GridFSBucket(this.db);
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
        var user: TokenUser = Crypt.verityToken(jwt);
        // var original:Base = await this.getbyid(id, collectionname, jwt);
        // if(!original) { throw Error("item not found!"); }
        // if(!this.hasAuthorization(user, original, "delete")) { throw new Error("Access denied"); }
        var _query: any = {};
        if (typeof id === 'string' || id instanceof String) {
            _query = { $and: [{ _id: id }, this.getbasequery(jwt, "_acl", [Rights.delete])] };
            //_query = { $and: [{ _id: { $ne: user._id } }, _query] };
        } else {
            _query = { $and: [{ id }, this.getbasequery(jwt, "_acl", [Rights.delete])] };
            //_query = { $and: [{ _id: { $ne: user._id } }, _query] };
        }

        if (collectionname === "files") { collectionname = "fs.files"; }
        if (collectionname === "fs.files") {
            _query = { $and: [{ _id: safeObjectID(id) }, this.getbasequery(jwt, "metadata._acl", [Rights.delete])] };
            var arr = await this.db.collection(collectionname).find(_query).toArray();
            if (arr.length == 1) {
                await this._DeleteFile(id);
                return;
            } else {
                throw Error("item not found!");
            }
        }


        // var arr = await this.db.collection(collectionname).find(_query).toArray();

        this._logger.debug("[" + user.username + "][" + collectionname + "] Deleting " + id + " in database");
        var res: DeleteWriteOpResultObject = await this.db.collection(collectionname).deleteOne(_query);

        // var res:DeleteWriteOpResultObject = await this.db.collection(collectionname).deleteOne({_id:id});
        // var res:DeleteWriteOpResultObject = await this.db.collection(collectionname).deleteOne(id);
        if (res.deletedCount === 0) { throw Error("item not found!"); }
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
        const isString: boolean = typeof value === "string";
        return value && shouldEncryptThisKey && isString;
    }
    /**
     * Enumerate object, encrypting fields that needs to be encrypted
     * @param  {T} item Item to enumerate
     * @returns T Object with encrypted fields
     */
    public encryptentity<T extends Base>(item: T): T {
        if (item == null || item._encrypt === undefined || item._encrypt === null) { return item; }
        var me: DatabaseConnection = this;
        return (Object.keys(item).reduce((newObj, key) => {
            const value: any = item[key];
            try {
                newObj[key] = this._shouldEncryptValue(item._encrypt, key, value) ? Crypt.encrypt(value) : value;
            } catch (err) {
                me._logger.error("encryptentity " + err.message);
                newObj[key] = value;
            }
            return newObj;
        }, item) as T);
    }
    /**
     * Enumerate object, decrypting fields that needs to be decrypted
     * @param  {T} item Item to enumerate
     * @returns T Object with decrypted fields
     */
    public decryptentity<T extends Base>(item: T): T {
        if (item == null || item._encrypt === undefined || item._encrypt === null) { return item; }
        var me: DatabaseConnection = this;
        return (Object.keys(item).reduce((newObj, key) => {
            const value: any = item[key];
            try {
                newObj[key] = this._shouldEncryptValue(item._encrypt, key, value) ? Crypt.decrypt(value) : value;
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
    private getbasequery(jwt: string, field: string, bits: number[]): Object {
        if (Config.api_bypass_perm_check) {
            return { _id: { $ne: "bum" } };
        }
        var user: TokenUser = Crypt.verityToken(jwt);
        if (user._id === WellknownIds.root) {
            return { _id: { $ne: "bum" } };
        }
        var isme: any[] = [];
        isme.push({ _id: user._id });
        for (var i: number = 0; i < bits.length; i++) {
            bits[i]--; // bitwize matching is from offset 0, when used on bindata
        }
        user.roles.forEach(role => {
            isme.push({ _id: role._id });
        });
        var finalor: any[] = [];
        var q = {};
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
            var q2 = {};
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
        var user = await User.FindByUsernameOrId(null, userid);
        var jwt = Crypt.createToken(user, "5m");
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
                item._acl[index].rights = new Binary(Buffer.from(a.rights, "base64"), 0);
            }
        });
        if (item._acl.length === 0) {
            item = Base.assign<T>(item);
            item.addRight(WellknownIds.admins, "admins", [Rights.full_control]);
        } else {
            item = Base.assign<T>(item);
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
            var a = item._acl.filter(x => x._id == user._id);
            if (a.length > 0) {
                let _ace = Ace.assign(a[0]);
                if (_ace.getBit(action)) return true;
            }
            for (var i = 0; i < user.roles.length; i++) {
                a = item._acl.filter(x => x._id == user.roles[i]._id);
                if (a.length > 0) {
                    let _ace = Ace.assign(a[0]);
                    if (_ace.getBit(action)) return true;
                }
            }
            return false;
        }
        return true;
    }
    public static replaceAll(target, search, replacement) {
        //var target = this;
        // return target.replace(new RegExp(search, 'g'), replacement);
        return target.split(search).join(replacement);
    };
    /**
     * Helper function to clean item before saving in MongoDB ( normalize ACE rights and remove illegal key $$ )
     * @param  {object} o Item to clean
     * @returns void Clean object
     */
    public static traversejsonencode(o) {
        var reISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}(?:\.\d*))(?:Z|(\+|-)([\d|:]*))?$/;
        var reMsAjax = /^\/Date\((d|-|.*)\)[\/|\\]$/;

        var keys = Object.keys(o);
        for (let i = 0; i < keys.length; i++) {
            let key = keys[i];
            let value = o[key];
            if (typeof value === 'string') {
                var a = reISO.exec(value);
                if (a) {
                    o[key] = new Date(value);
                } else {
                    a = reMsAjax.exec(value);
                    if (a) {
                        var b = a[1].split(/[-+,.]/);
                        o[key] = new Date(b[0] ? +b[0] : 0 - +b[1]);
                    }
                }
            }
            if (key.indexOf('.') > -1) {
                try {
                    // var newkey = key.replace(new RegExp('.', 'g'), '____');
                    var newkey = this.replaceAll(key, ".", "____");
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
        var keys = Object.keys(o);
        for (let i = 0; i < keys.length; i++) {
            let key = keys[i];
            if (key.indexOf('____') > -1) {
                try {
                    // var newkey = key.replace(new RegExp('____', 'g'), '.');
                    var newkey = this.replaceAll(key, "____", ".");
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

    async SaveUpdateDiff<T extends Base>(q: UpdateOneMessage<T>, user: TokenUser) {
        try {
            var _skip_array: string[] = Config.skip_history_collections.split(",");
            var skip_array: string[] = [];
            _skip_array.forEach(x => skip_array.push(x.trim()));
            if (skip_array.indexOf(q.collectionname) > -1) { return 0; }
            var res = await this.query<T>(q.query, null, 1, 0, null, q.collectionname, q.jwt);
            var name: string = "unknown";
            var _id: string = "";
            if (res.length > 0) {
                var _version = 1;
                var original = res[0];
                name = original.name;
                _id = original._id;
                delete original._modifiedby;
                delete original._modifiedbyid;
                delete original._modified;
                if (original._version != undefined && original._version != null) {
                    _version = original._version + 1;
                }
            }
            var updatehist = {
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
    async SaveDiff(collectionname: string, original: any, item: any) {
        if (item._type == 'instance' && collectionname == 'workflows') return 0;
        if (item._type == 'instance' && collectionname == 'workflows') return 0;
        delete item._skiphistory;
        var _modified = item._modified;
        var _modifiedby = item._modifiedby;
        var _modifiedbyid = item._modifiedbyid;
        var _version = 0;
        var _acl = item._acl;
        var _type = item._type;
        var reason = item._updatereason;
        var lastseen = item.lastseen;
        try {
            var _skip_array: string[] = Config.skip_history_collections.split(",");
            var skip_array: string[] = [];
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
            var jsondiffpatch = require('jsondiffpatch').create({
                objectHash: function (obj, index) {
                    // try to find an id property, otherwise just use the index in the array
                    return obj.name || obj.id || obj._id || '$$index:' + index;
                }
            });
            var delta: any = null;
            // for backward comp, we cannot assume all objects have an history
            // we create diff from version 0
            // var delta_collections = Config.history_delta_collections.split(',');
            // var full_collections = Config.history_full_collections.split(',');
            // if (delta_collections.indexOf(collectionname) == -1 && full_collections.indexOf(collectionname) == -1) return 0;

            item._version = _version;
            delete item._modifiedby;
            delete item._modifiedbyid;
            delete item._modified;
            delete item._updatereason;
            delete item.lastseen;

            // if (original != null && _version > 0 && delta_collections.indexOf(collectionname) > -1) {
            if (original != null && _version > 0) {
                delta = jsondiffpatch.diff(original, item);
                if (delta == undefined || delta == null) return 0;
                var keys = Object.keys(delta);
                if (keys.length > 1) {
                    var deltahist = {
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
                        item: original,
                        delta: delta,
                        _version: _version,
                        reason: reason
                    }
                    await this.db.collection(collectionname + '_hist').insertOne(deltahist);
                }
            } else {
                var fullhist = {
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