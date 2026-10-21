#!/usr/bin/env node
/**
 * Compares two combined probe logs by `(testPath, testName, probe, index)` with
 * the book §5.0 rule-4 comparator. It prints the first structural difference
 * with the UTF-8 byte offset, both lengths and the 16 bytes around it (strings);
 * objects are compared by own keys in order, arrays element by element, and
 * `undefined` survives because the recorder marks it.
 *
 * Usage: node compare-records.mjs <left.jsonl> <right.jsonl> [--report out.json]
 *                                   [--label base-vs-base]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { compareValues } from './lib/compare.mjs';

const [leftFile, rightFile] = process.argv.slice(2);
if (leftFile === undefined || rightFile === undefined) {
  console.error('usage: node compare-records.mjs <left.jsonl> <right.jsonl> [--report out.json]');
  process.exit(2);
}
function flag(name, fallback) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}
const reportPath = flag('--report', '');
const label = flag('--label', 'compare');

function read(file) {
  const map = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line === '') continue;
    const record = JSON.parse(line);
    const key = [record.testPath, record.testName, record.probe, record.index].join('\u0000');
    if (map.has(key)) throw new Error(`duplicate key in ${file}: ${JSON.stringify(key)}`);
    map.set(key, { record, line });
  }
  return map;
}

const left = read(leftFile);
const right = read(rightFile);
const byProbe = new Map();
const details = [];
let differing = 0;

for (const [key, leftRecord] of left) {
  const rightRecord = right.get(key);
  const bucket = byProbe.get(leftRecord.record.probe)
    ?? { records: 0, differing: 0, first: null };
  bucket.records += 1;
  byProbe.set(leftRecord.record.probe, bucket);
  if (rightRecord === undefined) {
    differing += 1;
    bucket.differing += 1;
    if (bucket.first === null) bucket.first = { kind: 'missing-right', key };
    details.push({ kind: 'missing-right', key });
    continue;
  }
  if (leftRecord.line === rightRecord.line) continue;
  differing += 1;
  bucket.differing += 1;
  const found = [];
  compareValues(leftRecord.record.out, rightRecord.record.out, '$', found);
  const argsFound = [];
  compareValues(leftRecord.record.args, rightRecord.record.args, '$args', argsFound);
  const detail = {
    key, probe: leftRecord.record.probe,
    testPath: leftRecord.record.testPath, testName: leftRecord.record.testName, index: leftRecord.record.index,
    argsDiffer: argsFound.length > 0, outDiffer: found.length > 0,
    first: found[0] ?? argsFound[0] ?? null,
  };
  if (bucket.first === null) bucket.first = detail;
  details.push(detail);
}
for (const [key] of right) if (!left.has(key)) details.push({ kind: 'missing-left', key });

const probes = Object.fromEntries([...byProbe.entries()]
  .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  .map(([probe, bucket]) => [probe, bucket]));
const report = { label, left: leftFile, right: rightFile, records: left.size, differing, probes, details: details.slice(0, 200) };
if (reportPath !== '') writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');

console.log(`${label}: records=${String(left.size)} differing=${String(differing)}`);
for (const [probe, bucket] of Object.entries(probes)) {
  console.log(`  ${probe}: records=${String(bucket.records)} differing=${String(bucket.differing)}`);
}
if (details.length > 0) console.log('first difference:\n' + JSON.stringify(details[0], null, 2));
if (differing > 0 || details.some((entry) => entry.kind !== undefined)) process.exit(1);
