import { InsertOrUpdateOneMessage, UpdateManyMessage } from "@openiap/openflow-api";
import { suite, test, timeout } from "@testdeck/mocha";
import assert from "assert";
import * as fc from "fast-check";
import { Config } from "../Config.js";
import { Crypt } from "../Crypt.js";
import { Util } from "../Util.js";
import { Base } from "../commoninterfaces.js";
import { testConfig } from "./testConfig.js";

const arbEntityName = fc.stringMatching(/^[a-zA-Z0-9_ \-]{1,60}$/);

@suite class db_extended_property_tests {
    @timeout(30000)
    async before() {
        await testConfig.configure();
        await Config.db.DeleteMany({ _type: { $regex: /^test_db2/ } }, null, "entities", null, false, Crypt.rootToken(), null);
    }
    @timeout(10000)
    async after() {
        await Config.db.DeleteMany({ _type: { $regex: /^test_db2/ } }, null, "entities", null, false, Crypt.rootToken(), null);
        await testConfig.cleanup();
    }

    @timeout(20000)
    @test async "GetOne returns single item"() {
        await fc.assert(fc.asyncProperty(arbEntityName, async (name) => {
            let item = new Base(); item.name = name; item._type = "test_db2_a";
            item = await Config.db.InsertOne(item, "entities", 1, true, testConfig.userToken, null);

            const found = await Config.db.GetOne<Base>({
                query: { _id: item._id },
                collectionname: "entities",
                jwt: testConfig.userToken
            }, null);
            assert.ok(found != null, "GetOne returned null");
            assert.strictEqual(found.name, name);
            assert.strictEqual(found._id, item._id);

            await Config.db.DeleteOne(item._id, "entities", false, testConfig.userToken, null);
        }), { numRuns: 10 });
    }

    @timeout(10000)
    @test async "GetOne returns null for nonexistent"() {
        const found = await Config.db.GetOne<Base>({
            query: { _id: "000000000000000000000000" },
            collectionname: "entities",
            jwt: testConfig.userToken
        }, null);
        assert.strictEqual(found, null);
    }

    @timeout(20000)
    @test async "distinct returns unique values"() {
        // Insert items with overlapping values
        for (let i = 0; i < 3; i++) {
            await Config.db.InsertOne({ name: "dist_a", _type: "test_db2_b", tag: "alpha" } as any, "entities", 1, true, testConfig.userToken, null);
        }
        await Config.db.InsertOne({ name: "dist_b", _type: "test_db2_b", tag: "beta" } as any, "entities", 1, true, testConfig.userToken, null);

        const result = await Config.db.distinct({
            field: "tag",
            query: { _type: "test_db2_b" },
            collectionname: "entities",
            jwt: testConfig.userToken
        }, null);
        assert.ok(Array.isArray(result));
        assert.ok(result.includes("alpha"));
        assert.ok(result.includes("beta"));
        assert.strictEqual(result.filter(v => v === "alpha").length, 1, "distinct returned duplicate alpha");
    }

    @timeout(20000)
    @test async "InsertOrUpdateOne upserts correctly"() {
        await fc.assert(fc.asyncProperty(arbEntityName, async (name) => {
            // First call inserts
            const item1 = await Config.db.InsertOrUpdateOne(
                { name, _type: "test_db2_c", counter: 1 } as any,
                "entities", "name,_type", 1, true, testConfig.userToken, null
            );
            assert.ok(!Util.IsNullEmpty(item1._id));

            // Second call with same uniqeness updates
            const item2 = await Config.db.InsertOrUpdateOne(
                { name, _type: "test_db2_c", counter: 2 } as any,
                "entities", "name,_type", 1, true, testConfig.userToken, null
            );
            assert.strictEqual(item2._id, item1._id, "Should update, not insert");
            assert.strictEqual((item2 as any).counter, 2);

            await Config.db.DeleteOne(item1._id, "entities", false, testConfig.userToken, null);
        }), { numRuns: 5 });
    }

    @timeout(15000)
    @test async "UpdateDocument with $set"() {
        let item = new Base(); item.name = "updatedoc_test"; item._type = "test_db2_d";
        item = await Config.db.InsertOne(item, "entities", 1, true, testConfig.userToken, null);

        await fc.assert(fc.asyncProperty(arbEntityName, async (newName) => {
            await Config.db.UpdateDocument(
                { _id: item._id },
                { $set: { name: newName } } as any,
                "entities", 1, true, testConfig.userToken, null
            );
            const found = await Config.db.getbyid(item._id, "entities", testConfig.userToken, true, null);
            assert.strictEqual(found.name, newName);
        }), { numRuns: 10 });
    }

    @timeout(20000)
    @test async "getbyusername finds test user"() {
        const user = await Config.db.getbyusername(
            testConfig.testUser.username, null, Crypt.rootToken(), true, null
        );
        assert.ok(user != null);
        assert.strictEqual((user as any).username, testConfig.testUser.username);
    }

    @timeout(10000)
    @test async "getbyusername returns null for nonexistent"() {
        await fc.assert(fc.asyncProperty(
            fc.stringMatching(/^nonexistent_user_[a-z0-9]{8,15}$/),
            async (username) => {
                const user = await Config.db.getbyusername(username, null, Crypt.rootToken(), true, null);
                assert.strictEqual(user, null);
            }
        ), { numRuns: 10 });
    }
}
// clear && ./node_modules/.bin/_mocha "src/test/**/DatabaseConnection2.test.ts"
