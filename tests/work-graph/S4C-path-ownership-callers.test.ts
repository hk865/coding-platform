/**
 * Slice 4C RW-13 (decision 72 / spec item 13): the view callers of the ONE pure
 * `pathOwnershipOf`. Each caller resolves a file path to its single owner by
 * directory boundary; the ancestor (A `src`) must not claim `src/deep/x.ts`
 * once B (`src/deep`) owns it, and an equal-length tie owns nothing.
 *
 * Callers covered here:
 *  - `mapExecutedFilesToModules` (goal-conflicts, exported unit);
 *  - the node-detail `underModule` file aggregation through the real
 *    `createNodeDetailReader().readGraphHover` and a scripted executed-files port.
 * The `find_graph` caller lives in `S3-graph-context.test.ts` (its natural seam).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { AdoptedArchitecture, ModuleDefinition } from '../../src/contracts/architecture-catalog.js';
import type { ModuleRef } from '../../src/contracts/core/identity.js';
import type { ArchitectureCatalogPort } from '../../src/core/work-graph/architecture/catalog-contracts.js';
import { createNodeDetailReader } from '../../src/core/work-graph/views/node-detail-reader.js';
import { mapExecutedFilesToModules } from '../../src/core/work-graph/views/goal-conflicts.js';
import type { SessionDutyReadPort } from '../../src/core/work-graph/model/work-line-contracts.js';
import type { WorkLineReaderDeps } from '../../src/core/work-graph/views/work-line-reader.js';
import {
  nodeReaderOf, openNodeFixture, scriptedExecutedFiles, type NodeFixture,
} from '../helpers/S2C-D-node-support.js';

const opened: NodeFixture[] = [];
afterEach(async () => { for (const fixture of opened.splice(0)) await fixture.close(); });

const PROJECT = 'p';
const moduleA: ModuleDefinition = { ref: { projectId: PROJECT, moduleId: 'A' }, name: 'A', responsibility: 'Own A',
  paths: ['src'], interfaces: [] };
const moduleB: ModuleDefinition = { ref: { projectId: PROJECT, moduleId: 'B' }, name: 'B', responsibility: 'Own B',
  paths: ['src/deep'], interfaces: [] };
/** RW-16: a parent P (`src`) and a declared child C (`src/c`). */
const moduleP: ModuleDefinition = { ref: { projectId: PROJECT, moduleId: 'P' }, name: 'P', responsibility: 'Own P',
  paths: ['src'], interfaces: [] };
const moduleC: ModuleDefinition = { ref: { projectId: PROJECT, moduleId: 'C' }, name: 'C', responsibility: 'Own C',
  paths: ['src/c'], interfaces: [] };

function catalogOf(modules: ModuleDefinition[], containment: AdoptedArchitecture['containment']): AdoptedArchitecture {
  return { modules, dependencies: [], requireDag: true, ...(containment === undefined ? {} : { containment }) };
}

/** A real node-detail reader whose catalog is the scripted architecture under test. */
function nodeReaderOverCatalog(fixture: NodeFixture, catalog: AdoptedArchitecture, files: string[]) {
  const catalogPort: ArchitectureCatalogPort = {
    async readArchitectureRevision() {
      return { status: 'ready', value: { baseline: {} as never, catalog: { catalog } as never } };
    },
    async adoptInitialArchitecture() { throw new Error('RW-13 test only reads the catalog'); },
    async reviseArchitectureCatalog() { throw new Error('RW-13 test only reads the catalog'); },
  };
  const lineDeps: WorkLineReaderDeps = { records: fixture.records,
    dutyFor: (async () => ({ status: 'ready' as const, value: 'executor' })) as SessionDutyReadPort,
    undeliveredRepliesFor: () => undefined, sessionAnomaliesFor: () => fixture.anomalies };
  const runRef = { aggregateType: 'Run' as const, projectId: PROJECT, goalId: fixture.goalRef.goalId, runId: 'rw13-run' };
  const reader = createNodeDetailReader({
    records: fixture.records, plans: fixture.plans, catalog: catalogPort, anomalies: fixture.anomalies,
    executedFiles: scriptedExecutedFiles({ availability: 'available', possiblyIncomplete: false, sourceCursor: null,
      files: files.map(path => ({ runRef, path, certainty: 'definite' as const })) }),
    line: lineDeps,
  });
  return reader;
}

describe('S4C RW-13 mapExecutedFilesToModules (goal-conflicts caller)', () => {
  it('RW-13 the deeper module owns src/deep/x.ts and the ancestor src does not', () => {
    const mapped = mapExecutedFilesToModules(catalogOf([moduleA, moduleB], { parentOf: [] }),
      [{ path: 'src/deep/x.ts', certainty: 'definite' }]);
    expect(mapped).toEqual([{ path: 'src/deep/x.ts', moduleRef: moduleB.ref, certainty: 'definite' }]);
  });

  it('RW-13 two modules on the same longest path tie and map to moduleRef null', () => {
    const twin: ModuleDefinition = { ...moduleB, ref: { projectId: PROJECT, moduleId: 'B2' }, name: 'B2' };
    const mapped = mapExecutedFilesToModules(catalogOf([moduleB, twin], { parentOf: [] }),
      [{ path: 'src/deep/x.ts', certainty: 'possible' }]);
    expect(mapped).toEqual([{ path: 'src/deep/x.ts', moduleRef: null, certainty: 'possible' }]);
  });

  it('RW-13 a directory boundary is respected: src does not own src2/x.ts', () => {
    const mapped = mapExecutedFilesToModules(catalogOf([moduleA], { parentOf: [] }),
      [{ path: 'src2/x.ts', certainty: 'definite' }]);
    expect(mapped).toEqual([{ path: 'src2/x.ts', moduleRef: null, certainty: 'definite' }]);
  });
});

describe('S4C RW-13 node-detail underModule caller', () => {
  it.each(['memory', 'sqlite'] as const)('RW-13 %s: the declared parent aggregates src/deep/x.ts, the child owns it', async kind => {
    const fixture = await openNodeFixture(kind);
    opened.push(fixture);
    const reader = nodeReaderOverCatalog(fixture, catalogOf([moduleA, moduleB], { parentOf: [{ parent: moduleA.ref, child: moduleB.ref }] }),
      ['src/deep/x.ts']);
    const hover = await reader.readGraphHover(fixture.ctx, { goalRef: fixture.goalRef });
    if (hover.status !== 'ready') throw new Error(`expected hover, got ${JSON.stringify(hover)}`);
    const a = hover.value.modules.find(module => (module.module as ModuleRef).moduleId === 'A')!;
    const b = hover.value.modules.find(module => (module.module as ModuleRef).moduleId === 'B')!;
    expect(a.files).toMatchObject({ availability: 'available', value: [{ path: 'src/deep/x.ts', certainty: 'definite' }] });
    expect(b.files).toMatchObject({ availability: 'available', value: [{ path: 'src/deep/x.ts', certainty: 'definite' }] });
  });

  it('RW-13 an equal-longest tie owns nothing: neither module lists the file', async () => {
    const fixture = await openNodeFixture('memory');
    opened.push(fixture);
    const twin: ModuleDefinition = { ...moduleB, paths: ['src'], ref: { projectId: PROJECT, moduleId: 'B' } };
    const reader = nodeReaderOverCatalog(fixture, catalogOf([moduleA, twin], undefined), ['src/x.ts']);
    const hover = await reader.readGraphHover(fixture.ctx, { goalRef: fixture.goalRef });
    if (hover.status !== 'ready') throw new Error(`expected hover, got ${JSON.stringify(hover)}`);
    for (const id of ['A', 'B']) {
      const module = hover.value.modules.find(candidate => (candidate.module as ModuleRef).moduleId === id)!;
      expect(module.files).toMatchObject({ availability: 'available', value: [] });
    }
  });

  it('RW-13 the existing fixture stays green: M owns m/a.ts and aggregates m/sub/x.ts', async () => {
    const fixture = await openNodeFixture('memory');
    opened.push(fixture);
    const files = { availability: 'available' as const, possiblyIncomplete: false, sourceCursor: null,
      files: [
        { runRef: { aggregateType: 'Run' as const, projectId: fixture.goalRef.projectId, goalId: fixture.goalRef.goalId, runId: 'rw13-m' },
          path: 'm/a.ts', certainty: 'definite' as const },
        { runRef: { aggregateType: 'Run' as const, projectId: fixture.goalRef.projectId, goalId: fixture.goalRef.goalId, runId: 'rw13-sub' },
          path: 'm/sub/x.ts', certainty: 'definite' as const },
      ] };
    const { reader } = nodeReaderOf(fixture, { executedFiles: scriptedExecutedFiles(files) });
    const hover = await reader.readGraphHover(fixture.ctx, { goalRef: fixture.goalRef });
    if (hover.status !== 'ready') throw new Error(`expected hover, got ${JSON.stringify(hover)}`);
    const m = hover.value.modules.find(module => (module.module as ModuleRef).moduleId === 'M')!;
    const sub = hover.value.modules.find(module => (module.module as ModuleRef).moduleId === 'M-sub')!;
    expect(m.files).toMatchObject({ availability: 'available', value: [{ path: 'm/a.ts' }, { path: 'm/sub/x.ts' }] });
    expect(sub.files).toMatchObject({ availability: 'available', value: [{ path: 'm/sub/x.ts' }] });
  });
});

describe('S4C RW-16 node-detail keeps the containment aggregation', () => {
  it.each(['memory', 'sqlite'] as const)(
    'RW-16 %s: a declared parent aggregates its child\'s files', async kind => {
      const fixture = await openNodeFixture(kind);
      opened.push(fixture);
      const reader = nodeReaderOverCatalog(fixture,
        catalogOf([moduleP, moduleC], { parentOf: [{ parent: moduleP.ref, child: moduleC.ref }] }), ['src/c/x.ts']);
      const hover = await reader.readGraphHover(fixture.ctx, { goalRef: fixture.goalRef });
      if (hover.status !== 'ready') throw new Error(`expected hover, got ${JSON.stringify(hover)}`);
      const p = hover.value.modules.find(module => (module.module as ModuleRef).moduleId === 'P')!;
      const c = hover.value.modules.find(module => (module.module as ModuleRef).moduleId === 'C')!;
      expect(p.files).toMatchObject({ availability: 'available',
        value: [{ path: 'src/c/x.ts', certainty: 'definite' }] });
      expect(c.files).toMatchObject({ availability: 'available',
        value: [{ path: 'src/c/x.ts', certainty: 'definite' }] });
    });

  it('RW-16 without a containment declaration only the owner module lists the file', async () => {
    const fixture = await openNodeFixture('memory');
    opened.push(fixture);
    const reader = nodeReaderOverCatalog(fixture, catalogOf([moduleP, moduleC], { parentOf: [] }), ['src/c/x.ts']);
    const hover = await reader.readGraphHover(fixture.ctx, { goalRef: fixture.goalRef });
    if (hover.status !== 'ready') throw new Error(`expected hover, got ${JSON.stringify(hover)}`);
    const p = hover.value.modules.find(module => (module.module as ModuleRef).moduleId === 'P')!;
    const c = hover.value.modules.find(module => (module.module as ModuleRef).moduleId === 'C')!;
    expect(p.files).toMatchObject({ availability: 'available', value: [] });
    expect(c.files).toMatchObject({ availability: 'available', value: [{ path: 'src/c/x.ts' }] });
  });
});
