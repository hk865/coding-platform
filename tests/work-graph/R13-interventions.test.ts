/**
 * R13b 冻结稿第五节 I1（B1–B3）：S9 审阅世界里工作 Run 跑着时，人经 `messages/send` 发一条直接干预（P2：
 * `entry: 'person_intervention'`），脚本模型在
 * 一次工具调用后的安全点收下（`deliveryEvidence` 指向这个 Run）；同一条线的 `notify` 不列。审阅轮发出后，`execreview:`
 * 正文在固定正文之后附人的原话、收下它的 Run 和任务，包头七行仍是冻结轮次的包。只走公开入口，只跑 memory（RULES S3）。
 */
import { afterEach, expect, it } from 'vitest';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { VerificationRoundRef } from '../../src/contracts/verification.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { execReviewPacketOfRound, execReviewPacketOfText } from '../../src/core/work-graph/tasks/exec-review-packet.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { readBody } from '../helpers/IV-host-fixture.js';
import { openS9ReviewWorld, type S9ReviewWorld } from '../helpers/S9-review-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { claimedRunOf, receiptOf } from '../helpers/S7A-fixture.js';
import { readS7BMessage } from '../helpers/S7B-fixture.js';

let opened: S9ReviewWorld | null = null;
afterEach(async () => { await opened?.close().catch(() => undefined); opened = null; });
const commit = <T>(answer: { body: unknown }, what: string): T => {
  const body = answer.body as { status?: string; value?: T };
  if (body.status !== 'committed') throw new Error(`R13 I1: ${what} did not commit`);
  return body.value as T;
};
it('I1：审阅包带这个 Goal 里人被 Run 收下的原话，不带 notify，包头不变', async () => {
  const review = opened = await openS9ReviewWorld();
  const { world, goal, task, workLine } = review;
  // 人的原话正好 1,200 字：B1 读正文时截到 PERSON_WORDS_MAX（1,000），B2 只加截断注记。
  const words = ('R13 I1 人的原话：' + 'x'.repeat(1_200)).slice(0, 1_200);
  const shown = words.slice(0, 1_000);
  const notify = 'R13 I1 这条 notify 不该出现在审阅包里';
  // 第一个工具调用之后的第二个模型边界才是安全点：脚本模型先读一个文件，再收尾。
  await world.scripted.script(workLine, [
    { kind: 'calls', calls: [{ callId: 'r13-i1-read', name: 'read', args: { path: 'src/module.ts' } }] },
    { kind: 'text', text: 'R13 I1 work done' },
  ]);
  const first = await world.gates.modelRequest(workLine);
  const second = await world.gates.modelRequest(workLine);
  const receipts: WorkflowStepReceipt[] = [];
  const driving = driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: 'r13-i1-subject',
    sessionHint: workLine.ref, kind: 'select_work', taskId: task.taskId }, { receipts, stopBefore: 'send_system_round' });
  await first.reached;
  // P2 §2.1/§2.3 (`p2-frozen.md:102`, `:126`): only the person's direct-intervention entry writes `entry` (the same
  // input `src/ui/boot.ts` sends), and the review packet reads the person by that `entry`, not by an old `intent`.
  const sent = commit<SessionMessage>(await world.post('messages/send', graphWrite(S6A_SCOPE, {
    recipient: workLine.ref, text: words, needsReply: true, entry: 'person_intervention' }, 'r13-i1-action')),
  'R13 I1 人的 action_request');
  commit(await world.post('messages/send', graphWrite(S6A_SCOPE, {
    recipient: workLine.ref, text: notify, needsReply: false, wake: false }, 'r13-i1-notify')),
  'R13 I1 人的 notify');
  first.release();
  await second.reached;
  second.release();
  const steps = await driving;

  const run = claimedRunOf(receipts, task.taskId).run;
  await expect.poll(async () => (await readS7BMessage(world, sent.ref)).deliveryEvidence !== null,
    { timeout: 10_000, interval: 20 }).toBe(true);
  const evidence = (await readS7BMessage(world, sent.ref)).deliveryEvidence;
  if (evidence === null) throw new Error('R13 I1: the action_request was not accepted');
  expect(evidence.executionRef).toEqual(run);
  const roundRef = (receiptOf(receipts, 'open_checks')?.result as
    { value?: { ref?: VerificationRoundRef } } | undefined)?.value?.ref;
  if (roundRef === undefined) throw new Error('R13 I1: the subject drive opened no review round');
  const next = steps.at(-1)?.next;
  if (next === null || next === undefined || next.kind !== 'perform' || next.operation.kind !== 'send_system_round')
    throw new Error('R13 I1: the drive did not stop before the exec review send');
  const sends: WorkflowStepReceipt[] = [];
  await driveWorkflow(world.ag2b, next, { receipts: sends, stopBefore: 'finalize_checks' });
  const messageRef = (receiptOf(sends, 'send_system_round')?.result as
    { value?: { ref?: SessionMessageRef } } | undefined)?.value?.ref;
  if (messageRef === undefined) throw new Error('R13 I1: the review send has no message');
  const body = await readBody(world, messageRef, 'message');
  const section = ['Direct interventions from the person in this Goal (the person\'s own words, verbatim):',
    `- message ${/^session-message-([0-9a-f]{8})/.exec(sent.ref.messageId)?.[1]}…, accepted by Run ${run.runId.slice(0, 8)}… (task ${task.taskId}) at ${evidence.acceptedAt}:`,
    '  ```', shown, '  ```', '(cut to the first 1000 characters)'].join('\n');
  expect(body.endsWith(`\n\n${section}`)).toBe(true);
  expect(body, '1,200 字只到第 1,000 字').not.toContain(words.slice(0, 1_001));
  expect(body, 'notify 不算人的直接干预').not.toContain(notify);

  const round = await world.platform.evidence.readVerification(world.humanContext(), roundRef);
  if (round.status !== 'ready') throw new Error('R13 I1: the review round is not readable');
  const packet = execReviewPacketOfRound(round.value);
  expect(packet.status).toBe('ready');
  if (packet.status !== 'ready') return;
  expect(execReviewPacketOfText(body)).toMatchObject({ status: 'ready', value: { packet: packet.value } });
});
