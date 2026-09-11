import type { StateLedger } from '../../contracts/ledger.js';
import type { ArtifactPort } from '../../contracts/artifact.js';
import type { ScopeCatalogPort } from '../../contracts/scope-catalog.js';
import type { QuerySourceRevisionPort } from '../../contracts/query-execution-context.js';
import type { QueryJobAnswerSnapshot } from '../../contracts/query-job.js';
import type { WorkContextBindingSnapshot } from '../../contracts/context-continuity.js';
import type { TaskEnvelopeV1 } from '../../contracts/task-envelope.js';
import { EXECUTION_FEEDBACK_GUIDE, parseFeedbackResolution } from '../../contracts/execution-feedback.js';
import { canonicalJson, sha256Hex } from '../../contracts/fingerprint.js';
import { reworkPlanIdFor, type ReworkProposalV1 } from '../../contracts/rework/proposal.js';
import type { PlanRevisionSnapshot } from '../../contracts/plan.js';
import type { PlanProposalSnapshot } from '../../contracts/goal-change.js';

/** Directed feedback material is selected for an explicitly linked successor
 * of the same work. Exact grants are issued by Dispatch, never by Context. */
export class FeedbackMaterialCompiler {
  constructor(private readonly deps:{ledger:Pick<StateLedger,'load'> & Partial<Pick<StateLedger,'events'>>;vault:ArtifactPort;catalog:Pick<ScopeCatalogPort,'jobs'>;source:QuerySourceRevisionPort;applicability:import('../../contracts/material-access.js').SourceApplicabilityPort}) {}
  private async acceptedAdjustment(e:TaskEnvelopeV1, ref:import('../../contracts/query-job.js').QueryJobAnswerRef, answer?:string, instruction?:string) {
    if(!this.deps.ledger.events) return false;
    let cursor:import('../../contracts/command-event.js').CommitCursor|null=null;
    for(;;) {
      const page=await this.deps.ledger.events({afterCursor:cursor,limit:500});
      for(const {event} of page.events) {
        if(event.eventType!=='PlanProposalRecorded' || event.projectId!==e.projectId || event.workspaceId!==e.workspaceId) continue;
        const candidate=event.payload.proposal;
        const stored=await this.deps.ledger.load({aggregateType:'PlanProposal',projectId:e.projectId,workspaceId:e.workspaceId,proposalId:candidate.proposalId});
        if(stored.status!=='found' || stored.snapshot.ref.aggregateType!=='PlanProposal') continue;
        const proposal=(stored.snapshot as PlanProposalSnapshot).proposal as ReworkProposalV1;
        if(proposal.sourceGoalRef.goalId!==e.goalId || !proposal.coordination ||
          canonicalJson(proposal.coordination.answerRef)!==canonicalJson(ref) || (answer!==undefined && proposal.coordination.answerDigest!==sha256Hex(answer)) ||
          (instruction!==undefined && proposal.coordination.instruction!==instruction) || !proposal.rework?.tasks.some(t=>t.taskId===e.taskId)) continue;
        const accepted=await this.deps.ledger.load({aggregateType:'PlanRevision',projectId:e.projectId,planId:reworkPlanIdFor(proposal.proposalId)});
        const current=await this.deps.ledger.load(e.planRef);
        if(accepted.status!=='found' || current.status!=='found' || accepted.snapshot.ref.aggregateType!=='PlanRevision' || current.snapshot.ref.aggregateType!=='PlanRevision') continue;
        const plan=accepted.snapshot as PlanRevisionSnapshot, active=current.snapshot as PlanRevisionSnapshot;
        const assignment=plan.assignments?.find(a=>a.taskId===e.taskId);
        const currentAssignment=active.assignments?.find(a=>a.taskId===e.taskId);
        if(plan.assignments && assignment && currentAssignment && plan.goalRef.goalId===e.goalId && active.goalRef.goalId===e.goalId && canonicalJson(plan.tasks)===canonicalJson(proposal.planDraft.tasks) &&
          canonicalJson(plan.assignments)===canonicalJson(proposal.planDraft.assignments) && assignment.instruction.includes(proposal.coordination.instruction) &&
          canonicalJson(currentAssignment)===canonicalJson(assignment) &&
          active.tasks.some(t=>t.taskId===e.taskId && t.disposition==='active')) return true;
      }
      if(!page.hasMore) return false;
      if(page.throughCursor===cursor) throw Error('Feedback plan event cursor did not advance');
      cursor=page.throughCursor;
    }
  }
  async select(e:TaskEnvelopeV1,workId:string) {
    const w=await this.deps.ledger.load({aggregateType:'WorkContextBinding',projectId:e.projectId,workspaceId:e.workspaceId,workId});
    if(w.status!=='found') throw Error('Feedback work binding unavailable');
    const binding=(w.snapshot as WorkContextBindingSnapshot).binding;
    const linked=new Set(binding.linkedRunRefs.map(ref=>canonicalJson(ref)));
    const selected=[];
    const jobs=await this.deps.catalog.jobs({projectId:e.projectId,workspaceId:e.workspaceId,goalId:e.goalId});
    const superseded=new Set<string>();
    for(const successor of jobs) {
      const next=successor.job, f=next.intent.execution?.feedback;
      if(!f?.supersedesQueryJobId) continue;
      const prior=jobs.find(row=>row.job.queryJobId===f.supersedesQueryJobId), old=prior?.job.intent.execution?.feedback;
      if(!prior || !old || next.queryJobId===prior.job.queryJobId ||
        next.projectId!==e.projectId || next.workspaceId!==e.workspaceId || next.goalId!==e.goalId ||
        next.projectId!==prior.job.projectId || next.workspaceId!==prior.job.workspaceId || next.goalId!==prior.job.goalId ||
        f.taskId!==old.taskId || canonicalJson(f.runRef)!==canonicalJson(old.runRef) ||
        canonicalJson(f.reportRef)!==canonicalJson(old.reportRef) || canonicalJson(f.failureIssueIds??[])!==canonicalJson(old.failureIssueIds??[])) continue;
      const persisted=await this.deps.ledger.load(successor.ref);
      const persistedPrior=await this.deps.ledger.load(prior.ref);
      if(persisted.status!=='found' || persistedPrior.status!=='found' ||
        canonicalJson(persisted.snapshot)!==canonicalJson(successor) || canonicalJson(persistedPrior.snapshot)!==canonicalJson(prior)) continue;
      // A cycle cannot establish an authoritative latest investigation.
      const seen=new Set([next.queryJobId]);
      let cursor:typeof prior|undefined=prior;
      while(cursor && !seen.has(cursor.job.queryJobId)) {
        seen.add(cursor.job.queryJobId);
        const parent:string|undefined=cursor.job.intent.execution?.feedback?.supersedesQueryJobId;
        cursor=parent?jobs.find(row=>row.job.queryJobId===parent):undefined;
      }
      if(cursor) throw Error('Feedback renewal chain is cyclic');
      superseded.add(prior.job.queryJobId);
    }
    for(const snapshot of jobs) {
      const job=snapshot.job,f=job.intent.execution?.feedback;
      if(superseded.has(job.queryJobId)) continue;
      if(!f || f.runRef.runId===e.runRef.runId) continue;
      const sameWork=linked.has(canonicalJson(f.runRef));
      // A required Reviewer's Run has its own work identity. Its feedback is
      // directed to this successor only by the exact accepted rework proposal.
      if(!sameWork && (!f.failureIssueIds || job.status!=='answered' || !job.answerRefs.length)) continue;
      if(job.status!=='answered' || !job.answerRefs.length) throw Error('Feedback investigation is incomplete: '+job.queryJobId);
      const ref=job.answerRefs.at(-1)!;
      if(!sameWork && !await this.acceptedAdjustment(e,ref)) continue;
      const loaded=await this.deps.ledger.load(ref);
      if(loaded.status!=='found') throw Error('Feedback answer unavailable');
      const answer=(loaded.snapshot as QueryJobAnswerSnapshot).answer;
      if(answer.stale || !answer.bodyRef || canonicalJson(answer.runRef)!==canonicalJson(job.runRef)) throw Error('Feedback answer is stale or unbound');
      const resolution=parseFeedbackResolution(answer.answer);
      if(!sameWork && (resolution.action!=='adjust_plan' || !await this.acceptedAdjustment(e,ref,answer.answer,resolution.material))) continue;
      if(!['continue','supplement','adjust_plan'].includes(resolution.action)) throw Error('Feedback requires '+resolution.action+': '+resolution.summary);
      if(resolution.action==='adjust_plan' && !await this.acceptedAdjustment(e,ref,answer.answer,resolution.material)) throw Error('Feedback adjustment has no matching accepted plan');
      if(resolution.sourcePaths.some(path=>!answer.sources.some(source=>source.refKey===path &&
        (source.kind==='workspace_read_empty' || (resolution.availability!=='proven_empty' && source.kind==='workspace_read')) && !!source.version)))
        throw Error('Feedback investigation lacks successful source-read witnesses');
      const current=await this.deps.source.sourceRevision(e.projectId,e.workspaceId);
      const source=answer.sources.find(s=>s.kind==='workspace_source');
      if(!current || source?.version!==current) throw Error('Feedback source changed; investigation must be renewed');
      let humanDecision=null;
      if(f.decisionRef) {
        const d=await this.deps.ledger.load(f.decisionRef);
        if(d.status!=='found' || d.snapshot.ref.aggregateType!=='UserDecision') throw Error('Directed human decision unavailable');
        const decision=(d.snapshot as import('../../contracts/goal-change.js').UserDecisionSnapshot).decision;
        if(decision.outcome!=='accept' || decision.actor.kind!=='human' || decision.subject.goalRef.goalId!==e.goalId || decision.workspaceId!==e.workspaceId) throw Error('Directed human decision is not applicable');
        humanDecision=decision;
      }
      selected.push({ref,answer,resolution,humanDecision});
    }
    const captured=selected.length?await this.deps.applicability.capture({projectId:e.projectId,workspaceId:e.workspaceId,sourceSet:{kind:'workspace_paths',paths:['.']}}):null;
    if(captured && captured.status!=='sourced') throw Error('Feedback source pin unavailable');
    return {envelope:e,selected,basis:{planRef:e.planRef,workspaceRevision:e.workspaceSnapshot.revision,sourceDigest:captured?.status==='sourced'?captured.pin.manifestDigest:null,...(captured?.status==='sourced'?{sourcePin:captured.pin}:{})}};
  }
  async assemble(selection:Awaited<ReturnType<FeedbackMaterialCompiler['select']>>) {
    const protocol=canonicalJson({kind:'execution_feedback_protocol',version:1,runRef:selection.envelope.runRef,taskContextRef:selection.envelope.bundleRef,instructions:EXECUTION_FEEDBACK_GUIDE});
    const stored=await this.deps.vault.put({contentType:'application/json',body:protocol,ownerRef:selection.envelope.runRef,
      sourceRefs:[{kind:'artifact',refId:selection.envelope.bundleRef.digest,revision:selection.envelope.bundleRef.digest,digest:selection.envelope.bundleRef.digest}],requestedAt:new Date().toISOString()});
    if(stored.status!=='stored') throw Error('Execution feedback protocol could not be recorded: '+JSON.stringify(stored));
    const rules=[{content:protocol,digest:sha256Hex(protocol),sourceRefs:[{kind:'artifact' as const,refId:stored.ref.digest,revision:stored.ref.digest,digest:stored.ref.digest}],
      selectedBecause:'Platform public execution-feedback response contract v1'}];
    for(const row of selection.selected) {
      const opened=await this.deps.vault.open(row.answer.bodyRef!,{requesterRunRef:selection.envelope.runRef,currentBasis:selection.basis,usage:'current'});
      if(opened.status!=='ready') throw Error('Directed feedback material unavailable or forbidden');
      const body=JSON.parse(opened.record.body) as {answer:string};
      if(body.answer!==row.answer.answer) throw Error('Feedback answer digest mismatch');
      const current=await this.deps.source.sourceRevision(selection.envelope.projectId,selection.envelope.workspaceId);
      if(!current || row.answer.sources.find(s=>s.kind==='workspace_source')?.version!==current) throw Error('Feedback source changed during material assembly');
      const content=canonicalJson({qualification:'reference',resolution:row.resolution,answerRef:row.ref,sourceRefs:row.answer.sources,...(row.humanDecision?{humanDecision:row.humanDecision}:{})});
      rules.push({content,digest:sha256Hex(content),sourceRefs:[{kind:'artifact' as const,refId:row.answer.bodyRef!.digest,revision:row.answer.bodyRef!.digest,digest:row.answer.bodyRef!.digest}],selectedBecause:'Coordinator consumed this work’s execution feedback; directed supplement for the linked successor Run'});
    }
    return rules;
  }
}
