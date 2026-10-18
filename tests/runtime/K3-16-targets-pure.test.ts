/**
 * K3-16 pure creation targets (finding F-059, D7/L9): `newUnknownCallReview`
 * derives `dispositionTargets` and `proposalTargets` from the items it is given.
 *
 * The constructor's input type has no target fields, so the expected sets here
 * cannot be handed to the machine as input: the test builds two process items
 * plus one undetermined platform item, calls the pure constructor, and asserts
 * the OUTPUT arrays (count, platform inclusion/exclusion, alias order and the
 * retained `kind`) from a hand-computed example. No store, Host, Workflow or
 * Runtime is imported; no record is committed.
 */
import { describe, expect, it } from 'vitest';
import type {
  UnknownCallObservationV1, UnknownCallReviewItemV1, UnknownCallReviewV1,
} from '../../src/contracts/unknown-call-review.js';
import {
  newUnknownCallReview, type NewUnknownCallReviewInputV1,
} from '../../src/core/work-graph/state/unknown-call-review.js';

const PROJECT = 'P';
const GOAL = 'g1';
const WORKSPACE = 'W';
const TASK = 't1';
const AT = '2026-10-17T00:00:00.000Z';
const RUN_REF = { aggregateType: 'Run' as const, projectId: PROJECT, goalId: GOAL, runId: 'run-1234abcd' };

function processItem(alias: number, command: string): UnknownCallReviewItemV1 {
  return {
    alias, callId: `call-${String(alias)}`, toolName: 'shell', kind: 'process', contained: true,
    kernel: {
      adapterId: 'a', kernelSessionId: 'ks', kernelRunId: 'kr', turnId: 'turn-1',
      callId: `call-${String(alias)}`, declaredPosition: alias, startedPosition: alias,
    },
    argumentsDigest: 'd'.repeat(64),
    summary: { command, cwd: null, mode: null, paths: [], pathsOmitted: 0, truncated: false },
    startedAt: null, observed: { verdict: 'pending', by: null },
  };
}

function platformItem(alias: number): UnknownCallReviewItemV1 {
  const observed: UnknownCallObservationV1 = {
    verdict: 'undetermined', by: 'platform',
    evidence: { kind: 'lookup_failed', reason: 'the platform lookup could not read the receipt' },
  };
  return {
    alias, callId: `platform-${String(alias)}`, toolName: 'send_user_message', kind: 'platform', contained: true,
    kernel: {
      adapterId: 'a', kernelSessionId: 'ks', kernelRunId: 'kr', turnId: 'turn-1',
      callId: `platform-${String(alias)}`, declaredPosition: alias, startedPosition: alias,
    },
    argumentsDigest: 'e'.repeat(64),
    summary: { command: null, cwd: null, mode: null, paths: [], pathsOmitted: 0, truncated: false },
    startedAt: null, observed,
  };
}

function creationInput(items: UnknownCallReviewItemV1[]): NewUnknownCallReviewInputV1 {
  return {
    ref: { aggregateType: 'UnknownCallReview', projectId: PROJECT, goalId: GOAL, runId: RUN_REF.runId },
    workspaceId: WORKSPACE, task: { projectId: PROJECT, goalId: GOAL, taskId: TASK }, runRef: RUN_REF,
    sessionRef: { projectId: PROJECT, sessionId: 's' },
    origin: { kind: 'human_attested', attestedBy: { kind: 'human', id: 'operator' }, reason: 'k3-16 targets' },
    inventory: 'complete', inventoryProblem: null, items, itemsOmitted: 0,
    workspace: {
      status: 'unavailable', runBaselineKnown: false, reason: 'not_configured',
      detail: 'the pure K3-16 targets test',
    },
    streak: { priorAutoCleanup: false, priorUnknownProcess: false, resetRunRef: null },
    createdAt: AT,
  };
}

function built(input: NewUnknownCallReviewInputV1): UnknownCallReviewV1 {
  const transition = newUnknownCallReview(input);
  if (!transition.ok) throw new Error(JSON.stringify(transition));
  return transition.next;
}

describe('K3-16 creation targets (F-059, D7)', () => {
  it('K3-16: two process items plus one undetermined platform item derive 3 disposition and 2 proposal targets', () => {
    const input = creationInput([
      processItem(1, 'npm run build\nnpm run test'),
      processItem(2, 'pnpm db:migrate'),
      platformItem(3),
    ]);
    // The machine's input carries no target fields at all: the sets below are
    // OUTPUT, never a hand-filled expected target set.
    expect('dispositionTargets' in input).toBe(false);
    expect('proposalTargets' in input).toBe(false);

    const record = built(input);

    // Hand-computed: call-1 + call-2 + platform-3 are disposition targets; only
    // the two process items are proposal targets.
    expect(record.dispositionTargets).toEqual(['call-1', 'call-2', 'platform-3']);
    expect(record.proposalTargets).toEqual(['call-1', 'call-2']);
    expect(record.dispositionTargets).toHaveLength(3);
    expect(record.proposalTargets).toHaveLength(2);

    // The undetermined platform entry is included for disposition but excluded
    // from proposals; the item kinds in Kernel order are retained unchanged.
    expect(record.dispositionTargets).toContain('platform-3');
    expect(record.proposalTargets).not.toContain('platform-3');
    expect(record.items.map(item => item.kind)).toEqual(['process', 'process', 'platform']);
    expect(record.items.map(item => item.alias)).toEqual([1, 2, 3]);
    expect(record.items.map(item => item.callId)).toEqual(['call-1', 'call-2', 'platform-3']);
  });

  it('K3-16: a platform entry that is already decided is in neither target set', () => {
    const decided: UnknownCallObservationV1 = { verdict: 'done', by: 'platform', evidence: { kind: 'not_committed' } };
    const platform: UnknownCallReviewItemV1 = {
      ...platformItem(2), callId: 'platform-2',
      kernel: { ...platformItem(2).kernel, callId: 'platform-2' },
      observed: decided,
    };
    const record = built(creationInput([processItem(1, 'echo 1'), platform]));

    // The decided platform item stays a platform item but is neither a
    // disposition target nor a proposal target; only the process call remains.
    expect(record.items.map(item => item.kind)).toEqual(['process', 'platform']);
    expect(record.dispositionTargets).toEqual(['call-1']);
    expect(record.proposalTargets).toEqual(['call-1']);
  });
});
