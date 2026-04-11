import { suite, test, timeout } from "@testdeck/mocha";
import assert from "assert";
import * as fc from "fast-check";
import { Config } from "../Config.js";
import { Crypt } from "../Crypt.js";
import { Util } from "../Util.js";
import { amqpwrapper } from "../amqpwrapper.js";
import { testConfig } from "./testConfig.js";

@suite class amqp_property_tests {
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

    @timeout(15000)
    @test async "queue with generated message payloads"() {
        await fc.assert(fc.asyncProperty(
            fc.string({ minLength: 1, maxLength: 200 }),
            async (payload) => {
                const queuename = "testprop_" + Util.GetUniqueIdentifier(8);
                var q = await this.amqp.AddQueueConsumer(testConfig.testUser, queuename, null, Crypt.rootToken(), async (msg, options, ack) => {
                    if (!Util.IsNullEmpty(options.replyTo)) {
                        await this.amqp.send(options.exchangename, options.replyTo, "echo:" + msg, 1500, options.correlationId, options.routingKey, null, 1);
                    }
                    ack();
                }, null);
                assert.ok(!Util.IsNullEmpty(q.queuename));

                var reply = await this.amqp.sendWithReply(null, queuename, payload, 2000, null, null, null);
                assert.strictEqual(reply, "echo:" + payload);

                await this.amqp.RemoveQueueConsumer(testConfig.testUser, q, null);
            }
        ), { numRuns: 5 });
    }

    @timeout(10000)
    @test async "sendWithReply times out for nonexistent queue"() {
        await fc.assert(fc.asyncProperty(
            fc.stringMatching(/^nonexistent_q_[a-z0-9]{6,10}$/),
            async (queuename) => {
                var reply = await this.amqp.sendWithReply("", queuename, "hello", 500, null, null, null);
                assert.strictEqual(reply, "timeout");
            }
        ), { numRuns: 3 });
    }

    @timeout(15000)
    @test async "exchange with generated payloads"() {
        const exchangename = "testprop_exchange_" + Util.GetUniqueIdentifier(8);
        var q = await this.amqp.AddExchangeConsumer(testConfig.testUser, exchangename, "direct", "", null, Crypt.rootToken(), true, async (msg, options, ack) => {
            if (!Util.IsNullEmpty(options.replyTo)) {
                var parsed = JSON.parse(msg);
                await this.amqp.send("", options.replyTo, JSON.stringify({ echo: parsed.data }), 1500, options.correlationId, "", null, 1);
            }
            ack();
        }, null);

        // Give rabbitmq time to set up
        await new Promise(resolve => setTimeout(resolve, 500));

        await fc.assert(fc.asyncProperty(
            fc.string({ minLength: 1, maxLength: 100 }),
            async (data) => {
                var reply = await this.amqp.sendWithReply(exchangename, "", { data }, 2000, null, null, null);
                var parsed = JSON.parse(reply);
                assert.strictEqual(parsed.echo, data);
            }
        ), { numRuns: 5 });

        await this.amqp.RemoveQueueConsumer(testConfig.testUser, q.queue, null);
    }
}
// clear && ./node_modules/.bin/_mocha "src/test/**/amqp2.test.ts"
