// Import-graph report for one source subtree (task D evidence, 2026-10-02).
//
//   node scripts/import-graph.mjs [--root src/core/work-graph] [--out <dir>]
//
// Prints a Markdown summary and, with --out, writes import-graph.json and
// import-graph.md there. Groups are the first path segment below --root
// (files directly in the root form the group "(root)"). Reported:
//   - file-level edges (with line and type-only flag) and line counts;
//   - group-level edge counts, value-only and type-only separately;
//   - strongly connected components (file level and group level), all
//     elementary group-level cycles, and for each file-level SCC one shortest
//     cycle through every member, so every file that sits on a cycle is shown.
import { readdir, readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { resolve, relative, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const SOURCE = new Set(['.ts', '.tsx', '.mts', '.cts']);
const toPosix = path => path.split(sep).join('/');

export async function collectImportGraph(projectDir, rootRel) {
  const project = resolve(projectDir);
  const root = resolve(project, rootRel);
  const files = [];
  async function walk(path) {
    const stat = await lstat(path);
    if (stat.isDirectory()) { for (const name of (await readdir(path)).sort()) await walk(resolve(path, name)); return; }
    if (SOURCE.has(extname(path))) files.push(path);
  }
  await walk(root);
  const known = new Set(files);
  const nodes = [];
  const edges = [];
  const external = new Map();
  for (const path of files) {
    const rel = toPosix(relative(root, path));
    const content = await readFile(path, 'utf8');
    nodes.push({ file: rel, group: rel.includes('/') ? rel.split('/')[0] : '(root)', lines: content.split('\n').length });
    const source = ts.createSourceFile(rel, content, ts.ScriptTarget.Latest, true);
    const visit = node => {
      let specifier = null;
      let typeOnly = false;
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        specifier = node.moduleSpecifier.text;
        typeOnly = ts.isImportDeclaration(node)
          ? node.importClause?.isTypeOnly === true ||
            (node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings) &&
              node.importClause.name === undefined && node.importClause.namedBindings.elements.length > 0 &&
              node.importClause.namedBindings.elements.every(element => element.isTypeOnly)) === true
          : node.isTypeOnly === true;
      } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
        specifier = node.argument.literal.text;
        typeOnly = true;
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        specifier = node.arguments[0].text;
      }
      if (specifier?.startsWith('.')) {
        const target = resolve(dirname(path), specifier).replace(/\.(?:js|mjs|cjs|jsx)$/, '.ts');
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        if (known.has(target)) edges.push({ from: rel, to: toPosix(relative(root, target)), line, typeOnly });
        else {
          const outside = toPosix(relative(project, target));
          external.set(outside, (external.get(outside) ?? 0) + 1);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { root: toPosix(relative(project, root)), nodes, edges, external: Object.fromEntries([...external].sort()) };
}

/** Tarjan SCC; returns components with more than one node or a self loop. */
export function stronglyConnected(nodeIds, successors) {
  let index = 0;
  const indices = new Map(), low = new Map(), onStack = new Set(), stack = [], components = [];
  const strong = node => {
    indices.set(node, index); low.set(node, index); index++;
    stack.push(node); onStack.add(node);
    for (const next of successors(node)) {
      if (!indices.has(next)) { strong(next); low.set(node, Math.min(low.get(node), low.get(next))); }
      else if (onStack.has(next)) low.set(node, Math.min(low.get(node), indices.get(next)));
    }
    if (low.get(node) === indices.get(node)) {
      const component = [];
      let member;
      do { member = stack.pop(); onStack.delete(member); component.push(member); } while (member !== node);
      if (component.length > 1 || successors(node).includes(node)) components.push(component.sort());
    }
  };
  for (const node of nodeIds) if (!indices.has(node)) strong(node);
  return components.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
}

/** Johnson-style enumeration of elementary cycles, bounded for safety. */
export function elementaryCycles(nodeIds, successors, limit = 5000) {
  const cycles = [];
  const ordered = [...nodeIds].sort();
  for (let s = 0; s < ordered.length && cycles.length < limit; s++) {
    const start = ordered[s];
    const allowed = new Set(ordered.slice(s));
    const path = [start];
    const onPath = new Set([start]);
    const search = node => {
      for (const next of successors(node)) {
        if (!allowed.has(next) || cycles.length >= limit) continue;
        if (next === start) cycles.push([...path, start]);
        else if (!onPath.has(next)) { path.push(next); onPath.add(next); search(next); path.pop(); onPath.delete(next); }
      }
    };
    search(start);
  }
  return cycles;
}

function shortestCycleThrough(node, successors, members) {
  const previous = new Map([[node, null]]);
  const queue = [node];
  while (queue.length) {
    const current = queue.shift();
    for (const next of successors(current)) {
      if (!members.has(next)) continue;
      if (next === node) {
        const cycle = [node];
        for (let cursor = current; cursor !== node; cursor = previous.get(cursor)) cycle.splice(1, 0, cursor);
        return [...cycle, node];
      }
      if (!previous.has(next)) { previous.set(next, current); queue.push(next); }
    }
  }
  return null;
}

export function analyzeImportGraph(graph) {
  const fileIds = graph.nodes.map(node => node.file);
  const groupOf = new Map(graph.nodes.map(node => [node.file, node.group]));
  const succ = (edges) => {
    const map = new Map(fileIds.map(id => [id, new Set()]));
    for (const edge of edges) map.get(edge.from).add(edge.to);
    return id => [...(map.get(id) ?? [])].sort();
  };
  const allSucc = succ(graph.edges);
  const valueSucc = succ(graph.edges.filter(edge => !edge.typeOnly));
  const groups = [...new Set(graph.nodes.map(node => node.group))].sort();
  const groupEdges = new Map();
  for (const edge of graph.edges) {
    const from = groupOf.get(edge.from), to = groupOf.get(edge.to);
    if (from === to) continue;
    const key = `${from} -> ${to}`;
    const entry = groupEdges.get(key) ?? { from, to, value: 0, typeOnly: 0, examples: [] };
    entry[edge.typeOnly ? 'typeOnly' : 'value']++;
    if (entry.examples.length < 3) entry.examples.push(`${edge.from}:${edge.line} -> ${edge.to}${edge.typeOnly ? ' (type)' : ''}`);
    groupEdges.set(key, entry);
  }
  const groupSucc = (onlyValue) => {
    const map = new Map(groups.map(group => [group, new Set()]));
    for (const entry of groupEdges.values()) if (!onlyValue || entry.value > 0) map.get(entry.from).add(entry.to);
    return group => [...map.get(group)].sort();
  };
  const fileComponents = stronglyConnected(fileIds, allSucc).map(members => {
    const set = new Set(members);
    const cycles = new Map();
    for (const member of members) {
      const cycle = shortestCycleThrough(member, allSucc, set);
      if (cycle) cycles.set(cycle.slice(0, -1).sort().join('|'), cycle);
    }
    return { size: members.length, groups: [...new Set(members.map(member => groupOf.get(member)))].sort(), members, cycles: [...cycles.values()] };
  });
  const lines = new Map();
  for (const node of graph.nodes) lines.set(node.group, (lines.get(node.group) ?? 0) + node.lines);
  return {
    root: graph.root,
    totals: { files: graph.nodes.length, edges: graph.edges.length, typeOnlyEdges: graph.edges.filter(edge => edge.typeOnly).length,
      lines: graph.nodes.reduce((sum, node) => sum + node.lines, 0) },
    groups: groups.map(group => ({ group, files: graph.nodes.filter(node => node.group === group).length, lines: lines.get(group) })),
    largestFiles: [...graph.nodes].sort((a, b) => b.lines - a.lines).slice(0, 25),
    groupEdges: [...groupEdges.values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
    groupComponents: stronglyConnected(groups, groupSucc(false)),
    groupComponentsValueOnly: stronglyConnected(groups, groupSucc(true)),
    groupCycles: elementaryCycles(groups, groupSucc(false)),
    groupCyclesValueOnly: elementaryCycles(groups, groupSucc(true)),
    fileComponents,
    fileComponentsValueOnly: stronglyConnected(fileIds, valueSucc).map(members => ({ size: members.length, members })),
    external: graph.external,
    // Raw graph kept in the report so later tools can re-check a layering against it.
    nodes: graph.nodes,
    edges: graph.edges,
  };
}

export function renderMarkdown(report) {
  const out = [];
  out.push(`# Import graph: ${report.root}`, '');
  out.push(`${report.totals.files} files, ${report.totals.lines} lines, ${report.totals.edges} internal import edges (${report.totals.typeOnlyEdges} type-only).`, '');
  out.push('## Groups', '', '| group | files | lines |', '| --- | ---: | ---: |');
  for (const group of report.groups) out.push(`| ${group.group} | ${group.files} | ${group.lines} |`);
  out.push('', '## Group edges', '', '| from | to | value imports | type-only imports | examples |', '| --- | --- | ---: | ---: | --- |');
  for (const edge of report.groupEdges) out.push(`| ${edge.from} | ${edge.to} | ${edge.value} | ${edge.typeOnly} | ${edge.examples.join('<br>')} |`);
  out.push('', '## Group-level strongly connected components', '');
  for (const component of report.groupComponents) out.push(`- (${component.length}) ${component.join(', ')}`);
  if (!report.groupComponents.length) out.push('- none');
  out.push('', 'Value imports only (type-only imports removed):', '');
  for (const component of report.groupComponentsValueOnly) out.push(`- (${component.length}) ${component.join(', ')}`);
  if (!report.groupComponentsValueOnly.length) out.push('- none');
  out.push('', `## Group-level elementary cycles (${report.groupCycles.length}; value-only ${report.groupCyclesValueOnly.length})`, '');
  for (const cycle of report.groupCycles) out.push(`- ${cycle.join(' -> ')}`);
  out.push('', `## File-level strongly connected components (${report.fileComponents.length})`, '');
  for (const [index, component] of report.fileComponents.entries()) {
    out.push(`### SCC ${index + 1}: ${component.size} files across ${component.groups.join(', ')}`, '');
    out.push('Members: ' + component.members.map(member => `\`${member}\``).join(', '), '');
    out.push('Shortest cycle through each member:', '');
    for (const cycle of component.cycles) out.push(`- ${cycle.join(' -> ')}`);
    out.push('');
  }
  out.push(`## File-level SCCs with value imports only (${report.fileComponentsValueOnly.length})`, '');
  for (const component of report.fileComponentsValueOnly) out.push(`- (${component.size}) ${component.members.join(', ')}`);
  out.push('', '## Largest files', '', '| file | lines |', '| --- | ---: |');
  for (const node of report.largestFiles) out.push(`| ${node.file} | ${node.lines} |`);
  out.push('', '## Imports leaving the root', '', '| target | imports |', '| --- | ---: |');
  for (const [target, count] of Object.entries(report.external)) out.push(`| ${target} | ${count} |`);
  return out.join('\n') + '\n';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
  const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const report = analyzeImportGraph(await collectImportGraph(project, option('--root') ?? 'src/core/work-graph'));
  const markdown = renderMarkdown(report);
  const out = option('--out');
  if (out) {
    await mkdir(resolve(project, out), { recursive: true });
    await writeFile(resolve(project, out, 'import-graph.json'), JSON.stringify(report, null, 2) + '\n');
    await writeFile(resolve(project, out, 'import-graph.md'), markdown);
  }
  process.stdout.write(markdown);
}
