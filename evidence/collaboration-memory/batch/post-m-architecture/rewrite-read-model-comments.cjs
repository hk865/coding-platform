const fs = require('node:fs');
const ts = require(process.cwd() + '/.local/linux-test-tools/node_modules/typescript/lib/typescript.js');

const files = [
  'src/data/read-model-index/read-model-index.ts',
  'src/data/read-model-index/sqlite-read-model-index.ts',
];
const replacements = [
  [/P1-08/g, 'Console'], [/P1-09/g, 'Query'], [/P1-10/g, 'Control-intent'],
  [/P1-11/g, 'Plan-change'], [/P1-12/g, 'Architecture-inspection'],
  [/P1-13/g, 'Architecture-evolution'], [/P1-14/g, 'Baseline-evolution'],
  [/P1-15/g, 'Collaboration'], [/P1-16/g, 'Work-context'], [/P1-18/g, 'Material-access'],
  [/LANE-A\/LANE-B/g, 'combined'], [/LANE-A/g, 'fact projection'], [/LANE-B/g, 'detail projection'],
  [/lane A/gi, 'fact projection'], [/lane B/gi, 'detail projection'], [/lanes merged/gi, 'projection parts were combined'],
  [/applyP112InspectionLaneA/g, 'applyArchitectureInspectionFacts'],
  [/applyP112InspectionLaneB/g, 'applyArchitectureDecisionArtifacts'],
  [/p112InspectionRows/g, 'architectureInspectionRows'],
  [/p112FindingRows/g, 'architectureFindingRows'],
  [/integrator ruling/gi, 'projection contract'],
  [/integrator fill after merge/gi, 'shared projection contract'],
];

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const ranges = new Map();
  const add = (range) => { if (range) ranges.set(`${range.pos}:${range.end}`, range); };
  const visit = (node) => {
    for (const range of ts.getLeadingCommentRanges(source, node.pos) ?? []) add(range);
    for (const range of ts.getTrailingCommentRanges(source, node.end) ?? []) add(range);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  let next = source;
  const edits = [];
  for (const range of ranges.values()) {
    const before = source.slice(range.pos, range.end);
    let after = before;
    for (const [pattern, replacement] of replacements) after = after.replace(pattern, replacement);
    if (after !== before) edits.push({ start: range.pos, end: range.end, after });
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) next = next.slice(0, edit.start) + edit.after + next.slice(edit.end);
  fs.writeFileSync(file, next);
  console.log(JSON.stringify({ file, commentsChanged: edits.length }));
}
