import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * E32-6 (ruling items 1 and 9, row E32-6): the eight boards without a working
 * copy are still byte-identical to the frozen reference; Main and TaskMap are
 * built from `src/ui/boards/`, and `kit.css` comes from its working copy.
 */
const root = fileURLToPath(new URL('../..', import.meta.url));
const frozen = `${root}docs/ui-reference/workbench-2026-10`;
const working = `${root}src/ui/boards`;
// Its own output directory: another build test never writes into it.
const built = mkdtempSync(join(tmpdir(), 'e32-6-workbench-'));
const FROZEN_ONLY = [
  'ArchOverview', 'Chain', 'Decide', 'Done', 'Member', 'Phone', 'Plan',
] as const;
const WORKING = ['Main', 'TaskMap', 'Goals'] as const;

beforeAll(() => {
  execFileSync(process.execPath, ['scripts/build-ui.mjs', built], { cwd: root, stdio: 'pipe' });
}, 30_000);

afterAll(() => { rmSync(built, { recursive: true, force: true }); });

describe('E32-6 build sources', () => {
  it.each(FROZEN_ONLY)('%s is the frozen reference', (name) => {
    expect(readFileSync(`${built}/${name}.dc.html`).equals(readFileSync(`${frozen}/${name}.dc.html`))).toBe(true);
  });

  it.each(WORKING)('%s is the working copy', (name) => {
    expect(readFileSync(`${built}/${name}.dc.html`).equals(readFileSync(`${working}/${name}.dc.html`))).toBe(true);
  });

  it('kit.css is the working copy', () => {
    expect(readFileSync(`${built}/kit.css`).equals(readFileSync(`${working}/kit.css`))).toBe(true);
  });
});
