/**
 * Two of the stage driver's outcomes, through the real driver.
 *
 * - An observation that finds the attempt's records unchanged is not progress.
 *   `advance` on an entered attempt whose model request has not been answered
 *   answers `blocked` on a change ("the attempt has not changed"), so a queue
 *   that launched it parks instead of waking itself; once the request is
 *   answered the round has its answer and `advance` answers `terminal`.
 * - A fixed capacity limit waits for a change. A request whose rounds are too
 *   long together for one prepared Query manifest: the claim commits, the
 *   preparation refuses `capacity`, and `advance` answers `blocked` on a change,
 *   not a back-off, because the same call cannot succeed until the input or the
 *   configuration changes.
 *
 * The driver is the real `createQueryStageDriver` over the world's published
 * Query owner, Runtime and request facts, called directly. The world is the
 * SE2 Host world with the request driver OFF: the attempt is placed by the
 * public Query routes (claim, prepare, start) and its first model request is
 * held by the world's model hold, so the Kernel has entered and nothing moves
 * until the row releases it; the long request is made by public submits.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PreparedQueryExecution } from '../../src/contracts/core/prepared-execution.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { RequestSubmitResultV1 } from '../../src/business/workflow/request-intake.js';
import { createQueryStageDriver } from '../../src/business/workflow/query-stage-driver.js';
import type { SecretaryProfileV1 } from '../../src/core/work-graph/model/request-contracts.js';
import { readQuery } from '../helpers/A2-restart-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { claimProfile, claimWithSecretaryProfile } from '../helpers/request-claim-steps.js';
import { ensureProjectPointers, openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import {
  S6A_GOAL_1, S6A_SCOPE, S6A_SECRETARY_PROFILE_ID, type S6ABackend,
} from '../helpers/S6A-request-fixture.js';

// The frozen commit barrier (tests/helpers/S6A-commit-barrier.ts): the two
// `vi.mock`s every host-world file installs, so a gate left open is reported.
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S6AHostWorld[] = [];

afterEach(async () => {
  const left = commitBarrier.reset();
  const open = worlds.splice(0);
  await Promise.allSettled(open.map(world => world.close()));
  expect(left).toEqual([]);
});

function queued(result: RequestSubmitResultV1): { requestRoot: QueryJobRef; round: QueryJobRef } {
  if (result.status !== 'queued') throw new Error(`S6A: the request was not queued: ${JSON.stringify(result)}`);
  return { requestRoot: result.requestRoot, round: result.round };
}

const body = (input: unknown): { scope: typeof S6A_SCOPE; input: unknown } => ({ scope: S6A_SCOPE, input });

/** A semantic answer body: the v1 answer format's JSON, as the scripted model writes it. */
const answerText = (text: string): string =>
  JSON.stringify({ schemaVersion: 1, body: text, ideas: [], goalCardDrafts: [] });

/** The `queries/prepare` step of the claimed round. */
async function prepareStep(world: S6AHostWorld, round: QueryJobRef): Promise<PreparedQueryExecution> {
  const read = (await world.post('queries/prepare', body({
    queryRunRef: (await readQuery(world.ag2b, round)).run.ref, requestId: `s6a-observe-prepare-${round.queryJobId}`,
  }))).body as ReadResult<PreparedQueryExecution>;
  if (read.status !== 'ready') throw new Error(`S6A: the Query was not prepared: ${JSON.stringify(read)}`);
  return read.value;
}

describe.each(['memory', 'sqlite'] as const)('the stage driver outcomes (%s)',
  (backend: S6ABackend) => {
    it('answers blocked on a change while the entered attempt has not moved, and terminal once it answered',
      async () => {
        const world = await openS6AHostWorld({ backend });
        worlds.push(world);
        await ensureProjectPointers(world);
        const a = await world.createSecretary('a');
        await world.scripted.script(a, [{ kind: 'text', text: answerText('S6A observed answer') }]);
        const submitted = queued(await world.submit({ commandId: 's6a-observe-1', goalId: S6A_GOAL_1.goalId,
          text: 'S6A observed round' }));

        // Claim, prepare and start through the routes; the first model request is
        // held, so the attempt has entered the Kernel and waits for its reply.
        expect(await claimWithSecretaryProfile(world, submitted.round, a, 's6a-observe-claim'))
          .toMatchObject({ status: 'committed' });
        const prepared = await prepareStep(world, submitted.round);
        const held = await world.gates.modelRequest(a);
        const starting = world.post('queries/start', body({ prepared, consumerId: 'ag2b-consumer',
          requestId: 's6a-observe-start' })).then(answer => answer.body);
        await held.reached;
        const run = (await readQuery(world.ag2b, submitted.round)).run;
        expect(run.run.executionState?.phase).toBe('entered');

        const driver = createQueryStageDriver({
          queries: world.platform.queries, runtime: world.platform.runtime, facts: world.platform.requestFacts,
        });
        const input = { queryJobRef: submitted.round, expectedRunRef: run.ref, profile: null };
        // Nothing moved since the advance read the attempt: not progress. The held
        // request has not been served, so its reply is still the Session's.
        expect(await driver.advance(world.systemContext(), input)).toEqual({
          status: 'blocked', retry: 'on_change', reason: 'the attempt has not changed',
        });
        expect(await world.scripted.pending(a)).toBe(1);

        // The reply goes on: the round has its answer, and the attempt is over.
        held.release();
        expect(await starting).toMatchObject({ status: 'ready' });
        expect(await world.scripted.requests(a)).toHaveLength(1);
        const view = await world.readRequest(submitted.requestRoot);
        expect(view.rounds).toHaveLength(1);
        expect(view.rounds[0]).toMatchObject({ ref: submitted.round, status: 'ended',
          answer: 'S6A observed answer', session: a.ref });
        expect(await driver.advance(world.systemContext(), input)).toEqual({ status: 'terminal' });
      }, 60_000);

    it('answers blocked on a change when the preparation is over the manifest capacity', async () => {
      const world = await openS6AHostWorld({ backend });
      worlds.push(world);
      await ensureProjectPointers(world);
      const a = await world.createSecretary('a');
      // Seventeen rounds of one request, each text 16,000 bytes (a request text may
      // have 16 KiB): the batch the preparation renders holds 17 × 16,000 = 272,000
      // bytes of round text, more than the 256 KiB (262,144 bytes) a prepared Query
      // manifest may hold.
      const textOf = (index: number): string => {
        const head = `S6A capacity round ${String(index).padStart(2, '0')} `;
        return head + 'x'.repeat(16_000 - head.length);
      };
      const root = queued(await world.submit({ commandId: 's6a-capacity-0', goalId: S6A_GOAL_1.goalId,
        text: textOf(0), recipient: a }));
      for (let index = 1; index <= 16; index += 1) {
        queued(await world.submit({ commandId: `s6a-capacity-${index}`, goalId: null, text: textOf(index),
          continues: root.round }));
      }
      const runRef = (await readQuery(world.ag2b, root.round)).run.ref;
      const profile = await claimProfile(world, S6A_SECRETARY_PROFILE_ID) as unknown as SecretaryProfileV1;

      const driver = createQueryStageDriver({
        queries: world.platform.queries, runtime: world.platform.runtime, facts: world.platform.requestFacts,
      });
      // The claim commits and the preparation refuses `capacity`: a fixed limit
      // that waits for a change (fewer or shorter rounds, another configuration).
      const outcome = await driver.advance(world.systemContext(),
        { queryJobRef: root.round, expectedRunRef: runRef, profile });
      expect(outcome).toMatchObject({ status: 'blocked', retry: 'on_change' });
      expect(outcome.status === 'blocked' ? outcome.reason : null).toContain('capacity');
      expect((await readQuery(world.ag2b, root.round)).run.run.executionState?.phase).toBe('claimed');
      expect(await world.scripted.requests(a)).toHaveLength(0);
    }, 60_000);
  });
