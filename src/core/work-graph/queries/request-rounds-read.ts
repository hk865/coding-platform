/**
 * The complete fact read of ONE request's rounds (`RequestRoundsFactsV1`).
 *
 * It reads every page of `s6-query-by-request` for the root, re-reading until the
 * `readThrough` watermark is stable, re-checks each candidate against
 * the canonical record, then reads the rounds' QueryRuns, the owner's Session
 * (and, when that Session is archived, its live successor through the provenance
 * index), and the root's creation event for the initiator. The creation event is
 * the one the root's `since` binds, so the read needs no commit locator. It
 * writes nothing.
 *
 * The owner rule is `deriveRequestOwner`, the one pure
 * implementation this read and the pure tests share.
 *
 * Every failure other than "not a request root of this workspace" is
 * `unavailable`: a failed or inconsistent read never becomes "no operator",
 * "no owner" or an empty round set.
 */
import type { ActorRef, CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { SessionProvenanceV1, SessionRecord } from '../../../contracts/core/session.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import { seqOfCommitCursor } from '../../../contracts/ledger.js';
import type { QueryJobRef, QueryJobSnapshot, QueryRunSnapshot } from '../../../contracts/query-job.js';
import type { RecordLookupPort, RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import type { EncodedRecord, GoalRecordTransactionPort, RecordGuard } from '../../record-store/ports.js';
import { readAllOrdered } from '../persistence/lookup-ordered-all.js';
import {
  decodeQueryJobSnapshot, decodeQueryJobSubmittedEvent, decodeQueryRunSnapshotRecord,
} from './query-record-codecs.js';
import { QUERY_BY_REQUEST_INDEX, REQUEST_PAGE_SIZE } from '../model/request-contracts.js';
import { SESSION_BY_PROVENANCE_LOOKUP } from '../model/session-facts-contracts.js';
import { decodeSessionRecord, plainSessionRefToAggregate } from '../sessions/session-record-codecs.js';
import type { RequestOwnerStateV1 } from '../model/request-contracts.js';

/** How often a complete read is retried while the request window keeps moving. */
const COMPLETE_READ_ATTEMPTS = 4;

/**
 * The store surface the read needs. The initiator comes from the
 * root's creation event, which the root's own `since` locates, so the frozen
 * `readMany` / `eventAt` pair is enough.
 */
export type RequestRoundsStore =
  Pick<GoalRecordTransactionPort, 'readMany' | 'eventAt'> & RecordLookupPort & RecordOrderedLookupPort;

export type RequestRoundsFactsV1 = {
  rounds: QueryJobSnapshot[];
  runs: QueryRunSnapshot[];
  tail: QueryJobSnapshot;
  owner: SessionRef | null;
  ownerState: RequestOwnerStateV1;
  /**
   * The latest ownership-bearing round's Session before successor resolution;
   * null when that round is waiting or a drop. An archived owner
   * with a live successor keeps this Session while `owner` is the successor.
   */
  lastOwner: SessionRef | null;
  effectiveGoalId: string | null;
  requestGoalId: string | null;
  initiator: Extract<ActorRef, { kind: 'human' | 'system' }>;
  coveredByDrop: QueryJobRef[];
  guards: RecordGuard[];
  watermark: CommitCursor | null;
};

function unavailable(reason: string): { status: 'rejected'; code: 'unavailable'; reason: string } {
  return { status: 'rejected', code: 'unavailable', reason };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function keyOfRef(ref: unknown): string {
  return canonicalJson(ref as JsonValue);
}

/** The store's cursor sequence when both are ledger cursors; textual order otherwise. */
function compareCursors(left: CommitCursor, right: CommitCursor): number {
  try {
    return Math.sign(seqOfCommitCursor(left) - seqOfCommitCursor(right));
  } catch {
    return String(left).localeCompare(String(right));
  }
}

function sameCursor(left: CommitCursor | null, right: CommitCursor | null): boolean {
  if (left === null || right === null) return left === right;
  return compareCursors(left, right) === 0;
}

function laterCursor(left: CommitCursor | null, right: CommitCursor | null): CommitCursor | null {
  if (left === null) return right;
  if (right === null) return left;
  return compareCursors(left, right) >= 0 ? left : right;
}

/** One round order: `since`, ties by the canonical record key. */
export function compareRequestRounds(left: QueryJobSnapshot, right: QueryJobSnapshot): number {
  const bySince = compareCursors(left.since, right.since);
  if (bySince !== 0) return bySince;
  return keyOfRef(left.ref).localeCompare(keyOfRef(right.ref));
}

function isOwnershipBearing(round: QueryJobSnapshot): boolean {
  return round.job.roundKind !== 'routing' || round.job.routing !== null;
}

function ownershipTarget(round: QueryJobSnapshot): SessionRef | null | 'dropped' {
  if (round.job.roundKind === 'routing') {
    const to = round.job.routing?.to ?? null;
    return to === null ? 'dropped' : to;
  }
  return round.job.assignedSession;
}

/** The latest ownership-bearing round's target, or `null` when no round bears ownership. */
function latestOwnershipTarget(rounds: readonly QueryJobSnapshot[]): SessionRef | 'waiting' | 'dropped' | null {
  const latest = [...rounds].sort(compareRequestRounds).reverse().find(isOwnershipBearing);
  if (latest === undefined) return null;
  const target = ownershipTarget(latest);
  return target === null ? 'waiting' : target;
}

function sessionRefOf(record: SessionRecord): SessionRef {
  return { projectId: record.ref.projectId, sessionId: record.ref.sessionId };
}

/** One Session the owner rule may consult, with the provenance the record carries. */
export type RequestOwnerSessionFactV1 = {
  session: SessionRef;
  lifecycle: 'active' | 'archived';
  provenance: SessionProvenanceV1;
};

/**
 * A secretary's successor is the Session it handed off to. A continuation line
 * carries a task forward and is not a successor: accepting it would let a task
 * line own the request and block the re-pick the request needs.
 */
function handoffFrom(provenance: SessionProvenanceV1, owner: SessionRef): boolean {
  if (provenance.kind !== 'handoff') return false;
  return provenance.from.projectId === owner.projectId && provenance.from.sessionId === owner.sessionId;
}

/**
 * The owner rule of one request. The latest ownership-bearing round
 * in `since` order decides: a non-routing round's `assignedSession`, or a routing
 * round's `to`; a routing `to: null` is a drop and a non-routing `null` is
 * waiting. An assigned Session that is archived resolves through a live
 * successor whose provenance is a `handoff` from it; several
 * live successors would be an ambiguity the platform never writes, and the
 * smallest canonical key is the stable choice.
 *
 * `lastOwner` is the round's Session before that resolution. A damaged or
 * unread Session fact is the caller's to report: the fact must have been read.
 */
export function deriveRequestOwner(
  rounds: readonly QueryJobSnapshot[],
  sessions: readonly RequestOwnerSessionFactV1[],
): { owner: SessionRef | null; ownerState: RequestOwnerStateV1; lastOwner: SessionRef | null } {
  const target = latestOwnershipTarget(rounds);
  if (target === null || target === 'waiting') return { owner: null, ownerState: 'waiting', lastOwner: null };
  if (target === 'dropped') return { owner: null, ownerState: 'dropped', lastOwner: null };
  const fact = sessions.find((candidate) => keyOfRef(candidate.session) === keyOfRef(target));
  if (fact === undefined) throw new Error('deriveRequestOwner: the assigned Session fact was not read');
  const lastOwner = { ...target };
  if (fact.lifecycle === 'active') return { owner: { ...target }, ownerState: 'owned', lastOwner };
  const successors = sessions
    .filter((candidate) => candidate.lifecycle === 'active' && handoffFrom(candidate.provenance, target))
    .sort((left, right) => keyOfRef(left.session).localeCompare(keyOfRef(right.session)));
  const successor = successors[0];
  return successor === undefined
    ? { owner: null, ownerState: 'owner_archived', lastOwner }
    : { owner: { ...successor.session }, ownerState: 'owned', lastOwner };
}

function guardAppend(guards: RecordGuard[], guard: RecordGuard): void {
  if (!guards.some((existing) => existing.refKey === guard.refKey)) guards.push(guard);
}

/**
 * The Sessions the successor index returns for an archived owner. Every page is
 * read and every record guarded; the owner rule above decides which of them is
 * the live successor. A failed page or a damaged record makes the whole read
 * unavailable rather than guessing.
 */
async function readSuccessorFacts(
  store: RequestRoundsStore,
  owner: SessionRef,
  workspaceId: string,
): Promise<{ status: 'ready'; value: { facts: RequestOwnerSessionFactV1[]; guards: RecordGuard[]; watermark: CommitCursor | null } } |
  { status: 'rejected'; code: 'unavailable'; reason: string }> {
  const guards: RecordGuard[] = [];
  const facts: RequestOwnerSessionFactV1[] = [];
  let watermark: CommitCursor | null = null;
  let after: string | undefined;
  for (;;) {
    let page;
    try {
      page = await store.lookup({
        index: SESSION_BY_PROVENANCE_LOOKUP,
        values: [owner.projectId, workspaceId, owner.sessionId],
        ...(after === undefined ? {} : { after }),
        limit: REQUEST_PAGE_SIZE,
      });
    } catch (error) {
      return unavailable(`the successor lookup could not be read: ${messageOf(error)}`);
    }
    if (page.status !== 'ready') return unavailable(`the successor lookup failed: ${page.code}: ${page.reason}`);
    watermark = laterCursor(watermark, page.value.readThrough);
    for (const record of page.value.records) {
      const decoded = decodeSessionRecord(record);
      if (decoded.status !== 'decoded') return unavailable(`a successor Session is damaged: ${decoded.reason}`);
      guardAppend(guards, { refKey: record.refKey, expectedRevision: record.revision });
      facts.push({
        session: sessionRefOf(decoded.value), lifecycle: decoded.value.lifecycle, provenance: decoded.value.provenance,
      });
    }
    if (page.value.next === null) break;
    after = page.value.next;
  }
  return { status: 'ready', value: { facts, guards, watermark } };
}

export async function readRequestRounds(
  store: RequestRoundsStore,
  ctx: CoreCallContext,
  input: { requestRoot: QueryJobRef },
): Promise<ReadResult<RequestRoundsFactsV1>> {
  const requestRoot = input?.requestRoot;
  if (requestRoot === null || requestRoot === undefined || requestRoot.aggregateType !== 'QueryJob'
    || !requestRoot.projectId || !requestRoot.workspaceId || !requestRoot.queryJobId) {
    return { status: 'not_found' };
  }
  // The ref must be a request of THIS call context's workspace; another
  // workspace's ref is "not a request root here", not a foreign read.
  if (requestRoot.projectId !== ctx.projectId || requestRoot.workspaceId !== ctx.workspaceId) {
    return { status: 'not_found' };
  }
  const rootKey = keyOfRef(requestRoot);

  for (let attempt = 0; attempt < COMPLETE_READ_ATTEMPTS; attempt += 1) {
    // Re-read the complete ordered window until its readThrough is
    // stable, so a commit between two pages cannot pass as a complete set.
    let pageRead: { records: EncodedRecord[]; readThrough: CommitCursor | null } | null = null;
    let previousWatermark: CommitCursor | null | undefined;
    for (let stableAttempt = 0; stableAttempt < COMPLETE_READ_ATTEMPTS; stableAttempt += 1) {
      let read;
      try {
        read = await readAllOrdered(store, { index: QUERY_BY_REQUEST_INDEX, values: [ctx.projectId, requestRoot.workspaceId, rootKey],
          direction: 'asc' });
      } catch (error) {
        return unavailable(`the request rounds could not be read: ${messageOf(error)}`);
      }
      if (read.status !== 'ready') return unavailable(`the request rounds read failed: ${read.code}: ${read.reason}`);
      if (previousWatermark !== undefined && sameCursor(previousWatermark, read.value.readThrough)) {
        pageRead = read.value;
        break;
      }
      previousWatermark = read.value.readThrough;
    }
    if (pageRead === null) return unavailable('the request rounds window kept moving while it was being read');
    if (pageRead.records.length === 0) return { status: 'not_found' };
    // A missing root record means the ref is not a request root of this workspace.
    if (!pageRead.records.some((record) => record.refKey === rootKey)) return { status: 'not_found' };

    // Candidate rows are re-checked against the canonical record.
    const canonicalKeys = pageRead.records.map((record) => record.refKey);
    let canonicalRead;
    try {
      canonicalRead = await store.readMany(canonicalKeys);
    } catch (error) {
      return unavailable(`the request rounds could not be re-read: ${messageOf(error)}`);
    }
    if (canonicalRead.status !== 'ready') {
      return unavailable(`the request rounds re-read failed: ${canonicalRead.code}: ${canonicalRead.reason}`);
    }
    if (canonicalRead.value.missing.length > 0) {
      return unavailable(`the request rounds index names missing records: ${canonicalRead.value.missing.join(', ')}`);
    }
    if (!sameCursor(pageRead.readThrough, canonicalRead.value.readThrough)) continue;

    const byKey = new Map(canonicalRead.value.records.map((record) => [record.refKey, record]));
    const guards: RecordGuard[] = [];
    const rounds: QueryJobSnapshot[] = [];
    let stale = false;
    for (const indexed of pageRead.records) {
      const record = byKey.get(indexed.refKey);
      if (record === undefined) {
        stale = true;
        break;
      }
      if (record.revision !== indexed.revision) {
        stale = true;
        break;
      }
      const decoded = decodeQueryJobSnapshot(record);
      if (decoded.status !== 'decoded') return unavailable(`a request round is damaged: ${decoded.reason}`);
      const round = decoded.value;
      // The index slot derives from the stored Job; a disagreement is a stale
      // index row, never a round of another request.
      if (round.job.requestRoot === null || keyOfRef(round.job.requestRoot) !== rootKey) {
        stale = true;
        break;
      }
      if (round.ref.projectId !== ctx.projectId || round.ref.workspaceId !== requestRoot.workspaceId) {
        return unavailable('a request round belongs to another project or workspace');
      }
      guardAppend(guards, { refKey: record.refKey, expectedRevision: record.revision });
      rounds.push(round);
    }
    if (stale) continue;

    rounds.sort(compareRequestRounds);
    const root = rounds.find((round) => keyOfRef(round.ref) === rootKey);
    // A ref that does not name its own request's first round is not a request root.
    if (root === undefined || root.job.roundKind !== 'request') return { status: 'not_found' };

    // The rounds' current QueryRuns (a routing round has none).
    const runKeys = rounds.filter((round) => round.job.runRef !== null).map((round) => keyOfRef(round.job.runRef));
    const runs: QueryRunSnapshot[] = [];
    let watermark = laterCursor(pageRead.readThrough, canonicalRead.value.readThrough);
    if (runKeys.length > 0) {
      let runRead;
      try {
        runRead = await store.readMany(runKeys);
      } catch (error) {
        return unavailable(`the request QueryRuns could not be read: ${messageOf(error)}`);
      }
      if (runRead.status !== 'ready') return unavailable(`the request QueryRuns read failed: ${runRead.code}: ${runRead.reason}`);
      if (runRead.value.missing.length > 0) {
        return unavailable(`the request QueryRuns are missing: ${runRead.value.missing.join(', ')}`);
      }
      watermark = laterCursor(watermark, runRead.value.readThrough);
      const byRunKey = new Map(runRead.value.records.map((record) => [record.refKey, record]));
      for (const round of rounds) {
        const runRef = round.job.runRef;
        if (runRef === null) continue;
        const record = byRunKey.get(keyOfRef(runRef));
        if (record === undefined) return unavailable('a request round names a missing QueryRun');
        const decoded = decodeQueryRunSnapshotRecord(record);
        if (decoded.status !== 'decoded') return unavailable(`a request QueryRun is damaged: ${decoded.reason}`);
        const run = decoded.value;
        if (keyOfRef(run.ref) !== keyOfRef(runRef) || keyOfRef(run.run.queryJobRef) !== keyOfRef(round.ref)) {
          return unavailable('a request QueryRun does not belong to its round');
        }
        guardAppend(guards, { refKey: record.refKey, expectedRevision: record.revision });
        runs.push(run);
      }
    }

    // Owner and owner state: the latest ownership-bearing round.
    const ownerFacts: RequestOwnerSessionFactV1[] = [];
    const ownership = latestOwnershipTarget(rounds);
    if (ownership !== null && ownership !== 'waiting' && ownership !== 'dropped') {
      const sessionKey = keyOfRef(plainSessionRefToAggregate(ownership));
      let ownerRead;
      try {
        ownerRead = await store.readMany([sessionKey]);
      } catch (error) {
        return unavailable(`the owner Session could not be read: ${messageOf(error)}`);
      }
      if (ownerRead.status !== 'ready') return unavailable(`the owner Session read failed: ${ownerRead.code}: ${ownerRead.reason}`);
      if (ownerRead.value.records.length === 0) return unavailable('the owner Session record is missing');
      const record = ownerRead.value.records[0]!;
      const decoded = decodeSessionRecord(record);
      if (decoded.status !== 'decoded') return unavailable(`the owner Session is damaged: ${decoded.reason}`);
      guardAppend(guards, { refKey: record.refKey, expectedRevision: record.revision });
      watermark = laterCursor(watermark, ownerRead.value.readThrough);
      const ownerFact = decoded.value;
      ownerFacts.push({
        session: sessionRefOf(ownerFact), lifecycle: ownerFact.lifecycle, provenance: ownerFact.provenance,
      });
      if (ownerFact.lifecycle !== 'active') {
        const successors = await readSuccessorFacts(store, sessionRefOf(ownerFact), requestRoot.workspaceId);
        if (successors.status !== 'ready') return successors;
        for (const guard of successors.value.guards) guardAppend(guards, guard);
        watermark = laterCursor(watermark, successors.value.watermark);
        ownerFacts.push(...successors.value.facts);
      }
    }
    let derived;
    try {
      derived = deriveRequestOwner(rounds, ownerFacts);
    } catch (error) {
      return unavailable(messageOf(error));
    }

    // The initiator from the root's own creation event, located by the `since`
    // the creation commit bound, so the read needs only `readMany`/`eventAt`.
    let at;
    try {
      at = await store.eventAt(root.since);
    } catch (error) {
      return unavailable(`the request root creation event could not be read: ${messageOf(error)}`);
    }
    if (at.status !== 'ready') return unavailable(`the request root creation event read failed: ${at.code}: ${at.reason}`);
    const submittedEvent = decodeQueryJobSubmittedEvent(at.value.event);
    if (submittedEvent.status !== 'decoded') {
      return unavailable(`the request root creation event is damaged: ${submittedEvent.reason}`);
    }
    const actor = submittedEvent.value.actor;
    if (actor.kind !== 'human' && actor.kind !== 'system') {
      return unavailable('the request root was not created by a human or system actor');
    }
    const initiator: Extract<ActorRef, { kind: 'human' | 'system' }> = { kind: actor.kind, id: actor.id };

    return {
      status: 'ready',
      value: {
        rounds,
        runs,
        tail: rounds[rounds.length - 1]!,
        owner: derived.owner,
        ownerState: derived.ownerState,
        lastOwner: derived.lastOwner,
        effectiveGoalId: deriveEffectiveGoalId(rounds, root.job.requestGoalId),
        requestGoalId: root.job.requestGoalId,
        initiator,
        coveredByDrop: deriveCoveredByDrop(rounds),
        guards,
        watermark,
      },
    };
  }
  return unavailable('the request rounds window changed while it was being read');
}

/**
 * The latest non-empty `goalAttribution`, else the request's own goal (spec L3;
 * an ordinary hand-off does not change it).
 */
export function deriveEffectiveGoalId(
  rounds: readonly QueryJobSnapshot[], requestGoalId: string | null,
): string | null {
  let effective = requestGoalId;
  for (const round of [...rounds].sort(compareRequestRounds)) {
    const attributed = round.job.goalAttribution;
    if (attributed !== null && attributed.length > 0) effective = attributed;
  }
  return effective;
}

/**
 * A round is covered by a drop when a `routing`/`dropped` round was created after
 * it; ties cannot occur because a drop commit writes only its
 * routing round.
 */
export function deriveCoveredByDrop(rounds: readonly QueryJobSnapshot[]): QueryJobRef[] {
  const drops = rounds.filter((round) => round.job.routing?.reason === 'dropped');
  if (drops.length === 0) return [];
  return [...rounds].sort(compareRequestRounds)
    .filter((round) => drops.some((drop) => compareCursors(drop.since, round.since) > 0))
    .map((round) => ({ ...round.ref }));
}

/**
 * The request's oldest pending non-routing round: the round a pending intake or
 * a drain's pick holds. Order is `since`, ties by the canonical
 * key. One rule for the request service and the Workflow; each caller projects
 * the snapshot or its ref itself.
 */
export function oldestPendingRound(facts: RequestRoundsFactsV1): QueryJobSnapshot | null {
  return [...facts.rounds]
    .filter((round) => round.job.status === 'pending' && round.job.roundKind !== 'routing')
    .sort(compareRequestRounds)[0] ?? null;
}
