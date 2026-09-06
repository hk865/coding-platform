/**
 * P1-11 lane-A unit tests: goal-change engine (ControlEngine + real
 * InMemoryLedger).
 *
 * Driven purely through recordPlanChangeProposal / recordUserDecision /
 * applyPlanChange on a real ControlEngineImpl. Governance state + the source
 * plan are committed DIRECTLY to the ledger (lane B compilers are separate
 * worktrees); the engine's eventId()/now() are free of those setup commits so
 * the fold-equality assertion can pin exact values.
 */
import { describe, expect, it } from "vitest";
import { createControlEngine } from "../../src/control/control-engine.js";
import { InMemoryLedger } from "../../src/ledger/in-memory-ledger.js";
import type { LedgerCommit, LedgerCommitReceipt, GoalSnapshot, StateLedger } from "../../src/contracts/ledger.js";
import { createDeterministicDeps, FIXED_ISO_2026_09_05 } from "../../src/contracts/testing/sequences.js";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import { WORKSPACE_BOOTSTRAP_FIXTURE_V1, buildBootstrapLedgerCommit } from "../../src/contracts/fixtures/bootstrap-fixture-v1.js";
import { MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1, buildCreateGoalCommand, buildGoalCreateLedgerCommit, goalSnapshotFor } from "../../src/contracts/fixtures/goal-fixtures.js";
import { ARCHITECTURE_BASELINE_FIXTURE_V1, COMPLETION_POLICY_FIXTURE_V1, buildActivateCommand, buildActivateLedgerCommit, buildInstallCommand, buildInstallLedgerCommit, completionPolicyPinFor, architectureBaselinePinFor } from "../../src/contracts/fixtures/governance-fixtures.js";
import type { InstallArchitectureBaselineRevisionCommand, InstallCompletionPolicyRevisionCommand } from "../../src/contracts/governance.js";
import { HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1, buildApplyPlanCommand, buildPlanLedgerCommit } from "../../src/contracts/fixtures/plan-fixtures.js";
import type { PlanRevisionSnapshot } from "../../src/contracts/plan.js";
import { decisionTargetFor } from "../../src/contracts/goal-change.js";
import {
  P111_NEW_PLAN,
  P111_PROJECT,
  P111_SOURCE_PLAN,
  P111_WORKSPACE,
  buildApplyPlanChangeCommand,
  buildGoalChangeApplyCommit,
  buildP111NewPlanDraft,
  buildPlanChangeProposalRecordCommit,
  buildPlanPatchV1,
  buildPlanProposalV1,
  buildRecordPlanChangeProposalCommand,
  buildRecordUserDecisionCommand,
  buildUserDecisionRecordCommit,
  buildUserDecisionV1,
  p111DecisionRef,
  p111GoalRef,
  p111PlanRef,
  p111ProposalRef,
} from "../../src/contracts/fixtures/goal-change-fixtures.js";
import type {
  ApplyPlanChangeCommand,
  PlanPatchV1,
  PlanProposalV1,
  UserDecisionV1,
} from "../../src/contracts/goal-change.js";
import { canonicalJson } from "../../src/contracts/fingerprint.js";

const FIXED = FIXED_ISO_2026_09_05;

class RecordingLedger extends InMemoryLedger {
  commits: LedgerCommit[] = [];
  override async commit(batch: LedgerCommit): Promise<LedgerCommitReceipt> {
    this.commits.push(batch);
    return super.commit(batch);
  }
}

type Harness = { ledger: RecordingLedger; engine: ReturnType<typeof createControlEngine> };

function makeHarness(): Harness {
  const ledger = new RecordingLedger();
  const deps = createDeterministicDeps();
  const engine = createControlEngine({ ledger, now: deps.clock, eventId: deps.eventId });
  return { ledger, engine };
}

async function bootstrap(ledger: StateLedger): Promise<void> {
  const cmd = buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, {
    commandId: "cmd-bootstrap",
    correlationId: "corr-bootstrap",
    submittedAt: FIXED,
  });
  const receipt = await ledger.commit(
    buildBootstrapLedgerCommit(cmd, { eventIds: ["evt-bootstrap-1", "evt-bootstrap-2", "evt-bootstrap-3", "evt-bootstrap-4"], occurredAt: FIXED }),
  );
  expect(receipt.status).toBe("committed");
}

function scopeFor(projectId: string) {
  const scope = MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1.scopes.find((s) => s.projectId === projectId);
  if (!scope) throw new Error("unknown project: " + projectId);
  return scope;
}

async function createGoal(ledger: StateLedger, projectId: string): Promise<void> {
  const scope = scopeFor(projectId);
  await ledger.commit(
    buildGoalCreateLedgerCommit(
      buildCreateGoalCommand(scope, { commandId: "cmd-goal-" + projectId, correlationId: "corr-goal-" + projectId, submittedAt: FIXED }),
      { eventId: "evt-goal-" + projectId, occurredAt: FIXED, projectRevision: 1, workspaceRevision: 1 },
    ),
  );
}

type GovernanceState = { cp: InstallCompletionPolicyRevisionCommand; ab: InstallArchitectureBaselineRevisionCommand };

async function installActivateGovernance(ledger: StateLedger, projectId: string): Promise<GovernanceState> {
  const cp = buildInstallCommand(COMPLETION_POLICY_FIXTURE_V1, {
    commandId: "cmd-install-cp-" + projectId, correlationId: "corr-install-cp-" + projectId, submittedAt: FIXED, projectId, idempotencyKey: "inst-cp-" + projectId,
  }) as InstallCompletionPolicyRevisionCommand;
  await ledger.commit(buildInstallLedgerCommit(cp, { eventId: "evt-install-cp-" + projectId, occurredAt: FIXED }));
  const ab = buildInstallCommand(ARCHITECTURE_BASELINE_FIXTURE_V1, {
    commandId: "cmd-install-ab-" + projectId, correlationId: "corr-install-ab-" + projectId, submittedAt: FIXED, projectId, idempotencyKey: "inst-ab-" + projectId,
  }) as InstallArchitectureBaselineRevisionCommand;
  await ledger.commit(buildInstallLedgerCommit(ab, { eventId: "evt-install-ab-" + projectId, occurredAt: FIXED }));
  await ledger.commit(
    buildActivateLedgerCommit(
      buildActivateCommand(completionPolicyPinFor(cp), { commandId: "cmd-act-cp-" + projectId, correlationId: "corr-act-cp-" + projectId, submittedAt: FIXED, projectId, expectedRevision: 1, idempotencyKey: "act-cp-" + projectId }),
      { eventId: "evt-act-cp-" + projectId, occurredAt: FIXED, activeAggregateRevision: 1, projectRevision: 1 },
    ),
  );
  await ledger.commit(
    buildActivateLedgerCommit(
      buildActivateCommand(architectureBaselinePinFor(ab), { commandId: "cmd-act-ab-" + projectId, correlationId: "corr-act-ab-" + projectId, submittedAt: FIXED, projectId, expectedRevision: 1, idempotencyKey: "act-ab-" + projectId }),
      { eventId: "evt-act-ab-" + projectId, occurredAt: FIXED, activeAggregateRevision: 1, projectRevision: 1 },
    ),
  );
  return { cp, ab };
}

type Setup = Harness & GovernanceState & {
  pins: { completionPolicy: ReturnType<typeof completionPolicyPinFor>; architectureBaseline: ReturnType<typeof architectureBaselinePinFor> };
  sourcePlan: PlanRevisionSnapshot;
  sourceGoal: GoalSnapshot;
};

/** Full happy-path state: bootstrap + goal + governance + source plan accepted. */
async function setupP111(projectId = P111_PROJECT): Promise<Setup> {
  const { ledger, engine } = makeHarness();
  await bootstrap(ledger);
  await createGoal(ledger, projectId);
  const gov = await installActivateGovernance(ledger, projectId);
  const pins = { completionPolicy: completionPolicyPinFor(gov.cp), architectureBaseline: architectureBaselinePinFor(gov.ab) };
  const acceptCmd = buildApplyPlanCommand(HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1, {
    commandId: "cmd-accept-plan-" + projectId, correlationId: "corr-accept-plan-" + projectId, submittedAt: FIXED, projectId, expectedRevision: 1, idempotencyKey: "accept-plan-" + projectId,
  });
  const baseGoal = goalSnapshotFor(buildCreateGoalCommand(scopeFor(projectId), { commandId: "cmd-goal-" + projectId, correlationId: "corr-goal-" + projectId, submittedAt: FIXED }));
  const planRec = await ledger.commit(
    buildPlanLedgerCommit(acceptCmd, { eventId: "evt-accept-plan-" + projectId, occurredAt: FIXED, acceptedAt: FIXED, pins, baseGoal }),
  );
  expect(planRec.status).toBe("committed");
  const sourcePlanLoad = await ledger.load(p111PlanRef(HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1.planId, projectId));
  expect(sourcePlanLoad.status).toBe("found");
  if (sourcePlanLoad.status !== "found") throw new Error("source plan not found");
  const sourceGoalLoad = await ledger.load(p111GoalRef(projectId));
  expect(sourceGoalLoad.status).toBe("found");
  if (sourceGoalLoad.status !== "found") throw new Error("source goal not found");
  return { ledger, engine, ...gov, pins, sourcePlan: sourcePlanLoad.snapshot as PlanRevisionSnapshot, sourceGoal: sourceGoalLoad.snapshot as GoalSnapshot };
}

function proposalFor(projectId: string, overrides: Partial<PlanProposalV1> = {}): PlanProposalV1 {
  return buildPlanProposalV1({
    projectId,
    workspaceId: P111_WORKSPACE,
    sourceGoalRef: p111GoalRef(projectId),
    sourcePlanRef: p111PlanRef(P111_SOURCE_PLAN, projectId),
    ...overrides,
  });
}

function patchFor(projectId: string, overrides: Partial<PlanPatchV1> = {}): PlanPatchV1 {
  return buildPlanPatchV1({
    projectId,
    workspaceId: P111_WORKSPACE,
    goalRef: p111GoalRef(projectId),
    sourcePlanRef: p111PlanRef(P111_SOURCE_PLAN, projectId),
    sourcePlanRevision: 1,
    ...overrides,
  });
}

function acceptedDecision(proposal: PlanProposalV1, overrides: Partial<UserDecisionV1> = {}): UserDecisionV1 {
  return buildUserDecisionV1({ proposal, outcome: "accept", overrides });
}

async function loadSourcePlan(ledger: StateLedger, proposal: PlanProposalV1): Promise<PlanRevisionSnapshot> {
  const res = await ledger.load(proposal.sourcePlanRef);
  expect(res.status).toBe("found");
  if (res.status !== "found") throw new Error("source plan not found for " + proposal.sourcePlanRef.planId + " in " + proposal.projectId);
  return res.snapshot as PlanRevisionSnapshot;
}

async function eventCount(ledger: StateLedger): Promise<number> {
  const page = await ledger.events({ afterCursor: null, limit: 1000 });
  return page.events.length;
}

async function lastEvents(ledger: StateLedger, n: number) {
  const page = await ledger.events({ afterCursor: null, limit: 1000 });
  return page.events.slice(-n);
}

describe("P1-11 goal-change engine", () => {
  describe("happy path", () => {
    it("proposal -> decision(accept) -> apply commits; goal +1, new active plan, source preserved, event sequence", async () => {
      const { ledger, engine, sourceGoal } = await setupP111("proj-alpha");
      const proposal = proposalFor("proj-alpha");
      const propRec = await engine.recordPlanChangeProposal(buildRecordPlanChangeProposalCommand(proposal, { commandId: "cmd-prop" }));
      expect(propRec.status).toBe("committed");
      if (propRec.status !== "committed") return;
      const decision = acceptedDecision(proposal);
      const decRec = await engine.recordUserDecision(buildRecordUserDecisionCommand(decision, { commandId: "cmd-dec" }));
      expect(decRec.status).toBe("committed");
      if (decRec.status !== "committed") return;

      const sourcePlan = await loadSourcePlan(ledger, proposal);
      const draft = buildP111NewPlanDraft(sourcePlan, proposal.patch.patchDraft.obligationDeltas, proposal.patch.patchDraft.objective);
      const applyCmd = buildApplyPlanChangeCommand(proposal, decision, draft, { commandId: "cmd-apply", expectedRevision: sourceGoal.revision });
      const applyRec = await engine.applyPlanChange(applyCmd);
      expect(applyRec.status).toBe("committed");
      if (applyRec.status !== "committed") return;
      expect(applyRec.replayed).toBe(false);

      const goal = await ledger.load(p111GoalRef("proj-alpha"));
      expect(goal.status).toBe("found");
      if (goal.status !== "found") return;
      const goalSnap = goal.snapshot as GoalSnapshot;
      expect(goalSnap.revision).toBe(sourceGoal.revision + 1);
      expect(goalSnap.activePlanRevision).toEqual(p111PlanRef(P111_NEW_PLAN, "proj-alpha"));

      const src = await ledger.load(p111PlanRef(P111_SOURCE_PLAN, "proj-alpha"));
      expect(src.status).toBe("found");

      const last3 = await lastEvents(ledger, 3);
      expect(last3.map((p) => p.event.eventType)).toEqual(["PlanRevisionAccepted", "PlanRevisionSuperseded", "GoalRevisionRecorded"]);

      const json = JSON.stringify(await ledger.events({ afterCursor: null, limit: 1000 }));
      expect(json).not.toMatch(/TaskAttempt/);
      expect(json).not.toMatch(/AgentRun/);
      expect(json).not.toMatch(/outbox/);
      const applyBatch = ledger.commits[ledger.commits.length - 1]!;
      expect(applyBatch.outboxIntents).toEqual([]);
    });
  });

  describe("fold-equality", () => {
    it("engine submits the exact buildGoalChangeApplyCommit batch for the same deps value", async () => {
      const { ledger, engine, pins, sourcePlan, sourceGoal } = await setupP111("proj-alpha");
      const proposal = proposalFor("proj-alpha");
      const propCmd = buildRecordPlanChangeProposalCommand(proposal, { commandId: "cmd-prop-direct" });
      expect((await ledger.commit(buildPlanChangeProposalRecordCommit(propCmd, { eventId: "evt-prop-direct", occurredAt: FIXED }))).status).toBe("committed");
      const decision = acceptedDecision(proposal);
      const decCmd = buildRecordUserDecisionCommand(decision, { commandId: "cmd-dec-direct" });
      expect((await ledger.commit(buildUserDecisionRecordCommit(decCmd, { eventId: "evt-dec-direct", occurredAt: FIXED }))).status).toBe("committed");

      const draft = buildP111NewPlanDraft(sourcePlan, proposal.patch.patchDraft.obligationDeltas, proposal.patch.patchDraft.objective);
      const applyCmd = buildApplyPlanChangeCommand(proposal, decision, draft, { commandId: "cmd-apply-fold", expectedRevision: sourceGoal.revision });
      const applyRec = await engine.applyPlanChange(applyCmd);
      expect(applyRec.status).toBe("committed");
      if (applyRec.status !== "committed") return;

      const submitted = ledger.commits[ledger.commits.length - 1]!;
      const expected = buildGoalChangeApplyCommit(applyCmd, {
        eventId: "evt-0001",
        occurredAt: FIXED,
        changedAt: FIXED,
        pins,
        sourcePlan,
        newPlanDraft: draft,
        baseGoal: { ...sourceGoal, revision: applyCmd.expectedRevision },
      });
      expect(canonicalJson(submitted)).toBe(canonicalJson(expected));
    });
  });

  describe("guard rejections are zero-write", () => {
    it("proposal not recorded -> proposal_not_found, zero write", async () => {
      const { ledger, engine, sourceGoal } = await setupP111("proj-alpha");
      const proposal = proposalFor("proj-alpha");
      const decision = acceptedDecision(proposal);
      const sourcePlan = await loadSourcePlan(ledger, proposal);
      const draft = buildP111NewPlanDraft(sourcePlan, proposal.patch.patchDraft.obligationDeltas, proposal.patch.patchDraft.objective);
      const applyCmd = buildApplyPlanChangeCommand(proposal, decision, draft, { commandId: "cmd-apply-noprop", expectedRevision: sourceGoal.revision });
      const cmd: ApplyPlanChangeCommand = { ...applyCmd, aggregateId: "proposal-nope", payload: { ...applyCmd.payload, proposalRef: p111ProposalRef("proposal-nope", "proj-alpha") } };
      const before = await eventCount(ledger);
      const receipt = await engine.applyPlanChange(cmd);
      expect(receipt).toEqual({ status: "rejected", commandId: cmd.commandId, code: "proposal_not_found" });
      expect(await eventCount(ledger)).toBe(before);
    });

    it("decision not recorded -> decision_not_found, zero write", async () => {
      const { ledger, engine, sourceGoal } = await setupP111("proj-alpha");
      const proposal = proposalFor("proj-alpha");
      expect((await engine.recordPlanChangeProposal(buildRecordPlanChangeProposalCommand(proposal, { commandId: "cmd-prop2" }))).status).toBe("committed");
      const decision = acceptedDecision(proposal);
      const sourcePlan = await loadSourcePlan(ledger, proposal);
      const draft = buildP111NewPlanDraft(sourcePlan, proposal.patch.patchDraft.obligationDeltas, proposal.patch.patchDraft.objective);
      const applyCmd = buildApplyPlanChangeCommand(proposal, decision, draft, { commandId: "cmd-apply-nodec", expectedRevision: sourceGoal.revision });
      const cmd: ApplyPlanChangeCommand = { ...applyCmd, payload: { ...applyCmd.payload, decisionRef: p111DecisionRef("decision-nope", "proj-alpha") } };
      const before = await eventCount(ledger);
      const receipt = await engine.applyPlanChange(cmd);
      expect(receipt).toEqual({ status: "rejected", commandId: cmd.commandId, code: "decision_not_found" });
      expect(await eventCount(ledger)).toBe(before);
    });

    it("outcome reject -> decision_not_accepted, zero write", async () => {
      const { ledger, engine, sourceGoal } = await setupP111("proj-alpha");
      const proposal = proposalFor("proj-alpha");
      expect((await engine.recordPlanChangeProposal(buildRecordPlanChangeProposalCommand(proposal, { commandId: "cmd-prop3" }))).status).toBe("committed");
      const decision = buildUserDecisionV1({ proposal, outcome: "reject" });
      expect((await engine.recordUserDecision(buildRecordUserDecisionCommand(decision, { commandId: "cmd-dec3" }))).status).toBe("committed");
      const sourcePlan = await loadSourcePlan(ledger, proposal);
      const draft = buildP111NewPlanDraft(sourcePlan, proposal.patch.patchDraft.obligationDeltas, proposal.patch.patchDraft.objective);
      const applyCmd = buildApplyPlanChangeCommand(proposal, decision, draft, { commandId: "cmd-apply-reject", expectedRevision: sourceGoal.revision });
      const before = await eventCount(ledger);
      const receipt = await engine.applyPlanChange(applyCmd);
      expect(receipt).toEqual({ status: "rejected", commandId: applyCmd.commandId, code: "decision_not_accepted" });
      expect(await eventCount(ledger)).toBe(before);
    });

    it("authorizedTarget tampered (newObjective changed) -> decision_target_mismatch, zero write", async () => {
      const { ledger, engine, sourceGoal } = await setupP111("proj-alpha");
      const proposal = proposalFor("proj-alpha");
      expect((await engine.recordPlanChangeProposal(buildRecordPlanChangeProposalCommand(proposal, { commandId: "cmd-prop4" }))).status).toBe("committed");
      const decision = acceptedDecision(proposal, { authorizedTarget: { ...decisionTargetFor(proposal), newObjective: "tampered objective" } });
      expect((await engine.recordUserDecision(buildRecordUserDecisionCommand(decision, { commandId: "cmd-dec4" }))).status).toBe("committed");
      const sourcePlan = await loadSourcePlan(ledger, proposal);
      const draft = buildP111NewPlanDraft(sourcePlan, proposal.patch.patchDraft.obligationDeltas, proposal.patch.patchDraft.objective);
      const applyCmd = buildApplyPlanChangeCommand(proposal, decision, draft, { commandId: "cmd-apply-tamper", expectedRevision: sourceGoal.revision });
      const before = await eventCount(ledger);
      const receipt = await engine.applyPlanChange(applyCmd);
      expect(receipt.status).toBe("rejected");
      if (receipt.status !== "rejected") return;
      expect(receipt.code).toBe("decision_target_mismatch");
      expect(await eventCount(ledger)).toBe(before);
    });

    it("invalid authority -> decision_target_mismatch, zero write", async () => {
      const { ledger, engine, sourceGoal } = await setupP111("proj-alpha");
      const proposal = proposalFor("proj-alpha");
      expect((await engine.recordPlanChangeProposal(buildRecordPlanChangeProposalCommand(proposal, { commandId: "cmd-prop5" }))).status).toBe("committed");
      const sourcePlan = await loadSourcePlan(ledger, proposal);
      const draft = buildP111NewPlanDraft(sourcePlan, proposal.patch.patchDraft.obligationDeltas, proposal.patch.patchDraft.objective);
      const cases: UserDecisionV1["authority"][] = [
        { strategy: "delegated", delegator: null, policyVersion: "policy@1" },
        { strategy: "user", delegator: null, policyVersion: "" },
      ];
      for (let i = 0; i < cases.length; i++) {
        const authority = cases[i]!;
        const decision = buildUserDecisionV1({ proposal, outcome: "accept", authority, overrides: { decisionId: "decision-auth-" + i } });
        const decCmd = buildRecordUserDecisionCommand(decision, { commandId: "cmd-dec5-" + i });
        expect((await ledger.commit(buildUserDecisionRecordCommit(decCmd, { eventId: "evt-dec5-" + i, occurredAt: FIXED }))).status).toBe("committed");
        const applyCmd = buildApplyPlanChangeCommand(proposal, decision, draft, { commandId: "cmd-apply-auth-" + i, expectedRevision: sourceGoal.revision });
        const before = await eventCount(ledger);
        const receipt = await engine.applyPlanChange(applyCmd);
        expect(receipt.status).toBe("rejected");
        if (receipt.status !== "rejected") return;
        expect(receipt.code).toBe("decision_target_mismatch");
        expect(await eventCount(ledger)).toBe(before);
      }
    });

    it("draft inconsistency -> draft_mismatch, zero write", async () => {
      const { ledger, engine, sourceGoal } = await setupP111("proj-alpha");
      const proposal = proposalFor("proj-alpha");
      expect((await engine.recordPlanChangeProposal(buildRecordPlanChangeProposalCommand(proposal, { commandId: "cmd-prop6" }))).status).toBe("committed");
      const decision = acceptedDecision(proposal);
      expect((await engine.recordUserDecision(buildRecordUserDecisionCommand(decision, { commandId: "cmd-dec6" }))).status).toBe("committed");
      const sourcePlan = await loadSourcePlan(ledger, proposal);
      const goodDraft = buildP111NewPlanDraft(sourcePlan, proposal.patch.patchDraft.obligationDeltas, proposal.patch.patchDraft.objective);
      const badDraft = { ...goodDraft, objective: proposal.patch.patchDraft.objective + " (changed)", planRevision: sourcePlan.planRevision };
      const applyCmd = buildApplyPlanChangeCommand(proposal, decision, badDraft, { commandId: "cmd-apply-draft", expectedRevision: sourceGoal.revision });
      const before = await eventCount(ledger);
      const receipt = await engine.applyPlanChange(applyCmd);
      expect(receipt.status).toBe("rejected");
      if (receipt.status !== "rejected") return;
      expect(receipt.code).toBe("draft_mismatch");
      expect((receipt.issues ?? []).length).toBeGreaterThan(0);
      expect(await eventCount(ledger)).toBe(before);
    });

    it("source stale (proposal source no longer active) -> source_stale, zero write", async () => {
      const { ledger, engine, sourceGoal } = await setupP111("proj-alpha");
      const proposal = proposalFor("proj-alpha");
      expect((await engine.recordPlanChangeProposal(buildRecordPlanChangeProposalCommand(proposal, { commandId: "cmd-prop7" }))).status).toBe("committed");
      const decision = acceptedDecision(proposal);
      expect((await engine.recordUserDecision(buildRecordUserDecisionCommand(decision, { commandId: "cmd-dec7" }))).status).toBe("committed");
      const sourcePlan = await loadSourcePlan(ledger, proposal);
      const draft = buildP111NewPlanDraft(sourcePlan, proposal.patch.patchDraft.obligationDeltas, proposal.patch.patchDraft.objective);
      const first = buildApplyPlanChangeCommand(proposal, decision, draft, { commandId: "cmd-apply-first", expectedRevision: sourceGoal.revision });
      expect((await engine.applyPlanChange(first)).status).toBe("committed");
      const second = buildApplyPlanChangeCommand(proposal, decision, draft, { commandId: "cmd-apply-stale", expectedRevision: sourceGoal.revision + 1 });
      const before = await eventCount(ledger);
      const receipt = await engine.applyPlanChange(second);
      expect(receipt).toEqual({ status: "rejected", commandId: second.commandId, code: "source_stale" });
      expect(await eventCount(ledger)).toBe(before);
    });

    it("guards_failed when the new draft has no obligations, zero write", async () => {
      const { ledger, engine, sourceGoal } = await setupP111("proj-alpha");
      const objective = "P1-11 目标：空义务新 revision";
      const patch = patchFor("proj-alpha", {
        patchDraft: {
          objective,
          obligationDeltas: [
            { obligationId: "obl-1", action: "remove", newText: null, justification: "test" },
            { obligationId: "obl-2", action: "remove", newText: null, justification: "test" },
            { obligationId: "obl-3", action: "remove", newText: null, justification: "test" },
          ],
          taskHierarchy: null,
        },
      });
      const proposal = proposalFor("proj-alpha", { patch });
      expect((await engine.recordPlanChangeProposal(buildRecordPlanChangeProposalCommand(proposal, { commandId: "cmd-prop8" }))).status).toBe("committed");
      const decision = acceptedDecision(proposal);
      expect((await engine.recordUserDecision(buildRecordUserDecisionCommand(decision, { commandId: "cmd-dec8" }))).status).toBe("committed");
      const sourcePlan = await loadSourcePlan(ledger, proposal);
      const emptyDraft: NonNullable<ApplyPlanChangeCommand["payload"]["newPlanDraft"]> = {
        planId: P111_NEW_PLAN,
        planRevision: sourcePlan.planRevision + 1,
        objective,
        stages: sourcePlan.stages.map((s) => ({ ...s })),
        taskHierarchy: { parentOf: sourcePlan.taskHierarchy.parentOf.map((e) => ({ ...e })) },
        executionDag: { dependsOn: sourcePlan.executionDag.dependsOn.map((e) => ({ ...e, requires: { ...e.requires } })) },
        obligations: [],
      };
      const applyCmd = buildApplyPlanChangeCommand(proposal, decision, emptyDraft, { commandId: "cmd-apply-guards", expectedRevision: sourceGoal.revision });
      const before = await eventCount(ledger);
      const receipt = await engine.applyPlanChange(applyCmd);
      expect(receipt.status).toBe("rejected");
      if (receipt.status !== "rejected") return;
      expect(receipt.code).toBe("guards_failed");
      expect((receipt.issues ?? []).some((s) => s.includes("missing_required_obligation"))).toBe(true);
      expect(await eventCount(ledger)).toBe(before);
    });

    it("stale CAS -> revision_conflict, zero write", async () => {
      const { ledger, engine, sourceGoal } = await setupP111("proj-alpha");
      const proposal = proposalFor("proj-alpha");
      expect((await engine.recordPlanChangeProposal(buildRecordPlanChangeProposalCommand(proposal, { commandId: "cmd-prop9" }))).status).toBe("committed");
      const decision = acceptedDecision(proposal);
      expect((await engine.recordUserDecision(buildRecordUserDecisionCommand(decision, { commandId: "cmd-dec9" }))).status).toBe("committed");
      const sourcePlan = await loadSourcePlan(ledger, proposal);
      const draft = buildP111NewPlanDraft(sourcePlan, proposal.patch.patchDraft.obligationDeltas, proposal.patch.patchDraft.objective);
      const applyCmd = buildApplyPlanChangeCommand(proposal, decision, draft, { commandId: "cmd-apply-cas", expectedRevision: 99 });
      const before = await eventCount(ledger);
      const receipt = await engine.applyPlanChange(applyCmd);
      expect(receipt.status).toBe("rejected");
      if (receipt.status !== "rejected") return;
      expect(receipt.code).toBe("revision_conflict");
      expect(await eventCount(ledger)).toBe(before);
    });
  });

  describe("idempotency", () => {
    it("apply replay -> committed/replayed with the same eventIds & cursor", async () => {
      const { ledger, engine, sourceGoal } = await setupP111("proj-alpha");
      const proposal = proposalFor("proj-alpha");
      expect((await engine.recordPlanChangeProposal(buildRecordPlanChangeProposalCommand(proposal, { commandId: "cmd-prop10" }))).status).toBe("committed");
      const decision = acceptedDecision(proposal);
      expect((await engine.recordUserDecision(buildRecordUserDecisionCommand(decision, { commandId: "cmd-dec10" }))).status).toBe("committed");
      const sourcePlan = await loadSourcePlan(ledger, proposal);
      const draft = buildP111NewPlanDraft(sourcePlan, proposal.patch.patchDraft.obligationDeltas, proposal.patch.patchDraft.objective);
      const cmd = buildApplyPlanChangeCommand(proposal, decision, draft, { commandId: "cmd-apply-idem", expectedRevision: sourceGoal.revision });
      const first = await engine.applyPlanChange(cmd);
      expect(first.status).toBe("committed");
      if (first.status !== "committed") return;
      expect(first.replayed).toBe(false);
      const replay = await engine.applyPlanChange(cmd);
      expect(replay.status).toBe("committed");
      if (replay.status !== "committed") return;
      expect(replay.replayed).toBe(true);
      expect(replay.eventIds).toEqual(first.eventIds);
      expect(replay.commitCursor).toEqual(first.commitCursor);
      expect(replay.activePlanRef).toEqual(first.activePlanRef);
      expect(replay.goalRevision).toEqual(first.goalRevision);
    });

    it("record command replay -> committed/replayed; same identity diff payload -> idempotency_conflict", async () => {
      const { ledger, engine } = await setupP111("proj-alpha");
      const proposal = proposalFor("proj-alpha");
      const cmd = buildRecordPlanChangeProposalCommand(proposal, { commandId: "cmd-prop-replay" });
      const first = await engine.recordPlanChangeProposal(cmd);
      expect(first.status).toBe("committed");
      if (first.status !== "committed") return;
      const replay = await engine.recordPlanChangeProposal(cmd);
      expect(replay.status).toBe("committed");
      if (replay.status !== "committed") return;
      expect(replay.replayed).toBe(true);
      expect(replay.eventIds).toEqual(first.eventIds);
      expect(replay.commitCursor).toEqual(first.commitCursor);
      expect(replay.proposalRef).toEqual(first.proposalRef);

      const other = proposalFor("proj-alpha", { proposalId: "proposal-p111-2" });
      const conflict = buildRecordPlanChangeProposalCommand(other, { commandId: "cmd-prop-replay" });
      const second = await engine.recordPlanChangeProposal(conflict);
      expect(second).toEqual({ status: "rejected", commandId: "cmd-prop-replay", code: "idempotency_conflict" });
    });

    it("duplicate proposal id -> revision_conflict", async () => {
      const { ledger, engine } = await setupP111("proj-alpha");
      const proposal = proposalFor("proj-alpha");
      expect((await engine.recordPlanChangeProposal(buildRecordPlanChangeProposalCommand(proposal, { commandId: "cmd-prop-a" }))).status).toBe("committed");
      const dup = buildRecordPlanChangeProposalCommand(proposal, { commandId: "cmd-prop-b" });
      const receipt = await engine.recordPlanChangeProposal(dup);
      expect(receipt.status).toBe("rejected");
      if (receipt.status !== "rejected") return;
      expect(receipt.code).toBe("revision_conflict");
    });
  });

  describe("cross-project isolation", () => {
    it("same local ids under two projects never cross-talk", async () => {
      const alpha = await setupP111("proj-alpha");
      const beta = await setupP111("proj-beta");
      const propA = proposalFor("proj-alpha");
      const propB = proposalFor("proj-beta");
      expect((await alpha.engine.recordPlanChangeProposal(buildRecordPlanChangeProposalCommand(propA, { commandId: "alpha-prop" }))).status).toBe("committed");
      expect((await beta.engine.recordPlanChangeProposal(buildRecordPlanChangeProposalCommand(propB, { commandId: "beta-prop" }))).status).toBe("committed");
      expect(propA.proposalId).toBe(propB.proposalId);
      const aGoal = await alpha.ledger.load(p111GoalRef("proj-alpha"));
      const bGoal = await beta.ledger.load(p111GoalRef("proj-beta"));
      expect(aGoal.status).toBe("found");
      expect(bGoal.status).toBe("found");
      if (aGoal.status !== "found" || bGoal.status !== "found") return;
      expect((aGoal.snapshot as GoalSnapshot).activePlanRevision).toEqual(p111PlanRef(P111_SOURCE_PLAN, "proj-alpha"));
      expect((bGoal.snapshot as GoalSnapshot).activePlanRevision).toEqual(p111PlanRef(P111_SOURCE_PLAN, "proj-beta"));
    });
  });
});
