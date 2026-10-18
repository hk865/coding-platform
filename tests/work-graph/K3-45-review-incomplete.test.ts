/**
 * K3-45 (一) (L9/L15/L16/L17, spec §3.2 UCR-07): the SECOND unfinished review
 * round of one `stateEntry` settles `needs_decision` with `review_incomplete`
 * even though every process item already carries a conclusion written by the
 * round. The per-round conclusions are not lost and the item is not re-judged.
 *
 * The record is built through the REAL state machine (claim round 1 → the round
 * ends `unfinished` → claim round 2 → write a conclusion for every item) and
 * committed once; the round-2 Run is the real B2 claim Run, entered and then
 * ended `crashed` (a known end that is not `completed`). `settleReview` is the
 * real owner, read back through `readReview` (never SQLite).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type {
  CrashSuspicionV1, UnknownCallReviewItemV1, UnknownCallReviewRef, UnknownCallReviewV1,
} from '../../src/contracts/unknown-call-review.js';
import {
  newUnknownCallReview, transitionUnknownCallReview, type UnknownCallReviewContextV1,
  type UnknownCallReviewEvent,
} from '../../src/core/work-graph/state/unknown-call-review.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import {
  encodeUnknownCallReview, encodeUnknownCallReviewChangedEvent, unknownCallReviewRefKey,
  UNKNOWN_CALL_REVIEW_CHANGED_EVENT_TYPE, UNKNOWN_CALL_REVIEW_EVENT_SCHEMA_VERSION,
  UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS,
} from '../../src/core/work-graph/tasks/unknown-call-review-codecs.js';
import {
  createUnknownCallReviewService,
  type UnknownCallReviewDisplayReader,
} from '../../src/core/work-graph/tasks/unknown-call-review-service.js';
import type { RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import { createB2ExecutionFixture, type B2ExecutionFixture, type B2Admitted } from '../helpers/B2-execution-fixture.js';

const AT = '2026-10-20T00:00:00.000Z';
const REVIEW_SCHEMAS: RecordBackendSchemas = {
  records: [...UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.records],
  events: [...UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.events],
  lookups: [...(UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.lookups ?? [])],
};
const UNAVAILABLE = {
  status: 'unavailable' as const, runBaselineKnown: false, reason: 'not_configured' as const, detail: 'k3-45',
};

function processItem(alias: number): UnknownCallReviewItemV1 {
  const callId = `call-${String(alias)}`;
  return {
    alias, callId, toolName: 'shell', kind: 'process', contained: true,
    kernel: { adapterId: 'a', kernelSessionId: 'ks', kernelRunId: 'kr', turnId: 't',
      callId, declaredPosition: alias, startedPosition: alias },
    argumentsDigest: 'd'.repeat(64),
    summary: { command: 'echo hi', cwd: null, mode: null, paths: [], pathsOmitted: 0, truncated: false },
    startedAt: null, observed: { verdict: 'pending', by: null },
  };
}

type Fx = {
  b2: B2ExecutionFixture;
  admitted: B2Admitted;
  reviews: ReturnType<typeof createUnknownCallReviewService>;
  reviewRef: UnknownCallReviewRef;
  close(): Promise<void>;
};

async function fixture(kind: 'memory' | 'sqlite', items: UnknownCallReviewItemV1[],
  display?: UnknownCallReviewDisplayReader): Promise<Fx> {
  const b2 = await createB2ExecutionFixture(kind, REVIEW_SCHEMAS);
  const admitted = await b2.enter();
  const records = b2.base.records;
  const runRef = b2.claim.runRef;
  const reviewRef: UnknownCallReviewRef = {
    aggregateType: 'UnknownCallReview', projectId: runRef.projectId, goalId: runRef.goalId, runId: 'k3-45-origin',
  };
  const reads = createRunStateReader({ records });
  let seq = 0;
  const reviews = createUnknownCallReviewService({
    records, lookups: records, reads,
    readReviewDisplays: display ?? (async () => ({ status: 'not_found' })),
    now: () => AT, eventId: () => `k3-45-event-${String(++seq)}`,
  });
  return { b2, admitted, reviews, reviewRef, close: () => b2.close() };
}

const run = (projectId: string, goalId: string, runId: string): RunRef =>
  ({ aggregateType: 'Run', projectId, goalId, runId });

/**
 * Builds the L9 "second unfinished round in one stateEntry" record through the
 * real state machine: round 1 is claimed and ends `unfinished`; round 2 is
 * claimed on `activeRunRef` and every process item gets a `done/unlikely`
 * conclusion (the spec's "written all its conclusions, then interrupted").
 */
function secondUnfinishedRecord(input: {
  ref: UnknownCallReviewRef; workspaceId: string; task: UnknownCallReviewV1['task'];
  originRunRef: RunRef; sessionRef: UnknownCallReviewV1['sessionRef'];
  activeRunRef: RunRef; items: UnknownCallReviewItemV1[];
}): UnknownCallReviewV1 {
  const built = newUnknownCallReview({
    ref: input.ref, workspaceId: input.workspaceId, task: input.task, runRef: input.originRunRef,
    sessionRef: input.sessionRef,
    origin: { kind: 'human_attested', attestedBy: { kind: 'human', id: 'u' }, reason: 'K3-45' },
    inventory: 'complete', inventoryProblem: null, items: input.items, itemsOmitted: 0,
    workspace: UNAVAILABLE, streak: { priorAutoCleanup: false, priorUnknownProcess: false, resetRunRef: null },
    createdAt: AT,
  });
  if (!built.ok) throw new Error(JSON.stringify(built));

  const ctx = (current: UnknownCallReviewV1, overrides: Partial<UnknownCallReviewContextV1> = {}): UnknownCallReviewContextV1 => ({
    expectedRevision: current.revision, updatedAt: AT, actor: { kind: 'human', id: 'u' },
    activeRunEnded: false, activeRunCompleted: false, fenceHumanOnly: false, reviewUnavailable: false,
    autonomy: 'after_plan_confirmation', incompleteCommandAliases: [], missingSelfCheckAliases: [],
    originalRunSelected: true, ...overrides,
  });
  const step = (current: UnknownCallReviewV1, event: UnknownCallReviewEvent,
    overrides: Partial<UnknownCallReviewContextV1> = {}): UnknownCallReviewV1 => {
    const result = transitionUnknownCallReview(current, event, ctx(current, overrides));
    if (!result.ok) throw new Error(`transition ${event.kind}: ${JSON.stringify(result)}`);
    return result.next;
  };

  // Round 1 of this stateEntry: claimed, then ended `unfinished`.
  const firstRun = run(input.ref.projectId, input.ref.goalId, 'k3-45-round-1');
  const claimed1 = step(built.next, { kind: 'round_claimed', runRef: firstRun, phase: 'review', round: 1 });
  const unfinished = step(claimed1, { kind: 'round_unfinished' },
    { activeRunEnded: true, activeRunCompleted: false, fenceHumanOnly: false });
  // Round 2 of the same stateEntry: claimed on the real Run.
  const claimed2 = step(unfinished, { kind: 'round_claimed', runRef: input.activeRunRef, phase: 'review', round: 2 });
  // Every item already has a conclusion (done / unlikely) when this round is cut off.
  return input.items.reduce((current, item) => step(current, {
    kind: 'conclusion_recorded', alias: item.alias, verdict: 'done',
    evidence: `K3-45 round 2 concluded #${String(item.alias)}`,
    roundRunRef: input.activeRunRef,
    crashSuspicion: { verdict: 'unlikely', evidence: 'the command leaves no crash trace' } as CrashSuspicionV1,
  }), claimed2);
}

/** Commits the built record (the fixture's setup write). */
async function commitRecord(fx: Fx, record: UnknownCallReviewV1): Promise<void> {
  const receipt = await fx.b2.base.records.commit({
    identityKey: 'k3-45-setup', fingerprint: 'k3-45-setup-fp',
    guards: [{ refKey: unknownCallReviewRefKey(fx.reviewRef), expectedRevision: null }],
    records: [encodeUnknownCallReview(record)], claims: [], indexGuards: [], indexChanges: [],
    events: [encodeUnknownCallReviewChangedEvent({
      eventId: 'k3-45-setup-event', eventType: UNKNOWN_CALL_REVIEW_CHANGED_EVENT_TYPE,
      schemaVersion: UNKNOWN_CALL_REVIEW_EVENT_SCHEMA_VERSION, occurredAt: AT,
      identityKey: 'k3-45-setup', fingerprint: 'k3-45-setup-fp', actor: { kind: 'human', id: 'u' },
      requestId: 'k3-45-setup', change: 'conclusion_recorded', review: record,
    })],
  });
  if (receipt.status !== 'committed') throw new Error(JSON.stringify(receipt));
}

/** Ends the active round Run `crashed`: a known end that is not `completed`. */
async function endRoundCrashed(fx: Fx): Promise<void> {
  const observation = fx.b2.terminalObservation(fx.admitted);
  observation.event = fx.b2.terminalEvent({ eventType: 'run_crashed', eventId: 'k3-45-round-crash',
    payload: { kind: 'crashed', error: 'boom' } });
  const result = await fx.b2.entry.recordRunResult(fx.b2.ctx, { input: observation,
    meta: { requestId: 'k3-45-round-crash', expected: [await fx.b2.pin()] } });
  if (result.status !== 'committed') throw new Error(`crash round failed: ${JSON.stringify(result)}`);
}

const FIXTURES: Fx[] = [];
afterEach(async () => { for (const open of FIXTURES.splice(0)) await open.close(); });
async function ready(kind: 'memory' | 'sqlite', items: UnknownCallReviewItemV1[],
  display?: UnknownCallReviewDisplayReader): Promise<Fx> {
  const fx = await fixture(kind, items, display);
  FIXTURES.push(fx);
  return fx;
}

describe('K3-45 (一) review_incomplete', () => {
  it.each(['memory', 'sqlite'] as const)(
    'K3-45 (一) %s: two unfinished rounds in one stateEntry settle needs_decision with review_incomplete although every item has a conclusion',
    async kind => {
      const items = [processItem(1), processItem(2)];
      const fx = await ready(kind, items, async () => ({ status: 'ready', value: new Map([[1, 'full'], [2, 'full']]) }));
      const runRef = fx.b2.claim.runRef;
      const originRunRef = run(runRef.projectId, runRef.goalId, fx.reviewRef.runId);
      const record = secondUnfinishedRecord({
        ref: fx.reviewRef, workspaceId: fx.b2.base.scope.workspaceId, task: fx.b2.claim.task,
        originRunRef, sessionRef: { projectId: runRef.projectId, sessionId: fx.b2.claim.sessionRef.sessionId },
        activeRunRef: runRef, items,
      });
      // Every item truly carries the round's conclusion before this round is cut off.
      expect(record.items.map(item => item.observed)).toEqual([
        expect.objectContaining({ verdict: 'done', by: 'review_round' }),
        expect.objectContaining({ verdict: 'done', by: 'review_round' }),
      ]);
      expect(record.rounds.map(round => round.result)).toEqual(['unfinished']);
      expect(record.stateEntry).toBe(1);
      await commitRecord(fx, record);
      await endRoundCrashed(fx);

      const result = await fx.reviews.settleReview(fx.b2.ctx, {
        input: { reviewRef: fx.reviewRef, cause: 'round_ended' },
        meta: { requestId: 'k3-45-settle', expected: [{ ref: fx.reviewRef, revision: record.revision }] },
      } as never);
      expect(result).toMatchObject({ status: 'committed', value: {
        status: 'needs_decision', open: 'yes', activeRound: null,
        decisionReasons: ['review_incomplete'],
        rounds: [{ result: 'unfinished' }, { result: 'unfinished' }],
      } });
      if (result.status !== 'committed') throw new Error(JSON.stringify(result));
      // The literal L17 reason is present and the conclusions are untouched.
      expect(result.value.decisionReasons).toContain('review_incomplete');
      expect(result.value.items.map(item => item.observed)).toEqual([
        expect.objectContaining({ verdict: 'done', by: 'review_round' }),
        expect.objectContaining({ verdict: 'done', by: 'review_round' }),
      ]);

      const read = await fx.reviews.readReview(fx.b2.ctx, { ref: fx.reviewRef });
      if (read.status !== 'ready') throw new Error(`readReview: ${JSON.stringify(read)}`);
      expect(read.value.status).toBe('needs_decision');
      expect(read.value.decisionReasons).toEqual(['review_incomplete']);
      expect(read.value.rounds.map(round => round.result)).toEqual(['unfinished', 'unfinished']);
      expect(read.value.items.every(item => item.observed.by === 'review_round')).toBe(true);
    },
  );
});
