/**
 * UI-12 / R3 / R5 / R8 acceptance: one independent real project, a real model,
 * real command checks, a server restart, and a comparison of what the UI shows
 * with the persisted server facts.
 *
 * Usage:
 *   UI12_SETTINGS_DIR=~/.config/agent-platform/<hash> UI12_DATA=.local/ui12-data-repair \
 *   UI12_RESET=1 UI12_OUT=.local/ui12-evidence-repair node src/ui/tests/ui12-acceptance.mjs
 *
 * UI12_DATA defaults to .local/ui12-data and is only deleted when UI12_RESET=1,
 * so an existing evidence store is never destroyed by a routine run.
 */
import { chromium } from 'playwright-core';
import { execFileSync, spawn } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '../../..');
const port = Number(process.env['UI12_PORT'] ?? 4400);
const base = 'http://127.0.0.1:' + port;
const dataDir = resolve(process.env['UI12_DATA'] ?? repo + '/.local/ui12-data');
const projectDir = resolve(process.env['UI12_PROJECT'] ?? '/tmp/ui12-acceptance-project');
const templateDir = resolve(process.env['UI12_TEMPLATE'] ?? repo + '/.local/ui12-template');
const outDir = resolve(process.env['UI12_OUT'] ?? repo + '/.local/ui12-evidence');
const log = line => { console.log(new Date().toISOString().slice(11, 19), line); };
const report = { kind: 'ui-12-real-model-acceptance', startedAt: new Date().toISOString(), steps: [], errors: [] };
const step = (name, detail) => { report.steps.push({ name, detail, at: new Date().toISOString() }); log('STEP ' + name + ' ' + (detail ?? '')); };
const ensure = (condition, message) => { if (!condition) throw new Error(message); };

// The acceptance must exercise the artifact built for this run, never a bundle left
// behind by an earlier build. UI12_SKIP_BUILD=1 is only for a deliberate re-check.
if (process.env['UI12_SKIP_BUILD'] !== '1') {
  log('building the served artifact…');
  execFileSync('pnpm', ['run', 'build'], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
  step('build', 'kernel + backend + workbench rebuilt');
}

if (process.env['UI12_RESET'] === '1') await rm(dataDir, { recursive: true, force: true });
await rm(projectDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await cp(templateDir, projectDir, { recursive: true });
await mkdir(dataDir, { recursive: true });
report.paths = { dataDir, projectDir, outDir, settingsDir: process.env['UI12_SETTINGS_DIR'] ?? null };

function startServer() {
  const child = spawn(process.execPath, [resolve(import.meta.dirname, 'real-server.mjs')], { cwd: repo, env: { ...process.env, UI12_PORT: String(port), UI12_DATA: dataDir, UI12_PROJECT: projectDir }, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((ready, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('server start timeout: ' + output)), 120_000);
    child.stdout.on('data', chunk => { output += String(chunk); if (output.includes('READY')) { clearTimeout(timer); ready(child); } });
    child.stderr.on('data', chunk => { output += String(chunk); });
    child.on('exit', code => { if (!output.includes('READY')) { clearTimeout(timer); reject(new Error('server exited ' + code + ': ' + output)); } });
  });
}
const stopServer = child => new Promise(done => { child.once('exit', done); child.kill('SIGTERM'); setTimeout(() => { child.kill('SIGKILL'); done(); }, 20000).unref(); });

const browser = await chromium.launch({ executablePath: process.env['CHROME_PATH'], args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', error => report.errors.push('pageerror: ' + String(error)));
// A deliberately restarted server (connection refused) and the deliberately
// dropped response in the pending-request step (ERR_FAILED) are expected.
page.on('console', message => { if (message.type() !== 'error') return; const text = message.text(); if (text.includes('ERR_CONNECTION_REFUSED') || text.includes('ERR_FAILED')) return; report.errors.push('console: ' + text.slice(0, 300)); });

const api = async (path, body) => page.evaluate(async ({ path, body }) => {
  const meta = await (await fetch('/api/meta')).json();
  const response = await fetch(path, body === undefined ? { headers: { 'x-platform-token': meta.workspaceToken } } : { method: 'POST', headers: { 'content-type': 'application/json', 'x-platform-token': meta.workspaceToken }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}, { path, body });
const state = async (goalId) => (await api('/api/state?' + new URLSearchParams({ projectId: 'acceptance-alpha', workspaceId: 'workspace-main', ...(goalId ? { goalId } : {}) }))).body;

let server = await startServer();
try {
  await page.goto(base + '/workbench', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('app').waitFor({ timeout: 60_000 });
  step('open', 'workbench loaded');

  // 1. Create the goal through the UI and confirm the app switched to it.
  await page.getByTestId('new-goal').click();
  await page.getByTestId('goal-objective').fill('实现 word_count 并通过项目测试');
  await page.getByTestId('create-goal').click();
  await page.waitForTimeout(3000);
  const goals = (await state()).goals.filter(goal => goal.status === 'ready').map(goal => goal.goal);
  const goal = goals.at(-1);
  if (!goal || goal.objective !== '实现 word_count 并通过项目测试') throw new Error('goal not created: ' + JSON.stringify(goals.map(item => item.objective)));
  report.goalId = goal.goalId;
  step('goal', goal.goalId);

  // 2. Reference the source file from the explorer.
  await page.getByTestId('tab-files').click();
  await page.getByText('src', { exact: true }).click();
  await page.getByText('words.py', { exact: true }).click();
  await page.getByTestId('file-content').waitFor();
  await page.locator('[data-line="1"]').click();
  await page.locator('[data-line="3"]').click({ modifiers: ['Shift'] });
  await page.getByTestId('add-reference').click();
  await page.getByTestId('reference-chips').waitFor();
  report.reference = await page.getByTestId('reference-chips').innerText();
  step('reference', report.reference.replace(/\n/g, ' '));

  // 3. Submit the real task and fail fast if the server rejects it.
  const instruction = [
    'Implement word_count(text) in src/words.py so the existing tests in tests/test_words.py pass.',
    'A word is a run of letters and digits; every other character separates words; keys are lowercase.',
    'Return {} when there are no words, and raise TypeError for non-string input.',
    'Do not edit the tests or README. Run: python3 -m unittest discover -s tests -v and report the result and any unresolved issue.',
  ].join(' ');
  await page.getByTestId('composer-input').fill(instruction);
  await page.getByTestId('allow-write').check();
  // The default submission must carry no cumulative limit at all.
  let postedBudget = null;
  const captureBudget = async route => { postedBudget = route.request().postDataJSON().budget; await route.continue(); };
  await page.route('**/api/real/tasks', captureBudget);
  await page.getByTestId('submit-task').click();
  await page.waitForTimeout(4000);
  await page.unroute('**/api/real/tasks', captureBudget);
  const submitError = await page.getByTestId('submit-error').count();
  if (submitError) throw new Error('submit rejected: ' + (await page.getByTestId('submit-error').innerText()));
  report.submittedBudget = postedBudget;
  ensure(postedBudget && postedBudget.inputTokens === null && postedBudget.outputTokens === null && postedBudget.maxRequests === null
    && postedBudget.maxToolCalls === null && postedBudget.timeoutMs === null, 'the UI sent a cumulative limit the operator never configured: ' + JSON.stringify(postedBudget));
  ensure(typeof postedBudget.contextWindowTokens === 'number' && postedBudget.contextWindowTokens > 0 && typeof postedBudget.perResponseTokens === 'number', 'declared capacities missing');
  step('submitted', 'real task submitted; cumulative budget = ' + JSON.stringify({ inputTokens: postedBudget.inputTokens, outputTokens: postedBudget.outputTokens, maxRequests: postedBudget.maxRequests, maxToolCalls: postedBudget.maxToolCalls, timeoutMs: postedBudget.timeoutMs }));

  // 4. Wait for the real run to reach a terminal state (this uses real model calls).
  let run = null;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const current = await state(goal.goalId);
    run = (current.liveRuns ?? [])[0] ?? null;
    if (run && !['prepared', 'running'].includes(run.status)) break;
    if (attempt % 6 === 0) log('run status: ' + (run ? run.status + ' requests=' + run.usage.length + ' events=' + run.trace.length : 'waiting for run'));
    await page.waitForTimeout(5000);
  }
  if (!run) throw new Error('no real run appeared');
  report.run = {
    runId: run.spec.runId, status: run.status, error: run.error,
    model: run.configuration?.model, configurationRevision: run.configuration?.revision,
    requests: run.usage.length, usage: run.usage, toolCalls: run.trace.filter(event => event.type === 'tool.started').length,
    traceTypes: [...new Set(run.trace.map(event => event.type))],
    budget: run.spec.budget,
    instruction: run.spec.instruction.slice(0, 200),
  };
  ensure(run.usage.length > 0, 'the real run reported no usage');
  ensure(run.status === 'completed', 'the real run did not complete: ' + run.status + ' ' + (run.error ?? ''));
  step('run finished', run.status + ' · requests=' + run.usage.length + ' · tools=' + report.run.toolCalls);
  await page.screenshot({ path: outDir + '/run.png' });

  // 5. Real check commands: PASS through the UI, FAIL and timeout through the API.
  const scope = { projectId: 'acceptance-alpha', workspaceId: 'workspace-main', goalId: goal.goalId, runId: run.spec.runId };
  await page.getByTestId('tab-verification').click();
  await page.getByTestId('check-command').fill('python3 -m unittest discover -s tests -v');
  await page.getByTestId('run-check').click();
  await page.getByTestId('check-message').filter({ hasText: '检查已受理' }).waitFor({ timeout: 120_000 });
  const failing = await api('/api/real/verifications/run-check', { ...scope, requestId: 'ui12-fail', kind: 'dynamic', command: 'python3 -c "import sys; sys.exit(3)"', timeoutMs: 60000, allowExecute: true });
  const timedOut = await api('/api/real/verifications/run-check', { ...scope, requestId: 'ui12-timeout', kind: 'dynamic', command: 'python3 -c "import time; time.sleep(30)"', timeoutMs: 3000, allowExecute: true });
  ensure(failing.status === 200 && timedOut.status === 200, 'fail/timeout checks were rejected');
  await page.getByTestId('refresh').click();
  await page.waitForTimeout(2500);
  const afterChecks = await state(goal.goalId);
  const checks = afterChecks.liveRuns?.[0]?.commandChecks ?? [];
  report.checks = { records: checks, failing: failing.body, timedOut: timedOut.body };
  ensure(checks.length === 3, 'expected three check records, saw ' + checks.length);
  const passCheck = checks.find(check => check.requestId && (check.command ?? '').includes('unittest'));
  ensure(passCheck, 'the UI check record is missing its command projection');
  ensure(checks.every(check => check.startedAt && check.finishedAt), 'check records lack lifecycle timestamps');
  step('checks', checks.map(check => check.requestId + ':' + (check.result?.observations?.[0]?.result ?? '?')).join(' '));

  // 6. The normal (non-raw) report area must show command, verdict, output and source.
  const passReport = await api('/api/real/verifications/check-report', { ...scope, requestId: passCheck.requestId });
  report.checks.passReport = passReport.body;
  await page.getByTestId('report-' + passCheck.requestId).click();
  await page.getByTestId('check-report').waitFor();
  const reportText = await page.getByTestId('check-report').innerText();
  report.uiReport = reportText.slice(0, 1200);
  for (const expected of ['记录状态', '检查结束', 'python3 -m unittest', '检查类型', '行为测试', 'PASS（通过）', '来源摘要', '工作区版本', '计划版本', '报告正文']) {
    ensure(reportText.includes(expected), 'the report area does not show ' + expected + ': ' + reportText.slice(0, 500));
  }
  const bodyText = await page.getByTestId('report-body-0').innerText();
  report.uiReportBody = bodyText.slice(0, 800);
  for (const expected of ['工具检查', 'PASS（通过）', '退出码 / 超时']) {
    ensure(bodyText.includes(expected), 'the report body does not show ' + expected + ': ' + bodyText.slice(0, 400));
  }
  ensure(/\n0(\n|$)/.test(bodyText) || bodyText.includes('0\n'), 'the report body does not show the exit code: ' + bodyText.slice(0, 300));
  const output = (await page.getByTestId('report-stdout-0').innerText()) + (await page.getByTestId('report-stderr-0').innerText());
  ensure(output.includes('ok') || output.includes('OK') || output.includes('Ran '), 'the report area does not show the command output: ' + output.slice(0, 200));
  ensure(reportText.includes(String(passReport.body.reports[0].context.workspaceRevision)), 'the report area does not show the workspace revision');
  ensure(reportText.includes(passReport.body.reports[0].definition.command), 'the report area does not show the persisted command');
  ensure(reportText.includes(passReport.body.reports[0].sourceDigest.slice(0, 12)), 'the report area does not show the source digest');
  await page.screenshot({ path: outDir + '/checks.png' });
  step('ui report', 'command/verdict/exit/output/source visible');

  // 7. A second explicit execution of the same command is a NEW record with its own report.
  const firstIds = checks.map(check => check.requestId);
  await page.getByTestId('run-check').click();
  await page.getByTestId('check-message').filter({ hasText: '检查已受理' }).waitFor({ timeout: 120_000 });
  await page.getByTestId('refresh').click();
  await page.waitForTimeout(2500);
  const afterRepeat = (await state(goal.goalId)).liveRuns?.[0]?.commandChecks ?? [];
  const newRecords = afterRepeat.filter(check => !firstIds.includes(check.requestId));
  report.repeatCheck = { before: firstIds.length, after: afterRepeat.length, newIds: newRecords.map(check => check.requestId) };
  ensure(newRecords.length === 1, 'a new execution must create exactly one new record, saw ' + newRecords.length);
  ensure(newRecords[0].command.includes('unittest'), 'the new record lost its command');
  const newReport = await api('/api/real/verifications/check-report', { ...scope, requestId: newRecords[0].requestId });
  ensure(newReport.body.reports?.length === 1, 'the new execution has no independent report');
  step('repeat check', 'new record ' + newRecords[0].requestId);

  // 8. Unknown outcome for a check: the server committed, the response was dropped,
  //    and the retry replays the same request instead of creating another record.
  let droppedRequestId = '';
  let dropped = false;
  const dropCheck = async route => {
    const body = route.request().postDataJSON();
    if (!dropped) { dropped = true; droppedRequestId = body.requestId; await route.fetch(); await route.abort('failed'); return; }
    await route.continue();
  };
  await page.route('**/api/real/verifications/run-check', dropCheck);
  const beforeDrop = (await state(goal.goalId)).liveRuns?.[0]?.commandChecks?.length ?? 0;
  await page.getByTestId('run-check').click();
  await expectMessage(page, '结果未知');
  await page.getByTestId('check-pending').waitFor({ timeout: 30_000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByTestId('app').waitFor({ timeout: 60_000 });
  await page.getByTestId('tab-verification').click();
  await page.getByTestId('check-pending').waitFor({ timeout: 30_000 });
  const pendingText = await page.getByTestId('check-pending').innerText();
  ensure(pendingText.includes(droppedRequestId), 'the pending request id did not survive the reload: ' + pendingText);
  await page.getByTestId('run-check').click();
  await page.getByTestId('check-message').filter({ hasText: '检查已受理' }).waitFor({ timeout: 120_000 });
  await page.unroute('**/api/real/verifications/run-check', dropCheck);
  await page.getByTestId('refresh').click();
  await page.waitForTimeout(2500);
  const afterDrop = (await state(goal.goalId)).liveRuns?.[0]?.commandChecks ?? [];
  const replayed = afterDrop.find(check => check.requestId === droppedRequestId);
  report.pendingCheck = { requestId: droppedRequestId, before: beforeDrop, after: afterDrop.length, replayed: !!replayed };
  ensure(replayed, 'the retry did not reuse the original request id');
  ensure(afterDrop.length === beforeDrop + 1, 'the retry created a duplicate record: ' + beforeDrop + ' -> ' + afterDrop.length);
  step('pending check retry', 'replayed ' + droppedRequestId);

  // 9. Restart the server and confirm the persisted facts and reports survive.
  await stopServer(server);
  server = await startServer();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByTestId('app').waitFor({ timeout: 60_000 });
  await page.waitForTimeout(4000);
  const reopened = await state(goal.goalId);
  const reopenedReport = await api('/api/real/verifications/check-report', { ...scope, requestId: passCheck.requestId });
  report.restart = {
    runId: (reopened.liveRuns ?? [])[0]?.spec.runId ?? null,
    runStatus: (reopened.liveRuns ?? [])[0]?.status ?? null,
    reportEqual: JSON.stringify(reopenedReport.body) === JSON.stringify(passReport.body),
    commandChecks: ((reopened.liveRuns ?? [])[0]?.commandChecks ?? []).map(check => check.requestId + ':' + check.status + ':' + (check.command ?? 'no-command')),
    goalStatus: reopened.goalStatus,
  };
  ensure(report.restart.reportEqual, 'the persisted report changed across a restart');
  ensure(report.restart.commandChecks.every(entry => !entry.includes('no-command')), 'a check record lost its command projection after restart');
  step('restart', JSON.stringify({ runStatus: report.restart.runStatus, reportEqual: report.restart.reportEqual, checks: report.restart.commandChecks }));

  // 10. The run must not have completed the goal, and the UI must show the same facts.
  report.goal = { status: reopened.goalStatus?.status, phase: reopened.goalStatus?.status === 'ready' ? reopened.goalStatus.goal.phase : null };
  ensure(report.goal.phase !== 'COMPLETED', 'the goal was completed without independent acceptance: ' + JSON.stringify(report.goal));
  report.files = { words: await readFile(resolve(projectDir, 'src/words.py'), 'utf8') };
  await page.getByTestId('tab-verification').click();
  await page.getByTestId('report-' + passCheck.requestId).click();
  await page.getByTestId('check-report').waitFor();
  const reopenedText = await page.getByTestId('check-report').innerText();
  report.uiAfterRestart = reopenedText.slice(0, 400);
  for (const expected of ['python3 -m unittest', 'PASS（通过）']) ensure(reopenedText.includes(expected), 'the reopened report lost ' + expected);
  await page.screenshot({ path: outDir + '/reopened.png' });
  step('goal', 'phase=' + report.goal.phase);
} catch (error) {
  report.errors.push(String(error && error.stack ? error.stack : error));
  log('ERROR ' + String(error));
  try { await page.screenshot({ path: outDir + '/failure.png' }); } catch { /* ignore */ }
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(outDir + '/report.json', JSON.stringify(report, null, 2));
  await browser.close();
  await stopServer(server);
  log('REPORT ' + outDir + '/report.json');
  log(JSON.stringify({ run: report.run?.status, requests: report.run?.requests, checks: report.checks ? report.checks.records?.map(c => c.requestId) : [], restart: report.restart, goal: report.goal, errors: report.errors }, null, 2));
  process.exit(report.errors.length ? 1 : 0);
}

async function expectMessage(page, text) {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const body = await page.getByTestId('right-workbench').innerText();
    if (body.includes(text)) return;
    if (Date.now() > deadline) throw new Error('message not shown: ' + text);
    await page.waitForTimeout(500);
  }
}
