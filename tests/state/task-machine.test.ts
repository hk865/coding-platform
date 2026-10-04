/**
 * A.2 step 2 (spec §15.2 第 2 步): the Task machine of spec §4
 * (`state/task-machine.ts`).
 *
 * - `projectTaskPhase` / `classifyTaskPhase`: one case per row P1..P16 with
 *   TODAY's phase and the TD-1 cause; the 新增 rows P4, P17..P20 are not
 *   evaluated yet and their facts reach today's row; in-round monotonicity,
 *   legacy PASS with gaps, successor heads and the disposition independence.
 * - `transitionTask`: every (state, event) combination over the projection
 *   states (plus ∅): a legal one asserts `next` and `effects`, a re-projection
 *   without change asserts the same state and `effects:[]` (SD-1), an illegal
 *   one asserts `reason` and `code` (§4.4). 新增 rows answer `illegal`/`invalid`;
 *   改造 rows keep today's result (step 5 flips them).
 * - Guard order of the claim, completion, disposition and adoption rows, and
 *   the record constructors `newTaskReductionRecord` (today's bytes) and
 *   `newTaskRequeueRecord` (the §11 I-12 clauses its input shows: a valid
 *   chain with a finalized, not clean-PASS head for every outcome, actor ×
 *   class matrix with the human-stop fence, trigger, budget, cap, and no
 *   history source without Kernel entry or `requeueRef`).
 *
 * Pure: no RecordStore, no Kernel, no model.
 */
import { describe, expect, it } from 'vitest';
import type { ActorRef } from '../../src/contracts/command-event.js';
import type { ControlIntentRef } from '../../src/contracts/control-intent.js';
import type { CoreError, CoreRejection } from '../../src/contracts/core/results.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { DelegatedWriteProvenanceV1 } from '../../src/contracts/delegated-write.js';
import type {
  ConsumedWaitV1, RoleBindingRefV1, RunContinuationV1, RunOutcome, RunReconciliationV1, RunRef, RunSnapshot, TaskTriple,
} from '../../src/contracts/dispatch.js';
import type { EvidenceOutcome, EvidenceRef } from '../../src/contracts/evidence.js';
import type { NewBasisInputRefV1, NoProgressKeyV1 } from '../../src/contracts/no-progress.js';
import type { PlanRevisionRef, TaskKind } from '../../src/contracts/plan.js';
import type { TaskReductionSnapshot } from '../../src/contracts/reduction.js';
import {
  GOAL_FAN_OUT_ACTOR, WORKFLOW_AUTOMATION_ACTOR, type TaskRequeueHistorySourceV1, type TaskRequeueRef,
  type TaskReworkRefusalSnapshotV1,
} from '../../src/contracts/task-requeue.js';
import type {
  RoundChainV1, RoundCheckSnapshot, RoundSnapshot, VerificationRoundRef,
} from '../../src/contracts/verification.js';
import {
  classifyTaskPhase, newTaskReductionRecord, newTaskRequeueRecord, projectTaskPhase, taskClaimProblem,
  taskCompletionRoundProblem, taskMachineStateOf, transitionTask,
  type NewTaskRequeueInput, type TaskClaimFacts, type TaskCompletionFacts, type TaskEffect, type TaskEvent,
  type TaskGuardContext, type TaskMachineState, type TaskPhaseFacts, type TaskPhaseProjection, type TaskReductionBuildV1,
  type TaskRoundEventKind, type TaskState, type TaskTrace,
} from '../../src/core/work-graph/state/task-machine.js';
import type { Transition, TransitionRejectReason } from '../../src/core/work-graph/state/transition.js';
import {
  roundChainHead, roundTaskSignal, rootRoundChain, type RoundTaskSignalV1,
} from '../../src/core/work-graph/state/verification-machine.js';

// ------------------------------------------------------------------------ //
// Fixtures                                                                  //
// ------------------------------------------------------------------------ //

const P = 'tm-project', G = 'tm-goal', T = 'tm-task', GATE = 'tm-gate', W = 'tm-workspace';
const GEN = 6;
const T_START = '2026-10-04T01:00:00.000Z';
const T_END = '2026-10-04T01:05:00.000Z';
const T_LATER = '2026-10-04T02:00:00.000Z';
const sha = (char: string): string => char.repeat(64);

const task: TaskTriple = { projectId: P, goalId: G, taskId: T };
const gateTask: TaskTriple = { projectId: P, goalId: G, taskId: GATE };
const planRef: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: P, planId: 'plan-1' };
const runRef = (runId: string): RunRef => ({ aggregateType: 'Run', projectId: P, goalId: G, runId });
const sessionRef = { projectId: P, sessionId: 'ses-1' };
const intentRef = (intentId: string): ControlIntentRef => ({ aggregateType: 'ControlIntent', projectId: P, workspaceId: W, intentId });
const evidence = (evidenceId: string): EvidenceRef => ({ aggregateType: 'Evidence', projectId: P, evidenceId });
const roleBinding: RoleBindingRefV1 = { schemaVersion: 1, bindingId: 'binding-1', templateId: 'worker', templateRevision: 'r1',
  bindingVersion: 1, policyRevision: 'policy-1' };
const messageRef = { aggregateType: 'SessionMessage' as const, projectId: P, workspaceId: W, messageId: 'msg-1' };
const continuation: RunContinuationV1 = { schemaVersion: 1, kind: 'wait_reply', task, sessionRef, messageRef };
const operator: ActorRef = { kind: 'human', id: 'operator-1' };

/** An ended `completed` Run by default; `patch` moves it to the row's facts. */
function run(runId: string, patch: Partial<RunSnapshot> = {}): RunSnapshot {
  return { ref: runRef(runId), revision: 4, schemaVersion: 1, task, attemptId: `att-${runId}`, planRef, roleBinding,
    budget: { tokenBudget: 1000, deadline: null }, workspaceSnapshot: { workspaceId: W, revision: 2 },
    status: 'ended', outcome: 'completed', exitCode: 0, lastEventSeq: 5, lastRuntimeEventId: 'rt-5',
    lastFactEventId: 'fact-5', envelope: null, startedAt: T_START, endedAt: T_END, ...patch };
}
const pointer = (desiredState: 'paused' | 'cancelled' | 'running' | 'steered', id = 'i-1'): Pick<RunSnapshot, 'controlState'> =>
  ({ controlState: { intentRef: intentRef(id), desiredState } });
const interruptedClean = (pausedIntentRef: ControlIntentRef | null): RunReconciliationV1 => ({
  status: 'done',
  observation: { kind: 'interrupted_clean',
    event: { eventType: 'run_crashed', schemaVersion: 1, eventId: 'synth-1', runRef: runRef('run-1'), sequence: 6,
      occurredAt: T_LATER, payload: { kind: 'crashed', error: 'host_interrupted' } },
    lastPosition: 4, kernelPaused: pausedIntentRef !== null, pausedIntentRef },
  basis: { kind: 'host_instance_takeover', hostInstanceId: 'host-2' }, recordedAt: T_LATER });

const RUNNING = run('run-1', { status: 'running', outcome: null, exitCode: null, endedAt: null });
const STARTING = run('run-1', { status: 'starting', outcome: null, exitCode: null, startedAt: null, endedAt: null });
const COMPLETED = run('run-1');
const ENDED_UNKNOWN = run('run-1', { outcome: 'outcome_unknown', exitCode: null });
const YIELDED_WAIT = run('run-1', { outcome: 'yielded', exitCode: null, continuation });
const YIELDED_PAUSED = run('run-1', { outcome: 'yielded', exitCode: null, continuation, ...pointer('paused') });
const YIELDED_CANCELLED = run('run-1', { outcome: 'yielded', exitCode: null, continuation, ...pointer('cancelled') });
const YIELDED_BARE = run('run-1', { outcome: 'yielded', exitCode: null });
const CRASHED = run('run-1', { outcome: 'crashed', exitCode: null });
const CRASHED_INTERRUPTED = run('run-1', { outcome: 'crashed', exitCode: null, reconciliation: interruptedClean(null) });
const PAUSED_INTERRUPTED = run('run-1', { outcome: 'crashed', exitCode: null, ...pointer('paused', 'i-pause'),
  reconciliation: interruptedClean(intentRef('i-pause')) });
const CANCELLED = run('run-1', { outcome: 'cancelled', exitCode: null });
const ENDED_NO_OUTCOME = run('run-1', { outcome: null, exitCode: null });

const roundRef = (roundId: string, runId = 'run-1', taskId = T): VerificationRoundRef =>
  ({ aggregateType: 'VerificationRound', projectId: P, workspaceId: W, goalId: G, taskId, runId, roundId });
const roundCheck = (checkId: string, phase: RoundCheckSnapshot['phase'], outcome: EvidenceOutcome | null = null): RoundCheckSnapshot =>
  ({ checkId, phase, invocationId: null, outcome, reportRef: null, sourceStatus: null } as unknown as RoundCheckSnapshot);
/** Only the members the chain head, the signal and the completion read are real. */
function round(roundId: string, patch: Partial<RoundSnapshot> = {}): RoundSnapshot {
  return { ref: roundRef(roundId), revision: 3, schemaVersion: 1, subject: { ...task }, subjectRunRef: runRef('run-1'),
    adoptedPlanRef: planRef, taskBasisRef: planRef, configurationDigest: sha('c'),
    identity: { workspaceRevision: 3 }, verificationPlan: { planId: 'vplan-1', planDigest: sha('d') },
    checks: [roundCheck('lint', 'pending'), roundCheck('unit', 'pending')], status: 'open', outcome: null, gaps: [],
    evidenceRefs: [], ...patch } as unknown as RoundSnapshot;
}
const pendingGap = { code: 'pending_check', message: 'the required check unit never ran' };
const OPEN_PENDING = round('round-1');
const OPEN_MIXED = round('round-1', { checks: [roundCheck('lint', 'interrupted'), roundCheck('unit', 'pending')] });
const OPEN_INTERRUPTED = round('round-1', { checks: [roundCheck('lint', 'finished', 'PASS'), roundCheck('unit', 'interrupted')] });
const FINAL_FAIL = round('round-1', { status: 'finalized', outcome: 'FAIL',
  checks: [roundCheck('lint', 'finished', 'PASS'), roundCheck('unit', 'finished', 'FAIL')], evidenceRefs: [evidence('e-1'), evidence('e-3')] });
const FINAL_INCONCLUSIVE = round('round-1', { status: 'finalized', outcome: 'INCONCLUSIVE', gaps: [pendingGap] });
const FINAL_PASS = round('round-1', { status: 'finalized', outcome: 'PASS',
  checks: [roundCheck('lint', 'finished', 'PASS'), roundCheck('unit', 'finished', 'PASS')], evidenceRefs: [evidence('e-1'), evidence('e-2')] });
const FINAL_PASS_GAPS = round('round-1', { status: 'finalized', outcome: 'PASS', gaps: [pendingGap],
  checks: [roundCheck('lint', 'finished', 'PASS'), roundCheck('unit', 'pending')], evidenceRefs: [evidence('e-5')] });
/** Two legacy roots on one subject: the chain is invalid (P10). */
const TWO_ROOTS = [OPEN_PENDING, round('round-2', { status: 'finalized', outcome: 'FAIL' })];

const ROOT_FAIL = round('round-1', { status: 'finalized', outcome: 'FAIL', chain: rootRoundChain(),
  checks: [roundCheck('unit', 'finished', 'FAIL')], evidenceRefs: [evidence('e-1')] });
const successorChain = (ordinal: number, predecessor: RoundSnapshot): RoundChainV1 => ({ schemaVersion: 1, ordinal,
  predecessorRoundRef: predecessor.ref, predecessorRevision: predecessor.revision, supersededEvidenceIds: ['e-1'],
  basisDigests: [sha('b')], autoCount: 1, reverify: null });
const SUCC_OPEN = round('round-2', { chain: successorChain(2, ROOT_FAIL) });
const SUCC_FAIL = round('round-2', { chain: successorChain(2, ROOT_FAIL), status: 'finalized', outcome: 'FAIL',
  checks: [roundCheck('lint', 'finished', 'FAIL'), roundCheck('unit', 'finished', 'PASS')], evidenceRefs: [evidence('e-4')] });

const SIG = {
  none: { kind: 'none' } as RoundTaskSignalV1,
  invalid: roundTaskSignal(TWO_ROOTS),
  open: roundTaskSignal([OPEN_PENDING]),
  mixed: roundTaskSignal([OPEN_MIXED]),
  interrupted: roundTaskSignal([OPEN_INTERRUPTED]),
  fail: roundTaskSignal([FINAL_FAIL]),
  inconclusive: roundTaskSignal([FINAL_INCONCLUSIVE]),
  pass: roundTaskSignal([FINAL_PASS]),
  passGaps: roundTaskSignal([FINAL_PASS_GAPS]),
  succOpen: roundTaskSignal([ROOT_FAIL, SUCC_OPEN]),
  succFail: roundTaskSignal([ROOT_FAIL, SUCC_FAIL]),
};

const requeueRef: TaskRequeueRef = { aggregateType: 'TaskRequeue', projectId: P, goalId: G, taskId: T, afterRunId: 'run-1' };
const facts = (patch: Partial<TaskPhaseFacts> = {}): TaskPhaseFacts => ({ taskKind: 'work', applicableReduction: null,
  selectedRun: null, originUnresolvable: false, round: SIG.none, coveringRequeue: null, ...patch });
const gateFacts = (patch: Partial<TaskPhaseFacts> = {}): TaskPhaseFacts => facts({ taskKind: 'gate', ...patch });

// ------------------------------------------------------------------------ //
// Projection rows (§4.1): facts and today's projection, written as literals  //
// ------------------------------------------------------------------------ //

type RowLabel = 'P1' | 'P1v' | 'P1f' | 'P2' | 'P3' | 'P5' | 'P6' | 'P7' | 'P8' | 'P9' | 'P10' | 'P11' | 'P12' | 'P13'
  | 'P14' | 'P15' | 'P16';

const ROW: Record<RowLabel, { facts: TaskPhaseFacts; projection: TaskPhaseProjection }> = {
  P1: { facts: facts({ applicableReduction: { phase: 'satisfied' }, selectedRun: COMPLETED, round: SIG.pass }),
    projection: { row: 'P1', phase: 'satisfied', cause: null } },
  P1v: { facts: facts({ applicableReduction: { phase: 'verifying' }, selectedRun: COMPLETED, round: SIG.pass }),
    projection: { row: 'P1', phase: 'verifying', cause: null } },
  P1f: { facts: facts({ applicableReduction: { phase: 'failed' }, selectedRun: COMPLETED, round: SIG.fail }),
    projection: { row: 'P1', phase: 'failed', cause: null } },
  P2: { facts: facts({ selectedRun: RUNNING }), projection: { row: 'P2', phase: 'running', cause: null } },
  P3: { facts: facts({ selectedRun: ENDED_UNKNOWN }),
    projection: { row: 'P3', phase: 'blocked', cause: { code: 'run_outcome_unknown' } } },
  P5: { facts: facts({ selectedRun: YIELDED_WAIT }), projection: { row: 'P5', phase: 'ready', cause: null } },
  P6: { facts: facts({ selectedRun: CRASHED }),
    projection: { row: 'P6', phase: 'blocked', cause: { code: 'run_failed', detail: { outcome: 'crashed', origin: 'observed' } } } },
  P7: { facts: facts({ selectedRun: COMPLETED, round: SIG.fail }),
    projection: { row: 'P7', phase: 'blocked', cause: { code: 'check_failed', detail: { checkIds: ['unit'] } } } },
  P8: { facts: facts({ selectedRun: COMPLETED, round: SIG.inconclusive }),
    projection: { row: 'P8', phase: 'blocked', cause: { code: 'round_inconclusive', detail: { gapCodes: ['pending_check'] } } } },
  P9: { facts: facts({ selectedRun: COMPLETED, round: SIG.interrupted }),
    projection: { row: 'P9', phase: 'blocked', cause: { code: 'check_interrupted' } } },
  P10: { facts: facts({ selectedRun: COMPLETED, round: SIG.invalid }),
    projection: { row: 'P10', phase: 'blocked', cause: { code: 'round_ambiguous' } } },
  P11: { facts: facts({ selectedRun: COMPLETED }),
    projection: { row: 'P11', phase: 'blocked', cause: { code: 'awaiting_verification' } } },
  P12: { facts: facts({ selectedRun: COMPLETED, round: SIG.open }),
    projection: { row: 'P12', phase: 'blocked', cause: { code: 'verification_running' } } },
  P13: { facts: facts({ selectedRun: COMPLETED, round: SIG.pass }),
    projection: { row: 'P13', phase: 'blocked', cause: { code: 'awaiting_completion' } } },
  P14: { facts: facts({ selectedRun: YIELDED_BARE }), projection: { row: 'P14', phase: 'blocked', cause: { code: 'run_failed' } } },
  P15: { facts: facts({ originUnresolvable: true }),
    projection: { row: 'P15', phase: 'blocked', cause: { code: 'origin_unresolvable' } } },
  P16: { facts: facts(), projection: { row: 'P16', phase: 'pending', cause: null } },
};
const ROW_LABELS = Object.keys(ROW) as RowLabel[];

/** §4.1 "目标值" of the rows whose today's phase differs; step 5.3 flips each (and its assertion). */
const STEP5_TARGET_PHASE: Partial<Record<RowLabel, string>> = {
  P6: 'failed', P7: 'failed', P11: 'verifying', P12: 'verifying', P13: 'verifying',
};

describe('projectTaskPhase: one case per row, today\'s phase (§4.1, §15.2 step 2)', () => {
  it.each(ROW_LABELS)('%s', (label) => {
    const { facts: rowFacts, projection } = ROW[label];
    expect(classifyTaskPhase(rowFacts)).toEqual(projection);
    expect(projectTaskPhase(rowFacts)).toEqual({ phase: projection.phase, cause: projection.cause });
    const target = STEP5_TARGET_PHASE[label];
    if (target !== undefined) expect(projection.phase).not.toBe(target);
  });

  it('P2 holds for a starting Run, and P1 wins over an active Run', () => {
    expect(classifyTaskPhase(facts({ selectedRun: STARTING }))).toEqual({ row: 'P2', phase: 'running', cause: null });
    expect(classifyTaskPhase(facts({ applicableReduction: { phase: 'satisfied' }, selectedRun: RUNNING })))
      .toEqual({ row: 'P1', phase: 'satisfied', cause: null });
  });

  it('P6 covers every failed outcome with its origin; a RUN-19 interruption is host_interrupted', () => {
    for (const outcome of ['crashed', 'cancelled', 'budget_exhausted', 'failed'] as RunOutcome[]) {
      expect(classifyTaskPhase(facts({ selectedRun: run('run-1', { outcome }) })))
        .toEqual({ row: 'P6', phase: 'blocked', cause: { code: 'run_failed', detail: { outcome, origin: 'observed' } } });
    }
    expect(classifyTaskPhase(facts({ selectedRun: CRASHED_INTERRUPTED }))).toEqual({ row: 'P6', phase: 'blocked',
      cause: { code: 'run_failed', detail: { outcome: 'crashed', origin: 'host_interrupted' } } });
  });

  it('an ended Run without an outcome is defended like P14 (today blocked)', () => {
    expect(classifyTaskPhase(facts({ selectedRun: ENDED_NO_OUTCOME })))
      .toEqual({ row: 'P14', phase: 'blocked', cause: { code: 'run_failed' } });
  });

  it('新增 rows are not evaluated yet: P4, P17, P18, P19 and P20 facts reach today\'s row', () => {
    // P4: a TaskRequeue covers the selected Run (step 5.4) → still the FAIL head row.
    expect(classifyTaskPhase(facts({ selectedRun: COMPLETED, round: SIG.fail, coveringRequeue: requeueRef })))
      .toEqual(ROW.P7.projection);
    expect(classifyTaskPhase(facts({ selectedRun: CRASHED, coveringRequeue: requeueRef }))).toEqual(ROW.P6.projection);
    // P17/P18: a stop pointer on a yielded wait (TD-5, step 5.3) → today `ready`.
    expect(classifyTaskPhase(facts({ selectedRun: YIELDED_CANCELLED }))).toEqual(ROW.P5.projection);
    expect(classifyTaskPhase(facts({ selectedRun: YIELDED_PAUSED }))).toEqual(ROW.P5.projection);
    // P19: paused-interrupted (C4, step 5.6) → today's P6.
    expect(classifyTaskPhase(facts({ selectedRun: PAUSED_INTERRUPTED }))).toEqual({ row: 'P6', phase: 'blocked',
      cause: { code: 'run_failed', detail: { outcome: 'crashed', origin: 'host_interrupted' } } });
    // P20: a gate's own chain (C5, step 5.9) → today P16, or P15 with an unresolvable reduction.
    for (const signal of [SIG.open, SIG.fail, SIG.inconclusive, SIG.pass, SIG.invalid]) {
      expect(classifyTaskPhase(gateFacts({ round: signal }))).toEqual(ROW.P16.projection);
    }
    expect(classifyTaskPhase(gateFacts({ round: SIG.fail, originUnresolvable: true }))).toEqual(ROW.P15.projection);
    expect(classifyTaskPhase(gateFacts({ applicableReduction: { phase: 'satisfied' }, round: SIG.pass })))
      .toEqual(ROW.P1.projection);
  });

  it('within one round: interrupted with a check still pending stays P12, then P9 (brief §2a)', () => {
    expect(classifyTaskPhase(facts({ selectedRun: COMPLETED, round: SIG.mixed }))).toEqual({ row: 'P12', phase: 'blocked',
      cause: { code: 'verification_running', detail: { checkIds: ['lint'] } } });
    expect(classifyTaskPhase(facts({ selectedRun: COMPLETED, round: SIG.interrupted }))).toEqual(ROW.P9.projection);
  });

  it('a legacy PASS with gaps is P8 round_inconclusive, never awaiting completion (VD-4)', () => {
    expect(classifyTaskPhase(facts({ selectedRun: COMPLETED, round: SIG.passGaps }))).toEqual({ row: 'P8', phase: 'blocked',
      cause: { code: 'round_inconclusive', detail: { gapCodes: ['pending_check'] } } });
  });

  it('a successor head adds ordinal and predecessor to the detail (C5)', () => {
    expect(classifyTaskPhase(facts({ selectedRun: COMPLETED, round: SIG.succOpen }))).toEqual({ row: 'P12', phase: 'blocked',
      cause: { code: 'verification_running', detail: { ordinal: 2, predecessorRoundRef: ROOT_FAIL.ref } } });
    expect(classifyTaskPhase(facts({ selectedRun: COMPLETED, round: SIG.succFail }))).toEqual({ row: 'P7', phase: 'blocked',
      cause: { code: 'check_failed', detail: { ordinal: 2, predecessorRoundRef: ROOT_FAIL.ref, checkIds: ['lint'] } } });
    // An ordinal-1 root with a chain carries no successor detail.
    expect(classifyTaskPhase(facts({ selectedRun: COMPLETED, round: roundTaskSignal([ROOT_FAIL]) })))
      .toEqual({ row: 'P7', phase: 'blocked', cause: { code: 'check_failed', detail: { checkIds: ['unit'] } } });
  });

  it('the disposition never enters the projection (C7)', () => {
    for (const disposition of ['active', 'deferred', 'cancelled', 'superseded'] as const) {
      expect(taskMachineStateOf({ taskKind: 'work', disposition }, ROW.P7.facts))
        .toEqual({ taskKind: 'work', disposition, ...ROW.P7.projection });
    }
    expect(taskMachineStateOf(null, ROW.P16.facts)).toBeNull();
  });
});

// ------------------------------------------------------------------------ //
// Machine states                                                             //
// ------------------------------------------------------------------------ //

type StateLabel = 'absent' | RowLabel | 'gate:P1' | 'gate:P16';
const stateOf = (taskKind: TaskKind, projection: TaskPhaseProjection): TaskState =>
  ({ taskKind, disposition: 'active', ...projection });
const STATES: Record<StateLabel, TaskMachineState> = {
  absent: null,
  ...Object.fromEntries(ROW_LABELS.map((label) => [label, stateOf('work', ROW[label].projection)])) as Record<RowLabel, TaskState>,
  'gate:P1': stateOf('gate', ROW.P1.projection),
  'gate:P16': stateOf('gate', ROW.P16.projection),
};
const STATE_LABELS = Object.keys(STATES) as StateLabel[];
const isGate = (label: StateLabel): boolean => label.startsWith('gate:');

// ------------------------------------------------------------------------ //
// Guard contexts                                                             //
// ------------------------------------------------------------------------ //

const CLAIM: TaskClaim = { task, planRef, workspaceId: W, sessionRef, sessionRevision: GEN, generation: GEN,
  runRef: runRef('run-2'), attemptRef: { aggregateType: 'TaskAttempt', projectId: P, goalId: G, taskId: T, attemptId: 'att-run-2' },
  outboxRef: { aggregateType: 'DispatchOutboxEntry', projectId: P, goalId: G, taskId: T, attemptId: 'att-run-2' },
  claimedAt: T_LATER };
const consumedWait: ConsumedWaitV1 = { runRef: runRef('run-1'), messageRef,
  responseRef: { kind: 'artifact', contentType: 'text/plain', digest: sha('a'), sizeBytes: 3,
    source: { kind: 'workspace', refId: W, revision: '1' } } };
const CONSUMABLE_PRIOR: NonNullable<TaskClaimFacts['prior']> = { node: 'YieldedWait', pointer: 'none', bindingProblem: null,
  leaseReleasedByPrior: true, replyProblem: null };
const claimFacts = (patch: Partial<TaskClaimFacts> = {}): TaskClaimFacts => ({ goalDesiredState: 'active',
  activePlanMatchesClaim: true, sessionProblem: null, structuralProblem: null, lease: { status: 'free' }, taskHasRun: true,
  prior: null, admission: null, ...patch });

const PRODUCER = run('run-1');
const SATISFIED = { satisfied: true, phase: 'satisfied' as const, causes: [], satisfiedObligationIds: ['ob-1'] };
const completionFacts = (patch: Partial<TaskCompletionFacts> = {}): TaskCompletionFacts =>
  ({ producerRun: PRODUCER, producerTaskKind: 'work', evaluation: SATISFIED, ...patch });

/** The facts a real read would give for each state; the trace is the first one today's reader finds. */
function ctxFor(label: StateLabel): TaskGuardContext {
  const trace: TaskTrace = label === 'P16' || label === 'gate:P16' || label === 'absent' ? 'none'
    : label === 'gate:P1' ? 'reduction' : 'run';
  return {
    taskId: isGate(label) ? GATE : T,
    claim: claimFacts({
      lease: label === 'P2' ? { status: 'leased', holderRunId: 'run-1' } : { status: 'free' },
      taskHasRun: !(label === 'P16' || label === 'absent' || isGate(label)),
      prior: label === 'P5' ? CONSUMABLE_PRIOR : null,
    }),
    completion: completionFacts(),
    trace,
  };
}

// ------------------------------------------------------------------------ //
// Events                                                                     //
// ------------------------------------------------------------------------ //

const workDef = { taskKind: 'work' as const, disposition: 'active' as const };
const REDUCTION_BUILD = (taskRef: TaskTriple): TaskReductionBuildV1 => ({
  ref: { aggregateType: 'TaskReduction', projectId: P, goalId: G, taskId: taskRef.taskId }, previousRevision: null,
  plan: { ref: planRef, planRevision: 2,
    effectiveCompletionPolicy: { ref: { aggregateType: 'CompletionPolicyRevision', projectId: P, policyId: 'policy-1', revision: 1 },
      digest: sha('e') },
    effectiveArchitectureBaseline: { ref: { aggregateType: 'ArchitectureBaselineRevision', projectId: P,
      baselineId: 'baseline-1', revision: 1 }, digest: sha('f') } },
  definition: { taskKind: taskRef.taskId === GATE ? 'gate' : 'work', requirementLevel: 'required', disposition: 'active' },
  effectiveEvidenceIds: ['e-1', 'e-2'], blockingEvidenceIds: [], staleEvidenceIds: [], outOfScopeEvidenceIds: [],
  evidenceRefs: [evidence('e-1'), evidence('e-2')], reducedAt: T_LATER });
const GATE_PASS = round('gate-round-1', { ref: roundRef('gate-round-1', 'run-1', GATE), subject: { ...gateTask },
  status: 'finalized', outcome: 'PASS', checks: [roundCheck('accept', 'finished', 'PASS')], evidenceRefs: [evidence('e-9')] });

/** Today's `completion.ts:408-436` literal, key for key. */
const expectedReduction = (taskRef: TaskTriple, passRound: RoundSnapshot): TaskReductionSnapshot => {
  const build = REDUCTION_BUILD(taskRef);
  return { ref: build.ref, revision: 1, schemaVersion: 1, planRef, planRevision: 2, taskKind: build.definition.taskKind,
    requirementLevel: 'required', disposition: 'active', phase: 'satisfied',
    currentAnchor: { schemaVersion: 1, planRef, planRevision: 2, workspaceRevision: 3,
      pinnedCompletionPolicy: build.plan.effectiveCompletionPolicy, pinnedArchitectureBaseline: build.plan.effectiveArchitectureBaseline },
    effectiveEvidenceIds: ['e-1', 'e-2'], blockingEvidenceIds: [], staleEvidenceIds: [], outOfScopeEvidenceIds: [],
    satisfiedObligationIds: ['ob-1'], causes: [], reducedAt: T_LATER,
    completion: { schemaVersion: 1, roundRef: passRound.ref, roundRevision: 3, taskBasisRef: planRef,
      verificationPlanRef: { planId: 'vplan-1', planDigest: sha('d') }, configurationDigest: sha('c'),
      evidenceRefs: [evidence('e-1'), evidence('e-2')] } };
};

type EventFor = (kind: TaskKind) => TaskEvent;
/** Gate Tasks have no Run: every re-projection reaches them with gate facts (no selected Run). */
const post = (kind: TaskKind, workFacts: TaskPhaseFacts): TaskPhaseFacts => kind === 'gate' ? gateFacts() : workFacts;
const roundEvent = (eventKind: TaskRoundEventKind, workFacts: TaskPhaseFacts): EventFor => (kind) =>
  ({ kind: eventKind, roundRef: roundRef('round-1'), subjectRunRef: runRef('run-1'), facts: post(kind, workFacts) });
const finalized = (outcome: EvidenceOutcome, workFacts: TaskPhaseFacts, gapCodes: string[] = [], runId = 'run-1'): EventFor =>
  (kind) => ({ kind: 'round_finalized', roundRef: roundRef('round-1', runId), subjectRunRef: runRef(runId), outcome, gapCodes,
    facts: post(kind, workFacts) });

const FACTS_POINTER_RUNNING = facts({ selectedRun: run('run-1', { status: 'running', outcome: null, exitCode: null,
  endedAt: null, ...pointer('paused') }) });

const EVENTS = {
  'plan:initial': (kind) => ({ kind: 'plan_adopted', adoption: 'initial', definition: { ...workDef, phase: 'pending' },
    facts: post(kind, ROW.P16.facts) }),
  'plan:initial:progress': (kind) => ({ kind: 'plan_adopted', adoption: 'initial', definition: { ...workDef, phase: 'running' },
    facts: post(kind, ROW.P16.facts) }),
  'plan:future': (kind) => ({ kind: 'plan_adopted', adoption: 'future', definition: { ...workDef, phase: 'pending' },
    facts: post(kind, ROW.P16.facts) }),
  'plan:future:blocked': (kind) => ({ kind: 'plan_adopted', adoption: 'future', definition: { ...workDef, phase: 'blocked' },
    facts: post(kind, ROW.P16.facts) }),
  'claim:first': () => ({ kind: 'task_claimed', claim: CLAIM, basis: { kind: 'first' }, budget: { tokenBudget: 1000, deadline: null } }),
  'claim:continuation': () => ({ kind: 'task_claimed', claim: CLAIM, basis: { kind: 'continuation', consumedWait },
    budget: { tokenBudget: 1000, deadline: null } }),
  'claim:requeue': () => ({ kind: 'task_claimed', claim: CLAIM, basis: { kind: 'requeue', requeueRef },
    budget: { tokenBudget: 1000, deadline: null } }),
  'run_ended:completed': (kind) => ({ kind: 'run_ended', runRef: runRef('run-1'), facts: post(kind, ROW.P11.facts) }),
  'run_ended:crashed': (kind) => ({ kind: 'run_ended', runRef: runRef('run-1'), facts: post(kind, ROW.P6.facts) }),
  'run_ended:yielded': (kind) => ({ kind: 'run_ended', runRef: runRef('run-1'), facts: post(kind, ROW.P5.facts) }),
  'run_ended:yielded:pointer': (kind) => ({ kind: 'run_ended', runRef: runRef('run-1'),
    facts: post(kind, facts({ selectedRun: YIELDED_PAUSED })) }),
  'run_ended:unknown': (kind) => ({ kind: 'run_ended', runRef: runRef('run-1'), facts: post(kind, ROW.P3.facts) }),
  'run_ended:paused_interrupted': (kind) => ({ kind: 'run_ended', runRef: runRef('run-1'),
    facts: post(kind, facts({ selectedRun: PAUSED_INTERRUPTED })) }),
  'run_ended:older_run': (kind) => ({ kind: 'run_ended', runRef: runRef('run-0'), facts: post(kind, ROW.P11.facts) }),
  'control:pause:running': (kind) => ({ kind: 'control_submitted', runRef: runRef('run-1'), control: 'pause',
    facts: post(kind, FACTS_POINTER_RUNNING) }),
  'control:pause:yielded': (kind) => ({ kind: 'control_submitted', runRef: runRef('run-1'), control: 'pause',
    facts: post(kind, facts({ selectedRun: YIELDED_PAUSED })) }),
  'control:cancel:yielded': (kind) => ({ kind: 'control_submitted', runRef: runRef('run-1'), control: 'cancel',
    facts: post(kind, facts({ selectedRun: YIELDED_CANCELLED })) }),
  'control:resume:yielded': (kind) => ({ kind: 'control_submitted', runRef: runRef('run-1'), control: 'resume',
    facts: post(kind, ROW.P5.facts) }),
  'control:steer:yielded': (kind) => ({ kind: 'control_submitted', runRef: runRef('run-1'), control: 'steer',
    facts: post(kind, ROW.P5.facts) }),
  'round_opened': roundEvent('round_opened', ROW.P12.facts),
  'check_begun': roundEvent('check_begun', ROW.P12.facts),
  'check_result_recorded': roundEvent('check_result_recorded', ROW.P12.facts),
  'check_interrupted': roundEvent('check_interrupted', ROW.P9.facts),
  'check_abandoned': roundEvent('check_abandoned', ROW.P12.facts),
  'check_report_booked': roundEvent('check_report_booked', ROW.P12.facts),
  'evidence_submitted': roundEvent('evidence_submitted', ROW.P12.facts),
  'round_finalized:FAIL': finalized('FAIL', ROW.P7.facts),
  'round_finalized:INCONCLUSIVE': finalized('INCONCLUSIVE', ROW.P8.facts, ['pending_check']),
  'round_finalized:PASS': finalized('PASS', ROW.P13.facts),
  'round_finalized:older_run': finalized('FAIL', ROW.P7.facts, [], 'run-0'),
  'round_reverified': (kind) => ({ kind: 'round_reverified', roundRef: roundRef('round-2'), predecessorRoundRef: roundRef('round-1'),
    subjectRunRef: runRef('run-1'), facts: post(kind, ROW.P12.facts) }),
  'task_completed': (kind) => kind === 'gate'
    ? { kind: 'task_completed', task: gateTask, round: GATE_PASS, reduction: REDUCTION_BUILD(gateTask) }
    : { kind: 'task_completed', task, round: FINAL_PASS, reduction: REDUCTION_BUILD(task) },
  'task_requeued': () => ({ kind: 'task_requeued', requeue: requeueInput() }),
  'task_rework_refused': () => ({ kind: 'task_rework_refused', refusal: {} as TaskReworkRefusalSnapshotV1 }),
  'disposition:deferred': () => ({ kind: 'disposition_changed', to: 'deferred', replacedByTaskId: null, actorClass: 'human' }),
} satisfies Record<string, EventFor>;
type EventLabel = keyof typeof EVENTS;
const EVENT_LABELS = Object.keys(EVENTS) as EventLabel[];

// ------------------------------------------------------------------------ //
// Expectations                                                               //
// ------------------------------------------------------------------------ //

type Expect =
  | { ok: true; same: true }
  | { ok: true; same: false; next: TaskMachineState; effects: readonly TaskEffect[] }
  | { ok: false; reason: TransitionRejectReason; code: CoreError };

const SAME: Expect = { ok: true, same: true };
const to = (next: TaskMachineState, effects: readonly TaskEffect[] = []): Expect => ({ ok: true, same: false, next, effects });
const no = (reason: TransitionRejectReason, code: CoreError): Expect => ({ ok: false, reason, code });
const II = no('illegal', 'invalid');
const GB = no('guard_failed', 'busy');
const NOT_FOUND = no('illegal', 'not_found');

function check(actual: Transition<unknown, unknown, unknown>, expected: Expect, state: TaskMachineState): void {
  if (!expected.ok) {
    expect(actual).toMatchObject({ ok: false, reason: expected.reason, code: expected.code });
    if (!actual.ok) expect(actual.detail.length).toBeGreaterThan(0);
    return;
  }
  if (expected.same) {
    expect(actual).toEqual({ ok: true, next: state, effects: [] });
    if (actual.ok) expect(actual.next).toBe(state);
    return;
  }
  expect(actual).toEqual({ ok: true, next: expected.next, effects: expected.effects });
  if (actual.ok) expect(JSON.stringify(actual.effects)).toBe(JSON.stringify(expected.effects));
}

/** A re-projection to `row`: the same state when nothing changed (SD-1). */
function reproject(label: StateLabel, row: RowLabel): Expect {
  const state = STATES[label] as TaskState;
  const projection = isGate(label) ? ROW.P16.projection : ROW[row].projection;
  const next = stateOf(state.taskKind, projection);
  return JSON.stringify({ ...state }) === JSON.stringify(next) ? SAME : to(next);
}

const CLAIM_EFFECTS = (lease: 'first' | 'reheld'): TaskEffect[] => [
  { kind: 'create_attempt' }, { kind: 'create_run' }, { kind: 'create_outbox' }, { kind: 'hold_lease', lease },
  { kind: 'occupy_session', sessionRef, generation: GEN },
];
const BLOCKED_ROWS: StateLabel[] = ['P3', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11', 'P12', 'P13', 'P14', 'P15'];

function claimExpect(label: StateLabel, basis: 'first' | 'continuation' | 'requeue'): Expect {
  if (label === 'absent') return NOT_FOUND;
  if (isGate(label)) return II;
  if (label === 'P1') return no('illegal', 'busy');
  if (label === 'P1v' || label === 'P1f' || label === 'P2' || BLOCKED_ROWS.includes(label)) return GB;
  // P5 has a Run: only the continuation reholds its lease. TASK-03 (改造): today
  // a requeue claim is a first claim, so the Run refuses it.
  if (label === 'P5') return basis === 'continuation' ? to(stateOf('work', ROW.P2.projection), CLAIM_EFFECTS('reheld')) : GB;
  // P16: no Run; a continuation has no prior Run of this Task, a requeue claim
  // takes today's first-claim @1 lease.
  return basis === 'continuation' ? GB : to(stateOf('work', ROW.P2.projection), CLAIM_EFFECTS('first'));
}

/** Re-projection events: ∅ → not_found; the rest per row id. */
function reprojectionExpect(label: StateLabel, event: EventLabel): Expect {
  if (label === 'absent') return NOT_FOUND;
  const gate = isGate(label);
  switch (event) {
    case 'run_ended:completed': return gate ? SAME : label === 'P3' ? II : reproject(label, 'P11');
    case 'run_ended:crashed': return gate ? SAME : label === 'P3' ? II : reproject(label, 'P6');
    case 'run_ended:yielded': return gate ? SAME : label === 'P3' ? II : reproject(label, 'P5');
    // TASK-21, TASK-07, TASK-26 (新增).
    case 'run_ended:yielded:pointer':
    case 'run_ended:unknown':
    case 'run_ended:paused_interrupted':
      return gate ? SAME : II;
    case 'run_ended:older_run': return SAME;
    case 'control:pause:running': return gate ? SAME : reproject(label, 'P2');
    // TASK-22/23 (新增).
    case 'control:pause:yielded':
    case 'control:cancel:yielded':
    case 'control:resume:yielded':
      return gate ? SAME : II;
    case 'control:steer:yielded': return gate ? SAME : reproject(label, 'P5');
    case 'round_opened':
    case 'check_begun':
    case 'check_result_recorded':
    case 'check_abandoned':
    case 'check_report_booked':
      return gate ? II : reproject(label, 'P12');
    case 'evidence_submitted': return reproject(label, 'P12');
    // TASK-12 (新增) unless the head is already P9.
    case 'check_interrupted': return gate ? II : label === 'P9' ? SAME : II;
    case 'round_finalized:FAIL': return gate ? II : reproject(label, 'P7');
    case 'round_finalized:INCONCLUSIVE': return gate ? II : reproject(label, 'P8');
    // §4.4: blocked(check_interrupted) + PASS is illegal.
    case 'round_finalized:PASS': return gate ? II : label === 'P9' ? II : reproject(label, 'P13');
    case 'round_finalized:older_run': return gate ? II : SAME;
    // TASK-29 / TASK-30 (新增).
    case 'round_reverified': return II;
    default: throw new Error(`not a re-projection event: ${event}`);
  }
}

function planExpect(label: StateLabel, event: EventLabel): Expect {
  if (label !== 'absent') return reproject(label, 'P16');
  const pending = stateOf('work', ROW.P16.projection);
  switch (event) {
    case 'plan:initial': return to(pending);
    case 'plan:initial:progress': return no('illegal', 'incomplete');
    case 'plan:future': return to(pending);
    case 'plan:future:blocked': return no('guard_failed', 'invalid');
    default: throw new Error(`not a plan event: ${event}`);
  }
}

function completedExpect(label: StateLabel): Expect {
  if (label === 'absent') return no('illegal', 'incomplete');
  // TASK-14/15/24 today: the round and the fold decide, whatever the projection.
  const gate = isGate(label);
  return to(stateOf(gate ? 'gate' : 'work', ROW.P1.projection), [{ kind: 'write_task_reduction',
    reduction: gate ? expectedReduction(gateTask, GATE_PASS) : expectedReduction(task, FINAL_PASS) }]);
}

function dispositionExpect(label: StateLabel): Expect {
  if (label === 'absent') return II;
  if (isGate(label)) return no('guard_failed', 'invalid');
  if (label === 'P16') {
    return to({ ...(STATES.P16 as TaskState), disposition: 'deferred' }, [{ kind: 'write_plan_revision' }, { kind: 'move_goal_pointer' }]);
  }
  // TASK-19 (新增) is answered by today's §4.4 refusal: a traced definition is frozen.
  return no('guard_failed', 'revision_conflict');
}

function expectFor(label: StateLabel, event: EventLabel): Expect {
  switch (event) {
    case 'plan:initial':
    case 'plan:initial:progress':
    case 'plan:future':
    case 'plan:future:blocked':
      return planExpect(label, event);
    case 'claim:first': return claimExpect(label, 'first');
    case 'claim:continuation': return claimExpect(label, 'continuation');
    case 'claim:requeue': return claimExpect(label, 'requeue');
    case 'task_completed': return completedExpect(label);
    // TASK-16/17/27/28 (新增): illegal from every state.
    case 'task_requeued':
    case 'task_rework_refused':
      return II;
    case 'disposition:deferred': return dispositionExpect(label);
    default: return reprojectionExpect(label, event);
  }
}

describe('transitionTask: every (state, event) combination', () => {
  for (const label of STATE_LABELS) {
    describe(label, () => {
      it.each(EVENT_LABELS)('%s', (eventLabel) => {
        const state = STATES[label];
        const event = EVENTS[eventLabel](isGate(label) ? 'gate' : 'work');
        check(transitionTask(state, event, ctxFor(label)), expectFor(label, eventLabel), state);
      });
    });
  }

  it('the completion record is today\'s literal byte for byte', () => {
    const result = transitionTask(STATES.P13, EVENTS.task_completed('work'), ctxFor('P13'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const effect = result.effects[0];
    expect(effect?.kind).toBe('write_task_reduction');
    if (effect?.kind === 'write_task_reduction') {
      expect(JSON.stringify(effect.reduction)).toBe(JSON.stringify(expectedReduction(task, FINAL_PASS)));
    }
  });
});

// ------------------------------------------------------------------------ //
// task_claimed guards (TASK-01..03, §4.4)                                    //
// ------------------------------------------------------------------------ //

const rejection = (code: CoreError, reason: string): CoreRejection => ({ status: 'rejected', code, reason });
const claimWith = (state: TaskMachineState, patch: Partial<TaskClaimFacts>, basis: EventLabel = 'claim:first') =>
  transitionTask(state, EVENTS[basis]('work'), { ...ctxFor('P16'), claim: claimFacts({ taskHasRun: false, ...patch }) });

describe('task_claimed guards in claim-service order', () => {
  it('Goal, Plan pin and Session come before the Task itself', () => {
    expect(claimWith(null, { goalDesiredState: 'paused' })).toMatchObject({ ok: false, reason: 'guard_failed', code: 'busy',
      detail: 'the Goal is not active' });
    expect(claimWith(null, { activePlanMatchesClaim: false })).toMatchObject({ ok: false, reason: 'stale',
      code: 'revision_conflict' });
    expect(claimWith(null, { sessionProblem: rejection('busy', 'the target Session is already occupied') }))
      .toMatchObject({ ok: false, reason: 'guard_failed', code: 'busy', detail: 'the target Session is already occupied' });
    expect(claimWith(null, {})).toMatchObject({ ok: false, reason: 'illegal', code: 'not_found' });
    expect(claimWith(STATES.P16, { goalDesiredState: 'cancelled', activePlanMatchesClaim: false,
      sessionProblem: rejection('busy', 'the target Session is archived') })).toMatchObject({ code: 'busy',
      detail: 'the Goal is not active' });
    expect(claimWith(STATES.P16, { activePlanMatchesClaim: false,
      sessionProblem: rejection('busy', 'the target Session is archived') })).toMatchObject({ code: 'revision_conflict' });
  });

  it('kind, disposition and structural eligibility come before the phase', () => {
    const deferred: TaskState = { ...(STATES.P16 as TaskState), disposition: 'deferred' };
    expect(claimWith(deferred, {})).toMatchObject({ ok: false, reason: 'guard_failed', code: 'invalid',
      detail: 'the Task disposition is not active' });
    const blockedDeferred: TaskState = { ...(STATES.P7 as TaskState), disposition: 'superseded' };
    expect(claimWith(blockedDeferred, {})).toMatchObject({ code: 'invalid' });
    const structural = rejection('incomplete', 'task is plan_only and is not a dispatch candidate until an explicit request_execution');
    expect(claimWith(STATES.P7, { structuralProblem: structural })).toMatchObject({ ok: false, reason: 'guard_failed',
      code: 'incomplete', detail: structural.reason });
    expect(claimWith(STATES.P7, {})).toMatchObject({ ok: false, reason: 'guard_failed', code: 'busy', detail: 'task is blocked' });
    expect(claimWith(STATES.P2, {})).toMatchObject({ ok: false, reason: 'guard_failed', code: 'busy',
      detail: 'task phase is not dispatchable (pending|ready)' });
    // Order: disposition before structure, structure before phase, phase before the lease.
    expect(claimWith(blockedDeferred, { structuralProblem: structural })).toMatchObject({ code: 'invalid' });
    expect(claimWith(STATES.P2, { lease: { status: 'leased', holderRunId: 'run-1' } })).toMatchObject({ code: 'busy',
      detail: 'task phase is not dispatchable (pending|ready)' });
  });

  it('a held lease and an existing Run refuse a first claim (`busy`)', () => {
    expect(claimWith(STATES.P16, { lease: { status: 'leased', holderRunId: 'run-9' } })).toMatchObject({ ok: false,
      reason: 'guard_failed', code: 'busy', detail: 'task already has an active lease (holder run run-9)' });
    expect(claimWith(STATES.P16, { taskHasRun: true })).toMatchObject({ ok: false, reason: 'guard_failed', code: 'busy',
      detail: 'this Task already has a Run and cannot be claimed for the first time' });
  });

  it('a continuation claim checks the prior Run in today\'s order', () => {
    const at = (prior: Partial<NonNullable<TaskClaimFacts['prior']>>) =>
      claimWith(STATES.P5, { taskHasRun: true, prior: { ...CONSUMABLE_PRIOR, ...prior } }, 'claim:continuation');
    expect(at({ node: 'Ended' })).toMatchObject({ code: 'busy',
      detail: 'the continuation prior Run did not yield with a formal continuation' });
    expect(at({ bindingProblem: rejection('forbidden', 'the continuation prior Run used another Session'),
      pointer: 'paused' })).toMatchObject({ reason: 'guard_failed', code: 'forbidden' });
    expect(at({ pointer: 'paused', leaseReleasedByPrior: false })).toMatchObject({ code: 'busy',
      detail: 'the prior yielded Run has a queued paused control; the continuation is held' });
    expect(at({ pointer: 'cancelled' })).toMatchObject({ code: 'busy' });
    expect(at({ leaseReleasedByPrior: false })).toMatchObject({ code: 'busy',
      detail: 'the continuation prior Run lease is not released by that Run' });
    expect(at({ replyProblem: rejection('busy', 'the continuation wait has not been answered') }))
      .toMatchObject({ code: 'busy', detail: 'the continuation wait has not been answered' });
    expect(at({})).toMatchObject({ ok: true });
  });

  it('assignment, role and deadline admission come last', () => {
    expect(claimWith(STATES.P16, { admission: rejection('forbidden', 'the Task must carry exactly one assignment') }))
      .toMatchObject({ ok: false, reason: 'guard_failed', code: 'forbidden' });
    expect(claimWith(STATES.P16, { admission: rejection('capacity', 'budget.deadline has passed') }))
      .toMatchObject({ ok: false, reason: 'guard_failed', code: 'capacity' });
    expect(claimWith(STATES.P16, { admission: rejection('revision_conflict', 'role facts moved') }))
      .toMatchObject({ ok: false, reason: 'stale', code: 'revision_conflict' });
  });

  it('a requeue claim follows today\'s first-claim rule until step 5.4 (TASK-03)', () => {
    // `claim-service.ts:639-641` never reads `requeueRef`: only an existing Run refuses it.
    expect(claimWith(STATES.P16, { taskHasRun: true }, 'claim:requeue')).toMatchObject({ ok: false, reason: 'guard_failed',
      code: 'busy', detail: 'this Task already has a Run and cannot be claimed for the first time' });
    expect(claimWith(STATES.P16, { taskHasRun: false }, 'claim:requeue')).toEqual({ ok: true,
      next: stateOf('work', ROW.P2.projection), effects: CLAIM_EFFECTS('first') });
    // The earlier guards still come first.
    expect(claimWith(STATES.P16, { taskHasRun: false, lease: { status: 'leased', holderRunId: 'run-9' } }, 'claim:requeue'))
      .toMatchObject({ ok: false, code: 'busy', detail: 'task already has an active lease (holder run run-9)' });
    expect(claimWith(STATES.P16, { taskHasRun: false, admission: rejection('capacity', 'budget.deadline has passed') },
      'claim:requeue')).toMatchObject({ ok: false, reason: 'guard_failed', code: 'capacity' });
  });

  it('the claim facts are required', () => {
    expect(transitionTask(STATES.P16, EVENTS['claim:first'](), { ...ctxFor('P16'), claim: null }))
      .toMatchObject({ ok: false, reason: 'illegal', code: 'invalid' });
  });

  it('taskClaimProblem is the same guard without the claim ids (the claim service asks it after each read)', () => {
    const variants: Partial<TaskClaimFacts>[] = [{}, { goalDesiredState: 'paused' }, { activePlanMatchesClaim: false },
      { sessionProblem: rejection('busy', 'the target Session is archived') },
      { structuralProblem: rejection('incomplete', 'planning only') }, { lease: { status: 'leased', holderRunId: 'run-9' } },
      { taskHasRun: false }, { prior: CONSUMABLE_PRIOR }, { prior: { ...CONSUMABLE_PRIOR, pointer: 'paused' } },
      { prior: { ...CONSUMABLE_PRIOR, replyProblem: rejection('busy', 'the continuation wait has not been answered') } },
      { taskHasRun: false, admission: rejection('capacity', 'budget.deadline has passed') }];
    for (const label of STATE_LABELS) {
      for (const basis of ['claim:first', 'claim:continuation', 'claim:requeue'] as const) {
        for (const patch of variants) {
          const event = EVENTS[basis]() as Extract<TaskEvent, { kind: 'task_claimed' }>;
          const facts = claimFacts(patch);
          const transition = transitionTask(STATES[label], event, { ...ctxFor(label), claim: facts });
          expect(taskClaimProblem(STATES[label], event.basis, facts), `${label} ${basis} ${JSON.stringify(patch)}`)
            .toEqual(transition.ok ? null : transition);
        }
      }
    }
  });
});

// ------------------------------------------------------------------------ //
// task_completed guards (TASK-14/15/24)                                       //
// ------------------------------------------------------------------------ //

describe('task_completed in completeTask order', () => {
  const at = (event: TaskEvent, patch: Partial<TaskCompletionFacts> = {}, state: TaskMachineState = STATES.P13) =>
    transitionTask(state, event, { ...ctxFor('P13'), completion: completionFacts(patch) });
  const work = (passRound: RoundSnapshot): TaskEvent =>
    ({ kind: 'task_completed', task, round: passRound, reduction: REDUCTION_BUILD(task) });

  it.each([
    ['the round subject', round('r', { ...FINAL_PASS, subject: gateTask }), 'invalid', 'the round subject disagrees with the requested task'],
    ['an open round', OPEN_PENDING, 'incomplete', 'the specified round is not finalized'],
    ['a FAIL round', FINAL_FAIL, 'incomplete', 'the specified round did not finalize as PASS'],
    ['a PASS with gaps', FINAL_PASS_GAPS, 'incomplete', 'the specified round carries unresolved gaps'],
    ['no evidence', round('r', { ...FINAL_PASS, evidenceRefs: [] }), 'incomplete', 'the specified round admitted no Evidence'],
  ] as const)('%s', (_name, passRound, code, detail) => {
    expect(at(work(passRound))).toMatchObject({ ok: false, reason: 'guard_failed', code, detail });
  });

  it.each([
    ['a producer outside the Goal', { ...PRODUCER, ref: { ...PRODUCER.ref, goalId: 'other' } }, 'invalid'],
    ['a running producer', RUNNING, 'incomplete'],
    ['an unknown producer', ENDED_UNKNOWN, 'incomplete'],
    ['a yielded producer', YIELDED_WAIT, 'incomplete'],
    ['a producer of another task', { ...PRODUCER, task: { ...task, taskId: 'other' } }, 'invalid'],
  ] as const)('%s', (_name, producerRun, code) => {
    expect(at(work(FINAL_PASS), { producerRun: producerRun as RunSnapshot })).toMatchObject({ ok: false, reason: 'guard_failed', code });
  });

  it('the round is judged before its producer, and the producer before the fold', () => {
    expect(at(work(FINAL_FAIL), { producerRun: RUNNING })).toMatchObject({ code: 'incomplete',
      detail: 'the specified round did not finalize as PASS' });
    expect(at(work(FINAL_PASS), { producerRun: RUNNING,
      evaluation: { satisfied: false, phase: 'verifying', causes: [], satisfiedObligationIds: [] } }))
      .toMatchObject({ code: 'incomplete', detail: 'the round producer Run has not ended' });
  });

  it('a gate round needs a same-Plan work producer that is not the gate', () => {
    const gate: TaskEvent = { kind: 'task_completed', task: gateTask, round: GATE_PASS, reduction: REDUCTION_BUILD(gateTask) };
    expect(at(gate, { producerRun: { ...PRODUCER, task: gateTask } }, STATES['gate:P16'])).toMatchObject({ code: 'invalid',
      detail: 'a gate round must reference a same-Goal ordinary producer Run, not a gate Run' });
    expect(at(gate, { producerTaskKind: 'gate' }, STATES['gate:P16'])).toMatchObject({ code: 'invalid',
      detail: 'the gate round producer Run must be a same-Plan work task' });
    expect(at(gate, { producerTaskKind: null }, STATES['gate:P16'])).toMatchObject({ code: 'invalid' });
    expect(at(gate, {}, STATES['gate:P16'])).toMatchObject({ ok: true });
  });

  it('an unsatisfied fold is `incomplete` with today\'s text', () => {
    const evaluation = { satisfied: false, phase: 'verifying' as const, satisfiedObligationIds: [],
      causes: [{ code: 'unreconciled_side_effect' as const, message: 'the task still holds a valid lease' }] };
    expect(at(work(FINAL_PASS), { evaluation })).toMatchObject({ ok: false, reason: 'guard_failed', code: 'incomplete',
      detail: `task ${T} is not satisfied (verifying): the task still holds a valid lease` });
    expect(at(work(FINAL_PASS), { evaluation: { ...evaluation, causes: [] } })).toMatchObject({
      detail: `task ${T} is not satisfied (verifying)` });
  });

  it('TASK-24: a satisfied Task completes again at revision+1', () => {
    const event: TaskEvent = { kind: 'task_completed', task, round: FINAL_PASS,
      reduction: { ...REDUCTION_BUILD(task), previousRevision: 2 } };
    const result = at(event, {}, STATES.P1);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.effects).toEqual([{ kind: 'write_task_reduction',
      reduction: { ...expectedReduction(task, FINAL_PASS), revision: 3 } }]);
  });

  it('the round problem is exported for the owner to stop before reading Evidence', () => {
    expect(taskCompletionRoundProblem({ task, taskKind: 'work', round: FINAL_PASS, producerRun: PRODUCER,
      producerTaskKind: 'work' })).toBeNull();
    expect(taskCompletionRoundProblem({ task, taskKind: 'work', round: OPEN_PENDING, producerRun: PRODUCER,
      producerTaskKind: 'work' })).toEqual(rejection('incomplete', 'the specified round is not finalized'));
  });

  it('the completion facts are required, and a record is built only for a satisfied fold', () => {
    expect(transitionTask(STATES.P13, work(FINAL_PASS), { ...ctxFor('P13'), completion: null }))
      .toMatchObject({ ok: false, reason: 'illegal', code: 'invalid' });
    expect(() => newTaskReductionRecord({ ...REDUCTION_BUILD(task), round: FINAL_PASS,
      evaluation: { ...SATISFIED, satisfied: false, phase: 'verifying' } })).toThrow(/satisfied/);
  });
});

// ------------------------------------------------------------------------ //
// disposition_changed, plan_adopted and re-projection specifics               //
// ------------------------------------------------------------------------ //

describe('disposition_changed (TASK-18; TASK-19 is step 5.10)', () => {
  const change = (state: TaskMachineState, trace: TaskTrace | null, to: TaskState['disposition'] = 'deferred') =>
    transitionTask(state, { kind: 'disposition_changed', to, replacedByTaskId: null, actorClass: 'agent' },
      { ...ctxFor('P16'), trace });

  it('reports the first trace in today\'s reader order', () => {
    expect(change(STATES.P6, 'run')).toMatchObject({ code: 'revision_conflict',
      detail: `task ${T} already has a Run and is no longer a future task` });
    expect(change(STATES.P16, 'lease')).toMatchObject({ reason: 'guard_failed', code: 'revision_conflict',
      detail: `task ${T} already holds a TaskLease and is no longer a future task` });
    expect(change(STATES.P1, 'reduction')).toMatchObject({ code: 'revision_conflict',
      detail: `task ${T} already has a formal reduction and is no longer a future task` });
  });

  it('a deferred untraced Task is reactivated; the same disposition is no change', () => {
    const deferred: TaskState = { ...(STATES.P16 as TaskState), disposition: 'deferred' };
    expect(change(deferred, 'none', 'active')).toEqual({ ok: true, next: STATES.P16,
      effects: [{ kind: 'write_plan_revision' }, { kind: 'move_goal_pointer' }] });
    expect(change(deferred, 'none', 'deferred')).toMatchObject({ ok: false, reason: 'illegal', code: 'invalid' });
  });

  it('a gate is refused before its trace, and the trace facts are required', () => {
    expect(change(STATES['gate:P1'], 'reduction', 'cancelled')).toMatchObject({ code: 'invalid',
      detail: `source gate task ${T} changed its definition or acceptance relationships` });
    expect(change(STATES.P16, null)).toMatchObject({ ok: false, reason: 'illegal', code: 'invalid' });
  });
});

describe('plan_adopted (TASK-25)', () => {
  const adopt = (adoption: 'initial' | 'future', phase: TaskState['phase'], taskKind: TaskKind = 'work') =>
    transitionTask(null, { kind: 'plan_adopted', adoption, definition: { taskKind, disposition: 'active', phase },
      facts: ROW.P16.facts }, ctxFor('P16'));

  it('any admissible draft phase projects pending (P16)', () => {
    for (const phase of ['pending', 'ready', 'blocked'] as const) {
      expect(adopt('initial', phase)).toEqual({ ok: true, next: STATES.P16, effects: [] });
    }
    expect(adopt('initial', 'pending', 'gate')).toEqual({ ok: true, next: STATES['gate:P16'], effects: [] });
  });

  it('a future-only new Task must be drafted pending before the progress guard', () => {
    expect(adopt('future', 'satisfied')).toMatchObject({ ok: false, reason: 'guard_failed', code: 'invalid',
      detail: `new task ${T} must start in phase pending, not satisfied` });
    expect(adopt('initial', 'satisfied')).toMatchObject({ ok: false, reason: 'illegal', code: 'incomplete',
      detail: `task ${T} declares phase 'satisfied' before any completion evidence` });
    for (const phase of ['running', 'verifying', 'failed'] as const) {
      expect(adopt('initial', phase)).toMatchObject({ code: 'incomplete',
        detail: `task ${T} declares phase '${phase}' before any run/evidence fact` });
    }
  });
});

describe('re-projection specifics', () => {
  it('facts of another task kind are refused', () => {
    expect(transitionTask(STATES.P11, { kind: 'run_ended', runRef: runRef('run-1'), facts: gateFacts() }, ctxFor('P11')))
      .toMatchObject({ ok: false, reason: 'illegal', code: 'invalid' });
    expect(transitionTask(STATES.P16, EVENTS['plan:initial']('gate'), ctxFor('P16')))
      .toMatchObject({ ok: false, reason: 'illegal', code: 'invalid' });
  });

  it('a Run end whose facts do not show the ended Run is refused', () => {
    expect(transitionTask(STATES.P2, { kind: 'run_ended', runRef: runRef('run-1'), facts: ROW.P2.facts }, ctxFor('P2')))
      .toMatchObject({ ok: false, reason: 'illegal', code: 'invalid' });
  });

  it('TASK-08 is step 5: an unknown end resolved by late evidence or an attestation', () => {
    expect(transitionTask(STATES.P3, EVENTS['run_ended:crashed']('work'), ctxFor('P3')))
      .toMatchObject({ ok: false, reason: 'illegal', code: 'invalid', detail: 'TASK-08 is not implemented before A.2 step 5' });
  });

  it('TASK-21/22/23/26/29/30 name their rows', () => {
    const detail = (label: StateLabel, event: EventLabel): unknown => {
      const result = transitionTask(STATES[label], EVENTS[event](isGate(label) ? 'gate' : 'work'), ctxFor(label));
      return result.ok ? null : result.detail;
    };
    expect(detail('P2', 'run_ended:yielded:pointer')).toMatch(/^TASK-21 /);
    expect(detail('P2', 'run_ended:paused_interrupted')).toMatch(/^TASK-26 /);
    expect(detail('P2', 'run_ended:unknown')).toMatch(/^TASK-07 /);
    expect(detail('P5', 'control:pause:yielded')).toMatch(/^TASK-22 /);
    expect(detail('P5', 'control:resume:yielded')).toMatch(/^TASK-23 /);
    expect(detail('P12', 'check_interrupted')).toMatch(/^TASK-12 /);
    expect(detail('P7', 'round_reverified')).toMatch(/^TASK-29 /);
    expect(detail('gate:P16', 'round_opened')).toMatch(/^TASK-30 /);
    expect(detail('P7', 'task_requeued')).toMatch(/^TASK-16\/17\/27 /);
    expect(detail('P7', 'task_rework_refused')).toMatch(/^TASK-28 /);
  });

  it('a re-projection keeps the disposition', () => {
    const deferred: TaskState = { ...(STATES.P2 as TaskState), disposition: 'deferred' };
    expect(transitionTask(deferred, EVENTS['run_ended:completed']('work'), ctxFor('P2')))
      .toEqual({ ok: true, next: { ...stateOf('work', ROW.P11.projection), disposition: 'deferred' }, effects: [] });
  });
});

// ------------------------------------------------------------------------ //
// newTaskRequeueRecord (§4.1 field table, §14.1)                             //
// ------------------------------------------------------------------------ //

const keyOf = (failureOutcome: NoProgressKeyV1['failure']['outcome']): NoProgressKeyV1 => ({ taskRef: task, actionKind: 'requeue',
  failure: { outcome: failureOutcome, origin: 'observed', exhaustedTokenBudget: null, checks: [], gapCodes: [] },
  source: { workspaceRevision: 3, sourceDigest: sha('5') }, plan: planRef, newInputDigest: null, digest: sha('6') });
function requeueInput(patch: Partial<NewTaskRequeueInput> = {}): NewTaskRequeueInput {
  return { task, planRef, afterRun: CRASHED, pointerIntent: null, chain: { kind: 'none' },
    requestedBy: operator, requestedAt: T_LATER, reason: 'retry after the flaky dependency', basis: keyOf('crashed'),
    newInputRefs: [], budget: null, trigger: null, agentProvenance: null, runs: [], requeues: [],
    policy: { autoReworkLimit: 3 }, historySource: null, ...patch };
}
type StopActor = Extract<ActorRef, { kind: 'human' | 'system' }>;
const stopIntent = (kind: 'pause' | 'cancel', requestedBy: StopActor, id = 'i-1') =>
  ({ ref: intentRef(id), kind, requestedBy });
const agentActor: ActorRef = { kind: 'agent', id: 'agent-1', runRef: runRef('run-7') };
const provenance: DelegatedWriteProvenanceV1 = { schemaVersion: 1, runRef: runRef('run-7'), sessionRef, roleBinding,
  sessionGeneration: 2, entryGeneration: 1, authorizationRevision: 1, configurationRevision: 'cfg-1' };
const goalResume = (resumedEpoch = 4, pausedEpoch = 3, goalId = G) =>
  ({ kind: 'goal_resume' as const, goalRef: { aggregateType: 'Goal' as const, projectId: P, goalId }, resumedEpoch, pausedEpoch });
const artifactInput: NewBasisInputRefV1 = { kind: 'artifact', ref: consumedWait.responseRef };
const HISTORY_SOURCE: TaskRequeueHistorySourceV1 = { sessionRef, adapterId: 'adapter-1', kernelSessionId: 'ks-1', throughPosition: 4 };
const REQUEUE_KEYS = ['ref', 'revision', 'schemaVersion', 'task', 'planRef', 'afterRunRef', 'afterAttemptRef', 'afterOutcome',
  'afterRoundRef', 'failureClass', 'interruption', 'stopIntentRef', 'stopRequester', 'basis', 'basisComparison',
  'supersededEvidenceIds', 'newInputRefs', 'budget', 'reason', 'requestedBy', 'requestedAt', 'agentProvenance', 'automation',
  'historySource'];

describe('newTaskRequeueRecord', () => {
  it('a human requeue of a crashed Run (FC-9): run_failed, compared, not automatic', () => {
    const record = newTaskRequeueRecord(requeueInput());
    expect(record).toEqual({
      ref: requeueRef, revision: 1, schemaVersion: 1, task, planRef, afterRunRef: runRef('run-1'),
      afterAttemptRef: { aggregateType: 'TaskAttempt', projectId: P, goalId: G, taskId: T, attemptId: 'att-run-1' },
      afterOutcome: 'crashed', afterRoundRef: null, failureClass: 'run_failed', interruption: null, stopIntentRef: null,
      stopRequester: 'none', basis: keyOf('crashed'), basisComparison: 'compared', supersededEvidenceIds: [], newInputRefs: [],
      budget: null, reason: 'retry after the flaky dependency', requestedBy: operator, requestedAt: T_LATER, agentProvenance: null,
      automation: { automatic: false, counted: false, autoCount: 0, cap: null }, historySource: null,
    });
    expect(Object.keys(record)).toEqual(REQUEUE_KEYS);
  });

  it('a Workflow requeue of a FAIL head (FC-15) supersedes the whole chain and counts along the Run chain', () => {
    const afterRun = run('run-1', { requeueRef: { ...requeueRef, afterRunId: 'run-0' } });
    const chain = roundChainHead([ROOT_FAIL, SUCC_FAIL]);
    const record = newTaskRequeueRecord(requeueInput({ afterRun, chain, requestedBy: WORKFLOW_AUTOMATION_ACTOR,
      basis: keyOf('completed'), requeues: [{ ref: { ...requeueRef, afterRunId: 'run-0' },
        automation: { automatic: true, counted: true, autoCount: 2, cap: 3 } }] }));
    expect(record).toMatchObject({ afterOutcome: 'completed', afterRoundRef: SUCC_FAIL.ref, failureClass: 'check_failed',
      interruption: null, basisComparison: 'compared', supersededEvidenceIds: ['e-1', 'e-4'],
      automation: { automatic: true, counted: true, autoCount: 3, cap: 3 } });
  });

  it('the Goal-resume continue of a paused-interrupted Run (FC-6, TASK-27) skips the key and is not counted', () => {
    const trigger = goalResume();
    const record = newTaskRequeueRecord(requeueInput({ afterRun: PAUSED_INTERRUPTED, requestedBy: GOAL_FAN_OUT_ACTOR, trigger,
      pointerIntent: stopIntent('pause', GOAL_FAN_OUT_ACTOR, 'i-pause') }));
    expect(record).toMatchObject({ failureClass: 'interrupted', interruption: 'paused', stopIntentRef: intentRef('i-pause'),
      stopRequester: 'goal_fan_out', trigger, basisComparison: 'skipped_interrupted', afterRoundRef: null,
      supersededEvidenceIds: [], automation: { automatic: true, counted: false, autoCount: 0, cap: 3 } });
    expect(Object.keys(record)).toEqual([...REQUEUE_KEYS.slice(0, 13), 'trigger', ...REQUEUE_KEYS.slice(13)]);
  });

  it('an operator continues a paused-interrupted Run (TASK-27): a human action resets the count', () => {
    expect(newTaskRequeueRecord(requeueInput({ afterRun: PAUSED_INTERRUPTED, pointerIntent: stopIntent('pause', operator, 'i-pause') })))
      .toMatchObject({ failureClass: 'interrupted', interruption: 'paused', stopRequester: 'human',
        basisComparison: 'skipped_interrupted', automation: { automatic: false, counted: false, autoCount: 0, cap: null } });
  });

  it('a human requeue of a human cancel skips the key (ND-6); a cancelled yielded wait is P17', () => {
    const cancelIntent = stopIntent('cancel', operator);
    const cancelled = newTaskRequeueRecord(requeueInput({ afterRun: { ...CANCELLED, ...pointer('cancelled') },
      pointerIntent: cancelIntent, basis: keyOf('cancelled') }));
    expect(cancelled).toMatchObject({ failureClass: 'cancelled', stopRequester: 'human', stopIntentRef: intentRef('i-1'),
      basisComparison: 'skipped_human_cancel' });
    const yielded = newTaskRequeueRecord(requeueInput({ afterRun: YIELDED_CANCELLED, pointerIntent: cancelIntent,
      basis: keyOf('yielded') }));
    expect(yielded).toMatchObject({ afterOutcome: 'yielded', failureClass: 'cancelled' });
  });

  it('the Workflow requeues a platform cancel and compares the key', () => {
    expect(newTaskRequeueRecord(requeueInput({ afterRun: { ...CANCELLED, ...pointer('cancelled') },
      pointerIntent: stopIntent('cancel', WORKFLOW_AUTOMATION_ACTOR), basis: keyOf('cancelled'),
      requestedBy: WORKFLOW_AUTOMATION_ACTOR }))).toMatchObject({ failureClass: 'cancelled', stopRequester: 'system',
      basisComparison: 'compared', automation: { automatic: true, counted: true, autoCount: 1, cap: 3 } });
  });

  it('an agent requeue records its provenance', () => {
    expect(newTaskRequeueRecord(requeueInput({ requestedBy: agentActor, agentProvenance: provenance })))
      .toMatchObject({ requestedBy: agentActor, agentProvenance: provenance,
        automation: { automatic: true, counted: true, autoCount: 1, cap: 3 } });
  });

  it('a human requeue of a finalized INCONCLUSIVE head (FC-16, TASK-17) covers the head', () => {
    expect(newTaskRequeueRecord(requeueInput({ afterRun: COMPLETED, chain: roundChainHead([FINAL_INCONCLUSIVE]),
      basis: keyOf('completed') }))).toMatchObject({ failureClass: 'check_incomplete', afterRoundRef: FINAL_INCONCLUSIVE.ref,
      supersededEvidenceIds: [] });
  });

  it('a host interruption is not counted, so a cap of 0 still admits it (C2)', () => {
    expect(newTaskRequeueRecord(requeueInput({ afterRun: CRASHED_INTERRUPTED, requestedBy: WORKFLOW_AUTOMATION_ACTOR,
      policy: { autoReworkLimit: 0 } }))).toMatchObject({ failureClass: 'interrupted', interruption: 'executing',
      automation: { automatic: true, counted: false, autoCount: 0, cap: 0 } });
  });

  it('a budget_exhausted requeue needs a larger budget or a new input (G-BUDGET, I-12 clause 8)', () => {
    const exhausted = run('run-1', { outcome: 'budget_exhausted', exitCode: null });
    const at = (patch: Partial<NewTaskRequeueInput>) =>
      () => newTaskRequeueRecord(requeueInput({ afterRun: exhausted, basis: keyOf('budget_exhausted'), ...patch }));
    expect(at({})).toThrow(/budget_not_increased/);
    expect(at({ budget: { tokenBudget: 1000, deadline: null } })).toThrow(/budget_not_increased/);
    expect(at({ budget: { tokenBudget: 2000, deadline: null } })()).toMatchObject({ failureClass: 'run_failed',
      budget: { tokenBudget: 2000, deadline: null } });
    expect(at({ newInputRefs: [artifactInput] })()).toMatchObject({ newInputRefs: [artifactInput], budget: null });
  });

  it('a crashed Run with a finalized FAIL head covers that head (I-12 clause 2, any outcome)', () => {
    expect(newTaskRequeueRecord(requeueInput({ chain: roundChainHead([FINAL_FAIL]) }))).toMatchObject({
      afterOutcome: 'crashed', failureClass: 'run_failed', afterRoundRef: FINAL_FAIL.ref, supersededEvidenceIds: ['e-1', 'e-3'] });
  });

  it('a history source needs Kernel entry or a requeueRef (I-12 clause 10)', () => {
    const entered = run('run-1', { outcome: 'crashed', exitCode: null, executionHistory: { schemaVersion: 1, sessionRef,
      kernel: { adapterId: 'adapter-1', kernelSessionId: 'ks-1', runId: 'k-run-1', turnId: 'turn-1' },
      startPosition: 0, observedThroughPosition: 4, endPosition: 4 } });
    expect(newTaskRequeueRecord(requeueInput({ afterRun: entered, historySource: HISTORY_SOURCE })))
      .toMatchObject({ historySource: HISTORY_SOURCE });
    const notEnteredRequeued = run('run-1', { outcome: 'cancelled', exitCode: null, ...pointer('cancelled'),
      requeueRef: { ...requeueRef, afterRunId: 'run-0' } });
    expect(newTaskRequeueRecord(requeueInput({ afterRun: notEnteredRequeued, pointerIntent: stopIntent('cancel', operator),
      basis: keyOf('cancelled'), historySource: HISTORY_SOURCE }))).toMatchObject({ historySource: HISTORY_SOURCE });
    expect(newTaskRequeueRecord(requeueInput())).toMatchObject({ historySource: null });
  });

  const HUMAN_CANCELLED = { ...CANCELLED, ...pointer('cancelled') };
  const FAN_OUT_PAUSED = { afterRun: PAUSED_INTERRUPTED, pointerIntent: stopIntent('pause', GOAL_FAN_OUT_ACTOR, 'i-pause') };
  const OVER_CAP: Partial<NewTaskRequeueInput> = {
    afterRun: run('run-1', { outcome: 'crashed', exitCode: null, requeueRef: { ...requeueRef, afterRunId: 'run-0' } }),
    requestedBy: WORKFLOW_AUTOMATION_ACTOR,
    requeues: [{ ref: { ...requeueRef, afterRunId: 'run-0' }, automation: { automatic: true, counted: true, autoCount: 3, cap: 3 } }],
  };
  it.each([
    ['a Run with nothing to rework (FC-12)', { afterRun: COMPLETED, basis: keyOf('completed') }, /no rework class \(FC-12\)/],
    ['an unknown outcome (FC-2)', { afterRun: ENDED_UNKNOWN }, /FC-2/],
    ['a paused yielded wait (FC-4)', { afterRun: YIELDED_PAUSED, pointerIntent: stopIntent('pause', operator) }, /FC-4/],
    ['an open head with only interrupted checks (FC-13: finalize first)', { afterRun: COMPLETED, basis: keyOf('completed'),
      chain: roundChainHead([OPEN_INTERRUPTED]) }, /is open; it is finalized before a requeue \(FC-13\)/],
    // I-12 clause 2 for an outcome `deriveReworkClass` judges without the chain (FC-9).
    ['a crashed Run whose chain is invalid (two legacy roots)', { chain: roundChainHead(TWO_ROOTS) },
      /the round chain is invalid .*\(incomplete\)/],
    ['a crashed Run whose head is a clean PASS', { chain: roundChainHead([FINAL_PASS]) }, /round-1 is a clean PASS/],
    ['a crashed Run whose head is open', { chain: roundChainHead([OPEN_PENDING]) },
      /is open; it is finalized before a requeue \(FC-9\)/],
    ['a completed Run whose head is a clean PASS (FC-17)', { afterRun: COMPLETED, basis: keyOf('completed'),
      chain: roundChainHead([FINAL_PASS]) }, /no rework class \(FC-17\)/],
    // I-12 clause 10: never entered the Kernel and no requeueRef.
    ['a history source for a Run that never entered the Kernel', { historySource: HISTORY_SOURCE },
      /never entered the Kernel and has no requeueRef/],
    ['an afterRun of another task', { afterRun: run('run-1', { outcome: 'crashed', task: gateTask }) }, /another task/],
    ['a chain of another Run', { afterRun: COMPLETED, chain: roundChainHead([round('round-9', { subjectRunRef: runRef('run-9'),
      status: 'finalized', outcome: 'FAIL' })]) }, /not the afterRun chain/],
    ['a missing pointer intent', { afterRun: HUMAN_CANCELLED, basis: keyOf('cancelled') }, /pointer intent/],
    ['another pointer intent', { afterRun: HUMAN_CANCELLED, basis: keyOf('cancelled'),
      pointerIntent: stopIntent('cancel', operator, 'i-2') }, /pointer intent/],
    ['an intent without a pointer', { pointerIntent: stopIntent('cancel', operator) }, /pointer intent/],
    ['a key of another outcome', { basis: keyOf('failed') }, /another outcome/],
    ['an empty reason', { reason: '  ' }, /reason/],
    ['an auto-rework limit above 10', { policy: { autoReworkLimit: 11 } }, /0\.\.10/],
    ['an agent budget', { requestedBy: agentActor, agentProvenance: provenance, budget: { tokenBudget: 5, deadline: null } },
      /an agent may not set a requeue budget/],
    ['agent provenance on a human requeue', { agentProvenance: provenance }, /provenance/],
    ['an agent requeue without provenance', { requestedBy: agentActor }, /provenance/],
    ['a trigger from an operator', { trigger: goalResume(2, 1) }, /only the Goal fan-out actor may carry a trigger/],
    ['the Goal fan-out on a crashed Run (FC-9)', { requestedBy: GOAL_FAN_OUT_ACTOR, trigger: goalResume() },
      /Goal fan-out actor only continues a paused-interrupted Run/],
    ['the Goal fan-out without a trigger', { ...FAN_OUT_PAUSED, requestedBy: GOAL_FAN_OUT_ACTOR },
      /a Goal pause stopped this work/],
    ['the Goal fan-out on a human pause', { afterRun: PAUSED_INTERRUPTED, requestedBy: GOAL_FAN_OUT_ACTOR, trigger: goalResume(),
      pointerIntent: stopIntent('pause', operator, 'i-pause') }, /a human stopped this work/],
    ['a trigger for another Goal', { ...FAN_OUT_PAUSED, requestedBy: GOAL_FAN_OUT_ACTOR, trigger: goalResume(4, 3, 'other') },
      /another Goal/],
    ['a trigger whose pause is not before its resume', { ...FAN_OUT_PAUSED, requestedBy: GOAL_FAN_OUT_ACTOR,
      trigger: goalResume(3, 3) }, /pause is not before its resume/],
    ['the Workflow continuing a Goal pause (AV-5)', { ...FAN_OUT_PAUSED, requestedBy: WORKFLOW_AUTOMATION_ACTOR },
      /a Goal pause stopped this work/],
    ['an agent continuing a human pause', { afterRun: PAUSED_INTERRUPTED, requestedBy: agentActor, agentProvenance: provenance,
      pointerIntent: stopIntent('pause', operator, 'i-pause') }, /a human stopped this work/],
    ['the Workflow requeuing a human cancel (hard limit 3)', { afterRun: HUMAN_CANCELLED, basis: keyOf('cancelled'),
      pointerIntent: stopIntent('cancel', operator), requestedBy: WORKFLOW_AUTOMATION_ACTOR }, /a human stopped this work/],
    ['an agent requeuing a platform cancel (C2)', { afterRun: HUMAN_CANCELLED, basis: keyOf('cancelled'),
      pointerIntent: stopIntent('cancel', WORKFLOW_AUTOMATION_ACTOR), requestedBy: agentActor, agentProvenance: provenance },
      /only by an operator or the platform automation/],
    ['the Workflow requeuing check_incomplete (FC-16, C2)', { afterRun: COMPLETED, basis: keyOf('completed'),
      chain: roundChainHead([FINAL_INCONCLUSIVE]), requestedBy: WORKFLOW_AUTOMATION_ACTOR }, /successor round/],
    ['an agent requeuing check_incomplete (FC-16, C2)', { afterRun: COMPLETED, basis: keyOf('completed'),
      chain: roundChainHead([FINAL_INCONCLUSIVE]), requestedBy: agentActor, agentProvenance: provenance }, /successor round/],
    ['a counted automatic requeue over the cap (G-CAP)', OVER_CAP, /automatic requeue 4 exceeds the cap 3/],
    ['a counted automatic requeue with a cap of 0', { requestedBy: WORKFLOW_AUTOMATION_ACTOR, policy: { autoReworkLimit: 0 } },
      /auto_rework_cap_reached/],
  ] as [string, Partial<NewTaskRequeueInput>, RegExp][])('refuses %s', (_name, patch, message) => {
    expect(() => newTaskRequeueRecord(requeueInput(patch))).toThrow(message);
  });
});
