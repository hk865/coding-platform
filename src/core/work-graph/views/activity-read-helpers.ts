/**
 * Shared 2B storage reads and activity-fact projections for the calendar
 * (`activity-read-model`), track (`track-read-model`) and timeline
 * (`task-state-timeline`) readers.
 *
 * Every index row returned by an ordered or equality page costs one storage
 * read, and a keyed read costs one per requested key even on a miss. A non-ready
 * page is thrown as-is; `readWatermark` maps one through
 * `storeFailureToRejection`. The ordered scan stays lazy so a caller that stops
 * early (L9 step 4) never reads, or counts, the rows beyond its stop.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { DispatchOutboxRef, RunRef, RunSnapshot } from '../../../contracts/dispatch.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { RoundSnapshot } from '../../../contracts/verification.js';
import type { RunActivitySnapshot } from '../../../contracts/run-activity.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { EncodedRecord, GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { RecordLookupPort, RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import { decodePlanRevisionSnapshot } from '../persistence/plan-record-codecs.js';
import { decodeSessionWorkLink, SESSION_LINKS_BY_TASK_LOOKUP } from '../sessions/session-record-codecs.js';
import { decodeDispatchOutboxEntry, dispatchOutboxRefKey } from '../tasks/claim-record-codecs.js';
import { storeFailureToRejection } from './goal-conflicts.js';
import type { ActivityUncountedReason, RunActivityViewV1 } from './activity-read-model.js';

type ReadRecords = Pick<GoalRecordTransactionPort, 'readMany' | 'eventAt'>
  & RecordLookupPort & RecordOrderedLookupPort;

const PAGE_LIMIT = 200;

export class CapacityError extends Error {}

/** Counts the storage reads L17 names: one index row, one keyed record, one `eventAt`. */
export class Budget {
  private left: number;
  constructor(cap: number) { this.left = cap; }
  spend(reads: number): void {
    this.left -= reads;
    if (this.left < 0) throw new CapacityError();
  }
}

type OrderedRequest = { index: string; values: readonly string[]; direction: 'asc' | 'desc';
  bound?: { value: string | number; inclusive: boolean } };
type OrderedPage = Awaited<ReturnType<RecordOrderedLookupPort['lookupOrdered']>>;
type EqualityPage = Awaited<ReturnType<RecordLookupPort['lookup']>>;

/**
 * Lazy keyset scan over one ordered index. `limit` bounds how many index rows
 * one storage read returns, so a caller that stops early (L9 step 4) never
 * reads the older rows; the budget is spent per returned row.
 */
export async function* scanOrdered(
  records: ReadRecords,
  request: OrderedRequest,
  limit: number,
  budget: Budget,
): AsyncGenerator<EncodedRecord> {
  let after: { order: string | number; refKey: string } | undefined;
  for (;;) {
    const page: OrderedPage = await records.lookupOrdered({
      index: request.index, values: request.values, direction: request.direction,
      ...(request.bound === undefined ? {} : { bound: request.bound }),
      ...(after === undefined ? {} : { after }),
      limit,
    });
    if (page.status !== 'ready') throw page;
    budget.spend(page.value.records.length);
    for (const record of page.value.records) yield record;
    const next = page.value.next;
    if (next === null) return;
    after = next;
  }
}

export async function readOrderedAll(
  records: ReadRecords,
  request: OrderedRequest,
  budget: Budget,
): Promise<EncodedRecord[]> {
  const all: EncodedRecord[] = [];
  for await (const record of scanOrdered(records, request, PAGE_LIMIT, budget)) all.push(record);
  return all;
}

export async function readEqualityAll(
  records: ReadRecords,
  index: string,
  values: readonly (string | number | boolean | null)[],
  budget: Budget,
): Promise<EncodedRecord[]> {
  const all: EncodedRecord[] = [];
  let after: string | undefined;
  for (;;) {
    const page: EqualityPage = await records.lookup({
      index, values, limit: PAGE_LIMIT, ...(after === undefined ? {} : { after }),
    });
    if (page.status !== 'ready') throw page;
    budget.spend(page.value.records.length);
    all.push(...page.value.records);
    const next = page.value.next;
    if (next === null) break;
    after = next;
  }
  return all;
}

/** One keyed record read; a genuine miss is `undefined`, never a read failure. */
export async function readOneKeyed(
  records: ReadRecords,
  refKey: string,
  budget: Budget,
): Promise<EncodedRecord | undefined> {
  const page = await records.readMany([refKey]);
  if (page.status !== 'ready') throw page;
  // L17: a keyed read costs one storage read per requested key, whether or not
  // a record came back. Charging `records.length` made every miss free.
  budget.spend(1);
  return page.value.records[0];
}

export async function readWatermark(
  records: ReadRecords,
): Promise<ReadResult<CommitCursor | null>> {
  const page = await records.readMany([]);
  if (page.status !== 'ready') return storeFailureToRejection(page);
  return { status: 'ready', value: page.value.readThrough };
}

export function isQuarterInstant(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return false;
  const date = new Date(ms);
  return date.getUTCMinutes() % 15 === 0 && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0;
}

export function activityViewOf(activity: RunActivitySnapshot, since: string | null): RunActivityViewV1 {
  const late = since !== null && activity.recordedBy === 'backfill' && activity.runEndedAt >= since;
  const facts = activity.facts;
  if (facts.status === 'unknown') {
    return { runRef: activity.runRef, status: 'unknown', reason: facts.reason, error: false,
      totals: null, changedFiles: null, usage: null,
      recordedBy: activity.recordedBy, recordedAt: activity.recordedAt,
      countedThroughTurnEnd: null, unresolvedCalls: null };
  }
  return {
    runRef: activity.runRef, status: 'counted', reason: late ? 'recorded_late' : null, error: late,
    totals: facts.totals,
    changedFiles: { definite: facts.changedFiles.definite.length, possible: facts.changedFiles.possible.length,
      possiblyIncomplete: facts.changedFiles.possiblyIncomplete },
    usage: { ...facts.usage.totals, complete: facts.usage.complete },
    recordedBy: activity.recordedBy, recordedAt: activity.recordedAt,
    countedThroughTurnEnd: facts.window.turnTerminal, unresolvedCalls: facts.window.unresolvedCalls,
  };
}

export function emptyView(
  runRef: RunRef,
  status: RunActivityViewV1['status'],
  reason: ActivityUncountedReason | 'recorded_late' | null,
  error: boolean,
): RunActivityViewV1 {
  return { runRef, status, reason, error, totals: null, changedFiles: null, usage: null,
    recordedBy: null, recordedAt: null, countedThroughTurnEnd: null, unresolvedCalls: null };
}

/**
 * L17: the claiming Session is the history's, else the dispatch claim's. The
 * claim commits the Run and its dispatch record together, so a missing dispatch
 * record is `unavailable`, carrying the dispatch ref key (W2b-57, HANDOFF 79-1).
 */
export async function claimingSessionOf(
  records: ReadRecords,
  run: RunSnapshot,
  budget: Budget,
): Promise<SessionRef | null> {
  const history = run.executionHistory;
  if (history !== undefined && history !== null) return history.sessionRef;
  const ref: DispatchOutboxRef = { aggregateType: 'DispatchOutboxEntry', projectId: run.ref.projectId,
    goalId: run.ref.goalId, taskId: run.task.taskId, attemptId: run.attemptId };
  const refKey = dispatchOutboxRefKey(ref);
  const record = await readOneKeyed(records, refKey, budget);
  if (record === undefined) throw rejected('unavailable', `dispatch claim ${refKey} is missing`);
  const decoded = decodeDispatchOutboxEntry(record);
  if (decoded.status !== 'decoded') throw rejected('unavailable', `dispatch claim ${record.refKey}: ${decoded.reason}`);
  return decoded.value.claim.sessionRef;
}

/** L12/L9: a Goal-gate check's owning Sessions are the open `responsible` links on the gate task. */
export async function gateInfoOf(
  records: ReadRecords,
  goalRef: GoalRef,
  round: RoundSnapshot,
  budget: Budget,
  cache: Map<string, { owners: SessionRef[]; gate: boolean }>,
): Promise<{ owners: SessionRef[]; gate: boolean }> {
  const cacheKey = canonicalKey({ goalRef, taskId: round.subject.taskId, planRef: round.adoptedPlanRef });
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;
  const planRecord = await readOneKeyed(records, canonicalKey(round.adoptedPlanRef), budget);
  let gate = false;
  if (planRecord !== undefined) {
    const decoded = decodePlanRevisionSnapshot(planRecord);
    if (decoded.status !== 'decoded') throw rejected('unavailable', `Plan ${planRecord.refKey}: ${decoded.reason}`);
    gate = decoded.value.tasks.find((task) => task.taskId === round.subject.taskId)?.taskKind === 'gate';
  }
  let owners: SessionRef[] = [];
  if (gate) {
    const links = await readEqualityAll(records, SESSION_LINKS_BY_TASK_LOOKUP,
      [goalRef.projectId, 'task', goalRef.goalId, round.subject.taskId, 'responsible'], budget);
    for (const link of links) {
      const decoded = decodeSessionWorkLink(link);
      if (decoded.status !== 'decoded') throw rejected('unavailable', `SessionWorkLink ${link.refKey}: ${decoded.reason}`);
      if (decoded.value.until !== null) continue;
      owners.push({ projectId: decoded.value.ref.projectId, sessionId: decoded.value.ref.sessionId });
    }
  }
  const info = { owners, gate };
  cache.set(cacheKey, info);
  return info;
}

function canonicalKey(value: unknown): string {
  return canonicalJson(value as JsonValue);
}
