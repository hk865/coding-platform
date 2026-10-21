#!/usr/bin/env node
/**
 * S4/D3b byte comparison — book §5.0 rule 4.
 *
 *   node compare.mjs <left-jsonl-dir> <right-jsonl-dir> [--max-diffs=N] [--declared=file]
 *
 * Matches records by (relative test file, test name, probe, call index).
 * Strings: UTF-8 buffers; first differing byte offset, both lengths and the 16
 * bytes around it. Arrays: element by element, count and order kept. Objects:
 * own keys in order, missing vs undefined vs null kept apart (the hook encodes
 * undefined as a sentinel, so a missing key still produces a key-list diff).
 * Numbers exactly. Nothing is sorted or canonicalised before comparing.
 *
 * Exit 0 iff every matched payload is equal, the key sets agree, and every
 * probe the declared file marks `required` captured at least one call.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const leftDir = process.argv[2];
const rightDir = process.argv[3];
if (!leftDir || !rightDir) {
  console.error('usage: node compare.mjs <left-jsonl-dir> <right-jsonl-dir> [--max-diffs=N] [--declared=file]');
  process.exit(2);
}
const maxDiffsArg = process.argv.find(arg => arg.startsWith('--max-diffs='));
const maxDiffs = maxDiffsArg === undefined ? 20 : Number(maxDiffsArg.split('=')[1]);
const declaredArg = process.argv.find(arg => arg.startsWith('--declared='));
const declared = declaredArg === undefined ? null : JSON.parse(readFileSync(declaredArg.split('=')[1], 'utf8'));
// The assembler payload also carries the replay metadata (args/depsShape/
// depsRange). Item 1's proof target is the complete return value; this view
// compares only that, and never erases anything inside it.
const resultOnly = process.argv.includes('--result-only');

const files = dir => readdirSync(dir)
  .filter(name => name.endsWith('.jsonl') && statSync(join(dir, name)).isFile())
  .sort();

function load(dir) {
  const records = new Map();
  const lines = new Map();
  for (const file of files(dir)) {
    const raw = readFileSync(join(dir, file));
    lines.set(file, raw);
    const fileLines = raw.toString('utf8').split('\n');
    if (fileLines.at(-1) === '') fileLines.pop();
    for (const lineText of fileLines) {
      const record = JSON.parse(lineText);
      if (resultOnly && String(record.probe).startsWith('assembler:')) {
        record.payload = {
          method: record.payload.method,
          ...(record.payload.result === undefined ? {} : { result: record.payload.result }),
          ...(record.payload.threw === undefined ? {} : { threw: record.payload.threw }),
        };
      }
      const baseKey = [record.testPath, record.testName, record.probe, record.callIndex].join('\u0000');
      let key = baseKey;
      let occurrence = 1;
      while (records.has(key)) key = baseKey + '#occ' + occurrence++;
      records.set(key, { file, record, lineText });
    }
  }
  return { records, lines };
}

function hexAround(buffer, offset) {
  const start = Math.max(0, offset - 8);
  const end = Math.min(buffer.length, offset + 8);
  return buffer.subarray(start, end).toString('hex').replace(/(..)/g, '$1 ').trim();
}

let differences = 0;
let reportLimitReached = false;
function report(message) {
  differences += 1;
  if (differences <= maxDiffs) console.log(message);
  else if (!reportLimitReached) {
    console.log(`... further differences suppressed after ${maxDiffs}`);
    reportLimitReached = true;
  }
}

function compareString(path, left, right) {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  if (a.equals(b)) return;
  let offset = 0;
  while (offset < a.length && offset < b.length && a[offset] === b[offset]) offset += 1;
  report(`  string ${path}: first UTF-8 byte difference at offset ${offset}; `
    + `left length ${a.length} bytes, right length ${b.length} bytes; `
    + `left[${Math.max(0, offset - 8)}..${Math.min(a.length, offset + 8)}]=${hexAround(a, offset)}; `
    + `right[${Math.max(0, offset - 8)}..${Math.min(b.length, offset + 8)}]=${hexAround(b, offset)}`);
}

function compareValue(path, left, right) {
  if (typeof left === 'string' || typeof right === 'string') {
    if (typeof left !== 'string' || typeof right !== 'string') {
      report(`  type ${path}: left ${typeof left}, right ${typeof right}`);
      return;
    }
    compareString(path, left, right);
    return;
  }
  if (left === null || right === null) {
    if (left !== right) report(`  null ${path}: left ${String(left)}, right ${String(right)}`);
    return;
  }
  if (typeof left === 'number' || typeof right === 'number') {
    if (typeof left !== 'number' || typeof right !== 'number') {
      report(`  type ${path}: left ${typeof left}, right ${typeof right}`);
      return;
    }
    if (!Object.is(left, right)) report(`  number ${path}: left ${left}, right ${right}`);
    return;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      report(`  type ${path}: left ${Array.isArray(left) ? 'array' : typeof left}, `
        + `right ${Array.isArray(right) ? 'array' : typeof right}`);
      return;
    }
    if (left.length !== right.length) {
      report(`  array ${path}: left length ${left.length}, right length ${right.length}`);
    }
    const length = Math.min(left.length, right.length);
    for (let index = 0; index < length; index += 1) compareValue(`${path}[${index}]`, left[index], right[index]);
    return;
  }
  if (typeof left === 'object' || typeof right === 'object') {
    if (typeof left !== 'object' || typeof right !== 'object') {
      report(`  type ${path}: left ${typeof left}, right ${typeof right}`);
      return;
    }
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    const keyCount = Math.max(leftKeys.length, rightKeys.length);
    for (let index = 0; index < keyCount; index += 1) {
      const leftKey = leftKeys[index];
      const rightKey = rightKeys[index];
      if (leftKey !== rightKey) {
        report(`  object ${path}: key ${index} left ${JSON.stringify(leftKey)} (own keys: ${JSON.stringify(leftKeys)}), `
          + `right ${JSON.stringify(rightKey)} (own keys: ${JSON.stringify(rightKeys)})`);
        break;
      }
    }
    for (const key of leftKeys) {
      if (!Object.prototype.hasOwnProperty.call(right, key)) {
        report(`  missing ${path}.${key}: present in left, absent in right`);
        continue;
      }
      compareValue(`${path}.${key}`, left[key], right[key]);
    }
    for (const key of rightKeys) {
      if (!Object.prototype.hasOwnProperty.call(left, key)) report(`  extra ${path}.${key}: present in right only`);
    }
    return;
  }
  if (!Object.is(left, right)) report(`  value ${path}: left ${String(left)}, right ${String(right)}`);
}

const left = load(leftDir);
const right = load(rightDir);
const allFiles = [...new Set([...files(leftDir), ...files(rightDir)])].sort();

let rawEqualFiles = 0;
let recordsCompared = 0;
let runOrderDifferences = 0;
const probeCounts = new Map();
const depsMethodCounts = new Map();
for (const file of allFiles) {
  const inLeft = left.lines.has(file);
  const inRight = right.lines.has(file);
  if (!inLeft || !inRight) {
    console.log(`${file}: ${inLeft ? 'right' : 'left'} file missing`);
    differences += 1;
    continue;
  }
  const rawEqual = left.lines.get(file).equals(right.lines.get(file));
  if (rawEqual) rawEqualFiles += 1;
  const leftRecords = [...left.records.entries()].filter(([, value]) => value.file === file);
  const rightRecords = [...right.records.entries()].filter(([, value]) => value.file === file);
  for (const [, value] of leftRecords) {
    probeCounts.set(value.record.probe, (probeCounts.get(value.record.probe) ?? 0) + 1);
    if (value.record.probe === 'deps') {
      const method = value.record.payload?.method ?? '<none>';
      depsMethodCounts.set(method, (depsMethodCounts.get(method) ?? 0) + 1);
    }
  }
  const rightByKey = new Map(rightRecords);
  let fileDifferences = 0;
  for (const [key, value] of leftRecords) {
    const other = rightByKey.get(key);
    recordsCompared += 1;
    if (other === undefined) {
      console.log(`${file}: record missing in right: ${JSON.stringify(key.split('\u0000'))}`);
      differences += 1;
      fileDifferences += 1;
      continue;
    }
    if (value.record.runIndex !== other.record.runIndex) {
      runOrderDifferences += 1;
      report(`  runIndex ${key.split('\u0000').join(' / ')}: left ${value.record.runIndex}, right ${other.record.runIndex}`);
    }
    const before = differences;
    compareValue(`payload(${key.split('\u0000').join(' / ')})`, value.record.payload, other.record.payload);
    if (differences !== before) fileDifferences += 1;
  }
  for (const [key] of rightRecords) {
    if (!left.records.has(key)) {
      console.log(`${file}: record extra in right: ${JSON.stringify(key.split('\u0000'))}`);
      differences += 1;
      fileDifferences += 1;
    }
  }
  console.log(`${file}: records ${leftRecords.length}/${rightRecords.length}, payload-differing ${fileDifferences}, raw-bytes-equal ${rawEqual}`);
}

console.log('\nprobe counts (left):');
for (const [probe, count] of [...probeCounts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
  console.log(`  ${probe}: ${count}`);
}
console.log('deps method counts (left):');
for (const [method, count] of [...depsMethodCounts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
  console.log(`  ${method}: ${count}`);
}

let declaredFailures = 0;
if (declared !== null) {
  for (const probe of declared.probes ?? []) {
    const count = probeCounts.get(probe.probe) ?? 0;
    if (probe.required === true && count === 0) {
      console.log(`DECLARED PROBE EMPTY: ${probe.probe}`);
      declaredFailures += 1;
    }
  }
  for (const point of declared.readPoints ?? []) {
    if (!depsMethodCounts.has(point.method)) console.log(`  zero-capture read point: ${point.method} (${point.file}:${point.line})`);
  }
}

console.log(`\nfiles: ${allFiles.length} (${rawEqualFiles} raw-byte-equal), records compared: ${recordsCompared}, `
  + `runIndex differences: ${runOrderDifferences}, payload differences: ${differences}`);
if (differences === 0 && declaredFailures === 0) console.log('RESULT: equal');
else console.log('RESULT: different');
process.exit(differences === 0 && declaredFailures === 0 ? 0 : 1);
