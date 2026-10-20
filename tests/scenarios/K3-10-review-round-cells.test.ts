/**
 * K3-10 (L17, spec §5.2 line 1424; R2) and K3-48 (二) (L14/M3, line 1440; R2).
 *
 * K3-10: the 12 conclusion × crash-self-check cells, each settled through a REAL
 * review round (the K3-05 chain): RUN-25 creates a `pending_review` record with
 * one `process` item from a `shell` call left in flight; a scripted review Run
 * calls `record_unknown_call_review` with that cell's verdict/self-check and
 * ends; `settle_review` commits; the result is read back through
 * `unknown-call-reviews/read`. The literal `decisionReasons` (L17 order) and the
 * status come from the K3-10 row. The Goal reads the default
 * `after_plan_confirmation` and there is no consecutive streak, so neither
 * `confirm_each_step` nor `second_consecutive` may appear.
 *
 * K3-48 (二): one R2 case for capacity as the tool result (below).
 *
 * Scripted model only; the read-only capability is the KE6 probe stand-in and
 * `shell` is the blocking seam (no host process).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { cleanupScenarios, HostScenario, hostCtx, performs } from './harness.js';
import { preparedOf, redrivePolicy } from './support/common.js';
import { driveReviewUntil, openReviewWorkRoot } from './support/review-work-root.js';
import { crashOneCommand } from './support/review-card-round.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { cleanupRestart, readExecution } from '../helpers/A2-restart-fixture.js';
import { AG2B_CONSUMER_ID, AG2B_GOAL_REF, AG2B_SCOPE, AG2B_WORK_TASK_ID, plain } from '../helpers/AG2b-collaboration-fixture.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import { decisionSourceKey } from '../../src/contracts/goal-decisions.js';
import type { DecisionCardV1, DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';

// The KE6 stand-in: `reviewCapability` reads `ProcessSandbox.probe` with the
// read-only options; no host process runs.
const sandbox = vi.hoisted(() => ({ available: true as boolean }));
vi.mock('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js')>();
  const { createProcessSandboxStandin } = await import('./support/process-sandbox-standin.js');
  return { ...actual, ProcessSandbox: createProcessSandboxStandin(actual, sandbox) };
});

// The blocking `shell` stand-in (K3 §5.1): keeps the call in flight until the crash.
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return {
    ...actual,
    createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
      (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg),
  };
});
seams.shellSeam = shellSeam;

afterEach(async () => {
  shellSeam.release();
  sandbox.available = true;
  await cleanupScenarios();
  await cleanupRestart();
});

function reviewOf(h: HostScenario, runRef: RunRef): Promise<ReadResult<UnknownCallReviewV1>> {
  return h.post<ReadResult<UnknownCallReviewV1>>('unknown-call-reviews/read', plain(AG2B_SCOPE, { runRef }));
}

/** The K3-20 card read: the public queue on the same scenario Host. */
function queueOf(h: HostScenario): Promise<DecisionQueueReadV1> {
  return h.post<ReadResult<DecisionQueueReadV1>>('decisions/queue',
    plain(AG2B_SCOPE, { workspace: AG2B_SCOPE, sections: ['waiting_answer'], page: { limit: 100 } }))
    .then((read) => {
      if (read.status !== 'ready') throw new Error(`the decision queue is not readable: ${JSON.stringify(read)}`);
      return read.value;
    });
}

/** The card of exactly this record revision, or undefined when none is waiting. */
function cardOf(queue: DecisionQueueReadV1, record: UnknownCallReviewV1): DecisionCardV1 | undefined {
  const key = decisionSourceKey({ kind: 'unknown_call_review', reviewRef: record.ref, revision: record.revision });
  return queue.waitingAnswer.find(card => card.source.key === key);
}

type K310Reason = 'partial' | 'undetermined' | 'crash_possible' | 'crash_undetermined';
type K310Cell = {
  verdict: 'done' | 'not_done' | 'partial' | 'undetermined';
  crash: 'unlikely' | 'possible' | 'undetermined';
  /** The literal, hand-computed `decisionReasons` in L17's fixed order. */
  reasons: readonly K310Reason[];
};

/** The K3-10 row, 4×3, in the spec's order. */
const K3_10_CELLS: readonly K310Cell[] = [
  { verdict: 'done', crash: 'unlikely', reasons: [] },
  { verdict: 'done', crash: 'possible', reasons: ['crash_possible'] },
  { verdict: 'done', crash: 'undetermined', reasons: ['crash_undetermined'] },
  { verdict: 'not_done', crash: 'unlikely', reasons: [] },
  { verdict: 'not_done', crash: 'possible', reasons: ['crash_possible'] },
  { verdict: 'not_done', crash: 'undetermined', reasons: ['crash_undetermined'] },
  { verdict: 'partial', crash: 'unlikely', reasons: ['partial'] },
  { verdict: 'partial', crash: 'possible', reasons: ['partial', 'crash_possible'] },
  { verdict: 'partial', crash: 'undetermined', reasons: ['partial', 'crash_undetermined'] },
  { verdict: 'undetermined', crash: 'unlikely', reasons: ['undetermined'] },
  { verdict: 'undetermined', crash: 'possible', reasons: ['undetermined', 'crash_possible'] },
  { verdict: 'undetermined', crash: 'undetermined', reasons: ['undetermined', 'crash_undetermined'] },
];

/** The real review round for one cell, then `settle_review`. */
async function runReviewCell(h: HostScenario, cell: K310Cell): Promise<void> {
  const label = `k3-10-${cell.verdict}-${cell.crash}`;
  const crashed = await crashOneCommand(h, { callId: `${label}-shell`, select: label,
    requestId: `${label}-start`, shellArgs: { command: `${label} runs a program` } });
  await crashed.release();
  const originalRunRef = crashed.runRef;

  const created = await reviewOf(h, originalRunRef);
  expect(created.status).toBe('ready');
  if (created.status !== 'ready') return;
  expect(created.value).toMatchObject({ status: 'pending_review', decisionReasons: [] });
  expect(created.value.items).toHaveLength(1);
  expect(created.value.items[0]).toMatchObject({ alias: 1, kind: 'process' });

  const modelReview = createScriptedModel([
    { kind: 'calls', calls: [{ callId: `${label}-conclusion`, name: 'record_unknown_call_review',
      args: { item: 1, verdict: cell.verdict, evidence: `K3-10 evidence for ${cell.verdict}`,
        crashSuspicion: { verdict: cell.crash, evidence: `K3-10 self-check for ${cell.crash}` } } }] },
    { kind: 'text', text: `K3-10 ${label} review round wrote its conclusion` },
  ]);
  const reviewRoot = await openReviewWorkRoot(h, modelReview);
  try {
    const startStop = await driveReviewUntil(reviewRoot, h.select(`${label}-review`, AG2B_WORK_TASK_ID),
      performs('start'));
    const prepared = preparedOf(startStop.stopped);
    await reviewRoot.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID,
      requestId: `${label}-review-start` });

    // `settle_review` runs here; the resolved cells then requeue the original Task
    // (stop before that requeue so the default Host model is never asked to run it).
    await h.advance(h.select(`${label}-settle`, AG2B_WORK_TASK_ID), { stopBefore: performs('requeue_task') });

    const settled = await reviewOf(h, originalRunRef);
    expect(settled.status).toBe('ready');
    if (settled.status !== 'ready') return;
    const status = cell.reasons.length === 0 ? 'resolved' : 'needs_decision';
    expect(settled.value.status).toBe(status);
    expect(settled.value.decisionReasons).toEqual(cell.reasons);
    expect(settled.value.activeRound).toBe(null);
    expect(settled.value.items[0]).toMatchObject({ alias: 1, kind: 'process',
      observed: { verdict: cell.verdict, by: 'review_round', crashSuspicion: { verdict: cell.crash } } });

    // K3-10 card part (L17/L18): a record with reasons is `needs_decision` and
    // its card is in the queue; a no-reason record is `resolved` and has none.
    const queue = await queueOf(h);
    const card = cardOf(queue, settled.value);
    if (cell.reasons.length === 0) {
      expect(card, 'a resolved record has no card').toBeUndefined();
      expect(queue.waitingAnswer.filter(entry => entry.source.kind === 'unknown_call_review'),
        'no review card at all for the resolved cell').toHaveLength(0);
    } else {
      expect(card, 'the needs_decision record has its card').toBeDefined();
      expect(card).toMatchObject({ state: 'waiting_answer', readOnly: false, actions: ['answer'],
        source: { kind: 'unknown_call_review', goalRef: { goalId: AG2B_GOAL_REF.goalId } },
        options: [{ id: 'rerun_as_is' }, { id: 'safer_method' }, { id: 'skip_as_done' }, { id: 'handle_myself' }] });
      expect(queue.capabilities).toContainEqual({ source: 'unknown_call_review', availability: 'available' });
    }
  } finally {
    await reviewRoot.close();
  }
}

describe('K3-10 conclusion × crash self-check through a real review round', () => {
  it.each(K3_10_CELLS)('K3-10 $verdict+$crash settles to the literal L17 cell',
    async cell => {
      const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
      await runReviewCell(h, cell);
    }, 180_000);
});

/** The JSON `record_unknown_call_review` result the model saw for `callId`, if any. */
function reviewToolValue(requests: readonly ModelRequest[], callId: string): unknown {
  for (const request of requests) {
    for (const message of request.messages) {
      if (message.role !== 'tool' || message.callId !== callId) continue;
      const output = (message.result as { output?: readonly { kind: string; value?: unknown }[] }).output ?? [];
      for (const part of output) if (part.kind === 'json') return part.value;
    }
  }
  return undefined;
}

describe('K3-48 (二) capacity as a real review-round tool result', () => {
  it('K3-48 (二): a near-threshold record rejects long evidence with capacity (record unchanged) and accepts a short one',
    async () => {
      const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
      const label = 'k3-48-2';
      // One long command in flight. Its `cwd` draft field is the legal input that
      // gets the RUN-25 record close to the 512 KiB - R creation budget without
      // dropping the single item (the creation budget clamps the Kernel-order
      // inventory; a single `shell` item with a long command alone stays far
      // below it). 155,169 bytes of `cwd` + the ~2,551-byte record overhead lands
      // ~1,000 bytes under B.
      const crashed = await crashOneCommand(h, { callId: `${label}-shell`, select: label,
        requestId: `${label}-start`,
        shellArgs: { command: `${label} runs a program`, cwd: 'p'.repeat(155_169) } });
      await crashed.release();
      const originalRunRef = crashed.runRef;

      const before = await reviewOf(h, originalRunRef);
      expect(before.status).toBe('ready');
      if (before.status !== 'ready') return;
      expect(before.value.items).toHaveLength(1);
      expect(before.value.items[0]).toMatchObject({ alias: 1, kind: 'process' });
      const size = Buffer.byteLength(JSON.stringify(before.value), 'utf8');
      // The setup really sits near the threshold and under it (the admission rule
      // is the WRITTEN record's serialised UTF-8 size, R = 365,536). The
      // `evidence` the model may send is capped at 2000 characters, so the record
      // must be close enough for a legal write to cross B.
      // K3 L7 budget table: 512 KiB - reserve R (365,536) = 158,720. The literal
      // is the spec's; a drift in the production constant fails this test.
      const margin = 158_720 - size;
      expect(margin).toBeGreaterThan(0);
      expect(margin).toBeLessThan(1_600);

      const longEvidence = 'x'.repeat(margin + 400);
      const shortEvidence = 'y'.repeat(50);
      expect(longEvidence.length).toBeLessThanOrEqual(2_000);
      // A box (not bare `let`s) because the reads happen inside the scripted
      // model's async callback; TypeScript does not track those assignments.
      const snapshots: { atStart: UnknownCallReviewV1 | null; afterLong: UnknownCallReviewV1 | null } =
        { atStart: null, afterLong: null };
      const modelReview = createScriptedModel([
        { kind: 'calls', calls: [{ callId: `${label}-long`, name: 'record_unknown_call_review',
          args: { item: 1, verdict: 'done', evidence: longEvidence,
            crashSuspicion: { verdict: 'unlikely', evidence: 'no crash trace' } } }] },
        { kind: 'calls', calls: [{ callId: `${label}-short`, name: 'record_unknown_call_review',
          args: { item: 1, verdict: 'done', evidence: shortEvidence,
            crashSuspicion: { verdict: 'unlikely', evidence: 'no crash trace' } } }] },
        { kind: 'text', text: 'K3-48 (二) review round wrote its conclusion' },
      ], async (_request, index) => {
        // index 0: the record the round claimed and started from; index 1: after
        // the capacity-refused long write, before the short one.
        const read = await reviewOf(h, originalRunRef);
        if (read.status !== 'ready') return;
        if (index === 0) snapshots.atStart = read.value;
        if (index === 1) snapshots.afterLong = read.value;
      });
      const reviewRoot = await openReviewWorkRoot(h, modelReview);
      try {
        const startStop = await driveReviewUntil(reviewRoot, h.select(`${label}-review`, AG2B_WORK_TASK_ID),
          performs('start'));
        const prepared = preparedOf(startStop.stopped);
        await reviewRoot.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID,
          requestId: `${label}-review-start` });

        // The long write crossed B and the model saw `capacity`.
        expect(reviewToolValue(modelReview.requests, `${label}-long`)).toMatchObject({
          status: 'rejected', code: 'capacity' });

        // Byte-for-byte unchanged: equal to the claimed record the round started
        // from, not to the pre-claim one (the claim itself moved `activeRound`).
        expect(snapshots.atStart).not.toBeNull();
        expect(snapshots.afterLong).not.toBeNull();
        expect(JSON.stringify(snapshots.afterLong)).toBe(JSON.stringify(snapshots.atStart));

        // The short write is admitted: exactly one revision after the claim, with
        // the short evidence (L14).
        const accepted = await reviewOf(h, originalRunRef);
        expect(accepted.status).toBe('ready');
        if (accepted.status !== 'ready') return;
        expect(snapshots.atStart?.activeRound).not.toBeNull();
        expect(accepted.value.revision).toBe((snapshots.atStart as UnknownCallReviewV1).revision + 1);
        expect(accepted.value.items[0]).toMatchObject({ alias: 1,
          observed: { verdict: 'done', by: 'review_round', evidence: shortEvidence } });

        // B3 (L14 回执): a successful `record_unknown_call_review` returns a BOUNDED
        // receipt, never the whole record. At this size the whole record exceeds the
        // tool's 64 KiB `outputLimitBytes`, which is what made the Kernel reject the
        // result and end the round `outcome_unknown` before the fix.
        const shortReceipt = reviewToolValue(modelReview.requests, `${label}-short`) as
          { status: string; item: number; revision: number; receipt: unknown; replayed: boolean };
        expect(shortReceipt).toMatchObject({ status: 'committed', item: 1 });
        expect(typeof shortReceipt.revision).toBe('number');
        expect(shortReceipt.receipt).toBeTruthy();
        expect(shortReceipt.replayed).toBe(false);
        expect(Buffer.byteLength(JSON.stringify(shortReceipt), 'utf8')).toBeLessThan(4_096);

        // The review round Run really ended: a known `completed` outcome, not
        // `outcome_unknown` from a rejected oversized tool result.
        const roundRunRef = prepared.claim.runRef;
        expect((await readExecution(h.host, roundRunRef)).run.outcome).toBe('completed');

        // Then settle: no active round, and D6's own state applies. This record's
        // 155 KB `cwd` has no full text in the review note, so settlement re-judges
        // the observed verdict and self-check `undetermined` (the done+unlikely
        // model conclusion is kept verbatim in `reviewerConclusion`), which needs a
        // decision.
        await h.advance(h.select(`${label}-settle`, AG2B_WORK_TASK_ID), { stopBefore: performs('requeue_task') });
        const settled = await reviewOf(h, originalRunRef);
        expect(settled.status).toBe('ready');
        if (settled.status !== 'ready') return;
        expect(settled.value.activeRound).toBe(null);
        expect(settled.value.items[0]).toMatchObject({ alias: 1, kind: 'process',
          observed: {
            verdict: 'undetermined', by: 'settlement',
            crashSuspicion: { verdict: 'undetermined' },
            reviewerConclusion: { verdict: 'done', evidence: shortEvidence,
              crashSuspicion: { verdict: 'unlikely' } },
          } });
        expect(settled.value.status).toBe('needs_decision');
        expect(settled.value.decisionReasons).toEqual(['undetermined', 'crash_undetermined']);
      } finally {
        await reviewRoot.close();
      }
    }, 180_000);
});

