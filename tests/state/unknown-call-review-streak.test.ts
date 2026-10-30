/**
 * K3-32 (R5): the L23 "consecutive" algorithm `streakOf` (U5). The eleven
 * examples of L23 (1, 2, 3, 3b, 3c, 4–9) are written out with literal expected
 * flags; the review records are minimal stubs because only `runRef` and the
 * items' kinds are read.
 */
import { describe, expect, it } from 'vitest';
import type { RunReconciliationV1, RunRef, RunSnapshot } from '../../src/contracts/dispatch.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import { streakOf } from '../../src/core/work-graph/state/task-failure.js';

const P = 'p', G = 'g';
const ref = (runId: string): RunRef => ({ aggregateType: 'Run', projectId: P, goalId: G, runId });

type RunSpec = {
  runId: string;
  from?: { runId: string };
  waitFrom?: string;
  reconciliation?: RunReconciliationV1['observation']['kind'];
};

function runOf(spec: RunSpec): RunSnapshot {
  const reconciliation = spec.reconciliation === undefined ? undefined : {
    status: spec.reconciliation === 'takeover_unresolved' ? 'done' : spec.reconciliation === 'unresolved' ? 'quarantined' : 'done',
    observation: { kind: spec.reconciliation } as RunReconciliationV1['observation'],
    basis: { kind: 'live_clean' }, recordedAt: '2026-10-16T00:00:00.000Z',
  } as unknown as RunReconciliationV1;
  return {
    ref: ref(spec.runId), status: 'ended',
    ...(spec.from === undefined ? {} : { requeueRef: { aggregateType: 'TaskRequeue', projectId: P, goalId: G,
      taskId: 't', afterRunId: spec.from.runId } }),
    previousRun: spec.waitFrom === undefined ? null : ref(spec.waitFrom),
    ...(reconciliation === undefined ? {} : { reconciliation }),
  } as unknown as RunSnapshot;
}

function reviewOf(runId: string, kinds: Array<'process' | 'platform' | 'read_only' | 'file_edit'>): UnknownCallReviewV1 {
  return { runRef: ref(runId), items: kinds.map(kind => ({ kind })) } as unknown as UnknownCallReviewV1;
}

/** RUN-25: ended crashed with a takeover_unresolved observation. */
const RUN25 = 'takeover_unresolved';
/** RUN-19/24: platform-synthesized clean interruption. */
const CLEAN_INTERRUPT = 'interrupted_clean';
/** RUN-07/17/18/21: Kernel-written terminal. */
const KERNEL_TERMINAL = 'runtime_terminal';
/** RUN-22: human attestation. */
const ATTESTED = 'human_attested';

function streak(runs: RunSpec[], target: string, reviews: UnknownCallReviewV1[]) {
  const built = runs.map(runOf);
  const targetRun = built.find(r => r.ref.runId === target);
  if (targetRun === undefined) throw new Error(`missing target ${target}`);
  return streakOf(targetRun, built, reviews);
}

describe('K3-32 consecutive algorithm', () => {
  it('K3-32 #1: a prior RUN-25 with a process record marks both flags', () => {
    expect(streak([
      { runId: 'a', reconciliation: RUN25 },
      { runId: 'b', from: { runId: 'a' }, reconciliation: CLEAN_INTERRUPT },
    ], 'b', [reviewOf('a', ['process'])])).toMatchObject({ priorAutoCleanup: true, priorUnknownProcess: true });
  });

  it('K3-32 #1b: a RUN-25 after a Kernel terminal is judged, and the reset point is that terminal', () => {
    // X runtime_terminal -> A RUN-25 -> B: the walk stops at X (exclusive) but
    // still judges A, the RUN-25 between X and B.
    expect(streak([
      { runId: 'x', reconciliation: KERNEL_TERMINAL },
      { runId: 'a', from: { runId: 'x' }, reconciliation: RUN25 },
      { runId: 'b', from: { runId: 'a' }, reconciliation: CLEAN_INTERRUPT },
    ], 'b', [reviewOf('a', ['process'])])).toMatchObject({
      priorAutoCleanup: true, priorUnknownProcess: true, resetRunRef: ref('x'),
    });
  });

  it('K3-32 #2: a Kernel terminal resets both flags', () => {
    expect(streak([
      { runId: 'a', reconciliation: RUN25 },
      { runId: 'b', from: { runId: 'a' }, reconciliation: KERNEL_TERMINAL },
      { runId: 'c', from: { runId: 'b' }, reconciliation: CLEAN_INTERRUPT },
    ], 'c', [reviewOf('a', ['process']), reviewOf('b', ['process'])])).toMatchObject({
      priorAutoCleanup: false, priorUnknownProcess: false, resetRunRef: ref('b'),
    });
  });

  it('K3-32 #3 and #3b: a prior disposition is not a reset point', () => {
    const reviewed = [reviewOf('a', ['process'])];
    expect(streak([{ runId: 'a', reconciliation: RUN25 }, { runId: 'b', from: { runId: 'a' }, reconciliation: CLEAN_INTERRUPT }],
      'b', reviewed)).toMatchObject({ priorAutoCleanup: true, priorUnknownProcess: true });
    expect(streak([{ runId: 'a', reconciliation: RUN25 }, { runId: 'b', from: { runId: 'a' }, reconciliation: CLEAN_INTERRUPT }],
      'b', reviewed)).toMatchObject({ priorAutoCleanup: true, priorUnknownProcess: true });
  });

  it('K3-32 #3c: a normal completion after the disposition resets', () => {
    expect(streak([
      { runId: 'a', reconciliation: RUN25 },
      { runId: 'b', from: { runId: 'a' }, reconciliation: KERNEL_TERMINAL },
      { runId: 'c', from: { runId: 'b' }, reconciliation: CLEAN_INTERRUPT },
    ], 'c', [reviewOf('a', ['process'])])).toMatchObject({ priorAutoCleanup: false, priorUnknownProcess: false });
  });

  it('K3-32 #4: a clean platform interruption is not a reset point', () => {
    expect(streak([
      { runId: 'a', reconciliation: RUN25 },
      { runId: 'b', from: { runId: 'a' }, reconciliation: CLEAN_INTERRUPT },
      { runId: 'c', from: { runId: 'b' }, reconciliation: CLEAN_INTERRUPT },
    ], 'c', [reviewOf('a', ['process'])])).toMatchObject({ priorAutoCleanup: true, priorUnknownProcess: true });
  });

  it('K3-32 #5: a review round is not on the chain', () => {
    // The chain is a -> b; the review round "r" reads no requeueRef and is ignored.
    expect(streak([
      { runId: 'a', reconciliation: RUN25 },
      { runId: 'r' },
      { runId: 'b', from: { runId: 'a' }, reconciliation: CLEAN_INTERRUPT },
    ], 'b', [reviewOf('a', ['process'])])).toMatchObject({ priorAutoCleanup: true, priorUnknownProcess: true });
  });

  it('K3-32 #6: a yielded Kernel terminal resets', () => {
    expect(streak([
      { runId: 'a', reconciliation: KERNEL_TERMINAL },
      { runId: 'b', waitFrom: 'a', reconciliation: CLEAN_INTERRUPT },
    ], 'b', [])).toMatchObject({ priorAutoCleanup: false, priorUnknownProcess: false, resetRunRef: ref('a') });
  });

  it('K3-32 #7: an attested Run is not RUN-25 but its process record still marks priorUnknownProcess', () => {
    expect(streak([
      { runId: 'a', reconciliation: ATTESTED },
      { runId: 'b', from: { runId: 'a' }, reconciliation: CLEAN_INTERRUPT },
    ], 'b', [reviewOf('a', ['process'])])).toMatchObject({ priorAutoCleanup: false, priorUnknownProcess: true });
  });

  it('K3-32 #8: the chain follows Run refs, not Sessions', () => {
    expect(streak([
      { runId: 'a', reconciliation: RUN25 },
      { runId: 'b', from: { runId: 'a' }, reconciliation: CLEAN_INTERRUPT },
    ], 'b', [reviewOf('a', ['process'])])).toMatchObject({ priorAutoCleanup: true, priorUnknownProcess: true });
  });

  it('K3-32 #9: a RUN-25 with only a platform call marks priorAutoCleanup but not priorUnknownProcess', () => {
    expect(streak([
      { runId: 'a', reconciliation: RUN25 },
      { runId: 'b', from: { runId: 'a' }, reconciliation: CLEAN_INTERRUPT },
    ], 'b', [reviewOf('a', ['platform'])])).toMatchObject({ priorAutoCleanup: true, priorUnknownProcess: false });
  });
});
