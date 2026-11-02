/**
 * G4-scope-read: the G1-2 effective-scope port is proved through G4's exported `createEffectiveScopeReader`
 * over real `sessions/link` records and a real adopted catalog. A project link stops
 * the read first; otherwise one entry per open goal link and one per open region link, each region's modules from
 * the one `effectiveRegions` table (module M's deeper same-duty child N is subtracted); `effectiveRegionOf` is the
 * same table narrowed to one duty. The project line of the second workspace is readable because the reader reads
 * its Session record by ref, not through `sessions.readSession`.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createArchitectureCatalogService } from '../../src/core/work-graph/architecture/catalog-service.js';
import type { ArchitectureRevision } from '../../src/core/work-graph/architecture/catalog-contracts.js';
import { plainSessionRefKey } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { S6A_SECRETARY_ROLE } from '../helpers/S6A-request-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { s6b2Backend, s6b2Duty, type S6B2Captured } from '../helpers/S6B2-handoff-scene.js';
import {
  linkS7D1Line, openS7D1ProjectCardWorld,
} from '../helpers/S7D1-project-card-world.js';
import { committed, ready } from '../helpers/S7A-fixture.js';

const captured = vi.hoisted((): S6B2Captured => ({ backend: null }));
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) => {
  const module = await importOriginal() as typeof import('../../src/core/record-store/in-memory-record-store.js');
  const { sealInMemory } = await import('../helpers/S6B2-handoff-scene.js');
  return sealInMemory(captured, module, true);
});

describe('the effective scope read port', () => {
  let opened: Awaited<ReturnType<typeof openS7D1ProjectCardWorld>>;
  beforeAll(async () => { opened = await openS7D1ProjectCardWorld({ backend: 'memory' }); }, 180_000);
  afterEach(() => { commitBarrier.reset(); });
  afterAll(async () => { await opened?.world.close(); });

  it('stops at the project link, lists one goal and one region per open link, and narrows the region table to one duty', async () => {
    const reader = (await import('../../src/core/work-graph/views/role-scope-reader.js'))
      .createEffectiveScopeReader({
        records: s6b2Backend(captured).records,
        architecture: opened.world.platform.architecture,
        duties: s6b2Duty,
      });
    const ctx = opened.a.humanContext();
    const projectId = opened.projectId;

    // A project-responsible link (with a module link beside it) stops the read at the project.
    expect(await reader.readEffectiveScope(ctx, { session: opened.lines.secretary.ref }))
      .toEqual({ status: 'ready', value: [{ kind: 'project' }] });

    // The second workspace's project line is another workspace's Session: read by ref, it still answers.
    const bLine = await createS6BLine(opened.b, { label: 's7d1-b-project', role: S6A_SECRETARY_ROLE });
    await linkS7D1Line(opened.b, bLine, { kind: 'project', ref: { projectId: opened.projectId } }, 'b-project');
    expect(await reader.readEffectiveScope(ctx, { session: bLine.ref }))
      .toEqual({ status: 'ready', value: [{ kind: 'project' }] });

    // The adviser has two open goal links (the two Goal refs) and two open region links (M and its child N).
    await linkS7D1Line(opened.a, opened.lines.adviser,
      { kind: 'goal', ref: opened.world.goals.second }, 'adviser-goal-second');
    expect(await reader.readEffectiveScope(ctx, { session: opened.lines.adviser.ref })).toEqual({
      status: 'ready',
      value: [
        { kind: 'goal', goalRef: opened.world.goals.first },
        { kind: 'goal', goalRef: opened.world.goals.second },
        { kind: 'region', moduleRef: opened.catalog.moduleM, modules: [opened.catalog.moduleM] },
        { kind: 'region', moduleRef: opened.catalog.moduleN, modules: [opened.catalog.moduleN] },
      ],
    });

    // The same table narrowed to the adviser duty: M's deeper same-duty child N is subtracted.
    expect(await reader.effectiveRegionOf(ctx, {
      projectRef: { projectId }, duty: 'adviser', moduleRef: opened.catalog.moduleM,
    })).toEqual({ status: 'ready', value: [opened.catalog.moduleM] });
  });

  it.each([
    { name: 'a failed Session record read', async run() {
      const records = s6b2Backend(captured).records;
      const fault = commitBarrier.failReads(plainSessionRefKey(opened.lines.adviser.ref), 'throw-once');
      try {
        const reader = (await import('../../src/core/work-graph/views/role-scope-reader.js'))
          .createEffectiveScopeReader({ records, architecture: opened.world.platform.architecture, duties: s6b2Duty });
        expect(await reader.effectiveRegionOf(opened.a.humanContext(), {
          projectRef: { projectId: opened.projectId }, duty: 'adviser', moduleRef: opened.catalog.moduleM,
        })).toMatchObject({ status: 'rejected', code: 'unavailable' });
        expect(fault.calls()).toBeGreaterThan(0);
      } finally {
        fault.release();
      }
    } },
    { name: 'a catalog revision between the two catalog window reads', async run() {
      const ctx = opened.a.humanContext();
      const current = ready<ArchitectureRevision>(await opened.a.route('architecture/read',
        { selection: { kind: 'current' } }), 'the current architecture before the stale read');
      const registration = ready<{ project: { revision: number }; workspace: { revision: number } }>(
        await opened.a.route('workspaces/registration',
          { projectId: opened.projectId, workspaceId: opened.a.scope.workspaceId }), 'the registration');
      const records = s6b2Backend(captured).records;
      let armed = true;
      const wrapped = { ...records, async readMany(keys: readonly string[]) {
        if (armed && keys.length === 3) {
          armed = false;
          committed(await opened.world.platform.architecture.reviseArchitectureCatalog(ctx, {
            meta: { requestId: 's7d1-scope-stale', expected: [
              { ref: { aggregateType: 'Project', projectId: opened.projectId }, revision: registration.project.revision },
              { ref: { aggregateType: 'Workspace', ...opened.a.scope }, revision: registration.workspace.revision },
            ] },
            input: { basedOn: { ref: current.baseline.ref, digest: current.baseline.contentDigest },
              catalog: current.catalog.catalog, reason: 'S7D1 G4 moves the catalog inside the scope read window' },
          }), 'the catalog revision');
        }
        return records.readMany(keys);
      } };
      const reader = (await import('../../src/core/work-graph/views/role-scope-reader.js'))
        .createEffectiveScopeReader({ records, architecture: createArchitectureCatalogService({ records: wrapped }),
          duties: s6b2Duty });
      expect(await reader.effectiveRegionOf(ctx, {
        projectRef: { projectId: opened.projectId }, duty: 'adviser', moduleRef: opened.catalog.moduleM,
      })).toMatchObject({ status: 'rejected', code: 'source_stale' });
      expect(armed).toBe(false);
    } },
  ])('$name makes the scope read refuse, never an empty scope', async ({ run }) => {
    await run();
  });
});
