/**
 * K3 §2 L7 `listReviews`: by Goal+status (index `k3-ucr-by-goal-status`) or by
 * workspace+open (index `k3-ucr-by-workspace-open`), page limit 1..200 with
 * `cursor`/`nextCursor`/`readThrough`, no total cap. Read back through the
 * public read port; memory and SQLite each once.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { UnknownCallReviewRef, UnknownCallReviewStatusV1, UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import {
  newUnknownCallReview, transitionUnknownCallReview,
} from '../../src/core/work-graph/state/unknown-call-review.js';
import {
  encodeUnknownCallReview, encodeUnknownCallReviewChangedEvent, unknownCallReviewRefKey,
  UNKNOWN_CALL_REVIEW_CHANGED_EVENT_TYPE, UNKNOWN_CALL_REVIEW_EVENT_SCHEMA_VERSION,
  UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS,
} from '../../src/core/work-graph/tasks/unknown-call-review-codecs.js';
import { createUnknownCallReviewService } from '../../src/core/work-graph/tasks/unknown-call-review-service.js';
import type { RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import type { RecordLookupPort } from '../../src/core/record-store/lookup-ports.js';
import { makeCommitCursor } from '../../src/contracts/ledger.js';
import { createB2ExecutionFixture, type B2ExecutionFixture } from '../helpers/B2-execution-fixture.js';

const AT = '2026-10-20T00:00:00.000Z';
const REVIEW_SCHEMAS: RecordBackendSchemas = {
  records: [...UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.records],
  events: [...UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.events],
  lookups: [...(UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.lookups ?? [])],
};
const UNAVAILABLE = {
  status: 'unavailable' as const, runBaselineKnown: false, reason: 'not_configured' as const, detail: 'ucr-list',
};

type Fx = {
  b2: B2ExecutionFixture;
  reviews: ReturnType<typeof createUnknownCallReviewService>;
  close(): Promise<void>;
};

async function fixture(kind: 'memory' | 'sqlite'): Promise<Fx> {
  const b2 = await createB2ExecutionFixture(kind, REVIEW_SCHEMAS);
  const reviews = createUnknownCallReviewService({ records: b2.base.records, lookups: b2.base.records });
  return { b2, reviews, close: () => b2.close() };
}

/** Commits one record for (goalId, runId) forced to a chosen status. */
async function seed(fx: Fx, goalId: string, runId: string, status: UnknownCallReviewStatusV1): Promise<UnknownCallReviewRef> {
  const scope = fx.b2.base.scope;
  const runRef = { aggregateType: 'Run' as const, projectId: scope.projectId, goalId, runId };
  const ref: UnknownCallReviewRef = { aggregateType: 'UnknownCallReview', projectId: scope.projectId, goalId, runId };
  const built = newUnknownCallReview({
    ref, workspaceId: scope.workspaceId,
    task: { projectId: scope.projectId, goalId, taskId: `task-${runId}` }, runRef,
    sessionRef: { projectId: scope.projectId, sessionId: `session-${runId}` },
    origin: { kind: 'human_attested', attestedBy: { kind: 'human', id: 'u' }, reason: 'UCR-list' },
    inventory: 'complete', inventoryProblem: null, items: [], itemsOmitted: 0, workspace: UNAVAILABLE,
    streak: { priorAutoCleanup: false, priorUnknownProcess: false, resetRunRef: null }, createdAt: AT,
  });
  if (!built.ok) throw new Error(JSON.stringify(built));
  const record: UnknownCallReviewV1 = { ...built.next, status,
    open: status !== 'resolved' ? 'yes' : 'no', decisionReasons: [] };
  const receipt = await fx.b2.base.records.commit({
    identityKey: `ucr-list-setup-${runId}`, fingerprint: `ucr-list-setup-fp-${runId}`,
    guards: [{ refKey: unknownCallReviewRefKey(ref), expectedRevision: null }],
    records: [encodeUnknownCallReview(record)], claims: [], indexGuards: [], indexChanges: [],
    events: [encodeUnknownCallReviewChangedEvent({
      eventId: `ucr-list-setup-event-${runId}`, eventType: UNKNOWN_CALL_REVIEW_CHANGED_EVENT_TYPE,
      schemaVersion: UNKNOWN_CALL_REVIEW_EVENT_SCHEMA_VERSION, occurredAt: AT,
      identityKey: `ucr-list-setup-${runId}`, fingerprint: `ucr-list-setup-fp-${runId}`,
      actor: { kind: 'human', id: 'u' }, requestId: `ucr-list-setup-${runId}`, change: 'created', review: record,
    })],
  });
  if (receipt.status !== 'committed') throw new Error(JSON.stringify(receipt));
  return ref;
}

const FIXTURES: Fx[] = [];
afterEach(async () => { for (const open of FIXTURES.splice(0)) await open.close(); });

describe('listReviews', () => {
  it.each(['memory', 'sqlite'] as const)('listReviews %s: by Goal+status pages with cursor and nextCursor', async kind => {
    const fx = await fixture(kind);
    FIXTURES.push(fx);
    const scope = fx.b2.base.scope;
    const goalA = 'list-goal-a';
    await seed(fx, goalA, 'run-a1', 'pending_review');
    await seed(fx, goalA, 'run-a2', 'needs_decision');
    await seed(fx, goalA, 'run-a3', 'resolved');
    await seed(fx, 'list-goal-b', 'run-b1', 'pending_review');

    const all = await fx.reviews.listReviews(fx.b2.ctx, {
      workspace: scope, filter: { goalRef: { aggregateType: 'Goal', projectId: scope.projectId, goalId: goalA },
        status: ['pending_review', 'needs_decision'] }, page: { limit: 200 } });
    expect(all).toMatchObject({ status: 'ready', value: { items: [
      { ref: { goalId: goalA, runId: 'run-a1' }, status: 'pending_review' },
      { ref: { goalId: goalA, runId: 'run-a2' }, status: 'needs_decision' },
    ], nextCursor: null } });
    if (all.status !== 'ready') throw new Error('list');
    expect(all.value.readThrough).not.toBeNull();

    const first = await fx.reviews.listReviews(fx.b2.ctx, {
      workspace: scope, filter: { goalRef: { aggregateType: 'Goal', projectId: scope.projectId, goalId: goalA },
        status: ['pending_review', 'needs_decision'] }, page: { limit: 1 } });
    expect(first).toMatchObject({ status: 'ready', value: { items: [{ ref: { runId: 'run-a1' } }] } });
    if (first.status !== 'ready' || first.value.nextCursor === null) throw new Error('a cursor is required');
    const second = await fx.reviews.listReviews(fx.b2.ctx, {
      workspace: scope, filter: { goalRef: { aggregateType: 'Goal', projectId: scope.projectId, goalId: goalA },
        status: ['pending_review', 'needs_decision'] }, page: { limit: 1, cursor: first.value.nextCursor } });
    expect(second).toMatchObject({ status: 'ready', value: { items: [{ ref: { runId: 'run-a2' } }], nextCursor: null } });
  });

  it.each(['memory', 'sqlite'] as const)('listReviews %s: by workspace+open returns only open records', async kind => {
    const fx = await fixture(kind);
    FIXTURES.push(fx);
    const scope = fx.b2.base.scope;
    await seed(fx, 'list-goal-a', 'run-a1', 'pending_review');
    await seed(fx, 'list-goal-a', 'run-a2', 'needs_decision');
    await seed(fx, 'list-goal-a', 'run-a3', 'resolved');
    await seed(fx, 'list-goal-b', 'run-b1', 'pending_review');

    const open = await fx.reviews.listReviews(fx.b2.ctx, {
      workspace: scope, filter: { open: 'yes' }, page: { limit: 200 } });
    expect(open).toMatchObject({ status: 'ready', value: { items: [
      { ref: { goalId: 'list-goal-a', runId: 'run-a1' } },
      { ref: { goalId: 'list-goal-a', runId: 'run-a2' } },
      { ref: { goalId: 'list-goal-b', runId: 'run-b1' } },
    ], nextCursor: null } });
    if (open.status !== 'ready') throw new Error('list');
    expect(open.value.items.every(record => record.open === 'yes')).toBe(true);
  });

  it('listReviews: a limit outside 1..200 is invalid', async () => {
    const fx = await fixture('memory');
    FIXTURES.push(fx);
    const scope = fx.b2.base.scope;
    expect(await fx.reviews.listReviews(fx.b2.ctx, { workspace: scope,
      filter: { open: 'yes' }, page: { limit: 0 } }))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await fx.reviews.listReviews(fx.b2.ctx, { workspace: scope,
      filter: { open: 'yes' }, page: { limit: 201 } }))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
  });

  // Codex 8: a cursor is an exclusive refKey keyset bound, not a row that must
  // still be inside the query. A foreign (or stale) cursor is not `invalid`.
  it.each(['memory', 'sqlite'] as const)(
    'listReviews %s: a cursor outside the filter is a keyset bound, not invalid', async kind => {
      const fx = await fixture(kind);
      FIXTURES.push(fx);
      const scope = fx.b2.base.scope;
      const goalA = 'list-goal-cursor';
      const pending = await seed(fx, goalA, 'run-a1', 'pending_review');
      const decided = await seed(fx, goalA, 'run-a2', 'needs_decision');
      const pendingKey = unknownCallReviewRefKey(pending);
      const decidedKey = unknownCallReviewRefKey(decided);
      expect(pendingKey < decidedKey).toBe(true);

      const page = await fx.reviews.listReviews(fx.b2.ctx, {
        workspace: scope, filter: { goalRef: { aggregateType: 'Goal', projectId: scope.projectId, goalId: goalA },
          status: ['pending_review'] }, page: { limit: 1, cursor: decidedKey } });
      expect(page).toMatchObject({ status: 'ready', value: { items: [], nextCursor: null } });
    });

  // Codex 8: bounded keyset pages, no total cap (L7 "没有总数上限"). More than
  // one store page of records must still list with two clean pages.
  it.each(['memory', 'sqlite'] as const)(
    'listReviews %s: more than a store page of records lists without a cap', async kind => {
      const fx = await fixture(kind);
      FIXTURES.push(fx);
      const scope = fx.b2.base.scope;
      const goalA = 'list-goal-many';
      const runIds: string[] = [];
      for (let i = 0; i < 205; i += 1) {
        const runId = `run-m${String(i).padStart(3, '0')}`;
        runIds.push(runId);
        await seed(fx, goalA, runId, 'pending_review');
      }
      const filter = { goalRef: { aggregateType: 'Goal' as const, projectId: scope.projectId, goalId: goalA },
        status: ['pending_review' as const] };

      const first = await fx.reviews.listReviews(fx.b2.ctx, { workspace: scope, filter, page: { limit: 200 } });
      if (first.status !== 'ready') throw new Error(JSON.stringify(first));
      expect(first.value.items).toHaveLength(200);
      expect(first.value.nextCursor).not.toBeNull();
      expect(first.value.items.map(record => record.ref.runId))
        .toEqual(runIds.slice(0, 200));

      const second = await fx.reviews.listReviews(fx.b2.ctx, {
        workspace: scope, filter, page: { limit: 200, cursor: first.value.nextCursor! } });
      if (second.status !== 'ready') throw new Error(JSON.stringify(second));
      expect(second.value.items).toHaveLength(5);
      expect(second.value.nextCursor).toBeNull();
      expect(second.value.items.map(record => record.ref.runId))
        .toEqual(runIds.slice(200));
    });

  // Codex 8: every tuple's `readThrough` must be the same watermark; a mismatch
  // retries the page, and only a stable watermark is returned.
  it('listReviews: an unstable per-tuple watermark retries to the stable watermark', async () => {
    const b2 = await createB2ExecutionFixture('memory', REVIEW_SCHEMAS);
    const fx: Fx = { b2, reviews: null as never, close: () => b2.close() };
    FIXTURES.push(fx);
    const scope = b2.base.scope;
    const goalA = 'list-goal-watermark';
    await seed(fx, goalA, 'run-w1', 'pending_review');
    await seed(fx, goalA, 'run-w2', 'needs_decision');
    const real = b2.base.records;
    let calls = 0;
    const lookups: RecordLookupPort = {
      lookup: async request => {
        calls += 1;
        const result = await real.lookup(request);
        if (result.status !== 'ready') return result;
        const watermark = calls <= 2 ? makeCommitCursor(calls) : makeCommitCursor(3);
        return { status: 'ready', value: { ...result.value, readThrough: watermark } };
      },
    };
    fx.reviews = createUnknownCallReviewService({ records: real, lookups });

    const page = await fx.reviews.listReviews(b2.ctx, {
      workspace: scope, filter: { goalRef: { aggregateType: 'Goal', projectId: scope.projectId, goalId: goalA },
        status: ['pending_review', 'needs_decision'] }, page: { limit: 2 } });
    expect(page).toMatchObject({ status: 'ready' });
    if (page.status !== 'ready') throw new Error(JSON.stringify(page));
    expect(page.value.readThrough).toBe(makeCommitCursor(3));
    expect(calls).toBe(4);
  });

  it('listReviews: a persistently mixed watermark is not_ready, never a stale page', async () => {
    const b2 = await createB2ExecutionFixture('memory', REVIEW_SCHEMAS);
    const fx: Fx = { b2, reviews: null as never, close: () => b2.close() };
    FIXTURES.push(fx);
    const scope = b2.base.scope;
    const goalA = 'list-goal-mixed';
    await seed(fx, goalA, 'run-x1', 'pending_review');
    await seed(fx, goalA, 'run-x2', 'needs_decision');
    const real = b2.base.records;
    let calls = 0;
    const lookups: RecordLookupPort = {
      lookup: async request => {
        calls += 1;
        const result = await real.lookup(request);
        if (result.status !== 'ready') return result;
        return { status: 'ready', value: { ...result.value, readThrough: makeCommitCursor(calls) } };
      },
    };
    fx.reviews = createUnknownCallReviewService({ records: real, lookups });

    const page = await fx.reviews.listReviews(b2.ctx, {
      workspace: scope, filter: { goalRef: { aggregateType: 'Goal', projectId: scope.projectId, goalId: goalA },
        status: ['pending_review', 'needs_decision'] }, page: { limit: 2 } });
    expect(page).toMatchObject({ status: 'not_ready' });
    expect(calls).toBe(6);
  });
});
