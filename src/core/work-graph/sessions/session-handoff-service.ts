/**
 * The handoff owner's accept: `handoff.accept` records a handoff operation (the `handoff` arm of `CoreOperation`) at
 * revision 1, phase `accepted`, through the shared write executor. Nothing else moves: the source keeps its work and
 * its tasks until the later steps run.
 *
 * The refusal order is `state/session-handoff.ts admitHandoff`: the caller, the scope and the shape are checked before
 * the command's identity is hashed; the source, the targets, their duties and the unfinished operations of the source
 * are read inside the command, so a replay of a committed accept never reads them. The source and each `existing`
 * target are read through the public Session read, so a Session of another project or workspace is not found. A
 * refusal writes nothing.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import { principalIdentity } from '../../../contracts/core/call-context.js';
import type { SessionRef, VersionPin, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { OperationRef } from '../../../contracts/core/operations.js';
import { rejected, rejectedWithCurrent } from '../../../contracts/core/rejections.js';
import type { CoreRejection, WriteResult } from '../../../contracts/core/results.js';
import type { TaskTriple } from '../../../contracts/dispatch.js';
import type { JsonValue } from '../../../contracts/fingerprint.js';
import type { PlatformDutyV1 } from '../../../contracts/platform-duty.js';
import { isRecord } from '../../../contracts/validation/common.js';
import { checkShape } from '../../../contracts/validation/data-format.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { EncodedRecord, GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { SessionDirectoryPort, SessionOperationRecordOf } from '../model/session-contracts.js';
import { HandoffActionShape, type HandoffActionV1 } from '../model/session-operation-arms.js';
import type { SessionDutyReadPort } from '../model/work-line-contracts.js';
import { executeWriteCommand, type Keys } from '../persistence/command-executor.js';
import { lookupAll } from '../persistence/lookup-all.js';
import { ownerReadStoreFailureToRejection } from '../persistence/read-result-failures.js';
import { sameRef } from '../state/ref-equality.js';
import {
  admitHandoff, newHandoffOperationRecord, type HandoffAdmissionFactsV1, type OperationAdmissionV1,
  type OperationSessionFactV1,
} from '../state/session-handoff.js';
import {
  CORE_OPERATION_BY_WORKSPACE_PHASE_LOOKUP, decodeSessionOperationRecord, encodeSessionOperationRecord, operationRefKey,
  plainSessionRefKey, sessionHandoffRecordedCodec,
} from './session-record-codecs.js';
import { eventIdOf, trustedContext } from './trusted-context.js';

export type HandoffAcceptInputV1 = {
  commandId: string; workspace: WorkspaceScope; source: SessionRef;
  trigger: 'too_long' | 'manual';
  assignments: { target: { kind: 'create'; duty: PlatformDutyV1 } | { kind: 'existing'; session: SessionRef }; tasks: TaskTriple[] }[];
};
export type HandoffAcceptResultV1 = WriteResult<{ operation: OperationRef; stage: 'accepted'; phase: 'accepted' }>;
export interface SessionHandoffPort {
  acceptHandoff(ctx: CoreCallContext, input: HandoffAcceptInputV1): Promise<HandoffAcceptResultV1>;
}

const OPERATION = 'handoff.accept';
type ReadFacts = NonNullable<HandoffAdmissionFactsV1['read']>;
type AcceptFacts = { read: ReadFacts; sourceRevision: number | null };
type AcceptedEvent = Extract<ReturnType<typeof sessionHandoffRecordedCodec.decode>, { status: 'decoded' }>['value'];

/** The operation id of one accept: the identity key's hash part, so a replay names the same operation. */
function handoffOperationId(keys: Keys): string {
  return `session-handoff-${keys.identityKey.slice(OPERATION.length + 1)}`;
}

function admissionRejection(admitted: Exclude<OperationAdmissionV1, { ok: true }>): CoreRejection {
  return rejectedWithCurrent(admitted.code, admitted.detail, admitted.current);
}

export function createSessionHandoffService(deps: {
  records: GoalRecordTransactionPort & RecordLookupPort; sessions: Pick<SessionDirectoryPort, 'readSession'>;
  duty: SessionDutyReadPort; now: () => string;
}): SessionHandoffPort {
  /**
   * A Session the handoff names, through the public Session read in the call's project and workspace (anything else
   * is not found), with the revision the read saw.
   */
  async function sessionFact(ctx: CoreCallContext, ref: SessionRef):
    Promise<{ status: 'ready'; fact: OperationSessionFactV1; revision: number | null } | CoreRejection> {
    const read = await deps.sessions.readSession(ctx, ref);
    if (read.status === 'not_found') return { status: 'ready', fact: { kind: 'missing' }, revision: null };
    if (read.status === 'rejected') return read;
    if (read.status !== 'ready') return rejected('unavailable', 'a handoff Session read is not ready');
    const { record } = read.value;
    const duty = await deps.duty(record.role, ctx);
    return { status: 'ready', revision: record.revision, fact: { kind: 'present', archived: record.lifecycle === 'archived',
      readonlyCopy: record.provenance.kind === 'readonly_copy', duty: duty.status === 'ready' ? duty.value : 'unknown' } };
  }

  async function readHandoffFacts(ctx: CoreCallContext, input: HandoffAcceptInputV1):
    Promise<{ status: 'ready'; facts: AcceptFacts } | CoreRejection> {
    const scope = input.workspace;
    const source = await sessionFact(ctx, input.source);
    if (source.status !== 'ready') return source;
    const targets: ReadFacts['targets'][number][] = [];
    for (const { target } of input.assignments) {
      if (target.kind === 'create') {
        targets.push(target);
        continue;
      }
      const existing = await sessionFact(ctx, target.session);
      if (existing.status !== 'ready') return existing;
      targets.push({ kind: 'existing', session: existing.fact });
    }
    const unfinished: VersionPin[] = [];
    for (const phase of ['accepted', 'running'] as const) {
      let items: readonly EncodedRecord[];
      try {
        items = (await lookupAll(deps.records, CORE_OPERATION_BY_WORKSPACE_PHASE_LOOKUP,
          [scope.projectId, scope.workspaceId, phase])).items;
      } catch (failure) {
        return ownerReadStoreFailureToRejection(failure as { code: string; reason: string });
      }
      for (const encoded of items) {
        const decoded = decodeSessionOperationRecord(encoded);
        if (decoded.status !== 'decoded') return rejected('unavailable', `an unfinished operation is damaged: ${decoded.reason}`);
        const operation = decoded.value;
        if (operation.action.kind !== 'create' && sameRef(operation.action.input.source, input.source)) {
          unfinished.push({ ref: operation.ref, revision: operation.revision });
        }
      }
    }
    return { status: 'ready', facts: { read: { source: source.fact, targets, unfinished }, sourceRevision: source.revision } };
  }

  return {
    async acceptHandoff(ctx, rawInput) {
      const trusted = trustedContext(ctx, 'a handoff');
      if (!trusted.ok) return trusted.rejection;
      let input: HandoffAcceptInputV1;
      try {
        input = structuredClone(rawInput);
      } catch {
        return rejected('invalid', 'the handoff input cannot be copied');
      }
      const given: Partial<HandoffAcceptInputV1> = isRecord(input) ? input : {};
      const actor = { kind: trusted.actor.kind, id: trusted.actor.id };
      // The action as it would be stored: the shape is checked before anything is hashed or read. The write command
      // puts its own input fingerprint in place of the placeholder, so the check cannot depend on it.
      const actionOf = (fingerprint: string): HandoffActionV1['input'] => ({ workspace: given.workspace!, source: given.source!,
        trigger: given.trigger!, actor, assignments: given.assignments!, commandId: given.commandId!, fingerprint });
      let candidate: unknown;
      try {
        candidate = newHandoffOperationRecord({ ref: null, at: '', input: actionOf('0'.repeat(64)) }).action;
      } catch {
        candidate = { kind: 'handoff', input: actionOf('0'.repeat(64)), progress: null };
      }
      const workspace: unknown = given.workspace;
      const early: HandoffAdmissionFactsV1 = {
        caller: trusted.actor.kind === 'human' ? 'host_human' : 'host_system',
        trigger: given.trigger,
        inScope: isRecord(workspace) && workspace['projectId'] === trusted.scope.projectId
          && workspace['workspaceId'] === trusted.scope.workspaceId,
        shapeProblem: checkShape(HandoffActionShape, candidate, 'stored'),
        read: null,
      };
      const precheck = admitHandoff(early);
      if (!precheck.ok) return admissionRejection(precheck);

      const result = await executeWriteCommand<AcceptFacts, AcceptFacts, CoreRejection, AcceptedEvent,
        { operation: OperationRef; stage: 'accepted'; phase: 'accepted' }>(deps.records, {
        operation: OPERATION,
        scope: { projectId: input.workspace.projectId, workspaceId: input.workspace.workspaceId },
        principal: principalIdentity(ctx.principal),
        commandId: input.commandId,
        fingerprintInput: { source: input.source, trigger: input.trigger, assignments: input.assignments } as unknown as JsonValue,
        read: () => readHandoffFacts(ctx, input),
        decide(facts) {
          const admitted = admitHandoff({ ...early, read: facts.read });
          return admitted.ok ? { decision: facts } : { refuse: admissionRejection(admitted) };
        },
        build(facts, keys) {
          const ref: OperationRef = { aggregateType: 'CoreOperation', projectId: input.workspace.projectId,
            operationId: handoffOperationId(keys) };
          const at = deps.now();
          const record: SessionOperationRecordOf<HandoffActionV1> = newHandoffOperationRecord({ ref, at,
            input: actionOf(keys.fingerprint) });
          return {
            // The operation is new; the source is pinned at the revision the facts read.
            guards: [{ refKey: operationRefKey(ref), expectedRevision: null },
              { refKey: plainSessionRefKey(input.source), expectedRevision: facts.sourceRevision }],
            records: [encodeSessionOperationRecord(record)],
            claims: [],
            events: [sessionHandoffRecordedCodec.encode({ eventId: eventIdOf(keys.identityKey, 'accepted'),
              eventType: 'SessionHandoffRecorded', schemaVersion: 1, occurredAt: at, projectId: ref.projectId,
              workspaceId: record.workspaceId, operationRef: ref, revision: record.revision, phase: record.phase,
              action: record.action })],
          };
        },
        result: {
          eventType: 'SessionHandoffRecorded',
          schemaVersion: 1,
          decode: event => sessionHandoffRecordedCodec.decode(event),
          validate(event, _receipt, keys) {
            if (event.operationRef.operationId !== handoffOperationId(keys)) return 'the event records another operation';
            if (event.revision !== 1) return 'the event is not the first revision';
            return event.phase === 'accepted' && event.action.progress.stage === 'accepted' ? null
              : 'the event is not an accepted handoff';
          },
          project: event => ({ operation: event.operationRef, stage: 'accepted', phase: 'accepted' }),
        },
      });
      if (result.status === 'committed') {
        return { status: 'committed', value: result.value, replayed: result.replayed, cursor: result.cursor };
      }
      if (result.status === 'refused') return result.refusal;
      return rejectedWithCurrent(result.code, result.reason, result.current);
    },
  };
}
