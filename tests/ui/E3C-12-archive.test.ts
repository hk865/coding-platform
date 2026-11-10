import { afterEach, describe, expect, it } from 'vitest';
import { asRecord } from '../../src/ui/values.js';
import { findClass } from './helpers/boot-page.js';
import { bootChain } from './helpers/E3C-world.js';
import { callsOf, elementsOf, memberSearch, press, settle, worldSlot } from './helpers/E3M-world.js';
import { openW2 } from './helpers/E3N-world.js';
import { countRoute, hasClass, textOf } from './helpers/E3N-page.js';
import type { FakeElement } from './helpers/dom.js';

/**
 * E3C-12 (test sheet §2.4, E3C-25; wiring R8): the 已归档 row opens the
 * archived lines with one first-page `lines/archived` read and closes them
 * without another, on E3N's W2 world (one archived executor line).
 */

const slot = worldSlot();
afterEach(async () => { await slot.close(); }, 180_000);

const archiveToggle = (root: FakeElement): FakeElement | undefined =>
  elementsOf(findClass(root, 'rail'), 'button').find((element) => element.getAttribute('aria-expanded') !== null);
const archivedRows = (root: FakeElement): FakeElement[] =>
  elementsOf(findClass(root, 'rail'), 'button').filter((element) => hasClass(element, 'is-arch'));

describe('E3C-12 the archived lines', () => {
  it.each([
    { entry: '① 点“已归档”展开' },
    { entry: '② 点收起' },
  ])('E3C-25 $entry (R8)', async ({ entry }) => {
    const w2 = await slot.use(entry, () => openW2(), (opened) => opened.world.close());
    const { page, log } = await bootChain(w2.world, memberSearch('ag2b-goal', null));
    try {
      expect(countRoute(log, 'lines/archived')).toBe(0);
      press(archiveToggle(page.root), '已归档');
      await settle(() => countRoute(log, 'lines/archived') > 0 && archivedRows(page.root).length > 0);
      if (entry.startsWith('①')) {
        const calls = callsOf(log, 'lines/archived');
        /* 具名改坏: 展开时读 2 次 lines/archived；本条目红。 */
        expect(calls).toHaveLength(1);
        expect(asRecord(calls[0]!.input)['page']).toEqual({ limit: 100 });
        expect(archivedRows(page.root).length).toBeGreaterThan(0);
        /* `withoutArchivedAt` is 0 in W2, so the 没有归档时间 line is absent. */
        expect(textOf(page.root)).not.toContain('没有归档时间');
        return;
      }
      /* The precondition: one expansion, one read. */
      expect(countRoute(log, 'lines/archived')).toBe(1);
      press(archiveToggle(page.root), '收起');
      await settle(() => archivedRows(page.root).length === 0);
      /* 具名改坏: 收起后仍显示归档行；本条目红。 */
      expect(archivedRows(page.root)).toHaveLength(0);
      expect(countRoute(log, 'lines/archived')).toBe(1);
    } finally {
      await page.restore();
    }
  }, 120_000);
});
