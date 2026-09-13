/** Control admission receipts and boundary explanations; no additional state authority. */
import type { PlanRevisionRef } from '../plan.js';
import type { PlanProposalSnapshot, UserDecisionSnapshot } from '../goal-change.js';
import type { CommitCursor } from '../command-event.js';
import type { ReworkProposalV1 } from './proposal.js';

/**
 * 四条自动受理边界（ADR 0003 D1-4）。任一条不满足都必须转人去决定，
 * 不做“满足三条就先受理”的部分受理——部分受理等于偷偷降低来源或完成判据。
 */
const REWORK_BOUNDARY_CODES = [
  /** (a) 触发源必须是已提交的验证结论（工具轮次或独立审阅），不能是自述。 */
  'trigger_source_committed',
  /** (b) 改动落在 inScopeRework：同义务、同验收语义，只换承担者。 */
  'in_scope_rework',
  /** (c) 自动化预算未耗尽。 */
  'autonomous_budget_available',
  /** (d) 人没有对这些问题显式拒绝（或延后）过。 */
  'no_human_rejection',
] as const;

type ReworkBoundaryCode = (typeof REWORK_BOUNDARY_CODES)[number];

/** 一条边界的判定结论：不满足时 reasons 必须非空，并且写清“差在哪”。 */
export type ReworkBoundaryOutcomeV1 = {
  code: ReworkBoundaryCode;
  satisfied: boolean;
  reasons: string[];
};

/**
 * 预算事实。计数口径见 policies/autonomous-rework.ts：
 * 按 Goal 累计“已经应用成功的自动返工次数”，上限取当前生效 CoordinationPolicy 内容里的
 * budget.maxAutonomousReworks。used/limit/remaining 一起返回，避免调用方自己再算一遍。
 */
export type ReworkBudgetFactsV1 = {
  policyId: string;
  policyRevision: number;
  /** 本次授权来源的策略内容摘要（写进决定的 authority.policyVersion）。 */
  policyVersion: string;
  limit: number;
  used: number;
  remaining: number;
};

/**
 * 自动受理请求。
 *
 * 只接受**返工提案本身**，不额外接一份“问题”参数：ReworkProposalV1 已经同时携带
 * 来源问题（rework.issues）与它导出的新计划草稿（planDraft），受理方要核对的事实都在里面。
 * 提案身份（proposalId／新 planId）由 contracts/rework/proposal.ts 的确定性函数推导，受理方**复核**
 * 而不重写：同一批问题与同一份源 revision 必须命中同一份提案聚合，重复触发才不可能产生
 * 第二份提案或第二个 revision。
 */
export type ReworkAcceptanceRequestV1 = {
  schemaVersion: 1;
  proposal: ReworkProposalV1;
};

export type ReworkAcceptanceRejectionCode =
  /** 请求形状或引用不合法（输入问题，不是边界问题）。 */
  | 'invalid'
  /** Goal / 生效 policy / 源 plan 不存在，无法建立受理所需的精确版本事实。 */
  | 'not_found'
  /** 没有生效的 CoordinationPolicy：没有默认值，也没有回退（不凭缺省预算自动受理）。 */
  | 'governance_unavailable'
  /** 提案的源 revision 已经不是当前 active plan（已被别的 revision 取代）。 */
  | 'source_not_current'
  /** 同一提案身份已经存在内容不同的记录：不覆盖、不合并，转人工。 */
  | 'proposal_conflict'
  /**
   * 落账前的草稿一致性预检不通过。这两个码就是既有守卫
   * （applyPlanChange 的 f2 与 policies/goal-change-consistency.ts 的归因函数）用的码，
   * 这里不发明新值、也不把它们再压成一个 invalid：调用方必须能区分
   * 「草稿与推导结果对不上」（draft_mismatch）与「有人试图用增量改写义务正文或验收语义」
   * （obligation_semantics_forbidden），后者属于必须由人决定的范围。
   */
  | 'draft_mismatch'
  | 'obligation_semantics_forbidden'
  /** 四条边界都满足，但既有 applyPlanChange 守卫链拒绝（原始码与 issues 一并带回）。 */
  | 'guard_rejected'
  | 'unavailable';

export type ReworkAcceptanceReceiptV1 =
  | {
      status: 'accepted';
      /** true 表示同一提案此前已受理，本次没有产生第二份提案或第二个 revision。 */
      replayed: boolean;
      proposalId: string;
      /** 本提案处置的问题身份（确定性，按 issueId 排序）。 */
      issueIds: string[];
      proposalRef: PlanProposalSnapshot['ref'];
      decisionRef: UserDecisionSnapshot['ref'];
      /** 受理后生效的 plan revision（新 revision，或幂等重放时既有的那一个）。 */
      activePlanRef: PlanRevisionRef;
      /**
       * 四条边界的完整结论（受理时四条都满足）。**幂等重放时为空数组**：
       * 边界结论属于当次受理，重放不再重新判定，避免用当前状态伪造当时结论。
       */
      boundaries: ReworkBoundaryOutcomeV1[];
      /** 当前预算事实；重放时如果生效策略已不可解析则为 null（不编造数值）。 */
      budget: ReworkBudgetFactsV1 | null;
      /** 本次新提交的事件与游标；幂等重放时为空。 */
      eventIds: string[];
      commitCursor: CommitCursor | null;
    }
  | {
      status: 'needs_human_decision';
      /** 第一条不满足的边界（四条结论都在 boundaries 里，便于逐条解释）。 */
      code: ReworkBoundaryCode;
      proposalId: string;
      boundaries: ReworkBoundaryOutcomeV1[];
      /** 无法建立预算事实时（例如没有生效 policy）为 null，不编造数值。 */
      budget: ReworkBudgetFactsV1 | null;
      reasons: string[];
    }
  | {
      status: 'rejected';
      code: ReworkAcceptanceRejectionCode;
      proposalId: string;
      reasons: string[];
      /** code='guard_rejected' 时带回既有守卫链的原始码与 issues。 */
      guardCode?: string;
      guardIssues?: string[];
    };
