var wtf = require('wtfnode');
const path = require("path");
const env = path.join(process.cwd(), 'config', '.env');
require("dotenv").config({ path: env }); // , debug: false 
import { suite, test, timeout } from '@testdeck/mocha';
import { Message } from "../OpenFlow/src/Messages/Message";
import { Config } from "../OpenFlow/src/Config";
import { DatabaseConnection } from '../OpenFlow/src/DatabaseConnection';
import assert = require('assert');
import { Logger } from '../OpenFlow/src/Logger';
import { Auth } from '../OpenFlow/src/Auth';
import { NoderedUtil, SigninMessage } from '@openiap/openflow-api';

@suite class auth_test {
    @timeout(10000)
    async before() {
        Config.workitem_queue_monitoring_enabled = false;
        Config.disablelogging();
        Logger.configure(true, true);
        Config.db = new DatabaseConnection(Config.mongodb_url, Config.mongodb_db, false);
        await Config.db.connect(null);
    }
    async after() {
        await Logger.shutdown();
        // wtf.dump()
    }
    @test async 'ValidateByPassword'() {
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
    @test async 'test full login'() {
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
// cls | ./node_modules/.bin/_mocha 'test/**/Auth.test.ts'