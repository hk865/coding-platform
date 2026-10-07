// node move-stats.mjs <projectDir> <moves.json>: per move, the importer files, specifiers, inline import() types, vi.mock uses
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { createRequire } from 'node:module';
const [projectArg, movesArg] = process.argv.slice(2);
const project = resolve(projectArg);
const ts = createRequire(resolve(project, 'package.json'))('typescript');
const WG = 'src/core/work-graph/';
const moves = JSON.parse(readFileSync(movesArg, 'utf8'));
const files = [];
const walk = (p) => { const st = lstatSync(p); if (st.isDirectory()) { for (const n of readdirSync(p).sort()) walk(resolve(p, n)); } else if (['.ts', '.tsx', '.mts'].includes(extname(p))) files.push(p); };
walk(resolve(project, 'src')); walk(resolve(project, 'tests'));
const stats = new Map(moves.map((m) => [resolve(project, WG + m.from), { id: m.id, from: m.from, files: new Set(), specs: 0, importTypes: 0, dyn: 0, vi: 0, lines: readFileSync(resolve(project, WG + m.from), 'utf8').split('\n').length }]));
for (const file of files) {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const consider = (lit, kind) => {
    if (!lit || !ts.isStringLiteralLike(lit) || !lit.text.startsWith('.')) return;
    const abs = resolve(dirname(file), lit.text).replace(/\.(?:js|mjs|cjs|jsx)$/, '.ts');
    const s = stats.get(abs); if (!s) return;
    s.files.add(file); s.specs++; if (kind) s[kind]++;
  };
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) consider(node.moduleSpecifier);
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) consider(node.argument.literal, 'importTypes');
    else if (ts.isCallExpression(node)) {
      const c = node.expression;
      if (c.kind === ts.SyntaxKind.ImportKeyword) consider(node.arguments[0], 'dyn');
      else if (ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.expression) && c.expression.text === 'vi') consider(node.arguments[0], 'vi');
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
for (const s of stats.values()) console.log([s.id, s.from, 'lines=' + s.lines, 'importers=' + s.files.size, 'specs=' + s.specs, 'importTypes=' + s.importTypes, 'dyn=' + s.dyn, 'vi=' + s.vi].join('\t'));
