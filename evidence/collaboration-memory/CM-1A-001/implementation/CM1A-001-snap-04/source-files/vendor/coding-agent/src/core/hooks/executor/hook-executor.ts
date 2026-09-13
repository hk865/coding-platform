/**
 * 模块职责：按注册顺序执行模型前、工具前和工具后的 Hook，并合并修改结果。
 *
 * 设计边界：Hook 只能通过协议化决策影响流程；本模块不负责注册持久化或业务策略。
 * 关键流程：冻结注册表，逐个限时调用 Hook，校验返回值，遇到短路决策立即结束。
 */
import type { ModelRequest } from "../../ports/model_client/model-client-port.js";
import type { ToolCall, ToolResult } from "../../ports/tool_executor/tool-executor-port.js";
import type { RunState } from "../../runtime/state/run-state.js";
import { validateHookDecision } from "../protocol/hook-protocol.js";
import type {
  AfterToolHookDecision,
  BeforeModelHookDecision,
  BeforeToolHookDecision,
  HookDecision,
  HookPort,
  ToolResultPresentation,
} from "../protocol/hook-protocol.js";
import { HookRegistry } from "../registry/hook-registry.js";

export class HookExecutionError extends Error {
  constructor(
    readonly code: "hook_timeout" | "hook_failed" | "hook_invalid_result",
    message: string,
    readonly hookId: string,
  ) {
    super(message);
    this.name = "HookExecutionError";
  }
}

async function invokeWithTimeout<T>(
  hook: HookPort,
  signal: AbortSignal,
  timeoutMs: number | null,
  invoke: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (signal.aborted) throw signal.reason;
  if (timeoutMs === null) return invoke(signal);
  const timeoutController = new AbortController();
  const combined = AbortSignal.any([signal, timeoutController.signal]);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timeoutController.abort();
      reject(new HookExecutionError("hook_timeout", `Hook ${hook.hookId} 超时`, hook.hookId));
    }, timeoutMs);
    timer.unref();
  });
  try {
    return await Promise.race([invoke(combined), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function assertDecision(
  hook: HookPort,
  invocation: unknown,
  decision: unknown,
): asserts decision is HookDecision {
  const validation = validateHookDecision(invocation, decision);
  if (!validation.ok) {
    throw new HookExecutionError(
      "hook_invalid_result",
      `${validation.violation.code}: ${validation.violation.message}`,
      hook.hookId,
    );
  }
}

export class HookExecutor {
  readonly #registry: HookRegistry;
  readonly #timeoutMs: number | null;

  constructor(registry: HookRegistry = new HookRegistry(), timeoutMs: number | null = null) {
    if (timeoutMs !== null && (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)) {
      throw new RangeError("Hook timeout 必须是正安全整数或 null");
    }
    this.#registry = registry.freeze();
    this.#timeoutMs = timeoutMs;
  }

  async beforeModel(
    state: Readonly<RunState>,
    request: Readonly<ModelRequest>,
    signal: AbortSignal,
  ): Promise<BeforeModelHookDecision> {
    let value = structuredClone(request);
    let modified = false;
    for (const hook of this.#registry.list("before_model")) {
      const invocation = {
        schemaVersion: 1 as const,
        point: "before_model" as const,
        state,
        request: value,
      };
      let decision: unknown;
      try {
        decision = await invokeWithTimeout(hook, signal, this.#timeoutMs, (hookSignal) =>
          hook.execute(invocation, { signal: hookSignal }),
        );
      } catch (error) {
        if (error instanceof HookExecutionError) throw error;
        throw new HookExecutionError(
          "hook_failed",
          error instanceof Error ? error.message : "Hook 执行失败",
          hook.hookId,
        );
      }
      assertDecision(hook, invocation, decision);
      const typed = decision as BeforeModelHookDecision;
      if (typed.kind === "modify") {
        value = structuredClone(typed.value);
        modified = true;
      } else if (typed.kind !== "continue") return typed;
    }
    return modified
      ? { point: "before_model", kind: "modify", value }
      : { point: "before_model", kind: "continue" };
  }

  async beforeTool(
    state: Readonly<RunState>,
    call: Readonly<ToolCall>,
    signal: AbortSignal,
  ): Promise<BeforeToolHookDecision> {
    let value = structuredClone(call);
    let modified = false;
    for (const hook of this.#registry.list("before_tool")) {
      const invocation = {
        schemaVersion: 1 as const,
        point: "before_tool" as const,
        state,
        call: value,
      };
      let decision: unknown;
      try {
        decision = await invokeWithTimeout(hook, signal, this.#timeoutMs, (hookSignal) =>
          hook.execute(invocation, { signal: hookSignal }),
        );
      } catch (error) {
        if (error instanceof HookExecutionError) throw error;
        throw new HookExecutionError(
          "hook_failed",
          error instanceof Error ? error.message : "Hook 执行失败",
          hook.hookId,
        );
      }
      assertDecision(hook, invocation, decision);
      const typed = decision as BeforeToolHookDecision;
      if (typed.kind === "modify") {
        value = structuredClone(typed.value);
        modified = true;
      } else if (typed.kind !== "continue") return typed;
    }
    return modified
      ? { point: "before_tool", kind: "modify", value }
      : { point: "before_tool", kind: "continue" };
  }

  async afterTool(
    state: Readonly<RunState>,
    result: Readonly<ToolResult>,
    signal: AbortSignal,
  ): Promise<AfterToolHookDecision> {
    let presentation: ToolResultPresentation = { output: structuredClone(result.output) };
    let modified = false;
    for (const hook of this.#registry.list("after_tool")) {
      const currentResult = { ...result, output: presentation.output } as ToolResult;
      const invocation = {
        schemaVersion: 1 as const,
        point: "after_tool" as const,
        state,
        result: currentResult,
      };
      let decision: unknown;
      try {
        decision = await invokeWithTimeout(hook, signal, this.#timeoutMs, (hookSignal) =>
          hook.execute(invocation, { signal: hookSignal }),
        );
      } catch (error) {
        if (error instanceof HookExecutionError) throw error;
        throw new HookExecutionError(
          "hook_failed",
          error instanceof Error ? error.message : "Hook 执行失败",
          hook.hookId,
        );
      }
      assertDecision(hook, invocation, decision);
      const typed = decision as AfterToolHookDecision;
      if (typed.kind === "modify") {
        presentation = structuredClone(typed.value);
        modified = true;
      } else if (typed.kind !== "continue") return typed;
    }
    return modified
      ? { point: "after_tool", kind: "modify", value: presentation }
      : { point: "after_tool", kind: "continue" };
  }
}
