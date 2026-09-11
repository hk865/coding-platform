import fs from 'node:fs';
import path from 'node:path';
import ts from '../../.local/linux-test-tools/node_modules/typescript/lib/typescript.js';
const root='evidence/2026-09-11-source-cleanup';
function put(file,body){if(fs.existsSync(file)){const h=root+'/history/'+file+'.txt';if(!fs.existsSync(h)){fs.mkdirSync(path.dirname(h),{recursive:true});fs.copyFileSync(file,h);}}fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.cleanup-tmp',body,{flag:'wx'});fs.renameSync(file+'.cleanup-tmp',file);}
function read(f){return fs.readFileSync(f,'utf8');}
function importsUsed(imports,body){return imports.split(/(?<=;)\s*(?=import)/).map(s=>{const ast=ts.createSourceFile('i.ts',s,ts.ScriptTarget.Latest,true);const n=ast.statements[0];if(!n||!ts.isImportDeclaration(n)||!n.importClause?.namedBindings||!ts.isNamedImports(n.importClause.namedBindings))return s;const names=n.importClause.namedBindings.elements.filter(e=>new RegExp('\\b'+e.name.text+'\\b').test(body));return names.length?'import '+(n.importClause.isTypeOnly?'type ':'')+'{ '+names.map(e=>e.getText(ast)).join(', ')+' } from '+n.moduleSpecifier.getText(ast)+';':'';}).filter(Boolean).join('\n');}
// Separate deterministic proposal construction from admission input checking.
const compiler='src/control/plan-compiler/rework-plan-compiler.ts', source=read(compiler), ast=ts.createSourceFile(compiler,source,ts.ScriptTarget.Latest,true);
const imports=ast.statements.filter(ts.isImportDeclaration).map(n=>n.getText(ast)).join('\n');
const group=ast.statements.find(n=>n.name?.text==='ReworkGroup');
const constant=ast.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations[0].name.getText(ast)==='REWORK_SUMMARY_MAX_REQUIREMENTS_PER_ISSUE');
const firstBuild=ast.statements.find(n=>n.name?.text==='buildTaskSetDelta');
let build=source.slice(firstBuild.getFullStart()).replace('function buildTaskSetDelta(', 'export function buildTaskSetDelta(').replace('function buildProposal(', 'export function buildProposal(');
build=constant.getText(ast)+'\nexport '+group.getText(ast)+'\n'+build;
put('src/control/plan-compiler/rework-proposal.ts','/** Deterministic rework task instructions, impact and proposal assembly.\n * Control owns task/obligation/DAG derivation and rechecks the resulting draft. */\n'+importsUsed(imports,build)+'\n'+build);
let entry=source.slice(ast.statements.filter(ts.isImportDeclaration).at(-1).end,firstBuild.getFullStart());
entry=entry.replace(constant.getText(ast),'').replace(group.getText(ast),'');
put(compiler,'/** Validate and group current failure material into a bounded rework proposal.\n * Compilation performs no I/O; Control alone accepts a new PlanRevision. */\n'+importsUsed(imports,entry)+"\nimport { buildTaskSetDelta, buildProposal, type ReworkGroup } from './rework-proposal.js';\n"+entry);
// Constructor dependencies have only VerificationEngine and test consumers.
const contract='src/contracts/verification-service.ts', original=read(contract), a=ts.createSourceFile(contract,original,ts.ScriptTarget.Latest,true);
const names=new Set(['VerificationControlPort','RecordedVerificationDeps','VerificationServiceDeps']);
const selected=a.statements.filter(n=>names.has(n.name?.text)), deps=selected.map(n=>n.getText(a)).join('\n');
const allImports=a.statements.filter(ts.isImportDeclaration).map(n=>n.getText(a)).join('\n');
put('src/control/verification-engine/verification-deps.ts',importsUsed(allImports,deps).replaceAll("from './", "from '../../contracts/")+ '\n'+deps.replaceAll("import('./", "import('../../contracts/"));
let publicBody=original.slice(a.statements.filter(ts.isImportDeclaration).at(-1).end);for(const n of selected)publicBody=publicBody.replace(n.getText(a),'');
put(contract,importsUsed(allImports,publicBody)+'\n'+publicBody);
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>['node_modules','dist','public'].includes(e.name)?[]:e.isDirectory()?walk(d+'/'+e.name):e.name.endsWith('.ts')?[d+'/'+e.name]:[]);
for(const f of [...walk('src'),...walk('tests')]){if(f===contract)continue;let s=read(f);const a=ts.createSourceFile(f,s,ts.ScriptTarget.Latest,true);const edits=[];for(const n of a.statements){if(!ts.isImportDeclaration(n)||!n.moduleSpecifier.text?.endsWith('/contracts/verification-service.js')||!n.importClause?.namedBindings||!ts.isNamedImports(n.importClause.namedBindings))continue;const moved=n.importClause.namedBindings.elements.filter(e=>names.has(e.name.text)), keep=n.importClause.namedBindings.elements.filter(e=>!names.has(e.name.text));if(!moved.length)continue;let spec=path.posix.relative(path.posix.dirname(f),'src/control/verification-engine/verification-deps.js');if(!spec.startsWith('.'))spec='./'+spec;edits.push({start:n.getStart(a),end:n.end,text:(keep.length?'import type { '+keep.map(e=>e.getText(a)).join(', ')+' } from '+n.moduleSpecifier.getText(a)+';\n':'')+'import type { '+moved.map(e=>e.getText(a)).join(', ')+' } from '+JSON.stringify(spec)+';'});}for(const e of edits.reverse())s=s.slice(0,e.start)+e.text+s.slice(e.end);if(edits.length)put(f,s);}
// Both adapters must publish a newly committed grant before Context reads it.
put('src/harness/query-composition.ts',`import { QueryJobDriveEngineImpl, type QueryJobDriveDeps } from '../control/dispatch-engine/query-drive.js';

/** Host projection sequencing only. Dispatch owns grants, queries and runs. */
export function composeQueryDrive(deps: QueryJobDriveDeps, advanceProjection: () => Promise<unknown>): QueryJobDriveEngineImpl {
  const control = deps.control;
  return new QueryJobDriveEngineImpl({ ...deps, control: {
    closeQueryJob: command => control.closeQueryJob(command),
    startQueryJob: command => control.startQueryJob(command),
    recordQueryAnswer: command => control.recordQueryAnswer(command),
    grantMaterialAccess: async command => {
      const receipt = await control.grantMaterialAccess(command);
      if (receipt.status === 'committed') await advanceProjection();
      return receipt;
    },
  } });
}
`);
for(const f of ['src/harness/in-memory-harness.ts','src/harness/persistent-harness.ts']){let s=read(f).replace('import { QueryJobDriveEngineImpl } from "../control/dispatch-engine/query-drive.js";',"import { composeQueryDrive } from './query-composition.js';");s=s.replace(/new QueryJobDriveEngineImpl\(\{ ledger, control: \{[\s\S]*?\}, vault, context: queryContext, runtime: readOnlyQuery, now: d.clock \}\)/g,'composeQueryDrive({ ledger, control, vault, context: queryContext, runtime: readOnlyQuery, now: d.clock }, advanceProjection)');put(f,s);}
console.log('Rework proposal, Verification dependencies and Query composition extracted.');
