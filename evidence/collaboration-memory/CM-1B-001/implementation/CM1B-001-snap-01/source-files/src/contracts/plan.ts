/**
 * Versioned tasks, assignments, obligations and acceptance commands.
 * Control checks schema, references, non-empty obligations and hierarchy/DAG legality
 * before atomically accepting a revision; rejected commands do not write.
 * Task hierarchy, execution dependencies and display stages have distinct meanings.
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

/**
 * 任务承担者指派（任务 → 角色 + 指令）。
 *
 * 形状的唯一正文仍在 contracts/initial-planning.ts：初始规划响应的公开约定与它的解析
 * 规则（role 取值、instruction 非空有界、每个 work 任务恰好一条）都写在那里。这里只给它
 * 一个与 revision 语境一致的名字，避免同一形状出现第二份定义。
 */
export type PlanTaskAssignment = import('./initial-planning.js').InitialPlanAssignment;

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
  /**
   * ADR 0003 D1: 只在 disposition="superseded" 时有意义——该任务在**后一个**
   * PlanRevision 里由哪个任务接手（同一义务、同一验收语义，只换承担者）。
   * null 表示本次取消没有取代者。旧 revision 的任务不带本字段（未定义即无取代）。
   * 这是历史/处置视图的事实来源：任务本身不删除，只是退出默认视图。
   */
  replacedByTaskId?: string | null;
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

/** parent_of ONLY expresses work-breakdown/read-model grouping. */
type ParentOfEdge = {
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

type DependsOnEdge = {
  taskId: string;
  dependsOnId: string;
  requires: DependencyRequirement;
};

/** depends_on ONLY models real versioned-input/output dependencies. */
export type RuntimeExecutionDAG = {
  dependsOn: DependsOnEdge[];
};

export type PlanRevisionDraft = {
  reviewAdmissionProtocol?: 'independent-review-v1';
  schemaVersion: 1;
  origin?: import('./initial-planning.js').InitialPlanOrigin;
  planId: string;
  planRevision: number;
  /** local goalId within the command project. */
  goalId: string;
  stages: PlanStage[];
  tasks: RuntimeTask[];
  /**
   * 本 revision 的指派集合。它**随 revision 一起被接受**，「谁按什么指令承担这项
   * 任务」因此不会属于另一个版本。可选：RW-07 之前接受的 revision 没有这个字段，其任务的
   * 指派只可能来自同一个快照的 origin.assignments——读取一律经 revisionAssignments，
   * 调用方不自己挑字段。
   */
  assignments?: PlanTaskAssignment[];
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

type PlanValidationCode =
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
  reviewAdmissionProtocol?: 'independent-review-v1';
  origin?: import('./initial-planning.js').InitialPlanOrigin;
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
  /** 本 revision 的指派集合（见 PlanRevisionDraft.assignments 的说明）。 */
  assignments?: PlanTaskAssignment[];
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

/**
 * 一个 revision 的指派集合的唯一读取入口。
 *
 * 顺序：先取 revision 自带的 assignments；没有时取**同一个快照内** origin 的 assignments
 * （初始规划提案给出的指派随该 revision 一起被接受，就落在快照的 origin 里）；两者都没有
 * 就返回空数组。这不是两套真相：接受时逐字沿用，同一个 revision 上两者不会给出不同结果，
 * 回退兼容尚无顶层 assignments、仅在 origin 保存指派的已接受旧 revision。
 *
 * 为什么必须由契约提供：派发（DispatchEngine）、计划变更守卫（ControlEngine 策略）与返工
 * 编译器都要拿同一份指派。若各自挑字段，就会出现"派发按 origin 读、守卫按 assignments 判"
 * 这类分叉。旧计划仍有消费者时必须保留同快照回退，不据此扩大指派或授权。
 */
export function revisionAssignments(plan: {
  assignments?: PlanTaskAssignment[];
  origin?: import('./initial-planning.js').InitialPlanOrigin;
}): PlanTaskAssignment[] {
  const source = plan.assignments ?? plan.origin?.assignments ?? [];
  return source.map((entry) => ({ taskId: entry.taskId, role: entry.role, instruction: entry.instruction }));
}
