import { afterEach, expect, it, vi } from 'vitest';
import type { WorkspaceRef } from '../../src/contracts/ledger.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SourceCaptureRef } from '../../src/contracts/core/source.js';
import type { WorkspaceAccessFactory } from '../../src/core/workspace/access.js';
import type { CaptureSummary, SourcePage, SourceQuery, WorkspaceResult } from '../../src/core/workspace/ports.js';
import { createWorkspaceTools, DEFAULT_WORKSPACE_LIMITS } from '../../src/core/workspace/workspace-tools.js';
import { TypeScriptSourceAnalyzer } from '../../src/core/workspace/typescript-source-query.js';

type Limits = Parameters<typeof createWorkspaceTools>[0]['limits'];
const handles: ReturnType<typeof createWorkspaceTools>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const handle of handles.splice(0)) await handle.close();
});

function ready<T>(result: WorkspaceResult<T>): T {
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw Error(`${result.code}: ${result.reason}`);
  return result.value;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}

/** A trusted test adapter with explicit grants. Production Host policy is tested separately. */
function fixture(importCount = 4, limits: Partial<Limits> = {}) {
  const workspace: WorkspaceRef = { aggregateType: 'Workspace', projectId: 'project-one', workspaceId: 'workspace-one' };
  const files = new Map([
    ['tsconfig.json', '{"compilerOptions":{"module":"esnext","moduleResolution":"bundler"},"include":["src/**/*.ts"]}'],
    ['src/base.ts', 'export function chosen() { return 1; }\n'],
  ]);
  for (let n = 0; n < importCount; n++) files.set(`src/units/unit${String(n).padStart(3, '0')}.ts`, 'import { chosen } from "../base";\nchosen();\n');
  const grants = new Set(['human:alice', 'human:bob']);
  const denied = new Set<string>();
  const state = {
    permissionRevision: 'policy-1', root: '/trusted/workspace-one', workspaceRevision: 1,
    commit: 'a'.repeat(40), time: Date.parse('2026-09-23T00:00:00.000Z'),
    beforeOpen: undefined as undefined | ((number: number) => void | Promise<void>),
    beforeRead: undefined as undefined | ((path: string, signal: AbortSignal) => void | Promise<void>),
    beforeRelease: undefined as undefined | (() => void | Promise<void>),
  };
  const count = { opens: 0, authorizations: 0, inventories: 0, identities: 0, reads: 0, bytes: 0, releases: 0 };
  const access: WorkspaceAccessFactory = {
    async open(ctx, requested) {
      count.opens++;
      await state.beforeOpen?.(count.opens);
      if (ctx.signal.aborted) return { status: 'rejected', code: 'cancelled', reason: 'request cancelled' };
      count.authorizations++;
      const principal = ctx.principal;
      const reader = ctx.materialReader;
      if (requested.projectId !== workspace.projectId || requested.workspaceId !== workspace.workspaceId ||
          ctx.projectId !== workspace.projectId || ctx.workspaceId !== workspace.workspaceId ||
          principal.kind !== 'host' || reader.kind !== 'host' || reader.projectId !== workspace.projectId ||
          reader.workspaceId !== workspace.workspaceId || reader.actor.kind !== principal.actor.kind ||
          reader.actor.id !== principal.actor.id || !grants.has(`${principal.actor.kind}:${principal.actor.id}`)) {
        return { status: 'rejected', code: 'forbidden', reason: 'no matching test grant' };
      }
      const root = state.root;
      const restricted = new Set(denied);
      let released = false;
      const live = () => { if (released) throw Error('released access used'); ctx.signal.throwIfAborted(); };
      return {
        status: 'ready',
        value: {
          workspace, workspaceRevision: state.workspaceRevision, workspaceIdentity: root,
          authorization: {
            subjectKey: `${principal.actor.kind}:${principal.actor.id}`, permissionRevision: state.permissionRevision,
            allowsRead: path => !restricted.has(path),
          },
          async listFiles(limit) {
            live(); count.inventories++;
            return { paths: [...files.keys()].slice(0, limit), truncated: files.size > limit };
          },
          async read(path, maxBytes) {
            live(); count.reads++;
            await state.beforeRead?.(path, ctx.signal);
            live();
            const content = files.get(path);
            if (content === undefined || restricted.has(path)) throw Error('source unavailable');
            if (Buffer.byteLength(content) > maxBytes) throw Error('file capacity exceeded');
            count.bytes += Buffer.byteLength(content);
            return { content, revision: `memory:${content}`, byteLength: Buffer.byteLength(content) };
          },
          async sourceIdentity() { live(); count.identities++; return { workspace: root, commit: state.commit }; },
          async release() { if (!released) { released = true; count.releases++; await state.beforeRelease?.(); } },
        },
      };
    },
  };
  const makeHandle = () => {
    const handle = createWorkspaceTools({ access, now: () => new Date(state.time).toISOString(), limits: { ...DEFAULT_WORKSPACE_LIMITS, ...limits } });
    handles.push(handle);
    return handle;
  };
  const handle = makeHandle();
  const context = (id = 'alice', signal = new AbortController().signal): CoreCallContext => ({
    projectId: workspace.projectId, workspaceId: workspace.workspaceId,
    principal: { kind: 'host', actor: { kind: 'human', id } },
    materialReader: { kind: 'host', projectId: workspace.projectId, workspaceId: workspace.workspaceId, actor: { kind: 'human', id } },
    signal,
  });
  const request = () => ({ workspace, workspaceRevision: state.workspaceRevision, provider: 'typescript' as const });
  const capture = async (ctx = context(), extra: { previous?: SourceCaptureRef } = {}): Promise<CaptureSummary> =>
    ready(await handle.tools.captureSourceChanges(ctx, { ...request(), ...extra }));
  const page = async (ref: SourceCaptureRef, cursor: string | null = null, limit = 200, ctx = context()): Promise<SourcePage> =>
    ready(await handle.tools.querySource(ctx, { capture: ref, query: { kind: 'imports' }, cursor, limit }));
  const sourceWork = () => ({ inventories: count.inventories, identities: count.identities, reads: count.reads, bytes: count.bytes });
  const mappings = [
    { id: 'base', kind: 'module' as const, paths: ['src/base.ts'] },
    { id: 'units', kind: 'module' as const, paths: ['src/units'] },
  ];
  return { ...handle, workspace, files, grants, denied, state, count, context, request, capture, page, sourceWork, mappings, makeHandle };
}

it('captures 401 imports with two source observations and serves all pages, export and graph without another read', async () => {
  const f = fixture(401);
  const analyses = vi.spyOn(TypeScriptSourceAnalyzer.prototype, 'analyze');
  const captured = await f.capture();
  expect(f.count.inventories).toBe(2);
  expect(f.count.identities).toBe(2);
  expect(f.count.reads).toBe(2 * f.files.size);
  expect(captured.coverage).toMatchObject({ provider: 'typescript', indexedSourceCount: 402, complete: true, filesystemAtomic: false, fullRuntimeCallGraph: false });
  const work = f.sourceWork();
  const first = await f.page(captured.ref);
  const second = await f.page(captured.ref, first.nextCursor);
  const third = await f.page(captured.ref, second.nextCursor);
  expect([first.items.length, second.items.length, third.items.length]).toEqual([200, 200, 1]);
  expect(first.nextCursor).not.toBeNull();
  expect(second.nextCursor).not.toBeNull();
  expect(third).toMatchObject({ nextCursor: null, complete: true, observation: 'captured_source', currentness: 'not_rechecked' });
  const material = ready(await f.tools.exportCapture(f.context(), captured.ref));
  expect(material.relations).toHaveLength(401);
  expect(material.files.some(file => file.path === 'src/units/unit400.ts')).toBe(true);
  expect([...first.items, ...second.items, ...third.items].map(hit => hit.kind === 'relation' ? hit.relation : null)).toEqual(material.relations);
  const graph = ready(await f.tools.captureArchitectureSource(f.context(), { capture: captured.ref, mappings: f.mappings }));
  expect(graph.edges).toEqual([expect.objectContaining({ fromNode: 'module:units', toNode: 'module:base' })]);
  expect(graph.sourceDigest).toBe(captured.ref.sourceDigest);
  expect(f.sourceWork()).toEqual(work);
  expect(analyses.mock.calls.filter(([, query]) => query.operation === 'imports')).toHaveLength(1);
  expect(f.count.authorizations).toBeGreaterThanOrEqual(7);
  expect(f.count.releases).toBe(f.count.opens);
});

it('requires an explicit trusted grant before any source enumeration, including for a system actor', async () => {
  const f = fixture();
  expect(await f.tools.captureSourceChanges(f.context('ungranted'), f.request())).toMatchObject({ status: 'rejected', code: 'forbidden' });
  const system = f.context('alice');
  system.principal = { kind: 'host', actor: { kind: 'system', id: 'alice' } };
  system.materialReader = { kind: 'host', projectId: f.workspace.projectId, workspaceId: f.workspace.workspaceId, actor: { kind: 'system', id: 'alice' } };
  expect(await f.tools.captureSourceChanges(system, f.request())).toMatchObject({ status: 'rejected', code: 'forbidden' });
  expect(f.sourceWork()).toEqual({ inventories: 0, identities: 0, reads: 0, bytes: 0 });
});

it('continues frozen history after an edit while explicit verification rejects currentness and a new capture uses the named previous baseline', async () => {
  const f = fixture();
  const original = await f.capture();
  const oldPage = await f.page(original.ref);
  const work = f.sourceWork();
  f.files.set('src/units/unit000.ts', 'export const replaced = true;\n');
  expect(await f.page(original.ref)).toEqual(oldPage);
  expect(f.sourceWork()).toEqual(work);
  expect(await f.tools.verifyCapture(f.context(), original.ref)).toMatchObject({ status: 'rejected', code: 'source_stale' });
  const newer = await f.capture(f.context(), { previous: original.ref });
  expect(newer.ref.sourceDigest).not.toBe(original.ref.sourceDigest);
  expect(newer.changes).toEqual({ added: [], modified: ['src/units/unit000.ts'], deleted: [] });
  expect((await f.page(newer.ref)).items).toHaveLength(3);
  expect(await f.page(original.ref)).toEqual(oldPage);
});

it('does not publish a capture when the final fresh access observes changed content, root, authorization or workspace revision', async () => {
  for (const changed of ['content', 'root', 'authorization', 'revision'] as const) {
    const f = fixture(1, { maxRetainedCaptures: 1 });
    f.state.beforeOpen = number => {
      if (number !== 2) return;
      if (changed === 'content') f.files.set('src/base.ts', 'export const chosen = 2;');
      if (changed === 'root') f.state.root = '/trusted/rebound';
      if (changed === 'authorization') f.state.permissionRevision = 'policy-2';
      if (changed === 'revision') f.state.workspaceRevision = 2;
    };
    expect((await f.tools.captureSourceChanges(f.context(), f.request())).status).toBe('rejected');
    f.state.beforeOpen = undefined;
    expect((await f.tools.captureSourceChanges(f.context(), f.request())).status).toBe('ready');
    expect(f.count.releases).toBe(f.count.opens);
  }
});

it('rejects the entire frozen material after permission or root rebinding, including graph and export paths', async () => {
  for (const changed of ['permission', 'root'] as const) {
    const f = fixture();
    const captured = await f.capture();
    const work = f.sourceWork();
    if (changed === 'permission') { f.denied.add('src/base.ts'); f.state.permissionRevision = 'policy-2'; }
    else f.state.root = '/trusted/other-root';
    expect(await f.tools.querySource(f.context(), { capture: captured.ref, query: { kind: 'imports' }, cursor: null, limit: 2 })).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await f.tools.exportCapture(f.context(), captured.ref)).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await f.tools.captureArchitectureSource(f.context(), { capture: captured.ref, mappings: f.mappings })).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(f.sourceWork()).toEqual(work);
  }
});

it('replays cursors without consuming them and changes page size without changing the frozen order', async () => {
  const f = fixture(9);
  const captured = await f.capture();
  const whole = await f.page(captured.ref, null, 20);
  const first = await f.page(captured.ref, null, 2);
  const cursor = first.nextCursor;
  expect(cursor).not.toBeNull();
  const next = await f.page(captured.ref, cursor, 2);
  expect(await f.page(captured.ref, cursor, 2)).toEqual(next);
  const larger = await f.page(captured.ref, cursor, 4);
  expect(larger.items).toEqual(whole.items.slice(2, 6));
  const tail = await f.page(captured.ref, cursor, 20);
  expect(tail.items).toEqual(whole.items.slice(2));
  expect(tail).toMatchObject({ complete: true, nextCursor: null });
  expect(await f.tools.querySource(f.context(), { capture: captured.ref, query: { kind: 'imports' }, cursor, limit: 0 })).toMatchObject({ status: 'rejected', code: 'invalid' });
  expect(await f.page(captured.ref, cursor, 2)).toEqual(next);
});

it('binds the full capture reference and cursor to the capture, query and trusted subject', async () => {
  const f = fixture();
  const first = await f.capture();
  const second = await f.capture();
  const cursor = (await f.page(first.ref, null, 1)).nextCursor;
  expect(cursor).not.toBeNull();
  expect(await f.tools.querySource(f.context(), { capture: second.ref, query: { kind: 'imports' }, cursor, limit: 1 })).toMatchObject({ status: 'rejected', code: 'cursor_mismatch' });
  expect(await f.tools.querySource(f.context(), { capture: first.ref, query: { kind: 'symbols' }, cursor, limit: 1 })).toMatchObject({ status: 'rejected', code: 'cursor_mismatch' });
  expect(await f.tools.querySource(f.context('bob'), { capture: first.ref, query: { kind: 'imports' }, cursor, limit: 1 })).toMatchObject({ status: 'rejected', code: 'forbidden' });
  const altered: SourceCaptureRef[] = [
    { ...first.ref, sourceDigest: '0'.repeat(64) }, { ...first.ref, configDigest: '0'.repeat(64) },
    { ...first.ref, indexVersion: 'forged-engine' }, { ...first.ref, workspaceRevision: 99 },
    { ...first.ref, projectId: 'other-project' }, { ...first.ref, workspaceId: 'other-workspace' },
  ];
  for (const ref of altered) expect((await f.tools.exportCapture(f.context(), ref)).status).toBe('rejected');
  expect((await f.page(first.ref, cursor, 1)).items).toHaveLength(1);
});

it('renews idle expiry on successful use but not on another subject being rejected', async () => {
  const f = fixture(2, { idleExpiryMs: 1000 });
  const captured = await f.capture();
  const createdAt = f.state.time;
  expect(Date.parse(captured.expiresAt)).toBe(createdAt + 1000);
  f.state.time = createdAt + 900;
  await f.page(captured.ref);
  f.state.time = createdAt + 1100;
  await f.page(captured.ref);
  f.state.time = createdAt + 1900;
  expect(await f.tools.exportCapture(f.context('bob'), captured.ref)).toMatchObject({ status: 'rejected', code: 'forbidden' });
  f.state.time = createdAt + 2101;
  expect(await f.tools.exportCapture(f.context(), captured.ref)).toMatchObject({ status: 'rejected', code: 'capture_expired' });
});

it('enforces retained count, permits authorized release replay and treats a restarted registry as expired', async () => {
  const f = fixture(1, { maxRetainedCaptures: 1 });
  const captured = await f.capture();
  expect(await f.tools.captureSourceChanges(f.context(), f.request())).toMatchObject({ status: 'rejected', code: 'capacity' });
  expect(await f.tools.releaseCapture(f.context('bob'), captured.ref)).toMatchObject({ status: 'rejected', code: 'forbidden' });
  expect(ready(await f.tools.releaseCapture(f.context(), captured.ref))).toEqual({ released: true });
  expect(ready(await f.tools.releaseCapture(f.context(), captured.ref))).toEqual({ released: false });
  expect(await f.tools.exportCapture(f.context(), captured.ref)).toMatchObject({ status: 'rejected', code: 'capture_expired' });
  await f.capture();
  expect(await f.makeHandle().tools.exportCapture(f.context(), captured.ref)).toMatchObject({ status: 'rejected', code: 'capture_expired' });
});

it('keeps an already active reader alive across release and rejects new reads afterwards', async () => {
  const f = fixture();
  const captured = await f.capture();
  const entered = deferred(), resume = deferred();
  const blockedOpen = f.count.opens + 1;
  f.state.beforeOpen = async number => {
    if (number === blockedOpen) { entered.resolve(); await resume.promise; }
  };
  const pending = f.tools.exportCapture(f.context(), captured.ref);
  await entered.promise;
  try {
    expect(ready(await f.tools.releaseCapture(f.context(), captured.ref))).toEqual({ released: true });
    expect(await f.tools.exportCapture(f.context(), captured.ref)).toMatchObject({ status: 'rejected', code: 'capture_expired' });
  } finally { resume.resolve(); }
  expect((await pending).status).toBe('ready');
});

it('rejects retained-byte, complete-query, query-cache and cursor capacity overflow without a truncated success', async () => {
  const bytes = fixture(1, { maxRetainedBytes: 32 });
  expect(await bytes.tools.captureSourceChanges(bytes.context(), bytes.request())).toMatchObject({ status: 'rejected', code: 'capacity' });
  const results = fixture(1, { maxQueryResults: 3 });
  results.files.set('src/many.ts', Array.from({ length: 10 }, (_, n) => `export const value${n} = ${n};`).join('\n'));
  const resultCapture = await results.capture();
  expect(await results.tools.querySource(results.context(), { capture: resultCapture.ref, query: { kind: 'symbols', path: 'src/many.ts' }, cursor: null, limit: 3 })).toMatchObject({ status: 'rejected', code: 'capacity' });
  const queries = fixture(1, { maxQueriesPerCapture: 1 });
  const queryCapture = await queries.capture();
  await queries.page(queryCapture.ref);
  expect(await queries.tools.querySource(queries.context(), { capture: queryCapture.ref, query: { kind: 'symbols' }, cursor: null, limit: 20 })).toMatchObject({ status: 'rejected', code: 'capacity' });
  expect((await queries.page(queryCapture.ref)).items).toHaveLength(1);
  const cursors = fixture(7, { maxCursorsPerCapture: 1 });
  const captured = await cursors.capture();
  const first = await cursors.page(captured.ref, null, 2);
  expect(await cursors.page(captured.ref, null, 2)).toEqual(first);
  expect(await cursors.tools.querySource(cursors.context(), { capture: captured.ref, query: { kind: 'imports' }, cursor: first.nextCursor, limit: 2 })).toMatchObject({ status: 'rejected', code: 'capacity' });
  expect((await cursors.page(captured.ref, first.nextCursor, 20)).items).toHaveLength(5);
});

it('uses each request signal independently and frees a cancelled unpublished capture slot', async () => {
  const f = fixture(1, { maxRetainedCaptures: 2 });
  const original = new AbortController();
  const captured = await f.capture(f.context('alice', original.signal));
  original.abort();
  await f.page(captured.ref);
  expect(await f.tools.exportCapture(f.context('alice', original.signal), captured.ref)).toMatchObject({ status: 'rejected', code: 'cancelled' });

  const abort = new AbortController(), entered = deferred(), resume = deferred();
  let held = false;
  f.state.beforeRead = async () => { if (!held) { held = true; entered.resolve(); await resume.promise; } };
  const pending = f.tools.captureSourceChanges(f.context('alice', abort.signal), f.request());
  await entered.promise;
  try {
    abort.abort();
    await f.page(captured.ref);
  } finally { resume.resolve(); }
  expect(await pending).toMatchObject({ status: 'rejected', code: 'cancelled' });
  f.state.beforeRead = undefined;
  await f.capture();
});

it('closes by cancelling pending capture work and refuses new operations', async () => {
  const f = fixture(1);
  const entered = deferred(), resume = deferred();
  let held = false;
  f.state.beforeRead = async () => { if (!held) { held = true; entered.resolve(); await resume.promise; } };
  const pending = f.tools.captureSourceChanges(f.context(), f.request());
  await entered.promise;
  const closing = f.close();
  resume.resolve();
  expect(await pending).toMatchObject({ status: 'rejected', code: 'cancelled' });
  await closing;
  expect((await f.tools.captureSourceChanges(f.context(), f.request())).status).toBe('rejected');
  expect(f.count.releases).toBe(f.count.opens);
});


it('does not let returned DTO mutation rewrite retained references, manifests, relations or cached pages', async () => {
  const f = fixture(3);
  const summary = await f.capture();
  const ref = structuredClone(summary.ref);
  const original = structuredClone(ready(await f.tools.exportCapture(f.context(), ref)));
  const firstPage = await f.page(ref);
  const expectedPage = structuredClone(firstPage);
  // Both defensive copies and deeply frozen public values satisfy the contract.
  const tryMutation = (change: () => void) => { try { change(); } catch (error) { if (!(error instanceof TypeError)) throw error; } };
  tryMutation(() => { summary.ref.sourceDigest = 'forged'; });
  tryMutation(() => { summary.coverage.indexedSourceCount = 0; });
  tryMutation(() => { summary.changes.added.length = 0; });
  const material = ready(await f.tools.exportCapture(f.context(), ref));
  tryMutation(() => { material.files[0]!.digest = 'forged'; });
  tryMutation(() => { material.relations[0]!.targets.length = 0; });
  tryMutation(() => { material.relations.length = 0; });
  const hit = firstPage.items[0];
  if (hit?.kind === 'relation') tryMutation(() => { hit.relation.from.path = 'forged.ts'; });
  tryMutation(() => { firstPage.items.length = 0; });
  expect(ready(await f.tools.exportCapture(f.context(), ref))).toEqual(original);
  expect(await f.page(ref)).toEqual(expectedPage);
});

it('enforces retained capture capacity when two captures start before either publishes', async () => {
  const f = fixture(2, { maxRetainedCaptures: 1 });
  const entered = deferred(), resume = deferred();
  let blocked = false;
  f.state.beforeOpen = async () => {
    if (!blocked) { blocked = true; entered.resolve(); await resume.promise; }
  };
  const first = f.tools.captureSourceChanges(f.context(), f.request());
  await entered.promise;
  let second: Awaited<typeof first>;
  try { second = await f.tools.captureSourceChanges(f.context(), f.request()); }
  finally { resume.resolve(); }
  const completed = await Promise.all([first, second!]);
  expect(completed.filter(result => result.status === 'ready')).toHaveLength(1);
  expect(completed.filter(result => result.status === 'rejected' && result.code === 'capacity')).toHaveLength(1);
  expect(f.count.releases).toBe(f.count.opens);
});

it('analyzes a symbols query only once across paging and replay of the frozen capture', async () => {
  const f = fixture(6);
  const ref = (await f.capture()).ref;
  const analyses = vi.spyOn(TypeScriptSourceAnalyzer.prototype, 'analyze');
  const input = { capture: ref, query: { kind: 'symbols' as const }, cursor: null, limit: 2 };
  const first = ready(await f.tools.querySource(f.context(), input));
  expect(first.nextCursor).not.toBeNull();
  ready(await f.tools.querySource(f.context(), { ...input, cursor: first.nextCursor }));
  expect(ready(await f.tools.querySource(f.context(), input))).toEqual(first);
  expect(analyses.mock.calls.filter(([, query]) => query.operation === 'symbols')).toHaveLength(1);
});

it('retains complete configured relations when capture has a prefix and filters only explicitly scoped queries', async () => {
  const f = fixture(2);
  f.files.set('src/helper.ts', 'export const helper = 1;\n');
  f.files.set('src/base.ts', 'import { helper } from "./helper";\nexport function chosen() { return helper; }\n');
  const summary = ready(await f.tools.captureSourceChanges(f.context(), { ...f.request(), prefix: 'src/units' }));
  const work = f.sourceWork();
  const material = ready(await f.tools.exportCapture(f.context(), summary.ref));
  expect(material.relations).toHaveLength(3);
  expect(material.relations).toEqual(expect.arrayContaining([
    expect.objectContaining({ from: expect.objectContaining({ path: 'src/base.ts' }), targets: [expect.objectContaining({ path: 'src/helper.ts' })] }),
  ]));
  expect((await f.page(summary.ref)).items).toHaveLength(3);
  const scoped = ready(await f.tools.querySource(f.context(), { capture: summary.ref, query: { kind: 'imports', prefix: 'src/units' }, cursor: null, limit: 200 }));
  expect(scoped.items).toHaveLength(2);
  expect(scoped.items.every(hit => hit.kind === 'relation' && hit.relation.from.path.startsWith('src/units/'))).toBe(true);
  const graph = ready(await f.tools.captureArchitectureSource(f.context(), {
    capture: summary.ref, mappings: [...f.mappings, { id: 'helper', kind: 'module', paths: ['src/helper.ts'] }],
  }));
  expect(graph.edges).toEqual(expect.arrayContaining([
    expect.objectContaining({ fromNode: 'module:units', toNode: 'module:base' }),
    expect.objectContaining({ fromNode: 'module:base', toNode: 'module:helper' }),
  ]));
  expect(graph.edges).toHaveLength(2);
  expect(f.sourceWork()).toEqual(work);
});

it('rejects malformed query paths and coordinates instead of treating them as an empty matching scope', async () => {
  const f = fixture(1);
  const captured = await f.capture();
  const invalid: SourceQuery[] = [
    { kind: 'imports', path: '../x' },
    { kind: 'imports', prefix: 'src//units' },
    { kind: 'calls', path: '/workspace/src/base.ts' },
    { kind: 'symbols', path: 'src\\base.ts' },
    { kind: 'definitions', path: 'src/base.ts', line: 0, column: 1 },
    { kind: 'references', path: 'src/base.ts', line: 1, column: 0 },
    { kind: 'definitions', path: 'src/base.ts', line: 1.5, column: 1 },
    { kind: 'references', path: 'src/base.ts', line: 999, column: 1 },
  ];
  for (const query of invalid) {
    expect(await f.tools.querySource(f.context(), { capture: captured.ref, query, cursor: null, limit: 20 }), JSON.stringify(query))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
  }
  expect((await f.page(captured.ref)).items).toHaveLength(1);
});

it('charges newly retained query results and cursor metadata against the remaining byte capacity', async () => {
  const query: SourceQuery = { kind: 'symbols', path: 'src/many.ts' };
  const sample = (bytes: number) => {
    const f = fixture(0, { maxRetainedBytes: bytes });
    f.files.set('src/many.ts', Array.from({ length: 64 }, (_, n) => `export const value${n} = ${n};`).join('\n'));
    return f;
  };
  // Determine the public capacity boundary, not an implementation-specific per-entry charge.
  const fits = async (bytes: number, includeQuery: boolean): Promise<boolean> => {
    const f = sample(bytes);
    try {
      const capture = await f.tools.captureSourceChanges(f.context(), f.request());
      if (capture.status === 'rejected') { expect(capture.code).toBe('capacity'); return false; }
      if (!includeQuery) return true;
      const page = await f.tools.querySource(f.context(), { capture: capture.value.ref, query, cursor: null, limit: 200 });
      if (page.status === 'rejected') { expect(page.code).toBe('capacity'); return false; }
      expect(page.value.items).toHaveLength(64);
      expect(page.value.nextCursor).toBeNull();
      return true;
    } finally { await f.close(); }
  };
  const smallestCapacity = async (includeQuery: boolean) => {
    let low = 1, high = DEFAULT_WORKSPACE_LIMITS.maxRetainedBytes;
    expect(await fits(high, includeQuery)).toBe(true);
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (await fits(middle, includeQuery)) high = middle;
      else low = middle + 1;
    }
    return low;
  };

  const captureLimit = await smallestCapacity(false);
  const captureOnly = sample(captureLimit);
  const captured = await captureOnly.capture();
  // Even a one-item output page requires the complete bounded result to be retained.
  expect(await captureOnly.tools.querySource(captureOnly.context(), { capture: captured.ref, query, cursor: null, limit: 1 }))
    .toMatchObject({ status: 'rejected', code: 'capacity' });
  expect((await captureOnly.tools.exportCapture(captureOnly.context(), captured.ref)).status).toBe('ready');

  const queryLimit = await smallestCapacity(true);
  expect(queryLimit).toBeGreaterThan(captureLimit);
  const cached = sample(queryLimit);
  const queryCapture = await cached.capture();
  const full = ready(await cached.tools.querySource(cached.context(), { capture: queryCapture.ref, query, cursor: null, limit: 200 }));
  expect(full.items).toHaveLength(64);
  // The result is already cached; this request only needs a new cursor for its next page.
  expect(await cached.tools.querySource(cached.context(), { capture: queryCapture.ref, query, cursor: null, limit: 1 }))
    .toMatchObject({ status: 'rejected', code: 'capacity' });
  expect(ready(await cached.tools.querySource(cached.context(), { capture: queryCapture.ref, query, cursor: null, limit: 200 }))).toEqual(full);
}, 20_000);

it('rejects a previous capture from another workspace even when both scopes have the same root and authorization', async () => {
  const first: WorkspaceRef = { aggregateType: 'Workspace', projectId: 'same-project', workspaceId: 'workspace-a' };
  const second: WorkspaceRef = { ...first, workspaceId: 'workspace-b' };
  const registered = new Map([[first.workspaceId, first], [second.workspaceId, second]]);
  const grants = new Map([[first.workspaceId, new Set(['human:alice'])], [second.workspaceId, new Set(['human:alice'])]]);
  const files = new Map([['tsconfig.json', '{"files":["src/value.ts"]}'], ['src/value.ts', 'export const value = 1;\n']]);
  const context = (workspace: WorkspaceRef): CoreCallContext => ({
    projectId: workspace.projectId, workspaceId: workspace.workspaceId,
    principal: { kind: 'host', actor: { kind: 'human', id: 'alice' } },
    materialReader: { kind: 'host', projectId: workspace.projectId, workspaceId: workspace.workspaceId, actor: { kind: 'human', id: 'alice' } },
    signal: new AbortController().signal,
  });
  const access: WorkspaceAccessFactory = {
    async open(ctx, workspace) {
      const record = registered.get(workspace.workspaceId);
      const principal = ctx.principal, reader = ctx.materialReader;
      if (!record || workspace.aggregateType !== 'Workspace' || record.projectId !== workspace.projectId ||
          ctx.projectId !== record.projectId || ctx.workspaceId !== record.workspaceId ||
          principal.kind !== 'host' || reader.kind !== 'host' || reader.projectId !== record.projectId ||
          reader.workspaceId !== record.workspaceId || reader.actor.kind !== principal.actor.kind ||
          reader.actor.id !== principal.actor.id || !grants.get(record.workspaceId)?.has(`${principal.actor.kind}:${principal.actor.id}`)) {
        return { status: 'rejected', code: 'forbidden', reason: 'no matching scope grant' };
      }
      return { status: 'ready', value: {
        workspace: record, workspaceRevision: 1, workspaceIdentity: '/trusted/shared-root',
        authorization: { subjectKey: 'human:alice', permissionRevision: 'shared-policy-1', allowsRead: () => true },
        async listFiles(limit) { return { paths: [...files.keys()].slice(0, limit), truncated: files.size > limit }; },
        async read(path, maxBytes) {
          const content = files.get(path);
          if (content === undefined || Buffer.byteLength(content) > maxBytes) throw Error('source unavailable');
          return { content, revision: content, byteLength: Buffer.byteLength(content) };
        },
        async sourceIdentity() { return { workspace: '/trusted/shared-root', commit: null }; },
        async release() {},
      } };
    },
  };
  const handle = createWorkspaceTools({ access, now: () => '2026-09-23T00:00:00.000Z', limits: DEFAULT_WORKSPACE_LIMITS });
  handles.push(handle);
  const a = ready(await handle.tools.captureSourceChanges(context(first), { workspace: first, workspaceRevision: 1, provider: 'typescript' }));
  const b = ready(await handle.tools.captureSourceChanges(context(second), { workspace: second, workspaceRevision: 1, provider: 'typescript' }));
  expect(a.ref.sourceDigest).toBe(b.ref.sourceDigest);
  expect((await handle.tools.captureSourceChanges(context(second), { workspace: second, workspaceRevision: 1, provider: 'typescript', previous: a.ref })).status).toBe('rejected');
  const valid = ready(await handle.tools.captureSourceChanges(context(second), { workspace: second, workspaceRevision: 1, provider: 'typescript', previous: b.ref }));
  expect(valid.changes).toEqual({ added: [], modified: [], deleted: [] });
});


it('rejects an oversized complete import capture before publishing it and leaves capacity for a later valid capture', async () => {
  const f = fixture(4, { maxQueryResults: 3, maxRetainedCaptures: 1 });
  expect(await f.tools.captureSourceChanges(f.context(), f.request())).toMatchObject({ status: 'rejected', code: 'capacity' });
  f.files.delete('src/units/unit003.ts');
  const capture = await f.capture();
  expect((await f.page(capture.ref, null, 3)).items).toHaveLength(3);
  expect(f.count.releases).toBe(f.count.opens);
});


it('does not publish if cancellation arrives while the final verification access is being released', async () => {
  const f = fixture(1, { maxRetainedCaptures: 1 });
  const abort = new AbortController();
  f.state.beforeRelease = () => { abort.abort(); };
  expect(await f.tools.captureSourceChanges(f.context('alice', abort.signal), f.request()))
    .toMatchObject({ status: 'rejected', code: 'cancelled' });
  f.state.beforeRelease = undefined;
  expect((await f.tools.captureSourceChanges(f.context(), f.request())).status).toBe('ready');
  expect(f.count.releases).toBe(f.count.opens);
});


it('rejects explicitly forbidden query paths instead of returning a successful empty result', async () => {
  const f = fixture(1);
  f.denied.add('src/base.ts');
  const captured = await f.capture();
  for (const kind of ['imports', 'symbols', 'calls'] as const) {
    expect(await f.tools.querySource(f.context(), { capture: captured.ref, query: { kind, path: 'src/base.ts' }, cursor: null, limit: 20 }))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
  }
  expect((await f.page(captured.ref)).items).toHaveLength(1);
});

it('returns a reserved capture slot after the first trusted access open throws', async () => {
  const f = fixture(1, { maxRetainedCaptures: 1 });
  f.state.beforeOpen = number => {
    if (number === 1) throw Error('temporary trusted access failure');
  };
  expect(await f.tools.captureSourceChanges(f.context(), f.request()))
    .toMatchObject({ status: 'rejected', code: 'unavailable' });
  expect(f.count.inventories).toBe(0);
  expect(f.count.reads).toBe(0);

  f.state.beforeOpen = undefined;
  const recovered = await f.capture();
  expect((await f.page(recovered.ref)).items).toHaveLength(1);
  // Recovery must return the failed reservation, without removing the configured limit.
  expect(await f.tools.captureSourceChanges(f.context(), f.request()))
    .toMatchObject({ status: 'rejected', code: 'capacity' });
});

it('keeps an expired capture with an active reader in the retained-count budget until that reader leaves', async () => {
  const f = fixture(1, { maxRetainedCaptures: 1, idleExpiryMs: 1000 });
  const first = await f.capture();
  const entered = deferred(), resume = deferred();
  const blockedOpen = f.count.opens + 1;
  f.state.beforeOpen = async number => {
    if (number === blockedOpen) { entered.resolve(); await resume.promise; }
  };
  // This read entered before expiry and is entitled to finish against its frozen material.
  const pending = f.tools.exportCapture(f.context(), first.ref);
  await entered.promise;
  try {
    f.state.time += 1001;
    // Merely passing the idle deadline cannot free the slot while the old reader still
    // owns it: that reader can complete successfully and renew the original capture.
    expect(await f.tools.captureSourceChanges(f.context(), f.request()))
      .toMatchObject({ status: 'rejected', code: 'capacity' });
  } finally {
    resume.resolve();
  }
  expect(ready(await pending).summary.ref).toEqual(first.ref);
  f.state.beforeOpen = undefined;
  expect((await f.tools.exportCapture(f.context(), first.ref)).status).toBe('ready');
  expect(await f.tools.captureSourceChanges(f.context(), f.request()))
    .toMatchObject({ status: 'rejected', code: 'capacity' });

  expect(ready(await f.tools.releaseCapture(f.context(), first.ref))).toEqual({ released: true });
  const next = await f.capture();
  expect(next.ref.captureId).not.toBe(first.ref.captureId);
  expect((await f.page(next.ref)).items).toHaveLength(1);
});
