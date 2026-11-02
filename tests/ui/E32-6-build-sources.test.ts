import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * E32-6 (ruling items 1 and 9, row E32-6): the nine boards without a working
 * copy are still byte-identical to the frozen reference; TaskMap is the one
 * board built from `src/ui/boards/`.
 */
const root = fileURLToPath(new URL('../..', import.meta.url));
const frozen = `${root}docs/ui-reference/workbench-2026-10`;
const working = `${root}src/ui/boards`;
const built = `${root}dist/app/public/workbench`;
const FROZEN_ONLY = [
  'ArchOverview', 'Chain', 'Decide', 'Done', 'Goals', 'Main', 'Member', 'Phone', 'Plan',
] as const;

beforeAll(() => {
  execFileSync(process.execPath, ['scripts/build-ui.mjs'], { cwd: root, stdio: 'pipe' });
}, 30_000);

describe('E32-6 build sources', () => {
  it.each(FROZEN_ONLY)('%s is the frozen reference', (name) => {
    expect(readFileSync(`${built}/${name}.dc.html`).equals(readFileSync(`${frozen}/${name}.dc.html`))).toBe(true);
  });

  it('TaskMap is the working copy', () => {
    expect(readFileSync(`${built}/TaskMap.dc.html`).equals(readFileSync(`${working}/TaskMap.dc.html`))).toBe(true);
  });
});
