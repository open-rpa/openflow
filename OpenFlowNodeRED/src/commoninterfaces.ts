import { Meter, Histogram } from '@opentelemetry/api-metrics';
import { HrTime, Span, TimeInput } from "@opentelemetry/api";
import * as express from "express";

export interface i_otel {
    default_boundaries: number[];
    meter: Meter;
    defaultlabels: any;
    GetTraceSpanId(span: Span): [string, string]
    startSpan(name: string, traceId: string, spanId: string): Span;
    startSpanExpress(name: string, req: express.Request): Span;
    startSubSpan(name: string, parent: Span): Span;
    endSpan(span: Span, time: TimeInput): void;
    startTimer(): HrTime;
    endTimer(startTime: HrTime, recorder: Histogram, labels?: Object): any;
    setdefaultlabels(): void;
    shutdown(): Promise<void>;
    registerurl(metric_url: string, trace_url: string): void;
}
