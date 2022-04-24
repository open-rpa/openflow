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
import { Auth } from '../OpenFlow/src/Auth';
import { DBHelper } from '../OpenFlow/src/DBHelper';

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
        this.testUser = await DBHelper.FindByUsername("testuser", this.rootToken, null)
        this.userToken = Crypt.createToken(this.testUser, Config.shorttoken_expires_in);
    }
    async after() {
        await Config.db.shutdown();
        await Logger.otel.shutdown();
        Logger.License.shutdown();
    }
    @test async 'Unselect customer as root'() {
        var q = new SelectCustomerMessage();
        var msg = new Message(); msg.jwt = this.rootToken;
        Config.log_errors = false;
        await msg.SelectCustomer(null);
        Config.log_errors = true;
        q = JSON.parse(msg.data);
        assert.ok(!NoderedUtil.IsNullUndefinded(q), "msg data missing");
        assert.ok(!NoderedUtil.IsNullEmpty(q.error), "Expected a fail, when unselecting customer as root");
    }
    @test async 'select customer as root'() {
        var q = new SelectCustomerMessage(); q.customerid = "60b683e12382b05d20762f09";
        var msg = new Message(); msg.jwt = this.rootToken;
        Config.log_errors = false;
        await msg.SelectCustomer(null);
        Config.log_errors = true;
        q = JSON.parse(msg.data);
        assert.ok(!NoderedUtil.IsNullUndefinded(q), "msg data missing");
        assert.ok(!NoderedUtil.IsNullEmpty(q.error), "Expected a fail, when selecting a customer as root");
    }
    @test async 'Unselect customer as testuser'() {
        var q = new SelectCustomerMessage();
        var msg = new Message(); msg.jwt = this.userToken;
        await msg.SelectCustomer(null);
        q = JSON.parse(msg.data);
        assert.ok(q && !q.error, q.error);
    }
    @test async 'select customer as testuser'() {
        var q = new SelectCustomerMessage(); q.customerid = "60b683e12382b05d20762f09";
        var msg = new Message(); msg.jwt = this.userToken;
        await msg.SelectCustomer(null);
        q = JSON.parse(msg.data);
        assert.ok(q && !q.error, q.error);
    }
    // @test async 'signin with username and password'() {
    //     var q = new SigninMessage(); q.username = "testuser"; q.password = "testuser"
    //     var msg = new Message();
    //     await msg.Signin(null, null);
    //     q = JSON.parse(msg.data);
    //     assert.ok(q && !q.error, q.error);
    // }
}
// cls | ./node_modules/.bin/_mocha 'test/**/Message.test.ts'