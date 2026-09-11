import { ControlPolicyExplanation } from '../../src/control/control-engine/policy-explanation.js';
/**
 * P1-04 lane D — SQLite read-model taskVerification projection tests.
 *
 * Field-for-field mirror of the InMemory suite (tests/read-model/
 * p1-04-verification-projection.test.ts) against the SqliteReadModelIndex.
 * Rebuild equivalence is exercised by feeding the SAME events to a FRESH
 * SQLite instance (a new ":memory:" database — replaying the same EventPages
 * reproduces the same views).
 */
import { describe, expect, it } from "vitest";
import {
  SqliteReadModelIndex,
  createSqliteReadModelIndex,
} from "../../src/data/read-model-index/sqlite-read-model-index.js";
import { ProjectionStallError } from "../../src/contracts/goal-view.js";
import type { EventPage } from "../../src/contracts/ledger.js";
import { makeCommitCursor } from "../../src/contracts/ledger.js";
import type { DomainEvent } from "../../src/contracts/events.js";
import type {
  EvidenceAdmittedEvent,
  EvidenceCoverageV1,
  EvidenceV1,
} from "../../src/contracts/evidence.js";
import { buildEffectivityAnchorV1, buildEvidenceV1, P104_GOAL, P104_OBL_IMPLEMENT, P104_OBL_REVIEW, P104_PLAN_ID, P104_PLAN_REVISION_FIXTURE_V1, P104_TASK_IMPLEMENT, P104_TASK_REVIEW } from "../contract-support/fixtures/evidence-fixtures.js";
import { buildTaskReductionSnapshot } from "../../src/control/control-engine/records/evidence.js";
import { buildApplyPlanCommand } from "../../src/fixtures/plan-fixtures.js";
import { planRevisionAcceptedEventFor, planRevisionSnapshotFor } from "../../src/control/control-engine/records/plan.js";
import type { PlanRevisionAcceptedEvent, PlanRevisionRef, PlanRevisionSnapshot } from "../../src/contracts/plan.js";
import type { TaskReductionSnapshot, TaskReductionUpdatedEvent } from "../../src/contracts/reduction.js";
import type {
  ArchitectureBaselinePin,
  CompletionPolicyPin,
} from "../../src/contracts/governance.js";
import type { TaskVerificationView } from "../../src/contracts/verification-view.js";

const T0 = "2026-09-05T12:00:00.000Z";
const WS = "ws-shared";
const PROJECT_A = "proj-alpha";
const PROJECT_B = "proj-beta";
const GOAL = P104_GOAL;

function pins(projectId: string): { cp: CompletionPolicyPin; ab: ArchitectureBaselinePin } {
  return {
    cp: {
      ref: { aggregateType: "CompletionPolicyRevision", projectId, policyId: "policy-completion", revision: 1 },
      digest: "a".repeat(64),
    },
    ab: {
      ref: { aggregateType: "ArchitectureBaselineRevision", projectId, baselineId: "arch-baseline", revision: 1 },
      digest: "b".repeat(64),
    },
  };
}

function planRef(projectId: string): PlanRevisionRef {
  return { aggregateType: "PlanRevision", projectId, planId: P104_PLAN_ID };
}

function anchor(projectId: string, workspaceRevision = 1) {
  const p = pins(projectId);
  return buildEffectivityAnchorV1({
    planRef: planRef(projectId),
    planRevision: 1,
    workspaceRevision,
    pinnedCompletionPolicy: p.cp,
    pinnedArchitectureBaseline: p.ab,
  });
}

function planEvent(projectId: string): { event: PlanRevisionAcceptedEvent; snapshot: PlanRevisionSnapshot } {
  const command = buildApplyPlanCommand(P104_PLAN_REVISION_FIXTURE_V1, {
    commandId: "cmd-plan-" + projectId,
    correlationId: "corr-plan-" + projectId,
    submittedAt: T0,
    projectId,
    expectedRevision: 1,
  });
  const p = pins(projectId);
  const snapshot = planRevisionSnapshotFor(command, { completionPolicy: p.cp, architectureBaseline: p.ab }, T0);
  const event = planRevisionAcceptedEventFor(command, {
    eventId: "ev-plan-" + projectId,
    occurredAt: T0,
    workspaceId: WS,
    goalAggregateRevision: 2,
    planSnapshot: snapshot,
  });
  return { event, snapshot };
}

function evidenceEvent(deps: {
  projectId: string;
  taskId: string;
  evidenceId: string;
  kind: "claim" | "observation" | "verdict";
  outcome: "PASS" | "FAIL" | "INCONCLUSIVE";
  coverage: EvidenceCoverageV1[];
  workspaceRevision?: number;
  checkId?: string | null;
  evidenceIndex?: number;
}): EvidenceAdmittedEvent {
  const evidence: EvidenceV1 = buildEvidenceV1({
    evidenceId: deps.evidenceId,
    kind: deps.kind,
    outcome: deps.outcome,
    projectId: deps.projectId,
    goalId: GOAL,
    taskId: deps.taskId,
    coverage: deps.coverage,
    anchor: anchor(deps.projectId, deps.workspaceRevision ?? 1),
    verificationPlanRef: { planId: "vp-evidence-mvp", planDigest: "e".repeat(64) },
    ...(deps.checkId !== undefined ? { checkId: deps.checkId } : {}),
  });
  return {
    eventId: "evad-" + deps.projectId + "-" + deps.evidenceId,
    eventType: "EvidenceAdmitted",
    schemaVersion: 1,
    projectId: deps.projectId,
    workspaceId: WS,
    aggregateType: "Evidence",
    aggregateId: deps.evidenceId,
    aggregateRevision: 1,
    causationId: "cmd-sector-" + deps.evidenceId,
    correlationId: "corr-sector-" + deps.evidenceId,
    idempotencyKey: "idem-" + deps.evidenceId,
    actor: { kind: "human", id: "user-1" },
    occurredAt: T0,
    payload: {
      goalId: GOAL,
      taskId: deps.taskId,
      evidence,
      admittedAt: T0,
      evidenceIndex: deps.evidenceIndex ?? 0,
      evidenceCount: deps.evidenceIndex ?? 0,
    },
  };
}

function reductionEvent(deps: {
  projectId: string;
  taskId: string;
  phase: TaskReductionSnapshot["phase"];
  effectiveEvidenceIds: string[];
  blockingEvidenceIds: string[];
  staleEvidenceIds?: string[];
  outOfScopeEvidenceIds?: string[];
  workspaceRevision?: number;
}): { event: TaskReductionUpdatedEvent; snapshot: TaskReductionSnapshot } {
  const snapshot = buildTaskReductionSnapshot({
    projectId: deps.projectId,
    goalId: GOAL,
    taskId: deps.taskId,
    revision: 1,
    planRef: planRef(deps.projectId),
    planRevision: 1,
    taskKind: "work",
    requirementLevel: "required",
    disposition: "active",
    phase: deps.phase,
    currentAnchor: anchor(deps.projectId, deps.workspaceRevision ?? 1),
    effectiveEvidenceIds: deps.effectiveEvidenceIds,
    blockingEvidenceIds: deps.blockingEvidenceIds,
    staleEvidenceIds: deps.staleEvidenceIds ?? [],
    outOfScopeEvidenceIds: deps.outOfScopeEvidenceIds ?? [],
    satisfiedObligationIds: [P104_OBL_IMPLEMENT],
    causes: [{ code: "missing_evidence", message: "test" }],
    reducedAt: T0,
  });
  const event: TaskReductionUpdatedEvent = {
    eventId: "tru-" + deps.projectId + "-" + deps.taskId,
    eventType: "TaskReductionUpdated",
    schemaVersion: 1,
    projectId: deps.projectId,
    workspaceId: WS,
    aggregateType: "TaskReduction",
    aggregateId: deps.taskId,
    aggregateRevision: 1,
    causationId: "cmd-red-" + deps.taskId,
    correlationId: "corr-red-" + deps.taskId,
    idempotencyKey: "idem-red-" + deps.taskId,
    actor: { kind: "system", id: "control-engine" },
    occurredAt: T0,
    payload: { goalId: GOAL, taskId: deps.taskId, reduction: snapshot },
  };
  return { event, snapshot };
}

function page(startSeq: number, events: DomainEvent[]): EventPage {
  const positioned = events.map((event, i) => ({ cursor: makeCommitCursor(startSeq + i), event }));
  const throughCursor = positioned.length ? makeCommitCursor(startSeq + positioned.length - 1) : null;
  return { afterCursor: null, throughCursor, events: positioned, hasMore: false };
}

async function feed(rm: SqliteReadModelIndex, startSeq: number, events: DomainEvent[]): Promise<void> {
  await rm.advance(page(startSeq, events));
}

function covImplementStatic(): EvidenceCoverageV1[] {
  return [{ obligationId: P104_OBL_IMPLEMENT, requirementId: "vr-impl-static" }];
}
function covImplementDynamic(): EvidenceCoverageV1[] {
  return [{ obligationId: P104_OBL_IMPLEMENT, requirementId: "vr-impl-dynamic" }];
}
function covImplementBoth(): EvidenceCoverageV1[] {
  return [...covImplementStatic(), ...covImplementDynamic()];
}

function buildImplementScenario(projectId: string): {
  plan: PlanRevisionAcceptedEvent;
  planSnapshot: PlanRevisionSnapshot;
  evidence: [
    { evad: EvidenceAdmittedEvent; ev: EvidenceV1 },
    { evad: EvidenceAdmittedEvent; ev: EvidenceV1 },
  ];
  reduction: { event: TaskReductionUpdatedEvent; snapshot: TaskReductionSnapshot };
} {
  const { event: plan, snapshot: planSnapshot } = planEvent(projectId);
  const s = evidenceEvent({ projectId, taskId: P104_TASK_IMPLEMENT, evidenceId: "ev-impl-static", kind: "observation", outcome: "PASS", coverage: covImplementStatic(), checkId: "static-check-lint", evidenceIndex: 1 });
  const d = evidenceEvent({ projectId, taskId: P104_TASK_IMPLEMENT, evidenceId: "ev-impl-dynamic", kind: "observation", outcome: "PASS", coverage: covImplementDynamic(), checkId: "dynamic-check-tests", evidenceIndex: 2 });
  const reduction = reductionEvent({
    projectId,
    taskId: P104_TASK_IMPLEMENT,
    phase: "satisfied",
    effectiveEvidenceIds: ["ev-impl-static", "ev-impl-dynamic"],
    blockingEvidenceIds: [],
  });
  return { plan, planSnapshot, evidence: [
    { evad: s, ev: s.payload.evidence },
    { evad: d, ev: d.payload.evidence },
  ], reduction };
}

describe("P1-04 verification projection (SQLite)", () => {
  it("uses the injected policy explanation for both evidence views without rewriting reduction facts", async () => {
    let calls = 0;
    const policy = new ControlPolicyExplanation();
    policy.explainEvidence = request => {
      calls++;
      expect(request.evidence.map(item => item.evidenceId)).toEqual(['ev-impl-static', 'ev-impl-dynamic']);
      return { bindings: request.evidence.map(item => ({ evidenceId: item.evidenceId, applicability: 'STALE' })), effectiveEvidenceIds: [], blockingEvidenceIds: ['display-explanation'] };
    };
    const rm = createSqliteReadModelIndex({ path: ':memory:', policyExplanation: policy });
    try {
      const sc = buildImplementScenario(PROJECT_A);
      await feed(rm, 1, [sc.plan, sc.evidence[0].evad, sc.evidence[1].evad, sc.reduction.event]);
      expect(calls).toBe(0);
      const result = await rm.taskVerification({ projectId: PROJECT_A, goalId: GOAL, taskId: P104_TASK_IMPLEMENT });
      expect(result).toMatchObject({ status: 'ready', observedCursor: makeCommitCursor(4), verification: {
        effectiveEvidenceIds: [], blockingEvidenceIds: ['display-explanation'],
        evidence: [{ applicability: 'STALE' }, { applicability: 'STALE' }],
        reduction: { phase: 'satisfied', effectiveEvidenceIds: ['ev-impl-static', 'ev-impl-dynamic'] }
      } });
      expect(await rm.consoleTaskEvidence({ projectId: PROJECT_A, workspaceId: WS, goalId: GOAL, taskId: P104_TASK_IMPLEMENT })).toMatchObject({ status: 'ready', evidence: {
        effectiveEvidenceIds: [], blockingEvidenceIds: ['display-explanation'], reduction: { phase: 'satisfied' }
      } });
      expect(calls).toBe(2);
    } finally { await rm.close(); }
  });

  it("incremental projection rebuilds a verification view from events (applicability recomputed, reduction is a projected fact)", async () => {
    const rm = createSqliteReadModelIndex({ policyExplanation: new ControlPolicyExplanation(), path: ":memory:" });
    const sc = buildImplementScenario(PROJECT_A);
    await feed(rm, 1, [sc.plan]);
    await feed(rm, 2, [sc.evidence[0].evad, sc.evidence[1].evad, sc.reduction.event]);

    const view = await rm.taskVerification({ projectId: PROJECT_A, goalId: GOAL, taskId: P104_TASK_IMPLEMENT });
    expect(view.status).toBe("ready");
    if (view.status !== "ready") return;
    expect(view.observedCursor).toBe(makeCommitCursor(4));

    const v: TaskVerificationView = view.verification;
    expect(v.evidence.map((e) => e.evidenceId)).toEqual(["ev-impl-static", "ev-impl-dynamic"]);
    expect(v.evidence.map((e) => e.applicability)).toEqual(["APPLICABLE", "APPLICABLE"]);
    expect(v.evidence[0]!.checkId).toBe("static-check-lint");
    expect(v.evidence[0]!.evidenceIndex).toBe(1);
    expect(v.evidence[1]!.evidenceIndex).toBe(2);
    expect(v.currentAnchor).not.toBeNull();
    expect(v.reduction).not.toBeNull();
    expect(v.reduction!.phase).toBe("satisfied");
    expect(v.reduction!.effectiveEvidenceIds).toEqual(["ev-impl-static", "ev-impl-dynamic"]);
    expect(v.reduction!.blockingEvidenceIds).toEqual([]);
    expect(v.reduction!.sourceCursor).toBe(makeCommitCursor(4));
    expect(v.planRef.planId).toBe(P104_PLAN_ID);
    expect(v.planRevision).toBe(1);
    expect([...v.effectiveEvidenceIds].sort()).toEqual(["ev-impl-dynamic", "ev-impl-static"]);
    expect(v.blockingEvidenceIds).toEqual([]);
    expect(v.sourceCursor).toBe(makeCommitCursor(4));
    await rm.close();
  });

  it("repeated evidence event is idempotent (dedupe by eventId)", async () => {
    const rm = createSqliteReadModelIndex({ policyExplanation: new ControlPolicyExplanation(), path: ":memory:" });
    const sc = buildImplementScenario(PROJECT_A);
    await feed(rm, 1, [sc.plan]);
    await feed(rm, 2, [sc.evidence[0].evad, sc.evidence[1].evad, sc.reduction.event]);
    await feed(rm, 5, [sc.evidence[0].evad]);

    const view = await rm.taskVerification({ projectId: PROJECT_A, goalId: GOAL, taskId: P104_TASK_IMPLEMENT });
    expect(view.status).toBe("ready");
    if (view.status !== "ready") return;
    expect(view.verification.evidence.map((e) => e.evidenceId)).toEqual(["ev-impl-static", "ev-impl-dynamic"]);
    expect(view.verification.sourceCursor).toBe(makeCommitCursor(4));
    await rm.close();
  });

  it("rebuild equivalence: a fresh SQLite instance fed the same events produces the identical view", async () => {
    const sc = buildImplementScenario(PROJECT_A);
    const rm1 = createSqliteReadModelIndex({ policyExplanation: new ControlPolicyExplanation(), path: ":memory:" });
    await feed(rm1, 1, [sc.plan]);
    await feed(rm1, 2, [sc.evidence[0].evad, sc.evidence[1].evad, sc.reduction.event]);
    const v1 = await rm1.taskVerification({ projectId: PROJECT_A, goalId: GOAL, taskId: P104_TASK_IMPLEMENT });
    expect(v1.status).toBe("ready");
    if (v1.status !== "ready") return;
    await rm1.close();

    const rm2 = createSqliteReadModelIndex({ policyExplanation: new ControlPolicyExplanation(), path: ":memory:" });
    await feed(rm2, 1, [sc.plan]);
    await feed(rm2, 2, [sc.evidence[0].evad, sc.evidence[1].evad, sc.reduction.event]);
    const v2 = await rm2.taskVerification({ projectId: PROJECT_A, goalId: GOAL, taskId: P104_TASK_IMPLEMENT });
    expect(v2.status).toBe("ready");
    if (v2.status !== "ready") return;
    expect(JSON.stringify(v2.verification)).toBe(JSON.stringify(v1.verification));
    await rm2.close();
  });

  it("full-key isolation: identical goalId/taskId under different projects never collide", async () => {
    const rm = createSqliteReadModelIndex({ policyExplanation: new ControlPolicyExplanation(), path: ":memory:" });
    const a = buildImplementScenario(PROJECT_A);
    const b = buildImplementScenario(PROJECT_B);
    await feed(rm, 1, [a.plan]);
    await feed(rm, 2, [b.plan]);
    await feed(rm, 3, [a.evidence[0].evad, a.evidence[1].evad, a.reduction.event]);
    await feed(rm, 6, [b.evidence[0].evad, b.evidence[1].evad, b.reduction.event]);

    const va = await rm.taskVerification({ projectId: PROJECT_A, goalId: GOAL, taskId: P104_TASK_IMPLEMENT });
    const vb = await rm.taskVerification({ projectId: PROJECT_B, goalId: GOAL, taskId: P104_TASK_IMPLEMENT });
    expect(va.status).toBe("ready");
    expect(vb.status).toBe("ready");
    if (va.status !== "ready" || vb.status !== "ready") return;
    expect(va.verification.projectId).toBe(PROJECT_A);
    expect(vb.verification.projectId).toBe(PROJECT_B);
    expect(va.verification.evidence.map((e) => e.evidenceId)).toEqual(["ev-impl-static", "ev-impl-dynamic"]);
    expect(vb.verification.evidence.map((e) => e.evidenceId)).toEqual(["ev-impl-static", "ev-impl-dynamic"]);
    expect(va.verification.planRef.projectId).toBe(PROJECT_A);
    expect(vb.verification.planRef.projectId).toBe(PROJECT_B);

    const covered8 = makeCommitCursor(8);
    const other = await rm.taskVerification({ projectId: PROJECT_A, goalId: GOAL, taskId: P104_TASK_REVIEW, atLeastCursor: covered8 });
    expect(other.status).toBe("not_found");
    expect(va.observedCursor).toBe(makeCommitCursor(8));
    expect(vb.observedCursor).toBe(makeCommitCursor(8));
    await rm.close();
  });

  it("not_found only after covered; not_ready before coverage", async () => {
    const rm = createSqliteReadModelIndex({ policyExplanation: new ControlPolicyExplanation(), path: ":memory:" });
    const sc = buildImplementScenario(PROJECT_A);
    await feed(rm, 1, [sc.plan]);
    await feed(rm, 2, [sc.evidence[0].evad, sc.evidence[1].evad, sc.reduction.event]);
    const covered = makeCommitCursor(4);

    const nf = await rm.taskVerification({ projectId: PROJECT_A, goalId: GOAL, taskId: "task-no-such", atLeastCursor: covered });
    expect(nf.status).toBe("not_found");

    const nr = await rm.taskVerification({ projectId: PROJECT_A, goalId: GOAL, taskId: "task-no-such", atLeastCursor: makeCommitCursor(5) });
    expect(nr.status).toBe("not_ready");
    if (nr.status === "not_ready") expect(nr.requiredCursor).toBe(makeCommitCursor(5));

    const f1 = await rm.taskVerification({ projectId: PROJECT_A, goalId: GOAL, taskId: P104_TASK_IMPLEMENT, atLeastCursor: makeCommitCursor(9) });
    expect(f1.status).toBe("not_ready");
    await rm.close();
  });

  it("stall behaviours: cursor_gap / out_of_order / unknown event type never apply a page", async () => {
    const sc = buildImplementScenario(PROJECT_A);

    const rmGap = createSqliteReadModelIndex({ policyExplanation: new ControlPolicyExplanation(), path: ":memory:" });
    await feed(rmGap, 1, [sc.plan]);
    await rmGap.advance(page(3, [sc.evidence[0].evad])).catch((e: unknown) => {
      expect((e as ProjectionStallError).reason).toBe("cursor_gap");
    });
    await rmGap.close();

    const rmOoo = createSqliteReadModelIndex({ policyExplanation: new ControlPolicyExplanation(), path: ":memory:" });
    await rmOoo.advance(page(2, [sc.plan])).catch(() => undefined);
    await rmOoo.advance(page(1, [sc.evidence[0].evad])).catch((e: unknown) => {
      expect((e as ProjectionStallError).reason).toBe("out_of_order");
    });
    await rmOoo.close();

    const rmUnknown = createSqliteReadModelIndex({ policyExplanation: new ControlPolicyExplanation(), path: ":memory:" });
    const unknown = { ...sc.plan, eventType: "NoSuchEvent" as const } as unknown as DomainEvent;
    await rmUnknown.advance(page(1, [unknown])).catch((e: unknown) => {
      expect(e).toBeInstanceOf(ProjectionStallError);
      expect((e as ProjectionStallError).reason).toBe("unknown_schema_version");
    });
    await rmUnknown.close();
  });

  it("applicability recompute: STALE / OUT_OF_SCOPE rows displayed, history untouched", async () => {
    const rm = createSqliteReadModelIndex({ policyExplanation: new ControlPolicyExplanation(), path: ":memory:" });
    const { event: plan } = planEvent(PROJECT_A);
    const pass = evidenceEvent({ projectId: PROJECT_A, taskId: P104_TASK_IMPLEMENT, evidenceId: "ev-app-pass", kind: "observation", outcome: "PASS", coverage: covImplementStatic(), checkId: "static-check-lint", evidenceIndex: 1 });
    const stale = evidenceEvent({ projectId: PROJECT_A, taskId: P104_TASK_IMPLEMENT, evidenceId: "ev-app-stale", kind: "observation", outcome: "PASS", coverage: covImplementStatic(), checkId: "static-check-lint", workspaceRevision: 2, evidenceIndex: 2 });
    const oos = evidenceEvent({ projectId: PROJECT_A, taskId: P104_TASK_IMPLEMENT, evidenceId: "ev-app-oos", kind: "observation", outcome: "PASS", coverage: [{ obligationId: P104_OBL_REVIEW, requirementId: "vr-review" }], checkId: "static-check-lint", evidenceIndex: 3 });
    const reduction = reductionEvent({
      projectId: PROJECT_A,
      taskId: P104_TASK_IMPLEMENT,
      phase: "verifying",
      effectiveEvidenceIds: ["ev-app-pass"],
      blockingEvidenceIds: [],
      staleEvidenceIds: ["ev-app-stale"],
      outOfScopeEvidenceIds: ["ev-app-oos"],
    });

    await feed(rm, 1, [plan]);
    await feed(rm, 2, [pass, stale, oos, reduction.event]);

    const view = await rm.taskVerification({ projectId: PROJECT_A, goalId: GOAL, taskId: P104_TASK_IMPLEMENT });
    expect(view.status).toBe("ready");
    if (view.status !== "ready") return;
    const byId = new Map(view.verification.evidence.map((e) => [e.evidenceId, e] as const));
    expect(byId.get("ev-app-pass")!.applicability).toBe("APPLICABLE");
    expect(byId.get("ev-app-stale")!.applicability).toBe("STALE");
    expect(byId.get("ev-app-oos")!.applicability).toBe("OUT_OF_SCOPE");
    expect((byId.get("ev-app-pass") as { anchor: { workspaceRevision: number } }).anchor.workspaceRevision).toBe(1);
    expect((byId.get("ev-app-stale") as { anchor: { workspaceRevision: number } }).anchor.workspaceRevision).toBe(2);
    await rm.close();
  });

  it("reduction null -> currentAnchor null and every binding applicability null (no report-derived phase)", async () => {
    const rm = createSqliteReadModelIndex({ policyExplanation: new ControlPolicyExplanation(), path: ":memory:" });
    const { event: plan } = planEvent(PROJECT_A);
    const pass = evidenceEvent({ projectId: PROJECT_A, taskId: P104_TASK_IMPLEMENT, evidenceId: "ev-only-pass", kind: "observation", outcome: "PASS", coverage: covImplementBoth(), checkId: "static-check-lint", evidenceIndex: 1 });
    await feed(rm, 1, [plan]);
    await feed(rm, 2, [pass]);

    const view = await rm.taskVerification({ projectId: PROJECT_A, goalId: GOAL, taskId: P104_TASK_IMPLEMENT });
    expect(view.status).toBe("ready");
    if (view.status !== "ready") return;
    expect(view.verification.currentAnchor).toBeNull();
    expect(view.verification.reduction).toBeNull();
    expect(view.verification.evidence[0]!.applicability).toBeNull();
    expect(view.verification.effectiveEvidenceIds).toEqual([]);
    expect(view.verification.blockingEvidenceIds).toEqual([]);
    await rm.close();
  });
});
