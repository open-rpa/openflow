import { Meter, MeterProvider } from "@opentelemetry/metrics";
import { BasicTracerProvider } from "@opentelemetry/tracing";
import { HrTime, Span, TimeInput } from "@opentelemetry/api";
import { ValueRecorder } from "@opentelemetry/api-metrics";
import { Labels } from "@opentelemetry/api-metrics";

export interface i_otel {
    default_boundaries: number[];
    traceprovider: BasicTracerProvider;
    meterprovider: MeterProvider;
    meter: Meter;
    defaultlabels: any;
    startSpan(name: string): Span;
    startSubSpan(name: string, parent: Span): Span;
    endSpan(span: Span, time: TimeInput): void;
    startTimer(): HrTime;
    endTimer(startTime: HrTime, recorder: ValueRecorder, labels?: Labels): any;
    setdefaultlabels(): void;
    shutdown(): Promise<void>;
}
