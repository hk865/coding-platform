import type { StateLedger, WorkspaceSnapshot } from '../../../contracts/ledger.js';
import type { ControlEngine } from '../../../contracts/modules.js';
import type { RuntimePreparationPort } from '../../../contracts/runtime-preparation.js';
import type { ArtifactPort } from '../../../contracts/artifact.js';
import type { RunSnapshot, TaskLeaseSnapshot } from '../../../contracts/dispatch.js';
import type { PlanRevisionSnapshot } from '../../../contracts/plan.js';
import { handoffPacketRefFor, replacementAttemptRefFor, type HandoffPacketV1, type HandoffPacketSnapshot } from '../../../contracts/handoff.js';
import { canonicalJson, sha256Hex } from '../../../contracts/fingerprint.js';

/** Human-requested replacement admission. Inputs are exact identities and a
 * bounded reason; facts and permissions are reconstructed from canonical state. */
export class HandoffRequest {
  constructor(private readonly deps: { ledger: StateLedger; control: Pick<ControlEngine, 'recordHandoff' | 'claimReplacement'>;
    runtime: RuntimePreparationPort; vault: ArtifactPort; now: () => string }) {}
  async submit(input: { projectId: string; workspaceId: string; goalId: string; sourceRunId: string; requestId: string; reason: string }) {
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(input.requestId) || !input.reason.trim() || Buffer.byteLength(input.reason) > 4096) throw Error('Invalid handoff request identity or reason');
    const ref = { aggregateType: 'Run' as const, projectId: input.projectId, goalId: input.goalId, runId: input.sourceRunId };
    const source = await this.deps.ledger.load(ref);
    if (source.status !== 'found' || source.snapshot.ref.aggregateType !== 'Run') throw Error('Source Run missing');
    const run = source.snapshot as RunSnapshot;
    if (run.workspaceSnapshot.workspaceId !== input.workspaceId || run.work?.kind === 'review') throw Error('Source Run scope is not an ordinary handoff');
    if (run.status !== 'ended' || !run.envelope) throw Error('Source Run must have a recorded terminal fact before handoff');
    const prepared = this.deps.runtime.all().find(r => r.spec.projectId === input.projectId && r.spec.workspaceId === input.workspaceId && r.spec.goalId === input.goalId && r.spec.runId === input.sourceRunId);
    if (!prepared || prepared.spec.mode !== undefined) throw Error('Ordinary source RunSpec missing');
    const id = 'handoff-' + sha256Hex(canonicalJson({ projectId: input.projectId, goalId: input.goalId, requestId: input.requestId })).slice(0, 32);
    const packetRef = handoffPacketRefFor(input.projectId, input.goalId, run.task.taskId, id);
    const storedPacket = await this.deps.ledger.load(packetRef);
    let packet: HandoffPacketV1;
    if (storedPacket.status === 'found') {
      packet = (storedPacket.snapshot as HandoffPacketSnapshot).packet;
      if (canonicalJson(packet.source.runRef) !== canonicalJson(ref) || packet.unresolved[0]?.summary !== input.reason) throw Error('Handoff request replay changed its source or reason');
    } else {
      const workspace = await this.deps.ledger.load({ aggregateType: 'Workspace', projectId: input.projectId, workspaceId: input.workspaceId });
      const plan = await this.deps.ledger.load(run.planRef);
      if (workspace.status !== 'found' || plan.status !== 'found') throw Error('Handoff source versions unavailable');
      const previous = await this.deps.ledger.load(replacementAttemptRefFor(input.projectId, input.goalId, run.task.taskId, run.attemptId));
      const predecessorPacketRef = previous.status === 'found' ? (previous.snapshot as import('../../../contracts/handoff.js').ReplacementAttemptSnapshot).packetRef : null;
      const draft: Omit<HandoffPacketV1, 'bodyRef'> = { schemaVersion: 1, packetId: id, projectId: input.projectId, workspaceId: input.workspaceId, goalId: input.goalId,
        taskId: run.task.taskId, planRef: run.planRef, taskRevision: (plan.snapshot as PlanRevisionSnapshot).planRevision,
        objective: 'Continue task ' + run.task.taskId + ' after Run ' + input.sourceRunId + '; preserve the current plan and acceptance requirements.', constraints: ['Preserve the existing task, permissions and independent acceptance requirements.'],
        completed: [], unresolved: [{ kind: run.outcome === 'outcome_unknown' ? 'outcome_unknown' : 'other', summary: input.reason, artifactRef: null }],
        evidenceRefs: [], artifactRefs: [], workspaceSnapshot: { workspaceId: input.workspaceId, revision: (workspace.snapshot as WorkspaceSnapshot).revision },
        source: { schemaVersion: 1, runRef: ref, attemptRef: run.envelope.attemptRef, binding: run.roleBinding,
          context: { contextBundleRef: run.envelope.bundleRef, contextManifestRef: null },
          runtime: { lastEventSeq: run.lastEventSeq, terminalEventId: run.lastRuntimeEventId || null, terminalOutcome: run.outcome } },
        noFullTranscript: true, predecessorPacketRef, generatedAt: this.deps.now() };
      const body = await this.deps.vault.put({ contentType: 'application/json', body: canonicalJson(draft), ownerRef: ref,
        sourceRefs: [{ kind: 'plan-revision', refId: run.planRef.planId, revision: String(draft.taskRevision) }], requestedAt: draft.generatedAt });
      if (body.status !== 'stored') throw Error('Handoff packet body could not be stored');
      packet = { ...draft, bodyRef: body.ref };
      const recorded = await this.deps.control.recordHandoff({ schemaVersion: 1, commandType: 'RecordHandoff', commandId: id,
        identity: { projectId: input.projectId, actor: { kind: 'human', id: 'local-gui' }, idempotencyKey: id }, aggregateId: id, expectedRevision: 0,
        correlationId: id, submittedAt: packet.generatedAt, payload: { packet } });
      if (recorded.status !== 'committed') throw Error('Handoff packet rejected: ' + recorded.code);
    }
    const runId = 'replacement-' + id, attemptId = 'attempt-' + id;
    const prior = await this.deps.ledger.load(replacementAttemptRefFor(input.projectId, input.goalId, run.task.taskId, attemptId));
    if (prior.status === 'found') return { status: 'accepted', replayed: true, runId, packetRef };
    const lease = await this.deps.ledger.load({ aggregateType: 'TaskLease', projectId: input.projectId, goalId: input.goalId, taskId: run.task.taskId });
    if (lease.status !== 'found' || (lease.snapshot as TaskLeaseSnapshot).holderRunId !== input.sourceRunId) throw Error('Source is no longer the current task holder');
    const claimed = await this.deps.control.claimReplacement({ schemaVersion: 1, commandType: 'ClaimReplacement', commandId: 'claim-' + id,
      identity: { projectId: input.projectId, actor: { kind: 'human', id: 'local-gui' }, idempotencyKey: 'claim-' + id }, aggregateId: run.task.taskId,
      expectedRevision: lease.snapshot.revision, correlationId: id, submittedAt: packet.generatedAt,
      payload: { goalId: input.goalId, attemptId, runId, roleBinding: run.roleBinding, declaredPermissions: run.envelope.permissions,
        budget: run.budget, handoffPacketRef: packetRef, reason: 'manual' } });
    if (claimed.status !== 'committed') throw Error('Replacement rejected: ' + claimed.code);
    return { status: 'accepted', replayed: claimed.replayed, runId, packetRef };
  }
}
