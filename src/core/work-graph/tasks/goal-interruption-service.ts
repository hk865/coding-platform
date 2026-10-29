/**
 * The Goal interruption owner: one write command with a target status.
 *
 * `pending` writes the record unless a pending one already exists (then it answers `kept` and commits nothing);
 * `resumed` moves a pending record to `resumed` and writes nothing when it is absent or already resumed. No route
 * exposes it and it adds no principal check: the start-up reconcile calls it through its platform seam and the
 * collaboration driver's `onStarted` resolves the Goal's record.
 */
import { principalIdentity, type CoreCallContext } from '../../../contracts/core/call-context.js';
import type { CoreRejection } from '../../../contracts/core/results.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { GoalInterruptionV1 } from '../../../contracts/goal-interruption.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import { executeWriteCommand, type Keys } from '../persistence/command-executor.js';
import {
  goalInterruptionChangedCodec, goalInterruptionCodec,
  type GoalInterruptionChangedEventV1,
} from '../persistence/goal-interruption-codecs.js';
import {
  interruptionRefOf, pendingGoalInterruption, resumedGoalInterruption, type GoalInterruptionWriteV1,
  type PendingGoalInterruptionInputV1,
} from '../state/goal-interruption.js';
import { readGoalInterruption } from './plan-readers.js';

const OPERATION = 'goal.interruption';

export type GoalInterruptionWriteInputV1 =
  | (PendingGoalInterruptionInputV1 & { to: 'pending' })
  | { goalRef: GoalRef; to: 'resumed' };

export type GoalInterruptionWriteStatusV1 = 'recorded' | 'kept';

export type GoalInterruptionServiceDependencies = {
  records: GoalRecordTransactionPort;
  now(): string;
  hostInstanceId: string;
};

export function createGoalInterruptionService(deps: GoalInterruptionServiceDependencies):
{ writeGoalInterruption(ctx: CoreCallContext, input: GoalInterruptionWriteInputV1):
  Promise<{ status: GoalInterruptionWriteStatusV1 } | CoreRejection> } {
  return {
    async writeGoalInterruption(ctx, input) {
      const goalRef = input.goalRef;
      const ref = interruptionRefOf(goalRef);
      const resumed = input.to === 'resumed';
      let resolvedRevision = 0;
      if (resumed) {
        const read = await readGoalInterruption(deps.records, ref);
        if (read.status !== 'ready') return read;
        if (read.snapshot === null || read.snapshot.status !== 'pending') return { status: 'kept' };
        resolvedRevision = read.snapshot.revision;
      }
      const commandId = resumed
        ? `interruption-resolved:${goalRef.goalId}:${resolvedRevision}`
        : `startup-interrupted:${deps.hostInstanceId}:${goalRef.goalId}`;
      const result = await executeWriteCommand<GoalInterruptionV1 | null, { write: GoalInterruptionWriteV1 },
        GoalInterruptionWriteStatusV1, GoalInterruptionChangedEventV1, null>(deps.records, {
        operation: OPERATION,
        scope: { projectId: goalRef.projectId, workspaceId: ctx.workspaceId ?? null },
        principal: principalIdentity(ctx.principal),
        commandId,
        fingerprintInput: input as unknown as JsonValue,
        read: async () => {
          const read = await readGoalInterruption(deps.records, ref);
          return read.status === 'ready' ? { status: 'ready', facts: read.snapshot } : read;
        },
        decide(facts) {
          const write = input.to === 'resumed' ? resumedGoalInterruption(facts)
            : pendingGoalInterruption(facts, input);
          if (write === null) return { refuse: 'kept' };
          return { decision: { write } };
        },
        build({ write }, keys: Keys) {
          const event: GoalInterruptionChangedEventV1 = { eventId: `${keys.identityKey}:changed`,
            eventType: 'GoalInterruptionChanged', schemaVersion: 1, occurredAt: deps.now(),
            projectId: goalRef.projectId, goalId: goalRef.goalId, status: write.record.status };
          return {
            records: [goalInterruptionCodec.encode(write.record)],
            guards: [{ refKey: canonicalJson(ref), expectedRevision: write.expectedRevision }],
            claims: [],
            events: [goalInterruptionChangedCodec.encode(event)],
          };
        },
        result: {
          eventType: 'GoalInterruptionChanged',
          schemaVersion: 1,
          decode: goalInterruptionChangedCodec.decode,
          validate: () => null,
          project: () => null,
        },
      });
      if (result.status === 'committed') return { status: 'recorded' };
      if (result.status === 'refused') return { status: result.refusal };
      return result;
    },
  };
}
