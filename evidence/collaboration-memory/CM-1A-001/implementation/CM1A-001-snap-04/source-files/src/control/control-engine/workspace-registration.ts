import type { StateLedger, LedgerCommitReceipt } from '../../contracts/ledger.js';
import type { CommitCursor } from '../../contracts/command-event.js';
import { validWorkspaceRegistrationCommit, workspaceRegistrationFingerprint, type RegisterWorkspaceCommand, type WorkspaceRegisterLedgerCommitV1 } from '../../contracts/workspace-registration.js';

/** Register one explicitly mounted workspace in an existing project. Initial
 * bootstrap stays only-if-empty; registration never rewrites its manifest. */
export async function registerWorkspace(ledger: StateLedger, command: RegisterWorkspaceCommand): Promise<LedgerCommitReceipt> {
  const ref = { aggregateType: 'Workspace' as const, projectId: command.identity.projectId, workspaceId: command.workspaceId };
  const prior = await ledger.load(ref);
  let registration: import('../../contracts/workspace-registration.js').WorkspaceRegisteredEvent | undefined;
  if (prior.status === 'found') {
    let cursor: CommitCursor | null = null;
    for (;;) { const page = await ledger.events({ afterCursor: cursor, limit: 256 }); registration = page.events.map(item => item.event).find((event): event is import('../../contracts/workspace-registration.js').WorkspaceRegisteredEvent => event.eventType === 'WorkspaceRegistered' && event.projectId === ref.projectId && event.workspaceId === ref.workspaceId);
      if (registration || !page.hasMore) break; cursor = page.throughCursor; }
    if (!registration || registration.payload.sourceDigest !== command.bindingDigest) return { status: 'rejected', code: 'idempotency_conflict' };
  }
  const project = await ledger.load({ aggregateType: 'Project', projectId: command.identity.projectId });
  if (project.status !== 'found') return { status: 'rejected', code: 'invalid_commit' };
  const revision = registration?.payload.projectRevision ?? command.expectedProjectRevision;
  const batch: WorkspaceRegisterLedgerCommitV1 = { schemaVersion: 1, commitKind: 'workspace-register', identity: command.identity, fingerprint: workspaceRegistrationFingerprint(command),
    expectedVersions: [{ ref: project.snapshot.ref, revision }, { ref, revision: 0 }], snapshots: [{ ref, revision: 1 }], outboxIntents: [],
    events: [{ schemaVersion: 1, eventType: 'WorkspaceRegistered', eventId: command.commandId, projectId: ref.projectId, workspaceId: ref.workspaceId, aggregateType: 'Workspace', aggregateId: ref.workspaceId, aggregateRevision: 1,
      causationId: command.commandId, correlationId: command.correlationId, idempotencyKey: command.identity.idempotencyKey, actor: command.identity.actor, occurredAt: command.submittedAt, payload: { sourceDigest: command.bindingDigest, projectRevision: revision } }] };
  if (!validWorkspaceRegistrationCommit(batch)) return { status: 'rejected', code: 'invalid_commit' };
  return ledger.commit(batch);
}
