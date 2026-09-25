// Migrated contract declarations; source provenance is recorded in the N0 transfer manifest.
// ------------------------------------------------------------------------ //
// Orthogonal Task dimensions (completion-policy.md §1 — never merged)      //
// ------------------------------------------------------------------------ //
export type RequirementLevel = "required" | "optional";
export type TaskKind = "work" | "gate";
export type Disposition = "active" | "deferred" | "cancelled" | "superseded";
export type Phase = "pending" | "ready" | "running" | "verifying" | "blocked" | "satisfied" | "failed";
export type TaskScope = {
    kind: "goal";
} | {
    kind: "stage";
    stageId: string;
} | {
    kind: "module";
    stageId: string;
    moduleRef: string;
};
/**
 * 任务承担者指派（任务 → 角色 + 指令）。
 *
 * 形状的唯一正文仍在 contracts/initial-planning.ts：初始规划响应的公开约定与它的解析
 * 规则（role 取值、instruction 非空有界、每个 work 任务恰好一条）都写在那里。这里只给它
 * 一个与 revision 语境一致的名字，避免同一形状出现第二份定义。
 */
export type PlanTaskAssignment = import('./initial-planning.js').InitialPlanAssignment;
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
    /**
     * 只在 disposition="superseded" 时有意义：该任务在后一个
     * PlanRevision 里由哪个任务接手（同一义务、同一验收语义，只换承担者）。
     * null 表示本次取消没有取代者。旧 revision 的任务不带本字段（未定义即无取代）。
     * 这是历史/处置视图的事实来源：任务本身不删除，只是退出默认视图。
     */
    replacedByTaskId?: string | null;
};
/** parent_of ONLY expresses work-breakdown/read-model grouping. */
type ParentOfEdge = {
    parentTaskId: string;
    childTaskId: string;
};
export type TaskHierarchy = {
    parentOf: ParentOfEdge[];
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
 * W1 accepted-Plan-only, compiler-owned execution-definition basis.
 *
 * Each entry names the immutable PlanRevision that currently owns one Task's
 * execution definition (its `RuntimeTask` fields, assignment, exact inputs and
 * carried obligation semantics). It is an ABSOLUTE ref, never a chain. An
 * accepted v2 Plan without this field is equivalent to every Task referencing
 * that same Plan (the legacy/self rule); old records are never rewritten.
 *
 * A Draft/Proposal input must never carry or control this field: only the
 * trusted adoption compiler derives it from the formal source plus the
 * validated future-only delta. Stage 1 declares the type only; generation,
 * inheritance and comparison live in `plan-task-basis.ts` and are not yet
 * implemented. See docs/refactor/tasks/W1-future-plan-skeleton.md §5.
 */
export type TaskStateBasisV1 = {
    schemaVersion: 1;
    entries: { taskId: string; planRef: PlanRevisionRef }[];
};

// Completed-capability migration: selected original declarations, no legacy service port.
/**
 * Versioned tasks, assignments, obligations and acceptance commands.
 * Control checks schema, references, non-empty obligations and hierarchy/DAG legality
 * before atomically accepting a revision; rejected commands do not write.
 * Task hierarchy, execution dependencies and display stages have distinct meanings.
 */
import type { ActorRef, CommandFingerprint, CommandIdentity } from "./command-event.js";
import { canonicalJson, sha256Hex } from "./fingerprint.js";
import type { GoalRef } from "./ledger.js";
import type { ArchitectureBaselinePin, CompletionPolicyPin } from "./governance.js";
// ------------------------------------------------------------------------ //
// Plan structures                                                           //
// ------------------------------------------------------------------------ //
export type PlanStage = {
    stageId: string;
    title: string;
    description?: string;
};
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
/** Every hard dependency states the output contract/artifact it needs. */
export type DependencyRequirement = {
    kind: "output-contract" | "artifact" | "decision" | "environment-revision" | "gate-result";
    label: string;
};
type DependsOnEdge = {
    taskId: string;
    dependsOnId: string;
    requires: DependencyRequirement;
};
/** depends_on ONLY models real versioned-input/output dependencies. */
export type RuntimeExecutionDAG = {
    dependsOn: DependsOnEdge[];
};
/** Advisory whiteboard relation; never a dispatch prerequisite by itself. */
export type TaskRelationV2 = {
    fromTaskId: string;
    toTaskId: string;
    kind: 'coordination' | 'expected_dependency';
    note: string;
};
/** Exact content input, checked only for the named consumer and reader. */
export type TaskInputRequirementV2 = {
    requirementId: string;
    consumerTaskId: string;
    kind: 'artifact';
    artifactRef: import('./artifact.js').ArtifactRef;
};
type PlanRevisionDraftBase = {
    reviewAdmissionProtocol?: 'independent-review-v1';
    origin?: import('./initial-planning.js').InitialPlanOrigin;
    planId: string;
    planRevision: number;
    /** local goalId within the command project. */
    goalId: string;
    stages: PlanStage[];
    tasks: RuntimeTask[];
    /**
     * 本 revision 的指派集合。它**随 revision 一起被接受**，「谁按什么指令承担这项
     * 任务」因此不会属于另一个版本。可选： 之前接受的 revision 没有这个字段，其任务的
     * 指派只可能来自同一个快照的 origin.assignments——读取一律经 revisionAssignments，
     * 调用方不自己挑字段。
     */
    assignments?: PlanTaskAssignment[];
    obligations: AcceptanceObligation[];
    taskHierarchy: TaskHierarchy;
    executionDag: RuntimeExecutionDAG;
};
/** V1 stays byte-compatible; V2 alone carries advisory relations and exact inputs. */
export type PlanRevisionDraft =
    | (PlanRevisionDraftBase & { schemaVersion: 1 })
    | (PlanRevisionDraftBase & { schemaVersion: 2;
        taskRelations?: TaskRelationV2[];
        inputRequirements?: TaskInputRequirementV2[];
    });
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
// ------------------------------------------------------------------------ //
// PlanValidationError                                                        //
// ------------------------------------------------------------------------ //
type PlanValidationCode = "missing_required_executable_task" | "missing_active_required_goal_gate" | "missing_required_obligation" | "task_obligation_mapping" | "obligation_task_mapping" | "empty_verification_requirements" | "unknown_requirement_kind" | "dangling_task_ref" | "dangling_stage_ref" | "self_dependency" | "dag_cycle" | "hierarchy_cycle" | "duplicate_requirement_id" | "obligation_semantics_changed" | "gate_definition_changed" | "role_not_authorized" | "task_removed" | "duplicate_task_id" | "unsupported_execution_change";
export type PlanValidationError = {
    path: string;
    code: PlanValidationCode;
    message: string;
};
/**
 * Accepted plan revision — the immutable snapshot. The two effective
 * governance refs are FIXED PINS: later movement of the Project default
 * active refs never changes them; changing a pin requires a NEW
 * PlanRevision or PlanRebase.
 */
type PlanRevisionSnapshotBase = {
    reviewAdmissionProtocol?: 'independent-review-v1';
    origin?: import('./initial-planning.js').InitialPlanOrigin;
    ref: PlanRevisionRef;
    /** Aggregate revision: a plan is accepted once -> 1. */
    revision: 1;
    goalRef: GoalRef;
    planId: string;
    planRevision: number;
    acceptedAt: string;
    effectiveCompletionPolicy: CompletionPolicyPin;
    effectiveArchitectureBaseline: ArchitectureBaselinePin;
    stages: PlanStage[];
    tasks: RuntimeTask[];
    /** 本 revision 的指派集合（见 PlanRevisionDraft.assignments 的说明）。 */
    assignments?: PlanTaskAssignment[];
    obligations: AcceptanceObligation[];
    taskHierarchy: TaskHierarchy;
    executionDag: RuntimeExecutionDAG;
};
export type PlanRevisionSnapshot =
    | (PlanRevisionSnapshotBase & { schemaVersion: 1 })
    | (PlanRevisionSnapshotBase & { schemaVersion: 2;
        taskRelations?: TaskRelationV2[];
        inputRequirements?: TaskInputRequirementV2[];
        /** W1 compiler-owned; absent means every Task points at this Plan. */
        taskStateBasis?: TaskStateBasisV1;
    });
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
export function applyPlanRevisionFingerprint(command: ApplyPlanRevisionCommand): CommandFingerprint {
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
export function planValidationError(path: string, code: PlanValidationCode, message: string): PlanValidationError {
    return { path, code, message };
}
export function planRevisionRefFor(command: ApplyPlanRevisionCommand): PlanRevisionRef {
    return {
        aggregateType: "PlanRevision",
        projectId: command.identity.projectId,
        planId: command.payload.plan.planId,
    };
}
export function goalRefFor(command: ApplyPlanRevisionCommand): GoalRef {
    return {
        aggregateType: "Goal",
        projectId: command.identity.projectId,
        goalId: command.aggregateId,
    };
}

/** Same accepted-snapshot assignment lookup used by the original implementation.
 * Explicit empty assignments override origin; absence alone uses the fallback. */
export function revisionAssignments(plan: {
  assignments?: PlanTaskAssignment[];
  origin?: import('./initial-planning.js').InitialPlanOrigin;
}): PlanTaskAssignment[] {
  const source = plan.assignments ?? plan.origin?.assignments ?? [];
  return source.map((entry) => ({ taskId: entry.taskId, role: entry.role, instruction: entry.instruction }));
}
