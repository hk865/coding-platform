const fs=require('node:fs');
const ts=require('../../.local/linux-test-tools/node_modules/typescript/lib/typescript.js');
const {parse,names}=require('./control-contracts-migrate.cjs');
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(d=>d.isDirectory()?walk(dir+'/'+d.name):d.name.endsWith('.ts')?[dir+'/'+d.name]:[]);}
for(const file of [...walk('src/contracts/fixtures'),...walk('src/contracts/commands'),...walk('src/control/records'),...walk('src/control/policies')]){
 const sf=parse(file),seen=new Set(sf.statements.flatMap(names)),edits=[];
 for(const stmt of sf.statements){if(!ts.isImportDeclaration(stmt)||!stmt.importClause?.namedBindings||!ts.isNamedImports(stmt.importClause.namedBindings))continue;
  const el=stmt.importClause.namedBindings.elements,keep=el.filter(e=>{const n=e.name.text;if(seen.has(n))return false;seen.add(n);return true;});
  if(keep.length!==el.length)edits.push([stmt.getStart(sf),stmt.end,keep.length?stmt.getText(sf).replace(/\{[\s\S]*?\}/,'{ '+keep.map(e=>e.getText(sf)).join(', ')+' }'):'']);
 }
 if(edits.length){let text=sf.text;for(const[a,b,v]of edits.reverse())text=text.slice(0,a)+v+text.slice(b);fs.writeFileSync(file,text);}
}
