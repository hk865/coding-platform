import type { StateLedger } from '../../../contracts/ledger.js';
import type { ControlEngine } from '../../../contracts/modules.js';
import type { DispatchOutboxEntrySnapshot, RunSnapshot } from '../../../contracts/dispatch.js';
import { buildRunFactCommand } from '../../../contracts/commands/dispatch.js';

/** Retry only a known pre-entry failure. Ledger owns its delay/quarantine policy. */
export async function deferDispatch(deps: { ledger: Pick<StateLedger, 'load'>; control: Pick<ControlEngine, 'runFact'>; now?: () => string }, entry: DispatchOutboxEntrySnapshot, reason: string): Promise<string | undefined> {
  const loaded = await deps.ledger.load(entry.intent.runRef);
  if (loaded.status !== 'found' || (loaded.snapshot as RunSnapshot).envelope) return;
  const receipt = await deps.control.runFact(buildRunFactCommand({
    actor: { kind: 'system', id: 'dispatch' }, projectId: entry.intent.projectId,
    runId: entry.intent.runRef.runId, expectedRevision: loaded.snapshot.revision,
    commandId: 'defer-' + entry.intent.intentId + '-' + entry.revision,
    idempotencyKey: 'defer-' + entry.intent.intentId + '-' + entry.revision,
    correlationId: entry.intent.correlationId, submittedAt: (deps.now ?? (() => new Date().toISOString()))(),
    fact: { kind: 'dispatch_deferred', runRef: entry.intent.runRef, reason },
  }));
  if (receipt.status !== 'committed') return receipt.code;
}
