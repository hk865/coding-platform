const fs = require('node:fs');
const ts = require(process.cwd() + '/.local/linux-test-tools/node_modules/typescript/lib/typescript.js');
const dir = 'evidence/collaboration-memory/batch/post-m-architecture';
const before = ts.createSourceFile('before.ts', fs.readFileSync(`${dir}/ledger-validation-before.txt`, 'utf8'), 99, true);
const printer = ts.createPrinter({ removeComments: true });
const names = n => n.name ? [n.name.text] : n.declarationList?.declarations.map(d => d.name.getText()) ?? [];
const normalize = (node, ast) => printer.printNode(ts.EmitHint.Unspecified, node, ast)
  .replace(/^export\s+/, '').replaceAll('../../../contracts/', '../../contracts/');
const baseline = new Map(before.statements.filter(n => !ts.isImportDeclaration(n)).flatMap(n => names(n).map(name => [name, normalize(n, before)])));
const issues = [], observed = new Set();
for (const entry of JSON.parse(fs.readFileSync(`${dir}/ledger-move-map.json`, 'utf8'))) {
  const file = `src/data/state-ledger/${entry.destination}`;
  const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), 99, true);
  for (const name of entry.names) {
    const node = ast.statements.find(n => !ts.isImportDeclaration(n) && names(n).includes(name));
    if (!node || normalize(node, ast) !== baseline.get(name)) issues.push({ name, file, reason: 'Declaration differs beyond relocation/export/comments' });
    observed.add(name);
  }
}
for (const name of baseline.keys()) if (!observed.has(name)) issues.push({ name, reason: 'Missing declaration' });
const report = { checkedDeclarations: baseline.size, issues,
  limitation: 'Checks declaration preservation, not import wiring or runtime behavior; typecheck and directed adapter tests remain required.' };
fs.writeFileSync(`${dir}/ledger-move-check.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
if (issues.length) process.exitCode = 1;
