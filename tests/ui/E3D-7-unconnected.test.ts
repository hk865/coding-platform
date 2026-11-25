import { afterAll, describe, expect, it } from 'vitest';
import { findClass, findElement } from './helpers/boot-page.js';
import type { FakeElement } from './helpers/dom.js';
import { auxPanel, auxTab, descendants, goalRows, hasClass, textOf } from './helpers/E3N-page.js';
import { click, notConnected } from './helpers/E3N-interact.js';
import { openE3GW0, openE3GW1, type E3GWorld } from './helpers/E3G-world.js';
import {
  bootDecide, callsOf, card, cardButton, cardFacts, count, countPrefix, opened, quiet, sectionRows, settle, worldTarget,
} from './helpers/E3D-page.js';
import { seePlanAdoptions } from './helpers/E3D-world.js';
import { openS6ANoticesWorld, type S6ANoticesWorld } from '../helpers/S6A-cards-fixture.js';
import { governS6B } from '../helpers/S6B1-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import type { DecisionCardV1 } from '../../src/core/work-graph/model/decision-contracts.js';

/**
 * E3D-7 N01–N06 (test sheet §2.5): 标为已读 on a Goal-filtered page keeps the
 * prototype place, is drawn off, says so and swallows the click (R5, the E3N
 * `notConnected` four); the conflict card's path and 在架构图里看 read the right
 * panel's route; the empty queue reads only the shown Goal's graph and no
 * material; a card with no Task has no failure facts; an answered card has no
 * apply button. W0 with its
 * project's governance (`governS6B`) is the world without a card; W0 without it
 * keeps the four missing-pointer cards, which name no Task.
 */

let w1: E3GWorld | null = null;
let w0: E3GWorld | null = null;
let w0governed: E3GWorld | null = null;
let w2n: S6ANoticesWorld | null = null;

afterAll(async () => {
  await w1?.world.close();
  await w0?.world.close();
  await w0governed?.world.close();
  await w2n?.close();
});

async function worldW1(): Promise<E3GWorld> {
  w1 ??= await openE3GW1();
  return w1;
}

/** The control's click must change nothing: no request and the same page text. */
async function swallowed(log: Parameters<typeof quiet>[0], root: FakeElement, control: FakeElement): Promise<void> {
  const before = await quiet(log);
  const text = textOf(root);
  notConnected(control);
  expect(await quiet(log)).toBe(before);
  expect(textOf(root)).toBe(text);
}

async function openConflict(root: FakeElement): Promise<void> {
  const row = sectionRows(root, '要决定')[0];
  expect(row).toBeDefined();
  click(row!);
  await settle(() => card(root) !== undefined, 2_000);
}

describe('E3D-7 what the page does not connect', () => {
  it('N01 the conflict card path leaves the unconnected state and opens the task map', async () => {
    const world = await worldW1();
    const { page, log } = await bootDecide(worldTarget(world.world));
    try {
      await opened(log);
      await openConflict(page.root);
      await quiet(log);
      const head = findClass(card(page.root)!, 'dc-head');
      const path = head === undefined ? undefined : descendants(head).find((element) => element.tagName.toLowerCase() === 'button'
        && hasClass(element, 'ellipsis'));
      expect(path).toBeDefined();
      expect(hasClass(path!, 'is-off')).toBe(false);
      expect(path!.getAttribute('title')?.startsWith('在任务图里看目标 ')).toBe(true);
      const architecture = countPrefix(log, 'architecture/');
      /* 具名改坏: 路径照旧走 `A.notConnected`；本行红。 */
      click(path!);
      await quiet(log);
      expect(countPrefix(log, 'architecture/')).toBe(architecture);
      expect(auxTab(page.root, '任务图')?.getAttribute('aria-selected')).toBe('true');
      expect(auxTab(page.root, '架构图')?.getAttribute('aria-selected')).not.toBe('true');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('N02 在架构图里看 reads the architecture and switches the panel', async () => {
    const world = await worldW1();
    const { page, log } = await bootDecide(worldTarget(world.world));
    try {
      await opened(log);
      await openConflict(page.root);
      await quiet(log);
      const locate = cardButton(page.root, '在架构图里看');
      expect(locate).toBeDefined();
      expect(hasClass(locate!, 'is-off')).toBe(false);
      expect(locate!.getAttribute('title')?.startsWith('在架构图里点亮 ')).toBe(true);
      const architecture = countPrefix(log, 'architecture/');
      /* 具名改坏: 点“在架构图里看”只切页签、不发 `readMore`；本行多读的 1 次红。 */
      click(locate!);
      await quiet(log);
      expect(countPrefix(log, 'architecture/')).toBe(architecture + 1);
      const last = callsOf(log, 'architecture/read').at(-1);
      expect(last).toBeDefined();
      if ((last!.reply as { status?: string } | null)?.status === 'not_found') {
        const search = findElement(auxPanel(page.root) ?? page.root,
          (element) => element.tagName.toLowerCase() === 'label' && hasClass(element, 'search'));
        expect(search).toBeDefined();
        expect(textOf(findClass(search!, 'note'))).toBe('还没有采纳的架构');
      } else {
        expect((last!.input as { selection?: unknown }).selection).toEqual({ kind: 'current' });
      }
      expect(auxTab(page.root, '架构图')?.getAttribute('aria-selected')).toBe('true');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it("N03 an empty queue reads only the shown Goal's graph for the panel and no material", async () => {
    if (w0governed === null) {
      w0governed = await openE3GW0();
      await governS6B(w0governed.world, w0governed.ws, w0governed.world.goals);
      await w0governed.world.settleDetached();
    }
    const { page, log } = await bootDecide(worldTarget(w0governed.world));
    try {
      await opened(log);
      /* 具名改坏: 右栏为图读了每个目标的任务图；本行第一轮多出的 1 次红。 */
      expect(textOf(findClass(page.root, 'empty'))).toBe('现在没有需要你处理的事。处理过的在“已处理”里。');
      /* `opened` waits two reads (the first and the stream-open reread); each names the shown Goal once. */
      const graphs = callsOf(log, 'tasks/query');
      expect(graphs).toHaveLength(2);
      for (const graph of graphs) {
        expect((graph.input as { goalRef?: { goalId?: unknown } }).goalRef?.goalId)
          .toBe(w0governed.world.goals.first.goalId);
      }
      expect(count(log, 'materials/open')).toBe(0);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('N04 a card with no Task shows no failure facts and no error', async () => {
    w0 ??= await openE3GW0();
    const { page, log } = await bootDecide(worldTarget(w0.world));
    try {
      await opened(log);
      const row = sectionRows(page.root, '要决定')[0];
      expect(row).toBeDefined();
      click(row!);
      await settle(() => card(page.root) !== undefined, 2_000);
      const more = findClass(card(page.root)!, 'dc-more');
      if (more !== undefined) click(more);
      await quiet(log);
      /* 具名改坏: 把 `not_found` 画成错误横幅；N04 的“不出现”红。 */
      expect(cardFacts(page.root).map((fact) => fact.key)).not.toContain('失败类别');
      expect(textOf(page.root)).not.toContain('undefined');
      expect(textOf(page.root)).not.toContain('NaN');
      expect(textOf(page.root)).not.toContain('not_found');
      expect(findElement(page.root, (element) => element.getAttribute('role') === 'alert')).toBeUndefined();
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('N06 标为已读 on a Goal-filtered page is drawn off and writes nothing', async () => {
    if (w2n === null) {
      w2n = await openS6ANoticesWorld({ backend: 'memory' });
      await w2n.seedReworkNotices();
      await seePlanAdoptions(w2n.main, 'e3d-7-w2n');
    }
    const { page, log } = await bootDecide(worldTarget(w2n.world));
    try {
      await opened(log);
      const second = goalRows(page.root).find((row) => textOf(findClass(row, 'row-ord')) === '2');
      expect(second).toBeDefined();
      click(second!);
      await settle(() => findClass(page.root, 'dq-filter') !== undefined, 3_000);
      await quiet(log);
      const notice = sectionRows(page.root, '请知悉')[0];
      expect(notice).toBeDefined();
      click(notice!);
      await settle(() => cardButton(page.root, '标为已读') !== undefined, 2_000);
      const seen = cardButton(page.root, '标为已读');
      expect(seen).toBeDefined();
      /* 具名改坏: 筛后仍拿 queue 的过滤 token 发；N06 红。 */
      await swallowed(log, page.root, seen!);
      expect(count(log, 'decisions/notices/seen')).toBe(0);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('N05 an answered card draws no apply button and records nothing', async () => {
    const world = await worldW1();
    const read = (await world.world.post('goals/conflicts', plain(S6A_SCOPE, { workspace: S6A_SCOPE }))).body as
      { value?: { cards?: DecisionCardV1[] } };
    const conflict = read.value?.cards?.[0];
    expect(conflict).toBeDefined();
    const answered = (await world.world.post('decisions/answer', graphWrite(S6A_SCOPE, {
      source: conflict!.source,
      selection: { kind: 'conflict_wait', earlier: world.world.goals.first, later: world.world.goals.second },
      text: '', annotations: [],
    }, 'e3d-n05-answer', conflict!.source.pins))).body as { value?: { answer?: { status?: string } } };
    expect(answered.value?.answer?.status).toBe('committed');
    const { page, log } = await bootDecide(worldTarget(world.world));
    try {
      await opened(log);
      const done = findElement(page.root, (element) => element.getAttribute('role') === 'tab'
        && textOf(element).startsWith('已处理'));
      expect(done).toBeDefined();
      click(done!);
      await settle(() => sectionRows(page.root, '已处理').length > 0, 3_000);
      await quiet(log);
      const row = sectionRows(page.root, '已处理').find((entry) => textOf(entry).includes('等前一个目标'));
      expect(row).toBeDefined();
      click(row!);
      await settle(() => card(page.root) !== undefined, 2_000);
      await quiet(log);
      /* 具名改坏: 画一个 `record_application` 按钮；N05 红。 */
      const labels = descendants(card(page.root)!).filter((element) => element.tagName.toLowerCase() === 'button').map(textOf);
      expect(labels.filter((label) => label.includes('落实') || label.includes('记录'))).toEqual([]);
      expect(textOf(findClass(card(page.root)!, 'lvl'))).toBe('已处理');
      expect(count(log, 'decisions/application')).toBe(0);
    } finally {
      await page.restore();
    }
  }, 60_000);
});
