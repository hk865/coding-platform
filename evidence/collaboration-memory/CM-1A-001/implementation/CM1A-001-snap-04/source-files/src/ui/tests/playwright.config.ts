import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const chrome = process.env['CHROME_PATH'];
const port = Number(process.env['GUI_TEST_PORT'] ?? 4399);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid GUI_TEST_PORT');
const baseURL = `http://127.0.0.1:${port}`;

/**
 * Browser acceptance for the workbench.
 *
 * The webServer command builds first and then boots the real Node host
 * (dist/app/server.js) with two isolated fixture projects, so the browser always
 * serves the artifact built for this run. reuseExistingServer is off: a server
 * left over from an older build must never be reused. The fixture root and data
 * directory are exported to the specs so a test that touches a fixture file uses
 * exactly the path the server registered.
 */
const fixtureDir = resolve(repoRoot, process.env['FIXTURE_DIR'] ?? '.local/ui-test-fixture');
const fixtureData = resolve(repoRoot, process.env['FIXTURE_DATA'] ?? '.local/ui-test-data');
process.env['FIXTURE_DIR'] = fixtureDir;
process.env['FIXTURE_DATA'] = fixtureData;

export default defineConfig({
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: /.*\.spec\.ts$/,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL,
    viewport: { width: 1440, height: 900 },
    launchOptions: { args: ['--no-sandbox'], ...(chrome ? { executablePath: chrome } : {}) },
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `pnpm build && FIXTURE_RESET=1 PORT=${port} node src/ui/tests/fixture-server.mjs`,
    cwd: repoRoot,
    url: baseURL + '/api/meta',
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
