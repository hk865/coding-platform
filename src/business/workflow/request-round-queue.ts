/**
 * The two request queues of one workspace: `request-rounds` advances the open
 * request rounds, `unassigned` drains the requests nobody owns.
 *
 * A queue is a handler the wake loop drives: `rebuild` and `drain` only read,
 * and every decision is re-derived from the records on each pass, so a wake is
 * never a fact. `request-rounds` traverses the open-rounds index one bounded
 * page at a time and asks the stage driver to move an attempt. Its traversal
 * cursors AND the work it found but has not launched yet live in the
 * continuation the loop hands back, so a pass that ran out of pages, failed a
 * read or hit the advance cap resumes where it stopped instead of losing what
 * it read:
 *
 * - an attempt already claimed, prepared, entering or entered is advanced on
 *   its own Session, whoever owns the request now; an `unknown` attempt is left
 *   to the operator, never advanced;
 * - otherwise a Session with no live attempt, no occupancy and no advance in
 *   flight gets its oldest dispatchable round — the request's oldest pending
 *   round not covered by a drop, and the oldest among the requests that Session
 *   owns, chosen once the WHOLE traversal is read — with that Session's
 *   secretary profile; without a profile the round ends `end_unbound`. A
 *   request that already has a live attempt gets no second one, whichever
 *   Session owns it.
 *
 * Work never launches from an earlier read: before anything is launched the
 * pass reads that request's facts (or uses the read it made itself), and the
 * live attempt, the owner, the dispatchable round and its Run come from that
 * read. A round chosen from an earlier pass's read starts only while its
 * request still offers that round and Run on the same owner; when it does not
 * (dropped, moved, claimed in between), the traversal is read again from its
 * first entry before the pass may wrap, because the commit that changed the
 * request already woke the queue for this very pass.
 *
 * Advances are launched, never awaited: one in-flight advance per Session. A
 * settled advance that progressed or ended wakes the queue at once; one blocked
 * on a change waits for the next commit notice, command or registration; a
 * throw or a backoff block backs that Session off and wakes the queue when the
 * back-off ends. Launching is not progress, so a pass that only launched
 * advances which then block parks until something actually changes.
 */
import type { CommitCursor } from '../../contracts/command-event.js';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { SessionRef, WorkspaceScope } from '../../contracts/core/identity.js';
import type { ReadResult } from '../../contracts/core/results.js';
import type { QueryJobRef, QueryJobSnapshot, QueryRunRef, QueryRunSnapshot } from '../../contracts/query-job.js';
import { canonicalJson, sameJson, sha256Hex, type JsonValue } from '../../contracts/fingerprint.js';
import { isRecord } from '../../contracts/validation/common.js';
import {
  LIVE_ATTEMPT_PHASES, REQUEST_ADVANCES_PER_PASS, REQUEST_BACKOFF_INITIAL_MS, REQUEST_BACKOFF_MAX_MS,
  REQUEST_DRAINED_PER_PASS, REQUEST_PAGE_SIZE, REQUEST_PASS_PAGES,
  type SecretaryProfilePort, type SecretaryProfileV1,
} from '../../core/work-graph/model/request-contracts.js';
import type { SessionFactsPort } from '../../core/work-graph/model/session-facts-contracts.js';
import { keyOf } from '../../core/work-graph/queries/request-round-claims.js';
import {
  compareRequestRounds, oldestPendingRound, type RequestRoundsFactsV1,
} from '../../core/work-graph/queries/request-rounds-read.js';
import { aggregateRefProblem } from '../../core/work-graph/persistence/decision-record-codecs.js';
import { sessionRefProblem } from '../../core/work-graph/persistence/rework-codecs.js';
import {
  isPlatformCursor, plainSessionRefToAggregate, sessionAggregateRefKey,
} from '../../core/work-graph/sessions/session-record-codecs.js';
import type { RequestFactsReader, RequestRoundPort } from '../../core/work-graph/tasks/request-service.js';
import type { QueryStageDriver } from './query-stage-driver.js';

/** The queue key of the open rounds (the Host registers its handler under it). */
export const REQUEST_ROUNDS_QUEUE = 'request-rounds';
/** The queue key of the unassigned drain. */
export const REQUEST_UNASSIGNED_QUEUE = 'unassigned';

export type RequestQueuePassV1 = {
  progressed: number; more: boolean; continuation: string | null; wrapped: boolean; blocked: number;
};

export type RequestQueueHandlerV1 = {
  rebuild(scope: WorkspaceScope): Promise<void>;
  drain(scope: WorkspaceScope, input: { maxItems: number; continuation: string | null; signal: AbortSignal }):
    Promise<RequestQueuePassV1>;
};

const PARTITIONS = ['pending', 'running'] as const;

type QueueState = {
  /** The advance launched for a Session, keyed by the Session aggregate key; one at a time. */
  inFlight: Map<string, Promise<void>>;
  /** The pending back-off timer of a Session, waited for by `settle()`. */
  backoffs: Map<string, Promise<void>>;
  /** Consecutive backoff-worthy failures per Session; a `progressed` advance resets it. */
  failures: Map<string, number>;
};

/**
 * One piece of work a traversal found: a live attempt (rule 1) or a fresh round
 * (rule 2). It names its request, so a later pass reads that request's facts
 * again before launching it; the round, its Run, the Session and the round's
 * `since` are what the facts said when it was found. `since` and the round's
 * canonical key order fresh rounds even when the traversal that found them is
 * spread over several passes.
 */
type Candidate = {
  requestRoot: QueryJobRef; round: QueryJobRef; run: QueryRunRef; session: SessionRef; since: CommitCursor;
};

/**
 * The `request-rounds` continuation, frozen as a string because the loop keeps
 * it: the two partition cursors, which partitions already wrapped in this
 * traversal, the live attempts the advance cap left unlaunched, and the fresh
 * rounds — while the traversal is read, the oldest found so far per owner
 * Session; once it is complete, the chosen ones the cap left unlaunched.
 */
type RoundTraversalV1 = {
  version: 1;
  cursors: { pending: string | null; running: string | null };
  done: { pending: boolean; running: boolean };
  attempts: Candidate[];
  candidates: Candidate[];
};

/** What one request's facts ask of the queue at the moment they were read. */
type RequestWork = {
  /** Its live attempts, each on its own Session (rule 1). */
  attempts: Candidate[];
  /** Its dispatchable round on its owner, when it has no live attempt (rule 2). */
  fresh: Candidate | null;
  /** Its dispatchable round's Run already holds an execution state, so there is nothing to claim. */
  blocked: boolean;
};

function emptyTraversal(): RoundTraversalV1 {
  return {
    version: 1, cursors: { pending: null, running: null }, done: { pending: false, running: false },
    attempts: [], candidates: [],
  };
}

function traversalComplete(traversal: RoundTraversalV1): boolean {
  return traversal.done.pending && traversal.done.running;
}

/** The one fresh-round order is the request rounds' own: `since`, ties by the canonical round key. */
function compareCandidates(left: Candidate, right: Candidate): number {
  return compareRequestRounds({ ref: left.round, since: left.since }, { ref: right.round, since: right.since });
}

function unreadableContinuation(): Error {
  return new Error('the request-round continuation is not readable');
}

/** A complete QueryJobRef, copied field by field; anything else is null. */
function queryJobRefOf(value: unknown): QueryJobRef | null {
  if (!isRecord(value) || value['aggregateType'] !== 'QueryJob' || aggregateRefProblem(value) !== null) return null;
  return { aggregateType: 'QueryJob', projectId: value['projectId'] as string,
    workspaceId: value['workspaceId'] as string, queryJobId: value['queryJobId'] as string };
}

/** A complete QueryRunRef, copied field by field; anything else is null. */
function queryRunRefOf(value: unknown): QueryRunRef | null {
  if (!isRecord(value) || value['aggregateType'] !== 'QueryRun' || aggregateRefProblem(value) !== null) return null;
  return { aggregateType: 'QueryRun', projectId: value['projectId'] as string,
    workspaceId: value['workspaceId'] as string, queryJobId: value['queryJobId'] as string,
    runId: value['runId'] as string };
}

/**
 * The carried work: each entry is two complete QueryJobRefs, a complete
 * QueryRunRef, a complete SessionRef and a commit cursor, or the whole
 * continuation is unreadable.
 */
function decodeCandidates(value: unknown): Candidate[] {
  if (!Array.isArray(value)) throw unreadableContinuation();
  return value.map((entry: unknown) => {
    if (!isRecord(entry)) throw unreadableContinuation();
    const requestRoot = queryJobRefOf(entry['requestRoot']);
    const round = queryJobRefOf(entry['round']);
    const run = queryRunRefOf(entry['run']);
    const session = entry['session'];
    const since = entry['since'];
    if (requestRoot === null || round === null || run === null
      || sessionRefProblem(session, 'the carried Session') !== null || !isPlatformCursor(since)) {
      throw unreadableContinuation();
    }
    const { projectId, sessionId } = session as SessionRef;
    return { requestRoot, round, run, session: { projectId, sessionId }, since: since as CommitCursor };
  });
}

/**
 * Read the loop's continuation. It is this queue's own frozen value, so a
 * value that does not decode is an invariant break, never an empty traversal:
 * starting over would silently drop the cursors and the unlaunched work.
 */
function decodeTraversal(continuation: string | null): RoundTraversalV1 {
  if (continuation === null) return emptyTraversal();
  let value: unknown;
  try {
    value = JSON.parse(continuation);
  } catch {
    throw unreadableContinuation();
  }
  if (!isRecord(value) || value['version'] !== 1) throw unreadableContinuation();
  const cursors = value['cursors'];
  const done = value['done'];
  if (!isRecord(cursors) || !isRecord(done)) throw unreadableContinuation();
  const traversal = emptyTraversal();
  for (const status of PARTITIONS) {
    const cursor = cursors[status];
    const wrapped = done[status];
    if ((cursor !== null && typeof cursor !== 'string') || typeof wrapped !== 'boolean') throw unreadableContinuation();
    traversal.cursors[status] = cursor;
    traversal.done[status] = wrapped;
  }
  traversal.attempts = decodeCandidates(value['attempts']);
  traversal.candidates = decodeCandidates(value['candidates']);
  return traversal;
}

function encodeTraversal(traversal: RoundTraversalV1): string {
  return JSON.stringify(traversal);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A workspace's place in the queue maps; the project and workspace ids identify it. */
function workspaceKey(scope: WorkspaceScope): string {
  return `${scope.projectId}/${scope.workspaceId}`;
}

/** The one key of a Session: the same aggregate key the claim and the intake use. */
function sessionKeyOf(session: SessionRef): string {
  return sessionAggregateRefKey(plainSessionRefToAggregate(session));
}

/** The stable identity of the `end_unbound` append for one round. */
function endUnboundOperationId(round: QueryJobRef): string {
  return `request-queue-end-unbound:${sha256Hex(canonicalJson(round as unknown as JsonValue))}`;
}

function runOf(facts: RequestRoundsFactsV1, ref: QueryRunRef | null): QueryRunSnapshot | undefined {
  if (ref === null) return undefined;
  return facts.runs.find((run) => sameJson(run.ref, ref));
}

/**
 * The request's oldest pending non-routing round that a drop does not cover.
 * The selection itself stays `oldestPendingRound`; a drop only removes the
 * rounds it ended from the facts this pass sees.
 */
function dispatchableRound(facts: RequestRoundsFactsV1): QueryJobSnapshot | null {
  if (facts.coveredByDrop.length === 0) return oldestPendingRound(facts);
  const covered = new Set(facts.coveredByDrop.map((ref) => keyOf(ref)));
  return oldestPendingRound({ ...facts, rounds: facts.rounds.filter((round) => !covered.has(keyOf(round.ref))) });
}

/** The two rules applied to one request's facts. */
function workOf(requestRoot: QueryJobRef, facts: RequestRoundsFactsV1): RequestWork {
  const attempts: Candidate[] = [];
  for (const run of facts.runs) {
    const state = run.run.executionState;
    if (state === undefined || !LIVE_ATTEMPT_PHASES.has(state.phase)) continue;
    const round = facts.rounds.find((candidate) => sameJson(candidate.job.runRef, run.ref));
    if (round === undefined) throw new Error('a live attempt belongs to no round of its request');
    attempts.push({
      requestRoot: { ...requestRoot }, round: { ...round.ref }, run: { ...run.ref },
      session: { ...state.sessionRef }, since: round.since,
    });
  }
  // One live attempt per request: while it has one, no second attempt starts
  // for it, whichever Session owns the request now.
  if (attempts.length > 0 || facts.ownerState !== 'owned') return { attempts, fresh: null, blocked: false };
  const owner = facts.owner;
  if (owner === null) throw new Error('an owned request names no owner Session');
  const round = dispatchableRound(facts);
  if (round === null) return { attempts, fresh: null, blocked: false };
  const runRef = round.job.runRef;
  if (runRef === null) throw new Error('a dispatchable round has no QueryRun');
  // A round whose Run already has an execution state is an attempt no pass may
  // dispatch again: only a fresh round is claimable.
  if (runOf(facts, runRef)?.run.executionState !== undefined) return { attempts, fresh: null, blocked: true };
  return {
    attempts,
    fresh: { requestRoot: { ...requestRoot }, round: { ...round.ref }, run: { ...runRef }, session: { ...owner },
      since: round.since },
    blocked: false,
  };
}

/**
 * Keep one fresh round per owner Session, the oldest found so far in the
 * traversal. A newer read of the same request first replaces its older entry,
 * so a request waits once per traversal, with what was read last.
 */
function keepOldest(traversal: RoundTraversalV1, fresh: Candidate): void {
  const rootKey = keyOf(fresh.requestRoot);
  const others = traversal.candidates.filter((known) => keyOf(known.requestRoot) !== rootKey);
  const sessionKey = sessionKeyOf(fresh.session);
  const rival = others.find((known) => sessionKeyOf(known.session) === sessionKey);
  if (rival !== undefined && compareCandidates(rival, fresh) <= 0) {
    traversal.candidates = others;
    return;
  }
  traversal.candidates = [...others.filter((known) => known !== rival), fresh];
}

export function createRequestRoundQueues(deps: {
  rounds: Pick<RequestRoundPort, 'open' | 'append'>;
  facts: RequestFactsReader;
  sessions: Pick<SessionFactsPort, 'readSessionFacts'>;
  profiles: Pick<SecretaryProfilePort, 'forSession'>;
  drain: (ctx: CoreCallContext, scope: WorkspaceScope, input: { maxRequests: number; continuation: string | null })
    => Promise<ReadResult<{ progressed: number; more: boolean; continuation: string | null; wrapped: boolean; blocked: number }>>;
  driver: QueryStageDriver;
  context: (scope: WorkspaceScope, signal: AbortSignal) => CoreCallContext;
  wake: (scope: WorkspaceScope) => void;
}): { rounds: RequestQueueHandlerV1; unassigned: RequestQueueHandlerV1; settle(): Promise<void> } {
  const states = new Map<string, QueueState>();
  /** After `settle()` the Host is closing: no further read, append or advance is started. */
  let closed = false;

  function stateOf(scope: WorkspaceScope): QueueState {
    const key = workspaceKey(scope);
    let state = states.get(key);
    if (state === undefined) {
      state = {
        inFlight: new Map(),
        backoffs: new Map(),
        failures: new Map(),
      };
      states.set(key, state);
    }
    return state;
  }

  /** A Session with an advance in flight or a back-off running takes nothing new; its own wake returns it. */
  function busy(state: QueueState, session: SessionRef): boolean {
    const key = sessionKeyOf(session);
    return state.inFlight.has(key) || state.backoffs.has(key);
  }

  /**
   * One back-off per Session: the first failure waits the initial delay and
   * every further one doubles it up to the cap, until an advance of that
   * Session progresses. The wake at the end is what lets the loop retry.
   *
   * The wait belongs to the advance's own signal: an aborted or closed queue
   * creates no timer, and an abort ends a pending wait without a wake, so a
   * closing Host never waits out a back-off and a cancelled advance never
   * starts a new one.
   */
  function backOff(state: QueueState, scope: WorkspaceScope, session: SessionRef, signal: AbortSignal): void {
    const key = sessionKeyOf(session);
    const failures = (state.failures.get(key) ?? 0) + 1;
    state.failures.set(key, failures);
    if (closed || signal.aborted) return;
    const delay = Math.min(REQUEST_BACKOFF_INITIAL_MS * 2 ** (failures - 1), REQUEST_BACKOFF_MAX_MS);
    const timer = new Promise<void>((resolve) => {
      const endWait = (wake: boolean): void => {
        clearTimeout(handle);
        signal.removeEventListener('abort', abortWait);
        state.backoffs.delete(key);
        resolve();
        if (wake) deps.wake(scope);
      };
      const abortWait = (): void => endWait(false);
      const handle = setTimeout(() => endWait(true), delay);
      signal.addEventListener('abort', abortWait, { once: true });
      // The Host close waits for this timer through `settle()`, so the timer
      // must not keep the process alive on its own.
      handle.unref?.();
    });
    state.backoffs.set(key, timer);
  }

  /** Launch one advance; it is never awaited here. The in-flight entry leaves when it settles. */
  function launch(
    state: QueueState, scope: WorkspaceScope, ctx: CoreCallContext, session: SessionRef,
    round: QueryJobRef, runRef: QueryRunRef, profile: SecretaryProfileV1 | null,
  ): void {
    const sessionKey = sessionKeyOf(session);
    let settled: () => void = () => undefined;
    const done = new Promise<void>((resolve) => { settled = resolve; });
    state.inFlight.set(sessionKey, done);
    void (async () => {
      let outcome: Awaited<ReturnType<QueryStageDriver['advance']>> | null = null;
      let failure: string | null = null;
      try {
        outcome = await deps.driver.advance(ctx, { queryJobRef: { ...round }, expectedRunRef: { ...runRef }, profile });
      } catch (error) {
        failure = messageOf(error);
      }
      state.inFlight.delete(sessionKey);
      if (failure !== null || (outcome !== null && outcome.status === 'blocked' && outcome.retry === 'backoff')) {
        // A throw is a failure like a backoff block: the same Session waits.
        backOff(state, scope, session, ctx.signal);
      } else if (outcome !== null && (outcome.status === 'progressed' || outcome.status === 'terminal')) {
        // Progress ends this Session's back-off; the queue reads the change now.
        state.failures.delete(sessionKey);
        deps.wake(scope);
      }
      // `blocked` on a change wakes nothing: the next commit notice, request
      // command or line registration runs the pass.
      settled();
    })();
  }

  /**
   * One request's facts. A failed read is the pass's failure: the loop backs
   * off rather than reading it as "nothing to do", and keeps the continuation
   * the last completed pass returned.
   */
  async function readFacts(ctx: CoreCallContext, root: QueryJobRef): Promise<RequestRoundsFactsV1> {
    let read: ReadResult<RequestRoundsFactsV1>;
    try {
      read = await deps.facts.readFacts(ctx, { requestRoot: root });
    } catch (error) {
      throw new Error(`the request facts read failed: ${messageOf(error)}`);
    }
    if (read.status !== 'ready') {
      throw new Error(`the request facts read failed: ${
        read.status === 'rejected' ? `${read.code}: ${read.reason}` : read.status}`);
    }
    return read.value;
  }

  /**
   * The request's owner Session as a dispatch target: not occupied by another
   * attempt, and its profile. A failed read is the pass's failure, never
   * "free".
   */
  async function ownerTarget(
    scope: WorkspaceScope, ctx: CoreCallContext, session: SessionRef,
  ): Promise<{ status: 'ready'; profile: SecretaryProfileV1 | null } | { status: 'skipped' }> {
    let read: Awaited<ReturnType<SessionFactsPort['readSessionFacts']>>;
    try {
      read = await deps.sessions.readSessionFacts(ctx, session);
    } catch (error) {
      throw new Error(`the request owner Session facts could not be read: ${messageOf(error)}`);
    }
    if (read.status !== 'ready') {
      throw new Error(`the request owner Session facts could not be read: ${
        read.status === 'rejected' ? `${read.code}: ${read.reason}` : read.status}`);
    }
    const record = read.value.session;
    // An unknown attempt keeps its occupancy until the operator answers, and a
    // live attempt holds its Session, so an occupied line never receives a
    // second round.
    if (record.occupancy !== null) return { status: 'skipped' };
    let profile: SecretaryProfileV1 | null;
    try {
      profile = deps.profiles.forSession({ workspace: scope, sessionRole: record.role });
    } catch (error) {
      throw new Error(`the request owner Session profile could not be read: ${messageOf(error)}`);
    }
    return { status: 'ready', profile };
  }

  /**
   * End a round whose owner Session has no profile: the request cannot be
   * dispatched on that line, and the round must not sit pending forever. The
   * `end_unbound` identity is derived from the round, so a retried pass reuses
   * the original receipt.
   */
  async function endUnbound(
    ctx: CoreCallContext, round: QueryJobRef,
  ): Promise<{ status: 'progressed' } | { status: 'blocked' }> {
    let appended: Awaited<ReturnType<RequestRoundPort['append']>>;
    try {
      appended = await deps.rounds.append(ctx, { command: {
        kind: 'end_unbound', operationId: endUnboundOperationId(round), round: { ...round },
      } });
    } catch (error) {
      throw new Error(`the end_unbound append failed: ${messageOf(error)}`);
    }
    if (appended.status === 'ended') return { status: appended.replayed ? 'blocked' : 'progressed' };
    if (appended.status === 'rejected') {
      // A read failure is the pass's failure; a stable refusal means the round
      // changed under this read and waits for the next change.
      if (appended.code === 'unavailable') throw new Error(`the end_unbound append failed: ${appended.reason}`);
      return { status: 'blocked' };
    }
    throw new Error('the end_unbound command appended a round');
  }

  /**
   * One pass of `request-rounds`.
   *
   * The traversal is bounded per partition (at most REQUEST_PASS_PAGES pages)
   * and its state is the pass's continuation: a partition that has not wrapped
   * resumes after its last entry on the next pass, the fresh rounds found so
   * far wait in it until both partitions have wrapped, and the work the advance
   * cap left unlaunched is carried to the next pass, which launches it before
   * a new traversal starts. A choice that no longer holds when it is read again
   * starts the traversal over instead. Nothing is confirmed until the pass
   * returns, so a failed read leaves the loop's previous continuation in place
   * and the failed page is read again.
   */
  async function drainRounds(scope: WorkspaceScope,
    input: { continuation: string | null; signal: AbortSignal },
  ): Promise<RequestQueuePassV1> {
    if (closed) {
      return { progressed: 0, more: false, continuation: input.continuation, wrapped: false, blocked: 0 };
    }
    const traversal = decodeTraversal(input.continuation);
    const ctx = deps.context(scope, input.signal);
    const state = stateOf(scope);
    let blocked = 0;

    /** The requests this pass read, so a request is read once per pass and nothing launches from an older read. */
    const works = new Map<string, RequestWork>();
    async function workFor(root: QueryJobRef): Promise<RequestWork> {
      const key = keyOf(root);
      const known = works.get(key);
      if (known !== undefined) return known;
      const work = workOf(root, await readFacts(ctx, root));
      works.set(key, work);
      return work;
    }

    if (!traversalComplete(traversal)) {
      const roots = new Map<string, QueryJobRef>();
      for (const status of PARTITIONS) {
        if (traversal.done[status]) continue;
        for (let page = 0; page < REQUEST_PASS_PAGES; page += 1) {
          const read = await deps.rounds.open(ctx, scope, {
            status, limit: REQUEST_PAGE_SIZE, continuation: traversal.cursors[status],
          });
          if (read.status !== 'ready') {
            throw new Error(`the ${status} open request rounds could not be read: ${
              read.status === 'rejected' ? `${read.code}: ${read.reason}` : read.status}`);
          }
          traversal.cursors[status] = read.value.continuation;
          for (const root of read.value.requests) {
            const key = keyOf(root);
            if (!roots.has(key)) roots.set(key, { ...root });
          }
          // A wrapped page ends this partition's reach for the traversal; the
          // next traversal starts it at the first entry again.
          if (read.value.wrapped || read.value.continuation === null) {
            traversal.done[status] = true;
            traversal.cursors[status] = null;
            break;
          }
        }
      }

      for (const root of roots.values()) {
        // The loop is closing: nothing this pass read is confirmed, so the
        // continuation the loop handed in is the one to keep.
        if (input.signal.aborted) {
          return { progressed: 0, more: false, continuation: input.continuation, wrapped: false, blocked };
        }
        const work = await workFor(root);
        if (work.blocked) blocked += 1;
        for (const attempt of work.attempts) {
          if (!traversal.attempts.some((known) => sameJson(known.run, attempt.run))) traversal.attempts.push(attempt);
        }
        // Rule 2's rounds are only collected while the traversal is read: a
        // pick waits until both partitions have wrapped, so it is made against
        // every request of the workspace, not a partial page.
        if (work.fresh !== null) keepOldest(traversal, work.fresh);
      }
    }

    let progressed = 0;
    let launched = 0;
    /** The advance cap, a closing Host or an aborted pass leaves the rest of the work to the next pass. */
    const mustWait = (): boolean => closed || input.signal.aborted || launched >= REQUEST_ADVANCES_PER_PASS;

    // Rule 1: an attempt someone already holds moves on its own Session. Its
    // claim froze the profile, so the driver needs none here.
    const waitingAttempts: Candidate[] = [];
    for (const found of traversal.attempts) {
      if (mustWait()) { waitingAttempts.push(found); continue; }
      const attempt = (await workFor(found.requestRoot)).attempts.find((current) => sameJson(current.run, found.run));
      // The attempt moved on since it was found; the commit that moved it woke
      // the queue, and the next traversal reads it again.
      if (attempt === undefined) continue;
      if (busy(state, attempt.session)) { blocked += 1; continue; }
      launched += 1;
      launch(state, scope, ctx, attempt.session, attempt.round, attempt.run, null);
    }
    traversal.attempts = waitingAttempts;

    /** A choice of this traversal no longer holds: the traversal is read again before the pass may wrap. */
    let stale = false;
    if (traversalComplete(traversal)) {
      // Rule 2: one fresh round per owner Session, the oldest across the
      // requests it owns over the whole traversal, launched oldest first, with
      // that Session's profile. A choice holds while its request, read now,
      // still offers the same dispatchable round and Run on the same owner.
      // One that does not was made from facts that changed after they were
      // read (a drop, a route, a claim), and so were the choices of both
      // Sessions it names: the old owner's next round and the new owner's
      // oldest may each be another request's. Neither Session starts anything,
      // and the traversal is read again, because the commit that changed the
      // request woke the queue for this pass and no later wake brings those
      // rounds back.
      const waitingRounds: Candidate[] = [];
      const holding: Candidate[] = [];
      const staleSessions = new Set<string>();
      for (const found of [...traversal.candidates].sort(compareCandidates)) {
        if (closed || input.signal.aborted) { waitingRounds.push(found); continue; }
        const work = await workFor(found.requestRoot);
        const fresh = work.fresh;
        if (fresh !== null && sameJson(fresh.round, found.round) && sameJson(fresh.run, found.run)
          && sessionKeyOf(fresh.session) === sessionKeyOf(found.session)) {
          holding.push(fresh);
          continue;
        }
        if (work.blocked) blocked += 1;
        staleSessions.add(sessionKeyOf(found.session));
        if (fresh !== null) staleSessions.add(sessionKeyOf(fresh.session));
      }
      stale = staleSessions.size > 0;
      for (const fresh of holding) {
        if (staleSessions.has(sessionKeyOf(fresh.session))) continue;
        if (mustWait()) { waitingRounds.push(fresh); continue; }
        if (busy(state, fresh.session)) { blocked += 1; continue; }
        const target = await ownerTarget(scope, ctx, fresh.session);
        if (target.status === 'skipped') { blocked += 1; continue; }
        launched += 1;
        if (target.profile === null) {
          const ended = await endUnbound(ctx, fresh.round);
          if (ended.status === 'progressed') progressed += 1;
          else blocked += 1;
          continue;
        }
        launch(state, scope, ctx, fresh.session, fresh.round, fresh.run, target.profile);
      }
      // The traversal read again finds every round it has not launched, so only
      // a traversal whose choices all held carries them.
      traversal.candidates = stale ? [] : waitingRounds;
    }

    const finished = !stale && traversalComplete(traversal)
      && traversal.attempts.length === 0 && traversal.candidates.length === 0;
    if (finished || stale) {
      // Everything this traversal found was processed, or one of its choices
      // no longer holds: the next pass starts both partitions at their first
      // entry again.
      traversal.cursors = { pending: null, running: null };
      traversal.done = { pending: false, running: false };
    }
    return {
      progressed,
      // Another pass is needed while a partition still has unread entries,
      // while found work waits for its launch, while the traversal is read
      // again, or while something changed here. A finished traversal whose
      // work was all skipped for another reason parks: that Session's own
      // wake brings the pass back.
      more: !finished || progressed > 0,
      continuation: encodeTraversal(traversal),
      wrapped: finished,
      blocked,
    };
  }

  async function drainUnassigned(scope: WorkspaceScope,
    input: { continuation: string | null; signal: AbortSignal },
  ): Promise<RequestQueuePassV1> {
    // A stop before the pass starts leaves the drain untouched; the loop is
    // closing and the records keep the requests for the next Host.
    if (closed || input.signal.aborted) {
      return { progressed: 0, more: false, continuation: input.continuation, wrapped: false, blocked: 0 };
    }
    const ctx = deps.context(scope, input.signal);
    let read: Awaited<ReturnType<typeof deps.drain>>;
    try {
      read = await deps.drain(ctx, scope, {
        maxRequests: REQUEST_DRAINED_PER_PASS, continuation: input.continuation,
      });
    } catch (error) {
      throw new Error(`the unassigned drain failed: ${messageOf(error)}`);
    }
    if (read.status !== 'ready') {
      throw new Error(`the unassigned drain failed: ${
        read.status === 'rejected' ? `${read.code}: ${read.reason}` : read.status}`);
    }
    return read.value;
  }

  return {
    rounds: {
      async rebuild(scope) {
        // Read-only: the traversal cursors and the unlaunched work live in the
        // continuation the loop keeps per queue, which a registration creates
        // at null, so this queue has no traversal state of its own to reset.
        void scope;
      },
      drain(scope, input) {
        return drainRounds(scope, input);
      },
    },
    unassigned: {
      async rebuild() {
        // Nothing to rebuild: every pass starts from the continuation the loop
        // hands it and re-reads each request, so this queue keeps no state.
      },
      drain(scope, input) {
        return drainUnassigned(scope, input);
      },
    },
    async settle() {
      closed = true;
      // Never throws: `close()` must finish even when an advance failed. An
      // advance that settles during this wait may start one more back-off, so
      // the wait repeats until both maps are empty.
      try {
        for (const state of states.values()) {
          while (state.inFlight.size > 0 || state.backoffs.size > 0) {
            await Promise.allSettled([...state.inFlight.values(), ...state.backoffs.values()]);
          }
        }
      } catch {
        // A settle wait cannot fail; allSettled already absorbed every result.
      }
    },
  };
}
