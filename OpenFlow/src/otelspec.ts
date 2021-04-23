import { Meter, MeterProvider } from "@opentelemetry/metrics";
import { BasicTracerProvider } from "@opentelemetry/tracing";
import { HrTime, Span, setSpan } from "@opentelemetry/api";
import { ValueRecorder } from "@opentelemetry/api-metrics";
import { Labels } from "@opentelemetry/api-metrics";

export declare class license_data {
    licenseVersion: number;
    email: string;
    expirationDate: Date;
    domain: string;
}
/**
 * LicenseFile Class
 */
export declare class LicenseFile {
    template_v1: string;
    template_v2: string;
    license_public_key: string;
    privateKey: string;
    validlicense: boolean;
    licenserror: string;
    data: license_data;
    private _ofid;
    ofid(): any;
    validate(): void;
    private validateTimer;
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

export declare class otel {
    default_boundaries: number[];
    static fakespan: {
        context: () => any;
        setAttribute: () => any;
        setAttributes: () => any;
        addEvent: () => any;
        setStatus: () => any;
        updateName: () => any;
        end: () => any;
        isRecording: () => any;
        recordException: () => any;
    };
    static instance: otel;
    traceprovider: BasicTracerProvider;
    meterprovider: MeterProvider;
    meter: Meter;
    defaultlabels: any;
    private static nodejs_heap_size_used_bytes;
    private static nodejs_heap_size_total_bytes;
    private static perfTimeout;
    static configure(): otel;
    startSpan(name: string): Span;
    startSubSpan(name: string, parent: Span): Span;
    endSpan(span: Span): void;
    startTimer(): HrTime;
    endTimer(startTime: HrTime, recorder: ValueRecorder, labels?: Labels): any;
    setdefaultlabels(): void;
}
