import { NoderedUtil, WebSocketClient } from "@openiap/openflow-api";
import { suite, test, timeout } from "@testdeck/mocha";
import * as crypto from "crypto";
import { Config } from "../Config.js";
import { testConfig } from "./testConfig.js";

@suite class loadtest {
    public clients: WebSocketClient[] = [];

    @timeout(10000)
    async before() {
        await testConfig.configure();
    }
    @timeout(5000)
    async after() {
        for (var i = 0; i < this.clients.length; i++) {
            await this.clients[i].close(1000, "Close by user");
            this.clients[i].events.removeAllListeners()
        }
        await testConfig.cleanup();
    }
    sleep(ms) {
        return new Promise(resolve => {
            setTimeout(resolve, ms)
        })
    }
    public jwt: string = "";
    public async createandconnect(i: number) {
        try {
            // console.log("Creating client " + i);
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

            var websocket = new WebSocketClient(logger, "ws://localhost:" + Config.port, true);
            let randomNum = crypto.randomInt(1, 5)
            websocket.agent = "openrpa";
            if (randomNum == 1) websocket.agent = "nodered";
            if (randomNum == 3) websocket.agent = "webapp";
            websocket.agent = websocket.agent;
            await websocket.Connect();
            this.jwt = testConfig.userToken;
            if (NoderedUtil.IsNullEmpty(this.jwt)) {
                var signin = await NoderedUtil.SigninWithUsername({ username: testConfig.testUser.username, password: testConfig.testPassword, websocket });
                this.jwt = signin.jwt; // password validating 200 users will kill the CPU
                // console.log("Client " + i + " signed in with jwt " + this.jwt?.substring(0, 10) + "...");
            } else {
                await NoderedUtil.SigninWithToken({ jwt: this.jwt, websocket });
                // console.log("Client " + i + " signed in with jwt " + this.jwt?.substring(0, 10) + "...");
            }
            this.clients.push(websocket);
            // console.log("Client " + i + " connected and signed in");
            
            if (websocket.agent = "openrpa") {
                let arr = await NoderedUtil.Query({ jwt: this.jwt, query: { "_type": "workflowinstance" }, collectionname: "openrpa_instances", websocket });
                console.log("Client " + i + " recevied " + arr.length + " items from openrpa_instances");
                arr = await NoderedUtil.Query({ jwt: this.jwt, query: { "_type": "workflow" }, collectionname: "openrpa", websocket });
                console.log("Client " + i + " recevied " + arr.length + " items from openrpa");
            }
            randomNum = crypto.randomInt(1, 50) + 15;
            setInterval(async () => {
                if (websocket.agent = "openrpa") {
                    let arr = await NoderedUtil.Query({ jwt: this.jwt, query: { "_type": "workflow" }, collectionname: "openrpa", websocket });
                    console.log("Client " + i + " recevied " + arr.length + " items from openrpa");
                } else if (websocket.agent = "nodered") {
                    let arr = await NoderedUtil.Query({ jwt: this.jwt, query: { "_type": "flow" }, collectionname: "nodered", websocket });
                    console.log("Client " + i + " recevied " + arr.length + " items from nodered");
                } else {
                    let arr = await NoderedUtil.Query({ jwt: this.jwt, query: {}, collectionname: "entities", websocket });
                    console.log("Client " + i + " recevied " + arr.length + " items from entities");
                }
                // let arr = await NoderedUtil.Query({ jwt: this.jwt, query: { "_type": "workflowinstance" }, collectionname: "openrpa_instances", websocket });
                // console.log("Client " + i + " recevied " + arr.length + " items from openrpa_instances");
            }, 1000 * randomNum)
        } catch (error) {
            var e = error;
            if (error == null) {
                console.error("unknown error, is ws://localhost:" + Config.port + " running ?");
            } else {
                console.error("unknown error", error);
            }
        }
    }

    @timeout(6000000)
    @test async "crud connection load test"() {
        await this.createandconnect(0);
        var Promises: Promise<any>[] = [];
        for (var i = 0; i < 500; i++) {
            Promises.push(this.createandconnect(i));
            if (i && i % 10 == 0) {
                await Promise.all(Promises.map(p => p.catch(e => e)))
                Promises = [];
            }
        }
        await this.sleep(1000 * 60 * 30);
    }
}
// clear && ./node_modules/.bin/_mocha "src/test/**/loadtest.test.ts"

// node_modules\.bin\_mocha "src/test/**/loadtest.test.ts"
// clear && ./node_modules/.bin/_mocha "src/test/**/loadtest.test.ts"
