/**
 * FakeRuntimeAdapter — P1-03 WorkerRuntime RunPort implementation.
 *
 * ENTRY FILE (shared baseline - exported signature FROZEN). Lane B fills the
 * implementation. It is a REAL, replayable adapter (not a scripted test stub):
 *   - replays a deterministic FakeRuntimeScriptV1 rebased onto the run
 *     (runRef = envelope.runRef; eventId = "rt-<runId>-<seq>");
 *   - start() is idempotent per (runRef, envelope) pair and returns a handle
 *     whose pollFreshEvents() drains the script in sequence order;
 *   - capabilities() declares replayable: true, supportsSnapshot: false,
 *     maxEnvelopeBytes = TASK_ENVELOPE_MAX_SIZE_BYTES;
 *   - the adapter ONLY emits events; it NEVER assesses truth, never marks
 *     tasks satisfied, and never fabricates an outcome_unknown (that is an
 *     explicit Control fact).
 */
import type { RunCapabilities, RunHandle, RunPort } from "../contracts/ports.js";
import type { TaskEnvelopeV1 } from "../contracts/task-envelope.js";
import type { FakeRuntimeScriptV1 } from "../contracts/fixtures/dispatch-fixtures.js";

export class FakeRuntimeAdapter implements RunPort {
  constructor(script: FakeRuntimeScriptV1) {
    void script;
  }

  capabilities(): Promise<RunCapabilities> {
    return Promise.resolve({ replayable: true, supportsSnapshot: false, maxEnvelopeBytes: 0 });
  }

  start(envelope: TaskEnvelopeV1): Promise<RunHandle> {
    void envelope;
    return Promise.reject(new Error("P1-03: FakeRuntimeAdapter.start not implemented yet"));
  }
}

export function createFakeRuntimeAdapter(script: FakeRuntimeScriptV1): FakeRuntimeAdapter {
  return new FakeRuntimeAdapter(script);
}
