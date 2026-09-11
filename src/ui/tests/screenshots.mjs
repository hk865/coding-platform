/**
 * Capture workbench screenshots for the acceptance record.
 * Seeds a goal, a sample plan, a fixture run and a query through the real API,
 * then captures light/dark themes and the three acceptance viewport sizes.
 */
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const base = process.env['BASE_URL'] ?? 'http://127.0.0.1:4399';
const out = process.env['SHOT_DIR'] ?? '.local/ui-shots';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env['CHROME_PATH'], args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
await page.getByTestId('app').waitFor({ timeout: 60_000 });

const api = async (path, body) => page.evaluate(async ({ path, body }) => {
  const meta = await (await fetch('/api/meta')).json();
  const response = await fetch(path, body === undefined ? { headers: { 'x-platform-token': meta.workspaceToken } } : { method: 'POST', headers: { 'content-type': 'application/json', 'x-platform-token': meta.workspaceToken }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}, { path, body });

const scope = { projectId: 'acceptance-alpha', workspaceId: 'workspace-main' };
const stamp = Date.now();
await api('/api/goals', { ...scope, requestId: 'shot-goal-' + stamp, objective: '让工作台显示真实计划、运行与检查记录' });
const goals = (await api('/api/state?' + new URLSearchParams(scope))).body.goals.filter(goal => goal.status === 'ready').map(goal => goal.goal);
const goalId = goals.at(-1).goalId;
await api('/api/plans/sample', { ...scope, goalId });
await api('/api/tasks/run', { ...scope, goalId, taskId: 'task-install-contract' });
await api('/api/queries', { ...scope, goalId, requestId: 'shot-query-' + stamp, question: '当前进展如何？' });
await page.waitForTimeout(3000);
await page.getByTestId('goal-' + goalId).click();
await page.waitForTimeout(2500);

const capture = async (name, width, height, theme) => {
  await page.setViewportSize({ width, height });
  if (theme === 'dark') { const scheme = await page.evaluate(() => document.documentElement.getAttribute('data-mantine-color-scheme')); if (scheme !== 'dark') await page.getByTestId('toggle-theme').click(); }
  if (theme === 'light') { const scheme = await page.evaluate(() => document.documentElement.getAttribute('data-mantine-color-scheme')); if (scheme !== 'light') await page.getByTestId('toggle-theme').click(); }
  await page.waitForTimeout(900);
  await page.screenshot({ path: out + '/' + name + '.png' });
  console.log(name, width + 'x' + height, theme, 'overflow=', await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
};
await capture('desktop-light', 1440, 900, 'light');
await capture('desktop-dark', 1440, 900, 'dark');
await capture('tablet-light', 1024, 768, 'light');
await capture('mobile-light', 390, 844, 'light');

// A file preview with a line-range reference, for the材料引用 evidence.
await page.setViewportSize({ width: 1440, height: 900 });
if (await page.getByTestId('open-dock').count()) await page.getByTestId('open-dock').click();
await page.getByTestId('tab-files').click();
await page.getByText('src', { exact: true }).click();
await page.getByText('app.py', { exact: true }).click();
await page.getByTestId('file-content').waitFor();
await page.locator('[data-line="1"]').click();
await page.locator('[data-line="3"]').click({ modifiers: ['Shift'] });
await page.getByTestId('add-reference').click();
await page.getByTestId('reference-chips').waitFor();
await page.screenshot({ path: out + '/file-reference.png' });
console.log('file-reference captured');
await browser.close();

