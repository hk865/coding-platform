/**
 * DEXC-01, 02, 18 (`exc-tests.frozen.md` §2; R-01–R-07, R-24): stopping the cold start during a region round, then
 * continuing; the stop's replay; the workspace files untouched. World: `S7D2-coldstart-world.ts` (memory) at
 * `proposals`, A = `src`, B = `docs`; rounds are turn-opening model requests at the boundary. Named mutations in §4:
 * 01 no `controller.abort()`; 02a no `reopen` branch; 02b a revision in the command id; 18 a note written on stop.
 */
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import type { S6AGate } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import {
  dexcBarrier, dexcCommand, dexcProposal, dexcRounds, dexcSignal, openS7D2ColdStartWorld, regionQueryRefs,
  type DexcRow, type S7D2ColdStartWorld,
} from '../helpers/S7D2-coldstart-world.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const P = S6A_SCOPE.projectId;
const STOPPED = { status: 'waiting', reason: 'stopped_by_person' };
const worlds: S7D2ColdStartWorld[] = [];
afterEach(async () => {
  const left = commitBarrier.reset();
  await Promise.allSettled(worlds.splice(0).map(world => world.close()));
  expect(left).toEqual([]);
});

/** A cold start at `proposals`: both region lines propose a rename; `held`'s first model request is held. */
async function heldRegion(held: 'src' | 'docs') {
  const cold = await openS7D2ColdStartWorld({ backend: 'memory' });
  worlds.push(cold);
  await cold.initialize();
  let gate: S6AGate<unknown> | null = null;
  const { lines } = await cold.toProposals(async (id, line, pin) => {
    if (id === held) gate = await cold.host.gates.modelRequest(line);
    await cold.host.scripted.script(line, dexcProposal(`dexc-${id}`, pin,
      [{ op: 'set_module_name', moduleId: id, name: `DEXC ${id}` }], `DEXC ${id}`));
  });
  await gate!.reached;
  return { cold, gate: gate!, a: lines['src']!, b: lines['docs']! };
}

describe('DEXC: stopping and continuing the cold start', () => {
  it('DEXC-01 a stop holds the operation at proposals and cancels the running round', async () => {
    const { cold, a } = await heldRegion('src');
    expect((await dexcCommand(cold.host, 'stop', 'dexc01-stop')).result).toMatchObject({ status: 'committed' });
    const row = await cold.coldStart() as DexcRow;
    expect([row.result, row.actionPhase, row.depth]).toEqual([STOPPED, 'proposals', 2]);
    expect(['accepted', 'running']).toContain(row.phase);
    expect((await dexcSignal(cold.host, a))?.aborted).toBe(true);
    const rounds = (await dexcRounds(cold.host, a)).length;
    await dexcBarrier(cold.host);
    expect((await dexcRounds(cold.host, a)).length).toBe(rounds);
    expect(await cold.proposalCards()).toEqual([]);
    expect((await cold.coldStart()).result).toEqual(STOPPED);
  }, 300_000);

  it('DEXC-02 continue reopens only the stopped round; the same stop request replays its receipt', async () => {
    const { cold, gate, a, b } = await heldRegion('docs');
    await cold.waitFor('the src round answered', async () =>
      (await cold.query(regionQueryRefs(P, 'src').queryJobRef)).job.job.status === 'answered');
    const stop = await dexcCommand(cold.host, 'stop', 'dexc02-stop');
    gate.release();
    expect((await dexcCommand(cold.host, 'continue', 'dexc02-continue')).result).toMatchObject({ status: 'committed' });
    await cold.waitFor('the region batch card', async () => (await cold.proposalCards()).length === 1);
    // (a) Hand-computed: one coarse round, A once, B's cancelled round and its one reopen; 1 + N₁ = 3 planned.
    expect([(await dexcRounds(cold.host, cold.lines.adviser)).length, (await dexcRounds(cold.host, a)).length,
      (await dexcRounds(cold.host, b)).length]).toEqual([1, 1, 2]);
    expect((await cold.coldStart() as DexcRow).plannedRounds).toBe(3);
    const card = (await cold.proposalCards())[0]!;
    expect(card.objects.slice(1).map(object => object.label).sort()).toEqual(['DEXC docs', 'DEXC src']);
    await cold.approve(card, 'dexc02-approve');
    expect((await cold.waitForPhase('completed')).lastCompleted).toBe('proposals');
    // (b) The same request id and body after the continue and the completion: the first receipt, no second stop.
    const replayed = await stop.replay();
    expect(replayed['replayed']).toBe(true);
    expect((replayed['value'] as { revision: number }).revision).toBe((stop.result['value'] as { revision: number }).revision);
    expect((await cold.coldStart()).result).not.toEqual(STOPPED);
    // The receipt is read before any target: another target under the same id is the receipt's conflict.
    expect((await dexcCommand(cold.host, 'stop', 'dexc02-stop', { workspace: { projectId: P,
      workspaceId: 'dexc-missing' } })).result).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
  }, 300_000);

  it('DEXC-18 stopping and continuing change no workspace file', async () => {
    const cold = await openS7D2ColdStartWorld({ backend: 'memory' });
    worlds.push(cold);
    await cold.initialize();
    await cold.advanceTo('regions');
    await mkdir(join(cold.host.root, '.workbench'), { recursive: true });
    await writeFile(join(cold.host.root, '.workbench', 'knowledge.json'), '{"dexc":"knowledge"}\n');
    const tree = async (dir: string): Promise<string[]> => (await Promise.all((await readdir(dir,
      { withFileTypes: true })).map(async entry => entry.isDirectory() ? tree(join(dir, entry.name))
      : [`${relative(cold.host.root, join(dir, entry.name))} ${createHash('sha256')
        .update(await readFile(join(dir, entry.name))).digest('hex')}`]))).flat().sort();
    const before = await tree(cold.host.root);
    expect((await dexcCommand(cold.host, 'stop', 'dexc18-stop')).result).toMatchObject({ status: 'committed' });
    expect((await dexcCommand(cold.host, 'continue', 'dexc18-continue')).result).toMatchObject({ status: 'committed' });
    expect((await cold.coldStart() as DexcRow).depth).toBe(2);
    await cold.host.settleDetached();
    expect(await tree(cold.host.root)).toEqual(before);
  }, 300_000);
});
