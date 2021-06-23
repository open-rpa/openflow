const path = require("path");
const env = path.join(process.cwd(), 'config', '.env');
require("dotenv").config({ path: env }); // , debug: false 
import { suite, test } from '@testdeck/mocha';
import { Config } from "../OpenFlow/src/Config";
import { DatabaseConnection } from '../OpenFlow/src/DatabaseConnection';
import assert = require('assert');
import { Logger } from '../OpenFlow/src/Logger';
import { NoderedUtil } from '@openiap/openflow-api';

@suite class OpenFlowConfigTests {
    async before() {
        Logger.configure(true, false);
        Config.db = new DatabaseConnection(Config.mongodb_url, Config.mongodb_db);
        await Config.db.connect(null);
    }
    async after() {
        await Config.db.shutdown();
        Logger.otel.shutdown();
    }
    @test 'reload'() {
        Config.reload();
    }
    @test 'baseurl'() {
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
    @test 'parseBoolean'() {
        assert.strictEqual(Config.parseBoolean(true), true)
        assert.strictEqual(Config.parseBoolean(false), false)
        assert.strictEqual(Config.parseBoolean("true"), true)
        assert.strictEqual(Config.parseBoolean("false"), false)
        assert.strictEqual(Config.parseBoolean("hullu-bullu"), true)
        assert.strictEqual(Config.parseBoolean(1), true)
        assert.strictEqual(Config.parseBoolean(0), false)
        assert.throws(() => { Config.parseBoolean({}) }, Error, "parseBoolean did not fail on illegal arguement");
    }
    @test async 'parse_federation_metadata'() {
        var metadata = await Config.parse_federation_metadata("https://login.microsoftonline.com/common/FederationMetadata/2007-06/FederationMetadata.xml");
        assert.ok(!NoderedUtil.IsNullEmpty(metadata.identityProviderUrl))
        assert.ok(!NoderedUtil.IsNullEmpty(metadata.entryPoint))
        assert.ok(!NoderedUtil.IsNullEmpty(metadata.logoutUrl))
        assert.ok(Array.isArray(metadata.cert));
        assert.ok(metadata.cert.length > 0);
    }
}
