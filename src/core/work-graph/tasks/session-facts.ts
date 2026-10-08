/**
 * Slice 1 §0.2 L1 / §3.3: the only implementation of `SessionFactsPort`. It
 * lives in `tasks` because it reads Outbox, QueryRun and Run records without
 * moving any codec; `sessions` and `queries` receive it as an injected port.
 *
 * Reads are keyset pages over the registered candidate indexes (canonical key
 * order, never time order), each candidate re-read as a canonical record. The
 * internal fact scan is 100/page and at most 25 pages; a scan that does not
 * finish is `incomplete/session_facts_page_limit:` and never a fabricated
 * "not waiting". `latestWork` is the max `claim.generation`, not the last page
 * row. The Work wait is the latest claim's yielded Run with a continuation, no
 * cancel control pointer and no successor consumption; a saved reply that was
 * not consumed yet still waits.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import type { SessionRecord } from '../../../contracts/core/session.js';
import type { TaskClaim } from '../../../contracts/core/task-claim.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import { makeCommitCursor, seqOfCommitCursor } from '../../../contracts/ledger.js';
import type { QueryRunRef, QueryRunSnapshot } from '../../../contracts/query-job.js';
import type { EncodedRecord, GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { RecordLookupPort, LookupValue } from '../../record-store/lookup-ports.js';
import { validateQueryRunSnapshot } from '../materials/record-readers.js';
import { decodeRun } from '../materials/run-snapshot-decoder.js';
import {
  SESSION_BY_WORKSPACE_LOOKUP, decodeSessionRecord, plainSessionRefToAggregate, sessionAggregateRefKey,
} from '../sessions/session-record-codecs.js';
import { runControlNodeOf } from '../state/run-machine.js';
import {
  QUERY_RUN_BY_SESSION_LOOKUP, SESSION_BY_PROVENANCE_LOOKUP, WORK_EXECUTION_BY_SESSION_LOOKUP,
  type SessionFactsPort, type SessionFactsV1, type SessionWorkWaitV1,
} from '../model/session-facts-contracts.js';
import type { SessionPage, SessionPageRequest } from '../model/session-contracts.js';
import { decodeDispatchOutboxEntry } from './claim-record-codecs.js';

export type SessionFactsStores = {
  records: GoalRecordTransactionPort & RecordLookupPort;
};

const INTERNAL_PAGE_SIZE = 100;
const INTERNAL_MAX_PAGES = 25;
const EXTERNAL_MAX_LIMIT = 100;
const FACTS_CURSOR_PREFIX = 's1-facts-page:';

// --------------------------------------------------------------------------
// Small local helpers
// --------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function refKeyOf(value: unknown): string {
  return canonicalJson(value as JsonValue);
}
function laterCursor(left: CommitCursor | null, right: CommitCursor | null): CommitCursor | null {
  if (left === null) return right;
  if (right === null) return left;
  return seqOfCommitCursor(right) > seqOfCommitCursor(left) ? right : left;
}
function unavailable(reason: string): CoreRejection { return { status: 'rejected', code: 'unavailable', reason }; }
function incomplete(reason: string): CoreRejection { return { status: 'rejected', code: 'incomplete', reason }; }
function invalid(reason: string): CoreRejection { return { status: 'rejected', code: 'invalid', reason }; }

type PageKind = 'executions' | 'queries' | 'successors';
type FactsPageCursor = {
  v: 1; kind: PageKind; projectId: string; workspaceId: string; sessionId: string; after: string;
  /** Queries only: the supplementary `lastExecutionRef` locator was already merged. */
  pointerDone?: boolean;
};
function encodeFactsCursor(cursor: FactsPageCursor): string {
  return FACTS_CURSOR_PREFIX + Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}
function compareCanonicalKeys(left: string, right: string): number {
  // The lookup backends order by UTF-8 byte order (SQLite BINARY); the opaque
  // cursor must resume the merged stream with the same comparator.
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}
function decodeFactsCursor(raw: unknown): FactsPageCursor | null {
  if (typeof raw !== 'string') return null;
  if (!raw.startsWith(FACTS_CURSOR_PREFIX)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw.slice(FACTS_CURSOR_PREFIX.length), 'base64url').toString('utf8')) as unknown;
    if (!isRecord(parsed) || parsed['v'] !== 1
      || (parsed['kind'] !== 'executions' && parsed['kind'] !== 'queries' && parsed['kind'] !== 'successors')
      || !nonEmpty(parsed['projectId']) || !nonEmpty(parsed['workspaceId']) || !nonEmpty(parsed['sessionId'])
      || !nonEmpty(parsed['after'])
      || (parsed['pointerDone'] !== undefined && typeof parsed['pointerDone'] !== 'boolean')) {
      return null;
    }
    return parsed as unknown as FactsPageCursor;
  } catch { return null; }
}

type Scope = { projectId: string; workspaceId: string; sessionId: string };
function scopeOf(ctx: CoreCallContext, sessionRef: SessionRef): Scope | null {
  const projectId = ctx?.projectId;
  const workspaceId = ctx?.workspaceId;
  if (!nonEmpty(projectId) || !nonEmpty(workspaceId)) return null;
  if (!isRecord(sessionRef) || sessionRef.projectId !== projectId || !nonEmpty(sessionRef.sessionId)) return null;
  return { projectId, workspaceId, sessionId: sessionRef.sessionId };
}
type InternalWindow =
  | { status: 'ready'; records: EncodedRecord[]; readThrough: CommitCursor | null; next: string | null; budgetHit: boolean }
  | { status: 'rejected'; rejection: CoreRejection };

/**
 * One bounded keyset sweep of a candidate index: 100/page, at most 25 pages,
 * every candidate re-read as a canonical record (a candidate index never
 * decides on its own). A candidate that the canonical read no longer returns
 * is not invented back; the scan reports `incomplete`.
 */
async function readLookupWindow(
  records: GoalRecordTransactionPort & RecordLookupPort,
  index: string,
  values: readonly LookupValue[],
): Promise<InternalWindow> {
  const collected: EncodedRecord[] = [];
  let after: string | undefined;
  let watermark: CommitCursor | null = null;
  for (let page = 0; page < INTERNAL_MAX_PAGES; page += 1) {
    let result;
    try {
      result = await records.lookup(after === undefined
        ? { index, values, limit: INTERNAL_PAGE_SIZE }
        : { index, values, after, limit: INTERNAL_PAGE_SIZE });
    } catch (error) {
      return { status: 'rejected', rejection: unavailable(`the Session facts lookup failed: ${String(error)}`) };
    }
    if (result.status !== 'ready') {
      if (result.code === 'unsupported') {
        return { status: 'rejected', rejection: incomplete(`session_facts_page_limit: lookup index ${index} is not registered`) };
      }
      if (result.code === 'invalid') {
        return { status: 'rejected', rejection: incomplete(`session_facts_page_limit: lookup index ${index} rejected the request: ${result.reason}`) };
      }
      return { status: 'rejected', rejection: unavailable(`${result.code}: ${result.reason}`) };
    }
    const candidateKeys = result.value.records.map(record => record.refKey);
    if (candidateKeys.length > 0) {
      let read;
      try {
        read = await records.readMany(candidateKeys);
      } catch (error) {
        return { status: 'rejected', rejection: unavailable(`the Session facts canonical read failed: ${String(error)}`) };
      }
      if (read.status !== 'ready') {
        return { status: 'rejected', rejection: unavailable(`${read.code}: ${read.reason}`) };
      }
      const present = new Map(read.value.records.map(record => [record.refKey, record]));
      for (const key of candidateKeys) {
        const canonical = present.get(key);
        if (canonical === undefined) {
          return { status: 'rejected', rejection: incomplete(`session_facts_page_limit: candidate ${key} was not confirmed by the canonical read`) };
        }
        collected.push(canonical);
      }
      watermark = laterCursor(watermark, read.value.readThrough);
    } else {
      watermark = laterCursor(watermark, result.value.readThrough);
    }
    if (result.value.next === null) {
      return { status: 'ready', records: collected, readThrough: watermark, next: null, budgetHit: false };
    }
    after = result.value.next;
  }
  return { status: 'ready', records: collected, readThrough: watermark, next: after ?? null, budgetHit: true };
}

function validLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= EXTERNAL_MAX_LIMIT;
}

// --------------------------------------------------------------------------
// The service
// --------------------------------------------------------------------------

export function createSessionFactsService(stores: SessionFactsStores): SessionFactsPort {
  const records: GoalRecordTransactionPort & RecordLookupPort = stores.records;

  async function readSessionRecord(scope: Scope): Promise<{ status: 'ready'; session: SessionRecord; readThrough: CommitCursor | null }
    | { status: 'rejected'; rejection: CoreRejection }> {
    const sessionKey = sessionAggregateRefKey(plainSessionRefToAggregate({ projectId: scope.projectId, sessionId: scope.sessionId }));
    let read;
    try {
      read = await records.readMany([sessionKey]);
    } catch (error) {
      return { status: 'rejected', rejection: unavailable(`the Session record read failed: ${String(error)}`) };
    }
    if (read.status !== 'ready') {
      if (read.code === 'not_found') return { status: 'rejected', rejection: { status: 'rejected', code: 'not_found', reason: 'the requested Session does not exist' } };
      return { status: 'rejected', rejection: unavailable(`${read.code}: ${read.reason}`) };
    }
    const record = read.value.records.find(candidate => candidate.refKey === sessionKey);
    if (record === undefined) return { status: 'rejected', rejection: { status: 'rejected', code: 'not_found', reason: 'the requested Session does not exist' } };
    const decoded = decodeSessionRecord(record);
    if (decoded.status !== 'decoded') return { status: 'rejected', rejection: unavailable(`the Session record is damaged: ${decoded.reason}`) };
    const session = decoded.value;
    if (session.ref.projectId !== scope.projectId || session.workspaceId !== scope.workspaceId) {
      return { status: 'rejected', rejection: { status: 'rejected', code: 'not_found', reason: 'the requested Session is outside the bound workspace' } };
    }
    return { status: 'ready', session, readThrough: read.value.readThrough };
  }

  async function readSessionFacts(ctx: CoreCallContext, sessionRef: SessionRef): Promise<ReadResult<SessionFactsV1>> {
    if (ctx?.signal?.aborted) return { status: 'rejected', code: 'cancelled', reason: 'the Session facts read was cancelled' };
    const scope = scopeOf(ctx, sessionRef);
    if (scope === null) return invalid('readSessionFacts requires a complete SessionRef in the bound project/workspace');
    const owned = await readSessionRecord(scope);
    if (owned.status !== 'ready') return owned.rejection;
    const { session } = owned;
    let watermark = owned.readThrough;

    // Work executions: the never-claimed fast path proves no Work wait without
    // touching a backend that may lack the execution schemas. Every real claim
    // occupies the Session and sets `lastExecutionRef` in the same commit.
    let latestWork: TaskClaim | null = null;
    let wait: SessionWorkWaitV1 | null = null;
    if (session.lastExecutionRef !== null) {
      const executions = await readLookupWindow(records, WORK_EXECUTION_BY_SESSION_LOOKUP,
        [scope.projectId, scope.workspaceId, scope.sessionId]);
      if (executions.status !== 'ready') return executions.rejection;
      if (executions.budgetHit) {
        return incomplete(`session_facts_page_limit: the Work execution scan of Session ${scope.sessionId} did not finish`);
      }
      watermark = laterCursor(watermark, executions.readThrough);
      for (const record of executions.records) {
        const decoded = decodeDispatchOutboxEntry(record);
        if (decoded.status !== 'decoded') return unavailable(`the Work outbox entry ${record.refKey} is damaged: ${decoded.reason}`);
        const claim = decoded.value.claim;
        if (claim.task.projectId !== scope.projectId || claim.workspaceId !== scope.workspaceId
          || claim.sessionRef.sessionId !== scope.sessionId) {
          return unavailable(`the Work outbox entry ${record.refKey} does not belong to Session ${scope.sessionId}`);
        }
        if (latestWork === null || claim.generation > latestWork.generation) latestWork = claim;
      }
      if (latestWork !== null) {
        const runKey = refKeyOf(latestWork.runRef);
        let runRead;
        try {
          runRead = await records.readMany([runKey]);
        } catch (error) {
          return unavailable(`the latest Work Run read failed: ${String(error)}`);
        }
        if (runRead.status !== 'ready') {
          // A technical read failure is `unavailable` with the detail; only a
          // confirmed absence below is an incomplete fact window.
          return unavailable(`the latest Work Run is not readable: ${runRead.code}: ${runRead.reason}`);
        }
        const runRecord = runRead.value.records.find(candidate => candidate.refKey === runKey);
        if (runRecord === undefined) return incomplete('session_facts_page_limit: the latest Work Run is missing');
        watermark = laterCursor(watermark, runRead.value.readThrough);
        const run = decodeRun(runRecord);
        if (!run.ok) return unavailable(`the latest Work Run is not readable: ${run.reason}`);
        if (run.value.task.projectId !== scope.projectId
          || run.value.ref.goalId !== latestWork.task.goalId
          || run.value.ref.runId !== latestWork.runRef.runId) {
          return unavailable('the latest Work Run does not belong to the latest claim');
        }
        if (runControlNodeOf(run.value) === 'YieldedWait' && run.value.controlState?.desiredState !== 'cancelled') {
          // The latest claim is the max generation, so no same-Session successor
          // can consume it; a cross-Session hand-off must commit the old wait
          // cancel first, which is the `cancelled` pointer read above.
          const continuation = run.value.continuation!;
          wait = { runRef: run.value.ref, messageRef: continuation.messageRef, task: continuation.task };
        }
      }
    }

    // Successors (direct line heads): Sessions whose recorded provenance points
    // at this Session. A page-budget hit cannot be reported as "no successor".
    let legacyPending = false;
    const continuations: SessionRef[] = [];
    const successors = await readLookupWindow(records, SESSION_BY_PROVENANCE_LOOKUP,
      [scope.projectId, scope.workspaceId, scope.sessionId]);
    if (successors.status !== 'ready') return successors.rejection;
    if (successors.budgetHit) {
      return incomplete(`session_facts_page_limit: the successor scan of Session ${scope.sessionId} did not finish`);
    }
    watermark = laterCursor(watermark, successors.readThrough);
    for (const record of successors.records) {
      const decoded = decodeSessionRecord(record);
      if (decoded.status !== 'decoded') return unavailable(`the successor Session ${record.refKey} is damaged: ${decoded.reason}`);
      const successor = decoded.value;
      if (successor.workspaceId !== scope.workspaceId) continue;
      const provenance = successor.provenance ?? null;
      // §2.2 S:190: a Session whose provenance is still unchecked is an
      // unresolved legacy candidate. It is not a definite "no successor".
      if (provenance === null) { legacyPending = true; continue; }
      // Only a real continuation is a successor line head: a handoff stops the
      // trace and a readonly copy attaches to its `from`.
      if (provenance.kind !== 'continuation') continue;
      if (provenance.from.projectId !== scope.projectId || provenance.from.sessionId !== scope.sessionId) continue;
      continuations.push(successor.ref);
    }
    // §2.2/§3.4 S:628: a still-unchecked legacy Session has no provenance index
    // entry, so the successor sweep above can never see it. Sweep the workspace
    // Session lookup (the same one the provenance reader uses) and mark the
    // successor proof unresolved while any OTHER Session of the workspace still
    // has no recorded provenance. The target itself cannot be its own successor.
    if (!legacyPending) {
      const workspace = await readLookupWindow(records, SESSION_BY_WORKSPACE_LOOKUP,
        [scope.projectId, scope.workspaceId]);
      if (workspace.status !== 'ready') return workspace.rejection;
      // An unfinished workspace window cannot prove "no unresolved candidate",
      // so keep the conservative pending marker.
      if (workspace.budgetHit) legacyPending = true;
      watermark = laterCursor(watermark, workspace.readThrough);
      for (const record of workspace.records) {
        const decoded = decodeSessionRecord(record);
        if (decoded.status !== 'decoded') return unavailable(`a workspace Session is damaged: ${decoded.reason}`);
        const candidate = decoded.value;
        if (candidate.workspaceId !== scope.workspaceId) continue;
        if (candidate.ref.sessionId === scope.sessionId) continue;
        if ((candidate.provenance ?? null) === null) { legacyPending = true; break; }
      }
    }
    const recorded = session.provenance ?? null;
    const predecessor = recorded !== null && recorded.kind !== 'new' ? recorded : null;
    return {
      status: 'ready',
      value: {
        session, latestWork, wait, predecessor, continuations, legacyPending,
        sourceCursor: watermark ?? makeCommitCursor(1),
      },
    };
  }

  async function listSessionExecutions(
    ctx: CoreCallContext,
    input: { sessionRef: SessionRef; page: SessionPageRequest },
  ): Promise<ReadResult<SessionPage<TaskClaim>>> {
    if (ctx?.signal?.aborted) return { status: 'rejected', code: 'cancelled', reason: 'the Session executions read was cancelled' };
    const scope = scopeOf(ctx, input?.sessionRef);
    if (scope === null) return invalid('listSessionExecutions requires a complete SessionRef in the bound project/workspace');
    const page = input?.page;
    if (!isRecord(page) || !validLimit(page['limit'])) return invalid(`page.limit must be an integer between 1 and ${EXTERNAL_MAX_LIMIT}`);
    let after: string | undefined;
    if (page['cursor'] !== undefined) {
      const decoded = decodeFactsCursor(page['cursor'] as string);
      if (decoded === null || decoded.kind !== 'executions' || decoded.projectId !== scope.projectId
        || decoded.workspaceId !== scope.workspaceId || decoded.sessionId !== scope.sessionId) {
        return invalid('the page cursor belongs to another scope, Session or query kind');
      }
      after = decoded.after;
    }
    let result;
    try {
      result = await records.lookup(after === undefined
        ? { index: WORK_EXECUTION_BY_SESSION_LOOKUP, values: [scope.projectId, scope.workspaceId, scope.sessionId], limit: page['limit'] }
        : { index: WORK_EXECUTION_BY_SESSION_LOOKUP, values: [scope.projectId, scope.workspaceId, scope.sessionId], after, limit: page['limit'] });
    } catch (error) {
      return unavailable(`the Session executions lookup failed: ${String(error)}`);
    }
    if (result.status !== 'ready') return unavailable(`${result.code}: ${result.reason}`);
    const keys = result.value.records.map(record => record.refKey);
    let read;
    try {
      read = await records.readMany(keys);
    } catch (error) {
      return unavailable(`the Session executions read failed: ${String(error)}`);
    }
    if (read.status !== 'ready') return unavailable(`${read.code}: ${read.reason}`);
    const present = new Map(read.value.records.map(record => [record.refKey, record]));
    const items: TaskClaim[] = [];
    for (const key of keys) {
      const record = present.get(key);
      if (record === undefined) return incomplete(`session_facts_page_limit: execution ${key} was not confirmed by the canonical read`);
      const decoded = decodeDispatchOutboxEntry(record);
      if (decoded.status !== 'decoded') return unavailable(`the Work outbox entry ${key} is damaged: ${decoded.reason}`);
      const claim = decoded.value.claim;
      if (claim.task.projectId !== scope.projectId || claim.workspaceId !== scope.workspaceId
        || claim.sessionRef.sessionId !== scope.sessionId) {
        return unavailable(`the Work outbox entry ${key} does not belong to Session ${scope.sessionId}`);
      }
      items.push(claim);
    }
    const nextCursor = result.value.next === null ? null : encodeFactsCursor({
      v: 1, kind: 'executions', projectId: scope.projectId, workspaceId: scope.workspaceId,
      sessionId: scope.sessionId, after: result.value.next,
    });
    return { status: 'ready', value: { items, nextCursor, sourceCursor: read.value.readThrough ?? makeCommitCursor(1) } };
  }

  async function listSessionQueries(
    ctx: CoreCallContext,
    input: { sessionRef: SessionRef; page: SessionPageRequest },
  ): Promise<ReadResult<SessionPage<QueryRunSnapshot>>> {
    if (ctx?.signal?.aborted) return { status: 'rejected', code: 'cancelled', reason: 'the Session queries read was cancelled' };
    const scope = scopeOf(ctx, input?.sessionRef);
    if (scope === null) return invalid('listSessionQueries requires a complete SessionRef in the bound project/workspace');
    const page = input?.page;
    if (!isRecord(page) || !validLimit(page['limit'])) return invalid(`page.limit must be an integer between 1 and ${EXTERNAL_MAX_LIMIT}`);
    let after: string | undefined;
    let pointerDone = false;
    if (page['cursor'] !== undefined) {
      const decoded = decodeFactsCursor(page['cursor'] as string);
      if (decoded === null || decoded.kind !== 'queries' || decoded.projectId !== scope.projectId
        || decoded.workspaceId !== scope.workspaceId || decoded.sessionId !== scope.sessionId) {
        return invalid('the page cursor belongs to another scope, Session or query kind');
      }
      after = decoded.after;
      pointerDone = decoded.pointerDone === true;
    }
    const sessionRead = await readSessionRecord(scope);
    if (sessionRead.status !== 'ready') return sessionRead.rejection;
    let result;
    try {
      result = await records.lookup(after === undefined
        ? { index: QUERY_RUN_BY_SESSION_LOOKUP, values: [scope.projectId, scope.workspaceId, scope.sessionId], limit: page['limit'] }
        : { index: QUERY_RUN_BY_SESSION_LOOKUP, values: [scope.projectId, scope.workspaceId, scope.sessionId], after, limit: page['limit'] });
    } catch (error) {
      return unavailable(`the Session queries lookup failed: ${String(error)}`);
    }
    if (result.status !== 'ready') return unavailable(`${result.code}: ${result.reason}`);
    const keys = result.value.records.map(record => record.refKey);
    // §2.8: the existing exact `lastExecutionRef` pointer is a supplementary
    // locator for an old QueryRun without `executionState` (which has no index
    // entry). It is merged with the indexed page by full ref; the opaque cursor
    // carries the last emitted ref so the merged stream never repeats the
    // pointer on a later page and never exceeds `limit`.
    const pointer = sessionRead.session.lastExecutionRef;
    const pointerRef: QueryRunRef | null = pointer !== null && pointer.aggregateType === 'QueryRun'
      && pointer.projectId === scope.projectId && pointer.workspaceId === scope.workspaceId ? pointer : null;
    const pointerKey = pointerRef === null ? null : refKeyOf(pointerRef);
    const pointerActive = pointerKey !== null && !pointerDone
      && (after === undefined || compareCanonicalKeys(pointerKey, after) > 0);
    const candidates = [...keys];
    if (pointerActive && pointerKey !== null && !candidates.includes(pointerKey)) candidates.push(pointerKey);
    candidates.sort(compareCanonicalKeys);
    const pageKeys = candidates.slice(0, page['limit']);
    const hasMore = pageKeys.length < candidates.length || result.value.next !== null;
    if (pageKeys.length === 0 && hasMore) {
      // A page with no emittable ref cannot advance the opaque cursor; refuse
      // rather than loop or silently report an absent Query.
      return incomplete(`session_facts_page_limit: the QueryRun window of Session ${scope.sessionId} did not advance`);
    }
    const lastEmitted = pageKeys.length > 0 ? pageKeys[pageKeys.length - 1] : after;
    const pointerDoneNext = pointerKey !== null && (pointerDone || pageKeys.includes(pointerKey)
      || (lastEmitted !== undefined && compareCanonicalKeys(pointerKey, lastEmitted) <= 0));
    let read;
    try {
      read = await records.readMany(pageKeys);
    } catch (error) {
      return unavailable(`the Session queries read failed: ${String(error)}`);
    }
    if (read.status !== 'ready') return unavailable(`${read.code}: ${read.reason}`);
    const present = new Map(read.value.records.map(record => [record.refKey, record]));
    const entries: QueryRunSnapshot[] = [];
    for (const key of pageKeys) {
      const record = present.get(key);
      if (record === undefined) {
        if (key === pointerKey) continue;
        return incomplete(`session_facts_page_limit: QueryRun ${key} was not confirmed by the canonical read`);
      }
      const validated = validateQueryRunSnapshot(record);
      if (validated.status !== 'decoded') return unavailable(`the QueryRun ${key} is damaged: ${validated.reason}`);
      let snapshot: QueryRunSnapshot;
      try {
        snapshot = JSON.parse(record.json) as QueryRunSnapshot;
      } catch {
        return unavailable(`the QueryRun ${key} is not parseable`);
      }
      if (snapshot.ref.projectId !== scope.projectId || snapshot.ref.workspaceId !== scope.workspaceId) {
        return unavailable(`the QueryRun ${key} is outside the bound scope`);
      }
      const state = snapshot.run.executionState;
      const sessionMatch = state !== undefined && state.sessionRef.sessionId === scope.sessionId;
      if (!sessionMatch && key !== pointerKey) {
        return unavailable(`the QueryRun ${key} does not belong to Session ${scope.sessionId}`);
      }
      entries.push(snapshot);
    }
    const nextCursor = hasMore && lastEmitted !== undefined ? encodeFactsCursor({
      v: 1, kind: 'queries', projectId: scope.projectId, workspaceId: scope.workspaceId,
      sessionId: scope.sessionId, after: lastEmitted, ...(pointerDoneNext ? { pointerDone: true } : {}),
    }) : null;
    return { status: 'ready', value: {
      items: entries, nextCursor,
      sourceCursor: read.value.readThrough ?? makeCommitCursor(1),
    } };
  }

  async function findSessionSuccessors(
    ctx: CoreCallContext,
    input: { sessionRef: SessionRef; page: SessionPageRequest },
  ): Promise<ReadResult<SessionPage<SessionRecord>>> {
    if (ctx?.signal?.aborted) return { status: 'rejected', code: 'cancelled', reason: 'the Session successors read was cancelled' };
    const scope = scopeOf(ctx, input?.sessionRef);
    if (scope === null) return invalid('findSessionSuccessors requires a complete SessionRef in the bound project/workspace');
    const page = input?.page;
    if (!isRecord(page) || !validLimit(page['limit'])) return invalid(`page.limit must be an integer between 1 and ${EXTERNAL_MAX_LIMIT}`);
    let after: string | undefined;
    if (page['cursor'] !== undefined) {
      const decoded = decodeFactsCursor(page['cursor'] as string);
      if (decoded === null || decoded.kind !== 'successors' || decoded.projectId !== scope.projectId
        || decoded.workspaceId !== scope.workspaceId || decoded.sessionId !== scope.sessionId) {
        return invalid('the page cursor belongs to another scope, Session or query kind');
      }
      after = decoded.after;
    }
    let result;
    try {
      result = await records.lookup(after === undefined
        ? { index: SESSION_BY_PROVENANCE_LOOKUP, values: [scope.projectId, scope.workspaceId, scope.sessionId], limit: page['limit'] }
        : { index: SESSION_BY_PROVENANCE_LOOKUP, values: [scope.projectId, scope.workspaceId, scope.sessionId], after, limit: page['limit'] });
    } catch (error) {
      return unavailable(`the Session successors lookup failed: ${String(error)}`);
    }
    if (result.status !== 'ready') return unavailable(`${result.code}: ${result.reason}`);
    const keys = result.value.records.map(record => record.refKey);
    let read;
    try {
      read = await records.readMany(keys);
    } catch (error) {
      return unavailable(`the Session successors read failed: ${String(error)}`);
    }
    if (read.status !== 'ready') return unavailable(`${read.code}: ${read.reason}`);
    const present = new Map(read.value.records.map(record => [record.refKey, record]));
    const items: SessionRecord[] = [];
    for (const key of keys) {
      const record = present.get(key);
      if (record === undefined) return incomplete(`session_facts_page_limit: successor ${key} was not confirmed by the canonical read`);
      const decoded = decodeSessionRecord(record);
      if (decoded.status !== 'decoded') return unavailable(`the successor Session ${key} is damaged: ${decoded.reason}`);
      const successor = decoded.value;
      if (successor.workspaceId !== scope.workspaceId) continue;
      const provenance = successor.provenance ?? null;
      if (provenance === null || provenance.kind === 'new') continue;
      if (provenance.from.projectId !== scope.projectId || provenance.from.sessionId !== scope.sessionId) continue;
      items.push(successor);
    }
    const nextCursor = result.value.next === null ? null : encodeFactsCursor({
      v: 1, kind: 'successors', projectId: scope.projectId, workspaceId: scope.workspaceId,
      sessionId: scope.sessionId, after: result.value.next,
    });
    return { status: 'ready', value: { items, nextCursor, sourceCursor: read.value.readThrough ?? makeCommitCursor(1) } };
  }

  return { readSessionFacts, listSessionExecutions, listSessionQueries, findSessionSuccessors };
}
