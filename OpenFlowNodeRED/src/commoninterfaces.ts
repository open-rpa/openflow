import { Meter, Histogram } from '@opentelemetry/api-metrics';
import { HrTime, Span, TimeInput } from "@opentelemetry/api";
import { TokenUser } from "@openiap/openflow-api";

export interface i_otel {
    default_boundaries: number[];
    meter: Meter;
    defaultlabels: any;
    startSpan(name: string): Span;
    startSubSpan(name: string, parent: Span): Span;
    endSpan(span: Span, time: TimeInput): void;
    startTimer(): HrTime;
    endTimer(startTime: HrTime, recorder: Histogram, labels?: Object): any;
    setdefaultlabels(): void;
    shutdown(): Promise<void>;
    registerurl(metric_url: string, trace_url: string): void;
}
