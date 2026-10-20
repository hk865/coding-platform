/**
 * K3-39 (spec §5.2, R4 owner layer): the read-only L4 `lookupToolCommit`.
 *
 * Item 9(a): every lookup goes through the production `createToolCommitLookup`
 * dispatch, with the production origin shape (the claim Session, and a Host ctx
 * as the caller, as the start-up reconcile has it). One case per L3 row-4 tool
 * name; the request ids come from the shared builder except in
 * `K3-39-request-id.test.ts`, where the algorithm is frozen with a literal.
 *
 * Owners are called through the store boundary; the database is never read to
 * verify. Expected values are hand-computed from the owner's own receipt.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ToolCommitLookup, ToolCommitLookupResult } from '../../src/contracts/unknown-call-review.js';
import { createToolCommitLookup } from '../../src/composition/tool-commit-lookup.js';
import { readUnknownCallReviewDraft } from '../../src/core/agent-runtime/unknown-call-draft.js';
import {
  ackSessionMessageRequest, respondSessionMessageRequest, sendSessionMessageRequest, sendUserMessageRequest,
  toolCommitLookupUnknownTool, toolCommitRequestId,
} from '../../src/core/work-graph/model/tool-commit-arguments.js';
import {
  createW2WhiteboardFixture, type W2WhiteboardFixture,
} from '../helpers/W2-whiteboard-fixture.js';
import { createC1Harness, type C1Harness } from '../helpers/C1-mailbox-fixture.js';
import {
  openS5DecisionFixture, type S5DecisionFixture,
} from '../helpers/S5-decision-fixture.js';
import {
  committed, decisionInput, realOwners, workContext,
} from '../helpers/S5-user-message-support.js';

const fixtures: W2WhiteboardFixture[] = [];
const s5Fixtures: S5DecisionFixture[] = [];
const c1Fixtures: C1Harness[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
  for (const s of s5Fixtures.splice(0)) await s.close();
  for (const h of c1Fixtures.splice(0)) await h.close();
});

function planArgs(request: Awaited<ReturnType<W2WhiteboardFixture['buildAgentProposeRequest']>>) {
  return {
    basedOn: request.input.basedOn,
    draft: request.input.draft,
    reason: request.input.reason,
    expected: request.meta.expected,
  };
}

/** An owner that publishes no name; the dispatch table never asks it. */
const NO_LOOKUP: ToolCommitLookup = async (_ctx, input) => toolCommitLookupUnknownTool(input.toolName);

function mailboxDispatch(owner: ToolCommitLookup): ToolCommitLookup {
  return createToolCommitLookup([owner, NO_LOOKUP, NO_LOOKUP],
    [['send_session_message', 'ack_session_message', 'respond_session_message', 'send_user_message'],
      ['record_decision_application'], ['propose_future_plan']]);
}
function decisionDispatch(owner: ToolCommitLookup): ToolCommitLookup {
  return createToolCommitLookup([NO_LOOKUP, owner, NO_LOOKUP],
    [['send_session_message', 'ack_session_message', 'respond_session_message', 'send_user_message'],
      ['record_decision_application'], ['propose_future_plan']]);
}
function planDispatch(owner: ToolCommitLookup): ToolCommitLookup {
  return createToolCommitLookup([NO_LOOKUP, NO_LOOKUP, owner],
    [['send_session_message', 'ack_session_message', 'respond_session_message', 'send_user_message'],
      ['record_decision_application'], ['propose_future_plan']]);
}

describe('K3-39 owner lookup publication (pure)', () => {
  it('K3-39 an owner lookup called with a tool name it does not own is undetermined', () => {
    expect(toolCommitLookupUnknownTool('not_a_tool')).toEqual({
      status: 'undetermined', reason: 'unknown_tool: not_a_tool',
    });
  });
});

describe('K3-39 createToolCommitLookup dispatch (Q2)', () => {
  const ctx = {} as CoreCallContext;
  function input(toolName: string) {
    return {
      toolName, arguments: {}, kernelCallId: 'k3-39-dispatch-call',
      origin: { runRef: { aggregateType: 'Run' as const, projectId: 'p', goalId: 'g', runId: 'r' },
        sessionRef: { projectId: 'p', sessionId: 's' }, generation: 1, workspaceId: 'w' },
    };
  }

  it('K3-39 dispatches each of the six row-4 names to its owner by tool name', async () => {
    const calls: string[] = [];
    const own = (owner: string, names: readonly string[]): ToolCommitLookup =>
      async (_ctx, lookupInput) => {
        calls.push(`${owner}:${lookupInput.toolName}`);
        return names.includes(lookupInput.toolName)
          ? { status: 'undetermined', reason: `${owner}-answered` }
          : toolCommitLookupUnknownTool(lookupInput.toolName);
      };
    const dispatch = createToolCommitLookup([
      own('mailbox', ['send_session_message', 'ack_session_message', 'respond_session_message', 'send_user_message']),
      own('decision', ['record_decision_application']),
      own('plan', ['propose_future_plan']),
    ]);
    // The mailbox is first and owns other names: the fixed table must skip it by
    // tool name, not stop on its `unknown_tool: ...` answer.
    for (const name of ['send_session_message', 'ack_session_message', 'respond_session_message', 'send_user_message']) {
      expect(await dispatch(ctx, input(name))).toEqual({ status: 'undetermined', reason: 'mailbox-answered' });
    }
    expect(await dispatch(ctx, input('record_decision_application')))
      .toEqual({ status: 'undetermined', reason: 'decision-answered' });
    expect(await dispatch(ctx, input('propose_future_plan'))).toEqual({ status: 'undetermined', reason: 'plan-answered' });
    expect(await dispatch(ctx, input('not_a_row_4_tool'))).toEqual({ status: 'undetermined', reason: 'lookup_not_published' });
    expect(calls).toEqual([
      'mailbox:send_session_message', 'mailbox:ack_session_message', 'mailbox:respond_session_message',
      'mailbox:send_user_message', 'decision:record_decision_application', 'plan:propose_future_plan',
    ]);
  });
});

describe.each(['memory', 'sqlite'] as const)('K3-39 review draft origin (%s)', kind => {
  it('K3-39 the draft rebuilds the lookup origin from the claim Session, reduced to the plain ref', async () => {
    const f = await createW2WhiteboardFixture(kind);
    fixtures.push(f);
    const record = await f.readExecution();
    let seen: { sessionRef: unknown } | null = null;
    const spy: ToolCommitLookup = async (_ctx, input) => {
      seen = { sessionRef: input.origin.sessionRef };
      return { status: 'not_committed' };
    };
    await readUnknownCallReviewDraft({ lookupToolCommit: spy }, f.ctxHost, {
      record,
      kernel: { adapterId: 'a', kernelSessionId: 'ks', runId: 'kr', turnId: 't' },
      turnFound: true, kernelReadable: true, kernelUnreadableAtStop: false,
      unresolved: [{ callId: 'k3-39-origin-call', toolName: 'send_session_message',
        arguments: { recipient: f.claim.sessionRef, text: 'x' },
        declaredPosition: 1, startedPosition: null, startedAt: null }],
    });
    expect(seen).not.toBeNull();
    expect(seen!.sessionRef).toEqual({ projectId: f.claim.sessionRef.projectId, sessionId: f.claim.sessionRef.sessionId });
    expect(Object.hasOwn(seen!.sessionRef as object, 'aggregateType')).toBe(false);
  });
});

describe.each(['memory', 'sqlite'] as const)('K3-39 propose_future_plan owner lookup (%s)', kind => {
  it('K3-39 propose_future_plan reports committed, not_committed and idempotency_conflict through the dispatch', async () => {
    const f = await createW2WhiteboardFixture(kind);
    fixtures.push(f);
    const planLookup = f.plans.lookupToolCommit;
    expect(typeof planLookup).toBe('function');
    if (planLookup === undefined) return;
    const lookup = planDispatch(planLookup);

    const origin = {
      runRef: f.claim.runRef, sessionRef: f.claim.sessionRef,
      generation: f.claim.generation, workspaceId: f.ctxHost.workspaceId as string,
    };
    const kernelCallId = 'k3-39-plan-call-1';
    const requestId = toolCommitRequestId({ origin, toolName: 'propose_future_plan', kernelCallId });
    const draft = f.futureDraft('K3-39-PLAN');
    const request = await f.buildAgentProposeRequest(f.goalRef, f.planRef, draft, f.planRef, { requestId });
    const committedResult = await f.plans.proposePlan(f.ctxWork, request);
    expect(committedResult.status).toBe('committed');
    if (committedResult.status !== 'committed') return;
    const args = planArgs(request);

    const hit = await lookup(f.ctxHost, { toolName: 'propose_future_plan', arguments: args, kernelCallId, origin });
    expect(hit).toMatchObject({ status: 'committed', cursor: committedResult.cursor });
    expect((hit as Extract<ToolCommitLookupResult, { status: 'committed' }>).eventIds.length).toBeGreaterThan(0);

    const miss = await lookup(f.ctxHost, {
      toolName: 'propose_future_plan', arguments: args, kernelCallId: 'k3-39-plan-call-2', origin,
    });
    expect(miss).toEqual({ status: 'not_committed' });

    const conflict = await lookup(f.ctxHost, {
      toolName: 'propose_future_plan',
      arguments: { ...args, draft: f.futureDraft('K3-39-PLAN-B') }, kernelCallId, origin,
    });
    expect(conflict).toMatchObject({ status: 'undetermined' });
    expect((conflict as Extract<ToolCommitLookupResult, { status: 'undetermined' }>).reason)
      .toContain('idempotency_conflict');
  });

  it('K3-39 the plan lookup reads a call committed by the claim-Session writer back from an aggregate origin', async () => {
    const f = await createW2WhiteboardFixture(kind);
    fixtures.push(f);
    const planLookup = f.plans.lookupToolCommit;
    expect(typeof planLookup).toBe('function');
    if (planLookup === undefined) return;
    const lookup = planDispatch(planLookup);

    // The review draft rebuilds the origin from the Run record, whose Session
    // ref carries `aggregateType`; the writer's Agent actor uses the claim
    // Session. Both must reduce to the same `{projectId, sessionId}`.
    const origin = {
      runRef: f.claim.runRef,
      sessionRef: { ...f.claim.sessionRef, aggregateType: 'Session' as const },
      generation: f.claim.generation, workspaceId: f.ctxHost.workspaceId as string,
    };
    const kernelCallId = 'k3-39-plan-prod-call-1';
    const requestId = toolCommitRequestId({ origin, toolName: 'propose_future_plan', kernelCallId });
    const draft = f.futureDraft('K3-39-PLAN-PROD');
    const request = await f.buildAgentProposeRequest(f.goalRef, f.planRef, draft, f.planRef, { requestId });
    const committedResult = await f.plans.proposePlan(f.ctxWork, request);
    expect(committedResult.status).toBe('committed');
    if (committedResult.status !== 'committed') return;

    const hit = await lookup(f.ctxHost, {
      toolName: 'propose_future_plan', arguments: planArgs(request), kernelCallId, origin,
    });
    expect(hit).toMatchObject({ status: 'committed', cursor: committedResult.cursor });
  });
});

describe.each(['memory', 'sqlite'] as const)('K3-39 mailbox owner lookups (%s)', kind => {
  it('K3-39 send_session_message reports committed, not_committed and idempotency_conflict through the dispatch', async () => {
    const h = await createC1Harness(kind);
    c1Fixtures.push(h);
    const mailboxLookup = h.mailbox.lookupToolCommit;
    expect(typeof mailboxLookup).toBe('function');
    if (mailboxLookup === undefined) return;
    const lookup = mailboxDispatch(mailboxLookup);

    const origin = {
      runRef: h.claim.runRef, sessionRef: h.claim.sessionRef,
      generation: h.claim.generation, workspaceId: h.ctxHost.workspaceId as string,
    };
    const kernelCallId = 'k3-39-mailbox-call-1';
    const requestId = toolCommitRequestId({ origin, toolName: 'send_session_message', kernelCallId });
    const args = { recipient: h.busySession, text: 'from the original Run' };
    const sent = committed(await h.mailbox.sendMessage(h.ctxWork, sendSessionMessageRequest(args, requestId)));

    // The reconcile runs on a Host ctx; the committed row must still be found.
    const hit = await lookup(h.ctxHost, { toolName: 'send_session_message', arguments: args, kernelCallId, origin });
    expect(hit).toMatchObject({ status: 'committed', cursor: sent.cursor });

    const miss = await lookup(h.ctxHost, {
      toolName: 'send_session_message', arguments: args, kernelCallId: 'k3-39-mailbox-call-2', origin,
    });
    expect(miss).toEqual({ status: 'not_committed' });

    const conflict = await lookup(h.ctxHost, {
      toolName: 'send_session_message', arguments: { ...args, text: 'different content' }, kernelCallId, origin,
    });
    expect(conflict).toMatchObject({ status: 'undetermined' });
    expect((conflict as Extract<ToolCommitLookupResult, { status: 'undetermined' }>).reason)
      .toContain('idempotency_conflict');
  });

  it('K3-39 ack_session_message and respond_session_message report the committed rows through the dispatch', async () => {
    const h = await createC1Harness(kind);
    c1Fixtures.push(h);
    const mailboxLookup = h.mailbox.lookupToolCommit;
    expect(typeof mailboxLookup).toBe('function');
    if (mailboxLookup === undefined) return;
    const lookup = mailboxDispatch(mailboxLookup);

    const origin = {
      runRef: h.claim.runRef, sessionRef: h.claim.sessionRef,
      generation: h.claim.generation, workspaceId: h.ctxHost.workspaceId as string,
    };
    const seed = committed(await h.mailbox.sendMessage(h.ctxWork, sendSessionMessageRequest(
      { recipient: h.busySession, text: 'ack and respond me' }, 'k3-39-mailbox-seed')));

    const ackCallId = 'k3-39-ack-call-1';
    const ackArgs = { messageRef: seed.value.ref, expectedRevision: seed.value.revision };
    const ackRequestId = toolCommitRequestId({ origin, toolName: 'ack_session_message', kernelCallId: ackCallId });
    const acked = committed(await h.mailbox.ackMessage(h.ctxWork, ackSessionMessageRequest(ackArgs, ackRequestId)));
    const ackHit = await lookup(h.ctxHost, { toolName: 'ack_session_message', arguments: ackArgs,
      kernelCallId: ackCallId, origin });
    expect(ackHit).toMatchObject({ status: 'committed', cursor: acked.cursor });

    const respondCallId = 'k3-39-respond-call-1';
    const respondArgs = { messageRef: seed.value.ref, expectedRevision: acked.value.revision, text: 'the answer' };
    const respondRequestId = toolCommitRequestId({ origin, toolName: 'respond_session_message',
      kernelCallId: respondCallId });
    const responded = committed(
      await h.mailbox.respondMessage(h.ctxWork, respondSessionMessageRequest(respondArgs, respondRequestId)));
    const respondHit = await lookup(h.ctxHost, { toolName: 'respond_session_message', arguments: respondArgs,
      kernelCallId: respondCallId, origin });
    expect(respondHit).toMatchObject({ status: 'committed', cursor: responded.cursor });
  });
});

describe.each(['memory', 'sqlite'] as const)('K3-39 send_user_message owner lookup (%s)', kind => {
  it('K3-39 send_user_message reports committed, not_committed and idempotency_conflict through the dispatch', async () => {
    const f = await openS5DecisionFixture(kind, { operatorActor: { ...{ kind: 'human', id: 'operator' } }, duties: ['adviser'] });
    s5Fixtures.push(f);
    const owners = realOwners(f, ['adviser']);
    const mailboxLookup = owners.mailbox.lookupToolCommit;
    expect(typeof mailboxLookup).toBe('function');
    if (mailboxLookup === undefined) return;
    const lookup = mailboxDispatch(mailboxLookup);

    const ctx = workContext(f, f.runRA);
    const origin = {
      runRef: f.runRA.ref, sessionRef: f.sessionS,
      generation: f.claimRA.generation, workspaceId: f.base.scope.workspaceId,
    };
    const kernelCallId = 'k3-39-user-send-call-1';
    const requestId = toolCommitRequestId({ origin, toolName: 'send_user_message', kernelCallId });
    const args = decisionInput(f);
    const sent = committed(await owners.mailbox.sendUserMessage(ctx, sendUserMessageRequest(args, requestId)));
    expect(sent.value).toMatchObject({ status: 'pending', revision: 1, response: null });

    // The Host ctx is not the writer; only the rebuilt origin may identify it.
    const hit = await lookup(f.ctx, { toolName: 'send_user_message', arguments: args, kernelCallId, origin });
    expect(hit).toMatchObject({ status: 'committed', cursor: sent.cursor });
    expect((hit as Extract<ToolCommitLookupResult, { status: 'committed' }>).eventIds.length).toBeGreaterThan(0);

    const miss = await lookup(f.ctx, {
      toolName: 'send_user_message', arguments: args, kernelCallId: 'k3-39-user-send-call-2', origin,
    });
    expect(miss).toEqual({ status: 'not_committed' });

    const conflict = await lookup(f.ctx, {
      toolName: 'send_user_message', arguments: { ...args, text: `${args.text} changed` }, kernelCallId, origin,
    });
    expect(conflict).toMatchObject({ status: 'undetermined' });
    expect((conflict as Extract<ToolCommitLookupResult, { status: 'undetermined' }>).reason)
      .toContain('idempotency_conflict');
  });
});

describe.each(['memory', 'sqlite'] as const)('K3-39 record_decision_application owner lookup (%s)', kind => {
  it('K3-39 record_decision_application is dispatched to the decision owner (not the mailbox)', async () => {
    const f = await openS5DecisionFixture(kind, { operatorActor: { ...{ kind: 'human', id: 'operator' } }, duties: ['adviser'] });
    s5Fixtures.push(f);
    const owners = realOwners(f, ['adviser']);
    const decisionLookup = owners.decisions.lookupToolCommit;
    expect(typeof decisionLookup).toBe('function');
    if (decisionLookup === undefined) return;
    const lookup = decisionDispatch(decisionLookup);

    const origin = {
      runRef: f.runRA.ref, sessionRef: f.sessionS,
      generation: f.claimRA.generation, workspaceId: f.base.scope.workspaceId,
    };
    // A fresh identity has no receipt; the point is that the decision owner (not
    // the first mailbox owner) answers it.
    const hit = await lookup(f.ctx, {
      toolName: 'record_decision_application',
      arguments: { messageRef: { aggregateType: 'SessionMessage', projectId: f.base.scope.projectId,
        workspaceId: f.base.scope.workspaceId, messageId: 'k3-39-decision-none' },
        receipt: { identityKey: 'k3-39-decision-none', fingerprint: 'k3-39-decision-none', cursor: 'k3-39-decision-none' } },
      kernelCallId: 'k3-39-decision-call-1', origin,
    });
    expect(hit).toEqual({ status: 'not_committed' });
  });
});
