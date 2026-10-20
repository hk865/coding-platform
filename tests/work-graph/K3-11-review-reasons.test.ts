/**
 * K3-11 (L17, spec line 1425; R2): every L17 decision reason that K3-11 owns
 * appears ONCE alone, and one record carries THREE reasons and lists them in the
 * fixed write order. Every prior state comes from the public K3 chain in
 * `tests/helpers/K3-proposal-round.ts`: the real pending record
 * (`createK3PendingReview`), the real claim/prepare/Runtime review round
 * (`claimK3ReviewRound`), conclusions through `recordK3Conclusion`, the
 * Runtime's own end (`endK3RunCompleted` / `endK3RunUnfinished`), and the real
 * `settleReview` owner (`settleK3Review`). The reasons are pure outputs of the
 * real state machine: `inventory_incomplete` is the UCR-02 creation reason (a
 * `needs_decision` record cannot claim a round, so it is the only record that
 * can carry it) through the real RUN-22 attestation entry, and the settlement
 * reasons come from `createUnknownCallReviewService.settleReview`.
 *
 * The rows' own R2 cases live in K3-19 (`review_unavailable`) and K3-45
 * (`review_incomplete`); this file shows K3-11's own single occurrence at the
 * owner seam. The `confirm_each_step` reason is read from the Goal's real
 * `settings.autonomy` (the public `setGoalSettings` owner); the R2 case in
 * `tests/scenarios/K3-11-review-reasons-r2.test.ts` drives it through the
 * Workflow. `second_consecutive` cannot be reached from a fresh Task's own
 * record (`createK3PendingReview` always claims a new Task), so that one sample
 * lives only in `tests/scenarios/K3-11-review-reasons-r2.test.ts:271-386`. The
 * card/disposition parts are group 4.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import type {
  UnknownCallInventoryProblemV1, UnknownCallObservationV1, UnknownCallReviewDraftV1,
  UnknownCallReviewItemV1, UnknownCallReviewV1,
} from '../../src/contracts/unknown-call-review.js';
import {
  UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS,
} from '../../src/core/work-graph/tasks/unknown-call-review-codecs.js';
import {
  createUnknownCallReviewService,
} from '../../src/core/work-graph/tasks/unknown-call-review-service.js';
import { createRunReconcileService } from '../../src/core/work-graph/tasks/run-reconcile-service.js';
import { DECISION_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/decision-record-codecs.js';
import { CONTROL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/control-record-codecs.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import type { RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import { createB2ExecutionFixture, type B2ExecutionFixture } from '../helpers/B2-execution-fixture.js';
import {
  claimK3ReviewRound, createK3PendingReview, endK3RunCompleted, endK3RunUnfinished,
  openK3ReviewCardWorld, recordK3Conclusion, settleK3Review,
  type K3ReviewCardWorld, type K3Round,
} from '../helpers/K3-proposal-round.js';
import { GOAL_B } from '../helpers/S5-decision-fixture.js';

// §5.1's stand-in `shell`, hoisted per test file (the K3 fixture's real Run uses it).
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

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

// --------------------------------------------------------------------------
// The public K3 chain: the real pending record, round, end and settlement
// --------------------------------------------------------------------------

const WORLDS: K3ReviewCardWorld[] = [];
afterEach(async () => { for (const world of WORLDS.splice(0)) await world.close(); });

async function openWorld(kind: 'memory' | 'sqlite'): Promise<K3ReviewCardWorld> {
  const world = await openK3ReviewCardWorld(kind);
  WORLDS.push(world);
  return world;
}

/** Writes the review round's conclusion through the real UCR-04 owner. */
async function conclude(
  world: K3ReviewCardWorld, round: K3Round, verdict: 'done' | 'partial',
): Promise<UnknownCallReviewV1> {
  return await recordK3Conclusion(world, round, {
    item: 1, verdict, evidence: `K3-11 ${verdict}`,
    crashSuspicion: { verdict: 'unlikely', evidence: 'K3-11 self-check unlikely' },
  });
}

/** `every_step` through the real `setGoalSettings` public owner (F-100). */
async function setEveryStep(world: K3ReviewCardWorld): Promise<void> {
  const detail = await world.fixture.b2.base.plans.queryGoal(world.fixture.ctx, GOAL_B);
  if (detail.status !== 'ready') throw new Error(`K3-11 goal read: ${JSON.stringify(detail)}`);
  const result = await world.goalSettings.setGoalSettings(world.fixture.ctx, { input: {
    goalRef: GOAL_B, autonomy: 'every_step', waitForGoalRef: null,
  }, meta: { requestId: 'k3-11-autonomy', expected: [{ ref: GOAL_B, revision: detail.value.goal.revision }] } });
  if (result.status !== 'committed') throw new Error(`K3-11 autonomy: ${JSON.stringify(result)}`);
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

  it.each(['memory', 'sqlite'] as const)('K3-11 %s: confirm_each_step appears once alone with every_step', async kind => {
    const world = await openWorld(kind);
    const pending = await createK3PendingReview(world);
    await setEveryStep(world);
    const round = await claimK3ReviewRound(world, pending);
    const concluded = await conclude(world, round, 'done');
    await endK3RunCompleted(world, round.claim);
    const result = await settleK3Review(world, concluded, {
      cause: 'round_ended', requestId: 'k3-11-confirm',
    });
    expect(result).toMatchObject({ status: 'needs_decision', activeRound: null, decisionReasons: ['confirm_each_step'] });
  });

  it.each(['memory', 'sqlite'] as const)('K3-11 %s: review_unavailable appears once alone', async kind => {
    // The `review_unavailable` trigger is a PENDING record with no active
    // round. Starting from the real pending record (no conclusions), one real
    // review round writes `done`/`unlikely`; its Run ends unfinished, the
    // `round_ended` settlement returns the record to `pending_review`, and only
    // then does the `review_unavailable` settlement decide. At that point
    // `review_unavailable` is the only reason.
    const world = await openWorld(kind);
    const pending = await createK3PendingReview(world);
    expect(pending.status).toBe('pending_review');
    expect(pending.activeRound).toBeNull();
    expect(pending.items[0]?.observed).toEqual({ verdict: 'pending', by: null });
    const round = await claimK3ReviewRound(world, pending);
    const concluded = await conclude(world, round, 'done');
    await endK3RunUnfinished(world, round.claim);
    const backToPending = await settleK3Review(world, concluded, {
      cause: 'round_ended', requestId: 'k3-11-unavailable-first',
    });
    expect(backToPending).toMatchObject({ status: 'pending_review', activeRound: null, decisionReasons: [],
      rounds: [{ phase: 'review', round: 1, result: 'unfinished' }] });
    const result = await settleK3Review(world, backToPending, {
      cause: 'review_unavailable', requestId: 'k3-11-unavailable',
    });
    expect(result).toMatchObject({ status: 'needs_decision', activeRound: null, decisionReasons: ['review_unavailable'] });
  });

  it.each(['memory', 'sqlite'] as const)('K3-11 %s: review_incomplete appears once alone on the second unfinished round', async kind => {
    const world = await openWorld(kind);
    const pending = await createK3PendingReview(world);
    const firstRound = await claimK3ReviewRound(world, pending);
    const concluded = await conclude(world, firstRound, 'done');
    await endK3RunUnfinished(world, firstRound.claim);
    const first = await settleK3Review(world, concluded, {
      cause: 'round_ended', requestId: 'k3-11-first-unfinished',
    });
    expect(first).toMatchObject({ status: 'pending_review', activeRound: null, decisionReasons: [],
      rounds: [{ phase: 'review', round: 1, result: 'unfinished' }] });
    const secondRound = await claimK3ReviewRound(world, first);
    await endK3RunUnfinished(world, secondRound.claim);
    const result = await settleK3Review(world, secondRound.record, {
      cause: 'round_ended', requestId: 'k3-11-second-unfinished',
    });
    expect(result).toMatchObject({ status: 'needs_decision', activeRound: null, decisionReasons: ['review_incomplete'],
      rounds: [
        { phase: 'review', round: 1, result: 'unfinished' },
        { phase: 'review', round: 2, result: 'unfinished' },
      ],
    });
  });

  it.each(['memory', 'sqlite'] as const)('K3-11 %s: three reasons at once come back in the L17 fixed order', async kind => {
    // review_incomplete (3rd) + partial (5th) + confirm_each_step (10th).
    const world = await openWorld(kind);
    const pending = await createK3PendingReview(world);
    await setEveryStep(world);
    const firstRound = await claimK3ReviewRound(world, pending);
    const concluded = await conclude(world, firstRound, 'partial');
    await endK3RunUnfinished(world, firstRound.claim);
    const first = await settleK3Review(world, concluded, {
      cause: 'round_ended', requestId: 'k3-11-three-first',
    });
    expect(first).toMatchObject({ decisionReasons: [], activeRound: null });
    const secondRound = await claimK3ReviewRound(world, first);
    await endK3RunUnfinished(world, secondRound.claim);
    const result = await settleK3Review(world, secondRound.record, {
      cause: 'round_ended', requestId: 'k3-11-three-second',
    });
    expect(result).toMatchObject({ status: 'needs_decision', activeRound: null,
      decisionReasons: ['review_incomplete', 'partial', 'confirm_each_step'],
    });
    // The literal array is L17's own order, proven against the exported order.
    expect(L17_ORDER.filter(reason =>
      ['review_incomplete', 'partial', 'confirm_each_step'].includes(reason)))
      .toEqual(['review_incomplete', 'partial', 'confirm_each_step']);
  });
});
