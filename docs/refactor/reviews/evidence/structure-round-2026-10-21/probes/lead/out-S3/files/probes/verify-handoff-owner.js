const fs = require('fs');
const path = require('path');
const ts = require('/home/han001/dsh-work/slices/s9s85-S3/node_modules/typescript');
const BASE = '/tmp/s85-scratch/S3/base';
const HAND = '/tmp/s85-scratch/S3/handoff';
const TMP = '/tmp/s85-scratch/S3/probes/rest-recheck';
let failures = 0;

function fail(msg) { failures++; console.log('FAIL', msg); }
function readBase(rel) { return fs.readFileSync(path.join(BASE, rel), 'utf8'); }
function source(rel) {
  const text = readBase(rel);
  return { text, sf: ts.createSourceFile(path.join(BASE, rel), text, ts.ScriptTarget.Latest, true) };
}
function walk(node, fn) { fn(node); ts.forEachChild(node, child => walk(child, fn)); }

function compareBytes(label, expected, actualPath) {
  const a = Buffer.from(expected, 'utf8');
  const b = fs.readFileSync(actualPath);
  if (a.equals(b)) return;
  let i = 0;
  while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
  const around = (buf) => JSON.stringify(buf.subarray(Math.max(0, i - 16), i + 16).toString('utf8'));
  fail(`${label}: byte mismatch at offset ${i}; expected ${a.length} bytes ${around(a)}; actual ${b.length} bytes ${around(b)}`);
}

// ---------- rest re-extraction from the base copy ----------
const extractor = fs.readFileSync('/tmp/s85-scratch/S3/probes/extract-rest.js', 'utf8')
  .replace("const outDir = '/tmp/s85-scratch/S3/handoff/rest';", `const outDir = '${TMP}';`);
fs.mkdirSync(TMP + '/templates', { recursive: true });
fs.writeFileSync('/tmp/s85-scratch/S3/probes/extract-rest-recheck.js', extractor);
require('/tmp/s85-scratch/S3/probes/extract-rest-recheck.js');
const reStrings = JSON.parse(fs.readFileSync(TMP + '/strings.json', 'utf8'));
const handStrings = JSON.parse(fs.readFileSync(HAND + '/rest/strings.json', 'utf8'));
if (JSON.stringify(reStrings) !== JSON.stringify(handStrings)) fail('rest strings.json differs from base re-extraction');
for (const id of fs.readdirSync(TMP + '/templates')) {
  compareBytes(`template ${id}`, fs.readFileSync(TMP + '/templates/' + id, 'utf8'), `${HAND}/rest/templates/${id}`);
}

// ---------- merged strings ----------
const tools1 = JSON.parse(fs.readFileSync(HAND + '/tools-1/strings.json', 'utf8'));
const tools2 = JSON.parse(fs.readFileSync(HAND + '/tools-2/strings.json', 'utf8'));
const merged = { ...tools1, ...tools2, ...handStrings };
if (Object.keys(merged).length !== 49) fail(`merged string count ${Object.keys(merged).length}, wanted 49`);
const locations = {
  ...JSON.parse(fs.readFileSync(HAND + '/tools-1/MANIFEST.json', 'utf8')).strings,
  ...JSON.parse(fs.readFileSync(HAND + '/rest/MANIFEST.json', 'utf8')).strings,
};
for (const [key, value] of Object.entries(merged)) {
  const loc = locations[key];
  if (!loc) { fail(`no base location for ${key}`); continue; }
  const m = loc.match(/^(.*):(\d+)$/);
  const line = readBase(m[1]).split('\n')[Number(m[2]) - 1];
  if (!line.includes(value)) fail(`${key}: value ${JSON.stringify(value)} not on ${loc}: ${JSON.stringify(line)}`);
}

// ---------- AST extraction of the four templates ----------
const mapConsult = (text) => text === 'message.ref.messageId' ? '{{messageId}}'
  : text === 'JSON.stringify(message.sourceRef)' ? '{{sourceJson}}' : null;
const mapScribe = (text) => text === 'SCRIBE_REMINDER_MARKER' ? '{{marker}}'
  : text === 'String(pendingCount)' ? '{{pendingCount}}'
  : text === 'String(updateDueCount)' ? '{{updateDueCount}}'
  : text === "[...anchorNames].slice(0, 20).join('、')" ? '{{anchors}}' : null;
const mapDecision = (text) => text === 'canonicalJson(body as unknown as JsonValue)' ? '{{bodyJson}}' : null;
function evaluate(node, sf, mapper) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return evaluate(node.expression, sf, mapper);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken)
    return evaluate(node.left, sf, mapper) + evaluate(node.right, sf, mapper);
  if (ts.isCallExpression(node)) {
    const mapped = mapper(node.getText(sf));
    if (mapped !== null) return mapped;
    throw new Error('unexpected call ' + node.getText(sf));
  }
  if (ts.isTemplateExpression(node)) {
    let out = node.head.text;
    for (const span of node.templateSpans) {
      const mapped = mapper(span.expression.getText(sf));
      if (mapped === null) throw new Error('unexpected expression ' + span.expression.getText(sf));
      out += mapped + span.literal.text;
    }
    return out;
  }
  throw new Error('unexpected node ' + ts.SyntaxKind[node.kind] + ' at ' + node.getStart(sf));
}

const guideFile = source('src/core/agent-runtime/query-preparation.ts');
let guideNode;
walk(guideFile.sf, node => {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'INITIAL_COORDINATION_RESPONSE_GUIDE')
    guideNode = node.initializer;
});
if (!guideNode) fail('guide initializer not found');
else compareBytes('initial-planning-answer', evaluate(guideNode, guideFile.sf, () => { throw new Error('guide has substitution'); }),
  HAND + '/rest/templates/initial-planning-answer.txt');

const consultFile = source('src/business/workflow/consultation.ts');
let consultNode;
walk(consultFile.sf, node => {
  if (ts.isTemplateExpression(node) && node.head.text.startsWith('Process the original received input')) consultNode = node;
});
if (!consultNode) fail('consultation template not found');
else compareBytes('consultation-received-input', evaluate(consultNode, consultFile.sf, mapConsult),
  HAND + '/rest/templates/consultation-received-input.txt');

const decisionFile = source('src/core/agent-runtime/execution-inputs.ts');
let decisionNode;
walk(decisionFile.sf, node => {
  if (ts.isFunctionDeclaration(node) && node.name && node.name.text === 'formatDecisionResponseInput') {
    walk(node.body, inner => { if (ts.isReturnStatement(inner) && inner.expression) decisionNode = inner.expression; });
  }
});
if (!decisionNode) fail('formatDecisionResponseInput return not found');
else compareBytes('user-decision-response', evaluate(decisionNode, decisionFile.sf, mapDecision),
  HAND + '/rest/templates/user-decision-response.txt');

const hostFile = source('src/app/host.ts');
let scribeNode;
walk(hostFile.sf, node => {
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken
    && ts.isTemplateExpression(node.left) && node.left.getText(hostFile.sf).includes('待审 ')
    && ts.isTemplateExpression(node.right) && node.right.head.text.startsWith('锚点：')) scribeNode = node;
});
if (!scribeNode) fail('scribe template not found');
else compareBytes('scribe-reminder', evaluate(scribeNode, hostFile.sf, mapScribe),
  HAND + '/rest/templates/scribe-reminder.txt');

// ---------- tool file shape and name coverage ----------
const toolNames = [...Object.keys(JSON.parse(fs.readFileSync(HAND + '/tools-1/MANIFEST.json', 'utf8')).tools),
  ...Object.keys(JSON.parse(fs.readFileSync(HAND + '/tools-2/MANIFEST.json', 'utf8')).tools)];
if (toolNames.length !== 31 || new Set(toolNames).size !== 31) fail('tool name list is not 31 unique names');
for (const name of toolNames) {
  const dir = fs.existsSync(`${HAND}/tools-1/tools/${name}.json`) ? 'tools-1' : 'tools-2';
  const file = `${HAND}/${dir}/tools/${name}.json`;
  if (!fs.existsSync(file)) { fail(`missing tool file ${name}`); continue; }
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (typeof parsed.description !== 'string' || parsed.description === '') fail(`${name}: no description`);
  if (typeof parsed.parameters !== 'object' || parsed.parameters === null || Array.isArray(parsed.parameters))
    fail(`${name}: parameters is not an object`);
  for (const [p, text] of Object.entries(parsed.parameters)) if (typeof text !== 'string') fail(`${name}.${p}: not a string`);
}
console.log(failures === 0 ? 'OK: strings, templates and 31 tool files match the base copy' : failures + ' FAILURES');
process.exit(failures === 0 ? 0 : 1);
