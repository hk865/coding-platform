/**
 * G7 Host fan-out driver (docs/refactor/STATE-MACHINES-SPEC.md §2.3 GOAL-09..16,
 * GOAL-28; A.2 step 5.5).
 *
 * A Goal-level pause, resume or cancel is TWO kinds of commit: the Goal's
 * desired state (`goals.setGoalControl`, GOAL-04…06) stops new claims, entries
 * and check processes at once; then this Host driver submits ONE control per
 * affected Run, each its own commit judged by the Run and ControlIntent
 * machines (§6, §7). The affected set is read after the Goal commit
 * (`plans.queryGoalLiveRuns`: the Goal's `starting|running` Runs; no new Run
 * can appear, I-9).
 *
 * Re-drive protocol (§2.3): each Run's fan-out control has a deterministic
 * requestId (`goalFanOutRequestId`) under the stable `GOAL_FAN_OUT_ACTOR`, so
 * the driver first reads the deterministic intent (`controlIntentRefFor`); an
 * intent that exists is not submitted again, but while it is still queued on
 * a live Run it is delivered again (and a queued resume re-enters its Turn
 * again), so a retried pass recovers a lost delivery or a re-entry that never
 * started. Otherwise the driver reads the Goal and the Run, drops a stale
 * epoch, and submits with the Run pin plus a Goal fence (a read-only Goal
 * CAS). `idempotency_conflict` re-reads the intent; `revision_conflict`
 * re-reads the Goal (same epoch → retry, new epoch → stale). Running it again
 * (a retried request, or the restart re-drive of §12.1 step 6 in 5.6) never
 * adds an intent.
 *
 * Per-Run rows: a pause skips a Run already paused or cancelled by any intent
 * (GOAL-12, GOAL-13); a cancel skips a Run already cancelled (GOAL-12) and
 * supersedes a person's queued pause (GOAL-13, D-8); a resume only answers a
 * Run whose pointer is THIS Goal's fan-out pause of an earlier epoch, applied
 * and paused (GOAL-14): a person's own pause stays (A7-G5). A fan-out pause
 * that is still queued, or whose outcome is unknown (GOAL-28), is WATCHED: the
 * driver observes the Host's commits and, once that intent's status moves
 * (the Kernel observation lands, or reconcile settles it), runs the pass again
 * for the Goal's current epoch ("驱动等观察到达后重试"). A resumed entered Run
 * re-enters its original Turn through the same `startRun` the operator's
 * resume uses; a re-entry is never started twice in this process, and a
 * failed one is recorded and shown (`reentryFailures`) until a later pass
 * re-enters the Turn. A Run that ended is not in the set (GOAL-15); a
 * paused-interrupted Run continues through GOAL-29 (step 5.6).
 *
 * The per-Run work runs on the driver's own signal, never the HTTP request's:
 * a client that disconnects never stops the Host's fan-out halfway. There is
 * no periodic scheduler (GAP-48): only a Goal control, a commit that moves a
 * watched intent, and (5.6) the restart re-drive start a pass. The display
 * (`readGoalDisplay`, GOAL-17..30 with `runStops`) shows each Run's actual
 * state, never "all stopped" (B08).
 */
import type { CoreCallContext } from '../contracts/core/call-context.js';
import type { ControlIntentRef, ControlIntentSnapshotV1 } from '../contracts/control-intent.js';
import type { ReadResult, WriteResult } from '../contracts/core/results.js';
import type { RunRef, RunSnapshot } from '../contracts/dispatch.js';
import type { GoalRef, GoalSnapshot } from '../contracts/ledger.js';
import type { RecordCommitNotice } from '../composition/commit-observer.js';
import type { RuntimeExecutionPort } from '../core/agent-runtime/ports.js';
import type { RuntimeCapability } from '../core/agent-runtime/contracts.js';
import type { RunControlPort } from '../core/work-graph/tasks/control-contracts.js';
import { controlIntentRefFor } from '../core/work-graph/tasks/control-service.js';
import type { TaskClaimPort } from '../core/work-graph/model/claim-contracts.js';
import type { GoalTaskPort, GraphWrite, SetGoalControlInput } from '../core/work-graph/model/task-contracts.js';
import type { ExecutionReadPort, TaskExecutionRecord } from '../core/work-graph/model/execution-read-contracts.js';
import type { GoalDisplayRead, GoalLiveRunsRead, PlanTaskPort } from '../core/work-graph/model/plan-contracts.js';
import {
  GOAL_FAN_OUT_ACTOR, goalFanOutReason, goalFanOutRequestId, type GoalControl, type GoalRunControlCapabilityV1,
} from '../core/work-graph/state/goal-machine.js';
import { createHostCoreCallContext } from './core-call-context.js';

/** One affected Run's fan-out answer of this pass. */
export type GoalFanOutRunResultV1 = {
  runRef: RunRef;
  /**
   * `submitted`: this pass committed the Run's fan-out intent; `already_submitted`:
   * the deterministic intent exists; `skipped`: the row submits nothing (reason);
   * `stale`: the Goal moved to another epoch; `failed`: a read or the submission
   * was refused (reason). The intent's own status is the Run's actual state.
   */
  outcome: 'submitted' | 'already_submitted' | 'skipped' | 'stale' | 'failed';
  intentRef: ControlIntentRef | null;
  reason: string | null;
};

/** The fan-out of one epoch: `control` is null for a Goal whose desired state never changed. */
export type GoalFanOutReportV1 = {
  goalRef: GoalRef;
  epoch: number;
  control: GoalControl | null;
  runs: GoalFanOutRunResultV1[];
  /**
   * The affected set could not be read (no Run was touched), or, on a resume,
   * the GOAL-29 continuations could not be read (the next pass reads them again).
   */
  problem: string | null;
  /**
   * GOAL-29 (A.2 step 5.6): after a resume, each Task whose Run ended
   * paused-interrupted by this Goal's fan-out pause is continued by a requeue
   * (`goal_resume` trigger). Absent on a pass that is not a resume.
   */
  continuations?: GoalResumeContinuationResultV1[];
};

/**
 * One GOAL-29 continuation of a resume pass: `requeued`/`refused` committed
 * (the refusal is the owner's TaskReworkRefusal); `already_continued` a
 * TaskRequeue covers the Run already (a person pressed 继续 first, or an earlier
 * pass); `stale` the Goal moved on (paused or cancelled again, or another
 * resume epoch), so this pass's continuation is dropped; `failed` anything
 * else, retried by the next pass.
 */
export type GoalResumeContinuationResultV1 = {
  taskId: string;
  afterRunRef: RunRef;
  outcome: 'requeued' | 'refused' | 'already_continued' | 'stale' | 'failed';
  reason: string | null;
};

/** `goals/control`: the Goal commit (GOAL-04…06) and the fan-out pass after it. */
export type GoalControlOutcomeV1 = { goal: GoalSnapshot; fanOut: GoalFanOutReportV1 };

/**
 * A resume re-entry of the original Turn that this Host started and that was
 * refused or threw; kept (in memory) until a later re-entry of the Run starts
 * the Turn. Shown only while the Run still waits for its resume.
 */
export type GoalReentryFailureV1 = { runRef: RunRef; intentRef: ControlIntentRef; reason: string };

/** `goals/display`: the core display read plus this Host's failed resume re-entries. */
export type GoalDisplayHostReadV1 = GoalDisplayRead & { reentryFailures: GoalReentryFailureV1[] };

export interface GoalControlPort {
  setGoalControl(ctx: CoreCallContext, request: GraphWrite<SetGoalControlInput>): Promise<WriteResult<GoalControlOutcomeV1>>;
  /** GOAL-17..30 with `runStops`; the Host adds its capability report (runStops order 3). */
  readGoalDisplay(ctx: CoreCallContext, input: { goalRef: GoalRef }): Promise<ReadResult<GoalDisplayHostReadV1>>;
}

/** A pass the start-up reconcile runs (§12.1 step 6): resume rows skip the entered Runs step 2 left (GOAL-14, §2.3). */
export type GoalFanOutPassOptions = { startup?: boolean };

export type GoalFanOutDriver = GoalControlPort & {
  /** One idempotent fan-out pass for the Goal's CURRENT epoch (§2.3 re-drive). */
  fanOut(ctx: CoreCallContext, goalRef: GoalRef, options?: GoalFanOutPassOptions): Promise<GoalFanOutReportV1>;
  /**
   * The Host commit observer: a commit that touches a ControlIntent of a
   * project with a watched fan-out pause re-reads the watched intents and
   * runs the pass again for each Goal whose intent moved (GOAL-14, GOAL-28).
   * Synchronous and never throws; the work runs after the commit returned.
   */
  committed(notice: RecordCommitNotice): void;
  /** Stops watching and waits for the passes and resume re-entries this driver started. */
  close(): Promise<void>;
};

export type GoalFanOutDriverDependencies = {
  goals: Pick<GoalTaskPort, 'setGoalControl'>;
  plans: Pick<PlanTaskPort, 'queryGoal'>
    & Required<Pick<PlanTaskPort, 'queryGoalDisplay' | 'queryGoalLiveRuns' | 'queryGoalResumeContinuations'>>;
  executions: Pick<ExecutionReadPort, 'readExecution'>;
  controls: RunControlPort;
  runtime: Pick<RuntimeExecutionPort, 'capabilities' | 'startRun' | 'deliverControl'>;
  /** GOAL-29 (A.2 step 5.6): the continuation of a fan-out-paused, paused-interrupted Task. */
  claims: Required<Pick<TaskClaimPort, 'requeueTask'>>;
  /**
   * L-10: only the Host holding the instance lease reaches the Runs (per-Run
   * fan-out, re-entries, continuations); without it a Goal commit still stops
   * new claims at once and the holding Host re-drives at its start (GOAL-16).
   */
  driving?: () => boolean;
};

type Scope = { projectId: string; workspaceId: string };

/** A resume row that waits for this fan-out pause intent to move (GOAL-14 / GOAL-28). */
type Watch = { goalRef: GoalRef; scope: Scope; intentRef: ControlIntentRef; status: ControlIntentSnapshotV1['status'] };

/** The row's verdict for one Run: submit, or skip with the reason (and the intent to watch). */
type RowVerdict = { submit: true } | { submit: false; reason: string; watch: ControlIntentSnapshotV1 | null };

/** A Run's submission is retried at most this often within one pass (idempotency / revision conflicts). */
const MAX_RUN_ATTEMPTS = 3;

function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function reasonOf(result: { status: string; reason?: string }): string {
  return result.reason === undefined ? result.status : `${result.status}: ${result.reason}`;
}
function sameIntentRef(left: ControlIntentRef, right: ControlIntentRef): boolean {
  return left.projectId === right.projectId && left.workspaceId === right.workspaceId && left.intentId === right.intentId;
}
function intentKeyOf(ref: ControlIntentRef): string { return `${ref.projectId}\u0000${ref.workspaceId}\u0000${ref.intentId}`; }
function runKeyOf(ref: RunRef): string { return `${ref.projectId}\u0000${ref.goalId}\u0000${ref.runId}`; }
function goalKeyOf(ref: GoalRef): string { return `${ref.projectId}\u0000${ref.goalId}`; }
function controlOf(goal: GoalSnapshot): GoalControl | null {
  switch (goal.desiredState) {
    case 'paused': return 'pause';
    case 'cancelled': return 'cancel';
    case 'active': return goal.desiredStateRevision > 1 ? 'resume' : null;
    default: return null;
  }
}
function capabilityOf(capability: RuntimeCapability): GoalRunControlCapabilityV1 {
  return capability.supported ? { status: 'supported' } : { status: 'unsupported', reason: capability.reason };
}

export function createGoalFanOutDriver(deps: GoalFanOutDriverDependencies): GoalFanOutDriver {
  /** The driver's own signal: never aborted, so a pass always reaches every Run; `close()` drains. */
  const hostSignal = new AbortController().signal;
  const passes = new Set<Promise<unknown>>();
  const reentries = new Set<Promise<unknown>>();
  /** Intents whose re-entry runs in this process: a second pass never enters the same Turn twice. */
  const reentering = new Set<string>();
  /** By Run: the last refused or thrown re-entry of its fan-out resume. */
  const reentryFailures = new Map<string, GoalReentryFailureV1>();
  /** By watched intent: the resume rows waiting for a fan-out pause to move. */
  const watches = new Map<string, Watch>();
  let checking: Promise<void> | null = null;
  let recheck = false;
  let closed = false;

  function track<T>(work: Promise<T>, into: Set<Promise<unknown>>): Promise<T> {
    into.add(work);
    void work.finally(() => into.delete(work)).catch(() => undefined);
    return work;
  }

  /** The fan-out actor's Host context over the Goal's scope (§2.3: `GOAL_FAN_OUT_ACTOR`). */
  function fanOutContext(scope: Scope, signal: AbortSignal = hostSignal): CoreCallContext {
    return createHostCoreCallContext({ scope,
      actor: { kind: GOAL_FAN_OUT_ACTOR.kind, id: GOAL_FAN_OUT_ACTOR.id }, signal });
  }

  /**
   * GOAL-14: the pointer is THIS Goal's fan-out pause of an earlier epoch
   * (bounded recomputation over E ∈ [1, epoch), never a parsed text).
   */
  function isEarlierFanOutPause(goalRef: GoalRef, scope: Scope, epoch: number,
    run: RunSnapshot, intent: ControlIntentSnapshotV1): boolean {
    if (intent.kind !== 'pause') return false;
    for (let earlier = 1; earlier < epoch; earlier += 1) {
      const ref = controlIntentRefFor(GOAL_FAN_OUT_ACTOR, scope, goalFanOutRequestId(goalRef, earlier, run.ref, 'pause'));
      if (sameIntentRef(ref, intent.ref)) return true;
    }
    return false;
  }

  /** The row's verdict for one Run (GOAL-12/13/14/28). */
  function rowOf(control: GoalControl, goalRef: GoalRef, scope: Scope, epoch: number,
    run: RunSnapshot, pointer: ControlIntentSnapshotV1 | null): RowVerdict {
    const desired = run.controlState?.desiredState;
    const skip = (reason: string, watch: ControlIntentSnapshotV1 | null = null): RowVerdict => ({ submit: false, reason, watch });
    switch (control) {
      case 'pause':
        if (desired === 'paused' || desired === 'cancelled') return skip(`the Run already carries a ${desired} intent`);
        return { submit: true };
      case 'cancel':
        return desired === 'cancelled' ? skip('the Run already carries a cancel intent') : { submit: true };
      case 'resume':
        if (pointer === null || !isEarlierFanOutPause(goalRef, scope, epoch, run, pointer)) {
          return skip('the Run is not paused by this Goal\'s fan-out; a pause of its own stays');
        }
        if (pointer.status === 'outcome_unknown') {
          return skip('the fan-out pause outcome is unknown; the resume waits for reconcile (GOAL-28)', pointer);
        }
        if (pointer.status === 'queued') {
          return skip('the fan-out pause is queued; the resume follows once it is applied and paused', pointer);
        }
        if (pointer.status !== 'applied' || pointer.observation.kind !== 'paused') {
          return skip(`the fan-out pause is ${pointer.status} without a paused observation; there is nothing to resume`);
        }
        return { submit: true };
      default: return { submit: true };
    }
  }

  /** Re-enter the original Turn of an entered Run whose fan-out resume is queued, once per intent in this process. */
  function reenter(scope: Scope, record: TaskExecutionRecord, intent: ControlIntentSnapshotV1, requestId: string): string | null {
    const run = record.run;
    const authorization = run.executionAuthorization;
    if (run.envelope === null || run.inputBinding === undefined
      || authorization === undefined || !('consumerId' in authorization)) return null;
    const intentKey = intentKeyOf(intent.ref);
    if (reentering.has(intentKey)) return 're-entry of the original Turn is already running';
    if (closed) return 'the Host is closing; a later pass re-enters the original Turn';
    const runKey = runKeyOf(run.ref);
    const previous = reentryFailures.get(runKey);
    const start = {
      prepared: { kind: 'task' as const, claim: record.outbox.claim, envelope: run.envelope, inputBinding: run.inputBinding },
      consumerId: authorization.consumerId, requestId: `goal-fan-out-start:${requestId}`,
    };
    reentering.add(intentKey);
    // The same re-entry the operator's per-Run resume makes; it runs to the Turn's end in the background
    // on a signal of its own (aborting it would cancel the Kernel Turn), drained by `close()`.
    const reentry = (async () => {
      try {
        const started = await deps.runtime.startRun(fanOutContext(scope, new AbortController().signal), start);
        if (started.status === 'ready') reentryFailures.delete(runKey);
        else reentryFailures.set(runKey, { runRef: run.ref, intentRef: intent.ref, reason: reasonOf(started) });
      } catch (error) {
        reentryFailures.set(runKey, { runRef: run.ref, intentRef: intent.ref, reason: messageOf(error) });
      } finally {
        reentering.delete(intentKey);
      }
    })();
    track(reentry, reentries);
    return previous === undefined ? 're-entry of the original Turn started'
      : `re-entry of the original Turn started again (the previous one failed: ${previous.reason})`;
  }

  /**
   * A queued intent goes to the Run's live handle; a queued resume of an
   * entered Run re-enters its original Turn whatever the delivery answered
   * (the start re-reads the pointer and delivers the resume itself).
   */
  async function deliver(scope: Scope, record: TaskExecutionRecord, intent: ControlIntentSnapshotV1,
    requestId: string): Promise<string | null> {
    if (intent.status !== 'queued') return null;
    let delivery: string | null = null;
    if (deps.runtime.deliverControl === undefined) {
      delivery = 'the intent is durable; this Host has no control delivery';
    } else {
      try {
        const delivered = await deps.runtime.deliverControl(fanOutContext(scope), { intentRef: intent.ref });
        if (delivered.status !== 'ready') delivery = `the intent is durable but was not delivered (${reasonOf(delivered)})`;
      } catch (error) {
        delivery = `the intent is durable but its delivery failed: ${messageOf(error)}`;
      }
    }
    if (intent.kind !== 'resume') return delivery;
    const reentry = reenter(scope, record, intent, requestId);
    if (delivery === null) return reentry;
    return reentry === null ? delivery : `${delivery}; ${reentry}`;
  }

  async function fanOutRun(ctx: CoreCallContext, scope: Scope, goalRef: GoalRef, control: GoalControl,
    epoch: number, desired: GoalSnapshot['desiredState'], runRef: RunRef, startup: boolean): Promise<GoalFanOutRunResultV1> {
    const actorCtx = fanOutContext(scope);
    const requestId = goalFanOutRequestId(goalRef, epoch, runRef, control);
    const intentRef = controlIntentRefFor(GOAL_FAN_OUT_ACTOR, scope, requestId);
    const result = (outcome: GoalFanOutRunResultV1['outcome'], reason: string | null, ref: ControlIntentRef | null = null) =>
      ({ runRef, outcome, intentRef: ref, reason });
    for (let attempt = 0; attempt < MAX_RUN_ATTEMPTS; attempt += 1) {
      // 1. The deterministic intent: present → never submitted twice; still queued on a live Run → delivered again.
      const existing = await deps.controls.readControl(actorCtx, intentRef);
      if (existing.status === 'ready') {
        if (existing.value.status !== 'queued') return result('already_submitted', null, intentRef);
        const current = await deps.executions.readExecution(ctx, runRef);
        if (current.status !== 'ready') {
          return result('already_submitted', `the intent is queued but the Run is not readable (${reasonOf(current)})`, intentRef);
        }
        if (current.value.run.status === 'ended') return result('already_submitted', null, intentRef);
        return result('already_submitted', await deliver(scope, current.value, existing.value, requestId), intentRef);
      }
      if (existing.status !== 'not_found') return result('failed', `the fan-out intent is not readable (${reasonOf(existing)})`);
      // 2. The Goal (the epoch must still be this one) and the Run.
      const goalRead = await deps.plans.queryGoal(ctx, goalRef);
      if (goalRead.status !== 'ready') return result('failed', `the Goal is not readable (${reasonOf(goalRead)})`);
      const goal = goalRead.value.goal;
      if (goal.desiredState !== desired || goal.desiredStateRevision !== epoch) {
        return result('stale', `the Goal moved to ${goal.desiredState}@${String(goal.desiredStateRevision)}`);
      }
      const read = await deps.executions.readExecution(ctx, runRef);
      if (read.status !== 'ready') return result('failed', `the Run is not readable (${reasonOf(read)})`);
      const run = read.value.run;
      if (run.status === 'ended') return result('skipped', 'the Run has ended (GOAL-15)');
      // §2.3 re-drive step 2, GOAL-14: at a start the entered Runs were classified by step 2; one it left
      // (W-07) takes no resume now: it is resumed only after a later start classifies it.
      const authorization = run.executionAuthorization;
      if (startup && control === 'resume' && authorization !== undefined
        && (authorization.phase === 'entering' || authorization.phase === 'entered')) {
        return result('skipped', 'entered Run left by step 2; resumed only after it is classified (GOAL-14, §2.3)');
      }
      let pointer: ControlIntentSnapshotV1 | null = null;
      if (run.controlState !== undefined) {
        const pointed = await deps.controls.readControl(actorCtx, run.controlState.intentRef);
        if (pointed.status !== 'ready') return result('failed', `the Run's pointer intent is not readable (${reasonOf(pointed)})`);
        pointer = pointed.value;
      }
      const row = rowOf(control, goalRef, scope, epoch, run, pointer);
      if (!row.submit) {
        // GOAL-14 / GOAL-28: the pass runs again once the watched pause intent moves. One check right
        // away covers a move committed between the pointer read above and this registration.
        if (row.watch !== null && !closed) {
          watches.set(intentKeyOf(row.watch.ref), { goalRef, scope, intentRef: row.watch.ref, status: row.watch.status });
          scheduleCheck();
        }
        return result('skipped', row.reason);
      }
      // 3. One commit per Run: the Run pin and the Goal fence (read-only Goal CAS).
      const submitted = await deps.controls.submitControl(actorCtx, {
        input: { runRef, kind: control, reason: goalFanOutReason(goalRef, control, epoch) },
        meta: { requestId, expected: [{ ref: runRef, revision: run.revision }, { ref: goalRef, revision: goal.revision }] },
      });
      if (submitted.status === 'committed') {
        const delivery = await deliver(scope, read.value, submitted.value.intent, requestId);
        return result('submitted', delivery, submitted.value.intent.ref);
      }
      // 4. A concurrent same-identity commit, or a moved Run/Goal: read again.
      if (submitted.code === 'idempotency_conflict' || submitted.code === 'revision_conflict') continue;
      return result(submitted.code === 'busy' || submitted.code === 'unsupported' ? 'skipped' : 'failed', reasonOf(submitted));
    }
    return result('failed', `the fan-out did not settle after ${String(MAX_RUN_ATTEMPTS)} attempts`);
  }

  async function runPass(ctx: CoreCallContext, goalRef: GoalRef, startup = false): Promise<GoalFanOutReportV1> {
    const report = (epoch: number, control: GoalControl | null, problem: string | null): GoalFanOutReportV1 =>
      ({ goalRef, epoch, control, runs: [], problem });
    let read: ReadResult<GoalLiveRunsRead>;
    try {
      read = await deps.plans.queryGoalLiveRuns(ctx, { goalRef });
    } catch (error) {
      return report(0, null, `the affected Runs are not readable: ${messageOf(error)}`);
    }
    if (read.status !== 'ready') return report(0, null, `the affected Runs are not readable (${reasonOf(read)})`);
    const goal = read.value.goal;
    const epoch = goal.desiredStateRevision;
    const control = controlOf(goal);
    if (control === null) return report(epoch, null, null);
    if (deps.driving !== undefined && !deps.driving()) {
      return report(epoch, control, 'another Host holds the instance lease; that Host reaches the Runs (L-10, GOAL-16)');
    }
    // The Goal names its workspace: the fan-out actor acts in exactly that scope.
    const scope: Scope = { projectId: goalRef.projectId, workspaceId: goal.workspaceRef.workspaceId };
    const runs: GoalFanOutRunResultV1[] = [];
    for (const runRef of read.value.liveRuns) {
      try {
        runs.push(await fanOutRun(ctx, scope, goalRef, control, epoch, goal.desiredState, runRef, startup));
      } catch (error) {
        runs.push({ runRef, outcome: 'failed', intentRef: null, reason: messageOf(error) });
      }
    }
    if (control !== 'resume') return { goalRef, epoch, control, runs, problem: null };
    const continued = await continueResumed(ctx, scope, goalRef);
    return { goalRef, epoch, control, runs, problem: continued.problem, continuations: continued.results };
  }

  /**
   * GOAL-29 (C4, §2.3): after a resume, every Task whose selected Run ended
   * paused-interrupted by this Goal's fan-out pause and that no TaskRequeue
   * covers is continued with `requeueTask` under `GOAL_FAN_OUT_ACTOR` and the
   * `goal_resume` trigger; the deterministic requestId makes a repeat (a later
   * pass, a restart re-drive) replay the receipt, and an existing TaskRequeue
   * (a person who pressed 继续 first) removes the Task from the selection.
   */
  async function continueResumed(ctx: CoreCallContext, scope: Scope, goalRef: GoalRef):
    Promise<{ results: GoalResumeContinuationResultV1[]; problem: string | null }> {
    let read;
    try {
      read = await deps.plans.queryGoalResumeContinuations(ctx, { goalRef });
    } catch (error) {
      return { results: [], problem: `the resume continuations are not readable: ${messageOf(error)}` };
    }
    if (read.status !== 'ready') return { results: [], problem: `the resume continuations are not readable (${reasonOf(read)})` };
    const results: GoalResumeContinuationResultV1[] = [];
    for (const continuation of read.value.continuations) {
      const result = (outcome: GoalResumeContinuationResultV1['outcome'], reason: string | null): GoalResumeContinuationResultV1 =>
        ({ taskId: continuation.taskId, afterRunRef: continuation.afterRunRef, outcome, reason });
      try {
        const written = await deps.claims.requeueTask(fanOutContext(scope), {
          input: { taskRef: { projectId: goalRef.projectId, goalId: goalRef.goalId, taskId: continuation.taskId },
            afterRunRef: continuation.afterRunRef, reason: `goal ${goalRef.goalId} resumed at epoch ${String(continuation.trigger.resumedEpoch)}`,
            trigger: continuation.trigger },
          meta: { requestId: continuation.requestId, expected: [{ ref: goalRef, revision: read.value.goal.revision },
            { ref: continuation.afterRunRef, revision: continuation.afterRunRevision }] },
        });
        if (written.status === 'committed') {
          results.push(written.value.kind === 'requeued' ? result('requeued', null) : result('refused', written.value.refusal.code));
          continue;
        }
        // GOAL-29: a TaskRequeue already covering the Run is done; a Goal that moved on drops this continuation.
        const current = written.current ?? [];
        if (written.code === 'revision_conflict'
          && current.some(pin => (pin.ref as { aggregateType?: unknown }).aggregateType === 'TaskRequeue')) {
          results.push(result('already_continued', reasonOf(written)));
          continue;
        }
        if (written.code === 'revision_conflict' || written.code === 'busy') {
          const goal = await deps.plans.queryGoal(ctx, goalRef);
          const moved = goal.status === 'ready' && (goal.value.goal.desiredState !== 'active'
            || goal.value.goal.desiredStateRevision !== continuation.trigger.resumedEpoch);
          if (moved) {
            results.push(result('stale', reasonOf(written)));
            continue;
          }
        }
        results.push(result('failed', reasonOf(written)));
      } catch (error) {
        results.push(result('failed', messageOf(error)));
      }
    }
    return { results, problem: null };
  }

  /** One pass on the driver's own signal, drained by `close()`. */
  function fanOut(ctx: CoreCallContext, goalRef: GoalRef, options: GoalFanOutPassOptions = {}): Promise<GoalFanOutReportV1> {
    return track(runPass({ ...ctx, signal: hostSignal }, goalRef, options.startup === true), passes);
  }

  /** Re-read every watched intent; a Goal whose watched intent moved gets a new pass for its current epoch. */
  async function checkWatches(): Promise<void> {
    // Leave the committing call first: the observer runs inside the commit path.
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    const moved = new Map<string, Watch>();
    for (const [key, watch] of [...watches]) {
      if (closed) return;
      let read: ReadResult<ControlIntentSnapshotV1>;
      try {
        read = await deps.controls.readControl(fanOutContext(watch.scope), watch.intentRef);
      } catch {
        continue;
      }
      // An unreadable intent tells nothing new: keep watching.
      if (read.status !== 'ready' || read.value.status === watch.status) continue;
      watches.delete(key);
      moved.set(goalKeyOf(watch.goalRef), watch);
    }
    for (const watch of moved.values()) {
      if (closed) return;
      await fanOut(fanOutContext(watch.scope), watch.goalRef).catch(() => undefined);
    }
  }

  /** One check at a time; a notice during a check runs one more. */
  function scheduleCheck(): void {
    recheck = true;
    if (checking !== null || closed) return;
    checking = (async () => {
      while (recheck && !closed && watches.size > 0) {
        recheck = false;
        await checkWatches().catch(() => undefined);
      }
    })().finally(() => {
      checking = null;
      if (recheck && !closed && watches.size > 0) scheduleCheck();
    });
  }

  return {
    async setGoalControl(ctx, request) {
      // The Goal commit keeps the request's signal; its fan-out runs on the driver's own.
      const written = await deps.goals.setGoalControl(ctx, request);
      if (written.status !== 'committed') return written;
      // A replayed receipt drives the fan-out again: the pass is idempotent (§2.3).
      const fanOutReport = await fanOut(ctx, written.value.ref);
      return { status: 'committed', value: { goal: written.value, fanOut: fanOutReport }, replayed: written.replayed,
        cursor: written.cursor };
    },
    async readGoalDisplay(ctx, input) {
      // runStops order 3: the workspace capability report (D-15); a Host without a Kernel Store reports why.
      const unsupported = (reason: string): { pause: GoalRunControlCapabilityV1; cancel: GoalRunControlCapabilityV1 } =>
        ({ pause: { status: 'unsupported', reason }, cancel: { status: 'unsupported', reason } });
      let capabilities = unsupported('the call context names no workspace');
      if (ctx.workspaceId !== undefined) {
        try {
          const report = await deps.runtime.capabilities(ctx, { projectId: ctx.projectId, workspaceId: ctx.workspaceId });
          capabilities = report.status === 'ready'
            ? { pause: capabilityOf(report.value.safePointPause), cancel: capabilityOf(report.value.cancel) }
            : unsupported(`no capability report (${reasonOf(report)})`);
        } catch (error) {
          capabilities = unsupported(`no capability report (${messageOf(error)})`);
        }
      }
      // A malformed HTTP input reaches the owner, which answers `invalid`.
      const goalRef = (input as { goalRef?: GoalRef } | null | undefined)?.goalRef as GoalRef;
      const read = await deps.plans.queryGoalDisplay(ctx, { goalRef, entryControlCapabilities: capabilities });
      if (read.status !== 'ready') return read;
      // A failed re-entry is shown only while its Run still waits for the resume.
      const waiting = new Set(read.value.resumePending.map((pending) => runKeyOf(pending.runRef)));
      const failures = [...reentryFailures.entries()].filter(([key]) => waiting.has(key)).map(([, failure]) => failure);
      return { status: 'ready', value: { ...read.value, reentryFailures: failures } };
    },
    fanOut,
    committed(notice) {
      if (closed || watches.size === 0) return;
      try {
        const projects = new Set([...watches.values()].map((watch) => watch.scope.projectId));
        const touches = notice.aggregates.some((aggregate) => aggregate.aggregateType === 'ControlIntent'
          && (aggregate.projectId === null || projects.has(aggregate.projectId)));
        if (touches) scheduleCheck();
      } catch { /* an observer never affects the commit */ }
    },
    async close() {
      closed = true;
      watches.clear();
      // A pass may still start a re-entry while it finishes: drain until nothing is left.
      while (checking !== null || passes.size > 0 || reentries.size > 0) {
        await Promise.allSettled([...(checking === null ? [] : [checking]), ...passes, ...reentries]);
      }
    },
  };
}
