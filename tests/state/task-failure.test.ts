/**
 * A.2 step 2 (spec §15.2 第 2 步): `state/task-failure.ts`, the §4 TD-8/TD-9
 * tables and the C1 failure-facts read model (§4.6 plan for this file).
 *
 * - `stopRequesterOf` / `reworkStopOf` / `reworkFenceOf` over every pointer
 *   kind × requester × paused-interrupted (§1.3, §11 `fence(r)`).
 * - FC-1..FC-17: one case per row, the row order (FC-1 before FC-2, FC-2 before
 *   FC-3, FC-6 before FC-9, FC-13 before FC-14), the three `runUnresolvedBlocker`
 *   cases of FC-2, FC-8 for RUN-23 and for a human pause pointer, and a sweep of
 *   every outcome × chain head.
 * - `reworkPermission`: the §4.3 matrix written out as a literal table
 *   ×{human, Workflow, agent, Goal fan-out with/without trigger}×Goal{active,
 *   paused, cancelled}×fence, the request-field rows of §4.4, and an exhaustive
 *   sweep of every input combination against the §1.2 reason/code pairs.
 * - `priorRequeueAutoCount` / `nextRequeueAutoCount` (human resets,
 *   `interrupted` does not count, `consumedWait` keeps the chain);
 *   `countEndedGoalRuns` never filters; refusal staleness (ND-7, LA-4).
 * - AV-0..AV-12 with AV-7a..AV-7d and GV-0..GV-10 with GV-3′: one case per row,
 *   row order, the cap-0 / lowered-cap / stale-refusal / budget cases and the
 *   AV-7c / GV-8 code filters.
 * - `buildTaskFailureFacts`: when `failure` / `rework` appear, the full facts
 *   of a check FAIL, a crash, a budget exhaustion, a human cancel, RUN-19 and
 *   RUN-24, `requeueActors`/`reverifyActors` intersected with the state
 *   preconditions, the source verdict and `rework.entries` in Run-chain order.
 * - `newTaskReworkRefusalRecord`: ∅→@1, @k→@k+1, contract key order, and every
 *   illegal combination refused (I-18); the TASK-28 / VR-14 refusal effects.
 *
 * Pure: no RecordStore, no kernel, no clock.
 */
import { describe, expect, it } from 'vitest';
import type { ActorRef } from '../../src/contracts/command-event.js';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { ControlIntentKindV1, ControlIntentSnapshotV1 } from '../../src/contracts/control-intent.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type {
  RoleBindingRefV1, RunOutcome, RunReconciliationV1, RunRef, RunSnapshot, RuntimeEventV1, TaskTriple,
} from '../../src/contracts/dispatch.js';
import type { EvidenceOutcome } from '../../src/contracts/evidence.js';
import type { GoalDesiredState } from '../../src/contracts/ledger.js';
import type { NoProgressKeyV1 } from '../../src/contracts/no-progress.js';
import type { PlanRevisionRef } from '../../src/contracts/plan.js';
import type { TaskAutomationVerdictV1, TaskFailureFactsV1 } from '../../src/contracts/task-failure.js';
import {
  DEFAULT_TASK_AUTOMATION_POLICY, GOAL_FAN_OUT_ACTOR, TASK_REWORK_REASON_MAX_CHARS, WORKFLOW_AUTOMATION_ACTOR,
  type ReworkActorClass, type ReworkFailureClass, type TaskAutomationPolicyV1, type TaskRequeueRef,
  type TaskRequeueSnapshotV1, type TaskReworkOperation, type TaskReworkRefusalCode, type TaskReworkRefusalSnapshotV1,
} from '../../src/contracts/task-requeue.js';
import {
  ROUND_CHAIN_MAX, type RoundChainV1, type RoundCheckIncompleteCause, type RoundCheckSnapshot, type RoundSnapshot,
  type VerificationRoundRef,
} from '../../src/contracts/verification.js';
import type { VerificationRoundMaterialIdentity } from '../../src/contracts/verification-context.js';
import {
  REWORK_ACTOR_CLASSES, automationVerdict, buildTaskFailureFacts, countEndedGoalRuns, deriveReworkClass,
  newTaskReworkRefusalRecord, nextRequeueAutoCount, priorRequeueAutoCount, reworkFenceOf, reworkPermission,
  reworkRefusalIsStale, reworkStopOf, runErrorOf, stopRequesterOf, taskReworkRefusalEffects,
  type GateFailureInputV1, type NewTaskReworkRefusalInputV1, type ReworkFence,
  type ReworkPermissionInputV1, type StopIntentV1, type WorkFailureInputV1,
} from '../../src/core/work-graph/state/task-failure.js';
import { reverifyExemption, roundChainHead, type RoundChainHeadV1 } from '../../src/core/work-graph/state/verification-machine.js';

/** The FC row names (moved from `task-failure.ts` in A.2 step 4: `ReworkClassDerivationV1` spells its rows inline). */
type ReworkClassRow =
  | 'FC-1' | 'FC-2' | 'FC-3' | 'FC-4' | 'FC-5' | 'FC-6' | 'FC-7' | 'FC-8' | 'FC-9'
  | 'FC-10' | 'FC-11' | 'FC-12' | 'FC-13' | 'FC-14' | 'FC-15' | 'FC-16' | 'FC-17';

// ------------------------------------------------------------------------ //
// Fixtures                                                                  //
// ------------------------------------------------------------------------ //
const P = 'tf-project', G = 'tf-goal', T = 'tf-task', W = 'tf-workspace';
const sha = (char: string): string => char.repeat(64);
const time = (second: number): string => `2026-10-04T03:00:${String(second).padStart(2, '0')}.000Z`;
const task: TaskTriple = { projectId: P, goalId: G, taskId: T };
const PLAN: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: P, planId: 'plan-1' };
const ROLE: RoleBindingRefV1 = {
  schemaVersion: 1, bindingId: 'binding-1', templateId: 'worker', templateRevision: 'r1', bindingVersion: 1, policyRevision: 'policy-1',
};
const SESSION: SessionRef = { projectId: P, sessionId: 'session-1' };
const runRef = (runId: string): RunRef => ({ aggregateType: 'Run', projectId: P, goalId: G, runId });
const roundRef = (roundId: string, runId = 'run-1'): VerificationRoundRef =>
  ({ aggregateType: 'VerificationRound', projectId: P, workspaceId: W, goalId: G, taskId: T, runId, roundId });

type HostActor = Extract<ActorRef, { kind: 'human' | 'system' }>;
const HUMAN: HostActor = { kind: 'human', id: 'operator-1' };
/** A Host started with a `kind:'system'` actor is still an operator (TD-6). */
const HOST_SYSTEM: HostActor = { kind: 'system', id: 'host:operator' };
const WORKFLOW: HostActor = { ...WORKFLOW_AUTOMATION_ACTOR };
const FAN_OUT: HostActor = { ...GOAL_FAN_OUT_ACTOR };
const AGENT: ActorRef = { kind: 'agent', id: 'agent-1', runRef: runRef('run-agent') };

const POLICY: TaskAutomationPolicyV1 = { ...DEFAULT_TASK_AUTOMATION_POLICY };
const policy = (autoReworkLimit: number): TaskAutomationPolicyV1 => ({ ...POLICY, autoReworkLimit });

function runOf(runId: string, over: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    ref: runRef(runId), revision: 4, schemaVersion: 1, task: { ...task }, attemptId: `${runId}-attempt`, planRef: PLAN,
    roleBinding: ROLE, budget: { tokenBudget: 1000, deadline: null }, workspaceSnapshot: { workspaceId: W, revision: 1 },
    status: 'ended', outcome: 'completed', exitCode: 0, lastEventSeq: 2, lastRuntimeEventId: `rt-${runId}`,
    lastFactEventId: `ev-${runId}`, envelope: null, startedAt: time(1), endedAt: time(5), ...over,
  };
}
const ended = (runId: string, outcome: RunOutcome, over: Partial<RunSnapshot> = {}): RunSnapshot =>
  runOf(runId, { outcome, exitCode: outcome === 'completed' ? 0 : null, ...over });

function intentOf(intentId: string, kind: ControlIntentKindV1, requestedBy: HostActor, runId = 'run-1'): ControlIntentSnapshotV1 {
  const desiredState = kind === 'pause' ? 'paused' : kind === 'cancel' ? 'cancelled' : kind === 'resume' ? 'running' : 'steered';
  return { schemaVersion: 1, ref: { aggregateType: 'ControlIntent', projectId: P, workspaceId: W, intentId },
    runRef: runRef(runId), kind, desiredState, reason: null, requestedAt: time(3), requestedBy, revision: 1, status: 'queued' };
}
/** The Run's `controlState` naming `intent` (the pointer). */
const pointing = (intent: ControlIntentSnapshotV1): Pick<RunSnapshot, 'controlState'> =>
  ({ controlState: { intentRef: intent.ref, desiredState: intent.desiredState } });

const runtimeEvent = (runId: string, payload: RuntimeEventV1['payload']): RuntimeEventV1 => ({
  eventType: payload.kind === 'crashed' ? 'run_crashed' : payload.kind === 'cancelled' ? 'run_cancelled' : 'run_completed',
  schemaVersion: 1, eventId: `rt-${runId}-end`, runRef: runRef(runId), sequence: 7, occurredAt: time(4), payload,
});
const reconciliation = (observation: RunReconciliationV1['observation'], status: RunReconciliationV1['status'] = 'done'): RunReconciliationV1 =>
  ({ status, observation, basis: { kind: 'live_clean' }, recordedAt: time(5) });
/** RUN-19 (pause null) and RUN-24 (paused-interrupted): synthesized `crashed`. */
function hostInterrupted(runId: string, pause: ControlIntentSnapshotV1 | null): RunSnapshot {
  return ended(runId, 'crashed', {
    ...(pause === null ? {} : pointing(pause)),
    reconciliation: reconciliation({ kind: 'interrupted_clean', event: runtimeEvent(runId, { kind: 'crashed', error: 'host_interrupted' }),
      lastPosition: 4, kernelPaused: pause !== null, pausedIntentRef: pause === null ? null : pause.ref }),
    terminalPayload: { kind: 'crashed', error: 'host_interrupted' },
  });
}
/** RUN-23: a queued cancel on a clean Turn at restart, synthesized `cancelled`. */
function reconcileCancelled(runId: string, cancel: ControlIntentSnapshotV1): RunSnapshot {
  return ended(runId, 'cancelled', { ...pointing(cancel),
    reconciliation: reconciliation({ kind: 'interrupted_clean', event: runtimeEvent(runId, { kind: 'cancelled', reason: 'cancel requested' }),
      lastPosition: 4, kernelPaused: false, pausedIntentRef: null }) });
}
const humanAttested = (runId: string): RunSnapshot => ended(runId, 'crashed', {
  reconciliation: reconciliation({ kind: 'human_attested', attestedBy: HUMAN, reason: 'machine lost' }),
  terminalPayload: { kind: 'crashed', error: 'human_attested: machine lost' },
});
/** Two runUnresolvedBlocker cases on a completed Run that carry no quarantined reconciliation (hard limit 1). */
const authUnknownRun = (runId: string): RunSnapshot => ended(runId, 'completed', { executionAuthorization: { schemaVersion: 2,
  generation: 1, sessionGeneration: 2, revision: 3, consumerId: 'c', inputDigest: sha('i'), phase: 'unknown', kernel: null } });
const unresolvedDoneRun = (runId: string): RunSnapshot => ended(runId, 'completed', { reconciliation: reconciliation({ kind: 'unresolved',
  reason: 'r', observedThroughPosition: null, unresolvedToolCallIds: [] }) });
const CONTINUATION = (runId: string): NonNullable<RunSnapshot['continuation']> => ({ schemaVersion: 1, kind: 'wait_reply', task,
  sessionRef: SESSION, messageRef: { aggregateType: 'SessionMessage', projectId: P, workspaceId: W, messageId: `msg-${runId}` } });

// Rounds. Only the fields the derivations read are real; the frozen configuration,
// plan and proof are irrelevant here and cast.
const report = (checkId: string): ArtifactRef => ({ kind: 'artifact', contentType: 'application/json', digest: sha('d'),
  sizeBytes: 40, source: { kind: 'workspace', refId: `${W}:${checkId}`, revision: '1' } });
const check = (checkId: string, phase: RoundCheckSnapshot['phase'], outcome: EvidenceOutcome | null,
  incompleteCause: RoundCheckIncompleteCause | null = null): RoundCheckSnapshot => ({
  checkId, definition: { checkId, kind: 'static', command: `npm run ${checkId}`, cwd: '.', timeoutMs: 60_000, taskIds: 'all' },
  coverage: [], phase, invocationId: phase === 'pending' ? null : `inv-${checkId}`, outcome,
  reportRef: outcome === null ? null : report(checkId), sourceStatus: phase === 'finished' ? 'matched' : null, incompleteCause,
});
const identityOf = (seed: string, workspaceRevision = 3): VerificationRoundMaterialIdentity =>
  ({ sourceDigest: sha(seed), workspaceRevision }) as unknown as VerificationRoundMaterialIdentity;
type RoundShape = Pick<RoundSnapshot, 'status' | 'outcome' | 'checks' | 'gaps'>;
const gap = (code: string): RoundSnapshot['gaps'][number] => ({ code, message: `gap ${code}` });
const OPEN_PENDING: RoundShape = { status: 'open', outcome: null, checks: [check('c1', 'pending', null), check('c2', 'finished', 'PASS')], gaps: [] };
const OPEN_INTERRUPTED: RoundShape = { status: 'open', outcome: null,
  checks: [check('c1', 'interrupted', null, 'host_restart'), check('c2', 'finished', 'PASS')], gaps: [] };
const OPEN_TICKET_INVALID: RoundShape = { status: 'open', outcome: null,
  checks: [check('c1', 'interrupted', null, 'ticket_invalid'), check('c2', 'finished', 'PASS')], gaps: [] };
const OPEN_MIXED: RoundShape = { status: 'open', outcome: null,
  checks: [check('c1', 'interrupted', null, 'host_restart'), check('c2', 'pending', null)], gaps: [] };
const FAIL: RoundShape = { status: 'finalized', outcome: 'FAIL', checks: [check('c1', 'finished', 'FAIL'), check('c2', 'finished', 'PASS')], gaps: [] };
const INCONCLUSIVE: RoundShape = { status: 'finalized', outcome: 'INCONCLUSIVE',
  checks: [check('c1', 'finished', 'INCONCLUSIVE', 'process_timed_out'), check('c2', 'finished', 'PASS')], gaps: [gap('inconclusive_check')] };
/** Every non-PASS check interrupted by a Host restart: `reverifyExemption` = `host_interruption`. */
const HOST_INTERRUPTED: RoundShape = { status: 'finalized', outcome: 'INCONCLUSIVE',
  checks: [check('c1', 'interrupted', null, 'host_restart'), check('c2', 'finished', 'PASS')], gaps: [gap('interrupted_check')] };
/**
 * A check that never started next to a Host-restart interruption: `reverifyExemption` =
 * `not_started`, which skips the key but is still counted against the cap (§13.7, VR-14 step 7).
 */
const NOT_STARTED: RoundShape = { status: 'finalized', outcome: 'INCONCLUSIVE',
  checks: [check('c1', 'finished', 'INCONCLUSIVE', 'not_started'), check('c2', 'interrupted', null, 'host_restart'),
    check('c3', 'finished', 'PASS')], gaps: [gap('interrupted_check')] };
const NULL_OUTCOME: RoundShape = { status: 'finalized', outcome: null, checks: [check('c1', 'pending', null)], gaps: [gap('pending_check')] };
const PASS: RoundShape = { status: 'finalized', outcome: 'PASS', checks: [check('c1', 'finished', 'PASS')], gaps: [] };

const ROOT_CHAIN: RoundChainV1 = { schemaVersion: 1, ordinal: 1, predecessorRoundRef: null, predecessorRevision: null,
  supersededEvidenceIds: [], basisDigests: [], autoCount: 0, reverify: null };
function roundOf(roundId: string, shape: RoundShape, chain: RoundChainV1 = ROOT_CHAIN, runId = 'run-1', source = 'S1'): RoundSnapshot {
  return {
    ref: roundRef(roundId, runId), revision: 3, schemaVersion: 1, subject: { ...task }, subjectRunRef: runRef(runId),
    adoptedPlanRef: PLAN, taskBasisRef: PLAN, executor: HUMAN,
    configuration: {} as RoundSnapshot['configuration'], configurationDigest: sha('c'), identity: identityOf(source),
    sourceProof: {} as RoundSnapshot['sourceProof'], verificationPlan: {} as RoundSnapshot['verificationPlan'],
    ...structuredClone(shape), evidenceRefs: [], chain,
  };
}
const headOf = (shape: RoundShape, runId = 'run-1'): RoundChainHeadV1 => roundChainHead([roundOf('round-1', shape, ROOT_CHAIN, runId)]);
const NO_CHAIN: RoundChainHeadV1 = { kind: 'none' };
/** Two chain roots of one Run (GAP-52). */
const INVALID_CHAIN: RoundChainHeadV1 = roundChainHead([roundOf('round-a', FAIL), roundOf('round-b', FAIL)]);
/**
 * A valid chain of `ordinal` rounds: every predecessor a finalized
 * INCONCLUSIVE round, the head `shape` with `autoCount`. Chain fields that no
 * function here reads (`reverify`, digests) stay empty.
 */
function chainAt(ordinal: number, shape: RoundShape, autoCount = 0, source = 'S1'): RoundChainHeadV1 {
  const rounds: RoundSnapshot[] = [];
  for (let n = 1; n <= ordinal; n += 1) {
    const predecessor = rounds[n - 2];
    const chain: RoundChainV1 = predecessor === undefined ? ROOT_CHAIN
      : { ...ROOT_CHAIN, ordinal: n, predecessorRoundRef: predecessor.ref, predecessorRevision: predecessor.revision,
        autoCount: n === ordinal ? autoCount : 0 };
    rounds.push(roundOf(`round-${n}`, n === ordinal ? shape : INCONCLUSIVE, chain, 'run-1', source));
  }
  const head = roundChainHead(rounds);
  if (head.kind !== 'head') throw new Error(`fixture chain is ${head.kind}`);
  return head;
}

const BASIS: NoProgressKeyV1 = { taskRef: task, actionKind: 'requeue',
  failure: { outcome: 'completed', origin: 'observed', exhaustedTokenBudget: null, checks: [], gapCodes: [] },
  source: { workspaceRevision: 3, sourceDigest: sha('1') }, plan: PLAN, newInputDigest: null, digest: sha('2') };
const requeueRefOf = (afterRunId: string): TaskRequeueRef => ({ aggregateType: 'TaskRequeue', projectId: P, goalId: G, taskId: T, afterRunId });
function requeueOf(afterRunId: string, over: Partial<TaskRequeueSnapshotV1> = {}): TaskRequeueSnapshotV1 {
  return {
    ref: requeueRefOf(afterRunId), revision: 1, schemaVersion: 1, task, planRef: PLAN, afterRunRef: runRef(afterRunId),
    afterAttemptRef: { aggregateType: 'TaskAttempt', projectId: P, goalId: G, taskId: T, attemptId: `${afterRunId}-attempt` },
    afterOutcome: 'completed', afterRoundRef: null, failureClass: 'check_failed', interruption: null, stopIntentRef: null,
    stopRequester: 'none', basis: BASIS, basisComparison: 'compared', supersededEvidenceIds: [], newInputRefs: [], budget: null,
    reason: 'auto-rework:check_failed#1', requestedBy: WORKFLOW, requestedAt: time(6), agentProvenance: null,
    automation: { automatic: true, counted: true, autoCount: 1, cap: 3 }, historySource: null, ...over,
  };
}

/** The legal field set of each (operation, code) refusal (I-18); `over` adjusts it. */
function refusalInput(operation: TaskReworkOperation, subject: string, code: TaskReworkRefusalCode,
  over: Partial<NewTaskReworkRefusalInputV1> = {}): NewTaskReworkRefusalInputV1 {
  const requeue = operation === 'requeue';
  const capturesSource = code !== 'auto_rework_cap_reached' && code !== 'budget_not_increased';
  return {
    current: null,
    ref: { aggregateType: 'TaskReworkRefusal', projectId: P, goalId: G, taskId: T, operation, subjectId: subject },
    task,
    afterRunRef: runRef(requeue ? subject : 'run-1'),
    subjectRoundRef: requeue ? null : roundRef(subject),
    failureClass: requeue ? 'check_failed' : 'check_incomplete',
    code,
    reason: `refused: ${code}`,
    basisDigest: code === 'no_new_basis' ? sha('b') : null,
    source: capturesSource ? { workspaceRevision: 3, sourceDigest: sha('1') } : null,
    matchedRequeueRef: requeue && code === 'no_new_basis' ? requeueRefOf('run-0') : null,
    requestedBy: WORKFLOW,
    refusedAt: time(7),
    goalEndedRunsAtRefusal: 4,
    configurationRevision: !requeue && (code === 'no_new_basis' || code === 'verification_uncovered') ? 'cfg-1' : null,
    ...over,
  };
}
const requeueRefusal = (runId: string, code: TaskReworkRefusalCode, over: Partial<NewTaskReworkRefusalInputV1> = {}) =>
  newTaskReworkRefusalRecord(refusalInput('requeue', runId, code, over));
const reverifyRefusal = (roundId: string, code: TaskReworkRefusalCode, over: Partial<NewTaskReworkRefusalInputV1> = {}) =>
  newTaskReworkRefusalRecord(refusalInput('reverify', roundId, code, over));

/** A work Task with `run` selected (its only Run unless `runs` says otherwise). */
function work(run: RunSnapshot | null, chain: RoundChainHeadV1 = NO_CHAIN, over: Partial<WorkFailureInputV1> = {}): WorkFailureInputV1 {
  return {
    subjectKind: 'work', task, disposition: 'active', satisfied: false, goalDesiredState: 'active', selectedRun: run,
    originUnresolvable: false, pointerIntent: null, chain, runs: run === null ? [] : [run], requeues: [], requeueRefusal: null,
    reverifyRefusal: null, goalEndedRuns: 4, configurationRevision: 'cfg-1', kernelRunFailedError: null, ...over,
  };
}
/** A gate whose chain is anchored on the completed producer `run-1`. */
function gate(chain: RoundChainHeadV1, over: Partial<GateFailureInputV1> = {}): GateFailureInputV1 {
  return {
    subjectKind: 'gate', task: { ...task, taskId: 'tf-gate' }, disposition: 'active', satisfied: false, goalDesiredState: 'active',
    chain, anchorRun: runOf('run-1'), fixInProgress: false, reverifyRefusal: null, goalEndedRuns: 4,
    configurationRevision: 'cfg-1', kernelRunFailedError: null, ...over,
  };
}
const verdictOf = (input: WorkFailureInputV1 | GateFailureInputV1, limit = 3) => automationVerdict(input, policy(limit));
const NONE: TaskAutomationVerdictV1 = { kind: 'none' };
const ALL: ReworkActorClass[] = ['human', 'system', 'agent'];

// ------------------------------------------------------------------------ //
// Stop requester and fence                                                  //
// ------------------------------------------------------------------------ //
describe('stopRequesterOf / reworkStopOf (§1.3)', () => {
  it.each<[string, ControlIntentSnapshotV1 | null, string]>([
    ['no pointer', null, 'none'],
    ['an operator {kind:"human"} pause', intentOf('i1', 'pause', HUMAN), 'human'],
    ['an operator {kind:"human"} cancel', intentOf('i2', 'cancel', HUMAN), 'human'],
    ['a Host {kind:"system"} actor not in the automation list', intentOf('i3', 'cancel', HOST_SYSTEM), 'human'],
    ['a system actor that only resembles the fan-out actor', intentOf('i4', 'pause', { kind: 'system', id: 'host:goal-fan-out-2' }), 'human'],
    ['WORKFLOW_AUTOMATION_ACTOR', intentOf('i5', 'cancel', WORKFLOW), 'system'],
    ['GOAL_FAN_OUT_ACTOR', intentOf('i6', 'pause', FAN_OUT), 'goal_fan_out'],
    ['a resume pointer is not a stop', intentOf('i7', 'resume', HUMAN), 'none'],
    ['a steer pointer is not a stop', intentOf('i8', 'steer', HUMAN), 'none'],
  ])('%s → %s', (_name, intent, expected) => {
    expect(stopRequesterOf(intent)).toBe(expected);
    const stop = reworkStopOf(intent);
    expect(stop).toEqual(expected === 'none' || intent === null
      ? { intentRef: null, requester: 'none' } : { intentRef: intent.ref, requester: expected });
  });
});

describe('reworkFenceOf (hard limit 3, §11 fence(r))', () => {
  const pointers: Array<[string, ControlIntentSnapshotV1 | null]> = [
    ['none', null],
    ['human pause', intentOf('p-h', 'pause', HUMAN)],
    ['human cancel', intentOf('c-h', 'cancel', HUMAN)],
    ['host-system cancel', intentOf('c-hs', 'cancel', HOST_SYSTEM)],
    ['workflow pause', intentOf('p-w', 'pause', WORKFLOW)],
    ['workflow cancel', intentOf('c-w', 'cancel', WORKFLOW)],
    ['fan-out pause', intentOf('p-f', 'pause', FAN_OUT)],
    ['fan-out cancel', intentOf('c-f', 'cancel', FAN_OUT)],
    ['human resume', intentOf('r-h', 'resume', HUMAN)],
    ['human steer', intentOf('s-h', 'steer', HUMAN)],
  ];
  const plain: Record<string, ReworkFence> = { 'none': 'none', 'human pause': 'human_only', 'human cancel': 'human_only',
    'host-system cancel': 'human_only', 'workflow pause': 'none', 'workflow cancel': 'none', 'fan-out pause': 'none',
    'fan-out cancel': 'none', 'human resume': 'none', 'human steer': 'none' };
  // Paused-interrupted (RUN-24): only a Goal fan-out pause leaves the Goal-resume exit (C4).
  const pausedInterrupted: Record<string, ReworkFence> = { 'none': 'human_only', 'human pause': 'human_only',
    'human cancel': 'human_only', 'host-system cancel': 'human_only', 'workflow pause': 'human_only',
    'workflow cancel': 'human_only', 'fan-out pause': 'human_or_goal_resume', 'fan-out cancel': 'human_or_goal_resume',
    'human resume': 'human_only', 'human steer': 'human_only' };
  it.each(pointers)('pointer %s', (name, intent) => {
    for (const outcome of ['cancelled', 'failed', 'completed', 'yielded'] as const) {
      expect(reworkFenceOf(ended('run-1', outcome), intent)).toBe(plain[name]);
    }
    // RUN-19 and RUN-23 are not paused-interrupted.
    expect(reworkFenceOf(hostInterrupted('run-1', null), intent)).toBe(plain[name]);
    expect(reworkFenceOf(reconcileCancelled('run-1', intentOf('q', 'cancel', WORKFLOW)), intent)).toBe(plain[name]);
    expect(reworkFenceOf(hostInterrupted('run-1', intentOf('pause', 'pause', HUMAN)), intent)).toBe(pausedInterrupted[name]);
  });
});

// ------------------------------------------------------------------------ //
// FC-1..FC-17                                                               //
// ------------------------------------------------------------------------ //
describe('deriveReworkClass: one case per FC row (TD-8)', () => {
  const humanPause = intentOf('pause-h', 'pause', HUMAN);
  const humanCancel = intentOf('cancel-h', 'cancel', HUMAN);
  const fanOutPause = intentOf('pause-f', 'pause', FAN_OUT);
  type Case = [string, RunSnapshot, ControlIntentSnapshotV1 | null, RoundChainHeadV1, ReworkClassRow, unknown];
  const cases: Case[] = [
    ['FC-1 running', runOf('run-1', { status: 'running', outcome: null, endedAt: null }), null, NO_CHAIN, 'FC-1', { kind: 'no_rework' }],
    ['FC-1 starting', runOf('run-1', { status: 'starting', outcome: null, endedAt: null }), null, NO_CHAIN, 'FC-1', { kind: 'no_rework' }],
    ['FC-2 outcome_unknown', ended('run-1', 'outcome_unknown'), null, NO_CHAIN, 'FC-2',
      { kind: 'not_reworkable', cause: 'run_outcome_unknown', detail: 'run run-1 ended with an unknown outcome' }],
    ['FC-3 yielded wait cancelled (P17)', ended('run-1', 'yielded', { continuation: CONTINUATION('run-1'), ...pointing(humanCancel) }),
      humanCancel, NO_CHAIN, 'FC-3', { kind: 'class', failureClass: 'cancelled', interruption: null }],
    ['FC-4 yielded wait paused (P18)', ended('run-1', 'yielded', { continuation: CONTINUATION('run-1'), ...pointing(humanPause) }),
      humanPause, NO_CHAIN, 'FC-4', { kind: 'not_reworkable', cause: 'continuation_paused' }],
    ['FC-5 yielded wait (P5)', ended('run-1', 'yielded', { continuation: CONTINUATION('run-1') }), null, NO_CHAIN, 'FC-5',
      { kind: 'no_rework' }],
    ['FC-5 yielded without continuation, cancelled pointer (P14)', ended('run-1', 'yielded', pointing(humanCancel)), humanCancel,
      NO_CHAIN, 'FC-5', { kind: 'no_rework' }],
    ['FC-6 paused-interrupted (RUN-24)', hostInterrupted('run-1', fanOutPause), fanOutPause, NO_CHAIN, 'FC-6',
      { kind: 'class', failureClass: 'interrupted', interruption: 'paused' }],
    ['FC-7 interrupted while executing (RUN-19)', hostInterrupted('run-1', null), null, NO_CHAIN, 'FC-7',
      { kind: 'class', failureClass: 'interrupted', interruption: 'executing' }],
    ['FC-8 cancelled', ended('run-1', 'cancelled', pointing(humanCancel)), humanCancel, NO_CHAIN, 'FC-8',
      { kind: 'class', failureClass: 'cancelled', interruption: null }],
    ['FC-8 RUN-23 reconcile-time cancel', reconcileCancelled('run-1', intentOf('cancel-w', 'cancel', WORKFLOW)),
      intentOf('cancel-w', 'cancel', WORKFLOW), NO_CHAIN, 'FC-8', { kind: 'class', failureClass: 'cancelled', interruption: null }],
    ['FC-9 Kernel crash', ended('run-1', 'crashed'), null, NO_CHAIN, 'FC-9', { kind: 'class', failureClass: 'run_failed', interruption: null }],
    ['FC-9 human_attested crash', humanAttested('run-1'), null, NO_CHAIN, 'FC-9', { kind: 'class', failureClass: 'run_failed', interruption: null }],
    ['FC-9 failed', ended('run-1', 'failed'), null, NO_CHAIN, 'FC-9', { kind: 'class', failureClass: 'run_failed', interruption: null }],
    ['FC-10 budget_exhausted', ended('run-1', 'budget_exhausted'), null, NO_CHAIN, 'FC-10',
      { kind: 'class', failureClass: 'run_failed', interruption: null }],
    ['FC-11 invalid chain', ended('run-1', 'completed'), null, INVALID_CHAIN, 'FC-11',
      { kind: 'not_reworkable', cause: 'round_ambiguous', detail: 'rounds round-a and round-b are both chain roots' }],
    ['FC-12 no round', ended('run-1', 'completed'), null, NO_CHAIN, 'FC-12', { kind: 'no_rework' }],
    ['FC-13 open head, only interrupted left (P9)', ended('run-1', 'completed'), null, headOf(OPEN_INTERRUPTED), 'FC-13',
      { kind: 'class', failureClass: 'check_incomplete', interruption: null }],
    ['FC-14 open head, pending', ended('run-1', 'completed'), null, headOf(OPEN_PENDING), 'FC-14', { kind: 'no_rework' }],
    ['FC-14 open head, interrupted while another is pending (P12)', ended('run-1', 'completed'), null, headOf(OPEN_MIXED), 'FC-14',
      { kind: 'no_rework' }],
    ['FC-15 FAIL head', ended('run-1', 'completed'), null, headOf(FAIL), 'FC-15', { kind: 'class', failureClass: 'check_failed', interruption: null }],
    ['FC-15 FAIL successor head (ordinal 2)', ended('run-1', 'completed'), null, chainAt(2, FAIL), 'FC-15',
      { kind: 'class', failureClass: 'check_failed', interruption: null }],
    ['FC-16 INCONCLUSIVE head', ended('run-1', 'completed'), null, headOf(INCONCLUSIVE), 'FC-16',
      { kind: 'class', failureClass: 'check_incomplete', interruption: null }],
    ['FC-16 finalized without outcome', ended('run-1', 'completed'), null, headOf(NULL_OUTCOME), 'FC-16',
      { kind: 'class', failureClass: 'check_incomplete', interruption: null }],
    ['FC-17 clean PASS head', ended('run-1', 'completed'), null, headOf(PASS), 'FC-17', { kind: 'no_rework' }],
  ];
  it.each(cases)('%s', (_name, run, intent, chain, row, expected) => {
    const derived = deriveReworkClass(run, intent, chain);
    expect(derived.row).toBe(row);
    expect(derived).toMatchObject(expected as object);
    expect(derived.stop).toEqual(reworkStopOf(intent));
  });

  it('FC-2 covers the three other runUnresolvedBlocker cases and an ended Run without an outcome (hard limit 1)', () => {
    const quarantined = ended('run-1', 'crashed', { reconciliation: reconciliation({ kind: 'runtime_terminal',
      event: runtimeEvent('run-1', { kind: 'crashed', error: 'x' }), digest: sha('9') }, 'quarantined') });
    const unresolved = ended('run-1', 'completed', { reconciliation: reconciliation({ kind: 'unresolved', reason: 'tool call in flight',
      observedThroughPosition: 3, unresolvedToolCallIds: ['call-1'] }, 'quarantined') });
    const unresolvedDone = unresolvedDoneRun('run-1');
    const authUnknown = authUnknownRun('run-1');
    const noOutcome = runOf('run-1', { outcome: null });
    expect(deriveReworkClass(quarantined, null, NO_CHAIN)).toMatchObject({ row: 'FC-2', detail: 'run run-1 is quarantined and not reconciled' });
    expect(deriveReworkClass(unresolved, null, headOf(FAIL))).toMatchObject({ row: 'FC-2' });
    expect(deriveReworkClass(unresolvedDone, null, headOf(FAIL)))
      .toMatchObject({ row: 'FC-2', detail: 'run run-1 carries an unresolved reconciliation' });
    expect(deriveReworkClass(authUnknown, null, headOf(FAIL)))
      .toMatchObject({ row: 'FC-2', detail: 'run run-1 carries an unreconciled unknown entry authorization' });
    expect(deriveReworkClass(noOutcome, null, NO_CHAIN))
      .toMatchObject({ row: 'FC-2', cause: 'run_outcome_unknown', detail: 'run run-1 ended without an outcome' });
  });

  it('row order: FC-1 before FC-2, FC-2 before FC-3, FC-6 before FC-9, FC-13 before FC-14', () => {
    // A running Run is also a runUnresolvedBlocker; FC-1 matches first.
    expect(deriveReworkClass(runOf('run-1', { status: 'running', outcome: null }), null, NO_CHAIN).row).toBe('FC-1');
    // A quarantined yielded wait with a cancelled pointer is FC-2, not FC-3.
    const cancel = intentOf('c', 'cancel', HUMAN);
    const quarantinedWait = ended('run-1', 'yielded', { continuation: CONTINUATION('run-1'), ...pointing(cancel),
      reconciliation: reconciliation({ kind: 'unresolved', reason: 'r', observedThroughPosition: null, unresolvedToolCallIds: [] }, 'quarantined') });
    expect(deriveReworkClass(quarantinedWait, cancel, NO_CHAIN).row).toBe('FC-2');
    // A crashed Run with an interrupted_clean observation is FC-6/FC-7, never FC-9.
    expect(deriveReworkClass(hostInterrupted('run-1', intentOf('p', 'pause', HUMAN)), intentOf('p', 'pause', HUMAN), NO_CHAIN).row).toBe('FC-6');
    expect(deriveReworkClass(hostInterrupted('run-1', null), null, NO_CHAIN).row).toBe('FC-7');
    // An open head with only interrupted checks left is FC-13; with a pending one still to run it stays FC-14 (P12).
    expect(deriveReworkClass(ended('run-1', 'completed'), null, headOf(OPEN_INTERRUPTED)).row).toBe('FC-13');
    expect(deriveReworkClass(ended('run-1', 'completed'), null, headOf(OPEN_MIXED)).row).toBe('FC-14');
  });

  it('FC-8: a human pause pointer on a cancelled Run gives stopRequester human; no pointer gives none', () => {
    const pause = intentOf('p', 'pause', HUMAN);
    expect(deriveReworkClass(ended('run-1', 'cancelled', pointing(pause)), pause, NO_CHAIN).stop)
      .toEqual({ intentRef: pause.ref, requester: 'human' });
    expect(deriveReworkClass(ended('run-1', 'cancelled'), null, NO_CHAIN).stop).toEqual({ intentRef: null, requester: 'none' });
    const automation = intentOf('c', 'cancel', WORKFLOW);
    expect(deriveReworkClass(ended('run-1', 'cancelled', pointing(automation)), automation, NO_CHAIN).stop)
      .toEqual({ intentRef: automation.ref, requester: 'system' });
    const fanOut = intentOf('c', 'cancel', FAN_OUT);
    expect(deriveReworkClass(ended('run-1', 'cancelled', pointing(fanOut)), fanOut, NO_CHAIN).stop.requester).toBe('goal_fan_out');
  });

  it('sweep: the chain head decides only for completed Runs', () => {
    const chains: Array<[string, RoundChainHeadV1, ReworkClassRow]> = [
      ['none', NO_CHAIN, 'FC-12'], ['invalid', INVALID_CHAIN, 'FC-11'], ['open pending', headOf(OPEN_PENDING), 'FC-14'],
      ['open interrupted', headOf(OPEN_INTERRUPTED), 'FC-13'], ['open mixed', headOf(OPEN_MIXED), 'FC-14'],
      ['FAIL', headOf(FAIL), 'FC-15'], ['INCONCLUSIVE', headOf(INCONCLUSIVE), 'FC-16'], ['host-interrupted', headOf(HOST_INTERRUPTED), 'FC-16'],
      ['not-started', headOf(NOT_STARTED), 'FC-16'], ['finalized null', headOf(NULL_OUTCOME), 'FC-16'], ['PASS', headOf(PASS), 'FC-17'],
    ];
    const others: Array<[RunOutcome, ReworkClassRow]> = [
      ['failed', 'FC-9'], ['cancelled', 'FC-8'], ['budget_exhausted', 'FC-10'], ['crashed', 'FC-9'], ['yielded', 'FC-5'], ['outcome_unknown', 'FC-2'],
    ];
    for (const [name, chain, row] of chains) {
      expect([name, deriveReworkClass(ended('run-1', 'completed'), null, chain).row]).toEqual([name, row]);
      for (const [outcome, otherRow] of others) {
        expect([name, outcome, deriveReworkClass(ended('run-1', outcome), null, chain).row]).toEqual([name, outcome, otherRow]);
      }
    }
  });
});

// ------------------------------------------------------------------------ //
// Actor × class matrix                                                      //
// ------------------------------------------------------------------------ //
type Who = 'human' | 'workflow' | 'agent' | 'fanOutTrigger' | 'fanOut';
const WHO: Who[] = ['human', 'workflow', 'agent', 'fanOutTrigger', 'fanOut'];
const actorOf = (who: Who): Pick<ReworkPermissionInputV1, 'actorClass' | 'goalFanOut' | 'trigger'> => ({
  actorClass: who === 'human' ? 'human' : who === 'agent' ? 'agent' : 'system',
  goalFanOut: who === 'fanOutTrigger' || who === 'fanOut',
  trigger: who === 'fanOutTrigger',
});
type Expected = 'ok' | 'forbidden' | 'invalid' | 'busy';
const REASON_OF: Record<Exclude<Expected, 'ok'>, string> = { forbidden: 'guard_failed', invalid: 'illegal', busy: 'guard_failed' };
function permission(subject: Pick<ReworkPermissionInputV1, 'operation' | 'failureClass' | 'interruption' | 'fence'>, who: Who,
  over: Partial<ReworkPermissionInputV1> = {}): Expected {
  const result = reworkPermission({ goalDesiredState: 'active', budget: false, note: false, ...subject, ...actorOf(who), ...over });
  if (result === null) return 'ok';
  if (result.ok) throw new Error('a permission refusal is never ok');
  expect(result.reason).toBe(REASON_OF[result.code as Exclude<Expected, 'ok'>]);
  return result.code as Expected;
}
const row = (human: Expected, workflow: Expected, agent: Expected, fanOutTrigger: Expected, fanOut: Expected): Record<Who, Expected> =>
  ({ human, workflow, agent, fanOutTrigger, fanOut });
type Subject = Pick<ReworkPermissionInputV1, 'failureClass' | 'interruption' | 'fence'>;

describe('reworkPermission: §4.3 "操作者与失败类别" matrix (C1, C2, C4; hard limit 3)', () => {
  const REQUEUE: Array<[string, Subject, Record<Who, Expected>]> = [
    ['interrupted / executing (RUN-19)', { failureClass: 'interrupted', interruption: 'executing', fence: 'none' },
      row('ok', 'ok', 'ok', 'forbidden', 'forbidden')],
    ['interrupted / paused by a Goal fan-out (human_or_goal_resume)', { failureClass: 'interrupted', interruption: 'paused', fence: 'human_or_goal_resume' },
      row('ok', 'forbidden', 'forbidden', 'ok', 'forbidden')],
    ['interrupted / paused otherwise (human_only)', { failureClass: 'interrupted', interruption: 'paused', fence: 'human_only' },
      row('ok', 'forbidden', 'forbidden', 'forbidden', 'forbidden')],
    ['interrupted / paused without a fence (defensive)', { failureClass: 'interrupted', interruption: 'paused', fence: 'none' },
      row('ok', 'forbidden', 'forbidden', 'ok', 'forbidden')],
    ['cancelled by an operator (human_only)', { failureClass: 'cancelled', interruption: null, fence: 'human_only' },
      row('ok', 'forbidden', 'forbidden', 'forbidden', 'forbidden')],
    ['cancelled by goal_fan_out / system / none', { failureClass: 'cancelled', interruption: null, fence: 'none' },
      row('ok', 'ok', 'forbidden', 'forbidden', 'forbidden')],
    ['check_failed', { failureClass: 'check_failed', interruption: null, fence: 'none' }, row('ok', 'ok', 'ok', 'forbidden', 'forbidden')],
    ['run_failed', { failureClass: 'run_failed', interruption: null, fence: 'none' }, row('ok', 'ok', 'ok', 'forbidden', 'forbidden')],
    ['check_incomplete, head finalized (FC-16)', { failureClass: 'check_incomplete', interruption: null, fence: 'none' },
      row('ok', 'invalid', 'invalid', 'forbidden', 'forbidden')],
    ['check_failed under an operator fence', { failureClass: 'check_failed', interruption: null, fence: 'human_only' },
      row('ok', 'forbidden', 'forbidden', 'forbidden', 'forbidden')],
    ['run_failed under an operator fence', { failureClass: 'run_failed', interruption: null, fence: 'human_only' },
      row('ok', 'forbidden', 'forbidden', 'forbidden', 'forbidden')],
    ['check_incomplete under an operator fence', { failureClass: 'check_incomplete', interruption: null, fence: 'human_only' },
      row('ok', 'forbidden', 'forbidden', 'forbidden', 'forbidden')],
  ];
  const REVERIFY: Array<[string, Subject, Record<Who, Expected>]> = [
    ['check_failed head', { failureClass: 'check_failed', interruption: null, fence: 'none' }, row('ok', 'ok', 'ok', 'forbidden', 'forbidden')],
    ['check_incomplete head', { failureClass: 'check_incomplete', interruption: null, fence: 'none' }, row('ok', 'ok', 'ok', 'forbidden', 'forbidden')],
    ['check_failed under an operator fence', { failureClass: 'check_failed', interruption: null, fence: 'human_only' },
      row('ok', 'forbidden', 'forbidden', 'forbidden', 'forbidden')],
    ['check_incomplete under an operator fence', { failureClass: 'check_incomplete', interruption: null, fence: 'human_only' },
      row('ok', 'forbidden', 'forbidden', 'forbidden', 'forbidden')],
    ['run_failed has no round', { failureClass: 'run_failed', interruption: null, fence: 'none' },
      row('invalid', 'invalid', 'invalid', 'forbidden', 'forbidden')],
    ['cancelled has no round', { failureClass: 'cancelled', interruption: null, fence: 'none' },
      row('invalid', 'invalid', 'invalid', 'forbidden', 'forbidden')],
    ['interrupted has no round', { failureClass: 'interrupted', interruption: 'executing', fence: 'none' },
      row('invalid', 'invalid', 'invalid', 'forbidden', 'forbidden')],
  ];
  const GOALS: GoalDesiredState[] = ['active', 'paused', 'cancelled'];

  it.each(REQUEUE)('requeue: %s × {human, Workflow, agent, fan-out+trigger, fan-out} × Goal', (_name, subject, expected) => {
    for (const goalDesiredState of GOALS) {
      for (const who of WHO) {
        const actual = permission({ operation: 'requeue', ...subject }, who, { goalDesiredState });
        expect([goalDesiredState, who, actual]).toEqual([goalDesiredState, who, goalDesiredState === 'active' ? expected[who] : 'busy']);
      }
    }
  });

  it.each(REVERIFY)('reverify: %s × actors × Goal', (_name, subject, expected) => {
    for (const goalDesiredState of GOALS) {
      for (const who of WHO) {
        const actual = permission({ operation: 'reverify', ...subject }, who, { goalDesiredState });
        expect([goalDesiredState, who, actual]).toEqual([goalDesiredState, who, goalDesiredState === 'active' ? expected[who] : 'busy']);
      }
    }
  });

  it('request fields: agent budget, non-human note and a non-fan-out trigger are invalid (§4.4)', () => {
    const checkFailed = { operation: 'requeue', failureClass: 'check_failed', interruption: null, fence: 'none' } as const;
    expect(permission(checkFailed, 'human', { budget: true })).toBe('ok');
    expect(permission(checkFailed, 'workflow', { budget: true })).toBe('ok');
    expect(permission(checkFailed, 'agent', { budget: true })).toBe('invalid');
    expect(permission(checkFailed, 'human', { note: true })).toBe('ok');
    expect(permission(checkFailed, 'workflow', { note: true })).toBe('invalid');
    expect(permission(checkFailed, 'agent', { note: true })).toBe('invalid');
    expect(permission(checkFailed, 'human', { trigger: true })).toBe('invalid');
    expect(permission(checkFailed, 'workflow', { trigger: true })).toBe('invalid');
    expect(permission(checkFailed, 'agent', { trigger: true })).toBe('invalid');
    expect(permission({ ...checkFailed, operation: 'reverify' }, 'workflow', { note: true })).toBe('invalid');
    expect(permission({ ...checkFailed, operation: 'reverify' }, 'human', { note: true })).toBe('ok');
    // The fan-out continuation carries its trigger and nothing else.
    const continuation = { operation: 'requeue', failureClass: 'interrupted', interruption: 'paused', fence: 'human_or_goal_resume' } as const;
    expect(permission(continuation, 'fanOutTrigger', { note: true })).toBe('invalid');
  });

  it('order: Goal first, then the fence, then the fan-out rule, then the class, then the request fields', () => {
    const humanCancel = { operation: 'requeue', failureClass: 'cancelled', interruption: null, fence: 'human_only' } as const;
    expect(permission(humanCancel, 'agent', { budget: true, goalDesiredState: 'paused' })).toBe('busy');
    expect(permission(humanCancel, 'agent', { budget: true })).toBe('forbidden');
    const incomplete = { operation: 'requeue', failureClass: 'check_incomplete', interruption: null, fence: 'none' } as const;
    expect(permission(incomplete, 'fanOutTrigger')).toBe('forbidden');
    expect(permission(incomplete, 'agent', { budget: true })).toBe('invalid');
    expect(reworkPermission({ ...incomplete, goalDesiredState: 'cancelled', actorClass: 'human', goalFanOut: false, trigger: false,
      budget: false, note: false })).toEqual({ ok: false, reason: 'guard_failed', code: 'busy',
      detail: 'the Goal is cancelled; resume the Goal first' });
  });

  it('exhaustive sweep: every combination answers null or one of the §1.2 reason/code pairs', () => {
    const fences: ReworkFence[] = ['none', 'human_only', 'human_or_goal_resume'];
    const classes: ReworkFailureClass[] = ['interrupted', 'cancelled', 'check_failed', 'run_failed', 'check_incomplete'];
    const bools = [false, true];
    let combinations = 0;
    for (const operation of ['requeue', 'reverify'] as const) for (const goalDesiredState of GOALS) for (const failureClass of classes)
      for (const interruption of ['executing', 'paused', null] as const) for (const fence of fences) for (const actorClass of REWORK_ACTOR_CLASSES)
        for (const goalFanOut of bools) for (const trigger of bools) for (const budget of bools) for (const note of bools) {
          combinations += 1;
          const result = reworkPermission({ operation, goalDesiredState, failureClass, interruption, fence, actorClass, goalFanOut,
            trigger, budget, note });
          if (goalDesiredState !== 'active') {
            expect(result).toMatchObject({ ok: false, reason: 'guard_failed', code: 'busy' });
            continue;
          }
          if (result === null) {
            // Admitted ⇒ the fence, the fan-out rule and the request fields all hold.
            expect(fence !== 'human_only' || actorClass === 'human').toBe(true);
            expect(fence !== 'human_or_goal_resume' || actorClass === 'human' || (goalFanOut && trigger)).toBe(true);
            expect(!goalFanOut || (operation === 'requeue' && failureClass === 'interrupted' && interruption === 'paused' && trigger)).toBe(true);
            expect(!(budget && actorClass === 'agent') && !(note && actorClass !== 'human') && !(trigger && !goalFanOut)).toBe(true);
            continue;
          }
          expect(result.ok).toBe(false);
          if (result.ok) continue;
          expect([['guard_failed', 'forbidden'], ['illegal', 'invalid']]).toContainEqual([result.reason, result.code]);
        }
    expect(combinations).toBe(2 * 3 * 5 * 3 * 3 * 3 * 2 * 2 * 2 * 2);
  });
});

// ------------------------------------------------------------------------ //
// Automatic count, watermark, staleness, error text                         //
// ------------------------------------------------------------------------ //
describe('priorRequeueAutoCount / nextRequeueAutoCount (C8, I-12 clause 7)', () => {
  const rq1 = requeueOf('run-1', { automation: { automatic: true, counted: true, autoCount: 2, cap: 3 } });
  const run1 = ended('run-1', 'completed');
  const run2 = ended('run-2', 'yielded', { requeueRef: rq1.ref, continuation: CONTINUATION('run-2') });
  const run3 = ended('run-3', 'completed', { consumedWait: { runRef: runRef('run-2'),
    messageRef: { aggregateType: 'SessionMessage', projectId: P, workspaceId: W, messageId: 'msg-run-2' }, responseRef: report('reply') } });
  const runs = [run1, run2, run3];

  it('walks back through consumedWait to the first requeueRef; 0 without one', () => {
    expect(priorRequeueAutoCount(run1, runs, [rq1])).toBe(0);
    expect(priorRequeueAutoCount(run2, runs, [rq1])).toBe(2);
    expect(priorRequeueAutoCount(run3, runs, [rq1])).toBe(2);
    // A Run the owner did not read, a missing record and a cycle end the walk.
    expect(priorRequeueAutoCount(run3, [run3], [rq1])).toBe(0);
    expect(priorRequeueAutoCount(run2, runs, [])).toBe(0);
    const loopA = ended('run-a', 'completed', { consumedWait: { ...run3.consumedWait!, runRef: runRef('run-b') } });
    const loopB = ended('run-b', 'yielded', { consumedWait: { ...run3.consumedWait!, runRef: runRef('run-a') } });
    expect(priorRequeueAutoCount(loopA, [loopA, loopB], [rq1])).toBe(0);
  });

  it.each<[ReworkActorClass, ReworkFailureClass, object]>([
    ['human', 'check_failed', { automatic: false, counted: false, autoCount: 0, cap: null }],
    ['human', 'interrupted', { automatic: false, counted: false, autoCount: 0, cap: null }],
    ['system', 'check_failed', { automatic: true, counted: true, autoCount: 3, cap: 3 }],
    ['system', 'cancelled', { automatic: true, counted: true, autoCount: 3, cap: 3 }],
    ['agent', 'run_failed', { automatic: true, counted: true, autoCount: 3, cap: 3 }],
    // `interrupted` (including the Goal fan-out continuation) never counts.
    ['system', 'interrupted', { automatic: true, counted: false, autoCount: 2, cap: 3 }],
    ['agent', 'interrupted', { automatic: true, counted: false, autoCount: 2, cap: 3 }],
  ])('%s / %s after a consumedWait chain with count 2', (actorClass, failureClass, expected) => {
    expect(nextRequeueAutoCount({ actorClass, failureClass, afterRun: run3, runs, requeues: [rq1], policy: POLICY })).toEqual(expected);
  });

  it('the cap is the limit at write time', () => {
    expect(nextRequeueAutoCount({ actorClass: 'system', failureClass: 'check_failed', afterRun: run1, runs, requeues: [], policy: policy(0) }))
      .toEqual({ automatic: true, counted: true, autoCount: 1, cap: 0 });
  });
});

describe('countEndedGoalRuns and refusal staleness (ND-7, ND-8, LA-4)', () => {
  it('counts every ended Run of the raw Goal candidates, regardless of Plan or Task', () => {
    const otherPlan = ended('run-x', 'failed', { planRef: { ...PLAN, planId: 'plan-old' }, task: { ...task, taskId: 'other' } });
    expect(countEndedGoalRuns([ended('run-1', 'completed'), runOf('run-2', { status: 'running', outcome: null }), otherPlan,
      runOf('run-3', { status: 'starting', outcome: null }), ended('run-4', 'outcome_unknown')])).toBe(3);
    expect(countEndedGoalRuns([])).toBe(0);
  });

  it.each<[string, number, string | null, number, string | null, boolean]>([
    ['same count', 4, null, 4, 'cfg-1', false],
    ['a Run of the Goal ended since', 4, null, 5, 'cfg-1', true],
    ['fewer ended Runs never un-stales or stales', 4, null, 3, 'cfg-1', false],
    ['configuration revision changed', 4, 'cfg-1', 4, 'cfg-2', true],
    ['configuration revision unchanged', 4, 'cfg-1', 4, 'cfg-1', false],
    ['current configuration unknown', 4, 'cfg-1', 4, null, false],
    ['no configuration recorded', 4, null, 4, 'cfg-9', false],
  ])('%s', (_name, atRefusal, recorded, now, current, stale) => {
    expect(reworkRefusalIsStale({ goalEndedRunsAtRefusal: atRefusal, configurationRevision: recorded },
      { goalEndedRuns: now, configurationRevision: current })).toBe(stale);
  });
});

describe('runErrorOf (§6.1 contract (f))', () => {
  it('reads terminalPayload, then the reconciliation event, then the Kernel run.failed text', () => {
    expect(runErrorOf(ended('run-1', 'crashed', { terminalPayload: { kind: 'crashed', error: 'boom' } }), 'kernel'))
      .toEqual({ error: 'boom', errorSource: 'terminal_payload' });
    expect(runErrorOf(ended('run-1', 'cancelled', { terminalPayload: { kind: 'cancelled', reason: 'stop it' } }), null))
      .toEqual({ error: 'stop it', errorSource: 'terminal_payload' });
    const fromEvent = hostInterrupted('run-1', null);
    delete fromEvent.terminalPayload;
    expect(runErrorOf(fromEvent, 'kernel')).toEqual({ error: 'host_interrupted', errorSource: 'reconciliation_event' });
    expect(runErrorOf(ended('run-1', 'crashed'), 'kernel says no')).toEqual({ error: 'kernel says no', errorSource: 'kernel_run_failed' });
    expect(runErrorOf(ended('run-1', 'crashed'), null)).toEqual({ error: null, errorSource: 'not_recorded' });
    // A payload without error text (completed, budget_exhausted) falls through to the next source.
    expect(runErrorOf(ended('run-1', 'completed', { terminalPayload: { kind: 'completed', exitCode: 1 } }), null))
      .toEqual({ error: null, errorSource: 'not_recorded' });
    expect(runErrorOf(ended('run-1', 'budget_exhausted', { terminalPayload: { kind: 'budget_exhausted', exhaustedAt: time(4) } }), 'k'))
      .toEqual({ error: 'k', errorSource: 'kernel_run_failed' });
  });
});

// ------------------------------------------------------------------------ //
// AV table                                                                  //
// ------------------------------------------------------------------------ //
describe('automationVerdict: AV-0..AV-12 (TD-9, work Tasks)', () => {
  const failed = ended('run-1', 'completed');
  const humanCancel = intentOf('cancel-h', 'cancel', HUMAN);
  const humanPause = intentOf('pause-h', 'pause', HUMAN);

  it('AV-0: a non-active Goal gives none for every Task', () => {
    for (const goalDesiredState of ['paused', 'cancelled'] as const) {
      expect(verdictOf(work(failed, headOf(FAIL), { goalDesiredState }))).toEqual({ row: 'AV-0', verdict: NONE });
      expect(verdictOf(work(ended('run-1', 'outcome_unknown'), NO_CHAIN, { goalDesiredState }))).toEqual({ row: 'AV-0', verdict: NONE });
    }
  });

  it('AV-1: satisfied, non-active, unfinished, or no selected Run outside P15', () => {
    expect(verdictOf(work(failed, headOf(FAIL), { satisfied: true }))).toEqual({ row: 'AV-1', verdict: NONE });
    for (const disposition of ['deferred', 'cancelled', 'superseded'] as const) {
      expect(verdictOf(work(failed, headOf(FAIL), { disposition }))).toEqual({ row: 'AV-1', verdict: NONE });
    }
    expect(verdictOf(work(runOf('run-1', { status: 'running', outcome: null })))).toEqual({ row: 'AV-1', verdict: NONE });
    expect(verdictOf(work(null))).toEqual({ row: 'AV-1', verdict: NONE });
  });

  it('AV-2: an unknown outcome stops with unknown_outcome, before the fence', () => {
    expect(verdictOf(work(ended('run-1', 'outcome_unknown', pointing(humanCancel)), NO_CHAIN, { pointerIntent: humanCancel })))
      .toEqual({ row: 'AV-2', verdict: { kind: 'stopped', reason: 'unknown_outcome', detail: {} } });
  });

  it('AV-3: a covering TaskRequeue gives claim_requeued with its budget, before the fence', () => {
    const covering = requeueOf('run-1', { budget: { tokenBudget: 5000, deadline: null }, requestedBy: HUMAN,
      automation: { automatic: false, counted: false, autoCount: 0, cap: null } });
    const cancelled = ended('run-1', 'cancelled', pointing(humanCancel));
    expect(verdictOf(work(cancelled, NO_CHAIN, { pointerIntent: humanCancel, requeues: [covering] }))).toEqual({ row: 'AV-3',
      verdict: { kind: 'claim_requeued', requeueRef: covering.ref, budget: { tokenBudget: 5000, deadline: null } } });
    expect(verdictOf(work(failed, headOf(FAIL), { requeues: [requeueOf('run-1')] })).verdict)
      .toEqual({ kind: 'claim_requeued', requeueRef: requeueRefOf('run-1'), budget: null });
  });

  it('AV-4: an operator fence stops every class, cancel → task_cancelled, pause → task_paused', () => {
    expect(verdictOf(work(ended('run-1', 'cancelled', pointing(humanCancel)), NO_CHAIN, { pointerIntent: humanCancel })))
      .toEqual({ row: 'AV-4', verdict: { kind: 'stopped', reason: 'task_cancelled', detail: { fence: 'human_cancel' } } });
    // A Host {kind:'system'} operator's cancel is still a human fence.
    const hostCancel = intentOf('cancel-hs', 'cancel', HOST_SYSTEM);
    expect(verdictOf(work(ended('run-1', 'cancelled', pointing(hostCancel)), NO_CHAIN, { pointerIntent: hostCancel })).row).toBe('AV-4');
    // A human pause pointer on a crashed Run (C8-human-stop-respected variant).
    expect(verdictOf(work(ended('run-1', 'crashed', pointing(humanPause)), NO_CHAIN, { pointerIntent: humanPause })))
      .toEqual({ row: 'AV-4', verdict: { kind: 'stopped', reason: 'task_paused', detail: { fence: 'human_pause', pausedBy: 'human' } } });
    // A human pause on a check FAIL: hard limit 3 applies to every class.
    expect(verdictOf(work(ended('run-1', 'completed', pointing(humanPause)), headOf(FAIL), { pointerIntent: humanPause })).row).toBe('AV-4');
    // FC-4: a paused yielded wait paused by an operator (the exit is the Run-level resume).
    expect(verdictOf(work(ended('run-1', 'yielded', { continuation: CONTINUATION('run-1'), ...pointing(humanPause) }), NO_CHAIN,
      { pointerIntent: humanPause })).verdict).toEqual({ kind: 'stopped', reason: 'task_paused', detail: { fence: 'human_pause', pausedBy: 'human' } });
    // Paused-interrupted by an operator or by the Workflow: only a human continues (C4).
    expect(verdictOf(work(hostInterrupted('run-1', humanPause), NO_CHAIN, { pointerIntent: humanPause })))
      .toEqual({ row: 'AV-4', verdict: { kind: 'stopped', reason: 'task_paused', detail: { fence: 'human_pause', pausedBy: 'human' } } });
    const workflowPause = intentOf('pause-w', 'pause', WORKFLOW);
    expect(verdictOf(work(hostInterrupted('run-1', workflowPause), NO_CHAIN, { pointerIntent: workflowPause })))
      .toEqual({ row: 'AV-4', verdict: { kind: 'stopped', reason: 'task_paused', detail: { fence: 'human_pause', pausedBy: 'system' } } });
  });

  it('AV-4 in literal row order: an operator pointer left on a Run that completed first also stops the no-rework rows', () => {
    // FC-12 (no round yet), FC-14 (head open with a pending check), FC-17 (clean PASS awaiting completion).
    // Pins the spec as written; the lead decides before step 5.8 whether AV-4 stays this wide (see task-failure.ts AV-4).
    const noRework: Array<[ReworkClassRow, RoundChainHeadV1]> = [['FC-12', NO_CHAIN], ['FC-14', headOf(OPEN_PENDING)], ['FC-17', headOf(PASS)]];
    const workflowPause = intentOf('pause-w', 'pause', WORKFLOW);
    for (const [fcRow, chain] of noRework) {
      const derivedRow = (intent: ControlIntentSnapshotV1) => deriveReworkClass(ended('run-1', 'completed', pointing(intent)), intent, chain).row;
      expect([fcRow, derivedRow(humanPause), derivedRow(humanCancel)]).toEqual([fcRow, fcRow, fcRow]);
      expect([fcRow, verdictOf(work(ended('run-1', 'completed', pointing(humanPause)), chain, { pointerIntent: humanPause }))]).toEqual([fcRow,
        { row: 'AV-4', verdict: { kind: 'stopped', reason: 'task_paused', detail: { fence: 'human_pause', pausedBy: 'human' } } }]);
      expect([fcRow, verdictOf(work(ended('run-1', 'completed', pointing(humanCancel)), chain, { pointerIntent: humanCancel }))]).toEqual([fcRow,
        { row: 'AV-4', verdict: { kind: 'stopped', reason: 'task_cancelled', detail: { fence: 'human_cancel' } } }]);
      // An automation pointer is no fence: the same rows fall to AV-6.
      expect([fcRow, verdictOf(work(ended('run-1', 'completed', pointing(workflowPause)), chain, { pointerIntent: workflowPause }))])
        .toEqual([fcRow, { row: 'AV-6', verdict: NONE }]);
    }
    // FC-5 (P14): a yielded Run without a continuation under an operator's cancel.
    expect(verdictOf(work(ended('run-1', 'yielded', pointing(humanCancel)), NO_CHAIN, { pointerIntent: humanCancel })))
      .toEqual({ row: 'AV-4', verdict: { kind: 'stopped', reason: 'task_cancelled', detail: { fence: 'human_cancel' } } });
  });

  it('AV-5: paused-interrupted by a Goal fan-out pause shows task_paused{pausedBy goal_fan_out}', () => {
    const fanOutPause = intentOf('pause-f', 'pause', FAN_OUT);
    expect(verdictOf(work(hostInterrupted('run-1', fanOutPause), NO_CHAIN, { pointerIntent: fanOutPause })))
      .toEqual({ row: 'AV-5', verdict: { kind: 'stopped', reason: 'task_paused', detail: { pausedBy: 'goal_fan_out' } } });
    // Once a TaskRequeue covers it (GOAL-29 or a human continue), AV-3 wins.
    expect(verdictOf(work(hostInterrupted('run-1', fanOutPause), NO_CHAIN, { pointerIntent: fanOutPause,
      requeues: [requeueOf('run-1', { requestedBy: FAN_OUT })] })).row).toBe('AV-3');
  });

  it('AV-6: nothing to rework, or not reworkable', () => {
    const fanOutPause = intentOf('pause-f', 'pause', FAN_OUT);
    const cases: Array<[RunSnapshot, RoundChainHeadV1, ControlIntentSnapshotV1 | null, TaskAutomationVerdictV1]> = [
      [ended('run-1', 'yielded', { continuation: CONTINUATION('run-1') }), NO_CHAIN, null, NONE],
      [ended('run-1', 'yielded', { continuation: CONTINUATION('run-1'), ...pointing(fanOutPause) }), NO_CHAIN, fanOutPause, NONE],
      [failed, NO_CHAIN, null, NONE],
      [failed, headOf(OPEN_PENDING), null, NONE],
      [failed, headOf(OPEN_MIXED), null, NONE],
      [failed, headOf(PASS), null, NONE],
      [failed, INVALID_CHAIN, null, { kind: 'stopped', reason: 'not_reworkable', detail: { cause: 'round_ambiguous' } }],
    ];
    for (const [run, chain, intent, verdict] of cases) {
      expect(verdictOf(work(run, chain, { pointerIntent: intent }))).toEqual({ row: 'AV-6', verdict });
    }
    expect(verdictOf(work(null, NO_CHAIN, { originUnresolvable: true })))
      .toEqual({ row: 'AV-6', verdict: { kind: 'stopped', reason: 'not_reworkable', detail: { cause: 'origin_unresolvable' } } });
  });

  it('AV-7a: a counted automatic successor round over the cap; a host_interruption head is exempt', () => {
    const atCap = chainAt(2, INCONCLUSIVE, 3);
    expect(verdictOf(work(failed, atCap)))
      .toEqual({ row: 'AV-7a', verdict: { kind: 'stopped', reason: 'auto_rework_cap_reached', detail: { operation: 'reverify' } } });
    expect(verdictOf(work(failed, chainAt(2, INCONCLUSIVE, 2))).row).toBe('AV-7d');
    expect(verdictOf(work(failed, chainAt(2, HOST_INTERRUPTED, 3))).row).toBe('AV-7d');
    // A not_started head skips the key but is counted (§13.7, VR-14 step 7): only host_interruption is exempt,
    // or a sandbox that never launches would reverify forever without a model call.
    expect(reverifyExemption(roundOf('round-x', NOT_STARTED))).toBe('not_started');
    expect(verdictOf(work(failed, chainAt(2, NOT_STARTED, 3))))
      .toEqual({ row: 'AV-7a', verdict: { kind: 'stopped', reason: 'auto_rework_cap_reached', detail: { operation: 'reverify' } } });
    expect(verdictOf(work(failed, chainAt(2, NOT_STARTED, 2))).row).toBe('AV-7d');
    // Cap 0 stops even the first counted successor; a raised cap lets it go on.
    expect(verdictOf(work(failed, headOf(INCONCLUSIVE)), 0).row).toBe('AV-7a');
    expect(verdictOf(work(failed, atCap), 5).row).toBe('AV-7d');
    // FC-13 is judged too: a ticket_invalid interruption counts (VR-13); a Host-restart one is exempt.
    expect(verdictOf(work(failed, chainAt(2, OPEN_TICKET_INVALID, 3))).row).toBe('AV-7a');
    expect(verdictOf(work(failed, chainAt(2, OPEN_INTERRUPTED, 3))).verdict)
      .toMatchObject({ kind: 'reverify', roundRef: roundRef('round-2'), needsFinalize: true });
  });

  it('AV-7b: the head is at ROUND_CHAIN_MAX; AV-7a comes first', () => {
    expect(verdictOf(work(failed, chainAt(ROUND_CHAIN_MAX, INCONCLUSIVE))))
      .toEqual({ row: 'AV-7b', verdict: { kind: 'stopped', reason: 'not_reworkable', detail: { cause: 'round_chain_limit' } } });
    expect(verdictOf(work(failed, chainAt(ROUND_CHAIN_MAX - 1, INCONCLUSIVE))).row).toBe('AV-7d');
    expect(verdictOf(work(failed, chainAt(ROUND_CHAIN_MAX, INCONCLUSIVE, 3))).row).toBe('AV-7a');
  });

  it('AV-7c: an unexpired reverify refusal no_new_basis / verification_uncovered stops; other codes fall to AV-7d', () => {
    const head = headOf(INCONCLUSIVE);
    for (const code of ['no_new_basis', 'verification_uncovered'] as const) {
      expect(verdictOf(work(failed, head, { reverifyRefusal: reverifyRefusal('round-1', code) })))
        .toEqual({ row: 'AV-7c', verdict: { kind: 'stopped', reason: code, detail: { operation: 'reverify' } } });
    }
    // source_unchanged only answers an explicit onlyIfSourceChanged request; a stored cap refusal does not outlive a raised cap.
    for (const code of ['source_unchanged', 'auto_rework_cap_reached'] as const) {
      expect(verdictOf(work(failed, head, { reverifyRefusal: reverifyRefusal('round-1', code) })))
        .toEqual({ row: 'AV-7d', verdict: { kind: 'reverify', roundRef: roundRef('round-1'), needsFinalize: false,
          onlyIfSourceChanged: false, failureClass: 'check_incomplete', retryAfterRefusal: false } });
    }
    // Stale (another Run of the Goal ended, or the configuration changed): retry once.
    for (const over of [{ goalEndedRuns: 5 }, { configurationRevision: 'cfg-2' }]) {
      expect(verdictOf(work(failed, head, { reverifyRefusal: reverifyRefusal('round-1', 'no_new_basis'), ...over })))
        .toEqual({ row: 'AV-7d', verdict: { kind: 'reverify', roundRef: roundRef('round-1'), needsFinalize: false,
          onlyIfSourceChanged: false, failureClass: 'check_incomplete', retryAfterRefusal: true } });
    }
    // A refusal of another round (an older head) is not this head's.
    expect(verdictOf(work(failed, head, { reverifyRefusal: reverifyRefusal('round-0', 'no_new_basis') })).row).toBe('AV-7d');
    // A refusal counts only under its own key: a requeue refusal whose subjectId equals the head roundId is ignored.
    const misfiled = requeueRefusal('round-1', 'no_new_basis');
    expect(misfiled.ref).toMatchObject({ operation: 'requeue', subjectId: 'round-1' });
    expect(verdictOf(work(failed, head, { reverifyRefusal: misfiled })).row).toBe('AV-7d');
    // A human requeue refusal on check_incomplete does not change the verdict.
    expect(verdictOf(work(failed, head, { requeueRefusal: requeueRefusal('run-1', 'no_new_basis', { requestedBy: HUMAN }) })).row).toBe('AV-7d');
  });

  it('AV-7d: check_incomplete is reverified; FC-13 finalizes first', () => {
    expect(verdictOf(work(failed, headOf(OPEN_INTERRUPTED)))).toEqual({ row: 'AV-7d', verdict: { kind: 'reverify',
      roundRef: roundRef('round-1'), needsFinalize: true, onlyIfSourceChanged: false, failureClass: 'check_incomplete', retryAfterRefusal: false } });
    expect(verdictOf(work(failed, chainAt(3, INCONCLUSIVE, 1))).verdict).toMatchObject({ kind: 'reverify', roundRef: roundRef('round-3') });
  });

  it('AV-8: a counted automatic requeue over the cap; lowering the cap stops; interrupted is never stopped', () => {
    const run2 = ended('run-2', 'completed', { requeueRef: requeueRefOf('run-1') });
    const prior = requeueOf('run-1', { automation: { automatic: true, counted: true, autoCount: 3, cap: 3 } });
    const twoRuns = { runs: [ended('run-1', 'completed'), run2], requeues: [prior] };
    expect(verdictOf(work(run2, headOf(FAIL, 'run-2'), twoRuns)))
      .toEqual({ row: 'AV-8', verdict: { kind: 'stopped', reason: 'auto_rework_cap_reached', detail: { operation: 'requeue' } } });
    expect(verdictOf(work(run2, headOf(FAIL, 'run-2'), twoRuns), 4).row).toBe('AV-12');
    const lowered = { ...twoRuns, requeues: [requeueOf('run-1', { automation: { automatic: true, counted: true, autoCount: 2, cap: 3 } })] };
    expect(verdictOf(work(run2, headOf(FAIL, 'run-2'), lowered), 3).row).toBe('AV-12');
    expect(verdictOf(work(run2, headOf(FAIL, 'run-2'), lowered), 2).row).toBe('AV-8');
    // Cap 0: every counted class stops, interrupted still requeues (C2).
    expect(verdictOf(work(failed, headOf(FAIL)), 0).row).toBe('AV-8');
    expect(verdictOf(work(ended('run-1', 'failed')), 0).row).toBe('AV-8');
    expect(verdictOf(work(hostInterrupted('run-1', null)), 0))
      .toEqual({ row: 'AV-12', verdict: { kind: 'requeue', failureClass: 'interrupted', retryAfterRefusal: false } });
    // A human requeue reset the chain count.
    const humanPrior = { ...twoRuns, requeues: [requeueOf('run-1', { requestedBy: HUMAN,
      automation: { automatic: false, counted: false, autoCount: 0, cap: null } })] };
    expect(verdictOf(work(run2, headOf(FAIL, 'run-2'), humanPrior), 1).row).toBe('AV-12');
  });

  it('AV-9: an unexpired requeue refusal no_new_basis; a stale one retries once (AV-12)', () => {
    const refused = requeueRefusal('run-1', 'no_new_basis');
    expect(verdictOf(work(failed, headOf(FAIL), { requeueRefusal: refused })))
      .toEqual({ row: 'AV-9', verdict: { kind: 'stopped', reason: 'no_new_basis', detail: { operation: 'requeue' } } });
    expect(verdictOf(work(failed, headOf(FAIL), { requeueRefusal: refused, goalEndedRuns: 5 })))
      .toEqual({ row: 'AV-12', verdict: { kind: 'requeue', failureClass: 'check_failed', retryAfterRefusal: true } });
    // The refusal of an older Run is not the selected Run's.
    expect(verdictOf(work(failed, headOf(FAIL), { requeueRefusal: requeueRefusal('run-0', 'no_new_basis') })).row).toBe('AV-12');
    // Nor is a reverify refusal whose subjectId equals the selected runId: the operation is part of the key.
    const misfiled = reverifyRefusal('run-1', 'no_new_basis', { failureClass: 'check_failed' });
    expect(misfiled.ref).toMatchObject({ operation: 'reverify', subjectId: 'run-1' });
    expect(verdictOf(work(failed, headOf(FAIL), { requeueRefusal: misfiled })).row).toBe('AV-12');
  });

  it('AV-10: a stored cap refusal never outlives a raised cap; while still exceeded AV-8 answers', () => {
    const run2 = ended('run-2', 'completed', { requeueRef: requeueRefOf('run-1') });
    const input = work(run2, headOf(FAIL, 'run-2'), { runs: [ended('run-1', 'completed'), run2],
      requeues: [requeueOf('run-1', { automation: { automatic: true, counted: true, autoCount: 3, cap: 3 } })],
      requeueRefusal: requeueRefusal('run-2', 'auto_rework_cap_reached') });
    expect(verdictOf(input, 3).row).toBe('AV-8');
    expect(verdictOf(input, 5)).toEqual({ row: 'AV-12', verdict: { kind: 'requeue', failureClass: 'check_failed', retryAfterRefusal: false } });
  });

  it('AV-11: budget_exhausted stops with minTokenBudgetExclusive, whatever the refusal record says', () => {
    const exhausted = ended('run-1', 'budget_exhausted', { budget: { tokenBudget: 1200, deadline: null } });
    expect(verdictOf(work(exhausted))).toEqual({ row: 'AV-11',
      verdict: { kind: 'stopped', reason: 'budget_exhausted', detail: { minTokenBudgetExclusive: 1200 } } });
    expect(verdictOf(work(exhausted, NO_CHAIN, { requeueRefusal: requeueRefusal('run-1', 'budget_not_increased'), goalEndedRuns: 9 })).row)
      .toBe('AV-11');
    // AV-9 comes first: an unexpired no_new_basis refusal stops the larger-budget requeue loop; once stale, AV-11 again.
    const noBasis = requeueRefusal('run-1', 'no_new_basis', { failureClass: 'run_failed' });
    expect(verdictOf(work(exhausted, NO_CHAIN, { requeueRefusal: noBasis })))
      .toEqual({ row: 'AV-9', verdict: { kind: 'stopped', reason: 'no_new_basis', detail: { operation: 'requeue' } } });
    expect(verdictOf(work(exhausted, NO_CHAIN, { requeueRefusal: noBasis, goalEndedRuns: 5 })).row).toBe('AV-11');
  });

  it('AV-12: every other class requeues', () => {
    const workflowCancel = intentOf('cancel-w', 'cancel', WORKFLOW);
    const fanOutCancel = intentOf('cancel-f', 'cancel', FAN_OUT);
    const cases: Array<[RunSnapshot, RoundChainHeadV1, ControlIntentSnapshotV1 | null, ReworkFailureClass]> = [
      [failed, headOf(FAIL), null, 'check_failed'],
      [ended('run-1', 'crashed'), NO_CHAIN, null, 'run_failed'],
      [humanAttested('run-1'), NO_CHAIN, null, 'run_failed'],
      [ended('run-1', 'failed'), NO_CHAIN, null, 'run_failed'],
      [hostInterrupted('run-1', null), NO_CHAIN, null, 'interrupted'],
      [ended('run-1', 'cancelled'), NO_CHAIN, null, 'cancelled'],
      [ended('run-1', 'cancelled', pointing(workflowCancel)), NO_CHAIN, workflowCancel, 'cancelled'],
      [ended('run-1', 'cancelled', pointing(fanOutCancel)), NO_CHAIN, fanOutCancel, 'cancelled'],
      [reconcileCancelled('run-1', workflowCancel), NO_CHAIN, workflowCancel, 'cancelled'],
      [ended('run-1', 'yielded', { continuation: CONTINUATION('run-1'), ...pointing(workflowCancel) }), NO_CHAIN, workflowCancel, 'cancelled'],
    ];
    for (const [run, chain, intent, failureClass] of cases) {
      expect(verdictOf(work(run, chain, { pointerIntent: intent })))
        .toEqual({ row: 'AV-12', verdict: { kind: 'requeue', failureClass, retryAfterRefusal: false } });
    }
    // A reverify refusal on a check_failed work head does not change AV-12.
    expect(verdictOf(work(failed, headOf(FAIL), { reverifyRefusal: reverifyRefusal('round-1', 'no_new_basis', { failureClass: 'check_failed' }) })).row)
      .toBe('AV-12');
  });
});

// ------------------------------------------------------------------------ //
// GV table                                                                  //
// ------------------------------------------------------------------------ //
describe('automationVerdict: GV-0..GV-10 (TD-9, C5, gates)', () => {
  const reverifyOf = (onlyIfSourceChanged: boolean, failureClass: ReworkFailureClass, retryAfterRefusal = false, roundId = 'round-1',
    needsFinalize = false): TaskAutomationVerdictV1 =>
    ({ kind: 'reverify', roundRef: roundRef(roundId), needsFinalize, onlyIfSourceChanged, failureClass, retryAfterRefusal });

  it('GV-0..GV-2', () => {
    expect(verdictOf(gate(headOf(FAIL), { goalDesiredState: 'paused' }))).toEqual({ row: 'GV-0', verdict: NONE });
    expect(verdictOf(gate(headOf(FAIL), { disposition: 'superseded' }))).toEqual({ row: 'GV-1', verdict: NONE });
    expect(verdictOf(gate(headOf(FAIL), { satisfied: true }))).toEqual({ row: 'GV-1', verdict: NONE });
    expect(verdictOf(gate(NO_CHAIN))).toEqual({ row: 'GV-1', verdict: NONE });
    expect(verdictOf(gate(INVALID_CHAIN)))
      .toEqual({ row: 'GV-2', verdict: { kind: 'stopped', reason: 'not_reworkable', detail: { cause: 'round_ambiguous' } } });
  });

  it('GV-3 / GV-3′ / GV-4: open heads and a clean PASS', () => {
    expect(verdictOf(gate(headOf(OPEN_INTERRUPTED)))).toEqual({ row: 'GV-3', verdict: reverifyOf(false, 'check_incomplete', false, 'round-1', true) });
    // Every reverify verdict reports the staleness of the head-key refusal (as GV-9, GV-10 and AV-7d do);
    // GV-3 comes before GV-8, so an unexpired one does not stop it.
    const refusal = reverifyRefusal('round-1', 'no_new_basis');
    expect(verdictOf(gate(headOf(OPEN_INTERRUPTED), { reverifyRefusal: refusal, goalEndedRuns: 5 })))
      .toEqual({ row: 'GV-3', verdict: reverifyOf(false, 'check_incomplete', true, 'round-1', true) });
    expect(verdictOf(gate(headOf(OPEN_INTERRUPTED), { reverifyRefusal: refusal })))
      .toEqual({ row: 'GV-3', verdict: reverifyOf(false, 'check_incomplete', false, 'round-1', true) });
    expect(verdictOf(gate(headOf(OPEN_PENDING)))).toEqual({ row: 'GV-3′', verdict: NONE });
    expect(verdictOf(gate(headOf(OPEN_MIXED)))).toEqual({ row: 'GV-3′', verdict: NONE });
    expect(verdictOf(gate(headOf(PASS)))).toEqual({ row: 'GV-4', verdict: NONE });
    // GV-4 comes before GV-5: a clean PASS awaits completion even while a fix Task is open.
    expect(verdictOf(gate(headOf(PASS), { fixInProgress: true }))).toEqual({ row: 'GV-4', verdict: NONE });
  });

  it('GV-5: a required fix Task in progress', () => {
    expect(verdictOf(gate(headOf(FAIL), { fixInProgress: true }))).toEqual({ row: 'GV-5', verdict: NONE });
    expect(verdictOf(gate(chainAt(2, INCONCLUSIVE, 3), { fixInProgress: true })).row).toBe('GV-5');
  });

  it('GV-6: cap on the gate chain count; host_interruption exempt', () => {
    expect(verdictOf(gate(chainAt(2, FAIL, 3))))
      .toEqual({ row: 'GV-6', verdict: { kind: 'stopped', reason: 'auto_rework_cap_reached', detail: { operation: 'reverify' } } });
    expect(verdictOf(gate(chainAt(2, HOST_INTERRUPTED, 3))).row).toBe('GV-10');
    expect(verdictOf(gate(chainAt(2, FAIL, 3)), 4).row).toBe('GV-9');
    // not_started is counted (§13.7): it stops at the cap like any other INCONCLUSIVE head.
    expect(verdictOf(gate(chainAt(2, NOT_STARTED, 3))))
      .toEqual({ row: 'GV-6', verdict: { kind: 'stopped', reason: 'auto_rework_cap_reached', detail: { operation: 'reverify' } } });
    expect(verdictOf(gate(chainAt(2, NOT_STARTED, 2))).row).toBe('GV-10');
  });

  it('GV-7: ROUND_CHAIN_MAX; one below it still reverifies', () => {
    expect(verdictOf(gate(chainAt(ROUND_CHAIN_MAX, FAIL))))
      .toEqual({ row: 'GV-7', verdict: { kind: 'stopped', reason: 'not_reworkable', detail: { cause: 'round_chain_limit' } } });
    expect(verdictOf(gate(chainAt(ROUND_CHAIN_MAX - 1, FAIL))))
      .toEqual({ row: 'GV-9', verdict: reverifyOf(true, 'check_failed', false, `round-${ROUND_CHAIN_MAX - 1}`) });
  });

  it('GV-8: the code filter (no_new_basis, verification_uncovered; source_unchanged only on a FAIL head)', () => {
    for (const code of ['no_new_basis', 'verification_uncovered'] as const) {
      for (const shape of [FAIL, INCONCLUSIVE]) {
        expect(verdictOf(gate(headOf(shape), { reverifyRefusal: reverifyRefusal('round-1', code,
          { failureClass: shape === FAIL ? 'check_failed' : 'check_incomplete' }) })))
          .toEqual({ row: 'GV-8', verdict: { kind: 'stopped', reason: code, detail: { operation: 'reverify' } } });
      }
    }
    expect(verdictOf(gate(headOf(FAIL), { reverifyRefusal: reverifyRefusal('round-1', 'source_unchanged', { failureClass: 'check_failed' }) })))
      .toEqual({ row: 'GV-8', verdict: { kind: 'stopped', reason: 'gate_needs_fix', detail: { operation: 'reverify',
        failingChecks: [{ checkId: 'c1', phase: 'finished', outcome: 'FAIL', cause: null, reportRef: report('c1') }] } } });
    // On an INCONCLUSIVE head the automatic request never carries onlyIfSourceChanged.
    expect(verdictOf(gate(headOf(INCONCLUSIVE), { reverifyRefusal: reverifyRefusal('round-1', 'source_unchanged') })))
      .toEqual({ row: 'GV-10', verdict: reverifyOf(false, 'check_incomplete') });
    // A requeue refusal whose subjectId equals the head roundId is not the head's reverify refusal.
    expect(verdictOf(gate(headOf(INCONCLUSIVE), { reverifyRefusal: requeueRefusal('round-1', 'no_new_basis') })))
      .toEqual({ row: 'GV-10', verdict: reverifyOf(false, 'check_incomplete') });
    // A stored cap refusal does not stop after the cap was raised.
    expect(verdictOf(gate(headOf(FAIL), { reverifyRefusal: reverifyRefusal('round-1', 'auto_rework_cap_reached', { failureClass: 'check_failed' }) })))
      .toEqual({ row: 'GV-9', verdict: reverifyOf(true, 'check_failed') });
    // Stale (the fix Task's Run ended): retry once.
    expect(verdictOf(gate(headOf(FAIL), { goalEndedRuns: 5,
      reverifyRefusal: reverifyRefusal('round-1', 'source_unchanged', { failureClass: 'check_failed' }) })))
      .toEqual({ row: 'GV-9', verdict: reverifyOf(true, 'check_failed', true) });
  });

  it('GV-9 / GV-10', () => {
    expect(verdictOf(gate(headOf(FAIL)))).toEqual({ row: 'GV-9', verdict: reverifyOf(true, 'check_failed') });
    expect(verdictOf(gate(headOf(INCONCLUSIVE)))).toEqual({ row: 'GV-10', verdict: reverifyOf(false, 'check_incomplete') });
    expect(verdictOf(gate(chainAt(3, FAIL, 1)))).toEqual({ row: 'GV-9', verdict: reverifyOf(true, 'check_failed', false, 'round-3') });
  });
});

// ------------------------------------------------------------------------ //
// Read model                                                                //
// ------------------------------------------------------------------------ //
describe('buildTaskFailureFacts (C1, TaskRow.failure / TaskRow.rework)', () => {
  // LD-1: the owner injects the verdict; here the AV/GV judgement 5.8/5.9 will wire.
  const facts = (input: WorkFailureInputV1 | GateFailureInputV1, limit = 3) =>
    buildTaskFailureFacts(input, policy(limit), automationVerdict(input, policy(limit)).verdict);
  const failureOf = (input: WorkFailureInputV1 | GateFailureInputV1, limit = 3): TaskFailureFactsV1 => {
    const failure = facts(input, limit).failure;
    if (failure === null) throw new Error('expected failure facts');
    return failure;
  };
  const entered = (runId: string, over: Partial<RunSnapshot> = {}): Partial<RunSnapshot> => ({ executionHistory: { schemaVersion: 1,
    sessionRef: SESSION, kernel: { adapterId: 'kernel', kernelSessionId: 'ks-1', runId, turnId: 'turn-1' }, startPosition: 0,
    observedThroughPosition: 6, endPosition: 6 }, ...over });

  it('failure is absent while running, when satisfied and without a Run (outside P15); a gate needs a chain', () => {
    expect(facts(work(runOf('run-1', { status: 'running', outcome: null, endedAt: null })))).toEqual({ failure: null, rework: null });
    expect(facts(work(ended('run-1', 'completed'), headOf(PASS), { satisfied: true })).failure).toBeNull();
    expect(facts(work(null))).toEqual({ failure: null, rework: null });
    expect(facts(gate(NO_CHAIN)).failure).toBeNull();
    expect(facts(gate(headOf(PASS), { satisfied: true })).failure).toBeNull();
    // Ready and verifying Tasks show facts without a class or a cause.
    const ready = failureOf(work(ended('run-1', 'yielded', { continuation: CONTINUATION('run-1') })));
    expect([ready.failureClass, ready.notReworkableCause, ready.automation.verdict]).toEqual([null, null, NONE]);
  });

  it('a check FAIL: the full facts', () => {
    const run = ended('run-1', 'completed', entered('run-1', { exitCode: 1, terminalPayload: { kind: 'completed', exitCode: 1 } }));
    expect(facts(work(run, headOf(FAIL)))).toEqual({
      failure: {
        subjectKind: 'work', runRef: runRef('run-1'), runRevision: 4,
        attemptRef: { aggregateType: 'TaskAttempt', projectId: P, goalId: G, taskId: T, attemptId: 'run-1-attempt' },
        sessionRef: SESSION, failureClass: 'check_failed', notReworkableCause: null,
        run: { outcome: 'completed', endedAt: time(5), budget: { tokenBudget: 1000, deadline: null }, origin: 'observed',
          error: null, errorSource: 'not_recorded' },
        interruption: null, stop: null,
        round: { roundRef: roundRef('round-1'), revision: 3, status: 'finalized', outcome: 'FAIL',
          failingChecks: [{ checkId: 'c1', phase: 'finished', outcome: 'FAIL', cause: null, reportRef: report('c1') }], gapCodes: [],
          sourceDigest: sha('S1'), workspaceRevision: 3, ordinal: 1, autoCount: 0 },
        source: { atFailure: { workspaceRevision: 3, sourceDigest: sha('S1') }, lastChecked: null, sinceFailure: 'unknown' },
        requeueActors: ALL, reverifyActors: ALL,
        automation: { cap: 3, requeueAutoCount: 0, coveringRequeue: null, lastRefusal: null, lastReverifyRefusal: null,
          verdict: { kind: 'requeue', failureClass: 'check_failed', retryAfterRefusal: false } },
      },
      rework: null,
    });
  });

  it('a Kernel crash, a budget exhaustion, an unknown outcome', () => {
    const crash = failureOf(work(ended('run-1', 'crashed', { terminalPayload: { kind: 'crashed', error: 'segfault' } })));
    expect(crash).toMatchObject({ failureClass: 'run_failed', notReworkableCause: null, sessionRef: null, round: null,
      run: { outcome: 'crashed', origin: 'observed', error: 'segfault', errorSource: 'terminal_payload' },
      source: { atFailure: null, lastChecked: null, sinceFailure: 'unknown' }, requeueActors: ALL, reverifyActors: [] });
    const exhausted = failureOf(work(ended('run-1', 'budget_exhausted')));
    expect(exhausted).toMatchObject({ failureClass: 'run_failed', requeueActors: ALL,
      automation: { verdict: { kind: 'stopped', reason: 'budget_exhausted', detail: { minTokenBudgetExclusive: 1000 } } } });
    const unknown = failureOf(work(ended('run-1', 'outcome_unknown')));
    expect(unknown).toMatchObject({ failureClass: null, notReworkableCause: 'run_outcome_unknown', run: { outcome: 'outcome_unknown' },
      requeueActors: [], reverifyActors: [], automation: { verdict: { kind: 'stopped', reason: 'unknown_outcome' } } });
    expect(failureOf(work(humanAttested('run-1'))).run).toMatchObject({ origin: 'human_attested', error: 'human_attested: machine lost' });
  });

  it('a human cancel: stop facts, only a human may requeue', () => {
    const cancel = intentOf('cancel-h', 'cancel', HOST_SYSTEM);
    const failure = failureOf(work(ended('run-1', 'cancelled', pointing(cancel)), NO_CHAIN, { pointerIntent: cancel }));
    expect(failure).toMatchObject({ failureClass: 'cancelled', interruption: null,
      stop: { intentRef: cancel.ref, kind: 'cancel', requestedBy: HOST_SYSTEM, requester: 'human' },
      requeueActors: ['human'], reverifyActors: [],
      automation: { verdict: { kind: 'stopped', reason: 'task_cancelled', detail: { fence: 'human_cancel' } } } });
    const automatic = intentOf('cancel-w', 'cancel', WORKFLOW);
    expect(failureOf(work(ended('run-1', 'cancelled', pointing(automatic)), NO_CHAIN, { pointerIntent: automatic })).requeueActors)
      .toEqual(['human', 'system']);
    // A resume pointer is not a stop.
    const resume = intentOf('resume-h', 'resume', HUMAN);
    expect(failureOf(work(ended('run-1', 'crashed', pointing(resume)), NO_CHAIN, { pointerIntent: resume })).stop).toBeNull();
  });

  it('RUN-19 interrupted while executing, RUN-24 paused-interrupted (C4)', () => {
    const executing = failureOf(work(hostInterrupted('run-1', null)));
    expect(executing).toMatchObject({ failureClass: 'interrupted',
      interruption: { kind: 'executing', kernelPaused: false, pausedIntentRef: null, pausedBy: null },
      run: { origin: 'host_interrupted', error: 'host_interrupted', errorSource: 'terminal_payload' }, requeueActors: ALL,
      automation: { verdict: { kind: 'requeue', failureClass: 'interrupted', retryAfterRefusal: false } } });
    const humanPause = intentOf('pause-h', 'pause', HUMAN);
    expect(failureOf(work(hostInterrupted('run-1', humanPause), NO_CHAIN, { pointerIntent: humanPause }))).toMatchObject({
      failureClass: 'interrupted', interruption: { kind: 'paused', kernelPaused: true, pausedIntentRef: humanPause.ref, pausedBy: 'human' },
      run: { outcome: 'crashed', origin: 'host_interrupted' }, stop: { kind: 'pause', requester: 'human' }, requeueActors: ['human'] });
    // RUN-23 (a queued cancel on a clean Turn at restart) is a cancel, origin `observed`, not an interruption (ND-5).
    const queuedCancel = intentOf('cancel-w', 'cancel', WORKFLOW);
    expect(failureOf(work(reconcileCancelled('run-1', queuedCancel), NO_CHAIN, { pointerIntent: queuedCancel }))).toMatchObject({
      failureClass: 'cancelled', interruption: null, run: { outcome: 'cancelled', origin: 'observed', error: 'cancel requested',
        errorSource: 'reconciliation_event' }, stop: { kind: 'cancel', requester: 'system' }, requeueActors: ['human', 'system'] });
    // A Goal fan-out pause: the fan-out continuation needs a trigger, so the standing classes are only human.
    const fanOutPause = intentOf('pause-f', 'pause', FAN_OUT);
    expect(failureOf(work(hostInterrupted('run-1', fanOutPause), NO_CHAIN, { pointerIntent: fanOutPause }))).toMatchObject({
      interruption: { kind: 'paused', pausedBy: 'goal_fan_out' }, requeueActors: ['human'],
      automation: { verdict: { kind: 'stopped', reason: 'task_paused', detail: { pausedBy: 'goal_fan_out' } } } });
  });

  it('requeueActors / reverifyActors intersect the state preconditions', () => {
    const completed = ended('run-1', 'completed');
    const actors = (input: WorkFailureInputV1) => {
      const failure = failureOf(input);
      return [failure.requeueActors, failure.reverifyActors];
    };
    expect(actors(work(completed, headOf(FAIL)))).toEqual([ALL, ALL]);
    expect(actors(work(completed, headOf(INCONCLUSIVE)))).toEqual([['human'], ALL]);
    expect(actors(work(completed, headOf(OPEN_INTERRUPTED)))).toEqual([[], []]);
    expect(actors(work(completed, headOf(OPEN_PENDING)))).toEqual([[], []]);
    expect(actors(work(completed, headOf(PASS)))).toEqual([[], []]);
    expect(actors(work(completed, NO_CHAIN))).toEqual([[], []]);
    expect(actors(work(completed, INVALID_CHAIN))).toEqual([[], []]);
    expect(actors(work(completed, headOf(FAIL), { goalDesiredState: 'paused' }))).toEqual([[], []]);
    expect(actors(work(completed, headOf(FAIL), { goalDesiredState: 'cancelled' }))).toEqual([[], []]);
    expect(actors(work(completed, headOf(FAIL), { disposition: 'deferred' }))).toEqual([[], []]);
    expect(actors(work(completed, headOf(FAIL), { requeues: [requeueOf('run-1')] }))).toEqual([[], []]);
    // A natural completion under an operator's pending pause pointer is still fenced (hard limit 3).
    const pause = intentOf('pause-h', 'pause', HUMAN);
    expect(actors(work(ended('run-1', 'completed', pointing(pause)), headOf(FAIL), { pointerIntent: pause }))).toEqual([['human'], ['human']]);
    // The chain limit blocks only another successor round.
    const limit = failureOf(work(completed, chainAt(ROUND_CHAIN_MAX, FAIL)));
    expect([limit.failureClass, limit.notReworkableCause, limit.requeueActors, limit.reverifyActors])
      .toEqual(['check_failed', 'round_chain_limit', ALL, []]);
    // One below the limit the last successor round may still open.
    const belowLimit = failureOf(work(completed, chainAt(ROUND_CHAIN_MAX - 1, FAIL)));
    expect([belowLimit.failureClass, belowLimit.notReworkableCause, belowLimit.requeueActors, belowLimit.reverifyActors])
      .toEqual(['check_failed', null, ALL, ALL]);
    // A subject Run reconciled as quarantined cannot be reverified; FC-2 cannot be requeued.
    const quarantined = ended('run-1', 'completed', { reconciliation: reconciliation({ kind: 'runtime_terminal',
      event: runtimeEvent('run-1', { kind: 'completed', exitCode: 0 }), digest: sha('9') }, 'quarantined') });
    expect(actors(work(quarantined, headOf(FAIL)))).toEqual([[], []]);
    // VR-14 step 3 and hard limit 1: a runUnresolvedBlocker without a quarantined reconciliation (an unknown
    // entry authorization, or a `done` reconciliation that stayed unresolved) blocks the reverify too.
    expect(actors(work(authUnknownRun('run-1'), headOf(FAIL)))).toEqual([[], []]);
    expect(actors(work(unresolvedDoneRun('run-1'), headOf(FAIL)))).toEqual([[], []]);
    // VR-14 step 3 (VD-3): the subject Run's reconciliation is absent or `done`. A `cancelled` reconciliation
    // is no runUnresolvedBlocker, so the Run may still be requeued but not reverified.
    const reconciledAs = (status: RunReconciliationV1['status']) => ended('run-1', 'completed', { reconciliation: reconciliation({
      kind: 'runtime_terminal', event: runtimeEvent('run-1', { kind: 'completed', exitCode: 0 }), digest: sha('9') }, status) });
    expect(actors(work(reconciledAs('cancelled'), headOf(FAIL)))).toEqual([ALL, []]);
    expect(actors(work(reconciledAs('done'), headOf(FAIL)))).toEqual([ALL, ALL]);
    // Non-active Tasks keep their facts; only the verdict and the actors stop.
    expect(failureOf(work(completed, headOf(FAIL), { disposition: 'superseded' })).failureClass).toBe('check_failed');
  });

  it('P15: an unresolvable origin without a selected Run', () => {
    expect(facts(work(null, NO_CHAIN, { originUnresolvable: true }))).toEqual({
      failure: {
        subjectKind: 'work', runRef: null, runRevision: null, attemptRef: null, sessionRef: null, failureClass: null,
        notReworkableCause: 'origin_unresolvable', run: null, interruption: null, stop: null, round: null,
        source: { atFailure: null, lastChecked: null, sinceFailure: 'unknown' }, requeueActors: [], reverifyActors: [],
        automation: { cap: 3, requeueAutoCount: 0, coveringRequeue: null, lastRefusal: null, lastReverifyRefusal: null,
          verdict: { kind: 'stopped', reason: 'not_reworkable', detail: { cause: 'origin_unresolvable' } } },
      },
      rework: null,
    });
  });

  it('source: the head stamp against the latest refusal capture', () => {
    const completed = ended('run-1', 'completed');
    const same = { workspaceRevision: 4, sourceDigest: sha('S1') };
    const other = { workspaceRevision: 5, sourceDigest: sha('S2') };
    const withRefusal = (source: typeof same, refusedAt: string) => reverifyRefusal('round-1', 'no_new_basis', { source, refusedAt,
      failureClass: 'check_failed' });
    expect(failureOf(work(completed, headOf(FAIL), { reverifyRefusal: withRefusal(same, time(8)) })).source)
      .toEqual({ atFailure: { workspaceRevision: 3, sourceDigest: sha('S1') }, lastChecked: same, sinceFailure: 'unchanged' });
    expect(failureOf(work(completed, headOf(FAIL), { reverifyRefusal: withRefusal(other, time(8)) })).source.sinceFailure).toBe('changed');
    // The later of the two refusals wins; a cap refusal captured nothing.
    const requeueNoBasis = requeueRefusal('run-1', 'no_new_basis', { source: other, refusedAt: time(9) });
    expect(failureOf(work(completed, headOf(FAIL), { reverifyRefusal: withRefusal(same, time(8)), requeueRefusal: requeueNoBasis })).source)
      .toMatchObject({ lastChecked: other, sinceFailure: 'changed' });
    expect(failureOf(work(completed, headOf(FAIL), { requeueRefusal: requeueRefusal('run-1', 'auto_rework_cap_reached') })).source.lastChecked)
      .toBeNull();
    // A later refusal that captured nothing (cap) does not hide an earlier capture, in either slot.
    const laterCap = requeueRefusal('run-1', 'auto_rework_cap_reached', { refusedAt: time(9) });
    expect(failureOf(work(completed, headOf(FAIL), { reverifyRefusal: withRefusal(other, time(8)), requeueRefusal: laterCap })).source)
      .toMatchObject({ lastChecked: other, sinceFailure: 'changed' });
    const earlierNoBasis = requeueRefusal('run-1', 'no_new_basis', { source: other, refusedAt: time(8) });
    const laterReverifyCap = reverifyRefusal('round-1', 'auto_rework_cap_reached', { failureClass: 'check_failed', refusedAt: time(9) });
    expect(failureOf(work(completed, headOf(FAIL), { requeueRefusal: earlierNoBasis, reverifyRefusal: laterReverifyCap })).source)
      .toMatchObject({ lastChecked: other, sinceFailure: 'changed' });
    // A Run-level failure has no stamp at failure (GAP-49).
    expect(failureOf(work(ended('run-1', 'failed'), NO_CHAIN, { requeueRefusal: requeueNoBasis })).source)
      .toEqual({ atFailure: null, lastChecked: other, sinceFailure: 'unknown' });
  });

  it('automation: the refusal facts with staleness, the covering requeue and the chain count', () => {
    const refusal = requeueRefusal('run-1', 'no_new_basis');
    const failure = failureOf(work(ended('run-1', 'completed'), headOf(FAIL), { requeueRefusal: refusal,
      reverifyRefusal: reverifyRefusal('round-1', 'source_unchanged', { failureClass: 'check_failed', goalEndedRunsAtRefusal: 3 }) }));
    expect(failure.automation).toMatchObject({ cap: 3, requeueAutoCount: 0, coveringRequeue: null,
      lastRefusal: { revision: 1, code: 'no_new_basis', stale: false }, lastReverifyRefusal: { code: 'source_unchanged', stale: true },
      verdict: { kind: 'stopped', reason: 'no_new_basis' } });
    expect(failureOf(work(ended('run-1', 'completed'), headOf(FAIL), { requeues: [requeueOf('run-1')] }), 7).automation)
      .toMatchObject({ cap: 7, coveringRequeue: requeueRefOf('run-1') });
  });

  it('rework: present with any TaskRequeue or refusal, entries in Run-chain order', () => {
    const rq1 = requeueOf('run-1', { requestedAt: time(30), automation: { automatic: true, counted: true, autoCount: 1, cap: 3 } });
    const rq2 = requeueOf('run-2', { requestedAt: time(10), requestedBy: HUMAN, failureClass: 'run_failed', reason: 'try again',
      automation: { automatic: false, counted: false, autoCount: 0, cap: null } });
    const rq4 = requeueOf('run-4', { requestedAt: time(20), automation: { automatic: true, counted: true, autoCount: 1, cap: 3 } });
    const run1 = ended('run-1', 'completed');
    const run2 = ended('run-2', 'crashed', { requeueRef: rq1.ref });
    const run3 = ended('run-3', 'yielded', { requeueRef: rq2.ref, continuation: CONTINUATION('run-3') });
    const run4 = ended('run-4', 'completed', { consumedWait: { runRef: runRef('run-3'),
      messageRef: { aggregateType: 'SessionMessage', projectId: P, workspaceId: W, messageId: 'msg-run-3' }, responseRef: report('reply') } });
    const result = facts(work(run4, headOf(FAIL, 'run-4'), { runs: [run4, run2, run1, run3], requeues: [rq4, rq2, rq1] }));
    expect(result.rework).toEqual({
      entries: [
        { ref: rq1.ref, afterRunRef: runRef('run-1'), failureClass: 'check_failed', requestedBy: WORKFLOW, automatic: true, autoCount: 1,
          reason: 'auto-rework:check_failed#1', requestedAt: time(30) },
        { ref: rq2.ref, afterRunRef: runRef('run-2'), failureClass: 'run_failed', requestedBy: HUMAN, automatic: false, autoCount: 0,
          reason: 'try again', requestedAt: time(10) },
        { ref: rq4.ref, afterRunRef: runRef('run-4'), failureClass: 'check_failed', requestedBy: WORKFLOW, automatic: true, autoCount: 1,
          reason: 'auto-rework:check_failed#1', requestedAt: time(20) },
      ],
      // run-4 consumed run-3's wait; run-3 was claimed by the human requeue rq2 (count reset).
      requeueAutoCount: 0,
      cap: 3,
    });
    expect(result.failure?.automation).toMatchObject({ requeueAutoCount: 0, coveringRequeue: rq4.ref, verdict: { kind: 'claim_requeued' } });
    // Records off the chain follow by requestedAt.
    const loose = facts(work(run1, headOf(FAIL), { requeues: [requeueOf('run-9', { requestedAt: time(40) }), requeueOf('run-8', { requestedAt: time(35) })] }));
    expect(loose.rework?.entries.map((entry) => entry.ref.afterRunId)).toEqual(['run-8', 'run-9']);
    // A refusal alone makes `rework` appear with no entries: a requeue refusal of the selected Run, or a
    // reverify refusal of the head (§4.1 "何时出现").
    expect(facts(work(run1, headOf(FAIL), { requeueRefusal: requeueRefusal('run-1', 'no_new_basis') })).rework)
      .toEqual({ entries: [], requeueAutoCount: 0, cap: 3 });
    expect(facts(work(run1, headOf(FAIL), { reverifyRefusal: reverifyRefusal('round-1', 'no_new_basis', { failureClass: 'check_failed' }) })).rework)
      .toEqual({ entries: [], requeueAutoCount: 0, cap: 3 });
    // A refusal under another key (here a requeue refusal in the head's reverify slot) is not this Task's.
    const misfiled = facts(work(run1, headOf(INCONCLUSIVE), { reverifyRefusal: requeueRefusal('round-1', 'no_new_basis') }));
    expect([misfiled.rework, misfiled.failure?.automation.lastReverifyRefusal, misfiled.failure?.automation.verdict.kind])
      .toEqual([null, null, 'reverify']);
  });

  it('a gate: facts from its own chain anchored on the producer Run', () => {
    expect(facts(gate(headOf(FAIL)))).toEqual({
      failure: {
        subjectKind: 'gate', runRef: runRef('run-1'), runRevision: 4,
        attemptRef: { aggregateType: 'TaskAttempt', projectId: P, goalId: G, taskId: T, attemptId: 'run-1-attempt' },
        sessionRef: null, failureClass: 'check_failed', notReworkableCause: null,
        run: { outcome: 'completed', endedAt: time(5), budget: { tokenBudget: 1000, deadline: null }, origin: 'observed', error: null,
          errorSource: 'not_recorded' },
        interruption: null, stop: null,
        round: { roundRef: roundRef('round-1'), revision: 3, status: 'finalized', outcome: 'FAIL',
          failingChecks: [{ checkId: 'c1', phase: 'finished', outcome: 'FAIL', cause: null, reportRef: report('c1') }], gapCodes: [],
          sourceDigest: sha('S1'), workspaceRevision: 3, ordinal: 1, autoCount: 0 },
        source: { atFailure: { workspaceRevision: 3, sourceDigest: sha('S1') }, lastChecked: null, sinceFailure: 'unknown' },
        requeueActors: [], reverifyActors: ALL,
        automation: { cap: 3, requeueAutoCount: 0, coveringRequeue: null, lastRefusal: null, lastReverifyRefusal: null,
          verdict: { kind: 'reverify', roundRef: roundRef('round-1'), needsFinalize: false, onlyIfSourceChanged: true,
            failureClass: 'check_failed', retryAfterRefusal: false } },
      },
      rework: null,
    });
    expect(failureOf(gate(headOf(OPEN_INTERRUPTED)))).toMatchObject({ failureClass: 'check_incomplete', reverifyActors: [] });
    expect(failureOf(gate(headOf(OPEN_PENDING)))).toMatchObject({ failureClass: null, notReworkableCause: null });
    expect(failureOf(gate(INVALID_CHAIN))).toMatchObject({ failureClass: null, notReworkableCause: 'round_ambiguous', round: null,
      runRef: runRef('run-1') });
    expect(failureOf(gate(chainAt(ROUND_CHAIN_MAX, INCONCLUSIVE)))).toMatchObject({ failureClass: 'check_incomplete',
      notReworkableCause: 'round_chain_limit', reverifyActors: [] });
    expect(failureOf(gate(chainAt(ROUND_CHAIN_MAX - 1, INCONCLUSIVE)))).toMatchObject({ failureClass: 'check_incomplete',
      notReworkableCause: null, reverifyActors: ALL });
    expect(failureOf(gate(headOf(FAIL), { goalDesiredState: 'paused' })).reverifyActors).toEqual([]);
    expect(failureOf(gate(headOf(FAIL), { anchorRun: null }))).toMatchObject({ runRef: runRef('run-1'), runRevision: null, run: null,
      reverifyActors: [] });
    // The anchored producer must be reconciled `done` or not at all (VR-14 step 3, VD-3).
    const cancelledReconciliation = runOf('run-1', { reconciliation: reconciliation({ kind: 'runtime_terminal',
      event: runtimeEvent('run-1', { kind: 'completed', exitCode: 0 }), digest: sha('9') }, 'cancelled') });
    expect(failureOf(gate(headOf(FAIL), { anchorRun: cancelledReconciliation })).reverifyActors).toEqual([]);
    // An anchored producer with a runUnresolvedBlocker (hard limit 1).
    expect(failureOf(gate(headOf(FAIL), { anchorRun: authUnknownRun('run-1') })).reverifyActors).toEqual([]);
    // VD-9: a gate that is not `active` keeps its facts but nobody may reverify it.
    for (const disposition of ['deferred', 'cancelled', 'superseded'] as const) {
      const inactive = failureOf(gate(headOf(FAIL), { disposition }));
      expect([disposition, inactive.failureClass, inactive.reverifyActors]).toEqual([disposition, 'check_failed', []]);
    }
    const withRefusal = facts(gate(headOf(FAIL), { reverifyRefusal: reverifyRefusal('round-1', 'source_unchanged', { failureClass: 'check_failed' }) }));
    expect(withRefusal.rework).toEqual({ entries: [], requeueAutoCount: 0, cap: 3 });
    expect(withRefusal.failure?.automation.verdict).toMatchObject({ kind: 'stopped', reason: 'gate_needs_fix' });
  });

  it('the verdict on the facts is automationVerdict for the same input', () => {
    const inputs: Array<WorkFailureInputV1 | GateFailureInputV1> = [
      work(ended('run-1', 'completed'), headOf(INCONCLUSIVE)), work(hostInterrupted('run-1', null)), work(ended('run-1', 'cancelled')),
      work(ended('run-1', 'completed'), chainAt(2, INCONCLUSIVE, 3)), gate(headOf(FAIL)), gate(headOf(INCONCLUSIVE)), gate(INVALID_CHAIN),
    ];
    for (const input of inputs) {
      expect(facts(input).failure?.automation.verdict).toEqual(verdictOf(input).verdict);
    }
  });
});

// ------------------------------------------------------------------------ //
// TaskReworkRefusal@k                                                       //
// ------------------------------------------------------------------------ //
describe('newTaskReworkRefusalRecord (§14.1, I-18)', () => {
  it('∅→@1 in contract key order', () => {
    const record = newTaskReworkRefusalRecord(refusalInput('requeue', 'run-1', 'auto_rework_cap_reached'));
    expect(JSON.stringify(record)).toBe(JSON.stringify({
      ref: { aggregateType: 'TaskReworkRefusal', projectId: P, goalId: G, taskId: T, operation: 'requeue', subjectId: 'run-1' },
      revision: 1, schemaVersion: 1, task, afterRunRef: runRef('run-1'), subjectRoundRef: null, failureClass: 'check_failed',
      code: 'auto_rework_cap_reached', reason: 'refused: auto_rework_cap_reached', basisDigest: null, source: null,
      matchedRequeueRef: null, requestedBy: WORKFLOW, refusedAt: time(7), goalEndedRunsAtRefusal: 4, configurationRevision: null,
    }));
  });

  it('@k→@k+1 under the same key; the watermark never decreases', () => {
    const first = reverifyRefusal('round-1', 'no_new_basis');
    const second = newTaskReworkRefusalRecord(refusalInput('reverify', 'round-1', 'no_new_basis', { current: first,
      goalEndedRunsAtRefusal: 6, refusedAt: time(9) }));
    expect(second).toMatchObject({ revision: 2, goalEndedRunsAtRefusal: 6, configurationRevision: 'cfg-1', subjectRoundRef: roundRef('round-1') });
    const third = newTaskReworkRefusalRecord(refusalInput('reverify', 'round-1', 'verification_uncovered', { current: second,
      goalEndedRunsAtRefusal: 6 }));
    expect(third.revision).toBe(3);
  });

  it('every legal (operation, code) pair builds', () => {
    const legal: Array<[TaskReworkOperation, TaskReworkRefusalCode]> = [
      ['requeue', 'no_new_basis'], ['requeue', 'auto_rework_cap_reached'], ['requeue', 'budget_not_increased'],
      ['reverify', 'no_new_basis'], ['reverify', 'auto_rework_cap_reached'], ['reverify', 'source_unchanged'],
      ['reverify', 'verification_uncovered'],
    ];
    for (const [operation, code] of legal) {
      const subject = operation === 'requeue' ? 'run-1' : 'round-1';
      expect(newTaskReworkRefusalRecord(refusalInput(operation, subject, code))).toMatchObject({ code, revision: 1 });
    }
    // An agent cap refusal, a human budget refusal.
    expect(newTaskReworkRefusalRecord(refusalInput('requeue', 'run-1', 'auto_rework_cap_reached', { requestedBy: AGENT })).requestedBy).toEqual(AGENT);
    expect(newTaskReworkRefusalRecord(refusalInput('requeue', 'run-1', 'budget_not_increased', { requestedBy: HUMAN })).code)
      .toBe('budget_not_increased');
  });

  it('cuts a long platform reason to TASK_REWORK_REASON_MAX_CHARS', () => {
    const record = newTaskReworkRefusalRecord(refusalInput('requeue', 'run-1', 'no_new_basis', { reason: 'x'.repeat(2500) }));
    expect(record.reason.length).toBe(TASK_REWORK_REASON_MAX_CHARS);
  });

  it.each<[string, TaskReworkOperation, string, TaskReworkRefusalCode, Partial<NewTaskReworkRefusalInputV1>, string]>([
    ['a key of another Task', 'requeue', 'run-1', 'no_new_basis', { task: { ...task, taskId: 'other' } }, 'the refusal key must name the refused Task'],
    ['a requeue keyed by another Run', 'requeue', 'run-2', 'no_new_basis', { afterRunRef: runRef('run-1') }, 'a requeue refusal is keyed by its afterRun id'],
    ['a reverify keyed by another round', 'reverify', 'round-1', 'no_new_basis', { subjectRoundRef: roundRef('round-2') },
      'a reverify refusal is keyed by its predecessor round id'],
    ['a reverify without a round', 'reverify', 'round-1', 'source_unchanged', { subjectRoundRef: null }, 'a reverify refusal is keyed by its predecessor round id'],
    ['budget_not_increased on reverify', 'reverify', 'round-1', 'budget_not_increased', {}, 'budget_not_increased is a requeue-only refusal'],
    ['source_unchanged on requeue', 'requeue', 'run-1', 'source_unchanged', {}, 'source_unchanged is a reverify-only refusal'],
    ['verification_uncovered on requeue', 'requeue', 'run-1', 'verification_uncovered', {}, 'verification_uncovered is a reverify-only refusal'],
    ['class interrupted', 'requeue', 'run-1', 'auto_rework_cap_reached', { failureClass: 'interrupted' },
      'class interrupted skips budget, cap and key and is never refused'],
    ['a Run class on reverify', 'reverify', 'round-1', 'auto_rework_cap_reached', { failureClass: 'run_failed' },
      'a reverify refusal has a round class, not run_failed'],
    ['a requeue no_new_basis without its match', 'requeue', 'run-1', 'no_new_basis', { matchedRequeueRef: null },
      'matchedRequeueRef is set exactly on a requeue no_new_basis refusal'],
    ['a match on a cap refusal', 'requeue', 'run-1', 'auto_rework_cap_reached', { matchedRequeueRef: requeueRefOf('run-0') },
      'matchedRequeueRef is set exactly on a requeue no_new_basis refusal'],
    ['a match of another Task', 'requeue', 'run-1', 'no_new_basis', { matchedRequeueRef: { ...requeueRefOf('run-0'), taskId: 'other' } },
      'matchedRequeueRef belongs to another Task'],
    ['a configuration revision on requeue', 'requeue', 'run-1', 'no_new_basis', { configurationRevision: 'cfg-1' },
      'configurationRevision is set exactly on a reverify no_new_basis or verification_uncovered refusal'],
    ['no configuration revision on verification_uncovered', 'reverify', 'round-1', 'verification_uncovered', { configurationRevision: null },
      'configurationRevision is set exactly on a reverify no_new_basis or verification_uncovered refusal'],
    ['a configuration revision on source_unchanged', 'reverify', 'round-1', 'source_unchanged', { configurationRevision: 'cfg-1' },
      'configurationRevision is set exactly on a reverify no_new_basis or verification_uncovered refusal'],
    ['a cap refusal with a source', 'requeue', 'run-1', 'auto_rework_cap_reached', { source: { workspaceRevision: 1, sourceDigest: sha('1') } },
      'a auto_rework_cap_reached refusal captures no source and no key'],
    ['a budget refusal with a key', 'requeue', 'run-1', 'budget_not_increased', { basisDigest: sha('b') },
      'a budget_not_increased refusal captures no source and no key'],
    ['no_new_basis without a key', 'requeue', 'run-1', 'no_new_basis', { basisDigest: null },
      'a no_new_basis refusal carries its key digest and source'],
    ['source_unchanged without a capture', 'reverify', 'round-1', 'source_unchanged', { source: null },
      'a source_unchanged refusal carries the captured source'],
    ['a cap refusal of an operator', 'requeue', 'run-1', 'auto_rework_cap_reached', { requestedBy: HOST_SYSTEM }, 'the cap only refuses an automatic actor'],
    ['an empty reason', 'requeue', 'run-1', 'auto_rework_cap_reached', { reason: '' }, 'the refusal reason must be non-empty'],
    ['a negative watermark', 'requeue', 'run-1', 'auto_rework_cap_reached', { goalEndedRunsAtRefusal: -1 },
      'goalEndedRunsAtRefusal must be a non-negative safe integer'],
    ['a Run of another Goal', 'requeue', 'run-1', 'auto_rework_cap_reached', { afterRunRef: { ...runRef('run-1'), goalId: 'other' } },
      'the refused Run belongs to another Goal'],
  ])('refuses %s', (_name, operation, subject, code, over, message) => {
    expect(() => newTaskReworkRefusalRecord(refusalInput(operation, subject, code, over))).toThrow(`newTaskReworkRefusalRecord: ${message}`);
  });

  it('refuses a current record of another key and a decreasing watermark', () => {
    const current = requeueRefusal('run-1', 'no_new_basis', { goalEndedRunsAtRefusal: 5 });
    expect(() => newTaskReworkRefusalRecord(refusalInput('requeue', 'run-2', 'no_new_basis', { current })))
      .toThrow('newTaskReworkRefusalRecord: the current record belongs to another refusal key');
    expect(() => newTaskReworkRefusalRecord(refusalInput('requeue', 'run-1', 'no_new_basis', { current, goalEndedRunsAtRefusal: 4 })))
      .toThrow('newTaskReworkRefusalRecord: goalEndedRunsAtRefusal never decreases under one key');
  });

  it('taskReworkRefusalEffects: the CAS revision and the TaskReworkRefused event', () => {
    const first = taskReworkRefusalEffects(refusalInput('requeue', 'run-1', 'no_new_basis'));
    expect(first).toEqual([
      { kind: 'write_task_rework_refusal', refusal: requeueRefusal('run-1', 'no_new_basis'), expectedRevision: null },
      { kind: 'append_event', eventType: 'TaskReworkRefused' },
    ]);
    const current: TaskReworkRefusalSnapshotV1 = requeueRefusal('run-1', 'no_new_basis');
    const next = taskReworkRefusalEffects(refusalInput('requeue', 'run-1', 'no_new_basis', { current }));
    expect(next[0]).toMatchObject({ kind: 'write_task_rework_refusal', refusal: { revision: 2 }, expectedRevision: 1 });
    // VR-14 uses the same two effects for a reverify refusal.
    const reverify = taskReworkRefusalEffects(refusalInput('reverify', 'round-1', 'verification_uncovered'));
    expect(reverify).toEqual([
      { kind: 'write_task_rework_refusal', refusal: reverifyRefusal('round-1', 'verification_uncovered'), expectedRevision: null },
      { kind: 'append_event', eventType: 'TaskReworkRefused' },
    ]);
  });
});

/** Type-level: a full ControlIntent snapshot is an acceptable pointer input. */
const _pointer: StopIntentV1 = intentOf('type-only', 'pause', HUMAN);
void _pointer;
