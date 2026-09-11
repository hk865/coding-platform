import base from '../../src/ui/tests/playwright.config';
import { resolve } from 'node:path';

// Use the already verified build and fresh, task-owned fixture data. Tests keep
// their original assertions/timeouts; only the port and output locations differ.
const directory = '.local/architecture-rebuild-browser-20260909';
process.env['FIXTURE_DIR'] = resolve(directory, 'fixture');
process.env['FIXTURE_DATA'] = resolve(directory, 'data');

export default {
  ...base,
  outputDir: resolve('evidence/2026-09-09-architecture-rebuild/browser-output'),
  use: { ...base.use, baseURL: 'http://127.0.0.1:4419' },
  webServer: {
    ...base.webServer,
    command: `FIXTURE_RESET=1 PORT=4419 node src/ui/tests/fixture-server.mjs`,
    url: 'http://127.0.0.1:4419/api/meta',
    reuseExistingServer: false,
  },
};
