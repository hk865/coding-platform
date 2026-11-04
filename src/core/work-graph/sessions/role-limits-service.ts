/**
 * The project role-limits owner: the one read (`projects/role-limits`) and the one R2 command
 * (`projects/role-limits/set`). The pure expected-revision check, partial merge and complete next record live in
 * `state/role-limits.ts`; this file reads the record, checks the candidate with its codec and encodes the decision.
 *
 * A capacity card's cap raise carries the decision proof on the limits event; after every committed set (a replay
 * included) each duty's stale capacity episode is closed, because a moved cap is what makes an episode stale.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ProjectScope, VersionPin } from '../../../contracts/core/identity.js';
import type { OperationRef } from '../../../contracts/core/operations.js';
import type { ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import { rejected, rejectedWithCurrent } from '../../../contracts/core/rejections.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { DecisionChangeProofV1 } from '../../../contracts/goal-decisions.js';
import { isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import {
  ROLE_LINE_DEFAULT_LIMITS, ROLE_LINE_DUTIES, type ProjectRoleLimitsV1, type RoleLimitsSetRequestV1,
  type RoleLimitsViewV1,
} from '../../../contracts/role-lines.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import { executeWriteCommand } from '../persistence/command-executor.js';
import { sessionStoreFailureToRejection } from '../persistence/read-result-failures.js';
import type { RoleCapacityPort } from '../state/role-line-reclaim.js';
import { projectRoleLimitsNext } from '../state/role-limits.js';
import { eventIdOf, trustedContext } from './trusted-context.js';
import { projectRoleLimitsChangedCodec, projectRoleLimitsCodec } from './role-line-record-codecs.js';

export type RoleLimitsServiceDependenciesV1 = {
  records: GoalRecordTransactionPort;
  now: () => Date;
  /** The capacity service's one close method; absent keeps the public set working (a project with no episode). */
  capacity?: Pick<RoleCapacityPort, 'closeIfStale'>;
};

export interface RoleLimitsPort {
  readRoleLimits(ctx: CoreCallContext, input: { projectRef: ProjectScope }): Promise<ReadResult<RoleLimitsViewV1>>;
  setRoleLimits(ctx: CoreCallContext, request: RoleLimitsSetRequestV1,
    options?: { answerRef: SessionMessageRef; capturedPins: readonly VersionPin[];
      /** The application's stable notice identity, `roleLineOperationRef(answerRef.projectId,
       *  'capacity-resolution', requestId)`; never read from the source or the episode. A public set passes none. */
      capacityOperation?: OperationRef }):
    Promise<WriteResult<RoleLimitsViewV1>>;
}

export function createRoleLimitsService(deps: RoleLimitsServiceDependenciesV1): RoleLimitsPort {
  async function readRoleLimits(
    _ctx: CoreCallContext, input: { projectRef: ProjectScope },
  ): Promise<ReadResult<RoleLimitsViewV1>> {
    const projectRef: ProjectScope = { projectId: input.projectRef.projectId };
    const key = canonicalJson(roleLimitsRef(projectRef.projectId) as unknown as JsonValue);
    const limits = await readLimitsForCommit(deps.records, key);
    if (limits.status !== 'ready') return limits;
    const current = limits.value.current;
    return { status: 'ready', value: current === null
      ? { projectRef, revision: 0, running: { ...ROLE_LINE_DEFAULT_LIMITS.running },
        open: { ...ROLE_LINE_DEFAULT_LIMITS.open } }
      : { projectRef: current.projectRef, revision: current.revision,
        running: { ...current.running }, open: { ...current.open } } };
  }

  async function setRoleLimits(
    ctx: CoreCallContext, request: RoleLimitsSetRequestV1, options?: Parameters<RoleLimitsPort['setRoleLimits']>[2],
  ): Promise<WriteResult<RoleLimitsViewV1>> {
    const trusted = trustedContext(ctx, 'a role-limits set');
    if (!trusted.ok) return trusted.rejection;
    if (!isRecord(request) || !nonEmpty(request.commandId) || !Number.isInteger(request.expectedRevision)) {
      return { status: 'rejected', code: 'invalid',
        reason: 'roleLimits.set requires commandId and an integer expectedRevision' };
    }
    const projectRef: ProjectScope = { projectId: trusted.scope.projectId };
    const key = canonicalJson(roleLimitsRef(projectRef.projectId) as unknown as JsonValue);
    const result = await executeWriteCommand(deps.records, {
      operation: ROLE_LIMITS_OPERATION,
      principal: ctx.principal,
      commandId: request.commandId,
      scope: { projectId: projectRef.projectId, workspaceId: trusted.scope.workspaceId },
      // Only the keys the request actually carries: the canonical serializer refuses `undefined` members.
      fingerprintInput: { projectRef, ...(request.running === undefined ? {} : { running: request.running }),
        ...(request.open === undefined ? {} : { open: request.open }),
        expectedRevision: request.expectedRevision } as unknown as JsonValue,
      read: async () => {
        const limits = await readLimitsForCommit(deps.records, key);
        if (limits.status === 'ready') return { status: 'ready', facts: limits.value };
        return limits.status === 'rejected' ? limits
          : { status: 'rejected', code: 'unavailable', reason: `the role limits read answered ${limits.status}` };
      },
      decide: facts => {
        const next = projectRoleLimitsNext(projectRef, facts.current, request);
        if (!next.ok) return { refuse: next.rejection };
        const problem = projectRoleLimitsCodec.check(next.decision.record);
        return problem === null ? { decision: next.decision }
          : { refuse: rejected('invalid', `the role limits are invalid: ${problem}`) };
      },
      build: (decision, keys) => {
        // A card application proves its one change: the limits record's revision before and after this commit.
        const proof: DecisionChangeProofV1 | undefined = options === undefined ? undefined : {
          acknowledgementRef: structuredClone(options.answerRef),
          capturedPins: options.capturedPins.map((pin) => ({ ref: structuredClone(pin.ref), revision: pin.revision })),
          changes: [{ before: { ref: structuredClone(decision.record.ref), revision: decision.revision - 1 },
            after: { ref: structuredClone(decision.record.ref), revision: decision.revision } }],
          basisRebases: [],
        };
        return {
          records: [projectRoleLimitsCodec.encode(decision.record)],
          claims: [],
          events: [projectRoleLimitsChangedCodec.encode({
            eventId: eventIdOf(keys.identityKey, 'changed'), eventType: 'ProjectRoleLimitsChanged',
            schemaVersion: 1, occurredAt: deps.now().toISOString(), projectId: projectRef.projectId,
            workspaceId: trusted.scope.workspaceId, from: decision.from, to: decision.to,
            actor: { kind: 'human', id: trusted.actor.id }, revision: decision.revision,
            ...(proof === undefined ? {} : { proof }) })],
          // `0` never reaches a stored revision: the first write's guard is absence.
          guards: [{ refKey: key, expectedRevision: decision.revision === 1 ? null : decision.revision - 1 }],
        };
      },
      result: { eventType: 'ProjectRoleLimitsChanged', schemaVersion: 1,
        decode: event => projectRoleLimitsChangedCodec.decode(event),
        // The event has no `operationRef`: the scope and the receipt are its whole proof.
        validate: (event, receipt, keys) => event.projectId !== projectRef.projectId
          || event.workspaceId !== trusted.scope.workspaceId ? 'the event records another scope'
          : receipt.identityKey === keys.identityKey ? null : 'the receipt belongs to another command',
        // The event's `revision` is the new record revision: a replay answers the same view after a later set.
        project: event => ({ projectRef, revision: event.revision,
          running: event.to.running, open: event.to.open }) },
    });
    if (result.status === 'refused') return result.refusal;
    if (result.status === 'rejected') return rejectedWithCurrent(result.code, result.reason, result.current);
    // Each stale episode closes in its own commit after the limits commit; a close refusal is the answer, and a
    // retry replays the limits and runs the closes again.
    for (const duty of ROLE_LINE_DUTIES) {
      const closed = await deps.capacity?.closeIfStale(ctx, {
        projectRef, duty, operation: options?.capacityOperation ?? null,
      });
      if (closed !== undefined && closed.status === 'rejected') return closed;
    }
    return { status: 'committed', value: result.value, replayed: result.replayed, cursor: result.cursor };
  }

  return { readRoleLimits, setRoleLimits };
}

const ROLE_LIMITS_OPERATION = 'roleLimits.set';
const roleLimitsRef = (projectId: string) => ({ aggregateType: 'ProjectRoleLimits' as const, projectId });

/** The limits record, or `current: null` for an absent key; damage is `unavailable`, never the defaults. */
async function readLimitsForCommit(
  records: Pick<GoalRecordTransactionPort, 'readMany'>, key: string,
): Promise<ReadResult<{ current: ProjectRoleLimitsV1 | null }>> {
  const read = await records.readMany([key]);
  if (read.status !== 'ready') return sessionStoreFailureToRejection(read);
  const stored = read.value.records.find((each) => each.refKey === key);
  if (stored === undefined) return { status: 'ready', value: { current: null } };
  const decoded = projectRoleLimitsCodec.decode(stored);
  if (decoded.status !== 'decoded') {
    return { status: 'rejected', code: 'unavailable', reason: `the role limits are damaged: ${decoded.reason}` };
  }
  return { status: 'ready', value: { current: decoded.value } };
}
