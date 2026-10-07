// node split-counts.mjs <expected.json from mk-expected.mjs> <moves.json>
// The exact counts TASK-D-PLAN.md §2 step 6 asks for, split by kind: specifier changes and files inside the moved
// files and in the other files (src / tests / vitest.config.ts), under the canonical rule and under the literal-keep
// rule (the same filter as expected-listing.mjs --literal), plus the path strings per data file and the test files.
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';

const [expectedPath, movesPath] = process.argv.slice(2);
const expected = JSON.parse(readFileSync(expectedPath, 'utf8'));
const moves = JSON.parse(readFileSync(movesPath, 'utf8'));
const W = 'src/core/work-graph/';
const movedFrom = new Set(moves.map((m) => W + m.from));
const literalPairs = (f) => f.pairs.filter(([o]) => {
  if (f.kind !== 'moved') return true;
  const a = posix.join(posix.dirname(f.from), o).replace(/\.js$/, '.ts');
  const b = posix.join(posix.dirname(f.path), o).replace(/\.js$/, '.ts');
  return !(a === b && !movedFrom.has(a));
});
const sum = (files, pick) => files.reduce((a, f) => a + pick(f).length, 0);
const withAny = (files, pick) => files.filter((f) => pick(f).length > 0).length;
const all = (f) => f.pairs;
const moved = expected.files.filter((f) => f.kind === 'moved');
const others = expected.files.filter((f) => f.kind === 'importer');
const data = expected.files.filter((f) => f.kind === 'data');
const area = (f) => (f.path.startsWith('src/') ? 'src' : f.path.startsWith('tests/') ? 'tests' : f.path);
const lines = [];
const say = (s) => lines.push(s);
say(`moves: ${moves.length}`);
say(`files the reference move changes: ${expected.files.length} = ${moved.length} moved + ${others.length} other files with specifier changes + ${data.length} data files`);
for (const [rule, pick] of [['canonical', all], ['literal', literalPairs]]) {
  const ms = sum(moved, pick), mf = withAny(moved, pick), os = sum(others, pick), of = withAny(others, pick);
  say(`${rule}: ${ms + os} specifier changes in ${mf + of} files = ${ms} in ${mf} moved files + ${os} in ${of} other files`);
}
for (const a of ['src', 'tests']) {
  const fs = others.filter((f) => area(f) === a);
  say(`  other files under ${a}/: ${fs.length} files, ${sum(fs, all)} specifier changes`);
}
for (const f of others.filter((x) => !['src', 'tests'].includes(area(x)))) say(`  other file ${f.path}: ${f.pairs.length} specifier changes`);
say(`path strings: ${sum(data, all)} in ${data.length} data files`);
for (const f of data) say(`  ${f.path}: ${f.pairs.length}`);
const testFiles = expected.files.filter((f) => f.path.startsWith('tests/'));
say(`test files touched: ${testFiles.length} (${testFiles.filter((f) => f.kind === 'importer').length} with specifier changes + ${testFiles.filter((f) => f.kind === 'data').length} data files)`);
say(`src files touched: ${expected.files.filter((f) => f.path.startsWith('src/')).length} (${moved.length} moved, ${others.filter((f) => area(f) === 'src').length} others)`);
say('');
say('per moved file (canonical / literal specifier changes inside it):');
for (const f of moved) say(`  ${f.move}\t${f.from} -> ${f.path}\t${f.pairs.length}\t${literalPairs(f).length}`);
process.stdout.write(lines.join('\n') + '\n');
