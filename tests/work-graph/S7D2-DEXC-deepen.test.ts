/**
 * DEXC-13, 14, 15, 17 (`exc-tests.frozen.md` §2; R-18–R-23): after the initialization completed, "再深一层" on one block
 * explores only that block in one follow-up (its own line when it has none), freezes a card the catalog waits for and
 * survives a restart (15, SQLite only); it is refused before completion and outside the catalog. World:
 * `S7D2-coldstart-world.ts` walked to `completed`; rounds as in the stop file.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModuleRef } from '../../src/contracts/core/identity.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import type { S6AReply } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, type S6ABackend } from '../helpers/S6A-request-fixture.js';
import { valueOf } from '../helpers/S6B3-fixture.js';
import {
  dexcCommand, dexcFollowUps, dexcNextCard as nextCard, dexcProposal, dexcRounds, holdFollowUpRound,
  openS7D2ColdStartWorld,
  type S7D2ColdStartWorld,
} from '../helpers/S7D2-coldstart-world.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const P = S6A_SCOPE.projectId;
const SRC: ModuleRef = { projectId: P, moduleId: 'src' };
const DOCS: ModuleRef = { projectId: P, moduleId: 'docs' };
const worlds: S7D2ColdStartWorld[] = [];
afterEach(async () => {
  const left = commitBarrier.reset();
  await Promise.allSettled(worlds.splice(0).map(world => world.close()));
  expect(left).toEqual([]);
});

/** A completed cold start (depth 2, the region rounds answer in text) and its two free region lines. */
async function completedWorld(backend: S6ABackend = 'memory') {
  const cold = await openS7D2ColdStartWorld({ backend });
  worlds.push(cold);
  await cold.initialize();
  const { final } = await cold.walkToCompleted();
  const regionLine = (id: string) => cold.lineOf((final.explorations ?? [])
    .find(entry => entry.queryRunRef.runId.endsWith(`:${id}`))!.sessionRef, `dexc-${id}`);
  const lines = { src: await regionLine('src'), docs: await regionLine('docs') };
  await cold.waitFor('the region lines free', async () => (await cold.host.readSession(lines.src.ref)).record
    .occupancy === null && (await cold.host.readSession(lines.docs.ref)).record.occupancy === null);
  const rounds = async () => [(await dexcRounds(cold.host, lines.src)).length,
    (await dexcRounds(cold.host, lines.docs)).length];
  return { cold, lines, rounds, before: await rounds(), pin: await cold.pin() };
}

const deeper = (label: string, pin: Parameters<typeof dexcProposal>[1]): S6AReply[] =>
  dexcProposal(label, pin, [{ op: 'set_module_name', moduleId: 'src', name: 'DEXC src deeper' }], 'DEXC src deeper');

const names = async (cold: S7D2ColdStartWorld): Promise<Record<string, string>> => Object.fromEntries(
  valueOf<{ catalog: { catalog: { modules: { ref: { moduleId: string }; name: string }[] } } }>((await cold.host.post(
    'architecture/read', plain(S6A_SCOPE, { selection: { kind: 'current' } }))).body, 'ready', 'the catalog')
    .catalog.catalog.modules.map(module => [module.ref.moduleId, module.name]));

describe('DEXC: one block one layer deeper', () => {
  it('DEXC-13a deepen explores only the chosen block in one follow-up', async () => {
    const { cold, lines, rounds, before, pin } = await completedWorld();
    await cold.host.scripted.script(lines.src, deeper('dexc13a', pin));
    expect((await dexcCommand(cold.host, 'deepen', 'dexc13a', { module: SRC })).result)
      .toMatchObject({ status: 'committed' });
    await nextCard(cold);
    expect(await rounds()).toEqual([before[0]! + 1, before[1]]);
    const [follow] = await dexcFollowUps(cold.host);
    expect(follow?.followUp).toEqual({ kind: 'deepen', moduleRefs: [SRC], reason: null, sourceBatchRef: null });
    expect(follow?.plannedRounds).toBe(1);
    expect((await cold.pin()).catalogRef.revision).toBe(pin.catalogRef.revision);
  }, 300_000);

  it('DEXC-13c after a depth-1 start, deepen opens the block\'s line under the follow-up', async () => {
    const cold = await openS7D2ColdStartWorld({ backend: 'memory', depth: 1 });
    worlds.push(cold);
    await cold.initialize();
    await cold.toProposals();
    await cold.waitForPhase('completed');
    const opened = holdFollowUpRound('after', 'DEXC-13c: after the follow-up round is saved');
    expect((await dexcCommand(cold.host, 'deepen', 'dexc13c', { module: SRC })).result)
      .toMatchObject({ status: 'committed' });
    await opened.reached;
    const entry = (await dexcFollowUps(cold.host))[0]!.explorations![0]!;
    const line = await cold.lineOf(entry.sessionRef, 'dexc13c-src');
    await cold.host.scripted.script(line, deeper('dexc13c', await cold.pin()));
    opened.release();
    await nextCard(cold);
    expect((await dexcRounds(cold.host, line)).length).toBe(1);
    expect(await dexcFollowUps(cold.host)).toHaveLength(1);
  }, 300_000);

  it('DEXC-14 the catalog waits for the deepen card; the approval applies only its batch', async () => {
    const { cold, lines, pin } = await completedWorld();
    await cold.host.scripted.script(lines.src, deeper('dexc14', pin));
    const before = await names(cold);
    expect((await dexcCommand(cold.host, 'deepen', 'dexc14', { module: SRC })).result)
      .toMatchObject({ status: 'committed' });
    await cold.waitFor('the follow-up completed', async () =>
      (await dexcFollowUps(cold.host)).some(row => row.phase === 'completed'));
    expect((await cold.pin()).catalogRef.revision).toBe(pin.catalogRef.revision);
    expect(await names(cold)).toEqual(before);
    await cold.approve(await nextCard(cold), 'dexc14-approve');
    expect((await cold.pin()).catalogRef.revision).toBe(pin.catalogRef.revision + 1);
    expect(await names(cold)).toEqual({ ...before, src: 'DEXC src deeper' });
  }, 300_000);

  it('DEXC-15a/c (SQLite only) a deepen born before a restart runs once after it; its replay is the same follow-up', async () => {
    const { cold, lines, rounds, before, pin } = await completedWorld('sqlite');
    await cold.host.scripted.script(lines.src, deeper('dexc15', pin));
    const held = holdFollowUpRound('before', 'DEXC-15a: before the follow-up round is saved');
    try {
      const deep = await dexcCommand(cold.host, 'deepen', 'dexc15', { module: SRC });
      expect(deep.result).toMatchObject({ status: 'committed' });
      await held.reached;
      await cold.host.crash();
      expect(await dexcFollowUps(cold.host)).toMatchObject([{ actionPhase: 'regions', followUp: { moduleRefs: [SRC] } }]);
      await nextCard(cold);
      expect(await rounds()).toEqual([before[0]! + 1, before[1]]);
      expect((await deep.replay())['replayed']).toBe(true);
      expect(await dexcFollowUps(cold.host)).toHaveLength(1);
      expect(await rounds()).toEqual([before[0]! + 1, before[1]]);
    } finally {
      held.release();
    }
  }, 300_000);

  it('DEXC-15b (SQLite only) two deepens born before a restart each run exactly one round after it', async () => {
    const { cold, lines, rounds, before } = await completedWorld('sqlite');
    for (const line of [lines.src, lines.docs]) await cold.host.scripted.script(line, [{ kind: 'text', text: 'DEXC-15b' }]);
    const held = holdFollowUpRound('before', 'DEXC-15b: before the first follow-up round is saved');
    try {
      for (const [id, module] of [['src', SRC], ['docs', DOCS]] as const) {
        expect((await dexcCommand(cold.host, 'deepen', `dexc15b-${id}`, { module })).result)
          .toMatchObject({ status: 'committed' });
      }
      await held.reached;
      await cold.host.crash();
      await cold.waitFor('one round on each block', async () =>
        JSON.stringify(await rounds()) === JSON.stringify([before[0]! + 1, before[1]! + 1]));
      await cold.waitFor('both follow-ups completed', async () =>
        (await dexcFollowUps(cold.host)).filter(row => row.phase === 'completed').length === 2);
      expect(await rounds()).toEqual([before[0]! + 1, before[1]! + 1]);
    } finally {
      held.release();
    }
  }, 300_000);
});

describe('rejects: deepen', () => {
  it('DEXC-13b deepen before the initialization completed is refused', async () => {
    const cold = await openS7D2ColdStartWorld({ backend: 'memory' });
    worlds.push(cold);
    await cold.initialize();
    await cold.advanceTo('regions');
    const revision = (await cold.pin()).catalogRef.revision;
    expect((await dexcCommand(cold.host, 'deepen', 'dexc13b', { module: SRC })).result)
      .toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await dexcFollowUps(cold.host)).toEqual([]);
    expect((await cold.pin()).catalogRef.revision).toBe(revision);
  }, 300_000);

  it('DEXC-17 deepen of a block outside the catalog is refused', async () => {
    const { cold, pin } = await completedWorld();
    expect((await dexcCommand(cold.host, 'deepen', 'dexc17', { module: { projectId: P, moduleId: 'dexc-missing' } }))
      .result).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await dexcFollowUps(cold.host)).toEqual([]);
    expect((await cold.pin()).catalogRef.revision).toBe(pin.catalogRef.revision);
  }, 300_000);
});
