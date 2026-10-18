/**
 * K3-48 (二) pure proposal budget (F-046): the L7 boundary of the WRITTEN
 * proposal record, moved out of
 * `tests/work-graph/K3-48-2-unknown-call-review-model-text-budget.test.ts`.
 *
 * The shared public path runs one call at a time, so a real record holds at
 * most one process item and can never approach the 158,720-byte creation
 * budget B; that combination belongs in A5. The record here is built by the
 * exported pure `newUnknownCallReview` / `transitionUnknownCallReview` machine
 * only (no store, Host, Workflow, Runtime or fixture), and admission is the
 * exported pure `admitUnknownCallReview`. B and the 2,000-byte reserve are the
 * spec's hand-written literals, never a production constant.
 */
import { describe, expect, it } from 'vitest';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type {
  SaferMethodProposalV1, UnknownCallReviewRef, UnknownCallReviewV1,
} from '../../src/contracts/unknown-call-review.js';
import {
  admitUnknownCallReview, newUnknownCallReview, transitionUnknownCallReview,
  type UnknownCallReviewContextV1,
} from '../../src/core/work-graph/state/unknown-call-review.js';

const AT = '2026-10-20T00:00:00.000Z';
/** K3 L7: 512 KiB - reserve R (365,536) = 158,720. */
const B = 158_720;
const UNAVAILABLE = {
  status: 'unavailable' as const, runBaselineKnown: false, reason: 'not_configured' as const, detail: 'k3-48-2',
};
const bytesOf = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;

/** The ids every exact-size builder fills; the padding never touches them. */
type ReviewRefs = {
  reviewRef: UnknownCallReviewRef;
  workspaceId: string;
  task: { projectId: string; goalId: string; taskId: string };
  originRunRef: RunRef;
  claimRunRef: RunRef;
  sessionId: string;
};

function processItem(alias: number, pathPad: number, firstPathShrink = 0) {
  const callId = `call-${String(alias).padStart(3, '0')}-` + 'c'.repeat(512 - 10);
  const command = 'echo ' + String(alias) + ' ' + 'x'.repeat(512 - 8);
  const paths = Array.from({ length: 8 }, (_, index) => {
    const pad = index === 0 ? pathPad - firstPathShrink : pathPad;
    return `/very/long/long/path/${String(alias)}/${String(index)}/`.padEnd(pad, 'p');
  });
  return {
    alias, callId, toolName: 'shell', kind: 'process' as const, contained: true,
    kernel: { adapterId: 'a', kernelSessionId: 'ks', kernelRunId: 'kr', turnId: 't',
      callId, declaredPosition: alias, startedPosition: alias },
    argumentsDigest: 'd'.repeat(64),
    summary: { command, cwd: null, mode: null, paths, pathsOmitted: 0, truncated: false },
    startedAt: null, observed: { verdict: 'pending' as const, by: null },
  };
}

function ctxOf(revision: number, overrides: Partial<UnknownCallReviewContextV1> = {}): UnknownCallReviewContextV1 {
  return { expectedRevision: revision, updatedAt: AT, actor: { kind: 'human', id: 'u' },
    activeRunEnded: false, activeRunCompleted: false, fenceHumanOnly: false, reviewUnavailable: false,
    autonomy: 'after_plan_confirmation', incompleteCommandAliases: [], missingSelfCheckAliases: [],
    originalRunSelected: false, ...overrides };
}

/** The L9 creation record (no round yet) with `count` exact-size `processItem`s. */
function pendingReview(
  refs: ReviewRefs, count: number, pathPad: number, lastPathShrink = 0,
): UnknownCallReviewV1 {
  const built = newUnknownCallReview({
    ref: refs.reviewRef, workspaceId: refs.workspaceId, task: refs.task, runRef: refs.originRunRef,
    sessionRef: { projectId: refs.reviewRef.projectId, sessionId: refs.sessionId },
    origin: { kind: 'human_attested', attestedBy: { kind: 'human', id: 'u' }, reason: 'K3-48-2' },
    inventory: 'complete', inventoryProblem: null, itemsOmitted: 0, workspace: UNAVAILABLE,
    items: Array.from({ length: count }, (_, index) =>
      processItem(index + 1, pathPad, index === count - 1 ? lastPathShrink : 0)),
    streak: { priorAutoCleanup: false, priorUnknownProcess: false, resetRunRef: null }, createdAt: AT,
  });
  if (!built.ok) throw new Error(JSON.stringify(built));
  return built.next;
}

/**
 * Builds the smallest item count whose 512-byte-field record reaches `target`:
 * the shared path pad is solved linearly (the builder's serialised size grows
 * by exactly 8 bytes per pad character per item), then the first path is
 * trimmed by the rounding remainder so the record is exactly `target` bytes.
 */
function exactSizedRecord(
  target: number,
  build: (count: number, pathPad: number, lastPathShrink: number) => UnknownCallReviewV1,
): UnknownCallReviewV1 {
  let count = 0;
  let pathPad = 0;
  for (let candidate = 1; candidate <= 31; candidate += 1) {
    const sample = build(candidate, 64, 0);
    const base = bytesOf(sample) - 8 * candidate * 64;
    const pad = Math.ceil((target - base) / (8 * candidate));
    if (pad >= 1 && pad <= 512) { count = candidate; pathPad = pad; break; }
  }
  if (count === 0) throw new Error('no legal item count reaches the near-threshold target');
  return build(count, pathPad, bytesOf(build(count, pathPad, 0)) - target);
}

/**
 * The K3-48 (二) proposal predecessor in the PURE machine, no storage: the
 * real `review_unavailable` settlement, the safer-method answer and the
 * proposal-round claim. Only the pure transition table runs here.
 */
function awaitingProposalRecord(
  refs: ReviewRefs, count: number, pathPad: number, lastPathShrink = 0,
): UnknownCallReviewV1 {
  const pending = pendingReview(refs, count, pathPad, lastPathShrink);
  const settled = transitionUnknownCallReview(pending, { kind: 'settled' },
    ctxOf(pending.revision, { reviewUnavailable: true }));
  if (!settled.ok) throw new Error(JSON.stringify(settled));
  const answered = transitionUnknownCallReview(settled.next, {
    kind: 'disposition_applied', choice: 'safer_method', answerMessageRef: null,
    answeredRevision: settled.next.revision, text: 'K3-48-2',
  }, ctxOf(settled.next.revision));
  if (!answered.ok) throw new Error(JSON.stringify(answered));
  const claimed = transitionUnknownCallReview(answered.next, {
    kind: 'round_claimed', runRef: refs.claimRunRef, phase: 'proposal', round: 1,
  }, ctxOf(answered.next.revision));
  if (!claimed.ok) throw new Error(JSON.stringify(claimed));
  return claimed.next;
}

describe('K3-48 (二) pure proposal budget', () => {
  it('K3-48 (二) pure L7 boundary: the recordProposal successor at B is admitted and at B+1 is capacity', () => {
    // The pure L7 boundary. The integration row uses the real small record;
    // this row states the exact arithmetic the shared public path cannot reach
    // (one blocked call leaves at most one process item).
    const refs: ReviewRefs = {
      reviewRef: { aggregateType: 'UnknownCallReview', projectId: 'p', goalId: 'g', runId: 'r' },
      workspaceId: 'w',
      task: { projectId: 'p', goalId: 'g', taskId: 't' },
      originRunRef: { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: 'r' },
      claimRunRef: { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: 'proposal-round' },
      sessionId: 's',
    };
    const record = exactSizedRecord(B - 2_000, (count, pathPad, lastPathShrink) =>
      awaitingProposalRecord(refs, count, pathPad, lastPathShrink));
    expect(bytesOf(record)).toBe(B - 2_000);
    expect(record.status).toBe('awaiting_proposal');
    const proposal = (rationale: string): SaferMethodProposalV1 => ({
      proposalId: 'k3-48-2-pure-proposal', callId: record.items[0]!.callId, alias: 1,
      command: 'echo safer', cwd: null, rationale, roundRunRef: record.activeRound!.runRef,
    });
    const write = (rationale: string): UnknownCallReviewV1 => {
      const result = transitionUnknownCallReview(record, { kind: 'proposal_recorded', proposal: proposal(rationale) },
        ctxOf(record.revision));
      if (!result.ok) throw new Error(JSON.stringify(result));
      return result.next;
    };
    // The write's payload (its fixed proposal fields plus the rationale) is
    // exactly 2,000 bytes, so the successor of the B-2,000 record is B; one
    // more optional byte is B+1.
    const empty = write('');
    const optionalBytes = 2_000 - (bytesOf(empty) - bytesOf(record));
    if (optionalBytes < 1) throw new Error('the proposal payload already exceeds the 2,000-byte reserve');
    const atB = write('x'.repeat(optionalBytes));
    const atB1 = write('x'.repeat(optionalBytes + 1));
    expect(bytesOf(atB)).toBe(B);
    expect(bytesOf(atB1)).toBe(B + 1);

    expect(admitUnknownCallReview(record, { required: false })).toBeNull();
    expect(admitUnknownCallReview(atB, { required: false })).toBeNull();
    expect(admitUnknownCallReview(atB1, { required: false }))
      .toMatchObject({ ok: false, reason: 'guard_failed', code: 'capacity' });
  });
});
