// import wtf from "wtfnode";
import { suite, test, timeout } from "@testdeck/mocha";
import { Message } from "../Messages/Message.js";
import { Config } from "../Config.js";
import { DatabaseConnection } from "../DatabaseConnection.js";
import assert from "assert";
import { Logger } from "../Logger.js";
import { Auth } from "../Auth.js";
import { NoderedUtil, SigninMessage } from "@openiap/openflow-api";

@suite class auth_test {
    @timeout(10000)
    async before() {
        Config.workitem_queue_monitoring_enabled = false;
        Config.disablelogging();
        await Logger.configure(true, true);
        Config.db = new DatabaseConnection(Config.mongodb_url, Config.mongodb_db);
        await Config.db.connect(null);
        await Config.Load(null);
    }
    async after() {
        await Logger.shutdown();
        // wtf.dump()
    }
    @test async "ValidateByPassword"() {
        await assert.rejects(async () => {
            await Auth.ValidateByPassword("testuser", null, null);
        }, "Did not fail on null password")
        await assert.rejects(async () => {
            await Auth.ValidateByPassword(null, "testuser", null);
        }, "Did not fail on null username")
        var user1 = await Auth.ValidateByPassword("testuser", "testuser", null);
        assert.notStrictEqual(user1, null, "Failed validating valid username and password")
        assert.strictEqual(user1.username, "testuser", "returned user has wrong username")
        var user2 = await Auth.ValidateByPassword("testuser", "not-my-password", null);
        assert.strictEqual(user2, null, "Did not fail on wrong password")
    }
    @test async "test full login"() {
        var q: any = new SigninMessage();
        var msg = new Message();
        msg.command = "signin";
        q.username = "testuser"; q.password = "testuser";
        msg.data = JSON.stringify(q);
        await msg.Signin(null, null);
        q = JSON.parse(msg.data);
        assert.strictEqual(NoderedUtil.IsNullEmpty(q.user), false, "Sigin returned no data")
        assert.strictEqual(q.user.username, "testuser", "Sigin did not return testuser user object")

    }
}
// clear && ./node_modules/.bin/_mocha "OpenFlow/src/test/**/Auth.test.ts"