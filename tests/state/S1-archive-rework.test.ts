/**
 * Slice 1 §3.5 `state/task-failure.ts` (spec §5.2 UT32–UT35): the fourth
 * `archive` argument of `deriveReworkClass` and the automatic-count rule. A
 * verified archive interruption maps the stopped Run to `interrupted/
 * executing`; it never overrides FC-1/FC-2 or an earlier paused fence, and a
 * forged/unmatched archive never exempts an ordinary failure.
 *
 * Pure: no RecordStore, no Kernel, no clock.
 */
import { describe, expect, it } from 'vitest';
import type { ActorRef } from '../../src/contracts/command-event.js';
import type { ControlIntentKindV1, ControlIntentSnapshotV1 } from '../../src/contracts/control-intent.js';
import type {
  RoleBindingRefV1, RunOutcome, RunReconciliationV1, RunRef, RunSnapshot, RuntimeEventV1, TaskTriple,
} from '../../src/contracts/dispatch.js';
import type { PlanRevisionRef } from '../../src/contracts/plan.js';
import type { SessionAnomalyAnchorRef } from '../../src/contracts/session-anomaly.js';
import type { TaskAutomationPolicyV1, TaskRequeueRef } from '../../src/contracts/task-requeue.js';
import {
  deriveReworkClass, nextRequeueAutoCount, reworkFenceOf, reworkPermission,
  type VerifiedArchiveInterruptionV1,
} from '../../src/core/work-graph/state/task-failure.js';
import type { RoundChainHeadV1 } from '../../src/core/work-graph/state/verification-machine.js';

// --------------------------------------------------------------------------
// Fixtures (spec §5.1: project p, workspace w, task A, Run r0)
// --------------------------------------------------------------------------

const P = 'p';
const G = 'g';
const W = 'w';
const T = 'A';
const T0 = '2026-10-08T00:00:00.000Z';

const TASK: TaskTriple = { projectId: P, goalId: G, taskId: T };
const PLAN: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: P, planId: 'plan-1' };
const ROLE: RoleBindingRefV1 = {
  schemaVersion: 1, bindingId: 'binding-1', templateId: 'worker', templateRevision: 'r1', bindingVersion: 1, policyRevision: 'policy-1',
};
type HostActor = Extract<ActorRef, { kind: 'human' | 'system' }>;
const HUMAN: HostActor = { kind: 'human', id: 'operator-1' };
const NO_CHAIN: RoundChainHeadV1 = { kind: 'none' };

const runRef = (runId: string): RunRef => ({ aggregateType: 'Run', projectId: P, goalId: G, runId });

function runOf(runId: string, over: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    ref: runRef(runId), revision: 4, schemaVersion: 1, task: { ...TASK }, attemptId: `${runId}-attempt`, planRef: PLAN,
    roleBinding: ROLE, budget: { tokenBudget: 1000, deadline: null }, workspaceSnapshot: { workspaceId: W, revision: 1 },
    status: 'ended', outcome: 'completed', exitCode: 0, lastEventSeq: 2, lastRuntimeEventId: `rt-${runId}`,
    lastFactEventId: `ev-${runId}`, envelope: null, startedAt: T0, endedAt: T0, previousRun: null, ...over,
  };
}
const ended = (runId: string, outcome: RunOutcome, over: Partial<RunSnapshot> = {}): RunSnapshot =>
  runOf(runId, { outcome, exitCode: outcome === 'completed' ? 0 : null, ...over });

function intentOf(intentId: string, kind: ControlIntentKindV1, requestedBy: HostActor, runId = 'r0'): ControlIntentSnapshotV1 {
  const desiredState = kind === 'pause' ? 'paused' : kind === 'cancel' ? 'cancelled' : kind === 'resume' ? 'running' : 'steered';
  return {
    schemaVersion: 1, ref: { aggregateType: 'ControlIntent', projectId: P, workspaceId: W, intentId },
    runRef: runRef(runId), kind, desiredState, reason: null, requestedAt: T0, requestedBy, revision: 1, status: 'queued',
  };
}
const pointing = (intent: ControlIntentSnapshotV1): Pick<RunSnapshot, 'controlState'> =>
  ({ controlState: { intentRef: intent.ref, desiredState: intent.desiredState } });

const runtimeEvent = (runId: string, payload: RuntimeEventV1['payload']): RuntimeEventV1 => ({
  eventType: payload.kind === 'crashed' ? 'run_crashed' : payload.kind === 'cancelled' ? 'run_cancelled' : 'run_completed',
  schemaVersion: 1, eventId: `rt-${runId}-end`, runRef: runRef(runId), sequence: 7, occurredAt: T0, payload,
});
const reconciliation = (observation: RunReconciliationV1['observation'], status: RunReconciliationV1['status'] = 'done'): RunReconciliationV1 =>
  ({ status, observation, basis: { kind: 'live_clean' }, recordedAt: T0 });

/** RUN-19/24: a Host-interrupted `crashed` Run; `pause` non-null is paused-interrupted (FC-6). */
function hostInterrupted(runId: string, pause: ControlIntentSnapshotV1 | null): RunSnapshot {
  return ended(runId, 'crashed', {
    ...(pause === null ? {} : pointing(pause)),
    reconciliation: reconciliation({
      kind: 'interrupted_clean', event: runtimeEvent(runId, { kind: 'crashed', error: 'host_interrupted' }),
      lastPosition: 4, kernelPaused: pause !== null, pausedIntentRef: pause === null ? null : pause.ref,
    }),
    terminalPayload: { kind: 'crashed', error: 'host_interrupted' },
  });
}

const ANCHOR_REF: SessionAnomalyAnchorRef = { aggregateType: 'SessionAnomalyAnchor', projectId: P, goalId: G, runId: 'r0' };
const archiveOf = (run: RunRef, cause: 'archive_cancel' | 'retired_interruption'): VerifiedArchiveInterruptionV1 =>
  ({ kind: 'execution', anchorRef: { ...ANCHOR_REF, runId: run.runId }, runRef: run, cause });

type ChainRun = Pick<RunSnapshot, 'ref' | 'requeueRef' | 'previousRun'>;
const requeueRefOf = (afterRunId: string): TaskRequeueRef =>
  ({ aggregateType: 'TaskRequeue', projectId: P, goalId: G, taskId: T, afterRunId });
/** The afterRun's chain names one prior requeue whose `autoCount` is the prior count. */
function priorChain(prior: number): { afterRun: ChainRun; runs: ChainRun[]; requeues: readonly { ref: TaskRequeueRef; automation: { automatic: boolean; counted: boolean; autoCount: number; cap: number | null } }[] } {
  const ref = requeueRefOf('r-prior');
  const afterRun: ChainRun = { ref: runRef('r0'), requeueRef: ref, previousRun: null };
  return {
    afterRun,
    runs: [afterRun],
    requeues: [{ ref, automation: { automatic: true, counted: false, autoCount: prior, cap: 3 } }],
  };
}
const POLICY: Pick<TaskAutomationPolicyV1, 'autoReworkLimit'> = { autoReworkLimit: 3 };

// --------------------------------------------------------------------------
// UT32–UT35
// --------------------------------------------------------------------------

describe('deriveReworkClass archive interruption + nextRequeueAutoCount (S1-TASK-01, §5.2 UT32–UT35)', () => {
  it('UT32 a human archive cancel derives interrupted and resets the automatic count', () => {
    const run = ended('r0', 'cancelled');
    const derivation = deriveReworkClass(run, null, NO_CHAIN, archiveOf(run.ref, 'archive_cancel'));
    expect(derivation).toMatchObject({
      row: 'S1-FC-ARCHIVE', kind: 'class', failureClass: 'interrupted', interruption: 'executing',
    });
    if (derivation.kind !== 'class') return;
    const prior = priorChain(2);
    const automation = nextRequeueAutoCount({
      actorClass: 'human', failureClass: derivation.failureClass, afterRun: prior.afterRun, runs: prior.runs,
      requeues: prior.requeues, policy: POLICY,
    });
    expect(automation).toEqual({ automatic: false, counted: false, autoCount: 0, cap: null });
  });

  it('UT33 an automatic retired interruption keeps the prior count within its cap', () => {
    const run = hostInterrupted('r0', null);
    const derivation = deriveReworkClass(run, null, NO_CHAIN, archiveOf(run.ref, 'retired_interruption'));
    expect(derivation).toMatchObject({ kind: 'class', failureClass: 'interrupted', interruption: 'executing' });
    if (derivation.kind !== 'class') return;
    const prior = priorChain(3);
    const automation = nextRequeueAutoCount({
      actorClass: 'system', failureClass: derivation.failureClass, afterRun: prior.afterRun, runs: prior.runs,
      requeues: prior.requeues, policy: POLICY,
    });
    expect(automation).toEqual({ automatic: true, counted: false, autoCount: 3, cap: 3 });
    // An interrupted (uncounted) requeue at the cap is not refused by G-CAP.
    expect(automation.counted && automation.cap !== null && automation.autoCount > automation.cap).toBe(false);
  });

  it('UT34 a forged archive origin does not exempt an ordinary run failure', () => {
    const cancel = intentOf('c-h', 'cancel', HUMAN);
    const run = ended('r0', 'failed', pointing(cancel));
    const derivation = deriveReworkClass(run, cancel, NO_CHAIN, archiveOf(run.ref, 'archive_cancel'));
    expect(derivation).toMatchObject({ row: 'FC-9', kind: 'class', failureClass: 'run_failed', interruption: null });
    if (derivation.kind !== 'class') throw new Error('UT34: the forged archive origin must not exempt an ordinary failure');
    const fence = reworkFenceOf(run, cancel);
    expect(fence).toBe('human_only');
    const refusal = reworkPermission({
      operation: 'requeue', goalDesiredState: 'active',
      failureClass: derivation.failureClass, interruption: derivation.interruption, fence,
      actorClass: 'system', goalFanOut: false, trigger: false, budget: false, note: false,
    });
    if (refusal === null || refusal.ok) throw new Error('UT34: the forged archive origin must not admit the automatic requeue');
    expect(refusal.code).toBe('forbidden');
    expect(refusal.reason).toBe('guard_failed');
  });

  it('UT35 an automatic retired interruption keeps the earlier human pause fence', () => {
    const pause = intentOf('p-h', 'pause', HUMAN);
    const run = hostInterrupted('r0', pause);
    const derivation = deriveReworkClass(run, pause, NO_CHAIN, archiveOf(run.ref, 'retired_interruption'));
    expect(derivation).toMatchObject({ kind: 'class', failureClass: 'interrupted', interruption: 'paused' });
    const fence = reworkFenceOf(run, pause);
    expect(fence).toBe('human_only');
    const refusal = reworkPermission({
      operation: 'requeue', goalDesiredState: 'active', failureClass: 'interrupted', interruption: 'paused', fence,
      actorClass: 'system', goalFanOut: false, trigger: false, budget: false, note: false,
    });
    if (refusal === null || refusal.ok) throw new Error('UT35: the earlier human pause fence must refuse the automatic requeue');
    expect(refusal.code).toBe('forbidden');
    expect(refusal.reason).toBe('guard_failed');
  });
});
