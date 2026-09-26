/**
 * R2e.1 independent acceptance. Intended destination: tests/runtime/.
 * This file is staged in /tmp until the new WorkspaceToolsPort is implemented.
 *
 * The complete ordinary Work path is real: accepted Control plan/claim, ledger,
 * LeasedWorkerRuntime, CodingAgentRuntime, Kernel, Host mount policy, and
 * createRuntimeSourceCaptureFactory. Only the external ModelClient is a local
 * scripted client; no ObservedModel, source reader, analyzer, or registry mock.
 *
 * Prerequisites: supported Node 24, built vendor/coding-agent/dist and installed
 * native dependencies, and a host where the real ProcessSandbox.probe succeeds.
 * Read-only ordinary Runs still require that sandbox. No external model/network.
 */
import { afterEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModelClientPort, ModelEvent, ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import { createRuntimeSourceCaptureFactory } from '../../src/app/source-capture-access.js';
import { createWorkspaceTools as createHostWorkspaceTools } from '../../src/app/workspace-tools.js';
import { LeasedWorkerRuntime } from '../../src/control/dispatch-engine/leased-worker-runtime.js';
import { CodingAgentRuntime } from '../../src/execution/worker-runtime/coding-agent-runtime.js';
import type { RuntimeSourceCaptureAccess } from '../../src/data/context-compiler/runtime-context.js';
import { createInMemoryHarness, type InMemoryHarness } from '../../src/harness/in-memory-harness.js';
import type { SourceCaptureRef } from '../../src/contracts/core/source.js';
import type { RunSpec } from '../../src/contracts/runtime-preparation.js';
import type { TaskEnvelopeV1 } from '../../src/contracts/task-envelope.js';
import type { ModelRequestPermitSnapshot, RunRef, RunSnapshot } from '../../src/contracts/dispatch.js';
import { modelRequestPermitIdFor, modelRequestPermitRefFor } from '../../src/contracts/dispatch.js';
import { DEFAULT_RUNTIME_BUDGET } from '../../src/contracts/runtime-budget.js';
import type {
  CaptureContentScope, SourceHit, WorkspaceComparison, WorkspaceFile, WorkspaceResult,
} from '../../src/core/workspace/ports.js';
import { buildDispatchClaimCommand, DISPATCH_ELIGIBLE_TASK_ID } from '../../src/fixtures/dispatch-fixtures.js';
import { prepareDispatchScenario } from '../contract-suite/p1-03-harness.js';

const directories: string[] = [];
const runtimes: CodingAgentRuntime[] = [];
const sources: RuntimeSourceCaptureAccess[] = [];
const mounts: Array<Awaited<ReturnType<typeof createHostWorkspaceTools>>> = [];
afterEach(async () => {
  await Promise.allSettled(runtimes.splice(0).map(runtime => runtime.close()));
  // Fallback cleanup delegates to the actual capability and is outside close-count assertions.
  await Promise.allSettled(sources.splice(0).map(source => source.close()));
  for (const host of mounts.splice(0)) host.close();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

const at = '2026-09-23T00:00:00.000Z';
const scope = { projectId: 'proj-alpha', workspaceId: 'ws-shared', goalId: 'goal-1' };
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
type ModelRound = (request: ModelRequest, context: { root: string; round: number }) => Promise<ToolCall[]>;

/** Read the tool result that the actual Kernel put in the next model request. */
function delivered<T>(request: ModelRequest, callId: string): T {
  const message = request.messages.find(candidate => candidate.role === 'tool' && candidate.callId === callId);
  expect(message, `Missing real Kernel result for ${callId}`).toBeDefined();
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
  const directory = await mkdtemp(join(tmpdir(), `runtime-workspace-text-${name}-`));
  directories.push(directory);
  const root = join(directory, 'source'), otherRoot = join(directory, 'other-source');
  const runDirectory = join(directory, 'runs');
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'docs'));
  await mkdir(otherRoot);
  await mkdir(runDirectory);
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { module: 'esnext', moduleResolution: 'bundler' }, include: ['src/**/*.ts'],
  }));
  await writeFile(join(root, 'src/base.ts'), 'export function chosen() { return 19; }\n');
  await writeFile(join(root, 'src/use.ts'), 'import { chosen } from "./base";\nexport const answer = chosen();\n');
  for (const [path, content] of Object.entries(initialDocs)) await writeFile(join(root, path), content);
  const host = await createHostWorkspaceTools(join(directory, 'host'), {
    workspaceRoots: { 'acceptance-alpha': root, 'acceptance-beta': otherRoot }, privatePaths: [runDirectory],
  });
  mounts.push(host);
  await host.register({ projectId: scope.projectId, workspaceId: scope.workspaceId, root, name: 'Real text tools runtime fixture' });
  expect(await host.sourcePolicyFor(scope.projectId, scope.workspaceId)).toMatchObject({ root });

  const runId = `${name}-text-run`, attemptId = `${name}-text-attempt`;
  const runRef: RunRef = { aggregateType: 'Run', projectId: scope.projectId, goalId: scope.goalId, runId };
  const hostStop = new AbortController();
  const opened: Array<{
    access: RuntimeSourceCaptureAccess; closeCalls: number;
    context: ReturnType<RuntimeSourceCaptureAccess['context']>;
  }> = [];
  const requests: ModelRequest[] = [];
  let sourceBindings = 0;
  let modelFailure: unknown;
  let h: InMemoryHarness;
  const client: ModelClientPort = {
    async *stream(request): AsyncIterable<ModelEvent> {
      try {
        requests.push(structuredClone(request));
        expect(request.tools.map(tool => tool.name)).toContain('project_source');
        expect(request.tools.map(tool => tool.name)).not.toContain('project_index');
        expect(request.tools.some(tool => ['edit', 'shell'].includes(tool.name))).toBe(false);
        expect(opened).toHaveLength(1);
        expect(opened[0]!.closeCalls).toBe(0);
        const permit = await h.ledger.load(modelRequestPermitRefFor(scope.projectId, scope.workspaceId, modelRequestPermitIdFor(runRef, request.requestId)));
        if (permit.status !== 'found' || permit.snapshot.ref.aggregateType !== 'ModelRequestPermit') throw Error('Missing actual provider-boundary permit');
        expect(permit.snapshot as ModelRequestPermitSnapshot).toMatchObject({
          permit: { runRef, requestId: request.requestId, consumedByAttemptId: request.requestId },
        });
        const running = await h.ledger.load(runRef);
        if (running.status !== 'found' || running.snapshot.ref.aggregateType !== 'Run') throw Error('Run missing at provider boundary');
        expect(running.snapshot as RunSnapshot).toMatchObject({ status: 'running', outcome: null, executionAuthorization: { phase: 'entered' } });

        const calls = await respond(request, { root, round: requests.length });
        const common = { schemaVersion: 1 as const, requestId: request.requestId };
        let sequence = 0;
        for (const [ordinal, call] of calls.entries()) {
          yield { ...common, sequence: ++sequence, type: 'tool_call_started', callId: call.id, name: 'project_source', ordinal };
          yield { ...common, sequence: ++sequence, type: 'tool_arguments_delta', callId: call.id, delta: JSON.stringify(call.input) };
        }
        if (calls.length === 0) yield { ...common, sequence: ++sequence, type: 'text_delta', delta: 'Read and compared the bounded source materials; this is not a code acceptance decision.' };
        yield { ...common, sequence: ++sequence, type: 'completed', reason: calls.length === 0 ? 'final_answer' : 'tool_calls' };
      } catch (error) { modelFailure = error; throw error; }
    },
  };
  const budget = {
    ...DEFAULT_RUNTIME_BUDGET, contextWindowTokens: 1000000, perResponseTokens: 2048,
    maxRequests: 12, maxToolCalls: 20, timeoutMs: 45000,
  };
  const runtime = new CodingAgentRuntime(runDirectory, async () => ({
    configuration: { revision: 'local-text-tools', provider: 'deepseek', model: 'labelled-local-text-client', baseUrl: 'http://127.0.0.1' },
    client, inputCounter: { count: () => ({ tokens: 100, method: 'model_tokenizer', tokenizer: 'labelled-local-test-counter' }) },
  }));
  runtimes.push(runtime);
  await runtime.init();
  let leased: LeasedWorkerRuntime;
  h = createInMemoryHarness({
    deps: { clock: () => at },
    runtime: { capabilities: () => runtime.capabilities(), start: (envelope, access) => leased.start(envelope, access) },
  });
  leased = new LeasedWorkerRuntime({
    runtime, lease: () => h.workspaceLease, vault: () => h.vault, now: () => at,
    // The accepted task and its real Vault bundle are always prepared by Dispatch.
    // The negative case also uses the existing trusted supplemental-material seam;
    // it cannot supply a principal, model permit, or source permission.
    materials: async (spec, envelope) => assertMaterialsCurrent ? {
      schemaVersion: 1,
      scope: { projectId: spec.projectId, workspaceId: spec.workspaceId, goalId: spec.goalId, taskId: spec.taskId, runId: spec.runId },
      planRef: structuredClone(envelope.planRef), workspaceSnapshot: structuredClone(envelope.workspaceSnapshot),
      rules: [], predecessors: [], evidenceRefs: [], gaps: [], assertCurrent: assertMaterialsCurrent,
    } : undefined,
    sourceCapture: (spec: RunSpec, envelope: TaskEnvelopeV1) => {
      sourceBindings++;
      const open = createRuntimeSourceCaptureFactory({
        ledger: () => h.ledger, sourcePolicyFor: host.sourcePolicyFor, hostSignal: hostStop.signal, now: () => at,
      }, spec, envelope);
      return async signal => {
        const access = await open(signal);
        sources.push(access);
        const context = access.context(new AbortController().signal);
        const witness = { access, context, closeCalls: 0 };
        opened.push(witness);
        expect(context.principal).toMatchObject({ kind: 'work_run', runRef: envelope.runRef, roleBinding: envelope.roleBinding });
        expect(context.principal).not.toHaveProperty('agentPrincipal');
        expect(context.materialReader).toMatchObject({ kind: 'run', requester: envelope.runRef });
        // Observe only this ownership boundary. Every actual method and close is delegated.
        return { ...access, close: async () => { witness.closeCalls++; await access.close(); } };
      };
    },
  });
  await prepareDispatchScenario({ ...h, submit: command => h.control.submit(command) });
  const spec: RunSpec = {
    ...scope, runId, taskId: DISPATCH_ELIGIBLE_TASK_ID, root, budget,
    instruction: 'Use project_source for bounded text reads, captures, paged queries and comparisons. Release temporary captures when finished.',
  };
  await runtime.prepare(spec);
  expect(sourceBindings).toBe(0);
  expect(opened).toHaveLength(0);
  expect(await h.claimTask(buildDispatchClaimCommand({
    projectId: scope.projectId, goalId: scope.goalId, taskId: spec.taskId, runId, attemptId,
    commandId: `${name}-text-claim`, correlationId: `${name}-text`, idempotencyKey: `${name}-text-claim`, submittedAt: at,
    declaredPermissions: { tools: ['read'], writeScope: [] }, budget: { tokenBudget: budget.contextWindowTokens, deadline: null },
  }))).toMatchObject({ status: 'committed' });
  await h.advanceProjection();

  return {
    h, requests,
    async run() {
      const result = await h.drive({ reason: `${name}-text-integration`, maxIntents: 1 });
      if (modelFailure) throw modelFailure;
      expect(result.failures, JSON.stringify(result.failures)).toEqual([]);
      expect(result.started).toBe(1);
      expect(sourceBindings).toBe(1);
      expect(opened).toHaveLength(1);
      expect(opened[0]!.closeCalls).toBe(1);
      const owned = opened[0]!;
      // A real close: even the new non-capture read endpoint must be shut down.
      expect(await owned.access.port.readWorkspace(owned.context, {
        workspace: owned.access.workspace, path: 'docs/README.md', maxBytes: 8192, version: { kind: 'working_tree' },
      })).toMatchObject({ status: 'rejected', code: 'cancelled' });
      const record = runtime.all().find(item => item.spec.runId === runId);
      expect(record, 'No runtime record: check built Kernel/native/sandbox prerequisites').toBeDefined();
      if (!record) throw Error('Missing runtime record');
      return record;
    },
  };
}

it('real ordinary Run pages document captures, compares a later file change and still reads the exact earlier content', async () => {
  let old: SourceCaptureRef;
  let newer: SourceCaptureRef;
  let typescript: SourceCaptureRef;
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
      expect(text.ref).toMatchObject({ projectId: scope.projectId, workspaceId: scope.workspaceId, workspaceRevision: 1, indexVersion: 'workspace-text@1' });
      expect(text.coverage).toMatchObject({
        provider: 'text', engine: 'workspace-text', projectConfiguration: null,
        sourceCount: 3, indexedSourceCount: 0, complete: true, scope: textScope,
      });
      expect(text.changes.added).toEqual({ count: 3, sample: Object.keys(initialDocs).sort(), truncated: false });
      old = text.ref;
      const ts = delivered<CaptureWire>(request, 'capture-default');
      expect(ts.coverage).toMatchObject({
        provider: 'typescript', indexedSourceCount: 2, scope: {
          kind: 'typescript_project_inputs', selectionVersion: 'ts-js-json-v1', prefix: null, digestBasis: 'decoded_utf8',
        },
      });
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
        expect(page).toMatchObject({ capture: old, complete: pageNumber === 3, observation: 'captured_source', currentness: 'not_rechecked' });
        expect(page.items).toHaveLength(1);
        if (pageNumber < 3) expect(page.nextCursor).toEqual(expect.any(String));
        else expect(page.nextCursor).toBeNull();
      }
      paths.push(...pathPage.items);
      matches.push(...textPage.items);
      if (pageNumber < 3) return [
        { id: `paths-${pageNumber + 1}`, input: { action: 'query', capture: old, query: { kind: 'paths' }, cursor: pathPage.nextCursor, limit: 1 } },
        { id: `text-${pageNumber + 1}`, input: { action: 'query', capture: old, query: { kind: 'text', text: 'topic', caseSensitive: true }, cursor: textPage.nextCursor, limit: 1 } },
      ];
      expect(paths).toEqual(Object.entries(initialDocs).map(([path, content]) => ({
        kind: 'file', file: { path, digest: digest(content), sizeBytes: Buffer.byteLength(content), kind: 'text' },
      })));
      expect(matches).toEqual(Object.entries(initialDocs).map(([path, content]) => ({
        kind: 'text', excerpt: 'topic', location: {
          path, digest: digest(content), start: { line: 1, column: 1 }, end: { line: 1, column: 6 },
        },
      })));
      // A host-side filesystem change, not a model write privilege or a registry stub.
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
        { id: 'read-frozen', input: { action: 'read', path: 'docs/README.md', maxBytes: 8192, version: { kind: 'capture', capture: old } } },
        { id: 'read-updated', input: { action: 'read', path: 'docs/README.md', maxBytes: 8192, version: { kind: 'working_tree' } } },
      ];
    }
    if (round === 8) {
      expect(delivered<WorkspaceComparison>(request, 'compare')).toEqual({
        before: old, after: newer, scope: textScope, comparison: 'captured_content_only', complete: true,
        changes: [{ kind: 'modified', path: 'docs/README.md', beforeDigest: digest(initialDocs['docs/README.md']!), afterDigest: digest(updatedReadme) }],
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
  const record = await f.run();
  expect(record.status, record.error ?? 'Runtime did not complete').toBe('completed');
  expect(f.requests).toHaveLength(9);
  const facts = await f.h.ledger.events({ afterCursor: null, limit: 512 });
  expect(facts.hasMore).toBe(false);
  expect(facts.events.some(({ event }) => ['AgentInstanceRegistered', 'WorkParticipationStarted'].includes(event.eventType))).toBe(false);
  expect(facts.events.filter(({ event }) => event.eventType === 'ModelRequestAuthorized')).toHaveLength(9);
  expect(facts.events.filter(({ event }) => event.eventType === 'ModelRequestEvidenceRecorded')).toHaveLength(9);
}, 60000);

it('the real Run still stops at its supplemental-material guard after a new text-tool round, and closes its capability', async () => {
  let current = true, rejections = 0;
  const f = await fixture('material-guard', async (request, { round }) => {
    if (round === 1) return [{ id: 'guard-read', input: {
      action: 'read', path: 'docs/README.md', maxBytes: 8192, version: { kind: 'working_tree' },
    } }];
    expect(round, 'The provider must never receive a third request after material withdrawal').toBe(2);
    expectFile(delivered<WorkspaceFile>(request, 'guard-read'), initialDocs['docs/README.md']!, { kind: 'working_tree' });
    current = false;
    return [{ id: 'guard-capture', input: { action: 'capture', provider: 'text', prefix: 'docs' } }];
  }, async () => {
    if (!current) { rejections++; throw Error('Fixture supplemental material is no longer current'); }
  });
  const record = await f.run();
  expect(record.status).toBe('failed');
  expect(rejections).toBeGreaterThan(0);
  expect(f.requests).toHaveLength(2);
  // Ordinary material freshness is checked before each provider call. It does not
  // retroactively revoke already-authorized read-only tools in the preceding round.
  // Whatever that round captured must still be reclaimed by the single owned close.
  const facts = await f.h.ledger.events({ afterCursor: null, limit: 512 });
  expect(facts.hasMore).toBe(false);
  expect(facts.events.filter(({ event }) => event.eventType === 'ModelRequestAuthorized')).toHaveLength(2);
}, 60000);
