/**
 * K3 rows K3-06 and K3-13: the MULTI-ITEM combinations that no public path can
 * reach (rework item 3).
 *
 * The Kernel runs a non-read-only tool batch one call at a time and only the
 * call it has started is `running`; RUN-20 records that list and the draft
 * reader turns it into items. A real crash therefore leaves exactly ONE process
 * item (see `K3-48-3-extremes-pure.test.ts` and `K3-48-3-required-writes`), so
 * neither the three-kind record nor the two-process-item record can be produced
 * by a Run. The owner scenarios keep the reachable one-process-item states in
 * `tests/work-graph/K3-06-mixed-kinds-owner.test.ts` and
 * `tests/work-graph/K3-13-two-items-owner.test.ts`; the unreachable
 * combinations are proved here as pure aggregate input -> output, with no store,
 * no Run and no commit (coordinator-mode "Allowed — pure functions").
 *
 *   1. K3-06: `newUnknownCallReview` keeps three kinds in Kernel order and makes
 *      only the process item a disposition/proposal target; one review round
 *      concludes only it; settlement resolves the record.
 *   2. K3-13: two process items, a conclusion for item 1 only; settlement keeps
 *      that conclusion and closes item 2 `undetermined`/`settlement` with the
 *      fixed sentence and the fixed reasons.
 *
 * Existing coverage found by searching before writing: the canonical aggregate
 * tests in `tests/state/unknown-call-review.test.ts` cover these transitions
 * with ONE item; nothing there builds a multi-item record.
 */
import { describe, expect, it } from 'vitest';
import type {
  UnknownCallKindV1, UnknownCallObservationV1, UnknownCallReviewItemV1, UnknownCallReviewRef,
  UnknownCallReviewV1,
} from '../../src/contracts/unknown-call-review.js';
import { canonicalJson, sha256Hex } from '../../src/contracts/fingerprint.js';
import {
  newUnknownCallReview, transitionUnknownCallReview,
  type UnknownCallReviewContextV1, type UnknownCallReviewEventV1,
} from '../../src/core/work-graph/state/unknown-call-review.js';

const AT = '2026-10-20T00:00:00.000Z';
const REF: UnknownCallReviewRef = {
  aggregateType: 'UnknownCallReview', projectId: 'P', goalId: 'G', runId: 'k3-multi-pure-origin',
};
const ORIGIN = { aggregateType: 'Run' as const, projectId: 'P', goalId: 'G', runId: REF.runId };
const ROUND = { aggregateType: 'Run' as const, projectId: 'P', goalId: 'G', runId: 'k3-multi-pure-round-1' };
const UNAVAILABLE_WORKSPACE: UnknownCallReviewV1['workspace'] = {
  status: 'unavailable', runBaselineKnown: false, reason: 'not_configured', detail: 'k3 multi-item pure',
};

/** One L3/L7 item with the L3 kind written from the spec table. */
function item(alias: number, callId: string, toolName: string, kind: UnknownCallKindV1,
  observed: UnknownCallObservationV1, summary: UnknownCallReviewItemV1['summary'], args: unknown,
): UnknownCallReviewItemV1 {
  return {
    alias, callId, toolName, kind, contained: true,
    kernel: { adapterId: 'a', kernelSessionId: 'ks', kernelRunId: 'kr', turnId: 't',
      callId, declaredPosition: 7, startedPosition: alias },
    argumentsDigest: sha256Hex(canonicalJson(args as never)),
    summary, startedAt: null, observed,
  };
}

function build(items: UnknownCallReviewItemV1[]): UnknownCallReviewV1 {
  const built = newUnknownCallReview({
    ref: REF, workspaceId: 'W',
    task: { projectId: 'P', goalId: 'G', taskId: 't1' },
    runRef: ORIGIN,
    sessionRef: { projectId: 'P', sessionId: 's1' },
    origin: { kind: 'human_attested', attestedBy: { kind: 'human', id: 'operator' }, reason: 'k3 multi-item pure input' },
    inventory: 'complete', inventoryProblem: null,
    items, itemsOmitted: 0,
    workspace: UNAVAILABLE_WORKSPACE,
    streak: { priorAutoCleanup: false, priorUnknownProcess: false, resetRunRef: null },
    createdAt: AT,
  });
  if (!built.ok) throw new Error(JSON.stringify(built));
  return built.next;
}

function context(over: Partial<UnknownCallReviewContextV1> = {}): UnknownCallReviewContextV1 {
  return {
    expectedRevision: 1, updatedAt: AT, actor: { kind: 'human', id: 'operator' },
    activeRunEnded: false, activeRunCompleted: false, fenceHumanOnly: false, reviewUnavailable: false,
    autonomy: 'after_plan_confirmation', incompleteCommandAliases: [], missingSelfCheckAliases: [],
    originalRunSelected: true, ...over,
  };
}

function nextOf(
  current: UnknownCallReviewV1, event: UnknownCallReviewEventV1, over: Partial<UnknownCallReviewContextV1> = {},
): UnknownCallReviewV1 {
  const result = transitionUnknownCallReview(current, event, context({ expectedRevision: current.revision, ...over }));
  if (!result.ok) throw new Error(`expected ${event.kind}, got ${result.reason}/${result.code}: ${result.detail}`);
  return result.next;
}

// The three L3 kinds with the L4 verdicts the trusted entry carries for each.
const SEND_OBSERVED: UnknownCallObservationV1 = { verdict: 'not_done', by: 'platform', evidence: { kind: 'not_committed' } };
const EDIT_OBSERVED: UnknownCallObservationV1 = { verdict: 'compare_in_continuation', by: 'platform' };
const SHELL_OBSERVED: UnknownCallObservationV1 = { verdict: 'pending', by: null };

const SEND_ITEM = item(1, 'k3-multi-send', 'send_session_message', 'platform', SEND_OBSERVED,
  { command: null, cwd: null, mode: null, paths: [], pathsOmitted: 0, truncated: false },
  { recipient: { projectId: 'P', sessionId: 's' }, text: 'K3 question' });
const EDIT_ITEM = item(2, 'k3-multi-edit', 'edit', 'file_edit', EDIT_OBSERVED,
  { command: null, cwd: null, mode: 'replace', paths: ['src/module.ts'], pathsOmitted: 0, truncated: false },
  { mode: 'replace', path: 'src/module.ts', oldText: 'a', newText: 'b' });
const SHELL_ITEM = item(3, 'k3-multi-shell', 'shell', 'process', SHELL_OBSERVED,
  { command: 'K3-06 runs a program', cwd: null, mode: null, paths: [], pathsOmitted: 0, truncated: false },
  { command: 'K3-06 runs a program' });

describe('K3-06 pure: the three-kind mixed record (unreachable by a real Run)', () => {
  it('K3-06 pure: three kinds stay in Kernel order, only the process item is targeted, and one round settles it', () => {
    const created = build([SEND_ITEM, EDIT_ITEM, SHELL_ITEM]);
    // Creation keeps the Kernel order and the L3 kind of each name.
    expect(created.status).toBe('pending_review');
    expect(created.items.map(entry => entry.alias)).toEqual([1, 2, 3]);
    expect(created.items.map(entry => entry.toolName))
      .toEqual(['send_session_message', 'edit', 'shell']);
    expect(created.items.map(entry => entry.kind)).toEqual(['platform', 'file_edit', 'process']);
    // F-056: containment and the carried arguments digests are output facts, not
    // re-derived here; each expected digest is a fixed SHA-256 of the canonical
    // arguments, written out (never computed with the production formatter).
    expect(created.items.map(entry => entry.contained)).toEqual([true, true, true]);
    expect(created.items.map(entry => entry.argumentsDigest)).toEqual([
      'cc4fb23db8d485cbe204bec7148c51f3bf3db0ad96a6a3f63bef847b81d85e64',
      '1b80834b202a21a6e1b4483b69a7d4567634db58922e38bac65e0fb6e6604261',
      '4532fed3b821790f5035b3a4f5ebd2ed2b35f674c6d60e0d80df0ddfdab96b5e',
    ]);
    expect(created.items.map(entry => entry.observed)).toEqual([SEND_OBSERVED, EDIT_OBSERVED, SHELL_OBSERVED]);
    // One batch: every item names the one Kernel Turn and declared position.
    expect(new Set(created.items.map(entry => entry.kernel.turnId)).size).toBe(1);
    expect(new Set(created.items.map(entry => entry.kernel.kernelRunId)).size).toBe(1);
    expect(new Set(created.items.map(entry => entry.kernel.declaredPosition)).size).toBe(1);
    // Only the process item is reviewed/proposed; the carried verdicts are final.
    expect(created.dispositionTargets).toEqual([SHELL_ITEM.callId]);
    expect(created.proposalTargets).toEqual([SHELL_ITEM.callId]);

    const claimed = nextOf(created, { kind: 'round_claimed', runRef: ROUND, phase: 'review', round: 1 });
    expect(claimed.status).toBe('pending_review');
    const concluded = nextOf(claimed, { kind: 'conclusion_recorded', alias: 3, verdict: 'done',
      evidence: 'the shell call was checked by hand', roundRunRef: ROUND,
      crashSuspicion: { verdict: 'unlikely', evidence: 'the command leaves no crash trace' } });
    // The platform and file_edit items keep the trusted verdicts unchanged.
    expect(concluded.items.map(entry => entry.observed)).toEqual([
      SEND_OBSERVED, EDIT_OBSERVED,
      { verdict: 'done', by: 'review_round', evidence: 'the shell call was checked by hand',
        roundRunRef: ROUND, crashSuspicion: { verdict: 'unlikely', evidence: 'the command leaves no crash trace' },
        reviewerConclusion: null },
    ]);

    const settled = nextOf(concluded, { kind: 'settled' }, { activeRunEnded: true, activeRunCompleted: true });
    expect(settled.status).toBe('resolved');
    expect(settled.open).toBe('no');
    expect(settled.activeRound).toBe(null);
    expect(settled.decisionReasons).toEqual([]);
    expect(settled.rounds).toEqual([{ runRef: ROUND, phase: 'review', round: 1, stateEntry: 1, result: 'finished' }]);
    // F-056: finalisation keeps the create order, the carried digests and each kind.
    expect(settled.items.map(entry => entry.alias)).toEqual([1, 2, 3]);
    expect(settled.items.map(entry => entry.kind)).toEqual(['platform', 'file_edit', 'process']);
    expect(settled.items.map(entry => entry.argumentsDigest)).toEqual([
      'cc4fb23db8d485cbe204bec7148c51f3bf3db0ad96a6a3f63bef847b81d85e64',
      '1b80834b202a21a6e1b4483b69a7d4567634db58922e38bac65e0fb6e6604261',
      '4532fed3b821790f5035b3a4f5ebd2ed2b35f674c6d60e0d80df0ddfdab96b5e',
    ]);
    expect(settled.items.map(entry => entry.observed)).toEqual([
      SEND_OBSERVED, EDIT_OBSERVED,
      { verdict: 'done', by: 'review_round', evidence: 'the shell call was checked by hand',
        roundRunRef: ROUND, crashSuspicion: { verdict: 'unlikely', evidence: 'the command leaves no crash trace' },
        reviewerConclusion: null },
    ]);
  });
});

describe('K3-13 pure: the two-process-item record (unreachable by a real Run)', () => {
  it('K3-13 pure: item 1 keeps done/review_round, item 2 settles undetermined/settlement with the fixed sentence and reasons', () => {
    const first = item(1, 'k3-two-call-1', 'shell', 'process',
      { verdict: 'pending', by: null },
      { command: 'echo first', cwd: null, mode: null, paths: [], pathsOmitted: 0, truncated: false },
      { command: 'echo first' });
    const second = item(2, 'k3-two-call-2', 'shell', 'process',
      { verdict: 'pending', by: null },
      { command: 'echo second', cwd: null, mode: null, paths: [], pathsOmitted: 0, truncated: false },
      { command: 'echo second' });
    const created = build([first, second]);
    expect(created.status).toBe('pending_review');
    // F-056: the two-alias order after create, with the carried digests.
    expect(created.items.map(entry => entry.alias)).toEqual([1, 2]);
    expect(created.items.map(entry => entry.contained)).toEqual([true, true]);
    expect(created.items.map(entry => entry.argumentsDigest)).toEqual([
      '655bd58a5ac06fbca9759fe11e7008942d36793a7d58ef18a0691011d431cac7',
      '779cc2413f047b7426a02da9251061d196ca42e25df7b92cf7760ed32d3b391a',
    ]);
    expect(created.items.map(entry => entry.kind)).toEqual(['process', 'process']);
    expect(created.items.map(entry => entry.observed))
      .toEqual([{ verdict: 'pending', by: null }, { verdict: 'pending', by: null }]);

    const claimed = nextOf(created, { kind: 'round_claimed', runRef: ROUND, phase: 'review', round: 1 });
    const concluded = nextOf(claimed, { kind: 'conclusion_recorded', alias: 1, verdict: 'done',
      evidence: 'the first command finished', roundRunRef: ROUND,
      crashSuspicion: { verdict: 'unlikely', evidence: 'no crash trace' } });
    // The other item still has no conclusion.
    expect(concluded.items[1]!.observed).toEqual({ verdict: 'pending', by: null });

    const settled = nextOf(concluded, { kind: 'settled' }, { activeRunEnded: true, activeRunCompleted: true });
    expect(settled.status).toBe('needs_decision');
    expect(settled.activeRound).toBe(null);
    expect(settled.items).toHaveLength(2);
    // F-056: finalisation keeps the two-alias order and both finalized kinds.
    expect(settled.items.map(entry => entry.alias)).toEqual([1, 2]);
    expect(settled.items.map(entry => entry.kind)).toEqual(['process', 'process']);
    expect(settled.items[0]!.observed).toMatchObject({ verdict: 'done', by: 'review_round',
      evidence: 'the first command finished', roundRunRef: ROUND });
    expect(settled.items[1]!.observed).toMatchObject({
      verdict: 'undetermined', by: 'settlement', evidence: '核对轮没有给出结论',
      crashSuspicion: { verdict: 'undetermined', evidence: '没有自查依据' },
    });
    expect(settled.decisionReasons).toEqual(['undetermined', 'crash_undetermined']);
  });
});
