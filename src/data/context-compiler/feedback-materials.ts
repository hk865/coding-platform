import type { StateLedger } from '../../contracts/ledger.js';
import type { ArtifactPort } from '../../contracts/artifact.js';
import type { ScopeCatalogPort } from '../../contracts/scope-catalog.js';
import type { QuerySourceRevisionPort } from '../../contracts/query-execution-context.js';
import type { QueryJobAnswerSnapshot } from '../../contracts/query-job.js';
import type { WorkContextBindingSnapshot } from '../../contracts/context-continuity.js';
import type { TaskEnvelopeV1 } from '../../contracts/task-envelope.js';
import { EXECUTION_FEEDBACK_GUIDE, parseFeedbackResolution } from '../../contracts/execution-feedback.js';
import { canonicalJson, sha256Hex } from '../../contracts/fingerprint.js';

/** Directed feedback material is selected for an explicitly linked successor
 * of the same work. Exact grants are issued by Dispatch, never by Context. */
export class FeedbackMaterialCompiler {
  constructor(private readonly deps:{ledger:Pick<StateLedger,'load'>;vault:ArtifactPort;catalog:Pick<ScopeCatalogPort,'jobs'>;source:QuerySourceRevisionPort;applicability:import('../../contracts/material-access.js').SourceApplicabilityPort}) {}
  async select(e:TaskEnvelopeV1,workId:string) {
    const w=await this.deps.ledger.load({aggregateType:'WorkContextBinding',projectId:e.projectId,workspaceId:e.workspaceId,workId});
    if(w.status!=='found') throw Error('Feedback work binding unavailable');
    const binding=(w.snapshot as WorkContextBindingSnapshot).binding;
    const linked=new Set(binding.linkedRunRefs.map(ref=>canonicalJson(ref)));
    const selected=[];
    for(const snapshot of await this.deps.catalog.jobs({projectId:e.projectId,workspaceId:e.workspaceId,goalId:e.goalId})) {
      const job=snapshot.job,f=job.intent.execution?.feedback;
      if(!f || !linked.has(canonicalJson(f.runRef)) || f.runRef.runId===e.runRef.runId) continue;
      if(job.status!=='answered' || !job.answerRefs.length) throw Error('Feedback investigation is incomplete: '+job.queryJobId);
      const ref=job.answerRefs.at(-1)!;
      const loaded=await this.deps.ledger.load(ref);
      if(loaded.status!=='found') throw Error('Feedback answer unavailable');
      const answer=(loaded.snapshot as QueryJobAnswerSnapshot).answer;
      if(answer.stale || !answer.bodyRef || canonicalJson(answer.runRef)!==canonicalJson(job.runRef)) throw Error('Feedback answer is stale or unbound');
      const resolution=parseFeedbackResolution(answer.answer);
      if(!['continue','supplement'].includes(resolution.action)) throw Error('Feedback requires '+resolution.action+': '+resolution.summary);
      if(resolution.sourcePaths.some(path=>!answer.sources.some(source=>source.refKey===path &&
        (source.kind==='workspace_read_empty' || (resolution.availability!=='proven_empty' && source.kind==='workspace_read')) && !!source.version)))
        throw Error('Feedback investigation lacks successful source-read witnesses');
      const current=await this.deps.source.sourceRevision(e.projectId,e.workspaceId);
      const source=answer.sources.find(s=>s.kind==='workspace_source');
      if(!current || source?.version!==current) throw Error('Feedback source changed; investigation must be renewed');
      selected.push({ref,answer,resolution});
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
      const content=canonicalJson({qualification:'reference',resolution:row.resolution,answerRef:row.ref,sourceRefs:row.answer.sources});
      rules.push({content,digest:sha256Hex(content),sourceRefs:[{kind:'artifact' as const,refId:row.answer.bodyRef!.digest,revision:row.answer.bodyRef!.digest,digest:row.answer.bodyRef!.digest}],selectedBecause:'Coordinator consumed this work’s execution feedback; directed supplement for the linked successor Run'});
    }
    return rules;
  }
}
