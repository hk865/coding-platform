/**
 * PlanRevision contracts — P1-02 "PlanRevision accepted -> Plan/Task view".
 *
 * Authority:
 *   - dev_docs/interfaces/completion-policy.md (orthogonal Task dimensions,
 *     TaskHierarchy vs RuntimeExecutionDAG, non-empty guard set)
 *   - dev_docs/interfaces/goal-view.md + modules/data/read-model-index.md
 *     (views are event projections; freshness by cursor)
 *   - dev_docs/planning/proposed/P1-foundation/tickets/02-plan-revision-visible.md
 *   - IMPLEMENTATION-HANDOFF.md "P1-02 契约与存储语义（冻结）"
 *
 * Guard order (frozen): schema -> ref resolution -> non-empty guards ->
 * hierarchy/DAG legality -> atomic commit. Every rejection is zero-write.
 * P1-02 does NOT dispatch tasks, create Runs/TaskAttempts, produce a dispatch
 * outbox or reduce Goals; Stage does not synthesize dependencies; completed
 * state is left to later tickets.
 */
import type {
  ActorRef,
  CommandFingerprint,
  CommandIdentity,
  CommitCursor,
} from "./command-event.js";
import { canonicalJson, sha256Hex } from "./fingerprint.js";
import type { GoalRef } from "./ledger.js";
import type {
  ArchitectureBaselinePin,
  CompletionPolicyPin,
} from "./governance.js";

// ------------------------------------------------------------------------ //
// Orthogonal Task dimensions (completion-policy.md §1 — never merged)      //
// ------------------------------------------------------------------------ //

export type RequirementLevel = "required" | "optional";
export type TaskKind = "work" | "gate";
export type Disposition = "active" | "deferred" | "cancelled" | "superseded";
export type Phase =
  | "pending"
  | "ready"
  | "running"
  | "verifying"
  | "blocked"
  | "satisfied"
  | "failed";

export type TaskScope =
  | { kind: "goal" }
  | { kind: "stage"; stageId: string }
  | { kind: "module"; stageId: string; moduleRef: string };

// ------------------------------------------------------------------------ //
// Plan structures                                                           //
// ------------------------------------------------------------------------ //

export type PlanStage = {
  stageId: string;
  title: string;
  description?: string;
};

/**
 * Runtime Task: four orthogonal dimensions (requirementLevel / taskKind /
 * disposition / phase) plus a scope. All MVP tasks are executable.
 */
export type RuntimeTask = {
  taskId: string;
  stageId?: string;
  title: string;
  requirementLevel: RequirementLevel;
  taskKind: TaskKind;
  disposition: Disposition;
  phase: Phase;
  scope: TaskScope;
};

/** Gate tasks are runtime tasks with taskKind = "gate" (same lifecycle rules). */
export type GateTask = RuntimeTask & { taskKind: "gate" };

export type VerificationRequirement = {
  requirementId: string;
  requirementLevel: RequirementLevel;
  /** Member of CompletionPolicy.content.requirementKinds (guard-enforced). */
  kind: string;
  description: string;
};

export type AcceptanceObligation = {
  obligationId: string;
  title: string;
  requirementLevel: RequirementLevel;
  /**
   * Tasks responsible for evidence or reduction of this obligation
   * (work or gate; every element must reference a Task in the SAME plan).
   */
  taskIds: string[];
  /** Compiled verification requirements per the effective CompletionPolicy. */
  verificationRequirements: VerificationRequirement[];
};

/** parent_of ONLY expresses work-breakdown/read-model grouping. */
export type ParentOfEdge = {
  parentTaskId: string;
  childTaskId: string;
};

export type TaskHierarchy = {
  parentOf: ParentOfEdge[];
};

/** Every hard dependency states the output contract/artifact it needs. */
export type DependencyRequirement = {
  kind: "output-contract" | "artifact" | "decision" | "environment-revision" | "gate-result";
  label: string;
};

export type DependsOnEdge = {
  taskId: string;
  dependsOnId: string;
  requires: DependencyRequirement;
};

/** depends_on ONLY models real versioned-input/output dependencies. */
export type RuntimeExecutionDAG = {
  dependsOn: DependsOnEdge[];
};

export type PlanRevisionDraft = {
  schemaVersion: 1;
  planId: string;
  planRevision: number;
  /** local goalId within the command project. */
  goalId: string;
  stages: PlanStage[];
  tasks: RuntimeTask[];
  obligations: AcceptanceObligation[];
  taskHierarchy: TaskHierarchy;
  executionDag: RuntimeExecutionDAG;
};

// ------------------------------------------------------------------------ //
// Command / receipt                                                          //
// ------------------------------------------------------------------------ //

export type ApplyPlanRevisionCommand = {
  commandId: string;
  commandType: "ApplyPlanRevision";
  schemaVersion: 1;
  identity: CommandIdentity;
  /** local goalId (scoped to identity.projectId). */
  aggregateId: string;
  /** expected GOAL aggregate revision (CAS; 1 after CreateGoal). */
  expectedRevision: number;
  correlationId: string;
  submittedAt: string;
  payload: {
    plan: PlanRevisionDraft;
  };
};

export type PlanRevisionReceipt =
  | {
      status: "committed";
      commandId: string;
      replayed: boolean;
      planRef: PlanRevisionRef;
      goalRef: GoalRef;
      eventIds: string[];
      commitCursor: CommitCursor;
    }
  | {
      status: "rejected";
      commandId: string;
      code:
        | "invalid"
        | "not_found"
        | "unresolved_governance_ref"
        | "plan_guard_failed"
        | "revision_conflict"
        | "idempotency_conflict"
        | "unavailable";
      /** Present when code === "plan_guard_failed". */
      issues?: PlanValidationError[];
    };

// ------------------------------------------------------------------------ //
// PlanValidationError                                                        //
// ------------------------------------------------------------------------ //

export type PlanValidationCode =
  | "missing_required_executable_task"
  | "missing_active_required_goal_gate"
  | "missing_required_obligation"
  | "task_obligation_mapping"
  | "obligation_task_mapping"
  | "empty_verification_requirements"
  | "unknown_requirement_kind"
  | "dangling_task_ref"
  | "dangling_stage_ref"
  | "self_dependency"
  | "dag_cycle"
  | "hierarchy_cycle";

export type PlanValidationError = {
  path: string;
  code: PlanValidationCode;
  message: string;
};

// ------------------------------------------------------------------------ //
// Snapshot / event                                                          //
// ------------------------------------------------------------------------ //

export type PlanRevisionRef = {
  aggregateType: "PlanRevision";
  projectId: string;
  planId: string;
};

/**
 * Accepted plan revision — the immutable snapshot. The two effective
 * governance refs are FIXED PINS: later movement of the Project default
 * active refs never changes them; changing a pin requires a NEW
 * PlanRevision/PlanRebase (later tickets).
 */
export type PlanRevisionSnapshot = {
  ref: PlanRevisionRef;
  /** Aggregate revision: a plan is accepted once -> 1. */
  revision: 1;
  schemaVersion: 1;
  goalRef: GoalRef;
  planId: string;
  planRevision: number;
  acceptedAt: string;
  effectiveCompletionPolicy: CompletionPolicyPin;
  effectiveArchitectureBaseline: ArchitectureBaselinePin;
  stages: PlanStage[];
  tasks: RuntimeTask[];
  obligations: AcceptanceObligation[];
  taskHierarchy: TaskHierarchy;
  executionDag: RuntimeExecutionDAG;
};

export type PlanRevisionAcceptedEvent = {
  eventId: string;
  eventType: "PlanRevisionAccepted";
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: "PlanRevision";
  aggregateId: string;
  aggregateRevision: 1;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: {
    goalId: string;
    /** Goal aggregate revision after acceptance (canonical = expectedGoal + 1). */
    goalAggregateRevision: number;
    /** Full accepted snapshot (the ONLY source the ReadModel replays from). */
    planRevision: PlanRevisionSnapshot;
  };
};

/** Deterministic plan fingerprint (JCS + SHA-256; volatile fields excluded). */
export function applyPlanRevisionFingerprint(
  command: ApplyPlanRevisionCommand,
): CommandFingerprint {
  const shape = {
    schemaVersion: command.schemaVersion,
    commandType: command.commandType,
    projectId: command.identity.projectId,
    aggregateId: command.aggregateId,
    expectedRevision: command.expectedRevision,
    payload: { plan: command.payload.plan },
  };
  return sha256Hex(canonicalJson(shape)) as CommandFingerprint;
}

export function planValidationError(
  path: string,
  code: PlanValidationCode,
  message: string,
): PlanValidationError {
  return { path, code, message };
}
