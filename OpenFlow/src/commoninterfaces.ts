import { Meter, MeterProvider } from "@opentelemetry/metrics";
import { BasicTracerProvider } from "@opentelemetry/tracing";
import { HrTime, Span, setSpan } from "@opentelemetry/api";
import { ValueRecorder } from "@opentelemetry/api-metrics";
import { Labels } from "@opentelemetry/api-metrics";
import { TokenUser } from "@openiap/openflow-api";

export interface i_license_data {
    licenseVersion: number;
    email: string;
    expirationDate: Date;
    domain: string;
}
export interface i_license_file {
    template_v1: string;
    template_v2: string;
    license_public_key: string;
    privateKey: string;
    validlicense: boolean;
    licenserror: string;
    data: i_license_data;
    ofid(force: boolean): any;
    validate(): void;
    shutdown(): void;
    /**
     *  Generate license file
     *
     * @param options
     * @param options.data {object|string} - data to sign
     * @param options.template - custom license file template
     * @param [options.privateKeyPath] {string} - path to private key
     * @param [options.privateKey] {string} - private key content
     */
    generate(options: any): any;
    /**
     * Parse license file
     *
     * @param options
     * @param options.template - custom license file template
     * @param [options.publicKeyPath] {string} - path to public key
     * @param [options.publicKey] {string} - path to public key
     * @param [options.licenseFilePath] {string} - path to license file
     * @param [options.licenseFile] {string} - license file content
     */
    parse(options: any): {
        valid: boolean;
        serial: string;
        data: {};
    };
    /**
     *
     * @param options
     * @param options.data
     * @param options.privateKey
     * @private
     */
    _generateSerial(options: any): string;
    _render(template: any, data: any): any;
    _prepareDataObject(data: any): {};
}
export interface i_otel {
    default_boundaries: number[];
    traceprovider: BasicTracerProvider;
    meterprovider: MeterProvider;
    meter: Meter;
    defaultlabels: any;
    startSpan(name: string): Span;
    startSubSpan(name: string, parent: Span): Span;
    endSpan(span: Span): void;
    startTimer(): HrTime;
    endTimer(startTime: HrTime, recorder: ValueRecorder, labels?: Labels): any;
    setdefaultlabels(): void;
    shutdown(): Promise<void>;
}

export interface i_nodered_driver {
    detect(): Promise<boolean>;
    EnsureNoderedInstance(jwt: string, tokenUser: TokenUser, _id: string, name: string, skipcreate: boolean, parent: Span): Promise<void>;
    GetNoderedInstance(jwt: string, tokenUser: TokenUser, _id: string, name: string, skipcreate: boolean, parent: Span): Promise<any[]>;
    RestartNoderedInstance(jwt: string, tokenUser: TokenUser, _id: string, name: string, skipcreate: boolean, parent: Span): Promise<void>;
    DeleteNoderedInstance(jwt: string, tokenUser: TokenUser, _id: string, name: string, skipcreate: boolean, parent: Span): Promise<void>;
    DeleteNoderedPod(jwt: string, user: TokenUser, _id: string, name: string, podname: string, skipcreate: boolean, parent: Span): Promise<void>;
    GetNoderedInstanceLog(jwt: string, user: TokenUser, _id: string, name: string, podname: string, skipcreate: boolean, parent: Span): Promise<string>;
    NodeLabels(parent: Span): Promise<any>;
}