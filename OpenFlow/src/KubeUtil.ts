import { CoreV1Api, AppsV1Api, ExtensionsV1beta1Api, ExtensionsApi } from "@kubernetes/client-node";
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
        const k8s = require("@kubernetes/client-node");

        const kc = new k8s.KubeConfig();
        let success: boolean = false;
        try {
            kc.loadFromDefault();
            success = true;
        } catch (error) {
            console.error(error);
        }
        if (success == false) {
            try {
                kc.loadFromCluster();
                success = true;
            } catch (error) {
                console.error(error);
            }
        }
        this.CoreV1Api = kc.makeApiClient(k8s.CoreV1Api);
        this.AppsV1Api = kc.makeApiClient(k8s.AppsV1Api);
        this.ExtensionsV1beta1Api = kc.makeApiClient(k8s.ExtensionsV1beta1Api);
    }

    async GetStatefulSet(namespace, name) {
        const list = await this.AppsV1Api.listNamespacedStatefulSet(namespace);
        for (let i = 0; i < list.body.items.length; i++) {
            const item = list.body.items[i];
            if (item.metadata.name == name) return item;
        }
        return null;
    }
    async GetService(namespace, name) {
        const list = await this.CoreV1Api.listNamespacedService(namespace);
        for (let i = 0; i < list.body.items.length; i++) {
            const item = list.body.items[i];
            if (item.metadata.name == name) return item;
        }
        return null;
    }
    async GetPod(namespace, name) {
        const list = await this.CoreV1Api.listNamespacedPod(namespace);
        for (let i = 0; i < list.body.items.length; i++) {
            const item = list.body.items[i];
            if (item.metadata.name == name) return item;
        }
        return null;
    }
    async GetReplicaset(namespace, labelskey, labelsvalue) {
        const list = await this.AppsV1Api.listNamespacedReplicaSet(namespace);
        for (let i = 0; i < list.body.items.length; i++) {
            const item = list.body.items[i];
            if (item.metadata && item.metadata.labels) {
                const value = item.metadata.labels[labelskey];
                if (value == labelsvalue) return item;
            }
        }
        return null;
    }
    async GetDeployment(namespace, name) {
        const list = await this.AppsV1Api.listNamespacedDeployment(namespace);
        for (let i = 0; i < list.body.items.length; i++) {
            const item = list.body.items[i];
            if (item.metadata.name == name) return item;
        }
        return null;
    }
    async GetIngress(namespace, name) {
        const list = await this.ExtensionsV1beta1Api.listNamespacedIngress(namespace);
        for (let i = 0; i < list.body.items.length; i++) {
            const item = list.body.items[i];
            if (item.metadata.name == name) return item;
        }
        return null;
    }

}