/**
 * The request-round claims and plans both request owners commit.
 *
 * `W/queries` may not import `W/tasks`, so the request owner
 * (`tasks/request-service.ts`) and the Query owner (`query-execution.ts`) share
 * these: the canonical record key, the request's root, the `request-tail`
 * no-op claim, and the plans of the start check and of a request round's
 * not-entered recovery. Pure: no store, no clock. Each plan returns the records
 * of one commit, built by the state constructors, with the claims it moves and
 * the guards of the facts it read (`readRequestRounds`); the owner adds its own
 * pins and merges them through `mergeGuards`.
 *
 * Every intake change here is a release of the key a round's own
 * `intakeSession` names, never found through the executing Session, and a
 * commit changes one intake key once.
 */
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { CoreRejection } from '../../../contracts/core/results.js';
import { rejectedWithNonEmptyCurrent } from '../../../contracts/core/rejections.js';
import type { SessionRecord } from '../../../contracts/core/session.js';
import { canonicalKey as keyOf, sameJson } from '../../../contracts/fingerprint.js';
import type {
  QueryJobRef, QueryJobSnapshot, QueryRunSnapshot, SecretaryRoundMaterialV1,
} from '../../../contracts/query-job.js';
import type { RecordGuard, UniqueClaimChange } from '../../record-store/ports.js';
import { requestTailKey, secretaryIntakeKey } from '../model/request-contracts.js';
import { mergeGuards } from '../persistence/record-guards.js';
import type { QueryLifecycleRecords } from '../state/query-run-recovery.js';
import {
  absorbRound, endUnstartedRound, newAttempt, recordAbsorbedRounds, setIntake,
} from '../state/request-rounds.js';
import { releaseUnenteredQuerySession } from '../state/session-availability.js';
import type { RequestRoundsFactsV1 } from './request-rounds-read.js';

/** A no-op tail CAS: `end_unbound` adds no round but still excludes a concurrent append. */
export function noopTailClaim(facts: RequestRoundsFactsV1): UniqueClaimChange {
  const tailKey = keyOf(facts.tail.ref);
  return { claimKey: requestTailKey(rootOfFacts(facts)), expectedOwner: tailKey, nextOwner: tailKey };
}

export function rootOfFacts(facts: RequestRoundsFactsV1): QueryJobRef {
  const root = facts.rounds.find((round) => round.job.roundKind === 'request');
  if (root === undefined) throw new Error('request-service: the facts name no request root');
  return { ...root.ref };
}

// ------------------------------------------------------------------------ //
// The start check                                                          //
// ------------------------------------------------------------------------ //

export type RequestStartCheck = { kind: 'pass' } | { kind: 'abandon'; trigger: 'owner_changed' | 'owner_archived' };

/**
 * An attempt starts only on the request's current owner. An archived owner
 * without a successor, another owner, or a request left waiting abandons the
 * attempt; the round stays pending for the new owner or the drain.
 */
export function requestStartCheck(facts: RequestRoundsFactsV1, attemptSession: SessionRef): RequestStartCheck {
  if (facts.ownerState === 'owner_archived') return { kind: 'abandon', trigger: 'owner_archived' };
  const owner = facts.owner;
  if (owner !== null && owner.projectId === attemptSession.projectId && owner.sessionId === attemptSession.sessionId) {
    return { kind: 'pass' };
  }
  return { kind: 'abandon', trigger: 'owner_changed' };
}

/** A batch round as its preparation froze it: the Job and Run revisions it read. */
export type FrozenBatchRound = Pick<SecretaryRoundMaterialV1, 'ref' | 'revision' | 'runRef' | 'runRevision'>;

export type RequestStartPlan = {
  /** The executing Job after its intake release and the absorbed list. */
  job: QueryJobSnapshot;
  /** Each batch round closed `not_entered` into the executing round. */
  absorbed: QueryLifecycleRecords[];
  claims: UniqueClaimChange[];
  guards: RecordGuard[];
};

/**
 * A passing start (`entering` is the executing pair after its entering step):
 * each batch round, guarded at its frozen Job and Run revisions, is absorbed
 * and releases any intake it holds; the executing round releases the intake it
 * holds and lists the absorbed rounds; the request tail is held still, so a
 * concurrent append, route or drop conflicts with the start. A batch round an
 * earlier attempt of this round already absorbed (a new attempt's preparation
 * keeps it in the batch) keeps its frozen guards and changes no further.
 */
export function requestStartPass(input: {
  entering: QueryLifecycleRecords;
  facts: RequestRoundsFactsV1;
  batch: readonly FrozenBatchRound[];
  occurredAt: string;
}): RequestStartPlan | CoreRejection {
  const { entering, facts } = input;
  if (roundOf(facts, entering.job.ref) === undefined) return invalid('the executing round is not a round of its request');
  const frozen: RecordGuard[] = [];
  const seen = new Set<string>();
  for (const entry of input.batch) {
    const key = keyOf(entry.ref);
    if (seen.has(key)) return invalid('the batch names a round twice');
    seen.add(key);
    frozen.push({ refKey: key, expectedRevision: entry.revision }, { refKey: keyOf(entry.runRef), expectedRevision: entry.runRevision });
  }
  const merged = mergeGuards([...facts.guards, ...frozen]);
  if (!merged.ok) return merged.rejection;

  const batch: QueryLifecycleRecords[] = [];
  for (const entry of input.batch) {
    const job = roundOf(facts, entry.ref);
    const run = facts.runs.find((candidate) => sameJson(candidate.ref, entry.runRef));
    if (job === undefined || run === undefined || !sameJson(job.job.runRef, entry.runRef)) {
      return invalid('a batch round is not a pending round of this request');
    }
    if (absorbedBefore(job, entering.job)) continue;
    // A batch never meets a claimed round (the request has one live attempt),
    // so the executing round is never part of its own batch.
    if (job.job.status !== 'pending' || run.run.status !== 'pending' || run.run.executionState !== undefined) {
      return invalid('a batch round is no longer pending');
    }
    batch.push({ job, run });
  }

  const released = intakeReleases([entering.job, ...batch.map((records) => records.job)]);
  if (!Array.isArray(released)) return released;
  let job = setIntake(entering.job, null);
  if (batch.length > 0) job = recordAbsorbedRounds(job, batch.map((records) => ({ ...records.job.ref })));
  const absorbed = batch.map((records) => absorbRound({ job: setIntake(records.job, null), run: records.run },
    { into: entering.job.ref, occurredAt: input.occurredAt }));
  return { job, absorbed, claims: [noopTailClaim(facts), ...released], guards: merged.guards };
}

// ------------------------------------------------------------------------ //
// New attempts and the drop's cover                                        //
// ------------------------------------------------------------------------ //

export type RequestAttemptPlan = {
  job: QueryJobSnapshot;
  oldRun: QueryRunSnapshot;
  newRun: QueryRunSnapshot;
  claims: UniqueClaimChange[];
  guards: RecordGuard[];
};

/**
 * A start that finds another owner, or an archived one: a new attempt on the
 * same Job, the intake the round holds released, and the old attempt's Session
 * occupancy released as a Query terminal releases it (SES-08, the history
 * cursor kept; the request owner's drop uses the same release). `session` is
 * null when the old attempt no longer holds the Session.
 */
export function requestAbandon(input: {
  records: QueryLifecycleRecords;
  facts: RequestRoundsFactsV1;
  trigger: 'owner_changed' | 'owner_archived';
  session: SessionRecord;
  occurredAt: string;
}): (RequestAttemptPlan & { session: SessionRecord | null }) | CoreRejection {
  const attempt = attemptPlan(input.records, input.facts, input.trigger, true, input.occurredAt);
  if ('status' in attempt) return attempt;
  const released = releaseUnenteredQuerySession(input.session, input.records.run);
  if (!released.ok) return rejectedWithNonEmptyCurrent(released.code, released.detail);
  return { ...attempt, session: released.released };
}

/**
 * QRR-01/02 on a request round no drop covers: a new attempt on the same Job.
 * The intake stays with the round (a claimed or prepared holder keeps it; an
 * entering round released it at its start). The Session release is the
 * recovery row's own.
 */
export function requestRetry(input: {
  records: QueryLifecycleRecords;
  facts: RequestRoundsFactsV1;
  occurredAt: string;
}): RequestAttemptPlan | CoreRejection {
  return attemptPlan(input.records, input.facts, 'not_entered', false, input.occurredAt);
}

/** Whether a drop of this request covers the round (`readRequestRounds`'s `coveredByDrop`). */
export function coveredByDrop(facts: RequestRoundsFactsV1, round: QueryJobRef): boolean {
  return facts.coveredByDrop.some((ref) => sameJson(ref, round));
}

/**
 * QRR-01/02 on a request round a drop covers: it ends unstarted,
 * `cancelled`/`dropped`, as the drop ends its unstarted rounds; the request
 * tail is held still. Only an entering round can still be open under a drop,
 * and it released its intake at its start.
 */
export function requestDroppedEnd(input: {
  records: QueryLifecycleRecords;
  facts: RequestRoundsFactsV1;
  occurredAt: string;
}): (QueryLifecycleRecords & { claims: UniqueClaimChange[]; guards: RecordGuard[] }) | CoreRejection {
  if (roundOf(input.facts, input.records.job.ref) === undefined) return invalid('the round is not a round of its request');
  const ended = endUnstartedRound(input.records, { detail: 'dropped', message: 'request_dropped', occurredAt: input.occurredAt });
  return { ...ended, claims: [noopTailClaim(input.facts)], guards: [...input.facts.guards] };
}

// ------------------------------------------------------------------------ //
// Helpers                                                                  //
// ------------------------------------------------------------------------ //

function attemptPlan(
  records: QueryLifecycleRecords, facts: RequestRoundsFactsV1, trigger: 'owner_changed' | 'owner_archived' | 'not_entered',
  releaseIntake: boolean, occurredAt: string,
): RequestAttemptPlan | CoreRejection {
  if (roundOf(facts, records.job.ref) === undefined) return invalid('the round is not a round of its request');
  const attempt = newAttempt(records, { trigger, occurredAt });
  const claims: UniqueClaimChange[] = [noopTailClaim(facts)];
  let job = attempt.job;
  if (releaseIntake) {
    const released = intakeReleases([records.job]);
    if (!Array.isArray(released)) return released;
    claims.push(...released);
    job = setIntake(job, null);
  }
  // The new Run must not exist yet: a replayed decision makes no second Run.
  const guards: RecordGuard[] = [...facts.guards, { refKey: keyOf(attempt.newRun.ref), expectedRevision: null }];
  return { job, oldRun: attempt.oldRun, newRun: attempt.newRun, claims, guards };
}

/**
 * The release of each intake these rounds hold, found by the round's own
 * `intakeSession`. The store refuses a key changed twice in one commit, and a
 * key has one holder, so two rounds naming one key are refused.
 */
function intakeReleases(rounds: readonly QueryJobSnapshot[]): UniqueClaimChange[] | CoreRejection {
  const claims: UniqueClaimChange[] = [];
  for (const round of rounds) {
    const session = round.job.intakeSession;
    if (session === null) continue;
    const claimKey = secretaryIntakeKey(session);
    if (claims.some((claim) => claim.claimKey === claimKey)) return invalid('two rounds hold one secretary intake');
    claims.push({ claimKey, expectedOwner: keyOf(round.ref), nextOwner: null });
  }
  return claims;
}

/** A round an earlier attempt of the executing round absorbed: closed into it and listed by it. */
function absorbedBefore(round: QueryJobSnapshot, executing: QueryJobSnapshot): boolean {
  return round.job.status === 'closed' && sameJson(round.job.absorbedInto, executing.ref)
    && executing.job.absorbedRounds.some((ref) => sameJson(ref, round.ref));
}

function roundOf(facts: RequestRoundsFactsV1, ref: QueryJobRef): QueryJobSnapshot | undefined {
  return facts.rounds.find((round) => sameJson(round.ref, ref));
}

function invalid(reason: string): CoreRejection {
  return rejectedWithNonEmptyCurrent('invalid', reason);
}
