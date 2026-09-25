import { afterEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WorkspaceRef } from '../../src/contracts/ledger.js';
import type { SourceCaptureRef } from '../../src/contracts/core/source.js';
import {
  createWorkspaceAccessFactory,
  type WorkspaceAccessFactory,
  type WorkspaceHostBindings,
} from '../../src/core/workspace/access.js';
import {
  createWorkspaceTools,
  DEFAULT_WORKSPACE_LIMITS,
} from '../../src/core/workspace/workspace-tools.js';
import type {
  CaptureSourceRequest, CaptureSummary, SourceHit, SourcePage, SourceQuery,
  WorkspaceCaptureLimits, WorkspaceChange, WorkspaceResult,
} from '../../src/core/workspace/ports.js';

// Independent R2e.1 acceptance. The explicit trusted test grants below are a Host
// binding fixture, not evidence that GUI/human Host authorization has been wired.
// Every actual path, inventory and byte read uses createWorkspaceAccessFactory's
// real Kernel WorkspaceSandbox. The observer forwards public methods unchanged.
const handles: ReturnType<typeof createWorkspaceTools>[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.allSettled(handles.splice(0).map(handle => handle.close()));
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

function ready<T>(result: WorkspaceResult<T>): T {
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw new Error(`${result.code}: ${result.reason}`);
  return result.value;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}
const digest = (body: string | Uint8Array) => createHash('sha256').update(body).digest('hex');
const textScope = (prefix: string | null) => ({
  kind: 'text_files', selectionVersion: 'readable-regular-utf8-no-nul-v1', prefix, digestBasis: 'raw_bytes',
});
type CaptureOptions = Partial<Pick<CaptureSourceRequest, 'provider' | 'prefix' | 'previous' | 'configPath'>>;

async function fixture(
  initial: Record<string, string | Uint8Array>,
  limitOverrides: Partial<WorkspaceCaptureLimits> = {},
) {
  const directory = await mkdtemp(join(tmpdir(), 'workspace-text-operations-'));
  directories.push(directory);
  const root = join(directory, 'workspace');
  await mkdir(root);
  const write = async (path: string, body: string | Uint8Array, targetRoot = root) => {
    await mkdir(dirname(join(targetRoot, path)), { recursive: true });
    await writeFile(join(targetRoot, path), body);
  };
  for (const [path, body] of Object.entries(initial)) await write(path, body);
  const workspace: WorkspaceRef = {
    aggregateType: 'Workspace', projectId: 'text-operations-project', workspaceId: 'registered-workspace',
  };
  const denied = new Set<string>();
  const state = {
    root, workspaceRevision: 7, permissionRevision: 'explicit-test-grant-v1', granted: true,
    time: Date.parse('2026-09-23T00:00:00.000Z'),
    beforeOpen: undefined as undefined | ((ordinal: number) => Promise<void> | void),
    beforeRelease: undefined as undefined | (() => Promise<void> | void),
  };
  const count = { opens: 0, authorizations: 0, reads: 0, inventories: 0, identities: 0, releases: 0 };
  const readPaths: string[] = [];
  const context = (id = 'alice', signal = new AbortController().signal): CoreCallContext => {
    const actor = { kind: 'human' as const, id };
    return {
      projectId: workspace.projectId, workspaceId: workspace.workspaceId,
      principal: { kind: 'host', actor },
      materialReader: { kind: 'host', projectId: workspace.projectId, workspaceId: workspace.workspaceId, actor },
      signal,
    };
  };
  const bindings: WorkspaceHostBindings = {
    async resolveRoot(requested) {
      return requested.projectId === workspace.projectId && requested.workspaceId === workspace.workspaceId
        ? { status: 'ready', value: { root: state.root, workspaceRevision: state.workspaceRevision } }
        : { status: 'rejected', code: 'forbidden', reason: 'No root registered for this test scope' };
    },
    async authorize(ctx, requested) {
      count.authorizations++;
      const { principal, materialReader: reader } = ctx;
      if (!state.granted || ctx.projectId !== workspace.projectId || ctx.workspaceId !== workspace.workspaceId ||
        requested.projectId !== workspace.projectId || requested.workspaceId !== workspace.workspaceId ||
        principal.kind !== 'host' || principal.actor.kind !== 'human' || !['alice', 'bob'].includes(principal.actor.id) ||
        reader.kind !== 'host' || reader.projectId !== workspace.projectId || reader.workspaceId !== workspace.workspaceId ||
        reader.actor.kind !== principal.actor.kind || reader.actor.id !== principal.actor.id) {
        return { status: 'rejected', code: 'forbidden', reason: 'No explicit matching test read grant' };
      }
      const deniedAtOpen = [...denied];
      return { status: 'ready', value: {
        subjectKey: `test-human:${principal.actor.id}`, permissionRevision: state.permissionRevision,
        allowsRead: path => !deniedAtOpen.some(prefix => path === prefix || path.startsWith(prefix + '/')),
      } };
    },
  };
  const real = createWorkspaceAccessFactory(bindings);
  const access: WorkspaceAccessFactory = {
    async open(ctx, requested) {
      count.opens++;
      await state.beforeOpen?.(count.opens);
      const result = await real.open(ctx, requested);
      if (result.status !== 'ready') return result;
      const value = result.value;
      return { status: 'ready', value: {
        ...value,
        async read(path, maxBytes) {
          count.reads++; readPaths.push(path);
          return value.read(path, maxBytes);
        },
        async listFiles(limit) { count.inventories++; return value.listFiles(limit); },
        async sourceIdentity() { count.identities++; return value.sourceIdentity(); },
        async release() { count.releases++; await state.beforeRelease?.(); await value.release(); },
      } };
    },
  };
  const handle = createWorkspaceTools({
    access, now: () => new Date(state.time).toISOString(),
    limits: { ...DEFAULT_WORKSPACE_LIMITS, ...limitOverrides },
  });
  handles.push(handle);
  const request = (options: CaptureOptions = {}): CaptureSourceRequest => ({
    workspace, workspaceRevision: state.workspaceRevision, provider: 'text', ...options,
  });
  const capture = async (options: CaptureOptions = {}, ctx = context()): Promise<CaptureSummary> =>
    ready(await handle.tools.captureSourceChanges(ctx, request(options)));
  const page = async (ref: SourceCaptureRef, query: SourceQuery, cursor: string | null = null, limit = 2, ctx = context()): Promise<SourcePage> =>
    ready(await handle.tools.querySource(ctx, { capture: ref, query, cursor, limit }));
  const readCaptured = (ref: SourceCaptureRef, path: string, maxBytes = 4096, ctx = context()) =>
    handle.tools.readWorkspace(ctx, { workspace, path, maxBytes, version: { kind: 'capture', capture: ref } });
  const compare = (before: SourceCaptureRef, after: SourceCaptureRef, ctx = context()) =>
    handle.tools.compareWorkspace(ctx, { workspace, before: { kind: 'capture', capture: before }, after: { kind: 'capture', capture: after } });
  const sourceWork = () => ({ reads: count.reads, inventories: count.inventories, identities: count.identities });
  return { ...handle, directory, root, workspace, denied, state, count, readPaths, write, context, request, capture, page, readCaptured, compare, sourceWork };
}

async function allPages(
  f: Awaited<ReturnType<typeof fixture>>, ref: SourceCaptureRef, query: SourceQuery,
) {
  const pages: SourcePage[] = [];
  let cursor: string | null = null;
  do {
    const page = await f.page(ref, query, cursor);
    pages.push(page);
    expect(pages.length).toBeLessThan(20);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return { pages, items: pages.flatMap(page => page.items) };
}
function textHits(items: SourceHit[]) {
  return items.filter((item): item is Extract<SourceHit, { kind: 'text' }> => item.kind === 'text');
}

it('reads one known file without inventory or source identity work and preserves raw BOM bytes', async () => {
  const body = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Hello 雪\r\n')]);
  const f = await fixture({ 'docs/BOM.txt': body, 'unrelated.txt': 'Do not scan me' });
  const result = ready(await f.tools.readWorkspace(f.context(), {
    workspace: f.workspace, path: 'docs/BOM.txt', maxBytes: body.byteLength, version: { kind: 'working_tree' },
  }));
  expect(result).toEqual({
    path: 'docs/BOM.txt', content: 'Hello 雪\r\n', digest: digest(body), sizeBytes: body.byteLength,
    digestBasis: 'raw_bytes', version: { kind: 'working_tree' }, readAt: new Date(f.state.time).toISOString(),
  });
  expect(result.sizeBytes).toBeGreaterThan(Buffer.byteLength(result.content));
  expect(f.sourceWork()).toEqual({ reads: 1, inventories: 0, identities: 0 });
  expect(f.readPaths).toEqual(['docs/BOM.txt']);
  expect(f.count.releases).toBe(f.count.opens);
});

it('returns typed read failures and enforces path, byte, authorization and request cancellation boundaries', async () => {
  const f = await fixture({
    'docs/good.txt': 'good', 'docs/binary.bin': Buffer.from([65, 0, 66]),
    'docs/invalid.txt': Buffer.from([0xc3, 0x28]), 'private/hidden.txt': 'synthetic private text',
  });
  f.denied.add('private');
  await writeFile(join(f.directory, 'outside.txt'), 'synthetic outside text');
  await symlink(join(f.directory, 'outside.txt'), join(f.root, 'docs/link.txt'));
  const read = (path: string, maxBytes = 4096, ctx = f.context()) => f.tools.readWorkspace(ctx, {
    workspace: f.workspace, path, maxBytes, version: { kind: 'working_tree' },
  });
  for (const [path, code] of [
    ['docs/missing.txt', 'not_found'], ['docs', 'unsupported'], ['docs/binary.bin', 'unsupported'],
    ['docs/invalid.txt', 'unsupported'], ['private/hidden.txt', 'forbidden'], ['../outside.txt', 'invalid'],
    [join(f.root, 'docs/good.txt'), 'invalid'],
  ] as const) expect(await read(path), path).toMatchObject({ status: 'rejected', code });
  expect((await read('docs/link.txt')).status).toBe('rejected');
  expect(await read('docs/good.txt', 3)).toMatchObject({ status: 'rejected', code: 'capacity' });
  for (const maxBytes of [0, -1, 1.5, DEFAULT_WORKSPACE_LIMITS.maxFileBytes + 1])
    expect(await read('docs/good.txt', maxBytes)).toMatchObject({ status: 'rejected', code: 'invalid' });
  const cancelled = new AbortController();
  cancelled.abort(new Error('Reader disconnected'));
  const work = f.sourceWork();
  expect(await read('docs/good.txt', 4096, f.context('alice', cancelled.signal)))
    .toMatchObject({ status: 'rejected', code: 'cancelled' });
  expect(f.sourceWork()).toEqual(work);
  expect(ready(await read('docs/good.txt')).content).toBe('good');
  expect(f.count.inventories).toBe(0);
  expect(f.count.identities).toBe(0);
});

it('captures the explicit text prefix including unknown extensions and exposes only that declared scope', async () => {
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('text evidence')]);
  const f = await fixture({
    'docs/README.md': bom, 'docs/example.unfamiliar': 'arbitrary text extension',
    'docs/private/hidden.txt': 'synthetic hidden text', 'docs-old/other.txt': 'out of prefix',
    'assets/picture.png': Buffer.from([0x89, 0x50, 0, 0x47]),
  });
  f.denied.add('docs/private');
  const captured = await f.capture({ prefix: 'docs' });
  expect(captured.coverage).toMatchObject({
    provider: 'text', engine: 'workspace-text', engineVersion: '1', scope: textScope('docs'),
    projectConfiguration: null, sourceCount: 2, indexedSourceCount: 0, complete: true,
    permissionFiltered: true, unresolved: [], filesystemAtomic: false, fullRuntimeCallGraph: false,
  });
  expect(captured.ref.indexVersion).toBe('workspace-text@1');
  expect(f.sourceWork()).toEqual({ reads: 4, inventories: 2, identities: 2 });
  expect([...new Set(f.readPaths)].sort()).toEqual(['docs/README.md', 'docs/example.unfamiliar']);
  const work = f.sourceWork();
  const material = ready(await f.tools.exportCapture(f.context(), captured.ref));
  expect(material.files.map(file => file.path).sort()).toEqual(['docs/README.md', 'docs/example.unfamiliar']);
  expect(material.files.find(file => file.path === 'docs/README.md'))
    .toMatchObject({ sizeBytes: bom.byteLength, digest: digest(bom) });
  expect(material).toMatchObject({ relations: [], diagnostics: [], diagnosticsTruncated: false });
  expect(ready(await f.readCaptured(captured.ref, 'docs/README.md')))
    .toMatchObject({ content: 'text evidence', digest: digest(bom), sizeBytes: bom.byteLength, digestBasis: 'raw_bytes' });
  expect(await f.tools.querySource(f.context(), { capture: captured.ref, query: { kind: 'symbols' }, cursor: null, limit: 2 }))
    .toMatchObject({ status: 'rejected', code: 'unsupported' });
  expect(await f.tools.captureArchitectureSource(f.context(), { capture: captured.ref, mappings: [] }))
    .toMatchObject({ status: 'rejected', code: 'unsupported' });
  expect(f.sourceWork()).toEqual(work);
  expect(await f.tools.captureSourceChanges(f.context(), f.request()))
    .toMatchObject({ status: 'rejected', code: 'unsupported' });
  expect(await f.tools.captureSourceChanges(f.context(), f.request({ prefix: 'docs', configPath: 'tsconfig.json' })))
    .toMatchObject({ status: 'rejected', code: 'invalid' });
});

it('rejects incomplete text captures for encoding and capacity failures and releases every failed reservation', async () => {
  const scenarios: {
    files: Record<string, string | Uint8Array>; limits: Partial<WorkspaceCaptureLimits>; code: string;
  }[] = [
    { files: { 'docs/bad.bin': Buffer.from([65, 0, 66]) }, limits: {}, code: 'unsupported' },
    { files: { 'docs/bad.txt': Buffer.from([0xc3, 0x28]) }, limits: {}, code: 'unsupported' },
    { files: { 'docs/big.txt': '012345678' }, limits: { maxFileBytes: 8 }, code: 'capacity' },
    { files: { 'docs/a.txt': 'aaaa', 'docs/b.txt': 'bbbb' }, limits: { maxCaptureBytes: 6 }, code: 'capacity' },
    { files: { 'docs/a.txt': 'a', 'docs/b.txt': 'b', 'docs/c.txt': 'c' }, limits: { maxInventoryFiles: 2 }, code: 'capacity' },
  ];
  for (const scenario of scenarios) {
    const f = await fixture(scenario.files, { ...scenario.limits, maxRetainedCaptures: 1 });
    expect(await f.tools.captureSourceChanges(f.context(), f.request({ prefix: 'docs' })))
      .toMatchObject({ status: 'rejected', code: scenario.code });
    for (const path of Object.keys(scenario.files)) await rm(join(f.root, path));
    await f.write('docs/valid.txt', 'x');
    const later = await f.capture({ prefix: 'docs' });
    expect(ready(await f.tools.exportCapture(f.context(), later.ref)).files.map(file => file.path))
      .toEqual(['docs/valid.txt']);
    expect(f.count.releases).toBe(f.count.opens);
  }
});

it('reads frozen deleted files and serves replayable paths/text pages without another source observation', async () => {
  const files = Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map(name => [`docs/${name}.txt`, `needle-${name}\n`]));
  const f = await fixture(files);
  const captured = await f.capture({ prefix: 'docs' });
  await f.write('docs/a.txt', 'replacement without the previous text');
  await rm(join(f.root, 'docs/b.txt'));
  const work = f.sourceWork();
  const authorizations = f.count.authorizations;
  expect(ready(await f.readCaptured(captured.ref, 'docs/b.txt'))).toMatchObject({
    content: 'needle-b\n', digest: digest('needle-b\n'), version: { kind: 'capture', capture: captured.ref },
  });
  expect(await f.readCaptured(captured.ref, 'docs/b.txt', 1)).toMatchObject({ status: 'rejected', code: 'capacity' });
  expect(await f.readCaptured(captured.ref, 'docs/missing.txt')).toMatchObject({ status: 'rejected', code: 'not_found' });
  expect(await f.readCaptured(captured.ref, 'elsewhere/file.txt')).toMatchObject({ status: 'rejected', code: 'unsupported' });
  const paths = await allPages(f, captured.ref, { kind: 'paths' });
  expect(paths.pages.map(page => page.items.length)).toEqual([2, 2, 1]);
  expect(paths.items.map(hit => hit.kind === 'file' ? hit.file.path : null)).toEqual(Object.keys(files));
  for (const page of paths.pages) expect(page).toMatchObject({
    coverage: { scope: textScope('docs') }, observation: 'captured_source', currentness: 'not_rechecked',
  });
  const second = await f.page(captured.ref, { kind: 'paths' }, paths.pages[0]!.nextCursor);
  expect(second).toEqual(paths.pages[1]);
  const text = await allPages(f, captured.ref, { kind: 'text', text: 'needle', caseSensitive: true });
  expect(text.pages.map(page => page.items.length)).toEqual([2, 2, 1]);
  expect(textHits(text.items).map(hit => hit.location.path)).toEqual(Object.keys(files));
  expect(textHits(text.items).every(hit => hit.excerpt === 'needle')).toBe(true);
  expect(f.sourceWork()).toEqual(work);
  expect(f.count.authorizations).toBeGreaterThan(authorizations);
});

it('uses original UTF-16 coordinates, Unicode case folding, escaped literal matches and path boundaries', async () => {
  const content = '😀İi I\r\nKk needle.* needle.*\r\nA aA\n';
  const f = await fixture({ 'docs/a.txt': content, 'docs-old/b.txt': 'needle.*' });
  const captured = await f.capture();
  const work = f.sourceWork();
  const query = async (text: string, caseSensitive = false) => textHits((await allPages(f, captured.ref, {
    kind: 'text', text, caseSensitive, prefix: 'docs',
  })).items);
  expect((await query('i')).map(hit => [hit.excerpt, hit.location.start, hit.location.end])).toEqual([
    ['i', { line: 1, column: 4 }, { line: 1, column: 5 }],
    ['I', { line: 1, column: 6 }, { line: 1, column: 7 }],
  ]);
  expect((await query('İ', true)).map(hit => [hit.location.start, hit.location.end]))
    .toEqual([[{ line: 1, column: 3 }, { line: 1, column: 4 }]]);
  expect((await query('k')).map(hit => hit.excerpt)).toEqual(['K', 'k']);
  expect((await query('needle.*', true)).map(hit => [hit.excerpt, hit.location.start, hit.location.end])).toEqual([
    ['needle.*', { line: 2, column: 4 }, { line: 2, column: 12 }],
    ['needle.*', { line: 2, column: 13 }, { line: 2, column: 21 }],
  ]);
  expect((await query('a')).map(hit => hit.location.start)).toEqual([
    { line: 3, column: 1 }, { line: 3, column: 3 }, { line: 3, column: 4 },
  ]);
  const paths = await allPages(f, captured.ref, { kind: 'paths', prefix: 'docs' });
  expect(paths.items.map(hit => hit.kind === 'file' ? hit.file.path : null)).toEqual(['docs/a.txt']);
  expect((await query('needle.*', true)).every(hit => hit.location.digest === digest(content))).toBe(true);
  expect(f.sourceWork()).toEqual(work);
});

it('rejects invalid/oversized queries rather than returning partial pages and binds cursors to the exact query', async () => {
  const f = await fixture({
    'docs/a.txt': 'needle unique', 'docs/b.txt': 'needle', 'docs/c.txt': 'needle', 'docs/d.txt': 'needle',
  }, { maxQueryResults: 3 });
  const captured = await f.capture({ prefix: 'docs' });
  const work = f.sourceWork();
  for (const text of ['', 'line\nbreak', 'line\rbreak', 'a'.repeat(513), '😀'.repeat(513)])
    expect(await f.tools.querySource(f.context(), { capture: captured.ref, query: { kind: 'text', text, caseSensitive: true }, cursor: null, limit: 2 }))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
  for (const query of [{ kind: 'paths' }, { kind: 'text', text: 'needle', caseSensitive: true }] satisfies SourceQuery[])
    expect(await f.tools.querySource(f.context(), { capture: captured.ref, query, cursor: null, limit: 2 }))
      .toMatchObject({ status: 'rejected', code: 'capacity' });
  expect(textHits((await f.page(captured.ref, { kind: 'text', text: 'unique', caseSensitive: true })).items)).toHaveLength(1);
  const first = await f.page(captured.ref, { kind: 'text', text: 'n', caseSensitive: true, prefix: 'docs/a.txt' }, null, 1);
  expect(first.nextCursor).not.toBeNull();
  expect(await f.tools.querySource(f.context(), {
    capture: captured.ref, query: { kind: 'text', text: 'unique', caseSensitive: true }, cursor: first.nextCursor, limit: 1,
  })).toMatchObject({ status: 'rejected', code: 'cursor_mismatch' });
  expect(await f.page(captured.ref, { kind: 'text', text: 'n', caseSensitive: true, prefix: 'docs/a.txt' }, first.nextCursor, 1))
    .toEqual(await f.page(captured.ref, { kind: 'text', text: 'n', caseSensitive: true, prefix: 'docs/a.txt' }, first.nextCursor, 1));
  expect(f.sourceWork()).toEqual(work);
});

it('serves paths and decoded-text reads from the existing TS inventory without claiming unrelated files', async () => {
  const content = 'export const alpha = 1;\n';
  const f = await fixture({
    'src/alpha.ts': Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(content)]),
    'tsconfig.json': '{"compilerOptions":{"module":"esnext"},"include":["src/**/*.ts"]}',
    'package.json': '{"name":"synthetic-workspace"}', 'README.md': 'not a TypeScript project input',
  });
  const captured = await f.capture({ provider: 'typescript', prefix: 'src' });
  expect(captured.coverage).toMatchObject({ scope: {
    kind: 'typescript_project_inputs', selectionVersion: 'ts-js-json-v1', prefix: null, digestBasis: 'decoded_utf8',
  } });
  const work = f.sourceWork();
  const paths = await allPages(f, captured.ref, { kind: 'paths' });
  expect(paths.items.map(hit => hit.kind === 'file' ? hit.file.path : null))
    .toEqual(['package.json', 'src/alpha.ts', 'tsconfig.json']);
  expect(ready(await f.readCaptured(captured.ref, 'src/alpha.ts'))).toMatchObject({
    content, digest: digest(content), sizeBytes: Buffer.byteLength(content), digestBasis: 'decoded_utf8',
  });
  expect(await f.readCaptured(captured.ref, 'README.md')).toMatchObject({ status: 'rejected', code: 'unsupported' });
  expect(await f.readCaptured(captured.ref, 'src/missing.ts')).toMatchObject({ status: 'rejected', code: 'not_found' });
  expect(textHits((await f.page(captured.ref, { kind: 'text', text: 'alpha', caseSensitive: true })).items))
    .toHaveLength(1);
  expect(f.sourceWork()).toEqual(work);
});

it('compares same-scope content across workspace revisions with explicit unique/ambiguous rename evidence', async () => {
  const f = await fixture({
    'docs/gone.txt': 'gone', 'docs/change.txt': 'old', 'docs/stay.txt': 'duplicate',
    'docs/dup-old.txt': 'duplicate', 'docs/unique-old.txt': 'unique rename',
    'docs/many-old-a.txt': 'twice', 'docs/many-old-b.txt': 'twice',
    'docs/swap-a.txt': 'swap A', 'docs/swap-b.txt': 'swap B',
  });
  const before = await f.capture({ prefix: 'docs' });
  for (const path of ['gone', 'dup-old', 'unique-old', 'many-old-a', 'many-old-b'])
    await rm(join(f.root, `docs/${path}.txt`));
  for (const [path, body] of Object.entries({
    'change': 'new', 'new': 'added', 'dup-new': 'duplicate', 'unique-new': 'unique rename',
    'many-new-a': 'twice', 'many-new-b': 'twice', 'swap-a': 'swap B', 'swap-b': 'swap A',
  })) await f.write(`docs/${path}.txt`, body);
  f.state.workspaceRevision++;
  const after = await f.capture({ prefix: 'docs' });
  const work = f.sourceWork();
  const authorizations = f.count.authorizations;
  const result = ready(await f.compare(before.ref, after.ref));
  expect(result).toMatchObject({
    before: before.ref, after: after.ref, scope: textScope('docs'), comparison: 'captured_content_only', complete: true,
  });
  const changes: WorkspaceChange[] = [
    { kind: 'deleted', path: 'docs/gone.txt', digest: digest('gone') },
    { kind: 'modified', path: 'docs/change.txt', beforeDigest: digest('old'), afterDigest: digest('new') },
    { kind: 'added', path: 'docs/new.txt', digest: digest('added') },
    { kind: 'deleted', path: 'docs/dup-old.txt', digest: digest('duplicate') },
    { kind: 'added', path: 'docs/dup-new.txt', digest: digest('duplicate') },
    { kind: 'renamed', beforePath: 'docs/unique-old.txt', afterPath: 'docs/unique-new.txt', digest: digest('unique rename'), evidence: 'identical_content' },
    { kind: 'deleted', path: 'docs/many-old-a.txt', digest: digest('twice') },
    { kind: 'deleted', path: 'docs/many-old-b.txt', digest: digest('twice') },
    { kind: 'added', path: 'docs/many-new-a.txt', digest: digest('twice') },
    { kind: 'added', path: 'docs/many-new-b.txt', digest: digest('twice') },
    { kind: 'modified', path: 'docs/swap-a.txt', beforeDigest: digest('swap A'), afterDigest: digest('swap B') },
    { kind: 'modified', path: 'docs/swap-b.txt', beforeDigest: digest('swap B'), afterDigest: digest('swap A') },
  ];
  expect(result.changes).toHaveLength(changes.length);
  expect(result.changes).toEqual(expect.arrayContaining(changes));
  expect(f.count.authorizations - authorizations).toBe(1);
  expect(ready(await f.compare(after.ref, after.ref)).changes).toEqual([]);
  expect(f.sourceWork()).toEqual(work);
});

it('refuses cross-provider/range/scope and Git comparisons and does not pass oversized differences as complete', async () => {
  const f = await fixture({ 'docs/a.txt': 'text', 'src/a.ts': 'export const a = 1;' });
  const docs = await f.capture({ prefix: 'docs' });
  const src = await f.capture({ prefix: 'src' });
  const ts = await f.capture({ provider: 'typescript' });
  const work = f.sourceWork();
  expect(await f.compare(docs.ref, src.ref)).toMatchObject({ status: 'rejected', code: 'unsupported' });
  expect(await f.compare(src.ref, ts.ref)).toMatchObject({ status: 'rejected', code: 'unsupported' });
  expect(await f.tools.compareWorkspace(f.context(), {
    workspace: { ...f.workspace, workspaceId: 'different-workspace' },
    before: { kind: 'capture', capture: docs.ref }, after: { kind: 'capture', capture: docs.ref },
  })).toMatchObject({ status: 'rejected', code: 'forbidden' });
  expect((await f.compare({ ...docs.ref, sourceDigest: '0'.repeat(64) }, docs.ref)).status).toBe('rejected');
  expect(await f.tools.compareWorkspace(f.context(), {
    workspace: f.workspace, before: { kind: 'git', commit: 'a'.repeat(40) }, after: { kind: 'capture', capture: docs.ref },
  })).toMatchObject({ status: 'rejected', code: 'unsupported' });
  expect(await f.tools.readWorkspace(f.context(), {
    workspace: f.workspace, path: 'docs/a.txt', maxBytes: 4096, version: { kind: 'git', commit: 'a'.repeat(40) },
  })).toMatchObject({ status: 'rejected', code: 'unsupported' });
  expect(f.sourceWork()).toEqual(work);

  const bounded = await fixture({ 'docs/a.txt': 'old a', 'docs/b.txt': 'old b' }, { maxQueryResults: 1 });
  const old = await bounded.capture({ prefix: 'docs' });
  await bounded.write('docs/a.txt', 'new a'); await bounded.write('docs/b.txt', 'new b');
  const newer = await bounded.capture({ prefix: 'docs' });
  expect(await bounded.compare(old.ref, newer.ref)).toMatchObject({ status: 'rejected', code: 'capacity' });
});

it('rechecks grants, subjects and real root identity before frozen reads, queries and pair comparisons', async () => {
  for (const change of ['revoked', 'permission', 'root', 'subject', 'request-scope'] as const) {
    const f = await fixture({ 'docs/a.txt': 'synthetic retained text' });
    const captured = await f.capture({ prefix: 'docs' });
    const work = f.sourceWork();
    let ctx = f.context();
    if (change === 'revoked') f.state.granted = false;
    if (change === 'permission') { f.denied.add('docs'); f.state.permissionRevision = 'explicit-test-grant-v2'; }
    if (change === 'root') {
      const rebound = join(f.directory, 'rebound-workspace');
      await f.write('docs/a.txt', 'synthetic rebound text', rebound);
      f.state.root = rebound;
    }
    if (change === 'subject') ctx = f.context('bob'); // Bob has a real fixture grant, but does not own Alice's capture.
    if (change === 'request-scope') ctx = { ...ctx, workspaceId: 'different-workspace' };
    expect(await f.readCaptured(captured.ref, 'docs/a.txt', 4096, ctx), change)
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await f.tools.querySource(ctx, { capture: captured.ref, query: { kind: 'paths' }, cursor: null, limit: 2 }), change)
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await f.compare(captured.ref, captured.ref, ctx), change)
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(f.sourceWork()).toEqual(work);
  }
});

it('honors release, expiry and handle close for both new operations without poisoning unrelated live captures', async () => {
  const f = await fixture({ 'docs/a.txt': 'retained' }, { idleExpiryMs: 1000 });
  const old = await f.capture({ prefix: 'docs' });
  const live = await f.capture({ prefix: 'docs' });
  const work = f.sourceWork();
  expect(ready(await f.tools.releaseCapture(f.context(), old.ref)).released).toBe(true);
  expect(await f.readCaptured(old.ref, 'docs/a.txt')).toMatchObject({ status: 'rejected', code: 'capture_expired' });
  expect(await f.compare(old.ref, live.ref)).toMatchObject({ status: 'rejected', code: 'capture_expired' });
  expect(ready(await f.readCaptured(live.ref, 'docs/a.txt')).content).toBe('retained');
  f.state.time += 1001;
  expect(await f.readCaptured(live.ref, 'docs/a.txt')).toMatchObject({ status: 'rejected', code: 'capture_expired' });
  expect(await f.compare(live.ref, live.ref)).toMatchObject({ status: 'rejected', code: 'capture_expired' });
  expect(f.sourceWork()).toEqual(work);
  await f.close();
  expect(await f.tools.readWorkspace(f.context(), {
    workspace: f.workspace, path: 'docs/a.txt', maxBytes: 4096, version: { kind: 'working_tree' },
  })).toMatchObject({ status: 'rejected', code: 'cancelled' });
  expect(await f.compare(live.ref, live.ref)).toMatchObject({ status: 'rejected', code: 'cancelled' });
  expect(f.sourceWork()).toEqual(work);
});

it('does not publish unstable text observations and uses the text provider for explicit currentness verification', async () => {
  for (const change of ['content', 'permission', 'root', 'revision'] as const) {
    const f = await fixture({ 'docs/a.txt': 'original' }, { maxRetainedCaptures: 1 });
    const rebound = join(f.directory, 'rebound-workspace');
    if (change === 'root') await f.write('docs/a.txt', 'original', rebound);
    f.state.beforeOpen = async ordinal => {
      if (ordinal !== 2) return;
      if (change === 'content') await f.write('docs/a.txt', 'changed during capture');
      if (change === 'permission') f.state.permissionRevision = 'explicit-test-grant-v2';
      if (change === 'root') f.state.root = rebound;
      if (change === 'revision') f.state.workspaceRevision++;
    };
    expect((await f.tools.captureSourceChanges(f.context(), f.request({ prefix: 'docs' }))).status, change)
      .toBe('rejected');
    f.state.beforeOpen = undefined;
    const captured = await f.capture({ prefix: 'docs' });
    const before = ready(await f.readCaptured(captured.ref, 'docs/a.txt'));
    expect(await f.tools.verifyCapture(f.context(), captured.ref)).toMatchObject({ status: 'ready' });
    await f.write('docs/a.txt', 'changed after capture', f.state.root);
    expect(await f.tools.verifyCapture(f.context(), captured.ref)).toMatchObject({ status: 'rejected', code: 'source_stale' });
    const work = f.sourceWork();
    expect(ready(await f.readCaptured(captured.ref, 'docs/a.txt')).content).toBe(before.content);
    expect(f.sourceWork()).toEqual(work);
    expect(f.count.releases).toBe(f.count.opens);
  }
});


it('pins both captures across concurrent release and makes close await cancelled pair work and real access cleanup', async () => {
  const f = await fixture({ 'docs/a.txt': 'before' });
  const before = await f.capture({ prefix: 'docs' });
  await f.write('docs/a.txt', 'after');
  const after = await f.capture({ prefix: 'docs' });
  const work = f.sourceWork();
  const entered = deferred(), proceed = deferred();
  const compareOpen = f.count.opens + 1;
  f.state.beforeOpen = async ordinal => {
    if (ordinal !== compareOpen) return;
    entered.resolve();
    await proceed.promise;
  };
  const comparing = f.compare(before.ref, after.ref);
  try {
    await Promise.race([entered.promise, comparing.then(() => { throw Error('Pair comparison skipped fresh access'); })]);
    // As with withEntry, both readers are admitted/pinned before the fresh-open await.
    // Explicit release stops new use, but cannot destroy the admitted comparison's data.
    const releases = await Promise.all([
      f.tools.releaseCapture(f.context(), before.ref),
      f.tools.releaseCapture(f.context(), after.ref),
    ]);
    for (const result of releases) expect(ready(result).released).toBe(true);
    proceed.resolve();
    expect(ready(await comparing).changes).toEqual([
      { kind: 'modified', path: 'docs/a.txt', beforeDigest: digest('before'), afterDigest: digest('after') },
    ]);
    expect(await f.compare(before.ref, after.ref)).toMatchObject({ status: 'rejected', code: 'capture_expired' });
    for (const ref of [before.ref, after.ref])
      expect(await f.readCaptured(ref, 'docs/a.txt')).toMatchObject({ status: 'rejected', code: 'capture_expired' });
    expect(f.sourceWork()).toEqual(work);
  } finally {
    f.state.beforeOpen = undefined;
    proceed.resolve();
    await Promise.allSettled([comparing]);
  }

  // Use another real pair. While its fresh access is paused, a real release owns an
  // access awaiting cleanup. close must wait for BOTH operations, not just cancel
  // the comparison and then discard retained material while cleanup is still held.
  const left = await f.capture({ prefix: 'docs' });
  await f.write('docs/a.txt', 'next');
  const right = await f.capture({ prefix: 'docs' });
  const sourceWork = f.sourceWork();
  const openEntered = deferred(), openGate = deferred();
  const releaseEntered = deferred(), releaseGate = deferred();
  const nextCompareOpen = f.count.opens + 1;
  f.state.beforeOpen = async ordinal => {
    if (ordinal !== nextCompareOpen) return;
    openEntered.resolve();
    await openGate.promise;
  };
  const pendingPair = f.compare(left.ref, right.ref);
  let pendingRelease: ReturnType<typeof f.tools.releaseCapture> | undefined;
  let closing: Promise<void> | undefined;
  let closed = false;
  try {
    await Promise.race([openEntered.promise, pendingPair.then(() => { throw Error('Pair comparison skipped fresh access'); })]);
    f.state.beforeRelease = async () => {
      // One public-access cleanup only; forward to the actual Kernel adapter afterward.
      f.state.beforeRelease = undefined;
      releaseEntered.resolve();
      await releaseGate.promise;
    };
    pendingRelease = f.tools.releaseCapture(f.context(), left.ref);
    await Promise.race([releaseEntered.promise, pendingRelease.then(() => { throw Error('Release did not await its access cleanup'); })]);
    closing = f.close().then(() => { closed = true; });
    await Promise.resolve();
    expect(closed).toBe(false);
    openGate.resolve();
    expect(await pendingPair).toMatchObject({ status: 'rejected', code: 'cancelled' });
    expect(closed).toBe(false); // The real release access is still held behind releaseGate.
    releaseGate.resolve();
    await pendingRelease;
    await closing;
    expect(closed).toBe(true);
    expect(await f.compare(left.ref, right.ref)).toMatchObject({ status: 'rejected', code: 'cancelled' });
    expect(f.sourceWork()).toEqual(sourceWork);
    // The paused pair open observes the close signal before creating an access;
    // every other actual access has reached its real release.
    expect(f.count.releases).toBe(f.count.opens - 1);
  } finally {
    f.state.beforeOpen = undefined;
    f.state.beforeRelease = undefined;
    openGate.resolve();
    releaseGate.resolve();
    await Promise.allSettled([pendingPair, ...(pendingRelease ? [pendingRelease] : []), ...(closing ? [closing] : [])]);
  }
}, 10000);
