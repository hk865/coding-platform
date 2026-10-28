/**
 * B2 AgentRuntime factory.
 *
 * With the trusted dependency bundle the factory wires the real bounded
 * preparation, fresh execution driver, incremental observation services and the
 * ONE internal control coordinator. A no-argument call keeps the previous N0
 * behavior and answers `unsupported` for every member except `readPromptRecord`:
 * that member validates the ref and answers a complete Work ref `unavailable`,
 * while every other member stays `unsupported`. The factory never fabricates a
 * capability and never starts a Kernel/provider call.
 *
 * The Session creation/original-history members are still declared only so the
 * composition root can override them with the accepted RT1/RT7/RT8
 * implementations.
 */
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { SessionRecord } from '../../contracts/core/session.js';
import type { RunRef } from '../../contracts/dispatch.js';
import type { QueryRunRef, QueryRunSnapshot } from '../../contracts/query-job.js';
import type { UnknownCallReviewRef } from '../../contracts/unknown-call-review.js';
import type { TaskRow } from '../work-graph/model/plan-contracts.js';
import type { TaskRequeueRef } from '../../contracts/task-requeue.js';
import { GOAL_FAN_OUT_ACTOR, reworkActorClassOf } from '../../contracts/task-requeue.js';
import { ProcessSandbox, StoreError, WorkspaceSandbox } from '../../../vendor/coding-agent/dist/public-api.js';
import { createExecutionDriver } from './execution-driver.js';
import { createExecutionObservation } from './execution-observation.js';
import { createRuntimeControlCoordinator } from './execution-control.js';
import { createExecutionPreparation, loadPreparedManifest, rehydratePreparedExecution } from './execution-preparation.js';
import { createContextAssembler } from './context-assembler.js';
import { continuationBriefDigest } from '../../contracts/continuation-brief.js';
import { createPlatformPromptPackSource } from '../../contracts/prompts/prompt-pack.js';
import {
  checkPromptBody, decodePromptSetV1, PROMPT_TEXT_CONTENT_TYPE, PROMPT_TOOL_SPECS_CONTENT_TYPE,
  PROMPT_TOOL_TEXT_CONTENT_TYPE,
  type PromptRecordRequestV1, type PromptSetV1,
} from '../../contracts/prompts/prompt-set.js';
import { sha256Hex } from '../../contracts/fingerprint.js';
import { messageOf as sharedMessageOf } from '../../contracts/error-message.js';
import { rejected as sharedRejected } from '../../contracts/core/rejections.js';
import { QUERY_MANIFEST_CONTENT_TYPE } from '../../contracts/no-progress.js';
import type { ArtifactRef } from '../../contracts/artifact.js';
import type { CoreRejection, ReadResult } from '../../contracts/core/results.js';
import type { PreparedQueryExecution } from '../../contracts/core/prepared-execution.js';
import type { RawArtifactStorePort } from '../record-store/body-ports.js';
import { createSessionHistoryCursorOwner, kernelDatabaseState, type SessionHistoryCursorOwner } from './session-operations.js';
import { createArchiveChangedFilesReader } from './session-anomaly-facts.js';
import { bookLateEvidenceInProcess, stopPausedRunInProcess } from './run-reconcile.js';
import { isPausedInterrupted } from '../work-graph/state/run-machine.js';
import { createQueryPreparation } from './query-preparation.js';
import { createQueryExecutionDriver } from './query-execution.js';
import { createQueryObservation } from './query-observation.js';
import type { RuntimeExecutionDependencies, TurnClosureDependencies, ReadonlyCommandHostFacts } from './execution-contracts.js';
import { readonlyCommandSandboxOptions } from './readonly-command-tool.js';
import { WORKSPACE_DENIED_PREFIXES } from '../workspace/denied-prefixes.js';
import type { WorkspaceRef } from '../../contracts/ledger.js';
import type { AgentRuntimePort, AgentRuntimeService, RuntimeExecutionPort } from './ports.js';
import { readRunActivityFacts, unknownFacts, type RunActivityRead } from './run-activity-reader.js';
import { provenNotEnteredKernel, type RunActivityBound } from '../../contracts/run-activity.js';
import { isRunExecutionHistoryV1 } from '../work-graph/persistence/execution-history-codecs.js';

const unsupported = (reason: string) => ({
  status: 'rejected' as const, code: 'unsupported' as const, reason,
});

/** Local names for the shared originals, kept because the production-reach allowlist names these two nodes. */
const messageOf: (error: unknown) => string = sharedMessageOf;
const rejected: (code: CoreRejection['code'], reason: string) => CoreRejection = sharedRejected;

/** Ruling 29: the Query manifest is re-read through these exact identity fields. */
function sameQueryRunRef(value: unknown, ref: QueryRunRef): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate['aggregateType'] === 'QueryRun'
    && ['projectId', 'workspaceId', 'queryJobId', 'runId']
      .every(field => candidate[field] === (ref as unknown as Record<string, unknown>)[field]);
}

/**
 * Ruling 29: re-read the Query manifest named by `record.run.prepared.bundleRef`.
 * The two Query manifest loaders are private, so this is the minimal equal read:
 * content type, stored ref, body digest/size and the body's owner must all
 * agree. A store failure is `unavailable`; a ref/content disagreement `invalid`.
 */
async function readQueryPromptSet(
  bodies: Pick<RawArtifactStorePort, 'read'>,
  prepared: PreparedQueryExecution,
): Promise<ReadResult<PromptSetV1>> {
  const bundleRef: ArtifactRef | undefined = prepared.bundleRef;
  if (bundleRef === undefined || bundleRef.contentType !== QUERY_MANIFEST_CONTENT_TYPE
    || bundleRef.digest.length === 0 || !Number.isSafeInteger(bundleRef.sizeBytes) || bundleRef.sizeBytes < 0) {
    return rejected('invalid', 'the QueryRun has no prepared manifest reference');
  }
  let stored;
  try { stored = await bodies.read(bundleRef); }
  catch (error) { return rejected('unavailable', `reading the Query manifest failed: ${messageOf(error)}`); }
  if (stored.status !== 'ready') return rejected('unavailable', 'the Query manifest body is not readable');
  const record = stored.value;
  if (record.ref.contentType !== bundleRef.contentType || record.ref.digest !== bundleRef.digest
    || record.ref.sizeBytes !== bundleRef.sizeBytes) {
    return rejected('invalid', 'the stored Query manifest reference disagrees with the Prepared envelope');
  }
  if (sha256Hex(record.body) !== bundleRef.digest
    || Buffer.byteLength(record.body, 'utf8') !== bundleRef.sizeBytes) {
    return rejected('invalid', 'the stored Query manifest bytes do not match their content digest');
  }
  if (record.origin.kind !== 'run' || !sameQueryRunRef(record.origin.owner, prepared.queryRunRef)) {
    return rejected('forbidden', 'the stored Query manifest is not owned by this QueryRun');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(record.body); } catch { return rejected('invalid', 'the Query manifest is not valid JSON'); }
  if (typeof parsed !== 'object' || parsed === null) {
    return rejected('invalid', 'the Query manifest is not valid JSON');
  }
  const manifest = parsed as Record<string, unknown>;
  if (manifest['schemaVersion'] !== 1 || manifest['kind'] !== 'query_execution'
    || !sameQueryRunRef(manifest['queryRunRef'], prepared.queryRunRef)) {
    return rejected('invalid', "the Query manifest is not this QueryRun's execution manifest");
  }
  const set = decodePromptSetV1(manifest['promptSet']);
  if (set === null) return rejected('invalid', 'the Query manifest has no valid prompt set');
  return { status: 'ready', value: set };
}

function basePort(): AgentRuntimePort {
  return {
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
    async readPromptRecord(_ctx, ref) {
      // Ruling 29/30: no dependencies means no model-request read; a complete
      // Work ref is explicitly unavailable, never an empty list. The ref is
      // validated here exactly as the wired factory does.
      const raw = (typeof ref === 'object' && ref !== null ? ref : null) as Record<string, unknown> | null;
      const complete = (fields: readonly string[]): boolean =>
        raw !== null && fields.every(field => typeof raw[field] === 'string' && (raw[field] as string).length > 0);
      if (raw?.['aggregateType'] === 'Run') {
        if (!complete(['projectId', 'goalId', 'runId'])) {
          return rejected('invalid', 'readPromptRecord requires a complete RunRef');
        }
        return rejected('unavailable', 'model request reads are not wired');
      }
      if (raw?.['aggregateType'] === 'QueryRun') {
        if (!complete(['projectId', 'workspaceId', 'queryJobId', 'runId'])) {
          return rejected('invalid', 'readPromptRecord requires a complete QueryRunRef');
        }
        return unsupported('B2 skeleton: readPromptRecord is not implemented');
      }
      return rejected('invalid', 'readPromptRecord requires a complete RunRef or QueryRunRef');
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

  /** The one TaskRow read both the paused (RUN-24) and the L27 review-purpose
   * authorization use. A read that proves nothing is `null` and never
   * authorizes (rule 3). */
  async function readTaskRow(ctx: CoreCallContext, taskId: string, afterRunRef: RunRef): Promise<TaskRow | null> {
    try {
      const read = await deps.plans.queryTaskGraph(ctx, { goalRef: { aggregateType: 'Goal',
        projectId: afterRunRef.projectId, goalId: afterRunRef.goalId } });
      if (read.status !== 'ready') return null;
      return read.value.tasks.find((candidate) => candidate.ref.taskId === taskId) ?? null;
    } catch { return null; }
  }

  /** RUN-24 authorization: the TaskRequeue covers the afterRun and its requester
   * is a person or the Goal-resume fan-out. The plan is the only place the
   * requester is recorded, so a missing row refuses (rule 3): it must never
   * allow a closure it cannot authorize. */
  function requeueAuthorizes(
    row: TaskRow | null, taskId: string, afterRunRef: RunRef, requeueRef: TaskRequeueRef,
  ): boolean {
    if (requeueRef.projectId !== afterRunRef.projectId || requeueRef.goalId !== afterRunRef.goalId
      || requeueRef.taskId !== taskId || requeueRef.afterRunId !== afterRunRef.runId) return false;
    const entry = row?.rework?.entries.find((candidate) => candidate.ref.afterRunId === afterRunRef.runId);
    if (entry === undefined) return false;
    if (reworkActorClassOf(null, entry.requestedBy) === 'human') return true;
    return entry.requestedBy.kind === 'system' && entry.requestedBy.id === GOAL_FAN_OUT_ACTOR.id;
  }

  /** K3 L27: a review-purpose Run is authorized by the review record itself
   * once its ending is known and `settle_review` has taken it out of
   * `activeRound` — it is read-only, never requeued, and closing its dangling
   * Turn only makes the Session available again. */
  function reviewPurposeAuthorizes(row: TaskRow | null, reviewRef: UnknownCallReviewRef, runId: string): boolean {
    const review = row?.unknownCallReview;
    if (review === undefined || review.status === 'unreadable') return false;
    if (review.ref.aggregateType !== reviewRef.aggregateType || review.ref.projectId !== reviewRef.projectId
      || review.ref.goalId !== reviewRef.goalId || review.ref.runId !== reviewRef.runId) return false;
    return review.activeRound?.runRef.runId !== runId;
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

  /**
   * 2C-22(2) (lead 2026-10-15): when the Kernel store stays missing/damaged,
   * KA1's closure returns `unreadable` and the retired line would otherwise sit
   * at `unavailable/kernel_turn_open` forever (maintenance leaves
   * `kernel_turn_open` lines alone). Re-probe the Session through the same owner
   * `settleHealth` uses and, only for a `missing`/`damaged` verdict, hand the
   * probe to the health owner; the health owner applies its own guards (SES-19a
   * replaces `kernel_turn_open` when the caller is the maintenance's Turn
   * closure, everything else still refuses). Any other verdict, or a
   * refused/failed health write, changes nothing. The closure still reports
   * `unreadable` either way.
   */
  async function recordUnreadableProbe(
    ctx: CoreCallContext, session: SessionRecord, closure: TurnClosureDependencies, caller: 'turn_closure' | null,
  ): Promise<void> {
    try {
      const probe = await owner.probe({ session, signal: ctx.signal });
      if (probe.verdict !== 'missing' && probe.verdict !== 'damaged') return;
      await closure.recordSessionHealth(ctx, {
        sessionRef: { projectId: session.ref.projectId, sessionId: session.ref.sessionId },
        probe: { verdict: probe.verdict, activeRunId: probe.activeRunId },
        // SES-19a: only the maintenance's Turn closure may replace
        // `kernel_turn_open`; the other close callers keep SES-19.
        ...(caller === null ? {} : { caller }),
      });
    } catch {
      // The unreadable closure is the answer regardless of the health write.
    }
  }

  return async (ctx, input) => {
    const closure = deps.turnClosure;
    if (closure === undefined) return { status: 'unsupported', reason: 'the Runtime does not publish closeOpenTurn' };
    if (closure.lease !== 'owned') return refusal('lease');
    const { sessionRef, afterRunRef, requeueRef } = input;
    const turnClosureCaller = input.turnClosureCaller ?? null;
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
    // K3 L27: RUN-25 (crashed + takeover_unresolved) is authorized by the
    // Host-instance takeover proof itself, so it needs no TaskRequeue — the same
    // shape as RUN-22.
    const run25 = run.outcome === 'crashed' && observation !== undefined && observation.kind === 'takeover_unresolved';
    // L27: read the TaskRow once for both authorizations. A review-purpose Run
    // (never RUN-25, D1) whose ending is known and which is no longer
    // `activeRound` needs no TaskRequeue. RUN-19/22/23 already pass the
    // non-paused branch, so this admits the paused review round (RUN-24).
    const reviewPurpose = run.purpose?.kind === 'unknown_call_review' ? run.purpose : null;
    const row = pausedInterrupted ? await readTaskRow(ctx, run.task.taskId, afterRunRef) : null;
    const reviewAuthorized = pausedInterrupted && reviewPurpose !== null
      && reviewPurposeAuthorizes(row, reviewPurpose.reviewRef, run.ref.runId);
    if (pausedInterrupted) {
      if (!reviewAuthorized
        && (requeueRef === null || !requeueAuthorizes(row, run.task.taskId, afterRunRef, requeueRef))) {
        return refusal('continuation_not_authorized');
      }
    } else if (!(run19 || run23 || run22 || run25)) {
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
      ?? (authorization !== undefined ? authorization.kernel : null);
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
    if (location === null || closeFn === undefined || readBoundsFn === undefined) {
      return { status: 'unsupported', reason: 'the Session Kernel store is legacy, another adapter, or cannot close a Turn' };
    }
    try {
      if (await kernelDatabaseState(location.databasePath) === 'missing') {
        await recordUnreadableProbe(ctx, session, closure, turnClosureCaller);
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
    } catch (error) {
      const failure = closureFailure(error, ctx.signal);
      // 2C-22(2): a Kernel store whose records cannot be read (a fresh empty
      // file after the old one was removed, or damaged rows) throws out of the
      // read instead of answering a Kernel result. That is still an `unreadable`
      // closure answer, so re-probe and hand the verdict to the health owner
      // (SES-19a) exactly as the `kernelResult.status === 'unreadable'` case does.
      if (failure.status === 'unreadable') await recordUnreadableProbe(ctx, session, closure, turnClosureCaller);
      return failure;
    }
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
        await recordUnreadableProbe(ctx, session, closure, turnClosureCaller);
        return { status: 'unreadable', reason: kernelResult.reason };
      default: {
        const exhaustive: never = kernelResult;
        void exhaustive;
        return { status: 'transient', reason: 'the Kernel returned an unknown closure result' };
      }
    }
  };
}

/**
 * K3 (G6, L25; §2 K L4 item 5): the read-only closure-capability check the
 * start-up classifier asks before it attaches a RUN-25 candidate. It proves
 * what `closeOpenTurn` would prove about storage and the Kernel seam, minus the
 * write and the Run end: the closure is installed, this Host holds the lease,
 * the Session is readable, and its Kernel store is current and publishes
 * `closeOpenTurn`/`readTurnBounds`. The Kernel head is compared by the
 * classifier's own probe (`head_mismatch`).
 */
function createTurnClosureSupport(
  deps: RuntimeExecutionDependencies,
): NonNullable<RuntimeExecutionPort['turnClosureSupport']> {
  const unsupported = (reason: string): { status: 'unsupported'; reason: string } => ({ status: 'unsupported', reason });
  return async (ctx, input) => {
    const closure = deps.turnClosure;
    if (closure === undefined) return unsupported('the Runtime does not publish closeOpenTurn');
    if (closure.lease !== 'owned') return unsupported('this Host does not hold the Host instance lease');
    let card;
    try { card = await deps.sessions.readSession(ctx, input.sessionRef); }
    catch (error) { return unsupported(`the Session could not be read: ${error instanceof Error ? error.message : String(error)}`); }
    if (card.status !== 'ready') return unsupported('the Session is not readable');
    const session = card.value.record;
    if (deps.kernel.closeOpenTurn === undefined || deps.kernel.readTurnBounds === undefined) {
      return unsupported('the Kernel does not publish closeOpenTurn');
    }
    const location = deps.kernelStores.byAdapterId(session.kernel.adapterId);
    if (location === null) {
      return unsupported('the Session Kernel store is legacy or another adapter, so it cannot close a Turn');
    }
    return { status: 'supported' };
  };
}

/**
 * K3 L13/U5/R3: the read-only `reviewCapability` query. It answers whether the
 * review/proposal round for this workspace+Role could register the real
 * `run_readonly_command` tool: the Host switch is on, the whole workspace is
 * readable and `ProcessSandbox` proves the read-only sandbox with EXACTLY the
 * options the real tool would be built with (`readonlyCommandSandboxOptions`).
 * It selects the binding by Role and never resolves the model. It never writes,
 * never starts a round and never falls back to a host shell.
 */
function createReviewCapability(
  deps: RuntimeExecutionDependencies,
): NonNullable<RuntimeExecutionPort['reviewCapability']> {
  const message = (error: unknown): string => error instanceof Error ? error.message : String(error);
  const unavailable = (reason: string): { status: 'unavailable'; reason: string } => ({ status: 'unavailable', reason });
  return async (ctx, input) => {
    const workspace: WorkspaceRef = {
      aggregateType: 'Workspace', projectId: input.workspace.projectId, workspaceId: input.workspace.workspaceId,
    };
    let facts: ReadonlyCommandHostFacts | null;
    try { facts = await deps.readonlyCommandAccess?.(input) ?? null; }
    catch (error) { return unavailable(`the Host read-only command switch could not be read: ${message(error)}`); }
    if (facts === null || facts.access !== 'all_except_denied') {
      return unavailable('the Host read-only command switch is off');
    }
    let resolved;
    try { resolved = await deps.workspaceHost.resolveRoot(workspace); }
    catch (error) { return unavailable(`the workspace root could not be resolved: ${message(error)}`); }
    if (resolved.status !== 'ready') return unavailable(resolved.reason);
    let authorized;
    try { authorized = await deps.workspaceHost.authorize(ctx, workspace); }
    catch (error) { return unavailable(`the Host read policy could not be read: ${message(error)}`); }
    if (authorized.status !== 'ready') return unavailable(authorized.reason);
    if (!authorized.value.allowsRead('.')) return unavailable('the Host read grant is not the whole workspace');
    let handle: WorkspaceSandbox;
    try {
      handle = await WorkspaceSandbox.create(resolved.value.root, { deniedPrefixes: [...WORKSPACE_DENIED_PREFIXES] });
    } catch (error) { return unavailable(`the workspace handle could not be created: ${message(error)}`); }
    try {
      // D-PROBE: the probe and the real tool share ONE options object.
      const options = readonlyCommandSandboxOptions({
        ...facts.processSandboxOptions,
        ...(deps.resourceCaps === undefined ? {} : { resourceCaps: deps.resourceCaps }),
      });
      const profile = await ProcessSandbox.probe(resolved.value.root, handle, options);
      if (!profile.available) return unavailable(profile.reason ?? 'the read-only sandbox is unavailable');
      return { status: 'available' };
    } catch (error) {
      return unavailable(`the read-only sandbox probe failed: ${message(error)}`);
    }
  };
}

export function createAgentRuntime(requestedDeps?: RuntimeExecutionDependencies): AgentRuntimeService {
  if (requestedDeps === undefined) return { port: basePort() };
  // Ruling 30: one resolved bundle for the whole factory; the caller's object is
  // never mutated and every consumer below sees the same pack source.
  const deps: RuntimeExecutionDependencies = {
    ...requestedDeps,
    promptPacks: requestedDeps.promptPacks ?? createPlatformPromptPackSource(),
  };

  const contextAssembler = createContextAssembler(deps);
  const preparation = createExecutionPreparation(deps, contextAssembler);
  // R4.3a: the ONE internal control coordinator is assembled before the observer
  // and driver so both share the exact same instance and its private
  // exit/cleanup proof seam. The raw `controls` dependency is optional; without
  // it the coordinator still exists and `deliverControl` stays unsupported.
  const control = createRuntimeControlCoordinator({
    ...(deps.controls === undefined ? {} : { controls: deps.controls }),
    ...(deps.hostClosing === undefined ? {} : { hostClosing: deps.hostClosing }),
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
   * Ruling 29: one Work Run's or QueryRun's frozen prompt record, read afresh.
   * The ref is validated, the read is authorized through the same execution
   * owner the driver uses, the manifest is re-read and its `promptSet` decoded,
   * then the requests are listed and every body they and the set refer to is
   * verified against its ref. A missing store body is `unavailable`; a
   * ref/content disagreement is `invalid`.
   */
  const readPromptRecord: NonNullable<RuntimeExecutionPort['readPromptRecord']> = async (ctx, ref) => {
    const raw = (typeof ref === 'object' && ref !== null ? ref : null) as Record<string, unknown> | null;
    const complete = (fields: readonly string[]): boolean =>
      raw !== null && fields.every(field => typeof raw[field] === 'string' && (raw[field] as string).length > 0);

    const readTexts = async (set: PromptSetV1, requests: PromptRecordRequestV1[]):
      Promise<{ status: 'ready'; value: Record<string, string> } | CoreRejection> => {
      const texts: Record<string, string> = {};
      const seen = new Set<string>();
      const read = async (target: ArtifactRef, contentType: string, what: string): Promise<CoreRejection | null> => {
        // Ruling 17/29: verify the ref's own type before the cache can collapse
        // two refs that share a digest and size but name another type.
        if (target.contentType !== contentType) {
          return rejected('invalid', `${what} does not match its reference`);
        }
        const key = `${contentType}|${target.digest}|${String(target.sizeBytes)}`;
        if (seen.has(key)) return null;
        seen.add(key);
        let stored;
        try { stored = await deps.bodies.read(target); }
        catch (error) { return rejected('unavailable', `reading ${what} failed: ${messageOf(error)}`); }
        if (stored.status !== 'ready') return rejected('unavailable', `${what} is not readable`);
        const body = checkPromptBody(target, stored.value, contentType);
        if (body === null) return rejected('invalid', `${what} does not match its reference`);
        texts[target.digest] = body;
        return null;
      };
      for (const template of set.templates) {
        const problem = await read(template.ref, PROMPT_TEXT_CONTENT_TYPE, `the frozen template ${template.id}`);
        if (problem !== null) return problem;
      }
      const strings = await read(set.strings.ref, PROMPT_TEXT_CONTENT_TYPE, 'the frozen string table');
      if (strings !== null) return strings;
      const base = await read(set.base.ref, PROMPT_TEXT_CONTENT_TYPE, 'the frozen base prompt');
      if (base !== null) return base;
      for (const skill of set.skills) {
        const problem = await read(skill.ref, PROMPT_TEXT_CONTENT_TYPE, `the frozen Skill ${skill.id}`);
        if (problem !== null) return problem;
      }
      // The frozen tool-text bodies are part of the record.
      for (const tool of set.tools) {
        const problem = await read(tool.ref, PROMPT_TOOL_TEXT_CONTENT_TYPE, `the frozen tool text ${tool.name}`);
        if (problem !== null) return problem;
      }
      for (const request of requests) {
        const problem = await read(request.toolSpecsRef, PROMPT_TOOL_SPECS_CONTENT_TYPE,
          `the tool specs of request ${request.requestId}`);
        if (problem !== null) return problem;
      }
      return { status: 'ready', value: texts };
    };

    if (raw?.['aggregateType'] === 'Run') {
      if (!complete(['projectId', 'goalId', 'runId'])) {
        return rejected('invalid', 'readPromptRecord requires a complete RunRef');
      }
      const runRef: RunRef = { aggregateType: 'Run', projectId: raw['projectId'] as string,
        goalId: raw['goalId'] as string, runId: raw['runId'] as string };
      const reads = deps.modelRequestReads;
      if (reads === undefined) return rejected('unavailable', 'model request reads are not wired');
      const read = await deps.executions.readExecution(ctx, runRef);
      if (read.status !== 'ready') return read;
      const prepared = rehydratePreparedExecution(read.value);
      if (prepared === null) return rejected('incomplete', 'the Run has no saved prepared manifest');
      const loaded = await loadPreparedManifest(deps.bodies, prepared);
      if (loaded.status !== 'ready') return loaded;
      const set = decodePromptSetV1(loaded.value.manifest.promptSet);
      if (set === null) return rejected('invalid', 'the saved manifest has no valid prompt set');
      const listed = await reads.listRunModelRequests(ctx, runRef);
      if (listed.status !== 'ready') return listed;
      const requests: PromptRecordRequestV1[] = [...listed.value]
        .sort((left, right) => left.sequence - right.sequence)
        .map(permit => ({ requestId: permit.requestId, systemDigest: permit.prompt.systemDigest,
          toolsDigest: permit.prompt.toolsDigest, toolSpecsRef: permit.prompt.toolSpecsRef,
          selection: permit.prompt.selection, kind: 'work' as const, maxOutputTokens: permit.prompt.maxOutputTokens }));
      const texts = await readTexts(set, requests);
      if (texts.status !== 'ready') return texts;
      return { status: 'ready', value: { set, requests, texts: texts.value } };
    }

    if (raw?.['aggregateType'] === 'QueryRun') {
      if (!complete(['projectId', 'workspaceId', 'queryJobId', 'runId'])) {
        return rejected('invalid', 'readPromptRecord requires a complete QueryRunRef');
      }
      const queryRunRef: QueryRunRef = { aggregateType: 'QueryRun', projectId: raw['projectId'] as string,
        workspaceId: raw['workspaceId'] as string, queryJobId: raw['queryJobId'] as string,
        runId: raw['runId'] as string };
      const queryExecution = deps.queryExecution;
      if (queryExecution === undefined) {
        return rejected('unsupported', 'readPromptRecord requires the trusted QueryExecutionPort');
      }
      const read = await queryExecution.readQueryExecution(ctx, queryRunRef);
      if (read.status !== 'ready') return read;
      const state = read.value.run.run.executionState;
      if (state === undefined) return rejected('incomplete', 'the QueryRun has no execution state');
      const prepared = state.prepared;
      if (prepared === null) return rejected('incomplete', 'the QueryRun has not been prepared yet');
      const loaded = await readQueryPromptSet(deps.bodies,
        { queryRunRef, bundleRef: prepared.bundleRef, inputDigest: prepared.inputDigest });
      if (loaded.status !== 'ready') return loaded;
      const requests: PromptRecordRequestV1[] = state.requests.map(request => ({
        requestId: request.requestId, systemDigest: request.prompt.systemDigest,
        toolsDigest: request.prompt.toolsDigest, toolSpecsRef: request.prompt.toolSpecsRef,
        selection: request.prompt.selection, kind: 'query' as const, reservedOutput: request.reservedOutput }));
      const texts = await readTexts(loaded.value, requests);
      if (texts.status !== 'ready') return texts;
      return { status: 'ready', value: { set: loaded.value, requests, texts: texts.value } };
    }

    return rejected('invalid', 'readPromptRecord requires a complete RunRef or QueryRunRef');
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
   * L6: the ONE upper-bound choice of an ended execution's activity window,
   * shared by the Run and the Query tally: the recorded `endPosition`, then K
   * part A's `readTurnBounds` (the Turn's own end), then the saved reconcile
   * observation, else `kernel_tail` when the Kernel has the Turn. A Turn the
   * Kernel does not have, an unreadable Kernel or a bounds read that cannot
   * locate the Turn with no saved observation is an explicit `unknown`; a
   * cancelled bounds read proves nothing (`retry_later`). Either way the answer
   * is final and nothing is read past it.
   */
  async function activityUpperBound(ctx: CoreCallContext, input: {
    session: SessionRecord; kernelRunId: string; endPosition: number | null; reconciledThrough: number | null;
  }): Promise<{ kind: 'through'; through: { position: number; bound: Exclude<RunActivityBound, 'kernel_tail'> } | 'kernel_tail' }
    | { kind: 'answer'; value: RunActivityRead }> {
    if (input.endPosition !== null) return { kind: 'through', through: { position: input.endPosition, bound: 'end_position' } };
    const bounds = await historyCursorOwner.readTurnBounds({ session: input.session,
      kernelRunId: input.kernelRunId, signal: ctx.signal });
    // R6: the real bounds owner answers `unreadable` on cancellation
    // (`session-operations.ts`), so check the caller's signal immediately
    // after the await, before interpreting `unreadable`/`not_found`. A
    // cancelled read proves nothing and writes nothing (`retry_later`).
    if (ctx.signal.aborted) {
      return { kind: 'answer', value: { kind: 'retry_later', reason: 'the activity window read was cancelled' } };
    }
    if (bounds.status === 'not_found') {
      return { kind: 'answer', value: { kind: 'facts', facts: unknownFacts('turn_not_found', 'the Kernel has no Turn of this identity') } };
    }
    if (bounds.status === 'unreadable') {
      return { kind: 'answer', value: { kind: 'facts', facts: unknownFacts('kernel_unreadable', bounds.reason) } };
    }
    if (bounds.status === 'found' && bounds.endPosition !== null) {
      return { kind: 'through', through: { position: bounds.endPosition, bound: 'turn_bounds' } };
    }
    if (input.reconciledThrough !== null) {
      return { kind: 'through', through: { position: input.reconciledThrough, bound: 'reconcile_observation' } };
    }
    if (bounds.status === 'found') return { kind: 'through', through: 'kernel_tail' };
    return { kind: 'answer', value: { kind: 'facts', facts: unknownFacts('history_read_failed', bounds.reason) } };
  }
  /**
   * Slice 2B L6 (backfill): read one ended Run's activity window and tally it.
   * A Run with no position record is `not_entered` only when the platform can
   * prove it never entered the Kernel (L7); otherwise it is an explicit
   * `unknown('no_history_locator')`. The window's upper bound is the shared
   * `activityUpperBound` choice; the Run's saved reconcile observation is its
   * `interrupted_clean` last position or its `unresolved` watermark.
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
    const observation = run.reconciliation?.observation;
    const reconciled = observation?.kind === 'interrupted_clean' ? observation.lastPosition
      : observation?.kind === 'unresolved' ? observation.observedThroughPosition : null;
    const bound = await activityUpperBound(ctx, { session: record.session, kernelRunId: locator.kernel.runId,
      endPosition: locator.endPosition, reconciledThrough: reconciled ?? null });
    if (bound.kind === 'answer') return { status: 'ready', value: bound.value };
    const result = await readRunActivityFacts(historyCursorOwner, { session: record.session, kernel: locator.kernel,
      fromPosition: locator.startPosition, through: bound.through, probeFirst: false, signal: ctx.signal,
      ...(maxPages === undefined ? {} : { maxPages }) });
    return { status: 'ready', value: result };
  };
  /**
   * Slice 6A L16: read one ended QueryRun's activity window and tally it. The
   * QueryRun is read by its exact ref first: an ended QueryRun with no
   * execution state, no fixed entry or a `not_entered` outcome never entered
   * the Kernel (QRR-01/02, a drop or an unbound end before any claim), so the
   * answer is `not_entered`, never a zero count. Otherwise the executing
   * Session is read and the window runs from the saved start (position 0 when
   * the window is lost) to the shared `activityUpperBound`, whose saved
   * reconcile observation is the Query's own watermark. It writes nothing.
   */
  const countQueryActivity: NonNullable<RuntimeExecutionPort['countQueryActivity']> = async (ctx, input) => {
    if (ctx.principal.kind !== 'host') {
      return { status: 'rejected', code: 'forbidden', reason: 'the activity read requires the Host principal' };
    }
    const raw = input as unknown as { queryRunRef?: unknown; maxPages?: unknown } | null | undefined;
    const runRefRaw = raw?.queryRunRef;
    if (typeof runRefRaw !== 'object' || runRefRaw === null || (runRefRaw as { aggregateType?: unknown }).aggregateType !== 'QueryRun'
      || !['projectId', 'workspaceId', 'queryJobId', 'runId'].every((field) => typeof (runRefRaw as Record<string, unknown>)[field] === 'string'
        && ((runRefRaw as Record<string, unknown>)[field] as string).length > 0)) {
      return { status: 'rejected', code: 'invalid', reason: 'countQueryActivity requires a complete QueryRunRef' };
    }
    const queryRunRef = runRefRaw as QueryRunRef;
    if (queryRunRef.projectId !== ctx.projectId || queryRunRef.workspaceId !== ctx.workspaceId) {
      return { status: 'rejected', code: 'forbidden', reason: 'the QueryRun is outside the Host call scope' };
    }
    // Passed on as given: the window reader rejects a bound that is not a positive safe integer.
    const maxPages = input.maxPages;
    const loaded = await deps.sourceAuthority().load(queryRunRef);
    if (loaded.status === 'not_found') return { status: 'not_found' };
    if (loaded.status !== 'found') {
      return { status: 'rejected', code: 'unavailable', reason: `the QueryRun could not be read: ${loaded.reason}` };
    }
    if (loaded.snapshot.ref.aggregateType !== 'QueryRun') {
      return { status: 'rejected', code: 'unavailable', reason: 'the QueryRun read answered another aggregate' };
    }
    const run = (loaded.snapshot as QueryRunSnapshot).run;
    if (run.endedAt === null) {
      return { status: 'rejected', code: 'invalid', reason: 'countQueryActivity requires an ended QueryRun' };
    }
    const state = run.executionState;
    if (state === undefined || state.entry === null || run.outcome === 'not_entered') {
      return { status: 'ready', value: { kind: 'not_entered' } };
    }
    const entry = state.entry;
    if (deps.queryExecution === undefined) {
      return { status: 'rejected', code: 'unsupported', reason: 'the Query activity read needs the trusted QueryExecutionPort' };
    }
    // The executing Session, whose Kernel mapping the window is read through.
    const read = await deps.queryExecution.readQueryExecution(ctx, queryRunRef);
    if (read.status !== 'ready') return read;
    const record = read.value;
    const history = state.history;
    if (history !== null
      && (history.sessionRef.projectId !== ctx.projectId
        || history.kernel.kernelSessionId !== record.session.kernel.kernelSessionId)) {
      return { status: 'ready', value: { kind: 'facts',
        facts: unknownFacts('history_read_failed', 'the persisted history disagrees with the claim Session mapping') } };
    }
    // The mandatory probe runs before the window read, as the Run tally does: a
    // missing or damaged mapping is a definite `kernel_unreadable`, and a probe
    // that proves nothing writes nothing.
    const probe = await historyCursorOwner.probe({ session: record.session, signal: ctx.signal });
    if (probe.verdict === 'missing' || probe.verdict === 'damaged') {
      return { status: 'ready', value: { kind: 'facts', facts: unknownFacts('kernel_unreadable', probe.reason) } };
    }
    if (probe.verdict !== 'ready') {
      return { status: 'ready', value: { kind: 'retry_later', reason: probe.reason } };
    }
    const kernel = history?.kernel ?? entry.kernel;
    const bound = await activityUpperBound(ctx, { session: record.session, kernelRunId: kernel.runId,
      endPosition: history?.endPosition ?? null, reconciledThrough: history?.observedThroughPosition ?? null });
    if (bound.kind === 'answer') return { status: 'ready', value: bound.value };
    const result = await readRunActivityFacts(historyCursorOwner, { session: record.session, kernel,
      fromPosition: history === null ? 0 : history.startPosition, through: bound.through, probeFirst: false, signal: ctx.signal,
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
  const port: AgentRuntimePort = {
    ...base,
    readCompletedBoundary,
    readContinuationBrief,
    readPromptRecord,
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
    countQueryActivity: (ctx, input) => countQueryActivity(ctx, input),
  };
  // M1: without the injected closure dependency the port does not publish the
  // operation, and the Workflow's `close_open_turn` answers `unsupported`.
  if (deps.turnClosure !== undefined) {
    port.closeOpenTurn = createCloseOpenTurn(deps, historyCursorOwner);
  }
  // K3 (G6): the read-only check is published whenever the closure dependency is.
  if (deps.turnClosure !== undefined) {
    port.turnClosureSupport = createTurnClosureSupport(deps);
  }
  // K3 L13/U5: the review-round read-only capability is always published; without
  // the Host switch dependency it answers `unavailable` (fail closed).
  port.reviewCapability = createReviewCapability(deps);
  return { port };
}
