import { suite, test, timeout } from "@testdeck/mocha";
import { Config } from "../Config.js";
import { DatabaseConnection } from "../DatabaseConnection.js";
import assert from "assert";
import { Logger } from "../Logger.js";
import { NoderedUtil } from "@openiap/openflow-api";

@suite class Config_test {
    @timeout(10000)
    async before() {
        Config.workitem_queue_monitoring_enabled = false;
        Config.disablelogging();
        await Logger.configure(true, false);
        Config.db = new DatabaseConnection(Config.mongodb_url, Config.mongodb_db);
        await Config.db.connect(null);
        await Config.Load(null);
    }
    async after() {
        await Logger.shutdown();
    }
    @test "baseurl"() {
        assert.strictEqual(NoderedUtil.IsNullEmpty(Config.domain), false, "domain missing from baseurl");
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


        Config.port = 12345;
        var url = Config.baseurl();
        assert.notStrictEqual(url.indexOf(":12345"), -1, "port missing from baseurl");
        var wsurl = Config.basewsurl();
        assert.notStrictEqual(wsurl.indexOf(":12345"), -1, "port missing from basewsurl");
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
        var metadata = await Config.parse_federation_metadata(null, "https://login.microsoftonline.com/common/FederationMetadata/2007-06/FederationMetadata.xml");
        assert.ok(!NoderedUtil.IsNullEmpty(metadata.identityProviderUrl))
        assert.ok(!NoderedUtil.IsNullEmpty(metadata.entryPoint))
        assert.ok(!NoderedUtil.IsNullEmpty(metadata.logoutUrl))
        assert.ok(Array.isArray(metadata.cert));
        assert.ok(metadata.cert.length > 0);
    }
}
// clear && ./node_modules/.bin/_mocha "src/test/**/Config.test.ts"