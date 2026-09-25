/**
 * Accepted R2e text-tool loop, migrated without the old Dispatch/Control harness.
 * The scripted local ModelClient is the only external substitute. A trusted test Host
 * binds a real WorkspaceTools capability; every model tool call goes through the
 * frozen Kernel public API, project_source, WorkspaceTools and the Kernel sandbox.
 * This does not assert Goal/Run admission or durable ModelRequestPermit recording.
 */
import { afterEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as kernel from '../../vendor/coding-agent/dist/public-api.js';
import type { SourceCaptureRef } from '../../src/contracts/core/source.js';
import type { WorkspaceRef } from '../../src/contracts/ledger.js';
import type { WorkspaceResult, WorkspaceFile, WorkspaceComparison, SourceHit, CaptureContentScope } from '../../src/core/workspace/ports.js';
import { createWorkspaceAccessFactory } from '../../src/core/workspace/access.js';
import { createWorkspaceTools, DEFAULT_WORKSPACE_LIMITS } from '../../src/core/workspace/workspace-tools.js';
import type { RuntimeSourceCaptureAccess } from '../../src/core/agent-runtime/source-tool-ports.js';
import { runObservedModel, type ObservedModelRunOptions } from '../../src/core/agent-runtime/observed-model-run.js';
import { ModelBudget, DEFAULT_RUNTIME_BUDGET } from '../../src/core/agent-runtime/model-budget.js';

const directories: string[] = [];
const openAccesses: RuntimeSourceCaptureAccess[] = [];
afterEach(async () => {
  await Promise.allSettled(openAccesses.splice(0).map(access => access.close()));
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

const workspace: WorkspaceRef = { aggregateType: 'Workspace', projectId: 'source-loop-project', workspaceId: 'source-loop-workspace' };
const digest = (content: string) => createHash('sha256').update(content).digest('hex');
const initialDocs: Record<string, string> = {
  'docs/README.md': 'topic: 原始文档\n',
  'docs/notes.txt': 'topic: notes remain stable\n',
  'docs/spec.api': 'topic: a deliberately unknown extension\n',
};
const updatedReadme = 'topic: 更新后的文档\n';
const textScope: CaptureContentScope = {
  kind: 'text_files', selectionVersion: 'readable-regular-utf8-no-nul-v1', prefix: 'docs', digestBasis: 'raw_bytes',
};
type Sample = { count: number; sample: string[]; truncated: boolean };
type CaptureWire = {
  ref: SourceCaptureRef;
  coverage: {
    provider: string; engine: string; projectConfiguration: string | null;
    sourceCount: number; indexedSourceCount: number; complete: boolean; scope: CaptureContentScope;
  };
  changes: { added: Sample; modified: Sample; deleted: Sample };
};
type PageWire = {
  capture: SourceCaptureRef; items: SourceHit[]; complete: boolean; nextCursor: string | null;
  observation: string; currentness: string;
};
type ToolCall = { id: string; input: Record<string, unknown> };
type ModelRound = (request: kernel.ModelRequest, context: { root: string; round: number }) => Promise<ToolCall[]>;

/** Decode only the JSON that the real Kernel inserted into the next model request. */
function delivered<T>(request: kernel.ModelRequest, callId: string): T {
  const message = request.messages.find(candidate => candidate.role === 'tool' && candidate.callId === callId);
  expect(message, `Missing Kernel result for ${callId}`).toBeDefined();
  if (!message || message.role !== 'tool') throw Error('Missing tool result');
  expect(message.result.status, JSON.stringify(message.result)).toBe('success');
  const output = message.result.output.find(part => part.kind === 'json');
  if (!output || output.kind !== 'json') throw Error('Tool result did not contain JSON');
  const result = output.value as unknown as WorkspaceResult<T>;
  expect(result.status, JSON.stringify(result)).toBe('ready');
  if (result.status !== 'ready') throw Error(`Source tool rejected: ${result.code}: ${result.reason}`);
  return result.value;
}

function expectFile(file: WorkspaceFile, content: string, version: WorkspaceFile['version']) {
  expect(file).toMatchObject({
    path: 'docs/README.md', content, digest: digest(content), sizeBytes: Buffer.byteLength(content),
    digestBasis: 'raw_bytes', version,
  });
  expect(Number.isFinite(Date.parse(file.readAt))).toBe(true);
}

async function fixture(name: string, respond: ModelRound, assertMaterialsCurrent?: () => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), `next-source-text-loop-${name}-`));
  directories.push(directory);
  const root = join(directory, 'source');
  await mkdir(join(root, 'docs'), { recursive: true });
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { module: 'esnext', moduleResolution: 'bundler' }, include: ['src/**/*.ts'],
  }));
  await writeFile(join(root, 'src/base.ts'), 'export function chosen() { return 19; }\n');
  await writeFile(join(root, 'src/use.ts'), 'import { chosen } from "./base";\nexport const answer = chosen();\n');
  for (const [path, content] of Object.entries(initialDocs)) await writeFile(join(root, path), content);

  // Explicit trusted test Host grant, scoped to one registered workspace and human actor.
  const host = createWorkspaceAccessFactory({
    async resolveRoot(requested) {
      return requested.projectId === workspace.projectId && requested.workspaceId === workspace.workspaceId
        ? { status: 'ready', value: { root, workspaceRevision: 1 } }
        : { status: 'rejected', code: 'forbidden', reason: 'unregistered test scope' };
    },
    async authorize(ctx, requested) {
      const actor = { kind: 'human', id: 'accepted-test-reader' } as const;
      if (ctx.projectId !== workspace.projectId || ctx.workspaceId !== workspace.workspaceId
          || requested.projectId !== workspace.projectId || requested.workspaceId !== workspace.workspaceId
          || ctx.principal.kind !== 'host' || ctx.principal.actor.kind !== actor.kind || ctx.principal.actor.id !== actor.id
          || ctx.materialReader.kind !== 'host' || ctx.materialReader.projectId !== workspace.projectId
          || ctx.materialReader.workspaceId !== workspace.workspaceId || ctx.materialReader.actor.kind !== actor.kind
          || ctx.materialReader.actor.id !== actor.id)
        return { status: 'rejected', code: 'forbidden', reason: 'no matching trusted test grant' };
      return { status: 'ready', value: { subjectKey: 'human:accepted-test-reader', permissionRevision: 'read-grant-1', allowsRead: () => true } };
    },
  });
  let closeCalls = 0;
  let sourceOpens = 0;
  let opened: RuntimeSourceCaptureAccess | undefined;
  const open = async (signal: AbortSignal): Promise<RuntimeSourceCaptureAccess> => {
    signal.throwIfAborted();
    sourceOpens++;
    const handle = createWorkspaceTools({ access: host, now: () => '2026-09-24T00:00:00.000Z', limits: DEFAULT_WORKSPACE_LIMITS });
    const access: RuntimeSourceCaptureAccess = {
      port: handle.tools,
      workspace,
      context: callSignal => ({
        projectId: workspace.projectId, workspaceId: workspace.workspaceId,
        principal: { kind: 'host', actor: { kind: 'human', id: 'accepted-test-reader' } },
        materialReader: { kind: 'host', projectId: workspace.projectId, workspaceId: workspace.workspaceId,
          actor: { kind: 'human', id: 'accepted-test-reader' } },
        signal: AbortSignal.any([signal, callSignal]),
      }),
      async currentWorkspaceRevision(callSignal) {
        callSignal.throwIfAborted();
        return { status: 'ready', value: 1 };
      },
      async close() { closeCalls++; await handle.close(); },
    };
    opened = access;
    openAccesses.push(access);
    return access;
  };

  const requests: kernel.ModelRequest[] = [];
  let modelFailure: unknown;
  const client: kernel.ModelClientPort = {
    async *stream(request): AsyncIterable<kernel.ModelEvent> {
      try {
        requests.push(structuredClone(request));
        expect(request.tools.map(tool => tool.name)).toContain('project_source');
        expect(request.tools.map(tool => tool.name)).not.toContain('project_index');
        expect(request.tools.some(tool => ['edit', 'shell'].includes(tool.name))).toBe(false);
        expect(sourceOpens).toBe(1);
        expect(closeCalls).toBe(0);
        const calls = await respond(request, { root, round: requests.length });
        const common = { schemaVersion: 1 as const, requestId: request.requestId };
        let sequence = 0;
        for (const [ordinal, call] of calls.entries()) {
          yield { ...common, sequence: ++sequence, type: 'tool_call_started', callId: call.id, name: 'project_source', ordinal };
          yield { ...common, sequence: ++sequence, type: 'tool_arguments_delta', callId: call.id, delta: JSON.stringify(call.input) };
        }
        if (calls.length === 0) yield { ...common, sequence: ++sequence, type: 'text_delta', delta: 'Read and compared the bounded source materials.' };
        yield { ...common, sequence: ++sequence, type: 'completed', reason: calls.length === 0 ? 'final_answer' : 'tool_calls' };
      } catch (error) { modelFailure = error; throw error; }
    },
  };
  const budget = { ...DEFAULT_RUNTIME_BUDGET, contextWindowTokens: 1_000_000,
    perResponseTokens: 2048, maxRequests: 12, maxToolCalls: 20, timeoutMs: 45_000 };
  const meter = new ModelBudget(budget, async () => {}, {
    count: () => ({ tokens: 100, method: 'model_tokenizer', tokenizer: 'labelled-local-test-counter' }),
  });
  const permits: string[] = [];
  const options: ObservedModelRunOptions = {
    kernel, bound: { configuration: { revision: 'local-text-loop', provider: 'deepseek',
      model: 'labelled-local-text-client', baseUrl: 'http://127.0.0.1' }, client },
    meter, root, databasePath: join(directory, 'kernel.sqlite'), sessionId: `source-text-${name}`,
    input: 'Use project_source for bounded text reads, captures, queries, comparisons and release.',
    budget, readOnly: true, signal: new AbortController().signal,
    deniedPrefixes: [], processSandboxOptions: {}, publish: async () => {},
    projectSource: { mode: 'frozen', open },
    // This hook observes the trusted provider boundary only; it does not fabricate
    // ModelRequestPermit records or claim that Run admission has been migrated.
    modelCalls: { bind: async () => {}, beforeCall: async ({ requestId }) => { permits.push(requestId); } },
    manifestDigest: digest('trusted-test-context'),
    ...(assertMaterialsCurrent ? { assertMaterialsCurrent } : {}),
  };
  return {
    root, requests, permits,
    async run() {
      const result = await runObservedModel(options);
      if (modelFailure) throw modelFailure;
      expect(sourceOpens).toBe(1);
      expect(closeCalls).toBe(1);
      expect(opened).toBeDefined();
      if (!opened) throw Error('source capability did not open');
      // The actual WorkspaceTools registry is closed, including direct non-capture reads.
      expect(await opened.port.readWorkspace(opened.context(new AbortController().signal), {
        workspace, path: 'docs/README.md', maxBytes: 8192, version: { kind: 'working_tree' },
      })).toMatchObject({ status: 'rejected' });
      return result;
    },
  };
}

it('runs nine real Kernel rounds over read, text/TS capture, paged queries, changed comparison, frozen read and release', async () => {
  let old!: SourceCaptureRef, newer!: SourceCaptureRef, typescript!: SourceCaptureRef;
  const paths: SourceHit[] = [], matches: SourceHit[] = [];
  const f = await fixture('complete', async (request, { root, round }) => {
    if (round === 1) return [{ id: 'read-live', input: { action: 'read', path: 'docs/README.md', maxBytes: 8192, version: { kind: 'working_tree' } } }];
    if (round === 2) {
      expectFile(delivered<WorkspaceFile>(request, 'read-live'), initialDocs['docs/README.md']!, { kind: 'working_tree' });
      return [
        { id: 'capture-docs', input: { action: 'capture', provider: 'text', prefix: 'docs' } },
        { id: 'capture-default', input: { action: 'capture', configPath: 'tsconfig.json' } },
      ];
    }
    if (round === 3) {
      const text = delivered<CaptureWire>(request, 'capture-docs');
      expect(text.ref).toMatchObject({ projectId: workspace.projectId, workspaceId: workspace.workspaceId,
        workspaceRevision: 1, indexVersion: 'workspace-text@1' });
      expect(text.coverage).toMatchObject({ provider: 'text', engine: 'workspace-text', projectConfiguration: null,
        sourceCount: 3, indexedSourceCount: 0, complete: true, scope: textScope });
      expect(text.changes.added).toEqual({ count: 3, sample: Object.keys(initialDocs).sort(), truncated: false });
      old = text.ref;
      const ts = delivered<CaptureWire>(request, 'capture-default');
      expect(ts.coverage).toMatchObject({ provider: 'typescript', indexedSourceCount: 2, scope: {
        kind: 'typescript_project_inputs', selectionVersion: 'ts-js-json-v1', prefix: null, digestBasis: 'decoded_utf8',
      } });
      expect(ts.changes.added).toEqual({ count: 3, sample: ['src/base.ts', 'src/use.ts', 'tsconfig.json'], truncated: false });
      typescript = ts.ref;
      return [
        { id: 'paths-1', input: { action: 'query', capture: old, query: { kind: 'paths' }, cursor: null, limit: 1 } },
        { id: 'text-1', input: { action: 'query', capture: old, query: { kind: 'text', text: 'topic', caseSensitive: true }, cursor: null, limit: 1 } },
      ];
    }
    if (round >= 4 && round <= 6) {
      const pageNumber = round - 3;
      const pathPage = delivered<PageWire>(request, `paths-${pageNumber}`);
      const textPage = delivered<PageWire>(request, `text-${pageNumber}`);
      for (const page of [pathPage, textPage]) {
        expect(page).toMatchObject({ capture: old, complete: pageNumber === 3,
          observation: 'captured_source', currentness: 'not_rechecked' });
        expect(page.items).toHaveLength(1);
        if (pageNumber < 3) expect(page.nextCursor).toEqual(expect.any(String));
        else expect(page.nextCursor).toBeNull();
      }
      paths.push(...pathPage.items);
      matches.push(...textPage.items);
      if (pageNumber < 3) return [
        { id: `paths-${pageNumber + 1}`, input: { action: 'query', capture: old,
          query: { kind: 'paths' }, cursor: pathPage.nextCursor, limit: 1 } },
        { id: `text-${pageNumber + 1}`, input: { action: 'query', capture: old,
          query: { kind: 'text', text: 'topic', caseSensitive: true }, cursor: textPage.nextCursor, limit: 1 } },
      ];
      expect(paths).toEqual(Object.entries(initialDocs).map(([path, content]) => ({
        kind: 'file', file: { path, digest: digest(content), sizeBytes: Buffer.byteLength(content), kind: 'text' },
      })));
      expect(matches).toEqual(Object.entries(initialDocs).map(([path, content]) => ({
        kind: 'text', excerpt: 'topic', location: {
          path, digest: digest(content), start: { line: 1, column: 1 }, end: { line: 1, column: 6 },
        },
      })));
      await writeFile(join(root, 'docs/README.md'), updatedReadme);
      return [{ id: 'capture-updated', input: { action: 'capture', provider: 'text', prefix: 'docs', previous: old } }];
    }
    if (round === 7) {
      const next = delivered<CaptureWire>(request, 'capture-updated');
      newer = next.ref;
      expect(newer.sourceDigest).not.toBe(old.sourceDigest);
      expect(next.coverage.scope).toEqual(textScope);
      expect(next.changes).toEqual({
        added: { count: 0, sample: [], truncated: false },
        modified: { count: 1, sample: ['docs/README.md'], truncated: false },
        deleted: { count: 0, sample: [], truncated: false },
      });
      return [
        { id: 'compare', input: { action: 'compare', before: old, after: newer } },
        { id: 'read-frozen', input: { action: 'read', path: 'docs/README.md', maxBytes: 8192,
          version: { kind: 'capture', capture: old } } },
        { id: 'read-updated', input: { action: 'read', path: 'docs/README.md', maxBytes: 8192,
          version: { kind: 'working_tree' } } },
      ];
    }
    if (round === 8) {
      expect(delivered<WorkspaceComparison>(request, 'compare')).toEqual({
        before: old, after: newer, scope: textScope, comparison: 'captured_content_only', complete: true,
        changes: [{ kind: 'modified', path: 'docs/README.md',
          beforeDigest: digest(initialDocs['docs/README.md']!), afterDigest: digest(updatedReadme) }],
      });
      expectFile(delivered<WorkspaceFile>(request, 'read-frozen'), initialDocs['docs/README.md']!, { kind: 'capture', capture: old });
      expectFile(delivered<WorkspaceFile>(request, 'read-updated'), updatedReadme, { kind: 'working_tree' });
      return [
        { id: 'release-old', input: { action: 'release', capture: old } },
        { id: 'release-new', input: { action: 'release', capture: newer } },
        { id: 'release-typescript', input: { action: 'release', capture: typescript } },
      ];
    }
    expect(round).toBe(9);
    for (const id of ['release-old', 'release-new', 'release-typescript'])
      expect(delivered<{ released: boolean }>(request, id)).toEqual({ released: true });
    return [];
  });
  const result = await f.run();
  expect(result.state.status).toBe('completed');
  expect(f.requests).toHaveLength(9);
  expect(f.permits).toHaveLength(9);
}, 60_000);

it('stops before another provider call when trusted supplemental material is withdrawn, then closes source access', async () => {
  let current = true, rejections = 0;
  const f = await fixture('material-guard', async (request, { round }) => {
    if (round === 1) return [{ id: 'guard-read', input: {
      action: 'read', path: 'docs/README.md', maxBytes: 8192, version: { kind: 'working_tree' },
    } }];
    expect(round, 'provider must never receive a third request after material withdrawal').toBe(2);
    expectFile(delivered<WorkspaceFile>(request, 'guard-read'), initialDocs['docs/README.md']!, { kind: 'working_tree' });
    current = false;
    return [{ id: 'guard-capture', input: { action: 'capture', provider: 'text', prefix: 'docs' } }];
  }, async () => {
    if (!current) { rejections++; throw Error('Fixture supplemental material is no longer current'); }
  });
  const result = await f.run();
  expect(result.state.status).toBe('failed');
  expect(JSON.stringify(result.state)).toContain('Fixture supplemental material is no longer current');
  expect(rejections).toBeGreaterThan(0);
  expect(f.requests).toHaveLength(2);
  expect(f.permits).toHaveLength(2);
}, 60_000);
