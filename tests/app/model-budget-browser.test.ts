import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';

// This is a compiled-product browser/HTTP/kernel test with a labelled model
// substitute. It does not call DeepSeek or certify real answer quality.
for (const surface of ['workbench', 'legacy'] as const) it.skipIf(!process.env['M02_SERVICE_BROWSER'])(`${surface} leaves capacities to the configured model, preserves explicit limits and request identity`, async () => {
  const { createGuiServer } = await import(pathToFileURL(resolve('dist/app/server.js')).href);
  const { createBuiltinProviderRegistry } = await import(pathToFileURL(resolve('vendor/coding-agent/dist/public-api.js')).href);
  const requireUi = createRequire(resolve('src/ui/package.json'));
  const { chromium } = await import(pathToFileURL(requireUi.resolve('playwright-core')).href);
  const dir = await mkdtemp(join(tmpdir(), 'ui-model-budget-')), root = join(dir, 'source'), data = join(dir, 'data');
  await mkdir(root); await mkdir(data); await writeFile(join(root, 'README.md'), 'Isolated browser budget acceptance source.');
  const requests: any[] = [], submissions: any[] = [], builtin = createBuiltinProviderRegistry();
  const client = { async *stream(request: any) {
    requests.push(structuredClone(request));
    const common = { schemaVersion: 1, requestId: request.requestId };
    const input = JSON.stringify(request.messages);
    const requirements = [{ requirementId: 'behavior', kind: 'dynamic', requirementLevel: 'required', description: 'Independently check current behavior.' }];
    if (input.includes('Reviewer runs are created by the verification workflow')) requirements.push({ requirementId: 'review', kind: 'reviewer', requirementLevel: 'required', description: 'Independently review current source and original evidence.' });
    const plan = { kind: 'plan', summary: 'Inspect the isolated source, then independently verify.', assignments: [{ taskId: 'work', role: 'executor', instruction: 'Inspect README.md and report the current implementation; independent verification remains required.' }], plan: {
      stages: [{ stageId: 'stage', title: 'Implementation' }], tasks: [
        { taskId: 'work', stageId: 'stage', title: 'Implementation', taskKind: 'work', requirementLevel: 'required', disposition: 'active', phase: 'pending', scope: { kind: 'stage', stageId: 'stage' } },
        { taskId: 'gate', title: 'Independent acceptance', taskKind: 'gate', requirementLevel: 'required', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } }],
      obligations: [{ obligationId: 'contract', title: 'Current behavior', requirementLevel: 'required', taskIds: ['work', 'gate'], verificationRequirements: requirements }],
      taskHierarchy: { parentOf: [{ parentTaskId: 'gate', childTaskId: 'work' }] }, executionDag: { dependsOn: [{ taskId: 'gate', dependsOnId: 'work', requires: { kind: 'artifact', label: 'Implementation' } }] } } };
    yield { ...common, sequence: 1, type: 'text_delta', delta: input.includes('Return one JSON object with kind') ? JSON.stringify(plan) : 'Deterministic worker report; independent verification remains outstanding.' };
    yield { ...common, sequence: 2, type: 'usage_snapshot', usage: { inputTokens: 100, outputTokens: 70, cachedInputTokens: 0, costUsdMicros: null } };
    yield { ...common, sequence: 3, type: 'completed', reason: 'final_answer' };
  } };
  const app = await createGuiServer(data, { workspaceRoots: { 'acceptance-alpha': root, 'acceptance-beta': root }, modelSettings: { directory: join(dir, 'settings'), registry: { list: () => builtin.list(), get: (id: string) => builtin.get(id), create: () => client } } });
  await new Promise<void>(done => app.server.listen(0, '127.0.0.1', done));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const token = ((await (await fetch(base + '/api/meta')).json()) as any).workspaceToken;
  const post = async (path: string, body: unknown) => { const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-platform-token': token }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() as any }; };
  const browser = await chromium.launch({ executablePath: process.env['CHROME_PATH'], headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const endpoint = surface === 'workbench' ? '/api/real/work' : '/api/real/tasks';
  page.on('request', (request: any) => { if (request.url() === base + endpoint && request.method() === 'POST') submissions.push(request.postDataJSON()); });
  const settings = async (reasoningEffort: 'max' | 'high') => expect((await post('/api/model-settings', { provider: 'deepseek', model: 'deepseek-flash', reasoningEffort, baseUrl: 'http://127.0.0.1', apiKey: 'LOCAL_TEST_KEY' })).status).toBe(200);
  const state = async (scope: Record<string, string>) => await (await fetch(base + '/api/state?' + new URLSearchParams(scope), { headers: { 'x-platform-token': token } })).json() as any;
  const untilCompleted = async (scope: Record<string, string>, runId?: string) => {
    let current: any;
    await expect.poll(async () => { current = await state(scope); return current.liveRuns?.find((run: any) => (!runId || run.spec.runId === runId) && run.status === 'completed')?.status; }, { timeout: 45000, interval: 1000 }).toBe('completed');
    return current.liveRuns.find((run: any) => (!runId || run.spec.runId === runId) && run.status === 'completed');
  };
  const unlimited = { inputTokens: null, outputTokens: null, maxRequests: null, maxToolCalls: null, timeoutMs: null };
  const scopeFor = (name: string) => ({ projectId: 'acceptance-alpha', workspaceId: 'workspace-main', goalId: surface + '-' + name });
  const open = async (scope: Record<string, string>, instruction: string) => {
    await page.goto(base + '/' + surface + '?' + new URLSearchParams(scope), { waitUntil: 'domcontentloaded' });
    if (surface === 'workbench') {
      await page.getByTestId('composer-input').fill(instruction);
      await page.getByTestId('allow-write').check();
    } else {
      await page.locator('#compose-real-task').click();
      await page.locator('#real-task-instruction').fill(instruction);
      await page.locator('#real-task-write').check();
    }
  };
  const click = async () => {
    const response = page.waitForResponse((response: any) => response.url() === base + endpoint && response.request().method() === 'POST');
    await (surface === 'workbench' ? page.getByTestId('submit-task') : page.locator('#real-task-submit')).click();
    const received = await response; expect(received.status(), await received.text()).toBe(200);
    return received.request().postDataJSON();
  };
  try {
    for (const [name, effort, expectedCapacity] of [['max-default', 'max', 131072], ['high-default', 'high', 65536]] as const) {
      await settings(effort);
      const scope = scopeFor(name), instruction = 'Inspect the isolated source for ' + name;
      expect((await post('/api/goals', { ...scope, requestId: scope.goalId, objective: instruction })).status).toBe(200);
      await open(scope, instruction);
      const before = requests.length, body = await click();
      // Untouched UI values are not user overrides, including hidden controls.
      expect(body.budget).toEqual(unlimited);
      const run = await untilCompleted(scope);
      expect(run.spec.budget).toEqual({ contextWindowTokens: 1000000, ...unlimited, perResponseTokens: expectedCapacity });
      expect(requests.length).toBeGreaterThan(before);
      expect(requests.slice(before).map(request => request.maxOutputTokens)).toEqual(Array(requests.length - before).fill(expectedCapacity));
      await settings(effort === 'max' ? 'high' : 'max');
      const calls = requests.length;
      expect((await post(endpoint, body)).status).toBe(200);
      expect((await untilCompleted(scope, run.spec.runId)).spec.budget).toEqual(run.spec.budget);
      expect(requests.length).toBe(calls);
    }
    await settings('max');
    const scope = scopeFor('explicit'), instruction = 'Inspect with explicitly chosen limits';
    expect((await post('/api/goals', { ...scope, requestId: scope.goalId, objective: instruction })).status).toBe(200);
    await open(scope, instruction);
    if (surface === 'workbench') {
      await page.getByRole('button', { name: '本次运行限额', exact: true }).click();
      await page.getByLabel('上下文容量（声明值）', { exact: true }).fill('200000');
      await page.getByLabel('单次响应输出', { exact: true }).fill('16384');
      await page.getByTestId('budget-input-tokens').fill('123456');
    } else {
      await page.locator('#real-task-dialog summary').click();
      await page.locator('#real-context').fill('200000');
      await page.locator('#real-input-limit').fill('123456');
      await page.locator('#real-output-limit').fill('10000');
      await page.locator('#real-request-limit').fill('4');
      await page.locator('#real-tool-limit').fill('8');
      await page.locator('#real-time-limit').fill('90');
    }
    const before = requests.length, body = await click(), run = await untilCompleted(scope);
    const explicit = surface === 'workbench'
      ? { contextWindowTokens: 200000, ...unlimited, inputTokens: 123456, perResponseTokens: 16384 }
      : { contextWindowTokens: 200000, inputTokens: 123456, outputTokens: 10000, maxRequests: 4, maxToolCalls: 8, timeoutMs: 90000 };
    expect(body.budget).toEqual(explicit);
    expect(run.spec.budget).toEqual({ ...explicit, perResponseTokens: surface === 'workbench' ? 16384 : 131072 });
    // An explicit cumulative output allowance also bounds this actual call.
    expect(requests.slice(before).map(request => request.maxOutputTokens)).toEqual(Array(requests.length - before).fill(surface === 'workbench' ? 16384 : 10000));

    const clearScope = scopeFor('clear-capacities'), clearInstruction = 'Keep an explicit cumulative input limit after clearing capacity overrides';
    expect((await post('/api/goals', { ...clearScope, requestId: clearScope.goalId, objective: clearInstruction })).status).toBe(200);
    await open(clearScope, clearInstruction);
    if (surface === 'workbench') {
      await page.getByRole('button', { name: '本次运行限额', exact: true }).click();
      await page.getByLabel('上下文容量（声明值）', { exact: true }).fill('500000');
      await page.getByLabel('上下文容量（声明值）', { exact: true }).fill('');
      await page.getByLabel('单次响应输出', { exact: true }).fill('16384');
      await page.getByLabel('单次响应输出', { exact: true }).fill('');
      await page.getByTestId('budget-input-tokens').fill('1000000');
    } else {
      await page.locator('#real-task-dialog summary').click();
      await page.locator('#real-context').fill('500000');
      await page.locator('#real-context').fill('');
      for (const id of ['real-output-limit', 'real-request-limit', 'real-tool-limit', 'real-time-limit']) {
        await page.locator('#' + id).fill('8');
        await page.locator('#' + id).fill('');
      }
      await page.locator('#real-input-limit').fill('1000000');
    }
    const clearBefore = requests.length, cleared = await click(), clearRun = await untilCompleted(clearScope);
    expect(cleared.budget).toEqual({ ...unlimited, inputTokens: 1000000 });
    expect(clearRun.spec.budget).toEqual({ contextWindowTokens: 1000000, ...unlimited, inputTokens: 1000000, perResponseTokens: 131072 });
    expect(requests.slice(clearBefore).map(request => request.maxOutputTokens)).toEqual(Array(requests.length - clearBefore).fill(131072));

    if (surface === 'workbench') {
      // Simulate an already-committed old UI request whose receipt was lost.
      // Preserve its exact historical property order: the v1 digest uses JSON.stringify.
      const oldScope = scopeFor('old-pending'), oldInstruction = 'Recover the old explicit 4096 request';
      const oldBudget = { contextWindowTokens: 128000, inputTokens: null, outputTokens: null, maxRequests: null, maxToolCalls: null, timeoutMs: null, perResponseTokens: 4096 };
      const oldBody = { ...oldScope, requestId: 'old-ui-request', instruction: oldInstruction, allowWrite: true, references: [], budget: oldBudget };
      expect((await post('/api/goals', { ...oldScope, requestId: oldScope.goalId, objective: oldInstruction })).status).toBe(200);
      expect((await post(endpoint, oldBody)).status).toBe(200);
      await untilCompleted(oldScope);
      await page.evaluate(async ({ scope, instruction, budget, requestId }: any) => {
        const scopeKey = [scope.projectId, scope.workspaceId, scope.goalId].map(encodeURIComponent).join('::');
        const payload = [scope.projectId, scope.workspaceId, scope.goalId, instruction, [], true, budget];
        const fingerprint = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload))))].map(byte => byte.toString(16).padStart(2, '0')).join('');
        localStorage.setItem('agent-platform.workbench.pending.v1', JSON.stringify({ [scopeKey]: { 'real-task': { requestId, fingerprint, kind: 'real-task', scopeKey, createdAt: new Date().toISOString() } } }));
      }, { scope: oldScope, instruction: oldInstruction, budget: oldBudget, requestId: oldBody.requestId });
      await open(oldScope, oldInstruction);
      const submittedBefore = submissions.length, calls = requests.length;
      await page.getByTestId('submit-task').click();
      await page.getByTestId('submit-error').filter({ hasText: '旧请求结果仍未确定' }).waitFor();
      expect(submissions.length).toBe(submittedBefore);
      await page.getByRole('button', { name: '本次运行限额', exact: true }).click();
      await page.getByLabel('上下文容量（声明值）', { exact: true }).fill('128000');
      await page.getByLabel('单次响应输出', { exact: true }).fill('4096');
      const replay = await click();
      expect(replay.requestId).toBe(oldBody.requestId);
      expect(replay.budget).toEqual(oldBudget);
      expect((await untilCompleted(oldScope)).spec.budget).toEqual(oldBudget);
      expect(requests.length).toBe(calls);
    }
  } finally {
    await writeFile(join(dir, 'browser-budget-evidence.json'), JSON.stringify({ surface, submissions, requests, boundary: 'Compiled browser → real HTTP/Host/persisted Runtime budgets and actual kernel ModelRequests; deterministic model substitute, no provider quality claim.' }, null, 2));
    console.log('Budget browser evidence:', dir);
    await browser.close(); await app.close();
  }
}, 240000);
