/**
 * D85-5a: `readGoalDecisionCauses` honours `atLeastCursor` (spec §4.2).
 * The real reader runs over the shared S5 application world; the required
 * position is the receipt of the fixture's own last commit, never a value read
 * from the reader or the store.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { makeCommitCursor, seqOfCommitCursor } from '../../src/contracts/ledger.js';
import { GOAL_B, openS5DecisionFixture, type S5DecisionFixture } from '../helpers/S5-decision-fixture.js';
import { owners } from '../helpers/S5-application-support.js';

const fixtures: S5DecisionFixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });

async function world() {
  const fixture = await openS5DecisionFixture('memory');
  fixtures.push(fixture);
  const causes = owners(fixture).causes;
  // One more seed commit (no records): its receipt cursor is the ledger's last position.
  const receipt = await fixture.seedCommit([]);
  if (receipt.status !== 'committed') throw new Error('the last seed commit must commit');
  const last = receipt.cursor;
  return { fixture, causes, last, lastSeq: seqOfCommitCursor(last) };
}

describe('D85-5a Goal cause read atLeastCursor', () => {
  it('D85-5a a position past the last commit is not_ready at the Goal read watermark', async () => {
    const { fixture, causes, last, lastSeq } = await world();
    const asked = makeCommitCursor(lastSeq + 1);
    const read = await causes.readGoalDecisionCauses(fixture.ctx, { goalRef: GOAL_B, atLeastCursor: asked });
    expect(read).toEqual({
      status: 'not_ready',
      observed: { kind: 'platform', cursor: last },
      required: { kind: 'platform', cursor: asked },
    });
  });

  it('D85-5a exactly the last commit is ready and equal to the read without atLeastCursor', async () => {
    const { fixture, causes, last } = await world();
    const plain = await causes.readGoalDecisionCauses(fixture.ctx, { goalRef: GOAL_B });
    const read = await causes.readGoalDecisionCauses(fixture.ctx, { goalRef: GOAL_B, atLeastCursor: last });
    expect(read.status).toBe('ready');
    expect(read).toEqual(plain);
  });

  it('D85-5a an earlier position is ready and equal to the read without atLeastCursor', async () => {
    const { fixture, causes } = await world();
    const plain = await causes.readGoalDecisionCauses(fixture.ctx, { goalRef: GOAL_B });
    const read = await causes.readGoalDecisionCauses(fixture.ctx, { goalRef: GOAL_B,
      atLeastCursor: makeCommitCursor(1) });
    expect(read.status).toBe('ready');
    expect(read).toEqual(plain);
  });

  it('D85-5a forbidden and not_found still win over not_ready', async () => {
    const { fixture, causes, lastSeq } = await world();
    const past = makeCommitCursor(lastSeq + 1);
    const foreign = await causes.readGoalDecisionCauses(fixture.ctx, {
      goalRef: { ...GOAL_B, projectId: 'another-project' }, atLeastCursor: past });
    expect(foreign).toMatchObject({ status: 'rejected', code: 'forbidden' });
    const missing = await causes.readGoalDecisionCauses(fixture.ctx, {
      goalRef: { ...GOAL_B, goalId: 'missing' }, atLeastCursor: past });
    expect(missing).toMatchObject({ status: 'rejected', code: 'not_found' });
  });
});
