import { ArtifactVault } from '../../src/data/artifact-vault/artifact-vault.js';
import { artifactBodyDigest } from '../../src/contracts/artifact.js';
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodingAgentRuntime, type RunSpec } from '../../src/execution/worker-runtime/coding-agent-runtime.js';
import type { ModelClientPort, ModelEvent, ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import { createInMemoryHarness, type InMemoryHarness } from '../../src/harness/in-memory-harness.js';
import { buildBootstrapCommand } from '../../src/contracts/bootstrap.js';
import { buildCreateGoalCommand } from '../contract-support/fixtures/goal-fixtures.js';
import { COMPLETION_POLICY_FIXTURE_V1, ARCHITECTURE_BASELINE_FIXTURE_V1, buildInstallCommand, buildActivateCommand } from '../../src/fixtures/governance-fixtures.js';
import { completionPolicyPinFor, architectureBaselinePinFor } from '../../src/contracts/governance.js';
import { DISPATCH_PLAN_REVISION_FIXTURE_V1, DISPATCH_ELIGIBLE_TASK_ID, buildDispatchClaimCommand } from '../../src/fixtures/dispatch-fixtures.js';
import { buildApplyPlanCommand } from '../../src/fixtures/plan-fixtures.js';
import type { TaskEnvelopeV1 } from '../../src/contracts/task-envelope.js';
import type { RuntimeContextAccess } from '../../src/data/context-compiler/runtime-context.js';
import { LeasedWorkerRuntime } from '../../src/control/dispatch-engine/leased-worker-runtime.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const scope = { projectId: 'context-project', workspaceId: 'context-workspace', goalId: 'context-goal' };
const at = '2026-09-08T08:00:00.000Z';
const deps = (id: string) => ({ projectId: scope.projectId, commandId: id, correlationId: id, idempotencyKey: id, submittedAt: at });

async function fixture(transform?: (envelope: TaskEnvelopeV1, access: RuntimeContextAccess) => Promise<{ envelope: TaskEnvelopeV1; access: RuntimeContextAccess }>, calls: Array<{ name: string; arguments: Record<string, unknown> }> = [], development = false, rejectMaterials = false) {
  const dir = await mkdtemp(join(tmpdir(), 'runtime-context-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, 'source'); await mkdir(root); await writeFile(join(root, 'README.md'), 'A local source for the context boundary test.\n');
  const requests: ModelRequest[] = [];
  const client: ModelClientPort = { async *stream(request): AsyncIterable<ModelEvent> {
    const call = calls[requests.length];
    requests.push(structuredClone(request));
    const common = { schemaVersion: 1 as const, requestId: request.requestId };
    if (call) {
      yield { ...common, sequence: 1, type: 'tool_call_started', callId: 'context-call-' + requests.length, name: call.name, ordinal: 0 };
      yield { ...common, sequence: 2, type: 'tool_arguments_delta', callId: 'context-call-' + requests.length, delta: JSON.stringify(call.arguments) };
    } else yield { ...common, sequence: 1, type: 'text_delta', delta: 'Received the context. No source was changed.' };
    yield { ...common, sequence: call ? 3 : 2, type: 'usage_snapshot', usage: { inputTokens: 500, outputTokens: 20, cachedInputTokens: 0, costUsdMicros: null } };
    yield { ...common, sequence: call ? 4 : 3, type: 'completed', reason: call ? 'tool_calls' : 'final_answer' };
  } };
  const runtime = new CodingAgentRuntime(join(dir, 'runs'), async () => ({ configuration: { revision: 'local', provider: 'deepseek', model: 'local-memory-client', baseUrl: 'http://127.0.0.1' }, client }));
  await runtime.init(); cleanup.push(() => runtime.close());
  let h: InMemoryHarness; let envelope: TaskEnvelopeV1 | undefined;
  h = createInMemoryHarness({ runtime: {
    capabilities: () => runtime.capabilities(),
    start: async original => {
      if (rejectMaterials) return new LeasedWorkerRuntime({ runtime, lease: () => h.workspaceLease, vault: () => h.vault,
        materials: async () => { throw Error('source pin is stale'); }, now: () => at }).start(original);
      const input = transform ? await transform(structuredClone(original), { vault: h.vault }) : { envelope: original, access: { vault: h.vault } };
      envelope = input.envelope;
      return runtime.start(input.envelope, input.access);
    },
  } });
  expect((await h.bootstrap(buildBootstrapCommand({ schemaVersion: 1, entries: [scope] }, deps('boot')))).status).toBe('committed');
  for (const [i, definition] of [COMPLETION_POLICY_FIXTURE_V1, ARCHITECTURE_BASELINE_FIXTURE_V1].entries()) {
    const installed = buildInstallCommand(definition, deps('install-' + i));
    expect((await h.install(installed)).status).toBe('committed');
    const pin = installed.commandType === 'InstallCompletionPolicyRevision' ? completionPolicyPinFor(installed) : architectureBaselinePinFor(installed);
    expect((await h.activate(buildActivateCommand(pin, { ...deps('activate-' + i), expectedRevision: 1 }))).status).toBe('committed');
  }
  expect((await h.control.submit(buildCreateGoalCommand({ ...scope, objective: 'Verify actual runtime context consumption', actor: { kind: 'human', id: 'local-test' } }, deps('goal')))).status).toBe('committed');
  const plan = structuredClone(DISPATCH_PLAN_REVISION_FIXTURE_V1);
  plan.goalId = scope.goalId; plan.planId = 'context-plan';
  plan.tasks = plan.tasks.map(t => t.taskId === DISPATCH_ELIGIBLE_TASK_ID ? { ...t, title: 'ACCEPTED_TASK_CONTEXT_SENTINEL' } : t);
  plan.obligations = plan.obligations.map(o => o.taskIds.includes(DISPATCH_ELIGIBLE_TASK_ID) ? { ...o, title: 'ACCEPTED_OBLIGATION_CONTEXT_SENTINEL' } : o);
  expect((await h.applyPlan(buildApplyPlanCommand(plan, { ...deps('plan'), expectedRevision: 1 }))).status).toBe('committed');
  const spec: RunSpec = { ...scope, runId: 'real-context-run', taskId: DISPATCH_ELIGIBLE_TASK_ID, root, ...(development ? {} : { mode: 'explore' as const }), instruction: 'OPERATOR_INSTRUCTION_SENTINEL: inspect the local README.', budget: { contextWindowTokens: 1000000, inputTokens: null, outputTokens: null, maxRequests: null, maxToolCalls: null, timeoutMs: null, perResponseTokens: 32768 } };
  await runtime.prepare(spec);
  const claim = () => h.claimTask(buildDispatchClaimCommand({ ...deps('claim'), goalId: scope.goalId, taskId: spec.taskId, runId: spec.runId, attemptId: 'context-attempt', declaredPermissions: development ? { tools: ['read', 'write'], writeScope: ['*'] } : { tools: ['read'], writeScope: [] }, budget: { tokenBudget: 1000000, deadline: null } }));
  const drive = () => h.drive({ reason: 'context-boundary-test', maxIntents: 1 });
  return { h, runtime, requests, spec, claim, drive, envelope: () => envelope!, dir };
}

it('records material refusal before model start as a known failure, including canonical facts and restart', async () => {
  const t = await fixture(undefined, [], false, true);
  await t.claim();
  const result = await t.drive();
  expect(result.failures).toEqual([]);
  expect(t.requests).toHaveLength(0);
  expect(t.runtime.all()[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('source pin is stale'), trace: [] });
  expect(await t.h.ledger.load({ aggregateType: 'Run', projectId: scope.projectId, goalId: scope.goalId, runId: t.spec.runId }))
    .toMatchObject({ status: 'found', snapshot: { status: 'ended', outcome: 'crashed' } });
  await t.runtime.close();
  const reopened = new CodingAgentRuntime(join(t.dir, 'runs'), async () => { throw Error('reopening must not bind a model'); });
  await reopened.init(); cleanup.push(() => reopened.close());
  expect(reopened.all()[0]).toMatchObject({ status: 'failed', error: t.runtime.all()[0]!.error });
});

it('persists an actionable sandbox preflight failure without exposing raw probe details or calling a model', async () => {
  const kernel = await import('../../vendor/coding-agent/dist/public-api.js');
  const probe = vi.spyOn(kernel.ProcessSandbox, 'probe').mockResolvedValue({ available: false, version: 'test', bwrapPath: null, reason: 'PRIVATE_PROBE_DETAIL' });
  try {
    const t = await fixture();
    await t.claim(); await t.drive();
    expect(t.requests).toHaveLength(0);
    expect(t.runtime.all()[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('隔离环境不可用') });
    expect(t.runtime.all()[0]!.error).not.toContain('PRIVATE_PROBE_DETAIL');
    await t.runtime.close();
    const reopened = new CodingAgentRuntime(join(t.dir, 'runs'), async () => { throw Error('restart must not call a model'); });
    await reopened.init(); cleanup.push(() => reopened.close());
    expect(reopened.all()[0]!.error).toBe(t.runtime.all()[0]!.error);
  } finally { probe.mockRestore(); }
});

it('delivers the accepted task and obligations from the real compiler bundle to the actual kernel model request', async () => {
  const t = await fixture();
  expect((await t.claim()).status).toBe('committed');
  expect((await t.drive()).failures).toEqual([]);
  expect(t.requests, t.runtime.all()[0]?.error ?? 'model request missing').toHaveLength(1);
  const input = t.requests[0]!.messages.find(m => m.role === 'user')!.content;
  expect(input).toContain('ACCEPTED_TASK_CONTEXT_SENTINEL');
  expect(input).toContain('ACCEPTED_OBLIGATION_CONTEXT_SENTINEL');
  expect(input).toContain('OPERATOR_INSTRUCTION_SENTINEL');
  expect(t.runtime.all()[0]!.spec.instruction).toBe(t.spec.instruction);
}, 30000);

it.each([
  ['project', { projectId: 'other-project' }],
  ['goal', { goalId: 'other-goal' }],
  ['task', { taskId: 'other-task' }],
  ['run', { runRef: { aggregateType: 'Run', projectId: scope.projectId, goalId: scope.goalId, runId: 'other-run' } }],
  ['plan', { planRef: { aggregateType: 'PlanRevision', projectId: scope.projectId, planId: 'other-plan' } }],
  ['workspace revision', { workspaceSnapshot: { workspaceId: scope.workspaceId, revision: 999 } }],
  ['permissions', { permissions: { policyRevision: 'unauthorized', tools: ['read', 'shell'], writeScope: ['*'] } }],
  ['required predecessor', { dependencies: ['missing-upstream'] }],
])('fails closed before any model call when a stored bundle has the wrong %s', async (_label, mismatch) => {
  const t = await fixture(async (envelope, access) => {
    const opened = await access.vault.open(envelope.bundleRef, { requesterRunRef: envelope.runRef });
    if (opened.status !== 'ready') throw Error('fixture bundle absent');
    const body = JSON.stringify({ ...JSON.parse(opened.record.body), ...mismatch });
    const stored = await access.vault.put({ body, contentType: 'application/json', sourceRefs: envelope.sourceRefs, ownerRef: envelope.runRef, requestedAt: at });
    if (stored.status !== 'stored') throw Error('fixture bundle rejected');
    return { envelope: { ...envelope, bundleRef: stored.ref }, access };
  });
  await t.claim(); await t.drive();
  expect(t.requests).toHaveLength(0);
  expect(t.runtime.all()[0]?.status).toBe('failed');
  expect(t.runtime.all()[0]?.context).toBeUndefined();
}, 30000);

it('rejects a corrupt body returned by storage even when the artifact reference is unchanged', async () => {
  const t = await fixture(async (envelope, access) => ({
    envelope,
    access: { vault: {
      put: value => access.vault.put(value),
      open: async (ref, query) => {
        const opened = await access.vault.open(ref, query);
        return opened.status === 'ready' ? { ...opened, record: { ...opened.record, body: opened.record.body + ' ' } } : opened;
      },
    } },
  }));
  await t.claim(); await t.drive();
  expect(t.requests).toHaveLength(0);
  expect(t.runtime.all()[0]?.error).toContain('摘要、大小');
}, 30000);

it('rejects an unavailable bundle instead of falling back to the instruction', async () => {
  const t = await fixture(async (envelope, access) => ({ envelope: { ...envelope, bundleRef: { ...envelope.bundleRef, digest: '0'.repeat(64) } }, access }));
  await t.claim(); await t.drive();
  expect(t.requests).toHaveLength(0);
  expect(t.runtime.all()[0]?.error).toContain('ContextBundle 不可用');
}, 30000);

it('delivers selected rules and an honest material manifest without changing the persisted operator input', async () => {
  const rule = 'RULE_SENTINEL: report static evidence and uncertainty.';
  const t = await fixture(async (envelope, access) => ({ envelope, access: { ...access, materials: {
    schemaVersion: 1, scope: { ...scope, taskId: envelope.taskId, runId: envelope.runRef.runId }, planRef: envelope.planRef, workspaceSnapshot: envelope.workspaceSnapshot,
    rules: [{ content: rule, digest: artifactBodyDigest(rule), sourceRefs: [{ kind: 'governance', refId: 'read-only-rule', revision: '1' }], selectedBecause: 'Required by this read-only exploration' }],
    predecessors: [], evidenceRefs: [], gaps: ['No architecture analysis has been verified yet.'],
  } } }));
  await t.claim(); await t.drive();
  const request = t.requests[0]!, record = t.runtime.all()[0]!;
  const input = request.messages.find(m => m.role === 'user')!.content;
  expect(input).toContain(rule); expect(input).toContain('No architecture analysis has been verified yet.');
  expect(record.context?.manifest.selected.some(s => s.kind === 'rule' && s.selectedBecause === 'Required by this read-only exploration')).toBe(true);
  expect(record.context?.manifest.truncated).toEqual([]);
  expect(record.context?.manifest.gaps.join('\n')).toContain('WorkContext');
  expect(record.context?.manifest.inputDigest).toBe(artifactBodyDigest(input));
  expect(record.spec.instruction).toBe(t.spec.instruction);
  expect(record.spec.budget.inputTokens).toBeNull();
  expect(request.tools.map(tool => tool.name).sort()).toEqual(['code_index', 'cpp_index', 'list_files', 'project_index', 'python_index', 'read', 'search', 'source_excerpt', 'symbols']);
}, 30000);

it.each(['scope', 'digest'] as const)('rejects mismatched selected material %s before the model sees it', async mismatch => {
  const text = 'PRIVATE_OTHER_SCOPE_RULE_SENTINEL';
  const t = await fixture(async (envelope, access) => ({ envelope, access: { ...access, materials: {
    schemaVersion: 1, scope: { ...scope, goalId: mismatch === 'scope' ? 'other-goal' : scope.goalId, taskId: envelope.taskId, runId: envelope.runRef.runId }, planRef: envelope.planRef, workspaceSnapshot: envelope.workspaceSnapshot,
    rules: [{ content: text, digest: mismatch === 'digest' ? '0'.repeat(64) : artifactBodyDigest(text), sourceRefs: envelope.sourceRefs, selectedBecause: 'Selected test rule' }],
    predecessors: [], evidenceRefs: [], gaps: [],
  } } }));
  await t.claim(); await t.drive();
  expect(t.requests).toHaveLength(0); expect(t.runtime.all()[0]?.status).toBe('failed');
}, 30000);

it('keeps a historical ended run idempotent after restart without manufacturing a new context', async () => {
  const t = await fixture(); await t.claim(); await t.drive(); await t.runtime.close();
  const files = (await readdir(join(t.dir, 'runs'))).filter(name => name.endsWith('.json'));
  expect(files).toHaveLength(1);
  const path = join(t.dir, 'runs', files[0]!);
  const old = JSON.parse(await readFile(path, 'utf8')); delete old.context;
  await writeFile(path, JSON.stringify(old));
  const restored = new CodingAgentRuntime(join(t.dir, 'runs'), async () => { throw Error('Ended runs must not bind a model again'); });
  await restored.init(); cleanup.push(() => restored.close());
  await restored.prepare(t.spec);
  const handle = await restored.start(t.envelope());
  expect((await handle.pollFreshEvents()).map(e => e.eventType)).toEqual(['run_started', 'run_completed']);
  expect(await handle.pollFreshEvents()).toEqual([]);
  expect(restored.all()[0]?.spec.instruction).toBe(t.spec.instruction);
  expect(restored.all()[0]?.context).toBeUndefined();
  expect(t.requests).toHaveLength(1);
}, 30000);

it('executes the registered file listing, search and syntax analysis tools through the real kernel', async () => {
  const t = await fixture(undefined, [
    { name: 'list_files', arguments: {} },
    { name: 'search', arguments: { query: 'loadSensor', paths: ['source.ts'] } },
    { name: 'symbols', arguments: { path: 'source.ts' } },
    { name: 'code_index', arguments: { paths: ['source.ts', 'consumer.ts'], operation: 'definitions', path: 'consumer.ts', line: 2, column: 2 } },
    { name: 'source_excerpt', arguments: { path: 'source.ts', expectedDigest: (await import('node:crypto')).createHash('sha256').update('export function loadSensor() { return 42; }\n').digest('hex'), startLine: 1, endLine: 1 } },
  ]);
  await writeFile(join(t.spec.root, 'source.ts'), 'export function loadSensor() { return 42; }\n');
  await writeFile(join(t.spec.root, 'consumer.ts'), 'import { loadSensor } from "./source.js";\nloadSensor();\n');
  await t.claim(); await t.drive();
  expect(t.runtime.all()[0]?.status).toBe('completed');
  expect(t.requests).toHaveLength(6);
  const results = t.requests.at(-1)!.messages.filter(m => m.role === 'tool');
  expect(results).toHaveLength(5);
  expect(results.map(m => m.result.status), JSON.stringify(results)).toEqual(['success', 'success', 'success', 'success', 'success']);
  expect(JSON.stringify(results[0])).toContain('source.ts');
  expect(JSON.stringify(results[1])).toContain('loadSensor');
  expect(JSON.stringify(results[2])).toContain('FunctionDeclaration');
  expect(JSON.stringify(results[3])).toContain('typescript-language-service');
  expect(JSON.stringify(results[3])).toContain('"status":"sourced"');
  expect(JSON.stringify(results[4])).toContain('export function loadSensor');
  expect(await readFile(join(t.spec.root, 'source.ts'), 'utf8')).toBe('export function loadSensor() { return 42; }\n');
}, 30000);

it('makes the source index available to a development run through the actual kernel', async () => {
  const t = await fixture(undefined, [{ name: 'project_index', arguments: { operation: 'symbols' } }], true);
  await writeFile(join(t.spec.root, 'source.ts'), 'export function developmentSymbol() {}\n');
  await t.claim(); await t.drive();
  expect(t.runtime.all()[0]?.status, t.runtime.all()[0]?.error ?? '').toBe('completed');
  expect(t.requests).toHaveLength(2);
  expect(t.requests[0]!.tools.map(t => t.name)).toEqual(expect.arrayContaining(['edit', 'code_index', 'project_index', 'source_excerpt']));
  const result = t.requests[1]!.messages.find(m => m.role === 'tool');
  expect(JSON.stringify(result)).toContain('developmentSymbol');
  expect(JSON.stringify(result)).toContain('"status":"sourced"');
  await t.runtime.close();
  const reopened = new CodingAgentRuntime(join(t.dir, 'runs'), async () => { throw Error('reopen must not call a model'); });
  await reopened.init(); cleanup.push(() => reopened.close());
  expect(JSON.stringify(reopened.all()[0]!.trace)).toContain('developmentSymbol');
  expect(JSON.stringify(reopened.all()[0]!.trace)).toContain('typescript-language-service');
}, 30000);

it('does not open a valid context body owned by a different run', async () => {
  const t = await fixture(async (envelope, access) => {
    const opened = await access.vault.open(envelope.bundleRef, { requesterRunRef: envelope.runRef });
    if (opened.status !== 'ready') throw Error('fixture bundle absent');
    const vault = new ArtifactVault();
    const stored = await vault.put({ body: opened.record.body, contentType: 'application/json', sourceRefs: opened.record.sourceRefs, ownerRef: { ...envelope.runRef, runId: 'other-owner' }, requestedAt: at });
    if (stored.status !== 'stored') throw Error('fixture bundle rejected');
    return { envelope: { ...envelope, bundleRef: stored.ref }, access: { vault } };
  });
  await t.claim(); await t.drive();
  expect(t.requests).toHaveLength(0);
  expect(t.runtime.all()[0]?.error).toContain('无读取权限');
}, 30000);
