/**
 * P1-02 Control entry: ApplyPlanRevision (accept a hand-authored plan).
 *
 * ENTRY FILE (shared baseline — exported signature FROZEN). Lane B fills the
 * implementation; frozen guard order + semantics in IMPLEMENTATION-HANDOFF.md
 * "P1-02 契约与存储语义" and the ticket Acceptance:
 *   1. schema validation (validation.validateApplyPlanRevisionCommand);
 *   2. resolve refs: Goal exists (else "not_found"); effective CompletionPolicy
 *      + ArchitectureBaseline resolved from canonical Project active refs —
 *      identity/revision/digest triple (else "unresolved_governance_ref");
 *   3. non-empty guards (PlanValidationError[] -> "plan_guard_failed"):
 *      >=1 required executable task; >=1 active required GoalGateTask;
 *      >=1 required obligation; every required executable task maps a
 *      required obligation; every required obligation maps work/gate tasks;
 *      every required obligation compiles >=1 required VerificationRequirement
 *      with kind within the policy requirementKinds (policy minimum);
 *   4. TaskHierarchy legality + RuntimeExecutionDAG acyclicity (parent_of only
 *      in hierarchy; depends_on only in DAG; no self/ref/dangling/cycles;
 *      Stage synthesizes NO dependencies);
 *   5. atomic commit (goal snapshot +1 with activePlanRevision, immutable
 *      PlanRevision@1 with FIXED pins, CAS) + receipt mapping.
 *   - NOT in scope: dispatch outbox, Runs/TaskAttempts, Goal reduction.
 */
import type { ApplyPlanRevisionCommand, PlanRevisionReceipt } from "../contracts/plan.js";
import type { ControlEngineDeps } from "./control-engine.js";

export function applyPlanRevision(
  deps: ControlEngineDeps,
  command: ApplyPlanRevisionCommand,
): Promise<PlanRevisionReceipt> {
  void deps;
  void command;
  return Promise.reject(new Error("P1-02: applyPlanRevision not implemented yet"));
}
