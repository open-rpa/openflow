const path = require("path");
const env = path.join(process.cwd(), 'config', '.env');
require("dotenv").config({ path: env }); // , debug: false 
import { suite, test } from '@testdeck/mocha';
import { Message } from "../OpenFlow/src/Messages/Message";
import { Config } from "../OpenFlow/src/Config";
import { DatabaseConnection } from '../OpenFlow/src/DatabaseConnection';
import { SelectCustomerMessage } from '@openiap/openflow-api';
import { Crypt } from '../OpenFlow/src/Crypt';
import assert = require('assert');
import { Logger } from '../OpenFlow/src/Logger';

@suite class OpenFlowMessageTests {

    async before() {
        Logger.configure(true, true);
        Config.db = new DatabaseConnection(Config.mongodb_url, Config.mongodb_db);
        await Config.db.connect(null);
    }
    async after() {
        // Logger.instanse.info("shuting down");
        await Config.db.shutdown();
        Logger.otel.shutdown();
    }

    @test async 'Unselect customer as root'() {
        var q = new SelectCustomerMessage();
        var msg = new Message(); msg.jwt = Crypt.rootToken();
        await msg.SelectCustomer(null);
        q = JSON.parse(msg.data);
        assert.ok(q && !q.error, q.error);
    }
}
