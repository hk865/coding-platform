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
  status: "starting" | "started" | "ended";
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
  /** P1-05: reconciliation only — there is NO disposal path, so this is
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

export function reconcileGoalSideEffects(
  sideEffects: GoalSideEffectFact[],
): GoalSideEffectReconciliation {
  return {
    identified: sideEffects.map((s) => ({ ...s, runRef: { ...s.runRef } })),
    unreconciled: sideEffects
      .filter((s) => !s.reconciled)
      .map((s) => ({ ...s, runRef: { ...s.runRef } })),
  };
}

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

function factFor(input: GoalReductionInput, taskId: string): GoalTaskReductionFact | null {
  return input.taskReductions.find((t) => t.taskId === taskId) ?? null;
}

export function evaluateGoalCompletionGuard(
  input: GoalReductionInput,
): GoalCompletionGuardResult {
  const plan = input.plan;
  const broken: GoalPhaseReasonCode[] = [];
  const unsatisfiedTasks: string[] = [];
  const unsatisfiedObligations: string[] = [];

  if (plan === null) {
    return {
      hold: false,
      brokenReasons: ["guard_empty_plan"],
      unsatisfiedRequiredTaskIds: [],
      unsatisfiedRequiredObligationIds: [],
      emptyGoalGate: true,
      requiredWorkTaskIds: [],
      requiredGateTaskIds: [],
      requiredGoalGateTaskIds: [],
    };
  }

  if (
    input.goalActivePlanRevision === null ||
    canonicalJson(input.goalActivePlanRevision) !== canonicalJson(plan.ref)
  ) {
    broken.push("guard_not_current_plan");
  }

  const requiredWork = plan.tasks.filter(
    (t) => t.requirementLevel === "required" && t.taskKind === "work",
  );
  const requiredGates = plan.tasks.filter(
    (t) => t.requirementLevel === "required" && t.taskKind === "gate",
  );
  const requiredGoalGates = requiredGates.filter(
    (t) => t.disposition === "active" && t.scope.kind === "goal",
  );
  // §3.1: at least one required executable (work, active) Task.
  if (!requiredWork.some((t) => t.disposition === "active")) {
    broken.push("guard_empty_plan");
  }
  if (requiredGoalGates.length === 0) {
    broken.push("guard_empty_required_goal_gate");
  }
  const requiredObligations = input.obligations.filter(
    (o) => o.requirementLevel === "required",
  );
  if (requiredObligations.length === 0) {
    broken.push("guard_empty_required_obligation");
  }
  for (const obligation of requiredObligations) {
    if (obligation.requiredRequirementIds.length === 0) {
      broken.push("guard_empty_required_verification_requirement");
    }
    const covered = new Set(obligation.coveredRequirementIds);
    const allCovered = obligation.requiredRequirementIds.every((id) => covered.has(id));
    if (!allCovered || obligation.blockingEvidenceIds.length > 0) {
      broken.push("guard_required_obligation_unsatisfied");
      unsatisfiedObligations.push(obligation.obligationId);
    }
  }

  for (const task of requiredWork) {
    const fact = factFor(input, task.taskId);
    if (task.disposition !== "active" || fact === null || fact.reductionPhase !== "satisfied") {
      broken.push("guard_required_work_task_unsatisfied");
      unsatisfiedTasks.push(task.taskId);
    }
  }
  for (const task of requiredGates) {
    const fact = factFor(input, task.taskId);
    if (task.disposition !== "active" || fact === null || fact.reductionPhase !== "satisfied") {
      broken.push("guard_required_gate_task_unsatisfied");
      unsatisfiedTasks.push(task.taskId);
    }
  }

  const reconciliation = reconcileGoalSideEffects(input.sideEffects);
  if (reconciliation.unreconciled.length > 0) {
    broken.push("guard_unreconciled_side_effect");
  }

  return {
    hold: broken.length === 0,
    brokenReasons: broken,
    unsatisfiedRequiredTaskIds: unsatisfiedTasks,
    unsatisfiedRequiredObligationIds: unsatisfiedObligations,
    emptyGoalGate: requiredGoalGates.length === 0,
    requiredWorkTaskIds: requiredWork.map((t) => t.taskId),
    requiredGateTaskIds: requiredGates.map((t) => t.taskId),
    requiredGoalGateTaskIds: requiredGoalGates.map((t) => t.taskId),
  };
}

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

function mergeRefs(
  refs: Partial<Record<GoalPhaseReasonCode, GoalPhaseRefs>>,
  code: GoalPhaseReasonCode,
  r: GoalPhaseRefs,
): void {
  const existing = refs[code] ?? {};
  const merge = (k: keyof GoalPhaseRefs, v: string[] | undefined) => {
    if (v === undefined) return;
    const cur = existing[k] ?? [];
    for (const item of v) if (!cur.includes(item)) cur.push(item);
    if (cur.length > 0) existing[k] = cur;
  };
  merge("taskIds", r.taskIds);
  merge("obligationIds", r.obligationIds);
  merge("evidenceIds", r.evidenceIds);
  merge("runRefs", r.runRefs);
  merge("requirementIds", r.requirementIds);
  merge("decisionIds", r.decisionIds);
  refs[code] = existing;
}

function pushCode(
  order: GoalPhaseReasonCode[],
  refs: Partial<Record<GoalPhaseReasonCode, GoalPhaseRefs>>,
  code: GoalPhaseReasonCode,
  r: GoalPhaseRefs = {},
): void {
  if (!order.includes(code)) order.push(code);
  mergeRefs(refs, code, r);
}

/**
 * PURE table-driven priority (frozen order; exactly ONE primary phase):
 * 1 CANCELLED, 2 CHANGE_PENDING, 3 PAUSED, 4 COMPLETED (guard),
 * 5 ACCEPTED_PARTIAL, 6 PLANNING, 7 RUNNING, 8 NEEDS_DECISION,
 * 9 BLOCKED, 10 FAILED. Attention flags never decide the phase.
 */
export function reduceGoalPhase(input: GoalReductionInput): GoalPhaseReduction {
  const refs: Partial<Record<GoalPhaseReasonCode, GoalPhaseRefs>> = {};
  const order: GoalPhaseReasonCode[] = [];
  const push = (code: GoalPhaseReasonCode, r: GoalPhaseRefs = {}): void => {
    if (!order.includes(code)) order.push(code);
    mergeRefs(refs, code, r);
  };

  const cancels = input.decisions.filter((d) => d.kind === "cancel" && d.effective);
  if (cancels.length > 0) {
    push("cancel_decision_effective", { decisionIds: cancels.map((d) => d.decisionId) });
    return {
      phase: "CANCELLED",
      completed: false,
      reasonCodes: order,
      refsByCode: refs,
      guard: input.plan === null ? null : evaluateGoalCompletionGuard(input),
      sideEffectReconciliation: reconcileGoalSideEffects(input.sideEffects),
    };
  }

  if (input.changePending !== null) {
    push("change_pending");
    return {
      phase: "CHANGE_PENDING",
      completed: false,
      reasonCodes: order,
      refsByCode: refs,
      guard: input.plan === null ? null : evaluateGoalCompletionGuard(input),
      sideEffectReconciliation: reconcileGoalSideEffects(input.sideEffects),
    };
  }
  if (input.desiredState === "paused") {
    push("desired_state_paused");
    return {
      phase: "PAUSED",
      completed: false,
      reasonCodes: order,
      refsByCode: refs,
      guard: input.plan === null ? null : evaluateGoalCompletionGuard(input),
      sideEffectReconciliation: reconcileGoalSideEffects(input.sideEffects),
    };
  }

  const plan = input.plan;
  if (plan !== null) {
    const inPlan = new Set(plan.tasks.map((t) => t.taskId));
    const outside = input.taskReductions.filter((t) => !inPlan.has(t.taskId));
    if (outside.length > 0) {
      push("not_current_plan_task_ignored", { taskIds: outside.map((t) => t.taskId) });
    }
    const optional = input.taskReductions.filter(
      (t) => t.requirementLevel === "optional" && t.reductionPhase !== "satisfied",
    );
    if (optional.length > 0) {
      push("optional_task_not_satisfied", { taskIds: optional.map((t) => t.taskId) });
    }
    const historicalFail = input.obligations.filter((o) => o.hasHistoricalFail);
    if (historicalFail.length > 0) {
      push("historical_fail_preserved", {
        obligationIds: historicalFail.map((o) => o.obligationId),
      });
    }
  }

  const guard = evaluateGoalCompletionGuard(input);
  if (guard.hold) {
    push("completion_guard_ok", {
      taskIds: [...guard.requiredWorkTaskIds, ...guard.requiredGateTaskIds],
      obligationIds: input.obligations
        .filter((o) => o.requirementLevel === "required")
        .map((o) => o.obligationId),
    });
    return {
      phase: "COMPLETED",
      completed: true,
      reasonCodes: order,
      refsByCode: refs,
      guard,
      sideEffectReconciliation: reconcileGoalSideEffects(input.sideEffects),
    };
  }
  for (const code of guard.brokenReasons) {
    if (code === "guard_required_work_task_unsatisfied" || code === "guard_required_gate_task_unsatisfied") {
      push(code, { taskIds: guard.unsatisfiedRequiredTaskIds });
    } else if (code === "guard_required_obligation_unsatisfied") {
      push(code, { obligationIds: guard.unsatisfiedRequiredObligationIds });
    } else {
      push(code);
    }
  }

  const partials = input.decisions.filter(
    (d) => d.kind === "partial_accept" && d.effective,
  );
  if (partials.length > 0) {
    for (const p of partials) {
      push("partial_accept_decision_effective", {
        decisionIds: [p.decisionId],
        ...(p.partialAcceptTargets !== undefined ? { obligationIds: p.partialAcceptTargets } : {}),
      });
    }
    return {
      phase: "ACCEPTED_PARTIAL",
      completed: false,
      reasonCodes: order,
      refsByCode: refs,
      guard,
      sideEffectReconciliation: reconcileGoalSideEffects(input.sideEffects),
    };
  }

  if (plan === null) {
    if (input.planning.possible) {
      push("no_active_plan_planning_available");
      return {
        phase: "PLANNING",
        completed: false,
        reasonCodes: order,
        refsByCode: refs,
        guard: null,
        sideEffectReconciliation: reconcileGoalSideEffects(input.sideEffects),
      };
    }
    return reduceNoPlanFallback(input, order, refs, guard);
  }

  return reduceWithPlan(input, order, refs, guard);
}

/** plan === null, planning not possible: NEEDS_DECISION > BLOCKED > FAILED. */
function reduceNoPlanFallback(
  input: GoalReductionInput,
  order: GoalPhaseReasonCode[],
  refs: Partial<Record<GoalPhaseReasonCode, GoalPhaseRefs>>,
  guard: GoalCompletionGuardResult | null,
): GoalPhaseReduction {
  const reconciliation = reconcileGoalSideEffects(input.sideEffects);
  if (reconciliation.unreconciled.length > 0) {
    pushCode(order, refs, "unknown_side_effect_needs_decision", {
      runRefs: reconciliation.unreconciled.map((s) => s.runRef.runId),
    });
    return {
      phase: "NEEDS_DECISION",
      completed: false,
      reasonCodes: order,
      refsByCode: refs,
      guard,
      sideEffectReconciliation: reconciliation,
    };
  }
  if (input.decisionNeeds.length > 0) {
    pushCode(order, refs, "human_decision_required");
    return {
      phase: "NEEDS_DECISION",
      completed: false,
      reasonCodes: order,
      refsByCode: refs,
      guard,
      sideEffectReconciliation: reconciliation,
    };
  }
  if (input.planning.failed) {
    pushCode(order, refs, "terminal_failure_exhausted");
    return {
      phase: "FAILED",
      completed: false,
      reasonCodes: order,
      refsByCode: refs,
      guard,
      sideEffectReconciliation: reconciliation,
    };
  }
  pushCode(order, refs, "no_frontier_all_blocked");
  return {
    phase: "BLOCKED",
    completed: false,
    reasonCodes: order,
    refsByCode: refs,
    guard,
    sideEffectReconciliation: reconciliation,
  };
}

/** active plan exists, guard does NOT hold: RUNNING > NEEDS_DECISION > FAILED > BLOCKED. */
function reduceWithPlan(
  input: GoalReductionInput,
  order: GoalPhaseReasonCode[],
  refs: Partial<Record<GoalPhaseReasonCode, GoalPhaseRefs>>,
  guard: GoalCompletionGuardResult,
): GoalPhaseReduction {
  const plan = input.plan!;
  const reconciliation = reconcileGoalSideEffects(input.sideEffects);
  const requiredActive = plan.tasks.filter(
    (t) => t.requirementLevel === "required" && t.disposition === "active",
  );

  const advancing: string[] = [];
  const terminalFailed: string[] = [];
  const blocked: string[] = [];
  const deferredCancelled: string[] = [];
  for (const task of requiredActive) {
    const fact = factFor(input, task.taskId);
    const reductionPhase = fact?.reductionPhase ?? null;
    const planPhase = fact?.planPhase ?? task.phase;
    const runEnded = fact?.runFact?.status === "ended";
    if (reductionPhase === "verifying" && !runEnded) {
      advancing.push(task.taskId);
    } else if (reductionPhase === "verifying" && runEnded) {
      // terminal run + not satisfied + no retry in P1-05: the frontier is dead
      // (needs authorization/disposal — the NEEDS_DECISION branch decides).
      blocked.push(task.taskId);
    } else if (
      reductionPhase === null &&
      (planPhase === "pending" || planPhase === "ready" || planPhase === "running" || planPhase === "verifying")
    ) {
      advancing.push(task.taskId);
    } else if (reductionPhase === "failed") {
      terminalFailed.push(task.taskId);
    } else if (reductionPhase === "blocked" || planPhase === "blocked") {
      blocked.push(task.taskId);
    }
  }
  for (const task of plan.tasks) {
    if (
      task.requirementLevel === "required" &&
      (task.disposition === "deferred" || task.disposition === "cancelled")
    ) {
      deferredCancelled.push(task.taskId);
    }
  }

  if (advancing.length > 0) {
    pushCode(order, refs, "required_frontier_available", { taskIds: advancing });
    if (terminalFailed.length > 0) {
      pushCode(order, refs, "terminal_failure_exhausted", { taskIds: terminalFailed });
    }
    return {
      phase: "RUNNING",
      completed: false,
      reasonCodes: order,
      refsByCode: refs,
      guard,
      sideEffectReconciliation: reconciliation,
    };
  }

  const unknownSideEffects = reconciliation.unreconciled.filter((s) => s.kind === "outcome_unknown");
  if (deferredCancelled.length > 0) {
    pushCode(order, refs, "required_deferred_or_cancelled", { taskIds: deferredCancelled });
  }
  if (unknownSideEffects.length > 0) {
    pushCode(order, refs, "unknown_side_effect_needs_decision", {
      runRefs: unknownSideEffects.map((s) => s.runRef.runId),
    });
  }
  if (input.decisionNeeds.length > 0) {
    pushCode(order, refs, "human_decision_required");
  }
  if (deferredCancelled.length > 0 || unknownSideEffects.length > 0 || input.decisionNeeds.length > 0) {
    return {
      phase: "NEEDS_DECISION",
      completed: false,
      reasonCodes: order,
      refsByCode: refs,
      guard,
      sideEffectReconciliation: reconciliation,
    };
  }

  if (terminalFailed.length > 0) {
    pushCode(order, refs, "terminal_failure_exhausted", { taskIds: terminalFailed });
    return {
      phase: "FAILED",
      completed: false,
      reasonCodes: order,
      refsByCode: refs,
      guard,
      sideEffectReconciliation: reconciliation,
    };
  }
  if (blocked.length === 0) {
    pushCode(order, refs, "invariant_violation_fail_closed", {
      taskIds: requiredActive.map((t) => t.taskId),
    });
    return {
      phase: "FAILED",
      completed: false,
      reasonCodes: order,
      refsByCode: refs,
      guard,
      sideEffectReconciliation: reconciliation,
    };
  }

  pushCode(order, refs, "no_frontier_all_blocked", { taskIds: blocked });
  return {
    phase: "BLOCKED",
    completed: false,
    reasonCodes: order,
    refsByCode: refs,
    guard,
    sideEffectReconciliation: reconciliation,
  };
}

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

const REASON_TEMPLATES: Record<GoalPhaseReasonCode, string> = {
  cancel_decision_effective: "goal has an effective cancel Decision.",
  change_pending: "a goal/acceptance/plan change is pending analysis; the affected subgraph stays safely stopped.",
  desired_state_paused: "the goal desired state is paused.",
  completion_guard_ok: "GoalCompletionGuard holds: active plan non-empty, every required work/gate task satisfied, every required obligation satisfied, no unreconciled side effect.",
  partial_accept_decision_effective: "an effective partial-accept Decision remains; the goal is NOT completed.",
  no_active_plan_planning_available: "no active PlanRevision yet; planning/clarification/approval actions remain.",
  required_frontier_available: "at least one required frontier can still advance.",
  required_deferred_or_cancelled: "required task(s) deferred/cancelled — NOT completion; usually needs a Decision.",
  human_decision_required: "a human decision is required (Finding / subjective oracle / contract change).",
  unknown_side_effect_needs_decision: "unreconciled unknown side effect(s) need authorization and disposal.",
  no_frontier_all_blocked: "no advancing frontier, no pending choice, no terminal failure; every remaining required frontier is actually blocked.",
  terminal_failure_exhausted: "terminal failure of required work with retries/replan exhausted — not disguised as BLOCKED.",
  invariant_violation_fail_closed: "canonical invariant violation — fail closed into FAILED.",
  guard_empty_plan: "the active plan has no required executable task — an empty required set never proves completion.",
  guard_empty_required_goal_gate: "no active required GoalGateTask — an empty required goal-gate set never proves completion (no-change needs an AlreadySatisfied gate proven by current PASS evidence).",
  guard_empty_required_obligation: "no required AcceptanceObligation — an empty required obligation set never proves completion.",
  guard_empty_required_verification_requirement: "a required obligation compiles no required VerificationRequirement — empty VR cannot prove completion.",
  guard_required_work_task_unsatisfied: "required work task(s) unsatisfied (deferred/cancelled/blocked/failed never masquerade as completion).",
  guard_required_gate_task_unsatisfied: "required gate task(s) unsatisfied.",
  guard_required_obligation_unsatisfied: "required AcceptanceObligation(s) unsatisfied (missing applicable PASS or blocking current evidence).",
  guard_unreconciled_side_effect: "unreconciled high-risk/outcome_unknown side effect(s) — completion stays blocked.",
  guard_not_current_plan: "the goal's active PlanRevision differs from the evaluated plan — inconsistent input.",
  optional_task_not_satisfied: "optional task(s) not satisfied — attention flag; NEVER blocks completion.",
  historical_fail_preserved: "historical FAIL evidence preserved for audit; only the current applicable evidence set participates in the guard.",
  not_current_plan_task_ignored: "task fact(s) not in the current plan are ignored.",
};

function refSuffix(refs: GoalPhaseRefs): string {
  const parts: string[] = [];
  if (refs.taskIds !== undefined && refs.taskIds.length > 0) parts.push("tasks=" + refs.taskIds.join(","));
  if (refs.obligationIds !== undefined && refs.obligationIds.length > 0) parts.push("obligations=" + refs.obligationIds.join(","));
  if (refs.evidenceIds !== undefined && refs.evidenceIds.length > 0) parts.push("evidence=" + refs.evidenceIds.join(","));
  if (refs.runRefs !== undefined && refs.runRefs.length > 0) parts.push("runs=" + refs.runRefs.join(","));
  if (refs.decisionIds !== undefined && refs.decisionIds.length > 0) parts.push("decisions=" + refs.decisionIds.join(","));
  if (refs.requirementIds !== undefined && refs.requirementIds.length > 0) parts.push("requirements=" + refs.requirementIds.join(","));
  return parts.length > 0 ? " (" + parts.join("; ") + ")" : "";
}

export function renderGoalCompletionExplanation(
  reduction: GoalPhaseReduction,
  goalId: string,
): GoalCompletionExplanation {
  const items: GoalCompletionExplanationItem[] = reduction.reasonCodes.map((code) => {
    const refs = reduction.refsByCode[code] ?? {};
    return {
      code,
      message: REASON_TEMPLATES[code] + refSuffix(refs),
      refs,
    };
  });
  return {
    schemaVersion: 1,
    phase: reduction.phase,
    headline:
      "goal " + goalId + " phase = " + reduction.phase +
      " (" + reduction.reasonCodes.length + " reason(s), " +
      (reduction.completed ? "completion guard holds" : "completion guard not holding") + ")",
    items,
  };
}

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
