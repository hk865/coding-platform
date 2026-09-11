import { chromium } from '/mnt/c/Users/han001/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import { createGuiServer } from '../../dist/app/server.js';
import { resolve } from 'node:path';
const app = await createGuiServer(resolve('.local/gui'));
let browser;
try {
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  browser = await chromium.launch({ executablePath: '/home/han001/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome', headless: true, args: ['--no-sandbox'], env: { ...process.env, FONTCONFIG_FILE: resolve('.local/rat-01-fonts/fonts.conf') } });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`http://127.0.0.1:${app.server.address().port}`);
  await page.locator('#model-settings-open').click();
  await page.waitForFunction(() => document.querySelector('#model-settings-status').textContent === '' && document.querySelector('#model-name').value !== '');
  await page.screenshot({ path: 'evidence/rat-01/settings-saved.png' });
  console.log('Saved settings screenshot; no model calls.');
} finally { await browser?.close(); await app.close(); }
