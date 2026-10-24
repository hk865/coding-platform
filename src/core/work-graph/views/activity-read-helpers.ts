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
import type { QueryJobSnapshot, QueryRunRef, QueryRunSnapshot } from '../../../contracts/query-job.js';
import { isRequestRound } from '../../../contracts/query-job.js';
import type { QueryActivitySnapshot, RunActivityFactsV1, RunActivitySnapshot } from '../../../contracts/run-activity.js';
import { provenNotEnteredKernel } from '../../../contracts/run-activity.js';
import { canonicalKey } from '../../../contracts/fingerprint.js';
import type { EncodedRecord, GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { RecordLookupPort, RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import { decodePlanRevisionSnapshot } from '../persistence/plan-record-codecs.js';
import { decodeSessionWorkLink, SESSION_LINKS_BY_TASK_LOOKUP } from '../sessions/session-record-codecs.js';
import { decodeDispatchOutboxEntry, dispatchOutboxRefKey } from '../tasks/claim-record-codecs.js';
import { storeFailureToRejection } from './goal-conflicts.js';
import type {
  ActivityUncountedReason, QueryActivityViewV1, RunActivityViewV1,
} from './activity-read-model.js';

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

/**
 * L7/L16: what a reader knows about a missing activity record. `kind` names the
 * aggregate the record would belong to (`absent` = the aggregate's own record
 * is missing, so there is no end to compare); `neverEntered` is the
 * aggregate's own entry proof; `since` is the recording epoch of the record's
 * kind (a Work `since`, a Query `querySince`). Build it with
 * `runMissingActivityFacts` or `queryMissingActivityFacts`.
 */
export type MissingActivityFacts = {
  kind: 'absent' | 'open' | 'ended';
  endedAt: string | null;
  neverEntered: boolean;
  since: string | null;
};

export type MissingActivityClassification =
  | { kind: 'in_progress' }
  | { kind: 'not_entered' }
  | { kind: 'unknown'; reason: ActivityUncountedReason; error: boolean };

/**
 * The ONE missing-record rule: a record that is not there is never 0 unless the
 * aggregate provably never entered the Kernel. Work and Query reduce their own
 * facts here, so the same missing record cannot be two different answers.
 */
export function classifyMissingActivity(facts: MissingActivityFacts): MissingActivityClassification {
  // Without the aggregate there is no history to place, so nothing is counted.
  if (facts.kind === 'absent') return { kind: 'unknown', reason: 'no_history_locator', error: false };
  if (facts.kind === 'open') return { kind: 'in_progress' };
  if (facts.neverEntered) return { kind: 'not_entered' };
  if (facts.since === null) return { kind: 'unknown', reason: 'no_recording_epoch', error: false };
  // Ended at the epoch instant or later: recording was already on, so the
  // missing record is an error worth surfacing. Ended earlier: only the
  // automatic backfill can still fill it, so it is not an error.
  if (facts.endedAt !== null && facts.endedAt >= facts.since) {
    return { kind: 'unknown', reason: 'not_recorded', error: true };
  }
  return { kind: 'unknown', reason: 'not_backfilled', error: false };
}

/** A Work Run's facts for the one rule; `run` is null when the Run record itself is missing. */
export function runMissingActivityFacts(run: RunSnapshot | null, since: string | null): MissingActivityFacts {
  if (run === null) return { kind: 'absent', endedAt: null, neverEntered: false, since };
  return {
    kind: run.status === 'starting' || run.status === 'running' ? 'open' : 'ended',
    endedAt: run.endedAt,
    neverEntered: provenNotEnteredKernel(run, since),
    since,
  };
}

/**
 * A QueryRun's facts for the one rule, against the workspace's Query epoch
 * (`querySince`), never the Work one; `run` is null when the QueryRun record
 * itself is missing.
 */
export function queryMissingActivityFacts(run: QueryRunSnapshot | null, querySince: string | null): MissingActivityFacts {
  if (run === null) return { kind: 'absent', endedAt: null, neverEntered: false, since: querySince };
  const state = run.run.executionState;
  return {
    kind: run.run.endedAt === null ? 'open' : 'ended',
    endedAt: run.run.endedAt,
    // The QueryRun's own proof that it never entered the Kernel: no execution
    // state, no entry, or the platform's `not_entered` outcome.
    neverEntered: state === undefined || state.entry === null || run.run.outcome === 'not_entered',
    since: querySince,
  };
}

/** The Work view of a Run with no activity record; `not_entered` is the one case with genuine zeros. */
export function runMissingActivityViewOf(runRef: RunRef, classification: MissingActivityClassification): RunActivityViewV1 {
  switch (classification.kind) {
    case 'in_progress':
      return emptyView(runRef, 'in_progress', null, false);
    case 'not_entered':
      return { runRef, status: 'not_entered', reason: null, error: false,
        totals: { steps: 0, edits: 0, editsUnknown: 0 },
        changedFiles: { definite: 0, possible: 0, possiblyIncomplete: false }, usage: null,
        recordedBy: null, recordedAt: null, countedThroughTurnEnd: null, unresolvedCalls: null };
    case 'unknown':
      return emptyView(runRef, 'unknown', classification.reason, classification.error);
  }
}

/**
 * The Query view of a QueryRun with no activity record, shaped like the Work
 * one. `sessionRef` is the Session the QueryRun's claim recorded (null before a
 * claim); the asked line and the Goal come only from a record.
 */
export function queryMissingActivityViewOf(
  queryRunRef: QueryRunRef,
  sessionRef: SessionRef | null,
  classification: MissingActivityClassification,
): QueryActivityViewV1 {
  const base = { queryRunRef, recordedBy: null, recordedAt: null, countedThroughTurnEnd: null, unresolvedCalls: null,
    usage: null, sessionRef, askedSessionRef: null, goalId: null } as const;
  switch (classification.kind) {
    case 'in_progress':
      return { ...base, status: 'in_progress', reason: null, error: false, totals: null, changedFiles: null };
    case 'not_entered':
      return { ...base, status: 'not_entered', reason: null, error: false,
        totals: { steps: 0, edits: 0, editsUnknown: 0 },
        changedFiles: { definite: 0, possible: 0, possiblyIncomplete: false } };
    case 'unknown':
      return { ...base, status: 'unknown', reason: classification.reason, error: classification.error,
        totals: null, changedFiles: null };
  }
}

/**
 * L16: the Goal a Query with no activity record counts under in a Goal's
 * calendar, the goal its closing commit records: a request round's goal frozen
 * when it was prepared (null for a no-goal round), never its Job's current one;
 * a request round not prepared yet has no frozen goal, so its request's
 * attribution, else the Goal it was opened for; any other Query its intent's.
 */
export function missingQueryActivityGoalOf(job: QueryJobSnapshot, run: QueryRunSnapshot): string | null {
  if (!isRequestRound(job)) return job.job.intent.goalId;
  const prepared = run.run.executionState?.prepared ?? null;
  if (prepared !== null) return prepared.requestEffectiveGoalId;
  return job.job.goalAttribution ?? job.job.goalId;
}

/** The Session a QueryRun's claim recorded, when it has one. */
export function queryExecutingSession(run: QueryRunSnapshot): SessionRef | null {
  const state = run.run.executionState;
  return state === undefined ? null : state.sessionRef;
}

type ActivityViewCommonFields<R extends string | null> = {
  error: boolean;
  totals: RunActivityViewV1['totals'];
  changedFiles: RunActivityViewV1['changedFiles'];
  usage: RunActivityViewV1['usage'];
  recordedBy: R;
  recordedAt: string;
  countedThroughTurnEnd: boolean | null;
  unresolvedCalls: number | null;
};

/** A stored record projects only to `counted` (maybe late) or `unknown` with its tally's reason. */
type ActivityViewCoreFields<R extends string | null> =
  | (ActivityViewCommonFields<R> & { status: 'counted'; reason: 'recorded_late' | null })
  | (ActivityViewCommonFields<R> & { status: 'unknown'; reason: ActivityUncountedReason });

/** The view of a stored record: the status and reason a record can carry, nothing else. */
export type StoredQueryActivityViewV1 = Omit<QueryActivityViewV1, 'status' | 'reason'>
  & ({ status: 'counted'; reason: 'recorded_late' | null } | { status: 'unknown'; reason: ActivityUncountedReason });

/**
 * The counted/unknown projection the Work and Query activity views share,
 * written once: an unreadable tally reports no numbers at all, never zero, and
 * a backfilled record that ended at or after its epoch is reported late.
 */
function activityViewCore<R extends string | null>(
  facts: RunActivityFactsV1,
  recorded: { recordedBy: R; recordedAt: string },
  late: boolean,
): ActivityViewCoreFields<R> {
  if (facts.status === 'unknown') {
    return { status: 'unknown', reason: facts.reason, error: false,
      totals: null, changedFiles: null, usage: null,
      recordedBy: recorded.recordedBy, recordedAt: recorded.recordedAt,
      countedThroughTurnEnd: null, unresolvedCalls: null };
  }
  return {
    status: 'counted', reason: late ? 'recorded_late' : null, error: late,
    totals: facts.totals,
    changedFiles: { definite: facts.changedFiles.definite.length, possible: facts.changedFiles.possible.length,
      possiblyIncomplete: facts.changedFiles.possiblyIncomplete },
    usage: { ...facts.usage.totals, complete: facts.usage.complete },
    recordedBy: recorded.recordedBy, recordedAt: recorded.recordedAt,
    countedThroughTurnEnd: facts.window.turnTerminal, unresolvedCalls: facts.window.unresolvedCalls,
  };
}

export function activityViewOf(activity: RunActivitySnapshot, since: string | null): RunActivityViewV1 {
  const late = since !== null && activity.recordedBy === 'backfill' && activity.runEndedAt >= since;
  return { runRef: activity.runRef, ...activityViewCore(activity.facts, activity, late) };
}

/** L16: a Query activity record's view, on the same counted/unknown rule as the Work one. */
export function queryActivityViewOf(
  activity: QueryActivitySnapshot,
  querySince: string | null,
): StoredQueryActivityViewV1 {
  const late = querySince !== null && activity.recordedBy === 'backfill' && activity.queryEndedAt >= querySince;
  return {
    queryRunRef: activity.queryRunRef,
    ...activityViewCore(activity.facts, activity, late),
    sessionRef: activity.sessionRef, askedSessionRef: activity.askedSessionRef, goalId: activity.goalId,
  };
}

function emptyView(
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
): Promise<SessionRef> {
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

