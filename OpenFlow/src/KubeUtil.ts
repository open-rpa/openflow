import { CoreV1Api, AppsV1Api, ExtensionsV1beta1Api, VoidAuth, ApiKeyAuth } from "@kubernetes/client-node";
import http = require('http');
const localVarRequest = require("request");
let defaultBasePath = 'https://localhost';

export class KubeUtil {
    public CoreV1Api: CoreV1Api = null; // kc.makeApiClient(k8s.CoreV1Api);
    public AppsV1Api: AppsV1Api = null; // kc.makeApiClient(k8s.AppsV1Api);
    public ExtensionsV1beta1Api: ExtensionsV1beta1Api = null; // kc.makeApiClient(k8s.ExtensionsV1beta1Api);
    public Metricsv1beta1Api: Metricsv1beta1Api = null;

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
        this.Metricsv1beta1Api = kc.makeApiClient(Metricsv1beta1Api);
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
    async GetIngressV1beta1(namespace, name) {
        const list = await this.ExtensionsV1beta1Api.listNamespacedIngress(namespace);
        for (let i = 0; i < list.body.items.length; i++) {
            const item = list.body.items[i];
            if (item.metadata.name == name) return item;
        }
        return null;
    }

    async GetPodMetrics(namespace, name) {
        var list = await this.Metricsv1beta1Api.GetPod(namespace, name);
        if (list.body.containers.length > 0) {
            list.body.containers[0].usage.window = list.body.window;
            return list.body.containers[0].usage;
        }
        return null;
    }

}


export class Metricsv1beta1Api {
    private _basePath: string = null;
    private authentications: any = null;
    private _useQuerystring: any = null;
    private defaultHeaders: any = null;

    constructor(basePathOrUsername, password, basePath) {
        this._basePath = defaultBasePath;
        this.authentications = {
            'default': new VoidAuth(),
            'BearerToken': new ApiKeyAuth('header', 'authorization'),
        };
        if (password) {
            if (basePath) {
                this.basePath = basePath;
            }
        }
        else {
            if (basePathOrUsername) {
                this.basePath = basePathOrUsername;
            }
        }
    }
    set useQuerystring(value) {
        this._useQuerystring = value;
    }
    set basePath(basePath) {
        this._basePath = basePath;
    }
    get basePath() {
        return this._basePath;
    }
    setDefaultAuthentication(auth) {
        this.authentications.default = auth;
    }
    async GetPods(namespace) {
        let localVarPath = this.basePath + '/apis/metrics.k8s.io/v1beta1/pods';
        if (namespace != null) localVarPath = this.basePath + '/apis/metrics.k8s.io/v1beta1/namespaces/' + namespace + "/pods";
        let localVarHeaderParams = Object.assign({}, this.defaultHeaders);
        let localVarUseFormData = false;
        let localVarQueryParameters = {};
        let localVarRequestOptions = {
            method: 'GET',
            qs: localVarQueryParameters,
            headers: localVarHeaderParams,
            uri: localVarPath,
            useQuerystring: this._useQuerystring,
            json: true,
        };
        this.authentications.BearerToken.applyToRequest(localVarRequestOptions);
        this.authentications.default.applyToRequest(localVarRequestOptions);
        return new Promise((resolve, reject) => {
            localVarRequest(localVarRequestOptions, (error, response, body) => {
                if (error) {
                    reject(error);
                }
                else {
                    body = ObjectSerializer.deserialize(body, "PodMetricsList");
                    if (response.statusCode && response.statusCode >= 200 && response.statusCode <= 299) {
                        resolve({ response: response, body: body });
                    }
                    else {
                        reject({ response: response, body: body });
                    }
                }
            });
        });

    }
    async GetPod(namespace: string, pod: string): Promise<{
        response: http.IncomingMessage;
        body: PodMetrics;
    }> {
        const localVarPath = this.basePath + '/apis/metrics.k8s.io/v1beta1/namespaces/' + namespace + "/pods/" + pod;
        let localVarHeaderParams = Object.assign({}, this.defaultHeaders);
        let localVarUseFormData = false;
        let localVarQueryParameters = {};
        let localVarRequestOptions = {
            method: 'GET',
            qs: localVarQueryParameters,
            headers: localVarHeaderParams,
            uri: localVarPath,
            useQuerystring: this._useQuerystring,
            json: true,
        };
        this.authentications.BearerToken.applyToRequest(localVarRequestOptions);
        this.authentications.default.applyToRequest(localVarRequestOptions);
        return new Promise((resolve, reject) => {
            localVarRequest(localVarRequestOptions, (error, response, body) => {
                if (error) {
                    reject(error);
                }
                else {
                    body = ObjectSerializer.deserialize(body, "PodMetrics");
                    if (response.statusCode && response.statusCode >= 200 && response.statusCode <= 299) {
                        resolve({ response: response, body: body });
                    }
                    else {
                        reject({ response: response, body: body });
                    }
                }
            });
        });

    }
}





let primitives = [
    "string",
    "boolean",
    "double",
    "integer",
    "long",
    "float",
    "number",
    "any"
];
class ObjectSerializer {
    static findCorrectType(data, expectedType) {
        if (data == undefined) {
            return expectedType;
        }
        else if (primitives.indexOf(expectedType.toLowerCase()) !== -1) {
            return expectedType;
        }
        else if (expectedType === "Date") {
            return expectedType;
        }
        else {
            if (enumsMap[expectedType]) {
                return expectedType;
            }
            if (!typeMap[expectedType]) {
                return expectedType; // w/e we don't know the type
            }
            // Check the discriminator
            let discriminatorProperty = typeMap[expectedType].discriminator;
            if (discriminatorProperty == null) {
                return expectedType; // the type does not have a discriminator. use it.
            }
            else {
                if (data[discriminatorProperty]) {
                    return data[discriminatorProperty]; // use the type given in the discriminator
                }
                else {
                    return expectedType; // discriminator was not present (or an empty string)
                }
            }
        }
    }
    static serialize(data, type) {
        if (data == undefined) {
            return data;
        }
        else if (primitives.indexOf(type.toLowerCase()) !== -1) {
            return data;
        }
        else if (type.lastIndexOf("Array<", 0) === 0) { // string.startsWith pre es6
            let subType = type.replace("Array<", ""); // Array<Type> => Type>
            subType = subType.substring(0, subType.length - 1); // Type> => Type
            let transformedData = [];
            for (let index in data) {
                let date = data[index];
                transformedData.push(ObjectSerializer.serialize(date, subType));
            }
            return transformedData;
        }
        else if (type === "Date") {
            return data.toString();
        }
        else {
            if (enumsMap[type]) {
                return data;
            }
            if (!typeMap[type]) { // in case we dont know the type
                return data;
            }
            // get the map for the correct type.
            let attributeTypes = typeMap[type].getAttributeTypeMap();
            let instance = {};
            for (let index in attributeTypes) {
                let attributeType = attributeTypes[index];
                instance[attributeType.baseName] = ObjectSerializer.serialize(data[attributeType.name], attributeType.type);
            }
            return instance;
        }
    }
    static deserialize(data, type) {
        // polymorphism may change the actual type.
        type = ObjectSerializer.findCorrectType(data, type);
        if (data == undefined) {
            return data;
        }
        else if (primitives.indexOf(type.toLowerCase()) !== -1) {
            return data;
        }
        else if (type.lastIndexOf("Array<", 0) === 0) { // string.startsWith pre es6
            let subType = type.replace("Array<", ""); // Array<Type> => Type>
            subType = subType.substring(0, subType.length - 1); // Type> => Type
            let transformedData = [];
            for (let index in data) {
                let date = data[index];
                transformedData.push(ObjectSerializer.deserialize(date, subType));
            }
            return transformedData;
        }
        else if (type === "Date") {
            return new Date(data);
        }
        else {
            if (enumsMap[type]) { // is Enum
                return data;
            }
            if (!typeMap[type]) { // dont know the type
                return data;
            }
            let instance = new typeMap[type]();
            let attributeTypes = typeMap[type].getAttributeTypeMap();
            for (let index in attributeTypes) {
                let attributeType = attributeTypes[index];
                instance[attributeType.name] = ObjectSerializer.deserialize(data[attributeType.baseName], attributeType.type);
            }
            return instance;
        }
    }
}





export class PodMetrics {
    public name: string;
    public containers: PodMetric[];
    public timestamp: Date;
    public window: string;
    public metadata: any;
}
export class PodMetric {
    public name: string;
    public usage: PodMetricUsage;
}
export class PodMetricUsage {
    public cpu: string;
    public memory: string;
    public window: string;
}
export class PodMetricsListReference {
    static discriminator = undefined;
    static attributeTypeMap = [
        {
            "name": "apiVersion",
            "baseName": "apiVersion",
            "type": "string"
        },
        {
            "name": "items",
            "baseName": "items",
            "type": "Array<PodMetricReference>"
        },
        {
            "name": "kind",
            "baseName": "kind",
            "type": "string"
        },
        {
            "name": "metadata",
            "baseName": "metadata",
            "type": "V1ListMeta"
        }
    ];
    static getAttributeTypeMap() {
        return PodMetricsListReference.attributeTypeMap;
    }
}

export class PodMetricReference {
    static discriminator = undefined;
    static attributeTypeMap = [
        {
            "name": "containers",
            "baseName": "containers",
            "type": "Array<PodMetricContainerReference>"
        },
        {
            "name": "timestamp",
            "baseName": "timestamp",
            "type": "Date"
        },
        {
            "name": "window",
            "baseName": "window",
            "type": "string"
        },
        {
            "name": "metadata",
            "baseName": "metadata",
            "type": "V1ListMeta"
        }
    ];
    static getAttributeTypeMap() {
        return PodMetricReference.attributeTypeMap;
    }
}

export class PodMetricContainerReference {
    static discriminator = undefined;
    static attributeTypeMap = [
        {
            "name": "name",
            "baseName": "name",
            "type": "string"
        },
        {
            "name": "usage",
            "baseName": "usage",
            "type": "PodMetricContainerUsageReference"
        }
    ]
    static getAttributeTypeMap() {
        return PodMetricContainerReference.attributeTypeMap;
    }
}
export class PodMetricContainerUsageReference {
    static discriminator = undefined;
    static attributeTypeMap = [
        {
            "name": "cpu",
            "baseName": "cpu",
            "type": "string"
        },
        {
            "name": "memory",
            "baseName": "memory",
            "type": "string"
        }
    ];
    static getAttributeTypeMap() {
        return PodMetricContainerUsageReference.attributeTypeMap;
    }
}

let enumsMap = {};
let typeMap = {
    "PodMetricsList": PodMetricsListReference,
    "PodMetricReference": PodMetricReference,
    "PodMetricContainerReference": PodMetricContainerReference,
    "PodMetricContainerUsageReference": PodMetricContainerUsageReference
}
