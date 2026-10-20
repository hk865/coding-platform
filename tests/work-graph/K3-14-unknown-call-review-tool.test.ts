/**
 * K3 row K3-14 (R2 owner level, L14): the `record_unknown_call_review` tool's
 * owner write `recordConclusion`.
 *
 * Every prior state comes from the public K3 chain: the real blocked-Run
 * record (`createK3PendingReview`), the real review claim/prepare/Runtime entry
 * (`claimK3ReviewRound`), conclusions through the real `recordConclusion`, the
 * Runtime's own end, and the real `settleReview`. Verified through the public
 * write port and read back through the public `readReview` port; no assertion
 * reads the record store directly. Expected values are literal from L14: a new
 * call overwrites the conclusion, a missing alias is `invalid`, replay and
 * idempotency conflict are proven through the real tool adapter (which sends
 * `expected: []` exactly as production does), and a write after settlement is
 * `stale`. Memory and SQLite each once.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { UnknownCallReviewRef } from '../../src/contracts/unknown-call-review.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createUnknownCallReviewService } from '../../src/core/work-graph/tasks/unknown-call-review-service.js';
import {
  RECORD_UNKNOWN_CALL_REVIEW_TOOL_NAME, createUnknownCallReviewTools,
} from '../../src/core/agent-runtime/unknown-call-review-tools.js';
import { synchronizeB2Commits } from '../helpers/B2-execution-fixture.js';
import {
  claimK3ReviewRound, createK3PendingReview, endK3RunCompleted, openK3ReviewCardWorld,
  recordK3Conclusion, settleK3Review, type K3ReviewCardWorld, type K3Round,
} from '../helpers/K3-proposal-round.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';

// §5.1's stand-in `shell`, hoisted per test file (the real Run's one call uses it).
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const AT = '2026-10-20T00:00:00.000Z';

type Fx = {
  world: K3ReviewCardWorld;
  reviews: ReturnType<typeof createUnknownCallReviewService>;
  reviewRef: UnknownCallReviewRef;
  round: K3Round;
};

const worlds: K3ReviewCardWorld[] = [];
afterEach(async () => {
  shellSeam.release();
  for (const world of worlds.splice(0)) await world.close();
});

async function ready(kind: 'memory' | 'sqlite'): Promise<Fx> {
  const world = await openK3ReviewCardWorld(kind);
  // Registered for cleanup as soon as it opens, so a failure mid-chain cannot leak it.
  worlds.push(world);
  const pending = await createK3PendingReview(world);
  const round = await claimK3ReviewRound(world, pending);
  return { world, reviews: world.reviews, reviewRef: round.record.ref, round };
}

function conclusionRequest(reviewRef: UnknownCallReviewRef, requestId: string, revision: number,
  verdict: 'done' | 'not_done' | 'partial' | 'undetermined', evidence: string, item = 1) {
  return {
    input: { reviewRef, item, verdict, evidence,
      crashSuspicion: { verdict: 'unlikely' as const, evidence: 'no crash' } },
    meta: { requestId, expected: [{ ref: reviewRef, revision }] },
  };
}

describe('K3-14 recordConclusion owner', () => {
  it.each(['memory', 'sqlite'] as const)('K3-14 %s: a new call overwrites the same item conclusion; the last commit wins', async kind => {
    const fx = await ready(kind);
    // Hand count of the record's commits on the real chain (each committed
    // write of the record adds 1): RUN-22 `resolveUnknownRun` creates it at
    // revision 1 (createK3PendingReview with dispose: false writes nothing
    // more); the UCR-03 review claim writes `activeRound` in the claim commit
    // -> 2; the Runtime entry only guards the record's revision -> still 2.
    const start = fx.round.record.revision;
    expect(start).toBe(2);
    const first = await fx.reviews.recordConclusion(fx.round.context,
      conclusionRequest(fx.reviewRef, 'k3-14-call-1', start, 'done', 'first') as never);
    // 2 + the first conclusion's commit = 3.
    expect(first).toMatchObject({ status: 'committed', value: { revision: 3 } });
    const second = await fx.reviews.recordConclusion(fx.round.context,
      conclusionRequest(fx.reviewRef, 'k3-14-call-2', 3, 'not_done', 'second') as never);
    // 3 + the second conclusion's commit = 4.
    expect(second).toMatchObject({ status: 'committed', value: { revision: 4 } });
    const read = await fx.reviews.readReview(fx.round.context, { ref: fx.reviewRef });
    expect(read).toMatchObject({ status: 'ready', value: { revision: 4, items: [{ alias: 1,
      observed: { verdict: 'not_done', by: 'review_round', evidence: 'second' } }] } });
  });

  it('K3-14 canonicalJson is stable for a review ref (fixture sanity)', () => {
    expect(canonicalJson({ aggregateType: 'UnknownCallReview', projectId: 'p', goalId: 'g', runId: 'r' } as unknown as JsonValue))
      .toContain('UnknownCallReview');
  });
});

describe('rejects: the review tool owner refuses an alias outside the record', () => {
  it.each(['memory', 'sqlite'] as const)('K3-14 %s: a missing alias is invalid_arguments and writes nothing', async kind => {
    const fx = await ready(kind);
    const before = await fx.reviews.readReview(fx.round.context, { ref: fx.reviewRef });
    const missing = await fx.reviews.recordConclusion(fx.round.context,
      conclusionRequest(fx.reviewRef, 'k3-14-call-1', fx.round.record.revision, 'done', 'x', 9) as never);
    expect(missing).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await fx.reviews.readReview(fx.round.context, { ref: fx.reviewRef })).toEqual(before);
  });
});

// --------------------------------------------------------------------------
// R5: replay and idempotency conflict cannot come from a scripted model, so
// they are proven through the REAL tool adapter over the REAL owner (never a
// stub), with the owner doing the record read/guard (L14 order).
// --------------------------------------------------------------------------

const adapterArgs = {
  item: 1, verdict: 'done' as const, evidence: 'I ran it; output matched',
  crashSuspicion: { verdict: 'unlikely' as const, evidence: 'no crash left behind' },
};

/** The real adapter over the real owner, with a spy on the public readReview. */
function reviewTool(fx: Fx) {
  const reads: unknown[] = [];
  const reviews = {
    readReview: async (ctx: CoreCallContext, input: unknown) => {
      reads.push(input);
      return fx.reviews.readReview(ctx, input as never);
    },
    recordConclusion: async (ctx: CoreCallContext, request: unknown) =>
      fx.reviews.recordConclusion(ctx, request as never),
  };
  const handle = createUnknownCallReviewTools({
    reviews: reviews as never, context: fx.round.context, reviewRef: fx.reviewRef,
    requestIdForCall: call => `k3-14-adapter:${call.callId}`,
  });
  const definition = handle.create({} as never).find(def => def.name === RECORD_UNKNOWN_CALL_REVIEW_TOOL_NAME);
  if (definition === undefined) throw new Error('record_unknown_call_review is not registered');
  return { definition, reads };
}

async function runTool(definition: ReturnType<typeof reviewTool>['definition'],
  callId: string, args: unknown): Promise<Record<string, unknown>> {
  return await definition.handler.execute(
    { schemaVersion: 1, callId, name: RECORD_UNKNOWN_CALL_REVIEW_TOOL_NAME, arguments: args as never },
    { signal: new AbortController().signal }) as Record<string, unknown>;
}

/** The owner write result the adapter preserved verbatim in the JSON output. */
function toolValue(result: Record<string, unknown>): Record<string, unknown> {
  const output = result['output'] as Array<{ kind: string; value?: unknown }>;
  expect(output).toHaveLength(1);
  const first = output[0];
  if (first === undefined || first.kind !== 'json') throw new Error('expected one JSON tool output');
  return first.value as Record<string, unknown>;
}

/** Settle the live record through the real chain: conclusion, Runtime end, owner settle. */
async function settleRecord(fx: Fx): Promise<void> {
  const concluded = await recordK3Conclusion(fx.world, fx.round, {
    item: 1, verdict: 'done', evidence: 'K3-14 settles before the late write',
    crashSuspicion: { verdict: 'unlikely', evidence: 'no crash' },
  });
  await endK3RunCompleted(fx.world, fx.round.claim);
  const settled = await settleK3Review(fx.world, concluded, { requestId: 'k3-14-adapter-settled' });
  if (settled.status !== 'resolved') {
    throw new Error(`the K3-14 round settled to ${settled.status}, not resolved`);
  }
}

describe('K3-14 real tool adapter over the real owner (R5)', () => {
  it.each(['memory', 'sqlite'] as const)(
    'K3-14 %s: the same call replays the original receipt; the adapter never pre-reads the record',
    async kind => {
      const fx = await ready(kind);
      const { definition, reads } = reviewTool(fx);
      const first = await runTool(definition, 'k3-14-adapter-call-1', adapterArgs);
      expect(first).toMatchObject({ status: 'success' });
      const firstValue = toolValue(first);
      expect(firstValue).toMatchObject({ status: 'committed', replayed: false });
      // The owner checks the receipt before any record read (L14).
      expect(reads).toEqual([]);
      const before = await fx.reviews.readReview(fx.round.context, { ref: fx.reviewRef });
      const replay = await runTool(definition, 'k3-14-adapter-call-1', adapterArgs);
      expect(toolValue(replay)).toEqual({ ...firstValue, replayed: true });
      expect(reads).toEqual([]);
      expect(await fx.reviews.readReview(fx.round.context, { ref: fx.reviewRef })).toEqual(before);
    },
  );

  it.each(['memory', 'sqlite'] as const)(
    'K3-14 %s: the same identity with changed content is idempotency_conflict through the adapter',
    async kind => {
      const fx = await ready(kind);
      const { definition } = reviewTool(fx);
      expect(await runTool(definition, 'k3-14-adapter-call-1', adapterArgs)).toMatchObject({ status: 'success' });
      const conflict = await runTool(definition, 'k3-14-adapter-call-1', { ...adapterArgs, verdict: 'not_done' });
      expect(conflict).toMatchObject({ status: 'error', error: { code: 'execution_failed', retryable: false } });
      expect(toolValue(conflict)).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
    },
  );

  it.each(['memory', 'sqlite'] as const)(
    'K3-14 %s: a post-round write through the adapter is source_stale',
    async kind => {
      const fx = await ready(kind);
      const { definition } = reviewTool(fx);
      await settleRecord(fx);
      const late = await runTool(definition, 'k3-14-adapter-call-late', adapterArgs);
      expect(late).toMatchObject({ status: 'error' });
      expect(toolValue(late)).toMatchObject({ status: 'rejected', code: 'source_stale' });
    },
  );

  it.each(['memory', 'sqlite'] as const)(
    'K3-14 %s: the owner retries once on a real commit race and both no-pin writes commit',
    async kind => {
      const fx = await ready(kind);
      // A store-level race: the first two commits wait for each other, so the
      // loser really sees a revision_conflict and must re-read and re-guard.
      const synced = synchronizeB2Commits(fx.world.records);
      let seq = 0;
      const reviews = createUnknownCallReviewService({
        records: synced.records as never, lookups: synced.records as never,
        reads: createRunStateReader({ records: synced.records as never }),
        readReviewDisplays: async () => ({ status: 'not_found' }),
        now: () => AT, eventId: () => `k3-14-race-event-${String(++seq)}`,
      });
      const request = (requestId: string, evidence: string) => ({
        input: { reviewRef: fx.reviewRef, item: 1, verdict: 'done' as const, evidence,
          crashSuspicion: { verdict: 'unlikely' as const, evidence: 'no crash' } },
        meta: { requestId, expected: [] as never[] },
      });
      const [a, b] = await Promise.all([
        reviews.recordConclusion(fx.round.context, request('k3-14-race-a', 'first') as never),
        reviews.recordConclusion(fx.round.context, request('k3-14-race-b', 'second') as never),
      ]);
      expect([a.status, b.status]).toEqual(['committed', 'committed']);
      expect(synced.arrivals()).toBe(3);
    },
  );
});
