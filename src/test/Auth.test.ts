import { SigninMessage } from "@openiap/openflow-api";
import { suite, test, timeout } from "@testdeck/mocha";
import assert from "assert";
import { Auth } from "../Auth.js";
import { Message } from "../Messages/Message.js";
import { Util } from "../Util.js";
import { testConfig } from "./testConfig.js";

@suite class auth_test {
    @timeout(10000)
    async before() {
        await testConfig.configure();
    }
    async after() {
        await testConfig.cleanup();
    }
    @test async "ValidateByPassword"() {
        await assert.rejects(async () => {
            await Auth.ValidateByPassword(testConfig.testUser.username, null, null);
        }, "Did not fail on null password")
        await assert.rejects(async () => {
            await Auth.ValidateByPassword(null, testConfig.testUser.username, null);
        }, "Did not fail on null username")
        var user1 = await Auth.ValidateByPassword(testConfig.testUser.username, testConfig.testPassword, null);
        assert.notStrictEqual(user1, null, "Failed validating valid username and password")
        assert.strictEqual(user1.username, testConfig.testUser.username, "returned user has wrong username")
        var user2 = await Auth.ValidateByPassword(testConfig.testUser.username, "not-my-password", null);
        assert.strictEqual(user2, null, "Did not fail on wrong password")
    }
    @test async "test full login"() {
        var q: any = new SigninMessage();
        var msg = new Message();
        msg.command = "signin";
        q.username = testConfig.testUser.username; q.password = testConfig.testPassword;
        msg.data = JSON.stringify(q);
        await msg.Signin(null, null);
        q = JSON.parse(msg.data);
        assert.strictEqual(Util.IsNullEmpty(q.user), false, "Sigin returned no data")
        assert.strictEqual(q.user.username, testConfig.testUser.username, "Sigin did not return testuser user object")

    }
}
// clear && ./node_modules/.bin/_mocha "src/test/**/Auth.test.ts"