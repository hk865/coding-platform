import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { findButton, findClass, findElement } from './helpers/boot-page.js';
import {
  bootE3N, bootMainCard, callsTo, countRoute, descendants, hasClass, quietPage, sentWrite, settledN, textOf, userTexts, waitFor,
} from './helpers/E3N-page.js';
import { click, notConnected, pressEnter } from './helpers/E3N-interact.js';
import { E3N_BUDGET_TITLES, E3N_INTERRUPTED_TITLE, openW1 } from './helpers/E3N-world.js';
import { openE3GW1 } from './helpers/E3G-world.js';
import { card, cardButton, cardTitle, inboxRow, labelled, rowMeta, typeInto } from './helpers/E3D-page.js';
import { openBudgetWorld, openInterruptedWorld, openOldAnswerWorld, seePlanAdoptionsVia } from './helpers/E3D-world.js';
import { cleanupScenarios } from '../scenarios/harness.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE, type S6ARequestWorld } from '../helpers/S6A-request-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { adoptS6BPlan, governS6B } from '../helpers/S6B1-fixture.js';
import type { BootedPage } from './helpers/boot-page.js';
import type { FakeElement } from './helpers/dom.js';

/**
 * E3U T-A06–T-A10, T-A15 (test sheet e3main-a-tests §1.1, §1.2): the decision
 * card in the centre (A23–A30) and the notice card (L02). The card worlds are
 * Host scenarios booted with `bootMainCard`; the conflict world is E3G's W1;
 * the request card world is D44a's (a request the secretary answered, then a
 * candidate tied to it, so the card carries `requestRef`).
 */

const worlds: S6ARequestWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});
afterAll(async () => {
  await cleanupScenarios();
});

type QueueCard = { cardKey: string; requestRef: unknown; subject: { goalRef?: { goalId: string } };
  source: { kind: string; pins: unknown[] } };

async function waitingCards(world: { post(route: string, body: unknown): Promise<{ body: unknown }> }): Promise<QueueCard[]> {
  const read = (await world.post('decisions/queue', plain(S6A_SCOPE, { workspace: S6A_SCOPE,
    sections: ['waiting_answer'], page: { limit: 100 } }))).body as { value: { waitingAnswer: QueueCard[] } };
  return read.value.waitingAnswer;
}

/** Opens the first card of the Goal from the goal bar's `需要你决定 n` (`n` checked when the row names it). */
async function openFromGoalBar(page: BootedPage, n: number | null): Promise<void> {
  const decide = (): FakeElement | undefined => findButton(findClass(page.root, 'goalbar') ?? page.root, '需要你决定');
  await waitFor(() => decide() !== undefined);
  if (n !== null) await waitFor(() => textOf(decide()) === `需要你决定 ${n}`);
  click(decide()!);
  await waitFor(() => card(page.root) !== undefined);
}

async function askOnCard(page: BootedPage, text: string): Promise<void> {
  click(cardButton(page.root, '问秘书')!);
  await waitFor(() => card(page.root) === undefined && labelled(page.root, '发送') !== undefined);
  typeInto(page.root, 'composer-input', text);
  click(labelled(page.root, '发送')!);
}

describe('E3U Main decision card', () => {
  it('T-A06 需要你决定 1 opens the Goal’s card from the data already read', async () => {
    const h = await openInterruptedWorld();
    const { page, log } = await bootMainCard(h, '?goal=ag2b-goal');
    try {
      /* 具名改坏: `Main.dc.html` 的 `gb.openDecide` 保持空函数；卡断言红。 */
      await openFromGoalBar(page, 1);
      /* S1: the card's path is drawn not connected. */
      notConnected(findClass(card(page.root)!, 'ellipsis')!);
      /* 具名改坏: `mainRenderVals` 删掉 `composerOpen` 的覆盖；卡开着时输入区断言红。 */
      expect(findElement(page.root, (element) => element.getAttribute('id') === 'composer-input')).toBeUndefined();
      expect(textOf(findClass(card(page.root)!, 'lvl'))).toBe('要决定');
      expect(cardTitle(page.root)).toBe(E3N_INTERRUPTED_TITLE);
      expect(countRoute(log, 'decisions/card')).toBe(0);
      click(labelled(card(page.root)!, '稍后处理')!);
      await waitFor(() => findElement(page.root, (element) => element.getAttribute('id') === 'composer-input') !== undefined);
    } finally {
      await page.restore();
    }
  }, 240_000);

  it('T-A07 下一条 turns between the two cards and writes nothing', async () => {
    const h = await openBudgetWorld();
    await seePlanAdoptionsVia((route, body) => h.post(route, body), S6A_SCOPE, 'e3u-main-card');
    const { page, log } = await bootMainCard(h, '?goal=ag2b-goal');
    try {
      await openFromGoalBar(page, null);
      await quietPage(log);
      const reads = countRoute(log, 'decisions/queue');
      const first = cardTitle(page.root);
      /* 具名改坏: `hasPrimary: true` 写死；没有主动作的卡画出“确定”。 */
      expect(cardButton(page.root, '确定')).toBeUndefined();
      click(labelled(card(page.root), '下一条')!);
      await waitFor(() => cardTitle(page.root) !== first);
      expect([first, cardTitle(page.root)].sort()).toEqual([...E3N_BUDGET_TITLES].sort());
      expect(cardButton(page.root, '确定')).toBeUndefined();
      click(labelled(card(page.root), '下一条')!);
      await waitFor(() => cardTitle(page.root) === first);
      await quietPage(log);
      /* 具名改坏: `dc.next` 改成调 `answerCard`；零写断言红。 */
      expect(countRoute(log, 'decisions/answer')).toBe(0);
      expect(countRoute(log, 'decisions/queue')).toBe(reads);
    } finally {
      await page.restore();
    }
  }, 240_000);

  it('T-A08 the conflict card’s order choice sends the later Goal first and the card’s pins', async () => {
    const opened = await openE3GW1();
    worlds.push(opened.world);
    const conflict = (await waitingCards(opened.world)).find((entry) => entry.source.kind === 'goal_conflict')!;
    const { page, log } = await bootE3N(opened.world, 'Main', { search: `?goal=${conflict.subject.goalRef!.goalId}` });
    try {
      await openFromGoalBar(page, null);
      const foot = findClass(card(page.root)!, 'dc-foot')!;
      /* 具名改坏: `primaryGo` 去掉 `s.picked !== null` 的守卫；先按回车再断言零次答复，红。 */
      pressEnter(descendants(foot).filter((element) => element.tagName.toLowerCase() === 'button').at(-1)!);
      await quietPage(log);
      expect(countRoute(log, 'decisions/answer')).toBe(0);
      /* The card's options keep `card.options` order: wait, order, parallel (goal-conflicts.ts:77-79). */
      const options = descendants(card(page.root)!).filter((element) => element.tagName.toLowerCase() === 'button'
        && hasClass(element, 'opt-top'));
      click(options[1]!);
      click(descendants(foot).filter((element) => element.tagName.toLowerCase() === 'button').at(-1)!);
      await settledN(log, 'decisions/answer', 1);
      /* M1: a successful answer closes the card and hands the composer back. */
      await waitFor(() => card(page.root) === undefined);
      const sent = sentWrite(callsTo(log, 'decisions/answer')[0]);
      /* 具名改坏: `src/ui/adapters/goals.ts` 的 `conflictSelectionOf` 把 earlier/later 反过来；`goalOrder` 红。 */
      expect(sent.input['selection']).toEqual({
        kind: 'conflict_order', goalOrder: [opened.world.goals.second, opened.world.goals.first],
      });
      expect(sent.meta.expected).toEqual(conflict.source.pins);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('T-A09 问秘书 on a card with requestRef asks that round with the card pins and no text prefix', async () => {
    const opened = await openOldAnswerWorld();
    worlds.push(opened.world);
    const candidate = (await waitingCards(opened.world)).find((entry) => entry.source.kind === 'candidate')!;
    const { page, log } = await bootE3N(opened.world, 'Main', { search: '?goal=ag2b-goal' });
    try {
      await openFromGoalBar(page, null);
      /* The candidate card is named `<Goal> · 计划候选` (E3-DECIDE wording); 下一条 reaches it. */
      if (!cardTitle(page.root).includes('计划候选')) click(labelled(card(page.root), '下一条')!);
      await waitFor(() => cardTitle(page.root).includes('计划候选'));
      await askOnCard(page, '这个卡怎么办');
      /* 具名改坏: `askCard` 改走 `requests/submit`；`requests/ask` 计数红。 */
      await settledN(log, 'requests/ask', 1);
      const input = callsTo(log, 'requests/ask')[0]!.input as Record<string, unknown>;
      expect(input['round']).toEqual(candidate.requestRef);
      expect(input['cardRefs']).toEqual(candidate.source.pins);
      expect(input['regenerate']).toBe(false);
      expect(input['text']).toBe('这个卡怎么办');
      await quietPage(log);
      expect(countRoute(log, 'requests/read')).toBe(1);
      await waitFor(() => userTexts(page.root).includes('这个卡怎么办'));
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('T-A10 问秘书 on a card without requestRef submits the typed text alone', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    const { page, log } = await bootE3N(opened.world, 'Main', { search: '?goal=ag2b-goal' });
    try {
      /* W1's Goal waits on its two missing-pointer cards; neither names a request. */
      await openFromGoalBar(page, null);
      await askOnCard(page, '这个卡怎么办');
      await settledN(log, 'requests/submit', 1);
      const input = callsTo(log, 'requests/submit')[0]!.input as Record<string, unknown>;
      expect(input['text']).toBe('这个卡怎么办');
      expect(input['references']).toEqual([]);
      /* 具名改坏: `askCard` 没有 `requestRef` 时仍调 `requests/ask`；零次断言红。 */
      expect(countRoute(log, 'requests/ask')).toBe(0);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('T-A15 opening 请知悉 writes nothing; 标为已读 writes once with the page token', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    /* One Plan adoption is the one `plan_adoption` notice (plan-adoption-notices.ts). */
    const ws = s6aCardsWorkspace(opened.world, S6A_SCOPE);
    await governS6B(opened.world, ws, opened.world.goals);
    await adoptS6BPlan(ws, opened.world.goals.first, { label: 'e3u-a15', taskIds: ['e3u-a15-work'],
      role: S6A_WORK_ROLE.templateId });
    const registration = (await opened.world.post('workspaces/registration', plain(S6A_SCOPE, { ...S6A_SCOPE }))).body as
      { value: { workspace: { revision: number } } };
    const { page, log } = await bootE3N(opened.world, 'Main', { search: '?goal=ag2b-goal' });
    try {
      await waitFor(() => rowMeta(inboxRow(page.root, '请知悉')) === '1');
      click(inboxRow(page.root, '请知悉')!);
      await waitFor(() => cardButton(page.root, '标为已读') !== undefined);
      expect(textOf(findClass(card(page.root)!, 'lvl'))).toBe('请知悉');
      /* S1: the notice's 问秘书 is drawn not connected and sets no quote. */
      notConnected(cardButton(page.root, '问秘书')!);
      expect(card(page.root)).toBeDefined();
      await quietPage(log);
      /* 具名改坏: `markNoticeSeen` 在打开卡时就调；“打开 0 次”红。 */
      expect(countRoute(log, 'decisions/notices/seen')).toBe(0);
      const issued = [...callsTo(log, 'main/read'), ...callsTo(log, 'decisions/queue')]
        .map((call) => (call.reply as { value?: { displayToken?: unknown; seenThrough?: unknown } } | undefined)?.value)
        .filter((value) => value !== undefined && typeof value.displayToken === 'string')
        .map((value) => ({ displayToken: value!.displayToken, seenThrough: value!.seenThrough }));
      click(cardButton(page.root, '标为已读')!);
      await settledN(log, 'decisions/notices/seen', 1);
      await waitFor(() => card(page.root) === undefined);
      const sent = sentWrite(callsTo(log, 'decisions/notices/seen')[0]);
      expect(issued).toContainEqual({ displayToken: sent.input['displayToken'], seenThrough: sent.input['seenThrough'] });
      expect((sent.meta.expected[0] as { revision: number }).revision).toBe(registration.value.workspace.revision);
      expect(sent.meta.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    } finally {
      await page.restore();
    }
  }, 120_000);
});
