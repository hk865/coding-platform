/**
 * R2 reads: the by-module groups (`alsoMaintains`), the module hover's real `maintainer` and `undivided`, the module
 * summary's maintainer brief, and the effective-region port on the fixed B-04 catalog. Every business row goes through
 * the one `S8B-maintainer-world.ts` world and its real HTTP entry; the effective-region port is G4's real
 * `createEffectiveScopeReader`, given the world's real `ctx`, the real catalog port and the real records backend. R
 * adds only its own goal/plan and failure steps test-locally.
 *
 * The named mutations are:
 * - `isUndividedModule` drops the one-module check: the root beside `flat2` turns `true`;
 * - `deriveGroups` sorts by JS `<` (UTF-16): `\u{10000}` becomes the line's `module`;
 * - `deriveGroups` groups by the first task's planned module: the maintainer line under `src` groups by its task;
 * - `maintainerOf` includes adviser links: the hover's `src` maintainer becomes the adviser L2 (or two owners);
 * - `effectiveRegions` infers children from `paths` when containment is absent: the flat port returns `flat2` too;
 * - the hover emits the wrong maintainer line (the adviser L2's brief);
 * - `isUndividedModule` drops the path check: the one non-root module of the pure table becomes undivided;
 * - the hover fixes the maintainer status to `assigned`: `N` and `root` lose their `none`;
 * - `readMaintainers` swallows a rejection: the hover answers `none` instead of the read's rejection;
 * - `readSummary` collects maintainers only in `assembleHover`: the module summary has no maintainer brief and ignores
 *   the failed read.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef } from '../../src/contracts/plan.js';
import type { GraphHoverReadV1, LineRowV1, NodeDetailV1, WorkLineListV1 } from '../../src/contracts/work-line.js';
import { createSessionDutyResolver } from '../../src/composition/session-duty.js';
import {
  createEffectiveScopeReader, type EffectiveScopeReaderDependencies,
} from '../../src/core/work-graph/views/role-scope-reader.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { readyValue } from '../helpers/S6A-memory-fixture.js';
import { activatePolicy, S8B_POLICY } from '../helpers/S8B-catalog-steps.js';
import {
  nodeReaderOf, openNodeFixture, type NodeFixture,
} from '../helpers/S2C-D-node-support.js';
import {
  openMaintainerWorld0, openMaintainerWorld0PrivateUse, openMaintainerWorld4, openMaintainerWorldFlat,
  openMaintainerWorldRoot, type MaintainerWorld,
} from '../helpers/S8B-maintainer-world.js';

// A4/A3: the real in-memory backend is handed to the platform and kept for G4's effective-scope port; the wrapper
// returns the real backend and records unchanged.
const captured = vi.hoisted((): { records: unknown } => ({ records: null }));
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) => {
  const mod = await importOriginal() as typeof import('../../src/core/record-store/in-memory-record-store.js');
  return {
    ...mod,
    createInMemoryRecordBackend: (options: Parameters<typeof mod.createInMemoryRecordBackend>[0]) => {
      const backend = mod.createInMemoryRecordBackend(options);
      captured.records = backend.records;
      return backend;
    },
  };
});

const worlds: MaintainerWorld[] = [];
const fixtures: NodeFixture[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
  for (const fixture of fixtures.splice(0)) await fixture.close().catch(() => undefined);
});

/**
 * A real Goal and its accepted Plan: `createGoal` -> `proposePlan` -> `applyPlanChange` through the platform's public
 * owners, the same steps the `plans/propose`/`plans/apply` routes expose. The one work task is scoped to
 * `taskModule`, which must name a module of the world's adopted catalog.
 */
async function openGoalWithPlan(world: MaintainerWorld, input: { goalId: string; taskModule: string }): Promise<{
  goalRef: GoalRef; planRef: PlanRevisionRef; task: TaskTriple;
}> {
  const registration = await world.platform.projects.readWorkspaceRegistration(world.ctx, world.scope);
  if (registration.status !== 'ready') throw new Error(`the registration read is not ready: ${JSON.stringify(registration)}`);
  const projectRef = registration.value.project.ref;
  const workspaceRef = registration.value.workspace.ref;
  const goalRef: GoalRef = { aggregateType: 'Goal', projectId: world.scope.projectId, goalId: input.goalId };
  // The adopted Plan needs the project's effective CompletionPolicy, through the same public install/activate owners
  // the `completion-policies/*` routes expose.
  await activatePolicy(world.platform, world.ctx, S8B_POLICY, `${input.goalId}-policy`);
  const created = await world.platform.goals.createGoal(world.ctx, {
    meta: { requestId: `${input.goalId}-create`, expected: [
      { ref: projectRef, revision: registration.value.project.revision },
      { ref: workspaceRef, revision: registration.value.workspace.revision },
    ] },
    input: { goalId: input.goalId, workspace: { ...world.scope }, objective: `Read the ${input.goalId} modules` },
  });
  if (created.status !== 'committed') throw new Error(`the Goal create failed: ${JSON.stringify(created)}`);
  const taskId = `${input.goalId}-task`;
  const draft: PlanRevisionDraft = {
    schemaVersion: 2, planId: `${input.goalId}-plan`, planRevision: 1, goalId: input.goalId,
    stages: [{ stageId: 's1', title: 'Stage one' }],
    tasks: [{ taskId, stageId: 's1', title: `Work ${taskId}`, requirementLevel: 'required', taskKind: 'work',
      disposition: 'active', phase: 'pending', scope: { kind: 'module', stageId: 's1', moduleRef: input.taskModule } },
      { taskId: `${input.goalId}-gate`, title: 'Goal gate', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } }],
    assignments: [{ taskId, role: 'platform-executor', instruction: 'Do the module work' }],
    obligations: [{ obligationId: 'o1', title: 'Deliver', requirementLevel: 'required',
      taskIds: [taskId, `${input.goalId}-gate`],
      verificationRequirements: [{ requirementId: 'v1', requirementLevel: 'required', kind: 'static',
        description: 'The module work is present' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] },
  };
  const proposed = await world.platform.plans.proposePlan(world.ctx, {
    meta: { requestId: `${input.goalId}-propose`, expected: [{ ref: goalRef, revision: created.value.revision }] },
    input: { goalRef, basedOn: null, draft, reason: { text: `The ${input.goalId} plan`, sources: [] } },
  });
  if (proposed.status !== 'committed') throw new Error(`the Plan proposal failed: ${JSON.stringify(proposed)}`);
  const applied = await world.platform.plans.applyPlanChange(world.ctx, {
    meta: { requestId: `${input.goalId}-apply`, expected: [{ ref: goalRef, revision: created.value.revision }] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] },
  });
  if (applied.status !== 'committed') throw new Error(`the Plan adoption failed: ${JSON.stringify(applied)}`);
  return { goalRef, planRef: applied.value.ref, task: { projectId: world.scope.projectId, goalId: input.goalId, taskId } };
}

const hoverOf = async (world: MaintainerWorld, goalRef: GoalRef): Promise<GraphHoverReadV1> =>
  readyValue<GraphHoverReadV1>((await world.postRoute('graph/hover', plain(world.scope, { goalRef }))).body, 'graph/hover');

const listOf = async (world: MaintainerWorld): Promise<WorkLineListV1> =>
  readyValue<WorkLineListV1>((await world.postRoute('lines/list', plain(world.scope, { workspace: world.scope }))).body,
    'lines/list');

const requiredRowOf = (list: WorkLineListV1, line: { ref: { sessionId: string } }): LineRowV1 => {
  const row = list.rows.find(candidate => candidate.key.sessionId === line.ref.sessionId);
  if (row === undefined) throw new Error(`lines/list has no row for ${line.ref.sessionId}`);
  return row;
};

/** G4's real effective-scope port over the one world's real records, catalog and duty resolver. */
function scopeReaderOf(world: MaintainerWorld) {
  const records = captured.records as EffectiveScopeReaderDependencies['records'];
  if (records === null) throw new Error('the world did not open its in-memory records backend');
  return createEffectiveScopeReader({
    records, architecture: world.platform.architecture,
    duties: createSessionDutyResolver({
      readRoleSpec: world.platform.roles.readRoleSpec.bind(world.platform.roles),
      configuration: undefined,
    }),
  });
}

const moduleIdsOf = async (world: MaintainerWorld, reader: ReturnType<typeof createEffectiveScopeReader>,
  duty: 'executor' | 'adviser', moduleId: string): Promise<string[]> => {
  const result = await reader.effectiveRegionOf(world.ctx, {
    projectRef: { projectId: world.scope.projectId }, duty, moduleRef: { projectId: world.scope.projectId, moduleId },
  });
  if (result.status !== 'ready') throw new Error(`effectiveRegionOf(${duty}, ${moduleId}) is not ready: ${JSON.stringify(result)}`);
  return result.value.map(module => module.moduleId);
};

describe('B02-groups', () => {
  it('B02-groups (memory): a line maintaining \\uE000 and \\u{10000} groups by UTF-8 order, and a task module is only a task group', async () => {
    const world = await openMaintainerWorld0PrivateUse({ backend: 'memory' });
    worlds.push(world);
    const planned = await openGoalWithPlan(world, { goalId: 'b02-groups', taskModule: 'N' });
    const target = { kind: 'task' as const, ref: planned.task };
    const first = await world.link({ line: world.lines.L1, target, requestId: 'b02-groups-task-L1' });
    expect(first.result).toMatchObject({ status: 'committed' });
    const second = await world.link({ line: world.lines.L2, target, requestId: 'b02-groups-task-L2' });
    expect(second.result).toMatchObject({ status: 'committed' });

    const list = await listOf(world);
    const maintainer = requiredRowOf(list, world.lines.L1);
    expect(maintainer.groups.module).toEqual({ projectId: 'p1', moduleId: '\uE000' });
    expect(maintainer.groups.alsoMaintains).toEqual([{ projectId: 'p1', moduleId: '\u{10000}' }]);
    expect(maintainer.groups.task).toEqual(planned.task);

    const taskOnly = requiredRowOf(list, world.lines.L2);
    expect(taskOnly.groups.module).toEqual({ projectId: 'p1', moduleId: 'N' });
    expect(taskOnly.groups.alsoMaintains).toEqual([]);
    expect(taskOnly.groups.task).toEqual(planned.task);
  });
});

describe('B04-region', () => {
  it('B04-region (memory): per-duty links compete, the effective region subtracts the deeper adviser, and the owner table follows coverage', async () => {
    const world = await openMaintainerWorld4({ backend: 'memory' });
    worlds.push(world);
    const planned = await openGoalWithPlan(world, { goalId: 'b04-region', taskModule: 'docs' });
    const src = world.module('src');

    // Both links to `src` are open: the executor maintainer claim and the adviser region claim are per duty.
    expect(await world.readLink(world.lines.L1, src)).toMatchObject({ revision: 1, until: null });
    expect(await world.readLink(world.lines.L2, src)).toMatchObject({ revision: 1, until: null });
    expect(await world.readLink(world.lines.L3, world.module('src/a/x'))).toMatchObject({ revision: 1, until: null });

    const hover = await hoverOf(world, planned.goalRef);
    const moduleHover = (moduleId: string) => {
      const found = hover.modules.find(candidate => candidate.module.moduleId === moduleId);
      if (found === undefined) throw new Error(`graph/hover has no module ${moduleId}`);
      return found;
    };
    expect(moduleHover('src').maintainer).toMatchObject({
      status: 'assigned', line: { key: world.lines.L1.ref, duty: 'executor' },
    });
    expect(moduleHover('src').undivided).toBe(false);
    const maintainerSessions = hover.modules.flatMap(candidate => candidate.maintainer.status === 'assigned'
      ? [candidate.maintainer.line.key.sessionId] : []);
    expect(maintainerSessions).toEqual([world.lines.L1.ref.sessionId]);

    const reader = scopeReaderOf(world);
    const l2Region = await moduleIdsOf(world, reader, 'adviser', 'src');
    expect(l2Region).toEqual(['src', 'src/a']);
    expect(l2Region).not.toContain('src/a/x');

    const coverage = {
      L1: await moduleIdsOf(world, reader, 'executor', 'src'),
      L2: l2Region,
      L3: await moduleIdsOf(world, reader, 'adviser', 'src/a/x'),
    };
    const ownersOf = (moduleId: string): string[] => ['L1', 'L2', 'L3']
      .filter(line => coverage[line as keyof typeof coverage].includes(moduleId));
    expect({
      root: ownersOf('root'), src: ownersOf('src'), 'src/a': ownersOf('src/a'),
      'src/a/x': ownersOf('src/a/x'), docs: ownersOf('docs'),
    }).toEqual({ root: [], src: ['L1', 'L2'], 'src/a': ['L1', 'L2'], 'src/a/x': ['L1', 'L3'], docs: [] });
  });
});

describe('B04-no-containment', () => {
  it('B04-no-containment (memory): the adviser region is root only, never the flat sibling', async () => {
    const world = await openMaintainerWorldFlat({ backend: 'memory' });
    worlds.push(world);
    const reader = scopeReaderOf(world);
    expect(await moduleIdsOf(world, reader, 'adviser', 'root')).toEqual(['root']);
  });
});

describe('R-hover-assigned', () => {
  it('R-hover-assigned (memory): src reports the executor L1 brief as its maintainer and is not undivided', async () => {
    const world = await openMaintainerWorld4({ backend: 'memory' });
    worlds.push(world);
    const planned = await openGoalWithPlan(world, { goalId: 'r-hover-assigned', taskModule: 'docs' });
    const hover = await hoverOf(world, planned.goalRef);
    const src = hover.modules.find(candidate => candidate.module.moduleId === 'src');
    if (src === undefined) throw new Error('graph/hover has no src module');
    expect(src.maintainer).toMatchObject({ status: 'assigned', line: { key: world.lines.L1.ref, duty: 'executor' } });
    expect(src.undivided).toBe(false);
  });
});

describe('R-hover-none', () => {
  it('R-hover-none (memory): a non-root module, a root beside another module and the one undivided root have no maintainer', async () => {
    const w0 = await openMaintainerWorld0({ backend: 'memory' });
    worlds.push(w0);
    const w0Plan = await openGoalWithPlan(w0, { goalId: 'r-hover-none-w0', taskModule: 'M' });
    const w0Hover = await hoverOf(w0, w0Plan.goalRef);
    const n = w0Hover.modules.find(candidate => candidate.module.moduleId === 'N');
    if (n === undefined) throw new Error('graph/hover has no N module');
    expect(n.maintainer).toEqual({ status: 'none' });
    expect(n.undivided).toBe(false);

    const flat = await openMaintainerWorldFlat({ backend: 'memory' });
    worlds.push(flat);
    const closed = await flat.link({ line: flat.lines.L1, target: flat.module('root'), active: false,
      requestId: 'r-hover-none-flat-close' });
    expect(closed.result).toMatchObject({ status: 'committed' });
    const flatPlan = await openGoalWithPlan(flat, { goalId: 'r-hover-none-flat', taskModule: 'flat2' });
    const flatHover = await hoverOf(flat, flatPlan.goalRef);
    const root = flatHover.modules.find(candidate => candidate.module.moduleId === 'root');
    if (root === undefined) throw new Error('graph/hover has no root module');
    expect(root.maintainer).toEqual({ status: 'none' });
    expect(root.undivided).toBe(false);

    const single = await openMaintainerWorldRoot({ backend: 'memory' });
    worlds.push(single);
    const singlePlan = await openGoalWithPlan(single, { goalId: 'r-hover-none-root', taskModule: 'root' });
    const singleRoot = (await hoverOf(single, singlePlan.goalRef)).modules
      .find(candidate => candidate.module.moduleId === 'root');
    if (singleRoot === undefined) throw new Error('graph/hover has no root module');
    expect(singleRoot.maintainer).toEqual({ status: 'none' });
    expect(singleRoot.undivided).toBe(true);
  });
});

describe('R-hover-failure', () => {
  it('R-hover-failure: the hover returns the maintainer read rejection, never none', async () => {
    const fixture = await openNodeFixture('memory');
    fixtures.push(fixture);
    const reason = 'the maintainer read failed';
    const { reader } = nodeReaderOf(fixture, {
      maintainerOf: async () => ({ status: 'rejected', code: 'unavailable', reason }),
    });
    expect(await reader.readGraphHover(fixture.ctx, { goalRef: fixture.goalRef }))
      .toEqual({ status: 'rejected', code: 'unavailable', reason });
  });
});

describe('R-summary-assigned', () => {
  it('R-summary-assigned (memory): the module summary carries the maintainer-only line brief', async () => {
    const world = await openMaintainerWorld4({ backend: 'memory' });
    worlds.push(world);
    const planned = await openGoalWithPlan(world, { goalId: 'r-summary-assigned', taskModule: 'docs' });
    const detail = readyValue<NodeDetailV1>((await world.postRoute('graph/detail', plain(world.scope, {
      goalRef: planned.goalRef, node: { kind: 'module', ref: world.module('src').ref },
      section: 'summary', page: { afterCursor: null, limit: 20 },
    }))).body, 'graph/detail');
    if (detail.section !== 'summary') throw new Error(`graph/detail answered ${detail.section}`);
    expect(detail.module?.maintainer).toMatchObject({
      status: 'assigned', line: { key: world.lines.L1.ref, duty: 'executor' },
    });
  });

  it('R-summary-assigned: a failed maintainer read is the module summary rejection', async () => {
    const fixture = await openNodeFixture('memory');
    fixtures.push(fixture);
    const reason = 'the summary maintainer read failed';
    const { reader } = nodeReaderOf(fixture, {
      maintainerOf: async () => ({ status: 'rejected', code: 'unavailable', reason }),
    });
    expect(await reader.readNodeDetail(fixture.ctx, {
      goalRef: fixture.goalRef, node: { kind: 'module', ref: fixture.moduleRef('M') },
      section: 'summary', page: { afterCursor: null, limit: 20 },
    })).toEqual({ status: 'rejected', code: 'unavailable', reason });
  });
});
