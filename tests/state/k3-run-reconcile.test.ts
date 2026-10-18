/**
 * K3-30 (R5): the RUN-25 transition of `src/core/work-graph/state/run-machine.ts`
 * (slice-K3-SPEC §3.1 RUN-25, §5.2 K3-30, L25 guard order G10/G1/G3/G4/G5/G7/G9/G11,
 * §2 `takeover_unresolved` observation and `AutoCleanupCandidateV1`).
 *
 * Pure R5: only the state machine and `src/contracts`; no RecordStore, no
 * service, no Kernel, no `node:crypto`. The Entering/Running fixtures are
 * driven through `newRunRecord` -> `entry_authorized` -> `entry_begun` ->
 * `entered_observed`, then `reconcile_unknown` is hand-built.
 */
import { describe, expect, it } from 'vitest';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type {
  DispatchOutboxRef, RoleBindingRefV1, RunRef, RunSnapshot, RuntimeInputBindingV1, TaskAttemptRef,
} from '../../src/contracts/dispatch.js';
import type { PlanRevisionRef } from '../../src/contracts/plan.js';
import type { TaskEnvelopeV1 } from '../../src/contracts/task-envelope.js';
import type {
  HostTakeoverProofV1, UnknownCallReviewDraftV1, UnknownCallReviewItemV1, UnknownCallReviewRef, WorkspaceCaptureV1,
} from '../../src/contracts/unknown-call-review.js';
import {
  newRunRecord, runStateOf, transitionRun,
  type AutoCleanupCandidateV1, type RunEffect, type RunEvent, type RunGuardContext, type RunTransition,
} from '../../src/core/work-graph/state/run-machine.js';
import {
  transitionSession, type SessionGuardContext, type SessionHolderContext, type SessionMachineState,
} from '../../src/core/work-graph/state/session-availability.js';

// ------------------------------------------------------------------------ //
// Fixtures                                                                  //
// ------------------------------------------------------------------------ //

const P = 'run-project', G = 'run-goal', T = 'run-task', W = 'run-workspace';
const GEN = 4;
const T_CLAIM = '2026-10-04T01:00:00.000Z';
const T_ENTER = '2026-10-04T01:01:00.000Z';
const T_END = '2026-10-04T01:02:00.000Z';
const T_LATER = '2026-10-04T01:03:00.000Z';
const CONSUMER = 'consumer-1';
const DIGEST = 'd'.repeat(64);

const runRef = (runId: string): RunRef => ({ aggregateType: 'Run', projectId: P, goalId: G, runId });
const attemptRef = (attemptId: string): TaskAttemptRef =>
  ({ aggregateType: 'TaskAttempt', projectId: P, goalId: G, taskId: T, attemptId });
const outboxRef = (attemptId: string): DispatchOutboxRef =>
  ({ aggregateType: 'DispatchOutboxEntry', projectId: P, goalId: G, taskId: T, attemptId });
const intentRef = (intentId: string) =>
  ({ aggregateType: 'ControlIntent' as const, projectId: P, workspaceId: W, intentId });
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
const observed = (start: number, through: number, end: number | null) =>
  ({ kernel, startPosition: start, observedThroughPosition: through, endPosition: end });
const permitAt = (authorizationRevision: number, entryGeneration = 1) =>
  ({ claim, consumerId: CONSUMER, entryGeneration, authorizationRevision, inputDigest: DIGEST });

const TAKEOVER = { kind: 'host_instance_takeover' as const, hostInstanceId: 'host-1' };

// ------------------------------------------------------------------------ //
// Guard context and the driven nodes                                        //
// ------------------------------------------------------------------------ //

/** Every guard holds, minus the K3 fields that are `undefined` in an old context. */
const CTX: RunGuardContext = {
  session: { usable: true, owned: true, kernel: { adapterId: kernel.adapterId, kernelSessionId: kernel.kernelSessionId } },
  lease: 'owned',
  persistedClaim: claim,
  goal: { desiredState: 'active', activePlanMatchesClaim: true },
  entryPlan: 'active_plan',
  continuationBrief: 'absent_ok',
  freshAdmission: null,
  pointerIntent: null,
  queuedSteers: [],
  continuationConsumed: false,
  exitProof: 'live_clean',
  hostLease: 'owned',
  kernelProbe: 'ready',
  kernelPaused: false,
  inputsConfirmed: true,
  actor: 'human',
  claim: { sessionOccupied: false, eligibility: null, taskHasRun: false, prior: null, admission: null, requeue: null },
};
const ctxWith = (patch: Partial<RunGuardContext>): RunGuardContext => ({ ...CTX, ...patch });

const CLEAN_TURN = { terminal: false, inFlightToolCallIds: [] as readonly string[], lastPosition: 5, entered: null,
  acceptedSteers: [] as readonly never[] };
/** Row 8's Turn fact: no Kernel terminal, at least one call still in flight. */
const RUN25_TURN = { ...CLEAN_TURN, inFlightToolCallIds: ['call-1'] };
const ENTERED_TURN = { ...RUN25_TURN,
  entered: { enteredAt: T_ENTER, kernelSource: source(3), history: observed(3, 5, null) } };

const EV = {
  authorize: { kind: 'entry_authorized', claim, consumerId: CONSUMER, envelope, inputBinding },
  begin: { kind: 'entry_begun', permit: permitAt(1), kernel },
  entered: { kind: 'entered_observed', permit: permitAt(2), kernelSource: source(3), history: observed(3, 3, null),
    enteredAt: T_ENTER },
} satisfies Record<string, RunEvent>;

function ok(result: RunTransition): Extract<RunTransition, { ok: true }> {
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

// ------------------------------------------------------------------------ //
// The RUN-25 candidate, draft and event                                     //
// ------------------------------------------------------------------------ //

const PROOF: HostTakeoverProofV1 = { kind: 'hl01_no_lock' };
const WORKSPACE: WorkspaceCaptureV1 = { status: 'unavailable', runBaselineKnown: false, reason: 'no_baseline',
  detail: 'no baseline' };
const ITEM: UnknownCallReviewItemV1 = {
  alias: 1, callId: 'call-1', toolName: 'shell', kind: 'process', contained: true,
  kernel: { adapterId: kernel.adapterId, kernelSessionId: kernel.kernelSessionId, kernelRunId: kernel.runId,
    turnId: kernel.turnId, callId: 'call-1', declaredPosition: 1, startedPosition: 2 },
  argumentsDigest: 'a'.repeat(64),
  summary: { command: 'npm test', cwd: null, mode: null, paths: [], pathsOmitted: 0, truncated: false },
  startedAt: T_END,
  observed: { verdict: 'pending', by: null },
};
const DRAFT: UnknownCallReviewDraftV1 = { inventory: 'complete', inventoryProblem: null, items: [ITEM],
  itemsOmitted: 0, workspace: WORKSPACE };

const candidate = (patch: Partial<AutoCleanupCandidateV1> = {}): AutoCleanupCandidateV1 => ({
  proof: PROOF,
  closure: { status: 'supported', headActiveRunId: kernel.runId },
  workspace: WORKSPACE,
  unresolvedCalls: [{ callId: 'call-1', toolName: 'shell' }],
  draft: DRAFT,
  ...patch,
});

type ReconcileUnknown = Extract<RunEvent, { kind: 'reconcile_unknown' }>;
const recUnknown = (patch: Partial<ReconcileUnknown> = {}): ReconcileUnknown => ({
  kind: 'reconcile_unknown', claim, basis: TAKEOVER, cause: 'tool_calls_unresolved',
  unresolvedToolCallIds: ['call-1'], observedThroughPosition: 5, turn: RUN25_TURN, recordedAt: T_LATER,
  factEventId: 'fact-25', autoCleanup: candidate(), ...patch,
});

/** The context in which every WorkGraph-side RUN-25 guard holds. */
const ctxAuto = (patch: Partial<RunGuardContext> = {}): RunGuardContext =>
  ctxWith({ exitProof: 'host_instance_takeover', takeoverProof: PROOF, sessionClosable: true, priorAutoCleanup: false, ...patch });
/** `ctxAuto` with one K3 guard field genuinely absent (not `undefined`-valued; `exactOptionalPropertyTypes`). */
const ctxAutoWithout = (field: 'takeoverProof' | 'sessionClosable' | 'priorAutoCleanup'): RunGuardContext => {
  const base: Partial<RunGuardContext> = { exitProof: 'host_instance_takeover' };
  if (field !== 'takeoverProof') base.takeoverProof = PROOF;
  if (field !== 'sessionClosable') base.sessionClosable = true;
  if (field !== 'priorAutoCleanup') base.priorAutoCleanup = false;
  return ctxWith(base);
};

const pointer = (desiredState: NonNullable<RunSnapshot['controlState']>['desiredState']) =>
  ({ intentRef: intentRef('i-ptr'), desiredState });

const reviewRef: UnknownCallReviewRef = { aggregateType: 'UnknownCallReview', projectId: P, goalId: G, runId: 'run-1' };

function reviewEffectOf(effects: readonly RunEffect[]) {
  const found = effects.filter((effect): effect is Extract<RunEffect, { kind: 'create_review_record' }> =>
    effect.kind === 'create_review_record');
  expect(found).toHaveLength(1);
  const review = found[0]!.review;
  return review;
}
function observationOf(result: RunTransition) {
  const record = ok(result).next.record;
  expect(record).not.toBeNull();
  return record!.reconciliation?.observation;
}

// ------------------------------------------------------------------------ //
// K3-30: RUN-25 from Running and Entering                                   //
// ------------------------------------------------------------------------ //

describe('K3-30 (R5): RUN-25 automatic closure', () => {
  it('K3-30 RUN-25 from Running: crashed, takeover_unresolved, all five effects', () => {
    const cand = candidate();
    const result = ok(transitionRun(runStateOf(RUNNING), recUnknown({ autoCleanup: cand }), ctxAuto()));
    expect(result.next.node).toBe('Ended');

    const record = result.next.record!;
    expect(record.outcome).toBe('crashed');
    expect(record.status).toBe('ended');
    expect(record.terminalPayload).toMatchObject({ kind: 'crashed' });

    // Exactly one of each paired effect, in RUN-25's order.
    expect(result.effects.filter((effect) => effect.kind !== 'create_review_record')).toEqual([
      { kind: 'attempt', event: 'attempt_ended', outcome: 'crashed' },
      { kind: 'outbox', change: 'settled_entered' },
      { kind: 'release_session', holder: claim.runRef, generation: GEN, historyCursor: { kind: 'keep' }, kernelTurnOpen: true },
      { kind: 'release_lease' },
    ]);

    expect(record.reconciliation?.observation).toMatchObject({
      kind: 'takeover_unresolved',
      unresolvedToolCallIds: ['call-1'],
      proof: PROOF,
      reviewRef,
    });
    expect(record.reconciliation).toMatchObject({ status: 'done', observation: { kind: 'takeover_unresolved' } });

    const review = reviewEffectOf(result.effects);
    expect(review.ref).toEqual(reviewRef);
    expect(review.inventory).toBe(DRAFT.inventory);
    expect(review.items).toEqual(DRAFT.items);
    expect(review.origin).toEqual({ kind: 'takeover_unresolved', hostInstanceId: 'host-1', proof: PROOF });
  });

  it('K3-30 RUN-25 from Entering: the entered facts are recorded', () => {
    const cand = candidate();
    expect(ENTERING.startedAt).toBeNull();
    expect(ENTERING.executionHistory).toBeUndefined();

    const result = ok(transitionRun(runStateOf(ENTERING), recUnknown({ turn: ENTERED_TURN, autoCleanup: cand }), ctxAuto()));
    expect(result.next.node).toBe('Ended');
    const record = result.next.record!;
    expect(record.outcome).toBe('crashed');
    expect(record.startedAt).toBe(T_ENTER);
    expect(record.executionHistory).toEqual({ schemaVersion: 1, sessionRef, kernel, startPosition: 3,
      observedThroughPosition: 5, endPosition: null });
    expect(record.terminalPayload).toMatchObject({ kind: 'crashed' });
    expect(record.reconciliation?.observation).toMatchObject({ kind: 'takeover_unresolved', unresolvedToolCallIds: ['call-1'],
      proof: PROOF, reviewRef });
    expect(reviewEffectOf(result.effects).origin).toEqual({ kind: 'takeover_unresolved', hostInstanceId: 'host-1', proof: PROOF });
  });

  it('K3-30 RUN-25 without a lease: no release_lease effect', () => {
    const result = ok(transitionRun(runStateOf(RUNNING), recUnknown(), ctxAuto({ lease: 'released' })));
    expect(result.effects).not.toContainEqual({ kind: 'release_lease' });
    expect(reviewEffectOf(result.effects).ref).toEqual(reviewRef);
  });

  // ---------------------------------------------------------------------- //
  // Guard failures: the first failing L25 WorkGraph guard wins              //
  // ---------------------------------------------------------------------- //

  type GuardCase = {
    name: string; run: RunSnapshot; ctx: RunGuardContext;
    autoCleanup: NonNullable<ReconcileUnknown['autoCleanup']>; blockedBy: string;
  };
  const withPurpose: RunSnapshot = { ...RUNNING, purpose: { kind: 'unknown_call_review', reviewRef, phase: 'review', round: 1 } };
  const guardCases: GuardCase[] = [
    { name: 'G10 review_round (defensive candidate on a review Run)', run: withPurpose, ctx: ctxAuto(),
      autoCleanup: candidate(), blockedBy: 'review_round' },
    { name: 'G1 no_takeover_proof (missing)', run: RUNNING, ctx: ctxAutoWithout('takeoverProof'),
      autoCleanup: candidate(), blockedBy: 'no_takeover_proof' },
    { name: 'G1 no_takeover_proof (null)', run: RUNNING, ctx: ctxAuto({ takeoverProof: null }),
      autoCleanup: candidate(), blockedBy: 'no_takeover_proof' },
    { name: 'G1 no_takeover_proof (memory_store)', run: RUNNING,
      ctx: ctxAuto({ takeoverProof: { kind: 'memory_store' } }), autoCleanup: candidate(), blockedBy: 'no_takeover_proof' },
    { name: 'G1 no_takeover_proof (different from candidate.proof)', run: RUNNING,
      ctx: ctxAuto({ takeoverProof: { kind: 'hl03_stale_lock', previousInstanceId: 'old', previousPid: 111 } }),
      autoCleanup: candidate(), blockedBy: 'no_takeover_proof' },
    { name: 'G3 uncontained_tool (out of table)', run: RUNNING, ctx: ctxAuto(),
      autoCleanup: candidate({ unresolvedCalls: [{ callId: 'call-1', toolName: 'mystery_tool' }] }), blockedBy: 'uncontained_tool' },
    { name: 'G4 stop_pending (paused pointer)', run: { ...RUNNING, controlState: pointer('paused') }, ctx: ctxAuto(),
      autoCleanup: candidate(), blockedBy: 'stop_pending' },
    { name: 'G4 stop_pending (cancelled pointer)', run: { ...RUNNING, controlState: pointer('cancelled') }, ctx: ctxAuto(),
      autoCleanup: candidate(), blockedBy: 'stop_pending' },
    { name: 'G4 stop_pending (steered pointer)', run: { ...RUNNING, controlState: pointer('steered') }, ctx: ctxAuto(),
      autoCleanup: candidate(), blockedBy: 'stop_pending' },
    { name: 'G5 inputs_unconfirmed (false)', run: RUNNING, ctx: ctxAuto({ inputsConfirmed: false }),
      autoCleanup: candidate(), blockedBy: 'inputs_unconfirmed' },
    { name: 'G5 inputs_unconfirmed (null)', run: RUNNING, ctx: ctxAuto({ inputsConfirmed: null }),
      autoCleanup: candidate(), blockedBy: 'inputs_unconfirmed' },
    { name: 'G7 session_not_closable (false)', run: RUNNING, ctx: ctxAuto({ sessionClosable: false }),
      autoCleanup: candidate(), blockedBy: 'session_not_closable' },
    { name: 'G7 session_not_closable (undefined)', run: RUNNING, ctx: ctxAutoWithout('sessionClosable'),
      autoCleanup: candidate(), blockedBy: 'session_not_closable' },
    { name: 'G9 second_auto_cleanup (true)', run: RUNNING, ctx: ctxAuto({ priorAutoCleanup: true }),
      autoCleanup: candidate(), blockedBy: 'second_auto_cleanup' },
    { name: 'G9 second_auto_cleanup (undefined)', run: RUNNING, ctx: ctxAutoWithout('priorAutoCleanup'),
      autoCleanup: candidate(), blockedBy: 'second_auto_cleanup' },
    { name: 'G11 inventory_incomplete (too_many_calls)', run: RUNNING, ctx: ctxAuto(),
      autoCleanup: candidate({ draft: { ...DRAFT, inventory: 'incomplete', inventoryProblem: 'too_many_calls' } }),
      blockedBy: 'inventory_incomplete' },
  ];

  for (const guardCase of guardCases) {
    it(`K3-30 ${guardCase.name} -> RUN-20(i) autoCleanupBlockedBy ${guardCase.blockedBy}`, () => {
      const result = ok(transitionRun(runStateOf(guardCase.run),
        recUnknown({ autoCleanup: guardCase.autoCleanup }), guardCase.ctx));
      expect(result.next.node).toBe('EndedUnknown');
      expect(result.next.record?.outcome).toBe('outcome_unknown');
      expect(result.effects.some((effect) => effect.kind === 'create_review_record')).toBe(false);
      expect(observationOf(result)).toMatchObject({ kind: 'unresolved', autoCleanupBlockedBy: guardCase.blockedBy });
    });
  }

  it('K3-30 a classifier-supplied { blockedBy } is recorded verbatim', () => {
    const result = ok(transitionRun(runStateOf(RUNNING), recUnknown({ autoCleanup: { blockedBy: 'no_baseline' } }), ctxAuto()));
    expect(result.next.node).toBe('EndedUnknown');
    expect(result.effects.some((effect) => effect.kind === 'create_review_record')).toBe(false);
    expect(observationOf(result)).toMatchObject({ kind: 'unresolved', autoCleanupBlockedBy: 'no_baseline' });
  });

  it('K3-30 no autoCleanup at all: the unresolved observation has no autoCleanupBlockedBy property', () => {
    const event = recUnknown();
    delete (event as { autoCleanup?: unknown }).autoCleanup;
    const result = ok(transitionRun(runStateOf(RUNNING), event, ctxAuto()));
    expect(result.next.node).toBe('EndedUnknown');
    const observation = observationOf(result);
    expect(observation).toMatchObject({ kind: 'unresolved', reason: 'tool_calls_unresolved', unresolvedToolCallIds: ['call-1'] });
    expect(observation).not.toHaveProperty('autoCleanupBlockedBy');
  });

  it('K3-30 too_large is not a blockedBy: an incomplete/too_large draft still goes RUN-25', () => {
    const cand = candidate({ draft: { ...DRAFT, inventory: 'incomplete', inventoryProblem: 'too_large' } });
    const result = ok(transitionRun(runStateOf(RUNNING), recUnknown({ autoCleanup: cand }), ctxAuto()));
    expect(result.next.node).toBe('Ended');
    expect(result.next.record?.outcome).toBe('crashed');
    expect(result.next.record?.reconciliation?.observation).toMatchObject({ kind: 'takeover_unresolved' });
    const review = reviewEffectOf(result.effects);
    expect(review.inventory).toBe('incomplete');
    expect(review.inventoryProblem).toBe('too_large');
  });

  // U2 (SES-06 from RUN-25): the takeover closure releases the Session under the
  // new `reconcile_takeover_unresolved` cause, keeping the open Kernel Turn.
  it('K3-30 RUN-25 releases the Session exactly as SES-06 reconcile_takeover_unresolved does', () => {
    const session: SessionMachineState = {
      lifecycle: 'active', health: 'available', healthConclusion: null, revision: 9,
      occupancy: { kind: 'execution', holder: claim.runRef, generation: GEN },
    };
    const holder: SessionHolderContext = {
      ref: claim.runRef, claimGeneration: GEN, before: 'run_running', after: 'run_ended',
      kernelTurnSeen: true, inputsConfirmed: true, historyBoundaryCursor: null, kernelTurnOpen: true,
    };
    const sessionCtx: SessionGuardContext = {
      caller: 'reconcile', hostLease: 'owned', pin: null, holder, probe: 'ready', kernelHeader: null,
      openResponsibleLink: null, creation: null, link: null,
    };
    const expectedRelease = { kind: 'release_session', holder: claim.runRef, generation: GEN,
      historyCursor: { kind: 'keep' as const }, kernelTurnOpen: true };

    expect(transitionSession(session,
      { kind: 'occupancy_released', cause: 'reconcile_takeover_unresolved' }, sessionCtx)).toEqual({
      ok: true,
      next: { ...session, health: 'unavailable', healthConclusion: 'kernel_turn_open', occupancy: null, revision: 10 },
      effects: [expectedRelease],
    });

    const result = ok(transitionRun(runStateOf(RUNNING), recUnknown({ autoCleanup: candidate() }), ctxAuto()));
    expect(result.effects.find((effect) => effect.kind === 'release_session')).toEqual(expectedRelease);
  });

  it('K3-30 RUN-25 pairs the queued steer intent effect with the terminal record', () => {
    const steer = intentRef('i-steer');
    const result = ok(transitionRun(runStateOf(RUNNING), recUnknown({ autoCleanup: candidate() }),
      ctxAuto({ queuedSteers: [steer] })));
    expect(result.next.node).toBe('Ended');
    expect(result.effects).toContainEqual({ kind: 'intent', event: 'control_reconciled', intentRef: steer });
  });

  it('K3-30 reports the first failing L25 guard in the spec order, not the last', () => {
    // G1 no_takeover_proof is checked before G3 uncontained_tool and G4 stop_pending.
    const first = ok(transitionRun(runStateOf({ ...RUNNING, controlState: pointer('paused') }),
      recUnknown({ autoCleanup: candidate({ unresolvedCalls: [{ callId: 'call-1', toolName: 'mystery_tool' }] }) }),
      ctxAutoWithout('takeoverProof')));
    expect(observationOf(first)).toMatchObject({ kind: 'unresolved', autoCleanupBlockedBy: 'no_takeover_proof' });

    // G4 stop_pending is checked before G5/G7/G9/G11.
    const second = ok(transitionRun(runStateOf({ ...RUNNING, controlState: pointer('paused') }),
      recUnknown({ autoCleanup: candidate({ draft: { ...DRAFT, inventory: 'incomplete', inventoryProblem: 'too_many_calls' } }) }),
      ctxAuto({ sessionClosable: false, priorAutoCleanup: true })));
    expect(observationOf(second)).toMatchObject({ kind: 'unresolved', autoCleanupBlockedBy: 'stop_pending' });
  });
});
