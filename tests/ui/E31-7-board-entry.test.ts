import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));

/** E31-7: `GET /workbench` serves the same index page, so its links must resolve under `/workbench/`. */
describe('E31-7 board entry links', () => {
  it('j: every board link starts with /workbench/', () => {
    // Its own output directory: another build test never writes into it.
    const out = mkdtempSync(join(tmpdir(), 'e31-7-workbench-'));
    try {
      execFileSync(process.execPath, ['scripts/build-ui.mjs', out], { cwd: root, stdio: 'pipe' });
      const html = readFileSync(join(out, 'index.html'), 'utf8');
      const hrefs = [...html.matchAll(/<a href="([^"]+)"/g)].map((match) => match[1]);
      expect(hrefs).toHaveLength(10);
      for (const href of hrefs) expect(href!.startsWith('/workbench/')).toBe(true);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
