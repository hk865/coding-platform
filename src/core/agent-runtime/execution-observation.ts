/**
 * B2 execution observation/reconciliation.
 *
 * The observer NEVER treats a model "completed" text, a Kernel return value or a
 * best-effort callback as terminal evidence. It reads the genuine original
 * history along the persisted locator, reduces the complete Turn with the public
 * Kernel reducer, re-checks the transcript exchange pairing and only then
 * submits the terminal fact to WorkGraph in one atomic recordRunResult.
 * `outcome_unknown`, a paused Turn, a missing page or an unsettled tool batch
 * keeps the real occupancy. No Kernel entry yet and no locator means there is
 * nothing to release and the current record is returned unchanged.
 */
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { VersionPin } from '../../contracts/core/identity.js';
import type { CoreRejection, ReadResult } from '../../contracts/core/results.js';
import type { ControlIntentRef, ControlObservationV1 } from '../../contracts/control-intent.js';
import type { RunExecutionHistoryV1 } from '../../contracts/core/execution-history.js';
import type { ExecutionAuthorizationV2, RunRef, RuntimeEventV1 } from '../../contracts/dispatch.js';
import { canonicalJson } from '../../contracts/fingerprint.js';
import {
  assertTranscriptExchangeIntegrity, createInitialRunState, projectTerminalTranscript,
  reduceRunState, sessionRecordSchema, validateRunStateInvariants,
} from '../../../vendor/coding-agent/dist/public-api.js';
import type { RunState, SessionRecord as KernelSessionRecord } from '../../../vendor/coding-agent/dist/public-api.js';
import { isRunExecutionHistoryV1 } from '../work-graph/persistence/execution-history-codecs.js';
import { createSessionHistoryCursorOwner } from './session-operations.js';
import type { SessionHistoryEntry } from './session-operations.js';
import type {
  KernelExecutionBinding, ObservedExecutionHistory, TaskResultObservation,
} from '../work-graph/tasks/execution-entry-contracts.js';
import type { ObserveTaskRunRequest, RuntimeExecutionDependencies, TaskExecutionRecord } from './execution-contracts.js';
import type { RuntimeControlCoordinator } from './execution-control.js';
import { confirmMailboxInputs } from './execution-inputs.js';

export type ExecutionObservationDependencies = Pick<RuntimeExecutionDependencies,
  | 'entry' | 'historyWriter' | 'executions' | 'graphHistory' | 'activity' | 'sessionOperations'
  | 'kernelStores' | 'host' | 'kernel' | 'now' | 'newId' | 'controls' | 'messages'> & {
  /**
   * R4.3a: the SAME internal control coordinator the driver holds. The private
   * exit/cleanup proof is read here before any positive pause/cancel conclusion;
   * stage 1 only freezes the shared seam.
   */
  control?: RuntimeControlCoordinator;
};

/** Bounded per-call pagination: a Turn is reconstructed page by page, never by an unbounded scan. */
const MAX_OBSERVATION_PAGES = 64;

export type ExecutionObservationService = {
  observe(ctx: CoreCallContext, request: ObserveTaskRunRequest): Promise<ReadResult<TaskExecutionRecord>>;
};

type ControlSource = { position: number; eventId: string; kernelEventSequence: number; inputIntentRef?: ControlIntentRef };
/** The original control-source events actually read for one Run, keyed by event
 * type. Retained across observations so a later observe (whose incremental page
 * is empty) can still complete a pending ack from the same real record. */
type CachedControlSources = Partial<Record<string, ControlSource>>;
type CachedTurn = {
  startPosition: number;
  reducedThrough: number;
  state: RunState;
  controlSources: CachedControlSources;
};
/** A detected terminal whose WorkGraph commit has not yet been confirmed. The
 * exact original event/boundary/requestId is kept so a retry (including after a
 * lost response) reuses the same idempotency fingerprint instead of inventing a
 * second terminal event. */
type PendingTerminal = { endPosition: number; requestId: string; observation: TaskResultObservation };
/** One control-ack attempt whose commit result is unknown. The exact original
 * observation, requestId and pinned revisions are kept so a later observe reuses
 * the SAME idempotency fingerprint and recovers the original receipt. */
type PendingControlAck = { observation: ControlObservationV1; requestId: string; expected: VersionPin[] };
type DecodedRecord = { position: number; record: KernelSessionRecord };

function rejected(code: CoreRejection['code'], reason: string): CoreRejection {
  return { status: 'rejected', code, reason };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function settledStatus(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}
function ownContext(ctx: CoreCallContext): CoreCallContext | null {
  try {
    return {
      projectId: ctx.projectId,
      principal: structuredClone(ctx.principal),
      materialReader: structuredClone(ctx.materialReader),
      signal: ctx.signal,
      ...(typeof ctx.workspaceId === 'string' ? { workspaceId: ctx.workspaceId } : {}),
    };
  } catch { return null; }
}
function mapRead(result: ReadResult<unknown>): CoreRejection {
  if (result.status === 'ready') return rejected('unavailable', 'a must-fail read unexpectedly returned a value');
  if (result.status === 'not_found') return rejected('not_found', 'the required execution fact was not found');
  if (result.status === 'not_ready') return rejected('incomplete', 'the required execution fact is not readable at the required watermark');
  return { status: 'rejected', code: result.code, reason: result.reason, ...(result.current === undefined ? {} : { current: result.current }) };
}
function decodeEntry(entry: SessionHistoryEntry): DecodedRecord | null {
  const body: unknown = entry.body;
  if (!isRecord(body) || body['encoding'] !== 'kernel_session_record_json' || typeof body['text'] !== 'string') return null;
  let parsed: unknown;
  try { parsed = JSON.parse(body['text']); } catch { return null; }
  const result = sessionRecordSchema.safeParse(parsed);
  if (!result.success) return null;
  if (result.data.position !== entry.source.position || result.data.recordId !== entry.recordId
    || result.data.sessionId !== entry.source.kernelSessionId) return null;
  return { position: result.data.position, record: result.data };
}
function findTurnStart(records: readonly DecodedRecord[], kernel: KernelExecutionBinding): { run: Parameters<typeof createInitialRunState>[0]; position: number } | null {
  for (const item of records) {
    if (item.record.recordType !== 'turn.started') continue;
    const payload = item.record.payload as unknown as { run?: Parameters<typeof createInitialRunState>[0] };
    const run = payload.run;
    if (run === undefined || run.runId !== kernel.runId || run.turn.turnId !== kernel.turnId) continue;
    return { run, position: item.position };
  }
  return null;
}
function reduceFromStart(records: readonly DecodedRecord[], kernel: KernelExecutionBinding): RunState | null {
  const start = findTurnStart(records, kernel);
  if (start === null) return null;
  return applyEvents(createInitialRunState(start.run), records, kernel, start.position);
}
function applyEvents(state: RunState, records: readonly DecodedRecord[], kernel: KernelExecutionBinding, afterPosition: number): RunState {
  let next = state;
  for (const item of records) {
    if (item.position <= afterPosition) continue;
    if (item.record.recordType !== 'agent.event') continue;
    const event = item.record.payload.event;
    if (event.meta.runId !== kernel.runId || event.meta.turnId !== kernel.turnId) continue;
    next = reduceRunState(next, event);
  }
  return next;
}
function turnIsComplete(state: RunState): boolean {
  if (state.activeModelRequest !== null) return false;
  const batch = state.toolBatch;
  if (batch !== null) {
    if (batch.calls.some(call => !settledStatus(call.status))) return false;
  }
  return true;
}
function terminalEventOf(state: RunState, runRef: RunRef, sequence: number, eventId: string, now: string): RuntimeEventV1 | null {
  switch (state.status) {
    case 'completed':
      return { eventType: 'run_completed', schemaVersion: 1, eventId, runRef, sequence, occurredAt: now, payload: { kind: 'completed', exitCode: 0 } };
    case 'failed': {
      const message = state.outcome !== null && state.outcome !== undefined && state.outcome.kind === 'failed'
        ? state.outcome.failure.message : 'the Kernel run failed';
      return { eventType: 'run_crashed', schemaVersion: 1, eventId, runRef, sequence, occurredAt: now, payload: { kind: 'crashed', error: message } };
    }
    case 'cancelled':
      return { eventType: 'run_cancelled', schemaVersion: 1, eventId, runRef, sequence, occurredAt: now, payload: { kind: 'cancelled', reason: 'the Kernel run was cancelled' } };
    case 'limit_exceeded':
      return { eventType: 'run_budget_exhausted', schemaVersion: 1, eventId, runRef, sequence, occurredAt: now, payload: { kind: 'budget_exhausted', exhaustedAt: now } };
    case 'yielded': {
      // A yielded Turn is a genuine terminal: the platform records the real yield
      // reason, releases the Run occupancy and keeps the wait as platform fact.
      const reason = state.outcome !== null && state.outcome !== undefined && state.outcome.kind === 'yielded'
        ? state.outcome.yield.reason : 'reply_required';
      const pendingToolCallId = state.outcome !== null && state.outcome !== undefined && state.outcome.kind === 'yielded'
        ? state.outcome.yield.pendingToolCallId : null;
      return { eventType: 'run_yielded', schemaVersion: 1, eventId, runRef, sequence, occurredAt: now,
        payload: { kind: 'yielded', yield: { reason, requestedBy: 'app', yieldedAt: now, pendingToolCallId } } };
    }
    default:
      return null;
  }
}

type ControlAckKind = ControlObservationV1['kind'];

function sameRef(left: unknown, right: unknown): boolean {
  try { return canonicalJson(left as never) === canonicalJson(right as never); } catch { return false; }
}
function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
/**
 * The formal Kernel transcript outcome_unknown check. An empty (already
 * reduced) tool batch is NOT a known result: the transcript's official
 * `tool_result` with `error.code === 'outcome_unknown'` is still the evidence.
 * This is the ONE place that reads it; no second error interpreter exists.
 */
function transcriptHasOutcomeUnknown(transcript: RunState['transcript']): boolean {
  return transcript.some(entry => entry.kind === 'tool_result'
    && entry.result.status === 'error' && entry.result.error.code === 'outcome_unknown');
}
/** The original `agent.event` types that can carry an observation source. */
const CONTROL_SOURCE_EVENT_TYPES: readonly string[] = [
  'run.paused', 'run.resumed', 'run.cancelled', 'run.completed', 'run.failed', 'run.limit_exceeded', 'run.yielded', 'tool.outcome_unknown',
];
/**
 * Collect the control-source events that were ACTUALLY read in this pass, keyed
 * by type and filtered to this Run's fixed Turn. An event from another Turn of
 * the same Session is never retained.
 */
function collectControlSources(
  decoded: readonly DecodedRecord[], kernel: KernelExecutionBinding,
): CachedControlSources {
  const sources: CachedControlSources = {};
  for (const item of decoded) {
    if (item.record.recordType !== 'agent.event') continue;
    const event = item.record.payload.event;
    if (event.meta.runId !== kernel.runId || event.meta.turnId !== kernel.turnId) continue;
    if (event.type === 'run.input_accepted') {
      const source = event.payload.input.sourceRef;
      if (isRecord(source) && source['kind'] === 'ControlIntent' && isRecord(source['intentRef'])) {
        const intentRef = source['intentRef'] as ControlIntentRef;
        sources['input:' + canonicalJson(intentRef as never)] = {
          position: item.position, eventId: event.meta.eventId, kernelEventSequence: event.meta.sequence, inputIntentRef: intentRef,
        };
      }
      continue;
    }
    if (!CONTROL_SOURCE_EVENT_TYPES.includes(event.type)) continue;
    if (!nonEmpty(event.meta.eventId) || !isNonNegativeInteger(event.meta.sequence)) continue;
    sources[event.type] = { position: item.position, eventId: event.meta.eventId, kernelEventSequence: event.meta.sequence };
  }
  return sources;
}
/**
 * The source for one ack kind. Prefer the exact events read in this pass; fall
 * back to the retained original sources of the SAME Run/Turn when a previous
 * public observe already reduced them and this pass only saw an empty
 * increment. `runId`/`turnId` are filtered on BOTH paths and an ended Run is
 * bounded to its fixed terminal window by the caller.
 */
function controlSourceRecord(
  decoded: readonly DecodedRecord[],
  cached: CachedControlSources | undefined,
  kernel: KernelExecutionBinding,
  kind: ControlAckKind,
  state: RunState,
): ControlSource | undefined {
  const wanted = kind === 'paused' ? ['run.paused']
    : kind === 'cancelled' ? ['run.cancelled']
      : kind === 'outcome_unknown' ? ['tool.outcome_unknown']
        : state.status === 'completed' ? ['run.completed']
          : state.status === 'failed' ? ['run.failed']
            : ['run.limit_exceeded'];
  for (let index = decoded.length - 1; index >= 0; index -= 1) {
    const item = decoded[index];
    if (item === undefined || item.record.recordType !== 'agent.event') continue;
    const event = item.record.payload.event;
    if (event.meta.runId !== kernel.runId || event.meta.turnId !== kernel.turnId) continue;
    if (!wanted.includes(event.type)) continue;
    if (!nonEmpty(event.meta.eventId) || !isNonNegativeInteger(event.meta.sequence)) continue;
    return { position: item.position, eventId: event.meta.eventId, kernelEventSequence: event.meta.sequence };
  }
  if (cached !== undefined) {
    for (const type of wanted) {
      const source = cached[type];
      if (source !== undefined) return source;
    }
  }
  return undefined;
}

export function createExecutionObservation(deps: ExecutionObservationDependencies): ExecutionObservationService {
  const cache = new Map<string, CachedTurn>();
  const pendingTerminals = new Map<string, PendingTerminal>();
  const pendingAcks = new Map<string, PendingControlAck>();
  const owner = createSessionHistoryCursorOwner({ kernelStores: deps.kernelStores });

  /**
   * Persist ONE real control observation from the ALREADY reduced original
   * history. The intent association comes from the live handle that actually
   * executed the safe point; the source event position/identity come from the
   * original SessionRecord. The persisted Run locator is the authority for the
   * window, and a request whose commit result was unknown keeps its exact
   * observation/time/pins/requestId so a later observe recovers the receipt.
   */
  async function recordControlAck(
    ctx: CoreCallContext,
    runRef: RunRef,
    auth: ExecutionAuthorizationV2,
    sourceItem: ControlSource,
    intentRef: ControlIntentRef,
    kind: ControlAckKind,
  ): Promise<void> {
    const controls = deps.controls;
    if (controls === undefined) return;
    // The complete Run/intent identity keys the pending request; a serialization
    // failure never degrades to a bare runId.
    let ackKey: string;
    try { ackKey = canonicalJson({ runRef, intentRef, kind } as never); }
    catch { return; }
    let pending = pendingAcks.get(ackKey);
    if (pending === undefined) {
      let current;
      try { current = await controls.readControl(ctx, intentRef); }
      catch { return; }
      if (current.status !== 'ready') return;
      // A later observation already recorded this intent: never duplicate it.
      if (current.value.status !== 'queued') return;
      if (!sameRef(current.value.runRef, runRef)) return;
      let runRead;
      try { runRead = await deps.executions.readExecution(ctx, runRef); }
      catch { return; }
      if (runRead.status !== 'ready') return;
      const persisted = runRead.value.run.executionHistory;
      if (persisted === undefined || !isRunExecutionHistoryV1(persisted)) return;
      // The observation history is the PERSISTED window, never a self-reported
      // one, and the already-read source must fit inside it.
      const persistedThrough = persisted.endPosition ?? persisted.observedThroughPosition;
      if (sourceItem.position < persisted.startPosition || sourceItem.position > persistedThrough) return;
      const observation: ControlObservationV1 = {
        schemaVersion: 1, kind,
        entry: { consumerId: auth.consumerId, entryGeneration: auth.generation, sessionGeneration: auth.sessionGeneration },
        history: {
          schemaVersion: 1,
          sessionRef: { projectId: persisted.sessionRef.projectId, sessionId: persisted.sessionRef.sessionId },
          kernel: { ...persisted.kernel }, startPosition: persisted.startPosition,
          observedThroughPosition: persistedThrough,
          endPosition: kind === 'paused' || kind === 'resumed' || kind === 'steered' || kind === 'outcome_unknown' ? null : persistedThrough,
        },
        source: { ...persisted.kernel, position: sourceItem.position },
        kernelEventId: sourceItem.eventId, kernelEventSequence: sourceItem.kernelEventSequence, observedAt: deps.now(),
      };
      pending = {
        observation,
        requestId: `r4-control-observation:${runRef.runId}:${intentRef.intentId}:${kind}`,
        expected: [
          { ref: intentRef, revision: current.value.revision },
          { ref: runRef, revision: runRead.value.run.revision },
        ],
      };
      pendingAcks.set(ackKey, pending);
    } else {
      // A retry of the SAME unconfirmed request: its exact identity/fingerprint
      // is preserved. Only clear it when the intent is no longer queued.
      let current;
      try { current = await controls.readControl(ctx, intentRef); }
      catch { return; }
      if (current.status !== 'ready' || current.value.status !== 'queued'
        || !sameRef(current.value.runRef, runRef)) {
        pendingAcks.delete(ackKey);
        return;
      }
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let result;
      try {
        result = await controls.recordControlObservation(ctx, {
          input: { intentRef, runRef, observation: pending.observation },
          meta: { requestId: pending.requestId, expected: pending.expected },
        });
      } catch {
        // Unknown commit result: keep the exact pending request for recovery.
        return;
      }
      if (result.status === 'committed') {
        pendingAcks.delete(ackKey);
        return;
      }
      // A concurrent observer may have advanced the intent/Run pin without an
      // unknown commit; rebind the current pins and retry the SAME request once.
      if (result.status === 'rejected' && result.code === 'revision_conflict') {
        const refreshed = await refreshAckPins(ctx, intentRef, runRef);
        if (refreshed === null) return;
        pending = { ...pending, expected: refreshed };
        pendingAcks.set(ackKey, pending);
        continue;
      }
      return;
    }
  }

  /** Rebind the current intent/Run revisions for a genuine conflict retry. */
  async function refreshAckPins(
    ctx: CoreCallContext, intentRef: ControlIntentRef, runRef: RunRef,
  ): Promise<VersionPin[] | null> {
    const controls = deps.controls;
    if (controls === undefined) return null;
    try {
      const current = await controls.readControl(ctx, intentRef);
      if (current.status !== 'ready' || current.value.status !== 'queued') return null;
      if (!sameRef(current.value.runRef, runRef)) return null;
      const runRead = await deps.executions.readExecution(ctx, runRef);
      if (runRead.status !== 'ready') return null;
      return [
        { ref: intentRef, revision: current.value.revision },
        { ref: runRef, revision: runRead.value.run.revision },
      ];
    } catch { return null; }
  }

  async function consumedIntentKind(ctx: CoreCallContext, ref: ControlIntentRef): Promise<import('../../contracts/control-intent.js').ControlIntentKindV1 | null> {
    const controls = deps.controls;
    if (controls === undefined) return null;
    try {
      const read = await controls.readControl(ctx, ref);
      return read.status === 'ready' ? read.value.kind : null;
    } catch { return null; }
  }

  /** Resume and steering acknowledge a saved context event, not stopped work.
   * Steer carries its original intent in the event; resume uses the exact
   * intent bound to this invocation, separately from a later stop request. */
  async function acknowledgeContextControls(
    ctx: CoreCallContext, runRef: RunRef, auth: ExecutionAuthorizationV2,
    sources: CachedControlSources, resumeIntentRef?: ControlIntentRef,
  ): Promise<void> {
    const resumed = sources['run.resumed'];
    if (resumeIntentRef !== undefined && resumed !== undefined) {
      await recordControlAck(ctx, runRef, auth, resumed, resumeIntentRef, 'resumed');
    }
    for (const source of Object.values(sources)) {
      if (source?.inputIntentRef !== undefined) {
        await recordControlAck(ctx, runRef, auth, source, source.inputIntentRef, 'steered');
      }
    }
  }

  return {
    async observe(ctx: CoreCallContext, request: ObserveTaskRunRequest): Promise<ReadResult<TaskExecutionRecord>> {
      const owned = ownContext(ctx);
      if (owned === null) return rejected('invalid', 'the call context cannot be isolated from the caller');
      const signal = owned.signal;
      if (signal.aborted) return rejected('cancelled', 'the observation was cancelled before the execution read');
      const rawRunRef = request?.runRef;
      if (!isRecord(rawRunRef) || rawRunRef['aggregateType'] !== 'Run' || !nonEmpty(rawRunRef['projectId'])
        || !nonEmpty(rawRunRef['goalId']) || !nonEmpty(rawRunRef['runId'])) {
        return rejected('invalid', 'observeRun requires a complete RunRef');
      }
      let runRef;
      try { runRef = structuredClone(rawRunRef); } catch { return rejected('invalid', 'the observe request cannot be isolated from the caller'); }
      if (runRef.projectId !== owned.projectId) return rejected('forbidden', 'the Run belongs to another project');

      let read;
      try {
        read = await deps.executions.readExecution(owned, runRef);
      } catch (error) {
        return rejected('unavailable', `the execution read failed: ${messageOf(error)}`);
      }
      if (read.status !== 'ready') return mapRead(read);
      const record = read.value;
      const cacheKey = canonicalJson(runRef as never);
      // A genuinely persisted end is already reconciled: never rerun and never
      // rewrite it. Run ended is not Task satisfaction. The per-Run reduction
      // cache may only exist because an earlier terminal commit response was
      // lost or another observer persisted it, so both local caches are dropped
      // here; the persistent Run locator remains the only history source. A late
      // observe may still complete a missing control ack from that locator: it
      // never rewrites the result and never starts a model call.
      const alreadyEnded = record.run.status === 'ended';
      if (alreadyEnded) {
        cache.delete(cacheKey);
        pendingTerminals.delete(cacheKey);
      }
      const locator: RunExecutionHistoryV1 | undefined = record.run.executionHistory;
      if (locator === undefined) return { status: 'ready', value: record };
      if (!isRunExecutionHistoryV1(locator)) return rejected('unavailable', 'the persisted execution-history locator is malformed');
      if (locator.sessionRef.projectId !== record.outbox.claim.sessionRef.projectId
        || locator.sessionRef.sessionId !== record.outbox.claim.sessionRef.sessionId
        || locator.kernel.adapterId !== record.session.kernel.adapterId
        || locator.kernel.kernelSessionId !== record.session.kernel.kernelSessionId) {
        return rejected('unavailable', 'the persisted locator disagrees with the claim Session mapping');
      }
      const auth = record.run.executionAuthorization;
      if (auth === undefined || !('schemaVersion' in auth) || auth.schemaVersion !== 2) {
        // No formal V2 binding yet: there is no Kernel run to reconcile.
        return { status: 'ready', value: record };
      }
      const v2Auth: ExecutionAuthorizationV2 = auth;
      const authUsable = v2Auth.phase === 'entered' || (alreadyEnded && v2Auth.phase === 'settled');
      if (!authUsable) {
        // An entering/unknown binding has no reconciled Kernel history yet.
        return { status: 'ready', value: record };
      }
      if (signal.aborted) return rejected('cancelled', 'the observation was cancelled before reading the history window');

      const cached = cache.get(cacheKey);
      const from = cached === undefined ? Math.max(0, locator.startPosition - 1) : cached.reducedThrough;
      // Read the frozen tail page by page; each page keeps the first page's
      // throughPosition so observed growth never widens this reconciliation.
      const decoded: DecodedRecord[] = [];
      let expected = from + 1;
      let cursor = from;
      // An ended Run only ever re-reads its fixed terminal window; a live Run
      // freezes the first page's throughPosition so observed growth never
      // widens this reconciliation.
      let frozenThrough: number | null = alreadyEnded ? (locator.endPosition ?? locator.observedThroughPosition) : null;
      let entries: SessionHistoryEntry[] = [];
      for (let page = 0; page < MAX_OBSERVATION_PAGES; page += 1) {
        let window;
        try {
          window = await owner.readPositionWindow({ session: record.session, afterPosition: cursor, throughPosition: frozenThrough, limit: 200, signal });
        } catch (error) {
          return rejected('unavailable', `the bounded history window read failed: ${messageOf(error)}`);
        }
        if (window.status !== 'ready') return mapRead(window);
        frozenThrough = window.value.throughPosition;
        for (const entry of window.value.entries) {
          const item = decodeEntry(entry);
          if (item === null) return rejected('unavailable', 'a raw history entry is damaged or not a Kernel Session record');
          if (item.position !== expected) return rejected('unavailable', 'the Kernel history positions are not contiguous');
          expected += 1;
          decoded.push(item);
          entries.push(entry);
        }
        cursor = window.value.nextPosition;
        if (!window.value.hasMore) break;
        if (page === MAX_OBSERVATION_PAGES - 1) return rejected('capacity', 'the Turn history exceeds the bounded observation page budget');
      }
      const reducedThrough = decoded.at(-1)?.position ?? from;
      let state: RunState;
      try {
        if (cached === undefined) {
          const built = reduceFromStart(decoded, locator.kernel);
          if (built === null) return rejected('unavailable', 'the fixed turn.started record was not present at the locator start');
          state = built;
        } else {
          state = applyEvents(cached.state, decoded, locator.kernel, cached.reducedThrough);
        }
        const invariants = validateRunStateInvariants(state);
        if (!invariants.ok) return rejected('unavailable', `the reduced Turn violates Kernel invariants: ${invariants.message}`);
      } catch (error) {
        return rejected('unavailable', `reducing the complete Turn failed: ${messageOf(error)}`);
      }
      // A committed run.input_accepted is the ONLY confirmation that an original
      // source part entered execution; the narrow owner write records it without
      // claiming any business processing.
      const inputsConfirmed = await confirmMailboxInputs(deps.messages, owned, runRef, locator.kernel, decoded);
      if (!inputsConfirmed) {
        return rejected('unavailable', 'the accepted input is saved in Kernel history but its source acknowledgement is not confirmed');
      }
      const observedControlSources = collectControlSources(decoded, locator.kernel);
      const retainedControlSources: CachedControlSources = { ...(cached?.controlSources ?? {}), ...observedControlSources };
      // Never advance past an accepted-input event whose narrow owner write did
      // not confirm (replayed or committed); the same event is re-read and retried.
      if (inputsConfirmed) {
        cache.set(cacheKey, { startPosition: locator.startPosition, reducedThrough, state, controlSources: retainedControlSources });
      }

      // The private proof comes from the SAME coordinator/driver instance. A
      // positive pause/cancel conclusion needs the Kernel call to have exited
      // AND every owned resource to be closed; absent means "not proven".
      const proof = deps.control?.proof(runRef);
      const consumedIntentRef = proof?.consumedIntentRef;
      const cleanProof = proof?.kernelExited === true && proof.resourcesClosed?.status === 'completed';

      const isTerminal = state.status === 'completed' || state.status === 'failed'
        || state.status === 'cancelled' || state.status === 'limit_exceeded'
        || state.status === 'yielded';
      if (!isTerminal) {
        pendingTerminals.delete(cacheKey);
        // The observed window is persisted BEFORE any positive ack, so the Run
        // locator is the durable authority the ack is checked against. A paused
        // Turn may still hold a not-yet-started next group, so it never requires
        // a complete transcript; it is only acknowledged after the consumed
        // intent's live handle proves Kernel exit + cleanup.
        if (!alreadyEnded) await advanceLocator(owned, runRef, reducedThrough);
        await acknowledgeContextControls(owned, runRef, v2Auth, retainedControlSources, proof?.resumeIntentRef);
        if (state.status === 'paused' && consumedIntentRef !== undefined && cleanProof) {
          const sourceItem = controlSourceRecord(decoded, cached?.controlSources, locator.kernel, 'paused', state);
          if (sourceItem !== undefined) {
            await recordControlAck(owned, runRef, v2Auth, sourceItem, consumedIntentRef, 'paused');
          }
        }
        return { status: 'ready', value: record };
      }
      // A terminal status is only evidence when the complete Turn is settled and
      // no result is genuinely unknown. A reducer-proven `abandoned` call is
      // different: it is a declared-but-never-started call with no result, and
      // R4.3b consumes it through the shared pure projection. A formal
      // outcome_unknown (batch or transcript) keeps the real occupancy.
      const unknownInBatch = state.toolBatch !== null
        && state.toolBatch.calls.some(call => call.status === 'outcome_unknown');
      const transcriptUnknown = transcriptHasOutcomeUnknown(state.transcript);
      const abandonedInBatch = state.toolBatch !== null
        && state.toolBatch.calls.some(call => call.status === 'abandoned');
      if ((!turnIsComplete(state) && !abandonedInBatch) || unknownInBatch || transcriptUnknown) {
        // Keep the real unknown side effect and occupancy; record the provable
        // unknown observation but never an applied cancellation or a release.
        // The nonterminal window is persisted before the unknown ack.
        if (!alreadyEnded) await advanceLocator(owned, runRef, reducedThrough);
        if (consumedIntentRef !== undefined && cleanProof) {
          const sourceItem = controlSourceRecord(decoded, cached?.controlSources, locator.kernel, 'outcome_unknown', state);
          if (sourceItem !== undefined) {
            await recordControlAck(owned, runRef, v2Auth, sourceItem, consumedIntentRef, 'outcome_unknown');
          }
        }
        return { status: 'ready', value: record };
      }
      // The model-facing transcript is ALWAYS the shared Kernel projection: an
      // abandoned terminal Turn drops only the never-started declarations from a
      // COPY, and every other known terminal still passes the same genuine-unknown
      // criterion (a formal outcome_unknown result is never consumable). The
      // original state/records stay untouched. A projection that cannot be
      // consumed keeps the real occupancy and never fabricates an applied release.
      let consumableTranscript: RunState['transcript'];
      try {
        consumableTranscript = projectTerminalTranscript(state);
        assertTranscriptExchangeIntegrity(consumableTranscript, `b2-runtime:${runRef.runId}`);
      } catch {
        return { status: 'ready', value: record };
      }
      if (alreadyEnded) {
        await acknowledgeContextControls(owned, runRef, v2Auth, retainedControlSources, proof?.resumeIntentRef);
        // The terminal result was already recorded by an earlier observer. Only
        // complete the missing control ack from the fixed terminal window.
        if (consumedIntentRef !== undefined && cleanProof) {
          const intentKind = await consumedIntentKind(owned, consumedIntentRef);
          const ackKind: ControlAckKind | null = intentKind === 'cancel'
            ? (state.status === 'cancelled' ? 'cancelled' : 'terminal_without_cancel') : null;
          if (ackKind !== null) {
            const sourceItem = controlSourceRecord(decoded, cached?.controlSources, locator.kernel, ackKind, state);
            if (sourceItem !== undefined) {
              await recordControlAck(owned, runRef, v2Auth, sourceItem, consumedIntentRef, ackKind);
            }
          }
        }
        return { status: 'ready', value: record };
      }
      // The terminal source is the last genuine record; when a prior submission
      // is still unconfirmed and no new record arrived, its exact boundary and
      // content are reused, so the same request fingerprint is retried.
      const prior = pendingTerminals.get(cacheKey);
      const endPosition = decoded.at(-1)?.position ?? prior?.endPosition;
      if (endPosition === undefined) return rejected('unavailable', 'the terminal history position is not known');
      let submission: PendingTerminal;
      if (prior !== undefined && prior.endPosition === endPosition) {
        submission = prior;
      } else {
        const boundaryEntry = entries.find(entry => entry.source.position === endPosition);
        if (boundaryEntry === undefined) return rejected('unavailable', 'the terminal history entry has no canonical cursor');
        const event = terminalEventOf(state, runRef, record.run.lastEventSeq + 1, deps.newId(), deps.now());
        if (event === null) return { status: 'ready', value: record };
        const history: ObservedExecutionHistory = {
          kernel: { ...locator.kernel }, startPosition: locator.startPosition,
          observedThroughPosition: endPosition, endPosition,
        };
        // The yielded terminal carries the original Task/Session and the exact
        // saved wait message. It is the durable continuation binding a later
        // Attempt consumes; absence keeps every non-yield terminal unchanged.
        const continuation = state.status === 'yielded' ? deps.control?.continuation(runRef) : undefined;
        submission = {
          endPosition,
          requestId: `b2-result:${runRef.runId}:${String(endPosition)}`,
          observation: {
            claim: record.outbox.claim,
            entry: { consumerId: auth.consumerId, entryGeneration: auth.generation },
            event,
            kernelSource: { ...locator.kernel, position: endPosition },
            completedHistoryBoundary: { source: { ...locator.kernel, position: endPosition }, cursor: boundaryEntry.cursor },
            history,
            ...(continuation === undefined ? {} : { continuation }),
          },
        };
        pendingTerminals.set(cacheKey, submission);
      }
      // The exact original submission is saved BEFORE the proof gate, so a
      // public observe that read the terminal while owned cleanup was still in
      // flight can retry this SAME request (same boundary/cursor/event/time)
      // once the live proof completes; no terminal is recreated.
      // The Kernel terminal is genuine, but when this Runtime owns the raw
      // controls the SAME live proof gates the terminal writer and every
      // positive ack: the Kernel call must have exited AND every owned resource
      // must have closed. Absence/failure keeps the real occupancy.
      if (deps.controls !== undefined && !cleanProof) {
        return { status: 'ready', value: record };
      }
      let written;
      try {
        written = await deps.entry.recordRunResult(owned, {
          input: submission.observation,
          meta: { requestId: submission.requestId, expected: [{ ref: runRef, revision: record.run.revision }] },
        });
      } catch (error) {
        return rejected('unavailable', `recording the terminal result failed: ${messageOf(error)}`);
      }
      if (written.status !== 'committed') return mapRead(written);
      await acknowledgeContextControls(owned, runRef, v2Auth, retainedControlSources, proof?.resumeIntentRef);
      // The terminal is confirmed: this Run no longer needs any in-memory
      // reduction state, and the next observation reads the persisted Run.
      cache.delete(cacheKey);
      pendingTerminals.delete(cacheKey);
      // After the real terminal is recorded (and the same generation released),
      // the consumed intent gets its real observation. A natural
      // completed/failed/limit keeps its outcome and only marks a queued cancel
      // terminal_without_cancel/superseded.
      if (consumedIntentRef !== undefined) {
        const intentKind = await consumedIntentKind(owned, consumedIntentRef);
        const ackKind: ControlAckKind | null = intentKind === 'cancel'
          ? (state.status === 'cancelled' ? 'cancelled' : 'terminal_without_cancel') : null;
        if (ackKind !== null) {
          const sourceItem = controlSourceRecord(decoded, cached?.controlSources, locator.kernel, ackKind, state);
          if (sourceItem !== undefined) {
            await recordControlAck(owned, runRef, v2Auth, sourceItem, consumedIntentRef, ackKind);
          }
        }
      }
      const finalRead = await deps.executions.readExecution(owned, runRef);
      return finalRead.status === 'ready' ? { status: 'ready', value: finalRead.value } : mapRead(finalRead);
    },
  };

  /** A live observation may only persist a monotone nonterminal window; the
   * terminal is recorded exactly once by recordRunResult above. The current Run
   * is re-read so the CAS uses the revision that is actually durable. */
  async function advanceLocator(ctx: CoreCallContext, runRef: RunRef, observedThrough: number): Promise<void> {
    let read;
    try { read = await deps.executions.readExecution(ctx, runRef); }
    catch { return; }
    if (read.status !== 'ready') return;
    const locator = read.value.run.executionHistory;
    if (locator === undefined || !isRunExecutionHistoryV1(locator)) return;
    if (observedThrough <= locator.observedThroughPosition) return;
    try {
      await deps.historyWriter.recordExecutionHistory(ctx, {
        input: { runRef, kernel: { ...locator.kernel }, startPosition: locator.startPosition, observedThroughPosition: observedThrough, endPosition: null },
        meta: { requestId: `b2-observe:${runRef.runId}:${String(observedThrough)}`, expected: [{ ref: runRef, revision: read.value.run.revision }] },
      });
    } catch {
      // A concurrent observer may have advanced the same monotone watermark; a
      // genuine write failure is retried by the next observation.
    }
  }
}
