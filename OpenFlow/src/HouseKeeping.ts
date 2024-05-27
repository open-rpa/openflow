import { Base, NoderedUtil, Resource, ResourceUsage, Rights, Role, UpdateManyMessage, User, WellknownIds } from "@openiap/openflow-api";
import { Crypt } from "./Crypt.js";
import { Logger } from "./Logger.js";
import { Span } from "@opentelemetry/api";
import { Config } from "./Config.js";
import { iAgent } from "./commoninterfaces.js";
import { DatabaseConnection } from "./DatabaseConnection.js";
import { Binary, FindCursor } from "mongodb";
import { Message } from "./Messages/Message.js";
import fs from "fs";
export class HouseKeeping {
  public static lastHouseKeeping: Date = null;
  public static ReadyForHousekeeping(): boolean {
    if (HouseKeeping.lastHouseKeeping == null) {
      return true;
    }
    const date = new Date();
    const diffminutes = calculateDateDifferenceInMinutes(date, HouseKeeping.lastHouseKeeping);
    Logger.instanse.silly(`${diffminutes} minutes since last housekeeping`, null, { cls: "Housekeeping" });
    return diffminutes >= 60;
  }
  public static DoHouseKeeping(parent: Span) {
    if (HouseKeeping.lastHouseKeeping == null) {
      HouseKeeping.lastHouseKeeping = new Date();
      HouseKeeping.lastHouseKeeping.setDate(HouseKeeping.lastHouseKeeping.getDate() - 1);
    }
    if (!HouseKeeping.ReadyForHousekeeping()) {
      const date = new Date();
      const a: number = (date as any) - (HouseKeeping.lastHouseKeeping as any);
      const diffminutes = a / (1000 * 60);
      Logger.instanse.debug("Skipping housekeeping, to early for next run (ran " + diffminutes + " minutes ago)", parent, { cls: "Housekeeping" });
      return;
    }
    HouseKeeping.lastHouseKeeping = new Date();
    HouseKeeping._Housekeeping(false, false, false, parent);
  }
  public static async _Housekeeping(skipNodered: boolean, skipCalculateSize: boolean, skipUpdateUserSize: boolean, parent: Span): Promise<void> {
    initMemoryUsage();
    let rootuser: User = User.assign(Crypt.rootUser());
    const span: Span = Logger.otel.startSubSpan("message.QueueMessage", parent);
    try {
      Logger.instanse.debug("Ensure Indexes", span, { cls: "Housekeeping" });
      await Config.db.ensureindexes(span);
      if (Config.auto_hourly_housekeeping == false) {
        Logger.instanse.debug("HouseKeeping disabled, quit.", span, { cls: "Housekeeping" });
        return;
      }
      await HouseKeeping.runInstanceCleanup(rootuser, span);
      await HouseKeeping.validateBuiltinRoles(span);
      await HouseKeeping.removeUnvalidatedUsers(span);
      await HouseKeeping.cleanupOpenRPAInstances(span);
      await HouseKeeping.migrateToTimeseries(rootuser, span);
      await HouseKeeping.ensureSearchNames(span);
      await HouseKeeping.caclulateSizeAndUsage(skipCalculateSize, span);
      await HouseKeeping.updateUserSizeAndUsage(skipUpdateUserSize, span);
      await HouseKeeping.updateCustomerSizeAndUsage(skipUpdateUserSize, span);
      await HouseKeeping.ensureBuiltInUsersAndRoles(span);
    } catch (error) {
      Logger.instanse.error(error, span, { cls: "Housekeeping" });
    } finally {
      Logger.otel.endSpan(span);
      if (Config.auto_hourly_housekeeping == true) {
        logMemoryUsage('Housekeeping end', span);
      }      
    }
  }
  private static async runInstanceCleanup(rootuser: User, span: Span) {
    try {
      if (Logger.agentdriver != null) {
        try {
          Logger.instanse.debug("HouseKeeping Run InstanceCleanup", span, { cls: "Housekeeping" });
          await Logger.agentdriver.InstanceCleanup(span);
        } catch (error) {
          Logger.instanse.error(error, span, { cls: "Housekeeping" });
        }
        const jwt: string = Crypt.rootToken();
        var agents = await Config.db.query<iAgent>({ collectionname: "agents", query: { _type: "agent", "autostart": true }, jwt }, span);
        Logger.instanse.debug("HouseKeeping ensure " + agents.length + " agents", span, { cls: "Housekeeping" });

        for (let i = 0; i < agents.length; i++) {
          const agent = agents[i];
          var pods = await Logger.agentdriver.GetInstancePods(rootuser, jwt, agent, false, span);
          if (pods == null || pods.length == 0) {
            if (agent.name != agent.slug) {
              Logger.instanse.debug("HouseKeeping ensure " + agent.name + " (" + agent.slug + ")", span, { cls: "Housekeeping" });
            } else {
              Logger.instanse.debug("HouseKeeping ensure " + agent.name, span, { cls: "Housekeeping" });
            }
            try {
              await Logger.agentdriver.EnsureInstance(rootuser, jwt, agent, span);
            } catch (error) {
              Logger.instanse.error(error, span, { cls: "Housekeeping" });
            }
          }
        }
        logMemoryUsage('runInstanceCleanup', span);
      } else {
        Logger.instanse.warn("agentdriver is null, skip agent check", span, { cls: "Housekeeping" });
      }
    } catch (error) {
      Logger.instanse.error(error, span, { cls: "Housekeeping" });
    }
  }
  private static async validateBuiltinRoles(span: Span) {
    try {
      const jwt: string = Crypt.rootToken();
      Logger.instanse.debug("Begin validating builtin roles", span, { cls: "Housekeeping" });
      for (var i = 0; i < Config.db.WellknownIdsArray.length; i++) {
        const item: Role = await Config.db.GetOne<Role>({
          query: {
            _id: Config.db.WellknownIdsArray[i],
            "_type": "role"
          }, collectionname: "users", jwt
        }, span);
        if (item != null) {
          Logger.instanse.verbose("Save/validate " + item.name, span, { cls: "Housekeeping" });
          await Logger.DBHelper.Save(item, jwt, span);
        }
      }
      logMemoryUsage('validateBuiltinRoles', span);
    } catch (error) {
      Logger.instanse.error(error, span, { cls: "Housekeeping" });
    }
  }
  private static async removeUnvalidatedUsers(span: Span) {
    if (Config.housekeeping_remove_unvalidated_user_days > 0) {
      Logger.instanse.debug("Begin removing unvalidated users older than " + Config.housekeeping_remove_unvalidated_user_days + " days", span, { cls: "Housekeeping" });
      let todate = new Date();
      todate.setDate(todate.getDate() - 1);
      let fromdate = new Date();
      fromdate.setMonth(fromdate.getMonth() - 1);
      const jwt: string = Crypt.rootToken();

      let query = { "validated": false, "_type": "user", "_id": { "$ne": WellknownIds.root } };
      query["_modified"] = { "$lt": todate.toISOString(), "$gt": fromdate.toISOString() }
      let count = await Config.db.DeleteMany(query, null, "users", "", false, jwt, span);
      if (count > 0) {
        Logger.instanse.verbose("Removed " + count + " unvalidated users", span, { cls: "Housekeeping" });
      }
      logMemoryUsage('removeUnvalidatedUsers', span);
    }
  }
  private static async cleanupOpenRPAInstances(span: Span) {
    if (Config.housekeeping_cleanup_openrpa_instances == true) {
      Logger.instanse.debug("Begin cleaning up openrpa instances", span, { cls: "Housekeeping" });
      let msg = new UpdateManyMessage();
      msg.jwt = Crypt.rootToken();
      msg.collectionname = "openrpa_instances";
      msg.query = { "state": { "$in": ["idle", "running"] } };
      msg.item = { "$set": { "state": "completed" }, "$unset": { "xml": "" } } as any;
      let result = await Config.db.UpdateDocument(msg, span);
      if (result?.opresult?.nModified > 0) {
        Logger.instanse.verbose("Updated " + result.opresult.nModified + " openrpa instances", span, { cls: "Housekeeping" });
      } else if (result?.opresult?.modifiedCount > 0) {
        Logger.instanse.verbose("Updated " + result.opresult.modifiedCount + " openrpa instances", span, { cls: "Housekeeping" });
      }
    }
    logMemoryUsage('cleanupOpenRPAInstances', span);
  }
  private static async migrateToTimeseries(rootuser: User, span: Span) {
    Logger.instanse.debug("Begin validating prefered timeseries collections", span, { cls: "Housekeeping" });
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
              console.log("migrated " + counter + " of " + count + " audit records " + ((100 * counter) / count).toFixed(2) + "%");
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
      Logger.instanse.error(error, span, { cls: "Housekeeping" });
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
              console.log("migrated " + counter + " of " + count + " dbusage records " + ((100 * counter) / count).toFixed(2) + "%");
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
      Logger.instanse.error(error, span, { cls: "Housekeeping" });
    }
    logMemoryUsage('migrateToTimeseries', span);
  }
  private static async ensureSearchNames(span: Span) {
    Logger.instanse.debug("Begin ensuring searchnames", span, { cls: "Housekeeping" });
    for (let i = 0; i < DatabaseConnection.collections_with_text_index.length; i++) {
      let collectionname = DatabaseConnection.collections_with_text_index[i];
      if (DatabaseConnection.timeseries_collections.indexOf(collectionname) > -1) continue;
      if (DatabaseConnection.usemetadata(collectionname)) {
        let exists = await Config.db.db.collection(collectionname).findOne({ "metadata._searchnames": { $exists: false } });
        if (!NoderedUtil.IsNullUndefinded(exists)) {
          Logger.instanse.debug("Start creating metadata._searchnames for collection " + collectionname, span, { cls: "Housekeeping" });
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
          Logger.instanse.debug("Done creating _searchnames for collection " + collectionname, span, { cls: "Housekeeping" });
        }
      } else {
        let exists = await Config.db.db.collection(collectionname).findOne({ "_searchnames": { $exists: false } });
        if (!NoderedUtil.IsNullUndefinded(exists)) {
          Logger.instanse.debug("Start creating _searchnames for collection " + collectionname, span, { cls: "Housekeeping" });
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
          Logger.instanse.debug("Done creating _searchnames for collection " + collectionname, span, { cls: "Housekeeping" });
        }
      }
    }
    logMemoryUsage('ensureSearchNames', span);
  }
  private static async caclulateSizeAndUsage(skipCalculateSize: boolean, span: Span) {
    if (!skipCalculateSize) {
      Logger.instanse.debug("Begin calculating size and usage", span, { cls: "Housekeeping" });
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
      if (!NoderedUtil.IsNullEmpty(Config.housekeeping_skip_collections)) skip_collections = Config.housekeeping_skip_collections.split(",")
      for (let col of collections) {
        var n: string = col.name;
        if (n.endsWith(".chunks")) continue;
        if (skip_collections.indexOf(col.name) > -1) {
          Logger.instanse.debug("skipped " + col.name + " due to housekeeping_skip_collections setting", span, { cls: "Housekeeping" });
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
          Logger.instanse.error(error, span, { cls: "Housekeeping" });
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
              Logger.instanse.error(error, span, { cls: "Housekeeping" });
            }

          }
          totalusage += usage;
          try {
            await bulkInsert.execute();
            // if (items.length > 0) Logger.instanse.debug("[" + col.name + "][" + index + "/" + collections.length + "] add " + items.length + " items with a usage of " + formatBytes(usage), span, { cls: "Housekeeping" });
            if (usage > 0) Logger.instanse.debug("[" + col.name + "][" + index + "/" + collections.length + "] usage of " + formatBytes(usage), span, { cls: "Housekeeping" });

          } catch (error) {
            Logger.instanse.error(error, span, { cls: "Housekeeping" });
          }
      }
      Logger.instanse.debug("Add stats from " + collections.length + " collections with a total usage of " + formatBytes(totalusage), span, { cls: "Housekeeping" });
      logMemoryUsage('caclulateSizeAndUsage', span);
    }
  }
  private static async updateUserSizeAndUsage(skipUpdateUserSize: boolean, span: Span) {
    if (!skipUpdateUserSize) {
      Logger.instanse.debug("Begin updating all users dbusage field", span, { cls: "Housekeeping" });
      const timestamp = new Date(new Date().toISOString());
      timestamp.setUTCHours(0, 0, 0, 0);
      let index = 0;
      const fivedaysago = new Date(new Date().toISOString());;
      fivedaysago.setUTCHours(0, 0, 0, 0);
      fivedaysago.setDate(fivedaysago.getDate() - 5);

      const usercount = await Config.db.db.collection("users").aggregate([{ "$match": { "_type": "user", lastseen: { "$gte": fivedaysago } } }, { $count: "userCount" }]).toArray();
      if (usercount.length > 0) {
        Logger.instanse.debug("Begin updating all users (" + usercount[0].userCount + ") dbusage field", span, { cls: "Housekeeping" });
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
          Logger.instanse.debug("[" + index + "/" + usercount[0].userCount + "] " + u.name + " " + formatBytes(items[0].size) + " from " + items[0].count + " collections", span, { cls: "Housekeeping" });
          await Config.db.db.collection("users").updateOne({ _id: u._id }, { $set: { "dbusage": items[0].size } });
        }
        if (index % 100 == 0) {
          Logger.instanse.debug("[" + index + "/" + usercount[0].userCount + "] Processing", span, { cls: "Housekeeping" });
          logMemoryUsage('updateUserSizeAndUsage', span);
        }

      }
      Logger.instanse.debug("Completed updating all users dbusage field", span, { cls: "Housekeeping" });
      logMemoryUsage('updateUserSizeAndUsage', span);
    }
  }
  private static async updateCustomerSizeAndUsage(skipUpdateUserSize: boolean, span: Span) {
    if (Config.multi_tenant) {
      try {
        Logger.instanse.debug("Begin updating all customers dbusage field", span, { cls: "Housekeeping" });
        const usercount = await Config.db.db.collection("users").aggregate([{ "$match": { "_type": "customer" } }, { $count: "userCount" }]).toArray();
        if (usercount.length > 0) {
          Logger.instanse.debug("Begin updating all customers (" + usercount[0].userCount + ") dbusage field", span, { cls: "Housekeeping" });
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
          Logger.instanse.debug(c.name + " using " + formatBytes(dbusage), span, { cls: "Housekeeping" });
        }
        var sleep = (ms) => {
          return new Promise(resolve => { setTimeout(resolve, ms) })
        }
        await sleep(2000);

      } catch (error) {
        Logger.instanse.error(error, span, { cls: "Housekeeping" });
      }
      logMemoryUsage('updateCustomerSizeAndUsage - part 1', span);
    }
    if (Config.multi_tenant && !skipUpdateUserSize) {
      Logger.instanse.debug("Begin updating all customers dbusage field", span, { cls: "Housekeeping" });
      try {
        let index = 0;
        const usercount = await Config.db.db.collection("users").aggregate([{ "$match": { "_type": "customer" } }, { $count: "userCount" }]).toArray();
        if (usercount.length > 0) {
          Logger.instanse.debug("Begin updating all customers (" + usercount[0].userCount + ") dbusage field", span, { cls: "Housekeeping" });
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
                  Logger.instanse.debug("dbblocking " + c.name + " using " + formatBytes(c.dbusage) + " allowed is " + formatBytes(resource.defaultmetadata.dbusage), span, { cls: "Housekeeping" });
                  await Config.db.db.collection("users").updateMany({ customerid: c._id, "_type": "user" }, { $set: { "dblocked": true } as any });
                }
              } else if (c.dbusage <= resource.defaultmetadata.dbusage) {
                await Config.db.db.collection("users").updateOne({ "_id": c._id }, { $set: { "dblocked": false } });
                if (c.dblocked || !c.dblocked) {
                  Logger.instanse.debug("unblocking " + c.name + " using " + formatBytes(c.dbusage) + " allowed is " + formatBytes(resource.defaultmetadata.dbusage), span, { cls: "Housekeeping" });
                  await Config.db.db.collection("users").updateMany({ customerid: c._id, "_type": "user" }, { $set: { "dblocked": false } as any });
                }
              }
            } else if (config.product.customerassign != "metered") {
              let quota: number = resource.defaultmetadata.dbusage + (config.quantity * config.product.metadata.dbusage);
              if (c.dbusage > quota) {
                await Config.db.db.collection("users").updateOne({ "_id": c._id }, { $set: { "dblocked": true } });
                if (!c.dblocked || c.dblocked) {
                  Logger.instanse.debug("dbblocking " + c.name + " using " + formatBytes(c.dbusage) + " allowed is " + formatBytes(quota), span, { cls: "Housekeeping" });
                  await Config.db.db.collection("users").updateMany({ customerid: c._id, "_type": "user" }, { $set: { "dblocked": true } as any });
                }
              } else if (c.dbusage <= quota) {
                await Config.db.db.collection("users").updateOne({ "_id": c._id }, { $set: { "dblocked": false } });
                if (c.dblocked || !c.dblocked) {
                  Logger.instanse.debug("unblocking " + c.name + " using " + formatBytes(c.dbusage) + " allowed is " + formatBytes(quota), span, { cls: "Housekeeping" });
                  await Config.db.db.collection("users").updateMany({ customerid: c._id, "_type": "user" }, { $set: { "dblocked": false } as any });
                }
              }
            } else if (config.product.customerassign == "metered") {
              let billabledbusage: number = c.dbusage - resource.defaultmetadata.dbusage;
              if (billabledbusage > 0) {
                const billablecount = Math.ceil(billabledbusage / config.product.metadata.dbusage);

                Logger.instanse.debug("Add usage_record for " + c.name + " using " + formatBytes(billabledbusage) + " equal to " + billablecount + " units of " + formatBytes(config.product.metadata.dbusage), span, { cls: "Housekeeping" });
                const dt = parseInt((new Date().getTime() / 1000).toFixed(0))
                const payload: any = { "quantity": billablecount, "timestamp": dt };
                if (!NoderedUtil.IsNullEmpty(config.siid) && !NoderedUtil.IsNullEmpty(c.stripeid)) {
                  try {
                    await Message.Stripe("POST", "usage_records", config.siid, payload, c.stripeid);
                  } catch (error) {
                    if (error.response && error.response.body) {
                      Logger.instanse.error("Update usage record error!" + error.response.body, span, { cls: "Housekeeping" });
                    } else {
                      Logger.instanse.error("Update usage record error!" + error, span, { cls: "Housekeeping" });
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
              Logger.instanse.debug("[" + index + "/" + usercount[0].userCount + "] Processing", span, { cls: "Housekeeping" });
              logMemoryUsage('updateCustomerSizeAndUsage', span);
            }
          }
          Logger.instanse.debug("Completed updating all customers dbusage field", span, { cls: "Housekeeping" });


          const pipe2 = [
            { "$match": { "_type": "user", "$or": [{ "customerid": { $exists: false } }, { "customerid": "" }] } },
            { "$project": { "name": 1, "dbusage": 1, "dblocked": 1 } }];
          const cursor2 = await Config.db.db.collection("users").aggregate(pipe2);
          for await (const c of cursor2) {
            if (Config.db.WellknownIdsArray.indexOf(c._id) > -1) continue;
            if (c.dbusage == null) c.dbusage = 0;
            if (c.dbusage > resource.defaultmetadata.dbusage) {
              Logger.instanse.debug("dbblocking " + c.name + " using " + formatBytes(c.dbusage) + " allowed is " + formatBytes(resource.defaultmetadata.dbusage), span, { cls: "Housekeeping" });
              await Config.db.db.collection("users").updateOne({ "_id": c._id }, { $set: { "dblocked": true } });
            } else {
              if (c.dblocked) {
                await Config.db.db.collection("users").updateOne({ "_id": c._id }, { $set: { "dblocked": false } });
                Logger.instanse.debug("unblocking " + c.name + " using " + formatBytes(c.dbusage) + " allowed is " + formatBytes(resource.defaultmetadata.dbusage), span, { cls: "Housekeeping" });
              }

            }
          }
          Logger.instanse.debug("Completed updating all users without a customer dbusage field", span, { cls: "Housekeeping" });
        }
        logMemoryUsage('Housekeeping end', span);
      } catch (error) {
        if (error.response && error.response.body) {
          Logger.instanse.error(error.response.body, span, { cls: "Housekeeping" });
        } else {
          Logger.instanse.error(error, span, { cls: "Housekeeping" });
        }
      } finally {
        Logger.instanse.debug("Completed housekeeping", span, { cls: "Housekeeping" });
      }
      logMemoryUsage('updateCustomerSizeAndUsage - part 2', span);
    }
  }
  public static async ensureBuiltInUsersAndRoles(span: Span) {
    Logger.instanse.debug("Begin validating built in users and roles", span, { cls: "Housekeeping" });
    const jwt: string = Crypt.rootToken();
    const admins: Role = await Logger.DBHelper.EnsureRole(jwt, "admins", WellknownIds.admins, span);
    const users: Role = await Logger.DBHelper.EnsureRole(jwt, "users", WellknownIds.users, span);
    const root: User = await Logger.DBHelper.EnsureUser(jwt, "root", "root", WellknownIds.root, null, null, span);

    Base.addRight(root, WellknownIds.admins, "admins", [Rights.full_control]);
    Base.removeRight(root, WellknownIds.admins, [Rights.delete]);
    Base.addRight(root, WellknownIds.root, "root", [Rights.full_control]);
    Base.removeRight(root, WellknownIds.root, [Rights.delete]);
    await Logger.DBHelper.Save(root, jwt, span);

    const guest: User = await Logger.DBHelper.EnsureUser(jwt, "guest", "guest", "65cb30c40ff51e174095573c", null, null, span);
    Base.removeRight(guest, "65cb30c40ff51e174095573c", [Rights.full_control]);
    Base.addRight(guest, "65cb30c40ff51e174095573c", "guest", [Rights.read]);
    await Logger.DBHelper.Save(guest, jwt, span);

    // const robot_agent_users: Role = await Logger.DBHelper.EnsureRole(jwt, "robot agent users", WellknownIds.robot_agent_users, span);
    // Base.addRight(robot_agent_users, WellknownIds.admins, "admins", [Rights.full_control]);
    // Base.removeRight(robot_agent_users, WellknownIds.admins, [Rights.delete]);
    // Base.addRight(robot_agent_users, WellknownIds.root, "root", [Rights.full_control]);
    // if (Config.multi_tenant) {
    //     Logger.instanse.silly("[root][users] Running in multi tenant mode, remove " + robot_agent_users.name + " from self", span);
    //     Base.removeRight(robot_agent_users, robot_agent_users._id, [Rights.full_control]);
    // } else if (Config.update_acl_based_on_groups) {
    //     Base.removeRight(robot_agent_users, robot_agent_users._id, [Rights.full_control]);
    //     Base.addRight(robot_agent_users, robot_agent_users._id, "robot agent users", [Rights.read]);
    // }
    // await Logger.DBHelper.Save(robot_agent_users, jwt, span);

    Base.addRight(admins, WellknownIds.admins, "admins", [Rights.full_control]);
    Base.removeRight(admins, WellknownIds.admins, [Rights.delete]);
    await Logger.DBHelper.Save(admins, jwt, span);

    Base.addRight(users, WellknownIds.admins, "admins", [Rights.full_control]);
    Base.removeRight(users, WellknownIds.admins, [Rights.delete]);
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


    // const personal_nodered_users: Role = await Logger.DBHelper.EnsureRole(jwt, "personal nodered users", WellknownIds.personal_nodered_users, span);
    // personal_nodered_users.AddMember(admins);
    // Base.addRight(personal_nodered_users, WellknownIds.admins, "admins", [Rights.full_control]);
    // Base.removeRight(personal_nodered_users, WellknownIds.admins, [Rights.delete]);
    // if (Config.multi_tenant) {
    //     Logger.instanse.silly("[root][users] Running in multi tenant mode, remove " + personal_nodered_users.name + " from self", span);
    //     Base.removeRight(personal_nodered_users, personal_nodered_users._id, [Rights.full_control]);
    // } else if (Config.update_acl_based_on_groups) {
    //     Base.removeRight(personal_nodered_users, personal_nodered_users._id, [Rights.full_control]);
    //     Base.addRight(personal_nodered_users, personal_nodered_users._id, "personal nodered users", [Rights.read]);
    // }
    // await Logger.DBHelper.Save(personal_nodered_users, jwt, span);
    // const nodered_admins: Role = await Logger.DBHelper.EnsureRole(jwt, "nodered admins", WellknownIds.nodered_admins, span);
    // nodered_admins.AddMember(admins);
    // Base.addRight(nodered_admins, WellknownIds.admins, "admins", [Rights.full_control]);
    // Base.removeRight(nodered_admins, WellknownIds.admins, [Rights.delete]);
    // await Logger.DBHelper.Save(nodered_admins, jwt, span);
    // const nodered_users: Role = await Logger.DBHelper.EnsureRole(jwt, "nodered users", WellknownIds.nodered_users, span);
    // nodered_users.AddMember(admins);
    // Base.addRight(nodered_users, WellknownIds.admins, "admins", [Rights.full_control]);
    // Base.removeRight(nodered_users, WellknownIds.admins, [Rights.delete]);
    // if (Config.multi_tenant) {
    //     Logger.instanse.silly("[root][users] Running in multi tenant mode, remove " + nodered_users.name + " from self", span);
    //     Base.removeRight(nodered_users, nodered_users._id, [Rights.full_control]);
    // } else if (Config.update_acl_based_on_groups) {
    //     Base.removeRight(nodered_users, nodered_users._id, [Rights.full_control]);
    //     Base.addRight(nodered_users, nodered_users._id, "nodered users", [Rights.read]);
    // }
    // await Logger.DBHelper.Save(nodered_users, jwt, span);
    // const nodered_api_users: Role = await Logger.DBHelper.EnsureRole(jwt, "nodered api users", WellknownIds.nodered_api_users, span);
    // nodered_api_users.AddMember(admins);
    // Base.addRight(nodered_api_users, WellknownIds.admins, "admins", [Rights.full_control]);
    // Base.removeRight(nodered_api_users, WellknownIds.admins, [Rights.delete]);
    // if (Config.multi_tenant) {
    //     Logger.instanse.silly("[root][users] Running in multi tenant mode, remove " + nodered_api_users.name + " from self", span);
    //     Base.removeRight(nodered_api_users, nodered_api_users._id, [Rights.full_control]);
    // } else if (Config.update_acl_based_on_groups) {
    //     Base.removeRight(nodered_api_users, nodered_api_users._id, [Rights.full_control]);
    //     Base.addRight(nodered_api_users, nodered_api_users._id, "nodered api users", [Rights.read]);
    // }
    // await Logger.DBHelper.Save(nodered_api_users, jwt, span);

    if (Config.multi_tenant) {
        try {
            const resellers: Role = await Logger.DBHelper.EnsureRole(jwt, "resellers", WellknownIds.resellers, span);
            // @ts-ignore
            resellers.hidemembers = true;
            Base.addRight(resellers, WellknownIds.admins, "admins", [Rights.full_control]);
            Base.removeRight(resellers, WellknownIds.admins, [Rights.delete]);
            Base.removeRight(resellers, WellknownIds.resellers, [Rights.full_control]);
            resellers.AddMember(admins);
            await Logger.DBHelper.Save(resellers, jwt, span);

            const customer_admins: Role = await Logger.DBHelper.EnsureRole(jwt, "customer admins", WellknownIds.customer_admins, span);
            // @ts-ignore
            customer_admins.hidemembers = true;
            Base.addRight(customer_admins, WellknownIds.admins, "admins", [Rights.full_control]);
            Base.removeRight(customer_admins, WellknownIds.admins, [Rights.delete]);
            Base.removeRight(customer_admins, WellknownIds.customer_admins, [Rights.full_control]);
            await Logger.DBHelper.Save(customer_admins, jwt, span);
        } catch (error) {
            Logger.instanse.error(error, span);
        }
    }


    // const robot_admins: Role = await Logger.DBHelper.EnsureRole(jwt, "robot admins", WellknownIds.robot_admins, span);
    // robot_admins.AddMember(admins);
    // Base.addRight(robot_admins, WellknownIds.admins, "admins", [Rights.full_control]);
    // Base.removeRight(robot_admins, WellknownIds.admins, [Rights.delete]);
    // await Logger.DBHelper.Save(robot_admins, jwt, span);
    // const robot_users: Role = await Logger.DBHelper.EnsureRole(jwt, "robot users", WellknownIds.robot_users, span);
    // robot_users.AddMember(admins);
    // robot_users.AddMember(users);
    // Base.addRight(robot_users, WellknownIds.admins, "admins", [Rights.full_control]);
    // Base.removeRight(robot_users, WellknownIds.admins, [Rights.delete]);
    // if (Config.multi_tenant) {
    //     Logger.instanse.silly("[root][users] Running in multi tenant mode, remove " + robot_users.name + " from self", span);
    //     Base.removeRight(robot_users, robot_users._id, [Rights.full_control]);
    // } else if (Config.update_acl_based_on_groups) {
    //     Base.removeRight(robot_users, robot_users._id, [Rights.full_control]);
    //     Base.addRight(robot_users, robot_users._id, "robot users", [Rights.read, Rights.invoke, Rights.update]);
    // }
    // await Logger.DBHelper.Save(robot_users, jwt, span);

    if (!admins.IsMember(root._id)) {
        admins.AddMember(root);
        await Logger.DBHelper.Save(admins, jwt, span);
    }

    const filestore_admins: Role = await Logger.DBHelper.EnsureRole(jwt, "filestore admins", WellknownIds.filestore_admins, span);
    filestore_admins.AddMember(admins);
    Base.addRight(filestore_admins, WellknownIds.admins, "admins", [Rights.full_control]);
    Base.removeRight(filestore_admins, WellknownIds.admins, [Rights.delete]);
    if (Config.multi_tenant) {
        Logger.instanse.silly("[root][users] Running in multi tenant mode, remove " + filestore_admins.name + " from self", span);
        Base.removeRight(filestore_admins, filestore_admins._id, [Rights.full_control]);
    }
    await Logger.DBHelper.Save(filestore_admins, jwt, span);
    const filestore_users: Role = await Logger.DBHelper.EnsureRole(jwt, "filestore users", WellknownIds.filestore_users, span);
    filestore_users.AddMember(admins);
    if (!Config.multi_tenant) {
        filestore_users.AddMember(users);
    }
    Base.addRight(filestore_users, WellknownIds.admins, "admins", [Rights.full_control]);
    Base.removeRight(filestore_users, WellknownIds.admins, [Rights.delete]);
    if (Config.multi_tenant) {
        Logger.instanse.silly("[root][users] Running in multi tenant mode, remove " + filestore_users.name + " from self", span);
        Base.removeRight(filestore_users, filestore_users._id, [Rights.full_control]);
    } else if (Config.update_acl_based_on_groups) {
        Base.removeRight(filestore_users, filestore_users._id, [Rights.full_control]);
        Base.addRight(filestore_users, filestore_users._id, "filestore users", [Rights.read]);
    }
    await Logger.DBHelper.Save(filestore_users, jwt, span);



    const workitem_queue_admins: Role = await Logger.DBHelper.EnsureRole(jwt, "workitem queue admins", "625440c4231309af5f2052cd", span);
    workitem_queue_admins.AddMember(admins);
    Base.addRight(workitem_queue_admins, WellknownIds.admins, "admins", [Rights.full_control]);
    Base.removeRight(workitem_queue_admins, WellknownIds.admins, [Rights.delete]);
    if (Config.multi_tenant) {
        Base.removeRight(workitem_queue_admins, WellknownIds.admins, [Rights.full_control]);
    }
    await Logger.DBHelper.Save(workitem_queue_admins, jwt, span);

    const workitem_queue_users: Role = await Logger.DBHelper.EnsureRole(jwt, "workitem queue users", "62544134231309e2cd2052ce", span);
    Base.addRight(workitem_queue_users, WellknownIds.admins, "admins", [Rights.full_control]);
    Base.removeRight(workitem_queue_users, WellknownIds.admins, [Rights.delete]);
    if (Config.multi_tenant) {
        Base.removeRight(workitem_queue_users, WellknownIds.admins, [Rights.full_control]);
    }
    await Logger.DBHelper.Save(workitem_queue_users, jwt, span);
  }
}
const formatBytes = (bytes, decimals = 2) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  if (bytes < 0) {
    bytes = bytes * -1;
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return "-" + parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  } else {
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
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
  // if (global.gc) {
  //   global.gc();
  // } else {
  //   console.warn('No GC hook! Start your program with `node --expose-gc file.js`.');
  // }
  const memoryUsage = process.memoryUsage();
  // Logger.instanse.debug(`Memory usage after ${label}:`, span, { cls: "Housekeeping" });
  // Logger.instanse.debug(`RSS: ${formatBytes(memoryUsage.rss)}`, span, { cls: "Housekeeping" });
  // Logger.instanse.debug(`Heap Total: ${formatBytes(memoryUsage.heapTotal)}`, span, { cls: "Housekeeping" });
  // Logger.instanse.debug(`Heap Used: ${formatBytes(memoryUsage.heapUsed)}`, span, { cls: "Housekeeping" });
  // Logger.instanse.debug(`External: ${formatBytes(memoryUsage.external)}`, span, { cls: "Housekeeping" });
  // Logger.instanse.debug(`Array Buffers: ${formatBytes(memoryUsage.arrayBuffers)}`, span, { cls: "Housekeeping" });
  Logger.instanse.debug(`Memory usage after ${label}:`, span, { cls: "Housekeeping" });
  Logger.instanse.debug(`RSS: ${formatBytes(memoryUsage.rss - rss)} now ${formatBytes(memoryUsage.rss)}`, span, { cls: "Housekeeping" });
  Logger.instanse.debug(`Heap Total: ${formatBytes(memoryUsage.heapTotal - heapTotal)} now ${formatBytes(memoryUsage.heapTotal)}`, span, { cls: "Housekeeping" });
  Logger.instanse.debug(`Heap Used: ${formatBytes(memoryUsage.heapUsed - heapUsed)} now ${formatBytes(memoryUsage.heapUsed)}`, span, { cls: "Housekeeping" });
  Logger.instanse.debug(`External: ${formatBytes(memoryUsage.external - external)} now ${formatBytes(memoryUsage.external)}`, span, { cls: "Housekeeping" });
  Logger.instanse.debug(`Array Buffers: ${formatBytes(memoryUsage.arrayBuffers - arrayBuffers)} now ${formatBytes(memoryUsage.arrayBuffers)}`, span, { cls: "Housekeeping" });
  rss = memoryUsage.rss;
  heapTotal = memoryUsage.heapTotal;
  heapUsed = memoryUsage.heapUsed;
  external = memoryUsage.external;
  arrayBuffers = memoryUsage.arrayBuffers;
  // fs.writeFileSync('memoryusage.txt', `Memory usage after ${label}:\nRSS: ${formatBytes(memoryUsage.rss)}\nHeap Total: ${formatBytes(memoryUsage.heapTotal)}\nHeap Used: ${formatBytes(memoryUsage.heapUsed)}\nExternal: ${formatBytes(memoryUsage.external)}\nArray Buffers: ${formatBytes(memoryUsage.arrayBuffers)}\n`, { flag: 'a' });
};
