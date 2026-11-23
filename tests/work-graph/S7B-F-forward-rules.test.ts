/**
 * S7B F-forward-rules (SR3 §3.4, book `7b:1220`; probe P-08). The pure refusal/branch tables the forward owner and
 * `disposeWait` share, called directly (A5) with hand-built facts. Every expected code/reason is the frozen literal
 * from SR3 §3.2.2 and P-08; a reason the ruling does not freeze is asserted by code only and reported, never invented.
 * No store, platform, Host, Workflow, Runtime or stub port is imported.
 */
import { describe, expect, it } from 'vitest';
import type { GoalRef } from '../../src/contracts/ledger.js';
import {
  disposeWaitProblem, forwardMessageProblem,
  type DisposeFactsV1, type ForwardFactsV1,
} from '../../src/core/work-graph/state/message-machine.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';

type ForwardMessage = ForwardFactsV1['message'];
type DisposeMessage = DisposeFactsV1['message'];
type Expected = { code: string; reason?: string } | null;

const REF: SessionMessage['ref'] = { aggregateType: 'SessionMessage', projectId: 'p', workspaceId: 'w', messageId: 'm' };
const GOAL: GoalRef = { aggregateType: 'Goal', projectId: 'p', goalId: 'g' };
const SENDER: ForwardMessage['sender'] = { kind: 'host', actor: { kind: 'human', id: 'person' } };
const ALLOWED = { sameWorkspace: true, eligible: true };

const forwardMessage = (over: Partial<ForwardMessage> = {}): ForwardMessage => ({
  ref: REF, revision: 1, sender: SENDER, withdrawnAt: null,
  rejectedAt: null, transferredTo: null, goalRef: GOAL, originalRef: null, waitAfterSend: true, ...over,
});
const forwardFacts = (over: Partial<ForwardFactsV1> = {}): ForwardFactsV1 => ({
  branch: 'ordinary', message: forwardMessage(), delivery: 'undelivered',
  undeliveredReason: 'recipient_archived', acceptedMessage: false, goal: { desiredState: 'active' },
  destination: ALLOWED, ...over,
});
const copyFacts = (copy: Partial<NonNullable<ForwardFactsV1['copy']>> = {}): ForwardFactsV1 => forwardFacts({
  branch: 'copy', delivery: 'delivered', undeliveredReason: null,
  copy: { candidateState: 'delivered', selected: true, sourceMatches: true, planAdopted: true, ...copy },
});
const disposeMessage = (over: Partial<DisposeMessage> = {}): DisposeMessage => ({
  ref: REF, sender: SENDER, needsReply: true, waitAfterSend: true, withdrawnAt: null,
  waitCancelledAt: null, expiredAt: null, deadline: null, ...over,
});
const disposeFacts = (over: Partial<DisposeFactsV1> = {}): DisposeFactsV1 => ({
  mode: 'cancel', message: disposeMessage(), wait: { state: 'open', reason: null }, delivery: 'queued',
  acceptedResponse: false, waitingLineGone: false, destination: null, ...over,
});

function expectProblem(problem: ReturnType<typeof forwardMessageProblem>, expected: Expected): void {
  if (expected === null) { expect(problem).toBeNull(); return; }
  expect(problem).toMatchObject({ status: 'rejected', code: expected.code,
    ...(expected.reason === undefined ? {} : { reason: expected.reason }) });
}

const forwardCases: { name: string; facts: ForwardFactsV1; expected: Expected }[] = [
  { name: 'ordinary delivered and accepted is busy', facts: forwardFacts({ delivery: 'delivered', undeliveredReason: null, acceptedMessage: true }), expected: { code: 'busy' } },
  { name: 'ordinary delivered but never accepted needs an undelivered original', facts: forwardFacts({ delivery: 'delivered', undeliveredReason: null }), expected: { code: 'invalid', reason: 'forward_requires_undelivered' } },
  { name: 'a withdrawn ordinary original is invalid', facts: forwardFacts({ message: forwardMessage({ withdrawnAt: '2026-10-30T00:00:00.000Z' }) }), expected: { code: 'invalid', reason: 'the message was withdrawn' } },
  { name: 'ordinary undelivered passes', facts: forwardFacts(), expected: null },
  { name: 'an accepted ordinary is busy before the delivery rule', facts: forwardFacts({ acceptedMessage: true }), expected: { code: 'busy' } },
  { name: 'a copy delivered, selected, source-matched and plan-adopted passes', facts: copyFacts(), expected: null },
  { name: 'a copy admits a delivered accepted item', facts: { ...copyFacts(), acceptedMessage: true }, expected: null },
  { name: 'a copy candidate not delivered is invalid', facts: copyFacts({ candidateState: 'not_delivered' }), expected: { code: 'invalid' } },
  { name: 'a copied candidate is invalid', facts: copyFacts({ candidateState: 'copied' }), expected: { code: 'invalid' } },
  { name: 'a withdrawn copy candidate is invalid', facts: copyFacts({ candidateState: 'withdrawn' }), expected: { code: 'invalid' } },
  { name: 'an applied copy candidate is invalid', facts: copyFacts({ candidateState: 'applied' }), expected: { code: 'invalid' } },
  { name: 'a rejected copy candidate is invalid', facts: copyFacts({ candidateState: 'rejected' }), expected: { code: 'invalid' } },
  { name: 'an unselected copy candidate is invalid', facts: copyFacts({ selected: false }), expected: { code: 'invalid' } },
  { name: 'a copy whose source does not match is invalid', facts: copyFacts({ sourceMatches: false }), expected: { code: 'invalid' } },
  { name: 'a copy whose plan is not adopted is invalid', facts: copyFacts({ planAdopted: false }), expected: { code: 'invalid' } },
  { name: 'a cancelled goal is invalid', facts: forwardFacts({ goal: { desiredState: 'cancelled' } }), expected: { code: 'invalid', reason: 'goal_cancelled' } },
  { name: 'a paused goal is allowed', facts: forwardFacts({ goal: { desiredState: 'paused' } }), expected: null },
  { name: 'a cross-workspace destination is invalid', facts: forwardFacts({ destination: { ...ALLOWED, sameWorkspace: false } }), expected: { code: 'invalid', reason: 'cross_workspace_forward' } },
  { name: 'an ineligible destination is invalid', facts: forwardFacts({ destination: { ...ALLOWED, eligible: false } }), expected: { code: 'invalid' } },
];

describe('S7B F-forward-rules', () => {
  it.each(forwardCases)('forwardMessageProblem: $name', ({ facts, expected }) => {
    expectProblem(forwardMessageProblem(facts), expected);
  });

  const disposeCases: { name: string; facts: DisposeFactsV1; expected: Expected }[] = [
    { name: 'a non-wait message is not a wait', facts: disposeFacts({ message: disposeMessage({ waitAfterSend: false }) }), expected: { code: 'invalid', reason: 'not_a_wait' } },
    { name: 'an undelivered message belongs to forward', facts: disposeFacts({ delivery: 'undelivered' }), expected: { code: 'invalid', reason: 'forward_required' } },
    { name: 'a consumed wait is busy', facts: disposeFacts({ wait: { state: 'consumed', reason: null } }), expected: { code: 'busy' } },
    { name: 'an answered wait is busy', facts: disposeFacts({ wait: { state: 'answered', reason: null } }), expected: { code: 'busy' } },
    { name: 'an expired wait is not open', facts: disposeFacts({ wait: { state: 'expired', reason: null } }), expected: { code: 'invalid', reason: 'wait_not_open' } },
    { name: 'a withdrawn wait is not open', facts: disposeFacts({ wait: { state: 'withdrawn', reason: 'withdrawn' } }), expected: { code: 'invalid', reason: 'wait_not_open' } },
    { name: 'a transfer while the waiting line is live is invalid', facts: disposeFacts({ mode: 'transfer', destination: ALLOWED }), expected: { code: 'invalid', reason: 'waiting_line_live' } },
    { name: 'a transfer crosses workspaces', facts: disposeFacts({ mode: 'transfer', waitingLineGone: true, destination: { ...ALLOWED, sameWorkspace: false } }), expected: { code: 'invalid', reason: 'cross_workspace_forward' } },
    { name: 'a transfer to an ineligible destination is invalid', facts: disposeFacts({ mode: 'transfer', waitingLineGone: true, destination: { ...ALLOWED, eligible: false } }), expected: { code: 'invalid' } },
    { name: 'a cancel of an open wait passes', facts: disposeFacts(), expected: null },
    { name: 'a transfer from a gone line to an eligible handler passes', facts: disposeFacts({ mode: 'transfer', waitingLineGone: true, destination: ALLOWED }), expected: null },
  ];
  it.each(disposeCases)('disposeWaitProblem: $name', ({ facts, expected }) => {
    expectProblem(disposeWaitProblem(facts), expected);
  });
});
