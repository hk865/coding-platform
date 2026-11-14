/**
 * Delivery acceptance (decision 121-45, acc): the owner of `GoalDeliveryAcceptance@1`.
 *
 * `readAcceptance` is the keyed single-record read the delivery page joins by the current GoalPhase revision. A
 * confirmed absence is `null`; a damaged record is `unavailable`, never an absent acceptance.
 *
 * `acceptDelivery` is the configured operator's one action on a completed Goal: the exact Goal/GoalPhase pins, the
 * ACC-04.2 completeness check and no conflicting acceptance for this phase, then ONE commit writing only the
 * acceptance record and its `GoalDeliveryAccepted` event. Nothing about the Goal, its GoalPhase, its Plan, its Tasks,
 * its Runs or its settings changes; a replay returns the original record and cursor without reading current state.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import { rejected, rejectedWithCurrent } from '../../../contracts/core/rejections.js';
import { messageOf } from '../../../contracts/error-message.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type { GoalDeliveryAcceptanceRef, GoalDeliveryAcceptanceV1, GoalDeliveryAcceptedEvent } from '../../../contracts/goal-delivery.js';
import type { GoalPhaseRef } from '../../../contracts/goal-phase.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { PreparedCommit } from '../../record-store/ports.js';
import type {
  GoalDeliveryPort, GoalDeliveryServiceDependencies,
} from '../model/goal-delivery-contracts.js';
import {
  decodeGoalDeliveryAcceptance, decodeGoalDeliveryAcceptedEvent, encodeGoalDeliveryAcceptance,
  encodeGoalDeliveryAcceptedEvent, GOAL_DELIVERY_ACCEPTED_EVENT_TYPE, goalDeliveryAcceptanceRefKey,
} from '../persistence/goal-delivery-codecs.js';
import { readOwnerRecord } from '../persistence/owner-record-read.js';
import { lookupCommittedReceipt, type CommittedReceipt } from '../persistence/receipt-lookup.js';
import { goalDeliveryAcceptanceOf, goalDeliveryProblem } from '../state/goal-delivery.js';
import {
  bindTrustedContext, isolateWrite, isRecord, mapStoreFailure, nonEmpty, operatorProblem,
} from './execution-entry-service.js';
import { readGoal, readGoalPhase } from './plan-readers.js';
import { replayCommittedReceipt } from './receipt-replay.js';
import { pinRevision } from './revision-guard.js';

const IDENTITY_PREFIX = 'goal-delivery-accept:';

function invalid(reason: string): CoreRejection { return rejected('invalid', reason); }
function unavailable(reason: string): CoreRejection { return rejected('unavailable', reason); }

export function createGoalDeliveryService(deps: GoalDeliveryServiceDependencies): GoalDeliveryPort {
  const records = deps.records;

  /** The one committed-receipt replay: the event alone yields the original record and cursor. */
  function replayAcceptance(receipt: CommittedReceipt): Promise<WriteResult<GoalDeliveryAcceptanceV1>> {
    return replayCommittedReceipt<GoalDeliveryAcceptanceV1, GoalDeliveryAcceptanceV1>({
      receipt,
      eventAt: cursor => records.eventAt(cursor),
      expectedEventType: GOAL_DELIVERY_ACCEPTED_EVENT_TYPE,
      decode: decodeGoalDeliveryAcceptedEvent,
      project: value => value,
    });
  }

  async function readAcceptance(_ctx: CoreCallContext, input: { goalRef: GoalRef; phaseRevision: number }):
    Promise<ReadResult<GoalDeliveryAcceptanceV1 | null>> {
    const ctx = _ctx as unknown as { projectId?: unknown } | null | undefined;
    if (ctx === null || ctx === undefined || !nonEmpty(ctx.projectId)) {
      return rejected('forbidden', 'a project-bound call context is required');
    }
    if (!isRecord(input) || !isRecord(input.goalRef) || input.goalRef.aggregateType !== 'Goal'
      || !nonEmpty(input.goalRef.projectId) || !nonEmpty(input.goalRef.goalId)
      || !Number.isSafeInteger(input.phaseRevision) || input.phaseRevision < 1) {
      return invalid('readAcceptance requires a complete GoalRef and phase revision');
    }
    if (input.goalRef.projectId !== ctx.projectId) return rejected('forbidden', 'the Goal belongs to another project');
    const key = goalDeliveryAcceptanceRefKey({ aggregateType: 'GoalDeliveryAcceptance',
      projectId: input.goalRef.projectId, goalId: input.goalRef.goalId, phaseRevision: input.phaseRevision });
    const read = await readOwnerRecord({ store: records, refKey: key, decode: decodeGoalDeliveryAcceptance,
      readError: reason => unavailable(`the delivery acceptance could not be read: ${reason}`) });
    if (read.ok) return { status: 'ready', value: read.value };
    // A damaged record is unavailable, never a confirmed absence.
    if ('rejection' in read) {
      return read.rejection.code === 'invalid' ? unavailable(read.rejection.reason) : read.rejection;
    }
    return { status: 'ready', value: null };
  }

  async function acceptDelivery(ctx: CoreCallContext, request: Parameters<GoalDeliveryPort['acceptDelivery']>[1]):
    Promise<WriteResult<GoalDeliveryAcceptanceV1>> {
    const ownedCtx = bindTrustedContext(ctx);
    if (!ownedCtx.ok) return ownedCtx.rejection;
    const { scope, actor, signal } = ownedCtx;
    const owned = isolateWrite(request);
    if (!owned.ok) return owned.rejection;
    const input = owned.input;
    if (!isRecord(input.goalRef) || input.goalRef.aggregateType !== 'Goal'
      || !nonEmpty(input.goalRef.projectId) || !nonEmpty(input.goalRef.goalId)) {
      return invalid('acceptDelivery requires a complete GoalRef');
    }
    if (input.goalRef.projectId !== scope.projectId) return rejected('forbidden', 'the Goal belongs to another project');
    // ACC-03 (product rule, 121-45): only the configured operator acknowledges a delivery; never an automation.
    const notOperator = operatorProblem(actor, deps.operatorActor, 'accept a Goal delivery');
    if (notOperator !== null) return notOperator;
    const goalRef: GoalRef = { aggregateType: 'Goal', projectId: input.goalRef.projectId, goalId: input.goalRef.goalId };
    const phaseRef: GoalPhaseRef = { aggregateType: 'GoalPhase', projectId: goalRef.projectId, goalId: goalRef.goalId };
    const goalPin = pinRevision(owned.expected, goalRef);
    const phasePin = pinRevision(owned.expected, phaseRef);
    if (owned.expected.length !== 2 || goalPin === null || phasePin === null) {
      return invalid('meta.expected must be exactly the Goal pin and the GoalPhase pin');
    }

    const identity = IDENTITY_PREFIX + sha256Hex(canonicalJson({
      actor: { kind: actor.kind, id: actor.id },
      projectId: scope.projectId, workspaceId: scope.workspaceId, requestId: owned.requestId,
    } as unknown as JsonValue));
    const fingerprint = sha256Hex(canonicalJson({ kind: 'goal-delivery-accept', goalRef,
      expected: owned.expected } as unknown as JsonValue));

    const lookup = await lookupCommittedReceipt(records, identity, fingerprint);
    switch (lookup.status) {
      case 'found': return replayAcceptance(lookup.receipt);
      case 'missing': break;
      case 'conflict': return rejected('idempotency_conflict', lookup.reason);
      case 'invalid': return rejected('invalid', lookup.reason);
      default: return unavailable(`the idempotency lookup failed: ${lookup.reason}`);
    }

    const goalRead = await readGoal(records, goalRef);
    if (goalRead.status !== 'ready') return goalRead;
    const goal = goalRead.goal;
    if (goal.workspaceRef.workspaceId !== scope.workspaceId) return rejected('forbidden', 'the Goal belongs to another workspace');
    if (goal.revision !== goalPin) {
      return rejectedWithCurrent('revision_conflict', 'the Goal revision changed since it was read',
        [{ ref: goalRef, revision: goal.revision }]);
    }

    const phaseRead = await readGoalPhase(records, phaseRef);
    if (phaseRead.status !== 'ready') return phaseRead;
    const phaseProblem = goalDeliveryProblem(goal, phaseRead.snapshot);
    if (phaseProblem !== null) return invalid(phaseProblem);
    const phase = phaseRead.snapshot!;
    if (phase.revision !== phasePin) {
      return rejectedWithCurrent('revision_conflict', 'the GoalPhase changed since the caller read it',
        [{ ref: phaseRef, revision: phase.revision }]);
    }

    const acceptanceRef: GoalDeliveryAcceptanceRef = { aggregateType: 'GoalDeliveryAcceptance',
      projectId: goalRef.projectId, goalId: goalRef.goalId, phaseRevision: phase.revision };
    const acceptanceKey = goalDeliveryAcceptanceRefKey(acceptanceRef);
    const existing = await readOwnerRecord({
      store: records,
      refKey: acceptanceKey,
      decode: decodeGoalDeliveryAcceptance,
      readError: reason => unavailable(`the delivery acceptance could not be read: ${reason}`),
    });
    if (existing.ok) return invalid('the delivery was already accepted');
    if ('rejection' in existing) return existing.rejection;

    const acceptance = goalDeliveryAcceptanceOf({ goal, phase, acceptedBy: { kind: 'human', id: actor.id },
      acceptedAt: deps.now(), requestId: owned.requestId });
    const event: GoalDeliveryAcceptedEvent = {
      eventId: deps.newId(),
      eventType: GOAL_DELIVERY_ACCEPTED_EVENT_TYPE,
      schemaVersion: 1,
      occurredAt: acceptance.acceptedAt,
      identityKey: identity,
      actor,
      fingerprint,
      goalRef,
      phaseRevision: phase.revision,
      result: acceptance,
    };
    const prepared: PreparedCommit = {
      identityKey: identity,
      fingerprint,
      guards: [
        { refKey: canonicalJson(goalRef as unknown as JsonValue), expectedRevision: goal.revision },
        { refKey: phaseRead.guard.refKey, expectedRevision: phase.revision },
        { refKey: acceptanceKey, expectedRevision: null },
      ],
      records: [encodeGoalDeliveryAcceptance(acceptance)],
      claims: [],
      indexGuards: [],
      indexChanges: [],
      events: [encodeGoalDeliveryAcceptedEvent(event)],
    };
    if (signal.aborted) return rejected('cancelled', 'the delivery acceptance was cancelled before commit');
    let receipt: Awaited<ReturnType<typeof records.commit>>;
    try {
      receipt = await records.commit(prepared);
    } catch (error) {
      // src/AGENTS §3: a thrown commit is decided by the identity receipt, never assumed failed.
      const recovered = await lookupCommittedReceipt(records, identity, fingerprint);
      if (recovered.status === 'found') return replayAcceptance(recovered.receipt);
      return unavailable(`the delivery acceptance commit failed: ${messageOf(error)}`);
    }
    if (receipt.status !== 'committed') {
      // §7 list B: the record key serializes two concurrent accepts; the second key conflict is the same refusal.
      if (receipt.code === 'revision_conflict'
        && receipt.current.some(entry => entry.refKey === acceptanceKey && entry.revision !== null)) {
        return invalid('the delivery was already accepted');
      }
      return mapStoreFailure(receipt);
    }
    if (receipt.replayed) return replayAcceptance(receipt);
    return { status: 'committed', value: acceptance, replayed: false, cursor: receipt.cursor };
  }

  return { readAcceptance, acceptDelivery };
}
