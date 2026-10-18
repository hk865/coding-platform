/**
 * K3-16 pure proposal storage order (finding F-061, UCR-05/L20): the
 * `proposal_recorded` transition keeps the saved `proposals` array in
 * alias-ascending order, whatever order the calls arrive in.
 *
 * The record is built by the pure creation and transition functions only (no
 * store, Host, Workflow or Runtime). Twelve proposals are saved in descending
 * alias order; the assertion is on `next.proposals` itself — the array the
 * owner writes — not on the item list, the count alone or a renderer's sort.
 */
import { describe, expect, it } from 'vitest';
import type {
  SaferMethodProposalV1, UnknownCallReviewItemV1, UnknownCallReviewV1,
} from '../../src/contracts/unknown-call-review.js';
import {
  newUnknownCallReview, transitionUnknownCallReview,
  type NewUnknownCallReviewInputV1, type UnknownCallReviewContextV1,
} from '../../src/core/work-graph/state/unknown-call-review.js';

const PROJECT = 'P';
const GOAL = 'g1';
const WORKSPACE = 'W';
const TASK = 't1';
const AT = '2026-10-17T00:00:00.000Z';
const ORIGIN_RUN = { aggregateType: 'Run' as const, projectId: PROJECT, goalId: GOAL, runId: 'run-origin-1' };
const PROPOSAL_RUN = { aggregateType: 'Run' as const, projectId: PROJECT, goalId: GOAL, runId: 'run-proposal-1' };

function processItem(alias: number): UnknownCallReviewItemV1 {
  return {
    alias, callId: `call-${String(alias)}`, toolName: 'shell', kind: 'process', contained: true,
    kernel: {
      adapterId: 'a', kernelSessionId: 'ks', kernelRunId: 'kr', turnId: 'turn-1',
      callId: `call-${String(alias)}`, declaredPosition: alias, startedPosition: alias,
    },
    argumentsDigest: 'd'.repeat(64),
    summary: { command: `echo item-${String(alias)}`, cwd: null, mode: null, paths: [], pathsOmitted: 0, truncated: false },
    startedAt: null, observed: { verdict: 'pending', by: null },
  };
}

function creationInput(count: number): NewUnknownCallReviewInputV1 {
  return {
    ref: { aggregateType: 'UnknownCallReview', projectId: PROJECT, goalId: GOAL, runId: ORIGIN_RUN.runId },
    workspaceId: WORKSPACE, task: { projectId: PROJECT, goalId: GOAL, taskId: TASK }, runRef: ORIGIN_RUN,
    sessionRef: { projectId: PROJECT, sessionId: 's' },
    origin: { kind: 'human_attested', attestedBy: { kind: 'human', id: 'operator' }, reason: 'k3-16 proposals' },
    inventory: 'complete', inventoryProblem: null,
    items: Array.from({ length: count }, (_unused, index) => processItem(index + 1)), itemsOmitted: 0,
    workspace: {
      status: 'unavailable', runBaselineKnown: false, reason: 'not_configured',
      detail: 'the pure K3-16 proposals test',
    },
    streak: { priorAutoCleanup: false, priorUnknownProcess: false, resetRunRef: null },
    createdAt: AT,
  };
}

function context(record: UnknownCallReviewV1, overrides: Partial<UnknownCallReviewContextV1> = {}): UnknownCallReviewContextV1 {
  return {
    expectedRevision: record.revision,
    updatedAt: AT,
    actor: { kind: 'human', id: 'operator' },
    activeRunEnded: false,
    activeRunCompleted: false,
    fenceHumanOnly: false,
    reviewUnavailable: false,
    autonomy: 'every_step',
    incompleteCommandAliases: [],
    missingSelfCheckAliases: [],
    originalRunSelected: true,
    ...overrides,
  };
}

function apply(
  current: UnknownCallReviewV1,
  event: Parameters<typeof transitionUnknownCallReview>[1],
  overrides: Partial<UnknownCallReviewContextV1> = {},
): UnknownCallReviewV1 {
  const transition = transitionUnknownCallReview(current, event, context(current, overrides));
  if (!transition.ok) throw new Error(JSON.stringify(transition));
  return transition.next;
}

function proposal(alias: number): SaferMethodProposalV1 {
  return {
    proposalId: `proposal-${String(alias)}`, callId: `call-${String(alias)}`, alias,
    command: `echo safer-${String(alias)}`, cwd: null, rationale: `reason ${String(alias)}`,
    roundRunRef: PROPOSAL_RUN,
  };
}

describe('K3-16 proposal storage order (F-061, UCR-05)', () => {
  it('K3-16: twelve proposals saved alias-descending are stored alias-ascending in the record array', () => {
    const created = (() => {
      const transition = newUnknownCallReview(creationInput(12));
      if (!transition.ok) throw new Error(JSON.stringify(transition));
      return transition.next;
    })();
    expect(created.proposalTargets).toEqual([
      'call-1', 'call-2', 'call-3', 'call-4', 'call-5', 'call-6',
      'call-7', 'call-8', 'call-9', 'call-10', 'call-11', 'call-12',
    ]);

    // A real card answer moves the record to awaiting_proposal; a proposal round
    // is then claimed, so `proposal_recorded` is legal.
    const decided = apply(created, { kind: 'settled' }, { reviewUnavailable: true });
    expect(decided.status).toBe('needs_decision');
    const proposing = apply(decided, {
      kind: 'disposition_applied', choice: 'safer_method', answerMessageRef: null,
      answeredRevision: decided.revision, text: null,
    });
    expect(proposing.status).toBe('awaiting_proposal');
    let record = apply(proposing, { kind: 'round_claimed', runRef: PROPOSAL_RUN, phase: 'proposal', round: 1 });
    expect(record.activeRound).toMatchObject({ phase: 'proposal', round: 1, runRef: PROPOSAL_RUN });

    // Save #12 first, then #11 … #1: the arrival order is the reverse of alias.
    for (let alias = 12; alias >= 1; alias -= 1) {
      record = apply(record, { kind: 'proposal_recorded', proposal: proposal(alias) });
    }

    // The saved array itself is alias-ascending, every proposal is present once,
    // and the fields are untouched by the sorting.
    expect(record.proposals.map(entry => entry.alias)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(record.proposals.map(entry => entry.callId)).toEqual([
      'call-1', 'call-2', 'call-3', 'call-4', 'call-5', 'call-6',
      'call-7', 'call-8', 'call-9', 'call-10', 'call-11', 'call-12',
    ]);
    expect(record.proposals.map(entry => entry.proposalId)).toEqual([
      'proposal-1', 'proposal-2', 'proposal-3', 'proposal-4', 'proposal-5', 'proposal-6',
      'proposal-7', 'proposal-8', 'proposal-9', 'proposal-10', 'proposal-11', 'proposal-12',
    ]);
    expect(record.proposals[0]).toMatchObject({
      alias: 1, callId: 'call-1', command: 'echo safer-1', cwd: null,
      rationale: 'reason 1', roundRunRef: PROPOSAL_RUN,
    });
    expect(record.proposals[11]).toMatchObject({ alias: 12, callId: 'call-12', command: 'echo safer-12' });
  });
});
