import type {
  ModelCallOptions,
  ModelClientPort,
  ModelEvent,
  ModelRequest,
} from "../../src/core/ports/model_client/model-client-port.js";

import type { ControllableGate } from "./controllable-gate.js";

export type FakeModelAction =
  | { readonly kind: "emit"; readonly event: unknown }
  | { readonly kind: "wait"; readonly gate: ControllableGate }
  | { readonly kind: "throw"; readonly error: Error };

export type FakeModelScript = readonly FakeModelAction[];

function abortError(): Error {
  const error = new Error("FakeModelClient observed AbortSignal");
  error.name = "AbortError";
  return error;
}

export class FakeModelClient implements ModelClientPort {
  readonly #scripts: readonly FakeModelScript[];
  readonly #requests: ModelRequest[] = [];
  readonly #actionPositions: number[] = [];
  #abortObservationCount = 0;
  #activeCallCount = 0;
  #maxConcurrentCalls = 0;

  constructor(scripts: readonly FakeModelScript[]) {
    this.#scripts = scripts;
  }

  get requests(): readonly ModelRequest[] {
    return structuredClone(this.#requests);
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

  stream(
    request: Readonly<ModelRequest>,
    options: Readonly<ModelCallOptions>,
  ): AsyncIterable<ModelEvent> {
    return this.#runScript(request, options.signal);
  }

  async *#runScript(
    request: Readonly<ModelRequest>,
    signal: AbortSignal,
  ): AsyncIterable<ModelEvent> {
    const callIndex = this.#requests.length;
    const script = this.#scripts[callIndex];
    if (!script) throw new Error("FakeModelClient 缺少第 " + (callIndex + 1) + " 次调用脚本");

    this.#requests.push(structuredClone(request));
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
        if (signal.aborted) {
          observeAbort();
          throw abortError();
        }

        if (action.kind === "wait") {
          const result = await action.gate.wait(signal);
          if (result === "aborted") {
            observeAbort();
            throw abortError();
          }
        } else if (action.kind === "throw") {
          throw action.error;
        } else {
          yield structuredClone(action.event) as ModelEvent;
        }
        this.#actionPositions[callIndex] = actionIndex + 1;
      }
    } finally {
      this.#activeCallCount -= 1;
    }
  }
}
