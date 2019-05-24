import { ObjectID, Db, Binary, InsertOneWriteOpResult, DeleteWriteOpResultObject, ObjectId, MapReduceOptions } from "mongodb";
import { MongoClient } from "mongodb";
import { Base, Rights, WellknownIds } from "./base";
import winston = require("winston");
import { Crypt } from "./Crypt";
import { Config } from "./Config";
import { TokenUser } from "./TokenUser";
import { Ace } from "./Ace";
import { Role } from "./Role";
// tslint:disable-next-line: typedef
const safeObjectID = (s: string | number | ObjectID) => ObjectID.isValid(s) ? new ObjectID(s) : null;
export declare function emit(k, v);
export type mapFunc = () => void;
export type reduceFunc = (key: string, values: any[]) => any;
export type finalizeFunc = (key: string, value: any) => any;
export class DatabaseConnection {
    private mongodburl: string;
    private cli: MongoClient;
    private db: Db;
    private _logger: winston.Logger;
    private _dbname: string;
    constructor(logger: winston.Logger, mongodburl: string, dbname: string) {
        this._logger = logger;
        this._dbname = dbname;
        this.mongodburl = mongodburl;
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
        this.db = this.cli.db(this._dbname);
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
    async query<T extends Base>(query: any, projection: Object, top: number, skip: number, orderby: Object | string, collectionname: string, jwt: string): Promise<T[]> {
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
        for (let key in query) {
            if (key === "_id") {
                var id: string = query._id;
                delete query._id;
                query.$or = [{ _id: id }, { _id: safeObjectID(id) }];
            }
        }
        var _query: Object = {};
        if (collectionname === "files") { collectionname = "fs.files"; }
        if (collectionname === "fs.files") {
            _query = { $and: [query, this.getbasequery(jwt, "metadata._acl", [Rights.read])] };
        } else {
            if (!collectionname.endsWith("hist")) {
                _query = { $and: [query, this.getbasequery(jwt, "_acl", [Rights.read])] };
            } else {
                // todo: enforcer permissions when fetching hist ?
                _query = query;
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
        this.traversejsondecode(arr);
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
        // todo: add permissions check on aggregates
        // aggregates.unshift(this.getbasequery(jwt, [Rights.read]));
        var items: T[] = await this.db.collection(collectionname).aggregate(aggregates).toArray();
        this.traversejsondecode(items);
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
        var q: any = query;
        if (query !== null && query !== undefined) {
            q = { $and: [query, this.getbasequery(jwt, "_acl", [Rights.read])] };
        } else {
            q = this.getbasequery(jwt, "_acl", [Rights.read]);
        }

        var inline: boolean = false;
        var opt: MapReduceOptions = { query: q, out: { replace: "map_temp_res" }, finalize: finalize };
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

        // var result:T[] = await this.db.collection(collectionname).mapReduce(map, reduce, {query: q, out : {inline : 1}});
        if (inline) {
            var result: T[] = await this.db.collection(collectionname).mapReduce(map, reduce, opt);
            return result;
        } else {
            await this.db.collection(collectionname).mapReduce(map, reduce, opt);
            return [];
        }
        // var result:T[] = await this.db.collection(outcol).find({}).toArray(); // .limit(top)
        // // this.db.collection("map_temp_res").deleteMany({});
        // return result;
    }
    /**
     * Create a new document in the database
     * @param  {T} item Item to create
     * @param  {string} collectionname The collection to create item in
     * @param  {string} jwt JWT of the user, creating the item, to ensure rights and permission
     * @returns Promise<T> Returns the new item added
     */
    async InsertOne<T extends Base>(item: T, collectionname: string, jwt: string): Promise<T> {
        if (item === null || item === undefined) { throw Error("Cannot create null item"); }
        await this.connect();
        item = this.ensureResource(item);
        this.traversejsonencode(item);
        var user: TokenUser = Crypt.verityToken(jwt);
        if (!this.hasAuthorization(user, item, "create")) { throw new Error("Access denied"); }
        item._createdby = user.name;
        item._createdbyid = user._id;
        item._created = new Date(new Date().toISOString());
        item._modifiedby = user.name;
        item._modifiedbyid = user._id;
        item._modified = item._created;
        var hasUser: Ace = item._acl.find(e => e._id === user._id);
        if (hasUser === null || hasUser === undefined) {
            if (collectionname != "audit") { this._logger.debug("Adding self " + user.username + " to object " + (item.name || item._name)); }
            item.addRight(user._id, user.name, [Rights.full_control]);
        }
        if (collectionname != "audit") { this._logger.debug("adding " + (item.name || item._name) + " to database"); }

        item = this.encryptentity<T>(item);
        if (!item._id) { item._id = new ObjectID().toHexString(); }

        if (collectionname === "users" && item._type === "user" && item.hasOwnProperty("newpassword")) {
            (item as any).passwordhash = await Crypt.hash((item as any).newpassword);
            delete (item as any).newpassword;
        }

        var result: InsertOneWriteOpResult = await this.db.collection(collectionname).insertOne(item);
        item = result.ops[0];

        if (collectionname === "users" && item._type === "user") {
            var users: Role = await Role.FindByNameOrId("users", jwt);
            users.AddMember(item);
            await users.Save(jwt)
        }
        this.traversejsondecode(item);
        return item;
    }
    /**
     * Update entity in database
     * @param  {T} item Item to update
     * @param  {string} collectionname Collection containing item
     * @param  {string} jwt JWT of user who is doing the update, ensuring rights
     * @returns Promise<T>
     */
    async UpdateOne<T extends Base>(item: T, collectionname: string, jwt: string): Promise<T> {
        if (item === null || item === undefined) { throw Error("Cannot update null item"); }
        if (!item.hasOwnProperty("_id")) { throw Error("Cannot update item without _id"); }
        await this.connect();
        var user: TokenUser = Crypt.verityToken(jwt);
        if (!this.hasAuthorization(user, item, "update")) { throw new Error("Access denied"); }
        var original: T = await this.getbyid<T>(item._id, collectionname, jwt);
        if (!original) { throw Error("item not found!"); }
        item._modifiedby = user.name;
        item._modifiedbyid = user._id;
        item._modified = new Date(new Date().toISOString());
        // now add all _ fields to the new object
        var keys: string[] = Object.keys(original);
        for (let i: number = 0; i < keys.length; i++) {
            let key: string = keys[i];
            if (key === "_created") {
                item[key] = new Date(original[key]);
            } else if (key === "_createdby" || key === "_createdbyid") {
                item[key] = original[key];
            } else if (key === "_modifiedby" || key === "_modifiedbyid" || key === "_modified") {
                // allready updated
            } else if (key.indexOf("_") === 0) {
                if (!item.hasOwnProperty(key)) {
                    item[key] = original[key]; // add missing key
                } else if (item[key] === null) {
                    delete item[key]; // remove key
                } else {
                    // key allready exists, might been updated since last save
                }
            }
        }
        // this will add an _acl so needs to be after we checked old item
        item = this.ensureResource(item);
        this.traversejsonencode(item);
        item = this.encryptentity<T>(item);

        var hasUser: Ace = item._acl.find(e => e._id === user._id);
        if (hasUser === null || hasUser === undefined) {
            if (collectionname != "audit") { this._logger.debug("Adding self " + user.username + " to object " + (item.name || item._name)); }
            item.addRight(user._id, user.name, [Rights.full_control]);
        }

        if (collectionname === "users" && item._type === "user" && item.hasOwnProperty("newpassword")) {
            (item as any).passwordhash = await Crypt.hash((item as any).newpassword);
            delete (item as any).newpassword;
        }
        this._logger.debug("updating " + (item.name || item._name) + " in database");
        await this.db.collection(collectionname).replaceOne({ _id: item._id }, item);
        this.traversejsondecode(item);
        return item;
    }
    async InsertOrUpdateOne<T extends Base>(item: T, collectionname: string, uniqeness: string, jwt: string): Promise<T> {
        var query: any = null;
        if (uniqeness !== null && uniqeness !== undefined && uniqeness !== "") {
            query = {};
            var arr = uniqeness.split(",");
            arr.forEach(field => {
                if (field.trim() !== "") {
                    query[field] = item[field];
                }
            });
        } else {
            query = { _id: item._id };
        }
        var exists = await this.query(query, { name: 1 }, 2, 0, null, collectionname, jwt);
        if (exists.length == 1) {
            item._id = exists[0]._id;
        }
        else if (exists.length > 1) {
            throw JSON.stringify(query) + " is not uniqe, more than 1 item in collection matches this";
        }
        var user: TokenUser = Crypt.verityToken(jwt);
        if (!this.hasAuthorization(user, item, "update")) { throw new Error("Access denied"); }
        var hasUser: Ace = item._acl.find(e => e._id === user._id);
        if (hasUser === null || hasUser === undefined) {
            if (collectionname != "audit") { this._logger.debug("Adding self " + user.username + " to object " + (item.name || item._name)); }
            item.addRight(user._id, user.name, [Rights.full_control]);
        }
        if (item._id !== null && item._id !== undefined && item._id !== "") {
            item = await this.UpdateOne(item, collectionname, jwt);
        } else {
            item = await this.InsertOne(item, collectionname, jwt);
        }
        return item;
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


        // var arr = await this.db.collection(collectionname).find(_query).toArray();
        // console.log(JSON.stringify(_query, null, 2));
        // console.log(arr);

        this._logger.debug("deleting " + id + " in database");
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
        // return { $or: finalor.concat(isme) };
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
     * @param  {string} action Permission wanted (create, update, delete)
     * @returns boolean Is allowed
     */
    hasAuthorization(user: TokenUser, item: any, action: string): boolean {
        if (Config.api_bypass_perm_check) { return true; }
        if (user._id === WellknownIds.root) { return true; }
        if (action === "create" || action === "delete") {
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
        if (action === "update" && item._id === WellknownIds.admins && item.name.toLowerCase() !== "admins") {
            return false;
        }
        if (action === "update" && item._id === WellknownIds.users && item.name.toLowerCase() !== "users") {
            return false;
        }
        if (action === "update" && item._id === WellknownIds.root && item.name.toLowerCase() !== "root") {
            return false;
        }
        if (item.userid === user.username || item.userid === user._id || item.user === user.username) {
            return true;
        } else if (item._id === user._id) {
            if (action === "delete") { this._logger.error("hasAuthorization, cannot delete self!"); return false; }
            return true;
        }
        return true;
    }
    replaceAll(target, search, replacement) {
        //var target = this;
        // return target.replace(new RegExp(search, 'g'), replacement);
        return target.split(search).join(replacement);
    };
    /**
     * Helper function to clean item before saving in MongoDB ( normalize ACE rights and remove illegal key $$ )
     * @param  {object} o Item to clean
     * @returns void Clean object
     */
    traversejsonencode(o) {
        var keys = Object.keys(o);
        for (let i = 0; i < keys.length; i++) {
            let key = keys[i];
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
    traversejsondecode(o) {
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

}