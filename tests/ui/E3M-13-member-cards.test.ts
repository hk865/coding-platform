import { afterAll, describe, expect, it } from 'vitest';
import { adoptPLMixedPlan, PL_ADVISER_ROLE } from '../helpers/PL-consumption-fixture.js';
import { S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { askS7D2Member, openS7D2RoleLineWorld, S7D2_ADVISER_WORK } from '../helpers/S7D2-role-line-world.js';
import { findClass } from './helpers/boot-page.js';
import { dlValue } from './helpers/E3C-world.js';
import { hover, leave } from './helpers/E3N-interact.js';
import { countRoute } from './helpers/E3N-page.js';
import { bootMemberAt, memberSearch, openMemberS7C, railRowOf, settle, worldSlot } from './helpers/E3M-world.js';
import type { FakeElement } from './helpers/dom.js';

/**
 * E3M-13 (batch 8b, business rows ① and ②): the Member rail's hover card is
 * the same line card Chain shows — 负责, 正在做, the last step as a local
 * instant, 叫醒 — plus 建它的 from the one `role-lines/read` of the page read.
 * Hovering sends no request; the card only re-draws what the page already read.
 */

const slot = worldSlot();
afterAll(async () => { await slot.close(); }, 240_000);

const railCard = (root: FakeElement): FakeElement | undefined => findClass(findClass(root, 'rail') ?? root, 'hcard');

/** The 8b S7D2 world plus one adviser line (the creator) and the member its real `create_member` opens. */
async function openCreatorWorld(): Promise<{
  world: Awaited<ReturnType<typeof openS7D2RoleLineWorld>>; callerName: string; memberId: string; goalId: string;
}> {
  const world = await openS7D2RoleLineWorld({ backend: 'memory', extraBindings: [S7D2_ADVISER_WORK] });
  try {
    const caller = await world.lineOf('e3m13-a', (await world.open({ duty: 'adviser', scope: [], requestId: 'e3m13-a' })).result);
    const plan = await adoptPLMixedPlan(world.world, { goal: world.goal, label: 'e3m13', tasks: [
      { taskId: 'e3m13-caller', role: PL_ADVISER_ROLE.templateId },
      { taskId: 'e3m13-member', role: S6A_WORK_ROLE.templateId }] });
    const created = await askS7D2Member(world.world, { caller, goal: world.goal,
      callerTask: plan.tasks[0]!, memberTask: plan.tasks[1]!, label: 'e3m13' });
    if (created.status !== 'created') throw new Error(`E3M-13: the member was not created: ${JSON.stringify(created)}`);
    return { world, callerName: 'Independent work e3m13-caller',
      memberId: created.session.sessionId, goalId: world.goal.goalId };
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}

describe('E3M-13 the Member rail cards', () => {
  it('P13-1 hovering the module line shows its 负责 and a local 最近一步, and sends nothing', async () => {
    const w = await slot.use('S7C', () => openMemberS7C({ firstRun: 'held' }), (opened) => opened.s7c.close());
    const { page, log } = await bootMemberAt(w.s7c.world, memberSearch('s7c-goal', w.module));
    try {
      const row = await railRowOf(page.root, w.s7c.world, w.module);
      expect(row, 'the module line row').toBeDefined();
      const before = log.calls.length;
      hover(row!);
      await settle(() => railCard(page.root) !== undefined);
      expect(dlValue(railCard(page.root), '负责') ?? '').toContain('Independent work s7c-m1');
      /* The world's clock is 2026-10-23T09:00:01.000Z; the card writes the browser-local
         MM-DD HH:mm, never the stored ISO string.
         具名改坏: 卡里的最近一步写死 `—`；本行的本地时刻断言红。 */
      expect(dlValue(railCard(page.root), '最近一步') ?? '').toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/);
      /* 具名改坏: 悬停时读 `role-lines/read`；本行的请求数红。 */
      expect(log.calls.length).toBe(before);
      leave(row!);
      await settle(() => railCard(page.root) === undefined);
      expect(railCard(page.root)).toBeUndefined();
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('P13-8 the rail card names the line that created a member, with one role-lines/read per page read', async () => {
    const w = await slot.use('S7D2', openCreatorWorld, (opened) => opened.world.close());
    const { page, log } = await bootMemberAt(w.world.world, memberSearch(w.goalId,
      { projectId: w.world.world.scope.projectId, sessionId: w.memberId }));
    try {
      /* 具名改坏: 每条线各读一次 `role-lines/read`；这一句红。 */
      expect(countRoute(log, 'role-lines/read')).toBe(1);
      const memberRow = await railRowOf(page.root, w.world.world, { projectId: w.world.world.scope.projectId,
        sessionId: w.memberId });
      expect(memberRow, 'the created member’s row').toBeDefined();
      hover(memberRow!);
      await settle(() => railCard(page.root) !== undefined);
      /* The member's real `create_member` names the adviser line that called it.
         具名改坏: `session` 的建它的写“你”；本行红。 */
      expect(dlValue(railCard(page.root), '建它的')).toBe(w.callerName);
      leave(memberRow!);
      await settle(() => railCard(page.root) === undefined);
      const secretaryRow = await railRowOf(page.root, w.world.world, w.world.lines.secretary.ref);
      hover(secretaryRow!);
      await settle(() => railCard(page.root) !== undefined);
      /* An opening line is the platform's (`start_lines`).
         具名改坏: `platform` 的建它的写“你”；本行红。 */
      expect(dlValue(railCard(page.root), '建它的')).toBe('平台');
    } finally {
      await page.restore();
    }
  }, 240_000);
});
