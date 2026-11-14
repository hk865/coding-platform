/**
 * The delivery acceptance port and dependency seam (decision 121-45, acc).
 *
 * The write owner is the person's one action on a completed Goal; the read is
 * the keyed acceptance record the delivery read joins. Both are plain ports:
 * the owner implementation is `tasks/goal-delivery-service.ts`.
 */
import type { ActorRef } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { GoalDeliveryAcceptanceV1 } from '../../../contracts/goal-delivery.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { GraphWrite } from './task-contracts.js';

export interface GoalDeliveryPort {
  readAcceptance(ctx: CoreCallContext, input: { goalRef: GoalRef; phaseRevision: number }):
    Promise<ReadResult<GoalDeliveryAcceptanceV1 | null>>;
  acceptDelivery(ctx: CoreCallContext, request: GraphWrite<{ goalRef: GoalRef }>):
    Promise<WriteResult<GoalDeliveryAcceptanceV1>>;
}

/** The record port, the clock and the id source; the operator seam is the same as the Goal settings owner. */
export type GoalDeliveryServiceDependencies = {
  records: GoalRecordTransactionPort;
  now: () => string;
  newId: () => string;
  operatorActor?: Extract<ActorRef, { kind: 'human' | 'system' }>;
};
