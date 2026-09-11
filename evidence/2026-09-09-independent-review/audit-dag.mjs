import { readFileSync, writeFileSync } from 'node:fs';
const root = 'D:/1.project/Software/agent_learn/agent_dev/agent_platform';
const modules = ['HumanCollaboration', 'PlanCompiler', 'ControlEngine', 'DispatchEngine', 'VerificationEngine', 'ArchitectureReconciler', 'WorkerRuntime', 'StateLedger', 'ArtifactVault', 'ReadModelIndex', 'ContextCompiler', 'WorkspaceReader'];
function graph(path, heading) {
  const body = readFileSync(root + '/' + path, 'utf8');
  const start = body.indexOf(heading);
  if (start < 0) throw Error('Missing graph heading');
  const section = body.slice(start).match(/```mermaid\s*([\s\S]*?)```/)[1];
  const edges = [...section.matchAll(/^\s*(\w+)\s*-->\s*(\w+)\s*$/gm)].map(m => [m[1], m[2]]).filter(([a,b]) => modules.includes(a) && modules.includes(b));
  const keys = edges.map(e => e.join(' -> ')).sort();
  const visited = new Set(), active = new Set();
  function visit(node) { if (active.has(node)) throw Error('Module cycle at ' + node); if (visited.has(node)) return; active.add(node); for (const [a,b] of edges) if (a === node) visit(b); active.delete(node); visited.add(node); }
  modules.forEach(visit);
  return { path, nodes: new Set(edges.flat()).size, edges: keys, duplicateEdges: keys.length - new Set(keys).size, acyclic: true };
}
const architecture = graph('ARCHITECTURE.md', '## ModuleDependencyDAG');
const human = graph('human/module-status.md', '## 模块依赖 DAG');
const result = { architecture, human, missing: architecture.edges.filter(e => !human.edges.includes(e)), extra: human.edges.filter(e => !architecture.edges.includes(e)) };
writeFileSync('evidence/2026-09-09-independent-review/audit-dag.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ nodes: architecture.nodes, architectureEdges: architecture.edges.length, humanNodes: human.nodes, humanEdges: human.edges.length, missing: result.missing, extra: result.extra, acyclic: true }));
