import type { ControlEngineDeps } from './control-engine.js';
import type { ReconcileRunCommand, RunFactReceipt, RunSnapshot, RunReconciliationV1, TaskAttemptSnapshot } from '../../contracts/dispatch.js';
import { runtimeEventTerminalOutcome, taskAttemptRefFor } from '../../contracts/dispatch.js';
import { canonicalJson, sha256Hex } from '../../contracts/fingerprint.js';
import { foldRunReconciliation } from '../../contracts/run-reconciliation.js';
import type { RunFactLedgerCommitV1 } from '../../contracts/ledger.js';

/** Caller requests inspection only. The trusted Host observation port supplies
 * the persisted terminal event; neither an agent nor the command supplies proof. */
export async function reconcileRun(deps: ControlEngineDeps, command: ReconcileRunCommand): Promise<RunFactReceipt> {
  const reject = (code: 'invalid' | 'not_found' | 'revision_conflict' | 'after_terminal' | 'duplicate_event' | 'unavailable'): RunFactReceipt => ({ status: 'rejected', commandId: command.commandId, code });
  if (command.schemaVersion !== 1 || command.commandType !== 'ReconcileRun' || command.identity.actor.kind !== 'system' ||
      command.payload.runRef.projectId !== command.identity.projectId || command.payload.runRef.runId !== command.aggregateId) return reject('invalid');
  const loaded = await deps.ledger.load(command.payload.runRef);
  if (loaded.status !== 'found') return reject('not_found');
  const prior = loaded.snapshot as RunSnapshot;
  if (prior.revision !== command.expectedRevision) return reject('revision_conflict');
  if (prior.status !== 'ended' || prior.outcome !== 'outcome_unknown') return reject('after_terminal');
  const record = deps.runtimeObservation?.all().find(r => r.spec.projectId === prior.ref.projectId && r.spec.goalId === prior.ref.goalId &&
    r.spec.runId === prior.ref.runId && r.spec.workspaceId === prior.workspaceSnapshot.workspaceId);
  const terminal = record?.events.find(e => runtimeEventTerminalOutcome(e) !== null && e.sequence > prior.lastEventSeq && canonicalJson(e.runRef) === canonicalJson(prior.ref));
  const observation: RunReconciliationV1['observation'] = terminal
    ? { kind: 'runtime_terminal', event: structuredClone(terminal), digest: sha256Hex(canonicalJson(terminal)) }
    : { kind: 'unresolved', reason: 'No verifiable terminal receipt for the entered execution; quarantined without replay' };
  if (prior.reconciliation && canonicalJson(prior.reconciliation.observation) === canonicalJson(observation)) return reject('duplicate_event');
  const now = deps.now(), run = foldRunReconciliation(prior, observation, now);
  if (!run) return reject('invalid');
  const batch: RunFactLedgerCommitV1 = { commitKind: 'run-fact', schemaVersion: 1, identity: command.identity,
    fingerprint: sha256Hex(canonicalJson(command)) as RunFactLedgerCommitV1['fingerprint'],
    expectedVersions: [{ ref: prior.ref, revision: prior.revision }], snapshots: [run], outboxIntents: [],
    events: [{ eventId: deps.eventId(), eventType: 'RunReconciled', schemaVersion: 1, projectId: prior.ref.projectId,
      workspaceId: prior.workspaceSnapshot.workspaceId, aggregateType: 'Run', aggregateId: prior.ref.runId, aggregateRevision: run.revision,
      causationId: command.commandId, correlationId: command.correlationId, idempotencyKey: command.identity.idempotencyKey,
      actor: command.identity.actor, occurredAt: now, payload: { run } }] };
  if (terminal) {
    const ref = taskAttemptRefFor(prior.ref.projectId, prior.task.goalId, prior.task.taskId, prior.attemptId);
    const loadedAttempt = await deps.ledger.load(ref);
    if (loadedAttempt.status !== 'found') return reject('not_found');
    const attempt = loadedAttempt.snapshot as TaskAttemptSnapshot;
    if (attempt.runId !== prior.ref.runId || attempt.endOutcome !== 'outcome_unknown') return reject('invalid');
    batch.expectedVersions.push({ ref, revision: attempt.revision });
    batch.snapshots.push({ ...attempt, revision: attempt.revision + 1, endOutcome: run.outcome, endedAt: run.endedAt });
  }
  const receipt = await deps.ledger.commit(batch);
  if (receipt.status !== 'committed') return reject(receipt.code === 'revision_conflict' ? 'revision_conflict' : receipt.code === 'unavailable' ? 'unavailable' : 'invalid');
  return { status: 'committed', commandId: command.commandId, replayed: false, runRef: run.ref, runRevision: run.revision,
    applied: { kind: 'outcome_reconciled' }, terminal: true, eventIds: receipt.eventIds, commitCursor: receipt.commitCursor };
}
