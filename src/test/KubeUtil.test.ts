import { suite, test, timeout } from "@testdeck/mocha";
import assert from "assert";
import { Config } from "../Config.js";
// @ts-ignore
import { KubeUtil } from "../ee/KubeUtil.js";
import { testConfig } from "./testConfig.js";

@suite class kubeutil_test {
    @timeout(10000)
    async before() {
        await testConfig.configure();
    }
    async after() {
        await testConfig.cleanup();
    }
    @timeout(60000)
    @test async "GetStatefulSet"() {
        var sfs = await KubeUtil.instance().GetStatefulSet(Config.namespace, "findme");
        assert.strictEqual(sfs, null)
    }
    @test async "GetDeployment"() {
        var dep = await KubeUtil.instance().GetDeployment(Config.namespace, "api");
        assert.notStrictEqual(dep, null);
        assert.strictEqual(dep.metadata.name, "api");
    }
    @test async "GetIngressV1"() {
        var dep = await KubeUtil.instance().GetIngressV1(Config.namespace, "useringress");
        assert.notStrictEqual(dep, null);
        assert.strictEqual(dep.metadata.name, "useringress");
    }
    @timeout(60000)
    @test async "listNamespacedPod"() {
        const list = await KubeUtil.instance().CoreV1Api.listNamespacedPod(Config.namespace);
        assert.notStrictEqual(list, null);
        assert.notStrictEqual(list.body, null);
        assert.notStrictEqual(list.body.items, null);
        assert.ok(list.body.items.length > 0)
        var pod = list.body.items[0];
        var name = pod.metadata.name;
        pod = await KubeUtil.instance().GetPod(Config.namespace, pod.metadata.name);
        assert.notStrictEqual(pod, null);
        assert.strictEqual(pod.metadata.name, name);

        var metrics = await KubeUtil.instance().GetPodMetrics(Config.namespace, name);
        assert.notStrictEqual(metrics, null);
        assert.notStrictEqual(metrics.cpu, null);
        assert.notStrictEqual(metrics.memory, null);
    }
    @test async "GetService"() {
        var service = await KubeUtil.instance().GetService(Config.namespace, "api");
        assert.notStrictEqual(service, null);
        assert.strictEqual(service.metadata.name, "api");

    }
    @test async "GetReplicaset"() {
        var rep = await KubeUtil.instance().GetReplicaset(Config.namespace, "name", "test");
        assert.strictEqual(rep, null);
    }
    @test async "getpods"() {
        var list = await KubeUtil.instance().GetPods(Config.namespace);
        assert.notStrictEqual(list, null);
        assert.notStrictEqual(list.body, null);
        assert.notStrictEqual(list.body.items, null);
        assert.ok(list.body.items.length > 0)
    }
}
// clear && ./node_modules/.bin/_mocha "src/test/**/KubeUtil.test.ts"