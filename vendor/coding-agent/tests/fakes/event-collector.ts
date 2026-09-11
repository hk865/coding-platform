import type {
  EventSinkDelivery,
  EventSinkPort,
} from "../../src/core/ports/event_sink/event-sink-port.js";
import type { AgentEvent } from "../../src/core/runtime/events/agent-events.js";

import type { ControllableGate } from "./controllable-gate.js";

export interface EventCollectorConfig {
  readonly sinkId?: string;
  readonly delivery?: EventSinkDelivery;
  readonly failAtSequences?: readonly number[];
  readonly gatesBySequence?: ReadonlyMap<number, ControllableGate>;
}

const terminalEventTypes = new Set<AgentEvent["type"]>([
  "run.completed",
  "run.cancelled",
  "run.limit_exceeded",
  "run.failed",
]);

function abortError(): Error {
  const error = new Error("EventCollector observed AbortSignal");
  error.name = "AbortError";
  return error;
}

export class EventCollector implements EventSinkPort {
  readonly sinkId: string;
  readonly delivery: EventSinkDelivery;
  readonly #failAtSequences: ReadonlySet<number>;
  readonly #gatesBySequence: ReadonlyMap<number, ControllableGate>;
  readonly #attempts: AgentEvent[] = [];
  readonly #events: AgentEvent[] = [];

  constructor(config: EventCollectorConfig = {}) {
    this.sinkId = config.sinkId ?? "event-collector";
    this.delivery = config.delivery ?? "best_effort";
    this.#failAtSequences = new Set(config.failAtSequences ?? []);
    this.#gatesBySequence = config.gatesBySequence ?? new Map();
  }

  get attempts(): readonly AgentEvent[] {
    return structuredClone(this.#attempts);
  }

  get events(): readonly AgentEvent[] {
    return structuredClone(this.#events);
  }

  get terminalEventCount(): number {
    return this.#events.filter((event) => terminalEventTypes.has(event.type)).length;
  }

  eventsOfType<TType extends AgentEvent["type"]>(
    type: TType,
  ): readonly Extract<AgentEvent, { type: TType }>[] {
    // 按事件 type 收窄返回值，测试可直接读取该事件独有的 payload 字段。
    return structuredClone(
      this.#events.filter(
        (event): event is Extract<AgentEvent, { type: TType }> => event.type === type,
      ),
    );
  }

  async publish(
    event: Readonly<AgentEvent>,
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<void> {
    const snapshot = structuredClone(event);
    this.#attempts.push(snapshot);

    const gate = this.#gatesBySequence.get(snapshot.meta.sequence);
    if (gate) {
      const waitResult = await gate.wait(options.signal);
      if (waitResult === "aborted") throw abortError();
    } else if (options.signal.aborted) {
      throw abortError();
    }

    if (this.#failAtSequences.has(snapshot.meta.sequence)) {
      throw new Error(this.sinkId + " scripted failure at sequence " + snapshot.meta.sequence);
    }

    this.#events.push(structuredClone(snapshot));
  }
}
