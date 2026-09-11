import type { ActorRef, CommandIdentity, CommandFingerprint } from './command-event.js';
import type { ExpectedVersion, WorkspaceSnapshot } from './ledger.js';
import { canonicalJson, sha256Hex } from './fingerprint.js';

export type RegisterWorkspaceCommand = { schemaVersion: 1; commandType: 'RegisterWorkspace'; commandId: string; identity: CommandIdentity;
  expectedProjectRevision: number; workspaceId: string; bindingDigest: string; correlationId: string; submittedAt: string };
export type WorkspaceRegisteredEvent = { schemaVersion: 1; eventType: 'WorkspaceRegistered'; eventId: string; projectId: string; workspaceId: string;
  aggregateType: 'Workspace'; aggregateId: string; aggregateRevision: 1; causationId: string; correlationId: string; idempotencyKey: string; actor: ActorRef; occurredAt: string;
  payload: { sourceDigest: string; projectRevision: number } };
export type WorkspaceRegisterLedgerCommitV1 = { schemaVersion: 1; commitKind: 'workspace-register'; identity: CommandIdentity; fingerprint: CommandFingerprint;
  expectedVersions: ExpectedVersion[]; events: [WorkspaceRegisteredEvent]; snapshots: [WorkspaceSnapshot]; outboxIntents: [] };
export function workspaceRegistrationFingerprint(command: Pick<RegisterWorkspaceCommand, 'identity' | 'workspaceId' | 'bindingDigest'>): CommandFingerprint {
  return sha256Hex(canonicalJson({ kind: 'RegisterWorkspace', projectId: command.identity.projectId, actor: command.identity.actor, workspaceId: command.workspaceId, bindingDigest: command.bindingDigest })) as CommandFingerprint;
}
export function validWorkspaceRegistrationCommit(batch: WorkspaceRegisterLedgerCommitV1): boolean {
  try {
    const event = batch.events[0], snapshot = batch.snapshots[0], id = batch.identity;
    const validId = (value: unknown) => typeof value === 'string' && value.trim().length > 0 && value.length <= 256 && !value.includes('\0');
    if (batch.schemaVersion !== 1 || id.actor.kind !== 'human' || !validId(id.actor.id) || !validId(id.projectId) || !validId(id.idempotencyKey) || batch.events.length !== 1 || batch.snapshots.length !== 1 || batch.outboxIntents.length !== 0 || !validId(event.eventId) || !validId(event.workspaceId) || !validId(event.causationId) || !validId(event.correlationId) || !Number.isFinite(Date.parse(event.occurredAt))) return false;
    if (event.schemaVersion !== 1 || event.eventType !== 'WorkspaceRegistered' || event.projectId !== id.projectId || event.aggregateType !== 'Workspace' || event.aggregateId !== event.workspaceId || event.aggregateRevision !== 1 || event.idempotencyKey !== id.idempotencyKey || canonicalJson(event.actor) !== canonicalJson(id.actor)) return false;
    if (!/^[a-f0-9]{64}$/.test(event.payload.sourceDigest) || !Number.isSafeInteger(event.payload.projectRevision) || event.payload.projectRevision < 1) return false;
    const ref = { aggregateType: 'Workspace' as const, projectId: id.projectId, workspaceId: event.workspaceId };
    return canonicalJson(snapshot) === canonicalJson({ ref, revision: 1 }) &&
      canonicalJson(batch.expectedVersions) === canonicalJson([{ ref: { aggregateType: 'Project', projectId: id.projectId }, revision: event.payload.projectRevision }, { ref, revision: 0 }]) &&
      batch.fingerprint === workspaceRegistrationFingerprint({ identity: id, workspaceId: event.workspaceId, bindingDigest: event.payload.sourceDigest });
  } catch { return false; }
}
