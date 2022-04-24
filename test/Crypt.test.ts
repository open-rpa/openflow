const path = require("path");
const env = path.join(process.cwd(), 'config', '.env');
require("dotenv").config({ path: env }); // , debug: false 
import { suite, test, timeout } from '@testdeck/mocha';
import { Config } from "../OpenFlow/src/Config";
import { DatabaseConnection } from '../OpenFlow/src/DatabaseConnection';
import assert = require('assert');
import { Logger } from '../OpenFlow/src/Logger';
import { User } from '@openiap/openflow-api';
import { Auth } from '../OpenFlow/src/Auth';
import { Crypt } from '../OpenFlow/src/Crypt';
import { DBHelper } from '../OpenFlow/src/DBHelper';
@suite class crypt_test {
    private testUser: User;
    @timeout(10000)
    async before() {
        Config.workitem_queue_monitoring_enabled = false;
        Config.disablelogging();
        Logger.configure(true, true);
        Config.db = new DatabaseConnection(Config.mongodb_url, Config.mongodb_db, false);
        await Config.db.connect(null);
        this.testUser = await DBHelper.FindByUsername("testuser", Crypt.rootToken(), null)
    }
    async after() {
        await Config.db.shutdown();
        await Logger.otel.shutdown();
    }
    @timeout(10000)
    @test async 'ValidatePassword'() {
        await Crypt.SetPassword(this.testUser, "randompassword", null);
        var result = await Crypt.ValidatePassword(this.testUser, "randompassword", null);
        assert.ok(result, "Failed validating with the correct password");
        result = await Crypt.ValidatePassword(this.testUser, "not-my-randompassword", null);
        assert.ok(!result, "ValidatePassword did not fail with wrong password");
        var hash = await Crypt.hash("secondrandompassword");
        result = await Crypt.compare("secondrandompassword", hash, null)
        assert.ok(result, "Failed validating with the correct password");
        result = await Crypt.compare("not-my-randompassword", hash, null);
        assert.ok(!result, "compare did not fail with wrong password");

        await assert.rejects(Crypt.SetPassword(null, "randompassword", null));
        await assert.rejects(Crypt.SetPassword(this.testUser, null, null));
        await assert.rejects(Crypt.SetPassword(null, null, null));
        await assert.rejects(Crypt.ValidatePassword(null, "randompassword", null));
        await assert.rejects(Crypt.ValidatePassword(this.testUser, null, null));
        await assert.rejects(Crypt.ValidatePassword(null, null, null));
        await assert.rejects(Crypt.compare(null, null, null));

    }
    @test async 'encrypt'() {
        const basestring = "Hi mom, i miss you.";
        var encryptedstring = Crypt.encrypt(basestring);
        var decryptedstring = Crypt.decrypt(encryptedstring);
        assert.ok(decryptedstring == basestring, "Failed encrypting and decrypting string");
        assert.throws(() => { Crypt.decrypt("Bogusstring") }, Error, "Decrypt did not fail with an illegal string");
    }
    @test async 'decrypt'() {
        const gcm = "8a23d6b7b2282b09a32994faf724f05e:8c2551427845c60b4e394302057bc4e4";
        const cbc = "4beca50248100a14d06c8d284258eda7:aee11025ef03216d0068:4b23f4875b8bda4be5b1a0b3a4b4cd3c";
        var gcmdecrypted = Crypt.decrypt(gcm);
        assert.ok(gcmdecrypted == "teststring", "Failed decrypting string using gcm encryption");
        var cbcdecrypted = Crypt.decrypt(cbc);
        assert.ok(cbcdecrypted == "teststring", "Failed decrypting string using gcm encryption");
    }
}
// cls | ./node_modules/.bin/_mocha 'test/**/Crypt.test.ts'