/** 把已经提交的 AgentEvent 折叠为本机 Web UI 可安全展示的轨迹与指标。 */
import type { EventSinkPort } from "../../core/ports/event_sink/event-sink-port.js";
import type { ToolCall, ToolResult } from "../../core/ports/tool_executor/tool-executor-port.js";
import type { AgentEvent } from "../../core/runtime/events/agent-events.js";

const MAX_ARGUMENT_CHARS = 4_000;
const MAX_OUTPUT_CHARS = 16_000;

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
  readonly status:
    "started" | "completed" | "failed" | "paused" | "cancelled" | "outcome_unknown" | "usage";
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

interface PendingModel {
  readonly startedMs: number;
}

interface PendingTool {
  readonly call: ToolCall;
  readonly startedMs: number;
}

function bounded(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n… 已截断 ${text.length - limit} 个字符`;
}

function jsonText(value: unknown, limit: number): string {
  try {
    return bounded(JSON.stringify(value, null, 2), limit);
  } catch {
    return "[无法序列化]";
  }
}

function argumentSummary(call: ToolCall): string {
  const args = call.arguments;
  const candidate =
    call.name === "shell"
      ? args["command"]
      : call.name === "read" || call.name === "edit"
        ? args["path"]
        : undefined;
  if (typeof candidate === "string" && candidate.length > 0) return bounded(candidate, 240);
  return bounded(JSON.stringify(args), 240);
}

function outputText(result: ToolResult): string {
  const parts = result.output.map((part) => {
    if (part.kind === "text") return part.text;
    if (part.kind === "json") return jsonText(part.value, MAX_OUTPUT_CHARS);
    return `${part.summary}\n${part.uri}`;
  });
  const prefix =
    result.status === "error"
      ? `${result.error.code}: ${result.error.message}\n\n`
      : result.status === "cancelled"
        ? `cancelled: ${result.reason}\n\n`
        : "";
  return bounded(prefix + parts.join("\n\n"), MAX_OUTPUT_CHARS);
}

function resultSummary(result: ToolResult): string {
  if (result.status === "error") return `${result.error.code}: ${result.error.message}`;
  if (result.status === "cancelled") return result.reason;
  const jsonPart = result.output.find((part) => part.kind === "json");
  const textPart = result.output.find((part) => part.kind === "text");
  const firstLine =
    textPart?.kind === "text"
      ? textPart.text
          .split("\n")
          .map((line) => line.trim())
          .find((line) => line.length > 0)
      : undefined;
  if (jsonPart?.kind === "json" && typeof jsonPart.value === "object" && jsonPart.value !== null) {
    const exitCode = (jsonPart.value as Record<string, unknown>)["exitCode"];
    if (typeof exitCode === "number") {
      return `exit ${exitCode}${firstLine ? ` · ${bounded(firstLine, 160)}` : ""}`;
    }
  }
  if (result.effects.changedPaths.length > 0) {
    return `完成 · 修改 ${result.effects.changedPaths.length} 个路径`;
  }
  if (firstLine) return bounded(firstLine, 180);
  return "调用完成";
}

/**
 * best-effort 投影只观察 Required SessionSink 已成功提交的事实；UI 失败不会反向改变 Run。
 */
export class WebEventProjectionSink implements EventSinkPort {
  readonly sinkId: string;
  readonly delivery = "best_effort" as const;
  readonly #contextWindowTokens: number;
  readonly #maxModelRequests: number;
  readonly #maxToolCalls: number;
  readonly #emitProjection: WebEventProjectionOptions["emit"];
  readonly #pendingModels = new Map<string, PendingModel>();
  readonly #requestOutputTokens = new Map<string, number>();
  readonly #pendingTools = new Map<string, PendingTool>();
  #turns = 0;
  #modelRequests = 0;
  #toolCalls = 0;
  #inputTokens = 0;
  #outputTokens = 0;
  #cachedInputTokens = 0;
  #latestInputTokens = 0;
  #elapsedMs = 0;
  #modelMs = 0;
  #toolMs = 0;
  #throughputTokens = 0;

  constructor(options: Readonly<WebEventProjectionOptions>) {
    if (!Number.isSafeInteger(options.contextWindowTokens) || options.contextWindowTokens <= 0) {
      throw new RangeError("contextWindowTokens 必须是正安全整数");
    }
    if (!Number.isSafeInteger(options.maxModelRequests) || options.maxModelRequests <= 0) {
      throw new RangeError("maxModelRequests 必须是正安全整数");
    }
    if (!Number.isSafeInteger(options.maxToolCalls) || options.maxToolCalls <= 0) {
      throw new RangeError("maxToolCalls 必须是正安全整数");
    }
    this.sinkId = options.sinkId ?? "web-runtime-projection";
    this.#contextWindowTokens = options.contextWindowTokens;
    this.#maxModelRequests = options.maxModelRequests;
    this.#maxToolCalls = options.maxToolCalls;
    this.#emitProjection = options.emit;
  }

  async publish(
    event: Readonly<AgentEvent>,
    options: { readonly signal: AbortSignal },
  ): Promise<void> {
    if (options.signal.aborted) throw options.signal.reason ?? new Error("Web 投影已取消");
    // resume/continue 观察器可能在 run.started 之后才接入；一个 sink 实例仍只对应一个 Turn。
    this.#turns = Math.max(1, this.#turns);
    this.#elapsedMs = event.meta.elapsedMs;
    const projection = this.#project(event);
    if (projection) this.#emitProjection(projection);
  }

  #metrics(): WebRuntimeMetrics {
    return {
      turns: this.#turns,
      modelRequests: this.#modelRequests,
      maxModelRequests: this.#maxModelRequests,
      toolCalls: this.#toolCalls,
      maxToolCalls: this.#maxToolCalls,
      inputTokens: this.#inputTokens,
      outputTokens: this.#outputTokens,
      cachedInputTokens: this.#cachedInputTokens,
      latestInputTokens: this.#latestInputTokens,
      contextWindowTokens: this.#contextWindowTokens,
      contextPercent: Math.min(
        100,
        Math.round((this.#latestInputTokens / this.#contextWindowTokens) * 1_000) / 10,
      ),
      elapsedMs: this.#elapsedMs,
      modelMs: this.#modelMs,
      toolMs: this.#toolMs,
      tokensPerSecond:
        this.#modelMs > 0
          ? Math.round((this.#throughputTokens / (this.#modelMs / 1_000)) * 10) / 10
          : null,
    };
  }

  #base(
    event: Readonly<AgentEvent>,
    value: Omit<WebRuntimeProjection, "sourceType" | "eventSequence" | "elapsedMs" | "metrics">,
  ): WebRuntimeProjection {
    return {
      sourceType: event.type,
      eventSequence: event.meta.sequence,
      elapsedMs: event.meta.elapsedMs,
      ...value,
      metrics: this.#metrics(),
    };
  }

  #project(event: Readonly<AgentEvent>): WebRuntimeProjection | null {
    switch (event.type) {
      case "run.started":
        this.#turns = Math.max(1, this.#turns);
        return this.#base(event, {
          kind: "run",
          status: "started",
          title: "Turn 1 已开始",
          summary: "安全运行环境已装配",
          input: null,
          output: null,
          requestId: null,
          callId: null,
          toolName: null,
          durationMs: null,
        });
      case "model.request_started": {
        this.#modelRequests += 1;
        this.#pendingModels.set(event.payload.requestId, { startedMs: event.meta.elapsedMs });
        return this.#base(event, {
          kind: "model",
          status: "started",
          title: `模型轮次 ${this.#modelRequests}`,
          summary: event.payload.retryOfRequestId ? "重试请求已发送" : "请求已发送",
          input: null,
          output: null,
          requestId: event.payload.requestId,
          callId: null,
          toolName: null,
          durationMs: null,
        });
      }
      case "model.usage_recorded": {
        const usage = event.payload.delta;
        this.#inputTokens += usage.inputTokens;
        this.#outputTokens += usage.outputTokens;
        this.#cachedInputTokens += usage.cachedInputTokens;
        this.#latestInputTokens = usage.inputTokens;
        this.#requestOutputTokens.set(event.payload.requestId, usage.outputTokens);
        return this.#base(event, {
          kind: "model",
          status: "usage",
          title: "Token 用量",
          summary: `输入 ${usage.inputTokens} · 输出 ${usage.outputTokens} · 缓存 ${usage.cachedInputTokens}`,
          input: null,
          output: null,
          requestId: event.payload.requestId,
          callId: null,
          toolName: null,
          durationMs: null,
        });
      }
      case "assistant.message_completed": {
        const pending = this.#pendingModels.get(event.payload.requestId);
        const durationMs = pending ? Math.max(0, event.meta.elapsedMs - pending.startedMs) : null;
        const outputTokens = this.#requestOutputTokens.get(event.payload.requestId) ?? 0;
        if (durationMs !== null && durationMs > 0) {
          this.#modelMs += durationMs;
          this.#throughputTokens += outputTokens;
        }
        this.#pendingModels.delete(event.payload.requestId);
        this.#requestOutputTokens.delete(event.payload.requestId);
        const tools = event.payload.toolCalls.map((call) => call.name);
        return this.#base(event, {
          kind: "model",
          status: "completed",
          title: "模型响应完成",
          summary: tools.length > 0 ? `请求工具：${tools.join("、")}` : "生成最终回答",
          input: null,
          output: null,
          assistantText: event.payload.message.content || null,
          reasoningText: event.payload.message.reasoningContent ?? null,
          assistantPhase: tools.length > 0 ? "progress" : "final",
          requestId: event.payload.requestId,
          callId: null,
          toolName: null,
          durationMs,
        });
      }
      case "model.request_failed": {
        const pending = this.#pendingModels.get(event.payload.requestId);
        const durationMs = pending ? Math.max(0, event.meta.elapsedMs - pending.startedMs) : null;
        this.#pendingModels.delete(event.payload.requestId);
        this.#requestOutputTokens.delete(event.payload.requestId);
        return this.#base(event, {
          kind: "model",
          status: "failed",
          title: "模型请求失败",
          summary: `${event.payload.failure.code}: ${event.payload.failure.message}`,
          input: null,
          output: null,
          requestId: event.payload.requestId,
          callId: null,
          toolName: null,
          durationMs,
        });
      }
      case "tool.started": {
        const call = event.payload.call;
        this.#toolCalls += 1;
        this.#pendingTools.set(call.callId, { call, startedMs: event.meta.elapsedMs });
        return this.#base(event, {
          kind: "tool",
          status: "started",
          title: call.name,
          summary: argumentSummary(call),
          input: jsonText(call.arguments, MAX_ARGUMENT_CHARS),
          output: null,
          requestId: null,
          callId: call.callId,
          toolName: call.name,
          durationMs: null,
        });
      }
      case "tool.completed":
      case "tool.failed":
      case "tool.cancelled":
      case "tool.outcome_unknown": {
        const pending = this.#pendingTools.get(event.payload.callId);
        const result =
          event.type === "tool.outcome_unknown"
            ? event.payload.synthesizedResult
            : event.payload.result;
        const durationMs = pending ? Math.max(0, event.meta.elapsedMs - pending.startedMs) : null;
        if (durationMs !== null) this.#toolMs += durationMs;
        this.#pendingTools.delete(event.payload.callId);
        const status =
          event.type === "tool.completed"
            ? "completed"
            : event.type === "tool.failed"
              ? "failed"
              : event.type === "tool.cancelled"
                ? "cancelled"
                : "outcome_unknown";
        const title =
          event.type === "tool.cancelled"
            ? `${pending?.call.name ?? "tool"} 已取消`
            : event.type === "tool.outcome_unknown"
              ? `${pending?.call.name ?? event.payload.toolName} 结果未知`
              : (pending?.call.name ?? "tool");
        const summary =
          event.type === "tool.outcome_unknown"
            ? "进程中断/强制取消，结果未知；禁止自动重试"
            : resultSummary(result);
        const toolName =
          event.type === "tool.outcome_unknown"
            ? event.payload.toolName
            : (pending?.call.name ?? null);
        return this.#base(event, {
          kind: "tool",
          status,
          title,
          summary,
          input: pending ? jsonText(pending.call.arguments, MAX_ARGUMENT_CHARS) : null,
          output: outputText(result),
          requestId: null,
          callId: event.payload.callId,
          toolName,
          durationMs,
        });
      }
      case "run.paused":
        return this.#base(event, {
          kind: "run",
          status: "paused",
          title: "任务已暂停",
          summary: event.payload.pause.reason,
          input: null,
          output: null,
          requestId: null,
          callId: event.payload.pause.pendingToolCallId,
          toolName: null,
          durationMs: null,
        });
      case "run.resumed":
        return this.#base(event, {
          kind: "run",
          status: "started",
          title: "任务已恢复",
          summary: `恢复方：${event.payload.resumedBy}`,
          input: null,
          output: null,
          requestId: null,
          callId: null,
          toolName: null,
          durationMs: null,
        });
      case "run.completed":
        return this.#base(event, {
          kind: "run",
          status: "completed",
          title: "任务完成",
          summary: "最终回答已生成",
          input: null,
          output: null,
          requestId: null,
          callId: null,
          toolName: null,
          durationMs: event.meta.elapsedMs,
        });
      case "run.cancelled":
        return this.#base(event, {
          kind: "run",
          status: "cancelled",
          title: "任务已取消",
          summary: event.payload.reason,
          input: null,
          output: null,
          requestId: null,
          callId: null,
          toolName: null,
          durationMs: event.meta.elapsedMs,
        });
      case "run.limit_exceeded":
        return this.#base(event, {
          kind: "run",
          status: "failed",
          title: "运行上限已触发",
          summary: `${event.payload.limit}: ${event.payload.observed} / ${event.payload.allowed}`,
          input: null,
          output: null,
          requestId: null,
          callId: null,
          toolName: null,
          durationMs: event.meta.elapsedMs,
        });
      case "run.failed":
        return this.#base(event, {
          kind: "run",
          status: "failed",
          title: "任务失败",
          summary: `${event.payload.failure.category}/${event.payload.failure.code}: ${event.payload.failure.message}`,
          input: null,
          output: event.payload.failure.operationId
            ? `operationId: ${event.payload.failure.operationId}`
            : null,
          requestId: event.payload.failure.operationId,
          callId: null,
          toolName: null,
          durationMs: event.meta.elapsedMs,
        });
    }
  }
}
