/**
 * A.2 step 2 (spec §15.2 第 2 步): the Task machine of spec §4
 * (`state/task-machine.ts`).
 *
 * - `projectTaskPhase` / `classifyTaskPhase`: one case per row P1..P18 with
 *   its target phase (A.2 step 5.3; P4 since 5.4; P19 since 5.6) and the TD-1
 *   cause; P20 (5.9 part 2) for a gate's own chain head right after P1;
 *   in-round monotonicity, legacy PASS with gaps,
 *   successor heads and the disposition independence.
 * - `transitionTask`: every (state, event) combination over the projection
 *   states (plus ∅): a legal one asserts `next` and `effects`, a re-projection
 *   without change asserts the same state and `effects:[]` (SD-1), an illegal
 *   one asserts `reason` and `code` (§4.4). Rows of later substeps answer
 *   `illegal`/`invalid`; 改造 rows of later substeps keep today's result.
 * - Guard order of the claim (TASK-03 with the covering TaskRequeue since
 *   5.4), the requeue and refusal rows (TASK-16/17/28 in the §4.3 unified
 *   order, §4.4 codes; TASK-27 since 5.6), completion, disposition and adoption
 *   rows, and
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
import type { ControlIntentRef, ControlIntentSnapshotV1 } from '../../src/contracts/control-intent.js';
import type { CoreError, CoreRejection } from '../../src/contracts/core/results.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { DelegatedWriteProvenanceV1 } from '../../src/contracts/delegated-write.js';
import type {
  ConsumedWaitV1, RoleBindingRefV1, RunContinuationV1, RunOutcome, RunReconciliationV1, RunRef, RunSnapshot, TaskLeaseSnapshot,
  TaskTriple,
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
  taskCompletionFoldProblem, taskCompletionProjectionProblem, taskCompletionRoundProblem, taskMachineStateOf, transitionTask,
  type NewTaskRequeueInput, type TaskClaimFacts, type TaskCompletionFacts, type TaskEffect, type TaskEvent,
  type TaskGuardContext, type TaskMachineState, type TaskPhaseFacts, type TaskPhaseProjection, type TaskReductionBuildV1,
  type TaskDispositionFacts, type TaskReworkFacts, type TaskRoundEventKind, type TaskState,
} from '../../src/core/work-graph/state/task-machine.js';
import type { TracedTaskFactsV1 } from '../../src/core/work-graph/state/plan-machine.js';
import { newTaskReworkRefusalRecord } from '../../src/core/work-graph/state/task-failure.js';
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
/** P19 (C4, A.2 step 5.6): the paused-interrupted end of `PAUSED_INTERRUPTED`. */
const P19_PROJECTION: TaskPhaseProjection = { row: 'P19', phase: 'blocked', cause: { code: 'paused_interrupted',
  detail: { afterRunRef: runRef('run-1'), pausedIntentRef: intentRef('i-pause'), kernelPaused: true } } };
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

type RowLabel = 'P1' | 'P1v' | 'P1f' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6' | 'P7' | 'P8' | 'P9' | 'P10' | 'P11' | 'P12' | 'P13'
  | 'P14' | 'P15' | 'P16' | 'P17' | 'P18';

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
  // P4 (D-3, C1; 5.4): the TaskRequeue covering the selected Run.
  P4: { facts: facts({ selectedRun: CRASHED, coveringRequeue: requeueRef }),
    projection: { row: 'P4', phase: 'pending', cause: { code: 'requeued', detail: { requeueRef } } } },
  P5: { facts: facts({ selectedRun: YIELDED_WAIT }), projection: { row: 'P5', phase: 'ready', cause: null } },
  P6: { facts: facts({ selectedRun: CRASHED }),
    projection: { row: 'P6', phase: 'failed', cause: { code: 'run_failed', detail: { outcome: 'crashed', origin: 'observed' } } } },
  P7: { facts: facts({ selectedRun: COMPLETED, round: SIG.fail }),
    projection: { row: 'P7', phase: 'failed', cause: { code: 'check_failed', detail: { checkIds: ['unit'] } } } },
  P8: { facts: facts({ selectedRun: COMPLETED, round: SIG.inconclusive }),
    projection: { row: 'P8', phase: 'blocked', cause: { code: 'round_inconclusive', detail: { gapCodes: ['pending_check'] } } } },
  P9: { facts: facts({ selectedRun: COMPLETED, round: SIG.interrupted }),
    projection: { row: 'P9', phase: 'blocked', cause: { code: 'check_interrupted' } } },
  P10: { facts: facts({ selectedRun: COMPLETED, round: SIG.invalid }),
    projection: { row: 'P10', phase: 'blocked', cause: { code: 'round_ambiguous' } } },
  P11: { facts: facts({ selectedRun: COMPLETED }),
    projection: { row: 'P11', phase: 'verifying', cause: { code: 'awaiting_verification' } } },
  P12: { facts: facts({ selectedRun: COMPLETED, round: SIG.open }),
    projection: { row: 'P12', phase: 'verifying', cause: { code: 'verification_running' } } },
  P13: { facts: facts({ selectedRun: COMPLETED, round: SIG.pass }),
    projection: { row: 'P13', phase: 'verifying', cause: { code: 'awaiting_completion' } } },
  P14: { facts: facts({ selectedRun: YIELDED_BARE }), projection: { row: 'P14', phase: 'blocked', cause: { code: 'run_failed' } } },
  P15: { facts: facts({ originUnresolvable: true }),
    projection: { row: 'P15', phase: 'blocked', cause: { code: 'origin_unresolvable' } } },
  P16: { facts: facts(), projection: { row: 'P16', phase: 'pending', cause: null } },
  P17: { facts: facts({ selectedRun: YIELDED_CANCELLED }),
    projection: { row: 'P17', phase: 'failed', cause: { code: 'continuation_cancelled' } } },
  P18: { facts: facts({ selectedRun: YIELDED_PAUSED }),
    projection: { row: 'P18', phase: 'blocked', cause: { code: 'continuation_paused' } } },
};
const ROW_LABELS = Object.keys(ROW) as RowLabel[];

/** P20 (C5, 5.9 part 2): a gate's own chain head, mapped as the work rows map it, with `gate` and `ordinal`. */
const P20 = {
  open: { row: 'P20', phase: 'verifying', cause: { code: 'verification_running', detail: { gate: true, ordinal: 1 } } },
  mixed: { row: 'P20', phase: 'verifying', cause: { code: 'verification_running',
    detail: { checkIds: ['lint'], gate: true, ordinal: 1 } } },
  interrupted: { row: 'P20', phase: 'blocked', cause: { code: 'check_interrupted', detail: { gate: true, ordinal: 1 } } },
  fail: { row: 'P20', phase: 'failed', cause: { code: 'check_failed', detail: { checkIds: ['unit'], gate: true, ordinal: 1 } } },
  inconclusive: { row: 'P20', phase: 'blocked', cause: { code: 'round_inconclusive',
    detail: { gapCodes: ['pending_check'], gate: true, ordinal: 1 } } },
  pass: { row: 'P20', phase: 'verifying', cause: { code: 'awaiting_completion', detail: { gate: true, ordinal: 1 } } },
  invalid: { row: 'P20', phase: 'blocked', cause: { code: 'round_ambiguous', detail: { gate: true } } },
  succOpen: { row: 'P20', phase: 'verifying', cause: { code: 'verification_running',
    detail: { ordinal: 2, predecessorRoundRef: ROOT_FAIL.ref, gate: true } } },
} satisfies Record<string, TaskPhaseProjection>;

describe('projectTaskPhase: one case per row, the target phase (§4.1, §15.2 step 5.3)', () => {
  it.each(ROW_LABELS)('%s', (label) => {
    const { facts: rowFacts, projection } = ROW[label];
    expect(classifyTaskPhase(rowFacts)).toEqual(projection);
    expect(projectTaskPhase(rowFacts)).toEqual({ phase: projection.phase, cause: projection.cause });
  });

  it('P2 holds for a starting Run, and P1 wins over an active Run', () => {
    expect(classifyTaskPhase(facts({ selectedRun: STARTING }))).toEqual({ row: 'P2', phase: 'running', cause: null });
    expect(classifyTaskPhase(facts({ applicableReduction: { phase: 'satisfied' }, selectedRun: RUNNING })))
      .toEqual({ row: 'P1', phase: 'satisfied', cause: null });
  });

  it('P6 covers every failed outcome with its origin; a RUN-19 interruption is host_interrupted', () => {
    for (const outcome of ['crashed', 'cancelled', 'budget_exhausted', 'failed'] as RunOutcome[]) {
      expect(classifyTaskPhase(facts({ selectedRun: run('run-1', { outcome }) })))
        .toEqual({ row: 'P6', phase: 'failed', cause: { code: 'run_failed', detail: { outcome, origin: 'observed' } } });
    }
    expect(classifyTaskPhase(facts({ selectedRun: CRASHED_INTERRUPTED }))).toEqual({ row: 'P6', phase: 'failed',
      cause: { code: 'run_failed', detail: { outcome: 'crashed', origin: 'host_interrupted' } } });
  });

  it('an ended Run without an outcome is defended like P14 (blocked)', () => {
    expect(classifyTaskPhase(facts({ selectedRun: ENDED_NO_OUTCOME })))
      .toEqual({ row: 'P14', phase: 'blocked', cause: { code: 'run_failed' } });
  });

  it('TD-5: a stop pointer on a yielded wait shows (P17/P18 before P5); a running or steered pointer stays P5', () => {
    expect(classifyTaskPhase(facts({ selectedRun: YIELDED_CANCELLED }))).toEqual(ROW.P17.projection);
    expect(classifyTaskPhase(facts({ selectedRun: YIELDED_PAUSED }))).toEqual(ROW.P18.projection);
    for (const desired of ['running', 'steered'] as const) {
      expect(classifyTaskPhase(facts({ selectedRun: run('run-1', { outcome: 'yielded', exitCode: null, continuation,
        ...pointer(desired) }) }))).toEqual(ROW.P5.projection);
    }
    // Without a continuation the yield is P14 whatever the pointer.
    expect(classifyTaskPhase(facts({ selectedRun: run('run-1', { outcome: 'yielded', exitCode: null, ...pointer('cancelled') }) })))
      .toEqual(ROW.P14.projection);
  });

  it('P4 (5.4): a covering TaskRequeue makes the ended Run pending(requeued) whatever its outcome and chain head', () => {
    expect(classifyTaskPhase(facts({ selectedRun: COMPLETED, round: SIG.fail, coveringRequeue: requeueRef })))
      .toEqual(ROW.P4.projection);
    expect(classifyTaskPhase(facts({ selectedRun: COMPLETED, round: SIG.inconclusive, coveringRequeue: requeueRef })))
      .toEqual(ROW.P4.projection);
    expect(classifyTaskPhase(facts({ selectedRun: YIELDED_CANCELLED, coveringRequeue: requeueRef }))).toEqual(ROW.P4.projection);
    // P1 and P2 come first; a requeue never covers an unknown outcome, which stays P3.
    expect(classifyTaskPhase(facts({ applicableReduction: { phase: 'satisfied' }, selectedRun: COMPLETED, round: SIG.pass,
      coveringRequeue: requeueRef }))).toEqual(ROW.P1.projection);
    expect(classifyTaskPhase(facts({ selectedRun: RUNNING, coveringRequeue: requeueRef }))).toEqual(ROW.P2.projection);
    expect(classifyTaskPhase(facts({ selectedRun: ENDED_UNKNOWN, coveringRequeue: requeueRef }))).toEqual(ROW.P3.projection);
  });

  it('P19 (C4, step 5.6) comes before P6', () => {
    // P19: paused-interrupted, shown as 已暂停，可继续; never failed/run_failed.
    expect(classifyTaskPhase(facts({ selectedRun: PAUSED_INTERRUPTED }))).toEqual(P19_PROJECTION);
    // A plain clean interruption (no paused pointer) stays P6.
    expect(classifyTaskPhase(facts({ selectedRun: run('run-1', { outcome: 'crashed', exitCode: null,
      reconciliation: interruptedClean(null) }) }))).toMatchObject({ row: 'P6', phase: 'failed' });
  });

  it('P20 (C5, 5.9 part 2): a gate projects from its own chain head right after P1, with gate and ordinal', () => {
    const cases: [RoundTaskSignalV1, TaskPhaseProjection][] = [[SIG.open, P20.open], [SIG.mixed, P20.mixed],
      [SIG.interrupted, P20.interrupted], [SIG.fail, P20.fail], [SIG.inconclusive, P20.inconclusive], [SIG.pass, P20.pass],
      [SIG.invalid, P20.invalid], [SIG.succOpen, P20.succOpen]];
    for (const [signal, projected] of cases) expect(classifyTaskPhase(gateFacts({ round: signal }))).toEqual(projected);
    // A legacy PASS with gaps is round_inconclusive (VD-4), as for work.
    expect(classifyTaskPhase(gateFacts({ round: SIG.passGaps }))).toEqual(P20.inconclusive);
    // P1 wins; P20 comes before P15; without a chain a gate has no Run: P16, or P15 with an unresolvable reduction.
    expect(classifyTaskPhase(gateFacts({ applicableReduction: { phase: 'satisfied' }, round: SIG.pass })))
      .toEqual(ROW.P1.projection);
    expect(classifyTaskPhase(gateFacts({ round: SIG.fail, originUnresolvable: true }))).toEqual(P20.fail);
    expect(classifyTaskPhase(gateFacts())).toEqual(ROW.P16.projection);
    expect(classifyTaskPhase(gateFacts({ originUnresolvable: true }))).toEqual(ROW.P15.projection);
    // P20 reads only gates: a work Task with the same facts and no Run is P16.
    expect(classifyTaskPhase(facts({ round: SIG.fail }))).toEqual(ROW.P16.projection);
  });

  it('within one round: interrupted with a check still pending stays P12, then P9 (brief §2a)', () => {
    expect(classifyTaskPhase(facts({ selectedRun: COMPLETED, round: SIG.mixed }))).toEqual({ row: 'P12', phase: 'verifying',
      cause: { code: 'verification_running', detail: { checkIds: ['lint'] } } });
    expect(classifyTaskPhase(facts({ selectedRun: COMPLETED, round: SIG.interrupted }))).toEqual(ROW.P9.projection);
  });

  it('a legacy PASS with gaps is P8 round_inconclusive, never awaiting completion (VD-4)', () => {
    expect(classifyTaskPhase(facts({ selectedRun: COMPLETED, round: SIG.passGaps }))).toEqual({ row: 'P8', phase: 'blocked',
      cause: { code: 'round_inconclusive', detail: { gapCodes: ['pending_check'] } } });
  });

  it('a successor head adds ordinal and predecessor to the detail (C5)', () => {
    expect(classifyTaskPhase(facts({ selectedRun: COMPLETED, round: SIG.succOpen }))).toEqual({ row: 'P12', phase: 'verifying',
      cause: { code: 'verification_running', detail: { ordinal: 2, predecessorRoundRef: ROOT_FAIL.ref } } });
    expect(classifyTaskPhase(facts({ selectedRun: COMPLETED, round: SIG.succFail }))).toEqual({ row: 'P7', phase: 'failed',
      cause: { code: 'check_failed', detail: { ordinal: 2, predecessorRoundRef: ROOT_FAIL.ref, checkIds: ['lint'] } } });
    // An ordinal-1 root with a chain carries no successor detail.
    expect(classifyTaskPhase(facts({ selectedRun: COMPLETED, round: roundTaskSignal([ROOT_FAIL]) })))
      .toEqual({ row: 'P7', phase: 'failed', cause: { code: 'check_failed', detail: { checkIds: ['unit'] } } });
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

/** Gate states: P1, P16, and P20 over an open head, an interrupted one, FAIL, INCONCLUSIVE, PASS, an invalid chain (5.9). */
type GateLabel = 'gate:P1' | 'gate:P16' | 'gate:P20o' | 'gate:P20c' | 'gate:P20f' | 'gate:P20i' | 'gate:P20p' | 'gate:P20x';
type StateLabel = 'absent' | RowLabel | GateLabel;
const stateOf = (taskKind: TaskKind, projection: TaskPhaseProjection): TaskState =>
  ({ taskKind, disposition: 'active', ...projection });
const STATES: Record<StateLabel, TaskMachineState> = {
  absent: null,
  ...Object.fromEntries(ROW_LABELS.map((label) => [label, stateOf('work', ROW[label].projection)])) as Record<RowLabel, TaskState>,
  'gate:P1': stateOf('gate', ROW.P1.projection),
  'gate:P16': stateOf('gate', ROW.P16.projection),
  'gate:P20o': stateOf('gate', P20.open),
  'gate:P20c': stateOf('gate', P20.interrupted),
  'gate:P20f': stateOf('gate', P20.fail),
  'gate:P20i': stateOf('gate', P20.inconclusive),
  'gate:P20p': stateOf('gate', P20.pass),
  'gate:P20x': stateOf('gate', P20.invalid),
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
  prior: null, admission: null, requeue: null, ...patch });

const PRODUCER = run('run-1');
const SATISFIED = { satisfied: true, phase: 'satisfied' as const, causes: [], satisfiedObligationIds: ['ob-1'] };
/** The selected Run's chain head is the completion round by default (TASK-14, C5). */
const completionFacts = (patch: Partial<TaskCompletionFacts> = {}): TaskCompletionFacts =>
  ({ producerRun: PRODUCER, producerTaskKind: 'work', evaluation: SATISFIED, chainHead: roundRef('round-1'), ...patch });

/** A TaskLease record of the Task's selected Run; only `release` is read by TASK-19 (guard 4). */
function leaseRecord(released: boolean): TaskLeaseSnapshot {
  const lease = { ref: { aggregateType: 'TaskLease', projectId: P, goalId: G, taskId: T }, revision: released ? 2 : 1, schemaVersion: 1,
    holderRunId: 'run-1', attemptId: 'att-run-1', grantedAt: T_START, expiresAt: null } as TaskLeaseSnapshot;
  return released ? { ...lease, release: { runRef: runRef('run-1') } as unknown as NonNullable<TaskLeaseSnapshot['release']> } : lease;
}
/** Only its presence is read by TASK-19 (guard 5). */
const REDUCTION_RECORD = { ref: { aggregateType: 'TaskReduction', projectId: P, goalId: G, taskId: T }, revision: 1,
  phase: 'satisfied' } as unknown as TaskReductionSnapshot;

/**
 * C7 (5.10): what `readDispositionChangeTaskFacts` would read for each state. The selected Run is the
 * Task's Run (P15: an ended Run whose origin is not resolvable, so none is selected); its lease is held
 * while it is live and released after it ended; P1 has a Reduction; a gate has no Run (`gate:P1` its
 * Reduction). No pointer intent is read (TASK-19 guard 7 is in the describe below).
 */
function dispositionFactsFor(label: StateLabel): TracedTaskFactsV1 {
  const rowFacts = label === 'absent' || isGate(label) ? null : ROW[label as RowLabel].facts;
  const selectedRun = rowFacts?.selectedRun ?? null;
  const runs = selectedRun !== null ? [selectedRun] : label === 'P15' ? [CRASHED] : [];
  const lease = runs.length === 0 ? null : leaseRecord(selectedRun === null || selectedRun.status === 'ended');
  const reduction = rowFacts?.applicableReduction != null || label === 'gate:P1' ? REDUCTION_RECORD : null;
  return { taskId: isGate(label) ? GATE : T, runs, selectedRun, lease, reduction, pointerIntent: null };
}
const dispositionCtx = (facts: TracedTaskFactsV1, patch: Partial<TaskDispositionFacts> = {}): TaskDispositionFacts =>
  ({ facts, goalDesiredState: 'active', affectedTaskIds: [T, GATE], replacedByTaskId: null, ...patch });

/**
 * The facts a real read would give for each state (a gate with rounds has no Run, Lease or Reduction). A
 * gate completes with its own chain head (TASK-15).
 */
function ctxFor(label: StateLabel): TaskGuardContext {
  return {
    taskId: isGate(label) ? GATE : T,
    claim: claimFacts({
      lease: label === 'P2' ? { status: 'leased', holderRunId: 'run-1' } : { status: 'free' },
      taskHasRun: !(label === 'P16' || label === 'absent' || isGate(label)),
      prior: label === 'P5' ? CONSUMABLE_PRIOR : null,
      // Only P4 has a TaskRequeue covering its selected Run (TASK-03, D-3).
      requeue: label === 'P4' ? { coversSelectedRun: true, leaseReleasedByAfterRun: true, budgetPinned: true } : null,
    }),
    completion: isGate(label) ? completionFacts({ chainHead: GATE_PASS.ref }) : completionFacts(),
    disposition: dispositionCtx(dispositionFactsFor(label)),
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
/**
 * Gate Tasks have no Run: every re-projection reaches them with gate facts (no selected Run) whose round is
 * the same chain head as the work facts' (P20: the gate's own chain, 5.9 part 2).
 */
const post = (kind: TaskKind, workFacts: TaskPhaseFacts): TaskPhaseFacts =>
  kind === 'gate' ? gateFacts({ round: workFacts.round }) : workFacts;
const roundEvent = (eventKind: TaskRoundEventKind, workFacts: TaskPhaseFacts): EventFor => (kind) =>
  ({ kind: eventKind, roundRef: roundRef('round-1'), subjectRunRef: runRef('run-1'), facts: post(kind, workFacts) });
const finalized = (outcome: EvidenceOutcome, workFacts: TaskPhaseFacts, gapCodes: string[] = [], runId = 'run-1'): EventFor =>
  (kind) => ({ kind: 'round_finalized', roundRef: roundRef('round-1', runId), subjectRunRef: runRef(runId), outcome, gapCodes,
    facts: post(kind, workFacts) });

/** A TASK-28 cap refusal keyed by the selected Run run-1 (5.4). */
const CAP_REFUSAL = newTaskReworkRefusalRecord({ current: null,
  ref: { aggregateType: 'TaskReworkRefusal', projectId: P, goalId: G, taskId: T, operation: 'requeue', subjectId: 'run-1' },
  task, afterRunRef: runRef('run-1'), subjectRoundRef: null, failureClass: 'run_failed', code: 'auto_rework_cap_reached',
  reason: 'the automatic requeue 4 exceeds the cap 3', basisDigest: null, source: null, matchedRequeueRef: null,
  requestedBy: WORKFLOW_AUTOMATION_ACTOR, refusedAt: T_LATER, goalEndedRunsAtRefusal: 4, configurationRevision: null });

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
  'round_finalized:FAIL': finalized('FAIL', ROW.P7.facts),
  'round_finalized:INCONCLUSIVE': finalized('INCONCLUSIVE', ROW.P8.facts, ['pending_check']),
  'round_finalized:PASS': finalized('PASS', ROW.P13.facts),
  'round_finalized:older_run': finalized('FAIL', ROW.P7.facts, [], 'run-0'),
  // A gate's successor is the new head of its own chain (TASK-30): the gate facts read the open successor.
  'round_reverified': (kind) => kind === 'gate'
    ? { kind: 'round_reverified', roundRef: SUCC_OPEN.ref, predecessorRoundRef: ROOT_FAIL.ref, subjectRunRef: runRef('run-1'),
      facts: gateFacts({ round: SIG.succOpen }) }
    : { kind: 'round_reverified', roundRef: roundRef('round-2'), predecessorRoundRef: roundRef('round-1'),
      subjectRunRef: runRef('run-1'), facts: post(kind, ROW.P12.facts) },
  'task_completed': (kind) => kind === 'gate'
    ? { kind: 'task_completed', task: gateTask, round: GATE_PASS, reduction: REDUCTION_BUILD(gateTask) }
    : { kind: 'task_completed', task, round: FINAL_PASS, reduction: REDUCTION_BUILD(task) },
  'task_requeued': () => ({ kind: 'task_requeued', requeue: requeueInput() }),
  'task_rework_refused': () => ({ kind: 'task_rework_refused', refusal: CAP_REFUSAL, pointerIntent: null }),
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
/** A re-projection to a projection that has no ROW fixture (P19). */
function reprojectTo(label: StateLabel, projection: TaskPhaseProjection): Expect {
  const state = STATES[label] as TaskState;
  const next = stateOf(state.taskKind, projection);
  return JSON.stringify({ ...state }) === JSON.stringify(next) ? SAME : to(next);
}
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
/** The rows a claim never takes: `blocked`, `failed` and `verifying` (§4.4 `busy`). */
const BLOCKED_ROWS: StateLabel[] = ['P3', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11', 'P12', 'P13', 'P14', 'P15', 'P17', 'P18'];

function claimExpect(label: StateLabel, basis: 'first' | 'continuation' | 'requeue'): Expect {
  if (label === 'absent') return NOT_FOUND;
  if (isGate(label)) return II;
  if (label === 'P1') return no('illegal', 'busy');
  if (label === 'P1v' || label === 'P1f' || label === 'P2' || BLOCKED_ROWS.includes(label)) return GB;
  // TASK-03 (D-3; 5.4): a requeue claim needs the TaskRequeue covering the
  // selected Run (only P4 has one): elsewhere `stale`/`revision_conflict`.
  const STALE = no('stale', 'revision_conflict');
  // P4 has a Run: only the covering requeue re-holds the released lease (ATT-16).
  if (label === 'P4') return basis === 'requeue' ? to(stateOf('work', ROW.P2.projection), CLAIM_EFFECTS('reheld')) : GB;
  // P5 has a Run: only the continuation reholds its lease.
  if (label === 'P5') {
    if (basis === 'requeue') return STALE;
    return basis === 'continuation' ? to(stateOf('work', ROW.P2.projection), CLAIM_EFFECTS('reheld')) : GB;
  }
  // P16: no Run; a continuation has no prior Run of this Task and no TaskRequeue covers anything.
  if (basis === 'requeue') return STALE;
  return basis === 'continuation' ? GB : to(stateOf('work', ROW.P2.projection), CLAIM_EFFECTS('first'));
}

/** Re-projection events: ∅ → not_found; the rest per row id. */
function reprojectionExpect(label: StateLabel, event: EventLabel): Expect {
  if (label === 'absent') return NOT_FOUND;
  const gate = isGate(label);
  switch (event) {
    // TASK-05, TASK-06, TASK-04; from P3 these are TASK-08 (the unknown end resolved).
    case 'run_ended:completed': return gate ? SAME : reproject(label, 'P11');
    case 'run_ended:crashed': return gate ? SAME : reproject(label, 'P6');
    case 'run_ended:yielded': return gate ? SAME : reproject(label, 'P5');
    // TASK-21 (TD-5) and TASK-07.
    case 'run_ended:yielded:pointer': return gate ? SAME : reproject(label, 'P18');
    case 'run_ended:unknown': return gate ? SAME : reproject(label, 'P3');
    // TASK-26 (C4, step 5.6): the RUN-24 end re-projects to P19.
    case 'run_ended:paused_interrupted': return gate ? SAME : reprojectTo(label, P19_PROJECTION);
    case 'run_ended:older_run': return SAME;
    case 'control:pause:running': return gate ? SAME : reproject(label, 'P2');
    // TASK-22/23 (TD-5).
    case 'control:pause:yielded': return gate ? SAME : reproject(label, 'P18');
    case 'control:cancel:yielded': return gate ? SAME : reproject(label, 'P17');
    case 'control:resume:yielded': return gate ? SAME : reproject(label, 'P5');
    case 'control:steer:yielded': return gate ? SAME : reproject(label, 'P5');
    // TASK-09 (work) and TASK-30 (gate, 5.9 part 2: P20 over the gate's own chain head).
    case 'round_opened':
    case 'check_begun':
    case 'check_result_recorded':
    case 'check_abandoned':
      return gate ? reprojectTo(label, P20.open) : reproject(label, 'P12');
    // TASK-12: the last pending/executing check settled with an interrupted one left.
    case 'check_interrupted': return gate ? reprojectTo(label, P20.interrupted) : reproject(label, 'P9');
    case 'round_finalized:FAIL': return gate ? reprojectTo(label, P20.fail) : reproject(label, 'P7');
    case 'round_finalized:INCONCLUSIVE': return gate ? reprojectTo(label, P20.inconclusive) : reproject(label, 'P8');
    // §4.4: blocked(check_interrupted) + PASS is illegal, for a gate's head too.
    case 'round_finalized:PASS':
      if (gate) return label === 'gate:P20c' ? II : reprojectTo(label, P20.pass);
      return label === 'P9' ? II : reproject(label, 'P13');
    // TASK-20 (work: an older Run) and TASK-30 (gate: a round that is not the chain head): history only.
    case 'round_finalized:older_run': return SAME;
    // TASK-29 (5.9): the open successor head re-projects a work Task (P12); TASK-30 a gate (P20, ordinal 2).
    case 'round_reverified': return gate ? reprojectTo(label, P20.succOpen) : reproject(label, 'P12');
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
  const gate = isGate(label);
  // TASK-14/24 (§4.4): a Task completes only from `verifying` or `satisfied`; TASK-15 (C5, 5.9 part 2): a
  // gate too, from P20 over its own chain head.
  const phase = (STATES[label] as TaskState).phase;
  if (phase === 'failed' || phase === 'blocked') return no('illegal', 'incomplete');
  if (phase === 'pending' || phase === 'ready' || phase === 'running') return no('guard_failed', 'incomplete');
  return to(stateOf(gate ? 'gate' : 'work', ROW.P1.projection), [{ kind: 'write_task_reduction',
    reduction: gate ? expectedReduction(gateTask, GATE_PASS) : expectedReduction(task, FINAL_PASS) }]);
}

/** TASK-18/19 effects (C7, 5.10): the change is recorded in the new Plan's `dispositionRecord`. */
const DISPOSITION_EFFECTS: TaskEffect[] = [{ kind: 'write_plan_revision' }, { kind: 'record_disposition_change' },
  { kind: 'move_goal_pointer' }];

function dispositionExpect(label: StateLabel): Expect {
  if (label === 'absent') return II;
  if (isGate(label)) return no('guard_failed', 'invalid');
  // TASK-19 (C7, 5.10) from every projection except the ones §4.4 refuses by their facts: a satisfied Task's
  // disposition is final (P1, guard 5); a running Run (P2, guard 1), an unknown outcome (P3, guard 2) and an
  // unconsumed yielded wait (P5, P18, guard 3) are `busy`. P16 is TASK-18 (untraced). The phase never changes.
  switch (label) {
    case 'P1': case 'P1v': case 'P1f': return II;
    case 'P2': case 'P3': case 'P5': case 'P18': return GB;
    default: return to({ ...(STATES[label] as TaskState), disposition: 'deferred' }, DISPOSITION_EFFECTS);
  }
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
    // TASK-16/17/28 (5.4): ∅ has no Task; elsewhere the owner's rework facts
    // are required (this table's contexts carry none). The rows themselves are
    // in the 'task_requeued and task_rework_refused' describe below.
    case 'task_requeued':
    case 'task_rework_refused':
      return label === 'absent' ? NOT_FOUND : II;
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
    const blockedDeferred: TaskState = { ...(STATES.P8 as TaskState), disposition: 'superseded' };
    expect(claimWith(blockedDeferred, {})).toMatchObject({ code: 'invalid' });
    const structural = rejection('incomplete', 'task is plan_only and is not a dispatch candidate until an explicit request_execution');
    expect(claimWith(STATES.P8, { structuralProblem: structural })).toMatchObject({ ok: false, reason: 'guard_failed',
      code: 'incomplete', detail: structural.reason });
    expect(claimWith(STATES.P8, {})).toMatchObject({ ok: false, reason: 'guard_failed', code: 'busy', detail: 'task is blocked' });
    // P7 is `failed` since A.2 step 5.3 (D-2): not dispatchable, still `busy`.
    expect(claimWith(STATES.P7, {})).toMatchObject({ ok: false, reason: 'guard_failed', code: 'busy',
      detail: 'task phase is not dispatchable (pending|ready)' });
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

  it('a requeue claim takes only the TaskRequeue covering the selected Run (TASK-03, D-3; 5.4)', () => {
    const covering = { coversSelectedRun: true, leaseReleasedByAfterRun: true, budgetPinned: true };
    const at = (requeue: Partial<typeof covering> | null, patch: Partial<TaskClaimFacts> = {}) => claimWith(STATES.P4,
      { taskHasRun: true, requeue: requeue === null ? null : { ...covering, ...requeue }, ...patch }, 'claim:requeue');
    // Accepted from P4: running, the released lease re-held @k+1.
    expect(at({})).toEqual({ ok: true, next: stateOf('work', ROW.P2.projection), effects: CLAIM_EFFECTS('reheld') });
    // An older requeue (or none) never claims again; the lease must be the afterRun's.
    expect(at(null)).toMatchObject({ ok: false, reason: 'stale', code: 'revision_conflict',
      detail: 'the requeueRef does not name the TaskRequeue covering the selected Run' });
    expect(at({ coversSelectedRun: false })).toMatchObject({ ok: false, reason: 'stale', code: 'revision_conflict' });
    expect(at({ leaseReleasedByAfterRun: false })).toMatchObject({ ok: false, reason: 'stale', code: 'revision_conflict',
      detail: 'the Task lease was not released by the requeue afterRun' });
    // C1: a requeue budget different from the claim budget.
    expect(at({ budgetPinned: false })).toMatchObject({ ok: false, reason: 'illegal', code: 'invalid' });
    // The earlier guards still come first: disposition (task_not_active), a held lease, then admission last.
    expect(claimWith({ ...(STATES.P4 as TaskState), disposition: 'deferred' }, { taskHasRun: true, requeue: covering },
      'claim:requeue')).toMatchObject({ ok: false, reason: 'guard_failed', code: 'invalid' });
    expect(at(null, { lease: { status: 'leased', holderRunId: 'run-9' } }))
      .toMatchObject({ ok: false, code: 'busy', detail: 'task already has an active lease (holder run run-9)' });
    expect(at({}, { admission: rejection('capacity', 'budget.deadline has passed') }))
      .toMatchObject({ ok: false, reason: 'guard_failed', code: 'capacity' });
    // Outside P4 the projection already refuses or no TaskRequeue covers the Run.
    expect(claimWith(STATES.P16, { taskHasRun: false }, 'claim:requeue')).toMatchObject({ ok: false, reason: 'stale',
      code: 'revision_conflict' });
    expect(claimWith(STATES.P7, { taskHasRun: true, requeue: covering }, 'claim:requeue')).toMatchObject({ ok: false,
      reason: 'guard_failed', code: 'busy' });
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
    // TASK-15 (5.9 part 2): from P20 verifying(awaiting_completion), with the gate's own chain head.
    const head = { chainHead: GATE_PASS.ref };
    expect(at(gate, { ...head, producerRun: { ...PRODUCER, task: gateTask } }, STATES['gate:P20p'])).toMatchObject({ code: 'invalid',
      detail: 'a gate round must reference a same-Goal ordinary producer Run, not a gate Run' });
    expect(at(gate, { ...head, producerTaskKind: 'gate' }, STATES['gate:P20p'])).toMatchObject({ code: 'invalid',
      detail: 'the gate round producer Run must be a same-Plan work task' });
    expect(at(gate, { ...head, producerTaskKind: null }, STATES['gate:P20p'])).toMatchObject({ code: 'invalid' });
    expect(at(gate, head, STATES['gate:P20p'])).toMatchObject({ ok: true });
  });

  it('an unsatisfied fold is `incomplete` with today\'s text', () => {
    const evaluation = { satisfied: false, phase: 'verifying' as const, satisfiedObligationIds: [],
      causes: [{ code: 'unreconciled_side_effect' as const, message: 'the task still holds a valid lease' }] };
    expect(at(work(FINAL_PASS), { evaluation })).toMatchObject({ ok: false, reason: 'guard_failed', code: 'incomplete',
      detail: `task ${T} is not satisfied (verifying): the task still holds a valid lease` });
    expect(at(work(FINAL_PASS), { evaluation: { ...evaluation, causes: [] } })).toMatchObject({
      detail: `task ${T} is not satisfied (verifying)` });
  });

  it('TASK-14 (§4.4, C5): the projection is verifying and the round is the selected Run\'s chain head', () => {
    // An older PASS never overtakes the latest failure or a blocked Task.
    for (const label of ['P6', 'P7', 'P17'] as const) {
      expect(at(work(FINAL_PASS), {}, STATES[label])).toEqual({ ok: false, reason: 'illegal', code: 'incomplete',
        detail: 'the task is failed; a PASS round cannot complete it' });
    }
    for (const label of ['P3', 'P8', 'P9', 'P10', 'P14', 'P15', 'P18'] as const) {
      expect(at(work(FINAL_PASS), {}, STATES[label])).toMatchObject({ ok: false, reason: 'illegal', code: 'incomplete' });
    }
    expect(at(work(FINAL_PASS), {}, STATES.P2)).toEqual({ ok: false, reason: 'guard_failed', code: 'incomplete',
      detail: 'the task is running; only a verifying task completes' });
    for (const label of ['P5', 'P16'] as const) {
      expect(at(work(FINAL_PASS), {}, STATES[label])).toMatchObject({ ok: false, reason: 'guard_failed', code: 'incomplete' });
    }
    // A round that is not the chain head (another round of the Run, or no chain) is refused before it is judged.
    for (const chainHead of [roundRef('round-2'), roundRef('round-1', 'run-0'), null]) {
      expect(at(work(FINAL_PASS), { chainHead })).toEqual({ ok: false, reason: 'guard_failed', code: 'incomplete',
        detail: 'the specified round is not the head of the selected Run round chain' });
    }
    // The projection comes before the round checks (a FAIL round on a failed Task is refused as failed).
    expect(at(work(FINAL_FAIL), {}, STATES.P7)).toMatchObject({ reason: 'illegal', detail: 'the task is failed; a PASS round cannot complete it' });
    // The exported guard is the same step.
    expect(taskCompletionProjectionProblem(STATES.P13 as TaskState, FINAL_PASS.ref, FINAL_PASS.ref)).toBeNull();
  });

  it('TASK-15 (C5, 5.9 part 2): a gate meets the same guards over its own chain head', () => {
    const gate: TaskEvent = { kind: 'task_completed', task: gateTask, round: GATE_PASS, reduction: REDUCTION_BUILD(gateTask) };
    // Before its chain a gate is pending (P16); a failed or blocked head never lets an older PASS through.
    expect(at(gate, { chainHead: null }, STATES['gate:P16'])).toEqual({ ok: false, reason: 'guard_failed', code: 'incomplete',
      detail: 'the task is pending; only a verifying task completes' });
    for (const label of ['gate:P20f', 'gate:P20i', 'gate:P20c', 'gate:P20x'] as const) {
      expect(at(gate, { chainHead: GATE_PASS.ref }, STATES[label])).toMatchObject({ ok: false, reason: 'illegal', code: 'incomplete' });
    }
    // The round must be the gate chain's head.
    expect(at(gate, { chainHead: roundRef('gate-round-2', 'run-1', GATE) }, STATES['gate:P20p'])).toEqual({ ok: false,
      reason: 'guard_failed', code: 'incomplete', detail: 'the specified round is not the head of the gate round chain' });
    expect(taskCompletionProjectionProblem({ taskKind: 'gate', phase: 'verifying' }, GATE_PASS.ref, GATE_PASS.ref)).toBeNull();
    expect(taskCompletionProjectionProblem({ taskKind: 'gate', phase: 'pending' }, GATE_PASS.ref, null))
      .toMatchObject({ ok: false, reason: 'guard_failed', code: 'incomplete' });
    // TASK-24: a satisfied gate completes again with its head.
    expect(at(gate, { chainHead: GATE_PASS.ref }, STATES['gate:P1'])).toMatchObject({ ok: true });
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

  it('the owner stops where the transition refuses: the round before its producer is read, the producer, then the fold', () => {
    const rounds = [FINAL_PASS, OPEN_PENDING, FINAL_FAIL, FINAL_PASS_GAPS, round('r', { ...FINAL_PASS, evidenceRefs: [] }),
      round('r', { ...FINAL_PASS, subject: gateTask })];
    const producers: RunSnapshot[] = [PRODUCER, RUNNING, ENDED_UNKNOWN, YIELDED_WAIT,
      { ...PRODUCER, ref: { ...PRODUCER.ref, goalId: 'other' } }, { ...PRODUCER, task: { ...task, taskId: 'other' } }];
    const evaluations = [SATISFIED, { satisfied: false, phase: 'blocked' as const, satisfiedObligationIds: [],
      causes: [{ code: 'missing_evidence' as const, message: 'required verification requirements have no applicable evidence yet' }] }];
    for (const passRound of rounds) {
      for (const producerRun of producers) {
        for (const evaluation of evaluations) {
          const transition = at(work(passRound), { producerRun, evaluation });
          const staged = taskCompletionRoundProblem({ task, taskKind: 'work', round: passRound, producerRun: null,
            producerTaskKind: null })
            ?? taskCompletionRoundProblem({ task, taskKind: 'work', round: passRound, producerRun, producerTaskKind: 'work' })
            ?? taskCompletionFoldProblem(T, evaluation);
          expect(staged === null ? null : { code: staged.code, detail: staged.reason })
            .toEqual(transition.ok ? null : { code: transition.code, detail: transition.detail });
        }
      }
    }
  });

  it('a producer not read yet holds; a satisfied fold has no problem', () => {
    expect(taskCompletionRoundProblem({ task, taskKind: 'work', round: FINAL_PASS, producerRun: null,
      producerTaskKind: null })).toBeNull();
    expect(taskCompletionRoundProblem({ task: gateTask, taskKind: 'gate', round: GATE_PASS, producerRun: null,
      producerTaskKind: null })).toBeNull();
    expect(taskCompletionRoundProblem({ task, taskKind: 'work', round: FINAL_FAIL, producerRun: null,
      producerTaskKind: null })).toEqual(rejection('incomplete', 'the specified round did not finalize as PASS'));
    expect(taskCompletionFoldProblem(T, SATISFIED)).toBeNull();
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

describe('disposition_changed (TASK-18 untraced, TASK-19 traced; C7, step 5.10)', () => {
  const change = (state: TaskMachineState, disposition: TaskDispositionFacts | null, to: TaskState['disposition'] = 'deferred',
    actorClass: 'human' | 'system' | 'agent' = 'agent', replacedByTaskId: string | null = null) =>
    transitionTask(state, { kind: 'disposition_changed', to, replacedByTaskId, actorClass },
      { ...ctxFor('P16'), disposition });
  /** P6's Run, cancelled through an operator's pointer intent (`reworkFenceOf = 'human_only'`). */
  const HUMAN_CANCEL: ControlIntentSnapshotV1 = { schemaVersion: 1, ref: intentRef('i-cancel'), runRef: runRef('run-1'),
    kind: 'cancel', desiredState: 'cancelled', reason: null, requestedAt: T_START, requestedBy: { kind: 'human', id: 'operator-1' },
    revision: 2, status: 'applied' } as ControlIntentSnapshotV1;
  const CANCELLED_BY_HUMAN = run('run-1', { outcome: 'cancelled', exitCode: null, ...pointer('cancelled', 'i-cancel') });
  const fenced = (): TracedTaskFactsV1 => ({ ...dispositionFactsFor('P6'), runs: [CANCELLED_BY_HUMAN],
    selectedRun: CANCELLED_BY_HUMAN, pointerIntent: HUMAN_CANCEL });

  it('TASK-19: a traced Task changes only its disposition; the phase and its cause stay (P7 failed/check_failed)', () => {
    expect(change(STATES.P7, dispositionCtx(dispositionFactsFor('P7')), 'superseded')).toEqual({ ok: true,
      next: { ...(STATES.P7 as TaskState), disposition: 'superseded' }, effects: DISPOSITION_EFFECTS });
  });

  it('TASK-19 guards (§3 tracedDispositionChangeProblem): listed, released, and a human stop only by a human', () => {
    expect(change(STATES.P6, dispositionCtx(dispositionFactsFor('P6'), { affectedTaskIds: [] }))).toMatchObject({
      ok: false, reason: 'guard_failed', code: 'invalid', detail: `reason.affectedTaskIds must list traced task ${T}` });
    expect(change(STATES.P6, dispositionCtx({ ...dispositionFactsFor('P6'), lease: leaseRecord(false) }))).toMatchObject({
      ok: false, reason: 'guard_failed', code: 'busy', detail: `task ${T} still holds its TaskLease` });
    expect(change(STATES.P6, dispositionCtx(fenced()), 'cancelled', 'agent')).toMatchObject({ ok: false, reason: 'guard_failed',
      code: 'forbidden', detail: `only an operator may change the disposition of task ${T}: a human paused or cancelled it` });
    expect(change(STATES.P6, dispositionCtx(fenced()), 'cancelled', 'system')).toMatchObject({ ok: false, code: 'forbidden' });
    expect(change(STATES.P6, dispositionCtx(fenced()), 'cancelled', 'human')).toMatchObject({ ok: true,
      effects: DISPOSITION_EFFECTS });
  });

  it('a cancelled Goal is refused first (guard 8, §4.4 guard_failed/invalid); a paused one is not a reason', () => {
    expect(change(STATES.P2, dispositionCtx(dispositionFactsFor('P2'), { goalDesiredState: 'cancelled' }))).toMatchObject({
      ok: false, reason: 'guard_failed', code: 'invalid', detail: 'the Goal is cancelled; its plan can no longer change' });
    expect(change(STATES.P16, dispositionCtx(dispositionFactsFor('P16'), { goalDesiredState: 'cancelled' })))
      .toMatchObject({ ok: false, code: 'invalid' });
    expect(change(STATES.P6, dispositionCtx(dispositionFactsFor('P6'), { goalDesiredState: 'paused' })).ok).toBe(true);
  });

  it('TASK-18: a deferred untraced Task is reactivated and recorded; the same disposition is no change', () => {
    const deferred: TaskState = { ...(STATES.P16 as TaskState), disposition: 'deferred' };
    expect(change(deferred, dispositionCtx(dispositionFactsFor('P16')), 'active')).toEqual({ ok: true, next: STATES.P16,
      effects: DISPOSITION_EFFECTS });
    expect(change(deferred, dispositionCtx(dispositionFactsFor('P16')), 'deferred'))
      .toMatchObject({ ok: false, reason: 'illegal', code: 'invalid' });
  });

  it('a superseded Task may name a new replacement (recorded, §3.3 "disposition 或 replacedByTaskId"); the same one is no change', () => {
    const superseded: TaskState = { ...(STATES.P7 as TaskState), disposition: 'superseded' };
    const facts = dispositionCtx(dispositionFactsFor('P7'), { replacedByTaskId: 'work-2' });
    expect(change(superseded, facts, 'superseded', 'human', 'work-3')).toEqual({ ok: true, next: superseded,
      effects: DISPOSITION_EFFECTS });
    expect(change(superseded, facts, 'superseded', 'human', 'work-2')).toMatchObject({ ok: false, reason: 'illegal', code: 'invalid',
      detail: 'the disposition is already superseded' });
  });

  it('a gate is refused before its facts, and the facts are required', () => {
    expect(change(STATES['gate:P1'], dispositionCtx(dispositionFactsFor('gate:P1')), 'cancelled')).toMatchObject({ code: 'invalid',
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

  it('TASK-08: an unknown end resolved by late evidence or an attestation re-projects like any end', () => {
    expect(transitionTask(STATES.P3, EVENTS['run_ended:crashed']('work'), ctxFor('P3')))
      .toEqual({ ok: true, next: STATES.P6, effects: [] });
    expect(transitionTask(STATES.P3, EVENTS['run_ended:completed']('work'), ctxFor('P3')))
      .toEqual({ ok: true, next: STATES.P11, effects: [] });
  });

  it('TD-5 (TASK-21..23): P5 → P18 by a pause, P5/P18 → P17 by a cancel, P18 → P5 by a resume', () => {
    expect(transitionTask(STATES.P2, EVENTS['run_ended:yielded:pointer']('work'), ctxFor('P2')))
      .toEqual({ ok: true, next: STATES.P18, effects: [] });
    expect(transitionTask(STATES.P5, EVENTS['control:pause:yielded']('work'), ctxFor('P5')))
      .toEqual({ ok: true, next: STATES.P18, effects: [] });
    expect(transitionTask(STATES.P18, EVENTS['control:cancel:yielded']('work'), ctxFor('P18')))
      .toEqual({ ok: true, next: STATES.P17, effects: [] });
    expect(transitionTask(STATES.P18, EVENTS['control:resume:yielded']('work'), ctxFor('P18')))
      .toEqual({ ok: true, next: STATES.P5, effects: [] });
  });

  it('TASK-29 and TASK-30 re-project; the requeue rows need the owner rework facts', () => {
    const detail = (label: StateLabel, event: EventLabel): unknown => {
      const result = transitionTask(STATES[label], EVENTS[event](isGate(label) ? 'gate' : 'work'), ctxFor(label));
      return result.ok ? null : result.detail;
    };
    // TASK-29 (5.9): a failed or inconclusive work Task re-projects to the open successor (P12, no effect).
    expect(transitionTask(STATES.P7, EVENTS.round_reverified('work'), ctxFor('P7')))
      .toEqual({ ok: true, next: STATES.P12, effects: [] });
    expect(transitionTask(STATES.P8, EVENTS.round_reverified('work'), ctxFor('P8')))
      .toEqual({ ok: true, next: STATES.P12, effects: [] });
    // TASK-30 (5.9 part 2): a gate's root opening makes it verifying; a successor on its chain moves a failed
    // or inconclusive gate back to verifying with the ordinal; a round that is not the head is history.
    expect(transitionTask(STATES['gate:P16'], EVENTS.round_opened('gate'), ctxFor('gate:P16')))
      .toEqual({ ok: true, next: STATES['gate:P20o'], effects: [] });
    for (const label of ['gate:P20f', 'gate:P20i'] as const) {
      expect(transitionTask(STATES[label], EVENTS.round_reverified('gate'), ctxFor(label)))
        .toEqual({ ok: true, next: stateOf('gate', P20.succOpen), effects: [] });
    }
    const older = transitionTask(STATES['gate:P20f'], EVENTS['round_finalized:older_run']('gate'), ctxFor('gate:P20f'));
    expect(older).toEqual({ ok: true, next: STATES['gate:P20f'], effects: [] });
    expect(detail('gate:P20c', 'round_finalized:PASS')).toMatch(/interrupted check is a gap/);
    // 5.4: the requeue rows are open; without the owner's rework facts they refuse.
    expect(detail('P7', 'task_requeued')).toBe('task_requeued requires the rework guard facts');
    expect(detail('P7', 'task_rework_refused')).toBe('task_rework_refused requires the rework guard facts');
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
    policy: { autoReworkLimit: 3 }, ...patch };
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
        automation: { automatic: true, counted: true, autoCount: 2, cap: 3 }, historySource: null }] }));
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

  it('the history source is derived: Kernel entry, else the requeueRef record (one hop), else none (I-12 clause 10)', () => {
    const entered = run('run-1', { outcome: 'crashed', exitCode: null, executionHistory: { schemaVersion: 1, sessionRef,
      kernel: { adapterId: 'adapter-1', kernelSessionId: 'ks-1', runId: 'k-run-1', turnId: 'turn-1' },
      startPosition: 0, observedThroughPosition: 4, endPosition: 4 } });
    expect(newTaskRequeueRecord(requeueInput({ afterRun: entered })))
      .toMatchObject({ historySource: HISTORY_SOURCE });
    const notEnteredRequeued = run('run-1', { outcome: 'cancelled', exitCode: null, ...pointer('cancelled'),
      requeueRef: { ...requeueRef, afterRunId: 'run-0' } });
    const earlier = { ref: { ...requeueRef, afterRunId: 'run-0' },
      automation: { automatic: false, counted: false, autoCount: 0, cap: null }, historySource: HISTORY_SOURCE };
    expect(newTaskRequeueRecord(requeueInput({ afterRun: notEnteredRequeued, pointerIntent: stopIntent('cancel', operator),
      basis: keyOf('cancelled'), requeues: [earlier] }))).toMatchObject({ historySource: HISTORY_SOURCE });
    // The requeueRef record not read in the window: no source rather than a guessed one.
    expect(newTaskRequeueRecord(requeueInput({ afterRun: notEnteredRequeued, pointerIntent: stopIntent('cancel', operator),
      basis: keyOf('cancelled') }))).toMatchObject({ historySource: null });
    expect(newTaskRequeueRecord(requeueInput())).toMatchObject({ historySource: null });
  });

  const HUMAN_CANCELLED = { ...CANCELLED, ...pointer('cancelled') };
  const FAN_OUT_PAUSED = { afterRun: PAUSED_INTERRUPTED, pointerIntent: stopIntent('pause', GOAL_FAN_OUT_ACTOR, 'i-pause') };
  const OVER_CAP: Partial<NewTaskRequeueInput> = {
    afterRun: run('run-1', { outcome: 'crashed', exitCode: null, requeueRef: { ...requeueRef, afterRunId: 'run-0' } }),
    requestedBy: WORKFLOW_AUTOMATION_ACTOR,
    requeues: [{ ref: { ...requeueRef, afterRunId: 'run-0' }, automation: { automatic: true, counted: true, autoCount: 3, cap: 3 },
      historySource: null }],
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

// ------------------------------------------------------------------------ //
// task_requeued (TASK-16/17/27) and task_rework_refused (TASK-28), step 5.4  //
// ------------------------------------------------------------------------ //

describe('task_requeued and task_rework_refused in the unified order (§4.3, §4.4; 5.4)', () => {
  const reworkFacts = (patch: Partial<TaskReworkFacts> = {}): TaskReworkFacts => ({ selectedRun: CRASHED,
    afterRunIsSelected: true, chain: { kind: 'none' }, basisResolved: true, goalDesiredState: 'active', priorBasisDigests: [],
    ...patch });
  const requeueAt = (state: TaskMachineState, factsPatch: Partial<TaskReworkFacts> = {},
    inputPatch: Partial<NewTaskRequeueInput> = {}) => transitionTask(state, { kind: 'task_requeued', requeue: requeueInput(inputPatch) },
    { ...ctxFor('P6'), rework: reworkFacts(factsPatch) });
  type RefusedEvent = Extract<TaskEvent, { kind: 'task_rework_refused' }>;
  const refusedAt = (state: TaskMachineState, factsPatch: Partial<TaskReworkFacts> = {},
    event: RefusedEvent = { kind: 'task_rework_refused', refusal: CAP_REFUSAL, pointerIntent: null }) =>
    transitionTask(state, event, { ...ctxFor('P6'), rework: reworkFacts(factsPatch) });
  const answerOf = (result: ReturnType<typeof transitionTask>) => result.ok ? 'ok' : { reason: result.reason, code: result.code };

  it('TASK-16: a human requeue of a crashed Run writes TaskRequeue@1 and projects P4 pending(requeued)', () => {
    expect(requeueAt(STATES.P6)).toEqual({ ok: true, next: STATES.P4,
      effects: [{ kind: 'write_task_requeue', requeue: newTaskRequeueRecord(requeueInput()) }] });
  });

  it('TASK-16: a FAIL head (P7) and a cancelled continuation (P17); TASK-17: only a human requeues round_inconclusive (P8)', () => {
    const failChain = roundChainHead([FINAL_FAIL]);
    expect(requeueAt(STATES.P7, { selectedRun: COMPLETED, chain: failChain },
      { afterRun: COMPLETED, chain: failChain, basis: keyOf('completed') })).toMatchObject({ ok: true, next: STATES.P4 });
    expect(requeueAt(STATES.P17, { selectedRun: YIELDED_CANCELLED }, { afterRun: YIELDED_CANCELLED,
      pointerIntent: stopIntent('cancel', operator), basis: keyOf('yielded') })).toMatchObject({ ok: true, next: STATES.P4 });
    const inconclusive = roundChainHead([FINAL_INCONCLUSIVE]);
    const p8 = (requestedBy: ActorRef) => requeueAt(STATES.P8, { selectedRun: COMPLETED, chain: inconclusive },
      { afterRun: COMPLETED, chain: inconclusive, basis: keyOf('completed'), requestedBy });
    expect(p8(operator)).toMatchObject({ ok: true, next: STATES.P4 });
    // C2: check_incomplete goes to a successor round for the automation.
    expect(answerOf(p8(WORKFLOW_AUTOMATION_ACTOR))).toEqual({ reason: 'illegal', code: 'invalid' });
  });

  it('§4.4: the state preconditions and the Goal rule, first match wins (shared by TASK-28)', () => {
    const rows: Array<[string, TaskMachineState, Partial<TaskReworkFacts>, { reason: string; code: CoreError }]> = [
      ['a gate (before the Run check)', STATES['gate:P16'], { selectedRun: null }, { reason: 'illegal', code: 'invalid' }],
      ['no selected Run (P16)', STATES.P16, { selectedRun: null }, { reason: 'stale', code: 'revision_conflict' }],
      ['no selected Run (P15)', STATES.P15, { selectedRun: null }, { reason: 'stale', code: 'revision_conflict' }],
      ['another Run than the selected one', STATES.P6, { afterRunIsSelected: false }, { reason: 'stale', code: 'revision_conflict' }],
      ['a running Run (P2)', STATES.P2, { selectedRun: RUNNING }, { reason: 'guard_failed', code: 'busy' }],
      ['an unknown outcome (P3)', STATES.P3, { selectedRun: ENDED_UNKNOWN }, { reason: 'guard_failed', code: 'busy' }],
      ['an invalid chain (P10)', STATES.P10, { selectedRun: COMPLETED, chain: roundChainHead(TWO_ROOTS) },
        { reason: 'guard_failed', code: 'incomplete' }],
      ['an open head (P9)', STATES.P9, { selectedRun: COMPLETED, chain: roundChainHead([OPEN_INTERRUPTED]) },
        { reason: 'guard_failed', code: 'busy' }],
      ['an open head (P12)', STATES.P12, { selectedRun: COMPLETED, chain: roundChainHead([OPEN_PENDING]) },
        { reason: 'guard_failed', code: 'busy' }],
      ['a clean PASS head on a crashed Run (I-12 clause 2)', STATES.P6, { chain: roundChainHead([FINAL_PASS]) },
        { reason: 'illegal', code: 'invalid' }],
      ['a paused continuation (P18)', STATES.P18, { selectedRun: YIELDED_PAUSED }, { reason: 'guard_failed', code: 'busy' }],
      ['satisfied (P1)', STATES.P1, { selectedRun: COMPLETED, chain: roundChainHead([FINAL_PASS]) },
        { reason: 'illegal', code: 'invalid' }],
      ['ready (P5)', STATES.P5, { selectedRun: YIELDED_WAIT }, { reason: 'illegal', code: 'invalid' }],
      ['a bare yield (P14)', STATES.P14, { selectedRun: YIELDED_BARE }, { reason: 'illegal', code: 'invalid' }],
      ['awaiting verification (P11)', STATES.P11, { selectedRun: COMPLETED }, { reason: 'guard_failed', code: 'busy' }],
      ['awaiting completion (P13)', STATES.P13, { selectedRun: COMPLETED, chain: roundChainHead([FINAL_PASS]) },
        { reason: 'guard_failed', code: 'busy' }],
      ['a non-active disposition', { ...(STATES.P6 as TaskState), disposition: 'deferred' }, {},
        { reason: 'guard_failed', code: 'invalid' }],
      ['an unresolvable basis', STATES.P6, { basisResolved: false }, { reason: 'guard_failed', code: 'incomplete' }],
      ['already requeued (P4)', STATES.P4, {}, { reason: 'stale', code: 'revision_conflict' }],
      ['a paused Goal', STATES.P6, { goalDesiredState: 'paused' }, { reason: 'guard_failed', code: 'busy' }],
      ['a cancelled Goal', STATES.P6, { goalDesiredState: 'cancelled' }, { reason: 'guard_failed', code: 'busy' }],
    ];
    for (const [name, state, patch, expected] of rows) {
      expect(answerOf(requeueAt(state, patch)), name).toEqual(expected);
      // TASK-28 shares the state preconditions and the Goal rule.
      expect(answerOf(refusedAt(state, patch)), `${name} (refusal)`).toEqual(expected);
    }
    expect(requeueAt(STATES.P9, { selectedRun: COMPLETED, chain: roundChainHead([OPEN_INTERRUPTED]) }))
      .toMatchObject({ detail: expect.stringMatching(/^finalize_first: /) });
    expect(requeueAt(STATES.P6, { goalDesiredState: 'paused' })).toMatchObject({ detail: expect.stringContaining('resume the Goal first') });
    expect(requeueAt(STATES.P6)).toMatchObject({ ok: true });
    expect(transitionTask(STATES.P6, { kind: 'task_requeued', requeue: requeueInput() }, ctxFor('P6')))
      .toMatchObject({ ok: false, reason: 'illegal', code: 'invalid', detail: 'task_requeued requires the rework guard facts' });
    expect(transitionTask(null, { kind: 'task_requeued', requeue: requeueInput() }, ctxFor('absent')))
      .toMatchObject({ ok: false, reason: 'illegal', code: 'not_found' });
  });

  it('the input must carry the selected Run; the matrix with the fence and TASK-27 follow', () => {
    expect(requeueAt(STATES.P6, {}, { afterRun: run('run-2', { outcome: 'crashed', exitCode: null }) }))
      .toMatchObject({ ok: false, reason: 'illegal', code: 'invalid', detail: 'the requeue input does not carry the selected Run' });
    // Hard limit 3: the Workflow never requeues a human cancel.
    const humanCancelled = { ...CANCELLED, ...pointer('cancelled') };
    expect(answerOf(requeueAt(STATES.P6, { selectedRun: humanCancelled }, { afterRun: humanCancelled, basis: keyOf('cancelled'),
      pointerIntent: stopIntent('cancel', operator), requestedBy: WORKFLOW_AUTOMATION_ACTOR })))
      .toEqual({ reason: 'guard_failed', code: 'forbidden' });
    // TASK-27 (C4, step 5.6): an operator continues a paused-interrupted Run.
    expect(requeueAt(STATES.P6, { selectedRun: PAUSED_INTERRUPTED }, { afterRun: PAUSED_INTERRUPTED,
      pointerIntent: stopIntent('pause', operator, 'i-pause') })).toMatchObject({ ok: true, next: STATES.P4 });
  });

  it('a request that fails G-BUDGET, G-CAP or G-BASIS is a TASK-28 refusal, never a requeue', () => {
    const exhausted = run('run-1', { outcome: 'budget_exhausted', exitCode: null });
    expect(requeueAt(STATES.P6, { selectedRun: exhausted }, { afterRun: exhausted, basis: keyOf('budget_exhausted') }))
      .toMatchObject({ ok: false, reason: 'illegal', code: 'invalid', detail: expect.stringMatching(/^budget_not_increased /) });
    // A larger budget passes G-BUDGET.
    expect(requeueAt(STATES.P6, { selectedRun: exhausted }, { afterRun: exhausted, basis: keyOf('budget_exhausted'),
      budget: { tokenBudget: 2000, deadline: null } })).toMatchObject({ ok: true });
    const counted = run('run-1', { outcome: 'crashed', exitCode: null, requeueRef: { ...requeueRef, afterRunId: 'run-0' } });
    expect(requeueAt(STATES.P6, { selectedRun: counted }, { afterRun: counted, requestedBy: WORKFLOW_AUTOMATION_ACTOR,
      requeues: [{ ref: { ...requeueRef, afterRunId: 'run-0' }, automation: { automatic: true, counted: true, autoCount: 3, cap: 3 },
        historySource: null }] }))
      .toMatchObject({ ok: false, reason: 'illegal', code: 'invalid', detail: expect.stringMatching(/^auto_rework_cap_reached /) });
    expect(requeueAt(STATES.P6, { priorBasisDigests: [keyOf('crashed').digest] }))
      .toMatchObject({ ok: false, reason: 'illegal', code: 'invalid', detail: expect.stringMatching(/^no_new_basis /) });
    // ND-6: a human requeue of a human cancel skips the key, so an earlier equal key does not refuse it.
    const humanCancelled = { ...CANCELLED, ...pointer('cancelled') };
    expect(requeueAt(STATES.P6, { selectedRun: humanCancelled, priorBasisDigests: [keyOf('cancelled').digest] },
      { afterRun: humanCancelled, basis: keyOf('cancelled'), pointerIntent: stopIntent('cancel', operator) })).toMatchObject({ ok: true });
  });

  it('TASK-28: the refusal keeps the phase and writes TaskReworkRefusal; keyed by the selected Run; never class interrupted', () => {
    expect(refusedAt(STATES.P6)).toEqual({ ok: true, next: STATES.P6,
      effects: [{ kind: 'write_task_rework_refusal', refusal: CAP_REFUSAL }] });
    expect(refusedAt(STATES.P6, { selectedRun: run('run-2', { outcome: 'crashed', exitCode: null }) }))
      .toMatchObject({ ok: false, reason: 'illegal', code: 'invalid', detail: 'the refusal is not keyed by the selected Run' });
    expect(refusedAt(STATES.P6, {}, { kind: 'task_rework_refused', refusal: { ...CAP_REFUSAL, failureClass: 'interrupted' },
      pointerIntent: null })).toMatchObject({ ok: false, reason: 'illegal', code: 'invalid' });
    // A reverify refusal is decided by the round side with its successor (§9 VR-14, step 5.9), never here.
    expect(refusedAt(STATES.P6, {}, { kind: 'task_rework_refused',
      refusal: { ...CAP_REFUSAL, ref: { ...CAP_REFUSAL.ref, operation: 'reverify' } }, pointerIntent: null }))
      .toMatchObject({ ok: false, reason: 'illegal', code: 'invalid',
        detail: 'a reverify refusal is decided with its successor round (§9 VR-14), not by the Task machine' });
    expect(transitionTask(STATES.P6, { kind: 'task_rework_refused', refusal: CAP_REFUSAL, pointerIntent: null }, ctxFor('P6')))
      .toMatchObject({ ok: false, reason: 'illegal', code: 'invalid', detail: 'task_rework_refused requires the rework guard facts' });
  });

  /** A requeue refusal of run-1 (TASK-28) with the given class, code and requester. */
  const refusalOf = (patch: Partial<Parameters<typeof newTaskReworkRefusalRecord>[0]>) => newTaskReworkRefusalRecord({
    current: null, ref: CAP_REFUSAL.ref, task, afterRunRef: runRef('run-1'), subjectRoundRef: null, failureClass: 'run_failed',
    code: 'budget_not_increased', reason: 'policy refusal', basisDigest: null, source: null, matchedRequeueRef: null,
    requestedBy: operator, refusedAt: T_LATER, goalEndedRunsAtRefusal: 1, configurationRevision: null, ...patch });
  const refused = (refusal: TaskReworkRefusalSnapshotV1, pointerIntent: RefusedEvent['pointerIntent'] = null): RefusedEvent =>
    ({ kind: 'task_rework_refused', refusal, pointerIntent });

  it('TASK-28 judges the refusal like the requeue: the pointer intent, the class, the matrix with the fence', () => {
    // The pointer intent must be the selected Run's own.
    expect(refusedAt(STATES.P6, {}, refused(CAP_REFUSAL, stopIntent('cancel', operator))))
      .toMatchObject({ ok: false, reason: 'illegal', code: 'invalid', detail: 'the pointer intent is not the selected Run pointer' });
    // The class is re-derived from the selected Run (FC-9 run_failed for a crashed Run).
    expect(refusedAt(STATES.P6, {}, refused({ ...CAP_REFUSAL, failureClass: 'check_failed' })))
      .toMatchObject({ ok: false, reason: 'illegal', code: 'invalid', detail: expect.stringMatching(/is not the selected Run's class run_failed$/) });
    // Hard limit 3: a human cancel fences the Workflow's cap refusal as it fences its requeue.
    const humanCancelled = { ...CANCELLED, ...pointer('cancelled') };
    const cancelCap = refusalOf({ failureClass: 'cancelled', code: 'auto_rework_cap_reached', requestedBy: WORKFLOW_AUTOMATION_ACTOR });
    expect(answerOf(refusedAt(STATES.P6, { selectedRun: humanCancelled }, refused(cancelCap, stopIntent('cancel', operator)))))
      .toEqual({ reason: 'guard_failed', code: 'forbidden' });
    // A platform cancel is not fenced: the same cap refusal commits.
    expect(refusedAt(STATES.P6, { selectedRun: humanCancelled }, refused(cancelCap, stopIntent('cancel', WORKFLOW_AUTOMATION_ACTOR))))
      .toMatchObject({ ok: true, next: STATES.P6 });
  });

  it('TASK-28: the refusal code fits the facts (G-BUDGET after budget_exhausted, G-BASIS for an equal compared key)', () => {
    const exhausted = run('run-1', { outcome: 'budget_exhausted', exitCode: null });
    const budget = refusalOf({});
    expect(refusedAt(STATES.P6, { selectedRun: exhausted }, refused(budget))).toMatchObject({ ok: true, next: STATES.P6 });
    expect(refusedAt(STATES.P6, {}, refused(budget))).toMatchObject({ ok: false, reason: 'illegal', code: 'invalid',
      detail: 'budget_not_increased refuses only the requeue of a budget_exhausted Run' });
    const key = keyOf('crashed');
    const noNewBasis = refusalOf({ code: 'no_new_basis', basisDigest: key.digest, source: key.source,
      matchedRequeueRef: { ...requeueRef, afterRunId: 'run-0' } });
    expect(refusedAt(STATES.P6, { priorBasisDigests: [key.digest] }, refused(noNewBasis))).toMatchObject({ ok: true, next: STATES.P6 });
    const noMatch = { ok: false, reason: 'illegal', code: 'invalid',
      detail: 'no_new_basis refuses only a compared key equal to an earlier TaskRequeue key' };
    expect(refusedAt(STATES.P6, { priorBasisDigests: [sha('9')] }, refused(noNewBasis))).toMatchObject(noMatch);
    // ND-6: a human requeue of a human cancel never compares its key, so it is never no_new_basis.
    const humanCancelled = { ...CANCELLED, ...pointer('cancelled') };
    const cancelKey = keyOf('cancelled');
    expect(refusedAt(STATES.P6, { selectedRun: humanCancelled, priorBasisDigests: [cancelKey.digest] },
      refused(refusalOf({ failureClass: 'cancelled', code: 'no_new_basis', basisDigest: cancelKey.digest, source: cancelKey.source,
        matchedRequeueRef: { ...requeueRef, afterRunId: 'run-0' } }), stopIntent('cancel', operator)))).toMatchObject(noMatch);
  });
});
