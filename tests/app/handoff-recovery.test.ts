import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { it, expect, vi } from 'vitest';
import { createGuiServer } from '../../src/app/server.js';
import { DispatchWake } from '../../src/app/scheduling/dispatch-wake.js';
import { RuntimeDispatch } from '../../src/control/dispatch-engine/runtime-dispatch.js';
import { LeasedWorkerRuntime } from '../../src/control/dispatch-engine/leased-worker-runtime.js';
import { ExecutionFeedbackCompiler } from '../../src/control/plan-compiler/execution-feedback-compiler.js';
import { createBuiltinProviderRegistry, type ModelClientPort } from '../../vendor/coding-agent/dist/public-api.js';

it.each(['direct', 'wake', 'restart', 'unknown'] as const)('actual handoff %s preserves one execution and durable terminal continuation', async mode => {
  const dir = await mkdtemp(join(tmpdir(), 'handoff-recovery-')), root = join(dir, 'root');
  await mkdir(root); await writeFile(join(root, 'README.md'), 'handoff recovery fixture');
  let writerCalls = 0, hold = false;
  const feedback: string[] = [], wakes = new Set<DispatchWake>();
  const requestWake = DispatchWake.prototype.request, drive = RuntimeDispatch.prototype.drive;
  const requestFeedback = ExecutionFeedbackCompiler.prototype.request, start = LeasedWorkerRuntime.prototype.start;
  vi.spyOn(DispatchWake.prototype, 'request').mockImplementation(function (this: DispatchWake, reason) { wakes.add(this); return requestWake.call(this, reason); });
  vi.spyOn(RuntimeDispatch.prototype, 'drive').mockImplementation(function (this: RuntimeDispatch, request) {
    if (hold) return Promise.resolve({ scanned: 0, started: 0, completed: 0, pendingRemaining: 1, failures: [] });
    return drive.call(this, request);
  });
  vi.spyOn(ExecutionFeedbackCompiler.prototype, 'request').mockImplementation(function (this: ExecutionFeedbackCompiler, ref, ...args) {
    feedback.push(ref.runId); return requestFeedback.call(this, ref, ...args);
  });
  vi.spyOn(LeasedWorkerRuntime.prototype, 'start').mockImplementation(async function (this: LeasedWorkerRuntime, envelope, access) {
    const handle = await start.call(this, envelope, access);
    if (mode !== 'unknown' || !envelope.runRef.runId.startsWith('replacement-')) return handle;
    return { ...handle, pollFreshEvents: async () => {
      // Execute the real kernel/provider, but lose its terminal receipt at the
      // public RunPort boundary. No caller can claim a trusted terminal outcome.
      while (!(await handle.pollFreshEvents()).some(event => event.eventType !== 'run_started')) {}
      throw Error('Injected lost terminal receipt after actual execution');
    } };
  });
  const registry = createBuiltinProviderRegistry();
  const client: ModelClientPort = { async *stream(request, options) {
    if (request.tools.some(tool => tool.name === 'edit') && ++writerCalls === 1) {
      await new Promise<void>(done => { if (options.signal?.aborted) done(); else options.signal?.addEventListener('abort', () => done(), { once: true }); }); return;
    }
    const common = { schemaVersion: 1 as const, requestId: request.requestId };
    yield { ...common, sequence: 1, type: 'text_delta', delta: 'Work finished.' };
    yield { ...common, sequence: 2, type: 'usage_snapshot', usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0, costUsdMicros: null } };
    yield { ...common, sequence: 3, type: 'completed', reason: 'final_answer' };
  } };
  const options = { workspaceRoots: { 'acceptance-alpha': root, 'acceptance-beta': root }, modelSettings: { directory: join(dir, 'settings'),
    registry: { list: () => registry.list(), get: (id: string) => registry.get(id), create: () => client } } };
  let app = await createGuiServer(join(dir, 'data'), options), base = '', token = '';
  const scope = { projectId: 'acceptance-alpha', workspaceId: 'workspace-main', goalId: 'acceptance' };
  const listen = async () => { await new Promise<void>(done => app.server.listen(0, '127.0.0.1', done)); base = 'http://127.0.0.1:' + (app.server.address() as { port: number }).port; token = (await (await fetch(base + '/api/meta')).json() as { workspaceToken: string }).workspaceToken; };
  const post = async (path: string, body: unknown) => { const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-platform-token': token }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() as { runId: string; replayed?: boolean } }; };
  const state = async (): Promise<any> => (await fetch(base + '/api/state?' + new URLSearchParams(scope))).json();
  const until = async (check: (state: any) => boolean) => { const end = Date.now() + 20000; for (;;) { const value = await state(); if (check(value)) return value; if (Date.now() > end) throw Error('Handoff recovery timeout: ' + JSON.stringify(value.liveRuns)); await new Promise(done => setTimeout(done, 30)); } };
  try {
    await listen();
    expect((await post('/api/model-settings', { provider: 'deepseek', model: 'stub', baseUrl: 'http://127.0.0.1', apiKey: 'LOCAL_TEST_KEY' })).status).toBe(200);
    expect((await post('/api/goals', { ...scope, requestId: 'acceptance', objective: 'test' })).status).toBe(200);
    expect((await post('/api/real/tasks', { ...scope, requestId: 'writer', instruction: 'Wait.', allowWrite: true })).status).toBe(200);
    await until(() => writerCalls === 1); await post('/api/real/cancel', { ...scope, runId: 'real-writer' });
    await until(value => value.liveRuns.some((run: any) => run.spec.runId === 'real-writer' && run.canonicalStatus === 'ended'));
    hold = mode === 'wake' || mode === 'restart';
    const input = { ...scope, requestId: 'replace', sourceRunId: 'real-writer', reason: 'Continue.' };
    const replacement = await post('/api/real/handoff', input); expect(replacement.status).toBe(200);
    if (hold) expect((await state()).liveRuns.some((run: any) => run.spec.runId === replacement.body.runId)).toBe(false);
    if (mode === 'restart') { await app.close(); wakes.clear(); hold = false; app = await createGuiServer(join(dir, 'data'), options); await listen(); }
    if (mode === 'wake') { hold = false; await Promise.all([...wakes].map(wake => requestWake.call(wake, 'durable-periodic-scan'))); }
    await until(value => value.liveRuns.some((run: any) => run.spec.runId === replacement.body.runId && run.canonicalStatus === 'ended' && (mode !== 'unknown' || run.status === 'outcome_unknown')));
    if (mode !== 'unknown') await until(() => feedback.includes(replacement.body.runId));
    expect(writerCalls).toBe(2);
    if (mode === 'unknown') expect(feedback).not.toContain(replacement.body.runId);
    await app.close(); wakes.clear(); app = await createGuiServer(join(dir, 'data'), options); await listen();
    expect((await post('/api/real/handoff', input)).body).toMatchObject({ replayed: true, runId: replacement.body.runId });
    await Promise.all([...wakes].map(wake => requestWake.call(wake, 'durable-periodic-scan')));
    expect(writerCalls).toBe(2);
    if (mode === 'unknown') expect((await state()).liveRuns.find((run: any) => run.spec.runId === replacement.body.runId)?.status).toBe('outcome_unknown');
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); vi.restoreAllMocks(); }
}, 90000);

