// var wtf = require('wtfnode');
const path = require("path");
const env = path.join(process.cwd(), 'config', '.env');
require("dotenv").config({ path: env }); // , debug: false 
import { suite, test, timeout } from '@testdeck/mocha';
import { Config } from "../OpenFlow/src/Config.js";
import { DatabaseConnection } from '../OpenFlow/src/DatabaseConnection';
import assert = require('assert');
import { Logger } from '../OpenFlow/src/Logger';
import { TokenUser, User } from '@openiap/openflow-api';
import { Audit } from '../OpenFlow/src/Audit';
import { Crypt } from '../OpenFlow/src/Crypt';

@suite class audit_test {
    private rootToken: string;
    private testUser: User;
    @timeout(10000)
    async before() {
        Config.workitem_queue_monitoring_enabled = false;
        Config.disablelogging();
        Logger.configure(true, false);
        Config.db = new DatabaseConnection(Config.mongodb_url, Config.mongodb_db, false);
        await Config.db.connect(null);
        this.rootToken = Crypt.rootToken();
        this.testUser = await Logger.DBHelper.FindByUsername("testuser", this.rootToken, null)
    }
    async after() {
        await Logger.shutdown();
        // wtf.dump()
    }
    @test async 'reload'() {
        const tuser: TokenUser = TokenUser.From(this.testUser);
        const troot: TokenUser = TokenUser.From(Crypt.rootUser());
        await Audit.LoginSuccess(tuser, "local", "local", "127.0.0.1", "test", Config.version, null);
        await Audit.LoginFailed("testuser", "local", "local", "127.0.0.1", "test", Config.version, null);
        await Audit.ImpersonateSuccess(tuser, troot, "test", Config.version, null);
        await Audit.ImpersonateFailed(tuser, troot, "test", Config.version, null);
        await Audit.NoderedAction(tuser, true, "testuser", "createdeployment", "openiap/nodered", "testuser", null);
        await Audit.NoderedAction(tuser, true, "testuser", "deletedeployment", "openiap/nodered:latest", "testuser", null);
        await new Promise(resolve => { setTimeout(resolve, 1000) })
    }

}
// clear && ./node_modules/.bin/_mocha 'test/**/Audit.test.ts'
// clear && ts-mocha --paths -p test/tsconfig.json 'test/Audit.test.ts'