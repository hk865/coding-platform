/**
 * R4c.2b graph execution-history reader.
 *
 * This is the thin WorkGraph-locator -> existing RT7 adapter. It is NOT a second
 * transcript, graph, history database, Manager or Repository, and it opens no
 * Store/SQL for itself: it composes exactly ONE `ExecutionReadPort.readExecution`
 * (the frozen WG11 exact-fact read, which already returns the Run's optional
 * `RunSnapshot.executionHistory` locator) with exactly ONE existing
 * `ExecutionHistoryPort.readExecutionHistory` (the frozen RT7 raw-history read).
 *
 * Contract:
 *  - `readTaskExecutionHistory(ctx, { runRef, afterCursor, limit })` owns `ctx`
 *    and the request synchronously before the first await, keeps the original
 *    AbortSignal by reference, and re-checks cancellation after every await;
 *  - the Run is located through WG11 only. A Run with no `executionHistory` is
 *    `unsupported` and MUST NOT delegate to history or fall back to scanning the
 *    Session head. A damaged locator, or one whose Session/adapter mapping does
 *    not match the claim Session, is `unavailable`;
 *  - the persisted locator supplies `kernel.runId`/`kernel.turnId` (never the
 *    platform runId), `SessionRef`, the inclusive `startPosition` and the upper
 *    bound `endPosition ?? observedThroughPosition`. RT7 is delegated the frozen
 *    `range` `{ adapterId, kernelSessionId, startPosition, throughPosition }`;
 *    the Kernel body is never parsed or filtered here again;
 *  - the outer continuation cursor stores the complete `RunRef`, the fixed
 *    Kernel/Session identity, the start and the FROZEN upper bound, plus RT7's
 *    opaque nextCursor. Every page re-reads WG11 and requires the core identity
 *    and start to be unchanged and the frozen upper to remain inside the current
 *    valid graph range. Observed growth is allowed while the old upper is kept; a
 *    terminal end smaller than the frozen upper is `source_stale`;
 *  - the cursor is never an authorization: every page still enforces the current
 *    scope/origin checks, a cursor cannot be moved to another Run/Session/principal,
 *    and the inner cursor remains owned and validated by RT7/RT1;
 *  - the Session being currently occupied or archived by another execution does
 *    not block a historical query; current facts are not entry permission;
 *  - `not_found`/`not_ready`/`cancelled` pass through; an unexpected throw from a
 *    dependency becomes `unavailable`, never a silent empty page.
 */
import { Buffer } from 'node:buffer';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { RunExecutionHistoryV1 } from '../../contracts/core/execution-history.js';
import type { CoreError, CoreRejection, ReadResult } from '../../contracts/core/results.js';
import type { RunRef } from '../../contracts/dispatch.js';
import { isRunExecutionHistoryV1 } from '../work-graph/persistence/execution-history-codecs.js';
import type { SessionHistoryRange } from './session-operations.js';
import type {
  ExecutionHistoryPage,
  GraphExecutionHistoryDependencies,
  GraphExecutionHistoryReadPort,
  KernelExecutionIdentity,
  TaskExecutionHistoryRequest,
} from './execution-history-contracts.js';

/** One raw owner page is 1..200 lines; this reader delegates at most one page. */
const MAX_GRAPH_HISTORY_LIMIT = 200;
/** Private outer cursor; it wraps, and never parses, RT7's opaque nextCursor. */
const GRAPH_HISTORY_CURSOR_PREFIX = 'graphexechist1.';

type OwnedGraphRequest = { runRef: RunRef; afterCursor: string | null; limit: number };

type GraphHistoryBinding = {
  sessionRef: { projectId: string; sessionId: string };
  kernel: KernelExecutionIdentity & { adapterId: string; kernelSessionId: string };
  start: number;
  upper: number;
};

type GraphHistoryCursor = GraphHistoryBinding & { runRef: RunRef; after: string };

function rejected(code: CoreError, reason: string): CoreRejection {
  return { status: 'rejected', code, reason };
}
function signalAborted(signal: unknown): boolean {
  return signal instanceof AbortSignal && signal.aborted;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}
function isRunRef(value: unknown): value is RunRef {
  if (!isRecord(value)) return false;
  return value['aggregateType'] === 'Run' && isNonEmptyString(value['projectId'])
    && isNonEmptyString(value['goalId']) && isNonEmptyString(value['runId']);
}
function sameRunRef(left: RunRef, right: RunRef): boolean {
  return left.aggregateType === right.aggregateType && left.projectId === right.projectId
    && left.goalId === right.goalId && left.runId === right.runId;
}
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function ownRequest(request: TaskExecutionHistoryRequest): OwnedGraphRequest | null {
  try {
    const owned = structuredClone(request);
    return { runRef: owned.runRef, afterCursor: owned.afterCursor ?? null, limit: owned.limit };
  } catch {
    return null;
  }
}

function encodeGraphHistoryCursor(cursor: GraphHistoryCursor): string {
  const body = JSON.stringify({
    v: 1,
    r: { t: cursor.runRef.aggregateType, p: cursor.runRef.projectId, g: cursor.runRef.goalId, i: cursor.runRef.runId },
    s: { p: cursor.sessionRef.projectId, i: cursor.sessionRef.sessionId },
    k: { a: cursor.kernel.adapterId, s: cursor.kernel.kernelSessionId, r: cursor.kernel.runId, t: cursor.kernel.turnId },
    b: cursor.start,
    u: cursor.upper,
    c: cursor.after,
  });
  return GRAPH_HISTORY_CURSOR_PREFIX + Buffer.from(body, 'utf8').toString('base64url');
}

function decodeGraphHistoryCursor(raw: string): GraphHistoryCursor | null {
  if (typeof raw !== 'string' || !raw.startsWith(GRAPH_HISTORY_CURSOR_PREFIX)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw.slice(GRAPH_HISTORY_CURSOR_PREFIX.length), 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed['v'] !== 1) return null;
  const run = parsed['r'];
  const session = parsed['s'];
  const kernel = parsed['k'];
  const start = parsed['b'];
  const upper = parsed['u'];
  const after = parsed['c'];
  if (!isRecord(run) || !isRecord(session) || !isRecord(kernel)) return null;
  if (!isNonEmptyString(run['t']) || !isNonEmptyString(run['p'])
    || !isNonEmptyString(run['g']) || !isNonEmptyString(run['i'])) return null;
  if (!isNonEmptyString(session['p']) || !isNonEmptyString(session['i'])) return null;
  if (!isNonEmptyString(kernel['a']) || !isNonEmptyString(kernel['s'])
    || !isNonEmptyString(kernel['r']) || !isNonEmptyString(kernel['t'])) return null;
  if (!isPositiveSafeInteger(start) || !isPositiveSafeInteger(upper) || !isNonEmptyString(after)) return null;
  if (start > upper) return null;
  return {
    runRef: { aggregateType: 'Run', projectId: run['p'], goalId: run['g'], runId: run['i'] },
    sessionRef: { projectId: session['p'], sessionId: session['i'] },
    kernel: { adapterId: kernel['a'], kernelSessionId: kernel['s'], runId: kernel['r'], turnId: kernel['t'] },
    start,
    upper,
    after,
  };
}

function locatorRange(locator: RunExecutionHistoryV1, upper: number): SessionHistoryRange {
  return {
    adapterId: locator.kernel.adapterId,
    kernelSessionId: locator.kernel.kernelSessionId,
    startPosition: locator.startPosition,
    throughPosition: upper,
  };
}

export function createGraphExecutionHistoryReader(
  deps: GraphExecutionHistoryDependencies,
): GraphExecutionHistoryReadPort {
  const { executions, history } = deps;
  return {
    async readTaskExecutionHistory(ctx, request): Promise<ReadResult<ExecutionHistoryPage>> {
      // 1. Own the trusted inputs synchronously, before the first await; the
      //    original AbortSignal is kept by reference so cancellation is never lost.
      const ownedCtx = ownContext(ctx);
      const ownedRequest = ownRequest(request);
      if (ownedCtx === null || ownedRequest === null) {
        return rejected('invalid', 'the graph history request or call context cannot be isolated from the caller');
      }
      const signal = ownedCtx.signal;
      if (signalAborted(signal)) {
        return rejected('cancelled', 'the graph execution history read was cancelled before locating the Run');
      }
      const { runRef, afterCursor, limit } = ownedRequest;
      if (!isRunRef(runRef)) return rejected('invalid', 'readTaskExecutionHistory requires a complete RunRef');
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_GRAPH_HISTORY_LIMIT) {
        return rejected('invalid', `graph execution history limit must be an integer between 1 and ${String(MAX_GRAPH_HISTORY_LIMIT)}`);
      }

      // 2. An outer continuation is self-describing: it binds the complete RunRef
      //    and must never be moved to another Run.
      let cursor: GraphHistoryCursor | null = null;
      if (afterCursor !== null) {
        cursor = decodeGraphHistoryCursor(afterCursor);
        if (cursor === null) return rejected('invalid', 'afterCursor is not a graph execution-history continuation cursor');
        if (!sameRunRef(cursor.runRef, runRef)) return rejected('invalid', 'afterCursor belongs to another Run');
      }

      // 3. Exactly ONE WG11 exact-fact read locates the persisted locator.
      let located;
      try {
        located = await executions.readExecution(ownedCtx, runRef);
      } catch (error) {
        if (signalAborted(signal)) return rejected('cancelled', 'the graph execution history read was cancelled while locating the Run');
        return rejected('unavailable', `the execution locator read failed: ${messageOf(error)}`);
      }
      if (signalAborted(signal)) return rejected('cancelled', 'the graph execution history read was cancelled while locating the Run');
      if (located.status !== 'ready') return located;
      const record = located.value;
      const locator = record.run.executionHistory;
      if (locator === undefined) {
        return rejected('unsupported', 'the Run has no persisted execution-history locator');
      }
      if (!isRunExecutionHistoryV1(locator)) {
        return rejected('unavailable', 'the persisted execution-history locator is malformed');
      }
      // A locator must be chained to the claim Session and its Kernel mapping;
      // a mismatch is damaged provenance, never a different readable history.
      if (locator.sessionRef.projectId !== record.outbox.claim.sessionRef.projectId
        || locator.sessionRef.sessionId !== record.outbox.claim.sessionRef.sessionId) {
        return rejected('unavailable', 'the execution-history locator names another Session than the claim');
      }
      if (locator.kernel.adapterId !== record.session.kernel.adapterId
        || locator.kernel.kernelSessionId !== record.session.kernel.kernelSessionId) {
        return rejected('unavailable', 'the execution-history locator disagrees with the claim Session Kernel mapping');
      }
      const currentUpper = locator.endPosition ?? locator.observedThroughPosition;

      let binding: GraphHistoryBinding;
      if (cursor === null) {
        binding = {
          sessionRef: { projectId: locator.sessionRef.projectId, sessionId: locator.sessionRef.sessionId },
          kernel: { ...locator.kernel },
          start: locator.startPosition,
          upper: currentUpper,
        };
      } else {
        // Every continuation re-proves the identity/start and keeps the frozen
        // upper: observed growth never widens a page, and a terminal end below
        // the frozen upper is a stale source.
        if (cursor.sessionRef.projectId !== locator.sessionRef.projectId
          || cursor.sessionRef.sessionId !== locator.sessionRef.sessionId
          || cursor.kernel.adapterId !== locator.kernel.adapterId
          || cursor.kernel.kernelSessionId !== locator.kernel.kernelSessionId
          || cursor.kernel.runId !== locator.kernel.runId
          || cursor.kernel.turnId !== locator.kernel.turnId
          || cursor.start !== locator.startPosition) {
          return rejected('source_stale', 'the persisted execution-history identity or start changed since the page was frozen');
        }
        if (currentUpper < cursor.upper) {
          return rejected('source_stale', 'the terminal execution-history end fell below the frozen upper bound');
        }
        binding = { sessionRef: cursor.sessionRef, kernel: cursor.kernel, start: cursor.start, upper: cursor.upper };
      }
      const range = locatorRange(locator, binding.upper);

      const executionIdentity: KernelExecutionIdentity = { runId: binding.kernel.runId, turnId: binding.kernel.turnId };
      let result;
      try {
        // Exactly ONE RT7 delegation; its inner cursor stays opaque and RT1 owns
        // the range validation. The Session's current occupancy is irrelevant.
        result = await history.readExecutionHistory(ownedCtx, {
          sessionRef: { projectId: binding.sessionRef.projectId, sessionId: binding.sessionRef.sessionId },
          executionIdentity,
          afterCursor: cursor === null ? null : cursor.after,
          throughCursor: null,
          limit,
          range,
        });
      } catch (error) {
        if (signalAborted(signal)) return rejected('cancelled', 'the graph execution history read was cancelled while reading the raw page');
        return rejected('unavailable', `the raw execution-history page could not be read: ${messageOf(error)}`);
      }
      if (signalAborted(signal)) return rejected('cancelled', 'the graph execution history read was cancelled while reading the raw page');
      if (result.status !== 'ready') return result;

      const nextCursor = result.value.nextCursor === null ? null : encodeGraphHistoryCursor({
        runRef,
        sessionRef: binding.sessionRef,
        kernel: binding.kernel,
        start: binding.start,
        upper: binding.upper,
        after: result.value.nextCursor,
      });
      return { status: 'ready', value: { ...result.value, nextCursor } };
    },
  };
}
