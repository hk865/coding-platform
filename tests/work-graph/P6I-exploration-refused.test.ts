/**
 * P6I T6 (p6i-rework-rulings.md item 3 and "写测试方" T6; lens review M1): a cold-start exploration round whose
 * preparation is refused for a lasting cause is closed and not reopened. The exploration is held the way a person's
 * stop holds it, the cause is readable on the cold-start row, and the person's continue opens the round again.
 *
 * World: `S7D2-coldstart-world.ts` (memory) with the test's own settings directory (A8). The person's prompt pack is
 * selected from the start. After the route continuation and before the `coarse_split` commit lands, the pack folder
 * is moved away (A1, a real folder), so the adviser's coarse round is claimed and its preparation refused `invalid`.
 */
import { mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import {
  coarseSplitQueryRefs, dexcCommand, holdColdStartPhaseBefore, openS7D2ColdStartWorld, type S7D2ColdStartWorld,
} from '../helpers/S7D2-coldstart-world.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const PACK = 'p6i-explore-pack';
const worlds: S7D2ColdStartWorld[] = [];
const folders: string[] = [];
afterEach(async () => {
  commitBarrier.reset();
  await Promise.allSettled(worlds.splice(0).map(world => world.close()));
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

describe('P6I R2 on an exploration round', () => {
  it('T6: a lasting refusal of the coarse round holds the exploration with its cause; no new round until continue', async () => {
    const settingsDirectory = await mkdtemp(join(tmpdir(), 'p6i-t6-settings-'));
    folders.push(settingsDirectory);
    const cold = await openS7D2ColdStartWorld({ backend: 'memory', extraHostOptions: { settings: { settingsDirectory } } });
    worlds.push(cold);
    expect((await cold.host.packs.create(PACK)).status).toBe('ready');
    await cold.host.packs.select(PACK);
    await cold.advanceTo('route');
    await cold.setAdviserOpen(await cold.adviserHolders() + 1, 'p6i-t6-limits');
    // The route continuation answers with the pack in place; the folder leaves before the coarse round is opened.
    const folder = join(settingsDirectory, 'prompts', PACK);
    const away = join(settingsDirectory, 'p6i-pack-away');
    const coarsePhase = holdColdStartPhaseBefore('coarse_split', 'P6I T6: before the coarse_split commit');
    const continued = cold.submitContinuation('split', 'p6i-t6-route-split');
    await coarsePhase.reached;
    await rename(folder, away);
    coarsePhase.release();
    await continued;

    await cold.waitFor('the exploration to be held', async () => (await cold.coldStart()).result?.status === 'waiting');
    const row = await cold.coldStart();
    expect(row.actionPhase).toBe('coarse_split');
    expect(row.explorations, 'the refused coarse round is the only round').toHaveLength(1);
    // The cause is on the row (the result or the round's entry), naming the pack that could not be resolved.
    expect(JSON.stringify({ result: row.result, explorations: row.explorations })).toContain(PACK);
    expect((await cold.query(coarseSplitQueryRefs(S6A_SCOPE.projectId).queryJobRef)).job.job)
      .toMatchObject({ status: 'closed', closeReason: { code: 'not_entered' } });

    // With the folder back, the person's continue opens the coarse round again.
    await rename(away, folder);
    expect((await dexcCommand(cold.host, 'continue', 'p6i-t6-continue')).result).toMatchObject({ status: 'committed' });
    expect((await cold.waitForExplorations(2)).explorations).toHaveLength(2);
  }, 300_000);
});
