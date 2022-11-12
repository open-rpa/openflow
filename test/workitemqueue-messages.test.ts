// var wtf = require('wtfnode');
const path = require("path");
const fs = require('fs');
const pako = require('pako');
const env = path.join(process.cwd(), 'config', '.env');
require("dotenv").config({ path: env }); // , debug: false 
import { Message } from "../OpenFlow/src/Messages/Message";
import { suite, test, timeout } from '@testdeck/mocha';
import { Config } from "../OpenFlow/src/Config";
import { DatabaseConnection } from '../OpenFlow/src/DatabaseConnection';
import assert = require('assert');
import { Logger } from '../OpenFlow/src/Logger';
import { NoderedUtil, User, SaveFileMessage } from '@openiap/openflow-api';
import { Crypt } from '../OpenFlow/src/Crypt';
import { AddWorkitemMessage, AddWorkitemQueueMessage, DeleteWorkitemMessage, DeleteWorkitemQueueMessage, GetWorkitemQueueMessage, PopWorkitemMessage, UpdateWorkitemMessage, UpdateWorkitemQueueMessage } from "@openiap/openflow-api";

@suite class workitemqueue_messages_test {
    private rootToken: string;
    private testUser: User;
    private userToken: string;
    @timeout(10000)
    async before() {
        Config.workitem_queue_monitoring_enabled = false;
        Config.disablelogging();
        Logger.configure(true, true);
        Config.db = new DatabaseConnection(Config.mongodb_url, Config.mongodb_db, false);
        await Config.db.connect(null);
        this.rootToken = Crypt.rootToken();
        this.testUser = await Logger.DBHelper.FindByUsername("testuser", this.rootToken, null)
        assert.ok(!NoderedUtil.IsNullUndefinded(this.testUser), "Test user missing, was user deleted ?");
        this.userToken = Crypt.createToken(this.testUser, Config.shorttoken_expires_in);
    }
    @timeout(10000)
    async after() {
        Config.workitem_queue_monitoring_enabled = false;
        await Logger.shutdown();
        // wtf.dump();
    }
    async GetItem(name) {
        var q: any = new GetWorkitemQueueMessage();
        var msg = new Message(); msg.jwt = this.userToken;
        q.name = name
        msg.data = JSON.stringify(q);
        await msg.EnsureJWT(null)
        await msg.GetWorkitemQueue(null);
        q = JSON.parse(msg.data);
        return q.result;
    }
    formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return '0 Bytes';

        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

        const i = Math.floor(Math.log(bytes) / Math.log(k));

        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }
    @timeout(5000)
    async 'Save File Base64'() {
        var filepath = "./config/invoice2.pdf";
        var filepath = "./config/invoice.zip";
        var filepath = "./config/invoice2.zip";
        var filepath = "./config/invoice.png";
        if (!(fs.existsSync(filepath))) return;
        var q: SaveFileMessage = new SaveFileMessage();
        q.filename = "base64" + path.basename(filepath);
        q.file = fs.readFileSync(filepath, { encoding: 'base64' });
        var msg = new Message(); msg.jwt = this.userToken;
        msg.data = JSON.stringify(q);
        await msg.EnsureJWT(null)
        await msg.SaveFile(null);
        q = JSON.parse(msg.data);
        assert.ok(!NoderedUtil.IsNullUndefinded(q), "msg data missing");
        assert.ok(NoderedUtil.IsNullUndefinded(q.error), q.error);
        assert.ok(!NoderedUtil.IsNullUndefinded(q.result), "no result");
        return q.result;
    }
    @timeout(5000)
    async 'Save File zlib'() {
        var filepath = "./config/invoice2.pdf";
        var filepath = "./config/invoice.zip";
        var filepath = "./config/invoice2.zip";
        var filepath = "./config/invoice.png";
        if (!(fs.existsSync(filepath))) return;
        var q: SaveFileMessage = new SaveFileMessage();
        (q as any).compressed = true;
        q.filename = "zlib" + path.basename(filepath);
        q.file = Buffer.from(pako.deflate(fs.readFileSync(filepath, null))).toString('base64');
        var msg = new Message(); msg.jwt = this.userToken;
        msg.data = JSON.stringify(q);
        await msg.EnsureJWT(null)
        await msg.SaveFile(null);
        q = JSON.parse(msg.data);
        assert.ok(!NoderedUtil.IsNullUndefinded(q), "msg data missing");
        assert.ok(NoderedUtil.IsNullUndefinded(q.error), q.error);
        assert.ok(!NoderedUtil.IsNullUndefinded(q.result), "no result");
        return q.result;
    }
    @timeout(5000)
    async 'Create update and delete test work item queue'() {
        var exists = await this.GetItem("test queue")
        if (exists) {
            await this["delete test work item queue"](null);
        }
        await this["Create work item queue"](null)
        exists = await this.GetItem("test queue")
        assert.ok(!NoderedUtil.IsNullUndefinded(exists), "work item queue not found after creation");
        await this["update test work item queue"](null);

        await this["delete test work item queue"](null);
    }
    @timeout(15000)
    @test async 'Workwith work item'() {
        await this['Create update and delete test work item queue']();
        var wiq = await this.GetItem("test queue")
        if (!wiq) {
            wiq = await this["Create work item queue"]('test queue')
        }
        var wi: any = { "_id": "62488f88bf045a7e58228f2f", files: [] }

        wi = await this["Create work item"](wiq);
        wi = await this["Update work item"](wi);



        var q: any = new PopWorkitemMessage();
        var msg = new Message(); msg.jwt = this.userToken;
        q.wiqid = wiq._id; q.wiq = wiq.name;
        msg.data = JSON.stringify(q);
        await msg.EnsureJWT(null)
        await msg.PopWorkitem(null);
        q = JSON.parse(msg.data);
        assert.ok(!NoderedUtil.IsNullUndefinded(q), "msg data missing");
        assert.ok(NoderedUtil.IsNullUndefinded(q.error), q.error);
        assert.ok(!NoderedUtil.IsNullUndefinded(q.result), "no result");
        wi = q.result



        await this["Delete work item"](wi);
    }
    @timeout(5000)
    async 'Delete work item'(wi) {
        var q: any = new DeleteWorkitemMessage();
        var msg = new Message(); msg.jwt = this.userToken;
        q._id = wi._id;
        msg.data = JSON.stringify(q);
        await msg.EnsureJWT(null)
        await msg.DeleteWorkitem(null);
        q = JSON.parse(msg.data);
        assert.ok(!NoderedUtil.IsNullUndefinded(q), "msg data missing");
        assert.ok(NoderedUtil.IsNullUndefinded(q.error), q.error);
    }
    @timeout(5000)
    async 'Update work item'(wi) {
        var q: any = new UpdateWorkitemMessage();
        var msg = new Message(); msg.jwt = this.userToken;
        q._id = wi._id;
        q.files = [];

        var filepath = "./config/invoice.pdf";
        if (fs.existsSync(filepath)) {
            var f = {
                compressed: true, filename: path.basename(filepath),
                file: Buffer.from(pako.deflate(fs.readFileSync(filepath, null))).toString('base64')
            }
            q.files.push(f);
        }
        msg.data = JSON.stringify(q);
        await msg.EnsureJWT(null)
        await msg.UpdateWorkitem(null);
        q = JSON.parse(msg.data);
        assert.ok(!NoderedUtil.IsNullUndefinded(q), "msg data missing");
        assert.ok(NoderedUtil.IsNullUndefinded(q.error), q.error);
        assert.ok(!NoderedUtil.IsNullUndefinded(q.result), "no result");
        return q.result;
    }
    @timeout(5000)
    async 'Create work item'(wiq) {
        var q: any = new AddWorkitemMessage();
        var msg = new Message(); msg.jwt = this.userToken;
        q.wiq = wiq.name;
        q.wiqid = wiq._id;
        q.files = [];
        var filepath = "./config/invoice2.pdf";
        if (fs.existsSync(filepath)) {
            var f = {
                compressed: true, filename: path.basename(filepath),
                file: Buffer.from(pako.deflate(fs.readFileSync(filepath, null))).toString('base64')
            }
            q.files.push(f);
        }
        var filepath = "./config/invoice.png";
        if (fs.existsSync(filepath)) {
            var f2 = {
                compressed: false, filename: path.basename(filepath),
                file: fs.readFileSync(filepath, { encoding: 'base64' })
            }
            q.files.push(f2);
        }
        msg.data = JSON.stringify(q);
        await msg.EnsureJWT(null)
        await msg.AddWorkitem(null);
        q = JSON.parse(msg.data);
        assert.ok(!NoderedUtil.IsNullUndefinded(q), "msg data missing");
        assert.ok(NoderedUtil.IsNullUndefinded(q.error), q.error);
        assert.ok(!NoderedUtil.IsNullUndefinded(q.result), "no result");
        return q.result;
    }

    @timeout(50000)
    async 'Create work item queue'(name) {
        var q: any = new AddWorkitemQueueMessage();
        q.maxretries = 3; q.retrydelay = 0; q.initialdelay = 0;
        var msg = new Message(); msg.jwt = this.userToken;
        q.name = name ? name : "test queue"
        msg.data = JSON.stringify(q);
        await msg.EnsureJWT(null)
        await msg.AddWorkitemQueue(null, null);
        q = JSON.parse(msg.data);
        assert.ok(!NoderedUtil.IsNullUndefinded(q), "msg data missing");
        assert.ok(NoderedUtil.IsNullUndefinded(q.error), q.error);
        assert.ok(!NoderedUtil.IsNullUndefinded(q.result), "no result");
        return q.result;
    }
    @timeout(50000)
    async 'update test work item queue'(name) {
        var q: any = new UpdateWorkitemQueueMessage();
        var msg = new Message(); msg.jwt = this.userToken;
        q.name = name ? name : "test queue"
        msg.data = JSON.stringify(q);
        await msg.EnsureJWT(null)
        await msg.UpdateWorkitemQueue(null);
        q = JSON.parse(msg.data);
        assert.ok(!NoderedUtil.IsNullUndefinded(q), "msg data missing");
        assert.ok(NoderedUtil.IsNullUndefinded(q.error), q.error);
        assert.ok(!NoderedUtil.IsNullUndefinded(q.result), "no result");
        return q.result;
    }
    @timeout(50000)
    async 'delete test work item queue'(name) {
        var q: any = new DeleteWorkitemQueueMessage();
        var msg = new Message(); msg.jwt = this.userToken;
        q.name = name ? name : "test queue";
        q.purge = true;
        msg.data = JSON.stringify(q);
        await msg.EnsureJWT(null)
        await msg.DeleteWorkitemQueue(null);
        q = JSON.parse(msg.data);
        assert.ok(!NoderedUtil.IsNullUndefinded(q), "msg data missing");
        assert.ok(NoderedUtil.IsNullUndefinded(q.error), q.error);
    }

}
// cls | ./node_modules/.bin/_mocha 'test/**/workitemqueue-messages.test.ts'