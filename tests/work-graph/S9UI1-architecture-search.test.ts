/**
 * UI1 `architecture/find` (acceptance rows 1–7): basename,
 * path and module-name search, normalization, stable paging with a bound cursor,
 * and workspace isolation.
 *
 * The rows start from `S9UI1-fixture.ts`: real Project/Workspace/catalog/observation
 * owners, real files in a temporary root and the frozen route table over HTTP. The
 * expected literals are hand-computed examples, never a production
 * constant or function output.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkspaceScope } from '../../src/contracts/core/identity.js';
import {
  BACKENDS, PROJECT_ID, type Backend, type SearchWorld, openSearchWorld,
} from './S9UI1-fixture.js';

type Group = { ref: { moduleId: string }; name: string; path: string | null; paths: string[] };
type FileHit = { kind: 'file'; nodeRef: { kind: 'file'; path: string }; label: string; path: string;
  paths: string[]; module: Group | null; matchedOn: string[] };
type ModuleHit = { kind: 'module'; nodeRef: { kind: 'module'; ref: { moduleId: string } };
  label: string; path: string | null; paths: string[]; module: Group; matchedOn: string[] };
type FindValue = {
  needle: string; items: (FileHit | ModuleHit)[];
  counts: { files: number; modules: number; total: number };
  nextCursor: string | null;
  sources: {
    fileGraph: { availability: 'available' | 'not_observed'; captureRef: unknown };
    catalog: { availability: 'available' | 'not_adopted'; revision: number | null };
  };
  readThrough: unknown;
};
type FindBody = { status: 'ready'; value: FindValue }
  | { status: 'rejected'; code: string; reason: string };

const PAGE = { afterCursor: null, limit: 10 } as const;

async function find(world: SearchWorld, scope: WorkspaceScope, input: unknown): Promise<FindBody> {
  const answer = await world.post(scope, 'architecture/find', input);
  expect(answer.httpStatus, JSON.stringify(answer.body)).toBe(200);
  return answer.body as FindBody;
}

function findValue(body: FindBody): FindValue {
  expect(body.status).toBe('ready');
  if (body.status !== 'ready') throw new Error(`architecture/find was not ready: ${JSON.stringify(body)}`);
  return body.value;
}

describe.each([...BACKENDS])('S9UI1 architecture/find (%s)', (backend: Backend) => {
  const worlds: SearchWorld[] = [];
  afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });
  async function openSearch(): Promise<SearchWorld> {
    const world = await openSearchWorld(backend);
    worlds.push(world);
    return world;
  }

  it('row 1: finds src/core/a.ts by basename, ASCII-case-insensitively, with both match faces', async () => {
    /* Named mutation: `normalizeSearchText` -> the raw needle (or lowercase only the file side) in
       `architecture-search-index.ts`; red at the item/path assertion below, because `A.TS` finds nothing. */
    const world = await openSearch();
    await world.capture(world.scopeA, ['src/core/a.ts'], 's9ui1-r1');
    const value = findValue(await find(world, world.scopeA, { needle: 'A.TS', page: PAGE }));
    expect(value.needle).toBe('a.ts');
    expect(value.items[0]).toMatchObject({ kind: 'file', path: 'src/core/a.ts', matchedOn: ['basename', 'path'] });
  });

  it('row 2: finds by a path fragment and orders the hits by path bytes', async () => {
    /* Named mutation: drop the full-path face from `matchFiles`; red at `items.length`, because `core/wo` matches no basename. */
    const world = await openSearch();
    await world.capture(world.scopeA, ['src/core/a.ts', 'src/core/work-graph/b.ts'], 's9ui1-r2');
    const value = findValue(await find(world, world.scopeA,
      { needle: 'core/wo', page: { afterCursor: null, limit: 10 } }));
    expect(value.items.map(item => item.kind === 'file' ? item.path : item.kind))
      .toEqual(['src/core/work-graph/b.ts']);
    expect(value.items[0]).toMatchObject({ kind: 'file', path: 'src/core/work-graph/b.ts', matchedOn: ['path'] });
  });

  it('row 3: a module name search returns the module and its file, with module on the file match', async () => {
    /* Named mutation: delete the module-name face from `matchFiles`; red at the file hit's `matchedOn`, which then lacks `module`. */
    const world = await openSearch();
    await world.adopt([{ ref: { projectId: PROJECT_ID, moduleId: 's9ui1-arch' }, name: '架构',
      responsibility: 'the formal group', paths: ['src/core'], interfaces: [] }]);
    await world.capture(world.scopeA, ['src/core/a.ts'], 's9ui1-r3');
    const value = findValue(await find(world, world.scopeA, { needle: '架构', page: PAGE }));
    expect(value.items).toHaveLength(2);
    expect(value.items[0]).toMatchObject({ kind: 'module', label: '架构', path: 'src/core',
      paths: ['src/core'], matchedOn: ['name'] });
    expect(value.items[1]).toMatchObject({ kind: 'file', path: 'src/core/a.ts', matchedOn: ['module'] });
    expect(value.counts).toEqual({ files: 1, modules: 1, total: 2 });
  });

  it('row 4: an empty search is ready with empty items and zero counts, not not_found', async () => {
    /* Named mutation: return `not_found` when the match list is empty; red at `body.status` below. */
    const world = await openSearch();
    await world.capture(world.scopeA, ['src/core/a.ts'], 's9ui1-r4');
    const value = findValue(await find(world, world.scopeA, { needle: 'zzz', page: PAGE }));
    expect(value).toMatchObject({ items: [], counts: { files: 0, modules: 0, total: 0 }, nextCursor: null });
  });

  it('row 5: pages two of three hits while counts stay the full pre-page total', async () => {
    /* Named mutation: `counts` from `pageItems.length`; red at the first page's `counts.total`, which becomes 2. */
    const world = await openSearch();
    await world.capture(world.scopeA, ['src/core/a.ts', 'src/core/ab.ts', 'src/core/abc.ts'], 's9ui1-r5');
    const first = findValue(await find(world, world.scopeA,
      { needle: 'src/core/a', page: { afterCursor: null, limit: 2 } }));
    expect(first.items.map(item => item.kind === 'file' ? item.path : item.kind))
      .toEqual(['src/core/a.ts', 'src/core/ab.ts']);
    expect(first.counts).toEqual({ files: 3, modules: 0, total: 3 });
    expect(typeof first.nextCursor).toBe('string');
    const second = findValue(await find(world, world.scopeA,
      { needle: 'src/core/a', page: { afterCursor: first.nextCursor, limit: 2 } }));
    expect(second.items.map(item => item.kind === 'file' ? item.path : item.kind)).toEqual(['src/core/abc.ts']);
    expect(second.counts).toEqual({ files: 3, modules: 0, total: 3 });
    expect(second.nextCursor).toBeNull();
  });

  it('row 7a: a scope only sees its own workspace observation', async () => {
    /* Named mutation: read the pointer without the ctx workspace (a project-wide current pointer); red when A's
       `src/core/a.ts` appears in B's items. */
    const world = await openSearch();
    await world.capture(world.scopeA, ['src/core/a.ts'], 's9ui1-r7a');
    await world.capture(world.scopeB, ['src/core/b.ts'], 's9ui1-r7b');
    const value = findValue(await find(world, world.scopeB, { needle: 'ts', page: PAGE }));
    expect(value.items.map(item => item.kind === 'file' ? item.path : item.kind)).toEqual(['src/core/b.ts']);
    expect(value.items.some(item => item.kind === 'file' && item.path === 'src/core/a.ts')).toBe(false);
    expect(value.sources.fileGraph.availability).toBe('available');
  });

  describe('rejects: architecture/find', () => {
    it('row 6: a cursor from another query is invalid and the original page is unchanged', async () => {
      /* Named mutation: remove the `queryKey` comparison in the cursor decoder; red at the rejection below,
         because the other query then returns a page instead of `invalid`. */
      const world = await openSearch();
      await world.capture(world.scopeA, ['src/core/a.ts', 'src/core/ab.ts', 'src/core/abc.ts'], 's9ui1-r6');
      const first = findValue(await find(world, world.scopeA,
        { needle: 'src/core/a', page: { afterCursor: null, limit: 1 } }));
      expect(typeof first.nextCursor).toBe('string');
      const reused = await find(world, world.scopeA,
        { needle: 'src/core/ab', page: { afterCursor: first.nextCursor, limit: 1 } });
      expect(reused).toMatchObject({ status: 'rejected', code: 'invalid' });
      if (reused.status !== 'rejected') throw new Error('the other-query cursor was accepted');
      expect(reused.reason).toContain('another capture, catalog revision or query');
      const unchanged = findValue(await find(world, world.scopeA,
        { needle: 'src/core/a', page: { afterCursor: first.nextCursor, limit: 1 } }));
      expect(unchanged.items.map(item => item.kind === 'file' ? item.path : item.kind)).toEqual(['src/core/ab.ts']);
    });

    it('row 7b: a trusted context of workspace A with scope B is forbidden and A still reads', async () => {
      /* Named mutation: remove the dispatch ctx/scope comparison (`core-routes.ts`); red at the `forbidden`
         assertion below, because the request reaches the owner with B's scope instead of being rejected. */
      const world = await openSearch();
      await world.capture(world.scopeA, ['src/core/a.ts'], 's9ui1-r7c');
      let answer: unknown;
      try {
        answer = await world.dispatch(world.ctx(world.scopeA), world.scopeB, 'architecture/find',
          { needle: 'ts', page: PAGE });
      } catch (error) {
        answer = (error as { rejection?: unknown }).rejection ?? error;
      }
      expect(answer).toMatchObject({ status: 'rejected', code: 'forbidden',
        reason: 'the resolved call context does not match the request scope' });
      const unchanged = findValue(await find(world, world.scopeA, { needle: 'ts', page: PAGE }));
      expect(unchanged.items.map(item => item.kind === 'file' ? item.path : item.kind)).toEqual(['src/core/a.ts']);
    });
  });

  it('supplement: no adopted catalog reports not_adopted and gives the file no module', async () => {
    /* Named mutation: synthesize an empty catalog instead of `not_adopted`; red at the sources assertion. */
    const world = await openSearch();
    await world.capture(world.scopeA, ['src/core/a.ts'], 's9ui1-known');
    const value = findValue(await find(world, world.scopeA, { needle: 'a.ts', page: PAGE }));
    expect(value.sources.catalog).toEqual({ availability: 'not_adopted', revision: null });
    expect(value.items[0]).toMatchObject({ kind: 'file', path: 'src/core/a.ts', module: null });
  });

  it('supplement: no observation reports not_observed and still searches the catalog modules', async () => {
    /* Named mutation: turn a missing observation pointer into an error (or empty modules); red at `fileGraph`
       or at the module hit. */
    const world = await openSearch();
    await world.adopt([{ ref: { projectId: PROJECT_ID, moduleId: 's9ui1-arch' }, name: '架构',
      responsibility: 'the formal group', paths: ['src/core'], interfaces: [] }]);
    const value = findValue(await find(world, world.scopeA, { needle: '架构', page: PAGE }));
    expect(value.sources.fileGraph).toMatchObject({ availability: 'not_observed', captureRef: null });
    expect(value.items).toHaveLength(1);
    expect(value.items[0]).toMatchObject({ kind: 'module', label: '架构' });
  });
});
