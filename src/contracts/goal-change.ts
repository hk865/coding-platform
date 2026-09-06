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
  | "decision_target_mismatch" | "source_stale" | "guards_failed" | "revision_conflict" | "idempotency_conflict" | "unavailable";
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
