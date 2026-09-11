import fs from 'node:fs';
import ts from '../../../.local/linux-test-tools/node_modules/typescript/lib/typescript.js';
import {owner} from '../../../scripts/module-map.mjs';
const root='evidence/2026-09-11-source-cleanup/export-pruning';
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>['node_modules','dist','public','.git','.local'].includes(e.name)?[]:e.isDirectory()?walk(`${dir}/${e.name}`):/\.(ts|tsx|mjs|js)$/.test(e.name)?[`${dir}/${e.name}`]:[]);}
const files=[...walk('src'),...walk('tests'),...walk('scripts')],refs=new Map(),decls=[];
for(const file of files){const body=fs.readFileSync(file,'utf8'),tree=ts.createSourceFile(file,body,ts.ScriptTarget.Latest,true);
 function visit(n){if(ts.isIdentifier(n)){const hits=refs.get(n.text)??new Map();hits.set(file,(hits.get(file)??0)+1);refs.set(n.text,hits);}ts.forEachChild(n,visit);}visit(tree);
 if(!file.startsWith('src/contracts/'))continue;
 for(const s of tree.statements){if(!s.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword))continue;
  const name=s.name?.text??s.declarationList?.declarations[0].name.getText(tree);if(!name)continue;
  decls.push({file,name,kind:ts.SyntaxKind[s.kind],line:tree.getLineAndCharacterOfPosition(s.getStart(tree)).line+1});
 }
}
const rows=decls.map(d=>({...d,local:refs.get(d.name)?.get(d.file)??0,consumers:[...(refs.get(d.name)??[])].filter(([file])=>file!==d.file).map(([file,count])=>({file,count,owner:owner(file)}))}));
fs.writeFileSync(`${root}/${process.argv[2]??'consumers-before.json'}`,JSON.stringify(rows,null,2));
console.log(JSON.stringify({exports:rows.length,zero:rows.filter(r=>!r.consumers.length).map(({file,name,kind,local})=>({file,name,kind,local})),singleOwner:rows.filter(r=>r.consumers.length&&r.consumers.every(c=>!c.file.startsWith('src/contracts/'))&&new Set(r.consumers.filter(c=>c.file.startsWith('src/')).map(c=>c.owner)).size===1).filter(r=>/verification|rework|planning|feedback|query|dispatch|context|ports/.test(r.file)).map(({file,name,consumers})=>({file,name,consumers:consumers.map(c=>c.file)}))},null,2));
