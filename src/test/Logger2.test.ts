import { suite, test, timeout } from "@testdeck/mocha";
import assert from "assert";
import { Config } from "../Config.js";
import { Logger } from "../Logger.js";
import { Util } from "../Util.js";
import { testConfig } from "./testConfig.js";

@suite class logger_property_tests {
    @timeout(10000)
    async before() {
        await testConfig.configure();
    }
    async after() {
        await testConfig.cleanup();
    }

    @test "ofid returns consistent non-empty string"() {
        const id1 = Logger.ofid();
        const id2 = Logger.ofid();
        assert.ok(!Util.IsNullEmpty(id1), "ofid returned empty");
        assert.strictEqual(id1, id2, "ofid not stable across calls");
    }

    @test "isDocker returns boolean"() {
        const result = Logger.isDocker();
        assert.strictEqual(typeof result, "boolean");
    }

    @test "isKubernetes returns boolean"() {
        const result = Logger.isKubernetes();
        assert.strictEqual(typeof result, "boolean");
    }

    @test "getStackInfo returns structured info"() {
        const info = Logger.getStackInfo(0);
        assert.ok(info != null);
        assert.ok("method" in info);
        assert.ok("file" in info);
        assert.ok("line" in info);
        assert.ok("stack" in info);
        assert.ok(typeof info.stack === "string");
    }

    @test "getStackInfo with different indices"() {
        for (let i = 0; i < 5; i++) {
            const info = Logger.getStackInfo(i);
            assert.ok(info != null);
            assert.ok("method" in info);
        }
    }

    @test async "configure is idempotent"() {
        const otelBefore = Logger.otel;
        const licenseBefore = Logger.License;
        Config.disablelogging();
        await Logger.configure(true, false);
        assert.ok(Logger.otel != null, "otel is null after reconfigure");
        assert.ok(Logger.License != null, "License is null after reconfigure");
    }

    @test async "reload updates enabled loggers"() {
        Config.log_cache = true;
        Config.log_amqp = true;
        await Logger.reload();
        assert.ok(Logger.enabled["DBHelper"] != null, "DBHelper not enabled after log_cache=true");
        assert.ok(Logger.enabled["amqpwrapper"] != null, "amqpwrapper not enabled after log_amqp=true");

        Config.log_cache = false;
        Config.log_amqp = false;
        await Logger.reload();
    }
}
// clear && ./node_modules/.bin/_mocha "src/test/**/Logger.test2.ts"
