/**
 * Parallel catalog revisions must not share one revision.
 *
 * Project A's revision reads the current catalog revision, then waits on its
 * real Session duty read (a RoleSpec store read held by the local test-side
 * gate). Project B completes two of its own revisions meanwhile. When A's duty
 * read is released, A's `SessionResponsibilityChanged.basis.catalogRevision`
 * must still be A's own revision (1), never the revision B's read observed (2).
 *
 * The world is the real `openS8CCatalogWorld` platform, without the
 * catalog-service mock, so the production responsibility port is the one under
 * test. B is a second project created through the platform's own
 * `projects.createProject`/`registerWorkspace`/initial-adoption entries.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModuleDefinition } from '../../src/contracts/architecture-catalog.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { VersionPin, WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { ResponsibilityMoveV1 } from '../../src/contracts/note.js';
import type { RoleSpecContentV1 } from '../../src/contracts/role-spec.js';
import { roleSpecContentDigest } from '../../src/contracts/role-spec.js';
import { catalogPinOf } from '../../src/core/work-graph/architecture/catalog-service.js';
import { openS8CCatalogWorld, s8cCatalog, S8C_AT, type S8CWorld } from '../helpers/S8C-catalog-world.js';
import { roleReadGate } from '../helpers/S8C-role-read-gate.js';
import { committed, ready } from '../helpers/S1-runtime-scenario-fixture.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S8C-role-read-gate.js')).inMemoryRoleGateModule(importOriginal));

const worlds: S8CWorld[] = [];
afterEach(async () => {
  roleReadGate.reset();
  await Promise.all(worlds.splice(0).map(world => world.close()));
});

const ROLE_SPEC_ID = 's8c-row4-role-spec';
const ROLE_SPEC_CONTENT: RoleSpecContentV1 = {
  schemaVersion: 1, platformDuty: 'executor', label: 'Row 4 executor',
  purpose: 'Hold the duty read while another project revises',
  responsibility: ['execution'],
  requiredMaterials: [{ kind: 'contract', reason: 'Read the assigned task' }], optionalMaterials: [],
  permissions: { tools: ['read'], writeScope: 'none' },
  budget: { source: 'task-budget', scope: 'assigned-task' },
  requiredOutputs: [{ kind: 'answer-with-sources', reason: 'Report the result' }],
  exit: { success: 'Done', stop: 'Stop on a refused read', handoff: 'Keep the result' },
};

async function currentRevision(world: S8CWorld, ctx: CoreCallContext): Promise<number> {
  const read = ready(await world.platform.architecture.readArchitectureRevision(ctx, {
    selection: { kind: 'current' },
  }));
  if (read.catalog === null) throw new Error('row 4: the current revision has no catalog');
  return read.catalog.ref.revision;
}

async function scopePins(world: S8CWorld, ctx: CoreCallContext,
  scope: WorkspaceScope): Promise<VersionPin[]> {
  const read = ready(await world.platform.projects.readWorkspaceRegistration(ctx, scope));
  return [{ ref: read.project.ref, revision: read.project.revision },
    { ref: read.workspace.ref, revision: read.workspace.revision }];
}

/** Project B through the platform's own registration and adoption entries. */
async function openProjectB(world: S8CWorld, projectId: string) {
  const workspaceId = 'main';
  const scope: WorkspaceScope = { projectId, workspaceId };
  const ctx: CoreCallContext = { ...world.ctx, projectId, workspaceId,
    materialReader: world.ctx.materialReader.kind === 'host'
      ? { ...world.ctx.materialReader, projectId, workspaceId } : world.ctx.materialReader };
  committed(await world.platform.projects.createProject(ctx, {
    meta: { requestId: `${projectId}-create`, expected: [
      { ref: { aggregateType: 'Project' as const, projectId }, revision: 0 }] },
    input: { projectId },
  }));
  committed(await world.platform.projects.registerWorkspace(ctx, {
    meta: { requestId: `${projectId}-register`, expected: [
      { ref: { aggregateType: 'Project' as const, projectId }, revision: 1 },
      { ref: { aggregateType: 'Workspace' as const, projectId, workspaceId }, revision: 0 }] },
    input: { workspace: scope },
  }));
  committed(await world.platform.architecture.adoptInitialArchitecture(ctx, {
    meta: { requestId: `${projectId}-adopt`, expected: await scopePins(world, ctx, scope) },
    input: { baselineId: `${projectId}-baseline`, description: 'Row 4 project B',
      constraints: [], catalog: s8cCatalog(projectId) },
  }));
  return { ctx, scope };
}

const B_EXTRA: (projectId: string) => ModuleDefinition = projectId => ({
  ref: { projectId, moduleId: 'row4-b-extra' }, name: 'row4-b-extra',
  responsibility: 'Own row4-b-extra', paths: ['row4-b-extra'], interfaces: [],
});

describe('S8C row 4 parallel catalog revisions', () => {
  it('row 4: a held A duty read keeps A\'s own catalogRevision after B revises', async () => {
    const world = await openS8CCatalogWorld('memory');
    worlds.push(world);
    const projectA = world.scope.projectId;

    // A starts at its one initial adoption, and its line is a real RoleSpec
    // reader (so the duty read reaches the RoleSpec store).
    expect(await currentRevision(world, world.ctx)).toBe(1);
    const principal = world.ctx.principal;
    if (principal.kind !== 'host') throw new Error('row 4: the world context is not a Host principal');
    const installed = await world.platform.roles.installRoleSpec(world.ctx, {
      commandId: `${ROLE_SPEC_ID}-install`, commandType: 'InstallRoleSpecRevision', schemaVersion: 1,
      correlationId: ROLE_SPEC_ID, submittedAt: S8C_AT,
      identity: { projectId: projectA, actor: { ...principal.actor },
        idempotencyKey: `${ROLE_SPEC_ID}-install` },
      payload: { roleId: ROLE_SPEC_ID, revision: 1, content: ROLE_SPEC_CONTENT,
        contentDigest: roleSpecContentDigest(ROLE_SPEC_CONTENT, ROLE_SPEC_ID, 1) },
    });
    if (installed.status !== 'committed') {
      throw new Error(`row 4: the RoleSpec was not installed: ${JSON.stringify(installed)}`);
    }
    const created = await world.platform.runtime.createSession(world.ctx, {
      workspace: world.scope,
      role: { kind: 'role_spec', pin: { ref: installed.revisionRef, digest: installed.contentDigest } },
      recommendedRefs: [], initialLinks: [],
      meta: { requestId: `${ROLE_SPEC_ID}-session`, expected: [] },
    });
    if (created.status !== 'completed') throw new Error(`row 4: the RoleSpec line was not created`);
    const line = await world.link(created.value, 'docs');

    // Project B: one real add reaches revision 2, the revision its own
    // responsibility read will observe.
    const projectB = `${projectA}-row4-b`;
    const b = await openProjectB(world, projectB);
    let bRevisions = 0;
    const reviseB = async (ops: unknown[]) => {
      const current = ready(await world.platform.architecture.readArchitectureRevision(b.ctx, {
        selection: { kind: 'current' },
      }));
      if (current.catalog === null) throw new Error('row 4: the current revision has no catalog');
      return committed(await world.platform.architecture.reviseArchitectureCatalog(b.ctx, {
        meta: { requestId: `${projectB}-revise-${++bRevisions}`,
          expected: await scopePins(world, b.ctx, b.scope) },
        input: { expected: catalogPinOf(current), ops: ops as never,
          responsibilityMoves: [], reason: 'row 4 project B revision' },
      }));
    };
    await reviseB([{ op: 'add_module', module: B_EXTRA(projectB) }]);
    expect(await currentRevision(world, b.ctx)).toBe(2);

    // A's revision adds a module and moves its RoleSpec line from `docs` to `src/a`; its
    // planner reads the catalog (revision 1), then waits on the duty read.
    const hold = roleReadGate.holdRead(keys => keys.some(key => key.includes('RoleSpecRevision')));
    const move: ResponsibilityMoveV1 = {
      link: line.ref,
      to: { kind: 'modules', destinations: [{ projectId: projectA, moduleId: 'src/a' }] },
    };
    const aExtra: ModuleDefinition = { ref: { projectId: projectA, moduleId: 'row4-a-extra' },
      name: 'row4-a-extra', responsibility: 'Own row4-a-extra', paths: ['row4-a-extra'], interfaces: [] };
    const revisingA = world.revise({ ops: [{ op: 'add_module', module: aExtra }],
      responsibilityMoves: [move], reason: 'row 4 project A revision' });
    await hold.reached;

    // While A waits, B completes the revision whose responsibility read sees
    // B's revision 2. A's event must not adopt it.
    const bRevisionAtRead = await currentRevision(world, b.ctx);
    expect(bRevisionAtRead).toBe(2);
    await reviseB([{ op: 'remove_module', moduleId: 'row4-b-extra' }]);
    expect(await currentRevision(world, b.ctx)).toBe(3);

    hold.release();
    const revised = committed(await revisingA);
    expect(revised.baseline.ref.revision).toBe(2);

    const commit = roleReadGate.commits().find(candidate => candidate.events.some(event =>
      event.eventType === 'SessionResponsibilityChanged'));
    if (commit === undefined) throw new Error('row 4: A\'s revision carried no responsibility event');
    const changed = commit.events.find(event => event.eventType === 'SessionResponsibilityChanged')!;
    const body = JSON.parse(changed.json) as { basis?: { catalogRevision?: number } };
    expect(body.basis?.catalogRevision).toBe(1);
    expect(body.basis?.catalogRevision).not.toBe(bRevisionAtRead);
  });
});
