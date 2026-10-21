const ts = require('/home/han001/dsh-work/slices/s9s85-S3/node_modules/typescript');
const fs = require('fs');
const path = require('path');
const SF = '/home/han001/dsh-work/slices/s9s85-S3';
const BASE = '/tmp/s85-scratch/S3/base';
const OUT = '/tmp/s85-scratch/S3/handoff/tools-1';

function evalLiteral(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return evalLiteral(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) return evalLiteral(node.left) + evalLiteral(node.right);
  throw new Error('unsupported ' + ts.SyntaxKind[node.kind] + ' at ' + node.getStart());
}
const lineOf = (sf, n) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
const walk = (n, fn) => { fn(n); ts.forEachChild(n, fn2 => walk(fn2, fn)); };
const rel = f => 'src/core/agent-runtime/' + path.basename(f);
const read = f => ts.createSourceFile(f, fs.readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true);

const toolDocs = {};    // name -> { description, parameters }
const paramLoc = {};    // `${tool}.${path}` -> { file, line }
const descLoc = {};     // name -> { file, line }
const strings = {};
const stringLoc = {};

function addParam(tool, p, text, file, line) {
  toolDocs[tool].parameters[p] = text;
  paramLoc[tool + '.' + p] = rel(file) + ':' + line;
}

// whiteboard
{
  const file = path.join(BASE, 'src/core/agent-runtime/whiteboard-tools.ts');
  const sf = read(file);
  const descRecord = {};
  const desc = [];
  walk(sf, n => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === 'descriptions' && ts.isObjectLiteralExpression(n.initializer)) {
      for (const p of n.initializer.properties) if (ts.isPropertyAssignment(p)) descRecord[p.name.text] = { text: evalLiteral(p.initializer), line: lineOf(sf, p) };
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'describe') {
      const tag = (() => {
        // nearest property assignment name, walking ancestors is not available; use text search around
        return null;
      })();
      desc.push({ node: n, line: lineOf(sf, n.expression.name), text: evalLiteral(n.arguments[0]) });
    }
  });
  for (const name of ['query_task_graph', 'query_ready_tasks', 'propose_future_plan', 'apply_future_plan']) {
    toolDocs[name] = { description: descRecord[name].text, parameters: {} };
    descLoc[name] = { file: rel(file), line: descRecord[name].line };
  }
  // describes in source order: [0..1] shared versionPin ref/revision; [2..5] propose; [6..9] apply
  if (desc.length !== 10) throw new Error('whiteboard describe count ' + desc.length);
  strings['toolSchema.whiteboardPin.ref'] = desc[0].text;
  strings['toolSchema.whiteboardPin.revision'] = desc[1].text;
  stringLoc['toolSchema.whiteboardPin.ref'] = rel(file) + ':' + desc[0].line;
  stringLoc['toolSchema.whiteboardPin.revision'] = rel(file) + ':' + desc[1].line;
  addParam('propose_future_plan', 'basedOn', desc[2].text, file, desc[2].line);
  addParam('propose_future_plan', 'draft', desc[3].text, file, desc[3].line);
  addParam('propose_future_plan', 'reason', desc[4].text, file, desc[4].line);
  addParam('propose_future_plan', 'expected', desc[5].text, file, desc[5].line);
  addParam('apply_future_plan', 'proposalRef', desc[6].text, file, desc[6].line);
  addParam('apply_future_plan', 'expectedProposalRevision', desc[7].text, file, desc[7].line);
  addParam('apply_future_plan', 'expected', desc[8].text, file, desc[8].line);
  addParam('apply_future_plan', 'acknowledgementRef', desc[9].text, file, desc[9].line);
}

// note
{
  const file = path.join(BASE, 'src/core/agent-runtime/note-tool.ts');
  const sf = read(file);
  let found;
  walk(sf, n => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === 'description') found = { text: evalLiteral(n.initializer), line: lineOf(sf, n) };
  });
  toolDocs.record_note = { description: found.text, parameters: {} };
  descLoc.record_note = { file: rel(file), line: found.line };
}

// project_source
{
  const file = path.join(BASE, 'src/core/agent-runtime/project-source-tool.ts');
  const sf = read(file);
  let found;
  walk(sf, n => {
    if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === 'description') found = { text: evalLiteral(n.initializer), line: lineOf(sf, n) };
  });
  toolDocs.project_source = { description: found.text, parameters: {} };
  descLoc.project_source = { file: rel(file), line: found.line };
}

// exploration
{
  const file = path.join(BASE, 'src/core/agent-runtime/exploration-tools.ts');
  const sf = read(file);
  const names = ['read_source', 'cpp_index', 'python_index', 'code_index', 'source_excerpt', 'list_files', 'search', 'symbols'];
  walk(sf, n => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'tool' && n.arguments.length >= 2) {
      const name = evalLiteral(n.arguments[0]);
      toolDocs[name] = { description: evalLiteral(n.arguments[1]), parameters: {} };
      descLoc[name] = { file: rel(file), line: lineOf(sf, n) };
    }
  });
  for (const n of names) if (!toolDocs[n]) throw new Error('missing exploration ' + n);
  const describes = [];
  walk(sf, n => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'describe') describes.push({ line: lineOf(sf, n.expression.name), text: evalLiteral(n.arguments[0]) });
  });
  if (describes.length !== 2) throw new Error('exploration describe count ' + describes.length);
  addParam('list_files', 'prefix', describes[0].text, file, describes[0].line);
  addParam('search', 'prefix', describes[1].text, file, describes[1].line);
}

// readonly
{
  const file = path.join(BASE, 'src/core/agent-runtime/readonly-command-tool.ts');
  const sf = read(file);
  let found;
  const describes = [];
  walk(sf, n => {
    if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === 'description') found = { text: evalLiteral(n.initializer), line: lineOf(sf, n) };
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'describe') describes.push({ line: lineOf(sf, n.expression.name), text: evalLiteral(n.arguments[0]) });
  });
  toolDocs.run_readonly_command = { description: found.text, parameters: {} };
  descLoc.run_readonly_command = { file: rel(file), line: found.line };
  if (describes.length !== 3) throw new Error('readonly describe count ' + describes.length);
  addParam('run_readonly_command', 'command', describes[0].text, file, describes[0].line);
  addParam('run_readonly_command', 'cwd', describes[1].text, file, describes[1].line);
  addParam('run_readonly_command', 'timeoutMs', describes[2].text, file, describes[2].line);
}

// rerun
{
  const file = path.join(BASE, 'src/core/agent-runtime/command-rerun-tools.ts');
  const sf = read(file);
  let found;
  const describes = [];
  walk(sf, n => {
    if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === 'description') found = { text: evalLiteral(n.initializer), line: lineOf(sf, n) };
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'describe') describes.push({ line: lineOf(sf, n.expression.name), text: evalLiteral(n.arguments[0]) });
  });
  toolDocs.request_command_rerun = { description: found.text, parameters: {} };
  descLoc.request_command_rerun = { file: rel(file), line: found.line };
  if (describes.length !== 5) throw new Error('rerun describe count ' + describes.length);
  // source order in schema: command, reason, rewriteOf.review, rewriteOf.alias, rewriteOf
  addParam('request_command_rerun', 'command', describes[0].text, file, describes[0].line);
  addParam('request_command_rerun', 'reason', describes[1].text, file, describes[1].line);
  addParam('request_command_rerun', 'rewriteOf', describes[2].text, file, describes[2].line);
  addParam('request_command_rerun', 'rewriteOf.review', describes[3].text, file, describes[3].line);
  addParam('request_command_rerun', 'rewriteOf.alias', describes[4].text, file, describes[4].line);
}

const expectedNames = ['query_task_graph', 'query_ready_tasks', 'propose_future_plan', 'apply_future_plan', 'record_note', 'project_source', 'read_source', 'cpp_index', 'python_index', 'code_index', 'source_excerpt', 'list_files', 'search', 'symbols', 'run_readonly_command', 'request_command_rerun'];
for (const n of expectedNames) if (!toolDocs[n]) throw new Error('missing tool ' + n);
if (Object.keys(toolDocs).length !== 16) throw new Error('extra tools ' + Object.keys(toolDocs));

fs.mkdirSync(path.join(OUT, 'tools'), { recursive: true });
for (const n of expectedNames) fs.writeFileSync(path.join(OUT, 'tools', n + '.json'), JSON.stringify(toolDocs[n], null, 2) + '\n', 'utf8');
fs.writeFileSync(path.join(OUT, 'strings.json'), JSON.stringify(strings, null, 2) + '\n', 'utf8');

const manifest = {
  strings: stringLoc,
  templates: {},
  tools: Object.fromEntries(expectedNames.map(n => [n, descLoc[n].file + ':' + descLoc[n].line])),
  notes: [
    'tool resources: ' + expectedNames.map(n => 'tools/' + n + '.json').join(', '),
    'parameter locations: ' + Object.entries(paramLoc).map(([k, v]) => k + '=' + v).join('; '),
    'the whiteboard pin schema is shared by propose_future_plan and apply_future_plan; its descriptions are strings, not tool parameters',
  ],
};
fs.writeFileSync(path.join(OUT, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log('wrote', expectedNames.length, 'tool files, strings.json, MANIFEST.json');
for (const n of expectedNames) console.log(n, 'desc len', toolDocs[n].description.length, 'params', Object.keys(toolDocs[n].parameters).join(','));
