import fs from 'node:fs';
import path from 'node:path';
import ts from '../../.local/linux-test-tools/node_modules/typescript/lib/typescript.js';
import {owner} from '../../scripts/module-map.mjs';
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>['node_modules','dist','.vite','public'].includes(e.name)?[]:e.isDirectory()?walk(d+'/'+e.name):[/\.(ts|tsx|mjs)$/.test(e.name)?d+'/'+e.name:null].filter(Boolean));
const files=[...walk('src'),...walk('tests'),...walk('scripts')], rows=[],edges=[];
for(const file of files){const source=fs.readFileSync(file,'utf8'), ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
 const exports=[];function visit(n){
  if(n.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword)){if(n.name)exports.push(n.name.getText(ast));else if(ts.isVariableStatement(n))exports.push(...n.declarationList.declarations.map(d=>d.name.getText(ast)));}
  if(ts.isStringLiteral(n)&&n.text.startsWith('.')&&(ts.isImportDeclaration(n.parent)||ts.isExportDeclaration(n.parent)||ts.isLiteralTypeNode(n.parent)||ts.isCallExpression(n.parent))){const target=path.posix.normalize(path.posix.join(path.posix.dirname(file),n.text)).replace(/\.js$/,'.ts'); edges.push({from:file,to:target});}
  ts.forEachChild(n,visit);
 }visit(ast);rows.push({file,owner:owner(file),lines:source.split('\n').length,exports});}
const report={rows,edges};fs.writeFileSync('evidence/2026-09-11-source-cleanup/'+(process.argv[2]||'inventory-before.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({owners:Object.fromEntries([...new Set(rows.filter(r=>r.file.startsWith('src/')).map(r=>r.owner))].map(o=>{const a=rows.filter(r=>r.owner===o);return [o,{files:a.length,lines:a.reduce((n,r)=>n+r.lines,0),exports:a.reduce((n,r)=>n+r.exports.length,0)}]})),largest:rows.filter(r=>r.file.startsWith('src/')&&!r.file.startsWith('src/ui/')).sort((a,b)=>b.lines-a.lines).slice(0,14).map(({file,lines})=>({file,lines})),support:rows.filter(r=>/^src\/contracts\/(fixtures|testing)\//.test(r.file)).map(r=>({file:r.file,production:edges.filter(e=>e.to===r.file&&e.from.startsWith('src/')&&!/^src\/contracts\/(fixtures|testing)\//.test(e.from)).map(e=>e.from),consumers:edges.filter(e=>e.to===r.file).length}))},null,2));

