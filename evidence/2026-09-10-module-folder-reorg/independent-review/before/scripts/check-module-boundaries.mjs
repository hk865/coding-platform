import fs from 'node:fs';
import path from 'node:path';
import { owner, modules, allowedModuleDependencies } from './module-map.mjs';
const ts = await import('typescript').then(m=>m.default).catch(async()=> (await import('../.local/linux-test-tools/node_modules/typescript/lib/typescript.js')).default);

function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).filter(e=>!['node_modules','dist','.vite'].includes(e.name)).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name).replaceAll('\\','/')]);}
const inventory=walk('src').filter(f=>/\.(ts|tsx|js|py)$/.test(f));
const files=inventory.filter(f=>/\.(ts|tsx|js)$/.test(f));
const fileSet=new Set(files), edges=[], issues=[];
const fixtureConsumers=fixtureConsumersInit();
for(const file of inventory){if(owner(file)==='Unmapped')issues.push({file,reason:'Published source file has no owner'});}
for(const file of files){
 const module=owner(file);
 if(['Fixtures','TestDoubles'].includes(module))continue;
 const source=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
 function edge(node,spec,typeOnly){
  if(!spec.startsWith('.'))return;
  const resolved=path.join(path.dirname(file),spec).replaceAll('\\','/');
  const dest=[resolved.replace(/\.js$/,'.ts'),resolved.replace(/\.js$/,'.tsx'),resolved+'/index.ts'].find(p=>fileSet.has(p));
  if(!dest)return;
  const to=owner(dest); if(module===to)return;
  edges.push({file,line:ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1,dest,from:module,to,typeOnly});
  if(!typeOnly && modules.includes(module) && modules.includes(to) && !allowedModuleDependencies[module]?.includes(to))issues.push({file,dest,reason:'Undeclared Module implementation dependency: '+module+' -> '+to});
  if(module==='Contracts' && to!=='Contracts')issues.push({file,dest,reason:'Contract depends on implementation/test material'});
  if(['Fixtures','TestDoubles'].includes(to) && !fixtureConsumers.has(file))issues.push({file,dest,reason:'Production logic consumes a test fixture/double'});
  if(to==='Host' && module!=='UI')issues.push({file,dest,reason:'Module depends on composition host'});
 }
 function visit(node){
  if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)){
   const c=node.importClause,allTypes=c?.isTypeOnly||(c?.namedBindings&&ts.isNamedImports(c.namedBindings)&&c.namedBindings.elements.every(e=>e.isTypeOnly));
   edge(node,node.moduleSpecifier.text,Boolean(allTypes));
  }else if(ts.isExportDeclaration(node)&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier))edge(node,node.moduleSpecifier.text,node.isTypeOnly);
  else if(ts.isImportTypeNode(node)&&ts.isLiteralTypeNode(node.argument)&&ts.isStringLiteral(node.argument.literal))edge(node,node.argument.literal.text,true);
  ts.forEachChild(node,visit);
 }
 visit(ast);
}
const totals={};for(const e of edges.filter(e=>!e.typeOnly&&modules.includes(e.from)&&modules.includes(e.to)))totals[e.from+' -> '+e.to]=(totals[e.from+' -> '+e.to]??0)+1;
const visited=new Set(),active=new Set();
function checkDag(module,trail=[]){
 if(active.has(module)){issues.push({reason:'Declared Module dependency cycle',path:[...trail,module]});return;}
 if(visited.has(module))return;active.add(module);
 for(const next of allowedModuleDependencies[module]??[])checkDag(next,[...trail,module]);
 active.delete(module);visited.add(module);
}
modules.forEach(m=>checkDag(m));
const report={sourceFiles:files.length,inventoryFiles:inventory.length,coverage:{parsedExtensions:['.ts','.tsx','.js'],ownerOnlyExtensions:['.py'],excluded:['dependencies','generated dist','.vite'],notASandboxVerification:true},owners:Object.fromEntries([...new Set(inventory.map(owner))].sort().map(o=>[o,inventory.filter(f=>owner(f)===o).length])),moduleEdges:totals,issues,edges};
const output=process.argv.find(a=>a.startsWith('--output='))?.slice(9);
if(output)fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({sourceFiles:report.sourceFiles,inventoryFiles:report.inventoryFiles,coverage:report.coverage,owners:report.owners,moduleEdges:totals,issues},null,2));
if(issues.length)process.exitCode=1;

// Explicit test adapters and composition defaults. These preserve separate fake
// capabilities; any additional production consumer requires review here.
function fixtureConsumersInit(){return new Set([
 'src/harness/in-memory-harness.ts','src/harness/persistent-harness.ts','src/app/service.ts',
 'src/runtime/fake-runtime-adapter.ts','src/data/workspace-reader-adapter.ts','src/verification/code-graph-port.ts',
]);}
