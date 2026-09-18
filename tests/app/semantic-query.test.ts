import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { expect, it, vi } from 'vitest';
import { QueryWorkspaceSourceReader } from '../../src/data/workspace-reader/query-workspace-source-reader.js';
import { createGuiServer } from '../../src/app/server.js';
import { createBuiltinProviderRegistry, type ModelClientPort, type ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';

it.each([
  ['progress', 'semantic-query-secretary-summary-v11'],
  ['architecture', 'semantic-query-adviser-cited-v11'],
  ['handoff', 'semantic-query-scribe-cited-v11'],
] as const)('runs sourced %s queries without a plan and alongside a live writer, persists real kernel inputs and denies writes', async (responsePurpose, responseGuide) => {
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
    if (JSON.stringify(request.messages).includes('OPEN_EXPLANATION')) {
      yield { ...common, sequence: 1, type: 'text_delta', delta: JSON.stringify({ schemaVersion: 1, language: 'en', blocks: [
        { kind: 'explanation', text: 'Events can reduce polling latency; polling can simplify deployment. Neither choice is universally better.\n\n```ts\nconst interval = 2000;\n```', basis: [] },
        { kind: 'suggestion', text: 'Measure latency and operational cost before choosing an approach.', basis: [] },
      ] }) };
      yield { ...common, sequence: 2, type: 'completed', reason: 'final_answer' }; return;
    }
    if (!request.messages.some(message => message.role === 'tool')) {
      reads++;
      yield { ...common, sequence: 1, type: 'tool_call_started', callId: 'read-' + reads, name: 'read', ordinal: 0 };
      yield { ...common, sequence: 2, type: 'tool_arguments_delta', callId: 'read-' + reads, delta: JSON.stringify({ path: 'README.md' }) };
      yield { ...common, sequence: 3, type: 'tool_call_started', callId: 'fact-' + reads, name: 'read_query_fact', ordinal: 1 };
      yield { ...common, sequence: 4, type: 'tool_arguments_delta', callId: 'fact-' + reads, delta: JSON.stringify({ pointer: '/material/architectureReviews', assertion: { kind: 'observation_status', expected: 'ready-empty' } }) };
      if (responsePurpose === 'progress') {
        yield { ...common, sequence: 5, type: 'tool_call_started', callId: 'rows-' + reads, name: 'read_query_fact', ordinal: 2 };
        yield { ...common, sequence: 6, type: 'tool_arguments_delta', callId: 'rows-' + reads, delta: JSON.stringify({ pointer: '/material/architectureReviews/rows' }) };
      }
      yield { ...common, sequence: responsePurpose === 'progress' ? 7 : 5, type: 'usage_snapshot', usage: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 0, costUsdMicros: null } };
      yield { ...common, sequence: responsePurpose === 'progress' ? 8 : 6, type: 'completed', reason: 'tool_calls' };
    } else {
      expect(JSON.stringify(request.messages)).toContain('PUBLIC_QUERY_SOURCE_42');
      expect(JSON.stringify(request.messages)).toContain('captured_query_input');
      yield { ...common, sequence: 1, type: 'text_delta', delta: JSON.stringify({ schemaVersion: 1, language: 'en', blocks: [
        { kind: 'fact', citation: 'F1' },
        ...(responsePurpose === 'progress' ? [{ kind: 'explanation', text: 'The captured review rows are empty.', basis: ['F2'] }] : []),
        { kind: 'explanation', text: 'README.md contains PUBLIC_QUERY_SOURCE_42. An event-driven alternative may lower latency while polling is simpler to operate.', basis: [] },
        { kind: 'suggestion', text: 'Consider measuring both alternatives before choosing.', basis: ['F1'] },
      ] }) };
      yield { ...common, sequence: 2, type: 'usage_snapshot', usage: { inputTokens: 110, outputTokens: 30, cachedInputTokens: 0, costUsdMicros: null } };
      yield { ...common, sequence: 3, type: 'completed', reason: 'final_answer' };
    }
  } };
  const options = { ...(responsePurpose === 'progress' ? { queryAnswerReviewPolicy: 'high-risk-v1' as const } : {}), workspaceRoots: { 'acceptance-alpha': root, 'acceptance-beta': root }, modelSettings: { directory: join(dir, 'settings'), registry: { list: () => builtin.list(), get: (id: string) => builtin.get(id), create: () => client } } };
  let app = await serverFactory(data, options), base = '', token = '';
  const scope = { projectId: 'acceptance-alpha', workspaceId: 'workspace-main', goalId: 'semantic-goal' };
  const listen = async () => { await new Promise<void>(done => app.server.listen(0, '127.0.0.1', done)); const address = app.server.address(); if (!address || typeof address === 'string') throw Error('no port'); base = 'http://127.0.0.1:' + address.port; token = ((await (await fetch(base + '/api/meta')).json()) as { workspaceToken: string }).workspaceToken; };
  const post = async (path: string, body: unknown) => { const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-platform-token': token }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() as { runs: import('../../src/execution/worker-runtime/read-only-query-runtime.js').QueryRuntimeRecord[] } }; };
  const state = async (): Promise<any> => (await fetch(base + '/api/state?' + new URLSearchParams(scope))).json();
  const until = async (read: () => Promise<any>, check: (value: any) => boolean) => { const start = Date.now(); for (;;) { const value = await read(); if (check(value)) return value; if (Date.now() - start > 20000) throw Error('timeout ' + JSON.stringify(value)); await new Promise(done => setTimeout(done, 25)); } };
  try {
    await listen();
    expect((await post('/api/model-settings', { provider: 'deepseek', model: 'deepseek-flash', reasoningEffort: 'max', baseUrl: 'http://127.0.0.1', apiKey: 'LOCAL_TEST_KEY' })).status).toBe(200);
    expect((await post('/api/goals', { ...scope, requestId: scope.goalId, objective: 'Explain the source and retain independent query provenance' })).status).toBe(200);
    const question = { ...scope, requestId: 'before-plan', question: 'What does README.md contain?', responsePurpose };
    expect(await post('/api/real/queries', question)).toMatchObject({ status: 200, body: { queryJobId: 'real-query-before-plan' } });
    const first = await until(state, value => value.queries?.some((q: any) => q.currentAnswer));
    expect(first.graph.status).not.toBe('ready');
    expect(first.queries[0].currentAnswer.answer).toContain('PUBLIC_QUERY_SOURCE_42');
    if (responsePurpose === 'progress' && !process.env['M02_SERVICE_BROWSER']) {
      const answer = first.queries[0].currentAnswer;
      const params = new URLSearchParams({ ...scope, queryJobId: answer.runRef.queryJobId, answerId: answer.answerId });
      const check = () => fetch(base + '/api/query-applicability?' + params);
      expect(await (await check()).json()).toMatchObject({ status: 'current', answerId: answer.answerId });
      let enter!: () => void, stopped!: () => void, release!: () => void;
      const entered = new Promise<void>(resolve => { enter = resolve; });
      const cancelled = new Promise<void>(resolve => { stopped = resolve; });
      const barrier = new Promise<void>(resolve => { release = resolve; });
      // Substitute only the public WorkspaceReader port. A blocked source read
      // must not block recorded project progress or survive its consumer.
      const source = vi.spyOn(QueryWorkspaceSourceReader.prototype, 'sourceRevision').mockImplementation(async (_project, _workspace, signal) => {
        enter();
        const abort = () => { stopped(); release(); };
        signal?.addEventListener('abort', abort, { once: true });
        try { await barrier; signal?.throwIfAborted(); return null; }
        finally { signal?.removeEventListener('abort', abort); }
      });
      const controller = new AbortController();
      const checking = fetch(base + '/api/query-applicability?' + params, { signal: controller.signal }).catch(() => null);
      try {
        await entered;
        const overview = await (await fetch(base + '/api/state?' + new URLSearchParams({ ...scope, view: 'overview' }))).json() as typeof first;
        expect(overview).toMatchObject({ applicability: { status: 'not_checked' } });
        expect(overview.queries[0].currentAnswer.answerId).toBe(answer.answerId);
        expect(source).toHaveBeenCalledTimes(1);
        controller.abort(); await cancelled; await checking;
      } finally { release(); controller.abort(); source.mockRestore(); }
    }
    expect(first.queries[0].currentAnswer.answer).toContain('empty within the cited observation scope');
    expect(first.queries[0].currentAnswer.answer).toContain('Explanation');
    expect(first.queries[0].currentAnswer.answer).toContain('Suggestion');
    expect(first.queries[0].currentAnswer.answer).not.toContain('"blocks"');
    expect(first.queries[0].currentAnswer.sources.some((source: any) => source.kind === 'workspace_source')).toBe(true);
    const citation = first.queries[0].currentAnswer.sources.find((source: any) => source.kind === 'query_fact');
    expect(JSON.parse(citation.refKey)).toMatchObject({ marker: 'F1', pointer: '/material/architectureReviews' });
    expect(JSON.parse(citation.refKey)).toMatchObject({ assertion: { kind: 'observation_status', expected: 'ready-empty' }, check: 'structured-state-only' });
    const observed = (await post('/api/real/queries/runs', scope)).body.runs[0];
    if (!observed) throw Error('query runtime record absent');
    expect(observed).toMatchObject({ factReadVersion: 4, responseGuide, result: { presentation: { schemaVersion: 1, language: 'en' } } });
    expect(JSON.stringify(requests[0]!.messages)).toContain(responseGuide);
    expect(JSON.parse(observed.input).material).toMatchObject({ verificationStages: { scope }, humanActions: { scope } });
    expect(observed).toMatchObject({ status: 'completed', kind: 'semantic_query', budget: { perResponseTokens: 131072, contextWindowTokens: 1000000, maxRequests: null, maxToolCalls: null, inputTokens: null, outputTokens: null, timeoutMs: null }, roleBinding: { templateId: 'query-reader' } });
    expect(observed.answerReview).toBeUndefined();
    expect(observed.usage).toHaveLength(2); expect(observed.inputDigest).toMatch(/^[a-f0-9]{64}$/); expect(observed.sourceBefore).toBe(observed.sourceAfter);
    for (const request of requests) expect(request.tools.some(tool => ['edit', 'shell'].includes(tool.name))).toBe(false);
    expect(requests.every(request => request.maxOutputTokens === 131072)).toBe(true);
    await post('/api/model-settings', { provider: 'deepseek', model: 'deepseek-flash', reasoningEffort: 'high', baseUrl: 'http://127.0.0.1', apiKey: '' });
    const count = requests.length; expect((await post('/api/real/queries', question)).status).toBe(200); expect(requests).toHaveLength(count);
    expect((await post('/api/real/queries', { ...question, question: 'Changed question' })).status).toBe(400);
    await app.close(); app = await serverFactory(data, options); await listen();
    expect((await post('/api/real/queries', question)).status).toBe(200); expect(requests).toHaveLength(count);
    expect((await post('/api/real/queries/runs', scope)).body.runs[0]).toEqual(observed);
    expect((await post('/api/real/tasks', { ...scope, requestId: 'writer', instruction: 'Wait for user cancellation.', allowWrite: true })).status).toBe(200);
    await until(state, value => value.liveRuns?.[0]?.status === 'running' && requests.some(request => request.tools.some(tool => tool.name === 'edit')));
    expect((await post('/api/real/queries', { ...scope, requestId: 'alongside-writer', question: 'Read README.md while the implementation worker is running.' })).status).toBe(200);
    const alongside = await until(state, value => value.queries?.filter((q: any) => q.currentAnswer).length === 2);
    expect(alongside.liveRuns[0].spec.budget.perResponseTokens).toBe(65536);
    await post('/api/model-settings', { provider: 'deepseek', model: 'deepseek-flash', reasoningEffort: 'max', baseUrl: 'http://127.0.0.1', apiKey: '' });
    const writerRequests = requests.length;
    expect((await post('/api/real/tasks', { ...scope, requestId: 'writer', instruction: 'Wait for user cancellation.', allowWrite: true })).status).toBe(200);
    expect(requests.length).toBe(writerRequests);
    expect((await state()).liveRuns[0].spec.budget.perResponseTokens).toBe(65536);
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
        const output = resolve(process.env['FACT_BROWSER_OUTPUT'] ?? 'evidence/collaboration-memory/CM-M03-001/implementation/continuation-01/browser', responsePurpose);
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
    const selected = first.queries[0].currentAnswer;
    expect(await (await fetch(base + '/api/query-applicability?' + new URLSearchParams({ ...scope, queryJobId: selected.runRef.queryJobId, answerId: selected.answerId }))).json()).toMatchObject({ status: 'not_current' });
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
        const citationPanel = page.getByTestId('query-fact-sources').first();
        await page.route('**/api/real/queries/runs', async (route: any) => { const response = await route.fetch(); const body = await response.json(); body.runs = body.runs.map((run: any) => ({ ...run, input: run.input + ' ' })); await route.fulfill({ response, json: body }); });
        await page.getByRole('button', { name: '查看引用 F1', exact: true }).first().click();
        await citationPanel.getByText('引用与持久输入版本不一致', { exact: true }).waitFor();
        await page.unroute('**/api/real/queries/runs');
        await citationPanel.locator('summary').click();
        await page.getByRole('button', { name: '查看引用 F1', exact: true }).first().click();
        await citationPanel.getByText('以下是回答时捕获的记录；引用存在不代表结论一定成立，也不证明当前源码已验收。', { exact: true }).waitFor();
        await citationPanel.locator('pre').filter({ hasText: '"rows": []' }).waitFor();
        await citationPanel.getByText(/输入版本：/).waitFor();
        await citationPanel.getByText(/来源范围：.*捕获时间：/).waitFor();
        await citationPanel.getByTestId('query-fact-assertion').filter({ hasText: 'observation_status = ready-empty' }).waitFor();
        const applicability = page.locator(`[data-testid="answer-applicability"][data-answer-id="${selected.answerId}"]`);
        await applicability.getByRole('button', { name: '检查当前适用性' }).click();
        await applicability.getByTestId('answer-applicability-result').filter({ hasText: '不能据此断言某个来源已经变化' }).waitFor();
        await applicability.getByText(/检查时间：.*观察版本：/).waitFor();
        if (responsePurpose === 'progress') {
          await page.getByRole('button', { name: '查看引用 F2', exact: true }).first().click();
          await citationPanel.getByText(/来源范围：该引用未提供范围标签/).waitFor();
          expect(await citationPanel.locator('pre').textContent()).toBe('[]');
          expect(await citationPanel.getByTestId('query-fact-assertion').count()).toBe(0);
          await citationPanel.getByRole('button', { name: '查看全部引用' }).click();
          expect(await citationPanel.locator('pre').count()).toBe(2);
        }
        const output = resolve(process.env['FACT_BROWSER_OUTPUT'] ?? 'evidence/collaboration-memory/CM-M02-001/implementation/continuation-01/browser', responsePurpose);
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
    expect((await post('/api/real/queries', { ...scope, requestId: 'open-explanation', responsePurpose, question: 'OPEN_EXPLANATION: Compare event-driven and polling designs with an example, without making claims about this project.' })).status).toBe(200);
    const open = await until(state, s => s.queries.some((q: any) => q.job.queryJobId === 'real-query-open-explanation' && q.currentAnswer));
    const openAnswer = open.queries.find((q: any) => q.job.queryJobId === 'real-query-open-explanation').currentAnswer;
    expect(openAnswer.answer).toContain('Neither choice is universally better');
    expect(openAnswer.answer).toContain('```ts\nconst interval = 2000;\n```');
    expect(openAnswer.sources.some((source: any) => source.kind === 'query_fact')).toBe(false);
    expect(requests.length).toBe(afterCancel + 1);

  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
}, 60000);
