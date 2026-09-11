import type { StateLedger, GoalSnapshot } from '../../contracts/ledger.js';
import type { ArtifactPort } from '../../contracts/artifact.js';
import type { RunRef, RunSnapshot } from '../../contracts/dispatch.js';
import type { RuntimeObservationSource } from '../../contracts/runtime-observations.js';
import type { RunSpec } from '../../contracts/runtime-preparation.js';
import type { ScopeCatalogPort } from '../../contracts/scope-catalog.js';
import { parseExecutionFeedback, parseFeedbackResolution, type ReworkCoordination } from '../../contracts/execution-feedback.js';
import { canonicalJson, sha256Hex } from '../../contracts/fingerprint.js';
import type { ReworkIssueViewV1 } from '../../contracts/rework/issues.js';
import { reworkIssueFactFor } from '../../contracts/rework/issues.js';
import type { QueryJobSnapshot, QueryJobAnswerSnapshot } from '../../contracts/query-job.js';

export type FeedbackObservation = { spec: RunSpec; status: string; trace: Array<{type: string; data: unknown}> };
/** Persist the exact public report under its original author. No hidden state,
 * tool execution, permission grant or plan mutation belongs in this compiler. */
export class ExecutionFeedbackContext {
  constructor(private readonly deps: { ledger: Pick<StateLedger, 'load'>; vault: ArtifactPort;
    source: import('../../contracts/material-access.js').SourceApplicabilityPort;
    querySource?: import('../../contracts/query-execution-context.js').QuerySourceRevisionPort;
    observations: RuntimeObservationSource<FeedbackObservation>; catalog: Pick<ScopeCatalogPort, 'jobs'> }) {}
  async prepare(ref: RunRef, prior?: QueryJobSnapshot) {
    const record = this.deps.observations.all().find(r => r.spec.projectId === ref.projectId && r.spec.goalId === ref.goalId && r.spec.runId === ref.runId);
    if (!record || record.spec.mode || record.status !== 'completed') return null;
    const last = record.trace.filter(e => e.type === 'assistant.message_completed').at(-1)?.data as {message?: {content?: string}} | undefined;
    if (!last?.message?.content) return null;
    const feedback = parseExecutionFeedback(last.message.content);
    if (!feedback) return null;
    const loaded = await this.deps.ledger.load(ref);
    if (loaded.status !== 'found' || loaded.snapshot.ref.aggregateType !== 'Run') throw Error('Feedback Run unavailable');
    const run = loaded.snapshot as RunSnapshot;
    if (run.status !== 'ended' || run.outcome !== 'completed' || !run.envelope || run.task.taskId !== record.spec.taskId || run.workspaceSnapshot.workspaceId !== record.spec.workspaceId) throw Error('Feedback observation differs from canonical Run');
    const scope = {projectId: ref.projectId, workspaceId: record.spec.workspaceId, goalId: ref.goalId};
    const goal = await this.deps.ledger.load({aggregateType:'Goal', projectId:ref.projectId, goalId:ref.goalId});
    const workspace = await this.deps.ledger.load({aggregateType:'Workspace', projectId:ref.projectId, workspaceId:scope.workspaceId});
    const previous=prior?.job.intent.execution?.feedback;
    if(prior) {
      const persisted=await this.deps.ledger.load(prior.ref);
      if(persisted.status!=='found' || canonicalJson(persisted.snapshot)!==canonicalJson(prior) ||
        prior.job.projectId!==scope.projectId || prior.job.workspaceId!==scope.workspaceId || prior.job.goalId!==scope.goalId ||
        !previous || previous.failureIssueIds || previous.taskId!==run.task.taskId || canonicalJson(previous.runRef)!==canonicalJson(ref))
        throw Error('Feedback renewal source is unbound');
    }
    const planRef=goal.status==='found'?(goal.snapshot as GoalSnapshot).activePlanRevision:null;
    if (!planRef || workspace.status !== 'found' || (!prior && canonicalJson(planRef) !== canonicalJson(run.planRef))) throw Error('Feedback plan is stale');
    const body = await this.deps.vault.put({contentType:'application/json', body:canonicalJson({runRef:ref,feedback}), ownerRef:ref,
      sourceRefs:[{kind:'artifact',refId:canonicalJson(ref),revision:String(run.revision),digest:''}], requestedAt:run.endedAt!});
    if (body.status !== 'stored') throw Error('Feedback report unavailable');
    const source=await this.deps.source.capture({...scope,sourceSet:{kind:'workspace_paths',paths:['.']}});
    if(source.status!=='sourced') throw Error('Feedback source unavailable: '+source.status);
    return {scope, feedback, source:{runRef:ref,taskId:run.task.taskId,planRef,workspaceRevision:workspace.snapshot.revision,reportRef:body.ref,sourcePin:source.pin,
      ...(prior?{supersedesQueryJobId:prior.job.queryJobId}:{}),...(previous?.decisionRef?{decisionRef:previous.decisionRef}:{})}, budget:record.spec.budget};
  }
  async current(snapshot:QueryJobSnapshot):Promise<boolean> {
    try {
    const job=snapshot.job,f=job.intent.execution?.feedback;
    if(!f || !job.goalId || f.runRef.projectId!==job.projectId || f.runRef.goalId!==job.goalId ||
      f.sourcePin.projectId!==job.projectId || f.sourcePin.workspaceId!==job.workspaceId) return false;
    const goal=await this.deps.ledger.load({aggregateType:'Goal',projectId:job.projectId,goalId:job.goalId});
    const workspace=await this.deps.ledger.load({aggregateType:'Workspace',projectId:job.projectId,workspaceId:job.workspaceId});
    if(goal.status!=='found' || workspace.status!=='found' || workspace.snapshot.revision!==f.workspaceRevision ||
      canonicalJson((goal.snapshot as GoalSnapshot).activePlanRevision)!==canonicalJson(f.planRef)) return false;
    if(job.status==='answered') {
      const ref=job.answerRefs.at(-1);
      if(!ref) return false;
      const loaded=await this.deps.ledger.load(ref);
      if(loaded.status!=='found' || loaded.snapshot.ref.aggregateType!=='QueryJobAnswer') return false;
      const answer=(loaded.snapshot as QueryJobAnswerSnapshot).answer;
      if(answer.stale || !answer.bodyRef || canonicalJson(answer.runRef)!==canonicalJson(job.runRef)) return false;
      const revision=await this.deps.querySource?.sourceRevision(job.projectId,job.workspaceId);
      return !!revision && answer.sources.find(s=>s.kind==='workspace_source')?.version===revision;
    }
    if(job.status!=='pending' && job.status!=='running') return false;
    const captured=await this.deps.source.capture({projectId:job.projectId,workspaceId:job.workspaceId,sourceSet:f.sourcePin.sourceSet});
    return captured.status==='sourced' && canonicalJson(captured.pin)===canonicalJson(f.sourcePin);
    } catch { return false; }
  }
  jobs() { return this.deps.catalog.jobs(); }
  async prepareDecision(prior:QueryJobSnapshot,decisionRef:import('../../contracts/goal-change.js').UserDecisionSnapshot['ref']) {
    const f=prior.job.intent.execution?.feedback;
    if(!f || prior.job.status!=='answered') throw Error('Decision requires a completed feedback question');
    const scope={projectId:prior.job.projectId,workspaceId:prior.job.workspaceId,goalId:prior.job.goalId!};
    const g=await this.deps.ledger.load({aggregateType:'Goal',projectId:scope.projectId,goalId:scope.goalId});
    const w=await this.deps.ledger.load({aggregateType:'Workspace',projectId:scope.projectId,workspaceId:scope.workspaceId});
    const d=await this.deps.ledger.load(decisionRef);
    const opened=await this.deps.vault.open(f.reportRef,{requesterRunRef:f.runRef});
    const captured=await this.deps.source.capture({...scope,sourceSet:{kind:'workspace_paths',paths:['.']}});
    if(g.status!=='found' || w.status!=='found' || d.status!=='found' || opened.status!=='ready' || captured.status!=='sourced') throw Error('Applied decision material unavailable');
    const planRef=(g.snapshot as GoalSnapshot).activePlanRevision;
    if(!planRef) throw Error('Applied decision has no current plan');
    const report=JSON.parse(opened.record.body) as {feedback:NonNullable<ReturnType<typeof parseExecutionFeedback>>};
    return {scope,budget:prior.job.intent.execution!.runtimeBudget,
      feedback:{...report.feedback,question:'Consume the attached formally applied human clarification together with the original feedback and current source. Return sourced supplement or adjust_plan as needed; do not change acceptance obligations.'},
      source:{...f,planRef,workspaceRevision:w.snapshot.revision,sourcePin:captured.pin,supersedesQueryJobId:prior.job.queryJobId,decisionRef}};
  }
  async failureResolution(queryJobId:string):Promise<ReworkCoordination|null> {
    const snapshot=(await this.jobs()).find(j=>j.job.queryJobId===queryJobId);
    const job=snapshot?.job, f=job?.intent.execution?.feedback, ref=job?.answerRefs.at(-1);
    if(!job || !f?.failureIssueIds || !ref || job.status!=='answered') return null;
    const loaded=await this.deps.ledger.load(ref);
    if(loaded.status!=='found' || loaded.snapshot.ref.aggregateType!=='QueryJobAnswer') return null;
    const answer=(loaded.snapshot as import('../../contracts/query-job.js').QueryJobAnswerSnapshot).answer;
    if(answer.stale || !answer.bodyRef || canonicalJson(answer.runRef)!==canonicalJson(job.runRef)) return null;
    let resolution:ReturnType<typeof parseFeedbackResolution>;
    try { resolution=parseFeedbackResolution(answer.answer); } catch { return null; }
    if(resolution.action!=='adjust_plan' || resolution.availability!=='available' || resolution.sourcePaths.some(path=>
      !answer.sources.some(s=>s.kind==='workspace_read' && s.refKey===path && !!s.version))) return null;
    const current=await this.deps.querySource?.sourceRevision(job.projectId,job.workspaceId);
    if(!current || answer.sources.find(s=>s.kind==='workspace_source')?.version!==current) return null;
    const goal=await this.deps.ledger.load({aggregateType:'Goal',projectId:job.projectId,goalId:job.goalId!});
    const workspace=await this.deps.ledger.load({aggregateType:'Workspace',projectId:job.projectId,workspaceId:job.workspaceId});
    if(goal.status!=='found' || workspace.status!=='found' || workspace.snapshot.revision!==f.workspaceRevision ||
      canonicalJson((goal.snapshot as GoalSnapshot).activePlanRevision)!==canonicalJson(f.planRef)) return null;
    return {taskId:f.taskId,issueIds:f.failureIssueIds,answerRef:ref,answerDigest:sha256Hex(answer.answer),instruction:resolution.material};
  }
  async prepareFailure(issues: ReworkIssueViewV1[]) {
    const first=issues[0];
    if (!first || issues.some(i=>i.taskId!==first.taskId || i.projectId!==first.projectId || i.workspaceId!==first.workspaceId || i.goalId!==first.goalId)) return null;
    const ref=first.runRef;
    const record=this.deps.observations.all().find(r=>r.spec.projectId===ref.projectId && r.spec.goalId===ref.goalId && r.spec.runId===ref.runId);
    if (!record || (record.spec.mode && record.spec.mode!=='review') || record.status!=='completed') return null;
    const loaded=await this.deps.ledger.load(ref);
    const goal=await this.deps.ledger.load({aggregateType:'Goal',projectId:ref.projectId,goalId:ref.goalId});
    const scope={projectId:ref.projectId,workspaceId:first.workspaceId,goalId:ref.goalId};
    const workspace=await this.deps.ledger.load({aggregateType:'Workspace',projectId:ref.projectId,workspaceId:scope.workspaceId});
    if(loaded.status!=='found' || goal.status!=='found' || workspace.status!=='found') return null;
    const run=loaded.snapshot as RunSnapshot, planRef=(goal.snapshot as GoalSnapshot).activePlanRevision;
    if(!planRef || run.status!=='ended' || run.outcome!=='completed' || run.task.taskId!==first.taskId || run.workspaceSnapshot.workspaceId!==scope.workspaceId) return null;
    const feedback={kind:'execution_feedback' as const,category:'verification_failure' as const,
      summary:'正式验证遗留未处置要求。请读取失败报告与当前源码，提出保持验收语义的修复方向。',
      question:'Investigate these exact verification failures against the accepted obligations and current source. Return adjust_plan with a specific repair instruction, or explain the blocker/necessary human decision.'};
    const body=await this.deps.vault.put({contentType:'application/json',body:canonicalJson({runRef:ref,feedback,issues:issues.map(reworkIssueFactFor)}),ownerRef:ref,
      sourceRefs:issues.flatMap(i=>i.failedRequirements.flatMap(r=>r.failure.reportRef?[{kind:'artifact' as const,refId:r.failure.reportRef.digest,revision:r.failure.reportRef.digest,digest:r.failure.reportRef.digest}]:[])),requestedAt:first.detectedAt});
    if(body.status!=='stored') throw Error('Verification feedback report unavailable');
    const captured=await this.deps.source.capture({...scope,sourceSet:{kind:'workspace_paths',paths:['.']}});
    if(captured.status!=='sourced') throw Error('Verification feedback source unavailable');
    return {scope,feedback,budget:record.spec.budget,source:{runRef:ref,taskId:first.taskId,planRef,workspaceRevision:workspace.snapshot.revision,
      reportRef:body.ref,sourcePin:captured.pin,failureIssueIds:issues.map(i=>i.issueId).sort()}};
  }
}
