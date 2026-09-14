const fs = require('node:fs');
const path = require('node:path');
const ts = require(process.cwd() + '/.local/linux-test-tools/node_modules/typescript/lib/typescript.js');

const names = new Map([
  ['P15_COORDINATION_BUDGET_MAX', 'COORDINATION_AUTONOMOUS_REWORK_BUDGET_MAX'],
  ['P15_COORDINATION_POLICY_REVISION', 'COORDINATION_POLICY_REVISION_V1'],
  ['P15_MAX_OPTIONS', 'INITIAL_DESIGN_MAX_OPTIONS'],
  ['P15_OPTION_SUMMARY_MAX_BYTES', 'INITIAL_DESIGN_OPTION_SUMMARY_MAX_BYTES'],
]);
const roots = ['src', 'tests'];
const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'vendor' || entry.name === 'dist') continue;
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(target);
    else if (/\.tsx?$/.test(entry.name)) files.push(target);
  }
};
for (const root of roots) walk(root);
const report = [];
for (const file of files) {
  let source = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const edits = [];
  const visit = (node) => {
    if (ts.isIdentifier(node) && names.has(node.text)) edits.push({ start: node.getStart(ast), end: node.getEnd(), replacement: names.get(node.text) });
    ts.forEachChild(node, visit);
  };
  visit(ast);
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.replacement + source.slice(edit.end);
  if (edits.length) { fs.writeFileSync(file, source); report.push({ file: file.replaceAll('\\', '/'), identifiers: edits.length }); }
}
fs.writeFileSync('evidence/collaboration-memory/batch/post-m-architecture/current-policy-rename-map.json', JSON.stringify({ names: Object.fromEntries(names), files: report }, null, 2) + '\n');
console.log(JSON.stringify({ files: report.length, identifiers: report.reduce((sum, item) => sum + item.identifiers, 0) }));
