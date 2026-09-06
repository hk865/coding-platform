/**
 * P1-04 lane A unit tests: submitEvidence (evidence intake via ControlEngineImpl
 * over a real InMemoryLedger).
 *
 * Drive the ENGINE handler (not the fixture builder) and assert:
 *   - happy path: ONE immutable Evidence @1 + atomic TaskEvidenceIndex @1,
 *     batch fold-equivalent to buildEvidenceIntakeLedgerCommit (same ids);
 *   - complete idempotency: same identity+fingerprint -> committed(replayed);
 *     same identity, different fingerprint -> idempotency_conflict; a DIFFERENT
 *     identity on an existing evidenceId -> revision_conflict (all zero-write);
 *   - claim is forced INCONCLUSIVE and NEVER PASS (PASS claim -> invalid);
 *   - claim/verdict without a producing run -> invalid (zero write);
 *   - dangling coverage / subject not in the anchor plan -> dangling_ref;
 *   - per-task admission cap -> evidence_limit_exceeded (zero write);
 *   - missing goal -> not_found (zero write).
 */
import { describe, expect, it } from "vitest";
import { createControlEngine } from "../../src/control/control-engine.js";
import { InMemoryLedger } from "../../src/ledger/in-memory-ledger.js";
import type { StateLedger, LedgerCommit, LedgerCommitReceipt, GoalSnapshot } from "../../src/contracts/ledger.js";
import { createDeterministicDeps, FIXED_ISO_2026_09_05 } from "../../src/contracts/testing/sequences.js";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import { WORKSPACE_BOOTSTRAP_FIXTURE_V1, buildBootstrapLedgerCommit } from "../../src/contracts/fixtures/bootstrap-fixture-v1.js";
import { MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1, buildCreateGoalCommand, buildGoalCreateLedgerCommit } from "../../src/contracts/fixtures/goal-fixtures.js";
import { ARCHITECTURE_BASELINE_FIXTURE_V1, COMPLETION_POLICY_FIXTURE_V1, buildActivateCommand, buildActivateLedgerCommit, buildInstallCommand, buildInstallLedgerCommit, completionPolicyPinFor, architectureBaselinePinFor } from "../../src/contracts/fixtures/governance-fixtures.js";
import { buildApplyPlanCommand, buildPlanLedgerCommit } from "../../src/contracts/fixtures/plan-fixtures.js";
import { P104_GOAL, P104_OBL_IMPLEMENT, P104_PLAN_REVISION_FIXTURE_V1, P104_TASK_IMPLEMENT, buildEffectivityAnchorV1, buildEvidenceV1, buildSubmitEvidenceCommand, buildEvidenceIntakeLedgerCommit, coverage } from "../../src/contracts/fixtures/evidence-fixtures.js";
import type { PlanRevisionSnapshot } from "../../src/contracts/plan.js";
import type { EvidenceSnapshot, SubmitEvidenceCommand, TaskEvidenceIndexSnapshot, EvidenceV1 } from "../../src/contracts/evidence.js";
import { evidenceRefFor, taskEvidenceIndexRefFor, MAX_EVIDENCE_PER_TASK } from "../../src/contracts/evidence.js";
import { runRefFor } from "../../src/contracts/dispatch.js";
import { canonicalJson } from "../../src/contracts/fingerprint.js";

const FIXED = FIXED_ISO_2026_09_05;
const PROJECT = "proj-alpha";
const GOAL = P104_GOAL;
const TASK = P104_TASK_IMPLEMENT;
const WS = "ws-shared";

class RecordingLedger extends InMemoryLedger {
  commits: LedgerCommit[] = [];
  override async commit(batch: LedgerCommit): Promise<LedgerCommitReceipt> {
    this.commits.push(batch);
    return super.commit(batch);
  }
}

function makeHarness() {
  const ledger = new RecordingLedger();
  const d = createDeterministicDeps();
  const engine = createControlEngine({ ledger, now: d.clock, eventId: d.eventId });
  return { ledger, engine };
}

async function bootstrap(ledger: StateLedger): Promise<void> {
  const cmd = buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, {
    commandId: "cmd-bootstrap", correlationId: "corr-bootstrap", submittedAt: FIXED,
  });
  const receipt = await ledger.commit(
    buildBootstrapLedgerCommit(cmd, { eventIds: ["evt-bs-1", "evt-bs-2", "evt-bs-3", "evt-bs-4"], occurredAt: FIXED }),
  );
  expect(receipt.status).toBe("committed");
}

async function createGoal(ledger: StateLedger): Promise<void> {
  const scope = MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1.scopes.find((s) => s.projectId === PROJECT)!;
  const cmd = buildCreateGoalCommand(scope, { commandId: "cmd-goal", correlationId: "corr-goal", submittedAt: FIXED });
  const receipt = await ledger.commit(
    buildGoalCreateLedgerCommit(cmd, { eventId: "evt-goal", occurredAt: FIXED, projectRevision: 1, workspaceRevision: 1 }),
  );
  expect(receipt.status).toBe("committed");
}

async function installActivateAndPlan(ledger: StateLedger): Promise<void> {
  const cp = buildInstallCommand(COMPLETION_POLICY_FIXTURE_V1, {
    commandId: "cmd-install-cp", correlationId: "corr-install-cp", submittedAt: FIXED,
    projectId: PROJECT, idempotencyKey: "inst-cp",
  });
  const cpReceipt = await ledger.commit(buildInstallLedgerCommit(cp as never, { eventId: "evt-install-cp", occurredAt: FIXED }));
  expect(cpReceipt.status).toBe("committed");
  const ab = buildInstallCommand(ARCHITECTURE_BASELINE_FIXTURE_V1, {
    commandId: "cmd-install-ab", correlationId: "corr-install-ab", submittedAt: FIXED,
    projectId: PROJECT, idempotencyKey: "inst-ab",
  });
  const abReceipt = await ledger.commit(buildInstallLedgerCommit(ab as never, { eventId: "evt-install-ab", occurredAt: FIXED }));
  expect(abReceipt.status).toBe("committed");

  const actCp = await ledger.commit(buildActivateLedgerCommit(
    buildActivateCommand(completionPolicyPinFor(cp as never), {
      commandId: "cmd-act-cp", correlationId: "corr-act-cp", submittedAt: FIXED,
      projectId: PROJECT, expectedRevision: 1, idempotencyKey: "act-cp",
    }),
    { eventId: "evt-act-cp", occurredAt: FIXED, activeAggregateRevision: 1, projectRevision: 1 },
  ));
  expect(actCp.status).toBe("committed");
  const actAb = await ledger.commit(buildActivateLedgerCommit(
    buildActivateCommand(architectureBaselinePinFor(ab as never), {
      commandId: "cmd-act-ab", correlationId: "corr-act-ab", submittedAt: FIXED,
      projectId: PROJECT, expectedRevision: 1, idempotencyKey: "act-ab",
    }),
    { eventId: "evt-act-ab", occurredAt: FIXED, activeAggregateRevision: 1, projectRevision: 1 },
  ));
  expect(actAb.status).toBe("committed");

  const apply = buildApplyPlanCommand(P104_PLAN_REVISION_FIXTURE_V1, {
    commandId: "cmd-apply", correlationId: "corr-apply", submittedAt: FIXED,
    projectId: PROJECT, expectedRevision: 1, idempotencyKey: "apply",
  });
  const goal = await ledger.load({ aggregateType: "Goal", projectId: PROJECT, goalId: GOAL });
  expect(goal.status).toBe("found");
  const goalSnap = goal.status === "found" ? (goal.snapshot as GoalSnapshot) : null;
  const applyReceipt = await ledger.commit(buildPlanLedgerCommit(apply, {
    eventId: "evt-apply", occurredAt: FIXED, acceptedAt: FIXED,
    pins: { completionPolicy: completionPolicyPinFor(cp as never), architectureBaseline: architectureBaselinePinFor(ab as never) },
    baseGoal: goalSnap!,
  }));
  expect(applyReceipt.status).toBe("committed");
}

async function loadPlan(ledger: StateLedger): Promise<PlanRevisionSnapshot> {
  const planRef = { aggregateType: "PlanRevision" as const, projectId: PROJECT, planId: "plan-evidence-mvp" };
  const result = await ledger.load(planRef);
  expect(result.status).toBe("found");
  if (result.status !== "found") throw new Error("plan missing");
  return result.snapshot as PlanRevisionSnapshot;
}

async function setupAccepted() {
  const { ledger, engine } = makeHarness();
  await bootstrap(ledger);
  await createGoal(ledger);
  await installActivateAndPlan(ledger);
  const plan = await loadPlan(ledger);
  return { ledger, engine, plan };
}

function anchorForPlan(plan: PlanRevisionSnapshot, workspaceRevision = 1) {
  return buildEffectivityAnchorV1({
    planRef: plan.ref,
    planRevision: plan.planRevision,
    workspaceRevision,
    pinnedCompletionPolicy: plan.effectiveCompletionPolicy,
    pinnedArchitectureBaseline: plan.effectiveArchitectureBaseline,
  });
}

function makeEvidence(plan: PlanRevisionSnapshot, deps: {
  evidenceId: string; kind: "claim" | "observation" | "verdict"; outcome: "PASS" | "FAIL" | "INCONCLUSIVE";
  coverage?: { obligationId: string; requirementId: string }[]; runRef?: { aggregateType: "Run"; projectId: string; goalId: string; runId: string } | null;
  checkId?: string | null; actor?: { kind: "human" | "system"; id: string }; workspaceRevision?: number;
}): EvidenceV1 {
  return buildEvidenceV1({
    evidenceId: deps.evidenceId,
    kind: deps.kind,
    outcome: deps.outcome,
    projectId: PROJECT,
    goalId: GOAL,
    taskId: TASK,
    coverage: deps.coverage ?? [coverage(P104_OBL_IMPLEMENT, "vr-impl-static")],
    anchor: anchorForPlan(plan, deps.workspaceRevision ?? 1),
    verificationPlanRef: { planId: "vp-evidence-mvp-1", planDigest: "e".repeat(64) },
    ...(deps.runRef !== undefined ? { runRef: deps.runRef } : {}),
    ...(deps.checkId !== undefined ? { checkId: deps.checkId } : {}),
    ...(deps.actor !== undefined ? { actor: deps.actor } : {}),
  });
}

function makeCommand(deps: { commandId: string; evidence: EvidenceV1; idempotencyKey?: string; correlationId?: string }): SubmitEvidenceCommand {
  return buildSubmitEvidenceCommand({
    commandId: deps.commandId,
    correlationId: deps.correlationId ?? "corr-" + deps.commandId,
    submittedAt: FIXED,
    evidence: deps.evidence,
    ...(deps.idempotencyKey !== undefined ? { idempotencyKey: deps.idempotencyKey } : {}),
  });
}

async function eventCount(ledger: StateLedger): Promise<number> {
  const page = await ledger.events({ afterCursor: null, limit: 1000 });
  return page.events.length;
}

describe("submitEvidence: happy path (atomic admission + fold-equality)", () => {
  it("commits ONE immutable Evidence@1 + index@1; batch folds EXACTLY the fixture builder", async () => {
    const { ledger, engine, plan } = await setupAccepted();
    const evidence = makeEvidence(plan, { evidenceId: "ev-1", kind: "observation", outcome: "PASS", checkId: "static-check-lint" });
    const cmd = makeCommand({ commandId: "cmd-ev-1", evidence, idempotencyKey: "key-ev-1" });
    const before = await eventCount(ledger);

    const committed = await engine.submitEvidence(cmd);
    expect(committed.status).toBe("committed");
    if (committed.status !== "committed") return;
    expect(committed.replayed).toBe(false);
    expect(committed.evidenceRef).toEqual(evidenceRefFor(PROJECT, "ev-1"));
    expect(committed.evidenceIndex).toBe(1);
    expect(committed.evidenceCount).toBe(1);

    // Fold-equality with the shared fixture builder (same ids).
    const submitted = ledger.commits[ledger.commits.length - 1]!;
    const expected = buildEvidenceIntakeLedgerCommit(cmd, { eventId: "evt-0001", occurredAt: FIXED, workspaceId: WS, priorIndex: null });
    expect(submitted).toEqual(expected);

    // ONE immutable Evidence aggregate + index @1.
    const evLoad = await ledger.load(evidenceRefFor(PROJECT, "ev-1"));
    expect(evLoad.status).toBe("found");
    if (evLoad.status === "found") {
      const snap = evLoad.snapshot as EvidenceSnapshot;
      expect(snap.revision).toBe(1);
      expect(snap.evidence.evidenceId).toBe("ev-1");
      expect(snap.evidence.anchor.planRef.planId).toBe("plan-evidence-mvp");
    }
    const idxLoad = await ledger.load(taskEvidenceIndexRefFor(PROJECT, GOAL, TASK));
    expect(idxLoad.status).toBe("found");
    if (idxLoad.status === "found") {
      const idx = idxLoad.snapshot as TaskEvidenceIndexSnapshot;
      expect(idx.revision).toBe(1);
      expect(idx.evidenceIds).toEqual(["ev-1"]);
    }

    const after = await eventCount(ledger);
    expect(after).toBe(before + 1);
    expect((await ledger.events({ afterCursor: null, limit: 1000 })).events.filter((p) => p.event.eventType === "EvidenceAdmitted")).toHaveLength(1);
  });

  it("admission order is append-only: second evidence -> index@2, event index=2", async () => {
    const { ledger, engine, plan } = await setupAccepted();
    const e1 = makeEvidence(plan, { evidenceId: "ev-a", kind: "observation", outcome: "PASS", checkId: "static-check-lint" });
    const e2 = makeEvidence(plan, { evidenceId: "ev-b", kind: "observation", outcome: "PASS", checkId: "dynamic-check-tests", coverage: [coverage(P104_OBL_IMPLEMENT, "vr-impl-dynamic")] });
    expect((await engine.submitEvidence(makeCommand({ commandId: "cmd-a", evidence: e1 }))).status).toBe("committed");
    const second = await engine.submitEvidence(makeCommand({ commandId: "cmd-b", evidence: e2, idempotencyKey: "key-b" }));
    expect(second.status).toBe("committed");
    if (second.status !== "committed") return;
    expect(second.evidenceIndex).toBe(2);
    expect(second.evidenceCount).toBe(2);
    const idxLoad = await ledger.load(taskEvidenceIndexRefFor(PROJECT, GOAL, TASK));
    expect(idxLoad.status).toBe("found");
    if (idxLoad.status === "found") {
      const idx = idxLoad.snapshot as TaskEvidenceIndexSnapshot;
      expect(idx.revision).toBe(2);
      expect(idx.evidenceIds).toEqual(["ev-a", "ev-b"]);
    }
  });
});

describe("submitEvidence: idempotency + conflicts (zero-write)", () => {
  it("same identity+fingerprint replays committed(replayed); same identity diff fingerprint -> idempotency_conflict; diff identity same evidenceId -> revision_conflict", async () => {
    const { ledger, engine, plan } = await setupAccepted();
    const evidence = makeEvidence(plan, { evidenceId: "ev-claim-1", kind: "claim", outcome: "INCONCLUSIVE", runRef: runRefFor(PROJECT, GOAL, "run-a") });
    const cmd = makeCommand({ commandId: "cmd-claim-1", evidence, idempotencyKey: "p104-ev-claim-1" });
    const before = await eventCount(ledger);

    const first = await engine.submitEvidence(cmd);
    expect(first.status).toBe("committed");
    if (first.status !== "committed") return;

    // Replay: same identity+fingerprint -> committed(replayed), same eventIds.
    const replay = await engine.submitEvidence(makeCommand({ commandId: "cmd-claim-1b", evidence, idempotencyKey: "p104-ev-claim-1" }));
    expect(replay.status).toBe("committed");
    if (replay.status === "committed") {
      expect(replay.replayed).toBe(true);
      expect(replay.eventIds).toEqual(first.eventIds);
      expect(replay.commitCursor).toEqual(first.commitCursor);
    }
    expect(await eventCount(ledger)).toBe(before + 1);

    // Same identity, DIFFERENT fingerprint (different coverage) -> idempotency_conflict.
    const altered = makeEvidence(plan, { evidenceId: "ev-claim-1", kind: "claim", outcome: "INCONCLUSIVE", runRef: runRefFor(PROJECT, GOAL, "run-a"), coverage: [coverage(P104_OBL_IMPLEMENT, "vr-impl-dynamic")] });
    const conflict = await engine.submitEvidence(makeCommand({ commandId: "cmd-claim-1c", evidence: altered, idempotencyKey: "p104-ev-claim-1" }));
    expect(conflict.status).toBe("rejected");
    if (conflict.status === "rejected") expect(conflict.code).toBe("idempotency_conflict");
    expect(await eventCount(ledger)).toBe(before + 1);

    // Different identity on the SAME evidenceId -> revision_conflict (zero-write).
    const other = await engine.submitEvidence(makeCommand({ commandId: "cmd-claim-1d", evidence, idempotencyKey: "other-key" }));
    expect(other.status).toBe("rejected");
    if (other.status === "rejected") expect(other.code).toBe("revision_conflict");
    expect(await eventCount(ledger)).toBe(before + 1);
  });
});

describe("submitEvidence: claim is never PASS + provenance guards", () => {
  it("a PASS claim is rejected invalid; a claim without a producing run is rejected invalid; zero write", async () => {
    const { ledger, engine, plan } = await setupAccepted();
    const before = await eventCount(ledger);

    const passClaim = makeEvidence(plan, { evidenceId: "ev-claim-pass", kind: "claim", outcome: "PASS", runRef: runRefFor(PROJECT, GOAL, "run-a") });
    const r1 = await engine.submitEvidence(makeCommand({ commandId: "cmd-pass", evidence: passClaim }));
    expect(r1.status).toBe("rejected");
    if (r1.status === "rejected") expect(r1.code).toBe("invalid");

    const noRunClaim = makeEvidence(plan, { evidenceId: "ev-claim-norun", kind: "claim", outcome: "INCONCLUSIVE", runRef: null });
    const r2 = await engine.submitEvidence(makeCommand({ commandId: "cmd-norun", evidence: noRunClaim }));
    expect(r2.status).toBe("rejected");
    if (r2.status === "rejected") expect(r2.code).toBe("invalid");

    const noRunVerdict = makeEvidence(plan, { evidenceId: "ev-verdict-norun", kind: "verdict", outcome: "PASS", runRef: null, checkId: "reviewer-semantic-check" });
    const r3 = await engine.submitEvidence(makeCommand({ commandId: "cmd-verdict-norun", evidence: noRunVerdict }));
    expect(r3.status).toBe("rejected");
    if (r3.status === "rejected") expect(r3.code).toBe("invalid");

    expect(await eventCount(ledger)).toBe(before);
    expect((await ledger.events({ afterCursor: null, limit: 1000 })).events.filter((p) => p.event.eventType === "EvidenceAdmitted")).toHaveLength(0);
  });
});

describe("submitEvidence: dangling subject/coverage -> dangling_ref (zero write)", () => {
  it("subject task not in the anchor plan -> dangling_ref", async () => {
    const { ledger, engine, plan } = await setupAccepted();
    const before = await eventCount(ledger);
    const evidence = makeEvidence(plan, { evidenceId: "ev-noplan", kind: "observation", outcome: "PASS", checkId: "static-check-lint" });
    // Rewrite the subject task to a task not in the plan.
    const bad: EvidenceV1 = { ...evidence, subject: { ...evidence.subject, taskId: "task-absent" } };
    const r = await engine.submitEvidence(makeCommand({ commandId: "cmd-noplan", evidence: bad }));
    expect(r.status).toBe("rejected");
    if (r.status === "rejected") expect(r.code).toBe("dangling_ref");
    expect(await eventCount(ledger)).toBe(before);
  });

  it("coverage referencing an obligation/VR not mapped to the subject task -> dangling_ref", async () => {
    const { ledger, engine, plan } = await setupAccepted();
    const before = await eventCount(ledger);
    const evidence = makeEvidence(plan, {
      evidenceId: "ev-dangling", kind: "observation", outcome: "PASS", checkId: "static-check-lint",
      coverage: [{ obligationId: "obl-does-not-exist", requirementId: "vr-x" }],
    });
    const r = await engine.submitEvidence(makeCommand({ commandId: "cmd-dangling", evidence }));
    expect(r.status).toBe("rejected");
    if (r.status === "rejected") expect(r.code).toBe("dangling_ref");
    expect(await eventCount(ledger)).toBe(before);
  });

  it("anchor plan missing -> dangling_ref", async () => {
    const { ledger, engine, plan } = await setupAccepted();
    const before = await eventCount(ledger);
    const evidence = makeEvidence(plan, { evidenceId: "ev-anchor-missing", kind: "observation", outcome: "PASS", checkId: "static-check-lint" });
    const bad: EvidenceV1 = { ...evidence, anchor: { ...evidence.anchor, planRef: { aggregateType: "PlanRevision" as const, projectId: PROJECT, planId: "plan-does-not-exist" } } };
    const r = await engine.submitEvidence(makeCommand({ commandId: "cmd-anchor-missing", evidence: bad }));
    expect(r.status).toBe("rejected");
    if (r.status === "rejected") expect(r.code).toBe("dangling_ref");
    expect(await eventCount(ledger)).toBe(before);
  });
});

describe("submitEvidence: admission cap + missing goal", () => {
  it("evidence_limit_exceeded at MAX_EVIDENCE_PER_TASK with zero write", async () => {
    const { ledger, engine, plan } = await setupAccepted();
    // Fill the admission index to the cap through the REAL path (each admission
    // starts a fresh evidence aggregate, index advances 1 per commit).
    for (let i = 0; i < MAX_EVIDENCE_PER_TASK; i++) {
      const evidence = makeEvidence(plan, { evidenceId: "ev-limit-" + i, kind: "observation", outcome: "PASS", checkId: "static-check-lint" });
      const r = await engine.submitEvidence(makeCommand({ commandId: "cmd-limit-" + i, evidence, idempotencyKey: "k-limit-" + i }));
      expect(r.status).toBe("committed");
      if (r.status !== "committed") return;
    }
    const idxLoad = await ledger.load(taskEvidenceIndexRefFor(PROJECT, GOAL, TASK));
    expect(idxLoad.status).toBe("found");
    if (idxLoad.status === "found") {
      const idx = idxLoad.snapshot as TaskEvidenceIndexSnapshot;
      expect(idx.revision).toBe(MAX_EVIDENCE_PER_TASK);
      expect(idx.evidenceIds).toHaveLength(MAX_EVIDENCE_PER_TASK);
    }

    // One more admission over the cap -> evidence_limit_exceeded, ZERO write.
    const before = await eventCount(ledger);
    const over = makeEvidence(plan, { evidenceId: "ev-over", kind: "observation", outcome: "PASS", checkId: "static-check-lint" });
    const r = await engine.submitEvidence(makeCommand({ commandId: "cmd-over", evidence: over }));
    expect(r.status).toBe("rejected");
    if (r.status === "rejected") expect(r.code).toBe("evidence_limit_exceeded");
    expect(await eventCount(ledger)).toBe(before);
  });

  it("missing goal -> not_found, zero write", async () => {
    const { ledger, engine, plan } = await setupAccepted();
    const before = await eventCount(ledger);
    const evidence = makeEvidence(plan, { evidenceId: "ev-nogoal", kind: "observation", outcome: "PASS", checkId: "static-check-lint" });
    const bad: EvidenceV1 = { ...evidence, subject: { ...evidence.subject, goalId: "goal-absent" } };
    const r = await engine.submitEvidence(makeCommand({ commandId: "cmd-nogoal", evidence: bad }));
    expect(r.status).toBe("rejected");
    if (r.status === "rejected") expect(r.code).toBe("not_found");
    expect(await eventCount(ledger)).toBe(before);
  });
});