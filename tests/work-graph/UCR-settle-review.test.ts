/**
 * K3 §3.2 UCR-06/07/08c and L16 D6 at the owner level: `settleReview` reads the
 * round's Run (and pointer), reads the writing round's manifest for `display`,
 * and commits exactly one settled/round_unfinished change. Verified through the
 * public write and `readReview` ports.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { UnknownCallReviewItemV1, UnknownCallReviewRef, UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createRunReconcileService } from '../../src/core/work-graph/tasks/run-reconcile-service.js';
import {
  newUnknownCallReview, transitionUnknownCallReview,
} from '../../src/core/work-graph/state/unknown-call-review.js';
import {
  encodeUnknownCallReview, encodeUnknownCallReviewChangedEvent, unknownCallReviewRefKey,
  UNKNOWN_CALL_REVIEW_CHANGED_EVENT_TYPE, UNKNOWN_CALL_REVIEW_EVENT_SCHEMA_VERSION,
  UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS,
} from '../../src/core/work-graph/tasks/unknown-call-review-codecs.js';
import {
  createUnknownCallReviewService, type UnknownCallReviewDisplayReader,
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
  status: 'unavailable' as const, runBaselineKnown: false, reason: 'not_configured' as const, detail: 'ucr-settle',
};

function processItem(alias: number, observed: UnknownCallReviewItemV1['observed'] = { verdict: 'pending', by: null }): UnknownCallReviewItemV1 {
  const callId = `call-${String(alias)}`;
  return {
    alias, callId, toolName: 'shell', kind: 'process', contained: true,
    kernel: { adapterId: 'a', kernelSessionId: 'ks', kernelRunId: 'kr', turnId: 't',
      callId, declaredPosition: alias, startedPosition: alias },
    argumentsDigest: 'd'.repeat(64),
    summary: { command: 'echo hi', cwd: null, mode: null, paths: [], pathsOmitted: 0, truncated: false },
    startedAt: null, observed,
  };
}

type Fx = {
  b2: B2ExecutionFixture;
  admitted: B2Admitted;
  reviews: ReturnType<typeof createUnknownCallReviewService>;
  reconcile: ReturnType<typeof createRunReconcileService>;
  reviewRef: UnknownCallReviewRef;
  record: UnknownCallReviewV1;
  close(): Promise<void>;
};

async function fixture(kind: 'memory' | 'sqlite', items: UnknownCallReviewItemV1[],
  display?: UnknownCallReviewDisplayReader): Promise<Fx> {
  const b2 = await createB2ExecutionFixture(kind, REVIEW_SCHEMAS);
  const admitted = await b2.enter();
  const records = b2.base.records;
  const runRef = b2.claim.runRef;
  const reviewRef: UnknownCallReviewRef = {
    aggregateType: 'UnknownCallReview', projectId: runRef.projectId, goalId: runRef.goalId, runId: 'ucr-settle-origin',
  };
  const built = newUnknownCallReview({
    ref: reviewRef, workspaceId: b2.base.scope.workspaceId,
    task: { projectId: runRef.projectId, goalId: runRef.goalId, taskId: b2.claim.task.taskId },
    runRef: { aggregateType: 'Run', projectId: runRef.projectId, goalId: runRef.goalId, runId: reviewRef.runId },
    sessionRef: { projectId: runRef.projectId, sessionId: b2.claim.sessionRef.sessionId },
    origin: { kind: 'human_attested', attestedBy: { kind: 'human', id: 'u' }, reason: 'UCR-settle' },
    inventory: 'complete', inventoryProblem: null, items, itemsOmitted: 0, workspace: UNAVAILABLE,
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
  const record = claimed.next;
  const receipt = await records.commit({
    identityKey: 'ucr-settle-setup', fingerprint: 'ucr-settle-setup-fp',
    guards: [{ refKey: unknownCallReviewRefKey(reviewRef), expectedRevision: null }],
    records: [encodeUnknownCallReview(record)], claims: [], indexGuards: [], indexChanges: [],
    events: [encodeUnknownCallReviewChangedEvent({
      eventId: 'ucr-settle-setup-event', eventType: UNKNOWN_CALL_REVIEW_CHANGED_EVENT_TYPE,
      schemaVersion: UNKNOWN_CALL_REVIEW_EVENT_SCHEMA_VERSION, occurredAt: AT,
      identityKey: 'ucr-settle-setup', fingerprint: 'ucr-settle-setup-fp', actor: { kind: 'human', id: 'u' },
      requestId: 'ucr-settle-setup', change: 'round_claimed', review: record,
    })],
  });
  if (receipt.status !== 'committed') throw new Error(JSON.stringify(receipt));
  let seq = 0;
  const reads = createRunStateReader({ records });
  const eventId = () => `ucr-settle-event-${String(++seq)}`;
  const reconcile = createRunReconcileService({ records, reads,
    hostInstance: { hostInstanceId: 'ucr-settle-host', lease: 'owned',
      takeover: { kind: 'hl03_stale_lock', previousInstanceId: 'previous-host', previousPid: 42 } },
    now: () => AT, eventId });
  const reviews = createUnknownCallReviewService({
    records, lookups: records, reads,
    readReviewDisplays: display ?? (async () => ({ status: 'not_found' })),
    now: () => AT, eventId,
  });
  return { b2, admitted, reviews, reconcile, reviewRef, record, close: () => b2.close() };
}

/** Ends the round Run with a known Kernel terminal (completed). */
async function endRound(fx: Fx): Promise<void> {
  const result = await fx.b2.entry.recordRunResult(fx.b2.ctx, {
    input: fx.b2.terminalObservation(fx.admitted),
    meta: { requestId: 'ucr-settle-end', expected: [await fx.b2.pin()] },
  });
  if (result.status !== 'committed') throw new Error(`end round failed: ${JSON.stringify(result)}`);
}

/** Ends the round Run `crashed`: a known end that is not `completed`. */
async function endRoundCrashed(fx: Fx): Promise<void> {
  const observation = fx.b2.terminalObservation(fx.admitted);
  observation.event = fx.b2.terminalEvent({ eventType: 'run_crashed', eventId: 'ucr-settle-round-crash',
    payload: { kind: 'crashed', error: 'boom' } });
  const result = await fx.b2.entry.recordRunResult(fx.b2.ctx, { input: observation,
    meta: { requestId: 'ucr-settle-round-crash', expected: [await fx.b2.pin()] } });
  if (result.status !== 'committed') throw new Error(`crash round failed: ${JSON.stringify(result)}`);
}

/** RUN-20(i): the Kernel is unreadable, so the round Run ends `outcome_unknown`. */
async function markRoundUnknown(fx: Fx): Promise<void> {
  const result = await fx.reconcile.reconcileRun(fx.b2.ctx, { input: {
    runRef: fx.b2.claim.runRef, basis: { kind: 'host_instance_takeover', hostInstanceId: 'ucr-settle-host' },
    probe: 'missing', result: { kind: 'unknown', cause: 'kernel_unreadable', unresolvedToolCallIds: [],
      observedThroughPosition: null, turn: null } },
    meta: { requestId: 'ucr-settle-unknown', expected: [await fx.b2.pin()] } });
  expect(result, JSON.stringify(result)).toMatchObject({ status: 'committed',
    value: { status: 'ended', outcome: 'outcome_unknown' } });
}

/** UCR-15: the human holds the record while its round is still running. */
async function hold(fx: Fx): Promise<UnknownCallReviewV1> {
  const held = transitionUnknownCallReview(fx.record, { kind: 'hold_applied',
    answeredRevision: fx.record.revision, text: 'I will handle it' }, {
    expectedRevision: fx.record.revision, updatedAt: AT, actor: { kind: 'human', id: 'u' },
    activeRunEnded: false, activeRunCompleted: false, fenceHumanOnly: false, reviewUnavailable: false,
    autonomy: 'after_plan_confirmation', incompleteCommandAliases: [], missingSelfCheckAliases: [],
    originalRunSelected: false,
  });
  if (!held.ok) throw new Error(JSON.stringify(held));
  const receipt = await fx.b2.base.records.commit({
    identityKey: 'ucr-settle-hold', fingerprint: 'ucr-settle-hold-fp',
    guards: [{ refKey: unknownCallReviewRefKey(fx.reviewRef), expectedRevision: fx.record.revision }],
    records: [encodeUnknownCallReview(held.next)], claims: [], indexGuards: [], indexChanges: [],
    events: [encodeUnknownCallReviewChangedEvent({
      eventId: 'ucr-settle-hold-event', eventType: UNKNOWN_CALL_REVIEW_CHANGED_EVENT_TYPE,
      schemaVersion: UNKNOWN_CALL_REVIEW_EVENT_SCHEMA_VERSION, occurredAt: AT,
      identityKey: 'ucr-settle-hold', fingerprint: 'ucr-settle-hold-fp', actor: { kind: 'human', id: 'u' },
      requestId: 'ucr-settle-hold', change: 'hold_applied', review: held.next,
    })],
  });
  if (receipt.status !== 'committed') throw new Error(JSON.stringify(receipt));
  return held.next;
}

function settleRequest(reviewRef: UnknownCallReviewRef, cause: 'round_ended' | 'review_unavailable',
  requestId: string, revision: number) {
  return { input: { reviewRef, cause }, meta: { requestId, expected: [{ ref: reviewRef, revision }] } };
}

const FIXTURES: Fx[] = [];
afterEach(async () => { for (const open of FIXTURES.splice(0)) await open.close(); });
async function ready(kind: 'memory' | 'sqlite', items: UnknownCallReviewItemV1[] = [processItem(1)],
  display?: UnknownCallReviewDisplayReader): Promise<Fx> {
  const fx = await fixture(kind, items, display);
  FIXTURES.push(fx);
  return fx;
}

describe('UCR settlement owner', () => {
  it.each(['memory', 'sqlite'] as const)('UCR-07 %s: a normally ended round settles to needs_decision with pending items undetermined', async kind => {
    const fx = await ready(kind);
    await endRound(fx);
    const result = await fx.reviews.settleReview(fx.b2.ctx,
      settleRequest(fx.reviewRef, 'round_ended', 'ucr-settle-finished', fx.record.revision) as never);
    expect(result).toMatchObject({ status: 'committed', replayed: false, value: {
      status: 'needs_decision', activeRound: null, open: 'yes', decisionReasons: ['undetermined', 'crash_undetermined'],
      rounds: [{ phase: 'review', round: 1, result: 'finished' }],
      items: [{ alias: 1, observed: { verdict: 'undetermined', by: 'settlement', evidence: '核对轮没有给出结论' } }],
    } });
  });

  it.each(['memory', 'sqlite'] as const)('UCR-07 %s: review_unavailable with no active round settles and names the reason', async kind => {
    const fx = await ready(kind);
    const record = fx.record;
    // Remove the active round: the third trigger has no round to run.
    const idle: UnknownCallReviewV1 = { ...record, activeRound: null, revision: record.revision + 1 };
    const receipt = await fx.b2.base.records.commit({
      identityKey: 'ucr-settle-idle', fingerprint: 'ucr-settle-idle-fp',
      guards: [{ refKey: unknownCallReviewRefKey(fx.reviewRef), expectedRevision: record.revision }],
      records: [encodeUnknownCallReview(idle)], claims: [], indexGuards: [], indexChanges: [],
      events: [encodeUnknownCallReviewChangedEvent({
        eventId: 'ucr-settle-idle-event', eventType: UNKNOWN_CALL_REVIEW_CHANGED_EVENT_TYPE,
        schemaVersion: UNKNOWN_CALL_REVIEW_EVENT_SCHEMA_VERSION, occurredAt: AT,
        identityKey: 'ucr-settle-idle', fingerprint: 'ucr-settle-idle-fp', actor: { kind: 'human', id: 'u' },
        requestId: 'ucr-settle-idle', change: 'settled', review: idle,
      })],
    });
    expect(receipt.status).toBe('committed');
    const result = await fx.reviews.settleReview(fx.b2.ctx,
      settleRequest(fx.reviewRef, 'review_unavailable', 'ucr-settle-unavailable', idle.revision) as never);
    expect(result).toMatchObject({ status: 'committed', value: {
      status: 'needs_decision', decisionReasons: ['review_unavailable', 'undetermined', 'crash_undetermined'], activeRound: null,
    } });
  });

  it.each(['memory', 'sqlite'] as const)('UCR-06 %s: an outcome_unknown round is busy and writes nothing', async kind => {
    const fx = await ready(kind);
    await markRoundUnknown(fx);
    const before = await fx.reviews.readReview(fx.b2.ctx, { ref: fx.reviewRef });
    const result = await fx.reviews.settleReview(fx.b2.ctx,
      settleRequest(fx.reviewRef, 'round_ended', `ucr-settle-unknown-${kind}`, fx.record.revision) as never);
    expect(result).toMatchObject({ status: 'rejected', code: 'busy' });
    expect(await fx.reviews.readReview(fx.b2.ctx, { ref: fx.reviewRef })).toEqual(before);
  });

  it.each(['memory', 'sqlite'] as const)('UCR-08b %s: a held resolved record settles with the fixed no-conclusion evidence', async kind => {
    const fx = await ready(kind);
    const held = await hold(fx);
    await endRoundCrashed(fx);
    const result = await fx.reviews.settleReview(fx.b2.ctx,
      settleRequest(fx.reviewRef, 'round_ended', `ucr-settle-held-${kind}`, held.revision) as never);
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
    const concluded = processItem(1, {
      verdict: 'done', by: 'review_round', evidence: 'it ran', roundRunRef: { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: 'round-run' },
      crashSuspicion: { verdict: 'unlikely', evidence: 'no trace' }, reviewerConclusion: null,
    });
    const fx = await ready(kind, [concluded], async () => ({ status: 'ready', value: new Map([[1, 'truncated']]) }));
    await endRound(fx);
    const result = await fx.reviews.settleReview(fx.b2.ctx,
      settleRequest(fx.reviewRef, 'round_ended', 'ucr-settle-d6', fx.record.revision) as never);
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
    const concluded = processItem(1, {
      verdict: 'done', by: 'review_round', evidence: 'it ran', roundRunRef: { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: 'round-run' },
      crashSuspicion: { verdict: 'unlikely', evidence: 'no trace' }, reviewerConclusion: null,
    });
    const fx = await ready(kind, [concluded], async () => ({ status: 'not_found' }));
    await endRound(fx);
    const before = await fx.reviews.readReview(fx.b2.ctx, { ref: fx.reviewRef });
    const result = await fx.reviews.settleReview(fx.b2.ctx,
      settleRequest(fx.reviewRef, 'round_ended', 'ucr-settle-d6-bad', fx.record.revision) as never);
    expect(result).toMatchObject({ status: 'rejected', code: 'unavailable' });
    expect(await fx.reviews.readReview(fx.b2.ctx, { ref: fx.reviewRef })).toEqual(before);
  });

  it('L16 D6: the per-round display map is read once for a multi-item round', async () => {
    let calls = 0;
    const roundRunRef = { aggregateType: 'Run' as const, projectId: 'p', goalId: 'g', runId: 'round-run' };
    const items = [1, 2].map(alias => processItem(alias, {
      verdict: 'done', by: 'review_round', evidence: 'it ran', roundRunRef,
      crashSuspicion: { verdict: 'unlikely', evidence: 'no trace' }, reviewerConclusion: null,
    }));
    const fx = await ready('memory', items, async () => {
      calls += 1;
      return { status: 'ready', value: new Map([[1, 'full'], [2, 'full']]) };
    });
    await endRound(fx);
    const result = await fx.reviews.settleReview(fx.b2.ctx,
      settleRequest(fx.reviewRef, 'round_ended', 'ucr-settle-read-once', fx.record.revision) as never);
    expect(result).toMatchObject({ status: 'committed', value: { status: 'resolved' } });
    expect(calls).toBe(1);
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

function concludedProcessItem(cell: K310Cell): UnknownCallReviewItemV1 {
  return processItem(1, {
    verdict: cell.verdict, by: 'review_round', evidence: `K3-10 evidence for ${cell.verdict}`,
    roundRunRef: { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: 'round-run' },
    crashSuspicion: { verdict: cell.crash, evidence: `K3-10 self-check for ${cell.crash}` },
    reviewerConclusion: null,
  });
}

describe('K3-10 conclusion × crash self-check settlement matrix', () => {
  for (const kind of ['memory', 'sqlite'] as const) {
    it.each(K3_10_CELLS)(`K3-10 ${kind} $verdict+$crash`, async cell => {
      // One process item per cell; the Goal reads the default
      // `after_plan_confirmation` and the streak has no prior unknown process,
      // so neither `confirm_each_step` nor `second_consecutive` may appear.
      const fx = await ready(kind, [concludedProcessItem(cell)],
        async () => ({ status: 'ready', value: new Map([[1, 'full']]) }));
      await endRound(fx);
      const status = cell.reasons.length === 0 ? 'resolved' : 'needs_decision';
      const result = await fx.reviews.settleReview(fx.b2.ctx,
        settleRequest(fx.reviewRef, 'round_ended', `k3-10-${kind}-${cell.verdict}-${cell.crash}`,
          fx.record.revision) as never);
      expect(result).toMatchObject({ status: 'committed', replayed: false,
        value: { status, decisionReasons: cell.reasons, activeRound: null,
          items: [{ alias: 1, observed: { verdict: cell.verdict, crashSuspicion: { verdict: cell.crash } } }] } });
      const read = await fx.reviews.readReview(fx.b2.ctx, { ref: fx.reviewRef });
      if (read.status !== 'ready') throw new Error(`K3-10 readReview: ${JSON.stringify(read)}`);
      expect(read.value.status).toBe(status);
      expect(read.value.decisionReasons).toEqual(cell.reasons);
      expect(read.value.open).toBe(status === 'resolved' ? 'no' : 'yes');
      expect(read.value.items[0]?.observed).toMatchObject({ verdict: cell.verdict,
        crashSuspicion: { verdict: cell.crash } });
    });
  }
});
