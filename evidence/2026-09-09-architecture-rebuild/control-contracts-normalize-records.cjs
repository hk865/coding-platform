const fs=require('node:fs');
const ts=require('../../.local/linux-test-tools/node_modules/typescript/lib/typescript.js');
const {parse,names,importsFor,rel,cleanup}=require('./control-contracts-migrate.cjs');
const mapPath='evidence/2026-09-09-architecture-rebuild/control-contracts-mapping.json';
let mapping=JSON.parse(fs.readFileSync(mapPath,'utf8'));
function stripSpecifiers(file,syms){const sf=parse(file),edits=[];for(const s of sf.statements){if(!(ts.isImportDeclaration(s)||ts.isExportDeclaration(s)))continue;const el=s.importClause?.namedBindings?.elements??s.exportClause?.elements;if(!el)continue;const keep=el.filter(e=>!syms.includes(e.name.text));if(keep.length!==el.length)edits.push([s.getStart(sf),s.end,keep.length?s.getText(sf).replace(/\{[\s\S]*?\}/,'{ '+keep.map(e=>e.getText(sf)).join(', ')+' }'):'']);}let text=sf.text;for(const [a,b,v]of edits.reverse())text=text.slice(0,a)+v+text.slice(b);fs.writeFileSync(file,text);}
function restore(fixture,record,syms){const sf=parse(record),nodes=sf.statements.filter(s=>names(s).some(n=>syms.includes(n)));stripSpecifiers(fixture,syms);let text=sf.text;for(const s of [...nodes].reverse())text=text.slice(0,s.getFullStart())+text.slice(s.end);fs.writeFileSync(record,text);fs.appendFileSync(fixture,'\n'+importsFor(sf,nodes,fixture)+'\n'+nodes.map(s=>s.getText(sf).replaceAll('../../contracts/','../')).join('\n')+'\n');mapping=mapping.filter(m=>!(m.source===fixture&&syms.includes(m.symbol)));}
function change(file,fn){fs.writeFileSync(file,fn(fs.readFileSync(file,'utf8')));cleanup(file);}
restore('src/contracts/fixtures/goal-change-fixtures.ts','src/control/records/goal-change.ts',['p111GoalRef','p111PlanRef','p111ProposalRef','p111DecisionRef','p111RevisionRef']);
restore('src/contracts/fixtures/human-role-collaboration-fixtures.ts','src/control/records/human-role-collaboration.ts',['p115DesignRef','p115DecisionRef','p115PolicyRef','p115PolicyActiveRef']);
change('src/control/records/control.ts',text=>text.replaceAll('P110_PROJECT, P110_WORKSPACE, intent.intentId','intent.projectId, intent.workspaceId, intent.intentId'));
change('src/control/records/human-role-collaboration.ts',text=>text.replace('p115DesignRef(proposal.projectId)','initialDesignProposalRefFor(proposal.projectId, proposal.workspaceId, proposal.designId)').replace('p115DecisionRef(decision.projectId)','initialDesignDecisionRefFor(decision.projectId, decision.workspaceId, decision.decisionId)').replace('p115PolicyRef(command.identity.projectId)','{ aggregateType: "CoordinationPolicyRevision", projectId: command.identity.projectId, policyId: command.payload.policyId, revision: 1 }').replace('p115PolicyActiveRef(command.identity.projectId)','{ aggregateType: "ProjectCoordinationPolicyActive", projectId: command.identity.projectId }'));
change('src/control/records/goal-change.ts',text=>text
 .replaceAll('recordedAt: string = P111_SCHEMA','recordedAt: string')
 .replace('changedAt?: string; reason?: string','changedAt: string; reason: string')
 .replace('opts.changedAt ?? P111_SCHEMA','opts.changedAt').replace('opts.reason ?? "用户接受计划变更提案"','opts.reason')
 .replace('p111ProposalRef(proposal.proposalId, proposal.projectId)','{ aggregateType: "PlanProposal", projectId: proposal.projectId, workspaceId: proposal.workspaceId, proposalId: proposal.proposalId }')
 .replace('p111DecisionRef(decision.decisionId, decision.projectId)','{ aggregateType: "UserDecision", projectId: decision.projectId, workspaceId: decision.workspaceId, decisionId: decision.decisionId }')
 .replace('goalRevisionSnapshotFor(change: GoalRevisionV1, recordedAt: string)','goalRevisionSnapshotFor(change: GoalRevisionV1, recordedAt: string, workspaceId: string)')
 .replace('p111RevisionRef(change.revision, change.goalRef.projectId)','{ aggregateType: "GoalRevision", projectId: change.goalRef.projectId, workspaceId, goalId: change.goalRef.goalId, revision: change.revision }')
 .replaceAll('p111GoalRef(proposalRef.projectId)','deps.baseGoal.ref')
 .replace('p111PlanRef(deps.newPlanDraft.planId, proposalRef.projectId)','{ aggregateType: "PlanRevision", projectId: proposalRef.projectId, planId: deps.newPlanDraft.planId }')
 .replace('goalRevisionSnapshotFor(revChange, deps.changedAt)','goalRevisionSnapshotFor(revChange, deps.changedAt, proposalRef.workspaceId)')
 .replaceAll('P111_GOAL','deps.baseGoal.ref.goalId'));
// The formal binding constructor receives every scope/role/time input explicitly.
restore('src/contracts/fixtures/context-fixtures.ts','src/control/records/context.ts',['BuildWorkContextBindingDeps','buildWorkContextBindingV1']);
change('src/control/records/context.ts',text=>text.replace('const binding = buildWorkContextBindingV1({','const binding: WorkContextBindingV1 = {\n    schemaVersion: 1,').replace('    createdAt: command.submittedAt,\n  });','    createdAt: command.submittedAt,\n    linkedRunRefs: [{ ...command.payload.initialRunRef }],\n    status: "active",\n  };').replace('    createdAt: command.submittedAt,\r\n  });','    createdAt: command.submittedAt,\r\n    linkedRunRefs: [{ ...command.payload.initialRunRef }],\r\n    status: "active",\r\n  };'));
// Keep legacy optional snapshot defaults only in the test fixture API.
function wrapper(fixture,record,symbol,params,call){stripSpecifiers(fixture,[symbol]);fs.appendFileSync(fixture,`\nimport { ${symbol} as formal${symbol} } from ${JSON.stringify(rel(fixture,record))};\nexport function ${symbol}${params} { return formal${symbol}(${call}); }\n`);}
const f='src/contracts/fixtures/goal-change-fixtures.ts',r='src/control/records/goal-change.ts';
wrapper(f,r,'planProposalSnapshotFor','(proposal: PlanProposalV1, recordedAt: string = P111_SCHEMA): PlanProposalSnapshot','proposal, recordedAt');
wrapper(f,r,'userDecisionSnapshotFor','(decision: UserDecisionV1, recordedAt: string = P111_SCHEMA): UserDecisionSnapshot','decision, recordedAt');
wrapper(f,r,'goalRevisionSnapshotFor','(change: GoalRevisionV1, recordedAt: string = P111_SCHEMA): GoalRevisionSnapshot','change, recordedAt, P111_WORKSPACE');
wrapper(f,r,'buildGoalRevisionV1','(opts: { goalRef: GoalRef; revision: number; activePlanRef: PlanRevisionRef; supersededPlanRefs: PlanRevisionRef[]; changedAt?: string; reason?: string }): GoalRevisionV1','{ ...opts, changedAt: opts.changedAt ?? P111_SCHEMA, reason: opts.reason ?? "用户接受计划变更提案" }');
fs.writeFileSync(mapPath,JSON.stringify(mapping,null,2)+'\n');
