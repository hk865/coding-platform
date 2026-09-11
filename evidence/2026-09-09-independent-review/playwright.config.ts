import base from '../../src/ui/tests/playwright.config';
import { resolve } from 'node:path';

process.env['FIXTURE_DIR'] = resolve('.local/independent-review-browser-20260909/fixture');
process.env['FIXTURE_DATA'] = resolve('.local/independent-review-browser-20260909/data');
process.env['CODING_AGENT_BWRAP_PATH'] = resolve('.local/toolchains/bwrap/usr/bin/bwrap');
export default {
  ...base,
  outputDir: resolve('evidence/2026-09-09-independent-review/browser-output-01'),
  use: {
    ...base.use, baseURL: 'http://127.0.0.1:4439',
    launchOptions: { ...base.use.launchOptions, executablePath: '/home/han001/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome' },
  },
  webServer: {
    ...base.webServer,
    command: 'FIXTURE_RESET=1 PORT=4439 node src/ui/tests/fixture-server.mjs',
    url: 'http://127.0.0.1:4439/api/meta', reuseExistingServer: false,
  },
};
