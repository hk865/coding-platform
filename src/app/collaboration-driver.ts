/**
 * AG2b continuous-communication Host driver (implementation).
 *
 * This is a HOST-layer composition of the EXISTING platform owners
 * (`WorkflowPort`, `RuntimeExecutionPort`, the Session directory, the exact
 * execution reader, the mailbox and the Run control port) plus the trusted
 * startup Query profiles. It declares no second Workflow/Runtime/mailbox/
 * scheduler and owns no store: the original Run, Session, message, Query and
 * control facts remain the only truth.
 *
 * This Host owns only live, in-memory advancement handles:
 *   - explicit Task selections have independent handles within one Goal; each
 *     forwards the existing Workflow next and retains the selected Task.
 *   - a fresh Work and its exact outbox consultation pump run concurrently.
 *     A saved reply wait may yield and release the Session; the live waiter
 *     retains the formal Task/Session/message and starts a successor Run only
 *     after the reply and applicable controls permit it. This is not resuming
 *     the ended Kernel Run or reconstructing an unknown execution.
 *   - identical seeds replay the handle snapshot. Active waits reserve that
 *     handle identity; unrelated Tasks can continue independently.
 *   - stop applies existing controls and drains Work/consultation promises.
 *     Pause preserves the waiter without authorizing a new model call.
 *   - read is a projection of this Host's handles. Reopening without one returns
 *     not_found; an explicit Workflow request can resolve persisted continuations
 *     from their owners, but there is no persistent/background runner here.
 */
import type { CoreCallContext } from '../contracts/core/call-context.js';
import type { CoreRejection, ReadResult } from '../contracts/core/results.js';
import type { RunContinuationV1, RunRef } from '../contracts/dispatch.js';
import type { GoalRef } from '../contracts/ledger.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../contracts/fingerprint.js';
import type { RuntimeExecutionPort } from '../core/agent-runtime/ports.js';
import type { ExecutionReadPort, TaskExecutionRecord } from '../core/work-graph/tasks/execution-read-contracts.js';
import type { RunControlPort } from '../core/work-graph/tasks/control-contracts.js';
import type { SessionDirectoryPort } from '../core/work-graph/sessions/contracts.js';
import type {
  SessionMailboxPort,
  SessionMessage,
  SessionMessagePage,
} from '../core/work-graph/communication/contracts.js';
import type {
  ConsultationInput,
  ConsultationResult,
  WorkflowAdvanceInput,
  WorkflowAdvanceResult,
} from '../business/workflow/contracts.js';
import type { WorkflowPort } from '../business/workflow/ports.js';
import type { WorkbenchQueryProfile } from './runtime-configuration.js';

/** The frozen closed set of states. `waiting_for_reply` stays active. */
export type CollaborationState =
  | 'running'
  | 'waiting_for_reply'
  | 'waiting'
  | 'stopping'
  | 'stopped'
  | 'completed'
  | 'failed';

/**
 * The bounded per-Goal projection. `current`/`last` are the exact Workflow
 * advancement request/result; `messages` is the most recent display projection
 * (at most 50) while the original mailbox remains the durable authority.
 */
export type CollaborationSnapshot = {
  goalRef: GoalRef;
  flowId: string;
  /** The explicit Task this handle advances; null is the Goal-level default. */
  taskId: string | null;
  /** Every live/known sibling handle of the same Goal, for real multi-execution reads. */
  siblings: { taskId: string | null; state: CollaborationState; reason: string | null }[];
  state: CollaborationState;
  current: WorkflowAdvanceInput | null;
  last: WorkflowAdvanceResult | null;
  messages: SessionMessage[];
  reason: string | null;
};

/** The same keyset page shape as the inbox; one independent sender-Run cursor. */
export type CollaborationOutboxPage = SessionMessagePage;

/**
 * The narrow mailbox surface. `readOutbox` is optional on the shared port only
 * so a frozen port literal stays type-compatible; the composition root always
 * publishes the real method.
 */
export type CollaborationMailboxPort = Pick<SessionMailboxPort, 'readMessage' | 'readOutbox'>;

/** `start` carries the Host-supplied next Workflow request and the selected
 * trusted Query profile ids (never a recipient, model, secret or grant). */
export type CollaborationStartInput = {
  advance: WorkflowAdvanceInput;
  queryProfileIds: string[];
};

export type CollaborationReadInput = { goalRef: GoalRef; taskId?: string };
export type CollaborationStopInput = { goalRef: GoalRef; taskId?: string };

/** One active handle per Goal; different Goals may run in parallel. */
export interface CollaborationDriverPort {
  start(ctx: CoreCallContext, input: CollaborationStartInput): Promise<ReadResult<CollaborationSnapshot>>;
  read(ctx: CoreCallContext, input: CollaborationReadInput): Promise<ReadResult<CollaborationSnapshot>>;
  stop(ctx: CoreCallContext, input: CollaborationStopInput): Promise<ReadResult<CollaborationSnapshot>>;
}

/** The Host owns the handle lifetime; `close` stops and drains every handle. */
export type CollaborationDriver = CollaborationDriverPort & {
  close(): Promise<void>;
  /**
   * Register additional trusted profiles for newly opened scopes. New handles
   * see them immediately; an already-created handle keeps the profile snapshot
   * it started with and is never retroactively widened.
   */
  addProfiles(profiles: readonly CollaborationDriverProfile[]): void;
};

/** Trusted startup profiles, exactly the published `WorkbenchQueryProfile`. */
export type CollaborationDriverProfile = WorkbenchQueryProfile;

/**
 * The exact owners the Host layer may compose. Every member is an existing
 * platform port; `profiles` is the frozen trusted startup selection.
 */
export type CollaborationDriverDependencies = {
  workflow: WorkflowPort;
  runtime: RuntimeExecutionPort;
  sessions: SessionDirectoryPort;
  executions: Pick<ExecutionReadPort, 'readExecution'>;
  mailbox: CollaborationMailboxPort;
  controls: RunControlPort;
  profiles: readonly CollaborationDriverProfile[];
};

const TICK_MS = 500;
const MAX_PROJECTED_MESSAGES = 50;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function canonicalOf(value: unknown): string | null {
  try { return canonicalJson(value as JsonValue); } catch { return null; }
}
function sameCanonical(left: unknown, right: unknown): boolean {
  const leftKey = canonicalOf(left);
  return leftKey !== null && leftKey === canonicalOf(right);
}
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function rejected(code: CoreRejection['code'], reason: string): CoreRejection {
  return { status: 'rejected', code, reason };
}
function isRunRef(value: unknown): value is RunRef {
  return isRecord(value) && value['aggregateType'] === 'Run'
    && nonEmpty(value['projectId']) && nonEmpty(value['goalId']) && nonEmpty(value['runId']);
}
function isGoalRef(value: unknown): value is GoalRef {
  return isRecord(value) && value['aggregateType'] === 'Goal'
    && nonEmpty(value['projectId']) && nonEmpty(value['goalId']);
}
/** A snapshot of the caller's trusted identity; each handle owns its own signals. */
type TrustedContext = Pick<CoreCallContext, 'projectId' | 'principal' | 'materialReader'>;
function snapshotContext(ctx: CoreCallContext): TrustedContext {
  return {
    projectId: ctx.projectId,
    principal: structuredClone(ctx.principal),
    materialReader: structuredClone(ctx.materialReader),
  };
}
function contextWith(context: TrustedContext, workspaceId: string, signal: AbortSignal): CoreCallContext {
  return {
    projectId: context.projectId, workspaceId,
    principal: structuredClone(context.principal),
    materialReader: structuredClone(context.materialReader),
    signal,
  };
}
/**
 * Active means a live loop/consultation still owns the Goal handle. `waiting`
 * is NOT active: the owner already returned and the loop drained, so a later
 * explicit advance may start the next bounded step.
 */
function isActive(state: CollaborationState): boolean {
  return state === 'running' || state === 'waiting_for_reply' || state === 'stopping';
}
function isTerminal(state: CollaborationState): boolean {
  return state === 'completed' || state === 'failed' || state === 'stopped';
}
function handleKey(projectId: string, workspaceId: string, goalId: string, taskId: string | null): string {
  return `${projectId}\u0000${workspaceId}\u0000${goalId}\u0000${taskId ?? '*'}`;
}
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolvePromise) => {
    if (signal.aborted) { resolvePromise(); return; }
    const finish = (): void => { clearTimeout(timer); signal.removeEventListener('abort', onAbort); resolvePromise(); };
    const onAbort = (): void => finish();
    const timer = setTimeout(finish, Math.max(0, ms));
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
/** The RunRef an upcoming `perform:start` will start, if that is the next step. */
function startRunRefOf(input: WorkflowAdvanceInput | null): RunRef | null {
  const raw: unknown = input;
  const operation = isRecord(raw) ? raw['operation'] : undefined;
  if (!isRecord(operation) || operation['kind'] !== 'start') return null;
  const request = isRecord(operation['request']) ? operation['request'] : {};
  const prepared = isRecord(request['prepared']) ? request['prepared'] : {};
  const claim = isRecord(prepared['claim']) ? prepared['claim'] : {};
  return isRunRef(claim['runRef']) ? claim['runRef'] : null;
}
/** The RunRef a completed/received Workflow step already recorded. */
function receiptRunRefOf(value: WorkflowAdvanceResult): RunRef | null {
  if (value.status !== 'ready') return null;
  const receipt: UnknownRecord | null = isRecord(value.value.receipt) ? value.value.receipt : null;
  if (receipt === null) return null;
  const kind = receipt['kind'];
  const result: UnknownRecord = isRecord(receipt['result']) ? receipt['result'] : {};
  if (kind === 'claim_task') {
    if (result['status'] !== 'committed') return null;
    const claim = isRecord(result['value']) ? result['value'] : {};
    return isRunRef(claim['runRef']) ? claim['runRef'] : null;
  }
  if (kind === 'prepare') {
    if (result['status'] !== 'ready') return null;
    const prepared = isRecord(result['value']) ? result['value'] : {};
    const claim = isRecord(prepared['claim']) ? prepared['claim'] : {};
    return isRunRef(claim['runRef']) ? claim['runRef'] : null;
  }
  if (kind === 'start' || kind === 'observe') {
    if (result['status'] !== 'ready') return null;
    const recordValue = isRecord(result['value']) ? result['value'] : {};
    const run = isRecord(recordValue['run']) ? recordValue['run'] : {};
    return isRunRef(run['ref']) ? run['ref'] : null;
  }
  return null;
}

type Handle = {
  key: string;
  projectId: string;
  workspaceId: string;
  goalRef: GoalRef;
  flowId: string;
  taskId: string | null;
  seed: string;
  profiles: readonly WorkbenchQueryProfile[];
  context: TrustedContext;
  state: CollaborationState;
  current: WorkflowAdvanceInput | null;
  last: WorkflowAdvanceResult | null;
  reason: string | null;
  messages: SessionMessage[];
  messageKeys: Set<string>;
  currentRun: RunRef | null;
  stopRequested: boolean;
  stopReason: string | null;
  /** True while the handle is genuinely parked on a yielded continuation wait. */
  wakeWaiting: boolean;
  /** The driver's own lifetime signal; aborted only by `close`. */
  abort: AbortController;
  /** The live consultation pump signal; aborted on stop/close/run end. */
  activePumpAbort: AbortController | null;
  /** One-shot drain promise so stop and close cannot double-drain. */
  stopDrain: Promise<void> | null;
  done: Promise<void>;
};

export function createCollaborationDriver(dependencies: CollaborationDriverDependencies): CollaborationDriver {
  const handles = new Map<string, Handle>();
  const trustedProfiles = dependencies.profiles.map(profile => structuredClone(profile));

  function handleSiblings(handle: Handle): CollaborationSnapshot['siblings'] {
    const result: CollaborationSnapshot['siblings'] = [];
    for (const candidate of handles.values()) {
      if (candidate.projectId !== handle.projectId || candidate.workspaceId !== handle.workspaceId
        || candidate.goalRef.goalId !== handle.goalRef.goalId) continue;
      if (candidate.key === handle.key) continue;
      result.push({ taskId: candidate.taskId, state: candidate.state, reason: candidate.reason });
    }
    return result;
  }
  function snapshot(handle: Handle): CollaborationSnapshot {
    return {
      goalRef: structuredClone(handle.goalRef),
      flowId: handle.flowId,
      taskId: handle.taskId,
      siblings: handleSiblings(handle),
      state: handle.state,
      current: handle.current === null ? null : structuredClone(handle.current),
      last: handle.last === null ? null : structuredClone(handle.last),
      messages: handle.messages.map(message => structuredClone(message)),
      reason: handle.reason,
    };
  }
  /** Every handle of one Goal; a read without an explicit TaskId uses them all. */
  function goalHandles(projectId: string, workspaceId: string, goalId: string): Handle[] {
    return [...handles.values()].filter(candidate => candidate.projectId === projectId
      && candidate.workspaceId === workspaceId && candidate.goalRef.goalId === goalId);
  }
  function project(handle: Handle, message: SessionMessage): void {
    const key = canonicalOf(message.ref) ?? `${message.ref.messageId}:${message.revision}`;
    const existingIndex = handle.messageKeys.has(key)
      ? handle.messages.findIndex(candidate => canonicalOf(candidate.ref) === canonicalOf(message.ref))
      : -1;
    if (existingIndex >= 0) { handle.messages[existingIndex] = message; return; }
    handle.messageKeys.add(key);
    handle.messages.push(message);
    if (handle.messages.length > MAX_PROJECTED_MESSAGES) {
      const removed = handle.messages.shift();
      if (removed !== undefined) handle.messageKeys.delete(canonicalOf(removed.ref) ?? '');
    }
  }
  function loopContext(handle: Handle): CoreCallContext {
    return contextWith(handle.context, handle.workspaceId, handle.abort.signal);
  }
  /** The formal cancel must never ride an already-aborted signal. */
  function independentContext(handle: Handle): CoreCallContext {
    return contextWith(handle.context, handle.workspaceId, new AbortController().signal);
  }

  /** Select the exactly-matching trusted profiles: same scope, requested id. */
  function selectProfiles(projectId: string, workspaceId: string, ids: readonly string[]): WorkbenchQueryProfile[] {
    const wanted = new Set(ids);
    return trustedProfiles.filter(profile => wanted.has(profile.id)
      && profile.scope.projectId === projectId && profile.scope.workspaceId === workspaceId);
  }

  /** THIS driver freshly starts the Run only when the Run is not already begun. */
  async function freshStart(handle: Handle, runRef: RunRef): Promise<boolean> {
    let read: ReadResult<TaskExecutionRecord>;
    try {
      read = await dependencies.executions.readExecution(independentContext(handle), runRef);
    } catch {
      return false;
    }
    if (read.status !== 'ready') return false;
    if (read.value.run.task.goalId !== handle.goalRef.goalId) return false;
    if (read.value.session.workspaceId !== handle.workspaceId) return false;
    const auth = read.value.run.executionAuthorization;
    return auth === undefined || auth.phase === 'authorized';
  }

  /** Match one replyMode wait to exactly one same-scope/role trusted profile. */
  async function consultFor(
    handle: Handle, message: SessionMessage, signal: AbortSignal,
  ): Promise<{ ok: true; profile: WorkbenchQueryProfile } | { ok: false; reason: string }> {
    const cardRead = await dependencies.sessions.readSession(
      contextWith(handle.context, handle.workspaceId, signal), message.recipient);
    if (cardRead.status !== 'ready') return { ok: false, reason: 'the wait recipient Session is not readable' };
    const card = cardRead.value;
    const matches = handle.profiles.filter(profile => profile.scope.projectId === handle.projectId
      && profile.scope.workspaceId === handle.workspaceId
      && sameCanonical(profile.sessionRole, card.record.role));
    if (matches.length === 0) return { ok: false, reason: 'no trusted Query profile matches the wait recipient role' };
    if (matches.length > 1) return { ok: false, reason: 'more than one trusted Query profile matches the wait recipient role' };
    return { ok: true, profile: matches[0]! };
  }

  async function consultOne(
    handle: Handle, message: SessionMessage, signal: AbortSignal,
  ): Promise<ConsultationResult | CoreRejection> {
    const consume = dependencies.workflow.consumeConsultation;
    if (consume === undefined) return rejected('unsupported', 'the Workflow has no consultation consumer');
    const matched = await consultFor(handle, message, signal);
    if (!matched.ok) return rejected('incomplete', matched.reason);
    const profile = matched.profile;
    const input: ConsultationInput = {
      schemaVersion: 1,
      messageRef: message.ref,
      goalRef: handle.goalRef,
      roleBinding: profile.roleBinding,
      runtimeBudget: profile.runtimeBudget,
      budget: profile.budget,
      consumerId: profile.consumerId,
    };
    try {
      return await consume.call(dependencies.workflow,
        contextWith(handle.context, handle.workspaceId, signal), input);
    } catch (error) {
      return rejected('unavailable', `the consultation consumer failed: ${messageOf(error)}`);
    }
  }

  /** Read EVERY page of one sender Run's outbox; only the display projection is
   * capped at 50. */
  async function readAllOutbox(handle: Handle, runRef: RunRef, signal: AbortSignal): Promise<SessionMessage[] | null> {
    const readOutbox = dependencies.mailbox.readOutbox;
    if (readOutbox === undefined) return null;
    const all: SessionMessage[] = [];
    let cursor: string | undefined;
    // No arbitrary page cap: follow the keyset cursor until it is exhausted or
    // the pump is aborted, so a consultation sent after the first 50 messages is
    // never lost. Only the DISPLAY projection stays capped at 50.
    while (!signal.aborted) {
      const page_ = await readOutbox.call(dependencies.mailbox,
        contextWith(handle.context, handle.workspaceId, signal), {
          senderRun: runRef,
          page: { limit: MAX_PROJECTED_MESSAGES, ...(cursor === undefined ? {} : { cursor }) },
        });
      if (page_.status !== 'ready') break;
      all.push(...page_.value.items);
      for (const message of page_.value.items) project(handle, message);
      if (page_.value.nextCursor === null) break;
      cursor = page_.value.nextCursor;
    }
    return all;
  }

  /** The read-only consultation pump over the exact sender-Run outbox. */
  async function pump(handle: Handle, runRef: RunRef, signal: AbortSignal, manageState = true, shouldDrain?: () => boolean): Promise<void> {
    const readOutbox = dependencies.mailbox.readOutbox;
    if (readOutbox === undefined) {
      handle.reason = 'the mailbox does not publish readOutbox; the wait cannot be consumed';
      return;
    }
    while (!signal.aborted && !handle.stopRequested) {
      const finalPass = shouldDrain?.() === true;
      try {
        const all = await readAllOutbox(handle, runRef, signal);
        if (all !== null) {
          const waiting = all.filter(message => message.sender.kind === 'work_run'
            && (message.intent === 'inquiry' || (message.intent === undefined && message.replyMode === 'wait')) && message.status !== 'responded');
          if (waiting.length === 0) {
            if (manageState && handle.state === 'waiting_for_reply') handle.state = 'running';
          } else {
            if (manageState && waiting.some(message => message.waitAfterSend === true || message.replyMode === 'wait')) handle.state = 'waiting_for_reply';
            for (const message of waiting) {
              if (signal.aborted || handle.stopRequested) break;
              const outcome = await consultOne(handle, message, signal);
              if (outcome.status === 'ready') {
                project(handle, outcome.value.message);
                // Preserve the real reason for both an in-progress wait and a
                // terminal `ended` projection; a responded/processed result
                // carries no wait reason.
                handle.reason = outcome.value.state === 'waiting' || outcome.value.state === 'ended'
                  ? outcome.value.reason : null;
              } else if (outcome.status === 'rejected') {
                handle.reason = outcome.reason;
              } else {
                handle.reason = 'the consultation consumer did not return a ready result';
              }
            }
          }
        }
      } catch (error) {
        handle.reason = `the consultation pump failed: ${messageOf(error)}`;
      }
      if (finalPass) return;
      await sleep(TICK_MS, signal);
    }
  }

  /** Poll ONLY the exact saved wait message; zero model calls while absent. */
  async function awaitWake(handle: Handle, continuation: RunContinuationV1, signal: AbortSignal): Promise<boolean> {
    try {
      while (!handle.stopRequested && !handle.abort.signal.aborted && !signal.aborted) {
        // A reply does not revoke a human pause/cancel. Keep this same waiter
        // dormant while paused; explicit resume changes the original Run fact.
        const runRef = handle.currentRun;
        if (runRef === null) { handle.reason = 'the original yielded Run is not known'; return false; }
        const execution = await dependencies.executions.readExecution(independentContext(handle), runRef);
        if (execution.status !== 'ready') {
          handle.reason = 'the original yielded Run control is not readable';
          await sleep(TICK_MS, signal); continue;
        }
        const desired = execution.value.run.controlState?.desiredState;
        if (desired === 'cancelled' || execution.value.run.outcome === 'cancelled') {
          handle.reason = 'the original execution was cancelled; saved replies remain readable';
          return false;
        }
        if (desired === 'paused') {
          handle.reason = 'the original execution is paused; awaiting explicit resume';
          await sleep(TICK_MS, signal); continue;
        }
        let read;
        try {
          read = await dependencies.mailbox.readMessage(
            contextWith(handle.context, handle.workspaceId, signal), continuation.messageRef);
        } catch {
          handle.reason = 'the continuation wait message read failed';
          await sleep(TICK_MS, signal);
          continue;
        }
        if (read.status === 'ready' && read.value.status === 'responded' && read.value.response !== null) return true;
        if (read.status === 'rejected' && read.code === 'forbidden') { handle.reason = read.reason; return false; }
        await sleep(TICK_MS, signal);
      }
      return false;
    } finally {
      // The shared wake signal is owned by the caller and aborted there.
    }
  }

  async function runWithPump(handle: Handle, runRef: RunRef, input: WorkflowAdvanceInput): Promise<WorkflowAdvanceResult> {
    handle.currentRun = structuredClone(runRef);
    const fresh = await freshStart(handle, runRef);
    const pumpAbort = new AbortController();
    // A stop or driver close must cancel the consultation too; link both into the
    // pump signal that every consultation call receives.
    const onLoopAbort = (): void => { try { pumpAbort.abort('driver_stopped'); } catch { /* already aborted */ } };
    handle.abort.signal.addEventListener('abort', onLoopAbort, { once: true });
    if (handle.abort.signal.aborted) onLoopAbort();
    handle.activePumpAbort = pumpAbort;
    let drain = false;
    const pumpDone = fresh ? pump(handle, runRef, pumpAbort.signal, true, () => drain) : null;
    if (!fresh) handle.reason = 'the Run was already entered or settled; only observing the original facts';
    try {
      return await dependencies.workflow.advanceWork(loopContext(handle), input);
    } finally {
      // Sender completion/yield is not cancellation of an already-started
      // consultation. Drain it and one final saved-outbox scan before returning.
      // Explicit stop/close still abort this signal and we await the same promise.
      drain = true;
      if (pumpDone !== null) await pumpDone.catch(() => { /* the pump recorded its own reason */ });
      handle.abort.signal.removeEventListener('abort', onLoopAbort);
      if (handle.activePumpAbort === pumpAbort) handle.activePumpAbort = null;
    }
  }

/** The real continuation of a yielded start/observe receipt, if present. */
function yieldedContinuationOf(value: WorkflowAdvanceResult): RunContinuationV1 | null {
  if (value.status !== 'ready') return null;
  const receipt: UnknownRecord | null = isRecord(value.value.receipt) ? value.value.receipt : null;
  if (receipt === null) return null;
  if (receipt['kind'] !== 'start' && receipt['kind'] !== 'observe') return null;
  const result: UnknownRecord = isRecord(receipt['result']) ? receipt['result'] : {};
  if (result['status'] !== 'ready') return null;
  const recordValue: UnknownRecord = isRecord(result['value']) ? result['value'] : {};
  const run: UnknownRecord = isRecord(recordValue['run']) ? recordValue['run'] : {};
  if (run['outcome'] !== 'yielded' || !isRecord(run['continuation'])) return null;
  return structuredClone(run['continuation']) as unknown as RunContinuationV1;
}

  async function runHandle(handle: Handle): Promise<void> {
    try {
      let input = handle.current;
      while (input !== null && !handle.stopRequested) {
        const startRun = startRunRefOf(input);
        const result = startRun === null
          ? await dependencies.workflow.advanceWork(loopContext(handle), input)
          : await runWithPump(handle, startRun, input);
        // Record the REAL receipt/Run BEFORE honoring a concurrent stop, so a Run
        // claimed/prepared while stop was requested is never lost.
        handle.last = result;
        if (result.status === 'ready') {
          const observedRun = receiptRunRefOf(result) ?? startRunRefOf(result.value.next);
          if (observedRun !== null) handle.currentRun = structuredClone(observedRun);
        }
        if (handle.stopRequested) break;
        if (result.status !== 'ready') {
          handle.state = 'failed';
          handle.reason = result.reason;
          return;
        }
        const value = result.value;
        if (value.state === 'completed') {
          // A Goal handle temporarily pins the yielded Task while waking it.
          // Finishing that Task is not Goal completion: return to its original
          // Goal scope so the existing Workflow runs gates and formal reduction.
          // Explicit Task handles, in contrast, never acquire unrelated work.
          if (handle.taskId === null && input.taskId !== undefined) {
            const next: WorkflowAdvanceInput = {
              schemaVersion: 1, goalRef: handle.goalRef, flowId: handle.flowId,
              sessionHint: input.sessionHint, kind: 'select_work',
            };
            handle.current = next;
            input = next;
            continue;
          }
          handle.state = 'completed'; handle.reason = value.reason; return;
        }
        if (value.state === 'waiting') {
          // A yielded Run keeps the original Task/Session and saved wait. Wait for
          // the real reply, then re-advance the SAME Goal/Session; no model is
          // called while the reply is absent and no second Run is started.
          const continuation = yieldedContinuationOf(result);
          if (continuation !== null && !handle.stopRequested) {
            handle.state = 'waiting_for_reply';
            handle.reason = value.reason;
            handle.wakeWaiting = true;
            // Consume the yielded Run outbox AND wait for the exact reply on the
            // SAME shared signal, so no model runs while the reply is absent and a
            // stop aborts both the pump and the wait.
            const wakeAbort = new AbortController();
            handle.activePumpAbort = wakeAbort;
            const wakeRunRef = handle.currentRun;
            const pumpDone = wakeRunRef === null ? null : pump(handle, wakeRunRef, wakeAbort.signal, false);
            let woken = false;
            try {
              woken = await awaitWake(handle, continuation, wakeAbort.signal);
            } finally {
              wakeAbort.abort('wake_finished');
              if (pumpDone !== null) await pumpDone.catch(() => { /* the pump recorded its own reason */ });
              if (handle.activePumpAbort === wakeAbort) handle.activePumpAbort = null;
            }
            handle.wakeWaiting = false;
            if (!woken || handle.stopRequested) return;
            const wakeInput: WorkflowAdvanceInput = {
              schemaVersion: 1, goalRef: handle.goalRef, flowId: handle.flowId,
              sessionHint: { projectId: continuation.sessionRef.projectId, sessionId: continuation.sessionRef.sessionId },
              kind: 'select_work',
              // Wake the SAME original Task the continuation bound.
              taskId: continuation.task.taskId,
            };
            handle.current = wakeInput;
            input = wakeInput;
            continue;
          }
          handle.state = 'waiting'; handle.reason = value.reason; return;
        }
        if (value.next === null) { handle.state = 'waiting'; handle.reason = 'the Workflow returned no next step'; return; }
        handle.current = value.next;
        input = value.next;
      }
    } catch (error) {
      if (!handle.stopRequested) {
        handle.state = 'failed';
        handle.reason = `the Workflow advancement failed: ${messageOf(error)}`;
      }
    } finally {
      handle.current = null;
      // A stop drain owns the final `stopped` transition; never claim it here.
      if (!handle.stopRequested && (handle.state === 'running' || handle.state === 'waiting_for_reply')) {
        handle.state = 'waiting';
      }
    }
  }

  /** Submit + deliver the formal cancel for the still-open original Run. */
  async function requestCancel(handle: Handle): Promise<void> {
    const runRef = handle.currentRun;
    if (runRef === null) return;
    let read: ReadResult<TaskExecutionRecord>;
    try {
      read = await dependencies.executions.readExecution(independentContext(handle), runRef);
    } catch {
      handle.reason = 'the original Run could not be read to confirm the cancel';
      return;
    }
    if (read.status !== 'ready') { handle.reason = 'the original Run facts were not readable to confirm the cancel'; return; }
    const run = read.value.run;
    if (run.controlState?.desiredState === 'cancelled') { handle.reason = null; return; }
    // A yielded Run already terminated; its wait window still accepts the ONE
    // formal cancel that must gate any continuation.
    const yieldedWait = run.status === 'ended' && run.outcome === 'yielded' && run.continuation !== undefined;
    if ((run.status === 'ended' || run.outcome !== null) && !yieldedWait) return;
    const request: Parameters<RunControlPort['submitControl']>[1] = {
      input: { runRef, kind: 'cancel', reason: handle.stopReason ?? 'the collaboration driver stopped' },
      meta: { requestId: `collab-cancel:${sha256Hex(canonicalJson(runRef as unknown as JsonValue))}`,
        expected: [{ ref: runRef, revision: run.revision }] },
    };
    let submitted;
    try {
      submitted = await dependencies.controls.submitControl(independentContext(handle), request);
    } catch (error) {
      handle.reason = `submitting the cancel failed: ${messageOf(error)}`;
      return;
    }
    if (submitted.status !== 'committed') {
      handle.reason = `the cancel was not accepted: ${submitted.reason}`;
      return;
    }
    if (yieldedWait) {
      // The queued wait-window cancel is the formal landing; the continuation
      // claim observes it. There is no live Kernel left to deliver to.
      handle.reason = null;
      return;
    }
    if (dependencies.runtime.deliverControl === undefined) {
      handle.reason = 'the cancel intent is durable, but the Runtime has no control delivery to confirm it';
      return;
    }
    try {
      const delivered = await dependencies.runtime.deliverControl(
        independentContext(handle), { intentRef: submitted.value.intent.ref });
      if (delivered.status !== 'ready') {
        handle.reason = `the cancel intent is queued but was not delivered: ${delivered.status}`;
        return;
      }
    } catch (error) {
      handle.reason = `delivering the cancel failed: ${messageOf(error)}`;
      return;
    }
    // Confirm against the ORIGINAL Run facts; a queued intent for a Run that has
    // not reached the Kernel is honestly reported as unconfirmed, never faked.
    let confirm: ReadResult<TaskExecutionRecord>;
    try {
      confirm = await dependencies.executions.readExecution(independentContext(handle), runRef);
    } catch {
      handle.reason = 'the cancel was delivered, but the Run could not be re-read to confirm it';
      return;
    }
    if (confirm.status === 'ready' && confirm.value.run.status === 'ended' && confirm.value.run.outcome === 'cancelled') {
      handle.reason = null;
    } else {
      handle.reason = 'the driver stopped, but the original Run did not confirm cancellation; its occupancy is left untouched';
    }
  }

  function stopHandle(handle: Handle): Promise<void> {
    if (handle.stopDrain !== null) return handle.stopDrain;
    if (isTerminal(handle.state)) return Promise.resolve();
    handle.stopRequested = true;
    handle.stopReason ??= 'the collaboration driver was asked to stop';
    handle.state = 'stopping';
    handle.activePumpAbort?.abort('driver_stopped');
    handle.stopDrain = (async () => {
      // Cancel the currently-known Run, let the loop drain (a Run claimed while
      // stopping is recorded by the loop before it breaks), then do the final
      // cancel for that late Run. Only then does `stopped` become true.
      await requestCancel(handle);
      await handle.done.catch(() => { /* the loop stored its own reason */ });
      await requestCancel(handle);
      if (!isTerminal(handle.state)) handle.state = 'stopped';
    })();
    return handle.stopDrain;
  }

  return {
    addProfiles(profiles) {
      for (const profile of profiles) {
        const clone = structuredClone(profile);
        const index = trustedProfiles.findIndex(existing => existing.id === clone.id);
        if (index >= 0) trustedProfiles[index] = clone;
        else trustedProfiles.push(clone);
      }
    },
    async start(ctx, input) {
      if (!nonEmpty(ctx.projectId) || !nonEmpty(ctx.workspaceId)) {
        return rejected('forbidden', 'the collaboration driver requires a bound project/workspace context');
      }
      const advance = (() => { try { return structuredClone(input?.advance); } catch { return null; } })();
      if (!isRecord(advance) || !isGoalRef(advance['goalRef'])) {
        return rejected('invalid', 'driver start requires a complete WorkflowAdvanceInput');
      }
      const goalRef = advance['goalRef'];
      if (goalRef.projectId !== ctx.projectId) return rejected('forbidden', 'the driver Goal is outside the bound project');
      const requested = Array.isArray(input?.queryProfileIds) ? input.queryProfileIds.filter(nonEmpty) : [];
      const profiles = selectProfiles(ctx.projectId, ctx.workspaceId!, requested);
      const typedAdvance = advance as unknown as WorkflowAdvanceInput;
      const seedMaterial = { advance: typedAdvance, queryProfileIds: [...requested].sort() };
      const seed = canonicalOf(seedMaterial) ?? sha256Hex(canonicalJson(seedMaterial as unknown as JsonValue));
      const taskId = nonEmpty(advance['taskId']) ? advance['taskId'] : null;
      const key = handleKey(ctx.projectId, ctx.workspaceId!, goalRef.goalId, taskId);
      const existing = handles.get(key);
      if (existing !== undefined) {
        // Same seed always replays the ORIGINAL snapshot without a model call,
        // even after the owner returned `waiting`.
        if (existing.seed === seed) return { status: 'ready', value: snapshot(existing) };
        if (isActive(existing.state) || existing.wakeWaiting) return rejected('busy', 'another collaboration advancement is already active for this Task');
      }
      const handle: Handle = {
        key, projectId: ctx.projectId, workspaceId: ctx.workspaceId!,
        goalRef: structuredClone(goalRef), flowId: typedAdvance.flowId, taskId, seed, profiles,
        context: snapshotContext(ctx),
        state: 'running', current: structuredClone(typedAdvance), last: null, reason: null,
        messages: [], messageKeys: new Set(), currentRun: null,
        stopRequested: false, stopReason: null, wakeWaiting: false, abort: new AbortController(),
        activePumpAbort: null, stopDrain: null, done: Promise.resolve(),
      };
      handles.set(key, handle);
      handle.done = runHandle(handle);
      return { status: 'ready', value: snapshot(handle) };
    },
    async read(ctx, input) {
      if (!nonEmpty(ctx.projectId) || !nonEmpty(ctx.workspaceId)) {
        return rejected('forbidden', 'the driver read requires a bound scope');
      }
      const goalRef = input?.goalRef;
      if (!isGoalRef(goalRef) || goalRef.projectId !== ctx.projectId) {
        return rejected('invalid', 'driver read requires a complete in-project GoalRef');
      }
      const requestedTask = nonEmpty(input?.taskId) ? input.taskId : null;
      const handle = requestedTask === null
        ? goalHandles(ctx.projectId, ctx.workspaceId!, goalRef.goalId)[0]
        : handles.get(handleKey(ctx.projectId, ctx.workspaceId!, goalRef.goalId, requestedTask));
      if (handle === undefined) return { status: 'not_found' };
      return { status: 'ready', value: snapshot(handle) };
    },
    async stop(ctx, input) {
      if (!nonEmpty(ctx.projectId) || !nonEmpty(ctx.workspaceId)) {
        return rejected('forbidden', 'the driver stop requires a bound scope');
      }
      const goalRef = input?.goalRef;
      if (!isGoalRef(goalRef) || goalRef.projectId !== ctx.projectId) {
        return rejected('invalid', 'driver stop requires a complete in-project GoalRef');
      }
      const requestedTask = nonEmpty(input?.taskId) ? input.taskId : null;
      const targets = requestedTask === null
        ? goalHandles(ctx.projectId, ctx.workspaceId!, goalRef.goalId)
        : [handles.get(handleKey(ctx.projectId, ctx.workspaceId!, goalRef.goalId, requestedTask))!]
            .filter((candidate): candidate is Handle => candidate !== undefined);
      if (targets.length === 0) return { status: 'not_found' };
      for (const handle of targets) {
        if (!isTerminal(handle.state)) void stopHandle(handle);
      }
      // Returns immediately with the FIRST target's snapshot; its cancel and the
      // original-promise drain settle in the background and become `stopped`.
      return { status: 'ready', value: snapshot(targets[0]!) };
    },
    async close() {
      const all = [...handles.values()];
      handles.clear();
      await Promise.all(all.map(handle => stopHandle(handle).catch(() => { /* close still drains */ })));
    },
  };
}
