import base from './playwright.config';
import { resolve } from 'node:path';

// The installed browser is Chromium 1234; the package default points to absent
// revision 1243. Select the existing binary explicitly without downloading or
// replacing dependencies. Preserve the failed run's data and output directory.
process.env['FIXTURE_DIR'] = resolve('.local/architecture-rebuild-browser-20260909-chromium/fixture');
process.env['FIXTURE_DATA'] = resolve('.local/architecture-rebuild-browser-20260909-chromium/data');
export default {
  ...base,
  outputDir: resolve('evidence/2026-09-09-architecture-rebuild/browser-output-chromium'),
  use: {
    ...base.use,
    launchOptions: {
      ...base.use.launchOptions,
      executablePath: '/home/han001/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',
    },
  },
};
