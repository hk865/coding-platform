/**
 * K3 §2 L7 `listReviews`: by Goal+status (index `k3-ucr-by-goal-status`) or by
 * workspace+open (index `k3-ucr-by-workspace-open`), page limit 1..200 with
 * `cursor`/`nextCursor`/`readThrough`, no total cap. Read back through the
 * public read port; memory and SQLite each once.
 *
 * Every record here is one the platform created: `pending_review` comes from
 * the ONE real blocked Run (`blockedRecord`, the path `createK3PendingReview`
 * wraps), `needs_decision` is that real record settled through the public
 * `settleReview{review_unavailable}` owner, and `resolved` is a real
 * `done`/`unlikely` review round that ends completed and settles normally
 * (`runK3ReviewRound`). No record, status, `open` flag or created event is
 * written here.
 *
 * W2b-20: each blocked Run's Session comes from the S5 fixture's real Session
 * path (`realSession`, W2b-21). The second Goal's record is a real blocked Run
 * of Goal A's Task `a-work` (accepted Plan PA1), which the world's K3-35 Host
 * authorizes through its optional second-Goal grant (`authorizeK3_35Goal`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot, RuntimeTask } from '../../src/contracts/plan.js';
import type { RecordLookupPort } from '../../src/core/record-store/lookup-ports.js';
import { createUnknownCallReviewService } from '../../src/core/work-graph/tasks/unknown-call-review-service.js';
import {
  openK3ReviewCardWorld, runK3ReviewRound, settleK3Review,
  type K3ReviewCardWorld,
} from '../helpers/K3-proposal-round.js';
import { blockedRecord, runIdGeneratorOf } from '../helpers/B2-crr-world.js';
import { openRealRunHarness, type K3_35RealRunHarness } from '../helpers/K3-35-continuation-fixture.js';
import { authorizeK3_35Goal } from '../helpers/K3-35-runtime.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { GOAL_A, GOAL_B, PLAN_A1 } from '../helpers/S5-decision-fixture.js';

// §5.1's stand-in `shell`, hoisted per test file (the real blocked Run's one
// call uses it; a Run ends only through the Runtime).
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const WORLDS: K3ReviewCardWorld[] = [];

/** R-22: the one scale row's own timeout (the store-page test below); at most 600 s. */
const T1_070_STORE_PAGE_TIMEOUT_MS = 600_000;
afterEach(async () => {
  shellSeam.release();
  for (const world of WORLDS.splice(0)) await world.close();
});

// --------------------------------------------------------------------------- //
// The real-record world                                                       //
// --------------------------------------------------------------------------- //

async function openWorld(kind: 'memory' | 'sqlite'): Promise<K3ReviewCardWorld> {
  const world = await openK3ReviewCardWorld(kind);
  WORLDS.push(world);
  return world;
}

/**
 * The real `pending_review` record: one blocked Run, ended by the Runtime. It is
 * the ONE blocked-record path `createK3PendingReview` wraps (undisposed), with
 * the Run's Session from the S5 fixture's real Session path (W2b-20/W2b-21).
 */
async function createPending(
  world: K3ReviewCardWorld, taskId: string, label: string,
  refs: { goalRef?: GoalRef; planRef?: PlanRevisionRef; harness?: K3_35RealRunHarness } = {},
): Promise<UnknownCallReviewV1> {
  const record = await blockedRecord(world, taskId, label, [{ callId: `${label}-call`, command: `echo ${label}` }], {
    dispose: false, realSession: true,
    ...(refs.harness === undefined ? {} : { harness: refs.harness }),
    ...(refs.goalRef === undefined ? {} : { goalRef: refs.goalRef }),
    ...(refs.planRef === undefined ? {} : { planRef: refs.planRef }),
  });
  if (record.items.length !== 1) {
    throw new Error(`the real pending record has ${String(record.items.length)} items, not 1`);
  }
  return record;
}

/**
 * W2b-20: a real `pending_review` record of the world's second Goal. Goal A's
 * accepted Plan PA1 holds the work Task `a-work` (the S5 fixture's public Plan
 * adoption); the world's K3-35 Host also authorizes Goal A, and the same real
 * blocked-Run chain claims, starts and records the Run under Goal A.
 */
async function createOtherGoalPending(world: K3ReviewCardWorld, label: string): Promise<UnknownCallReviewV1> {
  authorizeK3_35Goal(world, GOAL_A);
  const record = await createPending(world, 'a-work', label, { goalRef: GOAL_A, planRef: PLAN_A1 });
  if (record.ref.goalId !== GOAL_A.goalId || record.status !== 'pending_review') {
    throw new Error(`the second Goal's record is ${record.ref.goalId}/${record.status}`);
  }
  return record;
}

/** The real `needs_decision`: settle the unclaimed pending record unavailable. */
async function createNeedsDecision(
  world: K3ReviewCardWorld, taskId: string, label: string,
): Promise<UnknownCallReviewV1> {
  const pending = await createPending(world, taskId, label);
  const settled = await settleK3Review(world, pending, {
    cause: 'review_unavailable', requestId: `${label}-unavailable`,
  });
  if (settled.status !== 'needs_decision') {
    throw new Error(`the real review_unavailable settlement produced ${settled.status}`);
  }
  return settled;
}

/**
 * The real `resolved`: a review round records `done`/`unlikely` for the one
 * process item, the Run ends completed through the Runtime, and the ordinary
 * `settleReview{round_ended}` writes `resolved` (open becomes `no`).
 */
async function createResolved(
  world: K3ReviewCardWorld, taskId: string, label: string,
): Promise<UnknownCallReviewV1> {
  const pending = await createPending(world, taskId, label);
  const round = await runK3ReviewRound(world, pending, {
    conclusions: [{ item: 1, verdict: 'done', evidence: `the review round saw ${label} finish`,
      crashSuspicion: { verdict: 'unlikely', evidence: 'the command left no crash trace' } }],
  });
  if (round.settled === null || round.settled.status !== 'resolved') {
    throw new Error(`the done/unlikely review round settled to ${round.settled?.status ?? 'null'}`);
  }
  return round.settled;
}

/** The refKey order of L7 for one Goal: aggregate/project/goal are constant, so the run id decides. */
function runIdOrder(records: readonly UnknownCallReviewV1[]): string[] {
  return records.map(record => record.ref.runId).sort();
}

/**
 * Public Plan adoption: append `taskIds` to a NEW accepted Goal-B Plan through
 * the real `proposePlan` + `applyPlanChange` owners. A new PlanRevision needs a
 * new `planId`; the returned ref is the one the next claims use. The draft is
 * the route's public input.
 */
async function adoptPlanTasks(world: K3ReviewCardWorld, taskIds: readonly string[]): Promise<PlanRevisionRef> {
  const plans = world.fixture.b2.base.plans;
  const goal = await plans.queryGoal(world.fixture.ctx, GOAL_B);
  if (goal.status !== 'ready') throw new Error(`the Goal is not readable: ${JSON.stringify(goal)}`);
  const graph = await plans.queryTaskGraph(world.fixture.ctx, { goalRef: GOAL_B });
  if (graph.status !== 'ready') throw new Error(`the Task graph is not readable: ${JSON.stringify(graph)}`);
  const base: PlanRevisionSnapshot = graph.value.plan;
  const task = (taskId: string): RuntimeTask => ({
    taskId, title: `T1-070 work ${taskId}`, requirementLevel: 'required', taskKind: 'work',
    disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution',
  });
  const draft: PlanRevisionDraft = {
    schemaVersion: 2, planId: 'PB2-T1070', planRevision: base.planRevision + 1, goalId: GOAL_B.goalId,
    stages: structuredClone(base.stages),
    tasks: [...base.tasks.map(candidate => ({ ...candidate })), ...taskIds.map(task)],
    assignments: [...(base.assignments ?? []).map(entry => ({ ...entry })),
      ...taskIds.map(taskId => ({ taskId, role: 'builder' as const, instruction: `Execute ${taskId}` }))],
    obligations: base.obligations.map(obligation => ({ ...obligation,
      taskIds: [...obligation.taskIds, ...taskIds],
      verificationRequirements: obligation.verificationRequirements.map(requirement => ({ ...requirement })) })),
    taskHierarchy: structuredClone(base.taskHierarchy),
    executionDag: structuredClone(base.executionDag),
    taskRelations: [...(base.taskRelations ?? [])].map(relation => ({ ...relation })),
    inputRequirements: [...(base.inputRequirements ?? [])].map(requirement => ({ ...requirement })),
  };
  const proposed = await plans.proposePlan(world.fixture.ctx, { input: {
    goalRef: GOAL_B, basedOn: base.ref, draft,
    reason: { text: 'T1-070 list records', sources: [] },
  }, meta: { requestId: 't1-070-list-propose',
    expected: [{ ref: GOAL_B, revision: goal.value.goal.revision }] } });
  if (proposed.status !== 'committed' || proposed.value.issues.length > 0) {
    throw new Error(`the T1-070 Plan proposal failed: ${JSON.stringify(proposed)}`);
  }
  const applied = await plans.applyPlanChange(world.fixture.ctx, { input: {
    proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [],
  }, meta: { requestId: 't1-070-list-apply',
    expected: [{ ref: GOAL_B, revision: goal.value.goal.revision }] } });
  if (applied.status !== 'committed') {
    throw new Error(`the T1-070 Plan adoption failed: ${JSON.stringify(applied)}`);
  }
  return applied.value.ref;
}

/** The real public settings write that moves the store watermark. */
async function writeGoalSettings(world: K3ReviewCardWorld, requestId: string) {
  const read = await world.goalSettings.readGoalSettings(world.fixture.ctx, { goalRef: GOAL_B });
  if (read.status !== 'ready') throw new Error(`the Goal settings are not readable: ${JSON.stringify(read)}`);
  const written = await world.goalSettings.setGoalSettings(world.fixture.ctx, { input: {
    goalRef: GOAL_B, autonomy: read.value.settings.autonomy, waitForGoalRef: null,
  }, meta: { requestId, expected: [{ ref: GOAL_B, revision: read.value.goal.revision }] } });
  if (written.status !== 'committed') throw new Error(`the Goal settings write failed: ${JSON.stringify(written)}`);
  return written;
}

describe('listReviews', () => {
  it.each(['memory', 'sqlite'] as const)('listReviews %s: by Goal+status pages with cursor and nextCursor', async kind => {
    const world = await openWorld(kind);
    const scope = world.fixture.base.scope;
    const [pendingTask, decidedTask, resolvedTask] = world.tasks;
    if (pendingTask === undefined || decidedTask === undefined || resolvedTask === undefined) {
      throw new Error('the world needs three K3 tasks');
    }
    const pending = await createPending(world, pendingTask, 'k3-list-goal-pending');
    const decided = await createNeedsDecision(world, decidedTask, 'k3-list-goal-decided');
    await createResolved(world, resolvedTask, 'k3-list-goal-resolved');
    // The second Goal's real pending record (w2-base's other-Goal record): the
    // Goal B query below must exclude it.
    await createOtherGoalPending(world, 'k3-list-goal-other');
    const filter = { goalRef: GOAL_B, status: ['pending_review', 'needs_decision'] as const };

    const all = await world.reviews.listReviews(world.fixture.ctx, {
      workspace: scope, filter: { ...filter, status: [...filter.status] }, page: { limit: 200 } });
    expect(all).toMatchObject({ status: 'ready', value: { items: [
      { ref: { goalId: GOAL_B.goalId, runId: pending.ref.runId }, status: 'pending_review' },
      { ref: { goalId: GOAL_B.goalId, runId: decided.ref.runId }, status: 'needs_decision' },
    ], nextCursor: null } });
    if (all.status !== 'ready') throw new Error('list');
    expect(all.value.readThrough).not.toBeNull();

    const first = await world.reviews.listReviews(world.fixture.ctx, {
      workspace: scope, filter: { ...filter, status: [...filter.status] }, page: { limit: 1 } });
    expect(first).toMatchObject({ status: 'ready', value: { items: [{ ref: { runId: pending.ref.runId } }] } });
    if (first.status !== 'ready' || first.value.nextCursor === null) throw new Error('a cursor is required');
    const second = await world.reviews.listReviews(world.fixture.ctx, {
      workspace: scope, filter: { ...filter, status: [...filter.status] },
      page: { limit: 1, cursor: first.value.nextCursor } });
    expect(second).toMatchObject({ status: 'ready',
      value: { items: [{ ref: { runId: decided.ref.runId } }], nextCursor: null } });
  });

  it.each(['memory', 'sqlite'] as const)('listReviews %s: by workspace+open returns only open records', async kind => {
    const world = await openWorld(kind);
    const scope = world.fixture.base.scope;
    const [pendingTask, decidedTask, resolvedTask] = world.tasks;
    if (pendingTask === undefined || decidedTask === undefined || resolvedTask === undefined) {
      throw new Error('the world needs three K3 tasks');
    }
    const pending = await createPending(world, pendingTask, 'k3-list-open-pending');
    const decided = await createNeedsDecision(world, decidedTask, 'k3-list-open-decided');
    await createResolved(world, resolvedTask, 'k3-list-open-resolved');
    const other = await createOtherGoalPending(world, 'k3-list-open-other');

    const open = await world.reviews.listReviews(world.fixture.ctx, {
      workspace: scope, filter: { open: 'yes' }, page: { limit: 200 } });
    // The workspace query spans both Goals, in refKey keyset order: the UTF-8
    // bytes of the canonical ref JSON {"aggregateType":"UnknownCallReview",
    // "goalId":…,"projectId":…,"runId":…}, so Goal "A" sorts before Goal "B";
    // inside Goal B the two run ids follow the world's one Run-id stream
    // (`runIdGeneratorOf`, B2-crr-world.ts), pending first.
    expect(open).toMatchObject({ status: 'ready', value: { items: [
      { ref: { goalId: GOAL_A.goalId, runId: other.ref.runId } },
      { ref: { goalId: GOAL_B.goalId, runId: pending.ref.runId } },
      { ref: { goalId: GOAL_B.goalId, runId: decided.ref.runId } },
    ], nextCursor: null } });
    if (open.status !== 'ready') throw new Error('list');
    expect(open.value.items.every(record => record.open === 'yes')).toBe(true);
  });

  it('listReviews: a limit outside 1..200 is invalid', async () => {
    const world = await openWorld('memory');
    const scope = world.fixture.base.scope;
    expect(await world.reviews.listReviews(world.fixture.ctx, { workspace: scope,
      filter: { open: 'yes' }, page: { limit: 0 } }))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await world.reviews.listReviews(world.fixture.ctx, { workspace: scope,
      filter: { open: 'yes' }, page: { limit: 201 } }))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
  });

  // Codex 8: a cursor is an exclusive refKey keyset bound, not a row that must
  // still be inside the query. A foreign (or stale) cursor is not `invalid`.
  it.each(['memory', 'sqlite'] as const)(
    'listReviews %s: a cursor outside the filter is a keyset bound, not invalid', async kind => {
      const world = await openWorld(kind);
      const scope = world.fixture.base.scope;
      const [pendingTask, decidedTask, laterTask] = world.tasks;
      if (pendingTask === undefined || decidedTask === undefined || laterTask === undefined) {
        throw new Error('the world needs three K3 tasks');
      }
      const pending = await createPending(world, pendingTask, 'k3-list-cursor-pending');
      const decided = await createNeedsDecision(world, decidedTask, 'k3-list-cursor-decided');
      // W2b-20 (b): one later real pending_review record, so the wider page below
      // has more to read and returns a real cursor at the boundary after `decided`.
      const later = await createPending(world, laterTask, 'k3-list-cursor-later');

      // The wider real page (both open statuses, limit 2) holds pending, then
      // decided, in keyset order; the later record is left, so a cursor returns.
      const wider = await world.reviews.listReviews(world.fixture.ctx, {
        workspace: scope, filter: { goalRef: GOAL_B, status: ['pending_review', 'needs_decision'] },
        page: { limit: 2 } });
      expect(wider).toMatchObject({ status: 'ready', value: { items: [
        { ref: { runId: pending.ref.runId }, status: 'pending_review' },
        { ref: { runId: decided.ref.runId }, status: 'needs_decision' },
      ] } });
      if (wider.status !== 'ready' || wider.value.nextCursor === null) throw new Error('the wider page must return a cursor');

      // That cursor, as returned, bounds the pending-only query after `decided`,
      // a record outside this filter: only `later` is left (`pending` sorts
      // before the bound), and it is not `invalid`.
      const page = await world.reviews.listReviews(world.fixture.ctx, {
        workspace: scope, filter: { goalRef: GOAL_B, status: ['pending_review'] },
        page: { limit: 1, cursor: wider.value.nextCursor } });
      expect(page).toMatchObject({ status: 'ready', value: { nextCursor: null } });
      if (page.status !== 'ready') throw new Error('list');
      expect(page.value.items).toEqual([later]);

      // The same cursor continues the wider query: only `later` is left, so the cursor
      // sits after `decided` (a cursor after `pending` would return `decided` again).
      const rest = await world.reviews.listReviews(world.fixture.ctx, {
        workspace: scope, filter: { goalRef: GOAL_B, status: ['pending_review', 'needs_decision'] },
        page: { limit: 2, cursor: wider.value.nextCursor } });
      expect(rest).toMatchObject({ status: 'ready', value: { nextCursor: null } });
      if (rest.status !== 'ready') throw new Error('list');
      expect(rest.value.items).toEqual([later]);
    });

  // Codex 8: bounded keyset pages, no total cap (L7 "没有总数上限"). More than
  // one store page of records must still list with two clean pages.
  //
  // W2b-20 (c), R-22: this is a scale row. Each of its 205 records is its own
  // real blocked Run with its own real Session (one shared Session is refused:
  // `busy: the target Session health is unavailable`). Measured with
  // `--maxWorkers=2` (R-22's runs and the W2b-20 run): 65-70 s on memory and
  // 152-168 s on SQLite. Like the S2A scale tests (`S2A_SCALE_TIMEOUT_MS`),
  // this ONE test carries its own timeout, at most 600 s (R-22); every other
  // test here keeps the default.
  it.each(['memory', 'sqlite'] as const)(
    'listReviews %s: more than a store page of records lists without a cap', async kind => {
      const world = await openWorld(kind);
      const scope = world.fixture.base.scope;
      // 205 real Tasks through public Plan adoption; each Task then gets one
      // real blocked Run, and the Run's own record is the listed row.
      const taskIds = Array.from({ length: 205 },
        (_unused, index) => `t1-070-many-${String(index).padStart(3, '0')}`);
      const planRef = await adoptPlanTasks(world, taskIds);
      // The 205 Runs go through ONE real-Run harness, so ONE platform Host
      // recognizes them all (W2b-20 (c)); each record is still its own Run.
      const harness = await openRealRunHarness(world, { newId: runIdGeneratorOf(world) });
      const created: UnknownCallReviewV1[] = [];
      try {
        for (const taskId of taskIds) {
          created.push(await createPending(world, taskId, `k3-list-many-${taskId}`, { planRef, harness }));
        }
      } finally {
        await harness.closeUnion();
      }
      const runIds = runIdOrder(created);
      const filter = { goalRef: GOAL_B, status: ['pending_review' as const] };

      const first = await world.reviews.listReviews(world.fixture.ctx, { workspace: scope, filter, page: { limit: 200 } });
      if (first.status !== 'ready') throw new Error(JSON.stringify(first));
      expect(first.value.items).toHaveLength(200);
      expect(first.value.nextCursor).not.toBeNull();
      expect(first.value.items.map(record => record.ref.runId)).toEqual(runIds.slice(0, 200));

      const second = await world.reviews.listReviews(world.fixture.ctx, {
        workspace: scope, filter, page: { limit: 200, cursor: first.value.nextCursor! } });
      if (second.status !== 'ready') throw new Error(JSON.stringify(second));
      expect(second.value.items).toHaveLength(5);
      expect(second.value.nextCursor).toBeNull();
      expect(second.value.items.map(record => record.ref.runId)).toEqual(runIds.slice(200));
    }, T1_070_STORE_PAGE_TIMEOUT_MS);

  // Codex 8: every tuple's `readThrough` must be the same watermark; a mismatch
  // retries the page, and only a stable watermark is returned. The A3 gate holds
  // the first real lookup while a REAL public settings write moves the store's
  // watermark; the lookup results themselves are returned unchanged.
  it('listReviews: an unstable per-tuple watermark retries to the stable watermark', async () => {
    const world = await openWorld('memory');
    const scope = world.fixture.base.scope;
    const [pendingTask, decidedTask] = world.tasks;
    if (pendingTask === undefined || decidedTask === undefined) throw new Error('the world needs two K3 tasks');
    await createPending(world, pendingTask, 'k3-list-watermark-pending');
    await createNeedsDecision(world, decidedTask, 'k3-list-watermark-decided');
    const real = world.records;
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let signalFirstLookup!: () => void;
    const firstLookup = new Promise<void>(resolve => { signalFirstLookup = resolve; });
    const lookups: RecordLookupPort = {
      async lookup(request) {
        calls += 1;
        const result = await real.lookup(request);
        if (calls === 1) {
          // A3 gate: the real first-tuple value is held; the test commits a
          // public write, then the retry reads both tuples at the new watermark.
          signalFirstLookup();
          await gate;
        }
        return result;
      },
    };
    const reviews = createUnknownCallReviewService({ records: real, lookups,
      now: () => world.fixture.now(), eventId: () => world.fixture.newId() });

    const listing = reviews.listReviews(world.fixture.ctx, {
      workspace: scope, filter: { goalRef: GOAL_B, status: ['pending_review', 'needs_decision'] },
      page: { limit: 2 } });
    await firstLookup;
    const write = await writeGoalSettings(world, 't1-070-list-watermark-write');
    release();

    const page = await listing;
    expect(page).toMatchObject({ status: 'ready' });
    if (page.status !== 'ready') throw new Error(JSON.stringify(page));
    // The stable read-through is the real commit cursor the public write
    // returned, used as returned.
    expect(page.value.readThrough).toBe(write.cursor);
    expect(calls).toBe(4);
  });

  it('listReviews: a persistently mixed watermark is not_ready, never a stale page', async () => {
    const world = await openWorld('memory');
    const scope = world.fixture.base.scope;
    const [pendingTask, decidedTask] = world.tasks;
    if (pendingTask === undefined || decidedTask === undefined) throw new Error('the world needs two K3 tasks');
    await createPending(world, pendingTask, 'k3-list-mixed-pending');
    await createNeedsDecision(world, decidedTask, 'k3-list-mixed-decided');
    const real = world.records;
    let calls = 0;
    const lookups: RecordLookupPort = {
      async lookup(request) {
        calls += 1;
        const result = await real.lookup(request);
        if (calls % 2 === 1) {
          // A3 gate: after each attempt's first real tuple, the test commits a
          // real public write, so the next tuple reads a newer watermark.
          await writeGoalSettings(world, `t1-070-list-mixed-write-${String(calls)}`);
        }
        return result;
      },
    };
    const reviews = createUnknownCallReviewService({ records: real, lookups,
      now: () => world.fixture.now(), eventId: () => world.fixture.newId() });

    const page = await reviews.listReviews(world.fixture.ctx, {
      workspace: scope, filter: { goalRef: GOAL_B, status: ['pending_review', 'needs_decision'] },
      page: { limit: 2 } });
    expect(page).toMatchObject({ status: 'not_ready' });
    expect(calls).toBe(6);
  });
});
