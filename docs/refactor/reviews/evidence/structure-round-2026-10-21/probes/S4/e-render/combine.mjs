#!/usr/bin/env node
/**
 * Combines the per-worker probe logs of one run into one file.
 *
 * Usage: node combine.mjs <dir> <prefix> <out.jsonl>
 *
 * The recorded line is kept byte-for-byte; rows are ordered by the proof key
 * (test file, test name, probe, per-test call index) so two runs can be compared
 * even when Vitest distributed the files over workers in another order.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, prefix, out] = process.argv.slice(2);
if (dir === undefined || prefix === undefined || out === undefined) {
  console.error('usage: node combine.mjs <dir> <prefix> <out.jsonl>');
  process.exit(2);
}

const rows = [];
for (const file of readdirSync(dir)
  .filter(name => name !== `${prefix}.jsonl` && name.startsWith(`${prefix}.`) && name.endsWith('.jsonl')).sort()) {
  const text = readFileSync(join(dir, file), 'utf8');
  for (const line of text.split('\n')) {
    if (line === '') continue;
    const record = JSON.parse(line);
    rows.push({
      key: [record.testPath ?? '', record.testName ?? '', record.probe ?? '', record.index ?? 0],
      line,
      file,
    });
  }
}

rows.sort((left, right) => {
  for (let index = 0; index < 3; index += 1) {
    if (left.key[index] < right.key[index]) return -1;
    if (left.key[index] > right.key[index]) return 1;
  }
  return left.key[3] - right.key[3];
});

for (let index = 1; index < rows.length; index += 1) {
  const previous = rows[index - 1].key;
  const current = rows[index].key;
  if (previous[0] === current[0] && previous[1] === current[1] && previous[2] === current[2] && previous[3] === current[3]) {
    console.error(`duplicate probe key: ${JSON.stringify(current)} in ${rows[index - 1].file} and ${rows[index].file}`);
  }
}

writeFileSync(out, rows.map(row => row.line).join('\n') + (rows.length === 0 ? '' : '\n'));
console.log(`${prefix}: ${String(rows.length)} records from ${String(new Set(rows.map(row => row.file)).size)} worker logs -> ${out}`);
