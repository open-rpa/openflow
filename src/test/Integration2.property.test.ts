import { suite, test, timeout } from "@testdeck/mocha";
import assert from "assert";
import * as fc from "fast-check";
import { Auth } from "../Auth.js";
import { Audit } from "../Audit.js";
import { Config } from "../Config.js";
import { Crypt } from "../Crypt.js";
import { Logger } from "../Logger.js";
import { Util, Wellknown } from "../Util.js";
import { Base, Distro, Package, ResourceUsage, SFunc, Volume, Workspace } from "../commoninterfaces.js";
import { testConfig } from "./testConfig.js";

const arbIp = fc.tuple(
    fc.integer({ min: 1, max: 254 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 1, max: 254 })
).map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);
const arbAgent = fc.constantFrom("node" as const, "browser" as const, "openrpa" as const, "nodered" as const, "test" as const);
const arbVersion = fc.tuple(
    fc.integer({ min: 1, max: 9 }),
    fc.integer({ min: 0, max: 99 }),
    fc.integer({ min: 0, max: 99 })
).map(([a, b, c]) => `${a}.${b}.${c}`);
const arbName = fc.stringMatching(/^[a-zA-Z0-9_ -]{1,40}$/);

@suite class audit_property_tests {
    @timeout(30000)
    async before() {
        await testConfig.configure();
    }
    async after() {
        await testConfig.cleanup();
    }

    @timeout(30000)
    @test async "LoginSuccess with generated IPs and agents"() {
        await fc.assert(fc.asyncProperty(arbIp, arbAgent, arbVersion, async (ip, agent, version) => {
            await Audit.LoginSuccess(testConfig.testUser, "local", "local", ip, agent, version, null);
        }), { numRuns: 15 });
    }

    @timeout(20000)
    @test async "LoginFailed with generated usernames and IPs"() {
        await fc.assert(fc.asyncProperty(arbName, arbIp, arbAgent, arbVersion, async (username, ip, agent, version) => {
            await Audit.LoginFailed(username, "local", "local", ip, agent, version, null);
        }), { numRuns: 15 });
    }

    @timeout(20000)
    @test async "ImpersonateSuccess and ImpersonateFailed"() {
        await fc.assert(fc.asyncProperty(arbAgent, arbVersion, async (agent, version) => {
            await Audit.ImpersonateSuccess(testConfig.testUser, Crypt.rootUser(), agent, version, null);
            await Audit.ImpersonateFailed(testConfig.testUser, Crypt.rootUser(), agent, version, null);
        }), { numRuns: 10 });
    }

    @timeout(20000)
    @test async "CloudAgentAction with generated images"() {
        await fc.assert(fc.asyncProperty(
            arbName,
            fc.constantFrom("createdeployment", "deletedeployment", "scaleup", "scaledown"),
            fc.constantFrom("openiap/nodered", "openiap/nodered:latest", "registry/org/image:v1.2.3", "simpleimage"),
            fc.boolean(),
            async (name, type, image, success) => {
                await Audit.CloudAgentAction(testConfig.testUser, success, name, type, image, name, null);
            }
        ), { numRuns: 15 });
    }

    @timeout(20000)
    @test async "IssueLicense with generated domains"() {
        await fc.assert(fc.asyncProperty(
            fc.stringMatching(/^[a-z]{3,15}\.(openiap\.io|example\.com)$/),
            arbIp,
            fc.integer({ min: 1, max: 36 }),
            fc.boolean(),
            async (domain, ip, months, success) => {
                await Audit.IssueLicense(
                    testConfig.testUser.username, testConfig.testUser._id,
                    null, ip, domain, months, success,
                    success ? null : "test error", null
                );
            }
        ), { numRuns: 10 });
    }

    @timeout(20000)
    @test async "AuditCollectionAction with generated collection names"() {
        await fc.assert(fc.asyncProperty(
            fc.constantFrom("create", "drop", "rename"),
            fc.stringMatching(/^test_[a-z]{3,15}$/),
            fc.boolean(),
            async (action, collection, success) => {
                await Audit.AuditCollectionAction(testConfig.testUser, action, collection, success, null);
            }
        ), { numRuns: 10 });
    }

    @timeout(20000)
    @test async "AuditWorkspaceAction with generated workspaces"() {
        await fc.assert(fc.asyncProperty(
            fc.constantFrom("create", "delete", "update"),
            arbName,
            fc.boolean(),
            async (action, name, success) => {
                const ws = new Workspace();
                ws.name = name;
                ws._id = Util.GetUniqueIdentifier(24);
                await Audit.AuditWorkspaceAction(testConfig.testUser, action, ws, success, null);
            }
        ), { numRuns: 10 });
    }

    @timeout(20000)
    @test async "AuditVolumeAction with generated volumes"() {
        await fc.assert(fc.asyncProperty(arbName, fc.boolean(), async (name, success) => {
            const vol = new Volume();
            vol.name = name;
            vol._id = Util.GetUniqueIdentifier(24);
            vol._workspaceid = Util.GetUniqueIdentifier(24);
            await Audit.AuditVolumeAction(testConfig.testUser, "create", vol, success, null);
        }), { numRuns: 10 });
    }

    @timeout(20000)
    @test async "AuditFuncAction with generated funcs"() {
        await fc.assert(fc.asyncProperty(arbName, fc.boolean(), async (name, success) => {
            const func = new SFunc();
            func.name = name;
            func._id = Util.GetUniqueIdentifier(24);
            await Audit.AuditFuncAction(testConfig.testUser, "deploy", func, success, null);
        }), { numRuns: 10 });
    }

    @timeout(20000)
    @test async "AuditDistroAction and AuditPackageAction"() {
        await fc.assert(fc.asyncProperty(arbName, fc.boolean(), async (name, success) => {
            const distro = new Distro();
            distro.name = name;
            distro._id = Util.GetUniqueIdentifier(24);
            await Audit.AuditDistroAction(testConfig.testUser, "create", distro, success, null);

            const pkg = new Package();
            pkg.name = name;
            pkg._id = Util.GetUniqueIdentifier(24);
            await Audit.AuditPackageAction(testConfig.testUser, "install", pkg, success, null);
        }), { numRuns: 10 });
    }

    @timeout(20000)
    @test async "AuditResourceAction with and without resourceusage"() {
        await fc.assert(fc.asyncProperty(arbName, fc.boolean(), async (name, withUsage) => {
            const target = new Base();
            target.name = name;
            target._id = Util.GetUniqueIdentifier(24);

            if (withUsage) {
                const usage = new ResourceUsage();
                usage.name = "usage_" + name;
                usage._id = Util.GetUniqueIdentifier(24);
                usage.product = { name: "test product", stripeprice: "price_123" } as any;
                await Audit.AuditResourceAction(testConfig.testUser, "assign", target, usage, true, null);
            } else {
                await Audit.AuditResourceAction(testConfig.testUser, "unassign", target, null, true, null);
            }
        }), { numRuns: 10 });
    }

    @timeout(20000)
    @test async "AuditWorkitemPurge"() {
        await fc.assert(fc.asyncProperty(arbName, async (name) => {
            const wiq = new Base();
            wiq.name = name;
            wiq._id = Util.GetUniqueIdentifier(24);
            await Audit.AuditWorkitemPurge(testConfig.testUser, wiq, null);
        }), { numRuns: 10 });
    }
}

@suite class auth_token_property_tests {
    @timeout(30000)
    async before() {
        await testConfig.configure();
    }
    async after() {
        await testConfig.cleanup();
    }

    @timeout(10000)
    @test async "Id2Token creates valid token that decodes back"() {
        await fc.assert(fc.asyncProperty(
            fc.constantFrom("1h", "12h", "1d", "7d"),
            async (expiry) => {
                const jwt = await Auth.Id2Token(testConfig.testUser._id, null, null, expiry, null);
                assert.ok(!Util.IsNullEmpty(jwt));
                const decoded = Crypt.decryptToken(jwt);
                assert.strictEqual(decoded.data._id, testConfig.testUser._id);
            }
        ), { numRuns: 10 });
    }

    @timeout(10000)
    @test async "User2Token creates valid token from User object"() {
        await fc.assert(fc.asyncProperty(
            fc.constantFrom("1h", "12h", "1d"),
            async (expiry) => {
                const jwt = await Auth.User2Token(testConfig.testUser, expiry, null);
                assert.ok(!Util.IsNullEmpty(jwt));
                const decoded = Crypt.decryptToken(jwt);
                assert.strictEqual(decoded.data._id, testConfig.testUser._id);
            }
        ), { numRuns: 10 });
    }

    @timeout(20000)
    @test async "Token2User roundtrips for test user"() {
        const jwt = Crypt.createToken(testConfig.testUser, "1h");
        const user = await Auth.Token2User(jwt, null);
        assert.ok(user != null);
        assert.strictEqual(user._id, testConfig.testUser._id);
        assert.strictEqual(user.username, testConfig.testUser.username);
    }

    @timeout(10000)
    @test async "Token2User handles bearer prefix"() {
        const jwt = Crypt.createToken(testConfig.testUser, "1h");
        const user = await Auth.Token2User("Bearer " + jwt, null);
        assert.ok(user != null);
        assert.strictEqual(user._id, testConfig.testUser._id);
    }

    @timeout(10000)
    @test async "Token2User should not crash on garbage tokens"() {
        // BUG: Token2User throws TypeError when OAuthProvider.instance is null
        // because Auth.ts:125 accesses OAuthProvider.instance.oidc without null check
        await fc.assert(fc.asyncProperty(
            fc.string({ minLength: 10, maxLength: 50 }).filter(s => !s.includes(".")),
            async (garbage) => {
                const result = await Auth.Token2User(garbage, null);
                assert.ok(result == null || result.username === "guest");
            }
        ), { numRuns: 10 });
    }

    @timeout(10000)
    @test async "Token2User with empty token returns guest or throws"() {
        if (Config.enable_guest) {
            const result = await Auth.Token2User("", null);
            assert.strictEqual(result.username, "guest");
        } else {
            await assert.rejects(Auth.Token2User("", null));
        }
    }
}

@suite class dbhelper_extended_property_tests {
    @timeout(30000)
    async before() {
        await testConfig.configure();
    }
    @timeout(10000)
    async after() {
        await testConfig.cleanup();
    }

    @timeout(20000)
    @test async "FindRoleByName returns null for nonexistent roles"() {
        await fc.assert(fc.asyncProperty(
            fc.stringMatching(/^nonexistent_role_[a-z0-9]{10,15}$/),
            async (roleName) => {
                const role = await Logger.DBHelper.FindRoleByName(roleName, null, null);
                assert.strictEqual(role, null);
            }
        ), { numRuns: 20 });
    }

    @timeout(20000)
    @test async "FindRoleById returns null for nonexistent ids"() {
        await fc.assert(fc.asyncProperty(
            fc.stringMatching(/^[0-9a-f]{24}$/),
            async (fakeId) => {
                const role = await Logger.DBHelper.FindRoleById(fakeId, null, null);
                assert.strictEqual(role, null);
            }
        ), { numRuns: 20 });
    }

    @timeout(20000)
    @test async "FindById returns null for nonexistent ids"() {
        await fc.assert(fc.asyncProperty(
            fc.stringMatching(/^[0-9a-f]{24}$/),
            async (fakeId) => {
                const user = await Logger.DBHelper.FindById(fakeId, null);
                assert.strictEqual(user, null);
            }
        ), { numRuns: 20 });
    }

    @timeout(30000)
    @test async "EnsureUser is idempotent"() {
        const username = "testprop_idempotent_" + Util.GetUniqueIdentifier(8);
        const user1 = await Logger.DBHelper.EnsureUser(
            Crypt.rootToken(), username, username, null, "Pass123!", null, null
        );
        const user2 = await Logger.DBHelper.EnsureUser(
            Crypt.rootToken(), username, username, null, "Pass123!", null, null
        );
        assert.strictEqual(user1._id, user2._id, "EnsureUser created duplicate user");
        await Config.db.DeleteOne(user1._id, "users", false, Crypt.rootToken(), null);
    }

    @timeout(30000)
    @test async "EnsureRole is idempotent"() {
        const roleName = "testrole_idempotent_" + Util.GetUniqueIdentifier(8);
        const role1 = await Logger.DBHelper.EnsureRole(roleName, null, null);
        const role2 = await Logger.DBHelper.EnsureRole(roleName, null, null);
        assert.strictEqual(role1._id, role2._id, "EnsureRole created duplicate role");
        await Config.db.DeleteOne(role1._id, "users", false, Crypt.rootToken(), null);
    }

    @timeout(30000)
    @test async "DecorateWithRoles always returns user with roles"() {
        await fc.assert(fc.asyncProperty(
            fc.stringMatching(/^testdecorate_[a-z0-9]{5,10}$/),
            async (username) => {
                let user = await Logger.DBHelper.EnsureUser(
                    Crypt.rootToken(), username, username, null, "Pass123!", null, null
                );
                user.roles = [];
                user = await Logger.DBHelper.DecorateWithRoles(user, null);
                assert.ok(user.roles.length > 0, "DecorateWithRoles returned no roles for user " + username);
                await Config.db.DeleteOne(user._id, "users", false, Crypt.rootToken(), null);
            }
        ), { numRuns: 5 });
    }

    @timeout(20000)
    @test async "Save user updates persist"() {
        const username = "testsave_" + Util.GetUniqueIdentifier(8);
        let user = await Logger.DBHelper.EnsureUser(
            Crypt.rootToken(), username, username, null, "Pass123!", null, null
        );

        await fc.assert(fc.asyncProperty(
            fc.stringMatching(/^[a-zA-Z ]{2,30}$/),
            async (newName) => {
                user.name = newName;
                await Logger.DBHelper.Save(user, Crypt.rootToken(), null);
                const found = await Logger.DBHelper.FindById(user._id, null);
                assert.strictEqual(found.name, newName);
            }
        ), { numRuns: 10 });

        await Config.db.DeleteOne(user._id, "users", false, Crypt.rootToken(), null);
    }
}
// clear && ./node_modules/.bin/_mocha "src/test/**/Integration2.property.test.ts"
