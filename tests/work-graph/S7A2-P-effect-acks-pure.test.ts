/**
 * P-effect-acks: the requeue and reverified event decoders keep an optional
 * `acknowledgement` (7A §3.5). Pure row (rule A5): every value is constructed
 * here and the literals follow `A2-step1-codecs.test.ts`; no store, platform,
 * Host, Workflow, Runtime or fixture is imported (D3).
 *
 * The requeue case was red first: before its key list names the key, the
 * decoder refuses a legal one with "TaskRequeued carries unknown fields", and
 * the store runs this decoder at commit time. The reverified case is a
 * regression row: that decoder already kept the whole body, so the key passes
 * before the reverified arm's stored-key check.
 */
import { describe, expect, it } from 'vitest';
import type { ActorRef } from '../../src/contracts/command-event.js';
import type { ControlIntentRef } from '../../src/contracts/control-intent.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { RunRef, TaskAttemptRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type { NoProgressKeyV1 } from '../../src/contracts/no-progress.js';
import type { PlanRevisionRef } from '../../src/contracts/plan.js';
import type { TaskRequeueRef, TaskRequeueSnapshotV1 } from '../../src/contracts/task-requeue.js';
import type {
  ReverifyBasisV1, RoundChainV1, RoundSnapshot, VerificationRoundRef,
} from '../../src/contracts/verification.js';
import {
  encodeTaskRequeuedEvent, taskRequeuedEventFromEvent,
} from '../../src/core/work-graph/tasks/claim-record-codecs.js';
import {
  encodeVerificationRoundEvent, verificationRoundEventFromEvent,
} from '../../src/core/work-graph/persistence/evidence-record-codecs.js';

const at = '2026-10-03T00:00:00.000Z';
const P = 'p-pure-project', W = 'p-pure-workspace', G = 'p-pure-goal', T = 'p-pure-task';
const task: TaskTriple = { projectId: P, goalId: G, taskId: T };
const planRef: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: P, planId: 'plan-1' };
const runRef = (runId: string): RunRef => ({ aggregateType: 'Run', projectId: P, goalId: G, runId });
const attemptRef = (attemptId: string): TaskAttemptRef => ({ aggregateType: 'TaskAttempt', projectId: P, goalId: G, taskId: T, attemptId });
const roundRef = (roundId: string): VerificationRoundRef =>
  ({ aggregateType: 'VerificationRound', projectId: P, workspaceId: W, goalId: G, taskId: T, runId: 'run-1', roundId });
const intentRef: ControlIntentRef = { aggregateType: 'ControlIntent', projectId: P, workspaceId: W, intentId: 'intent-3' };
const requeueRef: TaskRequeueRef = { aggregateType: 'TaskRequeue', projectId: P, goalId: G, taskId: T, afterRunId: 'run-3' };
const operator: Extract<ActorRef, { kind: 'human' | 'system' }> = { kind: 'system', id: 'local-host' };
const agent: ActorRef = { kind: 'agent', id: 'worker-agent', runRef: runRef('run-1') };
const acknowledgement: SessionMessageRef = { aggregateType: 'SessionMessage', projectId: P, workspaceId: W, messageId: 'message-1' };

/** A Goal-resume continuation after a restart: no round, nothing superseded (the sample test's literal). */
function resumeRequeue(): TaskRequeueSnapshotV1 {
  const basis: NoProgressKeyV1 = { taskRef: task, actionKind: 'requeue',
    failure: { outcome: 'crashed', origin: 'host_interrupted', exhaustedTokenBudget: null, checks: [], gapCodes: [] },
    source: { workspaceRevision: 4, sourceDigest: '5'.repeat(64) }, plan: planRef, newInputDigest: null, digest: 'd'.repeat(64) };
  return { ref: requeueRef, revision: 1, schemaVersion: 1, task, planRef, afterRunRef: runRef('run-3'),
    afterAttemptRef: attemptRef('attempt-3'), afterOutcome: 'crashed', afterRoundRef: null, failureClass: 'interrupted',
    interruption: 'paused', stopIntentRef: intentRef, stopRequester: 'goal_fan_out',
    trigger: { kind: 'goal_resume', goalRef: { aggregateType: 'Goal', projectId: P, goalId: G }, resumedEpoch: 3, pausedEpoch: 2 },
    basis, basisComparison: 'skipped_interrupted', supersededEvidenceIds: [], newInputRefs: [],
    budget: { tokenBudget: 2000, deadline: null }, reason: 'goal resumed', requestedBy: { kind: 'system', id: 'host:goal-fan-out' },
    requestedAt: at, agentProvenance: null, automation: { automatic: true, counted: false, autoCount: 0, cap: 3 },
    historySource: { sessionRef: { projectId: P, sessionId: 'session-3' }, adapterId: 'coding-agent',
      kernelSessionId: 'kernel-session-3', throughPosition: null } };
}

/** The Agent-requested successor (chain ordinal 2) of the root round (the sample test's literal). */
function successorRound(): RoundSnapshot {
  const reverifyBasis: ReverifyBasisV1 = { subject: task, subjectRunId: 'run-1', actionKind: 'reverify',
    failure: { checks: [{ checkId: 'unit', phase: 'interrupted', outcome: null, cause: null }], gapCodes: ['interrupted_check'] },
    source: { workspaceRevision: 4, sourceDigest: '6'.repeat(64) },
    configuration: { configurationRevision: 'checks-config-1', configurationDigest: '7'.repeat(64) },
    verificationInputs: { basisPlanRef: planRef,
      completionPolicyPin: { ref: { aggregateType: 'CompletionPolicyRevision', projectId: P, policyId: 'policy-1', revision: 1 }, digest: 'e'.repeat(64) },
      architectureBaselinePin: { ref: { aggregateType: 'ArchitectureBaselineRevision', projectId: P, baselineId: 'baseline-1', revision: 1 }, digest: 'f'.repeat(64) } },
    newInputDigest: null, digest: '9'.repeat(64) };
  const chain: RoundChainV1 = { schemaVersion: 1, ordinal: 2, predecessorRoundRef: roundRef('round-1'),
    predecessorRevision: 3, supersededEvidenceIds: ['evidence-1'], basisDigests: ['9'.repeat(64)], autoCount: 1,
    reverify: { requestedBy: agent, actorClass: 'agent', failureClass: 'check_incomplete', requestedAt: at,
      basis: reverifyBasis, exemption: 'host_interruption', sourceChanged: false, newInputRefs: [], reason: null } };
  return { ref: roundRef('round-2'), revision: 1, schemaVersion: 1, subject: task, subjectRunRef: runRef('run-1'),
    adoptedPlanRef: planRef, taskBasisRef: planRef, executor: operator,
    configuration: { configurationRevision: 'checks-config-1', workspace: { aggregateType: 'Workspace', projectId: P, workspaceId: W },
      executor: operator, permissionRevision: 'perm-1', sourceAccess: 'verification_workspace', processAccess: 'all_except_denied',
      deniedPrefixes: [], checks: [] },
    configurationDigest: '7'.repeat(64),
    // Opaque to the round codec; the open path pins them.
    identity: { schemaVersion: 1, sourceDigest: '5'.repeat(64) } as unknown as RoundSnapshot['identity'],
    sourceProof: { kind: 'current-workspace-only', runBaselineKnown: false },
    verificationPlan: { schemaVersion: 1, planId: '8'.repeat(64) } as unknown as RoundSnapshot['verificationPlan'],
    checks: [], status: 'open', outcome: null, gaps: [], evidenceRefs: [], chain };
}

describe('the effect decoders keep an acknowledgement (7A §3.5)', () => {
  it.each([['with acknowledgement', acknowledgement], ['without acknowledgement', undefined]])(
    'TaskRequeued %s', (_label, ack) => {
      const requeue = resumeRequeue();
      const encoded = encodeTaskRequeuedEvent({ eventId: 'ev-requeue-1', eventType: 'TaskRequeued', schemaVersion: 1,
        occurredAt: at, identityKey: 'identity-1', actor: requeue.requestedBy, fingerprint: 'fp-1', requeue,
        ...(ack === undefined ? {} : { acknowledgement: ack }) });
      const decoded = taskRequeuedEventFromEvent(encoded);
      if (decoded.status !== 'decoded') throw new Error(`expected decoded, got invalid: ${decoded.reason}`);
      expect(decoded.value).toEqual({ eventId: 'ev-requeue-1', eventType: 'TaskRequeued', schemaVersion: 1,
        occurredAt: at, identityKey: 'identity-1', actor: requeue.requestedBy, fingerprint: 'fp-1', requeue,
        ...(ack === undefined ? {} : { acknowledgement: ack }) });
      expect('acknowledgement' in decoded.value).toBe(ack !== undefined);
    });

  it.each([['with acknowledgement', acknowledgement], ['without acknowledgement', undefined]])(
    'VerificationRoundReverified %s', (_label, ack) => {
      const round = successorRound();
      const encoded = encodeVerificationRoundEvent({ eventId: 'ev-reverify-1', eventType: 'VerificationRoundReverified',
        schemaVersion: 1, occurredAt: at, identityKey: 'identity-2', roundRef: round.ref, actor: operator,
        fingerprint: 'fp-2', result: round, ...(ack === undefined ? {} : { acknowledgement: ack }) });
      const decoded = verificationRoundEventFromEvent(encoded);
      if (decoded.status !== 'decoded') throw new Error(`expected decoded, got invalid: ${decoded.reason}`);
      expect(decoded.value).toEqual({ eventId: 'ev-reverify-1', eventType: 'VerificationRoundReverified',
        schemaVersion: 1, occurredAt: at, identityKey: 'identity-2', roundRef: round.ref, actor: operator,
        fingerprint: 'fp-2', result: round, ...(ack === undefined ? {} : { acknowledgement: ack }) });
      expect('acknowledgement' in decoded.value).toBe(ack !== undefined);
    });
});
