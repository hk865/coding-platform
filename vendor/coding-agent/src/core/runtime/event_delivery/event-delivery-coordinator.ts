/**
 * 模块职责：协调 AgentEvent 向多个 sink 的有序投递，并决定状态何时可以提交。
 *
 * 设计边界：它不生成事件，也不执行 reducer 之外的业务副作用。
 * 关键流程：先计算候选状态并投递 required sink；全部成功后再提交状态并投递 best_effort sink。
 */
import type { EventSinkPort } from "../../ports/event_sink/event-sink-port.js";
import type { AgentEvent } from "../events/agent-events.js";
import { reduceRunState } from "../reducer/run-state-reducer.js";
import type { RunState } from "../state/run-state.js";

export class RequiredSinkError extends Error {
  constructor(
    readonly sinkId: string,
    override readonly cause: unknown,
    readonly failedSinkIds: readonly string[] = [sinkId],
  ) {
    super(`Required EventSink ${failedSinkIds.join(", ")} 投递失败`);
    this.name = "RequiredSinkError";
  }
}

export interface EventDeliveryDiagnostic {
  readonly sinkId: string;
  readonly eventId: string;
  readonly message: string;
}

export class EventDeliveryCoordinator {
  readonly #sinks: readonly EventSinkPort[];
  readonly #onDiagnostic: ((diagnostic: EventDeliveryDiagnostic) => void) | undefined;
  readonly #publishTimeoutMs: number;

  constructor(
    sinks: readonly EventSinkPort[] = [],
    onDiagnostic?: (diagnostic: EventDeliveryDiagnostic) => void,
    publishTimeoutMs = 30_000,
  ) {
    const ids = sinks.map((sink) => sink.sinkId);
    if (new Set(ids).size !== ids.length) throw new Error("EventSink sinkId 必须唯一");
    if (!Number.isSafeInteger(publishTimeoutMs) || publishTimeoutMs <= 0) {
      throw new RangeError("EventSink timeout 必须为正安全整数");
    }
    this.#sinks = [...sinks].sort((left, right) => left.sinkId.localeCompare(right.sinkId));
    this.#onDiagnostic = onDiagnostic;
    this.#publishTimeoutMs = publishTimeoutMs;
  }

  async #publish(
    sink: EventSinkPort,
    event: Readonly<AgentEvent>,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) throw signal.reason ?? new Error("EventSink 投递已取消");
    const timeoutController = new AbortController();
    const combined = AbortSignal.any([signal, timeoutController.signal]);
    let timer: NodeJS.Timeout | undefined;
    const interrupted = new Promise<never>((_, reject) => {
      const rejectOnAbort = () => reject(combined.reason ?? new Error("EventSink 投递已取消"));
      combined.addEventListener("abort", rejectOnAbort, { once: true });
      timer = setTimeout(
        () => timeoutController.abort(new Error(`EventSink ${sink.sinkId} 投递超时`)),
        this.#publishTimeoutMs,
      );
      timer.unref?.();
    });
    try {
      await Promise.race([sink.publish(event, { signal: combined }), interrupted]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async commit(
    state: Readonly<RunState>,
    event: Readonly<AgentEvent>,
    signal: AbortSignal,
    excludedSinkIds: ReadonlySet<string> = new Set(),
  ): Promise<RunState> {
    const candidate = reduceRunState(state, event);
    const requiredFailures: Array<{ readonly sinkId: string; readonly cause: unknown }> = [];
    // 即使一个 required sink 失败，也继续把同一候选事实投递给其余 required sink，
    // 这样健康 sink 后续接收 run.failed 时不会出现事件 sequence 缺口。
    for (const sink of this.#sinks) {
      if (sink.delivery !== "required" || excludedSinkIds.has(sink.sinkId)) continue;
      try {
        await this.#publish(sink, event, signal);
      } catch (error) {
        requiredFailures.push({ sinkId: sink.sinkId, cause: error });
      }
    }
    if (requiredFailures.length > 0) {
      const first = requiredFailures[0]!;
      throw new RequiredSinkError(
        first.sinkId,
        first.cause,
        requiredFailures.map((failure) => failure.sinkId),
      );
    }
    for (const sink of this.#sinks) {
      if (sink.delivery !== "best_effort" || excludedSinkIds.has(sink.sinkId)) continue;
      try {
        await this.#publish(sink, event, signal);
      } catch (error) {
        this.#onDiagnostic?.({
          sinkId: sink.sinkId,
          eventId: event.meta.eventId,
          message: error instanceof Error ? error.message : "Best-effort sink 失败",
        });
      }
    }
    return candidate;
  }
}
