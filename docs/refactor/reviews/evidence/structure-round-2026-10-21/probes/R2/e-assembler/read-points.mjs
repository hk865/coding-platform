#!/usr/bin/env node
/**
 * Book §5.1 "Byte proof, S4" item 4: list every declared deps read point with
 * its base file:line and whether the base capture reached it. A zero-capture
 * point is evidence in its own right, never a pass.
 *
 * Usage: node read-points.mjs <capture-dir> [declared.json]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const declaredPath = process.argv[3] ?? join(import.meta.dirname, 'declared.json');
if (!dir) {
  console.error('usage: node read-points.mjs <capture-dir> [declared.json]');
  process.exit(2);
}
const declared = JSON.parse(readFileSync(declaredPath, 'utf8'));
const counts = new Map();
for (const file of readdirSync(dir).filter(name => name.endsWith('.jsonl') && statSync(join(dir, name)).isFile())) {
  for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
    if (line === '') continue;
    const record = JSON.parse(line);
    if (record.probe !== 'deps') continue;
    const method = record.payload.method;
    counts.set(method, (counts.get(method) ?? 0) + 1);
  }
}
console.log('method\tcalls\tstatus\tbase file:line');
let zero = 0;
for (const point of declared.readPoints) {
  const calls = counts.get(point.method) ?? 0;
  if (calls === 0) zero += 1;
  console.log(`${point.method}\t${calls}\t${calls === 0 ? 'ZERO-CAPTURE' : 'reached'}\t${point.file}:${point.line}`);
}
const declaredMethods = new Set(declared.readPoints.map(point => point.method));
for (const [method, calls] of [...counts.entries()].sort()) {
  if (!declaredMethods.has(method)) console.log(`(extra) ${method}\t${calls}\treached\tnot declared`);
}
console.log(`\nzero-capture read points: ${zero}`);
process.exit(0);
