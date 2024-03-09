var wtf = require('wtfnode');
import * as wtf from "wtfnode";
const env = path.join(process.cwd(), 'config', '.env');
import * as crypto from "crypto";
import * as path from "path";
require("dotenv").config({ path: env }); // , debug: false 
import { AddWorkitem, ApiConfig, NoderedUtil, WebSocketClient, Workitem } from '@openiap/openflow-api';
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
            var logger: any =
            {
                info(msg) { console.log(i + ") " + msg); },
                verbose(msg) { console.debug(i + ") " + msg); },
                error(msg) { console.error(i + ") " + msg); },
                debug(msg) { console.log(i + ") " + msg); },
                silly(msg) { console.log(i + ") " + msg); }
            }
            // ApiConfig.log_trafic_verbose = true;
            // ApiConfig.log_trafic_silly = true;
            // ApiConfig.log_information = true;
            var websocket = new WebSocketClient(logger, "wss://pc.openiap.io", true);
            let randomNum = crypto.randomInt(1, 5)
            websocket.agent = "openrpa";
            if (randomNum == 1) websocket.agent = "nodered";
            if (randomNum == 3) websocket.agent = "webapp";
            websocket.agent = websocket.agent + i;
            await websocket.Connect();
            if (NoderedUtil.IsNullEmpty(this.jwt)) {
                var signin = await NoderedUtil.SigninWithUsername({ username: "testuser", password: "testuser", websocket });
                this.jwt = signin.jwt;
            } else {
                await NoderedUtil.SigninWithToken({ jwt: this.jwt, websocket });
            }
            this.clients.push(websocket);
            console.log("Client " + i + " connected and signed in");
            randomNum = crypto.randomInt(1, 50) + 15;
            setInterval(() => {
                if (websocket.agent = "openrpa") {
                    NoderedUtil.Query({ jwt: this.jwt, query: { "type": "workflow" }, collectionname: "openrpa", websocket });
                } else if (websocket.agent = "nodered") {
                    NoderedUtil.Query({ jwt: this.jwt, query: { "type": "flow" }, collectionname: "nodered", websocket });
                } else {
                    NoderedUtil.Query({ jwt: this.jwt, query: {}, collectionname: "entities", websocket });
                }
            }, 1000 * randomNum)
        } catch (error) {
            var e = error;
            if(error == null) {
                console.error("unknown error, is pc.openiap.io running ?");
            } else {
                console.error("unknown error", error);
            }            
        }
    }

    @timeout(6000000)
    @test
    async 'crud connection load test'() {
        // await this.createandconnect(0);
        // var Promises: Promise<any>[] = [];
        // for (var i = 0; i < 200; i++) {
        //     Promises.push(this.createandconnect(i));
        //     if (i && i % 10 == 0) {
        //         await Promise.all(Promises.map(p => p.catch(e => e)))
        //         Promises = [];
        //     }
        // }
        // await this.sleep(1000 * 60 * 30);
    }
}
// cd \code\openflow | node_modules\.bin\_mocha 'test/**/loadtest.test.ts'
// clear && ./node_modules/.bin/_mocha 'test/**/loadtest.test.ts'
