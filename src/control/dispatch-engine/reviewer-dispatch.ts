import type { StateLedger } from '../../contracts/ledger.js';
import type { ArtifactPort } from '../../contracts/artifact.js';
import type { ControlEngine } from '../../contracts/modules.js';
import type { DispatchOutboxEntrySnapshot, RunSnapshot } from '../../contracts/dispatch.js';
import type { ReviewDispatchControlPort, ReviewDriveResult, ReviewExecutionObservation, ReviewWorkRef, ReviewWorkSnapshot } from '../../contracts/reviewer-work.js';
import type { ReviewerContextPort } from '../../contracts/reviewer-context.js';
import type { RuntimePreparationPort, RuntimeReconciliationPort, RunSpec } from '../../contracts/runtime-preparation.js';
import type { RuntimeObservationSource } from '../../contracts/runtime-observations.js';
import type { RunPort } from '../../contracts/ports.js';
import { buildDispatchStartCommand, buildRunFactCommand } from '../../contracts/commands/dispatch.js';
import { buildGrantMaterialAccessCommand, buildMaterialAccessGrantV1 } from '../../contracts/commands/material-access.js';
import { materialAccessGrantIdFor, type MaterialAccessGrantRef } from '../../contracts/material-access.js';
import { canonicalJson, sha256Hex } from '../../contracts/fingerprint.js';
import { consumeDispatchedRun } from './dispatch-engine.js';

const same = (a: unknown, b: unknown) => a === undefined || b === undefined ? a === b : canonicalJson(a as never) === canonicalJson(b as never);
const object = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export type ReviewerDispatchDeps = {
  ledger: StateLedger; control: Pick<ControlEngine, 'startRun' | 'runFact' | 'grantMaterialAccess'>;
  reviewControl: ReviewDispatchControlPort; context: ReviewerContextPort;
  runtime: RuntimePreparationPort & RuntimeReconciliationPort; execution: RunPort;
  observations: RuntimeObservationSource<ReviewExecutionObservation>; vault: ArtifactPort; now: () => string;
};
/** Owns review dispatch sequencing and recovery. All model/tool execution stays
 * in the existing Runtime/RunPort, and run facts reuse the ordinary consumer. */
export class ReviewerDispatch {
  private readonly active = new Map<string, Promise<ReviewDriveResult>>();
  constructor(private readonly deps: ReviewerDispatchDeps) {}
  drive(workRef: ReviewWorkRef): Promise<ReviewDriveResult> {
    const key = canonicalJson(workRef), running = this.active.get(key);
    if (running) return running;
    const promise = this.driveOne(workRef).finally(() => this.active.delete(key));
    this.active.set(key, promise); return promise;
  }
  async recover(workRefs: readonly ReviewWorkRef[]) { const results: ReviewDriveResult[] = []; for (const ref of workRefs) results.push(await this.drive(ref)); return results; }
  private async driveOne(workRef: ReviewWorkRef): Promise<ReviewDriveResult> {
    const fail = (status: ReviewDriveResult['status'], code: string, issues?: string[]): ReviewDriveResult => ({ status, workRef, code, ...(issues ? { issues } : {}) });
    try {
      const loaded = await this.deps.ledger.load(workRef);
      if (loaded.status !== 'found' || loaded.snapshot.ref.aggregateType !== 'ReviewWork') return fail('rejected', 'not_found');
      let work = loaded.snapshot as ReviewWorkSnapshot;
      if (work.output) return { status: 'already_bound', workRef };
      const entry = await this.deps.ledger.load(work.outboxRef), loadedRun = await this.deps.ledger.load(work.reviewerRunRef);
      if (entry.status !== 'found' || loadedRun.status !== 'found') return fail('rejected', 'not_found');
      const outbox = entry.snapshot as DispatchOutboxEntrySnapshot;
      let run = loadedRun.snapshot as RunSnapshot;
      const expectedBinding = { kind: 'review' as const, reviewWorkRef: workRef };
      if (!same(run.work, expectedBinding) || !same(outbox.intent.work, expectedBinding) || !same(outbox.intent.runRef, run.ref)) return fail('rejected', 'scope_mismatch');
      if (run.status === 'starting') {
        const selected = await this.deps.context.select(workRef);
        if (selected.status !== 'ready') return fail(selected.status === 'incomplete' ? 'incomplete' : 'rejected', selected.code, selected.status === 'incomplete' ? selected.missing : selected.issues);
        const spec: RunSpec = { mode: 'review', review: { workRef, profile: work.reviewerProfile }, projectId: work.ref.projectId, workspaceId: work.ref.workspaceId, goalId: work.ref.goalId, taskId: work.subject.taskId, runId: work.reviewerRunRef.runId, root: work.descriptor.materialIdentity.workspaceRoot, instruction: 'Independently review the pinned task, current source, and complete tool reports. Use the read-only source and material tools. Return exactly the independent-review-result JSON schema supplied in the packet. Report every required reviewer item with citations and concrete rationale; do not infer PASS from process completion.', budget: work.reviewerProfile.budget };
        const prepared = this.deps.runtime.all().find(r => same({ projectId: r.spec.projectId, goalId: r.spec.goalId, runId: r.spec.runId }, { projectId: run.ref.projectId, goalId: run.ref.goalId, runId: run.ref.runId }));
        if (prepared && (!same(prepared.spec, spec) || prepared.status !== 'prepared')) return fail('rejected', 'runtime_outcome_unknown');
        if (!prepared) { await this.deps.runtime.preflight(spec); await this.deps.runtime.prepare(spec); }
        const grantRefs: MaterialAccessGrantRef[] = [];
        for (let offset = 0; offset < selected.materials.length; offset += 64) {
          const materials = selected.materials.slice(offset, offset + 64), grantId = materialAccessGrantIdFor(work.reviewerRunRef, materials, selected.basis);
          const grant = buildMaterialAccessGrantV1({ grantId, scope: { projectId: work.ref.projectId, workspaceId: work.ref.workspaceId, goalId: work.ref.goalId }, materials, reader: work.reviewerRunRef, issuedBy: { aggregateType: 'Control', projectId: work.ref.projectId, goalId: work.ref.goalId }, purpose: 'Independent reviewer exact current original materials', basis: selected.basis, grantedAt: outbox.intent.requestedAt });
          const admitted = await this.deps.control.grantMaterialAccess(buildGrantMaterialAccessCommand(grant, { commandId: grantId, projectId: work.ref.projectId, actorKind: 'system', actorId: 'review-dispatch', idempotencyKey: grantId, correlationId: work.requestId, submittedAt: outbox.intent.requestedAt }));
          if (admitted.status !== 'committed') return fail('incomplete', 'grant_rejected', [admitted.code]);
          grantRefs.push(admitted.grantRef);
        }
        const assembled = await this.deps.context.assemble(workRef, grantRefs);
        if (assembled.status !== 'ready') return fail(assembled.status === 'incomplete' ? 'incomplete' : 'rejected', assembled.code, assembled.status === 'incomplete' ? assembled.missing : assembled.issues);
        const envelope = { ...assembled.envelope, work: expectedBinding, reviewInput: assembled.input };
        const start = await this.deps.control.startRun(buildDispatchStartCommand({ projectId: work.ref.projectId, actor: { kind: 'system', id: 'review-dispatch' }, commandId: 'review-start-' + work.ref.reviewId, correlationId: work.requestId, submittedAt: outbox.intent.requestedAt, idempotencyKey: 'review-start-' + work.ref.reviewId, runId: run.ref.runId, expectedRevision: 1, envelope, manifest: assembled.manifest }));
        if (start.status !== 'committed') return fail('rejected', start.code);
        const handle = await this.deps.execution.start(envelope);
        await consumeDispatchedRun(this.deps.control, handle, outbox.intent);
      }
      // Read immutable public observations independently, never Runtime's live
      // journal. A prepared/unknown observation after canonical start is not a
      // license to execute a new session.
      const foundRun = await this.deps.ledger.load(work.reviewerRunRef);
      if (foundRun.status !== 'found') return fail('rejected', 'not_found');
      run = foundRun.snapshot as RunSnapshot;
      const observations = this.deps.observations.all();
      const observation = observations.find(r => r.spec.projectId === run.ref.projectId && r.spec.workspaceId === work.ref.workspaceId && r.spec.goalId === run.ref.goalId && r.spec.runId === run.ref.runId);
      if (!observation || !same(observation.spec.review, { workRef, profile: work.reviewerProfile }) || observation.spec.mode !== 'review') return fail('incomplete', 'runtime_observation_missing');
      if (run.status !== 'ended') {
        if (observation.status === 'prepared' || observation.status === 'outcome_unknown') {
          await this.deps.runtime.markUnknown(run.ref);
          const result = await this.deps.control.runFact(buildRunFactCommand({ ...this.factIdentity(work, 'unknown'), runId: run.ref.runId, expectedRevision: run.revision, fact: { kind: 'outcome_unknown', runRef: run.ref, reason: 'Review execution status is unknown after restart; no automatic rerun' } }));
          return fail('incomplete', result.status === 'committed' ? 'runtime_outcome_unknown' : result.code);
        }
        for (const event of observation.events.filter(e => e.sequence > run.lastEventSeq)) {
          const applied = await this.deps.control.runFact(buildRunFactCommand({ ...this.factIdentity(work, String(event.sequence)), runId: run.ref.runId, expectedRevision: run.revision, fact: { kind: 'runtime_event', event } }));
          if (applied.status !== 'committed') return fail('incomplete', applied.code);
          const fresh = await this.deps.ledger.load(run.ref); if (fresh.status !== 'found') return fail('rejected', 'not_found'); run = fresh.snapshot as RunSnapshot;
          if (run.status === 'ended') break;
        }
      }
      if (run.status !== 'ended') return { status: 'awaiting_runtime', workRef };
      if (run.outcome !== 'completed' || run.exitCode !== 0 || observation.status !== 'completed') return fail('incomplete', 'review_execution_incomplete');
      const producer = observations.find(r => r.spec.projectId === work.producerRunRef.projectId && r.spec.goalId === work.producerRunRef.goalId && r.spec.runId === work.producerRunRef.runId);
      if (!observation.sessionId || !producer?.sessionId || producer.sessionId === observation.sessionId) return fail('rejected', 'session_not_independent');
      const final = observation.trace.filter(e => e.type === 'assistant.message_completed').at(-1), data = object(final?.data), message = object(data['message']);
      if (!final || !Array.isArray(data['toolCalls']) || data['toolCalls'].length !== 0 || typeof message['content'] !== 'string' || !message['content'].trim()) return fail('incomplete', 'final_report_missing');
      const freshWork = await this.deps.ledger.load(workRef); if (freshWork.status !== 'found') return fail('rejected', 'not_found'); work = freshWork.snapshot as ReviewWorkSnapshot;
      if (!work.input) return fail('rejected', 'input_missing');
      const current = await this.deps.context.current(workRef);
      if (current.status !== 'ready') return fail('incomplete', current.code);
      const stored = await this.deps.vault.put({ body: message['content'], contentType: 'application/json', ownerRef: run.ref, sourceRefs: [{ kind: 'artifact', refId: work.ref.reviewId, revision: 'review-report-v1', digest: work.input.descriptorDigest }], requestedAt: final.at });
      if (stored.status !== 'stored') return fail('incomplete', stored.code);
      const opened = await this.deps.vault.open(stored.ref, { requesterRunRef: run.ref, includeOwner: true });
      if (opened.status !== 'ready' || !same(opened.record.ownerRunRef, run.ref) || opened.record.body !== message['content']) return fail('rejected', 'report_owner_mismatch');
      const output = { reportRef: stored.ref, reportDigest: stored.ref.digest, runRef: run.ref, runRevision: run.revision, terminalEventId: run.lastRuntimeEventId, terminalEventSeq: run.lastEventSeq, observationId: sha256Hex(canonicalJson({ runRef: run.ref, sessionId: observation.sessionId, event: final } as never)), sessionId: observation.sessionId, packetDigest: work.input.packetDigest, inputDigest: work.input.inputDigest, descriptorDigest: work.input.descriptorDigest };
      const bound = await this.deps.reviewControl.bindOutput({ identity: { projectId: work.ref.projectId, actor: { kind: 'system', id: 'review-dispatch' }, idempotencyKey: 'review-output-' + work.ref.reviewId }, workRef, expectedWorkRevision: work.revision, output });
      return bound.status === 'rejected' ? fail('rejected', bound.code) : { status: bound.status === 'replayed' ? 'already_bound' : 'output_bound', workRef };
    } catch (error) { return fail('incomplete', 'dispatch_interrupted', [error instanceof Error ? error.message : String(error)]); }
  }
  private factIdentity(work: ReviewWorkSnapshot, suffix: string) { return { projectId: work.ref.projectId, actor: { kind: 'system' as const, id: 'review-dispatch' }, commandId: 'review-fact-' + work.ref.reviewId + '-' + suffix, correlationId: work.requestId, idempotencyKey: 'review-fact-' + work.ref.reviewId + '-' + suffix, submittedAt: this.deps.now() }; }
}
