const path = require("path");
const fs = require('fs');
const pako = require('pako');
const env = path.join(process.cwd(), 'config', '.env');
require("dotenv").config({ path: env }); // , debug: false 
import { suite, test, timeout } from '@testdeck/mocha';
import { Config } from "../OpenFlow/src/Config";
import assert = require('assert');
import { Logger } from '../OpenFlow/src/Logger';
import { NoderedUtil, User } from '@openiap/openflow-api';
import { Crypt } from '../OpenFlow/src/Crypt';

@suite class run_cli_test {
    private rootToken: string;
    private testUser: User;
    private userToken: string;
    @timeout(10000)
    async before() {
        Config.disablelogging();
        Logger.configure(true, true);
    }
    @timeout(10000)
    async after() {
        Config.workitem_queue_monitoring_enabled = false;
        await Logger.shutdown();
        // wtf.dump();
    }
    @timeout(5000)
    @test 'Include cli'() {
        require('../OpenFlow/src/cli');
    }
    @timeout(5000)
    @test 'Include nodered cli'() {
        require('../OpenFlowNodeRED/src/cli');
    }

}
// cls | ./node_modules/.bin/_mocha 'test/**/run-cli.test.ts'