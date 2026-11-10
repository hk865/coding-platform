/**
 * DEXC-05–08 (`exc-tests.frozen.md` §2; R-09–R-13): the depth chosen at registration: 1 explores the coarse split
 * only, 2 is the default (1 + N₁ rounds), 3 adds a deeper round per block on the same line (1 + 2·N₁); `plannedRounds`
 * is written once at the block-set commit and equals the rounds. World: `S7D2-coldstart-world.ts` (memory, `depth`
 * on the seed's registration), N₁ = 2; rounds are turn-opening model requests summed over the exploration lines.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DecisionCardV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import type { S6AGate, S6AReply } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import {
  dexcCommand, dexcProposal, dexcRounds, openS7D2ColdStartWorld, regionQueryRefs, type DexcRow,
  type S7D2ColdStartWorld,
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

async function opened(depth?: 1 | 2 | 3): Promise<S7D2ColdStartWorld> {
  const cold = await openS7D2ColdStartWorld({ backend: 'memory', ...(depth === undefined ? {} : { depth }) });
  worlds.push(cold);
  await cold.initialize();
  return cold;
}

/** Every exploration line's rounds, and the distinct region lines, of the cold start's row. */
async function explored(cold: S7D2ColdStartWorld): Promise<{ total: number; regionLines: number }> {
  const entries = (await cold.coldStart()).explorations ?? [];
  const lines = [...new Map(entries.map(entry => [entry.sessionRef.sessionId, entry])).values()];
  let total = 0;
  for (const entry of lines) total += (await dexcRounds(cold.host, await cold.lineOf(entry.sessionRef, 'dexc'))).length;
  return { total, regionLines: new Set(entries.filter(entry => entry.segment === 'region')
    .map(entry => entry.sessionRef.sessionId)).size };
}

/** Layer 1 renames the block, layer 2 sets its responsibility: compatible ops, so both layers freeze together. */
const renames = (id: string, pin: Parameters<typeof dexcProposal>[1], layers: number): S6AReply[] =>
  Array.from({ length: layers }, (_, layer) => dexcProposal(`dexc-${id}-${String(layer + 1)}`, pin,
    [layer === 0 ? { op: 'set_module_name', moduleId: id, name: `DEXC ${id}` }
      : { op: 'set_responsibility', moduleId: id, text: `DEXC ${id} deeper` }],
    `DEXC ${id} layer ${String(layer + 1)}`)).flat();

const regionCard = async (cold: S7D2ColdStartWorld): Promise<DecisionCardV1 | null> => {
  await cold.waitFor('the region card or the completion', async () =>
    (await cold.proposalCards()).length > 0 || await cold.phase() === 'completed');
  return (await cold.proposalCards())[0] ?? null;
};

describe('DEXC: the exploration depth', () => {
  it('DEXC-05 depth 1 approves the coarse split and opens no region', async () => {
    const cold = await opened(1);
    const pin1 = await cold.pin();
    // Free seats first: a region the depth did not skip would open and run instead of waiting for a seat.
    await cold.toProposals();
    const done = await cold.waitForPhase('completed');
    expect((await explored(cold)).total).toBe(1);
    expect((await explored(cold)).regionLines).toBe(0);
    expect((done as DexcRow).plannedRounds).toBe(1);
    expect(await cold.proposalCards()).toEqual([]);
    expect((await cold.pin()).catalogRef.revision).toBe(pin1.catalogRef.revision + 1);
  }, 300_000);

  it('DEXC-06 without a depth the cold start explores 1 + N₁ rounds on two region lines', async () => {
    const cold = await opened();
    await cold.toProposals(async (id, line, pin) => await cold.host.scripted.script(line, renames(id, pin, 1)));
    await regionCard(cold);
    expect((await explored(cold)).total).toBe(3);
    expect((await explored(cold)).regionLines).toBe(2);
    expect((await cold.cards()).filter(card => card.source.kind === 'structural_proposal')).toHaveLength(2);
    expect((await cold.coldStart() as DexcRow).depth).toBe(2);
  }, 300_000);

  it('DEXC-07a depth 3 adds one deeper round per block on the same line and one batch of both layers', async () => {
    const cold = await opened(3);
    await cold.toProposals(async (id, line, pin) => await cold.host.scripted.script(line, renames(id, pin, 2)));
    const card = await regionCard(cold);
    expect((await explored(cold)).total).toBe(5);
    expect((await explored(cold)).regionLines).toBe(2);
    expect(card!.objects.slice(1).map(object => object.label).sort()).toEqual(['DEXC docs layer 1',
      'DEXC docs layer 2', 'DEXC src layer 1', 'DEXC src layer 2']);
    expect((await cold.cards()).filter(item => item.source.kind === 'structural_proposal')).toHaveLength(2);
    const revision = (await cold.pin()).catalogRef.revision;
    await cold.approve(card!, 'dexc07a-approve');
    expect((await cold.pin()).catalogRef.revision).toBe(revision + 1);
  }, 300_000);

  it('DEXC-07b depth 3: a first layer stopped and reopened still gets its deeper layer', async () => {
    const cold = await opened(3);
    let gate: S6AGate<unknown> | null = null;
    await cold.toProposals(async (id, line, pin) => {
      if (id === 'src') gate = await cold.host.gates.modelRequest(line);
      await cold.host.scripted.script(line, renames(id, pin, 2));
    });
    await gate!.reached;
    await dexcCommand(cold.host, 'stop', 'dexc07b-stop');
    gate!.release();
    expect((await dexcCommand(cold.host, 'continue', 'dexc07b-continue')).result).toMatchObject({ status: 'committed' });
    const card = await regionCard(cold);
    const layers = (id: string) => (card?.objects ?? []).filter(object => object.label.startsWith(`DEXC ${id} layer`));
    expect(layers('src')).toHaveLength(2);
    expect(layers('docs')).toHaveLength(2);
  }, 300_000);

  it.each([[1, 1], [2, 3], [3, 5]] as const)(
    'DEXC-08 depth %i writes plannedRounds %i at the block-set commit, once, equal to the rounds run',
    async (depth, planned) => {
      const cold = await opened(depth);
      const { row } = await cold.toProposals(async (_id, line) => await cold.host.scripted.script(line,
        Array.from({ length: depth - 1 }, (): S6AReply => ({ kind: 'text', text: 'DEXC-08 explored' }))));
      expect(row.plannedRounds).toBe(planned);
      if (depth === 2) {
        await cold.waitFor('the src round answered', async () =>
          (await cold.query(regionQueryRefs(S6A_SCOPE.projectId, 'src').queryJobRef)).job.job.status === 'answered');
        expect((await cold.coldStart() as DexcRow).plannedRounds).toBe(3);
      }
      await cold.waitForPhase('completed');
      expect((await explored(cold)).total).toBe(planned);
    }, 300_000);
});
