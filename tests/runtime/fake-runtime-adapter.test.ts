/**
 * Lane B P1-03: FakeRuntimeAdapter (tests/runtime/fake-runtime-adapter).
 *
 * The adapter is a REAL, replayable RunPort: it rebases a deterministic
 * FakeRuntimeScriptV1 onto a run, is idempotent per runRef, and drains the
 * script in sequence order. Coverage:
 *   - capabilities() (replayable / supportsSnapshot / maxEnvelopeBytes);
 *   - idempotent start: same runRef -> same handle + identical (replayable)
 *     event batch; different runRef -> distinct handle;
 *   - poll order (sequence order) + drain-to-empty + terminal => [];
 *   - rebase field-identical to contracts/fixtures rebaseScriptForRun.
 */
import { describe, expect, it } from "vitest";
import { canonicalJson } from "../../src/contracts/fingerprint.js";
import { runRefFor } from "../../src/contracts/dispatch.js";
import type { TaskEnvelopeV1 } from "../../src/contracts/task-envelope.js";
import { TASK_ENVELOPE_MAX_SIZE_BYTES } from "../../src/contracts/task-envelope.js";
import { artifactBodyDigest } from "../../src/contracts/artifact.js";
import {
  FAKE_RUNTIME_SCRIPT_COMPLETED_V1,
  FAKE_RUNTIME_SCRIPT_CRASHED_V1,
  buildEnvelopeFixture,
  rebaseScriptForRun,
} from "../../src/contracts/fixtures/dispatch-fixtures.js";
import { FakeRuntimeAdapter } from "../../src/runtime/fake-runtime-adapter.js";

const PROJECT = "proj-alpha";
const GOAL = "goal-1";
const WORKSPACE = "ws-shared";
const PLAN_REF = { aggregateType: "PlanRevision" as const, projectId: PROJECT, planId: "plan-dispatch-mvp" };

function envelope(runId: string, attemptId: string): TaskEnvelopeV1 {
  return buildEnvelopeFixture({
    envelopeId: "envelope-" + runId,
    projectId: PROJECT,
    workspaceId: WORKSPACE,
    goalId: GOAL,
    taskId: "task-run-adaptor",
    runId,
    attemptId,
    planRef: PLAN_REF,
    workspaceRevision: 1,
    bundleRef: {
      kind: "artifact" as const,
      contentType: "text/plain",
      digest: artifactBodyDigest("ctx-body"),
      sizeBytes: 8,
      source: { kind: "plan-revision" as const, refId: PLAN_REF.planId, revision: "1" },
    },
  });
}

describe("P1-03 FakeRuntimeAdapter", () => {
  it("capabilities() declares replayable + no snapshot + the hard envelope cap", async () => {
    const adapter = new FakeRuntimeAdapter(FAKE_RUNTIME_SCRIPT_COMPLETED_V1);
    const caps = await adapter.capabilities();
    expect(caps.replayable).toBe(true);
    expect(caps.supportsSnapshot).toBe(false);
    expect(caps.maxEnvelopeBytes).toBe(TASK_ENVELOPE_MAX_SIZE_BYTES);
    expect(TASK_ENVELOPE_MAX_SIZE_BYTES).toBe(64 * 1024);
  });

  it("start is idempotent per runRef: same handle, identical replayable batch", async () => {
    const adapter = new FakeRuntimeAdapter(FAKE_RUNTIME_SCRIPT_COMPLETED_V1);
    const env = envelope("run-idem", "att-idem");

    const h1 = await adapter.start(env);
    const h2 = await adapter.start(env);
    expect(h1).toBe(h2); // same handle for the same runRef
    expect(h1!.runRef).toEqual(runRefFor(PROJECT, GOAL, "run-idem"));

    // A different run (even with the same script) gets a distinct handle.
    const hOther = await adapter.start(envelope("run-other", "att-other"));
    expect(hOther).not.toBe(h1);

    // Deterministic replay across a FRESH adapter of the same script + runRef:
    const adapter2 = new FakeRuntimeAdapter(FAKE_RUNTIME_SCRIPT_COMPLETED_V1);
    const hFresh = await adapter2.start(env);
    const freshEvents = await hFresh!.pollFreshEvents();
    const expected = rebaseScriptForRun(FAKE_RUNTIME_SCRIPT_COMPLETED_V1, runRefFor(PROJECT, GOAL, "run-idem"));
    expect(canonicalJson(freshEvents)).toBe(canonicalJson(expected));
  });

  it("pollFreshEvents drains in sequence order and returns [] after the terminal", async () => {
    const adapter = new FakeRuntimeAdapter(FAKE_RUNTIME_SCRIPT_COMPLETED_V1);
    const handle = await adapter.start(envelope("run-order", "att-order"));
    const first = await handle!.pollFreshEvents();
    expect(first.map((e) => e.sequence)).toEqual([1, 2]);
    expect(first[0]!.eventType).toBe("run_started");
    expect(first[1]!.eventType).toBe("run_completed");
    // After the terminal event (run_completed), the queue is drained -> [].
    expect(await handle!.pollFreshEvents()).toEqual([]);
    expect(await handle!.pollFreshEvents()).toEqual([]);
  });

  it("one poll drains everything left atomically; earlier polled events are not re-returned", async () => {
    const adapter = new FakeRuntimeAdapter(FAKE_RUNTIME_SCRIPT_CRASHED_V1);
    const handle = await adapter.start(envelope("run-drain", "att-drain"));
    const first = await handle!.pollFreshEvents();
    expect(first.length).toBe(2); // whole script drained in one poll
    expect(await handle!.pollFreshEvents()).toEqual([]);
  });

  it("rebase is field-identical to fixtures.rebaseScriptForRun", async () => {
    for (const script of [FAKE_RUNTIME_SCRIPT_COMPLETED_V1, FAKE_RUNTIME_SCRIPT_CRASHED_V1] as const) {
      const adapter = new FakeRuntimeAdapter(script);
      const runRef = runRefFor(PROJECT, GOAL, "run-rebase");
      const handle = await adapter.start(envelope("run-rebase", "att-rebase"));
      const events = await handle!.pollFreshEvents();
      const expected = rebaseScriptForRun(script, runRef);
      expect(canonicalJson(events)).toBe(canonicalJson(expected));

      // eventId shape: rt-<runId>-<seq4>
      expect(events[0]!.eventId).toBe("rt-run-rebase-0001");
      expect(events[1]!.eventId).toBe("rt-run-rebase-0002");
      expect(events[0]!.runRef).toEqual(runRef);
      expect(events[0]!.schemaVersion).toBe(1);
    }
  });

  it("the adapter emits events only: never a satisfied write, never an outcome_unknown", async () => {
    const adapter = new FakeRuntimeAdapter(FAKE_RUNTIME_SCRIPT_COMPLETED_V1);
    const handle = await adapter.start(envelope("run-pure", "att-pure"));
    const events = await handle!.pollFreshEvents();
    // Only runtime events — no Task/phase mutation and no synthesized outcome_unknown.
    expect(events.every((e) => e.eventType !== "run_crashed" && e.eventType !== "run_cancelled")).toBe(true);
    expect(events.map((e) => e.eventType)).toEqual(["run_started", "run_completed"]);
  });
});
