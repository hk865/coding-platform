/**
 * S3 byte-proof probe hook. This file exists only in the scratch copies, never
 * in the repository tree. It appends one JSON line per wrapped call to
 * `${S85_PROBE_LOG}.<pool>.<pid>.jsonl` so that two Vitest workers never
 * interleave a line.
 *
 * The test identity comes from `tests/probe-setup.ts` (`expect.getState()`), the
 * call index is counted per probe name and reset in every test. `undefined` is
 * marked in the serialised form (own key `$probe`) so replay keeps missing vs
 * `undefined` vs `null` apart.
 */
import { appendFileSync } from 'node:fs';

type CurrentTest = { testPath: string; testName: string };
let current: CurrentTest = { testPath: '', testName: '' };
const counters = new Map<string, number>();

export function setProbeTest(testPath: string, testName: string): void {
  current = { testPath, testName };
}

export function resetProbeCounters(): void {
  counters.clear();
}

function replacer(_key: string, value: unknown): unknown {
  if (value === undefined) return { '$probe': 'undefined' };
  if (typeof value === 'bigint') return { '$probe': 'bigint', value: String(value) };
  return value;
}

/** The one serialisation used by both the recorder and the edge harness. */
export function serializeProbe(value: unknown): string {
  return JSON.stringify(value, replacer);
}

/**
 * Records one call. Wrappers call it after the real implementation ran; with no
 * `S85_PROBE_LOG` (the replay/edge runs) it does nothing beyond keeping the
 * per-test counters, so the same copy can serve both roles.
 */
export function probe(name: string, args: readonly unknown[], out: unknown): void {
  const log = process.env['S85_PROBE_LOG'];
  if (log === undefined || log === '') return;
  const index = counters.get(name) ?? 0;
  counters.set(name, index + 1);
  const pool = process.env['VITEST_POOL_ID'] ?? '0';
  const line = serializeProbe({
    testPath: current.testPath, testName: current.testName, probe: name, index, args, out,
  });
  appendFileSync(`${log}.${pool}.${String(process.pid)}.jsonl`, line + '\n');
}
