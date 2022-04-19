const path = require("path");
const env = path.join(process.cwd(), 'config', '.env');
require("dotenv").config({ path: env }); // , debug: false 
import { suite, test, timeout } from '@testdeck/mocha';
import { Config } from "../OpenFlow/src/Config";
import { DatabaseConnection } from '../OpenFlow/src/DatabaseConnection';
import assert = require('assert');
import { Logger } from '../OpenFlow/src/Logger';
import { NoderedUtil } from '@openiap/openflow-api';
import { license_data } from '../OpenFlow/src/otelspec';
import { Auth } from '../OpenFlow/src/Auth';

@suite class logger_test {
    @timeout(10000)
    async before() {
        Config.workitem_queue_monitoring_enabled = false;
        Config.disablelogging();
        Logger.configure(true, false);
        Config.db = new DatabaseConnection(Config.mongodb_url, Config.mongodb_db, false);
        await Config.db.connect(null);
    }
    async after() {
        await Config.db.shutdown();
        await Logger.otel.shutdown();
        Logger.License.shutdown();
        Auth.shutdown();
    }
    @test async 'test info'() {
        assert.ok(!NoderedUtil.IsNullUndefinded(Logger.myFormat), "Logger missing winston error formatter");
        var ofid = Logger.ofid();
        assert.strictEqual(NoderedUtil.IsNullEmpty(ofid), false);
    }
    @test async 'v1_lic'() {
        const months: number = 1;
        const data: license_data = {} as any;
        let template = Logger.License.template_v1;
        data.licenseVersion = 1;
        data.email = "test@user.com";
        var dt = new Date(new Date().toISOString());
        dt.setMonth(dt.getMonth() + months);
        data.expirationDate = dt.toISOString() as any;
        const licenseFileContent = Logger.License.generate({
            privateKeyPath: 'config/private_key.pem',
            template,
            data: data
        });
        Config.license_key = Buffer.from(licenseFileContent).toString('base64');
        Logger.License.validate();
        assert.strictEqual(Logger.License.validlicense, true);
        assert.strictEqual(Logger.License.data.email, "test@user.com");

    }
    @test async 'v2_lic'() {
        const months: number = 1;
        const data: license_data = {} as any;
        let template = Logger.License.template_v2;
        let ofid = Logger.License.ofid(false);
        assert.ok(!NoderedUtil.IsNullEmpty(ofid));
        data.licenseVersion = 2;
        data.email = "test@user.com";
        data.domain = "localhost.openiap.io"
        Config.domain = "localhost.openiap.io";
        var dt = new Date(new Date().toISOString());
        dt.setMonth(dt.getMonth() + months);
        data.expirationDate = dt.toISOString() as any;
        const licenseFileContent = Logger.License.generate({
            privateKeyPath: 'config/private_key.pem',
            template,
            data: data
        });
        var lic = Logger.License;
        Config.license_key = Buffer.from(licenseFileContent).toString('base64');
        Logger.License.validate();
        assert.strictEqual(Logger.License.validlicense, true);
        assert.strictEqual(Logger.License.data.email, "test@user.com");
        assert.strictEqual(Logger.License.data.domain, "localhost.openiap.io");

        Config.domain = "notlocalhost.openiap.io";
        assert.throws(lic.validate.bind(lic), Error);
        assert.strictEqual(Logger.License.validlicense, false);
        assert.strictEqual(Logger.License.data.domain, "localhost.openiap.io");
        let ofid2 = Logger.License.ofid(true);
        assert.ok(!NoderedUtil.IsNullEmpty(ofid2));
        assert.notStrictEqual(ofid, ofid2);
    }
}
// cls | ./node_modules/.bin/_mocha 'test/**/Logger.test.ts'