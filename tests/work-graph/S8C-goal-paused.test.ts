/**
 * 8C G3 R8 — a paused Goal still refuses activation, and the resume's own
 * fan-out pass (`runPass`) activates the same staged note. The pause/resume
 * are the real `goals/control`; the explicit owner calls below only prove
 * that the note is already accepted at the trigger's entry.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { openS8CRepairWorld, repairCommits, type S8CRepairWorld } from '../helpers/S8C-repair-world.js';

const worlds: S8CRepairWorld[] = [];
afterEach(async () => {
  repairCommits.reset();
  for (const world of worlds.splice(0)) await world.close();
});

describe('S8C G3 R8 goal paused', () => {
  it('R8: pause returns goal_paused, and the resume trigger activates the same staged note', async () => {
    const w = await openS8CRepairWorld({ label: 'r8' });
    worlds.push(w);
    const staged = await w.writeRepair({ ops: [{ op: 'set_responsibility', moduleId: 's6a-core', text: 'R8' }] });
    await w.pass(staged);
    const stagedRevision = await w.readCatalog();
    await w.pause();
    expect(await w.owner.activateRepair(w.world.humanContext(),
      { commandId: `activate:${staged.noteId}:${staged.version}`, noteId: staged.noteId, expectedVersion: staged.version }))
      .toEqual({ status: 'not_ready', reason: 'goal_paused' });
    expect((await w.readNote(staged.noteId))['storedState']).toBe('staged');

    // R8's real entry is the resume pass: `runPass` calls `attemptRepairsForGoal`
    // itself, so by the time the resume returns the note is accepted.
    await w.resume();
    expect(await w.readNote(staged.noteId)).toMatchObject({
      version: staged.version + 1, storedState: 'accepted', confirmedByUser: false });
    expect(await w.readCatalog()).toBe(stagedRevision + 1);

    // Nothing is staged any more: the explicit scan finds nothing, and a second
    // scan writes no second revision.
    expect(await w.owner.attemptRepairsForGoal(w.world.humanContext(), { goalRef: w.goal })).toEqual([]);
    expect(await w.owner.attemptRepairsForGoal(w.world.humanContext(), { goalRef: w.goal })).toEqual([]);
    expect(await w.readNote(staged.noteId)).toMatchObject({
      version: staged.version + 1, storedState: 'accepted' });
    expect(await w.readCatalog()).toBe(stagedRevision + 1);
  });

  it('R8: an approved answer recorded while paused is applied by the resume fan-out pass', async () => {
    const w = await openS8CRepairWorld({ label: 'r8-approved' });
    worlds.push(w);
    const before = await w.readCatalog();
    const staged = await w.writeRepair({ ops: [{ op: 'set_module_name', moduleId: 's6a-core',
      name: 'S8A core renamed while paused' }] });
    const passed = await w.pass(staged);
    expect(passed.finalize.result).toMatchObject({ status: 'committed', value: { outcome: 'PASS' } });

    await w.pause();
    const card = await w.readRepairCard();
    expect(card.state).toBe('waiting_answer');
    const answered = await w.answerRepairCard(card, 'approve', 'r8-approved-answer');
    expect(answered.answer.status).toBe('committed');
    expect(answered.application).toBeNull();
    // The coordinator hands the paused activation back with no action
    // (`answered`); the card's own read is the approved, not-yet-applied state.
    expect((await w.readRepairCard()).state).toBe('answered_pending_application');
    expect(await w.readCatalog()).toBe(before);
    expect(await w.readNote(staged.noteId)).toMatchObject({ version: staged.version, storedState: 'staged' });

    // The resume's own `runPass` retries the staged repair and records the
    // answer's application from that one activation.
    await w.resume();
    // Before anything replays the answer, the resume must have handed it back:
    // the card is applied and carries the activation commit's own receipt.
    const resumedCard = await w.readRepairCard();
    expect(resumedCard.state).toBe('applied');
    expect(resumedCard.answerMessageRef).not.toBeNull();
    expect(resumedCard.application).toMatchObject({
      receipt: { identityKey: expect.stringMatching(/^s4-note-activate:/) },
      changes: [{ after: { revision: staged.version + 1 } }],
    });
    expect(await w.readNote(staged.noteId)).toMatchObject({
      version: staged.version + 1, storedState: 'accepted', confirmedByUser: false });
    expect(await w.readCatalog()).toBe(before + 1);
  });

  it('R8: a pause after the Goal read and before the submit blocks the activation', async () => {
    const w = await openS8CRepairWorld({ label: 'r8-race' });
    worlds.push(w);
    const staged = await w.writeRepair({ ops: [{ op: 'set_responsibility', moduleId: 's6a-core', text: 'R8 race' }] });
    await w.pass(staged);
    const revision = await w.readCatalog();
    let paused = false;
    const realCommit = w.records.commit.bind(w.records);
    // A3: the wrapper holds the real final commit, pauses the Goal through the
    // real `goals/control`, then hands the unchanged commit to the store.
    const owner = w.createFaultOwner({
      records: { ...w.records, commit: async prepared => {
        if (!paused) { paused = true; await w.pause(); }
        return realCommit(prepared);
      } },
    });
    const result = await owner.activateRepair(w.world.humanContext(),
      { commandId: `activate:${staged.noteId}:${staged.version}`, noteId: staged.noteId, expectedVersion: staged.version });
    expect(result).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect((await w.readNote(staged.noteId))['storedState']).toBe('staged');
    expect(await w.readCatalog()).toBe(revision);
  });
});
