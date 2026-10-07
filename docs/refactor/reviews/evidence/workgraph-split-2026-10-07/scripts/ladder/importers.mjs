// node importers.mjs <projectDir> <moves.json> [--tests-only]
// Prints the files (relative paths) under src/ and tests/ that directly import (or vi.mock) a file named in "from" of moves.json.
import { readFileSync, readdirSync, lstatSync, existsSync } from 'node:fs';
import { resolve, relative, dirname, extname, sep } from 'node:path';
import { createRequire } from 'node:module';

const [projectArg, movesArg, flag] = process.argv.slice(2);
const project = resolve(projectArg);
const ts = createRequire(resolve(project, 'package.json'))('typescript');
const WG = 'src/core/work-graph/';
const moved = new Set(JSON.parse(readFileSync(movesArg, 'utf8')).map((m) => resolve(project, WG + m.from)));
const files = [];
const walk = (p) => { const st = lstatSync(p); if (st.isDirectory()) { for (const n of readdirSync(p).sort()) walk(resolve(p, n)); } else if (['.ts', '.tsx', '.mts'].includes(extname(p))) files.push(p); };
walk(resolve(project, 'tests'));
if (flag !== '--tests-only') walk(resolve(project, 'src'));
const out = [];
for (const file of files) {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  let hit = false;
  const consider = (lit) => {
    if (!lit || !ts.isStringLiteralLike(lit) || !lit.text.startsWith('.')) return;
    const abs = resolve(dirname(file), lit.text).replace(/\.(?:js|mjs|cjs|jsx)$/, '.ts');
    if (moved.has(abs)) hit = true;
  };
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) consider(node.moduleSpecifier);
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) consider(node.argument.literal);
    else if (ts.isCallExpression(node)) {
      const c = node.expression;
      if (c.kind === ts.SyntaxKind.ImportKeyword || (ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.expression) && c.expression.text === 'vi')) consider(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (hit && !moved.has(file)) out.push(relative(project, file).split(sep).join('/'));
}
console.log(out.join('\n'));
