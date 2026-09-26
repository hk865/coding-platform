// Migrated contract declarations; source provenance is recorded in the N0 transfer manifest.
import type { PlanRevisionRef } from "./plan.js";
import type { TaskEnvelopeV1 } from "./task-envelope.js";
// ------------------------------------------------------------------------ //
// Aggregate refs                                                             //
// ------------------------------------------------------------------------ //
export type TaskTriple = {
    projectId: string;
    goalId: string;
    taskId: string;
};
export type TaskLeaseRef = {
    aggregateType: "TaskLease";
    projectId: string;
    goalId: string;
    taskId: string;
};
export type TaskAttemptRef = {
    aggregateType: "TaskAttempt";
    projectId: string;
    goalId: string;
    taskId: string;
    attemptId: string;
};
export type RunRef = {
    aggregateType: "Run";
    projectId: string;
    goalId: string;
    runId: string;
};
export type DispatchOutboxRef = {
    aggregateType: "DispatchOutboxEntry";
    projectId: string;
    goalId: string;
    taskId: string;
    attemptId: string;
};
// ------------------------------------------------------------------------ //
// Shared value types                                                         //
// ------------------------------------------------------------------------ //
/** Minimal versioned RoleBinding reference used by dispatch. */
export type RoleBindingRefV1 = {
    schemaVersion: 1;
    bindingId: string;
    templateId: string;
    /** template_revision of agent/templates/short-lived-agent.md. */
    templateRevision: string;
    /** Binding instance version; the Run references the exact version used. */
    bindingVersion: number;
    /** Authorization policy version the binding was resolved under (opaque; no registry in dispatch). */
    policyRevision: string;
};
/**
 * Versioned source reference. dispatch kinds are the sources a bounded envelope
 * can declare; further kinds extend with a versioned schema upgrade.
 */
export type SourceRefV1 = {
    kind: "plan-revision" | "workspace" | "governance" | "artifact" | "memory";
    refId: string;
    revision: string;
    digest?: string;
};
export type TaskBudgetV1 = {
    tokenBudget: number;
    deadline: string | null;
};
// ------------------------------------------------------------------------ //
// Runtime event protocol                                                    //
// ------------------------------------------------------------------------ //
type RuntimeEventType = "run_started" | "run_completed" | "run_crashed" | "run_cancelled" | "run_budget_exhausted";
export type RuntimeEventV1 = {
    eventType: RuntimeEventType;
    schemaVersion: 1;
    /** Runtime-adapter-assigned event id (unique per run in practice). */
    eventId: string;
    runRef: RunRef;
    /** Per-run strictly increasing sequence; the ordering authority for dedupe. */
    sequence: number;
    occurredAt: string;
    payload: {
        kind: "started";
        startedAt: string;
    } | {
        kind: "completed";
        exitCode: number;
    } | {
        kind: "crashed";
        error: string;
    } | {
        kind: "cancelled";
        reason: string;
    } | {
        kind: "budget_exhausted";
        exhaustedAt: string;
    };
};
// ------------------------------------------------------------------------ //
// Run / attempt / outbox status                                             //
// ------------------------------------------------------------------------ //
export type RunStatus = "starting" | "running" | "ended";
export type RunOutcome = "completed" | "failed" | "cancelled" | "budget_exhausted" | "crashed" | "outcome_unknown";
export type ExecutionAuthorizationV1 = {
    generation: number;
    consumerId: string;
    phase: 'authorized' | 'entered' | 'revoked' | 'quarantined' | 'settled';
};
/**
 * Versioned multi-driver entry authorization. It is the V2 projection stored in
 * the existing `RunSnapshot.executionAuthorization` slot; no separate
 * RuntimeEntry aggregate is created. `generation` is the public entryGeneration
 * and is intentionally distinct from `sessionGeneration`; `revision` is the
 * entry binding's own version, never the Run revision.
 */
export type ExecutionAuthorizationV2 = {
    schemaVersion: 2;
    generation: number;
    sessionGeneration: number;
    revision: number;
    consumerId: string;
    inputDigest: string;
    phase: 'authorized' | 'entering' | 'entered' | 'unknown' | 'revoked' | 'settled';
    kernel: import('./core/execution-history.js').RunExecutionHistoryV1['kernel'] | null;
};
export type RunReconciliationV1 = {
    status: 'done' | 'cancelled' | 'quarantined';
    observation: {
        kind: 'runtime_terminal';
        event: RuntimeEventV1;
        digest: string;
    } | {
        kind: 'unresolved';
        reason: string;
    };
    recordedAt: string;
};
export type RunSnapshot = {
    /** Optional for unindexed/legacy executions; does not imply entry permission. */
    executionHistory?: import('./core/execution-history.js').RunExecutionHistoryV1;
    reconciliation?: RunReconciliationV1;
    /** Only an unconsumed authorization can be fenced and retried without a new TaskAttempt. */
    executionAuthorization?: ExecutionAuthorizationV1 | ExecutionAuthorizationV2;
    /** Canonical desired state; updated atomically with its ControlIntent. */
    controlState?: {
        intentRef: import('./control-intent.js').ControlIntentRef;
        desiredState: 'running' | 'paused' | 'cancelled' | 'steered';
    };
    /** Immutable actual Context binding. Absent on historical runs; never inferred. */
    inputBinding?: RuntimeInputBindingV1;
    work?: import('./reviewer-work.js').ReviewWorkBinding;
    ref: RunRef;
    revision: number;
    schemaVersion: 1;
    task: TaskTriple;
    attemptId: string;
    planRef: PlanRevisionRef;
    roleBinding: RoleBindingRefV1;
    budget: TaskBudgetV1;
    workspaceSnapshot: {
        workspaceId: string;
        revision: number;
    };
    status: RunStatus;
    outcome: RunOutcome | null;
    /** exitCode of the LAST run_completed event (null until then). NEVER a satisfaction signal. */
    exitCode: number | null;
    /** Highest runtime event sequence applied so far (0 before any fact). */
    lastEventSeq: number;
    /** Runtime-event id with lastEventSeq ("" before any fact). */
    lastRuntimeEventId: string;
    /** Domain event id of the run-fact commit that applied lastEventSeq ("" before any fact). */
    lastFactEventId: string;
    /** The bounded envelope recorded at start (the Run input). */
    envelope: TaskEnvelopeV1 | null;
    startedAt: string | null;
    endedAt: string | null;
};
export type RuntimeInputBindingV1 = {
    schemaVersion: 1;
    inputDigest: string;
    manifestDigest: string;
    /** Exact delivery grants pinned at assembly; absence in historical bindings denies new calls. */
    materialAccessRefs: import("./material-access.js").MaterialAccessGrantRef[];
    /** Exact additional bodies actually assembled outside Delivery; all require the pinned grants. */
    additionalMaterialRefs?: import("./artifact.js").ArtifactRef[];
    deliveryRefs: ModelRequestMaterialPinV1[];
};
/**
 * **一次性模型调用许可**（协作通信可靠投递规则中的“调用证据”）。
 *
 * 为什么需要它：`authorized` / `attempted` 必须是**两件不同的事实**，不能互相代替。Control 在
 * 复核「exact Run + 材料版本 + 授权」之后签发它；Runtime 侧的一次**调用尝试**消费它。
 *
 * **一次许可只能对应一次调用尝试**：许可聚合只有 @1（已签发）与 @2（已尝试）两个版本，
 * 第二次尝试用同一许可会因为 CAS@1 失败而被**账本**拒绝（不是靠调用方自觉）。
 *
 * 边界（如实）：当前实现**不写**任何 ack。今天唯一可得的 provider 信号是 Runtime 计量里的
 * `MeterEntry.status = 'reported'`，而它只说明「用量被报出来了」，**不等于** provider 对这次
 * 调用的可验证回执。因此这里没有 `acknowledgedAt` 之类的字段——一个永远为 null 的字段不是证据。
 */
export type ModelRequestMaterialPinV1 = {
    aggregateType: "Delivery";
    projectId: string;
    workspaceId: string;
    deliveryId: string;
};
export type ModelRequestPermitRef = {
    aggregateType: "ModelRequestPermit";
    projectId: string;
    workspaceId: string;
    permitId: string;
};

/** Existing model-call admission protocol; implementation remains the caller's responsibility. */
export interface ModelCallAccess {
  bind(input: { inputDigest: string; manifestDigest: string; materialAccessRefs?: import('./material-access.js').MaterialAccessGrantRef[]; additionalMaterialRefs?: import('./artifact.js').ArtifactRef[] }): Promise<void>;
  beforeCall(input: { requestId: string; requestDigest: string; contextInputDigest: string; manifestDigest: string }): Promise<void>;
}

// Completed-capability migration: selected original declarations, no legacy service port.
import type { DependencyRequirement, Disposition, Phase } from "./plan.js";
/** 角色矩阵准入失败的具体原因；沿用既有 receipt 码，只细化 reason。 */
export type RoleBindingInadmissibleDetail = "role_not_registered" | "role_spec_not_installed" | "role_spec_stale" | "permissions_exceed_spec";
export type TaskIneligibilityReason = {
    code: "task_state_incomplete";
    taskId: string;
    message: string;
} | {
    code: "goal_not_active";
    message: string;
} | {
    code: "plan_not_accepted";
    message: string;
} | {
    code: "task_not_found";
    taskId: string;
    message: string;
} | {
    code: "task_kind_not_work";
    taskId: string;
    taskKind: string;
    message: string;
} | {
    code: "task_not_active";
    taskId: string;
    disposition: Disposition;
    message: string;
} | {
    code: "task_phase_not_dispatchable";
    taskId: string;
    phase: Phase;
    blocked: boolean;
    message: string;
} | {
    code: "deps_unsatisfied";
    taskId: string;
    deps: {
        dependsOnId: string;
        requires: DependencyRequirement;
        phase: Phase | "missing";
    }[];
    message: string;
} | {
    code: "resource_unavailable";
    taskId: string;
    detail: "leased" | "budget_exhausted" | "deadline_passed";
    message: string;
} | {
    /** 明示意图 `plan_only` 的节点即使已有 assignment 也不是可领取候选； */
    /** 它只说明本次采用的编排意图，不是角色授权或 ready。 */
    code: "task_planning_only";
    taskId: string;
    message: string;
} | {
    /** work 节点没有任何 assignment 时的结构缺口（不是角色许可失败）。 */
    code: "task_assignment_missing";
    taskId: string;
    message: string;
}
/**
 * 角色绑定与项目角色矩阵／角色规格不符。claim 的**顶层**拒绝码仍然是既有的
 * `ineligible`（不新造 receipt 码）；这条 reason 只负责说明是哪一项不符，与
 * ReplacementIneligibilityReason 的 stale_packet／packet_mismatch 是同一处置方式。
 * 命中即零写入，不会留下 lease／attempt／run／outbox。
 */
 | {
    code: "role_binding_not_admissible";
    roleId: string;
    detail: RoleBindingInadmissibleDetail;
    message: string;
};
export type TaskEligibility = {
    eligible: true;
    reasons: [
    ];
} | {
    eligible: false;
    reasons: TaskIneligibilityReason[];
};

// Completed-capability migration: selected original declarations, no legacy service port.
export type TaskAttemptStatus = "claimed" | "started" | "ended";
// ------------------------------------------------------------------------ //
// Canonical snapshots                                                        //
// ------------------------------------------------------------------------ //
/** Versioned release stamp added to the existing @1 TaskLease body. A lease
 * without it is a legacy active lease; release is never inferred from expiresAt. */
export type TaskLeaseReleaseV1 = {
    schemaVersion: 1;
    runRef: RunRef;
    attemptRef: TaskAttemptRef;
    sessionRef: import('./core/identity.js').SessionRef;
    generation: number;
    releasedAt: string;
    eventId: string;
};
export type TaskLeaseSnapshot = {
    ref: TaskLeaseRef;
    revision: number;
    schemaVersion: 1;
    holderRunId: string;
    attemptId: string;
    grantedAt: string;
    expiresAt: string | null;
    /** Present only after a real same-owner/same-generation terminal release. */
    release?: TaskLeaseReleaseV1;
};
export type TaskAttemptSnapshot = {
    work?: import('./reviewer-work.js').ReviewWorkBinding;
    ref: TaskAttemptRef;
    revision: number;
    schemaVersion: 1;
    runId: string;
    planRef: PlanRevisionRef;
    status: TaskAttemptStatus;
    startedAt: string | null;
    endedAt: string | null;
    endOutcome: RunOutcome | null;
};
