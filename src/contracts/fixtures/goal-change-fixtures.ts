/** P1-11 shared fixtures: goal/plan-change scenario + builders + ledger folds. */
import type { CommandIdentity } from "../command-event.js";
import type {
  AmendGoalRequestV1,
  PlanPatchV1,
  ChangeImpactAnalysisV1,
  PlanProposalV1,
  PlanProposalSnapshot,
  UserDecisionV1,
  UserDecisionSnapshot,
  GoalRevisionV1,
  GoalRevisionSnapshot,
  PlanChangeViewQuery,
  RecordPlanChangeProposalCommand,
  RecordUserDecisionCommand,
  ApplyPlanChangeCommand,
} from "../goal-change.js";
import {
  decisionTargetFor,
  recordPlanChangeProposalFingerprint,
  recordUserDecisionFingerprint,
  applyPlanChangeFingerprint,
} from "../goal-change.js";
import type { PlanRevisionSnapshot, PlanRevisionRef } from "../plan.js";
import type { GoalRef, GoalSnapshot, PlanChangeProposalRecordLedgerCommitV1, UserDecisionRecordLedgerCommitV1, GoalChangeApplyLedgerCommitV1 } from "../ledger.js";
import type { ArchitectureBaselinePin, CompletionPolicyPin } from "../governance.js";
import type { ActorRef } from "../command-event.js";

export const P111_PROJECT = "proj-alpha";
export const P111_PROJECT_B = "proj-beta";
export const P111_WORKSPACE = "ws-shared"; // 与共享 bootstrap fixture 一致（canonical goal workspace；integrator 裁决 2026-09-07：声明字段与 canonical 一致，避免 P1-15 消费者坑）
export const P111_SCHEMA = "2026-09-06T00:00:00.000Z";
export const P111_GOAL = "goal-1";
export const P111_SOURCE_PLAN = "plan-mvp-1";
export const P111_NEW_PLAN = "plan-mvp-1-v2";
export const P111_PROPOSAL = "proposal-p111-1";
export const P111_DECISION = "decision-p111-1";
export const P111_ACTOR_USER: ActorRef = { kind: "human", id: "user-owner-1" };

export function p111GoalRef(projectId: string = P111_PROJECT): GoalRef {
  return { aggregateType: "Goal", projectId, goalId: P111_GOAL };
}
export function p111PlanRef(planId: string, projectId: string = P111_PROJECT): PlanRevisionRef {
  return { aggregateType: "PlanRevision", projectId, planId };
}
export function p111ProposalRef(proposalId: string = P111_PROPOSAL, projectId: string = P111_PROJECT): { aggregateType: "PlanProposal"; projectId: string; workspaceId: string; proposalId: string } {
  return { aggregateType: "PlanProposal", projectId, workspaceId: P111_WORKSPACE, proposalId };
}
export function p111DecisionRef(decisionId: string = P111_DECISION, projectId: string = P111_PROJECT): { aggregateType: "UserDecision"; projectId: string; workspaceId: string; decisionId: string } {
  return { aggregateType: "UserDecision", projectId, workspaceId: P111_WORKSPACE, decisionId };
}
export function p111RevisionRef(revision: number, projectId: string = P111_PROJECT): { aggregateType: "GoalRevision"; projectId: string; workspaceId: string; goalId: string; revision: number } {
  return { aggregateType: "GoalRevision", projectId, workspaceId: P111_WORKSPACE, goalId: P111_GOAL, revision };
}

// ------------------------------------------------------------------------ //
// Value builders                                                            //
// ------------------------------------------------------------------------ //

export function buildAmendGoalRequestV1(overrides: Partial<AmendGoalRequestV1> = {}): AmendGoalRequestV1 {
  return {
    schemaVersion: 1,
    requestId: "amend-request-" + P111_PROPOSAL,
    projectId: P111_PROJECT,
    workspaceId: P111_WORKSPACE,
    goalRef: p111GoalRef(),
    planRef: p111PlanRef(P111_SOURCE_PLAN),
    objectiveDelta: {
      kind: "change",
      newObjective: "P1-11 目标：在安全点暂停受影响子图并经授权后创建新 Plan/Goal revision（含可观察展示）",
      summary: "原目标 + 计划变更闭环",
    },
    obligationDeltas: [
      { obligationId: "obl-2", action: "change", newText: "Plan 变更经 Proposal/Decision/CAS 应用于新 revision（含受影响子图展示）", justification: "扩展验收" },
    ],
    requestedByRunRef: null,
    requestedBy: P111_ACTOR_USER,
    submittedAt: P111_SCHEMA,
    ...overrides,
  };
}

export function buildPlanPatchV1(overrides: Partial<PlanPatchV1> = {}): PlanPatchV1 {
  return {
    schemaVersion: 1,
    patchId: "patch-" + P111_PROPOSAL,
    projectId: P111_PROJECT,
    workspaceId: P111_WORKSPACE,
    goalRef: p111GoalRef(),
    sourcePlanRef: p111PlanRef(P111_SOURCE_PLAN),
    sourcePlanRevision: 1,
    patchDraft: {
      objective: "P1-11 目标：在安全点暂停受影响子图并经授权后创建新 Plan/Goal revision（含可观察展示）",
      obligationDeltas: [
        { obligationId: "obl-2", action: "change", newText: "Plan 变更经 Proposal/Decision/CAS 应用于新 revision（含受影响子图展示）", justification: "扩展验收" },
      ],
      taskHierarchy: null,
    },
    inScope: ["goal objective", "acceptance obligation obl-2", "affected task dispositions"],
    outOfScope: ["task set changes", "new domain modules", "dispatch semantics"],
    generatedAt: P111_SCHEMA,
    ...overrides,
  };
}

export function buildChangeImpactAnalysisV1(overrides: Partial<ChangeImpactAnalysisV1> = {}): ChangeImpactAnalysisV1 {
  return {
    schemaVersion: 1,
    analysisId: "impact-" + P111_PROPOSAL,
    patchRef: p111PlanRef(P111_SOURCE_PLAN),
    affectedWorks: [
      { workRef: { aggregateType: "WorkContextBinding", projectId: P111_PROJECT, workspaceId: P111_WORKSPACE, workId: "work-p111-1" }, refreshRequired: true, reason: "obl-2 task 映射变化" },
      { workRef: { aggregateType: "WorkContextBinding", projectId: P111_PROJECT, workspaceId: P111_WORKSPACE, workId: "work-p111-2" }, refreshRequired: false, reason: "独立子图不受影响" },
    ],
    staleAssumptions: [{ assumption: "Plan revision 1 是唯一活动 revision", reason: "将创建 revision 2" }],
    materialsToRefresh: ["planContext", "evidenceBindings"],
    independentWork: [{ workRef: { aggregateType: "WorkContextBinding", projectId: P111_PROJECT, workspaceId: P111_WORKSPACE, workId: "work-p111-2" }, reason: "独立子图可继续" }],
    generatedAt: P111_SCHEMA,
    ...overrides,
  };
}

export function buildPlanProposalV1(overrides: Partial<PlanProposalV1> = {}): PlanProposalV1 {
  const patch = buildPlanPatchV1(overrides.patch);
  return {
    schemaVersion: 1,
    proposalId: P111_PROPOSAL,
    projectId: P111_PROJECT,
    workspaceId: P111_WORKSPACE,
    sourceGoalRef: p111GoalRef(),
    sourcePlanRef: patch.sourcePlanRef,
    sourcePlanRevision: patch.sourcePlanRevision,
    patch,
    impact: buildChangeImpactAnalysisV1(overrides.impact),
    alternatives: [{ optionId: "alt-1", summary: "保持原目标仅阐明", impactDelta: "无义务变化" }],
    generatedAt: P111_SCHEMA,
    ...overrides,
  };
}

export function planProposalSnapshotFor(proposal: PlanProposalV1, recordedAt: string = P111_SCHEMA): PlanProposalSnapshot {
  return { ref: p111ProposalRef(proposal.proposalId, proposal.projectId), revision: 1, schemaVersion: 1, proposal, recordedAt };
}

export function buildUserDecisionV1(opts: { proposal: PlanProposalV1; outcome: UserDecisionV1["outcome"]; actor?: ActorRef; authority?: UserDecisionV1["authority"]; overrides?: Partial<UserDecisionV1> }): UserDecisionV1 {
  return {
    schemaVersion: 1,
    decisionId: P111_DECISION,
    projectId: P111_PROJECT,
    workspaceId: P111_WORKSPACE,
    proposalRef: p111ProposalRef(opts.proposal.proposalId, opts.proposal.projectId),
    subject: { goalRef: opts.proposal.sourceGoalRef, sourcePlanRef: opts.proposal.sourcePlanRef, sourcePlanRevision: opts.proposal.sourcePlanRevision },
    outcome: opts.outcome,
    actor: opts.actor ?? P111_ACTOR_USER,
    authority: opts.authority ?? { strategy: "user", delegator: null, policyVersion: "user-decision-policy@1" },
    authorizedTarget: decisionTargetFor(opts.proposal),
    summary: opts.outcome === "accept" ? "接受提案" : opts.outcome === "reject" ? "拒绝提案" : "延后决定",
    decidedAt: P111_SCHEMA,
    ...opts.overrides,
  };
}

export function userDecisionSnapshotFor(decision: UserDecisionV1, recordedAt: string = P111_SCHEMA): UserDecisionSnapshot {
  return { ref: p111DecisionRef(decision.decisionId, decision.projectId), revision: 1, schemaVersion: 1, decision, recordedAt };
}

export function buildGoalRevisionV1(opts: { goalRef: GoalRef; revision: number; activePlanRef: PlanRevisionRef; supersededPlanRefs: PlanRevisionRef[]; changedAt?: string; reason?: string }): GoalRevisionV1 {
  return {
    schemaVersion: 1,
    goalRef: opts.goalRef,
    revision: opts.revision,
    activePlanRef: opts.activePlanRef,
    supersededPlanRefs: opts.supersededPlanRefs,
    changedAt: opts.changedAt ?? P111_SCHEMA,
    reason: opts.reason ?? "用户接受计划变更提案",
  };
}

export function goalRevisionSnapshotFor(change: GoalRevisionV1, recordedAt: string = P111_SCHEMA): GoalRevisionSnapshot {
  return { ref: p111RevisionRef(change.revision, change.goalRef.projectId), revision: 1, schemaVersion: 1, change, recordedAt };
}

/** Deterministic new-revision snapshot (fold-equality target for Control). */
export function buildP111PlanRevisionSnapshot(
  draft: NonNullable<ApplyPlanChangeCommand["payload"]["newPlanDraft"]>,
  pins: { completionPolicy: CompletionPolicyPin; architectureBaseline: ArchitectureBaselinePin },
  acceptedAt: string,
  goalRef: GoalRef,
  newPlanRef: PlanRevisionRef,
  sourceTasks: PlanRevisionSnapshot["tasks"],
): PlanRevisionSnapshot {
  return {
    ref: newPlanRef,
    revision: 1,
    schemaVersion: 1,
    goalRef,
    planId: draft.planId,
    planRevision: draft.planRevision,
    acceptedAt,
    effectiveCompletionPolicy: pins.completionPolicy,
    effectiveArchitectureBaseline: pins.architectureBaseline,
    stages: draft.stages === null ? [] : draft.stages.map((s) => ({ ...s })),
    tasks: sourceTasks.map((t) => ({ ...t, scope: { ...t.scope } })),
    obligations: draft.obligations.map((o) => ({
      ...o,
      taskIds: [...o.taskIds],
      verificationRequirements: o.verificationRequirements.map((v) => ({ ...v })),
    })),
    taskHierarchy: draft.taskHierarchy === null ? { parentOf: [] } : { parentOf: draft.taskHierarchy.parentOf.map((e) => ({ ...e })) },
    executionDag: draft.executionDag === null ? { dependsOn: [] } : { dependsOn: draft.executionDag.dependsOn.map((e) => ({ ...e, requires: { ...e.requires } })) },
  };
}

/**
 * New-plan draft builder for fixtures: applies obligationDeltas to a source
 * plan snapshot (change: title only; remove: drop; add: new required
 * obligation cloning the first source obligation's taskIds + VRs) and keeps
 * tasks/stages/DAG/hierarchy identical to source.
 */
export function buildP111NewPlanDraft(
  source: PlanRevisionSnapshot,
  deltas: AmendGoalRequestV1["obligationDeltas"],
  objective: string,
): NonNullable<ApplyPlanChangeCommand["payload"]["newPlanDraft"]> {
  const byId = new Map(deltas.map((d) => [d.obligationId, d]));
  const obligations = source.obligations
    .filter((o) => byId.get(o.obligationId)?.action !== "remove")
    .map((o) => {
      const d = byId.get(o.obligationId);
      if (d?.action === "change") return { ...o, title: d.newText ?? o.title };
      return { ...o };
    });
  for (const d of deltas) {
    if (d.action === "add") {
      const defaultObl = source.obligations[0]!;
      obligations.push({
        obligationId: d.obligationId,
        title: d.newText ?? d.obligationId,
        requirementLevel: "required",
        taskIds: [...defaultObl.taskIds],
        verificationRequirements: defaultObl.verificationRequirements.map((v) => ({ ...v })),
      });
    }
  }
  return {
    planId: P111_NEW_PLAN,
    planRevision: source.planRevision + 1,
    objective,
    stages: source.stages.map((s) => ({ ...s })),
    taskHierarchy: { parentOf: source.taskHierarchy.parentOf.map((e) => ({ ...e })) },
    executionDag: { dependsOn: source.executionDag.dependsOn.map((e) => ({ ...e, requires: { ...e.requires } })) },
    obligations,
  };
}

export function buildRecordPlanChangeProposalCommand(proposal: PlanProposalV1, deps: { commandId: string; actor?: CommandIdentity["actor"] }): RecordPlanChangeProposalCommand {
  return {
    commandId: deps.commandId,
    commandType: "RecordPlanChangeProposal",
    schemaVersion: 1,
    identity: { projectId: proposal.projectId, actor: deps.actor ?? P111_ACTOR_USER, idempotencyKey: deps.commandId + "-idem" },
    aggregateId: proposal.proposalId,
    expectedRevision: 0,
    correlationId: deps.commandId + "-corr",
    submittedAt: P111_SCHEMA,
    payload: { proposal },
  };
}

export function buildRecordUserDecisionCommand(decision: UserDecisionV1, deps: { commandId: string; actor?: CommandIdentity["actor"] }): RecordUserDecisionCommand {
  return {
    commandId: deps.commandId,
    commandType: "RecordUserDecision",
    schemaVersion: 1,
    identity: { projectId: decision.projectId, actor: deps.actor ?? P111_ACTOR_USER, idempotencyKey: deps.commandId + "-idem" },
    aggregateId: decision.decisionId,
    expectedRevision: 0,
    correlationId: deps.commandId + "-corr",
    submittedAt: P111_SCHEMA,
    payload: { decision },
  };
}

export function buildApplyPlanChangeCommand(
  proposal: PlanProposalV1,
  decision: UserDecisionV1,
  newPlanDraft: NonNullable<ApplyPlanChangeCommand["payload"]["newPlanDraft"]>,
  deps: { commandId: string; expectedRevision: number; actor?: CommandIdentity["actor"] },
): ApplyPlanChangeCommand {
  return {
    commandId: deps.commandId,
    commandType: "ApplyPlanChange",
    schemaVersion: 1,
    identity: { projectId: proposal.projectId, actor: deps.actor ?? { kind: "system", id: "control-engine" }, idempotencyKey: deps.commandId + "-idem" },
    aggregateId: proposal.proposalId,
    expectedRevision: deps.expectedRevision,
    correlationId: deps.commandId + "-corr",
    submittedAt: P111_SCHEMA,
    payload: {
      decisionRef: p111DecisionRef(decision.decisionId, decision.projectId),
      proposalRef: p111ProposalRef(proposal.proposalId, proposal.projectId),
      newPlanDraft,
      changeReason: "user-decision-accepted",
    },
  };
}

// ------------------------------------------------------------------------ //
// Ledger fold builders (fold-equality targets; shared by BOTH adapters)     //
// ------------------------------------------------------------------------ //

export function buildPlanChangeProposalRecordCommit(command: RecordPlanChangeProposalCommand, deps: { eventId: string; occurredAt: string; recordedAt?: string }): PlanChangeProposalRecordLedgerCommitV1 {
  const proposal = command.payload.proposal;
  const snap = planProposalSnapshotFor(proposal, deps.recordedAt ?? deps.occurredAt);
  return {
    commitKind: "plan-change-proposal-record",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: recordPlanChangeProposalFingerprint(command),
    expectedVersions: [{ ref: snap.ref, revision: 0 }],
    events: [{
      eventId: deps.eventId,
      eventType: "PlanProposalRecorded",
      schemaVersion: 1,
      projectId: proposal.projectId,
      workspaceId: proposal.workspaceId,
      aggregateType: "PlanProposal",
      aggregateId: proposal.proposalId,
      aggregateRevision: 1,
      causationId: command.commandId,
      correlationId: command.correlationId,
      idempotencyKey: command.identity.idempotencyKey,
      actor: { ...command.identity.actor },
      occurredAt: deps.occurredAt,
      payload: { proposal, recordedAt: deps.recordedAt ?? deps.occurredAt },
    }],
    snapshots: [snap],
    outboxIntents: [],
  };
}

export function buildUserDecisionRecordCommit(command: RecordUserDecisionCommand, deps: { eventId: string; occurredAt: string; recordedAt?: string }): UserDecisionRecordLedgerCommitV1 {
  const decision = command.payload.decision;
  const snap = userDecisionSnapshotFor(decision, deps.recordedAt ?? deps.occurredAt);
  return {
    commitKind: "user-decision-record",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: recordUserDecisionFingerprint(command),
    expectedVersions: [{ ref: snap.ref, revision: 0 }],
    events: [{
      eventId: deps.eventId,
      eventType: "UserDecisionRecorded",
      schemaVersion: 1,
      projectId: decision.projectId,
      workspaceId: decision.workspaceId,
      aggregateType: "UserDecision",
      aggregateId: decision.decisionId,
      aggregateRevision: 1,
      causationId: command.commandId,
      correlationId: command.correlationId,
      idempotencyKey: command.identity.idempotencyKey,
      actor: { ...command.identity.actor },
      occurredAt: deps.occurredAt,
      payload: { decision, recordedAt: deps.recordedAt ?? deps.occurredAt },
    }],
    snapshots: [snap],
    outboxIntents: [],
  };
}

export function buildGoalChangeApplyCommit(
  command: ApplyPlanChangeCommand,
  deps: {
    eventId: string;
    occurredAt: string;
    changedAt: string;
    pins: { completionPolicy: CompletionPolicyPin; architectureBaseline: ArchitectureBaselinePin };
    sourcePlan: PlanRevisionSnapshot;
    newPlanDraft: NonNullable<ApplyPlanChangeCommand["payload"]["newPlanDraft"]>;
    baseGoal: GoalSnapshot;
  },
): GoalChangeApplyLedgerCommitV1 {
  const proposalRef = command.payload.proposalRef;
  const decisionRef = command.payload.decisionRef;
  const newPlan = buildP111PlanRevisionSnapshot(
    deps.newPlanDraft,
    deps.pins,
    deps.changedAt,
    p111GoalRef(proposalRef.projectId),
    p111PlanRef(deps.newPlanDraft.planId, proposalRef.projectId),
    deps.sourcePlan.tasks,
  );
  const goalSnapshot: GoalSnapshot = {
    ...deps.baseGoal,
    activePlanRevision: newPlan.ref,
    revision: deps.baseGoal.revision + 1,
  };
  const revChange = buildGoalRevisionV1({
    goalRef: p111GoalRef(proposalRef.projectId),
    revision: goalSnapshot.revision,
    activePlanRef: newPlan.ref,
    supersededPlanRefs: [deps.sourcePlan.ref],
    changedAt: deps.changedAt,
    reason: "user-decision-accepted",
  });
  const goalRevisionSnap = goalRevisionSnapshotFor(revChange, deps.changedAt);
  const eventBase = {
    schemaVersion: 1 as const,
    projectId: proposalRef.projectId,
    workspaceId: proposalRef.workspaceId,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: { ...command.identity.actor },
    occurredAt: deps.occurredAt,
  };
  return {
    commitKind: "goal-change-apply",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: applyPlanChangeFingerprint(command),
    expectedVersions: [
      { ref: p111GoalRef(proposalRef.projectId), revision: deps.baseGoal.revision },
      { ref: newPlan.ref, revision: 0 },
    ],
    events: [
      {
        ...eventBase,
        eventId: deps.eventId,
        eventType: "PlanRevisionAccepted",
        aggregateType: "PlanRevision",
        aggregateId: newPlan.planId,
        aggregateRevision: 1,
        payload: { goalId: P111_GOAL, goalAggregateRevision: goalSnapshot.revision, planRevision: newPlan },
      },
      {
        ...eventBase,
        eventId: deps.eventId + "-supersede",
        eventType: "PlanRevisionSuperseded",
        aggregateType: "PlanRevision",
        aggregateId: deps.sourcePlan.ref.planId,
        aggregateRevision: 2,
        payload: { supersededRef: deps.sourcePlan.ref, activeRef: newPlan.ref, decisionRef, changedAt: deps.changedAt },
      },
      {
        ...eventBase,
        eventId: deps.eventId + "-revision",
        eventType: "GoalRevisionRecorded",
        aggregateType: "GoalRevision",
        aggregateId: `${P111_GOAL}@${goalSnapshot.revision}`,
        aggregateRevision: 1,
        payload: { change: revChange, recordedAt: deps.changedAt },
      },
    ],
    snapshots: [newPlan, goalRevisionSnap, goalSnapshot],
    outboxIntents: [],
  };
}

export function planChangeViewQueryFor(projectId: string = P111_PROJECT): PlanChangeViewQuery {
  return { projectId, workspaceId: P111_WORKSPACE, goalId: P111_GOAL };
}
