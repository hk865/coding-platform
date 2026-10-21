#!/usr/bin/env node
/**
 * Compares two edge-harness outputs (inventory §4 item 2) with the book §5.0
 * rule-4 comparator.
 *
 * Usage: node compare-edge.mjs <base-edge.jsonl> <result-edge.jsonl> [--report out.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { compareValues } from './lib/compare.mjs';

const [baseFile, resultFile] = process.argv.slice(2);
const reportIndex = process.argv.indexOf('--report');
const reportPath = reportIndex < 0 ? '' : process.argv[reportIndex + 1];

function read(file) {
  return readFileSync(file, 'utf8').split('\n').filter(line => line !== '').map(line => JSON.parse(line));
}
const base = new Map(read(baseFile).map(record => [record.case, record]));
const result = new Map(read(resultFile).map(record => [record.case, record]));
const details = [];
let errors = 0;
let differences = 0;

for (const [name, baseRecord] of base) {
  const resultRecord = result.get(name);
  if (resultRecord === undefined) {
    differences += 1;
    details.push({ case: name, kind: 'missing-case' });
    continue;
  }
  if (resultRecord.error !== null && resultRecord.error !== undefined) {
    errors += 1;
    differences += 1;
    details.push({ case: name, kind: 'result-error', error: resultRecord.error });
    continue;
  }
  if (baseRecord.error !== null && baseRecord.error !== undefined) {
    errors += 1;
    details.push({ case: name, kind: 'base-error', error: baseRecord.error });
    continue;
  }
  const found = [];
  compareValues(baseRecord.out, resultRecord.out, '$', found);
  if (found.length > 0) {
    differences += found.length;
    details.push({ case: name, probe: baseRecord.probe, differences: found.slice(0, 10) });
  }
}
for (const name of result.keys()) if (!base.has(name)) details.push({ case: name, kind: 'extra-case' });

const report = { base: baseFile, result: resultFile, cases: base.size, differences, errors, details };
if (reportPath !== '') writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(`edge cases=${String(base.size)} differences=${String(differences)} errors=${String(errors)}`);
for (const detail of details.slice(0, 20)) console.log('  ' + JSON.stringify(detail));
if (differences > 0 || errors > 0) process.exit(1);
