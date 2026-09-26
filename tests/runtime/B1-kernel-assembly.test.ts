/**
 * B1 skeleton/test lane: the Kernel assembly seam reused by the existing model loop.
 *
 * These cases describe the frozen B1 interface (trusted `controlHooks`, trusted `skills`,
 * `projectSource.openOn: 'first_use'`). At this skeleton stage the production files only declare
 * the types and reject explicit use with `code: 'unsupported'`, so every case is red for that
 * explicit reason; this file is the contract the accepted implementation must satisfy. Real
 * frozen Kernel + SQLite and a local scripted model only, never the network.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as kernel from '../../vendor/coding-agent/dist/public-api.js';
import { DEFAULT_RUNTIME_BUDGET, ModelBudget } from '../../src/core/agent-runtime/model-budget.js';
import { runObservedModel, type ObservedModelRunOptions } from '../../src/core/agent-runtime/observed-model-run.js';
import { createProjectSourceTool } from '../../src/core/agent-runtime/project-source-tool.js';
import type { RuntimeSourceCaptureAccess } from '../../src/core/agent-runtime/source-tool-ports.js';
import type { CaptureSummary, WorkspaceResult, WorkspaceToolsPort } from '../../src/core/workspace/ports.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

const SKILL_MARKER = 'B1_TRUSTED_SKILL_MARKER_ONLY';
const CODING_SAFETY_ID = 'coding-safety';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}

async function tempWorkspace(name: string) {
  const directory = await mkdtemp(join(tmpdir(), `next-b1-${name}-`));
  directories.push(directory);
  const root = join(directory, 'workspace');
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'a.ts'), 'export const a = 1;\n');
  return { directory, root, databasePath: join(directory, 'kernel.sqlite'), sessionId: `b1-${name}` };
}

/** Write one skill in the exact FileSkillLoader manifest/content format the Kernel loads. */
async function writeTrustedSkill(resourceRoot: string, id: string, content: string): Promise<void> {
  await mkdir(join(resourceRoot, id), { recursive: true });
  await writeFile(join(resourceRoot, id, 'skill.json'), JSON.stringify({
    schemaVersion: 1, id, title: id, kind: 'instruction', priority: 10, contentFile: 'content.md',
  }));
  await writeFile(join(resourceRoot, id, 'content.md'), `${content}\n`);
}

type ScriptReply =
  | { kind: 'text'; text: string }
  | { kind: 'calls'; calls: ReadonlyArray<{ callId: string; name: string; args: Record<string, unknown> }> };

function scriptedClient(
  replies: readonly ScriptReply[],
  onRequest?: (request: kernel.ModelRequest, round: number) => void,
) {
  let round = 0;
  const requests: kernel.ModelRequest[] = [];
  const client: kernel.ModelClientPort = {
    async *stream(request, options) {
      options.signal.throwIfAborted();
      const index = round++;
      const snapshot = structuredClone(request);
      requests.push(snapshot);
      onRequest?.(snapshot, index);
      const reply = replies[index];
      if (!reply) throw new Error(`B1 scripted model ran out of replies at round ${index}`);
      const base = { schemaVersion: 1 as const, requestId: request.requestId };
      let sequence = 0;
      if (reply.kind === 'text') {
        yield { ...base, sequence: ++sequence, type: 'text_delta', delta: reply.text };
        yield { ...base, sequence: ++sequence, type: 'completed', reason: 'final_answer' };
        return;
      }
      for (const [ordinal, call] of reply.calls.entries()) {
        yield { ...base, sequence: ++sequence, type: 'tool_call_started', callId: call.callId, name: call.name, ordinal };
        yield { ...base, sequence: ++sequence, type: 'tool_arguments_delta', callId: call.callId, delta: JSON.stringify(call.args) };
      }
      yield { ...base, sequence: ++sequence, type: 'completed', reason: 'tool_calls' };
    },
  };
  return { client, requests };
}

function baseOptions(root: string, databasePath: string, sessionId: string, client: kernel.ModelClientPort): ObservedModelRunOptions {
  const budget = { ...DEFAULT_RUNTIME_BUDGET, contextWindowTokens: 200_000, perResponseTokens: 512, maxRequests: 12, maxToolCalls: 16, timeoutMs: 30_000 };
  return {
    kernel,
    bound: { configuration: { revision: 'b1-local', provider: 'deepseek', model: 'b1-local-scripted', baseUrl: 'http://127.0.0.1' }, client },
    meter: new ModelBudget(budget, async () => {}, {
      count: () => ({ tokens: 256, method: 'model_tokenizer', tokenizer: 'b1-labelled-local-counter' }),
    }),
    root, databasePath, sessionId, input: 'B1 local scripted turn.', budget,
    readOnly: true, signal: new AbortController().signal,
    deniedPrefixes: [], processSandboxOptions: {}, publish: async () => {},
  };
}

/** Trusted test Host capability. Only the open/close timing and the real WorkspaceTools calls are asserted. */
function sourceCapability(capture?: WorkspaceToolsPort['captureSourceChanges']) {
  const workspace = { aggregateType: 'Workspace' as const, projectId: 'b1-project', workspaceId: 'b1-workspace' };
  const unavailable = async () => ({ status: 'rejected' as const, code: 'unsupported' as const, reason: 'B1 trusted fixture has no provider' });
  const captureSourceChanges = vi.fn(capture ?? unavailable);
  const close = vi.fn(async () => {});
  const port: WorkspaceToolsPort = {
    captureSourceChanges, querySource: unavailable, exportCapture: unavailable,
    verifyCapture: unavailable, releaseCapture: unavailable, captureArchitectureSource: unavailable,
    readWorkspace: unavailable, compareWorkspace: unavailable,
  };
  const access: RuntimeSourceCaptureAccess = {
    port, workspace,
    context: signal => ({
      projectId: workspace.projectId, workspaceId: workspace.workspaceId,
      principal: { kind: 'host', actor: { kind: 'human', id: 'b1-host-reader' } },
      materialReader: { kind: 'host', projectId: workspace.projectId, workspaceId: workspace.workspaceId, actor: { kind: 'human', id: 'b1-host-reader' } },
      signal,
    }),
    currentWorkspaceRevision: async signal => { signal.throwIfAborted(); return { status: 'ready', value: 1 }; },
    close,
  };
  return { workspace, port, access, close, captureSourceChanges };
}

function captureSummary(): CaptureSummary {
  return {
    ref: { projectId: 'b1-project', workspaceId: 'b1-workspace', captureId: 'b1-capture', workspaceRevision: 1,
      sourceDigest: 'a'.repeat(64), configDigest: 'b'.repeat(64), indexVersion: 'b1-index@1' },
    capturedAt: '2026-09-25T00:00:00.000Z', verifiedAt: '2026-09-25T00:00:00.000Z',
    commitHash: null, expiresAt: '2026-09-25T01:00:00.000Z',
    coverage: {
      provider: 'typescript', engine: 'b1-test-engine', engineVersion: '1', projectConfiguration: null,
      sourceCount: 1, indexedSourceCount: 1, permissionFiltered: true,
      scope: { kind: 'typescript_project_inputs', selectionVersion: 'ts-js-json-v1', prefix: null, digestBasis: 'decoded_utf8' },
      complete: true, unresolved: [], filesystemAtomic: false, fullRuntimeCallGraph: false,
    },
    changes: { added: ['a.ts'], modified: [], deleted: [] },
  };
}

/** Read Kernel original history through the public SqliteStores reader. */
async function readSessionRecords(databasePath: string, sessionId: string): Promise<kernel.SessionRecord[]> {
  const store = await kernel.SqliteStores.open(databasePath);
  try {
    const records: kernel.SessionRecord[] = [];
    let after = 0;
    for (;;) {
      const page = await store.read(sessionId, after, 256, { signal: new AbortController().signal });
      records.push(...page.records);
      if (page.nextPosition === null) return records;
      after = page.records.at(-1)?.position ?? after;
    }
  } finally {
    await store.close();
  }
}

function toolResult(request: kernel.ModelRequest, callId: string): kernel.ToolResult {
  const message = request.messages.find(candidate => candidate.role === 'tool' && candidate.callId === callId);
  expect(message, `missing Kernel tool result for ${callId}`).toBeDefined();
  if (!message || message.role !== 'tool') throw Error(`missing Kernel tool result for ${callId}`);
  return message.result;
}

function jsonOutput(result: kernel.ToolResult): unknown {
  const output = result.output.find(block => block.kind === 'json');
  if (!output || output.kind !== 'json') throw Error('tool result has no JSON output');
  return output.value;
}

describe('B1 Kernel assembly seam', () => {
  it('uses the trusted skill resource config verbatim, including an explicit empty list, and snapshots it before awaits', async () => {
    const w = await tempWorkspace('skills');
    const skillRoot = join(w.directory, 'skills');
    await writeTrustedSkill(skillRoot, 'b1-fixture', SKILL_MARKER);

    const { client, requests } = scriptedClient([
      { kind: 'text', text: 'custom skill answer' },
      { kind: 'text', text: 'explicit empty skills answer' },
      { kind: 'text', text: 'snapshot answer' },
    ]);
    const base = baseOptions(w.root, w.databasePath, w.sessionId, client);

    // 1. The trusted custom skill resource reaches the real model system prompt.
    await runObservedModel({ ...base, input: 'custom skill turn', skills: { resourceRoot: skillRoot, enabledIds: ['b1-fixture'] } });
    expect(requests[0]!.systemPrompt).toContain(SKILL_MARKER);
    expect(requests[0]!.systemPrompt).not.toContain(CODING_SAFETY_ID);

    // 2. An explicit empty enabledIds must select nothing; it must not secretly fall back to coding-safety.
    await runObservedModel({ ...base, input: 'explicit empty skills turn', skills: { resourceRoot: skillRoot, enabledIds: [] } });
    expect(requests[1]!.systemPrompt).not.toContain(SKILL_MARKER);
    expect(requests[1]!.systemPrompt).not.toContain(CODING_SAFETY_ID);

    // 3. The mutable trusted fields are snapshotted before the first await; later mutation is ignored.
    const mutableSkills = { resourceRoot: skillRoot, enabledIds: ['b1-fixture'] };
    const pending = runObservedModel({ ...base, input: 'snapshot skills turn', skills: mutableSkills });
    mutableSkills.enabledIds.length = 0;
    mutableSkills.resourceRoot = join(w.directory, 'missing-after-mutation');
    await pending;
    expect(requests[2]!.systemPrompt).toContain(SKILL_MARKER);
  }, 60_000);

  it('awaits before_model, snapshots the hook list/metadata/execute before the first await, and sees run.started/turn.started', async () => {
    const w = await tempWorkspace('barrier');
    const source = sourceCapability();
    const open = vi.fn(async (signal: AbortSignal) => { signal.throwIfAborted(); return source.access; });
    const { client, requests } = scriptedClient([{ kind: 'text', text: 'after the barrier' }]);

    const entered = deferred();
    const release = deferred();
    let persistedTypes: string[] = [];
    let persistedRunStarted = false;
    let executed = 0;
    let thisRef: unknown;
    const hook: kernel.BeforeModelHookPort = {
      hookId: 'b1-snapshot-hook', point: 'before_model', priority: 0,
      async execute() {
        executed += 1;
        thisRef = this;
        const records = await readSessionRecords(w.databasePath, w.sessionId);
        persistedTypes = records.map(record => record.recordType);
        persistedRunStarted = records.some(record => record.recordType === 'agent.event'
          && (record.payload as { event?: { type?: string } }).event?.type === 'run.started');
        entered.resolve();
        await release.promise;
        return { point: 'before_model', kind: 'continue' };
      },
    };
    const hooks: kernel.HookPort[] = [hook];
    const replacement: kernel.HookPort = {
      hookId: 'b1-replacement-hook', point: 'before_model', priority: 0,
      async execute() { throw new Error('replacement hook must not run'); },
    };

    let pending: Promise<Awaited<ReturnType<typeof runObservedModel>>> | undefined;
    try {
      pending = runObservedModel({
        ...baseOptions(w.root, w.databasePath, w.sessionId, client),
        input: 'barrier turn',
        controlHooks: hooks,
        projectSource: { mode: 'frozen', open, openOn: 'first_use' },
      });
      // Mutations after the call and before the first await must not change the captured seam.
      hooks[0] = replacement;
      (hook as { hookId: string }).hookId = 'b1-mutated-hook-id';
      (hook as { point: string }).point = 'after_tool';
      hook.execute = async () => { throw new Error('mutated hook execute must not run'); };

      const first = await Promise.race([
        entered.promise.then(() => 'entered' as const),
        pending.then(() => { throw new Error('Run settled before the before_model barrier was entered'); }),
      ]);
      expect(first).toBe('entered');
      expect(executed).toBe(1);
      expect(thisRef).toBe(hook); // captured execute keeps its original receiver
      expect(requests).toHaveLength(0);
      expect(persistedTypes).toContain('turn.started');
      expect(persistedRunStarted).toBe(true);
      release.resolve();
      const result = await pending;
      expect(result.state.status).toBe('completed');
      expect(requests).toHaveLength(1);
      expect(open).not.toHaveBeenCalled(); // an unused first_use source is never opened
      expect(source.close).not.toHaveBeenCalled();
    } finally {
      release.resolve();
      await pending?.catch(() => {});
    }
  }, 60_000);

  it('pauses at before_model with zero model requests and no first_use source factory open', async () => {
    const w = await tempWorkspace('pause');
    const source = sourceCapability();
    const open = vi.fn(async (signal: AbortSignal) => { signal.throwIfAborted(); return source.access; });
    const { client, requests } = scriptedClient([{ kind: 'text', text: 'never delivered' }]);
    const hook: kernel.BeforeModelHookPort = {
      hookId: 'b1-pause', point: 'before_model', priority: 0,
      async execute() { return { point: 'before_model', kind: 'pause', reason: 'B1 test pause' }; },
    };

    const result = await runObservedModel({
      ...baseOptions(w.root, w.databasePath, w.sessionId, client),
      input: 'pause turn',
      controlHooks: [hook],
      projectSource: { mode: 'frozen', open, openOn: 'first_use' },
    });
    expect(result.state.status).toBe('paused');
    expect(requests).toHaveLength(0);
    expect(open).not.toHaveBeenCalled();
    expect(source.close).not.toHaveBeenCalled();
  }, 60_000);

  it('shares one suspended first_use open across parallel calls and delivers the real captured payload to the model', async () => {
    const w = await tempWorkspace('first-use');
    const source = sourceCapability(async (): Promise<WorkspaceResult<CaptureSummary>> => ({ status: 'ready', value: captureSummary() }));
    const openControl = deferred<RuntimeSourceCaptureAccess>();
    const openCalled = deferred();
    const open = vi.fn((signal: AbortSignal) => { signal.throwIfAborted(); openCalled.resolve(); return openControl.promise; });
    const projectSource = { mode: 'frozen' as const, open, openOn: 'first_use' as const };
    const { client, requests } = scriptedClient([
      { kind: 'calls', calls: [
        { callId: 'capture-one', name: 'project_source', args: { action: 'capture' } },
        { callId: 'capture-two', name: 'project_source', args: { action: 'capture' } },
      ] },
      { kind: 'text', text: 'captured' },
    ]);

    let pending: Promise<Awaited<ReturnType<typeof runObservedModel>>> | undefined;
    try {
      pending = runObservedModel({
        ...baseOptions(w.root, w.databasePath, w.sessionId, client),
        input: 'first use turn',
        projectSource,
      });
      projectSource.open = vi.fn(() => { throw Error('mutated source factory must not run'); });
      const opened = await Promise.race([
        openCalled.promise.then(() => 'opened' as const),
        pending.then(() => { throw new Error('Run settled before the first_use source opened'); }),
      ]);
      expect(opened).toBe('opened');
      // Opening must follow the first model tool request, never eager preparation.
      expect(requests).toHaveLength(1);
      expect(source.captureSourceChanges).not.toHaveBeenCalled();
      expect(source.close).not.toHaveBeenCalled();
      openControl.resolve(source.access); // both suspended parallel calls share this one open Promise
      const result = await pending;
      expect(result.state.status).toBe('completed');
      expect(open).toHaveBeenCalledTimes(1);
      expect(source.captureSourceChanges).toHaveBeenCalledTimes(2);
      expect(source.close).toHaveBeenCalledTimes(1);
      expect(requests[0]!.tools.map(tool => tool.name)).toContain('project_source');
      for (const request of requests) expect(request.tools.map(tool => tool.name)).not.toContain('project_index');
      // The real fixture payload (not just open/close counts) reaches the model's tool history.
      for (const callId of ['capture-one', 'capture-two']) {
        const delivered = toolResult(requests[1]!, callId);
        expect(delivered.status).toBe('success');
        expect(jsonOutput(delivered)).toMatchObject({
          status: 'ready',
          value: { ref: { captureId: 'b1-capture' }, changes: { added: { count: 1, sample: ['a.ts'] } } },
        });
      }
    } finally {
      openControl.resolve(source.access);
      await pending?.catch(() => {});
    }
  }, 60_000);

  it('drains a suspended first_use open on cancellation and closes the resolved access exactly once', async () => {
    // A per-tool cancellation while its currentness check is pending must not open a source.
    const checked = deferred(), finishCheck = deferred();
    const toolController = new AbortController();
    const unusedSource = sourceCapability();
    const resolver = vi.fn(async () => unusedSource.access);
    const tool = createProjectSourceTool({ access: resolver, requireVisible: () => {},
      assertCurrent: async () => { checked.resolve(); await finishCheck.promise; } });
    const toolPending = tool.handler.execute({ schemaVersion: 1, callId: 'cancel-before-open',
      name: 'project_source', arguments: { action: 'capture' } } as never,
    { signal: toolController.signal } as never);
    try {
      await checked.promise;
      toolController.abort();
      finishCheck.resolve();
      await toolPending;
      expect(resolver).not.toHaveBeenCalled();
    } finally { finishCheck.resolve(); await toolPending.catch(() => {}); }

    const w = await tempWorkspace('drain');
    const source = sourceCapability();
    const openControl = deferred<RuntimeSourceCaptureAccess>();
    const openCalled = deferred();
    const open = vi.fn((signal: AbortSignal) => { signal.throwIfAborted(); openCalled.resolve(); return openControl.promise; });
    const controller = new AbortController();
    const { client } = scriptedClient([
      { kind: 'calls', calls: [{ callId: 'drain-capture', name: 'project_source', args: { action: 'capture' } }] },
      { kind: 'text', text: 'unreachable after cancellation' },
    ]);

    let pending: Promise<Awaited<ReturnType<typeof runObservedModel>>> | undefined;
    try {
      pending = runObservedModel({
        ...baseOptions(w.root, w.databasePath, w.sessionId, client),
        input: 'drain turn', signal: controller.signal,
        projectSource: { mode: 'frozen', open, openOn: 'first_use' },
      });
      const opened = await Promise.race([
        openCalled.promise.then(() => 'opened' as const),
        pending.then(() => { throw new Error('Run settled before the first_use source opened'); }),
      ]);
      expect(opened).toBe('opened');
      controller.abort();
      // The Run must wait for this suspended open (and its in-flight tool) before closing; only then does it settle.
      openControl.resolve(source.access);
      let settled: unknown;
      let rejected: unknown;
      try { settled = await pending; } catch (error) { rejected = error; }
      expect(settled ?? rejected).toBeDefined();
      expect(open).toHaveBeenCalledTimes(1);
      expect(source.close).toHaveBeenCalledTimes(1); // the access resolved after cancellation is still closed once
    } finally {
      if (!controller.signal.aborted) controller.abort();
      openControl.resolve(source.access);
      await pending?.catch(() => {});
    }
  }, 60_000);

  it('reports a lazy open failure as a real tool result, reuses the one failed factory attempt in the next round, and keeps project_index out', async () => {
    const w = await tempWorkspace('lazy-failure');
    const source = sourceCapability();
    // Factories may throw before returning a Promise; this failure must also be cached.
    const open = vi.fn((signal: AbortSignal): Promise<RuntimeSourceCaptureAccess> => { signal.throwIfAborted(); throw Object.assign(new Error('B1 lazy open failure'), { code: 'unsupported' }); });
    const { client, requests } = scriptedClient([
      { kind: 'calls', calls: [
        { callId: 'fail-one', name: 'project_source', args: { action: 'capture' } },
        { callId: 'fail-two', name: 'project_source', args: { action: 'capture' } },
      ] },
      { kind: 'calls', calls: [{ callId: 'fail-three', name: 'project_source', args: { action: 'capture' } }] },
      { kind: 'text', text: 'continued after the tool errors' },
    ]);

    // Kernel may surface a tool failure as an error result and continue; the Run must not be required to throw.
    const result = await runObservedModel({
      ...baseOptions(w.root, w.databasePath, w.sessionId, client),
      input: 'lazy failure turn',
      projectSource: { mode: 'frozen', open, openOn: 'first_use' },
    });
    expect(result.state.status).toBe('completed');
    expect(open).toHaveBeenCalledTimes(1); // two same-round calls plus the next round all reuse the one failed attempt
    expect(source.captureSourceChanges).not.toHaveBeenCalled(); // never reached a real provider
    expect(source.close).not.toHaveBeenCalled();
    expect(requests).toHaveLength(3);
    expect(requests[0]!.tools.map(tool => tool.name)).toContain('project_source');
    for (const request of requests) expect(request.tools.map(tool => tool.name)).not.toContain('project_index');
    for (const [index, callIds] of [[1, ['fail-one', 'fail-two']], [2, ['fail-three']]] as const) {
      for (const callId of callIds) {
        const delivered = toolResult(requests[index]!, callId);
        expect(delivered.status).toBe('error');
      }
    }
  }, 60_000);
});
