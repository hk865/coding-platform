/**
 * The two store-boundary doubles the query-activity rows R-15 and R-16 allow: the only states of those rows that
 * no public step can make, made at the record-store boundary of a real Host. Nothing else here makes a fact.
 *
 * Where it sits (rule sheet A4 backend seam, composed with the frozen commit barrier): `vi.mock` factories for the
 * two real backend factories that `createTargetPlatform` calls. Each factory builds the commit barrier's module
 * first (tests/helpers/S6A-commit-barrier.ts: the real backend with the barrier around `records.commit`), gives
 * the real backend one extra `beforeWrite` and wraps `records.commit` once more, outside the barrier. So:
 *   - a test file installs THESE two mocks instead of the barrier's; the barrier's holds and the SE2 world's gates
 *     (tests/helpers/S6A-host-fixture.ts, with its scripted model and its controlled Kernel `Date`) work as before,
 *     and a commit the barrier holds is the commit as this double changed it;
 *   - with no arm, every commit reaches the barrier and the real store unchanged.
 *
 *   vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
 *     (await import('../helpers/S6A-activity-boundary.js')).inMemoryActivityBoundaryModule(importOriginal));
 *   vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
 *     (await import('../helpers/S6A-activity-boundary.js')).sqliteActivityBoundaryModule(importOriginal));
 *   afterEach(async () => {
 *     const unfired = activityBoundary.reset();   // disarms everything
 *     const held = commitBarrier.reset();
 *     await closeWorlds();
 *     expect(held).toEqual([]);
 *   });
 *
 * The commit that ends a Query (`queryEndCommitOf`): a commit that writes the QueryRun with execution phase
 * `settled`. That is the Runtime's terminal observation (`r5b-query-execution:observed:…`, also the start-up
 * reconcile's QRR-03, which books the Kernel terminal through the same observation) and every closing commit of the
 * reconcile's own writer (`a2-query-recovery:…`: QRR-01/02/04/06). No earlier commit writes a settled QueryRun and
 * the owners refuse any later write to one (`recordQueryUsage` answers `busy`), so the first such commit of a
 * QueryRun is its end. A target narrows it to one QueryRun, one round (its QueryJob, any of its Runs) or the Session
 * that ran it; a `CommitMatch` narrows it further and never matches a commit that ends no Query.
 *
 * The control, `activityBoundary`; every arm reports `matched()` (commits it met while armed), `fired()` (commits
 * it failed or changed) and `armed()`, and `disarm()` stops it:
 * - `rejectQueryEnd(target)`: the next commit that ends the target Query fails as a store failure. The real
 *   backend runs every check (identity, guards, claims, ledger horizon), then the injected `beforeWrite` throws:
 *   the memory backend throws before its first write, so there is nothing to undo; SQLite throws inside its open
 *   transaction and rolls it back. Both rethrow (a SQLite write error looks the same, and
 *   tests/helpers/WP2-platform-support.ts injects its fault at the same point); the Query owner finds no receipt and
 *   answers `unavailable`. So nothing of that commit lands: the settled QueryRun, its QueryJob, Answer and Session
 *   release, and every other record it carries, the Query's activity record included. A commit the store replays
 *   or refuses never reaches `beforeWrite` and does not use the arm up. The arm fires once and disarms itself; the
 *   retry passes unchanged.
 * - `dropQueryActivity(target)`: every commit that ends the target Query lands without the `QueryActivity` records
 *   (the frozen ref `{ aggregateType: 'QueryActivity', projectId, workspaceId, queryJobId, runId }`) whose ref names
 *   a QueryRun the commit settles with its whole identity (all four fields equal). No other record is ever removed.
 *   Only that removal; what else the commit needs stays:
 *     · its guards, including the removed record's own (the store needs a guard per written record, not a record
 *       per guard, record-codec.ts `planPreparedCommit`; the guard is the owner's precondition, still true);
 *     · its events: the store ties no event to a record, the Work end commit adds its activity record with no event
 *       of its own (`planRunActivityForCommit`), and the activity reads take the record by key;
 *     · its commit-cursor bindings, except one naming the removed record, which the store would refuse as "not
 *       written by this commit" (the Session's `unavailableSince` binding stays).
 *   A backfill write never writes the QueryRun, so it is never matched. When the commit carries no such record
 *   (every Query end before the activity record exists) the arm matches and changes nothing.
 * - `setQuerySince(value, { workspace, times })`: every commit that writes the workspace's `ActivityRecording` stores
 *   `querySince` as `value` (`null` or an ISO instant) in that record and, so the commit stays one statement, in
 *   the copy of that snapshot its events embed: an event object whose `ref` is the rewritten record's full ref and
 *   whose `revision` is its revision (the recording event embeds the snapshot, and a replayed ensure answers from
 *   it, `replayActivityRecording`). Other scopes, other revisions and any other object's field of the same name stay
 *   as they are. The Work `since`, the revision, the guards and the events' other fields are never touched. Only a
 *   record that HAS the field is rewritten: a record without it passes unchanged, so the double never adds a field
 *   its schema does not know. `querySince` is a plain field, not a commit-cursor field (the bindable set is `since`, `until`,
 *   `unavailableSince`, `responseSince` of schemas that register it; `ActivityRecording.since` is a plain instant),
 *   so no binding is involved. Default `times`: until disarmed (a Host start that finds the field null writes it
 *   again, and a row that keeps "no epoch" needs every such write rewritten). The writer keeps the value it wrote
 *   in its own answer; reads take the stored one.
 * - `reset()` disarms every arm and returns the labels of `rejectQueryEnd` arms that never fired.
 * The two rewrites are also exported as pure functions (`withoutQueryActivity`, `withQuerySince`) over a prepared
 * commit, so a test can show what the double would do with a commit the barrier held, without committing anything.
 *
 * Every backend built while the mocks are installed is wrapped (the platform's, and any a helper builds directly).
 * No record or event is written by hand: the double only fails or trims a commit the platform prepared.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import type { EncodedRecord, PreparedCommit, StoreCommitReceipt } from '../../src/core/record-store/ports.js';
import { inMemoryBarrierModule, sqliteBarrierModule, type CommitMatch } from './S6A-commit-barrier.js';

type InMemoryModule = typeof import('../../src/core/record-store/in-memory-record-store.js');
type SqliteModule = typeof import('../../src/core/record-store/sqlite-record-store.js');

/** The aggregate type of a Query's activity record (its ref names the QueryRun). */
export const QUERY_ACTIVITY_AGGREGATE_TYPE = 'QueryActivity';
const ACTIVITY_RECORDING = 'ActivityRecording';
const QUERY_SINCE = 'querySince';

/** Which Query's end: every field given must hold. */
export type QueryEndTarget = { queryRunRef?: QueryRunRef; round?: QueryJobRef; session?: SessionRef };
export type QueryEndSelector = QueryEndTarget | CommitMatch;
export type ActivityWorkspace = { projectId: string; workspaceId: string };

export type BoundaryArm = {
  readonly label: string;
  /** Commits the arm met while armed. */
  matched(): number;
  /** Commits the arm failed (reject) or changed (drop, rewrite). */
  fired(): number;
  armed(): boolean;
  disarm(): void;
};

// ---------------------------------------------------------------------------
// Reading a prepared commit (its own fields only)
// ---------------------------------------------------------------------------

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const asObject = (value: unknown): JsonObject => (isObject(value) ? value : {});

function parsed(text: string): unknown {
  try { return JSON.parse(text) as unknown; } catch { return undefined; }
}

/** A record's ref: its canonical `refKey`, else the body's `ref`. */
function refOf(record: EncodedRecord): JsonObject {
  const fromKey = asObject(parsed(record.refKey));
  if (typeof fromKey['aggregateType'] === 'string') return fromKey;
  return asObject(asObject(parsed(record.json))['ref']);
}

type EndedRun = { projectId: unknown; workspaceId: unknown; queryJobId: unknown; runId: unknown };

/** The QueryRuns the commit settles that the target names. */
function endedRuns(commit: PreparedCommit, target: QueryEndTarget): EndedRun[] {
  const ended: EndedRun[] = [];
  for (const record of commit.records) {
    const value = asObject(parsed(record.json));
    const ref = asObject(value['ref']);
    const state = asObject(asObject(value['run'])['executionState']);
    if (ref['aggregateType'] !== 'QueryRun' || state['phase'] !== 'settled') continue;
    const run: EndedRun = { projectId: ref['projectId'], workspaceId: ref['workspaceId'], queryJobId: ref['queryJobId'],
      runId: ref['runId'] };
    const wanted = target.queryRunRef;
    if (wanted !== undefined && (run.projectId !== wanted.projectId || run.workspaceId !== wanted.workspaceId
      || run.queryJobId !== wanted.queryJobId || run.runId !== wanted.runId)) continue;
    const round = target.round;
    if (round !== undefined && (run.projectId !== round.projectId || run.workspaceId !== round.workspaceId
      || run.queryJobId !== round.queryJobId)) continue;
    const session = target.session;
    const ran = asObject(state['sessionRef']);
    if (session !== undefined && (ran['projectId'] !== session.projectId || ran['sessionId'] !== session.sessionId)) continue;
    ended.push(run);
  }
  return ended;
}

/** The commit that ends a Query the target names (any Query when the target is empty). */
export function queryEndCommitOf(target: QueryEndTarget = {}): CommitMatch {
  return commit => endedRuns(commit, target).length > 0;
}

/** A commit that writes the `ActivityRecording` of the workspace (of any workspace when none is given). */
export function activityRecordingCommitOf(workspace?: ActivityWorkspace): CommitMatch {
  return commit => commit.records.some(record => isRecordingOf(record, workspace));
}

function isRecordingOf(record: EncodedRecord, workspace: ActivityWorkspace | undefined): boolean {
  const ref = refOf(record);
  return ref['aggregateType'] === ACTIVITY_RECORDING
    && (workspace === undefined || (ref['projectId'] === workspace.projectId && ref['workspaceId'] === workspace.workspaceId));
}

/** A function selector only narrows the Query end: it never matches a commit that ends no Query. */
const matcherOf = (selector: QueryEndSelector): CommitMatch =>
  typeof selector === 'function'
    ? commit => queryEndCommitOf()(commit) && selector(commit)
    : queryEndCommitOf(selector);

// ---------------------------------------------------------------------------
// The two rewrites (pure: a new commit object; the input is never changed)
// ---------------------------------------------------------------------------

/**
 * The commit without the `QueryActivity` records whose ref names, with all four of projectId, workspaceId,
 * queryJobId and runId, a QueryRun the commit settles (the target's; with a matcher, every QueryRun it settles, and
 * only when the commit is a Query end the matcher accepts), and without commit-cursor bindings on them. Guards,
 * events, claims and every other record stay. `removed` lists the removed refKeys; none removed returns the same
 * commit object.
 */
export function withoutQueryActivity(commit: PreparedCommit, selector: QueryEndSelector):
  { commit: PreparedCommit; removed: string[] } {
  if (!matcherOf(selector)(commit)) return { commit, removed: [] };
  const ended = endedRuns(commit, typeof selector === 'function' ? {} : selector);
  const names = (ref: JsonObject): boolean => ended.some(run => ref['projectId'] === run.projectId
    && ref['workspaceId'] === run.workspaceId && ref['queryJobId'] === run.queryJobId && ref['runId'] === run.runId);
  const removed = commit.records
    .filter(record => { const ref = refOf(record); return ref['aggregateType'] === QUERY_ACTIVITY_AGGREGATE_TYPE && names(ref); })
    .map(record => record.refKey);
  if (removed.length === 0) return { commit, removed };
  const gone = new Set(removed);
  const bindings = commit.commitCursorBindings;
  return {
    commit: {
      ...commit,
      records: commit.records.filter(record => !gone.has(record.refKey)),
      ...(bindings === undefined ? {} : { commitCursorBindings: bindings.filter(binding => !gone.has(binding.refKey)) }),
    },
    removed,
  };
}

/** One rewritten recording: its full ref (the record body's `ref`) and its revision. */
type RewrittenRecording = { ref: JsonObject; revision: unknown };

/** The same flat ref: the same keys, each with the same value. */
function sameRef(left: JsonObject, right: JsonObject): boolean {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && left[key] === right[key]);
}

/**
 * Sets `querySince` in every embedded snapshot under `value` (objects and arrays, depth first) whose `ref` is one
 * of the rewritten recordings' full ref and whose `revision` is that recording's; returns how many it set.
 */
function setSnapshotQuerySince(value: unknown, rewritten: readonly RewrittenRecording[], next: string | null): number {
  if (Array.isArray(value)) return value.reduce((count: number, item) => count + setSnapshotQuerySince(item, rewritten, next), 0);
  if (!isObject(value)) return 0;
  let count = 0;
  if (Object.hasOwn(value, QUERY_SINCE) && isObject(value['ref'])) {
    const ref = value['ref'];
    if (rewritten.some(entry => sameRef(entry.ref, ref) && entry.revision === value['revision'])) {
      value[QUERY_SINCE] = next;
      count += 1;
    }
  }
  for (const item of Object.values(value)) count += setSnapshotQuerySince(item, rewritten, next);
  return count;
}

/**
 * The commit with `querySince = value` in each of the workspace's `ActivityRecording` records that has the field
 * and, for each record rewritten (its full ref and revision), in the snapshot copies the commit's events embed with
 * that same ref and revision. `records` / `events` count the records and the events rewritten; none rewritten
 * returns the same commit object.
 */
export function withQuerySince(commit: PreparedCommit, value: string | null, workspace?: ActivityWorkspace):
  { commit: PreparedCommit; records: number; events: number } {
  const rewritten: RewrittenRecording[] = [];
  const nextRecords = commit.records.map(record => {
    if (!isRecordingOf(record, workspace)) return record;
    const body = parsed(record.json);
    if (!isObject(body) || !Object.hasOwn(body, QUERY_SINCE) || !isObject(body['ref'])) return record;
    rewritten.push({ ref: structuredClone(body['ref']), revision: body['revision'] });
    body[QUERY_SINCE] = value;
    return { ...record, json: JSON.stringify(body) };
  });
  const records = rewritten.length;
  if (records === 0) return { commit, records: 0, events: 0 };
  let events = 0;
  const nextEvents = commit.events.map(event => {
    const body = parsed(event.json);
    if (setSnapshotQuerySince(body, rewritten, value) === 0) return event;
    events += 1;
    return { ...event, json: JSON.stringify(body) };
  });
  return { commit: { ...commit, records: nextRecords, events: nextEvents }, records, events };
}

// ---------------------------------------------------------------------------
// The control
// ---------------------------------------------------------------------------

type ArmState = { label: string; armed: boolean; matched: number; fired: number; match: CommitMatch };
type DropArm = ArmState & { selector: QueryEndSelector };
type EpochArm = ArmState & { value: string | null; workspace: ActivityWorkspace | undefined; times: number };

/** The reject arm a commit call carries into the real backend's `beforeWrite` (one per commit call). */
const rejectScope = new AsyncLocalStorage<ArmState>();

function handle(arm: ArmState): BoundaryArm {
  return {
    label: arm.label,
    matched: () => arm.matched,
    fired: () => arm.fired,
    armed: () => arm.armed,
    disarm: () => { arm.armed = false; },
  };
}

export class ActivityBoundary {
  private rejects: ArmState[] = [];
  private drops: DropArm[] = [];
  private epochs: EpochArm[] = [];
  private created = 0;

  private label(kind: string, label: string | undefined): string {
    this.created += 1;
    return label ?? `${kind} #${this.created}`;
  }

  /** Fail, once, the next commit that ends the target Query (a store failure inside the real transaction). */
  rejectQueryEnd(selector: QueryEndSelector, label?: string): BoundaryArm {
    const arm: ArmState = { label: this.label('reject query end', label), armed: true, matched: 0, fired: 0,
      match: matcherOf(selector) };
    this.rejects.push(arm);
    return handle(arm);
  }

  /** Every commit that ends the target Query lands without the `QueryActivity` records of the QueryRun it settles. */
  dropQueryActivity(selector: QueryEndSelector, options: { label?: string } = {}): BoundaryArm {
    const arm: DropArm = { label: this.label('drop query activity', options.label), armed: true, matched: 0, fired: 0,
      match: matcherOf(selector), selector };
    this.drops.push(arm);
    return handle(arm);
  }

  /** The workspace's `ActivityRecording` commits store `querySince = value` (`times` rewrites; default until disarmed). */
  setQuerySince(value: string | null, options: { workspace?: ActivityWorkspace; times?: number; label?: string } = {}):
    BoundaryArm {
    const times = options.times ?? Number.POSITIVE_INFINITY;
    if (!(times >= 1)) throw new Error('S6A activity boundary: setQuerySince needs times >= 1');
    const arm: EpochArm = { label: this.label('set querySince', options.label), armed: true, matched: 0, fired: 0,
      match: activityRecordingCommitOf(options.workspace), value, workspace: options.workspace, times };
    this.epochs.push(arm);
    return handle(arm);
  }

  /** The labels of the arms still armed. */
  armedLabels(): string[] {
    return [...this.rejects, ...this.drops, ...this.epochs].filter(arm => arm.armed).map(arm => arm.label);
  }

  /** Disarm and forget every arm; returns the labels of the reject arms that never fired. */
  reset(): string[] {
    const unfired = this.rejects.filter(arm => arm.fired === 0).map(arm => arm.label);
    for (const arm of [...this.rejects, ...this.drops, ...this.epochs]) arm.armed = false;
    this.rejects = [];
    this.drops = [];
    this.epochs = [];
    this.created = 0;
    return unfired;
  }

  /** The wrapped `records.commit` body: trim or rewrite a matching commit, then run it (under a reject arm if one matches). */
  async pass(input: PreparedCommit, next: (input: PreparedCommit) => Promise<StoreCommitReceipt>):
    Promise<StoreCommitReceipt> {
    let commit = input;
    for (const arm of this.drops) {
      if (!arm.armed || !arm.match(commit)) continue;
      arm.matched += 1;
      const trimmed = withoutQueryActivity(commit, arm.selector);
      if (trimmed.removed.length > 0) { arm.fired += 1; commit = trimmed.commit; }
    }
    for (const arm of this.epochs) {
      if (!arm.armed || !arm.match(commit)) continue;
      arm.matched += 1;
      const rewritten = withQuerySince(commit, arm.value, arm.workspace);
      if (rewritten.records === 0) continue;
      arm.fired += 1;
      commit = rewritten.commit;
      if (arm.fired >= arm.times) arm.armed = false;
    }
    const reject = this.rejects.find(arm => arm.armed && arm.match(commit));
    if (reject === undefined) return next(commit);
    reject.matched += 1;
    return rejectScope.run(reject, () => next(commit));
  }

  /** The injected `beforeWrite`: runs inside the real transaction after every check; throws for an armed reject. */
  beforeWrite(): void {
    const arm = rejectScope.getStore();
    if (arm === undefined || !arm.armed) return;
    arm.armed = false;
    arm.fired += 1;
    throw new Error(`S6A activity boundary: the store failed the commit at its first write (${arm.label})`);
  }
}

/** The one shared control the mocked factories and the test file use. */
export const activityBoundary = new ActivityBoundary();

// ---------------------------------------------------------------------------
// The backend seam (on top of the commit barrier's)
// ---------------------------------------------------------------------------

type CommitBackend = { readonly records: { commit(input: PreparedCommit): Promise<StoreCommitReceipt> } };

/** Both backends build `records` from closures without `this`, so the spread keeps every other method. */
function withBoundary<B extends CommitBackend>(backend: B): B {
  const real = backend.records;
  return { ...backend, records: { ...real, commit: (input: PreparedCommit) => activityBoundary.pass(input, next => real.commit(next)) } };
}

/** The backend's own `beforeWrite` (none from the platform today) first, then the double's. */
function injectedBeforeWrite(own: (() => void) | undefined): () => void {
  return () => {
    own?.();
    activityBoundary.beforeWrite();
  };
}

/** `vi.mock` factory for `src/core/record-store/in-memory-record-store.js` (includes the commit barrier). */
export async function inMemoryActivityBoundaryModule(importOriginal: () => Promise<unknown>): Promise<InMemoryModule> {
  const inner = await inMemoryBarrierModule(importOriginal);
  return { ...inner,
    createInMemoryRecordBackend: (options: Parameters<InMemoryModule['createInMemoryRecordBackend']>[0]) =>
      withBoundary(inner.createInMemoryRecordBackend({ ...options, beforeWrite: injectedBeforeWrite(options.beforeWrite) })) };
}

/** `vi.mock` factory for `src/core/record-store/sqlite-record-store.js` (includes the commit barrier). */
export async function sqliteActivityBoundaryModule(importOriginal: () => Promise<unknown>): Promise<SqliteModule> {
  const inner = await sqliteBarrierModule(importOriginal);
  return { ...inner,
    createSqliteRecordBackend: (options: Parameters<SqliteModule['createSqliteRecordBackend']>[0]) =>
      withBoundary(inner.createSqliteRecordBackend({ ...options, beforeWrite: injectedBeforeWrite(options.beforeWrite) })) };
}
