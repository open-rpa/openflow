import { Span } from "@opentelemetry/api";
import { Binary, FindCursor } from "mongodb";
import { Base, iAgent, Rights, Resource, ResourceUsage, Role, User } from "./commoninterfaces.js";
import { Config } from "./Config.js";
import { Crypt } from "./Crypt.js";
import { DatabaseConnection } from "./DatabaseConnection.js";
import { Logger } from "./Logger.js";
import { Message } from "./Messages/Message.js";
import { Util, Wellknown } from "./Util.js";
export class HouseKeeping {
  public static lastHouseKeeping: Date = null;
  public static ReadyForHousekeeping(): boolean {
    if (HouseKeeping.lastHouseKeeping == null) {
      return true;
    }
    const date = new Date();
    const diffminutes = calculateDateDifferenceInMinutes(date, HouseKeeping.lastHouseKeeping);
    Logger.instanse.silly(`${diffminutes} minutes since last housekeeping`, null, { cls: "Housekeeping", func: "ReadyForHousekeeping" });
    return diffminutes >= 60;
  }
  public static async DoHouseKeeping(skipAgentCleanup: boolean, skipCalculateSize: boolean, skipUpdateUserSize: boolean, parent: Span): Promise<void> {
    initMemoryUsage();
    let rootuser: User = User.assign(Crypt.rootUser());
    const span: Span = Logger.otel.startSubSpan("message.QueueMessage", parent);
    try {
      await HouseKeeping.ensureBuiltInUsersAndRoles(span);
      await Config.db.ensureindexes(span);
      if (Config.auto_hourly_housekeeping == false) {
        Logger.instanse.debug("HouseKeeping disabled, quit.", span, { cls: "Housekeeping", func: "DoHouseKeeping" });
        return;
      }
      await HouseKeeping.runInstanceCleanup(skipAgentCleanup, rootuser, span);
      await HouseKeeping.validateBuiltinRoles(span);
      await HouseKeeping.removeUnvalidatedUsers(span);
      await HouseKeeping.cleanupOpenRPAInstances(span);
      await HouseKeeping.migrateToTimeseries(rootuser, span);
      await HouseKeeping.caclulateSizeAndUsage(skipCalculateSize, span);
      await HouseKeeping.updateUserSizeAndUsage(skipUpdateUserSize, span);
      await HouseKeeping.updateCustomerSizeAndUsage(skipUpdateUserSize, span);
      await HouseKeeping.ensureSearchNames(span);
    } catch (error) {
      Logger.instanse.error(error, span, { cls: "Housekeeping", func: "DoHouseKeeping" });
    } finally {
      Logger.otel.endSpan(span);
      if (Config.auto_hourly_housekeeping == true) {
        logMemoryUsage("Housekeeping end", span);
      }
    }
  }
  private static async runInstanceCleanup(skipAgentCleanup: boolean, rootuser: User, span: Span) {
    try {
      if (Logger.agentdriver != null && skipAgentCleanup == false) {
        try {
          Logger.instanse.debug("HouseKeeping Run InstanceCleanup", span, { cls: "Housekeeping", func: "runInstanceCleanup" });
          await Logger.agentdriver.InstanceCleanup(span);
        } catch (error) {
          Logger.instanse.error(error, span, { cls: "Housekeeping", func: "runInstanceCleanup" });
        }
        const jwt: string = Crypt.rootToken();

        const resource: Resource = await Config.db.GetResource("Agent Instance", span);
        let agentquery = { _type: "agent", "autostart": true };
        if (resource != null) {
          agentquery["stripeprice"] = { "$exists": true, "$ne": "" };
        }

        var agents = await Config.db.query<iAgent>({ collectionname: "agents", query: agentquery, jwt }, span);
        Logger.instanse.debug("HouseKeeping ensure " + agents.length + " agents", span, { cls: "Housekeeping", func: "runInstanceCleanup" });

        for (let i = 0; i < agents.length; i++) {
          const agent = agents[i];
          var pods = await Logger.agentdriver.GetInstancePods(rootuser, jwt, agent, false, span);
          if (pods == null || pods.length == 0) {
            if (agent.name != agent.slug) {
              Logger.instanse.debug("HouseKeeping ensure " + agent.name + " (" + agent.slug + ")", span, { cls: "Housekeeping", func: "runInstanceCleanup" });
            } else {
              Logger.instanse.debug("HouseKeeping ensure " + agent.name, span, { cls: "Housekeeping", func: "runInstanceCleanup" });
            }
            try {
              await Logger.agentdriver.EnsureInstance(rootuser, jwt, agent, span);
            } catch (error) {
              Logger.instanse.error(error, span, { cls: "Housekeeping", func: "runInstanceCleanup" });
            }
          }
        }
        logMemoryUsage("runInstanceCleanup", span);
      } else {
        Logger.instanse.warn("agentdriver is null, skip agent check", span, { cls: "Housekeeping", func: "runInstanceCleanup" });
      }
    } catch (error) {
      Logger.instanse.error(error, span, { cls: "Housekeeping", func: "runInstanceCleanup" });
    }
  }
  private static async validateBuiltinRoles(span: Span) {
    try {
      const jwt: string = Crypt.rootToken();
      Logger.instanse.debug("Begin validating builtin roles", span, { cls: "Housekeeping", func: "validateBuiltinRoles" });
      for (var i = 0; i < DatabaseConnection.WellknownIdsArray.length; i++) {
        const item: Role = await Config.db.GetOne<Role>({
          query: {
            _id: DatabaseConnection.WellknownIdsArray[i],
            "_type": "role"
          }, collectionname: "users", jwt
        }, span);
        if (item != null) {
          Logger.instanse.verbose("Save/validate " + item.name, span, { cls: "Housekeeping", func: "validateBuiltinRoles" });
          await Logger.DBHelper.Save(item, jwt, span);
        }
      }
      logMemoryUsage("validateBuiltinRoles", span);
    } catch (error) {
      Logger.instanse.error(error, span, { cls: "Housekeeping", func: "validateBuiltinRoles" });
    }
  }
  private static async removeUnvalidatedUsers(span: Span) {
    if (Config.housekeeping_remove_unvalidated_user_days > 0) {
      Logger.instanse.debug("Begin removing unvalidated users older than " + Config.housekeeping_remove_unvalidated_user_days + " days", span, { cls: "Housekeeping", func: "removeUnvalidatedUsers" });
      let todate = new Date();
      todate.setDate(todate.getDate() - 1);
      let fromdate = new Date();
      fromdate.setMonth(fromdate.getMonth() - 1);
      const jwt: string = Crypt.rootToken();

      let query = { "validated": false, "_type": "user", "_id": { "$ne": Wellknown.root._id } };
      query["_modified"] = { "$lt": todate.toISOString(), "$gt": fromdate.toISOString() }
      let count = await Config.db.DeleteMany(query, null, "users", "", false, jwt, span);
      if (count > 0) {
        Logger.instanse.verbose("Removed " + count + " unvalidated users", span, { cls: "Housekeeping", func: "removeUnvalidatedUsers" });
      }
      logMemoryUsage("removeUnvalidatedUsers", span);
    }
  }
  private static async cleanupOpenRPAInstances(span: Span) {
    if (Config.housekeeping_cleanup_openrpa_instances == true) {
      Logger.instanse.debug("Begin cleaning up openrpa instances", span, { cls: "Housekeeping", func: "cleanupOpenRPAInstances" });
      let result = await Config.db.UpdateDocument({ "state": { "$in": ["idle", "running"] } },
        { "$set": { "state": "completed" }, "$unset": { "xml": "" } }, "openrpa_instances", 1, true, Crypt.rootToken(), span);
      if (result.nModified > 0) {
        Logger.instanse.verbose("Updated " + result.nModified + " openrpa instances", span, { cls: "Housekeeping", func: "cleanupOpenRPAInstances" });
      } else if (result.modifiedCount > 0) {
        Logger.instanse.verbose("Updated " + result.modifiedCount + " openrpa instances", span, { cls: "Housekeeping", func: "cleanupOpenRPAInstances" });
      }
    }
    logMemoryUsage("cleanupOpenRPAInstances", span);
  }
  private static async migrateToTimeseries(rootuser: User, span: Span) {
    Logger.instanse.debug("Begin validating prefered timeseries collections", span, { cls: "Housekeeping", func: "migrateToTimeseries" });
    let collections = await DatabaseConnection.toArray(Config.db.db.listCollections());
    try {
      let audit = collections.find(x => x.name == "audit");
      let audit_old = collections.find(x => x.name == "audit_old");
      if (audit != null && Config.force_audit_ts && audit.type != "timeseries") {
        await Config.db.db.collection("audit").rename("audit_old");
        audit = null;
      }
      if (audit == null) {
        audit = await Config.db.db.createCollection("audit", { timeseries: { timeField: "_created", metaField: "userid", granularity: "minutes" } });
      }
      collections = await DatabaseConnection.toArray(Config.db.db.listCollections());
      audit = collections.find(x => x.name == "audit");
      audit_old = collections.find(x => x.name == "audit_old");
      if (Config.migrate_audit_to_ts && Config.force_audit_ts && audit != null && audit_old != null && audit.type == "timeseries") {
        let bulkInsert = Config.db.db.collection("audit").initializeUnorderedBulkOp();
        let bulkRemove = Config.db.db.collection("audit_old").initializeUnorderedBulkOp()
        DatabaseConnection.timeseries_collections = ["audit"]

        let cursor = Config.db.db.collection("audit_old").find({})
        var count = await Config.db.db.collection("audit_old").countDocuments();
        var counter = 0;
        const x = 1000
        for await (let a of cursor) {
          a = await Config.db.CleanACL(a as any, rootuser as any, "audit", span, true) as any;
          bulkInsert.insert(a);
          bulkRemove.find({ _id: a._id }).deleteOne();
          counter++
          // @ts-ignore
          var insertCount = bulkInsert.length;
          if (counter % x === 0) {
            if (insertCount > 0) {
              Logger.instanse.info("migrated " + counter + " of " + count + " audit records " + ((100 * counter) / count).toFixed(2) + "%", span, { cls: "Housekeeping", func: "migrateToTimeseries" });
              bulkInsert.execute()
              bulkRemove.execute()
              bulkInsert = Config.db.db.collection("audit").initializeUnorderedBulkOp();
              bulkRemove = Config.db.db.collection("audit_old").initializeUnorderedBulkOp()
            }
          }
        }
        // @ts-ignore
        var insertCount = bulkInsert.length;
        if (insertCount > 0) {
          bulkInsert.execute()
          bulkRemove.execute()
        }

      }
    } catch (error) {
      Logger.instanse.error(error, span, { cls: "Housekeeping", func: "migrateToTimeseries" });
    }


    try {
      let dbusage = collections.find(x => x.name == "dbusage");
      let dbusage_old = collections.find(x => x.name == "dbusage_old");
      if (dbusage != null && Config.force_dbusage_ts && dbusage.type != "timeseries") {
        await Config.db.db.collection("dbusage").rename("dbusage_old");
        dbusage = null;
      }
      if (dbusage == null) {
        dbusage = await Config.db.db.createCollection("dbusage", { timeseries: { timeField: "timestamp", metaField: "userid", granularity: "hours" } });
      }

      collections = await DatabaseConnection.toArray(Config.db.db.listCollections());
      dbusage = collections.find(x => x.name == "dbusage");
      dbusage_old = collections.find(x => x.name == "dbusage_old");
      if (Config.force_dbusage_ts && dbusage != null && dbusage_old != null && dbusage.type == "timeseries") {
        let bulkInsert = Config.db.db.collection("dbusage").initializeUnorderedBulkOp();
        let bulkRemove = Config.db.db.collection("dbusage_old").initializeUnorderedBulkOp()
        DatabaseConnection.timeseries_collections = ["dbusage"]

        let cursor = Config.db.db.collection("dbusage_old").find({})
        var count = await Config.db.db.collection("dbusage_old").countDocuments();
        var counter = 0;
        const x = 1000
        for await (let a of cursor) {
          delete a.name;
          delete a._createdby;
          delete a._createdbyid;
          delete a._created;
          delete a._modifiedby;
          delete a._modifiedbyid;
          delete a._modified;
          delete a._type;

          a = await Config.db.CleanACL(a as any, rootuser as any, "dbusage", span, true) as any;
          bulkInsert.insert(a);
          bulkRemove.find({ _id: a._id }).deleteOne();
          counter++
          // @ts-ignore
          var insertCount = bulkInsert.length;
          if (counter % x === 0) {
            if (insertCount > 0) {
              Logger.instanse.info("migrated " + counter + " of " + count + " dbusage records " + ((100 * counter) / count).toFixed(2) + "%", span, { cls: "Housekeeping", func: "migrateToTimeseries" });
              bulkInsert.execute()
              bulkRemove.execute()
              bulkInsert = Config.db.db.collection("dbusage").initializeUnorderedBulkOp();
              bulkRemove = Config.db.db.collection("dbusage_old").initializeUnorderedBulkOp()
            }
          }
        }
        // @ts-ignore
        var insertCount = bulkInsert.length;
        if (insertCount > 0) {
          bulkInsert.execute()
          bulkRemove.execute()
        }

      }
    } catch (error) {
      Logger.instanse.error(error, span, { cls: "Housekeeping", func: "migrateToTimeseries" });
    }
    logMemoryUsage("migrateToTimeseries", span);
  }
  private static async ensureSearchNames(span: Span) {
    if (!Config.ensure_indexes) {
      Logger.instanse.debug("ensure_indexes is false, skip ensureSearchNames", span, { cls: "Housekeeping", func: "ensureSearchNames" });
      return;
    }
    Logger.instanse.debug("Begin ensuring searchnames", span, { cls: "Housekeeping", func: "ensureSearchNames" });
    for (let i = 0; i < DatabaseConnection.collections_with_text_index.length; i++) {
      let collectionname = DatabaseConnection.collections_with_text_index[i];
      if (DatabaseConnection.timeseries_collections.indexOf(collectionname) > -1) continue;
      if (DatabaseConnection.usemetadata(collectionname)) {
        let exists = await Config.db.db.collection(collectionname).findOne({ "metadata._searchnames": { $exists: false } });
        if (!Util.IsNullUndefinded(exists)) {
          Logger.instanse.debug("Start creating metadata._searchnames for collection " + collectionname, span, { cls: "Housekeeping", func: "ensureSearchNames" });
          await Config.db.db.collection(collectionname).updateMany({ "metadata._searchnames": { $exists: false } },
            [
              {
                "$set": {
                  "metadata._searchnames":
                  {
                    $split: [
                      {
                        $replaceAll: {
                          input:
                          {
                            $replaceAll: {
                              input:
                              {
                                $replaceAll: {
                                  input:
                                    { $toLower: "$metadata.name" }
                                  , find: ".", replacement: " "
                                }
                              }
                              , find: "-", replacement: " "
                            }
                          }
                          , find: "/", replacement: " "
                        }
                      }
                      , " "]
                  }
                }
              }
              ,
              {
                "$set": {
                  "_searchname":
                  {
                    $replaceAll: {
                      input:
                      {
                        $replaceAll: {
                          input:
                          {
                            $replaceAll: {
                              input:
                                { $toLower: "$metadata.name" }
                              , find: ".", replacement: " "
                            }
                          }
                          , find: "-", replacement: " "
                        }
                      }
                      , find: "/", replacement: " "
                    }
                  }
                }
              }
              ,
              { "$set": { "metadata._searchnames": { $concatArrays: ["$metadata._searchnames", [{ $toLower: "$metadata.name" }]] } } }
            ]
          )
          Logger.instanse.debug("Done creating _searchnames for collection " + collectionname, span, { cls: "Housekeeping", func: "ensureSearchNames" });
        }
      } else {
        let exists = await Config.db.db.collection(collectionname).findOne({ "_searchnames": { $exists: false } });
        if (!Util.IsNullUndefinded(exists)) {
          Logger.instanse.debug("Start creating _searchnames for collection " + collectionname, span, { cls: "Housekeeping", func: "ensureSearchNames" });
          await Config.db.db.collection(collectionname).updateMany({ "_searchnames": { $exists: false } },
            [
              {
                "$set": {
                  "_searchnames":
                  {
                    $split: [
                      {
                        $replaceAll: {
                          input:
                          {
                            $replaceAll: {
                              input:
                              {
                                $replaceAll: {
                                  input:
                                    { $toLower: "$name" }
                                  , find: ".", replacement: " "
                                }
                              }
                              , find: "-", replacement: " "
                            }
                          }
                          , find: "/", replacement: " "
                        }
                      }
                      , " "]
                  }
                }
              }
              ,
              {
                "$set": {
                  "_searchname":
                  {
                    $replaceAll: {
                      input:
                      {
                        $replaceAll: {
                          input:
                          {
                            $replaceAll: {
                              input:
                                { $toLower: "$name" }
                              , find: ".", replacement: " "
                            }
                          }
                          , find: "-", replacement: " "
                        }
                      }
                      , find: "/", replacement: " "
                    }
                  }
                }
              }
              ,
              { "$set": { "_searchnames": { $concatArrays: ["$_searchnames", [{ $toLower: "$name" }]] } } }
            ]
          )
          Logger.instanse.debug("Done creating _searchnames for collection " + collectionname, span, { cls: "Housekeeping", func: "ensureSearchNames" });
        }
      }
    }
    logMemoryUsage("ensureSearchNames", span);
  }
  private static async caclulateSizeAndUsage(skipCalculateSize: boolean, span: Span) {
    if (!skipCalculateSize) {
      Logger.instanse.debug("Begin calculating size and usage", span, { cls: "Housekeeping", func: "caclulateSizeAndUsage" });
      const timestamp = new Date(new Date().toISOString());
      timestamp.setUTCHours(0, 0, 0, 0);

      const usemetadata = DatabaseConnection.usemetadata("dbusage");
      const user = Crypt.rootUser();
      const tuser = user;
      const jwt: string = Crypt.rootToken();
      let collections = await Config.db.ListCollections(false, jwt);
      collections = collections.filter(x => x.name.indexOf("system.") === -1);

      let totalusage = 0;
      let index = 0;
      let skip_collections = [];
      if (!Util.IsNullEmpty(Config.housekeeping_skip_collections)) skip_collections = Config.housekeeping_skip_collections.split(",")
      for (let col of collections) {
        var n: string = col.name;
        if (n.endsWith(".chunks")) continue;
        if (skip_collections.indexOf(col.name) > -1) {
          Logger.instanse.debug("skipped " + col.name + " due to housekeeping_skip_collections setting", span, { cls: "Housekeeping", func: "caclulateSizeAndUsage" });
          continue;
        }


        index++;
        let aggregates: any = [
          {
            "$project": {
              "_modifiedbyid": 1,
              "_modifiedby": 1,
              "object_size": { "$bsonSize": "$$ROOT" }
            }
          },
          {
            "$group": {
              "_id": "$_modifiedbyid",
              "size": { "$sum": "$object_size" },
              "name": { "$first": "$_modifiedby" }
            }
          },
          { $addFields: { "userid": "$_id" } },
          { $unset: "_id" },
          { $addFields: { "collection": col.name } },
          { $addFields: { timestamp: timestamp.toISOString() } },
        ];
        if (col.name.endsWith(".files")) {
          aggregates = [
            {
              "$project": {
                "_modifiedbyid": "$metadata._modifiedbyid",
                "_modifiedby": "$metadata._modifiedby",
                "object_size": "$length"
              }
            },
            {
              "$group": {
                "_id": "$_modifiedbyid",
                "size": { "$sum": "$object_size" },
                "name": { "$first": "$_modifiedby" }
              }
            },
            { $addFields: { "userid": "$_id" } },
            { $unset: "_id" },
            { $addFields: { "collection": col.name } },
            { $addFields: { timestamp: timestamp.toISOString() } },
          ]
        }
        if (col.name == "audit") {
          aggregates = [
            {
              "$project": {
                "userid": 1,
                "name": 1,
                "object_size": { "$bsonSize": "$$ROOT" }
              }
            },
            {
              "$group": {
                "_id": "$userid",
                "size": { "$sum": "$object_size" },
                "name": { "$first": "$name" }
              }
            },
            { $addFields: { "userid": "$_id" } },
            { $unset: "_id" },
            { $addFields: { "collection": col.name } },
            { $addFields: { timestamp: timestamp.toISOString() } },
          ]
        }
        const cursor = await Config.db.db.collection(col.name).aggregate(aggregates);
        try {
          if (!DatabaseConnection.istimeseries("dbusage")) {
            if (usemetadata) {
              await Config.db.db.collection("dbusage").deleteMany({ timestamp: timestamp, "metadata.collection": col.name });
            } else {
              await Config.db.db.collection("dbusage").deleteMany({ timestamp: timestamp, collection: col.name });
            }
          }
        } catch (error) {
          Logger.instanse.error(error, span, { cls: "Housekeeping", func: "caclulateSizeAndUsage" });
        }
        let usage = 0;
        let bulkInsert = Config.db.db.collection("dbusage").initializeUnorderedBulkOp();
        for await (const c of cursor) {
          try {
            // sometimes the item is "weird", re-serializing it, cleans it, so it works again ... mongodb bug ???
            let item = JSON.parse(JSON.stringify(c));
            item = Config.db.ensureResource(item, "dbusage");
            item = await Config.db.CleanACL(item, tuser, "dbusage", span);
            Base.addRight(item, item.userid, item.name, [Rights.read]);
            for (let i = item._acl.length - 1; i >= 0; i--) {
              {
                const ace = item._acl[i];
                if (typeof ace.rights === "string") {
                  const b = new Binary(Buffer.from(ace.rights, "base64"), 0);
                  (ace.rights as any) = b;
                }
              }
            }
            delete item._id;
            if (usemetadata) {
              item.metadata = item.metadata || {};
              item.metadata.collection = item.collection;
              item.metadata.username = item.name;
              delete item.collection;
              delete item.name;
            } else {
              item.username = item.name;
              item._type = "metered";
              delete item.name;
            }
            usage += item.size;
            DatabaseConnection.traversejsonencode(item);
            item.timestamp = new Date(timestamp.toISOString());
            bulkInsert.insert(item);
          } catch (error) {
            Logger.instanse.error(error, span, { cls: "Housekeeping", func: "caclulateSizeAndUsage" });
          }

        }
        totalusage += usage;

        try {
          // @ts-ignore
          var insertCount = bulkInsert.length;
          if (insertCount > 0) {
            await bulkInsert.execute();
          }
          if (usage > 0) Logger.instanse.debug("[" + col.name + "][" + index + "/" + collections.length + "] usage of " + formatBytes(usage), span, { cls: "Housekeeping", func: "caclulateSizeAndUsage" });
        } catch (error) {
          Logger.instanse.error(error, span, { cls: "Housekeeping", func: "caclulateSizeAndUsage" });
        }
      }
      Logger.instanse.debug("Add stats from " + collections.length + " collections with a total usage of " + formatBytes(totalusage), span, { cls: "Housekeeping", func: "caclulateSizeAndUsage" });
      logMemoryUsage("caclulateSizeAndUsage", span);
    }
  }
  private static async updateUserSizeAndUsage(skipUpdateUserSize: boolean, span: Span) {
    if (!skipUpdateUserSize) {
      Logger.instanse.debug("Begin updating all users dbusage field", span, { cls: "Housekeeping", func: "updateUserSizeAndUsage" });
      const timestamp = new Date(new Date().toISOString());
      timestamp.setUTCHours(0, 0, 0, 0);
      let index = 0;
      const fivedaysago = new Date(new Date().toISOString());;
      fivedaysago.setUTCHours(0, 0, 0, 0);
      fivedaysago.setDate(fivedaysago.getDate() - 5);

      const usercount = await Config.db.db.collection("users").aggregate([{ "$match": { "_type": "user", lastseen: { "$gte": fivedaysago } } }, { $count: "userCount" }]).toArray();
      if (usercount.length > 0) {
        Logger.instanse.debug("Begin updating all users (" + usercount[0].userCount + ") dbusage field", span, { cls: "Housekeeping", func: "updateUserSizeAndUsage" });
      }
      let cursor: FindCursor<any>;
      if (Config.NODE_ENV == "production") {
        cursor = Config.db.db.collection("users").find({ "_type": "user", lastseen: { "$gte": fivedaysago } });
      } else {
        cursor = Config.db.db.collection("users").find({ "_type": "user", lastseen: { "$gte": fivedaysago } });
      }
      for await (const u of cursor) {
        if (u.dbusage == null) u.dbusage = 0;
        index++;
        const pipe = [
          { "$match": { "userid": u._id, timestamp: timestamp } },
          {
            "$group":
            {
              "_id": "$userid",
              "size": { "$max": "$size" },
              "count": { "$sum": 1 }
            }
          }
        ]// "items": { "$push": "$$ROOT" }
        const items: any[] = await Config.db.db.collection("dbusage").aggregate(pipe).toArray();
        if (items.length > 0) {
          Logger.instanse.debug("[" + index + "/" + usercount[0].userCount + "] " + u.name + " " + formatBytes(items[0].size) + " from " + items[0].count + " collections", span, { cls: "Housekeeping", func: "updateUserSizeAndUsage" });
          await Config.db.db.collection("users").updateOne({ _id: u._id }, { $set: { "dbusage": items[0].size } });
        }
        if (index % 100 == 0) {
          Logger.instanse.debug("[" + index + "/" + usercount[0].userCount + "] Processing", span, { cls: "Housekeeping", func: "updateUserSizeAndUsage" });
          logMemoryUsage("updateUserSizeAndUsage", span);
        }

      }
      Logger.instanse.debug("Completed updating all users dbusage field", span, { cls: "Housekeeping", func: "updateUserSizeAndUsage" });
      logMemoryUsage("updateUserSizeAndUsage", span);
    }
  }
  private static async updateCustomerSizeAndUsage(skipUpdateUserSize: boolean, span: Span) {
    if (Config.multi_tenant) {
      try {
        Logger.instanse.debug("Begin updating all customers dbusage field", span, { cls: "Housekeeping", func: "updateCustomerSizeAndUsage" });
        const usercount = await Config.db.db.collection("users").aggregate([{ "$match": { "_type": "customer" } }, { $count: "userCount" }]).toArray();
        if (usercount.length > 0) {
          Logger.instanse.debug("Begin updating all customers (" + usercount[0].userCount + ") dbusage field", span, { cls: "Housekeeping", func: "updateCustomerSizeAndUsage" });
        }
        const pipe = [
          { "$match": { "_type": "customer" } },
          { "$project": { "name": 1, "dbusage": 1, "stripeid": 1, "dblocked": 1 } },
          {
            "$lookup": {
              "from": "users",
              "let": {
                "id": "$_id"
              },
              "pipeline": [
                {
                  "$match": {
                    "$expr": {
                      "$and": [
                        {
                          "$eq": [
                            "$customerid",
                            "$$id"
                          ]
                        },
                        {
                          "$eq": [
                            "$_type",
                            "user"
                          ]
                        }
                      ]
                    }
                  }
                },
                {
                  $project:
                  {
                    "name": 1, "dbusage": 1, "_id": 0
                  }
                }
              ],
              "as": "users"
            }

          }
        ]
        const cursor = await Config.db.db.collection("users").aggregate(pipe)
        for await (const c of cursor) {
          let dbusage: number = 0;
          for (let u of c.users) dbusage += (u.dbusage ? u.dbusage : 0);
          await Config.db.db.collection("users").updateOne({ _id: c._id }, { $set: { "dbusage": dbusage } });
          Logger.instanse.debug(c.name + " using " + formatBytes(dbusage), span, { cls: "Housekeeping", func: "updateCustomerSizeAndUsage" });
        }
        var sleep = (ms) => {
          return new Promise(resolve => { setTimeout(resolve, ms) })
        }
        await sleep(2000);

      } catch (error) {
        Logger.instanse.error(error, span, { cls: "Housekeeping", func: "updateCustomerSizeAndUsage" });
      }
      logMemoryUsage("updateCustomerSizeAndUsage - part 1", span);
    }
    if (Config.multi_tenant && !skipUpdateUserSize) {
      Logger.instanse.debug("Begin updating all customers dbusage field", span, { cls: "Housekeeping", func: "updateCustomerSizeAndUsage" });
      try {
        let index = 0;
        const usercount = await Config.db.db.collection("users").aggregate([{ "$match": { "_type": "customer" } }, { $count: "userCount" }]).toArray();
        if (usercount.length > 0) {
          Logger.instanse.debug("Begin updating all customers (" + usercount[0].userCount + ") dbusage field", span, { cls: "Housekeeping", func: "updateCustomerSizeAndUsage" });
        }

        const pipe = [
          { "$match": { "_type": "customer" } },
          { "$project": { "name": 1, "dbusage": 1, "stripeid": 1, "dblocked": 1 } },
          {
            "$lookup": {
              "from": "config",
              "let": {
                "id": "$_id"
              },
              "pipeline": [
                {
                  "$match": {
                    "$expr": {
                      "$and": [
                        {
                          "$eq": [
                            "$customerid",
                            "$$id"
                          ]
                        },
                        {
                          "$eq": [
                            "$_type",
                            "resourceusage"
                          ]
                        },
                        {
                          "$eq": [
                            "$resource",
                            "Database Usage"
                          ]
                        }
                      ]
                    }
                  }
                },
                {
                  $project:
                  {
                    "name": 1, "quantity": 1, "siid": 1, "product": 1, "_id": 0
                  }
                }
              ],
              "as": "config"
            }

          }
        ]
        const cursor = await Config.db.db.collection("users").aggregate(pipe);
        // @ts-ignore
        let resources: Resource[] = await Config.db.db.collection("config").find({ "_type": "resource", "name": "Database Usage" }).toArray();
        if (resources.length > 0) {
          let resource: Resource = resources[0];

          for await (const c of cursor) {
            if (c.dbusage == null) c.dbusage = 0;
            const config: ResourceUsage = c.config[0];
            index++;
            if (config == null) {
              if (c.dbusage > resource.defaultmetadata.dbusage) {
                await Config.db.db.collection("users").updateOne({ "_id": c._id }, { $set: { "dblocked": true } });
                if (!c.dblocked || c.dblocked) {
                  Logger.instanse.debug("dbblocking " + c.name + " using " + formatBytes(c.dbusage) + " allowed is " + formatBytes(resource.defaultmetadata.dbusage), span, { cls: "Housekeeping", func: "updateCustomerSizeAndUsage" });
                  await Config.db.db.collection("users").updateMany({ customerid: c._id, "_type": "user" }, { $set: { "dblocked": true } as any });
                }
              } else if (c.dbusage <= resource.defaultmetadata.dbusage) {
                await Config.db.db.collection("users").updateOne({ "_id": c._id }, { $set: { "dblocked": false } });
                if (c.dblocked || !c.dblocked) {
                  Logger.instanse.debug("unblocking " + c.name + " using " + formatBytes(c.dbusage) + " allowed is " + formatBytes(resource.defaultmetadata.dbusage), span, { cls: "Housekeeping", func: "updateCustomerSizeAndUsage" });
                  await Config.db.db.collection("users").updateMany({ customerid: c._id, "_type": "user" }, { $set: { "dblocked": false } as any });
                }
              }
            } else if (config.product.customerassign != "metered") {
              let quota: number = resource.defaultmetadata.dbusage + (config.quantity * config.product.metadata.dbusage);
              if (c.dbusage > quota) {
                await Config.db.db.collection("users").updateOne({ "_id": c._id }, { $set: { "dblocked": true } });
                if (!c.dblocked || c.dblocked) {
                  Logger.instanse.debug("dbblocking " + c.name + " using " + formatBytes(c.dbusage) + " allowed is " + formatBytes(quota), span, { cls: "Housekeeping", func: "updateCustomerSizeAndUsage" });
                  await Config.db.db.collection("users").updateMany({ customerid: c._id, "_type": "user" }, { $set: { "dblocked": true } as any });
                }
              } else if (c.dbusage <= quota) {
                await Config.db.db.collection("users").updateOne({ "_id": c._id }, { $set: { "dblocked": false } });
                if (c.dblocked || !c.dblocked) {
                  Logger.instanse.debug("unblocking " + c.name + " using " + formatBytes(c.dbusage) + " allowed is " + formatBytes(quota), span, { cls: "Housekeeping", func: "updateCustomerSizeAndUsage" });
                  await Config.db.db.collection("users").updateMany({ customerid: c._id, "_type": "user" }, { $set: { "dblocked": false } as any });
                }
              }
            } else if (config.product.customerassign == "metered") {
              let billabledbusage: number = c.dbusage - resource.defaultmetadata.dbusage;
              if (billabledbusage > 0) {
                const billablecount = Math.ceil(billabledbusage / config.product.metadata.dbusage);

                Logger.instanse.debug("Add usage_record for " + c.name + " using " + formatBytes(billabledbusage) + " equal to " + billablecount + " units of " + formatBytes(config.product.metadata.dbusage), span, { cls: "Housekeeping", func: "updateCustomerSizeAndUsage" });
                const dt = parseInt((new Date().getTime() / 1000).toFixed(0))
                const payload: any = { "quantity": billablecount, "timestamp": dt };
                if (!Util.IsNullEmpty(config.siid) && !Util.IsNullEmpty(c.stripeid)) {
                  try {
                    await Message.Stripe("POST", "usage_records", config.siid, payload, c.stripeid);
                  } catch (error) {
                    if (error.response && error.response.body) {
                      Logger.instanse.error("Update usage record error!" + error.response.body, span, { cls: "Housekeeping", func: "updateCustomerSizeAndUsage" });
                    } else {
                      Logger.instanse.error("Update usage record error!" + error, span, { cls: "Housekeeping", func: "updateCustomerSizeAndUsage" });
                    }
                  }
                }
              }
              if (c.dblocked || !c.dblocked) {
                await Config.db.db.collection("users").updateOne({ "_id": c._id }, { $set: { "dblocked": false } });
                await Config.db.db.collection("users").updateMany({ customerid: c._id, "_type": "user" }, { $set: { "dblocked": false } as any });
              }
            }
            if (index % 100 == 0) {
              Logger.instanse.debug("[" + index + "/" + usercount[0].userCount + "] Processing", span, { cls: "Housekeeping", func: "updateCustomerSizeAndUsage" });
              logMemoryUsage("updateCustomerSizeAndUsage", span);
            }
          }
          Logger.instanse.debug("Completed updating all customers dbusage field", span, { cls: "Housekeeping", func: "updateCustomerSizeAndUsage" });


          const pipe2 = [
            { "$match": { "_type": "user", "$or": [{ "customerid": { $exists: false } }, { "customerid": "" }] } },
            { "$project": { "name": 1, "dbusage": 1, "dblocked": 1 } }];
          const cursor2 = await Config.db.db.collection("users").aggregate(pipe2);
          for await (const c of cursor2) {
            if (DatabaseConnection.WellknownIdsArray.indexOf(c._id) > -1) continue;
            if (c.dbusage == null) c.dbusage = 0;
            if (c.dbusage > resource.defaultmetadata.dbusage) {
              Logger.instanse.debug("dbblocking " + c.name + " using " + formatBytes(c.dbusage) + " allowed is " + formatBytes(resource.defaultmetadata.dbusage), span, { cls: "Housekeeping", func: "updateCustomerSizeAndUsage" });
              await Config.db.db.collection("users").updateOne({ "_id": c._id }, { $set: { "dblocked": true } });
            } else {
              if (c.dblocked) {
                await Config.db.db.collection("users").updateOne({ "_id": c._id }, { $set: { "dblocked": false } });
                Logger.instanse.debug("unblocking " + c.name + " using " + formatBytes(c.dbusage) + " allowed is " + formatBytes(resource.defaultmetadata.dbusage), span, { cls: "Housekeeping", func: "updateCustomerSizeAndUsage" });
              }

            }
          }
          Logger.instanse.debug("Completed updating all users without a customer dbusage field", span, { cls: "Housekeeping", func: "updateCustomerSizeAndUsage" });
        }
        logMemoryUsage("Housekeeping end", span);
      } catch (error) {
        if (error.response && error.response.body) {
          Logger.instanse.error(error.response.body, span, { cls: "Housekeeping", func: "updateCustomerSizeAndUsage" });
        } else {
          Logger.instanse.error(error, span, { cls: "Housekeeping", func: "updateCustomerSizeAndUsage" });
        }
      } finally {
        Logger.instanse.debug("Completed housekeeping", span, { cls: "Housekeeping", func: "updateCustomerSizeAndUsage" });
      }
      logMemoryUsage("updateCustomerSizeAndUsage - part 2", span);
    }
  }
  public static async ensureBuiltInUsersAndRoles(span: Span) {
    Logger.instanse.debug("Begin validating built in users and roles", span, { cls: "Housekeeping", func: "ensureBuiltInUsersAndRoles" });
    const jwt: string = Crypt.rootToken();
    const admins: Role = await Logger.DBHelper.EnsureRole(Wellknown.admins.name, Wellknown.admins._id, span);
    const users: Role = await Logger.DBHelper.EnsureRole(Wellknown.users.name, Wellknown.users._id, span);
    const root: User = await Logger.DBHelper.EnsureUser(jwt, Wellknown.root.name, Wellknown.root.name, Wellknown.root._id, null, null, span);

    Base.addRight(root, Wellknown.admins._id, Wellknown.admins.name, [Rights.full_control]);
    Base.removeRight(root, Wellknown.admins._id, [Rights.delete]);
    Base.addRight(root, Wellknown.root._id, Wellknown.root.name, [Rights.full_control]);
    Base.removeRight(root, Wellknown.root._id, [Rights.delete]);
    await Logger.DBHelper.Save(root, jwt, span);

    const guest: User = await Logger.DBHelper.EnsureUser(jwt, Wellknown.guest.name, Wellknown.guest.name, Wellknown.guest._id, null, null, span);
    Base.removeRight(guest, Wellknown.guest._id, [Rights.full_control]);
    Base.addRight(guest, Wellknown.guest._id, Wellknown.guest.name, [Rights.read]);
    await Logger.DBHelper.Save(guest, jwt, span);

    Base.addRight(admins, Wellknown.admins._id, Wellknown.admins.name, [Rights.full_control]);
    Base.removeRight(admins, Wellknown.admins._id, [Rights.delete]);
    await Logger.DBHelper.Save(admins, jwt, span);

    Base.addRight(users, Wellknown.admins._id, Wellknown.admins.name, [Rights.full_control]);
    Base.removeRight(users, Wellknown.admins._id, [Rights.delete]);
    users.AddMember(root);
    if (Config.multi_tenant) {
      Base.removeRight(users, users._id, [Rights.full_control]);
    } else {
      Base.removeRight(users, users._id, [Rights.full_control]);
      Base.addRight(users, users._id, "users", [Rights.read]);
    }
    await Logger.DBHelper.Save(users, jwt, span);

    var config: Base = await Config.db.GetOne({ query: { "_type": "config" }, collectionname: "config", jwt }, span);
    if (config == null) {
      config = new Base();
      config._type = "config";
      config.name = "Config override";
    }

    if (Config.dbConfig.compare("1.4.25") == -1) {
      // Fix queue and exchange names from before 1.4.25 where names would be saved without converting to lowercase
      var cursor = await Config.db.db.collection("mq").find({ "$or": [{ "_type": "exchange" }, { "_type": "queue" }] });
      for await (const u of cursor) {
        if (u.name != u.name.toLowerCase()) {
          await Config.db.db.collection("mq").updateOne({ "_id": u._id }, { "$set": { "name": u.name.toLowerCase() } });
        }
      }
      cursor.close();
    }


    if (Config.dbConfig.needsupdate) {
      await Config.dbConfig.Save(jwt, span);
    }

    if (Config.multi_tenant) {
      try {
        const resellers: Role = await Logger.DBHelper.EnsureRole(Wellknown.resellers.name, Wellknown.resellers._id, span);
        // @ts-ignore
        resellers.hidemembers = true;
        Base.addRight(resellers, Wellknown.admins._id, Wellknown.admins.name, [Rights.full_control]);
        Base.removeRight(resellers, Wellknown.admins._id, [Rights.delete]);
        Base.removeRight(resellers, Wellknown.resellers._id, [Rights.full_control]);
        resellers.AddMember(admins);
        await Logger.DBHelper.Save(resellers, jwt, span);

        const customer_admins: Role = await Logger.DBHelper.EnsureRole(Wellknown.customer_admins.name, Wellknown.customer_admins._id, span);
        // @ts-ignore
        customer_admins.hidemembers = true;
        Base.addRight(customer_admins, Wellknown.admins._id, Wellknown.admins.name, [Rights.full_control]);
        Base.removeRight(customer_admins, Wellknown.admins._id, [Rights.delete]);
        Base.removeRight(customer_admins, Wellknown.customer_admins._id, [Rights.full_control]);
        await Logger.DBHelper.Save(customer_admins, jwt, span);
      } catch (error) {
        Logger.instanse.error(error, span, { cls: "Housekeeping", func: "ensureBuiltInUsersAndRoles" });
      }
    }

    if (!admins.IsMember(root._id)) {
      admins.AddMember(root);
      await Logger.DBHelper.Save(admins, jwt, span);
    }

    const filestore_admins: Role = await Logger.DBHelper.EnsureRole(Wellknown.filestore_admins.name, Wellknown.filestore_admins._id, span);
    filestore_admins.AddMember(admins);
    Base.addRight(filestore_admins, Wellknown.admins._id, Wellknown.admins.name, [Rights.full_control]);
    Base.removeRight(filestore_admins, Wellknown.admins._id, [Rights.delete]);
    if (Config.multi_tenant) {
      Logger.instanse.silly("[root][users] Running in multi tenant mode, remove " + filestore_admins.name + " from self", span, { cls: "Housekeeping", func: "ensureBuiltInUsersAndRoles" });
      Base.removeRight(filestore_admins, filestore_admins._id, [Rights.full_control]);
    }
    await Logger.DBHelper.Save(filestore_admins, jwt, span);
    const filestore_users: Role = await Logger.DBHelper.EnsureRole(Wellknown.filestore_users.name, Wellknown.filestore_users._id, span);
    filestore_users.AddMember(admins);
    if (!Config.multi_tenant) {
      filestore_users.AddMember(users);
    }
    Base.addRight(filestore_users, Wellknown.admins._id, Wellknown.admins.name, [Rights.full_control]);
    Base.removeRight(filestore_users, Wellknown.admins._id, [Rights.delete]);
    if (Config.multi_tenant) {
      Logger.instanse.silly("[root][users] Running in multi tenant mode, remove " + filestore_users.name + " from self", span, { cls: "Housekeeping", func: "ensureBuiltInUsersAndRoles" });
      Base.removeRight(filestore_users, filestore_users._id, [Rights.full_control]);
    } else if (Config.update_acl_based_on_groups) {
      Base.removeRight(filestore_users, filestore_users._id, [Rights.full_control]);
      Base.addRight(filestore_users, filestore_users._id, filestore_users.name, [Rights.read]);
    }
    await Logger.DBHelper.Save(filestore_users, jwt, span);



    const workitem_queue_admins: Role = await Logger.DBHelper.EnsureRole(Wellknown.workitem_queue_admins.name, Wellknown.workitem_queue_admins._id, span);
    workitem_queue_admins.AddMember(admins);
    Base.addRight(workitem_queue_admins, Wellknown.admins._id, Wellknown.admins.name, [Rights.full_control]);
    Base.removeRight(workitem_queue_admins, Wellknown.admins._id, [Rights.delete]);
    if (Config.multi_tenant) {
      Base.removeRight(workitem_queue_admins, Wellknown.admins._id, [Rights.full_control]);
    }
    await Logger.DBHelper.Save(workitem_queue_admins, jwt, span);

    const workitem_queue_users: Role = await Logger.DBHelper.EnsureRole(Wellknown.workitem_queue_users.name, Wellknown.workitem_queue_users._id, span);
    Base.addRight(workitem_queue_users, Wellknown.admins._id, Wellknown.admins.name, [Rights.full_control]);
    Base.removeRight(workitem_queue_users, Wellknown.admins._id, [Rights.delete]);
    if (Config.multi_tenant) {
      Base.removeRight(workitem_queue_users, Wellknown.admins._id, [Rights.full_control]);
    }
    await Logger.DBHelper.Save(workitem_queue_users, jwt, span);

    if (Config.workspace_enabled) {
      const workspace_admins: Role = await Logger.DBHelper.EnsureRole(Wellknown.workspace_admins.name, Wellknown.workspace_admins._id, span);
      // @ts-ignore
      workspace_admins.hidemembers = true;
      Base.addRight(workspace_admins, Wellknown.admins._id, Wellknown.admins.name, [Rights.full_control]);
      Base.removeRight(workspace_admins, Wellknown.admins._id, [Rights.delete]);
      Base.removeRight(workspace_admins, Wellknown.workspace_admins._id, [Rights.full_control]);
      await Logger.DBHelper.Save(workspace_admins, jwt, span);

    }
  }
}
const formatBytes = (bytes, decimals = 2) => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  if (bytes < 0) {
    bytes = bytes * -1;
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return "-" + parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  } else {
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  }
}
const calculateDateDifferenceInMinutes = (date1, date2) => {
  const diff = (date1 - date2) / (1000 * 60);
  return diff;
};
let rss = 0;
let heapTotal = 0;
let heapUsed = 0;
let external = 0;
let arrayBuffers = 0;

export const initMemoryUsage = () => {
  const memoryUsage = process.memoryUsage();
  rss = memoryUsage.rss;
  heapTotal = memoryUsage.heapTotal;
  heapUsed = memoryUsage.heapUsed;
  external = memoryUsage.external;
  arrayBuffers = memoryUsage.arrayBuffers;
}
export const logMemoryUsage = (label, span) => {
  const memoryUsage = process.memoryUsage();
  Logger.instanse.debug(`Memory usage after ${label}:`, span, { cls: "Housekeeping", func: "logMemoryUsage" });
  Logger.instanse.debug(`RSS: ${formatBytes(memoryUsage.rss - rss)} now ${formatBytes(memoryUsage.rss)}`, span, { cls: "Housekeeping", func: "logMemoryUsage" });
  Logger.instanse.debug(`Heap Total: ${formatBytes(memoryUsage.heapTotal - heapTotal)} now ${formatBytes(memoryUsage.heapTotal)}`, span, { cls: "Housekeeping", func: "logMemoryUsage" });
  Logger.instanse.debug(`Heap Used: ${formatBytes(memoryUsage.heapUsed - heapUsed)} now ${formatBytes(memoryUsage.heapUsed)}`, span, { cls: "Housekeeping", func: "logMemoryUsage" });
  Logger.instanse.debug(`External: ${formatBytes(memoryUsage.external - external)} now ${formatBytes(memoryUsage.external)}`, span, { cls: "Housekeeping", func: "logMemoryUsage" });
  Logger.instanse.debug(`Array Buffers: ${formatBytes(memoryUsage.arrayBuffers - arrayBuffers)} now ${formatBytes(memoryUsage.arrayBuffers)}`, span, { cls: "Housekeeping", func: "logMemoryUsage" });
  rss = memoryUsage.rss;
  heapTotal = memoryUsage.heapTotal;
  heapUsed = memoryUsage.heapUsed;
  external = memoryUsage.external;
  arrayBuffers = memoryUsage.arrayBuffers;
};
