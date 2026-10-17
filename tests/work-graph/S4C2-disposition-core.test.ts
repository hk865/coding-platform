/**
 * S4C2 rework item 3 (verify §3): ONE disposition core shared by the scribe's
 * disposition path and the note card's application.
 *
 * The bug: a card REJECT reads the CurrentPointer (the understanding's pin) but
 * never writes it, and the commit carried no read-only pointer guard, so a
 * pointer move that lands between the read and the commit was ignored.
 *
 * The interleave is the one permitted storage-boundary seam: both record-store
 * backend factories are spied before `createS4ANoteFixture` and only the real
 * `readMany` is wrapped; the wrapper is inert until armed and fires AFTER the
 * armed read returned, so the disposition sees the old pointer and the action
 * moves it through the real public `platform.workflow.resolveDecision`.
 *
 * The owner-level test is the RED (before the fix the reject commits); the
 * coordinator test asserts the required `source_stale` /
 * `application_not_recorded` contract.
 */
import { expect, it, vi } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import type { DecisionCardV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { NoteDecisionApplyPort, NoteWritePort } from '../../src/core/work-graph/model/note-contracts.js';
import type { GoalRecordTransactionPort } from '../../src/core/record-store/ports.js';
import * as memoryBackend from '../../src/core/record-store/in-memory-record-store.js';
import * as sqliteBackend from '../../src/core/record-store/sqlite-record-store.js';
import * as noteServiceModule from '../../src/core/work-graph/notes/note-service.js';
import { createS4ANoteFixture, type S4ANoteFixture, type S4ANoteFixtureKind } from '../helpers/S4A-note-fixture.js';

const KINDS: readonly S4ANoteFixtureKind[] = ['memory', 'sqlite'];
const GOAL = { kind: 'goal', goalId: 's4a-goal' } as const;
const PROJECT = 's4a-project';
const WORKSPACE = 's4a-workspace';
const ANSWER = { aggregateType: 'SessionMessage' as const, projectId: PROJECT, workspaceId: WORKSPACE,
  messageId: 's4c2-item3-answer' };
const POINTER = '"aggregateType":"CurrentPointer"';

function understanding(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  const sections = { status: 's', decided: 'd', open: 'o', next: 'n', risks: 'r' };
  return {
    kind: 'understanding', topic: 'default', conclusion: 'default', anchor: GOAL, extraAnchors: [], facts: [],
    basisFiles: [], structural: false, replaces: [], contradicts: [], coexistWith: [], sections,
    ...overrides,
  } as NoteDraftV1;
}

const idOf = (result: { status: string }): string => (result as unknown as { noteId: string }).noteId;

type Seam = {
  /** Fire `action` once, after the `fireOn`-th armed read of a CurrentPointer record. */
  arm(fireOn: number, action: () => Promise<void>): void;
};

type RaceFixture = {
  f: S4ANoteFixture;
  service: NoteWritePort & NoteDecisionApplyPort;
  seam: Seam;
};

/** The real fixture over a readMany-wrapped backend; the wrapper is inert until armed. */
async function buildRaceFixture(kind: S4ANoteFixtureKind): Promise<RaceFixture> {
  const state = { armed: false, fired: false, reads: 0, fireOn: 1,
    action: null as (() => Promise<void>) | null };
  const observe = <T,>(backend: T): T => {
    const records = (backend as unknown as { records: GoalRecordTransactionPort }).records;
    const rawReadMany = records.readMany.bind(records);
    return { ...(backend as object), records: { ...records,
      async readMany(refKeys: readonly string[]): Promise<unknown> {
        const result = await rawReadMany(refKeys as string[]);
        if (state.armed && !state.fired && refKeys.some(key => key.includes(POINTER))) {
          state.reads += 1;
          if (state.reads === state.fireOn) {
            state.fired = true;
            const run = state.action;
            if (run !== null) await run();
          }
        }
        return result;
      } } } as unknown as T;
  };
  const originalMemory = memoryBackend.createInMemoryRecordBackend;
  const originalSqlite = sqliteBackend.createSqliteRecordBackend;
  const memorySpy = vi.spyOn(memoryBackend, 'createInMemoryRecordBackend')
    .mockImplementation(options => observe(originalMemory(options)) as never);
  const sqliteSpy = vi.spyOn(sqliteBackend, 'createSqliteRecordBackend')
    .mockImplementation(options => observe(originalSqlite(options)) as never);
  let service: (NoteWritePort & NoteDecisionApplyPort) | null = null;
  const originalNoteService = noteServiceModule.createNoteService;
  const noteSpy = vi.spyOn(noteServiceModule, 'createNoteService').mockImplementation(deps => {
    const built = originalNoteService(deps) as unknown as NoteWritePort & NoteDecisionApplyPort;
    service = built;
    return built as unknown as ReturnType<typeof originalNoteService>;
  });
  let f: S4ANoteFixture;
  try {
    f = await createS4ANoteFixture(kind, { operatorActor: { kind: 'human', id: 's4a-operator' } });
  } finally {
    memorySpy.mockRestore();
    sqliteSpy.mockRestore();
    noteSpy.mockRestore();
  }
  if (service === null) throw new Error('the note service was not composed');
  return { f, service,
    seam: { arm(fireOn, action) { state.fireOn = fireOn; state.action = action; state.reads = 0;
      state.fired = false; state.armed = true; } } };
}

/** u0 current, u1 pending (contradiction, can supersede u0), u2 pending structural (no targets). */
async function seedThreeUnderstandings(f: S4ANoteFixture): Promise<{ u0: string; u1: string; u2: string }> {
  const user = f.ctx();
  const u0 = await f.write(user, understanding({ topic: 'u0', conclusion: 'user understanding' }), 's4a-goal');
  const u0Id = idOf(u0);
  // ONE agent Run writes both pending notes (a task can be claimed once).
  const run = await f.claimRun('item3-agent');
  const u1 = await f.write(f.workCtx(run), understanding({ topic: 'u1', conclusion: 'agent one',
    contradicts: [u0Id] }), 's4a-goal', { expectedPointerRevision: 1 });
  expect(u1).toMatchObject({ status: 'pending_review', reasons: ['contradiction'] });
  const u2 = await f.write(f.workCtx(run), understanding({ topic: 'u2', conclusion: 'agent two',
    structural: true }), 's4a-goal', { expectedPointerRevision: 1 });
  expect(u2).toMatchObject({ status: 'pending_review', reasons: ['structural'] });
  return { u0: u0Id, u1: idOf(u1), u2: idOf(u2) };
}

/** The real queue's live note cards for the fixture Goal. */
async function noteCards(f: S4ANoteFixture): Promise<DecisionCardV1[]> {
  const queue = await f.platform.decisions.queryDecisionQueue(f.ctx(), {
    workspace: f.scope, goalRef: f.goalRef, sections: ['waiting_answer'], page: { limit: 100 } });
  if (queue.status !== 'ready') throw new Error(`queue read failed: ${JSON.stringify(queue)}`);
  return queue.value.waitingAnswer.filter(card => card.source.kind === 'note_review');
}

function noteHeadPinOf(card: DecisionCardV1): { noteId: string; version: number } {
  const pin = card.source.pins.find(candidate =>
    (candidate.ref as { aggregateType?: unknown }).aggregateType === 'NoteHead');
  if (pin === undefined) throw new Error('the note card carries no NoteHead pin');
  return { noteId: (pin.ref as unknown as { noteId: string }).noteId, version: pin.revision };
}

function pointerPinOf(card: DecisionCardV1): number | null {
  const pin = card.source.pins.find(candidate =>
    (candidate.ref as { aggregateType?: unknown }).aggregateType === 'CurrentPointer');
  return pin === undefined ? null : pin.revision;
}

/** The interleaved REAL public pointer move: the user accepts u1 through the coordinator. */
async function acceptThroughCoordinator(f: S4ANoteFixture, card: DecisionCardV1, requestId: string):
Promise<void> {
  const resolve = f.platform.workflow.resolveDecision;
  if (resolve === undefined) throw new Error('the composition publishes no resolveDecision');
  const result = await resolve(f.ctx(), {
    input: { source: card.source, selection: { kind: 'option', optionId: 'supersede' }, text: '', annotations: [] },
    meta: { requestId, expected: card.source.pins } });
  expect(result).toMatchObject({ status: 'ready', value: { state: 'applied' } });
}

async function itemOf(f: S4ANoteFixture, noteId: string):
Promise<{ version: number; storedState: string }> {
  const read = await f.platform.notes.readNote(f.ctx(), { noteId });
  if (read.status !== 'ready') throw new Error(`note ${noteId} is not readable: ${JSON.stringify(read)}`);
  return read.value;
}

async function pointerOf(f: S4ANoteFixture): Promise<{ noteId: string | null; revision: number | null } | null> {
  const page = await f.platform.notes.listByAnchor(f.ctx(), { anchor: GOAL, limit: 10, cursor: null });
  if (page.status !== 'ready') throw new Error(`anchor page failed: ${JSON.stringify(page)}`);
  return page.value.pointer;
}

it.each(KINDS)('S4C2-item3 %s: a reject card guards the CurrentPointer it read', async kind => {
  const { f, service, seam } = await buildRaceFixture(kind);
  try {
    const { u1, u2 } = await seedThreeUnderstandings(f);
    const cards = await noteCards(f);
    const u1Card = cards.find(card => noteHeadPinOf(card).noteId === u1);
    const u2Card = cards.find(card => noteHeadPinOf(card).noteId === u2);
    if (u1Card === undefined || u2Card === undefined) throw new Error('the two pending cards were not listed');
    expect(u2Card.source.pins).toHaveLength(2);
    expect(pointerPinOf(u2Card)).toBe(1);

    // u2's OWN pointer read is the first CurrentPointer read of this owner call.
    seam.arm(1, () => acceptThroughCoordinator(f, u1Card, `s4c2-item3-accept-${kind}`));
    const result = await service.applyNoteDecision(f.ctx(), {
      commandId: `s4c2-item3-reject-${kind}`, cardId: u2Card.source.key, optionId: 'reject',
      pin: noteHeadPinOf(u2Card), expectedPointerRevision: pointerPinOf(u2Card),
      answerMessageRef: ANSWER, conditions: null,
    });
    expect(result).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    // Nothing was recorded by the stale reject; the pointer still names u1.
    expect(await itemOf(f, u2)).toMatchObject({ version: 1, storedState: 'pending_review' });
    expect(await pointerOf(f)).toEqual({ noteId: u1, revision: 2 });
  } finally { await f.close(); }
});

it.each(KINDS)('S4C2-item3 %s: a stale reject is source_stale through the coordinator', async kind => {
  const { f, seam } = await buildRaceFixture(kind);
  try {
    const { u1, u2 } = await seedThreeUnderstandings(f);
    const cards = await noteCards(f);
    const u1Card = cards.find(card => noteHeadPinOf(card).noteId === u1);
    const u2Card = cards.find(card => noteHeadPinOf(card).noteId === u2);
    if (u1Card === undefined || u2Card === undefined) throw new Error('the two pending cards were not listed');
    const resolve = f.platform.workflow.resolveDecision;
    if (resolve === undefined) throw new Error('the composition publishes no resolveDecision');
    const requestId = `s4c2-item3-stale-${kind}`;
    const selection = { kind: 'option' as const, optionId: 'reject' };
    // Step ① commits the answer first; the retried coordinator replays it from
    // its identity, so the ONLY pointer read after arming is the apply guard.
    const answered = await f.platform.decisionMessages.answerDecision(f.ctx(), {
      input: { source: u2Card.source, selection, text: '', annotations: [] },
      meta: { requestId: `${requestId}:answer`, expected: u2Card.source.pins } });
    expect(answered.status).toBe('committed');

    seam.arm(1, () => acceptThroughCoordinator(f, u1Card, `s4c2-item3-accept-e2e-${kind}`));
    const result = await resolve(f.ctx(), {
      input: { source: u2Card.source, selection, text: '', annotations: [] },
      meta: { requestId, expected: u2Card.source.pins } });
    expect(result).toMatchObject({ status: 'ready', value: {
      state: 'application_not_recorded',
      action: { status: 'rejected', code: 'source_stale' },
      application: null,
    } });
    expect(await itemOf(f, u2)).toMatchObject({ version: 1, storedState: 'pending_review' });
    expect(await pointerOf(f)).toEqual({ noteId: u1, revision: 2 });
  } finally { await f.close(); }
});
