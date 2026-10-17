/**
 * Slice 8D acceptance entry A-11(2) (spec §11.6 line 743, round-2 item 8):
 * Python cannot read the analyzer output while TypeScript stays intact, both
 * through the SAME public platform fixture A-06 uses, on memory and SQLite.
 *
 * The only fault is one `garbage` line printed by a wrapper that then forwards
 * to the real interpreter and stays alive, never exiting on its own: the
 * platform must end it on the unreadable line, not learn about it at EOF or at
 * the bounded language timeout. No protocol result is fabricated.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKENDS, fixture, type GraphShape } from '../helpers/S8D-platform-fixture.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const coverageOf = (graph: GraphShape, language: string) => graph.languages.find(entry => entry.language === language);

/**
 * A real executable interpreter wrapper: one unreadable line, then the real
 * `/usr/bin/python3 "$@"` in the foreground with the original stdin, and a
 * long sleep so the shell itself never exits on its own. The shell keeps
 * stdout open after the garbage line, so the platform only sees EOF/exit when
 * it kills the group.
 */
async function garbagePythonPath() {
  const directory = await mkdtemp(join(tmpdir(), 's8d-a11-garbage-wrapper-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'python');
  await writeFile(path,
    "#!/bin/sh\nprintf 'garbage\\n'\n/usr/bin/python3 \"$@\"\nsleep 300\n");
  await chmod(path, 0o755);
  return path;
}

describe.each(BACKENDS)('A-11(2) Python failure [%s]', backend => {
  it('A-11(2) fails only Python when the analyzer output cannot be read and leaves TypeScript intact', async () => {
    const pythonPath = await garbagePythonPath();
    const f = await fixture(backend, `s8d-a11-python-failure-${backend}`, [
      ['e.py', 'import g\n'],
      ['g.py', 'x = 1\n'],
      ['src/a.ts', 'import { b } from "./b";\n'],
      ['src/b.ts', 'export const b = 1;\n'],
    ], { sourceAnalyzers: { pythonPath, unitTimeoutMs: 60_000, languageTimeoutMs: 10_000 } });
    try {
      const graph = await f.graph();

      expect(coverageOf(graph, 'python')).toEqual({
        language: 'python', files: 2, parsed: 0, edges: 'failed', reason: '分析运行失败：输出读不了',
        notes: [], issues: [], issueCount: 0, complete: false,
      });
      expect(coverageOf(graph, 'typescript')).toEqual({
        language: 'typescript', files: 2, parsed: 2, edges: 'supported', reason: null, notes: [], issues: [], issueCount: 0, complete: true,
      });
      expect(graph.edges).toEqual([{ from: 'src/a.ts', to: 'src/b.ts' }]);
    } finally {
      await f.close();
    }
  }, 120000);
});
