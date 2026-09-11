const fs=require('node:fs'),path=require('node:path');
const ts=require('../../.local/linux-test-tools/node_modules/typescript/lib/typescript.js');
const {parse,rel}=require('./control-contracts-migrate.cjs');
const mapping=JSON.parse(fs.readFileSync('evidence/2026-09-09-architecture-rebuild/control-contracts-mapping.json','utf8'));
const byName=new Map(mapping.map(m=>[m.symbol,m]));
const parentControl=new Set(['architecture-reconciler.ts','architecture-delta.ts','runtime-dispatch.ts','planned-task-dispatch.ts','exploration-context-drive.ts','leased-worker-runtime.ts','initial-plan-compiler.ts','initial-plan-proposal.ts','initial-plan-source.ts','operator-plan-compiler.ts','plan-compiler.ts']);
function owned(file){if(file.startsWith('src/control/'))return !parentControl.has(path.basename(file));if(file.startsWith('src/contracts/fixtures/')||file.startsWith('src/contracts/testing/'))return true;if(file.startsWith('tests/'))return !file.startsWith('tests/integration/')&&!file.startsWith('tests/verification/')&&!file.startsWith('tests/app/')&&!file.includes('initial-plan')&&!file.includes('planning-');return false;}
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(d=>d.isDirectory()?walk(dir+'/'+d.name):d.name.endsWith('.ts')?[dir+'/'+d.name]:[]);}
const reports=[];
for(const file of [...walk('src'),...walk('tests')]){
 if(file.startsWith('src/ui/'))continue;
 const sf=parse(file),edits=[];
 for(const stmt of sf.statements){if(!ts.isImportDeclaration(stmt)||!stmt.importClause?.namedBindings||!ts.isNamedImports(stmt.importClause.namedBindings))continue;
 const module=stmt.moduleSpecifier.text;if(!module.includes('contracts')&&!file.startsWith('src/contracts/'))continue;
 const groups=new Map();
 for(const e of stmt.importClause.namedBindings.elements){const imported=e.propertyName?.text??e.name.text;let m=byName.get(imported);
  if(m && ((file.startsWith('tests/')||file.startsWith('src/contracts/fixtures/')||file.startsWith('src/contracts/testing/'))&&m.dest.startsWith('src/contracts/commands/')))m=null;
  // Fixture functions deliberately wrap/import the owner. Keep their own default helpers.
  if(m&&file===m.source)m=null;
  const dst=m?rel(file,m.dest):module;const specs=groups.get(dst)??[];const sourceName=m?.newSymbol??imported;
  specs.push((e.isTypeOnly?'type ':'')+sourceName+(sourceName!==e.name.text?' as '+e.name.text:''));groups.set(dst,specs);
 }
 const next=[...groups].map(([dst,specs])=>`import ${stmt.importClause.isTypeOnly?'type ':''}{ ${specs.join(', ')} } from ${JSON.stringify(dst)};`).join('\n');
 if(groups.size!==1 || !groups.has(module))edits.push([stmt.getStart(sf),stmt.end,next]);
 }
 if(!edits.length)continue;
 reports.push({file,owned:owned(file),imports:edits.map(e=>e[2])});
 if(process.argv[2]==='apply'&&owned(file)){let text=sf.text;for(const[a,b,v]of edits.reverse())text=text.slice(0,a)+v+text.slice(b);fs.writeFileSync(file,text);}
}
fs.writeFileSync('evidence/2026-09-09-architecture-rebuild/control-contracts-consumers.json',JSON.stringify(reports,null,2)+'\n');
console.log(JSON.stringify({updated:reports.filter(r=>r.owned).length,shared:reports.filter(r=>!r.owned)},null,2));
