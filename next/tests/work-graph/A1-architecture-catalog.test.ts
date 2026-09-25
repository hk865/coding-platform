/**
 * A1 formal architecture catalog behavior tests (skeleton phase).
 *
 * These are the frozen behavior standard for the implementation phase. They run
 * against real Memory/SQLite RecordStore backends and the real Plan governance
 * reader. The skeleton service returns `unsupported`, so the success paths fail
 * with that real reason until implementation starts — never with an import or
 * type error.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import { resolveGovernance } from '../../src/core/work-graph/tasks/plan-readers.js';
import { createArchitectureCatalogService, readCatalogModuleFacts } from '../../src/core/work-graph/architecture/catalog-service.js';
import type { AdoptedArchitecture, ModuleDefinition } from '../../src/core/work-graph/architecture/catalog-contracts.js';
import {
  createGraphSessionFixture, GRAPH_MODULE_ONE, GRAPH_MODULE_TWO, commitBarrier, sampleCatalog,
  type GraphSessionFixture,
} from '../helpers/graph-session-fixture.js';

const fixtures: GraphSessionFixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });
async function make(kind: 'memory' | 'sqlite'): Promise<GraphSessionFixture> {
  const fixture = await createGraphSessionFixture(kind);
  fixtures.push(fixture);
  return fixture;
}
function module(projectId: string, moduleId: string): ModuleDefinition {
  return { ref: { projectId, moduleId }, name: moduleId, responsibility: `Owns ${moduleId}`,
    paths: [`src/${moduleId}`], interfaces: [] };
}
const activeKey = (projectId: string) =>
  canonicalJson({ aggregateType: 'ProjectArchitectureBaselineActive', projectId } as unknown as JsonValue);
function adoption(f: GraphSessionFixture, requestId: string) {
  return { input: { baselineId: 'a1-baseline', catalog: sampleCatalog(f.projectId), description: 'A1 architecture',
    constraints: [{ name: 'formal DAG', scope: 'project' }] }, meta: { requestId,
    expected: [{ ref: f.projectRef, revision: 1 }, { ref: f.workspaceRef, revision: 1 }] } };
}

describe.each(['memory', 'sqlite'] as const)('A1 architecture catalog over real %s RecordStore', kind => {
  it('adopts the first formal architecture and the real Plan governance reader consumes it', async () => {
    const fixture = await make(kind);
    const adopted = await fixture.adopt('adopt-initial');
    expect(adopted.status).toBe('committed');
    if (adopted.status !== 'committed') return;
    expect(adopted.value.catalog).not.toBeNull();
    expect(adopted.value.catalog?.catalog.modules.map(entry => entry.ref.moduleId))
      .toEqual([GRAPH_MODULE_ONE, GRAPH_MODULE_TWO]);
    expect(adopted.value.catalog?.ref).toMatchObject({
      aggregateType: 'ArchitectureCatalog', projectId: fixture.projectId,
      baselineId: adopted.value.baseline.ref.baselineId, revision: adopted.value.baseline.ref.revision,
    });
    // The catalog must not add fields to the baseline body: the canonical digest
    // computed by the existing reader still matches.
    const resolved = await resolveGovernance(fixture.records, fixture.projectId);
    expect(resolved.status).toBe('resolved');
    if (resolved.status !== 'resolved') return;
    expect(resolved.governance.architectureBaseline.ref).toEqual(adopted.value.baseline.ref);
    const read = await fixture.readRevision('current');
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    expect(read.value.catalog?.ref).toEqual(adopted.value.catalog?.ref);
    expect(read.value.baseline.contentDigest).toBe(adopted.value.baseline.contentDigest);
  });

  it('replays the same actor/requestId and rejects a different input under the same identity', async () => {
    const fixture = await make(kind);
    const first = await fixture.adopt('adopt-replay');
    expect(first.status).toBe('committed');
    if (first.status !== 'committed') return;
    const replay = await fixture.adopt('adopt-replay');
    expect(replay).toMatchObject({ status: 'committed', replayed: true });
    if (replay.status === 'committed') expect(replay.value.baseline.ref).toEqual(first.value.baseline.ref);
    const conflict = await fixture.adopt('adopt-replay', { baselineId: 'a1-baseline-other' });
    expect(conflict).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
  });

  it('refuses to overwrite a project that already has an active baseline', async () => {
    const fixture = await make(kind);
    const first = await fixture.adopt('adopt-first');
    expect(first.status).toBe('committed');
    const second = await fixture.adopt('adopt-second');
    expect(second.status).toBe('rejected');
    if (second.status === 'rejected') expect(second.code).toBe('revision_conflict');
  });

  it.each([
    {
      name: 'duplicate module IDs',
      build: (projectId: string): AdoptedArchitecture => ({
        modules: [module(projectId, 'alpha'), module(projectId, 'alpha')],
        dependencies: [], requireDag: true,
      }),
      codes: ['invalid'],
    },
    {
      name: 'a dependency with a dangling endpoint',
      build: (projectId: string): AdoptedArchitecture => ({
        modules: [module(projectId, 'alpha')],
        dependencies: [{ from: { projectId, moduleId: 'alpha' }, to: { projectId, moduleId: 'missing' }, reason: 'x' }],
        requireDag: true,
      }),
      codes: ['invalid'],
    },
    {
      name: 'a formal module cycle',
      build: (projectId: string): AdoptedArchitecture => ({
        modules: [module(projectId, 'alpha'), module(projectId, 'beta')],
        dependencies: [
          { from: { projectId, moduleId: 'alpha' }, to: { projectId, moduleId: 'beta' }, reason: 'a->b' },
          { from: { projectId, moduleId: 'beta' }, to: { projectId, moduleId: 'alpha' }, reason: 'b->a' },
        ],
        requireDag: true,
      }),
      codes: ['cycle'],
    },
    {
      name: 'requireDag relaxed to false',
      build: (projectId: string): AdoptedArchitecture => ({
        modules: [module(projectId, 'alpha')], dependencies: [], requireDag: false,
      }),
      codes: ['invalid'],
    },
    {
      name: 'a module ref from another project',
      build: (projectId: string): AdoptedArchitecture => ({
        modules: [module(projectId, 'alpha'), module('other-project', 'beta')],
        dependencies: [], requireDag: true,
      }),
      codes: ['forbidden'],
    },
  ])('rejects $name without writing anything', async ({ build, codes }) => {
    const fixture = await make(kind);
    const attempt = await fixture.adopt('adopt-invalid', { catalog: build(fixture.projectId) });
    expect(attempt.status).toBe('rejected');
    if (attempt.status === 'rejected') expect(codes).toContain(attempt.code);
    const active = await fixture.records.readMany([activeKey(fixture.projectId)]);
    expect(active.status).toBe('ready');
    if (active.status === 'ready') expect(active.value.records).toHaveLength(0);
  });

  it('commits exactly one of two concurrent first adoptions', async () => {
    const fixture = await make(kind);
    const barrier = commitBarrier(fixture.records);
    const service = createArchitectureCatalogService({ records: barrier.records });
    const [left, right] = await Promise.all([
      barrier.run(() => service.adoptInitialArchitecture(fixture.ctx, adoption(fixture, 'adopt-concurrent-left'))),
      barrier.run(() => service.adoptInitialArchitecture(fixture.ctx, adoption(fixture, 'adopt-concurrent-right'))),
    ]);
    expect(barrier.arrivals).toBe(2);
    expect([left, right].filter(result => result.status === 'committed')).toHaveLength(1);
    expect([left, right].filter(result => result.status === 'rejected')).toHaveLength(1);
  });

  it('rejects an untrusted principal before reading or writing', async () => {
    const fixture = await make(kind);
    const untrusted = {
      ...fixture.ctx,
      principal: { kind: 'host', actor: { kind: 'agent', id: 'model-actor' } },
    } as unknown as CoreCallContext;
    fixture.resetSpy();
    const result = await fixture.adopt('adopt-untrusted', {}, untrusted);
    expect(result).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(fixture.spy.readMany).toHaveLength(0);
    expect(fixture.spy.lookupCommits).toBe(0);
    expect(fixture.spy.commits).toBe(0);
  });

  it('reads a historical baseline as catalog:null instead of guessing an empty catalog', async () => {
    const fixture = await make(kind);
    const legacyRef = await fixture.seedLegacyArchitectureBaseline();
    const read = await fixture.readRevision('current');
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    expect(read.value.baseline.ref).toEqual(legacyRef);
    expect(read.value.catalog).toBeNull();
  });

  it('distinguishes a missing pointer, a digest-inconsistent record and a readable revision', async () => {
    const fixture = await make(kind);
    const missing = await fixture.readRevision('current');
    expect(missing).toEqual({ status: 'not_found' });

    await fixture.seedTamperedArchitectureBaseline();
    const corrupt = await fixture.readRevision('current');
    expect(corrupt.status).toBe('rejected');
    if (corrupt.status === 'rejected') expect(corrupt.code).toBe('unavailable');

    const healthy = await make(kind);
    await healthy.seedLegacyArchitectureBaseline('a1-readable-baseline');
    const ok = await healthy.readRevision('current');
    expect(ok.status).toBe('ready');
  });

  it('exposes the module-facts seam the Session writer will join to its CAS', async () => {
    const fixture = await make(kind);
    const adopted = await fixture.adopt('adopt-module-facts');
    expect(adopted.status).toBe('committed');
    const facts = await readCatalogModuleFacts(fixture.records, fixture.ctx,
      { projectId: fixture.projectId, moduleId: GRAPH_MODULE_ONE });
    expect(facts.status).toBe('ready');
    if (facts.status !== 'ready') return;
    expect(facts.value.module.ref.moduleId).toBe(GRAPH_MODULE_ONE);
    const aggregateTypes = facts.value.guards.map(guard => JSON.parse(guard.refKey).aggregateType);
    for (const type of ['ArchitectureBaselineRevision', 'ArchitectureCatalog', 'ProjectArchitectureBaselineActive']) {
      expect(aggregateTypes).toContain(type);
    }
  });

  it('rolls back catalog, baseline, pointer, events and receipt on a real Store fault', async () => {
    const f = await make(kind);
    const before = await f.records.readMany([]);
    f.resetSpy(); f.failNextWrite();
    expect(await f.adopt('faulted-adoption')).toMatchObject({ status: 'rejected', code: 'unavailable' });
    expect(f.injectedFailures).toBe(1);
    expect(f.spy.prepared).toHaveLength(1);
    const batch = f.spy.prepared[0]!;
    expect(await f.records.readMany(batch.records.map(row => row.refKey)))
      .toMatchObject({ status: 'ready', value: { records: [] } });
    expect(await f.records.readMany([])).toEqual(before);
    expect(await f.records.lookupCommit({ identityKey: batch.identityKey, fingerprint: batch.fingerprint }))
      .toMatchObject({ status: 'rejected', code: 'not_found' });
    expect(await f.adopt('faulted-adoption')).toMatchObject({ status: 'committed', replayed: false });
  });

  it('captures nested catalog input before its first asynchronous Store operation', async () => {
    const f = await make(kind);
    const request = adoption(f, 'owned-adoption');
    const original = structuredClone(request.input.catalog);
    let mutated = false;
    const mutate = () => { if (!mutated) { mutated = true; request.input.catalog.modules[0]!.name = 'changed-after-call'; } };
    const records = { ...f.records,
      async lookupCommit(input: Parameters<typeof f.records.lookupCommit>[0]) { mutate(); return f.records.lookupCommit(input); },
      async readMany(keys: readonly string[]) { mutate(); return f.records.readMany(keys); } };
    const service = createArchitectureCatalogService({ records });
    const result = await service.adoptInitialArchitecture(f.ctx, request);
    expect(mutated).toBe(true);
    expect(result).toMatchObject({ status: 'committed', value: { catalog: { catalog: original } } });
  });
});

it('reopens the SQLite ledger and reads the exact adopted revision', async () => {
  const fixture = await make('sqlite');
  const adopted = await fixture.adopt('adopt-restart');
  expect(adopted.status).toBe('committed');
  if (adopted.status !== 'committed') return;
  const connection = await fixture.reopen();
  const read = await connection.catalog.readArchitectureRevision(fixture.ctx,
    { selection: { kind: 'revision', ref: adopted.value.baseline.ref } });
  expect(read.status).toBe('ready');
  if (read.status !== 'ready') return;
  expect(read.value.baseline.ref).toEqual(adopted.value.baseline.ref);
  expect(read.value.catalog?.catalog).toEqual(adopted.value.catalog?.catalog);
});
