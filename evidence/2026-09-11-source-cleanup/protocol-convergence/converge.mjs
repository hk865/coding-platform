import {edit,replace} from './edit.mjs';
edit('src/contracts/goal-change.ts',s=>s.replace(/export interface PlanProposalPort \{[\s\S]*?\n\}\r?\n\r?\n/,'').replace('Ports (interfaces_to_freeze)','Planning context').replace('Pure helpers (P1-11 frozen):','Pure helpers:'));
edit('src/contracts/planning.ts',s=>{
 s=replace(s,'AmendGoalRequestV1, PlanProposalPort','AmendGoalRequestV1, PlanProposalV1');
 s=replace(s,'export interface PlanCompilerPort extends PlanProposalPort {',`export type PlanProposalResult =
  | { status: 'proposal'; proposal: PlanProposalV1 }
  | { status: 'needs_material'; gaps: string[] }
  | PlanningRejection;

export interface PlanCompilerPort {`);
 return replace(s,"ReturnType<PlanProposalPort['request']>",'Promise<PlanProposalResult>');
});
edit('src/control/plan-compiler/plan-compiler.ts',s=>s.replace(/export type PlanProposalResult =[\s\S]*?\r?\n\r?\n/,'').replace('PlanCompilerPort, PlanningMaterialPort','PlanCompilerPort, PlanProposalResult, PlanningMaterialPort'));
for(const file of ['src/harness/in-memory-harness.ts','src/harness/persistent-harness.ts','src/interaction/human-collaboration/human-collaboration.ts'])edit(file,s=>{
 const prefix=file.includes('human-collaboration')?'../../':'../';
 s=s.replace(/import type \{ PlanProposalPort(?:, PlanningContextPort)? \} from [^;]+;/,file.includes('harness')?`import type { PlanningContextPort } from "../contracts/goal-change.js";`:'');
 s=`import type { PlanCompilerPort } from '${prefix}contracts/planning.js';\n`+s;
 s=s.replaceAll('PlanProposalPort',"Pick<PlanCompilerPort, 'request'>");
 // Existing module objects already expose these methods; delete the second facade.
 s=s.replace(/^.*planProposalRequest\([^\n]+\r?\n/gm,'').replace(/^.*planProposalRequest: \(request\)[^\n]+\r?\n/gm,'');
 s=s.replace(/^.*assemblePlanningContext\(request:[^\n]+\r?\n/gm,'').replace(/^.*assemblePlanningContext: \(request\)[^\n]+\r?\n/gm,'');
 return s;
});
edit('tests/contract-suite/p1-11-harness.ts',s=>{
 s="import type { PlanCompilerPort } from '../../src/contracts/planning.js';\nimport type { PlanningContextPort } from '../../src/contracts/goal-change.js';\n"+s;
 s=s.replace(/^  planProposalRequest[^\n]+/gm,"  planProposal: Pick<PlanCompilerPort, 'request'>;");
 return s.replace(/^  assemblePlanningContext[^\n]+/gm,'  planningContext: PlanningContextPort;');
});
edit('tests/contract-suite/goal-change.contract.suite.ts',s=>s.replaceAll('h.planProposalRequest(', 'h.planProposal.request(').replaceAll('h.assemblePlanningContext(', 'h.planningContext.assemblePlanningContext(').replaceAll('planProposalRequest is bounded', 'planProposal.request is bounded'));
// The rework shape remains stricter than the nullable legacy amendment command.
edit('src/contracts/rework/proposal.ts',s=>{
 s=replace(s,'AcceptanceObligation, PlanRevisionRef, PlanRevisionSnapshot, PlanStage, PlanTaskAssignment, RuntimeExecutionDAG, RuntimeTask, TaskHierarchy','PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot');
 s=replace(s,'  planDraft: ReworkPlanDraftV1;',`  /** Complete plan content; rework must include tasks and assignments. Control
   * re-derives them before admission. Ordinary amendments retain nullable defaults. */
  planDraft: Required<Pick<PlanRevisionDraft, 'planId' | 'planRevision' | 'stages' | 'tasks' | 'assignments' | 'taskHierarchy' | 'executionDag' | 'obligations'>> & { objective: string };`);
 const start=s.indexOf('/**\n * applyPlanChange 消费');
 const crlfStart=s.indexOf('/**\r\n * applyPlanChange 消费');
 const a=start>=0?start:crlfStart, b=s.indexOf('export type ReworkPlanDraftV1 =',a),end=s.indexOf('};',b)+2;
 if(a<0||b<0||end<2)throw Error('Rework draft region missing');
 return s.slice(0,a)+s.slice(end);
});
edit('src/control/plan-compiler/rework-proposal.ts',s=>s.replace(' type ReworkPlanDraftV1,','').replace('const planDraft: ReworkPlanDraftV1',"const planDraft: ReworkProposalV1['planDraft']"));
