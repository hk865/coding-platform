/**
 * K3-20 (2A L6–L8): the review card source pages by offset, the decision queue
 * follows it to the end, and a card beyond the first source page is readable by
 * key.
 *
 * FOUR real `needs_decision` records are created up front by the real
 * RUN-20/RUN-22 owners from a real Plan with five extra work tasks (the fixture
 * seeds them into Goal B and claims/enters each Run through the real claim and
 * execution-entry owners; neither record nor card is hand-encoded). During the
 * FIRST review-list lookup of the queue read a FIFTH real record is committed
 * through the same owners (2A QA-16 style mid-read write) — gated on GOAL B's
 * own real records read, so the record competes inside the same public query
 * window. The queue must retry the whole window and the NEXT attempt serves all
 * five (F-032: a missing consistency retry would drop the fifth record). The
 * card source's `pageLimit` is 2, so five cards are served over three pages
 * (2 + 2 + 1). The row runs on memory and SQLite; the real Host recognition
 * path reads the world's own backend, so both backends reach the same facts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type {
  DecisionCardSourcePort, DecisionNoticeSourcePort, DecisionQueueReadV1,
} from '../../src/core/work-graph/model/decision-contracts.js';
import type { DecisionSourceV1, NoticeCategoryV1 } from '../../src/contracts/goal-decisions.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createUnknownCallReviewService } from '../../src/core/work-graph/tasks/unknown-call-review-service.js';
import { readCanonicalTaskFacts, readGoalPlanWindow } from '../../src/core/work-graph/tasks/plan-readers.js';
import { K3_UCR_BY_GOAL_STATUS_LOOKUP } from '../../src/core/work-graph/tasks/unknown-call-review-codecs.js';
import {
  createDecisionReadModel, createUnknownCallReviewCardSource,
} from '../../src/core/work-graph/views/decision-read-model.js';
import { createGoalConflictAssembler } from '../../src/core/work-graph/views/goal-conflicts.js';
import { createNoticePositionComparator } from '../../src/core/work-graph/views/notice-position.js';
import { createNoticeDisplayToken } from '../../src/core/work-graph/views/notice-display-token.js';
import { createArchitectureCatalogService } from '../../src/core/work-graph/architecture/catalog-service.js';
import { createGoalExecutedFilesReader } from '../../src/core/work-graph/tasks/goal-executed-files-reader.js';
import { K3_REVIEW_TASKS, openK3ReviewCardWorld, type K3ReviewCardWorld } from '../helpers/K3-review-card-fixture.js';
import { GOAL_B, T, WORKSPACE_SCOPE } from '../helpers/S5-decision-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';

// §5.1's stand-in `shell`, hoisted per test file (the real Run's one call uses it).
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const KINDS = ['memory', 'sqlite'] as const;
const worlds: K3ReviewCardWorld[] = [];
afterEach(async () => {
  shellSeam.release();
  for (const world of worlds.splice(0)) await world.close();
});

async function allQueuePages(readModel: ReturnType<typeof createDecisionReadModel>, limit: number):
Promise<{ cards: DecisionQueueReadV1['waitingAnswer']; final: DecisionQueueReadV1 }> {
  const cards: DecisionQueueReadV1['waitingAnswer'] = [];
  let cursor: string | undefined;
  for (;;) {
    const read = await readModel.queryDecisionQueue(fixtureCtx(), { workspace: WORKSPACE_SCOPE,
      sections: ['waiting_answer', 'history'], page: { limit, ...(cursor === undefined ? {} : { cursor }) } });
    if (read.status !== 'ready') throw new Error(`the queue read failed: ${JSON.stringify(read)}`);
    cards.push(...read.value.waitingAnswer);
    if (read.value.nextCursor === null) return { cards, final: read.value };
    cursor = read.value.nextCursor;
  }
}

let currentWorld: K3ReviewCardWorld | null = null;
function fixtureCtx() {
  if (currentWorld === null) throw new Error('no K3 review-card world');
  return currentWorld.fixture.ctx;
}

describe('K3-20 review card source paging', () => {
  it.each(KINDS)('%s: pageLimit 2 pages four cards, a fifth record committed mid-read appears on the retry, and the fifth card reads by key', async kind => {
    const world = await openK3ReviewCardWorld(kind, { pageLimit: 2 });
    worlds.push(world);
    currentWorld = world;
    const f = world.fixture;
    const records: UnknownCallReviewV1[] = [];
    for (const taskId of K3_REVIEW_TASKS.slice(0, 4)) records.push(await world.createRecord(taskId));
    expect(records).toHaveLength(4);
    expect(records.map(record => record.status)).toEqual([
      'needs_decision', 'needs_decision', 'needs_decision', 'needs_decision',
    ]);
    const { cardSource } = world;
    // The fixture wires only the review source; the empty stubs below mark the
    // sources this case does not exercise as available, so `countsComplete`
    // reports the wiring fact (all sources present) rather than paging.
    const readModel = completeReadModel(f.records, [cardSource]);

    // The source itself: pageLimit 2 -> four items over TWO offset pages.
    const attemptBefore = { cache: new Map<string, unknown>() };
    const first = await cardSource.readPage(f.ctx, { workspace: WORKSPACE_SCOPE, goalRef: GOAL_B,
      page: { limit: 2, attempt: attemptBefore } });
    expect(first).toMatchObject({ status: 'ready', value: { availability: 'available', nextCursor: '2' } });
    if (first.status !== 'ready') return;
    expect(first.value.items).toHaveLength(2);
    const second = await cardSource.readPage(f.ctx, { workspace: WORKSPACE_SCOPE, goalRef: GOAL_B,
      page: { limit: 2, cursor: '2', attempt: attemptBefore } });
    expect(second).toMatchObject({ status: 'ready', value: { nextCursor: null } });
    if (second.status !== 'ready') return;
    expect(second.value.items).toHaveLength(2);
    expect([...first.value.items, ...second.value.items]).toHaveLength(4);

    // The decision queue with limit 2 pages to the end over the FOUR records
    // committed so far: exactly the four review cards, no capacity report.
    const { cards, final: queueFinal } = await allQueuePages(readModel, 2);
    const reviewCards = cards.filter(card => card.source.kind === 'unknown_call_review');
    expect(reviewCards).toHaveLength(4);
    expect(new Set(reviewCards.map(card => card.source.key)).size).toBe(4);
    expect(JSON.stringify(queueFinal)).not.toContain('capacity');
    // Hand-computed total: the four review cards plus the shared S5 fixture's
    // four pre-existing waiting cards (candidates Q1/Q2, the Goal A/B conflict,
    // and the pending decision message).
    expect(queueFinal.counts.waitingAnswer).toBe(8);
    expect(queueFinal.countsComplete).toBe(true);
    const expectedKeysBefore = records.map(cardSourceKey);
    expect(reviewCards.map(card => card.source.key).sort()).toEqual([...expectedKeysBefore].sort());
    expect([...first.value.items, ...second.value.items].map(card => card.source.key).sort())
      .toEqual([...expectedKeysBefore].sort());

    // Mid-read commit (2A QA-16 style): the first review-list page of the queue
    // read completes, then a genuinely NEW fifth record is committed. It goes
    // through the real RUN-20/RUN-22 owners via `world.createRecord`, which
    // writes to `f.records` directly and therefore does not re-enter this
    // wrapper (no `holdReview` on an existing record). The queue's watermark
    // moves, so the whole window is retried and the NEXT attempt serves all
    // five cards, never a mixed old/new page.
    const reads = createRunStateReader({ records: f.records });
    let armed = true;
    let midReadDone = false;
    let gateGoalId: unknown;
    let gateStatus: unknown;
    // Every Goal-B `needs_decision` page the queue reads, in order: the first
    // is read BEFORE the commit (so it holds four records), a later retried
    // attempt must hold five.
    const goalBNeedsDecisionReads: number[] = [];
    let fifthRecord: UnknownCallReviewV1 | null = null;
    const wrappedRecords = {
      readMany: (refKeys: readonly string[]) => f.records.readMany(refKeys),
      lookupCommit: (input: Parameters<typeof f.records.lookupCommit>[0]) => f.records.lookupCommit(input),
      commit: (input: Parameters<typeof f.records.commit>[0]) => f.records.commit(input),
      eventAt: (cursor: Parameters<typeof f.records.eventAt>[0]) => f.records.eventAt(cursor),
      async lookup(request: Parameters<typeof f.records.lookup>[0]) {
        const page = await f.records.lookup(request);
        if (request.index === K3_UCR_BY_GOAL_STATUS_LOOKUP
          && request.values.includes(GOAL_B.goalId)
          && request.values.includes('needs_decision')) {
          if (page.status === 'ready') goalBNeedsDecisionReads.push(page.value.records.length);
          if (armed) {
            // F-032: the A3 gate is on GOAL B's OWN real records read, inside
            // the queue's public query window, so the new Goal-B record
            // competes with the page already read and the whole window must
            // be retried (never a mixed old/new page).
            armed = false;
            midReadDone = true;
            // What the gate actually observed on the real lookup, not a
            // constant: [projectId, workspaceId, goalId, status].
            gateGoalId = request.values[2];
            gateStatus = request.values[3];
            fifthRecord = await world.createRecord(K3_REVIEW_TASKS[4]);
            records.push(fifthRecord);
          }
        }
        return page;
      },
      // The real executed-files reader reads its activity window through the
      // ordered index too; the wrapper must forward the real backend method.
      lookupOrdered: (request: Parameters<typeof f.records.lookupOrdered>[0]) =>
        f.records.lookupOrdered(request),
    } as typeof f.records;
    const reviewsForQueue = createUnknownCallReviewService({ records: wrappedRecords, lookups: wrappedRecords, reads,
      taskProjection: async (_ctx, task) => {
        const goalRef = { aggregateType: 'Goal' as const, projectId: task.projectId, goalId: task.goalId };
        const window = await readGoalPlanWindow(f.records, goalRef);
        if (window.status !== 'ready') return window;
        if (window.plan === null) return { status: 'rejected', code: 'not_found', reason: 'no active Plan' };
        return readCanonicalTaskFacts(f.records, goalRef, window.plan, task.taskId);
      },
      now: () => T, eventId: () => 'k3-20-mid-read' });
    const wrappedCards = createUnknownCallReviewCardSource({ records: wrappedRecords, reviews: reviewsForQueue,
      pageLimit: 2 });
    const wrappedReads = completeReadModel(wrappedRecords, [wrappedCards]);
    const { cards: afterCards, final: afterFinal } = await allQueuePages(wrappedReads, 2);
    expect(midReadDone).toBe(true);
    expect(records).toHaveLength(5);
    expect(fifthRecord).not.toBeNull();
    const fifth = fifthRecord!;
    expect(records[4]).toEqual(fifth);
    expect(fifth.task.taskId).toBe(K3_REVIEW_TASKS[4]);
    // F-032: the gate really was on Goal B's own real records read, and the
    // first page it saw was stale (four) while a retried window saw all five,
    // so a missing consistency retry would drop the Goal-B record entirely.
    expect(gateGoalId).toBe(GOAL_B.goalId);
    expect(gateStatus).toBe('needs_decision');
    expect(fifth.task.goalId).toBe(GOAL_B.goalId);
    expect(goalBNeedsDecisionReads[0]).toBe(4);
    expect(goalBNeedsDecisionReads.slice(1).some(count => count === 5)).toBe(true);

    // The retried window serves exactly the FIVE hand-written keys (the four
    // committed before the read and the one committed mid-read), no duplicates
    // and no extra. Counts are the hand-computed totals and complete.
    const fiveKeys = records.map(cardSourceKey);
    expect(fiveKeys).toHaveLength(5);
    expect(new Set(fiveKeys).size).toBe(5);
    const waitingAfter = afterCards.filter(card => card.source.kind === 'unknown_call_review'
      && card.state === 'waiting_answer');
    expect(waitingAfter).toHaveLength(5);
    expect(waitingAfter.map(card => card.source.kind)).toEqual(Array.from({ length: 5 },
      () => 'unknown_call_review'));
    expect(new Set(waitingAfter.map(card => card.source.key)).size).toBe(5);
    expect(waitingAfter.map(card => card.source.key).sort()).toEqual([...fiveKeys].sort());
    // Hand-computed total after the mid-read commit: the five review cards plus
    // the shared S5 fixture's four pre-existing waiting cards (unchanged).
    expect(afterFinal.counts.waitingAnswer).toBe(9);
    expect(afterFinal.countsComplete).toBe(true);

    // A fresh attempt of the queue's own source over the five records: asked
    // for 200 items (the queue's request), the configured pageLimit 2 still
    // caps each page, so it pages 2 + 2 + 1 with cursors '2', '4' and null in
    // that order, and the union is exactly the five keys.
    const attemptAfter = { cache: new Map<string, unknown>() };
    const pageOne = await wrappedCards.readPage(f.ctx, { workspace: WORKSPACE_SCOPE, goalRef: GOAL_B,
      page: { limit: 200, attempt: attemptAfter } });
    expect(pageOne).toMatchObject({ status: 'ready', value: { availability: 'available', nextCursor: '2' } });
    if (pageOne.status !== 'ready') return;
    expect(pageOne.value.items).toHaveLength(2);
    const pageTwo = await wrappedCards.readPage(f.ctx, { workspace: WORKSPACE_SCOPE, goalRef: GOAL_B,
      page: { limit: 200, cursor: '2', attempt: attemptAfter } });
    expect(pageTwo).toMatchObject({ status: 'ready', value: { nextCursor: '4' } });
    if (pageTwo.status !== 'ready') return;
    expect(pageTwo.value.items).toHaveLength(2);
    const pageThree = await wrappedCards.readPage(f.ctx, { workspace: WORKSPACE_SCOPE, goalRef: GOAL_B,
      page: { limit: 200, cursor: '4', attempt: attemptAfter } });
    expect(pageThree).toMatchObject({ status: 'ready', value: { nextCursor: null } });
    if (pageThree.status !== 'ready') return;
    expect(pageThree.value.items).toHaveLength(1);
    expect([...pageOne.value.items, ...pageTwo.value.items, ...pageThree.value.items]
      .map(card => card.source.key).sort()).toEqual([...fiveKeys].sort());

    // readDecisionCard reads the FIFTH card by key without paging (it is behind
    // the first source page), and its content matches the real record.
    const fifthCard = afterCards.find(card => card.source.key === cardSourceKey(fifth));
    expect(fifthCard).toBeDefined();
    if (fifthCard === undefined) return;
    const byKey = await readModel.readDecisionCard(f.ctx, { source: fifthCard.source });
    expect(byKey).toMatchObject({ status: 'ready', value: { state: 'waiting_answer',
      source: { kind: 'unknown_call_review', key: fifthCard.source.key },
      closedReason: null, readOnly: false, actions: ['answer'] } });
    if (byKey.status !== 'ready') return;
    expect(byKey.value.source.pins).toHaveLength(3);
    expect(byKey.value.source.pins.map(pin => pin.ref.aggregateType)).toEqual([
      'UnknownCallReview', 'Run', 'Goal',
    ]);
    expect(byKey.value.source.pins[0]).toEqual({ ref: fifth.ref, revision: fifth.revision });
    // The real record carries the one process item the Kernel produced, so its
    // card offers the proposable `safer_method` slot as well (the old hand-built
    // empty record had no proposal target).
    expect(byKey.value.options.map(option => option.id))
      .toEqual(['rerun_as_is', 'safer_method', 'skip_as_done', 'handle_myself']);
    expect(byKey.value.objects.map(object => object.kind)).toEqual(['aggregate']);
    expect(byKey.value.source.key).toContain(fifth.ref.runId);

  }, 120_000);
});

/**
 * F-026: the card source key written out as a literal (canonical JSON, sorted
 * keys), never produced by `decisionSourceKey`. Only the record's own ids and
 * revision are interpolated.
 */
function cardSourceKey(record: UnknownCallReviewV1): string {
  return `{"kind":"unknown_call_review","reviewRef":{"aggregateType":"UnknownCallReview",`
    + `"goalId":"${record.ref.goalId}","projectId":"${record.ref.projectId}",`
    + `"runId":"${record.ref.runId}"},"revision":${String(record.revision)}}`;
}

type ReadRecords = K3ReviewCardWorld['records'];

/**
 * The K3 fixture wires only the review-card source. This case still asserts
 * `countsComplete` (all sources wired), so the sources it does not exercise are
 * wired as empty, always-available adapters. They contribute no cards and no
 * notices; production wires the real adapters instead.
 */
function completeReadModel(records: ReadRecords, cardSources: readonly DecisionCardSourcePort[]) {
  return createDecisionReadModel({
    records,
    cardSources: [...cardSources,
      emptyCardSource('goal_cause'), emptyCardSource('note_review'),
      emptyCardSource('planning_question'), emptyCardSource('message_release'),
      emptyCardSource('command_rerun_request')],
    noticeSources: (['second_expiry', 'handoff', 'note_review', 'undelivered_reply', 'automatic_rework',
      'continuation'] as const).map(emptyNoticeSource),
    conflicts: createGoalConflictAssembler({ records, catalog: createArchitectureCatalogService({ records }),
      executedFiles: createGoalExecutedFilesReader({ records }) }),
    positions: createNoticePositionComparator(),
    displayTokens: createNoticeDisplayToken(new Uint8Array(32)),
  });
}

function emptyCardSource(kind: DecisionSourceV1['kind']): DecisionCardSourcePort {
  return {
    kind,
    needsGoal: true,
    async readPage() {
      return { status: 'ready' as const, value: { availability: 'available' as const, items: [],
        nextCursor: null, sourceCursor: null } };
    },
  };
}

function emptyNoticeSource(category: NoticeCategoryV1): DecisionNoticeSourcePort {
  return {
    category,
    async readPage() {
      return { status: 'ready' as const, value: { availability: 'available' as const, items: [],
        nextCursor: null, sourceCursor: null } };
    },
  };
}
