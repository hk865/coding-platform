import base from './playwright.config';
import { resolve } from 'node:path';
process.env['FIXTURE_DIR'] = resolve('.local/core-verification-browser-20260909-02/fixture');
process.env['FIXTURE_DATA'] = resolve('.local/core-verification-browser-20260909-02/data');
export default { ...base, outputDir: resolve('evidence/2026-09-09-core-verification/browser-output-02') };
