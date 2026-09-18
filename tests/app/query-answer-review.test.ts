import { expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createGuiServer } from '../../src/app/server.js';
import { createBuiltinProviderRegistry, type ModelClientPort } from '../../vendor/coding-agent/dist/public-api.js';

it.each(['supported', 'conflict', 'citation_insufficient', 'unverifiable'] as const)('HTTP publishes before explicit answer review and preserves the original after %s', async verdict => {
  const serverFactory: typeof createGuiServer = process.env['M02_SERVICE_BROWSER'] ? (await import(pathToFileURL(resolve('dist/app/server.js')).href)).createGuiServer : createGuiServer;
  const dir = await mkdtemp(join(tmpdir(), 'query-review-http-')), root = join(dir, 'source'); await mkdir(root);
  let reviews = 0, calls = 0;
  const client: ModelClientPort = { async *stream(request) {
    calls++; const common = { schemaVersion: 1 as const, requestId: request.requestId };
    if (request.runId.startsWith('answer-audit-')) {
      reviews++; expect(request.tools).toEqual([]);
      const input = JSON.parse(request.messages[0]!.role === 'user' ? request.messages[0]!.content : (() => { throw Error('Review input must be a user message'); })());
      expect(input.facts[0].pointer).toBe('/material/architectureReviews');
      yield { ...common, sequence: 1, type: 'text_delta', delta: JSON.stringify({ blocks: input.blocks.map((entry: any) => ({ index: entry.index, verdict, claims: [{ quote: entry.block.text, verdict, markers: ['F1'], reason: 'Scoped observation fixture' }] })) }) };
      yield { ...common, sequence: 2, type: 'completed', reason: 'final_answer' }; return;
    }
    if (!request.messages.some(m => m.role === 'tool')) {
      yield { ...common, sequence: 1, type: 'tool_call_started', callId: 'facts', name: 'read_query_fact', ordinal: 0 };
      yield { ...common, sequence: 2, type: 'tool_arguments_delta', callId: 'facts', delta: JSON.stringify({ pointer: '/material/architectureReviews', assertion: { kind: 'observation_status', expected: 'ready-empty' } }) };
      yield { ...common, sequence: 3, type: 'completed', reason: 'tool_calls' };
    } else {
      yield { ...common, sequence: 1, type: 'text_delta', delta: JSON.stringify({ schemaVersion: 1, language: 'en', blocks: [{ kind: 'fact', citation: 'F1' }, { kind: 'explanation', text: 'No architecture review rows in this observation.', basis: ['F1'] }] }) };
      yield { ...common, sequence: 2, type: 'completed', reason: 'final_answer' };
    }
  } };
  const registry = createBuiltinProviderRegistry();
  const options = { queryAnswerReviewPolicy: 'high-risk-v1' as const, workspaceRoots: { 'acceptance-alpha': root }, modelSettings: { directory: join(dir, 'settings'), registry: { list: () => registry.list(), get: (id: string) => registry.get(id), create: () => client } } };
  let app = await serverFactory(join(dir, 'data'), options), base = '', token = '';
  const scope = { projectId: 'acceptance-alpha', workspaceId: 'workspace-main', goalId: 'review-goal' };
  const listen = async () => { await new Promise<void>(done => app.server.listen(0, '127.0.0.1', done)); const a = app.server.address(); if (!a || typeof a === 'string') throw Error('no port'); base = 'http://127.0.0.1:' + a.port; token = (await (await fetch(base + '/api/meta')).json() as any).workspaceToken; };
  const post = async (path: string, body: unknown): Promise<any> => { const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-platform-token': token }, body: JSON.stringify(body) }); const response = await r.json(); expect(r.status, JSON.stringify(response)).toBe(200); return response; };
  const state = async (): Promise<any> => (await fetch(base + '/api/state?' + new URLSearchParams(scope))).json();
  const question = { ...scope, requestId: 'reviewed', question: 'Current architecture review records?', responsePurpose: verdict === 'conflict' ? 'handoff' : 'architecture' };
  try {
    await listen(); await post('/api/model-settings', { provider: 'deepseek', model: 'deepseek-flash', reasoningEffort: 'max', baseUrl: 'http://127.0.0.1', apiKey: 'LOCAL_TEST_KEY' });
    await post('/api/goals', { ...scope, requestId: scope.goalId, objective: 'Inspect scoped review records' });
    await post('/api/real/queries', question);
    const started = Date.now(); let row: any;
    for (;;) { row = (await state()).queries?.find((q: any) => q.job.queryJobId === 'real-query-reviewed'); if (row?.currentAnswer || row?.run?.outcome === 'gap') break; if (Date.now() - started > 30000) throw Error('Formal Query outcome did not settle'); await new Promise(done => setTimeout(done, 200)); }
    expect(reviews).toBe(0); expect(calls).toBe(2);
    expect(row.currentAnswer.answer).toContain('No architecture review rows');
    const originalAnswer = structuredClone(row.currentAnswer);
    const reviewScope = { ...scope, queryJobId: row.job.queryJobId, answerId: row.currentAnswer.answerId };
    const request = { ...reviewScope, requestId: 'user-review-1', blocks: [1] };
    const pending = await post('/api/real/queries/review/start', request);
    expect(['running', 'completed']).toContain(pending.status);
    let review: any;
    for (let n = 0; n < 80; n++) { review = (await post('/api/real/queries/review/view', reviewScope)).reviews[0]; if (review?.status !== 'running') break; await new Promise(done => setTimeout(done, 200)); }
    expect(review).toMatchObject({ status: 'completed', assessment: { blocks: [{ index: 1, verdict }] } });
    expect(reviews).toBe(1);
    expect((await state()).queries.find((q: any) => q.job.queryJobId === row.job.queryJobId).currentAnswer).toEqual(originalAnswer);
    await post('/api/real/queries/review/start', request); expect(reviews).toBe(1);
    const rejected = await fetch(base + '/api/real/queries/review/start', { method: 'POST', headers: { 'content-type': 'application/json', 'x-platform-token': token }, body: JSON.stringify({ ...request, goalId: 'wrong-goal' }) });
    expect(rejected.status).toBe(400);
    const run = (await post('/api/real/queries/runs', scope)).runs[0];
    expect(run).toMatchObject({ factReadVersion: 4, responseGuide: verdict === 'conflict' ? 'semantic-query-scribe-cited-v11' : 'semantic-query-adviser-cited-v11' });
    expect(run.answerReview).toBeUndefined();
    const before = calls; await app.close(); app = await serverFactory(join(dir, 'data'), options); await listen();
    await post('/api/real/queries', question); expect(calls).toBe(before);
    expect((await post('/api/real/queries/runs', scope)).runs[0]).toEqual(run);
    expect((await post('/api/real/queries/review/view', reviewScope)).reviews[0]).toEqual(review);
    await post('/api/real/queries/review/start', request); expect(calls).toBe(before);
    if (process.env['M02_SERVICE_BROWSER'] && verdict === 'supported') {
      const requireUi = createRequire(resolve('src/ui/package.json'));
      const { chromium } = await import(pathToFileURL(requireUi.resolve('playwright-core')).href);
      const browser = await chromium.launch({ executablePath: process.env['CHROME_PATH'], headless: true, args: ['--no-sandbox'] });
      try {
        const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
        await page.goto(base); await page.getByTestId('goal-' + scope.goalId).click();
        const panel = page.getByTestId('query-answer-review').first();
        await panel.getByRole('button', { name: '按需复核回答', exact: true }).click();
        await panel.getByText('依据充分（模型评估）', { exact: false }).first().waitFor();
        expect(calls).toBe(before);
        await panel.getByRole('button', { name: '复核整答', exact: true }).click();
        await panel.getByText('第 1 段：依据充分（模型评估）', { exact: true }).waitFor();
        expect(reviews).toBe(2);
        await page.getByRole('button', { name: '查看引用 F1', exact: true }).first().click();
        await page.getByTestId('query-fact-sources').first().getByText('architectureReviews', { exact: false }).first().waitFor();
        const output = resolve(process.env['FACT_BROWSER_OUTPUT'] ?? 'evidence/collaboration-memory/batch/integration/semantic-reliability-19/browser-34');
        await mkdir(output, { recursive: true }); await page.screenshot({ path: join(output, 'explicit-whole-review.png'), fullPage: true });
        expect((await state()).queries.find((q: any) => q.job.queryJobId === row.job.queryJobId).currentAnswer).toEqual(originalAnswer);
      } finally { await browser.close(); }
    }
    if (process.env['M02_SERVICE_BROWSER'] && verdict === 'conflict') {
      const requireUi = createRequire(resolve('src/ui/package.json'));
      const { chromium } = await import(pathToFileURL(requireUi.resolve('playwright-core')).href);
      const browser = await chromium.launch({ executablePath: process.env['CHROME_PATH'], headless: true, args: ['--no-sandbox'] });
      try {
        const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
        await page.goto(base); await page.getByTestId('goal-' + scope.goalId).click();
        const panel = page.getByTestId('query-answer-review').first();
        await panel.getByRole('button', { name: '按需复核回答', exact: true }).click();
        await panel.getByText('第 2 段：存在冲突（模型评估）', { exact: true }).waitFor();
        const draft = page.getByTestId('semantic-question'); await draft.fill('Keep my existing draft');
        await panel.getByRole('button', { name: '将复核意见填入提问', exact: true }).click();
        await expect.poll(() => draft.inputValue()).toContain('Scoped observation fixture');
        const text = await draft.inputValue();
        expect(text).toContain('Keep my existing draft'); expect(text).toContain('Scoped observation fixture');
        expect(text).toContain('No architecture review rows in this observation.'); expect(text).toContain('待核材料');
        expect(await page.getByRole('combobox', { name: '响应用途', exact: true }).inputValue()).toBe('记录整理');
        expect(calls).toBe(before); expect(reviews).toBe(1);
        // A long editable draft is preserved and cannot silently truncate into a request.
        await draft.fill(text + 'x'.repeat(4097)); expect(await draft.inputValue()).toHaveLength(text.length + 4097);
        expect(await page.getByTestId('semantic-ask').isDisabled()).toBe(true); expect(calls).toBe(before);
        await draft.fill(text);
        let releaseSubmit!: () => void, reachedSubmit!: () => void;
        const submitGate = new Promise<void>(done => { releaseSubmit = done; }), submitEntered = new Promise<void>(done => { reachedSubmit = done; });
        await page.route(base + '/api/real/queries', async (route: any) => { reachedSubmit(); await submitGate; await route.continue(); });
        const submitted = page.waitForRequest((request: any) => request.url() === base + '/api/real/queries' && request.method() === 'POST');
        await page.getByTestId('semantic-ask').click();
        await submitEntered;
        try { await draft.fill('New draft typed while submitting'); } finally { releaseSubmit(); }
        expect((await submitted).postDataJSON()).toMatchObject({ question: text, responsePurpose: 'handoff' });
        let next: any;
        for (let n = 0; n < 100; n++) { next = (await state()).queries.find((q: any) => q.job.intent.question === text); if (next?.currentAnswer) break; await new Promise(done => setTimeout(done, 200)); }
        expect(next?.currentAnswer).toBeTruthy(); expect(next.job.intent.execution.responsePurpose).toBe('handoff');
        expect(reviews).toBe(1); expect(calls).toBe(before + 2);
        expect(await draft.inputValue()).toBe('New draft typed while submitting');
        await page.unroute(base + '/api/real/queries');
        expect((await state()).queries.find((q: any) => q.job.queryJobId === row.job.queryJobId).currentAnswer).toEqual(originalAnswer);
        // Change the actual source at the click-time read boundary, not by a sleep.
        await page.route(base + '/api/real/queries/review/view', async (route: any) => {
          await writeFile(join(root, 'revoked-before-prefill.txt'), 'Source changed before fresh view');
          await route.continue();
        });
        await panel.getByRole('button', { name: '将复核意见填入提问', exact: true }).click();
        await panel.getByText('来源或复核状态已变化，请重新查看材料。', { exact: true }).waitFor();
        expect(await draft.inputValue()).toBe('New draft typed while submitting');
        expect(calls).toBe(before + 2); expect(reviews).toBe(1);
      } finally { await browser.close(); }
    }
    const callsBeforeChange = calls;
    await writeFile(join(root, 'source-changed.txt'), 'New source after original answer');
    const stale = await post('/api/real/queries/review/view', reviewScope);
    expect(stale.available).toBe(false); expect(stale.reviews[0]).toMatchObject({ status: 'stale', assessment: null });
    const staleStart = await fetch(base + '/api/real/queries/review/start', { method: 'POST', headers: { 'content-type': 'application/json', 'x-platform-token': token }, body: JSON.stringify({ ...request, requestId: 'changed-source-review' }) });
    expect(staleStart.status).toBe(400); expect(calls).toBe(callsBeforeChange);

  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
}, 60000);
