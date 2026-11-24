/** E3A-9 (7D2 batch 10 X3): after the initialization completed, the module detail
 * offers "再深一层"; one click sends one deepen follow-up for that block, and while it
 * runs the detail says so and offers no button. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { asRecord } from '../../src/ui/values.js';
import { findButton } from './helpers/boot-page.js';
import { bootE3N, callsTo, countRoute, sentWrite, waitFor } from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { graphNode, nodeHead } from './helpers/E3A-fixed.js';
import { detailText, pageText } from './helpers/E3A-page.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { valueOf } from '../helpers/S6B3-fixture.js';
import {
  dexcFollowUps, dexcProposal, holdFollowUpRound, openS7D2ColdStartWorld, type S7D2ColdStartWorld,
} from '../helpers/S7D2-coldstart-world.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const P = S6A_SCOPE.projectId;
const worlds: S7D2ColdStartWorld[] = [];
afterEach(async () => {
  const left = commitBarrier.reset();
  await Promise.allSettled(worlds.splice(0).map(world => world.close()));
  expect(left).toEqual([]);
});

async function completedWorld() {
  const cold = await openS7D2ColdStartWorld({ backend: 'memory' });
  worlds.push(cold);
  await cold.initialize();
  const { final } = await cold.walkToCompleted();
  const regionLine = (id: string) => cold.lineOf((final.explorations ?? [])
    .find(entry => entry.queryRunRef.runId.endsWith(`:${id}`))!.sessionRef, `dexc-${id}`);
  const lines = { src: await regionLine('src'), docs: await regionLine('docs') };
  await cold.waitFor('the region lines free', async () => (await cold.host.readSession(lines.src.ref)).record
    .occupancy === null && (await cold.host.readSession(lines.docs.ref)).record.occupancy === null);
  return { cold, lines, pin: await cold.pin() };
}

async function moduleNames(cold: S7D2ColdStartWorld): Promise<Record<string, string>> {
  const catalog = valueOf<{ catalog: { catalog: { modules: { ref: { moduleId: string }; name: string }[] } } }>(
    (await cold.host.post('architecture/read', plain(S6A_SCOPE, { selection: { kind: 'current' } }))).body,
    'ready', 'the catalog');
  return Object.fromEntries(catalog.catalog.catalog.modules.map(module => [module.ref.moduleId, module.name]));
}
describe('E3A-9 one module one layer deeper', () => {
  it('E3A-09 deepens the selected catalogue module and says so while it runs', async () => {
    const { cold, lines, pin } = await completedWorld();
    await cold.host.scripted.script(lines.src, dexcProposal('e3a9', pin,
      [{ op: 'set_module_name', moduleId: 'src', name: 'E3A-9 src deeper' }], 'E3A-9 src deeper'));
    const names = await moduleNames(cold);
    const { page, log } = await bootE3N(cold.host, 'ArchOverview');
    try {
      /* FIRST STEP: the world must read as an ArchOverview page. */
      await waitFor(() => countRoute(log, 'lines/list') >= 1, 30_000);
      expect(pageText(page)).not.toContain('找不到这个目标。');
      expect(pageText(page)).not.toContain('暂时读不到');
      click(nodeHead(graphNode(page.root, names['src']!)!)!);
      expect(detailText(page.root)).toContain('进入这一层');
      const deepen = findButton(page.root, '再深一层');
      expect(deepen).toBeDefined();
      const held = holdFollowUpRound('after', 'E3A-9: the follow-up round lands');
      click(deepen!);
      await waitFor(() => countRoute(log, 'workspaces/exploration/deepen') === 1, 10_000);
      const call = callsTo(log, 'workspaces/exploration/deepen')[0]!;
      await waitFor(() => call.reply !== undefined, 30_000);
      expect(sentWrite(call).input).toEqual({ workspace: S6A_SCOPE, module: { projectId: P, moduleId: 'src' } });
      expect(asRecord(call.reply)['status']).toBe('committed');
      await held.reached;
      const follows = await dexcFollowUps(cold.host);
      expect(follows).toHaveLength(1);
      expect(follows[0]?.followUp).toEqual({ kind: 'deepen',
        moduleRefs: [{ projectId: P, moduleId: 'src' }], reason: null, sourceBatchRef: null });
      held.release();
      await waitFor(() => detailText(page.root).includes('正在再深一层。'), 30_000);
      expect(findButton(page.root, '再深一层')).toBeUndefined();
      click(nodeHead(graphNode(page.root, names['docs']!)!)!);
      await waitFor(() => detailText(page.root).includes(names['docs']!), 10_000);
      expect(findButton(page.root, '再深一层')).toBeDefined();
    } finally {
      await page.restore();
    }
  }, 300_000);
});
