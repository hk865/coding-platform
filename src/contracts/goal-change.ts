/**
 * P1-11 Goal/Plan change contracts — AmendGoalRequest / PlanProposal /
 * PlanPatch / ChangeImpactAnalysis / UserDecision / GoalRevision /
 * PlanRevisionSupersededEvent (first consumer freeze of
 * HumanCollaboration.GoalChangePort, PlanCompiler.PlanProposalPort,
 * ContextCompiler.PlanningContextPort).
 *
 * Authority:
 *   - dev_docs/planning/proposed/P1-foundation/tickets/11-goal-plan-change-revision.md
 *     (Acceptance incl. 2026-09-06: affected-context refresh; decision
 *      authority; revision CAS; evidence applicability recompute via new
 *      binding; versioned planning interfaces)
 *   - ARCHITECTURE.md invariants #1 (Planner proposes; Control accepts),
 *     #6 (revision+source bindings), #8/#9 (required sets non-empty)
 *
 * FROZEN semantics:
 *   - AmendGoalRequest is bounded and NEVER mutates: it names the goal and
 *     the requested objective/obligation DELTA (add/change/remove with
 *     in-scope justification). A plan change request is explicit.
 *   - PlanCompiler produces a BOUNDED proposal/patch + impact analysis
 *     (affected work context refs + refresh/recompute requirements + stale
 *     assumptions). Compilers never mutate canonical state.
 *   - user Decision: subject/outcome(accept|reject|defer)/actor/authority/
 *     authorizedTarget EXACT match is required — reject/defer/unauthorized
 *     never changes the active revision (zero write).
 *   - applyPlanChange: ONLY an accepted decision whose authorized target
 *     matches the proposal source + a CAS on the Goal @expectedRevision and
 *     PlanRevision @0 creates/activates the NEW revision through the P1-02
 *     guard path (required sets re-validated); the OLD revision and FAILs are
 *     preserved; Evidence applicability recomputes through the NEW binding
 *     anchor (P1-04 anchoring at the new planRevision).
 *   - Display: which tasks keep/cancel/replace/re-verify/resume.
 */
import type { ActorRef, CommandFingerprint, CommandIdentity, CommitCursor } from "./command-event.js";
import { canonicalJson, sha256Hex } from "./fingerprint.js";
import type { PlanRevisionRef, AcceptanceObligation, TaskHierarchy, PlanStage, RuntimeExecutionDAG } from "./plan.js";
import type { GoalRef } from "./ledger.js";
import type { WorkContextRef } from "./context-continuity.js";

export const PLAN_CHANGE_MAX_OBLIGATION_DELTAS = 64;
export const PLAN_CHANGE_MAX_AFFECTED_WORKS = 64;
export const PLAN_CHANGE_MAX_REASONS = 16;
export const PLAN_CHANGE_PROPOSAL_MAX_BYTES = 32 * 1024;
export const PLAN_CHANGE_DECISION_SUMMARY_MAX_BYTES = 4096;

// ------------------------------------------------------------------------ //
// Requests and value types                                                   //
// ------------------------------------------------------------------------ //

export type AmendGoalRequestV1 = {
  schemaVersion: 1;
  requestId: string;
  projectId: string;
  workspaceId: string;
  goalRef: GoalRef;
  /** Optional: a plan change (tasks/hierarchy) instead of a goal change. */
  planRef: PlanRevisionRef | null;
  /** The requested objective/obligation DELTA (bounded; never raw rewrite). */
  objectiveDelta: {
    kind: "change" | "clarify" | "restore";
    newObjective: string | null;
    summary: string;
  } | null;
  obligationDeltas: {
    obligationId: string;
    action: "add" | "change" | "remove";
    newText: string | null;
    justification: string;
  }[];
  requestedByRunRef: import("./dispatch.js").RunRef | null;
  requestedBy: ActorRef;
  submittedAt: string;
};

export type PlanPatchV1 = {
  schemaVersion: 1;
  patchId: string;
  projectId: string;
  workspaceId: string;
  goalRef: GoalRef;
  sourcePlanRef: PlanRevisionRef;
  sourcePlanRevision: number;
  patchDraft: {
    objective: string;
    obligationDeltas: AmendGoalRequestV1["obligationDeltas"];
    taskHierarchy: TaskHierarchy | null;
  };
  inScope: string[];
  outOfScope: string[];
  generatedAt: string;
};

export type ChangeImpactAnalysisV1 = {
  schemaVersion: 1;
  analysisId: string;
  patchRef: import("./plan.js").PlanRevisionRef | null;
  affectedWorks: { workRef: WorkContextRef; refreshRequired: boolean; reason: string }[];
  staleAssumptions: { assumption: string; reason: string }[];
  materialsToRefresh: string[];
  independentWork: { workRef: WorkContextRef; reason: string }[];
  generatedAt: string;
};

export type PlanProposalV1 = {
  schemaVersion: 1;
  proposalId: string;
  projectId: string;
  workspaceId: string;
  sourceGoalRef: GoalRef;
  sourcePlanRef: PlanRevisionRef;
  sourcePlanRevision: number;
  patch: PlanPatchV1;
  impact: ChangeImpactAnalysisV1;
  alternatives: { optionId: string; summary: string; impactDelta: string }[];
  generatedAt: string;
};

export type PlanProposalSnapshot = {
  ref: { aggregateType: "PlanProposal"; projectId: string; workspaceId: string; proposalId: string };
  revision: 1;
  schemaVersion: 1;
  proposal: PlanProposalV1;
  recordedAt: string;
};

export type UserDecisionOutcome = "accept" | "reject" | "defer";

export type UserDecisionV1 = {
  schemaVersion: 1;
  decisionId: string;
  projectId: string;
  workspaceId: string;
  proposalRef: { aggregateType: "PlanProposal"; projectId: string; workspaceId: string; proposalId: string };
  subject: { goalRef: GoalRef; sourcePlanRef: PlanRevisionRef; sourcePlanRevision: number };
  outcome: UserDecisionOutcome;
  actor: ActorRef;
  authority: { strategy: "user" | "delegated"; delegator: string | null; policyVersion: string };
  authorizedTarget: { goalId: string; newObjective: string | null; sourcePlanDigest: string };
  summary: string | null;
  decidedAt: string;
};

export type UserDecisionSnapshot = {
  ref: { aggregateType: "UserDecision"; projectId: string; workspaceId: string; decisionId: string };
  revision: 1;
  schemaVersion: 1;
  decision: UserDecisionV1;
  recordedAt: string;
};

export type GoalRevisionV1 = {
  schemaVersion: 1;
  goalRef: GoalRef;
  revision: number;
  activePlanRef: PlanRevisionRef;
  supersededPlanRefs: PlanRevisionRef[];
  changedAt: string;
  reason: string;
};

export type GoalRevisionSnapshot = {
  ref: { aggregateType: "GoalRevision"; projectId: string; workspaceId: string; goalId: string; revision: number };
  revision: 1;
  schemaVersion: 1;
  change: GoalRevisionV1;
  recordedAt: string;
};

export type PlanProposalRecordedEvent = {
  eventId: string;
  eventType: "PlanProposalRecorded";
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: "PlanProposal";
  aggregateId: string;
  aggregateRevision: 1;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: { proposal: PlanProposalV1; recordedAt: string };
};

export type UserDecisionRecordedEvent = {
  eventId: string;
  eventType: "UserDecisionRecorded";
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: "UserDecision";
  aggregateId: string;
  aggregateRevision: 1;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: { decision: UserDecisionV1; recordedAt: string };
};

export type GoalRevisionRecordedEvent = {
  eventId: string;
  eventType: "GoalRevisionRecorded";
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: "GoalRevision";
  aggregateId: string;
  aggregateRevision: 1;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: { change: GoalRevisionV1; recordedAt: string };
};

export type PlanRevisionSupersededEvent = {
  eventId: string;
  eventType: "PlanRevisionSuperseded";
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: "PlanRevision";
  aggregateId: string;
  aggregateRevision: number;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: {
    supersededRef: PlanRevisionRef;
    activeRef: PlanRevisionRef;
    decisionRef: { aggregateType: "UserDecision"; projectId: string; workspaceId: string; decisionId: string };
    changedAt: string;
  };
};

export function recordPlanChangeProposalFingerprint(command: RecordPlanChangeProposalCommand): CommandFingerprint {
  return sha256Hex(canonicalJson({ schemaVersion: 1, commandType: command.commandType, projectId: command.identity.projectId, aggregateId: command.aggregateId, expectedRevision: command.expectedRevision, payload: { proposal: command.payload.proposal } })) as CommandFingerprint;
}

export function recordUserDecisionFingerprint(command: RecordUserDecisionCommand): CommandFingerprint {
  return sha256Hex(canonicalJson({ schemaVersion: 1, commandType: command.commandType, projectId: command.identity.projectId, aggregateId: command.aggregateId, expectedRevision: command.expectedRevision, payload: { decision: command.payload.decision } })) as CommandFingerprint;
}

export function applyPlanChangeFingerprint(command: ApplyPlanChangeCommand): CommandFingerprint {
  return sha256Hex(canonicalJson({ schemaVersion: 1, commandType: command.commandType, projectId: command.identity.projectId, aggregateId: command.aggregateId, expectedRevision: command.expectedRevision, payload: { decisionRef: command.payload.decisionRef, proposalRef: command.payload.proposalRef, changeReason: command.payload.changeReason } })) as CommandFingerprint;
}

export type RecordPlanChangeProposalCommand = {
  commandId: string;
  commandType: "RecordPlanChangeProposal";
  schemaVersion: 1;
  identity: CommandIdentity;
  aggregateId: string;
  expectedRevision: 0;
  correlationId: string;
  submittedAt: string;
  payload: { proposal: PlanProposalV1 };
};

export type RecordUserDecisionCommand = {
  commandId: string;
  commandType: "RecordUserDecision";
  schemaVersion: 1;
  identity: CommandIdentity;
  aggregateId: string;
  expectedRevision: 0;
  correlationId: string;
  submittedAt: string;
  payload: { decision: UserDecisionV1 };
};

export type ApplyPlanChangeCommand = {
  commandId: string;
  commandType: "ApplyPlanChange";
  schemaVersion: 1;
  identity: CommandIdentity;
  aggregateId: string;
  expectedRevision: number;
  correlationId: string;
  submittedAt: string;
  payload: {
    decisionRef: { aggregateType: "UserDecision"; projectId: string; workspaceId: string; decisionId: string };
    proposalRef: { aggregateType: "PlanProposal"; projectId: string; workspaceId: string; proposalId: string };
    /** The NEW PlanRevision draft (P1-02 guards re-run on it). */
    newPlanDraft: {
      planId: string;
      planRevision: number;
      objective: string;
      stages: PlanStage[] | null;
      taskHierarchy: TaskHierarchy | null;
      executionDag: RuntimeExecutionDAG | null;
      obligations: AcceptanceObligation[];
    } | null;
    changeReason: string;
  };
};

export type RecordPlanChangeProposalRejectionCode = "invalid" | "not_found" | "revision_conflict" | "idempotency_conflict" | "unavailable";
export type RecordPlanChangeProposalReceipt =
  | { status: "committed"; commandId: string; replayed: boolean; proposalRef: PlanProposalSnapshot["ref"]; eventIds: string[]; commitCursor: CommitCursor }
  | { status: "rejected"; commandId: string; code: RecordPlanChangeProposalRejectionCode; issues?: string[] };

export type RecordUserDecisionRejectionCode = "invalid" | "not_found" | "proposal_not_found" | "revision_conflict" | "idempotency_conflict" | "unavailable";
export type RecordUserDecisionReceipt =
  | { status: "committed"; commandId: string; replayed: boolean; decisionRef: UserDecisionSnapshot["ref"]; eventIds: string[]; commitCursor: CommitCursor }
  | { status: "rejected"; commandId: string; code: RecordUserDecisionRejectionCode; issues?: string[] };

export type ApplyPlanChangeRejectionCode =
  | "invalid" | "not_found" | "proposal_not_found" | "decision_not_found" | "decision_not_accepted"
  | "decision_target_mismatch" | "draft_mismatch" | "source_stale" | "guards_failed" | "revision_conflict" | "idempotency_conflict" | "unavailable";
export type ApplyPlanChangeReceipt =
  | { status: "committed"; commandId: string; replayed: boolean; goalRevision: GoalRevisionSnapshot["ref"]; activePlanRef: PlanRevisionRef; eventIds: string[]; commitCursor: CommitCursor }
  | { status: "rejected"; commandId: string; code: ApplyPlanChangeRejectionCode; issues?: string[] };

// ------------------------------------------------------------------------ //
// Ports (interfaces_to_freeze)                                              //
// ------------------------------------------------------------------------ //

export interface PlanProposalPort {
  /** Deterministic bounded proposal + impact analysis (never mutates). */
  request(intent: AmendGoalRequestV1): Promise<{ status: "proposal"; proposal: PlanProposalV1 } | { status: "needs_material"; gaps: string[] } | { status: "rejected"; code: string; message: string }>;
}

export interface PlanningContextPort {
  assemblePlanningContext(request: { schemaVersion: 1; requestId: string; projectId: string; workspaceId: string; goalRef: GoalRef; planRef: PlanRevisionRef | null; budget: { maxBundleBytes: number } }): Promise<
    | { status: "ready"; bundleRef: import("./artifact.js").ArtifactRef; manifest: { selectedSources: string[]; freshnessCursor: CommitCursor | null; totalBytes: number } }
    | { status: "needs_material"; gaps: string[] }
    | { status: "rejected"; code: "invalid_request" | "forbidden_tool_or_scope" | "unavailable"; message: string }
  >;
}

export interface GoalChangePort {
  amend(request: AmendGoalRequestV1): Promise<{ status: "accepted"; proposalRef: PlanProposalSnapshot["ref"] } | { status: "rejected"; code: string; message: string }>;
  decide(command: RecordUserDecisionCommand): Promise<RecordUserDecisionReceipt>;
  applyChange(command: ApplyPlanChangeCommand): Promise<ApplyPlanChangeReceipt>;
}
// ------------------------------------------------------------------------ //
// Pure helpers (P1-11 frozen): digest / target / consistency / dispositions //
// — deterministic, no state access, no writes.                              //
// ------------------------------------------------------------------------ //

/** Full-scope key for the plan-change view ((projectId, workspaceId, goalId)). */
export function planChangeScopeKey(query: { projectId: string; workspaceId: string; goalId: string }): string {
  return canonicalJson({ aggregateType: "PlanChangeView", projectId: query.projectId, workspaceId: query.workspaceId, goalId: query.goalId });
}

/**
 * Deterministic proposal digest over the CHANGE semantics (source refs +
 * patch + impact). Excludes proposalId/generatedAt (record-time volatile);
 * includes sourcePlanRevision so a rebuild of the same plan yields the same
 * digest while a NEW source revision yields a different one.
 */
export function planProposalDigest(proposal: PlanProposalV1): string {
  return sha256Hex(canonicalJson({
    projectId: proposal.projectId,
    workspaceId: proposal.workspaceId,
    sourceGoalRef: proposal.sourceGoalRef,
    sourcePlanRef: proposal.sourcePlanRef,
    sourcePlanRevision: proposal.sourcePlanRevision,
    patch: proposal.patch,
    impact: proposal.impact,
  })) as string;
}

/** The authoritative target a user decision must carry for THIS proposal. */
export function decisionTargetFor(proposal: PlanProposalV1): UserDecisionV1["authorizedTarget"] {
  return {
    goalId: proposal.sourceGoalRef.goalId,
    newObjective: proposal.patch.patchDraft.objective,
    sourcePlanDigest: planProposalDigest(proposal),
  };
}

export type TaskChangeDisposition = "keep" | "cancel" | "replace" | "reverify" | "resume";

export type TaskDispositionRow = {
  taskId: string;
  disposition: TaskChangeDisposition;
  sourcePlanRef: PlanRevisionRef;
  targetPlanRef: PlanRevisionRef;
  replacedByTaskId: string | null;
  obligationSignatureChanged: boolean;
  reason: string;
};

/** Deterministic per-task obligation/VR signature within one plan snapshot. */
function obligationSignatureFor(plan: import("./plan.js").PlanRevisionSnapshot, taskId: string): string {
  const mapped = plan.obligations
    .filter((o) => o.taskIds.includes(taskId))
    .map((o) => ({
      obligationId: o.obligationId,
      title: o.title,
      requirementLevel: o.requirementLevel,
      taskIds: o.taskIds,
      verificationRequirements: o.verificationRequirements.map((v) => ({ requirementId: v.requirementId, requirementLevel: v.requirementLevel, kind: v.kind, description: v.description })),
    }))
    .sort((a, b) => (a.obligationId < b.obligationId ? -1 : a.obligationId > b.obligationId ? 1 : 0));
  return canonicalJson(mapped);
}

/**
 * Pure disposition computation: which Tasks keep / cancel / replace /
 * reverify / resume when the active plan revision changes.
 */
export function computeTaskDispositions(
  source: import("./plan.js").PlanRevisionSnapshot,
  target: import("./plan.js").PlanRevisionSnapshot,
  pausedTaskIds: string[],
): TaskDispositionRow[] {
  const targetById = new Map(target.tasks.map((t) => [t.taskId, t]));
  const paused = new Set(pausedTaskIds);
  const signatureCache = new Map<string, string>();
  const sourcePlanId = source.ref.planId;
  const targetPlanId = target.ref.planId;
  const signatureFor = (plan: import("./plan.js").PlanRevisionSnapshot, keyId: string, taskId: string): string => {
    let s = signatureCache.get(keyId + "@" + taskId);
    if (s === undefined) {
      s = obligationSignatureFor(plan, taskId);
      signatureCache.set(keyId + "@" + taskId, s);
    }
    return s;
  };
  const rows: TaskDispositionRow[] = [];
  for (const task of source.tasks) {
    if (!targetById.has(task.taskId)) {
      const candidates = target.tasks
        .filter((t) => t.taskKind === task.taskKind && t.phase === task.phase && t.requirementLevel === task.requirementLevel && t.scope.kind === task.scope.kind)
        .map((t) => t.taskId);
      if (candidates.length === 1) {
        rows.push({ taskId: task.taskId, disposition: "replace", sourcePlanRef: source.ref, targetPlanRef: target.ref, replacedByTaskId: candidates[0]!, obligationSignatureChanged: true, reason: `replaced by task ${candidates[0]} (same ${task.taskKind}/${task.phase} key)` });
      } else {
        rows.push({ taskId: task.taskId, disposition: "cancel", sourcePlanRef: source.ref, targetPlanRef: target.ref, replacedByTaskId: null, obligationSignatureChanged: true, reason: "removed by the plan change; no unique replacement" });
      }
      continue;
    }
    const changed = signatureFor(source, sourcePlanId, task.taskId) !== signatureFor(target, targetPlanId, task.taskId);
    if (changed) {
      rows.push({ taskId: task.taskId, disposition: "reverify", sourcePlanRef: source.ref, targetPlanRef: target.ref, replacedByTaskId: null, obligationSignatureChanged: true, reason: "obligation(s)/verification requirement(s) changed — evidence must be re-verified" });
    } else if (paused.has(task.taskId)) {
      rows.push({ taskId: task.taskId, disposition: "resume", sourcePlanRef: source.ref, targetPlanRef: target.ref, replacedByTaskId: null, obligationSignatureChanged: false, reason: "task unchanged and was paused at a safe point — may resume" });
    } else {
      rows.push({ taskId: task.taskId, disposition: "keep", sourcePlanRef: source.ref, targetPlanRef: target.ref, replacedByTaskId: null, obligationSignatureChanged: false, reason: "task and obligations unchanged" });
    }
  }
  return rows;
}

/**
 * Draft-consistency guard (pure): the new plan draft an ACCEPTED decision
 * bounds must exactly reflect the approved proposal/patch.
 */
export function draftConsistencyIssues(
  proposal: PlanProposalV1,
  decision: UserDecisionV1,
  draft: NonNullable<ApplyPlanChangeCommand["payload"]["newPlanDraft"]>,
  source: import("./plan.js").PlanRevisionSnapshot,
): string[] {
  const issues: string[] = [];
  if (draft.objective !== decision.authorizedTarget.newObjective) {
    issues.push("objective does not match the decision authorized target");
  }
  if (draft.objective !== proposal.patch.patchDraft.objective) {
    issues.push("objective does not match the proposal patch objective");
  }
  if (draft.planRevision !== proposal.sourcePlanRevision + 1) {
    issues.push(`planRevision ${draft.planRevision} != source ${proposal.sourcePlanRevision} + 1`);
  }
  const deltaById = new Map(proposal.patch.patchDraft.obligationDeltas.map((d) => [d.obligationId, d]));
  const sourceObById = new Map(source.obligations.map((o) => [o.obligationId, o]));
  const targetObById = new Map(draft.obligations.map((o) => [o.obligationId, o]));
  for (const o of source.obligations) {
    const delta = deltaById.get(o.obligationId);
    if (delta === undefined) {
      const t = targetObById.get(o.obligationId);
      if (t === undefined || canonicalJson(t) !== canonicalJson(o)) {
        issues.push(`obligation ${o.obligationId}: untouched obligation must be unchanged`);
      }
    } else if (delta.action === "remove") {
      if (targetObById.has(o.obligationId)) {
        issues.push(`obligation ${o.obligationId}: remove delta but obligation still present`);
      }
    } else if (delta.action === "change") {
      const t = targetObById.get(o.obligationId);
      if (t === undefined) {
        issues.push(`obligation ${o.obligationId}: change delta but obligation absent`);
      } else {
        const expected = { ...o, title: delta.newText ?? o.title };
        if (canonicalJson(t) !== canonicalJson(expected)) {
          issues.push(`obligation ${o.obligationId}: change delta allows only a title change`);
        }
      }
    } else if (delta.action === "add") {
      if (sourceObById.has(o.obligationId)) {
        issues.push(`obligation ${o.obligationId}: add delta but obligation already exists in source`);
      }
    }
  }
  for (const d of proposal.patch.patchDraft.obligationDeltas) {
    if (d.action === "add") {
      const t = targetObById.get(d.obligationId);
      if (sourceObById.has(d.obligationId)) {
        issues.push(`obligation ${d.obligationId}: add delta but obligation exists in source`);
      } else if (t === undefined || t.title !== d.newText) {
        issues.push(`obligation ${d.obligationId}: add delta requires a new obligation with title == delta.newText`);
      }
    }
  }
  // The plan-change draft has NO task list: the task set is inherited from
  // the source revision. Ref checks run against the SOURCE task set.
  const sourceTaskById = new Map(source.tasks.map((t) => [t.taskId, t]));
  if (draft.taskHierarchy !== null && draft.taskHierarchy !== undefined) {
    for (const e of draft.taskHierarchy.parentOf) {
      if (!sourceTaskById.has(e.parentTaskId) || !sourceTaskById.has(e.childTaskId)) {
        issues.push(`hierarchy edge ${e.parentTaskId}->${e.childTaskId}: dangling task ref`);
      }
    }
  }
  if (draft.executionDag !== null && draft.executionDag !== undefined) {
    for (const e of draft.executionDag.dependsOn) {
      if (!sourceTaskById.has(e.taskId) || !sourceTaskById.has(e.dependsOnId)) {
        issues.push(`dag edge ${e.taskId}->${e.dependsOnId}: dangling task ref`);
      }
    }
  }
  if (draft.stages !== null && draft.stages !== undefined) {
    const stageIds = new Set(draft.stages.map((s) => s.stageId));
    for (const t of source.tasks) {
      if (t.stageId !== undefined && !stageIds.has(t.stageId)) {
        issues.push(`task ${t.taskId}: dangling stage ref ${t.stageId}`);
      }
    }
  }
  return issues;
}

// ------------------------------------------------------------------------ //
// Plan-change read view (ReadModelIndex.planChangeView)                     //
// ------------------------------------------------------------------------ //

export type PlanChangeViewQuery = { projectId: string; workspaceId: string; goalId: string };

export type PlanChangeViewResult =
  | {
      status: "ready";
      proposals: PlanProposalSnapshot[];
      decisions: UserDecisionSnapshot[];
      revisions: GoalRevisionSnapshot[];
      dispositions: TaskDispositionRow[];
      freshness: CommitCursor | null;
    }
  | { status: "not_found" };

