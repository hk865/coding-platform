// One-time structural migration of deterministic coordination commit builders.
const fs = require('node:fs');
const ts = require(process.cwd() + '/.local/linux-test-tools/node_modules/typescript/lib/typescript.js');
const file = 'src/control/control-engine/records/coordination.ts';
const source = fs.readFileSync(file, 'utf8');
if (!source.includes('function buildAgentInstanceRegisterCommit')) throw new Error('Expected unsplit baseline');
fs.writeFileSync('evidence/collaboration-memory/batch/post-m-architecture/coordination-records-before.txt', source);
const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
const printer = ts.createPrinter();
const imports = ast.statements.filter(ts.isImportDeclaration);
const declarations = ast.statements.filter(node => !ts.isImportDeclaration(node));
const declarationNames = node => node.name ? [node.name.text] : node.declarationList?.declarations.map(d => d.name.getText(ast)) ?? [];
const ranges = [[126, 'shared'], [280, 'participation'], [416, 'directed-request'], [527, 'subscription'],
  [767, 'waiting'], [1010, 'intent-lifecycle'], [Infinity, 'successor']];
const groups = new Map(), owners = new Map();
for (const node of declarations) {
  const line = ast.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  const group = ranges.find(([end]) => line <= end)[1];
  if (!groups.has(group)) groups.set(group, []);
  groups.get(group).push(node);
  for (const name of declarationNames(node)) owners.set(name, group);
}
function identifiers(nodes) {
  const result = new Set();
  const visit = node => { if (ts.isIdentifier(node)) result.add(node.text); ts.forEachChild(node, visit); };
  nodes.forEach(visit); return result;
}
function relocate(text) {
  return text.replace(/(["'])\.\.\/\.\.\/\.\.\/contracts\//g, '$1../../../../contracts/');
}
fs.mkdirSync('src/control/control-engine/records/coordination', { recursive: true });
const manifest = [];
for (const [group, nodes] of groups) {
  const used = identifiers(nodes), headers = [];
  for (const imported of imports) {
    const clause = imported.importClause;
    if (!clause) { headers.push(relocate(imported.getText(ast))); continue; }
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      const elements = clause.namedBindings.elements.filter(element => used.has(element.name.text));
      const defaultName = clause.name && used.has(clause.name.text) ? clause.name : undefined;
      if (!elements.length && !defaultName) continue;
      const updated = ts.factory.updateImportDeclaration(imported, imported.modifiers,
        ts.factory.updateImportClause(clause, clause.isTypeOnly, defaultName,
          elements.length ? ts.factory.updateNamedImports(clause.namedBindings, elements) : undefined),
        imported.moduleSpecifier, imported.attributes);
      headers.push(relocate(printer.printNode(ts.EmitHint.Unspecified, updated, ast)));
    } else if (used.has(clause.name?.text) || used.has(clause.namedBindings?.name?.text)) headers.push(relocate(imported.getText(ast)));
  }
  for (const [name, owner] of owners) if (owner !== group && used.has(name)) headers.push(`import { ${name} } from './${owner}.js';`);
  const bodies = nodes.map(node => {
    const exported = node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
    const text = node.getText(ast), trivia = source.slice(node.getFullStart(), node.getStart());
    manifest.push({ names: declarationNames(node), destination: `records/coordination/${group}.ts`, originallyExported: Boolean(exported) });
    return trivia + (exported || ts.isExportDeclaration(node) ? '' : 'export ') + relocate(text);
  });
  fs.writeFileSync(`src/control/control-engine/records/coordination/${group}.ts`,
    `/** Internal ${group} commit construction. Control admission remains in the command handler. */\n${headers.join('\n')}\n${bodies.join('\n')}\n`);
}
const exportLines = [];
for (const [group, nodes] of groups) {
  const values = [], types = [];
  for (const node of nodes.filter(n => n.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword))) {
    (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node) ? types : values).push(...declarationNames(node));
  }
  if (values.length) exportLines.push(`export { ${values.join(', ')} } from './coordination/${group}.js';`);
  if (types.length) exportLines.push(`export type { ${types.join(', ')} } from './coordination/${group}.js';`);
}
fs.writeFileSync(file, `/** Stable internal entry for deterministic coordination commit construction.\n * Builders are grouped by business behavior below records/coordination/.\n */\n${exportLines.join('\n')}\n`);
fs.writeFileSync('evidence/collaboration-memory/batch/post-m-architecture/coordination-record-move-map.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ groups: [...groups.keys()], declarations: manifest.length }));
