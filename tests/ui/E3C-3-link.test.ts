import { afterEach, describe, expect, it } from 'vitest';
import { openS7C1World } from '../helpers/S7C-member-fixture.js';
import { findLink } from './helpers/boot-page.js';
import { bootChain } from './helpers/E3C-world.js';
import { memberSearch, worldSlot } from './helpers/E3M-world.js';

/**
 * E3C-3 (test sheet §2.1, E3C-07; wiring L2, e3w-rulings C, R4 of §0.4): the
 * whole-line link of the selected line is a native `<a>` to Member with the
 * Goal and the line's two identity values; the row reads `href` only.
 */

const slot = worldSlot();
afterEach(async () => { await slot.close(); }, 180_000);

describe('E3C-3 the whole-line link', () => {
  it('E3C-07 整页查看 links to Member with goal, lineProject and lineSession of the module line (L2)', async () => {
    const s7c = await slot.use('E3C-07', () => openS7C1World({ backend: 'memory', firstRun: 'ended' }), (world) => world.close());
    const { page } = await bootChain(s7c.world, memberSearch('s7c-goal', null));
    try {
      const link = findLink(page.root, '整页查看');
      expect(link, '整页查看').toBeDefined();
      const url = new URL(link!.getAttribute('href') ?? '', 'http://host/workbench/Chain.dc.html');
      expect(url.pathname).toBe('/workbench/Member.dc.html');
      expect(url.searchParams.get('goal')).toBe('s7c-goal');
      expect(url.searchParams.get('lineProject')).toBe(s7c.lines.module.ref.projectId);
      /* 具名改坏: “整页查看”只带 goal（丢 lineSession）；本行的 `lineSession` 断言红。 */
      expect(url.searchParams.get('lineSession')).toBe(s7c.lines.module.ref.sessionId);
    } finally {
      await page.restore();
    }
  }, 120_000);
});
