import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from '../../../.local/linux-test-tools/node_modules/typescript/lib/typescript.js';

const root = process.cwd();
const ev = 'evidence/2026-09-10-module-folder-reorg/';
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const before = read(ev + 'before-source-sha256.json');
const after = read(ev + 'after-source-sha256.json');
const final = read(ev + 'final-source-sha256.json');
const moves = read(ev + 'path-migration-map.json').moves;
const oldMap = new Map(before.files.map(f => [f.path, f]));
const newMap = new Map(final.files.map(f => [f.path, f]));
const moved = new Map(moves.map(m => [m.from, m.to]));
const reverse = new Map(moves.map(m => [m.to, m.from]));
const invalid = final.files.flatMap(f => !fs.existsSync(f.path) ? [{path:f.path, reason:'missing'}] : hash(fs.readFileSync(f.path)) !== f.sha256 ? [{path:f.path,reason:'hash mismatch'}] : []);
const resolveTarget = (file,spec) => {
  const p = path.posix.normalize(path.posix.join(path.posix.dirname(file),spec));
  const candidates = [p,p.replace(/\.js$/,'.ts'),p.replace(/\.js$/,'.tsx'),p.replace(/\.mjs$/,'.mts'),p+'.ts',p+'.tsx',p+'/index.ts',p+'/index.tsx',p+'/index.js'];
  return candidates.find(p => newMap.has(p) || fs.existsSync(p));
};
const results = [], unresolved = [];
let imports = 0;
for (const f of final.files) {
  if (!/\.(ts|tsx|mjs|mts|js)$/.test(f.path) || f.path.startsWith('src/app/public/')) continue;
  const oldPath = reverse.get(f.path) ?? f.path;
  const old = oldMap.get(oldPath);
  if (!old) continue;
  const body = fs.readFileSync(f.path,'utf8');
  const ast = ts.createSourceFile(f.path,body,ts.ScriptTarget.Latest,true,f.path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const spans = [];
  function add(literal) {
    if (!literal || !ts.isStringLiteralLike(literal) || !literal.text.startsWith('.')) return;
    imports++;
    const target = resolveTarget(f.path,literal.text);
    if (!target) { unresolved.push({file:f.path,spec:literal.text,line:ast.getLineAndCharacterOfPosition(literal.getStart(ast)).line+1}); return; }
    const oldTarget = reverse.get(target) ?? target;
    let spec = path.posix.relative(path.posix.dirname(oldPath),oldTarget);
    if (/\.js$/.test(literal.text)) spec=spec.replace(/\.(ts|tsx)$/,'.js');
    else if (/\.mjs$/.test(literal.text)) spec=spec.replace(/\.mts$/,'.mjs');
    else if (!path.posix.extname(literal.text)) spec=spec.replace(/\.(ts|tsx|js)$/,'').replace(/\/index$/,'');
    if (!spec.startsWith('.')) spec='./'+spec;
    spans.push({start:literal.getStart(ast)+1,end:literal.getEnd()-1,text:spec});
  }
  function visit(n) {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) add(n.moduleSpecifier);
    else if (ts.isCallExpression(n) && (n.expression.kind===ts.SyntaxKind.ImportKeyword || ts.isIdentifier(n.expression)&&n.expression.text==='require')) add(n.arguments[0]);
    else if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument)) add(n.argument.literal);
    ts.forEachChild(n,visit);
  }
  visit(ast);
  let restored=body;
  for (const s of spans.sort((a,b)=>b.start-a.start)) restored=restored.slice(0,s.start)+s.text+restored.slice(s.end);
  const matches=hash(restored)===old.sha256;
  results.push({oldPath,newPath:f.path,imports:spans.length,byteIdentical:hash(body)===old.sha256,reverseImportRewriteMatchesBefore:matches});
  if (!matches && old.sha256!==hash(body)) {
    const out=ev+'independent-review/reconstructed/'+oldPath;
    fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,restored);
  }
}
const previous = new Map(after.files.map(f=>[f.path,f.sha256]));
const summary = {
  createdAt:new Date().toISOString(),root,
  finalIdentity:{declared:final.digest,recomputed:hash(JSON.stringify(final.files)),count:final.files.length,invalid},
  moves:{rows:moves.length,uniqueOld:moved.size,uniqueNew:reverse.size,duplicates:moves.filter((x,i)=>moves.findIndex(y=>x.from===y.from&&x.to===y.to)!==i)},
  afterToFinal:{common:final.files.filter(f=>previous.has(f.path)).length,changed:final.files.filter(f=>previous.has(f.path)&&previous.get(f.path)!==f.sha256),added:final.files.filter(f=>!previous.has(f.path)).map(f=>f.path),excluded:after.files.filter(f=>!newMap.has(f.path)).map(f=>f.path)},
  inverseImportAudit:{method:'Resolve current AST relative module references, map targets and owners back to old paths, reconstruct old specifiers, compare entire reconstructed bytes to before SHA256. A hash match proves both content and target mapping against the recorded hash; mismatches require further investigation and are not automatically defects.',files:results.length,relativeReferences:imports,unresolved,exactBeforeHashMatches:results.filter(r=>r.reverseImportRewriteMatchesBefore).length,notProven:results.filter(r=>!r.reverseImportRewriteMatchesBefore),results},
};
fs.writeFileSync(ev+'independent-review/audit.json',JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({...summary,inverseImportAudit:{...summary.inverseImportAudit,results:undefined}},null,2));
