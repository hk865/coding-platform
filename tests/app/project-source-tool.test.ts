/**
 * R2d.1 independent protocol acceptance tests.
 * Staged in /tmp until R2c is accepted. Destination: tests/app/project-source-tool.test.ts.
 * Uses actual Kernel tool handlers, the actual TS provider/registry, and a trusted local
 * Host fixture; it does not stand in for the production Run/Query binding in R2d.2/3.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { WorkspaceSandbox, type ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { WorkspaceRef } from '../../src/contracts/ledger.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SourceCaptureRef } from '../../src/contracts/core/source.js';
import type { RuntimeSourceCaptureAccess } from '../../src/core/agent-runtime/source-tool-ports.js';
import { createWorkspaceAccessFactory, type WorkspaceAccessFactory } from '../../src/core/workspace/access.js';
import { createWorkspaceTools, DEFAULT_WORKSPACE_LIMITS } from '../../src/core/workspace/workspace-tools.js';
import type { CaptureSummary, SourceCoverage, SourcePage, WorkspaceCaptureLimits, WorkspaceResult } from '../../src/core/workspace/ports.js';
import { ProjectSourceIndex, type ProjectSourcePage } from '../../src/core/workspace/project-source-index.js';
import { TypeScriptSourceAnalyzer } from '../../src/core/workspace/typescript-source-query.js';
import { createExplorationTools, type SourceToolOptions } from '../../src/core/agent-runtime/exploration-tools.js';

type ToolResult = Awaited<ReturnType<ToolDefinition['handler']['execute']>>;
type MetadataSample = { count: number; sample: string[]; truncated: boolean };
type ModelCoverage = Omit<SourceCoverage, 'unresolved'> & { unresolved: MetadataSample };
type ModelCapture = Omit<CaptureSummary, 'coverage' | 'changes'> & {
  coverage: ModelCoverage;
  changes: { added: MetadataSample; modified: MetadataSample; deleted: MetadataSample };
};
type ModelPage = Omit<SourcePage, 'coverage'> & { coverage: ModelCoverage };
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  try {
    const outcomes = await Promise.allSettled(cleanups.splice(0).map(close => close()));
    const failed = outcomes.find(outcome => outcome.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  } finally { vi.restoreAllMocks(); }
});

function json<T>(result: ToolResult): T {
  expect(result.status).toBe('success');
  if (result.status !== 'success') throw Error(JSON.stringify(result));
  const output = result.output.find(block => block.kind === 'json');
  if (!output || output.kind !== 'json') throw Error('missing JSON output');
  expect(Buffer.byteLength(JSON.stringify(output.value))).toBeLessThanOrEqual(60 * 1024);
  return output.value as T;
}
function ready<T>(result: WorkspaceResult<T>): T {
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw Error(`${result.code}: ${result.reason}`);
  return result.value;
}
function success<T>(result: ToolResult): T { return ready(json<WorkspaceResult<T>>(result)); }
function emptySample(): MetadataSample { return { count: 0, sample: [], truncated: false }; }
function imports(count: number, specifier = 'x'): string {
  return Array.from({ length: count }, () => `import${JSON.stringify(specifier)};`).join('');
}

async function fixture(source = imports(4), limits: Partial<WorkspaceCaptureLimits> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'project-source-tool-'));
  const files = new Set<string>();
  const write = async (path: string, content: string) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
    files.add(path);
  };
  await write('tsconfig.json', JSON.stringify({ compilerOptions: { module: 'esnext', moduleResolution: 'bundler', noLib: true, types: [] }, include: ['**/*.ts'] }));
  await write('a.ts', source);
  const sandbox = await WorkspaceSandbox.create(root, { deniedPrefixes: ['.git'] });
  const workspace: WorkspaceRef = { aggregateType: 'Workspace', projectId: 'project-one', workspaceId: 'workspace-one' };
  const state = { granted: true, workspaceRevision: 1 };
  const count = { opens: 0, inventories: 0, reads: 0, identities: 0, revisions: 0 };
  const context = (signal = new AbortController().signal): CoreCallContext => ({
    projectId: workspace.projectId, workspaceId: workspace.workspaceId,
    principal: { kind: 'host', actor: { kind: 'human', id: 'alice' } },
    materialReader: { kind: 'host', projectId: workspace.projectId, workspaceId: workspace.workspaceId, actor: { kind: 'human', id: 'alice' } }, signal,
  });
  // Explicit trusted grants, with the real sandbox/path policy underneath. Neither root
  // nor identity is accepted from model arguments or fabricated from a Kernel call id.
  const local = createWorkspaceAccessFactory({
    async resolveRoot(requested) {
      return requested.projectId === workspace.projectId && requested.workspaceId === workspace.workspaceId
        ? { status: 'ready', value: { root, workspaceRevision: state.workspaceRevision } }
        : { status: 'rejected', code: 'forbidden', reason: 'wrong test workspace' };
    },
    async authorize(ctx, requested) {
      const principal = ctx.principal, reader = ctx.materialReader;
      if (!state.granted || ctx.projectId !== workspace.projectId || ctx.workspaceId !== workspace.workspaceId ||
          requested.projectId !== workspace.projectId || requested.workspaceId !== workspace.workspaceId ||
          principal.kind !== 'host' || principal.actor.kind !== 'human' || principal.actor.id !== 'alice' ||
          reader.kind !== 'host' || reader.projectId !== workspace.projectId || reader.workspaceId !== workspace.workspaceId ||
          reader.actor.kind !== 'human' || reader.actor.id !== 'alice') {
        return { status: 'rejected', code: 'forbidden', reason: 'no matching trusted test grant' };
      }
      return { status: 'ready', value: { subjectKey: 'human:alice', permissionRevision: 'grant-1', allowsRead: () => true } };
    },
  });
  const access: WorkspaceAccessFactory = {
    async open(ctx, requested) {
      count.opens++;
      const opened = await local.open(ctx, requested);
      if (opened.status !== 'ready') return opened;
      const bound = opened.value;
      return { status: 'ready', value: {
        ...bound,
        async listFiles(limit) { count.inventories++; return bound.listFiles(limit); },
        async read(path, maxBytes) { count.reads++; return bound.read(path, maxBytes); },
        async sourceIdentity() { count.identities++; return bound.sourceIdentity(); },
      } };
    },
  };
  const core = createWorkspaceTools({ access, now: () => '2026-09-23T00:00:00.000Z', limits: { ...DEFAULT_WORKSPACE_LIMITS, ...limits } });
  const runtime: RuntimeSourceCaptureAccess = {
    port: core.tools, workspace, context,
    async currentWorkspaceRevision(signal) {
      signal.throwIfAborted(); count.revisions++;
      return { status: 'ready', value: state.workspaceRevision };
    },
    close: () => core.close(),
  };
  const groups: ReturnType<typeof createExplorationTools>[] = [];
  const oracles: ProjectSourceIndex[] = [];
  cleanups.push(async () => {
    try {
      await Promise.all(groups.map(group => group.close()));
    } finally {
      try { await runtime.close(); } finally {
        for (const oracle of oracles) oracle.dispose();
        await rm(root, { recursive: true, force: true });
      }
    }
  });
  const sourceIdentity = async () => ({ workspace: sandbox.identity, commit: null });
  function group(options: SourceToolOptions = { projectSource: { mode: 'frozen', access: runtime } }) {
    const handle = createExplorationTools(sandbox, { sourceIdentity, ...options });
    groups.push(handle);
    const run = async (name: string, args: Record<string, unknown>, signal = new AbortController().signal): Promise<ToolResult> => {
      const tool = handle.tools.find(candidate => candidate.name === name);
      if (!tool) throw Error(`missing tool: ${name}`);
      return tool.handler.execute({ schemaVersion: 1, callId: 'protocol-test', name, arguments: args } as never, { signal } as never);
    };
    return { ...handle, run, source: (args: Record<string, unknown>, signal?: AbortSignal) => run('project_source', args, signal) };
  }
  function legacyOracle() {
    const index = new ProjectSourceIndex({ allowed: () => true, sourceIdentity,
      read: (path, bytes) => sandbox.read(path, bytes), inventory: signal => sandbox.listFiles(60000, { signal }) });
    oracles.push(index);
    return index;
  }
  const work = () => ({ inventories: count.inventories, reads: count.reads, identities: count.identities });
  return { root, files, write, sandbox, workspace, state, count, context, core, runtime, group, legacyOracle, work };
}

it('serves 401 import relations through three real tool pages after just two observations and one imports analysis', async () => {
  const f = await fixture(imports(401));
  const analyses = vi.spyOn(TypeScriptSourceAnalyzer.prototype, 'analyze');
  const g = f.group();
  const captured = success<ModelCapture>(await g.source({ action: 'capture' }));
  expect(f.work()).toEqual({ inventories: 2, reads: 2 * f.files.size, identities: 2 });
  expect(captured.ref).toMatchObject({ projectId: f.workspace.projectId, workspaceId: f.workspace.workspaceId, workspaceRevision: 1 });
  expect(captured.coverage).toMatchObject({ provider: 'typescript', permissionFiltered: true, filesystemAtomic: false, fullRuntimeCallGraph: false });
  const work = f.work(), opens = f.count.opens;
  const pages: ModelPage[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 3; page++) {
    const result: ModelPage = success<ModelPage>(await g.source({ action: 'query', capture: captured.ref, query: { kind: 'imports' }, cursor, limit: 160 }));
    pages.push(result); cursor = result.nextCursor;
    expect(result).toMatchObject({ capture: captured.ref, observation: 'captured_source', currentness: 'not_rechecked' });
  }
  expect(pages.map(page => page.items.length)).toEqual([160, 160, 81]);
  expect(pages.map(page => page.complete)).toEqual([false, false, true]);
  expect(cursor).toBeNull();
  const relations = pages.flatMap(page => page.items).map(hit => {
    if (hit.kind !== 'relation') throw Error('imports returned a non-relation');
    expect(hit.relation).toMatchObject({ kind: 'import', expression: 'x', from: { path: 'a.ts' } });
    return hit.relation;
  });
  expect(new Set(relations.map(relation => relation.from.start.column)).size).toBe(401);
  expect(f.work()).toEqual(work);
  expect(f.count.opens).toBeGreaterThanOrEqual(opens + 3); // cached pages still reauthorize
  expect(f.count.revisions).toBe(1); // model cannot replace the capture's trusted revision
  expect(analyses.mock.calls.filter(([, query]) => query.operation === 'imports')).toHaveLength(1);
  expect(success<{ capture: SourceCaptureRef; verifiedAt: string }>(await g.source({ action: 'verify', capture: captured.ref })).capture).toEqual(captured.ref);
  expect(f.work()).toEqual({ inventories: 3, reads: 3 * f.files.size, identities: 3 });
  expect(success<{ released: boolean }>(await g.source({ action: 'release', capture: captured.ref }))).toEqual({ released: true });
  expect(json(await g.source({ action: 'query', capture: captured.ref, query: { kind: 'imports' }, cursor: null, limit: 1 }))).toMatchObject({ status: 'rejected', code: 'capture_expired' });
});

it('keeps frozen pages readable after an edit and makes currentness an explicit verify result', async () => {
  const f = await fixture(imports(3)), g = f.group();
  const captured = success<ModelCapture>(await g.source({ action: 'capture' }));
  const request = { action: 'query', capture: captured.ref, query: { kind: 'imports' }, cursor: null, limit: 1 };
  const first = success<ModelPage>(await g.source(request)), work = f.work();
  await f.write('a.ts', 'export const replacement = 1;');
  expect(success<ModelPage>(await g.source(request))).toEqual(first);
  expect(f.work()).toEqual(work);
  expect(json(await g.source({ action: 'verify', capture: captured.ref }))).toMatchObject({ status: 'rejected', code: 'source_stale' });
  const newer = success<ModelCapture>(await g.source({ action: 'capture', previous: captured.ref }));
  expect(newer.ref.sourceDigest).not.toBe(captured.ref.sourceDigest);
  expect(newer.changes).toEqual({ added: emptySample(), modified: { count: 1, sample: ['a.ts'], truncated: false }, deleted: emptySample() });
  expect(success<ModelPage>(await g.source({ ...request, capture: newer.ref })).items).toEqual([]);
  expect(success<ModelPage>(await g.source(request))).toEqual(first);
});

it('rejects unknown fields, identity overrides, old paging fields, malformed refs and queries before core access', async () => {
  const f = await fixture(), g = f.group();
  const ref = success<ModelCapture>(await g.source({ action: 'capture' })).ref;
  const query = { action: 'query', capture: ref, query: { kind: 'imports' }, cursor: null, limit: 1 };
  const { indexVersion: _omittedVersion, ...incomplete } = ref;
  const invalid: Array<Record<string, unknown>> = [
    { action: 'export' }, { action: 'capture', root: '/tmp' }, { action: 'capture', projectId: 'other' },
    { action: 'capture', workspaceRevision: 99 }, { action: 'capture', provider: 'python' },
    { action: 'capture', principal: { kind: 'host' } }, { action: 'capture', role: 'admin' },
    { action: 'capture', prefix: '.' }, { action: 'capture', configPath: '/tsconfig.json' },
    { ...query, offset: 0 }, { ...query, expectedSnapshot: 'a'.repeat(64) },
    { ...query, cursor: undefined }, { ...query, cursor: '' }, { ...query, limit: 0 }, { ...query, limit: 201 },
    { ...query, capture: incomplete }, { ...query, capture: { ...ref, sourceDigest: 'z'.repeat(64) } },
    { ...query, capture: { ...ref, configDigest: 'short' } }, { ...query, capture: { ...ref, principal: 'alice' } },
    { ...query, query: { kind: 'paths', prefix: '../docs' } }, { ...query, query: { kind: 'text', text: 'x', caseSensitive: 'yes' } },
    { action: 'read', path: 'a.ts', maxBytes: 8193, version: { kind: 'working_tree' } },
    { ...query, query: { kind: 'imports', root: '/tmp' } },
    ...['../a.ts', '/a.ts', 'a/./b.ts', 'a\\b.ts'].map(path => ({ ...query, query: { kind: 'imports', path } })),
    { ...query, query: { kind: 'definitions', path: 'a.ts', line: 0, column: 1 } },
    { ...query, query: { kind: 'references', path: 'a.ts', line: 1, column: 0 } },
    { action: 'verify', capture: ref, workspaceId: 'other' }, { action: 'release', capture: ref, root: '/tmp' },
  ];
  const before = { ...f.count };
  for (const input of invalid) expect(await g.source(input), JSON.stringify(input)).toMatchObject({ status: 'error', error: { code: 'invalid_arguments' } });
  expect(f.count).toEqual(before);
  const defaultLimit = success<ModelPage>(await g.source({ action: 'query', capture: ref, query: { kind: 'imports' }, cursor: null }));
  expect(defaultLimit.items).toHaveLength(4);
});

it('preserves core scope/ref/cursor rejections and checks current authorization on every tool use', async () => {
  const f = await fixture(imports(3)), g = f.group();
  const first = success<ModelCapture>(await g.source({ action: 'capture' }));
  const page = success<ModelPage>(await g.source({ action: 'query', capture: first.ref, query: { kind: 'imports' }, cursor: null, limit: 1 }));
  const second = success<ModelCapture>(await g.source({ action: 'capture' }));
  const request = { action: 'query', capture: first.ref, query: { kind: 'imports' }, cursor: page.nextCursor, limit: 1 };
  expect(json(await g.source({ ...request, capture: second.ref }))).toMatchObject({ status: 'rejected', code: 'cursor_mismatch' });
  expect(json(await g.source({ ...request, query: { kind: 'symbols' } }))).toMatchObject({ status: 'rejected', code: 'cursor_mismatch' });
  for (const forged of [{ ...first.ref, projectId: 'foreign-project' }, { ...first.ref, workspaceId: 'foreign-workspace' }, { ...first.ref, sourceDigest: '0'.repeat(64) }]) {
    const result = json<WorkspaceResult<ModelPage>>(await g.source({ ...request, capture: forged, cursor: null }));
    expect(result.status).toBe('rejected');
  }
  const work = f.work();
  f.state.granted = false;
  for (const action of ['query', 'verify', 'release']) {
    const args = action === 'query' ? { ...request, action } : { action, capture: first.ref };
    expect(json(await g.source(args))).toMatchObject({ status: 'rejected', code: 'forbidden' });
  }
  expect(f.work()).toEqual(work);
});

it('enforces Reviewer-style guards for nested query paths and prefixes without reading another page', async () => {
  const f = await fixture();
  const g = f.group({ projectSource: { mode: 'frozen', access: f.runtime }, allowedPath: path => path !== 'a.ts' });
  const capture = success<ModelCapture>(await g.source({ action: 'capture' })).ref;
  const calls = vi.spyOn(f.core.tools, 'querySource');
  for (const query of [{ kind: 'imports', path: 'a.ts' }, { kind: 'symbols', prefix: 'a.ts' }, { kind: 'definitions', path: 'a.ts', line: 1, column: 1 }]) {
    expect((await g.source({ action: 'query', capture, query, cursor: null, limit: 1 })).status).toBe('error');
  }
  expect(calls).not.toHaveBeenCalled();
});

it('publishes one TS project protocol per trusted mode while retaining the full old wire and live stale checks', async () => {
  const f = await fixture(imports(3));
  const frozen = f.group(), legacy = f.group({ projectSource: { mode: 'legacy_live' } }), implicit = f.group({});
  const names = (group: typeof frozen) => group.tools.map(tool => tool.name);
  expect(names(frozen)).toContain('project_source'); expect(names(frozen)).not.toContain('project_index');
  expect(names(legacy)).toContain('project_index'); expect(names(legacy)).not.toContain('project_source');
  expect(names(implicit)).toEqual(names(legacy));
  const definition = frozen.tools.find(tool => tool.name === 'project_source')!;
  expect(definition).toMatchObject({ effectClass: 'read_only', requiredCapabilities: ['workspace_read'], defaultTimeoutMs: 60000, outputLimitBytes: 64 * 1024 });
  const oracle = f.legacyOracle(), query = { operation: 'imports' as const, offset: 0, limit: 1 };
  const first = json<ProjectSourcePage>(await legacy.run('project_index', query));
  expect(first).toEqual(await oracle.query(query));
  const next = { ...query, offset: 1, expectedSnapshot: first.snapshot };
  expect(json(await legacy.run('project_index', next))).toEqual(await oracle.query(next));
  await f.write('a.ts', 'export const replacement = 1;');
  const stale = json(await legacy.run('project_index', next));
  expect(stale).toMatchObject({ status: 'stale' });
  expect(stale).toEqual(await oracle.query(next));
  expect(f.count.opens).toBe(0); // legacy is genuinely separate, not silently reinterpreted capture paging
});

it('bounds model metadata explicitly while internal capture material keeps full Unicode values and exact lists', async () => {
  const source = Array.from({ length: 100 }, (_, index) => `import${JSON.stringify(`absent-${index}-${'🙂'.repeat(180)}`)};`).join('\n');
  const f = await fixture(source);
  for (let index = 0; index < 7; index++) await f.write(`extra${index}.ts`, `export const x${index} = ${index};`);
  const g = f.group(), model = success<ModelCapture>(await g.source({ action: 'capture' }));
  const material = ready(await f.core.tools.exportCapture(f.context(), model.ref));
  expect(Buffer.byteLength(JSON.stringify(material.summary.coverage.unresolved))).toBeGreaterThan(60 * 1024);
  for (const [sample, full] of [
    [model.coverage.unresolved, material.summary.coverage.unresolved],
    [model.changes.added, material.summary.changes.added],
    [model.changes.modified, material.summary.changes.modified],
    [model.changes.deleted, material.summary.changes.deleted],
  ] as const) {
    expect(sample.count).toBe(full.length);
    expect(sample.sample).toEqual(full.slice(0, 5).map(value => Array.from(value).slice(0, 160).join('')));
    expect(sample.truncated).toBe(full.length > 5 || full.slice(0, 5).some(value => Array.from(value).length > 160));
    expect(sample.sample.every(value => Array.from(value).length <= 160)).toBe(true);
  }
  expect(model.coverage.unresolved).toMatchObject({ count: 100, truncated: true });
  expect(model.changes.added).toMatchObject({ count: 9, truncated: true });
  expect(material.summary.coverage.unresolved.every(value => value.includes('🙂'.repeat(180)))).toBe(true);
  const page = success<ModelPage>(await g.source({ action: 'query', capture: model.ref, query: { kind: 'imports' }, cursor: null, limit: 1 }));
  expect(page.coverage.unresolved).toEqual(model.coverage.unresolved);
  expect(page.items[0]).toMatchObject({ kind: 'relation', relation: { expression: `absent-0-${'🙂'.repeat(180)}` } });
});

it('marks a single shortened Unicode metadata item as truncated even without a count overflow', async () => {
  const f = await fixture(imports(1, '🙂'.repeat(180))), g = f.group();
  const capture = success<ModelCapture>(await g.source({ action: 'capture' }));
  expect(capture.coverage.unresolved).toMatchObject({ count: 1, truncated: true });
  expect(capture.coverage.unresolved.sample).toHaveLength(1);
  expect(Array.from(capture.coverage.unresolved.sample[0]!).length).toBe(160);
  expect(capture.changes.modified).toEqual(emptySample());
});

it('rejects an oversized real result page without clipping items or consuming the input cursor', async () => {
  const f = await fixture(imports(101, '🙂'.repeat(220))), g = f.group();
  const capture = success<ModelCapture>(await g.source({ action: 'capture' })).ref;
  const first = success<ModelPage>(await g.source({ action: 'query', capture, query: { kind: 'imports' }, cursor: null, limit: 1 }));
  expect(first.nextCursor).not.toBeNull();
  const request = { capture, query: { kind: 'imports' as const }, cursor: first.nextCursor, limit: 100 };
  const raw = ready(await f.core.tools.querySource(f.context(), request));
  expect(Buffer.byteLength(JSON.stringify(raw.items))).toBeGreaterThan(60 * 1024);
  expect(raw.items).toHaveLength(100);
  expect((await g.source({ action: 'query', ...request })).status).toBe('error');
  const retried = success<ModelPage>(await g.source({ action: 'query', ...request, limit: 1 }));
  expect(retried.items).toEqual(raw.items.slice(0, 1));
  expect(retried).toMatchObject({ complete: false, currentness: 'not_rechecked' });
  expect(retried.nextCursor).not.toBeNull();
});

it('releases an undisclosed successful capture when the post-read guard fails, preserving its slot and cleanup authority', async () => {
  const f = await fixture(imports(2), { maxRetainedCaptures: 1 });
  let guardCalls = 0;
  const g = f.group({ projectSource: { mode: 'frozen', access: f.runtime }, assertCurrent: async () => {
    if (++guardCalls === 2) throw Error('review basis changed after capture');
  } });
  const captures = vi.spyOn(f.core.tools, 'captureSourceChanges'), releases = vi.spyOn(f.core.tools, 'releaseCapture');
  expect((await g.source({ action: 'capture' })).status).toBe('error');
  expect(captures).toHaveBeenCalledTimes(1);
  expect(releases).toHaveBeenCalledTimes(1);
  const [cleanupContext, undisclosed] = releases.mock.calls[0]!;
  const [originalContext] = captures.mock.calls[0]!;
  expect(cleanupContext.principal).toEqual(originalContext.principal);
  expect(cleanupContext.materialReader).toEqual(originalContext.materialReader);
  expect(cleanupContext.projectId).toBe(originalContext.projectId);
  expect(cleanupContext.workspaceId).toBe(originalContext.workspaceId);
  expect(cleanupContext.signal).not.toBe(originalContext.signal);
  expect(cleanupContext.signal.aborted).toBe(false);
  expect(await f.core.tools.querySource(f.context(), { capture: undisclosed, query: { kind: 'imports' }, cursor: null, limit: 1 })).toMatchObject({ status: 'rejected', code: 'capture_expired' });
  expect(success<ModelCapture>(await g.source({ action: 'capture' })).ref.captureId).not.toBe(undisclosed.captureId);
});
