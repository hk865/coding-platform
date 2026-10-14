/**
 * Group Q (slice 2A) QE2 fixtures.
 *
 * Everything here is built through the REAL public WorkGraph services over the
 * frozen `S5DecisionFixture`: ordinary Session-to-Session messages through the
 * mailbox, decision requests through `sendUserMessage`, answers through
 * `answerDecision`, Goals through the Goal service. The queue is read through
 * the public `queryDecisionQueue` / `readDecisionCard` entries only.
 */
import { expect } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { VersionPin } from '../../src/contracts/core/identity.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionRef } from '../../src/contracts/plan.js';
import type { DecisionCardV1, DecisionReadPort } from '../../src/core/work-graph/model/decision-contracts.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { S5DecisionFixture } from './S5-decision-fixture.js';
import { WORKSPACE_SCOPE } from './S5-decision-fixture.js';
import { owners } from './S5-application-support.js';
import { realOwners } from './S5-user-message-support.js';

export type QueueInput = Parameters<DecisionReadPort['queryDecisionQueue']>[1];

/**
 * T1: 5,001-item datasets are built through the public services; wall times up
 * to 1,434 s per file were measured in the full parallel suite on 2026-10-14.
 */
export const S2A_SCALE_TIMEOUT_MS = 1_800_000;
export type DecisionCardQueue = Extract<
  Awaited<ReturnType<DecisionReadPort['queryDecisionQueue']>>,
  { status: 'ready' }
>['value'];

export const S2A_QUEUE_SECTIONS: QueueInput['sections'] =
  ['waiting_answer', 'answered_pending_application', 'history', 'notices'];

export function committed<T>(result: WriteResult<T>): Extract<WriteResult<T>, { status: 'committed' }> {
  expect(result.status, JSON.stringify(result)).toBe('committed');
  if (result.status !== 'committed') throw new Error(`expected committed: ${JSON.stringify(result)}`);
  return result;
}

export function ready<T>(result: ReadResult<T>): T {
  expect(result.status, JSON.stringify(result)).toBe('ready');
  if (result.status !== 'ready') throw new Error(`expected ready: ${JSON.stringify(result)}`);
  return result.value;
}

export function pin(ref: VersionPin['ref'], revision: number): VersionPin {
  return { ref, revision };
}

/** One ordinary Session-to-Session message; it is never a user decision card. */
export async function sendMemberMessage(
  f: S5DecisionFixture, ctx: CoreCallContext, requestId: string, index: number, recipient: SessionRef,
): Promise<SessionMessage> {
  const mailbox = realOwners(f, ['adviser']).mailbox;
  return committed(await mailbox.sendMessage(ctx, {
    input: { recipient, text: `member-to-member message ${String(index)}`, intent: 'notify' },
    meta: { requestId, expected: [] },
  })).value;
}

/** A real user decision request on the sender Run's own Goal. */
export async function sendUserDecision(
  f: S5DecisionFixture, ctx: CoreCallContext, goalRef: GoalRef, requestId: string,
): Promise<SessionMessage> {
  const card = f.messages.decision.decision;
  if (card === undefined) throw new Error('fixture decision metadata is missing');
  const mailbox = realOwners(f, ['adviser']).mailbox;
  return committed(await mailbox.sendUserMessage(ctx, {
    input: { goalRef, intent: 'decision_request', text: 'Please decide.', needsReply: true, waitAfterSend: true,
      options: structuredClone(card.options), objects: structuredClone(card.objects) },
    meta: { requestId, expected: [] },
  })).value;
}

/** Claim and enter a real Run on an existing Goal/Plan through the fixture. */
export async function startRun(
  f: S5DecisionFixture, name: string, goalRef: GoalRef, planRef: PlanRevisionRef, taskId: string,
): Promise<{ claim: Awaited<ReturnType<S5DecisionFixture['claimRun']>>; run: Awaited<ReturnType<S5DecisionFixture['enterClaim']>> }> {
  const sessionRef = await f.createS5Session(name);
  const claim = await f.claimRun({ requestId: `s2a-${name}-claim`, goalRef, planRef, taskId, sessionRef });
  return { claim, run: await f.enterClaim(claim) };
}

/** Answer a real decision request with the `accept` option (requiresApplication). */
export async function answerUserDecision(
  f: S5DecisionFixture, message: SessionMessage, requestId: string,
): Promise<SessionMessage> {
  if (message.decision === undefined) throw new Error('answer requires decision metadata');
  const decisions = owners(f).decisions;
  return committed(await decisions.answerDecision(f.ctx, {
    input: { source: message.decision.source, selection: { kind: 'option', optionId: 'accept' },
      text: '', annotations: [] },
    meta: { requestId, expected: [pin(message.ref, message.revision), ...message.decision.source.pins] },
  })).value;
}

/** The public queue read for one Goal. */
export async function readGoalQueue(
  f: S5DecisionFixture, goalRef: GoalRef, page: QueueInput['page'] = { limit: 50 },
  sections: QueueInput['sections'] = [...S2A_QUEUE_SECTIONS],
): Promise<DecisionCardQueue> {
  return ready(await owners(f).reads.queryDecisionQueue(f.ctx, {
    workspace: WORKSPACE_SCOPE, goalRef, sections, page,
  }));
}

/** The public unfiltered queue read of the workspace. */
export async function readWorkspaceQueue(
  f: S5DecisionFixture, page: QueueInput['page'] = { limit: 50 },
  sections: QueueInput['sections'] = [...S2A_QUEUE_SECTIONS],
): Promise<DecisionCardQueue> {
  return ready(await owners(f).reads.queryDecisionQueue(f.ctx, {
    workspace: WORKSPACE_SCOPE, sections, page,
  }));
}

/** Only the direct decision-message cards (kind `message`). */
export function messageCards(cards: readonly DecisionCardV1[]): DecisionCardV1[] {
  return cards.filter((card) => card.source.kind === 'message');
}
