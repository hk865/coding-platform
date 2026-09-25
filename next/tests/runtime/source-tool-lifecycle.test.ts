import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as kernel from '../../vendor/coding-agent/dist/public-api.js';
import type { RuntimeSourceCaptureAccess } from '../../src/core/agent-runtime/source-tool-ports.js';
import type { WorkspaceToolsPort } from '../../src/core/workspace/ports.js';
import { runObservedModel, type ObservedModelRunOptions } from '../../src/core/agent-runtime/observed-model-run.js';
import { createExplorationTools } from '../../src/core/agent-runtime/exploration-tools.js';
import { ModelBudget, DEFAULT_RUNTIME_BUDGET } from '../../src/core/agent-runtime/model-budget.js';
import { ProjectSourceIndex } from '../../src/core/workspace/project-source-index.js';
import { PythonSourceIndex } from '../../src/core/workspace/python-source-index.js';

const resources = vi.hoisted(() => ({
  groups: [] as Array<{
    closeCalls: number;
    original: { tools: kernel.ToolDefinition[]; close(): Promise<void> };
  }>,
  groupCloseFailure: undefined as Error | undefined,
}));

// Observe the public ownership boundary, while every tool and its actual cleanup stays real.
vi.mock('../../src/core/agent-runtime/exploration-tools.js', async importOriginal => {
  const original = await importOriginal<typeof import('../../src/core/agent-runtime/exploration-tools.js')>();
  return {
    ...original,
    createExplorationTools: (...args: Parameters<typeof original.createExplorationTools>) => {
      const handle = original.createExplorationTools(...args);
      const observed = { closeCalls: 0, original: handle };
      resources.groups.push(observed);
      return {
        tools: handle.tools,
        async close() {
          observed.closeCalls++;
          await handle.close();
          if (resources.groupCloseFailure) throw resources.groupCloseFailure;
        },
      };
    },
  };
});

const roots: string[] = [];
const ownedAccess: RuntimeSourceCaptureAccess[] = [];
beforeEach(() => { resources.groups.length = 0; resources.groupCloseFailure = undefined; });
afterEach(async () => {
  await Promise.allSettled(resources.groups.map(group => group.original.close()));
  await Promise.allSettled(ownedAccess.splice(0).map(access => access.close()));
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}

function sourceCapability() {
  const workspace = { aggregateType: 'Workspace' as const, projectId: 'lifecycle-project', workspaceId: 'lifecycle-workspace' };
  const unavailable = async () => ({ status: 'rejected' as const, code: 'unsupported' as const, reason: 'this lifecycle fixture has no source provider' });
  const port: WorkspaceToolsPort = {
    captureSourceChanges: unavailable, querySource: unavailable, exportCapture: unavailable,
    verifyCapture: unavailable, releaseCapture: unavailable, captureArchitectureSource: unavailable,
    readWorkspace: unavailable, compareWorkspace: unavailable,
  };
  const state = { closeFailure: undefined as Error | undefined };
  // This is an explicitly granted test Host capability, not a fabricated production Run.
  const close = vi.fn(async () => { if (state.closeFailure) throw state.closeFailure; });
  const access: RuntimeSourceCaptureAccess = {
    port, workspace,
    context: signal => ({
      projectId: workspace.projectId, workspaceId: workspace.workspaceId,
      principal: { kind: 'host', actor: { kind: 'human', id: 'test-host-grantee' } },
      materialReader: { kind: 'host', projectId: workspace.projectId, workspaceId: workspace.workspaceId, actor: { kind: 'human', id: 'test-host-grantee' } },
      signal,
    }),
    currentWorkspaceRevision: async signal => { signal.throwIfAborted(); return { status: 'ready', value: 1 }; },
    close,
  };
  ownedAccess.push(access);
  const open = vi.fn(async (signal: AbortSignal) => { signal.throwIfAborted(); return access; });
  return { access, port, state, close, open };
}

function finalClient(beforeAnswer?: (request: kernel.ModelRequest) => void | Promise<void>): kernel.ModelClientPort {
  return { async *stream(request) {
    await beforeAnswer?.(request);
    const common = { schemaVersion: 1 as const, requestId: request.requestId };
    yield { ...common, sequence: 1, type: 'text_delta', delta: 'Lifecycle protocol witness.' };
    yield { ...common, sequence: 2, type: 'completed', reason: 'final_answer' };
  } };
}

async function fixture(client: kernel.ModelClientPort = finalClient()) {
  const root = await mkdtemp(join(tmpdir(), 'source-tool-lifecycle-workspace-'));
  const storage = await mkdtemp(join(tmpdir(), 'source-tool-lifecycle-storage-'));
  roots.push(root, storage);
  await writeFile(join(root, 'source.ts'), 'export const evidence = 1;\n');
  const source = sourceCapability();
  const budget = { ...DEFAULT_RUNTIME_BUDGET, perResponseTokens: 128 };
  const meter = new ModelBudget(budget, async () => {}, {
    count: () => ({ tokens: 100, method: 'model_tokenizer', tokenizer: 'labelled-lifecycle-test-counter' }),
  });
  const options: ObservedModelRunOptions = {
    kernel, bound: {
      configuration: { revision: 'lifecycle-test', provider: 'deepseek', model: 'labelled-local-lifecycle-client', baseUrl: 'http://127.0.0.1' }, client,
    },
    root, databasePath: join(storage, 'kernel.sqlite'), sessionId: 'source-tool-lifecycle',
    input: 'Return a short lifecycle test witness.', budget, meter, readOnly: true,
    signal: new AbortController().signal, deniedPrefixes: [], processSandboxOptions: {}, publish: async () => {},
    projectSource: { mode: 'frozen', open: source.open },
  };
  return { root, source, options };
}

it('holds tools and source access until the actual Kernel/model promise settles, then closes each once', async () => {
  const entered = deferred(), finish = deferred();
  const f = await fixture(finalClient(async request => {
    expect(request.tools.map(tool => tool.name)).toContain('project_source');
    expect(request.tools.map(tool => tool.name)).not.toContain('project_index');
    entered.resolve(); await finish.promise;
  }));
  const pythonDispose = vi.spyOn(PythonSourceIndex.prototype, 'dispose');
  const pending = runObservedModel(f.options);
  await entered.promise;
  try {
    expect(f.source.open).toHaveBeenCalledTimes(1);
    expect(resources.groups).toHaveLength(1);
    expect(resources.groups[0]!.closeCalls).toBe(0);
    expect(f.source.close).not.toHaveBeenCalled();
    expect(pythonDispose).not.toHaveBeenCalled();
  } finally { finish.resolve(); }
  expect((await pending).state.status).toBe('completed');
  expect(resources.groups[0]!.closeCalls).toBe(1);
  expect(pythonDispose).toHaveBeenCalledTimes(1);
  expect(f.source.close).toHaveBeenCalledTimes(1);
}, 60_000);

it('closes resources after a real Kernel loop records the local model failure', async () => {
  const failure = new Error('labelled local model failure');
  const f = await fixture({ async *stream() { throw failure; } });
  const result = await runObservedModel(f.options);
  expect(result.state.status).toBe('failed');
  expect(JSON.stringify(result.state)).toContain(failure.message);
  expect(resources.groups).toHaveLength(1);
  expect(resources.groups[0]!.closeCalls).toBe(1);
  expect(f.source.close).toHaveBeenCalledTimes(1);
}, 60_000);

it('preserves a failed Kernel result when cleanup also fails, while attempting every close', async () => {
  const original = new Error('original local model failure before cleanup');
  const f = await fixture({ async *stream() { throw original; } });
  resources.groupCloseFailure = new Error('secondary group cleanup failure');
  f.source.state.closeFailure = new Error('secondary source cleanup failure');
  const result = await runObservedModel(f.options);
  expect(result.state.status).toBe('failed');
  expect(JSON.stringify(result.state)).toContain(original.message);
  expect(resources.groups).toHaveLength(1);
  expect(resources.groups[0]!.closeCalls).toBe(1);
  expect(f.source.close).toHaveBeenCalledTimes(1);
}, 60_000);

it('closes the already-created source tools when the following material tool factory throws', async () => {
  const failure = new Error('material tool initialization failed');
  const f = await fixture();
  const pythonDispose = vi.spyOn(PythonSourceIndex.prototype, 'dispose');
  await expect(runObservedModel({ ...f.options, materialTools: () => {
    expect(resources.groups).toHaveLength(1);
    throw failure;
  } })).rejects.toBe(failure);
  expect(resources.groups[0]!.closeCalls).toBe(1);
  expect(pythonDispose).toHaveBeenCalledTimes(1);
  expect(f.source.close).toHaveBeenCalledTimes(1);
}, 60_000);

it.each(['configuration', 'kernel_initialization'] as const)('releases all resources acquired before %s fails', async stage => {
  const failure = new Error(`${stage} failed`);
  const f = await fixture();
  const failingKernel: typeof kernel = stage === 'configuration'
    ? { ...kernel, loadAppConfig: async () => { throw failure; } }
    : { ...kernel, runCodingAgent: async () => { throw failure; } };
  await expect(runObservedModel({ ...f.options, kernel: failingKernel })).rejects.toBe(failure);
  // Configuration may legitimately be loaded before allocating the source capability.
  expect(f.source.open.mock.calls.length).toBeLessThanOrEqual(1);
  if (stage === 'kernel_initialization') expect(f.source.open).toHaveBeenCalledTimes(1);
  expect(f.source.close.mock.calls.length).toBe(f.source.open.mock.calls.length);
  for (const group of resources.groups) expect(group.closeCalls).toBe(1);
});

it.each([false, true])('does not open or register source capabilities without read permission (pinned=%s)', async pinned => {
  const requests: kernel.ModelRequest[] = [];
  const f = await fixture(finalClient(request => { requests.push(request); }));
  const result = await runObservedModel({ ...f.options, allowedTools: [],
    ...(pinned ? { sourceTools: { includeReadSource: true } } : {}) });
  expect(result.state.status).toBe('completed');
  expect(requests).toHaveLength(1);
  expect(requests[0]!.tools).toEqual([]);
  expect(f.source.open).not.toHaveBeenCalled();
  expect(f.source.close).not.toHaveBeenCalled();
  expect(resources.groups).toHaveLength(0);
}, 60_000);

it('attempts every cleanup and preserves the original initialization error even when both closes fail', async () => {
  const original = new Error('original material initialization failure');
  const f = await fixture();
  resources.groupCloseFailure = new Error('tool group cleanup failed');
  f.source.state.closeFailure = new Error('source access cleanup failed');
  await expect(runObservedModel({ ...f.options, materialTools: () => { throw original; } })).rejects.toBe(original);
  expect(resources.groups).toHaveLength(1);
  expect(resources.groups[0]!.closeCalls).toBe(1);
  expect(f.source.close).toHaveBeenCalledTimes(1);
}, 60_000);

it.each(['group', 'source'] as const)('reports a %s cleanup failure instead of returning a successful run', async which => {
  const f = await fixture();
  const failure = new Error(`${which} cleanup failed`);
  if (which === 'group') resources.groupCloseFailure = failure;
  else f.source.state.closeFailure = failure;
  await expect(runObservedModel(f.options)).rejects.toThrow();
  expect(resources.groups).toHaveLength(1);
  expect(resources.groups[0]!.closeCalls).toBe(1);
  expect(f.source.close).toHaveBeenCalledTimes(1);
}, 60_000);

it('closes legacy language services once and refuses new handlers after the tool group closes', async () => {
  const f = await fixture();
  const workspace = await kernel.WorkspaceSandbox.create(f.root);
  const projectDispose = vi.spyOn(ProjectSourceIndex.prototype, 'dispose');
  const pythonDispose = vi.spyOn(PythonSourceIndex.prototype, 'dispose');
  const group = createExplorationTools(workspace, { projectSource: { mode: 'legacy_live' } });
  const project = group.tools.find(tool => tool.name === 'project_index');
  expect(project).toBeDefined();
  await group.close();
  await group.close();
  expect(projectDispose).toHaveBeenCalledTimes(1);
  expect(pythonDispose).toHaveBeenCalledTimes(1);
  const result = await project!.handler.execute(
    { schemaVersion: 1, callId: 'after-close', name: 'project_index', arguments: { operation: 'imports' } },
    { signal: new AbortController().signal },
  );
  expect(result.status).not.toBe('success');
  expect(f.source.close).not.toHaveBeenCalled();
});

it('reports actual index disposal failure, attempts the other index and keeps close idempotent', async () => {
  const f = await fixture();
  const workspace = await kernel.WorkspaceSandbox.create(f.root);
  const failure = new Error('actual TS service disposal failed');
  const projectDispose = vi.spyOn(ProjectSourceIndex.prototype, 'dispose').mockImplementation(() => { throw failure; });
  const pythonDispose = vi.spyOn(PythonSourceIndex.prototype, 'dispose');
  const group = createExplorationTools(workspace, { projectSource: { mode: 'legacy_live' } });
  await expect(group.close()).rejects.toThrow(failure.message);
  await expect(group.close()).rejects.toThrow(failure.message);
  expect(projectDispose).toHaveBeenCalledTimes(1);
  expect(pythonDispose).toHaveBeenCalledTimes(1);
  expect(f.source.close).not.toHaveBeenCalled();
});

it('cancels and waits for an in-flight source handler without closing the externally owned access', async () => {
  const f = await fixture();
  const workspace = await kernel.WorkspaceSandbox.create(f.root);
  const entered = deferred(), finish = deferred();
  let capturedSignal: AbortSignal | undefined;
  let captureCalls = 0, exited = false;
  f.source.port.captureSourceChanges = async (ctx, input) => {
    expect(input.workspace).toEqual(f.source.access.workspace);
    expect(ctx.principal).toEqual({ kind: 'host', actor: { kind: 'human', id: 'test-host-grantee' } });
    capturedSignal = ctx.signal; captureCalls++; entered.resolve();
    await finish.promise;
    exited = true;
    return { status: 'rejected', code: ctx.signal.aborted ? 'cancelled' : 'unsupported', reason: 'controlled source request completed' };
  };
  const pythonDispose = vi.spyOn(PythonSourceIndex.prototype, 'dispose');
  const group = createExplorationTools(workspace, { projectSource: { mode: 'frozen', access: f.source.access } });
  const source = group.tools.find(tool => tool.name === 'project_source');
  expect(source).toBeDefined();
  const call: kernel.ToolCall = { schemaVersion: 1, callId: 'capture-in-flight', name: 'project_source', arguments: { action: 'capture' } };
  const pending = source!.handler.execute(call, { signal: new AbortController().signal });
  await entered.promise;
  let closed = false;
  const closing = group.close().then(() => { closed = true; });
  try {
    await Promise.resolve();
    expect(capturedSignal?.aborted).toBe(true);
    expect(closed).toBe(false);
    expect(exited).toBe(false);
    expect(pythonDispose).not.toHaveBeenCalled();
    const rejected = await source!.handler.execute({ ...call, callId: 'capture-after-close' }, { signal: new AbortController().signal });
    expect(rejected.status).not.toBe('success');
    expect(captureCalls).toBe(1);
  } finally { finish.resolve(); }
  expect((await pending).status).toBe('cancelled');
  await closing;
  expect(exited).toBe(true);
  expect(closed).toBe(true);
  expect(pythonDispose).toHaveBeenCalledTimes(1);
  expect(f.source.close).not.toHaveBeenCalled();
  await f.source.access.close();
  expect(f.source.close).toHaveBeenCalledTimes(1);
});
