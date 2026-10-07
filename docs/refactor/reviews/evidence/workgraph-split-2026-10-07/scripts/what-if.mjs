// node what-if.mjs <import-graph.json> <code-steps.json> <step ids, comma-separated>  > edited-graph.json
// Applies the import-edge effect of the named small code steps (code-steps.json; NOT part of task D) to the
// file-level graph of the moved tree, so submodule-graph.mjs can show what is left after them. It only edits the
// graph (remove / add file edges, add nodes); it does not model anything else of the code change.
import { readFileSync } from 'node:fs';

const [graphPath, stepsPath, idsArg] = process.argv.slice(2);
const graph = JSON.parse(readFileSync(graphPath, 'utf8'));
const ids = idsArg.split(',');
const steps = JSON.parse(readFileSync(stepsPath, 'utf8')).steps.filter((s) => ids.includes(s.id));
if (steps.length !== ids.length) throw new Error(`unknown step in ${idsArg}`);
const nodes = [...graph.nodes];
let edges = [...graph.edges];
for (const step of steps) {
  for (const n of step.addNodes ?? []) nodes.push({ file: n.file, group: n.file.includes('/') ? n.file.split('/')[0] : '(root)', lines: n.lines });
  for (const r of step.remove ?? []) {
    const before = edges.length;
    edges = edges.filter((e) => !(e.from === r.from && e.to === r.to));
    if (edges.length === before) throw new Error(`${step.id}: no edge ${r.from} -> ${r.to} to remove`);
  }
  for (const a of step.add ?? []) edges.push({ from: a.from, to: a.to, line: 0, typeOnly: a.typeOnly === true });
}
console.log(JSON.stringify({ root: graph.root, nodes, edges }, null, 1));
