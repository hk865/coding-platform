/**
 * FakeRuntimeAdapter — P1-03 WorkerRuntime RunPort implementation (Lane B).
 *
 * A REAL, replayable adapter (not a scripted test stub):
 *   - it rebases a deterministic FakeRuntimeScriptV1 onto a run
 *     (runRef = envelope.runRef; eventId = "rt-<runId>-<seq4>"; occurredAt and
 *     payload copied verbatim) — field-identical to contracts/fixtures'
 *     rebaseScriptForRun, but implemented here WITHOUT importing the fixture
 *     module;
 *   - start() is idempotent per runRef: the FIRST start rebases and caches the
 *     events; a later start of the SAME runRef returns the SAME handle and the
 *     SAME event batch (replayable by construction);
 *   - RunHandle.pollFreshEvents() drains the script in sequence order (atomically
 *     clears the not-yet-polled queue) and returns [] once the terminal event
 *     has been observed;
 *   - capabilities() declares replayable: true, supportsSnapshot: false,
 *     maxEnvelopeBytes = TASK_ENVELOPE_MAX_SIZE_BYTES;
 *   - the adapter ONLY emits events: it NEVER assesses truth, never marks tasks
 *     satisfied, and never fabricates an outcome_unknown (that is an explicit
 *     Control fact). No snapshot capability and no control/cancel in P1-03.
 */
import type { RunCapabilities, RunHandle, RunPort } from "../contracts/ports.js";
import { isTerminalRuntimeEvent } from "../contracts/dispatch.js";
import type { RuntimeEventV1 } from "../contracts/dispatch.js";
import type { TaskEnvelopeV1 } from "../contracts/task-envelope.js";
import { TASK_ENVELOPE_MAX_SIZE_BYTES } from "../contracts/task-envelope.js";
import type { FakeRuntimeScriptV1 } from "../contracts/fixtures/dispatch-fixtures.js";
import { canonicalJson } from "../contracts/fingerprint.js";

/** Per-run runtime state (single-writer, per runRef). */
class FakeRunHandle implements RunHandle {
  readonly runRef: TaskEnvelopeV1["runRef"];
  private readonly events: RuntimeEventV1[];
  private nextIndex: number;
  private terminated: boolean;

  constructor(runRef: TaskEnvelopeV1["runRef"], events: RuntimeEventV1[]) {
    this.runRef = runRef;
    this.events = events;
    this.nextIndex = 0;
    this.terminated = false;
  }

  async pollFreshEvents(): Promise<RuntimeEventV1[]> {
    if (this.terminated) return [];
    const remaining = this.events.slice(this.nextIndex);
    this.nextIndex = this.events.length;
    if (remaining.length > 0 && isTerminalRuntimeEvent(remaining[remaining.length - 1]!)) {
      this.terminated = true;
    }
    return remaining;
  }
}

/**
 * Deterministic script rebase (no fixture import): stamps runRef + ids.
 * eventId = "rt-" + runId + "-" + seq.padStart(4, "0"); occurredAt/payload copied.
 */
function rebaseScript(script: FakeRuntimeScriptV1, runRef: TaskEnvelopeV1["runRef"]): RuntimeEventV1[] {
  return script.items.map((item) => {
    const eventId = "rt-" + runRef.runId + "-" + String(item.sequence).padStart(4, "0");
    return {
      eventType: item.eventType,
      schemaVersion: 1,
      eventId,
      runRef: { ...runRef },
      sequence: item.sequence,
      occurredAt: item.occurredAt,
      payload: item.payload,
    };
  });
}

/**
 * P1-07 versioned extension (optional): a per-envelope script selector lets
 * ONE adapter serve different runs with different deterministic scripts (a
 * reader run vs. a writer run, or two readers with distinct evidence scripts).
 * The DEFAULT selector returns the single constructor script — the P1-03
 * behavior is byte-identical (zero regression; scripts are per-run rebased).
 */
export type FakeRuntimeScriptSelector = (envelope: TaskEnvelopeV1) => FakeRuntimeScriptV1;

export class FakeRuntimeAdapter implements RunPort {
  private readonly script: FakeRuntimeScriptV1;
  private readonly scriptFor: FakeRuntimeScriptSelector | null;
  private readonly runs = new Map<string, FakeRunHandle>();

  constructor(script: FakeRuntimeScriptV1, options?: { scriptFor?: FakeRuntimeScriptSelector }) {
    this.script = script;
    this.scriptFor = options?.scriptFor ?? null;
  }

  capabilities(): Promise<RunCapabilities> {
    return Promise.resolve({
      replayable: true,
      supportsSnapshot: false,
      maxEnvelopeBytes: TASK_ENVELOPE_MAX_SIZE_BYTES,
    });
  }

  start(envelope: TaskEnvelopeV1): Promise<RunHandle> {
    const runKey = canonicalJson(envelope.runRef);
    const existing = this.runs.get(runKey);
    if (existing !== undefined) {
      // Idempotent replay: same runRef -> same handle / same event batch.
      return Promise.resolve(existing);
    }
    const script = this.scriptFor === null ? this.script : this.scriptFor(envelope);
    const events = rebaseScript(script, envelope.runRef);
    const handle = new FakeRunHandle(envelope.runRef, events);
    this.runs.set(runKey, handle);
    return Promise.resolve(handle);
  }
}

export function createFakeRuntimeAdapter(script: FakeRuntimeScriptV1): FakeRuntimeAdapter {
  return new FakeRuntimeAdapter(script);
}
