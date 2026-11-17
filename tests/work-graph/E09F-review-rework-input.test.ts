/**
 * E09F 第 1 件（lead 11-17 裁定甲；探针 E09RW）：审查员交 `fix`、轮次 FAIL 之后，“上一轮为什么没过”要在三处说法一致：
 * 系统返工的新 Run 拿到的接续说明、人的卡上的失败项（`TaskRow.failure.round`）、返工依据（TaskRequeue.basis 的
 * 无进展键，lead 11-17 18:0x 裁定一并接上）。期望值按 STATE-MACHINES-SPEC C3（“失败的检查与报告引用 →
 * checks.failing[].reportRef”）手算：S9 世界里命令检查（echo）通过，唯一没过的是审查项 `review-packet`，结果 FAIL、
 * 阶段 finished、没有原因，报告引用是审查员交的报告（正文 `S9 fix report`，摘要即它的 sha256；键里不带报告引用，
 * ND-1）；接续说明另有一行审阅依据，取审查员写的 `S9 fix basis`，新 Run 的模型输入里能看到这段依据。
 * 只走公开入口（workflow 推进、`executions/brief`、`plans.queryTaskGraph`、脚本模型的请求）。
 */
import { createHash } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import type { WorkflowAdvanceInput, WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { ContinuationBriefV1 } from '../../src/contracts/continuation-brief.js';
import type { VerificationRoundRef } from '../../src/contracts/verification.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { claimedRunOf, ready, receiptOf } from '../helpers/S7A-fixture.js';
import {
  advanceS9Review, answerS9Review, bookS9Review, finalizeS9Review, openS9ReviewRound, openS9ReviewWorld,
  type S9ReviewWorld,
} from '../helpers/S9-review-fixture.js';

const worlds: S9ReviewWorld[] = []; afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });
const nextOf = (result: unknown): WorkflowAdvanceInput => {
  const next = (result as { value?: { next?: WorkflowAdvanceInput | null } }).value?.next;
  if (next === null || next === undefined) throw new Error(`E09F: the advance has no next: ${JSON.stringify(result)}`);
  return next;
};
const REPORT_DIGEST = createHash('sha256').update('S9 fix report', 'utf8').digest('hex');
/** 手算的那一条失败项：审查项、已完成、FAIL、没有原因。 */
const REVIEW_FAILED = { checkId: 'review-packet', phase: 'finished', outcome: 'FAIL', cause: null } as const;

/** 审查员交 fix，记账、定稿，这一轮 FAIL。 */
async function failedByReview(): Promise<{ review: S9ReviewWorld; roundRef: VerificationRoundRef }> {
  const review = await openS9ReviewWorld(); worlds.push(review);
  const first = await openS9ReviewRound({ review });
  const fix = await answerS9Review(review, 'fix', { round: first });
  const failRef = await bookS9Review(review, fix.roundRef, 'e09f-book-fix');
  expect(await finalizeS9Review(review, fix.roundRef, 'e09f-finalize-fix', [failRef]))
    .toMatchObject({ status: 'committed', value: { outcome: 'FAIL' } });
  return { review, roundRef: fix.roundRef };
}

/** 系统返工：`select_work` 自动重排、领取、跑新 Run，停在新一轮的审查之前。 */
async function reworked(review: S9ReviewWorld): Promise<WorkflowStepReceipt[]> {
  await review.world.scripted.script(review.workLine, [{ kind: 'text', text: 'E09F rework done' }]);
  const receipts: WorkflowStepReceipt[] = [];
  await driveWorkflow(review.world.ag2b, nextOf(await advanceS9Review(review)), { receipts,
    stopBefore: operation => operation.kind === 'send_system_round' || operation.kind === 'finalize_checks' });
  expect(receiptOf(receipts, 'open_checks')).toBeDefined();
  return receipts;
}

it('审查 fix → 返工的新 Run：接续说明把审查项列为没过的检查、带上审阅依据，模型输入里有这段依据', async () => {
  const { review, roundRef } = await failedByReview();
  const receipts = await reworked(review);
  const reworkRun = claimedRunOf(receipts, 's9-work').run;
  const read = ready<{ brief: ContinuationBriefV1; digest: string } | null>(
    await review.world.post('executions/brief', plain(S6A_SCOPE, { runRef: reworkRun })), 'the rework brief');
  if (read === null) throw new Error('E09F: the rework Run has no brief');
  const checks = read.brief.checks;
  expect(checks?.roundRef.roundId).toBe(roundRef.roundId);
  expect(checks?.failing).toEqual([{ ...REVIEW_FAILED, reportRef: expect.objectContaining({ digest: REPORT_DIGEST }) }]);
  expect(checks?.gapCodes).toEqual([]);
  expect(checks?.reviewBasis).toEqual({ text: 'S9 fix basis', truncated: false });
  const requests = await review.world.scripted.requests(review.workLine);
  const input = JSON.stringify(requests.at(-1) ?? null);
  expect(input).toContain('审阅依据：S9 fix basis');
  expect(input).not.toContain('未通过的检查：无');
});

it('审查 fix → 人的卡上的失败项有审查项；系统返工的依据（无进展键）里也有', async () => {
  const { review, roundRef } = await failedByReview();
  const graph = await review.world.platform.plans.queryTaskGraph(review.world.humanContext(), { goalRef: review.goal });
  if (graph.status !== 'ready') throw new Error(`E09F: the task graph is not readable: ${JSON.stringify(graph)}`);
  const row = graph.value.tasks.find(candidate => candidate.ref.taskId === review.task.taskId);
  expect(row?.failure?.round).toMatchObject({ roundRef: { roundId: roundRef.roundId }, outcome: 'FAIL', gapCodes: [],
    failingChecks: [{ ...REVIEW_FAILED, reportRef: expect.objectContaining({ digest: REPORT_DIGEST }) }] });
  const requeued = receiptOf(await reworked(review), 'requeue_task')?.result;
  expect(requeued).toMatchObject({ status: 'committed', value: { kind: 'requeued',
    requeue: { basis: { failure: { outcome: 'completed', checks: [REVIEW_FAILED], gapCodes: [] } } } } });
});
