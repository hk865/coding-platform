/**
 * A.2 step 2 (spec §15.2 第 2 步): the Run machine of spec §6
 * (`state/run-machine.ts`).
 *
 * - Every (node, event) combination: a legal one asserts the next node and
 *   the effects (and, for the rows that write, the record byte for byte
 *   against today's service literals); an illegal one asserts `reason` and
 *   `code` from §6.4. 新增 rows (RUN-16..24, the R source of RUN-09..11) still
 *   answer `illegal`/`invalid` naming their row; 改造 rows keep today's result.
 * - Guard rows of RUN-01..07 and RUN-09..15 in today's order, the §6.4
 *   refusals in front of the 新增 rows, and the pure helpers named by §6.6 /
 *   §15.1 (`runControlFence`, `terminalOutcomeOf`, `terminalPayloadOf`,
 *   `isPausedInterrupted`, `runUnresolvedBlocker`, `leaseOwnedByRun`).
 *
 * Pure: no RecordStore, no Kernel, no model.
 */
import { describe, expect, it } from 'vitest';
import type { ControlIntentKindV1, ControlIntentRef } from '../../src/contracts/control-intent.js';
import type { CoreError, CoreRejection } from '../../src/contracts/core/results.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import {
  TERMINAL_PAYLOAD_TEXT_MAX_CHARS, TERMINAL_PAYLOAD_TRUNCATION_SUFFIX,
  type ConsumedWaitV1, type DispatchOutboxRef, type ExecutionAuthorizationV2, type RoleBindingRefV1,
  type RunContinuationV1, type RunReconciliationV1, type RunRef, type RunSnapshot, type RuntimeEventV1,
  type RuntimeInputBindingV1, type TaskAttemptRef, type TaskLeaseSnapshot,
} from '../../src/contracts/dispatch.js';
import type { PlanRevisionRef } from '../../src/contracts/plan.js';
import type { TaskEnvelopeV1 } from '../../src/contracts/task-envelope.js';
import type { TaskRequeueRef } from '../../src/contracts/task-requeue.js';
import {
  RUN_NODES, attestedTerminalPayload, controlSubmissionRunEvent, isPausedInterrupted, isRunFinished, leaseOwnedByRun,
  newRunRecord, runCombinationProblem, runControlFence, runControlNodeOf, runNodeOf, runStateOf, runUnresolvedBlocker,
  terminalOutcomeOf, terminalPayloadOf, transitionRun,
  type RunEffect, type RunEvent, type RunGuardContext, type RunNode, type RunObservedHistory, type RunState,
  type RunTransition, type RunTurnFacts,
} from '../../src/core/work-graph/state/run-machine.js';
import { controlSubmissionProblem, transitionControlIntent } from '../../src/core/work-graph/state/control-intent-machine.js';
import type { TransitionRejectReason } from '../../src/core/work-graph/state/transition.js';

// ------------------------------------------------------------------------ //
// Fixtures                                                                  //
// ------------------------------------------------------------------------ //

const P = 'run-project', G = 'run-goal', T = 'run-task', W = 'run-workspace';
const GEN = 4;
const T_CLAIM = '2026-10-04T01:00:00.000Z';
const T_ENTER = '2026-10-04T01:01:00.000Z';
const T_END = '2026-10-04T01:02:00.000Z';
const T_LATER = '2026-10-04T01:03:00.000Z';

const runRef = (runId: string): RunRef => ({ aggregateType: 'Run', projectId: P, goalId: G, runId });
const attemptRef = (attemptId: string): TaskAttemptRef =>
  ({ aggregateType: 'TaskAttempt', projectId: P, goalId: G, taskId: T, attemptId });
const outboxRef = (attemptId: string): DispatchOutboxRef =>
  ({ aggregateType: 'DispatchOutboxEntry', projectId: P, goalId: G, taskId: T, attemptId });
const intentRef = (intentId: string): ControlIntentRef =>
  ({ aggregateType: 'ControlIntent', projectId: P, workspaceId: W, intentId });
const planRef: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: P, planId: 'plan-1' };
const sessionRef = { projectId: P, sessionId: 'ses-1' };

const claim: TaskClaim = {
  task: { projectId: P, goalId: G, taskId: T }, planRef, workspaceId: W, sessionRef, sessionRevision: GEN,
  generation: GEN, runRef: runRef('run-1'), attemptRef: attemptRef('att-1'), outboxRef: outboxRef('att-1'),
  claimedAt: T_CLAIM,
};
const roleBinding: RoleBindingRefV1 = { schemaVersion: 1, bindingId: 'binding-1', templateId: 'worker',
  templateRevision: 'r1', bindingVersion: 1, policyRevision: 'policy-1' };
const budget = { tokenBudget: 1000, deadline: null };
const CONSUMER = 'consumer-1';
const DIGEST = 'd'.repeat(64);
const inputBinding: RuntimeInputBindingV1 = { schemaVersion: 1, inputDigest: DIGEST, manifestDigest: 'e'.repeat(64),
  materialAccessRefs: [], deliveryRefs: [] };
const envelope: TaskEnvelopeV1 = {
  schemaVersion: 1, envelopeId: 'env-1', projectId: P, workspaceId: W, goalId: G, taskId: T,
  runRef: claim.runRef, attemptRef: claim.attemptRef, planRef, roleBinding,
  workspaceSnapshot: { workspaceId: W, revision: 7 },
  permissions: { policyRevision: 'policy-1', tools: [], writeScope: [] }, budget, sourceRefs: [],
  bundleRef: { kind: 'artifact', contentType: 'text/plain', digest: 'f'.repeat(64), sizeBytes: 1,
    source: { kind: 'workspace', refId: W, revision: '7' } },
};
const kernel = { adapterId: 'adapter-1', kernelSessionId: 'kernel-session-1', runId: 'kernel-run-1', turnId: 'turn-1' };
const source = (position: number) => ({ ...kernel, position });
const observed = (start: number, through: number, end: number | null): RunObservedHistory =>
  ({ kernel, startPosition: start, observedThroughPosition: through, endPosition: end });
const historyLocator = (start: number, through: number, end: number | null) => ({
  schemaVersion: 1 as const, sessionRef: { projectId: P, sessionId: 'ses-1' }, kernel: { ...kernel },
  startPosition: start, observedThroughPosition: through, endPosition: end,
});
const permitAt = (authorizationRevision: number, entryGeneration = 1) =>
  ({ claim, consumerId: CONSUMER, entryGeneration, authorizationRevision, inputDigest: DIGEST });
const continuation: RunContinuationV1 = { schemaVersion: 1, kind: 'wait_reply', task: claim.task, sessionRef,
  messageRef: { aggregateType: 'SessionMessage', projectId: P, workspaceId: W, messageId: 'msg-1' } };
const consumedWait: ConsumedWaitV1 = {
  runRef: runRef('run-0'), messageRef: continuation.messageRef,
  responseRef: { kind: 'artifact', contentType: 'text/plain', digest: 'a'.repeat(64), sizeBytes: 3,
    source: { kind: 'workspace', refId: W, revision: '1' } },
};
const requeueRef: TaskRequeueRef = { aggregateType: 'TaskRequeue', projectId: P, goalId: G, taskId: T, afterRunId: 'run-0' };
const TAKEOVER = { kind: 'host_instance_takeover' as const, hostInstanceId: 'host-1' };
const LIVE = { kind: 'live_clean' as const };

function runtimeEvent(eventType: RuntimeEventV1['eventType'], sequence: number, payload: RuntimeEventV1['payload']): RuntimeEventV1 {
  return { eventType, schemaVersion: 1, eventId: `rt-${eventType}-${String(sequence)}`, runRef: claim.runRef, sequence,
    occurredAt: T_END, payload };
}
const COMPLETED = (sequence = 1) => runtimeEvent('run_completed', sequence, { kind: 'completed', exitCode: 0 });
const YIELDED = (sequence = 1) => runtimeEvent('run_yielded', sequence, { kind: 'yielded',
  yield: { reason: 'reply_required', requestedBy: 'runtime', yieldedAt: T_END, pendingToolCallId: null } });

// ------------------------------------------------------------------------ //
// Guard context and events                                                  //
// ------------------------------------------------------------------------ //

/** Every guard holds: the default context of a legal row. */
const CTX: RunGuardContext = {
  session: { usable: true, owned: true, kernel: { adapterId: kernel.adapterId, kernelSessionId: kernel.kernelSessionId } },
  lease: 'owned',
  persistedClaim: claim,
  goal: { desiredState: 'active', activePlanMatchesClaim: true },
  entryPlan: 'active_plan',
  continuationBrief: 'absent_ok',
  freshAdmission: null,
  pointerIntent: null,
  queuedSteerCount: 0,
  continuationConsumed: false,
  exitProof: 'live_clean',
  hostLease: 'owned',
  kernelProbe: 'ready',
  kernelPaused: false,
  inputsConfirmed: true,
  actor: 'human',
  claim: { sessionOccupied: false, eligibility: null, taskHasRun: false, prior: null, admission: null },
};
const ctxWith = (patch: Partial<RunGuardContext>): RunGuardContext => ({ ...CTX, ...patch });
const claimCtx = (patch: Partial<NonNullable<RunGuardContext['claim']>>): RunGuardContext =>
  ctxWith({ claim: { ...CTX.claim!, ...patch } });
const rejection = (code: CoreError, reason: string): CoreRejection => ({ status: 'rejected', code, reason });

const CLEAN_TURN: RunTurnFacts = { terminal: false, inFlightToolCallIds: [], lastPosition: 5, entered: null };
/** The persisted Outbox claim differs from the event's claim in one field. */
const MISMATCHED_CLAIM: RunGuardContext = ctxWith({ persistedClaim: { ...claim, sessionRevision: GEN + 1 } });

const EV = {
  claim: { kind: 'claim_committed', claim, basis: { kind: 'first' }, roleBinding, budget, workspaceRevision: 7 },
  authorize: { kind: 'entry_authorized', claim, consumerId: CONSUMER, envelope, inputBinding },
  begin: { kind: 'entry_begun', permit: permitAt(1), kernel },
  entered: { kind: 'entered_observed', permit: permitAt(2), kernelSource: source(3), history: observed(3, 3, null),
    enteredAt: T_ENTER },
  history: { kind: 'history_recorded', sessionRef, history: observed(3, 6, null) },
  terminal: { kind: 'terminal_observed', claim, entry: { consumerId: CONSUMER, entryGeneration: 1 }, event: COMPLETED(),
    kernelSource: source(6), completedHistoryBoundary: { source: source(6), cursor: 'cursor-6' },
    history: observed(3, 6, 6), unresolvedToolCallIds: [], endedAt: T_END, factEventId: 'fact-1' },
  stopU: { kind: 'stop_not_entered', source: 'U', intentRef: intentRef('i-cancel') },
  stopR: { kind: 'stop_not_entered', source: 'R', intentRef: intentRef('i-cancel') },
  pauseU: { kind: 'pause_not_entered', source: 'U', intentRef: intentRef('i-pause') },
  pauseR: { kind: 'pause_not_entered', source: 'R', intentRef: intentRef('i-pause') },
  resumeU: { kind: 'resume_not_entered', source: 'U', intentRef: intentRef('i-resume') },
  resumeR: { kind: 'resume_not_entered', source: 'R', intentRef: intentRef('i-resume') },
  ctlPause: { kind: 'control_submitted', intentRef: intentRef('i-pause'), control: 'pause', reason: null },
  ctlCancel: { kind: 'control_submitted', intentRef: intentRef('i-cancel'), control: 'cancel', reason: null },
  ctlResume: { kind: 'control_submitted', intentRef: intentRef('i-resume'), control: 'resume', reason: null },
  ctlSteer: { kind: 'control_submitted', intentRef: intentRef('i-steer'), control: 'steer', reason: 'look at the tests first' },
  stopPaused: { kind: 'stop_paused', claim, cancelIntentRef: intentRef('i-cancel'), basis: LIVE, turn: CLEAN_TURN,
    recordedAt: T_LATER, factEventId: 'fact-9' },
  recNotEntered: { kind: 'reconcile_not_entered', claim, basis: TAKEOVER, kernel, recordedAt: T_LATER },
  recTerminal: { kind: 'reconcile_terminal', claim, basis: TAKEOVER, recordedAt: T_LATER, factEventId: 'fact-9',
    event: COMPLETED(), kernelSource: source(6), completedHistoryBoundary: { source: source(6), cursor: 'cursor-6' },
    history: observed(3, 6, 6), unresolvedToolCallIds: [], enteredAt: null },
  recInterrupted: { kind: 'reconcile_interrupted_clean', claim, basis: TAKEOVER, turn: CLEAN_TURN, recordedAt: T_LATER,
    factEventId: 'fact-9' },
  recUnknown: { kind: 'reconcile_unknown', claim, basis: TAKEOVER, cause: 'tool_calls_unresolved', reason: 'a tool call is running',
    unresolvedToolCallIds: ['call-9'], observedThroughPosition: 7, turn: CLEAN_TURN, recordedAt: T_LATER },
  late: { kind: 'late_evidence', claim, basis: TAKEOVER, recordedAt: T_LATER, factEventId: 'fact-9', event: COMPLETED(),
    kernelSource: source(8), completedHistoryBoundary: { source: source(8), cursor: 'cursor-8' }, history: observed(3, 8, 8),
    unresolvedToolCallIds: [], enteredAt: null },
  attest: { kind: 'unknown_attested', claim, reason: 'checked the workspace by hand', kernelTurnOpen: true, recordedAt: T_LATER },
} satisfies Record<string, RunEvent>;
type EventCase = keyof typeof EV;

// ------------------------------------------------------------------------ //
// Node records (driven through the machine where a row exists)              //
// ------------------------------------------------------------------------ //

function ok(result: RunTransition): { next: RunState; effects: readonly RunEffect[] } {
  if (!result.ok) throw new Error(`expected a legal transition, got ${result.reason}/${result.code}: ${result.detail}`);
  return result;
}
function nextRecord(result: RunTransition): RunSnapshot {
  const record = ok(result).next.record;
  if (record === null) throw new Error('an accepted transition has a record');
  return record;
}

const CLAIMED = newRunRecord({ claim, basis: { kind: 'first' }, roleBinding, budget, workspaceRevision: 7 });
const AUTHORIZED = nextRecord(transitionRun(runStateOf(CLAIMED), EV.authorize, CTX));
const ENTERING = nextRecord(transitionRun(runStateOf(AUTHORIZED), EV.begin, CTX));
const RUNNING = nextRecord(transitionRun(runStateOf(ENTERING), EV.entered, CTX));
const ENDED = nextRecord(transitionRun(runStateOf(RUNNING), EV.terminal, CTX));
const YIELDED_WAIT = nextRecord(transitionRun(runStateOf(RUNNING),
  { ...EV.terminal, event: YIELDED(), continuation }, CTX));
const authOf = (run: RunSnapshot): ExecutionAuthorizationV2 => run.executionAuthorization as ExecutionAuthorizationV2;
/** RUN-16 is step 5: a revoked Run is written by hand in §6.1 contract (a) shape. */
const REVOKED: RunSnapshot = { ...ENTERING, revision: ENTERING.revision + 1,
  executionAuthorization: { ...authOf(ENTERING), revision: authOf(ENTERING).revision + 1, phase: 'revoked' },
  reconciliation: { status: 'done', observation: { kind: 'not_entered', kernel, revokedGeneration: 1 },
    basis: TAKEOVER, recordedAt: T_LATER } };
/** RUN-08 is step 5: an unknown Run is written by hand (window through 5, call-1 unresolved). */
const UNRESOLVED: RunReconciliationV1 = { status: 'quarantined',
  observation: { kind: 'unresolved', reason: 'a tool call is running', observedThroughPosition: 5, unresolvedToolCallIds: ['call-1'] },
  basis: LIVE, recordedAt: T_END };
const ENDED_UNKNOWN: RunSnapshot = { ...RUNNING, revision: RUNNING.revision + 1, status: 'ended', outcome: 'outcome_unknown',
  endedAt: T_END, executionAuthorization: { ...authOf(RUNNING), revision: authOf(RUNNING).revision + 1, phase: 'unknown' },
  executionHistory: historyLocator(3, 5, null), reconciliation: UNRESOLVED };

const RECORD_OF: Record<Exclude<RunNode, 'Absent'>, RunSnapshot> = {
  Claimed: CLAIMED, Authorized: AUTHORIZED, Entering: ENTERING, Revoked: REVOKED, Running: RUNNING,
  Ended: ENDED, YieldedWait: YIELDED_WAIT, EndedUnknown: ENDED_UNKNOWN,
};
const stateOf = (node: RunNode): RunState => runStateOf(node === 'Absent' ? null : RECORD_OF[node]);

// ------------------------------------------------------------------------ //
// Expectations (§6.3 rows, §6.4 refusals)                                   //
// ------------------------------------------------------------------------ //

type Expect =
  | { to: RunNode; effects: readonly RunEffect[] }
  | { reason: TransitionRejectReason; code: CoreError; row?: string };

const NOT_FOUND: Expect = { reason: 'illegal', code: 'not_found' };
const ILLEGAL: Expect = { reason: 'illegal', code: 'invalid' };
const BUSY: Expect = { reason: 'illegal', code: 'busy' };
const notYet = (row: string): Expect => ({ reason: 'illegal', code: 'invalid', row });
const intentEffect = (id: string): RunEffect[] => [{ kind: 'intent', event: 'control_submitted', intentRef: intentRef(id) }];
const slot = (expectedOwner: 'none' | 'self'): RunEffect[] => [{ kind: 'claim_kernel_slot', kernel, expectedOwner }];
const TERMINAL_EFFECTS: RunEffect[] = [
  { kind: 'attempt', event: 'attempt_ended', outcome: 'completed' },
  { kind: 'outbox', change: 'settled_entered' },
  { kind: 'release_session', holder: claim.runRef, generation: GEN, historyCursor: { kind: 'advance', cursor: 'cursor-6' },
    kernelTurnOpen: false },
  { kind: 'release_lease' },
];

/** The not-entered control U rows today (RUN-09..11 改造): node unchanged, pointer moved, intent queued. */
const unenteredControl = (id: string): Record<'Claimed' | 'Authorized' | 'Revoked', Expect> => ({
  Claimed: { to: 'Claimed', effects: intentEffect(id) },
  Authorized: { to: 'Authorized', effects: intentEffect(id) },
  Revoked: { to: 'Revoked', effects: intentEffect(id) },
});
const ROUTED_TO_NOT_ENTERED = { Claimed: ILLEGAL, Authorized: ILLEGAL, Revoked: ILLEGAL };
const NOT_ENTERED_ON_OTHERS = { Absent: NOT_FOUND, Entering: ILLEGAL, Running: ILLEGAL, Ended: BUSY, YieldedWait: ILLEGAL,
  EndedUnknown: ILLEGAL };
const RECONCILE_OTHERS = { Absent: NOT_FOUND, Claimed: ILLEGAL, Authorized: ILLEGAL, Revoked: ILLEGAL, Ended: BUSY,
  YieldedWait: BUSY, EndedUnknown: ILLEGAL };
const GUARD_BUSY = { reason: 'guard_failed', code: 'busy' } as const;

const TABLE: Record<EventCase, Record<RunNode, Expect>> = {
  claim: { Absent: { to: 'Claimed', effects: [
    { kind: 'attempt', event: 'attempt_claimed' }, { kind: 'outbox', change: 'pending' }, { kind: 'hold_lease' },
    { kind: 'occupy_session', holder: claim.runRef, generation: GEN }] },
  Claimed: ILLEGAL, Authorized: ILLEGAL, Entering: ILLEGAL, Revoked: ILLEGAL, Running: ILLEGAL, Ended: ILLEGAL,
  YieldedWait: ILLEGAL, EndedUnknown: ILLEGAL },
  authorize: { Absent: NOT_FOUND, Claimed: { to: 'Authorized', effects: [] }, Authorized: BUSY, Entering: BUSY,
    Revoked: BUSY, Running: BUSY, Ended: BUSY, YieldedWait: BUSY, EndedUnknown: BUSY },
  begin: { Absent: NOT_FOUND, Claimed: { reason: 'illegal', code: 'forbidden' }, Authorized: { to: 'Entering', effects: slot('none') },
    Entering: BUSY, Revoked: GUARD_BUSY, Running: BUSY, Ended: BUSY, YieldedWait: BUSY, EndedUnknown: BUSY },
  entered: { Absent: NOT_FOUND, Claimed: { reason: 'illegal', code: 'forbidden' }, Authorized: BUSY,
    Entering: { to: 'Running', effects: [{ kind: 'attempt', event: 'attempt_started' }, { kind: 'outbox', change: 'entered' }] },
    Revoked: BUSY, Running: BUSY, Ended: BUSY, YieldedWait: BUSY, EndedUnknown: BUSY },
  history: { Absent: NOT_FOUND, Claimed: { to: 'Claimed', effects: slot('none') },
    Authorized: { to: 'Authorized', effects: slot('none') }, Entering: { to: 'Entering', effects: slot('self') },
    Revoked: { to: 'Revoked', effects: slot('self') }, Running: { to: 'Running', effects: slot('self') },
    Ended: { reason: 'stale', code: 'revision_conflict' }, YieldedWait: { reason: 'stale', code: 'revision_conflict' },
    EndedUnknown: { to: 'EndedUnknown', effects: slot('self') } },
  terminal: { Absent: NOT_FOUND, Claimed: { reason: 'illegal', code: 'forbidden' }, Authorized: BUSY, Entering: BUSY,
    Revoked: BUSY, Running: { to: 'Ended', effects: TERMINAL_EFFECTS },
    Ended: { reason: 'duplicate', code: 'busy' }, YieldedWait: { reason: 'duplicate', code: 'busy' },
    EndedUnknown: { reason: 'guard_failed', code: 'incomplete' } },
  stopU: { ...NOT_ENTERED_ON_OTHERS, ...unenteredControl('i-cancel') },
  stopR: { ...NOT_ENTERED_ON_OTHERS, Claimed: notYet('RUN-09'), Authorized: notYet('RUN-09'), Revoked: notYet('RUN-09') },
  pauseU: { ...NOT_ENTERED_ON_OTHERS, ...unenteredControl('i-pause') },
  pauseR: { ...NOT_ENTERED_ON_OTHERS, Claimed: notYet('RUN-10'), Authorized: notYet('RUN-10'), Revoked: notYet('RUN-10') },
  // No pointer: today's `resume requires a formal pause`.
  resumeU: { ...NOT_ENTERED_ON_OTHERS, Claimed: GUARD_BUSY, Authorized: GUARD_BUSY, Revoked: GUARD_BUSY },
  resumeR: { ...NOT_ENTERED_ON_OTHERS, Claimed: notYet('RUN-11'), Authorized: notYet('RUN-11'), Revoked: notYet('RUN-11') },
  ctlPause: { Absent: NOT_FOUND, ...ROUTED_TO_NOT_ENTERED, Entering: { to: 'Entering', effects: intentEffect('i-pause') },
    Running: { to: 'Running', effects: intentEffect('i-pause') }, YieldedWait: { to: 'YieldedWait', effects: intentEffect('i-pause') },
    Ended: BUSY, EndedUnknown: BUSY },
  ctlCancel: { Absent: NOT_FOUND, ...ROUTED_TO_NOT_ENTERED, Entering: { to: 'Entering', effects: intentEffect('i-cancel') },
    Running: { to: 'Running', effects: intentEffect('i-cancel') },
    YieldedWait: { to: 'YieldedWait', effects: intentEffect('i-cancel') }, Ended: BUSY, EndedUnknown: BUSY },
  ctlResume: { Absent: NOT_FOUND, ...ROUTED_TO_NOT_ENTERED, Entering: GUARD_BUSY, Running: GUARD_BUSY,
    YieldedWait: GUARD_BUSY, Ended: BUSY, EndedUnknown: BUSY },
  ctlSteer: { Absent: NOT_FOUND, Claimed: { to: 'Claimed', effects: intentEffect('i-steer') },
    Authorized: { to: 'Authorized', effects: intentEffect('i-steer') }, Revoked: { to: 'Revoked', effects: intentEffect('i-steer') },
    Entering: { to: 'Entering', effects: intentEffect('i-steer') }, Running: { to: 'Running', effects: intentEffect('i-steer') },
    YieldedWait: { to: 'YieldedWait', effects: intentEffect('i-steer') }, Ended: BUSY, EndedUnknown: BUSY },
  // Default context is the in-process variant with the Kernel not paused.
  stopPaused: { Absent: NOT_FOUND, Claimed: ILLEGAL, Authorized: ILLEGAL, Revoked: ILLEGAL, Entering: ILLEGAL,
    Running: { reason: 'guard_failed', code: 'incomplete' }, Ended: BUSY, YieldedWait: BUSY, EndedUnknown: BUSY },
  recNotEntered: { ...RECONCILE_OTHERS, Entering: notYet('RUN-16'), Running: ILLEGAL },
  recTerminal: { ...RECONCILE_OTHERS, Entering: notYet('RUN-17'), Running: notYet('RUN-18') },
  recInterrupted: { ...RECONCILE_OTHERS, Entering: notYet('RUN-19'), Running: notYet('RUN-19') },
  recUnknown: { ...RECONCILE_OTHERS, Entering: notYet('RUN-20'), Running: notYet('RUN-20') },
  late: { Absent: NOT_FOUND, Claimed: ILLEGAL, Authorized: ILLEGAL, Entering: ILLEGAL, Revoked: ILLEGAL, Running: ILLEGAL,
    Ended: BUSY, YieldedWait: BUSY, EndedUnknown: notYet('RUN-21') },
  attest: { Absent: NOT_FOUND, Claimed: ILLEGAL, Authorized: ILLEGAL, Entering: ILLEGAL, Revoked: ILLEGAL, Running: ILLEGAL,
    Ended: BUSY, YieldedWait: BUSY, EndedUnknown: notYet('RUN-22') },
};

function expectResult(result: RunTransition, expected: Expect, label: string): void {
  if ('to' in expected) {
    expect(result.ok, `${label}: ${result.ok ? '' : `${result.reason}/${result.code} ${result.detail}`}`).toBe(true);
    if (!result.ok) return;
    expect(result.next.node, label).toBe(expected.to);
    expect(result.effects, label).toEqual(expected.effects);
    expect(result.next.record, label).not.toBeNull();
    expect(runCombinationProblem(result.next.record!), label).toBeNull();
    return;
  }
  expect(result.ok, label).toBe(false);
  if (result.ok) return;
  expect({ reason: result.reason, code: result.code }, `${label}: ${result.detail}`)
    .toEqual({ reason: expected.reason, code: expected.code });
  if (expected.row !== undefined) expect(result.detail, label).toContain(`${expected.row}`);
  if (expected.row === undefined) expect(result.detail, label).not.toContain('not implemented before A.2 step 5');
}

/** Today's record literal comparison: same JSON, same key order. */
function expectSameRecord(actual: RunSnapshot | null, expected: RunSnapshot): void {
  expect(actual).toEqual(expected);
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
}

function rejected(result: RunTransition): { reason: TransitionRejectReason; code: CoreError; detail: string } {
  if (result.ok) throw new Error('expected a rejection');
  return { reason: result.reason, code: result.code, detail: result.detail };
}
const answer = (result: RunTransition) => {
  const { reason, code } = rejected(result);
  return { reason, code };
};

// ------------------------------------------------------------------------ //
// Exhaustive (node, event) table                                            //
// ------------------------------------------------------------------------ //

describe('run machine: every (node, event) combination (§6.3, §6.4)', () => {
  it('covers every node and every event kind', () => {
    expect([...RUN_NODES].sort()).toEqual(Object.keys(TABLE.claim).sort());
    const kinds = new Set(Object.values(EV).map(event => event.kind));
    expect([...kinds].sort()).toEqual([
      'claim_committed', 'control_submitted', 'entered_observed', 'entry_authorized', 'entry_begun', 'history_recorded',
      'late_evidence', 'pause_not_entered', 'reconcile_interrupted_clean', 'reconcile_not_entered', 'reconcile_terminal',
      'reconcile_unknown', 'resume_not_entered', 'stop_not_entered', 'stop_paused', 'terminal_observed', 'unknown_attested',
    ]);
  });

  it('derives each fixture node and keeps it a legal combination', () => {
    for (const node of RUN_NODES) {
      const state = stateOf(node);
      expect(state.node, node).toBe(node);
      expect(runNodeOf(state.record), node).toBe(node);
      if (state.record !== null) expect(runCombinationProblem(state.record), node).toBeNull();
    }
  });

  for (const eventCase of Object.keys(TABLE) as EventCase[]) {
    for (const node of RUN_NODES) {
      it(`${node} × ${eventCase}`, () => {
        expectResult(transitionRun(stateOf(node), EV[eventCase], CTX), TABLE[eventCase][node], `${node} × ${eventCase}`);
      });
    }
  }
});

// ------------------------------------------------------------------------ //
// Machine view                                                              //
// ------------------------------------------------------------------------ //

describe('runStateOf / runNodeOf / runCombinationProblem (§6.1)', () => {
  it('projects the spec fields of each node', () => {
    expect(stateOf('Absent')).toEqual({ node: 'Absent', outcome: null, entryGeneration: null, legacyV1: false, pointer: 'none',
      lastEventSeq: 0, unresolved: null, record: null });
    expect(stateOf('Claimed')).toMatchObject({ entryGeneration: null, legacyV1: false, pointer: 'none', unresolved: null });
    expect(stateOf('Running')).toMatchObject({ entryGeneration: 1, legacyV1: false, outcome: null });
    expect(stateOf('Ended')).toMatchObject({ outcome: 'completed', lastEventSeq: 1 });
    expect(stateOf('EndedUnknown')).toMatchObject({ outcome: 'outcome_unknown',
      unresolved: { observedThroughPosition: 5, toolCallIds: ['call-1'] } });
    expect(runStateOf({ ...RUNNING, controlState: { intentRef: intentRef('i-pause'), desiredState: 'paused' } }).pointer)
      .toBe('paused');
  });

  it('reads V1 and pre-B2 authorizations as legacy history, not damage', () => {
    const v1Starting: RunSnapshot = { ...CLAIMED, executionAuthorization: { generation: 1, consumerId: 'c', phase: 'authorized' } };
    expect(runStateOf(v1Starting)).toMatchObject({ node: 'Claimed', legacyV1: true, entryGeneration: null });
    const v1Running: RunSnapshot = { ...RUNNING, executionAuthorization: { generation: 1, consumerId: 'c', phase: 'entered' } };
    expect(runStateOf(v1Running)).toMatchObject({ node: 'Running', legacyV1: true });
    const { executionAuthorization: _auth, ...preB2 } = RUNNING;
    expect(runStateOf(preB2)).toMatchObject({ node: 'Running', legacyV1: true });
    const { executionAuthorization: _ended, ...d7Ended } = { ...CLAIMED, status: 'ended' as const, outcome: 'cancelled' as const };
    expect(runStateOf(d7Ended)).toMatchObject({ node: 'Ended', legacyV1: false });
    expect(runCombinationProblem(v1Starting)).toBeNull();
    expect(runCombinationProblem(preB2)).toBeNull();
  });

  it('reports V2 combinations outside the eight machine states', () => {
    expect(runCombinationProblem({ ...CLAIMED, executionAuthorization: { ...authOf(RUNNING) } })).toContain('starting');
    expect(runCombinationProblem({ ...RUNNING, executionAuthorization: { ...authOf(AUTHORIZED) } })).toContain('running');
    expect(runCombinationProblem({ ...ENDED, outcome: null })).toContain('outcome');
    expect(runCombinationProblem({ ...ENDED, outcome: 'failed' })).toContain('no writer');
    expect(runCombinationProblem({ ...ENDED, outcome: 'outcome_unknown' })).toContain('unknown');
    expect(runCombinationProblem({ ...ENDED, outcome: 'yielded' })).toContain('continuation');
    expect(runCombinationProblem({ ...ENDED, executionAuthorization: { ...authOf(ENDED), phase: 'entering' } })).toContain('entering');
    expect(runCombinationProblem({ ...REVOKED, status: 'ended', outcome: 'cancelled' })).toBeNull();
    expect(runNodeOf({ ...ENDED, outcome: 'yielded' })).toBe('Ended');
  });
});

// ------------------------------------------------------------------------ //
// RUN-01                                                                    //
// ------------------------------------------------------------------------ //

describe('RUN-01 claim_committed', () => {
  it('writes the starting@1 Run in claim-service.ts key order', () => {
    const result = ok(transitionRun(stateOf('Absent'), EV.claim, CTX));
    const expected: RunSnapshot = { ref: claim.runRef, revision: 1, schemaVersion: 1, task: claim.task, attemptId: 'att-1',
      planRef, roleBinding, budget,
      workspaceSnapshot: { workspaceId: W, revision: 7 },
      status: 'starting', outcome: null, exitCode: null, lastEventSeq: 0,
      lastRuntimeEventId: '', lastFactEventId: '', envelope: null, startedAt: null, endedAt: null };
    expectSameRecord(result.next.record, expected);
    expect(result.next).toMatchObject({ node: 'Claimed', pointer: 'none', entryGeneration: null, legacyV1: false });
  });

  it('keeps the consumed wait of a continuation claim and the requeueRef of a requeue record', () => {
    const prior = { node: 'YieldedWait' as const, pointer: 'none' as const, bindingProblem: null, leaseReleasedByPrior: true,
      replyProblem: null };
    const result = ok(transitionRun(stateOf('Absent'), { ...EV.claim, basis: { kind: 'continuation', consumedWait } },
      claimCtx({ taskHasRun: true, prior })));
    expect(result.next.record?.consumedWait).toEqual(consumedWait);
    expect(result.next.record?.requeueRef).toBeUndefined();
    expect(newRunRecord({ claim, basis: { kind: 'requeue', requeueRef }, roleBinding, budget, workspaceRevision: 7 }).requeueRef)
      .toEqual(requeueRef);
  });

  it('refuses in claim-service.ts order (§6.4)', () => {
    const at = (ctx: RunGuardContext, event: RunEvent = EV.claim) => answer(transitionRun(stateOf('Absent'), event, ctx));
    expect(at(ctxWith({ claim: null }))).toEqual({ reason: 'illegal', code: 'invalid' });
    expect(at(ctxWith({ goal: { desiredState: 'paused', activePlanMatchesClaim: false } })))
      .toEqual({ reason: 'guard_failed', code: 'busy' });
    expect(at(ctxWith({ goal: { desiredState: 'active', activePlanMatchesClaim: false } })))
      .toEqual({ reason: 'stale', code: 'revision_conflict' });
    expect(at(ctxWith({ session: { ...CTX.session, usable: false } }))).toEqual({ reason: 'guard_failed', code: 'busy' });
    expect(at(claimCtx({ sessionOccupied: true }))).toEqual({ reason: 'guard_failed', code: 'busy' });
    expect(at(claimCtx({ eligibility: rejection('invalid', 'the Task disposition is not active') })))
      .toEqual({ reason: 'guard_failed', code: 'invalid' });
    expect(at(claimCtx({ eligibility: rejection('incomplete', 'planning only') })))
      .toEqual({ reason: 'guard_failed', code: 'incomplete' });
    expect(at(claimCtx({ taskHasRun: true }))).toEqual({ reason: 'guard_failed', code: 'busy' });
    expect(at(claimCtx({ admission: rejection('forbidden', 'role mismatch') }))).toEqual({ reason: 'guard_failed', code: 'forbidden' });
    expect(at(claimCtx({ admission: rejection('capacity', 'budget.deadline has passed') })))
      .toEqual({ reason: 'guard_failed', code: 'capacity' });
  });

  it('checks the yielded prior Run of a continuation claim (`claim-service.ts:590-636`)', () => {
    const event: RunEvent = { ...EV.claim, basis: { kind: 'continuation', consumedWait } };
    const good = { node: 'YieldedWait' as const, pointer: 'none' as const, bindingProblem: null, leaseReleasedByPrior: true,
      replyProblem: null };
    const at = (prior: NonNullable<RunGuardContext['claim']>['prior']) =>
      transitionRun(stateOf('Absent'), event, claimCtx({ taskHasRun: true, prior }));
    expect(answer(at(null))).toEqual({ reason: 'guard_failed', code: 'busy' });
    for (const node of ['Ended', 'Running', 'EndedUnknown'] as const) {
      expect(answer(at({ ...good, node }))).toEqual({ reason: 'guard_failed', code: 'busy' });
    }
    expect(answer(at({ ...good, bindingProblem: rejection('forbidden', 'another Session') })))
      .toEqual({ reason: 'guard_failed', code: 'forbidden' });
    expect(answer(at({ ...good, pointer: 'paused' }))).toEqual({ reason: 'guard_failed', code: 'busy' });
    expect(answer(at({ ...good, pointer: 'cancelled' }))).toEqual({ reason: 'guard_failed', code: 'busy' });
    expect(at({ ...good, pointer: 'running' }).ok).toBe(true);
    expect(answer(at({ ...good, leaseReleasedByPrior: false }))).toEqual({ reason: 'guard_failed', code: 'busy' });
    expect(answer(at({ ...good, replyProblem: rejection('busy', 'not answered') }))).toEqual({ reason: 'guard_failed', code: 'busy' });
    expect(at(good).ok).toBe(true);
  });

  it('keeps today\'s first-claim rule for a requeue claim (D-3 is step 5.4)', () => {
    const requeue: RunEvent = { ...EV.claim, basis: { kind: 'requeue', requeueRef } };
    expect(rejected(transitionRun(stateOf('Absent'), requeue, claimCtx({ taskHasRun: true }))))
      .toMatchObject({ reason: 'guard_failed', code: 'busy', detail: expect.stringContaining('cannot be claimed for the first time') });
    // Without a Run the claim service never reads requeueRef: the same Run@1 as a first claim, no requeueRef.
    expect(transitionRun(stateOf('Absent'), requeue, CTX)).toEqual(transitionRun(stateOf('Absent'), EV.claim, CTX));
    expect(ok(transitionRun(stateOf('Absent'), requeue, CTX)).next.record?.requeueRef).toBeUndefined();
  });
});

// ------------------------------------------------------------------------ //
// RUN-02 / RUN-03                                                           //
// ------------------------------------------------------------------------ //

const pointer = (desiredState: NonNullable<RunSnapshot['controlState']>['desiredState'], id = 'i-ptr') =>
  ({ intentRef: intentRef(id), desiredState });

describe('RUN-02 / RUN-03 entry_authorized', () => {
  it('writes the V2 binding at gen 1 rev 1 in execution-entry-service.ts key order', () => {
    const authorization: ExecutionAuthorizationV2 = {
      schemaVersion: 2, generation: 1, sessionGeneration: GEN,
      revision: 1, consumerId: CONSUMER, inputDigest: DIGEST,
      phase: 'authorized', kernel: null,
    };
    expectSameRecord(AUTHORIZED, { ...CLAIMED, revision: CLAIMED.revision + 1,
      envelope, inputBinding, executionAuthorization: authorization });
    expect(runStateOf(AUTHORIZED)).toMatchObject({ node: 'Authorized', entryGeneration: 1 });
  });

  it('refuses in authorizeRuntimeEntry order', () => {
    const at = (run: RunSnapshot, ctx: RunGuardContext = CTX) => answer(transitionRun(runStateOf(run), EV.authorize, ctx));
    // The pointer fence is first, even before `starting` (§6.4).
    expect(at({ ...CLAIMED, controlState: pointer('paused') })).toEqual({ reason: 'guard_failed', code: 'busy' });
    expect(at({ ...CLAIMED, controlState: pointer('cancelled') })).toEqual({ reason: 'guard_failed', code: 'busy' });
    expect(at({ ...CLAIMED, controlState: pointer('steered') })).toEqual({ reason: 'guard_failed', code: 'unsupported' });
    expect(at({ ...ENDED, controlState: pointer('cancelled') })).toEqual({ reason: 'guard_failed', code: 'busy' });
    expect(transitionRun(runStateOf({ ...CLAIMED, controlState: pointer('running') }), EV.authorize, CTX).ok).toBe(true);
    expect(at(CLAIMED, ctxWith({ session: { ...CTX.session, usable: false } }))).toEqual({ reason: 'guard_failed', code: 'busy' });
    expect(at(CLAIMED, ctxWith({ session: { ...CTX.session, owned: false } }))).toEqual({ reason: 'guard_failed', code: 'busy' });
    for (const lease of ['missing', 'released', 'other'] as const) {
      expect(at(CLAIMED, ctxWith({ lease }))).toEqual({ reason: 'guard_failed', code: 'busy' });
    }
    expect(at({ ...CLAIMED, executionAuthorization: { generation: 1, consumerId: 'c', phase: 'authorized' } }))
      .toEqual({ reason: 'guard_failed', code: 'forbidden' });
    expect(at(CLAIMED, ctxWith({ goal: { desiredState: 'paused', activePlanMatchesClaim: true } })))
      .toEqual({ reason: 'guard_failed', code: 'busy' });
    // The Goal before the Plan pin (`execution-entry-service.ts:960-962`; §6.6 "Goal 暂停时仍先返回 busy").
    expect(at(CLAIMED, ctxWith({ goal: { desiredState: 'paused', activePlanMatchesClaim: true }, entryPlan: 'changed' })))
      .toEqual({ reason: 'guard_failed', code: 'busy' });
    expect(at(CLAIMED, ctxWith({ freshAdmission: rejection('forbidden', 'role') }))).toEqual({ reason: 'guard_failed', code: 'forbidden' });
    expect(at(CLAIMED, ctxWith({ freshAdmission: rejection('unavailable', 'material') })))
      .toEqual({ reason: 'guard_failed', code: 'unavailable' });
    // §6.4: a passed deadline is not a Run event (T); the fresh entry alone is refused.
    expect(at(CLAIMED, ctxWith({ freshAdmission: rejection('capacity', 'the Run budget deadline has passed') })))
      .toEqual({ reason: 'illegal', code: 'capacity' });
  });

  it('checks the persisted claim, then the prepared binding, between the Lease and the existing authorization', () => {
    const at = (run: RunSnapshot, ctx: RunGuardContext = CTX, event: RunEvent = EV.authorize) =>
      rejected(transitionRun(runStateOf(run), event, ctx));
    const withEnvelope = (patch: Partial<TaskEnvelopeV1>): RunEvent => ({ ...EV.authorize, envelope: { ...envelope, ...patch } });
    const badBudget = withEnvelope({ budget: { tokenBudget: 999, deadline: null } });
    expect(at(CLAIMED, MISMATCHED_CLAIM)).toEqual({ reason: 'guard_failed', code: 'invalid',
      detail: 'the prepared claim disagrees with the persisted claim' });
    expect(answer(transitionRun(runStateOf(CLAIMED), EV.authorize, ctxWith({ persistedClaim: null }))))
      .toEqual({ reason: 'illegal', code: 'invalid' });
    expect(at(CLAIMED, CTX, withEnvelope({ roleBinding: { ...roleBinding, bindingVersion: 2 } }))).toEqual({ reason: 'guard_failed',
      code: 'forbidden', detail: 'the prepared role binding disagrees with the Run' });
    expect(at(CLAIMED, CTX, badBudget)).toEqual({ reason: 'guard_failed', code: 'forbidden',
      detail: 'the prepared budget disagrees with the Run' });
    expect(at(CLAIMED, CTX, withEnvelope({ workspaceSnapshot: { workspaceId: W, revision: 8 } }))).toEqual({ reason: 'guard_failed',
      code: 'forbidden', detail: 'the prepared workspace snapshot disagrees with the Run' });
    // Canonical JSON: the key order of the prepared values does not matter.
    expect(transitionRun(runStateOf(CLAIMED), withEnvelope({ budget: { deadline: null, tokenBudget: 1000 } }), CTX).ok).toBe(true);
    // Order: fence, starting, Session and Lease come first; the claim before the binding; both before the existing authorization.
    expect(answer(transitionRun(runStateOf({ ...CLAIMED, controlState: pointer('cancelled') }), EV.authorize, MISMATCHED_CLAIM)))
      .toEqual({ reason: 'guard_failed', code: 'busy' });
    expect(answer(transitionRun(stateOf('Running'), badBudget, MISMATCHED_CLAIM))).toEqual({ reason: 'illegal', code: 'busy' });
    expect(answer(transitionRun(runStateOf(CLAIMED), EV.authorize, { ...MISMATCHED_CLAIM, lease: 'released' })))
      .toEqual({ reason: 'guard_failed', code: 'busy' });
    expect(at(CLAIMED, MISMATCHED_CLAIM, badBudget)).toMatchObject({ code: 'invalid' });
    for (const node of ['Authorized', 'Entering', 'Revoked'] as const) {
      expect(at(RECORD_OF[node], CTX, badBudget), node).toMatchObject({ reason: 'guard_failed', code: 'forbidden',
        detail: 'the prepared budget disagrees with the Run' });
      expect(at(RECORD_OF[node], MISMATCHED_CLAIM), node).toMatchObject({ reason: 'guard_failed', code: 'invalid' });
    }
    const v1: RunSnapshot = { ...CLAIMED, executionAuthorization: { generation: 1, consumerId: 'c', phase: 'authorized' } };
    expect(at(v1, CTX, badBudget).detail).toBe('the prepared budget disagrees with the Run');
    expect(at(v1, MISMATCHED_CLAIM).code).toBe('invalid');
  });

  it('keeps today\'s plan pin: only the active Plan passes (C6 is step 5.4b)', () => {
    const at = (entryPlan: RunGuardContext['entryPlan']) => transitionRun(runStateOf(CLAIMED), EV.authorize, ctxWith({ entryPlan }));
    expect(at('active_plan').ok).toBe(true);
    for (const entryPlan of ['carried_unchanged', 'changed', 'unavailable'] as const) {
      expect(answer(at(entryPlan)), entryPlan).toEqual({ reason: 'stale', code: 'revision_conflict' });
    }
  });

  it('does not read the continuation brief yet (C3 is step 5.4)', () => {
    for (const continuationBrief of ['absent_ok', 'bound', 'missing', 'unexpected', 'mismatch'] as const) {
      expect(transitionRun(runStateOf(CLAIMED), EV.authorize, ctxWith({ continuationBrief })).ok, continuationBrief).toBe(true);
    }
  });

  it('keeps today\'s busy for a revoked Run (RUN-03 is step 5)', () => {
    expect(rejected(transitionRun(stateOf('Revoked'), EV.authorize, CTX)))
      .toMatchObject({ reason: 'illegal', code: 'busy', detail: 'the Run already has a V2 entry authorization' });
  });
});

// ------------------------------------------------------------------------ //
// RUN-04                                                                    //
// ------------------------------------------------------------------------ //

describe('RUN-04 entry_begun', () => {
  it('fixes the Kernel identity with entering in execution-entry-service.ts key order', () => {
    const auth = authOf(AUTHORIZED);
    const nextAuthorization: ExecutionAuthorizationV2 = { ...auth, revision: auth.revision + 1, phase: 'entering', kernel };
    expectSameRecord(ENTERING, { ...AUTHORIZED, revision: AUTHORIZED.revision + 1, executionAuthorization: nextAuthorization });
  });

  it('refuses in beginRuntimeEntry order', () => {
    const at = (event: RunEvent, run: RunSnapshot = AUTHORIZED, ctx: RunGuardContext = CTX) =>
      answer(transitionRun(runStateOf(run), event, ctx));
    expect(at(EV.begin, { ...AUTHORIZED, controlState: pointer('cancelled') })).toEqual({ reason: 'guard_failed', code: 'busy' });
    expect(at(EV.begin, { ...AUTHORIZED, controlState: pointer('steered') })).toEqual({ reason: 'guard_failed', code: 'unsupported' });
    expect(at(EV.begin, { ...CLAIMED, executionAuthorization: { generation: 1, consumerId: 'c', phase: 'authorized' } }))
      .toEqual({ reason: 'guard_failed', code: 'forbidden' });
    // The persisted claim follows the permit, so each case reaches the binding check it names.
    for (const permit of [{ ...permitAt(1), consumerId: 'other' }, permitAt(1, 2), permitAt(2),
      { ...permitAt(1), inputDigest: 'c'.repeat(64) }, { ...permitAt(1), claim: { ...claim, generation: GEN + 1 } }]) {
      expect(at({ ...EV.begin, permit }, AUTHORIZED, ctxWith({ persistedClaim: permit.claim })))
        .toEqual({ reason: 'guard_failed', code: 'forbidden' });
    }
    expect(at(EV.begin, AUTHORIZED, ctxWith({ session: { ...CTX.session, owned: false } })))
      .toEqual({ reason: 'guard_failed', code: 'busy' });
    expect(at(EV.begin, AUTHORIZED, ctxWith({ lease: 'released' }))).toEqual({ reason: 'guard_failed', code: 'busy' });
    // The permit before the Session and the Lease (`execution-entry-service.ts:1091-1102`).
    expect(at({ ...EV.begin, permit: permitAt(2) }, AUTHORIZED, ctxWith({ lease: 'released' })))
      .toEqual({ reason: 'guard_failed', code: 'forbidden' });
    expect(at({ ...EV.begin, permit: permitAt(2) }, AUTHORIZED, ctxWith({ session: { ...CTX.session, owned: false } })))
      .toEqual({ reason: 'guard_failed', code: 'forbidden' });
    expect(at(EV.begin, { ...AUTHORIZED, inputBinding: { ...inputBinding, inputDigest: 'c'.repeat(64) } }))
      .toEqual({ reason: 'guard_failed', code: 'forbidden' });
    expect(at(EV.begin, AUTHORIZED, ctxWith({ freshAdmission: rejection('capacity', 'deadline') })))
      .toEqual({ reason: 'illegal', code: 'capacity' });
    expect(at(EV.begin, AUTHORIZED, ctxWith({ freshAdmission: rejection('forbidden', 'host') })))
      .toEqual({ reason: 'guard_failed', code: 'forbidden' });
  });

  it('checks the persisted claim after starting and before the V2 binding (execution-entry-service.ts:1087)', () => {
    const at = (run: RunSnapshot, ctx: RunGuardContext = MISMATCHED_CLAIM) => rejected(transitionRun(runStateOf(run), EV.begin, ctx));
    expect(at(AUTHORIZED)).toEqual({ reason: 'guard_failed', code: 'invalid',
      detail: 'the entry permit claim disagrees with the persisted claim' });
    expect(at(AUTHORIZED, ctxWith({ persistedClaim: null }))).toMatchObject({ reason: 'illegal', code: 'invalid' });
    // The fence and `starting` come first: a fenced Authorized Run with a mismatched claim stays busy.
    expect(at({ ...AUTHORIZED, controlState: pointer('cancelled') })).toMatchObject({ reason: 'guard_failed', code: 'busy' });
    expect(at(RUNNING)).toMatchObject({ reason: 'illegal', code: 'busy' });
    // Before the V2 binding, its phase, the permit, the Session and the Lease.
    expect(at(CLAIMED)).toMatchObject({ code: 'invalid' });
    expect(at({ ...CLAIMED, executionAuthorization: { generation: 1, consumerId: 'c', phase: 'authorized' } })).toMatchObject({ code: 'invalid' });
    expect(at(ENTERING)).toMatchObject({ code: 'invalid' });
    expect(at(REVOKED)).toMatchObject({ code: 'invalid' });
    expect(answer(transitionRun(runStateOf(AUTHORIZED), { ...EV.begin, permit: permitAt(2) }, { ...MISMATCHED_CLAIM, lease: 'released' })))
      .toEqual({ reason: 'guard_failed', code: 'invalid' });
  });

  it('keeps a re-authorized slot self → self (gen > 1, unreachable before RUN-03)', () => {
    const regen: RunSnapshot = { ...AUTHORIZED, executionAuthorization: { ...authOf(AUTHORIZED), generation: 2, kernel } };
    const result = ok(transitionRun(runStateOf(regen), { ...EV.begin, permit: permitAt(1, 2) }, CTX));
    expect(result.effects).toEqual(slot('self'));
  });
});

// ------------------------------------------------------------------------ //
// RUN-05 / RUN-06                                                           //
// ------------------------------------------------------------------------ //

describe('RUN-05 entered_observed', () => {
  it('writes running, startedAt, the locator and entered in execution-entry-service.ts key order', () => {
    const auth = authOf(ENTERING);
    const compiled: RunSnapshot = { ...ENTERING, revision: ENTERING.revision + 1, executionHistory: historyLocator(3, 3, null) };
    expectSameRecord(RUNNING, { ...compiled, status: 'running', startedAt: T_ENTER,
      executionAuthorization: { ...auth, revision: auth.revision + 1, phase: 'entered' } });
  });

  it('refuses in recordExecutionEntered order, with no pointer fence and no fresh re-admission', () => {
    const at = (event: RunEvent, run: RunSnapshot = ENTERING, ctx: RunGuardContext = CTX) =>
      answer(transitionRun(runStateOf(run), event, ctx));
    expect(transitionRun(runStateOf({ ...ENTERING, controlState: pointer('cancelled') }), EV.entered,
      ctxWith({ freshAdmission: rejection('capacity', 'deadline') })).ok).toBe(true);
    expect(at({ ...EV.entered, permit: { ...permitAt(2), consumerId: 'other' } })).toEqual({ reason: 'guard_failed', code: 'forbidden' });
    expect(at(EV.entered, ENTERING, ctxWith({ session: { ...CTX.session, usable: false } })))
      .toEqual({ reason: 'guard_failed', code: 'busy' });
    expect(at(EV.entered, ENTERING, ctxWith({ lease: 'missing' }))).toEqual({ reason: 'guard_failed', code: 'busy' });
    expect(at({ ...EV.entered, kernelSource: { ...source(3), turnId: 'turn-x' } }))
      .toEqual({ reason: 'guard_failed', code: 'forbidden' });
    expect(at({ ...EV.entered, history: { ...observed(3, 3, null), kernel: { ...kernel, turnId: 'turn-x' } } }))
      .toEqual({ reason: 'guard_failed', code: 'forbidden' });
    // §6.3 "kernelSource 等于 begin 绑定" on its own: source and history agree with each other on another Turn.
    expect(rejected(transitionRun(runStateOf(ENTERING), { ...EV.entered, kernelSource: { ...source(3), turnId: 'turn-x' },
      history: { ...observed(3, 3, null), kernel: { ...kernel, turnId: 'turn-x' } } }, CTX)))
      .toEqual({ reason: 'guard_failed', code: 'forbidden', detail: 'the entered Kernel source disagrees with the begin binding' });
    expect(at({ ...EV.entered, kernelSource: source(9) })).toEqual({ reason: 'guard_failed', code: 'invalid' });
    expect(at(EV.entered, ENTERING, ctxWith({ session: { ...CTX.session, kernel: { adapterId: 'adapter-1', kernelSessionId: 'other' } } })))
      .toEqual({ reason: 'guard_failed', code: 'forbidden' });
    const v1: RunSnapshot = { ...ENTERING, status: 'running', executionAuthorization: { generation: 1, consumerId: 'c', phase: 'entered' } };
    expect(at(EV.entered, v1)).toEqual({ reason: 'guard_failed', code: 'forbidden' });
    // The persisted claim is the first check (`execution-entry-service.ts:1220`).
    expect(rejected(transitionRun(runStateOf(ENTERING), EV.entered, MISMATCHED_CLAIM))).toEqual({ reason: 'guard_failed',
      code: 'invalid', detail: 'the entry permit claim disagrees with the persisted claim' });
    expect(at(EV.entered, ENTERING, ctxWith({ persistedClaim: null }))).toEqual({ reason: 'illegal', code: 'invalid' });
    expect(at(EV.entered, v1, MISMATCHED_CLAIM)).toEqual({ reason: 'guard_failed', code: 'invalid' });
    expect(at(EV.entered, RUNNING, MISMATCHED_CLAIM)).toEqual({ reason: 'guard_failed', code: 'invalid' });
  });
});

describe('RUN-06 history_recorded', () => {
  it('moves the watermark and keeps the identity (execution-history-binding.ts key order)', () => {
    const result = ok(transitionRun(stateOf('Running'), EV.history, CTX));
    expectSameRecord(result.next.record, { ...RUNNING, revision: RUNNING.revision + 1, executionHistory: historyLocator(3, 6, null) });
  });

  it('keeps the slot self → self for an existing locator without a held V2 begin binding (execution-history-binding.ts:152-154)', () => {
    const { executionAuthorization: _auth, ...preB2 } = RUNNING;
    const v1: RunSnapshot = { ...RUNNING, executionAuthorization: { generation: 1, consumerId: 'c', phase: 'entered' } };
    for (const [label, run] of [['pre-B2', preB2], ['V1', v1]] as const) {
      expect(ok(transitionRun(runStateOf(run), EV.history, CTX)).effects, label).toEqual(slot('self'));
    }
  });

  it('holds the begin slot only for the begin binding\'s own four-field Kernel identity (execution-history-service.ts:413-423 before step 3)', () => {
    // No locator yet: the begin binding names the same identity → self; another run or Turn of the
    // same Kernel session is not begin-held → none.
    expect(ok(transitionRun(stateOf('Entering'), EV.history, CTX)).effects).toEqual(slot('self'));
    for (const field of ['runId', 'turnId'] as const) {
      const other = { ...kernel, [field]: `${kernel[field]}-other` };
      const result = ok(transitionRun(stateOf('Entering'),
        { kind: 'history_recorded', sessionRef, history: { ...observed(3, 6, null), kernel: other } }, CTX));
      expect(result.effects, field).toEqual([{ kind: 'claim_kernel_slot', kernel: other, expectedOwner: 'none' }]);
    }
  });

  it('refuses a moved identity, a backwards watermark, a changed end and a foreign mapping', () => {
    const at = (history: RunObservedHistory, run: RunSnapshot = RUNNING, ctx: RunGuardContext = CTX) =>
      answer(transitionRun(runStateOf(run), { kind: 'history_recorded', sessionRef, history }, ctx));
    expect(at(observed(2, 6, null))).toEqual({ reason: 'stale', code: 'revision_conflict' });
    expect(at({ ...observed(3, 6, null), kernel: { ...kernel, turnId: 'turn-x' } }, RUNNING,
      ctxWith({ session: { ...CTX.session } }))).toEqual({ reason: 'stale', code: 'revision_conflict' });
    expect(at(observed(3, 4, null), ENDED_UNKNOWN)).toEqual({ reason: 'stale', code: 'revision_conflict' });
    expect(at(observed(3, 7, 7), ENDED)).toEqual({ reason: 'stale', code: 'revision_conflict' });
    expect(at(observed(3, 2, null))).toEqual({ reason: 'guard_failed', code: 'invalid' });
    expect(at(observed(3, 6, 9))).toEqual({ reason: 'guard_failed', code: 'invalid' });
    expect(at(observed(3, 6, null), RUNNING, ctxWith({ session: { ...CTX.session, kernel: { adapterId: 'x', kernelSessionId: 'y' } } })))
      .toEqual({ reason: 'guard_failed', code: 'forbidden' });
    expect(at(observed(3, 6, null), RUNNING, ctxWith({ session: { ...CTX.session, kernel: null } })))
      .toEqual({ reason: 'illegal', code: 'invalid' });
    // A malformed stored locator is unreadable, not a conflict.
    const malformed: RunSnapshot = { ...RUNNING, executionHistory: { ...historyLocator(3, 3, null), startPosition: 0 } };
    expect(rejected(transitionRun(runStateOf(malformed), { kind: 'history_recorded', sessionRef, history: observed(3, 6, null) }, CTX)))
      .toEqual({ reason: 'guard_failed', code: 'unavailable', detail: 'the stored executionHistory is malformed' });
    // The same fixed end on an ended Run only re-binds (today: no status check).
    expect(transitionRun(stateOf('Ended'), { kind: 'history_recorded', sessionRef, history: observed(3, 7, 6) }, CTX).ok).toBe(true);
  });
});

// ------------------------------------------------------------------------ //
// RUN-07 / RUN-08                                                           //
// ------------------------------------------------------------------------ //

describe('RUN-07 terminal_observed', () => {
  it('ends the Run in execution-entry-service.ts key order, without terminalPayload today (C1 is step 5.4)', () => {
    const auth = authOf(RUNNING);
    const compiled: RunSnapshot = { ...RUNNING, revision: RUNNING.revision + 1, executionHistory: historyLocator(3, 6, 6) };
    expectSameRecord(ENDED, { ...compiled, status: 'ended', outcome: 'completed',
      exitCode: 0, endedAt: T_END, executionAuthorization: { ...auth, revision: auth.revision + 1, phase: 'settled' },
      lastEventSeq: 1, lastRuntimeEventId: 'rt-run_completed-1',
      lastFactEventId: 'fact-1' });
    expect(ENDED.terminalPayload).toBeUndefined();
    expect(YIELDED_WAIT).toMatchObject({ outcome: 'yielded', continuation, exitCode: null });
    expect(runNodeOf(YIELDED_WAIT)).toBe('YieldedWait');
  });

  it('books every known outcome', () => {
    const cases: Array<[RuntimeEventV1, RunNode, string, number | null]> = [
      [COMPLETED(), 'Ended', 'completed', 0],
      [runtimeEvent('run_crashed', 1, { kind: 'crashed', error: 'boom' }), 'Ended', 'crashed', null],
      [runtimeEvent('run_cancelled', 1, { kind: 'cancelled', reason: 'stop' }), 'Ended', 'cancelled', null],
      [runtimeEvent('run_budget_exhausted', 1, { kind: 'budget_exhausted', exhaustedAt: T_END }), 'Ended', 'budget_exhausted', null],
    ];
    for (const [event, node, outcome, exitCode] of cases) {
      const result = ok(transitionRun(stateOf('Running'), { ...EV.terminal, event }, CTX));
      expect(result.next).toMatchObject({ node, outcome });
      expect(result.next.record?.exitCode).toBe(exitCode);
      expect(result.effects[0]).toEqual({ kind: 'attempt', event: 'attempt_ended', outcome });
    }
  });

  it('releases only what the Run still holds (four ownership combinations)', () => {
    for (const owned of [true, false]) {
      for (const lease of ['owned', 'released', 'other', 'missing'] as const) {
        const result = ok(transitionRun(stateOf('Running'), EV.terminal, ctxWith({ session: { ...CTX.session, owned }, lease })));
        const expected: RunEffect[] = [TERMINAL_EFFECTS[0]!, TERMINAL_EFFECTS[1]!];
        if (owned) expected.push(TERMINAL_EFFECTS[2]!);
        if (lease === 'owned') expected.push({ kind: 'release_lease' });
        expect(result.effects, `${String(owned)}/${lease}`).toEqual(expected);
      }
    }
  });

  it('refuses in Runtime-gate then recordRunResult order', () => {
    const at = (event: RunEvent, ctx: RunGuardContext = CTX, run: RunSnapshot = RUNNING) =>
      rejected(transitionRun(runStateOf(run), event, ctx));
    expect(at(EV.terminal, ctxWith({ exitProof: null }))).toMatchObject({ reason: 'guard_failed', code: 'incomplete' });
    expect(at(EV.terminal, ctxWith({ inputsConfirmed: false }))).toMatchObject({ reason: 'guard_failed', code: 'unavailable' });
    expect(at(EV.terminal, ctxWith({ inputsConfirmed: null }))).toMatchObject({ reason: 'guard_failed', code: 'unavailable' });
    expect(at({ ...EV.terminal, entry: { consumerId: 'other', entryGeneration: 1 } })).toMatchObject({ reason: 'guard_failed', code: 'forbidden' });
    expect(at({ ...EV.terminal, entry: { consumerId: CONSUMER, entryGeneration: 2 } })).toEqual({ reason: 'guard_failed',
      code: 'forbidden', detail: 'the result entry projection does not match the current V2 entry binding' });
    expect(at({ ...EV.terminal, completedHistoryBoundary: null })).toMatchObject({ reason: 'guard_failed', code: 'incomplete' });
    expect(at({ ...EV.terminal, kernelSource: { ...source(6), runId: 'kernel-run-x' } }))
      .toMatchObject({ reason: 'guard_failed', code: 'forbidden' });
    expect(at({ ...EV.terminal, completedHistoryBoundary: { source: source(5), cursor: 'cursor-6' } }))
      .toMatchObject({ reason: 'guard_failed', code: 'invalid' });
    expect(at({ ...EV.terminal, completedHistoryBoundary: { source: source(6), cursor: '' } }))
      .toMatchObject({ reason: 'guard_failed', code: 'invalid' });
    expect(at({ ...EV.terminal, history: { ...observed(3, 6, 6), kernel: { ...kernel, turnId: 'x' } } }))
      .toMatchObject({ reason: 'guard_failed', code: 'forbidden' });
    expect(at({ ...EV.terminal, history: observed(3, 6, null) })).toMatchObject({ reason: 'guard_failed', code: 'incomplete' });
    // The end equals the source position but the window does not reach it, or starts after it: today's incomplete,
    // before the locator shape check would call it invalid.
    const notCarried = 'the observed history does not carry the complete Turn end boundary';
    expect(at({ ...EV.terminal, history: observed(3, 5, 6) })).toEqual({ reason: 'guard_failed', code: 'incomplete', detail: notCarried });
    expect(at({ ...EV.terminal, history: observed(7, 8, 6) })).toEqual({ reason: 'guard_failed', code: 'incomplete', detail: notCarried });
    // The persisted claim is the first check of recordRunResult (`execution-entry-service.ts:1360`).
    expect(at(EV.terminal, MISMATCHED_CLAIM)).toEqual({ reason: 'guard_failed', code: 'invalid',
      detail: 'the result claim disagrees with the persisted claim' });
    expect(at(EV.terminal, ctxWith({ persistedClaim: null }))).toMatchObject({ reason: 'illegal', code: 'invalid' });
    expect(at(EV.terminal, MISMATCHED_CLAIM, ENDED)).toMatchObject({ reason: 'guard_failed', code: 'invalid' });
    expect(at({ ...EV.terminal, event: COMPLETED(0) })).toMatchObject({ reason: 'stale', code: 'revision_conflict' });
    expect(at({ ...EV.terminal, event: { ...COMPLETED(), runRef: runRef('run-x') } }))
      .toMatchObject({ reason: 'guard_failed', code: 'invalid' });
    expect(at({ ...EV.terminal, event: runtimeEvent('run_started', 1, { kind: 'started', startedAt: T_ENTER }) }))
      .toMatchObject({ reason: 'guard_failed', code: 'invalid' });
    expect(at({ ...EV.terminal, event: YIELDED() })).toMatchObject({ reason: 'guard_failed', code: 'invalid' });
    expect(at({ ...EV.terminal, continuation })).toMatchObject({ reason: 'guard_failed', code: 'invalid' });
    expect(at({ ...EV.terminal, event: YIELDED(), continuation: { ...continuation, sessionRef: { projectId: P, sessionId: 'other' } } }))
      .toMatchObject({ reason: 'guard_failed', code: 'invalid' });
    expect(at(EV.terminal, ctxWith({ session: { ...CTX.session, kernel: { adapterId: 'x', kernelSessionId: 'y' } } })))
      .toMatchObject({ reason: 'guard_failed', code: 'forbidden' });
    const preB2: RunSnapshot = { ...RUNNING };
    delete preB2.executionAuthorization;
    expect(at(EV.terminal, CTX, preB2)).toMatchObject({ reason: 'guard_failed', code: 'forbidden' });
    expect(at(EV.terminal, MISMATCHED_CLAIM, preB2)).toMatchObject({ reason: 'guard_failed', code: 'invalid' });
  });

  it('keeps today\'s no-write for unresolved tool calls (RUN-08 is step 5)', () => {
    expect(rejected(transitionRun(stateOf('Running'), { ...EV.terminal, unresolvedToolCallIds: ['call-1'] }, CTX)))
      .toMatchObject({ reason: 'illegal', code: 'invalid', detail: expect.stringContaining('RUN-08') });
  });

  it('answers a re-observed terminal of an unknown Run by inputs, then sequence, then not-new (§6.4)', () => {
    const at = (event: RunEvent, ctx: RunGuardContext = CTX) => answer(transitionRun(stateOf('EndedUnknown'), event, ctx));
    expect(at({ ...EV.terminal, event: COMPLETED(0) })).toEqual({ reason: 'stale', code: 'revision_conflict' });
    for (const inputsConfirmed of [false, null]) {
      expect(at({ ...EV.terminal, event: COMPLETED(0) }, ctxWith({ inputsConfirmed })))
        .toEqual({ reason: 'guard_failed', code: 'unavailable' });
    }
    expect(at({ ...EV.terminal, event: COMPLETED(2) })).toEqual({ reason: 'guard_failed', code: 'incomplete' });
  });
});

// ------------------------------------------------------------------------ //
// A.2 step 3: execution-entry-service.ts routes W3..W6 through the machine   //
// ------------------------------------------------------------------------ //

describe('RUN-02/04/05/07 read the Run, Session and observation as execution-entry-service.ts does (A.2 step 3)', () => {
  const v1 = (run: RunSnapshot): RunSnapshot => ({ ...run, executionAuthorization: { generation: 1, consumerId: 'c', phase: 'entered' } });
  const withPhase = (run: RunSnapshot, phase: ExecutionAuthorizationV2['phase']): RunSnapshot =>
    ({ ...run, executionAuthorization: { ...authOf(RUNNING), phase } });

  it('names an archived and an unavailable claim Session as sessionOccupancyProblem does', () => {
    const cases: Array<[RunEvent, RunSnapshot]> = [[EV.authorize, CLAIMED], [EV.begin, AUTHORIZED], [EV.entered, ENTERING]];
    for (const [event, run] of cases) {
      const at = (session: RunGuardContext['session']) => rejected(transitionRun(runStateOf(run), event, ctxWith({ session })));
      expect(at({ ...CTX.session, usable: false, owned: false, archived: true }), event.kind)
        .toEqual({ reason: 'guard_failed', code: 'busy', detail: 'the claim Session is archived' });
      for (const session of [{ ...CTX.session, usable: false, archived: false }, { ...CTX.session, usable: false }]) {
        expect(at(session), event.kind)
          .toEqual({ reason: 'guard_failed', code: 'busy', detail: 'the claim Session is not available' });
      }
      expect(at({ ...CTX.session, owned: false }).detail).toBe('the claim Session is no longer occupied by this Run generation');
    }
  });

  it('names a claim Lease of another Task as leaseOwnershipProblem does, before the persisted claim', () => {
    const otherTask = ctxWith({ lease: 'other_task' });
    const cases: Array<[RunEvent, RunSnapshot]> = [[EV.authorize, CLAIMED], [EV.begin, AUTHORIZED], [EV.entered, ENTERING]];
    for (const [event, run] of cases) {
      expect(rejected(transitionRun(runStateOf(run), event, otherTask)), event.kind)
        .toEqual({ reason: 'guard_failed', code: 'busy', detail: 'the claim TaskLease names another Task' });
    }
    // W3's prepared claim reaches it: RUN-02 asks the Lease before the persisted claim.
    expect(rejected(transitionRun(runStateOf(CLAIMED), EV.authorize, { ...MISMATCHED_CLAIM, lease: 'other_task' })))
      .toEqual({ reason: 'guard_failed', code: 'busy', detail: 'the claim TaskLease names another Task' });
    // RUN-07 releases only a Lease this Run owns.
    const ended = ok(transitionRun(stateOf('Running'), EV.terminal, otherTask));
    expect(ended.effects.some(effect => effect.kind === 'release_lease')).toBe(false);
  });

  it('refuses a V1 or pre-B2 Run with the one text of a Run without a V2 binding', () => {
    const { executionAuthorization: _auth, ...preB2 } = RUNNING;
    const cases: Array<[RunEvent, RunSnapshot]> = [[EV.begin, v1(AUTHORIZED)], [EV.entered, v1(ENTERING)],
      [EV.terminal, v1(RUNNING)], [EV.terminal, preB2], [EV.begin, CLAIMED]];
    for (const [event, run] of cases) {
      expect(rejected(transitionRun(runStateOf(run), event, CTX)), event.kind)
        .toMatchObject({ code: 'forbidden', detail: 'the Run has no formal V2 entry authorization' });
    }
  });

  it('reads a fresh entry by status, then the V2 phase, also outside the eight states', () => {
    for (const phase of ['entered', 'unknown', 'settled'] as const) {
      const damaged = withPhase(CLAIMED, phase);
      expect(runCombinationProblem(damaged), phase).not.toBeNull();
      expect(rejected(transitionRun(runStateOf(damaged), EV.authorize, CTX)), phase)
        .toEqual({ reason: 'illegal', code: 'busy', detail: 'the Run already has a V2 entry authorization' });
      expect(rejected(transitionRun(runStateOf(damaged), EV.begin, CTX)), phase)
        .toEqual({ reason: 'illegal', code: 'busy', detail: 'the Run entry is not in the authorized phase' });
    }
    // A starting Run that carries an outcome is still starting to today's service.
    const finishedStarting: RunSnapshot = { ...CLAIMED, outcome: 'crashed' };
    expect(ok(transitionRun(runStateOf(finishedStarting), EV.authorize, CTX)).next.record?.outcome).toBe('crashed');
    expect(rejected(transitionRun(runStateOf({ ...AUTHORIZED, status: 'running' }), EV.begin, CTX)))
      .toEqual({ reason: 'illegal', code: 'busy', detail: 'the Run is not in a beginable starting state' });
  });

  it('reads entered_observed by the entering phase alone', () => {
    for (const status of ['running', 'ended'] as const) {
      const result = ok(transitionRun(runStateOf({ ...ENTERING, status }), EV.entered, CTX));
      expect(result.next.record).toMatchObject({ status: 'running', startedAt: T_ENTER });
      expect(result.effects).toEqual([{ kind: 'attempt', event: 'attempt_started' }, { kind: 'outbox', change: 'entered' }]);
    }
  });

  it('reads terminal_observed by the entered phase, then a finished Run', () => {
    const at = (run: RunSnapshot) => rejected(transitionRun(runStateOf(run), EV.terminal, CTX));
    for (const run of [ENDED, YIELDED_WAIT]) {
      expect(at(run)).toEqual({ reason: 'duplicate', code: 'busy', detail: 'the Run entry is not in the entered phase' });
    }
    for (const run of [{ ...RUNNING, status: 'ended' as const, outcome: 'completed' as const },
      { ...RUNNING, outcome: 'crashed' as const }, { ...withPhase(CLAIMED, 'entered'), outcome: 'cancelled' as const }]) {
      expect(at(run)).toEqual({ reason: 'duplicate', code: 'busy', detail: 'the Run already has a terminal result' });
    }
    // A starting Run whose binding is entered is booked as today's service books it.
    expect(ok(transitionRun(runStateOf(withPhase({ ...ENTERING, executionHistory: historyLocator(3, 3, null) }, 'entered')),
      EV.terminal, CTX)).next.record?.status).toBe('ended');
  });

  it('checks the caller\'s terminal observation shapes in recordRunResult order', () => {
    const at = (patch: Partial<Extract<RunEvent, { kind: 'terminal_observed' }>>) =>
      rejected(transitionRun(stateOf('Running'), { ...EV.terminal, ...patch } as RunEvent, CTX));
    expect(at({ kernelSource: { ...source(6), position: 0 } }))
      .toEqual({ reason: 'guard_failed', code: 'invalid', detail: 'the terminal Kernel source is incomplete' });
    expect(at({ kernelSource: 7 as unknown as ReturnType<typeof source> }).detail).toBe('the terminal Kernel source is incomplete');
    for (const boundarySource of [null, 'x', 5]) {
      expect(at({ completedHistoryBoundary: { source: boundarySource as unknown as ReturnType<typeof source>, cursor: 'cursor-6' } }))
        .toEqual({ reason: 'guard_failed', code: 'invalid', detail: 'the completed history boundary disagrees with the terminal source' });
    }
    expect(at({ completedHistoryBoundary: 4 as unknown as { source: ReturnType<typeof source>; cursor: string } }).code).toBe('invalid');
    for (const historyKernel of [null, 'x']) {
      expect(at({ history: { ...observed(3, 6, 6), kernel: historyKernel as unknown as typeof kernel } }))
        .toEqual({ reason: 'guard_failed', code: 'forbidden',
          detail: 'the observed history Kernel identity disagrees with the terminal source' });
    }
    // The order: the entry projection and the null checks come before the shapes.
    expect(at({ kernelSource: { ...source(6), position: 0 }, entry: { consumerId: 'other', entryGeneration: 1 } }).code)
      .toBe('forbidden');
    expect(at({ kernelSource: { ...source(6), position: 0 }, history: null }).code).toBe('incomplete');
  });

  it('compares the stored locator with the claim SessionRef as given (execution-history-binding.ts:115)', () => {
    const wider = { ...claim, sessionRef: { ...sessionRef, note: 'x' } as typeof sessionRef };
    const result = rejected(transitionRun(stateOf('Running'), { ...EV.terminal, claim: wider }, ctxWith({ persistedClaim: wider })));
    expect(result).toEqual({ reason: 'stale', code: 'revision_conflict', detail: 'the execution-history identity/start is already fixed' });
    // Without a stored locator the candidate keeps only the two SessionRef fields.
    const entered = ok(transitionRun(stateOf('Entering'), { ...EV.entered, permit: { ...permitAt(2), claim: wider } },
      ctxWith({ persistedClaim: wider })));
    expect(entered.next.record?.executionHistory?.sessionRef).toEqual(sessionRef);
  });
});

// ------------------------------------------------------------------------ //
// RUN-09..15 control                                                        //
// ------------------------------------------------------------------------ //

describe('RUN-09..11 *_not_entered (U keeps today\'s queued result)', () => {
  it('moves the pointer of a Run that never entered and queues the intent (control-service.ts key order)', () => {
    for (const node of ['Claimed', 'Authorized', 'Revoked'] as const) {
      const run = RECORD_OF[node];
      const stop = ok(transitionRun(stateOf(node), EV.stopU, CTX));
      expectSameRecord(stop.next.record, { ...run, revision: run.revision + 1,
        controlState: { intentRef: intentRef('i-cancel'), desiredState: 'cancelled' } });
      expect(stop.next).toMatchObject({ node, pointer: 'cancelled', outcome: null });
      expect(ok(transitionRun(stateOf(node), EV.pauseU, CTX)).next.pointer).toBe('paused');
    }
  });

  it('applies today\'s submit guards', () => {
    const paused: RunSnapshot = { ...CLAIMED, controlState: pointer('paused', 'i-old') };
    const cancelled: RunSnapshot = { ...CLAIMED, controlState: pointer('cancelled', 'i-old') };
    expect(answer(transitionRun(runStateOf(paused), EV.pauseU, CTX))).toEqual({ reason: 'guard_failed', code: 'busy' });
    expect(answer(transitionRun(runStateOf(cancelled), EV.stopU, CTX))).toEqual({ reason: 'guard_failed', code: 'busy' });
    expect(answer(transitionRun(runStateOf(cancelled), EV.pauseU, CTX))).toEqual({ reason: 'guard_failed', code: 'busy' });
    // A pause on a Run that never entered is never applied today, so resume stays busy.
    expect(answer(transitionRun(runStateOf(paused), EV.resumeU,
      ctxWith({ pointerIntent: { kind: 'pause', status: 'queued', observed: null } })))).toEqual({ reason: 'guard_failed', code: 'busy' });
    const resumed = ok(transitionRun(runStateOf(paused), EV.resumeU,
      ctxWith({ pointerIntent: { kind: 'pause', status: 'applied', observed: 'paused' } })));
    expect(resumed.next.pointer).toBe('running');
    // D-9 (step 5.1): today the Goal is not read for a resume.
    expect(transitionRun(runStateOf(paused), EV.resumeU, ctxWith({
      pointerIntent: { kind: 'pause', status: 'applied', observed: 'paused' },
      goal: { desiredState: 'paused', activePlanMatchesClaim: true } })).ok).toBe(true);
  });
});

describe('RUN-12..15 control_submitted (today: no D-8 supersede, no D-9, no RD-8)', () => {
  it('moves the pointer of an entered Run and appends a steer (control-service.ts key order)', () => {
    const pause = ok(transitionRun(stateOf('Running'), EV.ctlPause, CTX));
    expectSameRecord(pause.next.record, { ...RUNNING, revision: RUNNING.revision + 1,
      controlState: { intentRef: intentRef('i-pause'), desiredState: 'paused' } });
    const steered = { ...RUNNING, controlInputs: [intentRef('i-old')] };
    const steer = ok(transitionRun(runStateOf(steered), EV.ctlSteer, CTX));
    expectSameRecord(steer.next.record, { ...steered, revision: RUNNING.revision + 1,
      controlInputs: [intentRef('i-old'), intentRef('i-steer')] });
    expect(steer.next.pointer).toBe('none');
  });

  it('applies today\'s submit guards in control-service.ts order', () => {
    const at = (run: RunSnapshot, event: RunEvent, ctx: RunGuardContext = CTX) => answer(transitionRun(runStateOf(run), event, ctx));
    expect(at(RUNNING, { ...EV.ctlSteer, reason: '  ' })).toEqual({ reason: 'guard_failed', code: 'invalid' });
    expect(at(RUNNING, { ...EV.ctlSteer, reason: null })).toEqual({ reason: 'guard_failed', code: 'invalid' });
    const cancelled = { ...RUNNING, controlState: pointer('cancelled') };
    for (const event of [EV.ctlPause, EV.ctlCancel, EV.ctlResume, EV.ctlSteer]) {
      expect(at(cancelled, event), event.control).toEqual({ reason: 'guard_failed', code: 'busy' });
    }
    const paused = { ...RUNNING, controlState: pointer('paused') };
    expect(at(paused, EV.ctlPause)).toEqual({ reason: 'guard_failed', code: 'busy' });
    expect(transitionRun(runStateOf(paused), EV.ctlCancel, CTX).ok).toBe(true);
    expect(at(paused, EV.ctlResume, ctxWith({ pointerIntent: { kind: 'pause', status: 'queued', observed: null } })))
      .toEqual({ reason: 'guard_failed', code: 'busy' });
    expect(at(paused, EV.ctlResume, ctxWith({ pointerIntent: { kind: 'pause', status: 'applied', observed: 'terminal_without_cancel' } })))
      .toEqual({ reason: 'guard_failed', code: 'busy' });
    const resume = ok(transitionRun(runStateOf(paused), EV.ctlResume,
      ctxWith({ pointerIntent: { kind: 'pause', status: 'applied', observed: 'paused' } })));
    expect(resume.next.record?.controlState).toEqual({ intentRef: intentRef('i-resume'), desiredState: 'running' });
    const running = { ...RUNNING, controlState: pointer('running') };
    expect(at(running, EV.ctlResume, ctxWith({ pointerIntent: { kind: 'resume', status: 'queued', observed: null } })))
      .toEqual({ reason: 'guard_failed', code: 'busy' });
  });

  it('takes a resume of a yielded wait without the applied-pause check', () => {
    const paused = { ...YIELDED_WAIT, controlState: pointer('paused') };
    const result = ok(transitionRun(runStateOf(paused), EV.ctlResume,
      ctxWith({ pointerIntent: { kind: 'pause', status: 'queued', observed: null } })));
    expect(result.next).toMatchObject({ node: 'YieldedWait', pointer: 'running' });
  });

  it('answers every submission exactly as the shared §7 CTL-01 check (controlSubmissionProblem)', () => {
    const pointers = ['none', 'running', 'paused', 'cancelled', 'steered'] as const;
    const intents: Array<RunGuardContext['pointerIntent']> = [null,
      { kind: 'pause', status: 'applied', observed: 'paused' }, { kind: 'pause', status: 'queued', observed: null },
      { kind: 'cancel', status: 'queued', observed: null }];
    const submissions: Array<[Extract<RunEvent, { kind: 'control_submitted' }>, string | null]> = [
      [EV.ctlPause, null], [EV.ctlCancel, null], [EV.ctlResume, null], [EV.ctlSteer, EV.ctlSteer.reason], [{ ...EV.ctlSteer, reason: ' ' }, ' ']];
    for (const node of ['Running', 'YieldedWait'] as const) {
      for (const ptr of pointers) {
        for (const pointerIntent of intents) {
          for (const [event, reason] of submissions) {
            const run = ptr === 'none' ? RECORD_OF[node] : { ...RECORD_OF[node], controlState: pointer(ptr) };
            const shared = controlSubmissionProblem({ kind: event.control, reason, pointer: ptr, yielded: node === 'YieldedWait',
              pointerIntent });
            const result = transitionRun(runStateOf(run), event, ctxWith({ pointerIntent }));
            const label = `${node}/${ptr}/${JSON.stringify(pointerIntent)}/${event.control}/${String(reason)}`;
            if (shared === null) expect(result.ok, label).toBe(true);
            else expect(rejected(result), label).toEqual({ reason: 'guard_failed', code: shared.code, detail: shared.reason });
          }
        }
      }
    }
  });

  it('keeps today\'s result where step 5.1 flips it (D-9 Goal guard, RD-8 consumed continuation)', () => {
    const paused = { ...YIELDED_WAIT, controlState: pointer('paused') };
    expect(transitionRun(runStateOf(paused), EV.ctlResume, ctxWith({ goal: { desiredState: 'paused', activePlanMatchesClaim: true } })).ok)
      .toBe(true);
    expect(transitionRun(stateOf('YieldedWait'), EV.ctlCancel, ctxWith({ continuationConsumed: true })).ok).toBe(true);
    expect(ok(transitionRun(stateOf('Running'), EV.ctlPause, ctxWith({ queuedSteerCount: 2 }))).effects).toEqual(intentEffect('i-pause'));
  });
});

describe('RUN-09..15 read a control submission as control-service.ts does (A.2 step 3)', () => {
  const ENDED_RUN = 'the Run already ended; no new control intent is accepted';
  /** A yielded outcome with a continuation on a Run whose status is not `ended`. */
  const yieldedNotEnded = (status: 'starting' | 'running'): RunSnapshot => ({ ...YIELDED_WAIT, status });
  /** An unfinished Run whose V2 phase is outside the eight states. */
  const unfinishedPhase = (phase: 'unknown' | 'settled'): RunSnapshot =>
    ({ ...RUNNING, status: 'starting', executionAuthorization: { ...authOf(RUNNING), phase } });

  it('reads every Run of the eight states by its own node', () => {
    for (const node of RUN_NODES.filter((candidate): candidate is Exclude<RunNode, 'Absent'> => candidate !== 'Absent')) {
      expect(runControlNodeOf(RECORD_OF[node]), node).toBe(node);
    }
  });

  it('takes only an ended yielded Run with a continuation as the yielded wait (`control-service.ts:387-391`)', () => {
    for (const status of ['starting', 'running'] as const) {
      const run = yieldedNotEnded(status);
      expect(runNodeOf(run)).toBe('YieldedWait');
      expect(runControlNodeOf(run)).toBe('Ended');
      for (const event of [EV.ctlPause, EV.ctlCancel, EV.ctlResume, EV.ctlSteer]) {
        expect(rejected(transitionRun(runStateOf(run), event, CTX)), `${status}/${event.control}`)
          .toEqual({ reason: 'illegal', code: 'busy', detail: ENDED_RUN });
      }
    }
  });

  it('takes a control on an unfinished Run whose V2 phase is outside the eight states as on an entered Run', () => {
    for (const phase of ['unknown', 'settled'] as const) {
      const run = unfinishedPhase(phase);
      expect(runNodeOf(run)).toBe(phase === 'unknown' ? 'EndedUnknown' : 'Ended');
      expect(runControlNodeOf(run)).toBe('Running');
      expect(controlSubmissionRunEvent(run, intentRef('i-pause'), 'pause', null)).toEqual(EV.ctlPause);
      const paused = ok(transitionRun(runStateOf(run), EV.ctlPause, CTX));
      expectSameRecord(paused.next.record, { ...run, revision: run.revision + 1,
        controlState: { intentRef: intentRef('i-pause'), desiredState: 'paused' } });
      expect(paused.effects).toEqual(intentEffect('i-pause'));
    }
  });

  it('controlSubmissionRunEvent: pause, cancel and resume of a Run that never entered are RUN-09..11 (U)', () => {
    for (const node of ['Claimed', 'Authorized', 'Revoked'] as const) {
      const run = RECORD_OF[node];
      expect(controlSubmissionRunEvent(run, intentRef('i-cancel'), 'cancel', 'stop now'), node).toEqual(EV.stopU);
      expect(controlSubmissionRunEvent(run, intentRef('i-pause'), 'pause', null), node).toEqual(EV.pauseU);
      expect(controlSubmissionRunEvent(run, intentRef('i-resume'), 'resume', null), node).toEqual(EV.resumeU);
      expect(controlSubmissionRunEvent(run, intentRef('i-steer'), 'steer', EV.ctlSteer.reason), node).toEqual(EV.ctlSteer);
    }
    for (const node of ['Entering', 'Running', 'YieldedWait', 'Ended', 'EndedUnknown'] as const) {
      for (const event of [EV.ctlPause, EV.ctlCancel, EV.ctlResume, EV.ctlSteer]) {
        expect(controlSubmissionRunEvent(RECORD_OF[node], event.intentRef, event.control, event.reason), node).toEqual(event);
      }
    }
  });

  it('answers every submission as §7 CTL-01 answers it on the same Run read', () => {
    const runs: RunSnapshot[] = [...Object.values(RECORD_OF), yieldedNotEnded('running'), unfinishedPhase('settled')];
    const pointers = ['none', 'running', 'paused', 'cancelled', 'steered'] as const;
    const intents: Array<RunGuardContext['pointerIntent']> = [null,
      { kind: 'pause', status: 'applied', observed: 'paused' }, { kind: 'pause', status: 'queued', observed: null },
      { kind: 'cancel', status: 'queued', observed: null }];
    const submissions: Array<[ControlIntentKindV1, string | null]> = [
      ['pause', null], ['cancel', null], ['resume', null], ['steer', 'look at the tests first'], ['steer', ' ']];
    const fresh = intentRef('i-new');
    for (const base of runs) {
      for (const ptr of pointers) {
        for (const pointerIntent of intents) {
          for (const [kind, reason] of submissions) {
            const run = ptr === 'none' ? base : { ...base, controlState: pointer(ptr) };
            const label = `${runControlNodeOf(run)}/${run.status}/${ptr}/${JSON.stringify(pointerIntent)}/${kind}/${String(reason)}`;
            const control = transitionControlIntent({ node: 'Absent', kind: null, revision: 0, observation: null },
              { type: 'control_submitted', target: 'run', intentRef: fresh, kind, reason },
              { run: { node: runControlNodeOf(run), pointer: runStateOf(run).pointer, pointsHere: false, inControlInputs: false,
                continuationConsumed: false, kernelPaused: false, pausedInterrupted: false, entry: null, history: null },
              goal: { desiredState: 'active' }, pointerIntent, pinsMatch: { intent: true, run: true }, exitProof: null,
              origin: 'live' });
            const moved = transitionRun(runStateOf(run), controlSubmissionRunEvent(run, fresh, kind, reason), ctxWith({ pointerIntent }));
            if (control.ok) {
              expect(moved.ok, label).toBe(true);
              expect(ok(moved).effects, label).toEqual(intentEffect('i-new'));
            } else {
              expect(rejected(moved), label).toEqual({ reason: control.reason, code: control.code, detail: control.detail });
            }
          }
        }
      }
    }
  });
});

// ------------------------------------------------------------------------ //
// 新增 rows: §6.4 refusals in front, then the row answers notYet            //
// ------------------------------------------------------------------------ //

describe('RUN-16..24: the §6.4 refusals in front of the 新增 rows', () => {
  const legacy: RunSnapshot = { ...RUNNING, executionAuthorization: { generation: 1, consumerId: 'c', phase: 'entered' } };

  it('reconcile_*: legacy, Host lease, probe, then the row', () => {
    for (const event of [EV.recNotEntered, EV.recTerminal, EV.recInterrupted, EV.recUnknown]) {
      expect(answer(transitionRun(runStateOf(legacy), event, CTX)), event.kind).toEqual({ reason: 'guard_failed', code: 'unsupported' });
      for (const node of ['Entering', 'Running', 'Ended', 'Claimed'] as const) {
        expect(answer(transitionRun(stateOf(node), event, ctxWith({ hostLease: 'held_by_other' }))), `${node} ${event.kind}`)
          .toEqual({ reason: 'guard_failed', code: 'busy' });
      }
      expect(answer(transitionRun(stateOf('Running'), event, ctxWith({ hostLease: null }))))
        .toEqual({ reason: 'guard_failed', code: 'busy' });
      for (const kernelProbe of ['host_config', 'transient', 'cancelled'] as const) {
        expect(answer(transitionRun(stateOf('Entering'), event, ctxWith({ kernelProbe }))), `${kernelProbe} ${event.kind}`)
          .toEqual({ reason: 'guard_failed', code: 'unavailable' });
      }
    }
    // §6.4: an unreadable Kernel is not proof of not entering; RUN-20(ii) takes it.
    for (const kernelProbe of ['missing', 'damaged'] as const) {
      expect(answer(transitionRun(stateOf('Entering'), EV.recNotEntered, ctxWith({ kernelProbe }))))
        .toEqual({ reason: 'guard_failed', code: 'unavailable' });
      expect(rejected(transitionRun(stateOf('Entering'), { ...EV.recUnknown, cause: 'kernel_unreadable' }, ctxWith({ kernelProbe }))).detail)
        .toContain('RUN-20');
    }
    // The in-process RUN-16 variant needs no instance lease of its own.
    expect(rejected(transitionRun(stateOf('Entering'), { ...EV.recNotEntered, basis: LIVE }, ctxWith({ hostLease: null }))).detail)
      .toContain('RUN-16');
  });

  it('reconcile_interrupted_clean picks RUN-24 for a paused pointer and refuses a queued cancel (C4, LA-7)', () => {
    for (const node of ['Entering', 'Running'] as const) {
      const run = RECORD_OF[node];
      expect(rejected(transitionRun(runStateOf({ ...run, controlState: pointer('paused') }), EV.recInterrupted,
        ctxWith({ pointerIntent: { kind: 'pause', status: 'queued', observed: null } }))).detail).toContain('RUN-24');
      expect(rejected(transitionRun(runStateOf({ ...run, controlState: pointer('running') }), EV.recInterrupted,
        ctxWith({ pointerIntent: { kind: 'resume', status: 'queued', observed: null } }))).detail).toContain('RUN-19');
      expect(rejected(transitionRun(runStateOf({ ...run, controlState: pointer('cancelled') }), EV.recInterrupted,
        ctxWith({ pointerIntent: { kind: 'cancel', status: 'queued', observed: null } }))))
        .toMatchObject({ reason: 'illegal', code: 'invalid', detail: expect.stringContaining('RUN-23') });
    }
  });

  it('stop_paused: exit proof, Host lease, Entering only on restart, clean Turn, safe point, queued cancel', () => {
    const cancelled = { ...RUNNING, controlState: pointer('cancelled', 'i-cancel') };
    const queuedCancel = { pointerIntent: { kind: 'cancel' as const, status: 'queued' as const, observed: null } };
    const at = (run: RunSnapshot, ctx: RunGuardContext, event: RunEvent = EV.stopPaused) => rejected(transitionRun(runStateOf(run), event, ctx));
    expect(at(cancelled, ctxWith({ ...queuedCancel, exitProof: null }))).toMatchObject({ reason: 'guard_failed', code: 'incomplete' });
    expect(at(cancelled, ctxWith({ ...queuedCancel, exitProof: 'host_instance_takeover', hostLease: null })))
      .toMatchObject({ reason: 'guard_failed', code: 'busy' });
    expect(at(cancelled, ctxWith({ ...queuedCancel, kernelPaused: true, hostLease: 'held_by_other' })))
      .toMatchObject({ reason: 'guard_failed', code: 'busy' });
    expect(at(cancelled, ctxWith({ ...queuedCancel, kernelPaused: true }),
      { ...EV.stopPaused, turn: { ...CLEAN_TURN, terminal: true } })).toMatchObject({ reason: 'guard_failed', code: 'incomplete' });
    expect(at(cancelled, ctxWith({ ...queuedCancel, kernelPaused: true }),
      { ...EV.stopPaused, turn: { ...CLEAN_TURN, inFlightToolCallIds: ['call-1'] } })).toMatchObject({ reason: 'guard_failed', code: 'incomplete' });
    expect(at(cancelled, ctxWith({ ...queuedCancel }))).toMatchObject({ reason: 'guard_failed', code: 'incomplete' });
    expect(at(RUNNING, ctxWith({ kernelPaused: true }))).toMatchObject({ reason: 'illegal', code: 'invalid' });
    // A cancelled pointer whose intent is not a queued cancel is refused in front of the row, not by its notYet.
    const notQueuedCancel = 'stop_paused applies the queued cancel the pointer names';
    for (const pointerIntent of [{ kind: 'cancel', status: 'applied', observed: 'cancelled' },
      { kind: 'cancel', status: 'superseded', observed: null }, { kind: 'pause', status: 'queued', observed: null }, null] as const) {
      expect(at(cancelled, ctxWith({ pointerIntent, kernelPaused: true })), JSON.stringify(pointerIntent))
        .toEqual({ reason: 'illegal', code: 'invalid', detail: notQueuedCancel });
    }
    expect(at(cancelled, ctxWith({ ...queuedCancel, kernelPaused: true }))).toMatchObject({ reason: 'illegal', code: 'invalid',
      detail: expect.stringContaining('RUN-23') });
    // Restart variant: the Kernel need not be paused (LA-7) and Entering is allowed.
    const restart = ctxWith({ ...queuedCancel, exitProof: 'host_instance_takeover' });
    expect(at(cancelled, restart).detail).toContain('RUN-23');
    expect(at({ ...ENTERING, controlState: pointer('cancelled', 'i-cancel') }, restart).detail).toContain('RUN-23');
    expect(at({ ...ENTERING, controlState: pointer('cancelled', 'i-cancel') }, ctxWith({ ...queuedCancel, kernelPaused: true })))
      .toMatchObject({ reason: 'illegal', code: 'invalid', detail: expect.stringContaining('restart') });
  });

  it('late_evidence: exit proof, lease, inputs, sequence, then new Kernel evidence only (RD-4)', () => {
    const at = (event: RunEvent, ctx: RunGuardContext = CTX, run: RunSnapshot = ENDED_UNKNOWN) =>
      rejected(transitionRun(runStateOf(run), event, ctx));
    expect(at(EV.late, ctxWith({ exitProof: null }))).toMatchObject({ reason: 'guard_failed', code: 'incomplete' });
    expect(at(EV.late, ctxWith({ hostLease: null }))).toMatchObject({ reason: 'guard_failed', code: 'busy' });
    expect(at({ ...EV.late, basis: LIVE }, ctxWith({ hostLease: null })).detail).toContain('RUN-21');
    expect(at(EV.late, ctxWith({ inputsConfirmed: null }))).toMatchObject({ reason: 'guard_failed', code: 'unavailable' });
    expect(at({ ...EV.late, event: COMPLETED(0) })).toMatchObject({ reason: 'stale', code: 'revision_conflict' });
    expect(at({ ...EV.late, kernelSource: source(5) })).toMatchObject({ reason: 'guard_failed', code: 'incomplete' });
    expect(at({ ...EV.late, unresolvedToolCallIds: ['call-1'] })).toMatchObject({ reason: 'guard_failed', code: 'incomplete' });
    expect(at({ ...EV.late, unresolvedToolCallIds: ['call-other'] }).detail).toContain('RUN-21');
    // After RUN-20(ii) the window is null: any position is new, but no call may stay unresolved.
    const unreadable: RunSnapshot = { ...ENDED_UNKNOWN, reconciliation: { ...UNRESOLVED,
      observation: { kind: 'unresolved', reason: 'kernel unreadable', observedThroughPosition: null, unresolvedToolCallIds: [] } } };
    expect(at({ ...EV.late, kernelSource: source(1) }, CTX, unreadable).detail).toContain('RUN-21');
    expect(at({ ...EV.late, unresolvedToolCallIds: ['call-2'] }, CTX, unreadable))
      .toMatchObject({ reason: 'guard_failed', code: 'incomplete' });
  });

  it('unknown_attested: operator, reason, own Host lease (D-4(b), L-1)', () => {
    const at = (event: RunEvent, ctx: RunGuardContext = CTX) => rejected(transitionRun(stateOf('EndedUnknown'), event, ctx));
    expect(at(EV.attest, ctxWith({ actor: 'system' }))).toMatchObject({ reason: 'guard_failed', code: 'forbidden' });
    expect(at({ ...EV.attest, reason: ' ' })).toMatchObject({ reason: 'guard_failed', code: 'invalid' });
    expect(at(EV.attest, ctxWith({ hostLease: null }))).toMatchObject({ reason: 'guard_failed', code: 'busy' });
    expect(at(EV.attest, ctxWith({ hostLease: 'held_by_other' }))).toMatchObject({ reason: 'guard_failed', code: 'busy' });
    expect(at(EV.attest).detail).toContain('RUN-22');
  });
});

// ------------------------------------------------------------------------ //
// Pure helpers                                                              //
// ------------------------------------------------------------------------ //

describe('pure helpers (§6.6, §15.1)', () => {
  it('runControlFence keeps freshRunControlProblem', () => {
    expect(runControlFence(CLAIMED)).toBeNull();
    expect(runControlFence({ controlState: pointer('running') })).toBeNull();
    expect(runControlFence({ controlState: pointer('paused', 'i-9') })).toEqual({ status: 'rejected', code: 'busy',
      reason: 'the Run is fenced by a queued paused control intent (i-9); no fresh execution action is admitted' });
    expect(runControlFence({ controlState: pointer('cancelled', 'i-9') })?.code).toBe('busy');
    expect(runControlFence({ controlState: pointer('steered', 'i-9') })).toEqual({ status: 'rejected', code: 'unsupported',
      reason: 'the Run carries a steered control pointer (i-9) that this stage does not implement' });
  });

  it('isRunFinished and leaseOwnedByRun', () => {
    expect(isRunFinished(RUNNING)).toBe(false);
    expect(isRunFinished(ENDED)).toBe(true);
    expect(isRunFinished({ status: 'running', outcome: 'crashed' })).toBe(true);
    const lease: TaskLeaseSnapshot = { ref: { aggregateType: 'TaskLease', projectId: P, goalId: G, taskId: T }, revision: 1,
      schemaVersion: 1, holderRunId: 'run-1', attemptId: 'att-1', grantedAt: T_CLAIM, expiresAt: null };
    expect(leaseOwnedByRun(lease, claim)).toBe(true);
    expect(leaseOwnedByRun(null, claim)).toBe(false);
    expect(leaseOwnedByRun({ ...lease, attemptId: 'att-2' }, claim)).toBe(false);
    expect(leaseOwnedByRun({ ...lease, release: { schemaVersion: 1, runRef: claim.runRef, attemptRef: claim.attemptRef,
      sessionRef, generation: GEN, releasedAt: T_END, eventId: 'e' } }, claim)).toBe(false);
  });

  it('terminalOutcomeOf keeps terminalFact', () => {
    expect(terminalOutcomeOf(COMPLETED(), claim.runRef, 0)).toEqual({ outcome: 'completed', exitCode: 0 });
    expect(terminalOutcomeOf(YIELDED(), claim.runRef, 0)).toEqual({ outcome: 'yielded', exitCode: null });
    expect(terminalOutcomeOf(COMPLETED(1), claim.runRef, 1)).toMatchObject({ code: 'revision_conflict' });
    expect(terminalOutcomeOf(COMPLETED(), runRef('run-x'), 0)).toMatchObject({ code: 'invalid' });
    expect(terminalOutcomeOf({ ...COMPLETED(), eventId: '' }, claim.runRef, 0)).toMatchObject({ code: 'invalid' });
    expect(terminalOutcomeOf({ ...COMPLETED(), sequence: -1 }, claim.runRef, 0)).toMatchObject({ code: 'invalid' });
    expect(terminalOutcomeOf(runtimeEvent('run_crashed', 1, { kind: 'completed', exitCode: 1 }), claim.runRef, 0))
      .toMatchObject({ code: 'invalid' });
    expect(terminalOutcomeOf(runtimeEvent('run_yielded', 1, { kind: 'yielded',
      yield: { reason: 'nope' as 'reply_required', requestedBy: 'runtime', yieldedAt: T_END, pendingToolCallId: null } }), claim.runRef, 0))
      .toMatchObject({ code: 'invalid' });
  });

  it('terminalPayloadOf bounds crashed and cancelled text (contract (f), C1)', () => {
    const exact = 'x'.repeat(TERMINAL_PAYLOAD_TEXT_MAX_CHARS);
    expect(terminalPayloadOf({ kind: 'crashed', error: exact })).toEqual({ kind: 'crashed', error: exact });
    expect(terminalPayloadOf({ kind: 'crashed', error: `${exact}y` }))
      .toEqual({ kind: 'crashed', error: exact + TERMINAL_PAYLOAD_TRUNCATION_SUFFIX });
    expect(terminalPayloadOf({ kind: 'cancelled', reason: `${exact}yy` }))
      .toEqual({ kind: 'cancelled', reason: exact + TERMINAL_PAYLOAD_TRUNCATION_SUFFIX });
    const completed = { kind: 'completed' as const, exitCode: 3 };
    expect(terminalPayloadOf(completed)).toEqual(completed);
    expect(terminalPayloadOf(completed)).not.toBe(completed);
    expect(attestedTerminalPayload('looked')).toEqual({ kind: 'crashed', error: 'human_attested: looked' });
  });

  it('isPausedInterrupted is true only for crashed + interrupted_clean + a pause intent (C4)', () => {
    const interrupted = (outcome: 'crashed' | 'cancelled', pausedIntentRef: ControlIntentRef | null): RunSnapshot => ({
      ...ENDED, outcome, reconciliation: { status: 'done', basis: TAKEOVER, recordedAt: T_LATER,
        observation: { kind: 'interrupted_clean', event: runtimeEvent('run_crashed', 2, { kind: 'crashed', error: 'host_interrupted' }),
          lastPosition: 5, kernelPaused: true, pausedIntentRef } } });
    expect(isPausedInterrupted(interrupted('crashed', intentRef('i-pause')))).toBe(true);
    expect(isPausedInterrupted(interrupted('crashed', null))).toBe(false);
    expect(isPausedInterrupted(interrupted('cancelled', null))).toBe(false);
    expect(isPausedInterrupted(interrupted('cancelled', intentRef('i-pause')))).toBe(false);
    expect(isPausedInterrupted(ENDED)).toBe(false);
    expect(isPausedInterrupted({ ...ENDED, outcome: 'crashed' })).toBe(false);
  });

  it('runUnresolvedBlocker keeps completion-policy.ts runBlocker', () => {
    expect(runUnresolvedBlocker(CLAIMED)).toBe('run run-1 is starting and has not ended');
    expect(runUnresolvedBlocker(RUNNING)).toBe('run run-1 is running and has not ended');
    expect(runUnresolvedBlocker(ENDED)).toBeNull();
    expect(runUnresolvedBlocker(YIELDED_WAIT)).toBeNull();
    expect(runUnresolvedBlocker(ENDED_UNKNOWN)).toBe('run run-1 ended with an unknown outcome');
    expect(runUnresolvedBlocker({ ...ENDED, reconciliation: UNRESOLVED })).toBe('run run-1 is quarantined and not reconciled');
    expect(runUnresolvedBlocker({ ...ENDED, reconciliation: { ...UNRESOLVED, status: 'done' } }))
      .toBe('run run-1 carries an unresolved reconciliation');
    expect(runUnresolvedBlocker({ ...ENDED, executionAuthorization: { ...authOf(ENDED), phase: 'unknown' } }))
      .toBe('run run-1 carries an unreconciled unknown entry authorization');
    expect(runUnresolvedBlocker({ ...ENDED, executionAuthorization: { generation: 1, consumerId: 'c', phase: 'quarantined' } }))
      .toBe('run run-1 carries an unreconciled quarantined entry authorization');
    const done = (observation: RunReconciliationV1['observation']): RunSnapshot =>
      ({ ...ENDED, reconciliation: { status: 'done', observation, basis: TAKEOVER, recordedAt: T_LATER } });
    expect(runUnresolvedBlocker(done({ kind: 'not_entered', kernel, revokedGeneration: 1 }))).toBeNull();
    expect(runUnresolvedBlocker(done({ kind: 'runtime_terminal', event: COMPLETED(), digest: 'a'.repeat(64) }))).toBeNull();
    expect(runUnresolvedBlocker(done({ kind: 'human_attested', attestedBy: { kind: 'human', id: 'op' }, reason: 'r' }))).toBeNull();
    expect(runUnresolvedBlocker(done({ kind: 'interrupted_clean', event: COMPLETED(), lastPosition: null, kernelPaused: false,
      pausedIntentRef: null }))).toBeNull();
  });
});

// ------------------------------------------------------------------------ //
// One walk                                                                  //
// ------------------------------------------------------------------------ //

describe('a claim → authorize → begin → entered → history → yield walk', () => {
  it('passes only legal combinations and moves the ordering watermark once', () => {
    let state = runStateOf(null);
    const steps: Array<[RunEvent, RunNode]> = [
      [EV.claim, 'Claimed'], [EV.ctlSteer, 'Claimed'], [EV.authorize, 'Authorized'], [EV.begin, 'Entering'],
      [EV.entered, 'Running'], [{ kind: 'history_recorded', sessionRef, history: observed(3, 5, null) }, 'Running'],
      [EV.ctlPause, 'Running'], [{ ...EV.terminal, event: YIELDED(), continuation }, 'YieldedWait'],
      [{ ...EV.ctlCancel, intentRef: intentRef('i-cancel-2') }, 'YieldedWait'],
    ];
    let revision = 0;
    for (const [event, node] of steps) {
      const result = ok(transitionRun(state, event, CTX));
      state = result.next;
      expect(state.node).toBe(node);
      expect(state.record?.revision).toBe(revision + 1);
      revision = state.record!.revision;
      expect(runCombinationProblem(state.record!)).toBeNull();
    }
    expect(state).toMatchObject({ outcome: 'yielded', lastEventSeq: 1, pointer: 'cancelled', entryGeneration: 1 });
    expect(state.record?.controlInputs).toEqual([intentRef('i-steer')]);
    expect(state.record?.executionHistory).toEqual(historyLocator(3, 6, 6));
  });
});
