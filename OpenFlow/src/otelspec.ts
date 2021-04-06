import { Meter, MeterProvider } from "@opentelemetry/metrics";
import { BasicTracerProvider } from "@opentelemetry/tracing";
import { HrTime, Span, setSpan } from "@opentelemetry/api";
import { ValueRecorder } from "@opentelemetry/api-metrics";
import { Labels } from "@opentelemetry/api-metrics";

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
