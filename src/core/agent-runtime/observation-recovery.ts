/**
 * R4c.2a implementation: targeted raw execution history.
 *
 * This reader composes exactly one existing dependency, the authorized
 * `SessionOperationsPort.readSessionHistory`, and filters its raw page by the
 * Kernel execution identity. It never opens a Kernel store, copies the Session
 * transcript, reduces Run state or decides entry/recovery/terminal outcome.
 */
import { Buffer } from 'node:buffer';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { SessionRef } from '../../contracts/core/identity.js';
import type { CoreError, CoreRejection, Page, ReadResult } from '../../contracts/core/results.js';
import { sessionRecordSchema } from '../../../vendor/coding-agent/dist/public-api.js';
import type { SessionRecord as KernelSessionRecord } from '../../../vendor/coding-agent/dist/public-api.js';
import type { SessionHistoryEntry, SessionHistoryRange } from './session-operations.js';
import type {
  ExecutionHistoryDependencies,
  ExecutionHistoryPage,
  ExecutionHistoryPort,
  ExecutionHistoryRequest,
  KernelExecutionIdentity,
} from './execution-history-contracts.js';

/** One raw owner page is 1..200 lines; this reader never loops to fill matches. */
const MAX_EXECUTION_HISTORY_LIMIT = 200;
/** Private, opaque continuation format for this reader; the inner cursor is untouched. */
const EXECUTION_HISTORY_CURSOR_PREFIX = 'exechist1.';

type OwnedRequest = {
  sessionRef: SessionRef;
  executionIdentity: KernelExecutionIdentity;
  afterCursor: string | null;
  throughCursor: string | null;
  limit: number;
  /** The frozen original-history interval, or null for an unbounded read. */
  range: SessionHistoryRange | null;
};

type ExecutionHistoryCursor = {
  sessionRef: { projectId: string; sessionId: string };
  executionIdentity: KernelExecutionIdentity;
  /** The frozen range this continuation belongs to; never changed by a later page. */
  range: SessionHistoryRange | null;
  /** The owner's untouched page.nextCursor; never an individual entry cursor. */
  after: string;
};

function rejected(code: CoreError, reason: string): CoreRejection {
  return { status: 'rejected', code, reason };
}

function signalAborted(signal: unknown): boolean {
  return signal instanceof AbortSignal && signal.aborted;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isSessionRef(value: unknown): value is SessionRef {
  if (typeof value !== 'object' || value === null) return false;
  const ref = value as Record<string, unknown>;
  return isNonEmptyString(ref['projectId']) && isNonEmptyString(ref['sessionId']);
}

function isExecutionIdentity(value: unknown): value is KernelExecutionIdentity {
  if (typeof value !== 'object' || value === null) return false;
  const identity = value as Record<string, unknown>;
  return isNonEmptyString(identity['runId']) && isNonEmptyString(identity['turnId']);
}

function isHistoryRange(value: unknown): value is SessionHistoryRange {
  if (typeof value !== 'object' || value === null) return false;
  const range = value as Record<string, unknown>;
  const start = range['startPosition'];
  const through = range['throughPosition'];
  return isNonEmptyString(range['adapterId']) && isNonEmptyString(range['kernelSessionId'])
    && Number.isSafeInteger(start) && (start as number) >= 1
    && Number.isSafeInteger(through) && (through as number) >= 1
    && (start as number) <= (through as number);
}

/** A continuation may not move to a different frozen range. */
function sameRange(left: SessionHistoryRange | null, right: SessionHistoryRange | null): boolean {
  if (left === null || right === null) return left === right;
  return left.adapterId === right.adapterId
    && left.kernelSessionId === right.kernelSessionId
    && left.startPosition === right.startPosition
    && left.throughPosition === right.throughPosition;
}

/** Own the trusted request before the first await; caller mutation must not retarget it. */
function ownRequest(request: ExecutionHistoryRequest): OwnedRequest | null {
  try {
    const owned = structuredClone(request);
    const range = owned.range ?? null;
    if (range !== null && !isHistoryRange(range)) return null;
    return {
      sessionRef: owned.sessionRef,
      executionIdentity: owned.executionIdentity,
      afterCursor: owned.afterCursor ?? null,
      throughCursor: owned.throughCursor ?? null,
      limit: owned.limit,
      range,
    };
  } catch {
    return null;
  }
}

/** Own the call context before the first await while preserving the original signal. */
function ownContext(ctx: CoreCallContext): CoreCallContext | null {
  try {
    return {
      projectId: ctx.projectId,
      principal: structuredClone(ctx.principal),
      materialReader: structuredClone(ctx.materialReader),
      signal: ctx.signal,
      ...(typeof ctx.workspaceId === 'string' ? { workspaceId: ctx.workspaceId } : {}),
    };
  } catch {
    return null;
  }
}

function encodeExecutionHistoryCursor(cursor: ExecutionHistoryCursor): string {
  const body = JSON.stringify({
    v: 1,
    s: { p: cursor.sessionRef.projectId, i: cursor.sessionRef.sessionId },
    e: { r: cursor.executionIdentity.runId, t: cursor.executionIdentity.turnId },
    g: cursor.range,
    c: cursor.after,
  });
  return EXECUTION_HISTORY_CURSOR_PREFIX + Buffer.from(body, 'utf8').toString('base64url');
}

function decodeExecutionHistoryCursor(raw: string): ExecutionHistoryCursor | null {
  if (typeof raw !== 'string' || !raw.startsWith(EXECUTION_HISTORY_CURSOR_PREFIX)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw.slice(EXECUTION_HISTORY_CURSOR_PREFIX.length), 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const value = parsed as Record<string, unknown>;
  if (value['v'] !== 1) return null;
  const session = value['s'];
  const identity = value['e'];
  const rawRange = value['g'];
  const after = value['c'];
  if (typeof session !== 'object' || session === null || Array.isArray(session)) return null;
  if (typeof identity !== 'object' || identity === null || Array.isArray(identity)) return null;
  const sessionFields = session as Record<string, unknown>;
  const identityFields = identity as Record<string, unknown>;
  if (!isNonEmptyString(sessionFields['p']) || !isNonEmptyString(sessionFields['i'])) return null;
  if (!isNonEmptyString(identityFields['r']) || !isNonEmptyString(identityFields['t'])) return null;
  if (!isNonEmptyString(after)) return null;
  let range: SessionHistoryRange | null = null;
  if (rawRange !== undefined && rawRange !== null) {
    if (!isHistoryRange(rawRange)) return null;
    range = {
      adapterId: rawRange.adapterId,
      kernelSessionId: rawRange.kernelSessionId,
      startPosition: rawRange.startPosition,
      throughPosition: rawRange.throughPosition,
    };
  }
  return {
    sessionRef: { projectId: sessionFields['p'], sessionId: sessionFields['i'] },
    executionIdentity: { runId: identityFields['r'], turnId: identityFields['t'] },
    range,
    after,
  };
}

function kernelKind(record: KernelSessionRecord): SessionHistoryEntry['kind'] {
  return record.recordType === 'session.created' ? 'session_created'
    : record.recordType === 'turn.started' ? 'turn_started' : 'agent_event';
}

type EntryInspection =
  | { ok: true; matches: boolean }
  | { ok: false; code: 'unsupported' | 'unavailable'; reason: string };

/** Validate the frozen Kernel body and its envelope before any identity match;
 * damaged or unreachable evidence is never filtered away as a silent empty page. */
function inspectEntry(entry: SessionHistoryEntry, identity: KernelExecutionIdentity): EntryInspection {
  if (typeof entry !== 'object' || entry === null) {
    return { ok: false, code: 'unavailable', reason: 'the raw history page contains a missing entry' };
  }
  // Only a well-formed external ArtifactRef body is a capability this reader does
  // not fetch; a recognised inline body that is damaged below is corruption.
  const rawBody: unknown = entry.body;
  if (typeof rawBody !== 'object' || rawBody === null) {
    return { ok: false, code: 'unavailable', reason: 'the raw entry has no decodable body' };
  }
  const body = rawBody as Record<string, unknown>;
  if (body['kind'] === 'artifact') {
    return { ok: false, code: 'unsupported', reason: 'the entry body is an external ArtifactRef this reader cannot decode' };
  }
  const text = body['text'];
  if (body['encoding'] !== 'kernel_session_record_json' || typeof text !== 'string') {
    return { ok: false, code: 'unavailable', reason: 'the entry body is not a valid inline kernel_session_record_json body' };
  }
  const rawSource: unknown = entry.source;
  if (typeof rawSource !== 'object' || rawSource === null) {
    return { ok: false, code: 'unavailable', reason: 'the entry envelope is incomplete' };
  }
  const source = rawSource as Record<string, unknown>;
  const kernelSessionId = source['kernelSessionId'];
  const position = source['position'];
  if (!isNonEmptyString(entry.recordId) || !isNonEmptyString(kernelSessionId) || typeof position !== 'number') {
    return { ok: false, code: 'unavailable', reason: 'the entry envelope is incomplete' };
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    return { ok: false, code: 'unavailable', reason: 'the inline Kernel record body is not valid JSON' };
  }
  let record: KernelSessionRecord;
  try {
    record = sessionRecordSchema.parse(decoded);
  } catch {
    return { ok: false, code: 'unavailable', reason: 'the inline Kernel record does not satisfy sessionRecordSchema' };
  }
  if (record.recordId !== entry.recordId
    || record.position !== position
    || record.sessionId !== kernelSessionId
    || kernelKind(record) !== entry.kind) {
    return { ok: false, code: 'unavailable', reason: 'the Kernel record disagrees with its history envelope' };
  }
  if (record.recordType === 'session.created') return { ok: true, matches: false };
  if (record.recordType === 'turn.started') {
    return { ok: true,
      matches: record.payload.run.runId === identity.runId && record.payload.run.turn.turnId === identity.turnId };
  }
  return { ok: true,
    matches: record.payload.event.meta.runId === identity.runId && record.payload.event.meta.turnId === identity.turnId };
}

export function createExecutionHistoryReader(deps: ExecutionHistoryDependencies): ExecutionHistoryPort {
  const { history } = deps;
  return {
    async readExecutionHistory(ctx, request) {
      const ownedCtx = ownContext(ctx);
      const owned = ownRequest(request);
      if (ownedCtx === null || owned === null) {
        return rejected('invalid', 'the execution history request or call context cannot be isolated from the caller');
      }
      const signal = ownedCtx.signal;
      if (signalAborted(signal)) {
        return rejected('cancelled', 'the execution history read was cancelled before delegation');
      }
      const { sessionRef, executionIdentity, afterCursor, throughCursor, limit, range } = owned;
      if (!isSessionRef(sessionRef) || !isExecutionIdentity(executionIdentity)) {
        return rejected('invalid', 'targeted execution history requires a Session reference and a runId/turnId identity');
      }
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_EXECUTION_HISTORY_LIMIT) {
        return rejected('invalid', `execution history limit must be an integer between 1 and ${String(MAX_EXECUTION_HISTORY_LIMIT)}`);
      }

      let bottomAfterCursor: string | null = null;
      if (afterCursor !== null) {
        const decoded = decodeExecutionHistoryCursor(afterCursor);
        if (decoded === null
          || decoded.sessionRef.projectId !== sessionRef.projectId
          || decoded.sessionRef.sessionId !== sessionRef.sessionId
          || decoded.executionIdentity.runId !== executionIdentity.runId
          || decoded.executionIdentity.turnId !== executionIdentity.turnId) {
          return rejected('invalid', 'afterCursor is not a continuation cursor for this Session and execution identity');
        }
        if (!sameRange(decoded.range, range)) {
          return rejected('invalid', 'afterCursor is not a continuation cursor for this frozen history range');
        }
        bottomAfterCursor = decoded.after;
      }

      let result: ReadResult<Page<SessionHistoryEntry>>;
      try {
        // Exactly one delegation: the owner validates authorization, mapping, the
        // original Session header and the raw upper bound. executionIdentity is a
        // filter and is deliberately never sent to the owner.
        result = await history.readSessionHistory(ownedCtx, {
          sessionRef, afterCursor: bottomAfterCursor, throughCursor, limit,
          ...(range === null ? {} : { range }),
        });
      } catch (error) {
        if (signalAborted(signal)) {
          return rejected('cancelled', 'the execution history read was cancelled while awaiting the owner');
        }
        const message = error instanceof Error ? error.message : String(error);
        return rejected('unavailable', `the Session history owner could not read the raw page: ${message}`);
      }
      if (signalAborted(signal)) {
        return rejected('cancelled', 'the execution history read was cancelled while awaiting the owner');
      }
      if (result.status !== 'ready') return result;

      const rawItems = result.value.items;
      if (!Array.isArray(rawItems)) {
        return rejected('unavailable', 'the Session history owner returned a page without a raw item list');
      }
      const items: SessionHistoryEntry[] = [];
      for (const entry of rawItems) {
        const inspected = inspectEntry(entry, executionIdentity);
        if (!inspected.ok) return rejected(inspected.code, inspected.reason);
        if (inspected.matches) items.push(entry);
      }

      const bottomNextCursor = result.value.nextCursor;
      return {
        status: 'ready',
        value: {
          items,
          nextCursor: bottomNextCursor === null ? null : encodeExecutionHistoryCursor({
            sessionRef: { projectId: sessionRef.projectId, sessionId: sessionRef.sessionId },
            executionIdentity: { runId: executionIdentity.runId, turnId: executionIdentity.turnId },
            range,
            after: bottomNextCursor,
          }),
          basis: result.value.basis,
          executionIdentity: { runId: executionIdentity.runId, turnId: executionIdentity.turnId },
          scannedCount: rawItems.length,
        },
      };
    },
  };
}
