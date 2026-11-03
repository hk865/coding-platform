/**
 * R6b (8C G5): a repair that removes the module its own Task declares waits
 * for that Task to close, and the Workflow's `complete_task` trigger activates
 * it once.
 *
 * W-A with its only Work Task `t1` declaring `s6a-core`: the real
 * `record_note` tool stages a `remove_module` repair, the real
 * `decisions/queue` shows its card, the person approves it through the real
 * `decisions/answer` before the check PASS, and the real Workflow finalises
 * PASS and then commits `complete_task`. Before that commit `t1` is still open,
 * so the planner refuses with `module_in_use`; after it the same repair
 * activates once, the catalog loses `s6a-core`, the note head is N+1 and a
 * replay writes no second revision. Nothing is read from the store.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { plain, openS8CRepairWorld, type S8CRepairWorld } from '../helpers/S8C-repair-world.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';

const worlds: S8CRepairWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

function activate(world: S8CRepairWorld, staged: { noteId: string; version: number }) {
  return world.owner.activateRepair(world.world.humanContext(), {
    commandId: `activate:${staged.noteId}:${staged.version}`,
    noteId: staged.noteId, expectedVersion: staged.version,
  });
}

describe('S8C G5 R6b remove the task’s own declared module', () => {
  it('R6b: complete_task closes t1 before the activation removes s6a-core', async () => {
    const world = await openS8CRepairWorld({ label: 'r6b' });
    worlds.push(world);
    const before = await world.readCatalog();
    expect(await world.readModules()).toEqual(['s6a-core', 's6a-ui']);

    const staged = await world.writeRepair({ ops: [{ op: 'remove_module', moduleId: 's6a-core' }] });
    expect(staged.version).toBe(1);

    const card = await world.readRepairCard();
    expect(card.state).toBe('waiting_answer');
    const answered = await world.answerRepairCard(card, 'approve', 'r6b-answer');
    expect(answered.answer.status).toBe('committed');
    expect(answered.state).toBe('answered');
    expect(answered.application).toBeNull();

    const outcome = await world.pass(staged);
    expect(outcome.finalize.result).toMatchObject({ status: 'committed', value: { outcome: 'PASS' } });
    if (outcome.next === null || outcome.next.kind !== 'perform'
      || outcome.next.operation.kind !== 'complete_task') {
      throw new Error(`R6b: the PASS did not stop before complete_task: ${JSON.stringify(outcome.next)}`);
    }
    // The Task is not closed yet, so the delete rule still refuses and leaves
    // the note staged.
    expect(await activate(world, staged))
      .toEqual({ status: 'rejected', code: 'invalid', reason: 'module_in_use: t1' });
    expect(await world.readNote(staged.noteId)).toMatchObject({ version: 1, storedState: 'staged' });
    expect(await world.readModules()).toEqual(['s6a-core', 's6a-ui']);

    // The Workflow's own complete_task arm closes the Task and then retries the
    // staged repair; the return comes after the activation commit.
    await world.world.post('workflow/advance', plain(S6A_SCOPE, outcome.next));
    expect(await world.readModules()).toEqual(['s6a-ui']);
    expect(await world.readCatalog()).toBe(before + 1);
    expect(await world.readNote(staged.noteId)).toMatchObject({
      version: 2, storedState: 'accepted', confirmedByUser: false });

    // The second trigger finds nothing staged, and re-issuing the same command
    // replays the first activation receipt without a second revision.
    const revision = await world.readCatalog();
    expect(await world.owner.attemptRepairsForGoal(world.world.humanContext(), { goalRef: world.goal })).toEqual([]);
    expect(await activate(world, staged)).toMatchObject({
      status: 'activated', noteId: staged.noteId, version: 2 });
    expect(await world.readCatalog()).toBe(revision);
    expect(await world.readNote(staged.noteId)).toMatchObject({ version: 2, storedState: 'accepted' });
  });
});
