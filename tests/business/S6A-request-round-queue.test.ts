/**
 * The open-rounds read beside `unassigned`, and the drain's stop signal, as far
 * as they are provable without the Host's queue wiring.
 *
 * The world is the frozen `openS6ARequestWorld` fixture (memory and SQLite). The
 * read under test is the real `createRequestRoundService` over the world's one
 * records backend (A4: the backend factory is wrapped only to remember that
 * port); the rounds it reads are written by the world's published
 * `requestIntake` (`submit`), the real drain's internal `assigned` append and
 * the real `queries/claim` owner. No record is written by hand and no store is
 * read.
 *
 * The handler's dispatch is proven here too, with the real stage driver over
 * the world's published owners behind one A3 wrapper that records each
 * advance's input and returns the real outcome unchanged: one pass over the
 * records the public steps wrote shows which attempts it moves, and `settle()`
 * waits for the advance it launched. The back-off, `rebuild` and the loop's
 * own scheduling are the Host rows'.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { GoalRecordTransactionPort } from '../../src/core/record-store/ports.js';
import type { RecordLookupPort, RecordOrderedLookupPort } from '../../src/core/record-store/lookup-ports.js';
import { createSessionDutyResolver } from '../../src/composition/session-duty.js';
import {
  createRequestRoundQueues,
} from '../../src/business/workflow/request-round-queue.js';
import {
  createQueryStageDriver, type QueryStageAdvanceInput, type QueryStageDriver,
} from '../../src/business/workflow/query-stage-driver.js';
import { claimWithSecretaryProfile } from '../helpers/request-claim-steps.js';
import {
  createRequestRoundService, type RequestFactsReader, type RequestRoundPort,
} from '../../src/core/work-graph/tasks/request-service.js';
import type { WorkflowHostConfiguration } from '../../src/business/workflow/ports.js';
import {
  openS6ARequestWorld, S6A_GOAL_1, S6A_SCOPE, S6A_SECRETARY_PROFILE_ID, S6A_WORK_ROLE,
  S6A_WORK_ROLE_BINDING, type S6ABackend, type S6ARequestWorld, type S6ASession,
} from '../helpers/S6A-request-fixture.js';
import { AG2B_CONSUMER_ID } from '../helpers/AG2b-collaboration-fixture.js';

// ---------------------------------------------------------------------------
// A4: the two real backend factories, wrapped to remember the records port the
// Host's platform shares; every result passes through unchanged.
// ---------------------------------------------------------------------------
const captured = vi.hoisted(() => ({ records: undefined as unknown }));

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/in-memory-record-store.js')>();
  return {
    ...actual,
    createInMemoryRecordBackend: (options: Parameters<typeof actual.createInMemoryRecordBackend>[0]) => {
      const backend = actual.createInMemoryRecordBackend(options);
      captured.records = backend.records;
      return backend;
    },
  };
});
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/sqlite-record-store.js')>();
  return {
    ...actual,
    createSqliteRecordBackend: (options: Parameters<typeof actual.createSqliteRecordBackend>[0]) => {
      const backend = actual.createSqliteRecordBackend(options);
      captured.records = backend.records;
      return backend;
    },
  };
});

type RealRecords = GoalRecordTransactionPort & RecordLookupPort & RecordOrderedLookupPort;

/** The Host input the real composition supplies to the duty resolver (A8). */
const WORKFLOW: WorkflowHostConfiguration = {
  consumerId: AG2B_CONSUMER_ID,
  bindings: [{ workspace: S6A_SCOPE, sessionRole: S6A_WORK_ROLE, roleBinding: S6A_WORK_ROLE_BINDING,
    budget: { tokenBudget: 1_000_000, deadline: null } }],
};

type SubmitOverride = { goalId?: string | null; continues?: QueryJobRef | null; recipient?: { projectId: string; sessionId: string } | null };

const BACKENDS = ['memory', 'sqlite'] as const;

for (const backend of BACKENDS) {
  describe(`S6A request round queue (${backend})`, () => {
    let world: S6ARequestWorld;
    let sequence = 0;

    beforeEach(async () => {
      captured.records = undefined;
      world = await openS6ARequestWorld({ backend });
    });

    afterEach(async () => {
      await world.close();
    });

    function ctx(): CoreCallContext {
      return world.humanContext();
    }

    /** The real request-round service over the world's one records backend. */
    function roundsOf(): RequestRoundPort {
      if (captured.records === undefined) throw new Error('the world record backend was not captured');
      return createRequestRoundService({
        records: captured.records as RealRecords,
        facts: world.platform.requestFacts,
        sessionFacts: world.platform.sessionFacts,
        profiles: world.platform.secretaryProfiles,
        duty: createSessionDutyResolver({
          readRoleSpec: world.platform.roles.readRoleSpec, configuration: WORKFLOW,
        }),
        now: () => world.clock.now(),
        operationId: () => `s6a-queue-${backend}-${++sequence}`,
      });
    }

    async function submit(commandId: string, text: string, override: SubmitOverride = {}) {
      const result = await world.platform.requestIntake.submitRequest(ctx(), {
        commandId, goalId: S6A_GOAL_1.goalId, text, continues: null, recipient: null, ...override,
      });
      if (result.status !== 'queued') throw new Error(`the submit was refused: ${JSON.stringify(result)}`);
      return result;
    }

    async function viewOf(root: QueryJobRef) {
      const read = await world.platform.requestFacts.readRequest(world.humanContext(), { requestRoot: root });
      if (read.status !== 'ready') throw new Error(`the request view failed: ${JSON.stringify(read)}`);
      return read.value;
    }

    async function factsOf(root: QueryJobRef) {
      const read: Awaited<ReturnType<RequestFactsReader['readFacts']>> =
        await world.platform.requestFacts.readFacts(ctx(), { requestRoot: root });
      if (read.status !== 'ready') throw new Error(`the request facts failed: ${JSON.stringify(read)}`);
      return read.value;
    }

    async function openPage(status: 'pending' | 'running', limit: number, continuation: string | null) {
      const read = await roundsOf().open(ctx(), S6A_SCOPE, { status, limit, continuation });
      if (read.status !== 'ready') throw new Error(`the open read failed: ${JSON.stringify(read)}`);
      return read.value;
    }

    /** Claim the request's round on the Session that owns it, with the published secretary profile. */
    async function claimRound(root: QueryJobRef): Promise<void> {
      const facts = await factsOf(root);
      const round = facts.rounds.find((candidate) => candidate.ref.queryJobId === root.queryJobId) ?? facts.rounds[0]!;
      // The current owner, not the round's original pick: a drained request
      // keeps the pick's assignment on the round and names its owner on the
      // routing round, and the claim takes the owner.
      const assigned = facts.owner;
      if (assigned === null || round.job.runRef === null) throw new Error('the round has no owner to claim on');
      const run = facts.runs.find((candidate) => candidate.ref.runId === round.job.runRef!.runId);
      if (run === undefined) throw new Error('the round has no QueryRun');
      const card = await world.readSession(assigned);
      const published = (await world.readProfiles()).find((candidate) => candidate.id === S6A_SECRETARY_PROFILE_ID);
      if (published === undefined) throw new Error('the secretary profile is not published');
      const profile = { profileId: published.id, sessionRole: published.sessionRole, roleBinding: published.roleBinding,
        runtimeBudget: published.runtimeBudget, budget: published.budget, consumerId: published.consumerId };
      const claimed = await world.platform.queries.claimQuery(ctx(), {
        input: { queryRunRef: round.job.runRef, sessionRef: assigned, profile },
        meta: { requestId: `s6a-queue-claim-${round.ref.queryJobId}`, expected: [
          { ref: round.ref, revision: round.revision },
          { ref: round.job.runRef, revision: run.revision },
          { ref: card.record.ref, revision: card.record.revision },
        ] },
      });
      if (claimed.status !== 'committed') throw new Error(`the claim failed: ${JSON.stringify(claimed)}`);
    }

    it('yields a request once when it has two open rounds', async () => {
      const secretary: S6ASession = await world.createSecretary('secretary-a');
      const root = await submit('s6a-queue-once', 'the first round', { recipient: secretary.ref });
      const followUp = await submit('s6a-queue-once-2', 'the follow-up round',
        { goalId: null, continues: root.round });
      expect(followUp.assignment).toBe('assigned');

      const page = await openPage('pending', 10, null);
      expect(page.requests).toEqual([root.requestRoot]);
      expect(page.wrapped).toBe(true);
      expect(page.continuation).toBeNull();
    });

    it('pages by its continuation and ends wrapped', async () => {
      const first = await world.createSecretary('secretary-a');
      const second = await world.createSecretary('secretary-b');
      const requestA = await submit('s6a-queue-page-a', 'request A', { recipient: first.ref });
      const requestQ = await submit('s6a-queue-page-q', 'request Q', { recipient: second.ref });

      const page1 = await openPage('pending', 1, null);
      expect(page1.requests).toEqual([requestA.requestRoot]);
      expect(page1.wrapped).toBe(false);
      expect(page1.continuation).not.toBeNull();

      const page2 = await openPage('pending', 1, page1.continuation);
      expect(page2.requests).toEqual([requestQ.requestRoot]);
      expect(page2.wrapped).toBe(false);
      expect(page2.continuation).not.toBeNull();

      // The page that stopped at its limit cannot know it was the last one;
      // the following page is empty and is the one that wraps.
      const page3 = await openPage('pending', 1, page2.continuation);
      expect(page3.requests).toEqual([]);
      expect(page3.wrapped).toBe(true);
      expect(page3.continuation).toBeNull();
    });

    it('a claimed attempt keeps its open round in the pending partition', async () => {
      const first = await world.createSecretary('secretary-a');
      const spare = await world.createSecretary('secretary-b');
      const root = await submit('s6a-queue-claimed', 'the claimed request', { recipient: first.ref });
      await world.archive(first);
      const drained = await world.platform.requestIntake.drainUnassigned(world.systemContext(), S6A_SCOPE,
        { maxRequests: 10, continuation: null });
      if (drained.status !== 'ready') throw new Error(`the drain failed: ${JSON.stringify(drained)}`);
      expect(drained.value).toMatchObject({ progressed: 1, blocked: 0 });
      expect((await viewOf(root.requestRoot)).owner).toEqual(spare.ref);
      await claimRound(root.requestRoot);

      // The claim moves the attempt's phase, not the Job's status: the open
      // round of a claimed attempt is still the pending partition's entry, and
      // only a begun attempt reaches `running`.
      const pending = await openPage('pending', 10, null);
      expect(pending.requests).toEqual([root.requestRoot]);
      expect(pending.wrapped).toBe(true);
      const running = await openPage('running', 10, null);
      expect(running.requests).toEqual([]);
      expect(running.wrapped).toBe(true);
    });

    /**
     * The real stage driver over the world's published owners behind one A3
     * wrapper: it records each advance's input, calls the real `advance` and
     * returns its outcome unchanged.
     */
    function forwardingDriver(): { driver: QueryStageDriver; calls: QueryStageAdvanceInput[] } {
      const calls: QueryStageAdvanceInput[] = [];
      return {
        calls,
        driver: {
          advance(advanceCtx: CoreCallContext, input: QueryStageAdvanceInput) {
            calls.push(structuredClone(input));
            return createQueryStageDriver({
              queries: world.platform.queries, runtime: world.platform.runtime, facts: world.platform.requestFacts,
            }).advance(advanceCtx, input);
          },
        },
      };
    }

    /** The two real queue handlers over this world's published owners, with the forwarding driver. */
    function queues(driver: QueryStageDriver) {
      return createRequestRoundQueues({
        rounds: roundsOf(),
        facts: world.platform.requestFacts,
        sessions: world.platform.sessionFacts,
        profiles: world.platform.secretaryProfiles,
        drain: world.platform.requestIntake.drainUnassigned,
        driver,
        context: (scope, signal) => ({ ...world.systemContext(), signal }),
        wake: () => undefined,
      });
    }

    const PASS = { maxItems: 1, continuation: null, signal: new AbortController().signal };

    it('advances a live attempt on its own Session and opens no second attempt for the same request',
      async () => {
        const first = await world.createSecretary('secretary-a');
        const second = await world.createSecretary('secretary-b');
        const submitted = await submit('s6a-pass-live-1', 'the live round', { recipient: first.ref });
        // The claim gives the request one live attempt, on A.
        expect(await claimWithSecretaryProfile(world, submitted.round, first, 's6a-pass-live-claim'))
          .toMatchObject({ status: 'committed' });
        // The request moves to B, and its next round waits on the new owner.
        expect(await world.platform.requestIntake.route(ctx(), {
          commandId: 's6a-pass-live-route', round: submitted.round, to: second.ref, reason: 'manual',
        })).toMatchObject({ status: 'routed' });
        const followUp = await submit('s6a-pass-live-2', 'the next round', { goalId: null, continues: submitted.round });
        const facts = await factsOf(submitted.requestRoot);
        expect(facts.owner).toEqual(second.ref);
        // The claim keeps the Job pending (the phase carries the attempt), and the
        // route appended its own closed routing round between the two inputs.
        expect(facts.rounds.map(round => round.job.status)).toEqual(['pending', 'closed', 'pending']);

        const forwarding = forwardingDriver();
        const handlers = queues(forwarding.driver);
        const pass = await handlers.rounds.drain(S6A_SCOPE, PASS);
        await handlers.settle();
        // The live attempt moves, on its own Session; B's fresh round waits until
        // the request has no live attempt, so the request is never run twice.
        expect(forwarding.calls.map(call => call.queryJobRef)).toEqual([submitted.round]);
        expect(forwarding.calls[0]?.profile).toBeNull();
        expect(pass.blocked).toBe(0);
        expect(followUp.round).not.toEqual(submitted.round);
      });

    it('refuses a continuation whose carried work is not complete refs and a commit cursor', async () => {
      const first = await world.createSecretary('secretary-a');
      const submitted = await submit('s6a-pass-decode', 'the carried request', { recipient: first.ref });
      const round = (await factsOf(submitted.requestRoot)).rounds[0]!;
      const carried = { requestRoot: submitted.requestRoot, round: round.ref, run: round.job.runRef!,
        session: first.ref, since: round.since };
      // A traversal that has read both partitions, carrying work into the next pass.
      const continuationOf = (attempts: unknown[], candidates: unknown[] = []): string => JSON.stringify({
        version: 1, cursors: { pending: null, running: null }, done: { pending: true, running: true },
        attempts, candidates,
      });
      const forwarding = forwardingDriver();
      const handlers = queues(forwarding.driver);

      // The complete entry is read: its request has no live attempt now, so the
      // pass starts nothing and wraps.
      expect(await handlers.rounds.drain(S6A_SCOPE, { ...PASS, continuation: continuationOf([carried]) }))
        .toMatchObject({ progressed: 0, more: false, wrapped: true, blocked: 0 });

      // The continuation is the queue's own frozen value: an entry that is not
      // complete refs of the right kinds and a commit cursor is an invariant
      // break, never work to launch.
      const broken: [string, unknown[], unknown[]][] = [
        ['an empty since', [{ ...carried, since: '' }], []],
        ['a since that is not a commit cursor', [{ ...carried, since: 'c1' }], []],
        ['an empty request root', [{ ...carried, requestRoot: {} }], []],
        ['a round that is a QueryRun', [{ ...carried, round: carried.run }], []],
        ['a run that is a QueryJob', [{ ...carried, run: carried.round }], []],
        ['a run without its id', [{ ...carried, run: { ...carried.run, runId: '' } }], []],
        ['a Session without its id', [{ ...carried, session: { projectId: first.ref.projectId } }], []],
        ['a Session with another field', [{ ...carried, session: { ...first.ref, label: 'a' } }], []],
        ['a carried round with an empty since', [], [{ ...carried, since: '' }]],
      ];
      for (const [what, attempts, candidates] of broken) {
        await expect(handlers.rounds.drain(S6A_SCOPE, { ...PASS, continuation: continuationOf(attempts, candidates) }),
          what).rejects.toThrow('the request-round continuation is not readable');
      }
      expect(forwarding.calls).toEqual([]);
      await handlers.settle();
    });

    it('a drain whose signal is already aborted assigns nothing', async () => {
      const first = await world.createSecretary('secretary-a');
      await world.createSecretary('secretary-b');
      const root = await submit('s6a-queue-abort', 'the waiting request', { recipient: first.ref });
      await world.archive(first);
      expect((await viewOf(root.requestRoot)).ownerState).toBe('owner_archived');

      const controller = new AbortController();
      controller.abort();
      const aborted: CoreCallContext = { ...world.systemContext(), signal: controller.signal };
      const drained = await world.platform.requestIntake.drainUnassigned(aborted, S6A_SCOPE,
        { maxRequests: 10, continuation: null });
      expect(drained).toEqual({ status: 'ready', value: {
        progressed: 0, more: false, continuation: null, wrapped: true, blocked: 0,
      } });

      const after = await viewOf(root.requestRoot);
      expect(after.ownerState).toBe('owner_archived');
      expect(after.rounds).toHaveLength(1);
    });
  });
}
