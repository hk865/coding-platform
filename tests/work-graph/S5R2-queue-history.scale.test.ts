/**
 * Slice 5 round 2 scale rows moved from the daily file: R2A07/R2A08 (201 Goals)
 * and R2A09 (5,001 cards). Sizes, both backends (R2A09 stays memory-only),
 * assertions and timeouts are unchanged; the daily file keeps a 5-Goal and a
 * 5-card version with 2-item page widths.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { decisionSourceKey } from '../../src/contracts/goal-decisions.js';
import { decodeSessionMessageRecord } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import {
  GOAL_B, OPERATOR, S5_MESSAGE_BY_WORKSPACE_STATUS, WORKSPACE_SCOPE, openS5DecisionFixture,
  type S5DecisionFixture,
} from '../helpers/S5-decision-fixture.js';
import { committed, decoded, keyOf, owners, pin, ready } from '../helpers/S5-application-support.js';
import { modelRequestCounts } from '../helpers/S5-queue-support.js';
import { realOwners, sendDecision } from '../helpers/S5-user-message-support.js';
import { allIndexRecords, populateGoals } from '../helpers/S5R2-a-support.js';

describe.each(['memory', 'sqlite'] as const)('S5R2 queue history (%s)', kind => {
  const opened: S5DecisionFixture[] = [];
  afterEach(async () => { for (const f of opened.splice(0)) await f.close(); });
  const open = async () => {
    const f = await openS5DecisionFixture(kind, { operatorActor: { ...OPERATOR } });
    opened.push(f);
    return f;
  };

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
