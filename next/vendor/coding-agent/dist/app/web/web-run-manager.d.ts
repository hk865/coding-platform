import { z } from "zod";
import type { EventSinkPort } from "../../core/ports/event_sink/event-sink-port.js";
import type { ApprovalRequester } from "../../policy/approval/approval-coordinator.js";
declare const webRunRequestSchema: z.ZodObject<{
    mode: z.ZodDefault<z.ZodEnum<{
        run: "run";
        resume: "resume";
    }>>;
    workspaceRoot: z.ZodString;
    sessionId: z.ZodOptional<z.ZodString>;
    provider: z.ZodEnum<{
        openai: "openai";
        deepseek: "deepseek";
    }>;
    model: z.ZodString;
    apiKey: z.ZodString;
    input: z.ZodDefault<z.ZodString>;
    thinking: z.ZodDefault<z.ZodEnum<{
        enabled: "enabled";
        disabled: "disabled";
    }>>;
    reasoningEffort: z.ZodOptional<z.ZodEnum<{
        low: "low";
        high: "high";
        max: "max";
    }>>;
    maxOutputTokens: z.ZodDefault<z.ZodNumber>;
    maxModelRequests: z.ZodDefault<z.ZodNumber>;
    maxToolCalls: z.ZodDefault<z.ZodNumber>;
    consistencyMode: z.ZodDefault<z.ZodEnum<{
        session: "session";
        workspace: "workspace";
        strict: "strict";
    }>>;
}, z.core.$strict>;
export type WebRunRequest = z.infer<typeof webRunRequestSchema>;
export type WebRunStatus = "starting" | "running" | "awaiting_approval" | "completed" | "cancelled" | "limit_exceeded" | "failed";
export interface WebRunEvent {
    readonly sequence: number;
    readonly type: string;
    readonly data: Readonly<Record<string, unknown>>;
}
export interface WebRunSnapshot {
    readonly runId: string;
    readonly sessionId: string;
    readonly status: WebRunStatus;
}
export interface WebExecutionCallbacks {
    readonly signal: AbortSignal;
    readonly approvalRequester: ApprovalRequester;
    readonly onTextDelta: (delta: string, requestId: string) => void;
    readonly onReasoningDelta: (delta: string, requestId: string) => void;
    readonly onConfiguration: (configuration: Readonly<Record<string, unknown>>) => void;
    readonly eventSink: EventSinkPort & {
        readonly delivery: "best_effort";
    };
}
export interface WebExecutionResult {
    readonly sessionId: string;
    readonly status: string;
}
export type WebExecutor = (request: Readonly<WebRunRequest & {
    readonly sessionId: string;
}>, callbacks: Readonly<WebExecutionCallbacks>) => Promise<WebExecutionResult>;
export declare class WebRunConflictError extends Error {
    constructor(message?: string);
}
export declare class WebRunNotFoundError extends Error {
    constructor();
}
export declare const executeWebRun: WebExecutor;
export declare class WebRunManager {
    #private;
    constructor(options?: {
        readonly executor?: WebExecutor;
        readonly idFactory?: () => string;
    });
    start(raw: unknown): WebRunSnapshot;
    snapshot(runId: string): WebRunSnapshot;
    subscribe(runId: string, subscriber: (event: WebRunEvent) => void): () => void;
    cancel(runId: string): WebRunSnapshot;
    answerApproval(runId: string, approvalId: string, decision: "allow_once" | "allow_for_run" | "deny"): WebRunSnapshot;
}
export {};
//# sourceMappingURL=web-run-manager.d.ts.map