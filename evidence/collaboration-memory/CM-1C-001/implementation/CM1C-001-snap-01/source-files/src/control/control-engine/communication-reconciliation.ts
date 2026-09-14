import type { ControlEngineDeps } from './control-engine.js';
import { communicationIntentRefFor, type ReconcileCommunicationIntentCommand, type CommunicationWriteReceipt, type CommunicationIntentSnapshot, type CommunicationIntentReconcileCommitV1 } from '../../contracts/coordination.js';
import { quarantineCommunicationIntent } from '../../contracts/communication-reconciliation.js';
import { communicationIntentSettledEvent } from '../../contracts/coordination-events.js';
import { canonicalJson, sha256Hex } from '../../contracts/fingerprint.js';

export async function reconcileCommunicationIntent(deps: ControlEngineDeps, command: ReconcileCommunicationIntentCommand): Promise<CommunicationWriteReceipt> {
  const reject = (code: 'invalid' | 'not_found' | 'forbidden' | 'revision_conflict' | 'unavailable'): CommunicationWriteReceipt => ({ status: 'rejected', commandId: command.commandId, code });
  if (command.schemaVersion !== 1 || command.commandType !== 'ReconcileCommunicationIntent' || !command.commandId ||
      !command.payload.workspaceId || !command.aggregateId || !command.correlationId || command.identity.actor.kind !== 'system') return reject('invalid');
  const ref = communicationIntentRefFor(command.identity.projectId, command.payload.workspaceId, command.aggregateId);
  const loaded = await deps.ledger.load(ref);
  if (loaded.status !== 'found') return reject('not_found');
  const prior = loaded.snapshot as CommunicationIntentSnapshot;
  if (prior.revision !== command.expectedRevision) return reject('revision_conflict');
  const at = deps.now(), next = quarantineCommunicationIntent(prior, at);
  if (!next) return reject('forbidden');
  const batch: CommunicationIntentReconcileCommitV1 = { schemaVersion: 1, commitKind: 'communication-intent-reconcile',
    identity: command.identity, fingerprint: sha256Hex(canonicalJson(command)) as CommunicationIntentReconcileCommitV1['fingerprint'],
    expectedVersions: [{ ref, revision: prior.revision }], snapshots: [next], outboxIntents: [],
    events: [communicationIntentSettledEvent({ ...command, occurredAt: at }, deps.eventId(), next.intent, next.revision)] };
  const receipt = await deps.ledger.commit(batch);
  if (receipt.status !== 'committed') return reject(receipt.code === 'revision_conflict' ? 'revision_conflict' : receipt.code === 'unavailable' ? 'unavailable' : 'invalid');
  return { status: 'committed', commandId: command.commandId, replayed: receipt.replayed, revisions: [{ refKey: canonicalJson(ref), revision: next.revision }], eventIds: receipt.eventIds, commitCursor: receipt.commitCursor };
}
