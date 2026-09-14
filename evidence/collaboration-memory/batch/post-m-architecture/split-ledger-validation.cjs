// One-time structural migration. Run from product root against the recorded baseline.
const fs = require('node:fs');
const ts = require(process.cwd() + '/.local/linux-test-tools/node_modules/typescript/lib/typescript.js');
const file = 'src/data/state-ledger/ledger-validation.ts';
const source = fs.readFileSync(file, 'utf8');
if (!source.includes('function validateReviewCommit')) throw new Error('Expected unsplit baseline');
fs.writeFileSync('evidence/collaboration-memory/batch/post-m-architecture/ledger-validation-before.txt', source);
const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
const printer = ts.createPrinter({ removeComments: true });
const imports = ast.statements.filter(ts.isImportDeclaration);
const declarations = ast.statements.filter(n => !ts.isImportDeclaration(n));
const names = n => n.name ? [n.name.text] : n.declarationList.declarations.map(d => d.name.getText(ast));
const ranges = [
  [183, 'review'], [202, 'batch-identity'], [362, 'governance'],
  [427, 'planning'], [650, 'dispatch'], [826, 'run-facts'],
  [1011, 'evidence-reduction'], [1142, 'handoff'], [1147, 'batch-identity'],
  [1307, 'workspace-leases'], [1415, 'integration'], [1488, 'control-intents'],
  [1574, 'query'], [1636, 'planning'], [1783, 'architecture-evolution'],
  [1862, 'governance'], [1918, 'material-access'], [1959, 'work-context'],
  [2078, 'architecture-inspection'], [2182, 'work-context'], [2212, 'query'],
  [2471, 'communication-routing'], [2643, 'participation'],
  [2927, 'communication-routing'], [2986, 'successor-claim'],
  [2997, 'batch-identity'], [3067, 'bootstrap'], [3172, 'work-identity'],
  [3257, 'run-facts'], [3392, 'communication-routing'], [3415, 'dispatch'],
  [3429, 'communication-routing'], [3493, 'successor-claim'], [Infinity, 'participation'],
];
const groups = new Map(), owners = new Map();
for (const n of declarations) {
  const line = ast.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  const group = ranges.find(([end]) => line <= end)[1];
  if (!groups.has(group)) groups.set(group, []);
  groups.get(group).push(n);
  for (const name of names(n)) owners.set(name, group);
}
function identifiers(nodes) {
  const found = new Set();
  const visit = n => { if (ts.isIdentifier(n)) found.add(n.text); ts.forEachChild(n, visit); };
  nodes.forEach(visit); return found;
}
// Relocate only relative module specifier strings; preserve all executable bodies.
function relocate(text) { return text.replace(/(["'])\.\.\/\.\.\/contracts\//g, '$1../../../contracts/').replace(/(["'])\.\/([^"']+)\.js\1/g, '$1../$2.js$1'); }
fs.mkdirSync('src/data/state-ledger/validation', { recursive: true });
const manifest = [];
for (const [group, nodes] of groups) {
  const used = identifiers(nodes), headers = [];
  for (const imp of imports) {
    const clause = imp.importClause;
    if (!clause) { headers.push(relocate(imp.getText(ast))); continue; }
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      const elements = bindings.elements.filter(e => used.has(e.name.text));
      const defaultName = clause.name && used.has(clause.name.text) ? clause.name : undefined;
      if (!elements.length && !defaultName) continue;
      const updated = ts.factory.updateImportDeclaration(imp, imp.modifiers,
        ts.factory.updateImportClause(clause, clause.isTypeOnly, defaultName,
          elements.length ? ts.factory.updateNamedImports(bindings, elements) : undefined), imp.moduleSpecifier, imp.attributes);
      headers.push(relocate(printer.printNode(ts.EmitHint.Unspecified, updated, ast)));
    } else if (used.has(clause.name?.text) || used.has(bindings?.name?.text)) headers.push(relocate(imp.getText(ast)));
  }
  const dependencies = new Map();
  for (const [name, owner] of owners) if (owner !== group && used.has(name)) {
    if (!dependencies.has(owner)) dependencies.set(owner, []);
    dependencies.get(owner).push(name);
  }
  for (const [owner, imported] of dependencies) headers.push(`import { ${imported.join(', ')} } from './${owner}.js';`);
  const bodies = nodes.map(n => {
    const exported = n.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
    const text = n.getText(ast);
    const trivia = source.slice(n.getFullStart(), n.getStart());
    manifest.push({ names: names(n), destination: `validation/${group}.ts`, originallyExported: Boolean(exported) });
    return trivia + (exported ? '' : 'export ') + relocate(text);
  });
  fs.writeFileSync(`src/data/state-ledger/validation/${group}.ts`,
    `/** Internal StateLedger ${group} rules. Both adapters invoke these inside their commit protocol. */\n` + headers.join('\n') + '\n' + bodies.join('\n') + '\n');
}
const exportLines = [];
for (const [group, nodes] of groups) {
  const publicNames = nodes.filter(n => n.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword))
    .flatMap(n => names(n).map(name => ts.isTypeAliasDeclaration(n) || ts.isInterfaceDeclaration(n) ? `type ${name}` : name));
  if (publicNames.length) exportLines.push(`export { ${publicNames.join(', ')} } from './validation/${group}.js';`);
}
fs.writeFileSync(file, '/** Shared ledger rules, grouped by the responsibility of each commit.\n * This stable import surface preserves existing consumers. Adapter transactions\n * still perform state-dependent checks; Control admission is a separate check.\n * Internal helpers live in validation/ and are not exported here.\n */\n' + exportLines.join('\n') + '\n');
fs.writeFileSync('evidence/collaboration-memory/batch/post-m-architecture/ledger-move-map.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ groups: [...groups.keys()], declarations: manifest.length }));
