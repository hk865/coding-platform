const ts = require('/home/han001/dsh-work/slices/s9s85-S3/node_modules/typescript');
const fs = require('fs');
const path = require('path');

function evalLiteral(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return evalLiteral(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return evalLiteral(node.left) + evalLiteral(node.right);
  }
  throw new Error('unsupported expression kind ' + ts.SyntaxKind[node.kind] + ' at ' + node.getStart());
}

function lineOf(sf, node) {
  return sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
}

function walk(node, fn) {
  fn(node);
  ts.forEachChild(node, c => walk(c, fn));
}

const files = process.argv.slice(2);
const out = {};
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const describes = [];
  let descProp = [];
  walk(sf, node => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'describe') {
      describes.push({ line: lineOf(sf, node), text: evalLiteral(node.arguments[0]) });
    }
    if (ts.isPropertyAssignment(node) && ((ts.isIdentifier(node.name) && node.name.text === 'description') || (ts.isStringLiteral(node.name) && node.name.text === 'description'))) {
      try { descProp.push({ line: lineOf(sf, node), text: evalLiteral(node.initializer) }); } catch (e) { descProp.push({ line: lineOf(sf, node), error: String(e) }); }
    }
  });
  out[path.basename(file)] = { describes, descProp };
}
fs.writeFileSync('/tmp/s85-scratch/S3/probes/extracted.json', JSON.stringify(out, null, 2), 'utf8');
console.log('wrote extracted.json');
