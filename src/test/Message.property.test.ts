import { AggregateMessage, CountMessage, InsertManyMessage, InsertOneMessage, QueryMessage, DeleteOneMessage, UpdateOneMessage } from "@openiap/openflow-api";
import { suite, test, timeout } from "@testdeck/mocha";
import assert from "assert";
import * as fc from "fast-check";
import { Config } from "../Config.js";
import { Crypt } from "../Crypt.js";
import { Logger } from "../Logger.js";
import { Message } from "../Messages/Message.js";
import { Util } from "../Util.js";
import { testConfig } from "./testConfig.js";

const arbEntityName = fc.stringMatching(/^[a-zA-Z0-9_ \-]{1,60}$/);
const arbType = fc.constantFrom("test_msg_a", "test_msg_b", "test_msg_c");

@suite class message_query_property_tests {
    @timeout(30000)
    async before() {
        await testConfig.configure();
    }
    async after() {
        await testConfig.cleanup();
    }

    @timeout(20000)
    @test async "Query via Message with generated type filters"() {
        await fc.assert(fc.asyncProperty(
            fc.constantFrom("test_msg_a", "test_msg_nonexistent"),
            async (type) => {
                var q: any = new QueryMessage();
                q.collectionname = "entities";
                q.query = { _type: type };
                q.top = 100;
                var msg = new Message();
                msg.jwt = testConfig.userToken;
                msg.data = JSON.stringify(q);
                await msg.EnsureJWT(null, false);
                await msg["Query"](null);
                q = JSON.parse(msg.data);
                assert.ok(!Util.IsNullUndefinded(q), "msg data missing");
                assert.ok(Util.IsNullUndefinded(q.error), q.error);
                if (Array.isArray(q.result)) {
                    for (const item of q.result) {
                        assert.strictEqual(item._type, type, "Query returned wrong type");
                    }
                }
            }
        ), { numRuns: 10 });
    }

    @timeout(20000)
    @test async "Query via Message rejects without jwt"() {
        var q: any = new QueryMessage();
        q.collectionname = "entities";
        q.query = {};
        var msg = new Message();
        msg.data = JSON.stringify(q);
        await msg["Query"](null);
        q = JSON.parse(msg.data);
        assert.ok(!Util.IsNullUndefinded(q.error), "Query without jwt should error");
    }

    @timeout(20000)
    @test async "Count via Message with generated queries"() {
        await fc.assert(fc.asyncProperty(arbType, async (type) => {
            var q: any = new CountMessage();
            q.collectionname = "entities";
            q.query = { _type: type };
            var msg = new Message();
            msg.jwt = testConfig.userToken;
            msg.data = JSON.stringify(q);
            await msg.EnsureJWT(null, false);
            await msg["Count"](null);
            q = JSON.parse(msg.data);
            assert.ok(!Util.IsNullUndefinded(q), "msg data missing");
            assert.ok(Util.IsNullUndefinded(q.error), q.error);
            assert.ok(typeof q.result === "number", "Count should return a number");
            assert.ok(q.result >= 0);
        }), { numRuns: 10 });
    }

    @timeout(20000)
    @test async "InsertOne via Message with generated names"() {
        await fc.assert(fc.asyncProperty(arbEntityName, async (name) => {
            var q: any = new InsertOneMessage();
            q.collectionname = "entities";
            q.item = { name, _type: "test_msg_a" };
            var msg = new Message();
            msg.jwt = testConfig.userToken;
            msg.data = JSON.stringify(q);
            await msg.EnsureJWT(null, false);
            await msg["InsertOne"](null);
            q = JSON.parse(msg.data);
            assert.ok(!Util.IsNullUndefinded(q), "msg data missing");
            assert.ok(Util.IsNullUndefinded(q.error), q.error);
            assert.ok(!Util.IsNullUndefinded(q.result), "no result");
            assert.strictEqual(q.result.name, name);

            // Clean up
            await Config.db.DeleteOne(q.result._id, "entities", false, testConfig.userToken, null);
        }), { numRuns: 15 });
    }

    @timeout(20000)
    @test async "UpdateOne via Message with generated names"() {
        await fc.assert(fc.asyncProperty(arbEntityName, arbEntityName, async (name1, name2) => {
            fc.pre(name1 !== name2);
            // Insert first
            let item = { name: name1, _type: "test_msg_a" } as any;
            item = await Config.db.InsertOne(item, "entities", 1, true, testConfig.userToken, null);

            // Update via Message
            var q: any = new UpdateOneMessage();
            q.collectionname = "entities";
            item.name = name2;
            q.item = item;
            var msg = new Message();
            msg.jwt = testConfig.userToken;
            msg.data = JSON.stringify(q);
            await msg.EnsureJWT(null, false);
            await msg["UpdateOne"](null);
            q = JSON.parse(msg.data);
            assert.ok(!Util.IsNullUndefinded(q), "msg data missing");
            assert.ok(Util.IsNullUndefinded(q.error), q.error);
            assert.strictEqual(q.result.name, name2);

            await Config.db.DeleteOne(item._id, "entities", false, testConfig.userToken, null);
        }), { numRuns: 10 });
    }

    @timeout(20000)
    @test async "DeleteOne via Message"() {
        await fc.assert(fc.asyncProperty(arbEntityName, async (name) => {
            let item = { name, _type: "test_msg_a" } as any;
            item = await Config.db.InsertOne(item, "entities", 1, true, testConfig.userToken, null);

            var q: any = new DeleteOneMessage();
            q.collectionname = "entities";
            q.id = item._id;
            var msg = new Message();
            msg.jwt = testConfig.userToken;
            msg.data = JSON.stringify(q);
            await msg.EnsureJWT(null, false);
            await msg["DeleteOne"](null);
            q = JSON.parse(msg.data);
            assert.ok(!Util.IsNullUndefinded(q), "msg data missing");
            assert.ok(Util.IsNullUndefinded(q.error), q.error);

            // Verify deleted
            const found = await Config.db.getbyid(item._id, "entities", testConfig.userToken, true, null);
            assert.strictEqual(found, null, "Item still exists after delete");
        }), { numRuns: 10 });
    }

    @timeout(20000)
    @test async "InsertMany via Message with generated items"() {
        await fc.assert(fc.asyncProperty(
            fc.array(arbEntityName, { minLength: 2, maxLength: 5 }),
            async (names) => {
                var q: any = new InsertManyMessage();
                q.collectionname = "entities";
                q.items = names.map(n => ({ name: n, _type: "test_msg_b" }));
                q.skipresults = false;
                var msg = new Message();
                msg.jwt = testConfig.userToken;
                msg.data = JSON.stringify(q);
                await msg.EnsureJWT(null, false);
                await msg["InsertMany"](null);
                q = JSON.parse(msg.data);
                assert.ok(!Util.IsNullUndefinded(q), "msg data missing");
                assert.ok(Util.IsNullUndefinded(q.error), q.error);
                assert.ok(Array.isArray(q.results), "no results array");
                assert.strictEqual(q.results.length, names.length);

                // Clean up
                const ids = q.results.map(r => r._id);
                await Config.db.DeleteMany({ _id: { $in: ids } }, null, "entities", null, false, testConfig.userToken, null);
            }
        ), { numRuns: 5 });
    }

    @timeout(20000)
    @test async "Aggregate via Message"() {
        // Insert some items
        for (let i = 0; i < 3; i++) {
            await Config.db.InsertOne({ name: "agg_test_" + i, _type: "test_msg_c", value: i * 10 }, "entities", 1, true, testConfig.userToken, null);
        }

        var q: any = new AggregateMessage();
        q.collectionname = "entities";
        q.aggregates = [
            { $match: { _type: "test_msg_c" } },
            { $group: { _id: "$_type", count: { $sum: 1 } } }
        ];
        var msg = new Message();
        msg.jwt = testConfig.userToken;
        msg.data = JSON.stringify(q);
        await msg.EnsureJWT(null, false);
        await msg["Aggregate"](null);
        q = JSON.parse(msg.data);
        assert.ok(!Util.IsNullUndefinded(q), "msg data missing");
        assert.ok(Array.isArray(q.result));
        assert.ok(q.result.length > 0);
        assert.ok(q.result[0].count >= 3);

        // Clean up
        await Config.db.DeleteMany({ _type: "test_msg_c" }, null, "entities", null, false, testConfig.userToken, null);
    }
}

@suite class dbhelper_cache_property_tests {
    @timeout(30000)
    async before() {
        await testConfig.configure();
    }
    async after() {
        await testConfig.cleanup();
    }

    @timeout(10000)
    @test async "GetProviders returns at least local provider"() {
        const providers = await Logger.DBHelper.GetProviders(null);
        assert.ok(Array.isArray(providers));
        assert.ok(providers.length > 0, "No providers returned");
        // Each provider should have a logo
        for (const p of providers) {
            assert.ok(!Util.IsNullEmpty((p as any).logo), "Provider missing logo: " + (p as any).name);
        }
    }

    @timeout(10000)
    @test async "GetEntityRestrictions returns array with admin restriction"() {
        const restrictions = await Logger.DBHelper.GetEntityRestrictions(null);
        assert.ok(Array.isArray(restrictions));
        assert.ok(restrictions.length > 0, "No restrictions returned");
    }

    @timeout(10000)
    @test async "GetResources returns array"() {
        const resources = await Logger.DBHelper.GetResources(null);
        assert.ok(Array.isArray(resources));
    }

    @timeout(10000)
    @test async "GetResourceUsageByUserID returns array for test user"() {
        const usage = await Logger.DBHelper.GetResourceUsageByUserID(testConfig.testUser._id, null);
        assert.ok(Array.isArray(usage));
    }

    @timeout(10000)
    @test async "FindQueueByName returns null for nonexistent queue"() {
        await fc.assert(fc.asyncProperty(
            fc.stringMatching(/^nonexistent_queue_[a-z0-9]{8,12}$/),
            async (name) => {
                const q = await Logger.DBHelper.FindQueueByName(name, Crypt.rootToken(), null);
                assert.strictEqual(q, null);
            }
        ), { numRuns: 10 });
    }

    @timeout(10000)
    @test async "FindExchangeByName returns null for nonexistent exchange"() {
        await fc.assert(fc.asyncProperty(
            fc.stringMatching(/^nonexistent_exchange_[a-z0-9]{8,12}$/),
            async (name) => {
                const ex = await Logger.DBHelper.FindExchangeByName(name, Crypt.rootToken(), null);
                assert.strictEqual(ex, null);
            }
        ), { numRuns: 10 });
    }

    @timeout(10000)
    @test async "FindAgentBySlugOrId returns null for nonexistent agents"() {
        await fc.assert(fc.asyncProperty(
            fc.stringMatching(/^[0-9a-f]{24}$/),
            async (fakeId) => {
                const agent = await Logger.DBHelper.FindAgentBySlugOrId(fakeId, Crypt.rootToken(), null);
                assert.strictEqual(agent, null);
            }
        ), { numRuns: 10 });
    }
}
// clear && ./node_modules/.bin/_mocha "src/test/**/Message.property.test.ts"
