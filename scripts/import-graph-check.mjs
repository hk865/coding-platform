// Score a proposed WorkGraph submodule layering against the real file-level import graph (task D evidence).
//   node scripts/import-graph-check.mjs <import-graph.json from scripts/import-graph.mjs> <proposal.json>
// proposal.json:
// {
//   "submodules": [{ "id": "model", "dependencies": [] }, { "id": "tasks", "dependencies": ["model", ...] }, ...],
//   "assign": { "<current path relative to src/core/work-graph>": "<submodule id>", ... },   // every file must be assigned
//   "newFiles": { "<split-off file name>": "<submodule id>" },                                  // optional, informational
//   "ports": [{ "from": "<file>", "to": "<file>", "why": "..." }]                                // edges to be replaced by port injection
// }
// Output: unassigned files, unknown submodules, submodule dependency cycles, and every file edge that
// violates the declared dependencies (excluding edges listed in "ports"), split value/type-only.
import { readFileSync } from 'node:fs';

const [graphPath, proposalPath] = process.argv.slice(2);
const graph = JSON.parse(readFileSync(graphPath, 'utf8'));
const proposal = JSON.parse(readFileSync(proposalPath, 'utf8'));
const subs = new Map(proposal.submodules.map(s => [s.id, new Set(s.dependencies)]));
const problems = [];
for (const node of graph.nodes) if (!proposal.assign[node.file]) problems.push(`unassigned file ${node.file}`);
for (const [file, sub] of Object.entries(proposal.assign)) {
  if (!subs.has(sub)) problems.push(`file ${file} assigned to unknown submodule ${sub}`);
  if (!graph.nodes.some(node => node.file === file)) problems.push(`assigned file ${file} does not exist`);
}
for (const [id, deps] of subs) for (const dep of deps) if (!subs.has(dep)) problems.push(`submodule ${id} depends on unknown ${dep}`);
// cycle check on declared deps
const state = new Map();
const stack = [];
let cycle = null;
const visit = id => {
  state.set(id, 1); stack.push(id);
  for (const dep of subs.get(id) ?? []) {
    if (cycle) return;
    if (state.get(dep) === 1) { cycle = [...stack.slice(stack.indexOf(dep)), dep]; return; }
    if (!state.has(dep)) visit(dep);
  }
  stack.pop(); state.set(id, 2);
};
for (const id of subs.keys()) if (!state.has(id) && !cycle) visit(id);
if (cycle) problems.push(`declared submodule cycle ${cycle.join(' -> ')}`);
const ported = new Set((proposal.ports ?? []).map(port => `${port.from} -> ${port.to}`));
const violations = [];
const used = new Map();
for (const edge of graph.edges) {
  const from = proposal.assign[edge.from], to = proposal.assign[edge.to];
  if (!from || !to || from === to) continue;
  const key = `${from} -> ${to}`;
  if ((subs.get(from) ?? new Set()).has(to)) { used.set(key, (used.get(key) ?? 0) + 1); continue; }
  if (ported.has(`${edge.from} -> ${edge.to}`)) continue;
  violations.push(`${edge.typeOnly ? 'type ' : 'value'} ${edge.from}:${edge.line} -> ${edge.to}   [${key}]`);
}
const sizes = new Map();
for (const node of graph.nodes) {
  const sub = proposal.assign[node.file];
  if (sub) sizes.set(sub, { files: (sizes.get(sub)?.files ?? 0) + 1, lines: (sizes.get(sub)?.lines ?? 0) + node.lines });
}
console.log(JSON.stringify({
  problems, violationCount: violations.length, violations,
  usedEdges: Object.fromEntries([...used].sort()),
  unusedDeclaredEdges: [...subs].flatMap(([id, deps]) => [...deps].filter(dep => !used.has(`${id} -> ${dep}`)).map(dep => `${id} -> ${dep}`)),
  sizes: Object.fromEntries([...sizes].sort()),
  portCount: ported.size,
}, null, 2));
process.exitCode = problems.length || violations.length ? 1 : 0;
