/**
 * The line clock and the record reads a line's clock shares with secretary
 * selection (`latestActivityAt`).
 *
 * `latestActivityAt` is the line card's clock as one pure rule: the Session's
 * creation instant plus every instant the caller gathered, the lexicographically
 * greatest ISO instant, ignoring null/undefined and falling back to `createdAt`.
 *
 * The record reads below serve `views/work-line-reader.ts` and
 * `tasks/secretary-selection.ts` with ONE implementation of the active
 * read-only copies, their latest Query and its QueryJob check, and the claim
 * time: the line card's clock keeps its meaning, and `tasks/`
 * never imports `views/`. They read only (no writes) and report failures
 * through the caller's sink instead of inventing a value.
 */
import type { WorkspaceScope } from '../../../contracts/core/identity.js';
import type { RunRef } from '../../../contracts/dispatch.js';
import type { QueryExecutionStateV1, QueryRunSnapshot } from '../../../contracts/query-job.js';
import type { SessionRecord } from '../../../contracts/core/session.js';
import type { RecordLookupPort, RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import {
  S2C_QUERY_RUN_BY_SESSION_GENERATION_LOOKUP, decodeQueryJobSnapshot, decodeQueryRunSnapshotRecord,
} from '../queries/query-record-codecs.js';
import { S2C_SESSION_BY_LIFECYCLE_KIND_LOOKUP, decodeSessionRecord } from '../sessions/session-record-codecs.js';
import { decodeDispatchOutboxEntry, S2C_WORK_CLAIM_BY_SESSION_GENERATION_LOOKUP } from './claim-record-codecs.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';

/** The store surface these reads need. */
export type LineClockStore =
  Pick<GoalRecordTransactionPort, 'readMany'> & RecordLookupPort & RecordOrderedLookupPort;

/** A failed read, shaped like the readers' own problem note. */
export type LineClockFailure = { code: string; reason: string };
export type LineClockFailureSink = (failure: LineClockFailure) => void;

/** Active read-only copies of a workspace, indexed by the source Session's id. */
export type ActiveCopies = Map<string, SessionRecord[]>;

/**
 * The line card's clock (L10): the latest of the Session's creation, the
 * caller's instants and nothing else. ISO instants compare as UTC strings; an
 * absent instant is ignored, and an empty/earlier set falls back to `createdAt`.
 */
export function latestActivityAt(createdAt: string, instants: readonly (string | null | undefined)[]): string {
  let latest = createdAt;
  for (const instant of instants) {
    if (instant === null || instant === undefined) continue;
    if (instant > latest) latest = instant;
  }
  return latest;
}

/**
 * L1/N1: the ACTIVE copies of a workspace, indexed by the source Session they
 * were copied from. Only active copies count, so the set is bounded by current
 * work, never by the history of archived copies.
 */
export function indexActiveCopies(sessions: readonly SessionRecord[]): ActiveCopies {
  const bySource: ActiveCopies = new Map();
  for (const session of sessions) {
    const provenance = session.provenance;
    if (provenance.kind !== 'readonly_copy') continue;
    if (session.lifecycle !== 'active') continue;
    const source = provenance.from.sessionId;
    const list = bySource.get(source);
    if (list === undefined) bySource.set(source, [session]);
    else list.push(session);
  }
  return bySource;
}

/** The complete, paged active-readonly-copy enumeration of one workspace. */
export async function readActiveCopies(
  records: LineClockStore,
  workspace: WorkspaceScope,
  lookupPageLimit: number = 200,
): Promise<{ status: 'ready'; value: ActiveCopies } | { status: 'rejected'; code: string; reason: string }> {
  const sessions: SessionRecord[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await records.lookup({ index: S2C_SESSION_BY_LIFECYCLE_KIND_LOOKUP,
      values: [workspace.projectId, workspace.workspaceId, 'active', 'readonly_copy'], limit: lookupPageLimit,
      ...(after === undefined ? {} : { after }) });
    if (page.status !== 'ready') return page;
    for (const record of page.value.records) {
      const decoded = decodeSessionRecord(record);
      if (decoded.status === 'decoded') sessions.push(decoded.value);
    }
    if (page.value.next === null) break;
    after = page.value.next;
  }
  return { status: 'ready', value: indexActiveCopies(sessions) };
}

/** One Session's latest QueryRun (the line reader's `readLatestQuery` record half). */
export async function readLatestQueryRun(
  records: LineClockStore,
  workspace: WorkspaceScope,
  session: SessionRecord,
  onProblem: LineClockFailureSink,
): Promise<QueryRunSnapshot | null> {
  const occupancy = session.occupancy;
  if (occupancy !== null && occupancy !== undefined && occupancy.kind === 'execution'
    && occupancy.executionRef.aggregateType === 'QueryRun') {
    return readQueryRunByRef(records, workspace, occupancy.executionRef, onProblem);
  }
  const lastExecution = session.lastExecutionRef;
  if (lastExecution !== null && lastExecution !== undefined && lastExecution.aggregateType === 'QueryRun') {
    return readQueryRunByRef(records, workspace, lastExecution, onProblem);
  }
  const page = await records.lookupOrdered({ index: S2C_QUERY_RUN_BY_SESSION_GENERATION_LOOKUP,
    values: [workspace.projectId, workspace.workspaceId, session.ref.sessionId], direction: 'desc', limit: 1 });
  if (page.status !== 'ready') { onProblem(page); return null; }
  if (page.value.records.length === 0) return null;
  const decoded = decodeQueryRunSnapshotRecord(page.value.records[0]!);
  if (decoded.status !== 'decoded') {
    onProblem({ code: 'unavailable', reason: 'the latest QueryRun is not decodable' });
    return null;
  }
  return decoded.value;
}

/** Read one QueryRun by its exact ref, refusing a record of another workspace. */
export async function readQueryRunByRef(
  records: LineClockStore,
  workspace: WorkspaceScope,
  ref: { aggregateType: string },
  onProblem: LineClockFailureSink,
): Promise<QueryRunSnapshot | null> {
  const key = canonicalJson(ref as unknown as JsonValue);
  const read = await records.readMany([key]);
  if (read.status !== 'ready') { onProblem(read); return null; }
  const record = read.value.records.find((entry) => entry.refKey === key);
  if (record === undefined) {
    onProblem({ code: 'not_found', reason: `the QueryRun record ${key} is absent` });
    return null;
  }
  const decoded = decodeQueryRunSnapshotRecord(record);
  if (decoded.status !== 'decoded') {
    onProblem({ code: 'unavailable', reason: 'the QueryRun is not decodable' });
    return null;
  }
  if (decoded.value.ref.workspaceId !== workspace.workspaceId) return null;
  return decoded.value;
}

/**
 * The goal of a QueryRun's QueryJob. A failed or undecodable QueryJob read is a
 * problem reported to the sink; a run without a job, or a job that is simply
 * absent, has no goal.
 */
export async function readQueryJobGoal(
  records: LineClockStore,
  run: QueryRunSnapshot,
  onProblem: LineClockFailureSink,
): Promise<string | null> {
  const ref = run.run.queryJobRef;
  if (ref === undefined || ref === null) return null;
  const key = canonicalJson(ref as unknown as JsonValue);
  const read = await records.readMany([key]);
  if (read.status !== 'ready') { onProblem(read); return null; }
  const record = read.value.records.find((entry) => entry.refKey === key);
  if (record === undefined) return null;
  const decoded = decodeQueryJobSnapshot(record);
  if (decoded.status !== 'decoded') {
    onProblem({ code: 'unavailable', reason: 'the QueryJob is not decodable' });
    return null;
  }
  const goalId = decoded.value.job.goalId;
  return typeof goalId === 'string' ? goalId : null;
}

/**
 * A read-only copy's phase and Query start: its latest QueryRun's persisted
 * phase and `startedAt`, either null for a copy whose Query never started. The
 * run's QueryJob is read too, so a failed or damaged job is reported as it is
 * on a line card; the copy has no use for its goal.
 */
export async function copyPhase(
  records: LineClockStore,
  workspace: WorkspaceScope,
  copy: SessionRecord,
  onProblem: LineClockFailureSink,
): Promise<{ phase: QueryExecutionStateV1['phase'] | null; startedAt: string | null }> {
  const latest = await readLatestQueryRun(records, workspace, copy, onProblem);
  if (latest !== null) await readQueryJobGoal(records, latest, onProblem);
  return { phase: latest?.run.executionState?.phase ?? null, startedAt: latest?.run.startedAt ?? null };
}

/**
 * The claim time recorded for a specific Run, read only when the Run has
 * neither `startedAt` nor `endedAt` (L10). The generation-ordered claim index's
 * top row is that Run's claim when the Run is the Session's latest work
 * execution; it is trusted only when it names this Run (bounded: one ordered
 * page + one decode, no history scan).
 */
export async function readClaimedAtForRun(
  records: LineClockStore,
  workspace: WorkspaceScope,
  session: SessionRecord,
  runRef: RunRef,
  onProblem: LineClockFailureSink,
): Promise<string | null> {
  const page = await records.lookupOrdered({
    index: S2C_WORK_CLAIM_BY_SESSION_GENERATION_LOOKUP,
    values: [workspace.projectId, workspace.workspaceId, session.ref.sessionId],
    direction: 'desc',
    limit: 1,
  });
  if (page.status !== 'ready') { onProblem(page); return null; }
  if (page.value.records.length === 0) return null;
  const decoded = decodeDispatchOutboxEntry(page.value.records[0]!);
  if (decoded.status !== 'decoded') return null;
  return canonicalJson(decoded.value.claim.runRef as unknown as JsonValue)
    === canonicalJson(runRef as unknown as JsonValue)
    ? (decoded.value.claim.claimedAt ?? null) : null;
}
