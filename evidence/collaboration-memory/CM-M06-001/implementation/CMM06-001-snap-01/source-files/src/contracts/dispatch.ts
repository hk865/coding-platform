/**
 * Run identities, role-binding references and observed runtime facts.
 * Run completion never sets Task phase. Control admits claims, starts and facts;
 * monotonic per-run sequences reject duplicate/stale/conflicting facts without writes.
 * The role-spec and admission protocols resolve the referenced role and permissions.
 */
import type { ActorRef, CommandFingerprint, CommandIdentity, CommitCursor } from "./command-event.js";
import { canonicalJson, sha256Hex } from "./fingerprint.js";
import type { DependencyRequirement, Disposition, Phase, PlanRevisionRef, PlanRevisionSnapshot } from "./plan.js";
import type { ContextManifestV1, TaskEnvelopeV1 } from "./task-envelope.js";
// 仅类型（运行时被擦除；context-continuity 也 type-import 本文件的 RunRef/RoleBindingRefV1）：
// 已受理的协作后继必须在派发期使用 admission 固定的 Work，见 DispatchIntentV1.admittedWorkRef。
import type { WorkContextRef } from "./context-continuity.js";

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

export function taskLeaseRefFor(projectId: string, goalId: string, taskId: string): TaskLeaseRef {
  return { aggregateType: "TaskLease", projectId, goalId, taskId };
}

export function taskAttemptRefFor(
  projectId: string,
  goalId: string,
  taskId: string,
  attemptId: string,
): TaskAttemptRef {
  return { aggregateType: "TaskAttempt", projectId, goalId, taskId, attemptId };
}

export function runRefFor(projectId: string, goalId: string, runId: string): RunRef {
  return { aggregateType: "Run", projectId, goalId, runId };
}

export function dispatchOutboxRefFor(
  projectId: string,
  goalId: string,
  taskId: string,
  attemptId: string,
): DispatchOutboxRef {
  return { aggregateType: "DispatchOutboxEntry", projectId, goalId, taskId, attemptId };
}

// ------------------------------------------------------------------------ //
// Shared value types                                                         //
// ------------------------------------------------------------------------ //

/** Minimal versioned RoleBinding reference (no full RoleBinding contract yet — P1-15). */
export type RoleBindingRefV1 = {
  schemaVersion: 1;
  bindingId: string;
  templateId: string;
  /** template_revision of agent/templates/short-lived-agent.md. */
  templateRevision: string;
  /** Binding instance version; the Run references the exact version used. */
  bindingVersion: number;
  /** Authorization policy version the binding was resolved under (opaque; no registry in P1-03). */
  policyRevision: string;
};

/**
 * Versioned source reference. P1-03 kinds are the sources a bounded envelope
 * can declare; further kinds extend with a versioned schema upgrade.
 */
export type SourceRefV1 = {
  kind: "plan-revision" | "workspace" | "governance" | "artifact";
  refId: string;
  revision: string;
  digest?: string;
};

export type TaskBudgetV1 = {
  tokenBudget: number;
  deadline: string | null;
};

// ------------------------------------------------------------------------ //
// RuntimeEvent (contract #5)                                                //
// ------------------------------------------------------------------------ //

type RuntimeEventType =
  | "run_started"
  | "run_completed"
  | "run_crashed"
  | "run_cancelled"
  | "run_budget_exhausted";

export const RUNTIME_EVENT_TYPES: readonly RuntimeEventType[] = [
  "run_started",
  "run_completed",
  "run_crashed",
  "run_cancelled",
  "run_budget_exhausted",
];

const TERMINAL_RUNTIME_EVENT_TYPES: readonly RuntimeEventType[] = [
  "run_completed",
  "run_crashed",
  "run_cancelled",
  "run_budget_exhausted",
];

export function isTerminalRuntimeEvent(event: RuntimeEventV1): boolean {
  return (TERMINAL_RUNTIME_EVENT_TYPES as readonly string[]).includes(event.eventType);
}

/**
 * The outcome a terminal RuntimeEvent contributes. NEVER maps to Task.phase —
 * satisfaction is P1-04 evidence reduction.
 */
export function runtimeEventTerminalOutcome(event: RuntimeEventV1): RunOutcome | null {
  switch (event.eventType) {
    case "run_completed":
      return "completed";
    case "run_crashed":
      return "crashed";
    case "run_cancelled":
      return "cancelled";
    case "run_budget_exhausted":
      return "budget_exhausted";
    case "run_started":
      return null;
  }
}

export type RuntimeEventV1 = {
  eventType: RuntimeEventType;
  schemaVersion: 1;
  /** Runtime-adapter-assigned event id (unique per run in practice). */
  eventId: string;
  runRef: RunRef;
  /** Per-run strictly increasing sequence; the ordering authority for dedupe. */
  sequence: number;
  occurredAt: string;
  payload:
    | { kind: "started"; startedAt: string }
    | { kind: "completed"; exitCode: number }
    | { kind: "crashed"; error: string }
    | { kind: "cancelled"; reason: string }
    | { kind: "budget_exhausted"; exhaustedAt: string };
};

// ------------------------------------------------------------------------ //
// Run / attempt / outbox status                                             //
// ------------------------------------------------------------------------ //

export type RunStatus = "starting" | "running" | "ended";
export type RunOutcome =
  | "completed"
  | "failed"
  | "cancelled"
  | "budget_exhausted"
  | "crashed"
  | "outcome_unknown";
export type TaskAttemptStatus = "claimed" | "started" | "ended";
type DispatchOutboxStatus = "pending" | "started" | "done";

// ------------------------------------------------------------------------ //
// DispatchIntent (contract #1 — durable outbox intent)                      //
// ------------------------------------------------------------------------ //

export type DispatchIntentV1 = {
  work?: import('./reviewer-work.js').ReviewWorkBinding;
  /**
   * 本次 Run 的**工作身份已由协作受理固定**（CM-1A-001 owner 裁决，第 2 步 / R7）。
   *
   * 只有 `communication-successor-claim` 产生的后继 intent 会带它，值就是那次
   * CommunicationAdmission 记录的 workContextRef。派发收口（ensureWorkIdentity）见到它必须
   * **直接使用**这个 Work（link 本 Run 即可），**不得**再按 (goal, task) 解析：
   * 解析是普通任务的兜底规则，而返工替换链会让「按任务解析出的起源任务」与「等待所属的 Work」
   * 不是同一个 —— 那正是 R7：后继会被送进另一个 Work，丢掉等待与它已经积累的上下文。
   * 缺省（普通任务）语义不变：按 (project, workspace, goal, 起源任务) 解析既有身份。
   */
  admittedWorkRef?: WorkContextRef;
  schemaVersion: 1;
  /** 1:1 with the attempt (intentId === attemptId) — deterministic. */
  intentId: string;
  projectId: string;
  workspaceId: string;
  goalId: string;
  taskId: string;
  planRef: PlanRevisionRef;
  attemptRef: TaskAttemptRef;
  runRef: RunRef;
  roleBinding: RoleBindingRefV1;
  /** Canonical Workspace revision bound at claim (no worktree digest machinery in P1-03). */
  workspaceSnapshot: { workspaceId: string; revision: number };
  declaredPermissions: { tools: string[]; writeScope: string[] };
  budget: TaskBudgetV1;
  requestedAt: string;
  correlationId: string;
};

// ------------------------------------------------------------------------ //
// Canonical snapshots                                                        //
// ------------------------------------------------------------------------ //

export type TaskLeaseSnapshot = {
  ref: TaskLeaseRef;
  revision: number;
  schemaVersion: 1;
  holderRunId: string;
  attemptId: string;
  grantedAt: string;
  expiresAt: string | null;
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

export type ExecutionAuthorizationV1 = { generation: number; consumerId: string; phase: 'authorized' | 'entered' | 'revoked' | 'quarantined' | 'settled' };

export type RunReconciliationV1 = {
  status: 'done' | 'cancelled' | 'quarantined';
  observation: { kind: 'runtime_terminal'; event: RuntimeEventV1; digest: string } | { kind: 'unresolved'; reason: string };
  recordedAt: string;
};
export type ReconcileRunCommand = Omit<RunFactCommand, 'commandType' | 'payload'> & { commandType: 'ReconcileRun'; payload: { runRef: RunRef } };
export type RunReconciledEvent = Omit<RunEventRecordedEvent, 'eventType' | 'payload'> & { eventType: 'RunReconciled'; payload: { run: RunSnapshot } };

export type RunSnapshot = {
  reconciliation?: RunReconciliationV1;
  /** Only an unconsumed authorization can be fenced and retried without a new TaskAttempt. */
  executionAuthorization?: ExecutionAuthorizationV1;
  /** Canonical desired state; updated atomically with its ControlIntent. */
  controlState?: { intentRef: import('./control-intent.js').ControlIntentRef; desiredState: 'running' | 'paused' | 'cancelled' | 'steered' };
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
  workspaceSnapshot: { workspaceId: string; revision: number };
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

export type DispatchOutboxEntrySnapshot = {
  /** Mechanical retries before dispatch-start; never a new domain TaskAttempt. */
  schedule?: { availableAt: string; attemptCount: number; lastFailure: string; quarantined: boolean };
  ref: DispatchOutboxRef;
  revision: number;
  schemaVersion: 1;
  status: DispatchOutboxStatus;
  intent: DispatchIntentV1;
  pendingAt: string;
  startedAt: string | null;
  doneAt: string | null;
};

// ------------------------------------------------------------------------ //
// Domain events (P1-03 v1)                                                  //
// ------------------------------------------------------------------------ //

export type TaskClaimedEvent = {
  eventId: string;
  eventType: "TaskClaimed";
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: "TaskLease";
  aggregateId: string;
  aggregateRevision: 1;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: {
    goalId: string;
    taskId: string;
    attemptRef: TaskAttemptRef;
    runRef: RunRef;
    planRef: PlanRevisionRef;
    roleBinding: RoleBindingRefV1;
    declaredPermissions: { tools: string[]; writeScope: string[] };
    budget: TaskBudgetV1;
    intentId: string;
    claimedAt: string;
  };
};

export type RunStartedEvent = {
  eventId: string;
  eventType: "RunStarted";
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: "Run";
  aggregateId: string;
  aggregateRevision: number;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: {
    taskId: string;
    attemptId: string;
    envelope: TaskEnvelopeV1;
    manifest: ContextManifestV1;
    executionAuthorization?: ExecutionAuthorizationV1;
    startedAt: string;
  };
};

export type RunEventRecordedEvent = {
  eventId: string;
  eventType: "RunEventRecorded";
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: "Run";
  aggregateId: string;
  aggregateRevision: number;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: {
    taskId: string;
    runtimeEvent: RuntimeEventV1;
  };
};

/** Explicit "no terminal signal" fact — projected SEPARATELY from crash. */
export type RunOutcomeUnknownEvent = {
  eventId: string;
  eventType: "RunOutcomeUnknown";
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: "Run";
  aggregateId: string;
  aggregateRevision: number;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: {
    taskId: string;
    reason: string;
    observedAt: string;
  };
};

// ------------------------------------------------------------------------ //
// Eligibility (readiness) — PURE decision, table-testable                    //
// ------------------------------------------------------------------------ //

export type DispatchReadinessFacts = {
  projectId: string;
  goalId: string;
  goalDesiredState: string;
  goalActivePlanRevision: PlanRevisionRef | null;
  plan: PlanRevisionSnapshot | null;
  lease: { status: "none" } | { status: "leased"; holderRunId: string; grantedAt: string };
  resource: { tokenBudget: number; deadline: string | null; now: string };
};

/** 角色绑定不可受理的具体原因（RW-11；沿用既有 receipt 码，只细化 reason）。 */
export type RoleBindingInadmissibleDetail =
  | "role_not_registered"
  | "role_spec_not_installed"
  | "role_spec_stale"
  | "permissions_exceed_spec";

export type TaskIneligibilityReason =
  | { code: "goal_not_active"; message: string }
  | { code: "plan_not_accepted"; message: string }
  | { code: "task_not_found"; taskId: string; message: string }
  | { code: "task_kind_not_work"; taskId: string; taskKind: string; message: string }
  | { code: "task_not_active"; taskId: string; disposition: Disposition; message: string }
  | {
      code: "task_phase_not_dispatchable";
      taskId: string;
      phase: Phase;
      blocked: boolean;
      message: string;
    }
  | {
      code: "deps_unsatisfied";
      taskId: string;
      deps: { dependsOnId: string; requires: DependencyRequirement; phase: Phase | "missing" }[];
      message: string;
    }
  | {
      code: "resource_unavailable";
      taskId: string;
      detail: "leased" | "budget_exhausted" | "deadline_passed";
      message: string;
    }
  /**
   * RW-11：角色绑定与项目角色矩阵/角色规格不符。claim 的**顶层**拒绝码仍然是既有的
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

export type TaskEligibility =
  | { eligible: true; reasons: [] }
  | { eligible: false; reasons: TaskIneligibilityReason[] };

// ------------------------------------------------------------------------ //
// Readiness query (Control read-only entry)                                  //
// ------------------------------------------------------------------------ //

export type DispatchReadinessQuery = {
  projectId: string;
  goalId: string;
  taskId: string;
  /** Declared budget for the resource check (optional; the lease is always checked). */
  budget?: TaskBudgetV1;
};

export type DispatchReadinessResult =
  | {
      status: "ready";
      eligibility: TaskEligibility;
      goalRevision: number;
      workspaceRevision: number;
      planRef: PlanRevisionRef;
    }
  | { status: "not_found"; code: "goal" | "workspace" | "plan" };

// ------------------------------------------------------------------------ //
// Commands / receipts                                                        //
// ------------------------------------------------------------------------ //

export type DispatchClaimCommand = {
  commandId: string;
  commandType: "DispatchClaimTask";
  schemaVersion: 1;
  identity: CommandIdentity;
  /** taskId — the TaskLease aggregate. */
  aggregateId: string;
  /** expected TaskLease revision (the first claim is always @0). */
  expectedRevision: number;
  correlationId: string;
  submittedAt: string;
  payload: {
    goalId: string;
    attemptId: string;
    runId: string;
    roleBinding: RoleBindingRefV1;
    declaredPermissions: { tools: string[]; writeScope: string[] };
    budget: TaskBudgetV1;
  };
};

export type DispatchClaimReceipt =
  | {
      status: "committed";
      commandId: string;
      replayed: boolean;
      leaseRef: TaskLeaseRef;
      attemptRef: TaskAttemptRef;
      runRef: RunRef;
      outboxRef: DispatchOutboxRef;
      eventIds: string[];
      commitCursor: CommitCursor;
    }
  | {
      status: "rejected";
      commandId: string;
      code:
        | "invalid"
        | "ineligible"
        | "not_found"
        | "revision_conflict"
        | "idempotency_conflict"
        | "unavailable";
      issues?: TaskIneligibilityReason[];
      currentRevision?: number;
    };

export type DispatchStartCommand = {
  commandId: string;
  commandType: "DispatchStartRun";
  schemaVersion: 1;
  identity: CommandIdentity;
  /** runId — the Run aggregate. */
  aggregateId: string;
  /** expected Run revision (1 right after claim). */
  expectedRevision: number;
  correlationId: string;
  submittedAt: string;
  payload: {
    envelope: TaskEnvelopeV1;
    manifest: ContextManifestV1;
    executionConsumerId?: string;
  };
};

export type DispatchStartReceipt =
  | {
      status: "committed";
      commandId: string;
      replayed: boolean;
      runRef: RunRef;
      outboxRef: DispatchOutboxRef;
      eventIds: string[];
      commitCursor: CommitCursor;
    }
  | {
      status: "rejected";
      commandId: string;
      code:
        | "invalid"
        | "not_found"
        | "stale_binding"
        | "revision_conflict"
        | "idempotency_conflict"
        | "unavailable";
      currentRevision?: number;
    };

export type DispatchDeferredEvent = Omit<RunStartedEvent, 'eventType' | 'aggregateType' | 'aggregateRevision' | 'payload'> & {
  eventType: 'DispatchDeferred'; aggregateType: 'DispatchOutboxEntry'; aggregateRevision: number;
  payload: { outbox: DispatchOutboxEntrySnapshot };
};
export type DispatchBacklog = {
  pending: number; due: number; delayed: number; quarantined: number;
  oldestPendingAt: string | null; oldestPendingAgeMs: number | null; nextAvailableAt: string | null;
  blocked: Array<{ intentId: string; reason: string; availableAt: string; quarantined: boolean }>;
};

export type RuntimeInputBindingV1 = {
  schemaVersion: 1;
  inputDigest: string;
  manifestDigest: string;
  /** Exact delivery grants pinned at assembly; absence in historical bindings denies new calls. */
  materialAccessRefs: import("./material-access.js").MaterialAccessGrantRef[];
  deliveryRefs: ModelRequestMaterialPinV1[];
};

/** Host callback; Runtime never imports Control or owns canonical authorization. */
export interface ModelCallAccess {
  bind(input: { inputDigest: string; manifestDigest: string; materialAccessRefs?: import("./material-access.js").MaterialAccessGrantRef[] }): Promise<void>;
  beforeCall(input: { requestId: string; requestDigest: string; contextInputDigest: string; manifestDigest: string }): Promise<void>;
}

export type RuntimeInputBoundEvent = Omit<ModelRequestAuthorizedEvent,
  'eventType' | 'aggregateType' | 'aggregateRevision' | 'payload'> & {
  eventType: 'RuntimeInputBound';
  aggregateType: 'Run';
  aggregateRevision: number;
  payload: { binding: RuntimeInputBindingV1 };
};

export type ExecutionEnteredEvent = Omit<RuntimeInputBoundEvent, 'eventType' | 'payload'> & {
  eventType: 'ExecutionEntered'; payload: { authorization: ExecutionAuthorizationV1 };
};
export type ExecutionRetryScheduledEvent = Omit<RuntimeInputBoundEvent, 'eventType' | 'payload'> & {
  eventType: 'ExecutionRetryScheduled'; payload: { run: RunSnapshot; attempt: TaskAttemptSnapshot; outbox: DispatchOutboxEntrySnapshot; reason: string };
};

export type RunFactV1 =
  | { kind: 'execution_entered'; runRef: RunRef; generation: number; consumerId: string }
  | { kind: 'execution_retry'; runRef: RunRef; generation: number; consumerId: string; reason: string }
  | { kind: "dispatch_deferred"; runRef: RunRef; reason: string }
  | { kind: "runtime_event"; event: RuntimeEventV1 }
  | { kind: "runtime_input_bound"; runRef: RunRef; binding: RuntimeInputBindingV1 }
  /** Explicit "no terminal signal" fact — carries its Run identity (mirrors runtime_event). */
  | { kind: "outcome_unknown"; runRef: RunRef; reason: string }
  /**
   * Control 复核「exact Run + 材料版本 + 授权」之后**签发**一次性许可（D06 的
   * provider_call_authorized，由 Control 侧事实给出，不由 Runtime 事件冒充）。
   */
  | { kind: "model_request_authorized"; runRef: RunRef; permit: ModelRequestPermitV1 }
  /**
   * Runtime 侧的一次**调用尝试**：摘要在实际 stream(request) 边界计算，并经正式事实通道落账。
   * 它**消费**同一许可（第二次尝试会被账本拒绝），并且**不**代表 provider 已经确认收到。
   */
  | {
      kind: "model_request_evidence";
      runRef: RunRef;
      permitId: string;
      attemptId: string;
      requestDigest: string;
      contextInputDigest: string;
      deliveryRefs: ModelRequestMaterialPinV1[];
      observedAt: string;
    };

/**
 * **一次性模型调用许可**（CM-1A-001 第 4 步 / D06「调用证据」）。
 *
 * 为什么需要它：`authorized` / `attempted` 必须是**两件不同的事实**，不能互相代替。Control 在
 * 复核「exact Run + 材料版本 + 授权」之后签发它；Runtime 侧的一次**调用尝试**消费它。
 *
 * **一次许可只能对应一次调用尝试**：许可聚合只有 @1（已签发）与 @2（已尝试）两个版本，
 * 第二次尝试用同一许可会因为 CAS@1 失败而被**账本**拒绝（不是靠调用方自觉）。
 *
 * 边界（如实）：本票**不写**任何 ack。今天唯一可得的 provider 信号是 Runtime 计量里的
 * `MeterEntry.status = 'reported'`，而它只说明「用量被报出来了」，**不等于** provider 对这次
 * 调用的可验证回执。因此这里没有 `acknowledgedAt` 之类的字段——一个永远为 null 的字段不是证据。
 */
export type ModelRequestMaterialPinV1 = {
  aggregateType: "Delivery";
  projectId: string;
  workspaceId: string;
  deliveryId: string;
};

export function modelRequestPermitIdFor(runRef: RunRef, requestId: string): string {
  return 'call-' + sha256Hex(canonicalJson({ runRef, requestId }));
}

export type ModelRequestPermitRef = {
  aggregateType: "ModelRequestPermit";
  projectId: string;
  workspaceId: string;
  permitId: string;
};

export type ModelRequestPermitV1 = {
  schemaVersion: 1;
  permitId: string;
  runRef: RunRef;
  /** Historical permits lack these pins and cannot authorize a new actual call. */
  requestId?: string;
  requestDigest?: string;
  contextInputDigest?: string;
  manifestDigest?: string;
  /** 本次许可固定的**材料版本**（这次调用必须消费的 Delivery 精确引用；按 canonical key 升序）。 */
  deliveryRefs: ModelRequestMaterialPinV1[];
  /** 签发时固化的**授权**（Run 信封里的权限，逐字节复制；模型调用不得超出它）。 */
  permissions: { tools: string[]; writeScope: string[] };
  /** 已经被哪一次调用尝试消费（null = 尚未消费；一次许可只能对应一次尝试）。 */
  consumedByAttemptId: string | null;
  issuedAt: string;
  consumedAt: string | null;
};

export type ModelRequestPermitSnapshot = {
  ref: ModelRequestPermitRef;
  revision: number;
  schemaVersion: 1;
  permit: ModelRequestPermitV1;
  recordedAt: string;
};

export function modelRequestPermitRefFor(projectId: string, workspaceId: string, permitId: string): ModelRequestPermitRef {
  return { aggregateType: "ModelRequestPermit", projectId, workspaceId, permitId };
}

export type ModelRequestAuthorizedEvent = {
  eventId: string;
  eventType: "ModelRequestAuthorized";
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: "ModelRequestPermit";
  aggregateId: string;
  aggregateRevision: 1;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: { kind: "human" | "agent" | "system"; id: string; runRef?: RunRef };
  occurredAt: string;
  payload: { permit: ModelRequestPermitV1 };
};

export type ModelRequestEvidenceRecordedEvent = {
  eventId: string;
  eventType: "ModelRequestEvidenceRecorded";
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: "ModelRequestPermit";
  aggregateId: string;
  aggregateRevision: number;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: { kind: "human" | "agent" | "system"; id: string; runRef?: RunRef };
  occurredAt: string;
  payload: { permit: ModelRequestPermitV1; evidence: ModelRequestEvidenceV1 };
};

/** 一次**调用尝试**的事实（不含 ack：见 ModelRequestPermitV1 的边界说明）。 */
export type ModelRequestEvidenceV1 = {
  permitId: string;
  attemptId: string;
  /** 在实际 `ModelClient.stream(request)` 边界对该请求算出的 sha256。 */
  requestDigest: string;
  /**
   * 这次调用实际消费的 Context 摘要（RuntimeContextManifest.inputDigest）。
   *
   * Runtime 在组装后保存输入/manifest，并经 Control 写入 Run.inputBinding。
   * 每次调用与该 canonical binding 及许可逐字节核对；异值在 provider 之前拒绝。
   * 这是可信宿主的实际输入绑定，不表示 Control 重读全部正文或证明语义正确。
   */
  contextInputDigest: string;
  /** 与许可逐字节相同的材料版本引脚。 */
  deliveryRefs: ModelRequestMaterialPinV1[];
  observedAt: string;
};

export type AuthorizeModelRequestCommand = {
  commandId: string;
  commandType: "AuthorizeModelRequest";
  schemaVersion: 1;
  identity: CommandIdentity;
  /** runId — the Run aggregate. */
  aggregateId: string;
  /** Run revision the caller observed (single-writer CAS). */
  expectedRevision: number;
  correlationId: string;
  submittedAt: string;
  payload: {
    workspaceId: string;
    /** Run 的 goal 归属（RunRef 的组成部分；Control 不做全量事件扫描来猜它）。 */
    goalId: string;
    permitId: string;
    requestId?: string;
    requestDigest?: string;
    contextInputDigest?: string;
    manifestDigest?: string;
  };
};

export type AuthorizeModelRequestReceipt =
  | { status: "committed"; commandId: string; replayed: boolean; permitRef: ModelRequestPermitRef; permit: ModelRequestPermitV1; /** 这次签发之后 Run 的新 revision（调用方用它继续单写者 CAS）。 */ runRevision: number; eventIds: string[]; commitCursor: CommitCursor }
  | { status: "rejected"; commandId: string; code: RunFactRejectionCode | "forbidden"; issues?: string[]; currentRevision?: number };


export type RunFactCommand = {
  commandId: string;
  commandType: "RunFact";
  schemaVersion: 1;
  identity: CommandIdentity;
  /** runId — the Run aggregate. */
  aggregateId: string;
  /** Run revision the caller observed (single-writer CAS; stale -> revision_conflict). */
  expectedRevision: number;
  correlationId: string;
  submittedAt: string;
  payload: { fact: RunFactV1 };
};

export type RunFactRejectionCode =
  | "invalid"
  | "not_found"
  | "duplicate_event"
  | "stale_event"
  | "conflict_event"
  | "after_terminal"
  | "revision_conflict"
  | "unavailable";

export type RunFactReceipt =
  | {
      status: "committed";
      commandId: string;
      /** Always false: run-fact commits have no ledger-level idempotency replay. */
      replayed: false;
      runRef: RunRef;
      runRevision: number;
      applied:
        | { kind: "runtime_event"; runtimeEventId: string; sequence: number }
        | { kind: "runtime_input_bound" }
        | { kind: "execution_entered" | "execution_retry" }
        | { kind: "dispatch_deferred" }
        | { kind: "outcome_unknown" }
        | { kind: "outcome_reconciled" }
        | { kind: "model_request_authorized"; permitId: string }
        | { kind: "model_request_attempted"; permitId: string; attemptId: string };
      /** true when the fact ended the Run (terminal event / outcome_unknown). */
      terminal: boolean;
      eventIds: string[];
      commitCursor: CommitCursor;
    }
  | {
      status: "rejected";
      commandId: string;
      code: RunFactRejectionCode;
      currentRevision?: number;
    };

// ------------------------------------------------------------------------ //
// Fingerprints (JCS + SHA-256; volatile ids excluded — P1-00/02 convention)  //
// ------------------------------------------------------------------------ //

export function dispatchClaimFingerprint(command: DispatchClaimCommand): CommandFingerprint {
  const shape = {
    schemaVersion: command.schemaVersion,
    commandType: command.commandType,
    projectId: command.identity.projectId,
    aggregateId: command.aggregateId,
    expectedRevision: command.expectedRevision,
    payload: {
      goalId: command.payload.goalId,
      attemptId: command.payload.attemptId,
      runId: command.payload.runId,
      roleBinding: command.payload.roleBinding,
      declaredPermissions: command.payload.declaredPermissions,
      budget: command.payload.budget,
    },
  };
  return sha256Hex(canonicalJson(shape)) as CommandFingerprint;
}

export function dispatchStartFingerprint(command: DispatchStartCommand): CommandFingerprint {
  const shape = {
    schemaVersion: command.schemaVersion,
    commandType: command.commandType,
    projectId: command.identity.projectId,
    aggregateId: command.aggregateId,
    expectedRevision: command.expectedRevision,
    payload: {
      envelope: command.payload.envelope,
      manifest: command.payload.manifest,
      ...(command.payload.executionConsumerId === undefined ? {} : { executionConsumerId: command.payload.executionConsumerId }),
    },
  };
  return sha256Hex(canonicalJson(shape)) as CommandFingerprint;
}

export function runFactFingerprint(command: RunFactCommand): CommandFingerprint {
  const shape = {
    schemaVersion: command.schemaVersion,
    commandType: command.commandType,
    projectId: command.identity.projectId,
    aggregateId: command.aggregateId,
    expectedRevision: command.expectedRevision,
    payload: command.payload,
  };
  return sha256Hex(canonicalJson(shape)) as CommandFingerprint;
}
