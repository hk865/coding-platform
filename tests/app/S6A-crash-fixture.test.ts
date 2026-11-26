/**
 * The S6A host world's `crash()` (tests/helpers/S6A-host-fixture.ts) checked on itself. Basis: FLK rework rulings 5
 * and 6 (返工裁定第 5、6 条, `flk-rework-rulings.md`), from the review rows that found a crashed Host could still
 * write and still run.
 *
 * - Ruling 5, the ledger: a commit the old Host made before the crash and the row held at a `before` hold (the drop
 *   gate) is refused when the row lets it go after the crash; the old Host's own answer to that command is the
 *   completion barrier, and the new Host's public request read shows the round as it was.
 * - Ruling 5, the bodies: the old Host's round is held at its Kernel entry at the crash; let go, the Kernel run
 *   stores its tool specs body (`observed-model-run.ts`, `onConfiguration`) in the artifact store, the store the
 *   ledger only points into, before anything of it reaches the ledger. The final ledger shows no trace either way,
 *   so the old Host's body store is read through an A3 delegating wrapper on `createSqliteRawArtifactStore` (each
 *   put and its real result, unchanged); the completion barrier is the end of that Kernel run (the fixture's own
 *   Kernel-entry spy call).
 * - Ruling 6: the old Host's round is in its last model call and the row has just let the held reply go, so the
 *   Kernel run still goes on and no gate holds it. A crash there is the wrong crash point the write stop would hide
 *   (the reply needs no further model call, so the old count of model calls after the crash stayed at zero): the
 *   crash fails, naming the cell, the Host and the run, and crashes nothing, so the run finishes on the live Host.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as kernelModule from '../../vendor/coding-agent/dist/public-api.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { RequestSubmitResultV1 } from '../../src/business/workflow/request-intake.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { initializeProject, secretaryAnswer } from '../helpers/S6A-history-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_GOAL_1 } from '../helpers/S6A-request-fixture.js';

// The frozen commit barrier (tests/helpers/S6A-commit-barrier.ts): the two mocks every host-world file installs.
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

/** Every body put of every artifact store a Host start built, in order: which store and its real result. */
const bodies = vi.hoisted(() => ({ stores: 0, puts: [] as { store: number; contentType: string; result: unknown }[] }));
vi.mock('../../src/core/record-store/sqlite-body-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/sqlite-body-store.js')>();
  return { ...actual, createSqliteRawArtifactStore: (path: string) => {
    const real = actual.createSqliteRawArtifactStore(path);
    const store = ++bodies.stores;
    // The store builds its methods without `this`, so the spread keeps `read` and `close`.
    return { ...real, put: async (input: Parameters<typeof real.put>[0]) => {
      const result = await real.put(input);
      bodies.puts.push({ store, contentType: input.contentType, result });
      return result;
    } };
  } };
});

const worlds: S6AHostWorld[] = [];

afterEach(async () => {
  const left = commitBarrier.reset();
  const open = worlds.splice(0);
  await Promise.allSettled(open.map(world => world.close()));
  bodies.stores = 0;
  bodies.puts = [];
  expect(left).toEqual([]);
});

function remember(world: S6AHostWorld): S6AHostWorld {
  worlds.push(world);
  return world;
}

function queued(result: RequestSubmitResultV1): { requestRoot: QueryJobRef; round: QueryJobRef } {
  if (result.status !== 'queued') throw new Error(`S6A: the request was not queued: ${JSON.stringify(result)}`);
  return { requestRoot: result.requestRoot, round: result.round };
}

describe('the S6A crash stops the old Host (SQLite)', () => {
  it('ruling 5, ledger: a commit held at its before hold at the crash does not land when the row lets it go',
    async () => {
      const world = remember(await openS6AHostWorld({ backend: 'sqlite' }));
      await initializeProject(world);
      const b = await world.createSecretary('b');
      // The request driver is off on both Hosts: the round stays queued on B and only the drop writes it.
      const submitted = queued(await world.submit({ commandId: 'f5-ledger-1', goalId: S6A_GOAL_1.goalId,
        text: 'F5 ledger request', recipient: b }));
      const held = world.gates.beforeDrop({ requestRoot: submitted.requestRoot });
      const dropping = world.drop({ commandId: 'f5-ledger-2', round: submitted.round });
      await held.reached;
      await world.crash();
      held.release();
      // The old Host answers its own command once the held commit has reached the store or been refused.
      const answer = await dropping;
      const view = await world.readRequest(submitted.requestRoot);
      expect(view.rounds.find(round => round.ref.queryJobId === submitted.round.queryJobId))
        .toMatchObject({ status: 'queued', closeCode: null });
      expect(answer).not.toMatchObject({ status: 'routed' });
    }, 120_000);

  it('ruling 5, bodies: a body the old Host puts after the crash is refused, which the final ledger never shows',
    async () => {
      const world = remember(await openS6AHostWorld({ backend: 'sqlite', extraHostOptions: { requestDriver: 'on' } }));
      await initializeProject(world);
      const a = await world.createSecretary('a');
      const entry = await world.gates.beforeKernel(a);
      const submitted = queued(await world.submit({ commandId: 'f5-body-1', goalId: S6A_GOAL_1.goalId,
        text: 'F5 body request', recipient: a }));
      // The round's start commit has landed and its Kernel run is held by the row's gate when the Host crashes.
      const entered = await entry.reached;
      const kernel = vi.mocked(kernelModule.runCodingAgent);
      const call = kernel.mock.calls.findIndex(([input]) => input.executionIdentity?.runId === entered.runId);
      expect(call).toBeGreaterThanOrEqual(0);
      const oldStores = bodies.stores;
      const putsBefore = bodies.puts.length;
      // The new Host runs no round, so only the old Host's released run goes on with this one.
      await world.crash({ extraHostOptions: { requestDriver: 'off' } });
      entry.release();
      // The completion barrier: that Kernel run has ended (its model call can no longer be served).
      await Promise.resolve(kernel.mock.results[call]!.value).catch(() => undefined);
      // The final ledger: the round never answers on either Host.
      const view = await world.readRequest(submitted.requestRoot);
      expect(view.rounds.find(round => round.ref.queryJobId === submitted.round.queryJobId)?.answer).toBeNull();
      // The body store: nothing of the crashed Host landed there after the crash.
      const landed = bodies.puts.slice(putsBefore).filter(put => put.store <= oldStores);
      expect(landed).toEqual([]);
    }, 120_000);

  it('ruling 6: a crash while the old Host’s last model call goes on, held by no gate, names the cell, Host and run',
    async () => {
      const world = remember(await openS6AHostWorld({ backend: 'sqlite', extraHostOptions: { requestDriver: 'on' } }));
      await initializeProject(world);
      const a = await world.createSecretary('a');
      const body = 'F6 answer of the run the crash must not cut';
      await world.scripted.script(a, [{ kind: 'text', text: secretaryAnswer({ body }) }]);
      const entry = await world.gates.beforeKernel(a);
      const reply = await world.gates.modelRequest(a);
      const submitted = queued(await world.submit({ commandId: 'f6-run-1', goalId: S6A_GOAL_1.goalId,
        text: 'F6 run request', recipient: a }));
      const entered = await entry.reached;
      entry.release();
      // The round's one, last model call: its reply goes on the moment the row lets it go, and the crash comes then.
      await reply.reached;
      reply.release();
      const failure = await world.crash().then(() => null, (error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      const message = (failure as Error).message;
      expect(message).toContain(expect.getState().currentTestName!);
      expect(message).toContain('Host 1 ');
      expect(message).toContain(entered.runId!);
      // Nothing crashed: the run finishes on the live Host and the round answers.
      await world.waitForRequest(submitted.requestRoot, view => view.rounds.some(round =>
        round.ref.queryJobId === submitted.round.queryJobId && round.answer === body), 'the round answers');
    }, 120_000);
});
