/**
 * B2 AgentRuntime factory.
 *
 * With the trusted dependency bundle the factory wires the real bounded
 * preparation, fresh execution driver, incremental observation services and the
 * ONE internal control coordinator. A no-argument call keeps the previous N0
 * behavior and returns an explicit `unsupported` for every member: the factory
 * never fabricates a capability and never starts a Kernel/provider call.
 *
 * The Session creation/original-history members are still declared only so the
 * composition root can override them with the accepted RT1/RT7/RT8
 * implementations.
 */
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { WorkspaceScope } from '../../contracts/core/identity.js';
import type { SessionRef } from '../../contracts/core/identity.js';
import type { OperationReceipt, Page, ReadResult } from '../../contracts/core/results.js';
import type { SessionRecord } from '../../contracts/core/session.js';
import type { RunRef } from '../../contracts/dispatch.js';
import type { TaskRequeueRef } from '../../contracts/task-requeue.js';
import { GOAL_FAN_OUT_ACTOR, reworkActorClassOf } from '../../contracts/task-requeue.js';
import { StoreError } from '../../../vendor/coding-agent/dist/public-api.js';
import { createExecutionDriver } from './execution-driver.js';
import { createExecutionObservation } from './execution-observation.js';
import { createRuntimeControlCoordinator } from './execution-control.js';
import { createExecutionPreparation, loadPreparedManifest, rehydratePreparedExecution } from './execution-preparation.js';
import { createContextAssembler } from './context-assembler.js';
import { continuationBriefDigest } from '../../contracts/continuation-brief.js';
import { createSessionHistoryCursorOwner, kernelDatabaseState, type SessionHistoryCursorOwner } from './session-operations.js';
import { createArchiveChangedFilesReader } from './session-anomaly-facts.js';
import { bookLateEvidenceInProcess, stopPausedRunInProcess } from './run-reconcile.js';
import { isPausedInterrupted } from '../work-graph/state/run-machine.js';
import { createQueryPreparation } from './query-preparation.js';
import { createQueryExecutionDriver } from './query-execution.js';
import { createQueryObservation } from './query-observation.js';
import type { RuntimeExecutionDependencies, TurnClosureDependencies } from './execution-contracts.js';
import type { AgentRuntimeService, RuntimeExecutionPort } from './ports.js';
import type { RuntimeCapabilities } from './contracts.js';
import type { CreateSessionRequest, SessionHistoryEntry, SessionHistoryRequest } from './session-operations.js';
import { readRunActivityFacts, unknownFacts } from './run-activity-reader.js';
import { provenNotEnteredKernel } from '../../contracts/run-activity.js';
import { isRunExecutionHistoryV1 } from '../work-graph/persistence/execution-history-codecs.js';
import type {
  ExecutionHistoryPage, ExecutionHistoryRequest, TaskExecutionHistoryRequest,
} from './execution-history-contracts.js';

const unsupported = (reason: string) => ({
  status: 'rejected' as const, code: 'unsupported' as const, reason,
});

const ABSENT = 'B2 AgentRuntime requires the trusted dependency bundle before it can do any execution work';

function basePort(): RuntimeExecutionPort {
  return {
    async capabilities(_ctx: CoreCallContext, _workspace: WorkspaceScope): Promise<ReadResult<RuntimeCapabilities>> {
      return unsupported('B2 AgentRuntime execution capabilities are not wired');
    },
    async createSession(_ctx: CoreCallContext, _request: CreateSessionRequest): Promise<OperationReceipt<SessionRecord>> {
      return unsupported(ABSENT);
    },
    async readSessionHistory(_ctx: CoreCallContext, _request: SessionHistoryRequest): Promise<ReadResult<Page<SessionHistoryEntry>>> {
      return unsupported(ABSENT);
    },
    async readExecutionHistory(_ctx: CoreCallContext, _request: ExecutionHistoryRequest): Promise<ReadResult<ExecutionHistoryPage>> {
      return unsupported(ABSENT);
    },
    async readTaskExecutionHistory(_ctx: CoreCallContext, _request: TaskExecutionHistoryRequest): Promise<ReadResult<ExecutionHistoryPage>> {
      return unsupported(ABSENT);
    },
    async prepareExecution() {
      return unsupported('B2 skeleton: prepareExecution is not implemented');
    },
    async startRun() {
      return unsupported('B2 skeleton: startRun is not implemented');
    },
    async observeRun() {
      return unsupported('B2 skeleton: observeRun is not implemented');
    },
    async deliverControl() {
      return unsupported('R4.3a skeleton: deliverControl is not implemented');
    },
    async prepareQuery() {
      return unsupported('R5b.2 skeleton: prepareQuery is not implemented');
    },
    async startQuery() {
      return unsupported('R5b.2 skeleton: startQuery is not implemented');
    },
    async observeQuery() {
      return unsupported('R5b.2 skeleton: observeQuery is not implemented');
    },
    async readAttentionGraph() {
      return unsupported('B2 skeleton: readAttentionGraph is not implemented');
    },
  };
}

type TurnClosureOutcome =
  | { status: 'closed' | 'already_closed'; health: 'available' | 'unavailable' }
  | { status: 'refused'; reason: 'lease' | 'not_closable_run' | 'continuation_not_authorized' | 'archived'
      | 'archive_requested' | 'occupied' | 'handed_over' | 'health' }
  | { status: 'unsupported' | 'unreadable' | 'mismatch' | 'conflict' | 'transient'; reason: string };

/** A read/probe failure of the closure; it never fabricates a success (rule 3). */
function closureFailure(error: unknown, signal: AbortSignal): TurnClosureOutcome {
  if (signal.aborted) return { status: 'transient', reason: 'the closure call was cancelled' };
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof StoreError
    && (error.code === 'not_found' || error.code === 'corrupt' || error.code === 'invalid_record'
      || error.code === 'version_unsupported')) {
    return { status: 'unreadable', reason: message };
  }
  return { status: 'transient', reason: message };
}

/**
 * L4 steps 1/3, L7 (D5): a returned platform-read rejection keeps its own
 * retryability. A retryable code (`unavailable`, `cancelled`, `busy`) is the
 * retryable `transient` the caller re-walks, never `unreadable` (a definite
 * failure that would take the L8 new-Session fallback).
 */
const RETRYABLE_READ_CODES: ReadonlySet<string> = new Set(['unavailable', 'cancelled', 'busy']);

function platformReadFailure(read: { code: string; reason: string }): TurnClosureOutcome {
  return RETRYABLE_READ_CODES.has(read.code)
    ? { status: 'transient', reason: read.reason }
    : { status: 'unreadable', reason: read.reason };
}

/**
 * K slice L4 (M1-M3): the Runtime `closeOpenTurn` operation. It first re-proves
 * the platform Run and the authorization, then the Session facts, then the
 * SES-13 health conclusion, and only then opens the registered Kernel store and
 * asks the public `closeOpenTurn` seam (read from the injected Kernel dependency
 * at call time, M2). A closed/already-closed Turn is re-probed and handed to the
 * health owner under the incoming Host call identity (M3).
 */
function createCloseOpenTurn(
  deps: RuntimeExecutionDependencies, owner: SessionHistoryCursorOwner,
): NonNullable<RuntimeExecutionPort['closeOpenTurn']> {
  type RefusalReason = Extract<TurnClosureOutcome, { status: 'refused' }>['reason'];
  const refusal = (reason: RefusalReason): TurnClosureOutcome => ({ status: 'refused', reason });

  /** RUN-24 authorization: the TaskRequeue covers the afterRun and its requester
   * is a person or the Goal-resume fan-out. The plan is the only place the
   * requester is recorded, so a read that proves nothing refuses (rule 3): it
   * must never allow a closure it cannot authorize. */
  async function requeueAuthorizes(
    ctx: CoreCallContext, taskId: string, afterRunRef: RunRef, requeueRef: TaskRequeueRef,
  ): Promise<boolean> {
    if (requeueRef.projectId !== afterRunRef.projectId || requeueRef.goalId !== afterRunRef.goalId
      || requeueRef.taskId !== taskId || requeueRef.afterRunId !== afterRunRef.runId) return false;
    try {
      const read = await deps.plans.queryTaskGraph(ctx, { goalRef: { aggregateType: 'Goal',
        projectId: afterRunRef.projectId, goalId: afterRunRef.goalId } });
      if (read.status !== 'ready') return false;
      const row = read.value.tasks.find((candidate) => candidate.ref.taskId === taskId);
      const entry = row?.rework?.entries.find((candidate) => candidate.ref.afterRunId === afterRunRef.runId);
      if (entry === undefined) return false;
      if (reworkActorClassOf(null, entry.requestedBy) === 'human') return true;
      return entry.requestedBy.kind === 'system' && entry.requestedBy.id === GOAL_FAN_OUT_ACTOR.id;
    } catch { return false; }
  }

  /**
   * L4 step 3: a recorded successor Session whose provenance points at this one.
   * `none` only when the enumeration completed; an unusable or partial
   * enumeration is `unusable` so the caller fails closed and never closes a
   * handed-over line (rule 3). Archived Sessions count, and both successor
   * provenance kinds (`continuation` and `handoff`) count — the spec's
   * "来历指向它的"; a `readonly_copy` is a read-only derivation, not a successor
   * (`session-responsibility-service.ts`).
   */
  async function recordedSuccessor(ctx: CoreCallContext, session: SessionRecord): Promise<'found' | 'none' | 'unusable'> {
    try {
      let cursor: string | undefined;
      for (let page = 0; page < 8; page += 1) {
        const found = await deps.sessions.findSessions(ctx, {
          workspace: { projectId: session.ref.projectId, workspaceId: session.workspaceId },
          includeArchived: true, page: { limit: 100, ...(cursor === undefined ? {} : { cursor }) } });
        if (found.status !== 'ready') return 'unusable';
        for (const card of found.value.items) {
          const provenance = card.record.provenance ?? null;
          if (provenance !== null && (provenance.kind === 'continuation' || provenance.kind === 'handoff')
            && provenance.from.projectId === session.ref.projectId
            && provenance.from.sessionId === session.ref.sessionId) return 'found';
        }
        cursor = found.value.nextCursor ?? undefined;
        if (cursor === undefined) return 'none';
      }
    } catch { return 'unusable'; }
    // The page bound was hit with a cursor still to follow: the successor set is
    // not proven complete, so it is not "no successor".
    return 'unusable';
  }

  async function settleHealth(
    ctx: CoreCallContext, session: SessionRecord, closure: TurnClosureDependencies,
    status: 'closed' | 'already_closed',
  ): Promise<TurnClosureOutcome> {
    let probe;
    try { probe = await owner.probe({ session, signal: ctx.signal }); }
    catch { return { status, health: 'unavailable' }; }
    if (probe.verdict !== 'ready' || probe.activeRunId !== null) return { status, health: 'unavailable' };
    try {
      const written = await closure.recordSessionHealth(ctx, {
        sessionRef: { projectId: session.ref.projectId, sessionId: session.ref.sessionId },
        probe: { verdict: 'ready', activeRunId: null } });
      return { status, health: written.status === 'observed' || written.status === 'unchanged' ? 'available' : 'unavailable' };
    } catch { return { status, health: 'unavailable' }; }
  }

  return async (ctx, input) => {
    const closure = deps.turnClosure;
    if (closure === undefined) return { status: 'unsupported', reason: 'the Runtime does not publish closeOpenTurn' };
    if (closure.lease !== 'owned') return refusal('lease');
    const { sessionRef, afterRunRef, requeueRef } = input;
    // 1. Run
    let read;
    try { read = await deps.executions.readExecution(ctx, afterRunRef); }
    catch (error) { return closureFailure(error, ctx.signal); }
    if (read.status === 'not_found') return { status: 'unreadable', reason: 'the afterRun does not exist' };
    if (read.status === 'rejected') return platformReadFailure(read);
    if (read.status !== 'ready') return { status: 'unreadable', reason: 'the afterRun is not ready' };
    const record = read.value;
    const run = record.run;
    if (run.status !== 'ended' || run.outcome === null || run.outcome === 'outcome_unknown') return refusal('not_closable_run');
    const claim = record.outbox.claim.sessionRef;
    if (claim.projectId !== sessionRef.projectId || claim.sessionId !== sessionRef.sessionId) return refusal('not_closable_run');
    // 2. ending mode and authorization
    const observation = run.reconciliation?.observation;
    const pausedInterrupted = isPausedInterrupted(run);
    const run19 = run.outcome === 'crashed' && observation !== undefined
      && observation.kind === 'interrupted_clean' && observation.pausedIntentRef === null;
    const run23 = run.outcome === 'cancelled' && observation !== undefined
      && observation.kind === 'interrupted_clean' && observation.pausedIntentRef === null;
    const run22 = run.outcome === 'crashed' && observation !== undefined && observation.kind === 'human_attested';
    if (pausedInterrupted) {
      if (requeueRef === null || !(await requeueAuthorizes(ctx, run.task.taskId, afterRunRef, requeueRef))) {
        return refusal('continuation_not_authorized');
      }
    } else if (!(run19 || run23 || run22)) {
      return refusal('not_closable_run');
    }
    // 3. Session facts
    let card;
    try { card = await deps.sessions.readSession(ctx, sessionRef); }
    catch (error) { return closureFailure(error, ctx.signal); }
    if (card.status === 'not_found') return { status: 'unreadable', reason: 'the Session does not exist' };
    if (card.status === 'rejected') return platformReadFailure(card);
    if (card.status !== 'ready') return { status: 'unreadable', reason: 'the Session is not ready' };
    const session = card.value.record;
    if (session.lifecycle !== 'active') return refusal('archived');
    if (session.archiveRequest !== null && session.archiveRequest !== undefined) return refusal('archive_requested');
    if (session.occupancy !== null) return refusal('occupied');
    const successor = await recordedSuccessor(ctx, session);
    if (successor === 'unusable') {
      return { status: 'transient', reason: 'the successor Session enumeration is not usable' };
    }
    if (successor === 'found') return refusal('handed_over');
    const authorization = run.executionAuthorization;
    const runKernel = run.executionHistory?.kernel
      ?? (authorization !== undefined && 'schemaVersion' in authorization && authorization.schemaVersion === 2
        ? authorization.kernel : null);
    if (runKernel !== null && (runKernel.adapterId !== session.kernel.adapterId
      || runKernel.kernelSessionId !== session.kernel.kernelSessionId)) {
      return { status: 'mismatch', reason: 'the afterRun Kernel binding disagrees with the Session mapping' };
    }
    // 4. health
    if (session.health === 'available') {
      const probe = await owner.probe({ session, signal: ctx.signal });
      if (probe.verdict === 'ready' && probe.activeRunId === null) return { status: 'already_closed', health: 'available' };
      // L4 step 4: only "ready with no active Run" is already_closed. An available
      // Health whose Kernel head still names an active Run (or any other
      // observation) is `refused('health')`: the platform facts changed, so the
      // caller re-walks them; it is never the definite `mismatch` fallback.
      if (probe.verdict === 'ready') return refusal('health');
      if (probe.verdict === 'missing' || probe.verdict === 'damaged') return { status: 'unreadable', reason: probe.reason };
      // L4: a host_config, transient or cancelled probe is retryable, never a
      // definite failure (D6).
      return { status: 'transient', reason: probe.reason };
    }
    if (!(session.health === 'unavailable' && (session.healthConclusion ?? null) === 'kernel_turn_open')) return refusal('health');
    // 5. storage and the Kernel closure (M2, D5: read BOTH injected seams at call
    // time; either one absent is `unsupported` and no write happens)
    const closeFn = deps.kernel.closeOpenTurn;
    const readBoundsFn = deps.kernel.readTurnBounds;
    const location = deps.kernelStores.byAdapterId(session.kernel.adapterId);
    if (location === null || 'expectedSessionId' in location || closeFn === undefined || readBoundsFn === undefined) {
      return { status: 'unsupported', reason: 'the Session Kernel store is legacy, another adapter, or cannot close a Turn' };
    }
    try {
      if (await kernelDatabaseState(location.databasePath) === 'missing') {
        return { status: 'unreadable', reason: 'the mapped Kernel database file is missing' };
      }
    } catch (error) { return closureFailure(error, ctx.signal); }
    const kernelRunId = runKernel?.runId ?? afterRunRef.runId;
    let kernelResult;
    try {
      kernelResult = await deps.kernelStores.withStore(session.kernel.adapterId, async (store) => {
        const header = await store.get(session.kernel.kernelSessionId, { signal: ctx.signal });
        return closeFn(store, { sessionId: session.kernel.kernelSessionId, kernelRunId,
          expectedRevision: header.revision, at: deps.now() });
      });
    } catch (error) { return closureFailure(error, ctx.signal); }
    switch (kernelResult.status) {
      case 'closed':
      case 'already_closed':
        return settleHealth(ctx, session, closure, kernelResult.status);
      case 'not_found':
      case 'already_terminal':
      case 'mismatch':
        return { status: 'mismatch', reason: `the Kernel answers ${kernelResult.status}` };
      case 'conflict':
        return { status: 'conflict', reason: `the Kernel Session revision changed (current ${String(kernelResult.currentRevision)})` };
      case 'unreadable':
        return { status: 'unreadable', reason: kernelResult.reason };
      default: {
        const exhaustive: never = kernelResult;
        void exhaustive;
        return { status: 'transient', reason: 'the Kernel returned an unknown closure result' };
      }
    }
  };
}

export function createAgentRuntime(deps?: RuntimeExecutionDependencies): AgentRuntimeService {
  if (deps === undefined) return { port: basePort() };

  const contextAssembler = createContextAssembler(deps);
  const preparation = createExecutionPreparation(deps, contextAssembler);
  // R4.3a: the ONE internal control coordinator is assembled before the observer
  // and driver so both share the exact same instance and its private
  // exit/cleanup proof seam. The raw `controls` dependency is optional; without
  // it the coordinator still exists and `deliverControl` stays unsupported.
  const control = createRuntimeControlCoordinator({
    ...(deps.controls === undefined ? {} : { controls: deps.controls }),
    sourceAuthority: deps.sourceAuthority,
  });
  // K part A M2: the owner also resolves the injected Kernel `readTurnBounds`
  // seam at call time, so `countRunActivity` (L6) can bound the backfill window.
  const historyCursorOwner = createSessionHistoryCursorOwner({ kernelStores: deps.kernelStores, kernel: deps.kernel });
  /**
   * Slice 1 §3.3/§2.6: the changed-files reader the runtime publishes for the
   * archive anchor. Part 1 wires the factory (whose method is a stub), so the
   * port is reachable without changing any existing execution behaviour.
   */
  const archiveChangedFiles = createArchiveChangedFilesReader({
    executions: deps.executions,
    kernelStores: deps.kernelStores,
    workspaceHost: deps.workspaceHost,
    now: deps.now,
    ...(deps.workspaceSource === undefined ? {} : { workspaceSource: deps.workspaceSource }),
  });
  const readCompletedBoundary: NonNullable<RuntimeExecutionPort['readCompletedBoundary']> = async (ctx, request) => {
    if (ctx.principal.kind !== 'host') {
      return { status: 'rejected', code: 'forbidden', reason: 'the completed boundary read requires the Host principal' };
    }
    if (request.sessionRef.projectId !== ctx.projectId) {
      return { status: 'rejected', code: 'forbidden', reason: 'the Session belongs to another project' };
    }
    const read = await deps.sessions.readSession(ctx, request.sessionRef);
    if (read.status !== 'ready') return read;
    const boundary = await historyCursorOwner.completedBoundary({ session: read.value.record, signal: ctx.signal });
    if (boundary.status !== 'resolved') {
      return { status: 'rejected', code: boundary.code, reason: boundary.reason };
    }
    return { status: 'ready', value: { cursor: boundary.cursor, position: boundary.position } };
  };
  /**
   * C3 `executions/brief` (§6.1 (e)): the continuation brief pinned in a Run's
   * saved manifest, checked against `inputBinding.continuationBriefDigest`. A
   * Run without `requeueRef` has none (`null`); a requeue Run not bound yet is
   * `incomplete`.
   */
  const readContinuationBrief: NonNullable<RuntimeExecutionPort['readContinuationBrief']> = async (ctx, request) => {
    // A plain route hands the body through as it came: only a complete RunRef is read.
    const raw = (typeof request === 'object' && request !== null ? (request as { runRef?: unknown }).runRef : undefined) as
      Record<string, unknown> | null | undefined;
    if (typeof raw !== 'object' || raw === null || raw['aggregateType'] !== 'Run'
      || ![raw['projectId'], raw['goalId'], raw['runId']].every((id) => typeof id === 'string' && id.length > 0)) {
      return { status: 'rejected', code: 'invalid', reason: 'readContinuationBrief requires a complete RunRef' };
    }
    const runRef: RunRef = { aggregateType: 'Run', projectId: raw['projectId'] as string, goalId: raw['goalId'] as string,
      runId: raw['runId'] as string };
    const read = await deps.executions.readExecution(ctx, runRef);
    if (read.status !== 'ready') return read;
    if (read.value.run.requeueRef === undefined) return { status: 'ready', value: null };
    const digest = read.value.run.inputBinding?.continuationBriefDigest;
    const prepared = rehydratePreparedExecution(read.value);
    if (prepared === null || digest === undefined) {
      return { status: 'rejected', code: 'incomplete', reason: 'the requeue Run has not bound its continuation brief yet' };
    }
    const loaded = await loadPreparedManifest(deps.bodies, prepared);
    if (loaded.status !== 'ready') return loaded;
    const brief = loaded.value.manifest.continuationBrief;
    if (brief === undefined || continuationBriefDigest(brief) !== digest) {
      return { status: 'rejected', code: 'unavailable', reason: 'the saved manifest brief disagrees with the Run binding' };
    }
    return { status: 'ready', value: { brief, digest } };
  };
  /**
   * R4.3a delivery, plus RUN-23 in process (A.2 step 5.6, RD-7): a cancel the live handle can no
   * longer consume because its Kernel call already exited at a safe point (the Turn is paused, every
   * owned resource closed) stops the Run on that exit proof (`live_clean`); otherwise it stays queued.
   */
  const deliverControl: NonNullable<RuntimeExecutionPort['deliverControl']> = async (ctx, request) => {
    const delivered = await control.deliver(ctx, request);
    const reconcile = deps.runReconcile;
    if (delivered.status !== 'ready' || reconcile === undefined) return delivered;
    const intent = delivered.value;
    if (intent.kind !== 'cancel' || intent.status !== 'queued') return delivered;
    const proof = control.proof(intent.runRef);
    if (proof === undefined || !proof.kernelExited || proof.resourcesClosed?.status !== 'completed') return delivered;
    const read = await deps.executions.readExecution(ctx, intent.runRef);
    if (read.status !== 'ready') return delivered;
    // CTL-10: the pause in effect is the one the live handle consumed when it stopped at the safe point.
    const stopped = await stopPausedRunInProcess({ owner: historyCursorOwner,
      ...(deps.messages === undefined ? {} : { messages: deps.messages }), reconcile }, ctx,
      { record: read.value, cancelIntentRef: intent.ref, pausedBy: proof.consumedIntentRef ?? null });
    if (!stopped || deps.controls === undefined) return delivered;
    const after = await deps.controls.readControl(ctx, intent.ref);
    return after.status === 'ready' ? after : delivered;
  };
  /**
   * Slice 2B L6 (backfill): read one ended Run's activity window and tally it.
   * A Run with no position record is `not_entered` only when the platform can
   * prove it never entered the Kernel (L7); otherwise it is an explicit
   * `unknown('no_history_locator')`. The window's upper bound follows L6
   * exactly: the recorded `endPosition` first, then K part A's
   * `readTurnBounds`, then the reconcile observation, else `kernel_tail`.
   */
  const countRunActivity: NonNullable<RuntimeExecutionPort['countRunActivity']> = async (ctx, input) => {
    if (ctx.principal.kind !== 'host') {
      return { status: 'rejected', code: 'forbidden', reason: 'the activity read requires the Host principal' };
    }
    const raw = input as unknown as { runRef?: unknown; maxPages?: unknown } | null | undefined;
    const runRefRaw = raw?.runRef;
    if (typeof runRefRaw !== 'object' || runRefRaw === null || (runRefRaw as { aggregateType?: unknown }).aggregateType !== 'Run'
      || !['projectId', 'goalId', 'runId'].every((field) => typeof (runRefRaw as Record<string, unknown>)[field] === 'string'
        && ((runRefRaw as Record<string, unknown>)[field] as string).length > 0)) {
      return { status: 'rejected', code: 'invalid', reason: 'countRunActivity requires a complete RunRef' };
    }
    const runRef = runRefRaw as RunRef;
    if (runRef.projectId !== ctx.projectId) {
      return { status: 'rejected', code: 'forbidden', reason: 'the Run belongs to another project' };
    }
    const maxPages = typeof raw?.maxPages === 'number' && Number.isSafeInteger(raw.maxPages) && raw.maxPages >= 1
      ? raw.maxPages : undefined;
    const read = await deps.executions.readExecution(ctx, runRef);
    if (read.status !== 'ready') return read;
    const record = read.value;
    const run = record.run;
    const locator = run.executionHistory;
    if (locator === undefined || !isRunExecutionHistoryV1(locator)) {
      // R5: the ONE shared L7 predicate (V2 authorization without a Kernel
      // identity, or no authorization on/after the recording epoch).
      if (provenNotEnteredKernel(run, null)) {
        return { status: 'ready', value: { kind: 'not_entered' } };
      }
      // L7/2B-42: a Run with no locator, no authorization and no `startedAt`
      // (claimed then cancelled before it entered, ended before the recording
      // epoch) is NOT proved not-entered here. Only the V2 authorized/revoked
      // binding proves non-entry; this one is a backfill candidate and must
      // produce an explicit `unknown('no_history_locator')`, never 0/empty.
      return { status: 'ready', value: { kind: 'facts',
        facts: unknownFacts('no_history_locator', 'the Run has no position record; its Kernel history is not indexed (F11)') } };
    }
    if (locator.sessionRef.projectId !== ctx.projectId
      || locator.kernel.kernelSessionId !== record.session.kernel.kernelSessionId) {
      return { status: 'ready', value: { kind: 'facts',
        facts: unknownFacts('history_read_failed', 'the persisted locator disagrees with the claim Session mapping') } };
    }
    // L6/R6: the mandatory probe runs BEFORE any bound is resolved. A missing or
    // damaged mapping is a definite `kernel_unreadable`; a transient, Host
    // configuration or cancellation outcome proves nothing, so it is
    // `retry_later` and nothing is written. Doing this first keeps a probe
    // failure from surfacing as a bounds-read failure (`history_read_failed` /
    // `kernel_unreadable`) and keeps a cancellation around the bounds read.
    const probe = await historyCursorOwner.probe({ session: record.session, signal: ctx.signal });
    if (probe.verdict === 'missing' || probe.verdict === 'damaged') {
      return { status: 'ready', value: { kind: 'facts', facts: unknownFacts('kernel_unreadable', probe.reason) } };
    }
    if (probe.verdict !== 'ready') {
      return { status: 'ready', value: { kind: 'retry_later', reason: probe.reason } };
    }
    let through: { position: number; bound: 'end_position' | 'turn_bounds' | 'reconcile_observation' } | 'kernel_tail';
    if (locator.endPosition !== null) {
      through = { position: locator.endPosition, bound: 'end_position' };
    } else {
      const bounds = await historyCursorOwner.readTurnBounds({ session: record.session,
        kernelRunId: locator.kernel.runId, signal: ctx.signal });
      // R6: the real bounds owner answers `unreadable` on cancellation
      // (`session-operations.ts`), so check the caller's signal immediately
      // after the await, before interpreting `unreadable`/`not_found`. A
      // cancelled read proves nothing and writes nothing (`retry_later`).
      if (ctx.signal.aborted) {
        return { status: 'ready', value: { kind: 'retry_later', reason: 'the activity window read was cancelled' } };
      }
      if (bounds.status === 'not_found') {
        return { status: 'ready', value: { kind: 'facts', facts: unknownFacts('turn_not_found', 'the Kernel has no Turn of this identity') } };
      }
      if (bounds.status === 'unreadable') {
        return { status: 'ready', value: { kind: 'facts', facts: unknownFacts('kernel_unreadable', bounds.reason) } };
      }
      if (bounds.status === 'found' && bounds.endPosition !== null) {
        through = { position: bounds.endPosition, bound: 'turn_bounds' };
      } else {
        const observation = run.reconciliation?.observation;
        const reconciled = observation?.kind === 'interrupted_clean' ? observation.lastPosition
          : observation?.kind === 'unresolved' ? observation.observedThroughPosition : null;
        if (reconciled !== null && reconciled !== undefined) {
          through = { position: reconciled, bound: 'reconcile_observation' };
        } else if (bounds.status === 'found') {
          through = 'kernel_tail';
        } else {
          return { status: 'ready', value: { kind: 'facts',
            facts: unknownFacts('history_read_failed', bounds.reason) } };
        }
      }
    }
    const result = await readRunActivityFacts(historyCursorOwner, { session: record.session, kernel: locator.kernel,
      fromPosition: locator.startPosition, through, probeFirst: false, signal: ctx.signal,
      ...(maxPages === undefined ? {} : { maxPages }) });
    return { status: 'ready', value: result };
  };
  const observation = createExecutionObservation({ ...deps, control });
  /**
   * The observer, plus RUN-21 in process (A.2 step 5.6, §12.2 "进程内的同类收尾",
   * RD-4): reading a Run already ended `outcome_unknown` checks its Kernel
   * Turn for new evidence (a terminal past the recorded window with every
   * unresolved call determined) and books it on the `live_clean` proof
   * through `recordRunResult`; anything else leaves the Run as recorded.
   */
  const observeRun: RuntimeExecutionPort['observeRun'] = async (ctx, request) => {
    const observed = await observation.observe(ctx, request);
    const reconcile = deps.runReconcile;
    if (observed.status !== 'ready' || reconcile === undefined || deps.controls === undefined) return observed;
    const run = observed.value.run;
    if (run.status !== 'ended' || run.outcome !== 'outcome_unknown') return observed;
    let booked = false;
    try {
      booked = await bookLateEvidenceInProcess({ owner: historyCursorOwner,
        ...(deps.messages === undefined ? {} : { messages: deps.messages }), controls: deps.controls, entry: deps.entry,
        reconcile, now: deps.now, newId: deps.newId }, ctx, { record: observed.value });
    } catch { /* the Run stays as recorded; the next observation or start reads it again */ }
    if (!booked) return observed;
    const reread = await deps.executions.readExecution(ctx, run.ref);
    return reread.status === 'ready' ? reread : observed;
  };
  const driver = createExecutionDriver({ ...deps, observation, control });
  const queryPreparation = createQueryPreparation(deps, contextAssembler);
  const queryDriver = createQueryExecutionDriver(deps);
  const queryObservation = createQueryObservation(deps);
  const base = basePort();
  const port: RuntimeExecutionPort = {
    ...base,
    readCompletedBoundary,
    readContinuationBrief,
    readArchiveChangedFiles: (ctx, request) => archiveChangedFiles.readArchiveChangedFiles(ctx, request),
    prepareExecution: (ctx, request) => preparation.prepare(ctx, request),
    startRun: (ctx, request) => driver.start(ctx, request),
    observeRun: (ctx, request) => observeRun(ctx, request),
    deliverControl: (ctx, request) => deliverControl(ctx, request),
    prepareQuery: (ctx, request) => queryPreparation.prepare(ctx, request),
    startQuery: (ctx, request) => queryDriver.start(ctx, request),
    observeQuery: (ctx, request) => queryObservation.observe(ctx, request),
    readAttentionGraph: (ctx, request) => contextAssembler.readAttentionGraph(ctx, request),
    countRunActivity: (ctx, input) => countRunActivity(ctx, input),
  };
  // M1: without the injected closure dependency the port does not publish the
  // operation, and the Workflow's `close_open_turn` answers `unsupported`.
  if (deps.turnClosure !== undefined) {
    port.closeOpenTurn = createCloseOpenTurn(deps, historyCursorOwner);
  }
  return { port };
}
