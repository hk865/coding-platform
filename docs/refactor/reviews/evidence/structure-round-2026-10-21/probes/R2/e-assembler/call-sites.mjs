#!/usr/bin/env node
/**
 * Q2-02/Q1-02: per-call-site read-point counts from the copy-only site log.
 * The compared payloads stay line-number free; this separate log records the
 * first frames under src/ per call. Usage: node call-sites.mjs <sites-dir> [base|result]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const mode = process.argv[3] ?? 'base';
if (!dir) { console.error('usage: node call-sites.mjs <sites-dir> [base|result]'); process.exit(2); }
const HELPER = ['session-operations.ts', 'continuation-brief-assembly.ts', 'workspace-baseline-artifact.ts',
  'task-review-reader.ts', 'context-assembler.ts'];
const groups = new Map();
for (const file of readdirSync(dir).filter((name) => name.endsWith('.jsonl') && statSync(join(dir, name)).isFile())) {
  for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
    if (line === '') continue;
    const record = JSON.parse(line);
    if (record.probe !== 'deps' && record.probe !== 'kernel') continue;
    // The anchor is the context-assembler frame when present, else the first
    // helper frame (the owner/helper indirection), else the first src frame.
    const frames = record.frames ?? [];
    // frames[0] is the actual call; the rest is the owner/entry chain.
    const anchor = frames[0] ?? 'unknown';
    const helper = frames.slice(1, 5).join(',');
    const key = [record.probe, record.method, anchor].join('\t');
    const bucket = groups.get(key) ?? { calls: 0, helper: new Set(), frames: new Set() };
    bucket.calls += 1;
    if (helper !== undefined && helper !== '') bucket.helper.add(helper);
    if (frames[1] !== undefined && frames[1] !== anchor) bucket.frames.add(frames[1]);
    groups.set(key, bucket);
  }
}
console.log(`mode=${mode} groups=${groups.size}`);
for (const [key, bucket] of [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
  const [probe, method, anchor] = key.split('\t');
  const via = bucket.helper.size === 0 ? '' : ` via ${[...bucket.helper].join(',')}`;
  console.log(`${bucket.calls}\t${probe}\t${method}\t${anchor}${via}`);
}
