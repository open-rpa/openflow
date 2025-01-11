import { suite, test, timeout } from "@testdeck/mocha";
import assert from "assert";
import { i_license_data } from "../commoninterfaces.js";
import { Config } from "../Config.js";
import { Logger } from "../Logger.js";
import { Util } from "../Util.js";
import { testConfig } from "./testConfig.js";

@suite class logger_test {
    @timeout(10000)
    async before() {
        await testConfig.configure();
    }
    async after() {
        await testConfig.cleanup();
    }
    @test async "test info"() {
        // assert.ok(!NoderedUtil.IsNullUndefinded(Logger.myFormat), "Logger missing winston error formatter");
        var ofid = Logger.ofid();
        assert.strictEqual(Util.IsNullEmpty(ofid), false);
    }
    @test async "v1_lic"() {
        const months: number = 1;
        const data: i_license_data = {} as any;
        let template = Logger.License.template_v1;
        data.licenseVersion = 1;
        data.email = "test@user.com";
        var dt = new Date(new Date().toISOString());
        dt.setMonth(dt.getMonth() + months);
        data.expirationDate = dt.toISOString() as any;
        const licenseFileContent = Logger.License.generate({
            privateKeyPath: "config/private_key.pem",
            template,
            data: data
        });
        Config.license_key = Buffer.from(licenseFileContent).toString("base64");
        Logger.License.validate();
        assert.strictEqual(Logger.License.validlicense, true);
        assert.strictEqual(Logger.License.data.email, "test@user.com");

    }
    @test async "v2_lic"() {
        const months: number = 1;
        const data: i_license_data = {} as any;
        let template = Logger.License.template_v2;
        let ofid = Logger.License.ofid(false);
        assert.ok(!Util.IsNullEmpty(ofid));
        data.licenseVersion = 2;
        data.email = "test@user.com";
        data.domain = "localhost.openiap.io"
        Config.domain = "localhost.openiap.io";
        var dt = new Date(new Date().toISOString());
        dt.setMonth(dt.getMonth() + months);
        data.expirationDate = dt.toISOString() as any;
        const licenseFileContent = Logger.License.generate({
            privateKeyPath: "config/private_key.pem",
            template,
            data: data
        });
        var lic = Logger.License;
        Config.license_key = Buffer.from(licenseFileContent).toString("base64");
        Logger.License.validate();
        assert.strictEqual(Logger.License.validlicense, true);
        assert.strictEqual(Logger.License.data.email, "test@user.com");
        assert.strictEqual(Logger.License.data.domain, "localhost.openiap.io");

        Config.domain = "notlocalhost.openiap.io";
        Logger.License.validate(); // will not error anymore, will just set validlicense to false // assert.throws(lic.validate.bind(lic), Error);        
        assert.strictEqual(Logger.License.validlicense, false);
        assert.strictEqual(Logger.License.data.domain, "localhost.openiap.io");
        let ofid2 = Logger.License.ofid(true);
        assert.ok(!Util.IsNullEmpty(ofid2));
        assert.notStrictEqual(ofid, ofid2);
    }
}
// clear && ./node_modules/.bin/_mocha "src/test/**/Logger.test.ts"