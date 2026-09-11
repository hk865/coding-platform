import { toolResultSchema } from "../../src/core/ports/tool_executor/tool-executor-port.js";
import type {
  ToolCall,
  ToolEffects,
  ToolExecutionOptions,
  ToolExecutorPort,
  ToolResult,
} from "../../src/core/ports/tool_executor/tool-executor-port.js";

import type { ControllableGate } from "./controllable-gate.js";

export type FakeToolAction =
  | { readonly kind: "return"; readonly result: unknown }
  | { readonly kind: "throw"; readonly error: Error }
  | { readonly kind: "wait"; readonly gate: ControllableGate; readonly onAbort: "throw" }
  | {
      readonly kind: "wait";
      readonly gate: ControllableGate;
      readonly onAbort: "cancel";
      readonly reason: string;
      readonly effects: ToolEffects;
    };

export type FakeToolScript = readonly FakeToolAction[];

export interface FakeToolExecutorConfig {
  readonly byOrder?: readonly FakeToolScript[];
  readonly byCallId?: Readonly<Record<string, FakeToolScript>>;
}

function abortError(): Error {
  const error = new Error("FakeToolExecutor observed AbortSignal");
  error.name = "AbortError";
  return error;
}

export class FakeToolExecutor implements ToolExecutorPort {
  readonly #byOrder: readonly FakeToolScript[];
  readonly #byCallId: Readonly<Record<string, FakeToolScript>>;
  readonly #calls: ToolCall[] = [];
  readonly #actionPositions: number[] = [];
  #abortObservationCount = 0;
  #activeCallCount = 0;
  #maxConcurrentCalls = 0;
  #sideEffectCount = 0;
  #confirmedSideEffectCount = 0;

  constructor(config: FakeToolExecutorConfig = {}) {
    this.#byOrder = config.byOrder ?? [];
    this.#byCallId = config.byCallId ?? {};
  }

  get calls(): readonly ToolCall[] {
    return structuredClone(this.#calls);
  }

  get actionPositions(): readonly number[] {
    return [...this.#actionPositions];
  }

  get abortObservationCount(): number {
    return this.#abortObservationCount;
  }

  get maxConcurrentCalls(): number {
    return this.#maxConcurrentCalls;
  }

  get sideEffectCount(): number {
    return this.#sideEffectCount;
  }

  get confirmedSideEffectCount(): number {
    return this.#confirmedSideEffectCount;
  }

  async execute(
    call: Readonly<ToolCall>,
    options: Readonly<ToolExecutionOptions>,
  ): Promise<ToolResult> {
    const callIndex = this.#calls.length;
    const script = this.#byCallId[call.callId] ?? this.#byOrder[callIndex];
    if (!script) throw new Error("FakeToolExecutor 缺少调用 " + call.callId + " 的脚本");

    this.#calls.push(structuredClone(call));
    this.#actionPositions.push(0);
    this.#activeCallCount += 1;
    this.#maxConcurrentCalls = Math.max(this.#maxConcurrentCalls, this.#activeCallCount);
    let abortObserved = false;

    const observeAbort = () => {
      if (abortObserved) return;
      abortObserved = true;
      this.#abortObservationCount += 1;
    };

    try {
      for (const [actionIndex, action] of script.entries()) {
        this.#actionPositions[callIndex] = actionIndex;
        if (options.signal.aborted) {
          observeAbort();
          throw abortError();
        }

        if (action.kind === "wait") {
          const waitResult = await action.gate.wait(options.signal);
          if (waitResult === "aborted") {
            observeAbort();
            if (action.onAbort === "throw") throw abortError();
            this.#actionPositions[callIndex] = actionIndex + 1;
            return this.#recordResult({
              schemaVersion: 1,
              callId: call.callId,
              status: "cancelled",
              reason: action.reason,
              output: [],
              effects: action.effects,
            });
          }
        } else if (action.kind === "throw") {
          throw action.error;
        } else {
          this.#actionPositions[callIndex] = actionIndex + 1;
          return this.#recordResult(action.result);
        }
        this.#actionPositions[callIndex] = actionIndex + 1;
      }
      throw new Error("FakeToolExecutor 调用 " + call.callId + " 的脚本没有终止动作");
    } finally {
      this.#activeCallCount -= 1;
    }
  }

  #recordResult(candidate: unknown): ToolResult {
    const parsed = toolResultSchema.safeParse(candidate);
    if (parsed.success && parsed.data.effects.sideEffect !== "none") {
      this.#sideEffectCount += 1;
      if (parsed.data.effects.sideEffect === "confirmed") this.#confirmedSideEffectCount += 1;
    }
    return structuredClone(candidate) as ToolResult;
  }
}
