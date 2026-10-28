/**
 * The request-round service, exercised through the real Host: the person's
 * commands go through the Host-wired `RequestIntakePort` (Workflow), the
 * drain's `assigned` path through the real Workflow drain, and `end_unbound`,
 * which has no public producer, through the platform's real `RequestRoundPort`
 * (`platform.requestRounds`), whose profiles, Session facts and duty resolver
 * are the Host's own.
 *
 * The world is the frozen `openS6ARequestWorld` fixture (memory and SQLite).
 * Wrappers around the real record port only count calls, gate a commit or fail
 * a real dependency once (the frozen commit barrier; a commit whose answer is
 * lost; a facts read that fails once); every result passes through unchanged.
 * No test reads a captured commit, record or claim: the assertions are public
 * request facts, public Session cards, the Query reads, the next real
 * delivery's accept/refuse, and how many store calls one public call made.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { VersionedRef } from '../../src/contracts/ledger.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import { sameJson } from '../../src/contracts/fingerprint.js';
import {
  openS6ARequestWorld, S6A_GOAL_1, S6A_GOAL_2, S6A_SCOPE, S6A_SECRETARY_PROFILE_ID, type S6ARequestWorld, type S6ASession,
} from '../helpers/S6A-request-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { post } from '../helpers/A2-restart-fixture.js';

// ---------------------------------------------------------------------------
// A2 failures at named points: a lost commit answer and a failing facts read.
// The backend wrapper sits on top of the frozen barrier (the same real record
// port); the facts wrapper delegates every other call to the real reader.
// ---------------------------------------------------------------------------
const faults = vi.hoisted(() => ({
  loseCommit: false,
  lost: false,
  failRecoveryLookup: false,
  failFactsFor: null as string | null,
}));

/**
 * A3: every call into the record port, counted; `commit` apart from every read.
 * `committed` counts only the commits the store answered `committed`: a commit
 * the store refuses (a held claim, a moved guard) writes nothing.
 */
const calls = vi.hoisted(() => ({ commits: 0, reads: 0, committed: 0 }));

function withFaults<T>(backend: T): T {
  const records = (backend as unknown as { records: Record<string, unknown> }).records;
  const commit = records['commit'] as (input: unknown) => Promise<unknown>;
  const lookupCommit = records['lookupCommit'] as
    (input: { identityKey: string; fingerprint: string }) => Promise<unknown>;
  return {
    ...backend,
    records: {
      ...records,
      commit: (input: unknown) => {
        if (faults.loseCommit && !faults.lost) {
          return (async () => {
            await commit(input);
            faults.lost = true;
            throw new Error('the commit answer was lost after the write');
          })();
        }
        return commit(input);
      },
      lookupCommit: (input: { identityKey: string; fingerprint: string }) => {
        if (faults.lost && faults.failRecoveryLookup) {
          return Promise.reject(new Error('the recovery lookup failed'));
        }
        return lookupCommit(input);
      },
    },
  } as T;
}

/**
 * A3: counts each call the platform makes into its record port, then calls the
 * real method and returns its result unchanged; a commit's answer is only looked
 * at to count it as committed. Both backends build `records` from closures
 * without `this`, so each method can be called on its own.
 */
function withCounts<T>(backend: T): T {
  const records = (backend as unknown as { records: Record<string, unknown> }).records;
  const counted: Record<string, unknown> = {};
  for (const [name, member] of Object.entries(records)) {
    if (typeof member !== 'function') {
      counted[name] = member;
      continue;
    }
    const real = member as (...args: unknown[]) => unknown;
    counted[name] = (...args: unknown[]) => {
      if (name !== 'commit') {
        calls.reads += 1;
        return real(...args);
      }
      calls.commits += 1;
      return Promise.resolve(real(...args)).then((answer) => {
        if ((answer as { status?: unknown } | null)?.status === 'committed') calls.committed += 1;
        return answer;
      });
    };
  }
  return { ...backend, records: counted } as T;
}

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) => {
  const barrier = await import('../helpers/S6A-commit-barrier.js');
  const actual = await barrier.inMemoryBarrierModule(importOriginal);
  return {
    ...actual,
    createInMemoryRecordBackend: (options: Parameters<typeof actual.createInMemoryRecordBackend>[0]) =>
      withCounts(withFaults(actual.createInMemoryRecordBackend(options))),
  };
});
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) => {
  const barrier = await import('../helpers/S6A-commit-barrier.js');
  const actual = await barrier.sqliteBarrierModule(importOriginal);
  return {
    ...actual,
    createSqliteRecordBackend: (options: Parameters<typeof actual.createSqliteRecordBackend>[0]) =>
      withCounts(withFaults(actual.createSqliteRecordBackend(options))),
  };
});
vi.mock('../../src/core/work-graph/tasks/request-facts.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/work-graph/tasks/request-facts.js')>();
  return {
    ...actual,
    createRequestFacts: (deps: Parameters<typeof actual.createRequestFacts>[0]) => {
      const real = actual.createRequestFacts(deps);
      return {
        ...real,
        async readFacts(ctx: CoreCallContext, input: { requestRoot: QueryJobRef }) {
          if (faults.failFactsFor !== null && input.requestRoot.queryJobId === faults.failFactsFor) {
            return { status: 'rejected' as const, code: 'unavailable' as const, reason: 'injected facts read failure' };
          }
          return real.readFacts(ctx, input);
        },
      };
    },
  };
});

// ---------------------------------------------------------------------------
// Helpers over public steps
// ---------------------------------------------------------------------------
type SubmitOverride = {
  goalId?: string | null;
  continues?: QueryJobRef | null;
  recipient?: SessionRef | null;
};

function submitInput(commandId: string, text: string, override: SubmitOverride = {}) {
  return { commandId, goalId: S6A_GOAL_1.goalId, text, continues: null, recipient: null, ...override };
}

type StoreCalls = { commits: number; reads: number };

function storeCalls(): StoreCalls {
  return { commits: calls.commits, reads: calls.reads };
}

/** The store calls made since `before`: the window is one public call, with nothing else running. */
function callsSince(before: StoreCalls): StoreCalls {
  return { commits: calls.commits - before.commits, reads: calls.reads - before.reads };
}

/** The commits the store answered `committed` since `before` (a `calls.committed` value). */
function committedSince(before: number): number {
  return calls.committed - before;
}

const BACKENDS = ['memory', 'sqlite'] as const;

for (const backend of BACKENDS) {
  describe(`S6A request rounds through the real Host (${backend})`, () => {
    let world: S6ARequestWorld;
    /** Worlds a row opens besides `world` (a Host with an open-secretary cap). */
    let extraWorlds: S6ARequestWorld[] = [];

    beforeEach(async () => {
      faults.loseCommit = false;
      faults.lost = false;
      faults.failRecoveryLookup = false;
      faults.failFactsFor = null;
      extraWorlds = [];
      world = await openS6ARequestWorld({ backend });
    });

    afterEach(async () => {
      const left = commitBarrier.reset();
      faults.loseCommit = false;
      faults.lost = false;
      faults.failRecoveryLookup = false;
      faults.failFactsFor = null;
      for (const extra of extraWorlds.splice(0)) await extra.close();
      await world.close();
      expect(left).toEqual([]);
    });

    const ctx = (): CoreCallContext => world.humanContext();
    const system = (): CoreCallContext => world.systemContext();

    async function submit(commandId: string, text: string, override: SubmitOverride = {}) {
      return world.platform.requestIntake.submitRequest(ctx(), submitInput(commandId, text, override));
    }

    async function viewOf(root: QueryJobRef, target: S6ARequestWorld = world) {
      const read = await target.platform.requestFacts.readRequest(target.humanContext(), { requestRoot: root });
      if (read.status !== 'ready') throw new Error(`the request read failed: ${JSON.stringify(read)}`);
      return read.value;
    }

    async function factsOf(root: QueryJobRef) {
      const read = await world.platform.requestFacts.readFacts(ctx(), { requestRoot: root });
      if (read.status !== 'ready') throw new Error(`the request facts failed: ${JSON.stringify(read)}`);
      return read.value;
    }

    /** The Session whose intake a round holds, as the request facts record it. */
    async function intakeOf(root: QueryJobRef, round: QueryJobRef): Promise<SessionRef | null> {
      const facts = await factsOf(root);
      const found = facts.rounds.find((candidate) => sameJson(candidate.ref, round));
      if (found === undefined) throw new Error('the round is not in its request');
      return found.job.intakeSession;
    }

    /** Claim the request's oldest round on its secretary through the real Query owner, with the published
     * secretary profile (a request-round claim carries one; the bootstrap's `id` is its `profileId`). */
    async function claimRound(root: QueryJobRef) {
      const facts = await factsOf(root);
      const round = facts.rounds.find((candidate) => sameJson(candidate.ref, root)) ?? facts.rounds[0]!;
      const assigned = round.job.assignedSession;
      if (assigned === null || round.job.runRef === null) throw new Error('the round has no assigned attempt');
      const run = facts.runs.find((candidate) => sameJson(candidate.ref, round.job.runRef));
      if (run === undefined) throw new Error('the round has no QueryRun');
      const card = await world.readSession(assigned);
      const published = (await world.readProfiles()).find(candidate => candidate.id === S6A_SECRETARY_PROFILE_ID);
      if (published === undefined) throw new Error('the secretary profile is not published');
      const profile = { profileId: published.id, sessionRole: published.sessionRole, roleBinding: published.roleBinding,
        runtimeBudget: published.runtimeBudget, budget: published.budget, consumerId: published.consumerId };
      const claimed = await world.platform.queries.claimQuery(ctx(), {
        input: { queryRunRef: round.job.runRef, sessionRef: assigned, profile },
        meta: { requestId: `claim-${round.ref.queryJobId}`, expected: [
          { ref: round.ref, revision: round.revision },
          { ref: round.job.runRef, revision: run.revision },
          { ref: card.record.ref, revision: card.record.revision },
        ] },
      });
      if (claimed.status !== 'committed') throw new Error(`the claim failed: ${JSON.stringify(claimed)}`);
      return { round, run, claimed: claimed.value };
    }

    async function occupied(session: S6ASession): Promise<boolean> {
      const card = await world.readSession(session);
      return card.record.occupancy !== null;
    }

    /** `sessions/reactivate` on an archived line, through the Host's HTTP route. */
    async function reactivate(session: S6ASession): Promise<void> {
      const card = await world.readSession(session);
      const result = await post<Record<string, unknown>>(world.ag2b, 'sessions/reactivate', graphWrite(S6A_SCOPE,
        { sessionRef: session.ref, reason: 'S6A reactivate' }, `s6a-reactivate-${session.label}-${card.record.revision}`,
        [{ ref: card.record.ref, revision: card.record.revision }]));
      if (result['status'] !== 'committed') throw new Error(`the reactivation failed: ${JSON.stringify(result)}`);
    }

    /**
     * A request that waits: a second Host capped at one open secretary, whose
     * only secretary is busy with a claimed Query, so the pick finds no
     * candidate and the new line is refused by the cap.
     */
    async function waitingRequest(commandId: string) {
      const capped = await openS6ARequestWorld({ backend, extraHostOptions: { secretaryOpenCap: 1 } });
      extraWorlds.push(capped);
      const busy = await capped.createSecretary('busy-secretary');
      await capped.occupy(busy);
      const submitted = await capped.platform.requestIntake.submitRequest(capped.humanContext(),
        submitInput(commandId, 'a request that waits'));
      expect(submitted).toMatchObject({
        status: 'queued', assignment: 'unassigned', secretary: null, created: false, waitReason: 'secretary_open_cap',
      });
      if (submitted.status !== 'queued') throw new Error('unreachable');
      expect(submitted.requestRoot).toEqual(submitted.round);
      expect((await viewOf(submitted.requestRoot, capped)).ownerState).toBe('waiting');
      return { capped, submitted };
    }

    // ---------------------------------------------------------------------
    // A submit goes through the Host-wired Workflow and its real secretary
    // profile port; the receipt and the public facts are the result.
    // ---------------------------------------------------------------------
    it('submit picks the Host secretary and records the request publicly', async () => {
      const secretary = await world.createSecretary('secretary-1');
      const result = await submit('s6a-submit-1', 'the first request');
      expect(result).toMatchObject({
        status: 'queued', assignment: 'assigned', secretary: secretary.ref, created: false, waitReason: null,
      });
      if (result.status !== 'queued') throw new Error('the submit did not queue');
      expect(result.requestRoot).toEqual(result.round);

      const view = await viewOf(result.requestRoot);
      expect(view.owner).toEqual(secretary.ref);
      expect(view.ownerState).toBe('owned');
      expect(view.rounds).toHaveLength(1);
      expect(view.rounds[0]).toMatchObject({ kind: 'request', status: 'queued', assignedSession: secretary.ref,
        closeCode: null });
    });

    // ---------------------------------------------------------------------
    // Replay: the stored receipt answers, and nothing is committed again.
    // ---------------------------------------------------------------------
    it('replays a committed submit from the stored receipt and writes no second round', async () => {
      await world.createSecretary('secretary-1');
      const input = submitInput('s6a-replay-1', 'replay me');
      const first = await world.platform.requestIntake.submitRequest(ctx(), input);
      if (first.status !== 'queued') throw new Error(`the first submit failed: ${JSON.stringify(first)}`);

      const before = storeCalls();
      const replay = await world.platform.requestIntake.submitRequest(ctx(), input);
      expect(replay).toEqual(first);
      expect(callsSince(before).commits).toBe(0);
      const view = await viewOf(first.requestRoot);
      expect(view.rounds).toHaveLength(1);
    });

    // ---------------------------------------------------------------------
    // A drop ends a claimed round and releases the Session occupancy.
    // ---------------------------------------------------------------------
    it('a drop ends a claimed round and releases its Session occupancy', async () => {
      const secretary = await world.createSecretary('secretary-1');
      const submitted = await submit('s6a-drop-claimed', 'drop a claimed attempt', { recipient: secretary.ref });
      if (submitted.status !== 'queued') throw new Error(`the submit failed: ${JSON.stringify(submitted)}`);
      const claimed = await claimRound(submitted.round);
      expect(await occupied(secretary)).toBe(true);
      expect(claimed.claimed.run.run.executionState?.phase).toBe('claimed');

      const dropped = await world.platform.requestIntake.route(ctx(), {
        commandId: 's6a-drop-claimed-route', round: submitted.round, to: null, reason: 'dropped',
      });
      expect(dropped).toMatchObject({ status: 'routed' });

      const view = await viewOf(submitted.requestRoot);
      expect(view.ownerState).toBe('dropped');
      expect(view.rounds[0]).toMatchObject({ status: 'ended', closeCode: 'cancelled', closeDetail: 'dropped' });
      expect(await occupied(secretary)).toBe(false);
    });

    // ---------------------------------------------------------------------
    // A drop releases the intake; the next real delivery is accepted.
    // ---------------------------------------------------------------------
    it('a drop releases the intake and the next delivery to the secretary is assigned', async () => {
      const secretary = await world.createSecretary('secretary-1');
      const first = await submit('s6a-drop-intake-1', 'the first request', { recipient: secretary.ref });
      if (first.status !== 'queued') throw new Error('the first submit failed');
      const dropped = await world.platform.requestIntake.route(ctx(), {
        commandId: 's6a-drop-intake-route', round: first.round, to: null, reason: 'dropped',
      });
      expect(dropped).toMatchObject({ status: 'routed' });

      const next = await submit('s6a-drop-intake-2', 'the next request', { recipient: secretary.ref });
      expect(next).toMatchObject({ status: 'queued', assignment: 'assigned', secretary: secretary.ref });
    });

    // ---------------------------------------------------------------------
    // A drop and end_unbound end a round that waits (no secretary, no
    // attempt claimed): the round itself ends `cancelled`, nothing else.
    // ---------------------------------------------------------------------
    it('end_unbound ends a waiting round cancelled/no_binding in one commit and adds no round', async () => {
      const { capped, submitted } = await waitingRequest('s6a-wait-end');

      const before = storeCalls();
      const ended = await capped.platform.requestRounds.append(capped.systemContext(), {
        command: { kind: 'end_unbound', operationId: 's6a-wait-end-op', round: submitted.round },
      });
      expect(ended).toEqual({ status: 'ended', round: submitted.round, replayed: false });
      expect(callsSince(before).commits).toBe(1);

      const view = await viewOf(submitted.requestRoot, capped);
      expect(view.rounds).toHaveLength(1);
      expect(view.rounds[0]!.ref).toEqual(submitted.round);
      expect(view.rounds[0]!.status).toBe('ended');
      expect(view.rounds[0]!.closeCode).toBe('cancelled');
      expect(view.rounds[0]!.closeDetail).toBe('no_binding');
    });

    it('a drop ends a waiting round cancelled/dropped and records the routing round', async () => {
      const { capped, submitted } = await waitingRequest('s6a-wait-drop');

      const before = storeCalls();
      const dropped = await capped.platform.requestIntake.route(capped.humanContext(), {
        commandId: 's6a-wait-drop-route', round: submitted.round, to: null, reason: 'dropped',
      });
      expect(dropped.status).toBe('routed');
      if (dropped.status !== 'routed') throw new Error('unreachable');
      expect(callsSince(before).commits).toBe(1);

      const view = await viewOf(submitted.requestRoot, capped);
      expect(view.owner).toBeNull();
      expect(view.ownerState).toBe('dropped');
      expect(view.rounds).toHaveLength(2);
      expect(view.rounds[0]!.ref).toEqual(submitted.round);
      expect(view.rounds[0]!.status).toBe('ended');
      expect(view.rounds[0]!.closeCode).toBe('cancelled');
      expect(view.rounds[0]!.closeDetail).toBe('dropped');
      expect(view.rounds[1]!.ref).toEqual(dropped.routingRound);
      expect(view.rounds[1]!.kind).toBe('routing');
    });

    // ---------------------------------------------------------------------
    // end_unbound on a claimed round releases the occupancy its claim holds,
    // and the Run it writes is settled.
    // ---------------------------------------------------------------------
    it('end_unbound ends a claimed round, releases occupancy and records the settled Run', async () => {
      const secretary = await world.createSecretary('secretary-1');
      const submitted = await submit('s6a-end-claimed', 'end a claimed attempt', { recipient: secretary.ref });
      if (submitted.status !== 'queued') throw new Error(`the submit failed: ${JSON.stringify(submitted)}`);
      const claimed = await claimRound(submitted.round);
      expect(await occupied(secretary)).toBe(true);

      const ended = await world.platform.requestRounds.append(system(), {
        command: { kind: 'end_unbound', operationId: 's6a-end-claimed-op', round: submitted.round },
      });
      expect(ended).toEqual({ status: 'ended', round: submitted.round, replayed: false });
      expect(await occupied(secretary)).toBe(false);

      const facts = await factsOf(submitted.requestRoot);
      const endedRun = facts.runs.find((candidate) => sameJson(candidate.ref, claimed.run.ref));
      if (endedRun === undefined) throw new Error('the ended QueryRun is not readable');
      expect(endedRun.run).toMatchObject({ status: 'closed', outcome: 'not_entered' });
      expect(endedRun.run.executionState?.phase).toBe('settled');

      const replay = await world.platform.requestRounds.append(system(), {
        command: { kind: 'end_unbound', operationId: 's6a-end-claimed-op', round: submitted.round },
      });
      expect(replay).toEqual({ status: 'ended', round: submitted.round, replayed: true });
    });

    // ---------------------------------------------------------------------
    // A follow-up to a request whose owner is archived is a fresh pick: the
    // new round records the picked secretary's intake it takes.
    // ---------------------------------------------------------------------
    it('a follow-up with a new pick holds the picked secretary intake on the new round', async () => {
      const first = await world.createSecretary('secretary-1');
      const second = await world.createSecretary('secretary-2');
      const root = await submit('s6a-followup-pick', 'the root', { recipient: first.ref });
      if (root.status !== 'queued') throw new Error('the root submit failed');
      await world.archive(first);

      const followup = await submit('s6a-followup-pick-next', 'ask again', { goalId: null, continues: root.round });
      expect(followup).toMatchObject({
        status: 'queued', requestRoot: root.requestRoot, assignment: 'assigned', secretary: second.ref,
      });
      if (followup.status !== 'queued') throw new Error('unreachable');
      const afterPick = await viewOf(root.requestRoot);
      expect(afterPick.owner).toEqual(second.ref);
      expect(afterPick.rounds).toHaveLength(2);
      expect(afterPick.rounds[1]).toMatchObject({ ref: followup.round, kind: 'followup', status: 'queued',
        assignedSession: second.ref });
      expect(await intakeOf(root.requestRoot, followup.round)).toEqual(second.ref);

      // The new round records the holder, so ending it releases the key: the
      // next `@ second` delivery is accepted instead of wrongly busy.
      const dropped = await world.platform.requestIntake.route(ctx(), {
        commandId: 's6a-followup-pick-drop', round: root.round, to: null, reason: 'dropped',
      });
      expect(dropped).toMatchObject({ status: 'routed' });
      const next = await submit('s6a-followup-pick-later', 'a later request', { recipient: second.ref });
      expect(next).toMatchObject({ status: 'queued', assignment: 'assigned', secretary: second.ref });
    });

    // ---------------------------------------------------------------------
    // The same intake key moves between two existing pending rounds: the new
    // holder records it and the old holder is cleared in the same commit.
    // ---------------------------------------------------------------------
    it('moves one intake key from a newer holder round to the oldest pending round', async () => {
      const first = await world.createSecretary('secretary-1');
      const holder = await world.createSecretary('secretary-2');
      const root = await submit('s6a-intake-move', 'the root', { recipient: first.ref });
      if (root.status !== 'queued') throw new Error('the root submit failed');
      await world.archive(first);

      // The follow-up is a fresh pick of the only live secretary, `holder`,
      // and holds its intake; the root stays pending (older than the follow-up).
      const followup = await submit('s6a-intake-move-followup', 'hold the second intake',
        { goalId: null, continues: root.round });
      expect(followup).toMatchObject({ status: 'queued', assignment: 'assigned', secretary: holder.ref });
      if (followup.status !== 'queued') throw new Error('unreachable');
      expect(await intakeOf(root.requestRoot, followup.round)).toEqual(holder.ref);

      // Move the owner to a third, then archive it: the request is archived
      // while the follow-up still holds `holder`'s intake.
      const third = await world.createSecretary('secretary-3');
      const moved = await world.platform.requestIntake.route(ctx(), {
        commandId: 's6a-intake-move-third', round: root.round, to: third.ref, reason: 'manual',
      });
      expect(moved).toMatchObject({ status: 'routed' });
      await world.archive(third);

      // Route back to the live holder: the oldest pending round (the root)
      // becomes the holder and the follow-up must clear in the same commit.
      const routed = await world.platform.requestIntake.route(ctx(), {
        commandId: 's6a-intake-move-route', round: root.round, to: holder.ref, reason: 'manual',
      });
      expect(routed).toMatchObject({ status: 'routed' });
      expect(await intakeOf(root.requestRoot, root.round)).toEqual(holder.ref);
      expect(await intakeOf(root.requestRoot, followup.round)).toBeNull();

      // The follow-up no longer holds the key, so ending it needs no intake change.
      const ended = await world.platform.requestRounds.append(system(), {
        command: { kind: 'end_unbound', operationId: 's6a-intake-move-end', round: followup.round },
      });
      expect(ended).toEqual({ status: 'ended', round: followup.round, replayed: false });
    });

    // ---------------------------------------------------------------------
    // A manual route of an owned request moves the owner and takes no intake.
    // ---------------------------------------------------------------------
    it('a manual route of an owned request moves the owner in one commit and takes no intake', async () => {
      const first = await world.createSecretary('secretary-1');
      const other = await world.createSecretary('secretary-2');
      const owned = await submit('s6a-route-owned', 'the owned request', { recipient: first.ref });
      if (owned.status !== 'queued') throw new Error('the owned submit failed');

      const before = storeCalls();
      const routed = await world.platform.requestIntake.route(ctx(), {
        commandId: 's6a-route-owned-manual', round: owned.round, to: other.ref, reason: 'manual',
      });
      expect(routed.status).toBe('routed');
      if (routed.status !== 'routed') throw new Error('unreachable');
      expect(callsSince(before).commits).toBe(1);

      const view = await viewOf(owned.requestRoot);
      expect(view.owner).toEqual(other.ref);
      expect(view.ownerState).toBe('owned');
      expect(view.rounds).toHaveLength(2);
      expect(view.rounds[1]!.ref).toEqual(routed.routingRound);
      expect(view.rounds[1]!.kind).toBe('routing');

      // No round holds the new owner's intake: a new request to it is accepted.
      const next = await submit('s6a-route-owned-next', 'a new request', { recipient: other.ref });
      expect(next).toMatchObject({ status: 'queued', assignment: 'assigned', secretary: other.ref });
    });

    // ---------------------------------------------------------------------
    // A follow-up planned on an owner that is archived before the append is
    // re-planned: the Workflow re-runs precheck and picks the spare secretary.
    // ---------------------------------------------------------------------
    it('re-picks a follow-up onto the spare secretary when the owner archived before the append', async () => {
      const secretary = await world.createSecretary('secretary-1');
      const spare = await world.createSecretary('secretary-2');
      const root = await submit('s6a-stale-owner', 'the root', { recipient: secretary.ref });
      if (root.status !== 'queued') throw new Error('the root submit failed');

      const hold = commitBarrier.hold(byIdentityPrefix('request.submit:'), 'stale follow-up append');
      const followup = submit('s6a-stale-owner-followup', 'a follow-up', { goalId: null, continues: root.round });
      await hold.reached;
      await world.archive(secretary);
      hold.release();
      const result = await followup;
      expect(result).toMatchObject({
        status: 'queued', requestRoot: root.requestRoot, assignment: 'assigned', secretary: spare.ref,
        created: false, waitReason: null,
      });
      if (result.status !== 'queued') throw new Error('unreachable');

      const view = await viewOf(root.requestRoot);
      expect(view.owner).toEqual(spare.ref);
      expect(view.rounds).toHaveLength(2);
      expect(view.rounds[1]).toMatchObject({ ref: result.round, kind: 'followup', status: 'queued',
        assignedSession: spare.ref });
      // No unassigned follow-up appeared: the stale no-pick plan was not read
      // as a capacity block.
      expect(view.rounds.filter((round) => round.kind === 'followup' && round.assignedSession === null)).toHaveLength(0);
    });

    // ---------------------------------------------------------------------
    // A follow-up's explicit goalId is re-read and guarded at append.
    // ---------------------------------------------------------------------
    it('re-reads an explicit follow-up goal at append and refuses a cancelled goal', async () => {
      const secretary = await world.createSecretary('secretary-1');
      const root = await submit('s6a-goal-guard', 'the root', { recipient: secretary.ref });
      if (root.status !== 'queued') throw new Error('the root submit failed');

      const hold = commitBarrier.hold(byIdentityPrefix('request.submit:'), 'goal-guarded follow-up append');
      const followup = submit('s6a-goal-guard-followup', 'the follow-up', {
        goalId: S6A_GOAL_1.goalId, continues: root.round,
      });
      await hold.reached;
      const cancelled = await post<Record<string, unknown>>(world.ag2b, 'goals/control', graphWrite(S6A_SCOPE,
        { goalRef: S6A_GOAL_1, control: 'cancel', reason: 'S6A cancel' }, 's6a-goal-guard-cancel', [
          { ref: S6A_GOAL_1, revision: 1 },
          { ref: { aggregateType: 'GoalPhase', projectId: S6A_SCOPE.projectId, goalId: S6A_GOAL_1.goalId }, revision: 0 },
        ]));
      expect(cancelled['status']).toBe('committed');
      hold.release();

      expect(await followup).toEqual({ status: 'rejected', code: 'invalid', reason: 'the Goal is not live' });
      const view = await viewOf(root.requestRoot);
      expect(view.rounds).toHaveLength(1);
    });

    // ---------------------------------------------------------------------
    // An explicit recipient whose Session revision moved before the commit is
    // `busy`, never a tail retry.
    // ---------------------------------------------------------------------
    it('answers busy when an explicit recipient revision moved before the commit', async () => {
      const secretary = await world.createSecretary('secretary-1');
      const hold = commitBarrier.hold(byIdentityPrefix('request.submit:'), 'recipient revision race');
      const submission = submit('s6a-recipient-race', 'a race', { recipient: secretary.ref });
      await hold.reached;
      await world.bumpRevision(secretary);
      hold.release();

      const result = await submission;
      expect(result.status).toBe('rejected');
      if (result.status !== 'rejected') throw new Error('unreachable');
      expect(result.code).toBe('busy');
    });

    // ---------------------------------------------------------------------
    // A committed end_unbound whose answer was lost still recovers
    // `ended, replayed:true` from the same command-kind path.
    // ---------------------------------------------------------------------
    it('recovers a lost end_unbound answer as ended and replayed', async () => {
      const secretary = await world.createSecretary('secretary-1');
      const root = await submit('s6a-lost-end', 'the root', { recipient: secretary.ref });
      if (root.status !== 'queued') throw new Error('the root submit failed');

      faults.loseCommit = true;
      const ended = await world.platform.requestRounds.append(system(), {
        command: { kind: 'end_unbound', operationId: 's6a-lost-end-op', round: root.round },
      });
      expect(ended).toEqual({ status: 'ended', round: root.round, replayed: true });

      const view = await viewOf(root.requestRoot);
      expect(view.rounds[0]).toMatchObject({ status: 'ended', closeDetail: 'no_binding' });
    });

    // ---------------------------------------------------------------------
    // When the recovery lookup also fails the answer is `unavailable`; no
    // promise escapes the result union.
    // ---------------------------------------------------------------------
    it('answers unavailable when the commit answer and the recovery lookup both fail', async () => {
      const secretary = await world.createSecretary('secretary-1');
      const root = await submit('s6a-lost-end-2', 'the root', { recipient: secretary.ref });
      if (root.status !== 'queued') throw new Error('the root submit failed');

      faults.loseCommit = true;
      faults.failRecoveryLookup = true;
      const ended = await world.platform.requestRounds.append(system(), {
        command: { kind: 'end_unbound', operationId: 's6a-lost-end-2-op', round: root.round },
      });
      expect(ended).toMatchObject({ status: 'rejected', code: 'unavailable' });
    });

    // ---------------------------------------------------------------------
    // One request per its oldest pending round; the next page moves on.
    // ---------------------------------------------------------------------
    it('returns each request once, at its oldest pending round, across pages', async () => {
      const first = await world.createSecretary('secretary-1');
      const second = await world.createSecretary('secretary-2');
      const rootA = await submit('s6a-page-a', 'request A', { recipient: first.ref });
      if (rootA.status !== 'queued') throw new Error('A failed');
      const followup = await submit('s6a-page-a-follow', 'A follow-up', { goalId: null, continues: rootA.round });
      if (followup.status !== 'queued') throw new Error('A follow-up failed');
      const rootQ = await submit('s6a-page-q', 'request Q', { recipient: second.ref });
      if (rootQ.status !== 'queued') throw new Error('Q failed');
      await world.archive(first);
      await world.archive(second);

      const page1 = await world.platform.requestRounds.unassigned(ctx(), S6A_SCOPE, { limit: 1, continuation: null });
      if (page1.status !== 'ready') throw new Error(`page 1 failed: ${JSON.stringify(page1)}`);
      expect(page1.value.requests).toEqual([rootA.requestRoot]);
      expect(page1.value.continuation).not.toBeNull();

      const page2 = await world.platform.requestRounds.unassigned(ctx(), S6A_SCOPE,
        { limit: 1, continuation: page1.value.continuation });
      if (page2.status !== 'ready') throw new Error(`page 2 failed: ${JSON.stringify(page2)}`);
      expect(page2.value.requests).toEqual([rootQ.requestRoot]);
    });

    // ---------------------------------------------------------------------
    // A failed request-facts read is the read's failure, never a skip.
    // ---------------------------------------------------------------------
    it('returns unavailable when a candidate request facts read fails', async () => {
      const secretary = await world.createSecretary('secretary-1');
      const root = await submit('s6a-facts-fail', 'the root', { recipient: secretary.ref });
      if (root.status !== 'queued') throw new Error('the root submit failed');
      await world.archive(secretary);

      faults.failFactsFor = root.requestRoot.queryJobId;
      const read = await world.platform.requestRounds.unassigned(ctx(), S6A_SCOPE, { limit: 10, continuation: null });
      expect(read).toEqual({
        status: 'rejected', code: 'unavailable',
        reason: 'the request facts read failed: injected facts read failure',
      });
    });

    // ---------------------------------------------------------------------
    // The drain's `assigned` command runs through the real Workflow port and
    // the platform's real RequestRoundPort: one commit moves the tail to the
    // routing round and swaps the holder round's intake to the new owner.
    // ---------------------------------------------------------------------
    it('assigns an archived-owner request through the real drain', async () => {
      const first = await world.createSecretary('secretary-1');
      const spare = await world.createSecretary('secretary-2');
      const root = await submit('s6a-drain-assigned', 'the root', { recipient: first.ref });
      if (root.status !== 'queued') throw new Error('the root submit failed');
      await world.archive(first);
      const before = await viewOf(root.requestRoot);
      expect(before.ownerState).toBe('owner_archived');
      expect(await intakeOf(root.requestRoot, root.round)).toEqual(first.ref);

      const drainCalls = storeCalls();
      const drained = await world.platform.requestIntake.drainUnassigned(system(), S6A_SCOPE,
        { maxRequests: 10, continuation: null });
      if (drained.status !== 'ready') throw new Error(`the drain failed: ${JSON.stringify(drained)}`);
      expect(drained.value).toMatchObject({ progressed: 1, blocked: 0, more: false, wrapped: true });
      expect(callsSince(drainCalls).commits).toBe(1);

      const after = await viewOf(root.requestRoot);
      expect(after.ownerState).toBe('owned');
      expect(after.owner).toEqual(spare.ref);
      expect(after.rounds).toHaveLength(2);
      expect(after.rounds[1]).toMatchObject({ kind: 'routing', status: 'ended', closeCode: 'not_entered' });
      // The same holder round, the root, now holds the new owner's intake.
      expect(await intakeOf(root.requestRoot, root.round)).toEqual(spare.ref);

      // The routing round is the request's tail: a follow-up appends after it.
      const followup = await submit('s6a-drain-assigned-followup', 'a follow-up', { goalId: null, continues: root.round });
      expect(followup).toMatchObject({ status: 'queued', assignment: 'assigned', secretary: spare.ref });

      // The archived owner's intake was released: active again, it takes a new request.
      await reactivate(first);
      const back = await submit('s6a-drain-assigned-back', 'a new request', { recipient: first.ref });
      expect(back).toMatchObject({ status: 'queued', assignment: 'assigned', secretary: first.ref });

      // Ending the holder round releases the new owner's intake.
      const ended = await world.platform.requestRounds.append(system(), {
        command: { kind: 'end_unbound', operationId: 's6a-drain-assigned-end', round: root.round },
      });
      expect(ended).toEqual({ status: 'ended', round: root.round, replayed: false });
      expect(await intakeOf(root.requestRoot, root.round)).toBeNull();
      const freed = await submit('s6a-drain-assigned-freed', 'a new request', { recipient: spare.ref });
      expect(freed).toMatchObject({ status: 'queued', assignment: 'assigned', secretary: spare.ref });
    });

    // ---------------------------------------------------------------------
    // Refused request commands: one refusal per row, each with a public read
    // (and, where no new record could be located, the commit count) proving
    // nothing changed.
    // ---------------------------------------------------------------------
    describe('rejects: request commands', () => {
      it('refuses select_idea on a pending round and leaves the request unchanged', async () => {
        const secretary = await world.createSecretary('secretary-1');
        const root = await submit('s6a-reject-select', 'the root', { recipient: secretary.ref });
        if (root.status !== 'queued') throw new Error('the root submit failed');
        const result = await world.platform.requestIntake.selectIdea(ctx(), {
          commandId: 's6a-reject-select-idea', round: root.round, index: 0,
        });
        expect(result).toEqual({ status: 'rejected', code: 'invalid', reason: 'the round has no answer yet' });
        const view = await viewOf(root.requestRoot);
        expect(view.rounds).toHaveLength(1);
        expect(view.rounds[0]).toMatchObject({ status: 'queued', closeCode: null });
      });

      it('refuses a follow-up to a plain Query and leaves the Query pending', async () => {
        const plainQuery = await world.submitPlanningQuery('s6a-reject-continues');
        const result = await submit('s6a-reject-continues-1', 'a follow-up', { continues: plainQuery.queryJobRef });
        expect(result).toEqual({
          status: 'rejected', code: 'not_found', reason: 'the ref is not a request root of this workspace',
        });
        const job = await world.platform.queries.readQueryJob(ctx(), plainQuery.queryJobRef);
        if (job.status !== 'ready') throw new Error(`the plain Query read failed: ${JSON.stringify(job)}`);
        expect(job.value.job.job.status).toBe('pending');
        expect(job.value.job.job.requestRoot).toBeNull();
      });

      it('refuses a second drop and leaves the dropped rounds as they were', async () => {
        const secretary = await world.createSecretary('secretary-1');
        const root = await submit('s6a-reject-drop', 'the root', { recipient: secretary.ref });
        if (root.status !== 'queued') throw new Error('the root submit failed');
        const first = await world.platform.requestIntake.route(ctx(), {
          commandId: 's6a-reject-drop-1', round: root.round, to: null, reason: 'dropped',
        });
        expect(first).toMatchObject({ status: 'routed' });
        const before = await viewOf(root.requestRoot);
        const again = await world.platform.requestIntake.route(ctx(), {
          commandId: 's6a-reject-drop-2', round: root.round, to: null, reason: 'dropped',
        });
        expect(again).toEqual({ status: 'rejected', code: 'invalid', reason: 'the request is already dropped' });
        const after = await viewOf(root.requestRoot);
        expect(after.rounds).toEqual(before.rounds);
      });

      it('refuses the same commandId with other words and leaves the request unchanged', async () => {
        await world.createSecretary('secretary-1');
        const input = submitInput('s6a-conflict-1', 'first words');
        const first = await world.platform.requestIntake.submitRequest(ctx(), input);
        if (first.status !== 'queued') throw new Error(`the first submit failed: ${JSON.stringify(first)}`);
        const before = await viewOf(first.requestRoot);

        const conflictCalls = storeCalls();
        const conflict = await world.platform.requestIntake.submitRequest(ctx(), { ...input, text: 'other words' });
        expect(conflict.status).toBe('rejected');
        if (conflict.status !== 'rejected') throw new Error('unreachable');
        expect(conflict.code).toBe('idempotency_conflict');
        expect(conflict.reason.length).toBeGreaterThan(0);
        expect(callsSince(conflictCalls).commits).toBe(0);
        const after = await viewOf(first.requestRoot);
        expect(after.rounds).toEqual(before.rounds);
      });

      it('refuses a non-person submit before any store call and takes no recipient intake', async () => {
        const secretary = await world.createSecretary('secretary-1');
        const card = await world.readSession(secretary);
        const before = storeCalls();
        const refused = await world.platform.requestIntake.submitRequest(system(),
          submitInput('s6a-reject-person', 'not a person', { recipient: secretary.ref }));
        expect(refused).toEqual({
          status: 'rejected', code: 'forbidden', reason: 'only the person may issue a request command',
        });
        expect(callsSince(before)).toEqual({ commits: 0, reads: 0 });
        expect((await world.readSession(secretary)).record).toEqual(card.record);
        // The refusal took no intake: the person's real delivery is accepted.
        const accepted = await submit('s6a-reject-person-ok', 'the person', { recipient: secretary.ref });
        expect(accepted).toMatchObject({ status: 'queued', assignment: 'assigned', secretary: secretary.ref });
      });

      it('refuses an incomplete card ref before any lookup', async () => {
        const secretary = await world.createSecretary('secretary-1');
        const root = await submit('s6a-reject-card', 'the root', { recipient: secretary.ref });
        if (root.status !== 'queued') throw new Error('the root submit failed');
        const before = storeCalls();
        const result = await world.platform.requestRounds.precheck(ctx(), {
          kind: 'ask', commandId: 's6a-reject-card-ask', round: root.round,
          cardRefs: [{ ref: { aggregateType: 'QueryJob', projectId: S6A_SCOPE.projectId }, revision: 1 } as
            unknown as VersionedRef],
          regenerate: false, text: 'ask',
        });
        expect(result).toEqual({
          status: 'rejected', code: 'invalid',
          reason: 'cardRefs[0].ref an aggregate ref QueryJob requires a non-empty workspaceId',
        });
        expect(callsSince(before)).toEqual({ commits: 0, reads: 0 });
        const view = await viewOf(root.requestRoot);
        expect(view.rounds).toHaveLength(1);
      });

      it('refuses an explicit recipient that does not exist and takes no intake', async () => {
        const secretary = await world.createSecretary('secretary-1');
        const missing: SessionRef = { projectId: S6A_SCOPE.projectId, sessionId: 's6a-no-such-session' };
        const before = storeCalls();
        const result = await submit('s6a-missing-recipient', 'a request', { recipient: missing });
        expect(result.status).toBe('rejected');
        if (result.status !== 'rejected') throw new Error('unreachable');
        expect(result.code).toBe('unavailable');
        expect(result.reason).toContain('the requested Session does not exist');
        // A refused new request has no record to read back: it committed nothing.
        expect(callsSince(before).commits).toBe(0);
        // Nothing changed: the missing recipient took no intake, so the real
        // secretary's next delivery is accepted.
        const accepted = await submit('s6a-missing-recipient-ok', 'a later request', { recipient: secretary.ref });
        expect(accepted).toMatchObject({ status: 'queued', assignment: 'assigned', secretary: secretary.ref });
      });

      it('refuses a Session without a secretary profile and takes no intake', async () => {
        const secretary = await world.createSecretary('secretary-1');
        const unprofiled = await world.createUnprofiledSecretary('unprofiled-secretary');
        const card = await world.readSession(unprofiled);
        const before = storeCalls();
        const result = await submit('s6a-not-a-secretary', 'a request', { recipient: unprofiled.ref });
        expect(result).toEqual({ status: 'rejected', code: 'unavailable', reason: 'no_secretary_binding' });
        // A refused new request has no record to read back: it committed nothing.
        expect(callsSince(before).commits).toBe(0);
        expect((await world.readSession(unprofiled)).record).toEqual(card.record);
        const accepted = await submit('s6a-not-a-secretary-ok', 'a later request', { recipient: secretary.ref });
        expect(accepted).toMatchObject({ status: 'queued', assignment: 'assigned', secretary: secretary.ref });
      });

      it('refuses a new request to the owner a drain assigned while its holder round is pending and changes nothing', async () => {
        const first = await world.createSecretary('secretary-1');
        const spare = await world.createSecretary('secretary-2');
        const root = await submit('s6a-reject-busy', 'the root', { recipient: first.ref });
        if (root.status !== 'queued') throw new Error('the root submit failed');
        await world.archive(first);
        const drained = await world.platform.requestIntake.drainUnassigned(system(), S6A_SCOPE,
          { maxRequests: 10, continuation: null });
        if (drained.status !== 'ready') throw new Error(`the drain failed: ${JSON.stringify(drained)}`);
        expect(drained.value).toMatchObject({ progressed: 1, blocked: 0 });
        const followup = await submit('s6a-reject-busy-followup', 'a follow-up', { goalId: null, continues: root.round });
        expect(followup).toMatchObject({ status: 'queued', assignment: 'assigned', secretary: spare.ref });
        const before = { view: await viewOf(root.requestRoot), sessions: await world.listSessions() };

        // The drain took the new owner's intake on the holder round, the root:
        // while that round is pending, a new request to the new owner is busy.
        // The store refuses that request's commit on the held intake claim, so
        // a refused request has no record to read back and nothing is committed.
        const committedBefore = calls.committed;
        const busy = await submit('s6a-reject-busy-new', 'a new request', { recipient: spare.ref });
        expect(busy).toMatchObject({ status: 'rejected', code: 'busy' });
        expect(committedSince(committedBefore)).toBe(0);
        expect({ view: await viewOf(root.requestRoot), sessions: await world.listSessions() }).toEqual(before);
      });
    });

    // ---------------------------------------------------------------------
    // A routing round never runs a Query: Query claim and preparation refuse
    // it `invalid`, and the request, the routing round and the secretary's
    // line stay as they were.
    // ---------------------------------------------------------------------
    describe('rejects: a routing round at Query claim and preparation', () => {
      const expected = 'a routing request round never reaches Query claim or preparation';

      /** A dropped request: its routing round, the idle secretary and a Run ref under the routing round. */
      async function droppedRequest() {
        const secretary = await world.createSecretary('secretary-1');
        const root = await submit('s6a-routing-refusal', 'the root', { recipient: secretary.ref });
        if (root.status !== 'queued') throw new Error('the root submit failed');
        const dropped = await world.platform.requestIntake.route(ctx(), {
          commandId: 's6a-routing-refusal-drop', round: root.round, to: null, reason: 'dropped',
        });
        if (dropped.status !== 'routed') throw new Error(`the drop failed: ${JSON.stringify(dropped)}`);
        const routing = dropped.routingRound;
        const queryRunRef: QueryRunRef = { aggregateType: 'QueryRun', projectId: routing.projectId,
          workspaceId: routing.workspaceId, queryJobId: routing.queryJobId, runId: 's6a-routing-run' };
        return { secretary, root, routing, queryRunRef };
      }

      /** The public state a refusal must leave unchanged. */
      async function publicState(root: QueryJobRef, routing: QueryJobRef, secretary: S6ASession) {
        const view = await viewOf(root);
        const facts = await factsOf(root);
        const routingFacts = facts.rounds.find((round) => sameJson(round.ref, routing));
        const card = await world.readSession(secretary);
        return {
          rounds: view.rounds,
          routingStatus: routingFacts?.job.status,
          routingRun: routingFacts?.job.runRef,
          runsOfRouting: facts.runs.filter((run) => run.ref.queryJobId === routing.queryJobId).length,
          occupancy: card.record.occupancy,
          revision: card.record.revision,
        };
      }

      it('refuses Query claim of a routing round and changes nothing', async () => {
        const { secretary, root, routing, queryRunRef } = await droppedRequest();
        const card = await world.readSession(secretary);
        const before = await publicState(root.requestRoot, routing, secretary);
        expect(before.rounds).toHaveLength(2);
        expect(before).toMatchObject({ routingStatus: 'closed', routingRun: null, runsOfRouting: 0, occupancy: null });

        const claimCalls = storeCalls();
        const claim = await world.platform.queries.claimQuery(ctx(), {
          input: { queryRunRef, sessionRef: secretary.ref },
          meta: { requestId: 's6a-routing-claim', expected: [
            { ref: routing, revision: 1 }, { ref: queryRunRef, revision: 1 },
            { ref: card.record.ref, revision: card.record.revision },
          ] },
        });
        expect(claim).toEqual({ status: 'rejected', code: 'invalid', reason: expected });
        expect(callsSince(claimCalls).commits).toBe(0);
        expect(await publicState(root.requestRoot, routing, secretary)).toEqual(before);
      });

      it('refuses Query preparation of a routing round and changes nothing', async () => {
        const { secretary, root, routing, queryRunRef } = await droppedRequest();
        const before = await publicState(root.requestRoot, routing, secretary);
        expect(before.rounds).toHaveLength(2);
        expect(before).toMatchObject({ routingStatus: 'closed', routingRun: null, runsOfRouting: 0, occupancy: null });

        const prepareCalls = storeCalls();
        const prepared = await world.platform.runtime.prepareQuery(ctx(), {
          queryRunRef, requestId: 's6a-routing-prepare',
        });
        expect(prepared).toEqual({ status: 'rejected', code: 'invalid', reason: expected });
        expect(callsSince(prepareCalls).commits).toBe(0);
        expect(await publicState(root.requestRoot, routing, secretary)).toEqual(before);
      });
    });
  });
}

// ---------------------------------------------------------------------------
// C-115 (DESIGN :341, slice-6 :213): a paused Goal can still be asked and
// drafted for; only a cancelled Goal is not live. The file's two-backend rows
// above stay exactly as they are; this rule is a business rule, so memory only.
// ---------------------------------------------------------------------------
describe('S6A request rounds naming a paused or cancelled Goal (memory)', () => {
  let world: S6ARequestWorld;

  beforeEach(async () => {
    world = await openS6ARequestWorld({ backend: 'memory' });
  });

  afterEach(async () => {
    await world.close();
  });

  /** `goals/control` at the seeded Goal's revision 1 and its absent GoalPhase (0 = none stored). */
  async function setGoalState(goal: typeof S6A_GOAL_1, control: 'pause' | 'cancel') {
    const written = await world.post('goals/control', graphWrite(S6A_SCOPE, {
      goalRef: goal, control, reason: `the test ${control}s the goal`,
    }, `smk3-goal-${goal.goalId}-${control}`, [
      { ref: goal, revision: 1 },
      { ref: { aggregateType: 'GoalPhase', projectId: S6A_SCOPE.projectId, goalId: goal.goalId }, revision: 0 },
    ]));
    expect(written.body).toMatchObject({ status: 'committed' });
  }

  it.each([
    { case: 'a submit naming a paused Goal', action: 'submit', goal: S6A_GOAL_1, state: 'pause',
      expected: { status: 'queued' } },
    { case: 'a follow-up naming a paused Goal', action: 'followup', goal: S6A_GOAL_1, state: 'pause',
      expected: { status: 'queued' } },
    { case: 'a submit naming a cancelled Goal', action: 'submit', goal: S6A_GOAL_2, state: 'cancel',
      expected: { status: 'rejected', code: 'invalid', reason: 'the Goal is not live' } },
  ] as const)('$case', async ({ action, goal, state, expected }) => {
    const ctx = world.humanContext();
    if (action === 'followup') {
      // The root was accepted while the Goal was active; the follow-up meets it paused at append.
      const root = await world.platform.requestIntake.submitRequest(ctx, submitInput('smk3-paused-root', 'the root'));
      if (root.status !== 'queued') throw new Error(`the root submit failed: ${JSON.stringify(root)}`);
      await setGoalState(goal, state);
      const followup = await world.platform.requestIntake.submitRequest(ctx,
        submitInput('smk3-paused-followup', 'the follow-up', { continues: root.round }));
      expect(followup).toMatchObject(expected);
      return;
    }
    await setGoalState(goal, state);
    const submitted = await world.platform.requestIntake.submitRequest(ctx,
      submitInput(`smk3-${state}-submit`, 'the request', { goalId: goal.goalId }));
    expect(submitted).toMatchObject(expected);
  });
});
