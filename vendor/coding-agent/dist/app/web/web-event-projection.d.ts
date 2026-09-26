/** 把已经提交的 AgentEvent 折叠为本机 Web UI 可安全展示的轨迹与指标。 */
import type { EventSinkPort } from "../../core/ports/event_sink/event-sink-port.js";
import type { AgentEvent } from "../../core/runtime/events/agent-events.js";
export interface WebRuntimeMetrics {
    readonly turns: number;
    readonly modelRequests: number;
    readonly maxModelRequests: number;
    readonly toolCalls: number;
    readonly maxToolCalls: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cachedInputTokens: number;
    readonly latestInputTokens: number;
    readonly contextWindowTokens: number;
    readonly contextPercent: number;
    readonly elapsedMs: number;
    readonly modelMs: number;
    readonly toolMs: number;
    /** 当前事件契约没有首 token 时间，因此这是 outputTokens / 整轮模型耗时。 */
    readonly tokensPerSecond: number | null;
}
export interface WebRuntimeProjection {
    readonly sourceType: AgentEvent["type"];
    readonly eventSequence: number;
    readonly kind: "run" | "model" | "tool";
    readonly status: "started" | "completed" | "failed" | "paused" | "cancelled" | "outcome_unknown" | "usage";
    readonly title: string;
    readonly summary: string;
    readonly input: string | null;
    readonly output: string | null;
    /** assistant 完成事件的用户可见正文；与工具输出分开，便于按模型轮次重放。 */
    readonly assistantText?: string | null;
    /** Provider 显式返回的 reasoning_content，不与用户可见正文混装。 */
    readonly reasoningText?: string | null;
    /** progress 表示该轮随后请求工具，final 表示该轮生成最终回答。 */
    readonly assistantPhase?: "progress" | "final";
    readonly requestId: string | null;
    readonly callId: string | null;
    readonly toolName: string | null;
    readonly durationMs: number | null;
    readonly elapsedMs: number;
    readonly metrics: WebRuntimeMetrics;
}
export interface WebEventProjectionOptions {
    readonly sinkId?: string;
    readonly contextWindowTokens: number;
    readonly maxModelRequests: number;
    readonly maxToolCalls: number;
    readonly emit: (projection: Readonly<WebRuntimeProjection>) => void;
}
/**
 * best-effort 投影只观察 Required SessionSink 已成功提交的事实；UI 失败不会反向改变 Run。
 */
export declare class WebEventProjectionSink implements EventSinkPort {
    #private;
    readonly sinkId: string;
    readonly delivery: "best_effort";
    constructor(options: Readonly<WebEventProjectionOptions>);
    publish(event: Readonly<AgentEvent>, options: {
        readonly signal: AbortSignal;
    }): Promise<void>;
}
//# sourceMappingURL=web-event-projection.d.ts.map