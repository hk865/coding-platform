import fs from 'node:fs';
import path from 'node:path';
import ts from '../../../.local/linux-test-tools/node_modules/typescript/lib/typescript.js';
const root='evidence/2026-09-11-source-cleanup/contracts-followup';
const validation=JSON.parse(fs.readFileSync(`${root}/validation-map.json`,'utf8'));
const rework=JSON.parse(fs.readFileSync(`${root}/rework-map.json`,'utf8'));
const baseline=JSON.parse(fs.readFileSync(`${root}/baseline.json`,'utf8'));
const moved=new Map(validation.map(d=>[`src/contracts/validation.ts#${d.name}`,`src/contracts/validation/${d.group}.ts`]));
for(const d of rework.declarations)moved.set(`${d.file}#${d.name}`,`src/contracts/rework/${d.group}.ts`);
moved.set('src/contracts/rework-drive.ts#ReworkIssueReadPort','src/harness/rework-composition.ts');
const cache=new Map();function read(file){if(!cache.has(file)){const body=fs.readFileSync(file,'utf8');cache.set(file,ts.createSourceFile(file,body,ts.ScriptTarget.Latest,true));}return cache.get(file);}
const name=s=>s.name?.text??s.declarationList?.declarations[0].name.getText();
const printer=ts.createPrinter({removeComments:true,newLine:ts.NewLineKind.LineFeed});
function canonical(s,tree){return printer.printNode(ts.EmitHint.Unspecified,s,tree).replace(/^export /,'').replace(/import\(["'][^"']+["']\)\.(\w+)/g,'import("resolved-protocol").$1');}
const checked=[],differences=[],removed=[];
for(const f of baseline.roots.product.files.filter(f=>f.path.startsWith('src/contracts/')&&f.path.endsWith('.ts'))){
 const old=`${root}/history/${f.path}.txt`,tree=read(fs.existsSync(old)?old:f.path);
 for(const s of tree.statements){if(ts.isImportDeclaration(s)||ts.isExportDeclaration(s))continue;
  const key=`${f.path}#${name(s)}`;if(key==='src/contracts/rework-disposition.ts#ReworkIssueMaterials'){removed.push(key);continue;}
  const dest=moved.get(key)??f.path,current=read(dest),found=current.statements.find(n=>!ts.isImportDeclaration(n)&&name(n)===name(s));
  if(!found||canonical(s,tree)!==canonical(found,current))differences.push({key,dest,before:canonical(s,tree),after:found?canonical(found,current):null});
  checked.push({key,dest});
 }
}
const report={checked:checked.length,moved:checked.filter(c=>c.dest!==c.key.split('#')[0]).length,removed,differences};
fs.writeFileSync(`${root}/compatibility.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({...report,differences:differences.map(d=>d.key)}));
if(differences.length)process.exitCode=1;
