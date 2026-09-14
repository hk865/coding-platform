/**
 * P1-05 Goal phase reduction contracts — "required set -> deterministic Goal phase".
 *
 * Authority:
 *   - dev_docs/interfaces/completion-policy.md (§3 non-empty guards, §7
 *     ModuleProgress/StageProgress are projections only, §8 GoalCompletionGuard,
 *     §9 complete 10-level priority, §10 permission boundary, §11 conformance seam)
 *   - dev_docs/planning/proposed/P1-foundation/tickets/05-goal-phase-reduction.md
 *   - IMPLEMENTATION-HANDOFF.md "P1-05 契约与存储语义（冻结）"
 *
 * FROZEN semantics (integrator rulings, recorded in the handoff):
 *   - reduceGoalPhase is a PURE function (same canonical inputs -> same phase
 *     and explanation). The Control handler computes it from canonical state
 *     and commits the GoalPhase aggregate via a goal-reduction commit
 *     (full idempotency + CAS, one aggregate per (projectId, goalId)).
 *   - Goal phase is a CLOSED 10-value enum matching completion-policy §9
 *     exactly; the table is evaluated in that order and picks exactly ONE
 *     primary phase; lower-priority facts are attention flags in reasonCodes.
 *   - GoalCompletionGuard: active PlanRevision passes ALL §3 non-empty
 *     constraints AND every required work Task is SATISFIED AND every required
 *     AcceptanceObligation is satisfied AND every required ModuleGate /
 *     StageGate Task is SATISFIED AND the required GoalGateTask set is
 *     non-empty and all SATISFIED AND there is no unreconciled high-risk /
 *     outcome_unknown side effect. COMPLETED can ONLY come from this formula.
 *   - §3 rules: empty active plan / empty required GoalGateTask set / empty
 *     required obligation / empty required VerificationRequirement can NEVER
 *     prove completion. Optional work never blocks completion. required
 *     deferred / cancelled / blocked / failed never masquerade as completion.
 *   - parent_of edges, Module/Stage scope and completion ratios NEVER change
 *     the required set. ModuleProgress/StageProgress are projections only and
 *     are NEVER reducer inputs (no projection loop).
 *   - no-change can ONLY be expressed by an AlreadySatisfied required
 *     GoalGateTask proven by current applicable PASS evidence (a plan without
 *     a required active goal gate cannot complete).
 *   - Historical FAIL is preserved for audit; only the CURRENT applicable
 *     evidence set participates in the completion guard.
 *   - Decision (phase/reasonCodes) and explanation are SEPARATE: the reduction
 *     yields (phase, reasonCodes, refsByCode); GoalCompletionExplanation is
 *     rendered by a DETERMINISTIC template per reason code. Free narrative is
 *     T15, NOT this ticket.
 *   - Side effects are only IDENTIFIED / BLOCKING / RECORDED here — P1-05 has
 *     no disposal / authorization mechanism (P1-10 / P1-11 / P1-14).
 *   - Inputs are replaceable: this ticket uses plan enumeration + point reads;
 *     a future summarizer provider can replace them behind the same shape.
 */
import type { ActorRef, CommandFingerprint, CommandIdentity, CommitCursor } from "./command-event.js";
import { canonicalJson, sha256Hex } from "./fingerprint.js";
import type { PlanRevisionRef, PlanRevisionSnapshot, TaskKind, RequirementLevel, Disposition, Phase } from "./plan.js";
import type { RunRef } from "./dispatch.js";
import type { TaskReductionPhase } from "./reduction.js";

// ------------------------------------------------------------------------ //
// Goal phase (closed enum — completion-policy.md §9, exact one-to-one)     //
// ------------------------------------------------------------------------ //

export const GOAL_PHASES = [
  "CANCELLED",
  "CHANGE_PENDING",
  "PAUSED",
  "COMPLETED",
  "ACCEPTED_PARTIAL",
  "PLANNING",
  "RUNNING",
  "NEEDS_DECISION",
  "BLOCKED",
  "FAILED",
] as const;

export type GoalPhase = (typeof GOAL_PHASES)[number];

// ------------------------------------------------------------------------ //
// Deterministic reason codes (deciding + attention flags)                    //
// ------------------------------------------------------------------------ //

export type GoalPhaseReasonCode =
  | "cancel_decision_effective"
  | "change_pending"
  | "desired_state_paused"
  | "completion_guard_ok"
  | "partial_accept_decision_effective"
  | "no_active_plan_planning_available"
  | "required_frontier_available"
  | "required_deferred_or_cancelled"
  | "human_decision_required"
  | "unknown_side_effect_needs_decision"
  | "no_frontier_all_blocked"
  | "terminal_failure_exhausted"
  | "invariant_violation_fail_closed"
  | "guard_empty_plan"
  | "guard_empty_required_goal_gate"
  | "guard_empty_required_obligation"
  | "guard_empty_required_verification_requirement"
  | "guard_required_work_task_unsatisfied"
  | "guard_required_gate_task_unsatisfied"
  | "guard_required_obligation_unsatisfied"
  | "guard_unreconciled_side_effect"
  | "guard_not_current_plan"
  | "optional_task_not_satisfied"
  | "historical_fail_preserved"
  | "not_current_plan_task_ignored";

export const GOAL_PHASE_REASON_CODES: readonly GoalPhaseReasonCode[] = [
  "cancel_decision_effective",
  "change_pending",
  "desired_state_paused",
  "completion_guard_ok",
  "partial_accept_decision_effective",
  "no_active_plan_planning_available",
  "required_frontier_available",
  "required_deferred_or_cancelled",
  "human_decision_required",
  "unknown_side_effect_needs_decision",
  "no_frontier_all_blocked",
  "terminal_failure_exhausted",
  "invariant_violation_fail_closed",
  "guard_empty_plan",
  "guard_empty_required_goal_gate",
  "guard_empty_required_obligation",
  "guard_empty_required_verification_requirement",
  "guard_required_work_task_unsatisfied",
  "guard_required_gate_task_unsatisfied",
  "guard_required_obligation_unsatisfied",
  "guard_unreconciled_side_effect",
  "guard_not_current_plan",
  "optional_task_not_satisfied",
  "historical_fail_preserved",
  "not_current_plan_task_ignored",
];

// ------------------------------------------------------------------------ //
// Goal reduction input (fact snapshot — replaceable producer seam)          //
// ------------------------------------------------------------------------ //

/** Latest run fact of the task (null = never claimed). P1-05 has no retry /
 * redispatch, so an ENDED run means the task's own frontier cannot advance
 * without new work/authorization (side-effect decision). */
export type GoalTaskRunFact = {
  /** mirrors RunSnapshot.status (P1-03): starting | running | ended. */
  status: "starting" | "running" | "ended";
  outcome: import("./dispatch.js").RunOutcome | null;
  exitCode: number | null;
};

export type GoalTaskReductionFact = {
  taskId: string;
  taskKind: TaskKind;
  requirementLevel: RequirementLevel;
  disposition: Disposition;
  planPhase: Phase;
  reductionPhase: TaskReductionPhase | null;
  effectiveEvidenceIds: string[];
  reducedAt: string | null;
  runFact?: GoalTaskRunFact | null;
};

export type GoalObligationFact = {
  obligationId: string;
  requirementLevel: RequirementLevel;
  taskIds: string[];
  requiredRequirementIds: string[];
  coveredRequirementIds: string[];
  blockingEvidenceIds: string[];
  hasHistoricalFail: boolean;
  staleEvidenceIds: string[];
  outOfScopeEvidenceIds: string[];
};

export type GoalSideEffectFact = {
  kind: "outcome_unknown" | "high_risk";
  runRef: RunRef;
  note: string | null;
  /** reconciliation only — there is NO disposal path, so this is
   * always false until a later ticket authorizes disposal. */
  reconciled: boolean;
};

export type GoalDecisionFact = {
  kind: "cancel" | "partial_accept";
  decisionId: string;
  decidedAt: string;
  /** effective = current + Goal-scoped + Control-authorized. P1-05 has no
   * decision path, so every producer passes false; the priority table is
   * frozen for P1-11/P1-14. */
  effective: boolean;
  note: string | null;
  partialAcceptTargets?: string[];
};

export type GoalChangePendingFact = {
  changeId: string;
  note: string | null;
};

export type GoalDecisionNeedFact = {
  kind: "finding" | "subjective_oracle" | "contract_change";
  note: string | null;
};

export type GoalPlanningFact = {
  possible: boolean;
  failed: boolean;
  blockedReason: string | null;
};

export type GoalReductionInput = {
  schemaVersion: 1;
  projectId: string;
  goalId: string;
  /** null = no active PlanRevision yet. */
  plan: PlanRevisionSnapshot | null;
  /** must equal plan.ref when plan is present, else guard_not_current_plan. */
  goalActivePlanRevision: PlanRevisionRef | null;
  desiredState: "active" | "paused";
  taskReductions: GoalTaskReductionFact[];
  obligations: GoalObligationFact[];
  sideEffects: GoalSideEffectFact[];
  decisions: GoalDecisionFact[];
  changePending: GoalChangePendingFact | null;
  decisionNeeds: GoalDecisionNeedFact[];
  planning: GoalPlanningFact;
};

// ------------------------------------------------------------------------ //
// Side effect reconciliation (identify / block / record — no disposal)      //
// ------------------------------------------------------------------------ //

export type GoalSideEffectReconciliation = {
  identified: GoalSideEffectFact[];
  unreconciled: GoalSideEffectFact[];
};

// ------------------------------------------------------------------------ //
// GoalCompletionGuard (§3 + §8 — the ONLY path to COMPLETED)                //
// ------------------------------------------------------------------------ //

export type GoalCompletionGuardResult = {
  hold: boolean;
  brokenReasons: GoalPhaseReasonCode[];
  unsatisfiedRequiredTaskIds: string[];
  unsatisfiedRequiredObligationIds: string[];
  emptyGoalGate: boolean;
  requiredWorkTaskIds: string[];
  requiredGateTaskIds: string[];
  requiredGoalGateTaskIds: string[];
};

// ------------------------------------------------------------------------ //
// reduceGoalPhase — the deterministic 10-level priority table (PURE)        //
// ------------------------------------------------------------------------ //

export type GoalPhaseRefs = {
  taskIds?: string[];
  obligationIds?: string[];
  evidenceIds?: string[];
  runRefs?: string[];
  requirementIds?: string[];
  decisionIds?: string[];
};

export type GoalPhaseReduction = {
  phase: GoalPhase;
  completed: boolean;
  reasonCodes: GoalPhaseReasonCode[];
  refsByCode: Partial<Record<GoalPhaseReasonCode, GoalPhaseRefs>>;
  guard: GoalCompletionGuardResult | null;
  sideEffectReconciliation: GoalSideEffectReconciliation;
};

// ------------------------------------------------------------------------ //
// GoalCompletionExplanation — DETERMINISTIC template rendering               //
// ------------------------------------------------------------------------ //

export type GoalCompletionExplanationItem = {
  code: GoalPhaseReasonCode;
  message: string;
  refs: GoalPhaseRefs;
};

export type GoalCompletionExplanation = {
  schemaVersion: 1;
  phase: GoalPhase;
  headline: string;
  items: GoalCompletionExplanationItem[];
};

// ------------------------------------------------------------------------ //
// GoalPhase aggregate                                                        //
// ------------------------------------------------------------------------ //

export type GoalPhaseRef = {
  aggregateType: "GoalPhase";
  projectId: string;
  goalId: string;
};

export function goalPhaseRefFor(projectId: string, goalId: string): GoalPhaseRef {
  return { aggregateType: "GoalPhase", projectId, goalId };
}

export type GoalPhaseSnapshot = {
  ref: GoalPhaseRef;
  revision: number;
  schemaVersion: 1;
  planRef: PlanRevisionRef | null;
  previousPhase: GoalPhase | null;
  phase: GoalPhase;
  reasonCodes: GoalPhaseReasonCode[];
  explanation: GoalCompletionExplanation;
  sideEffectReconciliation: GoalSideEffectReconciliation;
  reducedAt: string;
};

// ------------------------------------------------------------------------ //
// Command / receipt                                                          //
// ------------------------------------------------------------------------ //

export type ReduceGoalCommand = {
  commandId: string;
  commandType: "ReduceGoal";
  schemaVersion: 1;
  identity: CommandIdentity;
  /** goalId — the GoalPhase aggregate. */
  aggregateId: string;
  /** GoalPhase CAS window (0 = first reduction). */
  expectedRevision: number;
  correlationId: string;
  submittedAt: string;
  payload: { goalId: string };
};

export type ReduceGoalRejectionCode =
  | "invalid"
  | "not_found"
  | "revision_conflict"
  | "idempotency_conflict"
  | "unavailable";

export type ReduceGoalReceipt =
  | {
      status: "committed";
      commandId: string;
      replayed: boolean;
      phaseRef: GoalPhaseRef;
      phase: GoalPhase;
      reasonCodes: GoalPhaseReasonCode[];
      eventIds: string[];
      commitCursor: CommitCursor;
    }
  | {
      status: "rejected";
      commandId: string;
      code: ReduceGoalRejectionCode;
      currentRevision?: number;
    };

export function reduceGoalFingerprint(command: ReduceGoalCommand): CommandFingerprint {
  const shape = {
    schemaVersion: command.schemaVersion,
    commandType: command.commandType,
    projectId: command.identity.projectId,
    aggregateId: command.aggregateId,
    expectedRevision: command.expectedRevision,
    payload: { goalId: command.payload.goalId },
  };
  return sha256Hex(canonicalJson(shape)) as CommandFingerprint;
}

// ------------------------------------------------------------------------ //
// Event (P1-05 v1)                                                           //
// ------------------------------------------------------------------------ //

export type GoalPhaseUpdatedEvent = {
  eventId: string;
  eventType: "GoalPhaseUpdated";
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: "GoalPhase";
  aggregateId: string;
  aggregateRevision: number;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: {
    goalId: string;
    previousPhase: GoalPhase | null;
    phase: GoalPhase;
    reasonCodes: GoalPhaseReasonCode[];
    explanation: GoalCompletionExplanation;
    sideEffectReconciliation: GoalSideEffectReconciliation;
    planRef: PlanRevisionRef | null;
    reducedAt: string;
  };
};
