import { chromium } from '/mnt/c/Users/han001/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createGuiServer } from '../../dist/app/server.js';
if (process.env.RAT01_LIVE !== '1') throw Error('Set RAT01_LIVE=1 only for an authorized live connection test.');
const data = resolve('.local/gui');
let app, browser;
const checks = [], connections = [];
async function start() {
  app = await createGuiServer(data);
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${app.server.address().port}`;
}
async function openSettings(page) {
  await page.locator('#model-settings-open').click();
  await page.waitForFunction(() => document.querySelector('#model-settings-status').textContent !== '正在读取…');
}
async function save(page, key) {
  await page.locator('#model-provider').selectOption('deepseek');
  await page.locator('#model-name').fill('deepseek-v4-flash-vision-exp');
  await page.locator('#model-base-url').fill('https://api.deepseek.com');
  await page.locator('#model-key').fill(key);
  const saved = page.waitForResponse(r => r.url().endsWith('/api/model-settings') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  const response = await saved; assert.equal(response.status(), 200);
  const value = await response.json(); assert.equal(value.keyConfigured, true); assert(!JSON.stringify(value).includes(key));
  await page.waitForFunction(() => document.querySelector('#model-settings-status').textContent.includes('配置已保存'));
  assert.equal(await page.locator('#model-key').inputValue(), ''); return value;
}
try {
  let key = (await readFile('/mnt/d/1.project/Software/agent_learn/agent_api.txt', 'utf8')).trim();
  if (!/^sk-[A-Za-z0-9_-]+$/.test(key)) throw Error('凭据文件不是预期的单个密钥格式；未调用提供方');
  let base = await start();
  browser = await chromium.launch({ executablePath: '/home/han001/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', () => errors.push('browser script error'));
  await page.goto(base); await openSettings(page);
  const saved = await save(page, key); checks.push('gui-save-and-masked-read');
  await page.reload(); await openSettings(page);
  assert.equal(await page.locator('#model-name').inputValue(), 'deepseek-v4-flash-vision-exp');
  assert.equal(await page.locator('#model-key').inputValue(), '');
  checks.push('refresh-preserves-settings-without-secret');
  await app.close(); app = undefined; base = await start();
  await page.goto(base); await openSettings(page);
  assert((await page.locator('#model-revision').textContent()).includes(saved.configuration.revision)); checks.push('actual-service-restart');
  const live = page.waitForResponse(r => r.url().endsWith('/api/model-settings/test'), { timeout: 45000 });
  await page.locator('#model-connection-test').click();
  const result = await (await live).json(); connections.push(result);
  await page.waitForFunction(() => !document.querySelector('#model-connection-test').disabled);
  await page.screenshot({ path: 'evidence/rat-01/settings-connection.png' });
  assert(!JSON.stringify(result).includes(key));
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, url: location.href }));
  assert(!storage.includes(key)); checks.push('no-key-in-browser-storage-url-or-response');
  // Clear and restore through the same UI; the unconfigured probe must not contact a provider.
  await page.locator('#model-key-clear').click();
  await page.waitForFunction(() => document.querySelector('#model-settings-status').textContent.includes('密钥已清除'));
  const cleared = page.waitForResponse(r => r.url().endsWith('/api/model-settings/test'));
  await page.locator('#model-connection-test').click(); assert.equal((await (await cleared).json()).code, 'not_configured');
  await page.waitForFunction(() => !document.querySelector('#model-connection-test').disabled);
  checks.push('gui-clear-prevents-future-provider-use');
  const restored = await save(page, key); assert.notEqual(restored.configuration.revision, saved.configuration.revision); key = '';
  checks.push('gui-credential-update-new-revision');
  assert.equal(errors.length, 0); checks.push('no-browser-script-errors');
  const report = { status: result.ok ? 'PASS' : 'FAIL', checks, connections, finalConfiguration: restored.configuration, credentialRestored: true, rawPromptsSaved: false, browserTraceRecorded: false };
  await writeFile('evidence/rat-01/browser-live.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const report = { status: 'FAIL', checks, connections, error: error instanceof Error ? error.message.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]') : 'browser test failed' };
  await writeFile('evidence/rat-01/browser-live.json', JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report)); process.exitCode = 1;
} finally { await browser?.close(); await app?.close(); }
