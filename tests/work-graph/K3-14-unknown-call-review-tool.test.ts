/**
 * K3 row K3-14 (R2 owner level, L14): the `record_unknown_call_review` tool's
 * owner write `recordConclusion`.
 *
 * Verified through the public write port and read back through the public
 * `readReview` port; no assertion reads the record store directly. Expected
 * values are literal from L14: a replay returns the original receipt, a changed
 * fingerprint is `idempotency_conflict`, a new call overwrites the conclusion,
 * a non-`process` alias is `invalid_arguments`, and a write after settlement is
 * `stale`. Memory and SQLite each once.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { UnknownCallReviewItemV1, UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import type { UnknownCallReviewRef } from '../../src/contracts/unknown-call-review.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import {
  newUnknownCallReview, transitionUnknownCallReview,
} from '../../src/core/work-graph/state/unknown-call-review.js';
import {
  encodeUnknownCallReview, encodeUnknownCallReviewChangedEvent, unknownCallReviewRefKey,
  UNKNOWN_CALL_REVIEW_CHANGED_EVENT_TYPE, UNKNOWN_CALL_REVIEW_EVENT_SCHEMA_VERSION,
  UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS,
} from '../../src/core/work-graph/tasks/unknown-call-review-codecs.js';
import { createUnknownCallReviewService } from '../../src/core/work-graph/tasks/unknown-call-review-service.js';
import {
  RECORD_UNKNOWN_CALL_REVIEW_TOOL_NAME, createUnknownCallReviewTools,
} from '../../src/core/agent-runtime/unknown-call-review-tools.js';
import type { RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import {
  createB2ExecutionFixture, synchronizeB2Commits, type B2ExecutionFixture,
} from '../helpers/B2-execution-fixture.js';

const AT = '2026-10-20T00:00:00.000Z';
const REVIEW_SCHEMAS: RecordBackendSchemas = {
  records: [...UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.records],
  events: [...UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.events],
  lookups: [...(UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.lookups ?? [])],
};

const UNAVAILABLE = {
  status: 'unavailable' as const, runBaselineKnown: false, reason: 'not_configured' as const, detail: 'k3-14',
};

function processItem(alias: number) {
  const callId = `call-${String(alias)}`;
  return {
    alias, callId, toolName: 'shell', kind: 'process' as const, contained: true,
    kernel: { adapterId: 'a', kernelSessionId: 'ks', kernelRunId: 'kr', turnId: 't',
      callId, declaredPosition: alias, startedPosition: alias },
    argumentsDigest: 'd'.repeat(64),
    summary: { command: 'echo hi', cwd: null, mode: null, paths: [], pathsOmitted: 0, truncated: false },
    startedAt: null, observed: { verdict: 'pending' as const, by: null },
  };
}

function readOnlyItem(alias: number) {
  const base = processItem(alias);
  return { ...base, toolName: 'read', kind: 'read_only' as const };
}

type Fx = {
  b2: B2ExecutionFixture;
  reviews: ReturnType<typeof createUnknownCallReviewService>;
  reviewRef: UnknownCallReviewRef;
  roundCtx: CoreCallContext;
  close(): Promise<void>;
};

async function fixture(kind: 'memory' | 'sqlite', items: UnknownCallReviewItemV1[]): Promise<Fx> {
  const b2 = await createB2ExecutionFixture(kind, REVIEW_SCHEMAS);
  const records = b2.base.records;
  const reads = createRunStateReader({ records });
  let seq = 0;
  const reviews = createUnknownCallReviewService({
    records, lookups: records, reads,
    readReviewDisplays: async () => ({ status: 'not_found' }),
    now: () => AT, eventId: () => `k3-14-event-${String(++seq)}`,
  });
  await b2.enter();
  const runRef = b2.claim.runRef;
  const reviewRef: UnknownCallReviewRef = {
    aggregateType: 'UnknownCallReview', projectId: runRef.projectId, goalId: runRef.goalId, runId: 'k3-14-origin-run',
  };
  const built = newUnknownCallReview({
    ref: reviewRef, workspaceId: b2.base.scope.workspaceId,
    task: { projectId: runRef.projectId, goalId: runRef.goalId, taskId: b2.claim.task.taskId },
    runRef: { aggregateType: 'Run', projectId: runRef.projectId, goalId: runRef.goalId, runId: reviewRef.runId },
    sessionRef: { projectId: runRef.projectId, sessionId: b2.claim.sessionRef.sessionId },
    origin: { kind: 'human_attested', attestedBy: { kind: 'human', id: 'u' }, reason: 'K3-14' },
    inventory: 'complete', inventoryProblem: null, items, itemsOmitted: 0,
    workspace: UNAVAILABLE,
    streak: { priorAutoCleanup: false, priorUnknownProcess: false, resetRunRef: null }, createdAt: AT,
  });
  if (!built.ok) throw new Error(JSON.stringify(built));
  const claimed = transitionUnknownCallReview(built.next, { kind: 'round_claimed', runRef, phase: 'review', round: 1 }, {
    expectedRevision: built.next.revision, updatedAt: AT, actor: { kind: 'human', id: 'u' },
    activeRunEnded: false, activeRunCompleted: false, fenceHumanOnly: false, reviewUnavailable: false,
    autonomy: 'after_plan_confirmation', incompleteCommandAliases: [], missingSelfCheckAliases: [],
    originalRunSelected: false,
  });
  if (!claimed.ok) throw new Error(JSON.stringify(claimed));
  await commit(fixtureOf(records), claimed.next, 'setup');
  const roundCtx: CoreCallContext = {
    projectId: b2.base.scope.projectId, workspaceId: b2.base.scope.workspaceId,
    principal: { kind: 'work_run', runRef, roleBinding: b2.run.roleBinding },
    materialReader: b2.ctx.materialReader, signal: b2.ctx.signal,
  };
  return { b2, reviews, reviewRef, roundCtx, close: () => b2.close() };
}

// A tiny indirection so `commit` can be called before `Fx` exists.
function fixtureOf(records: B2ExecutionFixture['base']['records']): { records: B2ExecutionFixture['base']['records'] } {
  return { records };
}

async function commit(fixture: { records: B2ExecutionFixture['base']['records'] },
  review: UnknownCallReviewV1, identity: string): Promise<void> {
  const refKey = unknownCallReviewRefKey(review.ref);
  const receipt = await fixture.records.commit({
    identityKey: `k3-14-setup:${identity}:${String(review.revision)}`,
    fingerprint: `k3-14-setup-fp:${identity}:${String(review.revision)}`,
    guards: [{ refKey, expectedRevision: null }],
    records: [encodeUnknownCallReview(review)], claims: [], indexGuards: [], indexChanges: [],
    events: [encodeUnknownCallReviewChangedEvent({
      eventId: `k3-14-setup-event-${identity}-${String(review.revision)}`,
      eventType: UNKNOWN_CALL_REVIEW_CHANGED_EVENT_TYPE,
      schemaVersion: UNKNOWN_CALL_REVIEW_EVENT_SCHEMA_VERSION, occurredAt: AT,
      identityKey: `k3-14-setup:${identity}:${String(review.revision)}`,
      fingerprint: `k3-14-setup-fp:${identity}:${String(review.revision)}`,
      actor: { kind: 'human', id: 'u' }, requestId: `k3-14-setup:${identity}`, change: 'round_claimed', review,
    })],
  });
  if (receipt.status !== 'committed') throw new Error(`setup commit failed: ${JSON.stringify(receipt)}`);
}

function conclusionRequest(reviewRef: UnknownCallReviewRef, requestId: string, revision: number,
  verdict: 'done' | 'not_done' | 'partial' | 'undetermined', evidence: string, item = 1) {
  return {
    input: { reviewRef, item, verdict, evidence,
      crashSuspicion: { verdict: 'unlikely' as const, evidence: 'no crash' } },
    meta: { requestId, expected: [{ ref: reviewRef, revision }] },
  };
}

const fixtures: Fx[] = [];
afterEach(async () => { for (const open of fixtures.splice(0)) await open.close(); });

async function ready(kind: 'memory' | 'sqlite', items: UnknownCallReviewItemV1[] = [processItem(1)]): Promise<Fx> {
  const fx = await fixture(kind, items);
  fixtures.push(fx);
  return fx;
}

describe('K3-14 recordConclusion owner', () => {
  it.each(['memory', 'sqlite'] as const)('K3-14 %s: the same call replays the original receipt and leaves the record unchanged', async kind => {
    const fx = await ready(kind);
    const request = conclusionRequest(fx.reviewRef, 'k3-14-call-1', 2, 'done', 'I ran it; output matched');
    const first = await fx.reviews.recordConclusion(fx.roundCtx, request as never);
    expect(first).toMatchObject({ status: 'committed', replayed: false });
    const afterFirst = await fx.reviews.readReview(fx.roundCtx, { ref: fx.reviewRef });
    if (first.status !== 'committed' || afterFirst.status !== 'ready') throw new Error('setup');

    const replay = await fx.reviews.recordConclusion(fx.roundCtx, request as never);
    expect(replay).toEqual({ ...first, replayed: true });
    const afterReplay = await fx.reviews.readReview(fx.roundCtx, { ref: fx.reviewRef });
    expect(afterReplay).toEqual(afterFirst);
  });

  it.each(['memory', 'sqlite'] as const)('K3-14 %s: the same identity with different content is idempotency_conflict', async kind => {
    const fx = await ready(kind);
    const first = await fx.reviews.recordConclusion(fx.roundCtx,
      conclusionRequest(fx.reviewRef, 'k3-14-call-1', 2, 'done', 'I ran it') as never);
    expect(first).toMatchObject({ status: 'committed' });
    const conflict = await fx.reviews.recordConclusion(fx.roundCtx,
      conclusionRequest(fx.reviewRef, 'k3-14-call-1', 2, 'not_done', 'I did not run it') as never);
    expect(conflict).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
  });

  it.each(['memory', 'sqlite'] as const)('K3-14 %s: a new call overwrites the same item conclusion; the last commit wins', async kind => {
    const fx = await ready(kind);
    const first = await fx.reviews.recordConclusion(fx.roundCtx,
      conclusionRequest(fx.reviewRef, 'k3-14-call-1', 2, 'done', 'first') as never);
    expect(first).toMatchObject({ status: 'committed', value: { revision: 3 } });
    const second = await fx.reviews.recordConclusion(fx.roundCtx,
      conclusionRequest(fx.reviewRef, 'k3-14-call-2', 3, 'not_done', 'second') as never);
    expect(second).toMatchObject({ status: 'committed', value: { revision: 4 } });
    const read = await fx.reviews.readReview(fx.roundCtx, { ref: fx.reviewRef });
    expect(read).toMatchObject({ status: 'ready', value: { revision: 4, items: [{ alias: 1,
      observed: { verdict: 'not_done', by: 'review_round', evidence: 'second' } }] } });
  });

  it.each(['memory', 'sqlite'] as const)('K3-14 %s: a missing or non-process alias is invalid_arguments and writes nothing', async kind => {
    const fx = await ready(kind, [processItem(1), readOnlyItem(2)]);
    const before = await fx.reviews.readReview(fx.roundCtx, { ref: fx.reviewRef });
    const missing = await fx.reviews.recordConclusion(fx.roundCtx,
      conclusionRequest(fx.reviewRef, 'k3-14-call-1', 2, 'done', 'x', 9) as never);
    expect(missing).toMatchObject({ status: 'rejected', code: 'invalid' });
    const notProcess = await fx.reviews.recordConclusion(fx.roundCtx,
      conclusionRequest(fx.reviewRef, 'k3-14-call-2', 2, 'done', 'x', 2) as never);
    expect(notProcess).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await fx.reviews.readReview(fx.roundCtx, { ref: fx.reviewRef })).toEqual(before);
  });

  it.each(['memory', 'sqlite'] as const)('K3-14 %s: writing after the round settled is stale', async kind => {
    const fx = await ready(kind);
    // A settled record: the round is over and `activeRound` is cleared.
    const claimed = await fx.reviews.readReview(fx.roundCtx, { ref: fx.reviewRef });
    if (claimed.status !== 'ready') throw new Error('setup');
    const settled: UnknownCallReviewV1 = { ...claimed.value, status: 'resolved', open: 'no', decisionReasons: [], activeRound: null };
    // Commit a replacement at the next revision (the store judges by the record's own revision).
    const receipt = await fx.b2.base.records.commit({
      identityKey: 'k3-14-settled', fingerprint: 'k3-14-settled-fp',
      guards: [{ refKey: unknownCallReviewRefKey(fx.reviewRef), expectedRevision: claimed.value.revision }],
      records: [encodeUnknownCallReview({ ...settled, revision: claimed.value.revision + 1 })],
      claims: [], indexGuards: [], indexChanges: [],
      events: [encodeUnknownCallReviewChangedEvent({
        eventId: 'k3-14-settled-event', eventType: UNKNOWN_CALL_REVIEW_CHANGED_EVENT_TYPE,
        schemaVersion: UNKNOWN_CALL_REVIEW_EVENT_SCHEMA_VERSION, occurredAt: AT,
        identityKey: 'k3-14-settled', fingerprint: 'k3-14-settled-fp', actor: { kind: 'human', id: 'u' },
        requestId: 'k3-14-settled', change: 'settled', review: { ...settled, revision: claimed.value.revision + 1 },
      })],
    });
    expect(receipt.status).toBe('committed');
    const late = await fx.reviews.recordConclusion(fx.roundCtx,
      conclusionRequest(fx.reviewRef, 'k3-14-call-late', claimed.value.revision + 1, 'done', 'late') as never);
    expect(late).toMatchObject({ status: 'rejected', code: 'source_stale' });
  });

  it('K3-14 canonicalJson is stable for a review ref (fixture sanity)', () => {
    expect(canonicalJson({ aggregateType: 'UnknownCallReview', projectId: 'p', goalId: 'g', runId: 'r' } as unknown as JsonValue))
      .toContain('UnknownCallReview');
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
    reviews: reviews as never, context: fx.roundCtx, reviewRef: fx.reviewRef,
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

/** Replace the live record with a settled replacement at the next revision. */
async function settleRecord(fx: Fx): Promise<number> {
  const claimed = await fx.reviews.readReview(fx.roundCtx, { ref: fx.reviewRef });
  if (claimed.status !== 'ready') throw new Error('setup');
  const settled: UnknownCallReviewV1 = {
    ...claimed.value, status: 'resolved', open: 'no', decisionReasons: [], activeRound: null,
  };
  const revision = claimed.value.revision + 1;
  const receipt = await fx.b2.base.records.commit({
    identityKey: 'k3-14-adapter-settled', fingerprint: 'k3-14-adapter-settled-fp',
    guards: [{ refKey: unknownCallReviewRefKey(fx.reviewRef), expectedRevision: claimed.value.revision }],
    records: [encodeUnknownCallReview({ ...settled, revision })],
    claims: [], indexGuards: [], indexChanges: [],
    events: [encodeUnknownCallReviewChangedEvent({
      eventId: 'k3-14-adapter-settled-event', eventType: UNKNOWN_CALL_REVIEW_CHANGED_EVENT_TYPE,
      schemaVersion: UNKNOWN_CALL_REVIEW_EVENT_SCHEMA_VERSION, occurredAt: AT,
      identityKey: 'k3-14-adapter-settled', fingerprint: 'k3-14-adapter-settled-fp',
      actor: { kind: 'human', id: 'u' }, requestId: 'k3-14-adapter-settled',
      change: 'settled', review: { ...settled, revision },
    })],
  });
  expect(receipt.status).toBe('committed');
  return revision;
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
      const before = await fx.reviews.readReview(fx.roundCtx, { ref: fx.reviewRef });
      const replay = await runTool(definition, 'k3-14-adapter-call-1', adapterArgs);
      expect(toolValue(replay)).toEqual({ ...firstValue, replayed: true });
      expect(reads).toEqual([]);
      expect(await fx.reviews.readReview(fx.roundCtx, { ref: fx.reviewRef })).toEqual(before);
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
      const synced = synchronizeB2Commits(fx.b2.base.records);
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
        reviews.recordConclusion(fx.roundCtx, request('k3-14-race-a', 'first') as never),
        reviews.recordConclusion(fx.roundCtx, request('k3-14-race-b', 'second') as never),
      ]);
      expect([a.status, b.status]).toEqual(['committed', 'committed']);
      expect(synced.arrivals()).toBe(3);
    },
  );
});
