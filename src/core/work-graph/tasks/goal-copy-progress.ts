/**
 * The copy retraction's per-item result: one `GoalCopyRetractionSettled@1` event and its R2 receipt per
 * unselected message.
 *
 * A settle stores only a definite outcome (`retracted` or `not_retractable`). Nothing reads the stored results
 * back: the confirm's replay finds them through this file's own command identity, so there is no progress record,
 * no CAS and no state machine here. The executor owns the receipt lookup, the strict replay and the failure table;
 * this owner keeps only its identity material, its facts (none) and the event it projects.
 */
import type { CoreRejection } from '../../../contracts/core/results.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import { defineEvent, defineShape, f } from '../../../contracts/data-format.js';
import type { InferShape } from '../../../contracts/data-format.js';
import { GoalRefShape, SessionMessageRefShape, id } from '../../../contracts/data-format-refs.js';
import type { JsonValue } from '../../../contracts/fingerprint.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import { executeWriteCommand } from '../persistence/command-executor.js';
import { createEventCodec } from '../persistence/field-table-codec.js';
import { canonicalRefKey } from '../persistence/record-codecs.js';

export const GOAL_COPY_RETRACTION_SETTLE_OPERATION = 'goal.copyRetraction.settle';

/** One retraction item, as the birth event's `retractions` and each settle store it: K's private shape
 *  (K `goal-copy-service.ts:116–:120`) moved here word for word; C-b deletes K's copy (CR5.7). */
export const GoalCopyRetractionShape = defineShape({
  name: 'GoalCopyRetraction',
  fields: { messageRef: f.ref(SessionMessageRefShape),
    status: f.enumOf(['retracted', 'not_retractable', 'unfinished']), reason: f.nullable(f.string()) },
});
const GOAL_COPY_RETRACTION_SETTLED_FORMAT = defineEvent({
  name: 'GoalCopyRetractionSettled', eventType: 'GoalCopyRetractionSettled', schemaVersion: 1,
  fields: {
    projectId: id, workspaceId: id,
    causationId: f.string({ min: 1, unit: 'codePoints' }),    // the settle commandId
    correlationId: f.string({ min: 1, unit: 'codePoints' }),  // `goal-copy:${confirmIdentity}`, the birth's own
    copyGoalRef: f.ref(GoalRefShape), sourceGoalRef: f.ref(GoalRefShape),
    item: f.ref(GoalCopyRetractionShape),
  },
});
/** Registered in K's `GOAL_COPY_RECORD_SCHEMAS` by C-b (CR5.7); this file exports no schema group of its own. */
export const copyRetractionSettledCodec = createEventCodec(GOAL_COPY_RETRACTION_SETTLED_FORMAT);

/** Everything the settle identity is built from; all of it comes from the committed confirm. */
export type CopyRetractionSettleScopeV1 = {
  scope: { projectId: string; workspaceId: string };
  principal: JsonValue;              // the confirm's principal
  confirmIdentity: string;           // `commandIdentity({ operation: 'goal.copyConfirm', ... })`
  copyGoalRef: GoalRef;
  sourceGoalRef: GoalRef;
  now(): string;
  eventId(): string;
};

/**
 * One item's after-write. With `outcome: null` it only looks: `settled` (the saved item, `replayed: true`) or
 * `missing`. With an outcome it commits that outcome once; a later call returns the first saved item, whatever its
 * own outcome.
 */
export async function settleCopyItem(
  records: GoalRecordTransactionPort,
  settle: CopyRetractionSettleScopeV1,
  messageRef: SessionMessageRef,
  outcome: { status: 'retracted' | 'not_retractable'; reason: string | null } | null,
): Promise<{ status: 'settled'; item: InferShape<typeof GoalCopyRetractionShape.fields>; replayed: boolean }
  | { status: 'missing' } | CoreRejection> {
  // The after-write identity hangs on the confirm identity and the item's ref key. The generation is always 1:
  // nothing raises it, so one item has exactly one settle identity.
  const commandId = `${settle.confirmIdentity}:retract:${canonicalRefKey(messageRef)}:after:1`;
  const result = await executeWriteCommand<null, { status: 'retracted' | 'not_retractable'; reason: string | null }, 'missing',
    InferShape<typeof GOAL_COPY_RETRACTION_SETTLED_FORMAT.fields>, InferShape<typeof GoalCopyRetractionShape.fields>>(
    records,
    {
      operation: GOAL_COPY_RETRACTION_SETTLE_OPERATION,
      scope: settle.scope,
      principal: settle.principal,
      commandId,
      // The outcome is left out: the first definite result wins and a later one replays it.
      fingerprintInput: { copyGoalRef: settle.copyGoalRef, messageRef },
      read: async () => ({ status: 'ready', facts: null }),
      decide: () => outcome === null ? { refuse: 'missing' } : { decision: outcome },
      build: decision => {
        const at = settle.now();
        return {
          guards: [], records: [], claims: [],
          events: [copyRetractionSettledCodec.encode({
            eventId: settle.eventId(), eventType: GOAL_COPY_RETRACTION_SETTLED_FORMAT.eventType,
            schemaVersion: GOAL_COPY_RETRACTION_SETTLED_FORMAT.schemaVersion, occurredAt: at,
            projectId: settle.scope.projectId, workspaceId: settle.scope.workspaceId,
            causationId: commandId, correlationId: `goal-copy:${settle.confirmIdentity}`,
            copyGoalRef: settle.copyGoalRef, sourceGoalRef: settle.sourceGoalRef,
            item: { messageRef, status: decision.status, reason: decision.reason },
          })],
        };
      },
      result: {
        eventType: GOAL_COPY_RETRACTION_SETTLED_FORMAT.eventType,
        schemaVersion: GOAL_COPY_RETRACTION_SETTLED_FORMAT.schemaVersion,
        decode: event => copyRetractionSettledCodec.decode(event),
        // The receipt is found only by this identity and fingerprint, which already fix both refs.
        validate: () => null,
        project: event => event.item,
      },
    },
  );
  if (result.status === 'refused') return { status: 'missing' };
  if (result.status === 'rejected') return result;
  return { status: 'settled', item: result.value, replayed: result.replayed };
}
