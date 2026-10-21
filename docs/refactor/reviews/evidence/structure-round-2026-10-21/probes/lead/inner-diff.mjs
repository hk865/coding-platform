#!/usr/bin/env node
// Lead check for S4's six "not byte-proven" leaf paths (Q1-03, Q2's note on the >1 MiB logs): between two e-assembler
// capture dirs, list every differing leaf; where the leaf is a string holding JSON (the Kernel entries' body.text),
// parse both sides and list the differing leaves inside it. Prints a count per (outer path, inner path).
// usage: node inner-diff.mjs <left-dir> <right-dir>   (lead, 2026-10-22)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const [leftDir, rightDir] = process.argv.slice(2);
function load(dir) {
  const records = new Map();
  for (const file of readdirSync(dir).filter(n => n.endsWith('.jsonl') && statSync(join(dir, n)).isFile())) {
    for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
      if (line === '') continue;
      const r = JSON.parse(line);
      records.set([r.testPath, r.testName, r.probe, r.callIndex].join('\u0000'), r);
    }
  }
  return records;
}
const counts = new Map();
const where = new Map();
const note = (path, ctx) => { counts.set(path, (counts.get(path) ?? 0) + 1); if (!where.has(path)) where.set(path, ctx); };
const asJson = s => { if (typeof s !== 'string' || !/^[[{]/.test(s)) return undefined; try { return JSON.parse(s); } catch { return undefined; } };
function walk(path, a, b, ctx, inner) {
  if (typeof a === 'string' && typeof b === 'string') {
    if (a === b) return;
    const ja = asJson(a), jb = asJson(b);
    if (ja !== undefined && jb !== undefined) { walk(inner === null ? path + ' ⟶ ' : path, ja, jb, ctx, path); return; }
    note(path, ctx); return;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') { if (!Object.is(a, b)) note(path, ctx); return; }
  if (Array.isArray(a) !== Array.isArray(b)) { note(path + ' (array vs object)', ctx); return; }
  if (Array.isArray(a)) {
    if (a.length !== b.length) note(path + ' (length)', ctx);
    for (let i = 0; i < Math.min(a.length, b.length); i += 1) walk(path + '[]', a[i], b[i], ctx, inner);
    return;
  }
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.join('\u0000') !== kb.join('\u0000')) note(path + ' (keys or key order)', ctx);
  for (const k of ka) if (k in b) walk(path + '.' + k, a[k], b[k], ctx, inner);
}
const left = load(leftDir), right = load(rightDir);
let missing = 0, records = 0, differing = 0;
for (const [key, r] of left) {
  const o = right.get(key);
  if (o === undefined) { missing += 1; continue; }
  records += 1;
  const before = [...counts.values()].reduce((s, n) => s + n, 0);
  walk(r.probe, r.payload, o.payload, `${r.testPath} | ${r.testName} | #${r.callIndex}`, null);
  if ([...counts.values()].reduce((s, n) => s + n, 0) > before) differing += 1;
}
for (const key of right.keys()) if (!left.has(key)) missing += 1;
console.log(`records compared ${records}, records with a difference ${differing}, records on one side only ${missing}`);
for (const [path, n] of [...counts.entries()].sort((x, y) => y[1] - x[1])) console.log(`${n}\t${path}\t(first: ${where.get(path)})`);
