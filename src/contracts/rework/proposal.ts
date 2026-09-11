/** PlanCompiler proposals reuse PlanRevision and the existing Control admission chain. Old failures and obligations remain. */
import type { GoalRef } from '../ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot } from '../plan.js';
import type { PlanProposalV1 } from '../goal-change.js';
import { canonicalJson, sha256Hex } from '../fingerprint.js';
import { REWORK_MAX_ISSUES } from './issues.js';
import type { ReworkIssueV1, ReworkIssueViewV1 } from './issues.js';

/** 返工任务的身份：同一个问题在新 revision 上只对应一个任务，重复提案不会生成第二个。 */
export function reworkTaskIdFor(issueId: string): string {
  return 'rework-' + sha256Hex(issueId).slice(0, 32);
}

/**
 * 返工提案 = 一份**普通计划变更提案** + 它的来源问题 + 由该变更机械推导出的新计划草稿。
 *
 * 为什么是 PlanProposalV1 的交集，而不是并列的第二套结构：
 *   - 受理链（recordPlanChangeProposal → recordUserDecision → applyPlanChange）读取的
 *     就是 PlanProposalV1 的 patch／impact；人的决定绑定的 authorizedTarget 也由
 *     planProposalDigest(patch + impact) 计算。交集让「返工提案能被既有受理链直接消费」
 *     成为类型事实，而不是靠运行时字段搬运维持；
 *   - 返工与普通计划变更共用同一条「提案 → 人的决定 → CAS 应用」链，旧 revision、
 *     旧 FAIL 与旧报告在两种情况下都原样保留。
 *
 * 新增的三项各有唯一职责：
 *   - rework：来源问题的引用（受理方与人类据此核对这条提案从哪条已提交失败事实推导而来）；
 *   - planDraft：受理方提交给 applyPlanChange 的新计划草稿（源 revision + 本提案增量的
 *     确定性推导结果，由提案方算一次，避免受理方再写一遍推导）；
 *   - summary：人类可读摘要，直接引用问题里的失败事实，不重新判定失败。
 */
export type ReworkProposalV1 = PlanProposalV1 & {
  rework: ReworkProposalOriginV1;
  /** Complete plan content; rework must include tasks and assignments. Control
   * re-derives them before admission. Ordinary amendments retain nullable defaults. */
  planDraft: Required<Pick<PlanRevisionDraft, 'planId' | 'planRevision' | 'stages' | 'tasks' | 'assignments' | 'taskHierarchy' | 'executionDag' | 'obligations'>> & { objective: string };
  /** 人类可读摘要：处置了哪些问题、哪条要求失败、为什么失败（引用失败事实，不重新判定）。 */
  summary: string;
};

type ReworkProposalOriginV1 = {
  schemaVersion: 1;
  /**
   * 本提案处置的未处置问题（按 issueId 排序、去重）。只携带问题的机械事实：
   * currentness 之类的视图标注不进提案——它是相对某个 active revision 的派生判断，
   * 落账后会立刻过期，受理方需要的是可核对的事实身份与失败事实本身。
   */
  issues: ReworkIssueV1[];
  /** 每个被取代任务对应的返工任务；与 planDraft.tasks 里新增的任务逐字对应。 */
  tasks: ReworkProposalTaskV1[];
};

/**
 * 一个返工任务：取代原失败任务，并接手它在源 revision 中承担的全部义务。
 * 除了 taskId 与 title 以外，全部字段都是源计划事实或问题事实的逐字引用。
 */
export type ReworkProposalTaskV1 = {
  /** 返工任务 id = reworkTaskIdFor(primaryIssueId)；确定性推导，不接受调用方指定。 */
  taskId: string;
  /** 决定 taskId 的问题身份（同一任务的多个问题中按身份排序最前的一条）。 */
  primaryIssueId: string;
  /** 该返工任务处置的全部问题身份（排序、去重）；一条问题集合对应一个返工任务。 */
  issueIds: string[];
  /** 被取代的源任务（源 revision 里 disposition=active；新 revision 里 superseded）。 */
  supersedesTaskId: string;
  /** 被取代任务的标题，逐字沿用，用来让人看清取代了谁。 */
  supersededTitle: string;
  /** 从源任务逐字接手的义务（顺序与源计划一致）；义务正文与验收语义不在增量里改写。 */
  obligationIds: string[];
  title: string;
  /** 取代理由：由问题身份与失败要求数量拼出，不含任何自由判断。 */
  reason: string;
};



/**
 * 返工提案的编译输入。三项都必须是调用方已经持有的 canonical 事实：
 *   - goalObjective：当前目标正文（GoalSnapshot.objective）；返工不改变目标含义，
 *     因此它逐字成为新 revision 的 objective；
 *   - activePlan：当前 active plan revision 的 canonical 快照。本模块不读账本
 *     （PlanCompiler 没有 StateLedger 依赖），因此由调用方读出后传入；
 *   - issues：VerificationEngine 只读投影给出的未处置问题。返工不得从别处（模型输出、
 *     自报、UI 状态）取得判断依据，因此输入里没有别的来源。
 */
export type ReworkCompileRequestV1 = {
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  goalRef: GoalRef;
  goalObjective: string;
  activePlan: PlanRevisionSnapshot;
  issues: ReworkIssueViewV1[];
  /** Actual bindings resolved by Control. Missing material is reported as a gap, never guessed. */
  workIdentities?: import('../planning.js').PlanningTaskWorkMaterial[];
};

/**
 * 编译结论只有三种：
 *   - proposal：可以提交受理的提案（本模块仍然不写任何 canonical 状态）；
 *   - needs_decision：输入与 canonical 一致，但自动受理的边界不成立（例如原任务已经
 *     处于其它处置，取代它会越过人的决定），必须由人决定，不能伪造增量；
 *   - rejected：输入自身与 canonical 事实不一致或超出上限，无法机械推导。
 */
export type ReworkCompileResultV1 =
  | { status: 'proposal'; proposal: ReworkProposalV1 }
  | { status: 'needs_decision'; code: ReworkNeedsDecisionCode; message: string; issues: string[] }
  | { status: 'rejected'; code: ReworkCompileRejectionCode; message: string; issues: string[] };

export type ReworkCompileRejectionCode =
  | 'invalid_request'
  | 'empty_issue_set'
  | 'too_many_issues'
  | 'issue_out_of_scope'
  | 'issue_not_current'
  | 'issue_without_failed_requirements'
  | 'issue_identity_conflict'
  | 'issue_identity_inconsistent'
  | 'issue_task_not_in_plan'
  /** 被取代任务在源 revision 里没有 assignment，返工任务的承担者角色无从推导。 */
  | 'replaceable_task_without_assignment'
  | 'obligation_not_in_plan'
  | 'obligation_not_carried_by_task'
  | 'rework_task_already_in_plan'
  | 'delta_exceeds_bound';

/**
 * 需要人的决定的判定码。只有一条：原失败任务在源 revision 里已经不是 active
 * （已被取代／取消／延后）。此时机械增量无法在不推翻既有处置的前提下换承担者，
 * 而自动受理的边界 (b) 要求"同义务、同验收语义、只换承担者"，因此必须转人工。
 *
 * 为什么没有别的码：其余情况在编译期要么能机械成立（自动受理形态），要么输入本身
 * 与 canonical 事实不一致（走 rejected）。不声明不可达的判定码，避免看起来像有分支。
 */
export type ReworkNeedsDecisionCode = 'task_not_replaceable';

/** 本模块一次受理的问题条数上限：与只读投影的上限同一常数，避免两处上限各自漂移。 */
export const REWORK_MAX_ISSUES_PER_PROPOSAL = REWORK_MAX_ISSUES;

/**
 * 提案身份：只由「哪份源计划 + 哪些问题」决定；摘要、时间与失败事实都不参与。
 *
 * 为什么必须确定性：同一批问题重复编译必须得到同一个 proposalId，否则账本（CAS@0）会多出
 * 一条看起来不同的提案聚合，重复触发也就无法去重。ControlEngine 的受理入口复核这个身份
 * （见 control-engine/policies/autonomous-rework.ts 的 proposalIdentityIssues），
 * 因此这里是与控制侧共用的唯一实现。
 */
export function reworkProposalIdFor(input: {
  projectId: string;
  workspaceId: string;
  goalRef: GoalRef;
  sourcePlanRef: PlanRevisionRef;
  sourcePlanRevision: number;
  issues: Array<{ issueId: string; taskId: string }>;
}): string {
  const issues = input.issues
    .map((issue) => ({ issueId: issue.issueId, taskId: issue.taskId }))
    .sort((a, b) => canonicalJson(a as never).localeCompare(canonicalJson(b as never)));
  return (
    'rework-proposal-' +
    sha256Hex(
      canonicalJson({
        schemaVersion: 1,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        goalRef: input.goalRef,
        sourcePlanRef: input.sourcePlanRef,
        sourcePlanRevision: input.sourcePlanRevision,
        issues,
      } as never),
    ).slice(0, 40)
  );
}

/** 新 revision 的计划 id：由提案身份推导，保证同一提案重复编译得到同一个新计划身份。 */
export function reworkPlanIdFor(proposalId: string): string {
  return 'plan-rework-' + sha256Hex(proposalId).slice(0, 32);
}
