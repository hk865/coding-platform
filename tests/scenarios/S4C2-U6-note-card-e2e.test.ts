/**
 * Slice 4C-2 U6/D-01 integration over the ONE acceptance fixture
 * (`S4C2-note-card-fixture`, real platform over memory and SQLite, no spies):
 * the PRODUCTION `note_review` application adapter driven end-to-end through the
 * real finite decision coordinator (`platform.workflow.resolveDecision`).
 *
 * D-01's seed is a REAL contradiction: the user writes and confirms a note in
 * g1 and the agent writes a note in g1 that names it in `contradicts` (never in
 * `replaces`). The agent note is `pending_review` with reason `contradiction`,
 * one card carries the three resolution options, and the two edits of
 * `contradicts` (supersede / coexist) are asserted on the head plus the public
 * history: the old version keeps its original `contradicts`.
 *
 * Effects are verified ONLY through the public queue/card reads, the public
 * coordinator and `platform.notes.readNote` / `memoryHistory`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  createS4C2NoteCardFixture, generalNote, understandingNote,
  type S4C2NoteCardFixture, type S4C2NoteCardFixtureKind,
} from '../helpers/S4C2-note-card-fixture.js';

const KINDS: readonly S4C2NoteCardFixtureKind[] = ['memory', 'sqlite'];
const PROJECT_ID = 's4a-scope-project';
/**
 * Hand-computed JCS card key of the agent's contradiction note: the deterministic
 * second write is `s4c2-note-2` at version 1 in project `s4a-scope-project`.
 */
const AGENT_CARD_KEY = '{"kind":"note_review","note":{"ref":{"aggregateType":"NoteHead",'
  + '"noteId":"s4c2-note-2","projectId":"s4a-scope-project"},"revision":1}}';
const fixtures: S4C2NoteCardFixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });

function idOf(result: { status: string }): string {
  return (result as unknown as { noteId: string }).noteId;
}

/** ONE user-confirmed note and ONE pending agent note that CONTRADICTS it (D-01). */
async function seedContradiction(f: S4C2NoteCardFixture): Promise<{ userId: string; agentId: string }> {
  const mine = await f.writeUser(generalNote({ conclusion: 'user conclusion' }), f.goalRef.goalId);
  expect(mine).toMatchObject({ status: 'accepted', confirmedByUser: true });
  const agent = await f.writeAgent(f.executor, generalNote({ kind: 'decision', conclusion: 'agent conclusion',
    contradicts: [idOf(mine)] }), f.goalRef.goalId);
  expect(agent).toMatchObject({ status: 'pending_review', reasons: ['contradiction'] });
  return { userId: idOf(mine), agentId: idOf(agent) };
}

function noteItem(noteId: string, version: number, contradicts: string[],
  replaces: string[] = [], coexistWith: string[] = []): Record<string, unknown> {
  return { noteId, version, storedState: expect.any(String), contradicts, replaces, coexistWith };
}

describe('S4C2-U6 D-01 a real contradiction card through the real coordinator', () => {
  it.each(KINDS)('D-01 %s: the queue yields ONE contradiction card with the three resolution options', async kind => {
    const f = await createS4C2NoteCardFixture(kind);
    fixtures.push(f);
    const { userId, agentId } = await seedContradiction(f);
    // Deterministic note ids make the card key a literal, hand-computed value.
    expect([userId, agentId]).toEqual([f.noteId(1), f.noteId(2)]);

    const card = await f.cardOf(agentId);
    expect(card).not.toBeNull();
    expect(card).toMatchObject({
      cardKey: AGENT_CARD_KEY,
      state: 'waiting_answer',
      source: { kind: 'note_review', key: AGENT_CARD_KEY,
        pins: [{ ref: { aggregateType: 'NoteHead', projectId: PROJECT_ID, noteId: agentId }, revision: 1 }] },
    });
    expect(card!.options.map(option => option.id)).toEqual(['supersede', 'coexist', 'reject']);
    expect(card!.objects.map(object => object.kind === 'aggregate'
      ? (object.pin.ref as { noteId?: string }).noteId : null)).toEqual([agentId, userId]);
    // Hand-written literal labels from `renderNoteHeader`: agent decision head
    // first, then the contradicted user pitfall; neither is structural.
    expect(card!.objects.map(object => object.label))
      .toEqual(['决定(目标 s4a-goal)：agent conclusion', '坑(目标 s4a-goal)：user conclusion']);
  });

  it.each(KINDS)('D-01 %s: supersede accepts v2, removes the contradicts target and supersedes the user note', async kind => {
    const f = await createS4C2NoteCardFixture(kind);
    fixtures.push(f);
    const { userId, agentId } = await seedContradiction(f);
    const card = await f.cardOf(agentId);
    expect(card).not.toBeNull();

    const result = await f.resolve(card!, 'supersede', 's4c2-d01-supersede');
    expect(result).toMatchObject({ status: 'ready', value: {
      state: 'applied', answer: { status: 'committed' },
      action: { status: 'done', noteId: agentId, version: 2, state: 'accepted' },
      application: { status: 'committed' },
    } });

    // The agent's v2 carries the resolved edits: the target moved into
    // `replaces`, `contradicts` is empty.
    expect(await f.platform.notes.readNote(f.ctx(), { noteId: agentId }))
      .toMatchObject({ status: 'ready', value: noteItem(agentId, 2, [], [userId]) });
    expect(await f.platform.notes.readNote(f.ctx(), { noteId: userId }))
      .toMatchObject({ status: 'ready', value: { storedState: 'superseded', version: 2 } });

    // The OLD version keeps its original `contradicts` (history is immutable).
    const agentHistory = await f.history(agentId);
    expect(agentHistory.items.map(item => ({ version: item.version, contradicts: item.contradicts })))
      .toEqual([{ version: 2, contradicts: [] }, { version: 1, contradicts: [userId] }]);
    const userHistory = await f.history(userId);
    expect(userHistory.items.map(item => ({ version: item.version, contradicts: item.contradicts })))
      .toEqual([{ version: 2, contradicts: [] }, { version: 1, contradicts: [] }]);
    expect(await f.cardOf(agentId)).toBeNull();
  });

  it.each(KINDS)('D-01 %s: coexist accepts v2 with the target in coexistWith and keeps the user note current', async kind => {
    const f = await createS4C2NoteCardFixture(kind);
    fixtures.push(f);
    const { userId, agentId } = await seedContradiction(f);
    const card = await f.cardOf(agentId);
    expect(card).not.toBeNull();

    const result = await f.resolve(card!, 'coexist', 's4c2-d01-coexist');
    expect(result).toMatchObject({ status: 'ready', value: {
      state: 'applied', answer: { status: 'committed' },
      action: { status: 'done', noteId: agentId, version: 2, state: 'accepted' },
      application: { status: 'committed' },
    } });

    expect(await f.platform.notes.readNote(f.ctx(), { noteId: agentId }))
      .toMatchObject({ status: 'ready', value: noteItem(agentId, 2, [], [], [userId]) });
    expect(await f.platform.notes.readNote(f.ctx(), { noteId: userId }))
      .toMatchObject({ status: 'ready', value: { storedState: 'accepted', version: 1 } });

    const agentHistory = await f.history(agentId);
    expect(agentHistory.items.map(item => ({ version: item.version, contradicts: item.contradicts })))
      .toEqual([{ version: 2, contradicts: [] }, { version: 1, contradicts: [userId] }]);
    expect(await f.cardOf(agentId)).toBeNull();
  });

  it.each(KINDS)('D-01 %s: the answer text becomes the coexist change reason (trimmed)', async kind => {
    const f = await createS4C2NoteCardFixture(kind);
    fixtures.push(f);
    const { agentId } = await seedContradiction(f);
    const card = await f.cardOf(agentId);
    expect(card).not.toBeNull();
    const result = await f.resolve(card!, 'coexist', 's4c2-d01-text', '  仅适用于旧接口  ');
    expect(result).toMatchObject({ status: 'ready', value: { state: 'applied' } });

    const history = await f.history(agentId);
    expect(history.items.find(item => item.version === 2)?.change)
      .toMatchObject({ kind: 'accept', reason: '仅适用于旧接口' });
  });

  it.each(KINDS)('D-01 %s: an empty answer text records the literal 决定卡：coexist reason', async kind => {
    const f = await createS4C2NoteCardFixture(kind);
    fixtures.push(f);
    const { agentId } = await seedContradiction(f);
    const card = await f.cardOf(agentId);
    expect(card).not.toBeNull();
    const result = await f.resolve(card!, 'coexist', 's4c2-d01-no-text');
    expect(result).toMatchObject({ status: 'ready', value: { state: 'applied' } });

    const history = await f.history(agentId);
    expect(history.items.find(item => item.version === 2)?.change)
      .toMatchObject({ kind: 'accept', reason: '决定卡：coexist' });
  });

  it.each(KINDS)('D-01 %s: a moved NoteHead after the answer commit is the adapter source_stale', async kind => {
    const f = await createS4C2NoteCardFixture(kind);
    fixtures.push(f);
    const { agentId } = await seedContradiction(f);
    const card = await f.cardOf(agentId);
    expect(card).not.toBeNull();
    const requestId = 's4c2-d01-stale';

    // Step ① commits the answer while the card is still live; the same
    // `:answer` request identity makes the later coordinator retry replay it.
    const answered = await f.platform.decisionMessages.answerDecision(f.ctx(), {
      input: { source: card!.source, selection: { kind: 'option', optionId: 'supersede' }, text: '', annotations: [] },
      meta: { requestId: `${requestId}:answer`, expected: card!.source.pins },
    });
    expect(answered.status).toBe('committed');

    // A real public write moves the pinned head: the user withdraws the note.
    const moved = await f.withdrawUser(agentId, { reason: 'the user withdrew it' });
    expect(moved).toMatchObject({ status: 'done', noteId: agentId, version: 2, state: 'withdrawn' });

    const result = await f.resolve(card!, 'supersede', requestId);
    expect(result).toMatchObject({ status: 'ready', value: {
      state: 'application_not_recorded', answer: { status: 'committed' },
      action: { status: 'rejected', code: 'source_stale', reason: 'source_stale' },
      application: null,
    } });
    // Nothing was recorded by the retry: the note is only the withdraw's v2.
    expect(await f.platform.notes.readNote(f.ctx(), { noteId: agentId }))
      .toMatchObject({ status: 'ready', value: { storedState: 'withdrawn', version: 2 } });
  });

  it.each(KINDS)('D-01 %s: the same requestId replays the answer and the application without a third version', async kind => {
    const f = await createS4C2NoteCardFixture(kind);
    fixtures.push(f);
    const { userId, agentId } = await seedContradiction(f);
    const card = await f.cardOf(agentId);
    expect(card).not.toBeNull();
    const requestId = 's4c2-d01-replay';
    const first = await f.resolve(card!, 'supersede', requestId);
    expect(first).toMatchObject({ status: 'ready', value: { state: 'applied',
      action: { status: 'done', noteId: agentId, version: 2, state: 'accepted' },
      application: { status: 'committed' } } });
    const again = await f.resolve(card!, 'supersede', requestId);
    expect(again).toMatchObject({ status: 'ready', value: { state: 'applied',
      action: { status: 'done', noteId: agentId, version: 2, state: 'accepted' },
      application: { status: 'committed' } } });
    expect(await f.platform.notes.readNote(f.ctx(), { noteId: agentId }))
      .toMatchObject({ status: 'ready', value: { version: 2, storedState: 'accepted', contradicts: [],
        replaces: [userId] } });
    expect(await f.platform.notes.readNote(f.ctx(), { noteId: agentId, version: 3 }))
      .toEqual({ status: 'not_found' });
  });

  it.each(KINDS)('D-01 %s: an understanding card pins the current pointer and moves it through the coordinator', async kind => {
    const f = await createS4C2NoteCardFixture(kind);
    fixtures.push(f);
    const old = await f.writeUser(understandingNote({ conclusion: 'user understanding' }), f.goalRef.goalId);
    expect(old).toMatchObject({ status: 'accepted' });
    const oldId = idOf(old);
    const next = await f.writeAgent(f.executor, understandingNote({ conclusion: 'agent understanding',
      contradicts: [oldId] }), f.goalRef.goalId, { expectedPointerRevision: 1 });
    expect(next).toMatchObject({ status: 'pending_review', reasons: ['contradiction'] });
    const nextId = idOf(next);

    const card = await f.cardOf(nextId);
    expect(card).not.toBeNull();
    // The understanding card pins BOTH the head and the current pointer.
    expect(card!.source.pins).toHaveLength(2);
    expect(card!.source.pins.some(pin =>
      (pin.ref as { aggregateType?: unknown }).aggregateType === 'CurrentPointer')).toBe(true);

    const result = await f.resolve(card!, 'supersede', 's4c2-d01-understanding');
    expect(result).toMatchObject({ status: 'ready', value: { state: 'applied',
      action: { status: 'done', noteId: nextId, version: 2, state: 'accepted' },
      application: { status: 'committed' } } });
    expect(await f.platform.notes.readNote(f.ctx(), { noteId: nextId }))
      .toMatchObject({ status: 'ready', value: { storedState: 'accepted' } });
    expect(await f.platform.notes.readNote(f.ctx(), { noteId: oldId }))
      .toMatchObject({ status: 'ready', value: { storedState: 'superseded' } });
    const page = await f.platform.notes.listByAnchor(f.ctx(), { anchor: { kind: 'goal', goalId: 's4a-goal' },
      limit: 10, cursor: null });
    expect(page).toMatchObject({ status: 'ready', value: { pointer: { noteId: nextId, revision: 2 } } });
  });
});
