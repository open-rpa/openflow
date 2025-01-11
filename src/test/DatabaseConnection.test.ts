import { suite, test, timeout } from "@testdeck/mocha";
import assert from "assert";
import { Base } from "../commoninterfaces.js";
import { Config } from "../Config.js";
import { Crypt } from "../Crypt.js";
import { Util, Wellknown } from "../Util.js";
import { testConfig } from "./testConfig.js";

@suite class databaseConnection_test {
    @timeout(50000)
    async before() {
        await testConfig.configure();
    }
    async after() {
        await testConfig.cleanup();
    }
    // @timeout(50000)
    // @test async "dbconstructor"() {
    //     try {
    //         var db = new DatabaseConnection(Config.mongodb_url, Config.mongodb_db, false);
    //         await db.connect(null);
    //         // db.shutdown();
    //     } catch (error) {
    //         console.error(error);            
    //     }
    //     console.log("completed");
    // }
    @timeout(5000)
    @test async "indextest"() {
        // await Config.db.ensureindexes(null)
        let indexes = await Config.db.db.collection("entities").indexes();
        let indexnames = indexes.map(x => x.name);
        if (indexnames.indexOf("test_index") !== -1) {
            await Config.db.deleteIndex("entities", "test_index", null);
        }
        await Config.db.createIndex("entities", "test_index", { "myname": 1 }, null, null);
        indexes = await Config.db.db.collection("entities").indexes();
        indexnames = indexes.map(x => x.name);
        assert.notStrictEqual(indexnames.indexOf("test_index"), -1, "test_index not found after being created");
        await Config.db.deleteIndex("entities", "test_index", null);
        indexes = await Config.db.db.collection("entities").indexes();
        indexnames = indexes.map(x => x.name);
        assert.strictEqual(indexnames.indexOf("test_index"), -1, "test_index was found after being deleted");

    }

    @test async "ListCollections"() {
        var rootcollections = await Config.db.ListCollections(false, Crypt.rootToken());
        rootcollections = rootcollections.filter(x => x.name.indexOf("system.") === -1);
        assert.notDeepStrictEqual(rootcollections, null);
        assert.notDeepStrictEqual(rootcollections.length, 0);
    }
    @test async "DropCollections"() {
        const colname = "testcollection"
        var rootcollections = await Config.db.ListCollections(false, Crypt.rootToken());
        rootcollections = rootcollections.filter(x => x.name.indexOf("system.") === -1);
        assert.notDeepStrictEqual(rootcollections, null);
        assert.notDeepStrictEqual(rootcollections.length, 0);
        var exists = rootcollections.filter(x => x.name == colname);
        if (exists.length > 0) {
            await Config.db.DropCollection(colname, Crypt.rootToken(), null);
        }
        var item = new Base(); item.name = "test item";
        await Config.db.InsertOne(item, colname, 1, true, Crypt.rootToken(), null);

        var rootcollections = await Config.db.ListCollections(false, Crypt.rootToken());
        exists = rootcollections.filter(x => x.name == colname);
        assert.notDeepStrictEqual(exists.length, 0);
        await Config.db.DropCollection(colname, Crypt.rootToken(), null);
    }
    @test async "query"() {
        var items = await Config.db.query<Base>({ collectionname: "users", query: {}, top: 5, jwt: Crypt.rootToken() }, null);
        assert.notDeepStrictEqual(items, null);
        assert.strictEqual(items.length, 5);
        items = await Config.db.query<Base>({ collectionname: "users", query: { "_type": "role" }, top: 5, jwt: Crypt.rootToken() }, null);
        for (var item of items) {
            assert.strictEqual(item._type, "role");
        }
        var ids = items.map(x => x._id);
        items = await Config.db.query<Base>({ collectionname: "users", query: { "_type": "role" }, top: 5, skip: 5, jwt: Crypt.rootToken() }, null);
        assert.strictEqual(items.length, 5);
        for (var item of items) {
            assert.strictEqual(ids.indexOf(item._id), -1, "Got id that should have been skipped!");
        }
        items = await Config.db.query<Base>({ collectionname: "users", query: { "_type": "role" }, projection: { "_id": 1, "name": 1 }, top: 5, skip: 5, jwt: Crypt.rootToken() }, null);
        for (var item of items) {
            assert.strictEqual(item._acl, undefined, "Projection failed for _acl");
            assert.strictEqual(item._type, undefined, "Projection failed for _type");
        }

        items = await Config.db.query<Base>({ collectionname: "users", query: { "_id": Wellknown.admins._id }, top: 5, jwt: Crypt.rootToken() }, null);
        assert.strictEqual(items.length, 1, "Root cannot see admins role!");

        items = await Config.db.query<Base>({ collectionname: "users", query: { "_id": Wellknown.admins._id }, top: 5, jwt: Crypt.rootToken(), queryas: testConfig.testUser._id }, null);
        assert.strictEqual(items.length, 0, "demouser should not be able to see admins role!");

        items = await Config.db.query<Base>({ collectionname: "users", query: { "_id": Wellknown.admins._id }, top: 5, jwt: testConfig.userToken }, null);
        assert.strictEqual(items.length, 0, "demouser should not be able to see admins role!");

        items = await Config.db.query<Base>({ collectionname: "users", query: { "_id": Wellknown.admins._id }, top: 5, jwt: testConfig.userToken, queryas: Wellknown.root._id }, null);
        assert.strictEqual(items.length, 0, "demouser should not be able to see admins role!");

        items = await Config.db.query<Base>({ collectionname: "files", query: {}, top: 5, jwt: Crypt.rootToken() }, null);
        assert.strictEqual(items.length, 5, "Root did not find any files");
    }
    @timeout(5000)
    @test async "count"() {
        var usercount = await Config.db.count({ collectionname: "users", query: { "_type": "user" }, jwt: Crypt.rootToken() }, null);
        assert.notDeepStrictEqual(usercount, null);
        assert.notStrictEqual(usercount, 0);
        var rolecount = await Config.db.count({ collectionname: "users", query: { "_type": "role" }, jwt: Crypt.rootToken() }, null);
        assert.notDeepStrictEqual(rolecount, null);
        assert.notStrictEqual(rolecount, 0);
        // assert.notStrictEqual(usercount, rolecount);
    }
    @timeout(5000)
    @test async "GetDocumentVersion"() {
        let item = new Base(); item.name = "item version 0";
        item = await Config.db.InsertOne(item, "entities", 1, true, testConfig.userToken, null);
        assert.notDeepStrictEqual(item, null);
        assert.strictEqual(Util.IsNullEmpty(item._id), false);
        assert.strictEqual(item.name, "item version 0");
        assert.strictEqual(item._version, 0);

        await new Promise(resolve => { setTimeout(resolve, 1000) })
        item.name = "item version 1";
        item = await Config.db.UpdateOne(item, "entities", 1, true, testConfig.userToken, null);
        assert.strictEqual(item.name, "item version 1");
        assert.strictEqual(item._version, 1);
        item.name = "item version 2";
        item = await Config.db.UpdateOne(item, "entities", 1, true, testConfig.userToken, null);
        assert.strictEqual(item.name, "item version 2");
        assert.strictEqual(item._version, 2);
        let testitem = await Config.db.GetDocumentVersion({ collectionname: "entities", id: item._id, version: 1, jwt: testConfig.userToken }, null);
        assert.strictEqual(testitem.name, "item version 1");
        assert.strictEqual(testitem._version, 1);
        testitem = await Config.db.GetDocumentVersion({ collectionname: "entities", id: item._id, version: 0, jwt: testConfig.userToken }, null);
        assert.strictEqual(testitem.name, "item version 0");
        assert.strictEqual(testitem._version, 0);
        testitem = await Config.db.GetDocumentVersion({ collectionname: "entities", id: item._id, version: 2, jwt: testConfig.userToken }, null);
        assert.strictEqual(testitem.name, "item version 2");
        assert.strictEqual(testitem._version, 2);
    }
    @test async "getbyid"() {
        var user = await Config.db.getbyid(testConfig.testUser._id, "users", testConfig.userToken, true, null);
        assert.notDeepStrictEqual(user, null);
        assert.strictEqual(user._id, testConfig.testUser._id);
        user = await Config.db.getbyid(Wellknown.root._id, "users", Crypt.rootToken(), true, null);
        assert.notDeepStrictEqual(user, null);
        assert.strictEqual(user._id, Wellknown.root._id);
        user = await Config.db.getbyid(Wellknown.root._id, "users", testConfig.userToken, true, null);
        assert.strictEqual(user, null);
    }
    @test async "aggregate"() {
        var userssize = await Config.db.aggregate([
            {
                "$project": {
                    "_modifiedbyid": 1,
                    "object_size": {
                        "$bsonSize": "$$ROOT"
                    }
                }
            },
            {
                "$group": {
                    "_id": "$_modifiedbyid",
                    "size": {
                        "$sum": "$object_size"
                    }
                }
            }
        ], "users", Crypt.rootToken(), null, null, false, null);

        assert.notDeepStrictEqual(userssize, null);
        assert.notDeepStrictEqual(userssize.length, 0);
        assert.ok(!Util.IsNullEmpty(userssize[0]._id));
        assert.ok((userssize[0] as any).size > 0);
    }
    @timeout(5000)
    @test async "Many"() {
        await Config.db.DeleteMany({}, null, "entities", null, false, testConfig.userToken, null);
        await new Promise(resolve => { setTimeout(resolve, 1000) })
        var items = await Config.db.query({ query: {}, collectionname: "entities", top: 100, jwt: testConfig.userToken }, null);
        assert.notDeepStrictEqual(items, null);
        assert.strictEqual(items.length, 0);
        items = [];
        for (let i = 0; i < 50; i++) {
            let item = new Base(); item.name = "Item " + i;
            items.push(item);
        }
        items = await Config.db.InsertMany(items, "entities", 1, true, testConfig.userToken, null);
        assert.notDeepStrictEqual(items, null);
        assert.strictEqual(items.length, 50);
        assert.strictEqual(items[0].name, "Item 0");
        assert.ok(!Util.IsNullEmpty(items[0]._id));
        await new Promise(resolve => { setTimeout(resolve, 1000) })
        await Config.db.DeleteMany({}, null, "entities", null, false, testConfig.userToken, null);
        await new Promise(resolve => { setTimeout(resolve, 1000) })
        var items = await Config.db.query({ query: {}, collectionname: "entities", top: 100, jwt: testConfig.userToken }, null);
        assert.notDeepStrictEqual(items, null);
        assert.strictEqual(items.length, 0);
    }
    @test async "updatedoc"() {
        var item = new Base(); item.name = "test item";
        item = await Config.db.InsertOne(item, "entities", 1, true, testConfig.userToken, null);
        assert.notDeepStrictEqual(item, null);
        assert.strictEqual(item.name, "test item");
        assert.ok(!Util.IsNullEmpty(item._id));
        assert.strictEqual(item._version, 0);

        let updateDoc = { "$set": { "name": "test item updated" } };
        await Config.db.UpdateDocument({ "_id": item._id }, updateDoc as any, "entities", 1, true, testConfig.userToken, null);
        await new Promise(resolve => { setTimeout(resolve, 1000) })
        item = await Config.db.getbyid(item._id, "entities", testConfig.userToken, true, null);

        assert.notDeepStrictEqual(item, null);
        assert.strictEqual(item.name, "test item updated");
        assert.ok(!Util.IsNullEmpty(item._id));
        assert.strictEqual(item._version, 1);
        // await Config.db.DeleteOne(item._id, "entities", false, testConfig.userToken, null);
    }
}
// clear && ./node_modules/.bin/_mocha "src/test/DatabaseConnection.test.ts"
