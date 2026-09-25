// Migrated contract declarations; source provenance is recorded in the N0 transfer manifest.
/**
 * Bounded goal amendments, plan proposals, patches, impact and decision records.
 * PlanCompiler proposes; Control accepts against canonical scope and revision.
 * Affected work retains explicit refresh/recompute information. Accepting a new
 * PlanRevision preserves earlier plans, evidence and unresolved obligations.
 * Decision authority and required non-empty obligations remain admission constraints.
 */
import type { ActorRef } from "./command-event.js";
import type { PlanRevisionRef, TaskHierarchy } from "./plan.js";
import type { GoalRef } from "./ledger.js";
import type { WorkContextRef } from "./context-continuity.js";
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
 * 任务集增量是计划变更里唯一能改动任务集的通道：
 * 任务集从来不是整体重写，而是“源 revision 的任务集 + 本增量”确定性推导的结果。
 * 每个操作都只能改“谁承担义务”，不能改义务正文与验收语义：
 *   - addTask：新增完整 RuntimeTask 定义 + 它的指派（assignment）+ 它承担的义务（obligationIds）；
 *     任务与指派必须同属一个 revision：只给任务定义而不给「谁按什么指令承担」，新任务会进入
 *     计划却永远没有派发入口，因此在守卫 f1 就被拒绝；
 *   - replaceTask：加入一条“被取代 → 取代者”记录，替换者必须是同一 revision 中已存在且 active 的任务；
 *   - cancelTask：取消并必须给出理由，无取代者。
 *
 * 不允许：直接改写任务字段（通过增量源任务传入）、改义务正文/验收语义、
 * 把已取代任务当作取代者（链式取代）。违反者在 applyPlanChange 阶段拒绝且零写。
 */
export type PlanTaskSetDeltaV1 = {
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
} | {
    action: "replaceTask";
    /** 被取代的源任务（新 revision 里 disposition=superseded）。 */
    supersededTaskId: string;
    /** 取代者：同一 revision 里已存在的 active 任务。 */
    byTaskId: string;
    reason: string;
} | {
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
         * 任务集增量。null 表示本次变更不改动任务集（兼容旧提案）；
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
    affectedWorks: {
        workRef: WorkContextRef;
        refreshRequired: boolean;
        reason: string;
    }[];
    staleAssumptions: {
        assumption: string;
        reason: string;
    }[];
    materialsToRefresh: string[];
    independentWork: {
        workRef: WorkContextRef;
        reason: string;
    }[];
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
    alternatives: {
        optionId: string;
        summary: string;
        impactDelta: string;
    }[];
    generatedAt: string;
};
export type PlanProposalSnapshot = {
    ref: {
        aggregateType: "PlanProposal";
        projectId: string;
        workspaceId: string;
        proposalId: string;
    };
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
    proposalRef: {
        aggregateType: "PlanProposal";
        projectId: string;
        workspaceId: string;
        proposalId: string;
    };
    subject: {
        goalRef: GoalRef;
        sourcePlanRef: PlanRevisionRef;
        sourcePlanRevision: number;
    };
    outcome: UserDecisionOutcome;
    actor: ActorRef;
    authority: {
        strategy: "user" | "delegated";
        delegator: string | null;
        policyVersion: string;
    };
    authorizedTarget: {
        goalId: string;
        newObjective: string | null;
        sourcePlanDigest: string;
    };
    summary: string | null;
    decidedAt: string;
};
export type UserDecisionSnapshot = {
    ref: {
        aggregateType: "UserDecision";
        projectId: string;
        workspaceId: string;
        decisionId: string;
    };
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
    ref: {
        aggregateType: "GoalRevision";
        projectId: string;
        workspaceId: string;
        goalId: string;
        revision: number;
    };
    revision: 1;
    schemaVersion: 1;
    change: GoalRevisionV1;
    recordedAt: string;
};
