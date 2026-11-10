import { afterEach, describe, expect, it } from 'vitest';
import { asRecord, asText } from '../../src/ui/values.js';
import { openS7C1World } from '../helpers/S7C-member-fixture.js';
import { findClass } from './helpers/boot-page.js';
import { bootChain, goalRowLabel, goalSectionRows, inboxCounts } from './helpers/E3C-world.js';
import { callsOf, memberSearch, worldSlot } from './helpers/E3M-world.js';
import { hasClass, textOf } from './helpers/E3N-page.js';
import type { FakeElement } from './helpers/dom.js';

/**
 * E3C-1 (test sheet §2.1, E3C-01..03; wiring R1–R3): the Chain rail's inbox
 * rows and the selected Goal row, on the S7C world through the real Host.
 * The change stream is held, so every count is the page's own first read.
 * One world per case (§1.1), closed after it.
 */

const slot = worldSlot();
afterEach(async () => { await slot.close(); }, 180_000);
const ended = (key: string) => slot.use(key, () => openS7C1World({ backend: 'memory', firstRun: 'ended' }), (world) => world.close());

/** The selected Goal's row: the prototype lights it (`is-on`); otherwise the row of the S7C Goal. */
const selectedGoalRow = (root: FakeElement): FakeElement | undefined => {
  const rows = goalSectionRows(root);
  return rows.find((row) => hasClass(row, 'is-on')) ?? rows.find((row) => textOf(row).includes('S7C member world'));
};

describe('E3C-1 the Chain rail', () => {
  it('E3C-01 the 需要你决定 row counts the world’s 0 waiting cards (R1/R2)', async () => {
    const s7c = await ended('E3C-01');
    const { page } = await bootChain(s7c.world, memberSearch(s7c.goal.goalId, null));
    try {
      const counts = inboxCounts(page.root);
      expect(counts).toHaveLength(2);
      /* openS7C1World opens no decision card (decisions/queue waitingAnswer 0).
         具名改坏: 让“需要你决定”的计数写死成 1；本行的 `0` 红。
         请知悉 is not asserted: the sheet's 0 does not hold in this world (reply §1). */
      expect(counts[0]).toBe('0');
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('E3C-02 the selected Goal row reads 目标 3 · S7C member world (R3)', async () => {
    const s7c = await ended('E3C-02');
    const { page } = await bootChain(s7c.world, memberSearch('s7c-goal', null));
    try {
      /* goals/list: the S6A world's two Goals come first, so the S7C Goal's
         ordinal is 3. 具名改坏: 目标行取 goals[0] 或列表位置而不是 order/ordinal；本行的 `目标 3` 红。 */
      expect(goalRowLabel(selectedGoalRow(page.root))).toBe('目标 3 · S7C member world');
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('E3C-03 the Goal row’s count comes from a decisions/queue read with this goalRef (R3)', async () => {
    const s7c = await ended('E3C-03');
    const { page, log } = await bootChain(s7c.world, memberSearch('s7c-goal', null));
    try {
      const goals = callsOf(log, 'decisions/queue').map((call) => asText(asRecord(asRecord(call.input)['goalRef'])['goalId']));
      /* 具名改坏: 删掉带 goalRef 的 queue，只留工作区总账；本行的 input 断言红。 */
      expect(goals).toContain('s7c-goal');
      const row = selectedGoalRow(page.root);
      expect(row, 'the S7C Goal row').toBeDefined();
      /* The Goal's own queue has waitingAnswer 0; a 0 count may be drawn as 0 or left out. */
      expect(['', '0']).toContain(textOf(findClass(row!, 'row-meta')));
    } finally {
      await page.restore();
    }
  }, 120_000);
});
