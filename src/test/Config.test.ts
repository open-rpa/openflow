import { suite, test, timeout } from "@testdeck/mocha";
import assert from "assert";
import { Config } from "../Config.js";
import { Util } from "../Util.js";
import { testConfig } from "./testConfig.js";
@suite
export class Config_test {
    @timeout(10000)
    async before() {
        await testConfig.configure();
    }
    async after() {
        await testConfig.cleanup();
    }
    @test "baseurl"() {
        assert.strictEqual(Util.IsNullEmpty(Config.domain), false, "domain missing from baseurl");
        var url = Config.baseurl();
        assert.notStrictEqual(url.indexOf(Config.domain), -1, "domain missing from baseurl");
        assert.notStrictEqual(url.startsWith("https://"), false, "baseurl is not using https");
        var wsurl = Config.basewsurl();
        assert.notStrictEqual(wsurl.indexOf(Config.domain), -1, "basewsurl missing from baseurl");
        assert.notStrictEqual(wsurl.startsWith("wss://"), false, "basewsurl is not using https");

        Config.tls_crt = "";
        Config.tls_key = "";

        var wsurl = Config.basewsurl();
        assert.notStrictEqual(wsurl.startsWith("wss://"), false, "basewsurl is not using https");

        Config.protocol = "http";
        var url = Config.baseurl();
        assert.notStrictEqual(url.indexOf(Config.domain), -1, "domain missing from baseurl");
        assert.notStrictEqual(url.startsWith("http://"), false, "baseurl is not using http");
        var wsurl = Config.basewsurl();
        assert.notStrictEqual(wsurl.indexOf(Config.domain), -1, "domain missing from basewsurl");
        assert.notStrictEqual(wsurl.startsWith("ws://"), false, "basewsurl is not using http");


        let port = Config.port;
        Config.port = 12345;
        var url = Config.baseurl();
        assert.notStrictEqual(url.indexOf(":12345"), -1, "port missing from baseurl");
        var wsurl = Config.basewsurl();
        assert.notStrictEqual(wsurl.indexOf(":12345"), -1, "port missing from basewsurl");
        Config.port = port;
    }
    @test "parseBoolean"() {
        assert.strictEqual(Config.parseBoolean(true), true)
        assert.strictEqual(Config.parseBoolean(false), false)
        assert.strictEqual(Config.parseBoolean("true"), true)
        assert.strictEqual(Config.parseBoolean("false"), false)
        assert.strictEqual(Config.parseBoolean("hullu-bullu"), true)
        assert.strictEqual(Config.parseBoolean(1), true)
        assert.strictEqual(Config.parseBoolean(0), false)
        assert.throws(() => { Config.parseBoolean({}) }, Error, "parseBoolean did not fail on illegal arguement");
    }
    @test async "parse_federation_metadata"() {
        // var metadata = await Config.parse_federation_metadata(null, "https://login.microsoftonline.com/common/FederationMetadata/2007-06/FederationMetadata.xml");
        var metadata = await Config.parse_federation_metadata(null, "http://localhost:" + Config.port + "/issue/FederationMetadata/2007-06/FederationMetadata.xml");

        assert.ok(!Util.IsNullEmpty(metadata.identityProviderUrl))
        assert.ok(!Util.IsNullEmpty(metadata.entryPoint))
        assert.ok(!Util.IsNullEmpty(metadata.logoutUrl))
        assert.ok(Array.isArray(metadata.cert));
        assert.ok(metadata.cert.length > 0);
    }
}
// clear && ./node_modules/.bin/_mocha "src/test/**/Config.test.ts"