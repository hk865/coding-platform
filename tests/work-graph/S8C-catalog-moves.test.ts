/**
 * 8C row 10 (start ruling §5): responsibility moves, standby, rename,
 * identity change, split/merge and the G2-03 replay, over W-B's fixed catalog
 * (tests/helpers/S8C-catalog-world.ts). Level 2: the real catalog owner and
 * store; sessions and links come from `sessions/create`/`sessions/link`, and
 * every observation is `sessions/read` or the public catalog read.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CatalogRepairOpV1, ResponsibilityMoveV1 } from '../../src/contracts/note.js';
import { canonicalKey } from '../../src/contracts/fingerprint.js';
import type { SessionRecord, SessionWorkLink } from '../../src/contracts/core/session.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { catalogRevisionModule, openS8CCatalogWorld } from '../helpers/S8C-catalog-world.js';
import { committed, ready } from '../helpers/S1-runtime-scenario-fixture.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));
const catalogMock = vi.hoisted(() => ({ actual: null as null | Record<string, unknown>,
  revision: null as null | Record<string, unknown>,
  /** The A3 read gate: after the caller-scope read returns, before the planner re-reads. */
  scopeReadGate: null as null | (() => Promise<void>),
  /** The A3 receipt gate: after the early `lookupCommit` misses, before the caller-scope read. */
  receiptGate: null as null | (() => Promise<void>),
  /** The A3 commit counter: armed rows count real `records.commit` calls; the wrapper delegates. */
  countCommits: false, commitCalls: 0 }));
vi.mock('../../src/core/work-graph/architecture/catalog-service.js', async importOriginal => {
  const actual = await importOriginal() as Record<string, unknown>;
  catalogMock.actual = actual;
  return { ...actual, createArchitectureCatalogService: (stores: unknown) => {
    if (catalogMock.revision === null) throw new Error('the catalog revision factory is not bound');
    const source = stores as { records: Record<string, unknown> };
    const records = Object.create(source.records) as Record<string, unknown>;
    records['readMany'] = async (...args: unknown[]) => {
      const result = await (source.records['readMany'] as (...call: unknown[]) => Promise<{
        status: string; value?: { records: { schemaId: string }[] } }>)(...args);
      const gate = catalogMock.scopeReadGate;
      if (gate !== null && Array.isArray(args[0]) && args[0].length === 2 && result.status === 'ready'
        && result.value !== undefined
        && result.value.records.some(record => record.schemaId === 'ProjectSnapshot@1')
        && result.value.records.some(record => record.schemaId === 'WorkspaceSnapshot@1')) {
        catalogMock.scopeReadGate = null;
        await gate();
      }
      return result;
    };
    // A3: the same delegating wrapper also gates the early receipt lookup, so a
    // row can run a real peer commit after this call's miss and before its
    // caller-scope read. The gate is cleared before it runs, so the peer's own
    // lookup (or a line-pin commit) bypasses it and the hook fires once.
    records['lookupCommit'] = async (...args: unknown[]) => {
      const result = await (source.records['lookupCommit'] as (...call: unknown[]) => Promise<{
        status: string; code?: string }>).apply(source.records, args);
      const gate = catalogMock.receiptGate;
      if (gate !== null && result.status === 'rejected' && result.code === 'not_found') {
        catalogMock.receiptGate = null;
        await gate();
      }
      return result;
    };
    // A3: delegate to the real store commit and count it; the receipt and its
    // cursor are returned untouched.
    records['commit'] = async (...args: unknown[]) => {
      const result = await (source.records['commit'] as (...call: unknown[]) => Promise<unknown>)
        .apply(source.records, args);
      if (catalogMock.countCommits) catalogMock.commitCalls += 1;
      return result;
    };
    return (catalogMock.revision['createArchitectureCatalogService'] as (bound: unknown) => unknown)(
      { ...source, records });
  } };
});
beforeAll(async () => { catalogMock.revision = await catalogRevisionModule(async () => catalogMock.actual!); });

type World = Awaited<ReturnType<typeof openS8CCatalogWorld>>;
type Line = SessionRecord;
type Card = Awaited<ReturnType<World['readSession']>>;
const worlds: World[] = [];
afterEach(async () => {
  commitBarrier.reset();
  catalogMock.scopeReadGate = null;
  catalogMock.receiptGate = null;
  catalogMock.countCommits = false;
  catalogMock.commitCalls = 0;
  await Promise.all(worlds.splice(0).map(world => world.close()));
});
async function openWorld(): Promise<World> {
  const world = await openS8CCatalogWorld();
  worlds.push(world);
  return world;
}

const dest = (world: World, moduleId: string) => ({ projectId: world.scope.projectId, moduleId });
const to = (world: World, link: SessionWorkLink, ...moduleIds: string[]): ResponsibilityMoveV1 =>
  ({ link: link.ref, to: { kind: 'modules', destinations: moduleIds.map(moduleId => dest(world, moduleId)) } });
const standby = (link: SessionWorkLink): ResponsibilityMoveV1 => ({ link: link.ref, to: { kind: 'standby' } });
const deleteSrc = (extra: CatalogRepairOpV1[] = []): CatalogRepairOpV1[] => [
  ...extra, { op: 'set_parent', moduleId: 'src/a', parentId: 'root' }, { op: 'remove_module', moduleId: 'src' }];
const sourceOf = (card: Card, link: SessionWorkLink) =>
  card.links.find(entry => canonicalKey(entry.ref) === canonicalKey(link.ref));
const openAt = (card: Card, moduleId: string) => card.links.find(entry =>
  entry.ref.relation === 'responsible' && entry.until === null && entry.ref.target.kind === 'module'
  && entry.ref.target.ref.moduleId === moduleId);
const openModuleLinks = (card: Card) => card.links.filter(entry =>
  entry.ref.relation === 'responsible' && entry.until === null && entry.ref.target.kind === 'module');
const moduleIds = async (world: World) => ready(await world.platform.architecture
  .readArchitectureRevision(world.ctx, { selection: { kind: 'current' } })).catalog?.catalog.modules
  .map(module => module.ref.moduleId);

describe('S8C R10 responsibility moves', () => {
  it('three open links on a deleted module move in one commit', async () => {
    const world = await openWorld();
    const before = (await world.pin()).catalogRef.revision;
    const moves = [to(world, world.links.l1, 'src/a'), to(world, world.links.l2, 'src/a'),
      to(world, world.links.l4, 'src/a')];
    catalogMock.countCommits = true;
    const revision = committed(await world.revise({ ops: deleteSrc(), responsibilityMoves: moves, reason: 'move src' }));
    expect(catalogMock.commitCalls).toBe(1);
    expect(revision.baseline.ref.revision).toBe(before + 1);
    expect(await moduleIds(world)).not.toContain('src');
    for (const line of [world.lines.l1, world.lines.l2, world.lines.l4]) {
      const card = await world.readSession(line);
      expect(sourceOf(card, world.links[line === world.lines.l1 ? 'l1' : line === world.lines.l2 ? 'l2' : 'l4']))
        .toMatchObject({ until: expect.anything() });
      expect(openAt(card, 'src/a')).toBeDefined();
    }
  });

  it('reparents the child before removing its old parent, then to another parent', async () => {
    const world = await openWorld();
    const ops: CatalogRepairOpV1[] = [
      { op: 'set_parent', moduleId: 'src/a', parentId: 'root' },
      { op: 'remove_module', moduleId: 'src' },
      { op: 'set_parent', moduleId: 'src/a', parentId: 'docs' },
    ];
    const moves = [to(world, world.links.l1, 'src/a'), to(world, world.links.l2, 'src/a'),
      to(world, world.links.l4, 'src/a')];
    const revision = committed(await world.revise({ ops, responsibilityMoves: moves, reason: 'reparent twice' }));
    expect(revision.catalog.catalog.modules.map(module => module.ref.moduleId))
      .toEqual(['root', 'src/a', 'src/a/x', 'docs']);
    expect(revision.catalog.catalog.containment?.parentOf).toEqual([
      { parent: dest(world, 'docs'), child: dest(world, 'src/a') },
      { parent: dest(world, 'src/a'), child: dest(world, 'src/a/x') },
      { parent: dest(world, 'root'), child: dest(world, 'docs') },
    ]);
    for (const [line, link] of [[world.lines.l1, world.links.l1], [world.lines.l2, world.links.l2],
      [world.lines.l4, world.links.l4]] as const) {
      const card = await world.readSession(line);
      expect(sourceOf(card, link)?.until).not.toBeNull();
      expect(openAt(card, 'src/a')).toBeDefined();
    }
  });

  it('twenty ops with one child delete still fit the twenty-op bound', async () => {
    const world = await openWorld();
    const fillers = Array.from({ length: 19 }, (_, index): CatalogRepairOpV1 =>
      ({ op: 'set_responsibility', moduleId: 'root', text: `w20 responsibility ${String(index)}` }));
    const ops: CatalogRepairOpV1[] = [...fillers, { op: 'remove_module', moduleId: 'src/a/x' }];
    expect(ops).toHaveLength(20);
    const revision = committed(await world.revise({ ops, reason: 'twenty ops' }));
    expect(revision.catalog.catalog.modules.map(module => module.ref.moduleId))
      .toEqual(['root', 'src', 'src/a', 'docs']);
    expect(revision.catalog.catalog.containment?.parentOf).toEqual([
      { parent: dest(world, 'root'), child: dest(world, 'src') },
      { parent: dest(world, 'src'), child: dest(world, 'src/a') },
      { parent: dest(world, 'root'), child: dest(world, 'docs') },
    ]);
  });

  it('one missing destination is refused and nothing moves', async () => {
    const world = await openWorld();
    const before = (await world.pin()).catalogRef.revision;
    const moves = [to(world, world.links.l1, 'src/a'), to(world, world.links.l2, 'src/a')];
    expect(await world.revise({ ops: deleteSrc(), responsibilityMoves: moves, reason: 'miss one' }))
      .toMatchObject({ status: 'rejected', code: 'invalid',
        reason: expect.stringContaining('responsibility_destination_missing') });
    expect((await world.pin()).catalogRef.revision).toBe(before);
    expect((await world.readSession(world.lines.l4)).links.some(link =>
      canonicalKey(link.ref) === canonicalKey(world.links.l4.ref) && link.until === null)).toBe(true);
  });

  it('standby closes the source and opens nothing', async () => {
    const world = await openWorld();
    committed(await world.revise({ ops: deleteSrc(), reason: 'standby',
      responsibilityMoves: [standby(world.links.l1), to(world, world.links.l2, 'src/a'),
        to(world, world.links.l4, 'src/a')] }));
    const card = await world.readSession(world.lines.l1);
    expect(sourceOf(card, world.links.l1)).toMatchObject({ until: expect.anything() });
    expect(openModuleLinks(card)).toEqual([]);
  });

  it('G2-03: replaying the same moves command returns the original revision, a second time', async () => {
    const world = await openWorld();
    const command = await world.reviseCommand({ ops: deleteSrc(), reason: 'replay',
      responsibilityMoves: [to(world, world.links.l1, 'src/a'), to(world, world.links.l2, 'src/a'),
        to(world, world.links.l4, 'src/a')], requestId: 's8c-replay' });
    const first = await world.platform.architecture.reviseArchitectureCatalog(world.ctx, command);
    if (first.status !== 'committed') throw new Error(JSON.stringify(first));
    // A real line-pin commit after the revision raises the Workspace revision;
    // the resend still carries the pins captured before it and must replay.
    await world.pinLine(world.lines.l2);
    expect(await world.platform.architecture.reviseArchitectureCatalog(world.ctx, command))
      .toEqual({ ...first, replayed: true });
    expect((await world.pin()).catalogRef.revision).toBe(first.value.baseline.ref.revision);
    expect(await moduleIds(world)).not.toContain('src');
  });

  it('rename keeps moduleId and the links, needs no move, and keeps the anchor live', async () => {
    const world = await openWorld();
    const noteId = await world.note('src');
    const before = await Promise.all([world.lines.l1, world.lines.l2, world.lines.l4].map(line =>
      world.readSession(line)));
    const renamed = committed(await world.revise({ ops: [{ op: 'set_module_name', moduleId: 'src',
      name: 'source' }], responsibilityMoves: [], reason: 'rename src' }));
    const module = renamed.catalog.catalog.modules.find(entry => entry.ref.moduleId === 'src');
    expect(module?.name).toBe('source');
    expect((await world.readNote(noteId)).anchorStatus).toBe('live');
    for (const [index, line] of [world.lines.l1, world.lines.l2, world.lines.l4].entries()) {
      const after = await world.readSession(line);
      expect(openModuleLinks(after).map(link => canonicalKey(link.ref)))
        .toEqual(openModuleLinks(before[index]!).map(link => canonicalKey(link.ref)));
    }
  });

  it('identity remove+add moves every link and retires the old anchor', async () => {
    const world = await openWorld();
    const noteId = await world.note('src');
    const added = { op: 'add_module' as const, module: { ref: dest(world, 'src2'), name: 'src2',
      responsibility: 'Own src2', paths: ['src'], interfaces: [] } };
    const moves = [to(world, world.links.l1, 'src2'), to(world, world.links.l2, 'src2'),
      to(world, world.links.l4, 'src2')];
    committed(await world.revise({ ops: deleteSrc([added]), responsibilityMoves: moves, reason: 're-identify' }));
    expect(await moduleIds(world)).toContain('src2');
    expect(await moduleIds(world)).not.toContain('src');
    for (const [line, link] of [[world.lines.l1, world.links.l1], [world.lines.l2, world.links.l2],
      [world.lines.l4, world.links.l4]] as const) {
      const card = await world.readSession(line);
      expect(sourceOf(card, link)?.until).not.toBeNull();
      expect(openAt(card, 'src2')).toBeDefined();
    }
    expect(await world.readNote(noteId)).toMatchObject({ anchorStatus: 'retired',
      anchorRetiredReasons: ['module_removed'] });
  });

  it('split: deleting two sourced modules checks every removed module', async () => {
    const world = await openWorld();
    const docsLink = await world.link(world.lines.l2, 'docs');
    const ops = [...deleteSrc(), { op: 'remove_module', moduleId: 'docs' } as const];
    const moves = [to(world, world.links.l1, 'src/a'), to(world, world.links.l2, 'src/a'),
      to(world, world.links.l4, 'src/a')];
    expect(await world.revise({ ops, responsibilityMoves: moves, reason: 'split, docs left behind' }))
      .toMatchObject({ status: 'rejected', code: 'invalid',
        reason: expect.stringContaining('responsibility_destination_missing') });
    expect((await world.readSession(world.lines.l2)).links.find(link =>
      canonicalKey(link.ref) === canonicalKey(docsLink.ref))).toMatchObject({ until: null });
  });

  it('split: complete moves close each removed source and open each destination', async () => {
    const world = await openWorld();
    const docsLink = await world.link(world.lines.l2, 'docs');
    const ops = [...deleteSrc(), { op: 'remove_module', moduleId: 'docs' } as const];
    // Both removed modules have real sources: l1/l2/l4 own
    // `src` and l2 also owns `docs`. The duties split across three survivors,
    // so every removed module is checked, not just `src`.
    const moves = [to(world, world.links.l1, 'src/a'), to(world, world.links.l2, 'src/a/x'),
      to(world, world.links.l4, 'root'), to(world, docsLink, 'src/a')];
    const revision = committed(await world.revise({ ops, responsibilityMoves: moves, reason: 'split src and docs' }));
    expect(revision.catalog.catalog.modules.map(module => module.ref.moduleId))
      .toEqual(['root', 'src/a', 'src/a/x']);
    for (const [line, link, destination] of [
      [world.lines.l1, world.links.l1, 'src/a'],
      [world.lines.l2, world.links.l2, 'src/a/x'],
      [world.lines.l4, world.links.l4, 'root'],
      [world.lines.l2, docsLink, 'src/a'],
    ] as const) {
      const card = await world.readSession(line);
      expect(sourceOf(card, link)?.until).not.toBeNull();
      expect(openAt(card, destination)).toBeDefined();
    }
  });

  it('merge: every duty of two absorbed modules moves to a survivor', async () => {
    const world = await openWorld();
    const docsLink = await world.link(world.lines.l2, 'docs');
    const ops = [...deleteSrc(), { op: 'remove_module', moduleId: 'docs' } as const];
    const moves = [to(world, world.links.l1, 'src/a'), to(world, world.links.l2, 'src/a'),
      to(world, world.links.l4, 'src/a'), to(world, docsLink, 'root')];
    const revision = committed(await world.revise({ ops, responsibilityMoves: moves, reason: 'merge src and docs' }));
    expect(revision.catalog.catalog.modules.map(module => module.ref.moduleId))
      .toEqual(['root', 'src/a', 'src/a/x']);
    for (const [line, link, destination] of [
      [world.lines.l1, world.links.l1, 'src/a'],
      [world.lines.l2, world.links.l2, 'src/a'],
      [world.lines.l4, world.links.l4, 'src/a'],
      [world.lines.l2, docsLink, 'root'],
    ] as const) {
      const card = await world.readSession(line);
      expect(sourceOf(card, link)?.until).not.toBeNull();
      expect(openAt(card, destination)).toBeDefined();
    }
  });
});

describe('S8C revise scope pins', () => {
  it('a scope pin read before a concurrent line-pin change refuses on the stale version', async () => {
    const world = await openWorld();
    const before = await world.pin();
    const registration = ready(await world.platform.projects.readWorkspaceRegistration(world.ctx, world.scope));
    // The A3 wrapper around the real records runs the REAL `lines/pin` owner
    // between the caller-scope read and the planner's own Project/Workspace read.
    catalogMock.scopeReadGate = async () => { await world.pinLine(world.lines.l2); };
    const result = await world.revise({ ops: [{ op: 'set_module_name', moduleId: 'src', name: 'source' }],
      reason: 'a scope pin read before the pin change' });
    expect(result).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(ready(await world.platform.projects.readWorkspaceRegistration(world.ctx, world.scope)).workspace.revision)
      .toBe(registration.workspace.revision + 1);
    expect((await world.pin()).catalogRef.revision).toBe(before.catalogRef.revision);
    expect(await moduleIds(world)).toContain('src');
  });

  it('a concurrent reload of the same command between the receipt miss and the scope read replays it', async () => {
    const world = await openWorld();
    const command = await world.reviseCommand({ ops: [{ op: 'set_module_name', moduleId: 'src', name: 'source' }],
      reason: 'a concurrent reload', requestId: 's8c-concurrent-replay' });
    const before = await world.pin();
    const registration = ready(await world.platform.projects.readWorkspaceRegistration(world.ctx, world.scope));
    let peer: Extract<Awaited<ReturnType<typeof world.platform.architecture.reviseArchitectureCatalog>>,
      { status: 'committed' }> | undefined;
    // This call's first `lookupCommit` misses; the gate then runs the REAL
    // public owner with the same command (same requestId, pin and fingerprint),
    // and the REAL `lines/pin` owner raises the Workspace revision, before the
    // missed result is handed back to this call's own scope read.
    catalogMock.receiptGate = async () => {
      const inner = await world.platform.architecture.reviseArchitectureCatalog(world.ctx, command);
      if (inner.status !== 'committed') throw new Error(`the peer commit failed: ${JSON.stringify(inner)}`);
      peer = inner;
      await world.pinLine(world.lines.l2);
    };
    const result = await world.platform.architecture.reviseArchitectureCatalog(world.ctx, command);
    if (peer === undefined) throw new Error('the receipt gate did not run');
    expect(result).toEqual({ ...peer, replayed: true });
    expect((await world.pin()).catalogRef.revision).toBe(before.catalogRef.revision + 1);
    expect(ready(await world.platform.projects.readWorkspaceRegistration(world.ctx, world.scope)).workspace.revision)
      .toBe(registration.workspace.revision + 1);
  });

  it('without the concurrent reload, a line-pin change still refuses on the stale scope', async () => {
    const world = await openWorld();
    const command = await world.reviseCommand({ ops: [{ op: 'set_module_name', moduleId: 'src', name: 'source' }],
      reason: 'only the scope moves', requestId: 's8c-concurrent-scope-only' });
    const before = await world.pin();
    const registration = ready(await world.platform.projects.readWorkspaceRegistration(world.ctx, world.scope));
    catalogMock.receiptGate = async () => { await world.pinLine(world.lines.l2); };
    const result = await world.platform.architecture.reviseArchitectureCatalog(world.ctx, command);
    expect(result).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect((await world.pin()).catalogRef.revision).toBe(before.catalogRef.revision);
    expect(ready(await world.platform.projects.readWorkspaceRegistration(world.ctx, world.scope)).workspace.revision)
      .toBe(registration.workspace.revision + 1);
  });
});
