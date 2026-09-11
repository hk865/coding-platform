const fs = require('node:fs');
const path = require('node:path');
const ts = require('../../.local/linux-test-tools/node_modules/typescript/lib/typescript.js');
const root = process.cwd();
const migrations = [];
function parse(file, text = fs.readFileSync(file, 'utf8')) { return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true); }
function names(node) {
  if (node.name && ts.isIdentifier(node.name)) return [node.name.text];
  if (ts.isVariableStatement(node)) return node.declarationList.declarations.flatMap(d => ts.isIdentifier(d.name) ? [d.name.text] : []);
  return [];
}
function identifiers(nodes) { const out = new Set(); const visit = n => { if(ts.isIdentifier(n))out.add(n.text); ts.forEachChild(n,visit); }; nodes.forEach(visit); return out; }
function rel(from, to) { let p=path.relative(path.dirname(from), to).replaceAll('\\','/').replace(/\.ts$/,'.js'); return p.startsWith('.')?p:'./'+p; }
function rewritePaths(text, from, to) { return text.replace(/((?:from\s*|import\(\s*)["'])(\.[^"']+)(["'])/g,(_,a,p,b)=>a+rel(to,path.resolve(path.dirname(from),p))+b); }
function importsFor(sf, nodes, dest, extras = []) {
  const used = identifiers(nodes), result=[];
  for(const s of sf.statements) {
    if(!ts.isImportDeclaration(s))continue;
    const c=s.importClause;
    if(!c)continue;
    let body='';
    if(c.name && used.has(c.name.text))body=c.name.text;
    if(c.namedBindings && ts.isNamedImports(c.namedBindings)) {
      const el=c.namedBindings.elements.filter(e=>used.has(e.name.text));
      if(el.length)body+=(body?', ':'')+'{ '+el.map(e=>e.getText(sf)).join(', ')+' }';
    } else if(c.namedBindings && used.has(c.namedBindings.name.text)) body+=(body?', ':'')+c.namedBindings.getText(sf);
    if(body)result.push(`import ${c.isTypeOnly?'type ':''}${body} from ${JSON.stringify(s.moduleSpecifier.text.startsWith('.')?rel(dest,path.resolve(path.dirname(sf.fileName),s.moduleSpecifier.text)):s.moduleSpecifier.text)};`);
  }
  result.push(...extras);
  return result.join('\n');
}
function cleanup(file) {
 const sf=parse(file), changes=[];
 const nodes=sf.statements.filter(s=>!ts.isImportDeclaration(s));
 for(const s of sf.statements)if(ts.isImportDeclaration(s)){ const next=importsFor({...sf,statements:[s]},nodes,file); changes.push([s.getStart(sf),s.end,next]); }
 let text=sf.text; for(const [start,end,value] of changes.reverse())text=text.slice(0,start)+value+text.slice(end); fs.writeFileSync(file,text);
}
function move(source, dest, selected, {fixture=false, includeExported=false, includeTypes=false, includeVariables=true}={}) {
 const sf=parse(source), decls=new Map(sf.statements.flatMap(s=>names(s).map(n=>[n,s]))), moved=new Set(selected);
 for(const n of moved){if(!decls.has(n))throw Error(source+' missing '+n);const refs=identifiers([decls.get(n)]);for(const r of refs){const d=decls.get(r);if(d && (ts.isFunctionDeclaration(d) || (includeVariables && ts.isVariableStatement(d)) || (includeTypes && (ts.isTypeAliasDeclaration(d)||ts.isInterfaceDeclaration(d)))) && (includeExported || !d.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword)))moved.add(r);}}
 const nodes=sf.statements.filter(s=>names(s).some(n=>moved.has(n))), used=identifiers(nodes), extras=[];
 const localTypes=[],localValues=[];
 for(const [n,d]of decls)if(used.has(n)&&!moved.has(n)){if(ts.isTypeAliasDeclaration(d)||ts.isInterfaceDeclaration(d))localTypes.push(n);else localValues.push(n);}
 if(localTypes.length)extras.push(`import type { ${localTypes.join(', ')} } from ${JSON.stringify(rel(dest,source))};`);
 if(localValues.length)extras.push(`import { ${localValues.join(', ')} } from ${JSON.stringify(rel(dest,source))};`);
 const content='/** Control-owned '+(fixture?'canonical record construction.':'deterministic domain policy.')+' */\n'+importsFor(sf,nodes,dest,extras)+'\n\n'+nodes.map(s=>rewritePaths(sf.text.slice(s.getFullStart(),s.end),source,dest)).join('\n');
 fs.mkdirSync(path.dirname(dest),{recursive:true}); fs.writeFileSync(dest,content);
 let old=sf.text;for(const s of [...nodes].reverse())old=old.slice(0,s.getFullStart())+old.slice(s.end);
 const exported=nodes.flatMap(s=>s.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword)?names(s):[]);
 const typeNames=exported.filter(n=>ts.isTypeAliasDeclaration(decls.get(n))||ts.isInterfaceDeclaration(decls.get(n))), valueNames=exported.filter(n=>!typeNames.includes(n));
 if(fixture && exported.length)old=(valueNames.length?`import { ${valueNames.join(', ')} } from ${JSON.stringify(rel(source,dest))};\nexport { ${valueNames.join(', ')} } from ${JSON.stringify(rel(source,dest))};\n`:'')+(typeNames.length?`import type { ${typeNames.join(', ')} } from ${JSON.stringify(rel(source,dest))};\nexport type { ${typeNames.join(', ')} } from ${JSON.stringify(rel(source,dest))};\n`:'')+old;
 fs.writeFileSync(source,old);cleanup(source);
 for(const n of exported)migrations.push({symbol:n,source,dest});
 return {moved:[...moved],localValues,localTypes};
}
const policies = [
 ['reduction','task-reduction',['reduceTaskVerification']],
 ['evidence','evidence',['evidenceApplicability','evidenceBindingFor','selectEffectiveEvidenceSet']],
 ['goal-phase','goal-phase',['reconcileGoalSideEffects','evaluateGoalCompletionGuard','reduceGoalPhase','renderGoalCompletionExplanation']],
 ['dispatch','task-eligibility',['evaluateTaskEligibility']],
 ['handoff','replacement-eligibility',['evaluateReplacementEligibility']],
 ['workspace-lease','workspace-lease',['evaluateLeaseAdmissibility']],
 ['goal-change','goal-change',['computeTaskDispositions']],
 ['governance','governance',['resolveCompletionPolicyRevision','resolveArchitectureBaselineRevision','loadProjectCompletionPolicyActive','loadProjectArchitectureBaselineActive','resolveProjectCompletionPolicy','resolveProjectArchitectureBaseline']],
 ['architecture-evolution-policy','architecture-evolution-policy',['resolveArchitectureEvolutionPolicyRevision','resolveProjectArchitectureEvolutionPolicy']],
];
if(process.argv[2]==='policies')for(const [src,dst,syms]of policies)console.log(src,move('src/contracts/'+src+'.ts','src/control/policies/'+dst+'.ts',syms));
if(require.main===module)fs.writeFileSync('evidence/2026-09-09-architecture-rebuild/control-contracts-mapping.json',JSON.stringify(migrations,null,2)+'\n');
module.exports={parse,names,identifiers,rel,importsFor,cleanup,move,migrations};
