#!/usr/bin/env node
/**
 * Concatenate one capture directory's per-test JSONL files into one artifact,
 * in sorted file order. This is only a transport artifact: the comparer always
 * loads the per-file records, so no compared value is sorted or canonicalised.
 * Usage: node concat.mjs <capture-dir> <out.jsonl>
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const out = process.argv[3];
if (!dir || !out) {
  console.error('usage: node concat.mjs <capture-dir> <out.jsonl>');
  process.exit(2);
}
const files = readdirSync(dir)
  .filter(name => name.endsWith('.jsonl') && statSync(join(dir, name)).isFile())
  .sort();
const lines = [];
for (const file of files) {
  const text = readFileSync(join(dir, file), 'utf8');
  for (const line of text.split('\n')) if (line !== '') lines.push(line);
}
writeFileSync(out, lines.length === 0 ? '' : lines.join('\n') + '\n', 'utf8');
console.log(`${out}: ${lines.length} records from ${files.length} files`);
