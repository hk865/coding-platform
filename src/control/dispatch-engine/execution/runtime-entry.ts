import type { StateLedger } from '../../../contracts/ledger.js';
import type { ControlEngine } from '../../../contracts/modules.js';
import type { DispatchIntentV1, RunSnapshot } from '../../../contracts/dispatch.js';
import type { TaskEnvelopeV1, ContextManifestV1 } from '../../../contracts/task-envelope.js';
import { buildDispatchStartCommand, buildRunFactCommand } from '../../../contracts/commands/dispatch.js';

type StartIdentity = Pick<Parameters<typeof buildDispatchStartCommand>[0], 'actor' | 'commandId' | 'idempotencyKey' | 'correlationId' | 'submittedAt'>;

/** Shared mechanical execution fence. Callers retain all domain qualification,
 * Context selection and preparation. Only an entered receipt permits Runtime. */
export async function authorizeRuntimeEntry(deps: {
  ledger: Pick<StateLedger, 'load'>; control: Pick<ControlEngine, 'startRun' | 'runFact'>; now: () => string;
}, input: {
  intent: DispatchIntentV1; envelope: TaskEnvelopeV1; manifest: ContextManifestV1;
  consumerId: string; identity: (revision: number) => StartIdentity;
}): Promise<{ status: 'entered' | 'replayed' } | { status: 'rejected'; code: string }> {
  const loaded = await deps.ledger.load(input.intent.runRef);
  if (loaded.status !== 'found') return { status: 'rejected', code: 'not_found' };
  const run = loaded.snapshot as RunSnapshot;
  // Recovery, not another caller, owns an already-issued or consumed permission.
  if (run.envelope !== null || run.status !== 'starting') return { status: 'replayed' };
  const start = await deps.control.startRun(buildDispatchStartCommand({ ...input.identity(run.revision),
    projectId: input.intent.projectId, runId: run.ref.runId, expectedRevision: run.revision,
    executionConsumerId: input.consumerId, envelope: input.envelope, manifest: input.manifest }));
  if (start.status !== 'committed') return { status: 'rejected', code: start.code };
  if (start.replayed) return { status: 'replayed' };
  const generation = (run.executionAuthorization?.generation ?? 0) + 1;
  const id = 'enter-' + input.intent.intentId + '-g' + generation;
  const entered = await deps.control.runFact(buildRunFactCommand({
    projectId: input.intent.projectId, actor: { kind: 'system', id: input.consumerId },
    commandId: id, idempotencyKey: id, correlationId: input.intent.correlationId, submittedAt: deps.now(),
    runId: run.ref.runId, expectedRevision: run.revision + 1,
    fact: { kind: 'execution_entered', runRef: run.ref, generation, consumerId: input.consumerId },
  }));
  if (entered.status !== 'committed' || entered.replayed) return { status: 'rejected', code: 'execution_fenced' };
  return { status: 'entered' };
}
