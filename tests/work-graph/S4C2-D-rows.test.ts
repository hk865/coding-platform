/**
 * Slice 4C-2 item 8 acceptance D rows (D-04, D-05, D-06, D-08, D-09, D-11,
 * D-12, D-13, D-16) over the ONE real fixture: a real platform over memory and
 * SQLite, seeded only through public writes and real scribe dispositions, and
 * asserted only through the public queue / `readDecisionCard` /
 * `platform.workflow.resolveDecision` and the public note routes.
 *
 * No `vi.spyOn`, no record-store writes, no hand-built `NoteVersion`, no
 * hand-filled `noticeClass`. Expected values are literal and hand-computed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { NoteDraftAnchorV1 } from '../../src/contracts/note.js';
import {
  claimWithPlan, createAuxSession, createS4C2NoteCardFixture, currentPlanOf, generalNote, noteCardKey,
  reviseNoteStages, S4C2_GOAL_ANCHOR, understandingNote,
  type S4C2NoteCardFixture, type S4C2NoteCardFixtureKind,
} from '../helpers/S4C2-note-card-fixture.js';

const KINDS: readonly S4C2NoteCardFixtureKind[] = ['memory', 'sqlite'];
/**
 * Hand-computed JCS card key of the agent's own pending revision: the
 * deterministic second write is `s4c2-note-2` at version 1 in project
 * `s4a-scope-project`. Never built from parameters or production
 * `decisionSourceKey`.
 */
const AGENT_CARD_KEY = '{"kind":"note_review","note":{"ref":{"aggregateType":"NoteHead",'
  + '"noteId":"s4c2-note-2","projectId":"s4a-scope-project"},"revision":1}}';

/**
 * T1-049: D-16 is anchor-independent, so the merged row keeps the target's
 * whole combination (goal anchor, the user note bound to the Goal, an agent
 * `decision`) and adds the source's whole combination (file anchor, the user
 * note with `goalId: null`, `pitfall` on both sides; w2-base
 * tests/work-graph/S4C-note-protection.test.ts:21, :259, :262). Both run the
 * full kept assertion set.
 */
type D16Case = { anchor: NoteDraftAnchorV1; userOnGoal: boolean; agentKind: 'decision' | 'pitfall' };
const D16_CASES: Array<readonly [S4C2NoteCardFixtureKind, string, D16Case]> = KINDS.flatMap(kind => [
  [kind, 'goal', { anchor: { kind: 'goal', goalId: 's4a-goal' }, userOnGoal: true, agentKind: 'decision' }] as const,
  [kind, 'file', { anchor: { kind: 'file', path: 'src/a/x.ts' }, userOnGoal: false, agentKind: 'pitfall' }] as const,
]);

const fixtures: S4C2NoteCardFixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });

function idOf(result: { status: string }): string {
  return (result as unknown as { noteId: string }).noteId;
}
async function noteOf(f: S4C2NoteCardFixture, noteId: string) {
  const read = await f.platform.notes.readNote(f.ctx(), { noteId });
  if (read.status !== 'ready') throw new Error(`note ${noteId} is not readable: ${JSON.stringify(read)}`);
  return read.value;
}
async function cardState(f: S4C2NoteCardFixture, noteId: string, version = 1) {
  return f.readCard(noteId, { version });
}

describe('S4C2 D rows: card gate over the real fixture', () => {
  it.each(KINDS)('D-04 %s: a contradiction target withdrawn before the write is accepted and never opens a card', async kind => {
    const f = await createS4C2NoteCardFixture(kind);
    fixtures.push(f);
    const user = await f.writeUser(generalNote({ topic: 'stale target', conclusion: 'withdrawn user note' }),
      f.goalRef.goalId);
    expect(user).toMatchObject({ status: 'accepted', confirmedByUser: true });
    const userId = idOf(user);

    // The user's own real withdraw (the scribe cannot withdraw a user-confirmed note).
    const withdrawn = await f.withdrawUser(userId, { reason: 'no longer current' });
    expect(withdrawn).toMatchObject({ status: 'done', state: 'withdrawn', version: 2 });

    const agent = await f.writeAgent(f.executor, generalNote({ kind: 'decision', topic: 'agent topic',
      conclusion: 'agent note', contradicts: [userId] }), f.goalRef.goalId);
    // D-04: only a CURRENT contradicted target records `contradiction`; the
    // stored `contradicts` relation survives but contributes no user reason.
    expect(agent).toMatchObject({ status: 'accepted', reasons: [] });
    expect(await noteOf(f, idOf(agent))).toMatchObject({ contradicts: [userId] });
    expect(await f.cardOf(idOf(agent))).toBeNull();
    expect(await f.waitingCards()).toEqual([]);
  });

  it.each(KINDS)('D-05 %s: the card closes when its target is withdrawn; the three accept moments hold', async kind => {
    const f = await createS4C2NoteCardFixture(kind);
    fixtures.push(f);
    const user = await f.writeUser(generalNote({ topic: 'target', conclusion: 'user target' }), f.goalRef.goalId);
    const agent = await f.writeAgent(f.executor, generalNote({ kind: 'decision', topic: 'agent',
      conclusion: 'agent note', contradicts: [idOf(user)] }), f.goalRef.goalId);
    expect(agent).toMatchObject({ status: 'pending_review', reasons: ['contradiction'] });
    const agentId = idOf(agent);
    expect(await f.cardOf(agentId)).not.toBeNull();

    // Moment 1 — before the withdrawal the scribe's accept is forbidden: the
    // live `contradiction` user reason means only the user may decide.
    const early = await f.review(f.scribe, agentId, { verdict: 'accept' });
    expect(early).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect((await noteOf(f, agentId)).storedState).toBe('pending_review');

    // The counterpart is withdrawn: the still-pending note's card closes.
    const withdrawn = await f.withdrawUser(idOf(user), { reason: 'resolved by the user' });
    expect(withdrawn).toMatchObject({ status: 'done', state: 'withdrawn' });
    const closed = await cardState(f, agentId);
    expect(closed).toMatchObject({ state: 'closed', closedReason: 'source_resolved' });
    expect(await f.cardOf(agentId)).toBeNull();

    // Moment 2 — a resolution is not applicable any more.
    const withResolution = await f.review(f.scribe, agentId, { verdict: 'accept', resolution: 'supersede' });
    expect(withResolution).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'resolution_not_applicable' });

    // Moment 3 — the plain accept now succeeds and writes v2.
    const accepted = await f.review(f.scribe, agentId, { verdict: 'accept' });
    expect(accepted).toMatchObject({ status: 'done', noteId: agentId, version: 2, state: 'accepted' });
    expect((await noteOf(f, agentId)).storedState).toBe('accepted');
  });

  it.each(KINDS)('D-06 %s: replacing the user note is pending, opens the three-option card', async kind => {
    const f = await createS4C2NoteCardFixture(kind);
    fixtures.push(f);
    const user = await f.writeUser(generalNote({ topic: 'mine', conclusion: 'user note' }), f.goalRef.goalId);
    const userId = idOf(user);
    const agent = await f.writeAgent(f.executor, generalNote({ kind: 'decision', topic: 'agent',
      conclusion: 'agent note', replaces: [userId] }), f.goalRef.goalId);
    expect(agent).toMatchObject({ status: 'pending_review', reasons: ['user_note_replaced'] });
    const agentId = idOf(agent);

    const card = await f.cardOf(agentId);
    expect(card).not.toBeNull();
    expect(card!.options.map(option => option.id)).toEqual(['supersede', 'coexist', 'reject']);
  });

  it.each(KINDS)('D-08 %s: an agent revision of its own pending note leaves exactly one pending and no card for the old one', async kind => {
    const f = await createS4C2NoteCardFixture(kind);
    fixtures.push(f);
    const first = await f.writeAgent(f.executor, understandingNote({ structural: true, conclusion: 'draft' }),
      f.goalRef.goalId);
    expect(first).toMatchObject({ status: 'pending_review', reasons: ['structural'] });
    const firstId = idOf(first);

    const revised = await f.writeAgent(f.executor, understandingNote({ structural: true,
      conclusion: 'revision', replaces: [firstId] }), f.goalRef.goalId);
    expect(revised).toMatchObject({ status: 'pending_review', reasons: ['structural'] });

    // The old pending note was withdrawn in the same commit, with the real reason.
    expect(await noteOf(f, firstId)).toMatchObject({ storedState: 'withdrawn', version: 2 });
    const history = await f.history(firstId);
    expect(history.items.find(item => item.version === 2)?.change)
      .toMatchObject({ kind: 'withdraw', reason: 'revised_while_pending' });

    // No card exists for the withdrawn one; only the revision is waiting.
    expect(await f.cardOf(firstId)).toBeNull();
    expect(await f.readCard(firstId)).toBeNull();
    const waiting = await f.waitingCards();
    expect(waiting.map(card => card.cardKey)).toEqual([AGENT_CARD_KEY]);
  });

  it.each(KINDS)('D-09 %s: a goal-less pending note opens one project card and notes/list still sees it', async kind => {
    const f = await createS4C2NoteCardFixture(kind);
    fixtures.push(f);
    // A project understanding is the platform's goal-less note (goalId null),
    // written by the real project scribe; structural keeps it pending.
    const note = await f.writeAgent(f.scribe, understandingNote({ structural: true,
      anchor: { kind: 'project' }, conclusion: 'goal-less pending' }), null);
    expect(note).toMatchObject({ status: 'pending_review', reasons: ['structural'] });
    const noteId = idOf(note);
    expect(await noteOf(f, noteId)).toMatchObject({ goalId: null, storedState: 'pending_review' });

    // The two explicit Goal filters never show it; the global read returns
    // exactly the ONE project card, whose key is the hand-written JCS literal.
    const projectCardKey = noteCardKey('s4a-scope-project', noteId, 1);
    const projectSubject = { kind: 'project', projectRef: { projectId: 's4a-scope-project' } };
    expect(await f.waitingCards({ goalRef: f.goalRef })).toEqual([]);
    expect(await f.waitingCards({ goalRef: f.goal2Ref })).toEqual([]);
    const global = await f.waitingCards();
    expect(global).toMatchObject([{
      cardKey: projectCardKey, state: 'waiting_answer', subject: projectSubject,
      source: { kind: 'note_review', key: projectCardKey, subject: projectSubject },
    }]);
    // The goal-subject by-key read still finds nothing; the project subject reads the same card.
    expect(await f.readCard(noteId)).toBeNull();
    expect(await f.readCard(noteId, { projectSubject: true })).toEqual(global[0]);

    // `notes/list` with the goal-less filter still sees it.
    const listed = await f.platform.notes.listNotes(f.ctx(), {
      goalId: null, state: 'pending_review', limit: 50, cursor: null });
    expect(listed.status).toBe('ready');
    if (listed.status !== 'ready') return;
    expect(listed.value.items.map(item => ({ noteId: item.noteId, goalId: item.goalId, version: item.version,
      storedState: item.storedState }))).toEqual([{ noteId, goalId: null, version: 1, storedState: 'pending_review' }]);
  });

  it.each(KINDS)('D-11 %s: cancelling the Goal closes its waiting card as goal_cancelled', async kind => {
    const f = await createS4C2NoteCardFixture(kind);
    fixtures.push(f);
    const user = await f.writeUser(generalNote({ topic: 'target', conclusion: 'user target' }), f.goalRef.goalId);
    const agent = await f.writeAgent(f.executor, generalNote({ kind: 'decision', topic: 'agent',
      conclusion: 'agent note', contradicts: [idOf(user)] }), f.goalRef.goalId);
    const agentId = idOf(agent);
    expect(await f.cardOf(agentId)).not.toBeNull();

    const cancelled = await f.cancelGoal(f.goalRef);
    expect(cancelled).toMatchObject({ status: 'committed' });

    expect(await cardState(f, agentId)).toMatchObject({ state: 'closed', closedReason: 'goal_cancelled' });
    expect(await f.waitingCards({ goalRef: f.goalRef })).toEqual([]);
    // Cancelling the Goal changes no note head.
    expect(await noteOf(f, agentId)).toMatchObject({ storedState: 'pending_review', version: 1 });
  });

  it.each(KINDS)('D-12 %s: a newer current understanding closes the pending one\u2019s card as source_resolved and keeps the scribe todo', async kind => {
    const f = await createS4C2NoteCardFixture(kind);
    fixtures.push(f);
    const pending = await f.writeAgent(f.executor, understandingNote({ structural: true,
      conclusion: 'older pending' }), f.goalRef.goalId);
    expect(pending).toMatchObject({ status: 'pending_review', reasons: ['structural'] });
    const pendingId = idOf(pending);
    expect(await f.cardOf(pendingId)).not.toBeNull();
    expect((await f.cardOf(pendingId))!.options.map(option => option.id)).toEqual(['accept', 'reject']);

    // A newer CURRENT understanding of the same anchor: the user's write is
    // accepted and moves the current pointer.
    const current = await f.writeUser(understandingNote({ conclusion: 'newer current' }), f.goalRef.goalId);
    expect(current).toMatchObject({ status: 'accepted' });

    expect(await cardState(f, pendingId)).toMatchObject({ state: 'closed', closedReason: 'source_resolved' });
    expect(await f.waitingCards({ goalRef: f.goalRef })).toEqual([]);
    // The note stays pending for the scribe (it is not accepted).
    expect(await noteOf(f, pendingId)).toMatchObject({ storedState: 'pending_review', version: 1 });
    const todos = await f.platform.notes.readScribeTodos(f.ctx(), { goalIds: [f.goalRef.goalId] });
    expect(todos.status).toBe('ready');
    if (todos.status !== 'ready') return;
    const goalTodos = todos.value.find(row => row.goalId === f.goalRef.goalId);
    expect(goalTodos?.pending.map(todo => todo.identity)).toEqual([`${pendingId}@1`]);
  });

  it.each(KINDS)('D-13 %s: the card survives a retired contradiction and closes only when the replaced user note is gone', async kind => {
    const f = await createS4C2NoteCardFixture(kind);
    fixtures.push(f);
    const stage: NoteDraftAnchorV1 = { kind: 'stage', goalId: f.goalRef.goalId, stageId: 's-note' };
    const base = await currentPlanOf(f);
    // p2 adds the note stage and one claimable executor task (kept in s1, so
    // dropping the stage later moves no claimed task).
    const withStage = await reviseNoteStages(f, base, [...base.stages, { stageId: 's-note', title: 'Note stage' }], {
      tasks: [{ taskId: 's4c2-d13-task', stageId: 's1', title: 'Note task', requirementLevel: 'required',
        taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } }],
      assignments: [{ taskId: 's4c2-d13-task', role: 'platform-executor', instruction: 'Execute s4c2-d13-task' }],
      obligationId: 'o1',
    });
    expect(withStage.planRevision).toBe(2);
    const session = await createAuxSession(f, `d13-${kind}`, 'executor');
    const run = await claimWithPlan(f, `d13-${kind}`, session, 's4c2-d13-task', 'executor', withStage.ref);

    const contradicted = await f.writeUser(generalNote({ topic: 'contradicted', anchor: stage }), f.goalRef.goalId);
    const replaced = await f.writeUser(generalNote({ topic: 'replaced', anchor: S4C2_GOAL_ANCHOR }), f.goalRef.goalId);
    const contradictedId = idOf(contradicted);
    const replacedId = idOf(replaced);
    // The agent note's PRIMARY anchor is the stage it contradicts on (with the
    // Goal as an extra anchor): after the stage is retired the note's own
    // primary anchor is retired too, which must NOT clear `user_note_replaced`.
    const agent = await f.platform.notes.writeNote(f.workCtx(run), {
      commandId: `s4c2-d13-write-${kind}`,
      note: generalNote({ kind: 'decision', topic: 'agent', anchor: stage, extraAnchors: [S4C2_GOAL_ANCHOR],
        conclusion: 'agent note', contradicts: [contradictedId], replaces: [replacedId] }),
      expectedPointerRevision: null, goalId: f.goalRef.goalId,
    });
    expect(agent).toMatchObject({ status: 'pending_review', reasons: ['contradiction', 'user_note_replaced'] });
    const agentId = idOf(agent);
    expect(await f.cardOf(agentId)).not.toBeNull();

    // p3 drops s-note: the contradicted target's primary anchor is retired for
    // a non-file reason, so only `user_note_replaced` is still live and the
    // card stays open.
    const dropped = await reviseNoteStages(f, withStage, [...base.stages]);
    expect(dropped.planRevision).toBe(3);
    expect(await noteOf(f, contradictedId)).toMatchObject({ anchorStatus: 'retired',
      anchorRetiredReasons: ['stage_not_in_current_plan'] });
    // The pending note's own primary anchor is retired too; the reason stays.
    expect(await noteOf(f, agentId)).toMatchObject({ storedState: 'pending_review',
      anchorStatus: 'retired', anchorRetiredReasons: ['stage_not_in_current_plan'] });
    const stillOpen = await cardState(f, agentId);
    expect(stillOpen).toMatchObject({ state: 'waiting_answer', closedReason: null });
    expect(stillOpen!.options.map(option => option.id)).toEqual(['supersede', 'coexist', 'reject']);

    // Now the last live reason goes away through a real transition: the user
    // withdraws the note the agent would replace.
    const withdrawn = await f.withdrawUser(replacedId, { reason: 'no longer current' });
    expect(withdrawn).toMatchObject({ status: 'done', state: 'withdrawn' });
    expect(await cardState(f, agentId)).toMatchObject({ state: 'closed', closedReason: 'source_resolved' });
    expect(await f.waitingCards({ goalRef: f.goalRef })).toEqual([]);
    expect((await noteOf(f, agentId)).storedState).toBe('pending_review');
  });

  it.each(D16_CASES)('D-16 %s (%s anchor): a replaced user note also in coexistWith is admitted directly, no card', async (kind, _anchorKind, { anchor, userOnGoal, agentKind }) => {
    const f = await createS4C2NoteCardFixture(kind);
    fixtures.push(f);
    // The user note is a `pitfall` (generalNote's default kind) on both rows.
    const user = await f.writeUser(generalNote({ topic: 'mine', conclusion: 'user note', anchor }),
      userOnGoal ? f.goalRef.goalId : null);
    const userId = idOf(user);
    const agent = await f.writeAgent(f.executor, generalNote({ kind: agentKind, topic: 'agent',
      conclusion: 'agent note', anchor, replaces: [userId], coexistWith: [userId] }), f.goalRef.goalId);
    expect(agent).toMatchObject({ status: 'accepted', reasons: [] });
    expect(await noteOf(f, idOf(agent))).toMatchObject({ storedState: 'accepted', replaces: [userId],
      coexistWith: [userId] });
    expect((await noteOf(f, userId)).storedState).toBe('accepted');
    expect(await f.waitingCards()).toEqual([]);
  });
});

/** The fixture's Goal and its project, written out. */
const GOAL_SUBJECT = { kind: 'goal', goalRef: { aggregateType: 'Goal', projectId: 's4a-scope-project', goalId: 's4a-goal' } };
const PROJECT_SUBJECT = { kind: 'project', projectRef: { projectId: 's4a-scope-project' } };

/** A by-key read's state, closed reason and subject (the card must be there). */
function stateOf(card: Awaited<ReturnType<S4C2NoteCardFixture['readCard']>>) {
  if (card === null) throw new Error('the note card under its own subject is missing');
  return { state: card.state, closedReason: card.closedReason, subject: card.subject };
}
async function headOf(f: S4C2NoteCardFixture, noteId: string) {
  const note = await noteOf(f, noteId);
  return { storedState: note.storedState, version: note.version };
}

/** The Goal's pending contradiction note and its open card (memory). */
async function goalNoteCard() {
  const f = await createS4C2NoteCardFixture('memory');
  fixtures.push(f);
  const user = await f.writeUser(generalNote({ topic: 'target', conclusion: 'user target' }), f.goalRef.goalId);
  const agent = await f.writeAgent(f.executor, generalNote({ kind: 'decision', topic: 'agent',
    conclusion: 'agent note', contradicts: [idOf(user)] }), f.goalRef.goalId);
  const agentId = idOf(agent);
  const card = await f.cardOf(agentId);
  if (card === null) throw new Error('the Goal note card is not waiting');
  return { f, agentId, card };
}

/** The project subject on a cancelled Goal's pending note (the Goal's own read closes it `goal_cancelled`). */
async function projectSubjectOnCancelledGoalNote() {
  const { f, agentId } = await goalNoteCard();
  expect(await f.cancelGoal(f.goalRef)).toMatchObject({ status: 'committed' });
  return { read: await f.readCard(agentId, { projectSubject: true }),
    after: { own: stateOf(await f.readCard(agentId)), note: await headOf(f, agentId) } };
}

/** A Goal subject on a goal-less pending understanding the person's newer project understanding closed. */
async function goalSubjectOnResolvedProjectNote() {
  const f = await createS4C2NoteCardFixture('memory');
  fixtures.push(f);
  const pending = await f.writeAgent(f.scribe, understandingNote({ structural: true,
    anchor: { kind: 'project' }, conclusion: 'goal-less pending' }), null);
  expect(pending).toMatchObject({ status: 'pending_review', reasons: ['structural'] });
  const noteId = idOf(pending);
  expect(await f.writeUser(understandingNote({ anchor: { kind: 'project' }, conclusion: 'newer project' }), null))
    .toMatchObject({ status: 'accepted' });
  return { read: await f.readCard(noteId),
    after: { own: stateOf(await f.readCard(noteId, { projectSubject: true })), note: await headOf(f, noteId) } };
}

/** The project subject on a Goal note answered under its Goal (`reject`), the Goal then cancelled. */
async function projectSubjectOnAnsweredGoalNote() {
  const { f, agentId, card } = await goalNoteCard();
  expect(await f.resolve(card, 'reject', 's4c2-d-answered-goal-note')).toMatchObject({ status: 'ready',
    value: { answer: { status: 'committed' }, state: 'applied' } });
  expect(await f.cancelGoal(f.goalRef)).toMatchObject({ status: 'committed' });
  return { read: await f.readCard(agentId, { projectSubject: true }),
    after: { own: stateOf(await f.readCard(agentId)), note: await headOf(f, agentId) } };
}

describe('rejects: a note card read under a subject that is not the note’s own', () => {
  // The note's own subject decides before its open or closed state: a Goal's note is never the project's card, and
  // a goal-less note never a Goal's. Each read is `decisions/card` with a source a caller can send (the hand-written
  // key and the other subject); the note's own read and its head show that nothing moved.
  it.each([
    { entry: 'the project subject on a cancelled Goal’s pending note', observe: projectSubjectOnCancelledGoalNote,
      after: { own: { state: 'closed', closedReason: 'goal_cancelled', subject: GOAL_SUBJECT },
        note: { storedState: 'pending_review', version: 1 } } },
    { entry: 'a Goal subject on a goal-less note a newer project understanding closed',
      observe: goalSubjectOnResolvedProjectNote,
      after: { own: { state: 'closed', closedReason: 'source_resolved', subject: PROJECT_SUBJECT },
        note: { storedState: 'pending_review', version: 1 } } },
    { entry: 'the project subject on a Goal note answered under its Goal, the Goal cancelled',
      observe: projectSubjectOnAnsweredGoalNote,
      after: { own: { state: 'closed', closedReason: 'goal_cancelled', subject: GOAL_SUBJECT },
        note: { storedState: 'rejected', version: 2 } } },
  ])('memory: $entry is no card', async ({ observe, after }) => {
    const result = await observe();
    expect(result.read).toBeNull();
    expect(result.after).toEqual(after);
  });
});
