#!/usr/bin/env node
/**
 * Enumerate every differing leaf path between two capture directories, with a
 * count and one example pair. Analysis only: it never changes the compared
 * values, and the comparer remains the authority for equality.
 *
 * Usage: node field-diff.mjs <left-dir> <right-dir> [--json]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const leftDir = process.argv[2];
const rightDir = process.argv[3];
const asJson = process.argv.includes('--json');
if (!leftDir || !rightDir) {
  console.error('usage: node field-diff.mjs <left-dir> <right-dir> [--json]');
  process.exit(2);
}

function load(dir) {
  const records = new Map();
  for (const file of readdirSync(dir).filter(name => name.endsWith('.jsonl') && statSync(join(dir, name)).isFile())) {
    for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
      if (line === '') continue;
      const record = JSON.parse(line);
      records.set([record.testPath, record.testName, record.probe, record.callIndex].join('\u0000'), record);
    }
  }
  return records;
}

const counts = new Map();
const examples = new Map();
function note(path, left, right) {
  counts.set(path, (counts.get(path) ?? 0) + 1);
  if (!examples.has(path)) examples.set(path, [left, right]);
}
function walk(path, left, right) {
  if (typeof left === 'string' || typeof right === 'string') {
    if (left !== right) note(path, left, right);
    return;
  }
  if (typeof left === 'number' || typeof right === 'number') {
    if (!Object.is(left, right)) note(path, left, right);
    return;
  }
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
    if (!Object.is(left, right)) note(path, left, right);
    return;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) { note(path, left, right); return; }
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      if (index >= left.length || index >= right.length) note(path + '[]', left[index], right[index]);
      else walk(path + '[]', left[index], right[index]);
    }
    return;
  }
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (!(key in left) || !(key in right)) note(path + '.' + key, left[key], right[key]);
    else walk(path + '.' + key, left[key], right[key]);
  }
}

const left = load(leftDir);
const right = load(rightDir);
for (const [key, record] of left) {
  const other = right.get(key);
  if (other === undefined) { note('<record-key>', key, 'missing'); continue; }
  walk(record.probe, record.payload, other.payload);
}
const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([path, count]) => ({
  path, count, left: examples.get(path)[0], right: examples.get(path)[1],
}));
if (asJson) console.log(JSON.stringify(rows, null, 2));
else {
  for (const row of rows) {
    console.log(`${row.count}\t${row.path}\t${JSON.stringify(row.left).slice(0, 100)}\t${JSON.stringify(row.right).slice(0, 100)}`);
  }
  console.log(`\ndistinct differing leaf paths: ${rows.length}`);
}
