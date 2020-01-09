import * as k8s from "@kubernetes/client-node";
import { CoreV1Api, AppsV1Api, ExtensionsV1beta1Api } from "@kubernetes/client-node";
import { Config } from "./Config";

export class KubeUtil {
    public CoreV1Api: CoreV1Api = null; // kc.makeApiClient(k8s.CoreV1Api);
    public AppsV1Api: AppsV1Api = null; // kc.makeApiClient(k8s.AppsV1Api);
    public ExtensionsV1beta1Api: ExtensionsV1beta1Api = null; // kc.makeApiClient(k8s.ExtensionsV1beta1Api);

    private static _instance: KubeUtil = null;
    public static instance(): KubeUtil {
        if (this._instance == null) {
            this._instance = new KubeUtil();
        }
        return this._instance;
    }
    constructor() {
        const kc = new k8s.KubeConfig();
        kc.loadFromCluster();
        this.CoreV1Api = kc.makeApiClient(k8s.CoreV1Api);
        this.AppsV1Api = kc.makeApiClient(k8s.AppsV1Api);
        this.ExtensionsV1beta1Api = kc.makeApiClient(k8s.ExtensionsV1beta1Api);
    }

    async GetStatefulSet(namespace, name) {
        var list = await this.AppsV1Api.listNamespacedStatefulSet(namespace);
        for (var i = 0; i < list.body.items.length; i++) {
            var item = list.body.items[i];
            if (item.metadata.name == name) return item;
        }
        return null;
    }
    async GetService(namespace, name) {
        var list = await this.CoreV1Api.listNamespacedService(namespace);
        for (var i = 0; i < list.body.items.length; i++) {
            var item = list.body.items[i];
            if (item.metadata.name == name) return item;
        }
        return null;
    }
    async GetPod(namespace, name) {
        var list = await this.CoreV1Api.listNamespacedPod(namespace);
        for (var i = 0; i < list.body.items.length; i++) {
            var item = list.body.items[i];
            if (item.metadata.name == name) return item;
        }
        return null;
    }
    async GetReplicaset(namespace, labelskey, labelsvalue) {
        var list = await this.AppsV1Api.listNamespacedReplicaSet(namespace);
        for (var i = 0; i < list.body.items.length; i++) {
            var item = list.body.items[i];
            if (item.metadata && item.metadata.labels) {
                var value = item.metadata.labels[labelskey];
                if (value == labelsvalue) return item;
            }
        }
        return null;
    }
    async GetDeployment(namespace, name) {
        var list = await this.ExtensionsV1beta1Api.listNamespacedDeployment(namespace);
        for (var i = 0; i < list.body.items.length; i++) {
            var item = list.body.items[i];
            if (item.metadata.name == name) return item;
        }
        return null;
    }
    async GetIngress(namespace, name) {
        var list = await this.ExtensionsV1beta1Api.listNamespacedIngress(namespace);
        for (var i = 0; i < list.body.items.length; i++) {
            var item = list.body.items[i];
            if (item.metadata.name == name) return item;
        }
        return null;
    }

}