import fs from 'node:fs';
import path from 'node:path';
import ts from '../../../.local/linux-test-tools/node_modules/typescript/lib/typescript.js';
const evidence='evidence/2026-09-11-source-cleanup/contracts-followup';
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>['node_modules','dist','public'].includes(e.name)?[]:e.isDirectory()?walk(`${dir}/${e.name}`):/\.(ts|tsx)$/.test(e.name)?[`${dir}/${e.name}`]:[]);}
for(const file of [...walk('src'),...walk('tests')]){
 const old=fs.readFileSync(file,'utf8');let next=old.replace(/(import\(["'][^"']*\/contracts\/)validation\.js(["']\)\.ValidationIssue)/g,'$1validation/common.js$2');
 if(next.includes('contracts/rework.ts')){
  next=next.replace(/contracts\/rework\.ts/g, /disposition|autonomous-rework-fixture/.test(file)?'contracts/rework/issues.ts':'contracts/rework/proposal.ts');
  if(file.endsWith('rework-plan-compiler.ts'))next=next.replace('contracts/rework/proposal.ts 的 reworkIssueUnaddressed','contracts/rework/issues.ts 的 reworkIssueUnaddressed');
  if(file.endsWith('rework-drive.ts'))next=next.replace('义务承担者（contracts/rework/proposal.ts','义务承担者（contracts/rework/issues.ts');
 }
 if(file.startsWith('src/contracts/validation/')||file.startsWith('src/contracts/rework/')){
  const tree=ts.createSourceFile(file,next,ts.ScriptTarget.Latest,true),imports=tree.statements.filter(ts.isImportDeclaration);
  const grouped=new Map();for(const i of imports){const key=`${!!i.importClause.isTypeOnly}|${i.moduleSpecifier.text}`;const names=grouped.get(key)??[];names.push(...i.importClause.namedBindings.elements.map(n=>n.getText(tree)));grouped.set(key,names);}
  if(imports.length){const body=[...grouped].map(([key,names])=>{const[type,from]=key.split('|');return `import ${type==='true'?'type ':''}{ ${[...new Set(names)].join(', ')} } from '${from}';`;}).join('\n');next=next.slice(0,imports[0].getStart(tree))+body+next.slice(imports.at(-1).end);}
  next=next.replace(/\n(?:[ \t]*\r?\n){2,}/g,'\n\n').replace(/^\/\/ (?:dispatch \/ run command|Plan draft \/ ApplyPlanRevision).*\r?\n/gm,'');
 }
 if(old!==next){const history=`${evidence}/history/${file}.txt`;if(!fs.existsSync(history)){fs.mkdirSync(path.dirname(history),{recursive:true});fs.writeFileSync(history,old,{flag:'wx'});}fs.writeFileSync(`${file}.cleanup-tmp`,next,{flag:'wx'});fs.renameSync(`${file}.cleanup-tmp`,file);}
}
