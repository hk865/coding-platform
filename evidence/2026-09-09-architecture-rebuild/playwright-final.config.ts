import base from './playwright-chromium.config';
import { resolve } from 'node:path';

// Keep the previous failure's evidence and use new, task-owned fixture data.
process.env['FIXTURE_DIR'] = resolve('.local/architecture-rebuild-browser-final-20260909/fixture');
process.env['FIXTURE_DATA'] = resolve('.local/architecture-rebuild-browser-final-20260909/data');
export default {
  ...base,
  outputDir: resolve('evidence/2026-09-09-architecture-rebuild/browser-output-final'),
};
