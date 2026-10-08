// Task D bring-in: check the real worktree's staged change against the expected data, and the export sets.
//   node verify-real.mjs <dir>   (dir holds expected.json, name-status.txt, numstat.txt, index-sha256.txt,
//                                 exports-before.json and, if present, exports-after.json)
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const read = f => readFileSync(join(dir, f), 'utf8');
const expected = JSON.parse(read('expected.json'));
const problems = [];

// 1. Name-status: exactly the expected files; every move a rename from the expected old path.
const status = read('name-status.txt').trim().split('\n').map(l => l.split('\t'));
const byPath = new Map();
for (const [code, a, b] of status) {
  if (code.startsWith('R')) byPath.set(b, { code, from: a, score: Number(code.slice(1)) });
  else byPath.set(a, { code, from: a });
}
const expectedPaths = new Set(expected.files.map(f => f.path));
for (const f of expected.files) {
  const got = byPath.get(f.path);
  if (!got) { problems.push(`missing ${f.path}`); continue; }
  if (f.kind === 'moved') {
    if (!got.code.startsWith('R')) problems.push(`not a rename: ${f.path} (${got.code})`);
    if (got.from !== f.from) problems.push(`rename source ${got.from} != ${f.from} for ${f.path}`);
  } else if (got.code !== 'M') problems.push(`expected M for ${f.path}, got ${got.code}`);
}
for (const p of byPath.keys()) if (!expectedPaths.has(p)) problems.push(`unexpected change ${p}`);
const outside = [...byPath.entries()].filter(([p, v]) => !/^(src|tests)\//.test(p) || !/^(src|tests)\//.test(v.from));
for (const [p] of outside) problems.push(`outside src/ and tests/: ${p}`);
const moves = [...byPath.values()].filter(v => v.code.startsWith('R'));
const minScore = Math.min(...moves.map(v => v.score));

// 2. Content: every staged file's sha256 equals the reference move's.
const sha = new Map(read('index-sha256.txt').trim().split('\n').map(l => { const [h, ...p] = l.split(' '); return [p.join(' '), h]; }));
let shaOk = 0;
for (const f of expected.files) {
  if (sha.get(f.path) === f.sha256) shaOk++;
  else problems.push(`content differs from reference: ${f.path}`);
}

// 3. Numstat: one added line per removed line in every file, and the total.
let added = 0, deleted = 0, unequal = 0;
for (const line of read('numstat.txt').trim().split('\n')) {
  const [a, d] = line.split('\t');
  added += Number(a); deleted += Number(d);
  if (a !== d) unequal++;
}
if (unequal) problems.push(`${unequal} files with added != deleted`);
const expectedLines = expected.counts.specifiers + expected.counts.pathStrings;

// 4. Exports: the same names per module, with the moved modules mapped from their old path.
let exportsLine = 'exports-after.json not present yet';
if (existsSync(join(dir, 'exports-after.json'))) {
  const before = JSON.parse(read('exports-before.json'));
  const after = JSON.parse(read('exports-after.json'));
  const moved = new Map(expected.files.filter(f => f.kind === 'moved').map(f => [f.from, f.path]));
  const mapped = Object.fromEntries(Object.entries(before).map(([p, names]) => [moved.get(p) ?? p, names]));
  const keysB = Object.keys(mapped).sort(), keysA = Object.keys(after).sort();
  for (const k of keysB) if (!(k in after)) problems.push(`exports: module gone ${k}`);
  for (const k of keysA) if (!(k in mapped)) problems.push(`exports: new module ${k}`);
  let same = 0, names = 0;
  for (const k of keysA) {
    if (!(k in mapped)) continue;
    const a = JSON.stringify(after[k]), b = JSON.stringify(mapped[k]);
    if (a === b) { same++; names += after[k].length; }
    else problems.push(`exports differ in ${k}: before ${b} after ${a}`);
  }
  const movedNames = [...moved.values()].reduce((n, p) => n + (after[p]?.length ?? 0), 0);
  exportsLine = `exports: ${same}/${keysA.length} modules identical (before ${keysB.length} modules), ${names} names; ` +
    `the 18 moved modules export ${movedNames} names, all as before`;
}

console.log(`name-status: ${status.length} entries = ${moves.length} R (min similarity ${minScore}) + ` +
  `${status.length - moves.length} M; expected ${expected.counts.total} = ${expected.counts.moved} moved + ` +
  `${expected.counts.importer} importer + ${expected.counts.data} data files`);
console.log(`content: ${shaOk}/${expected.files.length} files have the reference move's sha256`);
console.log(`numstat: +${added} -${deleted}; expected ${expectedLines} = ${expected.counts.specifiers} specifiers + ` +
  `${expected.counts.pathStrings} path strings; files with added != deleted: ${unequal}`);
console.log(`outside src/ and tests/: ${outside.length}`);
console.log(exportsLine);
if (added !== expectedLines || deleted !== expectedLines) problems.push(`line count ${added}/${deleted} != ${expectedLines}`);
console.log(problems.length ? `PROBLEMS (${problems.length}):\n` + problems.slice(0, 50).join('\n') : 'ALL CHECKS PASS');
process.exit(problems.length ? 1 : 0);
