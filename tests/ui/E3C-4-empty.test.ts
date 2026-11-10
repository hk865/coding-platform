import { afterEach, describe, expect, it } from 'vitest';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { openS6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { openS7C1World } from '../helpers/S7C-member-fixture.js';
import { bootChain } from './helpers/E3C-world.js';
import { memberSearch, worldSlot } from './helpers/E3M-world.js';
import { textOf } from './helpers/E3N-page.js';

/**
 * E3C-4 (test sheet §2.1, E3C-09; DC4): the three empty states of the Chain
 * page, each on its own world: no Goal, a Goal without lines, a line
 * without a Run. With a Host the prototype's sample story never shows.
 */

const slot = worldSlot();
afterEach(async () => { await slot.close(); }, 180_000);

/** The prototype's own task (its head and rail); a page reading a Host never shows it. */
const SAMPLE = '重新入队与失败类别';

describe('E3C-4 the empty states', () => {
  it.each([
    { entry: '① 没有目标', literal: '还没有目标' },
    { entry: '② 目标下没有线', literal: '这个目标还没有工作线' },
    { entry: '③ 线下没有 Run', literal: '这条线还没有执行记录' },
  ])('E3C-09 $entry says $literal (DC4)', async ({ entry, literal }) => {
    let target: { readonly base: string; readonly token: string };
    let search: string;
    if (entry.startsWith('①')) {
      target = await slot.use(entry, () => openS6AHostWorld({ backend: 'memory', defaultGoals: false }), (world) => world.close());
      search = '';
    } else {
      const s7c = await slot.use(entry, () => openS7C1World({ backend: 'memory', firstRun: 'ended' }), (world) => world.close());
      target = s7c.world;
      if (entry.startsWith('②')) {
        await s6aCardsWorkspace(s7c.world, S6A_SCOPE).createGoal('e3c-empty', 'E3C empty goal');
        search = memberSearch('e3c-empty', null);
      } else {
        search = memberSearch('s7c-goal', s7c.lines.work.ref);
      }
    }
    const { page } = await bootChain(target, search);
    try {
      const text = textOf(page.root);
      expect(text).toContain(literal);
      /* 具名改坏: 无数据时落回样例故事；本行的“样例文字不出现”红（三个条目各自单独失败）。 */
      expect(text).not.toContain(SAMPLE);
    } finally {
      await page.restore();
    }
  }, 120_000);
});
