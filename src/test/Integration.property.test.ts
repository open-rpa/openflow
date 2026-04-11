import { suite, test, timeout } from "@testdeck/mocha";
import assert from "assert";
import * as fc from "fast-check";
import { Config } from "../Config.js";
import { Crypt } from "../Crypt.js";
import { Logger } from "../Logger.js";
import { Util } from "../Util.js";
import { Base, Rights, Role, Rolemember, User } from "../commoninterfaces.js";
import { testConfig } from "./testConfig.js";

const arbName = fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0);
const arbEntityName = fc.stringMatching(/^[a-zA-Z0-9_ \-\u00C0-\u024F]{1,60}$/);
const arbType = fc.constantFrom("test_property", "test_prop_a", "test_prop_b", "test_prop_c");

@suite class db_crud_property_tests {
    @timeout(30000)
    async before() {
        await testConfig.configure();
        // clean up any leftover test entities
        await Config.db.DeleteMany({ _type: { $regex: /^test_prop/ } }, null, "entities", null, false, Crypt.rootToken(), null);
    }
    @timeout(10000)
    async after() {
        await Config.db.DeleteMany({ _type: { $regex: /^test_prop/ } }, null, "entities", null, false, Crypt.rootToken(), null);
        await testConfig.cleanup();
    }

    @timeout(30000)
    @test async "InsertOne with generated names then query back"() {
        await fc.assert(fc.asyncProperty(arbEntityName, arbType, async (name, type) => {
            let item = new Base();
            item.name = name;
            item._type = type;
            item = await Config.db.InsertOne(item, "entities", 1, true, testConfig.userToken, null);
            assert.ok(!Util.IsNullEmpty(item._id), "Insert returned no _id");
            assert.strictEqual(item.name, name, "Name mismatch after insert");
            assert.strictEqual(item._type, type);
            assert.strictEqual(item._version, 0);

            // Query it back
            const results = await Config.db.query<Base>({
                collectionname: "entities",
                query: { _id: item._id },
                top: 1,
                jwt: testConfig.userToken
            }, null);
            assert.strictEqual(results.length, 1);
            assert.strictEqual(results[0].name, name);

            // Cleanup
            await Config.db.DeleteOne(item._id, "entities", false, testConfig.userToken, null);
        }), { numRuns: 30 });
    }

    @timeout(30000)
    @test async "UpdateOne with generated names"() {
        await fc.assert(fc.asyncProperty(arbEntityName, arbEntityName, async (name1, name2) => {
            fc.pre(name1 !== name2);
            let item = new Base();
            item.name = name1;
            item._type = "test_property";
            item = await Config.db.InsertOne(item, "entities", 1, true, testConfig.userToken, null);
            assert.strictEqual(item._version, 0);

            item.name = name2;
            item = await Config.db.UpdateOne(item, "entities", 1, true, testConfig.userToken, null);
            assert.strictEqual(item.name, name2, "Name not updated");
            assert.strictEqual(item._version, 1);

            await Config.db.DeleteOne(item._id, "entities", false, testConfig.userToken, null);
        }), { numRuns: 20 });
    }

    @timeout(30000)
    @test async "InsertMany with generated items"() {
        await fc.assert(fc.asyncProperty(
            fc.array(arbEntityName, { minLength: 2, maxLength: 10 }),
            async (names) => {
                const items = names.map(n => {
                    const b = new Base();
                    b.name = n;
                    b._type = "test_property";
                    return b;
                });
                const inserted = await Config.db.InsertMany(items, "entities", 1, true, testConfig.userToken, null);
                assert.strictEqual(inserted.length, names.length);
                for (let i = 0; i < inserted.length; i++) {
                    assert.ok(!Util.IsNullEmpty(inserted[i]._id));
                    assert.strictEqual(inserted[i].name, names[i]);
                }

                // Clean up
                const ids = inserted.map(x => x._id);
                await Config.db.DeleteMany({ _id: { $in: ids } }, null, "entities", null, false, testConfig.userToken, null);
            }
        ), { numRuns: 10 });
    }

    @timeout(30000)
    @test async "query with generated type filters"() {
        // Insert items with different types
        const typeA = new Base(); typeA.name = "typeA"; typeA._type = "test_prop_a";
        const typeB = new Base(); typeB.name = "typeB"; typeB._type = "test_prop_b";
        await Config.db.InsertOne(typeA, "entities", 1, true, testConfig.userToken, null);
        await Config.db.InsertOne(typeB, "entities", 1, true, testConfig.userToken, null);

        await fc.assert(fc.asyncProperty(
            fc.constantFrom("test_prop_a", "test_prop_b", "test_prop_nonexistent"),
            async (type) => {
                const results = await Config.db.query<Base>({
                    collectionname: "entities",
                    query: { _type: type },
                    top: 100,
                    jwt: testConfig.userToken
                }, null);
                for (const item of results) {
                    assert.strictEqual(item._type, type, "Query returned wrong type");
                }
                if (type === "test_prop_nonexistent") {
                    assert.strictEqual(results.length, 0);
                }
            }
        ), { numRuns: 20 });
    }

    @timeout(15000)
    @test async "count matches query results"() {
        // Insert a few items
        for (let i = 0; i < 5; i++) {
            const b = new Base(); b.name = "count_test_" + i; b._type = "test_prop_c";
            await Config.db.InsertOne(b, "entities", 1, true, testConfig.userToken, null);
        }

        const count = await Config.db.count({
            collectionname: "entities",
            query: { _type: "test_prop_c" },
            jwt: testConfig.userToken
        }, null);
        const items = await Config.db.query<Base>({
            collectionname: "entities",
            query: { _type: "test_prop_c" },
            top: 1000,
            jwt: testConfig.userToken
        }, null);
        assert.strictEqual(count, items.length, "count() and query().length disagree");
    }

    @timeout(15000)
    @test async "GetDocumentVersion with generated updates"() {
        await fc.assert(fc.asyncProperty(
            fc.array(arbEntityName, { minLength: 2, maxLength: 5 }),
            async (names) => {
                let item = new Base();
                item.name = names[0];
                item._type = "test_property";
                item = await Config.db.InsertOne(item, "entities", 1, true, testConfig.userToken, null);

                for (let i = 1; i < names.length; i++) {
                    item.name = names[i];
                    item = await Config.db.UpdateOne(item, "entities", 1, true, testConfig.userToken, null);
                    assert.strictEqual(item._version, i);
                }

                // Verify we can fetch any version
                for (let v = 0; v < names.length; v++) {
                    const historic = await Config.db.GetDocumentVersion({
                        collectionname: "entities",
                        id: item._id,
                        version: v,
                        jwt: testConfig.userToken
                    }, null);
                    assert.strictEqual(historic.name, names[v], `Version ${v} name mismatch`);
                    assert.strictEqual(historic._version, v);
                }

                await Config.db.DeleteOne(item._id, "entities", false, testConfig.userToken, null);
            }
        ), { numRuns: 5 });
    }
}

@suite class db_permission_property_tests {
    @timeout(30000)
    async before() {
        await testConfig.configure();
    }
    async after() {
        await testConfig.cleanup();
    }

    @timeout(20000)
    @test async "items created by user are visible to user but ACL-restricted items are not"() {
        await fc.assert(fc.asyncProperty(arbEntityName, async (name) => {
            // Create as testuser
            let item = new Base();
            item.name = name;
            item._type = "test_property";
            item = await Config.db.InsertOne(item, "entities", 1, true, testConfig.userToken, null);

            // testuser can see it
            let results = await Config.db.query<Base>({
                collectionname: "entities",
                query: { _id: item._id },
                top: 1,
                jwt: testConfig.userToken
            }, null);
            assert.strictEqual(results.length, 1, "User cannot see own item");

            // root can see it
            results = await Config.db.query<Base>({
                collectionname: "entities",
                query: { _id: item._id },
                top: 1,
                jwt: Crypt.rootToken()
            }, null);
            assert.strictEqual(results.length, 1, "Root cannot see user's item");

            await Config.db.DeleteOne(item._id, "entities", false, testConfig.userToken, null);
        }), { numRuns: 15 });
    }
}

@suite class dbhelper_property_tests {
    @timeout(30000)
    async before() {
        await testConfig.configure();
    }
    @timeout(10000)
    async after() {
        await testConfig.cleanup();
    }

    @timeout(30000)
    @test async "EnsureUser with generated usernames"() {
        await fc.assert(fc.asyncProperty(
            fc.stringMatching(/^testprop_[a-z0-9]{5,15}$/),
            async (username) => {
                let user = await Logger.DBHelper.EnsureUser(
                    Crypt.rootToken(), username, username, null, "TestPassword123!", null, null
                );
                assert.ok(!Util.IsNullEmpty(user._id));
                assert.strictEqual(user.username, username);

                // Can find by username
                const found = await Logger.DBHelper.FindByUsername(username, Crypt.rootToken(), null);
                assert.ok(found != null, "EnsureUser created user but FindByUsername can't find it");
                assert.strictEqual(found.username, username);

                // Can find by id
                const foundById = await Logger.DBHelper.FindById(user._id, null);
                assert.ok(foundById != null);

                // Cleanup
                await Config.db.DeleteOne(user._id, "users", false, Crypt.rootToken(), null);
            }
        ), { numRuns: 10 });
    }

    @timeout(30000)
    @test async "EnsureRole with generated role names"() {
        await fc.assert(fc.asyncProperty(
            fc.stringMatching(/^testrole_[a-z0-9]{5,15}$/),
            async (roleName) => {
                const role = await Logger.DBHelper.EnsureRole(roleName, null, null);
                assert.ok(!Util.IsNullEmpty(role._id));
                assert.strictEqual(role.name, roleName);

                const found = await Logger.DBHelper.FindRoleByName(roleName, null, null);
                assert.ok(found != null, "EnsureRole created role but FindRoleByName can't find it");

                const foundById = await Logger.DBHelper.FindRoleById(role._id, null, null);
                assert.ok(foundById != null);

                await Config.db.DeleteOne(role._id, "users", false, Crypt.rootToken(), null);
            }
        ), { numRuns: 10 });
    }

    @timeout(20000)
    @test async "FindByUsername returns null for nonexistent users"() {
        await fc.assert(fc.asyncProperty(
            fc.stringMatching(/^nonexistent_[a-z0-9]{10,20}$/),
            async (username) => {
                const user = await Logger.DBHelper.FindByUsername(username, Crypt.rootToken(), null);
                assert.strictEqual(user, null);
            }
        ), { numRuns: 20 });
    }
}

@suite class auth_property_tests {
    @timeout(30000)
    async before() {
        await testConfig.configure();
    }
    async after() {
        await testConfig.cleanup();
    }

    @timeout(30000)
    @test async "ValidateByPassword rejects wrong passwords"() {
        const { Auth } = await import("../Auth.js");
        await fc.assert(fc.asyncProperty(
            fc.string({ minLength: 1, maxLength: 50 }).filter(s => s !== testConfig.testPassword && s.trim().length > 0),
            async (wrongPassword) => {
                const result = await Auth.ValidateByPassword(
                    testConfig.testUser.username, wrongPassword, null
                );
                assert.strictEqual(result, null, "ValidateByPassword accepted wrong password: " + wrongPassword);
            }
        ), { numRuns: 10 }); // bcrypt is slow
    }

    @timeout(10000)
    @test async "ValidateByPassword rejects nonexistent usernames"() {
        const { Auth } = await import("../Auth.js");
        await fc.assert(fc.asyncProperty(
            fc.stringMatching(/^fake_[a-z0-9]{10,20}$/),
            async (fakeUser) => {
                const result = await Auth.ValidateByPassword(fakeUser, "anypassword", null);
                assert.strictEqual(result, null);
            }
        ), { numRuns: 10 });
    }
}
// clear && ./node_modules/.bin/_mocha "src/test/**/Integration.property.test.ts"
