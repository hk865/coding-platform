/**
 * Slice 6A §3.4.7, ruling 4.7 (decision 72): the one line-creation entry.
 *
 * A caller asks for a Session line with a stable `commandId`. The entry reads
 * the admitted Session-creation operation by the SAME stable identity the
 * Session directory derives (`stableSessionCreationIdentity`), replays it when
 * it exists, and admits through the real `createSession`. Duty, scope, reason
 * and the creator from the trusted call context go into the first-phase
 * admission; the creator is never taken from the caller's input.
 *
 * `findLine` is the read-only half a retried request command uses before it
 * picks a secretary: it finds the operation's stored input, or `none`.
 */
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { RoleConfigurationRef, SessionRef } from '../../contracts/core/identity.js';
import type { OperationRef } from '../../contracts/core/operations.js';
import type { CoreRejection, OperationReceipt, ReadResult } from '../../contracts/core/results.js';
import type { SessionProvenanceV1, SessionRecord } from '../../contracts/core/session.js';
import type { TaskTriple } from '../../contracts/dispatch.js';
import type { PlatformDutyV1 } from '../../contracts/platform-duty.js';
import { rejected } from '../../contracts/core/rejections.js';
import { TaskTripleShape } from '../../contracts/data-format-refs.js';
import { checkShape } from '../../contracts/validation/data-format.js';
import type { SessionOperationsPort } from '../../core/agent-runtime/session-operations.js';
import type { SessionDirectoryPort, SessionOperationRecord } from '../../core/work-graph/model/session-contracts.js';
import { stableSessionCreationIdentity } from '../../core/work-graph/sessions/session-directory.js';
import { trustedContext } from '../../core/work-graph/sessions/trusted-context.js';

export type LineCreationInput = {
  commandId: string;
  duty: PlatformDutyV1;
  scope: { kind: 'project' } | { kind: 'task'; task: TaskTriple };
  reason: 'secretary_needed' | string;
  provenance: SessionProvenanceV1;
  roleConfiguration: RoleConfigurationRef;
  /** The creator's accepted permissions for a member-created line; absent is no ceiling. */
  delegationCeiling?: { tools: string[]; writeScope: string[]; createMember: boolean };
  /** Present only on a secretary-created executor; absent is not secretary-created. */
  secretaryCreated?: true;
  /** The source line this successor replaces; absent is null (ordinary creation normalizes to null). */
  replaces?: SessionRef | null;
  /** The handoff operation that creates this successor; absent is null. */
  parentOperation?: OperationRef | null;
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

export type LineCreationDependencies = {
  /** The real Session creation entry (`SessionOperationsPort.createSession`). */
  sessions: Pick<SessionOperationsPort, 'createSession'>;
  /** The directory's operation read; the same store admission writes. */
  operations: Pick<SessionDirectoryPort, 'getSessionOperation'>;
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
    const replaces = input.replaces ?? null;
    const parentOperation = input.parentOperation ?? null;
    let receipt: OperationReceipt<SessionRecord>;
    try {
      receipt = await deps.sessions.createSession(ctx, {
        workspace,
        role: input.roleConfiguration,
        recommendedRefs: [],
        // A task line starts as its Task's responsible holder; a project line opens none.
        initialLinks: input.scope.kind === 'task'
          ? [{ target: { kind: 'task', ref: input.scope.task }, relation: 'responsible' }]
          : [],
        meta: { requestId: input.commandId, expected: [] },
        provenance: input.provenance,
        // The creator is the trusted Host actor of THIS call, never the caller's field.
        creation: {
          duty: input.duty, scope: input.scope, reason: input.reason, creator: actor,
          ...(input.delegationCeiling === undefined ? {} : { delegationCeiling: input.delegationCeiling }),
          ...(input.secretaryCreated === undefined ? {} : { secretaryCreated: input.secretaryCreated }),
        },
        // The parent operation is the runtime request's own optional member; `replaces` is not, so it rides as the
        // one extra member the admission reads.
        parentOperation,
        ...({ replaces } as object),
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
    if (receipt.code === 'capacity') return { status: 'capacity_blocked', duty: input.duty };
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
      // A line names either the project or one Task; refused before any write.
      const scope: unknown = input.scope;
      const taskScope = typeof scope === 'object' && scope !== null
        && (scope as { kind?: unknown }).kind === 'task' ? (scope as { task?: unknown }).task : null;
      if (taskScope === null) {
        if (typeof scope !== 'object' || scope === null || (scope as { kind?: unknown }).kind !== 'project') {
          return { status: 'rejected', code: 'invalid', reason: 'a line scope is {kind:project} or {kind:task,task}' };
        }
      } else {
        const taskProblem = checkShape(TaskTripleShape, taskScope, 'stored');
        if (taskProblem !== null) {
          return { status: 'rejected', code: 'invalid',
            reason: `a task line scope requires a complete TaskTriple: ${taskProblem}` };
        }
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
        // Only a creation can be this line's operation; another arm is never replayed as one.
        if (existing.value.action.kind !== 'create') {
          return { status: 'rejected', code: 'unavailable', reason: 'the line operation is not a Session creation' };
        }
        // The caller replays with the input the operation stored (ruling 4.7);
        // the directory's identity+fingerprint then restores that operation.
        return admit(ctx, trusted.actor, input, true);
      }
      if (existing.status === 'not_ready') {
        return { status: 'rejected', code: 'unavailable', reason: 'the line operation read is not ready' };
      }
      if (existing.status !== 'not_found') return rejectedResult(existing);

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
      if (read.value.action.kind !== 'create') return rejected('unavailable', 'the line operation is not a Session creation');
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
            ...(creation.delegationCeiling === undefined ? {} : { delegationCeiling: creation.delegationCeiling }),
            ...(creation.secretaryCreated === undefined ? {} : { secretaryCreated: creation.secretaryCreated }),
            replaces: read.value.action.provenance.kind === 'handoff' ? read.value.action.provenance.from : null,
            parentOperation: read.value.action.parentOperation,
          },
        },
      };
    },
  };
}
