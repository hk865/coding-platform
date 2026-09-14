const fs = require('node:fs');
const ts = require(process.cwd() + '/.local/linux-test-tools/node_modules/typescript/lib/typescript.js');

const evidenceDir = 'evidence/collaboration-memory/batch/post-m-architecture';
const before = ts.createSourceFile(
  'before.ts',
  fs.readFileSync(`${evidenceDir}/coordination-records-before.txt`, 'utf8'),
  ts.ScriptTarget.Latest,
  true,
);
const printer = ts.createPrinter({ removeComments: true });
const declarationNames = (node) => node.name
  ? [node.name.text]
  : node.declarationList?.declarations.map((declaration) => declaration.name.getText()) ?? [];
const normalize = (node, ast) => printer.printNode(ts.EmitHint.Unspecified, node, ast)
  .replace(/^export\s+/, '')
  .replaceAll('../../../../contracts/', '../../../contracts/');

const baseline = new Map(
  before.statements
    .filter((node) => !ts.isImportDeclaration(node) && !ts.isExportDeclaration(node))
    .flatMap((node) => declarationNames(node).map((name) => [name, normalize(node, before)])),
);
const issues = [];
const observed = new Set();
for (const entry of JSON.parse(fs.readFileSync(`${evidenceDir}/coordination-record-move-map.json`, 'utf8'))) {
  if (entry.names.length === 0) continue;
  const file = `src/control/control-engine/${entry.destination}`;
  const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  for (const name of entry.names) {
    const node = ast.statements.find((candidate) =>
      !ts.isImportDeclaration(candidate)
      && !ts.isExportDeclaration(candidate)
      && declarationNames(candidate).includes(name));
    if (!node || normalize(node, ast) !== baseline.get(name)) {
      issues.push({ name, file, reason: 'Declaration differs beyond relocation, export visibility, or comments' });
    }
    observed.add(name);
  }
}
for (const name of baseline.keys()) {
  if (!observed.has(name)) issues.push({ name, reason: 'Missing declaration' });
}
const report = {
  checkedDeclarations: baseline.size,
  issues,
  limitation: 'Checks declaration preservation only; typecheck and directed coordination tests remain required.',
};
fs.writeFileSync(`${evidenceDir}/coordination-record-move-check.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
if (issues.length > 0) process.exitCode = 1;
