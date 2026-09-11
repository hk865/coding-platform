import type { ControlEngine } from '../../contracts/modules.js';
import type { RunRef } from '../../contracts/dispatch.js';
import type { ExecutionFeedbackContext } from '../../data/context-compiler/execution-feedback-context.js';
import { canonicalJson, sha256Hex } from '../../contracts/fingerprint.js';
import { reworkIssueUnaddressed, type OpenIssuesViewV1 } from '../../contracts/rework/issues.js';

/** Coordination work uses the existing durable QueryJob outbox. The semantic
 * response remains a proposal/material; it never directly advances a Task. */
export class ExecutionFeedbackCompiler {
  constructor(private readonly deps: { control: Pick<ControlEngine,'submitQueryJob'>;
    materials: Pick<ExecutionFeedbackContext,'prepare'|'jobs'> & Partial<Pick<ExecutionFeedbackContext,'prepareFailure'|'failureResolution'|'current'|'prepareDecision'>>; now:()=>string }) {}
  async requestDecision(prior:import('../../contracts/query-job.js').QueryJobSnapshot,decisionRef:import('../../contracts/goal-change.js').UserDecisionSnapshot['ref']) {
    const existing=(await this.deps.materials.jobs()).find(j=>canonicalJson(j.job.intent.execution?.feedback?.decisionRef??null)===canonicalJson(decisionRef));
    if(existing) return existing.ref;
    const material=await this.deps.materials.prepareDecision?.(prior,decisionRef);
    if(!material) throw Error('Human decision delivery unavailable');
    return this.submit('decision-feedback-'+sha256Hex(canonicalJson({decisionRef,source:material.source})).slice(0,32),material);
  }
  async request(ref:RunRef, renew=false) {
    const jobs=(await this.deps.materials.jobs()).filter(j=>!j.job.intent.execution?.feedback?.failureIssueIds &&
      canonicalJson(j.job.intent.execution?.feedback?.runRef??null)===canonicalJson(ref));
    const replaced=new Set(jobs.map(j=>j.job.intent.execution?.feedback?.supersedesQueryJobId).filter(Boolean));
    const prior=jobs.filter(j=>!replaced.has(j.job.queryJobId)).sort((a,b)=>b.job.submittedAt.localeCompare(a.job.submittedAt))[0];
    if(prior && (!renew || prior.job.status==='running' || await this.deps.materials.current?.(prior))) return prior.ref;
    const material = await this.deps.materials.prepare(ref,prior);
    if (!material) return null;
    const id = 'feedback-' + sha256Hex(canonicalJson(prior?material.source:ref)).slice(0,32);
    return this.submit(id,material);
  }
  async renew(scope:import('../../contracts/planning.js').PlanningScope) {
    const refs=new Map<string,RunRef>();
    for(const j of await this.deps.materials.jobs()) {
      const f=j.job.intent.execution?.feedback;
      if(f && !f.failureIssueIds && j.job.projectId===scope.projectId && j.job.workspaceId===scope.workspaceId && j.job.goalId===scope.goalId)
        refs.set(canonicalJson(f.runRef),f.runRef);
    }
    for(const ref of refs.values()) await this.request(ref,true);
  }
  async requestFailure(issues:import('../../contracts/rework/issues.js').ReworkIssueViewV1[]) {
    const material=await this.deps.materials.prepareFailure?.(issues);
    if(!material) return null;
    const jobs=(await this.deps.materials.jobs()).filter(j=>{
      const f=j.job.intent.execution?.feedback;
      return f && j.job.projectId===material.scope.projectId && j.job.workspaceId===material.scope.workspaceId && j.job.goalId===material.scope.goalId &&
        canonicalJson(f.runRef)===canonicalJson(material.source.runRef) && f.taskId===material.source.taskId &&
        canonicalJson(f.reportRef)===canonicalJson(material.source.reportRef) && canonicalJson(f.failureIssueIds??null)===canonicalJson(material.source.failureIssueIds);
    });
    const replaced=new Set(jobs.map(j=>j.job.intent.execution?.feedback?.supersedesQueryJobId).filter(Boolean));
    const prior=jobs.filter(j=>!replaced.has(j.job.queryJobId)).sort((a,b)=>b.job.submittedAt.localeCompare(a.job.submittedAt))[0];
    const previous=prior?.job.intent.execution?.feedback;
    if(prior && previous && (prior.job.status==='running' ||
      (canonicalJson(previous.planRef)===canonicalJson(material.source.planRef) && canonicalJson(previous.sourcePin)===canonicalJson(material.source.sourcePin) && previous.workspaceRevision===material.source.workspaceRevision))) return prior.ref;
    const source={...material.source,...(prior?{supersedesQueryJobId:prior.job.queryJobId}:{}),...(previous?.decisionRef?{decisionRef:previous.decisionRef}:{})};
    return this.submit('failure-'+sha256Hex(canonicalJson(source)).slice(0,32),{...material,source});
  }
  failureResolution(id:string) { return this.deps.materials.failureResolution?.(id) ?? Promise.resolve(null); }
  async validate(row:import('../../contracts/execution-feedback.js').ReworkCoordination) {
    const current=await this.failureResolution(row.answerRef.queryJobId);
    return current!==null && canonicalJson(current)===canonicalJson(row);
  }
  async requestFailures(view:OpenIssuesViewV1) {
    if(view.status!=='ready') return [];
    const groups=new Map<string,import('../../contracts/rework/issues.js').ReworkIssueViewV1[]>();
    for(const issue of view.issues.filter(reworkIssueUnaddressed)) {
      const group=groups.get(issue.taskId) ?? []; group.push(issue); groups.set(issue.taskId,group);
    }
    const refs=[];
    for(const group of groups.values()) { const ref=await this.requestFailure(group); if(ref) refs.push(ref); }
    return refs;
  }
  private async submit(id:string,material:NonNullable<Awaited<ReturnType<ExecutionFeedbackContext['prepare']>>>) {
    const {scope,feedback,source,budget} = material;
    const receipt = await this.deps.control.submitQueryJob({schemaVersion:1,commandType:'SubmitQueryJob',commandId:id,
      identity:{projectId:scope.projectId,actor:{kind:'system',id:'execution-coordination'},idempotencyKey:id},
      aggregateId:id,expectedRevision:0,correlationId:id,submittedAt:this.deps.now(),payload:{runId:id,intent:{
        schemaVersion:1,intentId:id,...scope,question:feedback.question,
        focusTaskRefs:[{aggregateType:'Task',projectId:scope.projectId,goalId:scope.goalId,taskId:source.taskId}],
        budget:{maxTokens:budget.contextWindowTokens,deadline:null},multiTurn:{maxRounds:1},correlationId:id,
        execution:{kind:'execution_coordination',feedback:source,runtimeBudget:budget,
          roleBinding:{schemaVersion:1,bindingId:id,templateId:'planner',templateRevision:'1',bindingVersion:1,policyRevision:'execution-feedback-read-only-v1'}}}}});
    if(receipt.status!=='committed') throw Error('Feedback coordination rejected: '+receipt.code);
    return receipt.queryJobRef;
  }
}
