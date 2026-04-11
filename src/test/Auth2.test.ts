import { suite, test, timeout } from "@testdeck/mocha";
import assert from "assert";
import * as fc from "fast-check";
import { Auth } from "../Auth.js";
import { Config } from "../Config.js";
import { Crypt } from "../Crypt.js";
import { Util } from "../Util.js";
import { testConfig } from "./testConfig.js";

@suite class auth_bearer_basic_tests {
    @timeout(30000)
    async before() {
        await testConfig.configure();
    }
    async after() {
        await testConfig.cleanup();
    }

    @timeout(10000)
    @test async "Token2User parses Bearer prefix case-insensitively"() {
        const jwt = Crypt.createToken(testConfig.testUser, "1h");
        await fc.assert(fc.asyncProperty(
            fc.constantFrom("Bearer", "bearer", "BEARER", "BeArEr"),
            async (prefix) => {
                const user = await Auth.Token2User(prefix + " " + jwt, null);
                assert.ok(user != null, "Token2User returned null for " + prefix);
                assert.strictEqual(user._id, testConfig.testUser._id);
            }
        ), { numRuns: 4 });
    }

    @timeout(10000)
    @test async "Token2User parses JWT prefix"() {
        const jwt = Crypt.createToken(testConfig.testUser, "1h");
        await fc.assert(fc.asyncProperty(
            fc.constantFrom("JWT", "jwt", "Jwt"),
            async (prefix) => {
                const user = await Auth.Token2User(prefix + " " + jwt, null);
                assert.ok(user != null, "Token2User returned null for " + prefix);
                assert.strictEqual(user._id, testConfig.testUser._id);
            }
        ), { numRuns: 3 });
    }

    @timeout(15000)
    @test async "Token2User parses Basic auth"() {
        const credentials = Buffer.from(testConfig.testUsername + ":" + testConfig.testPassword).toString("base64");
        const user = await Auth.Token2User("Basic " + credentials, null);
        assert.ok(user != null, "Token2User returned null for valid Basic auth");
        assert.strictEqual(user.username, testConfig.testUser.username);
    }

    @timeout(10000)
    @test async "Token2User Basic auth with wrong password returns null"() {
        await fc.assert(fc.asyncProperty(
            fc.string({ minLength: 1, maxLength: 20 }).filter(s => s !== testConfig.testPassword && s.trim().length > 0),
            async (wrongPass) => {
                const credentials = Buffer.from(testConfig.testUsername + ":" + wrongPass).toString("base64");
                const user = await Auth.Token2User("Basic " + credentials, null);
                assert.strictEqual(user, null, "Token2User accepted wrong Basic auth password");
            }
        ), { numRuns: 5 }); // bcrypt
    }

    @timeout(10000)
    @test async "Id2Token with generated expiries produces valid tokens"() {
        await fc.assert(fc.asyncProperty(
            fc.constantFrom("1h", "12h", "1d", "7d", "30d"),
            async (expiry) => {
                const jwt = await Auth.Id2Token(testConfig.testUser._id, null, null, expiry, null);
                assert.ok(!Util.IsNullEmpty(jwt));
                const decoded = Crypt.decryptToken(jwt);
                assert.strictEqual(decoded.data._id, testConfig.testUser._id);
            }
        ), { numRuns: 7 });
    }

    @timeout(10000)
    @test async "User2Token from TokenUser and User both work"() {
        const { TokenUser } = await import("../commoninterfaces.js");
        const tokenUser = TokenUser.From(testConfig.testUser);
        const jwt1 = await Auth.User2Token(testConfig.testUser, "1h", null);
        const jwt2 = await Auth.User2Token(tokenUser, "1h", null);
        assert.ok(!Util.IsNullEmpty(jwt1));
        assert.ok(!Util.IsNullEmpty(jwt2));
        const d1 = Crypt.decryptToken(jwt1);
        const d2 = Crypt.decryptToken(jwt2);
        assert.strictEqual(d1.data._id, d2.data._id);
    }
}
// clear && ./node_modules/.bin/_mocha "src/test/**/Auth2.test.ts"
