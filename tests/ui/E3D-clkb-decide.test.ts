import { afterAll, describe, expect, it } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { DecisionCardV1, DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { AG2B_SCOPE, AG2B_WORK_TASK_ID, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { adoptS6BPlan, createS6BLine } from '../helpers/S6B1-fixture.js';
import { sessionOf } from '../helpers/S7A-fixture.js';
import {
  answerS7BWait, openS7BWorld, retireS7BSender, sendS7BWaitingInquiry,
} from '../helpers/S7B-fixture.js';
import { openJoinedLineScenario } from '../helpers/KLS3B-git-lines.js';
import { cleanupScenarios, performs, type HostScenario } from '../scenarios/harness.js';
import type { FakeElement } from './helpers/dom.js';
import { click } from './helpers/E3N-interact.js';
import {
  bootDecide, callsOf, card, cardButton, cardTitle, count, hostTarget, isOff, opened, quiet, rowName, rowSub,
  sectionRows, settle, worldTarget, writeOf, type E3DLog,
} from './helpers/E3D-page.js';
import { seePlanAdoptionsVia } from './helpers/E3D-world.js';

/**
 * E3D CLKB P11-8 and P13-5 (test sheet §3 package 6, rows P11-8/P13-5):
 * - P11-8: a real Host's `undelivered_reply` notice is the 「请知悉」 row, the
 *   row opens a notice card, and 「标为已读」 sends the page's own display token
 *   and seen-through with the Workspace pin in ONE `decisions/notices/seen`.
 * - P13-5: the Workflow's `member_creation` card from a real Host is the
 *   「成员创建」 row, its options are selectable, and 「确定」 sends ONE
 *   `decisions/answer` whose selection is the approve option with the card's
 *   own pins; the card leaves the pending list.
 *
 * The undelivered world uses only existing exports: two Work lines and their
 * scripted model calls (`sendS7BWaitingInquiry` with `trailingText: false`),
 * the real member reply (`answerS7BWait`), and the frozen real Kernel-missing
 * retirement (`retireS7BSender`), after which the production
 * `undelivered_reply` notice source reads the saved reply. The member world is
 * the KLS-3b line world: the Workflow asks for a member on the Goal whose line
 * has no executor Session, exactly as `KLS3B-session-line.test.ts:57-64` does.
 */

let p11: { made: Awaited<ReturnType<typeof openS7BWorld>> } | null = null;
let p13: { h: HostScenario; card: DecisionCardV1 } | null = null;

afterAll(async () => {
  await p11?.made.world.close();
  await cleanupScenarios();
});

/** The undelivered-reply notice world (see the header). */
async function undeliveredWorld(): Promise<NonNullable<typeof p11>> {
  if (p11 !== null) return p11;
  const made = await openS7BWorld({ backend: 'sqlite' });
  try {
    // The frozen waiting world, the real reply, then the frozen `retireS7BSender` real Kernel-missing
    // retirement (an intervention Run that consumes no wait). The saved, unaccepted reply is what the
    // production `undelivered_reply` notice source reads once the sender is retired.
    const main = s6aCardsWorkspace(made.world, S6A_SCOPE);
    const goal = (await main.createGoal('e3d-clkb-p11-goal', 'CLKB P11 goal')).ref;
    const { tasks } = await adoptS6BPlan(main, goal, { label: 'e3d-clkb-p11',
      taskIds: ['e3d-clkb-p11-send', 'e3d-clkb-p11-reply'], role: S6A_WORK_ROLE.templateId });
    const sender = await sessionOf(made.world, await createS6BLine(main,
      { label: 'e3d-clkb-p11-sender', role: S6A_WORK_ROLE, tasks: [tasks[0]!] }));
    const recipient = await sessionOf(made.world, await createS6BLine(main,
      { label: 'e3d-clkb-p11-recipient', role: S6A_WORK_ROLE }));
    const sent = await sendS7BWaitingInquiry(made.world, { goal, session: sender, taskId: tasks[0]!.taskId,
      label: 'e3d-clkb-p11', trailingText: false, body: { recipient: recipient.ref, text: 'CLKB P11 question',
        intent: 'inquiry', needsReply: true, waitAfterSend: true } });
    await answerS7BWait(made.world, { goal, recipient, message: sent.ref, task: tasks[1]!, label: 'e3d-clkb-p11' });
    await retireS7BSender(made.world, { goal, sender, task: tasks[0]!, label: 'e3d-clkb-p11' });
    await seePlanAdoptionsVia((route, body) => made.world.post(route, body), S6A_SCOPE, 'e3d-clkb-p11');
    p11 = { made };
    return p11;
  } catch (error) {
    await made.world.close().catch(() => undefined);
    throw error;
  }
}

/** The member-creation world (see the header; the same drive as the KLS-3b route row). */
async function memberWorld(): Promise<NonNullable<typeof p13>> {
  if (p13 !== null) return p13;
  const { h } = await openJoinedLineScenario();
  await h.advance(h.select('e3d-clkb-13', AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
  const queue = await h.post<ReadResult<{ waitingAnswer: DecisionCardV1[] }>>('decisions/queue',
    plain(AG2B_SCOPE, { workspace: AG2B_SCOPE, sections: ['waiting_answer'], page: { limit: 100 } }));
  const card = queue.status === 'ready'
    ? queue.value.waitingAnswer.find((item) => item.source.kind === 'member_creation') : undefined;
  if (card === undefined) throw new Error(`E3D P13-5: no member_creation card: ${JSON.stringify(queue)}`);
  p13 = { h, card };
  return p13;
}

/** The last queue answer that carried notices: the page's own token and seen-through for the row. */
function shownNotices(log: E3DLog): DecisionQueueReadV1 | undefined {
  const call = callsOf(log, 'decisions/queue').filter((entry) => entry.reply !== undefined
    && ((entry.input as { sections?: string[] }).sections ?? []).includes('notices')).at(-1);
  return (call?.reply as { value?: DecisionQueueReadV1 } | undefined)?.value;
}

function replyOf(log: E3DLog, route: string): Record<string, unknown> {
  return (callsOf(log, route).at(-1)?.reply ?? {}) as Record<string, unknown>;
}

/** The row of `section` whose name contains `word`, with the DOM reads the page's own classes allow. */
function rowWith(root: FakeElement, section: string, word: string): FakeElement | undefined {
  return sectionRows(root, section).find((row) => rowName(row).includes(word));
}

function cardLvl(root: FakeElement): string {
  const open = card(root);
  return open === undefined ? '' : open.getAttribute('aria-label') ?? '';
}

describe('E3D CLKB Decide: an undelivered-reply notice and a member-creation card', () => {
  it('P11-8 请知悉 lists the undelivered-reply notice; 标为已读 sends the page token and positions once', async () => {
    const { made } = await undeliveredWorld();
    const registration = (await made.world.post('workspaces/registration', plain(S6A_SCOPE, { ...S6A_SCOPE }))).body as
      { value?: { workspace?: { revision: number } } };
    const workspaceRevision = registration.value?.workspace?.revision;
    expect(workspaceRevision).toBeTypeOf('number');
    const { page, log } = await bootDecide(worldTarget(made.world));
    try {
      await opened(log);
      const row = rowWith(page.root, '请知悉', '未送达回复');
      expect(row, 'the 请知悉 row of the undelivered reply').toBeDefined();
      /* 具名改坏: 把未送达回复当自动返工（`automatic_rework`）；P11-8 的类别词红。 */
      expect(rowSub(row)).toContain('未送达的回复');
      expect(rowSub(row)).not.toContain('自动返工');
      expect(rowName(row)).not.toContain('自动返工');

      click(row!);
      await settle(() => card(page.root) !== undefined, 2_000);
      expect(cardLvl(page.root)).toBe('请知悉');
      expect(cardTitle(page.root)).toContain('未送达回复');

      const issued = shownNotices(log);
      const notice = issued?.notices.find((entry) => entry.category === 'undelivered_reply');
      expect(notice).toBeDefined();
      expect(issued?.displayToken).toBeTruthy();

      const seen = cardButton(page.root, '标为已读');
      expect(seen).toBeDefined();
      click(seen!);
      await settle(() => callsOf(log, 'decisions/notices/seen').some((call) => call.reply !== undefined), 5_000);
      await quiet(log);
      /* 具名改坏: 发空 seenThrough（不读页面那一页）；P11-8 的 `seenThrough` 红。 */
      expect(count(log, 'decisions/notices/seen')).toBe(1);
      const sent = writeOf(callsOf(log, 'decisions/notices/seen')[0]!);
      expect(sent.input['displayToken']).toBe(issued?.displayToken);
      expect(sent.input['seenThrough']).toEqual(issued?.seenThrough);
      expect(sent.meta.expected).toEqual([{ ref: { aggregateType: 'Workspace', ...S6A_SCOPE },
        revision: workspaceRevision }]);
      expect(replyOf(log, 'decisions/notices/seen')['status']).toBe('committed');

      await settle(() => rowWith(page.root, '请知悉', '未送达回复') === undefined, 5_000);
      /* 具名改坏: 已读后不清掉这一行；P11-8 的行状态红。 */
      expect(rowWith(page.root, '请知悉', '未送达回复')).toBeUndefined();
      expect(sectionRows(page.root, '请知悉').length).toBe(0);
      expect(cardButton(page.root, '标为已读')).toBeUndefined();
      expect(cardTitle(page.root)).not.toContain('未送达回复');
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('P13-5 the member-creation row opens a generic card; 确定 answers approve once and the card leaves', async () => {
    const { h, card: memberCard } = await memberWorld();
    const { page, log } = await bootDecide(hostTarget(h));
    try {
      await opened(log);
      const row = rowWith(page.root, '要决定', '成员创建');
      expect(row, 'the 要决定 row of the member creation').toBeDefined();
      expect(rowName(row)).toContain('成员创建');

      click(row!);
      await settle(() => card(page.root) !== undefined, 2_000);
      expect(cardLvl(page.root)).toBe('要决定');
      expect(cardTitle(page.root)).toContain('成员创建');

      const agree = cardButton(page.root, '同意');
      expect(agree, 'the member creation approve option').toBeDefined();
      const decide = cardButton(page.root, '确定');
      expect(decide).toBeDefined();
      /* 具名改坏: 没选就让“确定”可用；P13-5 的 `is-off` 红。 */
      expect(isOff(decide)).toBe(true);
      click(agree!);
      await settle(() => cardButton(page.root, '同意')?.getAttribute('aria-checked') === 'true', 1_000);
      /* 具名改坏: 选项点击不改变选中态；P13-5 的 `aria-checked` 红。 */
      expect(cardButton(page.root, '同意')?.getAttribute('aria-checked')).toBe('true');
      expect(isOff(cardButton(page.root, '确定'))).toBe(false);
      const before = count(log, 'decisions/queue');
      click(cardButton(page.root, '确定')!);
      await settle(() => callsOf(log, 'decisions/answer').some((call) => call.reply !== undefined), 8_000);
      await settle(() => count(log, 'decisions/queue') > before, 8_000);
      await quiet(log);
      /* 具名改坏: 用 `approve` 以外的选项或省掉卡上的 pins；P13-5 的请求载荷红。 */
      expect(count(log, 'decisions/answer')).toBe(1);
      const sent = writeOf(callsOf(log, 'decisions/answer')[0]!);
      expect(sent.input['source']).toEqual(memberCard.source);
      expect(sent.input['selection']).toEqual({ kind: 'option', optionId: 'approve' });
      expect(sent.input['text']).toBe('');
      expect(sent.input['annotations']).toEqual([]);
      expect(sent.meta.expected).toEqual(memberCard.source.pins);
      const answered = replyOf(log, 'decisions/answer') as { status?: string; value?: { answer?: { status?: string } } };
      expect(answered.status).toBe('ready');
      expect(answered.value?.answer?.status).toBe('committed');

      await settle(() => rowWith(page.root, '要决定', '成员创建') === undefined, 8_000);
      /* 具名改坏: 答复后卡仍留在待决列表；P13-5 的“卡离开”红。 */
      expect(rowWith(page.root, '要决定', '成员创建')).toBeUndefined();
    } finally {
      await page.restore();
    }
  }, 180_000);
});
