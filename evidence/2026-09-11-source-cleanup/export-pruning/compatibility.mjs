import fs from 'node:fs';
import ts from '../../../.local/linux-test-tools/node_modules/typescript/lib/typescript.js';
const root='evidence/2026-09-11-source-cleanup/export-pruning';
const baseline=JSON.parse(fs.readFileSync(`${root}/baseline.json`,'utf8'));
const plan=JSON.parse(fs.readFileSync(`${root}/decisions.json`,'utf8'));
const decisions=new Map(plan.decisions.map(d=>[`${d.file}#${d.name}`,d]));
const printer=ts.createPrinter({removeComments:true,newLine:ts.NewLineKind.LineFeed});
const cache=new Map();
function read(file){if(!cache.has(file))cache.set(file,ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true));return cache.get(file);}
const name=s=>s.name?.text??s.declarationList?.declarations[0].name.getText();
const canonical=(s,t)=>printer.printNode(ts.EmitHint.Unspecified,s,t).replace(/^export /,'');
const compared=[],removed=[],differences=[];
for(const file of baseline.roots.product.files.filter(f=>f.path.startsWith('src/contracts/')&&f.path.endsWith('.ts')).map(f=>f.path)){
 const old=`${root}/history/${file}.txt`,tree=read(fs.existsSync(old)?old:file);
 for(const s of tree.statements){if(ts.isImportDeclaration(s)||ts.isExportDeclaration(s))continue;
  const id=`${file}#${name(s)}`,decision=decisions.get(id);
  if(decision?.action==='delete'){removed.push(id);continue;}
  const dest=decision?.destination??file,current=read(dest),found=current.statements.find(n=>!ts.isImportDeclaration(n)&&name(n)===name(s));
  compared.push({id,dest});if(!found||canonical(s,tree)!==canonical(found,current))differences.push({id,dest,before:canonical(s,tree),after:found?canonical(found,current):null});
 }
}
const report={compared:compared.length,removed,moved:compared.filter(x=>x.id.split('#')[0]!==x.dest),differences};
fs.writeFileSync(`${root}/compatibility.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({...report,differences:differences.map(d=>d.id)}));if(differences.length)process.exitCode=1;
