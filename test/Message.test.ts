const path = require("path");
const env = path.join(process.cwd(), 'config', '.env');
require("dotenv").config({ path: env }); // , debug: false 
import { suite, test, timeout } from '@testdeck/mocha';
import { Message } from "../OpenFlow/src/Messages/Message";
import { Config } from "../OpenFlow/src/Config";
import { DatabaseConnection } from '../OpenFlow/src/DatabaseConnection';
import { NoderedUtil, SelectCustomerMessage, SigninMessage, User } from '@openiap/openflow-api';
import { Crypt } from '../OpenFlow/src/Crypt';
import assert = require('assert');
import { Logger } from '../OpenFlow/src/Logger';

@suite class message_test {
    private rootToken: string;
    private testUser: User;
    private userToken: string;
    @timeout(10000)
    async before() {
        Config.workitem_queue_monitoring_enabled = false;
        Config.disablelogging();
        Logger.configure(true, true);
        Config.db = new DatabaseConnection(Config.mongodb_url, Config.mongodb_db, false);
        await Config.db.connect(null);
        this.rootToken = Crypt.rootToken();
        this.testUser = await Logger.DBHelper.FindByUsername("testuser", this.rootToken, null)
        this.userToken = Crypt.createToken(this.testUser, Config.shorttoken_expires_in);
    }
    async after() {
        await Logger.shutdown();
    }
    @test async 'Unselect customer as root'() {
        var q = new SelectCustomerMessage();
        var msg = new Message(); msg.jwt = this.rootToken;
        await msg.EnsureJWT(null, false)
        assert.rejects(msg.SelectCustomer(null), "Builtin entities cannot select a company")
    }
    @test async 'select customer as root'() {
        var q = new SelectCustomerMessage(); q.customerid = "60b683e12382b05d20762f09";
        var msg = new Message(); msg.jwt = this.rootToken;
        await msg.EnsureJWT(null, false)
        assert.rejects(msg.SelectCustomer(null), "Builtin entities cannot select a company")
    }
    @test async 'Unselect customer as testuser'() {
        var q = new SelectCustomerMessage();
        var msg = new Message(); msg.jwt = this.userToken;
        await msg.EnsureJWT(null, false)
        await msg.SelectCustomer(null);
    }
    @test async 'select customer as testuser'() {
        var q = new SelectCustomerMessage(); q.customerid = "60b683e12382b05d20762f09";
        var msg = new Message(); msg.jwt = this.userToken;
        await msg.EnsureJWT(null, false)
        await msg.SelectCustomer(null);
    }
    // @test async 'signin with username and password'() {
    //     var q = new SigninMessage(); q.username = "testuser"; q.password = "testuser"
    //     var msg = new Message();
    //     await msg.Signin(null, null);
    //     q = JSON.parse(msg.data);
    //     assert.ok(q && !q.error, q.error);
    // }
}
// clear && ./node_modules/.bin/_mocha 'test/**/Message.test.ts'