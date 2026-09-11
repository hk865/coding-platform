#!/usr/bin/env node
// Independent external-review checks (2026-09-10). Read-only: verifies source identity,
// log digests, DAG equality across docs + enforcement map, and full-run totals.
// Written by the external architecture/product reviewer; does not modify product source.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { allowedModuleDependencies, modules } from '../../scripts/module-map.mjs';

const root = process.cwd();
const ev = 'evidence/2026-09-09-independent-review/';
const sha = d => createHash('sha256').update(d).digest('hex');
const out = { ranAt: new Date().toISOString(), checks: {} };

// 1. candidate-04 per-file identity against the CURRENT working tree.
const manifest = JSON.parse(readFileSync(ev + 'candidate-04-source-sha256.json', 'utf8'));
const missing = [], changed = [];
for (const e of manifest.files) {
  try { if (sha(readFileSync(e.path)) !== e.sha256) changed.push(e.path); }
  catch { missing.push(e.path); }
}
out.checks.sourceIdentity = {
  files: manifest.files.length,
  declaredDigest: manifest.digest,
  recomputedDigest: sha(JSON.stringify(manifest.files)),
  duplicatePaths: manifest.files.length - new Set(manifest.files.map(f => f.path)).size,
  missing, changed,
  matchesCurrentTree: missing.length === 0 && changed.length === 0 && sha(JSON.stringify(manifest.files)) === manifest.digest,
};

// 2. All declared logs re-hashed.
const identity = JSON.parse(readFileSync(ev + 'final-source-identity.json', 'utf8'));
const logs = Object.values(identity.logs);
out.checks.logs = { count: logs.length, mismatched: logs.filter(l => sha(readFileSync(ev + l.path)) !== l.sha256).map(l => l.path) };

// 3. 697 -> 730 change set recomputed from the two manifests.
const vr01 = JSON.parse(readFileSync('evidence/2026-09-09-core-verification/resume-02-source-sha256.json', 'utf8'));
const before = new Map(vr01.files.map(f => [f.path, f.sha256]));
const after = new Map(manifest.files.map(f => [f.path, f.sha256]));
const added = [...after.keys()].filter(p => !before.has(p));
const removed = [...before.keys()].filter(p => !after.has(p));
const modified = [...after.keys()].filter(p => before.has(p) && before.get(p) !== after.get(p));
out.checks.changeSet = { added: added.length, modified: modified.length, removed: removed.length, total: added.length + modified.length + removed.length,
  matchesIdentity: JSON.stringify([...added].sort()) === JSON.stringify(Object.values(identity.changes).filter(c => !c.before).map(c => c.path).sort()) };

// 4. DAG equality: ARCHITECTURE.md vs human/module-status.md vs module-map enforcement table.
const docsRoot = '/mnt/d/1.project/software/agent_learn/agent_dev/agent_platform/';
const modSet = new Set(modules);
function parseEdges(file) {
  const text = readFileSync(file, 'utf8');
  const start = text.indexOf('flowchart LR');
  const block = text.slice(start, text.indexOf('```', start));
  const edges = new Set();
  for (const line of block.split('\n')) {
    const m = line.match(/^\s*([A-Za-z][A-Za-z0-9]*)\s*--?>\s*\|?[^\n]*?\|?\s*([A-Za-z][A-Za-z0-9]*)\s*$/);
    if (m && modSet.has(m[1]) && modSet.has(m[2])) edges.add(m[1] + ' -> ' + m[2]);
  }
  return edges;
}
const arch = parseEdges(docsRoot + 'ARCHITECTURE.md');
const human = parseEdges(docsRoot + 'human/module-status.md');
const map = new Set(Object.entries(allowedModuleDependencies).flatMap(([f, ts]) => ts.map(t => f + ' -> ' + t)));
const diff = (a, b) => [...a].filter(x => !b.has(x));
function cycle(edges) {
  const adj = new Map(modules.map(m => [m, []]));
  for (const e of edges) { const [a, b] = e.split(' -> '); adj.get(a).push(b); }
  const state = new Map(); let found = null;
  const dfs = (n, path) => { if (state.get(n) === 1) { found = [...path, n]; return; } if (state.get(n) === 2) return; state.set(n, 1); for (const x of adj.get(n)) { dfs(x, [...path, n]); if (found) return; } state.set(n, 2); };
  for (const m of modules) { dfs(m, []); if (found) break; }
  return found;
}
out.checks.dag = { archEdges: arch.size, humanEdges: human.size, mapEdges: map.size,
  archOnly: diff(arch, map), mapOnly: diff(map, arch), humanOnly: diff(human, map), mapOnlyVsHuman: diff(map, human),
  cycle: cycle(map) };

// 5. Full-run and browser totals parsed from the accepted logs.
const strip = s => s.replace(/\u001b\[[0-9;]*m/g, '');
const full = strip(readFileSync(ev + 'full-tests-final-workers2.log', 'utf8'));
const perFile = full.split('\n').filter(l => /^\s*[✓✗×↓]/.test(l) && /\.test\.ts/.test(l));
out.checks.fullRun = {
  fileLines: perFile.length,
  summedTests: perFile.reduce((n, l) => n + (Number((l.match(/(\d+)\s+tests?/) || [])[1]) || 0), 0),
  summary: full.split('\n').filter(l => /Test Files|^\s+Tests |Duration|Start at/.test(l)).map(l => l.trim()),
  skippedOrTodo: full.split('\n').filter(l => /\b(skipped|todo)\b/i.test(l)).length,
  reviewerAndExplorationFiles: perFile.filter(l => /reviewer|independent-review|explorations\.test/.test(l)).map(l => l.trim().slice(0, 100)),
};
const browser = strip(readFileSync(ev + 'browser-final-04.log', 'utf8'));
out.checks.browser = browser.split('\n').filter(l => /passed|failed/.test(l)).slice(-3).map(l => l.trim());

writeFileSync('evidence/2026-09-10-external-review/independent-checks.json', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 1));
