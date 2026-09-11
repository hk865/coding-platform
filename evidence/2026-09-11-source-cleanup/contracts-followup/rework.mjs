import fs from 'node:fs';
import path from 'node:path';
import ts from '../../../.local/linux-test-tools/node_modules/typescript/lib/typescript.js';
const evidence='evidence/2026-09-11-source-cleanup/contracts-followup';
const old=['src/contracts/rework.ts','src/contracts/rework-drive.ts','src/contracts/rework-acceptance.ts','src/contracts/rework-disposition.ts'];
const inputs=new Map(old.map(f=>[f,fs.readFileSync(f,'utf8')]));
const definitions=[]; const imported=[];
for(const [file,body]of inputs){const tree=ts.createSourceFile(file,body,ts.ScriptTarget.Latest,true);
 for(const s of tree.statements){if(ts.isImportDeclaration(s)){for(const n of s.importClause.namedBindings.elements) imported.push({name:n.name.text,text:n.getText(tree),type:s.importClause.isTypeOnly,from:path.posix.normalize(path.posix.join(path.posix.dirname(file),s.moduleSpecifier.text))});continue;}
 const name=s.name?.text??s.declarationList?.declarations[0].name.getText(tree);if(!name)throw Error('Unclassified');
 if(name==='ReworkIssueMaterials')continue; // zero consumers; exact synonym of OpenIssuesViewV1
 const line=tree.getLineAndCharacterOfPosition(s.getStart(tree)).line+1;
 const group=file.endsWith('rework.ts')?((line>=186&&line<393)?'proposal':'issues'):file.endsWith('rework-drive.ts')?(name==='ReworkIssueReadPort'?'issues':'drive'):file.endsWith('rework-acceptance.ts')?'acceptance':'issues';
 const refs=new Set();function visit(n){if(ts.isIdentifier(n))refs.add(n.text);ts.forEachChild(n,visit);}visit(s);
 definitions.push({file,name,group,refs,body:s.getFullText(tree).trim(),type:ts.isTypeAliasDeclaration(s)||ts.isInterfaceDeclaration(s)});
 }}
const byName=new Map(definitions.map(d=>[d.name,d]));const proposed=new Map();
const target=d=>`src/contracts/rework/${d.group}.js`;
for(const group of ['issues','proposal','drive','acceptance']){
 const members=definitions.filter(d=>d.group===group),refs=new Set(members.flatMap(d=>[...d.refs]));
 const dependencies=definitions.filter(d=>d.group!==group&&refs.has(d.name)).map(d=>`import ${d.type?'type ':''}{ ${d.name} } from './${d.group}.js';`);
 const imports=imported.filter(i=>refs.has(i.name)&&!byName.has(i.name)).map(i=>`import ${i.type?'type ':''}{ ${i.text} } from '${path.posix.relative('src/contracts/rework',i.from)}';`);
 const titles={issues:'Verification supplies failure provenance; Control projects current obligation disposition. Reads do not accept proposals.',proposal:'PlanCompiler proposals reuse PlanRevision and the existing Control admission chain. Old failures and obligations remain.',drive:'Dispatch receives captured issue materials from the composition root; it never holds a Verification callback.',acceptance:'Control admission receipts and boundary explanations; no additional state authority.'};
 const body=members.map(d=>d.body.replace(/^\/\/.*(?:RW-\d+|RC-\d+).*\r?\n/gm,'').replace(/^\/\/ [-]+.*\r?\n/gm,'').replace(/import\((['"])\.\//g,'import($1../')).join('\n\n');
 proposed.set(`src/contracts/rework/${group}.ts`,`/** ${titles[group]} */\n${[...new Set([...imports,...dependencies])].join('\n')}\n\n${body}\n`);
}
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>['node_modules','dist','public','.local','.git'].includes(e.name)?[]:e.isDirectory()?walk(`${dir}/${e.name}`):/\.(ts|tsx|mjs)$/.test(e.name)?[`${dir}/${e.name}`]:[]);}
const consumers=[];
for(const file of [...walk('src'),...walk('tests'),...walk('scripts')]){
 if(old.includes(file))continue;
 const body=fs.readFileSync(file,'utf8'),tree=ts.createSourceFile(file,body,ts.ScriptTarget.Latest,true),edits=[];
 const isOld=specifier=>old.includes(path.posix.normalize(path.posix.join(path.posix.dirname(file),specifier)).replace(/\.js$/,'.ts'));
 const relative=d=>{let rel=path.posix.relative(path.posix.dirname(file),target(d));return rel.startsWith('.')?rel:`./${rel}`;};
 function visit(n){
  if(ts.isImportDeclaration(n)&&ts.isStringLiteral(n.moduleSpecifier)&&isOld(n.moduleSpecifier.text)){
   if(!n.importClause?.namedBindings||!ts.isNamedImports(n.importClause.namedBindings))throw Error(`Unsupported import ${file}`);
   const buckets=new Map();for(const e of n.importClause.namedBindings.elements){const d=byName.get(e.propertyName?.text??e.name.text);if(!d)throw Error(`Unexpected consumer ${e.getText(tree)}`);const dest=relative(d),names=buckets.get(dest)??[];names.push(e.getText(tree));buckets.set(dest,names);}
   edits.push({start:n.getStart(tree),end:n.end,text:[...buckets].map(([dest,names])=>`import ${n.importClause.isTypeOnly?'type ':''}{ ${names.join(', ')} } from '${dest}';`).join('\n')});return;
  }
  if(ts.isImportTypeNode(n)&&ts.isLiteralTypeNode(n.argument)&&ts.isStringLiteral(n.argument.literal)&&isOld(n.argument.literal.text)){
   const d=byName.get(n.qualifier?.getText(tree));if(!d)throw Error(`Unsupported import type ${file}`);
   edits.push({start:n.argument.literal.getStart(tree),end:n.argument.literal.end,text:`'${relative(d)}'`});return;
  }ts.forEachChild(n,visit);
 }visit(tree);
 if(edits.length){let next=body;for(const e of edits.sort((a,b)=>b.start-a.start))next=next.slice(0,e.start)+e.text+next.slice(e.end);proposed.set(file,next);consumers.push(file);}
}
fs.writeFileSync(`${evidence}/rework-map.json`,JSON.stringify({declarations:definitions.map(({name,group,file})=>({name,group,file})),consumers,removedAlias:'ReworkIssueMaterials'},null,2));
console.log(JSON.stringify({files:[...proposed.keys()],consumers:consumers.length}));
if(process.argv.includes('--apply')){
 for(const [file,body]of inputs)if(fs.readFileSync(file,'utf8')!==body)throw Error(`Concurrent change ${file}`);
 for(const file of [...old,...proposed.keys()])if(fs.existsSync(file)){const dest=`${evidence}/history/${file}.txt`;if(!fs.existsSync(dest)){fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,fs.readFileSync(file),{flag:'wx'});}}
 for(const[file,body]of proposed){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(`${file}.cleanup-tmp`,body,{flag:'wx'});fs.renameSync(`${file}.cleanup-tmp`,file);}
 for(const file of old)fs.unlinkSync(file);
}
