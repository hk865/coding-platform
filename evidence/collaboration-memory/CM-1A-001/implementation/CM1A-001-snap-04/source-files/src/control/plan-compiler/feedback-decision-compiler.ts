import type { ControlEngine } from '../../contracts/modules.js';
import type { PlanCompilerPort, PlanningScope } from '../../contracts/planning.js';
import type { QueryJobAnswerRef } from '../../contracts/query-job.js';
import { decisionTargetFor } from '../../contracts/goal-change.js';
import type { FeedbackDecisionContext } from '../../data/context-compiler/feedback-decision-context.js';
import { canonicalJson } from '../../contracts/fingerprint.js';

/** A human selects a published clarification. Reuse the ordinary immutable
 * proposal → UserDecision → PlanRevision path, including its replay guards. */
export class FeedbackDecisionCompiler {
  constructor(private readonly deps:{materials:FeedbackDecisionContext;planning:Pick<PlanCompilerPort,'request'>;
    control:Pick<ControlEngine,'recordPlanChangeProposal'|'recordUserDecision'|'applyPlanChange'>;now:()=>string}) {}
  async choose(scope:PlanningScope,answerRef:QueryJobAnswerRef,optionId:string) {
    const m=await this.deps.materials.select(scope,answerRef,optionId);
    const actor={kind:'human' as const,id:'local-gui'};
    let time=this.deps.now();
    let proposal=m.proposal;
    if(!proposal) {
      const result=await this.deps.planning.request({schemaVersion:1,requestId:m.id,...scope,goalRef:m.goal.ref,planRef:m.source.planRef,
        objectiveDelta:{kind:'clarify',newObjective:m.option.objective,summary:m.option.label+': '+m.option.impact},obligationDeltas:[],
        requestedByRunRef:null,requestedBy:actor,submittedAt:time});
      if(result.status!=='proposal') throw Error('Clarification proposal unavailable: '+JSON.stringify(result));
      proposal=result.proposal;
      const id=m.id+'-proposal';
      const receipt=await this.deps.control.recordPlanChangeProposal({schemaVersion:1,commandType:'RecordPlanChangeProposal',commandId:id,
        identity:{projectId:scope.projectId,actor,idempotencyKey:id},aggregateId:proposal.proposalId,expectedRevision:0,correlationId:m.id,submittedAt:time,payload:{proposal}});
      if(receipt.status!=='committed') throw Error('Clarification proposal rejected: '+receipt.code);
    }
    time=proposal.generatedAt;
    const proposalRef={aggregateType:'PlanProposal' as const,projectId:scope.projectId,workspaceId:scope.workspaceId,proposalId:proposal.proposalId};
    const decisionId=m.id+'-decision';
    const decision=m.decision??{schemaVersion:1 as const,decisionId,projectId:scope.projectId,workspaceId:scope.workspaceId,proposalRef,
      subject:{goalRef:m.goal.ref,sourcePlanRef:proposal.sourcePlanRef,sourcePlanRevision:proposal.sourcePlanRevision},
      outcome:'accept' as const,actor,authority:{strategy:'user' as const,delegator:null,policyVersion:'feedback-clarification-v1'},
      authorizedTarget:decisionTargetFor(proposal),summary:canonicalJson({kind:'feedback_clarification_choice',version:1,answerRef,optionId}),decidedAt:time};
    const recorded=await this.deps.control.recordUserDecision({schemaVersion:1,commandType:'RecordUserDecision',commandId:decisionId,
      identity:{projectId:scope.projectId,actor,idempotencyKey:decisionId},aggregateId:decisionId,expectedRevision:0,correlationId:m.id,submittedAt:time,payload:{decision}});
    if(recorded.status!=='committed') throw Error('Human decision rejected: '+recorded.code);
    const id=m.id+'-apply';
    const applied=await this.deps.control.applyPlanChange({schemaVersion:1,commandType:'ApplyPlanChange',commandId:id,
      identity:{projectId:scope.projectId,actor,idempotencyKey:id},aggregateId:proposal.proposalId,expectedRevision:m.goal.revision,correlationId:m.id,submittedAt:time,
      payload:{proposalRef,decisionRef:recorded.decisionRef,changeReason:'human-feedback-clarification:'+decisionId,
        newPlanDraft:{planId:'plan-'+m.id,planRevision:m.plan.planRevision+1,objective:m.option.objective,
          stages:m.plan.stages,tasks:m.plan.tasks,assignments:m.plan.assignments??null,taskHierarchy:m.plan.taskHierarchy,executionDag:m.plan.executionDag,obligations:m.plan.obligations}}});
    if(applied.status!=='committed') throw Error('Human clarification not applied: '+applied.code);
    return {status:'applied' as const,decisionRef:recorded.decisionRef,planRef:applied.activePlanRef,sourceJob:m.job};
  }
}
