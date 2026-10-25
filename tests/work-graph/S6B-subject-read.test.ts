/**
 * Row 11, the project side (service, memory): the read scopes in one table (a zero-Goal workspace and the global
 * read show the project card, the two explicit Goal filters stay empty, D-09), the card read by its own source in the
 * zero-Goal workspace, and the card answered, applied and kept as a project.
 *
 * Every state comes from a public step of the frozen project fixture: `openS6BProjectWorld` (the scribe in the main
 * workspace; `goalless` is the second workspace of the same project and never has a goal), `scribeUnderstanding`
 * (the scribe's real Run writes the project understanding, pending for the person) and `resolveS6BProjectNote`
 * (the queue listing, `decisions/card` and `decisions/answer` with the card's own source and pins). The expected
 * card key is the hand-written `note_review` canonical JSON of the note the fixture listed; the expected subject
 * is written out.
 *
 * The remaining cases cover the rest of row 11: a page of project notices advances only through what it showed, an
 * unseen Goal notice before the shown project line keeps the no-goal view from advancing (the person's own Goal
 * understanding through `notes/write` over the pointer `understandingPointer` read, then the scribe rewriting it), and
 * the main read shows the project's card and notice once in the common part of every view, from one whole-page
 * assembly and one project page per read, while a request's own read does not repeat them and a Goal-filtered queue
 * read reads no project page. A project notice is a note version whose `goalId` is null that one of the three notice
 * classes covers; the scribe rewriting the person's own project understanding is such a version (`user_affected`),
 * written by the real scribe Run of `scribeUnderstanding` over the understanding `writeUserProjectUnderstanding`
 * recorded. The one injected behaviour: two pass-through counters (A3) around the platform's decision read model and
 * note card source factories while the world is built; each returns the real result unchanged.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DecisionSubjectV1, NoticePositionV1 } from '../../src/contracts/goal-decisions.js';
import type { DecisionCardV1, NoticeItemV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { WriteNoteEnvelopeV1 } from '../../src/core/work-graph/model/note-contracts.js';
import * as decisionReadModule from '../../src/core/work-graph/views/decision-read-model.js';
import type { MainPageV1, RequestReadV1 } from '../../src/core/work-graph/views/main-surface-read-model.js';
import { understandingNote } from '../helpers/S4C2-note-card-fixture.js';
import {
  openS6BProjectWorld, resolveS6BProjectNote, scribeUnderstanding, understandingPointer, writeUserProjectUnderstanding,
} from '../helpers/S6B1-fixture.js';

type ProjectWorld = Awaited<ReturnType<typeof openS6BProjectWorld>>;

/** Hand-written JCS canonical `note_review` key (never production's `decisionSourceKey`). */
function projectCardKey(projectId: string, noteId: string, version: number): string {
  return `{"kind":"note_review","note":{"ref":{"aggregateType":"NoteHead","noteId":${JSON.stringify(noteId)},`
    + `"projectId":${JSON.stringify(projectId)}},"revision":${String(version)}}}`;
}

function projectSubject(projectId: string): DecisionSubjectV1 {
  return { kind: 'project', projectRef: { projectId } };
}

async function withProjectWorld(run: (opened: ProjectWorld) => Promise<void>): Promise<void> {
  const opened = await openS6BProjectWorld({ backend: 'memory' });
  try {
    await run(opened);
  } finally {
    await opened.close();
  }
}

/** The pending project understanding and its hand-written card key. */
async function pendingProjectNote(opened: ProjectWorld, label: string) {
  const written = await scribeUnderstanding(opened.world, opened.scribe, { label, structural: true });
  expect(written.note.storedState).toBe('pending_review');
  expect(written.note.goalId).toBeNull();
  return { note: written.note, projectId: opened.goalless.scope.projectId,
    key: projectCardKey(opened.goalless.scope.projectId, written.note.noteId, written.note.version) };
}

describe('the project card by read scope', () => {
  // One pending project understanding; every case here only reads it.
  let opened: ProjectWorld;
  let pending: Awaited<ReturnType<typeof pendingProjectNote>>;
  beforeAll(async () => {
    opened = await openS6BProjectWorld({ backend: 'memory' });
    pending = await pendingProjectNote(opened, 'a1');
  }, 120_000);
  afterAll(async () => { await opened?.close(); });

  // Input: the workspace read and its Goal filter. Expected: how many waiting project cards it holds (hand-counted).
  it.each([
    { read: 'the zero-Goal workspace, no filter', workspace: 'goalless', goal: null, count: 1 },
    { read: 'the scribe workspace, no filter (global)', workspace: 'main', goal: null, count: 1 },
    { read: 'the scribe workspace, Goal 1 filter (D-09)', workspace: 'main', goal: 'first', count: 0 },
    { read: 'the scribe workspace, Goal 2 filter (D-09)', workspace: 'main', goal: 'second', count: 0 },
  ] as const)('$read: $count project card', async ({ workspace, goal, count }) => {
    const subject = projectSubject(pending.projectId);
    const cards = await opened[workspace].readCards(goal === null ? undefined : opened.world.goals[goal]);
    expect(cards.filter((card) => card.source.key === pending.key).map((card) => ({ cardKey: card.cardKey,
      state: card.state, subject: card.subject, sourceSubject: card.source.subject })))
      .toEqual(Array.from({ length: count }, () => ({
        cardKey: pending.key, state: 'waiting_answer', subject, sourceSubject: subject })));
  });

  it('a zero-Goal workspace reads the project card by its own source', async () => {
    const subject = projectSubject(pending.projectId);
    const listed = (await opened.goalless.readCards()).find((card) => card.source.key === pending.key);
    expect(listed).toBeDefined();
    const read = await opened.goalless.route('decisions/card', { source: listed!.source });
    expect(read).toMatchObject({ status: 'ready', value: {
      state: 'waiting_answer', source: { key: pending.key, subject }, subject } });
    expect((read as { value: DecisionCardV1 }).value.options.map((option) => option.id)).toEqual(['accept', 'reject']);
  });
});

describe('the project subject card read', () => {
  it('answered, applied and kept as a project', async () => {
    await withProjectWorld(async (opened) => {
      const { note, projectId, key } = await pendingProjectNote(opened, 'a4');
      const { card, resolution } = await resolveS6BProjectNote(opened.goalless,
        { noteId: note.noteId, optionId: 'accept', label: 'a4' });
      expect(card.source.subject).toEqual(projectSubject(projectId));
      expect(resolution).toMatchObject({ status: 'ready', value: {
        answer: { status: 'committed' }, state: 'applied' } });
      const readNote = await opened.world.platform.notes.readNote(opened.goalless.humanContext(), { noteId: note.noteId });
      expect(readNote).toMatchObject({ status: 'ready', value: { storedState: 'accepted', goalId: null } });
      const listed = await opened.goalless.route('notes/list',
        { anchor: { kind: 'project' }, state: 'accepted', limit: 100, cursor: null });
      expect((listed as { value: { items: { noteId: string }[] } }).value.items
        .some((item) => item.noteId === note.noteId)).toBe(true);
      const applied = (await opened.goalless.readCards()).find((entry) => entry.cardKey === key);
      expect(applied).toBeDefined();
      expect(applied!.state).toBe('applied');
      const answer = await opened.world.platform.decisionMessages.readDecisionAnswer(
        opened.goalless.humanContext(), { source: card.source });
      if (answer.status !== 'ready' || answer.value.message === null) {
        throw new Error(`the saved project answer is not readable: ${JSON.stringify(answer)}`);
      }
      expect(answer.value.message.goalRef).toBeNull();
      const response = answer.value.message.response;
      expect(response !== null && 'decision' in response ? response.decision.source.subject : null)
        .toEqual(card.source.subject);
    });
  });
});

/** Hand-written JCS canonical `note_review` item key (never production's `noteVersionRefKey`). */
function noticeItemKey(projectId: string, noteId: string, version: number): string {
  return `note_review:{"aggregateType":"NoteVersion","noteId":${JSON.stringify(noteId)},`
    + `"projectId":${JSON.stringify(projectId)},"version":${String(version)}}`;
}

/** The commit cursor of a notice position; anything else is not a notice this file reads. */
function cursorOf(position: NoticePositionV1 | undefined): string {
  if (position === undefined || position.kind !== 'commit') {
    throw new Error(`the notice position is not a commit cursor: ${JSON.stringify(position)}`);
  }
  return position.cursor;
}

/**
 * The person's own project understanding, then the scribe rewriting it: the scribe's version supersedes a
 * user-confirmed note, so it is classified `user_affected` and the notice source holds it. It bypasses the Goal set of
 * the project's three notice streams, so the goalless workspace reads it too. Answers the scribe's note.
 */
async function rewrittenProjectUnderstanding(opened: ProjectWorld, label: string) {
  const written = await writeUserProjectUnderstanding(opened.world, opened.goalless, label);
  expect(written).toMatchObject({ status: 'accepted', confirmedByUser: true });
  const rewritten = await scribeUnderstanding(opened.world, opened.scribe, { label, structural: false });
  expect(rewritten.note).toMatchObject({ storedState: 'accepted', goalId: null });
  return rewritten.note;
}

type ReadCounts = { wholePage: number; projectPages: number };

/**
 * A3: pass-through counters around two real factories of the platform the frozen fixture builds (as
 * tests/app/S8A-L8-auto-capture-gate.test.ts does): the read model's whole-page assemblies, and the note card source's
 * project pages (a page read with no Goal). Each returns the real result unchanged; the spies go once the platform is
 * built.
 */
async function withCountedProjectWorld(run: (opened: ProjectWorld, counts: ReadCounts) => Promise<void>) {
  const counts: ReadCounts = { wholePage: 0, projectPages: 0 };
  const realReadModel = decisionReadModule.createDecisionReadModel;
  const realNoteCards = decisionReadModule.createNoteReviewCardSource;
  const spies = [
    vi.spyOn(decisionReadModule, 'createDecisionReadModel').mockImplementation((deps) => {
      const real = realReadModel(deps);
      return { ...real, readWholePage: (ctx, input) => {
        counts.wholePage += 1;
        return real.readWholePage(ctx, input);
      } };
    }),
    vi.spyOn(decisionReadModule, 'createNoteReviewCardSource').mockImplementation((deps) => {
      const real = realNoteCards(deps);
      return { ...real, readPage: (ctx, input) => {
        if (input.goalRef === undefined) counts.projectPages += 1;
        return real.readPage(ctx, input);
      } };
    }),
  ];
  const opened = await openS6BProjectWorld({ backend: 'memory' })
    .finally(() => { for (const spy of spies) spy.mockRestore(); });
  try {
    await run(opened, counts);
  } finally {
    await opened.close();
  }
}

const delta = (counts: ReadCounts, before: ReadCounts): ReadCounts =>
  ({ wholePage: counts.wholePage - before.wholePage, projectPages: counts.projectPages - before.projectPages });

/** One `main/read` page of `goalId` (null: the no-goal view) as the route returns it. */
async function mainPage(workspace: ProjectWorld['main'], goalId: string | null): Promise<MainPageV1> {
  const body = await workspace.route('main/read', { goalId, cursor: null }) as {
    status?: string; value?: MainPageV1 };
  if (body.status !== 'ready' || body.value === undefined) {
    throw new Error(`main/read of ${String(goalId)} is not ready: ${JSON.stringify(body)}`);
  }
  return body.value;
}

/** One `requests/read` of a request root as the route returns it. */
async function requestRead(workspace: ProjectWorld['main'], requestRoot: unknown): Promise<RequestReadV1> {
  const body = await workspace.route('requests/read', { requestRoot }) as {
    status?: string; value?: RequestReadV1 };
  if (body.status !== 'ready' || body.value === undefined) {
    throw new Error(`requests/read is not ready: ${JSON.stringify(body)}`);
  }
  return body.value;
}

describe('the project notice page', () => {
  it('a page of one project notice advances only through it; the later one is the next page', async () => {
    await withProjectWorld(async (opened) => {
      const projectId = opened.goalless.scope.projectId;
      const firstNote = await rewrittenProjectUnderstanding(opened, 'b1');
      const secondNote = await rewrittenProjectUnderstanding(opened, 'b2');
      const firstKey = noticeItemKey(projectId, firstNote.noteId, firstNote.version);
      const secondKey = noticeItemKey(projectId, secondNote.noteId, secondNote.version);

      // The zero-Goal workspace reads both project notices, in commit order, as the project's.
      const all = await opened.goalless.readNotices({ categories: ['note_review'] });
      expect(all.notices.map((notice) => notice.itemKey)).toEqual([firstKey, secondKey]);
      expect(all.notices.map((notice) => notice.subject))
        .toEqual([projectSubject(projectId), projectSubject(projectId)]);
      expect(all.notices.map((notice) => notice.noteClass)).toEqual(['user_affected', 'user_affected']);
      const [firstNotice, secondNotice] = all.notices;
      expect(cursorOf(firstNotice!.position) < cursorOf(secondNotice!.position)).toBe(true);

      // D-09 stays: the Goal-filtered pages of the scribe's workspace hold no project notice.
      for (const goal of [opened.world.goals.first, opened.world.goals.second]) {
        expect((await opened.main.readNotices({ goal, categories: ['note_review'] })).notices).toEqual([]);
      }

      // One page holding only the first notice advances to the FIRST position, never to the second's.
      const page = await opened.goalless.readNotices({ categories: ['note_review'], limit: 1 });
      expect(page.notices.map((notice) => notice.itemKey)).toEqual([firstKey]);
      // The spec fixes the position's kind and its item key (written out). The cursor is the ledger's opaque commit
      // cursor of that version, used as the full read returned it (rule A1 v4: a platform-issued position is never
      // hand-made).
      expect(page.seenThrough).toEqual({
        note_review: { kind: 'commit', cursor: cursorOf(firstNotice!.position), itemKey: firstKey } });
      expect(typeof page.displayToken).toBe('string');

      const marked = await opened.goalless.markSeen({ label: 'project-notice-b1',
        displayToken: page.displayToken!, seenThrough: page.seenThrough });
      expect(marked['status']).toBe('committed');

      // The second notice was not shown, so it is still unseen: the next page is it, and only then does the advance
      // reach its position.
      const next = await opened.goalless.readNotices({ categories: ['note_review'], limit: 1 });
      expect(next.notices.map((notice) => notice.itemKey)).toEqual([secondKey]);
      expect(next.seenThrough).toEqual({
        note_review: { kind: 'commit', cursor: cursorOf(secondNotice!.position), itemKey: secondKey } });
      // An independent literal: once that page is marked, a later public read holds no project notice.
      expect((await opened.goalless.markSeen({ label: 'project-notice-b2', displayToken: next.displayToken!,
        seenThrough: next.seenThrough }))['status']).toBe('committed');
      expect((await opened.goalless.readNotices({ categories: ['note_review'] })).notices).toEqual([]);
    });
  });

  it('an unseen Goal 1 notice before the shown project line keeps the no-goal view from advancing', async () => {
    await withProjectWorld(async (opened) => {
      const projectId = opened.main.scope.projectId;
      const goalId = opened.world.goals.first.goalId;
      // The person's own Goal 1 understanding, then the scribe rewriting it: a `user_affected` Goal 1 notice (c1).
      const anchor = { kind: 'goal' as const, goalId };
      const pointer = await understandingPointer(opened.world, anchor);
      const own = await opened.main.route('notes/write', { commandId: 's6b-user-e1', goalId,
        expectedPointerRevision: pointer.revision, note: understandingNote({ anchor, topic: 's6b-understanding',
          structural: false, conclusion: 'S6B understanding user-e1',
          replaces: pointer.noteId === null ? [] : [pointer.noteId] }) }) as WriteNoteEnvelopeV1;
      expect(own.write).toMatchObject({ status: 'accepted', confirmedByUser: true });
      const goalNote = (await scribeUnderstanding(opened.world, opened.scribe,
        { label: 'e2', structural: false, anchor })).note;
      expect(goalNote).toMatchObject({ storedState: 'accepted', goalId });
      // Then the project notice (c2).
      const projectNote = await rewrittenProjectUnderstanding(opened, 'e3');
      const goalKey = noticeItemKey(projectId, goalNote.noteId, goalNote.version);
      const projectKey = noticeItemKey(projectId, projectNote.noteId, projectNote.version);
      expect((await opened.main.readNotices({ categories: ['note_review'] })).notices
        .map((notice) => notice.itemKey)).toEqual([goalKey, projectKey]);

      // The no-goal view shows the project line only; the Goal 1 member before it is unshown, so the one
      // `note_review` member list stops there and the page does not advance the category.
      const page = await mainPage(opened.main, null);
      expect(page.notices.filter((notice) => notice.category === 'note_review').map((notice) => notice.itemKey))
        .toEqual([projectKey]);
      expect(page.seenThrough).not.toHaveProperty('note_review');
    });
  });
});

describe('the project card and notice on the main read', () => {
  it('the main read shows the project card and notice once, from one assembly and one project page', async () => {
    await withCountedProjectWorld(async (opened, counts) => {
      const projectId = opened.goalless.scope.projectId;
      const { key } = await pendingProjectNote(opened, 'c1');
      const rewritten = await rewrittenProjectUnderstanding(opened, 'c2');
      const noticeKey = noticeItemKey(projectId, rewritten.noteId, rewritten.version);
      const goal = opened.world.goals.first;
      // A real request of goal 1, so `requests/read` has a goal request to read against the project card.
      const request = await opened.main.submit({ label: 'c3', goalId: goal.goalId });
      // Nothing detached is still committing, so each measured read is one stable window.
      await opened.world.settleDetached();
      let before = { ...counts };

      // The Goal's view: the page's common part holds the project card and the project notice, each once, and no
      // request claims the card.
      const goalPage = await mainPage(opened.main, goal.goalId);
      expect(delta(counts, before)).toEqual({ wholePage: 1, projectPages: 1 });
      expect(goalPage.cards.filter((card) => card.cardKey === key)).toHaveLength(1);
      expect(goalPage.notices.filter((notice) => notice.itemKey === noticeKey)).toHaveLength(1);
      expect(goalPage.requests.flatMap((entry) => entry.cardKeys)).not.toContain(key);
      expect(goalPage.requests.map((entry) => entry.requestRoot.queryJobId))
        .toContain(request.requestRoot.queryJobId);

      // The no-goal view: the same common part, still once each.
      before = { ...counts };
      const noGoalPage = await mainPage(opened.main, null);
      expect(delta(counts, before)).toEqual({ wholePage: 1, projectPages: 1 });
      expect(noGoalPage.cards.filter((card) => card.cardKey === key)).toHaveLength(1);
      expect(noGoalPage.notices.filter((notice) => notice.itemKey === noticeKey)).toHaveLength(1);
      const projectLine = noGoalPage.notices.find((notice) => notice.itemKey === noticeKey) as
        NoticeItemV1 | undefined;
      expect(projectLine?.subject).toEqual(projectSubject(projectId));

      // The request read keeps its rule: a request's own read takes its rounds' cards and its Goal's own cards, never the project's.
      before = { ...counts };
      const read = await requestRead(opened.main, request.requestRoot);
      expect(delta(counts, before)).toEqual({ wholePage: 1, projectPages: 1 });
      expect(read.cards.filter((card) => card.cardKey === key)).toEqual([]);
      expect(read.cards.map((card) => card.cardKey)).not.toContain(key);

      // Also with zero Goals: the second workspace's main read is one assembly and one project page.
      before = { ...counts };
      await mainPage(opened.goalless, null);
      expect(delta(counts, before)).toEqual({ wholePage: 1, projectPages: 1 });

      // A queue read filtered to one Goal never shows a project card, so it reads no project page (H-01).
      before = { ...counts };
      await opened.main.readCards(goal);
      expect(delta(counts, before)).toEqual({ wholePage: 0, projectPages: 0 });
    });
  });
});
