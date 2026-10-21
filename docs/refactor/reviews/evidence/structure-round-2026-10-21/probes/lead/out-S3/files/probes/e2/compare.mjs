#!/usr/bin/env node
/**
 * S3/D3a byte comparison — book §5.0 rule 4.
 *
 *   node compare.mjs <base-jsonl-dir> <result-jsonl-dir> [--max-diffs=N]
 *
 * Matches records by test file, test name, kind and call index; compares the
 * payload values. Strings are compared as UTF-8 buffers and the first differing
 * byte offset, both byte lengths and the 16 bytes around it are printed.
 * Arrays are element-by-element (count and order kept); objects are own keys in
 * order (missing vs undefined vs null kept apart); numbers are compared exactly.
 * Nothing is sorted or canonicalised.
 *
 * Exit 0 iff every matched payload is equal and the record key sets agree.
 * Raw file bytes are also reported: base-vs-base must be byte-for-byte equal.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const baseDir = process.argv[2];
const resultDir = process.argv[3];
if (!baseDir || !resultDir) {
  console.error('usage: node compare.mjs <base-jsonl-dir> <result-jsonl-dir> [--max-diffs=N]');
  process.exit(2);
}
const maxDiffsArg = process.argv.find(arg => arg.startsWith('--max-diffs='));
const maxDiffs = maxDiffsArg === undefined ? 20 : Number(maxDiffsArg.split('=')[1]);

const files = dir => readdirSync(dir)
  .filter(name => name.endsWith('.jsonl') && statSync(join(dir, name)).isFile())
  .sort();

function load(dir) {
  const records = new Map();
  const lines = new Map();
  for (const file of files(dir)) {
    const raw = readFileSync(join(dir, file));
    lines.set(file, raw);
    const text = raw.toString('utf8');
    const fileLines = text.split('\n');
    if (fileLines.at(-1) === '') fileLines.pop();
    for (const [ordinal, lineText] of fileLines.entries()) {
      const record = JSON.parse(lineText);
      // Match by test file, test name, kind and call index (book §5.0 rule 5).
      // A repeated key gets an occurrence suffix in file order, never a sort.
      const baseKey = [record.testPath, record.testName, record.kind, record.callIndex].join('\u0000');
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

function compareString(path, base, result) {
  const left = Buffer.from(base, 'utf8');
  const right = Buffer.from(result, 'utf8');
  if (left.equals(right)) return;
  let offset = 0;
  while (offset < left.length && offset < right.length && left[offset] === right[offset]) offset += 1;
  report(`  string ${path}: first UTF-8 byte difference at offset ${offset}; `
    + `base length ${left.length} bytes, result length ${right.length} bytes; `
    + `base[${Math.max(0, offset - 8)}..${Math.min(left.length, offset + 8)}]=${hexAround(left, offset)}; `
    + `result[${Math.max(0, offset - 8)}..${Math.min(right.length, offset + 8)}]=${hexAround(right, offset)}`);
}

function compareValue(path, base, result) {
  if (typeof base === 'string' || typeof result === 'string') {
    if (typeof base !== 'string' || typeof result !== 'string') {
      report(`  type ${path}: base ${typeof base}, result ${typeof result}`);
      return;
    }
    compareString(path, base, result);
    return;
  }
  if (base === null || result === null) {
    if (base !== result) report(`  null ${path}: base ${String(base)}, result ${String(result)}`);
    return;
  }
  if (typeof base === 'number' || typeof result === 'number') {
    if (typeof base !== 'number' || typeof result !== 'number') {
      report(`  type ${path}: base ${typeof base}, result ${typeof result}`);
      return;
    }
    if (!Object.is(base, result)) report(`  number ${path}: base ${base}, result ${result}`);
    return;
  }
  if (Array.isArray(base) || Array.isArray(result)) {
    if (!Array.isArray(base) || !Array.isArray(result)) {
      report(`  type ${path}: base ${Array.isArray(base) ? 'array' : typeof base}, `
        + `result ${Array.isArray(result) ? 'array' : typeof result}`);
      return;
    }
    if (base.length !== result.length) {
      report(`  array ${path}: base length ${base.length}, result length ${result.length}`);
    }
    const length = Math.min(base.length, result.length);
    for (let index = 0; index < length; index += 1) compareValue(`${path}[${index}]`, base[index], result[index]);
    return;
  }
  if (typeof base === 'object' || typeof result === 'object') {
    if (typeof base !== 'object' || typeof result !== 'object') {
      report(`  type ${path}: base ${typeof base}, result ${typeof result}`);
      return;
    }
    const baseKeys = Object.keys(base);
    const resultKeys = Object.keys(result);
    const keyCount = Math.max(baseKeys.length, resultKeys.length);
    for (let index = 0; index < keyCount; index += 1) {
      const leftKey = baseKeys[index];
      const rightKey = resultKeys[index];
      if (leftKey !== rightKey) {
        report(`  object ${path}: key ${index} base ${JSON.stringify(leftKey)} (own keys: ${JSON.stringify(baseKeys)}), `
          + `result ${JSON.stringify(rightKey)} (own keys: ${JSON.stringify(resultKeys)})`);
        break;
      }
    }
    for (const key of baseKeys) {
      const hasResult = Object.prototype.hasOwnProperty.call(result, key);
      if (!hasResult) {
        report(`  missing ${path}.${key}: present in base, absent in result`);
        continue;
      }
      compareValue(`${path}.${key}`, base[key], result[key]);
    }
    for (const key of resultKeys) {
      if (!Object.prototype.hasOwnProperty.call(base, key)) report(`  extra ${path}.${key}: present in result only`);
    }
    return;
  }
  if (!Object.is(base, result)) report(`  value ${path}: base ${String(base)}, result ${String(result)}`);
}

const base = load(baseDir);
const result = load(resultDir);
const baseFiles = files(baseDir);
const resultFiles = files(resultDir);
const allFiles = [...new Set([...baseFiles, ...resultFiles])].sort();

let rawEqualFiles = 0;
let recordsCompared = 0;
let runOrderDifferences = 0;
const matchedKeys = new Set();
for (const file of allFiles) {
  const inBase = base.lines.has(file);
  const inResult = result.lines.has(file);
  if (!inBase || !inResult) {
    console.log(`${file}: ${inBase ? 'result' : 'base'} file missing`);
    differences += 1;
    continue;
  }
  const rawEqual = base.lines.get(file).equals(result.lines.get(file));
  if (rawEqual) rawEqualFiles += 1;
  const baseRecords = [...base.records.entries()].filter(([, value]) => value.file === file);
  const resultRecords = [...result.records.entries()].filter(([, value]) => value.file === file);
  const resultByKey = new Map(resultRecords);
  let fileDifferences = 0;
  for (const [key, value] of baseRecords) {
    const other = resultByKey.get(key);
    matchedKeys.add(key);
    recordsCompared += 1;
    if (other === undefined) {
      console.log(`${file}: record missing in result: ${JSON.stringify(key.split('\u0000').slice(0, 4))}`);
      differences += 1;
      fileDifferences += 1;
      continue;
    }
    if (value.record.runIndex !== other.record.runIndex) runOrderDifferences += 1;
    const before = differences;
    compareValue(`payload(${key.split('\u0000').slice(0, 4).join(' / ')})`, value.record.payload, other.record.payload);
    if (differences !== before) fileDifferences += 1;
  }
  for (const [key] of resultRecords) {
    if (!base.records.has(key)) {
      console.log(`${file}: record extra in result: ${JSON.stringify(key.split('\u0000').slice(0, 4))}`);
      differences += 1;
      fileDifferences += 1;
    }
  }
  console.log(`${file}: records ${baseRecords.length}/${resultRecords.length}, payload-differing ${fileDifferences}, raw-bytes-equal ${rawEqual}`);
}

console.log(`\nfiles: ${allFiles.length} (${rawEqualFiles} raw-byte-equal), records compared: ${recordsCompared}, `
  + `runIndex differences: ${runOrderDifferences}, payload differences: ${differences}`);
if (differences === 0) console.log('RESULT: equal');
else console.log('RESULT: different');
process.exit(differences === 0 ? 0 : 1);
