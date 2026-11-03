/**
 * 8C R5/R5c — the `repair_approval` card read projection.
 *
 * The real W-A world writes a small automatic `set_responsibility` repair; the
 * real Workflow settles the round PASS. The Run's real `RunActivity` record is
 * dropped at its end commit (`dropRunActivity`), the missing-footprint state the
 * fixture cannot otherwise reach for a settled PASS. The cards come from the
 * real platform `decisions/queue`; the new source is registered in CP, so the
 * test never builds a card source.
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

async function world(label: string, dropRunActivity = true): Promise<S8CRepairWorld> {
  const opened = await openS8CRepairWorld({ label, dropRunActivity });
  worlds.push(opened);
  return opened;
}

const small = [{ op: 'set_responsibility' as const, moduleId: 's6a-core', text: 'S8C repaired core' }];

async function setAutonomy(world: S8CRepairWorld, autonomy: 'every_step' | 'after_plan_confirmation'): Promise<void> {
  const read = await world.main.route('goals/settings', { goalRef: world.goal }) as
    { status?: string; value?: { goal?: { revision?: number } } };
  const revision = read.value?.goal?.revision;
  if (read.status !== 'ready' || revision === undefined) {
    throw new Error(`S8C R5: the Goal settings are not readable: ${JSON.stringify(read)}`);
  }
  const body = await world.main.post('goals/settings/set', graphWrite(S6A_SCOPE, {
    goalRef: world.goal, autonomy, waitForGoalRef: null,
  }, `s8c-r5-autonomy-${world.goal.goalId}-${autonomy}`, [{ ref: world.goal, revision }])) as { status?: string };
  expect(body.status).toBe('committed');
}

function repairCards(cards: readonly DecisionCardV1[]): DecisionCardV1[] {
  return cards.filter(card => card.source.kind === 'repair_approval');
}

function notePin(goalProjectId: string, staged: S8CStagedRepair) {
  return { ref: { aggregateType: 'NoteHead', projectId: goalProjectId, noteId: staged.noteId },
    revision: staged.version };
}

describe('S8C R5 repair_approval card after a settled PASS', () => {
  it.each(['after_plan_confirmation', 'every_step'] as const)(
    'R5 %s: a small automatic repair with a missing footprint has one card', async autonomy => {
    const w = await world(`r5-${autonomy}`);
    if (autonomy === 'every_step') await setAutonomy(w, autonomy);
    const staged = await w.writeRepair({ ops: small });
    expect(staged.version).toBe(1);
    const passed = await w.pass(staged);
    expect(passed.finalize.result).toMatchObject({ status: 'committed', value: { outcome: 'PASS' } });

    const cards = repairCards(await w.main.readCards(w.goal));
    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    expect(card).toMatchObject({
      state: 'waiting_answer',
      subject: { kind: 'goal', goalRef: w.goal },
      source: { kind: 'repair_approval', pins: [notePin(w.goal.projectId, staged)], goalBases: [] },
      actions: ['answer'],
    });
    expect(card.cardKey).toBe(card.source.key);
    expect(card.options.map((option: { id: string; label: string; effect: string }) => ({ id: option.id, label: option.label, effect: option.effect })))
      .toEqual([{ id: 'approve', label: '收下', effect: 'apply' },
        { id: 'reject', label: '不采用', effect: 'apply' }]);
    expect(card.objects).toHaveLength(1);
    expect(card.objects[0]).toMatchObject({ kind: 'aggregate', pin: notePin(w.goal.projectId, staged) });
    // The direct card read goes through the decision source facts arm, so the
    // answer facts use the same note objects and options as the queue card.
    const direct = await w.main.route('decisions/card', { source: card.source }) as
      { status?: string; value?: { cardKey?: string; options?: { id: string }[] } };
    expect(direct.status).toBe('ready');
    expect(direct.value?.cardKey).toBe(card.cardKey);
    expect(direct.value?.options?.map((option: { id: string }) => option.id)).toEqual(['approve', 'reject']);
  });
});

describe('S8C R5c no card before the bound round settles PASS', () => {
  it('R5c: no card while no round binds the note; the missing footprint cards it after PASS', async () => {
    const w = await world('r5c-no-round');
    const staged = await w.writeRepair({ ops: small });
    expect(staged.version).toBe(1);

    // The Run has ended but the Workflow has not opened its check round yet, so
    // no round carries this note's stagedRepairs. The missing footprint alone
    // must not produce a card outside the settled-PASS branch.
    expect(repairCards(await w.main.readCards(w.goal))).toHaveLength(0);

    const passed = await w.pass(staged);
    expect(passed.finalize.result).toMatchObject({ status: 'committed', value: { outcome: 'PASS' } });
    expect(repairCards(await w.main.readCards(w.goal))).toHaveLength(1);
  });
});
