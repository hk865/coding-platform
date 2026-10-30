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
 * row. `waits` is every open/answered/expired released inquiry this Session
 * sent, oldest `since` first; `wait` is the first of those whose own Run really
 * yielded on it (yielded, no cancel control pointer, continuation on the same
 * message). A saved reply that was not consumed yet still waits.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { SessionRecord } from '../../../contracts/core/session.js';
import type { TaskClaim } from '../../../contracts/core/task-claim.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import { isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import { makeCommitCursor, seqOfCommitCursor } from '../../../contracts/ledger.js';
import type { QueryRunSnapshot } from '../../../contracts/query-job.js';
import type { RunSnapshot } from '../../../contracts/dispatch.js';
import type { EncodedRecord, GoalRecordTransactionPort } from '../../record-store/ports.js';
import type {
  LookupValue, OrderedLookupRequest, RecordLookupPort, RecordOrderedLookupPort,
} from '../../record-store/lookup-ports.js';
import { validateQueryRunSnapshot } from '../materials/record-readers.js';
import { decodeRun } from '../materials/run-snapshot-decoder.js';
import type { SessionMessage } from '../model/communication-contracts.js';
import {
  decodeSessionRecord, plainSessionRefToAggregate, sessionAggregateRefKey,
} from '../sessions/session-record-codecs.js';
import {
  S7B_WAITS_BY_SENDER_SESSION_LOOKUP, decodeNoticeOrigin, decodeSessionMessageRecord,
  sessionMessageRefKey,
} from '../sessions/message-record-codecs.js';
import { runControlNodeOf } from '../state/run-machine.js';
import { sameRef } from '../state/ref-equality.js';
import {
  messageConsumptionProblem, messageFactsOfRecord, waitFactsOfRecord, waitStateOf,
} from '../state/message-machine.js';
import {
  QUERY_RUN_BY_SESSION_LOOKUP, SESSION_BY_PROVENANCE_LOOKUP, WORK_EXECUTION_BY_SESSION_LOOKUP,
  type SessionFactsPort, type SessionFactsV1, type SessionWaitV1, type SessionWorkWaitV1,
} from '../model/session-facts-contracts.js';
import type { SessionPage, SessionPageRequest } from '../model/session-contracts.js';
import { decodeDispatchOutboxEntry } from './claim-record-codecs.js';

export type SessionFactsStores = {
  records: GoalRecordTransactionPort & RecordLookupPort & RecordOrderedLookupPort;
};

const INTERNAL_PAGE_SIZE = 100;
const INTERNAL_MAX_PAGES = 25;
const EXTERNAL_MAX_LIMIT = 100;
const FACTS_CURSOR_PREFIX = 's1-facts-page:';

// --------------------------------------------------------------------------
// Small local helpers
// --------------------------------------------------------------------------

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
};
function encodeFactsCursor(cursor: FactsPageCursor): string {
  return FACTS_CURSOR_PREFIX + Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}
function decodeFactsCursor(raw: unknown): FactsPageCursor | null {
  if (typeof raw !== 'string') return null;
  if (!raw.startsWith(FACTS_CURSOR_PREFIX)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw.slice(FACTS_CURSOR_PREFIX.length), 'base64url').toString('utf8')) as unknown;
    if (!isRecord(parsed) || parsed['v'] !== 1
      || (parsed['kind'] !== 'executions' && parsed['kind'] !== 'queries' && parsed['kind'] !== 'successors')
      || !nonEmpty(parsed['projectId']) || !nonEmpty(parsed['workspaceId']) || !nonEmpty(parsed['sessionId'])
      || !nonEmpty(parsed['after'])) {
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

/** The two candidate reads the one bounded sweep pages: an unordered and an ordered index. */
type WindowRequest =
  | { kind: 'plain'; index: string; values: readonly LookupValue[] }
  | { kind: 'ordered'; index: string; values: readonly string[] };

/**
 * One bounded keyset sweep of a candidate index: 100/page, at most 25 pages,
 * every candidate re-read as a canonical record (a candidate index never
 * decides on its own). A candidate that the canonical read no longer returns
 * is not invented back; the scan reports `incomplete`.
 */
async function readLookupWindow(
  records: GoalRecordTransactionPort & RecordLookupPort & RecordOrderedLookupPort,
  request: WindowRequest,
): Promise<InternalWindow> {
  const collected: EncodedRecord[] = [];
  let after: string | OrderedLookupRequest['after'] | undefined;
  let watermark: CommitCursor | null = null;
  for (let page = 0; page < INTERNAL_MAX_PAGES; page += 1) {
    let result;
    try {
      result = request.kind === 'ordered'
        ? await records.lookupOrdered({
            index: request.index, values: request.values, direction: 'asc',
            ...(after === undefined ? {} : { after: after as NonNullable<OrderedLookupRequest['after']> }),
            limit: INTERNAL_PAGE_SIZE,
          })
        : await records.lookup({
            index: request.index, values: request.values,
            ...(after === undefined ? {} : { after: after as string }),
            limit: INTERNAL_PAGE_SIZE,
          });
    } catch (error) {
      return { status: 'rejected', rejection: unavailable(`the Session facts lookup failed: ${String(error)}`) };
    }
    if (result.status !== 'ready') {
      if (result.code === 'unsupported') {
        return { status: 'rejected', rejection: incomplete(`session_facts_page_limit: lookup index ${request.index} is not registered`) };
      }
      if (result.code === 'invalid') {
        return { status: 'rejected', rejection: incomplete(`session_facts_page_limit: lookup index ${request.index} rejected the request: ${result.reason}`) };
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
  return { status: 'ready', records: collected, readThrough: watermark,
    next: typeof after === 'string' ? after : null, budgetHit: true };
}

function validLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= EXTERNAL_MAX_LIMIT;
}

/**
 * The one wait row of a decoded message. `rootRef` is the message itself,
 * with no forward walk (D8). A Host sender has no Session, so it cannot be the
 * sender Session the wait index names; such a message is not a wait.
 */
function readWaitRow(message: SessionMessage): SessionWaitV1 | null {
  if (message.intent !== 'inquiry' || message.waitAfterSend !== true) return null;
  if (message.sender.kind === 'host') return null;
  return {
    messageRef: message.ref,
    rootRef: message.ref,
    waitingSession: message.sender.sessionRef,
    originalRun: message.sender.kind === 'work_run' ? message.sender.runRef : null,
    requestRoot: message.requestRoot,
    recipient: message.recipient,
    state: waitStateOf(message, waitFactsOfRecord(message)),
    deadline: message.deadline,
    expiredAt: message.expiredAt,
    complete: true,
  };
}

// --------------------------------------------------------------------------
// The service
// --------------------------------------------------------------------------

export function createSessionFactsService(stores: SessionFactsStores): SessionFactsPort {
  const records = stores.records;

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
    let waits: SessionWaitV1[] = [];
    if (session.lastExecutionRef !== null) {
      const executions = await readLookupWindow(records, {
        kind: 'plain', index: WORK_EXECUTION_BY_SESSION_LOOKUP,
        values: [scope.projectId, scope.workspaceId, scope.sessionId],
      });
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

      // Waits: one sender Session's inquiries, oldest `since` first. The ordered
      // index pages by its own `{order, refKey}`; a page-budget hit is
      // `incomplete`, never "no wait".
      const waitWindow = await readLookupWindow(records, {
        kind: 'ordered', index: S7B_WAITS_BY_SENDER_SESSION_LOOKUP,
        values: [scope.projectId, scope.workspaceId, scope.sessionId, 'inquiry'],
      });
      if (waitWindow.status !== 'ready') return waitWindow.rejection;
      if (waitWindow.budgetHit) {
        return incomplete(`session_facts_page_limit: the wait scan of Session ${scope.sessionId} did not finish`);
      }
      watermark = laterCursor(watermark, waitWindow.readThrough);
      const candidates: { row: SessionWaitV1; order: number; refKey: string }[] = [];
      for (const record of waitWindow.records) {
        const decoded = decodeSessionMessageRecord(record);
        if (decoded.status !== 'decoded') {
          return unavailable(`the wait message ${record.refKey} is damaged: ${decoded.reason}`);
        }
        const message = decoded.value;
        // The index narrows only by `intent`; the remaining residual is in memory.
        if (message.waitAfterSend !== true) continue;
        if (messageConsumptionProblem(messageFactsOfRecord(message)) !== null) continue;
        const row = readWaitRow(message);
        if (row === null) continue;
        if (row.state.state !== 'open' && row.state.state !== 'answered' && row.state.state !== 'expired') continue;
        const origin = decodeNoticeOrigin(record);
        if (origin.status !== 'decoded') {
          return unavailable(`the wait message ${record.refKey} has no stored creation position`);
        }
        candidates.push({
          row, order: seqOfCommitCursor(origin.value.since!), refKey: sessionMessageRefKey(message.ref),
        });
      }
      candidates.sort((left, right) => left.order === right.order
        ? (left.refKey < right.refKey ? -1 : left.refKey > right.refKey ? 1 : 0)
        : left.order - right.order);
      waits = candidates.map(candidate => candidate.row);

      // `wait` is the first row in that order whose own Run really yielded on
      // it. One read covers the distinct `originalRun` records; a row whose Run
      // ended before yielding (W-18) or carries the archive's cancel pointer
      // stays in `waits` only.
      const rowByRunKey = new Map<string, SessionWaitV1>();
      for (const candidate of candidates) {
        if (candidate.row.originalRun === null) continue;
        const runKey = refKeyOf(candidate.row.originalRun);
        if (!rowByRunKey.has(runKey)) rowByRunKey.set(runKey, candidate.row);
      }
      const runKeys = [...rowByRunKey.keys()];
      if (runKeys.length > 0) {
        let runRead;
        try {
          runRead = await records.readMany(runKeys);
        } catch (error) {
          return unavailable(`the wait Run read failed: ${String(error)}`);
        }
        if (runRead.status !== 'ready') {
          // A technical read failure is `unavailable` with the detail; only a
          // confirmed absence below is an incomplete fact window.
          return unavailable(`the wait Run is not readable: ${runRead.code}: ${runRead.reason}`);
        }
        watermark = laterCursor(watermark, runRead.value.readThrough);
        const present = new Map(runRead.value.records.map(record => [record.refKey, record]));
        const runs = new Map<string, RunSnapshot>();
        for (const runKey of runKeys) {
          const runRecord = present.get(runKey);
          if (runRecord === undefined) return incomplete('session_facts_page_limit: a wait Run is missing');
          const run = decodeRun(runRecord);
          if (!run.ok) return unavailable(`the wait Run is not readable: ${run.reason}`);
          const row = rowByRunKey.get(runKey)!;
          const originalRun = row.originalRun!;
          if (run.value.task.projectId !== scope.projectId
            || run.value.ref.projectId !== originalRun.projectId
            || run.value.ref.goalId !== originalRun.goalId
            || run.value.ref.runId !== originalRun.runId) {
            return unavailable('the wait Run does not belong to the wait message');
          }
          runs.set(runKey, run.value);
        }
        for (const candidate of candidates) {
          const originalRun = candidate.row.originalRun;
          if (originalRun === null) continue;
          const run = runs.get(refKeyOf(originalRun))!;
          if (runControlNodeOf(run) === 'YieldedWait' && run.controlState?.desiredState !== 'cancelled'
            && sameRef(run.continuation!.messageRef, candidate.row.messageRef)) {
            wait = { runRef: originalRun, messageRef: candidate.row.messageRef, task: run.continuation!.task };
            break;
          }
        }
      }
    }

    // Successors (direct line heads): Sessions whose recorded provenance points
    // at this Session. A page-budget hit cannot be reported as "no successor".
    const continuations: SessionRef[] = [];
    const successors = await readLookupWindow(records, {
      kind: 'plain', index: SESSION_BY_PROVENANCE_LOOKUP,
      values: [scope.projectId, scope.workspaceId, scope.sessionId],
    });
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
      const provenance = successor.provenance;
      // Only a real continuation is a successor line head: a handoff stops the
      // trace and a readonly copy attaches to its `from`.
      if (provenance.kind !== 'continuation') continue;
      if (provenance.from.projectId !== scope.projectId || provenance.from.sessionId !== scope.sessionId) continue;
      continuations.push(successor.ref);
    }
    const recorded = session.provenance;
    const predecessor = recorded.kind !== 'new' ? recorded : null;
    return {
      status: 'ready',
      value: {
        session, latestWork, wait, waits, predecessor, continuations,
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
    if (page['cursor'] !== undefined) {
      const decoded = decodeFactsCursor(page['cursor'] as string);
      if (decoded === null || decoded.kind !== 'queries' || decoded.projectId !== scope.projectId
        || decoded.workspaceId !== scope.workspaceId || decoded.sessionId !== scope.sessionId) {
        return invalid('the page cursor belongs to another scope, Session or query kind');
      }
      after = decoded.after;
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
    const pageKeys = keys.slice(0, page['limit']);
    const hasMore = result.value.next !== null;
    if (pageKeys.length === 0 && hasMore) {
      // A page with no emittable ref cannot advance the opaque cursor; refuse
      // rather than loop or silently report an absent Query.
      return incomplete(`session_facts_page_limit: the QueryRun window of Session ${scope.sessionId} did not advance`);
    }
    const lastEmitted = pageKeys.length > 0 ? pageKeys[pageKeys.length - 1] : after;
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
      if (!sessionMatch) {
        return unavailable(`the QueryRun ${key} does not belong to Session ${scope.sessionId}`);
      }
      entries.push(snapshot);
    }
    const nextCursor = hasMore && lastEmitted !== undefined ? encodeFactsCursor({
      v: 1, kind: 'queries', projectId: scope.projectId, workspaceId: scope.workspaceId,
      sessionId: scope.sessionId, after: lastEmitted,
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
      const provenance = successor.provenance;
      if (provenance.kind === 'new') continue;
      if (provenance.from.projectId !== scope.projectId || provenance.from.sessionId !== scope.sessionId) continue;
      items.push(successor);
    }
    const nextCursor = result.value.next === null ? null : encodeFactsCursor({
      v: 1, kind: 'successors', projectId: scope.projectId, workspaceId: scope.workspaceId,
      sessionId: scope.sessionId, after: result.value.next,
    });
    return { status: 'ready', value: { items, nextCursor, sourceCursor: read.value.readThrough ?? makeCommitCursor(1) } };
  }

  async function readWait(
    ctx: CoreCallContext,
    input: { messageRef: SessionMessageRef },
  ): Promise<ReadResult<SessionWaitV1>> {
    if (ctx?.signal?.aborted) return { status: 'rejected', code: 'cancelled', reason: 'the wait read was cancelled' };
    const key = sessionMessageRefKey(input.messageRef);
    let read;
    try {
      read = await records.readMany([key]);
    } catch (error) {
      return unavailable(`the wait message read failed: ${String(error)}`);
    }
    if (read.status !== 'ready') return unavailable(`${read.code}: ${read.reason}`);
    const record = read.value.records.find(candidate => candidate.refKey === key);
    if (record === undefined) return { status: 'not_found' };
    const decoded = decodeSessionMessageRecord(record);
    if (decoded.status !== 'decoded') return unavailable(`the wait message ${key} is damaged: ${decoded.reason}`);
    const row = readWaitRow(decoded.value);
    // A non-wait (or a Host-sent message, which has no sender Session) is not a
    // wait: the message is not a wait.
    if (row === null) return { status: 'not_found' };
    return { status: 'ready', value: row };
  }

  return { readSessionFacts, listSessionExecutions, listSessionQueries, findSessionSuccessors, readWait };
}
