/** Slice 5 round 2, table §0–1/§2.1: R2A01–R2A11. No model port is installed. */
import { afterEach, describe, expect, it } from 'vitest';
import { decisionSourceKey, type DecisionSourceV1 } from '../../src/contracts/goal-decisions.js';
import { planProposalRefKey } from '../../src/core/work-graph/persistence/plan-record-codecs.js';
import { decodeSessionMessageRecord } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import {
  GOAL_A, GOAL_B, OPERATOR, PLAN_B1, PLAN_B2, REQUEST_Q1, S5_MESSAGE_BY_WORKSPACE_STATUS,
  WORKSPACE_SCOPE, openS5DecisionFixture, type S5DecisionFixture,
} from '../helpers/S5-decision-fixture.js';
import { committed, decoded, goalAt, keyOf, owners, pin, ready } from '../helpers/S5-application-support.js';
import { modelRequestCounts } from '../helpers/S5-queue-support.js';
import { realOwners, sendDecision, workContext } from '../helpers/S5-user-message-support.js';
import {
  abandon, adopt, allIndexRecords, emptyQ1, expectClosedQ1, populateGoals, proposalPins, propose,
  readProposal, readQueue, requestCards, requestHead, requestKey,
} from '../helpers/S5R2-a-support.js';

describe.each(['memory', 'sqlite'] as const)('S5R2 queue history (%s)', kind => {
  const opened: S5DecisionFixture[] = [];
  afterEach(async () => { for (const f of opened.splice(0)) await f.close(); });
  const open = async () => {
    const f = await openS5DecisionFixture(kind, { operatorActor: { ...OPERATOR } });
    opened.push(f);
    return f;
  };

  it('R2A01 - the later abandoned chain supersedes the earlier accepted chain', async () => {
    const f = await open();
    await emptyQ1(f, 's5r2-a01-clear-fixture');
    const p1 = await propose(f, 's5r2-a01-p1', { planId: 'PB2', requestRef: REQUEST_Q1 });
    expect(p1.basedOn).toEqual(PLAN_B1);
    const accepted = await adopt(f, p1, 's5r2-a01-adopt');
    expect(accepted.plan.ref).toEqual(PLAN_B2);
    expect(await requestHead(f)).toEqual({ head: null, status: 'closed', closedReason: null });
    const p2 = await propose(f, 's5r2-a01-p2', { planId: 'PB3', requestRef: REQUEST_Q1 });
    expect(p2).toMatchObject({ basedOn: PLAN_B2, draft: { planRevision: 3 } });
    expect(await goalAt(f.records)).toMatchObject({ revision: 8, activePlanRevision: PLAN_B2 });
    expect(await requestHead(f)).toEqual({ head: p2, status: 'candidate', closedReason: null });
    const abandoned = await abandon(f, p2, 's5r2-a01-abandon');
    await expectClosedQ1(f, accepted.proposal, abandoned);
  });

  it('R2A02 - the latest abandoned chain wins even when its refKey sorts first', async () => {
    const f = await open();
    await emptyQ1(f, 's5r2-a02-clear-fixture');
    // planProposalIdFor hashes these requestIds to c310... and b115... respectively.
    const p1 = await propose(f, 's5r2-a02-first', { planId: 'PB2-A02-first', requestRef: REQUEST_Q1 });
    const firstClosed = await abandon(f, p1, 's5r2-a02-abandon-first');
    expect(await requestHead(f)).toEqual({ head: null, status: 'closed', closedReason: null });
    const p2 = await propose(f, 's5r2-a02-second', { planId: 'PB2-A02-second', requestRef: REQUEST_Q1 });
    expect(planProposalRefKey(p2.ref) < planProposalRefKey(p1.ref)).toBe(true);
    expect(await requestHead(f)).toEqual({ head: p2, status: 'candidate', closedReason: null });
    const lastClosed = await abandon(f, p2, 's5r2-a02-abandon-second');
    await expectClosedQ1(f, firstClosed, lastClosed);
  });

  it('R2A03 - the latest accepted chain supplies the closed request card', async () => {
    const f = await open();
    await emptyQ1(f, 's5r2-a03-clear-fixture');
    const p1 = await propose(f, 's5r2-a03-p1', { planId: 'PB2-A03-first', requestRef: REQUEST_Q1 });
    const firstClosed = await abandon(f, p1, 's5r2-a03-abandon');
    expect(await requestHead(f)).toEqual({ head: null, status: 'closed', closedReason: null });
    const p2 = await propose(f, 's5r2-a03-p2', { planId: 'PB2', requestRef: REQUEST_Q1 });
    const accepted = await adopt(f, p2, 's5r2-a03-adopt');
    await expectClosedQ1(f, firstClosed, accepted.proposal);
  });

  it('R2A04 - a replaced P1 never adds a second Q1 history card', async () => {
    const f = await open();
    // The shared fixture already has the independent accepted PB1 proposal.
    // Preserve that unrelated history: the row's literal total=1 needs lead
    // clarification; the exact request-history total is one (SPEC §4.2).
    const baseline = await readQueue(f, ['history']);
    expect(baseline.history).toHaveLength(1);
    expect(baseline.history[0]).toMatchObject({ requestRef: null, state: 'closed' });
    const baselineKeys = baseline.history.map(card => card.cardKey);
    await emptyQ1(f, 's5r2-a04-clear-fixture');
    const p1 = await propose(f, 's5r2-a04-p1', { planId: 'PB2-A04-first', requestRef: REQUEST_Q1 });
    const p2 = await propose(f, 's5r2-a04-p2', { planId: 'PB2-A04-second', requestRef: REQUEST_Q1,
      replaces: { proposalRef: p1.ref, revision: 1 } });
    const replaced = await readProposal(f, p1);
    expect(replaced).toMatchObject({ revision: 2, status: 'not_adopted',
      notAdopted: { reason: 'replaced', replacedBy: p2.ref } });
    expect(await requestHead(f)).toEqual({ head: p2, status: 'candidate', closedReason: null });
    const closed = await abandon(f, p2, 's5r2-a04-abandon');
    const page = await expectClosedQ1(f, replaced, closed);
    expect(page.history.filter(card => !baselineKeys.includes(card.cardKey))).toHaveLength(1);
    expect(page.history).toHaveLength(2);
    expect(page.history.filter(card => baselineKeys.includes(card.cardKey)).map(card => card.cardKey)).toEqual(baselineKeys);
  });

  it('R2A05 - a new live head owns Q1 and suppresses its accepted history', async () => {
    const f = await open();
    await emptyQ1(f, 's5r2-a05-clear-fixture');
    const p1 = await propose(f, 's5r2-a05-p1', { planId: 'PB2', requestRef: REQUEST_Q1 });
    await adopt(f, p1, 's5r2-a05-adopt');
    expect(await requestHead(f)).toEqual({ head: null, status: 'closed', closedReason: null });
    const p2 = await propose(f, 's5r2-a05-p2', { planId: 'PB3', requestRef: REQUEST_Q1 });
    expect(p2).toMatchObject({ basedOn: PLAN_B2, draft: { planRevision: 3 } });
    expect(await requestHead(f)).toEqual({ head: p2, status: 'candidate', closedReason: null });
    const page = await readQueue(f, ['waiting_answer', 'history']);
    const cards = requestCards(page.waitingAnswer);
    expect(cards).toHaveLength(1);
    const card = cards[0];
    if (card === undefined) throw new Error('missing live Q1 card');
    expect(card).toMatchObject({ cardKey: requestKey(), state: 'waiting_answer', requestRef: REQUEST_Q1 });
    expect(proposalPins(card)).toEqual([{ ref: p2.ref, revision: 1 }]);
    expect(requestCards(page.history)).toEqual([]);
  });

  it('R2A06 - an independent accepted candidate keeps its own proposal identity', async () => {
    const f = await open();
    const u = await propose(f, 's5r2-a06-u', { planId: 'PB2' });
    expect(u.requestRef ?? null).toBeNull();
    await adopt(f, u, 's5r2-a06-adopt');
    const key = decisionSourceKey({ kind: 'candidate', goalRef: GOAL_B, proposalRef: u.ref });
    const cards = (await readQueue(f, ['history'])).history.filter(card => card.cardKey === key);
    expect(cards).toHaveLength(1);
    const card = cards[0];
    if (card === undefined) throw new Error('missing independent candidate history');
    expect(card).toMatchObject({ cardKey: key, requestRef: null, state: 'closed', candidateStatus: null,
      closedReason: 'source_resolved', readOnly: true, actions: [] });
    expect(proposalPins(card)).toEqual([{ ref: u.ref, revision: 2 }]);
  });

  // Lead (2A §5.3, frozen): 201 Goals are no longer refused; the queue answers.
  it('R2A07 / R2A08 - an unfiltered Workspace queue over 201 Goals is read, not refused', async () => {
    const f = await open();
    await populateGoals(f, 201);
    expect(await modelRequestCounts(f)).toEqual({ workAttempts: 0, queryAdmissions: 0 });
    const before = await f.storeSnapshot();
    const allocations = { ...f.allocationCounts };
    const result = await owners(f).reads.queryDecisionQueue(f.ctx, { workspace: WORKSPACE_SCOPE,
      sections: ['waiting_answer', 'answered_pending_application', 'history', 'notices'], page: { limit: 50 } });
    expect(await f.storeSnapshot()).toEqual(before);
    expect(f.allocationCounts).toEqual(allocations);
    expect(await modelRequestCounts(f)).toEqual({ workAttempts: 0, queryAdmissions: 0 });
    expect(result).toMatchObject({ status: 'ready' });
  }, 300_000);

  it('R2A10 - an ordinary Session message is not a direct decision card', async () => {
    const f = await open();
    const mailbox = realOwners(f).mailbox;
    const sent = committed(await mailbox.sendMessage(workContext(f), {
      input: { recipient: f.sessionSecond, text: 'Session-to-Session notification', intent: 'notify' },
      meta: { requestId: 's5r2-a10-send', expected: [] },
    })).value;
    expect(sent).toMatchObject({ revision: 1, status: 'pending', recipient: f.sessionSecond,
      sender: { kind: 'work_run', sessionRef: f.sessionS, runRef: f.runRA.ref }, intent: 'notify' });
    // Lead: a read adds the slice-1 decode defaults (replyHandler/archiveWaitDisposition = null).
    expect(ready(await mailbox.readMessage(f.ctx, sent.ref))).toEqual({ ...sent, replyHandler: null, archiveWaitDisposition: null });
    const source: DecisionSourceV1 = { kind: 'message',
      key: decisionSourceKey({ kind: 'message', messageRef: sent.ref }), goalRef: GOAL_B, pins: [] };
    const before = await f.storeSnapshot();
    expect(await owners(f).reads.readDecisionCard(f.ctx, { source })).toEqual({ status: 'not_found' });
    expect(await f.storeSnapshot()).toEqual(before);
  });

  it('R2A11 - a Goal A proposal cannot become a Goal B decision card', async () => {
    const f = await open();
    const pa = await propose(f, 's5r2-a11-pa', { planId: 'PA2', goalRef: GOAL_A });
    expect(pa).toMatchObject({ goalRef: GOAL_A, revision: 1, status: 'candidate' });
    expect(pa.requestRef ?? null).toBeNull();
    const validSource: DecisionSourceV1 = { kind: 'candidate', goalRef: GOAL_A, pins: [],
      key: decisionSourceKey({ kind: 'candidate', goalRef: GOAL_A, proposalRef: pa.ref }) };
    const valid = ready(await owners(f).reads.readDecisionCard(f.ctx, { source: validSource }));
    expect(valid).toMatchObject({ goalRef: GOAL_A, state: 'waiting_answer', cardKey: validSource.key });
    expect(proposalPins(valid)).toEqual([{ ref: pa.ref, revision: 1 }]);
    const source: DecisionSourceV1 = { kind: 'candidate', goalRef: GOAL_B, pins: [],
      key: decisionSourceKey({ kind: 'candidate', goalRef: GOAL_B, proposalRef: pa.ref }) };
    const before = await f.storeSnapshot();
    expect(await owners(f).reads.readDecisionCard(f.ctx, { source })).toEqual({ status: 'not_found' });
    expect(await f.storeSnapshot()).toEqual(before);
  });
});

describe('S5R2 message capacity (memory only)', () => {
  const opened: S5DecisionFixture[] = [];
  afterEach(async () => { for (const f of opened.splice(0)) await f.close(); });

  // Lead (2A §5.3, frozen): 5001 pending requests are no longer refused; paging
  // with the same 50-card limit returns every one of them.
  it('R2A09 - 5001 real pending user requests are all read by paging the queue', async () => {
    const f = await openS5DecisionFixture('memory', { duties: ['adviser'], operatorActor: { ...OPERATOR } });
    opened.push(f);
    const services = owners(f);
    // Close the fixture's pre-existing pending request by a real answer so
    // exactly 5001 pending requests below come from sendUserMessage.
    const metadata = f.messages.decision.decision;
    if (metadata === undefined) throw new Error('fixture decision request has no metadata');
    const seeded = ready(await services.reads.readDecisionCard(f.ctx, { source: metadata.source }));
    expect(seeded.state).toBe('waiting_answer');
    const answer = committed(await services.decisions.answerDecision(f.ctx, {
      input: { source: seeded.source, selection: { kind: 'option', optionId: 'reject' }, text: '', annotations: [] },
      meta: { requestId: 's5r2-a09-answer-fixture', expected: [pin(f.messages.decision.ref, 1), ...seeded.source.pins] },
    }));
    expect(answer.value).toMatchObject({ ref: f.messages.decision.ref, revision: 2, status: 'responded' });
    expect(await allIndexRecords(f, S5_MESSAGE_BY_WORKSPACE_STATUS, ['P', 'W', 'pending'])).toEqual([]);
    const sender = realOwners(f, ['adviser']);
    const sentKeys: string[] = [];
    const sentCardKeys: string[] = [];
    for (let index = 0; index < 5001; index += 1) {
      const sent = await sendDecision(f, sender, `s5r2-a09-send-${index}`);
      sentKeys.push(keyOf(sent.message.ref));
      sentCardKeys.push(decisionSourceKey({ kind: 'message', messageRef: sent.message.ref }));
    }
    const stored = (await allIndexRecords(f, S5_MESSAGE_BY_WORKSPACE_STATUS, ['P', 'W', 'pending']))
      .map(record => decoded(decodeSessionMessageRecord(record)));
    expect(stored).toHaveLength(5001);
    expect(stored.map(message => keyOf(message.ref)).sort()).toEqual(sentKeys.sort());
    for (const message of stored) {
      expect(message).toMatchObject({ goalRef: GOAL_B, revision: 1, status: 'pending', intent: 'decision_request',
        recipient: { kind: 'user', projectId: 'P', workspaceId: 'W' }, decision: { syntheticAnswer: false },
        sender: { kind: 'work_run', sessionRef: f.sessionS, runRef: f.runRA.ref } });
    }
    const before = await f.storeSnapshot();
    const allocations = { ...f.allocationCounts };
    const messageCards: string[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (;;) {
      const page = ready(await services.reads.queryDecisionQueue(f.ctx, { workspace: WORKSPACE_SCOPE, goalRef: GOAL_B,
        sections: ['waiting_answer'], page: cursor === undefined ? { limit: 50 } : { limit: 50, cursor } }));
      expect(page.waitingAnswer.length).toBeLessThanOrEqual(50);
      messageCards.push(...page.waitingAnswer.filter(card => card.source.kind === 'message').map(card => card.cardKey));
      if (page.nextCursor === null) break;
      expect(cursors.has(page.nextCursor)).toBe(false);
      cursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }
    expect(await f.storeSnapshot()).toEqual(before);
    expect(f.allocationCounts).toEqual(allocations);
    // Every one of the 5001 pending requests, once each.
    expect(messageCards).toHaveLength(5001);
    expect([...messageCards].sort()).toEqual([...sentCardKeys].sort());
  }, 300_000);
});
