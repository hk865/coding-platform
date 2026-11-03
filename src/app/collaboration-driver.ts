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
import type { CommitCursor } from '../contracts/command-event.js';
import type { RunContinuationV1, RunRef } from '../contracts/dispatch.js';
import type { GoalRef } from '../contracts/ledger.js';
import type { SessionRef, WorkspaceScope } from '../contracts/core/identity.js';
import type { MessageRecipient } from '../contracts/core/session-message.js';
import { messageOf } from '../contracts/error-message.js';
import { rejected } from '../contracts/core/rejections.js';
import { canonicalJson, sameJson as sameCanonical, sha256Hex, type JsonValue } from '../contracts/fingerprint.js';
import { isRecord, nonEmpty } from '../contracts/validation/common.js';
import type { RuntimeExecutionPort } from '../core/agent-runtime/ports.js';
import type { ExecutionReadPort, TaskExecutionRecord } from '../core/work-graph/model/execution-read-contracts.js';
import type { RunControlPort } from '../core/work-graph/tasks/control-contracts.js';
import type { SessionDirectoryPort } from '../core/work-graph/model/session-contracts.js';
import type {
  SessionMailboxPort,
  SessionMessage,
} from '../core/work-graph/model/communication-contracts.js';
import { waitStateOf, waitFactsOfRecord } from '../core/work-graph/state/message-machine.js';
import type {
  ConsultationInput,
  ConsultationResult,
  FailedCardRefV1,
  GoalWaitBasisV1,
  WorkflowAdvanceInput,
  WorkflowAdvanceInternal,
  WorkflowAdvanceResult,
} from '../business/workflow/contracts.js';
import type { GoalWaitDrainPort, WorkflowPort } from '../business/workflow/ports.js';
import type { RepairActivationService } from '../core/work-graph/notes/activate-repair.js';
import type { WorkbenchQueryProfile } from './runtime-configuration.js';
import type { GoalWaitWakes } from './goal-wait-wakes.js';
import { GOAL_WAIT_WAKE_AGGREGATE_TYPES } from './goal-wait-wakes.js';

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
  /** BW: resume the Goal's parked handle, or start one; one Workflow advance, no model call. */
  wake(ctx: CoreCallContext, goalRef: GoalRef): Promise<void>;
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
  /** Optional Host hook: a NEW Goal-scoped handle started. A replay or a refused start never calls it. */
  onStarted?: (ctx: CoreCallContext, goalRef: GoalRef) => Promise<unknown>;
  /** H's resolver over the Host's one `GoalWaitWakes` per workspace scope; absent keeps today's exact-message poll. */
  goalWaits?: (scope: WorkspaceScope) => Pick<GoalWaitWakes, 'register' | 'leave'>;
  /** slice-PL-SPEC §6.1.2 steps 7–8, §5.1.4 action 1: one pass of the Host's goal-wait queue
   * between the register and the send; absent on a driver the Host has not bound. */
  drainGoalWaits?: GoalWaitDrainPort;
  /** The Host's observed commit head, sampled immediately BEFORE the advance that can return `waiting`;
   * absent keeps today's poll. */
  observedCursor?: () => CommitCursor | null;
  repairs?: Pick<RepairActivationService, 'attemptRepairsForGoal'>;
  redriveRepairAnswers?: (ctx: CoreCallContext, input: { goalRef: GoalRef }) => Promise<void>;
};

const TICK_MS = 500;
const MAX_PROJECTED_MESSAGES = 50;

type UnknownRecord = Record<string, unknown>;

function canonicalOf(value: unknown): string | null {
  try { return canonicalJson(value as JsonValue); } catch { return null; }
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
 * slice-PL-SPEC §6.1.4: a candidate wait also observes `Session`, so a review or adviser line
 * created after the Goal started still wakes it. Both registration sites merge the same kind.
 */
function withSessionWaitKind(basis: GoalWaitBasisV1): GoalWaitBasisV1 {
  return basis.recordKinds.includes('Session') ? basis
    : { ...basis, recordKinds: [...basis.recordKinds, 'Session'] };
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
 * One Run watch: it follows one Task's chain and keeps the `Handle` fields.
 * A watch never registers or leaves the Goal's wait; it hands its basis to the
 * Goal driver (spec §3.3).
 */
type Lane = Handle & {
  taskId: string;
  driver: GoalDriver;
  /** The basis this watch handed back when it parked on a registered wait; null otherwise. */
  handedBack: GoalWaitBasisV1 | null;
};

/**
 * One decision loop per Goal (spec §3.2). It stores only scheduling state; the
 * records stay the truth. `lanes` is the watch table keyed by `handleKey`, the
 * same key rule as the public handles, so one Task never has two watches.
 */
type GoalDriver = Handle & {
  taskId: null;
  lanes: Map<string, Lane>;
  activeTaskIds: Set<string>;
  /** Set by a wake, a watch end or a task start; only the loop reads and clears it. */
  recheck: boolean;
  /** The one running decision, or null when idle. */
  deciding: Promise<void> | null;
  /** True once this driver accepted a Goal-scope start (or wake created it). */
  accepted: boolean;
  /** True while this driver holds the Goal's one registered wait. */
  registered: boolean;
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
  function announceHandle(handle: Handle): void {
    const notify = dependencies.onChange;
    if (notify === undefined || closed) return;
    let digest: string | null;
    try {
      // §3.1:125 / §4.2: the Goal summary is the same state the read publishes,
      // its messages, and its sibling summaries; a watch announces its own row.
      const summary = handle.taskId === null
        ? [driverStateForRead(handle as GoalDriver),
          [...(handle as GoalDriver).lanes.values()].map(lane => [lane.taskId, lane.state, lane.reason])]
        : [handle.state];
      digest = JSON.stringify([summary, handle.reason, handle.current, handle.last,
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
  /** A watch's change also announces its Goal through the same changed boundary. */
  function changed(handle: Handle): void {
    announceHandle(handle);
    if (handle.taskId !== null) announceHandle((handle as Lane).driver);
  }
  /** One driver tick: announce a moved projection, then wait. */
  function tick(handle: Handle, signal: AbortSignal): Promise<void> {
    changed(handle);
    return sleep(TICK_MS, signal);
  }

  function driverOf(projectId: string, workspaceId: string, goalId: string): GoalDriver | undefined {
    return handles.get(handleKey(projectId, workspaceId, goalId, null)) as GoalDriver | undefined;
  }
  /**
   * The public selection order of one Goal's objects (W4): the first object that
   * became public keeps the first position. A container's creation is internal;
   * it enters this order only when it first accepts a Goal-scope start, so a
   * Task watch started earlier stays ahead of it (spec §4.2:263).
   */
  function publicTargetOf(projectId: string, workspaceId: string, goalId: string): Handle | undefined {
    for (const handle of goalHandles(projectId, workspaceId, goalId)) {
      if (handle.taskId !== null || (handle as GoalDriver).accepted) return handle;
    }
    return undefined;
  }
  /** W4: a container joins the public order at its first accepted Goal start. */
  function enterPublicOrder(driver: GoalDriver): void {
    if (driver.accepted) return;
    driver.accepted = true;
    handles.delete(driver.key);
    handles.set(driver.key, driver);
  }
  function handleSiblings(handle: Handle): CollaborationSnapshot['siblings'] {
    const result: CollaborationSnapshot['siblings'] = [];
    const driver = handle.taskId === null ? handle as GoalDriver : (handle as Lane).driver;
    for (const lane of driver.lanes.values()) {
      if (lane.key === handle.key) continue;
      result.push({ taskId: lane.taskId, state: lane.state, reason: lane.reason });
    }
    return result;
  }
  /** §4.2:270-276: the Goal driver's published state, first matching row wins. */
  function driverStateForRead(driver: GoalDriver): CollaborationState {
    const lanes = [...driver.lanes.values()];
    const laneRunning = lanes.some(lane => lane.state === 'running');
    if (driver.state === 'stopped') return 'stopped';
    if (driver.state === 'stopping' || driver.stopRequested) return 'stopping';
    if (driver.state === 'completed') return 'completed';
    if (driver.state === 'failed' && !laneRunning) return 'failed';
    // §4.2: a decision parked on a yielded reply keeps its promise live; the
    // parked wait is still what the Goal publishes, not the live decision.
    if (driver.state === 'waiting_for_reply' && !laneRunning) return 'waiting_for_reply';
    // §4.2: the loop writes `running` before its first `changed()`; `deciding`
    // is assigned only after that synchronous entry returns, so the written
    // state is part of the running row too.
    if (driver.state === 'running' || driver.deciding !== null || laneRunning) return 'running';
    if (lanes.some(lane => lane.state === 'waiting_for_reply') || driver.registered) return 'waiting_for_reply';
    return 'waiting';
  }
  function snapshot(handle: Handle): CollaborationSnapshot {
    return {
      goalRef: structuredClone(handle.goalRef),
      flowId: handle.flowId,
      taskId: handle.taskId,
      siblings: handleSiblings(handle),
      state: handle.taskId === null ? driverStateForRead(handle as GoalDriver) : handle.state,
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
    projectOne(handle, message);
    // §4.2: the Goal read keeps showing what its Run watches pumped; a watch is replaced, the Goal driver is not.
    if (handle.taskId !== null) projectOne((handle as Lane).driver, message);
  }
  function projectOne(handle: Handle, message: SessionMessage): void {
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
            if (manageState && !handle.stopRequested && handle.state === 'waiting_for_reply') handle.state = 'running';
          } else {
            if (manageState && !handle.stopRequested && needsReply.some(message => message.waitAfterSend === true
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
        if (read.status === 'ready') {
          const wait = waitStateOf(read.value, waitFactsOfRecord(read.value));
          if (wait.state === 'answered' || wait.state === 'expired') return true;
          if (wait.state === 'consumed' || wait.state === 'withdrawn') return false;
        }
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

  /** The Task a long step belongs to: `perform:start` names it in its prepared claim; `run_check` in its round. */
  function longStepTaskIdOf(input: WorkflowAdvanceInput | null): string | null {
    if (input === null || input.kind !== 'perform') return null;
    const operation = input.operation as unknown as UnknownRecord;
    if (operation['kind'] === 'start') {
      const request = isRecord(operation['request']) ? operation['request'] : {};
      const prepared = isRecord(request['prepared']) ? request['prepared'] : {};
      const claim = isRecord(prepared['claim']) ? prepared['claim'] : {};
      const task = isRecord(claim['task']) ? claim['task'] : {};
      return nonEmpty(task['taskId']) ? task['taskId'] as string : null;
    }
    if (operation['kind'] === 'run_check') {
      const request = isRecord(operation['request']) ? operation['request'] : {};
      const requestInput = isRecord(request['input']) ? request['input'] : {};
      const roundRef = isRecord(requestInput['roundRef']) ? requestInput['roundRef'] : {};
      return nonEmpty(roundRef['taskId']) ? roundRef['taskId'] as string : null;
    }
    return null;
  }

  function makeHandle(projectId: string, workspaceId: string, context: TrustedContext, goalRef: GoalRef,
    flowId: string, seed: string, profiles: readonly WorkbenchQueryProfile[], taskId: string | null,
    current: WorkflowAdvanceInput | null): Handle {
    return {
      key: handleKey(projectId, workspaceId, goalRef.goalId, taskId),
      projectId, workspaceId, goalRef: structuredClone(goalRef), flowId, taskId, seed, profiles,
      context: structuredClone(context), state: 'running',
      current: current === null ? null : structuredClone(current), last: null,
      failedCardRefs: [], reason: null,
      messages: [], messageKeys: new Set(), currentRun: null,
      stopRequested: false, stopReason: null, wakeWaiting: false,
      abort: new AbortController(),
      activePumpAbort: null, stopDrain: null, done: Promise.resolve(), announced: null,
    };
  }

  function installDriver(ctx: CoreCallContext, goalRef: GoalRef, flowId: string, seed: string,
    profiles: readonly WorkbenchQueryProfile[], advance: WorkflowAdvanceInput | null,
    accepted: boolean): GoalDriver {
    const workspaceId = ctx.workspaceId!;
    const base = makeHandle(ctx.projectId, workspaceId, snapshotContext(ctx), goalRef, flowId, seed,
      profiles, null, advance);
    const driver: GoalDriver = {
      ...base, taskId: null, lanes: new Map(), activeTaskIds: new Set(), recheck: false,
      deciding: null, accepted, registered: false,
    };
    if (!accepted) driver.state = 'waiting';
    handles.set(driver.key, driver);
    return driver;
  }

  function installLane(driver: GoalDriver, context: TrustedContext, profiles: readonly WorkbenchQueryProfile[],
    seed: string, flowId: string, taskId: string, current: WorkflowAdvanceInput,
    failedCardRefs: readonly FailedCardRefV1[]): Lane {
    const base = makeHandle(driver.projectId, driver.workspaceId, context, driver.goalRef, flowId, seed,
      profiles, taskId, current);
    base.failedCardRefs = failedCardRefs.map(card => structuredClone(card));
    // The Run is recorded on the watch before the decision clears its handoff
    // slot, so a stop in the admission window still cancels it (P5).
    const runRef = startRunRefOf(current);
    if (runRef !== null) base.currentRun = structuredClone(runRef);
    const lane: Lane = { ...base, taskId, driver, handedBack: null };
    handles.set(lane.key, lane);
    driver.lanes.set(lane.key, lane);
    driver.activeTaskIds.add(taskId);
    return lane;
  }

  /** A watch is busy while its loop runs, yields a reply, or stops; a handed-back parked watch is not. */
  function laneBusy(lane: Lane): boolean {
    return isActive(lane.state) && !(lane.state === 'waiting_for_reply' && lane.handedBack !== null);
  }
  /** Re-open every watch that handed a basis back and is no longer running. */
  function reopenHandedBack(driver: GoalDriver): void {
    for (const lane of driver.lanes.values()) {
      if (lane.handedBack === null || lane.stopRequested) continue;
      lane.handedBack = null;
      lane.last = null;
      lane.reason = null;
      lane.state = 'running';
      lane.current = { schemaVersion: 1, goalRef: lane.goalRef, flowId: lane.flowId,
        sessionHint: null, kind: 'select_work', taskId: lane.taskId };
      driver.activeTaskIds.add(lane.taskId);
      startLaneLoop(lane);
    }
  }

  function startLaneLoop(lane: Lane): void {
    lane.done = runLane(lane).catch(() => { /* runLane records its own reason */ });
  }

  /**
   * Start the one decision when it is idle. A wake never awaits the decision;
   * it only marks `recheck` and lets this kick return at once (spec §3.4).
   */
  function kickDriver(driver: GoalDriver): void {
    if (closed || driver.stopRequested || driver.deciding !== null) return;
    const decision = runDriver(driver);
    driver.deciding = decision;
    driver.done = decision;
    // A rejected decision never escapes as an unhandled rejection: `runDriver`
    // records its own failure, and this one settle clears `deciding` and re-kicks
    // on either branch.
    const settleDecision = (): void => {
      driver.deciding = null;
      changed(driver);
      // DRV-01 (§3.2:156/:160): a wake that arrived after the loop's last
      // `recheck` read but before this clear set `recheck` and was refused by
      // the `deciding !== null` gate above. Kick once more here; the loop owns
      // the recheck and no second queue/field is introduced.
      if (!closed && !driver.stopRequested && driver.recheck) kickDriver(driver);
    };
    void decision.then(settleDecision, settleDecision);
  }

  /** The one admission hold's basis: the same wait for a Goal and for a Task watch. */
  function runningCapBasisOf(handle: Handle): GoalWaitBasisV1 {
    return { projectId: handle.projectId, goalId: handle.goalRef.goalId,
      recordKinds: [...GOAL_WAIT_WAKE_AGGREGATE_TYPES, 'QueryRun'], reasons: ['running_cap'] };
  }
  /** Register the running-cap wait, then run the Host's one admission drain; the drain is awaited. */
  async function holdRunningCapWait(handle: Handle, cursorAtRead: CommitCursor | null): Promise<void> {
    if (cursorAtRead === null) return;
    const scope = { projectId: handle.projectId, workspaceId: handle.workspaceId };
    const waits = dependencies.goalWaits?.(scope);
    waits?.register(runningCapBasisOf(handle), cursorAtRead);
    await dependencies.drainGoalWaits?.(scope);            // merge, order, page
  }

  /**
   * The yielded-reply wait reused by a watch and by the Goal entry (the entry
   * only sees it when its own accepted advance already started the Run). It
   * pumps the Run outbox, waits for the exact saved reply and returns the same
   * Task/Session continuation input; null means the wait ended or was stopped.
   */
  async function awaitYielded(handle: Handle, reason: string | null): Promise<WorkflowAdvanceInput | null> {
    const result = handle.last;
    const continuation = result === null ? null : yieldedContinuationOf(result);
    if (continuation === null || handle.stopRequested) return null;
    handle.state = 'waiting_for_reply';
    handle.reason = reason;
    handle.wakeWaiting = true;
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
      // §3.5:227 — the wait flag is part of this wait's own cleanup. Clearing it
      // after the finally (as before) leaves a stale flag when the execution
      // read throws, and `hasStopResidual` then treats a finished wait as live.
      handle.wakeWaiting = false;
    }
    if (!woken || handle.stopRequested) return null;
    return {
      schemaVersion: 1, goalRef: handle.goalRef, flowId: handle.flowId,
      sessionHint: { projectId: continuation.sessionRef.projectId, sessionId: continuation.sessionRef.sessionId },
      kind: 'select_work', taskId: continuation.task.taskId,
    };
  }

  /**
   * One decision loop (spec §3.2). It follows the Workflow's short steps while
   * the Run is not needed, hands every `start`/`run_check` long step to a new
   * Run watch, and then asks for the next Goal-level selection at once. A change
   * only sets `recheck`; the loop reads and clears it before it exits.
   */
  async function runDriver(driver: GoalDriver): Promise<void> {
    try {
      while (!driver.stopRequested) {
        driver.recheck = false;
        // The old registration must go first, or the same seen commit marks the
        // re-registered wait again (spec §3.2).
        leaveGoalWait(driver);
        driver.state = 'running';
        changed(driver);
        let input: WorkflowAdvanceInput | null = driver.current;
        driver.current = null;
        let observingCompletedStep = false;
        for (;;) {
          if (driver.stopRequested) return;
          if (input === null) {
            input = { schemaVersion: 1, goalRef: driver.goalRef, flowId: driver.flowId,
              sessionHint: null, kind: 'select_work' };
          }
          driver.current = input;
          changed(driver);
          const observation = observingCompletedStep;
          observingCompletedStep = false;
          const longTaskId = longStepTaskIdOf(input);
          if (longTaskId !== null) {
            // Record the real receipt/Run BEFORE honoring a concurrent stop, so a
            // Run claimed/prepared while stopping is never lost.
            const runRef = startRunRefOf(input) ?? driver.currentRun;
            driver.currentRun = runRef === null ? null : structuredClone(runRef);
            if (driver.stopRequested) return;
            const lane = installLane(driver, driver.context, driver.profiles, driver.seed, driver.flowId,
              longTaskId, input, driver.failedCardRefs);
            driver.currentRun = null;
            startLaneLoop(lane);
            input = null;
            continue;
          }
          let admission: AdvanceAdmission | null = null;
          if (input.kind === 'select_work' && !observation) {
            admission = await awaitAdvanceAdmission(driver, input);
            if (admission === null) return;
          }
          const internal: WorkflowAdvanceInternal = {};
          if (driver.failedCardRefs.length > 0) internal.failedCardRefs = driver.failedCardRefs;
          if (driver.activeTaskIds.size > 0) internal.activeTaskIds = [...driver.activeTaskIds];
          // The read's own watermark, sampled immediately before the fact read.
          const cursorAtRead = dependencies.observedCursor?.() ?? null;
          const startRun = startRunRefOf(input);
          const result = startRun === null
            ? await advanceWorkNow(driver, input, internal, admission)
            : await runWithPump(driver, startRun, input, internal, admission);
          driver.last = result;
          if (result.status === 'ready' && result.value.failedCardRefs !== undefined) {
            driver.failedCardRefs = structuredClone(result.value.failedCardRefs);
          } else {
            driver.failedCardRefs = [];
          }
          if (result.status === 'ready') {
            const observedRun = receiptRunRefOf(result) ?? startRunRefOf(result.value.next);
            if (observedRun !== null) driver.currentRun = structuredClone(observedRun);
          }
          if (driver.stopRequested) return;
          if (result.status !== 'ready') {
            driver.state = 'failed';
            driver.reason = result.reason;
            return;
          }
          const value = result.value;
          if (value.state === 'completed') {
            // A Goal-level entry temporarily pins the yielded Task while waking
            // it; finishing that Task is not Goal completion.
            if (input.taskId !== undefined) {
              const goalNext: WorkflowAdvanceInput = { schemaVersion: 1, goalRef: driver.goalRef,
                flowId: driver.flowId, sessionHint: input.sessionHint, kind: 'select_work' };
              driver.current = goalNext;
              input = goalNext;
              continue;
            }
            driver.state = 'completed'; driver.reason = value.reason; return;
          }
          if (value.state === 'waiting') {
            // The admission hold: the freed slot's own commit re-opens this Goal through the queue.
            if (value.reason === 'running_cap') {
              driver.state = 'waiting'; driver.reason = value.reason;
              await holdRunningCapWait(driver, cursorAtRead);
              break;
            }
            const woken = await awaitYielded(driver, value.reason);
            if (woken !== null) { input = woken; driver.current = woken; continue; }
            if (driver.stopRequested) return;
            if (value.waitBasis !== undefined && cursorAtRead !== null) {
              const scope = { projectId: value.waitBasis.projectId, workspaceId: driver.workspaceId };
              const waits = dependencies.goalWaits?.(scope);
              if (waits !== undefined) {
                waits.register(withSessionWaitKind(value.waitBasis), cursorAtRead);
                driver.registered = true;
                // slice-PL-SPEC §5.5.1 steps 5–6: register, drain the Host's queue once, then park.
                await dependencies.drainGoalWaits?.(scope);
                driver.state = 'waiting_for_reply';
              } else {
                driver.state = 'waiting';
              }
            } else {
              driver.state = 'waiting';
            }
            driver.reason = value.reason;
            break;
          }
          if (value.next === null) {
            driver.state = 'waiting'; driver.reason = 'the Workflow returned no next step'; break;
          }
          // §6.1.2 steps 7–8 / DR-P5-11: the plan-round gap step registers the wait BEFORE it sends,
          // using the one cursor sampled before the read that produced this basis. The send's own
          // commit must not be the only thing that wakes the Goal.
          if (value.waitBasis !== undefined && cursorAtRead !== null
            && value.next.kind === 'perform' && value.next.operation.kind === 'send_system_round') {
            const scope = { projectId: value.waitBasis.projectId, workspaceId: driver.workspaceId };
            const waits = dependencies.goalWaits?.(scope);
            waits?.register(withSessionWaitKind(value.waitBasis), cursorAtRead);
            // slice-PL-SPEC §5.1.4 action 1 / §5.5.1 steps 5–6: only after the drain does the send run.
            await dependencies.drainGoalWaits?.(scope);
          }
          input = value.next;
          observingCompletedStep = value.receipt?.kind === 'complete_task'
            && value.next.kind === 'select_work' && value.next.taskId !== undefined;
        }
        if (driver.stopRequested || !driver.recheck) break;
      }
    } catch (error) {
      // §3.2 step 6 / §3.5:227: a throw outside the advance's own catch (the
      // yielded wait's execution read, an admission wait) ends this pass as a
      // real failure with the original reason; it is not silently swallowed.
      if (!driver.stopRequested) {
        driver.state = 'failed';
        driver.reason = `the Workflow advancement failed: ${messageOf(error)}`;
      }
    } finally {
      driver.current = null;
      driver.failedCardRefs = [];
      changed(driver);
    }
  }

  /**
   * One Run watch (spec §3.3). It reuses the `Handle` loop: same seed, context,
   * profiles, pump, yielded wait and cancel. It never registers or leaves the
   * Goal's wait; a registered wait is handed to the decision loop.
   */
  async function runLane(lane: Lane): Promise<void> {
    const driver = lane.driver;
    try {
      let input: WorkflowAdvanceInput | null = lane.current;
      let observingCompletedStep = false;
      while (input !== null && !lane.stopRequested) {
        changed(lane);
        const observation = observingCompletedStep;
        observingCompletedStep = false;
        let admission: AdvanceAdmission | null = null;
        if (input.kind === 'select_work' && !observation) {
          admission = await awaitAdvanceAdmission(lane, input);
          if (admission === null) return;
        }
        const startRun = startRunRefOf(input);
        const internal: WorkflowAdvanceInternal = lane.failedCardRefs.length === 0
          ? {} : { failedCardRefs: lane.failedCardRefs };
        const cursorAtRead = dependencies.observedCursor?.() ?? null;
        lane.current = input;
        const result = startRun === null
          ? await advanceWorkNow(lane, input, internal, admission)
          : await runWithPump(lane, startRun, input, internal, admission);
        lane.last = result;
        if (result.status === 'ready' && result.value.failedCardRefs !== undefined) {
          lane.failedCardRefs = structuredClone(result.value.failedCardRefs);
        } else {
          lane.failedCardRefs = [];
        }
        if (result.status === 'ready') {
          const observedRun = receiptRunRefOf(result) ?? startRunRefOf(result.value.next);
          if (observedRun !== null) lane.currentRun = structuredClone(observedRun);
        }
        if (lane.stopRequested) return;
        if (result.status !== 'ready') {
          lane.state = 'failed'; lane.reason = result.reason; return;
        }
        const value = result.value;
        if (value.state === 'completed') {
          lane.state = 'completed'; lane.reason = value.reason;
          if (driver.accepted && !driver.stopRequested) {
            driver.recheck = true;
            kickDriver(driver);
          }
          return;
        }
        if (value.state === 'waiting') {
          const woken = await awaitYielded(lane, value.reason);
          if (woken !== null) { lane.current = woken; input = woken; continue; }
          if (lane.stopRequested) return;
          if (value.reason === 'running_cap') {
            lane.state = 'waiting'; lane.reason = value.reason;
            if (cursorAtRead !== null) {
              lane.handedBack = runningCapBasisOf(lane);      // hand the watch back BEFORE the register/drain below
              lane.driver.registered = true;
              lane.state = 'waiting_for_reply';                // the existing wake re-opens this watch
            }
            await holdRunningCapWait(lane, cursorAtRead);
            return;                                            // no yielded pump, no terminal
          }
          if (value.waitBasis !== undefined && cursorAtRead !== null) {
            lane.state = 'waiting_for_reply'; lane.reason = value.reason;
            lane.handedBack = structuredClone(value.waitBasis);
            // The watch never registers, but the driver must hold this wait even
            // when no Goal-scope start was accepted (only Task watches).
            const waits = dependencies.goalWaits?.({ projectId: value.waitBasis.projectId,
              workspaceId: lane.workspaceId });
            if (waits !== undefined) {
              waits.register(value.waitBasis, cursorAtRead);
              driver.registered = true;
            }
            return;
          }
          lane.state = 'waiting'; lane.reason = value.reason; return;
        }
        if (value.next === null) {
          lane.state = 'waiting'; lane.reason = 'the Workflow returned no next step'; return;
        }
        // A watch never follows a Goal-scope selection into other Tasks.
        if (value.next.kind === 'select_work' && value.next.taskId === undefined) {
          lane.state = 'waiting'; lane.reason = value.reason;
          if (driver.accepted && !driver.stopRequested) {
            driver.recheck = true;
            kickDriver(driver);
          }
          return;
        }
        lane.current = value.next;
        input = value.next;
        observingCompletedStep = value.receipt?.kind === 'complete_task'
          && value.next.kind === 'select_work' && value.next.taskId !== undefined;
      }
    } catch (error) {
      if (!lane.stopRequested) {
        lane.state = 'failed';
        lane.reason = `the Workflow advancement failed: ${messageOf(error)}`;
      }
    } finally {
      lane.current = null;
      lane.failedCardRefs = [];
      if (!lane.stopRequested) {
        lane.currentRun = null;
      }
      driver.activeTaskIds.delete(lane.taskId);
      // §3.1: a watch that ends failed still hands its Task back. An accepted
      // Goal asks for one more selection; a Task-only driver and a stopping one
      // keep the old rule (no recheck).
      if (lane.state === 'failed' && driver.accepted && !driver.stopRequested) {
        driver.recheck = true;
        kickDriver(driver);
      }
      changed(lane);
    }
  }

  /** Clear this handle's Goal wait. A watch never calls this. */
  function leaveGoalWait(handle: Handle): void {
    dependencies.goalWaits?.({ projectId: handle.projectId, workspaceId: handle.workspaceId })
      ?.leave(handle.goalRef);
    if (handle.taskId === null) (handle as GoalDriver).registered = false;
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

  function hasStopResidual(handle: Handle): boolean {
    return handle.activePumpAbort !== null || handle.wakeWaiting || admissionWaits.has(handle);
  }

  /**
   * Begin one person's stop of one object (spec §3.5). The public call answers
   * at once; this drain is the background that writes the final `stopped`.
   * `lanes` is the actual set this stop must also drain: a Goal driver supplies
   * all its watches, a watch supplies none. A Goal driver leaves the Goal's one
   * registration; a watch never does.
   */
  function stopAdvance(handle: Handle, lanes: readonly Lane[] = []): Promise<void> {
    if (handle.stopDrain !== null) return handle.stopDrain;
    if (handle.taskId !== null && isTerminal(handle.state) && !hasStopResidual(handle)) return Promise.resolve();
    const laneDrains = lanes.map(lane => stopAdvance(lane));
    handle.stopRequested = true;
    handle.stopReason ??= 'the collaboration driver was asked to stop';
    handle.state = 'stopping';
    changed(handle);
    if (handle.taskId === null) leaveGoalWait(handle);
    handle.activePumpAbort?.abort('driver_stopped');
    admissionWaits.get(handle)?.();
    handle.stopDrain = (async () => {
      // Cancel the currently-known Run, let the loop drain (a Run claimed while
      // stopping is recorded by the loop before it breaks), then do the final
      // cancel for that late Run. Only then does `stopped` become true.
      await requestCancel(handle);
      await Promise.all([handle.done.catch(() => { /* the loop stored its own reason */ }), ...laneDrains]);
      await requestCancel(handle);
      for (const lane of lanes) lane.state = 'stopped';
      handle.state = 'stopped';
      changed(handle);
    })();
    return handle.stopDrain;
  }

  /** A Goal stop supplies only its actual watch set to the one stop protocol. */
  function stopDriver(driver: GoalDriver): Promise<void> {
    return stopAdvance(driver, [...driver.lanes.values()]);
  }

  /**
   * The one start entry. A Goal-scope start installs the startup seed and runs
   * one decision; an explicit Task start opens only that Task's watch (a
   * container driver is created when none exists). A same seed replays.
   */
  async function startHandle(
    ctx: CoreCallContext, input: CollaborationStartInput,
  ): Promise<ReadResult<CollaborationSnapshot>> {
    if (closed) return rejected('unavailable', 'the Host is closing');
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
    const profiles = selectProfiles(ctx.projectId, ctx.workspaceId, requested);
    const typedAdvance = advance as unknown as WorkflowAdvanceInput;
    const seedMaterial = { advance: typedAdvance, queryProfileIds: [...requested].sort() };
    const seed = canonicalOf(seedMaterial) ?? sha256Hex(canonicalJson(seedMaterial as unknown as JsonValue));
    const taskId = nonEmpty(advance['taskId']) ? advance['taskId'] : null;
    const workspaceId = ctx.workspaceId;
    const existingDriver = driverOf(ctx.projectId, workspaceId, goalRef.goalId);

    if (taskId === null) {
      if (existingDriver !== undefined) {
        if (existingDriver.seed === seed) return { status: 'ready', value: snapshot(existingDriver) };
        // DRV-03 (§4.1:251): the stop-drain window is busy for every Goal start,
        // accepted or task-only. `state === 'stopping'` is exactly "draining":
        // the drain writes the final `stopped` last, so a fresh seed is accepted
        // again only after it (D-P5). `stopDrain` is NOT the predicate: it stays
        // non-null after `stopped`, which would keep a finished Goal busy forever.
        const busy = existingDriver.state === 'stopping'
          || (existingDriver.accepted && (existingDriver.deciding !== null
            || [...existingDriver.lanes.values()].some(laneBusy)));
        if (busy) {
          return rejected('busy', 'another collaboration advancement is already active for this Goal');
        }
        existingDriver.seed = seed;
        existingDriver.flowId = typedAdvance.flowId;
        existingDriver.context = snapshotContext(ctx);
        existingDriver.profiles = profiles;
        existingDriver.current = structuredClone(typedAdvance);
        existingDriver.last = null;
        existingDriver.failedCardRefs = [];
        existingDriver.reason = null;
        existingDriver.currentRun = null;
        existingDriver.stopRequested = false;
        existingDriver.stopReason = null;
        existingDriver.stopDrain = null;
        existingDriver.state = 'running';
        enterPublicOrder(existingDriver);
        existingDriver.registered = false;
        existingDriver.recheck = false;
        await dependencies.repairs?.attemptRepairsForGoal(ctx, { goalRef })
          .catch(() => { /* a failed activation never changes the handle, the seed or the advance */ });
        await dependencies.redriveRepairAnswers?.(ctx, { goalRef })
          .catch(() => { /* a failed ③ leaves the answer unapplied for the next trigger */ });
        kickDriver(existingDriver);
        await dependencies.onStarted?.(ctx, goalRef);
        return { status: 'ready', value: snapshot(existingDriver) };
      }
      const created = installDriver(ctx, goalRef, typedAdvance.flowId, seed, profiles, typedAdvance, true);
      await dependencies.repairs?.attemptRepairsForGoal(ctx, { goalRef })
        .catch(() => { /* a failed activation never changes the handle, the seed or the advance */ });
      await dependencies.redriveRepairAnswers?.(ctx, { goalRef })
        .catch(() => { /* a failed ③ leaves the answer unapplied for the next trigger */ });
      kickDriver(created);
      await dependencies.onStarted?.(ctx, goalRef);
      return { status: 'ready', value: snapshot(created) };
    }

    const driver = existingDriver ?? installDriver(ctx, goalRef, typedAdvance.flowId, seed, profiles, null, false);
    const laneKey = handleKey(ctx.projectId, workspaceId, goalRef.goalId, taskId);
    const existingLane = driver.lanes.get(laneKey);
    if (existingLane !== undefined) {
      if (existingLane.seed === seed) return { status: 'ready', value: snapshot(existingLane) };
      if (laneBusy(existingLane)) {
        return rejected('busy', 'another collaboration advancement is already active for this Task');
      }
    }
    // §4.1: a Task start never installs a watch while the Goal's stop drain is
    // running; the drain already took its Lane set, so a new watch would escape
    // it. A Goal that finished draining may accept the watch again, and the
    // next stop must take the current Lane set rather than reuse that finished
    // drain (§3.5).
    if (driver.state === 'stopping') {
      return rejected('busy', 'another collaboration advancement is already active for this Task');
    }
    if (driver.state === 'stopped') driver.stopDrain = null;
    const lane = installLane(driver, snapshotContext(ctx), profiles, seed, typedAdvance.flowId, taskId,
      typedAdvance, []);
    startLaneLoop(lane);
    if (driver.accepted) {
      driver.recheck = true;
      kickDriver(driver);
    }
    return { status: 'ready', value: snapshot(lane) };
  }

  /**
   * BW (spec §3.4): a wake marks `recheck` and returns at once; the decision
   * loop does the advancement. A driver that holds only Task watches re-opens
   * exactly the watches that handed a basis back, on their own seed/flow/task.
   */
  async function wake(ctx: CoreCallContext, goalRef: GoalRef): Promise<void> {
    const workspaceId = ctx.workspaceId ?? '';
    const driver = driverOf(ctx.projectId, workspaceId, goalRef.goalId);
    if (driver === undefined) {
      const queryProfileIds = trustedProfiles
        .filter(profile => profile.scope.projectId === ctx.projectId && profile.scope.workspaceId === workspaceId)
        .map(profile => profile.id);
      await startHandle(ctx, { advance: { schemaVersion: 1, goalRef, flowId: `goal-wait:${goalRef.goalId}`,
        sessionHint: null, kind: 'select_work' }, queryProfileIds });
      return;
    }
    if (driver.stopRequested) return;
    if (driver.accepted) {
      driver.recheck = true;
      kickDriver(driver);
      return;
    }
    leaveGoalWait(driver);
    reopenHandedBack(driver);
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
      return startHandle(ctx, input);
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
      if (requestedTask !== null) {
        const lane = handles.get(handleKey(ctx.projectId, ctx.workspaceId, goalRef.goalId, requestedTask));
        if (lane === undefined || lane.taskId === null) return { status: 'not_found' };
        return { status: 'ready', value: snapshot(lane) };
      }
      const target = publicTargetOf(ctx.projectId, ctx.workspaceId, goalRef.goalId);
      if (target === undefined) return { status: 'not_found' };
      return { status: 'ready', value: snapshot(target) };
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
      const driver = driverOf(ctx.projectId, ctx.workspaceId, goalRef.goalId);
      if (requestedTask !== null) {
        const lane = driver?.lanes.get(handleKey(ctx.projectId, ctx.workspaceId, goalRef.goalId, requestedTask));
        if (lane === undefined) return { status: 'not_found' };
        void stopAdvance(lane);
        return { status: 'ready', value: snapshot(lane) };
      }
      if (driver === undefined) return { status: 'not_found' };
      const first = publicTargetOf(ctx.projectId, ctx.workspaceId, goalRef.goalId) ?? driver;
      void stopDriver(driver);
      // Returns immediately with the FIRST target's snapshot; its cancel and the
      // decision/watch drains settle in the background and become `stopped`.
      return { status: 'ready', value: snapshot(first) };
    },
    wake: (ctx, goalRef) => wake(ctx, goalRef),
    async close() {
      closed = true;
      const all = [...handles.values()];
      handles.clear();
      // A Host close is not a person's stop (no cancel pass): it pauses each live
      // Run at its next safe point and waits for every decision, watch and
      // already-started stop drain.
      for (const handle of all) {
        handle.stopRequested = true;
        if (handle.taskId === null) leaveGoalWait(handle);
        handle.activePumpAbort?.abort('host_closing');
        admissionWaits.get(handle)?.();
      }
      const drains = all.map(handle => handle.stopDrain).filter((drain): drain is Promise<void> => drain !== null);
      await Promise.all([
        ...all.map(handle => handle.done.catch(() => { /* the loop stored its own reason */ })),
        ...drains.map(drain => drain.catch(() => { /* a person's stop records its own reason */ })),
      ]);
    },
  };
}
