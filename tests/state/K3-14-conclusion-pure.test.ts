/**
 * K3-14 (T1-018, UCR-04): the recordConclusion state machine refuses a
 * non-process alias. The scenario row cannot produce a record mixing process
 * and read-only items through public steps, so this input -> output branch is
 * checked here against the pure transition, with no store, platform or port.
 *
 * Spec L14: the tool records a conclusion for a `process` call; any other item
 * kind is `invalid` and writes nothing.
 */
import { describe, expect, it } from 'vitest';
import type { ActorRef } from '../../src/contracts/command-event.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { UnknownCallReviewItemV1, UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import {
  transitionUnknownCallReview,
  type UnknownCallReviewContextV1,
} from '../../src/core/work-graph/state/unknown-call-review.js';

const P = 'p1';
const G = 'g1';
const W = 'w1';
const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-01-02T00:00:00.000Z';

const run = (runId: string): RunRef => ({ aggregateType: 'Run', projectId: P, goalId: G, runId });
const human: ActorRef = { kind: 'human', id: 'u1' };

function processItem(alias: number): UnknownCallReviewItemV1 {
  const callId = `call-${String(alias)}`;
  return {
    alias, callId, toolName: 'shell', kind: 'process', contained: true,
    kernel: { adapterId: 'a', kernelSessionId: 'ks', kernelRunId: 'kr', turnId: 't',
      callId, declaredPosition: alias, startedPosition: alias },
    argumentsDigest: 'd'.repeat(64),
    summary: { command: 'echo hi', cwd: null, mode: null, paths: [], pathsOmitted: 0, truncated: false },
    startedAt: null, observed: { verdict: 'pending', by: null },
  };
}

function readOnlyItem(alias: number): UnknownCallReviewItemV1 {
  return { ...processItem(alias), toolName: 'read', kind: 'read_only' };
}

function baseReview(items: UnknownCallReviewItemV1[]): UnknownCallReviewV1 {
  const origin = run('origin');
  return {
    ref: { aggregateType: 'UnknownCallReview', projectId: P, goalId: G, runId: 'origin' },
    schemaVersion: 1, revision: 2, workspaceId: W,
    task: { projectId: P, goalId: G, taskId: 't1' },
    runRef: origin,
    sessionRef: { projectId: P, sessionId: 's1' },
    origin: { kind: 'human_attested', attestedBy: human, reason: 'attested' },
    inventory: 'complete', inventoryProblem: null, items, itemsOmitted: 0,
    workspace: { status: 'unavailable', runBaselineKnown: false, reason: 'not_git', detail: 'd' },
    streak: { priorAutoCleanup: false, priorUnknownProcess: false, resetRunRef: null },
    status: 'pending_review', open: 'yes', decisionReasons: [],
    dispositionTargets: null, proposalTargets: null, stateEntry: 1,
    activeRound: { runRef: run('round'), phase: 'review', round: 1, stateEntry: 1, startedRevision: 1 },
    rounds: [], proposals: [], blockedCommands: [], disposition: null,
    createdAt: T0, updatedAt: T0,
  };
}

function context(): UnknownCallReviewContextV1 {
  return {
    expectedRevision: 2, updatedAt: T1, actor: human,
    activeRunEnded: false, activeRunCompleted: false, fenceHumanOnly: false,
    reviewUnavailable: false, autonomy: 'after_plan_confirmation',
    incompleteCommandAliases: [], missingSelfCheckAliases: [], originalRunSelected: false,
  };
}

describe('K3-14 conclusion: non-process alias', () => {
  it('K3-14 UCR-04 refuses item #2 because it is read_only, not process', () => {
    const current = baseReview([processItem(1), readOnlyItem(2)]);
    const result = transitionUnknownCallReview(current, {
      kind: 'conclusion_recorded', alias: 2, verdict: 'done', evidence: 'x',
      roundRunRef: run('round'), crashSuspicion: { verdict: 'unlikely', evidence: 'no crash' },
    }, context());
    expect(result).toMatchObject({ ok: false, reason: 'illegal', code: 'invalid' });
  });
});
