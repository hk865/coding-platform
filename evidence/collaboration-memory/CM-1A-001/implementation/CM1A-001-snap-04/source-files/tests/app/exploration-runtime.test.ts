import { storeRuntimeTestBundle } from './runtime-context-fixture.js';
import type { RuntimeContextAccess } from '../../src/data/context-compiler/runtime-context.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, readlink, lstat, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ModelClientPort, ModelEvent, ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import { CodingAgentRuntime, type RuntimeRecord, type RunSpec } from '../../src/execution/worker-runtime/coding-agent-runtime.js';
import { DEFAULT_RUNTIME_BUDGET } from '../../src/execution/worker-runtime/model-budget.js';
import { buildEnvelopeFixture } from '../../src/fixtures/dispatch-fixtures.js';
import { artifactBodyDigest } from '../../src/contracts/artifact.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

type ScriptCall = { name: string; arguments: Record<string, string> };
function scriptedModel(calls: ScriptCall[]) {
  const requests: ModelRequest[] = [];
  const client: ModelClientPort = {
    async *stream(request): AsyncIterable<ModelEvent> {
      const index = requests.length;
      requests.push(structuredClone(request));
      const common = { schemaVersion: 1 as const, requestId: request.requestId };
      const call = calls[index];
      if (call) {
        yield { ...common, sequence: 1, type: 'tool_call_started', callId: 'explore-call-' + index, name: call.name, ordinal: 0 };
        yield { ...common, sequence: 2, type: 'tool_arguments_delta', callId: 'explore-call-' + index, delta: JSON.stringify(call.arguments) };
      } else {
        yield { ...common, sequence: 1, type: 'text_delta', delta: '# Exploration report\n\nREADME.md identifies the local fixture. src/value.ts exports a value. No build or modification was performed.' };
      }
      yield { ...common, sequence: call ? 3 : 2, type: 'usage_snapshot', usage: { inputTokens: 100, outputTokens: 50, cachedInputTokens: 0, costUsdMicros: null } };
      yield { ...common, sequence: call ? 4 : 3, type: 'completed', reason: call ? 'tool_calls' : 'final_answer' };
    },
  };
  return { client, requests };
}

async function sourceSnapshot(root: string) {
  const entries: Array<{ path: string; kind: string; mode: number; value?: string }> = [];
  async function walk(relative = ''): Promise<void> {
    for (const name of (await readdir(join(root, relative))).sort()) {
      const path = relative ? relative + '/' + name : name;
      const stat = await lstat(join(root, path));
      const kind = stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : 'file';
      const value = kind === 'symlink' ? await readlink(join(root, path)) : kind === 'file' ? createHash('sha256').update(await readFile(join(root, path))).digest('hex') : undefined;
      entries.push({ path, kind, mode: stat.mode, ...(value !== undefined ? { value } : {}) });
      if (kind === 'directory') await walk(path);
    }
  }
  await walk();
  return entries;
}

async function fixture(calls: (root: string, outside: string) => ScriptCall[]) {
  const dir = await mkdtemp(join(tmpdir(), 'platform-exploration-runtime-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, 'source'), outside = join(dir, 'outside-secret.txt'), state = join(dir, 'state');
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, '.git'));
  await writeFile(join(root, 'README.md'), 'Local exploration fixture; only read access is permitted.\n');
  await writeFile(join(root, 'src/value.ts'), 'export const value = 42;\n');
  await writeFile(join(root, '.env'), 'DENIED_ENV_SENTINEL=private-fixture-value\n');
  await writeFile(join(root, '.git/config'), 'DENIED_GIT_SENTINEL\n');
  await writeFile(outside, 'OUTSIDE_SENTINEL_DO_NOT_DISCLOSE\n');
  await symlink(outside, join(root, 'external-link.txt'));
  const model = scriptedModel(calls(root, outside));
  const runtime = new CodingAgentRuntime(state, async () => ({
    configuration: { revision: 'local-exploration-fixture', provider: 'deepseek', model: 'deterministic-in-memory', baseUrl: 'http://127.0.0.1' },
    client: model.client,
  }));
  await runtime.init(); cleanup.push(() => runtime.close());
  const envelope = buildEnvelopeFixture({
    envelopeId: 'explore', projectId: 'project', workspaceId: 'workspace', goalId: 'goal', taskId: 'explore-task', runId: 'real-explore', attemptId: 'attempt',
    planRef: { aggregateType: 'PlanRevision', projectId: 'project', planId: 'exploration-plan' },
    workspaceRevision: 1,
    bundleRef: { kind: 'artifact', contentType: 'text/plain', digest: artifactBodyDigest('explore'), sizeBytes: 7, source: { kind: 'plan-revision', refId: 'exploration-plan', revision: '1' } },
  });
  envelope.budget = { tokenBudget: DEFAULT_RUNTIME_BUDGET.contextWindowTokens, deadline: null };
  envelope.permissions = { policyRevision: 'read-only-exploration', tools: ['read'], writeScope: [] };
  const spec: RunSpec = {
    mode: 'explore', projectId: 'project', workspaceId: 'workspace', goalId: 'goal', taskId: 'explore-task', runId: 'real-explore', root,
    instruction: 'Explore README.md and src/value.ts using only read. Report source observations; do not edit files or run commands.',
    budget: { ...DEFAULT_RUNTIME_BUDGET },
  };
  const access = await storeRuntimeTestBundle(envelope);
  return { dir, root, outside, state, runtime, model, envelope, spec, access };
}

async function finish(runtime: CodingAgentRuntime, envelope: ReturnType<typeof buildEnvelopeFixture>, access?: RuntimeContextAccess) {
  const handle = await runtime.start(envelope, access), events = [];
  for (;;) { const next = await handle.pollFreshEvents(); if (!next.length) break; events.push(...next); }
  return { record: runtime.all()[0]!, events };
}

describe('real kernel read-only exploration permissions', () => {
  it('exposes only read, denies paths and fabricated write tools, preserves source and persists an actual report without replay', async () => {
    const t = await fixture((root, outside) => [
      { name: 'read', arguments: { path: 'README.md' } },
      { name: 'read', arguments: { path: 'src/value.ts' } },
      { name: 'read', arguments: { path: outside } },
      { name: 'read', arguments: { path: '../outside-secret.txt' } },
      { name: 'read', arguments: { path: 'external-link.txt' } },
      { name: 'read', arguments: { path: '.env' } },
      { name: 'read', arguments: { path: '.git/config' } },
      { name: 'edit', arguments: { mode: 'create', path: 'edit-was-executed.txt', newText: 'must not appear' } },
      { name: 'shell', arguments: { command: 'printf forbidden > shell-was-executed.txt' } },
      { name: 'read', arguments: { path: join(root, 'README.md') } },
    ]);
    const before = await sourceSnapshot(t.root), outsideBefore = await readFile(t.outside, 'utf8');
    await t.runtime.prepare(t.spec);
    expect(await sourceSnapshot(t.root)).toEqual(before);
    const { record, events } = await finish(t.runtime, t.envelope, t.access);
    expect(record.status).toBe('completed');
    expect(events.map(event => event.eventType)).toEqual(['run_started', 'run_completed']);
    expect(t.model.requests).toHaveLength(11);
    for (const request of t.model.requests) expect(request.tools.map(tool => tool.name).sort()).toEqual(['code_index', 'cpp_index', 'list_files', 'project_index', 'python_index', 'read', 'search', 'source_excerpt', 'symbols']);

    const returned = t.model.requests.at(-1)!.messages.filter(message => message.role === 'tool');
    expect(returned).toHaveLength(10);
    expect(returned.slice(0, 2).every(message => message.result.status === 'success')).toBe(true);
    expect(returned.slice(2).every(message => message.result.status === 'error')).toBe(true);
    expect(JSON.stringify(returned[0])).toContain('Local exploration fixture');
    expect(JSON.stringify(returned[1])).toContain('export const value = 42');
    expect(JSON.stringify(t.model.requests)).not.toContain('OUTSIDE_SENTINEL_DO_NOT_DISCLOSE');
    expect(JSON.stringify(t.model.requests)).not.toContain('DENIED_ENV_SENTINEL');
    expect(JSON.stringify(t.model.requests)).not.toContain('DENIED_GIT_SENTINEL');
    expect(record.trace.filter(event => event.type === 'tool.completed')).toHaveLength(2);
    expect(record.trace.some(event => event.type === 'assistant.message_completed' && JSON.stringify(event.data).includes('# Exploration report'))).toBe(true);
    expect(record.nodeSha256).toBeNull();
    expect(record.workspaceRevision).toBeTruthy();
    expect(await sourceSnapshot(t.root)).toEqual(before);
    expect(await readFile(t.outside, 'utf8')).toBe(outsideBefore);
    await expect(lstat(join(t.root, '.platform-runtime'))).rejects.toMatchObject({ code: 'ENOENT' });

    await t.runtime.close();
    const persistedFile = (await readdir(t.state)).find(name => /^[a-f0-9]{64}\.json$/.test(name))!;
    const persisted = JSON.parse(await readFile(join(t.state, persistedFile), 'utf8')) as RuntimeRecord;
    expect(persisted.trace).toEqual(record.trace);
    expect(persisted.usage).toHaveLength(11);
    expect((await readdir(t.state)).some(name => name.endsWith('.sqlite'))).toBe(true);
    const restored = new CodingAgentRuntime(t.state, async () => { throw Error('recovery must not bind a model'); });
    await restored.init(); cleanup.push(() => restored.close());
    expect(restored.all()[0]?.status).toBe('completed');
    for (let i = 0; i < 3; i++) restored.all();
    await restored.prepare(t.spec);
    const replay = await finish(restored, t.envelope);
    expect(replay.record.trace).toEqual(record.trace);
    expect(t.model.requests).toHaveLength(11);
    expect(await sourceSnapshot(t.root)).toEqual(before);
  }, 30000);

  it.each([
    { tools: ['read', 'shell'], writeScope: [] },
    { tools: ['read'], writeScope: ['*'] },
    { tools: ['read', 'edit'], writeScope: ['src/**'] },
  ])('rejects an explore envelope with broader permissions before requesting the model: %j', async permissions => {
    const t = await fixture(() => []);
    const before = await sourceSnapshot(t.root);
    await t.runtime.prepare(t.spec);
    await expect(t.runtime.start({ ...t.envelope, permissions: { policyRevision: 'invalid-exploration-permissions', ...permissions } })).rejects.toThrow('权限与任务模式不符');
    expect(t.model.requests).toHaveLength(0);
    expect(await sourceSnapshot(t.root)).toEqual(before);
    await expect(lstat(join(t.root, '.platform-runtime'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('runtime record ordering across restart', () => {
  const recordFile = (directory: string, spec: RunSpec) => join(directory, createHash('sha256').update(JSON.stringify([spec.projectId, spec.goalId, spec.runId])).digest('hex') + '.json');
  const noRecoveryModel = async () => { throw Error('reading stored runs must not bind or request a model'); };

  it('persists preparation time and keeps a waiting run before later completed runs after restart', async () => {
    const t = await fixture(() => []);
    const first = { ...t.spec, runId: 'real-z-prepared' }, second = { ...t.spec, runId: 'real-a-later' };
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-09-08T01:00:00.000Z'));
      await t.runtime.prepare(first);
      vi.setSystemTime(new Date('2026-09-08T01:00:01.000Z'));
      await t.runtime.prepare(second);
    } finally { vi.useRealTimers(); }
    const before = t.runtime.all();
    expect(before.map(r => [r.spec.runId, r.createdAt])).toEqual([
      ['real-z-prepared', '2026-09-08T01:00:00.000Z'],
      ['real-a-later', '2026-09-08T01:00:01.000Z'],
    ]);
    expect(before[0]?.spec).toEqual(first);
    expect(before[0]?.events).toEqual([]);
    await t.runtime.close();

    // Model no execution here: load the durable shape of a later finished run.
    const finished = before[1]!;
    finished.status = 'completed';
    finished.trace = [{ type: 'assistant.message_completed', sequence: 1, at: '2026-09-08T01:00:02.000Z', data: { message: { content: 'Stored local fixture report' } } }];
    await writeFile(recordFile(t.state, finished.spec), JSON.stringify(finished));
    const reopened = new CodingAgentRuntime(t.state, noRecoveryModel);
    await reopened.init(); cleanup.push(() => reopened.close());
    expect(reopened.all()).toEqual([before[0], finished]);
    await reopened.prepare(first);
    expect(reopened.all()).toEqual([before[0], finished]);
    expect(t.model.requests).toHaveLength(0);
  });

  it('orders legacy events then trace timestamps, places unknown prepared records last and breaks equal times deterministically', async () => {
    const t = await fixture(() => []);
    await t.runtime.close();
    const base = (runId: string): RuntimeRecord => ({
      spec: { ...t.spec, runId }, status: 'prepared', sessionId: runId, configuration: null, events: [], trace: [], usage: [], error: null,
      nodeSha256: null, workspaceRevision: null, cancelRequested: false,
    });
    const eventRecord = base('real-z-event');
    eventRecord.status = 'completed';
    eventRecord.events = [{
      schemaVersion: 1, eventId: 'started', runRef: { aggregateType: 'Run', projectId: t.spec.projectId, goalId: t.spec.goalId, runId: eventRecord.spec.runId },
      sequence: 1, occurredAt: '2026-09-08T01:00:00.000Z', eventType: 'run_started', payload: { kind: 'started', startedAt: '2026-09-08T01:00:00.000Z' },
    }];
    const traceRecord = base('real-a-trace');
    traceRecord.status = 'completed';
    traceRecord.trace = [{ type: 'assistant.message_completed', sequence: 1, at: '2026-09-08T02:00:00.000Z', data: { message: { content: 'Legacy report' } } }];
    const equalTime = base('real-a-created');
    equalTime.createdAt = '2026-09-08T09:00:00+08:00';
    const missingA = base('real-a-unknown'), missingZ = base('real-z-unknown');
    const records = [missingZ, traceRecord, eventRecord, missingA, equalTime];
    for (const record of records) await writeFile(recordFile(t.state, record.spec), JSON.stringify(record));
    const expected = [equalTime, eventRecord, traceRecord, missingA, missingZ];
    for (let cycle = 0; cycle < 2; cycle++) {
      const reopened = new CodingAgentRuntime(t.state, noRecoveryModel); await reopened.init();
      expect(reopened.all()).toEqual(expected);
      const projection = reopened.all(); projection[0]!.spec.instruction = 'consumer mutation';
      expect(reopened.all()).toEqual(expected);
      await reopened.close();
    }
    expect(t.model.requests).toHaveLength(0);
    const persistedLegacy = JSON.parse(await readFile(recordFile(t.state, eventRecord.spec), 'utf8'));
    expect(persistedLegacy).not.toHaveProperty('createdAt');
    expect(persistedLegacy.spec).toEqual(eventRecord.spec);
  });
});
