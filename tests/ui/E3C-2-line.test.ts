import { afterEach, describe, expect, it } from 'vitest';
import { asRecord } from '../../src/ui/values.js';
import { openS7C1World } from '../helpers/S7C-member-fixture.js';
import { findClass } from './helpers/boot-page.js';
import { bootChain, dlValue } from './helpers/E3C-world.js';
import { callsOf, memberSearch, press, railRowOf, settle, worldSlot } from './helpers/E3M-world.js';
import { hover } from './helpers/E3N-interact.js';
import { textOf } from './helpers/E3N-page.js';
import type { FakeElement } from './helpers/dom.js';

/**
 * E3C-2 (test sheet §2.1, E3C-04/05/06/08; wiring R4–R7, DC3/DC4): the rail's
 * line rows of the Chain page — a click switches the execution chain to
 * that line, the hover card comes from the list read alone, and without
 * `?line*` the centre opens the Goal's first executor line.
 */

const slot = worldSlot();
afterEach(async () => { await slot.close(); }, 180_000);
const world = (key: string, firstRun: 'ended' | 'held') =>
  slot.use(key, () => openS7C1World({ backend: 'memory', firstRun }), (opened) => opened.close());

const mainText = (root: FakeElement): string => textOf(findClass(root, 'main'));
const railCard = (root: FakeElement): FakeElement | undefined => findClass(findClass(root, 'rail') ?? root, 'hcard');

describe('E3C-2 the Chain line rows', () => {
  it('E3C-04 a click on the work line reads its executions with the full line key and shows its empty chain (R6/DC4)', async () => {
    const s7c = await world('E3C-04', 'ended');
    const { page, log } = await bootChain(s7c.world, memberSearch('s7c-goal', s7c.lines.module.ref));
    try {
      const before = log.calls.length;
      press(await railRowOf(page.root, s7c.world, s7c.lines.work.ref), 'the work line row');
      await settle(() => mainText(page.root).includes('这条线还没有执行记录'));
      const keys = callsOf(log, 'lines/page', before).map((call) => asRecord(call.input)['key']);
      /* 具名改坏: 把 key 写成只有 sessionId（丢 projectId）；lines/page 回 not_found，本行的 key 断言红。 */
      expect(keys).toContainEqual({ projectId: s7c.goal.projectId, sessionId: s7c.lines.work.ref.sessionId });
      expect(mainText(page.root)).toContain('这条线还没有执行记录');
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('E3C-05 hovering the module line shows its card with 负责 and sends nothing (R5/R7)', async () => {
    const s7c = await world('E3C-05', 'held');
    const { page, log } = await bootChain(s7c.world, memberSearch('s7c-goal', null));
    try {
      const row = await railRowOf(page.root, s7c.world, s7c.lines.module.ref);
      expect(row, 'the module line row').toBeDefined();
      const before = log.calls.length;
      hover(row!);
      await settle(() => railCard(page.root) !== undefined);
      expect(dlValue(railCard(page.root), '负责') ?? '').toContain('Independent work s7c-m1');
      /* 具名改坏: 悬停时读 lines/read 或 notes/list；本行的“不发请求”红。 */
      expect(log.calls.length).toBe(before);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('E3C-06 the module line card’s 最近一步 is the line’s last activity time, not — (R5)', async () => {
    const s7c = await world('E3C-06', 'held');
    const { page } = await bootChain(s7c.world, memberSearch('s7c-goal', null));
    try {
      const row = await railRowOf(page.root, s7c.world, s7c.lines.module.ref);
      expect(row, 'the module line row').toBeDefined();
      hover(row!);
      await settle(() => railCard(page.root) !== undefined);
      /* Hand count (reply §1): the world's clock is set to S6A_AT 09:00:00.000Z and
         `createGoal` advances it once by 1 s (S6A-cards-fixture.ts:233) before any
         line exists, so every line's lastActivityAt is 09:00:01.000Z.
         具名改坏: 卡里的最近一步写死 `—`；本行的字面断言红。 */
      expect(dlValue(railCard(page.root), '最近一步') ?? '').toContain('2026-10-23T09:00:01.000Z');
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('E3C-08 without ?line* the centre opens the Goal’s first executor line, the module line (DC3)', async () => {
    const s7c = await world('E3C-08', 'ended');
    const { page, log } = await bootChain(s7c.world, memberSearch('s7c-goal', null));
    try {
      const keys = callsOf(log, 'lines/read').map((call) => asRecord(call.input)['key']);
      /* 具名改坏: 默认取 lines[0]（合成行/秘书线）；本行的 module 线断言红。 */
      expect(keys).toContainEqual(s7c.lines.module.ref);
      expect(textOf(findClass(findClass(page.root, 'main') ?? page.root, 'head-title'))).toContain('Independent work s7c-m1');
    } finally {
      await page.restore();
    }
  }, 120_000);
});
