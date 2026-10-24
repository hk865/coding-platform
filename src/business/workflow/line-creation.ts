/**
 * Slice 6A §3.4.7, ruling 4.7 (decision 72): the one line-creation entry.
 *
 * A caller asks for a Session line with a stable `commandId`. The entry reads
 * the admitted Session-creation operation by the SAME stable identity the
 * Session directory derives (`stableSessionCreationIdentity`), replays it when
 * it exists, checks the injected capacity port only for a fresh line, and
 * admits through the real `createSession`. Duty, scope, reason and the creator
 * from the trusted call context go into the first-phase admission; the creator
 * is never taken from the caller's input.
 *
 * `findLine` is the read-only half a retried request command uses before it
 * picks a secretary: it finds the operation's stored input, or `none`.
 */
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { RoleConfigurationRef, SessionRef } from '../../contracts/core/identity.js';
import type { OperationRef } from '../../contracts/core/operations.js';
import type { CoreRejection, OperationReceipt, ReadResult } from '../../contracts/core/results.js';
import type { SessionProvenanceV1, SessionRecord } from '../../contracts/core/session.js';
import type { PlatformDutyV1 } from '../../contracts/platform-duty.js';
import { rejected } from '../../contracts/core/rejections.js';
import type { SessionOperationsPort } from '../../core/agent-runtime/session-operations.js';
import type { SessionDirectoryPort, SessionOperationRecord } from '../../core/work-graph/model/session-contracts.js';
import { stableSessionCreationIdentity } from '../../core/work-graph/sessions/session-directory.js';
import { trustedContext } from '../../core/work-graph/sessions/trusted-context.js';

export type LineCreationInput = {
  commandId: string;
  duty: PlatformDutyV1;
  scope: { kind: 'project' };
  reason: 'secretary_needed' | string;
  provenance: SessionProvenanceV1;
  roleConfiguration: RoleConfigurationRef;
};

export type LineCreationResultV1 =
  | { status: 'created' | 'replayed'; session: SessionRef }
  | { status: 'accepted'; operationRef: OperationRef }
  | { status: 'capacity_blocked'; duty: PlatformDutyV1 }
  | { status: 'rejected'; code: string; reason: string };

export type LineCreationLookupV1 = { status: 'none' } | { status: 'found'; input: LineCreationInput };

export interface LineCreationPort {
  ensureLine(ctx: CoreCallContext, input: LineCreationInput): Promise<LineCreationResultV1>;
  /** Ruling 4.7: read only, never writes and never counts against capacity. */
  findLine(ctx: CoreCallContext, input: { commandId: string }): Promise<ReadResult<LineCreationLookupV1>>;
}

export interface LineCapacityPort {
  admit(ctx: CoreCallContext, input: { duty: PlatformDutyV1; plannedSessionRef: SessionRef }):
    Promise<{ status: 'admitted' } | { status: 'full'; limit: number; used: number } | { status: 'unavailable'; reason: string }>;
}

/**
 * Slice 6A's production adapter: no real reservation cap exists before 7D1, so
 * every line is admitted. A Host `secretaryOpenCap` adapter (H, ruling 4.7)
 * replaces it at the composition root.
 */
export function createAlwaysAdmitCapacity(): LineCapacityPort {
  return { admit: async () => ({ status: 'admitted' }) };
}

export type LineCreationDependencies = {
  /** The real Session creation entry (`SessionOperationsPort.createSession`). */
  sessions: Pick<SessionOperationsPort, 'createSession'>;
  /** The directory's operation read; the same store admission writes. */
  operations: Pick<SessionDirectoryPort, 'getSessionOperation'>;
  capacity: LineCapacityPort;
};

function rejectedResult(rejection: CoreRejection): LineCreationResultV1 {
  return { status: 'rejected', code: rejection.code, reason: rejection.reason };
}

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createLineCreation(deps: LineCreationDependencies): LineCreationPort {
  /** The created/replaying call. `replayed` is fixed before it, from whether the operation already existed. */
  async function admit(
    ctx: CoreCallContext,
    actor: { kind: 'human' | 'system'; id: string },
    input: LineCreationInput,
    replayed: boolean,
  ): Promise<LineCreationResultV1> {
    const workspace = { projectId: ctx.projectId, workspaceId: ctx.workspaceId as string };
    let receipt: OperationReceipt<SessionRecord>;
    try {
      receipt = await deps.sessions.createSession(ctx, {
        workspace,
        role: input.roleConfiguration,
        recommendedRefs: [],
        initialLinks: [],
        meta: { requestId: input.commandId, expected: [] },
        provenance: input.provenance,
        // The creator is the trusted Host actor of THIS call, never the caller's field.
        creation: { duty: input.duty, scope: input.scope, reason: input.reason, creator: actor },
      });
    } catch (error) {
      return { status: 'rejected', code: 'unavailable', reason: `Session creation did not complete: ${errorReason(error)}` };
    }
    if (receipt.status === 'accepted') return { status: 'accepted', operationRef: receipt.operationRef };
    if (receipt.status === 'completed') {
      return {
        status: replayed ? 'replayed' : 'created',
        session: { projectId: receipt.value.ref.projectId, sessionId: receipt.value.ref.sessionId },
      };
    }
    return rejectedResult(receipt);
  }

  return {
    async ensureLine(ctx, input) {
      const trusted = trustedContext(ctx, 'line creation');
      if (!trusted.ok) return rejectedResult(trusted.rejection);
      if (input === null || typeof input !== 'object'
        || typeof input.commandId !== 'string' || input.commandId.length === 0) {
        return { status: 'rejected', code: 'invalid', reason: 'a line creation requires a non-empty commandId' };
      }
      // Slice 6A ruling 4.7: project scope only until 7D1; refused before any capacity count.
      const scope: unknown = input.scope;
      if (typeof scope !== 'object' || scope === null || (scope as { kind?: unknown }).kind !== 'project') {
        return { status: 'rejected', code: 'invalid', reason: 'a line scope is {kind:project} only' };
      }
      const stable = stableSessionCreationIdentity(trusted.actor, trusted.scope.projectId, input.commandId);

      // A replay is found BEFORE any capacity check: it must never consume a slot
      // or be refused by a cap that changed after the original admission.
      let existing: ReadResult<SessionOperationRecord>;
      try {
        existing = await deps.operations.getSessionOperation(ctx, stable.operationRef);
      } catch (error) {
        return { status: 'rejected', code: 'unavailable', reason: `the line operation could not be read: ${errorReason(error)}` };
      }
      if (existing.status === 'ready') {
        // The caller replays with the input the operation stored (ruling 4.7);
        // the directory's identity+fingerprint then restores that operation.
        return admit(ctx, trusted.actor, input, true);
      }
      if (existing.status === 'not_ready') {
        return { status: 'rejected', code: 'unavailable', reason: 'the line operation read is not ready' };
      }
      if (existing.status !== 'not_found') return rejectedResult(existing);

      let capacity: Awaited<ReturnType<LineCapacityPort['admit']>>;
      try {
        capacity = await deps.capacity.admit(ctx, { duty: input.duty, plannedSessionRef: stable.plannedSessionRef });
      } catch (error) {
        return { status: 'rejected', code: 'unavailable', reason: `line capacity could not be decided: ${errorReason(error)}` };
      }
      if (capacity.status === 'full') return { status: 'capacity_blocked', duty: input.duty };
      if (capacity.status === 'unavailable') return { status: 'rejected', code: 'unavailable', reason: capacity.reason };
      return admit(ctx, trusted.actor, input, false);
    },

    async findLine(ctx, { commandId }) {
      const trusted = trustedContext(ctx, 'line creation');
      if (!trusted.ok) return trusted.rejection;
      if (typeof commandId !== 'string' || commandId.length === 0) {
        return rejected('invalid', 'a line lookup requires a non-empty commandId');
      }
      const stable = stableSessionCreationIdentity(trusted.actor, trusted.scope.projectId, commandId);
      let read: ReadResult<SessionOperationRecord>;
      try {
        read = await deps.operations.getSessionOperation(ctx, stable.operationRef);
      } catch (error) {
        return rejected('unavailable', `the line operation could not be read: ${errorReason(error)}`);
      }
      if (read.status === 'not_found') return { status: 'ready', value: { status: 'none' } };
      if (read.status !== 'ready') return read;
      const creation = read.value.action.creation;
      // An operation with no line intent is not a line for a retried request command.
      if (creation === null) return { status: 'ready', value: { status: 'none' } };
      return {
        status: 'ready',
        value: {
          status: 'found',
          input: {
            commandId,
            duty: creation.duty,
            scope: creation.scope,
            reason: creation.reason,
            provenance: read.value.action.provenance,
            roleConfiguration: read.value.action.role,
          },
        },
      };
    },
  };
}
