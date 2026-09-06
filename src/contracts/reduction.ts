/**
 * P1-04 Task/Gate reduction contracts — the pure TaskSatisfied formula and
 * the Control entry that applies it (the ONLY writer of the canonical Task
 * reduction; Goal phase is P1-05).
 *
 * Authority:
 *   - dev_docs/interfaces/completion-policy.md §6 (TaskSatisfied) + §3 non-empty
 *     guards + §10 permission boundary
 *   - dev_docs/planning/proposed/P1-foundation/tickets/04-evidence-satisfies-task.md
 *   - IMPLEMENTATION-HANDOFF.md "P1-04 契约与存储语义（冻结）"
 *
 * FROZEN semantics:
 *   - reduceTaskVerification is a PURE function: same canonical inputs -> same
 *     reduction. The Control handler computes it from canonical state and
 *     commits the TaskReduction aggregate via a verification-result commit
 *     (full idempotency + CAS).
 *   - Worker/Reviewer NEVER write Task.phase. Only this Control path writes
 *     the canonical TaskReduction; the ReadModel only projects it.
 *   - The formula requires ALL of: task in the CURRENT active plan revision +
 *     disposition active + every required AcceptanceObligation satisfied +
 *     EffectiveEvidenceSet covers every required VerificationRequirement + no
 *     blocking Finding + no unreconciled high-risk/outcome_unknown side effect.
 *   - Static/dynamic FAIL -> failed (rework); missing required input -> blocked
 *     (nothing applicable at all); stale/out-of-scope bindings -> verifying with
 *     STALE displayed on the bindings (never satisfied); outcome_unknown or a
 *     failed run signal -> explicitly not satisfied.
 *   - Single exit=0 / worker claim / reviewer verdict each alone NEVER satisfy.
 *   - Goal phase is NOT touched here (P1-05 Goal reducer).
 */
import type { ActorRef, CommandFingerprint, CommandIdentity, CommitCursor } from "./command-event.js";
import { canonicalJson, sha256Hex } from "./fingerprint.js";
import type { RunRef, TaskTriple } from "./dispatch.js";
import type { PlanRevisionRef, PlanRevisionSnapshot } from "./plan.js";
import type { Disposition, RequirementLevel, TaskKind } from "./plan.js";
import type { EffectivityAnchorV1, EffectiveEvidenceSet, EvidenceV1 } from "./evidence.js";
import { selectEffectiveEvidenceSet } from "./evidence.js";
import type { RunOutcome } from "./dispatch.js";

// ------------------------------------------------------------------------ //
// Aggregate                                                                  //
// ------------------------------------------------------------------------ //

export type TaskReductionRef = {
  aggregateType: "TaskReduction";
  projectId: string;
  goalId: string;
  taskId: string;
};

export function taskReductionRefFor(projectId: string, goalId: string, taskId: string): TaskReductionRef {
  return { aggregateType: "TaskReduction", projectId, goalId, taskId };
}

// ------------------------------------------------------------------------ //
// Reduction result                                                           //
// ------------------------------------------------------------------------ //

/**
 * The reduction phase is chosen from the four states the evidence rule can
 * produce. It is NEVER merged with the Task's orthogonal phase dimension—
 * it drives the verification view; pending/ready/running remain plan facts.
 */
export type TaskReductionPhase = "verifying" | "blocked" | "failed" | "satisfied";

export type TaskReductionCauseCode =
  | "not_current_plan"
  | "not_active"
  | "missing_evidence"
  | "blocking_evidence"
  | "stale_or_out_of_scope"
  | "run_failed_signal"
  | "unreconciled_side_effect"
  | "unresolved_finding"
  | "no_required_obligation";

export type TaskReductionCause = {
  code: TaskReductionCauseCode;
  message: string;
  requirementKey?: string;
  evidenceIds?: string[];
};

export type RunSignal = {
  runRef: RunRef;
  outcome: RunOutcome;
  exitCode: number | null;
  terminal: boolean;
};

export type TaskReductionInput = {
  projectId: string;
  goalId: string;
  taskId: string;
  /** The GoAL's currently active plan revision (authoritative current plan). */
  plan: PlanRevisionSnapshot;
  /** Must equal plan.ref, else the reduction refuses (not_current_plan). */
  goalActivePlanRevision: PlanRevisionRef;
  /** The canonical current effectivity tuple the reduction is evaluated under. */
  currentAnchor: EffectivityAnchorV1;
  /** Evidence for the task, in admission order (from the index). */
  evidence: EvidenceV1[];
  /** The task's latest run facts (none if never claimed). */
  runSignals: RunSignal[];
  /** Findings block satisfaction per the policy; P1-04 has no Findings
   * mechanism yet, so the caller always passes []. */
  unresolvedFindings: { findingId: string; severity: string; status: string }[];
  /** outcome_unknown / high-risk side effects (from run facts) block satisfaction. */
  unreconciledSideEffects: { kind: "outcome_unknown" | "high_risk"; runRef: RunRef }[];
};

export type TaskReductionComputation = {
  satisfied: boolean;
  phase: TaskReductionPhase;
  causes: TaskReductionCause[];
  effectiveEvidenceIds: string[];
  blockingEvidenceIds: string[];
  staleEvidenceIds: string[];
  outOfScopeEvidenceIds: string[];
  satisfiedObligationIds: string[];
  effectiveSet: EffectiveEvidenceSet;
};

/**
 * PURE TaskSatisfied + phase mapping (frozen order; first hard rule wins the
 * phase, causes accumulate):
 *   1. not in the current active plan revision          -> verifying
 *   2. disposition != active                             -> verifying (never satisfied)
 *   3. unresolved finding / unreconciled side effect      -> verifying (explicitly not satisfied)
 *   4. FAIL/INCONCLUSIVE blocking evidence (not superseded) -> failed (rework)
 *   5. crashed / exit!=0 run signal                       -> failed (rework)
 *   6. missing required VR (no applicable evidence)       -> blocked
 *   7. every required VR covered by an applicable PASS (full formula) -> satisfied
 *   8. otherwise (stale/out-of-scope gaps or partial coverage) -> verifying
 * exit=0 alone is NEUTRAL: it never produces a PASS. A CompletionClaim is
 * INCONCLUSIVE: never a PASS. A reviewer verdict alone still needs the whole
 * set (formula 7).
 * NOTE: a task with no mapped required obligation can NEVER be satisfied
 * (applyPlan guards already forbid that for required executable tasks).
 */
export function reduceTaskVerification(input: TaskReductionInput): TaskReductionComputation {
  const causes: TaskReductionCause[] = [];
  const plan = input.plan;
  const task = plan.tasks.find((t) => t.taskId === input.taskId);

  if (task === undefined) {
    return {
      satisfied: false,
      phase: "verifying",
      causes: [{ code: "not_current_plan", message: "task not found in the current plan revision" }],
      effectiveEvidenceIds: [],
      blockingEvidenceIds: [],
      staleEvidenceIds: [],
      outOfScopeEvidenceIds: [],
      satisfiedObligationIds: [],
      effectiveSet: {
        effectiveEvidenceIds: [],
        coverageByRequirement: {},
        blockingByRequirement: {},
        staleEvidenceIds: [],
        outOfScopeEvidenceIds: [],
      },
    };
  }

  if (canonicalJson(input.goalActivePlanRevision) !== canonicalJson(plan.ref)) {
    causes.push({
      code: "not_current_plan",
      message: "the goal's active plan revision is not the plan this reduction evaluates",
    });
  }
  if (task.disposition !== "active") {
    causes.push({
      code: "not_active",
      message: "disposition is " + task.disposition + " — deferred/cancelled/superseded never satisfy",
    });
  }

  const effectiveSet = selectEffectiveEvidenceSet(input.evidence, plan, input.currentAnchor);

  // Required verification requirements of obligations mapped to the task.
  const required = new Map<
    string,
    { obligationId: string; requirementId: string; kind: string }
  >();
  const requiredObligations = new Set<string>();
  for (const obligation of plan.obligations) {
    if (!obligation.taskIds.includes(task.taskId)) continue;
    if (obligation.requirementLevel !== "required") continue;
    requiredObligations.add(obligation.obligationId);
    for (const vr of obligation.verificationRequirements) {
      if (vr.requirementLevel !== "required") continue;
      required.set(vr.requirementId, {
        obligationId: obligation.obligationId,
        requirementId: vr.requirementId,
        kind: vr.kind,
      });
    }
  }
  if (requiredObligations.size === 0) {
    causes.push({ code: "no_required_obligation", message: "no required obligation maps this task" });
  }

  // Blocking evidence (applicable FAIL/INCONCLUSIVE not superseded).
  const blocking: string[] = [];
  for (const [key, ids] of Object.entries(effectiveSet.blockingByRequirement)) {
    blocking.push(...ids);
    causes.push({
      code: "blocking_evidence",
      message: "an applicable PASS is missing: blocking FAIL/INCONCLUSIVE evidence visible",
      requirementKey: key,
      evidenceIds: ids,
    });
  }

  // Run signals.
  for (const signal of input.runSignals) {
    if (signal.terminal && (signal.outcome === "crashed" || (signal.outcome === "completed" && signal.exitCode !== 0))) {
      causes.push({
        code: "run_failed_signal",
        message:
          "run " + signal.runRef.runId + " ended " + signal.outcome +
          (signal.exitCode !== null ? " (exit " + signal.exitCode + ")" : "") + " — rework required",
        evidenceIds: [signal.runRef.runId],
      });
    }
  }
  for (const sideEffect of input.unreconciledSideEffects) {
    causes.push({
      code: "unreconciled_side_effect",
      message: "unreconciled " + sideEffect.kind + " side effect on run " + sideEffect.runRef.runId,
      evidenceIds: [sideEffect.runRef.runId],
    });
  }
  for (const finding of input.unresolvedFindings) {
    causes.push({
      code: "unresolved_finding",
      message: "unresolved Finding " + finding.findingId + " (" + finding.severity + "/" + finding.status + ")",
      evidenceIds: [finding.findingId],
    });
  }

  // Active plan + active disposition are prerequisites of the whole formula.
  const planIsCurrent =
    canonicalJson(input.goalActivePlanRevision) === canonicalJson(plan.ref);
  const activeDisposition = task.disposition === "active";

  const missingIds = new Set<string>();
  const staleOnlyIds: string[] = [];
  for (const req of required.values()) {
    const key = req.obligationId + " " + req.requirementId;
    if (effectiveSet.coverageByRequirement[key] !== undefined) continue;
    const hasApplicable = effectiveSet.blockingByRequirement[key] !== undefined
      ? (effectiveSet.blockingByRequirement[key] ?? []).length > 0
      : false;
    if (!hasApplicable && effectiveSet.staleEvidenceIds.length === 0 && effectiveSet.outOfScopeEvidenceIds.length === 0) {
      missingIds.add(req.requirementId);
      continue;
    }
    // Evidence exists for the task but nothing applicable covers this VR.
    staleOnlyIds.push(req.requirementId);
  }

  const hardNotSatisfied =
    !planIsCurrent || !activeDisposition || input.unresolvedFindings.length > 0 ||
    input.unreconciledSideEffects.length > 0;
  const failedByEvidence = blocking.length > 0;
  const failedByRun = input.runSignals.some(
    (s) =>
      s.terminal &&
      (s.outcome === "crashed" || (s.outcome === "completed" && s.exitCode !== 0)),
  );
  const missingInput = missingIds.size > 0;

  let phase: TaskReductionPhase;
  if (hardNotSatisfied) {
    phase = "verifying";
  } else if (failedByEvidence || failedByRun) {
    phase = "failed";
  } else if (missingInput) {
    phase = "blocked";
    causes.push({
      code: "missing_evidence",
      message: "required verification requirements have no applicable evidence yet",
    });
  } else {
    // All required VRs are covered by applicable PASS evidence.
    const allCovered = [...required.values()].every((req) => {
      const key = req.obligationId + " " + req.requirementId;
      return effectiveSet.coverageByRequirement[key] !== undefined;
    });
    if (allCovered && required.size > 0 && requiredObligations.size > 0) {
      phase = "satisfied";
    } else if (staleOnlyIds.length > 0) {
      phase = "verifying";
      causes.push({
        code: "stale_or_out_of_scope",
        message: "evidence exists but no applicable PASS covers all required requirements",
        evidenceIds: staleOnlyIds,
      });
    } else {
      phase = "verifying";
    }
  }

  if (phase === "blocked" && !causes.some((c) => c.code === "missing_evidence")) {
    causes.unshift({
      code: "missing_evidence",
      message: "missing required input: no applicable evidence covers the requirement",
    });
  }

  return {
    satisfied: phase === "satisfied",
    phase,
    causes,
    effectiveEvidenceIds: effectiveSet.effectiveEvidenceIds,
    blockingEvidenceIds: blocking,
    staleEvidenceIds: effectiveSet.staleEvidenceIds,
    outOfScopeEvidenceIds: effectiveSet.outOfScopeEvidenceIds,
    satisfiedObligationIds: [...requiredObligations],
    effectiveSet,
  };
}

// ------------------------------------------------------------------------ //
// Snapshot / command                                                         //
// ------------------------------------------------------------------------ //

export type TaskReductionSnapshot = {
  ref: TaskReductionRef;
  /** 1 on first reduction; k+1 on each later one (evidence set changed). */
  revision: number;
  schemaVersion: 1;
  planRef: PlanRevisionRef;
  planRevision: number;
  taskKind: TaskKind;
  requirementLevel: RequirementLevel;
  disposition: Disposition;
  phase: TaskReductionPhase;
  currentAnchor: EffectivityAnchorV1;
  effectiveEvidenceIds: string[];
  blockingEvidenceIds: string[];
  staleEvidenceIds: string[];
  outOfScopeEvidenceIds: string[];
  satisfiedObligationIds: string[];
  causes: TaskReductionCause[];
  reducedAt: string;
};

export type ReduceTaskCommand = {
  commandId: string;
  commandType: "ReduceTask";
  schemaVersion: 1;
  identity: CommandIdentity;
  /** taskId — the TaskReduction aggregate. */
  aggregateId: string;
  /** TaskReduction CAS window (0 = first reduction). */
  expectedRevision: number;
  correlationId: string;
  submittedAt: string;
  payload: { goalId: string };
};

export type ReduceTaskRejectionCode =
  | "invalid"
  | "not_found"
  | "task_not_in_plan"
  | "revision_conflict"
  | "idempotency_conflict"
  | "unavailable";

export type ReduceTaskReceipt =
  | {
      status: "committed";
      commandId: string;
      replayed: boolean;
      reductionRef: TaskReductionRef;
      phase: TaskReductionPhase;
      eventIds: string[];
      commitCursor: CommitCursor;
    }
  | {
      status: "rejected";
      commandId: string;
      code: ReduceTaskRejectionCode;
      currentRevision?: number;
    };

export function reduceTaskFingerprint(command: ReduceTaskCommand): CommandFingerprint {
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
// Event (P1-04 v1)                                                           //
// ------------------------------------------------------------------------ //

export type TaskReductionUpdatedEvent = {
  eventId: string;
  eventType: "TaskReductionUpdated";
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: "TaskReduction";
  aggregateId: string;
  /** k — advancing aggregate revision (1 on first reduction). */
  aggregateRevision: number;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: {
    goalId: string;
    taskId: string;
    reduction: TaskReductionSnapshot;
  };
};

export type Phase = TaskReductionPhase;
export function reductionPhaseOf(phase: TaskReductionPhase): Phase {
  return phase;
}