#!/usr/bin/env node
/**
 * Direct copy-to-copy comparison of the base and result probe logs, with the ONE
 * logical mapping the result split requires: base `renderContext` calls whose
 * prelude is the Query prelude are matched to result `renderQueryContext` and
 * their recorded base-shaped args are rewritten to the result call shape (same
 * values). This is only for the raw-copy table; the byte proof is replay.mjs,
 * which feeds the untouched base args through the copy's real functions.
 *
 * Usage: node compare-copies.mjs <base.jsonl> <result.jsonl> [--report out.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { compareValues } from './lib/compare.mjs';

const [baseFile, resultFile] = process.argv.slice(2);
if (baseFile === undefined || resultFile === undefined) {
  console.error('usage: node compare-copies.mjs <base.jsonl> <result.jsonl> [--report out.json]');
  process.exit(2);
}
const reportIndex = process.argv.indexOf('--report');
const reportPath = reportIndex < 0 ? '' : process.argv[reportIndex + 1];

const QUERY_PRELUDE = '# Verified read-only Query input\n\nThis is the current bounded Query context assembled from formal platform facts; it is not a transcript.';

function read(file) {
  const records = readFileSync(file, 'utf8').split('\n').filter((line) => line !== '').map((line) => JSON.parse(line));
  return records;
}
function asQueryInput(input) {
  const hasFootprint = input.optional !== undefined
    && Object.prototype.hasOwnProperty.call(input.optional, 'footprint');
  return {
    templateId: hasFootprint ? 'query-planning-input' : 'query-copy-input',
    prelude: input.prelude,
    required: input.required,
    optional: hasFootprint ? { footprint: input.optional.footprint } : {},
    residentBudgetBytes: input.residentBudgetBytes,
  };
}
function relativeTestPath(testPath) {
  const marker = '/tests/';
  const at = typeof testPath === 'string' ? testPath.lastIndexOf(marker) : -1;
  return at < 0 ? testPath : 'tests/' + testPath.slice(at + marker.length);
}
function keyOf(record) {
  return [relativeTestPath(record.testPath), record.testName, record.probe, record.index].join('\u0000');
}

const base = read(baseFile);
const result = new Map(read(resultFile).map((record) => [keyOf(record), record]));
const probes = new Map();
const details = [];
let missing = 0;
let extra = 0;
let differences = 0;
let argOnly = 0;
let outDiff = 0;

// The base counted Work and Query calls in ONE renderContext counter; the result
// has one counter per module-level function. Re-index each logical probe by its
// own ordinal within the same test, in recorded call order.
const renderGroups = new Map();
for (const record of base) {
  if (record.probe !== 'renderContext') continue;
  const groupKey = relativeTestPath(record.testPath) + '\u0000' + record.testName;
  const group = renderGroups.get(groupKey) ?? [];
  group.push(record);
  renderGroups.set(groupKey, group);
}
const logical = new Map();
for (const [groupKey, records] of renderGroups) {
  records.sort((left, right) => left.index - right.index);
  let work = 0;
  let query = 0;
  for (const record of records) {
    const isQuery = record.args[0] !== undefined && record.args[0].prelude === QUERY_PRELUDE;
    logical.set(groupKey + '\u0000' + record.index, isQuery
      ? { probe: 'renderQueryContext', index: query++ }
      : { probe: 'renderContext', index: work++ });
  }
}
function expectedOf(record) {
  const rel = relativeTestPath(record.testPath);
  if (record.probe !== 'renderContext') {
    return { probe: record.probe, index: record.index, args: record.args };
  }
  const mapped = logical.get(rel + '\u0000' + record.testName + '\u0000' + record.index);
  if (mapped === undefined) throw new Error('missing render index mapping for ' + JSON.stringify(record));
  const isQuery = mapped.probe === 'renderQueryContext';
  return { probe: mapped.probe, index: mapped.index, args: isQuery ? [asQueryInput(record.args[0])] : record.args };
}
const expectedKeys = new Set();
for (const record of base) {
  const expected = expectedOf(record);
  const expectedKey = [relativeTestPath(record.testPath), record.testName, expected.probe, expected.index].join('\u0000');
  expectedKeys.add(expectedKey);
  const bucket = probes.get(record.probe) ?? { calls: 0, differences: 0, missing: 0 };
  bucket.calls += 1;
  probes.set(record.probe, bucket);
  const actual = result.get(expectedKey);
  if (actual === undefined) {
    missing += 1;
    bucket.missing += 1;
    details.push({ kind: 'missing-result-record', key: expectedKey });
    continue;
  }
  const argFound = [];
  compareValues(expected.args, actual.args, '$args', argFound);
  const outFound = [];
  compareValues(record.out, actual.out, '$out', outFound);
  if (argFound.length > 0 || outFound.length > 0) {
    differences += 1;
    bucket.differences += 1;
    if (outFound.length === 0) argOnly += 1; else outDiff += 1;
    details.push({ key: expectedKey, probe: expected.probe, argsDiffer: argFound.length > 0,
      outDiffer: outFound.length > 0, differences: [...argFound, ...outFound].slice(0, 5) });
  }
}
for (const key of result.keys()) if (!expectedKeys.has(key)) extra += 1;

const report = { base: baseFile, result: resultFile, calls: base.length, missing, extra, differences, argOnly, outDiff,
  probes: Object.fromEntries([...probes.entries()].sort(([a], [b]) => (a < b ? -1 : 1))), details: details.slice(0, 50) };
if (reportPath !== '') writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(`direct mapped compare: calls=${String(base.length)} missing=${String(missing)} extra=${String(extra)} differing-records=${String(differences)} args-only=${String(argOnly)} out=${String(outDiff)}`);
for (const [probe, bucket] of Object.entries(report.probes)) {
  console.log(`  ${probe}: calls=${String(bucket.calls)} differing=${String(bucket.differences)} missing=${String(bucket.missing)}`);
}
if (details.length > 0) console.log('first difference:\n' + JSON.stringify(details[0], null, 2));
