// import wtf from "wtfnode";
import { NoderedUtil, WebSocketClient } from "@openiap/openflow-api";
import { suite, test, timeout } from "@testdeck/mocha";
import assert from "assert";
import { Config } from "../Config.js";
import { Logger } from "../Logger.js";

@suite class basic_entities {
    private socket: WebSocketClient = null;
    @timeout(2000)
    async before() {
        Config.workitem_queue_monitoring_enabled = false;
        Config.disablelogging();
        await Logger.configure(true, false);
        if (!this.socket) this.socket = new WebSocketClient(null, "ws://localhost:" + Config.port, true);
        this.socket.agent = "test-cli";
        try {
            await this.socket.Connect();
            await NoderedUtil.SigninWithUsername({ username: "testuser", password: "testuser" });
        } catch (error) {
            if (error == null) error = new Error("Failed connecting to pc.openiap.io")
            throw error;
        }
    }
    @timeout(5000)
    async after() {
        await this.socket.close(1000, "Close by user");
        this.socket.events.removeAllListeners()
        await Logger.shutdown();
        // wtf.dump()
    }
    @timeout(500000)
    @test async "validate collectioname"() {
        await assert.rejects(NoderedUtil.Query({ query: { "_type": "test" }, collectionname: null }));
        await assert.rejects(NoderedUtil.Query({ query: { "_type": "test" }, collectionname: undefined }));
        await assert.rejects(NoderedUtil.Query({ query: { "_type": "test" }, collectionname: "" }));

        await assert.rejects(NoderedUtil.Query({ query: null, collectionname: "entities" }));
        await assert.rejects(NoderedUtil.Query({ query: undefined, collectionname: "entities" }));
        await assert.rejects(NoderedUtil.Query({ query: "", collectionname: "entities" }));

        await assert.rejects(NoderedUtil.Aggregate({ aggregates: [{ "$match": { "_type": "test" } }], collectionname: null }));
        await assert.rejects(NoderedUtil.Aggregate({ aggregates: [{ "$match": { "_type": "test" } }], collectionname: undefined }));
        await assert.rejects(NoderedUtil.Aggregate({ aggregates: [{ "$match": { "_type": "test" } }], collectionname: "" }));

        await assert.rejects(NoderedUtil.Aggregate({ aggregates: null, collectionname: "entities" }));
        await assert.rejects(NoderedUtil.Aggregate({ aggregates: undefined, collectionname: "entities" }));

        await assert.rejects(NoderedUtil.DeleteOne({ id: "625d73a451a60cfe7b70daa2", collectionname: null }));
        await assert.rejects(NoderedUtil.DeleteOne({ id: "625d73a451a60cfe7b70daa2", collectionname: undefined }));
        await assert.rejects(NoderedUtil.DeleteOne({ id: "625d73a451a60cfe7b70daa2", collectionname: "" }));

        await assert.rejects(NoderedUtil.DeleteOne({ id: null, collectionname: "entities" }));
        await assert.rejects(NoderedUtil.DeleteOne({ id: undefined, collectionname: "entities" }));
        await assert.rejects(NoderedUtil.DeleteOne({ id: "", collectionname: "entities" }));

        await assert.rejects(NoderedUtil.DeleteOne({ id: null, collectionname: "entities" }));
        await assert.rejects(NoderedUtil.DeleteOne({ id: undefined, collectionname: "entities" }));
        await assert.rejects(NoderedUtil.DeleteOne({ id: "", collectionname: "entities" }));

        await assert.rejects(NoderedUtil.DeleteMany({ query: { "_type": "test" }, collectionname: null }));
        await assert.rejects(NoderedUtil.DeleteMany({ query: { "_type": "test" }, collectionname: undefined }));
        await assert.rejects(NoderedUtil.DeleteMany({ query: { "_type": "test" }, collectionname: "" }));

        await assert.rejects(NoderedUtil.DropCollection({ collectionname: null }));
        await assert.rejects(NoderedUtil.DropCollection({ collectionname: undefined }));
        await assert.rejects(NoderedUtil.DropCollection({ collectionname: "" }));

    }
    @timeout(5000)
    @test async "querytest"() {
        await NoderedUtil.DeleteMany({ query: { "_type": "test" }, collectionname: "entities" });

        let item = await NoderedUtil.InsertOne({ item: { "_type": "test", "name": "test entities item" }, collectionname: "entities" });
        assert.strictEqual(item.name, "test entities item");
        assert.strictEqual(item._type, "test");
        item.name = "test entities item updated"
        item = await NoderedUtil.UpdateOne({ item: item, collectionname: "entities" });
        assert.strictEqual(item.name, "test entities item updated");

        let items = await NoderedUtil.Query({ query: { "_type": "test" }, collectionname: "entities" });
        assert.strictEqual(items.length, 1);
        item = items[0];
        assert.strictEqual(item.name, "test entities item updated");

        await NoderedUtil.DeleteOne({ id: item._id, collectionname: "entities" });

        items = await NoderedUtil.Query({ query: { "_type": "test" }, collectionname: "entities" });
        assert.strictEqual(items.length, 0);

        items = [];
        items.push({ name: "test item 1", "_type": "test" });
        items.push({ name: "test item 2", "_type": "test" });
        items.push({ name: "test item 3", "_type": "test" });
        items.push({ name: "test item 4", "_type": "test" });
        items.push({ name: "test item 5", "_type": "test" });
        items = await NoderedUtil.InsertMany({ items: items, collectionname: "entities", skipresults: false });
        assert.strictEqual(items.length, 5);
        for (var i = 0; i < items.length; i++) {
            item = items[i];
            assert.notStrictEqual(["test item 1", "test item 2", "test item 3", "test item 4", "test item 5"].indexOf(item.name), -1, "Failed matching name on item");
            assert.strictEqual(item._type, "test");
            assert.notStrictEqual(item._created, undefined);
            assert.notStrictEqual(item._created, null);
        }
        items = await NoderedUtil.Query({ query: { "_type": "test" }, collectionname: "entities" });
        assert.strictEqual(items.length, 5);
        for (var i = 0; i < items.length; i++) {
            item = items[i];
            assert.notStrictEqual(["test item 1", "test item 2", "test item 3", "test item 4", "test item 5"].indexOf(item.name), -1, "Failed matching name on item");
            assert.strictEqual(item._type, "test");
            assert.notStrictEqual(item._created, undefined);
            assert.notStrictEqual(item._created, null);
        }

        items = await NoderedUtil.Query({ query: { "_type": "test" }, collectionname: "entities" });
        let ids = items.map(x => x._id);
        if (ids.length > 0) await NoderedUtil.DeleteMany({ ids, collectionname: "entities" });

        items = await NoderedUtil.Query({ query: { "_type": "test" }, collectionname: "entities" });
        assert.strictEqual(items.length, 0, "Failed cleaning up");
    }
}
// clear && ./node_modules/.bin/_mocha "src/test/**/basic_entities.test.ts"
