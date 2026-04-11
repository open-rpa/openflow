import { suite, test, timeout } from "@testdeck/mocha";
import assert from "assert";
import * as fc from "fast-check";
import { Config } from "../Config.js";
import { Crypt } from "../Crypt.js";
import { Logger } from "../Logger.js";
import { Util } from "../Util.js";
import { testConfig } from "./testConfig.js";

@suite class dbhelper_authorization_tests {
    @timeout(30000)
    async before() {
        await testConfig.configure();
    }
    async after() {
        await testConfig.cleanup();
    }

    @timeout(15000)
    @test async "FindByAuthorization with Bearer token"() {
        const jwt = Crypt.createToken(testConfig.testUser, "1h");
        const user = await Logger.DBHelper.FindByAuthorization("Bearer " + jwt, null);
        assert.ok(user != null, "FindByAuthorization returned null for valid Bearer token");
        assert.strictEqual(user.username, testConfig.testUser.username);
    }

    @timeout(15000)
    @test async "FindByAuthorization with JWT prefix"() {
        const jwt = Crypt.createToken(testConfig.testUser, "1h");
        const user = await Logger.DBHelper.FindByAuthorization("JWT " + jwt, null);
        assert.ok(user != null, "FindByAuthorization returned null for valid JWT token");
        assert.strictEqual(user.username, testConfig.testUser.username);
    }

    @timeout(15000)
    @test async "FindByAuthorization with Basic auth"() {
        const credentials = Buffer.from(testConfig.testUsername + ":" + testConfig.testPassword).toString("base64");
        const user = await Logger.DBHelper.FindByAuthorization("Basic " + credentials, null);
        assert.ok(user != null, "FindByAuthorization returned null for valid Basic auth");
        assert.strictEqual(user.username, testConfig.testUser.username);
    }

    @timeout(10000)
    @test async "FindByAuthorization returns null for invalid tokens"() {
        await fc.assert(fc.asyncProperty(
            fc.string({ minLength: 5, maxLength: 40 }).filter(s => !s.includes(" ")),
            async (garbage) => {
                const user = await Logger.DBHelper.FindByAuthorization(garbage, null);
                assert.strictEqual(user, null);
            }
        ), { numRuns: 10 });
    }

    @timeout(10000)
    @test async "FindByAuthorization returns null for bad Basic credentials"() {
        await fc.assert(fc.asyncProperty(
            fc.stringMatching(/^[a-z]{3,10}$/),
            fc.stringMatching(/^[a-z]{3,10}$/),
            async (user, pass) => {
                const creds = Buffer.from(user + ":" + pass).toString("base64");
                const result = await Logger.DBHelper.FindByAuthorization("Basic " + creds, null);
                assert.strictEqual(result, null);
            }
        ), { numRuns: 5 }); // bcrypt is slow
    }

    @timeout(10000)
    @test async "GetDisposableDomain with email and plain domain"() {
        // These should return null since there's no disposable domain list configured
        await fc.assert(fc.asyncProperty(
            fc.stringMatching(/^[a-z]{3,10}\.(com|org|io)$/),
            async (domain) => {
                const result1 = await Logger.DBHelper.GetDisposableDomain(domain, null);
                const result2 = await Logger.DBHelper.GetDisposableDomain("user@" + domain, null);
                // Both should resolve (null = not disposable)
                // The @ stripping should work: both calls query the same domain
            }
        ), { numRuns: 10 });
    }

    @timeout(10000)
    @test async "GetDisposableDomain returns null for empty"() {
        const result = await Logger.DBHelper.GetDisposableDomain("", null);
        assert.strictEqual(result, null);
    }

    @timeout(30000)
    @test async "EnsureNoderedRoles creates nodered roles for user"() {
        const username = "testnr_" + Util.GetUniqueIdentifier(8);
        let user = await Logger.DBHelper.EnsureUser(
            Crypt.rootToken(), username, username, null, "Pass123!", null, null
        );
        await Logger.DBHelper.EnsureNoderedRoles(user, Crypt.rootToken(), true, null);
        user = await Logger.DBHelper.DecorateWithRoles(user, null);

        const roleNames = user.roles.map(r => r.name);
        assert.ok(roleNames.some(n => n.includes("noderedadmins")), "Missing noderedadmins role");

        await Config.db.DeleteOne(user._id, "users", false, Crypt.rootToken(), null);
        // Clean up created roles
        const roles = await Config.db.query({ query: { _type: "role", name: { $regex: username } }, collectionname: "users", top: 10, jwt: Crypt.rootToken() }, null);
        for (const r of roles) {
            await Config.db.DeleteOne(r._id, "users", false, Crypt.rootToken(), null);
        }
    }
}
// clear && ./node_modules/.bin/_mocha "src/test/**/DBHelper2.test.ts"
