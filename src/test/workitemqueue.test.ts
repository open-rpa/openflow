import { AddWorkitem, MessageWorkitemFile, NoderedUtil, WebSocketClient, Workitem } from "@openiap/openflow-api";
import { suite, test, timeout } from "@testdeck/mocha";
import assert from "assert";
import fs from "fs";
import pako from "pako";
import path from "path";
import { fileURLToPath } from "url";
import { Config } from "../Config.js";
import { testConfig } from "./testConfig.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

@suite class workitemqueue {
    private socket: WebSocketClient = null;
    @timeout(2000)
    async before() {
        await testConfig.configure();
        if (!this.socket) this.socket = new WebSocketClient(null, "ws://localhost:" + Config.port, true);
        this.socket.agent = "test-cli";
        await this.socket.Connect();
        await NoderedUtil.SigninWithUsername({ username: testConfig.testUser.username, password: testConfig.testPassword });
    }
    @timeout(5000)
    async after() {
        await this.socket.close(1000, "Close by user");
        this.socket.events.removeAllListeners()
        await testConfig.cleanup();
    }
    @timeout(10000)
    @test
    async "basic workitem test"() {
        let q = await NoderedUtil.GetWorkitemQueue({ name: "test queue" });
        if (q == null) q = await NoderedUtil.AddWorkitemQueue({ name: "test queue" });
        assert.notStrictEqual(q, null, "Failed getting test queue");
        assert.notStrictEqual(q, undefined, "Failed getting test queue");

        let item: Workitem;
        do {
            item = await NoderedUtil.PopWorkitem({ wiq: q.name });
            if (item != null) await NoderedUtil.UpdateWorkitem({ _id: item._id, state: "successful" });
        } while (item != null)

        item = await NoderedUtil.AddWorkitem({ name: "Test Work Item", payload: { "find": "me" }, wiq: q.name });
        assert.notStrictEqual(item, null, "Failed adding test work item");
        assert.notStrictEqual(item, undefined, "Failed adding test work item");
        assert.strictEqual(item.name, "Test Work Item", "Failed matching name on new work item");
        assert.strictEqual(item.state, "new", "New Workitem is not in status new");

        item = await NoderedUtil.PopWorkitem({ wiq: q.name });
        assert.notStrictEqual(item, null, "Failed getting test work item");
        assert.notStrictEqual(item, undefined, "Failed getting test work item");
        assert.strictEqual(item.name, "Test Work Item", "Failed matching name on work item");
        assert.strictEqual(item.state, "processing", "Updated Workitem is not in state processing");

        item = await NoderedUtil.UpdateWorkitem({ _id: item._id });

        let testitem = await NoderedUtil.PopWorkitem({ wiq: q.name });
        assert.strictEqual(testitem, undefined, "Failed queue test, can still pop items while processing the added item!");

        item = await NoderedUtil.UpdateWorkitem({ _id: item._id, state: "retry" });
        assert.strictEqual(item.state, "new", "Workitem sent for retry is not in status new");

        item = await NoderedUtil.PopWorkitem({ wiq: q.name });
        assert.strictEqual(item.state, "processing");
        assert.notStrictEqual(item, null, "Failed getting test work item");
        assert.notStrictEqual(item, undefined, "Failed getting test work item");
        assert.strictEqual(item.name, "Test Work Item", "Failed matching name on work item");
        await NoderedUtil.UpdateWorkitem({ _id: item._id, state: "successful" });

        // await NoderedUtil.UpdateWorkitem({ _id: item._id, state: "successful" });
    }
    public static async CreateWorkitemFilesArray(files: string[], compressed: boolean): Promise<MessageWorkitemFile[]> {
        var result: MessageWorkitemFile[] = [];
        for (var i = 0; i < files.length; i++) {
            let file: MessageWorkitemFile = new MessageWorkitemFile();
            file.filename = path.basename(files[i]);
            if (fs.existsSync(files[i])) {
                if (compressed) {
                    file.compressed = true;
                    file.file = Buffer.from(pako.deflate(fs.readFileSync(files[i], null))).toString("base64");
                } else {
                    file.file = fs.readFileSync(files[i], { encoding: "base64" });
                }
                result.push(file);
            } else { throw new Error("File not found " + files[i]) }
        }
        return result;
    }
    @timeout(10000)
    @test async "basic workitem test with files"() {
        let q = await NoderedUtil.GetWorkitemQueue({ name: "test queue" });
        if (q == null) q = await NoderedUtil.AddWorkitemQueue({ name: "test queue" });
        assert.notStrictEqual(q, null, "Failed getting test queue");
        assert.notStrictEqual(q, undefined, "Failed getting test queue");

        let item: Workitem;
        do {
            item = await NoderedUtil.PopWorkitem({ wiq: q.name });
            if (item != null) await NoderedUtil.UpdateWorkitem({ _id: item._id, state: "successful" });
        } while (item != null)


        item = await NoderedUtil.AddWorkitem({
            name: "Test Work Item with files", payload: { "find": "me" }, wiq: q.name,
            files: await workitemqueue.CreateWorkitemFilesArray([__filename], true)
        });
        assert.notStrictEqual(item, null, "Failed adding Test Work Item with files");
        assert.notStrictEqual(item, undefined, "Failed adding Test Work Item with files");
        assert.strictEqual(item.name, "Test Work Item with files", "Failed matching name on new work item");
        assert.strictEqual(item.state, "new");

        item = await NoderedUtil.PopWorkitem({ wiq: q.name });
        assert.notStrictEqual(item, null, "Failed getting Test Work Item with files");
        assert.notStrictEqual(item, undefined, "Failed getting Test Work Item with files");
        assert.strictEqual(item.files.length, 1);
        assert.strictEqual(item.name, "Test Work Item with files", "Failed matching name on work item");
        assert.strictEqual(item.state, "processing");

        item = await NoderedUtil.UpdateWorkitem({
            _id: item._id,
            files: await workitemqueue.CreateWorkitemFilesArray([path.join(__dirname, "../..", "tsconfig.json")], false)
        });

        let testitem = await NoderedUtil.PopWorkitem({ wiq: q.name });
        assert.strictEqual(testitem, undefined, "Failed queue test, can still pop items while processing the added item!");

        item = await NoderedUtil.UpdateWorkitem({ _id: item._id, state: "retry" });
        assert.strictEqual(item.state, "new");
        assert.strictEqual(item.files.length, 2);

        item = await NoderedUtil.PopWorkitem({ wiq: q.name });
        assert.strictEqual(item.state, "processing");
        assert.notStrictEqual(item, null, "Failed getting Test Work Item with files");
        assert.notStrictEqual(item, undefined, "Failed getting Test Work Item with files");
        assert.strictEqual(item.name, "Test Work Item with files", "Failed matching name on work item");
        assert.strictEqual(item.files.length, 2);
        await NoderedUtil.UpdateWorkitem({ _id: item._id, state: "successful" });

        // await NoderedUtil.UpdateWorkitem({ _id: item._id, state: "successful" });
    }
    @timeout(10000)
    @test async "multiple workitem test with files"() {
        let q = await NoderedUtil.GetWorkitemQueue({ name: "test queue" });
        if (q == null) q = await NoderedUtil.AddWorkitemQueue({ name: "test queue" });
        assert.notStrictEqual(q, null, "Failed getting test queue");
        assert.notStrictEqual(q, undefined, "Failed getting test queue");

        let item: Workitem;
        do {
            item = await NoderedUtil.PopWorkitem({ wiq: q.name });
            if (item != null) await NoderedUtil.UpdateWorkitem({ _id: item._id, state: "successful" });
        } while (item != null)

        const items: AddWorkitem[] = [];
        items.push(AddWorkitem.parse({ name: "multi item 1", files: await workitemqueue.CreateWorkitemFilesArray([__filename], true) }));
        items.push(AddWorkitem.parse({ name: "multi item 2", files: await workitemqueue.CreateWorkitemFilesArray([__filename], true) }));
        items.push(AddWorkitem.parse({ name: "multi item 3", files: await workitemqueue.CreateWorkitemFilesArray([__filename], true) }));


        await NoderedUtil.AddWorkitems({ items, wiq: q.name })
        for (var i = 0; i < 3; i++) {
            item = await NoderedUtil.PopWorkitem({ wiq: q.name, });
            assert.notStrictEqual(item, null, "Failed getting test work item");
            assert.notStrictEqual(item, undefined, "Failed getting test work item");
            assert.strictEqual(item.files.length, 1);
            assert.notStrictEqual(["multi item 1", "multi item 2", "multi item 3"].indexOf(item.name), -1, "Failed matching name on work item");
            assert.strictEqual(item.state, "processing");

            item = await NoderedUtil.UpdateWorkitem({
                _id: item._id,
                files: await workitemqueue.CreateWorkitemFilesArray([path.join(__dirname, "../..", "tsconfig.json")], false)
            });
            assert.strictEqual(item.files.length, 2);
            await NoderedUtil.UpdateWorkitem({ _id: item._id, state: "successful" });

        }

        let testitem = await NoderedUtil.PopWorkitem({ wiq: q.name });
        assert.strictEqual(testitem, undefined, "Failed multiple queue test, can still pop items after processing the 3 items!");

    }
}
// clear && ./node_modules/.bin/_mocha "src/test/**/workitemqueue.test.ts"
