import { afterAll, describe, expect, it } from 'vitest';
import { findButton, findClass, findElement } from './helpers/boot-page.js';
import type { FakeElement } from './helpers/dom.js';
import { descendants, goalRows, lineRows, textOf } from './helpers/E3N-page.js';
import { click, hover } from './helpers/E3N-interact.js';
import { openE3GW0, openE3GW1, type E3GWorld } from './helpers/E3G-world.js';
import {
  bootDecide, callsOf, card, cardPos, count, labelled, lineControl, opened, quiet, rowSub, sectionNames, sectionRows,
  settle, worldTarget,
} from './helpers/E3D-page.js';
import { seePlanAdoptions } from './helpers/E3D-world.js';
import {
  openS6ACardsWorld, openS6ANoticesWorld, seedS6ASharedCards, type S6ACardsWorld, type S6ANoticesWorld,
} from '../helpers/S6A-cards-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import type { DecisionCardV1 } from '../../src/core/work-graph/model/decision-contracts.js';

/**
 * E3D-2 D09–D17, D11, D45 (test sheet §2.1): the two tabs, the answered list
 * and its answer body, clearing the Goal filter, 下一条 and 稍后处理, the back
 * link and the secretary row. W1's plan adoptions are marked seen first (public
 * `decisions/notices/seen`), so its 待处理 has the conflict card alone; D10
 * answers that card through the public `decisions/answer` before its page.
 */

let w1: E3GWorld | null = null;
let w2n: S6ANoticesWorld | null = null;
let w2: S6ACardsWorld | null = null;
let w0: E3GWorld | null = null;

afterAll(async () => {
  await w1?.world.close();
  await w2n?.close();
  await w2?.close();
  await w0?.world.close();
});

async function worldW1(): Promise<E3GWorld> {
  if (w1 === null) {
    w1 = await openE3GW1();
    await seePlanAdoptions(w1.ws, 'e3d-2-w1');
  }
  return w1;
}

async function worldW2n(): Promise<S6ANoticesWorld> {
  if (w2n === null) {
    w2n = await openS6ANoticesWorld({ backend: 'memory' });
    await w2n.seedReworkNotices();
    await seePlanAdoptions(w2n.main, 'e3d-2-w2n');
  }
  return w2n;
}

async function worldW2(): Promise<S6ACardsWorld> {
  if (w2 === null) {
    w2 = await openS6ACardsWorld({ backend: 'memory' });
    await seedS6ASharedCards(w2.main, { label: 'e3d-2', goal: w2.world.goals.first, otherGoal: w2.world.goals.second });
  }
  return w2;
}

async function worldW0(): Promise<E3GWorld> {
  w0 ??= await openE3GW0();
  return w0;
}

function tab(root: FakeElement, name: string): FakeElement | undefined {
  return findElement(root, (element) => element.getAttribute('role') === 'tab' && textOf(element).startsWith(name));
}

/** The text the D10 seed answers the conflict card with. */
const D10_ANSWER = '先等目标 1 做完再说';

/** `decisions/answer` of W1's conflict card as the person would send it, with the card's own pins. */
async function answerConflict(world: E3GWorld): Promise<void> {
  const read = (await world.world.post('goals/conflicts', plain(S6A_SCOPE, { workspace: S6A_SCOPE }))).body as
    { value?: { cards?: DecisionCardV1[] } };
  const conflict = read.value?.cards?.[0];
  if (conflict === undefined) throw new Error(`E3D: W1 has no conflict card: ${JSON.stringify(read)}`);
  const answer = (await world.world.post('decisions/answer', graphWrite(S6A_SCOPE, {
    source: conflict.source,
    selection: { kind: 'conflict_wait', earlier: world.world.goals.first, later: world.world.goals.second },
    text: D10_ANSWER, annotations: [],
  }, 'e3d-d10-answer', conflict.source.pins))).body as { value?: { answer?: { status?: string } } };
  if (answer.value?.answer?.status !== 'committed') throw new Error(`E3D: the D10 answer did not commit: ${JSON.stringify(answer)}`);
}

describe('E3D-2 tabs, the filter and the card controls', () => {
  it('D09 待处理 is the selected tab and holds only 要决定', async () => {
    const world = await worldW1();
    const { page, log } = await bootDecide(worldTarget(world.world));
    try {
      await opened(log);
      /* 具名改坏: 默认选“已处理”；D09 的 `aria-selected` 红。 */
      expect(tab(page.root, '待处理')?.getAttribute('aria-selected')).toBe('true');
      expect(tab(page.root, '已处理')?.getAttribute('aria-selected')).toBe('false');
      expect(sectionNames(page.root)).toEqual(['要决定']);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('D10 已处理 lists the answered cards and opens the answer body on demand', async () => {
    const world = await worldW1();
    await answerConflict(world);
    const { page, log } = await bootDecide(worldTarget(world.world));
    try {
      await opened(log);
      const done = tab(page.root, '已处理');
      expect(done).toBeDefined();
      click(done!);
      await settle(() => sectionNames(page.root).includes('已处理'), 3_000);
      await quiet(log);
      expect(sectionNames(page.root)).toEqual(['已处理']);
      /* 具名改坏: 已处理行用 `waitingAnswer` 计数；D10 的行数红。W1 的已处理是两张已采用计划的候选卡加这张冲突卡。 */
      const rows = sectionRows(page.root, '已处理');
      expect(rows).toHaveLength(3);
      const conflict = rows.find((row) => rowSub(row).includes('等前一个目标'));
      expect(conflict).toBeDefined();
      click(conflict!);
      await settle(() => findButton(page.root, '看答复') !== undefined, 2_000);
      expect(count(log, 'materials/open')).toBe(0);
      const look = findButton(page.root, '看答复');
      expect(look).toBeDefined();
      click(look!);
      await settle(() => callsOf(log, 'materials/open').some((call) => call.reply !== undefined), 3_000);
      await quiet(log);
      expect(count(log, 'materials/open')).toBe(1);
      expect(textOf(page.root)).toContain(D10_ANSWER);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('D13 clearing the Goal filter reads the whole workspace again', async () => {
    const world = await worldW2n();
    const { page, log } = await bootDecide(worldTarget(world.world));
    try {
      await opened(log);
      const second = goalRows(page.root).find((row) => textOf(findClass(row, 'row-ord')) === '2');
      expect(second).toBeDefined();
      click(second!);
      await settle(() => findClass(page.root, 'dq-filter') !== undefined, 3_000);
      await quiet(log);
      const clear = labelled(findClass(page.root, 'dq-filter'), '看全部目标');
      expect(clear).toBeDefined();
      const before = count(log, 'decisions/queue');
      click(clear!);
      await settle(() => callsOf(log, 'decisions/queue').slice(before).some((call) => call.reply !== undefined), 3_000);
      await quiet(log);
      const reread = callsOf(log, 'decisions/queue').slice(before);
      expect(reread.length).toBeGreaterThan(0);
      /* 具名改坏: 清筛选仍带旧 `goalRef`；D13 的 `goalRef` 红。 */
      expect((reread.at(-1)!.input as { goalRef?: unknown }).goalRef).toBeUndefined();
      expect(sectionRows(page.root, '请知悉')).toHaveLength(3);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('D16 下一条 walks the list and wraps to the first card without a read', async () => {
    const world = await worldW2();
    const { page, log } = await bootDecide(worldTarget(world.world));
    try {
      await opened(log);
      const rows = sectionRows(page.root, '要决定');
      const total = rows.length;
      /* W2: two request candidates and the independent one, each Goal's two missing pointers and its pending initial Plan. */
      expect(total).toBe(9);
      click(rows[0]!);
      await settle(() => card(page.root) !== undefined, 2_000);
      const before = await quiet(log);
      const seen = [cardPos(page.root)];
      for (let step = 0; step < total; step += 1) {
        const next = labelled(card(page.root), '下一条');
        expect(next).toBeDefined();
        const prior = cardPos(page.root);
        click(next!);
        await settle(() => cardPos(page.root) !== prior, 500);
        seen.push(cardPos(page.root));
      }
      expect(seen).toEqual([...Array.from({ length: total }, (_, index) => `${index + 1} / ${total}`), `1 / ${total}`]);
      /* 具名改坏: “下一条”重读路由；D16 的零请求红。 */
      expect(await quiet(log)).toBe(before);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('D17 稍后处理 closes the card and keeps the item in the queue', async () => {
    const world = await worldW2();
    const { page, log } = await bootDecide(worldTarget(world.world));
    try {
      await opened(log);
      /* The rows are the Host's: the page read the queue. */
      expect(count(log, 'decisions/queue')).toBeGreaterThan(0);
      const before = sectionRows(page.root, '要决定').length;
      expect(before).toBeGreaterThan(0);
      click(sectionRows(page.root, '要决定')[0]!);
      await settle(() => card(page.root) !== undefined, 2_000);
      const later = labelled(card(page.root), '稍后处理');
      expect(later).toBeDefined();
      click(later!);
      await settle(() => card(page.root) === undefined, 500);
      /* 具名改坏: 关闭时把项从列表删掉；D17 的行数红。 */
      expect(card(page.root)).toBeUndefined();
      expect(sectionRows(page.root, '要决定')).toHaveLength(before);
      click(sectionRows(page.root, '要决定')[0]!);
      await settle(() => card(page.root) !== undefined, 2_000);
      expect(card(page.root)).toBeDefined();
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('D11 返回工作台 keeps the current Goal', async () => {
    const world = await worldW0();
    const { page, log } = await bootDecide(worldTarget(world.world), { search: '?goal=ag2b-goal' });
    try {
      await opened(log);
      const back = findElement(page.root, (element) => element.tagName.toLowerCase() === 'a'
        && textOf(element) === '返回工作台');
      expect(back).toBeDefined();
      const url = new URL(back!.getAttribute('href') ?? '', 'http://host/workbench/Decide.dc.html');
      expect(url.pathname).toBe('/workbench/Main.dc.html');
      /* 具名改坏: 链接去掉 `?goal=`；D11 的 goal 断言红。 */
      expect(url.searchParams.get('goal')).toBe('ag2b-goal');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('D45 the secretary row is a link back to the main conversation', async () => {
    const world = await worldW0();
    const { page, log } = await bootDecide(worldTarget(world.world));
    try {
      await opened(log);
      /* The rail is the Host's: the page read `lines/list`. */
      expect(count(log, 'lines/list')).toBeGreaterThan(0);
      const holder = lineRows(page.root)[0];
      expect(holder).toBeDefined();
      const control = lineControl(holder!);
      /* 具名改坏: 秘书行改成 `button`；D45 的 `tagName` 红。 */
      expect(control?.tagName.toLowerCase()).toBe('a');
      expect(new URL(control!.getAttribute('href') ?? '', 'http://host/workbench/Decide.dc.html').pathname)
        .toBe('/workbench/Main.dc.html');
      hover(control!);
      await settle(() => descendants(holder!).some((element) => element.getAttribute('role') === 'tooltip'), 1_500);
      const tip = descendants(holder!).find((element) => element.getAttribute('role') === 'tooltip');
      expect(`${control!.getAttribute('title') ?? ''} ${textOf(tip)}`).toContain('点一下回到主对话');
    } finally {
      await page.restore();
    }
  }, 60_000);
});
