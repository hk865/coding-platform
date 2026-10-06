/**
 * Task failure facts (docs/refactor/STATE-MACHINES-SPEC.md §4 TD-8, TD-9, 4.1
 * "失败事实读模型"; decisions C1, C2, C4, C5, C8; hard limits 1–3).
 *
 * Not a machine of its own (§15.1): a Task has no writable object here. The
 * file holds the pure derivations the rework owners use as guards and the read
 * model shows, so the display and the guard never disagree:
 *  - `deriveReworkClass` (FC-1..FC-17), `stopRequesterOf`, `reworkStopOf`,
 *    `reworkFenceOf` (the human-stop fence, hard limit 3);
 *  - `reworkPermission`: steps 4–5 of the unified order (§4.3 "处理步骤") —
 *    Goal `active`, then the §4.3 "操作者与失败类别" matrix with the fence;
 *  - `priorRequeueAutoCount` / `nextRequeueAutoCount` (C8 counter along the
 *    Run chain, `consumedWait` keeps the chain);
 *  - `automationVerdict` (AV-0..AV-12 with AV-7a..AV-7d for work, GV-0..GV-10
 *    with GV-3′ for a gate);
 *  - `buildTaskFailureFacts` (`TaskRow.failure`, `TaskRow.rework`), the only
 *    producer of `TaskFailureFactsV1` (§14.1);
 *  - `countEndedGoalRuns` and refusal staleness (ND-7, ND-8, LA-4);
 *  - `newTaskReworkRefusalRecord`, the only writer of `TaskReworkRefusal@k`
 *    (§14.1), and the TASK-28 / VR-14 refusal effect.
 *
 * A.2 step 2 (§15.2) scope: these tables have no 现状 row in today's code; they
 * are pure and implemented in full. The owners wire them in step 5 (5.4 FC and
 * the facts, 5.8 AV, 5.9 AV-7a..AV-7d and GV); TASK-16/17/27/28 stay in
 * `task-machine.ts` and VR-14 in `verification-machine.ts`. Since 5.4 (lead
 * decision LD-1) `buildTaskFailureFacts` takes the verdict from its owner;
 * since 5.8 the owner judges it with `automationVerdict` (reading the
 * successor-round rows AV-7a..AV-7d as `none` until 5.9).
 *
 * The owner does every read: the Runs of the Task, the pointer ControlIntent
 * (immutable request fields, read after the window), the chain heads, the
 * TaskRequeue and refusal records, the Goal-wide ended-Run count, the current
 * check configuration revision, the Kernel `run.failed` text and the policy
 * all come in the input. Pure: imports only `src/contracts` and this
 * directory (§14.4).
 */
import type { ActorRef } from '../../../contracts/command-event.js';
import { compareSourceCheckpoints } from '../../../contracts/continuation-brief.js';
import type { ControlIntentRef, ControlIntentRequestV1 } from '../../../contracts/control-intent.js';
import type { RunRef, RunSnapshot, TaskAttemptRef, TaskTriple } from '../../../contracts/dispatch.js';
import type { GoalDesiredState } from '../../../contracts/ledger.js';
import type { SourceStampV1 } from '../../../contracts/no-progress.js';
import type { Disposition } from '../../../contracts/plan.js';
import type {
  NotReworkableCause, RunErrorSource, TaskAutomationStopDetailV1, TaskAutomationStopReason, TaskAutomationVerdictV1,
  TaskFailureFactsV1, TaskReworkRefusalFactV1, TaskReworkSummaryEntryV1, TaskReworkSummaryV1,
} from '../../../contracts/task-failure.js';
import {
  GOAL_FAN_OUT_ACTOR, TASK_REWORK_REASON_MAX_CHARS, WORKFLOW_AUTOMATION_ACTOR, reworkActorClassOf,
  type ReworkActorClass, type ReworkFailureClass, type StopRequester, type TaskAutomationPolicyV1,
  type TaskRequeueAutomationV1, type TaskRequeueHistorySourceV1, type TaskRequeueRef, type TaskRequeueSnapshotV1,
  type TaskReworkOperation,
  type TaskReworkRefusalCode, type TaskReworkRefusalRef, type TaskReworkRefusalSnapshotV1,
} from '../../../contracts/task-requeue.js';
import { ROUND_CHAIN_MAX, type RoundSnapshot, type VerificationRoundRef } from '../../../contracts/verification.js';
import { roundFailureFacts, runFailureOrigin } from './no-progress.js';
import { isPausedInterrupted, runUnresolvedBlocker } from './run-machine.js';
import { reject, unreachable, type Rejected } from './transition.js';
import {
  isFinalizedNonPass, reverifyExemption, reverifyFailureClass, roundOrdinalOf, type RoundChainHeadV1,
} from './verification-machine.js';

// ------------------------------------------------------------------------ //
// Vocabulary                                                                //
// ------------------------------------------------------------------------ //
/** The three rework actor classes in matrix column order (§4.3). */
export const REWORK_ACTOR_CLASSES: readonly ReworkActorClass[] = Object.freeze(['human', 'system', 'agent']);

/**
 * The request fields of the selected Run's pointer ControlIntent this file
 * reads. They are immutable, so the owner reads the intent after its fact
 * window (§2.1 "展示读取"); a `ControlIntentSnapshotV1` qualifies.
 */
export type StopIntentV1 = Pick<ControlIntentRequestV1, 'ref' | 'kind' | 'requestedBy'>;

/**
 * The human-stop fence (§1.3, §11 `fence(r)`, hard limit 3):
 * - `human_only`: the pointer is an operator's pause or cancel, or the Run is
 *   paused-interrupted by any other pause (C4: only a human continues);
 * - `human_or_goal_resume`: paused-interrupted by a Goal fan-out pause; a human
 *   or the Goal-resume continuation (GOAL-29) may continue it;
 * - `none`: everything else. A gate has no pointer and is never fenced.
 */
export type ReworkFence = 'none' | 'human_only' | 'human_or_goal_resume';

/** `TaskRequeue.stopIntentRef` / `stopRequester` (§11 I-12 clause 4). */
export type ReworkStopV1 = { intentRef: ControlIntentRef | null; requester: StopRequester };

/** A `reworkPermission` refusal in the shared machine shape (§1.2); the owner answers it with 0 commits. */
export type ReworkPermissionRefusal = Rejected;

// ------------------------------------------------------------------------ //
// Stop requester and fence                                                  //
// ------------------------------------------------------------------------ //
/**
 * Who stopped a Run through its pointer intent (§1.3). Never decided by
 * `ActorRef.kind`: `GOAL_FAN_OUT_ACTOR` is `goal_fan_out`,
 * `WORKFLOW_AUTOMATION_ACTOR` is `system`, every other actor (an operator,
 * including a Host started with a `kind:'system'` actor) is `human`; no
 * pointer, or a resume/steer pointer, is `none`.
 */
export function stopRequesterOf(intent: Pick<ControlIntentRequestV1, 'kind' | 'requestedBy'> | null): StopRequester {
  if (intent === null) return 'none';
  switch (intent.kind) {
    case 'pause':
    case 'cancel':
      break;
    case 'resume':
    case 'steer':
      return 'none';
    default:
      return unreachable(intent.kind, 'control intent kind');
  }
  if (sameActor(intent.requestedBy, GOAL_FAN_OUT_ACTOR)) return 'goal_fan_out';
  if (sameActor(intent.requestedBy, WORKFLOW_AUTOMATION_ACTOR)) return 'system';
  return 'human';
}

/**
 * I-12 clause 4: a pause or cancel pointer gives its ref and
 * `stopRequesterOf`; any other pointer, or none, gives `null` and `none`.
 */
export function reworkStopOf(pointerIntent: StopIntentV1 | null): ReworkStopV1 {
  const requester = stopRequesterOf(pointerIntent);
  return pointerIntent === null || requester === 'none'
    ? { intentRef: null, requester: 'none' }
    : { intentRef: { ...pointerIntent.ref }, requester };
}

/** `reworkFenceOf(selectedRun, pointerIntent)`; see `ReworkFence`. */
export function reworkFenceOf(
  run: Pick<RunSnapshot, 'outcome' | 'reconciliation'>,
  pointerIntent: Pick<ControlIntentRequestV1, 'kind' | 'requestedBy'> | null,
): ReworkFence {
  const requester = stopRequesterOf(pointerIntent);
  if (isPausedInterrupted(run)) return requester === 'goal_fan_out' ? 'human_or_goal_resume' : 'human_only';
  return requester === 'human' ? 'human_only' : 'none';
}

// ------------------------------------------------------------------------ //
// Failure class (TD-8, FC-1..FC-17)                                         //
// ------------------------------------------------------------------------ //

/**
 * The FC row that matched (first match in row order) and what it means:
 * `no_rework` (nothing to rework now), `not_reworkable` (with the read-model
 * cause) or `class` (a rework class). `stop` is the pointer fact of I-12
 * clause 4 for every row; `interruption` is non-null only for `interrupted`.
 */
export type ReworkClassDerivationV1 =
  | { row: 'FC-1' | 'FC-5' | 'FC-12' | 'FC-14' | 'FC-17'; kind: 'no_rework'; stop: ReworkStopV1 }
  | {
    row: 'FC-2' | 'FC-4' | 'FC-11';
    kind: 'not_reworkable';
    cause: Extract<NotReworkableCause, 'run_outcome_unknown' | 'continuation_paused' | 'round_ambiguous'>;
    /** The `runUnresolvedBlocker` text (FC-2), or why the chain is invalid (FC-11). */
    detail: string;
    stop: ReworkStopV1;
  }
  | {
    row: 'FC-3' | 'FC-6' | 'FC-7' | 'FC-8' | 'FC-9' | 'FC-10' | 'FC-13' | 'FC-15' | 'FC-16';
    kind: 'class';
    failureClass: ReworkFailureClass;
    interruption: 'executing' | 'paused' | null;
    stop: ReworkStopV1;
  };

/**
 * TD-8 `deriveReworkClass` over the selected Run, its pointer intent and the
 * Run's round chain head (`roundChainHead` of its work chain). Rows in order,
 * first match wins:
 *
 * | FC | the selected Run | result |
 * | --- | --- | --- |
 * | 1 | `status ≠ ended` | no rework (`running`) |
 * | 2 | `runUnresolvedBlocker(run) ≠ null` | `run_outcome_unknown` (hard limit 1) |
 * | 3 | `yielded`, continuation, pointer `cancelled` (P17) | `cancelled` |
 * | 4 | `yielded`, pointer `paused` (P18) | `continuation_paused` |
 * | 5 | `yielded`, other (P5/P14) | no rework (`ready`) |
 * | 6 | `crashed`, `interrupted_clean`, `pausedIntentRef ≠ null` (RUN-24) | `interrupted` / `paused` |
 * | 7 | `crashed`, `interrupted_clean`, `pausedIntentRef = null` (RUN-19) | `interrupted` / `executing` |
 * | 8 | `cancelled` (D-7, running cancel, RUN-23) | `cancelled` |
 * | 9 | `crashed` (Kernel or `human_attested`) or `failed` | `run_failed` |
 * | 10 | `budget_exhausted` | `run_failed` |
 * | 11 | `completed`, chain invalid | `round_ambiguous` |
 * | 12 | `completed`, no round | no rework (`awaiting_verification`) |
 * | 13 | `completed`, head open, only `interrupted` left (P9) | `check_incomplete` (finalize first) |
 * | 14 | `completed`, head open, other (P12) | no rework (`verifying`) |
 * | 15 | `completed`, head finalized FAIL | `check_failed` |
 * | 16 | `completed`, head finalized INCONCLUSIVE or legacy PASS with gaps | `check_incomplete` |
 * | 17 | `completed`, head finalized PASS, `gaps=[]` | no rework (`awaiting_completion`) |
 *
 * An ended Run without an outcome is not a known outcome either: it reads as
 * FC-2 (reconcile first), like `noProgressKey`'s "ended without an outcome".
 */
export function deriveReworkClass(run: RunSnapshot, pointerIntent: StopIntentV1 | null, chain: RoundChainHeadV1): ReworkClassDerivationV1 {
  const stop = reworkStopOf(pointerIntent);
  if (run.status !== 'ended') return { row: 'FC-1', kind: 'no_rework', stop };
  const blocker = runUnresolvedBlocker(run);
  if (blocker !== null) return { row: 'FC-2', kind: 'not_reworkable', cause: 'run_outcome_unknown', detail: blocker, stop };
  const outcome = run.outcome;
  if (outcome === null) {
    return { row: 'FC-2', kind: 'not_reworkable', cause: 'run_outcome_unknown',
      detail: `run ${run.ref.runId} ended without an outcome`, stop };
  }
  const rework = (row: Extract<ReworkClassDerivationV1, { kind: 'class' }>['row'], failureClass: ReworkFailureClass,
    interruption: 'executing' | 'paused' | null = null): ReworkClassDerivationV1 =>
    ({ row, kind: 'class', failureClass, interruption, stop });
  switch (outcome) {
    case 'yielded': {
      const pointer = run.controlState?.desiredState;
      if (run.continuation !== undefined && pointer === 'cancelled') return rework('FC-3', 'cancelled');
      if (pointer === 'paused') {
        return { row: 'FC-4', kind: 'not_reworkable', cause: 'continuation_paused',
          detail: `run ${run.ref.runId} is a paused yielded wait; resume or cancel it`, stop };
      }
      return { row: 'FC-5', kind: 'no_rework', stop };
    }
    case 'crashed': {
      const observation = run.reconciliation?.observation;
      if (observation !== undefined && observation.kind === 'interrupted_clean') {
        return observation.pausedIntentRef !== null
          ? rework('FC-6', 'interrupted', 'paused')
          : rework('FC-7', 'interrupted', 'executing');
      }
      return rework('FC-9', 'run_failed');
    }
    case 'cancelled':
      return rework('FC-8', 'cancelled');
    case 'failed':
      return rework('FC-9', 'run_failed');
    case 'budget_exhausted':
      return rework('FC-10', 'run_failed');
    case 'completed':
      return completedRunClass(chain, stop);
    case 'outcome_unknown':
      // `runUnresolvedBlocker` answers it above; kept for the exhaustive switch.
      return { row: 'FC-2', kind: 'not_reworkable', cause: 'run_outcome_unknown',
        detail: `run ${run.ref.runId} ended with an unknown outcome`, stop };
    default:
      return unreachable(outcome, 'run outcome');
  }
}

/** FC-11..FC-17: a completed Run is judged by its chain head (§9 VD-14). */
function completedRunClass(chain: RoundChainHeadV1, stop: ReworkStopV1): ReworkClassDerivationV1 {
  switch (chain.kind) {
    case 'invalid':
      return { row: 'FC-11', kind: 'not_reworkable', cause: 'round_ambiguous', detail: chain.reason, stop };
    case 'none':
      return { row: 'FC-12', kind: 'no_rework', stop };
    case 'head':
      break;
    default:
      return unreachable(chain, 'round chain');
  }
  const head = chain.head;
  switch (head.status) {
    case 'open':
      return onlyInterruptedLeft(head)
        ? { row: 'FC-13', kind: 'class', failureClass: 'check_incomplete', interruption: null, stop }
        : { row: 'FC-14', kind: 'no_rework', stop };
    case 'finalized':
      break;
    default:
      return unreachable(head.status, 'round status');
  }
  if (head.outcome === 'FAIL') return { row: 'FC-15', kind: 'class', failureClass: 'check_failed', interruption: null, stop };
  if (isFinalizedNonPass(head)) {
    return { row: 'FC-16', kind: 'class', failureClass: 'check_incomplete', interruption: null, stop };
  }
  return { row: 'FC-17', kind: 'no_rework', stop };
}

/** P9: an open round with no `pending`/`executing` check and at least one `interrupted` check. */
function onlyInterruptedLeft(head: Pick<RoundSnapshot, 'checks'>): boolean {
  return !head.checks.some((check) => check.phase === 'pending' || check.phase === 'executing')
    && head.checks.some((check) => check.phase === 'interrupted');
}

// ------------------------------------------------------------------------ //
// Actor × class matrix (§4.3 "操作者与失败类别", steps 4–5)                  //
// ------------------------------------------------------------------------ //
export type ReworkPermissionInputV1 = {
  operation: TaskReworkOperation;
  goalDesiredState: GoalDesiredState;
  /** requeue: TD-8 (`deriveReworkClass`); reverify: `reverifyFailureClass(head)`. */
  failureClass: ReworkFailureClass;
  /** Class `interrupted` only; `paused` is the "continue" of P19 (TASK-27). */
  interruption: 'executing' | 'paused' | null;
  /** `reworkFenceOf(selectedRun, pointerIntent)`; `none` for a gate. */
  fence: ReworkFence;
  /** `reworkActorClassOf(principal, actor)`. */
  actorClass: ReworkActorClass;
  /** The actor is canonically `GOAL_FAN_OUT_ACTOR` (class `system`). */
  goalFanOut: boolean;
  /**
   * The request carries a `goal_resume` trigger. For `GOAL_FAN_OUT_ACTOR` the
   * owner has already checked its epochs and pointer intent (TASK-27, GOAL-29:
   * `forbidden`, or `revision_conflict` when stale) before asking this table.
   */
  trigger: boolean;
  /** requeue only: the request names a `budget`. */
  budget: boolean;
  /** The request carries a human `note`. */
  note: boolean;
};

/**
 * Steps 4–5 of the unified order (§4.3 "处理步骤"; §9 VR-14 steps 4–5), after
 * the owner's state preconditions (step 3) and before the policy steps:
 *
 * 1. Goal `desiredState ≠ 'active'` → `busy` "resume the Goal first", for
 *    every actor class and both operations;
 * 2. the human-stop fence (hard limit 3): `human_only` admits only `human`;
 *    `human_or_goal_resume` admits `human` and `GOAL_FAN_OUT_ACTOR` with a
 *    trigger → `forbidden`;
 * 3. `GOAL_FAN_OUT_ACTOR` only performs TASK-27 with a trigger; in every other
 *    row of the matrix it is `forbidden` (I-12 clause 6), so the `system`
 *    column below means `WORKFLOW_AUTOMATION_ACTOR`;
 * 4. the class matrix: a paused interruption is continued only by a human or
 *    the Goal-resume continuation (`forbidden`); `cancelled` is not for
 *    `agent` (`forbidden`, C2); a requeue of `check_incomplete` is only for
 *    `human` (`illegal`/`invalid`, it is reworked by a successor round);
 *    a reverify exists only for `check_failed` / `check_incomplete`
 *    (`illegal`/`invalid`);
 * 5. request fields (`illegal`/`invalid`): an agent `budget`, a non-human
 *    `note`, a trigger from any actor but `GOAL_FAN_OUT_ACTOR`.
 *
 * Null when admitted. Budget, cap and key checks are the committed policy
 * refusals of TASK-28 and are not here (§1.2).
 */
export function reworkPermission(input: ReworkPermissionInputV1): ReworkPermissionRefusal | null {
  if (input.goalDesiredState !== 'active') {
    return reject('guard_failed', 'busy', `the Goal is ${input.goalDesiredState}; resume the Goal first`);
  }
  const human = input.actorClass === 'human';
  const goalResume = input.goalFanOut && input.trigger;
  switch (input.fence) {
    case 'none':
      break;
    case 'human_only':
      if (!human) return reject('guard_failed', 'forbidden', 'a human stopped this work; only an operator may rework it');
      break;
    case 'human_or_goal_resume':
      if (!human && !goalResume) {
        return reject('guard_failed', 'forbidden',
          'a Goal pause stopped this work; only an operator or the Goal-resume continuation may continue it');
      }
      break;
    default:
      return unreachable(input.fence, 'rework fence');
  }
  if (input.goalFanOut && !(input.operation === 'requeue' && input.failureClass === 'interrupted'
    && input.interruption === 'paused' && input.trigger)) {
    return reject('guard_failed', 'forbidden',
      'the Goal fan-out actor only continues a paused-interrupted Run with a goal_resume trigger (TASK-27)');
  }
  const classProblem = input.operation === 'requeue' ? requeueClassProblem(input, human, goalResume) : reverifyClassProblem(input);
  if (classProblem !== null) return classProblem;
  if (input.budget && input.actorClass === 'agent') return reject('illegal', 'invalid', 'an agent may not set a requeue budget');
  if (input.note && !human) return reject('illegal', 'invalid', 'only an operator may attach a note');
  if (input.trigger && !input.goalFanOut) return reject('illegal', 'invalid', 'only the Goal fan-out actor may carry a trigger');
  return null;
}

/** The requeue column of the matrix. */
function requeueClassProblem(input: ReworkPermissionInputV1, human: boolean, goalResume: boolean): Rejected | null {
  switch (input.failureClass) {
    case 'interrupted':
      if (input.interruption === 'paused' && !human && !goalResume) {
        return reject('guard_failed', 'forbidden', 'a paused task can only be continued by an operator');
      }
      return null;
    case 'cancelled':
      return input.actorClass === 'agent'
        ? reject('guard_failed', 'forbidden', 'a cancelled task is requeued only by an operator or the platform automation')
        : null;
    case 'check_incomplete':
      return human ? null
        : reject('illegal', 'invalid', 'check_incomplete is reworked by a successor round (reverify), not a requeue');
    case 'check_failed':
    case 'run_failed':
      return null;
    default:
      return unreachable(input.failureClass, 'rework failure class');
  }
}

/** The reverify column: every class may reverify a finalized non-PASS head; the fence is checked above. */
function reverifyClassProblem(input: ReworkPermissionInputV1): Rejected | null {
  switch (input.failureClass) {
    case 'check_failed':
    case 'check_incomplete':
      return null;
    case 'interrupted':
    case 'cancelled':
    case 'run_failed':
      return reject('illegal', 'invalid', `a ${input.failureClass} Run has no round to reverify`);
    default:
      return unreachable(input.failureClass, 'rework failure class');
  }
}

// ------------------------------------------------------------------------ //
// Automatic requeue count (C8, I-12 clause 7)                               //
// ------------------------------------------------------------------------ //
type ChainRun = Pick<RunSnapshot, 'ref' | 'requeueRef' | 'consumedWait'>;

/**
 * The `automation.autoCount` of the TaskRequeue that started the Run chain
 * ending at `from`: walk back through `consumedWait` (a yielded continuation
 * keeps the chain) to the first Run with a `requeueRef` and take that record's
 * count; 0 without one. A cycle or a Run that was not read ends the walk.
 */
export function priorRequeueAutoCount(
  from: ChainRun,
  runs: readonly ChainRun[],
  requeues: readonly Pick<TaskRequeueSnapshotV1, 'ref' | 'automation'>[],
): number {
  const byRunId = new Map(runs.map((run) => [run.ref.runId, run]));
  const seen = new Set<string>();
  let current: ChainRun | undefined = from;
  while (current !== undefined && !seen.has(current.ref.runId)) {
    seen.add(current.ref.runId);
    const requeueRef = current.requeueRef;
    if (requeueRef !== undefined) {
      return requeues.find((requeue) => sameRequeueRef(requeue.ref, requeueRef))?.automation.autoCount ?? 0;
    }
    current = current.consumedWait === undefined ? undefined : byRunId.get(current.consumedWait.runRef.runId);
  }
  return 0;
}

/**
 * `TaskRequeue.automation` of a new requeue (C8, I-12 clause 7):
 * `automatic` ⇔ class `system`/`agent`; `counted` ⇔ automatic and not
 * `interrupted`; `autoCount` is 0 for a human, `prior + 1` when counted,
 * otherwise `prior`; `cap` is the current limit for an automatic requeue and
 * null for a human. The owner refuses `auto_rework_cap_reached` when
 * `counted ∧ autoCount > cap` (G-CAP).
 */
export function nextRequeueAutoCount(input: {
  actorClass: ReworkActorClass;
  failureClass: ReworkFailureClass;
  afterRun: ChainRun;
  runs: readonly ChainRun[];
  requeues: readonly Pick<TaskRequeueSnapshotV1, 'ref' | 'automation'>[];
  policy: Pick<TaskAutomationPolicyV1, 'autoReworkLimit'>;
}): TaskRequeueAutomationV1 {
  const automatic = input.actorClass !== 'human';
  const counted = automatic && input.failureClass !== 'interrupted';
  const prior = priorRequeueAutoCount(input.afterRun, input.runs, input.requeues);
  return {
    automatic,
    counted,
    autoCount: !automatic ? 0 : counted ? prior + 1 : prior,
    cap: automatic ? input.policy.autoReworkLimit : null,
  };
}

/**
 * `TaskRequeue.historySource` (§11 I-12 clause 10, LA-1): the model history a
 * continuing Run may be seeded from, derived from the directed window, never
 * from the caller. An afterRun that entered the Kernel names its claim
 * Session and the completed Turn boundary its Kernel terminal recorded
 * (`executionHistory.endPosition`, the position RUN-07 moved the Session
 * cursor to); a Turn the platform ended without a Kernel terminal (RUN-19/23/24,
 * RUN-22 on an open Turn: the end is null) names the position before that Turn,
 * the bound of the completed history the Session cursor kept, which `prepare`
 * resolves to the last completed boundary at or before it (5.6, LA-1); one that
 * never entered copies the `historySource` of the
 * TaskRequeue its `requeueRef` names (one hop: that record was derived by the
 * same rule), and has none without a `requeueRef` or when that record was not
 * read.
 */
export function requeueHistorySourceOf(
  afterRun: Pick<RunSnapshot, 'executionHistory' | 'requeueRef'>,
  requeues: readonly Pick<TaskRequeueSnapshotV1, 'ref' | 'historySource'>[],
): TaskRequeueHistorySourceV1 | null {
  const history = afterRun.executionHistory;
  if (history !== undefined) {
    return { sessionRef: { projectId: history.sessionRef.projectId, sessionId: history.sessionRef.sessionId },
      adapterId: history.kernel.adapterId, kernelSessionId: history.kernel.kernelSessionId,
      throughPosition: history.endPosition ?? (history.startPosition > 1 ? history.startPosition - 1 : null) };
  }
  const requeueRef = afterRun.requeueRef;
  if (requeueRef === undefined) return null;
  const source = requeues.find((requeue) => sameRequeueRef(requeue.ref, requeueRef))?.historySource ?? null;
  return source === null ? null : { sessionRef: { projectId: source.sessionRef.projectId, sessionId: source.sessionRef.sessionId },
    adapterId: source.adapterId, kernelSessionId: source.kernelSessionId, throughPosition: source.throughPosition };
}

// ------------------------------------------------------------------------ //
// Refusal watermark and staleness (ND-7, ND-8, LA-4)                        //
// ------------------------------------------------------------------------ //
/**
 * §11 `countEndedGoalRuns(g)`: Runs with `status='ended'` among the Goal's
 * raw candidates, never filtered by Plan or Task, so the refusal writer and the
 * read model count the same set.
 */
export function countEndedGoalRuns(runs: readonly Pick<RunSnapshot, 'status'>[]): number {
  return runs.filter((run) => run.status === 'ended').length;
}

/** What a refusal's staleness is judged against at read time. */
export type ReworkRefusalClockV1 = {
  /** `countEndedGoalRuns` now. */
  goalEndedRuns: number;
  /** The current check configuration revision (`configurationFor(scope)`, LA-4); null when unknown. */
  configurationRevision: string | null;
};

/**
 * A refusal is stale iff the Goal has ended more Runs since it was written, or
 * it recorded a configuration revision and the current one differs (an
 * unknown current revision does not make it stale). No clock is read: the
 * bound is the number of Run ends and configuration revisions (GAP-47).
 */
export function reworkRefusalIsStale(
  refusal: Pick<TaskReworkRefusalSnapshotV1, 'goalEndedRunsAtRefusal' | 'configurationRevision'>,
  now: ReworkRefusalClockV1,
): boolean {
  if (now.goalEndedRuns > refusal.goalEndedRunsAtRefusal) return true;
  return refusal.configurationRevision !== null && now.configurationRevision !== null
    && now.configurationRevision !== refusal.configurationRevision;
}

function refusalFact(refusal: TaskReworkRefusalSnapshotV1, stale: boolean): TaskReworkRefusalFactV1 {
  return { ref: { ...refusal.ref }, revision: refusal.revision, code: refusal.code, reason: refusal.reason,
    requestedBy: { ...refusal.requestedBy }, refusedAt: refusal.refusedAt, stale };
}

// ------------------------------------------------------------------------ //
// Run error text (§6.1 contract (f))                                        //
// ------------------------------------------------------------------------ //
/**
 * The read model's and the continuation brief's error text, in this order:
 * `terminalPayload`, the reconciliation event payload, the Kernel `run.failed`
 * text the owner read. A payload gives text only for `crashed` (`error`) and
 * `cancelled` (`reason`); otherwise the next source is read. Nothing →
 * `error: null, errorSource: 'not_recorded'`.
 */
export function runErrorOf(
  run: Pick<RunSnapshot, 'terminalPayload' | 'reconciliation'>,
  kernelRunFailedError: string | null,
): { error: string | null; errorSource: RunErrorSource } {
  const fromPayload = run.terminalPayload === undefined ? null : payloadErrorText(run.terminalPayload);
  if (fromPayload !== null) return { error: fromPayload, errorSource: 'terminal_payload' };
  const observation = run.reconciliation?.observation;
  if (observation !== undefined && (observation.kind === 'runtime_terminal' || observation.kind === 'interrupted_clean')) {
    const fromEvent = payloadErrorText(observation.event.payload);
    if (fromEvent !== null) return { error: fromEvent, errorSource: 'reconciliation_event' };
  }
  if (kernelRunFailedError !== null) return { error: kernelRunFailedError, errorSource: 'kernel_run_failed' };
  return { error: null, errorSource: 'not_recorded' };
}

function payloadErrorText(payload: NonNullable<RunSnapshot['terminalPayload']>): string | null {
  switch (payload.kind) {
    case 'crashed': return payload.error;
    case 'cancelled': return payload.reason;
    case 'started':
    case 'completed':
    case 'budget_exhausted':
    case 'yielded':
      return null;
    default: return unreachable(payload, 'terminal payload kind');
  }
}

// ------------------------------------------------------------------------ //
// Failure facts input                                                       //
// ------------------------------------------------------------------------ //
type FailureInputCommonV1 = {
  task: TaskTriple;
  /** The Task's disposition in the selected Plan; it never changes the phase (C7). */
  disposition: Disposition;
  /** P1: an applicable TaskReduction. */
  satisfied: boolean;
  goalDesiredState: GoalDesiredState;
  /** The latest reverify refusal under the head's key (`subjectId` = head roundId); null when absent. */
  reverifyRefusal: TaskReworkRefusalSnapshotV1 | null;
  /** `countEndedGoalRuns` over the Goal's raw candidates; never a guard. */
  goalEndedRuns: number;
  /** `configurationFor(scope)` now (LA-4); null when unknown. */
  configurationRevision: string | null;
  /** The Kernel `run.failed` text of the facts' Run, when the owner read one. */
  kernelRunFailedError: string | null;
};
/** A work Task, as the extended `readCanonicalTaskFacts` reads it in one window (§4.1). */
export type WorkFailureInputV1 = FailureInputCommonV1 & {
  subjectKind: 'work';
  /** The selected Run (§4.1 selection rule); null without one. */
  selectedRun: RunSnapshot | null;
  /** P15: no selected Run, but a Run or Reduction whose source Plan does not resolve. */
  originUnresolvable: boolean;
  /** The ControlIntent the selected Run's `controlState.intentRef` names. */
  pointerIntent: StopIntentV1 | null;
  /** `roundChainHead` of the selected Run's work chain. */
  chain: RoundChainHeadV1;
  /** Every Run of the Task (the Run-chain walk). */
  runs: readonly RunSnapshot[];
  /** Every TaskRequeue of the Task (read by each ended Run's afterRunId). */
  requeues: readonly TaskRequeueSnapshotV1[];
  /** The latest requeue refusal under the selected Run's key; null when absent. */
  requeueRefusal: TaskReworkRefusalSnapshotV1 | null;
};
/** A gate Task: its own chain (`VerificationRoundByTask`), anchored on the first producer Run (§9 VD-15). */
export type GateFailureInputV1 = FailureInputCommonV1 & {
  subjectKind: 'gate';
  chain: RoundChainHeadV1;
  /** The chain's anchored producer Run (`head.subjectRunRef`); null when not read or without a chain. */
  anchorRun: RunSnapshot | null;
  /** GV-5: a required, active work Task in the gate's scope is not yet satisfied. */
  fixInProgress: boolean;
};
export type TaskFailureInputV1 = WorkFailureInputV1 | GateFailureInputV1;

// ------------------------------------------------------------------------ //
// Automation verdict (TD-9, AV and GV tables)                               //
// ------------------------------------------------------------------------ //
/** AV-10 has no branch: it only states that AV-8 already covers a stored cap refusal. */
export type WorkVerdictRow =
  | 'AV-0' | 'AV-1' | 'AV-2' | 'AV-3' | 'AV-4' | 'AV-5' | 'AV-6'
  | 'AV-7a' | 'AV-7b' | 'AV-7c' | 'AV-7d' | 'AV-8' | 'AV-9' | 'AV-11' | 'AV-12';
export type GateVerdictRow =
  | 'GV-0' | 'GV-1' | 'GV-2' | 'GV-3' | 'GV-3′' | 'GV-4' | 'GV-5' | 'GV-6' | 'GV-7' | 'GV-8' | 'GV-9' | 'GV-10';
export type AutomationVerdictResultV1 =
  | { row: WorkVerdictRow; verdict: TaskAutomationVerdictV1 }
  | { row: GateVerdictRow; verdict: TaskAutomationVerdictV1 };

/**
 * TD-9: whether the owner would accept one automatic rework now, and if not
 * why. An admissibility fact, not a command (Workflow decides order, Session,
 * budget and whether to act). Work Tasks use the AV table, gates the GV table;
 * first match in row order wins.
 */
export function automationVerdict(input: TaskFailureInputV1, policy: TaskAutomationPolicyV1): AutomationVerdictResultV1 {
  switch (input.subjectKind) {
    case 'work': return workVerdict(workView(input), policy.autoReworkLimit);
    case 'gate': return gateVerdict(gateView(input), policy.autoReworkLimit);
    default: return unreachable(input, 'failure subject kind');
  }
}

type RefusalView = { record: TaskReworkRefusalSnapshotV1; stale: boolean };

type WorkView = {
  input: WorkFailureInputV1;
  run: RunSnapshot | null;
  /** Null without a selected Run. */
  derivation: ReworkClassDerivationV1 | null;
  fence: ReworkFence;
  head: RoundSnapshot | null;
  covering: TaskRequeueSnapshotV1 | null;
  requeueRefusal: RefusalView | null;
  reverifyRefusal: RefusalView | null;
  priorAutoCount: number;
};

type GateView = {
  input: GateFailureInputV1;
  head: RoundSnapshot | null;
  reverifyRefusal: RefusalView | null;
};

function clockOf(input: FailureInputCommonV1): ReworkRefusalClockV1 {
  return { goalEndedRuns: input.goalEndedRuns, configurationRevision: input.configurationRevision };
}

/** A refusal counts only under its own key: the operation and the subject the facts name. */
function refusalView(
  refusal: TaskReworkRefusalSnapshotV1 | null, operation: TaskReworkOperation, subjectId: string | null, clock: ReworkRefusalClockV1,
): RefusalView | null {
  if (refusal === null || subjectId === null || refusal.ref.operation !== operation || refusal.ref.subjectId !== subjectId) return null;
  return { record: refusal, stale: reworkRefusalIsStale(refusal, clock) };
}

function headOf(chain: RoundChainHeadV1): RoundSnapshot | null {
  return chain.kind === 'head' ? chain.head : null;
}

function workView(input: WorkFailureInputV1): WorkView {
  const run = input.selectedRun;
  const clock = clockOf(input);
  const head = headOf(input.chain);
  return {
    input,
    run,
    derivation: run === null ? null : deriveReworkClass(run, input.pointerIntent, input.chain),
    fence: run === null ? 'none' : reworkFenceOf(run, input.pointerIntent),
    head,
    covering: run === null ? null : input.requeues.find((requeue) => requeue.ref.afterRunId === run.ref.runId) ?? null,
    requeueRefusal: refusalView(input.requeueRefusal, 'requeue', run?.ref.runId ?? null, clock),
    reverifyRefusal: refusalView(input.reverifyRefusal, 'reverify', head?.ref.roundId ?? null, clock),
    priorAutoCount: run === null ? 0 : priorRequeueAutoCount(run, input.runs, input.requeues),
  };
}

function gateView(input: GateFailureInputV1): GateView {
  const head = headOf(input.chain);
  return { input, head, reverifyRefusal: refusalView(input.reverifyRefusal, 'reverify', head?.ref.roundId ?? null, clockOf(input)) };
}

const NONE: TaskAutomationVerdictV1 = Object.freeze({ kind: 'none' });

function stopped(reason: TaskAutomationStopReason, detail: TaskAutomationStopDetailV1 = {}): TaskAutomationVerdictV1 {
  return { kind: 'stopped', reason, detail };
}

/** AV-0..AV-12 (TD-9). */
function workVerdict(view: WorkView, limit: number): { row: WorkVerdictRow; verdict: TaskAutomationVerdictV1 } {
  const { input, run, derivation } = view;
  if (input.goalDesiredState !== 'active') return { row: 'AV-0', verdict: NONE };
  if (input.satisfied || input.disposition !== 'active' || (run !== null && run.status !== 'ended')
    || (run === null && !input.originUnresolvable)) {
    return { row: 'AV-1', verdict: NONE };
  }
  if (run === null || derivation === null) {
    return { row: 'AV-6', verdict: stopped('not_reworkable', { cause: 'origin_unresolvable' }) };
  }
  if (derivation.row === 'FC-2') return { row: 'AV-2', verdict: stopped('unknown_outcome') };
  if (view.covering !== null) {
    return { row: 'AV-3', verdict: { kind: 'claim_requeued', requeueRef: { ...view.covering.ref },
      budget: view.covering.budget === null ? null : { ...view.covering.budget } } };
  }
  if (view.fence === 'human_only') {
    // Literal row order (TD-9 puts AV-4 before AV-6): the fence also stops a
    // no-rework row (FC-5, FC-12, FC-14, FC-17) whose Run ended under an
    // operator's pause or cancel pointer, e.g. a pause superseded by a natural
    // completion (CTL-06; the pointer stays as history, §7 CD-4). Lead decision
    // (STEP5-FLIPS §14, synced into §4 TD-9 and §15.2 5.8): AV-4 stays as
    // written and `stopped` blocks only rework (requeue, reverify, a claim by
    // requeueRef); the Workflow still opens, runs, finalizes and completes the
    // rounds of a Run that ended `completed`.
    // A paused-interrupted Run is fenced by its pause even without a readable pointer.
    const paused = isPausedInterrupted(run) || input.pointerIntent?.kind === 'pause';
    return { row: 'AV-4', verdict: paused
      ? stopped('task_paused', { fence: 'human_pause', pausedBy: derivation.stop.requester })
      : stopped('task_cancelled', { fence: 'human_cancel' }) };
  }
  if (isPausedInterrupted(run) && view.fence === 'human_or_goal_resume') {
    return { row: 'AV-5', verdict: stopped('task_paused', { pausedBy: 'goal_fan_out' }) };
  }
  switch (derivation.kind) {
    case 'no_rework':
      return { row: 'AV-6', verdict: NONE };
    case 'not_reworkable':
      return { row: 'AV-6', verdict: derivation.cause === 'round_ambiguous'
        ? stopped('not_reworkable', { cause: 'round_ambiguous' }) : NONE };
    case 'class':
      break;
    default:
      return unreachable(derivation, 'rework class derivation');
  }
  if (derivation.failureClass === 'check_incomplete') {
    if (view.head === null) throw new Error('automationVerdict: check_incomplete is derived only from a chain head');
    return incompleteHeadVerdict(view.head, view.reverifyRefusal, derivation.row === 'FC-13', limit);
  }
  if (derivation.failureClass !== 'interrupted' && view.priorAutoCount + 1 > limit) {
    return { row: 'AV-8', verdict: stopped('auto_rework_cap_reached', { operation: 'requeue' }) };
  }
  const refusal = view.requeueRefusal;
  if (refusal !== null && !refusal.stale && refusal.record.code === 'no_new_basis') {
    return { row: 'AV-9', verdict: stopped('no_new_basis', { operation: 'requeue' }) };
  }
  // AV-10 (a stored cap refusal while the cap is still exceeded) is AV-8 above;
  // a stored cap refusal never stops the verdict after the cap was raised.
  if (derivation.failureClass === 'run_failed' && run.outcome === 'budget_exhausted') {
    return { row: 'AV-11', verdict: stopped('budget_exhausted', { minTokenBudgetExclusive: run.budget.tokenBudget }) };
  }
  return { row: 'AV-12', verdict: { kind: 'requeue', failureClass: derivation.failureClass,
    retryAfterRefusal: refusal !== null && refusal.stale } };
}

/** AV-7a..AV-7d: `check_incomplete` is reworked by a successor round on the work chain. */
function incompleteHeadVerdict(
  head: RoundSnapshot, refusal: RefusalView | null, needsFinalize: boolean, limit: number,
): { row: WorkVerdictRow; verdict: TaskAutomationVerdictV1 } {
  if ((head.chain?.autoCount ?? 0) + 1 > limit && reverifyExemption(head) !== 'host_interruption') {
    return { row: 'AV-7a', verdict: stopped('auto_rework_cap_reached', { operation: 'reverify' }) };
  }
  if (roundOrdinalOf(head) >= ROUND_CHAIN_MAX) {
    return { row: 'AV-7b', verdict: stopped('not_reworkable', { cause: 'round_chain_limit' }) };
  }
  if (refusal !== null && !refusal.stale
    && (refusal.record.code === 'no_new_basis' || refusal.record.code === 'verification_uncovered')) {
    return { row: 'AV-7c', verdict: stopped(refusal.record.code, { operation: 'reverify' }) };
  }
  return { row: 'AV-7d', verdict: { kind: 'reverify', roundRef: { ...head.ref }, needsFinalize, onlyIfSourceChanged: false,
    failureClass: 'check_incomplete', retryAfterRefusal: refusal !== null && refusal.stale } };
}

/** GV-0..GV-10 (TD-9, C5): a gate is reworked only by successor rounds on its own chain. */
function gateVerdict(view: GateView, limit: number): { row: GateVerdictRow; verdict: TaskAutomationVerdictV1 } {
  const { input, head } = view;
  if (input.goalDesiredState !== 'active') return { row: 'GV-0', verdict: NONE };
  if (input.disposition !== 'active' || input.satisfied || input.chain.kind === 'none') return { row: 'GV-1', verdict: NONE };
  if (head === null) return { row: 'GV-2', verdict: stopped('not_reworkable', { cause: 'round_ambiguous' }) };
  const refusal = view.reverifyRefusal;
  const retryAfterRefusal = refusal !== null && refusal.stale;
  if (head.status === 'open') {
    return onlyInterruptedLeft(head)
      ? { row: 'GV-3', verdict: { kind: 'reverify', roundRef: { ...head.ref }, needsFinalize: true, onlyIfSourceChanged: false,
        failureClass: 'check_incomplete', retryAfterRefusal } }
      : { row: 'GV-3′', verdict: NONE };
  }
  if (!isFinalizedNonPass(head)) return { row: 'GV-4', verdict: NONE };
  if (input.fixInProgress) return { row: 'GV-5', verdict: NONE };
  if ((head.chain?.autoCount ?? 0) + 1 > limit && reverifyExemption(head) !== 'host_interruption') {
    return { row: 'GV-6', verdict: stopped('auto_rework_cap_reached', { operation: 'reverify' }) };
  }
  if (roundOrdinalOf(head) >= ROUND_CHAIN_MAX) {
    return { row: 'GV-7', verdict: stopped('not_reworkable', { cause: 'round_chain_limit' }) };
  }
  if (refusal !== null && !refusal.stale) {
    const code = refusal.record.code;
    if (code === 'no_new_basis' || code === 'verification_uncovered') {
      return { row: 'GV-8', verdict: stopped(code, { operation: 'reverify' }) };
    }
    if (code === 'source_unchanged' && head.outcome === 'FAIL') {
      return { row: 'GV-8', verdict: stopped('gate_needs_fix',
        { operation: 'reverify', failingChecks: roundFailureFacts(head).checks }) };
    }
  }
  if (head.outcome === 'FAIL') {
    return { row: 'GV-9', verdict: { kind: 'reverify', roundRef: { ...head.ref }, needsFinalize: false, onlyIfSourceChanged: true,
      failureClass: 'check_failed', retryAfterRefusal } };
  }
  return { row: 'GV-10', verdict: { kind: 'reverify', roundRef: { ...head.ref }, needsFinalize: false, onlyIfSourceChanged: false,
    failureClass: 'check_incomplete', retryAfterRefusal } };
}

// ------------------------------------------------------------------------ //
// Read model (TaskRow.failure, TaskRow.rework)                              //
// ------------------------------------------------------------------------ //
export type TaskFailureFactsResultV1 = {
  /** `TaskRow.failure`; null when it does not appear (§4.1 "何时出现"). */
  failure: TaskFailureFactsV1 | null;
  /** `TaskRow.rework`; null without any TaskRequeue or refusal record. */
  rework: TaskReworkSummaryV1 | null;
};

/**
 * The C1 read model, the same pure function for `queryTaskGraph`,
 * `readGoalDisplayFacts` and the continuation brief. `failure` appears for a
 * work Task whose selected Run ended (or P15) and for a gate with a chain,
 * unless the Task is satisfied; `rework` appears with at least one TaskRequeue
 * or refusal record.
 *
 * `verdict` is `automation.verdict` as the owner judged it (lead decision
 * LD-1): `automationVerdict` over the same input since step 5.8, with the
 * successor-round rows AV-7a..AV-7d read as `{kind:'none'}` until 5.9 (a gate's
 * facts and GV are 5.9 too).
 */
export function buildTaskFailureFacts(
  input: TaskFailureInputV1, policy: TaskAutomationPolicyV1, verdict: TaskAutomationVerdictV1,
): TaskFailureFactsResultV1 {
  switch (input.subjectKind) {
    case 'work': {
      const view = workView(input);
      return { failure: workFailureFacts(view, policy, verdict), rework: reworkSummary(view, policy) };
    }
    case 'gate': {
      const view = gateView(input);
      // A gate never requeues; its rework history is the chain's `reverify` facts.
      return { failure: gateFailureFacts(view, policy, verdict),
        rework: view.reverifyRefusal === null ? null : { entries: [], requeueAutoCount: 0, cap: policy.autoReworkLimit } };
    }
    default:
      return unreachable(input, 'failure subject kind');
  }
}

function workFailureFacts(view: WorkView, policy: TaskAutomationPolicyV1, verdict: TaskAutomationVerdictV1): TaskFailureFactsV1 | null {
  const { input, run, derivation } = view;
  if (input.satisfied) return null;
  if (run === null || derivation === null) {
    if (!input.originUnresolvable) return null;
    return {
      subjectKind: 'work', runRef: null, runRevision: null, attemptRef: null, sessionRef: null,
      failureClass: null, notReworkableCause: 'origin_unresolvable',
      run: null, interruption: null, stop: null, round: null,
      source: sourceFacts(null, [view.requeueRefusal, view.reverifyRefusal]),
      requeueActors: [], reverifyActors: [],
      automation: automationFacts(view.priorAutoCount, null, view.requeueRefusal, view.reverifyRefusal,
        verdict, policy),
    };
  }
  if (run.status !== 'ended') return null;
  const head = view.head;
  const failureClass = derivation.kind === 'class' ? derivation.failureClass : null;
  return {
    subjectKind: 'work',
    ...runIdentity(run),
    failureClass,
    notReworkableCause: derivation.kind === 'not_reworkable' ? derivation.cause : chainLimitCause(failureClass, head),
    run: runFacts(run, input.kernelRunFailedError),
    interruption: interruptionFacts(run, input.pointerIntent),
    stop: stopFacts(input.pointerIntent),
    round: head === null ? null : roundFacts(head),
    source: sourceFacts(head, [view.requeueRefusal, view.reverifyRefusal]),
    requeueActors: workRequeueActors(view),
    reverifyActors: workReverifyActors(view),
    automation: automationFacts(view.priorAutoCount, view.covering?.ref ?? null, view.requeueRefusal, view.reverifyRefusal,
      verdict, policy),
  };
}

function gateFailureFacts(view: GateView, policy: TaskAutomationPolicyV1, verdict: TaskAutomationVerdictV1): TaskFailureFactsV1 | null {
  const { input, head } = view;
  if (input.satisfied || input.chain.kind === 'none') return null;
  const anchor = input.anchorRun;
  const failureClass = gateFailureClass(head);
  return {
    subjectKind: 'gate',
    ...(anchor === null
      ? { runRef: head === null ? null : { ...head.subjectRunRef }, runRevision: null, attemptRef: null, sessionRef: null }
      : runIdentity(anchor)),
    failureClass,
    notReworkableCause: head === null ? 'round_ambiguous' : chainLimitCause(failureClass, head),
    run: anchor === null ? null : runFacts(anchor, input.kernelRunFailedError),
    interruption: null,
    stop: null,
    round: head === null ? null : roundFacts(head),
    source: sourceFacts(head, [view.reverifyRefusal]),
    requeueActors: [],
    reverifyActors: gateReverifyActors(view),
    automation: automationFacts(0, null, null, view.reverifyRefusal, verdict, policy),
  };
}

/** A gate head's class: `reverifyFailureClass`, and `check_incomplete` for an open head with only interrupted checks (GV-3). */
function gateFailureClass(head: RoundSnapshot | null): ReworkFailureClass | null {
  if (head === null) return null;
  if (head.status === 'open') return onlyInterruptedLeft(head) ? 'check_incomplete' : null;
  return reverifyFailureClass(head);
}

/** `round_chain_limit` is the one cause that coexists with a class: the chain cannot grow (AV-7b, GV-7). */
function chainLimitCause(failureClass: ReworkFailureClass | null, head: RoundSnapshot | null): NotReworkableCause | null {
  if (head === null || (failureClass !== 'check_failed' && failureClass !== 'check_incomplete')) return null;
  return roundOrdinalOf(head) >= ROUND_CHAIN_MAX ? 'round_chain_limit' : null;
}

function runIdentity(run: RunSnapshot): Pick<TaskFailureFactsV1, 'runRef' | 'runRevision' | 'attemptRef' | 'sessionRef'> {
  const attemptRef: TaskAttemptRef = { aggregateType: 'TaskAttempt', projectId: run.task.projectId, goalId: run.task.goalId,
    taskId: run.task.taskId, attemptId: run.attemptId };
  const sessionRef = run.executionHistory?.sessionRef;
  return { runRef: { ...run.ref }, runRevision: run.revision, attemptRef,
    sessionRef: sessionRef === undefined ? null : { ...sessionRef } };
}

/** Null for an ended Run without an outcome (FC-2 already says "reconcile first"). */
function runFacts(run: RunSnapshot, kernelRunFailedError: string | null): TaskFailureFactsV1['run'] {
  if (run.outcome === null) return null;
  return { outcome: run.outcome, endedAt: run.endedAt, budget: { ...run.budget }, origin: runFailureOrigin(run),
    ...runErrorOf(run, kernelRunFailedError) };
}

/** FC-6 / FC-7: a clean Host-restart interruption that ended `crashed`. */
function interruptionFacts(run: RunSnapshot, pointerIntent: StopIntentV1 | null): TaskFailureFactsV1['interruption'] {
  const observation = run.reconciliation?.observation;
  if (run.outcome !== 'crashed' || observation === undefined || observation.kind !== 'interrupted_clean') return null;
  const paused = observation.pausedIntentRef !== null;
  return { kind: paused ? 'paused' : 'executing', kernelPaused: observation.kernelPaused,
    pausedIntentRef: observation.pausedIntentRef === null ? null : { ...observation.pausedIntentRef },
    pausedBy: paused ? stopRequesterOf(pointerIntent) : null };
}

function stopFacts(pointerIntent: StopIntentV1 | null): TaskFailureFactsV1['stop'] {
  if (pointerIntent === null) return null;
  const kind = pointerIntent.kind;
  if (kind !== 'pause' && kind !== 'cancel') return null;
  return { intentRef: { ...pointerIntent.ref }, kind, requestedBy: { ...pointerIntent.requestedBy },
    requester: stopRequesterOf(pointerIntent) };
}

function roundFacts(head: RoundSnapshot): NonNullable<TaskFailureFactsV1['round']> {
  const facts = roundFailureFacts(head);
  return { roundRef: { ...head.ref }, revision: head.revision, status: head.status, outcome: head.outcome, failingChecks: facts.checks,
    gapCodes: facts.gapCodes, sourceDigest: head.identity.sourceDigest, workspaceRevision: head.identity.workspaceRevision,
    ordinal: roundOrdinalOf(head), autoCount: head.chain?.autoCount ?? 0 };
}

/**
 * `atFailure` is the head's identity stamp (null for a Run-level failure);
 * `lastChecked` the source of the latest refusal that captured one; the
 * verdict compares persisted stamps only and says `unknown` otherwise (GAP-49).
 */
function sourceFacts(head: RoundSnapshot | null, refusals: readonly (RefusalView | null)[]): TaskFailureFactsV1['source'] {
  const atFailure: SourceStampV1 | null = head === null ? null
    : { workspaceRevision: head.identity.workspaceRevision, sourceDigest: head.identity.sourceDigest };
  let latest: TaskReworkRefusalSnapshotV1 | null = null;
  for (const view of refusals) {
    const record = view?.record;
    if (record === undefined || record.source === null) continue;
    if (latest === null || record.refusedAt > latest.refusedAt) latest = record;
  }
  const lastChecked = latest === null || latest.source === null ? null : { ...latest.source };
  return { atFailure, lastChecked, sinceFailure: compareSourceCheckpoints(atFailure, lastChecked).verdict };
}

function automationFacts(
  requeueAutoCount: number, coveringRequeue: TaskRequeueRef | null, requeueRefusal: RefusalView | null,
  reverifyRefusal: RefusalView | null, verdict: TaskAutomationVerdictV1, policy: TaskAutomationPolicyV1,
): TaskFailureFactsV1['automation'] {
  const factOf = (view: RefusalView | null): TaskReworkRefusalFactV1 | null =>
    view === null ? null : refusalFact(view.record, view.stale);
  return { cap: policy.autoReworkLimit, requeueAutoCount, coveringRequeue: coveringRequeue === null ? null : { ...coveringRequeue },
    lastRefusal: factOf(requeueRefusal), lastReverifyRefusal: factOf(reverifyRefusal), verdict };
}

/**
 * The classes that may requeue now: the state preconditions of §4.3 step 3
 * that the read model sees (a class-bearing FC row other than FC-13, an active
 * unsatisfied Task, no covering TaskRequeue), intersected with
 * `reworkPermission` (Goal `active`, matrix, fence). The Lease, Session and
 * basis checks stay with the owner.
 */
function workRequeueActors(view: WorkView): ReworkActorClass[] {
  const { input, derivation } = view;
  if (derivation === null || derivation.kind !== 'class' || derivation.row === 'FC-13') return [];
  if (input.satisfied || input.disposition !== 'active' || view.covering !== null) return [];
  return permittedActors({ operation: 'requeue', goalDesiredState: input.goalDesiredState,
    failureClass: derivation.failureClass, interruption: derivation.interruption, fence: view.fence });
}

/**
 * The classes that may reverify now (§9 VR-14 step 3): the subject Run ended
 * `completed`, reconciled (`done` or none) and unblocked; a valid chain whose
 * head is finalized non-PASS below `ROUND_CHAIN_MAX`; an active unsatisfied
 * Task; no TaskRequeue on the Run; then `reworkPermission`.
 */
function workReverifyActors(view: WorkView): ReworkActorClass[] {
  const { input, run, head } = view;
  if (run === null || !reverifiableSubjectRun(run) || head === null) return [];
  if (input.satisfied || input.disposition !== 'active' || view.covering !== null) return [];
  return reverifyActors(head, input.goalDesiredState, view.fence);
}

function gateReverifyActors(view: GateView): ReworkActorClass[] {
  const { input, head } = view;
  if (input.anchorRun === null || !reverifiableSubjectRun(input.anchorRun) || head === null) return [];
  if (input.satisfied || input.disposition !== 'active') return [];
  return reverifyActors(head, input.goalDesiredState, 'none');
}

function reverifiableSubjectRun(run: RunSnapshot): boolean {
  return run.status === 'ended' && run.outcome === 'completed' && runUnresolvedBlocker(run) === null
    && (run.reconciliation === undefined || run.reconciliation.status === 'done');
}

function reverifyActors(head: RoundSnapshot, goalDesiredState: GoalDesiredState, fence: ReworkFence): ReworkActorClass[] {
  const failureClass = reverifyFailureClass(head);
  if (failureClass === null || roundOrdinalOf(head) + 1 > ROUND_CHAIN_MAX) return [];
  return permittedActors({ operation: 'reverify', goalDesiredState, failureClass, interruption: null, fence });
}

/** Every actor class `reworkPermission` admits for a plain request (no budget, note or trigger; `system` = Workflow). */
function permittedActors(
  subject: Pick<ReworkPermissionInputV1, 'operation' | 'goalDesiredState' | 'failureClass' | 'interruption' | 'fence'>,
): ReworkActorClass[] {
  return REWORK_ACTOR_CLASSES.filter((actorClass) => reworkPermission({ ...subject, actorClass, goalFanOut: false,
    trigger: false, budget: false, note: false }) === null);
}

/**
 * `TaskRow.rework`: every TaskRequeue in Run-chain order (walking back from
 * the selected Run through `requeueRef` and `consumedWait`, oldest first);
 * records off that chain follow by `requestedAt`. The stored `failureClass`
 * is the audit copy; successor rounds are read from `chain.reverify`.
 */
function reworkSummary(view: WorkView, policy: TaskAutomationPolicyV1): TaskReworkSummaryV1 | null {
  const { input } = view;
  if (input.requeues.length === 0 && view.requeueRefusal === null && view.reverifyRefusal === null) return null;
  const order = new Map(chainRunIds(view.run, input.runs).map((runId, index) => [runId, index]));
  const entries = [...input.requeues]
    .sort((left, right) => {
      const byChain = (order.get(left.ref.afterRunId) ?? Number.MAX_SAFE_INTEGER)
        - (order.get(right.ref.afterRunId) ?? Number.MAX_SAFE_INTEGER);
      if (byChain !== 0) return byChain;
      if (left.requestedAt !== right.requestedAt) return left.requestedAt < right.requestedAt ? -1 : 1;
      return left.ref.afterRunId < right.ref.afterRunId ? -1 : left.ref.afterRunId > right.ref.afterRunId ? 1 : 0;
    })
    .map((requeue): TaskReworkSummaryEntryV1 => ({ ref: { ...requeue.ref }, afterRunRef: { ...requeue.afterRunRef },
      failureClass: requeue.failureClass, requestedBy: { ...requeue.requestedBy }, automatic: requeue.automation.automatic,
      autoCount: requeue.automation.autoCount, reason: requeue.reason, requestedAt: requeue.requestedAt }));
  return { entries, requeueAutoCount: view.priorAutoCount, cap: policy.autoReworkLimit };
}

/** The Run chain ending at `from`, oldest first; `requeueRef.afterRunId` and `consumedWait.runRef` link it. */
function chainRunIds(from: RunSnapshot | null, runs: readonly ChainRun[]): string[] {
  const byRunId = new Map(runs.map((run) => [run.ref.runId, run]));
  const ids: string[] = [];
  let current: ChainRun | undefined = from ?? undefined;
  while (current !== undefined && !ids.includes(current.ref.runId)) {
    ids.push(current.ref.runId);
    const previousId = current.requeueRef?.afterRunId ?? current.consumedWait?.runRef.runId;
    current = previousId === undefined ? undefined : byRunId.get(previousId);
  }
  return ids.reverse();
}

// ------------------------------------------------------------------------ //
// TaskReworkRefusal@k (§14.1, TASK-28, VR-14)                               //
// ------------------------------------------------------------------------ //
export type NewTaskReworkRefusalInputV1 = {
  /** The record under `ref` as read in the window: null for ∅→@1, @k for @k→@k+1. */
  current: TaskReworkRefusalSnapshotV1 | null;
  ref: TaskReworkRefusalRef;
  task: TaskTriple;
  /** requeue: the selected Run; reverify: the subject (gate: anchored producer) Run. */
  afterRunRef: RunRef;
  /** requeue: its chain head (may be null); reverify: the predecessor round. */
  subjectRoundRef: VerificationRoundRef | null;
  /** TD-8 for requeue; `reverifyFailureClass` for reverify. */
  failureClass: ReworkFailureClass;
  code: TaskReworkRefusalCode;
  /** Platform-generated; cut to `TASK_REWORK_REASON_MAX_CHARS`. */
  reason: string;
  basisDigest: string | null;
  source: SourceStampV1 | null;
  matchedRequeueRef: TaskRequeueRef | null;
  requestedBy: ActorRef;
  refusedAt: string;
  /** `countEndedGoalRuns` read before any source capture (ND-7). */
  goalEndedRunsAtRefusal: number;
  /** Only for a configuration-dependent reverify refusal (LA-4). */
  configurationRevision: string | null;
};

/**
 * The only constructor of `TaskReworkRefusalSnapshotV1` (§14.1): every
 * revision is written whole (I-18), in contract key order. It accepts only a
 * legal combination and throws otherwise (the owner's guards come first):
 * the same key as `current` and a watermark that never decreases; the
 * operation's subject (`subjectId` = afterRun id / predecessor round id);
 * the five codes on their operations; never class `interrupted`; a reverify
 * class is a round class; `matchedRequeueRef` exactly on a requeue
 * `no_new_basis`; `configurationRevision` exactly on a reverify
 * `no_new_basis` / `verification_uncovered`; cap and budget refusals capture
 * no source and no key; a key refusal carries both; a cap refusal only for an
 * automatic actor class.
 */
export function newTaskReworkRefusalRecord(input: NewTaskReworkRefusalInputV1): TaskReworkRefusalSnapshotV1 {
  const problem = reworkRefusalProblem(input);
  if (problem !== null) throw new Error(`newTaskReworkRefusalRecord: ${problem}`);
  const reason = input.reason.length > TASK_REWORK_REASON_MAX_CHARS ? input.reason.slice(0, TASK_REWORK_REASON_MAX_CHARS) : input.reason;
  return {
    ref: { ...input.ref },
    revision: input.current === null ? 1 : input.current.revision + 1,
    schemaVersion: 1,
    task: { projectId: input.task.projectId, goalId: input.task.goalId, taskId: input.task.taskId },
    afterRunRef: { ...input.afterRunRef },
    subjectRoundRef: input.subjectRoundRef === null ? null : { ...input.subjectRoundRef },
    failureClass: input.failureClass,
    code: input.code,
    reason,
    basisDigest: input.basisDigest,
    source: input.source === null ? null : { workspaceRevision: input.source.workspaceRevision, sourceDigest: input.source.sourceDigest },
    matchedRequeueRef: input.matchedRequeueRef === null ? null : { ...input.matchedRequeueRef },
    requestedBy: { ...input.requestedBy },
    refusedAt: input.refusedAt,
    goalEndedRunsAtRefusal: input.goalEndedRunsAtRefusal,
    configurationRevision: input.configurationRevision,
  };
}

function reworkRefusalProblem(input: NewTaskReworkRefusalInputV1): string | null {
  const { ref, task, code, current } = input;
  const operation = ref.operation;
  if (ref.aggregateType !== 'TaskReworkRefusal' || ref.projectId !== task.projectId || ref.goalId !== task.goalId
    || ref.taskId !== task.taskId) {
    return 'the refusal key must name the refused Task';
  }
  if (current !== null) {
    if (!sameRefusalRef(current.ref, ref)) return 'the current record belongs to another refusal key';
    if (input.goalEndedRunsAtRefusal < current.goalEndedRunsAtRefusal) return 'goalEndedRunsAtRefusal never decreases under one key';
  }
  if (input.afterRunRef.projectId !== task.projectId || input.afterRunRef.goalId !== task.goalId) {
    return 'the refused Run belongs to another Goal';
  }
  switch (operation) {
    case 'requeue':
      if (ref.subjectId !== input.afterRunRef.runId) return 'a requeue refusal is keyed by its afterRun id';
      if (code === 'source_unchanged' || code === 'verification_uncovered') return `${code} is a reverify-only refusal`;
      break;
    case 'reverify':
      if (input.subjectRoundRef === null || input.subjectRoundRef.roundId !== ref.subjectId) {
        return 'a reverify refusal is keyed by its predecessor round id';
      }
      if (code === 'budget_not_increased') return 'budget_not_increased is a requeue-only refusal';
      if (input.failureClass !== 'check_failed' && input.failureClass !== 'check_incomplete') {
        return `a reverify refusal has a round class, not ${input.failureClass}`;
      }
      break;
    default:
      return unreachable(operation, 'rework operation');
  }
  if (input.failureClass === 'interrupted') return 'class interrupted skips budget, cap and key and is never refused';
  const matched = operation === 'requeue' && code === 'no_new_basis';
  if ((input.matchedRequeueRef !== null) !== matched) return 'matchedRequeueRef is set exactly on a requeue no_new_basis refusal';
  if (input.matchedRequeueRef !== null && (input.matchedRequeueRef.projectId !== task.projectId
    || input.matchedRequeueRef.goalId !== task.goalId || input.matchedRequeueRef.taskId !== task.taskId)) {
    return 'matchedRequeueRef belongs to another Task';
  }
  const configurationDependent = operation === 'reverify' && (code === 'no_new_basis' || code === 'verification_uncovered');
  if ((input.configurationRevision !== null) !== configurationDependent) {
    return 'configurationRevision is set exactly on a reverify no_new_basis or verification_uncovered refusal';
  }
  if (input.configurationRevision !== null && input.configurationRevision.length === 0) return 'configurationRevision must be non-empty';
  switch (code) {
    case 'auto_rework_cap_reached':
    case 'budget_not_increased':
      if (input.basisDigest !== null || input.source !== null) return `a ${code} refusal captures no source and no key`;
      break;
    case 'no_new_basis':
      if (input.basisDigest === null || input.source === null) return 'a no_new_basis refusal carries its key digest and source';
      break;
    case 'source_unchanged':
    case 'verification_uncovered':
      if (input.source === null) return `a ${code} refusal carries the captured source`;
      break;
    default:
      return unreachable(code, 'rework refusal code');
  }
  if (code === 'auto_rework_cap_reached' && reworkActorClassOf(null, input.requestedBy) === 'human') {
    return 'the cap only refuses an automatic actor';
  }
  if (input.reason.length === 0) return 'the refusal reason must be non-empty';
  if (input.refusedAt.length === 0) return 'refusedAt is required';
  if (!Number.isSafeInteger(input.goalEndedRunsAtRefusal) || input.goalEndedRunsAtRefusal < 0) {
    return 'goalEndedRunsAtRefusal must be a non-negative safe integer';
  }
  return null;
}

/**
 * Same-commit intents of a policy refusal (TASK-28 for requeue, VR-14 for
 * reverify) the owner translates; the one vocabulary for this record, so the
 * requeue and the reverify owner translate the same shape:
 * - `write_task_rework_refusal`: the next revision under CAS (`null` for ∅→@1,
 *   else the read revision k for @k→@k+1);
 * - `append_event`: the durable `TaskReworkRefused` event carrying that revision.
 * Nothing else is written: no TaskRequeue, round, slot or Run.
 */
export type TaskReworkRefusalEffect =
  | { kind: 'write_task_rework_refusal'; refusal: TaskReworkRefusalSnapshotV1; expectedRevision: number | null }
  | { kind: 'append_event'; eventType: 'TaskReworkRefused' };

export function taskReworkRefusalEffects(input: NewTaskReworkRefusalInputV1): TaskReworkRefusalEffect[] {
  return [
    { kind: 'write_task_rework_refusal', refusal: newTaskReworkRefusalRecord(input),
      expectedRevision: input.current === null ? null : input.current.revision },
    { kind: 'append_event', eventType: 'TaskReworkRefused' },
  ];
}

// ------------------------------------------------------------------------ //
// Helpers                                                                   //
// ------------------------------------------------------------------------ //
function sameActor(left: ActorRef, right: { kind: string; id: string }): boolean {
  return left.kind === right.kind && left.id === right.id;
}
function sameRequeueRef(left: TaskRequeueRef, right: TaskRequeueRef): boolean {
  return left.aggregateType === right.aggregateType && left.projectId === right.projectId && left.goalId === right.goalId
    && left.taskId === right.taskId && left.afterRunId === right.afterRunId;
}
function sameRefusalRef(left: TaskReworkRefusalRef, right: TaskReworkRefusalRef): boolean {
  return left.aggregateType === right.aggregateType && left.projectId === right.projectId && left.goalId === right.goalId
    && left.taskId === right.taskId && left.operation === right.operation && left.subjectId === right.subjectId;
}
