import type { PlanRevisionDraft } from './plan.js';
/**
 * Bounded goal amendments, plan proposals, patches, impact and decision records.
 * PlanCompiler proposes; Control accepts against canonical scope and revision.
 * Affected work retains explicit refresh/recompute information. Accepting a new
 * PlanRevision preserves earlier plans, evidence and unresolved obligations.
 * Decision authority and required non-empty obligations remain admission constraints.
 */
import type { ActorRef, CommandFingerprint, CommandIdentity, CommitCursor } from "./command-event.js";
import { canonicalJson, sha256Hex } from "./fingerprint.js";
import type { PlanRevisionRef, TaskHierarchy } from "./plan.js";
import type { GoalRef } from "./ledger.js";
import type { WorkContextRef } from "./context-continuity.js";

export const PLAN_CHANGE_MAX_OBLIGATION_DELTAS = 64;
export const PLAN_CHANGE_MAX_TASK_DELTAS = 64;
export const PLAN_CHANGE_MAX_AFFECTED_WORKS = 64;
export const PLAN_CHANGE_MAX_REASONS = 16;
export const PLAN_CHANGE_PROPOSAL_MAX_BYTES = 32 * 1024;
/**
 * 新增任务指派指令的字节上限。取值与初始规划对 assignment.instruction 的既有约定
 * 同一个界（contracts/initial-planning.ts 的解析上限 4096 字节）：一个任务的指派在两个入口
 * 上是同一种东西，界也必须一致，否则返工任务会因为一个初始任务不可能踩到的界而被拒。
 */
export const PLAN_CHANGE_MAX_INSTRUCTION_BYTES = 4096;
export const PLAN_CHANGE_DECISION_SUMMARY_MAX_BYTES = 4096;

// ------------------------------------------------------------------------ //
// Requests and value types                                                   //
// ------------------------------------------------------------------------ //

export type AmendGoalRequestV1 = {
  schemaVersion: 1;
  requestId: string;
  projectId: string;
  workspaceId: string;
  goalRef: GoalRef;
  /** Optional: a plan change (tasks/hierarchy) instead of a goal change. */
  planRef: PlanRevisionRef | null;
  /** The requested objective/obligation DELTA (bounded; never raw rewrite). */
  objectiveDelta: {
    kind: "change" | "clarify" | "restore";
    newObjective: string | null;
    summary: string;
  } | null;
  obligationDeltas: {
    obligationId: string;
    action: "add" | "change" | "remove";
    newText: string | null;
    justification: string;
  }[];
  requestedByRunRef: import("./dispatch.js").RunRef | null;
  requestedBy: ActorRef;
  submittedAt: string;
};

/**
 * ADR 0003 D1 任务集增量。这是计划变更里**唯一**能改动任务集的通道：
 * 任务集从来不是整体重写，而是“源 revision 的任务集 + 本增量”确定性推导的结果。
 * 每个操作都只能改“谁承担义务”，不能改义务正文与验收语义：
 *   - addTask：新增完整 RuntimeTask 定义 + 它的指派（assignment）+ 它承担的义务（obligationIds）；
 *     任务与指派必须同属一个 revision：只给任务定义而不给「谁按什么指令承担」，新任务就会进了
 *     计划却永远没有派发入口（RW-07 修的就是这个缺口），因此在守卫 f1 就被拒绝；
 *   - replaceTask：加入一条“被取代 → 取代者”记录，替换者必须是同一 revision 中已存在且 active 的任务；
 *   - cancelTask：取消并必须给出理由，无取代者。
 *
 * 不允许：直接改写任务字段（通过增量源任务传入）、改义务正文/验收语义、
 * 把已取代任务当作取代者（链式取代）。违反者在 applyPlanChange 阶段拒绝且零写。
 */
export type PlanTaskSetDeltaV1 =
  | {
      action: "addTask";
      /** 新增任务的完整 RuntimeTask 定义（不允许缺字段的部分定义）。 */
      task: import("./plan.js").RuntimeTask;
      /**
       * 新增任务的指派。taskId 必须就是上面那个任务的 id（不允许指向别的任务）。
       * work 任务必须携带（否则新任务会进了计划却没有派发入口）；gate 任务必须为 null
       * ——与初始规划对同一形状的约定一致：「Gates have no implementation assignment」
       * （contracts/initial-planning.ts），gate 的结论由证据归约产生，不派发实现运行。
       * instruction 的界与初始规划一致（PLAN_CHANGE_MAX_INSTRUCTION_BYTES）。
       */
      assignment: import("./plan.js").PlanTaskAssignment | null;
      /** 这个新任务承担的义务，必须是源 revision 里已存在的义务；义务正文不变。 */
      obligationIds: string[];
      reason: string;
    }
  | {
      action: "replaceTask";
      /** 被取代的源任务（新 revision 里 disposition=superseded）。 */
      supersededTaskId: string;
      /** 取代者：同一 revision 里已存在的 active 任务。 */
      byTaskId: string;
      reason: string;
    }
  | {
      action: "cancelTask";
      taskId: string;
      reason: string;
    };

export type PlanPatchV1 = {
  schemaVersion: 1;
  patchId: string;
  projectId: string;
  workspaceId: string;
  goalRef: GoalRef;
  sourcePlanRef: PlanRevisionRef;
  sourcePlanRevision: number;
  patchDraft: {
    objective: string;
    obligationDeltas: AmendGoalRequestV1["obligationDeltas"];
    taskHierarchy: TaskHierarchy | null;
    /**
     * ADR 0003 任务集增量。null 表示本次变更不改动任务集（兼容旧提案）；
     * 只要求包含上限内的操作，不接受整体任务集重写。
     * 它同时进入 planProposalDigest，因此人的决定的 authorizedTarget 自动绑定这份增量，事后篡改会被 decision_target_mismatch 拦下。
     * 缺省（undefined）等价于 null。
     */
    taskSetDelta?: PlanTaskSetDeltaV1[] | null;
  };
  inScope: string[];
  outOfScope: string[];
  generatedAt: string;
};

export type ChangeImpactAnalysisV1 = {
  schemaVersion: 1;
  analysisId: string;
  patchRef: import("./plan.js").PlanRevisionRef | null;
  affectedWorks: { workRef: WorkContextRef; refreshRequired: boolean; reason: string }[];
  staleAssumptions: { assumption: string; reason: string }[];
  materialsToRefresh: string[];
  independentWork: { workRef: WorkContextRef; reason: string }[];
  generatedAt: string;
};

export type PlanProposalV1 = {
  schemaVersion: 1;
  proposalId: string;
  projectId: string;
  workspaceId: string;
  sourceGoalRef: GoalRef;
  sourcePlanRef: PlanRevisionRef;
  sourcePlanRevision: number;
  patch: PlanPatchV1;
  impact: ChangeImpactAnalysisV1;
  alternatives: { optionId: string; summary: string; impactDelta: string }[];
  generatedAt: string;
};

export type PlanProposalSnapshot = {
  ref: { aggregateType: "PlanProposal"; projectId: string; workspaceId: string; proposalId: string };
  revision: 1;
  schemaVersion: 1;
  proposal: PlanProposalV1;
  recordedAt: string;
};

type UserDecisionOutcome = "accept" | "reject" | "defer";

export type UserDecisionV1 = {
  schemaVersion: 1;
  decisionId: string;
  projectId: string;
  workspaceId: string;
  proposalRef: { aggregateType: "PlanProposal"; projectId: string; workspaceId: string; proposalId: string };
  subject: { goalRef: GoalRef; sourcePlanRef: PlanRevisionRef; sourcePlanRevision: number };
  outcome: UserDecisionOutcome;
  actor: ActorRef;
  authority: { strategy: "user" | "delegated"; delegator: string | null; policyVersion: string };
  authorizedTarget: { goalId: string; newObjective: string | null; sourcePlanDigest: string };
  summary: string | null;
  decidedAt: string;
};

export type UserDecisionSnapshot = {
  ref: { aggregateType: "UserDecision"; projectId: string; workspaceId: string; decisionId: string };
  revision: 1;
  schemaVersion: 1;
  decision: UserDecisionV1;
  recordedAt: string;
};

export type GoalRevisionV1 = {
  schemaVersion: 1;
  goalRef: GoalRef;
  revision: number;
  activePlanRef: PlanRevisionRef;
  supersededPlanRefs: PlanRevisionRef[];
  changedAt: string;
  reason: string;
};

export type GoalRevisionSnapshot = {
  ref: { aggregateType: "GoalRevision"; projectId: string; workspaceId: string; goalId: string; revision: number };
  revision: 1;
  schemaVersion: 1;
  change: GoalRevisionV1;
  recordedAt: string;
};

export type PlanProposalRecordedEvent = {
  eventId: string;
  eventType: "PlanProposalRecorded";
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: "PlanProposal";
  aggregateId: string;
  aggregateRevision: 1;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: { proposal: PlanProposalV1; recordedAt: string };
};

export type UserDecisionRecordedEvent = {
  eventId: string;
  eventType: "UserDecisionRecorded";
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: "UserDecision";
  aggregateId: string;
  aggregateRevision: 1;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: { decision: UserDecisionV1; recordedAt: string };
};

export type GoalRevisionRecordedEvent = {
  eventId: string;
  eventType: "GoalRevisionRecorded";
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: "GoalRevision";
  aggregateId: string;
  aggregateRevision: 1;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: { change: GoalRevisionV1; recordedAt: string };
};

export type PlanRevisionSupersededEvent = {
  eventId: string;
  eventType: "PlanRevisionSuperseded";
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: "PlanRevision";
  aggregateId: string;
  aggregateRevision: number;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: {
    supersededRef: PlanRevisionRef;
    activeRef: PlanRevisionRef;
    decisionRef: { aggregateType: "UserDecision"; projectId: string; workspaceId: string; decisionId: string };
    changedAt: string;
  };
};

export function recordPlanChangeProposalFingerprint(command: RecordPlanChangeProposalCommand): CommandFingerprint {
  return sha256Hex(canonicalJson({ schemaVersion: 1, commandType: command.commandType, projectId: command.identity.projectId, aggregateId: command.aggregateId, expectedRevision: command.expectedRevision, payload: { proposal: command.payload.proposal } })) as CommandFingerprint;
}

export function recordUserDecisionFingerprint(command: RecordUserDecisionCommand): CommandFingerprint {
  return sha256Hex(canonicalJson({ schemaVersion: 1, commandType: command.commandType, projectId: command.identity.projectId, aggregateId: command.aggregateId, expectedRevision: command.expectedRevision, payload: { decision: command.payload.decision } })) as CommandFingerprint;
}

export function applyPlanChangeFingerprint(command: ApplyPlanChangeCommand): CommandFingerprint {
  return sha256Hex(canonicalJson({ schemaVersion: 1, commandType: command.commandType, projectId: command.identity.projectId, aggregateId: command.aggregateId, expectedRevision: command.expectedRevision, payload: { decisionRef: command.payload.decisionRef, proposalRef: command.payload.proposalRef, changeReason: command.payload.changeReason } })) as CommandFingerprint;
}

export type RecordPlanChangeProposalCommand = {
  commandId: string;
  commandType: "RecordPlanChangeProposal";
  schemaVersion: 1;
  identity: CommandIdentity;
  aggregateId: string;
  expectedRevision: 0;
  correlationId: string;
  submittedAt: string;
  payload: { proposal: PlanProposalV1 };
};

export type RecordUserDecisionCommand = {
  commandId: string;
  commandType: "RecordUserDecision";
  schemaVersion: 1;
  identity: CommandIdentity;
  aggregateId: string;
  expectedRevision: 0;
  correlationId: string;
  submittedAt: string;
  payload: { decision: UserDecisionV1 };
};

export type ApplyPlanChangeCommand = {
  commandId: string;
  commandType: "ApplyPlanChange";
  schemaVersion: 1;
  identity: CommandIdentity;
  aggregateId: string;
  expectedRevision: number;
  correlationId: string;
  submittedAt: string;
  payload: {
    decisionRef: { aggregateType: "UserDecision"; projectId: string; workspaceId: string; decisionId: string };
    proposalRef: { aggregateType: "PlanProposal"; projectId: string; workspaceId: string; proposalId: string };
    /** The NEW PlanRevision draft (P1-02 guards re-run on it). */
    newPlanDraft: (Pick<PlanRevisionDraft, 'planId' | 'planRevision' | 'obligations'> & {
      objective: string;
      stages: PlanRevisionDraft['stages'] | null;
      taskHierarchy: PlanRevisionDraft['taskHierarchy'] | null;
      executionDag: PlanRevisionDraft['executionDag'] | null;
      /** Omission inherits source tasks; supplied tasks must match the accepted delta. */
      tasks?: PlanRevisionDraft['tasks'];
      /** Null/omission inherits source assignments; supplied values are re-derived and checked. */
      assignments?: NonNullable<PlanRevisionDraft['assignments']> | null;
    }) | null;
    changeReason: string;
  };
};

type RecordPlanChangeProposalRejectionCode = "invalid" | "not_found" | "revision_conflict" | "idempotency_conflict" | "unavailable";
export type RecordPlanChangeProposalReceipt =
  | { status: "committed"; commandId: string; replayed: boolean; proposalRef: PlanProposalSnapshot["ref"]; eventIds: string[]; commitCursor: CommitCursor }
  | { status: "rejected"; commandId: string; code: RecordPlanChangeProposalRejectionCode; issues?: string[] };

type RecordUserDecisionRejectionCode = "invalid" | "not_found" | "proposal_not_found" | "revision_conflict" | "idempotency_conflict" | "unavailable";
export type RecordUserDecisionReceipt =
  | { status: "committed"; commandId: string; replayed: boolean; decisionRef: UserDecisionSnapshot["ref"]; eventIds: string[]; commitCursor: CommitCursor }
  | { status: "rejected"; commandId: string; code: RecordUserDecisionRejectionCode; issues?: string[] };

type ApplyPlanChangeRejectionCode =
  | "invalid" | "not_found" | "proposal_not_found" | "decision_not_found" | "decision_not_accepted"
  | "decision_target_mismatch" | "draft_mismatch" | "source_stale" | "guards_failed"
  /** ADR 0003 D1-2：任务集增量本身不合法（缺字段、无理由、指向不存在/非 active 的任务、链式取代）。 */
  | "task_set_delta_invalid"
  /** ADR 0003 D1-2：尝试用增量改义务正文或验收语义（属于人的决定，不在 inScopeRework 内）。 */
  | "obligation_semantics_forbidden"
  | "revision_conflict" | "idempotency_conflict" | "unavailable";
export type ApplyPlanChangeReceipt =
  | { status: "committed"; commandId: string; replayed: boolean; goalRevision: GoalRevisionSnapshot["ref"]; activePlanRef: PlanRevisionRef; eventIds: string[]; commitCursor: CommitCursor }
  | { status: "rejected"; commandId: string; code: ApplyPlanChangeRejectionCode; issues?: string[] };

// ------------------------------------------------------------------------ //
// Pure helpers: digest / target / consistency / dispositions //
// — deterministic, no state access, no writes.                              //
// ------------------------------------------------------------------------ //

/** Full-scope key for the plan-change view ((projectId, workspaceId, goalId)). */
export function planChangeScopeKey(query: { projectId: string; workspaceId: string; goalId: string }): string {
  return canonicalJson({ aggregateType: "PlanChangeView", projectId: query.projectId, workspaceId: query.workspaceId, goalId: query.goalId });
}

/**
 * Deterministic proposal digest over the CHANGE semantics (source refs +
 * patch + impact). Excludes proposalId/generatedAt (record-time volatile);
 * includes sourcePlanRevision so a rebuild of the same plan yields the same
 * digest while a NEW source revision yields a different one.
 */
export function planProposalDigest(proposal: PlanProposalV1): string {
  return sha256Hex(canonicalJson({
    projectId: proposal.projectId,
    workspaceId: proposal.workspaceId,
    sourceGoalRef: proposal.sourceGoalRef,
    sourcePlanRef: proposal.sourcePlanRef,
    sourcePlanRevision: proposal.sourcePlanRevision,
    patch: proposal.patch,
    impact: proposal.impact,
  })) as string;
}

/** The authoritative target a user decision must carry for THIS proposal. */
export function decisionTargetFor(proposal: PlanProposalV1): UserDecisionV1["authorizedTarget"] {
  return {
    goalId: proposal.sourceGoalRef.goalId,
    newObjective: proposal.patch.patchDraft.objective,
    sourcePlanDigest: planProposalDigest(proposal),
  };
}

type TaskChangeDisposition = "keep" | "cancel" | "replace" | "reverify" | "resume";

export type TaskDispositionRow = {
  taskId: string;
  disposition: TaskChangeDisposition;
  sourcePlanRef: PlanRevisionRef;
  targetPlanRef: PlanRevisionRef;
  replacedByTaskId: string | null;
  obligationSignatureChanged: boolean;
  reason: string;
};

// ------------------------------------------------------------------------ //
// Plan-change read view (ReadModelIndex.planChangeView)                     //
// ------------------------------------------------------------------------ //

export type PlanChangeViewQuery = { projectId: string; workspaceId: string; goalId: string };

export type PlanChangeViewResult =
  | {
      status: "ready";
      proposals: PlanProposalSnapshot[];
      decisions: UserDecisionSnapshot[];
      revisions: GoalRevisionSnapshot[];
      dispositions: TaskDispositionRow[];
      freshness: CommitCursor | null;
    }
  | { status: "not_found" };
