/**
 * 8C row 6 (start ruling §5): one module delete through the real catalog
 * owner, over W-B's fixed catalog (tests/helpers/S8C-catalog-world.ts). Level 2:
 * the real `reviseArchitectureCatalog` owner and real store; the pin is the
 * public current-revision read. The plan-pointer sub-row runs on both backends
 * (the book's storage row); every other row is memory.
 *
 * The future-adoption branch (B01-adopt-future, the terminal-history exemption,
 * a new/changed/re-enabled module task) belongs to G4b's plan-service rows and
 * is not faked here. M-02's delete half and M-15/M-16 belong to the migration
 * subagent's old-note fixtures and are not duplicated.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ArchitectureBaselineRevisionRef } from '../../src/contracts/governance.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import { commitBarrier, byIdentityPrefix } from '../helpers/S6A-commit-barrier.js';
import { BACKENDS } from '../helpers/S8B-catalog-steps.js';
import { catalogRevisionModule, openS8CCatalogWorld } from '../helpers/S8C-catalog-world.js';
import { committed, ready } from '../helpers/S1-runtime-scenario-fixture.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));
const catalogMock = vi.hoisted(() => ({ actual: null as null | Record<string, unknown>,
  revision: null as null | Record<string, unknown> }));
vi.mock('../../src/core/work-graph/architecture/catalog-service.js', async importOriginal => {
  const actual = await importOriginal() as Record<string, unknown>;
  catalogMock.actual = actual;
  return { ...actual, createArchitectureCatalogService: (stores: unknown) => {
    if (catalogMock.revision === null) throw new Error('the catalog revision factory is not bound');
    return (catalogMock.revision['createArchitectureCatalogService'] as (stores: unknown) => unknown)(stores);
  } };
});
beforeAll(async () => { catalogMock.revision = await catalogRevisionModule(async () => catalogMock.actual!); });

type World = Awaited<ReturnType<typeof openS8CCatalogWorld>>;
const worlds: World[] = [];
afterEach(async () => {
  commitBarrier.reset();
  await Promise.all(worlds.splice(0).map(world => world.close()));
});

async function openWorld(backend: 'memory' | 'sqlite' = 'memory'): Promise<World> {
  const world = await openS8CCatalogWorld(backend);
  worlds.push(world);
  return world;
}

/** A v2 draft: one required work task per scope (a module id or the stage) plus the goal gate. */
function planDraftOf(goalId: string, scopes: (string | null)[], planRevision: number): PlanRevisionDraft {
  const work = scopes.map((_, index) => `work-${index}`);
  return {
    schemaVersion: 2, planId: `s8c-plan-${planRevision}`, planRevision, goalId,
    stages: [{ stageId: 'build', title: 'Build' }],
    tasks: [
      ...scopes.map((moduleRef, index) => ({ taskId: work[index]!, stageId: 'build', title: `Work ${index}`,
        requirementLevel: 'required' as const, taskKind: 'work' as const, disposition: 'active' as const,
        phase: 'pending' as const, executionIntent: 'request_execution' as const,
        scope: moduleRef === null ? { kind: 'stage' as const, stageId: 'build' }
          : { kind: 'module' as const, stageId: 'build', moduleRef } })),
      { taskId: 'gate', title: 'Goal gate', requirementLevel: 'required' as const, taskKind: 'gate' as const,
        disposition: 'active' as const, phase: 'pending' as const, scope: { kind: 'goal' as const } },
    ],
    assignments: work.map(taskId => ({ taskId, role: 'builder', instruction: `Do ${taskId}` })),
    obligations: [{ obligationId: 'deliver', title: 'Deliver', requirementLevel: 'required' as const,
      taskIds: [...work, 'gate'], verificationRequirements: [{ requirementId: 'static',
        requirementLevel: 'required' as const, kind: 'static', description: 'The static check passes' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
  };
}

/** `plans/propose` + `plans/apply` of one draft; returns the committed plan and its work task ids. */
async function adoptModulePlan(world: World, label: string, scopes: (string | null)[], planRevision: number) {
  const goal = await world.goal(`s8c-goal-${label}`);
  const proposal = committed((await world.propose({ goal, draft: planDraftOf(goal.goalId, scopes, planRevision) })).result);
  const applied = await world.apply(proposal);
  committed(applied.result);
  return { goal, taskId: scopes.findIndex(scope => scope !== null) >= 0 ? `work-${scopes.findIndex(scope => scope !== null)}` : null };
}

describe('S8C R6 delete rules', () => {
  it('module_in_use: an open module task refuses the delete and lists the task', async () => {
    const world = await openWorld();
    const { taskId } = await adoptModulePlan(world, 'in-use', ['src/a/x'], 1);
    const result = await world.revise({ ops: [{ op: 'remove_module', moduleId: 'src/a/x' }] });
    expect(result).toEqual({ status: 'rejected', code: 'invalid',
      reason: `module_in_use: ${String(taskId)}` });
    expect(ready(await world.platform.architecture.readArchitectureRevision(world.ctx,
      { selection: { kind: 'current' } })).catalog?.catalog.modules.map(module => module.ref.moduleId))
      .toContain('src/a/x');
  });

  it('module_in_use: a Goal in a second workspace of the same project keeps the module (row 5)', async () => {
    const world = await openWorld();
    const second = await world.openWorkspace('second');
    const goal = await second.goal('s8c-goal-second-workspace');
    const proposal = committed(await second.propose({ goal, draft: planDraftOf(goal.goalId, ['docs'], 1) }));
    committed(await second.apply(proposal));
    expect(await world.revise({ ops: [{ op: 'remove_module', moduleId: 'docs' }] }))
      .toEqual({ status: 'rejected', code: 'invalid', reason: 'module_in_use: work-0' });
  });

  it.each([
    { kind: 'dependency', prepare: [{ op: 'add_dependency' as const,
      from: { projectId: 's8c-catalog', moduleId: 'src' }, to: { projectId: 's8c-catalog', moduleId: 'docs' },
      reason: 'src calls docs' }], deleteOps: [
      { op: 'set_parent' as const, moduleId: 'src/a', parentId: 'root' },
      { op: 'remove_module' as const, moduleId: 'src' }] },
    { kind: 'forbid', prepare: [{ op: 'add_forbid_rule' as const,
      from: { projectId: 's8c-catalog', moduleId: 'src' }, to: { projectId: 's8c-catalog', moduleId: 'docs' },
      reason: 'src must not call docs' }], deleteOps: [
      { op: 'set_parent' as const, moduleId: 'src/a', parentId: 'root' },
      { op: 'remove_module' as const, moduleId: 'src' }] },
    { kind: 'containment', prepare: [], deleteOps: [{ op: 'remove_module' as const, moduleId: 'src' }] },
  ])('module_has_edges: an uncleared $kind edge refuses the delete', async ({ prepare, deleteOps }) => {
    const world = await openWorld();
    if (prepare.length > 0) committed(await world.revise({ ops: prepare, reason: 'add the edge' }));
    expect(await world.revise({ ops: deleteOps, reason: 'delete src with one edge left' }))
      .toEqual({ status: 'rejected', code: 'invalid', reason: 'module_has_edges' });
  });

  it('a delete with no open task and no edge commits once; the old revision stays readable', async () => {
    const world = await openWorld();
    const before = ready(await world.platform.architecture.readArchitectureRevision(world.ctx,
      { selection: { kind: 'current' } }));
    const oldRef: ArchitectureBaselineRevisionRef = before.baseline.ref;
    const result = await world.revise({ ops: [{ op: 'remove_module', moduleId: 'docs' }], reason: 'remove docs' });
    const revision = committed(result);
    expect(revision.baseline.ref.revision).toBe(oldRef.revision + 1);
    expect(revision.catalog.catalog.modules.map(module => module.ref.moduleId)).not.toContain('docs');
    expect((await world.readRevision(oldRef)).catalog?.catalog.modules.map(module => module.ref.moduleId))
      .toContain('docs');
    expect((await world.pin()).catalogRef.revision).toBe(revision.baseline.ref.revision);
  });

  it.each(BACKENDS)('a concurrent plan adoption is a revision conflict; the retry sees the new plan (%s)', async backend => {
    const world = await openWorld(backend);
    const { goal } = await adoptModulePlan(world, `race-${backend}`, [null], 1);
    const hold = commitBarrier.hold(byIdentityPrefix('architecture-catalog-revise:'), 'the delete');
    const ops = [{ op: 'remove_module', moduleId: 'docs' }] as const;
    const revising = world.revise({ ops: [...ops], reason: 'delete docs' });
    await hold.reached;
    try {
      const basedOn = ready(await world.platform.plans.queryGoal(world.ctx, goal)).goal.activePlanRevision;
      const proposal = committed((await world.propose({ goal, basedOn,
        draft: planDraftOf(goal.goalId, ['docs'], 2) })).result);
      committed((await world.apply(proposal)).result);
    } finally {
      hold.release();
    }
    expect(await revising).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(await world.revise({ ops: [...ops], reason: 'retry the delete' }))
      .toMatchObject({ status: 'rejected', code: 'invalid', reason: 'module_in_use: work-0' });
  });

  it('a Goal created while the delete is held is a revision conflict; the retry sees it in use (row 3)', async () => {
    const world = await openWorld();
    const hold = commitBarrier.hold(byIdentityPrefix('architecture-catalog-revise:'), 'the delete');
    const ops = [{ op: 'remove_module', moduleId: 'docs' }] as const;
    const revising = world.revise({ ops: [...ops], reason: 'delete docs' });
    await hold.reached;
    try {
      await adoptModulePlan(world, 'late-goal', ['docs'], 1);
    } finally {
      hold.release();
    }
    expect(await revising).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(await world.revise({ ops: [...ops], reason: 'retry the delete' }))
      .toMatchObject({ status: 'rejected', code: 'invalid', reason: 'module_in_use: work-0' });
  });
});
