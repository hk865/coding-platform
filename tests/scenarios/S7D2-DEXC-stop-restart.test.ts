/**
 * DEXC-04 (`exc-tests.frozen.md` §2; R-02, R-06), SQLite only (a Host restart): a cold start stopped at `proposals`
 * stays stopped after `crash()`, starts no round or card, and the start-up report does not count it as waiting.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import type { S6AGate } from '../helpers/S6A-host-fixture.js';
import {
  dexcBarrier, dexcCommand, dexcProposal, dexcRounds, openS7D2ColdStartWorld, type DexcRow,
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

describe('DEXC-04: a stopped exploration across a Host restart', () => {
  it('DEXC-04 (SQLite only) the stopped cold start is still stopped after a restart and starts nothing', async () => {
    const cold = await openS7D2ColdStartWorld({ backend: 'sqlite' });
    worlds.push(cold);
    await cold.initialize();
    let gate: S6AGate<unknown> | null = null;
    const { lines } = await cold.toProposals(async (id, line, pin) => {
      if (id === 'src') gate = await cold.host.gates.modelRequest(line);
      await cold.host.scripted.script(line, dexcProposal(`dexc04-${id}`, pin,
        [{ op: 'set_module_name', moduleId: id, name: `DEXC ${id}` }], `DEXC ${id}`));
    });
    await gate!.reached;
    expect((await dexcCommand(cold.host, 'stop', 'dexc04-stop')).result).toMatchObject({ status: 'committed' });
    await cold.host.settleDetached();
    await cold.host.crash();
    const row = await cold.coldStart() as DexcRow;
    expect(row.result).toEqual({ status: 'waiting', reason: 'stopped_by_person' });
    expect(row.actionPhase).toBe('proposals');
    expect(['accepted', 'running']).toContain(row.phase);
    expect(row.plannedRounds).toBe(3);
    const rounds = [(await dexcRounds(cold.host, lines['src']!)).length, (await dexcRounds(cold.host, lines['docs']!)).length];
    await dexcBarrier(cold.host);
    expect([(await dexcRounds(cold.host, lines['src']!)).length, (await dexcRounds(cold.host, lines['docs']!)).length])
      .toEqual(rounds);
    expect(await cold.proposalCards()).toEqual([]);
    expect(JSON.stringify(cold.host.host.reconcile)).not.toContain('operation(s) waiting');
  }, 300_000);
});
