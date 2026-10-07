// node assign.mjs <import-graph.json> <target.json>  > check-input.json
// Turns target.json into the proposal format of scripts/import-graph-check.mjs: every file of the graph is assigned
// to the submodule that owns its path (directory prefix, or the single root file), the way check-boundaries.mjs
// decides it. A file no submodule owns is left out, so import-graph-check reports it as "unassigned".
import { readFileSync } from 'node:fs';

const [graphPath, targetPath] = process.argv.slice(2);
const graph = JSON.parse(readFileSync(graphPath, 'utf8'));
const target = JSON.parse(readFileSync(targetPath, 'utf8'));
const owner = (file) => target.submodules.find((s) => (s.path.endsWith('/') ? file.startsWith(s.path) : file === s.path))?.id;
const assign = {};
for (const node of graph.nodes) { const id = owner(node.file); if (id) assign[node.file] = id; }
console.log(JSON.stringify({
  submodules: target.submodules.map((s) => ({ id: s.id, dependencies: s.dependencies })),
  assign,
  ports: [],
}, null, 2));
