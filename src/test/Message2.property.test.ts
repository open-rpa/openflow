import { DeleteManyMessage, GetDocumentVersionMessage, InsertOrUpdateOneMessage, ListCollectionsMessage } from "@openiap/openflow-api";
import { suite, test, timeout } from "@testdeck/mocha";
import assert from "assert";
import * as fc from "fast-check";
import { Config } from "../Config.js";
import { Crypt } from "../Crypt.js";
import { Message } from "../Messages/Message.js";
import { Util } from "../Util.js";
import { Base } from "../commoninterfaces.js";
import { testConfig } from "./testConfig.js";

const arbEntityName = fc.stringMatching(/^[a-zA-Z0-9_ \-]{1,60}$/);

@suite class message_extra_property_tests {
    @timeout(30000)
    async before() {
        await testConfig.configure();
        await Config.db.DeleteMany({ _type: { $regex: /^test_msg2/ } }, null, "entities", null, false, Crypt.rootToken(), null);
    }
    @timeout(10000)
    async after() {
        await Config.db.DeleteMany({ _type: { $regex: /^test_msg2/ } }, null, "entities", null, false, Crypt.rootToken(), null);
        await testConfig.cleanup();
    }

    @timeout(10000)
    @test async "ListCollections via Message returns entities and audit"() {
        var q: any = new ListCollectionsMessage();
        var msg = new Message();
        msg.jwt = Crypt.rootToken();
        msg.data = JSON.stringify(q);
        await msg.EnsureJWT(null, false);
        await msg["ListCollections"](null);
        q = JSON.parse(msg.data);
        assert.ok(Array.isArray(q.result), "ListCollections should return array");
        const names = q.result.map(c => c.name);
        assert.ok(names.includes("entities"), "entities collection missing");
        assert.ok(names.includes("audit"), "audit collection missing");
    }

    @timeout(20000)
    @test async "GetDocumentVersion via Message"() {
        // Insert and update an item with delay for history creation
        let item = new Base(); item.name = "version_msg_test"; item._type = "test_msg2_a";
        item = await Config.db.InsertOne(item, "entities", 1, true, testConfig.userToken, null);
        assert.strictEqual(item._version, 0);
        await new Promise(resolve => setTimeout(resolve, 2000));
        item.name = "version_msg_test_v1";
        item = await Config.db.UpdateOne(item, "entities", 1, true, testConfig.userToken, null);
        assert.strictEqual(item._version, 1);

        // Fetch version 1 (the update)
        var q: any = new GetDocumentVersionMessage();
        q.collectionname = "entities";
        q.id = item._id;
        q.version = 1;
        var msg = new Message();
        msg.jwt = testConfig.userToken;
        msg.data = JSON.stringify(q);
        await msg.EnsureJWT(null, false);
        await msg["GetDocumentVersion"](null);
        q = JSON.parse(msg.data);
        assert.ok(!Util.IsNullUndefinded(q.result), "no result for version 1");
        assert.strictEqual(q.result._version, 1);
        assert.strictEqual(q.result.name, "version_msg_test_v1");
    }

    @timeout(20000)
    @test async "InsertOrUpdateOne via Message - insert then update"() {
        await fc.assert(fc.asyncProperty(arbEntityName, arbEntityName, async (name1, name2) => {
            fc.pre(name1 !== name2);
            // Insert
            var q: any = new InsertOrUpdateOneMessage();
            q.collectionname = "entities";
            q.item = { name: name1, _type: "test_msg2_b" };
            q.uniqeness = "name,_type";
            var msg = new Message();
            msg.jwt = testConfig.userToken;
            msg.data = JSON.stringify(q);
            await msg.EnsureJWT(null, false);
            await msg["InsertOrUpdateOne"](null);
            q = JSON.parse(msg.data);
            assert.ok(!Util.IsNullUndefinded(q.result), "insert failed");
            const id = q.result._id;

            // Update via upsert with same uniqeness
            q = new InsertOrUpdateOneMessage();
            q.collectionname = "entities";
            q.item = { name: name1, _type: "test_msg2_b", extra: name2 };
            q.uniqeness = "name,_type";
            msg = new Message();
            msg.jwt = testConfig.userToken;
            msg.data = JSON.stringify(q);
            await msg.EnsureJWT(null, false);
            await msg["InsertOrUpdateOne"](null);
            q = JSON.parse(msg.data);
            assert.ok(!Util.IsNullUndefinded(q.result), "upsert failed");
            assert.strictEqual(q.result._id, id, "upsert created new doc instead of updating");

            await Config.db.DeleteOne(id, "entities", false, testConfig.userToken, null);
        }), { numRuns: 5 });
    }

    @timeout(15000)
    @test async "DeleteMany via Message with generated types"() {
        // Insert some items
        for (let i = 0; i < 5; i++) {
            await Config.db.InsertOne({ name: "delmany_" + i, _type: "test_msg2_c" }, "entities", 1, true, testConfig.userToken, null);
        }

        var q: any = new DeleteManyMessage();
        q.collectionname = "entities";
        q.query = { _type: "test_msg2_c" };
        var msg = new Message();
        msg.jwt = testConfig.userToken;
        msg.data = JSON.stringify(q);
        await msg.EnsureJWT(null, false);
        await msg["DeleteMany"](null);
        q = JSON.parse(msg.data);
        assert.ok(!Util.IsNullUndefinded(q), "msg data missing");
        assert.ok(Util.IsNullUndefinded(q.error), q.error);
        assert.ok(q.affectedrows >= 5, "DeleteMany did not delete enough rows");

        // Verify gone
        const remaining = await Config.db.query({ collectionname: "entities", query: { _type: "test_msg2_c" }, top: 100, jwt: testConfig.userToken }, null);
        assert.strictEqual(remaining.length, 0);
    }

    @timeout(10000)
    @test async "DeleteMany rejects agents collection"() {
        var q: any = new DeleteManyMessage();
        q.collectionname = "agents";
        q.query = { _type: "test" };
        var msg = new Message();
        msg.jwt = testConfig.userToken;
        msg.data = JSON.stringify(q);
        await msg.EnsureJWT(null, false);
        try {
            await msg["DeleteMany"](null);
            q = JSON.parse(msg.data);
            assert.fail("DeleteMany on agents should throw");
        } catch (e) {
            assert.ok(e.message.includes("Access denied"));
        }
    }
}
// clear && ./node_modules/.bin/_mocha "src/test/**/Message2.property.test.ts"
