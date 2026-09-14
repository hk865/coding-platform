const fs = require('node:fs');
const ts = require(process.cwd() + '/.local/linux-test-tools/node_modules/typescript/lib/typescript.js');

const files = [
  'src/data/read-model-index/read-model-index.ts',
  'src/data/read-model-index/sqlite-read-model-index.ts',
];
const methodToFunction = new Map([
  ['consoleTerminalDisplayState', 'runDisplayStateForEvent'],
  ['consoleBuildMatrix', 'buildPlanMatrixView'],
  ['consoleToTaskEvidenceEntry', 'toTaskEvidenceEntry'],
  ['consoleBuildPortfolio', 'buildPortfolioView'],
  ['architectureInspectionSyntheticInspection', 'buildSyntheticArchitectureInspection'],
]);

for (const file of files) {
  let source = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const removals = [];
  const visit = (node) => {
    if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && methodToFunction.has(node.name.text)) {
      removals.push({ start: node.getFullStart(), end: node.getEnd(), name: node.name.text });
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  for (const removal of removals.sort((a, b) => b.start - a.start)) {
    source = source.slice(0, removal.start) + source.slice(removal.end);
  }
  for (const [method, shared] of methodToFunction) {
    source = source.replaceAll(`this.${method}(`, `${shared}(`);
  }
  const importBlock = "import { buildPlanMatrixView, buildPortfolioView, runDisplayStateForEvent, toTaskEvidenceEntry } from './console-projection.js';\n" +
    "import { buildSyntheticArchitectureInspection } from './architecture-inspection-projection.js';\n";
  source = importBlock + source;
  fs.writeFileSync(file, source);
  console.log(JSON.stringify({ file, removedMethods: removals.map(({ name }) => name) }));
}
