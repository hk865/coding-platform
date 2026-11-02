import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));

/** E31-7: `GET /workbench` serves the same index page, so its links must resolve under `/workbench/`. */
describe('E31-7 board entry links', () => {
  it('j: every board link starts with /workbench/', () => {
    execFileSync(process.execPath, ['scripts/build-ui.mjs'], { cwd: root, stdio: 'pipe' });
    const html = readFileSync(`${root}dist/app/public/workbench/index.html`, 'utf8');
    const hrefs = [...html.matchAll(/<a href="([^"]+)"/g)].map((match) => match[1]);
    expect(hrefs).toHaveLength(10);
    for (const href of hrefs) expect(href!.startsWith('/workbench/')).toBe(true);
  });
});
