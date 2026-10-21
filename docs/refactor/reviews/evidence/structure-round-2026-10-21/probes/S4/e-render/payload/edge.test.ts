/**
 * Copy-only edge-input harness (inventory §4 item 2), SHARED between the base
 * copy and the result copy. It imports the real functions through the adapter
 * `./edge-targets.js`, which each installer variant writes: the base variant
 * imports `context-assembler.ts`, the result variant `context-rendering.ts`,
 * `context-fact-text.ts` and `note-read-model.ts`. The case list is the same.
 *
 * One JSON line per case to `S85_EDGE_OUT`; `undefined` is marked by the probe
 * serializer. No probe log is written here (`S85_PROBE_LOG` stays empty), so
 * edge calls are not mixed into the record/replay log.
 */
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EDGE_CASES } from './edge-cases.js';
import { runProbe, serializeProbe } from './edge-targets.js';

describe('S4 edge inputs', () => {
  it('runs every edge case and writes its output', () => {
    const outPath = process.env['S85_EDGE_OUT'];
    const label = process.env['S85_EDGE_LABEL'] ?? 'copy';
    const lines = EDGE_CASES.map((entry) => {
      let out: unknown;
      let error: string | null = null;
      try {
        out = runProbe(entry.probe, entry.args);
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      }
      return serializeProbe({ label, case: entry.name, probe: entry.probe, error, out });
    });
    if (outPath !== undefined && outPath !== '') writeFileSync(outPath, lines.join('\n') + '\n');
    expect(lines.length).toBe(EDGE_CASES.length);
  });
});
