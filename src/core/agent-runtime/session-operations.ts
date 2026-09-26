import { Buffer } from 'node:buffer';
import { stat } from 'node:fs/promises';
import type { ArtifactRef } from '../../contracts/artifact.js';
import type { CommitCursor } from '../../contracts/command-event.js';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { CommandMeta, RoleConfigurationRef, SessionRef, WorkspaceScope, WorkLinkRelation, WorkLinkTarget } from '../../contracts/core/identity.js';
import type { CoreError, CoreRejection, OperationReceipt, Page, ReadResult, WriteResult } from '../../contracts/core/results.js';
import type { SessionRecord } from '../../contracts/core/session.js';
import { canonicalJson, type JsonValue } from '../../contracts/fingerprint.js';
import type { SessionCard, SessionCreationResult, SessionDirectoryPort, SessionOperationRecord } from '../work-graph/sessions/contracts.js';
import type { KernelStoreRegistry } from './kernel-store-locator.js';
import { StoreError, sessionRecordSchema } from '../../../vendor/coding-agent/dist/public-api.js';
import type {
  SessionRecord as KernelSessionRecord,
  SessionStorePort,
  SqliteStores,
} from '../../../vendor/coding-agent/dist/public-api.js';

export type CreateSessionRequest = {
  workspace: WorkspaceScope;
  role: RoleConfigurationRef;
  recommendedRefs: ArtifactRef[];
  initialLinks: { target: WorkLinkTarget; relation: WorkLinkRelation }[];
  meta: CommandMeta;
};
/** Trusted locator from the task graph; positions are inclusive. */
export type SessionHistoryRange = {
  adapterId: string;
  kernelSessionId: string;
  startPosition: number;
  throughPosition: number;
};
export type SessionHistoryRequest = {
  sessionRef: SessionRef;
  afterCursor: string | null;
  throughCursor: string | null;
  limit: number;
  range?: SessionHistoryRange;
};
export type SessionHistoryEntry = {
  recordId: string; cursor: string; recordedAt: string;
  kind: 'session_created' | 'turn_started' | 'agent_event';
  source: { adapterId: string; kernelSessionId: string; position: number };
  body: ArtifactRef | { encoding: 'kernel_session_record_json'; text: string };
};
export interface SessionOperationsPort {
  createSession(ctx: CoreCallContext, request: CreateSessionRequest): Promise<OperationReceipt<SessionRecord>>;
  readSessionHistory(ctx: CoreCallContext, request: SessionHistoryRequest): Promise<ReadResult<Page<SessionHistoryEntry>>>;
}

/** Concrete Kernel read surface: the frozen `SqliteStores.read` is the only
 * reader that also returns the snapshot `lastPosition`, which freezes a page's
 * upper bound without a whole-session pre-read. No new SQL or Store API. */
type KernelSessionReader = Pick<SqliteStores, 'get' | 'read'>;
type KernelSessionPage = Awaited<ReturnType<KernelSessionReader['read']>>;
type KernelSessionHeader = Awaited<ReturnType<SessionStorePort['get']>>;

/** Public bound for one raw history page. */
const MAX_HISTORY_LIMIT = 200;

/** A reopened Session operation whose registration outcome cannot be proven stays
 * accepted; only these codes are permanent domain rejections that must not be
 * softened into a retryable "accepted" receipt. */
const PERMANENT_REJECTIONS = new Set<CoreError>([
  'invalid', 'forbidden', 'not_found', 'idempotency_conflict', 'revision_conflict',
  'dependency_blocked', 'source_stale', 'incomplete',
]);

const CORE_ERRORS = new Set<string>([
  'invalid', 'forbidden', 'revision_conflict', 'idempotency_conflict', 'not_found',
  'dependency_blocked', 'cycle', 'busy', 'source_stale', 'incomplete', 'capacity',
  'unsupported', 'unavailable', 'cancelled',
]);

const HISTORY_CURSOR_PREFIX = 'kernhist1.';

/** The platform Session identity, never the Kernel Session identity: a legacy
 * mapping may use a different Kernel Session id for the same platform Session. */
type PlatformSessionRef = { projectId: string; sessionId: string };

type HistoryBinding = {
  platformRef: PlatformSessionRef;
  adapterId: string;
  kernelSessionId: string;
  principal: string;
};

/** `lower` is the inclusive first position of the page's frozen range; a legacy
 * cursor without it is accepted only for a head read (`lower === 1`). */
type HistoryCursor = HistoryBinding & { upper: number; position: number; lower: number | null };

type CreateSessionValue = {
  workspace: WorkspaceScope;
  role: RoleConfigurationRef;
  recommendedRefs: ArtifactRef[];
  initialLinks: { target: WorkLinkTarget; relation: WorkLinkRelation }[];
  meta: CommandMeta;
};

type HistoryRequestValue = {
  sessionRef: SessionRef;
  afterCursor: string | null;
  throughCursor: string | null;
  limit: number;
  range?: SessionHistoryRange;
};

function rejected(code: CoreError, reason: string): CoreRejection {
  return { status: 'rejected', code, reason };
}

function signalAborted(signal: unknown): boolean {
  return signal instanceof AbortSignal && signal.aborted;
}

/** The trusted request value is isolated before the first await so a caller can
 * never mutate what was already admitted or what watermark a page is bound to.
 * The AbortSignal lives on the call context and is deliberately not cloned. */
function ownCreateRequest(request: unknown): { ok: true; value: CreateSessionValue } | { ok: false; reason: string } {
  const raw = (typeof request === 'object' && request !== null ? request : {}) as Partial<CreateSessionValue>;
  const snapshot = {
    workspace: raw.workspace,
    role: raw.role,
    recommendedRefs: raw.recommendedRefs,
    initialLinks: raw.initialLinks,
    meta: raw.meta,
  };
  try {
    return { ok: true, value: structuredClone(snapshot) as CreateSessionValue };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `the Session creation request cannot be isolated from the caller: ${detail}` };
  }
}

function ownHistoryRequest(request: unknown): { ok: true; value: HistoryRequestValue } | { ok: false; reason: string } {
  const raw = (typeof request === 'object' && request !== null ? request : {}) as Partial<HistoryRequestValue>;
  const snapshot = {
    sessionRef: raw.sessionRef,
    afterCursor: raw.afterCursor ?? null,
    throughCursor: raw.throughCursor ?? null,
    limit: raw.limit,
    range: raw.range,
  };
  try {
    return { ok: true, value: structuredClone(snapshot) as HistoryRequestValue };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `the Session history request cannot be isolated from the caller: ${detail}` };
  }
}

function principalBinding(principal: unknown): string | null {
  try {
    return canonicalJson(principal as JsonValue);
  } catch {
    return null;
  }
}

function encodeHistoryCursor(cursor: HistoryCursor): string {
  const body = JSON.stringify({
    v: 1,
    p: { projectId: cursor.platformRef.projectId, sessionId: cursor.platformRef.sessionId },
    a: cursor.adapterId,
    k: cursor.kernelSessionId,
    r: cursor.principal,
    u: cursor.upper,
    l: cursor.lower,
    i: cursor.position,
  });
  return HISTORY_CURSOR_PREFIX + Buffer.from(body, 'utf8').toString('base64url');
}

function decodeHistoryCursor(raw: string): HistoryCursor | null {
  if (typeof raw !== 'string' || !raw.startsWith(HISTORY_CURSOR_PREFIX)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw.slice(HISTORY_CURSOR_PREFIX.length), 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const value = parsed as Record<string, unknown>;
  if (value['v'] !== 1) return null;
  const platform = value['p'];
  if (typeof platform !== 'object' || platform === null || Array.isArray(platform)) return null;
  const platformRef = platform as Record<string, unknown>;
  const projectId = platformRef['projectId'];
  const sessionId = platformRef['sessionId'];
  const adapterId = value['a'];
  const kernelSessionId = value['k'];
  const principal = value['r'];
  const upper = value['u'];
  const lower = value['l'];
  const position = value['i'];
  if (typeof projectId !== 'string' || projectId.length === 0) return null;
  if (typeof sessionId !== 'string' || sessionId.length === 0) return null;
  if (typeof adapterId !== 'string' || adapterId.length === 0) return null;
  if (typeof kernelSessionId !== 'string' || kernelSessionId.length === 0) return null;
  if (typeof principal !== 'string' || principal.length === 0) return null;
  if (!Number.isSafeInteger(upper) || (upper as number) < 0) return null;
  if (!Number.isSafeInteger(position) || (position as number) < 0) return null;
  if (lower !== undefined && lower !== null && (!Number.isSafeInteger(lower) || (lower as number) < 1)) return null;
  return {
    platformRef: { projectId, sessionId },
    adapterId,
    kernelSessionId,
    principal,
    upper: upper as number,
    lower: lower === undefined || lower === null ? null : lower as number,
    position: position as number,
  };
}

function cursorMatches(cursor: HistoryCursor, binding: HistoryBinding): boolean {
  return cursor.platformRef.projectId === binding.platformRef.projectId
    && cursor.platformRef.sessionId === binding.platformRef.sessionId
    && cursor.adapterId === binding.adapterId
    && cursor.kernelSessionId === binding.kernelSessionId
    && cursor.principal === binding.principal;
}

function isAlreadyCreatedError(error: unknown): boolean {
  return error instanceof StoreError
    && (error.code === 'already_exists' || error.code === 'idempotency_conflict');
}

function isOriginalSessionCreated(record: KernelSessionRecord, kernelSessionId: string): boolean {
  return record.recordType === 'session.created'
    && record.position === 1
    && record.sessionId === kernelSessionId
    && record.payload.sessionId === kernelSessionId;
}

/** Distinguishes a genuinely absent database from an unreadable one: only ENOENT
 * is not_found, every other stat failure must fail closed as unavailable. */
async function kernelDatabaseState(databasePath: string): Promise<'present' | 'missing'> {
  try {
    return (await stat(databasePath)).isFile() ? 'present' : 'missing';
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw error;
  }
}

/** The Kernel create inputs must be recoverable from the durable operation alone;
 * if any retry re-derives a different identity the original Session is never
 * reconstructed and the call must fail closed instead of creating a replacement. */
function kernelSessionIdentity(operation: SessionOperationRecord): {
  sessionRef: SessionRef;
  kernelSessionId: string;
  recordId: string;
  createdAt: string;
} | null {
  if (operation.action.kind !== 'create') return null;
  const sessionRef = operation.action.plannedSessionRef;
  if (!sessionRef || typeof sessionRef.projectId !== 'string' || typeof sessionRef.sessionId !== 'string'
    || sessionRef.sessionId.length === 0 || operation.ref.projectId !== sessionRef.projectId) return null;
  if (typeof operation.requestedAt !== 'string' || operation.requestedAt.length === 0) return null;
  return {
    sessionRef,
    kernelSessionId: sessionRef.sessionId,
    recordId: `kernel:session.created:${operation.ref.projectId}:${operation.ref.operationId}`,
    createdAt: operation.requestedAt,
  };
}

async function assertOriginalSessionCreated(
  store: KernelSessionReader,
  header: KernelSessionHeader,
  expected: { sessionId: string; recordId: string; createdAt: string; signal: AbortSignal },
): Promise<void> {
  if (header.sessionId !== expected.sessionId) {
    throw new StoreError('corrupt', 'Kernel header does not describe the planned Session');
  }
  if (header.createdAt !== expected.createdAt) {
    throw new StoreError('corrupt', 'Kernel header createdAt does not match the durable operation');
  }
  const page = await store.read(expected.sessionId, 0, 1, { signal: expected.signal });
  const raw = page.records[0];
  if (!raw) throw new StoreError('corrupt', 'Kernel Session has no position-1 history record');
  let parsed: KernelSessionRecord;
  try {
    parsed = sessionRecordSchema.parse(raw);
  } catch {
    throw new StoreError('corrupt', 'Kernel position-1 record is not a valid session record');
  }
  if (!isOriginalSessionCreated(parsed, expected.sessionId)) {
    throw new StoreError('corrupt', 'Kernel position-1 record is not the planned session.created identity');
  }
  if (parsed.recordType !== 'session.created' || parsed.recordId !== expected.recordId
    || parsed.payload.createdAt !== expected.createdAt) {
    throw new StoreError('corrupt', 'Kernel position-1 record does not match the durable create inputs');
  }
}

/** Every page re-proves that the original position-1 session.created still
 * exists for the mapped Kernel Session: deleting or replacing it must fail
 * instead of returning a seemingly valid later page. */
async function assertOriginalKernelSession(
  reader: KernelSessionReader,
  kernelSessionId: string,
  signal: AbortSignal,
): Promise<void> {
  const page = await reader.read(kernelSessionId, 0, 1, { signal });
  const raw = page.records[0];
  if (!raw) throw new StoreError('not_found', 'the mapped Kernel Session has no position-1 history record');
  let parsed: KernelSessionRecord;
  try {
    parsed = sessionRecordSchema.parse(raw);
  } catch {
    throw new StoreError('corrupt', 'the mapped Kernel position-1 record is damaged');
  }
  if (!isOriginalSessionCreated(parsed, kernelSessionId)) {
    throw new StoreError('corrupt', 'the mapped Kernel position-1 record is not the original session.created');
  }
}

function mapKernelFailure(error: unknown, signal: unknown): CoreRejection {
  if (signalAborted(signal)) return rejected('cancelled', 'Kernel Session creation was cancelled');
  if (error instanceof StoreError && error.code === 'cancelled') return rejected('cancelled', error.message);
  if (error instanceof StoreError && error.code === 'not_found') {
    return rejected('unavailable', 'Kernel Session disappeared after a reported create');
  }
  const message = error instanceof Error ? error.message : String(error);
  return rejected('unavailable', `Kernel Session creation could not be proven: ${message}`);
}

function mapHistoryFailure(error: unknown, signal: unknown): CoreRejection {
  if (signalAborted(signal)) return rejected('cancelled', 'the Kernel history read was cancelled');
  if (error instanceof StoreError) {
    if (error.code === 'cancelled') return rejected('cancelled', error.message);
    if (error.code === 'not_found') return rejected('not_found', 'the mapped Kernel Session history is missing');
    return rejected('unavailable', `the mapped Kernel Session history is damaged or unavailable: ${error.message}`);
  }
  const message = error instanceof Error ? error.message : String(error);
  return rejected('unavailable', `the mapped Kernel Session history could not be read: ${message}`);
}

function toHistoryEntry(
  record: KernelSessionRecord,
  binding: HistoryBinding,
  upper: number,
  lower: number,
): SessionHistoryEntry {
  const validated = sessionRecordSchema.parse(record);
  const kind = validated.recordType === 'session.created' ? 'session_created'
    : validated.recordType === 'turn.started' ? 'turn_started' : 'agent_event';
  return {
    recordId: validated.recordId,
    cursor: encodeHistoryCursor({ ...binding, upper, lower, position: validated.position }),
    recordedAt: validated.recordedAt,
    kind,
    source: { adapterId: binding.adapterId, kernelSessionId: binding.kernelSessionId, position: validated.position },
    body: { encoding: 'kernel_session_record_json', text: JSON.stringify(validated) },
  };
}

/** The position-1 `session.created` is the constant per-page identity check.
 * It never re-reads a whole page: a head page already carries the record and a
 * later start costs exactly one bounded one-record read. */
function verifyOriginalPositionOne(raw: unknown, kernelSessionId: string): void {
  let parsed: KernelSessionRecord;
  try {
    parsed = sessionRecordSchema.parse(raw);
  } catch {
    throw new StoreError('corrupt', 'the mapped Kernel position-1 record is damaged');
  }
  if (!isOriginalSessionCreated(parsed, kernelSessionId)) {
    throw new StoreError('corrupt', 'the mapped Kernel position-1 record is not the original session.created');
  }
}

async function readBoundedHistory(
  reader: KernelSessionReader,
  input: {
    binding: HistoryBinding;
    limit: number; afterCursor: string | null; throughCursor: string | null;
    range: SessionHistoryRange | undefined;
    signal: AbortSignal;
  },
): Promise<ReadResult<Page<SessionHistoryEntry>>> {
  const { binding, range } = input;

  // `range` and `throughCursor` pin the same boundary; they may not be combined.
  if (range !== undefined && input.throughCursor !== null) {
    return rejected('invalid', 'range and throughCursor cannot both pin the history boundary');
  }
  if (range !== undefined
    && (range.adapterId !== binding.adapterId || range.kernelSessionId !== binding.kernelSessionId)) {
    return rejected('invalid', 'the history range does not match the mapped Kernel Session mapping');
  }

  // A legacy throughCursor freezes an upper bound but never carries a lower.
  let throughUpper: number | null = null;
  if (input.throughCursor !== null) {
    const through = decodeHistoryCursor(input.throughCursor);
    if (!through || !cursorMatches(through, binding)) {
      return rejected('invalid', 'throughCursor is not a valid cursor for this Session mapping');
    }
    throughUpper = through.position;
  }

  let lower: number;
  let from: number;
  let frozenUpper: number | null = range === undefined ? throughUpper : range.throughPosition;

  if (input.afterCursor === null) {
    // First page: an explicit range starts at its first position; a head read
    // starts at position 1 and (when unbounded) discovers its upper from the
    // single bounded read's `lastPosition`.
    lower = range === undefined ? 1 : range.startPosition;
    from = lower - 1;
  } else {
    const after = decodeHistoryCursor(input.afterCursor);
    if (!after || !cursorMatches(after, binding)) {
      return rejected('invalid', 'afterCursor is not a valid cursor for this Session mapping');
    }
    const cursorLower = after.lower ?? 1;
    if (range === undefined) {
      // A legacy head cursor has no lower; a ranged cursor must keep its range.
      if (cursorLower !== 1) return rejected('invalid', 'a ranged cursor requires the same explicit range');
    } else if (range.startPosition !== cursorLower
      || range.throughPosition !== after.upper
      || range.adapterId !== after.adapterId
      || range.kernelSessionId !== after.kernelSessionId) {
      return rejected('invalid', 'the history range disagrees with the started page');
    }
    if (throughUpper !== null && throughUpper !== after.upper) {
      return rejected('invalid', 'throughCursor contradicts the upper bound frozen by the started page');
    }
    lower = cursorLower;
    from = after.position;
    // The cursor must stay inside its own frozen range: lower - 1 <= position <= upper.
    // Exactly `position === upper` is the legal empty terminal page of the old API.
    if (from < lower - 1 || from > after.upper) {
      return rejected('invalid', 'the continuation position is outside the frozen history range');
    }
    frozenUpper = after.upper;
  }

  let page: KernelSessionPage;
  if (from === 0) {
    const firstLimit = frozenUpper === null ? input.limit : Math.min(input.limit, frozenUpper - from);
    page = await reader.read(binding.kernelSessionId, 0, firstLimit, { signal: input.signal });
    if (page.records.length === 0) {
      throw new StoreError('not_found', 'the mapped Kernel Session has no original session.created history');
    }
    verifyOriginalPositionOne(page.records[0], binding.kernelSessionId);
  } else if (frozenUpper !== null && from === frozenUpper) {
    // position === upper is the legal empty terminal page. It still proves the
    // original session.created AND the live tail through the SAME bounded
    // one-record head read, so a truncated source fails instead of returning a
    // seemingly valid empty page. The Kernel is never called with limit 0.
    const head = await reader.read(binding.kernelSessionId, 0, 1, { signal: input.signal });
    if (head.records.length === 0) {
      throw new StoreError('not_found', 'the mapped Kernel Session has no original session.created history');
    }
    verifyOriginalPositionOne(head.records[0], binding.kernelSessionId);
    if (head.lastPosition < frozenUpper) {
      return rejected('unavailable', 'the mapped Kernel Session no longer reaches the frozen history upper bound');
    }
    return {
      status: 'ready',
      value: {
        items: [],
        nextCursor: null,
        basis: {
          kind: 'session',
          ref: { projectId: binding.platformRef.projectId, sessionId: binding.platformRef.sessionId },
          cursor: encodeHistoryCursor({ ...binding, upper: frozenUpper, lower, position: frozenUpper }),
        },
      },
    };
  } else {
    await assertOriginalKernelSession(reader, binding.kernelSessionId, input.signal);
    const pageLimit = frozenUpper === null ? input.limit : Math.min(input.limit, frozenUpper - from);
    page = await reader.read(binding.kernelSessionId, from, pageLimit, { signal: input.signal });
  }
  const upper = frozenUpper ?? page.lastPosition;

  // The live source must still reach the frozen upper bound: a shortened tail is
  // an unavailable history, never silently shrunk with Math.min.
  if (frozenUpper !== null && page.lastPosition < upper) {
    return rejected('unavailable', 'the mapped Kernel Session no longer reaches the frozen history upper bound');
  }

  const withinBound = page.records.filter(record => record.position <= upper);
  const lastReturned = withinBound.at(-1)?.position ?? from;
  const nextCursor = lastReturned < upper
    ? encodeHistoryCursor({ ...binding, upper, lower, position: lastReturned })
    : null;
  return {
    status: 'ready',
    value: {
      items: withinBound.map(record => toHistoryEntry(record, binding, upper, lower)),
      nextCursor,
      basis: {
        kind: 'session',
        ref: { projectId: binding.platformRef.projectId, sessionId: binding.platformRef.sessionId },
        cursor: encodeHistoryCursor({ ...binding, upper, lower, position: lastReturned }),
      },
    },
  };
}

/**
 * R4b Session bridge. Persists admission first, then drives the trusted Kernel
 * registry with the identity fixed by that durable operation, verifies the header
 * and the original position-1 `session.created`, and only then registers the
 * mapping through WorkGraph. It never creates a Run/QueryRun and never calls a
 * model. When the WorkGraph provider cannot persist the mapping the receipt stays
 * `accepted` and the same operation can be replayed.
 */
export function createSessionOperations(deps: {
  sessions: SessionDirectoryPort;
  kernelStores: KernelStoreRegistry;
}): SessionOperationsPort {
  const { sessions, kernelStores } = deps;

  async function register(
    ctx: CoreCallContext,
    signal: AbortSignal,
    meta: CommandMeta,
    admission: { cursor: CommitCursor; replayed: boolean },
    input: SessionCreationResult,
  ): Promise<OperationReceipt<SessionRecord>> {
    if (signalAborted(signal)) return rejected('cancelled', 'the call was cancelled before the Session mapping was registered');
    let written: WriteResult<SessionRecord>;
    try {
      written = await sessions.recordSessionCreated(ctx, { input, meta });
    } catch {
      // A thrown registration (including a lost response) may already be durable;
      // keep the durable operation recoverable instead of inventing a result.
      return { status: 'accepted', operationRef: input.operationRef, replayed: admission.replayed, cursor: admission.cursor };
    }
    if (written.status === 'committed') {
      return {
        status: 'completed', operationRef: input.operationRef, value: written.value,
        replayed: written.replayed, cursor: written.cursor,
      };
    }
    if (PERMANENT_REJECTIONS.has(written.code)) return written;
    return { status: 'accepted', operationRef: input.operationRef, replayed: admission.replayed, cursor: admission.cursor };
  }

  return {
    async createSession(ctx, request) {
      const owned = ownCreateRequest(request);
      if (!owned.ok) return rejected('invalid', owned.reason);
      const value = owned.value;
      const signal = ctx?.signal;
      const ctxProjectId = ctx?.projectId;
      const ctxWorkspaceId = ctx?.workspaceId;
      if (signalAborted(signal)) return rejected('cancelled', 'the call was cancelled before Session admission');
      const workspace = value.workspace;
      if (typeof ctxProjectId !== 'string' || ctxProjectId.length === 0
        || typeof ctxWorkspaceId !== 'string' || ctxWorkspaceId.length === 0) {
        return rejected('forbidden', 'Session creation requires a bound project/workspace call context');
      }
      if (!workspace || typeof workspace.projectId !== 'string' || workspace.projectId.length === 0
        || typeof workspace.workspaceId !== 'string' || workspace.workspaceId.length === 0) {
        return rejected('invalid', 'Session creation requires a {projectId,workspaceId} workspace');
      }
      if (workspace.projectId !== ctxProjectId) {
        return rejected('forbidden', 'the requested workspace project is outside the call scope');
      }
      if (workspace.workspaceId !== ctxWorkspaceId) {
        return rejected('forbidden', 'the requested workspace is outside the call scope');
      }
      // The trusted Host route is chosen once, before admission, and becomes the
      // durable pin. A later default change must never move the operation to a
      // different Kernel store instance.
      const defaultLocation = kernelStores.forWorkspace(workspace);
      if (!defaultLocation) {
        return rejected('unsupported', 'no trusted current Kernel store is registered for the operation workspace');
      }
      const pin = { adapterId: defaultLocation.adapterId, storeKey: defaultLocation.storeKey };

      let admitted: WriteResult<SessionOperationRecord>;
      try {
        admitted = await sessions.admitSessionCreation(ctx, {
          input: {
            workspace,
            kernelStore: pin,
            role: value.role,
            recommendedRefs: value.recommendedRefs ?? [],
            initialLinks: value.initialLinks ?? [],
          },
          meta: value.meta,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return rejected('unavailable', `Session admission did not complete: ${message}`);
      }
      if (admitted.status !== 'committed') return admitted;

      const operation = admitted.value;
      const persistedWorkspace = operation.action.workspace;
      if (operation.action.kind !== 'create'
        || !persistedWorkspace || typeof persistedWorkspace.projectId !== 'string'
        || typeof persistedWorkspace.workspaceId !== 'string'
        || !operation.action.plannedSessionRef) {
        return rejected('unavailable', 'the persisted Session creation operation is incomplete');
      }
      if (persistedWorkspace.projectId !== ctxProjectId || persistedWorkspace.workspaceId !== ctxWorkspaceId) {
        return rejected('forbidden', 'the persisted operation workspace is outside the call scope');
      }
      const identity = kernelSessionIdentity(operation);
      if (!identity) {
        return rejected('unavailable', 'the durable operation does not fix a usable Kernel Session identity');
      }
      // After admission the operation's own pin is the only allowed route: never
      // fall back to the current default and never open a new database for it.
      const pinned = operation.action.kernelStore;
      if (!pinned || typeof pinned.adapterId !== 'string' || pinned.adapterId.length === 0
        || typeof pinned.storeKey !== 'string' || pinned.storeKey.length === 0) {
        return rejected('unavailable', 'the persisted operation has no usable Kernel store pin');
      }
      const resolvedStore = kernelStores.byAdapterId(pinned.adapterId);
      if (!resolvedStore || 'expectedSessionId' in resolvedStore) {
        return rejected('unsupported', 'the pinned Kernel store instance is not registered as a current store');
      }
      if (resolvedStore.storeKey !== pinned.storeKey) {
        return rejected('unsupported', 'the registered Kernel store instance does not match the pinned store key');
      }
      if (resolvedStore.workspace.projectId !== persistedWorkspace.projectId
        || resolvedStore.workspace.workspaceId !== persistedWorkspace.workspaceId) {
        return rejected('unsupported', 'the pinned Kernel store instance belongs to another workspace');
      }
      if (signalAborted(signal)) return rejected('cancelled', 'the call was cancelled before the Kernel Session step');

      if (operation.phase === 'failed') {
        const failure = operation.failure;
        const code = failure && CORE_ERRORS.has(failure.code) ? failure.code as CoreError : 'unavailable';
        return rejected(code, failure?.reason ?? 'the Session creation operation previously failed');
      }

      if (operation.phase === 'completed') {
        const observation = operation.observation;
        if (!observation || typeof observation.adapterId !== 'string' || typeof observation.kernelSessionId !== 'string'
          || observation.adapterId !== pinned.adapterId
          || observation.kernelSessionId !== identity.kernelSessionId) {
          return rejected('unavailable', 'the completed operation has no trustworthy Kernel observation to restore');
        }
        return register(ctx, signal, value.meta, { cursor: admitted.cursor, replayed: admitted.replayed }, {
          operationRef: operation.ref,
          sessionRef: identity.sessionRef,
          adapterId: observation.adapterId,
          kernelSessionId: observation.kernelSessionId,
          historyCursor: null,
          observedAt: observation.observedAt,
        });
      }

      let observed: { adapterId: string; kernelSessionId: string; observedAt: string };
      try {
        observed = await kernelStores.withStore(resolvedStore.adapterId, async store => {
          let header: KernelSessionHeader;
          try {
            header = await store.create({
              sessionId: identity.kernelSessionId, recordId: identity.recordId, createdAt: identity.createdAt,
            }, { signal });
          } catch (error) {
            if (!isAlreadyCreatedError(error)) throw error;
            // A lost create response is recovered by reading the original identity,
            // never by creating a second Session or a replacement identity.
            header = await store.get(identity.kernelSessionId, { signal });
          }
          await assertOriginalSessionCreated(store, header, {
            sessionId: identity.kernelSessionId, recordId: identity.recordId,
            createdAt: identity.createdAt, signal,
          });
          return { adapterId: resolvedStore.adapterId, kernelSessionId: identity.kernelSessionId, observedAt: identity.createdAt };
        });
      } catch (error) {
        return mapKernelFailure(error, signal);
      }
      if (signalAborted(signal)) return rejected('cancelled', 'the call was cancelled before the Session mapping was registered');

      return register(ctx, signal, value.meta, { cursor: admitted.cursor, replayed: admitted.replayed }, {
        operationRef: operation.ref,
        sessionRef: identity.sessionRef,
        adapterId: observed.adapterId,
        kernelSessionId: observed.kernelSessionId,
        historyCursor: null,
        observedAt: observed.observedAt,
      });
    },

    async readSessionHistory(ctx, request) {
      const owned = ownHistoryRequest(request);
      if (!owned.ok) return rejected('invalid', owned.reason);
      const value = owned.value;
      const signal = ctx?.signal;
      const ctxProjectId = ctx?.projectId;
      const ctxWorkspaceId = ctx?.workspaceId;
      const principalKey = principalBinding(ctx?.principal);
      if (signalAborted(signal)) return rejected('cancelled', 'the call was cancelled before the history read');
      if (!Number.isSafeInteger(value.limit) || value.limit < 1 || value.limit > MAX_HISTORY_LIMIT) {
        return rejected('invalid', `history limit must be an integer between 1 and ${String(MAX_HISTORY_LIMIT)}`);
      }
      const sessionRef = value.sessionRef;
      if (!sessionRef || typeof sessionRef.projectId !== 'string' || typeof sessionRef.sessionId !== 'string'
        || sessionRef.sessionId.length === 0) {
        return rejected('invalid', 'a Session reference is required');
      }
      if (typeof ctxProjectId !== 'string' || sessionRef.projectId !== ctxProjectId) {
        return rejected('forbidden', 'the Session reference is outside the call project scope');
      }
      if (typeof ctxWorkspaceId !== 'string' || ctxWorkspaceId.length === 0) {
        return rejected('forbidden', 'reading Session history requires a workspace-scoped call context');
      }
      if (principalKey === null) {
        return rejected('unavailable', 'the trusted call principal cannot be bound to a history cursor');
      }
      if (value.afterCursor !== null && typeof value.afterCursor !== 'string') {
        return rejected('invalid', 'afterCursor must be a string or null');
      }
      if (value.throughCursor !== null && typeof value.throughCursor !== 'string') {
        return rejected('invalid', 'throughCursor must be a string or null');
      }
      const range = value.range;
      if (range !== undefined) {
        if (typeof range !== 'object' || range === null
          || typeof range.adapterId !== 'string' || range.adapterId.length === 0
          || typeof range.kernelSessionId !== 'string' || range.kernelSessionId.length === 0
          || !Number.isSafeInteger(range.startPosition) || range.startPosition < 1
          || !Number.isSafeInteger(range.throughPosition) || range.throughPosition < 1
          || range.startPosition > range.throughPosition) {
          return rejected('invalid', 'range must be a positive safe-integer interval within the mapped Kernel Session');
        }
        if (value.throughCursor !== null) {
          return rejected('invalid', 'range and throughCursor cannot both pin the history boundary');
        }
      }

      let card: ReadResult<SessionCard>;
      try {
        card = await sessions.readSession(ctx, sessionRef);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return rejected('unavailable', `the Session directory could not read the mapped Session: ${message}`);
      }
      if (card.status === 'not_found') {
        // A call workspace with no trusted Kernel registration cannot own any
        // mapped Session here; answer the miss as forbidden rather than
        // confirming that the Session ID does not exist.
        if (!kernelStores.forWorkspace({ projectId: sessionRef.projectId, workspaceId: ctxWorkspaceId })) {
          return rejected('forbidden', 'the call workspace is not a trusted Kernel workspace');
        }
        return card;
      }
      if (card.status !== 'ready') return card;
      const record = card.value.record;
      if (record.ref.projectId !== ctxProjectId || record.workspaceId !== ctxWorkspaceId) {
        return rejected('forbidden', 'the mapped Session is outside the call workspace scope');
      }
      if (record.health === 'unavailable') {
        return rejected('unavailable', 'the mapped Session is recorded unavailable');
      }
      if (record.ref.sessionId !== sessionRef.sessionId || record.ref.projectId !== sessionRef.projectId) {
        return rejected('unavailable', 'the mapped Session record does not match the requested platform reference');
      }

      const kernel = record.kernel;
      const resolved = kernelStores.byAdapterId(kernel.adapterId);
      if (!resolved) {
        return rejected('unavailable', 'the mapped Kernel adapter is not registered by the trusted Host');
      }
      const legacyMatch = kernelStores.legacy(kernel.adapterId, kernel.kernelSessionId);
      if ('expectedSessionId' in resolved) {
        if (!legacyMatch) {
          return rejected('unavailable', 'the trusted legacy locator does not match the mapped Kernel Session');
        }
      } else if (resolved.workspace.projectId !== ctxProjectId || resolved.workspace.workspaceId !== ctxWorkspaceId) {
        return rejected('unavailable', 'the mapped Kernel store belongs to another workspace');
      }

      const binding: HistoryBinding = {
        platformRef: { projectId: sessionRef.projectId, sessionId: sessionRef.sessionId },
        adapterId: kernel.adapterId,
        kernelSessionId: kernel.kernelSessionId,
        principal: principalKey,
      };
      try {
        // The database file presence check sits inside this mapping: a genuinely
        // absent file is not_found, while EACCES and every other stat failure is
        // unavailable and never silently opens a fresh empty legacy database.
        if (await kernelDatabaseState(resolved.databasePath) === 'missing') {
          return rejected('not_found', 'the mapped Kernel database file is missing');
        }
        const read = (reader: KernelSessionReader) => readBoundedHistory(reader, {
          binding, limit: value.limit, afterCursor: value.afterCursor,
          throughCursor: value.throughCursor, range, signal,
        });
        return legacyMatch
          ? await kernelStores.withLegacyReader(kernel.adapterId, kernel.kernelSessionId, read)
          : await kernelStores.withStore(kernel.adapterId, read);
      } catch (error) {
        return mapHistoryFailure(error, signal);
      }
    },
  };
}


// ------------------------------------------------------------------------ //
// B2 Session completion-boundary owner seam (PHASE-1 SKELETON)              //
// ------------------------------------------------------------------------ //
/**
 * The B2 driver must not invent an opaque history cursor or read the Session
 * head. The existing Session history owner alone may turn the persistent last
 * completed-turn boundary into a cursor bound to the fixed platform system
 * actor. A normal user-supplied cursor can never become this boundary, and the
 * helper never scans the whole history to guess one.
 *
 * Phase 1 declares the seam (and the fixed actor); the concrete construction
 * reusing `encodeHistoryCursor`/`verifyOriginalPositionOne` is a phase-2 change.
 */
export const RUNTIME_HISTORY_PRINCIPAL_ACTOR = Object.freeze({ kind: 'system' as const, id: 'agent-runtime' });

export type CompletedHistoryBoundaryRequest = {
  /** Only the canonical Session.historyCursor may be interpreted here. */
  session: SessionRecord;
  signal: AbortSignal;
};
export type CompletedHistoryBoundary =
  | { status: 'resolved'; cursor: string | null; upper: number; position: number }
  | CoreRejection;
export type RuntimeHistoryWindowRequest = {
  session: SessionRecord;
  /** Exclusive consumed position; never derived by decoding a public caller token. */
  afterPosition: number;
  /** null freezes the real current tail once for this window. */
  throughPosition: number | null;
  limit: number;
  signal: AbortSignal;
};
export type RuntimeHistoryWindow = {
  entries: SessionHistoryEntry[];
  throughPosition: number;
  nextPosition: number;
  hasMore: boolean;
};
export interface SessionHistoryCursorOwner {
  completedBoundary(request: CompletedHistoryBoundaryRequest): Promise<CompletedHistoryBoundary>;
  readPositionWindow(request: RuntimeHistoryWindowRequest): Promise<ReadResult<RuntimeHistoryWindow>>;
}
export function createSessionHistoryCursorOwner(deps: { kernelStores: KernelStoreRegistry }): SessionHistoryCursorOwner {
  const { kernelStores } = deps;
  const fixedPrincipal = principalBinding({ kind: 'host', actor: RUNTIME_HISTORY_PRINCIPAL_ACTOR });
  if (fixedPrincipal === null) throw new Error('the runtime history principal cannot be canonicalized');

  /** Read through the Session's own Kernel mapping; a legacy locator stays a
   * read-only reader and never opens a replacement database. */
  async function withSessionReader<T>(
    session: SessionRecord,
    signal: AbortSignal,
    use: (reader: KernelSessionReader) => Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false; rejection: CoreRejection }> {
    const location = kernelStores.byAdapterId(session.kernel.adapterId);
    if (!location) return { ok: false, rejection: rejected('unavailable', 'the mapped Kernel adapter is not registered') };
    try {
      if ('expectedSessionId' in location) {
        if (!kernelStores.legacy(session.kernel.adapterId, session.kernel.kernelSessionId)) {
          return { ok: false, rejection: rejected('unavailable', 'the legacy Kernel locator does not match the mapped Session') };
        }
        return { ok: true, value: await kernelStores.withLegacyReader(session.kernel.adapterId, session.kernel.kernelSessionId, use) };
      }
      return { ok: true, value: await kernelStores.withStore(session.kernel.adapterId, use) };
    } catch (error) {
      return { ok: false, rejection: mapHistoryFailure(error, signal) };
    }
  }

  return {
    async completedBoundary(request: CompletedHistoryBoundaryRequest): Promise<CompletedHistoryBoundary> {
      const { session, signal } = request;
      if (signalAborted(signal)) return rejected('cancelled', 'the completed-boundary read was cancelled');
      if (session.historyCursor === null) {
        return { status: 'resolved', cursor: null, upper: 0, position: 0 };
      }
      const decoded = decodeHistoryCursor(session.historyCursor);
      if (decoded === null) return rejected('invalid', 'Session.historyCursor is not a canonical platform history cursor');
      if (decoded.platformRef.projectId !== session.ref.projectId
        || decoded.platformRef.sessionId !== session.ref.sessionId
        || decoded.adapterId !== session.kernel.adapterId
        || decoded.kernelSessionId !== session.kernel.kernelSessionId) {
        return rejected('forbidden', 'the stored history boundary names another Session mapping');
      }
      // The public cursor is principal-bound; only the fixed platform runtime
      // actor that produced the boundary may interpret it across callers.
      if (decoded.principal !== fixedPrincipal) {
        return rejected('forbidden', 'the stored history boundary was not bound to the runtime actor');
      }
      const verified = await withSessionReader(session, signal, async reader => {
        await assertOriginalKernelSession(reader, session.kernel.kernelSessionId, signal);
        const page = await reader.read(session.kernel.kernelSessionId, decoded.position - 1, 1, { signal });
        const record = page.records[0];
        if (record === undefined || record.position !== decoded.position) {
          throw new StoreError('not_found', 'the stored completed boundary no longer exists in the Kernel Session');
        }
        return { upper: decoded.upper, position: decoded.position };
      });
      if (!verified.ok) return verified.rejection;
      return { status: 'resolved', cursor: session.historyCursor, upper: verified.value.upper, position: verified.value.position };
    },

    async readPositionWindow(request: RuntimeHistoryWindowRequest): Promise<ReadResult<RuntimeHistoryWindow>> {
      const { session, signal } = request;
      if (signalAborted(signal)) return rejected('cancelled', 'the bounded history window read was cancelled');
      if (!Number.isSafeInteger(request.afterPosition) || request.afterPosition < 0) {
        return rejected('invalid', 'afterPosition must be a non-negative safe integer');
      }
      if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > MAX_HISTORY_LIMIT) {
        return rejected('invalid', `history window limit must be an integer between 1 and ${String(MAX_HISTORY_LIMIT)}`);
      }
      const binding: HistoryBinding = {
        platformRef: { projectId: session.ref.projectId, sessionId: session.ref.sessionId },
        adapterId: session.kernel.adapterId,
        kernelSessionId: session.kernel.kernelSessionId,
        principal: fixedPrincipal,
      };
      const read = await withSessionReader(session, signal, async reader => {
        // The tail is frozen from the REAL header fact, never from a partial
        // page's lastPosition; an explicit throughPosition keeps that boundary.
        const head = await reader.read(binding.kernelSessionId, 0, 1, { signal });
        if (head.records.length === 0) {
          throw new StoreError('not_found', 'the mapped Kernel Session has no original session.created history');
        }
        verifyOriginalPositionOne(head.records[0], binding.kernelSessionId);
        const frozenThrough = request.throughPosition ?? head.lastPosition;
        if (!Number.isSafeInteger(frozenThrough) || frozenThrough < 0) {
          throw new StoreError('corrupt', 'the Kernel Session tail is not a valid position');
        }
        if (frozenThrough <= request.afterPosition) {
          return { entries: [] as SessionHistoryEntry[], throughPosition: frozenThrough, nextPosition: request.afterPosition, hasMore: false };
        }
        const pageLimit = Math.min(request.limit, frozenThrough - request.afterPosition);
        const page = await reader.read(binding.kernelSessionId, request.afterPosition, pageLimit, { signal });
        const records = page.records
          .filter(record => record.position > request.afterPosition && record.position <= frozenThrough)
          .sort((a, b) => a.position - b.position);
        // Contiguity is proven BEFORE any reduction; a hidden gap must fail
        // rather than be filtered into a shorter page. The original position-1
        // identity was already re-proven by the head read above.
        let expected = request.afterPosition + 1;
        for (const record of records) {
          if (record.position !== expected) {
            throw new StoreError('corrupt', 'the Kernel history positions are not contiguous from afterPosition');
          }
          expected += 1;
        }
        const lower = request.afterPosition + 1;
        const entries = records.map(record => toHistoryEntry(record, binding, frozenThrough, lower));
        const nextPosition = records.at(-1)?.position ?? request.afterPosition;
        return { entries, throughPosition: frozenThrough, nextPosition, hasMore: nextPosition < frozenThrough };
      });
      if (!read.ok) return read.rejection;
      return { status: 'ready', value: read.value };
    },
  };
}
