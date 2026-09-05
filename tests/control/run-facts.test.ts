/**
 * Lane B P1-03: Control.runFact admission + fold (tests/control/run-facts).
 *
 * Drives the REAL ControlEngineImpl + InMemoryLedger (scripted): the Run@2 +
 * TaskAttempt@2 + DispatchOutboxEntry@2 pre-state is seeded by committing the
 * shared claim + start fixture commits directly to the ledger (the claim/start
 * CONTROL handlers are other lanes' stub), then runFact is exercised against
 * the committed per-run sequence.
 *
 * Coverage (ticket requirements):
 *   - admission table: duplicate / stale / conflict / after_terminal / normal
 *     sequence / crash / outcome_unknown / exit=0 — all zero-write rejections;
 *   - revision never regresses on an accepted fact (monotonic +1);
 *   - terminal facts fold TaskAttempt ended + DispatchOutboxEntry done;
 *   - fold-equivalence: committed snapshots are bit-identical to the shared
 *     fixture fold targets (buildRunEventRecordedCommit / buildRunOutcomeUnknownCommit);
 *   - zero-write: rejected facts never append events / never move a version.
 */
import { describe, expect, it } from "vitest";
import type {
  DispatchOutboxEntrySnapshot,
  RunSnapshot,
  RuntimeEventV1,
  TaskAttemptSnapshot,
} from "../../src/contracts/dispatch.js";
import {
  dispatchOutboxRefFor,
  runRefFor,
  taskAttemptRefFor,
} from "../../src/contracts/dispatch.js";
import type { AggregateRef, StateLedger } from "../../src/contracts/ledger.js";
import { canonicalJson } from "../../src/contracts/fingerprint.js";
import { artifactBodyDigest } from "../../src/contracts/artifact.js";
import { createInMemoryLedger } from "../../src/ledger/in-memory-ledger.js";
import { createControlEngine } from "../../src/control/control-engine.js";
import {
  DISPATCH_ELIGIBLE_TASK_ID,
  buildDispatchClaimCommand,
  buildDispatchClaimLedgerCommit,
  buildDispatchStartCommand,
  buildDispatchStartLedgerCommit,
  buildEnvelopeFixture,
  buildManifestFixture,
  buildRunEventRecordedCommit,
  buildRunFactCommand,
  buildRunOutcomeUnknownCommit,
} from "../../src/contracts/fixtures/dispatch-fixtures.js";

const PROJECT = "proj-alpha";
const GOAL = "goal-1";
const TASK = DISPATCH_ELIGIBLE_TASK_ID;
const WORKSPACE = "ws-shared";
const WORKSPACE_REVISION = 1;
const SCHEMA = "2026-09-05T12:00:00.000Z";
const PLAN_REF = { aggregateType: "PlanRevision" as const, projectId: PROJECT, planId: "plan-dispatch-mvp" };

type Harness = {
  ledger: StateLedger;
  engine: ReturnType<typeof createControlEngine>;
  eventIds: string[];
  nows: string[];
};

function makeHarness(): Harness {
  const ledger: StateLedger = createInMemoryLedger();
  const eventIds: string[] = [];
  const nows: string[] = [];
  const engine = createControlEngine({
    ledger,
    now: () => {
      const t = SCHEMA;
      nows.push(t);
      return t;
    },
    eventId: () => {
      const id = "evt-" + (eventIds.length + 1);
      eventIds.push(id);
      return id;
    },
  });
  return { ledger, engine, eventIds, nows };
}

async function snap<T>(ledger: StateLedger, ref: AggregateRef): Promise<T> {
  const res = await ledger.load(ref);
  if (res.status !== "found") throw new Error("snapshot not found: " + canonicalJson(ref));
  return res.snapshot as T;
}

async function seedStartedRun(h: Harness, runId: string, attemptId: string): Promise<{
  runRef: ReturnType<typeof runRefFor>;
  attemptRef: ReturnType<typeof taskAttemptRefFor>;
  outboxRef: ReturnType<typeof dispatchOutboxRefFor>;
}> {
  const claim = buildDispatchClaimCommand({
    commandId: "cmd-claim-" + runId,
    correlationId: "corr-claim-" + runId,
    submittedAt: SCHEMA,
    projectId: PROJECT,
    goalId: GOAL,
    taskId: TASK,
    attemptId,
    runId,
  });
  const claimCommit = buildDispatchClaimLedgerCommit(claim, {
    eventId: "claim-ev-1",
    occurredAt: SCHEMA,
    workspaceId: WORKSPACE,
    planRef: PLAN_REF,
    workspaceRevision: WORKSPACE_REVISION,
  });
  const claimReceipt = await h.ledger.commit(claimCommit);
  if (claimReceipt.status !== "committed") throw new Error("seed claim failed: " + claimReceipt.code);

  const runRef = runRefFor(PROJECT, GOAL, runId);
  const attemptRef = taskAttemptRefFor(PROJECT, GOAL, TASK, attemptId);
  const outboxRef = dispatchOutboxRefFor(PROJECT, GOAL, TASK, attemptId);

  const runSnap = await snap<RunSnapshot>(h.ledger, runRef);
  const attemptSnap = await snap<TaskAttemptSnapshot>(h.ledger, attemptRef);
  const outboxSnap = await snap<DispatchOutboxEntrySnapshot>(h.ledger, outboxRef);

  const envelope = buildEnvelopeFixture({
    envelopeId: "envelope-" + runId,
    projectId: PROJECT,
    workspaceId: WORKSPACE,
    goalId: GOAL,
    taskId: TASK,
    runId,
    attemptId,
    planRef: PLAN_REF,
    workspaceRevision: WORKSPACE_REVISION,
    bundleRef: {
      kind: "artifact" as const,
      contentType: "text/plain",
      digest: artifactBodyDigest("ctx-body"),
      sizeBytes: 8,
      source: { kind: "plan-revision" as const, refId: PLAN_REF.planId, revision: "1" },
    },
  });
  const start = buildDispatchStartCommand({
    commandId: "cmd-start-" + runId,
    correlationId: "corr-start-" + runId,
    submittedAt: SCHEMA,
    projectId: PROJECT,
    runId,
    expectedRevision: 1,
    envelope,
    manifest: buildManifestFixture({ workspaceId: WORKSPACE, workspaceRevision: WORKSPACE_REVISION, planRef: PLAN_REF }),
  });
  const startCommit = buildDispatchStartLedgerCommit(start, {
    eventId: "start-ev-1",
    occurredAt: SCHEMA,
    workspaceId: WORKSPACE,
    priorRun: runSnap,
    priorAttempt: attemptSnap,
    priorOutbox: outboxSnap,
  });
  const startReceipt = await h.ledger.commit(startCommit);
  if (startReceipt.status !== "committed") throw new Error("seed start failed: " + startReceipt.code);
  return { runRef, attemptRef, outboxRef };
}

function runtimeEvent(runId: string, sequence: number, partial: Partial<RuntimeEventV1> = {}): RuntimeEventV1 {
  return {
    eventType: "run_started",
    schemaVersion: 1,
    eventId: "rt-" + runId + "-" + String(sequence).padStart(4, "0"),
    runRef: runRefFor(PROJECT, GOAL, runId),
    sequence,
    occurredAt: "2026-09-05T12:00:0" + sequence + ".000Z",
    payload: { kind: "started", startedAt: "2026-09-05T12:00:01.000Z" },
    ...partial,
  };
}

function factCmd(runId: string, expectedRevision: number, fact: import("../../src/contracts/dispatch.js").RunFactV1): ReturnType<typeof buildRunFactCommand> {
  return buildRunFactCommand({
    commandId: "cmd-fact-" + runId + "-" + Math.random().toString(36).slice(2, 8),
    correlationId: "corr-fact-" + runId,
    submittedAt: SCHEMA,
    projectId: PROJECT,
    runId,
    expectedRevision,
    fact,
  });
}

describe("P1-03 Control.runFact", () => {
  it("normal sequence: started then completed(exit=0) ends the Run; Task.phase is NEVER written", async () => {
    const h = makeHarness();
    await seedStartedRun(h, "run-seq", "att-seq");
    const runRef = runRefFor(PROJECT, GOAL, "run-seq");

    const first = await h.engine.runFact(factCmd("run-seq", 2, { kind: "runtime_event", event: runtimeEvent("run-seq", 1) }));
    expect(first.status).toBe("committed");
    if (first.status !== "committed") return;
    expect(first.terminal).toBe(false);
    expect(first.runRevision).toBe(3);

    let run = await snap<RunSnapshot>(h.ledger, runRef);
    expect(run.status).toBe("running");
    expect(run.outcome).toBeNull();
    expect(run.lastEventSeq).toBe(1);
    expect(run.lastRuntimeEventId).toBe("rt-run-seq-0001");
    expect(run.revision).toBe(3); // monotonic +1, never regresses

    const second = await h.engine.runFact(factCmd("run-seq", 3, {
      kind: "runtime_event",
      event: runtimeEvent("run-seq", 2, { eventType: "run_completed", payload: { kind: "completed", exitCode: 0 } }),
    }));
    expect(second.status).toBe("committed");
    if (second.status !== "committed") return;
    expect(second.terminal).toBe(true);
    expect(second.runRevision).toBe(4);
    expect(second.applied).toEqual({ kind: "runtime_event", runtimeEventId: "rt-run-seq-0002", sequence: 2 });

    run = await snap<RunSnapshot>(h.ledger, runRef);
    expect(run.status).toBe("ended");
    expect(run.outcome).toBe("completed");
    expect(run.exitCode).toBe(0);
    expect(run.endedAt).toBe("2026-09-05T12:00:02.000Z");
    expect(run.revision).toBe(4);

    const attempt = await snap<TaskAttemptSnapshot>(h.ledger, taskAttemptRefFor(PROJECT, GOAL, TASK, "att-seq"));
    expect(attempt.status).toBe("ended");
    expect(attempt.endOutcome).toBe("completed");
    expect(attempt.endedAt).toBe("2026-09-05T12:00:02.000Z");
    expect(attempt.revision).toBe(3);

    const outbox = await snap<DispatchOutboxEntrySnapshot>(h.ledger, dispatchOutboxRefFor(PROJECT, GOAL, TASK, "att-seq"));
    expect(outbox.status).toBe("done");
    expect(outbox.doneAt).toBe("2026-09-05T12:00:02.000Z");
    expect(outbox.revision).toBe(3);

    // exit=0 NEVER writes Task.phase: P1-03 has no Task aggregate writes.
    const taskResult = await h.ledger.load({ aggregateType: "Task", projectId: PROJECT, goalId: GOAL, taskId: TASK } as never);
    expect(taskResult.status).toBe("not_found");
  });

  it("duplicate / stale / conflict are rejected zero-write and never regress revision", async () => {
    const h = makeHarness();
    await seedStartedRun(h, "run-dedup", "att-dedup");
    const runRef = runRefFor(PROJECT, GOAL, "run-dedup");

    // Two non-terminal facts advance lastEventSeq to 2 so a VALID stale
    // sequence (>= 1, < lastEventSeq) can be expressed. (seq 0 is rejected by
    // validateRuntimeEvent's min=1 guard BEFORE the stale check — see notes.)
    const first = await h.engine.runFact(factCmd("run-dedup", 2, { kind: "runtime_event", event: runtimeEvent("run-dedup", 1) }));
    expect(first.status).toBe("committed");
    const second = await h.engine.runFact(factCmd("run-dedup", 3, { kind: "runtime_event", event: runtimeEvent("run-dedup", 2) }));
    expect(second.status).toBe("committed");
    const before = await h.ledger.events({ afterCursor: null, limit: 500 });
    const beforeRun = await snap<RunSnapshot>(h.ledger, runRef);
    expect(beforeRun.lastEventSeq).toBe(2);

    // lower sequence -> stale_event
    const stale = await h.engine.runFact(factCmd("run-dedup", 4, { kind: "runtime_event", event: runtimeEvent("run-dedup", 1) }));
    expect(stale.status).toBe("rejected");
    if (stale.status === "rejected") expect(stale.code).toBe("stale_event");

    // same sequence + same id -> duplicate_event
    const dup = await h.engine.runFact(factCmd("run-dedup", 4, { kind: "runtime_event", event: runtimeEvent("run-dedup", 2) }));
    expect(dup.status).toBe("rejected");
    if (dup.status === "rejected") expect(dup.code).toBe("duplicate_event");

    // same sequence different id -> conflict_event
    const conflict = await h.engine.runFact(factCmd("run-dedup", 4, { kind: "runtime_event", event: runtimeEvent("run-dedup", 2, { eventId: "rt-other-0002" }) }));
    expect(conflict.status).toBe("rejected");
    if (conflict.status === "rejected") expect(conflict.code).toBe("conflict_event");

    const afterEvents = await h.ledger.events({ afterCursor: null, limit: 500 });
    expect(afterEvents.events.length).toBe(before.events.length); // zero write
    const afterRun = await snap<RunSnapshot>(h.ledger, runRef);
    expect(afterRun.revision).toBe(beforeRun.revision); // no regress
  });

  it("after_terminal rejects any fact (zero-write) on an ended run", async () => {
    const h = makeHarness();
    await seedStartedRun(h, "run-ter", "att-ter");
    const runRef = runRefFor(PROJECT, GOAL, "run-ter");

    await h.engine.runFact(factCmd("run-ter", 2, {
      kind: "runtime_event",
      event: runtimeEvent("run-ter", 1, { eventType: "run_completed", payload: { kind: "completed", exitCode: 0 } }),
    }));
    const after = await h.engine.runFact(factCmd("run-ter", 3, { kind: "runtime_event", event: runtimeEvent("run-ter", 2) }));
    expect(after.status).toBe("rejected");
    if (after.status === "rejected") expect(after.code).toBe("after_terminal");

    const unknownAfter = await h.engine.runFact(factCmd("run-ter", 3, { kind: "outcome_unknown", runRef: runRefFor(PROJECT, GOAL, "run-ter"), reason: "late" }));
    expect(unknownAfter.status).toBe("rejected");
    if (unknownAfter.status === "rejected") expect(unknownAfter.code).toBe("after_terminal");

    const run = await snap<RunSnapshot>(h.ledger, runRef);
    expect(run.status).toBe("ended");
    expect(run.revision).toBe(3); // never regressed
  });

  it("stale expectedRevision -> revision_conflict (zero-write); retrying a committed fact surfaces revision_conflict", async () => {
    const h = makeHarness();
    await seedStartedRun(h, "run-rev", "att-rev");
    const runRef = runRefFor(PROJECT, GOAL, "run-rev");

    // wrong expected revision (1 instead of 2) -> revision_conflict
    const conflict = await h.engine.runFact(factCmd("run-rev", 1, { kind: "runtime_event", event: runtimeEvent("run-rev", 1) }));
    expect(conflict.status).toBe("rejected");
    if (conflict.status === "rejected") {
      expect(conflict.code).toBe("revision_conflict");
      expect(conflict.currentRevision).toBe(2);
    }
    const beforeEvents = await h.ledger.events({ afterCursor: null, limit: 500 });
    const beforeRun = await snap<RunSnapshot>(h.ledger, runRef);

    // commit the real fact at revision 2
    const first = await h.engine.runFact(factCmd("run-rev", 2, { kind: "runtime_event", event: runtimeEvent("run-rev", 1) }));
    expect(first.status).toBe("committed");

    // retrying the SAME fact with the stale (now-old) expectedRevision 2 -> revision_conflict
    const retry = await h.engine.runFact(factCmd("run-rev", 2, { kind: "runtime_event", event: runtimeEvent("run-rev", 1) }));
    expect(retry.status).toBe("rejected");
    if (retry.status === "rejected") expect(retry.code).toBe("revision_conflict");

    const afterEvents = await h.ledger.events({ afterCursor: null, limit: 500 });
    expect(afterEvents.events.length).toBe(beforeEvents.events.length + 1); // only the committed fact
    const afterRun = await snap<RunSnapshot>(h.ledger, runRef);
    expect(afterRun.revision).toBe(beforeRun.revision + 1);
  });

  it("run_crashed projects outcome=crashed (NOT outcome_unknown) and ends attempt/outbox", async () => {
    const h = makeHarness();
    await seedStartedRun(h, "run-crash", "att-crash");
    const runRef = runRefFor(PROJECT, GOAL, "run-crash");

    const e1 = await h.engine.runFact(factCmd("run-crash", 2, { kind: "runtime_event", event: runtimeEvent("run-crash", 1) }));
    expect(e1.status).toBe("committed");
    const e2 = await h.engine.runFact(factCmd("run-crash", 3, {
      kind: "runtime_event",
      event: runtimeEvent("run-crash", 2, { eventType: "run_crashed", payload: { kind: "crashed", error: "trap" } }),
    }));
    expect(e2.status).toBe("committed");
    if (e2.status !== "committed") return;
    expect(e2.terminal).toBe(true);

    const run = await snap<RunSnapshot>(h.ledger, runRef);
    expect(run.outcome).toBe("crashed"); // separate from outcome_unknown
    expect(run.exitCode).toBeNull();
    const attempt = await snap<TaskAttemptSnapshot>(h.ledger, taskAttemptRefFor(PROJECT, GOAL, TASK, "att-crash"));
    expect(attempt.endOutcome).toBe("crashed");
  });

  it("run_cancelled / run_budget_exhausted fold to their own outcomes (not completed)", async () => {
    const cases = [
      { runId: "run-cancelled", eventType: "run_cancelled" as const, payload: { kind: "cancelled" as const, reason: "operator stop" }, outcome: "cancelled" },
      { runId: "run-budget", eventType: "run_budget_exhausted" as const, payload: { kind: "budget_exhausted" as const, exhaustedAt: SCHEMA }, outcome: "budget_exhausted" },
    ];
    for (const c of cases) {
      const h = makeHarness();
      await seedStartedRun(h, c.runId, "att-" + c.runId);
      const r0 = await h.engine.runFact(factCmd(c.runId, 2, {
        kind: "runtime_event",
        event: runtimeEvent(c.runId, 1, { eventType: c.eventType, payload: c.payload as never }),
      }));
      expect(r0.status).toBe("committed");
      if (r0.status !== "committed") continue;
      expect(r0.terminal).toBe(true);
      const run = await snap<RunSnapshot>(h.ledger, runRefFor(PROJECT, GOAL, c.runId));
      expect(run.status).toBe("ended");
      expect(run.outcome).toBe(c.outcome);
      expect(run.exitCode).toBeNull();
    }
  });

  it("outcome_unknown is an EXPLICIT fact (never inferred): Run ended/outcome_unknown + attempt/outbox ended", async () => {
    const h = makeHarness();
    await seedStartedRun(h, "run-unknown", "att-unknown");
    const runRef = runRefFor(PROJECT, GOAL, "run-unknown");

    const r = await h.engine.runFact(factCmd("run-unknown", 2, { kind: "outcome_unknown", runRef: runRefFor(PROJECT, GOAL, "run-unknown"), reason: "disconnected" }));
    expect(r.status).toBe("committed");
    if (r.status !== "committed") return;
    expect(r.terminal).toBe(true);
    expect(r.applied).toEqual({ kind: "outcome_unknown" });

    const run = await snap<RunSnapshot>(h.ledger, runRef);
    expect(run.status).toBe("ended");
    expect(run.outcome).toBe("outcome_unknown");
    expect(run.endedAt).toBe(SCHEMA);
    expect(run.exitCode).toBeNull();
    const attempt = await snap<TaskAttemptSnapshot>(h.ledger, taskAttemptRefFor(PROJECT, GOAL, TASK, "att-unknown"));
    expect(attempt.status).toBe("ended");
    expect(attempt.endOutcome).toBe("outcome_unknown");
    const outbox = await snap<DispatchOutboxEntrySnapshot>(h.ledger, dispatchOutboxRefFor(PROJECT, GOAL, TASK, "att-unknown"));
    expect(outbox.status).toBe("done");
  });

  it("fold-equivalence: committed runtime_event snapshots match buildRunEventRecordedCommit", async () => {
    const h = makeHarness();
    await seedStartedRun(h, "run-fold", "att-fold");
    const runRef = runRefFor(PROJECT, GOAL, "run-fold");
    const loadedRun = await snap<RunSnapshot>(h.ledger, runRef);
    const loadedAttempt = await snap<TaskAttemptSnapshot>(h.ledger, taskAttemptRefFor(PROJECT, GOAL, TASK, "att-fold"));
    const loadedOutbox = await snap<DispatchOutboxEntrySnapshot>(h.ledger, dispatchOutboxRefFor(PROJECT, GOAL, TASK, "att-fold"));

    const terminalEvent = runtimeEvent("run-fold", 1, { eventType: "run_completed", payload: { kind: "completed", exitCode: 1 } });
    const command = factCmd("run-fold", 2, { kind: "runtime_event", event: terminalEvent });
    const receipt = await h.engine.runFact(command);
    expect(receipt.status).toBe("committed");
    if (receipt.status !== "committed") return;

    // The handler consumed exactly one eventId + one now (in that order).
    expect(h.eventIds.length).toBe(1);
    expect(h.nows.length).toBe(1);
    const expected = buildRunEventRecordedCommit(command, {
      eventId: h.eventIds[0]!,
      occurredAt: h.nows[0]!,
      workspaceId: WORKSPACE,
      currentRun: { ...loadedRun, revision: command.expectedRevision + 1 },
      currentAttempt: loadedAttempt,
      currentOutbox: loadedOutbox,
    });

    const committedRun = await snap<RunSnapshot>(h.ledger, runRef);
    expect(canonicalJson(committedRun)).toBe(canonicalJson(expected.snapshots[0]!));
    const committedAttempt = await snap<TaskAttemptSnapshot>(h.ledger, taskAttemptRefFor(PROJECT, GOAL, TASK, "att-fold"));
    expect(canonicalJson(committedAttempt)).toBe(canonicalJson(expected.snapshots[1]!));
    const committedOutbox = await snap<DispatchOutboxEntrySnapshot>(h.ledger, dispatchOutboxRefFor(PROJECT, GOAL, TASK, "att-fold"));
    expect(canonicalJson(committedOutbox)).toBe(canonicalJson(expected.snapshots[2]!));

    // event fields align with the expected commit event
    const recordedEvents = await h.ledger.events({ afterCursor: null, limit: 500 });
    const committedEvent = recordedEvents.events[recordedEvents.events.length - 1]!.event;
    expect(committedEvent.eventType).toBe("RunEventRecorded");
    expect(canonicalJson(committedEvent.payload)).toBe(canonicalJson(expected.events[0]!.payload));
    expect(committedEvent.aggregateRevision).toBe(expected.events[0]!.aggregateRevision);
  });

  it("fold-equivalence: committed outcome_unknown snapshots match buildRunOutcomeUnknownCommit", async () => {
    const h = makeHarness();
    await seedStartedRun(h, "run-fold-u", "att-fold-u");
    const runRef = runRefFor(PROJECT, GOAL, "run-fold-u");
    const loadedRun = await snap<RunSnapshot>(h.ledger, runRef);
    const loadedAttempt = await snap<TaskAttemptSnapshot>(h.ledger, taskAttemptRefFor(PROJECT, GOAL, TASK, "att-fold-u"));
    const loadedOutbox = await snap<DispatchOutboxEntrySnapshot>(h.ledger, dispatchOutboxRefFor(PROJECT, GOAL, TASK, "att-fold-u"));

    const command = factCmd("run-fold-u", 2, { kind: "outcome_unknown", runRef: runRefFor(PROJECT, GOAL, "run-fold-u"), reason: "lost" });
    const receipt = await h.engine.runFact(command);
    expect(receipt.status).toBe("committed");
    if (receipt.status !== "committed") return;

    const expected = buildRunOutcomeUnknownCommit(command, {
      eventId: h.eventIds[0]!,
      occurredAt: h.nows[0]!,
      workspaceId: WORKSPACE,
      currentRun: { ...loadedRun, revision: command.expectedRevision + 1 },
      currentAttempt: loadedAttempt,
      currentOutbox: loadedOutbox,
    });

    const committedRun = await snap<RunSnapshot>(h.ledger, runRef);
    expect(canonicalJson(committedRun)).toBe(canonicalJson(expected.snapshots[0]!));
    const committedAttempt = await snap<TaskAttemptSnapshot>(h.ledger, taskAttemptRefFor(PROJECT, GOAL, TASK, "att-fold-u"));
    expect(canonicalJson(committedAttempt)).toBe(canonicalJson(expected.snapshots[1]!));
    const committedOutbox = await snap<DispatchOutboxEntrySnapshot>(h.ledger, dispatchOutboxRefFor(PROJECT, GOAL, TASK, "att-fold-u"));
    expect(canonicalJson(committedOutbox)).toBe(canonicalJson(expected.snapshots[2]!));
  });

  it("invalid command (bad fact kind / runRef mismatch) is rejected zero-write", async () => {
    const h = makeHarness();
    await seedStartedRun(h, "run-inv", "att-inv");
    const before = await h.ledger.events({ afterCursor: null, limit: 500 });

    // runtime_event with a runRef pointing at a DIFFERENT run -> invalid
    const mismatched = buildRunFactCommand({
      commandId: "cmd-bad",
      correlationId: "corr-bad",
      submittedAt: SCHEMA,
      projectId: PROJECT,
      runId: "run-inv",
      expectedRevision: 2,
      fact: { kind: "runtime_event", event: runtimeEvent("run-OTHER", 1) },
    });
    const res = await h.engine.runFact(mismatched);
    expect(res.status).toBe("rejected");
    if (res.status === "rejected") expect(res.code).toBe("invalid");

    // malformed command (bad fact kind) -> invalid via validateRunFactCommand
    const malformed = buildRunFactCommand({
      commandId: "cmd-bad2",
      correlationId: "corr-bad2",
      submittedAt: SCHEMA,
      projectId: PROJECT,
      runId: "run-inv",
      expectedRevision: 2,
      fact: { kind: "runtime_event", event: runtimeEvent("run-inv", 1) } as never,
    });
    (malformed.payload as { fact: { kind: string } }).fact = { kind: "nonsense" } as never;
    const res2 = await h.engine.runFact(malformed as never);
    expect(res2.status).toBe("rejected");
    if (res2.status === "rejected") expect(res2.code).toBe("invalid");

    const after = await h.ledger.events({ afterCursor: null, limit: 500 });
    expect(after.events.length).toBe(before.events.length); // zero write
  });
});
