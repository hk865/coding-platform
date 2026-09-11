const fs=require('node:fs');
const ts=require('../../.local/linux-test-tools/node_modules/typescript/lib/typescript.js');
const {parse,names,importsFor,identifiers,rel,cleanup}=require('./control-contracts-migrate.cjs');
const mapPath='evidence/2026-09-09-architecture-rebuild/control-contracts-mapping.json';
const mapping=JSON.parse(fs.readFileSync(mapPath,'utf8'));
const groups={
 'goal':['buildCreateGoalCommand'],
 'governance':['buildInstallCommand','buildActivateCommand'],
 'plan':['buildApplyPlanCommand'],
 'dispatch':['buildDispatchClaimCommand','buildDispatchStartCommand','buildRunFactCommand'],
 'evidence':['buildEvidenceV1','buildEffectivityAnchorV1','buildSubmitEvidenceCommand','buildReduceTaskCommand'],
 'goal-phase':['buildReduceGoalCommand'],
 'workspace':['buildP107AcquireReadLeaseCommand','buildP107AcquireWriteLeaseCommand','buildP107ReleaseLeaseCommand','buildP107RecordPatchCommand'],
 'architecture':['buildRecordArchitectureInspectionCommand','buildRecordArchitectureFindingCommand','buildRecordArchitectureDecisionBriefCommand','buildRecordCandidateBaselineProposalCommand'],
 'material-access':['buildMaterialAccessGrantV1','buildGrantMaterialAccessCommand'],
};
const fieldChanges=[];
for(const [group,syms]of Object.entries(groups)) {
 const source=`src/contracts/fixtures/${group}-fixtures.ts`,dest=`src/contracts/commands/${group}.ts`,sf=parse(source);
 if(fs.existsSync(dest)){
   for(const symbol of syms){const node=sf.statements.find(s=>s.name?.text===symbol),required={};const visit=n=>{if(ts.isBinaryExpression(n)&&n.operatorToken.kind===ts.SyntaxKind.QuestionQuestionToken&&ts.isPropertyAccessExpression(n.left)&&ts.isIdentifier(n.left.expression)){const p=n.left.expression.text;(required[p]??=[]).push(n.left.name.text);}ts.forEachChild(n,visit);};visit(node);const formalName=symbol.replace('buildP107','build');mapping.push({symbol,source,dest,...(formalName!==symbol?{newSymbol:formalName}:{})});fieldChanges.push({symbol,newSymbol:formalName,dest,required});}
   continue;
 }
 const declarations=new Map(sf.statements.flatMap(s=>names(s).map(n=>[n,s])));
 const funcs=syms.map(n=>declarations.get(n));if(funcs.some(n=>!n))throw Error(source+'missing declarations');
 const types=new Set();for(const node of funcs)for(const name of identifiers([node]))if(declarations.has(name)&&(ts.isTypeAliasDeclaration(declarations.get(name))||ts.isInterfaceDeclaration(declarations.get(name))))types.add(name);
 for(const name of types)for(const dep of identifiers([declarations.get(name)]))if(declarations.has(dep)&&(ts.isTypeAliasDeclaration(declarations.get(dep))||ts.isInterfaceDeclaration(declarations.get(dep))))types.add(dep);
 const typeNodes=[...types].map(n=>declarations.get(n));const chunks=[],wrappers=[],aliases=[];
 for(const node of funcs) {
  const symbol=node.name.text,formalName=symbol.replace('buildP107','build');
  const defaults=new Map(),edits=[];
  const visit=n=>{if(ts.isBinaryExpression(n)&&n.operatorToken.kind===ts.SyntaxKind.QuestionQuestionToken&&ts.isPropertyAccessExpression(n.left)&&ts.isIdentifier(n.left.expression)&&node.parameters.some(p=>p.name.getText(sf)===n.left.expression.text)){
    const param=n.left.expression.text,key=n.left.name.text,entries=defaults.get(param)??new Map();entries.set(key,n.getText(sf));defaults.set(param,entries);edits.push([n.getStart(sf),n.end,n.left.getText(sf)]);return;
   }ts.forEachChild(n,visit);};visit(node.body);
  if(formalName!==symbol)edits.push([node.name.getStart(sf),node.name.end,formalName]);
  for(const param of node.parameters){const entries=defaults.get(param.name.getText(sf));if(entries?.size){const type=param.type.getText(sf);edits.push([param.type.getStart(sf),param.type.end,`(${type}) & Required<Pick<${type}, ${[...entries.keys()].map(k=>JSON.stringify(k)).join(' | ')}>>`]);}}
  let text=node.getText(sf);for(const [a,b,v]of edits.sort((a,b)=>b[0]-a[0]))text=text.slice(0,a-node.getStart(sf))+v+text.slice(b-node.getStart(sf));chunks.push(text);
  const args=node.parameters.map(p=>{const name=p.name.getText(sf),entries=defaults.get(name);return entries?.size?`{ ...${name}, ${[...entries].map(([key,val])=>key+': '+val).join(', ')} }`:name;});
  wrappers.push([node.getStart(sf),node.end,node.getText(sf).slice(0,node.body.getStart(sf)-node.getStart(sf))+`{\n  return formal${symbol}(${args.join(', ')});\n}`]);
  aliases.push(`${formalName} as formal${symbol}`);
  mapping.push({symbol,source,dest,...(formalName!==symbol?{newSymbol:formalName}:{})});
  fieldChanges.push({symbol,newSymbol:formalName,dest,required:Object.fromEntries([...defaults].map(([p,entries])=>[p,[...entries.keys()]]))});
 }
 let body=[...typeNodes.map(n=>n.getText(sf)),...chunks].join('\n\n');
 body=body.replace(/((?:from\s*|import\(\s*)["'])(\.[^"']+)(["'])/g,(_,a,p,b)=>a+rel(dest,require('node:path').resolve(require('node:path').dirname(source),p))+b);
 const temp=parse(dest,body);
 fs.mkdirSync('src/contracts/commands',{recursive:true});fs.writeFileSync(dest,'/** Formal command/value construction. Identity, authority, scope and time are caller inputs. */\n'+importsFor(sf,temp.statements,dest)+'\n\n'+body+'\n');
 let old=sf.text;for(const [a,b,v]of wrappers.sort((a,b)=>b[0]-a[0]))old=old.slice(0,a)+v+old.slice(b);fs.writeFileSync(source,`import { ${aliases.join(', ')} } from ${JSON.stringify(rel(source,dest))};\n`+old);cleanup(source);
}
fs.writeFileSync(mapPath,JSON.stringify(mapping,null,2)+'\n');
fs.writeFileSync('evidence/2026-09-09-architecture-rebuild/control-contracts-command-fields.json',JSON.stringify(fieldChanges,null,2)+'\n');
