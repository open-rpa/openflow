import { suite, test, timeout } from "@testdeck/mocha";
import { Audit } from "../Audit.js";
import { Config } from "../Config.js";
import { Crypt } from "../Crypt.js";
import { testConfig } from "./testConfig.js";

@suite class audit_test {
    @timeout(10000)
    async before() {
        await testConfig.configure();
    }
    async after() {
        await testConfig.cleanup();
    }
    @test async "reload"() {
        await Audit.LoginSuccess(testConfig.testUser, "local", "local", "127.0.0.1", "test", Config.version, null);
        await Audit.LoginFailed("testuser", "local", "local", "127.0.0.1", "test", Config.version, null);
        await Audit.ImpersonateSuccess(testConfig.testUser, Crypt.rootUser(), "test", Config.version, null);
        await Audit.ImpersonateFailed(testConfig.testUser, Crypt.rootUser(), "test", Config.version, null);
        await Audit.NoderedAction(testConfig.testUser, true, "testuser", "createdeployment", "openiap/nodered", "testuser", null);
        await Audit.NoderedAction(testConfig.testUser, true, "testuser", "deletedeployment", "openiap/nodered:latest", "testuser", null);
        await new Promise(resolve => { setTimeout(resolve, 1000) })
    }
}
// clear && ./node_modules/.bin/_mocha "src/test/Audit.test.ts"
