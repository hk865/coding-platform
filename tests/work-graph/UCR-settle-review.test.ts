/**
 * K3 §3.2 UCR-06/07/08c and L16 D6 at the owner level: `settleReview` reads the
 * round's Run (and pointer), reads the writing round's prepared manifest for
 * `display`, and commits exactly one settled/round_unfinished change. Verified
 * through the public write and `readReview` ports.
 *
 * Every prior state is the public K3 chain over `openK3ReviewCardWorld`: the
 * real blocked-Run record (`createK3PendingReview`), the real review claim and
 * Runtime entry (`claimK3ReviewRound`), conclusions through the real UCR-04
 * owner (`recordK3Conclusion`), the Runtime's own end, and the real
 * `settleReview` owner. The `outcome_unknown` round is a real entered Run whose
 * Kernel store is moved aside and read through a fresh Host (start-up
 * reconcile), never a fabricated probe. The D6 display reader is the ONE
 * production wiring (`readExecution` -> `readManifestFromEnvelope`); only its
 * body read can be wrapped to fail.
 */
import { join } from 'node:path';
import { rename } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { UnknownCallReviewRef } from '../../src/contracts/unknown-call-review.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { readManifestFromEnvelope } from '../../src/core/work-graph/tasks/execution-entry-service.js';
import { createUnknownCallReviewService } from '../../src/core/work-graph/tasks/unknown-call-review-service.js';
import { openRealRunHarness } from '../helpers/K3-35-continuation-fixture.js';
import {
  claimK3ReviewRound, createK3PendingReview, endK3RunCompleted, endK3RunUnfinished,
  openK3ReviewCardWorld, readK3Review, recordK3Conclusion,
  type K3ReviewCardWorld,
} from '../helpers/K3-proposal-round.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';

// §5.1's stand-in `shell`, hoisted per test file (the real blocked Run's one call uses it).
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const WORLDS: K3ReviewCardWorld[] = [];
afterEach(async () => {
  shellSeam.release();
  for (const world of WORLDS.splice(0)) await world.close();
});

function settleRequest(reviewRef: UnknownCallReviewRef, cause: 'round_ended' | 'review_unavailable',
  requestId: string, revision: number) {
  return { input: { reviewRef, cause }, meta: { requestId, expected: [{ ref: reviewRef, revision }] } };
}

async function openWorld(kind: 'memory' | 'sqlite'): Promise<K3ReviewCardWorld> {
  const world = await openK3ReviewCardWorld(kind);
  WORLDS.push(world);
  return world;
}

/** The real pending record and its entered review round. */
async function enteredRound(world: K3ReviewCardWorld,
  command = 'npm run build'): Promise<{ pending: Awaited<ReturnType<typeof createK3PendingReview>>;
    round: Awaited<ReturnType<typeof claimK3ReviewRound>> }> {
  const pending = await createK3PendingReview(world, { command, callId: `ucr-settle-call-${world.kind}` });
  const round = await claimK3ReviewRound(world, pending);
  return { pending, round };
}

/**
 * The production settlement owner over the SAME records: the D6 display reader
 * is `src/composition/create-platform.ts`'s `readExecution(roundRunRef)` then
 * `readManifestFromEnvelope({ bodies })`, returning the real per-alias
 * `item.display`. `bodies` is the same real artifact store unless a caller
 * wraps its read to fail once (A2 fault injection).
 */
function settlementOwner(world: K3ReviewCardWorld,
  bodies: Pick<K3ReviewCardWorld['fixture']['bodies'], 'read'> = world.fixture.bodies,
): ReturnType<typeof createUnknownCallReviewService> {
  let sequence = 0;
  const executionReader = createRunStateReader({ records: world.records });
  return createUnknownCallReviewService({
    records: world.records, lookups: world.records, reads: executionReader,
    readReviewDisplays: async (ctx, input) => {
      const read = await executionReader.readExecution(ctx, input.roundRunRef);
      if (read.status === 'not_found') return { status: 'not_found' };
      if (read.status === 'not_ready') {
        return { status: 'not_ready', observed: read.observed, required: read.required };
      }
      if (read.status === 'rejected') return read;
      const envelope = read.value.run.envelope;
      if (envelope === null) return { status: 'not_found' };
      const manifest = await readManifestFromEnvelope({ bodies },
        envelope as unknown as Record<string, unknown>, input.roundRunRef);
      if (!manifest.ok) return manifest.rejection;
      const items = manifest.value.manifest.unknownCallReview?.items ?? [];
      return { status: 'ready', value: new Map(items.map(item => [item.alias, item.display])) };
    },
    now: () => world.fixture.now(),
    eventId: () => `ucr-settle-event-${String(++sequence)}`,
  });
}

describe('UCR settlement owner', () => {
  it.each(['memory', 'sqlite'] as const)('UCR-07 %s: a normally ended round settles to needs_decision with pending items undetermined', async kind => {
    const world = await openWorld(kind);
    const { round } = await enteredRound(world);
    await endK3RunCompleted(world, round.claim);
    const current = await readK3Review(world, round.record.ref);
    expect(current).toMatchObject({ status: 'pending_review', activeRound: { runRef: round.claim.runRef } });
    const result = await world.reviews.settleReview(world.fixture.ctx,
      settleRequest(current.ref, 'round_ended', 'ucr-settle-finished', current.revision) as never);
    expect(result).toMatchObject({ status: 'committed', replayed: false, value: {
      status: 'needs_decision', activeRound: null, open: 'yes', decisionReasons: ['undetermined', 'crash_undetermined'],
      rounds: [{ phase: 'review', round: 1, result: 'finished' }],
      items: [{ alias: 1, observed: {
        verdict: 'undetermined', by: 'settlement', evidence: '核对轮没有给出结论',
        crashSuspicion: { verdict: 'undetermined', evidence: '没有自查依据' },
      } }],
    } });
  });

  it.each(['memory', 'sqlite'] as const)('UCR-07 %s: review_unavailable with no active round settles and names the reason', async kind => {
    const world = await openWorld(kind);
    // The unclaimed pending record IS the third trigger: no round has run yet.
    const pending = await createK3PendingReview(world, { command: 'npm run build', callId: `ucr-settle-idle-${kind}` });
    expect(pending).toMatchObject({ status: 'pending_review', activeRound: null });
    const result = await world.reviews.settleReview(world.fixture.ctx,
      settleRequest(pending.ref, 'review_unavailable', 'ucr-settle-unavailable', pending.revision) as never);
    expect(result).toMatchObject({ status: 'committed', value: {
      status: 'needs_decision', decisionReasons: ['review_unavailable', 'undetermined', 'crash_undetermined'], activeRound: null,
    } });
  });

  it.each(['memory', 'sqlite'] as const)('UCR-06 %s: an outcome_unknown round is busy and writes nothing', async kind => {
    const world = await openWorld(kind);
    const { round } = await enteredRound(world, 'npm run build');
    // The round Run is genuinely entered and in flight. Its Kernel store (the
    // real `s5-kernel.sqlite` file) is moved aside, then a fresh Host
    // (start-up reconcile) probes the REAL Kernel: missing, so RUN-20 ends the
    // Run `outcome_unknown`.
    const kernelPath = join(world.fixture.base.directory, 's5-kernel.sqlite');
    const aside = `${kernelPath}.ucr-missing`;
    await rename(kernelPath, aside);
    let harness: Awaited<ReturnType<typeof openRealRunHarness>> | undefined;
    try {
      harness = await openRealRunHarness(world);
      const unknown = await harness.reconcileUnknown(round.claim);
      expect(unknown, JSON.stringify(unknown)).toMatchObject({ status: 'ended', outcome: 'outcome_unknown' });
    } finally {
      await rename(aside, kernelPath);
      await harness?.closeUnion();
    }
    // Release the gated model; the Run is already ended, so its own terminal is refused.
    await endK3RunCompleted(world, round.claim).catch(() => undefined);
    const current = await readK3Review(world, round.record.ref);
    const before = await world.reviews.readReview(world.fixture.ctx, { ref: current.ref });
    const result = await world.reviews.settleReview(world.fixture.ctx,
      settleRequest(current.ref, 'round_ended', `ucr-settle-unknown-${kind}`, current.revision) as never);
    expect(result).toMatchObject({ status: 'rejected', code: 'busy' });
    expect(await world.reviews.readReview(world.fixture.ctx, { ref: current.ref })).toEqual(before);
  });

  it.each(['memory', 'sqlite'] as const)('UCR-08b %s: a held resolved record settles with the fixed no-conclusion evidence', async kind => {
    const world = await openWorld(kind);
    const { round } = await enteredRound(world, 'npm run build');
    const held = await world.reviews.holdReview(world.fixture.ctx, { input: {
      reviewRef: round.record.ref, text: null,
    }, meta: { requestId: `ucr-settle-hold-${kind}`,
      expected: [{ ref: round.record.ref, revision: round.record.revision }] } });
    expect(held, JSON.stringify(held)).toMatchObject({ status: 'committed', value: {
      status: 'resolved', activeRound: { runRef: round.claim.runRef }, disposition: { hold: 'held' } } });
    if (held.status !== 'committed') throw new Error(JSON.stringify(held));
    await endK3RunUnfinished(world, round.claim);
    const result = await world.reviews.settleReview(world.fixture.ctx,
      settleRequest(held.value.ref, 'round_ended', `ucr-settle-held-${kind}`, held.value.revision) as never);
    expect(result).toMatchObject({ status: 'committed', replayed: false, value: {
      status: 'resolved', activeRound: null, decisionReasons: [],
      disposition: { hold: 'held' },
      rounds: [{ phase: 'review', round: 1, result: 'unfinished' }],
      items: [{ alias: 1, observed: {
        verdict: 'undetermined', by: 'settlement', evidence: '核对轮没有给出结论',
        crashSuspicion: { verdict: 'undetermined', evidence: '没有自查依据' },
      } }],
    } });
  });

  it.each(['memory', 'sqlite'] as const)('L16 D6 %s: a truncated command conclusion is re-judged undetermined with the model text kept', async kind => {
    const world = await openWorld(kind);
    // A command over the 4 KiB manifest budget: the REAL prepare reads the
    // original Kernel call's full command and records `display: truncated` in
    // the round's prepared manifest.
    const longCommand = `echo ${'x'.repeat(5_000)}`;
    const pending = await createK3PendingReview(world, { command: longCommand, callId: `ucr-settle-d6-${kind}` });
    const round = await claimK3ReviewRound(world, pending);
    const concluded = await recordK3Conclusion(world, round, {
      item: 1, verdict: 'done', evidence: 'it ran',
      crashSuspicion: { verdict: 'unlikely', evidence: 'no trace' },
    });
    await endK3RunCompleted(world, round.claim);
    const result = await settlementOwner(world).settleReview(world.fixture.ctx,
      settleRequest(concluded.ref, 'round_ended', 'ucr-settle-d6', concluded.revision) as never);
    expect(result).toMatchObject({ status: 'committed', value: {
      status: 'needs_decision', decisionReasons: ['undetermined', 'crash_undetermined'],
      items: [{ alias: 1, observed: {
        verdict: 'undetermined', by: 'settlement', evidence: '核对说明里没有这条命令的全文，按判断不了处理',
        crashSuspicion: { verdict: 'undetermined', evidence: '命令没给全，自查同样没有依据。' },
        reviewerConclusion: { verdict: 'done', evidence: 'it ran', crashSuspicion: { verdict: 'unlikely', evidence: 'no trace' } },
      } }],
    } });
  });

  it.each(['memory', 'sqlite'] as const)('L16 D6 %s: an unreadable manifest is unavailable and writes nothing', async kind => {
    const world = await openWorld(kind);
    const pending = await createK3PendingReview(world, { command: 'npm run build', callId: `ucr-settle-d6-bad-${kind}` });
    const round = await claimK3ReviewRound(world, pending);
    const concluded = await recordK3Conclusion(world, round, {
      item: 1, verdict: 'done', evidence: 'it ran',
      crashSuspicion: { verdict: 'unlikely', evidence: 'no trace' },
    });
    await endK3RunCompleted(world, round.claim);
    // A2: wrap the REAL artifact store and fail its read once at the manifest boundary.
    let failed = false;
    const bodies = {
      async read(ref: Parameters<K3ReviewCardWorld['fixture']['bodies']['read']>[0]) {
        if (!failed) {
          failed = true;
          return { status: 'rejected' as const, code: 'unavailable' as const,
            reason: 'injected manifest body read failure' };
        }
        return await world.fixture.bodies.read(ref);
      },
    };
    const before = await world.reviews.readReview(world.fixture.ctx, { ref: concluded.ref });
    const result = await settlementOwner(world, bodies).settleReview(world.fixture.ctx,
      settleRequest(concluded.ref, 'round_ended', 'ucr-settle-d6-bad', concluded.revision) as never);
    expect(result).toMatchObject({ status: 'rejected', code: 'unavailable' });
    expect(await world.reviews.readReview(world.fixture.ctx, { ref: concluded.ref })).toEqual(before);
  });
});

// -------------------------------------------------------------------------- //
// K3-10: conclusion × crash self-check, the 12 literal cells (L17)            //
// -------------------------------------------------------------------------- //

type K310Reason = 'partial' | 'undetermined' | 'crash_possible' | 'crash_undetermined';
type K310Cell = {
  verdict: 'done' | 'not_done' | 'partial' | 'undetermined';
  crash: 'unlikely' | 'possible' | 'undetermined';
  /** The literal, hand-computed `decisionReasons` in L17's fixed order. */
  reasons: readonly K310Reason[];
};

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

describe('K3-10 conclusion × crash self-check settlement matrix', () => {
  for (const kind of ['memory', 'sqlite'] as const) {
    it.each(K3_10_CELLS)(`K3-10 ${kind} $verdict+$crash`, async cell => {
      // One real process item and one real review round per cell; the Goal
      // reads the default `after_plan_confirmation` and the streak has no
      // prior unknown process, so neither `confirm_each_step` nor
      // `second_consecutive` may appear.
      const world = await openWorld(kind);
      const { round } = await enteredRound(world);
      const concluded = await recordK3Conclusion(world, round, {
        item: 1, verdict: cell.verdict, evidence: `K3-10 evidence for ${cell.verdict}`,
        crashSuspicion: { verdict: cell.crash, evidence: `K3-10 self-check for ${cell.crash}` },
      });
      await endK3RunCompleted(world, round.claim);
      const status = cell.reasons.length === 0 ? 'resolved' : 'needs_decision';
      const result = await settlementOwner(world).settleReview(world.fixture.ctx,
        settleRequest(concluded.ref, 'round_ended', `k3-10-${kind}-${cell.verdict}-${cell.crash}`,
          concluded.revision) as never);
      expect(result).toMatchObject({ status: 'committed', replayed: false,
        value: { status, decisionReasons: cell.reasons, activeRound: null,
          items: [{ alias: 1, observed: { verdict: cell.verdict, crashSuspicion: { verdict: cell.crash } } }] } });
      const read = await world.reviews.readReview(world.fixture.ctx, { ref: concluded.ref });
      if (read.status !== 'ready') throw new Error(`K3-10 readReview: ${JSON.stringify(read)}`);
      expect(read.value.status).toBe(status);
      expect(read.value.decisionReasons).toEqual(cell.reasons);
      expect(read.value.open).toBe(status === 'resolved' ? 'no' : 'yes');
      expect(read.value.items[0]?.observed).toMatchObject({ verdict: cell.verdict,
        crashSuspicion: { verdict: cell.crash } });
    });
  }
});
