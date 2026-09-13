import type { StateLedger, GoalSnapshot } from '../../contracts/ledger.js';
import type { PlanningScope } from '../../contracts/planning.js';
import type { QueryJobAnswerRef, QueryJobAnswerSnapshot, QueryJobSnapshot } from '../../contracts/query-job.js';
import type { PlanRevisionSnapshot } from '../../contracts/plan.js';
import { decisionTargetFor, type PlanProposalSnapshot, type UserDecisionV1 } from '../../contracts/goal-change.js';
import { canonicalJson, sha256Hex } from '../../contracts/fingerprint.js';
import { parseFeedbackResolution } from '../../contracts/execution-feedback.js';

function recordedOption(decision:UserDecisionV1,answerRef:QueryJobAnswerRef,options:NonNullable<ReturnType<typeof parseFeedbackResolution>['decision']>['options']) {
  try {
    const value=JSON.parse(decision.summary??'');
    if(value.kind==='feedback_clarification_choice' && value.version===1 && canonicalJson(value.answerRef)===canonicalJson(answerRef))
      return options.find(option=>option.id===value.optionId);
  } catch { /* Preserve exact legacy summaries, without guessing an option. */ }
  return options.find(option=>decision.summary==='Selected '+option.id+' from '+JSON.stringify(answerRef)+': '+option.label);
}

/** Select a published clarification option against its exact source answer.
 * This material reader does not decide, accept a plan, or start work. */
export class FeedbackDecisionContext {
  constructor(private readonly ledger:Pick<StateLedger,'load'>,private readonly source?:import('../../contracts/query-execution-context.js').QuerySourceRevisionPort,
    private readonly catalog?:Pick<import('../../contracts/scope-catalog.js').ScopeCatalogPort,'jobs'>) {}
  async recordedChoices() {
    const rows=[];
    for(const job of await this.catalog?.jobs()??[]) {
      if(!job.job.intent.execution?.feedback) continue;
      const answerRef=job.job.answerRefs.at(-1); if(!answerRef) continue;
      const id='feedback-choice-'+sha256Hex(canonicalJson(answerRef)).slice(0,32);
      const decisionRef={aggregateType:'UserDecision' as const,projectId:job.job.projectId,workspaceId:job.job.workspaceId,decisionId:id+'-decision'};
      const d=await this.ledger.load(decisionRef);
      if(d.status==='found' && d.snapshot.ref.aggregateType==='UserDecision') {
        const decision=(d.snapshot as import('../../contracts/goal-change.js').UserDecisionSnapshot).decision;
        if(decision.actor.kind!=='human' || decision.outcome!=='accept' || !job.job.goalId) continue;
        try {
          const answer=await this.ledger.load(answerRef);
          if(answer.status!=='found' || answer.snapshot.ref.aggregateType!=='QueryJobAnswer') continue;
          const resolution=parseFeedbackResolution((answer.snapshot as QueryJobAnswerSnapshot).answer.answer);
          const option=recordedOption(decision,answerRef,resolution.decision?.options??[]);
          if(!option) continue;
          const scope={projectId:job.job.projectId,workspaceId:job.job.workspaceId,goalId:job.job.goalId};
          const selected=await this.select(scope,answerRef,option.id);
          if(selected.decision) rows.push({sourceJob:selected.job,decisionRef,scope,answerRef,optionId:option.id});
        } catch { /* Invalid or unavailable persisted choices remain unconsumed. */ }
      }
    }
    return rows;
  }
  async select(scope:PlanningScope,answerRef:QueryJobAnswerRef,optionId:string) {
    if(answerRef.aggregateType!=='QueryJobAnswer' || answerRef.projectId!==scope.projectId || answerRef.workspaceId!==scope.workspaceId) throw Error('Decision answer scope mismatch');
    const a=await this.ledger.load(answerRef);
    const j=await this.ledger.load({aggregateType:'QueryJob',projectId:scope.projectId,workspaceId:scope.workspaceId,queryJobId:answerRef.queryJobId});
    if(a.status!=='found' || a.snapshot.ref.aggregateType!=='QueryJobAnswer' || j.status!=='found' || j.snapshot.ref.aggregateType!=='QueryJob') throw Error('Decision question unavailable');
    const answer=(a.snapshot as QueryJobAnswerSnapshot).answer, job=j.snapshot as QueryJobSnapshot;
    const source=job.job.intent.execution?.feedback;
    if(!source || job.job.goalId!==scope.goalId || job.job.status!=='answered' || answer.stale || canonicalJson(answer.runRef)!==canonicalJson(job.job.runRef)) throw Error('Decision question is stale or unbound');
    const resolution=parseFeedbackResolution(answer.answer);
    const option=resolution.action==='needs_decision' ? resolution.decision?.options.find(o=>o.id===optionId) : undefined;
    if(!option) throw Error('Choose an exact published clarification option');
    const id='feedback-choice-'+sha256Hex(canonicalJson(answerRef)).slice(0,32);
    const prior=await this.ledger.load({aggregateType:'PlanProposal',projectId:scope.projectId,workspaceId:scope.workspaceId,proposalId:'proposal-'+id});
    const proposal=prior.status==='found' && prior.snapshot.ref.aggregateType==='PlanProposal' ? (prior.snapshot as PlanProposalSnapshot).proposal : null;
    if(proposal && (proposal.patch.patchDraft.objective!==option.objective || canonicalJson(proposal.sourcePlanRef)!==canonicalJson(source.planRef))) throw Error('This question already has a different recorded choice');
    const recorded=await this.ledger.load({aggregateType:'UserDecision',projectId:scope.projectId,workspaceId:scope.workspaceId,decisionId:id+'-decision'});
    const decision=recorded.status==='found' && recorded.snapshot.ref.aggregateType==='UserDecision' ? (recorded.snapshot as import('../../contracts/goal-change.js').UserDecisionSnapshot).decision:null;
    if(decision && (!proposal || decision.actor.kind!=='human' || decision.outcome!=='accept' || decision.authority.strategy!=='user' ||
      decision.projectId!==scope.projectId || decision.workspaceId!==scope.workspaceId || decision.subject.goalRef.goalId!==scope.goalId ||
      decision.decisionId!==id+'-decision' || canonicalJson(decision.subject.sourcePlanRef)!==canonicalJson(proposal.sourcePlanRef) ||
      decision.subject.sourcePlanRevision!==proposal.sourcePlanRevision ||
      canonicalJson(decision.proposalRef)!==canonicalJson(prior.status==='found'?prior.snapshot.ref:null) ||
      canonicalJson(decision.authorizedTarget)!==canonicalJson(decisionTargetFor(proposal)) ||
      recordedOption(decision,answerRef,resolution.decision?.options??[])?.id!==optionId)) throw Error('Recorded human choice does not bind this exact option');
    if(!decision && (!this.source || answer.sources.find(s=>s.kind==='workspace_source')?.version!==await this.source.sourceRevision(scope.projectId,scope.workspaceId))) throw Error('Decision source changed; request current options');
    const g=await this.ledger.load({aggregateType:'Goal',projectId:scope.projectId,goalId:scope.goalId});
    const w=await this.ledger.load({aggregateType:'Workspace',projectId:scope.projectId,workspaceId:scope.workspaceId});
    const p=await this.ledger.load(source.planRef);
    if(g.status!=='found' || w.status!=='found' || p.status!=='found' || p.snapshot.ref.aggregateType!=='PlanRevision') throw Error('Decision scope unavailable');
    const goal=g.snapshot as GoalSnapshot;
    if(goal.workspaceRef.workspaceId!==scope.workspaceId || w.snapshot.revision!==source.workspaceRevision || (!decision && canonicalJson(goal.activePlanRevision)!==canonicalJson(source.planRef))) throw Error('Decision basis changed; request current options');
    return {id,job,answerRef,option,resolution,goal,source,plan:p.snapshot as PlanRevisionSnapshot,proposal,decision};
  }
}
