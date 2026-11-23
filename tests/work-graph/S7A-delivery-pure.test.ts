/**
 * The one delivery derivation's four separate facts (P2 §2.2, §6): Kernel accepted, a formal response is saved,
 * the original line may still deliver it, and the sender may still withdraw it. Delivery and disposition stay a
 * separate pair; every expected value is worked out by hand from the rules. Pure input -> output.
 */
import { describe, expect, it } from 'vitest';
import {
  deriveMessageDelivery, type MessageDeliveryDerivationV1, type MessageDeliveryFactsV1,
} from '../../src/core/work-graph/model/communication-contracts.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { RunRef } from '../../src/contracts/dispatch.js';

const ref: SessionMessageRef = {
  aggregateType: 'SessionMessage', projectId: 'P', workspaceId: 'W', messageId: 'm1',
};
const run: RunRef = { aggregateType: 'Run', projectId: 'P', goalId: 'g1', runId: 'run-1' };
const acceptedAt = '2026-10-25T01:02:03.000Z';
const BODY: ArtifactRef = { kind: 'artifact', contentType: 'text/plain', digest: 'd', sizeBytes: 1,
  source: { kind: 'workspace', refId: 'W', revision: '1' } };
const acceptedInput = {
  inputId: 'input-1', part: 'message' as const, executionRef: run, acceptedAt,
  kernel: { adapterId: 'a', kernelSessionId: 'ks', runId: 'kr', turnId: 't', position: 0 },
  evidence: 'input_accepted' as const, consumesWait: false,
};
const DECISION_SOURCE = { kind: 'goal_cause' as const, key: 'goal-cause:test',
  subject: { kind: 'goal' as const, goalRef: { aggregateType: 'Goal' as const, projectId: 'P', goalId: 'g1' } },
  pins: [] };
const RESPONSE = { sender: { kind: 'host' as const, actor: { kind: 'human' as const, id: 'operator' } },
  bodyRef: BODY, sourceRef: BODY.source, respondedAt: acceptedAt,
  decision: { selection: { kind: 'other' as const }, source: DECISION_SOURCE, annotations: [],
    requiresApplication: false } };
const queued = {
  delivery: 'queued' as const, deliveredTo: null, evidence: null, undeliveredReason: null,
};
const accepted = {
  delivery: 'delivered' as const, deliveredTo: { executionRef: run, acceptedAt },
  evidence: 'accepted' as const, undeliveredReason: null,
};
const undelivered = (reason: 'recipient_archived' | 'recipient_retired') => ({
  delivery: 'undelivered' as const, deliveredTo: null, evidence: null, undeliveredReason: reason,
});

const base: Omit<MessageDeliveryFactsV1, 'ref'> = {
  status: 'pending', withdrawnAt: null, response: null, answeredBy: 'line',
};
const facts = (over: Partial<Omit<MessageDeliveryFactsV1, 'ref'>> = {}) => ({ ...base, ...over });
const open = { archived: false, retired: false };

type Case = [
  name: string, facts: Omit<MessageDeliveryFactsV1, 'ref'>,
  line: { archived: boolean; retired: boolean }, expected: MessageDeliveryDerivationV1,
];

const cases: Case[] = [
  ['accepted message input', facts({ acceptedInputs: [acceptedInput] }), open,
    { delivery: accepted, disposition: { kind: 'delivered', evidence: 'accepted' },
      accepted: true, responded: false, deliverable: false, withdrawable: false }],
  ['only an accepted response input', facts({ acceptedInputs: [{ ...acceptedInput, part: 'response', consumesWait: true }] }), open,
    { delivery: queued, disposition: { kind: 'offerable' },
      accepted: false, responded: false, deliverable: true, withdrawable: true }],
  ['pending without acceptance', facts(), open,
    { delivery: queued, disposition: { kind: 'offerable' },
      accepted: false, responded: false, deliverable: true, withdrawable: true }],
  ['read without acceptance', facts({ status: 'read' }), open,
    { delivery: queued, disposition: { kind: 'offerable' },
      accepted: false, responded: false, deliverable: true, withdrawable: true }],
  // §2.2 R-02: answered but never accepted is not delivered again and can no longer be withdrawn.
  ['responded without acceptance', facts({ status: 'responded', response: RESPONSE }), open,
    { delivery: queued, disposition: { kind: 'answered' },
      accepted: false, responded: true, deliverable: false, withdrawable: false }],
  ['a copy question is never delivered on the original line but stays withdrawable',
    facts({ answeredBy: 'copy' }), open,
    { delivery: queued, disposition: { kind: 'copy' },
      accepted: false, responded: false, deliverable: false, withdrawable: true }],
  // (2) must come before (3): pending alone is queued, but pending and archived is undelivered.
  ['pending and the recipient line archived', facts(), { archived: true, retired: false },
    { delivery: undelivered('recipient_archived'), disposition: { kind: 'undelivered', reason: 'recipient_archived' },
      accepted: false, responded: false, deliverable: true, withdrawable: true }],
  ['pending and the recipient line retired', facts(), { archived: false, retired: true },
    { delivery: undelivered('recipient_retired'), disposition: { kind: 'undelivered', reason: 'recipient_retired' },
      accepted: false, responded: false, deliverable: true, withdrawable: true }],
  ['archived wins over retired', facts(), { archived: true, retired: true },
    { delivery: undelivered('recipient_archived'), disposition: { kind: 'undelivered', reason: 'recipient_archived' },
      accepted: false, responded: false, deliverable: true, withdrawable: true }],
  ['withdrawn after delivery', facts({ acceptedInputs: [acceptedInput], withdrawnAt: acceptedAt }), open,
    { delivery: accepted, disposition: { kind: 'withdrawn' },
      accepted: true, responded: false, deliverable: false, withdrawable: false }],
];

describe('R-delivery: one delivery and disposition derivation', () => {
  it.each(cases)('%s', (_name, input, line, expected) => {
    expect(deriveMessageDelivery({ ref, ...input }, line)).toEqual(expected);
  });
});
