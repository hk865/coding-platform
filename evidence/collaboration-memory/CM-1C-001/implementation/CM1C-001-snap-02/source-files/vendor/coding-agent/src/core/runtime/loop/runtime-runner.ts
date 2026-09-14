/**
 * 模块职责：实现 Agent 主循环，串联上下文、Hook、模型、工具、事件和状态机。
 *
 * 设计边界：Runner 只依赖 Core 端口；权限、沙箱、存储和模型供应商由外层实现注入。
 * 关键流程：选择并构建上下文，调用模型，处理工具组，把每一步结果提交为事件，直到终态。
 */
import { randomUUID } from "node:crypto";

import type {
  ContextBuilderInput,
  ContextBuilderPort,
} from "../../context/builder/context-builder.js";
import { DeterministicContextBuilder } from "../../context/builder/context-builder.js";
import {
  CharacterTokenEstimator,
  ContextSelectionError,
  estimateTokens,
  selectContext,
} from "../../context/selection_policy/context-selection-policy.js";
import type { TokenEstimator } from "../../context/selection_policy/context-selection-policy.js";
import type {
  ContextFragment,
  MemoryItem,
  SkillContext,
} from "../../context/types/context-types.js";
import { HookExecutionError, HookExecutor } from "../../hooks/executor/hook-executor.js";
import type {
  ModelClientPort,
  ModelRequest,
  ModelToolSpec,
} from "../../ports/model_client/model-client-port.js";
import {
  assertToolResultMatchesCall,
  toolResultSchema,
} from "../../ports/tool_executor/tool-executor-port.js";
import { SerialToolBatchPolicy } from "../../ports/tool_batch_policy/tool-batch-policy-port.js";
import type {
  ToolBatchPolicy,
  ToolExecutionGroup,
} from "../../ports/tool_batch_policy/tool-batch-policy-port.js";
import type {
  FailedToolResult,
  ToolCall,
  ToolEffectClass,
  ToolExecutorPort,
  ToolResult,
} from "../../ports/tool_executor/tool-executor-port.js";
import type { EventSinkPort } from "../../ports/event_sink/event-sink-port.js";
import { CancellationController } from "../cancellation/cancellation-controller.js";
import type { CancellationReason } from "../cancellation/cancellation-controller.js";
import { agentEventSchema } from "../events/agent-events.js";
import type { AgentEvent } from "../events/agent-events.js";
import { LimitGuard, UNLIMITED_RUN_LIMITS } from "../limits/limit-guard.js";
import type { LimitViolation, RunLimits } from "../limits/limit-guard.js";
import { reduceRunState } from "../reducer/run-state-reducer.js";
import { outcomeUnknownPayload } from "../tool-outcome-unknown.js";
import type { ToolOutcomeUnknownReason } from "../tool-outcome-unknown.js";
import {
  createInitialRunState,
  deriveRunPhase,
  isTerminalRunStatus,
  runStateSchema,
} from "../state/run-state.js";
import type { Run, RunFailure, RunState, TranscriptEntry } from "../state/run-state.js";
import { consumeModelStream } from "./model-stream-consumer.js";
import {
  EventDeliveryCoordinator,
  RequiredSinkError,
} from "../event_delivery/event-delivery-coordinator.js";

export interface RuntimeClock {
  now(): Date;
}

export interface RuntimeIdGenerator {
  next(): string;
}

export interface RunnerContextInput {
  readonly run: Run;
  readonly baseSystemPrompt: string;
  readonly additionalInstructions?: readonly ContextFragment[];
  readonly tools?: readonly ModelToolSpec[];
  readonly skills?: readonly SkillContext[];
  readonly memories?: readonly MemoryItem[];
  readonly tokenBudget: number;
  readonly maxOutputTokens?: number | null;
}

export interface RunnerCallOptions {
  readonly signal?: AbortSignal;
  readonly cancellationReason?: CancellationReason;
}

export interface RuntimeRunnerDependencies {
  readonly modelClient: ModelClientPort;
  readonly toolExecutor: ToolExecutorPort;
  readonly contextBuilder?: ContextBuilderPort;
  readonly tokenEstimator?: TokenEstimator;
  readonly hookExecutor?: HookExecutor;
  readonly eventSinks?: readonly EventSinkPort[];
  readonly limits?: RunLimits;
  readonly clock?: RuntimeClock;
  readonly idGenerator?: RuntimeIdGenerator;
  readonly toolBatchPolicy?: ToolBatchPolicy;
  readonly maxModelRetries?: number;
  readonly eventSinkTimeoutMs?: number;
  readonly onTextDelta?: (delta: string, requestId: string) => void;
  readonly onReasoningDelta?: (delta: string, requestId: string) => void;
  /**
   * 返回工具声明的副作用类别，用于 outcome_unknown 的审计与合成结果。
   * 缺省按最保守的 process 处理（可能产生副作用，禁止自动重试）。
   */
  readonly toolEffectClass?: (call: Readonly<ToolCall>) => ToolEffectClass;
  /**
   * 工具组收尾的有界等待时间（毫秒）。组内个别工具忽略 AbortSignal 且永不返回时，
   * drain 超时后按「结果未知」落盘 cancelled/outcome_unknown，避免取消流程永久挂起。
   * 0 表示无限等待（不推荐）；默认 5_000。
   */
  readonly toolDrainTimeoutMs?: number;
}

class SystemClock implements RuntimeClock {
  now(): Date {
    return new Date();
  }
}

class RandomIdGenerator implements RuntimeIdGenerator {
  next(): string {
    return randomUUID();
  }
}

export class RunnerBusyError extends Error {
  readonly code = "runner_busy";

  constructor() {
    super("同一个 RuntimeRunner 不能并发运行两个 Run");
    this.name = "RunnerBusyError";
  }
}

type ExecutionMode = "start" | "resume" | "continue";

interface ExecutionContext {
  readonly input: RunnerContextInput;
  readonly cancellation: CancellationController;
  readonly unlink: () => void;
  readonly startedEpochMs: number;
  readonly initialElapsedMs: number;
  readonly presentations: Map<string, ToolResult["output"]>;
  /** 已成功提交的 tool.started 事件 eventId，供 outcome_unknown 审计追踪。 */
  readonly toolStartedEventIds: Map<string, string>;
}

function failure(
  category: RunFailure["category"],
  code: string,
  message: string,
  operationId: string | null = null,
  retryable = false,
): RunFailure {
  return { category, code, message, retryable, operationId };
}

function hookFailure(error: unknown): RunFailure {
  if (error instanceof HookExecutionError) {
    return failure("hook", error.code, error.message, error.hookId);
  }
  return failure("hook", "hook_failed", error instanceof Error ? error.message : "Hook 失败");
}

function cancelledToFailure(
  result: Extract<ToolResult, { status: "cancelled" }>,
): FailedToolResult {
  return {
    schemaVersion: 1,
    callId: result.callId,
    status: "error",
    error: { code: "execution_failed", message: result.reason, retryable: true },
    output: result.output,
    effects: result.effects,
  };
}

function withPresentations(
  transcript: readonly TranscriptEntry[],
  presentations: ReadonlyMap<string, ToolResult["output"]>,
): readonly TranscriptEntry[] {
  return transcript.map((entry) => {
    if (entry.kind !== "tool_result") return entry;
    const output = presentations.get(entry.callId);
    return output ? { ...entry, result: { ...entry.result, output } as ToolResult } : entry;
  });
}

function validatePlan(
  calls: readonly ToolCall[],
  groups: readonly ToolExecutionGroup[],
): readonly ToolExecutionGroup[] {
  const expected = calls.map((call) => call.callId).sort();
  const actual = groups.flatMap((group) => group.callIds).sort();
  if (
    expected.length !== actual.length ||
    expected.some((callId, index) => callId !== actual[index]) ||
    groups.some(
      (group) =>
        group.callIds.length === 0 || (group.mode === "serial" && group.callIds.length !== 1),
    )
  ) {
    throw new Error("ToolBatchPolicy 必须恰好覆盖所有调用，serial 组必须只有一个调用");
  }
  return groups;
}

/**
 * Runtime 的唯一编排入口：所有状态变化先构造 AgentEvent，再经 required sink
 * 提交和 Reducer 推进；模型、Hook、工具都不能直接修改 RunState。
 */
export class RuntimeRunner {
  readonly #modelClient: ModelClientPort;
  readonly #toolExecutor: ToolExecutorPort;
  readonly #contextBuilder: ContextBuilderPort;
  readonly #tokenEstimator: TokenEstimator;
  readonly #hooks: HookExecutor;
  readonly #delivery: EventDeliveryCoordinator;
  readonly #limitGuard: LimitGuard;
  readonly #clock: RuntimeClock;
  readonly #ids: RuntimeIdGenerator;
  readonly #toolBatchPolicy: ToolBatchPolicy;
  readonly #maxModelRetries: number;
  readonly #onTextDelta: ((delta: string, requestId: string) => void) | undefined;
  readonly #onReasoningDelta: ((delta: string, requestId: string) => void) | undefined;
  readonly #toolEffectClass: (call: Readonly<ToolCall>) => ToolEffectClass;
  readonly #toolDrainTimeoutMs: number;
  #busy = false;

  constructor(dependencies: RuntimeRunnerDependencies) {
    this.#modelClient = dependencies.modelClient;
    this.#toolExecutor = dependencies.toolExecutor;
    this.#contextBuilder = dependencies.contextBuilder ?? new DeterministicContextBuilder();
    this.#tokenEstimator = dependencies.tokenEstimator ?? new CharacterTokenEstimator();
    this.#hooks = dependencies.hookExecutor ?? new HookExecutor();
    this.#delivery = new EventDeliveryCoordinator(
      dependencies.eventSinks,
      undefined,
      dependencies.eventSinkTimeoutMs,
    );
    this.#limitGuard = new LimitGuard(dependencies.limits ?? UNLIMITED_RUN_LIMITS);
    this.#clock = dependencies.clock ?? new SystemClock();
    this.#ids = dependencies.idGenerator ?? new RandomIdGenerator();
    this.#toolBatchPolicy = dependencies.toolBatchPolicy ?? new SerialToolBatchPolicy();
    this.#maxModelRetries = dependencies.maxModelRetries ?? 0;
    if (!Number.isSafeInteger(this.#maxModelRetries) || this.#maxModelRetries < 0) {
      throw new RangeError("maxModelRetries 必须是非负安全整数");
    }
    this.#onTextDelta = dependencies.onTextDelta;
    this.#onReasoningDelta = dependencies.onReasoningDelta;
    this.#toolEffectClass = dependencies.toolEffectClass ?? (() => "process");
    const toolDrainTimeoutMs = dependencies.toolDrainTimeoutMs ?? 5_000;
    if (!Number.isSafeInteger(toolDrainTimeoutMs) || toolDrainTimeoutMs < 0) {
      throw new RangeError("toolDrainTimeoutMs 必须是非负安全整数");
    }
    this.#toolDrainTimeoutMs = toolDrainTimeoutMs;
  }

  async run(
    input: Readonly<RunnerContextInput>,
    options: RunnerCallOptions = {},
  ): Promise<RunState> {
    return this.#guardedExecute(createInitialRunState(input.run), input, "start", options);
  }

  async resume(
    pausedState: Readonly<RunState>,
    input: Readonly<RunnerContextInput>,
    options: RunnerCallOptions = {},
  ): Promise<RunState> {
    const state = runStateSchema.parse(pausedState);
    if (state.status !== "paused") throw new Error("只有 paused RunState 可以 resume");
    if (state.runId !== input.run.runId) throw new Error("resume input 的 runId 不匹配");
    return this.#guardedExecute(state, input, "resume", options);
  }

  /**
   * 接收 RecoveryCoordinator 已完成 reconciliation 的稳定状态。
   * awaiting_model 或 running tool 必须先由恢复器消解，不能在这里猜测执行结果。
   */
  async continueRecovered(
    recoveredState: Readonly<RunState>,
    input: Readonly<RunnerContextInput>,
    options: RunnerCallOptions = {},
  ): Promise<RunState> {
    const state = runStateSchema.parse(recoveredState);
    if (state.runId !== input.run.runId) throw new Error("recovery input 的 runId 不匹配");
    if (isTerminalRunStatus(state.status)) return state;
    if (state.status === "paused") throw new Error("paused 状态请使用 resume");
    if (
      state.activeModelRequest ||
      state.toolBatch?.calls.some((call) => call.status === "running")
    ) {
      throw new Error("恢复状态仍包含未 reconciliation 的运行中操作");
    }
    const phase = deriveRunPhase(state);
    if (phase === "awaiting_model") throw new Error("恢复状态仍在等待模型结果");
    return this.#guardedExecute(state, input, phase === "created" ? "start" : "continue", options);
  }

  async #guardedExecute(
    initialState: RunState,
    input: Readonly<RunnerContextInput>,
    mode: ExecutionMode,
    options: RunnerCallOptions,
  ): Promise<RunState> {
    if (this.#busy) throw new RunnerBusyError();
    this.#busy = true;
    const cancellation = new CancellationController();
    const unlink = cancellation.link(
      options.signal,
      options.cancellationReason ?? "caller_requested",
    );
    const context: ExecutionContext = {
      input: {
        ...input,
        additionalInstructions: input.additionalInstructions ?? [],
        tools: input.tools ?? [],
        skills: input.skills ?? [],
        memories: input.memories ?? [],
        maxOutputTokens: input.maxOutputTokens ?? null,
      },
      cancellation,
      unlink,
      startedEpochMs: this.#clock.now().getTime(),
      initialElapsedMs: initialState.elapsedMs,
      presentations: new Map(),
      toolStartedEventIds: new Map(),
    };
    try {
      return await this.#execute(initialState, context, mode);
    } finally {
      unlink();
      this.#busy = false;
    }
  }

  #elapsed(context: ExecutionContext, floor = context.initialElapsedMs): number {
    return Math.max(
      floor,
      context.initialElapsedMs + Math.max(0, this.#clock.now().getTime() - context.startedEpochMs),
    );
  }

  #createEvent(
    state: Readonly<RunState>,
    context: ExecutionContext,
    type: AgentEvent["type"],
    payload: unknown,
  ): AgentEvent {
    const now = this.#clock.now();
    return agentEventSchema.parse({
      type,
      meta: {
        schemaVersion: 1,
        eventId: this.#ids.next(),
        runId: state.runId,
        turnId: state.turn.turnId,
        sequence: state.lastEventSequence + 1,
        occurredAt: now.toISOString(),
        elapsedMs: this.#elapsed(context, state.elapsedMs),
      },
      payload,
    });
  }

  async #commit(
    state: RunState,
    context: ExecutionContext,
    type: AgentEvent["type"],
    payload: unknown,
    excludedSinkIds: ReadonlySet<string> = new Set(),
  ): Promise<RunState> {
    const event = this.#createEvent(state, context, type, payload);
    const deliverySignal = new AbortController().signal;
    try {
      const committed = await this.#delivery.commit(state, event, deliverySignal, excludedSinkIds);
      // tool.started 只有经全部 required sink 成功确认后才可被 outcome_unknown 引用；
      // 落盘失败（RequiredSinkError 降级为 run.failed）时不得残留未提交的 eventId。
      if (event.type === "tool.started") {
        context.toolStartedEventIds.set(event.payload.call.callId, event.meta.eventId);
      }
      return committed;
    } catch (error) {
      if (!(error instanceof RequiredSinkError)) throw error;
      const candidate = reduceRunState(state, event);
      if (isTerminalRunStatus(candidate.status)) return candidate;
      const failedEvent = this.#createEvent(candidate, context, "run.failed", {
        failure: failure(
          "required_sink",
          "required_sink_failed",
          `Required sink ${error.sinkId} 失败`,
          error.sinkId,
        ),
      });
      return this.#delivery.commit(
        candidate,
        failedEvent,
        deliverySignal,
        new Set([...excludedSinkIds, ...error.failedSinkIds]),
      );
    }
  }

  /**
   * 为已开始但无法取得结果的调用提交 tool.outcome_unknown（模型可见合成结果）。
   * 这是「结果确实未知」的唯一显式事件路径；有副作用工具不得自动重试。
   */
  async #recordOutcomeUnknown(
    state: RunState,
    context: ExecutionContext,
    call: Readonly<ToolCall>,
    reason: ToolOutcomeUnknownReason,
  ): Promise<RunState> {
    // 工具执行前 tool.started 已通过 required ACK，eventId 必然已记录；
    // 缺失说明执行屏障被破坏，属于内部不变量错误。
    const recordedCallEventId = context.toolStartedEventIds.get(call.callId);
    if (!recordedCallEventId) {
      throw new Error(
        `调用 ${call.callId} 缺少已提交的 tool.started 事件，无法记录 outcome_unknown`,
      );
    }
    return this.#commit(state, context, "tool.outcome_unknown", {
      ...outcomeUnknownPayload(call, reason, this.#toolEffectClass(call), recordedCallEventId),
    });
  }

  async #terminateForLimit(
    state: RunState,
    context: ExecutionContext,
    violation: LimitViolation,
  ): Promise<RunState> {
    return this.#commit(state, context, "run.limit_exceeded", violation);
  }

  async #checkStop(state: RunState, context: ExecutionContext): Promise<RunState | null> {
    const deadline = this.#limitGuard.atElapsed(this.#elapsed(context, state.elapsedMs));
    if (deadline) return this.#terminateForLimit(state, context, deadline);
    if (context.cancellation.signal.aborted) {
      return this.#commit(state, context, "run.cancelled", {
        reason: context.cancellation.reason ?? "caller_requested",
      });
    }
    return null;
  }

  async #execute(
    initialState: RunState,
    context: ExecutionContext,
    mode: ExecutionMode,
  ): Promise<RunState> {
    let state = initialState;
    if (mode === "resume") {
      state = await this.#commit(state, context, "run.resumed", { resumedBy: "app" });
    } else if (mode === "start") {
      state = await this.#commit(state, context, "run.started", {});
    }
    if (isTerminalRunStatus(state.status)) return state;

    let retryCount = 0;
    let retryOfRequestId: string | null = null;
    try {
      while (!isTerminalRunStatus(state.status) && state.status !== "paused") {
        const stopped = await this.#checkStop(state, context);
        if (stopped) return stopped;
        const phase = deriveRunPhase(state);
        if (phase === "ready_to_complete") {
          const last = state.transcript.at(-1);
          if (last?.kind !== "assistant_message") throw new Error("最终消息缺失");
          return this.#commit(state, context, "run.completed", {
            finalMessageId: last.message.messageId,
          });
        }
        if (phase === "before_tools") {
          state = await this.#executeTools(state, context);
          continue;
        }
        if (phase !== "before_model") throw new Error(`Runner 无法处理阶段 ${phase}`);

        const modelLimit = this.#limitGuard.beforeModel(state);
        if (modelLimit) return this.#terminateForLimit(state, context, modelLimit);
        const requestId = this.#ids.next();
        const builderInput: ContextBuilderInput = {
          requestId,
          runId: state.runId,
          baseSystemPrompt: context.input.baseSystemPrompt,
          additionalInstructions: context.input.additionalInstructions ?? [],
          transcript: withPresentations(state.transcript, context.presentations),
          tools: context.input.tools ?? [],
          skills: context.input.skills ?? [],
          memories: context.input.memories ?? [],
          tokenBudget: context.input.tokenBudget,
          maxOutputTokens: context.input.maxOutputTokens ?? null,
        };
        const selected = selectContext(builderInput, this.#tokenEstimator);
        let request: ModelRequest = this.#contextBuilder.build(selected.input);
        const beforeModel = await this.#hooks.beforeModel(
          state,
          request,
          context.cancellation.signal,
        );
        if (beforeModel.kind === "block") {
          return this.#commit(state, context, "run.failed", {
            failure: failure("hook", "hook_blocked", beforeModel.reason, requestId),
          });
        }
        if (beforeModel.kind === "pause") {
          return this.#commit(state, context, "run.paused", {
            pause: {
              reason: "hook_requested",
              requestedBy: "hook",
              pausedAt: this.#clock.now().toISOString(),
              pendingToolCallId: null,
            },
          });
        }
        if (beforeModel.kind === "fail") {
          return this.#commit(state, context, "run.failed", { failure: beforeModel.failure });
        }
        if (beforeModel.kind === "modify") {
          request = beforeModel.value;
          // Hook 可以调整提示词，但不能借此绕过调用方给定的模型上下文窗口。
          const modifiedEstimate = estimateTokens(request, this.#tokenEstimator);
          if (modifiedEstimate > context.input.tokenBudget) {
            throw new ContextSelectionError(
              "required_content_over_budget",
              `Hook 修改后的请求需要 ${modifiedEstimate} tokens，预算为 ${context.input.tokenBudget}`,
            );
          }
        }

        state = await this.#commit(state, context, "model.request_started", {
          requestId,
          retryOfRequestId,
        });
        if (isTerminalRunStatus(state.status)) return state;
        const stream = await consumeModelStream(this.#modelClient, request, {
          signal: context.cancellation.signal,
          ...(this.#onTextDelta
            ? { onTextDelta: (delta: string) => this.#onTextDelta?.(delta, requestId) }
            : {}),
          ...(this.#onReasoningDelta
            ? { onReasoningDelta: (delta: string) => this.#onReasoningDelta?.(delta, requestId) }
            : {}),
        });
        if ("usage" in stream && stream.usage) {
          state = await this.#commit(state, context, "model.usage_recorded", {
            requestId,
            delta: stream.usage,
          });
          const usageLimit = this.#limitGuard.afterUsage(state);
          if (usageLimit) return this.#terminateForLimit(state, context, usageLimit);
          if (this.#limitGuard.requiresKnownCost() && state.usage.costUsdMicros === null) {
            state = await this.#commit(state, context, "model.request_failed", {
              requestId,
              failure: failure("model", "usage_cost_unknown", "Provider 未提供成本", requestId),
            });
            return this.#commit(state, context, "run.failed", {
              failure: failure(
                "model",
                "usage_cost_unknown",
                "启用成本上限时成本必须可知",
                requestId,
              ),
            });
          }
        }

        if (stream.kind === "completed") {
          state = await this.#commit(state, context, "assistant.message_completed", {
            requestId,
            message: {
              schemaVersion: 1,
              messageId: this.#ids.next(),
              role: "assistant",
              content: stream.text,
              ...(stream.reasoning ? { reasoningContent: stream.reasoning } : {}),
            },
            toolCalls: stream.toolCalls,
          });
          retryCount = 0;
          retryOfRequestId = null;
          continue;
        }

        // 调用方取消优先于 Provider 在中止竞态中返回的 error/protocol_error。
        if (context.cancellation.signal.aborted) {
          return this.#commit(state, context, "run.cancelled", {
            reason: context.cancellation.reason ?? "caller_requested",
          });
        }
        const modelFailure =
          stream.kind === "protocol_error"
            ? failure("model_protocol", stream.code, stream.message, requestId)
            : stream.kind === "error"
              ? failure("model", stream.code, stream.message, requestId, stream.retryable)
              : failure("model", stream.kind, stream.message, requestId);
        state = await this.#commit(state, context, "model.request_failed", {
          requestId,
          failure: modelFailure,
        });
        if (modelFailure.retryable && retryCount < this.#maxModelRetries) {
          retryCount += 1;
          retryOfRequestId = requestId;
          continue;
        }
        return this.#commit(state, context, "run.failed", { failure: modelFailure });
      }
      return state;
    } catch (error) {
      if (isTerminalRunStatus(state.status)) return state;
      if (context.cancellation.signal.aborted) {
        return this.#commit(state, context, "run.cancelled", {
          reason: context.cancellation.reason ?? "caller_requested",
        });
      }
      const normalized =
        error instanceof ContextSelectionError
          ? failure("context", error.code, error.message)
          : error instanceof HookExecutionError
            ? hookFailure(error)
            : failure(
                "internal",
                "runner_internal",
                error instanceof Error ? error.message : "Runner 异常",
              );
      return this.#commit(state, context, "run.failed", { failure: normalized });
    }
  }

  async #executeTools(stateInput: RunState, context: ExecutionContext): Promise<RunState> {
    let state = stateInput;
    const pending = state.toolBatch?.calls.filter((call) => call.status === "pending") ?? [];
    const effectiveCalls: ToolCall[] = [];

    for (const execution of pending) {
      const stopped = await this.#checkStop(state, context);
      if (stopped) return stopped;
      const beforeTool = await this.#hooks.beforeTool(
        state,
        execution.requestedCall,
        context.cancellation.signal,
      );
      if (beforeTool.kind === "block") {
        const result: FailedToolResult = {
          schemaVersion: 1,
          callId: execution.requestedCall.callId,
          status: "error",
          error: { code: "hook_blocked", message: beforeTool.reason, retryable: false },
          output: [{ kind: "text", text: beforeTool.reason }],
          effects: {
            sideEffect: "none",
            changedPaths: [],
            workspaceRevision: null,
            artifactRefs: [],
          },
        };
        state = await this.#commit(state, context, "tool.failed", {
          callId: result.callId,
          phase: "pre_execution",
          result,
        });
        continue;
      }
      if (beforeTool.kind === "pause") {
        return this.#commit(state, context, "run.paused", {
          pause: {
            reason: "hook_requested",
            requestedBy: "hook",
            pausedAt: this.#clock.now().toISOString(),
            pendingToolCallId: execution.requestedCall.callId,
          },
        });
      }
      if (beforeTool.kind === "fail") {
        return this.#commit(state, context, "run.failed", { failure: beforeTool.failure });
      }
      effectiveCalls.push(
        beforeTool.kind === "modify" ? beforeTool.value : execution.requestedCall,
      );
    }

    if (
      isTerminalRunStatus(state.status) ||
      state.status === "paused" ||
      effectiveCalls.length === 0
    ) {
      return state;
    }
    const groups = validatePlan(effectiveCalls, this.#toolBatchPolicy.plan(effectiveCalls));
    const callsById = new Map(effectiveCalls.map((call) => [call.callId, call]));
    for (const group of groups) {
      const calls = group.callIds.map((callId) => callsById.get(callId)!);
      for (const call of calls) {
        const toolLimit = this.#limitGuard.beforeTool(state);
        if (toolLimit) return this.#terminateForLimit(state, context, toolLimit);
        state = await this.#commit(state, context, "tool.started", { call });
        // 启动事实未落盘（required sink 失败已降级为 run.failed）时不得启动副作用。
        if (isTerminalRunStatus(state.status)) return state;
      }
      const executions = calls.map(async (call) => {
        const raw = await this.#toolExecutor.execute(call, { signal: context.cancellation.signal });
        const parsed = toolResultSchema.parse(raw);
        assertToolResultMatchesCall(call, parsed);
        return { call, result: parsed };
      });
      // 等待组内所有工具停止。有界 drain 只在「取消已经发生后」开始计时：
      // 未取消的正常长工具必须遵从工具自身的超时（由执行器负责），不能被 Runner 提前判定失败；
      // 取消发生后，对忽略 AbortSignal 且永不返回的工具，drain 超时后按「结果未知」处理，
      // 保证 cancelled/outcome_unknown 能够落盘（内置工具由执行器信号/进程组终止）。
      type SettledOutcome =
        | { status: "fulfilled"; value: { call: ToolCall; result: ToolResult } }
        | { status: "rejected"; reason: unknown };
      const outcomeSlots: (SettledOutcome | undefined)[] = new Array(executions.length);
      const allSettledSignal = Promise.all(
        executions.map(
          (execution, index) =>
            new Promise<void>((resolve) => {
              void execution.then(
                (value) => {
                  outcomeSlots[index] = { status: "fulfilled", value };
                  resolve();
                },
                (reason) => {
                  outcomeSlots[index] = { status: "rejected", reason };
                  resolve();
                },
              );
            }),
        ),
      );
      const cancellationHappened = new Promise<void>((resolve) => {
        if (context.cancellation.signal.aborted) resolve();
        else context.cancellation.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      let drained = true;
      if (this.#toolDrainTimeoutMs > 0) {
        // timer 必须清理：泄漏的 pending timer 会保持进程事件循环存活（CLI 无法退出）。
        let drainTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          drained = await Promise.race([
            allSettledSignal.then(() => true),
            // 取消发生后才开始 drain 计时；未取消时该分支永不 resolve（工具自身超时兜底）。
            cancellationHappened.then(
              () =>
                new Promise<boolean>((resolve) => {
                  drainTimer = setTimeout(() => resolve(false), this.#toolDrainTimeoutMs);
                  void allSettledSignal.then(() => resolve(true));
                }),
            ),
          ]);
        } finally {
          clearTimeout(drainTimer);
        }
      } else {
        await allSettledSignal;
      }
      const fulfilled: { call: ToolCall; result: ToolResult }[] = [];
      const rejected: { call: ToolCall; error: unknown }[] = [];
      for (let index = 0; index < calls.length; index += 1) {
        const slot = outcomeSlots[index];
        if (!slot) {
          rejected.push({
            call: calls[index]!,
            error: new Error(
              drained ? "tool_executor_hung" : `tool_drain_timeout(${this.#toolDrainTimeoutMs}ms)`,
            ),
          });
        } else if (slot.status === "fulfilled") {
          fulfilled.push(slot.value);
        } else {
          rejected.push({ call: calls[index]!, error: slot.reason });
        }
      }

      // 已 started 但未返回结果的调用：强制中断时先记录结构化 outcome_unknown。
      if (context.cancellation.signal.aborted) {
        for (const { call } of rejected) {
          state = await this.#recordOutcomeUnknown(state, context, call, "cancelled_while_running");
          if (isTerminalRunStatus(state.status)) return state;
        }
      }

      // 结算已取得结果的调用（含协作式取消的 tool.cancelled）。
      let cancelledByRequest = false;
      for (const { call, result: originalResult } of fulfilled) {
        let result = originalResult;
        const afterTool = await this.#hooks.afterTool(state, result, context.cancellation.signal);
        if (afterTool.kind === "pause") {
          return this.#commit(state, context, "run.failed", {
            failure: failure("hook", "after_tool_pause_unsupported", afterTool.reason, call.callId),
          });
        }
        if (afterTool.kind === "fail") {
          return this.#commit(state, context, "run.failed", { failure: afterTool.failure });
        }
        if (afterTool.kind === "modify") {
          context.presentations.set(call.callId, afterTool.value.output);
        }
        if (result.status === "cancelled") {
          if (context.cancellation.signal.aborted) {
            // 正常协作式取消：先持久化真实 cancelled ToolResult，最后统一提交 run.cancelled。
            state = await this.#commit(state, context, "tool.cancelled", {
              callId: call.callId,
              result,
            });
            if (isTerminalRunStatus(state.status)) return state;
            cancelledByRequest = true;
            continue;
          }
          result = cancelledToFailure(result);
        }
        if (result.status === "success") {
          state = await this.#commit(state, context, "tool.completed", {
            callId: call.callId,
            result,
          });
        } else {
          state = await this.#commit(state, context, "tool.failed", {
            callId: call.callId,
            phase: "execution",
            result,
          });
        }
        if (isTerminalRunStatus(state.status)) return state;
      }
      if (context.cancellation.signal.aborted || cancelledByRequest) {
        // 取消事实（tool.cancelled / tool.outcome_unknown）已全部落盘后，才提交 run.cancelled。
        return this.#commit(state, context, "run.cancelled", {
          reason: context.cancellation.reason ?? "caller_requested",
        });
      }
      if (rejected.length > 0) {
        return this.#commit(state, context, "run.failed", {
          failure: failure(
            "tool_executor",
            "tool_executor_rejected",
            rejected[0]!.error instanceof Error ? rejected[0]!.error.message : "ToolExecutor 异常",
          ),
        });
      }
    }
    return state;
  }
}
