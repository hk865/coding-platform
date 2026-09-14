const fs = require('node:fs');
const ts = require(process.cwd() + '/.local/linux-test-tools/node_modules/typescript/lib/typescript.js');

const files = [
  'src/data/read-model-index/read-model-index.ts',
  'src/data/read-model-index/sqlite-read-model-index.ts',
];
const exact = new Map([
  ['P108_TABLES', 'CONSOLE_TABLES'],
  ['P115RankedFact', 'CollaborationRankedFact'],
  ['applyP108ConsoleLaneA', 'applyConsoleOverview'],
  ['applyP108ConsoleLaneB', 'applyConsoleDetails'],
  ['applyP108Console', 'applyConsoleEvent'],
  ['applyP109', 'applyQueryEvent'],
  ['applyP110', 'applyControlIntentEvent'],
  ['applyP111', 'applyPlanChangeEvent'],
  ['applyP112InspectionLaneA', 'applyArchitectureInspectionFacts'],
  ['applyP112InspectionLaneB', 'applyArchitectureDecisionArtifacts'],
  ['applyP112Inspection', 'applyArchitectureInspectionEvent'],
  ['applyP113', 'applyArchitectureEvolutionEvent'],
  ['applyP114', 'applyBaselineEvolutionEvent'],
  ['applyP115', 'applyCollaborationEvent'],
  ['applyP118', 'applyMaterialAccessEvent'],
]);
const prefixes = [
  ['p108', 'console'],
  ['p109', 'query'],
  ['p110', 'controlIntent'],
  ['p111', 'planChange'],
  ['p112', 'architectureInspection'],
  ['p113', 'architectureEvolution'],
  ['p114', 'baselineEvolution'],
  ['p115', 'collaboration'],
  ['p116', 'workContext'],
  ['p118', 'materialAccess'],
];
const special = new Map([
  ['consoleLaneBPrepare', 'consoleDetailPrepare'],
  ['consoleLaneBStmtCache', 'consoleDetailStmtCache'],
]);

const changed = [];
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const edits = [];
  const visit = (node) => {
    if (ts.isIdentifier(node)) {
    const oldName = node.text;
    let newName = exact.get(oldName);
    if (!newName) {
      for (const [prefix, replacement] of prefixes) {
        if (oldName.startsWith(prefix)) {
          newName = replacement + oldName.slice(prefix.length);
          break;
        }
      }
    }
    newName = newName ? special.get(newName) ?? newName : undefined;
    if (newName && newName !== oldName) {
      edits.push({ start: node.getStart(ast), end: node.getEnd(), oldName, newName });
    }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  let next = source;
  for (const edit of edits.reverse()) next = next.slice(0, edit.start) + edit.newName + next.slice(edit.end);
  fs.writeFileSync(file, next);
  changed.push({ file, identifiers: edits.length, names: [...new Set(edits.map(({ oldName, newName }) => `${oldName} -> ${newName}`))].sort() });
}
fs.writeFileSync(
  'evidence/collaboration-memory/batch/post-m-architecture/read-model-rename-map.json',
  JSON.stringify({ changed, limitation: 'Identifier tokens only; comments and persisted string/table names are unchanged.' }, null, 2) + '\n',
);
console.log(JSON.stringify(changed.map(({ file, identifiers }) => ({ file, identifiers }))));
