import { afterAll, describe, expect, it } from 'vitest';
import { findClass } from './helpers/boot-page.js';
import type { FakeElement } from './helpers/dom.js';
import { descendants, hasClass, textOf } from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { openE3GW1, type E3GWorld } from './helpers/E3G-world.js';
import {
  bootDecide, callsOf, card, cardButton, composer, count, isOff, labelled, opened, quiet, sectionRows, sendButton, settle,
  typeInto, worldTarget, writeOf, type E3DLog,
} from './helpers/E3D-page.js';
import { E3D_OLD_ANSWER, openOldAnswerWorld, seePlanAdoptions, type E3DOldAnswerWorld } from './helpers/E3D-world.js';
import {
  openS6ACardsWorld, openS6ANoticesWorld, seedS6ASharedCards, type S6ACardsWorld, type S6ANoticesWorld,
  type S6AReworkNotices,
} from '../helpers/S6A-cards-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import type { BootedPage } from './helpers/boot-page.js';
import type { DecisionCardV1, DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';

/**
 * E3D-6 D28, D31, D41, D43a, D43b, D44a, D44b (test sheet §2.3, §2.4): 标为已读
 * with the token and positions the page's own read issued, and asking the
 * secretary about a card: `requests/ask` on the card's request round when it
 * has one, `requests/submit` on the card's Goal otherwise, each followed by one
 * `requests/read`. W2n's plan adoptions are marked seen first; W2 is the cards
 * world with the shared request cards; D44a's world answers the request's first
 * round `旧答复` before the candidate exists.
 */

let w2n: { world: S6ANoticesWorld; seeded: S6AReworkNotices } | null = null;
let w2: S6ACardsWorld | null = null;
let old: E3DOldAnswerWorld | null = null;
let w1: E3GWorld | null = null;

afterAll(async () => {
  await w2n?.world.close();
  await w2?.close();
  await old?.world.close();
  await w1?.world.close();
});

async function worldW2n(): Promise<{ world: S6ANoticesWorld; seeded: S6AReworkNotices }> {
  if (w2n === null) {
    const world = await openS6ANoticesWorld({ backend: 'memory' });
    const seeded = await world.seedReworkNotices();
    await seePlanAdoptions(world.main, 'e3d-6-w2n');
    w2n = { world, seeded };
  }
  return w2n;
}

async function worldW2(): Promise<S6ACardsWorld> {
  if (w2 === null) {
    w2 = await openS6ACardsWorld({ backend: 'memory' });
    await seedS6ASharedCards(w2.main, { label: 'e3d-6', goal: w2.world.goals.first, otherGoal: w2.world.goals.second });
  }
  return w2;
}

/** The page's last queue answer that showed the waiting cards (the order its rows follow). */
function shownQueue(log: E3DLog): DecisionQueueReadV1 | undefined {
  const call = callsOf(log, 'decisions/queue').filter((entry) => entry.reply !== undefined
    && ((entry.input as { sections?: string[] }).sections ?? []).includes('waiting_answer')).at(-1);
  return (call?.reply as { value?: DecisionQueueReadV1 } | undefined)?.value;
}

/** Opens the first waiting card that has a request round; answers that card as the page's read showed it. */
async function openRequestCard(page: BootedPage, log: E3DLog): Promise<DecisionCardV1 | undefined> {
  const shown = shownQueue(log)?.waitingAnswer ?? [];
  const index = shown.findIndex((entry) => entry.requestRef !== null);
  const row = index < 0 ? undefined : sectionRows(page.root, '要决定')[index];
  if (row === undefined) return undefined;
  click(row);
  await settle(() => card(page.root) !== undefined, 2_000);
  return shown[index];
}

async function openComposer(page: BootedPage): Promise<void> {
  const ask = cardButton(page.root, '问秘书');
  expect(ask).toBeDefined();
  click(ask!);
  await settle(() => composer(page.root) !== undefined, 1_000);
}

function talkOf(root: FakeElement): { you: string[]; secretary: string[] } {
  const talk = descendants(root).find((element) => hasClass(element, 'dq-talk'));
  if (talk === undefined) return { you: [], secretary: [] };
  return {
    you: descendants(talk).filter((element) => hasClass(element, 'msg-user'))
      .map((element) => textOf(findClass(element, 'bubble'))),
    secretary: descendants(talk).filter((element) => hasClass(element, 'msg-agent')).map((element) => textOf(element)),
  };
}

function replyOf(log: E3DLog, route: string): Record<string, unknown> {
  return (callsOf(log, route).at(-1)?.reply ?? {}) as Record<string, unknown>;
}

describe('E3D-6 notices and asking the secretary', () => {
  it('D28 标为已读 sends the page\'s own token and positions with the Workspace pin', async () => {
    const { world, seeded } = await worldW2n();
    const registration = (await world.world.post('workspaces/registration', plain(S6A_SCOPE, { ...S6A_SCOPE }))).body as
      { value?: { workspace?: { revision: number } } };
    const workspaceRevision = registration.value?.workspace?.revision;
    expect(workspaceRevision).toBeTypeOf('number');
    const { page, log } = await bootDecide(worldTarget(world.world));
    try {
      await opened(log);
      const first = sectionRows(page.root, '请知悉')[0];
      expect(first).toBeDefined();
      click(first!);
      await settle(() => cardButton(page.root, '标为已读') !== undefined, 2_000);
      const page1 = callsOf(log, 'decisions/queue').filter((call) => call.reply !== undefined
        && ((call.input as { sections?: string[] }).sections ?? []).includes('notices')).at(-1);
      const issued = (page1?.reply as { value?: DecisionQueueReadV1 } | undefined)?.value;
      click(cardButton(page.root, '标为已读')!);
      await settle(() => callsOf(log, 'decisions/notices/seen').some((call) => call.reply !== undefined), 5_000);
      await quiet(log);
      expect(count(log, 'decisions/notices/seen')).toBe(1);
      const sent = writeOf(callsOf(log, 'decisions/notices/seen')[0]!);
      expect(sent.input['displayToken']).toBe(issued?.displayToken);
      /* 具名改坏: 把该行的 `position` 当 `seenThrough`；Host 回 `invalid`，D28 的 `committed` 红。 */
      expect(sent.input['seenThrough']).toEqual(issued?.seenThrough);
      expect((sent.input['seenThrough'] as Record<string, unknown>)['automatic_rework']).toEqual(seeded.notices[2]!.notice.position);
      expect(sent.meta.expected).toEqual([{ ref: { aggregateType: 'Workspace', ...S6A_SCOPE }, revision: workspaceRevision }]);
      expect(replyOf(log, 'decisions/notices/seen')['status']).toBe('committed');
      expect(sectionRows(page.root, '请知悉')).toHaveLength(0);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('D31 问秘书 opens the composer quoting the card\'s Goal and reads nothing', async () => {
    const world = await worldW2();
    const { page, log } = await bootDecide(worldTarget(world.world));
    try {
      await opened(log);
      const shown = await openRequestCard(page, log);
      expect(shown).toBeDefined();
      const before = await quiet(log);
      await openComposer(page);
      /* 具名改坏: 打开 composer 就发 `requests/ask`；D31 的零请求红。 */
      expect(composer(page.root)).toBeDefined();
      expect(textOf(findClass(page.root, 'composer-ref'))).toContain('S6A goal one');
      expect(await quiet(log)).toBe(before);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('D41 不问了 closes the composer and brings the card back without a read', async () => {
    const world = await worldW2();
    const { page, log } = await bootDecide(worldTarget(world.world));
    try {
      await opened(log);
      expect(await openRequestCard(page, log)).toBeDefined();
      await openComposer(page);
      const before = await quiet(log);
      const close = labelled(page.root, '不问了，回到决定卡');
      expect(close).toBeDefined();
      click(close!);
      await settle(() => composer(page.root) === undefined, 800);
      /* 具名改坏: 清空时发一次读；D41 的零请求红。 */
      expect(composer(page.root)).toBeUndefined();
      expect(card(page.root)).toBeDefined();
      expect(await quiet(log)).toBe(before);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('D44b a blank question keeps 发送 off and sends nothing', async () => {
    const world = await worldW2();
    const { page, log } = await bootDecide(worldTarget(world.world));
    try {
      await opened(log);
      expect(await openRequestCard(page, log)).toBeDefined();
      await openComposer(page);
      typeInto(page.root, 'ask-input', '   ');
      /* 具名改坏: 空白也发；D44b 的零请求红。 */
      expect(isOff(sendButton(page.root))).toBe(true);
      const before = await quiet(log);
      click(sendButton(page.root)!);
      expect(await quiet(log)).toBe(before);
      expect(count(log, 'requests/ask') + count(log, 'requests/submit')).toBe(0);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('D43a a card with a request round asks on that round with the card\'s pins, then reads the request', async () => {
    const world = await worldW2();
    const { page, log } = await bootDecide(worldTarget(world.world));
    try {
      await opened(log);
      const shown = await openRequestCard(page, log);
      expect(shown).toBeDefined();
      await openComposer(page);
      typeInto(page.root, 'ask-input', '为什么先做这一步？');
      click(sendButton(page.root)!);
      await settle(() => callsOf(log, 'requests/read').some((call) => call.reply !== undefined), 5_000);
      await quiet(log);
      /* 具名改坏: 用 `requests/submit`；D43a 的 `requests/ask` 红。 */
      expect(count(log, 'requests/ask')).toBe(1);
      expect(count(log, 'requests/submit')).toBe(0);
      const input = callsOf(log, 'requests/ask')[0]!.input as Record<string, unknown>;
      expect(input['round']).toEqual(shown!.requestRef);
      expect(input['cardRefs']).toEqual(shown!.source.pins);
      expect(input['regenerate']).toBe(false);
      expect(input['text']).toBe('为什么先做这一步？');
      expect(typeof input['commandId']).toBe('string');
      const asked = replyOf(log, 'requests/ask');
      expect(asked['status']).toBe('queued');
      expect(asked['followupRound']).toBeTruthy();
      expect(count(log, 'requests/read')).toBe(1);
      expect((callsOf(log, 'requests/read')[0]!.input as { requestRoot?: unknown }).requestRoot).toEqual(shown!.requestRef);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('D44a the row\'s talk shows the question and the pending answer of the new round, not an older answer', async () => {
    old ??= await openOldAnswerWorld();
    const { page, log } = await bootDecide(worldTarget(old.world));
    try {
      await opened(log);
      const shown = await openRequestCard(page, log);
      expect(shown?.requestRef).toEqual(old.request.requestRoot);
      await openComposer(page);
      typeInto(page.root, 'ask-input', '这一轮先答什么？');
      click(sendButton(page.root)!);
      await settle(() => callsOf(log, 'requests/read').some((call) => call.reply !== undefined), 5_000);
      await quiet(log);
      await settle(() => talkOf(page.root).you.length > 0, 1_000);
      const talk = talkOf(page.root);
      /* 具名改坏: 取最后一条非空 answer；D44a 的 `旧答复` 红。 */
      expect(talk.you).toEqual(['这一轮先答什么？']);
      expect(talk.secretary).toHaveLength(1);
      expect(talk.secretary[0]).not.toContain(E3D_OLD_ANSWER);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('D43b a card without a request round submits a request on the card\'s Goal, then reads it', async () => {
    w1 ??= await openE3GW1();
    const { page, log } = await bootDecide(worldTarget(w1.world));
    try {
      await opened(log);
      click(sectionRows(page.root, '要决定')[0]!);
      await settle(() => card(page.root) !== undefined, 2_000);
      await openComposer(page);
      typeInto(page.root, 'ask-input', '这两个目标能并行吗？');
      click(sendButton(page.root)!);
      await settle(() => callsOf(log, 'requests/read').some((call) => call.reply !== undefined), 5_000);
      await quiet(log);
      /* 具名改坏: 无 `requestRef` 也发 `requests/ask` 的空 `round`；D43b 红。 */
      expect(count(log, 'requests/ask')).toBe(0);
      expect(count(log, 'requests/submit')).toBe(1);
      const input = callsOf(log, 'requests/submit')[0]!.input as Record<string, unknown>;
      expect(input['goalId']).toBe('s6a-goal-2');
      expect(input['text']).toBe('这两个目标能并行吗？');
      expect(input['references']).toEqual([]);
      expect(input['continues']).toBeNull();
      expect(input['recipient']).toBeNull();
      const submitted = replyOf(log, 'requests/submit');
      expect(submitted['status']).toBe('queued');
      expect((callsOf(log, 'requests/read')[0]!.input as { requestRoot?: unknown }).requestRoot).toEqual(submitted['requestRoot']);
    } finally {
      await page.restore();
    }
  }, 60_000);
});
