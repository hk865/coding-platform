import fs from 'node:fs';import path from 'node:path';
import ts from '../../.local/linux-test-tools/node_modules/typescript/lib/typescript.js';
const root='evidence/2026-09-11-source-cleanup';
const files=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>['node_modules','dist','public'].includes(e.name)?[]:e.isDirectory()?files(d+'/'+e.name):/\.(ts|mjs)$/.test(e.name)?[d+'/'+e.name]:[]);
const support=[...files('src/contracts/fixtures'),...files('src/contracts/testing')];
if(support.length!==8)throw Error('Unexpected support scope');
const moves=Object.fromEntries(support.map(f=>[f,f.replace('src/contracts/','src/')]));
function put(f,s){const h=root+'/history/'+f+'.txt';if(fs.existsSync(f)&&!fs.existsSync(h)){fs.mkdirSync(path.dirname(h),{recursive:true});fs.copyFileSync(f,h);}fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f+'.cleanup-tmp',s,{flag:'wx'});fs.renameSync(f+'.cleanup-tmp',f);}
const consumers=[];
for(const f of [...files('src'),...files('tests'),...files('scripts')]){let s=fs.readFileSync(f,'utf8');const dest=moves[f]??f,a=ts.createSourceFile(f,s,ts.ScriptTarget.Latest,true),edits=[];
 function visit(n){if(ts.isStringLiteral(n)&&n.text.startsWith('.')&&(ts.isImportDeclaration(n.parent)||ts.isExportDeclaration(n.parent)||ts.isLiteralTypeNode(n.parent)||ts.isCallExpression(n.parent))){const target=path.posix.normalize(path.posix.join(path.posix.dirname(f),n.text)).replace(/\.js$/,'.ts');if(moves[f]||moves[target]){let spec=path.posix.relative(path.posix.dirname(dest),moves[target]??target).replace(/\.ts$/,'.js');if(!spec.startsWith('.'))spec='./'+spec;edits.push({start:n.getStart(a)+1,end:n.end-1,spec});consumers.push({from:f,to:target});}}ts.forEachChild(n,visit);}visit(a);
 for(const e of edits.reverse())s=s.slice(0,e.start)+e.spec+s.slice(e.end);
 if(f==='scripts/module-map.mjs'||f==='tests/contracts/module-ownership.test.ts')s=s.replaceAll('src/contracts/fixtures/','src/fixtures/').replaceAll('src/contracts/testing/','src/testing/');
 if(s!==fs.readFileSync(f,'utf8')||dest!==f)put(dest,s);
}
// Original paths are copied before the separate, explicit deletion patch.
for(const f of support){const h=root+'/history/'+f+'.txt';if(!fs.existsSync(h)){fs.mkdirSync(path.dirname(h),{recursive:true});fs.copyFileSync(f,h);}}
fs.writeFileSync(root+'/host-support-migration.json',JSON.stringify({moves,consumers,nonModuleOwners:['Fixtures','TestDoubles'],consumerAllowlistUnchanged:true},null,2));
fs.writeFileSync(root+'/remove-host-support.patch','*** Begin Patch\n'+support.map(f=>'*** Delete File: '+f).join('\n')+'\n*** End Patch');
console.log(JSON.stringify({moves}));
