/**
 * K3-31 (spec §3.2 UCR-01..UCR-15, §4 rules 4/5/10/13/17/18, L7/L9/L12/L15/L16/L17)
 * and K3-48 (the creation half of M3, L7).
 *
 * Strict TDD: every fixture is a minimal literal `UnknownCallReviewV1` built by
 * hand; the expected statuses, reasons, rounds and byte budgets are the spec's
 * literal values, written here independently of the implementation. No
 * `node:crypto`, no vendor, no RecordStore.
 */
import { describe, expect, it } from 'vitest';
import type { ActorRef } from '../../src/contracts/command-event.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type {
  SaferMethodProposalV1,
  UnknownCallBlockedCommandV1,
  UnknownCallDispositionV1,
  UnknownCallReviewItemV1,
  UnknownCallReviewV1,
} from '../../src/contracts/unknown-call-review.js';
import {
  UNKNOWN_CALL_REVIEW_CREATION_BUDGET_BYTES,
  UNKNOWN_CALL_REVIEW_MAX_BYTES,
  admitUnknownCallReview,
  lastHolderOf,
  newUnknownCallReview,
  transitionUnknownCallReview,
  truncateUnknownCallReviewItems,
  type NewUnknownCallReviewInputV1,
  type UnknownCallReviewContextV1,
  type UnknownCallReviewEvent,
} from '../../src/core/work-graph/state/unknown-call-review.js';

const P = 'p1';
const G = 'g1';
const W = 'w1';

const run = (runId: string): RunRef => ({ aggregateType: 'Run', projectId: P, goalId: G, runId });
const human: ActorRef = { kind: 'human', id: 'u1' };
const messageRef = (messageId: string) =>
  ({ aggregateType: 'SessionMessage' as const, projectId: P, workspaceId: W, messageId });

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-01-02T00:00:00.000Z';

function item(alias: number, overrides: Partial<UnknownCallReviewItemV1> = {}): UnknownCallReviewItemV1 {
  return {
    alias,
    callId: `call-${alias}`,
    toolName: 'shell',
    kind: 'process',
    contained: true,
    kernel: {
      adapterId: 'a', kernelSessionId: 'ks', kernelRunId: 'kr', turnId: 't',
      callId: `call-${alias}`, declaredPosition: 1, startedPosition: 2,
    },
    argumentsDigest: 'd'.repeat(64),
    summary: { command: `echo ${alias}`, cwd: '/w', mode: null, paths: [], pathsOmitted: 0, truncated: false },
    startedAt: T0,
    observed: { verdict: 'pending', by: null },
    ...overrides,
  };
}

function concludedItem(alias: number, verdict: 'done' | 'not_done' | 'partial' | 'undetermined',
  overrides: Partial<UnknownCallReviewItemV1> = {}): UnknownCallReviewItemV1 {
  return item(alias, {
    observed: {
      verdict, by: 'review_round', evidence: `checked ${alias}`, roundRunRef: run('round'),
      crashSuspicion: { verdict: 'unlikely', evidence: 'kernel ended cleanly' }, reviewerConclusion: null,
    },
    ...overrides,
  });
}

function platformItem(alias: number, verdict: 'done' | 'not_done' | 'undetermined' = 'undetermined'): UnknownCallReviewItemV1 {
  return item(alias, {
    toolName: 'send_session_message', kind: 'platform',
    observed: { verdict, by: 'platform', evidence: { kind: 'not_committed' } },
  });
}

function disposition(overrides: Partial<UnknownCallDispositionV1> = {}): UnknownCallDispositionV1 {
  return {
    choice: 'safer_method', source: 'card', targets: ['call-1'],
    answerMessageRef: messageRef('m1'), answeredRevision: 3,
    appliedBy: human, appliedAt: T0, text: null,
    annotations: [], approval: null, approvedMethods: null, hold: null,
    ...overrides,
  };
}

function proposal(alias: number, command = 'echo safer', cwd: string | null = '/w'): SaferMethodProposalV1 {
  return { proposalId: `prop-${alias}`, callId: `call-${alias}`, alias, command, cwd, rationale: 'why', roundRunRef: run('r1') };
}

function baseReview(overrides: Partial<UnknownCallReviewV1> = {}): UnknownCallReviewV1 {
  return {
    ref: { aggregateType: 'UnknownCallReview', projectId: P, goalId: G, runId: 'origin' },
    schemaVersion: 1,
    revision: 4,
    workspaceId: W,
    task: { projectId: P, goalId: G, taskId: 't1' },
    runRef: run('origin'),
    sessionRef: { projectId: P, sessionId: 's1' },
    origin: { kind: 'human_attested', attestedBy: human, reason: 'attested' },
    inventory: 'complete',
    inventoryProblem: null,
    items: [],
    itemsOmitted: 0,
    workspace: { status: 'unavailable', runBaselineKnown: false, reason: 'not_git', detail: 'd' },
    streak: { priorAutoCleanup: false, priorUnknownProcess: false, resetRunRef: null },
    status: 'pending_review',
    open: 'yes',
    decisionReasons: [],
    dispositionTargets: null,
    proposalTargets: null,
    stateEntry: 1,
    activeRound: null,
    rounds: [],
    proposals: [],
    blockedCommands: [],
    disposition: null,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

function active(stateEntry = 1, phase: 'review' | 'proposal' = 'review', round = 1) {
  return { runRef: run(`r-${round}`), phase, round, stateEntry, startedRevision: 3 };
}

function roundOf(
  stateEntry = 1, phase: 'review' | 'proposal' = 'review', round = 1,
  result: 'finished' | 'unfinished' | 'stopped' = 'finished',
) {
  return { runRef: run(`r-${round}`), phase, round, stateEntry, result };
}

function ctx(overrides: Partial<UnknownCallReviewContextV1> = {}): UnknownCallReviewContextV1 {
  return {
    expectedRevision: 4,
    updatedAt: T1,
    actor: human,
    activeRunEnded: false,
    activeRunCompleted: false,
    fenceHumanOnly: false,
    reviewUnavailable: false,
    autonomy: 'after_plan_confirmation',
    incompleteCommandAliases: [],
    missingSelfCheckAliases: [],
    originalRunSelected: true,
    ...overrides,
  };
}

function transition(current: UnknownCallReviewV1, event: UnknownCallReviewEvent, context = ctx()) {
  return transitionUnknownCallReview(current, event, context);
}

function nextOf(result: ReturnType<typeof transition>): UnknownCallReviewV1 {
  if (!result.ok) throw new Error(`expected a legal transition, got ${result.reason}/${result.code}: ${result.detail}`);
  return result.next;
}

function blockedCommand(alias: number): UnknownCallBlockedCommandV1 {
  return {
    reviewRunId: 'origin', alias, commandSha256: 'sha',
    kernelCallRef: {
      adapterId: 'a', kernelSessionId: 'ks', kernelRunId: 'kr', turnId: 't',
      callId: `call-${alias}`, declaredPosition: 1, startedPosition: 2,
    },
    actions: [{ text: `echo ${alias}`, sha256: 'sha' }], expansions: [], truncated: false,
  };
}

function creationInput(overrides: Partial<NewUnknownCallReviewInputV1> = {}): NewUnknownCallReviewInputV1 {
  return {
    ref: { aggregateType: 'UnknownCallReview', projectId: P, goalId: G, runId: 'origin' },
    workspaceId: W,
    task: { projectId: P, goalId: G, taskId: 't1' },
    runRef: run('origin'),
    sessionRef: { projectId: P, sessionId: 's1' },
    origin: { kind: 'human_attested', attestedBy: human, reason: 'attested' },
    inventory: 'complete',
    inventoryProblem: null,
    items: [],
    itemsOmitted: 0,
    workspace: { status: 'unavailable', runBaselineKnown: false, reason: 'not_git', detail: 'd' },
    streak: { priorAutoCleanup: false, priorUnknownProcess: false, resetRunRef: null },
    createdAt: T0,
    ...overrides,
  };
}

/** The written record's UTF-8 byte length (the M3 admission measure). */
const bytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;

// -------------------------------------------------------------------------- //
// UCR-03..15                                                                  //
// -------------------------------------------------------------------------- //

describe('K3-31 UnknownCallReview table', () => {
  it('K3-31 UCR-03 claims a review round from pending_review', () => {
    const current = baseReview({ status: 'pending_review', items: [item(1)], proposalTargets: ['call-1'] });
    const result = transition(current, { kind: 'round_claimed', runRef: run('r1'), phase: 'review', round: 1 });
    const next = nextOf(result);
    expect(next.status).toBe('pending_review');
    expect(next.open).toBe('yes');
    expect(next.activeRound).toEqual({ runRef: run('r1'), phase: 'review', round: 1, stateEntry: 1, startedRevision: 4 });
    expect(next.revision).toBe(5);
    expect(next.updatedAt).toBe(T1);
    expect(result.ok && result.effects).toEqual([
      { kind: 'write_review', review: next },
      { kind: 'emit_event', change: 'round_claimed' },
    ]);
  });

  it('K3-31 UCR-03 claims a proposal round from awaiting_proposal', () => {
    const current = baseReview({ status: 'awaiting_proposal', stateEntry: 2, activeRound: null });
    const next = nextOf(transition(current, { kind: 'round_claimed', runRef: run('r2'), phase: 'proposal', round: 2 }));
    expect(next.status).toBe('awaiting_proposal');
    expect(next.open).toBe('yes');
    expect(next.activeRound).toEqual({ runRef: run('r2'), phase: 'proposal', round: 2, stateEntry: 2, startedRevision: 4 });
  });

  it('K3-31 UCR-03 refuses a second active round as busy', () => {
    const current = baseReview({ status: 'pending_review', activeRound: active() });
    expect(transition(current, { kind: 'round_claimed', runRef: run('r2'), phase: 'review', round: 2 }))
      .toMatchObject({ ok: false, reason: 'guard_failed', code: 'busy' });
  });

  it('K3-31 UCR-03 is illegal from resolved', () => {
    const current = baseReview({ status: 'resolved', open: 'no' });
    expect(transition(current, { kind: 'round_claimed', runRef: run('r2'), phase: 'review', round: 1 }))
      .toMatchObject({ ok: false, reason: 'illegal', code: 'invalid' });
  });

  it('K3-31 UCR-04 records a process conclusion and leaves status unchanged', () => {
    const current = baseReview({ status: 'pending_review', items: [item(1)], activeRound: active() });
    const next = nextOf(transition(current, {
      kind: 'conclusion_recorded', alias: 1, verdict: 'done', evidence: 'saw it finish',
      roundRunRef: run('r-1'), crashSuspicion: { verdict: 'unlikely', evidence: 'clean' },
    }));
    expect(next.status).toBe('pending_review');
    expect(next.open).toBe('yes');
    expect(next.items[0]!.observed).toEqual({
      verdict: 'done', by: 'review_round', evidence: 'saw it finish', roundRunRef: run('r-1'),
      crashSuspicion: { verdict: 'unlikely', evidence: 'clean' }, reviewerConclusion: null,
    });
    expect(next.revision).toBe(5);
  });

  it('K3-31 UCR-04 refuses a non-process item and an unknown alias as invalid', () => {
    const current = baseReview({ status: 'pending_review', items: [platformItem(1)], activeRound: active() });
    const conclusion = {
      kind: 'conclusion_recorded' as const, alias: 1, verdict: 'done' as const, evidence: 'e',
      roundRunRef: null, crashSuspicion: { verdict: 'unlikely' as const, evidence: 'c' },
    };
    expect(transition(current, conclusion)).toMatchObject({ ok: false, reason: 'illegal', code: 'invalid' });
    expect(transition(current, { ...conclusion, alias: 9 })).toMatchObject({ ok: false, reason: 'illegal', code: 'invalid' });
  });

  it('K3-31 UCR-04 after settlement is stale', () => {
    const current = baseReview({ status: 'resolved', open: 'no', items: [concludedItem(1, 'done')], disposition: disposition({ choice: 'handle_myself', hold: 'held' }) });
    expect(transition(current, {
      kind: 'conclusion_recorded', alias: 1, verdict: 'not_done', evidence: 'late',
      roundRunRef: null, crashSuspicion: { verdict: 'unlikely', evidence: 'c' },
    })).toMatchObject({ ok: false, reason: 'stale', code: 'source_stale' });
  });

  it('K3-31 UCR-04 with a stale record revision is revision_conflict', () => {
    const current = baseReview({ status: 'pending_review', items: [item(1)], activeRound: active() });
    expect(transition(current, {
      kind: 'conclusion_recorded', alias: 1, verdict: 'done', evidence: 'e',
      roundRunRef: null, crashSuspicion: { verdict: 'unlikely', evidence: 'c' },
    }, ctx({ expectedRevision: 3 }))).toMatchObject({ ok: false, reason: 'stale', code: 'revision_conflict' });
  });

  it('K3-31 UCR-04 while UCR-15 holds a running round is legal from resolved+held', () => {
    const current = baseReview({
      status: 'resolved', open: 'yes', items: [item(1)],
      disposition: disposition({ choice: 'handle_myself', hold: 'held' }), activeRound: active(),
    });
    const next = nextOf(transition(current, {
      kind: 'conclusion_recorded', alias: 1, verdict: 'done', evidence: 'e',
      roundRunRef: run('r-1'), crashSuspicion: { verdict: 'unlikely', evidence: 'c' },
    }));
    expect(next.status).toBe('resolved');
    expect(next.open).toBe('yes');
    expect(next.items[0]!.observed.verdict).toBe('done');
  });

  it('K3-31 UCR-05 records a proposal for a proposalTarget item', () => {
    const current = baseReview({ status: 'awaiting_proposal', activeRound: active(1, 'proposal'), proposalTargets: ['call-1'] });
    const next = nextOf(transition(current, { kind: 'proposal_recorded', proposal: proposal(1) }));
    expect(next.status).toBe('awaiting_proposal');
    expect(next.open).toBe('yes');
    expect(next.proposals).toEqual([proposal(1)]);
    expect(next.revision).toBe(5);
  });

  it('K3-31 UCR-05 rejects an item outside proposalTargets as invalid', () => {
    const current = baseReview({ status: 'awaiting_proposal', activeRound: active(1, 'proposal'), proposalTargets: ['call-2'] });
    expect(transition(current, { kind: 'proposal_recorded', proposal: proposal(1) }))
      .toMatchObject({ ok: false, reason: 'illegal', code: 'invalid' });
  });

  it('K3-31 UCR-07 re-judges a truncated command at settlement and keeps the reviewer conclusion', () => {
    const current = baseReview({
      status: 'pending_review', activeRound: active(), items: [item(1, { observed: {
        verdict: 'done', by: 'review_round', evidence: 'model said done', roundRunRef: run('r-1'),
        crashSuspicion: { verdict: 'unlikely', evidence: 'clean' }, reviewerConclusion: null,
      } })],
    });
    const next = nextOf(transition(current, { kind: 'settled' },
      ctx({ activeRunEnded: true, activeRunCompleted: true, incompleteCommandAliases: [1] })));
    expect(next.status).toBe('needs_decision');
    expect(next.decisionReasons).toEqual(['undetermined', 'crash_undetermined']);
    expect(next.items[0]!.observed).toEqual({
      verdict: 'undetermined', by: 'settlement',
      evidence: '核对说明里没有这条命令的全文，按判断不了处理',
      roundRunRef: run('r-1'),
      crashSuspicion: { verdict: 'undetermined', evidence: '命令没给全，自查同样没有依据。' },
      reviewerConclusion: {
        verdict: 'done', evidence: 'model said done', crashSuspicion: { verdict: 'unlikely', evidence: 'clean' },
      },
    });
  });

  it('K3-31 UCR-05 replaces an existing proposal for the same callId', () => {
    const current = baseReview({
      status: 'awaiting_proposal', activeRound: active(1, 'proposal'), proposalTargets: ['call-1'],
      proposals: [proposal(1, 'old command')],
    });
    const next = nextOf(transition(current, { kind: 'proposal_recorded', proposal: proposal(1, 'new command') }));
    expect(next.proposals).toEqual([proposal(1, 'new command')]);
  });

  it('K3-31 UCR-05 over the 5,120-byte approved-method cap is capacity', () => {
    const current = baseReview({
      status: 'awaiting_proposal', activeRound: active(1, 'proposal'), proposalTargets: ['call-1', 'call-2'],
      proposals: [{ ...proposal(1, 'a'.repeat(4_000)), callId: 'call-1' }],
    });
    expect(transition(current, { kind: 'proposal_recorded', proposal: { ...proposal(2, 'b'.repeat(4_000)), callId: 'call-2' } }))
      .toMatchObject({ ok: false, reason: 'guard_failed', code: 'capacity' });
  });

  it('K3-31 UCR-06 clears the active round and appends a first unfinished round', () => {
    const current = baseReview({ status: 'pending_review', activeRound: active() });
    const next = nextOf(transition(current, { kind: 'round_unfinished' },
      ctx({ activeRunEnded: true, activeRunCompleted: false, fenceHumanOnly: false })));
    expect(next.status).toBe('pending_review');
    expect(next.activeRound).toBeNull();
    expect(next.open).toBe('yes');
    expect(next.rounds).toEqual([roundOf(1, 'review', 1, 'unfinished')]);
  });

  it('K3-31 UCR-06 refuses the second unfinished round in the same stateEntry', () => {
    const current = baseReview({
      status: 'pending_review', activeRound: active(1, 'review', 2),
      rounds: [roundOf(1, 'review', 1, 'unfinished')],
    });
    expect(transition(current, { kind: 'round_unfinished' }, ctx({ activeRunEnded: true })))
      .toMatchObject({ ok: false, reason: 'illegal', code: 'invalid' });
  });

  it('K3-31 UCR-06b settles a human-stopped round with review_stopped and a stopped round', () => {
    const current = baseReview({ status: 'pending_review', activeRound: active() });
    const next = nextOf(transition(current, { kind: 'settled' },
      ctx({ activeRunEnded: true, activeRunCompleted: false, fenceHumanOnly: true })));
    expect(next.status).toBe('needs_decision');
    expect(next.open).toBe('yes');
    expect(next.decisionReasons).toEqual(['review_stopped']);
    expect(next.activeRound).toBeNull();
    expect(next.rounds).toEqual([roundOf(1, 'review', 1, 'stopped')]);
  });

  it('K3-31 UCR-07 settles a normally finished pending_review round to resolved', () => {
    const current = baseReview({ status: 'pending_review', items: [concludedItem(1, 'done')], activeRound: active() });
    const next = nextOf(transition(current, { kind: 'settled' },
      ctx({ activeRunEnded: true, activeRunCompleted: true })));
    expect(next.status).toBe('resolved');
    expect(next.open).toBe('no');
    expect(next.decisionReasons).toEqual([]);
    expect(next.activeRound).toBeNull();
    expect(next.rounds).toEqual([roundOf(1, 'review', 1, 'finished')]);
  });

  it('K3-31 UCR-07 turns still-pending items undetermined and becomes needs_decision', () => {
    const current = baseReview({ status: 'pending_review', items: [item(1)], activeRound: active() });
    const next = nextOf(transition(current, { kind: 'settled' },
      ctx({ activeRunEnded: true, activeRunCompleted: true })));
    expect(next.status).toBe('needs_decision');
    expect(next.open).toBe('yes');
    expect(next.decisionReasons).toEqual(['undetermined', 'crash_undetermined']);
    expect(next.items[0]!.observed).toMatchObject({
      verdict: 'undetermined', by: 'settlement', evidence: '核对轮没有给出结论',
      crashSuspicion: { verdict: 'undetermined', evidence: '没有自查依据' }, reviewerConclusion: null,
    });
  });

  it('K3-31 UCR-07 counts the second unfinished round in the same stateEntry as review_incomplete', () => {
    const current = baseReview({
      status: 'pending_review', items: [concludedItem(1, 'done')], activeRound: active(1, 'review', 2),
      rounds: [roundOf(1, 'review', 1, 'unfinished')],
    });
    const next = nextOf(transition(current, { kind: 'settled' },
      ctx({ activeRunEnded: true, activeRunCompleted: false })));
    expect(next.status).toBe('needs_decision');
    expect(next.decisionReasons).toEqual(['review_incomplete']);
    expect(next.rounds.map(r => r.result)).toEqual(['unfinished', 'unfinished']);
  });

  it('K3-31 UCR-07 with review_unavailable and no active round adds review_unavailable', () => {
    const current = baseReview({ status: 'pending_review', items: [item(1)], activeRound: null });
    const next = nextOf(transition(current, { kind: 'settled' }, ctx({ reviewUnavailable: true })));
    expect(next.status).toBe('needs_decision');
    expect(next.decisionReasons).toEqual(['review_unavailable', 'undetermined', 'crash_undetermined']);
    expect(next.rounds).toEqual([]);
  });

  it('K3-31 UCR-08 settles awaiting_proposal to awaiting_approval when every target has a proposal', () => {
    const current = baseReview({
      status: 'awaiting_proposal', items: [concludedItem(1, 'done')], activeRound: active(1, 'proposal'),
      proposalTargets: ['call-1'], proposals: [proposal(1)],
    });
    const next = nextOf(transition(current, { kind: 'settled' },
      ctx({ activeRunEnded: true, activeRunCompleted: true })));
    expect(next.status).toBe('awaiting_approval');
    expect(next.open).toBe('yes');
    expect(next.decisionReasons).toEqual([]);
    expect(next.rounds.map(r => r.result)).toEqual(['finished']);
  });

  it('K3-31 UCR-08 leaves a missing proposal as needs_decision with proposal_missing', () => {
    const current = baseReview({
      status: 'awaiting_proposal', items: [concludedItem(1, 'done')], activeRound: active(1, 'proposal'),
      proposalTargets: ['call-1', 'call-2'], proposals: [proposal(1)],
    });
    const next = nextOf(transition(current, { kind: 'settled' },
      ctx({ activeRunEnded: true, activeRunCompleted: true })));
    expect(next.status).toBe('needs_decision');
    expect(next.decisionReasons).toEqual(['proposal_missing']);
  });

  it('K3-31 UCR-08 puts review_incomplete before proposal_missing for the second unfinished round', () => {
    const current = baseReview({
      status: 'awaiting_proposal', items: [concludedItem(1, 'done')], activeRound: active(2, 'proposal', 2),
      stateEntry: 2, proposalTargets: ['call-1', 'call-2'], proposals: [],
      rounds: [roundOf(2, 'proposal', 1, 'unfinished')],
    });
    const next = nextOf(transition(current, { kind: 'settled' },
      ctx({ activeRunEnded: true, activeRunCompleted: false })));
    expect(next.status).toBe('needs_decision');
    expect(next.decisionReasons).toEqual(['review_incomplete', 'proposal_missing']);
  });

  it('K3-31 UCR-08c review_unavailable from awaiting_proposal is needs_decision', () => {
    const current = baseReview({
      status: 'awaiting_proposal', items: [item(1)], activeRound: null,
      proposalTargets: ['call-1'], proposals: [],
    });
    const next = nextOf(transition(current, { kind: 'settled' }, ctx({ reviewUnavailable: true })));
    expect(next.status).toBe('needs_decision');
    expect(next.open).toBe('yes');
    expect(next.decisionReasons).toEqual(['review_unavailable', 'undetermined', 'crash_undetermined', 'proposal_missing']);
    expect(next.rounds).toEqual([]);
  });

  it('K3-31 UCR-08b settles a held running round without changing status, hold or disposition', () => {
    const held = disposition({
      choice: 'handle_myself', source: 'direct', answerMessageRef: null, hold: 'held', approval: null,
    });
    const current = baseReview({
      status: 'resolved', open: 'yes', items: [item(1)], disposition: held, activeRound: active(),
    });
    const next = nextOf(transition(current, { kind: 'settled' },
      ctx({ activeRunEnded: true, activeRunCompleted: true })));
    expect(next.status).toBe('resolved');
    expect(next.open).toBe('no');
    expect(next.disposition).toEqual(held);
    expect(next.decisionReasons).toEqual([]);
    expect(next.activeRound).toBeNull();
    expect(next.rounds.map(r => r.result)).toEqual(['finished']);
  });

  it('K3-31 UCR-09 rerun_as_is resolves and records no blocked commands', () => {
    const current = baseReview({
      status: 'needs_decision', items: [concludedItem(1, 'done')], dispositionTargets: ['call-1'], proposalTargets: ['call-1'],
    });
    const next = nextOf(transition(current, {
      kind: 'disposition_applied', choice: 'rerun_as_is', answerMessageRef: messageRef('m2'),
      answeredRevision: 4, text: 'go again',
    }));
    expect(next.status).toBe('resolved');
    expect(next.open).toBe('no');
    expect(next.blockedCommands).toEqual([]);
    expect(next.disposition).toMatchObject({
      choice: 'rerun_as_is', source: 'card', targets: ['call-1'], answerMessageRef: messageRef('m2'),
      answeredRevision: 4, appliedBy: human, appliedAt: T1, text: 'go again', approval: null, hold: null,
    });
  });

  it('K3-31 UCR-09 skip_as_done records blockedCommands from the context', () => {
    const current = baseReview({
      status: 'needs_decision', items: [concludedItem(1, 'done')], dispositionTargets: ['call-1'], proposalTargets: ['call-1'],
    });
    const next = nextOf(transition(current, {
      kind: 'disposition_applied', choice: 'skip_as_done', answerMessageRef: messageRef('m2'),
      answeredRevision: 4, text: null,
    }, ctx({ blockedCommands: [blockedCommand(1)] })));
    expect(next.status).toBe('resolved');
    expect(next.blockedCommands).toEqual([blockedCommand(1)]);
  });

  it('K3-31 UCR-10 safer_method enters awaiting_proposal, clears proposals and bumps stateEntry', () => {
    const current = baseReview({
      status: 'needs_decision', dispositionTargets: ['call-1', 'call-2'], proposalTargets: ['call-1'],
      proposals: [proposal(1)], rounds: [],
    });
    const next = nextOf(transition(current, {
      kind: 'disposition_applied', choice: 'safer_method', answerMessageRef: messageRef('m2'),
      answeredRevision: 4, text: 'try safely',
    }));
    expect(next.status).toBe('awaiting_proposal');
    expect(next.open).toBe('yes');
    expect(next.proposals).toEqual([]);
    expect(next.stateEntry).toBe(2);
    expect(next.disposition).toMatchObject({ choice: 'safer_method', hold: null });
    expect(next.rounds).toEqual([]);
  });

  it('K3-31 UCR-10 with an empty proposalTargets is invalid', () => {
    const current = baseReview({ status: 'needs_decision', proposalTargets: null });
    expect(transition(current, {
      kind: 'disposition_applied', choice: 'safer_method', answerMessageRef: messageRef('m2'),
      answeredRevision: 4, text: null,
    })).toMatchObject({ ok: false, reason: 'illegal', code: 'invalid' });
  });

  it('K3-31 UCR-10 with fewer than two free round slots is invalid', () => {
    const rounds = Array.from({ length: 7 }, (_, i) => roundOf(1, 'review', i + 1, 'finished'));
    const current = baseReview({ status: 'needs_decision', proposalTargets: ['call-1'], rounds });
    expect(transition(current, {
      kind: 'disposition_applied', choice: 'safer_method', answerMessageRef: messageRef('m2'),
      answeredRevision: 4, text: null,
    })).toMatchObject({ ok: false, reason: 'illegal', code: 'invalid' });
  });

  it('K3-31 UCR-11 handle_myself resolves with hold held and no blocked commands', () => {
    const current = baseReview({ status: 'needs_decision', dispositionTargets: ['call-1'] });
    const next = nextOf(transition(current, {
      kind: 'disposition_applied', choice: 'handle_myself', answerMessageRef: messageRef('m2'),
      answeredRevision: 4, text: null,
    }));
    expect(next.status).toBe('resolved');
    expect(next.open).toBe('no');
    expect(next.blockedCommands).toEqual([]);
    expect(next.disposition).toMatchObject({ choice: 'handle_myself', hold: 'held' });
  });

  it('K3-31 UCR-12 approve resolves, writes approvedMethods and blocked commands for every target', () => {
    const current = baseReview({
      status: 'awaiting_approval', items: [concludedItem(1, 'done')],
      proposalTargets: ['call-1', 'call-2'], proposals: [proposal(1), proposal(2)],
      disposition: disposition({ choice: 'safer_method' }),
    });
    const approvedMethods = [
      { proposalId: 'prop-1', callId: 'call-1', alias: 1, command: 'echo safer', cwd: '/w' },
      { proposalId: 'prop-2', callId: 'call-2', alias: 2, command: 'echo safer', cwd: '/w' },
    ];
    const next = nextOf(transition(current, {
      kind: 'approval_applied', decision: 'approve', answerMessageRef: messageRef('m3'),
      answeredRevision: 4, text: 'ok', approvedMethods,
    }, ctx({ blockedCommands: [blockedCommand(1), blockedCommand(2)] })));
    expect(next.status).toBe('resolved');
    expect(next.open).toBe('no');
    expect(next.disposition?.approvedMethods).toEqual(approvedMethods);
    expect(next.disposition?.approval).toMatchObject({ decision: 'approve', answerMessageRef: messageRef('m3') });
    expect(next.blockedCommands).toEqual([blockedCommand(1), blockedCommand(2)]);
  });

  it('K3-31 UCR-13 decline returns to needs_decision with proposal_declined and keeps safer_method', () => {
    const current = baseReview({
      status: 'awaiting_approval', items: [concludedItem(1, 'done')],
      proposalTargets: ['call-1'], proposals: [proposal(1)],
      disposition: disposition({ choice: 'safer_method' }),
    });
    const next = nextOf(transition(current, {
      kind: 'approval_applied', decision: 'decline', answerMessageRef: messageRef('m3'),
      answeredRevision: 4, text: 'no', approvedMethods: null,
    }));
    expect(next.status).toBe('needs_decision');
    expect(next.open).toBe('yes');
    expect(next.decisionReasons).toEqual(['proposal_declined']);
    expect(next.disposition?.choice).toBe('safer_method');
    expect(next.disposition?.approval).toMatchObject({ decision: 'decline' });
  });

  it('K3-31 UCR-14 releases a held review', () => {
    const current = baseReview({
      status: 'resolved', open: 'no', disposition: disposition({ choice: 'handle_myself', hold: 'held' }),
    });
    const next = nextOf(transition(current, { kind: 'hold_released' }));
    expect(next.status).toBe('resolved');
    expect(next.open).toBe('no');
    expect(next.disposition?.hold).toBe('released');
  });

  it('K3-31 UCR-14 with an active round is busy', () => {
    const current = baseReview({
      status: 'resolved', open: 'yes', disposition: disposition({ choice: 'handle_myself', hold: 'held' }),
      activeRound: active(),
    });
    expect(transition(current, { kind: 'hold_released' }))
      .toMatchObject({ ok: false, reason: 'guard_failed', code: 'busy' });
  });

  it('K3-31 UCR-15 holds a pending_review and leaves activeRound untouched', () => {
    const current = baseReview({ status: 'pending_review', activeRound: null, dispositionTargets: ['call-1'] });
    const next = nextOf(transition(current, { kind: 'hold_applied', answeredRevision: 4, text: 'mine' }));
    expect(next.status).toBe('resolved');
    expect(next.open).toBe('no');
    expect(next.activeRound).toBeNull();
    expect(next.disposition).toMatchObject({
      choice: 'handle_myself', source: 'direct', answerMessageRef: null, hold: 'held', answeredRevision: 4, text: 'mine',
    });
  });

  it('K3-31 UCR-15 keeps a running activeRound and therefore open yes', () => {
    const current = baseReview({ status: 'awaiting_proposal', activeRound: active(1, 'proposal') });
    const next = nextOf(transition(current, { kind: 'hold_applied', answeredRevision: 4, text: null }));
    expect(next.status).toBe('resolved');
    expect(next.open).toBe('yes');
    expect(next.activeRound).toEqual(active(1, 'proposal'));
  });

  it('K3-31 UCR-15 replaces an existing disposition without keeping a history array', () => {
    const old = disposition({ choice: 'safer_method', approval: { decision: 'decline', answerMessageRef: messageRef('m9'), answeredRevision: 3, appliedBy: human, appliedAt: T0 } });
    const current = baseReview({ status: 'needs_decision', disposition: old, dispositionTargets: ['call-1'] });
    const next = nextOf(transition(current, { kind: 'hold_applied', answeredRevision: 4, text: null }));
    expect(next.status).toBe('resolved');
    expect(next.disposition?.choice).toBe('handle_myself');
    expect(next.disposition?.hold).toBe('held');
    expect('dispositionHistory' in next).toBe(false);
  });

  it('K3-31 an out-of-table disposition is illegal', () => {
    const current = baseReview({ status: 'pending_review' });
    expect(transition(current, {
      kind: 'disposition_applied', choice: 'rerun_as_is', answerMessageRef: messageRef('m2'),
      answeredRevision: 4, text: null,
    })).toMatchObject({ ok: false, reason: 'illegal', code: 'invalid' });
  });

  it('K3-31 a disposition never rewrites an existing observation', () => {
    const observed = concludedItem(1, 'partial', { observed: {
      verdict: 'partial', by: 'review_round', evidence: 'half', roundRunRef: run('r-1'),
      crashSuspicion: { verdict: 'possible', evidence: 'maybe' }, reviewerConclusion: null,
    } });
    const current = baseReview({ status: 'needs_decision', items: [observed], dispositionTargets: ['call-1'] });
    const before = JSON.parse(JSON.stringify(current.items));
    const next = nextOf(transition(current, {
      kind: 'disposition_applied', choice: 'skip_as_done', answerMessageRef: messageRef('m2'),
      answeredRevision: 4, text: null,
    }));
    expect(next.items).toEqual(before);
    expect(next.items).toEqual(current.items);
  });

  it('K3-31 lastHolderOf reads the last round or the origin run', () => {
    const withRounds = baseReview({ rounds: [roundOf(1, 'review', 1, 'finished')] });
    expect(lastHolderOf(withRounds)).toEqual(run('r-1'));
    expect(lastHolderOf(baseReview({ rounds: [] }))).toEqual(run('origin'));
  });
});

// -------------------------------------------------------------------------- //
// Constructor (UCR-01/UCR-02, L9) and M3 admission (K3-48)                    //
// -------------------------------------------------------------------------- //

describe('K3-31 newUnknownCallReview', () => {
  it('K3-31 derives pending_review for a complete inventory with process items', () => {
    const built = newUnknownCallReview(creationInput({ items: [item(1)], inventory: 'complete' }));
    if (!built.ok) throw new Error(built.detail);
    expect(built.next).toMatchObject({
      revision: 1, schemaVersion: 1, status: 'pending_review', open: 'yes',
      stateEntry: 1, activeRound: null, decisionReasons: [], inventory: 'complete', inventoryProblem: null,
    });
    expect(built.next.proposalTargets).toEqual(['call-1']);
    expect(built.next.dispositionTargets).toEqual(['call-1']);
    expect(built.next.rounds).toEqual([]);
    expect(built.next.proposals).toEqual([]);
  });

  it('K3-31 derives needs_decision + inventory_incomplete for an incomplete inventory', () => {
    const built = newUnknownCallReview(creationInput({ inventory: 'incomplete', inventoryProblem: 'too_many_calls' }));
    if (!built.ok) throw new Error(built.detail);
    expect(built.next.status).toBe('needs_decision');
    expect(built.next.open).toBe('yes');
    expect(built.next.decisionReasons).toEqual(['inventory_incomplete']);
  });

  it('K3-31 UCR-02 keeps the kernel-unreadable inventory problems on the created record', () => {
    for (const problem of ['kernel_unreadable', 'kernel_unreadable_at_stop'] as const) {
      const built = newUnknownCallReview(creationInput({ inventory: 'incomplete', inventoryProblem: problem }));
      if (!built.ok) throw new Error(built.detail);
      expect(built.next).toMatchObject({ status: 'needs_decision', inventory: 'incomplete',
        inventoryProblem: problem, decisionReasons: ['inventory_incomplete'], open: 'yes' });
    }
  });

  it('K3-31 derives needs_decision with undetermined for an undetermined platform item', () => {
    const built = newUnknownCallReview(creationInput({ items: [platformItem(1)] }));
    if (!built.ok) throw new Error(built.detail);
    expect(built.next.status).toBe('needs_decision');
    expect(built.next.decisionReasons).toEqual(['undetermined']);
  });

  it('K3-31 derives resolved when there is nothing left to review', () => {
    const built = newUnknownCallReview(creationInput({ items: [] }));
    if (!built.ok) throw new Error(built.detail);
    expect(built.next.status).toBe('resolved');
    expect(built.next.open).toBe('no');
    expect(built.next.decisionReasons).toEqual([]);
    expect(built.next.proposalTargets).toBeNull();
  });

  it('K3-31 refuses nine rounds as invalid', () => {
    const rounds = Array.from({ length: 9 }, (_, i) => roundOf(1, 'review', i + 1, 'finished'));
    expect(newUnknownCallReview(creationInput({ rounds })))
      .toMatchObject({ ok: false, reason: 'illegal', code: 'invalid' });
  });

  it('K3-31 refuses item aliases that are not 1..n in Kernel order', () => {
    expect(newUnknownCallReview(creationInput({ items: [item(2), item(1)] })))
      .toMatchObject({ ok: false, reason: 'illegal', code: 'invalid' });
  });
});

describe('K3-48 (creation, M3)', () => {
  it('K3-48 required writes are not held to the 512 KiB − R threshold, optional text is', () => {
    const small = baseReview();
    expect(bytes(small)).toBeLessThan(UNKNOWN_CALL_REVIEW_CREATION_BUDGET_BYTES);
    expect(admitUnknownCallReview(small, { required: false })).toBeNull();
    expect(admitUnknownCallReview(small, { required: true })).toBeNull();

    const oversized = baseReview({ disposition: disposition({ text: 'x'.repeat(200_000) }) });
    expect(bytes(oversized)).toBeGreaterThan(UNKNOWN_CALL_REVIEW_CREATION_BUDGET_BYTES);
    expect(admitUnknownCallReview(oversized, { required: true })).toBeNull();
    expect(admitUnknownCallReview(oversized, { required: false }))
      .toMatchObject({ ok: false, reason: 'guard_failed', code: 'capacity' });
  });

  it('K3-48 a required write of exactly 524,289 serialized bytes is refused with capacity and nothing is written', () => {
    // Construct the boundary exactly: `text: null` serializes as 4 bytes and
    // `"x".repeat(n)` as n + 2, so the record grows by n − 2 ASCII bytes.
    const atCeilingMinusOne = baseReview({ disposition: disposition({ text: null }) });
    const text = 'x'.repeat(UNKNOWN_CALL_REVIEW_MAX_BYTES + 1 - bytes(atCeilingMinusOne) + 2);
    const over = baseReview({ disposition: disposition({ text }) });
    expect(bytes(over)).toBe(524_289);
    // `admitUnknownCallReview` is the pure pre-commit gate: a refusal here is
    // `capacity` and no caller writes (all owner writes return it unchanged).
    expect(admitUnknownCallReview(over, { required: true }))
      .toMatchObject({ ok: false, reason: 'guard_failed', code: 'capacity' });
  });

  it('K3-48 the absolute 512 KiB check refuses an over-MAX record for required and optional writes', () => {
    const over = baseReview({ disposition: disposition({ text: 'x'.repeat(UNKNOWN_CALL_REVIEW_MAX_BYTES) }) });
    expect(bytes(over)).toBeGreaterThan(UNKNOWN_CALL_REVIEW_MAX_BYTES);
    for (const required of [true, false]) {
      expect(admitUnknownCallReview(over, { required }))
        .toMatchObject({ ok: false, reason: 'guard_failed', code: 'capacity' });
    }
    // Exactly at the ceiling is still admitted (the check is strictly `>`).
    const atCeiling = baseReview({ disposition: disposition({ text: 'x'.repeat(200_000) }) });
    expect(bytes(atCeiling)).toBeLessThanOrEqual(UNKNOWN_CALL_REVIEW_MAX_BYTES);
    expect(admitUnknownCallReview(atCeiling, { required: true })).toBeNull();
  });

  it('K3-48 truncates items in Kernel order to fit the creation budget', () => {
    const items = Array.from({ length: 32 }, (_, i) => item(i + 1, {
      summary: { command: 'c'.repeat(6_000), cwd: '/w', mode: null, paths: [], pathsOmitted: 0, truncated: false },
    }));
    const input = creationInput({ items });
    expect(bytes(baseReview({ items }))).toBeGreaterThan(UNKNOWN_CALL_REVIEW_CREATION_BUDGET_BYTES);

    const truncated = truncateUnknownCallReviewItems(input);
    expect(truncated.inventory).toBe('incomplete');
    expect(truncated.inventoryProblem).toBe('too_large');
    expect(truncated.items.length).toBeGreaterThan(0);
    expect(truncated.items.length).toBeLessThan(32);
    expect(truncated.items.map(entry => entry.alias)).toEqual(truncated.items.map((_, i) => i + 1));
    expect(truncated.itemsOmitted).toBe(32 - truncated.items.length);

    const built = newUnknownCallReview(input);
    if (!built.ok) throw new Error(built.detail);
    expect(built.next.inventory).toBe('incomplete');
    expect(built.next.inventoryProblem).toBe('too_large');
    expect(built.next.itemsOmitted).toBe(truncated.itemsOmitted);
    expect(built.next.items.length).toBe(truncated.items.length);
    expect(built.next.status).toBe('needs_decision');
    expect(built.next.decisionReasons).toEqual(['inventory_incomplete']);
    expect(bytes(built.next)).toBeLessThanOrEqual(UNKNOWN_CALL_REVIEW_CREATION_BUDGET_BYTES);
  });
});
