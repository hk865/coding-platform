import fs from 'node:fs';
import ts from '../../.local/linux-test-tools/node_modules/typescript/lib/typescript.js';
const read=p=>fs.readFileSync(p,'utf8').replaceAll('\r\n','\n');
const write=(p,s)=>fs.writeFileSync(p,s);
const tests=['tests/verification/rework-issues.test.ts','tests/control/rework-drive-fixture.ts','tests/control/role-material-completion.test.ts','tests/verification/reviewer-fixture.ts','tests/verification/verification-rounds.test.ts','tests/verification/verification-service.test.ts','tests/verification/role-output-completeness.test.ts','src/app/service.ts'];
for(const p of tests){let s=read(p);const sf=ts.createSourceFile(p,s,ts.ScriptTarget.Latest,true);const changes=[];let disposition=false,outputs=false;
 const visit=n=>{if(ts.isObjectLiteralExpression(n)){
   const parent=n.parent;const isOutput=ts.isCallExpression(parent)&&parent.expression.getText(sf)==='evaluateRoleOutputCompleteness';
   const isVerify=(ts.isNewExpression(parent)&&['VerificationOpenIssues','VerificationService'].includes(parent.expression.getText(sf)))||(ts.isVariableDeclaration(parent)&&parent.type?.getText(sf)==='VerificationServiceDeps');
   if(isOutput||isVerify)for(const prop of n.properties){if(prop.name?.getText(sf)==='ledger'){
     const value=ts.isPropertyAssignment(prop)?prop.initializer.getText(sf):'ledger';
     changes.push({start:prop.getStart(sf),end:prop.end,text:isOutput?`materials: outputMaterials(${value})`:`disposition: new ControlReworkDisposition(${value} as never)`});
     if(isOutput)outputs=true;else disposition=true;
   }}
 }ts.forEachChild(n,visit);};visit(sf);
 for(const c of changes.sort((a,b)=>b.start-a.start))s=s.slice(0,c.start)+c.text+s.slice(c.end);
 const prefix=p.startsWith('tests')?'../../src':'..';
 if(disposition)s=`import { ControlReworkDisposition } from '${prefix}/control/control-engine/rework-disposition.js';\n`+s;
 if(outputs)s=`import { RunOutputFacts } from '../../src/data/context-compiler/run-output-materials.js';
import type { RunOutputMaterialPort } from '../../src/contracts/run-output-materials.js';
const outputMaterials = (ledger: Pick<StateLedger, 'load' | 'events'>): RunOutputMaterialPort => ({ runOutputWitness: (run, channel) => new RunOutputFacts(run, ledger).witness(channel) });
`+s;
 if(p.endsWith('verification-service.test.ts'))s=s.replace('context: { resolveRound:', 'context: { runOutputWitness: unavailable, resolveRound:');
 write(p,s);
}
let p='src/app/service.ts',s=read(p);
s="import { GovernanceReadModel } from '../data/read-model-index/governance-view.js';\nimport { evaluateRoleSpecPinReadiness } from '../control/control-engine/policies/role-binding-admission.js';\n"+s;
const needle='    const governance = new GovernanceEntry({';
s=s.replace(needle,`    const governanceRoleSources = ROLE_SPEC_SOURCES_V1.map(source => ({ roleId: source.roleId, content: source.content }));
    const governanceEntryRoles = [
      { roleId: OPERATOR_ENTRY_ROLES.develop, purpose: '人工授权的真实运行（/api/real/tasks）' },
      { roleId: OPERATOR_ENTRY_ROLES.explore, purpose: '只读探索运行（/api/real/explorations/run）' },
    ];
${needle}
        views: new GovernanceReadModel({ ledger: () => h.ledger, defaults: { RoleSpecs: governanceRoleSources }, entryRoles: governanceEntryRoles,
          policyExplanation: { roleSpecPinReadiness: evaluateRoleSpecPinReadiness } }),`);
s=s.replace('RoleSpecs: ROLE_SPEC_SOURCES_V1.map(source => ({ roleId: source.roleId, content: source.content }))','RoleSpecs: governanceRoleSources');
s=s.replace(/entryRoles: \[\n\s*\{ roleId: OPERATOR_ENTRY_ROLES.develop,[\s\S]*?\n\s*\],/,'entryRoles: governanceEntryRoles,');write(p,s);
p='src/control/control-engine/policies/role-binding-admission.ts';s=read(p);s=s.replace(/export type RoleSpecPinReadinessV1 = \{[\s\S]*?\n\};/,"export type { RoleSpecPinReadinessV1 } from '../../../contracts/governance-view.js';");s="import type { RoleSpecPinReadinessV1 } from '../../../contracts/governance-view.js';\n"+s;write(p,s);
for(p of ['src/app/service.ts','src/harness/persistent-harness.ts','src/harness/in-memory-harness.ts']){s=read(p);s=s.replace(/new PlanCompilerImpl\(\{/g,'new PlanCompilerImpl({ workIdentity: '+(p.includes('/app/')?'h':'control')+',');write(p,s);}
