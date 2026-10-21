#!/usr/bin/env node
/**
 * Per-probe call counts of one combined log, and the zero-call probes that fail
 * the proof (book §5.0 rule 5).
 *
 * Usage: node probe-counts.mjs <combined.jsonl> [--expect probe1,probe2,...]
 */
import { readFileSync } from 'node:fs';

const [file] = process.argv.slice(2);
if (file === undefined) {
  console.error('usage: node probe-counts.mjs <combined.jsonl> [--expect p1,p2]');
  process.exit(2);
}
const expectIndex = process.argv.indexOf('--expect');
const expected = expectIndex < 0 ? [] : (process.argv[expectIndex + 1] ?? '').split(',').filter(Boolean);

const counts = new Map();
const keys = new Set();
let records = 0;
for (const line of readFileSync(file, 'utf8').split('\n')) {
  if (line === '') continue;
  const record = JSON.parse(line);
  records += 1;
  counts.set(record.probe, (counts.get(record.probe) ?? 0) + 1);
  const key = [record.testPath, record.testName, record.probe, record.index].join('\u0000');
  if (keys.has(key)) throw new Error(`duplicate key ${JSON.stringify(key)}`);
  keys.add(key);
}
console.log(`records=${String(records)} probes=${String(counts.size)}`);
for (const [probe, count] of [...counts.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
  console.log(`  ${probe}: ${String(count)}`);
}
const zero = expected.filter((probe) => (counts.get(probe) ?? 0) === 0);
for (const probe of expected) if (!counts.has(probe)) console.log(`MISSING probe: ${probe}`);
if (zero.length > 0) {
  console.log(`ZERO-CALL probes: ${zero.join(', ')}`);
  process.exit(1);
}
