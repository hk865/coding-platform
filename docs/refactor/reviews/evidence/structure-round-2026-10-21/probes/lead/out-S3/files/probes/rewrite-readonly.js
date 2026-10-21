const ts = require('/home/han001/dsh-work/slices/s9s85-S3/node_modules/typescript');
const fs = require('fs');
const p = '/home/han001/dsh-work/slices/s9s85-S3/src/core/agent-runtime/readonly-command-tool.ts';
let text = fs.readFileSync(p, 'utf8');
const sf = ts.createSourceFile(p, text, ts.ScriptTarget.Latest, true);
const edits = [];
const describes = [];
const walk = (n, fn) => { fn(n); ts.forEachChild(n, c => walk(c, fn)); };
walk(sf, n => {
  if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'describe') describes.push(n);
  if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === 'description') {
    edits.push({ start: n.initializer.getStart(sf), end: n.initializer.getEnd(), replacement: "PLATFORM_PROMPT_PACK_V1.tools['run_readonly_command'].description" });
  }
});
if (describes.length !== 3) throw new Error('describe count ' + describes.length);
const keys = ['command', 'cwd', 'timeoutMs'];
describes.forEach((n, i) => {
  const arg = n.arguments[0];
  edits.push({ start: arg.getStart(sf), end: arg.getEnd(), replacement: `PLATFORM_PROMPT_PACK_V1.tools['run_readonly_command'].parameters['${keys[i]}']` });
});
edits.sort((a, b) => b.start - a.start);
for (const e of edits) text = text.slice(0, e.start) + e.replacement + text.slice(e.end);
fs.writeFileSync(p, text, 'utf8');
console.log('applied', edits.length, 'edits');
