const ts = require('/home/han001/dsh-work/slices/s9s85-S3/node_modules/typescript');
const fs = require('fs');
const path = require('path');
function evalLiteral(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return evalLiteral(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) return evalLiteral(node.left) + evalLiteral(node.right);
  throw new Error('unsupported ' + ts.SyntaxKind[node.kind]);
}
const lineOf = (sf, n) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
const walk = (n, fn) => { fn(n); ts.forEachChild(n, c => walk(c, fn)); };
const base = '/home/han001/dsh-work/slices/s9s85-S3/src/core/agent-runtime/';
const read = f => ts.createSourceFile(f, fs.readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true);

// whiteboard descriptions record
{
  const file = base + 'whiteboard-tools.ts';
  const sf = read(file); const out = {};
  walk(sf, n => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === 'descriptions' && ts.isObjectLiteralExpression(n.initializer)) {
      for (const p of n.initializer.properties) {
        if (ts.isPropertyAssignment(p)) out[p.name.text] = { line: lineOf(sf, p), text: evalLiteral(p.initializer) };
      }
    }
  });
  console.log(JSON.stringify({ 'whiteboard-tools.ts': out }));
}
// note description variable
{
  const file = base + 'note-tool.ts';
  const sf = read(file); const out = {};
  walk(sf, n => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === 'description') {
      out.description = { line: lineOf(sf, n), text: evalLiteral(n.initializer) };
    }
  });
  console.log(JSON.stringify({ 'note-tool.ts': out }));
}
// exploration tool() descriptions
{
  const file = base + 'exploration-tools.ts';
  const sf = read(file); const out = {};
  walk(sf, n => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'tool' && n.arguments.length >= 2) {
      try { out[evalLiteral(n.arguments[0])] = { line: lineOf(sf, n), text: evalLiteral(n.arguments[1]) }; } catch (e) { out['ERR@' + lineOf(sf, n)] = String(e); }
    }
  });
  console.log(JSON.stringify({ 'exploration-tools.ts': out }));
}
