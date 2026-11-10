/**
 * The one guarded single write of a `role_line` operation and the one "a step's child creation -> its planned
 * Session" read. The line driver (`role-line-operations.ts`) and the cold-start driver (`cold-start-service.ts`) both
 * use them. They live in their own file because `session-directory.ts` imports the cold-start birth and
 * `role-line-operations.ts` imports `session-directory.ts`: kept in the driver, they would close that loop.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { OperationRef } from '../../../contracts/core/operations.js';
import type { ReadResult, WriteResult } from '../../../contracts/core/results.js';
import { rejectedWithCurrent } from '../../../contracts/core/rejections.js';
import { canonicalKey, type JsonValue } from '../../../contracts/fingerprint.js';
import type { ActorRef } from '../../../contracts/command-event.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import {
  executeWriteCommand, type CommitFragment, type CommittedReceipt, type Keys,
} from '../persistence/command-executor.js';
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { DecodeResult } from '../../record-store/ports.js';
import type { RoleLineOperationV1, SessionDirectoryPort } from '../model/session-contracts.js';
import { roleLineOperationChangedCodec } from './role-line-orchestration-codecs.js';
import { encodeSessionOperationRecord, operationRefKey } from './session-record-codecs.js';
import { eventIdOf, trustedContext } from './trusted-context.js';

/**
 * The one committed shape of a `role_line` operation: the record, the `RoleLineOperationChanged` event and the
 * result projection. `writeRoleLineOperation` and the exploration control's deferred read/decide commands both use
 * it, so the record construction is never copied. `current` is read at build and validate time, after the executor
 * has looked up the receipt and run the owner's decision.
 */
type RoleLineChangedDecoded = { revision: number; operationRef: OperationRef };
export function roleLineOperationCommit(
  deps: { now(): string }, actor: ActorRef,
  current: () => { prior: RoleLineOperationV1 | null; next: RoleLineOperationV1 | null; extra?: CommitFragment },
): {
  build: (decision: null, keys: Keys) => CommitFragment;
  result: {
    eventType: string; schemaVersion: number;
    decode: (event: unknown) => DecodeResult<RoleLineChangedDecoded>;
    validate: (decoded: RoleLineChangedDecoded, receipt: CommittedReceipt, keys: Keys) => string | null;
    project: (decoded: RoleLineChangedDecoded, cursor: CommitCursor) => { revision: number };
  };
} {
  return {
    build: (_decision, keys) => {
      const { prior, next, extra } = current();
      if (next === null) throw new Error('the role-line commit has no next record');
      return {
        records: [encodeSessionOperationRecord(next), ...(extra?.records ?? [])],
        claims: [...(extra?.claims ?? [])],
        events: [...(extra?.events ?? []), roleLineOperationChangedCodec.encode({
          eventId: eventIdOf(keys.identityKey, 'changed'), eventType: 'RoleLineOperationChanged', schemaVersion: 1,
          occurredAt: deps.now(), projectId: next.ref.projectId, workspaceId: next.workspaceId,
          actor, revision: next.revision, operationRef: next.ref })],
        guards: [{ refKey: operationRefKey(next.ref), expectedRevision: prior === null ? null : prior.revision },
          ...(extra?.guards ?? [])],
        ...(extra?.ledgerHorizon === undefined ? {} : { ledgerHorizon: extra.ledgerHorizon }),
        ...(extra?.commitCursorBindings === undefined ? {} : { commitCursorBindings: extra.commitCursorBindings }),
      };
    },
    result: { eventType: 'RoleLineOperationChanged', schemaVersion: 1,
      decode: (event) => roleLineOperationChangedCodec.decode(event as never),
      validate: (decoded, receipt, keys) => {
        // On a receipt replay the owner's `decide` never ran, so there is no fresh next record; the receipt identity
        // is the remaining check and the event's own operation ref is what the first commit wrote.
        const { next } = current();
        if (next !== null && canonicalKey(decoded.operationRef as unknown as JsonValue)
          !== canonicalKey(next.ref as unknown as JsonValue)) return 'the event records another operation';
        return receipt.identityKey === keys.identityKey ? null : 'the receipt belongs to another command';
      },
      project: (decoded) => ({ revision: decoded.revision }) },
  };
}

/**
 * The one guarded single write of a role_line operation (L-1: one `RoleLineOperationChanged` with its
 * `operationRef`, through `executeWriteCommand`; precedent `role-limits-service.ts`). A step write's identity is the
 * operation and its next revision, so a lost answer replays the receipt; the accepted write of a person command
 * carries the public command as its fingerprint. `extra` rides in the same commit (the terminal release, and record 5
 * on an adviser split's done write); its events go before the operation event, which stays last (the executor's
 * result event).
 */
export async function writeRoleLineOperation(
  deps: { records: GoalRecordTransactionPort; now(): string },
  ctx: CoreCallContext, prior: RoleLineOperationV1 | null, next: RoleLineOperationV1,
  command?: { commandId: string; fingerprintInput: JsonValue }, extra?: CommitFragment,
): Promise<WriteResult<{ revision: number }>> {
  const trusted = trustedContext(ctx, 'a role-line operation write');
  if (!trusted.ok) return trusted.rejection;
  const result = await executeWriteCommand(deps.records, {
    operation: 'role-line-operation',
    principal: ctx.principal as unknown as JsonValue,
    commandId: command?.commandId ?? `${next.ref.operationId}:${next.revision}`,
    scope: { projectId: next.ref.projectId, workspaceId: next.workspaceId },
    fingerprintInput: command?.fingerprintInput
      ?? ({ ref: next.ref, revision: next.revision, phase: next.phase, action: next.action } as unknown as JsonValue),
    read: async () => ({ status: 'ready' as const, facts: null }),
    decide: (): { refuse: never } | { decision: null } => ({ decision: null }),
    ...roleLineOperationCommit(deps, trusted.actor, () =>
      ({ prior, next, ...(extra === undefined ? {} : { extra }) })),
  });
  if (result.status === 'refused') return result.refusal;
  if (result.status === 'rejected') return rejectedWithCurrent(result.code, result.reason, result.current);
  return { status: 'committed', value: result.value, replayed: result.replayed, cursor: result.cursor };
}

/** A step's committed child creation -> its planned Session (the create operation's own ref); no child yet: `null`. */
export async function roleLineStepSession(operations: Pick<SessionDirectoryPort, 'getSessionOperation'>,
  ctx: CoreCallContext, step: { childOperation: OperationRef | null }): Promise<ReadResult<SessionRef | null>> {
  const child = step.childOperation;
  if (child === null) return { status: 'ready', value: null };
  const read = await operations.getSessionOperation(ctx, child);
  if (read.status !== 'ready') return read;
  return { status: 'ready', value: read.value.action.kind === 'create' ? read.value.action.plannedSessionRef : null };
}
