import type { PreparedTaskManifestV1 } from '../../contracts/core/prepared-execution.js';
import type { ReadResult } from '../../contracts/core/results.js';
import type { SessionRecord } from '../../contracts/core/session.js';
import type { TaskRequeueSnapshotV1 } from '../../contracts/task-requeue.js';
import type { KernelCallRefV1 } from '../../contracts/unknown-call-review.js';
import type { ContinuationBasis, TaskExecutionRecord } from '../work-graph/model/execution-read-contracts.js';
import type { KernelCommandFactV1 } from '../work-graph/model/kernel-command-read-contracts.js';
import { requeueHistorySourceOf } from '../work-graph/state/task-failure.js';
import { isRecord, messageOf, rejected } from './context-support.js';
import type {
  ContextAssemblerDependencies, HistoryDecisionV1, SessionBasisV1,
  SessionHistoryDecisionInputV1,
} from './context-types.js';
import { decodeKernelEntry } from './kernel-turn-facts.js';
import { createSessionHistoryCursorOwner, type SessionHistoryCursorOwner } from './session-operations.js';

/** The Kernel `agent.event` types that end a Turn: a completed history boundary (LA-1). */
const KERNEL_TERMINAL_EVENTS: readonly string[] = ['run.completed', 'run.failed', 'run.cancelled', 'run.limit_exceeded', 'run.yielded', 'run.interrupted'];

/**
 * Ruling 14: the ONE pure mode rule preparation and start share. Work takes its
 * formal seed when it has a non-null position, else any completed cursor; a
 * Query with a formal basis follows the basis's position and never the cursor,
 * without one it follows the cursor. `sessionHistoryDecision` computes its mode
 * through this function, so the two cannot drift.
 */
export function takesSessionHistoryOf(input: {
  callKind: 'work' | 'query';
  sessionBasis: SessionBasisV1 | undefined;
  hasCompletedCursor: boolean;
}): boolean {
  if (input.callKind === 'work') {
    return input.sessionBasis?.throughPosition != null || input.hasCompletedCursor;
  }
  return input.sessionBasis !== undefined
    ? input.sessionBasis.throughPosition !== null
    : input.hasCompletedCursor;
}

/**
 * Ruling 14: the ONE pure history rule. Start chooses the history boundary and
 * the source Session; the mode itself delegates to `takesSessionHistoryOf`, the
 * same pure rule preparation uses. A Work seed wins only when its basis has a
 * non-null throughPosition and the Session has no completed cursor; a Query with
 * a formal basis never looks at a boundary (C7).
 */
export function sessionHistoryDecision(input: SessionHistoryDecisionInputV1): HistoryDecisionV1 {
  const basis = input.sessionBasis;
  const boundary = input.completedBoundary ?? null;
  const takesSessionHistory = takesSessionHistoryOf({
    callKind: input.callKind,
    sessionBasis: basis,
    hasCompletedCursor: boundary !== null && boundary.cursor !== null,
  });
  if (!takesSessionHistory) return { mode: 'current_turn', takesSessionHistory: false };
  if (input.callKind === 'work') {
    // A non-null cursor is the start rule's same-Session reuse; otherwise the
    // basis is the LA-1 seed. At least one of them is present whenever the mode
    // above is true, so the branches below are exhaustive in practice.
    if (boundary !== null && boundary.cursor !== null) {
      return { mode: 'session_history', takesSessionHistory: true,
        throughPosition: boundary.position, sourceSessionId: null };
    }
    if (basis !== undefined && basis.throughPosition !== null) {
      return { mode: 'session_history', takesSessionHistory: true,
        throughPosition: basis.throughPosition, sourceSessionId: basis.sourceKernelSessionId };
    }
    return { mode: 'current_turn', takesSessionHistory: false };
  }
  if (basis !== undefined) {
    if (basis.throughPosition !== null) {
      return { mode: 'session_history', takesSessionHistory: true,
        throughPosition: basis.throughPosition, sourceSessionId: basis.sourceKernelSessionId };
    }
    return { mode: 'current_turn', takesSessionHistory: false };
  }
  return boundary !== null && boundary.cursor !== null
    ? { mode: 'session_history', takesSessionHistory: true,
        throughPosition: boundary.position, sourceSessionId: null }
    : { mode: 'current_turn', takesSessionHistory: false };
}

export type SessionBasisOutcome =
  | { status: 'ready'; value: PreparedTaskManifestV1['sessionBasis'] | null }
  | { status: 'cancelled' };

/**
 * K3 L12: the last completed-Turn boundary at or before `through`, from the same
 * bounded Kernel window read. `undefined` means the history could not be read
 * (the callers answer null/undefined); `null` means it held no terminal event;
 * `cancelled` means the signal or the window owner named cancellation, which is
 * never "no history" (slice 8 §13.8).
 */
async function lastTerminalBoundary(
  owner: SessionHistoryCursorOwner,
  session: Parameters<SessionHistoryCursorOwner['readPositionWindow']>[0]['session'],
  through: number, signal: AbortSignal,
): Promise<number | null | undefined | 'cancelled'> {
  let boundary: number | null = null;
  let cursor = 0;
  for (let page = 0; page < 64 && cursor < through; page += 1) {
    if (signal.aborted) return 'cancelled';
    let window;
    try {
      window = await owner.readPositionWindow({ session, afterPosition: cursor, throughPosition: through, limit: 200, signal });
    } catch { return signal.aborted ? 'cancelled' : undefined; }
    if (signal.aborted) return 'cancelled';
    if (window.status === 'rejected' && window.code === 'cancelled') return 'cancelled';
    if (window.status !== 'ready') return undefined;
    for (const entry of window.value.entries) {
      const item = decodeKernelEntry(entry);
      if (item === null) return undefined;
      if (item.record.recordType === 'agent.event' && KERNEL_TERMINAL_EVENTS.includes(item.record.payload.event.type)) {
        boundary = item.position;
      }
    }
    cursor = window.value.nextPosition;
    if (!window.value.hasMore) break;
  }
  return boundary;
}

export async function sessionBasisForContext(
  deps: ContextAssemblerDependencies, record: TaskExecutionRecord, basis: ContinuationBasis, signal: AbortSignal,
): Promise<SessionBasisOutcome> {
  const cancelled = (): SessionBasisOutcome => ({ status: 'cancelled' });
  const none = (): SessionBasisOutcome => ({ status: 'ready', value: null });
  if (signal.aborted) return cancelled();
  const source = basis.requeue.historySource;
  if (source === null || deps.kernelStores === undefined) return none();
  const claimSession = record.session;
  if (source.sessionRef.projectId === record.outbox.claim.sessionRef.projectId
    && source.sessionRef.sessionId === record.outbox.claim.sessionRef.sessionId) return none();
  if (claimSession.historyCursor !== null) return none();
  if (source.adapterId !== claimSession.kernel.adapterId) return none();
  if (source.throughPosition === null) {
    return { status: 'ready', value: { sourceKernelSessionId: source.kernelSessionId, throughPosition: null } };
  }
  const onChain = [basis.previous, ...basis.factsChain.map((hop) => hop.run)].find((candidate) =>
    candidate.session.ref.projectId === source.sessionRef.projectId && candidate.session.ref.sessionId === source.sessionRef.sessionId);
  const sourceSession = onChain?.session ?? { ...claimSession,
    ref: { ...claimSession.ref, projectId: source.sessionRef.projectId, sessionId: source.sessionRef.sessionId },
    kernel: { ...claimSession.kernel, adapterId: source.adapterId, kernelSessionId: source.kernelSessionId } };
  if (sourceSession.kernel.kernelSessionId !== source.kernelSessionId || sourceSession.kernel.adapterId !== source.adapterId) {
    return none();
  }
  const owner = createSessionHistoryCursorOwner({ kernelStores: deps.kernelStores,
    ...(deps.kernel === undefined ? {} : { kernel: deps.kernel }) });
  let boundary: number | null = null;
  let cursor = 0;
  for (let page = 0; page < 64 && cursor < source.throughPosition; page += 1) {
    if (signal.aborted) return cancelled();
    let window;
    try {
      window = await owner.readPositionWindow({ session: sourceSession, afterPosition: cursor,
        throughPosition: source.throughPosition, limit: 200, signal });
    } catch {
      if (signal.aborted) return cancelled();
      return none();
    }
    if (signal.aborted) return cancelled();
    // The window owner supports cancellation; never turn its explicit answer
    // into "no session basis" (a null value that silently seeds nothing).
    if (window.status === 'rejected' && window.code === 'cancelled') return cancelled();
    if (window.status !== 'ready') return none();
    for (const entry of window.value.entries) {
      const item = decodeKernelEntry(entry);
      if (item === null) return none();
      if (item.record.recordType === 'agent.event' && KERNEL_TERMINAL_EVENTS.includes(item.record.payload.event.type)) {
        boundary = item.position;
      }
    }
    cursor = window.value.nextPosition;
    if (!window.value.hasMore) break;
  }
  return { status: 'ready', value: { sourceKernelSessionId: source.kernelSessionId, throughPosition: boundary } };
}

/**
 * K3 L12: a review round in a fresh Session seeds the model history from the
 * ORIGINAL Run, derived exactly as `requeueHistorySourceOf(afterRun)` (there is
 * no TaskRequeue for a review round). The last completed Turn boundary at or
 * before the source's position is the seed; `throughPosition: null` is the
 * explicit empty baseline. A source Session that is the round's own Session, or
 * a claim Session that already has a cursor, seeds nothing.
 */
export async function reviewSessionBasis(
  deps: ContextAssemblerDependencies, record: TaskExecutionRecord, original: TaskExecutionRecord, signal: AbortSignal,
): Promise<PreparedTaskManifestV1['sessionBasis'] | undefined | 'cancelled'> {
  const source = requeueHistorySourceOf(original.run, []);
  if (source === null || deps.kernelStores === undefined) return undefined;
  const claimSession = record.session;
  if (source.sessionRef.projectId === record.outbox.claim.sessionRef.projectId
    && source.sessionRef.sessionId === record.outbox.claim.sessionRef.sessionId) return undefined;
  if (claimSession.historyCursor !== null) return undefined;
  if (source.adapterId !== claimSession.kernel.adapterId) return undefined;
  if (source.throughPosition === null) {
    return { sourceKernelSessionId: source.kernelSessionId, throughPosition: null };
  }
  const sourceSession = original.session.kernel.adapterId === source.adapterId
    && original.session.kernel.kernelSessionId === source.kernelSessionId
    ? original.session
    : { ...claimSession,
        ref: { ...claimSession.ref, projectId: source.sessionRef.projectId, sessionId: source.sessionRef.sessionId },
        kernel: { ...claimSession.kernel, adapterId: source.adapterId, kernelSessionId: source.kernelSessionId } };
  const owner = createSessionHistoryCursorOwner({ kernelStores: deps.kernelStores,
    ...(deps.kernel === undefined ? {} : { kernel: deps.kernel }) });
  const boundary = await lastTerminalBoundary(owner, sourceSession, source.throughPosition, signal);
  if (boundary === undefined || boundary === 'cancelled') return boundary;
  return { sourceKernelSessionId: source.kernelSessionId, throughPosition: boundary };
}

/**
 * K L9/L19a: the ONE original-Kernel command/cwd reader shared by the review
 * instruction and the disposition. It reads the same bounded window the
 * continuation brief uses and maps each requested callId to the arguments the
 * original Turn's `assistant.message_completed` record declares. A call whose
 * arguments are not found is absent; any unreadable/foreign Session is
 * `unavailable`, never an empty map.
 */
export async function readKernelCommandFacts(
  deps: Pick<ContextAssemblerDependencies, 'kernelStores' | 'kernel'>,
  ctx: { signal?: AbortSignal },
  input: { session: SessionRecord; calls: readonly KernelCallRefV1[] },
): Promise<ReadResult<ReadonlyMap<string, KernelCommandFactV1>>> {
  if (deps.kernelStores === undefined) {
    return rejected('unavailable', 'the Kernel stores are not wired for the command read');
  }
  const groups = new Map<string, KernelCallRefV1[]>();
  for (const call of input.calls) {
    const group = groups.get(call.kernelSessionId);
    if (group === undefined) groups.set(call.kernelSessionId, [call]);
    else group.push(call);
  }
  for (const kernelSessionId of groups.keys()) {
    if (input.session.kernel.kernelSessionId !== kernelSessionId) {
      return rejected('unavailable', `the Session does not map to Kernel session ${kernelSessionId}`);
    }
  }
  const positions = input.calls
    .map(call => call.declaredPosition)
    .filter(position => Number.isSafeInteger(position) && position >= 0);
  if (positions.length === 0) return { status: 'ready', value: new Map() };
  const declared = new Map<string, unknown>();
  const signal = ctx.signal ?? new AbortController().signal;
  try {
    const owner = createSessionHistoryCursorOwner({ kernelStores: deps.kernelStores,
      ...(deps.kernel === undefined ? {} : { kernel: deps.kernel }) });
    const max = Math.max(...positions);
    let cursor = Math.max(0, Math.min(...positions) - 1);
    let completed = false;
    for (let page = 0; page < 64; page += 1) {
      if (cursor >= max) { completed = true; break; }
      const window = await owner.readPositionWindow({ session: input.session, afterPosition: cursor,
        throughPosition: max, limit: 200, signal });
      if (window.status !== 'ready') {
        // F-076: a cancelled window keeps its cancellation; the original
        // rejection is passed on instead of being renamed `unavailable`.
        if (window.status === 'rejected') return window;
        return rejected('unavailable', 'the Kernel command window is not readable at the required watermark');
      }
      for (const entry of window.value.entries) {
        const item = decodeKernelEntry(entry);
        if (item === null || item.record.recordType !== 'agent.event') continue;
        const event = item.record.payload.event;
        if (event.type !== 'assistant.message_completed') continue;
        for (const group of groups.values()) {
          const first = group[0];
          if (first === undefined || event.meta.runId !== first.kernelRunId
            || event.meta.turnId !== first.turnId) continue;
          for (const call of event.payload.toolCalls) {
            if (!declared.has(call.callId)) declared.set(call.callId, call.arguments);
          }
        }
      }
      if (!window.value.hasMore) {
        // F-101: ready only when the requested window was read to its end.
        if (window.value.nextPosition < max) {
          return rejected('unavailable', 'the Kernel command window ended before the requested position');
        }
        completed = true;
        break;
      }
      const next = window.value.nextPosition;
      // F-101: a cursor that does not advance is never a partial ready map.
      if (next <= cursor) return rejected('unavailable', 'the Kernel command cursor did not advance');
      cursor = next;
    }
    // F-101: page 64 finishing exactly on the end is ready; anything left fails.
    if (!completed) return rejected('unavailable', 'the Kernel command window did not end within 64 pages');
  } catch (error) {
    // F-076: an aborted signal is a cancellation, not an unreadable window.
    if (signal.aborted) return rejected('cancelled', 'the Kernel command read was cancelled');
    return rejected('unavailable', `the Kernel command read failed: ${messageOf(error)}`);
  }
  const facts = new Map<string, KernelCommandFactV1>();
  for (const call of input.calls) {
    const args = declared.get(call.callId);
    if (!isRecord(args)) continue;
    facts.set(call.callId, {
      command: typeof args['command'] === 'string' ? args['command'] : null,
      cwd: typeof args['cwd'] === 'string' ? args['cwd'] : null,
    });
  }
  return { status: 'ready', value: facts };
}

/**
 * Slice 1 §4.1 (T10): `TaskRequeue.archiveOrigin != null` marks an archive
 * ordinary claim. It keeps the real TaskRequeue fact chain and the anchored
 * brief but never seeds the old line's full Kernel history: the session basis
 * is skipped, so `sessionBasis`/`seededFrom` stay null and the brief's continuity
 * is `other_session`. The condition is deliberately NOT "the Task has an
 * anchor", which would break the existing human-continue continuation case.
 */
export function archiveOriginSkipsHistorySeed(
  requeue: Pick<TaskRequeueSnapshotV1, 'archiveOrigin'>,
): boolean {
  return requeue.archiveOrigin !== undefined && requeue.archiveOrigin !== null;
}

/**
 * D2 (L9 lines 185-195): whether a Run provably entered the Kernel even
 * without an execution-history position record. An attested RUN-22 is the
 * documented case; the V2 entry authorization's `entered` phase is the other
 * stored proof. A genuinely never-entered Run has neither.
 */
export function runEnteredKernel(run: TaskExecutionRecord['run']): boolean {
  if (run.executionHistory !== undefined) return true;
  if (run.reconciliation?.observation?.kind === 'human_attested') return true;
  const auth = run.executionAuthorization;
  return auth !== undefined
    && auth.kernel !== null && auth.phase === 'entered';
}
