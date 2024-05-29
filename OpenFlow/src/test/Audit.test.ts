// import wtf from "wtfnode";
import { suite, test, timeout } from "@testdeck/mocha";
import { Config } from "../Config.js";
import { DatabaseConnection } from "../DatabaseConnection.js";
import { Logger } from "../Logger.js";
import { TokenUser, User } from "@openiap/openflow-api";
import { Audit } from "../Audit.js";
import { Crypt } from "../Crypt.js";

@suite class audit_test {
    private rootToken: string;
    private testUser: User;
    @timeout(10000)
    async before() {
        Config.workitem_queue_monitoring_enabled = false;
        Config.disablelogging();
        await Logger.configure(true, false);
        Config.db = new DatabaseConnection(Config.mongodb_url, Config.mongodb_db, false);
        await Config.db.connect(null);
        await Config.Load(null);
        this.rootToken = Crypt.rootToken();
        this.testUser = await Logger.DBHelper.FindByUsername("testuser", this.rootToken, null)
    }
    async after() {
        await Logger.shutdown();
        // wtf.dump()
    }
    @test async "reload"() {
        await Audit.LoginSuccess(this.testUser, "local", "local", "127.0.0.1", "test", Config.version, null);
        await Audit.LoginFailed("testuser", "local", "local", "127.0.0.1", "test", Config.version, null);
        await Audit.ImpersonateSuccess(this.testUser, Crypt.rootUser(), "test", Config.version, null);
        await Audit.ImpersonateFailed(this.testUser, Crypt.rootUser(), "test", Config.version, null);
        await Audit.NoderedAction(this.testUser, true, "testuser", "createdeployment", "openiap/nodered", "testuser", null);
        await Audit.NoderedAction(this.testUser, true, "testuser", "deletedeployment", "openiap/nodered:latest", "testuser", null);
        await new Promise(resolve => { setTimeout(resolve, 1000) })
    }
}
// clear && ./node_modules/.bin/_mocha "OpenFlow/src/test/Audit.test.ts"
