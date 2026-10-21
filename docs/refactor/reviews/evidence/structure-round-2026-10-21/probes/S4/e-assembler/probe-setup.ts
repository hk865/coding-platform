/**
 * COPY-ONLY byte-proof setup (S4/D3b). Written by
 * probes/e-assembler/apply-probes.mjs into a scratch copy; never part of the
 * repository. Before each test it fixes the capture key (relative test file,
 * test name, test run index) that the probe hook stamps on every record.
 *
 * It also seeds the two environment values the fixtures would otherwise take
 * from the machine (book §5.0 rule 3): `node:crypto.randomUUID` becomes a
 * per-process counter and `mkdtemp` gets a path from the test file's call site.
 * Ids and paths stay unique and are never erased from the captured payloads;
 * the same edits are installed in the base and the result copy.
 */
import { beforeEach, vi } from 'vitest';
import { nextTestRunIndex, probeTempSuffix, relProbePath, setProbeContext } from '../src/probe-hook.js';

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  let counter = 0;
  return {
    ...actual,
    randomUUID: (): string => {
      counter += 1;
      return '00000000-0000-4000-8000-' + counter.toString(16).padStart(12, '0');
    },
  };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    mkdtemp: async (prefix: string): Promise<string> => {
      const directory = prefix + probeTempSuffix();
      await actual.rm(directory, { recursive: true, force: true });
      await actual.mkdir(directory, { recursive: true });
      return directory;
    },
  };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    mkdtempSync: (prefix: string): string => {
      const directory = prefix + probeTempSuffix();
      actual.rmSync(directory, { recursive: true, force: true });
      actual.mkdirSync(directory, { recursive: true });
      return directory;
    },
  };
});

beforeEach(({ task }) => {
  const testPath = relProbePath(task?.file?.filepath);
  setProbeContext({ testPath, testName: task?.name ?? '', runIndex: nextTestRunIndex(testPath) });
});
