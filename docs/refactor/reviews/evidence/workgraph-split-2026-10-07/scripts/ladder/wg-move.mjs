// Reference (oracle) implementation of a pure WorkGraph file move.
//   node wg-move.mjs <projectDir> <moves.json>
// moves.json: [{ "from": "tasks/contracts.ts", "to": "model/task-contracts.ts" }, ...]  (relative to src/core/work-graph)
// Rewrites every relative module specifier in src/, tests/ and vitest.config.ts that resolves to a moved file
// (import/export from, import type nodes, dynamic import(), vi.mock/vi.importActual/vi.doMock first argument),
// recomputes the relative specifiers inside the moved files, moves the files with `git mv`, and rewrites the
// path strings that name a moved file in tests/architecture/production-reach-allowlist.json and
// tests/architecture/state-writes.test.ts. Only the string contents change; nothing else in any file.
import { readFileSync, writeFileSync, readdirSync, lstatSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, relative, dirname, extname, sep, posix } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const [projectArg, movesArg] = process.argv.slice(2);
const project = resolve(projectArg);
const require = createRequire(resolve(project, 'package.json'));
const ts = require('typescript');
const WG = 'src/core/work-graph/';
const moves = JSON.parse(readFileSync(movesArg, 'utf8'));
const toPosix = (p) => p.split(sep).join('/');
const oldToNew = new Map(moves.map((m) => [resolve(project, WG + m.from), resolve(project, WG + m.to)]));
for (const [from, to] of oldToNew) {
  if (!existsSync(from)) throw new Error(`missing source ${from}`);
  if (existsSync(to)) throw new Error(`target exists ${to}`);
}

const SRC_EXT = new Set(['.ts', '.tsx', '.mts', '.cts']);
const files = [];
function walk(path) {
  const st = lstatSync(path);
  if (st.isDirectory()) { for (const name of readdirSync(path).sort()) walk(resolve(path, name)); return; }
  if (SRC_EXT.has(extname(path))) files.push(path);
}
walk(resolve(project, 'src'));
walk(resolve(project, 'tests'));
if (existsSync(resolve(project, 'vitest.config.ts'))) files.push(resolve(project, 'vitest.config.ts'));

function resolveTarget(fromFile, specifier) {
  const abs = resolve(dirname(fromFile), specifier);
  for (const candidate of [abs.replace(/\.(?:js|mjs|cjs|jsx)$/, '.ts'), abs.replace(/\.(?:js|jsx)$/, '.tsx'), abs]) {
    if (oldToNew.has(candidate) || existsSync(candidate)) return candidate;
  }
  return abs.replace(/\.(?:js|mjs|cjs|jsx)$/, '.ts');
}
function specifierFor(fromNewFile, targetNewAbs, original) {
  const ext = /\.(js|mjs|cjs|jsx|ts)$/.exec(original)?.[0] ?? '';
  let rel = toPosix(relative(dirname(fromNewFile), targetNewAbs)).replace(/\.ts$/, ext);
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}

let changedFiles = 0, changedSpecifiers = 0;
const outputs = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const newFile = oldToNew.get(file) ?? file;
  const edits = [];
  const consider = (lit) => {
    if (!lit || !ts.isStringLiteralLike(lit)) return;
    const spec = lit.text;
    if (!spec.startsWith('.')) return;
    const targetOld = resolveTarget(file, spec);
    const targetNew = oldToNew.get(targetOld) ?? targetOld;
    if (targetNew === targetOld && newFile === file) return;
    const next = specifierFor(newFile, targetNew, spec);
    if (next !== spec) edits.push({ start: lit.getStart(sf) + 1, end: lit.getEnd() - 1, text: next });
  };
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) consider(node.moduleSpecifier);
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) consider(node.argument.literal);
    else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isViMock = ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'vi'
        && ['mock', 'doMock', 'importActual', 'unmock', 'importMock'].includes(callee.name.text);
      if ((isDynamicImport || isViMock) && node.arguments[0]) consider(node.arguments[0]);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) consider(node.moduleReference.expression);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (edits.length === 0 && newFile === file) continue;
  let out = text;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  changedSpecifiers += edits.length;
  if (edits.length) changedFiles += 1;
  outputs.push({ file, newFile, out });
}
// Move first (git mv keeps history), then write contents.
for (const [from, to] of oldToNew) {
  mkdirSync(dirname(to), { recursive: true });
  execFileSync('git', ['mv', toPosix(relative(project, from)), toPosix(relative(project, to))], { cwd: project });
}
for (const { newFile, out } of outputs) writeFileSync(newFile, out);

// Path strings in the two architecture test data locations.
let pathStrings = 0;
const allowlist = resolve(project, 'tests/architecture/production-reach-allowlist.json');
const stateWrites = resolve(project, 'tests/architecture/state-writes.test.ts');
for (const target of [allowlist, stateWrites]) {
  if (!existsSync(target)) continue;
  let text = readFileSync(target, 'utf8');
  for (const m of moves) {
    for (const [q1, q2] of [['"', '"'], ["'", "'"]]) {
      const full = `${q1}${WG}${m.from}${q2}`;
      const n1 = text.split(full).length - 1;
      if (n1) { text = text.split(full).join(`${q1}${WG}${m.to}${q2}`); pathStrings += n1; }
      if (target === stateWrites) {
        const short = `file: ${q1}${m.from}${q2}`;
        const n2 = text.split(short).length - 1;
        if (n2) { text = text.split(short).join(`file: ${q1}${m.to}${q2}`); pathStrings += n2; }
      }
    }
  }
  writeFileSync(target, text);
}
console.log(JSON.stringify({ moved: oldToNew.size, changedFiles, changedSpecifiers, pathStrings }));
