// expected-listing.mjs: the lead's side of the task-D dry-run comparison (TASK-D-PLAN.md §5).
//   node expected-listing.mjs <expected.json> [--literal <moves.json>]            print the expected listing
//   node expected-listing.mjs <expected.json> [--literal <moves.json>] <dry.txt>  compare DSH's listing with it
// Listing format (the one the task book asks DSH to write): one line per change, tab-separated,
//   <path after the move>\t<old text>\t<new text>
// where the texts are the specifier or path string WITHOUT quotes. Lines are compared as a sorted multiset
// (a file may change the same specifier twice). --literal drops the pairs inside moved files that still name the
// same file from the new directory (the book-literal "keep" rule); without it the listing is the reference move
// (canonical spelling inside moved files).
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';

const args = process.argv.slice(2);
const expected = JSON.parse(readFileSync(args[0], 'utf8'));
const li = args.indexOf('--literal');
const moves = li >= 0 ? JSON.parse(readFileSync(args[li + 1], 'utf8')) : null;
const rest = args.filter((a, i) => i > 0 && i !== li && i !== li + 1);
const W = 'src/core/work-graph/';
const movedFrom = new Set((moves ?? []).map((m) => W + m.from));
// The text between the quotes. A state-writes decoder entry `file: '<from>'` lists as `<from>` (2026-10-07, task D
// prepare: the bfb6075 version kept the `file: '` prefix, which no book asked for).
const unq = (s) => s.replace(/^file: /, '').replace(/^['"]|['"]$/g, '');

const lines = [];
for (const f of expected.files) {
  for (const [o, n] of f.pairs) {
    if (moves && f.kind === 'moved') {
      const a = posix.join(posix.dirname(f.from), o).replace(/\.js$/, '.ts');
      const b = posix.join(posix.dirname(f.path), o).replace(/\.js$/, '.ts');
      if (a === b && !movedFrom.has(a)) continue; // still names the same file: kept under the literal rule
    }
    lines.push(`${f.path}\t${unq(o)}\t${unq(n)}`);
  }
}
lines.sort();

if (rest.length === 0) {
  process.stdout.write(lines.join('\n') + '\n');
  process.exit(0);
}
const got = readFileSync(rest[0], 'utf8').split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim() !== '').sort();
const count = (arr) => arr.reduce((m, l) => m.set(l, (m.get(l) ?? 0) + 1), new Map());
const e = count(lines), g = count(got);
const missing = [], extra = [];
for (const [l, n] of e) for (let i = (g.get(l) ?? 0); i < n; i++) missing.push(l);
for (const [l, n] of g) for (let i = (e.get(l) ?? 0); i < n; i++) extra.push(l);
const files = (arr) => new Set(arr.map((l) => l.split('\t')[0])).size;
console.log(JSON.stringify({ expected: lines.length, got: got.length, match: missing.length === 0 && extra.length === 0,
  missing: missing.length, missingFiles: files(missing), extra: extra.length, extraFiles: files(extra) }));
if (missing.length) console.log('MISSING\n' + missing.join('\n'));
if (extra.length) console.log('EXTRA\n' + extra.join('\n'));
process.exit(missing.length || extra.length ? 1 : 0);
