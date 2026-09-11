import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from '../../../.local/linux-test-tools/node_modules/typescript/lib/typescript.js';
const root='evidence/2026-09-11-source-cleanup/export-pruning';
const baseline=JSON.parse(fs.readFileSync(`${root}/baseline.json`,'utf8'));
const baselineHashes=new Map(baseline.roots.product.files.map(f=>[f.path,f.sha256]));
const rows=JSON.parse(fs.readFileSync(`${root}/consumers-before.json`,'utf8'));
const scoped=new Set(['context-continuation-port','context-continuity','dispatch','execution-feedback','goal-change','initial-planning','material-access','plan','planning','query-job','reviewer-context','reviewer-work','runtime-context-materials','verification-context','verification-round','verification-service','verification','rework/acceptance','rework/proposal','validation/dispatch','validation/material-access','validation/plan'].map(f=>`src/contracts/${f}.ts`));
const remove=new Set(['GoalChangePort','PublicSnapshotPort','RuntimeEvent','GateTask','buildCreateReviewWorkCommand','buildBindReviewOutputCommand','buildValidatedReviewResultCommand','executionNoteBody','materialBasisKey']);
const moves=new Map([
 ['VerificationPlanRejectionCode','src/control/verification-engine/verification-plan-compiler.ts'],
 ['VerificationPlanCompileInput','src/control/verification-engine/verification-plan-compiler.ts'],
 ['VerificationPlanCompileResult','src/control/verification-engine/verification-plan-compiler.ts'],
 ['CandidatePatchCheckPort','src/control/verification-engine/candidate-patch-check.ts'],
 ['CoordinationSourcePort','src/data/context-compiler/query-execution-context.ts'],
]);
const decisions=rows.filter(r=>remove.has(r.name)||moves.has(r.name)||scoped.has(r.file)&&!r.consumers.length&&r.local>1).map(r=>({...r,action:remove.has(r.name)?'delete':moves.has(r.name)?'move':'local',destination:moves.get(r.name)??null}));
for(const d of decisions.filter(d=>d.action==='delete'))if(d.consumers.length||d.local!==1)throw Error(`Deletion has consumer: ${d.name}`);
const names=new Map(decisions.map(d=>[d.name,d]));
const bodies=new Map(),originals=new Map(),movedBodies=new Map(),movedImports=new Map();
function read(file){if(!originals.has(file))originals.set(file,fs.readFileSync(file,'utf8'));return bodies.get(file)??originals.get(file);}
function parse(file,body){return ts.createSourceFile(file,body,ts.ScriptTarget.Latest,true);}
function relative(from,to){let r=path.posix.relative(path.posix.dirname(from),to.replace(/\.ts$/,'.js'));return r.startsWith('.')?r:`./${r}`;}
const nameOf=s=>s.name?.text??s.declarationList?.declarations[0].name.getText();
function identifiers(s){const found=new Set();function visit(n){if(ts.isIdentifier(n))found.add(n.text);ts.forEachChild(n,visit);}visit(s);return found;}
for(const file of new Set(decisions.map(d=>d.file))){const body=read(file),tree=parse(file,body),edits=[];
 for(const s of tree.statements){const d=names.get(nameOf(s));if(!d||d.file!==file)continue;
  if(d.action==='local'){const modifier=s.modifiers.find(m=>m.kind===ts.SyntaxKind.ExportKeyword);edits.push({start:modifier.getStart(tree),end:modifier.end+1,text:''});continue;}
  if(d.action==='move'){
   const members=movedBodies.get(d.destination)??[];members.push(s.getFullText(tree).trim());movedBodies.set(d.destination,members);
   const deps=identifiers(s),imports=movedImports.get(d.destination)??[];
   for(const i of tree.statements.filter(ts.isImportDeclaration))for(const e of i.importClause?.namedBindings?.elements??[]){if(deps.has(e.name.text))imports.push(`import type { ${e.getText(tree)} } from '${relative(d.destination,path.posix.normalize(path.posix.join(path.posix.dirname(file),i.moduleSpecifier.text)))}';`);}
   for(const other of tree.statements.filter(n=>!ts.isImportDeclaration(n))){const n=nameOf(other);if(n&&n!==d.name&&deps.has(n)&&!moves.has(n))imports.push(`import type { ${n} } from '${relative(d.destination,file)}';`);}
   movedImports.set(d.destination,imports);
  }
  edits.push({start:s.getFullStart(),end:s.end,text:''});
 }
 let next=body;for(const e of edits.sort((a,b)=>b.start-a.start))next=next.slice(0,e.start)+e.text+next.slice(e.end);bodies.set(file,next);
}
for(const [file,members]of movedBodies){const body=read(file),tree=parse(file,body),last=tree.statements.filter(ts.isImportDeclaration).at(-1);if(!last)throw Error('Expected import block');
 bodies.set(file,body.slice(0,last.end)+'\n'+[...new Set(movedImports.get(file))].join('\n')+'\n\n'+members.join('\n\n')+'\n'+body.slice(last.end));}
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>['node_modules','dist','public','.git','.local'].includes(e.name)?[]:e.isDirectory()?walk(`${dir}/${e.name}`):/\.(ts|tsx|mjs)$/.test(e.name)?[`${dir}/${e.name}`]:[]);}
for(const file of [...walk('src'),...walk('tests'),...walk('scripts')]){const body=read(file),tree=parse(file,body),edits=[];
 for(const s of tree.statements){if(!ts.isImportDeclaration(s)||!s.importClause?.namedBindings||!ts.isNamedImports(s.importClause.namedBindings))continue;
  const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(file),s.moduleSpecifier.text)).replace(/\.js$/,'.ts');
  if(!s.importClause.namedBindings.elements.some(e=>names.get(e.propertyName?.text??e.name.text)?.file===resolved&&moves.has(e.propertyName?.text??e.name.text)))continue;
  const groups=new Map();for(const e of s.importClause.namedBindings.elements){const n=e.propertyName?.text??e.name.text,d=names.get(n);let dest=s.moduleSpecifier.text;
   if(d?.file===resolved&&d.action==='move'){if(d.destination===file)continue;dest=relative(file,d.destination);}
   const parts=groups.get(dest)??[];parts.push(e.getText(tree));groups.set(dest,parts);
  }
  edits.push({start:s.getStart(tree),end:s.end,text:[...groups].map(([dest,parts])=>`import ${s.importClause.isTypeOnly?'type ':''}{ ${parts.join(', ')} } from '${dest}';`).join('\n')});
 }
 let next=body;for(const e of edits.reverse())next=next.slice(0,e.start)+e.text+next.slice(e.end);if(next!==body)bodies.set(file,next);
}
// These are unused forwarding exports, not independent protocols.
const ports='src/contracts/ports.ts';bodies.set(ports,read(ports).replace(/^export type \{ (?:ArtifactPort, TaskContextPort|DispatchIntentV1) \};\r?\n/gm,''));
// Remove imports that existed only for deleted declarations/forwarders. Keep
// side-effect imports and every named identifier still referenced by a body.
for(const [file,body]of bodies){const tree=parse(file,body),used=new Set(tree.statements.filter(s=>!ts.isImportDeclaration(s)).flatMap(s=>[...identifiers(s)])),edits=[];
 for(const s of tree.statements.filter(ts.isImportDeclaration)){if(!s.importClause?.namedBindings||!ts.isNamedImports(s.importClause.namedBindings)||s.importClause.name)continue;
  const parts=s.importClause.namedBindings.elements.filter(e=>used.has(e.name.text));if(parts.length===s.importClause.namedBindings.elements.length)continue;
  edits.push({start:s.getStart(tree),end:s.end,text:parts.length?`import ${s.importClause.isTypeOnly?'type ':''}{ ${parts.map(e=>e.getText(tree)).join(', ')} } from ${s.moduleSpecifier.getText(tree)};`:''});
 }let next=body;for(const e of edits.reverse())next=next.slice(0,e.start)+e.text+next.slice(e.end);bodies.set(file,next.replace(/\n(?:[ \t]*\r?\n){2,}/g,'\n\n'));
}
const deletedFile='src/contracts/commands/reviewer-work.ts';
if(parse(deletedFile,bodies.get(deletedFile)).statements.length)throw Error('Builder file still has declarations');
const report={decisions,forwardersRemoved:['ArtifactPort','TaskContextPort','DispatchIntentV1'],deletedFiles:[deletedFile],changed:[...bodies.keys()]};
fs.writeFileSync(`${root}/decisions.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({decisions:decisions.map(({name,action,destination})=>({name,action,destination})),files:bodies.size}));
if(process.argv.includes('--apply')){
 for(const file of bodies.keys()){const actual=fs.readFileSync(file),digest=crypto.createHash('sha256').update(actual).digest('hex');if(digest!==baselineHashes.get(file))throw Error(`Concurrent change: ${file}`);}
 for(const [file,body]of bodies){const archive=`${root}/history/${file}.txt`;fs.mkdirSync(path.dirname(archive),{recursive:true});fs.writeFileSync(archive,fs.readFileSync(file),{flag:'wx'});
  if(file===deletedFile){fs.unlinkSync(file);continue;}fs.writeFileSync(`${file}.cleanup-tmp`,body,{flag:'wx'});fs.renameSync(`${file}.cleanup-tmp`,file);
 }
}
