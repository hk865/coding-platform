import { afterEach, describe, expect, it, vi } from 'vitest';
import { blockOf, fieldIn, typeField } from './helpers/E3ST-settings.js';
import { findAllClass, findButton, findClass, findElement } from './helpers/boot-page.js';
import {
  bootE3N, callsTo, countRoute, settledN, textOf, waitFor,
} from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import {
  openS7D1AllocationWorld, setS7D1Limits, type S7D1AllocationWorld,
} from '../helpers/S7D1-allocation-world.js';
import type { FakeElement } from './helpers/dom.js';

/**
 * Settings page, the role-line limits block (7D2 batch 2, ⑧): the four default
 * rows with “现在” counting holders, the local refusal, one cell saved, and the
 * conflict reread that keeps the person's own edits and drops the stale ones.
 */

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S7D1AllocationWorld[] = [];

afterEach(async () => {
  expect(commitBarrier.reset()).toEqual([]);
  await Promise.allSettled(worlds.splice(0).map((world) => world.close()));
});

const DUTIES = [
  { duty: 'secretary', name: '秘书', running: '4', open: '8', now: '2 条' },
  { duty: 'adviser', name: '参谋', running: '4', open: '8', now: '0 条' },
  { duty: 'scribe', name: '书记', running: '2', open: '4', now: '0 条' },
  { duty: 'executor', name: '执行者', running: '8', open: '16', now: '0 条' },
];

function limitsBlock(root: FakeElement): FakeElement {
  const found = blockOf(root, '工作线上限');
  expect(found).toBeDefined();
  return found!;
}

/** The two value cells of one duty in the planned `.lim` grid, 同时运行 then 保留. */
function dutyCells(root: FakeElement, duty: string): FakeElement[] {
  const grid = findClass(limitsBlock(root), 'lim');
  expect(grid, 'the .lim grid').toBeDefined();
  const cells = findAllClass(grid!, 'lim-v').filter((cell) => cell.getAttribute('data-duty') === duty);
  expect(cells, duty).toHaveLength(2);
  return cells;
}

/** The “现在” cell of one duty in the planned `.lim` grid. */
function dutyNow(root: FakeElement, duty: string): FakeElement {
  const grid = findClass(limitsBlock(root), 'lim');
  expect(grid, 'the .lim grid').toBeDefined();
  const found = findAllClass(grid!, 'lim-now').find((cell) => cell.getAttribute('data-duty') === duty);
  expect(found, duty).toBeDefined();
  return found!;
}

describe('settings role-line limits (7D2 batch 2)', () => {
  it('⑧ shows the defaults and “现在”, refuses 0, saves one cell and survives a conflict reread', async () => {
    const world = await openS7D1AllocationWorld({ backend: 'memory' });
    worlds.push(world);
    for (const label of ['st-sec-1', 'st-sec-2']) {
      const created = await world.createLine({ label });
      expect(created.answer.body).toMatchObject({ status: 'completed' });
    }

    const page = await bootE3N(world.world, 'Settings', { gate: true });
    /* The external fixture write below also runs through this page's fetch hook;
       the page's own writes are the ones without its command id. */
    const pageSets = () => callsTo(page.log, 'projects/role-limits/set')
      .filter((call) => (call.input as { commandId?: string } | undefined)?.commandId !== 'st-outside');
    try {
      await waitFor(() => blockOf(page.page.root, '工作线上限') !== undefined);
      const limitsRead = callsTo(page.log, 'projects/role-limits')[0];
      expect((limitsRead?.input as { projectRef: { projectId: string } }).projectRef.projectId)
        .toBe(S6A_SCOPE.projectId);

      for (const entry of DUTIES) {
        const cells = dutyCells(page.page.root, entry.duty);
        /* The view mode follows the draft: a cell only marks its default when
           its value differs from it, and every row starts at its default. */
        expect(textOf(cells[0])).toBe(entry.running);
        expect(textOf(cells[1])).toBe(entry.open);
        expect(findAllClass(cells[0]!, 'lim-d')).toHaveLength(0);
        expect(findAllClass(cells[1]!, 'lim-d')).toHaveLength(0);
        expect(textOf(dutyNow(page.page.root, entry.duty))).toBe(entry.now);
      }
      expect(findAllClass(limitsBlock(page.page.root), 'lim-d')).toHaveLength(0);

      const limits = () => limitsBlock(page.page.root);
      const review = () => {
        const found = blockOf(page.page.root, '命令审查线');
        expect(found).toBeDefined();
        return found!;
      };
      const reviewSaved = () => textOf(findClass(review(), 'saved'));
      const reviewErr = () => textOf(findClass(review(), 'err'));
      const reviewInput = () => fieldIn(review(), '命令审查线')!;

      /* Item 1: the work line and the command review line no longer share state keys. */
      expect(reviewErr()).toBe('');
      expect(reviewInput().getAttribute('class') ?? '').not.toContain('is-bad');
      click(findButton(limits(), '改')!);
      await waitFor(() => fieldIn(limits(), '执行者保留') !== undefined);
      /* The edit mode writes “默认 n” on every cell. */
      for (const entry of DUTIES) {
        const cells = dutyCells(page.page.root, entry.duty);
        expect(textOf(findClass(cells[0]!, 'lim-d'))).toBe('默认 ' + entry.running);
        expect(textOf(findClass(cells[1]!, 'lim-d'))).toBe('默认 ' + entry.open);
      }
      expect(reviewErr()).toBe('');
      expect(reviewInput().getAttribute('class') ?? '').not.toContain('is-bad');
      expect(reviewSaved()).toBe('');

      typeField(fieldIn(limits(), '执行者保留')!, '0');
      click(findButton(limits(), '保存')!);
      expect(countRoute(page.log, 'projects/role-limits/set')).toBe(0);
      expect(textOf(findClass(limits(), 'err'))).toBe('每一格要 1 或更大的整数');
      expect(reviewErr()).toBe('');
      expect(reviewInput().getAttribute('class') ?? '').not.toContain('is-bad');

      typeField(fieldIn(limits(), '执行者保留')!, '20');
      click(findButton(limits(), '保存')!);
      await settledN(page.log, 'projects/role-limits/set', 1);
      expect(pageSets()).toHaveLength(1);
      const first = pageSets()[0]!.input as Record<string, unknown>;
      expect(first['commandId']).toEqual(expect.any(String));
      expect(first['expectedRevision']).toBe(0);
      expect(first['open']).toEqual({ executor: 20 });
      expect(first).not.toHaveProperty('running');

      await waitFor(() => {
        const cell = textOf(dutyCells(page.page.root, 'executor')[1]!);
        return cell.includes('20') && cell.includes('默认 16');
      });
      expect(textOf(dutyCells(page.page.root, 'executor')[1]!)).toContain('20');
      expect(findAllClass(limitsBlock(page.page.root), 'lim-d')).toHaveLength(1);
      expect(textOf(findClass(dutyCells(page.page.root, 'executor')[1]!, 'lim-d'))).toBe('默认 16');
      expect(textOf(findClass(limits(), 'rlim-saved'))).toContain('改了 1 格');
      /* Item 1: the work line's “已保存” must not appear in the command review line. */
      expect(reviewSaved()).toBe('');
      /* Item 11: after a save the focus returns to the newly shown 改. */
      await waitFor(() => (document.activeElement as unknown as FakeElement | null)
        === findButton(limits(), '改'));

      const savedBeforeEdit = reviewSaved();
      const errBeforeEdit = reviewErr();
      click(findButton(limits(), '改')!);
      await waitFor(() => fieldIn(limits(), '秘书同时运行') !== undefined);
      /* Item 1: opening the editor leaves the review line's saved/err text alone. */
      expect(reviewSaved()).toBe(savedBeforeEdit);
      expect(reviewErr()).toBe(errBeforeEdit);

      const outside = await setS7D1Limits(world.world, { open: { secretary: 6 } }, 1, 'st-outside');
      expect((outside.body as { status?: string }).status, JSON.stringify(outside.body)).toBe('committed');

      typeField(fieldIn(limitsBlock(page.page.root), '秘书同时运行')!, '3');
      click(findButton(limitsBlock(page.page.root), '保存')!);
      await settledN(page.log, 'projects/role-limits/set', 3);
      await waitFor(() => textOf(findClass(limitsBlock(page.page.root), 'err'))
        .includes('工作线上限刚被别处改过，已经重读，请再改一次。'));
      await waitFor(() => fieldIn(limitsBlock(page.page.root), '秘书保留')!.value === '6');
      expect(fieldIn(limitsBlock(page.page.root), '秘书同时运行')!.value).toBe('3');

      click(findButton(limitsBlock(page.page.root), '保存')!);
      await settledN(page.log, 'projects/role-limits/set', 4);
      expect(pageSets()).toHaveLength(3);
      const third = pageSets()[2]!.input as Record<string, unknown>;
      expect(third['commandId']).toEqual(expect.any(String));
      expect(third['expectedRevision']).toBe(2);
      expect(third['running']).toEqual({ secretary: 3 });
      expect(third).not.toHaveProperty('open');
      /* Run sheet ⑧: this same row is the click test for the two blocks' state keys. */
    } finally {
      await page.page.restore();
    }
  }, 240_000);
});
