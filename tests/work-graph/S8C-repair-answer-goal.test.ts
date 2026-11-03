/**
 * A `repair_approval` answer must be checked against the
 * note's OWN Goal, not the Goal named by the answer's subject.
 *
 * The real W-A world stages a small automatic repair and settles the round
 * PASS; the missing footprint makes the card. The real note key and pin stay,
 * only the answer's subject moves to a second Goal of the same workspace. The
 * facts read must refuse `invalid`, store no answer message, and leave the
 * original card answerable.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { DecisionCardV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { openS8CRepairWorld, type S8CRepairWorld, type S8CStagedRepair } from '../helpers/S8C-repair-world.js';

const worlds: S8CRepairWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

async function world(label: string): Promise<S8CRepairWorld> {
  const opened = await openS8CRepairWorld({ label, dropRunActivity: true });
  worlds.push(opened);
  return opened;
}

const small = [{ op: 'set_responsibility' as const, moduleId: 's6a-core', text: 'S8C repaired core' }];

function repairCards(cards: readonly DecisionCardV1[]): DecisionCardV1[] {
  return cards.filter(card => card.source.kind === 'repair_approval');
}

function answerBody(source: DecisionCardV1['source'], requestId: string) {
  return graphWrite(S6A_SCOPE, {
    source, selection: { kind: 'option' as const, optionId: 'approve' }, text: '', annotations: [],
  }, requestId, [...source.pins]);
}

describe('S8C row 3 repair answer vs the note Goal', () => {
  it('row 3: an answer for another Goal of the same workspace is invalid and stores nothing', async () => {
    const w = await world('row3-wrong-goal');
    const staged: S8CStagedRepair = await w.writeRepair({ ops: small });
    const passed = await w.pass(staged);
    expect(passed.finalize.result).toMatchObject({ status: 'committed', value: { outcome: 'PASS' } });

    const card = repairCards(await w.main.readCards(w.goal))[0];
    if (card === undefined) throw new Error('row 3: the repair card is missing');
    const other = (await w.main.createGoal('row3-other-goal', 'S8C row 3 other goal')).ref;
    const wrongSource = { ...card.source, subject: { kind: 'goal' as const, goalRef: other } };

    const refused = await w.main.post('decisions/answer', answerBody(wrongSource, 'row3-wrong')) as
      { status?: string; code?: string; reason?: string };
    expect(refused).toMatchObject({ status: 'rejected', code: 'invalid' });

    const saved = await w.world.platform.decisionMessages.readDecisionAnswer(w.world.humanContext(),
      { source: card.source });
    expect(saved).toMatchObject({ status: 'ready', value: { message: null, body: null } });
    expect(repairCards(await w.main.readCards(w.goal))[0]).toMatchObject({ state: 'waiting_answer', answer: null });

    const answered = await w.main.post('decisions/answer', answerBody(card.source, 'row3-right')) as
      { status?: string; value?: { answer?: { status?: string } } };
    expect(answered.status).toBe('ready');
    expect(answered.value?.answer?.status).toBe('committed');
  });
});
