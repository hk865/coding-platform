/**
 * `G3-retired-held` (book :2027, `:251`, `:677`; PS-23): a line retired by the real health path but not archived still
 * holds its seat; a full cap refuses a new line, and a raised limit admits one. The SQLite half uses the frozen
 * `retireS7BSender` real Kernel-missing path (DR-7D1 G3-1-07), never `makeUnavailableSecretary` and never a Query
 * crash. The memory half is deleted: no public memory health producer exists, and only a hand-built state could
 * trigger it (AGENTS rule 4; ruling :3153 item 51). The holder read is D2's deferred `role-lines/allocation`; the
 * raise is W's `projects/role-limits/set`.
 * Named mutation (not run here): release the holder on the health observation, so the retired line loses its seat
 * without an archive.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { adoptS6BPlan, createS6BLine } from '../helpers/S6B1-fixture.js';
import { openS7BWorld, retireS7BSender } from '../helpers/S7B-fixture.js';
import { sessionOf } from '../helpers/S7A-fixture.js';
import { readS7D1Allocation, setS7D1Open } from '../helpers/S7D1-allocation-world.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';

const worlds: S6AHostWorld[] = [];

afterEach(async () => {
  await Promise.allSettled(worlds.splice(0).map(world => world.close()));
});

describe('G3-retired-held on the real sqlite Host', () => {
  it('a retired-but-held line keeps its seat; a full cap refuses and a raised limit admits', async () => {
    const { world } = await openS7BWorld({ backend: 'sqlite' });
    worlds.push(world);
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    const goal = (await main.createGoal('s7d1-retired-goal', 'S7D1 retired goal')).ref;
    const { tasks } = await adoptS6BPlan(main, goal, { label: 's7d1-retired',
      taskIds: ['s7d1-retired-task'], role: S6A_WORK_ROLE.templateId });
    const sender = await sessionOf(world, await createS6BLine(main,
      { label: 's7d1-retired-sender', role: S6A_WORK_ROLE, tasks: [tasks[0]!] }));
    await retireS7BSender(world, { goal, sender, task: tasks[0]!, label: 's7d1-retired' });
    const retired = (await world.readSession(sender.ref)).record;
    expect(retired).toMatchObject({ lifecycle: 'active', health: 'unavailable', healthConclusion: 'missing' });

    for (let index = 1; index <= 15; index += 1) {
      expect((await main.route('sessions/create', {
        workspace: { ...S6A_SCOPE }, role: S6A_WORK_ROLE, recommendedRefs: [], initialLinks: [],
        meta: { requestId: `s7d1-retired-fill-${String(index)}`, expected: [] },
      }) as Record<string, unknown>)['status']).toBe('completed');
    }
    const refused = await main.route('sessions/create', {
      workspace: { ...S6A_SCOPE }, role: S6A_WORK_ROLE, recommendedRefs: [], initialLinks: [],
      meta: { requestId: 's7d1-retired-over', expected: [] },
    }) as Record<string, unknown>;
    expect(refused).toEqual({ status: 'rejected', code: 'capacity',
      reason: 'at_cap: executor has 16 holder(s) and 0 reservation(s) against open limit 16' });

    const raised = await setS7D1Open(world, 'executor', 17, 0, 's7d1-retired-raise');
    expect(raised).toMatchObject({ revision: 1, open: { executor: 17 } });
    expect((await main.route('sessions/create', {
      workspace: { ...S6A_SCOPE }, role: S6A_WORK_ROLE, recommendedRefs: [], initialLinks: [],
      meta: { requestId: 's7d1-retired-admit', expected: [] },
    }) as Record<string, unknown>)['status']).toBe('completed');

    const report = await readS7D1Allocation(world);
    expect(report.duties.executor.limit).toBe(17);
    expect(report.duties.executor.holders).toHaveLength(17);
    expect(report.duties.executor.holders.some(holder =>
      holder.session.sessionId === sender.ref.sessionId && holder.since !== null)).toBe(true);
    expect(report.duties.executor.reservations).toEqual([]);
  }, 300_000);
});
