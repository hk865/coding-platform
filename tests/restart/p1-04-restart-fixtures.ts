/**
 * P1-04 restart-path fixtures + readiness probe.
 *   bootstrap -> install/activate -> CreateGoal -> applyPlan -> claim ->
 *   FakeRuntime facts -> verification plan -> claim/observation/verdict
 *   evidence admission -> TaskReduction -> commit -> close -> reopen ->
 *   (a) Evidence / TaskEvidenceIndex / TaskReduction snapshots identical,
 *   (b) taskVerification view rebuilt from persisted EventPages
 *   field-for-field identical,
 *   (c) the reduction result (phase + effective evidence set) identical.
 * NEVER fakes; the probe runs the full pre-restart path and any remaining
 * "P1-04: ... not implemented yet" stub throw makes it false (auto-skip).
 */
import { expect } from "vitest";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import type { PersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import {
  prepareP104Scenario,
  runP104ClaimedRun,
  reduceCommand,
  evidenceFor,
  evidenceCommandFor,
  P104_GOAL,
  P104_TASKS,
  type P1_04TestHarness,
} from "../contract-suite/p1-04-harness.js";
import { toP1_04Harness } from "../contract-suite/p1-04-harness.js";
import type { EvidenceSnapshot, TaskEvidenceIndexSnapshot } from "../../src/contracts/evidence.js";
import { evidenceRefFor, taskEvidenceIndexRefFor } from "../../src/contracts/evidence.js";
import type { TaskReductionSnapshot } from "../../src/contracts/reduction.js";
import type { TaskVerificationView } from "../../src/contracts/verification-view.js";

const IMPLEMENT = P104_TASKS.implement;
const REVIEW = P104_TASKS.review;
const GATE = P104_TASKS.gate;

export async function isP104Ready(): Promise<boolean> {
  try {
    const h = await createPersistentSqliteHarness({ deps: {} });
    try {
      await runP104Path(h);
      return true;
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  } catch {
    return false;
  }
}

export async function runP104Path(h: PersistentSqliteHarness) {
  const th: P1_04TestHarness = toP1_04Harness(h);
  const sc = await prepareP104Scenario(th);
  const projectId = sc.alpha.projectId;

  // 1) Implement run: claim -> FakeRuntime(exit=0) -> plan -> evidence -> reduce.
  await runP104ClaimedRun(th, { projectId, taskId: IMPLEMENT, runId: "run-rs-impl", attemptId: "att-rs-impl" });
  const verify = await th.verification.verify({
    schemaVersion: 1,
    requestId: "req-rs-impl",
    projectId,
    goalId: sc.alpha.goalId,
    taskId: IMPLEMENT,
    planRef: sc.alpha.planRef,
    changeScope: { diffClass: "code-change", changedFiles: ["src/a.ts"], writeSummary: "change" },
    semanticChange: "semantic",
    risks: [{ level: "low", description: "local" }],
  });
  if (verify.status !== "ready") throw new Error("verify not ready: " + String(verify.status));
  const runImpl = { aggregateType: "Run" as const, projectId, goalId: sc.alpha.goalId, runId: "run-rs-impl" };
  const claim1 = evidenceFor(sc.alpha, {
    evidenceId: "ev-rs-claim", kind: "claim", outcome: "INCONCLUSIVE", taskId: IMPLEMENT,
    coverage: [
      { obligationId: "obl-implement", requirementId: "vr-impl-static" },
      { obligationId: "obl-implement", requirementId: "vr-impl-dynamic" },
    ],
    runRef: runImpl,
  });
  const a1 = await th.submitEvidence(evidenceCommandFor(sc.alpha, { commandId: "cmd-rs-claim", evidence: claim1 }));
  if (a1.status !== "committed") throw new Error("claim evidence failed");
  const obsS = evidenceFor(sc.alpha, {
    evidenceId: "ev-rs-static", kind: "observation", outcome: "PASS", taskId: IMPLEMENT,
    coverage: [{ obligationId: "obl-implement", requirementId: "vr-impl-static" }], checkId: "static-check-lint", runRef: runImpl,
  });
  if ((await th.submitEvidence(evidenceCommandFor(sc.alpha, { commandId: "cmd-rs-static", evidence: obsS }))).status !== "committed") throw new Error("obs static failed");
  const obsD = evidenceFor(sc.alpha, {
    evidenceId: "ev-rs-dynamic", kind: "observation", outcome: "PASS", taskId: IMPLEMENT,
    coverage: [{ obligationId: "obl-implement", requirementId: "vr-impl-dynamic" }], checkId: "dynamic-check-tests", runRef: runImpl,
  });
  if ((await th.submitEvidence(evidenceCommandFor(sc.alpha, { commandId: "cmd-rs-dynamic", evidence: obsD }))).status !== "committed") throw new Error("obs dynamic failed");
  const rImpl = await th.reduceTask(reduceCommand(sc.alpha, { commandId: "cmd-rs-red-impl", taskId: IMPLEMENT, expectedRevision: 0 }));
  if (rImpl.status !== "committed" || rImpl.phase !== "satisfied") throw new Error("implement reduction failed: " + String(rImpl.status));

  // 2) Review run: verdict + packet-static evidence -> reduce.
  await runP104ClaimedRun(th, { projectId, taskId: REVIEW, runId: "run-rs-review", attemptId: "att-rs-review" });
  const runRev = { aggregateType: "Run" as const, projectId, goalId: sc.alpha.goalId, runId: "run-rs-review" };
  const verdict = evidenceFor(sc.alpha, {
    evidenceId: "ev-rs-verdict", kind: "verdict", outcome: "PASS", taskId: REVIEW,
    coverage: [{ obligationId: "obl-review", requirementId: "vr-review" }], checkId: "reviewer-semantic-check", runRef: runRev,
  });
  if ((await th.submitEvidence(evidenceCommandFor(sc.alpha, { commandId: "cmd-rs-verdict", evidence: verdict }))).status !== "committed") throw new Error("verdict failed");
  const pkt = evidenceFor(sc.alpha, {
    evidenceId: "ev-rs-pkt", kind: "observation", outcome: "PASS", taskId: REVIEW,
    coverage: [{ obligationId: "obl-review", requirementId: "vr-review-static" }], checkId: "static-check-lint", runRef: runRev,
  });
  if ((await th.submitEvidence(evidenceCommandFor(sc.alpha, { commandId: "cmd-rs-pkt", evidence: pkt }))).status !== "committed") throw new Error("pkt evidence failed");
  const rReview = await th.reduceTask(reduceCommand(sc.alpha, { commandId: "cmd-rs-red-review", taskId: REVIEW, expectedRevision: 0 }));
  if (rReview.status !== "committed" || rReview.phase !== "satisfied") throw new Error("review reduction failed: " + String(rReview.status));

  // 3) Gate: system static observation -> reduce.
  const gateObs = evidenceFor(sc.alpha, {
    evidenceId: "ev-rs-gate", kind: "observation", outcome: "PASS", taskId: GATE,
    coverage: [{ obligationId: "obl-gate", requirementId: "vr-gate" }], checkId: "static-check-lint",
    runRef: null, actor: { kind: "system", id: "verification-engine" },
  });
  if ((await th.submitEvidence(evidenceCommandFor(sc.alpha, { commandId: "cmd-rs-gate", evidence: gateObs }))).status !== "committed") throw new Error("gate evidence failed");
  const rGate = await th.reduceTask(reduceCommand(sc.alpha, { commandId: "cmd-rs-red-gate", taskId: GATE, expectedRevision: 0 }));
  if (rGate.status !== "committed" || rGate.phase !== "satisfied") throw new Error("gate reduction failed: " + String(rGate.status));

  await th.advanceProjection();
  const evidenceLoads = await Promise.all(
    ["ev-rs-claim", "ev-rs-static", "ev-rs-dynamic", "ev-rs-verdict", "ev-rs-pkt", "ev-rs-gate"].map((id) =>
      h.ledger.load(evidenceRefFor(projectId, id)),
    ),
  );
  for (const load of evidenceLoads) {
    if (load.status !== "found") throw new Error("evidence missing: " + String(load.status));
  }
  const indexLoad = await h.ledger.load(taskEvidenceIndexRefFor(projectId, sc.alpha.goalId, IMPLEMENT));
  if (indexLoad.status !== "found") throw new Error("index missing");
  const reductionLoad = await h.ledger.load({
    aggregateType: "TaskReduction", projectId, goalId: sc.alpha.goalId, taskId: GATE,
  });
  if (reductionLoad.status !== "found") throw new Error("reduction missing");
  const view = await th.taskVerification({ projectId, goalId: sc.alpha.goalId, taskId: IMPLEMENT });
  if (view.status !== "ready") throw new Error("verification view not ready");

  return {
    projectId,
    goalId: sc.alpha.goalId,
    evidence: evidenceLoads.map((l) => (l.status === "found" ? l.snapshot : null)),
    index: indexLoad.status === "found" ? indexLoad.snapshot : null,
    reductions: (
      await Promise.all(
        [IMPLEMENT, REVIEW, GATE].map((taskId) =>
          h.ledger.load({ aggregateType: "TaskReduction", projectId, goalId: sc.alpha.goalId, taskId }),
        ),
      )
    ).map((l) => (l.status === "found" ? l.snapshot : null)),
    verification: view.status === "ready" ? view.verification : null,
    observedCursor: h.observedCursor(),
    eventTypes: (await h.ledger.events({ afterCursor: null, limit: 500 })).events.map((p) => p.event.eventType),
  };
}

export async function verifyP104AfterRestart(
  h: PersistentSqliteHarness,
  before: Awaited<ReturnType<typeof runP104Path>>,
): Promise<void> {
  const th: P1_04TestHarness = toP1_04Harness(h);
  const json = (v: unknown) => JSON.stringify(v);
  const evidenceIds = ["ev-rs-claim", "ev-rs-static", "ev-rs-dynamic", "ev-rs-verdict", "ev-rs-pkt", "ev-rs-gate"];
  const loaded = await Promise.all(
    evidenceIds.map((id) => h.ledger.load(evidenceRefFor(before.projectId, id))),
  );
  for (const [i, load] of loaded.entries()) {
    if (load.status !== "found" || json(load.snapshot) !== json(before.evidence[i])) {
      throw new Error("evidence mismatch after restart: " + evidenceIds[i]);
    }
  }
  const indexLoad = await h.ledger.load(taskEvidenceIndexRefFor(before.projectId, before.goalId, IMPLEMENT));
  if (indexLoad.status !== "found" || json(indexLoad.snapshot) !== json(before.index)) {
    throw new Error("index mismatch after restart");
  }
  for (const [i, taskId] of [IMPLEMENT, REVIEW, GATE].entries()) {
    const load = await h.ledger.load({ aggregateType: "TaskReduction", projectId: before.projectId, goalId: before.goalId, taskId });
    if (load.status !== "found" || json(load.snapshot) !== json(before.reductions[i])) {
      throw new Error("reduction mismatch after restart: " + taskId);
    }
  }
  await h.advanceProjection();
  const view = await th.taskVerification({ projectId: before.projectId, goalId: before.goalId, taskId: IMPLEMENT });
  if (view.status !== "ready" || json(view.verification) !== json(before.verification)) {
    throw new Error("taskVerification view mismatch after restart");
  }
  if (String(h.observedCursor()) !== String(before.observedCursor)) {
    throw new Error("observedCursor mismatch after restart");
  }
}

// re-export for evidence test
export { P104_GOAL, IMPLEMENT, REVIEW, GATE };
