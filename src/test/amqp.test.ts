import { suite, test, timeout } from "@testdeck/mocha";
import assert from "assert";
import { Crypt } from "../Crypt.js";
import { Util } from "../Util.js";
import { testConfig } from "./testConfig.js";
import { amqpwrapper } from "../amqpwrapper.js";
import { Config } from "../Config.js";
@suite class amqp_test {
    amqp: amqpwrapper;
    @timeout(10000)
    async before() {
        await testConfig.configure();
        this.amqp = new amqpwrapper(Config.amqp_url);
        amqpwrapper.SetInstance(this.amqp);
        Config.log_amqp = false;
        await this.amqp.connect(null);
    }
    @timeout(5000)
    async after() {
        this.amqp?.shutdown();
        await testConfig.cleanup();
    }
    @timeout(5000)
    @test async "queuetest"() {
        const queuename = "demotestqueue";
        var q = await this.amqp.AddQueueConsumer(testConfig.testUser, queuename, null, Crypt.rootToken(), async (msg, options, ack) => {
            if (!Util.IsNullEmpty(options.replyTo)) {
                if (msg == "hi mom, i miss you") {
                    msg = "hi";
                } else {
                    msg = "unknown message";
                }
                await this.amqp.send(options.exchangename, options.replyTo, msg, 1500, options.correlationId, options.routingKey, null, 1);
            }
            ack();
        }, null);
        assert.ok(!Util.IsNullUndefinded(q));
        assert.ok(!Util.IsNullEmpty(q.queuename));

        reply = await this.amqp.sendWithReply(null, queuename, "hi mom, i miss you", 300, null, null, null);
        assert.strictEqual(reply, "hi");


        var reply = await this.amqp.sendWithReply(null, queuename, "hi mom, i miss you", 300, null, null, null);
        assert.strictEqual(reply, "hi");
        await this.amqp.RemoveQueueConsumer(testConfig.testUser, q, null);
        reply = await this.amqp.sendWithReply("", "bogusName", "hi mom, i miss you", 300, null, null, null);
        assert.strictEqual(reply, "timeout");

        // why does this die ? after sending to bogusName
        // reply = await this.amqp.sendWithReply(null, queuename, "hi mom, i miss you", 300, null, null);
        // assert.strictEqual(reply, "timeout");
    }
    @timeout(5000)
    @test
    async "personalqueuetest"() {
        var q = await this.amqp.AddQueueConsumer(testConfig.testUser, testConfig.testUser._id, null, Crypt.rootToken(), async (msg, options, ack) => {
            if (!Util.IsNullEmpty(options.replyTo)) {
                if (msg.indexOf("hi mom, i miss you") > -1) {
                    msg = JSON.stringify({ "test": "hi" });
                } else {
                    msg = JSON.stringify({ "test": "unknown message" });
                }
                await this.amqp.send(options.exchangename, options.replyTo, msg, 1500, options.correlationId, options.routingKey, null, 1);
            }
            ack();
        }, null);
        assert.ok(!Util.IsNullUndefinded(q));
        assert.ok(!Util.IsNullEmpty(q.queuename));
        var reply = await this.amqp.sendWithReply(null, testConfig.testUser._id, { "test": "hi mom, i miss you" }, 300, null, null, null);
        assert.notStrictEqual(reply.indexOf("hi"), -1);
        await this.amqp.RemoveQueueConsumer(testConfig.testUser, q, null);
        reply = await this.amqp.sendWithReply("", "bogusName", { "test": "hi mom, i miss you" }, 300, null, null, null);
        assert.notStrictEqual(reply.indexOf("timeout"), -1);

        // why does this die ? after sending to bogusName
        // reply = await this.amqp.sendWithReply(null, testConfig.testUser._id, "hi mom, i miss you", 300, null, null);
        // assert.strictEqual(reply, "timeout");
    }
    @timeout(5000)
    @test
    async "exchangetest"() {
        const exchangename = "demotestexchange";
        var q = await this.amqp.AddExchangeConsumer(testConfig.testUser, exchangename, "direct", "", null, Crypt.rootToken(), true, async (msg, options, ack) => {
            if (!Util.IsNullEmpty(options.replyTo)) {
                if (msg.indexOf("hi mom, i miss you") > -1) {
                    msg = JSON.stringify({ "test": "hi" });
                } else {
                    msg = JSON.stringify({ "test": "unknown message" });
                }
                await this.amqp.send("", options.replyTo, msg, 1500, options.correlationId, "", null, 1);
            }
            ack();
        }, null);
        // Give rabbitmq a little room
        await new Promise(resolve => { setTimeout(resolve, 1000) })
        var reply = await this.amqp.sendWithReply(exchangename, "", { "test": "hi mom, i miss you" }, 300, null, null, null);
        assert.notStrictEqual(reply.indexOf("hi"), -1);
        var reply = await this.amqp.sendWithReply(exchangename, "", { "test": "hi dad, i miss you" }, 300, null, null, null);
        assert.notStrictEqual(reply.indexOf("unknown message"), -1);
        var reply = await this.amqp.sendWithReply(exchangename, "", { "test": "hi mom, i miss you" }, 300, null, null, null);
        assert.notStrictEqual(reply.indexOf("hi"), -1);
        await this.amqp.RemoveQueueConsumer(testConfig.testUser, q.queue, null);
        await assert.rejects(this.amqp.RemoveQueueConsumer(testConfig.testUser, null, null));
    }
}
// clear && ./node_modules/.bin/_mocha "src/test/amqp.test.ts"