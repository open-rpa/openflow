import { SelectCustomerMessage } from "@openiap/openflow-api";
import { suite, test, timeout } from "@testdeck/mocha";
import assert from "assert";
import { Crypt } from "../Crypt.js";
import { Message } from "../Messages/Message.js";
import { testConfig } from "./testConfig.js";

@suite class message_test {
    @timeout(10000)
    async before() {
        await testConfig.configure();
    }
    async after() {
        await testConfig.cleanup();
    }
    @test async "Unselect customer as root"() {
        var q = new SelectCustomerMessage();
        var msg = new Message(); msg.jwt = Crypt.rootToken();
        await msg.EnsureJWT(null, false)
        assert.rejects(msg.SelectCustomer(null), "Builtin entities cannot select a company")
    }
    @test async "select customer as root"() {
        var q = new SelectCustomerMessage(); q.customerid = "60b683e12382b05d20762f09";
        var msg = new Message(); msg.jwt = Crypt.rootToken();
        await msg.EnsureJWT(null, false)
        assert.rejects(msg.SelectCustomer(null), "Builtin entities cannot select a company")
    }
    @test async "Unselect customer as testuser"() {
        var q = new SelectCustomerMessage();
        var msg = new Message(); msg.jwt = testConfig.userToken;
        await msg.EnsureJWT(null, false)
        await msg.SelectCustomer(null);
    }
    @test async "select customer as testuser"() {
        var q = new SelectCustomerMessage(); q.customerid = "60b683e12382b05d20762f09";
        var msg = new Message(); msg.jwt = testConfig.userToken;
        await msg.EnsureJWT(null, false)
        await msg.SelectCustomer(null);
    }
    // @test async "signin with username and password"() {
    //     var q = new SigninMessage(); q.username = "testuser"; q.password = "testuser"
    //     var msg = new Message();
    //     await msg.Signin(null, null);
    //     q = JSON.parse(msg.data);
    //     assert.ok(q && !q.error, q.error);
    // }
}
// clear && ./node_modules/.bin/_mocha "src/test/**/Message.test.ts"