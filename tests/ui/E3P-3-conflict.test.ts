import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { findButton, findClass } from './helpers/boot-page.js';
import { bootE3N, callsTo, countRoute, descendants, hasClass, quietPage, sentWrite, textOf, waitFor } from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { card, cardButton, labelled, typeInto } from './helpers/E3D-page.js';
import { openE3GW1, e3gGoalPins, type E3GWorld } from './helpers/E3G-world.js';
import { answerOf, conflictCard, headOf, options, planReady } from './helpers/E3P-world.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE, type S6ARequestWorld } from '../helpers/S6A-request-fixture.js';
import type { FakeElement } from './helpers/dom.js';

/**
 * E3P PA-10/13, PA-11/51, PA-14, PA-50, PA-53 (test sheet e3plan-a-tests §2.3):
 * W3 is E3G's W1, one `goal_conflict` card on the later Goal `s6a-goal-2` over
 * the two `E3G_OVERLAP` files. The reading rows share one W3; each writing row
 * opens its own.
 */

const LATER = '?goal=s6a-goal-2';
type QueueCard = { requestRef: unknown; source: { kind: string; pins: unknown[] } };

let shared: E3GWorld;
const own: E3GWorld[] = [];

/** W3: `openE3GW1` with goal 2 in front in `goals/list.order`, opposite the pins (lead 6). */
async function openW3(): Promise<E3GWorld> {
  const opened = await openE3GW1();
  const pins = await e3gGoalPins(opened.world);
  const answer = (await opened.world.post('goals/reorder', graphWrite(S6A_SCOPE, {
    workspace: S6A_SCOPE, goalOrder: [opened.world.goals.second, opened.world.goals.first],
  }, 'e3p-reorder', [pins[1]!, pins[0]!]))).body as { status?: string };
  if (answer.status !== 'committed') throw new Error('E3P: the W3 reorder did not commit');
  return opened;
}

beforeAll(async () => { shared = await openW3(); }, 180_000);
afterAll(async () => { await shared?.world.close(); });
afterEach(async () => { for (const opened of own.splice(0)) await opened.world.close(); });

/** The waiting `goal_conflict` card as the public queue states it. */
async function conflictOf(world: S6ARequestWorld): Promise<QueueCard> {
  const read = (await world.post('decisions/queue', plain(S6A_SCOPE, { workspace: S6A_SCOPE,
    sections: ['waiting_answer'], page: { limit: 100 } }))).body as { value: { waitingAnswer: QueueCard[] } };
  return read.value.waitingAnswer.find((entry) => entry.source.kind === 'goal_conflict')!;
}

const footButton = (holder: FakeElement, text: string): FakeElement | undefined =>
  findButton(findClass(holder, 'plan-foot') ?? holder, text);

/** Opens the bottom card from the goal bar's `.gb-decide`. */
async function openBottomCard(root: FakeElement): Promise<FakeElement> {
  await waitFor(() => findClass(root, 'gb-decide') !== undefined);
  click(findClass(root, 'gb-decide')!);
  await waitFor(() => card(root) !== undefined);
  return card(root)!;
}

describe('E3P Plan conflict card and bottom card', () => {
  it('PA-10/13 the conflict card names the earlier Goal and the overlap, and 确定 without a choice sends nothing', async () => {
    const { page, log } = await bootE3N(shared.world, 'Plan', { search: LATER });
    try {
      await planReady(log);
      const cf = conflictCard(page.root)!;
      expect(headOf(cf, 'ttl')).toBe('与目标 1 冲突');
      /* 具名改坏: `.scope` 写死“3 个方案”；这一句红。 */
      expect(headOf(cf, 'scope')).toBe('重叠 2 个文件');
      expect(options(cf).map((option) => option.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false']);
      click(footButton(cf, '确定')!);
      await quietPage(log);
      /* 具名改坏: 去掉未选守卫；这一句红。 */
      expect(countRoute(log, 'decisions/answer')).toBe(0);
      const go = footButton(conflictCard(page.root)!, '确定')!;
      expect(hasClass(go, 'is-off')).toBe(true);
      expect(go.getAttribute('aria-disabled')).toBe('true');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it.each(['冲突卡', '底部卡'] as const)('PA-11/51 the %s answers wait with the card’s own pins', async (entry) => {
    const opened = await openW3();
    own.push(opened);
    const conflict = await conflictOf(opened.world);
    const { page, log } = await bootE3N(opened.world, 'Plan', { search: LATER });
    try {
      await planReady(log);
      if (entry === '冲突卡') {
        click(options(conflictCard(page.root)!)[0]!);
        click(footButton(conflictCard(page.root)!, '确定')!);
      } else {
        click(options(await openBottomCard(page.root))[0]!);
        const foot = findClass(card(page.root)!, 'dc-foot')!;
        click(descendants(foot).find((element) => element.tagName.toLowerCase() === 'button' && hasClass(element, 'btn-primary'))!);
      }
      const reply = await answerOf(log, 'decisions/answer');
      expect(countRoute(log, 'decisions/answer')).toBe(1);
      const sent = sentWrite(callsTo(log, 'decisions/answer')[0]);
      /* lead 6: earlier/later follow `goals/list.order` (goal 2 first), not the pins. */
      expect(sent.input['selection']).toEqual({ kind: 'conflict_wait', earlier: opened.world.goals.second,
        later: opened.world.goals.first });
      /* 具名改坏: 少发 Plan pin；Host 回 `revision_conflict`，这一句红。 */
      expect((reply as { value?: { answer?: { status?: string } } }).value?.answer?.status).toBe('committed');
      expect(sent.meta.expected).toEqual(conflict.source.pins);
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('PA-14 问秘书 on the conflict card quotes the two Goals without file names and sends nothing', async () => {
    const { page, log } = await bootE3N(shared.world, 'Plan', { search: LATER });
    try {
      await planReady(log);
      click(footButton(conflictCard(page.root)!, '问秘书')!);
      await waitFor(() => findClass(page.root, 'composer-ref') !== undefined);
      /* 具名改坏: 预填只写“冲突”；这一句红。 */
      expect(textOf(findClass(findClass(page.root, 'composer-ref')!, 'ellipsis'))).toBe('引用：目标 1 与目标 2 冲突');
      await quietPage(log);
      expect(countRoute(log, 'requests/submit')).toBe(0);
      expect(countRoute(log, 'requests/ask')).toBe(0);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('PA-50 the bottom card shows the level, the conflict title and the Goal path', async () => {
    const { page, log } = await bootE3N(shared.world, 'Plan', { search: LATER });
    try {
      await planReady(log);
      const open = await openBottomCard(page.root);
      const head = findClass(open, 'dc-head')!;
      expect(textOf(findClass(head, 'lvl'))).toBe('要决定');
      /* 具名改坏: 解析 `source.key` 拼标题/路径；下面两句红。 */
      expect(textOf(findClass(open, 'dc-title'))).toBe('与目标 1 冲突');
      const path = descendants(head).find((element) => hasClass(element, 'btn-text') && hasClass(element, 'ellipsis'));
      expect(textOf(path)).toBe('目标 2 / S6A goal two');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('PA-53 问秘书 on a card without a round submits a new request on the card’s Goal', async () => {
    const opened = await openW3();
    own.push(opened);
    expect((await conflictOf(opened.world)).requestRef).toBeNull();
    const { page, log } = await bootE3N(opened.world, 'Plan', { search: LATER });
    try {
      await planReady(log);
      await openBottomCard(page.root);
      click(cardButton(page.root, '问秘书')!);
      await waitFor(() => card(page.root) === undefined && labelled(page.root, '发送') !== undefined);
      typeInto(page.root, 'plan-input', '为什么停');
      click(labelled(page.root, '发送')!);
      await waitFor(() => [...callsTo(log, 'requests/submit'), ...callsTo(log, 'requests/ask')]
        .some((call) => call.reply !== undefined));
      await quietPage(log);
      /* 具名改坏: 无轮也发 `requests/ask`；Host 回 `invalid`，这两句红。 */
      expect(countRoute(log, 'requests/submit')).toBe(1);
      expect(countRoute(log, 'requests/ask')).toBe(0);
      const input = callsTo(log, 'requests/submit')[0]!.input as Record<string, unknown>;
      expect(input['goalId']).toBe('s6a-goal-2');
      expect(input['continues']).toBeNull();
      expect(input['references']).toEqual([]);
    } finally {
      await page.restore();
    }
  }, 180_000);
});
