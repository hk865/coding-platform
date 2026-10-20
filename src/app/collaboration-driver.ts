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
import type { SessionRef } from '../contracts/core/identity.js';
import type { MessageRecipient } from '../contracts/core/session-message.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../contracts/fingerprint.js';
import type { RuntimeExecutionPort } from '../core/agent-runtime/ports.js';
import type { ExecutionReadPort, TaskExecutionRecord } from '../core/work-graph/model/execution-read-contracts.js';
import type { RunControlPort } from '../core/work-graph/tasks/control-contracts.js';
import type { SessionDirectoryPort } from '../core/work-graph/model/session-contracts.js';
import type {
  SessionMailboxPort,
  SessionMessage,
} from '../core/work-graph/model/communication-contracts.js';
import type {
  ConsultationInput,
  ConsultationResult,
  FailedCardRefV1,
  WorkflowAdvanceInput,
  WorkflowAdvanceInternal,
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
 * Task E change notice: a handle of this Goal (the selected Task or a sibling)
 * changed what `read` would return. It carries no snapshot; the page re-reads.
 */
export type CollaborationChange = {
  scope: { projectId: string; workspaceId: string };
  goalId: string;
  taskId: string | null;
};

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
  /** Optional Host change feed (task E). Called only when a handle's published
   * projection moved; a notification never changes the driver. */
  onChange?: (change: CollaborationChange) => void;
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
/**
 * §4.6 recipient narrowing: the widened `MessageRecipient` union is a Session
 * ref or the workspace user address. `SessionRef` has no `kind`, so its absence
 * is the exact Session discriminator; the user address is never treated as a
 * Session and never consulted through `readSession`.
 */
function isSessionRecipient(recipient: MessageRecipient): recipient is SessionRef {
  return !('kind' in recipient);
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
  /**
   * K3 UR7 rework 1: the discriminated cards whose ② already failed in this
   * continuous selection, carried to the next Workflow advance as its internal
   * third argument. Never part of the public snapshot.
   */
  failedCardRefs: FailedCardRefV1[];
  reason: string | null;
  messages: SessionMessage[];
  messageKeys: Set<string>;
  currentRun: RunRef | null;
  stopRequested: boolean;
  stopReason: string | null;
  /** True while the handle is genuinely parked on a yielded continuation wait. */
  wakeWaiting: boolean;
  /** The driver's own lifetime signal; never aborted (stop aborts `activePumpAbort`). */
  abort: AbortController;
  /** The live consultation pump signal; aborted on stop/close/run end. */
  activePumpAbort: AbortController | null;
  /** One-shot drain promise so stop and close cannot double-drain. */
  stopDrain: Promise<void> | null;
  done: Promise<void>;
  /** Task E: digest of the projection last announced to the change feed. */
  announced: string | null;
};

/**
 * §4.5 line 890: one advance waiting at a claim/create safe point. The per-scope
 * rendezvous pass releases it only when its turn in the single computed order
 * arrives; the entries behind it then wait on its `proceeded`.
 */
type PendingAdvance = {
  advance: WorkflowAdvanceInput;
  /** Resolves when the pass releases this entry to make its Workflow call. */
  released: Promise<void>;
  release: () => void;
  /** Resolves when this advance made (or will never make) its Workflow call. */
  proceeded: Promise<void>;
  /** Resolve `proceeded` and leave the pending set. Idempotent. */
  proceed: () => void;
};

/** The caller's release for the safe point it was admitted at. */
type AdvanceAdmission = { proceed: () => void };

function safePointScopeKey(projectId: string, workspaceId: string): string {
  return `${projectId}\u0000${workspaceId}`;
}

export function createCollaborationDriver(dependencies: CollaborationDriverDependencies): CollaborationDriver {
  const handles = new Map<string, Handle>();
  /**
   * §4.5 line 890: the in-memory pending advances at the claim/create safe point
   * and the one running rendezvous pass of each bound scope. There is no
   * persisted queue and no scheduler type.
   */
  const pendingAdvances = new Map<string, PendingAdvance[]>();
  const rendezvousPasses = new Map<string, Promise<void>>();
  /** The safe-point wait of a handle, released at once by a stop. */
  const admissionWaits = new Map<Handle, () => void>();
  const trustedProfiles = dependencies.profiles.map(profile => structuredClone(profile));
  let closed = false;

  /**
   * Task E: announce a handle whose `read` projection moved. It is called at the
   * loop, tick and stop boundaries instead of at every field write; the digest
   * makes an unchanged tick free, so a blocked handle produces no notices.
   */
  function changed(handle: Handle): void {
    const notify = dependencies.onChange;
    if (notify === undefined || closed) return;
    let digest: string | null;
    try {
      digest = JSON.stringify([handle.state, handle.reason, handle.current, handle.last,
        handle.messages.map(message => [canonicalOf(message.ref), message.revision, message.status])]);
    } catch {
      digest = null;
    }
    if (digest !== null && digest === handle.announced) return;
    handle.announced = digest;
    try {
      notify({ scope: { projectId: handle.projectId, workspaceId: handle.workspaceId },
        goalId: handle.goalRef.goalId, taskId: handle.taskId });
    } catch { /* the change feed is best effort; reads stay authoritative */ }
  }
  /** One driver tick: announce a moved projection, then wait. */
  function tick(handle: Handle, signal: AbortSignal): Promise<void> {
    changed(handle);
    return sleep(TICK_MS, signal);
  }

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

  /** Match one inquiry wait to exactly one same-scope/role trusted profile. */
  async function consultFor(
    handle: Handle, message: SessionMessage, signal: AbortSignal,
  ): Promise<{ ok: true; profile: WorkbenchQueryProfile } | { ok: false; reason: string }> {
    if (!isSessionRecipient(message.recipient)) {
      return { ok: false, reason: 'the wait recipient is the workspace user, not a Session' };
    }
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

  /**
   * §4.5 `orderGoalAdvances` safe point. The Host calls it only at the
   * claim/create selection point, handing the currently pending competing
   * advances to the Workflow, which orders them by `Goal.settings.order`, then
   * the Goal key, then flowId/taskId and changes nothing. The seam is consulted
   * whenever there is a real pending set; a refused/foreign result falls back to
   * the caller's original order.
   */
  async function orderAdvanceSelection(
    ctx: CoreCallContext, advances: WorkflowAdvanceInput[],
  ): Promise<WorkflowAdvanceInput[]> {
    if (advances.length === 0) return advances;
    const order = dependencies.workflow.orderGoalAdvances;
    if (order === undefined) return advances;
    const ordered = await order.call(dependencies.workflow, ctx, { advances });
    return ordered.status === 'ready' && ordered.value.advances.length === advances.length
      ? ordered.value.advances : advances;
  }

  /**
   * §4.5 line 890 safe point. One rendezvous pass per bound scope takes the
   * advances pending together, hands that ONE set to `orderGoalAdvances`, and
   * releases the entries in that one returned order, waiting only until each
   * released advance has made its Workflow call. A single shared ordering makes
   * the wait graph acyclic by construction: no entry can wait on an entry that
   * waits back on it, because both were released by the same pass order.
   * `sessionHint: null` selections take part; a handle that already made its
   * call, holds a claimed/started Run, waits for a reply or observes a completed
   * step is not pending and never competes. The wait is bounded (one microtask
   * to batch a turn, then only the earlier Workflow calls): no sleep loop, no
   * persisted state, no new scheduler type. Returns the ticket the caller must
   * `proceed()` immediately before the Workflow call, or null when this handle
   * was stopped/aborted before admission.
   */
  async function awaitAdvanceAdmission(handle: Handle, advance: WorkflowAdvanceInput): Promise<AdvanceAdmission | null> {
    if (handle.stopRequested) return null;
    if (dependencies.workflow.orderGoalAdvances === undefined) {
      // An absent seam is refused/unsupported ordering: keep the caller's
      // (arrival) order with no waiting at all and no extra microtask hop.
      return { proceed: () => { /* no pending entry */ } };
    }
    const scopeKey = safePointScopeKey(handle.projectId, handle.workspaceId);
    let pending = pendingAdvances.get(scopeKey);
    if (pending === undefined) { pending = []; pendingAdvances.set(scopeKey, pending); }

    let resolveReleased!: () => void;
    const released = new Promise<void>(resolvePromise => { resolveReleased = resolvePromise; });
    let resolveProceeded!: () => void;
    const proceeded = new Promise<void>(resolvePromise => { resolveProceeded = resolvePromise; });
    let left = false;
    const entry: PendingAdvance = {
      advance,
      released,
      release: () => resolveReleased(),
      proceeded,
      proceed: () => {
        if (left) return;
        left = true;
        resolveProceeded();
        const list = pendingAdvances.get(scopeKey);
        if (list === undefined) return;
        const index = list.indexOf(entry);
        if (index >= 0) list.splice(index, 1);
        if (list.length === 0) pendingAdvances.delete(scopeKey);
      },
    };
    pending.push(entry);
    if (!rendezvousPasses.has(scopeKey)) {
      // The pass runs one ordering function over the whole batch; its context is
      // read-only and the seam only binds project/workspace (all handles in this
      // bound scope share those).
      const pass = runRendezvous(scopeKey, loopContext(handle));
      rendezvousPasses.set(scopeKey, pass);
      void pass.catch(() => { /* runRendezvous releases every entry, even on failure */ });
    }
    let handedOff = false;
    admissionWaits.set(handle, entry.release);
    try {
      await released;
      if (handle.stopRequested) return null;
      handedOff = true;
      return { proceed: entry.proceed };
    } finally {
      admissionWaits.delete(handle);
      // A handle that never reaches its Workflow call (stop, close, read failure)
      // still releases the pass waiting on it.
      if (!handedOff) entry.proceed();
    }
  }

  /**
   * The one ordering pass of a bound scope. It batches the advances that reach
   * the safe point in the same turn, orders that single set once, then releases
   * the entries one by one and waits only until each has made its Workflow call.
   * Every entry is released by this one order, so the wait graph has no cycle.
   * Later arrivals are handled by the same pass in a following batch (or by a
   * fresh pass once this one has drained).
   */
  async function runRendezvous(scopeKey: string, ctx: CoreCallContext): Promise<void> {
    try {
      for (;;) {
        // Let advances that reach this same safe point in the same turn join the
        // batch before the seam reads it. One microtask, not a sleep loop.
        await Promise.resolve();
        const pending = pendingAdvances.get(scopeKey);
        if (pending === undefined || pending.length === 0) return;
        const snapshot = pending.slice();
        let ordered: WorkflowAdvanceInput[];
        try {
          ordered = await orderAdvanceSelection(ctx, snapshot.map(candidate => candidate.advance));
        } catch {
          // A throwing seam is refused/unsupported: keep the caller's arrival order.
          ordered = snapshot.map(candidate => candidate.advance);
        }
        const orderedEntries: PendingAdvance[] = [];
        for (const candidate of ordered) {
          const found = snapshot.find(other => other.advance === candidate);
          if (found !== undefined && !orderedEntries.includes(found)) orderedEntries.push(found);
        }
        // Any entry the seam did not return keeps the caller's order at the end.
        for (const entry of snapshot) if (!orderedEntries.includes(entry)) orderedEntries.push(entry);
        for (const entry of orderedEntries) {
          const list = pendingAdvances.get(scopeKey);
          if (list === undefined || !list.includes(entry)) { entry.proceed(); continue; }
          entry.release();
          // The wait ends as soon as this advance has made its Workflow call.
          await entry.proceeded;
        }
      }
    } finally {
      // This pass is over; a later arrival starts a fresh pass. Release anything
      // still pending so no handle can wait forever.
      rendezvousPasses.delete(scopeKey);
      const leftover = pendingAdvances.get(scopeKey);
      if (leftover !== undefined) for (const entry of leftover) entry.release();
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
          // §4.6: a message addressed to the workspace user counts as a live
          // wait but is never consulted as a Session; only Session recipients
          // enter `consultOne`. The user reply is consumed by the ordinary
          // `awaitWake`/Goal continuation rules, not by this pump.
          const needsReply = all.filter(message => message.status !== 'responded'
            && (isSessionRecipient(message.recipient)
              ? message.sender.kind === 'work_run'
                && message.intent === 'inquiry'
              : message.intent === 'decision_request' && message.needsReply === true));
          const waiting = needsReply.filter(message => isSessionRecipient(message.recipient));
          if (needsReply.length === 0) {
            if (manageState && handle.state === 'waiting_for_reply') handle.state = 'running';
          } else {
            if (manageState && needsReply.some(message => message.waitAfterSend === true
              || !isSessionRecipient(message.recipient))) handle.state = 'waiting_for_reply';
            for (const message of waiting) {
              if (signal.aborted || handle.stopRequested) break;
              // A consultation can run a whole Query; announce the wait first.
              changed(handle);
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
      await tick(handle, signal);
    }
  }

  /** Poll ONLY the exact saved wait message; zero model calls while absent. */
  async function awaitWake(handle: Handle, continuation: RunContinuationV1, signal: AbortSignal): Promise<boolean> {
    try {
      while (!handle.stopRequested && !signal.aborted) {
        // A reply does not revoke a human pause/cancel. Keep this same waiter
        // dormant while paused; explicit resume changes the original Run fact.
        const runRef = handle.currentRun;
        if (runRef === null) { handle.reason = 'the original yielded Run is not known'; return false; }
        const execution = await dependencies.executions.readExecution(independentContext(handle), runRef);
        if (execution.status !== 'ready') {
          handle.reason = 'the original yielded Run control is not readable';
          await tick(handle, signal); continue;
        }
        const desired = execution.value.run.controlState?.desiredState;
        if (desired === 'cancelled' || execution.value.run.outcome === 'cancelled') {
          handle.reason = 'the original execution was cancelled; saved replies remain readable';
          return false;
        }
        if (desired === 'paused') {
          handle.reason = 'the original execution is paused; awaiting explicit resume';
          await tick(handle, signal); continue;
        }
        let read;
        try {
          read = await dependencies.mailbox.readMessage(
            contextWith(handle.context, handle.workspaceId, signal), continuation.messageRef);
        } catch {
          handle.reason = 'the continuation wait message read failed';
          await tick(handle, signal);
          continue;
        }
        if (read.status === 'ready' && read.value.status === 'responded' && read.value.response !== null) return true;
        if (read.status === 'rejected' && read.code === 'forbidden') { handle.reason = read.reason; return false; }
        await tick(handle, signal);
      }
      return false;
    } finally {
      // The shared wake signal is owned by the caller and aborted there.
    }
  }

  async function runWithPump(handle: Handle, runRef: RunRef, input: WorkflowAdvanceInput,
    internal: WorkflowAdvanceInternal, admission: AdvanceAdmission | null = null): Promise<WorkflowAdvanceResult> {
    handle.currentRun = structuredClone(runRef);
    const fresh = await freshStart(handle, runRef);
    const pumpAbort = new AbortController();
    // Stop/close abort `activePumpAbort`, the pump signal every consultation
    // call receives.
    handle.activePumpAbort = pumpAbort;
    let drain = false;
    const pumpDone = fresh ? pump(handle, runRef, pumpAbort.signal, true, () => drain) : null;
    if (!fresh) handle.reason = 'the Run was already entered or settled; only observing the original facts';
    changed(handle);
    try {
      // The safe-point wait ends here: the Workflow call is about to be made.
      admission?.proceed();
      return await dependencies.workflow.advanceWork(loopContext(handle), input, internal);
    } finally {
      // Sender completion/yield is not cancellation of an already-started
      // consultation. Drain it and one final saved-outbox scan before returning.
      // Explicit stop/close still abort this signal and we await the same promise.
      drain = true;
      if (pumpDone !== null) await pumpDone.catch(() => { /* the pump recorded its own reason */ });
      if (handle.activePumpAbort === pumpAbort) handle.activePumpAbort = null;
    }
  }

  /** Make the claim/create Workflow call, releasing the safe-point waiters first. */
  async function advanceWorkNow(handle: Handle, input: WorkflowAdvanceInput,
    internal: WorkflowAdvanceInternal, admission: AdvanceAdmission | null): Promise<WorkflowAdvanceResult> {
    admission?.proceed();
    return dependencies.workflow.advanceWork(loopContext(handle), input, internal);
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
    let openAdmission: AdvanceAdmission | null = null;
    try {
      let input = handle.current;
      // The `select_work` the Workflow returns after `complete_task`, pinned to
      // that same Task, only observes the satisfied Task; it never claims or
      // creates work, so it never enters the ordering safe point and never waits.
      let observingCompletedStep = false;
      while (input !== null && !handle.stopRequested) {
        changed(handle);
        const observation = observingCompletedStep;
        observingCompletedStep = false;
        // §4.5 line 890 safe point: a `select_work` step claims/creates work. Only
        // the advances pending together in the same bound scope compete; the
        // order decides which calls the Workflow first and the others wait only
        // until that call is made. An already-admitted handle (holding a
        // claimed/started Run, waiting for a reply, observing a completed step)
        // is never a competitor and never waits.
        if (input.kind === 'select_work' && !observation) {
          openAdmission = await awaitAdvanceAdmission(handle, input);
          if (openAdmission === null) return;
        }
        const startRun = startRunRefOf(input);
        // K3 UR7 rework 1: the failed-card set travels ONLY through this internal
        // third argument, never inside the public request.
        const internal: WorkflowAdvanceInternal = handle.failedCardRefs.length === 0
          ? {} : { failedCardRefs: handle.failedCardRefs };
        const result = startRun === null
          ? await advanceWorkNow(handle, input, internal, openAdmission)
          : await runWithPump(handle, startRun, input, internal, openAdmission);
        openAdmission = null;
        // Record the REAL receipt/Run BEFORE honoring a concurrent stop, so a Run
        // claimed/prepared while stop was requested is never lost.
        handle.last = result;
        // The Workflow returns the set beside `next` only while the continuous
        // selection continues; any other state ends it and drops the set.
        if (result.status === 'ready' && result.value.failedCardRefs !== undefined) {
          handle.failedCardRefs = structuredClone(result.value.failedCardRefs);
        } else {
          handle.failedCardRefs = [];
        }
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
            // This Goal-scope selection may claim/create other work of the Goal,
            // so it takes part in the ordering safe point like any selection.
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
        observingCompletedStep = value.receipt?.kind === 'complete_task'
          && value.next.kind === 'select_work' && value.next.taskId !== undefined;
      }
    } catch (error) {
      if (!handle.stopRequested) {
        handle.state = 'failed';
        handle.reason = `the Workflow advancement failed: ${messageOf(error)}`;
      }
    } finally {
      // A safe point that never reached its Workflow call must still release the
      // advances ordered behind it; `proceed` is idempotent.
      openAdmission?.proceed();
      handle.current = null;
      handle.failedCardRefs = [];
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
    changed(handle);
    handle.activePumpAbort?.abort('driver_stopped');
    admissionWaits.get(handle)?.();
    handle.stopDrain = (async () => {
      // Cancel the currently-known Run, let the loop drain (a Run claimed while
      // stopping is recorded by the loop before it breaks), then do the final
      // cancel for that late Run. Only then does `stopped` become true.
      await requestCancel(handle);
      await handle.done.catch(() => { /* the loop stored its own reason */ });
      await requestCancel(handle);
      if (!isTerminal(handle.state)) handle.state = 'stopped';
      changed(handle);
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
      // §4.5 line 890 safe point: the busy check and `handles.set` stay in one
      // synchronous block (no second concurrent start can slip between them).
      // The handle always advances its OWN request; ordering among the advances
      // pending together at the claim/create point is enforced by
      // `awaitAdvanceAdmission` inside the loop, never by a discarded call here.
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
        state: 'running', current: structuredClone(typedAdvance), last: null,
        failedCardRefs: [], reason: null,
        messages: [], messageKeys: new Set(), currentRun: null,
        stopRequested: false, stopReason: null, wakeWaiting: false, abort: new AbortController(),
        activePumpAbort: null, stopDrain: null, done: Promise.resolve(), announced: null,
      };
      handles.set(key, handle);
      changed(handle);
      // The loop's final transition (completed/failed/waiting) is announced when
      // the loop settles.
      handle.done = runHandle(handle).finally(() => changed(handle));
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
      closed = true;
      const all = [...handles.values()];
      handles.clear();
      await Promise.all(all.map(handle => stopHandle(handle).catch(() => { /* close still drains */ })));
    },
  };
}
