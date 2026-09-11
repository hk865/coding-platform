import { ControlPolicyExplanation } from '../../src/control/control-engine/policy-explanation.js';
/**
 * P1-11 LANE-C SQLite projection tests — planChangeView over the real
 * SqliteReadModelIndex (the same event stream as the InMemory twin, fed as a
 * plain EventPage). Asserts the same ready / isolation / no-advance facts and,
 * on top, close/reopen rebuild equivalence (fresh read-model file replaying the
 * same event stream reproduces the view field-for-field).
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteReadModelIndex } from "../../src/data/read-model-index/sqlite-read-model-index.js";
import { makeCommitCursor, type EventPage, type PositionedEvent } from "../../src/contracts/ledger.js";
import { FIXED_ISO_2026_09_05 } from "../../src/testing/sequences.js";
import { P111_GOAL, P111_PROJECT, P111_SOURCE_PLAN, P111_WORKSPACE, buildApplyPlanChangeCommand, buildP111NewPlanDraft, buildPlanProposalV1, buildRecordPlanChangeProposalCommand, buildRecordUserDecisionCommand, buildUserDecisionV1, p111GoalRef, p111PlanRef } from "../contract-support/fixtures/goal-change-fixtures.js";
import { buildPlanChangeProposalRecordCommit, buildGoalChangeApplyCommit, buildUserDecisionRecordCommit } from "../../src/control/control-engine/records/goal-change.js";
import { HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1, buildApplyPlanCommand } from "../../src/fixtures/plan-fixtures.js";
import { planRevisionAcceptedEventFor, planRevisionSnapshotFor } from "../../src/control/control-engine/records/plan.js";
import { ARCHITECTURE_BASELINE_FIXTURE_V1, COMPLETION_POLICY_FIXTURE_V1, buildInstallCommand } from "../../src/fixtures/governance-fixtures.js";
import { architectureBaselinePinFor, completionPolicyPinFor } from "../../src/contracts/governance.js";
import type { InstallArchitectureBaselineRevisionCommand, InstallCompletionPolicyRevisionCommand } from "../../src/contracts/governance.js";
import type { GoalSnapshot } from "../../src/contracts/ledger.js";

const FIXED = FIXED_ISO_2026_09_05;

function json(v: unknown): string {
  return JSON.stringify(v);
}

function buildP111Page(projectId: string = P111_PROJECT): { page: EventPage } {
  const planCmd = buildApplyPlanCommand(HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1, {
    commandId: "p111-src-accept",
    correlationId: "p111-src-corr",
    submittedAt: FIXED,
    projectId,
    expectedRevision: 1,
    idempotencyKey: "p111-src-accept-idem",
  });
  const cp = buildInstallCommand(COMPLETION_POLICY_FIXTURE_V1, {
    commandId: "p111-cp-install",
    correlationId: "p111-cp-corr",
    submittedAt: FIXED,
    projectId,
    idempotencyKey: "p111-cp-idem",
  }) as InstallCompletionPolicyRevisionCommand;
  const ab = buildInstallCommand(ARCHITECTURE_BASELINE_FIXTURE_V1, {
    commandId: "p111-ab-install",
    correlationId: "p111-ab-corr",
    submittedAt: FIXED,
    projectId,
    idempotencyKey: "p111-ab-idem",
  }) as InstallArchitectureBaselineRevisionCommand;
  const pins = {
    completionPolicy: completionPolicyPinFor(cp),
    architectureBaseline: architectureBaselinePinFor(ab),
  };
  const sourceSnap = planRevisionSnapshotFor(planCmd, pins, FIXED);
  const sourceAccepted = planRevisionAcceptedEventFor(planCmd, {
    eventId: "evt-p111-src-accept",
    occurredAt: FIXED,
    workspaceId: P111_WORKSPACE,
    goalAggregateRevision: 2,
    planSnapshot: sourceSnap,
  });

  const proposal = buildPlanProposalV1({
    projectId,
    workspaceId: P111_WORKSPACE,
    sourceGoalRef: p111GoalRef(projectId),
    sourcePlanRef: p111PlanRef(P111_SOURCE_PLAN, projectId),
  });
  const propCommit = buildPlanChangeProposalRecordCommit(
    buildRecordPlanChangeProposalCommand(proposal, { commandId: "p111-cmd-proposal" }),
    { eventId: "evt-p111-proposal", occurredAt: FIXED },
  );

  const decision = buildUserDecisionV1({ proposal, outcome: "accept" });
  const decCommit = buildUserDecisionRecordCommit(
    buildRecordUserDecisionCommand(decision, { commandId: "p111-cmd-decision" }),
    { eventId: "evt-p111-decision", occurredAt: FIXED },
  );

  const deltas = proposal.patch.patchDraft.obligationDeltas;
  const newPlanDraft = buildP111NewPlanDraft(sourceSnap, deltas, proposal.patch.patchDraft.objective);
  const applyCmd = buildApplyPlanChangeCommand(proposal, decision, newPlanDraft, {
    commandId: "p111-cmd-apply",
    expectedRevision: 1,
  });
  const baseGoal: GoalSnapshot = {
    ref: p111GoalRef(projectId),
    workspaceRef: { aggregateType: "Workspace", projectId, workspaceId: P111_WORKSPACE },
    objective: proposal.patch.patchDraft.objective,
    desiredState: "active",
    activePlanRevision: null,
    revision: 1,
  };
  const applyCommit = buildGoalChangeApplyCommit(applyCmd, {
    eventId: "evt-p111-apply",
    occurredAt: FIXED,
    changedAt: FIXED,
    pins,
    sourcePlan: sourceSnap,
    newPlanDraft,
    baseGoal,
  });

  const events: PositionedEvent[] = [
    { cursor: makeCommitCursor(1), event: sourceAccepted },
    { cursor: makeCommitCursor(2), event: propCommit.events[0]! },
    { cursor: makeCommitCursor(3), event: decCommit.events[0]! },
    { cursor: makeCommitCursor(4), event: applyCommit.events[0]! },
    { cursor: makeCommitCursor(5), event: applyCommit.events[1]! },
    { cursor: makeCommitCursor(6), event: applyCommit.events[2]! },
  ];
  return { page: { afterCursor: null, throughCursor: makeCommitCursor(6), events, hasMore: false } };
}

describe("P1-11 LANE-C SQLite projection: planChangeView", () => {
  it("gets disposition explanations through the Control port while preserving projected decisions and cursor", async () => {
    const policy = new ControlPolicyExplanation(), base = policy.explainPlanChange.bind(policy);
    let calls = 0;
    policy.explainPlanChange = request => { calls++; return base(request).map(row => ({ ...row, reason: 'control-policy-explanation' })); };
    const rm = createSqliteReadModelIndex({ path: ':memory:', policyExplanation: policy });
    try {
      const { page } = buildP111Page();
      await rm.advance(page);
      expect(calls).toBe(0);
      const view = await rm.planChangeView({ projectId: P111_PROJECT, workspaceId: P111_WORKSPACE, goalId: P111_GOAL });
      expect(view).toMatchObject({ status: 'ready', freshness: makeCommitCursor(6) });
      if (view.status !== 'ready') throw Error('view absent');
      expect(view.dispositions.every(row => row.reason === 'control-policy-explanation')).toBe(true);
      expect(view.decisions).toHaveLength(1);
      expect(calls).toBe(1);
      expect((await rm.advance(page)).appliedEventIds).toEqual([]);
    } finally { await rm.close(); }
  });

  it("projects proposals/decisions/revisions and computes task dispositions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p111-rm-"));
    const path = join(dir, "rm.sqlite");
    const rm = createSqliteReadModelIndex({ policyExplanation: new ControlPolicyExplanation(), path });
    try {
      const { page } = buildP111Page();
      const receipt = await rm.advance(page);
      expect(receipt.appliedEventIds.length).toBe(6);

      const view = await rm.planChangeView({ projectId: P111_PROJECT, workspaceId: P111_WORKSPACE, goalId: P111_GOAL });
      expect(view.status).toBe("ready");
      if (view.status !== "ready") throw new Error("view not ready");
      expect(view.proposals.length).toBe(1);
      expect(view.proposals[0]!.ref.proposalId).toBe("proposal-p111-1");
      expect(view.decisions.length).toBe(1);
      expect(view.decisions[0]!.ref.decisionId).toBe("decision-p111-1");
      expect(view.revisions.length).toBe(1);
      expect(view.freshness).toBeTruthy();

      const byTask = new Map(view.dispositions.map((d) => [d.taskId, d]));
      expect(byTask.get("task-verify")?.disposition).toBe("reverify");
      expect(byTask.get("task-install-contract")?.disposition).toBe("keep");
    } finally {
      await rm.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("isolates the same local goal id across projects (hard scope key)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p111-rm-"));
    const path = join(dir, "rm.sqlite");
    const rm = createSqliteReadModelIndex({ policyExplanation: new ControlPolicyExplanation(), path });
    try {
      const { page } = buildP111Page();
      await rm.advance(page);
      const other = await rm.planChangeView({ projectId: "proj-beta", workspaceId: P111_WORKSPACE, goalId: P111_GOAL });
      expect(other.status).toBe("not_found");
    } finally {
      await rm.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a never-advanced index returns not_found (no cursor claim)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p111-rm-"));
    const path = join(dir, "rm.sqlite");
    const rm = createSqliteReadModelIndex({ policyExplanation: new ControlPolicyExplanation(), path });
    try {
      const view = await rm.planChangeView({ projectId: P111_PROJECT, workspaceId: P111_WORKSPACE, goalId: P111_GOAL });
      expect(view.status).toBe("not_found");
    } finally {
      await rm.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rebuild equivalence: close/reopen against the SAME db file reproduces the view", async () => {
    const dir = mkdtempSync(join(tmpdir(), "p111-rm-"));
    const path = join(dir, "rm.sqlite");
    const rm = createSqliteReadModelIndex({ policyExplanation: new ControlPolicyExplanation(), path });
    try {
      const { page } = buildP111Page();
      await rm.advance(page);
      const before = await rm.planChangeView({ projectId: P111_PROJECT, workspaceId: P111_WORKSPACE, goalId: P111_GOAL });
      await rm.close();

      const reopened = createSqliteReadModelIndex({ policyExplanation: new ControlPolicyExplanation(), path });
      try {
        await reopened.advance(page);
        const after = await reopened.planChangeView({ projectId: P111_PROJECT, workspaceId: P111_WORKSPACE, goalId: P111_GOAL });
        expect(json(after)).toBe(json(before));
        if (after.status === "ready") {
          expect(after.proposals[0]!.ref.proposalId).toBe("proposal-p111-1");
          expect(after.dispositions.map((d) => d.disposition)).toContain("reverify");
        }
      } finally {
        await reopened.close();
      }
    } finally {
      await rm.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
