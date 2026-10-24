/**
 * The ONE stage chain of a Query attempt: claim a request round on its current
 * owner, prepare and start the attempt, then observe it. Every stage calls one
 * owner and reports `progressed`, `terminal` or `blocked`, so callers never
 * re-implement the dispatch, the claim or the outcome mapping.
 *
 * Every stage identity is derived from the Run it moves: a request round uses
 * `request-claim:` / `request-prepare:` / `request-start:`, a plain Query the
 * consultation's own `consultation-prepare:` / `consultation-start:`, so the
 * caller passes the attempt and never a name.
 *
 * The phase is the dispatch key, never the Job status: a claimed or prepared
 * attempt keeps the pending QueryJob and QueryRun statuses, so the Job alone
 * cannot tell a fresh round from one that already holds a Session.
 */
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { SessionRef, VersionPin } from '../../contracts/core/identity.js';
import type { PreparedQueryExecution } from '../../contracts/core/prepared-execution.js';
import { rejected } from '../../contracts/core/rejections.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../contracts/core/results.js';
import { canonicalJson, sameJson, type JsonValue } from '../../contracts/fingerprint.js';
import {
  isRequestRound, type QueryExecutionStateV1, type QueryJobAnswerSnapshot, type QueryJobRef, type QueryJobSnapshot,
  type QueryRunRef, type QueryRunSnapshot,
} from '../../contracts/query-job.js';
import type { RuntimeExecutionPort } from '../../core/agent-runtime/ports.js';
import type { QueryJobRecord, QueryJobPort } from '../../core/work-graph/queries/contracts.js';
import type { SecretaryProfileV1 } from '../../core/work-graph/model/request-contracts.js';
import type { GraphWrite } from '../../core/work-graph/model/task-contracts.js';
import { plainSessionRefToAggregate } from '../../core/work-graph/sessions/session-record-codecs.js';
import type { RequestFactsReader } from '../../core/work-graph/tasks/request-service.js';

type Attempt = { job: QueryJobSnapshot; run: QueryRunSnapshot };

type Blocked = { status: 'blocked'; retry: 'on_change' | 'backoff'; reason: string };

export type QueryStageOutcome =
  | { status: 'progressed' }
  | { status: 'terminal' }
  | Blocked;

export type QueryStageAdvanceInput = {
  queryJobRef: QueryJobRef;
  expectedRunRef: QueryRunRef;
  profile: SecretaryProfileV1 | null;
};

export interface QueryStageDriver {
  advance(ctx: CoreCallContext, input: QueryStageAdvanceInput): Promise<QueryStageOutcome>;
}

export type QueryStageDriverDependencies = {
  /** The Query owner's pending read and claim; the driver is its only stage caller. */
  queries: QueryJobPort;
  runtime: Pick<RuntimeExecutionPort, 'prepareQuery' | 'startQuery' | 'observeQuery'>;
  /**
   * The request facts read a claim needs: the current owner AND the revision of
   * its Session record, which the claim pins. It is the same complete read the
   * `ownerOf` projection comes from, so a claim needs no second read.
   */
  facts: Pick<RequestFactsReader, 'readFacts'>;
  /**
   * The Host consumer id a plain-Query start records, bound by the caller that
   * builds this driver. A request round never reads it: its claim froze the
   * secretary profile's own consumer id.
   */
  consumerId?: string;
};

/** The read-only projection of a formally closed or settled QueryRun: no Answer will follow. */
export function queryRunEndedWithoutAnswer(record: QueryJobRecord): boolean {
  return record.run.run.status === 'closed' || record.run.run.executionState?.phase === 'settled';
}

function blocked(retry: 'on_change' | 'backoff', reason: string): Blocked {
  return { status: 'blocked', retry, reason };
}

/**
 * The ONE outcome table. A conflict, an occupied Session, a stable rejection or
 * a fixed capacity/budget limit waits for the next change (an input or a
 * configuration change is what can lift it), because the same call cannot
 * succeed until something else moves; a read failure or an unread watermark
 * backs off, because a later pass may succeed with nothing changed.
 */
function blockedOutcome(stage: string, failure: CoreRejection): Blocked {
  const reason = `${stage} failed: ${failure.code}: ${failure.reason}`;
  switch (failure.code) {
    case 'revision_conflict': // a conflict: a record moved under this read
    case 'idempotency_conflict': // a conflict: the identity already names other content
    case 'busy': // an occupied Session or another owner's attempt
    case 'invalid': // a stable rejection: the round's own shape is wrong
    case 'forbidden': // a stable rejection: the caller may not touch it
    case 'not_found': // a stable rejection: the named record does not exist
    case 'unsupported': // a stable rejection: this Host installed no such binding
    case 'source_stale': // a stable rejection: the source is no longer current
    case 'cycle': // a stable rejection: the request's own structure forbids it
    case 'dependency_blocked': // a stable rejection: a required owner is closing
    case 'capacity': // a fixed capacity or budget limit: waits for input or configuration to change
      return blocked('on_change', reason);
    case 'unavailable': // a read failure
    case 'incomplete': // a read did not reach its required watermark yet
    case 'cancelled': // an aborted pass: a fresh start re-drives the round
      return blocked('backoff', reason);
  }
}

function blockedRead(stage: string, result: Exclude<ReadResult<unknown>, { status: 'ready' }>): Blocked {
  if (result.status === 'not_found') return blockedOutcome(stage, rejected('not_found', 'the record does not exist'));
  if (result.status === 'not_ready') return blockedOutcome(stage, rejected('incomplete', 'the read did not reach its required watermark'));
  return blockedOutcome(stage, result);
}

function blockedWrite(stage: string, result: Exclude<WriteResult<unknown>, { status: 'committed' }>): Blocked {
  return blockedOutcome(stage, result);
}

function attemptOutcome(record: { job: QueryJobSnapshot; run: QueryRunSnapshot; answer: QueryJobAnswerSnapshot | null }): QueryStageOutcome {
  if (record.answer !== null) return { status: 'terminal' };
  return queryRunEndedWithoutAnswer(record) ? { status: 'terminal' } : { status: 'progressed' };
}

export function createQueryStageDriver(deps: QueryStageDriverDependencies): QueryStageDriver {
  /**
   * Claim the round on the request's current owner, then drive the attempt the
   * claim created. The owner is read at this moment (never from a snapshot the
   * caller took earlier), and the given profile is the one the attempt runs
   * with; no stage re-resolves it.
   */
  async function claimRequestRound(
    ctx: CoreCallContext, input: QueryStageAdvanceInput, record: Attempt,
  ): Promise<QueryStageOutcome> {
    const requestRoot = record.job.job.requestRoot;
    if (requestRoot === null) {
      return blocked('on_change', 'claiming the request round failed: the round names no request root');
    }
    if (input.profile === null) {
      return blocked('on_change', 'claiming the request round failed: a request round is claimed only with its secretary profile');
    }
    const facts = await deps.facts.readFacts(ctx, { requestRoot });
    if (facts.status !== 'ready') return blockedRead('reading the request owner', facts);
    const owner = facts.value.owner;
    if (owner === null) {
      return blocked('on_change', 'claiming the request round failed: the request has no live owner');
    }
    // The claim pins the Session record it occupies, so the facts read's own
    // guard is the revision to expect; nothing else in the read may stand in.
    const ownerRef = plainSessionRefToAggregate(owner);
    const ownerKey = canonicalJson(ownerRef as unknown as JsonValue);
    const guard = facts.value.guards.find((candidate) => candidate.refKey === ownerKey);
    if (guard === undefined || guard.expectedRevision === null) {
      return blocked('backoff', 'claiming the request round failed: the owner Session record has no revision to pin');
    }
    const expected: VersionPin[] = [
      { ref: record.job.ref, revision: record.job.revision },
      { ref: record.run.ref, revision: record.run.revision },
      { ref: ownerRef, revision: guard.expectedRevision },
    ];
    const request: GraphWrite<{ queryRunRef: QueryRunRef; sessionRef: SessionRef; profile: SecretaryProfileV1 }> = {
      input: { queryRunRef: record.run.ref, sessionRef: owner, profile: input.profile },
      meta: { requestId: `request-claim:${record.run.run.runId}`, expected },
    };
    const claimed = await deps.queries.claimQuery(ctx, request);
    if (claimed.status !== 'committed') return blockedWrite('claiming the request round', claimed);
    const claimedState = claimed.value.run.run.executionState;
    if (claimedState === undefined) throw new Error('a committed request-round claim carries no execution state');
    return advanceAttempt(ctx, { job: claimed.value.job, run: claimed.value.run }, claimedState, true);
  }

  /**
   * Prepare (only a claimed attempt) and start the attempt as it is saved: its
   * Session and profile live in its execution state, so a started or abandoned
   * attempt is never claimed again here.
   */
  async function advanceAttempt(
    ctx: CoreCallContext, record: Attempt, state: QueryExecutionStateV1, claimed: boolean,
  ): Promise<QueryStageOutcome> {
    const requestRound = isRequestRound(record.job);
    const runId = record.run.run.runId;
    // A request round's stage identities are fixed; a plain Query keeps the
    // consultation's own byte-identical names.
    const prepareId = requestRound ? `request-prepare:${runId}` : `consultation-prepare:${runId}`;
    const startId = requestRound ? `request-start:${runId}` : `consultation-start:${runId}`;
    let prepared: PreparedQueryExecution;
    if (claimed) {
      if (deps.runtime.prepareQuery === undefined) {
        return blocked('on_change', 'preparing the attempt failed: the Runtime has no Query prepare binding');
      }
      const result = await deps.runtime.prepareQuery(ctx, { queryRunRef: record.run.ref, requestId: prepareId });
      if (result.status !== 'ready') return blockedRead('preparing the attempt', result);
      prepared = result.value;
    } else {
      // The persisted prepared pins are the whole start input: the manifest is
      // read from the bundle, so no second preparation happens.
      const frozen = state.prepared;
      if (frozen === null) throw new Error('a prepared QueryRun carries no frozen manifest reference');
      prepared = { queryRunRef: record.run.ref, bundleRef: frozen.bundleRef, inputDigest: frozen.inputDigest };
    }
    if (deps.runtime.startQuery === undefined) {
      return blocked('on_change', 'starting the attempt failed: the Runtime has no Query start binding');
    }
    // A request round starts under the consumer id its claim froze; a plain
    // Query under the Host consumer id the caller bound to this driver.
    let consumerId: string;
    if (requestRound) {
      const profile = state.requestProfile;
      if (profile === null) throw new Error('a request round attempt carries no claimed profile');
      consumerId = profile.consumerId;
    } else {
      if (deps.consumerId === undefined) throw new Error('a plain-Query driver was built without a Host consumer id');
      consumerId = deps.consumerId;
    }
    const started = await deps.runtime.startQuery(ctx, { prepared, consumerId, requestId: startId });
    if (started.status === 'ready') return attemptOutcome(started.value);
    if (started.status === 'rejected' && started.code === 'busy') {
      const replaced = await replacedAttempt(ctx, record.job.ref, record.run.ref);
      if (replaced !== null) return replaced;
    }
    return blockedRead('starting the attempt', started);
  }

  /**
   * A `busy` start has several causes. ONLY the abandoned attempt, which leaves
   * the round pending on a NEW Run, has progressed: every other busy (an
   * occupied Session, another owner's live attempt) follows the ordinary table.
   */
  async function replacedAttempt(
    ctx: CoreCallContext, queryJobRef: QueryJobRef, expectedRunRef: QueryRunRef,
  ): Promise<QueryStageOutcome | null> {
    const read = await deps.queries.readQueryJob(ctx, queryJobRef);
    if (read.status !== 'ready') return blockedRead('re-reading the round after a busy start', read);
    const current = read.value;
    if (current.job.job.status !== 'pending' || current.run.run.status !== 'pending') return null;
    if (!sameJson(current.job.job.runRef, current.run.ref)) return null;
    if (sameJson(current.job.job.runRef, expectedRunRef)) return null;
    return { status: 'progressed' };
  }

  /**
   * Observe a begun attempt; an `unknown` attempt is only observed, never
   * advanced. The observation is the attempt's own record, so an unchanged
   * record is not progress: only a record that moved is.
   */
  async function observe(ctx: CoreCallContext, record: Attempt): Promise<QueryStageOutcome> {
    if (deps.runtime.observeQuery === undefined) {
      return blocked('on_change', 'observing the attempt failed: the Runtime has no Query observation binding');
    }
    const observed = await deps.runtime.observeQuery(ctx, { queryRunRef: record.run.ref });
    if (observed.status !== 'ready') return blockedRead('observing the attempt', observed);
    const outcome = attemptOutcome(observed.value);
    if (outcome.status !== 'progressed') return outcome;
    if (observed.value.job.revision === record.job.revision
      && observed.value.run.revision === record.run.revision) {
      return blocked('on_change', 'the attempt has not changed');
    }
    return { status: 'progressed' };
  }

  return {
    async advance(ctx, input) {
      const read = await deps.queries.readQueryJob(ctx, input.queryJobRef);
      if (read.status !== 'ready') return blockedRead('reading the round', read);
      const record = read.value;
      if (!sameJson(record.run.ref, input.expectedRunRef) || !sameJson(record.job.job.runRef, input.expectedRunRef)) {
        // The round moved to another attempt (an abandoned start replaces its
        // Run); this advance must never drive the attempt it was launched for.
        return { status: 'progressed' };
      }
      const state = record.run.run.executionState;
      if (state === undefined) {
        if (isRequestRound(record.job)) return claimRequestRound(ctx, input, record);
        // A plain Query is claimed by the caller that chose its Session;
        // without an execution state there is no attempt to prepare here.
        return blocked('on_change', 'advancing the attempt failed: the Query has no claimed attempt');
      }
      switch (state.phase) {
        case 'claimed':
        case 'prepared':
          return advanceAttempt(ctx, record, state, state.phase === 'claimed');
        case 'entering':
        case 'entered':
        case 'settled':
        case 'unknown':
          return observe(ctx, record);
      }
    },
  };
}
