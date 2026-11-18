/**
 * R13 冻结稿第五节 I2、P1，纯函数和提示词包（RULES A5）；期望值是 B2、四·2 的字。
 * - I2 `execReviewPacketText`（B2）：插话接在固定正文之后，消息号（转发副本也一样）取哈希段前 8 位、Run 号取前 8 位
 *   （号码用 B2 示例那两个）。守的改坏：
 *   少了省略那一行；少了截断注记；包头或固定正文被动；转发副本印成 `forward-…`。1,200 字截到 1,000 在 B1 的读上截，
 *   由 I1 守，包不另截。
 * - P1 `exec-review-input` 第 2 版（四·2）。守的改坏：模板没改或改错。
 */
import { expect, it } from 'vitest';
import type { RunRef } from '../../src/contracts/dispatch.js';
import { renderTemplate } from '../../src/contracts/prompts/render-template.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../src/contracts/prompts/platform-pack.generated.js';
import {
  execReviewPacketOfText, execReviewPacketText, type ExecReviewPacketV1,
} from '../../src/core/work-graph/tasks/exec-review-packet.js';
import type { GoalPersonInterventionV1 } from '../../src/core/work-graph/tasks/person-interventions.js';

const P = 'p', W = 'w', G = 'g', T = 't';
const RUN: RunRef = { aggregateType: 'Run', projectId: P, goalId: G, runId: '762d6bac-be50-45d9-a2e0-3ed74f19f7b4' };
const PACKET: ExecReviewPacketV1 = {
  roundRef: { aggregateType: 'VerificationRound', projectId: P, workspaceId: W, goalId: G, taskId: T, runId: RUN.runId,
    roundId: 'round-1' },
  planRevisionRef: { aggregateType: 'PlanRevision', projectId: P, planId: 'plan-1' },
  taskRef: { projectId: P, goalId: G, taskId: T }, subjectRunRef: RUN, checkRefs: [], sourceDigest: 'digest-1',
  coverage: [{ obligationId: 'obligation-1', requirementId: 'requirement-1' }],
};
const item = (text: string, truncated: boolean, messageId = 'session-message-6db12e9b2a3c'): GoalPersonInterventionV1 => ({
  runRef: RUN, taskId: T, messageRef: { aggregateType: 'SessionMessage', projectId: P, workspaceId: W, messageId },
  acceptedAt: '2026-11-18T00:00:00.000Z', text: { text, truncated } });

it('I2(a)：一条插话和省略条数接在固定正文之后，包头读回不变', () => {
  const body = '人的原话，原样。';
  const section = ['Direct interventions from the person in this Goal (the person\'s own words, verbatim):',
    '- message 6db12e9b…, accepted by Run 762d6bac… (task t) at 2026-11-18T00:00:00.000Z:',
    '  ```', body, '  ```', '(2 earlier interventions not listed)'].join('\n');
  const text = execReviewPacketText(PACKET, { items: [item(body, false)], omitted: 2 });
  expect(text).toBe(`${execReviewPacketText(PACKET)}\n\n${section}`);
  expect(execReviewPacketOfText(text)).toMatchObject({ status: 'ready', value: { packet: PACKET } });
});

it('I2(b)：截过的原话（B1 已截到 1,000 字）照放，并注明截断', () => {
  const text = execReviewPacketText(PACKET, { items: [item('x'.repeat(1_000), true)], omitted: 0 });
  expect(text).toContain('x'.repeat(1_000));
  expect(text).not.toContain('x'.repeat(1_001));
  expect(text).toContain('(cut to the first 1000 characters)');
});

it('I2(c)：转发副本的消息号同样取哈希段', () => expect(execReviewPacketText(PACKET, { items: [item('y', false,
  'session-message-forward-0a1b2c3d4e5f')], omitted: 0 })).toContain('\n- message 0a1b2c3d…, accepted by Run 762d6bac… '));

it('P1：exec-review-input 第 2 版是“输入”加第 4 条', () => {
  const prompt = renderTemplate(PLATFORM_PROMPT_PACK_V1, 'exec-review-input', {}, []).text;
  expect(prompt).toContain('## 输入\n');
  expect(prompt).not.toContain('## 三样输入');
  expect(prompt).toContain('4. 上面消息里列出的“人的直接干预”（如果有）：人的原话和收下它的 Run。'
    + '按人的插话做的改动不算越界，只核对照做没有、和别的要求冲不冲突。');
});
