/**
 * R-22 scale row moved from the daily file: 205 real blocked Runs, each its
 * own real Session, listed through the public `listReviews` with `limit: 200`.
 * Its sizes, both backends, assertions and 600 s timeout are unchanged; the
 * daily file keeps a small 5-record, page-2 version.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot, RuntimeTask } from '../../src/contracts/plan.js';
import {
  openK3ReviewCardWorld,
  type K3ReviewCardWorld,
} from '../helpers/K3-proposal-round.js';
import { blockedRecord, runIdGeneratorOf } from '../helpers/B2-crr-world.js';
import { openRealRunHarness, type K3_35RealRunHarness } from '../helpers/K3-35-continuation-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { GOAL_B } from '../helpers/S5-decision-fixture.js';

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

describe('listReviews', () => {
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
});
