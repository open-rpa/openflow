import { suite, test, timeout } from "@testdeck/mocha";
import { Config } from "../Config.js";
import { DatabaseConnection } from "../DatabaseConnection.js";
import assert from "assert";
import { Logger } from "../Logger.js";
import { NoderedUtil, User } from "@openiap/openflow-api";
import { Crypt } from "../Crypt.js";
import { amqpwrapper } from "../amqpwrapper.js";

@suite class amqp_test {
    private rootToken: string;
    private testUser: User;
    private amqp: amqpwrapper;
    @timeout(10000)
    async before() {
        Config.workitem_queue_monitoring_enabled = false;
        Config.disablelogging();
        await Logger.configure(true, false);
        Config.db = new DatabaseConnection(Config.mongodb_url, Config.mongodb_db, false);
        await Config.db.connect(null);
        await Config.Load(null);
        this.rootToken = Crypt.rootToken();
        try {
            this.testUser = await Logger.DBHelper.FindByUsername("testuser", this.rootToken, null)
        } catch (error) {
            console.error("Error finding testuser: " + error);            
        }
        this.amqp = new amqpwrapper(Config.amqp_url);
        amqpwrapper.SetInstance(this.amqp);
        Config.log_amqp = false;
        await this.amqp.connect(null);
    }
    @timeout(5000)
    async after() {
        this.amqp?.shutdown();
        await Logger.shutdown();
    }
    // @test async "connecterror"() {
    //     // var amqp = new amqpwrapper("bogus://url");
    //     // await assert.rejects( await amqp.connect(null));
    // }
    @timeout(5000)
    @test async "queuetest"() {
        const queuename = "demotestqueue";
        var q = await this.amqp.AddQueueConsumer(this.testUser, queuename, null, this.rootToken, async (msg, options, ack) => {
            if (!NoderedUtil.IsNullEmpty(options.replyTo)) {
                if (msg == "hi mom, i miss you") {
                    msg = "hi";
                } else {
                    msg = "unknown message";
                }                
                // console.log("send reply to " + options.replyTo + " / " + options.routingKey);
                await this.amqp.send(options.exchangename, options.replyTo, msg, 1500, options.correlationId, options.routingKey, null, 1);
            }
            ack();
        }, null);
        assert.ok(!NoderedUtil.IsNullUndefinded(q));
        assert.ok(!NoderedUtil.IsNullEmpty(q.queuename));

        reply = await this.amqp.sendWithReply(null, queuename, "hi mom, i miss you", 300, null, null, null);
        assert.strictEqual(reply, "hi");


        var reply = await this.amqp.sendWithReply(null, queuename, "hi mom, i miss you", 300, null, null, null);
        assert.strictEqual(reply, "hi");
        await this.amqp.RemoveQueueConsumer(this.testUser, q, null);
        reply = await this.amqp.sendWithReply("", "bogusName", "hi mom, i miss you", 300, null, null, null);
        assert.strictEqual(reply, "timeout");

        // why does this die ? after sending to bogusName
        // reply = await this.amqp.sendWithReply(null, queuename, "hi mom, i miss you", 300, null, null);
        // assert.strictEqual(reply, "timeout");
    }
    @timeout(5000)
    @test
    async "personalqueuetest"() {
        var q = await this.amqp.AddQueueConsumer(this.testUser, this.testUser._id, null, this.rootToken, async (msg, options, ack) => {
            if (!NoderedUtil.IsNullEmpty(options.replyTo)) {
                if (msg.indexOf("hi mom, i miss you") > -1) {
                    msg = JSON.stringify({"test": "hi"});
                } else {
                    msg = JSON.stringify({"test": "unknown message"});
                }
                await this.amqp.send(options.exchangename, options.replyTo, msg, 1500, options.correlationId, options.routingKey, null, 1);
            }
            ack();
        }, null);
        assert.ok(!NoderedUtil.IsNullUndefinded(q));
        assert.ok(!NoderedUtil.IsNullEmpty(q.queuename));
        var reply = await this.amqp.sendWithReply(null, this.testUser._id, {"test": "hi mom, i miss you"}, 300, null, null, null);
        assert.notStrictEqual (reply.indexOf("hi"), -1);
        await this.amqp.RemoveQueueConsumer(this.testUser, q, null);
        reply = await this.amqp.sendWithReply("", "bogusName", {"test": "hi mom, i miss you"}, 300, null, null, null);
        assert.notStrictEqual (reply.indexOf("timeout"), -1);

        // why does this die ? after sending to bogusName
        // reply = await this.amqp.sendWithReply(null, this.testUser._id, "hi mom, i miss you", 300, null, null);
        // assert.strictEqual(reply, "timeout");
    }
    @timeout(5000)
    @test
    async "exchangetest"() {
        const exchangename = "demotestexchange";
        var q = await this.amqp.AddExchangeConsumer(this.testUser, exchangename, "direct", "", null, this.rootToken, true, async (msg, options, ack) => {
            if (!NoderedUtil.IsNullEmpty(options.replyTo)) {
                if (msg.indexOf("hi mom, i miss you") > -1) {
                    msg = JSON.stringify({"test": "hi"});
                } else {
                    msg = JSON.stringify({"test": "unknown message"});
                }
                await this.amqp.send("", options.replyTo, msg, 1500, options.correlationId, "", null, 1);
            }
            ack();
        }, null);
        // Give rabbitmq a little room
        await new Promise(resolve => { setTimeout(resolve, 1000) })
        var reply = await this.amqp.sendWithReply(exchangename, "", {"test": "hi mom, i miss you"}, 300, null, null, null);
        assert.notStrictEqual (reply.indexOf("hi"), -1);
        var reply = await this.amqp.sendWithReply(exchangename, "", {"test": "hi dad, i miss you"}, 300, null, null, null);
        assert.notStrictEqual (reply.indexOf("unknown message"), -1);
        var reply = await this.amqp.sendWithReply(exchangename, "", {"test": "hi mom, i miss you"}, 300, null, null, null);
        assert.notStrictEqual (reply.indexOf("hi"), -1);
        await this.amqp.RemoveQueueConsumer(this.testUser, q.queue, null);
        await assert.rejects(this.amqp.RemoveQueueConsumer(this.testUser, null, null));
    }
}
// clear && ./node_modules/.bin/_mocha "OpenFlow/src/test/amqp.test.ts"