/**
 * M-eligibility: `deliveryEligibility`'s table as one pure `it.each` (A5, S2).
 * Expected values are hand-written from the frozen rule: the consumption
 * predicate first, then cancelled, paused, a task block, an unknown recipient
 * outcome, then the part's own check; else the input is offerable. No row makes
 * two reasons hold at once.
 */
import { describe, expect, it } from 'vitest';
import type { GoalDesiredState } from '../../src/contracts/ledger.js';
import {
  deliveryEligibility,
  type DeliveryBaseFactsV1,
  type DeliveryEligibilityV1,
  type DeliveryFactsV1,
  type DeliveryResponseWaitV1,
  type MessageConsumptionFactsV1,
} from '../../src/core/work-graph/state/message-machine.js';

const AT = '2026-10-25T00:00:00.000Z';

type Over = {
  consumption?: Partial<MessageConsumptionFactsV1>;
  goal?: GoalDesiredState | null;
  taskBlocked?: boolean;
  recipientOutcomeUnknown?: boolean;
};

const base = (over: Over): DeliveryBaseFactsV1 => ({
  consumption: { status: 'pending', release: 'released', withdrawnAt: null, ...over.consumption },
  goal: over.goal === undefined ? 'active' : over.goal,
  taskBlocked: over.taskBlocked ?? false,
  recipientOutcomeUnknown: over.recipientOutcomeUnknown ?? false,
});

const message = (over: Over & { delivered?: boolean }): DeliveryFactsV1 =>
  ({ ...base(over), part: 'message', delivered: over.delivered ?? false });

const response = (over: Over & { accepted?: boolean; wait?: DeliveryResponseWaitV1 }): DeliveryFactsV1 =>
  ({ ...base(over), part: 'response', accepted: over.accepted ?? false, wait: over.wait ?? { kind: 'none' } });

const expiry = (over: Over & { waitConsumed?: boolean; boundHere?: boolean }): DeliveryFactsV1 =>
  ({ ...base(over), part: 'expiry', waitConsumed: over.waitConsumed ?? false, boundHere: over.boundHere ?? true });

type Row = [label: string, facts: DeliveryFactsV1, expected: DeliveryEligibilityV1];

describe('deliveryEligibility', () => {
  it.each<Row>([
    ['withdrawn', message({ consumption: { withdrawnAt: AT } }),
      { offerable: false, reason: 'withdrawn' }],
    ['awaiting release', message({ consumption: { release: 'awaiting' } }),
      { offerable: false, reason: 'not_released' }],
    ['approved release', message({ consumption: { release: 'approved' } }),
      { offerable: false, reason: 'not_released' }],
    ['denied release', message({ consumption: { release: 'denied' } }),
      { offerable: false, reason: 'not_released' }],
    ['paused goal', message({ goal: 'paused' }),
      { offerable: false, reason: 'paused' }],
    ['cancelled goal', message({ goal: 'cancelled' }),
      { offerable: false, reason: 'cancelled' }],
    ['blocking task decision', message({ taskBlocked: true }),
      { offerable: false, reason: 'awaiting_decision' }],
    ['unknown recipient outcome', message({ recipientOutcomeUnknown: true }),
      { offerable: false, reason: 'outcome_unknown' }],
    ['delivered message', message({ delivered: true }),
      { offerable: false, reason: 'delivered' }],
    ['accepted response', response({ accepted: true }),
      { offerable: false, reason: 'delivered' }],
    ['reply to an unconsumed wait bound elsewhere',
      response({ wait: { kind: 'unconsumed', boundHere: false } }),
      { offerable: false, reason: 'not_bound' }],
    ['expiry whose wait is consumed', expiry({ waitConsumed: true, boundHere: true }),
      { offerable: false, reason: 'not_bound' }],
    ['expiry not bound here', expiry({ waitConsumed: false, boundHere: false }),
      { offerable: false, reason: 'not_bound' }],
    ['no release', message({ consumption: { release: null } }),
      { offerable: true }],
    ['released', message({}),
      { offerable: true }],
    ['a message with no goal', message({ goal: null }),
      { offerable: true }],
    ['a reply to no wait', response({ wait: { kind: 'none' } }),
      { offerable: true }],
    ['a reply to a consumed wait', response({ wait: { kind: 'consumed' } }),
      { offerable: true }],
    ['a bound reply', response({ wait: { kind: 'unconsumed', boundHere: true } }),
      { offerable: true }],
    ['a bound expiry', expiry({ waitConsumed: false, boundHere: true }),
      { offerable: true }],
  ])('%s', (_label, facts, expected) => {
    expect(deliveryEligibility(facts)).toEqual(expected);
  });
});
