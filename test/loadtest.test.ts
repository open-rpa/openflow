var wtf = require('wtfnode');
const path = require("path");
const env = path.join(process.cwd(), 'config', '.env');
require("dotenv").config({ path: env }); // , debug: false 
import { AddWorkitem, NoderedUtil, WebSocketClient, Workitem } from '@openiap/openflow-api';
import { suite, test, timeout } from '@testdeck/mocha';
import assert = require('assert');
import { Config } from '../OpenFlow/src/Config';
import { Logger } from '../OpenFlow/src/Logger';

@suite class loadtest {
    public clients: WebSocketClient[] = [];

    @timeout(10000)
    async before() {
        Config.workitem_queue_monitoring_enabled = false;
        Config.disablelogging();
        Logger.configure(true, false);
    }
    @timeout(5000)
    async after() {
        for (var i = 0; i < this.clients.length; i++) {
            await this.clients[i].close(1000, "Close by user");
            this.clients[i].events.removeAllListeners()
        }
        await Logger.shutdown();
        // wtf.dump()
    }
    sleep(ms) {
        return new Promise(resolve => {
            setTimeout(resolve, ms)
        })
    }
    public jwt: string = "";
    public async createandconnect(i: number) {
        try {
            console.log("Creating client " + i);
            var websocket = new WebSocketClient(null, "wss://pc.openiap.io", true);
            websocket.agent = "test-cli";
            await websocket.Connect();
            if (NoderedUtil.IsNullEmpty(this.jwt)) {
                var signin = await NoderedUtil.SigninWithUsername({ username: "testuser", password: "testuser", websocket });
                this.jwt = signin.jwt;
            } else {
                await NoderedUtil.SigninWithToken({ jwt: this.jwt, websocket });
            }
            this.clients.push(websocket);
            console.log("Client " + i + " connected and signed in");
        } catch (error) {
            console.error(error);
        }
    }

    @timeout(6000000)
    // @test
    async 'crud connection load test'() {
        var Promises: Promise<any>[] = [];
        for (var i = 0; i < 1000; i++) {
            Promises.push(this.createandconnect(i));
            if (i && i % 100 == 0) {
                await Promise.all(Promises.map(p => p.catch(e => e)))
                Promises = [];
            }
        }
        await this.sleep(60000);
    }
}
// cls | ./node_modules/.bin/_mocha 'test/**/loadtest.test.ts'
