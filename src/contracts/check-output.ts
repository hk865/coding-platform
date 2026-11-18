/**
 * 没过的登记检查的输出：命令原文、出处、退出码和两路输出的末尾。给返工的执行者（接续说明的 `checks.outputs`，
 * `STATE-MACHINES-SPEC.md` §6.1 契约 (e)）和参谋的偏差轮（`slice-PL-SPEC.md` §7.1.1，`stop` 的第五项）看。
 * 这里只放类型和一个常量：结构检查在 `continuation-brief.ts`（`failingCheckOutputProblem`），读法在 WorkGraph 的
 * `failingCheckOutputsOf`。
 */
import type { BoundedTextV1 } from './continuation-brief.js';
import type { QueryJobAnswerRef } from './query-job.js';
import type { CheckBaselineV1, CheckReviewApproverDutyV1, CheckReviewProposalRefV1 } from './check-review.js';

/** Host 现在装着的一条检查从哪来。按内容摘要（`checkDigestOf`）找回。 */
export type InstalledCheckOriginV1 =
  /** 已批准清单：初始化的检查阶段或整表批准，绑着那次保存的回答。 */
  | { kind: 'approved_list'; answerRef: QueryJobAnswerRef }
  /** 计划带来的检查：哪份候选、谁批的。 */
  | { kind: 'plan'; proposalRef: CheckReviewProposalRefV1; approvedBy: 'person' | CheckReviewApproverDutyV1 }
  /** Host 启动配置。 */
  | { kind: 'startup' };
export type InstalledCheckOriginEntryV1 = { checkDigest: string; origin: InstalledCheckOriginV1 };

/** 命令原文最多存这么多字（UTF-16），超了截断并标 `truncated`。 */
export const CHECK_OUTPUT_COMMAND_CHARS = 2000;

/**
 * 一条没过的登记检查（命令检查、跑完、有报告）。命令和输出照原样，不做 JSON 转义。
 * 不进无进展键（`noProgressKey`）：这里的东西只给模型看。
 */
export type FailingCheckOutputV1 = {
  checkId: string;
  kind: 'static' | 'dynamic';
  command: BoundedTextV1;
  taskIds: 'all' | string[];
  /** Host 现在装的检查里内容相同的那一条的出处；没有内容相同的，或 Host 没给，是 null（写“不明”）。 */
  origin: InstalledCheckOriginV1 | null;
  /** 报告里的观察换成的事实（`checkBaselineOf`）；报告读不到是 null，原因在 `unreadable`。 */
  observed: CheckBaselineV1 | null;
  unreadable: string | null;
};
