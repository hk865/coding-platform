const fs = require('node:fs');
const path = require('node:path');
const ts = require(process.cwd() + '/.local/linux-test-tools/node_modules/typescript/lib/typescript.js');

const ticketTerms = new Map([
  ['00', 'goal/bootstrap'], ['01', 'persistent platform'], ['02', 'governance/plan'],
  ['03', 'dispatch'], ['04', 'verification'], ['05', 'context assembly'], ['06', 'handoff'],
  ['07', 'workspace concurrency'], ['08', 'console projection'], ['09', 'query'],
  ['10', 'control intent'], ['11', 'plan change'], ['12', 'architecture inspection'],
  ['13', 'architecture evolution'], ['14', 'baseline evolution'], ['15', 'human/role collaboration'],
  ['16', 'context continuity'], ['17', 'completed-work context'], ['18', 'material access'],
]);
const rewrite = (comment) => {
  let next = comment.replace(/P1-(\d{2})/g, (_, number) => ticketTerms.get(number) ?? `slice ${number}`);
  next = next.replace(/\bRW-\d+\b/g, '');
  next = next.replace(/CM-1A-001(?:\s*§?\s*\d+|\s*第\s*\d+\s*工作段)?/g, 'coordination runtime');
  next = next.replace(/CM-1B-001(?:\s*§?\s*\d+|\s*第\s*\d+\s*工作段)?/g, 'collaboration routing');
  next = next.replace(/CM-1C-001(?:\s*§?\s*\d+|\s*第\s*\d+\s*工作段)?/g, 'architecture collaboration');
  next = next.replace(/LANE-A\/LANE-B/g, 'combined projection').replace(/LANE-A/g, 'fact projection').replace(/LANE-B/g, 'detail projection');
  next = next.replace(/lane A/gi, 'fact projection').replace(/lane B/gi, 'detail projection');
  next = next.replace(/integrator ruling/gi, 'current contract').replace(/integrator fill after merge/gi, 'shared projection contract');
  next = next.replace(/\bFROZEN\b/g, 'VERSIONED').replace(/\bfrozen\b/g, 'versioned');
  next = next.replace(/\bpersistent harness\b/gi, 'persistent test host').replace(/\bharness\b/gi, 'test host');
  return next;
};

const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'vendor', 'fixtures', 'testing', 'dist'].includes(entry.name)) continue;
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(target);
    else if (/\.(?:ts|tsx|js|py)$/.test(entry.name)) files.push(target);
  }
};
walk('src');
const changed = [];
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const ranges = new Map();
  const add = (range) => { if (range) ranges.set(`${range.pos}:${range.end}`, range); };
  for (const range of ts.getLeadingCommentRanges(source, 0) ?? []) add(range);
  const visit = (node) => {
    for (const range of ts.getLeadingCommentRanges(source, node.pos) ?? []) add(range);
    for (const range of ts.getTrailingCommentRanges(source, node.end) ?? []) add(range);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  const edits = [];
  for (const range of ranges.values()) {
    const before = source.slice(range.pos, range.end);
    const after = rewrite(before);
    if (after !== before) edits.push({ start: range.pos, end: range.end, after });
  }
  if (!edits.length) continue;
  let next = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) next = next.slice(0, edit.start) + edit.after + next.slice(edit.end);
  fs.writeFileSync(file, next);
  changed.push({ file: file.replaceAll('\\', '/'), comments: edits.length });
}
fs.writeFileSync('evidence/collaboration-memory/batch/post-m-architecture/current-comment-rewrite-map.json', JSON.stringify({ changed, exclusions: ['vendor provenance', 'fixtures', 'testing'], note: 'Comment text only; identifiers and persisted values were not changed.' }, null, 2) + '\n');
console.log(JSON.stringify({ files: changed.length, comments: changed.reduce((sum, item) => sum + item.comments, 0) }));
