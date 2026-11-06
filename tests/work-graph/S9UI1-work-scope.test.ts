/**
 * UI1 `architecture/work-scope` (acceptance rows 8–10): the
 * live Run's planned files mapped to formal modules, the empty work set, and the
 * one bounded read per source.
 *
 * A live Run is a real `workflow/advance` start held at its scripted model request;
 * the Plan is adopted through `plans/propose` + `plans/apply`, the line through
 * `sessions/create`. No record, plan or Run is written by hand.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkflowAdvanceInput, WorkflowAdvanceResult } from '../../src/business/workflow/contracts.js';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import { ag2bPlanDraft, createAG2bSession, graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { ensureProjectPointers, openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { committedValue, readyValue } from '../helpers/S6A-memory-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { mergeLiveRuns } from '../../src/core/work-graph/views/architecture-work-scope-reader.js';
import { BACKENDS, type Backend } from './S9UI1-fixture.js';

type WorkScopeGroup = { ref: { moduleId: string }; name: string; path: string | null; paths: string[] };
type WorkScopeValue = {
  workspace: { projectId: string; workspaceId: string };
  runs: { ref: { runId: string }; status: 'starting' | 'running' }[];
  files: { kind: 'file'; path: string; module: WorkScopeGroup | null }[];
  modules: { kind: 'module'; label: string; files: string[]; claimedWithoutFiles: boolean }[];
  counts: { runs: number; files: number; modules: number };
  sources: { catalog: 'available' | 'not_adopted' };
};
type WorkScopeBody = { status: 'ready'; value: WorkScopeValue }
  | { status: 'rejected'; code: string; reason: string };

const TASKS = {
  one: 's9ui1-work-one',
  two: 's9ui1-work-two',
  three: 's9ui1-work-three',
} as const;

const worlds: S6AHostWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close().catch(() => undefined); });

type ReadResultValue = { project?: { revision: number }; workspace?: { revision: number };
  baseline: { ref: unknown; contentDigest: string };
  catalog: { ref: unknown; catalog: { modules: { ref: { moduleId: string } }[] } } };

/** Add the longer `core` module (`src/core`) over the project's adopted `src` module. */
async function addCoreModule(world: S6AHostWorld): Promise<void> {
  const current = readyValue<ReadResultValue>((await world.post('architecture/read',
    plain(S6A_SCOPE, { selection: { kind: 'current' } }))).body, 'the current catalog');
  if (current.catalog.catalog.modules.some(module => module.ref.moduleId === 'core')) return;
  const registration = readyValue<ReadResultValue>((await world.post('workspaces/registration',
    plain(S6A_SCOPE, S6A_SCOPE))).body, 'the workspace registration');
  const revised = await world.post('architecture/revise', graphWrite(S6A_SCOPE, {
    expected: { catalogRef: current.catalog.ref,
      baseline: { ref: current.baseline.ref, digest: current.baseline.contentDigest } },
    ops: [{ op: 'add_module', module: { ref: { projectId: S6A_SCOPE.projectId, moduleId: 'core' },
      name: 'core', responsibility: 'the core source group', paths: ['src/core'], interfaces: [] } }],
    responsibilityMoves: [], reason: 'UI1 work-scope core module',
  }, 's9ui1-core-module', [
    { ref: { aggregateType: 'Project', projectId: S6A_SCOPE.projectId }, revision: registration.project!.revision },
    { ref: { aggregateType: 'Workspace', ...S6A_SCOPE }, revision: registration.workspace!.revision },
  ]));
  committedValue(revised.body, 'the catalog revision');
}

/** The project's policy and architecture, then the longer `core` module. */
async function openWorkWorld(backend: Backend): Promise<{ world: S6AHostWorld; goal: GoalRef }> {
  const world = await openS6AHostWorld({ backend });
  worlds.push(world);
  await ensureProjectPointers(world);
  await addCoreModule(world);
  return { world, goal: world.goals.first };
}

function s9ui1PlanDraft(goal: GoalRef, planned: readonly { taskId: string; files: readonly string[] }[]): PlanRevisionDraft {
  const draft = ag2bPlanDraft(planned.map(entry => entry.taskId));
  return { ...draft, planId: 's9ui1-plan', goalId: goal.goalId,
    tasks: draft.tasks.map(task => {
      const files = planned.find(entry => entry.taskId === task.taskId)?.files;
      return files === undefined ? task : { ...task, plannedFiles: [...files] };
    }) };
}

async function seedPlan(world: S6AHostWorld, goal: GoalRef,
  planned: readonly { taskId: string; files: readonly string[] }[]): Promise<void> {
  const proposed = committedValue<Record<string, unknown>>((await world.post('plans/propose', graphWrite(S6A_SCOPE, {
    goalRef: goal, basedOn: null, draft: s9ui1PlanDraft(goal, planned), reason: { text: 'UI1 work-scope plan', sources: [] },
  }, 's9ui1-plan-propose'))).body, 'the Plan proposal');
  committedValue((await world.post('plans/apply', graphWrite(S6A_SCOPE, {
    proposalRef: proposed['ref'], expectedProposalRevision: proposed['revision'], decisionRefs: [],
  }, 's9ui1-plan-apply'))).body, 'the Plan adoption');
}

async function s9ui1Line(world: S6AHostWorld, goal: GoalRef, taskId: string): Promise<S6ASession> {
  const task = { projectId: goal.projectId, goalId: goal.goalId, taskId };
  const created = await createAG2bSession(world.ag2b, `s9ui1-line-${taskId}`, S6A_WORK_ROLE as never,
    [{ target: { kind: 'task', ref: task }, relation: 'responsible' }]);
  const card = await world.readSession(created.sessionRef);
  return { label: taskId, ref: created.sessionRef, aggregateRef: card.record.ref,
    role: S6A_WORK_ROLE, createdAt: card.record.createdAt };
}

/** Start one real Work Run and hold it at its first model request (the Run is live). */
async function holdRun(world: S6AHostWorld, goal: GoalRef, taskId: string, flowId: string): Promise<{
  session: S6ASession; gate: { reached: Promise<unknown>; release(): void }; drive: Promise<unknown>;
}> {
  const session = await s9ui1Line(world, goal, taskId);
  const gate = await world.gates.modelRequest(session);
  let input: WorkflowAdvanceInput = { schemaVersion: 1, goalRef: goal, flowId, sessionHint: null,
    kind: 'select_work', taskId };
  const drive = (async (): Promise<unknown> => {
    for (let guard = 0; guard < 32; guard += 1) {
      const answer = await world.post('workflow/advance', plain(S6A_SCOPE, input));
      const body = answer.body as WorkflowAdvanceResult;
      if (answer.httpStatus !== 200 || body.status !== 'ready') {
        throw new Error(`S9UI1: workflow/advance was not ready: ${JSON.stringify(body)}`);
      }
      if (body.value.state === 'completed' || body.value.next === null) return body.value;
      input = body.value.next;
    }
    throw new Error('S9UI1: the Workflow did not settle');
  })();
  const arrived = await Promise.race([
    gate.reached.then(() => 'held' as const),
    drive.then(() => 'ended' as const),
  ]);
  if (arrived !== 'held') throw new Error('S9UI1: the Run ended before its first model request');
  return { session, gate, drive };
}

async function workScope(world: S6AHostWorld): Promise<WorkScopeBody> {
  const answer = await world.post('architecture/work-scope', plain(S6A_SCOPE, {}));
  expect(answer.httpStatus, JSON.stringify(answer.body)).toBe(200);
  return answer.body as WorkScopeBody;
}

function readyScope(body: WorkScopeBody): WorkScopeValue {
  expect(body.status).toBe('ready');
  if (body.status !== 'ready') throw new Error(`architecture/work-scope was not ready: ${JSON.stringify(body)}`);
  return body.value;
}

async function release(held: { gate: { release(): void }; drive: Promise<unknown> }): Promise<void> {
  held.gate.release();
  await held.drive.catch(() => undefined);
}

describe.each([...BACKENDS])('S9UI1 architecture/work-scope (%s)', (backend: Backend) => {
  it('row 8: a live Run’s planned file maps to its longest formal module', async () => {
    /* Named mutation: `pathOwnershipOf` -> a `paths[0]` prefix in `architecture-work-scope-reader.ts`; red at
       `files[0].module.name`, because the shorter `src` module would own the file. */
    const { world, goal } = await openWorkWorld(backend);
    await seedPlan(world, goal, [{ taskId: TASKS.one, files: ['src/core/a.ts'] }]);
    const held = await holdRun(world, goal, TASKS.one, 's9ui1-r8');
    try {
      const value = readyScope(await workScope(world));
      expect(value.counts).toEqual({ runs: 1, files: 1, modules: 1 });
      expect(value.runs).toHaveLength(1);
      expect(value.runs[0]!.status).toBe('running');
      expect(value.files).toHaveLength(1);
      expect(value.files[0]).toMatchObject({ kind: 'file', path: 'src/core/a.ts', module: { name: 'core' } });
      expect(value.modules).toHaveLength(1);
      expect(value.modules[0]).toMatchObject({ kind: 'module', label: 'core', files: ['src/core/a.ts'] });
    } finally {
      await release(held);
    }
  });

  it('row 9: no live Run is a ready empty work set, not not_found', async () => {
    /* Named mutation: return `not_found` when the Run list is empty; red at `body.status` below. */
    const { world } = await openWorkWorld(backend);
    const value = readyScope(await workScope(world));
    expect(value).toMatchObject({ runs: [], files: [], modules: [],
      counts: { runs: 0, files: 0, modules: 0 } });
  });

  it('row 10: three live Runs on one plan take two status lookups and one plan batch, independent of Run count', async () => {
    /* Named mutation: read the Plan once per Run inside the Run loop; red at the spy below, because the Plan
       batches grow from 1 to 3 while the two status lookups stay 2. */
    const { world, goal } = await openWorkWorld(backend);
    await seedPlan(world, goal, [
      { taskId: TASKS.one, files: ['src/core/a.ts'] },
      { taskId: TASKS.two, files: ['src/core/ab.ts'] },
      { taskId: TASKS.three, files: ['src/core/abc.ts'] },
    ]);
    const held = [
      await holdRun(world, goal, TASKS.one, 's9ui1-r10a'),
      await holdRun(world, goal, TASKS.two, 's9ui1-r10b'),
      await holdRun(world, goal, TASKS.three, 's9ui1-r10c'),
    ];
    const records = world.platform.disconnect.records as unknown as {
      lookup(request: unknown): Promise<unknown>; readMany(refs: readonly string[]): Promise<unknown>;
    };
    const originalLookup = records.lookup;
    const originalReadMany = records.readMany;
    const statusLookups: unknown[] = [];
    let planReads = 0;
    let catalogReads = 0;
    records.lookup = function patchedLookup(request: unknown) {
      const values = (request as { values?: unknown[] }).values;
      if (Array.isArray(values) && (values.includes('starting') || values.includes('running'))) {
        statusLookups.push(request);
      }
      return originalLookup.call(records, request);
    };
    records.readMany = function patchedReadMany(refs: readonly string[]) {
      if (refs.some(ref => ref.includes('"aggregateType":"PlanRevision"'))) planReads += 1;
      if (refs.some(ref => ref.includes('"aggregateType":"ArchitectureCatalog"'))) catalogReads += 1;
      return originalReadMany.call(records, refs);
    };
    let value: WorkScopeValue;
    try {
      value = readyScope(await workScope(world));
    } finally {
      records.lookup = originalLookup;
      records.readMany = originalReadMany;
      for (const entry of held) await release(entry);
    }
    expect(value.counts.runs).toBe(3);
    expect({ statusLookups: statusLookups.length, planReads, catalogReads })
      .toEqual({ statusLookups: 2, planReads: 1, catalogReads: 1 });
  });
});

/**
 * Ruling 35's merge step, tested as a pure rule: making 201 real live Runs would
 * start 201 sessions and hold 201 model requests, while the cap and the de-dupe
 * are decided entirely after the two status pages are read.
 */
describe('S9UI1 live-run merge', () => {
  const liveRun = (runId: string): RunSnapshot => ({
    ref: { aggregateType: 'Run', projectId: S6A_SCOPE.projectId, goalId: 's9ui1-merge-goal', runId },
    revision: 0, status: 'running', workspaceSnapshot: { workspaceId: S6A_SCOPE.workspaceId },
  } as unknown as RunSnapshot);

  it('row 11: 100 starting plus 101 running distinct Runs exceed the combined 200 cap', () => {
    /* Named mutation: drop the combined cap (return every merged row); red at `status` below. */
    const starting = Array.from({ length: 100 }, (_, index) => liveRun(`s9ui1-starting-${index}`));
    const running = Array.from({ length: 101 }, (_, index) => liveRun(`s9ui1-running-${index}`));
    expect(mergeLiveRuns([starting, running])).toEqual({ status: 'capacity' });
  });

  it('row 12: a Run that moved from starting to running is one row', () => {
    /* Named mutation: append the two pages without keying by the complete RunRef; red at the length below. */
    const run = liveRun('s9ui1-one-run');
    const merged = mergeLiveRuns([[run], [run]]);
    expect(merged.status).toBe('runs');
    if (merged.status !== 'runs') throw new Error('the merge refused two copies of one Run');
    expect(merged.runs.map(entry => entry.ref)).toEqual([run.ref]);
  });
});
