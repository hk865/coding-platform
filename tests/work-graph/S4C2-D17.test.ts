/**
 * S4C2-D17 (task book §2 item 4, §7 rulings 1–3) migrated to the ONE acceptance
 * fixture: the card application's effects for supersede / coexist / reject,
 * driven end-to-end through the real coordinator
 * (`platform.workflow.resolveDecision`) over memory and SQLite.
 *
 * The seed is a real `replaces` card: the user writes and confirms a note in g1,
 * the agent writes a `decision` note naming it in `replaces` (NOT `contradicts`),
 * so the note is pending with `user_note_replaced` and the card offers the three
 * resolution options. The hand-computed literal expectations are read ONLY
 * through `platform.notes.readNote`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  createS4C2NoteCardFixture, generalNote,
  type S4C2NoteCardFixture, type S4C2NoteCardFixtureKind,
} from '../helpers/S4C2-note-card-fixture.js';

const KINDS: readonly S4C2NoteCardFixtureKind[] = ['memory', 'sqlite'];
const PROJECT_ID = 's4a-scope-project';
/**
 * Hand-built JCS canonical card key for a NoteHead pin; the deterministic note
 * ids are `f.noteId(n)`. Never production `decisionSourceKey`.
 */
function literalNoteCardKey(noteId: string, version = 1): string {
  return `{"kind":"note_review","note":{"ref":{"aggregateType":"NoteHead","noteId":${JSON.stringify(noteId)},"projectId":${JSON.stringify(PROJECT_ID)}},"revision":${JSON.stringify(version)}}}`;
}

const fixtures: S4C2NoteCardFixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });

function idOf(result: { status: string }): string {
  return (result as unknown as { noteId: string }).noteId;
}

/** ONE user-confirmed note and ONE pending agent note that REPLACES it. */
async function seed(harness: S4C2NoteCardFixture): Promise<{ userId: string; agentId: string }> {
  const mine = await harness.writeUser(generalNote({ conclusion: 'user conclusion' }), harness.goalRef.goalId);
  expect(mine).toMatchObject({ status: 'accepted', confirmedByUser: true });
  const agent = await harness.writeAgent(harness.executor, generalNote({ kind: 'decision',
    conclusion: 'agent conclusion', replaces: [idOf(mine)] }), harness.goalRef.goalId);
  expect(agent).toMatchObject({ status: 'pending_review', reasons: ['user_note_replaced'] });
  return { userId: idOf(mine), agentId: idOf(agent) };
}

async function noteState(harness: S4C2NoteCardFixture, noteId: string) {
  const read = await harness.platform.notes.readNote(harness.ctx(), { noteId });
  if (read.status !== 'ready') throw new Error(`note ${noteId} is not readable: ${JSON.stringify(read)}`);
  return read.value;
}

describe('S4C2-D17 card application effects through the real coordinator', () => {
  it.each(KINDS)('D-17 %s supersede: the note replaces the target and the target becomes superseded', async kind => {
    const f = await createS4C2NoteCardFixture(kind);
    fixtures.push(f);
    const { userId, agentId } = await seed(f);
    expect([userId, agentId]).toEqual([f.noteId(1), f.noteId(2)]);
    const card = await f.cardOf(agentId);
    expect(card).not.toBeNull();
    expect(card!.cardKey).toBe(literalNoteCardKey(f.noteId(2), 1));

    const result = await f.resolve(card!, 'supersede', 's4c2-d17-supersede');
    expect(result).toMatchObject({ status: 'ready', value: {
      state: 'applied', answer: { status: 'committed' },
      action: { status: 'done', noteId: agentId, version: 2, state: 'accepted' },
      application: { status: 'committed' } } });
    expect(await noteState(f, agentId)).toMatchObject({ storedState: 'accepted', replaces: [userId],
      contradicts: [], coexistWith: [] });
    expect((await noteState(f, userId)).storedState).toBe('superseded');
    expect(await f.cardOf(agentId)).toBeNull();
  });

  it.each(KINDS)('D-17 %s coexist: the target stays current and the note keeps its replaces', async kind => {
    const f = await createS4C2NoteCardFixture(kind);
    fixtures.push(f);
    const { userId, agentId } = await seed(f);
    const card = await f.cardOf(agentId);
    expect(card).not.toBeNull();

    const result = await f.resolve(card!, 'coexist', 's4c2-d17-coexist', '并存的条件');
    expect(result).toMatchObject({ status: 'ready', value: {
      state: 'applied', answer: { status: 'committed' },
      action: { status: 'done', noteId: agentId, version: 2, state: 'accepted' },
      application: { status: 'committed' } } });
    expect(await noteState(f, agentId)).toMatchObject({ storedState: 'accepted', replaces: [userId],
      contradicts: [], coexistWith: [userId] });
    expect((await noteState(f, userId)).storedState).toBe('accepted');
    expect(await f.cardOf(agentId)).toBeNull();
  });

  it.each(KINDS)('D-17 %s reject: the note is rejected and the target stays current', async kind => {
    const f = await createS4C2NoteCardFixture(kind);
    fixtures.push(f);
    const { userId, agentId } = await seed(f);
    const card = await f.cardOf(agentId);
    expect(card).not.toBeNull();

    const result = await f.resolve(card!, 'reject', 's4c2-d17-reject');
    expect(result).toMatchObject({ status: 'ready', value: {
      state: 'applied', answer: { status: 'committed' },
      action: { status: 'done', noteId: agentId, version: 2, state: 'rejected' },
      application: { status: 'committed' } } });
    expect(await noteState(f, agentId)).toMatchObject({ storedState: 'rejected', replaces: [userId],
      contradicts: [], coexistWith: [] });
    expect((await noteState(f, userId)).storedState).toBe('accepted');
    expect(await f.cardOf(agentId)).toBeNull();
  });

  it.each(KINDS)('D-17 %s a work Run cannot answer a note card: forbidden, nothing moves', async kind => {
    const f = await createS4C2NoteCardFixture(kind);
    fixtures.push(f);
    const { agentId } = await seed(f);
    const card = await f.cardOf(agentId);
    expect(card).not.toBeNull();
    const resolve = f.platform.workflow.resolveDecision;
    if (resolve === undefined) throw new Error('the composition publishes no resolveDecision');

    const refused = await resolve(f.workCtx(f.executor.runRef), {
      input: { source: card!.source, selection: { kind: 'option', optionId: 'supersede' }, text: '', annotations: [] },
      meta: { requestId: 's4c2-d17-scribe', expected: card!.source.pins } });
    expect(refused).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await noteState(f, agentId)).toMatchObject({ storedState: 'pending_review', version: 1 });
  });
});
