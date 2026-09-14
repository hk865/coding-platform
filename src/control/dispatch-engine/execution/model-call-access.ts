import type { ModelCallAccess, ModelRequestPermitSnapshot, RunSnapshot, RuntimeInputBindingV1 } from '../../../contracts/dispatch.js';
import { modelRequestPermitRefFor, modelRequestPermitIdFor } from '../../../contracts/dispatch.js';
import type { StateLedger } from '../../../contracts/ledger.js';
import type { ControlEngine } from '../../../contracts/modules.js';
import type { TaskEnvelopeV1 } from '../../../contracts/task-envelope.js';
import { buildAuthorizeModelRequestCommand, buildRunFactCommand } from '../../../contracts/commands/dispatch.js';
import { canonicalJson } from '../../../contracts/fingerprint.js';
import { readAdmittedSuccessor } from '../coordination-admission-read.js';

/** Runtime supplies the actual input/request digests; Control owns authorization.
 * The durable attempted fact precedes the provider boundary. A consumed permit
 * never grants permission on replay, including after a process restart. */
export function createModelCallAccess(deps: {
  ledger: StateLedger; control: Pick<ControlEngine, 'runFact' | 'authorizeModelRequest'>;
  envelope: TaskEnvelopeV1; now: () => string;
}): ModelCallAccess {
  const { envelope, ledger, control } = deps;
  const common = (id: string, revision: number) => ({
    actor: { kind: 'system' as const, id: 'dispatch' }, commandId: id, idempotencyKey: id,
    correlationId: envelope.runRef.runId, submittedAt: deps.now(), projectId: envelope.projectId,
    runId: envelope.runRef.runId, expectedRevision: revision,
  });
  async function current() {
    const loaded = await ledger.load(envelope.runRef);
    if (loaded.status !== 'found') throw Error('Model call Run is missing');
    const run = loaded.snapshot as RunSnapshot;
    if (run.status === 'ended') throw Error('Model call Run has ended');
    return run;
  }
  return {
    async bind(input) {
      const admitted = await readAdmittedSuccessor(ledger, { projectId: envelope.projectId,
        workspaceId: envelope.workspaceId, runId: envelope.runRef.runId });
      if (admitted.status === 'unavailable') throw Error(admitted.reason);
      const binding: RuntimeInputBindingV1 = { schemaVersion: 1, ...input,
        materialAccessRefs: [...(input.materialAccessRefs ?? [])].sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b))),
        deliveryRefs: (admitted.status === 'found' ? admitted.facts.admission.admission.deliveryRefs : [])
          .map(ref => ({ ...ref })).sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b))),
      };
      // Only lifecycle ingestion can concurrently advance this Run. A bounded
      // CAS retry rereads facts; it never retries a provider operation.
      for (let retry = 0; retry < 8; retry++) {
        const run = await current();
        if (run.inputBinding) {
          if (canonicalJson(run.inputBinding) !== canonicalJson(binding)) throw Error('Runtime input binding changed');
          return;
        }
        const receipt = await control.runFact(buildRunFactCommand({ ...common('input-' + envelope.runRef.runId, run.revision),
          fact: { kind: 'runtime_input_bound', runRef: envelope.runRef, binding } }));
        if (receipt.status === 'committed') return;
        if (receipt.code !== 'revision_conflict' && receipt.code !== 'duplicate_event') throw Error('Runtime input binding refused: ' + receipt.code);
      }
      throw Error('Runtime input binding remained busy');
    },
    async beforeCall(input) {
      const permitId = modelRequestPermitIdFor(envelope.runRef, input.requestId);
      const ref = modelRequestPermitRefFor(envelope.projectId, envelope.workspaceId, permitId);
      for (let retry = 0; retry < 8; retry++) {
        const run = await current();
        const prior = await ledger.load(ref);
        if (prior.status === 'not_found') {
          if (!control.authorizeModelRequest) throw Error('Model authorization is unavailable');
          const receipt = await control.authorizeModelRequest(buildAuthorizeModelRequestCommand({
            ...common('authorize-' + permitId, run.revision), workspaceId: envelope.workspaceId,
            goalId: envelope.goalId, permitId, ...input,
          }));
          if (receipt.status !== 'committed') {
            if (receipt.code === 'revision_conflict' || receipt.code === 'duplicate_event') continue;
            throw Error('Model authorization refused: ' + receipt.code);
          }
        } else {
          const permit = (prior.snapshot as ModelRequestPermitSnapshot).permit;
          if (permit.consumedByAttemptId !== null) throw Error('Model request already attempted; replay cannot call provider');
          if (permit.requestId !== input.requestId || permit.requestDigest !== input.requestDigest ||
              permit.contextInputDigest !== input.contextInputDigest || permit.manifestDigest !== input.manifestDigest) {
            throw Error('Model request differs from its issued permit');
          }
        }
        const fresh = await current();
        if (!fresh.inputBinding) throw Error('Runtime input is not bound');
        const consumed = await control.runFact(buildRunFactCommand({ ...common('attempt-' + permitId, fresh.revision),
          fact: { kind: 'model_request_evidence', runRef: envelope.runRef, permitId,
            attemptId: input.requestId, requestDigest: input.requestDigest, contextInputDigest: input.contextInputDigest,
            deliveryRefs: fresh.inputBinding.deliveryRefs, observedAt: deps.now() } }));
        if (consumed.status === 'committed' && !consumed.replayed) return;
        if (consumed.status === 'rejected' && consumed.code === 'revision_conflict') continue;
        throw Error('Model attempt refused; provider was not called: ' + (consumed.status === 'rejected' ? consumed.code : 'replayed'));
      }
      throw Error('Model authorization remained busy; provider was not called');
    },
  };
}
