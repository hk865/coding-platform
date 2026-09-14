import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { createGuiServer } from '../../src/app/server.js';
import { createBuiltinProviderRegistry, type ModelClientPort, type ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';

it('runs sourced semantic queries without a plan and alongside a live writer, persists real kernel inputs and denies writes', async () => {
  const serverFactory: typeof createGuiServer = process.env['M02_SERVICE_BROWSER'] ? (await import(pathToFileURL(resolve('dist/app/server.js')).href)).createGuiServer : createGuiServer;
  const dir = await mkdtemp(join(tmpdir(), 'semantic-query-')), root = join(dir, 'source'), data = join(dir, 'data');
  await mkdir(root); await mkdir(data); await writeFile(join(root, 'README.md'), 'PUBLIC_QUERY_SOURCE_42');
  const requests: ModelRequest[] = [], builtin = createBuiltinProviderRegistry();
  let reads = 0, queryCancelled = false, queryEntered = false;
  const client: ModelClientPort = { async *stream(request, options) {
    requests.push(structuredClone(request));
    if (request.tools.some(tool => tool.name === 'edit')) { await new Promise<void>(done => { if (options.signal?.aborted) done(); else options.signal?.addEventListener('abort', () => done(), { once: true }); }); return; }
    if (JSON.stringify(request.messages).includes('QUERY_CANCEL_WAIT')) {
      queryEntered = true;
      await new Promise<void>(done => { if (options.signal?.aborted) done(); else options.signal?.addEventListener('abort', () => done(), { once: true }); });
      queryCancelled = true; return;
    }
    const common = { schemaVersion: 1 as const, requestId: request.requestId };
    if (!request.messages.some(message => message.role === 'tool')) {
      reads++;
      yield { ...common, sequence: 1, type: 'tool_call_started', callId: 'read-' + reads, name: 'read', ordinal: 0 };
      yield { ...common, sequence: 2, type: 'tool_arguments_delta', callId: 'read-' + reads, delta: JSON.stringify({ path: 'README.md' }) };
      yield { ...common, sequence: 3, type: 'usage_snapshot', usage: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 0, costUsdMicros: null } };
      yield { ...common, sequence: 4, type: 'completed', reason: 'tool_calls' };
    } else {
      expect(JSON.stringify(request.messages)).toContain('PUBLIC_QUERY_SOURCE_42');
      yield { ...common, sequence: 1, type: 'text_delta', delta: 'README.md contains PUBLIC_QUERY_SOURCE_42. The source was read using the readonly tool.' };
      yield { ...common, sequence: 2, type: 'usage_snapshot', usage: { inputTokens: 110, outputTokens: 30, cachedInputTokens: 0, costUsdMicros: null } };
      yield { ...common, sequence: 3, type: 'completed', reason: 'final_answer' };
    }
  } };
  const options = { workspaceRoots: { 'acceptance-alpha': root, 'acceptance-beta': root }, modelSettings: { directory: join(dir, 'settings'), registry: { list: () => builtin.list(), get: (id: string) => builtin.get(id), create: () => client } } };
  let app = await serverFactory(data, options), base = '', token = '';
  const scope = { projectId: 'acceptance-alpha', workspaceId: 'workspace-main', goalId: 'semantic-goal' };
  const listen = async () => { await new Promise<void>(done => app.server.listen(0, '127.0.0.1', done)); const address = app.server.address(); if (!address || typeof address === 'string') throw Error('no port'); base = 'http://127.0.0.1:' + address.port; token = ((await (await fetch(base + '/api/meta')).json()) as { workspaceToken: string }).workspaceToken; };
  const post = async (path: string, body: unknown) => { const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-platform-token': token }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() as { runs: import('../../src/execution/worker-runtime/read-only-query-runtime.js').QueryRuntimeRecord[] } }; };
  const state = async (): Promise<any> => (await fetch(base + '/api/state?' + new URLSearchParams(scope))).json();
  const until = async (read: () => Promise<any>, check: (value: any) => boolean) => { const start = Date.now(); for (;;) { const value = await read(); if (check(value)) return value; if (Date.now() - start > 20000) throw Error('timeout ' + JSON.stringify(value)); await new Promise(done => setTimeout(done, 25)); } };
  try {
    await listen();
    expect((await post('/api/model-settings', { provider: 'deepseek', model: 'labelled-query-model-stub', baseUrl: 'http://127.0.0.1', apiKey: 'LOCAL_TEST_KEY' })).status).toBe(200);
    expect((await post('/api/goals', { ...scope, requestId: scope.goalId, objective: 'Explain the source and retain independent query provenance' })).status).toBe(200);
    const question = { ...scope, requestId: 'before-plan', question: 'What does README.md contain?' };
    expect(await post('/api/real/queries', question)).toMatchObject({ status: 200, body: { queryJobId: 'real-query-before-plan' } });
    const first = await until(state, value => value.queries?.some((q: any) => q.currentAnswer));
    expect(first.graph.status).not.toBe('ready');
    expect(first.queries[0].currentAnswer.answer).toContain('PUBLIC_QUERY_SOURCE_42');
    expect(first.queries[0].currentAnswer.sources.some((source: any) => source.kind === 'workspace_source')).toBe(true);
    const observed = (await post('/api/real/queries/runs', scope)).body.runs[0];
    if (!observed) throw Error('query runtime record absent');
    expect(observed).toMatchObject({ status: 'completed', kind: 'semantic_query', budget: { maxRequests: null, maxToolCalls: null, inputTokens: null, outputTokens: null, timeoutMs: null }, roleBinding: { templateId: 'query-reader' } });
    expect(observed.usage).toHaveLength(2); expect(observed.inputDigest).toMatch(/^[a-f0-9]{64}$/); expect(observed.sourceBefore).toBe(observed.sourceAfter);
    for (const request of requests) expect(request.tools.some(tool => ['edit', 'shell'].includes(tool.name))).toBe(false);
    const count = requests.length; expect((await post('/api/real/queries', question)).status).toBe(200); expect(requests).toHaveLength(count);
    expect((await post('/api/real/queries', { ...question, question: 'Changed question' })).status).toBe(400);
    await app.close(); app = await serverFactory(data, options); await listen();
    expect((await post('/api/real/queries', question)).status).toBe(200); expect(requests).toHaveLength(count);
    expect((await post('/api/real/queries/runs', scope)).body.runs[0]).toEqual(observed);
    expect((await post('/api/real/tasks', { ...scope, requestId: 'writer', instruction: 'Wait for user cancellation.', allowWrite: true })).status).toBe(200);
    await until(state, value => value.liveRuns?.[0]?.status === 'running' && requests.some(request => request.tools.some(tool => tool.name === 'edit')));
    expect((await post('/api/real/queries', { ...scope, requestId: 'alongside-writer', question: 'Read README.md while the implementation worker is running.' })).status).toBe(200);
    const alongside = await until(state, value => value.queries?.filter((q: any) => q.currentAnswer).length === 2);
    expect(alongside.liveRuns[0].status).toBe('running'); expect(alongside.liveRuns[0].cancelRequested).toBe(false);
    expect(await readFile(join(root, 'README.md'), 'utf8')).toBe('PUBLIC_QUERY_SOURCE_42');
    await post('/api/real/cancel', { ...scope, runId: 'real-writer' });
    await until(state, value => value.liveRuns?.[0]?.status === 'cancelled' && value.agents?.agents?.rows.some((row: any) => row.runRef.runId === 'real-writer' && row.runStatus === 'ended'));
    const handoff = { ...scope, requestId: 'writer-handoff', sourceRunId: 'real-writer', reason: 'Continue the same task in a new bounded attempt after cancellation.' };
    let replacement: { status: number; body: any };
    if (process.env['M02_SERVICE_BROWSER']) {
      const requireUi = createRequire(resolve('src/ui/package.json'));
      const { chromium } = await import(pathToFileURL(requireUi.resolve('playwright-core')).href);
      const browser = await chromium.launch({ executablePath: process.env['CHROME_PATH'], headless: true, args: ['--no-sandbox'] });
      try {
        const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
        await page.goto(base); await page.getByTestId('goal-' + scope.goalId).click();
        await page.getByRole('button', { name: '交接继续', exact: true }).click();
        await page.getByLabel('继续原因与未解决事项').fill(handoff.reason);
        const response = page.waitForResponse((r: any) => r.url().endsWith('/api/real/handoff'));
        await page.getByRole('button', { name: '登记换手并继续', exact: true }).click();
        const received = await response;
        handoff.requestId = received.request().postDataJSON().requestId;
        replacement = { status: received.status(), body: await received.json() };
        await page.getByText('换手已登记；新运行按当前任务资格和权限继续。', { exact: true }).waitFor();
        const output = resolve('evidence/collaboration-memory/CM-M03-001/implementation/continuation-01/browser');
        await mkdir(output, { recursive: true });
        await page.screenshot({ path: join(output, 'handoff-accepted.png'), fullPage: true });
      } finally { await browser.close(); }
    } else replacement = await post('/api/real/handoff', handoff);

    expect(replacement, JSON.stringify(replacement)).toMatchObject({ status: 200, body: { status: 'accepted', replayed: false } });
    await until(state, value => value.liveRuns.some((run: any) => run.spec.runId === replacement.body.runId && run.status === 'running'));
    expect(await post('/api/real/handoff', handoff)).toMatchObject({ status: 200, body: { replayed: true, runId: replacement.body.runId } });
    await until(async () => requests.filter(request => request.tools.some(tool => tool.name === 'edit')), value => value.length === 2);
    expect(JSON.stringify(requests.filter(request => request.tools.some(tool => tool.name === 'edit'))[1]!.messages)).toContain(handoff.reason);
    expect(await post('/api/real/handoff', { ...handoff, reason: 'Changed request' })).toMatchObject({ status: 400 });
    expect((await post('/api/real/cancel', { ...scope, runId: replacement.body.runId })).status).toBe(200);
    await until(state, value => value.liveRuns.find((run: any) => run.spec.runId === replacement.body.runId)?.status === 'cancelled');

    await writeFile(join(root, 'README.md'), 'CHANGED_QUERY_SOURCE');
    const stale = await state() as { queries: Array<{ currentAnswer?: { stale: boolean } }> };
    expect(stale.queries.filter((query: any) => query.currentAnswer).every((query: any) => query.currentAnswer.stale)).toBe(true);
    expect(requests.filter(request => !request.tools.some(tool => tool.name === 'edit'))).toHaveLength(4);
    expect((await post('/api/real/queries', { ...scope, requestId: 'cancel-query', question: 'QUERY_CANCEL_WAIT' })).status).toBe(200);
    await until(state, value => queryEntered && value.queries.some((q: any) => q.job.queryJobId === 'real-query-cancel-query' && q.recovery?.status === 'active'));
    expect(await post('/api/real/queries/cancel', { ...scope, goalId: 'wrong-goal', queryJobId: 'real-query-cancel-query' })).toMatchObject({ status: 400 });
    if (process.env['M02_SERVICE_BROWSER']) {
      const requireUi = createRequire(resolve('src/ui/package.json'));
      const { chromium } = await import(pathToFileURL(requireUi.resolve('playwright-core')).href);
      const browser = await chromium.launch({ executablePath: process.env['CHROME_PATH'], headless: true, args: ['--no-sandbox'] });
      try {
        const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
        await page.goto(base);
        await page.getByTestId('goal-' + scope.goalId).click();
        await page.getByText('查询正在执行。', { exact: true }).waitFor();
        const output = resolve('evidence/collaboration-memory/CM-M02-001/implementation/continuation-01/browser');
        await mkdir(output, { recursive: true });
        const receipt = page.waitForResponse((r: any) => r.url().endsWith('/api/real/queries/cancel'));
        await page.getByRole('button', { name: '取消查询', exact: true }).click();
        expect((await receipt).status()).toBe(200);
        await page.getByText('用户已取消查询。', { exact: true }).waitFor();
        await page.screenshot({ path: join(output, 'cancelled-query.png'), fullPage: true });
      } finally { await browser.close(); }
    } else {
    expect(await post('/api/real/queries/cancel', { ...scope, queryJobId: 'real-query-cancel-query' })).toMatchObject({ status: 200, body: { status: 'cancelled' } });
    }

    expect(queryCancelled).toBe(true);
    const cancelled = (await state()).queries.find((q: any) => q.job.queryJobId === 'real-query-cancel-query');
    expect(cancelled).toMatchObject({ job: { status: 'closed', closeReason: { code: 'cancelled' } }, run: { outcome: 'cancelled' }, currentAnswer: null });
    expect(await post('/api/real/queries/cancel', { ...scope, queryJobId: 'real-query-cancel-query' })).toMatchObject({ status: 200 });
    const afterCancel = requests.length;
    await app.close(); app = await serverFactory(data, options); await listen();
    expect((await state()).queries.find((q: any) => q.job.queryJobId === 'real-query-cancel-query').job.closeReason.code).toBe('cancelled');
    expect(requests).toHaveLength(afterCancel);

  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
}, 60000);
