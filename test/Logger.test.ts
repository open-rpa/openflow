const path = require("path");
const env = path.join(process.cwd(), 'config', '.env');
require("dotenv").config({ path: env }); // , debug: false 
import { suite, test } from '@testdeck/mocha';
import { Message } from "../OpenFlow/src/Messages/Message";
import { Config } from "../OpenFlow/src/Config";
import { DatabaseConnection } from '../OpenFlow/src/DatabaseConnection';
import assert = require('assert');
import { Logger } from '../OpenFlow/src/Logger';
import { NoderedUtil } from '@openiap/openflow-api';

@suite class OpenFlowLoggerTests {
    async before() {
        Logger.configure(true, false);
        Config.db = new DatabaseConnection(Config.mongodb_url, Config.mongodb_db);
        await Config.db.connect(null);
    }
    async after() {
        await Config.db.shutdown();
        Logger.otel.shutdown();
    }
    @test async 'test info'() {
        assert.ok(!NoderedUtil.IsNullUndefinded(Logger.myFormat), "Logger missing winston error formatter");
        var ofid = Logger.ofid();
        assert.strictEqual(NoderedUtil.IsNullEmpty(ofid), false);
    }
}
// cls | ./node_modules/.bin/_mocha 'test/**/Logger.test.ts'