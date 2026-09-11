const fs=require('node:fs');
const {parse,names,cleanup}=require('./control-contracts-migrate.cjs');
const mapPath='evidence/2026-09-09-architecture-rebuild/control-contracts-mapping.json';
let mapping=JSON.parse(fs.readFileSync(mapPath,'utf8'));
const old='src/control/policies/governance.ts',dest='src/data/governance-records.ts';
fs.writeFileSync(dest,fs.readFileSync(old,'utf8').replaceAll('../../contracts/','../contracts/').replace('Control-owned deterministic domain policy.','Canonical governance record resolution by exact identity and digest; read-only.'));
fs.unlinkSync(old);mapping=mapping.map(m=>m.dest===old?{...m,dest}:m);
function moveRef(source,dest,syms){const sf=parse(source),nodes=sf.statements.filter(s=>names(s).some(n=>syms.includes(n)));let text=sf.text;for(const n of [...nodes].reverse())text=text.slice(0,n.getFullStart())+text.slice(n.end);const targetImport=source.includes('/records/')?'../../contracts/':'../';text=`import { ${syms.join(', ')} } from "${targetImport+dest.split('/').at(-1).replace('.ts','.js')}";\nexport { ${syms.join(', ')} } from "${targetImport+dest.split('/').at(-1).replace('.ts','.js')}";\n`+text;fs.writeFileSync(source,text);fs.appendFileSync(dest,'\n'+nodes.map(n=>n.getText(sf)).join('\n\n')+'\n');cleanup(source);}
moveRef('src/contracts/fixtures/governance-fixtures.ts','src/contracts/governance.ts',['completionPolicyRevisionRefFor','architectureBaselineRevisionRefFor','completionPolicyPinFor','architectureBaselinePinFor']);
for(const symbol of ['completionPolicyRevisionRefFor','architectureBaselineRevisionRefFor','completionPolicyPinFor','architectureBaselinePinFor'])mapping.push({symbol,source:'src/contracts/fixtures/governance-fixtures.ts',dest:'src/contracts/governance.ts'});
moveRef('src/control/records/plan.ts','src/contracts/plan.ts',['planRevisionRefFor','goalRefFor']);
mapping=mapping.map(m=>['planRevisionRefFor','goalRefFor'].includes(m.symbol)?{...m,dest:'src/contracts/plan.ts'}:m);
let text=fs.readFileSync('src/contracts/commands/architecture.ts','utf8').replace('inspection.intent.projectId ?? deps.projectId ?? P112_PROJECT','inspection.intent.projectId');fs.writeFileSync('src/contracts/commands/architecture.ts',text);
// Public input type names describe the command, never a test ticket.
for(const file of ['src/contracts/commands/workspace.ts','src/contracts/commands/architecture.ts','src/contracts/commands/goal.ts']){let t=fs.readFileSync(file,'utf8').replaceAll('BuildP107','Build').replaceAll('P107Actor','WorkspaceCommandActor').replaceAll('BuildP112CommandDeps','BuildArchitectureCommandDeps').replaceAll('GoalFixtureScope','CreateGoalScope');fs.writeFileSync(file,t);}
fs.writeFileSync(mapPath,JSON.stringify(mapping,null,2)+'\n');
