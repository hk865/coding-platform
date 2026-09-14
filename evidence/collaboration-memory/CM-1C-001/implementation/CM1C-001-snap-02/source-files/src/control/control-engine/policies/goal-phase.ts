/** Control-owned deterministic domain policy. */
import { canonicalJson } from "../../../contracts/fingerprint.js";
import type { GoalPhaseReasonCode, GoalTaskReductionFact, GoalSideEffectFact, GoalReductionInput, GoalSideEffectReconciliation, GoalCompletionGuardResult, GoalPhaseRefs, GoalPhaseReduction, GoalCompletionExplanationItem, GoalCompletionExplanation } from "../../../contracts/goal-phase.js";



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
    const runActive = fact?.runFact?.status === "starting" || fact?.runFact?.status === "running";
    // Accepted Plan phases never move. Read the same canonical TaskReduction
    // overlay used by dispatch, including predecessors outside the required set.
    const dependenciesSatisfied = plan.executionDag.dependsOn
      .filter((edge) => edge.taskId === task.taskId)
      .every((edge) => {
        const predecessor = plan.tasks.find((candidate) => candidate.taskId === edge.dependsOnId);
        if (predecessor === undefined) return false;
        const predecessorFact = factFor(input, predecessor.taskId);
        return (predecessorFact?.reductionPhase ?? predecessorFact?.planPhase ?? predecessor.phase) === "satisfied";
      });
    const phase = reductionPhase ?? planPhase;
    if (phase === "failed") {
      terminalFailed.push(task.taskId);
    } else if (phase === "blocked") {
      blocked.push(task.taskId);
    } else if (phase === "pending" || phase === "ready" || phase === "running" || phase === "verifying") {
      // A live Run is already advancing. Otherwise, an unexecuted work/gate
      // needs satisfied inputs; pending downstream nodes do not create a frontier.
      // An ended Run cannot implicitly authorize a new attempt.
      if (runActive || (!runEnded && dependenciesSatisfied)) {
        advancing.push(task.taskId);
      } else {
        blocked.push(task.taskId);
      }
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