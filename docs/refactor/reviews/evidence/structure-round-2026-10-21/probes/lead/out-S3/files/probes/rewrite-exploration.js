const ts = require('/home/han001/dsh-work/slices/s9s85-S3/node_modules/typescript');
const fs = require('fs');
const p = '/home/han001/dsh-work/slices/s9s85-S3/src/core/agent-runtime/exploration-tools.ts';
let text = fs.readFileSync(p, 'utf8');
const sf = ts.createSourceFile(p, text, ts.ScriptTarget.Latest, true);
const edits = [];
const walk = (n, fn) => { fn(n); ts.forEachChild(n, c => walk(c, fn)); };
const describes = [];
walk(sf, n => {
  if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'tool' && n.arguments.length >= 2) {
    const name = ts.isStringLiteral(n.arguments[0]) ? n.arguments[0].text : null;
    if (!name) throw new Error('non-literal tool name');
    const arg = n.arguments[1];
    edits.push({ start: arg.getStart(sf), end: arg.getEnd(), replacement: `PLATFORM_PROMPT_PACK_V1.tools['${name}'].description` });
  }
  if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'describe') {
    describes.push(n);
  }
});
if (describes.length !== 2) throw new Error('describe count ' + describes.length);
const prefixes = [
  "PLATFORM_PROMPT_PACK_V1.tools['list_files'].parameters['prefix']",
  "PLATFORM_PROMPT_PACK_V1.tools['search'].parameters['prefix']",
];
describes.forEach((n, i) => {
  const arg = n.arguments[0];
  edits.push({ start: arg.getStart(sf), end: arg.getEnd(), replacement: prefixes[i] });
});
edits.sort((a, b) => b.start - a.start);
for (const e of edits) text = text.slice(0, e.start) + e.replacement + text.slice(e.end);
fs.writeFileSync(p, text, 'utf8');
console.log('applied', edits.length, 'edits');
