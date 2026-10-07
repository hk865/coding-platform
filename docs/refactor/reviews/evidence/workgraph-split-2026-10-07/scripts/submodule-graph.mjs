// node submodule-graph.mjs <import-graph.json> <target.json>
// Reads the file-level WorkGraph import graph (scripts/import-graph.mjs --out) and target.json, and reports at the
// submodule level: sizes, every used edge (value / type-only), the edges the declared dependencies do not allow, the
// edges target.json "forbidden" names, edges that do not go down in the DESIGN.md §7.2 layers, cycles (submodule level
// and file level), and whether the reserved notes / views positions and the new tasks -> architecture edge stay open.
import { readFileSync } from 'node:fs';

const [graphPath, targetPath] = process.argv.slice(2);
const graph = JSON.parse(readFileSync(graphPath, 'utf8'));
const target = JSON.parse(readFileSync(targetPath, 'utf8'));
const subs = target.submodules;
const byId = new Map(subs.map((s) => [s.id, s]));
const owner = (file) => subs.find((s) => (s.path.endsWith('/') ? file.startsWith(s.path) : file === s.path))?.id;
const out = [];
const say = (line = '') => out.push(line);

const unowned = graph.nodes.filter((n) => !owner(n.file)).map((n) => n.file);
say(`files ${graph.nodes.length}, lines ${graph.nodes.reduce((a, n) => a + n.lines, 0)}, file edges ${graph.edges.length} (type-only ${graph.edges.filter((e) => e.typeOnly).length})`);
say(`files no submodule owns: ${unowned.length}${unowned.length ? ' ' + unowned.join(', ') : ''}`);
say();
say('## sizes (files / lines)');
for (const s of subs) {
  const nodes = graph.nodes.filter((n) => owner(n.file) === s.id);
  say(`${s.id}\tL${s.level}\t${nodes.length}\t${nodes.reduce((a, n) => a + n.lines, 0)}`);
}

const used = new Map();
for (const e of graph.edges) {
  const from = owner(e.from), to = owner(e.to);
  if (!from || !to || from === to) continue;
  const key = `${from} -> ${to}`;
  const entry = used.get(key) ?? { from, to, value: 0, type: 0, edges: [] };
  entry[e.typeOnly ? 'type' : 'value']++;
  entry.edges.push(`${e.typeOnly ? 'type ' : 'value'} ${e.from}:${e.line} -> ${e.to}`);
  used.set(key, entry);
}
const edges = [...used.values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
const allowed = (e) => (byId.get(e.from)?.dependencies ?? []).includes(e.to);
say();
say(`## used submodule edges (${edges.length}): value / type-only / allowed by target.json`);
for (const e of edges) say(`${e.from} -> ${e.to}\t${e.value}\t${e.type}\t${allowed(e) ? 'allowed' : 'NOT ALLOWED'}`);

const notAllowed = edges.filter((e) => !allowed(e));
say();
say(`## edges the declared dependencies do not allow: ${notAllowed.length} submodule edges, ${notAllowed.reduce((a, e) => a + e.edges.length, 0)} file edges`);
for (const e of notAllowed) { say(`${e.from} -> ${e.to}`); for (const f of e.edges) say(`  ${f}`); }

say();
say('## forbidden directions (target.json "forbidden")');
let forbiddenHits = 0;
for (const rule of target.forbidden) {
  const hits = edges.filter((e) => e.from === rule.from && rule.to.includes(e.to));
  forbiddenHits += hits.length;
  say(`${rule.from} -> {${rule.to.join(', ')}}: ${hits.length ? hits.map((e) => `${e.from} -> ${e.to} (${e.edges.length})`).join(', ') : 'none'}`);
}
say(`forbidden submodule edges used: ${forbiddenHits}`);

say();
say('## layer check (DESIGN.md §7.2): edges that do not go to a lower layer');
const notDown = edges.filter((e) => !(byId.get(e.from).level > byId.get(e.to).level));
for (const e of notDown) say(`${e.from} (L${byId.get(e.from).level}) -> ${e.to} (L${byId.get(e.to).level}) ${e.edges.length} file edges, ${allowed(e) ? 'declared in target.json' : 'NOT declared'}`);
if (!notDown.length) say('none');

// Tarjan SCC over a successor function.
const scc = (ids, succ) => {
  let index = 0; const idx = new Map(), low = new Map(), on = new Set(), stack = [], comps = [];
  const visit = (v) => {
    idx.set(v, index); low.set(v, index); index++; stack.push(v); on.add(v);
    for (const w of succ(v)) {
      if (!idx.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (on.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) === idx.get(v)) {
      const c = []; let w;
      do { w = stack.pop(); on.delete(w); c.push(w); } while (w !== v);
      if (c.length > 1 || succ(v).includes(v)) comps.push(c.sort());
    }
  };
  for (const v of ids) if (!idx.has(v)) visit(v);
  return comps;
};
const subSucc = (onlyValue) => (id) => edges.filter((e) => e.from === id && (!onlyValue || e.value > 0)).map((e) => e.to);
const fileSucc = (id) => graph.edges.filter((e) => e.from === id).map((e) => e.to);
say();
say('## cycles');
const subComps = scc(subs.map((s) => s.id), subSucc(false));
say(`submodule-level strongly connected components (all imports): ${subComps.length}${subComps.length ? ' ' + subComps.map((c) => `{${c.join(', ')}}`).join(' ') : ''}`);
const subCompsValue = scc(subs.map((s) => s.id), subSucc(true));
say(`submodule-level strongly connected components (value imports only): ${subCompsValue.length}${subCompsValue.length ? ' ' + subCompsValue.map((c) => `{${c.join(', ')}}`).join(' ') : ''}`);
const fileComps = scc(graph.nodes.map((n) => n.file), fileSucc);
say(`file-level strongly connected components: ${fileComps.length}${fileComps.length ? ' ' + fileComps.map((c) => `{${c.join(', ')}}`).join(' ') : ''}`);

// Reachability over used edges.
const reach = (from) => {
  const seen = new Set([from]); const queue = [from];
  while (queue.length) for (const n of subSucc(false)(queue.shift())) if (!seen.has(n)) { seen.add(n); queue.push(n); }
  seen.delete(from); return seen;
};
say();
say('## room for the design (DESIGN.md §7.2, D-PLACEMENT §3)');
const notes = target.reserved.find((r) => r.id === 'notes');
const reachesTop = notes.dependencies.filter((d) => [...reach(d)].some((x) => x === 'evidence' || x === 'communication'));
say(`notes (L5.5) can depend on {${notes.dependencies.join(', ')}} while evidence -> notes is added: ${reachesTop.length ? 'NO, these reach evidence/communication: ' + reachesTop.join(', ') : 'yes (none of them reaches evidence or communication)'}`);
say(`tasks -> architecture can be used without a cycle: ${reach('architecture').has('tasks') ? 'NO (architecture reaches tasks)' : 'yes (architecture does not reach tasks)'}`);
say(`views (L7): nothing in WorkGraph can depend on it; it can depend on every submodule (no submodule is above L7)`);
say(`every submodule reachable from each one (used edges):`);
for (const s of subs) say(`  ${s.id} -> {${[...reach(s.id)].sort().join(', ')}}`);
process.stdout.write(out.join('\n') + '\n');
