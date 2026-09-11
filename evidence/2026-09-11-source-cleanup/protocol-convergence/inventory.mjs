import fs from 'node:fs';
import ts from '../../../.local/linux-test-tools/node_modules/typescript/lib/typescript.js';
import {root} from './edit.mjs';
const before=JSON.parse(fs.readFileSync(`${root}/baseline.json`,'utf8')).roots.product;
const methods=['planProposalRequest','assemblePlanningContext','recordPlanChangeProposal','recordUserDecision','applyPlanChange','assembleQueryContext','assembleWorkContext','assembleCompletedWorkContext','amend'];
const printer=ts.createPrinter({removeComments:true}),result={before:{},after:{},files:[],runtimeContractDifferences:[],consumerPaths:{}};
const sourceFiles=before.files.filter(f=>f.path.startsWith('src/')&&/\.tsx?$/.test(f.path));
for(const stage of ['before','after']){
 const directories={},contracts={files:0,lines:0,namedExports:0,interfaces:0},forwarders=[];
 for(const {path:file}of sourceFiles){
  const archive=`${root}/history/${file}.txt`,text=fs.readFileSync(stage==='before'&&fs.existsSync(archive)?archive:file,'utf8');
  const directory=file.split('/').slice(0,3).join('/');
  const row=directories[directory]??={files:0,lines:0};row.files++;row.lines+=text.split(/\r?\n/).length;
  const sf=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
  if(file.startsWith('src/contracts/')){
   contracts.files++;contracts.lines+=text.split(/\r?\n/).length;
   for(const st of sf.statements)if(st.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword)){
    if(ts.isVariableStatement(st))contracts.namedExports+=st.declarationList.declarations.length;else if(st.name)contracts.namedExports++;
    if(ts.isInterfaceDeclaration(st))contracts.interfaces++;
   }
   if(stage==='after'&&fs.existsSync(archive)){
    const old=ts.createSourceFile(file,fs.readFileSync(archive,'utf8'),ts.ScriptTarget.Latest,true);
    const runtime=source=>source.statements.filter(s=>!ts.isImportDeclaration(s)&&!ts.isTypeAliasDeclaration(s)&&!ts.isInterfaceDeclaration(s)).map(s=>printer.printNode(ts.EmitHint.Unspecified,s,source));
    if(JSON.stringify(runtime(old))!==JSON.stringify(runtime(sf)))result.runtimeContractDifferences.push(file);
   }
  }
  if(file.includes('/harness/')&&file.endsWith('-harness.ts')){
   const walk=n=>{if(ts.isPropertyAssignment(n)&&methods.includes(n.name?.getText(sf))&&ts.isArrowFunction(n.initializer))forwarders.push({file,name:n.name.getText(sf),body:n.initializer.getText(sf)});ts.forEachChild(n,walk);};walk(sf);
  }
  if(stage==='after'&&fs.existsSync(archive))result.files.push({file,beforeLines:fs.readFileSync(archive,'utf8').split(/\r?\n/).length,afterLines:text.split(/\r?\n/).length});
 }
 result[stage]={directories,contracts,forwarders};
}
fs.writeFileSync(`${root}/inventory.json`,JSON.stringify(result,null,2));
console.log(JSON.stringify({before:result.before.contracts,after:result.after.contracts,forwardersBefore:result.before.forwarders.length,forwardersAfter:result.after.forwarders.length,runtimeContractDifferences:result.runtimeContractDifferences}));
if(result.runtimeContractDifferences.length||result.after.forwarders.length)process.exitCode=1;
