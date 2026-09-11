import base from './playwright.config';
import { resolve } from 'node:path';
process.env['FIXTURE_DIR'] = resolve('.local/independent-review-browser-20260909-final-04/fixture');
process.env['FIXTURE_DATA'] = resolve('.local/independent-review-browser-20260909-final-04/data');
export default { ...base, outputDir: resolve('evidence/2026-09-09-independent-review/browser-output-final-04') };
