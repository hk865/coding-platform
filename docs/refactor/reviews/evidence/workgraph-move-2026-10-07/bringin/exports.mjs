// Task D bring-in: the exported names of every module under src/ and tests/, from the TypeScript checker.
//   node exports.mjs <out.json>        (run from the repository root, which supplies node_modules/typescript)
// For each source file: every name in checker.getExportsOfModule (own exports, re-exports and `export *` alike),
// with "value"/"type"/"value+type"/"namespace" from the resolved symbol's flags. Both tsconfig.json (src + tests,
// without src/ui) and tsconfig.ui.json (src/ui) are read, the same two programs as `npm run typecheck`.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';

const root = process.cwd();
const ts = createRequire(resolve(root, 'package.json'))('typescript');
const out = process.argv[2];
if (!out) { console.error('usage: node exports.mjs <out.json>'); process.exit(2); }

const result = {};
for (const config of ['tsconfig.json', 'tsconfig.ui.json']) {
  const file = resolve(root, config);
  const read = ts.readConfigFile(file, ts.sys.readFile);
  if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(file));
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const checker = program.getTypeChecker();
  for (const sf of program.getSourceFiles()) {
    const rel = relative(root, sf.fileName).split('\\').join('/');
    if (!(rel.startsWith('src/') || rel.startsWith('tests/'))) continue;
    if (rel in result) continue;
    const moduleSymbol = checker.getSymbolAtLocation(sf);
    const names = [];
    if (moduleSymbol) {
      for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
        let target = symbol;
        if (symbol.flags & ts.SymbolFlags.Alias) {
          try { target = checker.getAliasedSymbol(symbol); } catch { target = symbol; }
        }
        const f = target.flags;
        const kind = [
          f & ts.SymbolFlags.Value ? 'value' : '',
          f & ts.SymbolFlags.Type ? 'type' : '',
          f & ts.SymbolFlags.Namespace && !(f & ts.SymbolFlags.Value) ? 'namespace' : '',
        ].filter(Boolean).join('+') || `flags:${f}`;
        names.push(`${symbol.escapedName}:${kind}`);
      }
    }
    result[rel] = names.sort();
  }
}
const files = Object.keys(result).sort();
const sorted = Object.fromEntries(files.map(f => [f, result[f]]));
writeFileSync(out, JSON.stringify(sorted, null, 1) + '\n');
const withExports = files.filter(f => result[f].length > 0).length;
const total = files.reduce((n, f) => n + result[f].length, 0);
console.log(`exports: ${files.length} files, ${withExports} with exports, ${total} exported names -> ${out}`);
