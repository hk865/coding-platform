/**
 * Group Q (slice 2A) QA-16: the stable read window. A storage-port double
 * commits a real waiting card in the middle of a named window attempt.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { decisionSourceKey } from '../../src/contracts/goal-decisions.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { GOAL_C, OPERATOR, WORKSPACE_SCOPE, openS5DecisionFixture, type S5DecisionFixture } from '../helpers/S5-decision-fixture.js';
import { commitGoalCCard, goalCRunContext, midReadCommit, windowReadModel } from '../helpers/S2A-window-fixture.js';

describe.each(['memory', 'sqlite'] as const)('S2A stable read window (%s)', (kind) => {
  const opened: S5DecisionFixture[] = [];
  afterEach(async () => { for (const f of opened.splice(0)) await f.close(); });
  const open = async () => {
    const f = await openS5DecisionFixture(kind, { duties: ['adviser'], operatorActor: { ...OPERATOR } });
    opened.push(f);
    return f;
  };
  const query = async (f: S5DecisionFixture, records: ReturnType<typeof midReadCommit>) =>
    windowReadModel(f, records).queryDecisionQueue(f.ctx, { workspace: WORKSPACE_SCOPE, goalRef: GOAL_C,
      sections: ['waiting_answer'], page: { limit: 50 } });
  const cardKeys = (messages: readonly SessionMessage[]): string[] =>
    messages.map((message) => decisionSourceKey({ kind: 'message', messageRef: message.ref })).sort();

  it('QA-16 (一) - a commit in attempt 1 is retried; the stable attempt 2 carries exactly the new card', async () => {
    const f = await open();
    const ctx = await goalCRunContext(f);
    const committed: SessionMessage[] = [];
    const records = midReadCommit(f.records, new Set([1]), async (attempt) => {
      committed.push(await commitGoalCCard(f, ctx, GOAL_C, `s2a-qa16-one-${String(attempt)}`));
    });
    const result = await query(f, records);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.value.counts.waitingAnswer).toBe(1);
    expect(result.value.waitingAnswer.map((card) => card.cardKey).sort()).toEqual(cardKeys(committed));
  }, 600_000);

  it('QA-16 (二) - attempts 1-3 are interrupted and attempt 4 succeeds with the three new cards', async () => {
    const f = await open();
    const ctx = await goalCRunContext(f);
    const committed: SessionMessage[] = [];
    const records = midReadCommit(f.records, new Set([1, 2, 3]), async (attempt) => {
      committed.push(await commitGoalCCard(f, ctx, GOAL_C, `s2a-qa16-three-${String(attempt)}`));
    });
    const result = await query(f, records);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(committed).toHaveLength(3);
    expect(result.value.counts.waitingAnswer).toBe(3);
    expect(result.value.waitingAnswer.map((card) => card.cardKey).sort()).toEqual(cardKeys(committed));
  }, 600_000);

  it('QA-16 (三) - four interrupted attempts report unavailable with no cards or counts', async () => {
    const f = await open();
    const ctx = await goalCRunContext(f);
    let commits = 0;
    const records = midReadCommit(f.records, new Set([1, 2, 3, 4]), async (attempt) => {
      commits += 1;
      await commitGoalCCard(f, ctx, GOAL_C, `s2a-qa16-four-${String(attempt)}`);
    });
    const result = await query(f, records);
    expect(commits).toBe(4);
    expect(result).toMatchObject({ status: 'rejected', code: 'unavailable' });
    expect(result).not.toHaveProperty('value');
  }, 600_000);
});
