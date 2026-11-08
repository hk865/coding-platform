import { afterEach, describe, expect, it } from 'vitest';
import {
  bootE3N, countRoute, descendants, hasClass, textOf, turns, type PageLog,
} from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { findButton, findClass, findElement, type BootedPage } from './helpers/boot-page.js';
import type { FakeElement } from './helpers/dom.js';
import { E3G_OVERLAP, e3gCardPins, e3gGoalPins, e3gSettled, openE3GW0, openE3GW1, openE3GW2, type E3GWorld } from './helpers/E3G-world.js';

/**
 * E3G-2 G10–G19 (test sheet §2.2): the conflict card, its three options and the
 * `decisions/answer` pins. W1 is the two-Goal world whose adopted Plans list
 * the same two paths; W2 completes the earlier Plan once. Every expected pin is
 * either the literal from the sheet or a revision `goals/list` returned.
 */

const worlds: E3GWorld[] = [];
afterEach(async () => {
  for (const opened of worlds.splice(0)) await opened.world.close();
});

function sectionOf(root: FakeElement): FakeElement | undefined {
  return descendants(root).find((element) => hasClass(element, 'gx-sec')
    && element.getAttribute('aria-label') === '冲突');
}

function optionsOf(root: FakeElement): FakeElement[] {
  const section = sectionOf(root);
  return section === undefined ? [] : descendants(section)
    .filter((element) => element.tagName.toLowerCase() === 'button' && hasClass(element, 'opt-top'));
}

function factsOf(root: FakeElement): Array<{ key: string; value: string }> {
  const facts = findClass(root, 'dc-facts');
  if (facts === undefined) return [];
  const pairs: Array<{ key: string; value: string }> = [];
  for (const child of descendants(facts)) {
    const tag = child.tagName.toLowerCase();
    if (tag === 'dt') pairs.push({ key: textOf(child), value: '' });
    else if (tag === 'dd' && pairs.length > 0) pairs[pairs.length - 1]!.value = textOf(child);
  }
  return pairs;
}

function answers(log: PageLog): number {
  return countRoute(log, 'decisions/answer');
}

/** A pin set's meaning does not depend on its array order. */
function pinSetOf(pins: unknown[]): string[] {
  return pins.map((pin) => JSON.stringify(pin)).sort();
}

async function openConflict(opened: E3GWorld, options: { card: boolean }): Promise<{ page: BootedPage; log: PageLog }> {
  const booted = await bootE3N(opened.world, 'Goals');
  /* T1: the baseline is after the first read and the stream-open reread. */
  await e3gSettled(booted.log, options.card);
  if (options.card) {
    await turns(() => findClass(booted.page.root, 'plan') !== undefined, 800);
  }
  return booted;
}

/** T2's public proof that `decisions/answer` was `committed`: its own receipt. */
function answerState(log: PageLog): string | undefined {
  const reply = log.answers.at(-1) as { value?: { answer?: { status?: string }; state?: string } } | undefined;
  return reply?.value?.answer?.status ?? reply?.value?.state;
}

async function decide(page: BootedPage, option: number): Promise<void> {
  const options = optionsOf(page.root);
  expect(options.length).toBe(3);
  click(options[option]!);
  await turns(() => hasClass(options[option]!, 'is-on') || options[option]!.getAttribute('aria-checked') === 'true', 800);
  const go = findButton(page.root, '确定');
  expect(go).toBeDefined();
  click(go!);
}

describe('E3G-2 the conflict card', () => {
  it('G10 the card names both Goals and their two overlapping files', async () => {
    const opened = await openE3GW1();
    worlds.push(opened);
    const { page } = await openConflict(opened, { card: true });
    try {
      const section = sectionOf(page.root);
      expect(section).toBeDefined();
      const card = findElement(section!, (element) => element.tagName.toLowerCase() === 'section'
        && hasClass(element, 'plan'));
      expect(card).toBeDefined();
      /* 具名改坏: 适配器把 `objects` 丢掉、用 `plannedFiles` 自己求交并漏掉一个文件；G10 的文件名红。 */
      expect(textOf(findClass(section!, 'ttl'))).toBe('目标 2 与目标 1 冲突');
      const refs = descendants(section!).filter((element) => element.tagName.toLowerCase() === 'button'
        && hasClass(element, 'ref')).map((element) => textOf(element));
      expect(refs).toEqual(expect.arrayContaining([...E3G_OVERLAP]));
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('G11 the details show the overlapping files and the null detection time as —', async () => {
    const opened = await openE3GW1();
    worlds.push(opened);
    const { page } = await openConflict(opened, { card: true });
    try {
      const more = findClass(page.root, 'dc-more');
      expect(more).toBeDefined();
      click(more!);
      await turns(() => findClass(page.root, 'dc-facts') !== undefined, 800);
      const facts = factsOf(page.root);
      /* 具名改坏: 把 `openedAt` 的 `null` 显示成 `new Date().toISOString()`；G11 的 `—` 等值红。 */
      expect(facts.map((fact) => fact.key)).toEqual(expect.arrayContaining(['重叠的文件', '检测时间', '其他目标']));
      expect(facts.find((fact) => fact.key === '检测时间')!.value).toBe('—');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('G12 the three options start unselected and selecting one writes nothing', async () => {
    const opened = await openE3GW1();
    worlds.push(opened);
    const { page, log } = await openConflict(opened, { card: true });
    try {
      const options = optionsOf(page.root);
      expect(options).toHaveLength(3);
      /* 具名改坏: 给第一个选项默认 `aria-checked="true"`；G12 的“都是 false”红。 */
      expect(options.map((option) => option.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false']);
      expect(options.map((option) => option.getAttribute('role'))).toEqual(['radio', 'radio', 'radio']);
      expect(countRoute(log, 'goals/conflicts')).toBe(2);
      click(options[0]!);
      await turns(() => options[0]!.getAttribute('aria-checked') === 'true', 800);
      expect(descendants(sectionOf(page.root)!).filter((element) => hasClass(element, 'opt-body'))).not.toHaveLength(0);
      expect(answers(log)).toBe(0);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('G13 wait submits the card\'s exact pins and commits', async () => {
    const opened = await openE3GW1();
    worlds.push(opened);
    const pins = await e3gCardPins(opened.world);
    const { page, log } = await openConflict(opened, { card: true });
    try {
      /* 具名改坏: `answerConflict` 的 `wait` 少发 Plan/GoalPhase 项；Host 回 `invalid`，G13 的
         `committed` 和项数红。 */
      await decide(page, 0);
      await turns(() => log.answers.length === 1, 800);
      const call = log.calls.filter((entry) => entry.route === 'decisions/answer')[0]!;
      const body = (call.body as { request: { input: Record<string, unknown>; meta: { expected: unknown[] } } }).request;
      expect(body.input['selection']).toEqual({
        kind: 'conflict_wait', earlier: opened.world.goals.first, later: opened.world.goals.second,
      });
      /* T2: the expected set is the card's own `source.pins`, not a hand-written list. */
      expect(pinSetOf(body.meta.expected)).toEqual(pinSetOf(pins));
      expect(answerState(log)).toBe('committed');
      /* Let the receipt's and the application's rereads finish before the page closes. */
      await turns(() => countRoute(log, 'bootstrap') === 4
        && countRoute(log, 'architecture/read') === 4, 3_000);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('G14 order sends the full Goal order and the card\'s exact pins', async () => {
    const opened = await openE3GW1();
    worlds.push(opened);
    const pins = await e3gCardPins(opened.world);
    const { page, log } = await openConflict(opened, { card: true });
    try {
      /* 具名改坏: `answerConflict` 丢掉卡上的 Plan 项、只回两个 Goal；Host 回 `invalid`，G14 红。 */
      await decide(page, 1);
      await turns(() => log.answers.length === 1, 800);
      const body = (log.calls.filter((entry) => entry.route === 'decisions/answer')[0]!
        .body as { request: { input: Record<string, unknown>; meta: { expected: unknown[] } } }).request;
      expect(body.input['selection']).toEqual({
        kind: 'conflict_order', goalOrder: [opened.world.goals.second, opened.world.goals.first],
      });
      expect(pinSetOf(body.meta.expected)).toEqual(pinSetOf(pins));
      expect(answerState(log)).toBe('committed');
      /* Let the receipt's and the application's rereads finish before the page closes. */
      await turns(() => countRoute(log, 'bootstrap') === 4
        && countRoute(log, 'architecture/read') === 4, 3_000);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('G15 parallel sends its own selection and the card records the accepted risk', async () => {
    const opened = await openE3GW1();
    worlds.push(opened);
    const pins = await e3gCardPins(opened.world);
    const { page, log } = await openConflict(opened, { card: true });
    try {
      /* 具名改坏: 把 `parallel` 也发成 `conflict_wait`；G15 的 `selection.kind` 红。 */
      await decide(page, 2);
      await turns(() => log.answers.length === 1, 800);
      const body = (log.calls.filter((entry) => entry.route === 'decisions/answer')[0]!
        .body as { request: { input: Record<string, unknown>; meta: { expected: unknown[] } } }).request;
      expect(body.input['selection']).toEqual({
        kind: 'conflict_parallel', earlier: opened.world.goals.first, later: opened.world.goals.second,
      });
      expect(pinSetOf(body.meta.expected)).toEqual(pinSetOf(pins));
      expect(answerState(log)).toBe('committed');
      await turns(() => textOf(sectionOf(page.root)).includes('已接受并行风险'), 800);
      expect(textOf(sectionOf(page.root))).toContain('已接受并行风险');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('G16 wait on the completed old Plan pins GoalPhase revision 1', async () => {
    const opened = await openE3GW2();
    worlds.push(opened);
    const pins = await e3gCardPins(opened.world);
    const graph = (await opened.world.post('tasks/query', { scope: opened.world.scope,
      input: { goalRef: opened.world.goals.first } })).body as
      { value?: { completion?: { snapshot?: { revision?: number } } } };
    const { page, log } = await openConflict(opened, { card: true });
    try {
      expect(graph.value?.completion?.snapshot?.revision).toBe(1);
      expect(log.calls.some((entry) => entry.route === 'tasks/query'
        && (entry.input as { goalRef?: { goalId?: string } }).goalRef?.goalId === opened.world.goals.first.goalId)).toBe(true);
      /* 具名改坏: `answerConflict` 只回两个 Goal、把 GoalPhase 版本写死 0；Host 回
         `revision_conflict`，G16 的 `committed` 红。 */
      await decide(page, 0);
      await turns(() => log.answers.length === 1, 800);
      const body = (log.calls.filter((entry) => entry.route === 'decisions/answer')[0]!
        .body as { request: { meta: { expected: unknown[] } } }).request;
      expect(pinSetOf(body.meta.expected)).toEqual(pinSetOf(pins));
      expect(answerState(log)).toBe('committed');
      /* Let the receipt's and the application's rereads finish before the page closes. */
      await turns(() => countRoute(log, 'bootstrap') === 4
        && countRoute(log, 'architecture/read') === 4, 3_000);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('G17 a world without a conflict draws no card but still reads the section once', async () => {
    const opened = await openE3GW0();
    worlds.push(opened);
    const { page, log } = await openConflict(opened, { card: false });
    try {
      /* 具名改坏: 把空 `cards` 画成空卡；G17 的“没有 section.plan”红。 */
      expect(countRoute(log, 'goals/conflicts')).toBe(2);
      expect(findElement(sectionOf(page.root)!, (element) => element.tagName.toLowerCase() === 'section'
        && hasClass(element, 'plan'))).toBeUndefined();
      expect(textOf(page.root)).not.toContain('目标 1 与目标 2 冲突');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('G18 确定 is disabled until an option is picked and writes nothing', async () => {
    const opened = await openE3GW1();
    worlds.push(opened);
    const { page, log } = await openConflict(opened, { card: true });
    try {
      const go = findButton(page.root, '确定');
      expect(go).toBeDefined();
      /* 具名改坏: 去掉未选时的禁用；G18 的零请求红。 */
      expect(countRoute(log, 'goals/conflicts')).toBe(2);
      expect(hasClass(go!, 'is-off')).toBe(true);
      expect(go!.getAttribute('aria-disabled')).toBe('true');
      click(go!);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(answers(log)).toBe(0);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('G19 改主意 keeps the prototype place, is drawn off and swallows the click', async () => {
    const opened = await openE3GW1();
    worlds.push(opened);
    const { page, log } = await openConflict(opened, { card: true });
    try {
      await decide(page, 0);
      await turns(() => log.answers.length === 1, 800);
      /* T4: the count baseline is after the answer's reread, as in T1. The answer
         commits its receipt and its application, so two notices arrive; the last
         read is `architecture/read`. */
      await turns(() => countRoute(log, 'bootstrap') === 4
        && countRoute(log, 'goals/conflicts') === 4
        && countRoute(log, 'architecture/read') === 4, 3_000);
      const again = findButton(page.root, '改主意')!;
      /* 具名改坏: 只写 `title` 不写 `is-off`；G19 的 `is-off` 红。 */
      expect(hasClass(again, 'is-off')).toBe(true);
      expect(again.getAttribute('title')).toBe('还没接通');
      expect(again.getAttribute('aria-disabled')).toBe('true');
      const before = log.calls.length;
      const text = textOf(page.root);
      click(again);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(log.calls.length).toBe(before);
      expect(textOf(page.root)).toBe(text);
    } finally {
      await page.restore();
    }
  }, 60_000);
});
