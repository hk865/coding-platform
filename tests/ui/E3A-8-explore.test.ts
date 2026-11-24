/**
 * E3A-8 (7D2 batch 10 X2): the ArchOverview caption's exploration row. World:
 * `S7D2-coldstart-world.ts` (memory) held at `proposals` on the `src` region round,
 * so the cold start is running when the page first reads it. The page stops and
 * continues through the public route; the operation record is read through
 * `role-lines/operations`, never the store.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findButton, findClass } from './helpers/boot-page.js';
import { bootE3N, callsTo, countRoute, sentWrite, waitFor } from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { graphNode, nodeHead } from './helpers/E3A-fixed.js';
import { detail, pageText } from './helpers/E3A-page.js';import { asRecord } from '../../src/ui/values.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import {
  dexcProposal, openS7D2ColdStartWorld, type S7D2ColdStartWorld,
} from '../helpers/S7D2-coldstart-world.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S7D2ColdStartWorld[] = [];
afterEach(async () => {
  const left = commitBarrier.reset();
  await Promise.allSettled(worlds.splice(0).map(world => world.close()));
  expect(left).toEqual([]);
});

/** A cold start at `proposals`: the `src` region's first model request is held. */
async function heldRegion() {
  const cold = await openS7D2ColdStartWorld({ backend: 'memory' });
  worlds.push(cold);
  await cold.initialize();
  let gate: { reached: Promise<unknown>; release(): void } | null = null;
  const { lines } = await cold.toProposals(async (id, line, pin) => {
    if (id === 'src') gate = await cold.host.gates.modelRequest(line);
    await cold.host.scripted.script(line, dexcProposal(`dexc-${id}`, pin,
      [{ op: 'set_module_name', moduleId: id, name: `DEXC ${id}` }], `DEXC ${id}`));
  });
  await gate!.reached;
  return { cold, a: lines['src']!, gate: gate! };
}

describe('E3A-8 the exploration stop and continue row', () => {
  it('E3A-08 stops the running initialization from the caption and continues the stopped one', async () => {
    const { cold, a, gate } = await heldRegion();
    const { page, log } = await bootE3N(cold.host, 'ArchOverview');
    const nextGate = await cold.host.gates.modelRequest(a);
    try {
      /* FIRST STEP: the world must read as an ArchOverview page. The two extra
         per-workspace reads must not turn a published page into an error page. */
      await waitFor(() => countRoute(log, 'lines/list') >= 1, 30_000);
      expect(findClass(page.root, 'ov-cap-l')).toBeDefined();
      expect(pageText(page)).not.toContain('找不到这个目标。');
      expect(pageText(page)).not.toContain('暂时读不到');
      await waitFor(() => pageText(page).includes('还没初始化完：正在初始化。'), 10_000);
      expect(pageText(page)).toContain('停止探索');
      const src = graphNode(page.root, 'src');
      expect(src).toBeDefined();
      click(nodeHead(src!)!);
      expect(detail(page.root)).toBeDefined();
      expect(pageText(page)).not.toContain('再深一层');

      const stopButton = findButton(page.root, '停止探索');
      expect(stopButton).toBeDefined();
      click(stopButton!);
      await waitFor(() => countRoute(log, 'workspaces/exploration/stop') === 1, 10_000);
      const stopCall = callsTo(log, 'workspaces/exploration/stop')[0]!;
      await waitFor(() => stopCall.reply !== undefined, 30_000);
      const stopWrite = sentWrite(stopCall);
      expect(stopWrite.input['workspace']).toEqual({ projectId: 'ag2b-collab-project', workspaceId: 'ag2b-collab-workspace' });
      expect(asRecord(stopCall.reply)['status']).toBe('committed');
      /* Ruling 1: no `meta.expected` assertion; the stop and continue owners carry no pin. */
      await waitFor(() => pageText(page).includes('还没初始化完：探索已停下，可以继续。'), 15_000);
      expect(pageText(page)).toContain('继续探索');
      expect((await cold.coldStart() as { result: unknown }).result).toEqual({ status: 'waiting', reason: 'stopped_by_person' });

      const continueButton = findButton(page.root, '继续探索');
      expect(continueButton).toBeDefined();
      /* The row's button is greyed while its write is in flight; the stop write
         also waits for the notifications it caused, so wait for the button to
         come back before the second click. */
      await waitFor(() => findButton(page.root, '继续探索')?.getAttribute('disabled') === null, 15_000);
      click(continueButton!);
      await waitFor(() => countRoute(log, 'workspaces/exploration/continue') === 1, 10_000);
      const continueCall = callsTo(log, 'workspaces/exploration/continue')[0]!;
      await waitFor(() => continueCall.reply !== undefined, 30_000);
      expect(asRecord(continueCall.reply)['status']).toBe('committed');
      expect(sentWrite(continueCall).input['workspace']).toEqual({ projectId: 'ag2b-collab-project', workspaceId: 'ag2b-collab-workspace' });
      /* Every click has its own request id: the stop command id embeds it, so a
         replayed id would answer with the first receipt. */
      expect(sentWrite(continueCall).meta.requestId).not.toBe(sentWrite(stopCall).meta.requestId);
      await waitFor(() => pageText(page).includes('还没初始化完：正在初始化。'), 15_000);
      /* The continue write also waits for the notifications it caused; its button
         is clickable again only after that reread finished. */
      await waitFor(() => findButton(page.root, '停止探索')?.getAttribute('disabled') === null, 15_000);
      expect((await cold.coldStart() as { result: unknown }).result).not.toEqual({ status: 'waiting', reason: 'stopped_by_person' });
    } finally {
      gate.release();
      nextGate.release();
      await page.restore();
    }
  }, 300_000);
});
