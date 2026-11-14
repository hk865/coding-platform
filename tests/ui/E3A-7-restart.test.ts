import { afterAll, describe, expect, it } from 'vitest';
import { bootE3N, callsTo, countRoute, waitFor } from './helpers/E3N-page.js';
import { openW3 } from './helpers/E3N-world.js';
import { archObservationState, seedArchWorld } from './helpers/E3A-world.js';
import { detailText } from './helpers/E3A-page.js';
import { enterWorkGraph } from './helpers/E3A-fixed.js';
import { asRecord } from '../../src/ui/values.js';
import type { S6ARequestWorld } from '../helpers/S6A-request-fixture.js';

/**
 * E3A-7 (CLKD package 10, row P16-9): the same node head clicked before and
 * after a clean Host reopen. The page reads `architecture/read` and
 * `architecture/observation-state` and never `sessions/read`; the same path,
 * the same catalog revision and the same persisted observation ref come back.
 */

const worlds: S6ARequestWorld[] = [];
afterAll(async () => {
  for (const world of worlds.splice(0)) await world.close();
}, 240_000);

function catalogRevisionOf(reply: unknown): number {
  const value = asRecord(asRecord(reply)['value']);
  const catalog = asRecord(value['catalog']);
  const revision = asRecord(catalog['ref'])['revision'];
  if (typeof revision !== 'number') throw new Error(`E3A: the catalog read has no ref revision: ${JSON.stringify(reply)}`);
  return revision;
}

async function openAtNode(world: S6ARequestWorld, goalId: string): Promise<{ text: string; read: unknown; sessionsReads: number }> {
  const { page, log } = await bootE3N(world, 'ArchOverview', { search: '?goal=' + goalId, mode: 'controlled' });
  try {
    enterWorkGraph(page.root);
    await waitFor(() => callsTo(log, 'architecture/read').some((call) => call.reply !== undefined), 5_000);
    const read = callsTo(log, 'architecture/read').at(-1)!.reply;
    return { text: detailText(page.root), read, sessionsReads: countRoute(log, 'sessions/read') };
  } finally {
    await page.restore();
  }
}

describe('E3A-7 ArchOverview after a Host reopen', () => {
  it('P16-9 the same node, catalog revision and persisted observation ref come back after the reopen', async () => {
    const opened = await openW3();
    worlds.push(opened.world);
    await seedArchWorld(opened.world);
    const goalId = opened.world.goals.first.goalId;
    const before = await openAtNode(opened.world, goalId);
    const observationBefore = asRecord((await archObservationState(opened.world))['current']);
    expect(before.text).toContain('WorkGraph');
    expect(before.text).toContain('1 个文件');

    await opened.world.reopen();
    const after = await openAtNode(opened.world, goalId);
    const observationAfter = asRecord((await archObservationState(opened.world))['current']);
    /* 具名改坏: 重开后页面用新的 `?goal=` 或重新按 URL 打开节点；本句的详情路径红。 */
    expect(after.text).toBe(before.text);
    /* 具名改坏: 重开后 `architecture/read` 读到另一份 catalog；本句红。 */
    expect(catalogRevisionOf(after.read)).toEqual(catalogRevisionOf(before.read));
    /* 具名改坏: `observation-state` 的 persistedRef 在重开后漂移；本句红。 */
    expect(observationAfter['persistedRef']).toEqual(observationBefore['persistedRef']);
    /* 具名改坏: 页面改读 `sessions/read`；本句红（冻结的看什么点名不读它）。 */
    expect(before.sessionsReads).toBe(0);
    expect(after.sessionsReads).toBe(0);
  }, 240_000);
});
