const path = require("path");
const env = path.join(process.cwd(), 'config', '.env');
require("dotenv").config({ path: env }); // , debug: false 
import { Message } from "../OpenFlow/src/Messages/Message";
import { suite, test, timeout } from '@testdeck/mocha';
import { Config } from "../OpenFlow/src/Config";
import { DatabaseConnection } from '../OpenFlow/src/DatabaseConnection';
import assert = require('assert');
import { Logger } from '../OpenFlow/src/Logger';
import { NoderedUtil, User, SelectCustomerMessage } from '@openiap/openflow-api';
import { Auth } from '../OpenFlow/src/Auth';
import { Crypt } from '../OpenFlow/src/Crypt';
import { DBHelper } from '../OpenFlow/src/DBHelper';

@suite class OpenFlowConfigTests {
    private rootToken: string;
    private testUser: User;
    private userToken: string;
    async before() {
        Logger.configure(true, true);
        Config.db = new DatabaseConnection(Config.mongodb_url, Config.mongodb_db, false);
        await Config.db.connect(null);
        this.rootToken = Crypt.rootToken();
        this.testUser = await DBHelper.FindByUsername("testuser", this.rootToken, null)
        assert.ok(!NoderedUtil.IsNullUndefinded(this.testUser), "Test user missing, was user deleted ?");
        this.userToken = Crypt.createToken(this.testUser, Config.shorttoken_expires_in);
    }
    async after() {
        try {
            var q: any = new SelectCustomerMessage();
            var msg = new Message(); msg.jwt = this.userToken;
            q.name = "test queue"
            msg.data = JSON.stringify(q);
            Config.log_errors = false;
            await msg.DeleteWorkItemQueue(null);
            Config.log_errors = true;
        } catch (error) {

        }
        await Config.db.shutdown();
        Logger.otel.shutdown();
        Auth.shutdown();
    }
    @timeout(50000)
    @test async 'Create test work item queue'() {
        var q: any = new SelectCustomerMessage();
        var msg = new Message(); msg.jwt = this.userToken;
        q.name = "test queue"
        msg.data = JSON.stringify(q);
        Config.log_errors = false;
        await msg.AddWorkItemQueue(null, null);
        Config.log_errors = true;
        q = JSON.parse(msg.data);
        assert.ok(!NoderedUtil.IsNullUndefinded(q), "msg data missing");
        assert.ok(NoderedUtil.IsNullUndefinded(q.error), q.error);

    }

}
// cls | ./node_modules/.bin/_mocha 'test/**/workitemqueue-messages.test.ts'