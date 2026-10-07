// node mk-expected.mjs <dir> <moves.json> <setupCommit>   > expected.json
// <dir> holds the REFERENCE move (wg-move.mjs) applied on a set-up copy. Lists every file that must change, from the
// diff against the setup commit: the moved files, the importer files whose specifiers changed and the two architecture
// test data files, each with its specifier / path-string pairs and the sha256 of the reference content. movecheck.mjs
// scores a candidate per file against this list. Regenerate it whenever the tree or the move table changes (task D).
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { changedFiles, sha256 } from './lib.mjs';

const [dirArg, movesArg, setupCommit] = process.argv.slice(2);
const dir = resolve(dirArg);
const ts = createRequire(resolve(dir, 'package.json'))('typescript');
const WG = 'src/core/work-graph/';
const moves = JSON.parse(readFileSync(movesArg, 'utf8'));
const ALLOWLIST = 'tests/architecture/production-reach-allowlist.json';
const STATE_WRITES = 'tests/architecture/state-writes.test.ts';
const tmp = mkdtempSync(join(tmpdir(), 'mk-expected-'));
let entries;
try { entries = changedFiles(dir, setupCommit, join(tmp, 'index'), { renames: true }); }
finally { rmSync(tmp, { recursive: true, force: true }); }
const setupText = (p) => execFileSync('git', ['show', `${setupCommit}:${p}`], { cwd: dir, maxBuffer: 1 << 28 }).toString();
const nowText = (p) => readFileSync(resolve(dir, p), 'utf8');
const literals = (text, rel) => {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
  const out = [];
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) out.push(node.moduleSpecifier.text);
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) out.push(node.argument.literal.text);
    else if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'vi'))) out.push(node.arguments[0].text);
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteralLike(node.moduleReference.expression)) out.push(node.moduleReference.expression.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
};
const tsPairs = (oldRel, newRel) => {
  const a = literals(setupText(oldRel), oldRel), b = literals(nowText(newRel), newRel);
  if (a.length !== b.length) throw new Error(`${newRel}: specifier count changed in the reference`);
  return a.flatMap((s, i) => (s === b[i] ? [] : [[s, b[i]]]));
};
const dataPairs = (rel) => {
  const before = setupText(rel), after = nowText(rel), pairs = [];
  for (const m of moves) {
    for (const [o, n] of [[`"${WG}${m.from}"`, `"${WG}${m.to}"`], [`'${WG}${m.from}'`, `'${WG}${m.to}'`], [`file: '${m.from}'`, `file: '${m.to}'`]]) {
      const count = before.split(o).length - 1;
      if (count > 0 && after.split(n).length - 1 >= count) for (let i = 0; i < count; i++) pairs.push([o, n]);
    }
  }
  return pairs;
};
const files = [];
const moveByFrom = new Map(moves.map((m) => [WG + m.from, m]));
for (const e of entries) {
  if (e.status === 'R' && moveByFrom.get(e.old)?.to && WG + moveByFrom.get(e.old).to === e.new) {
    files.push({ path: e.new, from: e.old, kind: 'moved', move: moveByFrom.get(e.old).id, pairs: tsPairs(e.old, e.new), sha256: sha256(readFileSync(resolve(dir, e.new))) });
  } else if (e.status === 'M') {
    const data = e.path === ALLOWLIST || e.path === STATE_WRITES;
    files.push({ path: e.path, from: e.path, kind: data ? 'data' : 'importer', pairs: data ? dataPairs(e.path) : tsPairs(e.path, e.path),
      sha256: sha256(readFileSync(resolve(dir, e.path))) });
  } else {
    throw new Error(`the reference move made an unexpected change: ${JSON.stringify(e)}`);
  }
}
files.sort((a, b) => (a.kind === b.kind ? a.path.localeCompare(b.path) : ['moved', 'importer', 'data'].indexOf(a.kind) - ['moved', 'importer', 'data'].indexOf(b.kind)));
const count = (k) => files.filter((f) => f.kind === k).length;
const specifiers = files.filter((f) => f.kind !== 'data').reduce((s, f) => s + f.pairs.length, 0);
const pathStrings = files.filter((f) => f.kind === 'data').reduce((s, f) => s + f.pairs.length, 0);
console.log(JSON.stringify({ note: 'files the reference move changes (mk-expected.mjs); score = files right / total', moves: moves.map((m) => m.id),
  counts: { total: files.length, moved: count('moved'), importer: count('importer'), data: count('data'), specifiers, pathStrings,
    filesWithSpecifierChanges: files.filter((f) => f.kind !== 'data' && f.pairs.length > 0).length }, files }, null, 1));
