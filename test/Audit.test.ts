const path = require("path");
const env = path.join(process.cwd(), 'config', '.env');
require("dotenv").config({ path: env }); // , debug: false 
import { suite, test } from '@testdeck/mocha';
import { Config } from "../OpenFlow/src/Config";
import { DatabaseConnection } from '../OpenFlow/src/DatabaseConnection';
import assert = require('assert');
import { Logger } from '../OpenFlow/src/Logger';
import { NoderedUtil, TokenUser, User } from '@openiap/openflow-api';
import { Audit } from '../OpenFlow/src/Audit';
import { Crypt } from '../OpenFlow/src/Crypt';
import { DBHelper } from '../OpenFlow/src/DBHelper';

@suite class OpenFlowConfigTests {
    private rootToken: string;
    private testUser: User;
    private userToken: string;
    async before() {
        Logger.configure(true, false);
        Config.db = new DatabaseConnection(Config.mongodb_url, Config.mongodb_db);
        await Config.db.connect(null);
        this.rootToken = Crypt.rootToken();
        this.testUser = await DBHelper.FindByUsername("testuser", this.rootToken, null)
        this.userToken = Crypt.createToken(this.testUser, Config.shorttoken_expires_in);
    }
    async after() {
        await Config.db.shutdown();
        Logger.otel.shutdown();
    }
    @test async 'reload'() {
        const tuser: TokenUser = TokenUser.From(this.testUser);
        const troot: TokenUser = TokenUser.From(Crypt.rootUser());
        Audit.LoginSuccess(tuser, "local", "local", "127.0.0.1", "openflow", Config.version, null);
        Audit.LoginFailed("testuser", "local", "local", "127.0.0.1", "openflow", Config.version, null);
        Audit.ImpersonateSuccess(tuser, troot, "openflow", Config.version, null);
        Audit.ImpersonateFailed(tuser, troot, "openflow", Config.version, null);
        Audit.NoderedAction(tuser, true, "testuser", "createdeployment", "openiap/nodered", "testuser", null);
        Audit.NoderedAction(tuser, true, "testuser", "deletedeployment", "openiap/nodered:latest", "testuser", null);
        await new Promise(resolve => { setTimeout(resolve, 1000) })
    }

}
// cls | ./node_modules/.bin/_mocha 'test/**/Audit.test.ts'