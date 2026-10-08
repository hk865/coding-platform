// node classify-kinds.mjs <projectDir> <moves.json>   (run on an unmoved copy of H; writes nothing)
// TASK-D-PLAN §2 step 7: which specifier kinds the move must change at H. Mirrors wg-move.mjs's visit/consider in a
// dry mode (same resolution, same canonical rule) and labels each planned change by its syntax kind. Also counts every
// relative specifier of each kind in the tree (changed or not), so a kind that occurs but needs no change is visible.
import { readFileSync, readdirSync, lstatSync, existsSync } from 'node:fs';
import { resolve, relative, dirname, extname, sep } from 'node:path';
import { createRequire } from 'node:module';

const [projectArg, movesArg] = process.argv.slice(2);
const project = resolve(projectArg);
const ts = createRequire(resolve(project, 'package.json'))('typescript');
const WG = 'src/core/work-graph/';
const moves = JSON.parse(readFileSync(movesArg, 'utf8'));
const toPosix = (p) => p.split(sep).join('/');
const oldToNew = new Map(moves.map((m) => [resolve(project, WG + m.from), resolve(project, WG + m.to)]));
const SRC_EXT = new Set(['.ts', '.tsx', '.mts', '.cts']);
const files = [];
const walk = (p) => {
  const st = lstatSync(p);
  if (st.isDirectory()) { for (const n of readdirSync(p).sort()) walk(resolve(p, n)); return; }
  if (SRC_EXT.has(extname(p))) files.push(p);
};
walk(resolve(project, 'src'));
walk(resolve(project, 'tests'));
if (existsSync(resolve(project, 'vitest.config.ts'))) files.push(resolve(project, 'vitest.config.ts'));
const resolveTarget = (fromFile, s) => {
  const abs = resolve(dirname(fromFile), s);
  for (const c of [abs.replace(/\.(?:js|mjs|cjs|jsx)$/, '.ts'), abs.replace(/\.(?:js|jsx)$/, '.tsx'), abs]) if (oldToNew.has(c) || existsSync(c)) return c;
  return abs.replace(/\.(?:js|mjs|cjs|jsx)$/, '.ts');
};
const specifierFor = (fromNew, targetNew, original) => {
  const ext = /\.(js|mjs|cjs|jsx|ts)$/.exec(original)?.[0] ?? '';
  let rel = toPosix(relative(dirname(fromNew), targetNew)).replace(/\.ts$/, ext);
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
};
const all = new Map(), changed = new Map(), rows = [];
const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const newFile = oldToNew.get(file) ?? file;
  const consider = (lit, kind) => {
    if (!lit || !ts.isStringLiteralLike(lit) || !lit.text.startsWith('.')) return;
    bump(all, kind);
    const targetOld = resolveTarget(file, lit.text);
    const targetNew = oldToNew.get(targetOld) ?? targetOld;
    if (targetNew === targetOld && newFile === file) return;
    const next = specifierFor(newFile, targetNew, lit.text);
    if (next === lit.text) return;
    bump(changed, kind);
    const line = sf.getLineAndCharacterOfPosition(lit.getStart(sf)).line + 1;
    rows.push(`${kind}\t${toPosix(relative(project, file))}:${line}\t${lit.text}\t${next}${oldToNew.has(file) ? '\t(inside a moved file)' : ''}`);
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier) consider(node.moduleSpecifier, 'import-from');
    else if (ts.isExportDeclaration(node) && node.moduleSpecifier) consider(node.moduleSpecifier, 'export-from');
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) consider(node.argument.literal, 'type-import()');
    else if (ts.isCallExpression(node)) {
      const c = node.expression;
      if (c.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0]) consider(node.arguments[0], 'dynamic-import()');
      else if (ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.expression) && c.expression.text === 'vi' && node.arguments[0]
        && ['mock', 'doMock', 'importActual', 'unmock', 'importMock'].includes(c.name.text)) consider(node.arguments[0], `vi.${c.name.text}`);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) consider(node.moduleReference.expression, 'import-equals');
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
const kinds = [...new Set([...all.keys(), ...changed.keys()])].sort();
console.log('## relative specifiers by kind at H: all in src/, tests/, vitest.config.ts / changed by the move (canonical)');
for (const k of kinds) console.log(`${k}\tall=${all.get(k) ?? 0}\tchanged=${changed.get(k) ?? 0}`);
console.log(`total\tall=${[...all.values()].reduce((a, b) => a + b, 0)}\tchanged=${rows.length}`);
console.log('\n## every planned change that is not a plain import-from (kind, file:line before the move, old, new)');
for (const r of rows.filter((r) => !r.startsWith('import-from\t'))) console.log(r);
