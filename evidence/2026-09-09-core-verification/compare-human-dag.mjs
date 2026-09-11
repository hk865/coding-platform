import fs from 'node:fs';
import assert from 'node:assert/strict';
const root = '../agent_learn/agent_dev/agent_platform';
function edges(file, heading) {
  const text = fs.readFileSync(`${root}/${file}`, 'utf8');
  const section = text.slice(text.indexOf(heading));
  const graph = section.match(/```mermaid([\s\S]*?)```/)?.[1];
  assert.ok(graph, `Missing graph in ${file}`);
  return [...graph.matchAll(/^\s*(\w+)\s*-->\s*(\w+)/gm)].map(match => `${match[1]} -> ${match[2]}`).sort();
}
const architecture = edges('ARCHITECTURE.md', '## ModuleDependencyDAG');
const human = edges('human/module-status.md', '## 模块依赖 DAG');
assert.deepEqual(human, architecture);
console.log(JSON.stringify({ moduleEdges: architecture.length, matches: true, edges: architecture }, null, 2));
