import type { StateLedger, GoalSnapshot } from '../../contracts/ledger.js';
import type { ArtifactPort } from '../../contracts/artifact.js';
import type { RunRef, RunSnapshot } from '../../contracts/dispatch.js';
import type { RuntimeObservationSource } from '../../contracts/runtime-observations.js';
import type { RunSpec } from '../../contracts/runtime-preparation.js';
import type { ScopeCatalogPort } from '../../contracts/scope-catalog.js';
import { parseExecutionFeedback } from '../../contracts/execution-feedback.js';
import { canonicalJson } from '../../contracts/fingerprint.js';

export type FeedbackObservation = { spec: RunSpec; status: string; trace: Array<{type: string; data: unknown}> };
/** Persist the exact public report under its original author. No hidden state,
 * tool execution, permission grant or plan mutation belongs in this compiler. */
export class ExecutionFeedbackContext {
  constructor(private readonly deps: { ledger: Pick<StateLedger, 'load'>; vault: ArtifactPort;
    source: import('../../contracts/material-access.js').SourceApplicabilityPort;
    observations: RuntimeObservationSource<FeedbackObservation>; catalog: Pick<ScopeCatalogPort, 'jobs'> }) {}
  async prepare(ref: RunRef) {
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
    if (goal.status !== 'found' || workspace.status !== 'found' || canonicalJson((goal.snapshot as GoalSnapshot).activePlanRevision) !== canonicalJson(run.planRef)) throw Error('Feedback plan is stale');
    const body = await this.deps.vault.put({contentType:'application/json', body:canonicalJson({runRef:ref,feedback}), ownerRef:ref,
      sourceRefs:[{kind:'artifact',refId:canonicalJson(ref),revision:String(run.revision),digest:''}], requestedAt:run.endedAt!});
    if (body.status !== 'stored') throw Error('Feedback report unavailable');
    const source=await this.deps.source.capture({...scope,sourceSet:{kind:'workspace_paths',paths:['.']}});
    if(source.status!=='sourced') throw Error('Feedback source unavailable: '+source.status);
    return {scope, feedback, source:{runRef:ref,taskId:run.task.taskId,planRef:run.planRef,workspaceRevision:workspace.snapshot.revision,reportRef:body.ref,sourcePin:source.pin}, budget:record.spec.budget};
  }
  jobs() { return this.deps.catalog.jobs(); }
}
