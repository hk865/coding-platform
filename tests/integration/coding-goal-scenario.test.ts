import { it, expect } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createGuiServer as sourceGuiServer } from '../../src/app/server.js';
import { createModelSettings } from '../../src/app/model-settings.js';
import { createBuiltinProviderRegistry, type ModelClientPort, type ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import type { ReviewerPacketV1 } from '../../src/contracts/reviewer-context.js';
const createGuiServer: typeof sourceGuiServer = process.env['I01_BROWSER'] ? (await import(pathToFileURL(resolve('dist/app/server.js')).href)).createGuiServer : sourceGuiServer;

function objects(value: unknown): any[] {
  if (Array.isArray(value)) return value.flatMap(objects);
  if (value && typeof value === 'object') return [value, ...Object.values(value).flatMap(objects)];
  if (typeof value !== 'string') return [];
  return value.split('\n\n').flatMap(text => { try { return objects(JSON.parse(text)); } catch { return []; } });
}
const names = ['grouping'];
const plan = { kind: 'plan', summary: 'Repair the isolated timeline grouping regression and independently verify the goal.',
  assignments: [{ taskId: 'grouping', role: 'executor', instruction: 'Read RULES.md and src/utils/grouping.mjs. Repair the no-deadline grouping regression in grouping.mjs only. Use read and edit; preserve every other behavior. Do not edit checks. Do not claim formal completion.' }],
  plan: { stages: [{ stageId: 'coding', title: 'Repair timeline grouping' }], tasks: [
    { taskId: 'grouping', title: 'Repair grouping', taskKind: 'work', stageId: 'coding', requirementLevel: 'required', disposition: 'active', phase: 'pending', scope: { kind: 'stage', stageId: 'coding' } },
    { taskId: 'goal-gate', title: 'Accept timeline grouping', taskKind: 'gate', requirementLevel: 'required', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } }],
    obligations: [{ obligationId: 'timeline', title: 'Preserve timeline and nonmutation contracts', requirementLevel: 'required', taskIds: [...names, 'goal-gate'], verificationRequirements: [
      { requirementId: 'behavior', kind: 'dynamic', requirementLevel: 'required', description: 'Run node --test check.mjs for no deadline, overdue, interval and immutable inputs.' },
      { requirementId: 'review', kind: 'reviewer', requirementLevel: 'required', description: 'Independently inspect actual grouping source and original behavior report; ensure no-deadline placement and preserved branches.' }] }],
    taskHierarchy: { parentOf: [{ parentTaskId: 'goal-gate', childTaskId: 'grouping' }] },
    executionDag: { dependsOn: [{ taskId: 'goal-gate', dependsOnId: 'grouping', requires: { kind: 'gate-result', label: 'Current independently verified task' } }] } } };
const check = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupTodos } from './src/utils/grouping.mjs';
test('no deadline is today and identities and frozen input survive', () => {
  const item = Object.freeze({id:'none'}), input = Object.freeze([item]);
  const result = groupTodos(input, '2026-09-14');
  assert.deepEqual(result.today, [item]); assert.equal(result.today[0], item); assert.deepEqual(result.far, []);
});
test('overdue tomorrow far and interval branches remain distinct', () => {
  const items = [{id:'old',due:'2026-09-13'},{id:'next',due:'2026-09-15'},{id:'far',due:'2026-10-01'}];
  const r = groupTodos(items, '2026-09-14'); assert.deepEqual(r.overdue,[items[0]]); assert.deepEqual(r.tomorrow,[items[1]]); assert.deepEqual(r.far,[items[2]]);
  const span = {id:'span',start:'2026-09-13',due:'2026-09-18'};
  assert.deepEqual(groupTodos([span],'2026-09-14','involving').today,[span]);
  assert.deepEqual(groupTodos([], '2026-09-14').today, []);
});
`;

async function scenario(real: boolean) {
  const directory = await mkdtemp(join(tmpdir(), 'coding-goal-')), root = join(directory, 'source');
  const candidate = '/mnt/d/1.project/Software/to_do_list_show';
  const relative = ['src/utils/grouping.mjs', 'shared/date.mjs'];
  const original = await Promise.all(relative.map(path => readFile(join(candidate, path))));
  const hashes = original.map(bytes => createHash('sha256').update(bytes).digest('hex'));
  const settings = real ? await createModelSettings(join(directory, 'data'), { directory: '/home/han001/.config/agent-platform/2925e9d16dbd6c81bc7fcb84' }) : null;
  const bound = await settings?.bindRun('integration-coding-goal');
  const requests: Array<{ branch: string; request: ModelRequest }> = [];
  const modelEvents: unknown[] = [];
  const builtin = createBuiltinProviderRegistry();
  const client: ModelClientPort = { async *stream(request, options) {
    const text = JSON.stringify(request.messages), returned = objects(request.messages.filter(message => message.role === 'tool'));
    const branch = text.includes('Return one JSON object with kind') ? 'planning' : request.tools.some(tool => tool.name === 'read_source') ? 'review' : request.tools.some(tool => tool.name === 'edit') ? 'coding' : 'query';
    requests.push({ branch, request: structuredClone(request) });
    if (bound && (branch === 'coding' || branch === 'review')) {
      try { for await (const event of bound.client.stream(request, options)) { modelEvents.push({ branch, event: /reasoning|thinking/.test(event.type) ? { type: event.type, requestId: event.requestId, sequence: event.sequence } : event }); yield event; } }
      catch (error) { modelEvents.push({ branch, requestId: request.requestId, thrown: error instanceof Error ? error.name : typeof error }); throw error; }
      return;
    }
    let call: { name: string; arguments: Record<string, unknown> } | undefined, answer: unknown;
    if (branch === 'planning') answer = plan;
    else if (branch === 'coding') {
      const source = returned.find(value => value.path === 'src/utils/grouping.mjs' && value.revision);
      if (!returned.some(value => value.path === 'RULES.md')) call = { name: 'read', arguments: { path: 'RULES.md' } };
      else if (!source) call = { name: 'read', arguments: { path: 'src/utils/grouping.mjs' } };
      else if (!returned.some(value => value.edit || value.changed || JSON.stringify(value).includes('newRevision'))) {
        // The next request after the edit carries its tool result; source content is retained too.
        const edited = request.messages.some(message => message.role === 'tool' && message.result.effects.sideEffect === 'confirmed');
        if (!edited) call = { name: 'edit', arguments: { mode: 'replace', path: 'src/utils/grouping.mjs', expectedRevision: source.revision, oldText: 'out.far.push(t)\n      continue', newText: 'out.today.push(t)\n      continue' } };
      }
      answer = 'The isolated grouping regression is repaired. Independent verification remains required.';
    } else if (branch === 'review') {
      const delivered = objects(request.messages), packet = delivered.find(value => value.kind === 'independent-review-packet') as ReviewerPacketV1;
      expect(packet).toBeDefined();
      const binding = delivered.find(value => value.reviewId && value.packetDigest);
      const source = returned.find(value => value.materialId === 'source:src/utils/grouping.mjs' && value.truncated === false);
      if (!source) call = { name: 'read_source', arguments: { path: 'src/utils/grouping.mjs', startLine: 1, maxLines: 150 } };
      else {
        const missing = packet.materials.find(material => !returned.some(value => value.ref?.digest === material.ref.digest && value.complete === true));
        if (missing) call = { name: 'read_material', arguments: { materialId: missing.materialId, offset: Math.max(0, ...returned.filter(value => value.ref?.digest === missing.ref.digest).map(value => Number(value.nextOffset) || 0)), maxBytes: 32768 } };
        else {
          expect(source.content).toContain('out.today.push(t)');
          const report = packet.materials.find(material => material.kind === 'tool-report')!;
          answer = { schemaVersion: 1, kind: 'independent-review-result', reviewId: packet.workRef.reviewId, descriptorDigest: packet.descriptorDigest, packetDigest: binding.packetDigest, sourceDigest: packet.materialIdentity.sourceDigest,
            citations: [{ citationId: 'source', materialId: source.materialId, digest: source.sourceDigest, location: { kind: 'source-lines', path: 'src/utils/grouping.mjs', startLine: 11, endLine: 14 } }, { citationId: 'checks', materialId: report.materialId, digest: report.ref.digest, location: { kind: 'artifact-section', pointer: '/result' } }],
            requirements: packet.coverage.map(({ obligationId, requirementId }) => ({ obligationId, requirementId, result: 'PASS', rationale: 'Actual no-deadline branch retains item identity in today; original tests cover frozen input and other branches.', citationIds: ['source', 'checks'], issueIds: [], unknowns: [] })), issues: [] };
        }
      }
    } else answer = 'Progress: independent verification is pending.';
    const common = { schemaVersion: 1 as const, requestId: request.requestId };
    if (call) {
      yield { ...common, sequence: 1, type: 'tool_call_started', callId: 'call-' + requests.length, name: call.name, ordinal: 0 };
      yield { ...common, sequence: 2, type: 'tool_arguments_delta', callId: 'call-' + requests.length, delta: JSON.stringify(call.arguments) };
    } else yield { ...common, sequence: 1, type: 'text_delta', delta: typeof answer === 'string' ? answer : JSON.stringify(answer) };
    yield { ...common, sequence: call ? 3 : 2, type: 'completed', reason: call ? 'tool_calls' : 'final_answer' };
  } };
  let app: Awaited<ReturnType<typeof createGuiServer>> | undefined;
  let browser: any, page: any;
  const evidence: Record<string, unknown> = { candidate, originalHashes: hashes, model: bound?.configuration ?? 'labelled-deterministic-protocol', boundary: 'Real HTTP host, SQLite, kernel read/edit, isolated real project module, independent command execution and Reviewer. Planning is deterministic. Real mode uses DeepSeek for Coding and both independent Reviews. The regression is deliberately injected only in the isolated copy.' };
  try {
    for (const path of relative) { await mkdir(join(root, path, '..'), { recursive: true }); await copyFile(join(candidate, path), join(root, path)); }
    // The process sandbox intentionally has a fixed /usr/bin:/bin PATH; this
    // host's Node 24 lives in the user's toolchain. Provision only its executable
    // inside this disposable workspace; do not alter the host or relax sandboxing.
    await mkdir(join(root, '.cache'), { recursive: true });
    await copyFile(process.execPath, join(root, '.cache/node'));
    evidence['nodeVersion'] = process.version;
    const buggy = original[0]!.toString().replace('out.today.push(t)', 'out.far.push(t)').replaceAll('\r\n', '\n');
    await writeFile(join(root, relative[0]!), buggy);
    await writeFile(join(root, 'RULES.md'), 'A todo with no due date belongs to today, retaining object identity. Preserve overdue, explicit date and involving-mode interval behavior. Do not mutate caller input. Repair only src/utils/grouping.mjs. check.mjs is immutable acceptance.');
    await writeFile(join(root, 'check.mjs'), check);
    const hostOptions = { workspaceRoots: { 'acceptance-alpha': root }, modelSettings: { directory: join(directory, 'settings'), registry: { list: () => builtin.list(), get: (id: string) => builtin.get(id), create: () => client } } };
    app = await createGuiServer(join(directory, 'data'), hostOptions);
    let base = '', token = '';
    const listen = async () => { await new Promise<void>(done => app!.server.listen(0, '127.0.0.1', done)); const address = app!.server.address(); if (!address || typeof address === 'string') throw Error('No port'); base = 'http://127.0.0.1:' + address.port; token = ((await (await fetch(base + '/api/meta')).json()) as any).workspaceToken; };
    const post = async (path: string, body: unknown): Promise<any> => { const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-platform-token': token }, body: JSON.stringify(body) }); const result = await response.json(); expect(response.status, JSON.stringify(result)).toBe(200); return result; };
    const scope = { projectId: 'acceptance-alpha', workspaceId: 'workspace-main', goalId: 'timeline-goal' };
    const state = async (): Promise<any> => (await fetch(base + '/api/state?' + new URLSearchParams(scope))).json();
    await listen();
    await post('/api/model-settings', { provider: 'deepseek', model: bound?.configuration.model ?? 'labelled-protocol', baseUrl: bound?.configuration.baseUrl ?? 'http://127.0.0.1', apiKey: 'LOCAL_TEST_KEY' });
    await post('/api/goals', { ...scope, requestId: scope.goalId, objective: 'Repair no-deadline timeline grouping in the isolated todo module; preserve other branches and verify independently.' });
    await post('/api/real/work', { ...scope, requestId: 'timeline-work', instruction: 'Read RULES.md and repair the isolated grouping regression. Preserve acceptance tests.', allowWrite: true, ...(real ? { budget: { perResponseTokens: 32768 } } : {}) });
    let current: any;
    await expect.poll(async () => { current = await state(); return current.liveRuns?.find((run: any) => run.spec.taskId === 'grouping')?.status; }, { timeout: real ? 180000 : 30000 }).toBe('completed');
    const run = current.liveRuns.find((row: any) => row.spec.taskId === 'grouping');
    expect(await readFile(join(root, 'check.mjs'), 'utf8')).toBe(check);
    const implementation = await readFile(join(root, relative[0]!), 'utf8'); evidence['implementation'] = implementation;
    // A sourced explanatory comment is permitted; compare executable lines as a
    // scope guard, then let actual tests and independent Review decide behavior.
    const executableLines = (text: string) => text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('//')).join('\n');
    expect(executableLines(implementation)).toBe(executableLines(original[0]!.toString()));
    expect(await readFile(join(root, relative[1]!), 'utf8')).toBe(original[1]!.toString());
    expect(current.matrix.status).toBe('ready');
    expect(current.matrix.matrix.rows.find((row: any) => row.taskId === 'goal-gate').livePhase).not.toBe('satisfied');
    const verify = async (gate: boolean) => {
      const target = { ...scope, runId: run.spec.runId, taskId: gate ? 'goal-gate' : 'grouping', ...(gate ? { gateSubject: 'goal' } : {}) };
      let requestId = gate ? 'goal-check' : 'task-check', round: any;
      if (gate && process.env['I01_BROWSER']) {
        const requireUi = createRequire(resolve('src/ui/package.json'));
        const { chromium } = await import(pathToFileURL(requireUi.resolve('playwright-core')).href);
        browser = await chromium.launch({ executablePath: process.env['CHROME_PATH'], headless: true, args: ['--no-sandbox'] });
        page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
        page.setDefaultTimeout(15000);
        page.setDefaultNavigationTimeout(20000);
        const navigation = await page.goto(base + '/workbench?' + new URLSearchParams(scope));
        expect(navigation?.status(), 'The built workbench must be served before browser interaction').toBe(200);
        await page.getByTestId('tab-verification').click();
        await page.getByTestId('round-gate').click();
        await page.getByRole('option', { name: 'Accept timeline grouping', exact: true }).click();
        await page.getByTestId('round-check-command-0').fill('./.cache/node --test check.mjs');
        await page.getByTestId('round-check-timeout-0').fill('10');
        const response = page.waitForResponse((value: any) => value.url().endsWith('/api/real/verifications/rounds/start'));
        await page.getByTestId('start-verification-round').click();
        const received = await response;
        expect(received.status()).toBe(200); round = await received.json(); requestId = round.round.requestId;
        expect(round.round.scope).toEqual(target);
      } else round = await post('/api/real/verifications/rounds/start', { ...target, requestId, allowExecute: true, configuration: { checks: [{ checkId: requestId, kind: 'dynamic', command: './.cache/node --test check.mjs', cwd: '.', timeoutMs: 10000, appliesTo: { workspaceId: scope.workspaceId, taskIds: [target.taskId] } }] } });
      evidence[requestId] = round;
      evidence[requestId + '-report'] = await post('/api/real/verifications/check-report', { ...scope, runId: run.spec.runId, requestId: round.round.checks[0].requestId });
      expect(round.round.outcome, JSON.stringify(round)).toBe('INCONCLUSIVE');
      const profile = await post('/api/real/verifications/reviews/profile', target);
      expect(profile.status, JSON.stringify(profile)).toBe('ready');
      let started: any, reviewRequestId = requestId + '-review';
      if (gate && page) {
        await page.getByTestId('prepare-review').click();
        const response = page.waitForResponse((value: any) => value.url().endsWith('/api/real/verifications/reviews/start'));
        await page.getByTestId('start-review').click();
        const received = await response; expect(received.status()).toBe(200); started = await received.json(); reviewRequestId = started.review.requestId;
        expect(started.review.scope).toEqual(target);
      } else started = await post('/api/real/verifications/reviews/start', { ...target, requestId: reviewRequestId, roundRequestId: requestId, reviewerConfigRef: profile.ref, allowExecute: true });
      let review: any;
      await expect.poll(async () => { review = await post('/api/real/verifications/reviews/read', { ...target, requestId: reviewRequestId }); evidence[requestId + '-review'] = review;
        const observed = await state(); evidence['latestState'] = observed;
        const reviewerRun = observed.liveRuns.find((row: any) => row.spec.runId === review.work?.reviewerRunRef.runId);
        return ['settled', 'assessment_rejected', 'work_rejected'].includes(review.phase) || ['failed', 'outcome_unknown', 'budget_exhausted', 'cancelled'].includes(reviewerRun?.status);
      }, { timeout: real ? 180000 : 30000 }).toBe(true);
      expect(review.phase, JSON.stringify(review)).toBe('settled');
      expect(review.formal.taskPhase, JSON.stringify(review)).toBe('satisfied');
      if (gate) expect(review.formal.goalPhase).toBe('COMPLETED');
      else expect(review.formal.goalPhase).not.toBe('COMPLETED');
      expect(review.formal.evidenceRefs.length).toBeGreaterThan(0);
      if (gate && page) {
        await expect.poll(() => page.getByTestId('review-detail').innerText(), { timeout: 15000 }).toContain('COMPLETED');
        const output = resolve('evidence/collaboration-memory/batch/integration/coding-goal'); await mkdir(output, { recursive: true });
        await page.screenshot({ path: join(output, 'browser-goal-completed-' + Date.now() + '.png'), fullPage: true });
      }
      return { target, round: round.round, started, review };
    };
    evidence['task'] = await verify(false);
    evidence['gate'] = await verify(true);
    const final = await state(), before = requests.length;
    await app.close(); app = await createGuiServer(join(directory, 'data'), hostOptions); await listen();
    const recovered = await state();
    expect(recovered.liveRuns.map((row: any) => row.spec.runId).sort()).toEqual(final.liveRuns.map((row: any) => row.spec.runId).sort());
    const gate: any = evidence['gate'];
    const replay = await post('/api/real/verifications/reviews/resume', { ...gate.target, requestId: gate.review.requestId });
    expect(replay.review.formal).toEqual(gate.review.formal);
    expect(requests.length).toBe(before);
    evidence['final'] = recovered; evidence['status'] = 'PASS';
  } catch (error) { evidence['status'] = 'FAIL'; evidence['error'] = error instanceof Error ? error.message : String(error); throw error; }
  finally {
    await browser?.close(); await app?.close(); settings?.close();
    evidence['requests'] = requests;
    evidence['modelEvents'] = modelEvents;
    const output = resolve('evidence/collaboration-memory/batch/integration/coding-goal'); await mkdir(output, { recursive: true });
    await writeFile(join(output, (real ? 'real-' : 'deterministic-') + Date.now() + '.json'), JSON.stringify(evidence, null, 2));
    for (let i = 0; i < relative.length; i++) expect(createHash('sha256').update(await readFile(join(candidate, relative[i]!))).digest('hex')).toBe(hashes[i]);
    await rm(directory, { recursive: true, force: true });
  }
}

it('same isolated real todo module: Coding → independent Task checks/review → independent GoalGate → restart', () => scenario(false), 180000);
it.skipIf(!process.env['I01_REAL_MODEL'])('DeepSeek codes and independently reviews the same isolated todo module through product HTTP', () => scenario(true), 600000);
