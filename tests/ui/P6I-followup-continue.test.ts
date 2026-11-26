/**
 * P6I r3 (p6i-r3-rulings.md B): a follow-up exploration held on a round that never ran is continued from the
 * ArchOverview caption, the same row and "继续探索" button the stopped cold start has (E3A-8). World:
 * `S7D2-coldstart-world.ts` (memory) with the test's own settings directory: the initialization completes, the person
 * selects a prompt pack and deepens `src`; the pack folder leaves before the follow-up's round lands, so its
 * preparation is refused and the follow-up is held. A failed read of the workspace's cold start answers the continue
 * as that failure and releases nothing; with the folder back the page's button releases the follow-up.
 */
import { mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { operationRefKey } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { coldStartOperationRef } from '../../src/core/work-graph/state/cold-start.js';
import { asRecord } from '../../src/ui/values.js';
import { findButton } from './helpers/boot-page.js';
import { bootE3N, callsTo, countRoute, sentWrite, waitFor } from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { pageText } from './helpers/E3A-page.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import {
  dexcCommand, dexcFollowUps, dexcProposal, holdFollowUpRound, openS7D2ColdStartWorld, type S7D2ColdStartWorld,
} from '../helpers/S7D2-coldstart-world.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const P = S6A_SCOPE.projectId;
const PACK = 'p6i-r3-pack';
const HELD = '跟进探索已停下，可以继续。';
const worlds: S7D2ColdStartWorld[] = [];
const folders: string[] = [];
afterEach(async () => {
  const left = commitBarrier.reset();
  await Promise.allSettled(worlds.splice(0).map(world => world.close()));
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
  expect(left).toEqual([]);
});

const heldStatus = async (cold: S7D2ColdStartWorld) => (await dexcFollowUps(cold.host))[0]?.result?.status ?? null;

describe('P6I r3 a held follow-up exploration continued from the page', () => {
  it('shows 继续探索 for it, refuses a continue whose cold-start read failed, and the button releases it', async () => {
    const settingsDirectory = await mkdtemp(join(tmpdir(), 'p6i-r3-settings-'));
    folders.push(settingsDirectory);
    const cold = await openS7D2ColdStartWorld({ backend: 'memory', extraHostOptions: { settings: { settingsDirectory } } });
    worlds.push(cold);
    await cold.initialize();
    const { final } = await cold.walkToCompleted();
    const src = await cold.lineOf(final.explorations!.find(entry => entry.queryRunRef.runId.endsWith(':src'))!.sessionRef, 'r3-src');
    await cold.waitFor('the src line free', async () => (await cold.host.readSession(src.ref)).record.occupancy === null);
    expect((await cold.host.packs.create(PACK)).status).toBe('ready');
    await cold.host.packs.select(PACK);
    const folder = join(settingsDirectory, 'prompts', PACK);
    const away = join(settingsDirectory, 'p6i-r3-pack-away');
    const round = holdFollowUpRound('before', 'P6I r3: the deepen round');
    const deepened = dexcCommand(cold.host, 'deepen', 'p6i-r3-deepen', { module: { projectId: P, moduleId: 'src' } });
    await round.reached;
    await rename(folder, away);
    round.release();
    expect((await deepened).result).toMatchObject({ status: 'committed' });
    await cold.waitFor('the follow-up held', async () => await heldStatus(cold) === 'waiting');

    const fault = commitBarrier.failReads(operationRefKey(coldStartOperationRef(P)), 'throw-always');
    expect((await dexcCommand(cold.host, 'continue', 'p6i-r3-read-failed')).result).toMatchObject({ status: 'rejected', code: 'unavailable' });
    fault.release();
    expect(await heldStatus(cold)).toBe('waiting');

    await rename(away, folder);
    await cold.host.scripted.script(src, dexcProposal('p6i-r3', await cold.pin(),
      [{ op: 'set_module_name', moduleId: 'src', name: 'P6I r3 src deeper' }], 'P6I r3 src deeper'));
    const { page, log } = await bootE3N(cold.host, 'ArchOverview');
    try {
      await waitFor(() => pageText(page).includes(HELD), 30_000);
      await waitFor(() => findButton(page.root, '继续探索')?.getAttribute('disabled') === null, 15_000);
      click(findButton(page.root, '继续探索')!);
      await waitFor(() => countRoute(log, 'workspaces/exploration/continue') === 1, 10_000);
      const call = callsTo(log, 'workspaces/exploration/continue')[0]!;
      await waitFor(() => call.reply !== undefined, 30_000);
      expect(asRecord(call.reply)['status']).toBe('committed');
      expect(sentWrite(call).input['workspace']).toEqual(S6A_SCOPE);
      expect(await heldStatus(cold)).not.toBe('waiting');
      await waitFor(() => !pageText(page).includes(HELD), 15_000);
    } finally {
      await page.restore();
    }
  }, 300_000);
});
