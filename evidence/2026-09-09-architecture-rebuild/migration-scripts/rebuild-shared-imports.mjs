import fs from 'node:fs';
import path from 'node:path';
import ts from '../.local/linux-test-tools/node_modules/typescript/lib/typescript.js';
const mapping = JSON.parse(fs.readFileSync('evidence/2026-09-09-architecture-rebuild/control-contracts-mapping.json', 'utf8'));
const root = process.cwd();
function files(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir,e.name)) : [path.join(dir,e.name)]); }
const rootControl = new Set(['architecture-reconciler.ts','architecture-delta.ts','operator-plan-compiler.ts','runtime-dispatch.ts','operator-task-dispatch.ts','planned-task-dispatch.ts','leased-worker-runtime.ts','exploration-context-drive.ts']);
const owned = file => {
 const f = file.replaceAll('\\','/');
 if (f.startsWith('src/control/')) return rootControl.has(path.basename(file));
 if (f.startsWith('src/app/')) return !f.endsWith('/explorations.ts');
 if (f.startsWith('src/context/')) return !f.includes('verification') && !f.includes('exploration-session');
 if (/^src\/(harness|runtime|data|ledger|sqlite-ledger|vault|interaction)\//.test(f)) return !f.includes('exploration-session');
 if (/^tests\/(app|context)\//.test(f)) return !f.includes('exploration');
 if (/^tests\/control\/(architecture|source-architecture|planning-|plan-compiler|initial-plan)/.test(f)) return true;
 if (/^tests\/contract-suite\/(architecture|p1-12-harness)/.test(f)) return true;
 return false;
};
const changed=[];
for (const file of [...files('src'),...files('tests')].filter(f => f.endsWith('.ts') && owned(f))) {
 let source = fs.readFileSync(file,'utf8'); const ast = ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
 const patches=[];
 for (const node of ast.statements) {
  if (!ts.isImportDeclaration(node) || !node.importClause || !ts.isStringLiteral(node.moduleSpecifier) || !node.importClause.namedBindings || !ts.isNamedImports(node.importClause.namedBindings)) continue;
  const from = path.relative(root,path.resolve(path.dirname(file),node.moduleSpecifier.text.replace(/\.js$/,'.ts'))).replaceAll('\\','/');
  const groups = new Map(); let moved=false;
  for (const e of node.importClause.namedBindings.elements) {
   const original = (e.propertyName??e.name).text;
   // Tests retain fixture defaults for command builders; production never does.
   const m = mapping.find(m=>m.source===from && m.symbol===original && !(file.replaceAll('\\','/').startsWith('tests/') && m.dest.includes('/commands/')));
   const dest = m?.dest??from; const symbol=m?.newSymbol??original; if(m)moved=true;
   const spec=(e.isTypeOnly?'type ':'')+symbol+(symbol!==e.name.text?' as '+e.name.text:'');
   if(!groups.has(dest))groups.set(dest,[]);groups.get(dest).push(spec);
  }
  if(!moved)continue;
  const body=[...groups].map(([dest,names])=>{
   let rel=path.relative(path.dirname(file),dest).replaceAll('\\','/').replace(/\.ts$/,'.js');if(!rel.startsWith('.'))rel='./'+rel;
   return `import ${node.importClause.isTypeOnly?'type ':''}{ ${names.join(', ')} } from '${rel}';`;
  }).join('\n');
  patches.push({start:node.getStart(ast),end:node.end,body});
 }
 for(const p of patches.reverse())source=source.slice(0,p.start)+p.body+source.slice(p.end);
 if(patches.length){fs.writeFileSync(file,source);changed.push(file);}
}
console.log(JSON.stringify({changed},null,2));
