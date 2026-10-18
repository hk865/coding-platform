/**
 * K3-11 (L17, spec line 1425; R2): every L17 decision reason that K3-11 owns
 * appears ONCE alone, and one record carries THREE reasons and lists them in the
 * fixed write order. The reasons are pure outputs of the real state machine:
 * `inventory_incomplete` is the UCR-02 creation reason (a `needs_decision`
 * record cannot claim a round, so it is the only record that can carry it), and
 * the settlement reasons come from `createUnknownCallReviewService.settleReview`
 * over the real `transitionUnknownCallReview`.
 *
 * The rows' own R2 cases live in K3-19 (`review_unavailable`) and K3-45
 * (`review_incomplete`); this file shows K3-11's own single occurrence at the
 * owner seam. The `confirm_each_step` reason is read from the Goal's real
 * `settings.autonomy`; the R2 case in `tests/scenarios/K3-11-review-reasons-r2.test.ts`
 * drives it through the Workflow. The card/disposition parts are group 4.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type {
  CrashSuspicionV1, UnknownCallInventoryProblemV1, UnknownCallObservationV1, UnknownCallReviewDraftV1,
  UnknownCallReviewItemV1, UnknownCallReviewRef, UnknownCallReviewV1,
} from '../../src/contracts/unknown-call-review.js';
import { transitionUnknownCallReview, newUnknownCallReview } from '../../src/core/work-graph/state/unknown-call-review.js';
import {
  encodeUnknownCallReview, encodeUnknownCallReviewChangedEvent, unknownCallReviewRefKey,
  UNKNOWN_CALL_REVIEW_CHANGED_EVENT_TYPE, UNKNOWN_CALL_REVIEW_EVENT_SCHEMA_VERSION,
  UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS,
} from '../../src/core/work-graph/tasks/unknown-call-review-codecs.js';
import {
  createUnknownCallReviewService,
} from '../../src/core/work-graph/tasks/unknown-call-review-service.js';
import { createGoalSettingsService } from '../../src/core/work-graph/tasks/goal-settings-service.js';
import { createRunReconcileService } from '../../src/core/work-graph/tasks/run-reconcile-service.js';
import { DECISION_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/decision-record-codecs.js';
import { CONTROL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/control-record-codecs.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import type { RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import { createB2ExecutionFixture, type B2ExecutionFixture, type B2Admitted } from '../helpers/B2-execution-fixture.js';

const AT = '2026-10-20T00:00:00.000Z';
const REVIEW_SCHEMAS: RecordBackendSchemas = {
  records: [...UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.records, ...CONTROL_RECORD_SCHEMAS.records],
  events: [...UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.events, ...DECISION_RECORD_SCHEMAS.events, ...CONTROL_RECORD_SCHEMAS.events],
  lookups: [...(UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.lookups ?? []), ...(CONTROL_RECORD_SCHEMAS.lookups ?? [])],
};
const UNAVAILABLE = {
  status: 'unavailable' as const, runBaselineKnown: false, reason: 'not_configured' as const, detail: 'k3-11',
};

/** The L17 literal order (spec L17, the `UnknownCallDecisionReasonV1` write order). */
const L17_ORDER = [
  'inventory_incomplete', 'review_stopped', 'review_incomplete', 'review_unavailable',
  'partial', 'undetermined', 'crash_possible', 'crash_undetermined',
  'second_consecutive', 'confirm_each_step', 'proposal_missing', 'proposal_declined',
] as const;

function processItem(
  alias: number,
  observed: UnknownCallObservationV1 = { verdict: 'pending', by: null },
): UnknownCallReviewItemV1 {
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

const ROUND_RUN = { aggregateType: 'Run' as const, projectId: 'p', goalId: 'g', runId: 'k3-11-round' };

/** A conclusion written by a review round (L16's normal `settle` input). */
function reviewRoundConclusion(
  verdict: 'done' | 'not_done' | 'partial' | 'undetermined',
  crash: CrashSuspicionV1['verdict'] = 'unlikely',
): UnknownCallObservationV1 {
  return {
    verdict, by: 'review_round', evidence: `K3-11 ${verdict}`,
    roundRunRef: ROUND_RUN, crashSuspicion: { verdict: crash, evidence: `K3-11 self-check ${crash}` },
    reviewerConclusion: null,
  };
}

type Fx = {
  b2: B2ExecutionFixture;
  admitted: B2Admitted;
  reviews: ReturnType<typeof createUnknownCallReviewService>;
  reviewRef: UnknownCallReviewRef;
  created: UnknownCallReviewV1;
  record: UnknownCallReviewV1;
  close(): Promise<void>;
};

type FixtureOptions = {
  items: UnknownCallReviewItemV1[];
  inventory?: 'complete' | 'incomplete';
  inventoryProblem?: UnknownCallReviewV1['inventoryProblem'];
  priorUnknownProcess?: boolean;
  autonomy?: 'after_plan_confirmation' | 'every_step';
  /** false keeps the creation record idle (`pending_review`, no active round). */
  claim?: boolean;
};

async function fixture(kind: 'memory' | 'sqlite', options: FixtureOptions): Promise<Fx> {
  const b2 = await createB2ExecutionFixture(kind, REVIEW_SCHEMAS);
  const admitted = await b2.enter();
  const records = b2.base.records;
  const runRef = b2.claim.runRef;
  const reviewRef: UnknownCallReviewRef = {
    aggregateType: 'UnknownCallReview', projectId: runRef.projectId, goalId: runRef.goalId, runId: 'k3-11-origin',
  };
  const built = newUnknownCallReview({
    ref: reviewRef, workspaceId: b2.base.scope.workspaceId,
    task: { projectId: runRef.projectId, goalId: runRef.goalId, taskId: b2.claim.task.taskId },
    runRef: { aggregateType: 'Run', projectId: runRef.projectId, goalId: runRef.goalId, runId: reviewRef.runId },
    sessionRef: { projectId: runRef.projectId, sessionId: b2.claim.sessionRef.sessionId },
    origin: { kind: 'human_attested', attestedBy: { kind: 'human', id: 'u' }, reason: 'K3-11' },
    inventory: options.inventory ?? 'complete', inventoryProblem: options.inventoryProblem ?? null,
    items: options.items, itemsOmitted: 0, workspace: UNAVAILABLE,
    streak: { priorAutoCleanup: false, priorUnknownProcess: options.priorUnknownProcess ?? false, resetRunRef: null },
    createdAt: AT,
  });
  if (!built.ok) throw new Error(JSON.stringify(built));
  const baseCtx = {
    expectedRevision: built.next.revision, updatedAt: AT, actor: { kind: 'human' as const, id: 'u' },
    activeRunEnded: false, activeRunCompleted: false, fenceHumanOnly: false, reviewUnavailable: false,
    autonomy: options.autonomy ?? 'after_plan_confirmation', incompleteCommandAliases: [] as number[],
    missingSelfCheckAliases: [] as number[], originalRunSelected: false,
  };
  const created = built.next;
  let record = created;
  let seq = 0;
  if (options.claim !== false) {
    const claimed = transitionUnknownCallReview(created, { kind: 'round_claimed', runRef, phase: 'review', round: 1 },
      { ...baseCtx, expectedRevision: created.revision });
    if (!claimed.ok) throw new Error(JSON.stringify(claimed));
    await commit(records, claimed.next, 'round_claimed', 'claim-1', null);
    record = claimed.next;
  } else {
    await commit(records, created, 'created', 'create', null);
  }
  if (options.autonomy === 'every_step') await setEveryStep(b2, reviewRef);
  const reads = createRunStateReader({ records });
  const reviews = createUnknownCallReviewService({
    records, lookups: records, reads,
    readReviewDisplays: async () => ({ status: 'ready', value: new Map(options.items.map(item => [item.alias, 'full' as const])) }),
    now: () => AT, eventId: () => `k3-11-event-${String(++seq)}`,
  });
  return { b2, admitted, reviews, reviewRef, created, record, close: () => b2.close() };
}

async function commit(
  records: B2ExecutionFixture['base']['records'], next: UnknownCallReviewV1,
  change: Parameters<typeof encodeUnknownCallReviewChangedEvent>[0]['change'], suffix: string,
  expectedRevision: number | null = next.revision - 1,
): Promise<void> {
  const id = `k3-11-${suffix}`;
  const receipt = await records.commit({
    identityKey: id, fingerprint: `${id}-fp`,
    guards: [{ refKey: unknownCallReviewRefKey(next.ref), expectedRevision }],
    records: [encodeUnknownCallReview(next)], claims: [], indexGuards: [], indexChanges: [],
    events: [encodeUnknownCallReviewChangedEvent({
      eventId: `${id}-event`, eventType: UNKNOWN_CALL_REVIEW_CHANGED_EVENT_TYPE,
      schemaVersion: UNKNOWN_CALL_REVIEW_EVENT_SCHEMA_VERSION, occurredAt: AT,
      identityKey: id, fingerprint: `${id}-fp`, actor: { kind: 'human', id: 'u' },
      requestId: id, change, review: next,
    })],
  });
  if (receipt.status !== 'committed') throw new Error(JSON.stringify(receipt));
}

async function setEveryStep(b2: B2ExecutionFixture, reviewRef: UnknownCallReviewRef): Promise<void> {
  const goalRef: GoalRef = { aggregateType: 'Goal', projectId: reviewRef.projectId, goalId: reviewRef.goalId };
  const detail = await b2.base.plans.queryGoal(b2.ctx, goalRef);
  if (detail.status !== 'ready') throw new Error(`K3-11 goal read: ${JSON.stringify(detail)}`);
  let seq = 0;
  const settings = createGoalSettingsService({
    records: b2.base.records, now: () => AT, newId: () => `k3-11-goal-id-${String(++seq)}`,
    operatorActor: { kind: 'human', id: 'r4c-claim-operator' },
  });
  const result = await settings.setGoalSettings(b2.ctx, { input: {
    goalRef, autonomy: 'every_step', waitForGoalRef: null,
  }, meta: { requestId: 'k3-11-autonomy', expected: [{ ref: goalRef, revision: detail.value.goal.revision }] } });
  if (result.status !== 'committed') throw new Error(`K3-11 autonomy: ${JSON.stringify(result)}`);
}

/** Ends the round Run with a known Kernel terminal (completed). */
async function endRound(fx: Fx): Promise<void> {
  const result = await fx.b2.entry.recordRunResult(fx.b2.ctx, {
    input: fx.b2.terminalObservation(fx.admitted),
    meta: { requestId: 'k3-11-end', expected: [await fx.b2.pin()] },
  });
  if (result.status !== 'committed') throw new Error(`end round failed: ${JSON.stringify(result)}`);
}

/** Ends the round Run `crashed`: a known end that is not `completed`. */
async function endRoundCrashed(fx: Fx): Promise<void> {
  const observation = fx.b2.terminalObservation(fx.admitted);
  observation.event = fx.b2.terminalEvent({ eventType: 'run_crashed', eventId: 'k3-11-round-crash',
    payload: { kind: 'crashed', error: 'boom' } });
  const result = await fx.b2.entry.recordRunResult(fx.b2.ctx, { input: observation,
    meta: { requestId: 'k3-11-round-crash', expected: [await fx.b2.pin()] } });
  if (result.status !== 'committed') throw new Error(`crash round failed: ${JSON.stringify(result)}`);
}

/** Claims the next round at the current record revision (the Workflow's UCR-03 seam). */
async function claimRound(fx: Fx, current: UnknownCallReviewV1, round: number): Promise<UnknownCallReviewV1> {
  const transition = transitionUnknownCallReview(current, {
    kind: 'round_claimed', runRef: fx.b2.claim.runRef, phase: 'review', round,
  }, {
    expectedRevision: current.revision, updatedAt: AT, actor: { kind: 'human', id: 'u' },
    activeRunEnded: false, activeRunCompleted: false, fenceHumanOnly: false, reviewUnavailable: false,
    autonomy: 'after_plan_confirmation', incompleteCommandAliases: [], missingSelfCheckAliases: [],
    originalRunSelected: false,
  });
  if (!transition.ok) throw new Error(JSON.stringify(transition));
  await commit(fx.b2.base.records, transition.next, 'round_claimed', `claim-${String(round)}`);
  return transition.next;
}

async function settle(fx: Fx, cause: 'round_ended' | 'review_unavailable', requestId: string) {
  const read = await fx.reviews.readReview(fx.b2.ctx, { ref: fx.reviewRef });
  if (read.status !== 'ready') throw new Error(`K3-11 readReview: ${JSON.stringify(read)}`);
  return fx.reviews.settleReview(fx.b2.ctx, {
    input: { reviewRef: fx.reviewRef, cause }, meta: { requestId, expected: [{ ref: fx.reviewRef, revision: read.value.revision }] },
  });
}

const FIXTURES: Fx[] = [];
afterEach(async () => { for (const open of FIXTURES.splice(0)) await open.close(); });
async function ready(kind: 'memory' | 'sqlite', options: FixtureOptions): Promise<Fx> {
  const fx = await fixture(kind, options);
  FIXTURES.push(fx);
  return fx;
}

// --------------------------------------------------------------------------
// R4-owner: `inventory_incomplete` through the real RUN-22 attestation entry
// --------------------------------------------------------------------------

type OwnerFx = {
  b2: B2ExecutionFixture;
  reconcile: ReturnType<typeof createRunReconcileService>;
  reviews: ReturnType<typeof createUnknownCallReviewService>;
  close(): Promise<void>;
};

/** The K3-26 owner fixture: the real RUN-22 owner over the real stores. */
async function ownerFixture(kind: 'memory' | 'sqlite'): Promise<OwnerFx> {
  const b2 = await createB2ExecutionFixture(kind, REVIEW_SCHEMAS);
  const records = b2.base.records;
  const reads = createRunStateReader({ records });
  let seq = 0;
  const reconcile = createRunReconcileService({ records, reads,
    hostInstance: { hostInstanceId: 'k3-11-owner-host', lease: 'owned',
      takeover: { kind: 'hl03_stale_lock', previousInstanceId: 'previous-host', previousPid: 42 } },
    now: () => AT, eventId: () => `k3-11-owner-event-${String(++seq)}` });
  const reviews = createUnknownCallReviewService({ records, reads,
    readReviewDisplays: async () => ({ status: 'ready', value: new Map([[1, 'full']]) }),
    now: () => AT, eventId: () => `k3-11-owner-review-${String(++seq)}` });
  return { b2, reconcile, reviews, close: () => b2.close() };
}

/** RUN-20(i): the Kernel was unreadable at stop, so the Run ends `outcome_unknown`. */
async function markUnknown(f: OwnerFx): Promise<void> {
  await f.b2.enter();
  const result = await f.reconcile.reconcileRun(f.b2.ctx, { input: {
    runRef: f.b2.claim.runRef, basis: { kind: 'host_instance_takeover', hostInstanceId: 'k3-11-owner-host' },
    probe: 'missing',
    result: { kind: 'unknown', cause: 'kernel_unreadable', unresolvedToolCallIds: [], observedThroughPosition: null,
      turn: null } },
    meta: { requestId: 'k3-11-owner-unknown', expected: [await f.b2.pin()] } });
  expect(result, JSON.stringify(result)).toMatchObject({ status: 'committed',
    value: { status: 'ended', outcome: 'outcome_unknown' } });
}

/** The `inputsConfirmed: true` (Kernel readable) draft the attestation entry passes to the owner. */
function draftOf(inventory: 'complete' | 'incomplete', problem: UnknownCallInventoryProblemV1 | null,
  items: UnknownCallReviewItemV1[], itemsOmitted: number): UnknownCallReviewDraftV1 {
  return { inventory, inventoryProblem: problem, items, itemsOmitted, workspace: UNAVAILABLE };
}

const OWNER_FIXTURES: OwnerFx[] = [];
afterEach(async () => { for (const open of OWNER_FIXTURES.splice(0)) await open.close(); });
async function ownerReady(kind: 'memory' | 'sqlite'): Promise<OwnerFx> {
  const fx = await ownerFixture(kind);
  OWNER_FIXTURES.push(fx);
  return fx;
}

describe('K3-11 L17 decision reasons', () => {
  it.each(['memory', 'sqlite'] as const)(
    'K3-11 %s: inventory_incomplete appears once alone through the real RUN-22 attestation entry',
    async kind => {
      // UCR-02/L8: the operator's `resolveUnknownRun` creates the record in the
      // same commit as the Run's attested end; an incomplete inventory is
      // `needs_decision` at creation, and no round can ever be claimed from
      // there, so `inventory_incomplete` is the only reason it ever carries.
      const f = await ownerReady(kind);
      await markUnknown(f);
      const result = await f.reconcile.resolveUnknownRun(f.b2.ctx, { input: {
        runRef: f.b2.claim.runRef, reason: 'checked by hand', kernelTurnOpen: false, inputsConfirmed: true,
        review: draftOf('incomplete', 'too_many_calls', [processItem(1)], 0) },
        meta: { requestId: `k3-11-inventory-${kind}`, expected: [await f.b2.pin()] } });
      expect(result, JSON.stringify(result)).toMatchObject({ status: 'committed', replayed: false,
        value: { status: 'ended', outcome: 'crashed' } });

      const read = await f.reviews.readReview(f.b2.ctx, { runRef: f.b2.claim.runRef });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.status).toBe('needs_decision');
      expect(read.value.decisionReasons).toEqual(['inventory_incomplete']);
      expect(read.value.inventory).toBe('incomplete');
      expect(read.value.inventoryProblem).toBe('too_many_calls');
    });


  it.each(['memory', 'sqlite'] as const)('K3-11 %s: second_consecutive appears once alone', async kind => {
    const fx = await ready(kind, {
      items: [processItem(1, reviewRoundConclusion('done'))], priorUnknownProcess: true,
    });
    await endRound(fx);
    const result = await settle(fx, 'round_ended', 'k3-11-second');
    expect(result).toMatchObject({ status: 'committed', value: {
      status: 'needs_decision', activeRound: null, decisionReasons: ['second_consecutive'],
    } });
  });

  it.each(['memory', 'sqlite'] as const)('K3-11 %s: confirm_each_step appears once alone with every_step', async kind => {
    const fx = await ready(kind, {
      items: [processItem(1, reviewRoundConclusion('done'))], autonomy: 'every_step',
    });
    await endRound(fx);
    const result = await settle(fx, 'round_ended', 'k3-11-confirm');
    expect(result).toMatchObject({ status: 'committed', value: {
      status: 'needs_decision', activeRound: null, decisionReasons: ['confirm_each_step'],
    } });
  });

  it.each(['memory', 'sqlite'] as const)('K3-11 %s: review_unavailable appears once alone', async kind => {
    const fx = await ready(kind, {
      items: [processItem(1, reviewRoundConclusion('done', 'unlikely'))], claim: false,
    });
    const result = await settle(fx, 'review_unavailable', 'k3-11-unavailable');
    expect(result).toMatchObject({ status: 'committed', value: {
      status: 'needs_decision', activeRound: null, decisionReasons: ['review_unavailable'],
    } });
  });

  it.each(['memory', 'sqlite'] as const)('K3-11 %s: review_incomplete appears once alone on the second unfinished round', async kind => {
    const fx = await ready(kind, { items: [processItem(1, reviewRoundConclusion('done'))] });
    await endRoundCrashed(fx);
    const first = await settle(fx, 'round_ended', 'k3-11-first-unfinished');
    expect(first).toMatchObject({ status: 'committed', value: {
      status: 'pending_review', activeRound: null, decisionReasons: [],
      rounds: [{ phase: 'review', round: 1, result: 'unfinished' }],
    } });
    if (first.status !== 'committed') throw new Error('K3-11 first settle');
    const second = await claimRound(fx, first.value, 2);
    const result = await fx.reviews.settleReview(fx.b2.ctx, { input: { reviewRef: fx.reviewRef, cause: 'round_ended' },
      meta: { requestId: 'k3-11-second-unfinished', expected: [{ ref: fx.reviewRef, revision: second.revision }] } });
    expect(result).toMatchObject({ status: 'committed', value: {
      status: 'needs_decision', activeRound: null, decisionReasons: ['review_incomplete'],
      rounds: [
        { phase: 'review', round: 1, result: 'unfinished' },
        { phase: 'review', round: 2, result: 'unfinished' },
      ],
    } });
  });

  it.each(['memory', 'sqlite'] as const)('K3-11 %s: three reasons at once come back in the L17 fixed order', async kind => {
    // review_incomplete (3rd) + partial (5th) + confirm_each_step (10th).
    const fx = await ready(kind, {
      items: [processItem(1, reviewRoundConclusion('partial'))], autonomy: 'every_step',
    });
    await endRoundCrashed(fx);
    const first = await settle(fx, 'round_ended', 'k3-11-three-first');
    expect(first).toMatchObject({ status: 'committed', value: { decisionReasons: [], activeRound: null } });
    if (first.status !== 'committed') throw new Error('K3-11 three-reason first settle');
    const second = await claimRound(fx, first.value, 2);
    const result = await fx.reviews.settleReview(fx.b2.ctx, { input: { reviewRef: fx.reviewRef, cause: 'round_ended' },
      meta: { requestId: 'k3-11-three-second', expected: [{ ref: fx.reviewRef, revision: second.revision }] } });
    expect(result).toMatchObject({ status: 'committed', value: {
      status: 'needs_decision', activeRound: null,
      decisionReasons: ['review_incomplete', 'partial', 'confirm_each_step'],
    } });
    // The literal array is L17's own order, proven against the exported order.
    expect(L17_ORDER.filter(reason =>
      ['review_incomplete', 'partial', 'confirm_each_step'].includes(reason)))
      .toEqual(['review_incomplete', 'partial', 'confirm_each_step']);
  });
});
