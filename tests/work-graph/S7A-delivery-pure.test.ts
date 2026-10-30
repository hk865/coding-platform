/**
 * Accepted input, or a read or replied mark, means delivered; otherwise an archived or retired recipient line means
 * undelivered, and anything else is queued. The disposition checks withdrawn, not released, delivered, undelivered,
 * then sendable; every expected value is worked out by hand from these rules.
 */
import { describe, expect, it } from 'vitest';
import {
  deriveMessageDelivery, type MessageDeliveryDerivationV1, type MessageDeliveryFactsV1,
} from '../../src/core/work-graph/model/communication-contracts.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { RunRef } from '../../src/contracts/dispatch.js';

const ref: SessionMessageRef = {
  aggregateType: 'SessionMessage', projectId: 'P', workspaceId: 'W', messageId: 'm1',
};
const run: RunRef = { aggregateType: 'Run', projectId: 'P', goalId: 'g1', runId: 'run-1' };
const acceptedAt = '2026-10-25T01:02:03.000Z';
const acceptedInput = {
  inputId: 'input-1', part: 'message' as const, executionRef: run, acceptedAt,
  kernel: { adapterId: 'a', kernelSessionId: 'ks', runId: 'kr', turnId: 't', position: 0 },
  evidence: 'input_accepted' as const, consumesWait: false,
};
const queued = {
  delivery: 'queued' as const, deliveredTo: null, evidence: null, undeliveredReason: null,
};
const legacy = {
  delivery: 'delivered' as const, deliveredTo: null,
  evidence: 'legacy_unknown' as const, undeliveredReason: null,
};
const accepted = {
  delivery: 'delivered' as const, deliveredTo: { executionRef: run, acceptedAt },
  evidence: 'accepted' as const, undeliveredReason: null,
};
const undelivered = (reason: 'recipient_archived' | 'recipient_retired') => ({
  delivery: 'undelivered' as const, deliveredTo: null, evidence: null, undeliveredReason: reason,
});

const base: Omit<MessageDeliveryFactsV1, 'ref'> = {
  status: 'pending', release: null, withdrawnAt: null,
};
const facts = (over: Partial<Omit<MessageDeliveryFactsV1, 'ref'>> = {}) => ({ ...base, ...over });
const open = { archived: false, retired: false };

type Case = [
  name: string, facts: Omit<MessageDeliveryFactsV1, 'ref'>,
  line: { archived: boolean; retired: boolean }, expected: MessageDeliveryDerivationV1,
];

const cases: Case[] = [
  ['accepted message input', facts({ acceptedInputs: [acceptedInput] }), open,
    { delivery: accepted, disposition: { kind: 'delivered', evidence: 'accepted' } }],
  ['only an accepted response input', facts({ acceptedInputs: [{ ...acceptedInput, part: 'response', consumesWait: true }] }), open,
    { delivery: queued, disposition: { kind: 'offerable' } }],
  ['pending without acceptance', facts(), open,
    { delivery: queued, disposition: { kind: 'offerable' } }],
  ['read without acceptance', facts({ status: 'read' }), open,
    { delivery: legacy, disposition: { kind: 'delivered', evidence: 'legacy_unknown' } }],
  ['responded without acceptance', facts({ status: 'responded' }), open,
    { delivery: legacy, disposition: { kind: 'delivered', evidence: 'legacy_unknown' } }],
  // (2) must come before (3): pending alone is queued, but pending and archived is undelivered.
  ['pending and the recipient line archived', facts(), { archived: true, retired: false },
    { delivery: undelivered('recipient_archived'), disposition: { kind: 'undelivered', reason: 'recipient_archived' } }],
  ['pending and the recipient line retired', facts(), { archived: false, retired: true },
    { delivery: undelivered('recipient_retired'), disposition: { kind: 'undelivered', reason: 'recipient_retired' } }],
  ['archived wins over retired', facts(), { archived: true, retired: true },
    { delivery: undelivered('recipient_archived'), disposition: { kind: 'undelivered', reason: 'recipient_archived' } }],
  ['withdrawn after delivery', facts({ acceptedInputs: [acceptedInput], withdrawnAt: acceptedAt }), open,
    { delivery: accepted, disposition: { kind: 'withdrawn' } }],
  ['release awaiting', facts({ release: 'awaiting' }), open,
    { delivery: queued, disposition: { kind: 'not_released', release: 'awaiting' } }],
  ['release approved', facts({ release: 'approved' }), open,
    { delivery: queued, disposition: { kind: 'not_released', release: 'approved' } }],
  ['release denied', facts({ release: 'denied' }), open,
    { delivery: queued, disposition: { kind: 'not_released', release: 'denied' } }],
  ['release released is not withheld', facts({ release: 'released' }), open,
    { delivery: queued, disposition: { kind: 'offerable' } }],
];

describe('R-delivery: one delivery and disposition derivation', () => {
  it.each(cases)('%s', (_name, input, line, expected) => {
    expect(deriveMessageDelivery({ ref, ...input }, line)).toEqual(expected);
  });
});
