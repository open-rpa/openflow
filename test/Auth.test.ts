const path = require("path");
const env = path.join(process.cwd(), 'config', '.env');
require("dotenv").config({ path: env }); // , debug: false 
import { suite, test } from '@testdeck/mocha';
import { Message } from "../OpenFlow/src/Messages/Message";
import { Config } from "../OpenFlow/src/Config";
import { DatabaseConnection } from '../OpenFlow/src/DatabaseConnection';
import assert = require('assert');
import { Logger } from '../OpenFlow/src/Logger';
import { Auth } from '../OpenFlow/src/Auth';
import { NoderedUtil, SigninMessage } from '@openiap/openflow-api';

@suite class auth_test {
    async before() {
        Config.disablelogging();
        Logger.configure(true, true);
        Config.db = new DatabaseConnection(Config.mongodb_url, Config.mongodb_db, false);
        await Config.db.connect(null);
    }
    async after() {
        await Config.db.shutdown();
        Logger.otel.shutdown();
        Auth.shutdown();
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
    @test async 'getUser'() {
        var user = await Auth.ValidateByPassword("testuser", "testuser", null);
        await Auth.AddUser(user, user._id, "grafana");
        await Auth.AddUser(user, user._id, "dashboard");
        await Auth.AddUser(user, user._id, "cleanacl");

        var grafanauser = Auth.getUser(user._id, "grafana");
        assert.notStrictEqual(grafanauser, null, "Failed getting user from grafana cache")
        var dashboarduser = Auth.getUser(user._id, "dashboard");
        assert.notStrictEqual(dashboarduser, null, "Failed getting user from dashboard cache")

        await Auth.RemoveUser(dashboarduser._id, "dashboard");
        dashboarduser = Auth.getUser(dashboarduser._id, "dashboard");
        assert.strictEqual(dashboarduser, null, "Failed removing user from dashboard cache")

        var cleanacluser = Auth.getUser(user._id, "cleanacl");
        assert.notStrictEqual(cleanacluser, null, "Failed getting user from cleanacl cache")

        Config.grafana_credential_cache_seconds = 0;
        // await new Promise(resolve => { setTimeout(resolve, 1500) })
        var grafanauser = await Auth.getUser(user._id, "grafana");
        assert.strictEqual(grafanauser, null, "Failed expiering user from grafana cache")

        Config.api_credential_cache_seconds = 0;
        Config.grafana_credential_cache_seconds = 0;
        Config.dashboard_credential_cache_seconds = 0;
        Config.cleanacl_credential_cache_seconds = 0;
        Auth.cleanCache();
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
    @test async 'semaphore'() {
        setTimeout(async () => {
            await Auth.semaphore.up();
        }, 500);
        await Auth.semaphore.down();
        await Auth.semaphore.down();
        await Auth.semaphore.up();
    }

}
// cls | ./node_modules/.bin/_mocha 'test/**/Auth.test.ts'