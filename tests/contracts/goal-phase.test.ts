/**
 * P1-05 pure reducer tests — the frozen GoalCompletionGuard + 10-level priority
 * table + deterministic explanation. Green at the shared baseline (the pure
 * function lives in src/contracts/goal-phase.ts); the ADAPTER contract suite
 * (defineGoalReductionContractSuite) exercises the full Control+projection path.
 *
 * Covers ticket Acceptance items at the pure-function level:
 *   - only ALL required work/gate + obligations + non-empty guards + no
 *     unreconciled side effects -> COMPLETED;
 *   - optional never blocks; required deferred/cancelled/blocked/failed never
 *     masquerade as completion;
 *   - parent_of / Module / Stage never change the required set;
 *   - empty plan / empty required GoalGate / empty obligation / empty VR never
 *     prove completion;
 *   - no-change only via a required active GoalGate proved by PASS evidence;
 *   - deterministic 10-level priority incl. CANCELLED / NEEDS_DECISION /
 *     BLOCKED / FAILED and outcome_unknown;
 *   - replay equality (same input -> same phase + reasonCodes + explanation);
 *   - historical FAIL preserved; only current applicable evidence participates.
 */
import { describe, expect, it } from "vitest";
import {
  reduceGoalPhase,
  renderGoalCompletionExplanation,
  reconcileGoalSideEffects,
  type GoalReductionInput,
  type GoalObligationFact,
  type GoalTaskReductionFact,
  type GoalSideEffectFact,
  type GoalDecisionFact,
  type GoalPlanningFact,
} from "../../src/contracts/goal-phase.js";
import {
  P105_GOAL,
  P105_OBL_GOAL,
  P105_OBL_MODULE,
  P105_OBL_OPTIONAL,
  P105_OBL_STAGE,
  P105_OBL_WORK,
  P105_PLAN_ID,
  P105_PLAN_REVISION_FIXTURE_V1,
  P105_TASK_GOAL_GATE,
  P105_TASK_MODULE_GATE,
  P105_TASK_OPTIONAL,
  P105_TASK_STAGE_GATE,
  P105_TASK_WORK,
} from "../../src/contracts/fixtures/goal-phase-fixtures.js";
import { buildApplyPlanCommand, planRevisionSnapshotFor } from "../../src/contracts/fixtures/plan-fixtures.js";
import type { PlanRevisionSnapshot } from "../../src/contracts/plan.js";

const PROJECT = "proj-alpha";

function plan105(mutate?: (p: PlanRevisionSnapshot) => void): PlanRevisionSnapshot {
  const command = buildApplyPlanCommand(P105_PLAN_REVISION_FIXTURE_V1, {
    commandId: "cmd-p105-plan",
    correlationId: "corr-p105-plan",
    submittedAt: "2026-09-05T12:00:00.000Z",
    projectId: PROJECT,
    expectedRevision: 1,
  });
  const snapshot = planRevisionSnapshotFor(command, {
    completionPolicy: {
      ref: { aggregateType: "CompletionPolicyRevision", projectId: PROJECT, policyId: "policy-completion", revision: 1 },
      digest: "d".repeat(64),
    },
    architectureBaseline: {
      ref: { aggregateType: "ArchitectureBaselineRevision", projectId: PROJECT, baselineId: "baseline-core", revision: 1 },
      digest: "e".repeat(64),
    },
  }, "2026-09-05T12:00:00.000Z");
  mutate?.(snapshot);
  return snapshot;
}

function satisfied(taskId: string): GoalTaskReductionFact {
  return {
    taskId, taskKind: taskId.includes("gate") ? "gate" : "work",
    requirementLevel: taskId === P105_TASK_OPTIONAL ? "optional" : "required",
    disposition: "active",
    planPhase: "satisfied",
    reductionPhase: "satisfied",
    effectiveEvidenceIds: ["ev-" + taskId],
    reducedAt: "2026-09-05T12:00:00.000Z",
  };
}

function unsat(taskId: string, phase: "verifying" | "blocked" | "failed" | null, planPhase: "pending" | "running" | "blocked" | "failed" | "verifying" | "satisfied" = "pending"): GoalTaskReductionFact {
  return {
    taskId, taskKind: taskId.includes("gate") ? "gate" : "work",
    requirementLevel: taskId === P105_TASK_OPTIONAL ? "optional" : "required",
    disposition: "active",
    planPhase,
    reductionPhase: phase,
    effectiveEvidenceIds: [],
    reducedAt: phase === null ? null : "2026-09-05T12:00:00.000Z",
  };
}

function obligation(obligationId: string, taskId: string, covered: boolean, blocking: string[] = [], historicalFail = false): GoalObligationFact {
  return {
    obligationId,
    requirementLevel: obligationId === P105_OBL_OPTIONAL ? "optional" : "required",
    taskIds: [taskId],
    requiredRequirementIds: ["vr-" + obligationId],
    coveredRequirementIds: covered ? ["vr-" + obligationId] : [],
    blockingEvidenceIds: blocking,
    hasHistoricalFail: historicalFail,
    staleEvidenceIds: [],
    outOfScopeEvidenceIds: [],
  };
}

function allSatisfiedPlan(): GoalReductionInput {
  const plan = plan105();
  return {
    schemaVersion: 1,
    projectId: PROJECT,
    goalId: P105_GOAL,
    plan,
    goalActivePlanRevision: plan.ref,
    desiredState: "active",
    taskReductions: [satisfied(P105_TASK_WORK), satisfied(P105_TASK_MODULE_GATE), satisfied(P105_TASK_STAGE_GATE), satisfied(P105_TASK_GOAL_GATE), unsat(P105_TASK_OPTIONAL, "verifying", "running")],
    obligations: [
      obligation(P105_OBL_WORK, P105_TASK_WORK, true),
      obligation(P105_OBL_MODULE, P105_TASK_MODULE_GATE, true),
      obligation(P105_OBL_STAGE, P105_TASK_STAGE_GATE, true),
      obligation(P105_OBL_GOAL, P105_TASK_GOAL_GATE, true),
      obligation(P105_OBL_OPTIONAL, P105_TASK_OPTIONAL, false),
    ],
    sideEffects: [],
    decisions: [],
    changePending: null,
    decisionNeeds: [],
    planning: { possible: false, failed: false, blockedReason: null },
  };
}

const completedInput = allSatisfiedPlan();

describe("P1-05 pure Goal phase reducer", () => {
  it("COMPLETED: all required work/gate + obligations + non-empty guards + no side effects (optional not blocking)", () => {
    const r = reduceGoalPhase(completedInput);
    expect(r.phase).toBe("COMPLETED");
    expect(r.completed).toBe(true);
    expect(r.reasonCodes).toContain("completion_guard_ok");
    expect(r.reasonCodes).toContain("optional_task_not_satisfied");
    expect(r.reasonCodes).not.toContain("guard_required_work_task_unsatisfied");
  });

  it("§3 empty plan never completes — no active plan -> PLANNING", () => {
    const input = { ...completedInput, plan: null, goalActivePlanRevision: null, taskReductions: [], obligations: [], planning: { possible: true, failed: false, blockedReason: null } };
    const r = reduceGoalPhase(input);
    expect(r.phase).toBe("PLANNING");
    expect(r.reasonCodes).toContain("no_active_plan_planning_available");
    expect(r.completed).toBe(false);
  });

  it("§3 empty required work set -> fail closed (never COMPLETED)", () => {
    const plan = plan105((p) => {
      p.tasks = p.tasks.filter((t) => t.taskKind === "gate");
    });
    const input = {
      ...allSatisfiedPlan(),
      plan,
      taskReductions: [satisfied(P105_TASK_MODULE_GATE), satisfied(P105_TASK_STAGE_GATE), satisfied(P105_TASK_GOAL_GATE)],
      obligations: [
        obligation(P105_OBL_MODULE, P105_TASK_MODULE_GATE, true),
        obligation(P105_OBL_STAGE, P105_TASK_STAGE_GATE, true),
        obligation(P105_OBL_GOAL, P105_TASK_GOAL_GATE, true),
      ],
    };
    const r = reduceGoalPhase(input);
    expect(r.phase).not.toBe("COMPLETED");
    expect(r.reasonCodes).toContain("guard_empty_plan");
  });

  it("§3 empty required GoalGate set -> fail closed (no-change cannot be an empty set)", () => {
    const plan = plan105((p) => {
      p.tasks = p.tasks.filter((t) => t.taskId !== P105_TASK_GOAL_GATE);
    });
    const input = { ...allSatisfiedPlan(), plan, taskReductions: [satisfied(P105_TASK_WORK), satisfied(P105_TASK_MODULE_GATE), satisfied(P105_TASK_STAGE_GATE)] };
    const r = reduceGoalPhase(input);
    expect(r.phase).not.toBe("COMPLETED");
    expect(r.reasonCodes).toContain("guard_empty_required_goal_gate");
  });

  it("§3 empty required obligation set -> fail closed", () => {
    const input = { ...allSatisfiedPlan(), obligations: [] };
    const r = reduceGoalPhase(input);
    expect(r.phase).not.toBe("COMPLETED");
    expect(r.reasonCodes).toContain("guard_empty_required_obligation");
  });

  it("§3 a required obligation with NO required VerificationRequirement -> fail closed", () => {
    const input = { ...allSatisfiedPlan(), obligations: [{ ...obligation(P105_OBL_WORK, P105_TASK_WORK, true), requiredRequirementIds: [] }] };
    const r = reduceGoalPhase(input);
    expect(r.phase).not.toBe("COMPLETED");
    expect(r.reasonCodes).toContain("guard_empty_required_verification_requirement");
  });

  it("required deferred/cancelled never masquerade as completion -> NEEDS_DECISION", () => {
    const plan = plan105((p) => {
      p.tasks = p.tasks.map((t) => (t.taskId === P105_TASK_WORK ? { ...t, disposition: "deferred" } : t));
    });
    const input = { ...allSatisfiedPlan(), plan };
    const r = reduceGoalPhase(input);
    expect(r.phase).toBe("NEEDS_DECISION");
    expect(r.reasonCodes).toContain("required_deferred_or_cancelled");
    expect(r.reasonCodes).toContain("guard_required_work_task_unsatisfied");
  });

  it("required blocked never masquerades as completion -> BLOCKED (no frontier, no fail)", () => {
    const input: GoalReductionInput = {
      ...allSatisfiedPlan(),
      taskReductions: [
        unsat(P105_TASK_WORK, "blocked", "blocked"),
        unsat(P105_TASK_MODULE_GATE, "blocked", "blocked"),
        unsat(P105_TASK_STAGE_GATE, "blocked", "blocked"),
        unsat(P105_TASK_GOAL_GATE, "blocked", "blocked"),
        unsat(P105_TASK_OPTIONAL, "verifying", "running"),
      ],
      obligations: [obligation(P105_OBL_WORK, P105_TASK_WORK, false), obligation(P105_OBL_MODULE, P105_TASK_MODULE_GATE, false), obligation(P105_OBL_STAGE, P105_TASK_STAGE_GATE, false), obligation(P105_OBL_GOAL, P105_TASK_GOAL_GATE, false), obligation(P105_OBL_OPTIONAL, P105_TASK_OPTIONAL, false)],
    };
    const r = reduceGoalPhase(input);
    expect(r.phase).toBe("BLOCKED");
    expect(r.reasonCodes).toContain("no_frontier_all_blocked");
  });

  it("required terminal FAILED -> FAILED (never disguised as BLOCKED)", () => {
    const input: GoalReductionInput = {
      ...allSatisfiedPlan(),
      taskReductions: [
        unsat(P105_TASK_WORK, "failed"),
        unsat(P105_TASK_MODULE_GATE, "blocked", "blocked"),
        unsat(P105_TASK_STAGE_GATE, "blocked", "blocked"),
        unsat(P105_TASK_GOAL_GATE, "blocked", "blocked"),
        unsat(P105_TASK_OPTIONAL, "verifying", "running"),
      ],
      obligations: [obligation(P105_OBL_WORK, P105_TASK_WORK, false, ["ev-fail"]), obligation(P105_OBL_MODULE, P105_TASK_MODULE_GATE, false), obligation(P105_OBL_STAGE, P105_TASK_STAGE_GATE, false), obligation(P105_OBL_GOAL, P105_TASK_GOAL_GATE, false), obligation(P105_OBL_OPTIONAL, P105_TASK_OPTIONAL, false)],
    };
    const r = reduceGoalPhase(input);
    expect(r.phase).toBe("FAILED");
    expect(r.reasonCodes).toContain("terminal_failure_exhausted");
    expect(r.reasonCodes).not.toContain("no_frontier_all_blocked");
  });

  it("RUNNING: a required frontier still advances even though another required failed", () => {
    const input = {
      ...allSatisfiedPlan(),
      taskReductions: [
        unsat(P105_TASK_WORK, "failed"),
        unsat(P105_TASK_MODULE_GATE, "verifying", "verifying"),
        unsat(P105_TASK_STAGE_GATE, null, "pending"),
        unsat(P105_TASK_GOAL_GATE, null, "pending"),
        unsat(P105_TASK_OPTIONAL, "verifying", "running"),
      ],
      obligations: [obligation(P105_OBL_WORK, P105_TASK_WORK, false, ["ev-fail"]), obligation(P105_OBL_MODULE, P105_TASK_MODULE_GATE, false), obligation(P105_OBL_STAGE, P105_TASK_STAGE_GATE, false), obligation(P105_OBL_GOAL, P105_TASK_GOAL_GATE, false), obligation(P105_OBL_OPTIONAL, P105_TASK_OPTIONAL, false)],
    };
    const r = reduceGoalPhase(input);
    expect(r.phase).toBe("RUNNING");
    expect(r.reasonCodes).toContain("required_frontier_available");
  });

  it("needs decision: unreconciled outcome_unknown side effect blocks completion (with/without comparison)", () => {
    const sideEffect: GoalSideEffectFact = { kind: "outcome_unknown", runRef: { aggregateType: "Run", projectId: PROJECT, goalId: P105_GOAL, runId: "run-u-1" }, note: null, reconciled: false };
    const reconciled = { ...allSatisfiedPlan(), sideEffects: [sideEffect] };
    const r = reduceGoalPhase(reconciled);
    expect(r.phase).toBe("NEEDS_DECISION");
    expect(r.reasonCodes).toContain("unknown_side_effect_needs_decision");
    expect(r.reasonCodes).toContain("guard_unreconciled_side_effect");
    expect(r.completed).toBe(false);
    const without = reduceGoalPhase(allSatisfiedPlan());
    expect(without.phase).toBe("COMPLETED");
    // reconciliation identifies and blocks; no disposal in P1-05
    const rec = reconcileGoalSideEffects([sideEffect]);
    expect(rec.unreconciled).toHaveLength(1);
  });

  it("CANCELLED has deterministic priority over everything", () => {
    const input: GoalReductionInput = { ...allSatisfiedPlan(), decisions: [{ kind: "cancel", decisionId: "dec-cancel-1", decidedAt: "2026-09-05T12:00:00.000Z", effective: true, note: null }] };
    expect(reduceGoalPhase(input).phase).toBe("CANCELLED");
  });

  it("CHANGE_PENDING + PAUSED + ACCEPTED_PARTIAL are deterministic", () => {
    expect(reduceGoalPhase({ ...allSatisfiedPlan(), changePending: { changeId: "chg-1", note: null } }).phase).toBe("CHANGE_PENDING");
    expect(reduceGoalPhase({ ...allSatisfiedPlan(), desiredState: "paused" }).phase).toBe("PAUSED");
    const partial: GoalDecisionFact = { kind: "partial_accept", decisionId: "dec-pa-1", decidedAt: "2026-09-05T12:00:00.000Z", effective: true, note: null, partialAcceptTargets: [] };
    // §9 order: COMPLETED(4) is checked before ACCEPTED_PARTIAL(5) — a partial
    // accept on a guard-holding goal stays COMPLETED.
    expect(reduceGoalPhase({ ...allSatisfiedPlan(), decisions: [partial] }).phase).toBe("COMPLETED");
    // ACCEPTED_PARTIAL applies when the guard does NOT hold:
    const incomplete: GoalReductionInput = {
      ...allSatisfiedPlan(),
      taskReductions: [unsat(P105_TASK_WORK, "blocked", "blocked"), satisfied(P105_TASK_MODULE_GATE), satisfied(P105_TASK_STAGE_GATE), satisfied(P105_TASK_GOAL_GATE), unsat(P105_TASK_OPTIONAL, "verifying", "running")],
      obligations: [obligation(P105_OBL_WORK, P105_TASK_WORK, false), obligation(P105_OBL_MODULE, P105_TASK_MODULE_GATE, true), obligation(P105_OBL_STAGE, P105_TASK_STAGE_GATE, true), obligation(P105_OBL_GOAL, P105_TASK_GOAL_GATE, true), obligation(P105_OBL_OPTIONAL, P105_TASK_OPTIONAL, false)],
      decisions: [partial],
    };
    expect(reduceGoalPhase(incomplete).phase).toBe("ACCEPTED_PARTIAL");
  });

  it("parent_of / Module / Stage never change the required set (same phase with/without)", () => {
    const flat = plan105((p) => {
      p.taskHierarchy = { parentOf: [] };
      p.tasks = p.tasks.map((t) =>
        t.taskId === P105_TASK_MODULE_GATE ? { ...t, scope: { kind: "stage", stageId: "stage-goal-105" } as const } : t,
      );
    });
    const input = { ...allSatisfiedPlan(), plan: flat };
    expect(reduceGoalPhase(input).phase).toBe("COMPLETED");
    // but removing the GOAL scope gate from the required set fails the guard:
    const noGoalGate = plan105((p) => {
      p.tasks = p.tasks.filter((t) => t.taskId !== P105_TASK_GOAL_GATE);
    });
    const input2 = { ...allSatisfiedPlan(), plan: noGoalGate, taskReductions: [satisfied(P105_TASK_WORK), satisfied(P105_TASK_MODULE_GATE), satisfied(P105_TASK_STAGE_GATE), unsat(P105_TASK_OPTIONAL, "verifying", "running")] };
    expect(reduceGoalPhase(input2).phase).not.toBe("COMPLETED");
  });

  it("no-change ONLY via a required active GoalGate proved by current PASS evidence", () => {
    // gate fact shows satisfied ONLY with effective PASS evidence ids; a gate
    // without effective evidence cannot be satisfied per the P1-04 formula
    // (guard reads the reduction phase only — the evidence rule lives in P1-04,
    // asserted here structurally: explanation cites gate evidence ids).
    const r = reduceGoalPhase(completedInput);
    const gateFact = r.refsByCode["completion_guard_ok"]!;
    expect(gateFact.taskIds).toContain(P105_TASK_GOAL_GATE);
    const explanation = renderGoalCompletionExplanation(r, P105_GOAL);
    expect(explanation.headline).toContain("COMPLETED");
    const ok = explanation.items.find((i) => i.code === "completion_guard_ok");
    expect(ok?.refs.taskIds).toContain(P105_TASK_GOAL_GATE);
    expect(ok?.message).toContain("gate");
  });

  it("historical FAIL preserved — only current applicable evidence participates in the guard", () => {
    const withHistory = {
      ...allSatisfiedPlan(),
      obligations: [
        { ...obligation(P105_OBL_WORK, P105_TASK_WORK, true), hasHistoricalFail: true },
        obligation(P105_OBL_MODULE, P105_TASK_MODULE_GATE, true),
        obligation(P105_OBL_STAGE, P105_TASK_STAGE_GATE, true),
        obligation(P105_OBL_GOAL, P105_TASK_GOAL_GATE, true),
        obligation(P105_OBL_OPTIONAL, P105_TASK_OPTIONAL, false),
      ],
    };
    const r = reduceGoalPhase(withHistory);
    expect(r.phase).toBe("COMPLETED");
    expect(r.reasonCodes).toContain("historical_fail_preserved");
    // a CURRENT blocking FAIL blocks completion:
    const blocking = {
      ...withHistory,
      obligations: [
        { ...obligation(P105_OBL_WORK, P105_TASK_WORK, false, ["ev-fail-current"]), hasHistoricalFail: true },
        obligation(P105_OBL_MODULE, P105_TASK_MODULE_GATE, true),
        obligation(P105_OBL_STAGE, P105_TASK_STAGE_GATE, true),
        obligation(P105_OBL_GOAL, P105_TASK_GOAL_GATE, true),
        obligation(P105_OBL_OPTIONAL, P105_TASK_OPTIONAL, false),
      ],
    };
    expect(reduceGoalPhase(blocking).phase).not.toBe("COMPLETED");
  });

  it("replay equality: same input -> same phase, reasonCodes, refs and explanation", () => {
    const a = reduceGoalPhase(completedInput);
    const b = reduceGoalPhase(completedInput);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const ea = renderGoalCompletionExplanation(a, P105_GOAL);
    const eb = renderGoalCompletionExplanation(b, P105_GOAL);
    expect(JSON.stringify(ea)).toBe(JSON.stringify(eb));
    expect(Object.keys(a.refsByCode).length).toBe(a.reasonCodes.length);
  });

  it("not-current-plan task facts are ignored as attention flags", () => {
    const stale = {
      ...allSatisfiedPlan(),
      taskReductions: [...allSatisfiedPlan().taskReductions, unsat("task-old-99", "failed")],
    };
    const r = reduceGoalPhase(stale);
    expect(r.phase).toBe("COMPLETED");
    expect(r.reasonCodes).toContain("not_current_plan_task_ignored");
  });

  it("PLANNING before NEEDS_DECISION/BLOCKED/FAILED when no active plan and actions remain", () => {
    const input: GoalReductionInput = { ...completedInput, plan: null, goalActivePlanRevision: null, taskReductions: [], obligations: [], sideEffects: [{ kind: "outcome_unknown", runRef: { aggregateType: "Run", projectId: PROJECT, goalId: P105_GOAL, runId: "run-x" }, note: null, reconciled: false }], planning: { possible: true, failed: false, blockedReason: null } };
    expect(reduceGoalPhase(input).phase).toBe("PLANNING");
  });
});
