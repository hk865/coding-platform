#!/usr/bin/env node
/**
 * Explains a base-run1 / base-run2 log difference without erasing anything.
 * Matches by the proof key (test file, test name, probe, call index) and reports
 * how many differ only in `args`, how many in `out`, the exact field paths and
 * the first out difference with the §5.0 rule-4 byte detail.
 *
 * Usage: node determinism.mjs <run1.jsonl> <run2.jsonl> [--report out.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { compareValues } from './lib/compare.mjs';

const [first, second] = process.argv.slice(2);
const reportIndex = process.argv.indexOf('--report');
const reportPath = reportIndex < 0 ? '' : process.argv[reportIndex + 1];

function read(file) {
  const map = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line === '') continue;
    const record = JSON.parse(line);
    const key = [record.testPath, record.testName, record.probe, record.index].join('\u0000');
    if (map.has(key)) throw new Error(`duplicate key ${JSON.stringify(key)}`);
    map.set(key, { record, line });
  }
  return map;
}
function walk(left, right, path, out) {
  if (Object.is(left, right)) return;
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null
    || Array.isArray(left) !== Array.isArray(right)) {
    out.add(path);
    return;
  }
  if (Array.isArray(left)) {
    for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
      walk(left[index], right[index], `${path}[${String(index)}]`, out);
    }
    return;
  }
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    walk(left[key], right[key], `${path}.${key}`, out);
  }
}

const one = read(first);
const two = read(second);
let identical = 0;
let argOnly = 0;
let outDiff = 0;
const byProbe = new Map();
const argPaths = new Set();
const outPaths = new Set();
const firstOutDifference = [];

for (const [key, left] of one) {
  const right = two.get(key);
  if (right === undefined) throw new Error(`run2 is missing ${JSON.stringify(key)}`);
  const bucket = byProbe.get(left.record.probe) ?? { records: 0, differing: 0, argOnly: 0, outDiff: 0 };
  bucket.records += 1;
  byProbe.set(left.record.probe, bucket);
  if (left.line === right.line) { identical += 1; continue; }
  bucket.differing += 1;
  const argFields = new Set();
  const outFields = new Set();
  walk(left.record.args, right.record.args, 'args', argFields);
  walk(left.record.out, right.record.out, 'out', outFields);
  for (const path of argFields) argPaths.add(`${left.record.probe}${path}`);
  for (const path of outFields) outPaths.add(`${left.record.probe}${path}`);
  if (outFields.size === 0) { argOnly += 1; bucket.argOnly += 1; } else {
    outDiff += 1;
    bucket.outDiff += 1;
    if (firstOutDifference.length === 0) {
      const found = [];
      compareValues(left.record.out, right.record.out, '$', found);
      firstOutDifference.push({
        key, testPath: left.record.testPath, testName: left.record.testName,
        index: left.record.index, first: found[0] ?? null,
      });
    }
  }
}
for (const key of two.keys()) if (!one.has(key)) throw new Error(`run1 is missing ${JSON.stringify(key)}`);

const report = {
  run1: first, run2: second,
  records: one.size, byteIdentical: identical, differing: one.size - identical,
  argOnly, outDiff,
  argPaths: [...argPaths], outPaths: [...outPaths],
  firstOutDifference,
  probes: Object.fromEntries([...byProbe.entries()].sort(([a], [b]) => (a < b ? -1 : 1))),
};
if (reportPath !== '') writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(`records=${String(report.records)} byteIdentical=${String(identical)} differing=${String(report.differing)} argOnly=${String(argOnly)} outDiff=${String(outDiff)}`);
for (const [probe, bucket] of Object.entries(report.probes)) {
  console.log(`  ${probe}: records=${String(bucket.records)} differing=${String(bucket.differing)} argOnly=${String(bucket.argOnly)} outDiff=${String(bucket.outDiff)}`);
}
if (argPaths.size > 0) console.log('arg paths:', [...argPaths].join(', '));
if (outPaths.size > 0) console.log('out paths:', [...outPaths].join(', '));
if (firstOutDifference.length > 0) console.log('first out difference:\n' + JSON.stringify(firstOutDifference[0], null, 2));
