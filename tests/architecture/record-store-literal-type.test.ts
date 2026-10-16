/**
 * S3.3 (decision 66): no query in the SQLite RecordStore backend may bind the
 * `aggregateType` on the right of `json_extract(...aggregateType') = ?`. A
 * per-type lookup index added after this round makes such a query re-plan on
 * every execution (measured 15-20x slower on cached reads), so the type must
 * always be a validated literal (`sqlite-sql-literals.ts`).
 *
 * The scan reads the source text of every `.ts` file under
 * `src/core/record-store/`; `tests/` fixtures are not scanned.
 */
import { describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RECORD_STORE = join(project, 'src/core/record-store');
const FORBIDDEN = /aggregateType'\s*\)\s*=\s*\?/;

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(full)));
    else if (entry.name.endsWith('.ts')) files.push(full);
  }
  return files;
}

describe('record-store literal aggregateType (S3.3)', () => {
  it('binds no aggregateType parameter under src/core/record-store', async () => {
    const offenders: string[] = [];
    for (const file of await sourceFiles(RECORD_STORE)) {
      const text = await readFile(file, 'utf8');
      if (FORBIDDEN.test(text)) offenders.push(relative(project, file));
    }
    expect(offenders).toEqual([]);
  });
});
